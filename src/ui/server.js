import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { proxyManager } from '../core/proxyManager.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const LIMITS_PATH = new URL('../../config/limits.json', import.meta.url);
const app  = express();
const PORT = process.env.UI_PORT || 3100;

app.use(express.json());

// ─── Dashboard basic auth (tuỳ chọn) ─────────────────────────────────────────
if (process.env.DASHBOARD_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) {
      return res.set('WWW-Authenticate', 'Basic realm="Traffic Tool"').status(401).send('Unauthorized');
    }
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (user === (process.env.DASHBOARD_USER || 'admin') && pass === process.env.DASHBOARD_PASSWORD) {
      return next();
    }
    return res.status(401).send('Unauthorized');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE ──────────────────────────────────────────────────────────────────────
const sseClients = new Set();
let lastLogId = 0;

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(':\n\n');
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  sseClients.add(send);
  req.on('close', () => sseClients.delete(send));
});

// Gửi log mới mỗi 1.5s
setInterval(() => {
  if (!sseClients.size) return;
  try {
    const db = getDb();
    if (!lastLogId) {
      const r = db.prepare('SELECT MAX(id) as m FROM logs').get();
      lastLogId = r.m || 0;
      return;
    }
    const rows = db.prepare('SELECT * FROM logs WHERE id>? ORDER BY id ASC LIMIT 100').all(lastLogId);
    if (rows.length) {
      lastLogId = rows[rows.length - 1].id;
      sseClients.forEach(s => rows.forEach(r => s(r)));
    }
  } catch {}
}, 1500);

// Gửi stats realtime mỗi 5s (kèm running tasks)
setInterval(() => {
  if (!sseClients.size) return;
  try {
    const db = getDb();
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status || 'unknown', r.count]));
    const runningTasks = db.prepare(`
      SELECT t.*,a.username as account_username,c.name as campaign_name
      FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id
      WHERE t.status='running' ORDER BY t.started_at ASC LIMIT 50`).all();
    const stats = {
      _type:        'stats',
      accounts:     toMap(db.prepare('SELECT status, COUNT(*) as count FROM accounts GROUP BY status').all()),
      campaigns:    db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE is_active=1').get().count,
      tasks:        toMap(db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all()),
      proxies:      toMap(db.prepare('SELECT status, COUNT(*) as count FROM proxies GROUP BY status').all()),
      runningTasks: runningTasks,
    };
    sseClients.forEach(s => s(stats));
  } catch {}
}, 5000);

// ─── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const db    = getDb();
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status || 'unknown', r.count]));
    res.json({
      accounts:  toMap(db.prepare('SELECT status, COUNT(*) as count FROM accounts GROUP BY status').all()),
      campaigns: db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE is_active=1').get().count,
      tasks:     toMap(db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all()),
      proxies:   toMap(db.prepare('SELECT status, COUNT(*) as count FROM proxies GROUP BY status').all()),
      recentActivity: db.prepare(`
        SELECT t.action,t.platform,t.status,t.finished_at,a.username
        FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id
        WHERE t.status IN ('done','failed') ORDER BY t.finished_at DESC LIMIT 30`).all(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/platform/:p/stats', (req, res) => {
  try {
    const db = getDb(); const p = req.params.p;
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status || '?', r.n]));
    res.json({
      sub:       toMap(db.prepare("SELECT status,COUNT(*) as n FROM accounts WHERE platform=? AND role='sub' GROUP BY status").all(p)),
      main:      db.prepare("SELECT COUNT(*) as n FROM accounts WHERE platform=? AND role='main'").get(p).n,
      campaigns: db.prepare('SELECT COUNT(*) as n FROM campaigns WHERE platform=? AND is_active=1').get(p).n,
      tasks:     toMap(db.prepare('SELECT status,COUNT(*) as n FROM tasks WHERE platform=? GROUP BY status').all(p)),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/platform/:p/targets', (req, res) => {
  try {
    const db = getDb(); const p = req.params.p;
    const campaigns = db.prepare('SELECT * FROM campaigns WHERE platform=?').all(p);
    const grouped = {};
    for (const c of campaigns) {
      const ts  = Object.fromEntries(db.prepare('SELECT status,COUNT(*) as n FROM tasks WHERE campaign_id=? GROUP BY status').all(c.id).map(r=>[r.status,r.n]));
      const acc = db.prepare('SELECT COUNT(*) as n FROM campaign_accounts WHERE campaign_id=?').get(c.id).n;
      if (!grouped[c.target_account]) grouped[c.target_account] = { target: c.target_account, url: c.target_url, campaigns:[], done:0, failed:0, pending:0 };
      grouped[c.target_account].campaigns.push({ ...c, actions: JSON.parse(c.actions || '[]'), ts, acc });
      grouped[c.target_account].done    += ts.done    || 0;
      grouped[c.target_account].failed  += ts.failed  || 0;
      grouped[c.target_account].pending += (ts.pending || 0) + (ts.running || 0);
    }
    res.json(Object.values(grouped));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Accounts ──────────────────────────────────────────────────────────────────
app.get('/api/accounts', (req, res) => {
  try {
    const db = getDb(); const { platform, status, role } = req.query;
    let sql = `SELECT a.*,p.host as proxy_host,p.port as proxy_port,p.status as proxy_status
               FROM accounts a LEFT JOIN proxies p ON p.id=a.proxy_id`;
    const w=[], pr=[];
    if (platform && platform !== 'all') { w.push('a.platform=?'); pr.push(platform); }
    if (status   && status   !== 'all') { w.push('a.status=?');   pr.push(status);   }
    if (role     && role     !== 'all') { w.push('a.role=?');     pr.push(role);     }
    if (w.length) sql += ' WHERE ' + w.join(' AND ');
    sql += ' ORDER BY a.platform,a.created_at DESC';
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts/bulk', (req, res) => {
  try {
    const SESSION_DIR = process.env.SESSION_DIR || './sessions';
    const lines = req.body.text.trim().split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('platform'));
    const db  = getDb();
    const ins = db.prepare('INSERT OR IGNORE INTO accounts(id,platform,username,password,role,session_path) VALUES(?,?,?,?,?,?)');
    let count = 0;
    for (const l of lines) {
      const [platform, username, password, role = 'sub'] = l.split(',').map(s => s.trim());
      if (platform && username && password) {
        const sessionPath = path.join(SESSION_DIR, platform + '_' + username + '.json');
        ins.run(randomUUID(), platform, username, password, role, sessionPath);
        count++;
      }
    }
    res.json({ ok: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts', (req, res) => {
  try {
    const { platform, username, password, role = 'sub' } = req.body;
    if (!platform || !username || !password) return res.status(400).json({ error: 'platform, username, password required' });
    const id = randomUUID();
    const sessionPath = path.join(process.env.SESSION_DIR || './sessions', platform + '_' + username + '.json');
    getDb().prepare('INSERT INTO accounts(id,platform,username,password,role,session_path) VALUES(?,?,?,?,?,?)').run(id, platform, username, password, role, sessionPath);
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts/:id/ban', (req, res) => {
  try { getDb().prepare("UPDATE accounts SET status='banned',updated_at=datetime('now') WHERE id=?").run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset error → idle
app.post('/api/accounts/:id/reset', (req, res) => {
  try { getDb().prepare("UPDATE accounts SET status='idle',updated_at=datetime('now') WHERE id=?").run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/accounts/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Campaigns ─────────────────────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  try {
    const db = getDb(); const { platform } = req.query;
    let sql = 'SELECT * FROM campaigns'; const pr = [];
    if (platform && platform !== 'all') { sql += ' WHERE platform=?'; pr.push(platform); }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...pr);
    res.json(rows.map(c => ({
      ...c,
      actions: JSON.parse(c.actions || '[]'),
      account_count: db.prepare('SELECT COUNT(*) as n FROM campaign_accounts WHERE campaign_id=?').get(c.id).n,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns', (req, res) => {
  try {
    const { name, platform, target_account, target_url, actions, schedule, account_ids } = req.body;
    if (!name || !platform || !target_account || !actions?.length) return res.status(400).json({ error: 'required fields missing' });
    const db = getDb(); const id = randomUUID();
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule) VALUES(?,?,?,?,?,?,?)')
      .run(id, name, platform, target_account, target_url || null, JSON.stringify(actions), schedule || 'auto');
    if (!account_ids || account_ids === 'all') {
      const accs = db.prepare("SELECT id FROM accounts WHERE platform=? AND role='sub' AND status!='banned'").all(platform);
      const ins  = db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)');
      accs.forEach(a => ins.run(id, a.id));
    } else {
      String(account_ids).split(',').map(s => s.trim()).filter(Boolean).forEach(aid =>
        db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)').run(id, aid));
    }
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns/:id/toggle', (req, res) => {
  try {
    const db = getDb(); const c = db.prepare('SELECT is_active FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE campaigns SET is_active=? WHERE id=?').run(c.is_active ? 0 : 1, req.params.id);
    res.json({ ok: true, is_active: !c.is_active });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns/:id/trigger', async (req, res) => {
  try {
    const { scheduler } = await import('../core/scheduler.js');
    await scheduler.triggerNow(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: `Trigger failed (Redis required): ${err.message}` }); }
});

app.delete('/api/campaigns/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM campaigns WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Proxies ───────────────────────────────────────────────────────────────────
app.get('/api/proxies', (req, res) => {
  try { res.json(getDb().prepare('SELECT * FROM proxies ORDER BY created_at DESC').all()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/bulk', (req, res) => {
  try {
    const lines = req.body.text.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const db  = getDb();
    const ins = db.prepare('INSERT OR IGNORE INTO proxies(id,host,port,username,password,protocol,type) VALUES(?,?,?,?,?,?,?)');
    let count = 0;
    for (const l of lines) {
      const [host, port, username = null, password = null] = l.trim().split(':');
      if (host && port) { ins.run(randomUUID(), host, Number(port), username, password, 'http', 'static'); count++; }
    }
    res.json({ ok: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies', (req, res) => {
  try {
    const { host, port, username, password, protocol = 'http', type = 'static' } = req.body;
    if (!host || !port) return res.status(400).json({ error: 'host and port required' });
    const id = randomUUID();
    getDb().prepare('INSERT INTO proxies(id,host,port,username,password,protocol,type) VALUES(?,?,?,?,?,?,?)').run(id, host, Number(port), username || null, password || null, protocol, type);
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/assign', (req, res) => {
  try { res.json({ ok: true, assigned: proxyManager.autoAssignToAccounts() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/:id/test', async (req, res) => {
  try { res.json(await proxyManager.testProxy(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/proxies/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM proxies WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  try {
    const { status, platform, id, limit = 150, offset = 0 } = req.query;
    const db = getDb();
    // Tìm theo ID cụ thể (cho task detail)
    if (id) {
      const task = db.prepare(`
        SELECT t.*,a.username as account_username,c.name as campaign_name
        FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id
        WHERE t.id=?
      `).get(id);
      return res.json(task ? [task] : []);
    }
    let sql = `SELECT t.*,a.username as account_username,c.name as campaign_name
               FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id`;
    const w = [], pr = [];
    if (status      && status      !== 'all') { w.push('t.status=?');      pr.push(status);      }
    if (platform    && platform    !== 'all') { w.push('t.platform=?');    pr.push(platform);    }
    if (req.query.campaign_id) { w.push('t.campaign_id=?'); pr.push(req.query.campaign_id); }
    if (w.length) sql += ' WHERE ' + w.join(' AND ');
    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    pr.push(Number(limit), Number(offset));
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks/:id/retry', async (req, res) => {
  try {
    const db   = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const { Queue } = await import('bullmq');
    const { getRedis } = await import('../core/queue.js');
    db.prepare("UPDATE tasks SET status='pending',attempts=0,error=null WHERE id=?").run(task.id);
    const q = new Queue('traffic-actions', { connection: getRedis() });
    await q.add('task', { taskId: task.id, accountId: task.account_id, platform: task.platform, action: task.action, targetUrl: task.target_url });
    await q.close();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try { res.json(JSON.parse(readFileSync(LIMITS_PATH, 'utf8'))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/settings', (req, res) => {
  try { writeFileSync(LIMITS_PATH, JSON.stringify(req.body, null, 2), 'utf8'); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Logs ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  try {
    const { level, limit = 200, offset = 0 } = req.query;
    const db = getDb();
    let sql = 'SELECT * FROM logs'; const pr = [];
    if (level && level !== 'all') { sql += ' WHERE level=?'; pr.push(level); }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    pr.push(Number(limit), Number(offset));
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const db = getDb();
    // Redis ping — 2s timeout (ioredis queues commands indefinitely when Redis is down)
    const _timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));
    let redisOk = false, redisMs = 0;
    try {
      const { getRedis } = await import('../core/queue.js');
      const t = Date.now();
      await Promise.race([getRedis().ping(), _timeout(2000)]);
      redisMs = Date.now() - t; redisOk = true;
    } catch {}

    // Queue stats
    let queueStats = {};
    try {
      const { getQueueStats } = await import('../core/queue.js');
      queueStats = await Promise.race([getQueueStats(), _timeout(2000)]);
    } catch {}

    // DB stats
    const dbStats = {
      accounts: db.prepare('SELECT COUNT(*) as n FROM accounts').get().n,
      campaigns: db.prepare('SELECT COUNT(*) as n FROM campaigns').get().n,
      tasks: db.prepare('SELECT COUNT(*) as n FROM tasks').get().n,
      logs: db.prepare('SELECT COUNT(*) as n FROM logs').get().n,
    };

    // Sessions on disk
    const SESSION_DIR = process.env.SESSION_DIR || './sessions';
    let sessionCount = 0;
    try {
      sessionCount = readdirSync(SESSION_DIR).filter(f => f.endsWith('.json')).length;
    } catch {}

    res.json({
      ok: redisOk,
      redis: { ok: redisOk, latency_ms: redisMs },
      queue: queueStats,
      db: dbStats,
      sessions: sessionCount,
      uptime_s: Math.floor(process.uptime()),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Queue stats (BullMQ) ─────────────────────────────────────────────────────
app.get('/api/queue/stats', async (req, res) => {
  try {
    const { getQueueStats } = await import('../core/queue.js');
    const _t = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));
    res.json(await Promise.race([getQueueStats(), _t(2000)]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Clear session for account ────────────────────────────────────────────────
app.post('/api/accounts/:id/clear-session', (req, res) => {
  try {
    const db  = getDb();
    const acc = db.prepare('SELECT session_path FROM accounts WHERE id=?').get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'not found' });
    if (acc.session_path && existsSync(acc.session_path)) unlinkSync(acc.session_path);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Drain pending tasks ──────────────────────────────────────────────────────
// Body: { campaign_id?, account_id? }  — bỏ trống = drain tất cả pending
app.post('/api/tasks/drain', async (req, res) => {
  try {
    const db = getDb(); const { campaign_id, account_id } = req.body || {};
    const w = ["status='pending'"]; const p = [];
    if (campaign_id) { w.push('campaign_id=?'); p.push(campaign_id); }
    if (account_id)  { w.push('account_id=?');  p.push(account_id);  }
    const sql = 'DELETE FROM tasks WHERE ' + w.join(' AND ');
    const count = db.prepare(sql).run(...p).changes;

    // Xóa khỏi BullMQ queue nếu có
    try {
      const { getQueue } = await import('../core/queue.js');
      const q = getQueue();
      const delayed = await q.getDelayed();
      const waiting = await q.getWaiting();
      const jobs    = [...delayed, ...waiting];
      let removed = 0;
      for (const job of jobs) {
        const d = job.data;
        const matchCampaign = !campaign_id || d.campaignId === campaign_id;
        const matchAccount  = !account_id  || d.accountId  === account_id;
        if (matchCampaign && matchAccount) { await job.remove(); removed++; }
      }
    } catch {}

    res.json({ ok: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── Campaign progress (task counts per campaign) ──────────────────────────
app.get('/api/campaigns/progress', (req, res) => {
  try {
    const db = getDb(); const { platform } = req.query;
    let sql = `SELECT c.id,c.name,c.platform,c.target_account,c.is_active,
      SUM(CASE WHEN t.status='done'    THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN t.status='failed'  THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN t.status='running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) as pending,
      COUNT(t.id) as total
      FROM campaigns c LEFT JOIN tasks t ON t.campaign_id=c.id`;
    const pr = [];
    if (platform && platform !== 'all') { sql += ' WHERE c.platform=?'; pr.push(platform); }
    sql += ' GROUP BY c.id ORDER BY c.created_at DESC';
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Clone campaign ───────────────────────────────────────────────────────────
app.post('/api/campaigns/:id/clone', async (req, res) => {
  try {
    const db  = getDb();
    const src = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!src) return res.status(404).json({ error: 'not found' });
    const { randomUUID } = await import('crypto');
    const newId   = randomUUID();
    const newName = (req.body?.name || src.name + ' (Copy)');
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule,is_active) VALUES(?,?,?,?,?,?,?,1)')
      .run(newId, newName, src.platform, src.target_account, src.target_url, src.actions, src.schedule);
    // Copy accounts
    const accs = db.prepare('SELECT account_id FROM campaign_accounts WHERE campaign_id=?').all(req.params.id);
    const ins  = db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)');
    accs.forEach(a => ins.run(newId, a.account_id));
    res.json({ ok: true, id: newId, name: newName });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Edit campaign ────────────────────────────────────────────────────────────
app.put('/api/campaigns/:id', (req, res) => {
  try {
    const db  = getDb();
    const c   = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const { name, target_url, schedule, actions } = req.body;
    db.prepare('UPDATE campaigns SET name=?,target_url=?,schedule=?,actions=? WHERE id=?')
      .run(name || c.name, target_url ?? c.target_url, schedule || c.schedule,
           actions ? JSON.stringify(actions) : c.actions, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Bulk reset error accounts ────────────────────────────────────────────────
app.post('/api/accounts/bulk-reset-errors', (req, res) => {
  try {
    const db    = getDb(); const { platform } = req.body || {};
    let sql = "UPDATE accounts SET status='idle',updated_at=datetime('now') WHERE status='error'";
    const p = [];
    if (platform) { sql += ' AND platform=?'; p.push(platform); }
    const count = db.prepare(sql).run(...p).changes;
    res.json({ ok: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Test all proxies ────────────────────────────────────────────────────────
app.post('/api/proxies/test-all', async (req, res) => {
  try { res.json({ ok: true, alive: await proxyManager.testAll() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auto reassign dead proxies ──────────────────────────────────────────────
app.post('/api/proxies/auto-reassign', (req, res) => {
  try {
    const db = getDb();
    // Accounts đang dùng proxy dead → null proxy_id
    const unassigned = db.prepare(
      "UPDATE accounts SET proxy_id=NULL WHERE proxy_id IN (SELECT id FROM proxies WHERE status='dead')"
    ).run().changes;
    // Gán lại proxy sống
    const reassigned = proxyManager.autoAssignToAccounts();
    res.json({ ok: true, unassigned, reassigned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.listen(PORT, () => console.log(`\n  Dashboard: http://localhost:${PORT}\n`));