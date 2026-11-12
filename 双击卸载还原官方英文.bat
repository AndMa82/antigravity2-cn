@echo off
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
