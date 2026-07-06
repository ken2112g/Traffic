#!/usr/bin/env node
/**
 * CLI Admin — quản lý accounts, proxies, campaigns
 * Usage: node scripts/cli.js <command> [--flag value]
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import chalk from 'chalk';
import { randomUUID } from 'crypto';
import { getDb } from '../src/db/schema.js';
import { accountManager } from '../src/core/accountManager.js';
import { proxyManager } from '../src/core/proxyManager.js';

// ─── Arg parser ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const sub = args[1]?.startsWith('--') ? null : args[1];
  const flags = {};
  for (let i = sub ? 2 : 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return { command, sub, flags };
}

function require(flag, flags) {
  if (!flags[flag]) {
    console.error(chalk.red(`Thiếu --${flag}`));
    process.exit(1);
  }
  return flags[flag];
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function table(rows, cols) {
  if (rows.length === 0) { console.log(chalk.gray('  (trống)')); return; }
  const widths = cols.map(c => Math.max(c.label.length, ...rows.map(r => String(r[c.key] ?? '').length)));
  const header = cols.map((c, i) => c.label.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '─'.repeat(w)).join('──');
  console.log(chalk.bold(header));
  console.log(chalk.gray(sep));
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c.key] ?? '').padEnd(widths[i])).join('  '));
  }
  console.log(chalk.gray(`\n${rows.length} dòng`));
}

function ok(msg)   { console.log(chalk.green('✓ ') + msg); }
function warn(msg) { console.log(chalk.yellow('⚠ ') + msg); }
function err(msg)  { console.error(chalk.red('✗ ') + msg); }

// ─── Commands ────────────────────────────────────────────────────────────────

const commands = {

  // ── add-account ────────────────────────────────────────────────────────────
  'add-account'(flags) {
    const platform = require('platform', flags);
    const username = require('username', flags);
    const password = require('password', flags);
    const role     = flags.role || 'sub';
    const notes    = flags.notes || '';

    const id = accountManager.addAccount({ platform, username, password, role, notes });
    ok(`Thêm account [${platform}] ${username} (${role}) — ID: ${id}`);
  },

  // ── add-bulk ───────────────────────────────────────────────────────────────
  // File CSV: platform,username,password,role   (header tùy chọn)
  // File TXT: username:password  (cần --platform)
  'add-bulk'(flags) {
    const file = require('file', flags);
    if (!existsSync(file)) { err(`File không tồn tại: ${file}`); process.exit(1); }

    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const accounts = [];

    for (const line of lines) {
      // Bỏ qua header nếu có
      if (/^platform/i.test(line)) continue;

      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 3) {
        // CSV: platform,username,password[,role]
        accounts.push({ platform: parts[0], username: parts[1], password: parts[2], role: parts[3] || 'sub' });
      } else {
        // TXT: username:password (cần --platform)
        const defaultPlatform = require('platform', flags);
        const [username, ...rest] = line.split(':');
        const password = rest.join(':');
        if (!username || !password) { warn(`Bỏ qua dòng lỗi: ${line}`); continue; }
        accounts.push({ platform: defaultPlatform, username, password, role: 'sub' });
      }
    }

    if (accounts.length === 0) { err('Không đọc được account nào từ file'); process.exit(1); }

    const ids = accountManager.addAccountsBulk(accounts);
    ok(`Đã thêm ${ids.length} accounts`);
  },

  // ── add-proxy ──────────────────────────────────────────────────────────────
  'add-proxy'(flags) {
    const host     = require('host', flags);
    const port     = parseInt(require('port', flags));
    const username = flags.username || '';
    const password = flags.password || '';
    const protocol = flags.protocol || 'http';
    const type     = flags.type || 'static';

    const id = proxyManager.addProxy({ host, port, username, password, protocol, type });
    ok(`Thêm proxy ${protocol}://${host}:${port} — ID: ${id}`);
  },

  // ── add-proxies ────────────────────────────────────────────────────────────
  // File TXT mỗi dòng: host:port  hoặc  host:port:user:pass
  'add-proxies'(flags) {
    const file     = require('file', flags);
    const protocol = flags.protocol || 'http';
    const type     = flags.type || 'static';

    if (!existsSync(file)) { err(`File không tồn tại: ${file}`); process.exit(1); }

    const text = readFileSync(file, 'utf8');
    const ids  = proxyManager.importFromText(text, protocol, type);
    ok(`Đã thêm ${ids.length} proxies (${protocol})`);
  },

  // ── assign-proxies ─────────────────────────────────────────────────────────
  'assign-proxies'() {
    const count = proxyManager.autoAssignToAccounts();
    ok(`Đã gán proxy cho ${count} accounts`);
  },

  // ── create-campaign ────────────────────────────────────────────────────────
  'create-campaign'(flags) {
    const name     = require('name', flags);
    const platform = require('platform', flags);
    const target   = require('target', flags);
    const actions  = require('actions', flags).split(',').map(s => s.trim());
    const schedule = flags.schedule || 'auto';
    const url      = flags.url || null;

    // Resolve accounts
    let accountIds = [];
    if (flags.accounts === 'all') {
      accountIds = accountManager.getSubAccounts(platform).map(a => a.id);
      if (accountIds.length === 0) { warn('Không có account sub nào cho platform này'); }
    } else if (flags.accounts) {
      accountIds = flags.accounts.split(',').map(s => s.trim()).filter(Boolean);
    }

    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO campaigns (id, name, platform, target_account, target_url, actions, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, platform, target, url, JSON.stringify(actions), schedule);

    if (accountIds.length > 0) {
      const insert = db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
      const tx = db.transaction(() => accountIds.forEach(aid => insert.run(id, aid)));
      tx();
    }

    ok(`Tạo campaign "${name}" [${platform}]`);
    console.log(`  ID       : ${id}`);
    console.log(`  Target   : ${target}`);
    console.log(`  Actions  : ${actions.join(', ')}`);
    console.log(`  Schedule : ${schedule}`);
    console.log(`  Accounts : ${accountIds.length} sub-accounts`);
  },

  // ── add-to-campaign ────────────────────────────────────────────────────────
  'add-to-campaign'(flags) {
    const campaignId = require('campaign', flags);
    const platform   = flags.platform;

    let accountIds = [];
    if (flags.accounts === 'all') {
      if (!platform) { err('--platform bắt buộc khi dùng --accounts all'); process.exit(1); }
      accountIds = accountManager.getSubAccounts(platform).map(a => a.id);
    } else {
      accountIds = require('accounts', flags).split(',').map(s => s.trim()).filter(Boolean);
    }

    const db = getDb();
    const insert = db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?, ?)');
    const tx = db.transaction(() => accountIds.forEach(aid => insert.run(campaignId, aid)));
    tx();

    ok(`Thêm ${accountIds.length} accounts vào campaign ${campaignId}`);
  },

  // ── list ───────────────────────────────────────────────────────────────────
  'list'(flags, sub) {
    const target = sub || flags.type || 'accounts';

    if (target === 'accounts') {
      const rows = accountManager.getAllAccounts();
      console.log(chalk.bold('\n─── Accounts ────────────────────────────────────────────\n'));
      table(rows, [
        { key: 'platform',   label: 'Platform'  },
        { key: 'username',   label: 'Username'   },
        { key: 'role',       label: 'Role'       },
        { key: 'status',     label: 'Status'     },
        { key: 'proxy_id',   label: 'Proxy'      },
        { key: 'id',         label: 'ID'         },
      ]);

    } else if (target === 'proxies') {
      const rows = proxyManager.getAllProxies();
      console.log(chalk.bold('\n─── Proxies ─────────────────────────────────────────────\n'));
      table(rows, [
        { key: 'protocol',   label: 'Proto'      },
        { key: 'host',       label: 'Host'        },
        { key: 'port',       label: 'Port'        },
        { key: 'username',   label: 'User'        },
        { key: 'type',       label: 'Type'        },
        { key: 'status',     label: 'Status'      },
        { key: 'latency_ms', label: 'Latency'     },
        { key: 'id',         label: 'ID'          },
      ]);

    } else if (target === 'campaigns') {
      const db = getDb();
      const rows = db.prepare(`
        SELECT c.*, COUNT(ca.account_id) as sub_count
        FROM campaigns c
        LEFT JOIN campaign_accounts ca ON ca.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `).all();
      console.log(chalk.bold('\n─── Campaigns ───────────────────────────────────────────\n'));
      table(rows, [
        { key: 'name',           label: 'Name'      },
        { key: 'platform',       label: 'Platform'  },
        { key: 'target_account', label: 'Target'    },
        { key: 'actions',        label: 'Actions'   },
        { key: 'schedule',       label: 'Schedule'  },
        { key: 'is_active',      label: 'Active'    },
        { key: 'sub_count',      label: 'Accounts'  },
        { key: 'id',             label: 'ID'        },
      ]);

    } else {
      err(`Không biết list cái gì: "${target}". Dùng: accounts | proxies | campaigns`);
    }
    console.log('');
  },

  // ── trigger ────────────────────────────────────────────────────────────────
  async 'trigger'(flags) {
    const campaignId = require('campaign', flags);
    const db = getDb();
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) { err(`Campaign không tồn tại: ${campaignId}`); process.exit(1); }

    // Import scheduler chỉ khi cần (kéo theo Redis, cần Redis đang chạy)
    const { scheduler } = await import('../src/core/scheduler.js');
    await scheduler.triggerNow(campaignId);
    ok(`Đã trigger campaign "${campaign.name}" — tasks đã được enqueue`);
    process.exit(0);
  },

  // ── delete-account ─────────────────────────────────────────────────────────
  'delete-account'(flags) {
    const id = require('id', flags);
    const acc = accountManager.getAccount(id);
    if (!acc) { err(`Account không tồn tại: ${id}`); process.exit(1); }
    accountManager.deleteAccount(id);
    ok(`Đã xóa account: ${acc.username} [${acc.platform}]`);
  },

  // ── ban-account ────────────────────────────────────────────────────────────
  'ban-account'(flags) {
    const id = require('id', flags);
    accountManager.setStatus(id, 'banned');
    ok(`Đã đánh dấu banned: ${id}`);
  },

  // ── stats ──────────────────────────────────────────────────────────────────
  'stats'() {
    const db        = getDb();
    const accStats   = accountManager.getStats();
    const proxyStats = proxyManager.getStats();
    const campaigns  = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE is_active = 1').get().c;
    const tasks      = {
      pending: db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "pending"').get().c,
      done:    db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "done"').get().c,
      failed:  db.prepare('SELECT COUNT(*) as c FROM tasks WHERE status = "failed"').get().c,
    };

    console.log(chalk.bold('\n─── Stats ───────────────────────────────────────────────\n'));
    console.log(`Accounts  : ${accStats.total} total (${accStats.active} idle, ${accStats.running} running, ${accStats.banned} banned)`);
    console.log(`Proxies   : ${proxyStats.total} total (${proxyStats.active} active, ${proxyStats.dead} dead)`);
    console.log(`Campaigns : ${campaigns} đang active`);
    console.log(`Tasks     : ${tasks.pending} pending | ${tasks.done} done | ${tasks.failed} failed`);
    console.log('');
  },
};

// ─── Help ─────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(chalk.bold('\nCLI Admin — Kéo Traffic Tool\n'));
  console.log('Usage: node scripts/cli.js <command> [options]\n');
  console.log(chalk.bold('Commands:'));
  console.log('  add-account       Thêm 1 account');
  console.log('    --platform --username --password [--role sub|main] [--notes]');
  console.log('');
  console.log('  add-bulk          Import accounts từ file');
  console.log('    --file <path>  [--platform <p>]   # CSV: platform,user,pass,role | TXT: user:pass');
  console.log('');
  console.log('  add-proxy         Thêm 1 proxy');
  console.log('    --host --port  [--username] [--password] [--protocol http|socks5] [--type static|rotating|mobile]');
  console.log('');
  console.log('  add-proxies       Import proxies từ file TXT (mỗi dòng: host:port[:user:pass])');
  console.log('    --file <path>  [--protocol http|socks5]');
  console.log('');
  console.log('  assign-proxies    Tự gán proxy cho accounts chưa có');
  console.log('');
  console.log('  create-campaign   Tạo campaign mới');
  console.log('    --name --platform --target --actions like,follow,repin');
  console.log('    [--accounts all|id1,id2] [--url <url>] [--schedule "0 8 * * *"]');
  console.log('');
  console.log('  add-to-campaign   Thêm accounts vào campaign');
  console.log('    --campaign <id>  --accounts all|id1,id2  [--platform <p>]');
  console.log('');
  console.log('  list              Xem danh sách');
  console.log('    accounts | proxies | campaigns');
  console.log('');
  console.log('  trigger           Chạy campaign ngay (cần Redis đang chạy)');
  console.log('    --campaign <id>');
  console.log('');
  console.log('  delete-account    Xóa account  --id <id>');
  console.log('  ban-account       Đánh dấu bị ban  --id <id>');
  console.log('  stats             Thống kê tổng quát');
  console.log('');
  console.log(chalk.bold('Ví dụ:'));
  console.log('  node scripts/cli.js add-account --platform pinterest --username abc@gmail.com --password 123456');
  console.log('  node scripts/cli.js add-bulk --file accounts.csv');
  console.log('  node scripts/cli.js add-proxies --file proxies.txt');
  console.log('  node scripts/cli.js assign-proxies');
  console.log('  node scripts/cli.js create-campaign --name "Buff PIN" --platform pinterest --target myuser --actions like,follow --accounts all');
  console.log('  node scripts/cli.js list campaigns');
  console.log('  node scripts/cli.js trigger --campaign <id>');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const { command, sub, flags } = parseArgs(process.argv);

if (!command || command === 'help' || command === '--help') {
  showHelp();
  process.exit(0);
}

const handler = commands[command];
if (!handler) {
  err(`Lệnh không tồn tại: "${command}". Chạy "node scripts/cli.js help" để xem hướng dẫn.`);
  process.exit(1);
}

try {
  Promise.resolve(handler(flags, sub)).then(() => {
    if (command !== 'trigger') process.exit(0);
  }).catch(e => {
    err(e.message);
    process.exit(1);
  });
} catch (e) {
  err(e.message);
  process.exit(1);
}
