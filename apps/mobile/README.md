# App FastPro (Expo, Android e iOS)

App mínimo: entrada (cliente por código, profissional por senha) e notificações push. As demais telas abrem no site.

Fica fora do workspace pnpm: instale e rode com npm, nesta pasta.

```powershell
npm install
```

Copie `.env.example` para `.env` e preencha `EXPO_PUBLIC_SITE_URL` (HTTPS) e `EAS_PROJECT_ID`.

## Para o push funcionar

1. Conta Expo e projeto (`npx eas-cli@latest init`); o ID vai em `EAS_PROJECT_ID`.
2. Android: criar o app `br.com.fastpro.app` no Firebase, salvar `google-services.json` nesta pasta e enviar a chave de conta de serviço (FCM v1) em `npx eas-cli@latest credentials`.
3. iOS: conta Apple Developer (paga). O `eas credentials` cria a chave APNs.
4. Gerar um build instalável em aparelho de verdade (o Expo Go não recebe push no Android).

```powershell
npx eas-cli@latest build --profile development --platform android
```

No site, o Web Push precisa de `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`node scripts/gerar-chaves-vapid.mjs mailto:...`, na raiz).
