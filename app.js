// 主程式：首頁、日記本、旅行、收藏冊、設定
import { db, uid, todayStr, parseDate, askPersist } from './db.js';
import { Editor, newPage, collectibleToItem, fitBox } from './editor.js';
import { shrinkImage, removeWhite, makeThumb, PAGE_H } from './render.js';
import { PROMPTS, MOODS, BUILTIN_STICKERS } from './stickers.js';
import { sync, errText } from './sync.js';
import { openSheet, closeSheet, initSheet, toast, esc, pickFiles, confirmSheet, shareOrDownload, fmtDate, WEEK } from './ui.js';

const $ = id => document.getElementById(id);

const KINDS = {
  stamp: { label: '紀念章', icon: '🔴' },
  receipt: { label: '收據發票', icon: '🧾' },
  ticket: { label: '票根', icon: '🎫' },
  other: { label: '其他', icon: '📦' },
};
const TRIP_EMOJI = ['✈️', '🏝️', '⛰️', '🏯', '🗼', '🚄', '🌸', '🍜', '🏖️', '🎡', '🗺️', '🧳'];

const app = {
  view: 'home',
  month: new Date(),
  trip: null,
  tripTab: 'album',
  colFilter: 'all',
  lastView: 'home',

  show(v) {
    for (const s of document.querySelectorAll('.view')) s.classList.toggle('hidden', s.id !== 'view-' + v);
    if (v !== 'editor') {
      this.view = v;
      const tabFor = v === 'trip' ? 'trips' : v;
      for (const b of $('tabbar').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === tabFor);
    }
  },

  async go(v) {
    this.show(v);
    if (v === 'home') await this.renderHome();
    if (v === 'book') await this.renderBook();
    if (v === 'trips') await this.renderTrips();
    if (v === 'trip') await this.renderTrip();
    if (v === 'settings') await this.renderSettings();
  },

  /* ---------- 開啟/關閉編輯器 ---------- */
  async openPage(page, opts) {
    this.lastView = this.view;
    await this.editor.open(page, opts);
  },
  async closeEditor() {
    await this.editor.close();
    sync.schedulePush(300);
    this.afterEditorClosed();
  },
  afterEditorClosed() {
    document.body.classList.remove('editing');
    this.go(this.lastView || 'home');
  },

  /* ---------- 共用資料 ---------- */
  async pages() {
    const all = await db.all('pages');
    all.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    return all;
  },

  // 自動產生、還沒動過的頁面（例如旅行每日頁）不算「寫過」
  isWritten(p) { return (p.strokes && p.strokes.length) || (p.items && p.items.length > (p.autoCount || 0)); },

  streak(pages) {
    const days = new Set(pages.filter(p => this.isWritten(p)).map(p => p.date));
    const d = new Date();
    if (!days.has(todayStr(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(todayStr(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },

  thumbHTML(p, cap) {
    return `<button class="thumb" data-page="${p.id}">
      <div class="img" style="${p.thumb ? `background-image:url(${p.thumb})` : ''}">${p.mood ? `<span class="mood">${p.mood}</span>` : ''}</div>
      <div class="cap">${esc(cap ?? (fmtDate(p.date) + (p.title ? ' ' + p.title : '')))}</div>
    </button>`;
  },

  bindThumbs(container) {
    container.onclick = async e => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      const p = await db.get('pages', b.dataset.page);
      if (p) this.openPage(p);
    };
  },

  async tripForDate(date) {
    const trips = await db.all('trips');
    return trips.find(t => t.start && t.end && t.start <= date && date <= t.end) || null;
  },

  async openDate(date) {
    const pages = (await db.byIndex('pages', 'date', date));
    if (pages.length === 0) {
      const trip = await this.tripForDate(date);
      const p = newPage(date, { tripId: trip ? trip.id : null });
      await db.put('pages', p);
      return this.openPage(p);
    }
    if (pages.length === 1) return this.openPage(pages[0]);
    const body = openSheet(`<h3>${fmtDate(date)} 的頁面</h3>
      <div class="thumb-grid">${pages.map(p => this.thumbHTML(p, p.title || '（沒有標題）')).join('')}</div>
      <div class="actions"><button class="pill-btn" data-a="new">＋ 再新增一頁</button></div>`);
    body.onclick = async e => {
      const t = e.target.closest('[data-page]');
      if (t) { closeSheet(); return this.openPage(pages.find(p => p.id === t.dataset.page)); }
      if (e.target.closest('[data-a=new]')) {
        closeSheet();
        const trip = await this.tripForDate(date);
        const p = newPage(date, { tripId: trip ? trip.id : null });
        await db.put('pages', p);
        this.openPage(p);
      }
    };
  },

  /* ================= 首頁 ================= */
  async renderHome() {
    const now = new Date();
    const h = now.getHours();
    $('hello').textContent = h < 11 ? '早安 ☀️' : h < 18 ? '午安 🌤️' : '晚安 🌙';
    $('todayLabel').textContent = `${now.getFullYear()}年 ${fmtDate(todayStr())}`;

    const pages = await this.pages();
    const streak = this.streak(pages);
    $('streak').innerHTML = `🔥 <b>${streak}</b> 天`;

    const today = todayStr();
    const todays = pages.filter(p => p.date === today && this.isWritten(p));
    const card = $('todayCard');
    if (!todays.length) {
      card.innerHTML = `
        <h2>今天還沒寫喔 ✏️</h2>
        <p>${streak ? `已經連續 ${streak} 天了，別讓火熄掉！` : '不用寫很多，一句話也算數！'}</p>
        <div class="quick-btns">
          <button data-q="line"><b>⚡</b><span>一句話日記</span></button>
          <button data-q="photo"><b>📷</b><span>放一張照片</span></button>
          <button data-q="page"><b>✏️</b><span>手寫一整頁</span></button>
        </div>`;
    } else {
      const p = todays[0];
      card.innerHTML = `
        <div class="today-done">
          ${p.thumb ? `<img src="${p.thumb}" alt="">` : '<div style="font-size:48px">📔</div>'}
          <div>
            <h2>今天寫好了！🎉</h2>
            <p>${streak >= 2 ? `連續 ${streak} 天，好棒！` : '明天也來寫一句吧～'}</p>
            <div class="row"><button class="pill-btn small" data-q="open">繼續裝飾</button><button class="pill-btn small ghost" data-q="line">再記一句</button></div>
          </div>
        </div>`;
    }
    card.onclick = async e => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      const q = b.dataset.q;
      if (q === 'line') this.quickSheet();
      if (q === 'photo') {
        const files = await pickFiles({ accept: 'image/*', multiple: true });
        if (files.length) this.quickSheet(files.slice(0, 3));
      }
      if (q === 'page' || q === 'open') this.openDate(today);
    };

    this.showPrompt();
    $('promptNext').onclick = () => this.showPrompt();

    // 回憶：去年的今天 / 上個月的今天
    const mem = $('memoryCard');
    const ly = new Date(now); ly.setFullYear(ly.getFullYear() - 1);
    const lm = new Date(now); lm.setMonth(lm.getMonth() - 1);
    const found = pages.find(p => p.date === todayStr(ly)) ? ['一年前的今天', pages.find(p => p.date === todayStr(ly))]
      : pages.find(p => p.date === todayStr(lm)) ? ['一個月前的今天', pages.find(p => p.date === todayStr(lm))] : null;
    if (found) {
      const [label, p] = found;
      mem.classList.remove('hidden');
      mem.innerHTML = `${p.thumb ? `<img src="${p.thumb}" alt="">` : ''}<div><div class="card-title">🕰️ ${label}</div><div class="muted">${fmtDate(p.date)} ${esc(p.title || '')} ${p.mood || ''}</div></div>`;
      mem.onclick = () => this.openPage(p);
    } else mem.classList.add('hidden');

    // 備份提醒
    const last = await db.getSetting('lastBackup', 0);
    if (pages.length >= 5 && Date.now() - last > 30 * 864e5 && !this.backupNagged) {
      this.backupNagged = true;
      setTimeout(() => toast('好久沒備份了，記得到「設定」匯出備份檔喔 💾', 3500), 1200);
    } else if (!todays.length && h >= 20 && !this.eveningNagged) {
      this.eveningNagged = true;
      setTimeout(() => toast('今天還沒寫日記喔～一句話就好！', 3000), 800);
    }

    const recent = pages.filter(p => this.isWritten(p)).slice(0, 8);
    $('recentGrid').innerHTML = recent.map(p => this.thumbHTML(p)).join('') ||
      '<div class="empty">還沒有任何頁面。<br>按上面的「一句話日記」開始第一天吧！</div>';
    this.bindThumbs($('recentGrid'));
  },

  showPrompt() {
    let i;
    do { i = Math.floor(Math.random() * PROMPTS.length); } while (i === this.promptIdx && PROMPTS.length > 1);
    this.promptIdx = i;
    $('promptText').textContent = PROMPTS[i];
  },

  /* ---------- 懶人：一句話日記 ---------- */
  quickSheet(presetFiles = []) {
    const st = { mood: '', files: presetFiles };
    const body = openSheet(`
      <h3>⚡ 一句話日記</h3>
      <div class="mood-row" id="qMood">${MOODS.map(m => `<button data-m="${m}">${m}</button>`).join('')}</div>
      <label class="field"><span>今天…</span><textarea id="qText" placeholder="${esc(PROMPTS[this.promptIdx ?? 0])}"></textarea></label>
      <button class="pill-btn ghost small" id="qPhoto">📷 加照片（最多 3 張）</button>
      <div class="photo-preview" id="qPrev"></div>
      <div class="actions"><button class="pill-btn" id="qSave">存起來 ✨</button></div>`);
    const prev = () => {
      const box = body.querySelector('#qPrev');
      box.innerHTML = '';
      for (const f of st.files) { const im = new Image(); im.src = URL.createObjectURL(f); box.appendChild(im); }
    };
    prev();
    body.querySelector('#qMood').onclick = e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      st.mood = st.mood === b.dataset.m ? '' : b.dataset.m;
      body.querySelectorAll('#qMood button').forEach(x => x.classList.toggle('on', x.dataset.m === st.mood));
    };
    body.querySelector('#qPhoto').onclick = async () => {
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      st.files = [...st.files, ...files].slice(0, 3);
      prev();
    };
    body.querySelector('#qSave').onclick = async () => {
      const text = body.querySelector('#qText').value.trim();
      if (!text && !st.files.length && !st.mood) { toast('寫一個字、選個心情或放張照片就好～'); return; }
      body.querySelector('#qSave').disabled = true;
      await this.saveQuick({ text, mood: st.mood, files: st.files });
      closeSheet();
      const pages = await this.pages();
      const n = this.streak(pages);
      toast(n >= 2 ? `記好了！連續 ${n} 天 🔥` : '記好了！明天見 👋');
      this.renderHome();
    };
  },

  async saveQuick({ text, mood, files }) {
    const date = todayStr();
    const photos = [];
    for (const f of files) { try { photos.push(await shrinkImage(f, 1400)); } catch (e) { /* 略過 */ } }

    // 先算需要多高
    const blocks = [];
    if (photos.length === 1) {
      const W = 520, pad = W * 0.05, a = photos[0].w / photos[0].h;
      blocks.push({ h: Math.min(700, (W - pad * 2) / a + pad + W * 0.18), kind: 'photo1' });
    } else if (photos.length > 1) {
      blocks.push({ h: 420, kind: 'photoN' });
    }
    const lines = text ? text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(Array.from(l).length * 46 / 820)), 0) : 0;
    const textH = lines * 46 * 1.35;
    const needed = blocks.reduce((s, b) => s + b.h + 40, 0) + (text ? textH + 60 : 0) + (mood && !photos.length && !text ? 140 : 0);

    const trip = await this.tripForDate(date);
    let page = (await db.byIndex('pages', 'date', date))[0];
    let y;
    const fresh = () => {
      page = newPage(date, { mood, tripId: trip ? trip.id : null, paper: 'lines' });
      page.items.push(
        { id: uid(), type: 'tape', tape: 'pink-stripe', x: 160, y: 72, w: 220, h: 50, rot: -10 },
        { id: uid(), type: 'text', text: `${fmtDate(date)}`, font: 'hand', size: 60, color: '#3b3036', bold: true, x: 400, y: 120, w: 640, h: 82, rot: 0 },
      );
      if (mood) page.items.push({ id: uid(), type: 'emoji', text: mood, x: 870, y: 115, w: 140, h: 140, rot: 0 });
      y = 220;
    };
    if (!page) fresh();
    else {
      if (mood && !page.mood) page.mood = mood;
      y = Math.max(220, ...page.items.map(i => i.y + i.h / 2 + 30));
      if (y + needed > PAGE_H - 30) fresh();
    }

    if (photos.length === 1) {
      const p = photos[0], W = 520, pad = W * 0.05, a = p.w / p.h;
      const h = Math.round((W - pad * 2) / a + pad + W * 0.18);
      const s = h > 700 ? 700 / h : 1;
      page.items.push({ id: uid(), type: 'photo', src: p.src, aspect: a, frame: 'polaroid', x: 500, y: y + (h * s) / 2, w: Math.round(W * s), h: Math.round(h * s), rot: Math.round(Math.random() * 8 - 4) });
      y += h * s + 40;
    } else if (photos.length > 1) {
      const xs = photos.length === 2 ? [300, 700] : [200, 500, 800];
      photos.forEach((p, i) => {
        const a = p.w / p.h, W = photos.length === 2 ? 360 : 290, pad = W * 0.05;
        let h = (W - pad * 2) / a + pad + W * 0.18;
        const s = h > 400 ? 400 / h : 1;
        page.items.push({ id: uid(), type: 'photo', src: p.src, aspect: a, frame: 'polaroid', x: xs[i], y: y + 200, w: Math.round(W * s), h: Math.round(h * s), rot: [-5, 4, -2][i] });
      });
      y += 440;
    }
    if (text) {
      page.items.push({ id: uid(), type: 'text', text, font: 'hand', size: 46, color: '#3b3036', align: 'left', x: 500, y: y + textH / 2, w: 840, h: Math.ceil(textH), rot: 0 });
      y += textH + 40;
    }
    if (mood && !text && !photos.length) {
      page.items.push({ id: uid(), type: 'emoji', text: mood, x: 500, y: y + 70, w: 140, h: 140, rot: 0 });
    }
    page.updatedAt = Date.now();
    page.thumb = await makeThumb(page);
    await db.put('pages', page);
  },

  /* ================= 日記本（月曆） ================= */
  async renderBook() {
    const m = this.month;
    const y = m.getFullYear(), mo = m.getMonth();
    $('monthTitle').textContent = `${y}年 ${mo + 1}月`;
    const pages = await this.pages();
    const trips = await db.all('trips');
    const prefix = `${y}-${String(mo + 1).padStart(2, '0')}`;
    const monthPages = pages.filter(p => p.date.startsWith(prefix));
    const byDate = {};
    for (const p of monthPages) (byDate[p.date] ||= []).push(p);

    let html = WEEK.map(w => `<div class="dow">${w}</div>`).join('');
    const first = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    for (let i = 0; i < first; i++) html += `<div class="day blank"></div>`;
    const today = todayStr();
    for (let d = 1; d <= days; d++) {
      const ds = `${prefix}-${String(d).padStart(2, '0')}`;
      const ps = (byDate[ds] || []).filter(p => this.isWritten(p));
      const mood = ps.find(p => p.mood)?.mood;
      const inTrip = trips.some(t => t.start && t.end && t.start <= ds && ds <= t.end);
      html += `<button class="day ${ps.length ? 'has' : ''} ${ds === today ? 'today' : ''}" data-date="${ds}">
        <span class="n">${d}</span>${ps.length ? `<span class="m">${mood || '✏️'}</span>` : ''}${inTrip ? '<span class="trip-dot">✈️</span>' : ''}</button>`;
    }
    $('calendar').innerHTML = html;
    $('calendar').onclick = e => {
      const b = e.target.closest('[data-date]');
      if (b) this.openDate(b.dataset.date);
    };
    const written = monthPages.filter(p => this.isWritten(p));
    $('monthGrid').innerHTML = written.map(p => this.thumbHTML(p)).join('') || '<div class="empty">這個月還沒有頁面，點月曆上的日期就能開始寫。</div>';
    this.bindThumbs($('monthGrid'));
  },

  /* ================= 旅行 ================= */
  async renderTrips() {
    const trips = await db.all('trips');
    trips.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const cols = await db.all('collectibles');
    const pages = await db.all('pages');
    $('tripList').innerHTML = trips.map(t => {
      const nc = cols.filter(c => c.tripId === t.id).length;
      const np = pages.filter(p => p.tripId === t.id && this.isWritten(p)).length;
      return `<button class="trip-card" data-trip="${t.id}">
        <div class="cover" ${t.coverSrc ? `style="background-image:url(${t.coverSrc})"` : ''}>${t.coverSrc ? '' : (t.emoji || '✈️')}</div>
        <div class="info"><div class="name">${esc(t.name)}</div>
        <div class="meta">${esc(t.place || '')} ${t.start ? '· ' + t.start.replace(/-/g, '/') + (t.end && t.end !== t.start ? ' – ' + t.end.slice(5).replace('-', '/') : '') : ''}</div>
        <div class="meta">🏷️ ${nc} 個收藏 · 📔 ${np} 頁</div></div>
      </button>`;
    }).join('') || '<div class="empty">還沒有旅行紀錄。<br>出發前先建一趟旅行，沿路拍下紀念章、收據、車票，就不怕弄丟了！</div>';
    $('tripList').onclick = async e => {
      const b = e.target.closest('[data-trip]');
      if (!b) return;
      this.trip = await db.get('trips', b.dataset.trip);
      this.tripTab = 'album';
      this.colFilter = 'all';
      this.go('trip');
    };
  },

  tripSheet(trip = null) {
    const t = trip || { name: '', place: '', start: todayStr(), end: todayStr(), emoji: '✈️' };
    const body = openSheet(`
      <h3>${trip ? '編輯旅行' : '新的旅行 ✈️'}</h3>
      <label class="field"><span>旅行名稱</span><input type="text" id="tName" value="${esc(t.name)}" placeholder="例如：京都賞楓五日遊"></label>
      <label class="field"><span>地點</span><input type="text" id="tPlace" value="${esc(t.place || '')}" placeholder="例如：日本京都"></label>
      <div class="row">
        <label class="field" style="flex:1"><span>出發</span><input type="date" id="tStart" value="${t.start || ''}"></label>
        <label class="field" style="flex:1"><span>回家</span><input type="date" id="tEnd" value="${t.end || ''}"></label>
      </div>
      <div class="field"><span>封面圖案</span><div class="mood-row" id="tEmoji">${TRIP_EMOJI.map(e => `<button data-e="${e}" class="${t.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>
      <div class="actions">
        ${trip ? '<button class="pill-btn ghost" data-a="del" style="margin-right:auto;color:#e0445e">刪除旅行</button>' : ''}
        <button class="pill-btn" data-a="ok">${trip ? '儲存' : '建立'}</button>
      </div>`);
    let emoji = t.emoji;
    body.querySelector('#tEmoji').onclick = e => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      emoji = b.dataset.e;
      body.querySelectorAll('#tEmoji button').forEach(x => x.classList.toggle('on', x === b));
    };
    body.querySelector('[data-a=ok]').onclick = async () => {
      const name = body.querySelector('#tName').value.trim();
      if (!name) { toast('幫這趟旅行取個名字吧'); return; }
      let start = body.querySelector('#tStart').value, end = body.querySelector('#tEnd').value || start;
      if (end < start) [start, end] = [end, start];
      const obj = { ...(trip || { id: uid(), createdAt: Date.now() }), name, place: body.querySelector('#tPlace').value.trim(), start, end, emoji };
      await db.put('trips', obj);
      closeSheet();
      this.trip = obj;
      this.go('trip');
    };
    const del = body.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      closeSheet();
      if (!(await confirmSheet(`刪除「${trip.name}」？收藏冊裡的東西也會一起刪掉（日記頁會保留）`, '刪除'))) return;
      for (const c of await db.byIndex('collectibles', 'tripId', trip.id)) await db.del('collectibles', c.id);
      for (const p of await db.byIndex('pages', 'tripId', trip.id)) { p.tripId = null; await db.put('pages', p); }
      await db.del('trips', trip.id);
      this.go('trips');
    };
  },

  async renderTrip() {
    const t = this.trip = await db.get('trips', this.trip.id);
    if (!t) return this.go('trips');
    $('tripTitle').textContent = `${t.emoji || '✈️'} ${t.name}`;
    const cols = await db.byIndex('collectibles', 'tripId', t.id);
    const pages = (await db.byIndex('pages', 'tripId', t.id)).sort((a, b) => a.date.localeCompare(b.date));
    const days = t.start && t.end ? Math.round((parseDate(t.end) - parseDate(t.start)) / 864e5) + 1 : 0;
    const cnt = k => cols.filter(c => c.kind === k).length;
    $('tripHero').innerHTML = `
      <div class="place">📍 ${esc(t.place || '（沒填地點）')}　🗓️ ${t.start ? t.start.replace(/-/g, '/') : ''}${t.end && t.end !== t.start ? ' – ' + t.end.replace(/-/g, '/') : ''}</div>
      <div class="stats">
        <div class="stat"><b>${days}</b> 天</div>
        <div class="stat">🔴 <b>${cnt('stamp')}</b> 個章</div>
        <div class="stat">🧾 <b>${cnt('receipt')}</b> 張收據</div>
        <div class="stat">🎫 <b>${cnt('ticket')}</b> 張票根</div>
        <div class="stat">📔 <b>${pages.filter(p => this.isWritten(p)).length}</b> 頁日記</div>
      </div>`;

    for (const b of $('tripTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tripTab);
    $('tripAlbum').classList.toggle('hidden', this.tripTab !== 'album');
    $('tripPages').classList.toggle('hidden', this.tripTab !== 'pages');

    // 收藏冊
    const f = this.colFilter;
    $('colFilter').innerHTML = [['all', '全部'], ...Object.entries(KINDS).map(([k, v]) => [k, v.icon + ' ' + v.label])]
      .map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('');
    const shown = cols.filter(c => f === 'all' || c.kind === f).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt - b.createdAt));
    $('albumGrid').innerHTML = shown.map(c => `
      <button class="col-item kind-${c.kind}" data-col="${c.id}">
        <div class="pic" style="background-image:url(${c.src})"></div>
        <div class="t">${esc(c.name || KINDS[c.kind]?.label || '')}</div>
        <div class="s">${c.date ? c.date.slice(5).replace('-', '/') : ''} ${esc(c.place || '')}</div>
      </button>`).join('') || `<div class="empty">收藏冊還是空的。<br>看到紀念章，蓋在任何一張紙上，再拍下來——<br>App 會幫你去掉白紙，只留下印章 ✨</div>`;

    // 旅行日記頁
    $('tripPageGrid').innerHTML = pages.map(p => this.thumbHTML(p)).join('') || '<div class="empty">還沒有旅行日記頁。</div>';
    this.bindThumbs($('tripPageGrid'));
  },

  /* ---------- 收藏：新增 ---------- */
  async addCollectible() {
    const files = await pickFiles({ accept: 'image/*' });
    if (!files.length) return;
    let shrunk;
    try { shrunk = await shrinkImage(files[0], 1400); } catch (e) { toast('讀不到這張圖片'); return; }
    const t = this.trip;
    const td = todayStr();
    const defDate = t.start && t.end && t.start <= td && td <= t.end ? td : (t.start || td);
    const st = { kind: 'stamp', cut: true, th: 185, tint: null };
    const tints = [['原色', null], ['紅', [214, 48, 70]], ['藍', [40, 90, 190]], ['綠', [30, 130, 80]], ['紫', [120, 60, 170]]];
    const body = openSheet(`
      <h3>新增收藏</h3>
      <div class="chips" id="cKind">${Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}" class="${k === st.kind ? 'on' : ''}">${v.icon} ${v.label}</button>`).join('')}</div>
      <div class="stamp-preview" id="cPrev"></div>
      <div id="cStampOpts">
        <label class="switch-row"><span>去掉紙的白底，只留下印章</span><input type="checkbox" id="cCut" checked></label>
        <label class="field"><span>去背強度（印章太淡就往左、紙沒去乾淨就往右）</span><input type="range" id="cTh" min="120" max="240" value="${st.th}" style="width:100%"></label>
        <div class="field"><span>印章顏色</span><div class="ink-colors" id="cTint">${tints.map(([l, c], i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}" style="background:${c ? `rgb(${c})` : '#fff'}">${c ? '' : '原'}</button>`).join('')}</div></div>
      </div>
      <label class="field"><span>名稱</span><input type="text" id="cName" placeholder="例如：清水寺紀念章"></label>
      <div class="row">
        <label class="field" style="flex:1"><span>日期</span><input type="date" id="cDate" value="${defDate}"></label>
        <label class="field" style="flex:1"><span>地點</span><input type="text" id="cPlace" placeholder="例如：京都車站"></label>
      </div>
      <label class="field hidden" id="cAmountF"><span>金額</span><input type="text" id="cAmount" placeholder="例如：¥1,200"></label>
      <label class="field"><span>小筆記</span><textarea id="cNote" placeholder="當時發生了什麼事？" style="min-height:60px"></textarea></label>
      <div class="actions"><button class="pill-btn ghost" data-a="cancel">取消</button><button class="pill-btn" data-a="save">放進收藏冊</button></div>`);

    let out = null;
    const draw = () => {
      const prev = body.querySelector('#cPrev');
      if (st.kind === 'stamp' && st.cut) out = removeWhite(shrunk.canvas, st.th, st.tint);
      else out = null;
      const src = out ? out.toDataURL('image/png') : shrunk.src;
      prev.innerHTML = `<img src="${src}" alt="">`;
    };
    const syncKind = () => {
      body.querySelectorAll('#cKind button').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
      body.querySelector('#cStampOpts').classList.toggle('hidden', st.kind !== 'stamp');
      body.querySelector('#cAmountF').classList.toggle('hidden', st.kind !== 'receipt');
      draw();
    };
    syncKind();
    body.querySelector('#cKind').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { st.kind = b.dataset.k; syncKind(); } };
    body.querySelector('#cCut').onchange = e => { st.cut = e.target.checked; draw(); };
    let tm;
    body.querySelector('#cTh').oninput = e => { st.th = +e.target.value; clearTimeout(tm); tm = setTimeout(draw, 100); };
    body.querySelector('#cTint').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      st.tint = tints[+b.dataset.i][1];
      body.querySelectorAll('#cTint button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    };
    body.querySelector('[data-a=cancel]').onclick = closeSheet;
    body.querySelector('[data-a=save]').onclick = async () => {
      const cut = st.kind === 'stamp' && st.cut && out;
      const c = {
        id: uid(), tripId: t.id, kind: st.kind,
        src: cut ? out.toDataURL('image/png') : shrunk.src,
        w: cut ? out.width : shrunk.w, h: cut ? out.height : shrunk.h,
        cutout: !!cut,
        name: body.querySelector('#cName').value.trim(),
        date: body.querySelector('#cDate').value,
        place: body.querySelector('#cPlace').value.trim(),
        amount: body.querySelector('#cAmount').value.trim(),
        note: body.querySelector('#cNote').value.trim(),
        createdAt: Date.now(),
      };
      await db.put('collectibles', c);
      if (!t.coverSrc && c.kind !== 'receipt') { t.coverSrc = c.src; await db.put('trips', t); }
      closeSheet();
      toast('收進收藏冊了 🏷️');
      this.renderTrip();
    };
  },

  async collectibleDetail(id) {
    const c = await db.get('collectibles', id);
    if (!c) return;
    const body = openSheet(`
      <div class="col-detail">
        <img src="${c.src}" alt="">
        <h3>${KINDS[c.kind]?.icon || ''} ${esc(c.name || KINDS[c.kind]?.label || '')}</h3>
        <div class="muted">${c.date ? c.date.replace(/-/g, '/') : ''} ${esc(c.place || '')} ${c.amount ? '· ' + esc(c.amount) : ''}</div>
        ${c.note ? `<p style="white-space:pre-wrap">${esc(c.note)}</p>` : ''}
      </div>
      <div class="actions">
        <button class="pill-btn ghost" data-a="del" style="margin-right:auto;color:#e0445e">刪除</button>
        <button class="pill-btn ghost" data-a="cover">設為封面</button>
        <button class="pill-btn" data-a="paste">貼到日記頁</button>
      </div>`);
    body.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'del') {
        closeSheet();
        if (await confirmSheet('刪除這個收藏？', '刪除')) {
          await db.del('collectibles', c.id);
          const t = await db.get('trips', c.tripId);
          if (t && t.coverSrc === c.src) { delete t.coverSrc; await db.put('trips', t); }
          this.renderTrip();
        }
      }
      if (a === 'cover') {
        const t = await db.get('trips', c.tripId);
        if (t) { t.coverSrc = c.src; await db.put('trips', t); toast('已設為旅行封面'); }
        closeSheet();
      }
      if (a === 'paste') this.choosePageFor(c);
    };
  },

  async choosePageFor(c) {
    const pages = (await db.byIndex('pages', 'tripId', c.tripId)).sort((a, b) => a.date.localeCompare(b.date));
    const body = openSheet(`
      <h3>要貼到哪一頁？</h3>
      <div class="thumb-grid">${pages.map(p => this.thumbHTML(p)).join('')}</div>
      <div class="actions"><button class="pill-btn" data-a="new">＋ 新的一頁（${c.date ? fmtDate(c.date, false) : '今天'}）</button></div>`);
    body.onclick = async e => {
      const t = e.target.closest('[data-page]');
      const item = collectibleToItem(c);
      if (t) {
        closeSheet();
        const p = await db.get('pages', t.dataset.page);
        return this.openPage(p, { addItems: [item] });
      }
      if (e.target.closest('[data-a=new]')) {
        closeSheet();
        const p = newPage(c.date || todayStr(), { tripId: c.tripId, paper: 'kraft' });
        await db.put('pages', p);
        this.openPage(p, { addItems: [item] });
      }
    };
  },

  async tripNewPage() {
    const t = this.trip;
    const td = todayStr();
    const date = t.start && t.end && t.start <= td && td <= t.end ? td : (t.start || td);
    const p = newPage(date, { tripId: t.id, paper: 'kraft', title: t.name });
    await db.put('pages', p);
    this.openPage(p);
  },

  async tripAllDays() {
    const t = this.trip;
    if (!t.start || !t.end) return toast('先設定旅行的日期喔');
    const existing = new Set((await db.byIndex('pages', 'tripId', t.id)).map(p => p.date));
    let n = 0, i = 1;
    for (let d = parseDate(t.start); todayStr(d) <= t.end; d.setDate(d.getDate() + 1), i++) {
      const ds = todayStr(d);
      if (existing.has(ds)) continue;
      const p = newPage(ds, { tripId: t.id, paper: 'kraft', title: `${t.name} Day ${i}` });
      p.items.push(
        { id: uid(), type: 'tape', tape: 'kraft', x: 150, y: 70, w: 220, h: 50, rot: -8 },
        { id: uid(), type: 'text', text: `Day ${i}　${fmtDate(ds)}`, font: 'hand', size: 56, bold: true, color: '#3b3036', x: 470, y: 125, w: 780, h: 78, rot: 0 },
        { id: uid(), type: 'sticker', src: BUILTIN_STICKERS.find(s => s.id === 'b-plane').src, x: 890, y: 120, w: 130, h: 130, rot: 8 },
      );
      p.autoCount = p.items.length;
      p.thumb = await makeThumb(p);
      await db.put('pages', p);
      n++;
    }
    toast(n ? `建立了 ${n} 頁，每天一頁 📔` : '每一天都已經有頁面了');
    this.renderTrip();
  },

  /* ================= 設定 ================= */
  async renderSettings() {
    this.renderSyncCard();
    $('pencilOnly').checked = await db.getSetting('pencilOnly', false);
    $('remindTime').value = await db.getSetting('remindTime', '21:30');
    const last = await db.getSetting('lastBackup', 0);
    $('lastBackup').textContent = last ? `上次備份：${new Date(last).toLocaleDateString('zh-TW')}` : '還沒有備份過';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) $('storageInfo').textContent = `目前用了約 ${(est.usage / 1048576).toFixed(1)} MB`;
    } catch (e) { /* ignore */ }
  },

  reminderICS(time) {
    const [hh, mm] = time.split(':');
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const url = location.href.split('#')[0];
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QiuQiu Diary//ZH', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:qiuqiu-diary-reminder-${uid()}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${hh}${mm}00`,
      'DURATION:PT10M',
      'RRULE:FREQ=DAILY',
      'SUMMARY:✏️ 寫日記時間',
      `DESCRIPTION:一句話就好！打開球球手帳：${url}`,
      `URL:${url}`,
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:寫日記囉 ✏️', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
  },

  bindSettings() {
    $('pencilOnly').onchange = e => db.setSetting('pencilOnly', e.target.checked);
    $('remindBtn').onclick = async () => {
      const time = $('remindTime').value || '21:30';
      await db.setSetting('remindTime', time);
      const blob = new Blob([this.reminderICS(time)], { type: 'text/calendar' });
      await shareOrDownload(blob, '寫日記提醒.ics');
      toast('打開下載的檔案，按「加入行事曆」就完成了');
    };
    $('exportBtn').onclick = async () => {
      toast('正在打包…');
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      await shareOrDownload(blob, `球球手帳備份-${todayStr()}.json`);
      await db.setSetting('lastBackup', Date.now());
      this.renderSettings();
    };
    $('importBtn').onclick = () => $('importFile').click();
    $('importFile').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const replace = await confirmSheet('要「取代」這台裝置上的所有日記嗎？選取消的話會「合併」進來', '取代全部');
        await db.importAll(data, { replace });
        toast('匯入完成！');
        this.go('home');
      } catch (err) {
        toast('匯入失敗：' + (err.message || '檔案格式不對'));
      }
    };
  },

  /* ================= 雲端同步 ================= */
  syncStatusText() {
    const st = sync.status;
    if (st === 'loading') return ['syncing', '準備中…'];
    if (st === 'syncing') return ['syncing', '同步中…'];
    if (st === 'offline') return ['offline', '沒有網路，連上網會自動同步'];
    if (st === 'error') return ['error', '同步失敗：' + sync.message];
    if (st === 'ok') {
      const t = sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
      return ['ok', `已同步${t ? '（' + t + '）' : ''}`];
    }
    return ['', ''];
  },

  updateCloudBadge() {
    const b = $('cloudBadge');
    if (!sync.enabled || !sync.ready) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden', 'err');
    const icon = !sync.user ? '☁️？' : { ok: '☁️✓', syncing: '☁️…', offline: '☁️✕', error: '☁️!' }[sync.status] || '☁️';
    b.textContent = icon;
    if (sync.status === 'error' || !sync.user) b.classList.add('err');
    b.title = sync.user ? this.syncStatusText()[1] : '還沒登入雲端同步';
  },

  renderSyncCard() {
    const card = $('syncCard');
    if (!card) return;
    if (!sync.enabled) {
      card.innerHTML = `<div class="card-title">☁️ 雲端同步</div>
        <p class="muted">還沒接上 Firebase。把設定貼進 <code>js/firebase-config.js</code> 之後，Mac、iPad、iPhone 就會自動同步。</p>`;
      return;
    }
    if (!sync.ready) {
      card.innerHTML = `<div class="card-title">☁️ 雲端同步</div><p class="muted">準備中…</p>`;
      return;
    }
    if (!sync.user) {
      card.innerHTML = `<div class="card-title">☁️ 雲端同步</div>
        <p class="muted">每台裝置都用<b>同一組 Email 和密碼</b>登入，日記就會自動同步。第一次用請按「註冊」，之後的裝置按「登入」。</p>
        <form class="login-form" id="loginForm" onsubmit="return false">
          <input type="email" id="lgEmail" placeholder="Email" autocomplete="username" inputmode="email">
          <input type="password" id="lgPw" placeholder="密碼（至少 6 個字）" autocomplete="current-password">
          <div class="err" id="lgErr"></div>
          <div class="row">
            <button class="pill-btn" data-a="in">登入</button>
            <button class="pill-btn ghost" data-a="up">註冊</button>
            <button class="link-btn" data-a="reset" type="button">忘記密碼</button>
          </div>
        </form>`;
      const f = card.querySelector('#loginForm');
      f.onclick = async e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        const email = f.querySelector('#lgEmail').value.trim();
        const pw = f.querySelector('#lgPw').value;
        const errEl = f.querySelector('#lgErr');
        errEl.textContent = '';
        try {
          if (a === 'in') await sync.signIn(email, pw);
          if (a === 'up') await sync.signUp(email, pw);
          if (a === 'reset') {
            if (!email) { errEl.textContent = '先在上面輸入 Email'; return; }
            await sync.resetPassword(email);
            toast('已寄出重設密碼的信，請去收信');
          }
        } catch (err) {
          errEl.textContent = errText(err);
        }
      };
      return;
    }
    const [cls, text] = this.syncStatusText();
    card.innerHTML = `<div class="card-title">☁️ 雲端同步</div>
      <div class="sync-status"><span class="dot ${cls}"></span><span>${esc(text)}</span></div>
      <p class="muted small">已登入：${esc(sync.user.email || '')}<br>在其他裝置用同一組帳號登入，就會看到一樣的日記。</p>
      <div class="row">
        <button class="pill-btn small" data-a="now">立即同步</button>
        <button class="pill-btn small ghost" data-a="out">登出</button>
      </div>`;
    card.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'now') { sync.setStatus('syncing'); await sync.pushNow(); }
      if (a === 'out') {
        if (await confirmSheet('登出之後，這台裝置的日記還會留著，但不會再同步。確定登出？', '登出', false)) await sync.signOut();
      }
    };
  },

  refreshSoon() {
    clearTimeout(this._refreshT);
    this._refreshT = setTimeout(() => {
      if (document.body.classList.contains('editing')) return;
      if (this.view === 'home') this.renderHome();
      if (this.view === 'book') this.renderBook();
      if (this.view === 'trips') this.renderTrips();
      if (this.view === 'trip') this.renderTrip();
    }, 400);
  },

  /* ================= 啟動 ================= */
  async init() {
    initSheet();
    this.editor = new Editor(this);

    $('tabbar').onclick = e => {
      const b = e.target.closest('[data-view]');
      if (b) this.go(b.dataset.view);
    };
    $('monthPrev').onclick = () => { this.month = new Date(this.month.getFullYear(), this.month.getMonth() - 1, 1); this.renderBook(); };
    $('monthNext').onclick = () => { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 1); this.renderBook(); };
    $('newTripBtn').onclick = () => this.tripSheet();
    $('tripBack').onclick = () => this.go('trips');
    $('tripEdit').onclick = () => this.tripSheet(this.trip);
    $('tripTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { this.tripTab = b.dataset.tab; this.renderTrip(); } };
    $('colFilter').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { this.colFilter = b.dataset.f; this.renderTrip(); } };
    $('addCollectible').onclick = () => this.addCollectible();
    $('albumGrid').onclick = e => { const b = e.target.closest('[data-col]'); if (b) this.collectibleDetail(b.dataset.col); };
    $('tripNewPage').onclick = () => this.tripNewPage();
    $('tripAllDays').onclick = () => this.tripAllDays();
    this.bindSettings();

    // 回到 App 時，如果跨日了就更新首頁
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.view === 'home' && !document.body.classList.contains('editing')) this.renderHome();
    });

    // 雲端同步
    sync.isOpen = id => this.editor.page && this.editor.page.id === id;
    sync.on(type => {
      if (type === 'data') this.refreshSoon();
      this.updateCloudBadge();
      if (this.view === 'settings' && !document.activeElement?.matches('#loginForm input')) this.renderSyncCard();
    });
    $('cloudBadge').onclick = () => this.go('settings');

    await this.go('home');
    askPersist();
    sync.init();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },
};

window.qiuqiu = app; // 方便除錯
app.init();
