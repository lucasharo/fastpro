# E3 — Refino: composição da rota de mídia na API e ligação do envio na página /fotos

- **Issue:** #141 "[E3] Composição da rota de mídia na API (upload, redução e galeria)" · **Coluna no quadro:** Product Owner (verificado em `docs/factory/quadro-status.md`, seção "Product Owner (1)")
- **Workflow:** WF-03, etapa Product Owner · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder (sem perguntas diretas ao usuário)
- **Relaciona-se a:** #39 (H-026, upload em quarentena), #40 (H-027, redução), #41 (H-028, EXIF e tipo por conteúdo), #42 (H-029, pré-visualização e ordem)
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou decisão · `[VERIFICADO]` conferido no código ou documento nesta leitura · `[PROPOSTA]` sugestão do PO ou do Architect, a validar · `[NÃO VERIFICADO]` sem fonte ou sem execução

## 0. Limites desta leitura

- `[NÃO VERIFICADO]` O corpo da Issue #141 e o comentário de escopo ampliado não foram lidos. Este ambiente não tem shell, então `gh issue view` não pôde ser executado. O escopo usado aqui vem do líder, conforme registrado em `11-DECISOES.md` (rodadas 40 e 41), e do enunciado deste refino. Se o comentário de escopo ampliado disser algo diferente, o líder deve prevalecer e este refino deve ser ajustado.
- `[NÃO VERIFICADO]` Estado (coluna) das Issues #39, #40 e #41 no quadro: só a linha da #141 foi conferida. Os estados de #39 e #40 "Concluído" vêm de `98-REFINO-H029.md` §0 e de `11-DECISOES.md`; #41 "Concluído" vem da decisão de rodada 39.
- `[NÃO VERIFICADO]` Se a função de redução de `ReduceDeps` (adaptador do `sharp`) existe e como é montada. Não foi lido.
- `[NÃO VERIFICADO]` Se a migração `20261112190000_media_expand_photo_order.sql` está aplicada no banco de desenvolvimento e por qual caminho (`npx supabase` ou `corepack pnpm db:migrate`, ver §8).
- `[NÃO VERIFICADO]` Existência e valores de variáveis de Storage no `.env.local`. Por regra, o arquivo não foi lido nem pesquisado. Só os nomes usados no código foram conferidos.
- `[NÃO VERIFICADO]` Comportamento real em navegador, CSP em tempo de execução, tamanho do bundle, limites da Vercel e Storage do Supabase no plano gratuito.
- Não foram lidos por inteiro: `media-service.ts`, `media-gallery-service.ts`, `media-route.test.ts`, `media-gallery-h029.test.ts`, `fotos-page.test.ts` e `fotos.css`. Só as partes citadas abaixo foram conferidas.
- Nenhum commit foi feito (sem shell). Ver §11.

## 1. Objetivo

Ligar na API as rotas de mídia que já existem no código (upload em quarentena, redução e galeria do dono) e ligar o botão "Adicionar foto" da página `/fotos`, para que o cliente consiga, em ambiente de desenvolvimento, enviar, ver, excluir e ordenar as fotos do próprio pedido de ponta a ponta.

Esta história não publica pedido, não avança para revisão (H-030) e não abre o fluxo para visitantes reais em produção (ver §7, item 1 e P-141-1).

## 2. Estado atual

### 2.1 O que existe e está pronto no código

- `[VERIFICADO]` `apps/api/src/media/media-route.ts`: `handleMediaRoute` e `isMediaRoute`. `MediaRouteOptions` tem `deps: MediaDeps`, `siteUrl` e `galeria?: GalleryDeps`. Sem `galeria`, as rotas da galeria respondem 404.
- `[VERIFICADO]` `MediaDeps` (`apps/api/src/media/media-service.ts`, linhas 33 a 43): `store` (MediaStorePort), `storage` (QuarantineStoragePort), `rate` (DraftRatePort), `hasher` (DraftHasher), `clock`, `globalCap?` e `reduce` (ReduceDeps).
- `[VERIFICADO]` `GalleryDeps` (`apps/api/src/media/media-gallery-service.ts`, linhas 36 a 48): `gallery` (MediaGalleryStorePort), `reader` (ReducedPhotoReaderPort), `storage` (MediaReduceStoragePort), `store`, `rate`, `hasher`, `clock` e `contador?`.
- `[VERIFICADO]` Adaptadores de banco e Storage com nomes confirmados em `packages/db/src`:
  - `media-quarantine.ts`: `PgMediaStore` (linha 70, construtor com `SqlClient`), `SupabaseQuarantineStorage` (linha 213, construtor com `QuarantineStorageOpcoes`: `baseUrl`, `serviceKey`, `fetchImpl?`), `SupabaseMediaReduceStorage` (linha 309, mesmo tipo de opções).
  - `media-gallery.ts`: `PgMediaGallery` (linha 52, construtor com `SqlClient`) e `SupabaseReducedPhotoReader` (linha 90, construtor com `QuarantineStorageOpcoes`).
- `[VERIFICADO]` Constantes em `packages/domain/src/media`: `media.ts` (`MEDIA_MAX_BYTES` 10 MB, tipos aceitos, cinco fotos por rascunho, TTL do pendente de 30 min), `reduce.ts` (lado máximo 1.280 px, alvo de 500.000 bytes, teto de 750.000, escada de qualidade, prazo de 10 s, `MEDIA_REDUCED_BUCKET` = `request-photos`, `planoDimensoes`), `gallery.ts` (caminhos `/v1/media/photos` e `/v1/media/photos/order`, `parseMediaOrderBody`, políticas de taxa).
- `[VERIFICADO]` `apps/api/src/app.ts`: `AppOptions` já tem o campo `media?: MediaRouteOptions` (linha 161) e o despacho `if (opts.media && isMediaRoute(path))` (linhas 312 a 315). A aplicação já sabe atender a mídia quando recebe a opção.
- `[VERIFICADO]` `apps/web/public/fotos.html` carrega `tokens.css`, `fotos.css` e `fotos.js` (script clássico, sem módulo). `fotos.js` tem o controlador completo: lista, polling, miniatura por Blob, exclusão com diálogo, reordenação e limite de cinco.
- `[VERIFICADO]` `apps/web/src/media/reduzir-foto.ts`: `prepararEnvio` (linha 38) e `enviarFoto` (linha 71), com a interface `PortasNavegador` (linhas 14 a 19). O fluxo é reduzir, emitir com o tamanho reduzido, enviar.
- `[VERIFICADO]` `apps/web/tests/fotos-page.test.ts` testa `enviarFoto` com portas e APIs falsas (linhas 517 em diante). O teste existe, mas o fluxo não está ligado na página.

### 2.2 O que não está ligado

- `[VERIFICADO]` `apps/api/src/vercel.ts` chama `handleRequest` sem a opção `media` (linhas 58 a 78). A lista de opções passa `drafts`, `accessCase`, `professionalOffering` etc., mas não passa mídia.
- `[VERIFICADO]` `apps/api/src/composicao.ts` (interface `Integracoes`, linhas 87 a 114) não tem campo de mídia nem pendências de mídia. Não existe ponto de montagem para a mídia, como existe para a oferta profissional (`professional-offering-composicao.ts`).
- `[VERIFICADO]` Efeito em produção: `POST /v1/media/uploads`, `POST /v1/media/{id}/finalize`, `GET /v1/media/{id}`, `GET /v1/media/photos`, `GET /v1/media/{id}/image`, `DELETE /v1/media/{id}` e `PUT /v1/media/photos/order` respondem 404. Não há erro, só a rota inexistente. É a lacuna que a QA apontou na #42 (rodada 40 de `11-DECISOES.md`).
- `[VERIFICADO]` Diferença de resposta a corrigir: quando `media` não está montado, `app.ts` responde 404 com `Cache-Control: no-store` e corpo vazio (linha 355). Quando a rota está montada e o cookie falta, `draftNotFound()` responde 404 com `DRAFT_HEADERS`. Os dois 404 não são idênticos byte a byte. Isso revela se a mídia está montada e não cumpre o 404 uniforme de 88 §1.
- `[VERIFICADO]` `apps/web/public/fotos.js`, na página ligada (linhas 730 a 738), chama `montarFotos` só com `documento` e `fetch`. Sem `adicionarFoto`, o botão "Adicionar foto" fica `aria-disabled` e mostra "Envio de foto indisponível neste navegador." (linhas 461 a 464). Esse é o estado em produção hoje, registrado na #42 (rodada 41).
- `[VERIFICADO]` `PortasNavegador` (decodificar e codificar) não tem implementação em `apps/web/src`. Só a interface existe. Não há chamada a `createImageBitmap` nem a `toBlob` fora dos comentários.
- `[VERIFICADO]` `reduzir-foto.ts` importa `MEDIA_MAX_BYTES`, `escolherSaidaJpeg` e `planoDimensoes` de `@fastpro/domain` (linha 5). Esse import é de tempo de execução. Um arquivo público estático que use `reduzir-foto.ts` não funciona no navegador como está.
- `[VERIFICADO]` `fotos.js`, na leitura do arquivo inteiro, não tem `AbortController`. Pelo desenho de `98-DESENHO-H029.md` §4.3, excluir foto que esta aba está enviando deveria cancelar o envio antes do `DELETE`. Essa parte não existe no arquivo.
- `[VERIFICADO]` O `apps/web/package.json` não tem bundler. O `build` é `copy-tokens` mais `tsc -p`. O único bundler citado no repositório, esbuild, está em `docs/factory/spikes/s09`, fora do produto. `copy-tokens.mjs` é o precedente de arquivo gerado copiado para `apps/web/public`, ignorado pelo git.

### 2.3 Padrão a seguir na API

- `[VERIFICADO]` O rascunho (`apps/api/src/drafts/compose.ts`) lê `DATABASE_URL_APP_API`, `DRAFT_IP_HMAC_KEY` (no mínimo 32 caracteres) e `SITE_URL`, e cria `PgDraftStore` e `PgDraftRate` sobre um cliente memoizado por URL (`criarFabricaRascunho`). A mídia usa o mesmo papel de banco (`app_api`), o mesmo hasher de IP e o mesmo `DraftRatePort`.
- `[VERIFICADO]` A oferta profissional (`professional-offering-composicao.ts`) é o modelo: `montarOfertaProfissional(env, opções)` devolve `{ options, pendencias }`, só com nomes. `Integracoes` ganha dois campos novos (um de opções e um de pendências) e `vercel.ts` repassa as opções a `handleRequest`.
- `[VERIFICADO]` Nomes de Storage já usados no código: `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (em `professional-composicao.ts`, linhas 36 e 37). São os nomes que a mídia deve reaproveitar, a não ser que o líder escolha outros (P-141-3).

## 3. Escopo

### 3A. Montar na raiz da API as rotas de mídia (#39, #40, #42)

1. Criar um ponto de montagem da mídia, no padrão de `professional-offering-composicao.ts`, que receba o ambiente e as fábricas de cliente SQL e de Storage, e devolva `{ options, pendencias }`. Ele monta:
   - `MediaRouteOptions` com `deps` (`PgMediaStore`, `SupabaseQuarantineStorage`, rascunho `rate`, hasher do IP, relógio, redutor e armazenamento de redução) e `siteUrl`;
   - `galeria` (`GalleryDeps`) com `PgMediaGallery`, `SupabaseReducedPhotoReader`, `SupabaseMediaReduceStorage`, `PgMediaStore`, `rate`, `hasher` e relógio.
2. `Integracoes` ganha `media` e `pendenciasMedia`. `vercel.ts` passa `media` a `handleRequest`. `app.ts` já aceita a opção; não precisa de rota nova.
3. Pendências só com nomes de variáveis, sem valores e sem tamanho de chave. Nomes a conferir: `DATABASE_URL_APP_API`, `DRAFT_IP_HMAC_KEY` (com a marca "curta" se faltar tamanho), `SITE_URL`, `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (ou os nomes escolhidos em P-141-3). Além disso, a pendência "fábrica do cliente SQL da mídia (ainda não montada na função)" quando o ambiente está completo mas a fábrica não foi passada, como já ocorre com o rascunho.
4. Quando faltar qualquer item, as rotas `/v1/media/*` respondem o mesmo 404 uniforme (corpo e cabeçalhos iguais aos de `draftNotFound()`), sem tocar banco nem Storage. Isso vale também quando `media` não está montado (ver §2.2, diferença de 404).
5. A galeria e o upload são montados separadamente, cada um com as próprias pendências, como a oferta e o rascunho. A proposta de tudo ou nada está em P-141-4.
6. Não ler, não gravar e não registrar valores de variáveis. Logs só com nomes fixos (ver CA-05).

### 3B. Ligar o envio de foto na página /fotos

1. Ligar o botão "Adicionar foto" de `fotos.js` ao fluxo já testado: escolher arquivo (`input type="file"` oculto, `accept` de JPG, PNG e WebP) → `enviarFoto` (reduzir, emitir com o tamanho reduzido, enviar) → `finalize` → a foto entra na lista como "enviando" e segue a máquina de estados que já existe.
2. Levar a lógica de redução ao navegador, sem build quebrar o padrão de scripts públicos. A página continua carregando um arquivo estático em `apps/web/public`, com `<script src>` clássico e `script-src 'self'`. A forma técnica fica com o Architect, com as opções de P-141-5.
3. Implementar `PortasNavegador` no navegador: decodificar com `createImageBitmap` (`imageOrientation: 'from-image'`) e codificar com canvas (`toBlob`). Sem essa opção ou sem canvas, o envio segue com o original, até 10 MB, e o servidor reduz (fallback de 93 §4.4).
4. Ligar a exclusão de foto em envio com `AbortController`, como pede 98 §4.3, e fechar a lacuna registrada na #42. Ver P-141-7.
5. Textos novos para os caminhos sem texto aprovado (arquivo grande demais no navegador, tipo não aceito, falha de envio). Ver P-141-6.

## 4. Fora de escopo

- Revisão do pedido e aviso de duplicidade (H-030, #43).
- Publicação, vínculo ao pedido e prazo de 7 dias (H-031, #44).
- Expurgo agendado por tick (H-110). A condição 3 de 88 §8 depende dele; esta história não o implementa.
- Conversão de HEIC (decisões 80 e 95). HEIC continua 415 no servidor, e o navegador não converte nesta história.
- Deduplicação por conteúdo (88 R3, decisão 123).
- Capa, marca d'água, visualização por profissional (H-056 e H-057) e ampliação da foto.
- Canal de foto por WhatsApp ou outro (RF-025a, P-02).
- Prova de carga do `sharp` em Linux e medição na Vercel (93 §8). Continuam `[NÃO VERIFICADO]`; o desenho já trata falha de carga como 503 sem rejeitar foto.
- Teste manual com leitor de tela, zoom e contraste (roteiro G-14 de 98). Continua pendente; esta história não o fecha.

## 5. Critérios de aceite (testáveis)

### Grupo A: composição da API

- **CA-01 Rotas ligadas com ambiente completo.** Dado um ambiente com todas as variáveis e as fábricas de banco e Storage informadas, quando `handleRequest` recebe `POST /v1/media/uploads` com cookie válido e corpo correto, então responde 201 com `upload_url` (com fakes de banco e Storage). Quando recebe `GET /v1/media/photos` com cookie válido, então responde 200 com `{ "fotos": [...] }`. Prova: teste de montagem e de rota com fakes.
- **CA-02 Pendências só com nomes.** Dado um ambiente parcial, quando a montagem roda, então devolve somente os nomes das variáveis que faltam (e a marca "curta" para chave com tamanho insuficiente). Nenhum valor de variável aparece em `pendenciasMedia`, em `options` serializado ou em log. Prova: ambiente com valores sentinela e varredura da saída.
- **CA-03 404 uniforme quando faltar.** Dado um item faltando (variável, fábrica ou `media` não montado), quando chega qualquer método ou caminho sob `/v1/media/`, então a resposta é 404 com corpo e cabeçalhos byte a byte iguais ao `draftNotFound()` do cenário montado sem cookie. Nenhuma chamada a banco ou Storage. Prova: comparação byte a byte nos casos de §6.
- **CA-04 Galeria separada.** Dado que o upload está completo e a galeria não, quando a montagem roda, então as rotas de emissão, finalização e leitura de estado funcionam e as rotas da galeria respondem 404 uniforme com a pendência da galeria listada. Prova: teste de montagem nos dois sentidos. Vale só se P-141-4 for aprovada como separada.
- **CA-05 Sem valor em log ou resposta.** Dado um ambiente com valores sentinela, quando a montagem e as rotas são exercitadas (sucesso, recusa e falha de Storage), então nenhuma linha de log, nenhum corpo e nenhum cabeçalho contém os valores. Prova: captura de `console`, `stdout`, `stderr` e respostas.
- **CA-06 Papel de menor privilégio.** Dado o ambiente completo, quando a montagem abre o cliente de banco, então a URL usada é a de `DATABASE_URL_APP_API` (papel `app_api`), e não a de `DATABASE_URL_APP_SYSTEM` nem de `service_role`. Um cliente por URL, reaproveitado. Prova: teste de montagem com fábrica espiã.
- **CA-07 Sem regressão de contratos.** Dado a montagem nova, quando as suítes existentes rodam (`media-route.test.ts`, `media-gallery-h029.test.ts`, `media-reduce-service.test.ts`, `composicao-integracoes.test.ts`, `composicao-rascunho.test.ts`), então continuam verdes, e as respostas de `finalize`, `GET /v1/media/{id}` e `POST /uploads` continuam iguais às de antes. Prova: `corepack pnpm check:all` com contagem e código de saída registrados na Issue.
- **CA-08 Storage só no bucket fixo.** Dado as portas de Storage montadas, quando as rotas são exercitadas, então a leitura de imagem acessa só `request-photos` pela porta estreita de leitura, e nunca `quarantine/d/`. Prova: teste de espião (já previsto como G-04 de 98) rodado sobre a montagem real.
- **CA-09 Banco real do papel app_api.** Dado o adaptador `PgMediaGallery` e as funções `media_list`, `media_delete`, `media_reorder` e `media_read_target`, quando o teste de banco roda no ambiente de desenvolvimento, então prova o contrato de 98 §2 contra o banco real (o "dbtest do adaptador PgMediaGallery" que a QA pediu). Prova: `corepack pnpm db:test` com o arquivo novo, contagem e código de saída.
- **CA-10 Ponta a ponta em desenvolvimento.** Dado o ambiente de desenvolvimento com a rota montada, quando o roteiro roda (emitir, `PUT` no Storage, finalizar, ver lista, ver imagem, excluir, reordenar), então cada passo responde como o contrato e o estado final no banco e no Storage é consistente (uma foto excluída some da lista e do Storage). O teste cria dados de teste no banco de desenvolvimento, permitido pela regra vigente. Prova: roteiro registrado na Issue com saída de cada passo. `[NÃO VERIFICADO]` até ser executado.

### Grupo B: página /fotos

- **CA-11 Adicionar foto ligado.** Dado menos de cinco fotos vivas, quando o cliente ativa "Adicionar foto" e escolhe um JPG, PNG ou WebP, então o envio segue reduzir, emitir com o tamanho reduzido, enviar e finalizar, e a foto aparece na lista como "Enviando" e depois segue o fluxo normal. Prova: teste de página com DOM simulado e portas falsas, incluindo a ligação real de `adicionarFoto` (o teste atual cobre só `enviarFoto`).
- **CA-12 Limite de cinco no cliente.** Dado cinco fotos vivas, quando o cliente ativa o botão, então o botão fica `aria-disabled`, a mensagem de limite é anunciada e o seletor não abre. O servidor continua recusando a sexta com 422 `photo_limit`. Prova: teste de página e de rota.
- **CA-13 Arquivo público sem build frágil.** Dado o build atual (`copy-tokens` e `tsc`), quando o novo passo de geração do script público roda, então `corepack pnpm check:all` passa, o arquivo gerado fica fora do git (como `tokens.css`), e a página carrega só scripts da própria origem. Prova: `check:all` e teste estático de `fotos.html`.
- **CA-14 CSP sem afrouxar.** Dado a entrada de `/fotos` em `vercel.json`, quando a página envia a foto, então `script-src` continua `'self'` (sem `unsafe-inline`, sem `unsafe-eval`, sem origem externa de script), `connect-src` só mantém `'self'` e a origem do Storage já aprovada na decisão 149, e `img-src` continua `blob:`. Nenhuma CSP nova. Prova: teste estático sobre `vercel.json` e verificação manual no navegador `[NÃO VERIFICADO]`.
- **CA-15 Redução com paridade.** Dado a mesma foto, quando reduzida no navegador e no servidor com as mesmas constantes de domínio, então as dimensões calculadas e a escada de qualidade são idênticas (uma só fonte, ou teste de paridade que falha se divergirem). Prova: teste de paridade com um conjunto de tamanhos de imagem.
- **CA-16 Fallback sem redução.** Dado um navegador sem `createImageBitmap` com a opção de orientação, ou sem canvas, ou com decodificação falha, quando a foto é enviada, então vai o original com o tipo declarado (se até 10 MB), e o servidor decide. Prova: teste de página com portas falsas.
- **CA-17 Exclusão cancela o envio.** Dado uma foto que esta aba está enviando, quando o cliente a exclui, então o envio em curso é cancelado (`AbortController`) antes do `DELETE`, e a foto sai da lista só depois da confirmação do servidor. Prova: teste de página com `fetch` falso que aceita o cancelamento.
- **CA-18 Aviso e sem canal extra.** Dado a página com ou sem fotos, quando é aberta, então o aviso de fachada, interior e rostos continua visível (decisão 135), e não há nenhum botão ou link para WhatsApp ou outro canal de foto. Prova: teste de página já existente, mantido.

## 6. Casos de borda

| # | Caso | Comportamento esperado |
|---|---|---|
| B1 | Aba aberta com cookie de rascunho vencido ou descartado | Emissão e lista respondem 404; a tela mostra o texto de rascunho vencido e não tenta de novo (CA-09 de 98). |
| B2 | Cookie malformado, ausente ou duplicado | 404 sem banco e sem Storage (CA-03). |
| B3 | Foto maior que 10 MB que não reduz no navegador | O cliente recusa antes de chamar a API (`arquivo_grande`), com texto aprovado (P-141-6). |
| B4 | HEIC ou HEIF | O navegador tenta reduzir; se não decodifica, envia o original, e o servidor responde 415. A tela mostra o texto de tipo não aceito (P-141-6). |
| B5 | Foto que decodifica mas não cabe no teto | Servidor recusa com `nao_cabe_no_limite` (422); a tela mostra o motivo fixo da §5 de 98. |
| B6 | Falha de rede no `PUT` para o Storage | A foto fica como enviando sem `finalize`; o TTL de 30 min e o varredor de órfãos resolvem. A tela pede "Tentar de novo" ou a exclusão, com texto aprovado. |
| B7 | Aba fechada no meio do envio | Foto pendente vira órfã e é recolhida pelo TTL e pelo varredor. Sem efeito na lista de outra aba. |
| B8 | 429 na emissão | Texto de muitas ações, sem número (CA-09 de 98). |
| B9 | Duas emissões seguidas com o mesmo `client_upload_id` | Repetição: mesma foto, sem nova vaga (CA-04 de 88). A tela não duplica o cartão. |
| B10 | Navegador sem `crypto.randomUUID` | Sem geração de `client_upload_id`, o envio não começa e a tela mostra o texto de navegador indisponível. Verificar suporte mínimo (NÃO VERIFICADO). |
| B11 | Ordem que muda em outra aba durante um envio | Reordenação recebe 409 e recarrega (CA-08 de 98). O envio em curso não é afetado. |
| B12 | Redução demora perto de 10 s | O servidor finaliza com 503 `Retry-After`, sem rejeitar; o polling repete o `finalize` (até 20 vezes). |
| B13 | Storage com origem fora da CSP | Erro de rede no `PUT`; é o caso que a CSP da decisão 149 evita. Verificar em navegador (NÃO VERIFICADO). |

## 7. Dependências, riscos e condições

### 7.1 Dependências

- `[VERIFICADO]` #39, #40 e #41 estão no fluxo de mídia, e o código delas é a base. #42 está em "Aguardando aprovação" com ressalva (rodada 41 de `11-DECISOES.md`): a ligação do envio e a composição ficam para #141.
- `[VERIFICADO]` Condição 3 de 88 §8 (expurgo agendado, H-110). Sem ela, o fluxo não abre para visitante real. Esta história monta a rota, mas a liberação em produção depende do líder (P-141-1).
- `[VERIFICADO]` Decisão 150 (rodada 41): a rotação das senhas do banco de desenvolvimento foi pedida após um comando imprimir linhas do `.env.local`. Não é bloqueio técnico, mas o teste ponta a ponta (CA-10) usa o banco de desenvolvimento e deve esperar a decisão do usuário sobre rotação (P-141-8).
- `[VERIFICADO]` Triagem #140 (db:test): a rodada 41 registra instabilidade de timeout em T-H013-03 e falhas fora da #49. Os testes novos de banco não devem ser lidos como verdes sem o resultado de `db:test` registrado.
- `[VERIFICADO]` Carga do `sharp` em Linux (93 §8, decisão 41). Sem a carga, a redução do servidor pode responder 503 na Vercel. A montagem não é bloqueada por isso, mas a aceitação de risco é do líder (P-141-9).
- `[NÃO VERIFICADO]` Migração `20261112190000` aplicada no desenvolvimento.

### 7.2 Riscos

| # | Risco | Tratamento proposto |
|---|---|---|
| R1 | Abrir o fluxo a visitantes reais sem a condição 3 de 88 §8 | Montar com liberação explícita fora de produção por padrão (P-141-1). |
| R2 | 404 diferente quando a mídia não está montada (§2.2) revela configuração | CA-03 com comparação byte a byte; tratar no ponto de montagem. |
| R3 | Segredo de Storage ou de banco em log ou em resposta | CA-02 e CA-05; nomes e não valores. Nenhum comando de pesquisa sobre `.env.local`. |
| R4 | CSP quebra o envio, ou alguém relaxa a CSP para fazê-lo funcionar | CA-14: nenhuma CSP nova; origem do Storage só a já aprovada. |
| R5 | Bundle público grande ou versão do navegador divergente da do servidor | Passo de geração com paridade (CA-15); medir o tamanho do arquivo gerado (P-141-5); custo zero (ver §7.3). |
| R6 | Duas cópias das mesmas constantes (navegador e servidor) divergirem | Uma só fonte no domínio, gerada no build, ou teste de paridade que falha. |
| R7 | Redução do servidor sem carga do `sharp` em Linux | Falha de carga vira 503 sem rejeitar (93 §8); verificar no primeiro preview. |
| R8 | Foto órfã acumula cota do Storage (1 GB gratuito) | TTL de 30 min e varredor de órfãos de 3 h (88 §3); limite global de 150 vagas vivas. |
| R9 | Exclusão de foto em envio deixa objeto sem linha | CA-17 com `AbortController` e expurgo do rascunho. |
| R10 | Dois testes de banco novos sobre o mesmo banco de desenvolvimento e um só DEV | Rodar `db:test` em série, como já é feito. |

### 7.3 Custo zero

- Nenhum serviço pago novo. Supabase (Storage e banco) e Vercel no plano gratuito, conforme a regra do projeto. Os limites atuais dos planos `[NÃO VERIFICADO]`.
- Ferramentas de build: `tsc` (já existe) e, se for escolhido, esbuild (licença livre, mas hoje só aparece em `docs/factory/spikes/s09`; entraria como dependência de desenvolvimento). Sem Docker e sem WSL.

## 8. Dúvidas de processo que o líder deve confirmar

- Migrações: a rodada "Incidente de processo" de `11-DECISOES.md` registra que as migrações foram aplicadas por `corepack pnpm db:migrate`, e não por `npx supabase db push`. A regra do projeto diz `npx supabase`. Se a migração `20261112190000` tiver sido aplicada pelo outro caminho, a conferência de CA-09 e CA-10 precisa dizer isso (P-141-10).

## 9. Perguntas abertas

Numeração local deste refino (`P-141-n`). Quem consolida é o líder, com numeração contínua da sessão. Nenhuma pergunta foi enviada ao usuário.

- **P-141-1 Liberação em produção.** O que fazer com a rota de mídia em produção enquanto a condição 3 de 88 §8 não está pronta (H-110)?
  - Alternativa A: montar o código e a rota só quando uma variável explícita de liberação estiver presente, e deixá-la ausente em produção. Recomendação.
  - Alternativa B: montar em produção desde já. Contraria 88 §8.
  - Alternativa C: montar só em preview e desenvolvimento, sem variável nova, pelo ambiente da Vercel.
  - Decisão que destrava: CA-01 em produção e a liberação de #141 para concluir.
- **P-141-2 Galeria: pedido de conclusão da #42.** A #42 pode ser concluída sem #141 ou só com #141?
  - Alternativa A: a #42 só é concluída depois de #141, para que a galeria funcione de ponta a ponta. Recomendação.
  - Alternativa B: concluir #42 agora, com a ressalva de que a galeria responde 404 em produção até #141.
  - Decisão que destrava: a decisão humana de CONCLUIR a #42.
- **P-141-3 Nomes das variáveis de Storage.** A mídia reaproveita `SUPABASE_URL` e `SUPABASE_SECRET_KEY`, já usados em `professional-composicao.ts`?
  - Alternativa A: reaproveitar os mesmos nomes (uma só credencial de Storage no servidor). Recomendação.
  - Alternativa B: nomes próprios para a mídia (`MEDIA_STORAGE_URL` e similares). Mais isolamento, mais nomes para configurar.
  - Decisão que destrava: CA-02 e a lista de pendências.
- **P-141-4 Galeria separada ou tudo ou nada.** As rotas da galeria ligam separadas do upload?
  - Alternativa A: separadas, cada grupo com as próprias pendências. Recomendação. Casa com `MediaRouteOptions.galeria` opcional.
  - Alternativa B: tudo ou nada, a galeria só liga com todo o conjunto.
  - Decisão que destrava: CA-04.
- **P-141-5 Como o navegador recebe a redução.** Como gerar o script público de `/fotos` sem quebrar o padrão?
  - Alternativa A: esbuild (dependência de desenvolvimento gratuita) gera um arquivo em `apps/web/public`, ignorado pelo git, como `tokens.css`. Recomendação, porque resolve o import de `@fastpro/domain` sem duplicar regra.
  - Alternativa B: passo próprio com `tsc` e cópia dos módulos puros de domínio, sem bundler. Mais trabalho, sem dependência nova.
  - Alternativa C: arquivo JavaScript escrito à mão, com as constantes copiadas e teste de paridade. Mais simples, com risco de divergência.
  - Decisão que destrava: CA-13 e CA-15. Para o Architect, com o tamanho do arquivo gerado como critério.
- **P-141-6 Textos novos.** Aprovar os textos para os casos sem texto na §5 de 98:
  - arquivo grande demais no navegador: "Esta foto é grande demais. Escolha uma foto de até 10 MB.";
  - tipo não aceito (HEIC, GIF e outros): "Este tipo de arquivo não é aceito. Use JPG, PNG ou WebP.";
  - falha de envio (503 ou rede): "Não foi possível enviar esta foto. Tente de novo.".
  - Recomendação: aprovar como estão. Pela regra da #42, nenhum texto vai a QA sem aprovação.
  - Decisão que destrava: CA-11 e os casos B3, B4 e B6.
- **P-141-7 Exclusão durante envio.** A ligação do `AbortController` (CA-17) entra em #141?
  - Alternativa A: entra em #141, porque é pendência da #42 que a QA aceitou com ressalva. Recomendação.
  - Alternativa B: vira Issue própria no backlog.
  - Decisão que destrava: CA-17.
- **P-141-8 Rotação de senhas do banco de desenvolvimento (decisão 150).** O teste ponta a ponta (CA-10) deve esperar essa decisão?
  - Alternativa A: rotacionar antes do CA-10. Recomendação.
  - Alternativa B: seguir sem rotação, com registro de risco aceito.
  - Decisão que destrava: a execução de CA-10 em desenvolvimento. Decisão do usuário, pedida pelo líder.
- **P-141-9 Redução sem carga verificada do `sharp`.** Aceitar ligar a redução no servidor antes de verificar a carga em Linux (93 §8)?
  - Alternativa A: aceitar em desenvolvimento e em preview, com 503 seguro. Recomendação, desde que a produção continue fechada pela P-141-1.
  - Alternativa B: só ligar depois da verificação em Linux, que hoje não tem caminho gratuito sem WSL.
  - Decisão que destrava: montagem da redução (CA-01) em desenvolvimento.
- **P-141-10 Caminho de migração.** Confirmar que novas migrações seguem `npx supabase`, e aceitar ou não o desvio registrado (`db:migrate`) para a `20261112190000`.
  - Alternativa A: exigir `npx supabase` daqui em diante e conferir o estado da migração antes de CA-09. Recomendação.
  - Alternativa B: formalizar `db:migrate` como caminho oficial, com atualização de AGENTS.md pelo líder.
  - Decisão que destrava: CA-09 e CA-10.

Para o Architect (técnico, não de produto): forma do ponto de montagem (arquivo novo, nomes das pendências, opções), reaproveitamento do cliente SQL do papel `app_api` com o rascunho (uma fábrica por URL), ponto único de 404 uniforme (CA-03), e escolha entre as opções de P-141-5.

## 10. Evidência exigida (quando a história for executada)

Registrada na Issue #141, em comentário técnico com comando, contagem e código de saída de cada execução local: `corepack pnpm check:all`, `corepack pnpm db:test` (com o arquivo de banco novo), o roteiro de CA-10 por passo, a comparação de 404 de CA-03 e o resultado dos testes de página de CA-11 a CA-18. Não declarar CI verde. Vercel, Linux, navegador real e CSP em execução ficam `NÃO VERIFICADO` até a conferência manual.

## 11. Registro de commit

- `NÃO COMMITADO`: este ambiente não tem shell, então `git add` e `git commit` não foram executados. O líder deve fazer o commit com a mensagem `docs(E3): refino da composicao da midia (#141)`, restrito ao caminho `docs/factory/102-REFINO-MIDIA-COMPOSICAO.md`, com as duas linhas de rodapé pedidas.
- Nenhum código foi escrito. Nenhum arquivo além deste foi criado ou alterado.
