import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export class ProxyManager {
  constructor() {
    this.db = getDb();
  }

  addProxy({ host, port, username = '', password = '', protocol = 'http', type = 'static', notes = '' }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO proxies (id, host, port, username, password, protocol, type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, host, port, username, password, protocol, type, notes);
    logger.info('ProxyManager', `Added proxy ${protocol}://${host}:${port}`);
    return id;
  }

  addProxiesBulk(proxies) {
    const insert = this.db.prepare(`
      INSERT INTO proxies (id, host, port, username, password, protocol, type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ids = [];
    const tx = this.db.transaction(() => {
      for (const p of proxies) {
        const id = randomUUID();
        insert.run(id, p.host, p.port, p.username || '', p.password || '', p.protocol || 'http', p.type || 'static', p.notes || '');
        ids.push(id);
      }
    });
    tx();
    logger.info('ProxyManager', `Bulk added ${proxies.length} proxies`);
    return ids;
  }

  parseProxyString(str, protocol = 'http', type = 'static') {
    const parts = str.trim().split(':');
    if (parts.length < 2) throw new Error(`Invalid proxy string: ${str}`);
    return {
      host: parts[0],
      port: parseInt(parts[1]),
      username: parts[2] || '',
      password: parts[3] || '',
      protocol,
      type,
    };
  }

  importFromText(text, protocol = 'http', type = 'static') {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const proxies = lines.map(l => this.parseProxyString(l, protocol, type));
    return this.addProxiesBulk(proxies);
  }

  getProxy(id) {
    return this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
  }

  getActiveProxies() {
    return this.db.prepare('SELECT * FROM proxies WHERE status = "active"').all();
  }

  getFreeProxy() {
    return this.db.prepare(`
      SELECT p.* FROM proxies p
      LEFT JOIN accounts a ON a.proxy_id = p.id
      WHERE p.status = "active" AND a.id IS NULL
      LIMIT 1
    `).get();
  }

  getAllProxies() {
    return this.db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all();
  }

  setStatus(id, status) {
    this.db.prepare('UPDATE proxies SET status = ? WHERE id = ?').run(status, id);
  }

  deleteProxy(id) {
    this.db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
  }

  autoAssignToAccounts() {
    const unassigned = this.db.prepare(`
      SELECT id FROM accounts WHERE proxy_id IS NULL AND status != "banned"
    `).all();

    let assigned = 0;
    for (const acc of unassigned) {
      const proxy = this.getFreeProxy();
      if (!proxy) break;
      this.db.prepare('UPDATE accounts SET proxy_id = ? WHERE id = ?').run(proxy.id, acc.id);
      assigned++;
    }
    logger.info('ProxyManager', `Auto-assign: assigned ${assigned}/${unassigned.length} accounts`);
    return assigned;
  }

  async testProxy(id) {
    const proxy = this.getProxy(id);
    if (!proxy) throw new Error('Proxy not found');

    const url      = 'https://api.ipify.org?format=json';
    const proxyUrl = this._buildProxyUrl(proxy);
    const start    = Date.now();

    try {
      // Use undici ProxyAgent (built into Node 18+) -- no extra dependency needed
      const { ProxyAgent } = await import('undici');
      const res     = await fetch(url, { dispatcher: new ProxyAgent(proxyUrl) });
      const data    = await res.json();
      const latency = Date.now() - start;

      this.db.prepare(`
        UPDATE proxies SET status = "active", last_check = datetime("now"), latency_ms = ? WHERE id = ?
      `).run(latency, id);

      logger.info('ProxyManager', `Proxy ${proxy.host}:${proxy.port} OK -- IP: ${data.ip} -- ${latency}ms`);
      return { ok: true, ip: data.ip, latency };
    } catch (err) {
      this.db.prepare(`
        UPDATE proxies SET status = "dead", last_check = datetime("now") WHERE id = ?
      `).run(id);
      logger.warn('ProxyManager', `Proxy ${proxy.host}:${proxy.port} DEAD -- ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async testAll() {
    const proxies = this.getActiveProxies();
    const results = await Promise.allSettled(proxies.map(p => this.testProxy(p.id)));
    const alive   = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    logger.info('ProxyManager', `Test done: ${alive}/${proxies.length} alive`);
    return alive;
  }

  _buildProxyUrl(proxy) {
    const auth = proxy.username ? `${proxy.username}:${proxy.password}@` : '';
    return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
  }

  getPlaywrightProxy(accountId) {
    const acc = this.db.prepare('SELECT proxy_id FROM accounts WHERE id = ?').get(accountId);
    if (!acc?.proxy_id) return null;

    const proxy = this.getProxy(acc.proxy_id);
    if (!proxy) return null;

    return {
      server:   `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      username: proxy.username || undefined,
      password: proxy.password || undefined,
    };
  }

  getStats() {
    return {
      total:  this.db.prepare('SELECT COUNT(*) as c FROM proxies').get().c,
      active: this.db.prepare('SELECT COUNT(*) as c FROM proxies WHERE status = "active"').get().c,
      dead:   this.db.prepare('SELECT COUNT(*) as c FROM proxies WHERE status = "dead"').get().c,
    };
  }
}

export const proxyManager = new ProxyManager();