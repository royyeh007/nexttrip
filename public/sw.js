// Service worker：讓網站在沒訊號時也打得開（旅行時在店裡、地下鐵、機艙裡）。
// 只管「這個網站自己的檔案」：頁面、程式、樣式、優惠券的圖和店家清單。Supabase、Google 字型、地圖一律不碰。
// 行程資料的離線版本不在這裡：那是 App 自己存在 localStorage 的（src/trip.tsx）。
//
// 策略
//   頁面（index.html）   先連網路，3 秒沒回應或連不上才用上次存的 → 有網路時永遠是最新版
//   assets/（檔名帶雜湊）有存的就直接用，沒有才下載 → 檔名變了就是新檔，不會拿到舊的
//   coupons/、圖示       先給存的、背景再更新一次
// 要讓所有人的快取全部重來：把 VERSION 加一。
const VERSION = "v1";
const PAGE = `page-${VERSION}`, ASSETS = `assets-${VERSION}`, STATIC = `static-${VERSION}`;
const KEEP = [PAGE, ASSETS, STATIC];
const SCOPE = new URL(self.registration.scope);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(PAGE).then((c) => c.add(new Request(SCOPE.href, { cache: "reload" }))).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page tells us which hashed files it is running (they were loaded before this worker took control):
// store them, and drop the ones from older versions of the site.
self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "assets" || !Array.isArray(d.urls)) return;
  const urls = d.urls.filter((u) => typeof u === "string" && u.startsWith(SCOPE.href + "assets/"));
  e.waitUntil((async () => {
    const cache = await caches.open(ASSETS);
    for (const u of urls) if (!(await cache.match(u))) await cache.add(u).catch(() => {});
    for (const req of await cache.keys()) if (!urls.includes(req.url)) await cache.delete(req);
  })());
});

const ok = (res) => res && res.ok && res.type === "basic";

async function pageFirstNetwork(req) {
  const cache = await caches.open(PAGE);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  const network = fetch(req).then((res) => { if (ok(res)) cache.put(SCOPE.href, res.clone()); return res; });
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  // slow or offline: the saved page if there is one, otherwise keep waiting for the network
  return (await cache.match(SCOPE.href)) ?? network;
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (ok(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name, event) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (ok(res)) cache.put(req, res.clone()); return res; });
  if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const rel = url.pathname.slice(SCOPE.pathname.length);
  if (req.mode === "navigate" || rel === "" || rel === "index.html") e.respondWith(pageFirstNetwork(req));
  else if (rel.startsWith("assets/")) e.respondWith(cacheFirst(req, ASSETS));
  else if (rel.startsWith("coupons/") || /^(icon-\d+\.png|icon\.svg|apple-touch-icon\.png|manifest\.webmanifest)$/.test(rel)) e.respondWith(staleWhileRevalidate(req, STATIC, e));
});
