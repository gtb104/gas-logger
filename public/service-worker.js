const CACHE_NAME = 'gas-logger-app-shell-v3'
const APP_SHELL_URLS = [
  '/',
  '/fillup',
  '/history',
  '/stats',
  '/config',
  '/manifest.webmanifest',
  '/pwa-icons/icon-192.png',
  '/pwa-icons/icon-512.png',
  '/pwa-icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseCopy = response.clone()

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseCopy)
          })

          return response
        })
        .catch(() => caches.match(event.request).then((cachedResponse) => cachedResponse ?? caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then((response) => {
        const responseCopy = response.clone()

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseCopy)
        })

        return response
      })
    }),
  )
})
