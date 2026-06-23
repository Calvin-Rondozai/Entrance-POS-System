@echo off
echo Installing NexusPOS...
echo.

echo [1/2] Installing Python dependencies...
cd /d "%~dp0backend"
pip install -r requirements.txt
if errorlevel 1 (
    echo Failed to install Python dependencies.
    pause
    exit /b 1
)

echo.
echo [2/2] Installing Electron dependencies...
cd /d "%~dp0electron"
call npm install
if errorlevel 1 (
    echo Failed to install Electron dependencies.
    pause
    exit /b 1
)

echo.
echo Installation complete!
echo Run "cd electron && npm start" to launch NexusPOS.
pause
