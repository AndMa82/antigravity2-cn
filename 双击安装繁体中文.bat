@echo off
chcp 65001 >nul
title Antigravity - Install Traditional Chinese (CDP Mode)

echo.
echo [說明] 預設使用純 CDP 執行期無修改漢化（不改動軟體原版檔案、不破壞簽章、不影響自動更新）。
echo        如需傳統 ASAR 全量選單模式，請附加 --asar 參數執行。
echo.
echo 請選擇左上角品牌顯示方式:
echo [1] 保持英文 Antigravity（推薦）
echo [2] 不顯示品牌名稱
echo [3] 顯示繁體中文品牌名
set "CHOICE_VAL=1"
set /p "CHOICE_VAL=請輸入選項 [1/2/3] (直接按 Enter 預設為 1): "
set "BRAND_ARG=--brand-title english"
if "%CHOICE_VAL%"=="2" set "BRAND_ARG=--brand-title hidden"
if "%CHOICE_VAL%"=="3" set "BRAND_ARG=--brand-title translated"

echo.
echo [1/2] 正在部署純 CDP 繁體中文漢化...
cd /d "%~dp0"
node "%~dp0localization_engine.js" --cdp-only --tw %BRAND_ARG% %*

if %errorlevel% neq 0 (
    echo.
    echo 錯誤: 部署失敗, 請確認是否已安裝 Node.js ^>= 22。
    pause
    exit /b 1
)

echo.
echo [2/2] 完成!
echo.
echo 提示: 純 CDP 繁體中文漢化已啟用（已開啟的視窗會在 2.5 秒內自動生效）。
echo.
echo 視窗將在 5 秒後自動關閉...
timeout /t 5
