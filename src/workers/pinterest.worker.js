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
  constructor() {
    super('pinterest');
  }


  // Kiểm tra session còn hợp lệ — navigate home và xem có bị redirect login không
  async _isLoggedIn() {
    try {
      await this.page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.randomDelay(800, 1500);
      const url = this.page.url();
      return !url.includes('/login') && !url.includes('/signup');
    } catch { return false; }
  }
  // ─── Login ────────────────────────────────────────────────────────────────

  async login(account) {
    await this.page.goto('https://www.pinterest.com/login/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(1500, 3000);

    // Đôi khi di chuyển chuột trước khi click — giống người thật
    await this._humanMouseMove();

    await this.humanType('input[id="email"]', account.username);
    await this.randomDelay(600, 1500);

    await this.humanType('input[id="password"]', account.password);
    await this.randomDelay(700, 1400);

    // Di chuyển chuột đến nút submit trước khi click
    await this._humanMouseMove();
    await this.page.click('button[type="submit"]');
    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await this.randomDelay(2500, 5000);

    const url = this.page.url();
    if (url.includes('/login') || url.includes('/signup')) {
      throw new Error('Đăng nhập Pinterest thất bại — sai thông tin hoặc bị checkpoint');
    }

    // Đóng popup nếu có (dialog "Get the app", cookie notice, v.v.)
    await this._dismissPopups();

    logger.info(this.platform, `Đăng nhập thành công: ${account.username}`);
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute({ accountId, action, targetUrl }) {
    // Warmup: duyệt home feed tự nhiên trước khi làm action mục tiêu
    await this._warmup();

    switch (action) {
      case 'follow':  return this._follow(targetUrl);
      case 'like':    return this._likePins(targetUrl);
      case 'repin':   return this._repinPin(targetUrl);
      case 'comment': return this._commentPin(targetUrl);
      default:
        throw new Error(`Pinterest: action không hỗ trợ — "${action}"`);
    }
  }

  // ─── Warmup ───────────────────────────────────────────────────────────────

  async _warmup() {
    logger.debug(this.platform, 'Bắt đầu warmup — duyệt home feed...');

    await this.page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this._dismissPopups();

    // Scroll tự nhiên qua feed
    const scrollCount = 3 + Math.floor(Math.random() * 4); // 3-6 lần
    for (let i = 0; i < scrollCount; i++) {
      await this.naturalScroll(1);

      // 50% cơ hội hover vào 1 pin đang thấy
      if (Math.random() > 0.5) {
        const pins = await this.page.$$('[data-test-id="pin"]');
        if (pins.length > 0) {
          const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 6))];
          await pin.hover().catch(() => {});
          await this.randomDelay(600, 1800);
          await this._humanMouseMove();
        }
      }

      // 25% cơ hội click vào 1 pin, xem rồi back
      if (Math.random() > 0.75) {
        await this._browseOnePinAndBack();
      }
    }

    logger.debug(this.platform, 'Warmup xong');
  }

  // Click vào 1 pin, nhìn một lúc rồi quay lại
  async _browseOnePinAndBack() {
    const pins = await this.page.$$('[data-test-id="pin"]');
    if (pins.length === 0) return;

    const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 8))];
    try {
      await pin.click();
      await this.randomDelay(3000, 7000); // "đọc" pin

      // Scroll một chút trong modal pin
      await this.page.mouse.wheel(0, 100 + Math.random() * 200);
      await this.randomDelay(1000, 2500);

      // Đóng modal (Escape hoặc click vùng ngoài)
      await this.page.keyboard.press('Escape');
      await this.randomDelay(800, 1500);
    } catch {
      // Ignore nếu modal không đóng được
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async _follow(profileUrl) {
    logger.debug(this.platform, `Navigate đến profile: ${profileUrl}`);
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this._humanMouseMove();

    // Scroll nhẹ xuống để xem profile trước khi follow
    await this.naturalScroll(1);

    const followBtn = await this.page.$('[data-test-id="follow-button"]');
    if (!followBtn) throw new Error('Không tìm thấy nút Follow');

    const text = await followBtn.innerText();
    if (/following/i.test(text)) {
      logger.debug(this.platform, `Đã follow rồi, bỏ qua: ${profileUrl}`);
      return;
    }

    await followBtn.hover();
    await this.randomDelay(400, 900);
    await followBtn.click();
    await this.randomDelay(1500, 3000);

    logger.info(this.platform, `Đã follow: ${profileUrl}`);
  }

  async _likePins(profileUrl) {
    logger.debug(this.platform, `Navigate đến profile: ${profileUrl}`);
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this.naturalScroll(2);

    // Like 2–4 pin khác nhau trong 1 session (như người dùng thật duyệt profile)
    const likeCount = 2 + Math.floor(Math.random() * 3); // 2, 3, hoặc 4
    const likedIndexes = new Set();
    let successCount = 0;

    for (let i = 0; i < likeCount; i++) {
      // Scroll thêm để load thêm pin
      if (i > 0) {
        await this.naturalScroll(1);
        await this.randomDelay(1000, 2500);
      }

      const pins = await this.page.$$('[data-test-id="pin"]');
      if (pins.length === 0) break;

      // Chọn pin chưa like trong session này
      const available = [...Array(Math.min(pins.length, 20)).keys()].filter(j => !likedIndexes.has(j));
      if (available.length === 0) break;

      const idx = available[Math.floor(Math.random() * available.length)];
      likedIndexes.add(idx);

      const pin = pins[idx];
      await pin.hover();
      await this.randomDelay(700, 1800);

      const saveBtn = await pin.$('[data-test-id="save-button"]');
      if (!saveBtn) continue;

      await saveBtn.hover();
      await this.randomDelay(300, 800);
      await saveBtn.click();
      await this.randomDelay(1200, 3000);
      await this._selectBoard();

      successCount++;

      // Nghỉ giữa các lần like — giống người thật đang xem thêm
      if (i < likeCount - 1) await this.randomDelay(3000, 8000);
    }

    logger.info(this.platform, `Đã like ${successCount} pin từ profile: ${profileUrl}`);
  }

  async _repinPin(targetUrl) {
    // Repin 1–2 pin trong 1 session
    const repinCount = Math.random() > 0.5 ? 2 : 1;

    // Lấy danh sách pin URLs từ profile (tránh repin cùng 1 pin)
    const pinUrls = await this._collectPinUrls(targetUrl, repinCount + 2);
    let successCount = 0;

    for (let i = 0; i < Math.min(repinCount, pinUrls.length); i++) {
      const pinUrl = pinUrls[i];
      logger.debug(this.platform, `Navigate đến pin: ${pinUrl}`);

      await this.page.goto(pinUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2500, 5000);

      await this._humanMouseMove();
      await this.page.mouse.wheel(0, 100 + Math.random() * 150);
      await this.randomDelay(1500, 3500);

      const saveBtn = await this.page.$('[data-test-id="save-button"]');
      if (!saveBtn) continue;

      await saveBtn.hover();
      await this.randomDelay(400, 900);
      await saveBtn.click();
      await this.randomDelay(1200, 2500);
      await this._selectBoard();

      successCount++;
      if (i < repinCount - 1) await this.randomDelay(4000, 9000);
    }

    logger.info(this.platform, `Đã repin ${successCount} pin`);
  }

  async _commentPin(targetUrl) {
    const pinUrl = await this._resolvePinUrl(targetUrl);
    logger.debug(this.platform, `Navigate đến pin: ${pinUrl}`);

    await this.page.goto(pinUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2500, 5000);

    // Scroll xuống để đến phần comment
    await this.page.mouse.wheel(0, 300 + Math.random() * 200);
    await this.randomDelay(1000, 2000);

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
    if (!commentField) throw new Error('Không tìm thấy ô comment');

    // Di chuyển chuột đến field rồi click
    await commentField.hover();
    await this.randomDelay(400, 900);
    await commentField.click();
    await this.randomDelay(600, 1400);

    // Type từng ký tự như người thật (đôi khi sai + xóa)
    const text = _pickComment('pinterest');
    await this._humanTypeWithMistake(text);

    await this.randomDelay(800, 2000);
    await this.page.keyboard.press('Enter');
    await this.randomDelay(1200, 2500);

    logger.info(this.platform, `Đã comment: "${text}"`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  // Lấy 1 pin URL (dùng cho comment)
  async _resolvePinUrl(targetUrl) {
    const urls = await this._collectPinUrls(targetUrl, 1);
    if (urls.length === 0) throw new Error('Không tìm thấy pin trên profile');
    return urls[0];
  }

  // Lấy `count` pin URLs ngẫu nhiên từ profile (shuffle để không lặp thứ tự)
  async _collectPinUrls(targetUrl, count) {
    if (targetUrl.includes('/pin/')) return [targetUrl];

    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this.naturalScroll(2);

    const pins = await this.page.$$('[data-test-id="pin"]');
    if (pins.length === 0) return [];

    // Shuffle rồi lấy `count` pin đầu
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

  // Chọn board khi dialog Save xuất hiện
  async _selectBoard() {
    try {
      await this.page.waitForSelector('[data-test-id="board-row"]', { timeout: 4000 });
      const boards = await this.page.$$('[data-test-id="board-row"]');
      if (boards.length > 0) {
        const board = boards[Math.floor(Math.random() * boards.length)];
        await board.hover();
        await this.randomDelay(300, 700);
        await board.click();
        await this.randomDelay(600, 1500);
      }
    } catch {
      // Save thẳng không cần chọn board — OK
    }
  }

  // Đóng các popup thường gặp
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
        if (btn) {
          await btn.click();
          await this.randomDelay(500, 1000);
        }
      } catch {}
    }
  }

}
