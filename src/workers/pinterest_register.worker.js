import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import readline from 'readline';
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

async function waitEnter(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
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
      console.log('\n' + '='.repeat(55));
      console.log('  [THU CONG] CAPTCHA XUAT HIEN!');
      console.log(`  Email dang dung: ${email}`);
      console.log('  Hay giai CAPTCHA trong cua so trinh duyet,');
      console.log('  sau do click "Continue" / "Sign up".');
      console.log('  Khi da qua trang tiep theo, nhan Enter o day.');
      console.log('='.repeat(55) + '\n');
      await waitEnter('  Nhan Enter de tiep tuc sau khi giai CAPTCHA: ');
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
      console.log('  [WARN] Khong tim duoc link verify - co the Pinterest khong yeu cau, hoac kiem tra thu cong.');
      await waitEnter('  Nhan Enter khi ban da xu ly xong: ');
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