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

  // Cho phep SVG de icon heart/follow render dung
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
      throw new Error('Dang nhap Pinterest that bai -- sai thong tin hoac bi checkpoint');
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
      default: throw new Error(`Pinterest: action khong ho tro -- "${action}"`);
    }
  }

  // ─── Warmup: duyet feed tu nhien truoc khi lam gi ────────────────────────────

  async _warmup() {
    logger.debug(this.platform, 'Bat dau warmup...');
    await this.page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2500, 5000);
    await this._dismissPopups();

    const vp = this.page.viewportSize() || { width: 1366, height: 768 };

    // Nhin man hinh lan dau (mouse o giua)
    await this.page.mouse.move(
      vp.width / 2 + (Math.random() - 0.5) * 300,
      200 + Math.random() * 200,
      { steps: 15 + Math.floor(Math.random() * 10) }
    );
    await this.randomDelay(1500, 4000);

    const scrollCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < scrollCount; i++) {
      const r = Math.random();
      if (r < 0.25) {
        // Cuon cham - dang nhin ky pin nao do
        await this.page.mouse.wheel(0, 100 + Math.random() * 180);
        await this.randomDelay(2500, 6000);
        await this.page.mouse.move(
          150 + Math.random() * (vp.width - 300),
          200 + Math.random() * 300,
          { steps: 8 }
        );
        await this.randomDelay(1500, 4000);
      } else if (r < 0.65) {
        // Cuon vua - luot feed binh thuong
        await this.naturalScroll(1);
        await this.randomDelay(1200, 3500);
      } else {
        // Cuon nhanh - dang tim kiem gi do
        await this.page.mouse.wheel(0, 350 + Math.random() * 300);
        await this.randomDelay(600, 1800);
      }

      // 40%: hover vao 1 pin
      if (Math.random() > 0.6) {
        const pins = await this.page.$$('[data-test-id="pin"]');
        if (pins.length) {
          const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 8))];
          await pin.hover().catch(() => {});
          await this.randomDelay(700, 2500);
          await this._humanMouseMove();
        }
      }

      // 20%: click vao 1 pin de xem
      if (Math.random() > 0.8) {
        await this._browseOnePinAndBack();
        await this.randomDelay(1500, 4000);
      }
    }
    logger.debug(this.platform, 'Warmup xong');
  }

  async _browseOnePinAndBack() {
    const pins = await this.page.$$('[data-test-id="pin"]');
    if (!pins.length) return;
    const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 8))];
    const vp = this.page.viewportSize() || { width: 1366, height: 768 };
    try {
      await pin.click();
      await this.randomDelay(3500, 9000); // nhin anh lan dau

      // Di chuot nhu dang nhin anh
      await this.page.mouse.move(
        80 + Math.random() * Math.min(380, vp.width / 2 - 60),
        80 + Math.random() * (vp.height / 2),
        { steps: 12 + Math.floor(Math.random() * 10) }
      );
      await this.randomDelay(1500, 4000);

      if (Math.random() > 0.5) {
        await this.page.mouse.wheel(0, 100 + Math.random() * 200);
        await this.randomDelay(2000, 5000); // doc mo ta
      }

      await this.page.keyboard.press('Escape');
      await this.randomDelay(700, 1800);
    } catch {}
  }

  // ─── Follow: xem profile that su truoc roi moi follow ───────────────────────

  async _follow(profileUrl) {
    logger.debug(this.platform, `Navigate den profile: ${profileUrl}`);
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);

    // Dam bao ve dau trang
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.randomDelay(500, 1000);

    // Cho React render xong profile header
    try {
      await this.page.waitForFunction(
        () => document.querySelectorAll('button').length > 2,
        { timeout: 8000 }
      );
    } catch {}
    await this.randomDelay(500, 1200);

    const vp = this.page.viewportSize() || { width: 1366, height: 768 };

    // Nhin anh dai dien + ten (mouse di den vung header)
    await this.page.mouse.move(
      vp.width / 2 + (Math.random() - 0.5) * 200,
      70 + Math.random() * 100,
      { steps: 14 + Math.floor(Math.random() * 8) }
    );
    await this.randomDelay(2000, 5000); // "nhin" anh profile

    // Di chuot sang vung stats (nguoi dung hay check follower count)
    await this.page.mouse.move(
      vp.width / 2 + (Math.random() - 0.5) * 160,
      170 + Math.random() * 70,
      { steps: 8 + Math.floor(Math.random() * 5) }
    );
    await this.randomDelay(1200, 3500); // doc so follower/following

    // Cuon xuong xem pins truoc khi follow
    await this._profileScroll();
    await this.randomDelay(1500, 4000);

    // Cuon nguoc ve top
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await this.randomDelay(400, 800);
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.randomDelay(1200, 2500);

    // Kiem tra da follow chua
    if (await this._isAlreadyFollowing()) {
      logger.info(this.platform, `Da follow roi: ${profileUrl}`);
      return;
    }

    // Tim nut Follow (chay JS trong browser -- chinh xac nhat)
    const followBtn = await this._findFollowButton();

    if (!followBtn) {
      const btnList = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('button'))
          .map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 25))
          .filter(Boolean).slice(0, 20).join(' | ');
      });
      logger.info(this.platform, `[DEBUG] Buttons hien co: ${btnList}`);
      throw new Error('Khong tim thay nut Follow');
    }

    // Nhin chỗ khac truoc (nguoi that thuong scan trang truoc khi action)
    await this._bezierMoveTo(
      vp.width / 2 + (Math.random() - 0.5) * 250,
      vp.height / 2 + Math.random() * 120
    );
    await this.randomDelay(700, 2000);

    // Hover vao Follow voi bezier — khong di thang
    await this._naturalHover(followBtn);
    await this.randomDelay(600, 1800);

    // 30%: do du them (mat nguoi thuong "nhay" ra roi quay lai)
    if (Math.random() > 0.7) {
      await this._bezierMoveTo(
        vp.width / 2 + (Math.random() - 0.5) * 100,
        95 + Math.random() * 70
      );
      await this.randomDelay(400, 1000);
      await this._naturalHover(followBtn);
      await this.randomDelay(300, 600);
    }

    await followBtn.click();
    await this.randomDelay(2500, 5000);
    logger.info(this.platform, `Da follow: ${profileUrl}`);
  }

  // Cuon profile tu nhien + hover pin (dung chung cho follow)
  async _profileScroll() {
    const steps = 2 + Math.floor(Math.random() * 2);
    const vp = this.page.viewportSize() || { width: 1366, height: 768 };
    for (let i = 0; i < steps; i++) {
      const speed = 200 + Math.random() * 350;
      const chunks = 3 + Math.floor(Math.random() * 4);
      for (let c = 0; c < chunks; c++) {
        await this.page.mouse.wheel(0, speed / chunks);
        await this.randomDelay(40, 130);
      }
      await this.randomDelay(1200, 4000);

      if (Math.random() > 0.45) {
        const pins = await this.page.$$('[data-test-id="pin"]');
        if (pins.length) {
          const pin = pins[Math.floor(Math.random() * Math.min(pins.length, 6))];
          await pin.hover().catch(() => {});
          await this.randomDelay(700, 2500);
          await this.page.mouse.move(
            100 + Math.random() * (vp.width - 200),
            100 + Math.random() * (vp.height - 200),
            { steps: 6 }
          );
        }
      }
    }
  }

  // ─── Like: xem anh theo Z-pattern, doc mo ta F-pattern, hesitate truoc click ──

  async _likePins(profileUrl) {
    const likeCount = 2 + Math.floor(Math.random() * 3);
    const pinUrls = await this._collectPinUrls(profileUrl, likeCount + 3);
    let successCount = 0;

    for (let i = 0; i < Math.min(likeCount, pinUrls.length); i++) {
      const pinUrl = pinUrls[i];
      logger.debug(this.platform, `Xem pin: ${pinUrl}`);

      await this.page.goto(pinUrl, { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 4500); // trang load xong, mat bat dau quan sat

      const vp = this.page.viewportSize() || { width: 1366, height: 768 };
      // Pinterest closeup: anh chiem khoang 45% chieu rong ben trai
      const imgW = Math.min(vp.width * 0.45, 560);
      const imgH = Math.min(vp.height * 0.7, 520);

      // Quan sat anh bang Z-pattern (cach mat nguoi nhin anh)
      await this._scanImage(20, 60, imgW, imgH);
      await this.randomDelay(1500, 4000); // long pause — an tuong voi anh

      // Di chuot sang phan mo ta (ben phai tren Pinterest)
      const descX = imgW + 60 + Math.random() * 80;
      const descY = 80 + Math.random() * 60;
      await this._bezierMoveTo(descX, descY);
      await this.randomDelay(500, 1500);

      // Cuon xuong doc mo ta bang F-pattern
      await this._scrollEased(90 + Math.random() * 120);
      await this._readText(descX, descY + 40, 200);
      await this.randomDelay(1500, 4000);

      // 55%: tiep tuc doc comment
      if (Math.random() > 0.45) {
        await this._scrollEased(70 + Math.random() * 100);
        const cmtX = imgW + 50 + Math.random() * 100;
        await this._bezierMoveTo(cmtX, 200 + Math.random() * 150);
        await this._microSaccade(cmtX, 220 + Math.random() * 100, 2);
        await this.randomDelay(1500, 4500);
      }

      // Cuon nguoc len xem anh lan nua truoc khi like
      await this._scrollEased(100 + Math.random() * 130, -1);
      await this.randomDelay(1000, 2500);

      // 30% nhin lai anh lan nua (nguoi that hay lam vay)
      if (Math.random() > 0.7) {
        await this._scanImage(20, 60, imgW * 0.6, imgH * 0.5);
        await this.randomDelay(800, 2500);
      }

      // Tim nut like
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

      // Nhin chỗ khac truoc — nhu dang suy nghi, chua quyet dinh like
      await this._bezierMoveTo(
        imgW + 80 + Math.random() * 150,
        100 + Math.random() * 120
      );
      await this.randomDelay(600, 2000);

      // Hover vao nut voi bezier (khong thang)
      await this._naturalHover(likeBtn);
      await this.randomDelay(500, 1500);

      await likeBtn.click();
      await this.randomDelay(1800, 4500);

      successCount++;
      logger.info(this.platform, `Da like: ${pinUrl}`);
      if (i < likeCount - 1) await this.randomDelay(6000, 16000);
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
    let commentField = null;
    for (const sel of [
      '[data-test-id="comment-field"]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="Add a comment" i]',
    ]) {
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  // ─── Image & text reading simulation ───────────────────────────────────────

  // Z-pattern image scan: top-left → top-right → diagonal → bottom-left → bottom-right
  // Matches eye-tracking research on how people view images online
  async _scanImage(imgX, imgY, imgW, imgH) {
    const vp  = this.page.viewportSize() || { width: 1366, height: 768 };
    const bx  = Math.max(20, imgX);
    const by  = Math.max(20, imgY);
    const bw  = Math.min(imgW, vp.width  - bx - 20);
    const bh  = Math.min(imgH, vp.height - by - 20);

    // 5-6 scan points in rough Z pattern
    const pts = [
      [bx + bw * (0.08 + Math.random() * 0.08),  by + bh * (0.10 + Math.random() * 0.10)],  // top-left
      [bx + bw * (0.45 + Math.random() * 0.20),  by + bh * (0.12 + Math.random() * 0.08)],  // top-mid
      [bx + bw * (0.72 + Math.random() * 0.22),  by + bh * (0.12 + Math.random() * 0.10)],  // top-right
      [bx + bw * (0.25 + Math.random() * 0.30),  by + bh * (0.40 + Math.random() * 0.18)],  // center (diagonal)
      [bx + bw * (0.08 + Math.random() * 0.12),  by + bh * (0.62 + Math.random() * 0.18)],  // bottom-left
      [bx + bw * (0.50 + Math.random() * 0.38),  by + bh * (0.68 + Math.random() * 0.22)],  // bottom-right
    ];

    // Skip 1-2 points randomly (people dont always scan fully)
    const skip = new Set();
    if (Math.random() > 0.6) skip.add(Math.floor(Math.random() * pts.length));
    if (Math.random() > 0.75) skip.add(Math.floor(Math.random() * pts.length));

    for (let i = 0; i < pts.length; i++) {
      if (skip.has(i)) continue;
      const [px, py] = pts[i];
      await this._bezierMoveTo(px, py);
      const dwellMs = 180 + Math.floor(Math.random() * 550);
      await this.page.waitForTimeout(dwellMs);
      // 35%: micro-saccade on interesting points
      if (Math.random() > 0.65) await this._microSaccade(px, py, 2);
    }
  }

  // F-pattern text reading: full first line, shorter second, quick scan of rest
  async _readText(cx, cy, lineW = 200) {
    const half = lineW / 2;
    const lineH = 16 + Math.floor(Math.random() * 6);
    // Line 1: full read left → right
    await this._bezierMoveTo(cx - half * 0.85, cy);
    await this.page.waitForTimeout(200 + Math.floor(Math.random() * 400));
    await this._bezierMoveTo(cx + half * (0.6 + Math.random() * 0.3), cy);
    await this.page.waitForTimeout(150 + Math.floor(Math.random() * 350));
    // Line 2: partial read
    await this._bezierMoveTo(cx - half * 0.8, cy + lineH);
    await this.page.waitForTimeout(150 + Math.floor(Math.random() * 300));
    await this._bezierMoveTo(cx + half * (0.2 + Math.random() * 0.4), cy + lineH);
    await this.page.waitForTimeout(200 + Math.floor(Math.random() * 350));
    // Line 3+: quick left-anchor scan
    if (Math.random() > 0.4) {
      await this._bezierMoveTo(cx - half * 0.6, cy + lineH * 2);
      await this.page.waitForTimeout(100 + Math.floor(Math.random() * 250));
      if (Math.random() > 0.5) await this._microSaccade(cx - half * 0.3, cy + lineH * 2, 2);
    }
  }

  // Tim Follow button bang JS trong browser -- chay normalization Unicode chinh xac
  async _findFollowButton() {
    const handle = await this.page.evaluateHandle(() => {
      function norm(s) {
        return (s || '').normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/đ/g, 'd')
          .toLowerCase().trim();
      }
      for (const btn of document.querySelectorAll('button')) {
        const txt  = norm(btn.textContent);
        const aria = norm(btn.getAttribute('aria-label'));
        if (txt === 'follow' || txt === 'theo doi' ||
            aria === 'follow' || aria.startsWith('follow ') ||
            aria === 'theo doi' || aria.startsWith('theo doi ')) {
          return btn;
        }
      }
      return null;
    });
    return handle.asElement();
  }

  // Kiem tra da follow chua (button text la "Following" hoac "Dang theo doi")
  async _isAlreadyFollowing() {
    return this.page.evaluate(() => {
      function norm(s) {
        return (s || '').normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/đ/g, 'd')
          .toLowerCase().trim();
      }
      for (const btn of document.querySelectorAll('button')) {
        const txt  = norm(btn.textContent);
        const aria = norm(btn.getAttribute('aria-label'));
        if (txt === 'following' || txt.startsWith('dang theo') ||
            aria === 'following' || aria.startsWith('dang theo')) {
          return true;
        }
      }
      return false;
    });
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
