import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const limits = JSON.parse(readFileSync(path.join(__dirname, '../../config/limits.json'), 'utf8'));

const SESSION_DIR = process.env.SESSION_DIR || './sessions';

export class AccountManager {
  constructor() {
    this.db = getDb();
    if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  addAccount({ platform, username, password, role = 'sub', notes = '' }) {
    const id = randomUUID();
    const sessionPath = path.join(SESSION_DIR, `${platform}_${username}.json`);

    this.db.prepare(`
      INSERT INTO accounts (id, platform, username, password, role, session_path, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, platform, username, password, role, sessionPath, notes);

    logger.info('AccountManager', `Thêm account [${platform}] ${username} (${role})`);
    return id;
  }

  addAccountsBulk(accounts) {
    const insert = this.db.prepare(`
      INSERT INTO accounts (id, platform, username, password, role, session_path, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const ids = [];
    const tx = this.db.transaction(() => {
      for (const acc of accounts) {
        const id = randomUUID();
        const sessionPath = path.join(SESSION_DIR, `${acc.platform}_${acc.username}.json`);
        insert.run(id, acc.platform, acc.username, acc.password, acc.role || 'sub', sessionPath, acc.notes || '');
        ids.push(id);
      }
    });
    tx();
    logger.info('AccountManager', `Thêm bulk ${accounts.length} accounts`);
    return ids;
  }

  getAccount(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  getAccountsByPlatform(platform, role = null) {
    if (role) {
      return this.db.prepare(`SELECT * FROM accounts WHERE platform = ? AND role = ? AND status != 'banned'`).all(platform, role);
    }
    return this.db.prepare(`SELECT * FROM accounts WHERE platform = ? AND status != 'banned'`).all(platform);
  }

  getSubAccounts(platform) {
    return this.getAccountsByPlatform(platform, 'sub');
  }

  getMainAccount(platform) {
    return this.db.prepare(`SELECT * FROM accounts WHERE platform = ? AND role = 'main' LIMIT 1`).get(platform);
  }

  getAllAccounts() {
    return this.db.prepare('SELECT id, platform, username, role, status, proxy_id, last_reset FROM accounts').all();
  }

  setStatus(id, status) {
    this.db.prepare(`UPDATE accounts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  }

  setProxy(accountId, proxyId) {
    this.db.prepare(`UPDATE accounts SET proxy_id = ?, updated_at = datetime('now') WHERE id = ?`).run(proxyId, accountId);
  }

  deleteAccount(id) {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    logger.warn('AccountManager', `Đã xóa account ${id}`);
  }

  // ─── Daily limits ──────────────────────────────────────────────────────────

  getDailyCounts(id) {
    const acc = this.db.prepare('SELECT daily_counts, last_reset FROM accounts WHERE id = ?').get(id);
    if (!acc) return {};

    const today = new Date().toISOString().slice(0, 10);
    if (acc.last_reset !== today) {
      this.db.prepare(`UPDATE accounts SET daily_counts = '{}', last_reset = ? WHERE id = ?`).run(today, id);
      return {};
    }
    try { return JSON.parse(acc.daily_counts); } catch { return {}; }
  }

  incrementAction(id, action) {
    const counts = this.getDailyCounts(id);
    counts[action] = (counts[action] || 0) + 1;
    this.db.prepare('UPDATE accounts SET daily_counts = ? WHERE id = ?').run(JSON.stringify(counts), id);
    return counts[action];
  }

  canDoAction(id, action, platform) {
    const max = limits[platform]?.[action];
    if (!max) return true;
    const counts = this.getDailyCounts(id);
    return (counts[action] || 0) < max;
  }

  // ─── Session / Cookie ──────────────────────────────────────────────────────

  getSessionPath(id) {
    const acc = this.db.prepare('SELECT session_path FROM accounts WHERE id = ?').get(id);
    return acc?.session_path || null;
  }

  hasSession(id) {
    const p = this.getSessionPath(id);
    return p ? existsSync(p) : false;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  getStats() {
    return {
      total:   this.db.prepare('SELECT COUNT(*) as c FROM accounts').get().c,
      active:  this.db.prepare(`SELECT COUNT(*) as c FROM accounts WHERE status = 'idle'`).get().c,
      running: this.db.prepare(`SELECT COUNT(*) as c FROM accounts WHERE status = 'running'`).get().c,
      banned:  this.db.prepare(`SELECT COUNT(*) as c FROM accounts WHERE status = 'banned'`).get().c,
    };
  }
}

export const accountManager = new AccountManager();
