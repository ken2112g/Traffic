# Automated Pinterest Account Registration — Design Spec

Date: 2026-07-08

## Problem

`src/workers/pinterest_register.worker.js` already implements automated Pinterest
account creation: generates a temp-mail address via `TempMail` (mail.tm API),
fills the Pinterest signup form, waits for the confirmation email, and clicks the
verify link. It is exposed only via `npm run cli register-accounts --count N --role
sub|main`.

Two problems block using this from the Dashboard:

1. On CAPTCHA (or any unrecognized manual step) and on "no verify email found",
   the worker blocks on `readline` waiting for an Enter keypress in a terminal.
   There is no terminal attached when this runs as a background job triggered by
   an HTTP request, so it would hang forever.
2. The batch-loop logic (loop N times, random 30-60s delay between accounts,
   per-account try/catch so one failure doesn't abort the batch) lives inline in
   `scripts/cli.js`'s `register-accounts` command — there's no reusable function
   an API endpoint can call.

## Scope

Backend: `src/workers/pinterest_register.worker.js` (remove readline, add polling;
extract `registerAccountsBatch`), `scripts/cli.js` (reuse the extracted function),
`src/ui/server.js` (new endpoint).
Frontend: `src/ui/public/index.html` / `app.js` (new button + modal on the
Pinterest platform view).

Out of scope: automatic CAPTCHA solving (still manual, via the visible
`headless:false` browser window), registration for platforms other than Pinterest
(no register worker exists for Instagram/TikTok), a cancel/stop control for an
in-progress batch (restart the Engine process is the existing escape hatch for
comparable long-running operations in this tool).

## 1. Replace readline with polling (`pinterest_register.worker.js`)

- Add a helper:
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
  ```
- Step 7 (CAPTCHA / stuck-on-register check): replace the `waitEnter(...)` call
  with `const solved = await waitForManualStep(page);`. If `solved` is `false`,
  `throw new Error('Timeout cho buoc thu cong (CAPTCHA) khi dang ky: ' + email)`
  — this aborts only the current account (caught by the batch loop's per-account
  try/catch) and is logged via the existing `finally { context.close(); browser.close(); }`.
- Step 9 (no verify link found): remove the `waitEnter(...)` fallback. Keep the
  existing `logger.warn(...)` call, then fall through to step 10 (save account)
  unchanged — this already happens unconditionally after the if/else today, so
  removing the wait doesn't change what gets saved, only removes the hang.
- Delete the now-unused `readline` import and `waitEnter` function.

## 2. Extract `registerAccountsBatch`

Add to `pinterest_register.worker.js`:

```js
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

`scripts/cli.js`'s `register-accounts` command replaces its inline loop (the
`for (let i = 0; i < count; i++) { ... }` block, currently using `console.log`/
`console.error` for progress) with a call to `registerAccountsBatch({ count, role
})`, keeping its existing platform/count validation and the "Dang ky N account..."
banner line before the call. This changes the command's progress output from
`console.log` to `logger.info` (already visible in the CLI's console via the
existing chalk-based logger, since `logger.js` writes to console too) — same
visible behavior, one shared implementation.

## 3. Dashboard integration

**Endpoint** (`src/ui/server.js`), placed near the other `/api/accounts/*` routes:

```js
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
```

`count` is clamped to 1-20 to prevent an accidental oversized batch. `server.js`
does not currently import `logger` — add `import { logger } from '../utils/logger.js';`
alongside its existing imports.

**Frontend**: in `renderPlatform()` (`app.js`), when `platform === 'pinterest'`,
add a button next to the existing `+ Chiến dịch` / `+ Tài khoản` buttons:

```html
<button class="btn btn--secondary btn--sm" onclick="showAutoRegister()">+ Tạo account tự động</button>
```

`showAutoRegister()` opens the existing `openModal()` with two fields (Số lượng —
number input, default 1, min 1, max 20; Vai trò — select sub/main, default sub)
and a submit button that POSTs to `/api/accounts/auto-register`. On success,
`closeModal()`, toast "Đã bắt đầu tạo N account — theo dõi ở Nhật ký", and
`navigate('logs')` to switch the operator to the existing live log view. On a 409
response, toast the server's error message instead.

## Known limitation (not addressed here)

`mail.tm` inboxes are free/ephemeral and Pinterest may rate-limit or block
known disposable-mail domains at signup, independent of anything in this spec.
If registrations start failing at the Pinterest-form or CAPTCHA stage
consistently (not just occasionally), that's a sign of this limitation, not a
bug in the polling/batch logic — out of scope to fix now, worth knowing if this
comes up in testing.

## Testing

No automated tests (this drives a real browser against live Pinterest, same as
the existing `pinterest_register.worker.js` — not something to mock or unit
test). Manual verification:
- `npm run cli register-accounts --count 2` still works end-to-end (regression
  check that the extraction didn't change CLI behavior).
- From the Dashboard, click "+ Tạo account tự động" on the Pinterest view,
  request 1 account, confirm a visible (non-headless) browser window opens,
  confirm the "Nhật ký" page shows live log lines as the registration proceeds,
  and confirm a CAPTCHA solved manually in that window lets the flow continue
  automatically (no Enter keypress needed).
- Trigger a second batch while the first is still running — confirm the 409
  response and the toast shown to the operator.