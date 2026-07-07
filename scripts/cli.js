#!/usr/bin/env node
/**
 * CLI Admin — quản lý accounts, proxies, campaigns
 * Usage: node scripts/cli.js <command> [--flag value]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
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

  // ── drain-tasks ───────────────────────────────────────────────────────────
  'drain-tasks'(flags) {
    const db = getDb();
    const w = ["status='pending'"], p = [];
    if (flags.campaign) { w.push('campaign_id=?'); p.push(flags.campaign); }
    if (flags.account)  { w.push('account_id=?');  p.push(flags.account);  }
    const count = db.prepare('DELETE FROM tasks WHERE ' + w.join(' AND ')).run(...p).changes;
    ok(`Đã xóa ${count} pending tasks`);
    warn('Lưu ý: jobs trong Redis queue vẫn có thể còn — restart engine để sạch hoàn toàn');
  },

  // ── clone-campaign ─────────────────────────────────────────────────────────
  'clone-campaign'(flags) {
    const id = require('id', flags);
    const db = getDb();
    const src = db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
    if (!src) { err(`Campaign không tồn tại: ${id}`); process.exit(1); }
    const newId   = randomUUID();
    const newName = flags.name || (src.name + ' (Copy)');
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule,is_active) VALUES(?,?,?,?,?,?,?,1)')
      .run(newId, newName, src.platform, src.target_account, src.target_url, src.actions, src.schedule);
    const accs = db.prepare('SELECT account_id FROM campaign_accounts WHERE campaign_id=?').all(id);
    const ins  = db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)');
    accs.forEach(a => ins.run(newId, a.account_id));
    ok(`Cloned "${src.name}" → "${newName}"`);
    console.log(`  New ID: ${newId}`);
    console.log(`  Accounts copied: ${accs.length}`);
  },

  // ── reset-errors ──────────────────────────────────────────────────────────
  'reset-errors'() {
    const db = getDb();
    const count = db.prepare("UPDATE accounts SET status='idle', updated_at=datetime('now') WHERE status='error'").run().changes;
    ok(`Reset ${count} error accounts → idle`);
  },

  // ── pause-campaign ─────────────────────────────────────────────────────────
  'pause-campaign'(flags) {
    const id = require('id', flags);
    const db = getDb();
    const c = db.prepare('SELECT name FROM campaigns WHERE id=?').get(id);
    if (!c) { err(`Campaign không tồn tại: ${id}`); process.exit(1); }
    db.prepare("UPDATE campaigns SET is_active=0 WHERE id=?").run(id);
    ok(`Đã tạm dừng campaign "${c.name}"`);
  },

  // ── resume-campaign ────────────────────────────────────────────────────────
  'resume-campaign'(flags) {
    const id = require('id', flags);
    const db = getDb();
    const c = db.prepare('SELECT name FROM campaigns WHERE id=?').get(id);
    if (!c) { err(`Campaign không tồn tại: ${id}`); process.exit(1); }
    db.prepare("UPDATE campaigns SET is_active=1 WHERE id=?").run(id);
    ok(`Đã tiếp tục campaign "${c.name}"`);
  },

  // ── check-sessions ─────────────────────────────────────────────────────────
  'check-sessions'() {
    const SESSION_DIR = process.env.SESSION_DIR || './sessions';
    const db = getDb();
    const accounts = db.prepare("SELECT id, platform, username, session_path FROM accounts WHERE status != 'banned'").all();
    const now = Date.now();

    console.log(chalk.bold('\n─── Session Status ─────────────────────────────────────\n'));
    let valid = 0, missing = 0, expired = 0;

    const rows = accounts.map(a => {
      if (!a.session_path || !existsSync(a.session_path)) {
        missing++;
        return { platform: a.platform, username: a.username, status: 'NO SESSION', age: '---' };
      }
      const ageDays = Math.floor((now - statSync(a.session_path).mtimeMs) / 86400000);
      if (ageDays > 30) {
        expired++;
        return { platform: a.platform, username: a.username, status: 'STALE (>30d)', age: ageDays + 'd' };
      }
      valid++;
      return { platform: a.platform, username: a.username, status: 'OK', age: ageDays + 'd' };
    });

    table(rows, [
      { key: 'platform', label: 'Platform' },
      { key: 'username', label: 'Username' },
      { key: 'status',   label: 'Session'  },
      { key: 'age',      label: 'Age'      },
    ]);
    console.log('');
    console.log(`  ✓ Valid: ${valid}   ✗ Missing: ${missing}   ⚠ Stale: ${expired}`);
    console.log('');
  },

  // ── export ─────────────────────────────────────────────────────────────────
  // Xuất CSV: tasks | accounts | proxies  (mặc định: tasks)
  async 'export'(flags, sub) {
    const target   = sub || flags.type || 'tasks';
    const outFile  = flags.out || (`./export_${target}_${new Date().toISOString().slice(0,10)}.csv`);
    const db = getDb();

    let rows, cols;
    if (target === 'tasks') {
      rows = db.prepare(`
        SELECT t.platform,t.action,t.status,t.error,t.scheduled_at,t.finished_at,
               a.username as account, c.name as campaign
        FROM tasks t
        LEFT JOIN accounts a ON a.id=t.account_id
        LEFT JOIN campaigns c ON c.id=t.campaign_id
        ORDER BY t.created_at DESC
      `).all();
      cols = ['platform','action','status','account','campaign','error','scheduled_at','finished_at'];
    } else if (target === 'accounts') {
      rows = db.prepare(`
        SELECT a.platform,a.username,a.role,a.status,a.daily_counts,a.last_reset,
               p.host as proxy_host, p.port as proxy_port
        FROM accounts a LEFT JOIN proxies p ON p.id=a.proxy_id
        ORDER BY a.platform,a.created_at DESC
      `).all();
      cols = ['platform','username','role','status','proxy_host','proxy_port','daily_counts','last_reset'];
    } else if (target === 'proxies') {
      rows = db.prepare('SELECT host,port,username,protocol,type,status,latency_ms,last_check FROM proxies ORDER BY status,created_at DESC').all();
      cols = ['host','port','username','protocol','type','status','latency_ms','last_check'];
    } else {
      err(`Không biết export gì: "${target}". Dùng: tasks | accounts | proxies`);
      process.exit(1);
    }

    const escape = v => v == null ? '' : ('"' + String(v).replace(/"/g, '""') + '"');
    const lines = [cols.join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))];
    writeFileSync(outFile, lines.join('\n'), 'utf8');
    ok(`Đã xuất ${rows.length} dòng → ${outFile}`);
  },

  // ── test-proxy ─────────────────────────────────────────────────────────────
  async 'test-proxy'(flags) {
    const id = require('id', flags);
    ok('Testing proxy...');
    const result = await proxyManager.testProxy(id);
    if (result.ok) {
      ok(`OK — IP: ${result.ip} — Latency: ${result.latency}ms`);
    } else {
      err(`DEAD — ${result.error}`);
    }
  },

  // ── register-accounts ──────────────────────────────────────────────────────
  async 'register-accounts'(flags) {
    const platform = flags['platform'] || 'pinterest';
    const count    = parseInt(flags['count'] || '1', 10);
    const role     = flags['role'] || 'sub';

    if (platform !== 'pinterest') {
      console.error(chalk.red('Hien chi ho tro: pinterest'));
      process.exit(1);
    }
    if (isNaN(count) || count < 1) {
      console.error(chalk.red('--count phai la so nguyen duong'));
      process.exit(1);
    }

    const { registerPinterestAccount } = await import('../src/workers/pinterest_register.worker.js');

    console.log(chalk.bold(`\nDang ky ${count} account Pinterest (thu cong CAPTCHA)...\n`));
    let success = 0;
    for (let i = 0; i < count; i++) {
      console.log(chalk.bold.cyan(`\n--- Account ${i + 1} / ${count} ---`));
      try {
        await registerPinterestAccount({ role });
        success++;
        if (i < count - 1) {
          const wait = 30_000 + Math.floor(Math.random() * 30_000);
          console.log(chalk.gray(`  Nghi ${Math.round(wait / 1000)}s truoc account tiep theo...`));
          await new Promise(r => setTimeout(r, wait));
        }
      } catch (e) {
        console.error(chalk.red(`  [LOI] ${e.message}`));
      }
    }
    console.log(chalk.bold.green(`\nXong: ${success}/${count} account da tao thanh cong.`));
  },
  // ── stats ──────────────────────────────────────────────────────────────────
  'stats'() {
    const db        = getDb();
    const accStats   = accountManager.getStats();
    const proxyStats = proxyManager.getStats();
    const campaigns  = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE is_active = 1').get().c;
    const tasks      = {
      pending: db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'`).get().c,
      done:    db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done'`).get().c,
      failed:  db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'`).get().c,
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
  console.log('  drain-tasks       Xóa pending tasks  [--campaign <id>] [--account <id>]');
  console.log('  clone-campaign    Clone campaign  --id <id>  [--name "New Name"]');
  console.log('  reset-errors      Reset tất cả accounts lỗi về idle');
  console.log('  check-sessions    Kiểm tra trạng thái session / cookie của accounts');
  console.log('  export            Xuất CSV ra file');
  console.log('    tasks | accounts | proxies  [--out <file>]');
  console.log('  pause-campaign    Tạm dừng campaign  --id <id>');
  console.log('  resume-campaign   Tiếp tục campaign  --id <id>');
  console.log('  test-proxy        Kiểm tra 1 proxy  --id <id>');
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
    if (command !== 'trigger' && command !== 'register-accounts') process.exit(0);
  }).catch(e => {
    err(e.message);
    process.exit(1);
  });
} catch (e) {
  err(e.message);
  process.exit(1);
}
