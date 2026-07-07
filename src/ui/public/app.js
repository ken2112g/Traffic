
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
const _campaignCache = {};
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

const DEFAULT_CHECKED_ACTIONS = ['like', 'follow'];
window.updateActionCheckboxes = function(platform) {
  const box = document.getElementById('action-boxes');
  const hint = document.getElementById('action-random-hint');
  const actions = PLATFORM_ACTIONS[platform] || [];
  if (!actions.length) {
    box.innerHTML = '<span style="font-size:12px;color:var(--muted)">Chọn nền tảng trước</span>';
    if (hint) hint.style.display = 'none';
    return;
  }
  box.innerHTML = actions.map(a =>
    '<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" name="actions" value="' + esc(a) + '"' +
    (DEFAULT_CHECKED_ACTIONS.includes(a) ? ' checked' : '') +
    ' style="accent-color:var(--accent)"> ' + esc(a) + '</label>'
  ).join('');
  if (hint) hint.style.display = actions.some(a => a === 'repin' || a === 'comment') ? 'block' : 'none';
};

function buildTargetUrl(platform, username) {
  if (!platform || !username) return '';
  if (platform === 'instagram') return `https://www.instagram.com/${username}/`;
  if (platform === 'tiktok')    return `https://www.tiktok.com/@${username}`;
  if (platform === 'twitter')   return `https://twitter.com/${username}`;
  if (platform === 'facebook')  return `https://www.facebook.com/${username}`;
  if (platform === 'youtube')   return `https://www.youtube.com/@${username}`;
  if (platform === 'pinterest') return `https://www.pinterest.com/${username}/`;
  return '';
}

window.updateTargetPreview = function() {
  const form = document.getElementById('campaign-form');
  const platform = form.querySelector('[name="platform"]').value;
  const username = form.querySelector('[name="target_account"]').value.trim();
  const urlOverride = form.querySelector('[name="target_url"]').value.trim();
  const resolved = urlOverride || buildTargetUrl(platform, username);
  const textEl = document.getElementById('target-preview-text');
  const linkEl = document.getElementById('target-preview-link');
  if (!resolved) {
    textEl.textContent = 'Nhập tài khoản/nền tảng để xem trước';
    linkEl.style.display = 'none';
    return;
  }
  textEl.textContent = '→ ' + resolved;
  if (/^https?:\/\//i.test(resolved)) {
    linkEl.href = resolved;
    linkEl.style.display = 'inline';
  } else {
    linkEl.style.display = 'none';
  }
};

window.scheduleModeChanged = function(prefix) {
  const mode = document.getElementById(prefix + '-mode').value;
  const timeWrap = document.getElementById(prefix + '-time-wrap');
  const cronWrap = document.getElementById(prefix + '-cron-wrap');
  if (timeWrap) timeWrap.style.display = mode === 'time' ? 'block' : 'none';
  if (cronWrap) cronWrap.style.display = mode === 'advanced' ? 'block' : 'none';
};

function readScheduleValue(prefix) {
  const mode = document.getElementById(prefix + '-mode').value;
  if (mode === 'time') {
    const parts = (document.getElementById(prefix + '-time').value || '08:00').split(':');
    const hh = parseInt(parts[0], 10), mm = parseInt(parts[1], 10);
    return `${mm} ${hh} * * *`;
  }
  if (mode === 'advanced') {
    return (document.getElementById(prefix + '-cron').value || '0 8 * * *').trim();
  }
  return 'auto';
}

function initScheduleMode(prefix, currentSchedule) {
  const modeSel = document.getElementById(prefix + '-mode');
  const value = (currentSchedule || 'auto').trim();
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(value);
  if (value === 'auto') {
    modeSel.value = 'auto';
  } else if (m) {
    modeSel.value = 'time';
    const hh = String(m[2]).padStart(2, '0'), mm = String(m[1]).padStart(2, '0');
    document.getElementById(prefix + '-time').value = `${hh}:${mm}`;
  } else {
    modeSel.value = 'advanced';
    document.getElementById(prefix + '-cron').value = value;
  }
  scheduleModeChanged(prefix);
}

window.submitCampaign = async function(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const actions = [...e.target.querySelectorAll('[name="actions"]:checked')].map(c => c.value);
  if (!actions.length) { toast('Chọn ít nhất một hành động', 'error'); return; }
  try {
    await api('POST', '/campaigns', { name: fd.get('name'), platform: fd.get('platform'), target_account: fd.get('target_account'), target_url: fd.get('target_url') || null, actions, schedule: readScheduleValue('schedule'), account_ids: fd.get('account_ids') });
    toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset(); updateActionCheckboxes(''); updateTargetPreview(); scheduleModeChanged('schedule');
    if (PLATFORMS.includes(currentView)) navigate(currentView);
  } catch (err) { toast(err.message, 'error'); }
};

/* Router */
function navigate(view) {
  if (monitorInterval && view !== 'monitor') { clearInterval(monitorInterval); monitorInterval = null; }
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
  el.innerHTML = '<div class="view-header"><h1>Tổng quan</h1><div class="view-actions"><button class="btn btn--secondary btn--sm" onclick="navigate(\'overview&apos;)">Làm mới</button></div></div><div id="ov-content"><div class="skeleton" style="height:200px;border-radius:12px"></div></div>';
  const stats = await api('GET', '/stats');
  const accs = stats.accounts || {};
  const tasks = stats.tasks || {};
  const total = Object.values(accs).reduce((s,v)=>s+v,0);
  const activity = (stats.recentActivity || []).slice(0, 15);

  const statsHtml = '<div class="stats-row">' +
    '<div class="stat-card accent"><div class="stat-value">' + total + '</div><div class="stat-label">Tổng tài khoản</div></div>' +
    '<div class="stat-card"><div class="stat-value" id="stat-idle">' + (accs.idle||0) + '</div><div class="stat-label">Rảnh</div></div>' +
    '<div class="stat-card"><div class="stat-value" id="stat-running">' + (accs.running||0) + '</div><div class="stat-label">Đang chạy</div></div>' +
    '<div class="stat-card error"><div class="stat-value" id="stat-banned">' + (accs.banned||0) + '</div><div class="stat-label">Bị ban</div></div>' +
    '<div class="stat-card accent"><div class="stat-value">' + (stats.campaigns||0) + '</div><div class="stat-label">Chiến dịch hoạt động</div></div>' +
    '<div class="stat-card"><div class="stat-value" id="stat-done">' + (tasks.done||0) + '</div><div class="stat-label">Task hoàn thành</div></div>' +
    '<div class="stat-card error"><div class="stat-value" id="stat-failed">' + (tasks.failed||0) + '</div><div class="stat-label">Thất bại</div></div>' +
    '</div>';

  const platformRows = PLATFORMS.map(p =>
    `<div class="platform-row" onclick="navigate('${p}')" style="padding:8px 6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:pointer;border-radius:4px">` +
    '<span style="font-size:13px;font-weight:500;min-width:80px">' + capitalize(p) + '</span>' +
    '<span class="platform-counts" id="prow-' + p + '" style="font-size:11px;color:var(--muted);font-family:var(--mono)">Đang tải...</span>' +
    '</div>'
  ).join('');

  const activityHtml = activity.length ? activity.map(a =>
    '<div class="activity-item">' +
    '<span class="activity-user">' + esc(a.username||'?') + '</span>' +
    '<span class="action-pill">' + esc(a.action) + '</span>' +
    badge(a.status) +
    '<span class="activity-ts" style="margin-left:auto;font-size:11px;color:var(--muted)">' + fmt(a.finished_at) + '</span>' +
    '</div>'
  ).join('') : '<div class="text-muted" style="padding:12px 0;font-size:13px">Chưa có hoạt động</div>';

  document.getElementById('ov-content').innerHTML = statsHtml +
    '<div class="overview-grid">' +
    '<div class="overview-card"><h3>Nền tảng</h3>' + platformRows + '</div>' +
    '<div class="overview-card"><h3>Hoạt động gần đây</h3>' + activityHtml + '</div>' +
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
        '<span style="color:var(--accent)">' + (t.done||0) + ' hoàn thành</span> &nbsp;' +
        '<span style="color:var(--error)">' + (t.failed||0) + ' thất bại</span> &nbsp;' +
        '<span style="color:var(--warn)">' + ((t.pending||0)+(t.running||0)) + ' đang chờ</span>';
    } catch {}
  });
}



/* === PLATFORM VIEW === */
const PTAB_LABELS = { 'sub-accounts': 'Tài khoản phụ', targets: 'Mục tiêu', campaigns: 'Chiến dịch', tasks: 'Tác vụ' };

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
    `<button class="btn btn--secondary btn--sm" onclick="renderPlatform('${platform}',document.getElementById('content'))">Làm mới</button>` +
    `<button class="btn btn--primary btn--sm" onclick="openDrawer('${platform}')">+ Chiến dịch</button>` +
    `<button class="btn btn--secondary btn--sm" onclick="showAddAccount('${platform}')">+ Tài khoản</button>` +
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
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Tài khoản chính (đang được buff)</div>' +
    '<div class="table-wrap"><table><thead><tr><th>Username</th><th>Trạng thái</th><th>Phiên</th><th>Proxy</th><th>Thao tác</th></tr></thead><tbody>' +
    mainAccounts.map(a =>
      '<tr><td class="td-mono">' + esc(a.username) + '</td>' +
      '<td>' + badge(a.status) + '</td>' +
      '<td><span class="session-dot ' + (a.session_path?'ok':'') + '">' + (a.session_path?'Đã lưu':'Chưa có') + '</span></td>' +
      '<td class="proxy-badge">' + (a.proxy_host ? esc(a.proxy_host)+':'+a.proxy_port : '---') + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--danger" onclick="banAccount('${a.id}')">Cấm</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteAccount('${a.id}')">Xóa</button>` +
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
    '<input type="text" id="acc-search" placeholder="Tìm username..." oninput="filterSubTable()" style="min-width:200px">' +
    '<select id="acc-status-filter" onchange="filterSubTable()"><option value="all">Tất cả</option><option value="idle">Rảnh</option><option value="running">Đang chạy</option><option value="banned">Bị ban</option><option value="error">Loi</option></select>' +
    `<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts('${platform}')">Nhập CSV</button>` +
    `<button class="btn btn--secondary btn--sm" onclick="bulkResetPlatformErrors('${platform}')">Reset lỗi</button>` +
    '</div>' +
    mainTable +
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Tài khoản phụ (' + subAccounts.length + ')</div>' +
    '<div class="table-wrap"><table id="sub-table">' +
    '<thead><tr><th>Username</th><th>Status</th><th>Tiến độ hôm nay</th><th>Session</th><th>Proxy</th><th class="col-actions">Actions</th></tr></thead>' +
    '<tbody id="sub-tbody">' + renderSubRows(subAccounts, platform) + '</tbody>' +
    '</table></div>';
}

function renderSubRows(rows, platform) {
  if (!rows.length) return '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">X</div><h3>Chưa có tai khoan phu</h3><p>Thêm tài khoản hoặc nhập CSV ở trên</p></div></td></tr>';
  return rows.map(a =>
    '<tr data-username="' + esc(a.username) + '" data-status="' + esc(a.status) + '">' +
    '<td class="td-mono">' + esc(a.username) + '</td>' +
    '<td>' + badge(a.status) + '</td>' +
    '<td>' + renderProgress(a.daily_counts, platform) + '</td>' +
    '<td><span class="session-dot ' + (a.session_path?'ok':'') + '">' + (a.session_path?'Đã lưu':'Chưa có') + '</span></td>' +
    '<td class="proxy-badge">' + (a.proxy_host ? esc(a.proxy_host)+':'+a.proxy_port : '---') + '</td>' +
    '<td class="col-actions"><div class="gap-actions">' +
    (a.status==='error' ? `<button class="btn btn--xs btn--primary" onclick="resetErrorAccount('${a.id}')">Reset</button>` : '') +
    `<button class="btn btn--xs btn--outline" onclick="clearSession('${a.id}')">Phiên</button>` +
    `<button class="btn btn--xs btn--secondary" onclick="banAccount('${a.id}')">Cấm</button>` +
    `<button class="btn btn--xs btn--danger" onclick="deleteAccount('${a.id}')">Xóa</button>` +
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
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9711;</div><h3>Chưa có muc tieu</h3><p>Tạo chiến dịch để buff tài khoản trên ' + capitalize(platform) + '</p>' + `<button class="btn btn--primary" style="margin-top:16px" onclick="openDrawer('${platform}')">+ Tạo chiến dịch</button>` + '</div>';
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
      '<div class="target-stat"><div class="target-stat-value done">' + t.done + '</div><div class="target-stat-label">Hoàn thành</div></div>' +
      '<div class="target-stat"><div class="target-stat-value failed">' + t.failed + '</div><div class="target-stat-label">Thất bại</div></div>' +
      '<div class="target-stat"><div class="target-stat-value pending">' + t.pending + '</div><div class="target-stat-label">Đang chờ</div></div>' +
      '</div><div class="target-campaigns">' + campRows + '</div></div>';
  }).join('');
  el.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:16px">Tài khoản được buff bởi tài khoản phụ ' + capitalize(platform) + ' sub-accounts</div><div class="target-grid">' + cards + '</div>';
}

/* Campaigns tab */
async function renderPlatformCampaigns(platform, el) {
  const campaigns = await api('GET', '/campaigns?platform=' + platform);
  let html = `<div class="view-actions" style="margin-bottom:16px"><button class="btn btn--primary btn--sm" onclick="openDrawer('${platform}')">+ Chiến dịch moi</button></div>`;
  if (!campaigns.length) {
    html += '<div class="empty-state"><div class="empty-state-icon">C</div><h3>Chưa có chien dich</h3><p>Tạo chiến dịch để bắt đầu buff mục tiêu</p></div>';
  } else {
    campaigns.forEach(c => { _campaignCache[c.id] = c; });
    const rows = campaigns.map(c =>
      '<tr><td style="font-weight:500">' + esc(c.name) + '</td>' +
      '<td class="td-mono">@' + esc(c.target_account) + '</td>' +
      '<td>' + actionPills(c.actions) + '</td>' +
      '<td class="td-sm">' + esc(c.schedule==='auto'?'8 giờ sáng hằng ngày':c.schedule) + '</td>' +
      '<td class="td-sm">' + c.account_count + '</td>' +
      '<td id="camp-prog-' + c.id + '"><div class="skeleton" style="height:6px;width:80px;border-radius:3px"></div></td>' +
      '<td>' + (c.is_active ? badge('active') : badge('idle')) + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--secondary" onclick="toggleCampaign('${c.id}')">${c.is_active?'Tạm dừng':'Tiếp tục'}</button>` +
      `<button class="btn btn--xs btn--secondary" onclick="triggerCampaign('${c.id}')">Chạy ngay</button>` +
      `<button class="btn btn--xs btn--outline" onclick="editCampaign('${c.id}')">Sua</button>` +
      `<button class="btn btn--xs btn--outline" onclick="cloneCampaign('${c.id}','${esc(c.name)}')">Nhân bản</button>` +
      `<button class="btn btn--xs btn--secondary" onclick="drainCampaign('${c.id}')">Xóa task</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteCampaign('${c.id}')">Xóa</button>` +
      '</div></td></tr>'
    ).join('');
    html += '<div class="table-wrap"><table><thead><tr><th>Tên</th><th>Mục tiêu</th><th>Hành động</th><th>Lịch chạy</th><th>TK</th><th>Tiến độ</th><th>Trạng thái</th><th class="col-actions">Quản lý</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  el.innerHTML = html;
  if (campaigns.length) {
    api('GET', '/campaigns/progress?platform=' + platform).then(function(pdata) {
      pdata.forEach(function(c) {
        const pe = document.getElementById('camp-prog-' + c.id);
        if (pe) pe.innerHTML = taskProgressBar(c.done||0,c.failed||0,c.running||0,c.pending||0);
      });
    }).catch(function(){});
  }
}

/* Tasks tab */
async function renderPlatformTasks(platform, el) {
  el.innerHTML =
    '<div class="filter-bar" style="margin-bottom:16px">' +
    `<select id="ptask-status" onchange="reloadPlatformTasks('${platform}')">` +
    '<option value="all">Tất cả</option><option value="done">Done</option><option value="failed">Thất bại</option><option value="pending">Dang cho</option><option value="running">Đang chạy</option>' +
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
    if (!tasks.length) { wrap.innerHTML = '<div class="empty-state"><h3>Chưa có tac vu</h3></div>'; return; }
    const rows = tasks.map(t => {
      const hasErr = t.status==='failed' && t.error;
      return '<tr' + (hasErr ? ' style="cursor:pointer" onclick="showTaskError(this)" data-error="' + esc(t.error||'') + '"' : '') + '>' +
      '<td class="td-mono">' + esc(t.account_username||'?') + '</td>' +
      '<td><span class="action-pill">' + esc(t.action) + '</span></td>' +
      '<td>' + badge(t.status) + '</td>' +
      '<td class="td-sm">' + esc(t.campaign_name||'---') + '</td>' +
      '<td class="td-sm">' + fmt(t.finished_at) + '</td>' +
      '<td class="col-actions">' + (t.status==='failed' ? `<button class="btn btn--xs btn--secondary" onclick="event.stopPropagation();retryTask('${t.id}')">Thử lại</button>` : '') + '</td></tr>';
    }).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Tài khoản</th><th>Hành động</th><th>Trạng thái</th><th>Chiến dịch</th><th>Hoàn thành lúc</th><th>Thử lại</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
};


﻿/* Monitor state */
let monitorInterval = null;

/* Elapsed time helper */
function elapsed(dtStr) {
  if (!dtStr) return "";
  const ms = Date.now() - new Date(dtStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60); const rs = s % 60;
  if (m < 60) return m + "m " + rs + "s";
  return Math.floor(m/60) + "h " + (m%60) + "m";
}

/* Progress bar for task counts */
function taskProgressBar(done, failed, running, pending) {
  const total = done + failed + running + pending;
  if (!total) return "<span class=\"text-muted text-xs\">Chưa có task</span>";
  const pct = Math.round(done/total*100);
  const cls = pct>=100?"full":pct>=75?"warn":"";
  return "<div style=\"display:flex;flex-direction:column;gap:3px;min-width:110px\">" +
    "<div class=\"progress-bar\" style=\"height:4px\"><div class=\"progress-fill " + cls + "\" style=\"width:" + pct + "%\"></div></div>" +
    "<span style=\"font-size:10px;color:var(--muted);font-family:var(--mono)\">" +
    "<span style=\"color:var(--accent)\">" + done + " xong</span>" +
    (failed ? "<span style=\"color:var(--error)\"> &middot; " + failed + " lỗi</span>" : "") +
    (running ? "<span style=\"color:var(--warn)\"> &middot; " + running + " chạy</span>" : "") +
    (pending ? "<span style=\"color:var(--muted)\"> &middot; " + pending + " chờ</span>" : "") +
    "</span></div>";
}

/* === MONITOR VIEW === */
async function monitor(el) {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  el.innerHTML =
    "<div class=\"view-header\">" +
    "<h1>Theo dõi</h1>" +
    "<div class=\"view-actions\">" +
    "<span id=\"monitor-ts\" style=\"font-size:11px;color:var(--muted);align-self:center\"></span>" +
    "<button class=\"btn btn--secondary btn--sm\" onclick=\"refreshMonitor()\">&#x21bb; Làm mới</button>" +
    "</div></div>" +
    "<div id=\"mon-running\" class=\"monitor-section\"></div>" +
    "<div id=\"mon-queue\"   class=\"monitor-section\"></div>" +
    "<div id=\"mon-history\" class=\"monitor-section\"></div>";
  await refreshMonitor();
  monitorInterval = setInterval(refreshMonitor, 4000);
}

window.refreshMonitor = async function() {
  try {
    const [running, pending, history, progress] = await Promise.all([
      api("GET", "/tasks?status=running&limit=100"),
      api("GET", "/tasks?status=pending&limit=300"),
      api("GET", "/tasks?limit=60"),
      api("GET", "/campaigns/progress").catch(function(){return [];}),
    ]);
    renderMonitorRunning(running);
    renderMonitorQueue(pending, progress);
    renderMonitorHistory(history.filter(function(t){return t.status==="done"||t.status==="failed";}).slice(0,40));
    const ts = document.getElementById("monitor-ts");
    if (ts) ts.textContent = "Đã cập nhật: " + new Date().toLocaleTimeString("vi-VN",{hour12:false});
  } catch(err) { console.error("monitor refresh:", err); }
};

function renderMonitorRunning(tasks) {
  const el = document.getElementById("mon-running");
  if (!el) return;
  const count = tasks.length;
  let html = "<div class=\"monitor-card\">" +
    "<div class=\"monitor-card-title\">" +
    "<span class=\"monitor-dot" + (count?"":"-off") + "\"></span>" +
    (count ? count + " tác vụ đang chạy" : "Đang rảnh — không có tác vụ nào") +
    "</div>";
  if (!count) {
    html += "<div style=\"padding:20px;text-align:center;color:var(--muted);font-size:13px\">Hệ thống đang rảnh</div>";
  } else {
    html += "<div class=\"monitor-table-wrap\"><table class=\"monitor-table\"><thead><tr>" +
      "<th>Tài khoản</th><th>Hành động</th><th>Chiến dịch</th><th>Nền tảng</th><th>Thời gian</th>" +
      "</tr></thead><tbody>" +
      tasks.map(function(t) {
        return "<tr class=\"monitor-row\">" +
          "<td class=\"td-mono\" style=\"font-weight:600\">" + esc(t.account_username||"?") + "</td>" +
          "<td><span class=\"action-pill\">" + esc(t.action) + "</span></td>" +
          "<td style=\"color:var(--ink-2)\">" + esc(t.campaign_name||"---") + "</td>" +
          "<td style=\"color:var(--muted)\">" + esc(t.platform) + "</td>" +
          "<td><span class=\"elapsed-badge\">" + elapsed(t.started_at) + "</span></td>" +
          "</tr>";
      }).join("") +
      "</tbody></table></div>";
  }
  el.innerHTML = html + "</div>";
}

function renderMonitorQueue(pending, progress) {
  const el = document.getElementById("mon-queue");
  if (!el) return;
  const byPlatform = {};
  pending.forEach(function(t){ byPlatform[t.platform]=(byPlatform[t.platform]||0)+1; });

  let progressHtml = "";
  if (progress && progress.length) {
    const active = progress.filter(function(c){return c.is_active;});
    if (active.length) {
      progressHtml = "<div class=\"monitor-card\">" +
        "<div class=\"monitor-card-title\">Tiến độ chiến dịch</div>" +
        "<div class=\"monitor-table-wrap\"><table class=\"monitor-table\"><thead><tr>" +
        "<th>Chiến dịch</th><th>Mục tiêu</th><th>Nền tảng</th><th>Tiến độ</th>" +
        "</tr></thead><tbody>" +
        active.map(function(c) {
          return "<tr><td style=\"font-weight:500\">" + esc(c.name) + "</td>" +
            "<td class=\"td-mono\">@" + esc(c.target_account) + "</td>" +
            "<td style=\"color:var(--muted)\">" + esc(c.platform) + "</td>" +
            "<td>" + taskProgressBar(c.done||0,c.failed||0,c.running||0,c.pending||0) + "</td></tr>";
        }).join("") +
        "</tbody></table></div></div>";
    }
  }

  const total = pending.length;
  const byPlatHtml = Object.entries(byPlatform).map(function(e){
    return "<span style=\"color:var(--ink-2)\">" + capitalize(e[0]) + ": <b>" + e[1] + "</b></span>";
  }).join(" &nbsp;");
  const queueHtml = "<div class=\"monitor-card\">" +
    "<div class=\"monitor-card-title\">" +
    "<span style=\"font-size:13px;font-weight:600;color:var(--warn)\">" + total + "</span>" +
    " tác vụ đang chờ" + (total ? " &mdash; " + byPlatHtml : "") +
    "</div>" +
    (!total ? "<div style=\"padding:12px;color:var(--muted);font-size:13px\">Hàng chờ trống</div>" : "") +
    "</div>";

  el.innerHTML = queueHtml + progressHtml;
}

function renderMonitorHistory(tasks) {
  const el = document.getElementById("mon-history");
  if (!el) return;
  if (!tasks.length) {
    el.innerHTML = "<div class=\"monitor-card\"><div class=\"monitor-card-title\">Lịch sử gần đây</div><div style=\"padding:20px;text-align:center;color:var(--muted)\">Chưa có</div></div>";
    return;
  }
  const done   = tasks.filter(function(t){return t.status==="done";}).length;
  const failed = tasks.filter(function(t){return t.status==="failed";}).length;
  el.innerHTML = "<div class=\"monitor-card\">" +
    "<div class=\"monitor-card-title\">Lịch sử gần đây &nbsp;" +
    "<span style=\"color:var(--accent);font-size:11px\">" + done + " thành công</span>" +
    (failed ? " &nbsp;<span style=\"color:var(--error);font-size:11px\">" + failed + " thất bại</span>" : "") +
    "</div>" +
    "<div class=\"monitor-table-wrap\"><table class=\"monitor-table\"><thead><tr>" +
    "<th>Tài khoản</th><th>Hành động</th><th>Chiến dịch</th><th>Trạng thái</th><th>Hoàn thành</th><th></th>" +
    "</tr></thead><tbody>" +
    tasks.map(function(t) {
      const hasErr = t.status==="failed" && t.error;
      return "<tr" + (hasErr?" style=\"cursor:pointer\" onclick=\"showTaskError(this)\" data-error=\""+esc(t.error||"")+"\"":"") + ">" +
        "<td class=\"td-mono\">" + esc(t.account_username||"?") + "</td>" +
        "<td><span class=\"action-pill\">" + esc(t.action) + "</span></td>" +
        "<td style=\"color:var(--ink-2);font-size:12px\">" + esc(t.campaign_name||"---") + "</td>" +
        "<td>" + badge(t.status) + "</td>" +
        "<td class=\"td-sm\">" + fmt(t.finished_at) + "</td>" +
        "<td class=\"col-actions\">" + (t.status==="failed"?"<button class=\"btn btn--xs btn--secondary\" onclick=\"event.stopPropagation();retryTask(\'"+t.id+"\')\">Thử lại</button>":"") + "</td>" +
        "</tr>";
    }).join("") +
    "</tbody></table></div></div>";
}

/* === PROXIES === */
async function proxies(el) {
  el.innerHTML = '<div class="view-header"><h1>Proxy</h1><div class="view-actions">' +
    '<button class="btn btn--secondary btn--sm" onclick="showBulkProxies()">Nhập hàng loạt</button>' +
    '<button class="btn btn--secondary btn--sm" onclick="autoAssignProxies()">Gán tự động</button>' +
    '<button class="btn btn--primary btn--sm" onclick="showAddProxy()">+ Thêm proxy</button>' +
    '</div></div><div id="proxy-list"><div class="skeleton" style="height:200px;border-radius:8px"></div></div>';
  await reloadProxies();
}
async function reloadProxies() {
  const wrap = document.getElementById('proxy-list');
  if (!wrap) return;
  try {
    const rows = await api('GET', '/proxies');
    if (!rows.length) { wrap.innerHTML = '<div class="empty-state"><h3>Chưa có proxy</h3><p>Thêm proxy để gán cho tài khoản</p></div>'; return; }
    const trows = rows.map(p =>
      '<tr><td class="td-mono">' + esc(p.host) + ':' + p.port + '</td>' +
      '<td class="td-sm">' + (p.username ? esc(p.username) : '--') + '</td>' +
      '<td class="td-sm">' + esc(p.type||'static') + '</td>' +
      '<td>' + badge(p.status||'active') + '</td>' +
      '<td class="td-sm">' + (p.latency_ms ? p.latency_ms+'ms' : '--') + '</td>' +
      '<td class="td-sm">' + fmtD(p.last_check) + '</td>' +
      '<td class="col-actions"><div class="gap-actions">' +
      `<button class="btn btn--xs btn--secondary" onclick="testProxy('${p.id}')">Kiểm tra</button>` +
      `<button class="btn btn--xs btn--danger" onclick="deleteProxy('${p.id}')">Xóa</button>` +
      '</div></td></tr>'
    ).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Host:Port</th><th>Auth</th><th>Type</th><th>Status</th><th>Độ trễ</th><th>Kiểm tra cuối</th><th>Thao tác</th></tr></thead><tbody>' + trows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
}
window.showAddProxy = function() {
  openModal('Thêm proxy',
    '<div class="form-group"><label class="form-label">Host *</label><input class="form-input" id="px-host" placeholder="proxy.example.com"></div>' +
    '<div class="form-group"><label class="form-label">Port *</label><input class="form-input" id="px-port" type="number" placeholder="8080"></div>' +
    '<div class="form-group"><label class="form-label">Tên đăng nhập</label><input class="form-input" id="px-user" placeholder="tuy chon"></div>' +
    '<div class="form-group"><label class="form-label">Mật khẩu</label><input class="form-input" id="px-pass" type="password"></div>' +
    '<div class="form-group"><label class="form-label">Giao thức</label><select class="form-input" id="px-proto"><option>http</option><option>https</option><option>socks5</option></select></div>' +
    '<div class="form-group"><label class="form-label">Loại</label><select class="form-input" id="px-type"><option>static</option><option>rotating</option><option>mobile</option></select></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button><button class="btn btn--primary" onclick="submitAddProxy()">Thêm</button>'
  );
};
window.submitAddProxy = async function() {
  const host = document.getElementById('px-host').value.trim();
  const port = document.getElementById('px-port').value.trim();
  if (!host||!port) { toast('Cần nhập host và port','error'); return; }
  try {
    await api('POST','/proxies',{host,port:Number(port),username:document.getElementById('px-user').value||null,password:document.getElementById('px-pass').value||null,protocol:document.getElementById('px-proto').value,type:document.getElementById('px-type').value});
    toast('Đã thêm proxy'); closeModal(); reloadProxies();
  } catch(err){toast(err.message,'error');}
};
window.showBulkProxies = function() {
  openModal('Nhập proxy hàng loạt',
    '<div class="form-group"><label class="form-label">Mỗi dòng 1 proxy: host:port hoặc host:port:user:pass</label>' +
    '<textarea class="form-input" id="bulk-proxy-text" rows="8" placeholder="1.2.3.4:8080"></textarea></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button><button class="btn btn--primary" onclick="submitBulkProxies()">Nhập</button>'
  );
};
window.submitBulkProxies = async function() {
  const text = (document.getElementById('bulk-proxy-text').value||'').trim();
  if (!text) return;
  try { const r = await api('POST','/proxies/bulk',{text}); toast('Imported '+r.count+' proxy'); closeModal(); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.testProxy = async function(id) {
  toast('Đang kiểm tra...','info');
  try { const r=await api('POST','/proxies/'+id+'/test'); toast(r.ok?'OK - '+r.ip+' - '+r.latency+'ms':'Dead: '+r.error, r.ok?'ok':'error'); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.deleteProxy = async function(id) {
  if (!confirm('Xóa proxy này?')) return;
  try { await api('DELETE','/proxies/'+id); toast('Đã xóa'); reloadProxies(); }
  catch(err){toast(err.message,'error');}
};
window.autoAssignProxies = async function() {
  try { const r=await api('POST','/proxies/assign'); toast('Assigned '+r.assigned+' tai khoan'); }
  catch(err){toast(err.message,'error');}
};

/* === LOGS === */
async function logs(el) {
  el.innerHTML = '<div class="view-header"><h1>Nhật ký</h1><div class="view-actions">' +
    '<select id="log-level" onchange="logLevelFilter=this.value;renderLogFeed()">' +
    '<option value="all">Tất cả</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Loi</option><option value="debug">Debug</option>' +
    '</select><button class="btn btn--secondary btn--sm" onclick="logLines=[];renderLogFeed();connectSSE()">Xóa log</button></div></div>' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px"><div class="log-feed" id="log-feed"></div></div>';
  try { const rows=await api('GET','/logs?limit=200'); logLines=rows.reverse(); renderLogFeed(); } catch{}
  connectSSE();
}
function connectSSE() {
  if (sseConn){sseConn.close();sseConn=null;}
  sseConn = new EventSource('/api/logs/stream');
  sseConn.onmessage = function(e) {
    const entry=JSON.parse(e.data);
    if (entry._type==='stats') { _applyRealtimeStats(entry); return; }
    logLines.unshift(entry);
    if (logLines.length>500) logLines.length=500;
    if (currentView==='logs') {
      const feed=document.getElementById('log-feed');
      if (feed) {
        const div=document.createElement('div');
        div.innerHTML=logEntryHtml(entry);
        feed.prepend(div.firstChild);
        while(feed.children.length>500) feed.lastChild.remove();
      }
    }
  };
}
function _applyRealtimeStats(s) {
  const accs=s.accounts||{}, tasks=s.tasks||{};
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  set('stat-idle',    accs.idle    ||0);
  set('stat-running', accs.running ||0);
  set('stat-banned',  accs.banned  ||0);
  set('stat-done',    tasks.done   ||0);
  set('stat-failed',  tasks.failed ||0);
  set('stat-pending', (tasks.pending||0)+(tasks.running||0));
  const runBadge = document.getElementById('sidebar-running-dot');
  if (runBadge) { const n=accs.running||0; runBadge.textContent=n; runBadge.style.display=n>0?'inline-flex':'none'; }
  if (currentView === 'monitor' && s.runningTasks) renderMonitorRunning(s.runningTasks);
}
function logEntryHtml(e) {
  const lvl=(e.level||'info').toLowerCase();
  return '<div class="log-entry"><span class="log-ts">'+fmt(e.created_at)+'</span>' +
    '<span class="log-level '+lvl+'">'+lvl.toUpperCase()+'</span>' +
    '<span class="log-source">['+esc(e.module||'?')+']</span>' +
    '<span class="log-msg">'+esc(e.message)+'</span></div>';
}
function renderLogFeed() {
  const feed=document.getElementById('log-feed');
  if (!feed) return;
  const filtered=logLevelFilter==='all'?logLines:logLines.filter(l=>l.level===logLevelFilter);
  feed.innerHTML = filtered.length ? filtered.map(logEntryHtml).join('') : '<div class="text-muted text-xs" style="padding:8px">Chưa có log</div>';
}

/* === SETTINGS === */
async function settings(el) {
  el.innerHTML = '<div class="view-header"><h1>Cài đặt</h1><div class="view-actions"><button class="btn btn--secondary btn--sm" onclick="navigate(\'settings&apos;)">Tải lại</button></div></div>' +
    '<div id="settings-body"><div class="skeleton" style="height:200px;border-radius:12px"></div></div>';
  try {
    _settings = await api('GET','/settings');
    document.getElementById('settings-body').innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:16px">Giới hạn theo nền tảng. Lưu sau khi chỉnh sửa.</div>' +
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
    `<div style="margin-top:12px"><button class="btn btn--primary btn--sm" onclick="savePlatformSettings('${platform}')">Lưu</button></div></div>`;
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
    toast(capitalize(platform)+' đã lưu');
  } catch(err){toast(err.message,'error');}
};

/* === SHARED ACCOUNT/CAMPAIGN ACTIONS === */
window.showAddAccount = function(platform) {
  const opts=['pinterest','instagram','tiktok','youtube','twitter','facebook'].map(p=>
    '<option value="'+p+'"'+(p===platform?' selected':'')+'>'+capitalize(p)+'</option>'
  ).join('');
  openModal('Thêm tài khoản',
    '<div class="form-group"><label class="form-label">Nền tảng</label><select class="form-input" id="add-acc-platform">'+opts+'</select></div>' +
    '<div class="form-group"><label class="form-label">Username / Email *</label><input class="form-input" id="add-acc-user" placeholder="user@example.com"></div>' +
    '<div class="form-group"><label class="form-label">Mật khẩu *</label><input class="form-input" id="add-acc-pass" type="password"></div>' +
    '<div class="form-group"><label class="form-label">Role</label><select class="form-input" id="add-acc-role"><option value="sub">Phụ (buff)</option><option value="main">Chính (mục tiêu)</option></select></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button><button class="btn btn--primary" onclick="submitAddAccount()">Thêm</button>'
  );
};
window.submitAddAccount = async function() {
  const platform=document.getElementById('add-acc-platform').value;
  const username=document.getElementById('add-acc-user').value.trim();
  const password=document.getElementById('add-acc-pass').value;
  const role=document.getElementById('add-acc-role').value;
  if(!username||!password){toast('Cần nhập username và mật khẩu','error');return;}
  try {
    await api('POST','/accounts',{platform,username,password,role});
    toast('Đã thêm tài khoản'); closeModal();
    if(currentView===platform) navigate(platform);
  } catch(err){toast(err.message,'error');}
};
window.showBulkAccounts = function(platform) {
  openModal('Nhập tài khoản hàng loạt',
    '<div class="form-group"><label class="form-label">CSV: platform,username,password,role</label>' +
    '<textarea class="form-input" id="bulk-acc-text" rows="8" placeholder="pinterest,user1@gmail.com,pass123,sub"></textarea>' +
    '<div class="form-hint">Cột platform và role tùy chọn (mặc định: '+platform+', phụ)</div></div>',
    `<button class="btn btn--secondary" onclick="closeModal()">Hủy</button><button class="btn btn--primary" onclick="submitBulkAccounts('${platform}')">Import</button>`
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
    toast('Đã nhập '+r.count+' tai khoan'); closeModal();
    if(platform&&currentView===platform) navigate(platform);
  } catch(err){toast(err.message,'error');}
};
window.banAccount = async function(id) {
  try{await api('POST','/accounts/'+id+'/ban');toast('Đã cấm');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.deleteAccount = async function(id) {
  if(!confirm('Xóa tài khoản này?')) return;
  try{await api('DELETE','/accounts/'+id);toast('Đã xóa');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.toggleCampaign = async function(id) {
  try{const r=await api('POST','/campaigns/'+id+'/toggle');toast(r.is_active?'Đã tiếp tục':'Đã tạm dừng');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.triggerCampaign = async function(id) {
  toast('Đang kích hoạt (cần Redis)...','info');
  try{await api('POST','/campaigns/'+id+'/trigger');toast('Đã kích hoạt');}catch(err){toast(err.message,'error');}
};
window.deleteCampaign = async function(id) {
  if(!confirm('Xóa chiến dịch này?')) return;
  try{await api('DELETE','/campaigns/'+id);toast('Đã xóa');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.retryTask = async function(id) {
  try{await api('POST','/tasks/'+id+'/retry');toast('Đã đưa vào hàng chờ');navigate(currentView);}catch(err){toast(err.message,'error');}
};


/* === SYSTEM HEALTH === */
async function system(el) {
  el.innerHTML = '<div class="view-header"><h1>Sức khỏe hệ thống</h1><div class="view-actions">' +
    '<button class="btn btn--secondary btn--sm" onclick="navigate(\'system\')">Làm mới</button>' +
    '</div></div>' +
    '<div id="health-content"><div class="skeleton" style="height:300px;border-radius:12px"></div></div>';
  try {
    const [hr, qr] = await Promise.allSettled([api('GET','/health'), api('GET','/queue/stats')]);
    const h = hr.status === 'fulfilled' ? hr.value : {};
    const q = qr.status === 'fulfilled' ? qr.value : {};
    const redisColor = h.redis.ok ? 'var(--success, #22c55e)' : 'var(--error)';
    document.getElementById('health-content').innerHTML =
      '<div class="stats-row">' +
      '<div class="stat-card ' + (h.redis.ok?'accent':'error') + '"><div class="stat-value">' + (h.redis.ok?'OK':'DOWN') + '</div><div class="stat-label">Redis ' + (h.redis.latency_ms||0) + 'ms</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + h.sessions + '</div><div class="stat-label">File phiên</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + Math.floor(h.uptime_s/60) + 'm</div><div class="stat-label">Thời gian hoạt động</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (q.waiting||0) + '</div><div class="stat-label">Hàng chờ</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (q.active||0) + '</div><div class="stat-label">Queue đang chạy</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (q.delayed||0) + '</div><div class="stat-label">Đã lên lịch</div></div>' +
      '</div>' +
      '<div class="overview-grid">' +
      '<div class="overview-card"><h3>Cơ sở dữ liệu</h3>' +
      '<div style="font-family:var(--mono);font-size:13px;line-height:2">' +
      Object.entries(h.db||{}).map(([k,v])=>
        '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">' +
        '<span style="color:var(--muted)">' + k + '</span><b>' + v + '</b></div>'
      ).join('') + '</div></div>' +
      '<div class="overview-card"><h3>Thao tác nhanh</h3>' +
      '<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">' +
      '<button class="btn btn--primary" onclick="bulkResetErrors()">Reset tat ca tài khoản lỗi → Rảnh</button>' +
      '<button class="btn btn--secondary" onclick="testAllProxies()">Kiểm tra tất cả proxy</button>' +
      '<button class="btn btn--secondary" onclick="autoReassignProxies()">Gán lại proxy chết tự động</button>' +
      '</div></div></div>';
  } catch(err) {
    document.getElementById('health-content').innerHTML = '<div class="error-text">' + esc(err.message) + '</div>';
  }
}
window.bulkResetErrors = async function(platform) {
  try {
    const r = await api('POST','/accounts/bulk-reset-errors', platform ? {platform} : {});
    toast('Đã reset ' + r.count + ' tài khoản → rảnh'); navigate(currentView);
  } catch(err){toast(err.message,'error');}
};
window.testAllProxies = async function() {
  toast('Đang kiểm tra tất cả proxy...','info');
  try { const r=await api('POST','/proxies/test-all'); toast(r.alive + ' proxy còn hoạt động'); navigate(currentView); }
  catch(err){toast(err.message,'error');}
};
window.autoReassignProxies = async function() {
  try {
    const r=await api('POST','/proxies/auto-reassign');
    toast('Đã bỏ gán ' + r.unassigned + ', gán lại ' + r.reassigned);
  } catch(err){toast(err.message,'error');}
};


window.clearSession = async function(id) {
  if (!confirm('Xóa session file? Account sẽ phải đăng nhập lại.')) return;
  try{await api('POST','/accounts/'+id+'/clear-session');toast('Session cleared — sẽ re-login lần sau');}
  catch(err){toast(err.message,'error');}
};
window.drainCampaign = async function(id) {
  if (!confirm('Xóa tất cả pending tasks của campaign này?')) return;
  try{const r=await api('POST','/tasks/drain',{campaign_id:id});toast('Drained '+r.count+' tasks');}
  catch(err){toast(err.message,'error');}
};
window.cloneCampaign = async function(id, name) {
  const newName = prompt('Tên campaign mới:', name + ' (Copy)');
  if (!newName) return;
  try{const r=await api('POST','/campaigns/'+id+'/clone',{name:newName});toast('Cloned: '+r.name);navigate(currentView);}
  catch(err){toast(err.message,'error');}
};
window.editCampaign = function(id) {
  const c = _campaignCache[id];
  if (!c) { toast('Không tìm thấy chiến dịch','error'); return; }
  const actions = Array.isArray(c.actions) ? c.actions.join(',') : c.actions;
  openModal('Sửa chiến dịch',
    '<div class="form-group"><label class="form-label">Ten</label>' +
    '<input class="form-input" id="ec-name" value="' + esc(c.name) + '"></div>' +
    '<div class="form-group"><label class="form-label">URL mục tiêu (tùy chọn)</label>' +
    '<input class="form-input" id="ec-url" value="' + esc(c.target_url||'') + '" placeholder="https://..."></div>' +
    '<div class="form-group"><label class="form-label">Lịch chạy</label>' +
    '<input class="form-input" id="ec-sched" value="' + esc(c.schedule||'auto') + '" placeholder="auto or cron"></div>' +
    '<div class="form-group"><label class="form-label">Hành động (cach nhau boi dau phay)</label>' +
    '<input class="form-input" id="ec-actions" value="' + esc(actions) + '"></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button>' +
    '<button class="btn btn--primary" id="ec-save">Lưu</button>'
  );
  document.getElementById('ec-save').onclick = () => submitEditCampaign(id);
};
window.submitEditCampaign = async function(id) {
  const name     = document.getElementById('ec-name').value.trim();
  const url      = document.getElementById('ec-url').value.trim() || null;
  const schedule = document.getElementById('ec-sched').value.trim() || 'auto';
  const actions  = document.getElementById('ec-actions').value.split(',').map(s=>s.trim()).filter(Boolean);
  if (!name) { toast('Cần nhập tên','error'); return; }
  try {
    await api('PUT','/campaigns/'+id,{name,target_url:url,schedule,actions});
    toast('Đã cập nhật chiến dịch'); closeModal(); navigate(currentView);
  } catch(err){toast(err.message,'error');}
};
window.bulkResetPlatformErrors = async function(platform) {
  try {
    const r=await api('POST','/accounts/bulk-reset-errors',{platform});
    toast('Đã reset ' + r.count + ' tài khoản lỗi');
    navigate(currentView);
  } catch(err){toast(err.message,'error');}
};

window.resetErrorAccount = async function(id) {
  try{await api('POST','/accounts/'+id+'/reset');toast('Đã reset về rảnh');navigate(currentView);}catch(err){toast(err.message,'error');}
};
window.showTaskError = function(row) {
  const msg = row.dataset.error || 'Không có thông báo lỗi';
  openModal('Lỗi tác vụ', '<pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;color:var(--error)">' + esc(msg) + '</pre>');
};

const views = { overview, proxies, logs, settings, system, monitor };

window.addEventListener('hashchange', function() {
  const v=location.hash.slice(1)||'overview';
  if(currentView!==v) navigate(v);
});

api('GET','/settings').then(function(s){_settings=s;}).catch(function(){});
connectSSE();
navigate(location.hash.slice(1)||'overview');
