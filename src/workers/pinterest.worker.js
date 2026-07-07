import { BaseWorker } from './base.worker.js';
import { logger } from '../utils/logger.js';
import { readFileSync as _readJson } from 'fs';
import { fileURLToPath as _ftu } from 'url';
import path from 'path';
const _dir = path.dirname(_ftu(import.meta.url));
const _commentsAll = JSON.parse(_readJson(path.join(_dir, '../../config/comments.json'), 'utf8'));
function _pickComment(platform, category = 'default') {
  const bank = _commentsAll[platform];
  const pool = (bank && (bank[category] || bank.default)) || ['Great content!'];
  return pool[Math.floor(Math.random() * pool.length)];
}

export class PinterestWorker extends BaseWorker {
  constructor() { super('pinterest'); }

  // Pinterest can SVG de render icon heart/follow — chi block font va video
  async _blockMedia() {
    await this.page.route('**/*.{woff,woff2,ttf,mp4,webm}', r => r.abort());
  }

  async _isLoggedIn() {
    try {
      await this.page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.randomDelay(800, 1500);
      const url = this.page.url();
      return !url.includes('/login') && !url.includes('/signup');
    } catch { return false; }
  }

  async login(account) {
    await this.page.goto('https://www.pinterest.com/login/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(1500, 3000);
    await this._humanMouseMove();
    await this.humanType('input[id="email"]', account.username);
    await this.randomDelay(600, 1500);
    await this.humanType('input[id="password"]', account.password);
    await this.randomDelay(700, 1400);
    await this._humanMouseMove();
    await this.page.click('button[type="submit"]');
    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await this.randomDelay(2500, 5000);
    const url = this.page.url();
    if (url.includes('/login') || url.includes('/signup'))
      throw new Error('Dang nhap Pinterest that bai — sai thong tin hoac bi checkpoint');
    await this._dismissPopups();
    logger.info(this.platform, `Dang nhap thanh cong: ${account.username}`);
  }

  async execute({ accountId, action, targetUrl }) {
    await this._warmup();
    switch (action) {
      case 'follow':  return this._follow(targetUrl);
      case 'like':    return this._likePins(targetUrl);
      case 'repin':   return this._repinPin(targetUrl);
      case 'comment': return this._commentPin(targetUrl);
      default: throw new Error(`Pinterest: action khong ho tro — "${action}"`);
    }
  }

  // Warmup: duyet home feed tu nhien
  async _warmup() {
    logger.debug(this.platform, 'Bat dau warmup...');
    await this.page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(3000, 6000);
    await this._dismissPopups();

    const scrollCount = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < scrollCount; i++) {
      await this.naturalScroll(1);
      await this.randomDelay(2000, 5000); // nhin feed

      if (Math.random() > 0.45) {
        const pins = await this.page.$('[data-test-id="pin"]');
        if (pins) {
          const allPins = await this.page.$$('[data-test-id="pin"]');
          const pin = allPins[Math.floor(Math.random() * Math.min(allPins.length, 6))];
          await pin.hover().catch(() => {});
          await this.randomDelay(1200, 4000);
          await this._humanMouseMove();
        }
      }

      if (Math.random() > 0.75) {
        await this._browseOnePinAndBack();
        await this.randomDelay(2000, 5000);
      }
    }
    logger.debug(this.platform, 'Warmup xong');
  }

  async _browseOnePinAndBack() {
    const pins = await this.page.$$('[data-test-id="pin"]');
    if (!pins.length) return;
    const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 8))];
    try {
      await pin.click();
      await this.randomDelay(5000, 12000); // doc pin that su
      await this.page.mouse.wheel(0, 100 + Math.random() * 300);
      await this.randomDelay(2000, 5000);
      await this.page.keyboard.press('Escape');
      await this.randomDelay(1000, 2500);
    } catch {}
  }

  // Follow — xem profile truoc, cuon xem pin, roi moi follow
  async _follow(profileUrl) {
    logger.debug(this.platform, `Navigate den profile: ${profileUrl}`);
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(3000, 6000);

    // Scroll to top de dam bao header + Follow button hien thi
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.randomDelay(1000, 2000);

    await this._humanMouseMove();
    await this.randomDelay(2000, 5000); // nhin profile

    // Cuon xuong xem pin (check xem co gi hay khong)
    await this.naturalScroll(2);
    await this.randomDelay(3000, 7000);

    // Hover 1-2 pin truoc khi follow
    const pins = await this.page.$$('[data-test-id="pin"]');
    const previewCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < Math.min(previewCount, pins.length); i++) {
      await pins[i].hover().catch(() => {});
      await this.randomDelay(1500, 4000);
      await this._humanMouseMove();
    }

    // Cuon nguoc len header bang JS (tuyet doi, khong phu thuoc vao scroll amount)
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.randomDelay(1500, 3000);

    // Tim nut Follow — ho tro ca tieng Anh va tieng Viet (Pinterest dung IP geo de xac dinh ngon ngu)
    let followBtn = null;

    // Tier 1: Playwright locator text matching
    try {
      const loc = this.page.locator('button:has-text("Follow"), button:has-text("Theo d")').first();
      if (await loc.count() > 0) followBtn = await loc.elementHandle();
    } catch {}

    // Tier 2: CSS selectors + aria-label (ca EN va VI)
    if (!followBtn) {
      for (const sel of [
        '[data-test-id="follow-button"]',
        '[data-test-id="header-follow-button"]',
        '[data-test-id="profile-follow-button"]',
        'button[aria-label="Follow"]',
        'button[aria-label*="Follow"]',
        'button[aria-label="Theo doi"]',
        'button[aria-label*="Theo doi"]',
      ]) {
        followBtn = await this.page.$(sel);
        if (followBtn) break;
      }
    }

    // Tier 3: scan tat ca button — kiem tra ca tieng Viet "Theo doi"
    if (!followBtn) {
      const buttons = await this.page.$$('button');
      for (const btn of buttons) {
        const txt = await btn.innerText().catch(() => '');
        const norm = txt.trim().normalize('NFD').toLowerCase()
          .replace(/đ/g, 'd').replace(/[̀-ͯ]/g, '');
        if (norm === 'follow' || norm === 'theo doi') {
          followBtn = btn;
          break;
        }
      }
    }

    if (!followBtn) {
      // Debug: log ten tat ca buttons de phat hien van de
      const allBtns = await this.page.$$('button');
      const names = [];
      for (const b of allBtns.slice(0, 25)) {
        const t = await b.innerText().catch(() => '');
        if (t.trim()) names.push(t.trim().slice(0, 20));
      }
      logger.debug(this.platform, `Buttons tren trang: ${names.join(' | ')}`);
      throw new Error('Khong tim thay nut Follow');
    }

    const text = await followBtn.innerText().catch(() => '');
    if (/following|dang theo|Đang theo/i.test(text)) {
      logger.info(this.platform, `Da follow roi: ${profileUrl}`);
      return;
    }

    // Di chuyen chuot tu nhien den nut — do du truoc khi click
    await this._humanMouseMove();
    await this.randomDelay(1000, 3000);
    await followBtn.hover();
    await this.randomDelay(800, 2500); // do du
    await followBtn.click();
    await this.randomDelay(2500, 5000);
    logger.info(this.platform, `Da follow: ${profileUrl}`);
  }

  // Like — vao tung pin, xem that su roi moi like
  async _likePins(profileUrl) {
    const likeCount = 2 + Math.floor(Math.random() * 3);
    const pinUrls = await this._collectPinUrls(profileUrl, likeCount + 3);
    let successCount = 0;

    for (let i = 0; i < Math.min(likeCount, pinUrls.length); i++) {
      const pinUrl = pinUrls[i];
      logger.debug(this.platform, `Xem pin: ${pinUrl}`);

      await this.page.goto(pinUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(3500, 8000); // nhin pin sau khi load

      // Di chuyen chuot nhu dang nhin anh
      await this._humanMouseMove();
      await this.randomDelay(2500, 7000); // doc title/description

      // Cuon xuong xem mo ta va comment
      await this.page.mouse.wheel(0, 150 + Math.random() * 250);
      await this.randomDelay(2000, 6000);

      if (Math.random() > 0.4) {
        await this.page.mouse.wheel(0, 80 + Math.random() * 120);
        await this.randomDelay(1500, 4000);
      }

      // Cuon nguoc len de nhin pin va click like
      await this.page.mouse.wheel(0, -(200 + Math.random() * 250));
      await this.randomDelay(1500, 3500);

      // Tim nut like/react (heart icon)
      let likeBtn = null;
      for (const sel of [
        '[data-test-id="react-button"]',
        '[data-test-id="like-button"]',
        '[data-test-id="pin-closeup-react"]',
        'button[aria-label*="React" i]',
        'button[aria-label*="Like" i]',
        'button[aria-label*="Love" i]',
      ]) {
        likeBtn = await this.page.$(sel);
        if (likeBtn) break;
      }

      if (!likeBtn) {
        logger.debug(this.platform, 'Khong tim thay nut like, bo qua');
        continue;
      }

      const pressed = await likeBtn.getAttribute('aria-pressed').catch(() => null);
      if (pressed === 'true') { logger.debug(this.platform, 'Pin da like roi'); continue; }

      // Tu nhien: nhin chỗ khac truoc roi moi hover vao like
      await this._humanMouseMove();
      await this.randomDelay(1000, 3000);
      await likeBtn.hover();
      await this.randomDelay(700, 2000); // do du
      await likeBtn.click();
      await this.randomDelay(2500, 5500);

      successCount++;
      logger.info(this.platform, `Da like: ${pinUrl}`);
      if (i < likeCount - 1) await this.randomDelay(8000, 18000); // nghi giua cac lan
    }
    logger.info(this.platform, `Da like ${successCount} pin tu: ${profileUrl}`);
  }

  async _repinPin(targetUrl) {
    const repinCount = Math.random() > 0.5 ? 2 : 1;
    const pinUrls = await this._collectPinUrls(targetUrl, repinCount + 2);
    let successCount = 0;

    for (let i = 0; i < Math.min(repinCount, pinUrls.length); i++) {
      await this.page.goto(pinUrls[i], { waitUntil: 'domcontentloaded' });
      await this.randomDelay(3000, 7000);
      await this._humanMouseMove();
      await this.page.mouse.wheel(0, 100 + Math.random() * 150);
      await this.randomDelay(2000, 5000);

      const saveBtn = await this.page.$('[data-test-id="save-button"]');
      if (!saveBtn) continue;
      await saveBtn.hover();
      await this.randomDelay(500, 1500);
      await saveBtn.click();
      await this.randomDelay(1500, 3500);
      await this._selectBoard();
      successCount++;
      if (i < repinCount - 1) await this.randomDelay(6000, 14000);
    }
    logger.info(this.platform, `Da repin ${successCount} pin`);
  }

  async _commentPin(targetUrl) {
    const pinUrl = await this._resolvePinUrl(targetUrl);
    await this.page.goto(pinUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(3000, 7000);
    await this.page.mouse.wheel(0, 300 + Math.random() * 200);
    await this.randomDelay(1500, 3500);

    const selectors = [
      '[data-test-id="comment-field"]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="Add a comment" i]',
    ];
    let commentField = null;
    for (const sel of selectors) {
      commentField = await this.page.$(sel);
      if (commentField) break;
    }
    if (!commentField) throw new Error('Khong tim thay o comment');

    await commentField.hover();
    await this.randomDelay(600, 1500);
    await commentField.click();
    await this.randomDelay(800, 2000);
    const text = _pickComment('pinterest');
    await this._humanTypeWithMistake(text);
    await this.randomDelay(1000, 2500);
    await this.page.keyboard.press('Enter');
    await this.randomDelay(1500, 3500);
    logger.info(this.platform, `Da comment: "${text}"`);
  }

  async _resolvePinUrl(targetUrl) {
    const urls = await this._collectPinUrls(targetUrl, 1);
    if (!urls.length) throw new Error('Khong tim thay pin tren profile');
    return urls[0];
  }

  async _collectPinUrls(targetUrl, count) {
    if (targetUrl.includes('/pin/')) return [targetUrl];
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2500, 5500);
    await this.naturalScroll(2);
    const pins = await this.page.$$('[data-test-id="pin"]');
    if (!pins.length) return [];
    const shuffled = [...pins].sort(() => Math.random() - 0.5).slice(0, count + 5);
    const urls = [];
    for (const pin of shuffled) {
      if (urls.length >= count) break;
      const link = await pin.$('a');
      const href = await link?.getAttribute('href');
      if (!href) continue;
      urls.push(href.startsWith('http') ? href : `https://www.pinterest.com${href}`);
    }
    return urls;
  }

  async _selectBoard() {
    try {
      await this.page.waitForSelector('[data-test-id="board-row"]', { timeout: 5000 });
      const boards = await this.page.$$('[data-test-id="board-row"]');
      if (boards.length > 0) {
        const board = boards[Math.floor(Math.random() * boards.length)];
        await board.hover();
        await this.randomDelay(400, 900);
        await board.click();
        await this.randomDelay(800, 2000);
      }
    } catch {}
  }

  async _dismissPopups() {
    const dismissSelectors = [
      '[data-test-id="block-dismiss-button"]',
      'button[aria-label="Close"]',
      '[aria-label="Dismiss"]',
      'button:has-text("Not now")',
      'button:has-text("Skip")',
    ];
    for (const sel of dismissSelectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn) { await btn.click(); await this.randomDelay(500, 1200); }
      } catch {}
    }
  }
}
