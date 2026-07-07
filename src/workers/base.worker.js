import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { getAccountFingerprint } from '../utils/fingerprint.js';
import { accountManager } from '../core/accountManager.js';
import { proxyManager } from '../core/proxyManager.js';
import { logger } from '../utils/logger.js';
import { notify } from '../utils/notify.js';

chromium.use(StealthPlugin());

export class BaseWorker {
  constructor(platform) {
    this.platform = platform;
    this.browser  = null;
    this.context  = null;
    this.page     = null;
  }

  async launch(accountId) {
    const account  = accountManager.getAccount(accountId);
    if (!account) throw new Error(`Account ${accountId} không tồn tại`);

    const proxy    = proxyManager.getPlaywrightProxy(accountId);
    const headless = process.env.HEADLESS !== 'false';

    this.browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      slowMo: headless ? 0 : 40,
    });

    const fp = getAccountFingerprint(account.username);
    this.context = await this.browser.newContext({
      proxy:        proxy || undefined,
      userAgent:    fp.userAgent,
      viewport:     fp.viewport,
      locale:       fp.locale,
      timezoneId:   fp.timezoneId,
      storageState: this._loadSession(account.session_path),
    });

    this.page = await this.context.newPage();
    accountManager.setStatus(accountId, 'running');
    logger.debug(this.platform, `Đã mở browser — account: ${account.username}`);
    return account;
  }

  async close(accountId) {
    try {
      if (this.context && accountId) {
        const account = accountManager.getAccount(accountId);
        if (account?.session_path) {
          const state = await this.context.storageState();
          writeFileSync(account.session_path, JSON.stringify(state));
          logger.debug(this.platform, `Đã lưu session — ${account.username}`);
        }
      }
    } catch {}
    try { await this.browser?.close(); } catch {}
    if (accountId) accountManager.setStatus(accountId, 'idle');
    this.browser = this.context = this.page = null;
  }

  // Block media SAU login (không ảnh hưởng CAPTCHA trong login form)
  async _blockMedia() {
    await this.page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,webm}', r => r.abort());
  }

  // ─── Template: run 1 action hoàn chỉnh ────────────────────────────────────

  async run({ accountId, action, targetUrl }) {
    let account = null;
    try {
      account = await this.launch(accountId);

      const hasSessionFile = accountManager.hasSession(accountId);

      if (hasSessionFile) {
        // Kiểm tra session còn hợp lệ không (không chỉ file tồn tại)
        const stillLoggedIn = await this._isLoggedIn();
        if (!stillLoggedIn) {
          logger.warn(this.platform, `Session hết hạn — ${account.username}, đang đăng nhập lại...`);
          try { unlinkSync(account.session_path); } catch {}
          await this.login(account);
        }
      } else {
        logger.info(this.platform, `Login account: ${account.username}`);
        await this.login(account);
      }

      // Bật block media SAU khi đã xác nhận đăng nhập
      await this._blockMedia();

      await this.execute({ accountId, action, targetUrl });
      accountManager.incrementAction(accountId, action);

    } catch (err) {
      logger.error(this.platform, `Lỗi account ${accountId}: ${err.message}`, err);

      if (/ban|suspend|block|checkpoint|locked|disabled/i.test(err.message)) {
        accountManager.setStatus(accountId, 'banned');
        try { unlinkSync(account.session_path); } catch {}
        await notify(
          `🚫 <b>Account bị ban!</b>\nPlatform: <b>${this.platform}</b>\nAccount: <b>${account?.username || accountId}</b>\nLý do: ${err.message}`
        );
      } else {
        accountManager.setStatus(accountId, 'error');
      }
      throw err;
    } finally {
      await this.close(accountId);
    }
  }

  // ─── Platform workers phải override ──────────────────────────────────────────

  // Kiểm tra nhanh xem còn đang login không
  async _isLoggedIn() {
    return false;
  }

  async login(account) {
    throw new Error(`${this.platform}.login() chưa được implement`);
  }

  async execute({ accountId, action, targetUrl }) {
    throw new Error(`${this.platform}.execute() chưa được implement`);
  }

  // ─── Human-like helpers ───────────────────────────────────────────────────────

  async randomDelay(minMs = 1000, maxMs = 5000) {
    const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
    await this.page.waitForTimeout(ms);
  }

  async humanType(selector, text) {
    await this.page.click(selector);
    for (const char of text) {
      await this.page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
    }
  }

  async safeClick(selector, timeout = 8000) {
    await this.page.waitForSelector(selector, { timeout });
    await this.randomDelay(300, 800);
    await this.page.click(selector);
  }

  async scrollDown(times = 3) {
    for (let i = 0; i < times; i++) {
      await this.page.mouse.wheel(0, 300 + Math.random() * 200);
      await this.randomDelay(500, 1500);
    }
  }

  async naturalScroll(times = 4) {
    for (let i = 0; i < times; i++) {
      const amount = 200 + Math.random() * 500;
      const steps  = 3 + Math.floor(Math.random() * 5);
      for (let s = 0; s < steps; s++) {
        await this.page.mouse.wheel(0, amount / steps);
        await this.randomDelay(60, 180);
      }
      await this.randomDelay(1200, 4500);
    }
  }

  async _humanMouseMove() {
    const vp = this.page.viewportSize() || { width: 1366, height: 768 };
    const x  = 150 + Math.random() * (vp.width  - 300);
    const y  = 100 + Math.random() * (vp.height - 200);
    await this.page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 15) });
    await this.randomDelay(200, 600);
  }

  async _humanTypeWithMistake(text) {
    const makeMistake = Math.random() > 0.6;
    const mistakeAt   = makeMistake ? Math.floor(Math.random() * (text.length - 3)) + 1 : -1;
    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i], { delay: 70 + Math.random() * 130 });
      if (i === mistakeAt) {
        const wrongChar = 'qwertyuiop'[Math.floor(Math.random() * 10)];
        await this.page.keyboard.type(wrongChar, { delay: 60 });
        await this.randomDelay(300, 600);
        await this.page.keyboard.press('Backspace');
        await this.randomDelay(200, 400);
      }
    }
  }

  _loadSession(sessionPath) {
    if (!sessionPath || !existsSync(sessionPath)) return undefined;
    try { return JSON.parse(readFileSync(sessionPath, 'utf8')); } catch { return undefined; }
  }

}