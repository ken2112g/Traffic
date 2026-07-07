import 'dotenv/config';
import { getDb } from '../db/schema.js';

// Telegram 2-way bot — nhận lệnh từ chat để điều khiển tool từ xa
// Lệnh: /stats /campaigns /pause <id> /resume <id> /reset /help

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

let _offset = 0;

async function tgPost(method, body) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch { return null; }
}

async function reply(chatId, text) {
  return tgPost('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

async function handleCommand(text, chatId) {
  const db    = getDb();
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();

  if (cmd === '/stats' || cmd === '/s') {
    const accs  = db.prepare('SELECT status, COUNT(*) as n FROM accounts GROUP BY status').all();
    const tasks = db.prepare("SELECT status, COUNT(*) as n FROM tasks WHERE DATE(created_at)=DATE('now') GROUP BY status").all();
    const toMap = rows => Object.fromEntries(rows.map(r => [r.status, r.n]));
    const a = toMap(accs); const t = toMap(tasks);
    return reply(chatId,
      `📊 <b>Stats hôm nay</b>\n\n` +
      `👥 Accounts: ${a.idle||0} idle · ${a.running||0} running · ${a.banned||0} banned · ${a.error||0} error\n` +
      `📋 Tasks: ${t.done||0} done · ${t.failed||0} failed · ${(t.pending||0)+(t.running||0)} pending`
    );
  }

  if (cmd === '/campaigns' || cmd === '/c') {
    const rows = db.prepare('SELECT id, name, platform, is_active FROM campaigns ORDER BY created_at DESC LIMIT 10').all();
    if (!rows.length) return reply(chatId, 'Chưa có campaign nào.');
    const list = rows.map(c =>
      `${c.is_active ? '✅' : '⏸'} <b>${c.name}</b> [${c.platform}]\n  <code>${c.id.slice(0,8)}</code>`
    ).join('\n\n');
    return reply(chatId, `📋 <b>Campaigns</b>\n\n${list}\n\n<i>Dùng 8 ký tự đầu của ID cho /pause /resume</i>`);
  }

  if (cmd === '/pause') {
    const prefix = parts[1];
    if (!prefix) return reply(chatId, 'Usage: /pause &lt;campaign_id&gt;');
    const c = db.prepare('SELECT * FROM campaigns WHERE id LIKE ?').get(`${prefix}%`);
    if (!c) return reply(chatId, `❌ Không tìm thấy: ${prefix}`);
    db.prepare('UPDATE campaigns SET is_active=0 WHERE id=?').run(c.id);
    return reply(chatId, `⏸ Đã tạm dừng: <b>${c.name}</b>`);
  }

  if (cmd === '/resume') {
    const prefix = parts[1];
    if (!prefix) return reply(chatId, 'Usage: /resume &lt;campaign_id&gt;');
    const c = db.prepare('SELECT * FROM campaigns WHERE id LIKE ?').get(`${prefix}%`);
    if (!c) return reply(chatId, `❌ Không tìm thấy: ${prefix}`);
    db.prepare('UPDATE campaigns SET is_active=1 WHERE id=?').run(c.id);
    return reply(chatId, `▶️ Đã tiếp tục: <b>${c.name}</b>`);
  }

  if (cmd === '/reset') {
    const count = db.prepare("UPDATE accounts SET status='idle', updated_at=datetime('now') WHERE status='error'").run().changes;
    return reply(chatId, `✅ Reset ${count} error accounts → idle`);
  }

  if (cmd === '/banned') {
    const rows = db.prepare("SELECT platform, username FROM accounts WHERE status='banned' ORDER BY updated_at DESC LIMIT 15").all();
    if (!rows.length) return reply(chatId, '✅ Không có account nào bị ban.');
    return reply(chatId, '🚫 <b>Accounts bị ban:</b>\n' + rows.map(a => `• [${a.platform}] ${a.username}`).join('\n'));
  }

  if (cmd === '/help' || cmd === '/start' || cmd === '/h') {
    return reply(chatId,
      '🤖 <b>Traffic Tool Bot</b>\n\n' +
      '/stats — Thống kê accounts + tasks hôm nay\n' +
      '/campaigns — Danh sách campaigns\n' +
      '/pause &lt;id&gt; — Tạm dừng campaign\n' +
      '/resume &lt;id&gt; — Tiếp tục campaign\n' +
      '/reset — Reset toàn bộ error accounts → idle\n' +
      '/banned — Danh sách accounts bị ban\n' +
      '/help — Xem hướng dẫn này'
    );
  }

  return reply(chatId, '❓ Lệnh không hợp lệ. Gửi /help để xem hướng dẫn.');
}

async function pollUpdates() {
  if (!BOT_TOKEN) return;
  try {
    const res = await tgPost('getUpdates', { offset: _offset + 1, timeout: 10, limit: 20 });
    if (!res?.ok || !res.result?.length) return;

    for (const update of res.result) {
      _offset = update.update_id;
      const msg = update.message;
      if (!msg?.text || !msg.text.startsWith('/')) continue;

      // Chỉ xử lý chat từ CHAT_ID được cấu hình — bảo mật
      if (CHAT_ID && String(msg.chat.id) !== String(CHAT_ID)) {
        await reply(msg.chat.id, '❌ Unauthorized — bot này là private.');
        continue;
      }

      await handleCommand(msg.text, msg.chat.id);
    }
  } catch {}
}

export function startTelegramBot() {
  if (!BOT_TOKEN) {
    console.log('[TelegramBot] TELEGRAM_BOT_TOKEN không được cấu hình — bỏ qua');
    return null;
  }
  // Poll mỗi 5 giây
  const interval = setInterval(pollUpdates, 5000);
  console.log('[TelegramBot] Started — polling every 5s. Gửi /help trong chat để bắt đầu.');
  return interval;
}