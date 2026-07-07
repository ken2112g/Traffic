import { logger } from './logger.js';

const BASE = 'https://api.mail.tm';

export class TempMail {
  constructor() {
    this.email    = null;
    this.password = null;
    this.token    = null;
  }

  async create() {
    const dr = await fetch(`${BASE}/domains?page=1`);
    if (!dr.ok) throw new Error(`TempMail: khong lay duoc domain (${dr.status})`);
    const dd = await dr.json();
    const domain = dd['hydra:member']?.[0]?.domain;
    if (!domain) throw new Error('TempMail: khong co domain kha dung');

    const user = Math.random().toString(36).slice(2, 10) + Math.floor(Math.random() * 999);
    this.email    = `${user}@${domain}`;
    this.password = Math.random().toString(36).slice(2, 14) + 'A1!';

    const cr = await fetch(`${BASE}/accounts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address: this.email, password: this.password }),
    });
    if (!cr.ok) throw new Error(`TempMail: tao mailbox that bai (${cr.status})`);

    const tr = await fetch(`${BASE}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address: this.email, password: this.password }),
    });
    if (!tr.ok) throw new Error(`TempMail: lay token that bai (${tr.status})`);
    const td = await tr.json();
    this.token = td.token;

    logger.info('TempMail', `Da tao email: ${this.email}`);
    return this.email;
  }

  async waitForEmail(keyword = 'Pinterest', timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    logger.info('TempMail', `Dang cho email chua "${keyword}"...`);
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000));
      const r = await fetch(`${BASE}/messages?page=1`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!r.ok) continue;
      const d = await r.json();
      const msgs = d['hydra:member'] || [];
      const found = msgs.find(m =>
        m.subject?.toLowerCase().includes(keyword.toLowerCase()) ||
        m.from?.address?.toLowerCase().includes('pinterest')
      );
      if (found) {
        const mr = await fetch(`${BASE}/messages/${found.id}`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        return await mr.json();
      }
    }
    throw new Error('Timeout: khong nhan duoc email xac nhan sau 2 phut');
  }

  extractVerifyLink(msg) {
    const html = msg.html?.[0]?.body || '';
    const text = msg.text || '';
    const content = html || text;
    const patterns = [
      /href="(https:\/\/[^"]*pinterest\.[^"]*(?:confirm|verify|activate|email)[^"]*)"/i,
      /(https:\/\/[^"'\s]*pinterest\.[^"'\s]*(?:confirm|verify|activate)[^"'\s]*)/i,
    ];
    for (const re of patterns) {
      const m = content.match(re);
      if (m) return m[1];
    }
    return null;
  }
}