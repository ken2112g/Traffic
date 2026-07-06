import { BaseWorker } from './base.worker.js';
import { logger } from '../utils/logger.js';

const COMMENTS = [
  '🔥🔥🔥',
  'This is amazing!',
  'Love this content! ❤️',
  'So talented! 👏',
  'Incredible! 🤩',
  'This made my day 😊',
  'Absolutely love it!',
  '💯💯',
  'Keep it up! 🙌',
  'This is so cool! ✨',
  'Wow!! 😍',
  'Best content! 🔥',
];

export class TikTokWorker extends BaseWorker {
  constructor() {
    super('tiktok');
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(account) {
    await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this._dismissPopups();

    await this._humanMouseMove();

    // TikTok dùng "username" cho cả email lẫn username
    const emailInput = await this.page.$('input[name="username"], input[type="email"], input[placeholder*="Email" i]');
    if (!emailInput) throw new Error('Không tìm thấy ô email/username TikTok');

    await emailInput.hover();
    await this.randomDelay(400, 800);
    await emailInput.click();
    await this.randomDelay(300, 600);
    for (const char of account.username) {
      await this.page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
    }
    await this.randomDelay(600, 1500);

    await this.humanType('input[type="password"]', account.password);
    await this.randomDelay(700, 1400);

    await this._humanMouseMove();
    await this.page.click('button[type="submit"], button[data-e2e="login-button"]');
    await this.randomDelay(3000, 6000);

    const url = this.page.url();
    if (url.includes('/login')) {
      throw new Error('Đăng nhập TikTok thất bại — sai thông tin hoặc bị captcha');
    }

    await this._dismissPopups();
    logger.info(this.platform, `Đăng nhập thành công: ${account.username}`);
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute({ accountId, action, targetUrl }) {
    await this._warmup();

    switch (action) {
      case 'follow':  return this._follow(targetUrl);
      case 'like':    return this._likeVideos(targetUrl);
      case 'comment': return this._commentVideo(targetUrl);
      case 'view':    return this._viewVideos(targetUrl);
      default:
        throw new Error(`TikTok: action không hỗ trợ — "${action}"`);
    }
  }

  // ─── Warmup ───────────────────────────────────────────────────────────────

  async _warmup() {
    logger.debug(this.platform, 'Warmup — xem For You page...');
    await this.page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this._dismissPopups();

    // Xem 2–4 video trên FYP trước khi vào mục tiêu
    const watchCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < watchCount; i++) {
      // "Xem" video trong 8–20 giây
      await this.randomDelay(8000, 20000);
      await this._humanMouseMove();

      // 30% cơ hội like video đang xem (tự nhiên)
      if (Math.random() > 0.7) {
        const likeBtn = await this.page.$('[data-e2e="like-icon"]');
        if (likeBtn) {
          await likeBtn.click();
          await this.randomDelay(500, 1200);
        }
      }

      // Scroll xuống video tiếp theo
      await this.page.keyboard.press('ArrowDown');
      await this.randomDelay(1200, 2500);
    }

    logger.debug(this.platform, 'Warmup xong');
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async _follow(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this._humanMouseMove();
    await this.naturalScroll(1);
    await this.randomDelay(1000, 2000);

    const followBtn = await this.page.$('[data-e2e="follow-button"]');
    if (!followBtn) throw new Error('Không tìm thấy nút Follow');

    const text = await followBtn.innerText();
    if (/following|đang follow/i.test(text)) {
      logger.debug(this.platform, 'Đã follow rồi, bỏ qua');
      return;
    }

    await followBtn.hover();
    await this.randomDelay(400, 1000);
    await followBtn.click();
    await this.randomDelay(1500, 3000);

    logger.info(this.platform, `Đã follow: ${profileUrl}`);
  }

  async _likeVideos(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this.naturalScroll(1);

    // Like 2–4 video trong 1 session
    const likeCount  = 2 + Math.floor(Math.random() * 3);
    const videoUrls  = await this._collectVideoUrls(likeCount + 2);
    let successCount = 0;

    for (let i = 0; i < Math.min(likeCount, videoUrls.length); i++) {
      await this.page.goto(videoUrls[i], { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 4000);

      // Xem video trước khi like (5–15 giây)
      await this.randomDelay(5000, 15000);
      await this._humanMouseMove();

      const likeBtn = await this.page.$('[data-e2e="like-icon"]');
      if (!likeBtn) continue;

      await likeBtn.hover();
      await this.randomDelay(400, 900);
      await likeBtn.click();
      await this.randomDelay(1500, 3500);

      successCount++;
      if (i < likeCount - 1) await this.randomDelay(4000, 9000);
    }

    logger.info(this.platform, `Đã like ${successCount} video từ: ${profileUrl}`);
  }

  async _commentVideo(profileUrl) {
    const videoUrls = await this._navigateAndCollectVideos(profileUrl, 4);
    if (videoUrls.length === 0) throw new Error('Không tìm thấy video');

    const videoUrl = videoUrls[Math.floor(Math.random() * videoUrls.length)];
    await this.page.goto(videoUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2500, 5000);

    // Xem video trước khi comment (10–25 giây)
    await this.randomDelay(10000, 25000);
    await this._humanMouseMove();

    // Mở phần comment nếu cần
    const commentIcon = await this.page.$('[data-e2e="comment-icon"]');
    if (commentIcon) {
      await commentIcon.click();
      await this.randomDelay(1000, 2000);
    }

    const selectors = [
      '[data-e2e="comment-input"]',
      '[contenteditable][placeholder*="comment" i]',
      'div[role="textbox"]',
    ];

    let commentField = null;
    for (const sel of selectors) {
      commentField = await this.page.$(sel);
      if (commentField) break;
    }
    if (!commentField) throw new Error('Không tìm thấy ô comment');

    const text = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    await commentField.hover();
    await this.randomDelay(400, 900);
    await commentField.click();
    await this.randomDelay(600, 1400);
    await this._humanTypeWithMistake(text);
    await this.randomDelay(800, 2000);

    // Submit bằng button hoặc Enter
    const submitBtn = await this.page.$('[data-e2e="comment-submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await this.page.keyboard.press('Enter');
    }
    await this.randomDelay(1200, 2500);

    logger.info(this.platform, `Đã comment: "${text}"`);
  }

  async _viewVideos(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this.naturalScroll(1);

    // Xem 3–6 video trong 1 session, mỗi video 10–45 giây
    const viewCount  = 3 + Math.floor(Math.random() * 4);
    const videoUrls  = await this._collectVideoUrls(viewCount + 3);
    let successCount = 0;

    for (let i = 0; i < Math.min(viewCount, videoUrls.length); i++) {
      await this.page.goto(videoUrls[i], { waitUntil: 'domcontentloaded' });
      await this.randomDelay(1500, 3000);

      const watchMs = 10000 + Math.random() * 35000;
      await this._watchVideo(watchMs);

      successCount++;
      if (i < viewCount - 1) await this.randomDelay(2000, 5000);
    }

    logger.info(this.platform, `Đã xem ${successCount} video từ: ${profileUrl}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  // Giả lập xem video: di chuột lẻ tẻ trong thời gian watchMs
  async _watchVideo(watchMs) {
    const end = Date.now() + watchMs;
    while (Date.now() < end) {
      await this._humanMouseMove();
      await this.randomDelay(3000, 7000);
    }
  }

  async _navigateAndCollectVideos(profileUrl, count) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this.naturalScroll(1);
    return this._collectVideoUrls(count);
  }

  async _collectVideoUrls(count) {
    const links = await this.page.$$('a[href*="/video/"]');
    const urls  = [];
    for (const link of [...links].sort(() => Math.random() - 0.5)) {
      if (urls.length >= count) break;
      const href = await link.getAttribute('href');
      if (href && !urls.includes(href)) {
        urls.push(href.startsWith('http') ? href : `https://www.tiktok.com${href}`);
      }
    }
    return urls;
  }

  async _dismissPopups() {
    const selectors = [
      'button:text("Accept all")',
      'button:text("Accept All")',
      '[data-e2e="modal-close-inner-button"]',
      '[aria-label="Close"]',
      'button:text("Skip")',
      'button:text("Later")',
    ];
    for (const sel of selectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn) { await btn.click(); await this.randomDelay(500, 1000); }
      } catch {}
    }
  }
}
