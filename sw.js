/* GNW service worker
 * - games.json(데이터): 네트워크 우선, 실패 시 직전 캐시(JSON) 폴백 — 절대 HTML로 폴백하지 않음.
 * - 앱 셸(html·js·css): stale-while-revalidate(즉시 캐시 + 백그라운드 갱신) → 빠르면서 자동 최신화.
 * - 아이콘·폰트 등: 캐시 우선. */
const CACHE = "gnw-v32";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 데이터: 네트워크 우선. 쿼리(?t=)는 제거한 단일 키로 캐시하고, 실패 시 그 캐시(JSON)로 폴백.
  if (sameOrigin && url.pathname.endsWith("games.json")) {
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key))
    );
    return;
  }

  // 앱 셸: stale-while-revalidate — 캐시를 즉시 주고 백그라운드로 갱신(다음 로드에 최신 반영).
  if (sameOrigin && /(?:\/|\.html|\.js|\.css)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // 그 외(아이콘·폰트 등): 캐시 우선, 없으면 네트워크.
  e.respondWith(
    caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res && res.ok && sameOrigin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
