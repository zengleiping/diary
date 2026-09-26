// 小工具：彈出面板、提示訊息、選檔案
const backdrop = () => document.getElementById('sheetBackdrop');
const sheetEl = () => document.getElementById('sheet');
let onCloseCb = null;

export function openSheet(html, { onClose } = {}) {
  const body = document.getElementById('sheetBody');
  body.innerHTML = html;
  body.scrollTop = 0;
  backdrop().classList.remove('hidden');
  sheetEl().classList.remove('hidden');
  onCloseCb = onClose || null;
  return body;
}

export function closeSheet() {
  backdrop().classList.add('hidden');
  sheetEl().classList.add('hidden');
  document.getElementById('sheetBody').innerHTML = '';
  const cb = onCloseCb; onCloseCb = null;
  if (cb) cb();
}

export function initSheet() {
  backdrop().addEventListener('click', closeSheet);
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 開啟選檔視窗（iPhone/iPad 會出現「照片圖庫 / 拍照 / 選擇檔案」）
export function pickFiles({ accept = 'image/*', multiple = false, capture = null } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', capture);
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      resolve(Array.from(inp.files || []));
      inp.remove();
    });
    inp.click();
  });
}

export function confirmSheet(message, okText = '確定', danger = true) {
  return new Promise(resolve => {
    let done = false;
    const body = openSheet(`
      <h3>${esc(message)}</h3>
      <div class="actions">
        <button class="pill-btn ghost" data-a="no">取消</button>
        <button class="pill-btn" data-a="yes" ${danger ? 'style="background:#e0445e;box-shadow:0 3px 0 #b8324a"' : ''}>${esc(okText)}</button>
      </div>`, { onClose: () => { if (!done) resolve(false); } });
    body.querySelector('[data-a=yes]').onclick = () => { done = true; closeSheet(); resolve(true); };
    body.querySelector('[data-a=no]').onclick = () => { done = true; closeSheet(); resolve(false); };
  });
}

// 分享或下載檔案（iPhone 上可以直接存到「照片」或「檔案」）
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function fmtDate(s, withWeek = true) {
  const [y, m, d] = s.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return `${m}月${d}日${withWeek ? `（${WEEK[w]}）` : ''}`;
}
