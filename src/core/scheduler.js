import { randomUUID } from 'crypto';
import { CronJob } from 'cron';
import { getDb } from '../db/schema.js';
import { enqueueTask, reEnqueueTask } from './queue.js';
import { logger } from '../utils/logger.js';
import { notify } from '../utils/notify.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const limits = JSON.parse(readFileSync(path.join(__dirname, '../../config/limits.json'), 'utf8'));

function buildTargetUrl(platform, username) {
  if (platform === 'instagram') return `https://www.instagram.com/${username}/`;
  if (platform === 'tiktok')    return `https://www.tiktok.com/@${username}`;
  if (platform === 'twitter')   return `https://twitter.com/${username}`;
  if (platform === 'facebook')  return `https://www.facebook.com/${username}`;
  if (platform === 'youtube')   return `https://www.youtube.com/@${username}`;
  return `https://www.pinterest.com/${username}/`;
}

export function shouldScheduleAction(action, rng = Math.random) {
  if (action === 'repin' || action === 'comment') return rng() < 0.5;
  return true;
}

export class Scheduler {
  constructor() {
    this.db            = getDb();
    this._midnightJob  = null;
    this._summaryJob   = null;
    this._proxyJob     = null;
    this._campaignJobs = new Map(); // campaignId -> CronJob
  }

  // ─── Khởi động ──────────────────────────────────────────────────────────────

  async startAll() {
    await this.scheduleDay();
    await this.resumePending();
    this._setupCampaignCrons();

    // Nửa đêm: cleanup + reset errors + schedule auto campaigns
    this._midnightJob = new CronJob('1 0 * * *', async () => {
      logger.info('Scheduler', 'Midnight — cleanup + scheduling...');
      await this._midnightCleanup();
      await this.scheduleDay();
    }, null, true, 'Asia/Ho_Chi_Minh');

    // 8h sáng: gửi báo cáo ngày hôm qua
    this._summaryJob = new CronJob('0 8 * * *', () => this._sendDailySummary(), null, true, 'Asia/Ho_Chi_Minh');

    // Chủ nhật 2h sáng: kiểm tra health tất cả proxies
    this._proxyJob = new CronJob('0 2 * * 0', async () => {
      logger.info('Scheduler', 'Weekly proxy health check...');
      const { proxyManager } = await import('./proxyManager.js');
      const alive = await proxyManager.testAll();
      const total = proxyManager.getStats().total;
      await notify(`🔌 <b>Proxy Health Check</b>\n${alive}/${total} proxy còn sống`);
    }, null, true, 'Asia/Ho_Chi_Minh');

    logger.info('Scheduler', 'Scheduler started (auto + custom campaign crons + weekly proxy check)');
  }

  stopAll() {
    this._midnightJob?.stop();
    this._summaryJob?.stop();
    this._proxyJob?.stop();
    for (const job of this._campaignJobs.values()) job.stop();
    this._campaignJobs.clear();
    logger.info('Scheduler', 'Scheduler stopped');
  }

  // ─── Midnight cleanup ────────────────────────────────────────────────────────

  async _midnightCleanup() {
    // Reset tài khoản lỗi tạm thời (mạng, timeout) về idle
    const resetCount = this.db.prepare(
      "UPDATE accounts SET status='idle', updated_at=datetime('now') WHERE status='error'"
    ).run().changes;
    if (resetCount > 0) logger.info('Scheduler', `Midnight: reset ${resetCount} error accounts → idle`);

    // Xóa logs cũ hơn 30 ngày
    const deletedLogs = this.db.prepare(
      "DELETE FROM logs WHERE created_at < datetime('now', '-30 days')"
    ).run().changes;
    if (deletedLogs > 0) logger.info('Scheduler', `Midnight: xóa ${deletedLogs} log entries cũ`);

    // Xóa tasks done/failed cũ hơn 90 ngày
    const deletedTasks = this.db.prepare(
      "DELETE FROM tasks WHERE status IN ('done','failed') AND created_at < datetime('now', '-90 days')"
    ).run().changes;
    if (deletedTasks > 0) logger.info('Scheduler', `Midnight: xóa ${deletedTasks} tasks cũ`);
  }

  // ─── Báo cáo hàng ngày ──────────────────────────────────────────────────────

  async _sendDailySummary() {
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const done    = this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='done'   AND DATE(finished_at)=?").get(yesterday).c;
      const failed  = this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='failed' AND DATE(finished_at)=?").get(yesterday).c;
      const banned  = this.db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status='banned'").get().c;
      const idle    = this.db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status='idle'").get().c;
      const active  = this.db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE is_active=1").get().c;

      const successRate = (done + failed) > 0 ? Math.round(done / (done + failed) * 100) : 100;
      const msg =
        `📊 <b>Báo cáo ngày ${yesterday}</b>\n\n` +
        `✅ Tasks xong: <b>${done}</b>\n` +
        `❌ Tasks lỗi: <b>${failed}</b>  (${successRate}% thành công)\n` +
        `🔄 Accounts active: <b>${idle}</b>\n` +
        `🚫 Accounts bị ban: <b>${banned}</b>\n` +
        `📋 Campaigns đang chạy: <b>${active}</b>`;

      await notify(msg);
      logger.info('Scheduler', `Daily summary sent (${done} done, ${failed} failed)`);
    } catch (err) {
      logger.warn('Scheduler', `Daily summary failed: ${err.message}`);
    }
  }

  // ─── Per-campaign custom crons ───────────────────────────────────────────────

  _setupCampaignCrons() {
    const campaigns = this.db.prepare("SELECT * FROM campaigns WHERE is_active=1 AND schedule!='auto'").all();
    for (const c of campaigns) this._addCampaignCron(c);
    if (campaigns.length > 0)
      logger.info('Scheduler', `Setup ${campaigns.length} custom campaign crons`);
  }

  _addCampaignCron(campaign) {
    if (!campaign || campaign.schedule === 'auto') return;
    this.removeCampaignCron(campaign.id); // xóa cron cũ nếu có
    try {
      const job = new CronJob(campaign.schedule, () => {
        logger.info('Scheduler', `Campaign cron fired: "${campaign.name}"`);
        this.scheduleCampaign(campaign.id);
      }, null, true, 'Asia/Ho_Chi_Minh');
      this._campaignJobs.set(campaign.id, job);
    } catch {
      logger.warn('Scheduler', `Invalid cron expression for campaign "${campaign.name}": ${campaign.schedule}`);
    }
  }

  removeCampaignCron(campaignId) {
    const job = this._campaignJobs.get(campaignId);
    if (job) { job.stop(); this._campaignJobs.delete(campaignId); }
  }

  // ─── Schedule 1 campaign cụ thể ─────────────────────────────────────────────

  async scheduleCampaign(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
    if (!campaign?.is_active) return 0;

    const today          = new Date().toISOString().slice(0, 10);
    const platform       = campaign.platform;
    const platformLimits = limits[platform] || {};
    const [fromHour, toHour] = platformLimits.activeHours || [7, 23];
    const actions   = JSON.parse(campaign.actions);
    const targetUrl = campaign.target_url || buildTargetUrl(platform, campaign.target_account);

    const accounts = this._resolveCampaignAccounts(campaign, ['banned', 'error']);

    let totalScheduled = 0;

    for (const account of accounts) {
      const already = this.db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE account_id=? AND campaign_id=? AND DATE(scheduled_at)=?
      `).get(account.id, campaignId, today);
      if (already.c > 0) continue;

      // 75% chance có hoạt động hôm nay
      if (Math.random() > 0.75) continue;

      for (const action of actions) {
        if (!platformLimits[action]) continue;
        if (!shouldScheduleAction(action)) continue;
        // follow luon dung profile URL — khong dung pin URL (campaign.target_url)
        const actionUrl = action === 'follow'
          ? buildTargetUrl(platform, campaign.target_account)
          : targetUrl;
        const times = this._distributeInWindow(1, fromHour, toHour);
        for (const scheduledAt of times) {
          const delayMs = scheduledAt - Date.now();
          if (delayMs < 0) continue;
          const taskId = randomUUID();
          this.db.prepare(`
            INSERT INTO tasks (id, campaign_id, account_id, platform, action, target_url, status, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
          `).run(taskId, campaignId, account.id, platform, action, actionUrl, new Date(scheduledAt).toISOString());
          await enqueueTask({ taskId, campaignId, accountId: account.id, platform, action, targetUrl: actionUrl, delayMs });
          totalScheduled++;
        }
      }
    }
    return totalScheduled;
  }

  // ─── Schedule tất cả campaign có schedule='auto' ────────────────────────────

  async scheduleDay() {
    const campaigns = this.db.prepare("SELECT * FROM campaigns WHERE is_active=1 AND schedule='auto'").all();
    let total = 0;
    for (const c of campaigns) total += await this.scheduleCampaign(c.id);

    if (total > 0) logger.info('Scheduler', `scheduleDay() — scheduled ${total} tasks`);
    else           logger.info('Scheduler', 'scheduleDay() — all auto accounts already scheduled');
    return total;
  }

  // ─── Resume pending tasks sau khi Redis restart ──────────────────────────────

  async resumePending() {
    const now     = new Date().toISOString();
    const pending = this.db.prepare("SELECT * FROM tasks WHERE status='pending' AND scheduled_at > ?").all(now);
    if (!pending.length) { logger.info('Scheduler', 'Resume: no tasks to recover'); return 0; }

    for (const task of pending) {
      const delayMs = Math.max(0, new Date(task.scheduled_at) - Date.now());
      await reEnqueueTask({
        taskId: task.id, accountId: task.account_id, platform: task.platform,
        action: task.action, targetUrl: task.target_url, delayMs,
      });
    }
    logger.info('Scheduler', `Resume: recovered ${pending.length} tasks into BullMQ`);
    return pending.length;
  }

  // ─── Trigger campaign ngay lập tức ──────────────────────────────────────────

  async triggerNow(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const today     = new Date().toISOString().slice(0, 10);
    const actions   = JSON.parse(campaign.actions);
    const targetUrl = campaign.target_url || buildTargetUrl(campaign.platform, campaign.target_account);
    const accounts  = this._resolveCampaignAccounts(campaign, ['banned']);

    let count = 0;
    for (const account of accounts) {
      const already = this.db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE account_id=? AND campaign_id=? AND DATE(scheduled_at)=?
      `).get(account.id, campaignId, today);
      if (already.c > 0) continue;

      for (const action of actions) {
        // follow luon dung profile URL
        const actionUrl = action === 'follow'
          ? buildTargetUrl(campaign.platform, campaign.target_account)
          : targetUrl;
        const taskId = randomUUID();
        this.db.prepare(`
          INSERT INTO tasks (id, campaign_id, account_id, platform, action, target_url, status, scheduled_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).run(taskId, campaignId, account.id, campaign.platform, action, actionUrl);
        await enqueueTask({ taskId, campaignId, accountId: account.id, platform: campaign.platform, action, targetUrl: actionUrl, delayMs: count * 5000 });
        count++;
      }
    }
    logger.info('Scheduler', `triggerNow: enqueued ${count} tasks for campaign "${campaign.name}"`);
    return count;
  }

  // ─── Resolve accounts cho 1 campaign (theo account_scope) ──────────────────
  // account_scope='all': luôn lấy toàn bộ account platform/sub hiện có (bao gồm account mới thêm sau)
  // account_scope='selected': dùng danh sách cố định trong campaign_accounts
  _resolveCampaignAccounts(campaign, excludeStatuses) {
    const placeholders = excludeStatuses.map(() => '?').join(',');
    if (campaign.account_scope === 'all') {
      return this.db.prepare(`
        SELECT * FROM accounts
        WHERE platform=? AND role='sub' AND status NOT IN (${placeholders})
      `).all(campaign.platform, ...excludeStatuses);
    }
    return this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN campaign_accounts ca ON ca.account_id = a.id
      WHERE ca.campaign_id = ? AND a.status NOT IN (${placeholders})
    `).all(campaign.id, ...excludeStatuses);
  }

  // ─── Campaign management ─────────────────────────────────────────────────────

  createCampaign({ name, platform, targetAccount, targetUrl, actions, schedule = 'auto', accountIds = [] }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO campaigns (id, name, platform, target_account, target_url, actions, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, platform, targetAccount, targetUrl || null, JSON.stringify(actions), schedule);

    if (accountIds.length > 0) {
      const ins = this.db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
      const tx  = this.db.transaction(() => accountIds.forEach(aid => ins.run(id, aid)));
      tx();
    }

    // Tạo cron nếu schedule tùy chỉnh
    if (schedule !== 'auto') {
      const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
      this._addCampaignCron(campaign);
    }

    logger.info('Scheduler', `Created campaign "${name}" [${platform}] with ${accountIds.length} accounts`);
    return id;
  }

  addAccountsToCampaign(campaignId, accountIds) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
    const tx  = this.db.transaction(() => accountIds.forEach(aid => ins.run(campaignId, aid)));
    tx();
  }

  getStats() {
    return {
      activeCampaigns: this.db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE is_active=1").get().c,
      totalCampaigns:  this.db.prepare("SELECT COUNT(*) as c FROM campaigns").get().c,
      pendingTasks:    this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='pending'").get().c,
      doneTasks:       this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='done'").get().c,
      failedTasks:     this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='failed'").get().c,
    };
  }

  _distributeInWindow(count, fromHour, toHour) {
    const today  = new Date();
    const baseMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const fromMs = baseMs + fromHour * 3_600_000;
    const toMs   = baseMs + toHour   * 3_600_000;
    const slotMs = (toMs - fromMs) / count;
    return Array.from({ length: count }, (_, i) => fromMs + i * slotMs + Math.random() * slotMs);
  }
}

export const scheduler = new Scheduler();

