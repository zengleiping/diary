// 資料儲存：存在這台裝置的 IndexedDB；登入雲端同步後，sync.js 會負責上傳下載
const DB_NAME = 'qiuqiu-diary';
const DB_VERSION = 2;
const STORES = ['pages', 'trips', 'collectibles', 'stickers', 'settings'];
// 會同步到雲端的資料
export const SYNCED = ['pages', 'trips', 'collectibles', 'stickers'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('collectibles')) {
        const s = db.createObjectStore('collectibles', { keyPath: 'id' });
        s.createIndex('tripId', 'tripId');
      }
      if (!db.objectStoreNames.contains('stickers')) db.createObjectStore('stickers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      // 同步用：待上傳清單、刪除紀錄、已上傳的照片
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('imgsync')) db.createObjectStore('imgsync', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const db = {
  get: (store, id) => tx(store, 'readonly', s => reqP(s.get(id))),
  all: (store) => tx(store, 'readonly', s => reqP(s.getAll())),
  byIndex: (store, index, value) => tx(store, 'readonly', s => reqP(s.index(index).getAll(value))),
  // 本機改了資料時通知同步程式（由 sync.js 設定）
  onLocalChange: null,

  async put(store, obj, { fromSync = false } = {}) {
    const synced = SYNCED.includes(store);
    if (synced && !fromSync) obj.updatedAt = Date.now();
    await tx(store, 'readwrite', s => reqP(s.put(obj)));
    if (synced && !fromSync && this.onLocalChange) this.onLocalChange(store, obj.id);
  },

  async del(store, id, { fromSync = false } = {}) {
    await tx(store, 'readwrite', s => reqP(s.delete(id)));
    if (SYNCED.includes(store) && !fromSync) {
      await tx('tombstones', 'readwrite', s => reqP(s.put({ key: store + ':' + id, store, id, deletedAt: Date.now() })));
      if (this.onLocalChange) this.onLocalChange(store, id);
    }
  },

  clear: (store) => tx(store, 'readwrite', s => reqP(s.clear())),

  async getSetting(key, fallback = null) {
    const r = await this.get('settings', key);
    return r ? r.value : fallback;
  },
  setSetting(key, value) { return this.put('settings', { key, value }); },

  async exportAll() {
    const out = { app: 'qiuqiu-diary', version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = await this.all(s);
    return out;
  },

  async importAll(data, { replace = false } = {}) {
    if (!data || data.app !== 'qiuqiu-diary') throw new Error('這不是日記備份檔');
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      if (replace) {
        if (SYNCED.includes(s)) { for (const o of await this.all(s)) await this.del(s, o.id); }
        else await this.clear(s);
      }
      for (const obj of data[s]) await this.put(s, obj);
    }
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 請瀏覽器盡量不要自動清掉資料
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}
