/* GNW service worker
 * 앱 코드/데이터(html·js·css·json)는 네트워크 우선 → 배포/데이터 갱신이 다음 접속에 바로 반영.
 * 아이콘·폰트 등 정적 자산은 캐시 우선(속도). 오프라인이면 캐시로 폴백. */
const CACHE = "gnw-v30";
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

// 코드/데이터는 네트워크 우선(업데이트 즉시 반영), 그 외는 캐시 우선
const NET_FIRST = /(?:\/|\.html|\.js|\.css|\.json)$/;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && NET_FIRST.test(url.pathname)) {
    // 네트워크 우선: 성공 시 캐시 갱신, 실패(오프라인) 시 캐시 → 최후엔 index.html
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // 캐시 우선(아이콘·이미지 등). 없으면 네트워크에서 받아 캐시.
  e.respondWith(
    caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res && res.ok && sameOrigin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
