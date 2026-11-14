#!/bin/bash
cd "$(dirname "$0")"

# 补充 macOS 常见环境路径 (兼容 Intel 与 Apple Silicon M 系列芯片及 nvm/fnm/volta/asdf/mise 等版本管理器)
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER" 2>/dev/null || echo "$HOME")
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/opt/local/bin:$PATH"
for p in "$REAL_HOME/.volta/bin" "$REAL_HOME/.asdf/shims" "$REAL_HOME/.local/share/mise/shims" "$REAL_HOME/.local/bin" "$REAL_HOME/.fnm/current/bin" "$REAL_HOME/.local/share/fnm/aliases/default/bin" "$REAL_HOME/Library/Application Support/fnm/aliases/default/bin"; do
    [ -d "$p" ] && export PATH="$p:$PATH"
done
for p in "$REAL_HOME"/.nvm/versions/node/*/bin "$REAL_HOME"/.local/share/fnm/node-versions/*/installation/bin "$REAL_HOME/Library/Application Support/fnm/node-versions"/*/installation/bin /opt/homebrew/opt/node@*/bin /usr/local/opt/node@*/bin; do
    [ -d "$p" ] && export PATH="$p:$PATH"
done

# 检查是否显式要求 --asar；默认采用纯 CDP 无修改方案（无需 root/修改 .app）
USE_ASAR=false
HAS_BRAND_ARG=false
HAS_CUSTOM_INSTALL_DIR=false
for arg in "$@"; do
    if [[ "$arg" == "--asar" ]]; then
        USE_ASAR=true
    elif [[ "$arg" == --brand-title* ]]; then
        HAS_BRAND_ARG=true
    elif [[ "$arg" == --install-dir* ]]; then
        HAS_CUSTOM_INSTALL_DIR=true
    fi
done

# 检查应用目录是否需要 root 权限（仅 --asar 模式且无写入权限时需要 sudo）
NEED_SUDO=false
if [ "$USE_ASAR" = true ] && [ "$EUID" -ne 0 ]; then
    for app_res in "/Applications/Antigravity.app/Contents/Resources" "/Applications/Antigravity IDE.app/Contents/Resources"; do
        if [ -d "$app_res" ] && [ ! -w "$app_res" ]; then
            NEED_SUDO=true
            break
        fi
    done
fi

if [ "$NEED_SUDO" = true ]; then
    echo "======================================================"
    echo " 提示：macOS 系统修改应用程序（/Applications）需要管理员权限"
    echo " 请在下方输入您的电脑开机密码（输入时密码不显示，直接回车）："
    echo "======================================================"
    exec sudo env "PATH=$PATH" "HTTP_PROXY=$HTTP_PROXY" "HTTPS_PROXY=$HTTPS_PROXY" "ALL_PROXY=$ALL_PROXY" "http_proxy=$http_proxy" "https_proxy=$https_proxy" "all_proxy=$all_proxy" "SUDO_USER=$USER" bash "$0" "$@"
fi

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo ""
    echo "======================================================"
    echo " [错误] 未检测到 Node.js 环境，无法执行汉化。"
    echo " 请前往 https://nodejs.org 下载安装 Node.js (LTS 版本) 后重试。"
    echo "======================================================"
    echo ""
    echo "按任意键退出..."
    read -n 1 -s
    exit 1
fi

EXTRA_ARGS=()
if [ "$USE_ASAR" = false ]; then
    EXTRA_ARGS+=(--cdp-only)
fi
if [ "$HAS_BRAND_ARG" = false ]; then
    BRAND_MODE="english"
    if [ -t 0 ]; then
        echo "====== 正在安装 macOS 版 Antigravity 中文汉化 ======"
        echo "请选择左上角品牌显示方式："
        echo "[1] 显示英文 Antigravity（推荐）"
        echo "[2] 不显示品牌名"
        echo "[3] 显示中文品牌名"
        printf "请输入 1/2/3，直接回车默认 1："
        read -r BRAND_CHOICE
        if [ "$BRAND_CHOICE" = "2" ]; then
            BRAND_MODE="hidden"
        elif [ "$BRAND_CHOICE" = "3" ]; then
            BRAND_MODE="translated"
        fi
    fi
    EXTRA_ARGS+=(--brand-title "$BRAND_MODE")
fi

node localization_engine.js "${EXTRA_ARGS[@]}" "$@"

if [ $? -ne 0 ]; then
    echo ""
    echo "======================================================"
    echo " 运行失败！"
    echo " 若上方提示 EPERM / operation not permitted（macOS 写入受限）："
    echo " 1. 打开 macOS「系统设置」->「隐私与安全性」->「App 管理」"
    echo " 2. 将「终端 (Terminal)」或您当前使用的终端工具勾选为【允许】"
    echo " 3. 重新双击运行本脚本即可！"
    echo "======================================================"
    read -n 1 -s
    exit 1
fi

echo ""
echo "处理完成。窗口将在 5 秒后自动关闭（或按任意键立即关闭）..."
read -t 5 -n 1 -s || true
exit 0
