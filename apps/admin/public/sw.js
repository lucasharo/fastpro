/* global self, caches */
// Desliga service worker herdado de outro projeto que rodou nesta mesma origem (ex.: localhost:3001 do app Aluno
// do DriveMais). O FastPro nao usa service worker: este arquivo so substitui o antigo, apaga os caches dele e se
// desregistra, para o navegador voltar a buscar JS e CSS direto do servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.map((nome) => caches.delete(nome)));
      await self.registration.unregister();
      const janelas = await self.clients.matchAll({ type: 'window' });
      janelas.forEach((janela) => janela.navigate(janela.url));
    })(),
  );
});
