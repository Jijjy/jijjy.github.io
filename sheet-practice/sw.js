// sw.js — offline caching. Precache the app shell; runtime-cache CDN modules
// and piano samples on first use so subsequent loads work offline.
const CACHE = 'sheet-practice-v4';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './bg.glsl',
  './manifest.webmanifest',
  './icon.svg',
  './src/main.js',
  './src/glRender.js',
  './src/staff.js',
  './src/procedural.js',
  './src/fingering.js',
  './src/playback.js',
  './src/midiInput.js',
  './src/loadMidi.js',
  './src/loadMusicXML.js',
  './shaders/fullscreen.vert',
  './shaders/quad.vert',
  './shaders/quad.frag',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // network-first for our own code/assets: newest wins online, cache offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
  } else {
    // cache-first for CDN libs + piano samples (effectively immutable, big).
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
