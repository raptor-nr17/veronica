// Veronica start ook zonder internet: de app zelf komt uit deze cache. Verzoeken naar de
// telefoons gaan NOOIT via de cache (die moeten echt en vers zijn).
const VERSIE = 'veronica-1.2.0';
const BESTANDEN = ['./index.html', './kern.js', './meters.js', './veronica.js', './manifest.webmanifest', './icoon-192.png', './icoon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(BESTANDEN)
    // De map zelf ('./') alleen als de server daar de pagina geeft (GitHub Pages doet dat).
    .then(() => fetch('./').then((r) => (r.ok ? c.put('./', r) : null)).catch(() => null)))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // telefoons: niet aankomen
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request, kopie)); }
    return r;
  }).catch(() => caches.match('./index.html'))));
});
