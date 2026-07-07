import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || './data/traffic.db';

let _db = null;

export function getDb() {
  if (_db) return _db;

  mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    -- Tài khoản mạng xã hội (cả chính lẫn con)
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      platform    TEXT NOT NULL,          -- pinterest | instagram | tiktok | youtube | twitter | facebook
      username    TEXT NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT DEFAULT 'sub',     -- main | sub
      proxy_id    TEXT,                   -- FK -> proxies.id
      status      TEXT DEFAULT 'idle',    -- idle | running | banned | error
      session_path TEXT,                  -- đường dẫn file cookie/session
      daily_counts TEXT DEFAULT '{}',     -- JSON: { "like": 5, "follow": 3, ... }
      last_reset  TEXT,                   -- ngày reset daily_counts (YYYY-MM-DD)
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (proxy_id) REFERENCES proxies(id)
    );

    -- Proxy pool
    CREATE TABLE IF NOT EXISTS proxies (
      id          TEXT PRIMARY KEY,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL,
      username    TEXT,
      password    TEXT,
      protocol    TEXT DEFAULT 'http',    -- http | socks5
      type        TEXT DEFAULT 'static',  -- static | rotating | mobile
      status      TEXT DEFAULT 'active',  -- active | dead | slow
      last_check  TEXT,
      latency_ms  INTEGER,
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Chiến dịch buff
    CREATE TABLE IF NOT EXISTS campaigns (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      platform      TEXT NOT NULL,
      target_account TEXT NOT NULL,       -- username tài khoản chính cần buff
      target_url    TEXT,                 -- URL post/profile cụ thể (nếu có)
      actions       TEXT NOT NULL,        -- JSON: ["like", "follow", "repin"]
      schedule      TEXT DEFAULT 'auto',  -- auto | cron expression
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Liên kết account con vào campaign
    CREATE TABLE IF NOT EXISTS campaign_accounts (
      campaign_id TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      PRIMARY KEY (campaign_id, account_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id)  REFERENCES accounts(id)  ON DELETE CASCADE
    );

    -- Hàng đợi tasks
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      campaign_id TEXT,
      account_id  TEXT NOT NULL,
      platform    TEXT NOT NULL,
      action      TEXT NOT NULL,          -- like | follow | repin | comment | view ...
      target_url  TEXT NOT NULL,
      status      TEXT DEFAULT 'pending', -- pending | running | done | failed | skipped
      attempts    INTEGER DEFAULT 0,
      error       TEXT,
      scheduled_at TEXT,
      started_at  TEXT,
      finished_at TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id)  REFERENCES accounts(id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    -- Log mọi hành động
    CREATE TABLE IF NOT EXISTS logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      level       TEXT NOT NULL,          -- info | warn | error | debug
      module      TEXT,
      message     TEXT NOT NULL,
      meta        TEXT,                   -- JSON extra info
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Index để query nhanh
    CREATE INDEX IF NOT EXISTS idx_accounts_platform  ON accounts(platform);
    CREATE INDEX IF NOT EXISTS idx_accounts_status    ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_account      ON tasks(account_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled    ON tasks(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created       ON logs(created_at);
  `);
}
