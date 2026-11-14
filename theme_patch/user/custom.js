/**
 * user/custom.js — 用户/对方 Agent 专属前端扩展钩子
 * 在 core/runtime.js 执行完毕后于独立 try/catch 沙箱中调用。
 * 可直接使用入参 `ctx`（或别名 `boot`）：
 *   ctx.version          - 当前补丁版本与哈希
 *   ctx.preset           - 当前激活的色彩预设 ('high-contrast' | 'claude-desktop-purewhite' | 'vintage-deep')
 *   ctx.config           - 当前合并后的 user/config.json 对象
 *   ctx.modules          - 模块启用状态 (含 i18n, metrics, composerWaxSeal, deadlockHealer, zoomShortcuts, customCss, customJs)
 *   ctx.themeVars        - 当前注入的自定义 CSS 变量表
 *   ctx.dict             - 原型安全的当前汉化词典对象
 *   ctx.metrics          - 最近一次会话实时指标数据 (TPS / TTFT / Ctx / Out)
 *   ctx.syncPreset()     - 手动触发预设状态同步
 *   ctx.ensureMetricsPill(true) - 手动刷新实时指标胶囊布局
 *   ctx.onCleanup(fn)    - 注册热重载/卸载时的清理钩子（避免定时器或 MutationObserver 泄漏）
 *
 * 若此脚本报错，可通过 `node install.mjs verify --safe-mode` 一键绕过排障。
 */
try {
  // 自动清理早期 ~/.antigravity-patch 旧版脚本挂载在 localStorage 实例上的拦截器，恢复原生预设存储
  if (window.__ag_preset_hooked) {
    if (Object.prototype.hasOwnProperty.call(localStorage, 'getItem')) delete localStorage.getItem;
    if (Object.prototype.hasOwnProperty.call(localStorage, 'setItem')) delete localStorage.setItem;
    window.__ag_preset_hooked = false;
    if (typeof ctx?.syncPreset === 'function') ctx.syncPreset();
  }
} catch (_) {}

// === AG_TOKEN_MONITOR_START ===
// ============================================================================
// Antigravity Token Monitor 应用内内置浏览器一键直达 (http://127.0.0.1:18923/)
// ============================================================================
try {
  (() => {
    const TOKEN_MONITOR_URL = 'http://127.0.0.1:18923/';
    const BTN_ID = 'ag-token-monitor-btn';
    const MODAL_ID = 'ag-token-monitor-modal';
    const FRAME_ID = 'ag-token-monitor-frame';

    let disposed = false;
    let rafId = 0;
    let obs = null;
    let pollTimer = null;
    let dclHandler = null;
    let escHandler = null;

    function findBrowserPaneApi() {
      const candidates = [
        document.querySelector('[data-testid="overview-panel"]'),
        document.querySelector('[data-testid="toggle-aux-sidebar"]'),
        document.querySelector('[data-testid="open-editor-single"]'),
        document.body ? document.body.firstElementChild : null,
      ];

      for (let i = 0; i < candidates.length; i += 1) {
        const el = candidates[i];
        if (!el) continue;
        const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        if (!fiberKey) continue;
        let cur = el[fiberKey];
        for (let depth = 0; cur && depth < 120; depth += 1, cur = cur.return) {
          const val = cur.memoizedProps && cur.memoizedProps.value;
          if (val && typeof val.openUrlInBrowserPane === 'function') {
            return val;
          }
        }
      }
      return null;
    }

    function openInBuiltinBrowserPane(url = TOKEN_MONITOR_URL) {
      try {
        const api = findBrowserPaneApi();
        if (!api || api.isBrowserPaneAvailable === false) return false;

        let treeId;
        if (typeof api.getTargetTreeId === 'function') {
          try {
            treeId = api.getTargetTreeId() || undefined;
          } catch (_) {}
        }
        if (!treeId) {
          const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
          if (m) {
            treeId = { kind: 'cascadeId', cascadeId: m[1] };
          }
        }

        const ret = treeId !== undefined
          ? api.openUrlInBrowserPane(url, treeId)
          : api.openUrlInBrowserPane(url);
        if (ret === false) return false;
        if (ret && typeof ret.catch === 'function') {
          ret.catch(() => {});
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function openExternalUrl(url = TOKEN_MONITOR_URL) {
      try {
        if (window.electronNative && typeof window.electronNative.openExternal === 'function') {
          window.electronNative.openExternal(url);
          return true;
        }
      } catch (_) {}
      try {
        window.open(url, '_blank', 'noopener');
        return true;
      } catch (_) {}
      return false;
    }

    function closeTokenMonitorModal() {
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.removeAttribute('data-open');
      }
    }

    function ensureTokenMonitorModal(url = TOKEN_MONITOR_URL) {
      if (!document.body) return null;
      let modal = document.getElementById(MODAL_ID);
      if (!modal) {
        modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.setAttribute('translate', 'no');
        modal.className = 'notranslate';
        modal.innerHTML =
          '<div class="ag-tm-modal-card">' +
            '<div class="ag-tm-modal-bar">' +
              '<span class="ag-tm-modal-title">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-4 3 3 5-6"/></svg>' +
                '<span>Antigravity Token &amp; API 实时监控</span>' +
              '</span>' +
              '<div class="ag-tm-modal-actions">' +
                '<button type="button" class="ag-tm-modal-action" data-ag-tm-act="side">侧栏内置浏览器打开</button>' +
                '<button type="button" class="ag-tm-modal-action" data-ag-tm-act="ext">系统浏览器打开</button>' +
                '<button type="button" class="ag-tm-modal-action" data-ag-tm-act="reload">刷新</button>' +
                '<button type="button" class="ag-tm-modal-action close" data-ag-tm-act="close">关闭</button>' +
              '</div>' +
            '</div>' +
            '<iframe id="' + FRAME_ID + '" title="Antigravity Token Monitor"></iframe>' +
          '</div>';

        modal.addEventListener('click', (ev) => {
          if (ev.target === modal) {
            closeTokenMonitorModal();
            return;
          }
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-ag-tm-act]') : null;
          if (!btn) return;
          const act = btn.getAttribute('data-ag-tm-act');
          const frame = document.getElementById(FRAME_ID);
          if (act === 'close') {
            closeTokenMonitorModal();
          } else if (act === 'reload' && frame) {
            frame.src = url;
          } else if (act === 'ext') {
            openExternalUrl(url);
          } else if (act === 'side') {
            if (openInBuiltinBrowserPane(url)) {
              closeTokenMonitorModal();
            }
          }
        });

        document.body.appendChild(modal);
      }

      const frame = document.getElementById(FRAME_ID);
      if (frame && (!frame.getAttribute('src') || frame.getAttribute('src') !== url)) {
        frame.setAttribute('src', url);
      }
      return modal;
    }

    function openTokenMonitorModal(url = TOKEN_MONITOR_URL) {
      const modal = ensureTokenMonitorModal(url);
      if (!modal) {
        openExternalUrl(url);
        return;
      }
      modal.setAttribute('data-open', '1');
    }

    function handleTokenMonitorTrigger(e) {
      if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');

      if (e && (e.ctrlKey || e.metaKey)) {
        openExternalUrl(TOKEN_MONITOR_URL);
        return;
      }
      if (e && e.shiftKey) {
        openTokenMonitorModal(TOKEN_MONITOR_URL);
        return;
      }
      if (!openInBuiltinBrowserPane(TOKEN_MONITOR_URL)) {
        openTokenMonitorModal(TOKEN_MONITOR_URL);
      }
    }

    function bindMetricsPillClick() {
      const pill = document.getElementById('ag-live-metrics-pill');
      if (!pill) return;
      if (pill.getAttribute('data-ag-tm-bound') !== '1') {
        pill.setAttribute('data-ag-tm-bound', '1');
        pill.setAttribute(
          'title',
          '点击在内置浏览器中打开 Token 监控看板（Shift+点击：全屏弹窗 ｜ Ctrl+点击：系统浏览器）'
        );
        pill.addEventListener('click', handleTokenMonitorTrigger);
        pill.addEventListener('mouseenter', () => {
          setTimeout(() => {
            const tt = document.getElementById('ag-live-metrics-tooltip');
            if (!tt || !tt.innerHTML || tt.querySelector('.ag-tm-tip-hint')) return;
            const hint = document.createElement('div');
            hint.className = 'ag-tm-tip-hint notranslate';
            hint.setAttribute('translate', 'no');
            hint.textContent = '点击指标胶囊：内置浏览器打开 Token 监控完整看板';
            tt.appendChild(hint);
          }, 0);
        });
      }
    }

    function ensureTokenMonitorButton() {
      if (disposed || !document.body) return;
      bindMetricsPillClick();

      const anchor =
        document.querySelector('[data-testid="open-editor-single"]') ||
        document.querySelector('[data-testid="toggle-aux-sidebar"]');

      if (!anchor || !anchor.parentElement) return;
      const parent = anchor.parentElement;

      let btn = document.getElementById(BTN_ID);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.setAttribute('translate', 'no');
        btn.className = 'notranslate agy-button agy-button-sm';
        btn.title = '在内置浏览器打开 Token 监控看板（Shift+点击：全屏浮层 ｜ Ctrl+点击：系统浏览器）';
        btn.setAttribute('aria-label', '在内置浏览器打开 Token 监控看板');
        btn.innerHTML =
          '<svg class="ag-tm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M3 3v18h18"/>' +
            '<path d="M7 15l4-4 3 3 5-6"/>' +
          '</svg>' +
          '<span class="ag-tm-label">Token 监控</span>';
        btn.addEventListener('click', handleTokenMonitorTrigger);
      }

      if (btn.parentElement !== parent || btn.nextElementSibling !== anchor) {
        parent.insertBefore(btn, anchor);
      }
    }

    function scheduleEnsure() {
      if (disposed || rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        ensureTokenMonitorButton();
      });
    }

    function initUiIntegration() {
      if (disposed || !document.body) return;
      ensureTokenMonitorButton();

      if (typeof MutationObserver !== 'undefined' && !obs) {
        obs = new MutationObserver(() => {
          scheduleEnsure();
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }

      if (!pollTimer) {
        pollTimer = setInterval(ensureTokenMonitorButton, 1800);
      }

      if (!escHandler) {
        escHandler = (ev) => {
          if (ev.key === 'Escape') closeTokenMonitorModal();
        };
        window.addEventListener('keydown', escHandler);
      }
    }

    if (document.body) {
      initUiIntegration();
    } else {
      dclHandler = () => {
        dclHandler = null;
        initUiIntegration();
      };
      window.addEventListener('DOMContentLoaded', dclHandler, { once: true });
    }

    if (typeof ctx?.onCleanup === 'function') {
      ctx.onCleanup(() => {
        disposed = true;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (obs) {
          try { obs.disconnect(); } catch (_) {}
          obs = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (dclHandler) {
          window.removeEventListener('DOMContentLoaded', dclHandler);
          dclHandler = null;
        }
        if (escHandler) {
          window.removeEventListener('keydown', escHandler);
          escHandler = null;
        }
        const btn = document.getElementById(BTN_ID);
        if (btn) btn.remove();
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.remove();
      });
    }
  })();
} catch (err) {
  console.error('[Antigravity Patch] Token Monitor UI init error:', err);
}
// === AG_TOKEN_MONITOR_END ===
