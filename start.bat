@echo off
cd /d "%~dp0"
chcp 65001 >nul
title TrafficTool
echo.
echo  ==========================================
echo    TRAFFIC TOOL
echo  ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  [LOI] Khong tim thay Node.js!
    echo  Tai tai: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

if not exist "node_modules" (
    echo  [INFO] Cai dat dependencies...
    call npm install
    if errorlevel 1 (
        echo  [LOI] npm install that bai!
        pause
        exit /b 1
    )
) else (
    echo  [OK] node_modules san sang
)

if not exist ".env" (
    if exist ".env.example" copy ".env.example" ".env" >nul
)
echo  [OK] .env san sang

:: Tao thu muc
if not exist "data"     mkdir data
if not exist "sessions" mkdir sessions

echo.
echo  Chon che do:
echo    1) Dashboard UI  (quan ly qua trinh duyet)
echo    2) Engine + Dashboard  (can Redis)
echo    3) Thoat
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
echo.
echo  Khoi dong Engine + Dashboard...
start "TrafficTool Engine" cmd /k "cd /d %~dp0 && node src/index.js"
timeout /t 3 /nobreak >nul
start "TrafficTool Dashboard" cmd /k "cd /d %~dp0 && node src/ui/server.js"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3100"
echo  Dashboard: http://localhost:3100

:done
echo.
echo  Nhan phim bat ky de dong...
pause >nul
