@echo off
setlocal EnableExtensions

cd /d "%~dp0" || goto :directory_error
title EPOCHWRIGHT Development Server

where node.exe >nul 2>nul || goto :node_missing
where npm.cmd >nul 2>nul || goto :npm_missing

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%V in ('node.exe -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_missing
if %NODE_MAJOR% LSS 22 goto :node_outdated

set "LOCK_HASH="
for /f %%H in ('powershell.exe -NoProfile -Command "(Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash" 2^>nul') do set "LOCK_HASH=%%H"

set "INSTALLED_HASH="
if exist "node_modules\.epochwright-lock.sha256" (
  set /p INSTALLED_HASH=<"node_modules\.epochwright-lock.sha256"
)

set "NEED_INSTALL=0"
if not exist "node_modules\.bin\vite.cmd" set "NEED_INSTALL=1"
if defined INSTALLED_HASH if defined LOCK_HASH if /i not "%LOCK_HASH%"=="%INSTALLED_HASH%" set "NEED_INSTALL=1"

if not defined INSTALLED_HASH if "%NEED_INSTALL%"=="0" (
  call npm.cmd ls --depth=0 --silent >nul 2>nul
  if errorlevel 1 set "NEED_INSTALL=1"
  if not errorlevel 1 if defined LOCK_HASH >"node_modules\.epochwright-lock.sha256" echo %LOCK_HASH%
)

if /i "%~1"=="--check" goto :check_only

set "OPEN_BROWSER=--open"
if /i "%~1"=="--no-open" set "OPEN_BROWSER="

if "%NEED_INSTALL%"=="1" (
  echo [EPOCHWRIGHT] Installing dependencies from package-lock.json...
  call npm.cmd ci
  if errorlevel 1 goto :install_error
  if defined LOCK_HASH >"node_modules\.epochwright-lock.sha256" echo %LOCK_HASH%
)

echo [EPOCHWRIGHT] Starting the development server...
echo [EPOCHWRIGHT] Keep this window open. Press Ctrl+C to stop.
echo.
call npm.cmd run dev -- --host 127.0.0.1 %OPEN_BROWSER%
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [EPOCHWRIGHT] The development server exited with code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%

:check_only
echo [EPOCHWRIGHT] Node.js %NODE_MAJOR% and npm are available.
if "%NEED_INSTALL%"=="1" (
  echo [EPOCHWRIGHT] Dependencies will be installed on the next normal launch.
) else (
  echo [EPOCHWRIGHT] Dependencies match package-lock.json.
)
endlocal & exit /b 0

:directory_error
echo [EPOCHWRIGHT] Cannot open the project directory.
goto :fatal

:node_missing
echo [EPOCHWRIGHT] Node.js was not found. Install Node.js 22 or newer first.
goto :fatal

:node_outdated
echo [EPOCHWRIGHT] Node.js 22 or newer is required. Current major version: %NODE_MAJOR%.
goto :fatal

:npm_missing
echo [EPOCHWRIGHT] npm was not found. Reinstall Node.js with npm included.
goto :fatal

:install_error
echo.
echo [EPOCHWRIGHT] Dependency installation failed.

:fatal
echo.
pause
endlocal & exit /b 1
