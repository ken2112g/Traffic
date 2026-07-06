import { randomUUID } from 'crypto';
import { CronJob } from 'cron';
import { getDb } from '../db/schema.js';
import { enqueueTask, reEnqueueTask } from './queue.js';
import { logger } from '../utils/logger.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const limits = JSON.parse(readFileSync(path.join(__dirname, '../../config/limits.json'), 'utf8'));

// Build a sensible profile URL when campaign has no explicit target_url
function buildTargetUrl(platform, username) {
  if (platform === 'instagram') return `https://www.instagram.com/${username}/`;
  if (platform === 'tiktok')    return `https://www.tiktok.com/@${username}`;
  if (platform === 'twitter')   return `https://twitter.com/${username}`;
  if (platform === 'facebook')  return `https://www.facebook.com/${username}`;
  if (platform === 'youtube')   return `https://www.youtube.com/@${username}`;
  return `https://www.pinterest.com/${username}/`;
}

export class Scheduler {
  constructor() {
    this.db = getDb();
    this._midnightJob = null;
  }

  async startAll() {
    await this.scheduleDay();
    await this.resumePending();

    this._midnightJob = new CronJob(
      '1 0 * * *',
      () => { logger.info('Scheduler', 'Midnight -- scheduling new day...'); this.scheduleDay(); },
      null, true, 'Asia/Ho_Chi_Minh'
    );

    logger.info('Scheduler', 'Scheduler started');
  }

  stopAll() {
    this._midnightJob?.stop();
    logger.info('Scheduler', 'Scheduler stopped');
  }

  async scheduleDay() {
    const today = new Date().toISOString().slice(0, 10);
    const campaigns = this.db.prepare('SELECT * FROM campaigns WHERE is_active = 1').all();

    let totalScheduled = 0;

    for (const campaign of campaigns) {
      const platform       = campaign.platform;
      const platformLimits = limits[platform] || {};
      const [fromHour, toHour] = platformLimits.activeHours || [7, 23];
      const actions        = JSON.parse(campaign.actions);
      const targetUrl      = campaign.target_url || buildTargetUrl(platform, campaign.target_account);

      const accounts = this.db.prepare(`
        SELECT a.* FROM accounts a
        INNER JOIN campaign_accounts ca ON ca.account_id = a.id
        WHERE ca.campaign_id = ? AND a.status NOT IN ('banned', 'error')
      `).all(campaign.id);

      for (const account of accounts) {
        const alreadyScheduled = this.db.prepare(`
          SELECT COUNT(*) as c FROM tasks
          WHERE account_id = ? AND campaign_id = ? AND DATE(scheduled_at) = ? AND status = 'pending'
        `).get(account.id, campaign.id, today);

        if (alreadyScheduled.c > 0) continue;

        // 75% chance account is active today
        if (Math.random() > 0.75) {
          logger.debug('Scheduler', `[${account.username}] skipping today`);
          continue;
        }

        for (const action of actions) {
          if (!platformLimits[action]) continue;

          const times = this._distributeInWindow(1, fromHour, toHour);

          for (const scheduledAt of times) {
            const delayMs = scheduledAt - Date.now();
            if (delayMs < 0) continue;

            const taskId = randomUUID();
            this.db.prepare(`
              INSERT INTO tasks (id, campaign_id, account_id, platform, action, target_url, status, scheduled_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            `).run(taskId, campaign.id, account.id, platform, action, targetUrl,
                   new Date(scheduledAt).toISOString());

            await enqueueTask({ taskId, campaignId: campaign.id, accountId: account.id, platform, action, targetUrl, delayMs });
            totalScheduled++;
          }
        }
      }
    }

    if (totalScheduled > 0) {
      logger.info('Scheduler', `scheduleDay() -- scheduled ${totalScheduled} tasks`);
    } else {
      logger.info('Scheduler', 'scheduleDay() -- all accounts already scheduled');
    }
    return totalScheduled;
  }

  async resumePending() {
    const now = new Date().toISOString();
    const pending = this.db.prepare(`
      SELECT * FROM tasks WHERE status = 'pending' AND scheduled_at > ?
    `).all(now);

    if (pending.length === 0) {
      logger.info('Scheduler', 'Resume: no tasks to recover');
      return 0;
    }

    for (const task of pending) {
      const delayMs = Math.max(0, new Date(task.scheduled_at) - Date.now());
      await reEnqueueTask({
        taskId:    task.id,
        accountId: task.account_id,
        platform:  task.platform,
        action:    task.action,
        targetUrl: task.target_url,
        delayMs,
      });
    }

    logger.info('Scheduler', `Resume: recovered ${pending.length} tasks into BullMQ`);
    return pending.length;
  }

  async triggerNow(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const actions   = JSON.parse(campaign.actions);
    const targetUrl = campaign.target_url || buildTargetUrl(campaign.platform, campaign.target_account);

    const accounts = this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN campaign_accounts ca ON ca.account_id = a.id
      WHERE ca.campaign_id = ? AND a.status != 'banned'
    `).all(campaign.id);

    let count = 0;
    for (const account of accounts) {
      for (const action of actions) {
        const taskId = randomUUID();
        this.db.prepare(`
          INSERT INTO tasks (id, campaign_id, account_id, platform, action, target_url, status, scheduled_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).run(taskId, campaign.id, account.id, campaign.platform, action, targetUrl);

        await enqueueTask({
          taskId, campaignId: campaign.id, accountId: account.id,
          platform: campaign.platform, action, targetUrl, delayMs: count * 5000,
        });
        count++;
      }
    }

    logger.info('Scheduler', `triggerNow: enqueued ${count} tasks for campaign "${campaign.name}"`);
    return count;
  }

  createCampaign({ name, platform, targetAccount, targetUrl, actions, schedule = 'auto', accountIds = [] }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO campaigns (id, name, platform, target_account, target_url, actions, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, platform, targetAccount, targetUrl || null, JSON.stringify(actions), schedule);

    if (accountIds.length > 0) {
      const insert = this.db.prepare('INSERT INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
      const tx = this.db.transaction(() => accountIds.forEach(aid => insert.run(id, aid)));
      tx();
    }

    logger.info('Scheduler', `Created campaign "${name}" [${platform}] with ${accountIds.length} accounts`);
    return id;
  }

  addAccountsToCampaign(campaignId, accountIds) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
    const tx = this.db.transaction(() => accountIds.forEach(aid => insert.run(campaignId, aid)));
    tx();
  }

  getStats() {
    return {
      activeCampaigns: this.db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE is_active = 1').get().c,
      totalCampaigns:  this.db.prepare('SELECT COUNT(*) as c FROM campaigns').get().c,
      pendingTasks:    this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "pending"').get().c,
      doneTasks:       this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "done"').get().c,
      failedTasks:     this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "failed"').get().c,
    };
  }

  _distributeInWindow(count, fromHour, toHour) {
    const today  = new Date();
    const baseMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const fromMs = baseMs + fromHour * 3_600_000;
    const toMs   = baseMs + toHour   * 3_600_000;
    const slotMs = (toMs - fromMs) / count;

    return Array.from({ length: count }, (_, i) =>
      fromMs + i * slotMs + Math.random() * slotMs
    );
  }
}

export const scheduler = new Scheduler();