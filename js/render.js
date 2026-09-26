// 繪圖：紙張、筆跡、貼紙照片——編輯畫面、縮圖、匯出圖片共用
import { TAPES } from './stickers.js';

export const PAGE_W = 1000;
export const PAGE_H = 1400;

/* ---------- 紙張 ---------- */
export function drawPaper(ctx, paper = 'plain') {
  const bg = { plain: '#fffdf8', lines: '#fffdf8', grid: '#fffdf8', dots: '#fffdf8', kraft: '#dcc39c', pink: '#fff1f4' }[paper] || '#fffdf8';
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  if (paper === 'lines' || paper === 'pink') {
    ctx.strokeStyle = paper === 'pink' ? 'rgba(236,140,170,.35)' : 'rgba(120,160,210,.35)';
    ctx.lineWidth = 2;
    for (let y = 150; y < PAGE_H - 40; y += 56) {
      ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(PAGE_W - 50, y); ctx.stroke();
    }
  } else if (paper === 'grid') {
    ctx.strokeStyle = 'rgba(120,160,210,.22)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= PAGE_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke(); }
    for (let y = 0; y <= PAGE_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
  } else if (paper === 'dots') {
    ctx.fillStyle = 'rgba(90,90,110,.28)';
    for (let x = 40; x < PAGE_W; x += 40) for (let y = 40; y < PAGE_H; y += 40) {
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (paper === 'kraft') {
    // 牛皮紙的細小纖維感（固定亂數，每次畫都一樣）
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(120,80,40,.10)' : 'rgba(255,255,255,.12)';
      ctx.fillRect(rnd() * PAGE_W, rnd() * PAGE_H, 1 + rnd() * 5, 1 + rnd() * 1.6);
    }
  }
  ctx.restore();
}

/* ---------- 筆跡 ---------- */
// stroke = { tool: 'pen'|'brush'|'highlighter'|'eraser', color, size, opacity, points: [[x,y,p],...] }
function radiusAt(stroke, p) {
  const r = stroke.size / 2;
  switch (stroke.tool) {
    case 'pen': return r * (0.3 + 0.9 * Math.pow(p, 0.8));
    case 'brush': return r * (0.35 + 0.85 * p);
    default: return r; // 螢光筆、橡皮擦：固定粗細
  }
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

// 把一條筆跡轉成「一個形狀」（很多圓 + 連接的四邊形），一次填色
// 好處：半透明的螢光筆/水彩筆自己重疊的地方不會變深
export function strokePath(stroke) {
  const pts = stroke.points;
  const path = new Path2D();
  if (!pts.length) return path;
  // 平滑壓力
  const rs = [];
  let prev = null;
  for (const [, , p] of pts) {
    const r = radiusAt(stroke, p);
    prev = prev == null ? r : prev * 0.6 + r * 0.4;
    rs.push(prev);
  }
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const r = rs[i];
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
    if (i > 0) {
      const [ax, ay] = pts[i - 1];
      const ra = rs[i - 1];
      const dx = x - ax, dy = y - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = -dy / len, ny = dx / len;
      let quad = [
        [ax + nx * ra, ay + ny * ra], [x + nx * r, y + ny * r],
        [x - nx * r, y - ny * r], [ax - nx * ra, ay - ny * ra],
      ];
      // 讓每個形狀的方向一致，避免重疊處變成破洞
      if (signedArea(quad) < 0) quad = quad.reverse();
      path.moveTo(quad[0][0], quad[0][1]);
      for (let k = 1; k < 4; k++) path.lineTo(quad[k][0], quad[k][1]);
      path.closePath();
    }
  }
  return path;
}

export function drawStroke(ctx, stroke) {
  ctx.save();
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.tool === 'pen' ? 1 : (stroke.opacity ?? 1);
  }
  ctx.fill(strokePath(stroke), 'nonzero');
  ctx.restore();
}

export function drawStrokes(ctx, strokes) {
  for (const s of strokes) drawStroke(ctx, s);
}

// 判斷點是否碰到筆跡（整筆擦用）
export function hitStroke(stroke, x, y, radius) {
  const pts = stroke.points;
  const tol = radius + stroke.size / 2;
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    if (Math.hypot(px - x, py - y) < tol) return true;
    if (i > 0) {
      const [ax, ay] = pts[i - 1];
      const dx = px - ax, dy = py - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < tol) return true;
      }
    }
  }
  return false;
}

/* ---------- 紙膠帶 ---------- */
export function tapePatternCanvas(tapeId, scale = 1) {
  const t = TAPES.find(t => t.id === tapeId) || TAPES[0];
  const s = Math.max(8, Math.round(24 * scale));
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = t.b; g.fillRect(0, 0, s, s);
  g.fillStyle = t.a;
  if (t.pattern === 'stripe') {
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s / 2, 0); g.lineTo(0, s / 2); g.closePath();
    g.moveTo(s, 0); g.lineTo(s, s / 2); g.lineTo(s / 2, s); g.lineTo(0, s); g.closePath();
    g.fill();
  } else if (t.pattern === 'dot') {
    g.beginPath(); g.arc(s / 2, s / 2, s / 5, 0, Math.PI * 2); g.fill();
  } else if (t.pattern === 'grid') {
    g.fillRect(0, 0, s, s / 6); g.fillRect(0, 0, s / 6, s);
  } else {
    g.fillRect(0, 0, s, s);
  }
  return c;
}

export function tapeOutline(w, h) {
  // 兩端鋸齒，像手撕的樣子
  const pts = [];
  const teeth = Math.max(3, Math.round(h / 12));
  pts.push([0, 0], [w, 0]);
  for (let i = 1; i <= teeth; i++) pts.push([w - (i % 2 ? 6 : 0), (h * i) / teeth]);
  pts.push([0, h]);
  for (let i = teeth - 1; i >= 1; i--) pts.push([(i % 2 ? 6 : 0), (h * i) / teeth]);
  return pts;
}

/* ---------- 圖片載入 ---------- */
const imgCache = new Map();
export function loadImage(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  imgCache.set(src, p);
  if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
  return p;
}

function drawCover(ctx, im, x, y, w, h) {
  const ir = im.width / im.height, br = w / h;
  let sx = 0, sy = 0, sw = im.width, sh = im.height;
  if (ir > br) { sw = im.height * br; sx = (im.width - sw) / 2; }
  else { sh = im.width / br; sy = (im.height - sh) / 2; }
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
}

function drawContain(ctx, im, x, y, w, h) {
  const s = Math.min(w / im.width, h / im.height);
  const dw = im.width * s, dh = im.height * s;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

export const FONTS = {
  hand: '"Kaiti TC","BiauKai","STKaiti","DFKai-SB",serif',
  round: '"Yuanti TC","PingFang TC","Microsoft JhengHei",sans-serif',
  sans: '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif',
  serif: '"Songti TC","Noto Serif TC","PMingLiU",serif',
};

/* ---------- 單一物件畫到 canvas ---------- */
export async function drawItem(ctx, it) {
  ctx.save();
  ctx.translate(it.x, it.y);
  ctx.rotate((it.rot || 0) * Math.PI / 180);
  const w = it.w, h = it.h, x = -w / 2, y = -h / 2;
  if (it.type === 'photo') {
    const im = await loadImage(it.src);
    ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    if (it.frame === 'polaroid') {
      const pad = w * 0.05;
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
      ctx.shadowColor = 'transparent';
      if (im) drawCover(ctx, im, x + pad, y + pad, w - pad * 2, h - pad - w * 0.18);
      if (it.caption) {
        ctx.fillStyle = '#4a4046';
        ctx.font = `${Math.round(w * 0.07)}px ${FONTS.hand}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.caption, 0, y + h - w * 0.09, w - pad * 2);
      }
    } else if (it.frame === 'round') {
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      if (im) drawCover(ctx, im, x, y, w, h);
    } else if (it.frame === 'stamp') {
      // 郵票齒孔邊
      const r = Math.max(4, w * 0.025);
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
      ctx.shadowColor = 'transparent';
      ctx.globalCompositeOperation = 'destination-out';
      for (let px = x; px <= x + w; px += r * 3) { ctx.beginPath(); ctx.arc(px, y, r, 0, 7); ctx.arc(px, y + h, r, 0, 7); ctx.fill(); }
      for (let py = y; py <= y + h; py += r * 3) { ctx.beginPath(); ctx.arc(x, py, r, 0, 7); ctx.arc(x + w, py, r, 0, 7); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
      if (im) drawCover(ctx, im, x + r * 2.2, y + r * 2.2, w - r * 4.4, h - r * 4.4);
    } else {
      if (im) drawCover(ctx, im, x, y, w, h);
    }
  } else if (it.type === 'sticker') {
    const im = await loadImage(it.src);
    if (it.outline) { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
    if (im) drawContain(ctx, im, x, y, w, h);
  } else if (it.type === 'emoji') {
    ctx.font = `${Math.round(h * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.text, 0, h * 0.04);
  } else if (it.type === 'text') {
    const size = it.size || 40;
    ctx.font = `${it.bold ? '700 ' : ''}${size}px ${FONTS[it.font] || FONTS.hand}`;
    ctx.fillStyle = it.color || '#3b3036';
    ctx.textBaseline = 'top';
    ctx.textAlign = it.align || 'left';
    const tx = it.align === 'center' ? 0 : x;
    const lines = wrapText(ctx, it.text || '', w);
    lines.forEach((ln, i) => ctx.fillText(ln, tx, y + i * size * 1.35));
  } else if (it.type === 'tape') {
    const pts = tapeOutline(w, h);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ctx.createPattern(tapePatternCanvas(it.tape), 'repeat');
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- 整頁畫成圖片 ---------- */
export async function renderPage(page, width = PAGE_W) {
  const scale = width / PAGE_W;
  const c = document.createElement('canvas');
  c.width = Math.round(PAGE_W * scale);
  c.height = Math.round(PAGE_H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  drawPaper(ctx, page.paper);
  for (const it of page.items || []) await drawItem(ctx, it);
  // 筆跡畫在獨立圖層，橡皮擦只擦筆跡
  const ink = document.createElement('canvas');
  ink.width = c.width; ink.height = c.height;
  const ictx = ink.getContext('2d');
  ictx.scale(scale, scale);
  drawStrokes(ictx, page.strokes || []);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ink, 0, 0);
  return c;
}

export async function makeThumb(page) {
  const c = await renderPage(page, 300);
  return c.toDataURL('image/jpeg', 0.75);
}

/* ---------- 圖片處理 ---------- */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// 照片縮小（省空間），回傳 { src, w, h }
export async function shrinkImage(file, max = 1600, type = 'image/jpeg') {
  const url = await fileToDataURL(file);
  const im = await loadImage(url);
  if (!im) throw new Error('讀不到這張圖片');
  const s = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas');
  c.width = Math.round(im.width * s);
  c.height = Math.round(im.height * s);
  const g = c.getContext('2d');
  if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(im, 0, 0, c.width, c.height);
  return { src: c.toDataURL(type, 0.85), w: c.width, h: c.height, canvas: c };
}

// 印章去白底：把接近白色（紙）的地方變透明，只留下墨水
export function removeWhite(srcCanvas, threshold = 200, tint = null) {
  const c = document.createElement('canvas');
  c.width = srcCanvas.width; c.height = srcCanvas.height;
  const g = c.getContext('2d');
  g.drawImage(srcCanvas, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  const soft = 40;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let i = 0; i < a.length; i += 4) {
    const lum = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    let alpha;
    if (lum >= threshold) alpha = 0;
    else if (lum > threshold - soft) alpha = (threshold - lum) / soft;
    else alpha = 1;
    a[i + 3] = Math.round(a[i + 3] * alpha);
    if (tint && alpha > 0) { a[i] = tint[0]; a[i + 1] = tint[1]; a[i + 2] = tint[2]; }
    if (a[i + 3] > 20) {
      const p = i / 4, px = p % c.width, py = (p / c.width) | 0;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
  }
  g.putImageData(d, 0, 0);
  if (maxX <= minX || maxY <= minY) return c;
  // 自動裁掉四周空白
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
