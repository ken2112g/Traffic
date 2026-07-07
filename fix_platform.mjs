import { readFileSync, writeFileSync } from 'fs';
const p = new URL('./src/ui/public/app.js', import.meta.url);
let code = readFileSync(p, 'utf8');

// --- Fix 1: renderPlatform tabBtns line ---
// Replace the broken tab button generation with template literal version
const brokenTabBtn = /'\<button class="ptab ' \+ \(tab===k\?'active':''\) \+ '"[^>]+>'\s*\+\s*v\s*\+\s*'<\/button>'/;
const correctTabBtn = '`<button class="ptab ${tab===k?\'active\':\'\'}" onclick="setPlatformTab(\'${platform}\',\'${k}\')">${v}</button>`';
code = code.replace(brokenTabBtn, correctTabBtn);

// --- Fix 2: renderPlatform header buttons (Refresh, Campaign, Account) ---
// These all have the \'\' + platform + \'' pattern (mangled)
// Replace the entire el.innerHTML assignment in renderPlatform
const brokenRefresh = /'<button class="btn btn--secondary btn--sm" onclick="renderPlatform[^>]+>Refresh<\/button>'/;
const correctRefresh = '`<button class="btn btn--secondary btn--sm" onclick="renderPlatform(\'${platform}\',document.getElementById(\'content\'))">Refresh</button>`';
code = code.replace(brokenRefresh, correctRefresh);

const brokenCampaign = /'<button class="btn btn--primary btn--sm" onclick="openDrawer\([^>]+Campaign<\/button>'/;
const correctCampaign = '`<button class="btn btn--primary btn--sm" onclick="openDrawer(\'${platform}\')">+ Campaign</button>`';
code = code.replace(brokenCampaign, correctCampaign);

const brokenAccount = /'<button class="btn btn--secondary btn--sm" onclick="showAddAccount\([^>]+Account<\/button>'/;
const correctAccount = '`<button class="btn btn--secondary btn--sm" onclick="showAddAccount(\'${platform}\')">+ Account</button>`';
code = code.replace(brokenAccount, correctAccount);

// --- Fix 3: renderSubAccounts - showBulkAccounts and openDrawer ---
// Fix: '<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts(...)">...'
code = code.replace(/'<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts\([^>]+Import CSV<\/button>'/g, function(m) {
  return '`<button class="btn btn--secondary btn--sm" onclick="showBulkAccounts(\'${platform}\')">Import CSV</button>`';
});

// --- Fix 4: renderPlatformTasks - reloadPlatformTasks onchange ---
code = code.replace(/'<select id="ptask-status" onchange="reloadPlatformTasks\([^>]+">/g, function(m) {
  return '`<select id="ptask-status" onchange="reloadPlatformTasks(\'${platform}\')">`';
});
code = code.replace(/'<button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks\([^>]+Refresh<\/button>'/g, function(m) {
  return '`<button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks(\'${platform}\')">Refresh</button>`';
});

// --- Fix 5: renderTargets - openDrawer button ---
code = code.replace(/'<button class="btn btn--primary"[^>]+onclick="openDrawer\([^>]+Campaign<\/button>'/g, function(m) {
  return '`<button class="btn btn--primary" style="margin-top:16px" onclick="openDrawer(\'${platform}\')">+ Create Campaign</button>`';
});

// --- Fix 6: renderPlatformCampaigns - openDrawer ---
code = code.replace(/'<button class="btn btn--primary btn--sm" onclick="openDrawer\([^>]+New Campaign<\/button>'/g, function(m) {
  return '`<button class="btn btn--primary btn--sm" onclick="openDrawer(\'${platform}\')">+ New Campaign</button>`';
});

// --- Fix 7: reloadPlatformTasks in renderPlatformTasks ---
code = code.replace(/'<div class="filter-bar"[^;]+<\/div>'/g, function(m) {
  if (!m.includes('ptask-status')) return m;
  return '`<div class="filter-bar" style="margin-bottom:16px"><select id="ptask-status" onchange="reloadPlatformTasks(\'${platform}\')">' +
    '<option value="all">All status</option><option value="done">Done</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="running">Running</option>' +
    '</select><button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks(\'${platform}\')">Refresh</button></div>`';
});

writeFileSync(p, code, 'utf8');
console.log('renderPlatform fixed');