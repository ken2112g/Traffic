@echo off
cd /d "%~dp0"
set LOG=%~dp0startup.log
echo. > "%LOG%"
echo === DOAN CHUAN DOAN === >> "%LOG%"
echo Thoi gian: %DATE% %TIME% >> "%LOG%"
echo. >> "%LOG%"

echo [1] Kiem tra Node.js... >> "%LOG%"
where node >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1

echo [2] Thu muc hien tai: >> "%LOG%"
cd >> "%LOG%"

echo [3] Files co trong thu muc: >> "%LOG%"
dir /b >> "%LOG%"

echo [4] Kiem tra .env: >> "%LOG%"
if exist ".env" (echo .env TON TAI >> "%LOG%") else (echo .env KHONG CO >> "%LOG%")

echo [5] Kiem tra node_modules: >> "%LOG%"
if exist "node_modules" (echo node_modules TON TAI >> "%LOG%") else (echo node_modules KHONG CO >> "%LOG%")

echo [6] Kiem tra package.json: >> "%LOG%"
if exist "package.json" (echo package.json TON TAI >> "%LOG%") else (echo package.json KHONG CO >> "%LOG%")

echo [7] Test chay Node: >> "%LOG%"
node -e "console.log('node OK')" >> "%LOG%" 2>&1

echo [8] Kiem tra npx: >> "%LOG%"
where npx >> "%LOG%" 2>&1

echo [9] Kiem tra Redis port 6379: >> "%LOG%"
netstat -an 2>nul | find "6379" >> "%LOG%"

echo [10] Kiem tra start.bat co ton tai: >> "%LOG%"
if exist "start.bat" (echo start.bat TON TAI >> "%LOG%") else (echo start.bat KHONG CO >> "%LOG%")

echo. >> "%LOG%"
echo === XONG === >> "%LOG%"

echo.
echo Ket qua chuan doan da ghi vao: startup.log
echo.
type "%LOG%"
echo.
pause
