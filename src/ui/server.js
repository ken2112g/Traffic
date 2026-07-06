import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { proxyManager } from '../core/proxyManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIMITS_PATH = new URL('../../config/limits.json', import.meta.url);
const app = express();
const PORT = process.env.UI_PORT || 3100;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE ──────────────────────────────────────────
const sseClients = new Set();
let lastLogId = 0;
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); res.write(':\n\n');
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  sseClients.add(send); req.on('close', () => sseClients.delete(send));
});
setInterval(() => {
  if (!sseClients.size) return;
  try {
    const db = getDb();
    if (!lastLogId) { const r = db.prepare('SELECT MAX(id) as m FROM logs').get(); lastLogId = r.m||0; return; }
    const rows = db.prepare('SELECT * FROM logs WHERE id>? ORDER BY id ASC LIMIT 100').all(lastLogId);
    if (rows.length) { lastLogId = rows[rows.length-1].id; sseClients.forEach(s => rows.forEach(r => s(r))); }
  } catch {}
}, 1500);

// ─── Dashboard stats ──────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const db = getDb();
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status||'unknown', r.count]));
    res.json({
      accounts:  toMap(db.prepare('SELECT status, COUNT(*) as count FROM accounts GROUP BY status').all()),
      campaigns: db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE is_active=1').get().count,
      tasks:     toMap(db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all()),
      proxies:   toMap(db.prepare('SELECT status, COUNT(*) as count FROM proxies GROUP BY status').all()),
      recentActivity: db.prepare(`SELECT t.action,t.platform,t.status,t.finished_at,a.username
        FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id
        WHERE t.status IN('done','failed') ORDER BY t.finished_at DESC LIMIT 30`).all(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Per-platform stats ────────────────────────────
app.get('/api/platform/:p/stats', (req, res) => {
  try {
    const db = getDb(); const p = req.params.p;
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status||'?', r.n]));
    res.json({
      sub:       toMap(db.prepare("SELECT status,COUNT(*) as n FROM accounts WHERE platform=? AND role='sub' GROUP BY status").all(p)),
      main:      db.prepare("SELECT COUNT(*) as n FROM accounts WHERE platform=? AND role='main'").get(p).n,
      campaigns: db.prepare('SELECT COUNT(*) as n FROM campaigns WHERE platform=? AND is_active=1').get(p).n,
      tasks:     toMap(db.prepare('SELECT status,COUNT(*) as n FROM tasks WHERE platform=? GROUP BY status').all(p)),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Per-platform targets (main accounts being buffed)
app.get('/api/platform/:p/targets', (req, res) => {
  try {
    const db = getDb(); const p = req.params.p;
    const campaigns = db.prepare('SELECT * FROM campaigns WHERE platform=?').all(p);
    const grouped = {};
    for (const c of campaigns) {
      const ts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) as n FROM tasks WHERE campaign_id=? GROUP BY status').all(c.id).map(r=>[r.status,r.n]));
      const acc = db.prepare('SELECT COUNT(*) as n FROM campaign_accounts WHERE campaign_id=?').get(c.id).n;
      if (!grouped[c.target_account]) grouped[c.target_account] = { target: c.target_account, url: c.target_url, campaigns:[], done:0, failed:0, pending:0 };
      grouped[c.target_account].campaigns.push({ ...c, actions: JSON.parse(c.actions||'[]'), ts, acc });
      grouped[c.target_account].done    += ts.done    ||0;
      grouped[c.target_account].failed  += ts.failed  ||0;
      grouped[c.target_account].pending += (ts.pending||0)+(ts.running||0);
    }
    res.json(Object.values(grouped));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Accounts ─────────────────────────────────────
app.get('/api/accounts', (req, res) => {
  try {
    const db = getDb(); const { platform, status, role } = req.query;
    let sql = `SELECT a.*,p.host as proxy_host,p.port as proxy_port,p.status as proxy_status
               FROM accounts a LEFT JOIN proxies p ON p.id=a.proxy_id`;
    const w=[],pr=[];
    if (platform && platform!=='all') { w.push('a.platform=?'); pr.push(platform); }
    if (status   && status!=='all')   { w.push('a.status=?');   pr.push(status);   }
    if (role     && role!=='all')     { w.push('a.role=?');     pr.push(role);     }
    if (w.length) sql += ' WHERE '+w.join(' AND ');
    sql += ' ORDER BY a.platform,a.created_at DESC';
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts/bulk', (req, res) => {
  try {
    const lines = req.body.text.trim().split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&!l.startsWith('platform'));
    const db = getDb();
    const ins = db.prepare('INSERT OR IGNORE INTO accounts(id,platform,username,password,role) VALUES(?,?,?,?,?)');
    let count=0;
    for (const l of lines) {
      const [platform,username,password,role='sub'] = l.split(',').map(s=>s.trim());
      if (platform&&username&&password) { ins.run(randomUUID(),platform,username,password,role); count++; }
    }
    res.json({ ok:true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts', (req, res) => {
  try {
    const { platform, username, password, role='sub' } = req.body;
    if (!platform||!username||!password) return res.status(400).json({ error:'platform, username, password required' });
    const id = randomUUID();
    getDb().prepare('INSERT INTO accounts(id,platform,username,password,role) VALUES(?,?,?,?,?)').run(id,platform,username,password,role);
    res.json({ ok:true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts/:id/ban', (req, res) => {
  try { getDb().prepare("UPDATE accounts SET status='banned',updated_at=datetime('now') WHERE id=?").run(req.params.id); res.json({ok:true}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/accounts/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Campaigns ────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  try {
    const db = getDb(); const { platform } = req.query;
    let sql = 'SELECT * FROM campaigns'; const pr=[];
    if (platform && platform!=='all') { sql += ' WHERE platform=?'; pr.push(platform); }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...pr);
    res.json(rows.map(c => ({
      ...c, actions: JSON.parse(c.actions||'[]'),
      account_count: db.prepare('SELECT COUNT(*) as n FROM campaign_accounts WHERE campaign_id=?').get(c.id).n,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns', (req, res) => {
  try {
    const { name,platform,target_account,target_url,actions,schedule,account_ids } = req.body;
    if (!name||!platform||!target_account||!actions?.length) return res.status(400).json({error:'required fields missing'});
    const db = getDb(); const id = randomUUID();
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule) VALUES(?,?,?,?,?,?,?)')
      .run(id,name,platform,target_account,target_url||null,JSON.stringify(actions),schedule||'auto');
    if (!account_ids||account_ids==='all') {
      const accs = db.prepare("SELECT id FROM accounts WHERE platform=? AND role='sub' AND status!='banned'").all(platform);
      const ins = db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)');
      accs.forEach(a=>ins.run(id,a.id));
    } else {
      String(account_ids).split(',').map(s=>s.trim()).filter(Boolean).forEach(aid =>
        db.prepare('INSERT OR IGNORE INTO campaign_accounts(campaign_id,account_id) VALUES(?,?)').run(id,aid));
    }
    res.json({ ok:true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns/:id/toggle', (req, res) => {
  try {
    const db = getDb(); const c = db.prepare('SELECT is_active FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({error:'not found'});
    db.prepare('UPDATE campaigns SET is_active=? WHERE id=?').run(c.is_active?0:1, req.params.id);
    res.json({ok:true, is_active:!c.is_active});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/campaigns/:id/trigger', async (req, res) => {
  try {
    const { scheduler } = await import('../core/scheduler.js');
    await scheduler.triggerNow(req.params.id); res.json({ok:true});
  } catch (err) { res.status(500).json({error:`Trigger failed (Redis required): ${err.message}`}); }
});

app.delete('/api/campaigns/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM campaigns WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Proxies ──────────────────────────────────────
app.get('/api/proxies', (req, res) => {
  try { res.json(getDb().prepare('SELECT * FROM proxies ORDER BY created_at DESC').all()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/bulk', (req, res) => {
  try {
    const lines = req.body.text.trim().split('\n').filter(l=>l.trim()&&!l.startsWith('#'));
    const db = getDb();
    const ins = db.prepare('INSERT OR IGNORE INTO proxies(id,host,port,username,password,protocol,type) VALUES(?,?,?,?,?,?,?)');
    let count=0;
    for (const l of lines) {
      const [host,port,username=null,password=null] = l.trim().split(':');
      if (host&&port) { ins.run(randomUUID(),host,Number(port),username,password,'http','static'); count++; }
    }
    res.json({ok:true,count});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies', (req, res) => {
  try {
    const { host,port,username,password,protocol='http',type='static' } = req.body;
    if (!host||!port) return res.status(400).json({error:'host and port required'});
    const id = randomUUID();
    getDb().prepare('INSERT INTO proxies(id,host,port,username,password,protocol,type) VALUES(?,?,?,?,?,?,?)').run(id,host,Number(port),username||null,password||null,protocol,type);
    res.json({ok:true,id});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/assign', (req, res) => {
  try { res.json({ok:true, assigned: proxyManager.autoAssignToAccounts()}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/proxies/:id/test', async (req, res) => {
  try { res.json(await proxyManager.testProxy(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/proxies/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM proxies WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Tasks ────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  try {
    const { status,platform,limit=150,offset=0 } = req.query; const db = getDb();
    let sql = `SELECT t.*,a.username as account_username,c.name as campaign_name
               FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id`;
    const w=[],pr=[];
    if (status   &&status!=='all')   { w.push('t.status=?');   pr.push(status);   }
    if (platform &&platform!=='all') { w.push('t.platform=?'); pr.push(platform); }
    if (w.length) sql += ' WHERE '+w.join(' AND ');
    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    pr.push(Number(limit),Number(offset));
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks/:id/retry', async (req, res) => {
  try {
    const db = getDb(); const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({error:'not found'});
    const { Queue } = await import('bullmq'); const { getRedis } = await import('../core/queue.js');
    db.prepare("UPDATE tasks SET status='pending',attempts=0,error=null WHERE id=?").run(task.id);
    const q = new Queue('traffic-actions',{connection:getRedis()});
    await q.add('task',{taskId:task.id,accountId:task.account_id,platform:task.platform,action:task.action,targetUrl:task.target_url});
    await q.close(); res.json({ok:true});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Settings ─────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try { res.json(JSON.parse(readFileSync(LIMITS_PATH,'utf8'))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/settings', (req, res) => {
  try { writeFileSync(LIMITS_PATH,JSON.stringify(req.body,null,2),'utf8'); res.json({ok:true}); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Logs ─────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  try {
    const { level,limit=200,offset=0 } = req.query; const db = getDb();
    let sql='SELECT * FROM logs'; const pr=[];
    if (level&&level!=='all') { sql+=' WHERE level=?'; pr.push(level); }
    sql+=' ORDER BY id DESC LIMIT ? OFFSET ?'; pr.push(Number(limit),Number(offset));
    res.json(db.prepare(sql).all(...pr));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`\n  Dashboard: http://localhost:${PORT}\n`));