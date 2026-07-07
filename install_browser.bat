@echo off
cd /d "%~dp0"
echo.
echo  === CAI CHROMIUM (chi can chay 1 lan) ===
echo.
call npx playwright install chromium
if errorlevel 1 (
    echo.
    echo  [LOI] Cai Chromium that bai!
    echo  Kiem tra ket noi mang roi thu lai.
    echo.
    pause
    exit /b 1
)
echo.
echo  [OK] Chromium da cai xong! Co the dung start.bat binh thuong.
echo.
pause
