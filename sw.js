// AniFind Service Worker - PWA 离线缓存
const CACHE_VERSION = 'anifind-v1';
const STATIC_CACHE = 'anifind-static-v1';
const API_CACHE = 'anifind-api-v1';
const IMG_CACHE = 'anifind-img-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// 安装：缓存核心静态资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== API_CACHE && k !== IMG_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// 请求拦截
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // Bangumi API: 网络优先，失败回退缓存
  if (url.hostname === 'api.bgm.tv') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(API_CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 图片资源: 缓存优先
  if (url.hostname === 'lain.bgm.tv' || /\.(jpg|jpeg|png|webp|gif)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(IMG_CACHE).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // 静态资源: 缓存优先
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

// 限制图片缓存大小（保留最新200张）
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}
self.addEventListener('message', event => {
  if (event.data === 'trim-cache') {
    trimCache(IMG_CACHE, 200);
  }
});
