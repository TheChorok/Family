// 서비스 워커: 오프라인 실행 + 홈 화면 설치 지원
// - html/js/css/json(같은 출처): 네트워크 우선 → 실패 시 캐시 (배포 즉시 최신 반영)
// - Three.js CDN·아이콘 등: 캐시 우선 (버전 고정 URL이라 안전)
// - 캐시 이름에 버전을 붙이고, 활성화 시 옛 버전 캐시 삭제
const VERSION = 'v1';
const CACHE = `keycap-tower-${VERSION}`;
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js';
const THREE_CORE = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.core.js';
const SHELL = [
  './', './index.html', './style.css', './manifest.json',
  './js/main.js', './js/layout.js', './js/physics.js', './js/rng.js', './js/tower.js',
  './js/player.js', './js/camera.js', './js/input.js', './js/audio.js', './js/quality.js',
  './js/storage.js', './js/hud.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // CDN 파일은 실패해도 설치는 진행 (첫 실행 때 런타임 캐시로 채워짐)
    await Promise.all([THREE_URL, THREE_CORE].map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('keycap-tower-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isAppCode(url) {
  if (url.origin !== self.location.origin) return false;
  return /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const idx = await c.match('./index.html');
      if (idx) return idx;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  e.respondWith(isAppCode(url) ? networkFirst(req) : cacheFirst(req));
});
