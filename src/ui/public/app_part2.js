

/* === PLATFORM VIEW === */
const PTAB_LABELS = { 'sub-accounts': 'Sub Accounts', targets: 'Targets', campaigns: 'Campaigns', tasks: 'Tasks' };

async function renderPlatform(platform, el) {
  const tab = platformTab[platform] || 'sub-accounts';
  const colorMap = { pinterest:'--pin', instagram:'--ig', tiktok:'--tt', youtube:'--yt', twitter:'--tw', facebook:'--fb' };
  const color = colorMap[platform] || '--accent';
  const tabBtns = Object.entries(PTAB_LABELS).map(([k,v]) =>
    '<button class="ptab ' + (tab===k?'active':'') + '" onclick="setPlatformTab('' + platform + '','' + k + '')">' + v + '</button>'
  ).join('');

  el.innerHTML =
    '<div class="view-header">' +
    '<h1 style="color:var(' + color + ')">' + capitalize(platform) + '</h1>' +
    '<div class="view-actions">' +
    '<button class="btn btn--secondary btn--sm" onclick="renderPlatform('' + platform + '',document.getElementById('content'))">Refresh</button>' +
    '<button class="btn btn--primary btn--sm" onclick="openDrawer('' + platform + '')">+ Campaign</button>' +
    '<button class="btn btn--secondary btn--sm" onclick="showAddAccount('' + platform + '')">+ Account</button>' +
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
      '<button class="btn btn--xs btn--danger" onclick="banAccount('' + a.id + '')">Ban</button>' +
      '<button class="btn btn--xs btn--danger" onclick="deleteAccount('' + a.id + '')">Del</button>' +
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
    '<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts('' + platform + '')">Import CSV</button>' +
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
    '<button class="btn btn--xs btn--secondary" onclick="banAccount('' + a.id + '')">Ban</button>' +
    '<button class="btn btn--xs btn--danger" onclick="deleteAccount('' + a.id + '')">Del</button>' +
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
    el.innerHTML = '<div class="empty-state" style="margin-top:40px"><div class="empty-state-icon">T</div><h3>No targets yet</h3><p>Create a campaign with a target account to start tracking</p><button class="btn btn--primary" style="margin-top:16px" onclick="openDrawer('' + platform + '')">+ Create Campaign</button></div>';
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
  let html = '<div class="view-actions" style="margin-bottom:16px"><button class="btn btn--primary btn--sm" onclick="openDrawer('' + platform + '')">+ New Campaign</button></div>';
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
      '<button class="btn btn--xs btn--secondary" onclick="toggleCampaign('' + c.id + '')">' + (c.is_active?'Pause':'Resume') + '</button>' +
      '<button class="btn btn--xs btn--secondary" onclick="triggerCampaign('' + c.id + '')">Run</button>' +
      '<button class="btn btn--xs btn--danger" onclick="deleteCampaign('' + c.id + '')">Del</button>' +
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
    '<select id="ptask-status" onchange="reloadPlatformTasks('' + platform + '')">' +
    '<option value="all">All status</option><option value="done">Done</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="running">Running</option>' +
    '</select>' +
    '<button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks('' + platform + '')">Refresh</button>' +
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
      '<td class="col-actions">' + (t.status==='failed' ? '<button class="btn btn--xs btn--secondary" onclick="retryTask('' + t.id + '')">Retry</button>' : '') + '</td></tr>'
    ).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Account</th><th>Action</th><th>Status</th><th>Campaign</th><th>Finished</th><th>Retry</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
};
