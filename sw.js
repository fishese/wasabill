const CACHE = 'sushi-split-v18';
const ASSETS = [
  './index.html',
  './manifest.json',
  './sushiicon.svg',
  './pin-fish-empty.svg',
  './pin-fish-full.svg'
];
// Cache optional room/QR libraries for offline relaunches. The client can now
// render offline mode even if the Supabase script was never cached; shared-room
// operations still require the library and network access.
const CDN_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js'
];
const RUNTIME_CACHE_HOSTS = ['cdn.jsdelivr.net'];

// Core assets are cached atomically (install fails if any of THESE fail --
// correct, they're essential). Each CDN script is attempted separately and
// independently: a CDN hiccup at install time shouldn't be able to fail the
// whole install, and one script failing shouldn't block another. Anything
// that fails here gets picked up opportunistically by the fetch handler's
// GET-caching on the next successful online load instead.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(ASSETS);
      await Promise.all(CDN_SCRIPTS.map(url => c.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

// Remove old cache versions on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('sushi-split-') && k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for anything already cached. For GET requests to allow-listed
// CDN hosts (not Supabase -- never cache its POST-based API calls, which
// would risk serving a stale/wrong response for a different room or RPC),
// opportunistically cache a successful response so it survives going
// offline later, even though it wasn't part of the atomic install step.
self.addEventListener('fetch', e => {
  // Let the browser handle API writes. Never return undefined as a Response.
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const shell = new URL('./index.html', self.registration.scope);
  const isAppNavigation = e.request.mode === 'navigate' && url.origin === shell.origin &&
    (url.pathname === shell.pathname || url.pathname === new URL('./', shell).pathname);
  if (isAppNavigation) {
    // / and /?room=... must also open offline, not just the manifest's index.html.
    e.respondWith(fetch(e.request).then(async response => {
      if (response.ok) { const c = await caches.open(CACHE); await c.put(shell.href, response.clone()); }
      return response;
    }).catch(async () => (await caches.match(shell.href)) || Response.error()));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      const url = new URL(e.request.url);
      const cacheable = e.request.method === 'GET' && RUNTIME_CACHE_HOSTS.includes(url.hostname);
      return fetch(e.request).then(response => {
        if (cacheable && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return response;
      }).catch(() => Response.error());
    })
  );
});
