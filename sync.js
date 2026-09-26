// 雲端同步（Firebase）
// 做法：本機 IndexedDB 還是主要的資料來源，改了什麼就排進「待上傳清單」，
// 有網路時上傳到 Firestore；其他裝置改的東西會即時下載回來。
// 同一筆資料兩邊都改過時，以「最後修改的時間」為準。
import { db, SYNCED } from './db.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const BIG_IMAGE = 20000;      // 超過這個長度的圖片另外存，避免單筆資料太大
const MAX_DOC = 950000;       // Firestore 單筆上限約 1MB
const listeners = new Set();
let fb = null;                // Firebase 函式
let app, auth, fs;
let unsubs = [];
let pushTimer = null;
let pushing = false;
let applyChain = Promise.resolve();

export const sync = {
  enabled: !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey),
  ready: false,
  user: null,
  status: 'off',       // off | loading | signedout | syncing | ok | offline | error
  message: '',
  lastSync: 0,
  isOpen: () => false, // 編輯器正在開的頁面（由 app 設定）

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(type = 'status') { for (const fn of listeners) fn(type); },
  setStatus(status, message = '') { this.status = status; this.message = message; this.emit('status'); },

  async init() {
    if (!this.enabled) return;
    this.setStatus('loading');
    try {
      fb = await import('./vendor/firebase.js');
    } catch (e) {
      this.setStatus('error', '同步程式載入失敗');
      return;
    }
    app = fb.initializeApp(FIREBASE_CONFIG);
    auth = fb.getAuth(app);
    fs = fb.initializeFirestore(app, {});
    if (FIREBASE_CONFIG.emulator) {
      fb.connectAuthEmulator(auth, `http://${FIREBASE_CONFIG.emulator}:9099`, { disableWarnings: true });
      fb.connectFirestoreEmulator(fs, FIREBASE_CONFIG.emulator, 8080);
    }
    db.onLocalChange = (store, id) => this.enqueue(store, id);
    window.addEventListener('online', () => { if (this.user) { this.setStatus('syncing'); this.schedulePush(500); } });
    window.addEventListener('offline', () => { if (this.user) this.setStatus('offline'); });
    fb.onAuthStateChanged(auth, u => {
      this.user = u;
      this.ready = true;
      if (u) this.start();
      else { this.stop(); this.setStatus('signedout'); }
    });
  },

  /* ---------- 帳號 ---------- */
  async signIn(email, pw) { await fb.signInWithEmailAndPassword(auth, email, pw); },
  async signUp(email, pw) { await fb.createUserWithEmailAndPassword(auth, email, pw); },
  async resetPassword(email) { await fb.sendPasswordResetEmail(auth, email); },
  async signOut() { await this.pushNow(); await fb.signOut(auth); },

  /* ---------- 開始 / 停止 ---------- */
  async start() {
    const uid = this.user.uid;
    this.setStatus(navigator.onLine ? 'syncing' : 'offline');
    // 這台裝置第一次登入這個帳號：把本機所有資料排進上傳清單
    const initKey = 'syncInit:' + uid;
    if (!(await db.getSetting(initKey))) {
      for (const store of SYNCED) for (const r of await db.all(store)) await this.enqueue(store, r.id, false);
      for (const t of await db.all('tombstones')) await this.enqueue(t.store, t.id, false);
      await db.setSetting(initKey, true);
    }
    this.lastSync = await db.getSetting('lastSync:' + uid, 0);
    this.listen(uid);
    this.schedulePush(300);
  },

  stop() {
    for (const u of unsubs) u();
    unsubs = [];
  },

  /* ---------- 下載：即時接收其他裝置的變更 ---------- */
  async listen(uid) {
    this.stop();
    for (const store of SYNCED) {
      const key = `pull:${uid}:${store}`;
      const since = await db.getSetting(key, 0);
      const q = fb.query(
        fb.collection(fs, 'users', uid, store),
        fb.where('serverAt', '>', fb.Timestamp.fromMillis(since)),
      );
      const un = fb.onSnapshot(q, snap => {
        const changes = snap.docChanges().filter(c => c.type !== 'removed');
        if (!changes.length) { if (!pushing) this.markOk(); return; }
        applyChain = applyChain.then(async () => {
          let max = await db.getSetting(key, 0);
          let changed = false;
          for (const c of changes) {
            const d = c.doc.data();
            if (!d.serverAt) continue; // 自己剛寫、還沒被伺服器確認的
            max = Math.max(max, d.serverAt.toMillis());
            try { if (await this.applyRemote(store, c.doc.id, d)) changed = true; }
            catch (e) { console.warn('套用雲端資料失敗', store, c.doc.id, e); }
          }
          await db.setSetting(key, max);
          if (changed) this.emit('data');
          if (!pushing) this.markOk();
        });
      }, err => {
        console.warn('同步監聽錯誤', err);
        this.setStatus('error', errText(err));
      });
      unsubs.push(un);
    }
  },

  async applyRemote(store, id, d) {
    const local = await db.get(store, id);
    const tomb = await db.get('tombstones', store + ':' + id);
    const localTime = local ? (local.updatedAt || 0) : (tomb ? tomb.deletedAt : 0);
    if ((d.updatedAt || 0) <= localTime) return false;
    if (store === 'pages' && this.isOpen(id)) return false; // 正在編輯的頁面先不動
    if (d.deleted) {
      if (local) await db.del(store, id, { fromSync: true });
      return !!local;
    }
    const rec = JSON.parse(await unpack(d.v));
    await this.resolveImages(rec, local);
    await db.put(store, rec, { fromSync: true });
    return true;
  },

  /* ---------- 上傳 ---------- */
  async enqueue(store, id, schedule = true) {
    await db.put('outbox', { key: store + ':' + id, store, id, ver: Date.now() + Math.random() });
    if (schedule) this.schedulePush(1500);
  },

  schedulePush(ms) {
    if (!this.user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => this.push(), ms);
  },

  async pushNow() { clearTimeout(pushTimer); await this.push(); },

  async push() {
    if (!this.user || pushing) return;
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    pushing = true;
    const uid = this.user.uid;
    let failed = null;
    try {
      const entries = await db.all('outbox');
      if (entries.length) this.setStatus('syncing');
      for (const e of entries) {
        try {
          await withTimeout(this.pushOne(uid, e), 60000);
          const now = await db.get('outbox', e.key);
          if (now && now.ver === e.ver) await tx_del('outbox', e.key);
        } catch (err) {
          console.warn('上傳失敗', e.key, err);
          failed = err;
          if (err && err.tooBig) await tx_del('outbox', e.key); // 太大的資料不重試
          else break;
        }
      }
    } finally {
      pushing = false;
    }
    if (failed) {
      this.setStatus('error', errText(failed));
      this.schedulePush(30000);
      return;
    }
    if ((await db.all('outbox')).length) { this.schedulePush(500); return; }
    this.markOk();
  },

  async markOk() {
    if (!this.user) return;
    this.lastSync = Date.now();
    db.setSetting('lastSync:' + this.user.uid, this.lastSync);
    this.setStatus(navigator.onLine ? 'ok' : 'offline');
  },

  async pushOne(uid, e) {
    const ref = fb.doc(fs, 'users', uid, e.store, e.id);
    const rec = await db.get(e.store, e.id);
    if (!rec) {
      const tomb = await db.get('tombstones', e.key);
      await fb.setDoc(ref, { v: null, deleted: true, updatedAt: tomb ? tomb.deletedAt : Date.now(), serverAt: fb.serverTimestamp() });
      return;
    }
    const clone = structuredClone(rec);
    await this.extractImages(uid, clone);
    const v = await pack(JSON.stringify(clone));
    if (v.toUint8Array().length > MAX_DOC) {
      const err = new Error('這一頁太大了，沒辦法同步（筆跡或照片太多）');
      err.tooBig = true;
      throw err;
    }
    await fb.setDoc(ref, { v, deleted: false, updatedAt: rec.updatedAt || Date.now(), serverAt: fb.serverTimestamp() });
  },

  /* ---------- 照片：另外存，同一張只存一次 ---------- */
  imageSlots(rec) {
    const slots = [];
    for (const k of ['src', 'coverSrc']) if (typeof rec[k] === 'string') slots.push([rec, k]);
    if (Array.isArray(rec.items)) for (const it of rec.items) if (typeof it.src === 'string') slots.push([it, 'src']);
    return slots;
  },

  async extractImages(uid, rec) {
    for (const [obj, k] of this.imageSlots(rec)) {
      const src = obj[k];
      if (!src.startsWith('data:') || src.length < BIG_IMAGE) continue;
      const hash = await sha(src);
      if (!(await db.get('imgsync', hash))) {
        let url = src;
        if (url.length * 0.75 > MAX_DOC) url = await shrinkDataURL(url, MAX_DOC);
        const [meta, b64] = url.split(',');
        const mime = meta.slice(5).split(';')[0];
        await fb.setDoc(fb.doc(fs, 'users', uid, 'images', hash), {
          mime, data: fb.Bytes.fromBase64String(b64), serverAt: fb.serverTimestamp(),
        });
        await db.put('imgsync', { id: hash });
      }
      obj[k] = 'img:' + hash;
    }
  },

  async resolveImages(rec, local) {
    const slots = this.imageSlots(rec).filter(([o, k]) => o[k].startsWith('img:'));
    if (!slots.length) return;
    // 先從本機舊資料裡找，找不到才下載
    const known = new Map();
    if (local) for (const [o, k] of this.imageSlots(local)) {
      if (o[k].startsWith('data:') && o[k].length >= BIG_IMAGE) known.set(await sha(o[k]), o[k]);
    }
    const uid = this.user.uid;
    for (const [o, k] of slots) {
      const hash = o[k].slice(4);
      let url = known.get(hash);
      if (!url) {
        const snap = await fb.getDoc(fb.doc(fs, 'users', uid, 'images', hash));
        if (!snap.exists()) { o[k] = ''; continue; }
        const d = snap.data();
        url = `data:${d.mime};base64,${d.data.toBase64()}`;
        known.set(hash, url);
      }
      o[k] = url;
      await db.put('imgsync', { id: hash });
    }
  },

  async pendingCount() { return (await db.all('outbox')).length; },
};

/* ---------- 小工具 ---------- */
async function tx_del(store, key) {
  // outbox 不是同步資料，直接刪
  await db.del(store, key);
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('網路太慢，稍後再試')), ms))]);
}

async function sha(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

// 壓縮文字（筆跡資料壓完通常只剩 1/4）
async function pack(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return fb.Bytes.fromUint8Array(concat([new Uint8Array([0]), bytes]));
  const gz = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return fb.Bytes.fromUint8Array(concat([new Uint8Array([1]), gz]));
}

async function unpack(v) {
  const all = v.toUint8Array();
  const body = all.slice(1);
  if (all[0] === 0) return new TextDecoder().decode(body);
  return await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function shrinkDataURL(url, maxBytes) {
  const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
  if (!im) return url;
  const png = url.startsWith('data:image/png');
  let scale = Math.sqrt(maxBytes / (url.length * 0.75)) * 0.9;
  for (let tries = 0; tries < 6; tries++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * scale));
    c.height = Math.max(1, Math.round(im.height * scale));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.8);
    if (out.length * 0.75 <= maxBytes) return out;
    scale *= 0.8;
  }
  return url;
}

export function errText(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': 'Email 格式不對',
    'auth/missing-password': '請輸入密碼',
    'auth/weak-password': '密碼至少要 6 個字',
    'auth/email-already-in-use': '這個 Email 已經註冊過了，請直接登入',
    'auth/invalid-credential': 'Email 或密碼不對',
    'auth/wrong-password': 'Email 或密碼不對',
    'auth/user-not-found': '找不到這個帳號',
    'auth/too-many-requests': '試太多次了，請等一下再試',
    'auth/network-request-failed': '連不上網路',
    'auth/operation-not-allowed': 'Firebase 還沒開啟「電子郵件/密碼」登入',
    'auth/admin-restricted-operation': '這個專案已經關閉註冊新帳號',
    'permission-denied': '雲端拒絕存取（請檢查 Firestore 規則）',
    'unavailable': '連不上雲端，稍後會自動重試',
    'resource-exhausted': '今天的免費額度用完了，明天會自動恢復',
  };
  return map[code] || (err && err.message) || '發生錯誤';
}
