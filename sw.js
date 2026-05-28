// FanJi Service Worker - PWA 离线缓存
const CACHE_VERSION = 'fanji-v17';
const STATIC_CACHE = 'fanji-static-v16';
const API_CACHE = 'fanji-api-v7';
const IMG_CACHE = 'fanji-img-v7';

// 1x1 透明 GIF：图片网络失败时的占位，避免破图图标（也避免把网络错误伪装成误导性的 404）
const TRANSPARENT_GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './shion-hero.png'
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

  // Bangumi API / FanJi API: stale-while-revalidate（先返缓存秒显，后台刷新；国内慢网下重复访问瞬开）
  // 注意：排除 /api/img（图片代理），它走下方图片分支，别被当成 JSON 接口塞 offline 兜底
  if (url.pathname !== '/api/img' && (url.hostname === 'api.bgm.tv' || url.hostname.endsWith('.pages.dev') || url.hostname.endsWith('.workers.dev'))) {
    const revalidate = fetch(request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(API_CACHE).then(c => c.put(request, clone));
        }
        return res;
      })
      .catch(() => null);
    event.waitUntil(revalidate.catch(() => {}));
    event.respondWith(
      caches.match(request).then(cached =>
        cached || revalidate.then(res =>
          res || new Response('{"ok":false,"error":"offline"}', { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
        )
      )
    );
    return;
  }

  // 图片资源（含 /api/img 代理、直连 lain、任意图片扩展名）: 缓存优先
  if (url.pathname === '/api/img' || url.hostname === 'lain.bgm.tv' || /\.(jpg|jpeg|png|webp|gif)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(IMG_CACHE).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => new Response(TRANSPARENT_GIF, {
          status: 200,
          headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }
        }));
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
