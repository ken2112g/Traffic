# Automated Pinterest Account Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Pinterest account auto-registration worker safe to trigger from a background HTTP request (no terminal attached), share its batch-loop logic between the CLI and a new Dashboard endpoint, and expose it as a button on the Pinterest platform view.

**Architecture:** `src/workers/pinterest_register.worker.js` already drives a real (non-headless) Playwright browser through Pinterest signup + email verification via `TempMail` (mail.tm). This plan removes its `readline`-based manual-pause points (which would hang forever with no terminal attached), extracts its batch loop into an exported `registerAccountsBatch()`, reuses it from `scripts/cli.js`, and adds a new Express endpoint + Dashboard button that call the same function. No new processes, no new dependencies, no database schema changes.

**Tech Stack:** Node.js ESM, Playwright (`playwright-extra` + `puppeteer-extra-plugin-stealth`), Express (`src/ui/server.js`), vanilla JS dashboard (`src/ui/public/app.js`).

## Global Constraints

- No new npm dependencies.
- `src/workers/pinterest_register.worker.js` drives a real browser against live Pinterest — there is no automated test suite for it (matches the project's existing pattern: no tests for any Playwright-driving worker). Verification is manual except where noted.
- All new UI copy is Vietnamese, terse, matching existing tone (see `PRODUCT.md`: "instrument panel, not landing page").
- The `/api/accounts/auto-register` endpoint clamps `count` to the range 1-20 server-side, regardless of what the client sends.
- Preserve existing 2-space indentation and code style in every file touched.
- One commit per task.

---

### Task 1: Replace readline with polling, extract `registerAccountsBatch`

**Files:**
- Modify: `src/workers/pinterest_register.worker.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export async function registerAccountsBatch({ count, role = 'sub' } = {}): Promise<{ success: number, total: number }>` — named export from `src/workers/pinterest_register.worker.js`. Task 2 (CLI) and Task 3 (server endpoint) both import and call this.

- [ ] **Step 1: Remove the `readline` import**

In `src/workers/pinterest_register.worker.js`, find:

```js
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import readline from 'readline';
import path from 'path';
```

Replace with:

```js
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
```

- [ ] **Step 2: Replace `waitEnter` with a polling helper**

Find:

```js
async function waitEnter(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
}

async function fillIfExists(page, selector, value) {
```

Replace with:

```js
async function waitForManualStep(page, { timeoutMs = 5 * 60_000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.includes('register') && !url.includes('signup')) return true;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

async function fillIfExists(page, selector, value) {
```

- [ ] **Step 3: Replace the CAPTCHA wait (step 7) with polling**

Find:

```js
    if (hasCaptcha || stillOnRegister) {
      console.log('\n' + '='.repeat(55));
      console.log('  [THU CONG] CAPTCHA XUAT HIEN!');
      console.log(`  Email dang dung: ${email}`);
      console.log('  Hay giai CAPTCHA trong cua so trinh duyet,');
      console.log('  sau do click "Continue" / "Sign up".');
      console.log('  Khi da qua trang tiep theo, nhan Enter o day.');
      console.log('='.repeat(55) + '\n');
      await waitEnter('  Nhan Enter de tiep tuc sau khi giai CAPTCHA: ');
      await page.waitForTimeout(2000);
    }
```

Replace with:

```js
    if (hasCaptcha || stillOnRegister) {
      logger.warn('Register', `CAPTCHA/buoc thu cong cho ${email} — cho toi da 5 phut de giai tren cua so trinh duyet...`);
      const solved = await waitForManualStep(page);
      if (!solved) {
        throw new Error('Timeout cho buoc thu cong (CAPTCHA) khi dang ky: ' + email);
      }
      logger.info('Register', `Da qua buoc thu cong cho ${email}, tiep tuc...`);
      await page.waitForTimeout(2000);
    }
```

(This throw is caught by `registerAccountsBatch`'s per-account try/catch added in Step 5 below — one stuck account no longer blocks the rest of a batch, and it no longer hangs forever with nobody at a terminal to press Enter.)

- [ ] **Step 4: Remove the verify-email readline fallback (step 9)**

Find:

```js
    if (verifyLink) {
      await page.goto(verifyLink, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      console.log('  [OK] Email da xac nhan!');
    } else {
      console.log('  [WARN] Khong tim duoc link verify - co the Pinterest khong yeu cau, hoac kiem tra thu cong.');
      await waitEnter('  Nhan Enter khi ban da xu ly xong: ');
    }
```

Replace with:

```js
    if (verifyLink) {
      await page.goto(verifyLink, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      console.log('  [OK] Email da xac nhan!');
    } else {
      logger.warn('Register', `Khong tim duoc link verify cho ${email} - luu account nhung chua xac nhan email.`);
    }
```

(Step 10, which saves the account to the DB, already runs unconditionally after this block in the existing code — removing the wait doesn't change what gets saved, only removes the hang.)

- [ ] **Step 5: Add `registerAccountsBatch` at the end of the file**

Find the end of the file:

```js
  } finally {
    await context.close();
    await browser.close();
  }
}
```

Replace with:

```js
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function registerAccountsBatch({ count, role = 'sub' } = {}) {
  let success = 0;
  for (let i = 0; i < count; i++) {
    logger.info('Register', `--- Account ${i + 1}/${count} ---`);
    try {
      await registerPinterestAccount({ role });
      success++;
    } catch (e) {
      logger.error('Register', `Loi dang ky account ${i + 1}/${count}: ${e.message}`);
    }
    if (i < count - 1) {
      const wait = 30_000 + Math.floor(Math.random() * 30_000);
      logger.info('Register', `Nghi ${Math.round(wait / 1000)}s truoc account tiep theo...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  logger.info('Register', `Hoan tat batch: ${success}/${count} account thanh cong`);
  return { success, total: count };
}
```

- [ ] **Step 6: Verify the module loads and exports both functions**

Run: `node -e "import('./src/workers/pinterest_register.worker.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'registerPinterestAccount', 'registerAccountsBatch' ]` printed, no errors (this catches syntax errors and import-resolution errors — it does not exercise the browser/registration logic itself, which has no automated test per the Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add src/workers/pinterest_register.worker.js
git commit -m "fix: replace readline waits with polling in pinterest_register.worker.js"
```

---

### Task 2: Reuse `registerAccountsBatch` from the CLI

**Files:**
- Modify: `scripts/cli.js`

**Interfaces:**
- Consumes: `registerAccountsBatch({ count, role }): Promise<{ success, total }>` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the inline loop in the `register-accounts` command**

In `scripts/cli.js`, find:

```js
  // ── register-accounts ──────────────────────────────────────────────────────
  async 'register-accounts'(flags) {
    const platform = flags['platform'] || 'pinterest';
    const count    = parseInt(flags['count'] || '1', 10);
    const role     = flags['role'] || 'sub';

    if (platform !== 'pinterest') {
      console.error(chalk.red('Hien chi ho tro: pinterest'));
      process.exit(1);
    }
    if (isNaN(count) || count < 1) {
      console.error(chalk.red('--count phai la so nguyen duong'));
      process.exit(1);
    }

    const { registerPinterestAccount } = await import('../src/workers/pinterest_register.worker.js');

    console.log(chalk.bold(`\nDang ky ${count} account Pinterest (thu cong CAPTCHA)...\n`));
    let success = 0;
    for (let i = 0; i < count; i++) {
      console.log(chalk.bold.cyan(`\n--- Account ${i + 1} / ${count} ---`));
      try {
        await registerPinterestAccount({ role });
        success++;
        if (i < count - 1) {
          const wait = 30_000 + Math.floor(Math.random() * 30_000);
          console.log(chalk.gray(`  Nghi ${Math.round(wait / 1000)}s truoc account tiep theo...`));
          await new Promise(r => setTimeout(r, wait));
        }
      } catch (e) {
        console.error(chalk.red(`  [LOI] ${e.message}`));
      }
    }
    console.log(chalk.bold.green(`\nXong: ${success}/${count} account da tao thanh cong.`));
  },
```

Replace with:

```js
  // ── register-accounts ──────────────────────────────────────────────────────
  async 'register-accounts'(flags) {
    const platform = flags['platform'] || 'pinterest';
    const count    = parseInt(flags['count'] || '1', 10);
    const role     = flags['role'] || 'sub';

    if (platform !== 'pinterest') {
      console.error(chalk.red('Hien chi ho tro: pinterest'));
      process.exit(1);
    }
    if (isNaN(count) || count < 1) {
      console.error(chalk.red('--count phai la so nguyen duong'));
      process.exit(1);
    }

    const { registerAccountsBatch } = await import('../src/workers/pinterest_register.worker.js');

    console.log(chalk.bold(`\nDang ky ${count} account Pinterest (thu cong CAPTCHA)...\n`));
    const { success } = await registerAccountsBatch({ count, role });
    console.log(chalk.bold.green(`\nXong: ${success}/${count} account da tao thanh cong.`));
  },
```

- [ ] **Step 2: Manual verification**

Run: `npm run cli register-accounts --count 1`
Expected: a real Chromium window opens and navigates to the Pinterest signup page (same visible behavior as before this change — this confirms the refactor didn't break the CLI path). You do not need to complete a full registration to confirm this step; watching the browser open and the "Dang ky 1 account Pinterest..." banner print is sufficient. Ctrl+C to stop once confirmed if you don't want to complete a real registration.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli.js
git commit -m "refactor: reuse registerAccountsBatch in CLI register-accounts command"
```

---

### Task 3: `POST /api/accounts/auto-register` endpoint

**Files:**
- Modify: `src/ui/server.js`

**Interfaces:**
- Consumes: `registerAccountsBatch({ count, role }): Promise<{ success, total }>` from Task 1 (imported dynamically inside the route handler, matching the existing dynamic-import pattern already used elsewhere in this file for `scheduler.js`/`queue.js`).
- Produces: `POST /api/accounts/auto-register` — request body `{ count?: number, role?: 'sub'|'main' }`, response `{ started: true, count: number, role: string }` on 200, or `{ error: string }` on 409 if a batch is already running. Task 4 (frontend) calls this endpoint.

- [ ] **Step 1: Add the `logger` import**

In `src/ui/server.js`, find:

```js
import { getDb } from '../db/schema.js';
import { proxyManager } from '../core/proxyManager.js';
```

Replace with:

```js
import { getDb } from '../db/schema.js';
import { proxyManager } from '../core/proxyManager.js';
import { logger } from '../utils/logger.js';
```

- [ ] **Step 2: Add the endpoint**

Find:

```js
app.delete('/api/accounts/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Campaigns ─────────────────────────────────────────────────────────────────
```

Replace with:

```js
app.delete('/api/accounts/:id', (req, res) => {
  try { getDb().prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

let _autoRegisterRunning = false;

app.post('/api/accounts/auto-register', async (req, res) => {
  if (_autoRegisterRunning) {
    return res.status(409).json({ error: 'Đang có batch tạo account chạy, chờ xong đã' });
  }
  const count = Math.min(20, Math.max(1, parseInt(req.body.count, 10) || 1));
  const role  = req.body.role === 'main' ? 'main' : 'sub';

  _autoRegisterRunning = true;
  res.json({ started: true, count, role });

  const { registerAccountsBatch } = await import('../workers/pinterest_register.worker.js');
  registerAccountsBatch({ count, role })
    .catch(err => logger.error('Register', `Batch that bai: ${err.message}`))
    .finally(() => { _autoRegisterRunning = false; });
});

// ─── Campaigns ─────────────────────────────────────────────────────────────────
```

- [ ] **Step 3: Manual verification**

Run: `npm run ui` (if not already running)

In a separate terminal, run:

```bash
curl -X POST http://localhost:3100/api/accounts/auto-register -H "Content-Type: application/json" -d "{\"count\":1,\"role\":\"sub\"}"
```

Expected: an immediate JSON response `{"started":true,"count":1,"role":"sub"}`, and within a few seconds a real (visible) Chromium window opens navigating to the Pinterest signup page.

Then, while that first request is still running, send a second request with the same command.
Expected: `{"error":"Đang có batch tạo account chạy, chờ xong đã"}` with HTTP status 409 — confirms the concurrency guard works. You do not need to complete a real registration to confirm either check; Ctrl+C the browser/process once confirmed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/server.js
git commit -m "feat: add POST /api/accounts/auto-register endpoint"
```

---

### Task 4: Dashboard button + modal

**Files:**
- Modify: `src/ui/public/app.js`

**Interfaces:**
- Consumes: `POST /api/accounts/auto-register` from Task 3.
- Produces: nothing consumed by later tasks (last task in this plan).

- [ ] **Step 1: Add the button to the Pinterest platform view**

In `src/ui/public/app.js`, find:

```js
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
```

Replace with:

```js
  const autoRegisterBtn = platform === 'pinterest'
    ? '<button class="btn btn--secondary btn--sm" onclick="showAutoRegister()">+ Tạo account tự động</button>'
    : '';

  el.innerHTML =
    '<div class="view-header">' +
    '<h1 style="color:var(' + color + ')">' + capitalize(platform) + '</h1>' +
    '<div class="view-actions">' +
    `<button class="btn btn--secondary btn--sm" onclick="renderPlatform('${platform}',document.getElementById('content'))">Làm mới</button>` +
    `<button class="btn btn--primary btn--sm" onclick="openDrawer('${platform}')">+ Chiến dịch</button>` +
    `<button class="btn btn--secondary btn--sm" onclick="showAddAccount('${platform}')">+ Tài khoản</button>` +
    autoRegisterBtn +
    '</div></div>' +
    '<div class="ptabs">' + tabBtns + '</div>' +
    '<div id="ptab-content"></div>';
```

(`platform === 'pinterest'` gates this because no register worker exists yet for Instagram/TikTok — the button would fail on other platforms.)

- [ ] **Step 2: Add `showAutoRegister` / `submitAutoRegister`**

Find:

```js
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
```

Replace with:

```js
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
window.showAutoRegister = function() {
  openModal('Tạo account Pinterest tự động',
    '<div class="form-group"><label class="form-label">Số lượng</label>' +
    '<input class="form-input" id="ar-count" type="number" min="1" max="20" value="1"></div>' +
    '<div class="form-group"><label class="form-label">Vai trò</label>' +
    '<select class="form-input" id="ar-role"><option value="sub">Phụ (buff)</option><option value="main">Chính (mục tiêu)</option></select></div>' +
    '<div class="form-hint">Trình duyệt sẽ mở thật trên máy này — tự giải CAPTCHA nếu xuất hiện. Theo dõi tiến trình ở trang Nhật ký.</div>',
    '<button class="btn btn--secondary" onclick="closeModal()">Hủy</button><button class="btn btn--primary" onclick="submitAutoRegister()">Bắt đầu</button>'
  );
};
window.submitAutoRegister = async function() {
  const count = parseInt(document.getElementById('ar-count').value, 10) || 1;
  const role  = document.getElementById('ar-role').value;
  try {
    const r = await api('POST', '/accounts/auto-register', { count, role });
    toast('Đã bắt đầu tạo ' + r.count + ' account — theo dõi ở Nhật ký');
    closeModal();
    navigate('logs');
  } catch (err) { toast(err.message, 'error'); }
};
window.banAccount = async function(id) {
```

- [ ] **Step 3: Manual verification**

Run: `npm run ui` (if not already running).
Open http://localhost:3100, go to the Pinterest platform view. Confirm the "+ Tạo account tự động" button appears (and confirm it does NOT appear on e.g. the Instagram view). Click it, confirm the modal shows "Số lượng" (default 1) and "Vai trò" (default "Phụ (buff)"). Click "Bắt đầu", confirm a toast "Đã bắt đầu tạo 1 account — theo dõi ở Nhật ký" appears, the modal closes, and the view switches to "Nhật ký" showing live log lines from the registration (e.g. "Bat dau dang ky: ..."). Confirm a real browser window opened for the registration. Click the button again while the first run is still in progress — confirm a toast shows the "Đang có batch..." error instead of starting a second run.

- [ ] **Step 4: Commit**

```bash
git add src/ui/public/app.js
git commit -m "feat: add auto-register button and modal to Pinterest platform view"
```