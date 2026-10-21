import { app } from "../../scripts/app.js";

const NODE_NAME = "SketchpadNode";

function installPad(node) {
  // 移除 sketch_data 自动生成的文本框，避免与画板重复
  if (Array.isArray(node.widgets)) {
    const i = node.widgets.findIndex((w) => w.name === "sketch_data");
    if (i >= 0) node.widgets.splice(i, 1);
  }

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "width:100%;box-sizing:border-box;padding:4px;color:#ccc;font-size:12px;user-select:none;";

  wrap.innerHTML = `
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
      <button data-act="brush"  title="画笔" style="cursor:pointer;padding:3px 8px;">✏️ 画笔</button>
      <button data-act="eraser" title="擦除" style="cursor:pointer;padding:3px 8px;">🧽 擦除</button>
      <button data-act="pressure" title="画笔压力感应：开启后用数位笔/触控笔的轻重控制粗细（仅笔有效，鼠标不受影响）；关闭则始终用滑块固定粗细" style="cursor:pointer;padding:3px 8px;">💧 压感</button>
      <button data-act="line" title="直线模式：按住拖拽画出从起点到当前点的直线（实时预览），适合画直边、边框" style="cursor:pointer;padding:3px 8px;">📏 直线</button>
      <button data-act="autocircle" title="智能修形：随手圈一个闭合的圈，松手自动平滑——完全自动，无需区分圆/椭圆：画得圆自然修成圆，鸡蛋保留鸡蛋轮廓，只抹平手绘抖动；不像闭合环则原样保留" style="cursor:pointer;padding:3px 8px;">🔄 修形</button>
      <input type="color" class="color" value="#000000" title="画笔颜色"
             style="width:28px;height:26px;padding:0;border:1px solid #555;background:none;border-radius:4px;">
      <button data-act="undo" title="后退一步（最多 10 步）" style="cursor:pointer;padding:3px 8px;">↶ 后退</button>
      <button data-act="sync" title="读取分辨率选择器参数并适配画板（无需运行工作流）" style="cursor:pointer;padding:3px 8px;">⟳ 同步尺寸</button>
      <button data-act="pop" title="将画板弹出为独立窗口（可拖拽移动、缩放到超出节点）" style="cursor:pointer;padding:3px 8px;">⧉ 弹出</button>
      <span class="zoom" title="滚轮缩放画布视图（仅显示缩放，不改出图尺寸；按住空格拖动可平移）" style="margin-left:6px;font-size:11px;color:#9bd;white-space:nowrap;">100%</span>
      <button data-act="clear" title="清空画布" style="cursor:pointer;padding:3px 8px;margin-left:auto;">🗑 清空</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
      <span style="white-space:nowrap;">画笔 <b class="bs" style="display:inline-block;width:24px;">8</b></span>
      <input type="range" class="br" min="1" max="120" value="8" style="flex:1;">
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <span style="white-space:nowrap;">擦除 <b class="es" style="display:inline-block;width:24px;">30</b></span>
      <input type="range" class="er" min="4" max="200" value="30" style="flex:1;">
    </div>
    <div class="padwrap" style="position:relative;margin-top:6px;height:380px;
         display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <canvas class="pad" style="display:block;max-width:100%;max-height:100%;width:auto;height:auto;
              border:1px solid #444;background:#fff;touch-action:none;cursor:none;border-radius:4px;"></canvas>
    </div>
  `;

  const canvas = wrap.querySelector(".pad");
  const padWrap = wrap.querySelector(".padwrap");
  const colorInput = wrap.querySelector(".color");
  const brushRange = wrap.querySelector(".br");
  const eraserRange = wrap.querySelector(".er");
  const bsLabel = wrap.querySelector(".bs");
  const esLabel = wrap.querySelector(".es");
  const ctx = canvas.getContext("2d");

  // 笔刷/橡皮大小预览：用一张覆盖画布，与画板共用同一坐标系。
  // 前端会对节点做 CSS 缩放，若用 DOM div 按屏幕像素定位会与实际落笔点错位。
  const overlay = document.createElement("canvas");
  // 与画布同一套 max 约束 + 绝对定位 auto margin 居中：
  // 两张画布内在比例相同 → 显示矩形永远重合（含 letterbox 情况）。
  overlay.style.cssText =
    "position:absolute;left:0;right:0;top:0;bottom:0;margin:auto;" +
    "max-width:100%;max-height:100%;width:auto;height:auto;pointer-events:none;z-index:20;";
  padWrap.appendChild(overlay);
  const octx = overlay.getContext("2d");

  // ── 画布视图缩放 / 平移（仅影响显示，不改变出图尺寸）──
  // 滚轮缩放；按住空格 + 左键拖动，或中键拖动 = 平移视图。
  let viewZoom = 1, panX = 0, panY = 0, spaceHeld = false, panning = false, panStart = null;
  const zoomLabel = wrap.querySelector(".zoom");
  function applyTransform() {
    const t = `translate(${panX}px, ${panY}px) scale(${viewZoom})`;
    canvas.style.transformOrigin = "center center";
    overlay.style.transformOrigin = "center center";
    canvas.style.transform = t;
    overlay.style.transform = t;
    if (zoomLabel) zoomLabel.textContent = Math.round(viewZoom * 100) + "%";
  }
  applyTransform();
  padWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    viewZoom = Math.max(0.3, Math.min(8, viewZoom * factor));
    applyTransform();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
      spaceHeld = true;
      e.preventDefault();
      if (!panning) canvas.style.cursor = "grab";
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceHeld = false;
      if (!panning) canvas.style.cursor = "none";
    }
  });
  // Ctrl/Cmd + Z：仅当指针/焦点在画板区域内时接管为「画板撤销」，
  // 并阻止冒泡，避免与 ComfyUI 画布自身的撤销（图节点操作）冲突
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      if (padHover || (document.activeElement && wrap.contains(document.activeElement))) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      }
    }
  });

  let lastPos = null; // 画布坐标系下的鼠标位置
  function cursorSize() {
    return mode === "eraser" ? +eraserRange.value : +brushRange.value;
  }
  function refreshCursor() {
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    } else {
      octx.clearRect(0, 0, overlay.width, overlay.height);
    }
    if (!lastPos) return;
    octx.beginPath();
    octx.arc(lastPos.x, lastPos.y, Math.max(1.5, cursorSize() / 2), 0, Math.PI * 2);
    octx.strokeStyle = "rgba(0,0,0,.65)";
    octx.lineWidth = 1.5;
    octx.stroke();
    octx.beginPath();
    octx.arc(lastPos.x, lastPos.y, 1.5, 0, Math.PI * 2);
    octx.fillStyle = "rgba(0,0,0,.7)";
    octx.fill();
  }

  let mode = "brush";
  let drawing = false;
  let last = null;
  let lastMid = null;     // 平滑曲线用：上一段的中点
  let lineStart = null;   // 直线模式起点
  let strokeBase = null;  // 直线模式起笔前的画布快照（用于实时预览重绘）
  let pressureOn = false; // 画笔压力感应开关
  let padHover = false;   // 指针是否在画板区域内（用于 Ctrl+Z 判定）
  let strokePts = [];     // 圆修模式记录的手绘点
  let lastWidth = 1;      // 当前笔触宽度（用于圆修重绘）

  function setMode(m) {
    mode = m;
    // 只管理「模式」按钮（画笔/擦除/直线/圆修），不触碰压感等独立开关，
    // 否则切换模式会把它们的选中高亮清掉。
    for (const b of wrap.querySelectorAll("button[data-act]")) {
      if (b.dataset.act === "brush" || b.dataset.act === "eraser" || b.dataset.act === "line" || b.dataset.act === "autocircle") {
        const active = b.dataset.act === m;
        b.style.background = active ? "#4a6ea9" : "";
        b.style.color = active ? "#fff" : "";
        b.style.borderColor = active ? "#6f8fc4" : "#555";
      }
    }
  }

  function update() {
    try {
      domWidget.value = canvas.toDataURL("image/png");
    } catch (e) {
      /* ignore */
    }
  }

  let lastPush = 0;
  function pushThrottled() {
    const now = Date.now();
    if (now - lastPush > 250) {
      lastPush = now;
      update();
    }
  }

  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  }

  // 实际线宽：开启压感且为数位笔时，按笔压在滑块基准上下浮动；其余情况用滑块固定值
  function effWidth(e) {
    const base = mode === "eraser" ? +eraserRange.value : +brushRange.value;
    if (!pressureOn || !e || e.pointerType !== "pen") return base;
    const p = (typeof e.pressure === "number" && e.pressure > 0) ? e.pressure : 0.5;
    // 0.5 ≈ 基准粗细；轻压更细、重压更粗
    return Math.max(0.5, base * (0.25 + 1.5 * p));
  }

  function setStrokeStyle() {
    ctx.strokeStyle = mode === "eraser" ? "#ffffff" : colorInput.value;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  // 绘制一段固定粗细的线段（无平滑）
  function strokeTo(p0, p1, w) {
    setStrokeStyle();
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // 在 p 点盖一个圆点：保证落笔起点 / 单击成点，在任意粗细下都有清晰起笔
  function stampDot(p, w) {
    setStrokeStyle();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, w / 2), 0, Math.PI * 2);
    ctx.fill();
  }

  // —— 智能修形：傅里叶轮廓平滑 ——
  // 原理：闭合手绘轮廓视为复数序列 x+iy，做离散傅里叶变换后只保留前 K 阶谐波再重建。
  // 低频谐波承载整体形状（圆就是圆、鸡蛋的不对称轮廓也保留），高频是手绘抖动，直接滤掉。
  // 完全自动：不需要区分"椭圆/正圆"，画什么形状就平滑成什么形状。

  // 首尾缺口占周长比例（判断是否算闭合环）
  function loopGapRatio(pts) {
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      per += Math.hypot(q.x - p.x, q.y - p.y);
    }
    if (!(per > 0)) return 1;
    const gap = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    return gap / per;
  }

  // 按弧长均匀重采样闭合轮廓为 N 个点
  function resampleClosed(raw, N) {
    const n = raw.length;
    if (n < 8) return null;
    const cum = [0];
    for (let i = 1; i <= n; i++) {
      const p = raw[i - 1], q = raw[i % n];
      cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.y - p.y));
    }
    const total = cum[n];
    if (!(total > 0)) return null;
    const out = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const target = (total * k) / N;
      while (j < n - 1 && cum[j + 1] < target) j++;
      const p = raw[j], q = raw[(j + 1) % n];
      const seg = cum[j + 1] - cum[j];
      const t = seg > 0 ? (target - cum[j]) / seg : 0;
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
    return out;
  }

  // 傅里叶平滑：保留前 K 阶谐波，返回 N 个平滑点（自动闭合、保持鸡蛋等整体形状）
  function fourierSmoothClosed(raw, K) {
    const N = 128;
    const s = resampleClosed(raw, N);
    if (!s) return null;
    const Kmax = Math.max(1, Math.min(K, Math.floor(N / 2) - 1));
    // 计算谐波系数 c_m = (1/N) Σ z_n · e^{-i2πmn/N}
    const cs = [];
    for (let m = -Kmax; m <= Kmax; m++) {
      let cx = 0, cy = 0;
      for (let n = 0; n < N; n++) {
        const ang = (-2 * Math.PI * m * n) / N;
        const w = s[n];
        cx += w.x * Math.cos(ang) - w.y * Math.sin(ang);
        cy += w.x * Math.sin(ang) + w.y * Math.cos(ang);
      }
      cs.push({ cx: cx / N, cy: cy / N });
    }
    // 重建平滑轮廓
    const out = [];
    for (let n = 0; n < N; n++) {
      let x = 0, y = 0;
      let i = 0;
      for (let m = -Kmax; m <= Kmax; m++, i++) {
        const ang = (2 * Math.PI * m * n) / N;
        const c = cs[i];
        x += c.cx * Math.cos(ang) - c.cy * Math.sin(ang);
        y += c.cx * Math.sin(ang) + c.cy * Math.cos(ang);
      }
      out.push({ x, y });
    }
    return out;
  }

  function clearAll() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    update();
  }

  // 撤销历史：每画一笔 / 清空一次记一步，最多保留 10 步
  const MAX_HISTORY = 10;
  const history = [];
  function pushHistory() {
    try {
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (history.length > MAX_HISTORY) history.shift();
    } catch (e) {
      /* ignore */
    }
  }
  function undo() {
    if (!history.length) return;
    ctx.putImageData(history.pop(), 0, 0);
    update();
  }

  function loadImage(url, cb) {
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      update();
      if (cb) cb();
    };
    img.src = url;
  }

  function applySize() {
    const wW = node.widgets?.find((w) => w.name === "width");
    const hW = node.widgets?.find((w) => w.name === "height");
    const w = Math.min(4096, Math.max(64, (wW?.value | 0) || 1024));
    const h = Math.min(4096, Math.max(64, (hW?.value | 0) || 1024));
    if (canvas.width === w && canvas.height === h) return;
    const old = document.createElement("canvas");
    old.width = canvas.width || w;
    old.height = canvas.height || h;
    if (canvas.width) old.getContext("2d").drawImage(canvas, 0, 0);
    canvas.width = w;
    canvas.height = h;
    overlay.width = w;
    overlay.height = h;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    if (old.width && old.height) {
      // 等比缩放 + 居中：旧画稿形状不变形，比例不符处留白
      const scale = Math.min(w / old.width, h / old.height);
      const dw = old.width * scale;
      const dh = old.height * scale;
      ctx.drawImage(old, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    update();
  }

  // 事件
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    // 平移模式：中键拖动，或按住空格 + 左键拖动（不触发绘制）
    if (e.button === 1 || (spaceHeld && e.button === 0)) {
      panning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
      canvas.style.cursor = "grabbing";
      return;
    }
    drawing = true;
    pushHistory();
    last = pt(e);
    lastMid = { x: last.x, y: last.y };
    if (mode === "line") {
      // 直线模式：记下起点，先盖起点圆点，再拍一张起笔前快照用于实时重绘预览
      lineStart = last;
      stampDot(last, effWidth(e));
      strokeBase = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else if (mode === "autocircle") {
      // 椭圆修正模式：记录手绘点 + 起笔前快照；松手再决定拟合椭圆或保留原画
      lineStart = last;
      strokePts = [last];
      strokeBase = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      stampDot(last, effWidth(e));
    }
    pushThrottled();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (panning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      applyTransform();
      return;
    }
    if (!drawing) return;
    const p = pt(e);
    const w = effWidth(e);
    if (mode === "line") {
      // 还原到起笔前，再画一条「起点 → 当前点」直线（实时橡皮筋预览）
      if (strokeBase) ctx.putImageData(strokeBase, 0, 0);
      strokeTo(lineStart, p, w);
    } else if (mode === "autocircle") {
      // 随手画，边画边记录点（松手时再拟合），并显示原手绘让用户看见
      strokeTo(last, p, w);
      strokePts.push(p);
      lastWidth = w;
    } else {
      // 手绘平滑：用中点二次曲线拟合，线条天生圆顺（无开关，常开）
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      setStrokeStyle();
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(lastMid.x, lastMid.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.stroke();
      lastMid = mid;
    }
    last = p;
    pushThrottled();
  });
  const stop = () => {
    if (drawing) {
      drawing = false;
      const base = strokeBase;
      strokeBase = null;
      if (mode === "autocircle" && strokePts.length >= 8) {
        const sm = fourierSmoothClosed(strokePts, 6);
        if (sm && loopGapRatio(strokePts) < 0.35) {
          // 闭合环 → 还原到起笔前，画傅里叶平滑轮廓：
          // 圆就是圆、鸡蛋保留鸡蛋形状，只去掉高频手绘抖动（全自动，无需区分）
          if (base) ctx.putImageData(base, 0, 0);
          setStrokeStyle();
          ctx.lineWidth = lastWidth;
          ctx.beginPath();
          ctx.moveTo(sm[0].x, sm[0].y);
          for (let i = 1; i < sm.length; i++) ctx.lineTo(sm[i].x, sm[i].y);
          ctx.closePath();
          ctx.stroke();
        } else {
          // 不像闭合环 → 原样重绘用户手绘，避免误删
          setStrokeStyle();
          ctx.lineWidth = lastWidth;
          ctx.beginPath();
          ctx.moveTo(strokePts[0].x, strokePts[0].y);
          for (let i = 1; i < strokePts.length; i++) ctx.lineTo(strokePts[i].x, strokePts[i].y);
          ctx.stroke();
        }
        strokePts = [];
      }
      update();
    }
    if (panning) {
      panning = false;
      canvas.style.cursor = spaceHeld ? "grab" : "none";
    }
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  // 光标预览跟随：未按下画笔时也实时显示位置与大小（进入显示、离开隐藏）
  canvas.addEventListener("pointerenter", (e) => {
    lastPos = pt(e);
    refreshCursor();
  });
  canvas.addEventListener("pointermove", (e) => {
    lastPos = pt(e);
    refreshCursor();
  });
  canvas.addEventListener("pointerleave", () => {
    lastPos = null;
    refreshCursor();
  });
  // 画板区域（含工具栏+画布）进入/离开：用于 Ctrl+Z 只在画板上生效
  wrap.addEventListener("pointerenter", () => { padHover = true; });
  wrap.addEventListener("pointerleave", () => { padHover = false; });

  for (const b of wrap.querySelectorAll("button[data-act]")) {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "brush") setMode("brush");
      else if (act === "eraser") setMode("eraser");
      else if (act === "line") setMode("line");
      else if (act === "autocircle") setMode("autocircle");
      else if (act === "pressure") {
        pressureOn = !pressureOn;
        b.style.background = pressureOn ? "#4a6ea9" : "";
        b.style.color = pressureOn ? "#fff" : "";
        b.style.borderColor = pressureOn ? "#6f8fc4" : "#555";
      }
      else if (act === "undo") undo();
      else if (act === "pop") { if (floatWin) foldBack(); else popOut(); }
      else if (act === "sync") {
        if (!syncFromSelector()) {
          const old = b.title;
          b.title = "未找到可读的分辨率选择器（确认 width/height 已连到分辨率选择器节点）";
          b.style.background = "#a94a4a";
          setTimeout(() => {
            b.title = old;
            b.style.background = "";
          }, 1800);
        }
      }
      else if (act === "clear") {
        pushHistory();
        clearAll();
      }
      refreshCursor();
    });
  }
  brushRange.addEventListener("input", () => {
    bsLabel.textContent = brushRange.value;
    refreshCursor();
  });
  eraserRange.addEventListener("input", () => {
    esLabel.textContent = eraserRange.value;
    refreshCursor();
  });

  // 前端 1.55.x 起 addDOMWidget 的 value 是 getter/setter：
  // 不传 options.getValue/setValue 时，赋值会被静默丢弃、读取永远为空串。
  // 必须用闭包变量 padValue 真正存住画布数据。
  let padValue = "";
  const domWidget = node.addDOMWidget("sketch_data", "wb_sketchpad", wrap, {
    getValue: () => padValue,
    setValue: (v) => {
      padValue = typeof v === "string" ? v : "";
    },
  });
  domWidget.serializeValue = () => padValue;

  // ── 同步尺寸：顺着 width/height 输入线找到「分辨率选择器」，在前端复算输出尺寸 ──
  // ResolutionSelector（ComfyUI 核心 comfy_extras/nodes_resolution.py）公式：
  //   scale = sqrt(mp*1024²/(rw*rh))；w = round(rw*scale/multiple)*multiple
  const ASPECT_MAP = {
    "1:1 (Square)": [1, 1],
    "2:3 (Portrait Photo)": [2, 3],
    "3:2 (Photo)": [3, 2],
    "3:4 (Portrait Standard)": [3, 4],
    "4:3 (Standard)": [4, 3],
    "9:16 (Portrait Widescreen)": [9, 16],
    "16:9 (Widescreen)": [16, 9],
    "21:9 (Ultrawide)": [21, 9],
  };
  function traceSource(inputName) {
    const inp = node.inputs?.find((i) => i && i.name === inputName);
    if (!inp || inp.link == null) return null;
    let link = null;
    try {
      link = app.graph.links?.[inp.link] ?? app.graph.links?.get?.(inp.link);
    } catch (e) {
      link = null;
    }
    return link ? app.graph.getNodeById(link.origin_id) : null;
  }
  function readResolutionSelector(src) {
    if (!src) return null;
    const get = (n) => src.widgets?.find((w) => w.name === n)?.value;
    let ar = get("aspect_ratio");
    const mp = parseFloat(get("megapixels"));
    const mult = parseInt(get("multiple"), 10) || 8;
    if (!ar) {
      // 兜底：任何值形如 "W:H ..." 的下拉框（兼容其他选择器节点）
      const combo = src.widgets?.find(
        (w) => typeof w.value === "string" && /^\s*\d+\s*:\s*\d+/.test(w.value)
      );
      ar = combo?.value;
    }
    if (!ar || !Number.isFinite(mp)) return null;
    let pair = ASPECT_MAP[String(ar).trim()];
    if (!pair) {
      const m = String(ar).match(/^\s*(\d+)\s*:\s*(\d+)/);
      if (m) pair = [+m[1], +m[2]];
    }
    if (!pair) return null;
    const scale = Math.sqrt((mp * 1024 * 1024) / (pair[0] * pair[1]));
    return [
      Math.max(64, Math.round((pair[0] * scale) / mult) * mult),
      Math.max(64, Math.round((pair[1] * scale) / mult) * mult),
    ];
  }
  function syncFromSelector() {
    const srcW = traceSource("width");
    const srcH = traceSource("height");
    const dims = readResolutionSelector(srcW) || readResolutionSelector(srcH);
    if (!dims) return false;
    const wW = node.widgets?.find((x) => x.name === "width");
    const hW = node.widgets?.find((x) => x.name === "height");
    if (wW) wW.value = dims[0];
    if (hW) hW.value = dims[1];
    applySize();
    return true;
  }

  // 宽高参数变化时同步画布尺寸（保留已画内容，等比缩放居中）
  for (const name of ["width", "height"]) {
    const w = node.widgets?.find((x) => x.name === name);
    if (w) {
      const orig = w.callback;
      w.callback = (...a) => {
        const r = orig?.(...a);
        applySize();
        return r;
      };
    }
  }

  // ── 弹出为独立可拖拽窗口 ──
  // 点「⧉ 弹出」后，画板整体移出节点，进入一个固定层级、可拖拽标题栏移动、
  // 可拖右下角缩放、画布可滚轮放大超出节点本身的独立窗口。画布位图、所有事件
  // 监听都随 DOM 元素一起移动，数据回传（getValue）与节点内完全一致。
  let floatWin = null, floatHome = null, winDragging = false, winOffX = 0, winOffY = 0;

  window.addEventListener("pointermove", (e) => {
    if (!winDragging || !floatWin) return;
    floatWin.style.left = Math.max(0, e.clientX - winOffX) + "px";
    floatWin.style.top = Math.max(0, e.clientY - winOffY) + "px";
  });
  window.addEventListener("pointerup", () => { winDragging = false; });

  function setPopLabel() {
    const btn = wrap.querySelector('button[data-act="pop"]');
    if (btn) btn.textContent = floatWin ? "⤡ 收回" : "⧉ 弹出";
  }
  function popOut() {
    if (floatWin) return;
    floatHome = wrap.parentElement; // 记住原父节点（ComfyUI 的 widget 容器），收回时还原
    floatWin = document.createElement("div");
    floatWin.style.cssText =
      "position:fixed;z-index:9999;left:90px;top:90px;width:680px;height:600px;" +
      "min-width:360px;min-height:340px;background:#1e1e1e;border:1px solid #555;" +
      "border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.55);" +
      "display:flex;flex-direction:column;resize:both;overflow:hidden;";
    const title = document.createElement("div");
    title.style.cssText =
      "flex:0 0 auto;height:30px;display:flex;align-items:center;padding:0 10px;" +
      "cursor:move;background:#2a2a2a;color:#ddd;font-size:12px;user-select:none;" +
      "border-bottom:1px solid #444;border-radius:8px 8px 0 0;";
    title.innerHTML =
      "<span style='flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'>" +
      "🎨 画板 Sketchpad · 拖动标题移动窗口 · 滚轮缩放 · 空格/中键平移</span>";
    const foldBtn = document.createElement("button");
    foldBtn.textContent = "✕ 收回";
    foldBtn.style.cssText =
      "cursor:pointer;padding:2px 8px;margin-left:8px;background:#444;color:#fff;" +
      "border:1px solid #666;border-radius:4px;flex:0 0 auto;";
    foldBtn.addEventListener("click", foldBack);
    title.appendChild(foldBtn);
    const content = document.createElement("div");
    content.style.cssText =
      "flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;";
    floatWin.appendChild(title);
    floatWin.appendChild(content);
    document.body.appendChild(floatWin);

    // 让画板区填满窗口内容区（弹出时不再固定 380px）
    wrap.style.height = "100%";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    padWrap.style.height = "auto";
    padWrap.style.flex = "1 1 auto";
    padWrap.style.minHeight = "0";
    content.appendChild(wrap);

    title.addEventListener("pointerdown", (e) => {
      if (e.target === foldBtn) return;
      winDragging = true;
      const r = floatWin.getBoundingClientRect();
      winOffX = e.clientX - r.left;
      winOffY = e.clientY - r.top;
      e.preventDefault();
    });
    setPopLabel();
  }
  function foldBack() {
    if (!floatWin) return;
    wrap.style.height = "";
    wrap.style.display = "";
    wrap.style.flexDirection = "";
    padWrap.style.height = "380px";
    padWrap.style.flex = "";
    padWrap.style.minHeight = "";
    if (floatHome) floatHome.appendChild(wrap);
    floatWin.remove();
    floatWin = null;
    floatHome = null;
    setPopLabel();
  }

  node.__sketchpad = { applySize, loadImage, update, clearAll };

  setMode("brush");
  applySize();

  if (node.size && node.size[0] < 360) node.size = [360, 620];
  return domWidget;
}

app.registerExtension({
  name: "wb.sketchpad",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origOnNodeCreated?.apply(this, arguments);
      installPad(this);
      return r;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origOnConfigure?.apply(this, arguments);
      // 恢复保存过的画布内容
      requestAnimationFrame(() => {
        const pad = this.__sketchpad;
        if (!pad) return;
        const w = this.widgets?.find((x) => x.name === "sketch_data");
        if (w && typeof w.value === "string" && w.value.startsWith("data:image")) {
          pad.loadImage(w.value);
        } else {
          pad.applySize();
        }
      });
      return r;
    };

    // 每次执行完成后，用后端回传的实际宽高适配画板（保留内容，等比拉伸）。
    // 用法：把 width/height 转成输入并连接「分辨率选择器」→ 运行一次，画板比例即跟随。
    const origOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = origOnExecuted?.apply(this, arguments);
      try {
        const w = Array.isArray(message?.width) ? message.width[0] : message?.width;
        const h = Array.isArray(message?.height) ? message.height[0] : message?.height;
        if (Number.isFinite(+w) && Number.isFinite(+h) && +w > 0 && +h > 0) {
          const wW = this.widgets?.find((x) => x.name === "width");
          const hW = this.widgets?.find((x) => x.name === "height");
          if (wW) wW.value = +w;
          if (hW) hW.value = +h;
          this.__sketchpad?.applySize();
        }
      } catch (e) {
        /* ignore */
      }
      return r;
    };
  },
});
