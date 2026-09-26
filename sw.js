// 離線快取：安裝到主畫面後，沒有網路也能打開
// 每次更新程式，把版本號 +1，使用者下次打開就會拿到新版
const VERSION = 'qiuqiu-v2';
const FILES = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/app.js', './js/editor.js', './js/render.js', './js/db.js', './js/ui.js', './js/stickers.js',
  './js/sync.js', './js/firebase-config.js', './js/vendor/firebase.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 先用網路拿最新版，沒網路時用快取
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
