
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
  el.innerHTML = '<div class="view-header"><h1>Dashboard</h1><div class="view-actions"><button class="btn btn--secondary btn--sm" onclick="navigate(\'overview&apos;)">Refresh</button></div></div><div id="ov-content"><div class="skeleton" style="height:200px;border-radius:12px"></div></div>';
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
    `<div class="platform-row" onclick="navigate('${p}')" style="padding:8px 6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:pointer;border-radius:4px">` +
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



/* === PLATFORM VIEW === */
const PTAB_LABELS = { 'sub-accounts': 'Sub Accounts', targets: 'Targets', campaigns: 'Campaigns', tasks: 'Tasks' };

async function renderPlatform(platform, el) {
  const tab = platformTab[platform] || 'sub-accounts';
  const colorMap = { pinterest:'--pin', instagram:'--ig', tiktok:'--tt', youtube:'--yt', twitter:'--tw', facebook:'--fb' };
  const color = colorMap[platform] || '--accent';
  const tabBtns = Object.entries(PTAB_LABELS).map(([k,v]) =>
    `<button class="ptab ${tab===k?'active':''}" onclick="setPlatformTab('${platform}','${k}')">${v}</button>`
  ).join('');

  el.innerHTML =
    '<div class="view-header">' +
    '<h1 style="color:var(' + color + ')">' + capitalize(platform) + '</h1>' +
    '<div class="view-actions">' +
    `<button class="btn btn--secondary btn--sm" onclick="renderPlatform('${platform}',document.getElementById('content'))">Refresh</button>` +
    `<button class="btn btn--primary btn--sm" onclick="openDrawer('${platform}')">+ Campaign</button>` +
    `<button class="btn btn--secondary btn--sm" onclick="showAddAccount('${platform}')">+ Account</button>` +
    '</div></div>' +
    '<div class="ptabs">' + tabBtns + '</div>' +
    '<div id="ptab-content"></div>';

  await renderPlatformTab(platform, tab);
}

window.setPlatformTab = async function(platform, tab) {
  platformTab[platform] = tab;
  document.querySelectorAll('.ptab').forEach((btn, i) => {
    const k = Object.keys(PTAB_LABELS)[i];
    btn.classList.toggle('active', k === tab);
  });
  await renderPlatformTab(platform, tab);
};

async function renderPlatformTab(platform, tab) {
  const el = document.getElementById('ptab-content');
  if (!el) return;
  el.innerHTML = '<div class="skeleton" style="height:120px;border-radius:8px;margin-top:8px"></div>';
  if (tab === 'sub-accounts') await renderSubAccounts(platform, el);
  else if (tab === 'targets')  await renderTargets(platform, el);
  else if (tab === 'campaigns') await renderPlatformCampaigns(platform, el);
  else if (tab === 'tasks')    await renderPlatformTasks(platform, el);
}

/* Sub Accounts tab */
async function renderSubAccounts(platform, el) {
  if (!Object.keys(_settings).length) {
    try { _settings = await api('GET', '/settings'); } catch {}
  }
  const [stats, accounts] = await Promise.all([
    api('GET', '/platform/' + platform + '/stats'),
    api('GET', '/accounts?platform=' + platform),
  ]);
  const sub = stats.sub || {};
  const subAccounts = accounts.filter(a => a.role === 'sub');
  const mainAccounts = accounts.filter(a => a.role === 'main');

  const subBadges = Object.entries(sub).map(([s,n]) =>
    '<span class="stat-badge ' + s + '">' + n + ' ' + s + '</span>'
  ).join('');

  const mainTable = mainAccounts.length ? (
    '<div style="margin-bottom:16px">' +
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Main Accounts (Being Buffed)</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Username</th><th>Status</th><th>Session</th><th>Proxy</th><th>Actions</th></tr></thead><tbody>' +
    mainAccounts.map(a =>
      '<tr><td class="td-mono">' + esc(a.username) + '</td>' +
      '<td>' + badge(a.status) + '</td>' +
      '<td><span class="session-dot ' + (a.session_path?'ok':'') + '">' + (a.session_path?'Saved':'None') + '</span></td>' +
      '<td class="proxy-badge">' + (a.proxy_host ? esc(a.proxy_host)+':'+a.proxy_port : '---') + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--danger" onclick="banAccount(${a.id})">Ban</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteAccount(${a.id})">Del</button>` +
      '</div></td></tr>'
    ).join('') + '</tbody></table></div></div>'
  ) : '';

  el.innerHTML =
    '<div class="stat-badges" style="margin-bottom:16px">' +
    '<span class="stat-badge idle">' + Object.values(sub).reduce((a,v)=>a+v,0) + ' total sub</span>' +
    subBadges +
    (mainAccounts.length ? '<span class="stat-badge running" style="margin-left:auto">' + mainAccounts.length + ' main</span>' : '') +
    '</div>' +
    '<div class="filter-bar">' +
    '<input type="text" id="acc-search" placeholder="Search username..." oninput="filterSubTable()" style="min-width:200px">' +
    '<select id="acc-status-filter" onchange="filterSubTable()"><option value="all">All status</option><option value="idle">Idle</option><option value="running">Running</option><option value="banned">Banned</option><option value="error">Error</option></select>' +
    `<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts('${platform}')">Import CSV</button>` +
    '</div>' +
    mainTable +
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Sub Accounts (' + subAccounts.length + ')</div>' +
    '<div class="table-wrap"><table id="sub-table">' +
    '<thead><tr><th>Username</th><th>Status</th><th>Daily Progress</th><th>Session</th><th>Proxy</th><th class="col-actions">Actions</th></tr></thead>' +
    '<tbody id="sub-tbody">' + renderSubRows(subAccounts, platform) + '</tbody>' +
    '</table></div>';
}

function renderSubRows(rows, platform) {
  if (!rows.length) return '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">X</div><h3>No sub accounts</h3><p>Add accounts or import CSV above</p></div></td></tr>';
  return rows.map(a =>
    '<tr data-username="' + esc(a.username) + '" data-status="' + esc(a.status) + '">' +
    '<td class="td-mono">' + esc(a.username) + '</td>' +
    '<td>' + badge(a.status) + '</td>' +
    '<td>' + renderProgress(a.daily_counts, platform) + '</td>' +
    '<td><span class="session-dot ' + (a.session_path?'ok':'') + '">' + (a.session_path?'Saved':'None') + '</span></td>' +
    '<td class="proxy-badge">' + (a.proxy_host ? esc(a.proxy_host)+':'+a.proxy_port : '---') + '</td>' +
    '<td class="col-actions"><div class="gap-actions">' +
    `<button class="btn btn--xs btn--secondary" onclick="banAccount(${a.id})">Ban</button>` +
    `<button class="btn btn--xs btn--danger" onclick="deleteAccount(${a.id})">Del</button>` +
    '</div></td></tr>'
  ).join('');
}

window.filterSubTable = function() {
  const q = (document.getElementById('acc-search')?.value||'').toLowerCase();
  const s = document.getElementById('acc-status-filter')?.value || 'all';
  document.querySelectorAll('#sub-tbody tr[data-username]').forEach(row => {
    const nameOk = !q || row.dataset.username.toLowerCase().includes(q);
    const statOk = s === 'all' || row.dataset.status === s;
    row.style.display = nameOk && statOk ? '' : 'none';
  });
};

/* Targets tab */
async function renderTargets(platform, el) {
  const targets = await api('GET', '/platform/' + platform + '/targets');
  if (!targets.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9711;</div><h3>No targets yet</h3><p>Create campaigns to buff accounts on ' + capitalize(platform) + '</p>' + `<button class="btn btn--primary" style="margin-top:16px" onclick="openDrawer('${platform}')">+ Create Campaign</button>` + '</div>';
    return;
  }
  const cards = targets.map(t => {
    const campRows = t.campaigns.map(c =>
      '<div class="target-campaign-row">' +
      '<span class="target-campaign-name">' + esc(c.name) + '</span>' +
      '<div class="target-campaign-meta">' + actionPills(c.actions) +
      '<span class="text-muted text-xs">' + c.acc + ' accs</span>' +
      (c.is_active ? '<span class="badge badge-active">ON</span>' : '<span class="badge badge-idle">OFF</span>') +
      '</div></div>'
    ).join('');
    return '<div class="target-card">' +
      '<div class="target-card-header"><div>' +
      '<div class="target-name">@' + esc(t.target) + '</div>' +
      (t.url ? '<div class="target-url">' + esc(t.url) + '</div>' : '') +
      '</div><span class="badge badge-info">' + t.campaigns.length + ' campaign' + (t.campaigns.length!==1?'s':'') + '</span></div>' +
      '<div class="target-stats">' +
      '<div class="target-stat"><div class="target-stat-value done">' + t.done + '</div><div class="target-stat-label">Done</div></div>' +
      '<div class="target-stat"><div class="target-stat-value failed">' + t.failed + '</div><div class="target-stat-label">Failed</div></div>' +
      '<div class="target-stat"><div class="target-stat-value pending">' + t.pending + '</div><div class="target-stat-label">Pending</div></div>' +
      '</div><div class="target-campaigns">' + campRows + '</div></div>';
  }).join('');
  el.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:16px">Target accounts being buffed by ' + capitalize(platform) + ' sub-accounts</div><div class="target-grid">' + cards + '</div>';
}

/* Campaigns tab */
async function renderPlatformCampaigns(platform, el) {
  const campaigns = await api('GET', '/campaigns?platform=' + platform);
  let html = `<div class="view-actions" style="margin-bottom:16px"><button class="btn btn--primary btn--sm" onclick="openDrawer('${platform}')">+ New Campaign</button></div>`;
  if (!campaigns.length) {
    html += '<div class="empty-state"><div class="empty-state-icon">C</div><h3>No campaigns</h3><p>Create a campaign to start buffing a target</p></div>';
  } else {
    const rows = campaigns.map(c =>
      '<tr><td style="font-weight:500">' + esc(c.name) + '</td>' +
      '<td class="td-mono">@' + esc(c.target_account) + '</td>' +
      '<td>' + actionPills(c.actions) + '</td>' +
      '<td class="td-sm">' + esc(c.schedule==='auto'?'8am daily':c.schedule) + '</td>' +
      '<td class="td-sm">' + c.account_count + '</td>' +
      '<td>' + (c.is_active ? badge('active') : badge('idle')) + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--secondary" onclick="toggleCampaign('${c.id}')">${c.is_active?'Pause':'Resume'}</button>` +
      `<button class="btn btn--xs btn--secondary" onclick="triggerCampaign('${c.id}')">Run</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteCampaign('${c.id}')">Del</button>` +
      '</div></td></tr>'
    ).join('');
    html += '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Target</th><th>Actions</th><th>Schedule</th><th>Accounts</th><th>Status</th><th class="col-actions">Manage</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  el.innerHTML = html;
}

/* Tasks tab */
async function renderPlatformTasks(platform, el) {
  el.innerHTML =
    '<div class="filter-bar" style="margin-bottom:16px">' +
    `<select id="ptask-status" onchange="reloadPlatformTasks('${platform}')">` +
    '<option value="all">All status</option><option value="done">Done</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="running">Running</option>' +
    '</select>' +
    `<button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks('${platform}')">Refresh</button>` +
    '</div><div id="ptasks-wrap"><div class="skeleton" style="height:200px;border-radius:8px"></div></div>';
  await reloadPlatformTasks(platform);
}

window.reloadPlatformTasks = async function(platform) {
  const status = document.getElementById('ptask-status')?.value || 'all';
  const wrap = document.getElementById('ptasks-wrap');
  if (!wrap) return;
  try {
    const tasks = await api('GET', '/tasks?platform=' + platform + '&status=' + status + '&limit=100');
    if (!tasks.length) { wrap.innerHTML = '<div class="empty-state"><h3>No tasks</h3></div>'; return; }
    const rows = tasks.map(t =>
      '<tr><td class="td-mono">' + esc(t.account_username||'?') + '</td>' +
      '<td><span class="action-pill">' + esc(t.action) + '</span></td>' +
      '<td>' + badge(t.status) + '</td>' +
      '<td class="td-sm">' + esc(t.campaign_name||'---') + '</td>' +
      '<td class="td-sm">' + fmt(t.finished_at) + '</td>' +
      `<td class="col-actions">' + (t.status==='failed' ? '<button class="btn btn--xs btn--secondary" onclick="retryTask(${t.id})">Retry</button>' : '') + '</td></tr>`
    ).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Account</th><th>Action</th><th>Status</th><th>Campaign</th><th>Finished</th><th>Retry</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
};


/* === PROXIES === */
async function proxies(el) {
  el.innerHTML = '<div class="view-header"><h1>Proxies</h1><div class="view-actions">' +
    '<button class="btn btn--secondary btn--sm" onclick="showBulkProxies()">Bulk Import</button>' +
    '<button class="btn btn--secondary btn--sm" onclick="autoAssignProxies()">Auto Assign</button>' +
    '<button class="btn btn--primary btn--sm" onclick="showAddProxy()">+ Add Proxy</button>' +
    '</div></div><div id="proxy-list"><div class="skeleton" style="height:200px;border-radius:8px"></div></div>';
  await reloadProxies();
}
async function reloadProxies() {
  const wrap = document.getElementById('proxy-list');
  if (!wrap) return;
  try {
    const rows = await api('GET', '/proxies');
    if (!rows.length) { wrap.innerHTML = '<div class="empty-state"><h3>No proxies</h3><p>Add proxies to assign to accounts</p></div>'; return; }
    const trows = rows.map(p =>
      '<tr><td class="td-mono">' + esc(p.host) + ':' + p.port + '</td>' +
      '<td class="td-sm">' + (p.username ? esc(p.username) : '--') + '</td>' +
      '<td class="td-sm">' + esc(p.type||'static') + '</td>' +
      '<td>' + badge(p.status||'active') + '</td>' +
      '<td class="td-sm">' + (p.latency_ms ? p.latency_ms+'ms' : '--') + '</td>' +
      '<td class="td-sm">' + fmtD(p.last_check) + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--secondary" onclick="testProxy(${p.id})">Test</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteProxy(${p.id})">Del</button>` +
      '</div></td></tr>'
    ).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Host:Port</th><th>Auth</th><th>Type</th><th>Status</th><th>Latency</th><th>Last Check</th><th>Actions</th></tr></thead><tbody>' + trows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
}
window.showAddProxy = function() {
  openModal('Add Proxy',
    '<div class="form-group"><label class="form-label">Host *</label><input class="form-input" id="px-host" placeholder="proxy.example.com"></div>' +
    '<div class="form-group"><label class="form-label">Port *</label><input class="form-input" id="px-port" type="number" placeholder="8080"></div>' +
    '<div class="form-group"><label class="form-label">Username</label><input class="form-input" id="px-user" placeholder="optional"></div>' +
    '<div class="form-group"><label class="form-label">Password</label><input class="form-input" id="px-pass" type="password"></div>' +
    '<div class="form-group"><label class="form-label">Protocol</label><select class="form-input" id="px-proto"><option>http</option><option>https</option><option>socks5</option></select></div>' +
    '<div class="form-group"><label class="form-label">Type</label><select class="form-input" id="px-type"><option>static</option><option>rotating</option><option>mobile</option></select></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Cancel</button><button class="btn btn--primary" onclick="submitAddProxy()">Add</button>'
  );
};
window.submitAddProxy = async function() {
  const host = document.getElementById('px-host').value.trim();
  const port = document.getElementById('px-port').value.trim();
  if (!host||!port) { toast('Host and port required','error'); return; }
  try {
    await api('POST','/proxies',{host,port:Number(port),username:document.getElementById('px-user').value||null,password:document.getElementById('px-pass').value||null,protocol:document.getElementById('px-proto').value,type:document.getElementById('px-type').value});
    toast('Proxy added'); closeModal(); reloadProxies();
  } catch(err){toast(err.message,'error');}
};
window.showBulkProxies = function() {
  openModal('Bulk Import Proxies',
    '<div class="form-group"><label class="form-label">One proxy per line: host:port or host:port:user:pass</label>' +
    '<textarea class="form-input" id="bulk-proxy-text" rows="8" placeholder="1.2.3.4:8080"></textarea></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Cancel</button><button class="btn btn--primary" onclick="submitBulkProxies()">Import</button>'
  );
};
window.submitBulkProxies = async function() {
  const text = (document.getElementById('bulk-proxy-text').value||'').trim();
  if (!text) return;
  try { const r = await api('POST','/proxies/bulk',{text}); toast('Imported '+r.count+' proxies'); closeModal(); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.testProxy = async function(id) {
  toast('Testing...','info');
  try { const r=await api('POST','/proxies/'+id+'/test'); toast(r.ok?'OK - '+r.ip+' - '+r.latency+'ms':'Dead: '+r.error, r.ok?'ok':'error'); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.deleteProxy = async function(id) {
  if (!confirm('Delete proxy?')) return;
  try { await api('DELETE','/proxies/'+id); toast('Deleted'); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.autoAssignProxies = async function() {
  try { const r=await api('POST','/proxies/assign'); toast('Assigned '+r.assigned+' accounts'); }
  catch(err){toast(err.message,'error');}
};

/* === LOGS === */
async function logs(el) {
  el.innerHTML = '<div class="view-header"><h1>Logs</h1><div class="view-actions">' +
    '<select id="log-level" onchange="logLevelFilter=this.value;renderLogFeed()">' +
    '<option value="all">All</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option><option value="debug">Debug</option>' +
    '</select><button class="btn btn--secondary btn--sm" onclick="logLines=[];renderLogFeed();connectSSE()">Clear</button></div></div>' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px"><div class="log-feed" id="log-feed"></div></div>';
  try { const rows=await api('GET','/logs?limit=200'); logLines=rows.reverse(); renderLogFeed(); } catch{}
  connectSSE();
}
function connectSSE() {
  if (sseConn){sseConn.close();sseConn=null;}
  if (currentView!=='logs') return;
  sseConn = new EventSource('/api/logs/stream');
  sseConn.onmessage = function(e) {
    const entry=JSON.parse(e.data);
    logLines.unshift(entry);
    if (logLines.length>500) logLines.length=500;
    const feed=document.getElementById('log-feed');
    if (feed) {
      const div=document.createElement('div');
      div.innerHTML=logEntryHtml(entry);
      feed.prepend(div.firstChild);
      while(feed.children.length>500) feed.lastChild.remove();
    }
  };
}
function logEntryHtml(e) {
  const lvl=(e.level||'info').toLowerCase();
  return '<div class="log-entry"><span class="log-ts">'+fmt(e.created_at)+'</span>' +
    '<span class="log-level '+lvl+'">'+lvl.toUpperCase()+'</span>' +
    '<span class="log-source">['+esc(e.source||'?')+']</span>' +
    '<span class="log-msg">'+esc(e.message)+'</span></div>';
}
function renderLogFeed() {
  const feed=document.getElementById('log-feed');
  if (!feed) return;
  const filtered=logLevelFilter==='all'?logLines:logLines.filter(l=>l.level===logLevelFilter);
  feed.innerHTML = filtered.length ? filtered.map(logEntryHtml).join('') : '<div class="text-muted text-xs" style="padding:8px">No logs</div>';
}

/* === SETTINGS === */
async function settings(el) {
  el.innerHTML = '<div class="view-header"><h1>Settings</h1><div class="view-actions"><button class="btn btn--secondary btn--sm" onclick="navigate(\'settings&apos;)">Reload</button></div></div>' +
    '<div id="settings-body"><div class="skeleton" style="height:200px;border-radius:12px"></div></div>';
  try {
    _settings = await api('GET','/settings');
    document.getElementById('settings-body').innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:16px">Per-platform limits. Save after editing.</div>' +
      '<div class="settings-grid">'+Object.keys(_settings).map(p=>renderSettingsCard(p)).join('')+'</div>';
  } catch(err){document.getElementById('settings-body').innerHTML='<div class="error-text">'+esc(err.message)+'</div>';}
}
function renderSettingsCard(platform) {
  const cfg=_settings[platform]||{};
  const numeric=Object.entries(cfg).filter(([k,v])=>typeof v==='number'&&!k.includes('Hours'));
  const hours=cfg.activeHours||[7,23];
  const rows=numeric.map(([k,v])=>'<div class="settings-row"><span class="settings-row-label">'+k+'</span><input type="number" id="cfg-'+platform+'-'+k+'" value="'+v+'" min="0"></div>').join('');
  return '<div class="settings-card"><h3>'+capitalize(platform)+'</h3>'+rows+
    '<div class="settings-row"><span class="settings-row-label">activeHours[0]</span><input type="number" id="cfg-'+platform+'-activeHours-0" value="'+hours[0]+'" min="0" max="23"></div>' +
    '<div class="settings-row"><span class="settings-row-label">activeHours[1]</span><input type="number" id="cfg-'+platform+'-activeHours-1" value="'+hours[1]+'" min="0" max="23"></div>' +
    `<div style="margin-top:12px"><button class="btn btn--primary btn--sm" onclick="savePlatformSettings('${platform}')">Save</button></div></div>`;
}
window.savePlatformSettings = async function(platform) {
  try {
    const cfg=Object.assign({},_settings[platform]);
    Object.keys(cfg).filter(k=>typeof cfg[k]==='number'&&!k.includes('Hours')).forEach(k=>{
      const el=document.getElementById('cfg-'+platform+'-'+k);
      if(el) cfg[k]=Number(el.value);
    });
    const h0=document.getElementById('cfg-'+platform+'-activeHours-0');
    const h1=document.getElementById('cfg-'+platform+'-activeHours-1');
    if(h0&&h1) cfg.activeHours=[Number(h0.value),Number(h1.value)];
    _settings[platform]=cfg;
    await api('PUT','/settings',_settings);
    toast(capitalize(platform)+' saved');
  } catch(err){toast(err.message,'error');}
};

/* === SHARED ACCOUNT/CAMPAIGN ACTIONS === */
window.showAddAccount = function(platform) {
  const opts=['pinterest','instagram','tiktok','youtube','twitter','facebook'].map(p=>
    '<option value="'+p+'"'+(p===platform?' selected':'')+'>'+capitalize(p)+'</option>'
  ).join('');
  openModal('Add Account',
    '<div class="form-group"><label class="form-label">Platform</label><select class="form-input" id="add-acc-platform">'+opts+'</select></div>' +
    '<div class="form-group"><label class="form-label">Username / Email *</label><input class="form-input" id="add-acc-user" placeholder="user@example.com"></div>' +
    '<div class="form-group"><label class="form-label">Password *</label><input class="form-input" id="add-acc-pass" type="password"></div>' +
    '<div class="form-group"><label class="form-label">Role</label><select class="form-input" id="add-acc-role"><option value="sub">Sub (buff worker)</option><option value="main">Main (target)</option></select></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Cancel</button><button class="btn btn--primary" onclick="submitAddAccount()">Add</button>'
  );
};
window.submitAddAccount = async function() {
  const platform=document.getElementById('add-acc-platform').value;
  const username=document.getElementById('add-acc-user').value.trim();
  const password=document.getElementById('add-acc-pass').value;
  const role=document.getElementById('add-acc-role').value;
  if(!username||!password){toast('Username and password required','error');return;}
  try {
    await api('POST','/accounts',{platform,username,password,role});
    toast('Account added'); closeModal();
    if(currentView===platform) navigate(platform);
  } catch(err){toast(err.message,'error');}
};
window.showBulkAccounts = function(platform) {
  openModal('Bulk Import Accounts',
    '<div class="form-group"><label class="form-label">CSV: platform,username,password,role</label>' +
    '<textarea class="form-input" id="bulk-acc-text" rows="8" placeholder="pinterest,user1@gmail.com,pass123,sub"></textarea>' +
    '<div class="form-hint">platform and role columns are optional (default: '+platform+', sub)</div></div>',
    `<button class="btn btn--secondary" onclick="closeModal()">Cancel</button><button class="btn btn--primary" onclick="submitBulkAccounts('${platform}')">Import</button>`
  );
};
window.submitBulkAccounts = async function(platform) {
  let text=(document.getElementById('bulk-acc-text').value||'').trim();
  if(!text) return;
  text=text.split('\n').map(function(line){
    const parts=line.trim().split(',');
    if(parts.length===3) return (platform||'pinterest')+','+line.trim();
    return line.trim();
  }).join('\n');
  try {
    const r=await api('POST','/accounts/bulk',{text});
    toast('Imported '+r.count+' accounts'); closeModal();
    if(platform&&currentView===platform) navigate(platform);
  } catch(err){toast(err.message,'error');}
};
window.banAccount = async function(id) {
  try{await api('POST','/accounts/'+id+'/ban');toast('Banned');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.deleteAccount = async function(id) {
  if(!confirm('Delete this account?')) return;
  try{await api('DELETE','/accounts/'+id);toast('Deleted');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.toggleCampaign = async function(id) {
  try{const r=await api('POST','/campaigns/'+id+'/toggle');toast(r.is_active?'Resumed':'Paused');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.triggerCampaign = async function(id) {
  toast('Triggering (Redis required)...','info');
  try{await api('POST','/campaigns/'+id+'/trigger');toast('Triggered');}catch(err){toast(err.message,'error');}
};
window.deleteCampaign = async function(id) {
  if(!confirm('Delete campaign?')) return;
  try{await api('DELETE','/campaigns/'+id);toast('Deleted');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.retryTask = async function(id) {
  try{await api('POST','/tasks/'+id+'/retry');toast('Re-queued');navigate(currentView);}catch(err){toast(err.message,'error');}
};

/* === VIEWS MAP + INIT === */
const views = { overview, proxies, logs, settings };

window.addEventListener('hashchange', function() {
  const v=location.hash.slice(1)||'overview';
  if(currentView!==v) navigate(v);
});

api('GET','/settings').then(function(s){_settings=s;}).catch(function(){});
navigate(location.hash.slice(1)||'overview');
