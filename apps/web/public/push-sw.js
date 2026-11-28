/* global self */
// Service worker so de notificacoes push: mostra o aviso e abre a tela no toque. Nao guarda nada em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const ler = () => {
    try {
      return (event.data && event.data.json()) || {};
    } catch {
      return {};
    }
  };
  const aviso = ler();
  event.waitUntil(
    self.registration.showNotification(aviso.titulo || 'FastPro', {
      body: aviso.texto || 'Você tem um aviso novo.',
      tag: aviso.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { caminho: aviso.caminho },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const caminho = event.notification.data && event.notification.data.caminho;
  // So caminho da propria origem.
  const destino = new URL(typeof caminho === 'string' && /^\/(?!\/)/.test(caminho) ? caminho : '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const janela = janelas[0];
      if (!janela) return self.clients.openWindow(destino);
      await janela.focus();
      return janela.navigate(destino).catch(() => self.clients.openWindow(destino));
    })(),
  );
});
