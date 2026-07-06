import { writeFileSync } from 'fs';

const code = `
/* === Constants === */
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
  return '<span class="badge badge-' + esc(s) + '">' + esc(status||'?') + '</span>';
}

function renderProgress(jsonStr, platform) {
  if (!jsonStr) return '<span class="text-muted text-xs">---</span>';
  try {
    const counts = JSON.parse(jsonStr);
    const lims = _settings[platform] || {};
    const entries = Object.entries(counts).filter(([,v]) => Number(v) > 0);
    if (!entries.length) return '<span class="text-muted text-xs">---</span>';
    const rows = entries.map(([action, count]) => {
      const limit = lims[action] || 0;
      const pct = limit > 0 ? Math.min(100, Math.round(count / limit * 100)) : 0;
      const cls = pct >= 100 ? 'full' : pct >= 75 ? 'warn' : '';
      return '<div class="progress-row"><span class="progress-action">' + esc(action) + '</span><div class="progress-bar"><div class="progress-fill ' + cls + '" style="width:' + (limit ? pct : 0) + '%"></div></div><span class="progress-count">' + count + (limit ? '/' + limit : '') + '</span></div>';
    });
    return '<div class="progress-stack">' + rows.join('') + '</div>';
  } catch { return '<span class="text-muted text-xs">---</span>'; }
}

function actionPills(actions) {
  if (!Array.isArray(actions)) return '';
  return actions.map(a => '<span class="action-pill">' + esc(a) + '</span>').join(' ');
}

/* Toast */
function toast(msg, type) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'ok');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* Modal */
function openModal(title, body, footer) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer || '';
  document.getElementById('modal').showModal();
}
window.closeModal = () => document.getElementById('modal').close();

/* Campaign Drawer */
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

window.updateActionCheckboxes = function(platform) {
  const box = document.getElementById('action-boxes');
  const actions = PLATFORM_ACTIONS[platform] || [];
  if (!actions.length) { box.innerHTML = '<span style="font-size:12px;color:var(--muted)">Select platform first</span>'; return; }
  box.innerHTML = actions.map(a =>
    '<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" name="actions" value="' + esc(a) + '" style="accent-color:var(--accent)"> ' + esc(a) + '</label>'
  ).join('');
};

window.submitCampaign = async function(e) {
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

/* Router */
function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view === view));
  const el = document.getElementById('content');
  if (PLATFORMS.includes(view)) renderPlatform(view, el);
  else if (views[view]) views[view](el);
  location.hash = view;
}

/* === OVERVIEW === */
async function overview(el) {
  el.innerHTML = '<div class="view-header"><h1>Dashboard</h1><div class="view-actions"><button class="btn btn--secondary btn--sm" onclick="navigate(\'overview\')">Refresh</button></div></div><div id="ov-content"><div class="skeleton" style="height:200px;border-radius:12px"></div></div>';
  const stats = await api('GET', '/stats');
  const accs = stats.accounts || {};
  const tasks = stats.tasks || {};
  const total = Object.values(accs).reduce((s,v)=>s+v,0);
  const activity = (stats.recentActivity || []).slice(0, 15);

  const statsHtml = '<div class="stats-row">' +
    '<div class="stat-card accent"><div class="stat-value">' + total + '</div><div class="stat-label">Total Accounts</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (accs.idle||0) + '</div><div class="stat-label">Idle</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (accs.running||0) + '</div><div class="stat-label">Running</div></div>' +
    '<div class="stat-card error"><div class="stat-value">' + (accs.banned||0) + '</div><div class="stat-label">Banned</div></div>' +
    '<div class="stat-card accent"><div class="stat-value">' + (stats.campaigns||0) + '</div><div class="stat-label">Active Campaigns</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (tasks.done||0) + '</div><div class="stat-label">Tasks Done</div></div>' +
    '<div class="stat-card error"><div class="stat-value">' + (tasks.failed||0) + '</div><div class="stat-label">Failed</div></div>' +
    '</div>';

  const platformRows = PLATFORMS.map(p =>
    '<div class="platform-row" onclick="navigate(\'' + p + '\')" style="padding:8px 6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:pointer;border-radius:4px">' +
    '<span style="font-size:13px;font-weight:500;min-width:80px">' + capitalize(p) + '</span>' +
    '<span class="platform-counts" id="prow-' + p + '" style="font-size:11px;color:var(--muted);font-family:var(--mono)">Loading...</span>' +
    '</div>'
  ).join('');

  const activityHtml = activity.length ? activity.map(a =>
    '<div class="activity-item">' +
    '<span class="activity-user">' + esc(a.username||'?') + '</span>' +
    '<span class="action-pill">' + esc(a.action) + '</span>' +
    badge(a.status) +
    '<span class="activity-ts" style="margin-left:auto;font-size:11px;color:var(--muted)">' + fmt(a.finished_at) + '</span>' +
    '</div>'
  ).join('') : '<div class="text-muted" style="padding:12px 0;font-size:13px">No activity yet</div>';

  document.getElementById('ov-content').innerHTML = statsHtml +
    '<div class="overview-grid">' +
    '<div class="overview-card"><h3>Platforms</h3>' + platformRows + '</div>' +
    '<div class="overview-card"><h3>Recent Activity</h3>' + activityHtml + '</div>' +
    '</div>';

  PLATFORMS.forEach(async p => {
    try {
      const s = await api('GET', '/platform/' + p + '/stats');
      const sub = s.sub || {};
      const t = s.tasks || {};
      const total = Object.values(sub).reduce((a,v)=>a+v,0);
      const el2 = document.getElementById('prow-' + p);
      if (el2) el2.innerHTML =
        total + ' accounts &nbsp;' +
        '<span style="color:var(--accent)">' + (t.done||0) + ' done</span> &nbsp;' +
        '<span style="color:var(--error)">' + (t.failed||0) + ' failed</span> &nbsp;' +
        '<span style="color:var(--warn)">' + ((t.pending||0)+(t.running||0)) + ' pending</span>';
    } catch {}
  });
}
`;
writeFileSync(new URL('./src/ui/public/app_part1.js', import.meta.url), code, 'utf8');
console.log('part1 written');