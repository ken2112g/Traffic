# Campaign Scheduling Fixes + Task Visibility — Design Spec

Date: 2026-07-08

## Problem

Reported by the operator, confirmed against live DB data (query results below):

1. **Already-completed accounts get re-scheduled the same day.** `scheduler.js`'s
   `scheduleCampaign()` treats an account as "not yet scheduled today" if it has
   no `pending` task for that campaign/day — but once a task moves to `done` or
   `failed`, it's no longer `pending`, so the very next `scheduleDay()` run (e.g.
   after an engine restart) re-schedules the same account/action again.
   `triggerNow()` ("Chạy ngay") has **no** such check at all — every click
   re-creates a full set of tasks regardless of what already ran today.
   Evidence: DB query found 8 accounts with duplicate same-day `done` tasks for
   the same campaign+action, e.g. account `1e3092e1...` has two `like` tasks for
   campaign "3", both `done`, scheduled 08:29:11 and 09:13:06 UTC the same day —
   44 minutes apart, matching engine restarts during today's work session.
2. **New accounts never join a campaign created with "Tất cả tài khoản phụ".**
   `POST /api/campaigns` (`server.js:223-226`) resolves `account_ids: 'all'` into
   a fixed list of currently-existing accounts **once**, at creation time, and
   writes that snapshot into `campaign_accounts`. The create-campaign drawer's
   "Tài khoản" field currently has only one option ("Tất cả tài khoản phụ") — so
   in practice every campaign created through the Dashboard is a snapshot that
   silently excludes any account added afterward.
3. **The per-platform "Tác vụ" tab doesn't show which target a task is for, and
   has no live "is anything running right now" indicator**, unlike the separate
   "Theo dõi" (Monitor) page which already has both (`app.js` `renderMonitorRunning`
   / `renderMonitorQueue`, polling every 4s). The operator has to remember which
   campaign name maps to which target account, and has no way to tell — from the
   Pinterest tab they're already looking at — whether anything is actively running.

## Scope

Backend: `src/db/schema.js` (new column + migration), `src/core/scheduler.js`
(dedup fix + dynamic account resolution), `src/ui/server.js` (`account_scope` on
campaign creation, `target_account` in the tasks query).
Frontend: `src/ui/public/app.js` (Tasks tab: target column, campaign filter,
live running banner).

Out of scope: a UI for picking specific accounts instead of "all" (the drawer
only offers "all" today — not changing that), deduplicating actions **across**
different campaigns that target the same account (this deployment currently has
3 overlapping Pinterest campaigns against the same target — consolidating them
is a data/usage decision for the operator, not a code fix), and correcting the
"TK" (account count) column's display value for `scope='all'` campaigns (it
still reflects the `campaign_accounts` snapshot count taken at creation, which
can drift low over time even though the fix below means new accounts DO get
scheduled — this is a cosmetic display gap, not a scheduling bug).

## 1. Stop re-scheduling already-completed accounts

- `scheduler.js`'s `scheduleCampaign()`: the "already scheduled today" check
  currently filters `AND status='pending'`. Drop that filter so it counts a task
  of **any** status (pending/running/done/failed) for that account+campaign+day —
  once an account has been scheduled today, it's not scheduled again that day,
  regardless of what happened to that task afterward.
- `triggerNow()`: add the identical per-account "already has a task today for
  this campaign" check before creating new tasks, so clicking "Chạy ngay" skips
  accounts already processed today instead of unconditionally duplicating them.
  This does mean "Chạy ngay" can no longer force a true re-run of an
  already-completed account on the same day — nothing in the current UI asked
  for that, and it directly addresses the reported "already liked/followed
  accounts still run again" complaint.

## 2. Dynamic account resolution for "all" campaigns

- Add a column: `campaigns.account_scope TEXT DEFAULT 'all'` (migration:
  `ALTER TABLE campaigns ADD COLUMN account_scope TEXT DEFAULT 'all'`, guarded
  against re-running on an already-migrated DB). Defaulting to `'all'` is
  correct for every campaign already in this deployment, since the drawer has
  never offered anything besides "all".
- `POST /api/campaigns` (`server.js`): store `account_scope='all'` when
  `account_ids` is missing/`'all'`, else `'selected'`. Keep populating
  `campaign_accounts` at creation time exactly as today either way (existing
  code elsewhere reads `campaign_accounts` for the account-count display; not
  changing that).
- `scheduler.js`: add a shared helper
  `_resolveCampaignAccounts(campaign, excludeStatuses)` that returns, for
  `account_scope==='all'`, **every** current `platform`+`role='sub'` account not
  in `excludeStatuses` (ignoring `campaign_accounts` entirely) — so an account
  added after the campaign was created is included the next time the campaign
  runs. For `account_scope==='selected'`, keep the existing
  `campaign_accounts` join. Both `scheduleCampaign()` and `triggerNow()` call
  this helper, each passing its own existing exclude-list
  (`['banned','error']` and `['banned']` respectively — preserving each
  function's current behavior exactly, only changing *which accounts* the list
  is drawn from).

## 3. Tasks tab: target column, campaign filter, live running banner

- `src/ui/server.js`'s `GET /api/tasks`: add `c.target_account as campaign_target`
  to both the by-id and the list SELECT (one-line addition each; `campaigns c`
  is already joined).
- `src/ui/public/app.js` `renderPlatformTasks(platform, el)`: add a second
  filter `<select id="ptask-campaign">`, populated from
  `GET /api/campaigns?platform=${platform}` (already exists, already returns
  `id`, `name`, `target_account` per campaign), with an "Tất cả" option plus one
  option per campaign labeled `"{name} → @{target_account}"`. Selecting one
  passes `campaign_id` to `GET /api/tasks` (parameter already supported
  server-side).
- Add a live section above the filter bar, `<div id="ptask-live">`, populated by
  a new `refreshPlatformTaskLive(platform)` that calls
  `GET /api/tasks?platform=${platform}&status=running&limit=50` and renders a
  one-line banner: "N tác vụ đang chạy" (or "Đang rảnh" when N=0), reusing the
  same `monitor-dot`/`monitor-dot-off` CSS classes the Monitor page already
  uses for visual consistency. Poll every 4s via `setInterval`, following the
  exact lifecycle pattern `monitor()`/`monitorInterval` already establishes:
  start the interval when the Tasks sub-tab renders, clear it when the operator
  navigates away from the Tasks sub-tab (reuse the existing `platformTab` state
  and clear on `setPlatformTab` when leaving `'tasks'`, mirroring how
  `navigate()` already clears `monitorInterval` when leaving `'monitor'`).
- Add a "Đích" column to the task table, rendering `t.campaign_target` (fallback
  `'---'` if null, matching the existing `campaign_name` fallback style).

## Testing

No automated test suite for the UI layer or scheduler's live-DB-touching
methods (matches existing project convention). Manual verification:
- Trigger a campaign twice in a row (or restart the engine after a same-day
  run) — confirm accounts that already completed today are skipped both by
  `scheduleDay()`'s automatic path and by clicking "Chạy ngay", and that the
  `tasks` table shows no new same-day duplicate for those accounts.
- Add a new account to the platform, then trigger (or wait for the daily
  schedule of) a campaign created via "Tất cả tài khoản phụ" — confirm the new
  account receives tasks without being manually re-added to the campaign.
- Open a platform's "Tác vụ" tab — confirm the target column is populated, the
  campaign filter narrows the list correctly, and the live banner reflects
  actual running tasks (trigger one and watch the banner update within 4s).