// Offline shell for SkyWindow. Only same-origin GET requests inside this app's
// path are cached; forecast API traffic is never touched (the app keeps its own
// last-forecast copy in localStorage).

const CACHE = "skywindow-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "css/styles.css", "js/app.js", "js/api.js", "js/astro.js", "js/score.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("skywindow-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope).pathname;
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(scope)) return;
  // Network first so updates land quickly; cache when offline.
  e.respondWith(fetch(e.request).then((res) => {
    // Cache only the plain shell URLs, so arbitrary ?query links can't grow the cache.
    if (res.ok && res.type === "basic" && !url.search) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
});
