import { BaseWorker } from './base.worker.js';
import { logger } from '../utils/logger.js';

const COMMENTS = [
  '❤️',
  '🔥🔥',
  'Love this!',
  'Amazing! 😍',
  'So beautiful!',
  '✨✨✨',
  'Great content!',
  'Stunning 😊',
  'Absolutely love it!',
  '💯',
  'This is everything! 🙌',
  'Gorgeous 😍❤️',
];

export class InstagramWorker extends BaseWorker {
  constructor() {
    super('instagram');
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(account) {
    await this.page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this._dismissPopups();

    await this._humanMouseMove();
    await this.humanType('input[name="username"]', account.username);
    await this.randomDelay(600, 1500);
    await this.humanType('input[name="password"]', account.password);
    await this.randomDelay(700, 1400);

    await this._humanMouseMove();
    await this.page.click('button[type="submit"]');
    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await this.randomDelay(2500, 5000);

    const url = this.page.url();
    if (url.includes('/login') || url.includes('/challenge') || url.includes('/suspicious')) {
      throw new Error('Đăng nhập Instagram thất bại — sai thông tin hoặc bị checkpoint');
    }

    await this._dismissPopups();
    logger.info(this.platform, `Đăng nhập thành công: ${account.username}`);
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute({ accountId, action, targetUrl }) {
    await this._warmup();

    switch (action) {
      case 'follow':     return this._follow(targetUrl);
      case 'unfollow':   return this._unfollow(targetUrl);
      case 'like':       return this._likePosts(targetUrl);
      case 'comment':    return this._commentPost(targetUrl);
      case 'story_view': return this._viewStories(targetUrl);
      default:
        throw new Error(`Instagram: action không hỗ trợ — "${action}"`);
    }
  }

  // ─── Warmup ───────────────────────────────────────────────────────────────

  async _warmup() {
    logger.debug(this.platform, 'Warmup — duyệt home feed...');
    await this.page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this._dismissPopups();

    const scrollCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < scrollCount; i++) {
      await this.naturalScroll(1);

      if (Math.random() > 0.5) await this._humanMouseMove();

      // 25% cơ hội dừng lại xem 1 post
      if (Math.random() > 0.75) {
        const posts = await this.page.$$('article a[href*="/p/"]');
        if (posts.length > 0) {
          const post = posts[Math.floor(Math.random() * Math.min(posts.length, 5))];
          await post.hover().catch(() => {});
          await this.randomDelay(2000, 5000);
        }
      }
    }

    logger.debug(this.platform, 'Warmup xong');
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async _follow(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this._humanMouseMove();
    await this.naturalScroll(1);

    const followBtn = await this._findFollowButton();
    if (!followBtn) throw new Error('Không tìm thấy nút Follow');

    const text = await followBtn.innerText();
    if (/following|requested/i.test(text)) {
      logger.debug(this.platform, 'Đã follow rồi, bỏ qua');
      return;
    }

    await followBtn.hover();
    await this.randomDelay(500, 1200);
    await followBtn.click();
    await this.randomDelay(1500, 3000);

    logger.info(this.platform, `Đã follow: ${profileUrl}`);
  }

  async _unfollow(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);

    const followBtn = await this._findFollowButton();
    if (!followBtn) throw new Error('Không tìm thấy nút Follow/Following');

    const text = await followBtn.innerText();
    if (!/following/i.test(text)) {
      logger.debug(this.platform, 'Không đang follow, bỏ qua');
      return;
    }

    await followBtn.click();
    await this.randomDelay(1000, 2000);

    // Confirm dialog "Unfollow?"
    const confirmBtn = await this.page.$('button:text("Unfollow")');
    if (confirmBtn) {
      await this.randomDelay(500, 1000);
      await confirmBtn.click();
    }
    await this.randomDelay(1500, 3000);

    logger.info(this.platform, `Đã unfollow: ${profileUrl}`);
  }

  async _likePosts(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4500);
    await this.naturalScroll(1);

    // Like 2–3 post trong 1 session
    const likeCount = 2 + Math.floor(Math.random() * 2);
    const postUrls  = await this._collectPostUrls(likeCount + 2);
    let successCount = 0;

    for (let i = 0; i < Math.min(likeCount, postUrls.length); i++) {
      await this.page.goto(postUrls[i], { waitUntil: 'domcontentloaded' });
      await this.randomDelay(2000, 4000);
      await this._humanMouseMove();

      // Xem post 1 chút trước khi like
      await this.randomDelay(2000, 5000);

      const likeBtn = await this.page.$('svg[aria-label="Like"]');
      if (!likeBtn) continue;

      // Kiểm tra đã like chưa (Unlike = đã like rồi)
      const unlikeBtn = await this.page.$('svg[aria-label="Unlike"]');
      if (unlikeBtn) {
        logger.debug(this.platform, 'Post đã được like, bỏ qua');
        continue;
      }

      await likeBtn.hover();
      await this.randomDelay(400, 900);
      await likeBtn.click();
      await this.randomDelay(1500, 3500);

      successCount++;
      if (i < likeCount - 1) await this.randomDelay(4000, 9000);
    }

    logger.info(this.platform, `Đã like ${successCount} bài từ: ${profileUrl}`);
  }

  async _commentPost(profileUrl) {
    const postUrls = await this._navigateAndCollectPosts(profileUrl, 4);
    if (postUrls.length === 0) throw new Error('Không tìm thấy bài post');

    const postUrl = postUrls[Math.floor(Math.random() * postUrls.length)];
    await this.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2500, 5000);

    // Xem post trước khi comment
    await this.randomDelay(3000, 7000);
    await this._humanMouseMove();

    const selectors = [
      'textarea[aria-label*="comment" i]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="Add a comment" i]',
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
    await this.page.keyboard.press('Enter');
    await this.randomDelay(1200, 2500);

    logger.info(this.platform, `Đã comment: "${text}"`);
  }

  async _viewStories(profileUrl) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);

    // Click vào story ring (vòng tròn quanh avatar)
    const storyRing = await this.page.$('header img[data-testid], header canvas, header img');
    if (!storyRing) {
      logger.debug(this.platform, 'Không có story để xem');
      return;
    }

    await storyRing.click();
    await this.randomDelay(2000, 4000);

    // Xem 2–5 stories, mỗi cái dừng 3–8 giây
    const viewCount = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < viewCount; i++) {
      await this.randomDelay(3000, 8000); // "xem" story
      await this._humanMouseMove();

      const nextBtn = await this.page.$('[aria-label="Next"]');
      if (!nextBtn) break;
      await nextBtn.click();
      await this.randomDelay(500, 1200);
    }

    logger.info(this.platform, `Đã xem stories từ: ${profileUrl}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async _findFollowButton() {
    // Instagram thay đổi selector liên tục — thử từ cụ thể đến tổng quát
    const selectors = [
      'header section div:first-child > div > button',
      'header button:not([aria-label])',
      'header section button',
    ];
    for (const sel of selectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn) return btn;
      } catch {}
    }
    return null;
  }

  async _navigateAndCollectPosts(profileUrl, count) {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await this.randomDelay(2000, 4000);
    await this.naturalScroll(1);
    return this._collectPostUrls(count);
  }

  async _collectPostUrls(count) {
    const links = await this.page.$$('article a[href*="/p/"], main a[href*="/p/"]');
    const urls  = [];
    for (const link of [...links].sort(() => Math.random() - 0.5)) {
      if (urls.length >= count) break;
      const href = await link.getAttribute('href');
      if (href && !urls.includes(href)) {
        urls.push(href.startsWith('http') ? href : `https://www.instagram.com${href}`);
      }
    }
    return urls;
  }

  async _dismissPopups() {
    const selectors = [
      'button:text("Accept All")',
      'button:text("Allow essential and optional cookies")',
      'button:text("Not Now")',
      'button:text("Not now")',
      'button:text("Skip")',
      '[aria-label="Close"]',
    ];
    for (const sel of selectors) {
      try {
        const btn = await this.page.$(sel);
        if (btn) { await btn.click(); await this.randomDelay(500, 1000); }
      } catch {}
    }
  }
}
