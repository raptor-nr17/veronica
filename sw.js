// Veronica start ook zonder internet: de app zelf komt uit deze cache. Verzoeken naar de
// telefoons gaan NOOIT via de cache (die moeten echt en vers zijn).
// DE VERSIE IS EEN VINGERAFDRUK VAN DE BESTANDEN (sha256, eerste 12 tekens). Verandert er iets,
// dan verandert deze naam, en laadt elke Chromebook vanzelf de nieuwe versie. Een test in de
// privé-repo eist dat hij klopt (check_veronica.js zegt welke waarde hij moet hebben).
const VERSIE = 'veronica-5f2e0b0b1665';
const BESTANDEN = ['./index.html', './pool.js', './rekenpostbus.js', './privepost.js', './prive-zoek.js', './zoekkassa.js', './zoekmulti.js', './zoeken.js', './zoekgeheugen.js', './verslag.js', './stemproef.js', './hoek.js', './takenverdeling.js', './nulmeting.js', './nachtlog.js', './hartslag.js', './geheugentel.js', './gastbrein.js', './avengers.js', './slimheid.js', './trap.js', './zoekwand.js', './fenna.js', './fenna-geheugen.js', './fenna-kluis.js', './ontmoet.js', './motorinstel.js', './afnemers.js', './kaartje.js', './zelftest.js', './kern.js', './qrcode.js', './jsQR.js', './meters.js', './betekenis-model.js', './prive-betekenis.js', './prive-hoek.js', './prive-model.js', './prive-hoek-ui.js', './veronica.js', './besturen.html', './besturen.js', './besturen-adb.js', './scrcpy-server.bin', './manifest.webmanifest', './icoon-192.png', './icoon-512.png'];
self.addEventListener('install', (e) => {
  // cache: 'reload' = echt van de server, niet uit de browsercache (anders kan een nieuwe versie
  // met oude bestanden starten).
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(BESTANDEN.map((u) => new Request(u, { cache: 'reload' })))
    // De map zelf ('./') alleen als de server daar de pagina geeft (GitHub Pages doet dat).
    .then(() => fetch('./').then((r) => (r.ok ? c.put('./', r) : null)).catch(() => null)))
    .then(() => self.skipWaiting()));
});
// 523c: de cache van het betekenismodel (veronica-betekenis, ±200 MB) blijft staan bij een nieuwe versie.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIE && x !== 'veronica-betekenis').map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // telefoons: niet aankomen
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request, kopie)); }
    return r;
  }).catch(() => caches.match('./index.html'))));
});
