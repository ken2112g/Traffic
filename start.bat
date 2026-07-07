@echo off
cd /d "%~dp0"
chcp 65001 >nul
title TrafficTool
echo.
echo  ==========================================
echo    TRAFFIC TOOL  v2.0
echo  ==========================================
echo.

:: ── Kiem tra Node.js ──────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [LOI] Khong tim thay Node.js!
    echo  Tai tai: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: ── Cai dat dependencies neu chua co ─────────────────────────
if not exist "node_modules" (
    echo  [INFO] Cai dat dependencies...
    call npm install
    if errorlevel 1 (
        echo  [LOI] npm install that bai!
        pause
        exit /b 1
    )
)
echo  [OK] node_modules san sang

:: ── Copy .env neu chua co ────────────────────────────────────
if not exist ".env" (
    if exist ".env.example" copy ".env.example" ".env" >nul
)
echo  [OK] .env san sang

:: ── Tao thu muc ──────────────────────────────────────────────
if not exist "data"     mkdir data
if not exist "sessions" mkdir sessions

:: ── Kiem tra Redis ───────────────────────────────────────────
echo.
set REDIS_RUNNING=0
set REDIS_EXE=

:: Kiem tra redis dang chay
netstat -an 2>nul | find "6379" | find "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set REDIS_RUNNING=1
    echo  [OK] Redis dang chay tren port 6379
    goto :menu
)

:: Tim redis-server trong thu muc con
if exist "redis\redis-server.exe" (
    set REDIS_EXE=redis\redis-server.exe
    echo  [OK] Tim thay Redis tai: redis\redis-server.exe
    goto :start_redis
)

:: Tim redis-server trong PATH
where redis-server >nul 2>&1
if not errorlevel 1 (
    set REDIS_EXE=redis-server
    echo  [OK] Tim thay Redis trong PATH
    goto :start_redis
)

:: Khong co Redis
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  [CANH BAO] Redis chua duoc cai dat!                    ║
echo  ║                                                          ║
echo  ║  Redis la yeu cau BAT BUOC de chay Engine.              ║
echo  ║  Khong co Redis: task se mai o trang thai PENDING.       ║
echo  ║                                                          ║
echo  ║  Cach cai dat Redis tren Windows (chon 1):              ║
echo  ║                                                          ║
echo  ║  CACH 1 (DE NHAT): Tai Redis portable                  ║
echo  ║    1. Mo trinh duyet, truy cap:                          ║
echo  ║       github.com/tporadowski/redis/releases             ║
echo  ║    2. Tai file Redis-x64-5.0.14.zip                    ║
echo  ║    3. Giai nen, copy toan bo vao thu muc "redis\"        ║
echo  ║       (cung cap voi start.bat nay)                       ║
echo  ║    4. Chay lai start.bat - se tu dong khoi dong Redis   ║
echo  ║                                                          ║
echo  ║  CACH 2: Cai Memurai (Redis cho Windows)               ║
echo  ║    https://www.memurai.com/                              ║
echo  ║                                                          ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
echo  Ban van co the chay Dashboard (xem du lieu, khong chay task).
goto :menu

:start_redis
echo  [INFO] Khoi dong Redis...
start "Redis Server" /min cmd /c "%REDIS_EXE% --port 6379 --loglevel warning"
timeout /t 2 /nobreak >nul
:: Kiem tra lai
netstat -an 2>nul | find "6379" | find "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set REDIS_RUNNING=1
    echo  [OK] Redis da khoi dong thanh cong!
) else (
    echo  [CANH BAO] Redis co the khoi dong chua xong...
)

:menu
echo.
echo  ┌─────────────────────────────────────────────┐
if "%REDIS_RUNNING%"=="1" (
echo  │  Redis: DANG CHAY ✓                         │
) else (
echo  │  Redis: KHONG CHAY ✗ (task se bi PENDING)   │
)
echo  ├─────────────────────────────────────────────┤
echo  │  1) Dashboard UI only  (khong can Redis)    │
echo  │  2) Engine + Dashboard  (can Redis)         │
echo  │  3) Thoat                                   │
echo  └─────────────────────────────────────────────┘
echo.
choice /c 123 /n /m "  Chon [1/2/3]: "
if errorlevel 3 exit /b 0
if errorlevel 2 goto :full
if errorlevel 1 goto :ui_only

:ui_only
echo.
echo  Khoi dong Dashboard...
start "TrafficTool Dashboard" cmd /k "cd /d %~dp0 && node src/ui/server.js"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3100"
echo  Dashboard: http://localhost:3100
goto :done

:full
if "%REDIS_RUNNING%"=="0" (
    echo.
    echo  [CANH BAO] Redis chua chay! Task se khong duoc xu ly.
    echo  Xem huong dan cai dat Redis o tren.
    echo.
    pause
)
echo.
echo  Khoi dong Engine + Dashboard...
start "TrafficTool Engine" cmd /k "cd /d %~dp0 && node src/index.js"
timeout /t 3 /nobreak >nul
start "TrafficTool Dashboard" cmd /k "cd /d %~dp0 && node src/ui/server.js"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3100"
echo  Engine + Dashboard da khoi dong!
echo  Dashboard: http://localhost:3100

:done
echo.
echo  Nhan phim bat ky de dong cua so nay...
pause >nul