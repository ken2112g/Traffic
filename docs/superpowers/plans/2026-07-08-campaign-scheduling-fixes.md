# Campaign Scheduling Fixes + Task Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop re-scheduling accounts that already completed today's actions, make campaigns created with "Tất cả tài khoản phụ" automatically pick up accounts added later, and make the per-platform "Tác vụ" tab show which target a task is for plus a live "is anything running" indicator.

**Architecture:** A new `campaigns.account_scope` column (`'all'` | `'selected'`) lets the scheduler dynamically resolve "all sub accounts for this platform" at run time instead of relying on a fixed snapshot in `campaign_accounts`. The same per-account "already has a task today" check (now correctly counting any status, not just `pending`) gets applied in both the daily scheduler and the manual "Chạy ngay" trigger. The Tasks tab gains a target column, a campaign filter, and a 4-second-polling live-running banner, mirroring the existing "Theo dõi" (Monitor) page's pattern.

**Tech Stack:** Node.js ESM, `better-sqlite3`, Express (`src/ui/server.js`), vanilla JS dashboard (`src/ui/public/app.js`).

## Global Constraints

- No new npm dependencies.
- No automated test suite for the scheduler's DB-touching methods or the UI layer (matches existing project convention) — verification is manual except where a lightweight non-DB check is specified.
- All new UI copy is Vietnamese, terse, matching existing tone.
- Preserve existing 2-space indentation and code style in every file touched.
- One commit per task.
- Tasks must run in order: Task 1 (schema) before Tasks 2 and 3 (both depend on the new column); Task 3 before Task 4 (depends on the new `campaign_target` field in the tasks API).

---

### Task 1: `account_scope` column migration

**Files:**
- Modify: `src/db/schema.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `campaigns.account_scope` column, `TEXT DEFAULT 'all'`. Tasks 2 and 3 both read/write this column.

- [ ] **Step 1: Add the migration**

In `src/db/schema.js`, find:

```js
    -- Index để query nhanh
    CREATE INDEX IF NOT EXISTS idx_accounts_platform  ON accounts(platform);
    CREATE INDEX IF NOT EXISTS idx_accounts_status    ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_account      ON tasks(account_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled    ON tasks(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created       ON logs(created_at);
  `);
}
```

Replace with:

```js
    -- Index để query nhanh
    CREATE INDEX IF NOT EXISTS idx_accounts_platform  ON accounts(platform);
    CREATE INDEX IF NOT EXISTS idx_accounts_status    ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_account      ON tasks(account_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled    ON tasks(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created       ON logs(created_at);
  `);

  // Migration: account_scope thêm sau — 'all' = tự động gồm account mới, 'selected' = danh sách cố định
  try {
    db.exec("ALTER TABLE campaigns ADD COLUMN account_scope TEXT DEFAULT 'all'");
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}
```

- [ ] **Step 2: Verify the migration is idempotent and adds the column**

Run this command twice in a row:

```
node -e "import('./src/db/schema.js').then(m => { const cols = m.getDb().prepare('PRAGMA table_info(campaigns)').all().map(c => c.name); console.log(cols); })"
```

Expected both times: an array of column names including `account_scope`, printed with no error. The second run proves the `try/catch` guard correctly tolerates re-running the `ALTER TABLE` against an already-migrated database.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.js
git commit -m "feat: add account_scope column to campaigns table"
```

---

### Task 2: Scheduler dedup fix + dynamic account resolution

**Files:**
- Modify: `src/core/scheduler.js`

**Interfaces:**
- Consumes: `campaigns.account_scope` column from Task 1.
- Produces: `_resolveCampaignAccounts(campaign, excludeStatuses: string[])` — private method on `Scheduler`, used internally by `scheduleCampaign()` and `triggerNow()`. No other task calls it directly.

- [ ] **Step 1: Fix the "already scheduled today" check and use the new account resolver in `scheduleCampaign()`**

In `src/core/scheduler.js`, find:

```js
    const accounts = this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN campaign_accounts ca ON ca.account_id = a.id
      WHERE ca.campaign_id = ? AND a.status NOT IN ('banned', 'error')
    `).all(campaignId);

    let totalScheduled = 0;

    for (const account of accounts) {
      const already = this.db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE account_id=? AND campaign_id=? AND DATE(scheduled_at)=? AND status='pending'
      `).get(account.id, campaignId, today);
      if (already.c > 0) continue;
```

Replace with:

```js
    const accounts = this._resolveCampaignAccounts(campaign, ['banned', 'error']);

    let totalScheduled = 0;

    for (const account of accounts) {
      const already = this.db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE account_id=? AND campaign_id=? AND DATE(scheduled_at)=?
      `).get(account.id, campaignId, today);
      if (already.c > 0) continue;
```

(Dropping `AND status='pending'` means "already scheduled today" now correctly counts a task of any status — pending, running, done, or failed — not just tasks still sitting in the queue. This is the fix for accounts getting re-scheduled after their earlier task that same day already finished.)

- [ ] **Step 2: Apply the same dedup check and account resolver in `triggerNow()`**

Find:

```js
  async triggerNow(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const actions   = JSON.parse(campaign.actions);
    const targetUrl = campaign.target_url || buildTargetUrl(campaign.platform, campaign.target_account);
    const accounts  = this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN campaign_accounts ca ON ca.account_id=a.id
      WHERE ca.campaign_id=? AND a.status!='banned'
    `).all(campaignId);

    let count = 0;
    for (const account of accounts) {
      for (const action of actions) {
```

Replace with:

```js
  async triggerNow(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const today     = new Date().toISOString().slice(0, 10);
    const actions   = JSON.parse(campaign.actions);
    const targetUrl = campaign.target_url || buildTargetUrl(campaign.platform, campaign.target_account);
    const accounts  = this._resolveCampaignAccounts(campaign, ['banned']);

    let count = 0;
    for (const account of accounts) {
      const already = this.db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE account_id=? AND campaign_id=? AND DATE(scheduled_at)=?
      `).get(account.id, campaignId, today);
      if (already.c > 0) continue;

      for (const action of actions) {
```

(`triggerNow()` previously had no dedup check at all — every click re-created tasks for every account, including ones that already completed today. This makes "Chạy ngay" skip accounts already processed today, same as the automatic daily scheduler.)

- [ ] **Step 3: Add the `_resolveCampaignAccounts` helper**

Find:

```js
    logger.info('Scheduler', `triggerNow: enqueued ${count} tasks for campaign "${campaign.name}"`);
    return count;
  }

  // ─── Campaign management ─────────────────────────────────────────────────────
```

Replace with:

```js
    logger.info('Scheduler', `triggerNow: enqueued ${count} tasks for campaign "${campaign.name}"`);
    return count;
  }

  // ─── Resolve accounts cho 1 campaign (theo account_scope) ──────────────────
  // account_scope='all': luôn lấy toàn bộ account platform/sub hiện có (bao gồm account mới thêm sau)
  // account_scope='selected': dùng danh sách cố định trong campaign_accounts
  _resolveCampaignAccounts(campaign, excludeStatuses) {
    const placeholders = excludeStatuses.map(() => '?').join(',');
    if (campaign.account_scope === 'all') {
      return this.db.prepare(`
        SELECT * FROM accounts
        WHERE platform=? AND role='sub' AND status NOT IN (${placeholders})
      `).all(campaign.platform, ...excludeStatuses);
    }
    return this.db.prepare(`
      SELECT a.* FROM accounts a
      INNER JOIN campaign_accounts ca ON ca.account_id = a.id
      WHERE ca.campaign_id = ? AND a.status NOT IN (${placeholders})
    `).all(campaign.id, ...excludeStatuses);
  }

  // ─── Campaign management ─────────────────────────────────────────────────────
```

- [ ] **Step 4: Verify the module still loads correctly**

Run: `node --check src/core/scheduler.js`
Expected: no output, exit code 0 (confirms no syntax errors — this file drives live scheduling against the real DB, so no automated behavioral test is run here per the Global Constraints; behavioral verification happens after Task 3 is also in place, per this plan's final manual-verification section).

- [ ] **Step 5: Commit**

```bash
git add src/core/scheduler.js
git commit -m "fix: dedup already-completed accounts and dynamically resolve account_scope=all"
```

---

### Task 3: `account_scope` on campaign creation + `campaign_target` in tasks API

**Files:**
- Modify: `src/ui/server.js`

**Interfaces:**
- Consumes: `campaigns.account_scope` column from Task 1.
- Produces: `GET /api/tasks` responses now include a `campaign_target` field (the campaign's `target_account`, or `null` if the task has no campaign) on every task row. Task 4 (frontend) reads this field.

- [ ] **Step 1: Store `account_scope` when creating a campaign**

In `src/ui/server.js`, find:

```js
app.post('/api/campaigns', (req, res) => {
  try {
    const { name, platform, target_account, target_url, actions, schedule, account_ids } = req.body;
    if (!name || !platform || !target_account || !actions?.length) return res.status(400).json({ error: 'required fields missing' });
    const db = getDb(); const id = randomUUID();
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule) VALUES(?,?,?,?,?,?,?)')
      .run(id, name, platform, target_account, target_url || null, JSON.stringify(actions), schedule || 'auto');
    if (!account_ids || account_ids === 'all') {
```

Replace with:

```js
app.post('/api/campaigns', (req, res) => {
  try {
    const { name, platform, target_account, target_url, actions, schedule, account_ids } = req.body;
    if (!name || !platform || !target_account || !actions?.length) return res.status(400).json({ error: 'required fields missing' });
    const db = getDb(); const id = randomUUID();
    const accountScope = (!account_ids || account_ids === 'all') ? 'all' : 'selected';
    db.prepare('INSERT INTO campaigns(id,name,platform,target_account,target_url,actions,schedule,account_scope) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, name, platform, target_account, target_url || null, JSON.stringify(actions), schedule || 'auto', accountScope);
    if (accountScope === 'all') {
```

- [ ] **Step 2: Add `campaign_target` to the tasks query**

Find:

```js
    if (id) {
      const task = db.prepare(`
        SELECT t.*,a.username as account_username,c.name as campaign_name
        FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id
        WHERE t.id=?
      `).get(id);
      return res.json(task ? [task] : []);
    }
    let sql = `SELECT t.*,a.username as account_username,c.name as campaign_name
               FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id`;
```

Replace with:

```js
    if (id) {
      const task = db.prepare(`
        SELECT t.*,a.username as account_username,c.name as campaign_name,c.target_account as campaign_target
        FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id
        WHERE t.id=?
      `).get(id);
      return res.json(task ? [task] : []);
    }
    let sql = `SELECT t.*,a.username as account_username,c.name as campaign_name,c.target_account as campaign_target
               FROM tasks t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN campaigns c ON c.id=t.campaign_id`;
```

- [ ] **Step 3: Manual verification**

Run: `npm run ui` (if not already running).

Create a campaign (via the Dashboard drawer, or `npm run cli create-campaign ...`), then check its stored scope:

```
node -e "import('./src/db/schema.js').then(m => console.log(m.getDb().prepare('SELECT name, account_scope FROM campaigns ORDER BY created_at DESC LIMIT 1').get()))"
```

Expected: `{ name: '<the campaign you just created>', account_scope: 'all' }`.

Then check the tasks endpoint includes the new field:

```
curl "http://localhost:3100/api/tasks?limit=1"
```

Expected: the returned JSON array's single object includes a `campaign_target` key (its value will be `null` for a task with no campaign, or the target username string otherwise).

- [ ] **Step 4: Commit**

```bash
git add src/ui/server.js
git commit -m "feat: store account_scope on campaign create, add campaign_target to tasks API"
```

---

### Task 4: Tasks tab — target column, campaign filter, live running banner

**Files:**
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: `campaign_target` field from `GET /api/tasks` (Task 3), and the existing `GET /api/campaigns?platform=X` endpoint (already returns `id`, `name`, `target_account` per campaign — no backend change needed for this).
- Produces: nothing consumed by later tasks (last task in this plan).

- [ ] **Step 1: Add the live-interval state variable**

In `src/ui/public/app.js`, find:

```js
let monitorInterval = null;
```

Replace with:

```js
let monitorInterval = null;
let platformTaskLiveInterval = null;
```

- [ ] **Step 2: Clear the interval when navigating away from the platform view**

Find:

```js
function navigate(view) {
  if (monitorInterval && view !== 'monitor') { clearInterval(monitorInterval); monitorInterval = null; }
  currentView = view;
```

Replace with:

```js
function navigate(view) {
  if (monitorInterval && view !== 'monitor') { clearInterval(monitorInterval); monitorInterval = null; }
  if (platformTaskLiveInterval && view !== currentView) { clearInterval(platformTaskLiveInterval); platformTaskLiveInterval = null; }
  currentView = view;
```

- [ ] **Step 3: Clear the interval when switching away from the Tasks sub-tab**

Find:

```js
window.setPlatformTab = async function(platform, tab) {
  platformTab[platform] = tab;
```

Replace with:

```js
window.setPlatformTab = async function(platform, tab) {
  if (platformTaskLiveInterval && tab !== 'tasks') { clearInterval(platformTaskLiveInterval); platformTaskLiveInterval = null; }
  platformTab[platform] = tab;
```

- [ ] **Step 4: Rebuild `renderPlatformTasks` with the campaign filter and live banner container**

Find:

```js
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
```

Replace with:

```js
async function renderPlatformTasks(platform, el) {
  const campaigns = await api('GET', '/campaigns?platform=' + platform).catch(() => []);
  const campaignOpts = campaigns.map(c =>
    '<option value="' + c.id + '">' + esc(c.name) + ' &rarr; @' + esc(c.target_account) + '</option>'
  ).join('');
  el.innerHTML =
    '<div id="ptask-live" style="margin-bottom:10px"></div>' +
    '<div class="filter-bar" style="margin-bottom:16px">' +
    `<select id="ptask-status" onchange="reloadPlatformTasks('${platform}')">` +
    '<option value="all">Tất cả</option><option value="done">Done</option><option value="failed">Thất bại</option><option value="pending">Dang cho</option><option value="running">Đang chạy</option>' +
    '</select>' +
    `<select id="ptask-campaign" onchange="reloadPlatformTasks('${platform}')">` +
    '<option value="">Tất cả chiến dịch</option>' + campaignOpts +
    '</select>' +
    `<button class="btn btn--secondary btn--sm" onclick="reloadPlatformTasks('${platform}')">Refresh</button>` +
    '</div><div id="ptasks-wrap"><div class="skeleton" style="height:200px;border-radius:8px"></div></div>';
  await reloadPlatformTasks(platform);
  if (platformTaskLiveInterval) clearInterval(platformTaskLiveInterval);
  refreshPlatformTaskLive(platform);
  platformTaskLiveInterval = setInterval(function() { refreshPlatformTaskLive(platform); }, 4000);
}

window.refreshPlatformTaskLive = async function(platform) {
  const el = document.getElementById('ptask-live');
  if (!el) return;
  try {
    const running = await api('GET', '/tasks?platform=' + platform + '&status=running&limit=50');
    const count = running.length;
    el.innerHTML = '<div class="monitor-card"><div class="monitor-card-title">' +
      '<span class="monitor-dot' + (count ? '' : '-off') + '"></span>' +
      (count ? count + ' tác vụ đang chạy' : 'Đang rảnh — không có tác vụ nào') +
      '</div></div>';
  } catch {}
};
```

- [ ] **Step 5: Add the campaign filter to the query and add the "Đích" column**

Find:

```js
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
```

Replace with:

```js
window.reloadPlatformTasks = async function(platform) {
  const status     = document.getElementById('ptask-status')?.value || 'all';
  const campaignId = document.getElementById('ptask-campaign')?.value || '';
  const wrap = document.getElementById('ptasks-wrap');
  if (!wrap) return;
  try {
    let url = '/tasks?platform=' + platform + '&status=' + status + '&limit=100';
    if (campaignId) url += '&campaign_id=' + campaignId;
    const tasks = await api('GET', url);
    if (!tasks.length) { wrap.innerHTML = '<div class="empty-state"><h3>Chưa có tac vu</h3></div>'; return; }
    const rows = tasks.map(t => {
      const hasErr = t.status==='failed' && t.error;
      return '<tr' + (hasErr ? ' style="cursor:pointer" onclick="showTaskError(this)" data-error="' + esc(t.error||'') + '"' : '') + '>' +
      '<td class="td-mono">' + esc(t.account_username||'?') + '</td>' +
      '<td><span class="action-pill">' + esc(t.action) + '</span></td>' +
      '<td>' + badge(t.status) + '</td>' +
      '<td class="td-sm">' + esc(t.campaign_name||'---') + '</td>' +
      '<td class="td-mono td-sm">' + (t.campaign_target ? '@'+esc(t.campaign_target) : '---') + '</td>' +
      '<td class="td-sm">' + fmt(t.finished_at) + '</td>' +
      '<td class="col-actions">' + (t.status==='failed' ? `<button class="btn btn--xs btn--secondary" onclick="event.stopPropagation();retryTask('${t.id}')">Thử lại</button>` : '') + '</td></tr>';
    }).join('');
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Tài khoản</th><th>Hành động</th><th>Trạng thái</th><th>Chiến dịch</th><th>Đích</th><th>Hoàn thành lúc</th><th>Thử lại</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (err) { wrap.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
};
```

- [ ] **Step 6: Manual verification**

Run: `npm run ui` (if not already running).
Open a platform's "Tác vụ" tab. Confirm: a live banner appears above the filters showing either "N tác vụ đang chạy" or "Đang rảnh"; a "Chiến dịch" dropdown appears next to "Trạng thái", listing each campaign as "`name` → `@target`"; selecting a campaign narrows the table to only that campaign's tasks; the table has a new "Đích" column showing `@target_account` per row. Trigger a campaign ("Chạy ngay") and confirm the live banner updates to show a running count within 4 seconds without a manual refresh. Switch to a different tab (e.g. "Chiến dịch") and confirm (via browser dev tools or just observing no console errors / no stale network calls) the live polling stops; switch to a different platform in the sidebar and confirm the same.

Then verify the two backend fixes end-to-end, now that Tasks 1-3 are all in place:

- **No duplicate same-day tasks:** pick a campaign, click "Chạy ngay" once, wait for its tasks to finish (or check status via the Tasks tab), then click "Chạy ngay" on the same campaign again the same day. Confirm the second click does NOT create new tasks for accounts that already have a task today for that campaign — check via
  `node -e "import('./src/db/schema.js').then(m => console.log(m.getDb().prepare('SELECT account_id, action, status, COUNT(*) as c FROM tasks WHERE campaign_id=? AND DATE(scheduled_at)=DATE(\'now\') GROUP BY account_id, action HAVING c>1').all('<campaign-id-here>')))"`
  Expected: an empty array (no `account_id`+`action` pair with more than one task today for that campaign).
- **New accounts get included:** add a new sub-account for the same platform as an existing `account_scope='all'` campaign (via "+ Tài khoản"), then click "Chạy ngay" on that campaign. Confirm the new account receives tasks — check via the Tasks tab's campaign filter, or
  `node -e "import('./src/db/schema.js').then(m => console.log(m.getDb().prepare('SELECT COUNT(*) as c FROM tasks WHERE campaign_id=? AND account_id=?').get('<campaign-id-here>','<new-account-id-here>')))"`
  Expected: `{ c: <number greater than 0> }`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/public/app.js
git commit -m "feat: add target column, campaign filter, and live running banner to Tasks tab"
```