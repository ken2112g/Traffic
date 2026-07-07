@echo off
cd /d "%~dp0"
title TrafficTool
echo.
echo  ==========================================
echo    TRAFFIC TOOL  v2.0
echo  ==========================================
echo.

:: Kiem tra Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [LOI] Khong tim thay Node.js^^!
    echo  Tai tai: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

if not exist "node_modules" (
    echo  [INFO] Cai dat dependencies...
    call npm install
    if errorlevel 1 ( pause & exit /b 1 )
)
echo  [OK] node_modules san sang

if not exist ".env" (
    if exist ".env.example" copy ".env.example" ".env" >nul
)
echo  [OK] .env san sang

if not exist "data"     mkdir data
if not exist "sessions" mkdir sessions

:: ?? Kiem tra Redis ??????????????????????????????????????????????
echo.
set REDIS_RUNNING=0

:: 1) Da co Redis dang lang nghe tren 6379?
netstat -an 2>nul | find "6379" | find "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set REDIS_RUNNING=1
    echo  [OK] Redis dang chay tren port 6379
    goto :menu
)

:: 2) Memurai service co khong? Neu co thi khoi dong no
sc query Memurai >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Khoi dong Memurai service...
    net start Memurai >nul 2>&1
    timeout /t 2 /nobreak >nul
    netstat -an 2>nul | find "6379" | find "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        set REDIS_RUNNING=1
        echo  [OK] Memurai da khoi dong^^!
        goto :menu
    )
)

:: 3) Tim redis-server.exe trong thu muc redis\
if exist "redis\redis-server.exe" (
    echo  [INFO] Khoi dong Redis portable...
    start "Redis Server" /min cmd /c ""%~dp0redis\redis-server.exe" --port 6379 --loglevel warning"
    timeout /t 2 /nobreak >nul
    netstat -an 2>nul | find "6379" | find "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        set REDIS_RUNNING=1
        echo  [OK] Redis da khoi dong^^!
        goto :menu
    )
)

:: 4) Tim redis-server trong PATH
where redis-server >nul 2>&1
if not errorlevel 1 (
    start "Redis Server" /min redis-server --port 6379 --loglevel warning
    timeout /t 2 /nobreak >nul
    set REDIS_RUNNING=1
    goto :menu
)

echo  [CANH BAO] Khong tim thay Redis^^!
echo  Cai Memurai: www.memurai.com
echo.

:menu
echo.
echo  =============================================
if "%REDIS_RUNNING%"=="1" (
    echo    Redis : DANG CHAY  [OK]
) else (
    echo    Redis : KHONG CHAY
)
echo  =============================================
echo    1. Dashboard UI only   ^(khong can Redis^)
echo    2. Engine + Dashboard  ^(can Redis^)
echo    3. Thoat
echo  =============================================
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
    echo  [CANH BAO] Redis chua chay^^! Task se khong duoc xu ly.
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
echo  Engine + Dashboard da khoi dong^^!

:done
echo.
echo  Nhan phim bat ky de dong cua so nay...
pause >nul
