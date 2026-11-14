@echo off
if exist "%APPDATA%\fnm\aliases\default\node.exe" set "PATH=%APPDATA%\fnm\aliases\default;%PATH%"
if exist "%LOCALAPPDATA%\fnm\aliases\default\node.exe" set "PATH=%LOCALAPPDATA%\fnm\aliases\default;%PATH%"
if exist "%USERPROFILE%\.volta\bin\node.exe" set "PATH=%USERPROFILE%\.volta\bin;%PATH%"
if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "PATH=%NVM_SYMLINK%;%PATH%"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
title Antigravity Restore Tool

echo.
echo [1/2] Restoring Official Files (Client, IDE, VS Code Extensions, Theme Patch ^& Auto-Heal)...
node "%~dp0localization_engine.js" --huifu %*

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Restoration Failed! Please check the error messages above.
    pause
    exit /b 1
)

echo.
echo [2/2] Restoration Complete!
echo.
echo [Note] Antigravity, IDE/VS Code extensions, theme patch, and auto-heal guards have been restored.
echo.
echo The window will close automatically in 5 seconds...
timeout /t 5
