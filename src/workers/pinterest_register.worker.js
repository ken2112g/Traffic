import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { TempMail } from '../utils/tempmail.js';
import { accountManager } from '../core/accountManager.js';
import { logger } from '../utils/logger.js';
import 'dotenv/config';

chromium.use(StealthPlugin());

const FIRST_NAMES = ['Linh','Hoa','Mai','Lan','Thu','Nga','Van','Trang','Huong','Yen','Anh','Tam','Ha','Thuy','Nhi'];
const LAST_NAMES  = ['Nguyen','Tran','Le','Pham','Hoang','Do','Dang','Bui','Ngo','Duong','Dinh','Vo','Ly','Ho'];

function randName() {
  return FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)] + ' ' +
         LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
}

function randBirthday() {
  return {
    month: 1  + Math.floor(Math.random() * 12),
    day:   1  + Math.floor(Math.random() * 28),
    year:  1990 + Math.floor(Math.random() * 15),
  };
}

function randPassword() {
  return 'Tr@' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 900 + 100);
}

async function waitForManualStep(page, { timeoutMs = 5 * 60_000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.includes('register') && !url.includes('signup')) return true;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

async function fillIfExists(page, selector, value) {
  try {
    const el = page.locator(selector).first();
    if (await el.count()) { await el.clear(); await el.fill(value); return true; }
  } catch {}
  return false;
}

export async function registerPinterestAccount({ role = 'sub', proxyConfig = null } = {}) {
  const mail     = new TempMail();
  const email    = await mail.create();
  const password = randPassword();
  const name     = randName();
  const bday     = randBirthday();

  logger.info('Register', `Bat dau dang ky: ${email}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    proxy:    proxyConfig || undefined,
    viewport: { width: 1366, height: 768 },
    locale:   'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();

  try {
    // ── 1. Mo trang dang ky ───────────────────────────────────────────
    await page.goto('https://www.pinterest.com/register/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // ── 2. Dien email ─────────────────────────────────────────────────
    await fillIfExists(page, 'input[name="email"]', email);
    await page.waitForTimeout(500);

    // ── 3. Dien password ──────────────────────────────────────────────
    await fillIfExists(page, 'input[name="password"]', password);
    await page.waitForTimeout(500);

    // ── 4. Dien ngay sinh ─────────────────────────────────────────────
    await fillIfExists(page, 'input[name="birthdate"]', `${bday.month}/${bday.day}/${bday.year}`);
    // fallback: month/day/year fields
    await fillIfExists(page, 'input[name="month"]', String(bday.month));
    await fillIfExists(page, 'input[name="day"]',   String(bday.day));
    await fillIfExists(page, 'input[name="year"]',  String(bday.year));
    await page.waitForTimeout(500);

    // ── 5. Dien ten ───────────────────────────────────────────────────
    await fillIfExists(page, 'input[name="firstName"],input[name="name"],input[name="username"]', name);
    await page.waitForTimeout(800);

    // ── 6. Submit ─────────────────────────────────────────────────────
    const submitSel = 'button[type="submit"], button:has-text("Continue"), button:has-text("Sign up"), button:has-text("Create account")';
    const submitBtn = page.locator(submitSel).first();
    if (await submitBtn.count()) await submitBtn.click();
    await page.waitForTimeout(3000);

    // ── 7. Kiem tra CAPTCHA / loi ─────────────────────────────────────
    const hasCaptcha = await page.locator(
      'iframe[src*="recaptcha"], .g-recaptcha, iframe[title*="reCAPTCHA"], iframe[src*="hcaptcha"]'
    ).count() > 0;

    const stillOnRegister = page.url().includes('register') || page.url().includes('signup');

    if (hasCaptcha || stillOnRegister) {
      logger.warn('Register', `CAPTCHA/buoc thu cong cho ${email} — cho toi da 5 phut de giai tren cua so trinh duyet...`);
      const solved = await waitForManualStep(page);
      if (!solved) {
        throw new Error('Timeout cho buoc thu cong (CAPTCHA) khi dang ky: ' + email);
      }
      logger.info('Register', `Da qua buoc thu cong cho ${email}, tiep tuc...`);
      await page.waitForTimeout(2000);
    }

    // ── 8. Chon so thich (neu co) ─────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      const skip = page.locator('button:has-text("Skip"), a:has-text("Skip"), button:has-text("Done")').first();
      if (await skip.count()) { await skip.click(); await page.waitForTimeout(1500); }
      else break;
    }

    // ── 9. Doi email xac nhan ─────────────────────────────────────────
    console.log('\n  [INFO] Dang cho email xac nhan tu Pinterest...\n');
    let verifyLink = null;
    try {
      const msg  = await mail.waitForEmail('Pinterest', 120_000);
      verifyLink = mail.extractVerifyLink(msg);
      if (verifyLink) logger.info('Register', `Tim thay link verify: ${verifyLink.slice(0, 60)}...`);
    } catch (e) {
      logger.warn('Register', `Khong lay duoc email verify: ${e.message}`);
    }

    if (verifyLink) {
      await page.goto(verifyLink, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      console.log('  [OK] Email da xac nhan!');
    } else {
      logger.warn('Register', `Khong tim duoc link verify cho ${email} - luu account nhung chua xac nhan email.`);
    }

    // ── 10. Luu session va DB ─────────────────────────────────────────
    const id  = accountManager.addAccount({ platform: 'pinterest', username: email, password, role, notes: `auto-register ${new Date().toISOString().slice(0,10)}` });
    const acc = accountManager.getAccount(id);
    await context.storageState({ path: acc.session_path });

    console.log('\n' + '='.repeat(55));
    console.log('  [OK] TAO ACCOUNT THANH CONG!');
    console.log(`  Email   : ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  ID      : ${id}`);
    console.log('='.repeat(55) + '\n');

    logger.info('Register', `Tao account thanh cong: ${email} (ID: ${id})`);
    return { email, password, id };

  } finally {
    await context.close();
    await browser.close();
  }
}

export async function registerAccountsBatch({ count, role = 'sub' } = {}) {
  let success = 0;
  for (let i = 0; i < count; i++) {
    logger.info('Register', `--- Account ${i + 1}/${count} ---`);
    try {
      await registerPinterestAccount({ role });
      success++;
    } catch (e) {
      logger.error('Register', `Loi dang ky account ${i + 1}/${count}: ${e.message}`);
    }
    if (i < count - 1) {
      const wait = 30_000 + Math.floor(Math.random() * 30_000);
      logger.info('Register', `Nghi ${Math.round(wait / 1000)}s truoc account tiep theo...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  logger.info('Register', `Hoan tat batch: ${success}/${count} account thanh cong`);
  return { success, total: count };
}