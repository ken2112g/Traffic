# Campaign Form UX Improvements — Design Spec

Date: 2026-07-07

## Problem

The "Chiến dịch mới" (new campaign) drawer in the dashboard (`src/ui/public/index.html` /
`app.js`) has three usability gaps reported by the operator:

1. No way to visually confirm the target account/URL is correct before creating a campaign.
2. The action checkboxes (like/follow/repin/comment) have no sensible defaults, and repin/comment
   are applied uniformly to every account every day — too mechanical/detectable.
3. The "Lịch chạy" (schedule) field is a raw text input expecting `"auto"` or a cron expression,
   with no guidance — the operator doesn't know what to type.

## Scope

Frontend: campaign create drawer (`#campaign-form` in `index.html`) and campaign edit modal
(`editCampaign` rendering in `app.js`, ~line 890-920).
Backend: `src/core/scheduler.js` `scheduleCampaign()` — per-account/day action selection.

Out of scope: no new API endpoints, no screenshot/embed preview, no per-account persisted
random traits.

## 1. Target URL live preview

Instead of two separate previews (one per field), show a single **resolved URL preview** that
always reflects the URL that will actually be used, updating live as the operator types.

- Location: new `<div id="target-preview" class="form-hint">` block placed after the "URL mục
  tiêu" field.
- Content: `→ <resolved url>` as text, plus an inline `<a target="_blank" rel="noopener">Mở ↗</a>`
  pointing at that exact URL.
- Resolution rule (mirrors `buildTargetUrl()` in `scheduler.js`, duplicated client-side as a pure
  JS function since it's a small stable string template):
  - if `target_url` field is non-empty → use it verbatim
  - else → build from `platform` + `target_account` using the same per-platform template as
    `scheduler.js`'s `buildTargetUrl()`
  - if `platform` or `target_account` is empty and `target_url` is empty → preview shows a muted
    placeholder ("Nhập tài khoản/nền tảng để xem trước") and the "Mở ↗" link is disabled/hidden.
- Wiring: `input`/`change` listeners on `target_account`, `target_url`, and the existing
  `platform` select's `onchange` (extend `updateActionCheckboxes` call site to also call
  `updatePreview()`).

## 2. Action defaults + randomized repin/comment

- `updateActionCheckboxes(platform)`: when rendering the checkbox list, pre-check `like` and
  `follow` (`checked` attribute) if those actions exist for the platform. `repin`/`comment`
  (and any other action) remain unchecked by default.
- Add a static hint line under the action checkboxes: *"Repin & comment: mỗi ngày ngẫu nhiên 50%
  cho từng tài khoản"* — shown whenever the platform's action list includes `repin` or `comment`.
- No change to submission payload — `actions` sent to the API stays the same (list of checked
  action names). The randomization is a scheduling-time behavior, not a form concern.
- `scheduler.js` `scheduleCampaign()`: in the per-account loop, when iterating
  `for (const action of actions)`, skip the action for that account/day if
  `(action === 'repin' || action === 'comment') && Math.random() >= 0.5`. This re-rolls every day
  (scheduleCampaign runs once per day per active "auto" campaign, or on each custom cron fire).
  All other actions keep current unconditional behavior.
- Follow-already-following skip: already implemented in all three workers' `_follow()` — no
  change needed.

## 3. Schedule field → guided picker

Replace the raw text `name="schedule"` input with a 3-mode picker, applied identically in both
the create drawer and the edit-campaign modal:

- `<select id="schedule-mode">`:
  - `auto` — "Tự động (8h sáng mỗi ngày)" — default selection.
  - `time` — "Giờ cụ thể" — reveals `<input type="time" id="schedule-time" value="08:00">`.
  - `advanced` — "Nâng cao (cron tùy chỉnh)" — reveals the existing raw text input (prefilled with
    current value, keeps existing hint text about cron syntax).
- Only one of the two extra inputs is visible at a time, toggled via the mode select's `onchange`.
- On submit, compute the final `schedule` string sent to the API from the active mode:
  - `auto` → `'auto'`
  - `time` → `` `${mm} ${hh} * * *` `` built from the time input's `HH:MM`
  - `advanced` → the raw cron text as typed
- Edit-campaign modal: replace its existing single cron text input (`#ec-sched`) with the same
  3-mode picker, initialized from the campaign's current `schedule` value (if it matches
  `^\d+ \d+ \* \* \*$` with reasonable hour/minute, prefill "time" mode with that HH:MM; if
  `'auto'`, select "auto"; otherwise select "advanced" and prefill the raw cron text).

## Testing

Manual verification only (no automated test suite exists for the UI layer):
- Start UI (`npm run ui`), open a platform's campaign drawer.
- Confirm live preview updates as platform/account/URL change, and "Mở ↗" opens the right link.
- Confirm like+follow pre-checked, repin/comment unchecked, hint text appears when platform has
  repin/comment.
- Create a campaign with repin+comment selected, trigger `scheduleCampaign` for several
  simulated accounts, confirm roughly half get repin/comment tasks and half don't (spot-check via
  DB `tasks` table).
- Confirm schedule dropdown produces correct `schedule` string in all 3 modes, and that the edit
  modal round-trips an existing campaign's schedule correctly.