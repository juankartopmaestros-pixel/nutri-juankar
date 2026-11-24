// Guarda la app para que abra rápido. Las fotos siempre van al servidor (no se guardan aquí).
const CACHE = "nutri-v4";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "bg-home.jpg", "bg-top.jpg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Primero la red (para tener siempre la última versión); si no hay conexión, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
