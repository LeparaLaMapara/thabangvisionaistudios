/* Service worker: web push only (no caching, no offline).
 * Registered by components/notifications/PushPrompt.tsx when someone turns
 * notifications on. The payload is { title, body, url, tag } from lib/push.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function samePath(url) {
  // Only open pages on this site.
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/dashboard';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'New notification').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 240),
    icon: '/logo-favicon-180.png',
    badge: '/logo-favicon-32.png',
    tag: data.tag ? String(data.tag).slice(0, 64) : undefined,
    data: { url: samePath(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(samePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url === target && 'focus' in w) return w.focus();
      }
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'navigate' in w) {
          return w.navigate(target).then((nw) => (nw ? nw.focus() : undefined));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser replaced the subscription: save the new one if we can.
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then((sub) =>
      fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(sub.toJSON()),
      }),
    ),
  );
});
