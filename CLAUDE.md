# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Chạy engine (production) — cần Redis đang chạy
npm run dev        # Chạy với hot-reload (node --watch)
npm run cli        # CLI admin (xem bên dưới)
```

Copy `.env.example` → `.env`. Redis bắt buộc (BullMQ không hoạt động không có Redis). SQLite DB tạo tự động tại `DB_PATH`.

### CLI Admin (`scripts/cli.js`)

Không cần Redis, **trừ lệnh `trigger`**.

```bash
# Thêm accounts
npm run cli add-account --platform pinterest --username abc@gmail.com --password 123456 [--role main|sub]
npm run cli add-bulk --file accounts.csv          # CSV: platform,username,password,role

# Thêm proxies
npm run cli add-proxies --file proxies.txt        # mỗi dòng: host:port hoặc host:port:user:pass
npm run cli assign-proxies                         # tự gán proxy rảnh cho accounts chưa có

# Tạo campaign
npm run cli create-campaign --name "Buff PIN" --platform pinterest --target <username> \
  --actions like,follow,repin [--accounts all|id1,id2] [--url <url>] [--schedule "0 8 * * *"]
npm run cli add-to-campaign --campaign <id> --accounts all --platform pinterest

# Xem / thống kê
npm run cli list accounts|proxies|campaigns
npm run cli stats

# Chạy campaign ngay (không đợi cron)
npm run cli trigger --campaign <id>

# Quản lý
npm run cli delete-account --id <id>
npm run cli ban-account --id <id>
```

## Architecture

Multi-platform social media engagement tool — accounts "con" tự động like/follow/comment vào account "chính" để buff tương tác (dùng cho POD SEO).

### Data flow

```
CLI (seed data) → SQLite DB
npm start → scheduler.startAll():
  ├─ scheduleDay()    → INSERT pending tasks + BullMQ delayed jobs (random thời điểm)
  ├─ resumePending()  → re-enqueue DB pending tasks vào BullMQ (sau khi Redis restart)
  └─ midnight cron    → scheduleDay() lại cho ngày hôm sau
BullMQ delayed job fires → startWorker() → PlatformWorker.execute()
```

### Core modules (`src/core/`)

- **`accountManager.js`** — CRUD accounts. `daily_counts` (JSON) per account/ngày; tự reset khi sang ngày mới. `hasSession()` kiểm tra cookie đã lưu. Load `config/limits.json` sync ở top-level bằng `readFileSync` (không dùng dynamic import).
- **`proxyManager.js`** — Proxy pool. `getPlaywrightProxy(accountId)` → `{ server, username, password }` truyền thẳng vào Playwright context. `importFromText()` parse định dạng `host:port:user:pass`. `_buildAgent()` dùng `require('https-proxy-agent')` — package chưa có trong dependencies, `testProxy()` sẽ fail.
- **`queue.js`** — BullMQ wrapper. `enqueueBatch()` thêm **tích lũy** random delay (không phải độc lập per task). `startWorker(platformWorkers)` gọi `handler.execute()` **trực tiếp** — không có login flow khi chạy qua queue; session phải đã tồn tại.
- **`scheduler.js`** — Random scheduling. `scheduleDay()` là idempotent: với mỗi account, tung xúc xắc 75% có hoạt động hôm nay, rồi random số action (tối đa 65% daily limit), phân bổ đều vào `_distributeInWindow()`. `resumePending()` re-enqueue tasks DB còn pending vào BullMQ sau khi Redis mất dữ liệu. Cron nửa đêm gọi `scheduleDay()` tự động.

### Platform workers (`src/workers/`)

Tất cả kế thừa `BaseWorker`:
- `launch(accountId)` — Playwright + stealth plugin + proxy + session + block ảnh/font/media
- `close(accountId)` — lưu `storageState` → file rồi đóng browser
- `run()` — template: launch → login nếu chưa có session → execute → increment counter → close
- **Con phải implement**: `login(account)` và `execute({ accountId, action, targetUrl })`

Worker hiện có:
- **`pinterest.worker.js`** — `like` (2–4 pin/session), `follow`, `repin` (1–2 pin), `comment`. `targetUrl` là profile URL; worker tự tìm pin khi cần.
- **`instagram.worker.js`** — `like` (2–3 post/session), `follow`, `unfollow`, `comment`, `story_view`.
- **`tiktok.worker.js`** — `like` (2–4 video/session), `follow`, `comment`, `view` (3–6 video, xem 10–45s mỗi cái).

Mỗi action = 1 lần/ngày/account. Worker làm nhiều item trong 1 session (không schedule nhiều job riêng lẻ cho cùng 1 action). `_humanTypeWithMistake()` dùng chung từ `BaseWorker`.

### Database (`src/db/schema.js`)

SQLite (WAL mode). Schema tự khởi tạo khi gọi `getDb()` lần đầu.
- `accounts` — `role`: main|sub; `status`: idle|running|banned|error; `daily_counts` JSON; `session_path`
- `proxies` — `type`: static|rotating|mobile; `status`: active|dead|slow
- `campaigns` — `actions` JSON array; `schedule`: "auto" (= `0 8 * * *`) hoặc cron expression
- `campaign_accounts` — many-to-many accounts ↔ campaigns
- `tasks` — status: pending→running→done/failed; ghi `error` khi failed
- `logs` — mọi logger call đều INSERT vào đây

### Config (`config/limits.json`)

Giới hạn actions/ngày và delay theo từng platform. `delayMin`/`delayMax` (ms) dùng bởi `enqueueBatch()`. `activeHours: [7, 23]` = chỉ chạy từ 7h–23h.

### Logging (`src/utils/logger.js`)

Ghi đồng thời ra console (chalk) và bảng `logs` trong SQLite. Level điều khiển bởi `LOG_LEVEL` env (`debug|info|warn|error`).

## Adding a new platform

1. Tạo `src/workers/{platform}.worker.js` kế thừa `BaseWorker`
2. Implement `login(account)` và `execute({ accountId, action, targetUrl })`
3. Thêm limits vào `config/limits.json` với `delayMin`, `delayMax`, `activeHours` và action limits
4. Import và đăng ký trong `src/index.js` → `platformWorkers`
