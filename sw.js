/* QuizForge service worker — offline app shell (Feature 14).
   Versioned cache: bump CACHE_VERSION when the shell files change so
   the new worker replaces the old cache cleanly on next load.
   Same-origin GET requests only; provider APIs and CDNs are never
   cached, so a stale exam can never be served and network features
   still fail loudly (and honestly) when offline. */
'use strict';

var CACHE_VERSION = 'v1';
var CACHE_NAME = 'quizforge-' + CACHE_VERSION;

var SHELL = [
  './',
  'index.html',
  'app.js',
  'i18n.js',
  'style.css',
  'questions.json',
  'manifest.json',
  'icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME && key.indexOf('quizforge-') === 0) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // APIs + CDNs: never cached

  if (req.mode === 'navigate') {
    // App shell: network first, cached index.html when offline.
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put('index.html', copy);
        });
        return res;
      }).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  // Shell assets: cache first (they are versioned by the cache name),
  // network fills the cache for anything else same-origin.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      });
    })
  );
});
