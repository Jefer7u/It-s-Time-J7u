// ============================================================
// IT'S TIME — SERVICE WORKER
// Cache strategy:
//   • App shell (HTML)     → Network-first, cache fallback
//   • Google Fonts         → Cache-first (stale-while-revalidate)
//   • Firebase SDK (CDN)   → Cache-first (versioned URLs, safe forever)
//   • Firebase API calls   → Network-only (Firestore handles its own offline)
//   • Google Calendar API  → Network-only
// ============================================================

const CACHE_NAME  = 'its-time-v3';
const SHELL_URLS  = ['/', '/index.html', '/manifest.json'];

// ── INSTALL: pre-cache the app shell ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: delete stale caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: routing ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET and cross-origin Firebase/Google API calls
  if (request.method !== 'GET') return;

  const isFirebaseAPI    = url.hostname.includes('firestore.googleapis.com')
                        || url.hostname.includes('firebase.googleapis.com')
                        || url.hostname.includes('identitytoolkit.googleapis.com')
                        || url.hostname.includes('securetoken.googleapis.com');
  const isGCalAPI        = url.hostname === 'www.googleapis.com'
                        && url.pathname.startsWith('/calendar');
  const isChromeExt      = url.protocol === 'chrome-extension:';

  if (isFirebaseAPI || isGCalAPI || isChromeExt) return; // let browser handle

  // 2. Firebase CDN (versioned SDK files) → cache-first
  const isFirebaseCDN = url.hostname === 'www.gstatic.com'
                     && url.pathname.includes('firebasejs');
  if (isFirebaseCDN) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. Google Fonts → stale-while-revalidate (cache-first + bg update)
  const isGFont = url.hostname === 'fonts.googleapis.com'
               || url.hostname === 'fonts.gstatic.com';
  if (isGFont) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 4. App shell (same-origin HTML / manifest) → network-first, cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
});

// ── STRATEGIES ───────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline – resource not cached', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback: serve the app shell
    return caches.match('/index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise;
}

// ── MESSAGE: force update from client ───────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
