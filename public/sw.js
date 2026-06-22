const CACHE_NAME = "velodent-pwa-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/velodent-icon-1024.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cachedResponse) => cachedResponse ?? caches.match("/"))
    )
  );
});
