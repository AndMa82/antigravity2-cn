@echo off
chcp 65001 >nul
title Antigravity 中文汉化安装工具（纯 CDP 零修改模式）

echo.
echo [说明] 默认使用纯 CDP 运行时无修改汉化（不改动软件原版文件、不破签名、不影响自动更新）。
echo        如需传统 ASAR 全量菜单模式，请附加 --asar 参数运行。
echo.
echo 请选择左上角品牌显示方式：
echo [1] 显示英文 Antigravity（推荐）
echo [2] 不显示品牌名
echo [3] 显示为中文品牌名
set "CHOICE_VAL=1"
set /p "CHOICE_VAL=请输入选项 [1/2/3] (直接按 Enter 默认为 1): "
set "BRAND_ARG=--brand-title english"
if "%CHOICE_VAL%"=="2" set "BRAND_ARG=--brand-title hidden"
if "%CHOICE_VAL%"=="3" set "BRAND_ARG=--brand-title translated"

echo.
echo [1/2] 正在部署纯 CDP 中文汉化...
cd /d "%~dp0"
node "%~dp0localization_engine.js" --cdp-only %BRAND_ARG% %*

if %errorlevel% neq 0 (
    echo.
    echo [错误] 部署失败，请检查上方错误信息（确认已安装 Node.js >= 22）。
    pause
    exit /b 1
)

echo.
echo [2/2] 部署完成！
echo.
echo 提示：纯 CDP 中文汉化已启用（已打开的窗口会在 2.5 秒内自动生效）。
echo.
echo 窗口将在 5 秒后自动关闭...
timeout /t 5
