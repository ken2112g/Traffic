/* u{2500} Constants u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500} */
const PLATFORMS = ['pinterest','instagram','tiktok','youtube','twitter','facebook'];
const PLATFORM_ACTIONS = {
  pinterest: ['like','follow','repin','comment'],
  instagram: ['like','follow','unfollow','comment','story_view'],
  tiktok:    ['like','follow','comment','view'],
  youtube:   ['like','subscribe','comment','view'],
  twitter:   ['like','follow','retweet','comment'],
  facebook:  ['like','follow','comment','share'],
};

/* State */
let currentView = 'overview';
const platformTab = {};
let _settings = {};
let sseConn = null;
let logLines = [];
let logLevelFilter = 'all';

/* API */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

/* Helpers */
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt  = dt => dt ? new Date(dt).toLocaleString('vi-VN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '---';
const fmtD = dt => dt ? new Date(dt).toLocaleDateString('vi-VN') : '---';
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

function badge(status) {
  const s = (status||'').toLowerCase();
  return <span class="badge badge-${esc(s)}">${esc(status||'?')}</span>;
}

function renderProgress(dailyCountsJson, platform) {
  if (!dailyCountsJson) return '<span class="text-muted text-xs">---</span>';
  try {
    const counts = JSON.parse(dailyCountsJson);
    const lims = _settings[platform] || {};
    const entries = Object.entries(counts).filter(([,v]) => Number(v) > 0);
    if (!entries.length) return '<span class="text-muted text-xs">---</span>';
    return '<div class="progress-stack">' + entries.map(([action, count]) => {
      const limit = lims[action] || 0;
      const pct = limit > 0 ? Math.min(100, Math.round(count / limit * 100)) : 0;
      const cls = pct >= 100 ? 'full' : pct >= 75 ? 'warn' : '';
      return <div class="progress-row"><span class="progress-action">${esc(action)}</span><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${limit ? pct : 0}%"></div></div><span class="progress-count">${count}${limit ? '/' + limit : ''}</span></div>;
    }).join('') + '</div>';
  } catch { return '<span class="text-muted text-xs">---</span>'; }
}

function actionPills(actions) {
  if (!Array.isArray(actions)) return '';
  return actions.map(a => <span class="action-pill">${esc(a)}</span>).join(' ');
}

/* Toast */
function toast(msg, type) {
  type = type || 'ok';
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* Modal */
function openModal(title, body, footer) {
  footer = footer || '';
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal').showModal();
}
window.closeModal = () => document.getElementById('modal').close();

/* Drawer */
function openDrawer(platform) {
  if (platform) {
    const sel = document.querySelector('#campaign-form [name="platform"]');
    if (sel) { sel.value = platform; updateActionCheckboxes(platform); }
  }
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}

window.updateActionCheckboxes = platform => {
  const box = document.getElementById('action-boxes');
  const actions = PLATFORM_ACTIONS[platform] || [];
  if (!actions.length) { box.innerHTML = '<span style="font-size:12px;color:var(--muted)">Select platform first</span>'; return; }
  box.innerHTML = actions.map(a =>
    '<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" name="actions" value="' + esc(a) + '" style="accent-color:var(--accent)"> ' + esc(a) + '</label>'
  ).join('');
};

window.submitCampaign = async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const actions = [...e.target.querySelectorAll('[name="actions"]:checked')].map(c => c.value);
  if (!actions.length) { toast('Select at least one action', 'error'); return; }
  try {
    await api('POST', '/campaigns', { name: fd.get('name'), platform: fd.get('platform'), target_account: fd.get('target_account'), target_url: fd.get('target_url') || null, actions, schedule: fd.get('schedule') || 'auto', account_ids: fd.get('account_ids') });
    toast('Campaign created'); closeDrawer(); e.target.reset();
    if (PLATFORMS.includes(currentView)) navigate(currentView);
  } catch (err) { toast(err.message, 'error'); }
};
