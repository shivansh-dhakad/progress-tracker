/* Streakbook service worker: makes the site installable and shows shift reminders.
   It does not cache anything, so you always get the latest version of the app. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'Streakbook', {
    body: d.body || 'A shift is about to start.',
    tag: d.tag,                       // same tag = replaces, so the app and the server never double-notify
    icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: d.url || '/' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus()
    return self.clients.openWindow(url)
  }))
})