# Campaign Form UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the campaign creation/edit UI trustworthy and understandable: live URL preview with an "open in new tab" check, sane action defaults with randomized repin/comment per account/day, and a guided schedule picker instead of a raw cron field.

**Architecture:** Frontend-only changes to the plain (non-module) script `src/ui/public/app.js` and `src/ui/public/index.html`, plus one small backend change in `src/core/scheduler.js` to randomize repin/comment inclusion per account per day. No new dependencies, no new API endpoints, no build step.

**Tech Stack:** Vanilla JS (`src/ui/public/app.js`, classic script, functions attached via `window.foo = ...` when called from inline HTML attributes), plain HTML/CSS, Node.js ESM backend (`src/core/scheduler.js`), Node's built-in test runner (`node:test` + `node:assert/strict` — no new dependency, available since Node 18, project runs Node v24).

## Global Constraints

- No new npm dependencies — the project already has zero JS frontend build tooling and the backend test uses Node's built-in `node --test`.
- Preserve existing 2-space indentation and code style already used in `app.js` / `index.html` / `scheduler.js`.
- All new UI copy is Vietnamese, terse, matching existing tone (see `PRODUCT.md`: "instrument panel, not landing page" — no decorative copy, no onboarding-style hand-holding).
- There is no automated test suite for the UI layer in this repo. Frontend tasks are verified manually by running `npm run ui` and exercising the dashboard in a browser, per the design spec (`docs/superpowers/specs/2026-07-07-campaign-form-ux-design.md`).
- One commit per task.

---

### Task 1: Randomize repin/comment scheduling (backend)

**Files:**
- Modify: `src/core/scheduler.js`
- Create: `src/core/scheduler.test.js`

**Interfaces:**
- Produces: `shouldScheduleAction(action: string, rng?: () => number): boolean` — named export from `src/core/scheduler.js`. No other task in this plan depends on it (backend-only, independent of the frontend tasks).

- [ ] **Step 1: Write the failing test**

Create `src/core/scheduler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldScheduleAction } from './scheduler.js';

test('like is always scheduled regardless of rng', () => {
  assert.equal(shouldScheduleAction('like', () => 0.999), true);
  assert.equal(shouldScheduleAction('like', () => 0.001), true);
});

test('follow is always scheduled regardless of rng', () => {
  assert.equal(shouldScheduleAction('follow', () => 0.999), true);
  assert.equal(shouldScheduleAction('follow', () => 0.001), true);
});

test('repin is scheduled only when rng() < 0.5', () => {
  assert.equal(shouldScheduleAction('repin', () => 0.49), true);
  assert.equal(shouldScheduleAction('repin', () => 0.5), false);
  assert.equal(shouldScheduleAction('repin', () => 0.9), false);
});

test('comment is scheduled only when rng() < 0.5', () => {
  assert.equal(shouldScheduleAction('comment', () => 0.1), true);
  assert.equal(shouldScheduleAction('comment', () => 0.75), false);
});

test('default rng produces roughly 50% inclusion over many samples', () => {
  const N = 2000;
  let count = 0;
  for (let i = 0; i < N; i++) if (shouldScheduleAction('repin')) count++;
  const ratio = count / N;
  assert.ok(ratio > 0.4 && ratio < 0.6, `ratio ${ratio} not close to 0.5`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/scheduler.test.js`
Expected: FAIL — `SyntaxError: The requested module './scheduler.js' does not provide an export named 'shouldScheduleAction'` (the function doesn't exist yet).

- [ ] **Step 3: Implement the minimal code to make the test pass**

In `src/core/scheduler.js`, add this exported function right after the existing `buildTargetUrl` function (before `export class Scheduler {`):

```js
export function shouldScheduleAction(action, rng = Math.random) {
  if (action === 'repin' || action === 'comment') return rng() < 0.5;
  return true;
}
```

Then wire it into `scheduleCampaign()`. Find this block (inside the `for (const account of accounts)` loop):

```js
      for (const action of actions) {
        if (!platformLimits[action]) continue;
        const times = this._distributeInWindow(1, fromHour, toHour);
```

Replace it with:

```js
      for (const action of actions) {
        if (!platformLimits[action]) continue;
        if (!shouldScheduleAction(action)) continue;
        const times = this._distributeInWindow(1, fromHour, toHour);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/scheduler.test.js`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/core/scheduler.js src/core/scheduler.test.js
git commit -m "feat: randomize repin/comment scheduling per account/day"
```

---

### Task 2: Live resolved-URL preview with "Mở ↗" link

**Files:**
- Modify: `src/ui/public/index.html`
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `buildTargetUrl(platform, username)` (plain function, app.js-internal) and `window.updateTargetPreview()` (global, called from inline HTML `oninput`/`onchange`). Task 4 will call `updateTargetPreview()` again as part of its own edit to the same reset line this task introduces — Task 4's diff depends on the exact line this task produces in `submitCampaign` (see Task 4's "Consumes").

- [ ] **Step 1: Add preview markup to index.html**

In `src/ui/public/index.html`, find this block:

```html
      <div class="form-group">
        <label class="form-label">Nền tảng *</label>
        <select class="form-input" name="platform" id="campaign-platform" onchange="updateActionCheckboxes(this.value)" required>
          <option value="">Chọn nền tảng…</option>
          <option value="pinterest">Pinterest</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="twitter">Twitter/X</option>
          <option value="facebook">Facebook</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tài khoản đích *</label>
        <input class="form-input" name="target_account" placeholder="username (không có @)" required>
      </div>
      <div class="form-group">
        <label class="form-label">URL mục tiêu</label>
        <input class="form-input" name="target_url" type="url" placeholder="https://…">
        <div class="form-hint">Để trống sẽ tự tạo từ username</div>
      </div>
```

Replace it with:

```html
      <div class="form-group">
        <label class="form-label">Nền tảng *</label>
        <select class="form-input" name="platform" id="campaign-platform" onchange="updateActionCheckboxes(this.value); updateTargetPreview()" required>
          <option value="">Chọn nền tảng…</option>
          <option value="pinterest">Pinterest</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="twitter">Twitter/X</option>
          <option value="facebook">Facebook</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tài khoản đích *</label>
        <input class="form-input" name="target_account" placeholder="username (không có @)" required oninput="updateTargetPreview()">
      </div>
      <div class="form-group">
        <label class="form-label">URL mục tiêu</label>
        <input class="form-input" name="target_url" type="url" placeholder="https://…" oninput="updateTargetPreview()">
        <div class="form-hint">Để trống sẽ tự tạo từ username</div>
        <div class="form-hint">
          <span id="target-preview-text">Nhập tài khoản/nền tảng để xem trước</span>
          <a id="target-preview-link" href="#" target="_blank" rel="noopener" style="display:none;margin-left:6px;color:var(--accent)">Mở ↗</a>
        </div>
      </div>
```

- [ ] **Step 2: Add buildTargetUrl + updateTargetPreview to app.js**

In `src/ui/public/app.js`, immediately after the closing `};` of `window.updateActionCheckboxes` (the block ending at the line containing only `};` right before `window.submitCampaign`), insert:

```js

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
```

- [ ] **Step 3: Clear the preview when the form resets after submit**

In `src/ui/public/app.js`, inside `window.submitCampaign`, find:

```js
    toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset();
```

Replace it with:

```js
    toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset(); updateActionCheckboxes(''); updateTargetPreview();
```

- [ ] **Step 4: Manual verification**

Run: `npm run ui`
Open http://localhost:3100 in a browser, click "+ Chiến dịch" on any platform (e.g. Pinterest).
- Type a username into "Tài khoản đích" → confirm the line below "URL mục tiêu" updates live to `→ https://www.pinterest.com/<username>/` and a green "Mở ↗" link appears.
- Click "Mở ↗" → confirm it opens the expected profile URL in a new tab.
- Type something into "URL mục tiêu" → confirm the preview line switches to show that exact URL instead.
- Clear both fields → confirm the preview reverts to "Nhập tài khoản/nền tảng để xem trước" and the link disappears.
- Submit the campaign, reopen the drawer → confirm the preview is reset (not showing the previous campaign's data).

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/app.js
git commit -m "feat: add live resolved-URL preview to campaign form"
```

---

### Task 3: Default-check like/follow, hint for randomized repin/comment

**Files:**
- Modify: `src/ui/public/index.html`
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (edits a different function body and a different part of index.html than Task 2 touched).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the hint element to index.html**

Find:

```html
      <div class="form-group">
        <label class="form-label">Hành động *</label>
        <div id="action-boxes" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <span style="font-size:12px;color:var(--muted)">Chọn nền tảng trước</span>
        </div>
      </div>
```

Replace it with:

```html
      <div class="form-group">
        <label class="form-label">Hành động *</label>
        <div id="action-boxes" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <span style="font-size:12px;color:var(--muted)">Chọn nền tảng trước</span>
        </div>
        <div class="form-hint" id="action-random-hint" style="display:none">Repin &amp; comment: mỗi ngày ngẫu nhiên 50% cho từng tài khoản</div>
      </div>
```

- [ ] **Step 2: Default-check like/follow and toggle the hint in app.js**

In `src/ui/public/app.js`, find:

```js
window.updateActionCheckboxes = function(platform) {
  const box = document.getElementById('action-boxes');
  const actions = PLATFORM_ACTIONS[platform] || [];
  if (!actions.length) { box.innerHTML = '<span style="font-size:12px;color:var(--muted)">Chọn nền tảng trước</span>'; return; }
  box.innerHTML = actions.map(a =>
    '<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" name="actions" value="' + esc(a) + '" style="accent-color:var(--accent)"> ' + esc(a) + '</label>'
  ).join('');
};
```

Replace it with:

```js
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
```

- [ ] **Step 3: Manual verification**

Run: `npm run ui` (if not already running from Task 2).
Open the campaign drawer, select "Pinterest" → confirm "like" and "follow" checkboxes are pre-checked, "repin"/"comment" are unchecked, and the hint text "Repin & comment: mỗi ngày ngẫu nhiên 50% cho từng tài khoản" appears below the checkboxes.
Select "YouTube" → confirm "like" is pre-checked (YouTube has no "follow" action, so only "like" is checked) and the hint still shows (YouTube has "comment").

- [ ] **Step 4: Commit**

```bash
git add src/ui/public/index.html src/ui/public/app.js
git commit -m "feat: default-check like/follow, show randomized repin/comment hint"
```

---

### Task 4: Guided schedule picker (create drawer)

**Files:**
- Modify: `src/ui/public/index.html`
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: the exact line Task 2 left in `submitCampaign`:
  `toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset(); updateActionCheckboxes(''); updateTargetPreview();`
- Produces: `window.scheduleModeChanged(prefix)`, `readScheduleValue(prefix)`, `initScheduleMode(prefix, currentSchedule)` — all take a DOM-id `prefix` (e.g. `'schedule'` or `'ec-schedule'`) so Task 5 (edit-campaign modal) can reuse them with a different prefix.

- [ ] **Step 1: Replace the raw cron field in index.html**

Find:

```html
      <div class="form-group">
        <label class="form-label">Lịch chạy</label>
        <input class="form-input" name="schedule" placeholder="auto  hoặc  0 8 * * *">
        <div class="form-hint">&quot;auto&quot; = 8 giờ sáng mỗi ngày. Cron expression để tùy chỉnh.</div>
      </div>
```

Replace it with:

```html
      <div class="form-group">
        <label class="form-label">Lịch chạy</label>
        <select class="form-input" id="schedule-mode" onchange="scheduleModeChanged('schedule')">
          <option value="auto">Tự động (8 giờ sáng mỗi ngày)</option>
          <option value="time">Giờ cụ thể</option>
          <option value="advanced">Nâng cao (cron tùy chỉnh)</option>
        </select>
        <div id="schedule-time-wrap" style="display:none;margin-top:6px">
          <input class="form-input" type="time" id="schedule-time" value="08:00">
        </div>
        <div id="schedule-cron-wrap" style="display:none;margin-top:6px">
          <input class="form-input" id="schedule-cron" placeholder="0 8 * * *">
          <div class="form-hint">Cron expression: phút giờ ngày tháng thứ. VD &quot;0 8 * * *&quot; = 8 giờ sáng mỗi ngày.</div>
        </div>
      </div>
```

- [ ] **Step 2: Add the shared schedule-mode helpers to app.js**

Insert this block right after the `buildTargetUrl` / `updateTargetPreview` code added in Task 2 (i.e. right before `window.submitCampaign`):

```js

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
```

- [ ] **Step 3: Wire the computed schedule into submitCampaign**

In `src/ui/public/app.js`, find:

```js
    await api('POST', '/campaigns', { name: fd.get('name'), platform: fd.get('platform'), target_account: fd.get('target_account'), target_url: fd.get('target_url') || null, actions, schedule: fd.get('schedule') || 'auto', account_ids: fd.get('account_ids') });
    toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset(); updateActionCheckboxes(''); updateTargetPreview();
```

Replace it with:

```js
    await api('POST', '/campaigns', { name: fd.get('name'), platform: fd.get('platform'), target_account: fd.get('target_account'), target_url: fd.get('target_url') || null, actions, schedule: readScheduleValue('schedule'), account_ids: fd.get('account_ids') });
    toast('Đã tạo chiến dịch'); closeDrawer(); e.target.reset(); updateActionCheckboxes(''); updateTargetPreview(); scheduleModeChanged('schedule');
```

(The trailing `scheduleModeChanged('schedule')` call re-hides the time/cron wraps after `reset()`, since native form reset restores the `<select>` to "auto" but does not touch the `display` style set on the wrapper divs.)

- [ ] **Step 4: Manual verification**

Run: `npm run ui` (if not already running).
Open the campaign drawer:
- Confirm "Lịch chạy" defaults to "Tự động (8 giờ sáng mỗi ngày)" with no extra input visible.
- Switch to "Giờ cụ thể" → confirm a time picker appears (default 08:00); change it to e.g. 14:30, fill in the rest of the form, submit, then check the created campaign's schedule via `npm run cli list campaigns` — expect `30 14 * * *`.
- Create another campaign with "Tự động" → expect `schedule` = `auto`.
- Create another with "Nâng cao" and type `0 9 * * 1` → expect that exact string stored.
- Reopen the drawer after submitting → confirm the picker is back to "Tự động" with the time/cron inputs hidden (not stuck showing a leftover input from the previous campaign).

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/app.js
git commit -m "feat: replace raw cron field with guided schedule picker"
```

---

### Task 5: Reuse the schedule picker in the edit-campaign modal

**Files:**
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: `window.scheduleModeChanged(prefix)`, `readScheduleValue(prefix)`, `initScheduleMode(prefix, currentSchedule)` from Task 4, called here with `prefix = 'ec-schedule'`.
- Produces: nothing consumed by later tasks (last task in this plan).

- [ ] **Step 1: Replace the raw cron input in editCampaign with the picker markup**

Find:

```js
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
```

Replace it with:

```js
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
    '<select class="form-input" id="ec-schedule-mode" onchange="scheduleModeChanged(&apos;ec-schedule&apos;)">' +
    '<option value="auto">Tự động (8 giờ sáng mỗi ngày)</option>' +
    '<option value="time">Giờ cụ thể</option>' +
    '<option value="advanced">Nâng cao (cron tùy chỉnh)</option>' +
    '</select>' +
    '<div id="ec-schedule-time-wrap" style="display:none;margin-top:6px">' +
    '<input class="form-input" type="time" id="ec-schedule-time" value="08:00"></div>' +
    '<div id="ec-schedule-cron-wrap" style="display:none;margin-top:6px">' +
    '<input class="form-input" id="ec-schedule-cron" placeholder="0 8 * * *"></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Hành động (cach nhau boi dau phay)</label>' +
    '<input class="form-input" id="ec-actions" value="' + esc(actions) + '"></div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button>' +
    '<button class="btn btn--primary" id="ec-save">Lưu</button>'
  );
  initScheduleMode('ec-schedule', c.schedule);
  document.getElementById('ec-save').onclick = () => submitEditCampaign(id);
};
window.submitEditCampaign = async function(id) {
  const name     = document.getElementById('ec-name').value.trim();
  const url      = document.getElementById('ec-url').value.trim() || null;
  const schedule = readScheduleValue('ec-schedule');
  const actions  = document.getElementById('ec-actions').value.split(',').map(s=>s.trim()).filter(Boolean);
  if (!name) { toast('Cần nhập tên','error'); return; }
  try {
    await api('PUT','/campaigns/'+id,{name,target_url:url,schedule,actions});
    toast('Đã cập nhật chiến dịch'); closeModal(); navigate(currentView);
  } catch(err){toast(err.message,'error');}
};
```

Note the `&apos;ec-schedule&apos;` inside the double-quoted `onchange="..."` attribute — this is HTML-entity-escaped single quotes so the string concatenation (which uses single-quoted JS string literals) doesn't break; the browser decodes `&apos;` back to `'` before executing the attribute as JS.

- [ ] **Step 2: Manual verification**

Run: `npm run ui` (if not already running).
- Create a campaign with schedule "Tự động", go to that platform's Chiến dịch tab, click to edit it → confirm the picker shows "Tự động" selected.
- Create a campaign via "Giờ cụ thể" at 09:15, edit it → confirm the picker shows "Giờ cụ thể" with the time input pre-filled `09:15`.
- Create a campaign via "Nâng cao" with `0 9 * * 1`, edit it → confirm the picker shows "Nâng cao" with the cron input pre-filled `0 9 * * 1`.
- Change the mode in the edit modal and save → confirm `npm run cli list campaigns` shows the updated schedule string.

- [ ] **Step 3: Commit**

```bash
git add src/ui/public/app.js
git commit -m "feat: reuse guided schedule picker in edit-campaign modal"
```