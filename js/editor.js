// 手帳頁面編輯器：手寫、螢光筆、畫畫、橡皮擦、貼紙、照片、文字、紙膠帶
import { db, uid, todayStr } from './db.js';
import {
  PAGE_W, PAGE_H, drawPaper, drawStroke, drawStrokes, hitStroke,
  tapePatternCanvas, tapeOutline, shrinkImage, makeThumb, renderPage, FONTS, loadImage, removeWhite,
} from './render.js';
import { BUILTIN_STICKERS, EMOJI_GROUPS, TAPES, PAPERS, MOODS } from './stickers.js';
import { openSheet, closeSheet, toast, esc, pickFiles, confirmSheet, shareOrDownload, fmtDate } from './ui.js';

const PEN_COLORS = ['#3b3036', '#5b6b8c', '#e0445e', '#ff8a3d', '#f2b705', '#3aa76d', '#2d7dd2', '#8a5cf6', '#a0694b', '#ffffff'];
const HL_COLORS = ['#ffe44d', '#ff9ec4', '#9df29b', '#8fd3ff', '#ffb35c', '#cfa8ff'];

const DEFAULT_TOOLS = {
  pen: { color: '#3b3036', size: 6 },
  brush: { color: '#2d7dd2', size: 26, opacity: 0.6 },
  highlighter: { color: '#ffe44d', size: 30, opacity: 0.4 },
  eraser: { size: 30, mode: 'pixel' },
};

const $ = id => document.getElementById(id);

export class Editor {
  constructor(app) {
    this.app = app;
    this.page = null;
    this.tool = 'pen';
    this.tools = structuredClone(DEFAULT_TOOLS);
    this.pencilOnly = false;
    this.selectedId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.zoomMode = 'width';
    this.current = null;
    this.saveTimer = null;
    this.dirty = false;

    this.stage = $('stage');
    this.wrap = $('pageWrap');
    this.pageEl = $('page');
    this.paperCanvas = $('paperCanvas');
    this.ink = $('inkCanvas');
    this.itemsLayer = $('itemsLayer');
    this.selBox = $('selBox');
    this.options = $('edOptions');
    this.cache = document.createElement('canvas');

    this.bind();
  }

  /* ================= 開啟 / 關閉 ================= */
  async open(page, { addItems = [] } = {}) {
    this.page = page;
    page.strokes ||= [];
    page.items ||= [];
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    const saved = await db.getSetting('tools');
    if (saved) this.tools = { ...structuredClone(DEFAULT_TOOLS), ...saved };
    this.pencilOnly = await db.getSetting('pencilOnly', false);

    document.body.classList.add('editing');
    this.app.show('editor');
    this.updateHeader();
    this.layout();
    this.renderPaper();
    this.rebuildCache();
    this.renderInk();
    this.renderItems();
    this.setTool(this.tool === 'select' ? 'pen' : this.tool);
    this.stage.scrollTop = 0;
    this.updateUndoButtons();

    if (addItems.length) {
      this.pushUndo();
      for (const it of addItems) this.addItem(it, false);
      this.markDirty();
    }
  }

  async close() {
    this.deselect();
    await this.saveNow(true);
    document.body.classList.remove('editing');
    this.page = null;
  }

  updateHeader() {
    const p = this.page;
    $('edDate').textContent = fmtDate(p.date) + (p.title ? ' · ' + p.title : '');
    $('edMood').textContent = p.mood || '🙂';
  }

  /* ================= 版面與縮放 ================= */
  layout() {
    const availW = this.stage.clientWidth - 32;
    const availH = this.stage.clientHeight - 32;
    let s = availW / PAGE_W;
    if (this.zoomMode === 'page') s = Math.min(s, availH / PAGE_H);
    if (this.zoomMode === 'big') s = s * 1.6;
    s = Math.max(0.2, Math.min(s, 1.4));
    this.scale = s;
    this.pageEl.style.transform = `scale(${s})`;
    this.wrap.style.width = PAGE_W * s + 'px';
    this.wrap.style.height = PAGE_H * s + 'px';
    this.pageEl.style.setProperty('--hs', Math.round(44 / s) + 'px');

    const res = Math.max(1, Math.min(2.5, (window.devicePixelRatio || 1) * s));
    if (res !== this.res) {
      this.res = res;
      for (const c of [this.ink, this.cache]) {
        c.width = Math.round(PAGE_W * res);
        c.height = Math.round(PAGE_H * res);
      }
      this.paperCanvas.width = Math.round(PAGE_W * Math.min(res, 1.5));
      this.paperCanvas.height = Math.round(PAGE_H * Math.min(res, 1.5));
      if (this.page) { this.renderPaper(); this.rebuildCache(); this.renderInk(); }
    }
    this.updateSelBox();
  }

  renderPaper() {
    const c = this.paperCanvas, g = c.getContext('2d');
    g.setTransform(c.width / PAGE_W, 0, 0, c.height / PAGE_H, 0, 0);
    drawPaper(g, this.page.paper);
  }

  rebuildCache() {
    const g = this.cache.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cache.width, this.cache.height);
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    drawStrokes(g, this.page.strokes);
  }

  renderInk() {
    this.rafPending = false;
    const g = this.ink.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ink.width, this.ink.height);
    g.drawImage(this.cache, 0, 0);
    if (this.current && !(this.current.tool === 'eraser' && this.current.mode === 'stroke')) {
      g.setTransform(this.res, 0, 0, this.res, 0, 0);
      drawStroke(g, this.current);
    }
  }

  requestInk() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => this.renderInk());
  }

  toPage(e) {
    const r = this.pageEl.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * PAGE_W, (e.clientY - r.top) / r.height * PAGE_H];
  }

  visibleCenter() {
    const r = this.pageEl.getBoundingClientRect();
    const sr = this.stage.getBoundingClientRect();
    const cx = (Math.max(r.left, sr.left) + Math.min(r.right, sr.right)) / 2;
    const cy = (Math.max(r.top, sr.top) + Math.min(r.bottom, sr.bottom)) / 2;
    return [
      Math.max(120, Math.min(PAGE_W - 120, (cx - r.left) / r.width * PAGE_W)),
      Math.max(120, Math.min(PAGE_H - 120, (cy - r.top) / r.height * PAGE_H)),
    ];
  }

  /* ================= 事件綁定 ================= */
  bind() {
    window.addEventListener('resize', () => this.page && this.layout());

    // 畫筆
    const ink = this.ink;
    ink.addEventListener('pointerdown', e => this.inkDown(e));
    ink.addEventListener('pointermove', e => this.inkMove(e));
    ink.addEventListener('pointerup', e => this.inkUp(e));
    ink.addEventListener('pointercancel', e => this.inkUp(e));
    // iOS：避免長按跳出選單、放大鏡
    ink.addEventListener('touchstart', e => { if (this.tool !== 'select') e.preventDefault(); }, { passive: false });
    ink.addEventListener('contextmenu', e => e.preventDefault());

    // 物件操作
    this.pointers = new Map();
    this.itemsLayer.addEventListener('pointerdown', e => this.itemDown(e));
    this.selBox.addEventListener('pointerdown', e => this.handleDown(e));
    window.addEventListener('pointermove', e => this.dragMove(e));
    window.addEventListener('pointerup', e => this.dragUp(e));
    window.addEventListener('pointercancel', e => this.dragUp(e));
    this.stage.addEventListener('pointerdown', e => {
      if (this.tool === 'select' && (e.target === this.stage || e.target === this.wrap || e.target === this.itemsLayer)) this.deselect();
    });

    // 工具列
    $('edTools').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) this.setTool(b.dataset.tool);
      if (b.dataset.add === 'sticker') this.openStickerSheet();
      if (b.dataset.add === 'photo') this.addPhotos();
      if (b.dataset.add === 'text') this.openTextSheet();
    });
    $('edUndo').onclick = () => this.undo();
    $('edRedo').onclick = () => this.redo();
    $('edBack').onclick = () => this.app.closeEditor();
    $('edMood').onclick = () => this.openMoodSheet();
    $('edPaper').onclick = () => this.openPaperSheet();
    $('edDate').onclick = () => this.openPageInfoSheet();
    $('edMore').onclick = () => this.openMoreSheet();

    // 鍵盤（Mac）
    window.addEventListener('keydown', e => {
      if (!this.page || !document.body.classList.contains('editing')) return;
      if (e.target.matches('input, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && this.selectedId) { e.preventDefault(); this.deleteSelected(); }
      else if (!mod) {
        const map = { v: 'select', p: 'pen', b: 'brush', h: 'highlighter', e: 'eraser' };
        if (map[e.key]) this.setTool(map[e.key]);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.page) this.saveNow(true);
    });
  }

  /* ================= 工具 ================= */
  setTool(t) {
    this.tool = t;
    document.body.dataset.tool = t;
    for (const b of $('edTools').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    if (t !== 'select') this.deselect(false);
    this.renderOptions();
  }

  saveTools() { db.setSetting('tools', this.tools); }

  renderOptions() {
    const t = this.tool, o = this.options;
    if (t === 'select') return this.renderSelectOptions();
    const cfg = this.tools[t];
    let html = '';
    if (t !== 'eraser') {
      const colors = t === 'highlighter' ? HL_COLORS : PEN_COLORS;
      html += `<div class="preview-dot" id="prevDot"></div>`;
      html += colors.map(c => `<button class="swatch ${c === cfg.color ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');
      html += `<input type="color" id="optColor" value="${cfg.color}" title="自選顏色">`;
    } else {
      html += `<button class="opt-btn ${cfg.mode === 'pixel' ? 'on' : ''}" data-mode="pixel">局部擦</button>
               <button class="opt-btn ${cfg.mode === 'stroke' ? 'on' : ''}" data-mode="stroke">整筆擦</button>`;
    }
    const [mn, mx] = { pen: [1, 24], brush: [4, 90], highlighter: [8, 70], eraser: [8, 120] }[t];
    html += `<label>粗細 <input type="range" id="optSize" min="${mn}" max="${mx}" value="${cfg.size}"></label>`;
    if (t === 'brush' || t === 'highlighter') {
      const maxO = t === 'highlighter' ? 85 : 100;
      html += `<label>濃淡 <input type="range" id="optOpacity" min="8" max="${maxO}" value="${Math.round(cfg.opacity * 100)}"></label>`;
    }
    o.innerHTML = html;
    const prev = () => {
      const d = o.querySelector('#prevDot');
      if (!d) return;
      const sz = Math.max(4, Math.min(40, cfg.size * (t === 'pen' ? 1.2 : 0.6)));
      d.innerHTML = `<span style="display:block;width:${sz}px;height:${sz}px;border-radius:50%;background:${cfg.color};opacity:${t === 'pen' ? 1 : cfg.opacity};box-shadow:0 0 0 1px rgba(0,0,0,.08)"></span>`;
    };
    prev();
    o.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.color) { cfg.color = b.dataset.color; this.saveTools(); this.renderOptions(); }
      if (b.dataset.mode) { cfg.mode = b.dataset.mode; this.saveTools(); this.renderOptions(); }
    };
    const col = o.querySelector('#optColor');
    if (col) col.oninput = () => { cfg.color = col.value; this.saveTools(); prev(); o.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); };
    o.querySelector('#optSize').oninput = e => { cfg.size = +e.target.value; this.saveTools(); prev(); };
    const op = o.querySelector('#optOpacity');
    if (op) op.oninput = () => { cfg.opacity = op.value / 100; this.saveTools(); prev(); };
  }

  renderSelectOptions() {
    const o = this.options;
    const it = this.selected();
    if (!it) {
      o.innerHTML = `<span class="hint">點一下貼紙、照片或文字就能移動；拖曳右下角圓點可以旋轉和縮放，iPad 也可以用兩指轉。</span>`;
      o.onclick = null;
      return;
    }
    let html = `
      <button class="opt-btn" data-act="up">⬆️ 上一層</button>
      <button class="opt-btn" data-act="down">⬇️ 下一層</button>
      <button class="opt-btn" data-act="dup">📄 複製</button>
      <button class="opt-btn" data-act="del">🗑️ 刪除</button>`;
    if (it.type === 'photo') {
      const f = it.frame || 'none';
      html += `<i class="sep"></i>` + [['none', '無框'], ['polaroid', '拍立得'], ['round', '圓形'], ['stamp', '郵票']]
        .map(([k, l]) => `<button class="opt-btn ${f === k ? 'on' : ''}" data-frame="${k}">${l}</button>`).join('');
      if (f === 'polaroid') html += `<button class="opt-btn" data-act="caption">✏️ 寫字</button>`;
    }
    if (it.type === 'text') html += `<button class="opt-btn" data-act="edit">✏️ 編輯文字</button>`;
    if (it.type === 'sticker') html += `<button class="opt-btn ${it.outline ? 'on' : ''}" data-act="outline">陰影</button>`;
    if (it.type === 'tape') html += TAPES.map(t => `<button class="opt-btn ${it.tape === t.id ? 'on' : ''}" data-tape="${t.id}">${t.label}</button>`).join('');
    o.innerHTML = html;
    o.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'up' || act === 'down') this.reorder(act === 'up' ? 1 : -1);
      if (act === 'dup') this.duplicate();
      if (act === 'del') this.deleteSelected();
      if (act === 'edit') this.openTextSheet(it);
      if (act === 'caption') this.openCaptionSheet(it);
      if (act === 'outline') { this.pushUndo(); it.outline = !it.outline; this.itemChanged(it, true); }
      if (b.dataset.frame) this.setFrame(it, b.dataset.frame);
      if (b.dataset.tape) { this.pushUndo(); it.tape = b.dataset.tape; this.itemChanged(it, true); }
    };
  }

  /* ================= 手寫 ================= */
  pressure(e) {
    if (e.pointerType === 'pen') return Math.max(0.08, e.pressure || 0.5);
    return 0.55;
  }

  inkDown(e) {
    if (this.tool === 'select' || !this.page) return;
    if (e.pointerType === 'pen' && !this.pencilOnly) {
      this.pencilOnly = true;
      db.setSetting('pencilOnly', true);
      toast('偵測到 Apple Pencil：手指改成捲動，手掌不會畫到 ✋');
    }
    if (this.pencilOnly && e.pointerType === 'touch') {
      // 手指 → 捲動頁面
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: this.stage.scrollLeft, st: this.stage.scrollTop };
      try { this.ink.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    if (this.current) return;
    e.preventDefault();
    try { this.ink.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const cfg = this.tools[this.tool];
    const [x, y] = this.toPage(e);
    this.current = {
      id: e.pointerId,
      tool: this.tool,
      color: cfg.color,
      size: cfg.size,
      opacity: cfg.opacity ?? 1,
      mode: cfg.mode,
      points: [[x, y, this.pressure(e)]],
    };
    if (this.tool === 'eraser' && cfg.mode === 'stroke') {
      this.pushUndo();
      this.current.erased = false;
      this.eraseAt(x, y);
    }
    this.requestInk();
  }

  inkMove(e) {
    if (this.pan && e.pointerId === this.pan.id) {
      this.stage.scrollLeft = this.pan.sl - (e.clientX - this.pan.x);
      this.stage.scrollTop = this.pan.st - (e.clientY - this.pan.y);
      return;
    }
    const cur = this.current;
    if (!cur || e.pointerId !== cur.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = this.toPage(ev);
      const last = cur.points[cur.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 1.2) continue;
      cur.points.push([x, y, this.pressure(ev)]);
      if (cur.tool === 'eraser' && cur.mode === 'stroke') this.eraseAt(x, y);
    }
    this.requestInk();
  }

  inkUp(e) {
    if (this.pan && e.pointerId === this.pan.id) { this.pan = null; return; }
    const cur = this.current;
    if (!cur || e.pointerId !== cur.id) return;
    this.current = null;
    if (cur.tool === 'eraser' && cur.mode === 'stroke') {
      if (!cur.erased) this.undoStack.pop();
      this.renderInk();
      return;
    }
    // 四捨五入座標，檔案比較小
    const stroke = {
      tool: cur.tool, color: cur.color, size: cur.size, opacity: cur.opacity,
      points: cur.points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]),
    };
    this.pushUndo();
    this.page.strokes.push(stroke);
    const g = this.cache.getContext('2d');
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    drawStroke(g, stroke);
    this.renderInk();
    this.markDirty();
  }

  eraseAt(x, y) {
    const r = this.tools.eraser.size / 2;
    const before = this.page.strokes.length;
    this.page.strokes = this.page.strokes.filter(s => s.tool === 'eraser' || !hitStroke(s, x, y, r));
    if (this.page.strokes.length !== before) {
      this.current.erased = true;
      this.rebuildCache();
      this.markDirty();
    }
  }

  /* ================= 物件 ================= */
  selected() { return this.page?.items.find(i => i.id === this.selectedId) || null; }

  itemEl(it) {
    const el = document.createElement('div');
    el.className = 'item ' + it.type;
    el.dataset.id = it.id;
    this.styleItem(el, it);
    if (it.type === 'photo') {
      el.classList.add('frame-' + (it.frame || 'none'));
      const img = document.createElement('img');
      img.src = it.src; img.draggable = false;
      el.appendChild(img);
      if (it.frame === 'polaroid') {
        const cap = document.createElement('div');
        cap.className = 'caption';
        el.appendChild(cap);
      }
    } else if (it.type === 'sticker') {
      if (it.outline) el.classList.add('outline');
      const img = document.createElement('img');
      img.src = it.src; img.draggable = false;
      el.appendChild(img);
    } else if (it.type === 'emoji') {
      el.textContent = it.text;
    } else if (it.type === 'text') {
      el.textContent = it.text;
    }
    this.decorate(el, it);
    return el;
  }

  styleItem(el, it) {
    el.style.left = (it.x - it.w / 2) + 'px';
    el.style.top = (it.y - it.h / 2) + 'px';
    el.style.width = it.w + 'px';
    el.style.height = it.h + 'px';
    el.style.transform = `rotate(${it.rot || 0}deg)`;
  }

  // 依照尺寸更新外觀（相框、字體大小、紙膠帶）
  decorate(el, it) {
    if (it.type === 'photo') {
      const f = it.frame || 'none';
      el.style.padding = '';
      el.style.webkitMask = el.style.mask = '';
      if (f === 'polaroid') {
        const pad = it.w * 0.05;
        el.style.padding = `${pad}px ${pad}px ${it.w * 0.18}px ${pad}px`;
        const cap = el.querySelector('.caption');
        if (cap) {
          cap.textContent = it.caption || '';
          cap.style.fontSize = it.w * 0.07 + 'px';
          cap.style.fontFamily = FONTS.hand;
          cap.style.top = (it.h - it.w * 0.09 - it.w * 0.045) + 'px';
          cap.style.lineHeight = it.w * 0.09 + 'px';
        }
      } else if (f === 'stamp') {
        const r = Math.max(4, it.w * 0.025);
        el.style.padding = r * 2.2 + 'px';
        const m = `radial-gradient(circle ${r}px at ${r * 1.5}px ${r * 1.5}px, transparent ${r}px, #000 ${r + 0.5}px) ${-r * 1.5}px ${-r * 1.5}px / ${r * 3}px ${r * 3}px repeat, linear-gradient(#000,#000) ${r}px ${r}px / calc(100% - ${2 * r}px) calc(100% - ${2 * r}px) no-repeat`;
        el.style.webkitMask = m; el.style.mask = m;
      }
    } else if (it.type === 'emoji') {
      el.style.fontSize = it.h * 0.82 + 'px';
    } else if (it.type === 'text') {
      el.style.fontSize = (it.size || 40) + 'px';
      el.style.fontFamily = FONTS[it.font] || FONTS.hand;
      el.style.color = it.color || '#3b3036';
      el.style.fontWeight = it.bold ? '700' : '400';
      el.style.textAlign = it.align || 'left';
    } else if (it.type === 'tape') {
      const url = this.tapeURL(it.tape);
      el.style.background = `url(${url}) repeat`;
      el.style.opacity = 0.85;
      el.style.clipPath = 'polygon(' + tapeOutline(it.w, it.h).map(([x, y]) => `${x}px ${y}px`).join(',') + ')';
    }
  }

  tapeURL(id) {
    this.tapeCache ||= {};
    return this.tapeCache[id] ||= tapePatternCanvas(id).toDataURL();
  }

  renderItems() {
    this.itemsLayer.innerHTML = '';
    for (const it of this.page.items) this.itemsLayer.appendChild(this.itemEl(it));
    this.updateSelBox();
  }

  itemChanged(it, rebuild = false) {
    const el = this.itemsLayer.querySelector(`[data-id="${it.id}"]`);
    if (!el) return;
    if (rebuild) {
      const nel = this.itemEl(it);
      el.replaceWith(nel);
    } else {
      this.styleItem(el, it);
      this.decorate(el, it);
    }
    this.updateSelBox();
    this.markDirty();
    if (rebuild && this.tool === 'select') this.renderSelectOptions();
  }

  addItem(partial, undo = true) {
    if (undo) this.pushUndo();
    const [cx, cy] = this.visibleCenter();
    const it = { id: uid(), x: cx, y: cy, w: 180, h: 180, rot: 0, ...partial };
    this.page.items.push(it);
    this.itemsLayer.appendChild(this.itemEl(it));
    if (it.type === 'text') this.fitTextHeight(it);
    this.setTool('select');
    this.select(it.id);
    this.markDirty();
    return it;
  }

  fitTextHeight(it) {
    const el = this.itemsLayer.querySelector(`[data-id="${it.id}"]`);
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.max(it.size || 40, el.scrollHeight);
    it.h = Math.ceil(h);
    this.styleItem(el, it);
    this.updateSelBox();
  }

  select(id) {
    this.selectedId = id;
    this.updateSelBox();
    if (this.tool === 'select') this.renderSelectOptions();
  }

  deselect(render = true) {
    this.selectedId = null;
    this.selBox.classList.add('hidden');
    if (render && this.tool === 'select') this.renderSelectOptions();
  }

  updateSelBox() {
    const it = this.selected();
    if (!it) { this.selBox.classList.add('hidden'); return; }
    const b = this.selBox;
    b.classList.remove('hidden');
    const pad = 8 / (this.scale || 1);
    b.style.left = (it.x - it.w / 2 - pad) + 'px';
    b.style.top = (it.y - it.h / 2 - pad) + 'px';
    b.style.width = (it.w + pad * 2) + 'px';
    b.style.height = (it.h + pad * 2) + 'px';
    b.style.transform = `rotate(${it.rot || 0}deg)`;
    b.style.borderWidth = Math.max(2, 3 / (this.scale || 1)) + 'px';
  }

  itemDown(e) {
    if (this.tool !== 'select') return;
    const el = e.target.closest('.item');
    if (!el) { this.deselect(); return; }
    e.preventDefault();
    const it = this.page.items.find(i => i.id === el.dataset.id);
    if (!it) return;

    // 雙擊文字 → 編輯
    const now = Date.now();
    if (this.lastTap && this.lastTap.id === it.id && now - this.lastTap.t < 320) {
      this.lastTap = null;
      if (it.type === 'text') { this.openTextSheet(it); return; }
      if (it.type === 'photo' && it.frame === 'polaroid') { this.openCaptionSheet(it); return; }
    }
    this.lastTap = { id: it.id, t: now };

    if (this.selectedId !== it.id) this.select(it.id);
    this.pointers.set(e.pointerId, this.toPage(e));
    if (this.pointers.size === 1) {
      const [px, py] = this.toPage(e);
      this.drag = { kind: 'move', id: e.pointerId, it, sx: px, sy: py, ox: it.x, oy: it.y, undone: false };
    } else if (this.pointers.size === 2) {
      this.startPinch(it);
    }
  }

  startPinch(it) {
    const [a, b] = [...this.pointers.values()];
    this.drag = {
      kind: 'pinch', it, undone: this.drag?.undone || false,
      d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
      a0: Math.atan2(b[1] - a[1], b[0] - a[0]),
      w0: it.w, h0: it.h, r0: it.rot || 0, s0: it.size || 40,
    };
  }

  handleDown(e) {
    const h = e.target.closest('.sel-handle');
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    const it = this.selected();
    if (!it) return;
    if (h.dataset.h === 'del') { this.deleteSelected(); return; }
    const [px, py] = this.toPage(e);
    this.drag = {
      kind: 'rot', id: e.pointerId, it, undone: false,
      d0: Math.hypot(px - it.x, py - it.y) || 1,
      a0: Math.atan2(py - it.y, px - it.x),
      w0: it.w, h0: it.h, r0: it.rot || 0, s0: it.size || 40,
    };
  }

  dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.toPage(e));
    const it = d.it;
    const ensureUndo = () => { if (!d.undone) { this.pushUndo(); d.undone = true; } };
    if (d.kind === 'move' && e.pointerId === d.id) {
      const [px, py] = this.toPage(e);
      if (!d.undone && Math.hypot(px - d.sx, py - d.sy) < 3) return;
      ensureUndo();
      it.x = Math.round(d.ox + px - d.sx);
      it.y = Math.round(d.oy + py - d.sy);
      this.itemChanged(it);
    } else if (d.kind === 'rot' && e.pointerId === d.id) {
      ensureUndo();
      const [px, py] = this.toPage(e);
      const s = Math.hypot(px - it.x, py - it.y) / d.d0;
      const a = Math.atan2(py - it.y, px - it.x);
      this.applyScaleRot(it, d, s, (a - d.a0) * 180 / Math.PI);
    } else if (d.kind === 'pinch' && this.pointers.size >= 2) {
      ensureUndo();
      const [a, b] = [...this.pointers.values()];
      const s = Math.hypot(b[0] - a[0], b[1] - a[1]) / d.d0;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      this.applyScaleRot(it, d, s, (ang - d.a0) * 180 / Math.PI);
    }
  }

  applyScaleRot(it, d, s, dr) {
    s = Math.max(40 / Math.min(d.w0, d.h0), Math.min(s, 2400 / Math.max(d.w0, d.h0)));
    it.w = Math.round(d.w0 * s);
    it.h = Math.round(d.h0 * s);
    if (it.type === 'text') it.size = Math.max(10, Math.round(d.s0 * s));
    let r = d.r0 + dr;
    // 接近水平/垂直時自動吸附
    const snap = Math.round(r / 90) * 90;
    if (Math.abs(r - snap) < 4) r = snap;
    it.rot = Math.round(r * 10) / 10;
    this.itemChanged(it);
  }

  dragUp(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size < 2) this.drag = null;
      return;
    }
    if (e.pointerId === d.id) this.drag = null;
  }

  reorder(dir) {
    const items = this.page.items;
    const i = items.findIndex(x => x.id === this.selectedId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    this.pushUndo();
    [items[i], items[j]] = [items[j], items[i]];
    this.renderItems();
    this.markDirty();
  }

  duplicate() {
    const it = this.selected();
    if (!it) return;
    this.pushUndo();
    const copy = { ...it, id: uid(), x: it.x + 30, y: it.y + 30 };
    this.page.items.push(copy);
    this.itemsLayer.appendChild(this.itemEl(copy));
    this.select(copy.id);
    this.markDirty();
  }

  deleteSelected() {
    const id = this.selectedId;
    if (!id) return;
    this.pushUndo();
    this.page.items = this.page.items.filter(i => i.id !== id);
    this.itemsLayer.querySelector(`[data-id="${id}"]`)?.remove();
    this.deselect();
    this.markDirty();
  }

  setFrame(it, frame) {
    this.pushUndo();
    it.frame = frame;
    const a = it.aspect || it.w / it.h;
    if (frame === 'polaroid') {
      const pad = it.w * 0.05;
      it.h = Math.round((it.w - pad * 2) / a + pad + it.w * 0.18);
    } else if (frame === 'round') {
      it.h = it.w;
    } else if (frame === 'stamp') {
      const p = Math.max(4, it.w * 0.025) * 2.2;
      it.h = Math.round((it.w - p * 2) / a + p * 2);
    } else {
      it.h = Math.round(it.w / a);
    }
    this.itemChanged(it, true);
  }

  /* ================= 新增：照片 ================= */
  async addPhotos() {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (!files.length) return;
    toast('照片處理中…');
    this.pushUndo();
    let i = 0;
    for (const f of files) {
      try {
        const { src, w, h } = await shrinkImage(f, 1400);
        const aspect = w / h;
        const W = files.length > 1 ? 340 : 420;
        const pad = W * 0.05;
        const [cx, cy] = this.visibleCenter();
        this.addItem({
          type: 'photo', src, aspect, frame: 'polaroid',
          w: W, h: Math.round((W - pad * 2) / aspect + pad + W * 0.18),
          x: cx + (i % 2 ? 90 : -90) * (files.length > 1 ? 1 : 0) + i * 12,
          y: cy + (Math.floor(i / 2) - (files.length > 2 ? 0.5 : 0)) * 200,
          rot: Math.round((Math.random() * 10 - 5) * 10) / 10,
        }, false);
      } catch (e) {
        toast('有一張照片讀不到');
      }
      i++;
    }
  }

  /* ================= 新增：貼紙 ================= */
  async openStickerSheet(tab = this.lastStickerTab || 'builtin') {
    this.lastStickerTab = tab;
    const tabs = [['builtin', '貼紙'], ['emoji', '表情符號'], ['mine', '我的貼紙'], ['collect', '旅行收藏'], ['tape', '紙膠帶']];
    let content = '';
    if (tab === 'builtin') {
      content = `<div class="grid-pick">${BUILTIN_STICKERS.map(s => `<button data-src="${s.id}"><img src="${s.src}" alt=""></button>`).join('')}</div>`;
    } else if (tab === 'emoji') {
      content = Object.entries(EMOJI_GROUPS).map(([g, list]) =>
        `<div class="section-title" style="margin-top:12px">${g}</div><div class="grid-pick">${list.map(e => `<button data-emoji="${e}">${e}</button>`).join('')}</div>`).join('');
    } else if (tab === 'mine') {
      const mine = await db.all('stickers');
      content = `<button class="big-add" data-act="make">✂️ 用照片做一張新貼紙</button>
        <div class="grid-pick">${mine.map(s => `<button data-mine="${s.id}"><img src="${s.src}" alt=""></button>`).join('') || '<div class="empty">還沒有自己的貼紙。<br>拍一張可愛的東西（或手畫的圖）就能做成貼紙！</div>'}</div>`;
    } else if (tab === 'collect') {
      const cols = await db.all('collectibles');
      cols.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      content = `<div class="grid-pick">${cols.map(c => `<button data-col="${c.id}"><img src="${c.src}" alt=""></button>`).join('') || '<div class="empty">還沒有收藏。<br>到「旅行」裡拍下紀念章、收據或票根，就能貼到這裡。</div>'}</div>`;
    } else if (tab === 'tape') {
      content = `<div class="grid-pick tape-pick">${TAPES.map(t => `<button data-tape="${t.id}" title="${t.label}" style="background:url(${this.tapeURL(t.id)}) repeat"></button>`).join('')}</div>`;
    }
    const body = openSheet(`
      <div class="chips">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${content}`);
    body.onclick = async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) return this.openStickerSheet(b.dataset.tab);
      if (b.dataset.act === 'make') return this.makeSticker();
      closeSheet();
      if (b.dataset.src) {
        const s = BUILTIN_STICKERS.find(x => x.id === b.dataset.src);
        this.addItem({ type: 'sticker', src: s.src, w: 170, h: 170, rot: Math.round(Math.random() * 16 - 8) });
      } else if (b.dataset.emoji) {
        this.addItem({ type: 'emoji', text: b.dataset.emoji, w: 130, h: 130 });
      } else if (b.dataset.mine) {
        const s = await db.get('stickers', b.dataset.mine);
        this.addItem({ type: 'sticker', src: s.src, outline: true, ...fitBox(s.w, s.h, 240) });
      } else if (b.dataset.col) {
        const c = await db.get('collectibles', b.dataset.col);
        this.addItem(collectibleToItem(c));
      } else if (b.dataset.tape) {
        this.addItem({ type: 'tape', tape: b.dataset.tape, w: 320, h: 60, rot: Math.round(Math.random() * 20 - 10) });
      }
    };
  }

  async makeSticker() {
    const files = await pickFiles({ accept: 'image/*' });
    if (!files.length) return;
    const { canvas } = await shrinkImage(files[0], 900, 'image/png');
    let threshold = 0; // 0 = 不去背
    const body = openSheet(`
      <h3>✂️ 做新貼紙</h3>
      <div class="stamp-preview" id="stkPrev"></div>
      <label class="field"><span>去掉白色背景（適合白紙上的手繪圖、印章）</span>
        <input type="range" id="stkTh" min="0" max="250" value="0" style="width:100%">
      </label>
      <div class="actions"><button class="pill-btn ghost" data-a="cancel">取消</button><button class="pill-btn" data-a="save">存成貼紙並貼上</button></div>`);
    const prev = body.querySelector('#stkPrev');
    let out = canvas;
    const draw = () => {
      out = threshold > 0 ? removeWhite(canvas, threshold) : canvas;
      prev.innerHTML = '';
      const im = new Image(); im.src = out.toDataURL('image/png');
      prev.appendChild(im);
    };
    draw();
    body.querySelector('#stkTh').oninput = e => { threshold = +e.target.value; clearTimeout(this._t); this._t = setTimeout(draw, 120); };
    body.querySelector('[data-a=cancel]').onclick = closeSheet;
    body.querySelector('[data-a=save]').onclick = async () => {
      const s = { id: uid(), src: out.toDataURL('image/png'), w: out.width, h: out.height, createdAt: Date.now() };
      await db.put('stickers', s);
      closeSheet();
      this.addItem({ type: 'sticker', src: s.src, outline: true, ...fitBox(s.w, s.h, 240) });
      toast('貼紙做好了，之後在「我的貼紙」裡找得到');
    };
  }

  /* ================= 新增：文字 ================= */
  openTextSheet(existing = null) {
    const it = existing || { text: '', font: 'hand', size: 44, color: this.tools.pen.color === '#ffffff' ? '#3b3036' : this.tools.pen.color, bold: false, align: 'left' };
    const st = { ...it };
    const fonts = [['hand', '楷書手寫'], ['round', '圓體'], ['sans', '黑體'], ['serif', '明體']];
    const body = openSheet(`
      <h3>${existing ? '編輯文字' : '打字'}</h3>
      <textarea id="txtIn" placeholder="想寫什麼都可以…">${esc(st.text)}</textarea>
      <div class="chips" id="txtFont" style="margin-top:10px">${fonts.map(([k, l]) => `<button data-font="${k}" class="${st.font === k ? 'on' : ''}" style="font-family:${FONTS[k]}">${l}</button>`).join('')}</div>
      <div class="row" style="margin:8px 0">
        ${PEN_COLORS.slice(0, 9).map(c => `<button class="swatch-s" data-color="${c}" style="width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 ${c === st.color ? '3px #3b3036' : '1.5px #ddd'};background:${c};padding:0"></button>`).join('')}
      </div>
      <label class="field"><span>字的大小</span><input type="range" id="txtSize" min="18" max="140" value="${st.size}" style="width:100%"></label>
      <div class="chips">
        <button data-bold="1" class="${st.bold ? 'on' : ''}"><b>粗體</b></button>
        <button data-align="left" class="${st.align !== 'center' ? 'on' : ''}">靠左</button>
        <button data-align="center" class="${st.align === 'center' ? 'on' : ''}">置中</button>
      </div>
      <div class="actions"><button class="pill-btn ghost" data-a="cancel">取消</button><button class="pill-btn" data-a="ok">完成</button></div>`);
    const ta = body.querySelector('#txtIn');
    setTimeout(() => ta.focus(), 250);
    body.querySelector('#txtSize').oninput = e => { st.size = +e.target.value; };
    body.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.font) { st.font = b.dataset.font; body.querySelectorAll('[data-font]').forEach(x => x.classList.toggle('on', x === b)); }
      if (b.dataset.color) { st.color = b.dataset.color; body.querySelectorAll('[data-color]').forEach(x => x.style.boxShadow = `0 0 0 ${x === b ? '3px #3b3036' : '1.5px #ddd'}`); }
      if (b.dataset.bold) { st.bold = !st.bold; b.classList.toggle('on', st.bold); }
      if (b.dataset.align) { st.align = b.dataset.align; body.querySelectorAll('[data-align]').forEach(x => x.classList.toggle('on', x === b)); }
      if (b.dataset.a === 'cancel') closeSheet();
      if (b.dataset.a === 'ok') {
        st.text = ta.value;
        closeSheet();
        if (!st.text.trim()) { if (existing) { this.select(existing.id); this.deleteSelected(); } return; }
        if (existing) {
          this.pushUndo();
          Object.assign(existing, { text: st.text, font: st.font, size: st.size, color: st.color, bold: st.bold, align: st.align });
          this.itemChanged(existing, true);
          this.fitTextHeight(existing);
        } else {
          this.addItem({ type: 'text', ...st, w: 640, h: st.size * 1.4 });
        }
      }
    };
  }

  openCaptionSheet(it) {
    const body = openSheet(`
      <h3>拍立得上的小字</h3>
      <input type="text" id="capIn" value="${esc(it.caption || '')}" placeholder="例如：京都 · 好好吃的抹茶">
      <div class="actions"><button class="pill-btn" data-a="ok">完成</button></div>`);
    const inp = body.querySelector('#capIn');
    setTimeout(() => inp.focus(), 250);
    body.querySelector('[data-a=ok]').onclick = () => {
      this.pushUndo();
      it.caption = inp.value;
      closeSheet();
      this.itemChanged(it, true);
    };
  }

  /* ================= 上方選單 ================= */
  openMoodSheet() {
    const body = openSheet(`<h3>今天的心情</h3><div class="mood-row">${MOODS.map(m => `<button class="${this.page.mood === m ? 'on' : ''}" data-m="${m}">${m}</button>`).join('')}</div>`);
    body.onclick = e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      this.page.mood = b.dataset.m;
      this.updateHeader();
      this.markDirty();
      closeSheet();
    };
  }

  openPaperSheet() {
    const body = openSheet(`<h3>換紙張</h3><div class="grid-pick">${PAPERS.map(p => `<button data-p="${p.id}" class="${(this.page.paper || 'plain') === p.id ? 'on' : ''}" style="flex-direction:column;font-size:13px;gap:4px"><canvas width="100" height="140" data-pc="${p.id}" style="width:44px;height:62px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.15)"></canvas>${p.label}</button>`).join('')}</div>`);
    body.querySelectorAll('canvas[data-pc]').forEach(c => {
      const g = c.getContext('2d'); g.scale(0.1, 0.1); drawPaper(g, c.dataset.pc);
    });
    body.onclick = e => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      this.pushUndo();
      this.page.paper = b.dataset.p;
      this.renderPaper();
      this.markDirty();
      closeSheet();
    };
  }

  async openPageInfoSheet() {
    const trips = await db.all('trips');
    trips.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const p = this.page;
    const body = openSheet(`
      <h3>這一頁</h3>
      <label class="field"><span>日期</span><input type="date" id="piDate" value="${p.date}"></label>
      <label class="field"><span>標題（可以不填）</span><input type="text" id="piTitle" value="${esc(p.title || '')}" placeholder="例如：第一次去金瓜石"></label>
      <label class="field"><span>屬於哪一趟旅行</span>
        <select id="piTrip"><option value="">（不是旅行）</option>${trips.map(t => `<option value="${t.id}" ${p.tripId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      </label>
      <div class="actions"><button class="pill-btn" data-a="ok">完成</button></div>`);
    body.querySelector('[data-a=ok]').onclick = () => {
      p.date = body.querySelector('#piDate').value || p.date;
      p.title = body.querySelector('#piTitle').value.trim();
      p.tripId = body.querySelector('#piTrip').value || null;
      this.updateHeader();
      this.markDirty();
      closeSheet();
    };
  }

  openMoreSheet() {
    const z = this.zoomMode;
    const body = openSheet(`
      <div class="menu-list">
        <button data-a="z-width">${z === 'width' ? '✓ ' : ''}🔍 符合螢幕寬度</button>
        <button data-a="z-page">${z === 'page' ? '✓ ' : ''}🔍 看整頁</button>
        <button data-a="z-big">${z === 'big' ? '✓ ' : ''}🔍 放大寫小字</button>
        <button data-a="export">📤 存成圖片（可存到照片、分享給朋友）</button>
        <button data-a="clear">🧹 清除這頁所有筆跡</button>
        <button data-a="delete" class="danger">🗑️ 刪除這一頁</button>
      </div>`);
    body.onclick = async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const a = b.dataset.a;
      closeSheet();
      if (a.startsWith('z-')) { this.zoomMode = a.slice(2); this.layout(); }
      if (a === 'export') this.exportImage();
      if (a === 'clear') {
        if (!this.page.strokes.length) return;
        this.pushUndo();
        this.page.strokes = [];
        this.rebuildCache(); this.renderInk(); this.markDirty();
        toast('已清除，按 ↶ 可以復原');
      }
      if (a === 'delete') {
        if (await confirmSheet('確定要刪除這一頁嗎？刪掉就找不回來了', '刪除')) {
          const id = this.page.id;
          clearTimeout(this.saveTimer);
          this.dirty = false;
          await db.del('pages', id);
          document.body.classList.remove('editing');
          this.page = null;
          this.app.afterEditorClosed();
          toast('已刪除');
        }
      }
    };
  }

  async exportImage() {
    toast('正在產生圖片…');
    const c = await renderPage(this.page, 2000);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await shareOrDownload(blob, `手帳-${this.page.date}.png`);
  }

  /* ================= 復原 / 儲存 ================= */
  snapshot() {
    return {
      strokes: this.page.strokes.slice(),
      items: this.page.items.map(i => ({ ...i })),
      paper: this.page.paper,
    };
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButtons();
  }

  restore(s) {
    this.page.strokes = s.strokes;
    this.page.items = s.items;
    this.page.paper = s.paper;
    if (!this.page.items.find(i => i.id === this.selectedId)) this.selectedId = null;
    this.renderPaper();
    this.rebuildCache();
    this.renderInk();
    this.renderItems();
    if (this.tool === 'select') this.renderSelectOptions();
    this.markDirty();
    this.updateUndoButtons();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }

  updateUndoButtons() {
    $('edUndo').disabled = !this.undoStack.length;
    $('edRedo').disabled = !this.redoStack.length;
  }

  markDirty() {
    this.dirty = true;
    this.updateUndoButtons();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(false), 800);
  }

  async saveNow(withThumb) {
    clearTimeout(this.saveTimer);
    const p = this.page;
    if (!p) return;
    if (this.dirty) {
      p.updatedAt = Date.now();
      this.dirty = false;
      this.needThumb = true;
      await db.put('pages', p);
    }
    if (withThumb && this.needThumb) {
      this.needThumb = false;
      p.thumb = await makeThumb(p);
      await db.put('pages', p);
    }
  }
}

/* ================= 共用小函式 ================= */
export function fitBox(w, h, max) {
  const s = max / Math.max(w, h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export function collectibleToItem(c) {
  const rot = Math.round(Math.random() * 12 - 6);
  if (c.kind === 'stamp' && c.cutout) return { type: 'sticker', src: c.src, ...fitBox(c.w || 1, c.h || 1, 260), rot };
  const box = fitBox(c.w || 1, c.h || 1, 300);
  return { type: 'photo', src: c.src, frame: 'none', aspect: (c.w || 1) / (c.h || 1), ...box, rot };
}

export function newPage(date = todayStr(), extra = {}) {
  return {
    id: uid(), date, title: '', mood: '', paper: 'lines', tripId: null,
    strokes: [], items: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  };
}

export { loadImage };
