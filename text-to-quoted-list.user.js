// ==UserScript==
// @name         text-to-quoted-list
// @namespace    https://local.codebuddy/text-to-quoted-list
// @version      0.3.4
// @description  将以逗号/分号/空格/换行/Tab 分隔的文本转换为带引号列表（单引号/双引号），支持一键复制。
// @author       haoyunzheng
// @match        *://*/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/dontloseyourway/text-to-quoted-list/main/text-to-quoted-list.user.js
// @downloadURL  https://raw.githubusercontent.com/dontloseyourway/text-to-quoted-list/main/text-to-quoted-list.user.js
// ==/UserScript==

(() => {
  'use strict';

  // 只在顶层窗口运行，避免 iframe 中重复创建 Logo
  if (window !== window.top) return;

  /**
   * 设计目标：尽量不影响页面样式/事件。
   * - 使用 Shadow DOM 隔离样式
   * - z-index 拉满
   * - 默认只显示小 Logo，点击展开面板
   * - 监听复制事件，检测到分隔符文本时自动弹出并填充
   */

  const APP = {
    storageKeys: {
      input: 'ttql:lastInput',
      collapsed: 'ttql:collapsed',
      lastActiveTab: 'ttql:lastActiveTab',
      logoY: 'ttql:logoY',
    },
    ids: {
      host: 'ttql-host',
    },
  };

  function isPromiseLike(v) {
    return !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
  }

  async function gmGet(key, fallback) {
    try {
      // Tampermonkey: sync; GM4: may return Promise
      const v = typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
      return isPromiseLike(v) ? await v : v;
    } catch {
      return fallback;
    }
  }

  async function gmSet(key, value) {
    try {
      const r = typeof GM_setValue === 'function' ? GM_setValue(key, value) : undefined;
      if (isPromiseLike(r)) await r;
    } catch {
      // ignore
    }
  }

  function safeTrim(s) {
    return (s ?? '').toString().trim();
  }

  // 支持：换行/空格/Tab/逗号/分号（含中文逗号/分号）
  const SPLIT_RE = /[\s,;，；]+/g;

  function parseTokens(input) {
    return safeTrim(input)
      .split(SPLIT_RE)
      .map((s) => safeTrim(s))
      .filter(Boolean);
  }

  // 判断文本是否像"分隔符分隔的列表"（至少2项，且含分隔符）
  // 排除 SQL/代码/自然语言句子等误识别
  function looksLikeSeparatedList(text) {
    const trimmed = safeTrim(text);
    if (!trimmed || trimmed.length > 10000) return false; // 太长不处理

    // 排除常见 SQL 关键字组合
    const sqlRe = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|LIMIT|ORDER\s+BY|GROUP\s+BY|CREATE|DROP|ALTER|INTO|VALUES)\b/i;
    if (sqlRe.test(trimmed)) return false;

    // 排除包含括号对（大概率是代码/函数调用）
    if (/[(){}[\]]/.test(trimmed)) return false;

    // 排除 JSON/对象字面量
    if (/[":{}]/.test(trimmed)) return false;

    // 检查是否包含分隔符
    const hasSeparator = /[\s,;，；]/.test(trimmed);
    if (!hasSeparator) return false;

    // 解析后至少有2项
    const tokens = parseTokens(trimmed);
    if (tokens.length < 2) return false;

    // 要求每个 token 都像"简单值"：字母/数字/下划线/中划线/中文，且不包含连续特殊字符
    const simpleTokenRe = /^[\w\u4e00-\u9fff\-._@#]+$/;
    const allSimple = tokens.every((t) => simpleTokenRe.test(t) && t.length <= 200);
    if (!allSimple) return false;

    // ===== 排除自然语言句子 =====
    // 计算平均 token 长度
    const totalLen = tokens.reduce((sum, t) => sum + t.length, 0);
    const avgLen = totalLen / tokens.length;

    // 启发式 1：如果平均 token 长度 > 4 且 token 中包含大量中文字符，很可能是句子
    // 列表通常是短 ID/编号（如 A001, 12345），平均长度较短
    const chineseCharCount = trimmed.replace(/[^\u4e00-\u9fff]/g, '').length;
    const chineseRatio = chineseCharCount / trimmed.length;

    // 如果中文占比 > 50% 且平均 token 长度 > 3，认为是句子而非列表
    if (chineseRatio > 0.5 && avgLen > 3) return false;

    // 启发式 2：如果存在很长的中文 token（> 6 个字符），很可能是句子片段
    const hasLongChineseToken = tokens.some((t) => {
      const cjkLen = t.replace(/[^\u4e00-\u9fff]/g, '').length;
      return cjkLen > 6;
    });
    if (hasLongChineseToken) return false;

    // 启发式 3：列表的 token 长度应该相对均匀
    // 如果最长 token 是最短 token 的 5 倍以上（且最短 > 0），可能是句子
    const lengths = tokens.map((t) => t.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (minLen > 0 && maxLen / minLen > 5 && tokens.length < 10) return false;

    return true;
  }

  function escapeSqlSingleQuote(s) {
    // SQL：单引号内部用两个单引号表示
    return s.replace(/'/g, "''");
  }

  function escapeDoubleQuoteForCode(s) {
    // 让输出更适用于 JSON/代码字符串
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function formatQuotedList(tokens, quote) {
    if (quote === "'") {
      return tokens.map((t) => `'${escapeSqlSingleQuote(t)}'`).join(',');
    }
    return tokens.map((t) => `"${escapeDoubleQuoteForCode(t)}"`).join(',');
  }

  function createEl(doc, tag, attrs = {}, children = []) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
    for (const child of children) {
      if (child == null) continue;
      el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return el;
  }

  async function copyToClipboard(text) {
    const value = text ?? '';
    // 优先使用 Clipboard API
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // fallback
    }

    // 回退：execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function mount() {
    if (document.getElementById(APP.ids.host)) return;

    const host = document.createElement('div');
    host.id = APP.ids.host;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    // 让未命中本工具 UI 的点击穿透到页面
    host.style.pointerEvents = 'none';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
:host{
  all: initial;
  --ttql-font: -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Helvetica,Arial,sans-serif;
  --ttql-bg: rgba(17, 24, 39, 0.72);
  --ttql-bg2: rgba(11, 18, 32, 0.82);
  --ttql-border: rgba(255,255,255,0.14);
  --ttql-text: rgba(229,231,235,0.96);
  --ttql-subtext: rgba(229,231,235,0.70);
  --ttql-shadow: 0 18px 50px rgba(0,0,0,0.45);
  --ttql-primary1: #4F46E5;
  --ttql-primary2: #7C3AED;
  --ttql-accent: #06B6D4;
  --ttql-good: #22C55E;
  --ttql-warn: #F59E0B;
  --ttql-bad: #EF4444;
}
*{box-sizing:border-box}


.wrap{
  font-family: var(--ttql-font);
  width: min(420px, calc(100vw - 32px));
  color: var(--ttql-text);
  border: 1px solid var(--ttql-border);
  border-radius: 14px;
  background: linear-gradient(180deg, var(--ttql-bg), var(--ttql-bg2));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--ttql-shadow);
  overflow: hidden;
  transform: translateZ(0);
}

.header{
  display:flex;align-items:center;justify-content:space-between;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
}

.title{
  display:flex;flex-direction:column;gap:2px;
}

.titleRow{display:flex;align-items:center;gap:8px;}

.badge{
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
}

.h1{font-size: 13px; font-weight: 650; letter-spacing: 0.2px;}
.sub{font-size: 11px; color: var(--ttql-subtext)}

.iconBtn{
  appearance:none;border:1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--ttql-text);
  border-radius: 10px;
  padding: 6px 8px;
  font-size: 12px;
  cursor:pointer;
  transition: transform .12s ease, background .12s ease, border-color .12s ease;
}
.iconBtn:hover{background: rgba(255,255,255,0.10); transform: translateY(-1px)}
.iconBtn:active{transform: translateY(0)}

.body{padding: 10px 12px 12px 12px; display:flex; flex-direction:column; gap:10px;}

.ta{
  width: 100%;
  min-height: 86px;
  resize: vertical;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--ttql-text);
  font-size: 12px;
  line-height: 1.45;
  outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.ta:focus{border-color: rgba(99,102,241,0.55); box-shadow: 0 0 0 4px rgba(99,102,241,0.18)}

.row{display:flex; gap:8px; flex-wrap: wrap;}

.btn{
  appearance:none; border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--ttql-text);
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  transition: transform .12s ease, background .12s ease, border-color .12s ease, filter .12s ease;
}
.btn:hover{background: rgba(255,255,255,0.10); transform: translateY(-1px)}
.btn:active{transform: translateY(0)}

.btnPrimary{
  border: none;
  background: linear-gradient(90deg, var(--ttql-primary1), var(--ttql-primary2), var(--ttql-accent));
  filter: saturate(1.05);
}
.btnPrimary:hover{filter: saturate(1.12) brightness(1.02)}

.btnSub{background: rgba(255,255,255,0.06)}

.section{
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  overflow:hidden;
}

.sectionHd{
  display:flex;align-items:center;justify-content:space-between;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
}

.sectionTitle{font-size: 12px; font-weight: 650;}
.sectionMeta{font-size: 11px; color: var(--ttql-subtext);}

.outTa{min-height: 66px; resize: vertical;}

.toast{
  position: fixed;
  right: 16px;
  bottom: 16px;
  transform: translateY(12px);
  opacity: 0;
  pointer-events: none;
  transition: opacity .16s ease, transform .16s ease;
}
.toastInner{
  font-family: var(--ttql-font);
  font-size: 12px;
  color: rgba(255,255,255,0.92);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(17, 24, 39, 0.78);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 50px rgba(0,0,0,0.45);
}
.toastShow{opacity: 1; transform: translateY(0)}

.collapsed .body{display:none;}

.smallHint{font-size: 11px; color: var(--ttql-subtext); line-height: 1.4}
.linkBtn{
  border: none;
  background: transparent;
  color: rgba(165, 180, 252, 0.92);
  cursor: pointer;
  padding: 0;
  font-size: 11px;
}
.linkBtn:hover{text-decoration: underline}

.logo{
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.18);
  background: linear-gradient(135deg, var(--ttql-primary1), var(--ttql-primary2));
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  color: #fff;
  transition: box-shadow .15s ease;
  user-select: none;
  touch-action: none;
}
.logo:hover{
  box-shadow: 0 6px 20px rgba(0,0,0,0.45);
}
.logo.dragging{
  cursor: grabbing;
  box-shadow: 0 8px 28px rgba(0,0,0,0.55);
}

.logo .logoIcon{
  font-size: 16px;
  line-height: 1;
}

.wrap{
  pointer-events: auto;
  position: fixed;
  left: 0;
  top: 0;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity .14s ease, transform .14s ease;
}
.wrap.show{
  opacity: 1;
  transform: translateY(0);
}

.logo{pointer-events: auto}

`; 

    const doc = document;

    // 外层容器：作为 Shadow DOM 内的层级容器（Logo 常显，面板为 Popover 浮层）
    const container = createEl(doc, 'div', { class: 'ttql-layer' });

    // Logo 按钮
    const logo = createEl(doc, 'div', { class: 'logo', title: '点击打开文本转引号列表工具' }, [
      createEl(doc, 'span', { class: 'logoIcon' }, ['{ }'])
    ]);

    const root = createEl(doc, 'div', { class: 'wrap', style: 'display:none; visibility:hidden;' });

    const state = {
      collapsed: false,
      panelVisible: false,
      tokens: [],
      outSingle: '',
      outDouble: '',
      toastTimer: null,
      logoY: 16, // Logo 距离底部的距离
      isDragging: false,
      dragStartY: 0,
      dragStartLogoY: 0,
    };

    const toast = createEl(doc, 'div', { class: 'toast' }, [
      createEl(doc, 'div', { class: 'toastInner' }, ['']),
    ]);

    function showToast(msg) {
      const inner = toast.querySelector('.toastInner');
      inner.textContent = msg;
      toast.classList.add('toastShow');
      if (state.toastTimer) clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => toast.classList.remove('toastShow'), 1800);
    }

    const btnCollapse = createEl(doc, 'button', { class: 'iconBtn', type: 'button', title: '收起/展开' }, ['▾']);
    const btnHide = createEl(doc, 'button', { class: 'iconBtn', type: 'button', title: '隐藏（刷新页面可恢复）' }, ['✕']);

    const header = createEl(doc, 'div', { class: 'header' }, [
      createEl(doc, 'div', { class: 'title' }, [
        createEl(doc, 'div', { class: 'titleRow' }, [
          createEl(doc, 'div', { class: 'h1' }, ['Text → Quoted List']),
          createEl(doc, 'div', { class: 'badge' }, ['ttql']),
        ]),
        createEl(doc, 'div', { class: 'sub' }, ['分隔符：空格 / 换行 / Tab / , / ;（支持混合）']),
      ]),
      createEl(doc, 'div', { class: 'row' }, [btnCollapse, btnHide]),
    ]);

    const inputTa = createEl(doc, 'textarea', {
      class: 'ta',
      placeholder: '把你的文本粘贴到这里，例如：A001, A002; A003\nA004',
    });

    const btnConvert = createEl(doc, 'button', { class: 'btn btnPrimary', type: 'button' }, ['转换']);
    const btnClear = createEl(doc, 'button', { class: 'btn btnSub', type: 'button' }, ['清空']);
    const btnSample = createEl(doc, 'button', { class: 'btn btnSub', type: 'button' }, ['示例']);
    const btnFromSelection = createEl(doc, 'button', { class: 'btn btnSub', type: 'button', title: '从页面选中文本填充' }, ['从选中填充']);

    const hint = createEl(doc, 'div', { class: 'smallHint' }, [
      '默认：去空白项、保留顺序、单引号按 SQL 规则转义为 ',
      createEl(doc, 'code', { style: 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 11px; color: rgba(229,231,235,0.92);' }, ["''"]),
      '。',
    ]);

    const outSingleTa = createEl(doc, 'textarea', { class: 'ta outTa', readonly: true, placeholder: "'值1','值2'" });
    const outDoubleTa = createEl(doc, 'textarea', { class: 'ta outTa', readonly: true, placeholder: '"值1","值2"' });

    const singleCount = createEl(doc, 'span', { class: 'sectionMeta' }, ['0 项']);
    const doubleCount = createEl(doc, 'span', { class: 'sectionMeta' }, ['0 项']);

    const btnCopySingle = createEl(doc, 'button', { class: 'btn btnSub', type: 'button' }, ['复制单引号']);
    const btnCopyDouble = createEl(doc, 'button', { class: 'btn btnSub', type: 'button' }, ['复制双引号']);

    const sectionSingle = createEl(doc, 'div', { class: 'section' }, [
      createEl(doc, 'div', { class: 'sectionHd' }, [
        createEl(doc, 'div', { class: 'sectionTitle' }, ['单引号（SQL）']),
        createEl(doc, 'div', { style: 'display:flex; align-items:center; gap:10px;' }, [singleCount, btnCopySingle]),
      ]),
      createEl(doc, 'div', { style: 'padding: 8px 10px 10px 10px;' }, [outSingleTa]),
    ]);

    const sectionDouble = createEl(doc, 'div', { class: 'section' }, [
      createEl(doc, 'div', { class: 'sectionHd' }, [
        createEl(doc, 'div', { class: 'sectionTitle' }, ['双引号（JSON/代码）']),
        createEl(doc, 'div', { style: 'display:flex; align-items:center; gap:10px;' }, [doubleCount, btnCopyDouble]),
      ]),
      createEl(doc, 'div', { style: 'padding: 8px 10px 10px 10px;' }, [outDoubleTa]),
    ]);

    const body = createEl(doc, 'div', { class: 'body' }, [
      inputTa,
      createEl(doc, 'div', { class: 'row' }, [btnConvert, btnFromSelection, btnClear, btnSample]),
      hint,
      sectionSingle,
      sectionDouble,
      createEl(doc, 'div', { class: 'smallHint' }, [
        '小技巧：你可以直接复制 “1,2,3” 或者一列 ID；脚本会自动识别分隔符并输出。',
      ]),
    ]);

    root.appendChild(header);
    root.appendChild(body);

    function setCollapsed(collapsed) {
      state.collapsed = !!collapsed;
      root.classList.toggle('collapsed', state.collapsed);
      btnCollapse.textContent = state.collapsed ? '▸' : '▾';
      gmSet(APP.storageKeys.collapsed, state.collapsed);
    }

    function updatePopoverPosition() {
      if (!state.panelVisible) return;

      const margin = 8;
      const gap = 10;

      // 先确保能测量到面板尺寸
      const prevDisplay = root.style.display;
      const prevVisibility = root.style.visibility;
      root.style.display = 'block';
      root.style.visibility = 'hidden';

      const logoRect = logo.getBoundingClientRect();
      const popRect = root.getBoundingClientRect();

      // 目标：Logo 左侧居中
      let left = logoRect.left - gap - popRect.width;
      let top = logoRect.top + logoRect.height / 2 - popRect.height / 2;

      // 垂直方向先 clamp
      top = Math.max(margin, Math.min(window.innerHeight - popRect.height - margin, top));

      // 水平方向越界则翻到右侧
      if (left < margin) {
        left = logoRect.right + gap;
      }
      left = Math.max(margin, Math.min(window.innerWidth - popRect.width - margin, left));

      root.style.left = Math.round(left) + 'px';
      root.style.top = Math.round(top) + 'px';

      root.style.visibility = prevVisibility || 'visible';
      root.style.display = prevDisplay || 'block';
    }

    function setPanelVisible(visible) {
      state.panelVisible = !!visible;

      if (state.panelVisible) {
        root.style.display = 'block';
        root.style.visibility = 'hidden';
        root.classList.remove('show');

        requestAnimationFrame(() => {
          updatePopoverPosition();
          root.style.visibility = 'visible';
          requestAnimationFrame(() => root.classList.add('show'));
        });
        return;
      }

      root.classList.remove('show');
      // 留一点时间给淡出动画
      setTimeout(() => {
        if (!state.panelVisible) {
          root.style.display = 'none';
          root.style.visibility = 'hidden';
        }
      }, 160);
    }

    function showPanel(textToFill) {
      if (textToFill) {
        inputTa.value = textToFill;
        compute();
      }
      setPanelVisible(true);
    }

    function hidePanel() {
      setPanelVisible(false);
    }

    function compute() {
      const input = inputTa.value ?? '';
      state.tokens = parseTokens(input);
      state.outSingle = formatQuotedList(state.tokens, "'");
      state.outDouble = formatQuotedList(state.tokens, '"');

      outSingleTa.value = state.outSingle;
      outDoubleTa.value = state.outDouble;

      singleCount.textContent = `${state.tokens.length} 项`;
      doubleCount.textContent = `${state.tokens.length} 项`;

      gmSet(APP.storageKeys.input, input);
    }

    btnConvert.addEventListener('click', () => {
      compute();
      if (state.tokens.length === 0) {
        showToast('没有可转换的内容');
      } else {
        showToast(`已转换：${state.tokens.length} 项`);
      }
    });

    btnClear.addEventListener('click', () => {
      inputTa.value = '';
      compute();
      showToast('已清空');
    });

    btnSample.addEventListener('click', () => {
      inputTa.value = 'A001, A002; A003\nA004';
      compute();
      showToast('已填充示例');
    });

    btnFromSelection.addEventListener('click', () => {
      try {
        const sel = window.getSelection?.().toString?.() ?? '';
        if (!safeTrim(sel)) {
          showToast('没有选中文本');
          return;
        }
        inputTa.value = sel;
        compute();
        showToast('已从选中填充');
      } catch {
        showToast('读取选中内容失败');
      }
    });

    // 避免“本工具内部复制”触发自动弹层
    let ignoreAutoPopupUntil = 0;
    let lastCopyGestureAt = 0;

    function markIgnoreAutoPopup(ms = 900) {
      ignoreAutoPopupUntil = Date.now() + ms;
    }

    function shouldIgnoreAutoPopup() {
      return Date.now() < ignoreAutoPopupUntil;
    }

    btnCopySingle.addEventListener('click', async () => {
      markIgnoreAutoPopup();
      compute();
      if (!state.outSingle) {
        showToast('单引号结果为空');
        return;
      }
      const ok = await copyToClipboard(state.outSingle);
      showToast(ok ? '已复制（单引号）' : '复制失败（单引号）');
    });

    btnCopyDouble.addEventListener('click', async () => {
      markIgnoreAutoPopup();
      compute();
      if (!state.outDouble) {
        showToast('双引号结果为空');
        return;
      }
      const ok = await copyToClipboard(state.outDouble);
      showToast(ok ? '已复制（双引号）' : '复制失败（双引号）');
    });

    btnCollapse.addEventListener('click', () => setCollapsed(!state.collapsed));

    btnHide.addEventListener('click', () => {
      hidePanel();
    });

    // Logo 点击展开面板（只有在非拖拽时触发）
    logo.addEventListener('click', (e) => {
      // 如果刚刚拖拽过，不触发点击
      if (logo.dataset.justDragged === 'true') {
        logo.dataset.justDragged = 'false';
        return;
      }
      showPanel();
    });

    // Logo 拖拽功能
    function setLogoY(y) {
      const maxY = window.innerHeight - 60;
      const minY = 16;
      state.logoY = Math.max(minY, Math.min(maxY, y));
      logo.style.bottom = state.logoY + 'px';
      gmSet(APP.storageKeys.logoY, state.logoY);
    }

    function onDragStart(e) {
      // 拖拽时自动收起浮层，避免遮挡与误触
      hidePanel();

      state.isDragging = true;
      state.dragStartY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      state.dragStartLogoY = state.logoY;
      logo.classList.add('dragging');
      e.preventDefault();
    }

    function onDragMove(e) {
      if (!state.isDragging) return;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      const deltaY = state.dragStartY - clientY;
      setLogoY(state.dragStartLogoY + deltaY);
    }

    function onDragEnd() {
      if (state.isDragging) {
        state.isDragging = false;
        logo.classList.remove('dragging');
        // 如果移动超过5px，标记为刚拖拽过，阻止 click
        if (Math.abs(state.logoY - state.dragStartLogoY) > 5) {
          logo.dataset.justDragged = 'true';
        }
      }
    }

    logo.addEventListener('mousedown', onDragStart);
    logo.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);

    // 支持 Ctrl/Cmd + Enter 快速转换
    inputTa.addEventListener('keydown', (e) => {
      const isEnter = e.key === 'Enter';
      const hot = isEnter && (e.ctrlKey || e.metaKey);
      if (hot) {
        e.preventDefault();
        compute();
        showToast(`已转换：${state.tokens.length} 项`);
      }
    });

    shadow.appendChild(style);
    container.appendChild(logo);
    container.appendChild(root);
    shadow.appendChild(container);
    shadow.appendChild(toast);

    document.documentElement.appendChild(host);

    function tryAutoPopupFromText(text) {
      if (shouldIgnoreAutoPopup()) return;

      const trimmed = safeTrim(text);
      if (!trimmed) return;

      if (looksLikeSeparatedList(trimmed)) {
        // 避免 copy/keydown 双通道重复触发
        markIgnoreAutoPopup(400);
        showPanel(trimmed);
        showToast('检测到列表文本，已自动填充');
      }
    }

    function getSelectionText() {
      try {
        return window.getSelection?.()?.toString?.() ?? '';
      } catch {
        return '';
      }
    }

    function getActiveInputSelectionText() {
      try {
        const el = document.activeElement;
        if (!el) return '';
        const tag = (el.tagName || '').toUpperCase();
        if (tag !== 'TEXTAREA' && tag !== 'INPUT') return '';
        const value = el.value;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (typeof value !== 'string' || typeof start !== 'number' || typeof end !== 'number') return '';
        if (end <= start) return '';
        return value.slice(start, end);
      } catch {
        return '';
      }
    }

    // 监听复制事件：capture 提升拿到事件概率；优先读 clipboardData，回退到 selection
    document.addEventListener(
      'copy',
      (e) => {
        try {
          const path = e.composedPath?.() ?? [];
          // 工具内部复制（输入框/输出框）不触发自动弹层
          if (path.includes(root) || path.includes(logo)) return;

          let text = '';
          try {
            text = e.clipboardData?.getData?.('text/plain') ?? '';
          } catch {
            // ignore
          }
          if (!safeTrim(text)) text = getSelectionText();
          if (!safeTrim(text)) text = getActiveInputSelectionText();

          // 稍微延迟，避免影响页面 copy handler
          setTimeout(() => {
            tryAutoPopupFromText(text);
          }, 30);
        } catch {
          // 静默忽略
        }
      },
      true
    );

    // 某些表格组件没有原生 selection，但复制结果会进入剪贴板：用 Cmd/Ctrl+C 作为回退信号
    document.addEventListener(
      'keydown',
      (e) => {
        try {
          const key = (e.key || '').toLowerCase();
          const isCopy = key === 'c' && (e.metaKey || e.ctrlKey);
          if (!isCopy) return;

          const path = e.composedPath?.() ?? [];
          if (path.includes(root) || path.includes(logo)) return;

          lastCopyGestureAt = Date.now();

          setTimeout(async () => {
            // 只在最近一次复制手势窗口内尝试读取
            if (Date.now() - lastCopyGestureAt > 800) return;
            if (shouldIgnoreAutoPopup()) return;

            try {
              if (navigator.clipboard && window.isSecureContext) {
                const text = await navigator.clipboard.readText();
                tryAutoPopupFromText(text);
              }
            } catch {
              // 可能因为权限/策略失败，忽略
            }
          }, 120);
        } catch {
          // 静默忽略
        }
      },
      true
    );

    // 点击页面空白处自动隐藏（Shadow DOM 使用 composedPath 判断）
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!state.panelVisible) return;
        const path = e.composedPath?.() ?? [];
        if (path.includes(root) || path.includes(logo)) return;
        hidePanel();
      },
      true
    );

    // Esc 快捷收起
    document.addEventListener(
      'keydown',
      (e) => {
        if (!state.panelVisible) return;
        if (e.key === 'Escape') {
          e.stopPropagation();
          hidePanel();
        }
      },
      true
    );

    window.addEventListener('resize', () => {
      // 视口变化：clamp Logo 位置 + 重算 Popover
      setLogoY(state.logoY);
      if (state.panelVisible) updatePopoverPosition();
    });

    // 初始化：恢复状态（但默认不显示面板）
    (async () => {
      const lastInput = await gmGet(APP.storageKeys.input, '');
      const collapsed = await gmGet(APP.storageKeys.collapsed, false);
      const savedLogoY = await gmGet(APP.storageKeys.logoY, 16);
      if (lastInput) inputTa.value = String(lastInput);
      compute();
      setCollapsed(!!collapsed);
      // 恢复 Logo 位置
      setLogoY(Number(savedLogoY) || 16);
      // 默认隐藏面板，只显示 Logo
      setPanelVisible(false);
    })();
  }

  // 一些页面在 document-end 时 body 仍未就绪，这里兜底等一下。
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mount();
  } else {
    window.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
