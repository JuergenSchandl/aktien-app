/* Aktien-App · Hintergrunddienst
   1. Die App-Hülle startet auch bei schlechtem Netz (Netz zuerst, sonst die letzte gespeicherte Fassung).
   2. Eine in George geteilte Abrechnung (PDF) wird angenommen und an die App weitergereicht.
   3. Mitteilungen aufs Handy anzeigen und beim Antippen die App öffnen.
   Kurse und Depotdaten werden nie zwischengespeichert: lieber keine Zahl als eine alte. */
const HUELLE = 'aktien-huelle-1';
const GETEILT = 'aktien-geteilt';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const namen = await caches.keys();
  await Promise.all(namen.filter((n) => n.startsWith('aktien-huelle-') && n !== HUELLE).map((n) => caches.delete(n)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const form = await req.formData(), datei = form.getAll('dateien').find((f) => f && f.size);
        if (datei) {
          const c = await caches.open(GETEILT);
          await c.put('/geteilt/' + Date.now(), new Response(datei, { headers: { 'Content-Type': 'application/pdf' } }));
        }
      } catch (_) { /* nichts Brauchbares geteilt */ }
      return Response.redirect('./#geteilt', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const huelle = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!huelle) return;
  e.respondWith((async () => {
    const c = await caches.open(HUELLE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    } catch (err) {
      const alt = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (alt) return alt;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (_) { m = { title: 'Aktien', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Aktien', {
    body: m.body || '', tag: m.tag || 'aktien', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/badge.png', data: { url: m.url || './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const offen = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of offen) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); if ('navigate' in c) await c.navigate(ziel).catch(() => {}); return; }
    }
    await self.clients.openWindow(ziel);
  })());
});
