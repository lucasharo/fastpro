# Desenho E3 — Composição da rota de mídia na API e ligação do envio em /fotos (Issue #141, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante para o desenvolvimento. P-141-5 decidida (§4: esbuild, alternativa A do PO). Dúvidas do líder em §11.
- **Rastro:** `102-REFINO-MIDIA-COMPOSICAO` (CA-01..CA-18, P-141-1..10, decisões 151 a 156 adotadas como recomendadas); 88-DESENHO-H026 (§1 rotas, §8 condição 3); 93-DESENHO-H027 (§4.4 redução no navegador, §8 carga do `sharp`); 98-DESENHO-H029 (§1 galeria, §4.3 exclusão durante envio); decisão 149 (origem do Storage na CSP de `/fotos`); `99-DESENHO-H036` como modelo de formato e `professional-offering-composicao.ts` como modelo de montagem.
- **Natureza:** somente documento. Nenhum código, teste ou configuração foi criado ou alterado. Nada foi executado (sem build, sem teste, sem acesso a banco ou Storage). O arquivo `.env.local` não foi lido nem pesquisado.
- **Etiquetas:** `[DECIDIDO]` líder ou dono do produto · `[VERIFICADO]` lido no repositório nesta leitura · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem leitura ou sem execução.

## 0. Situação encontrada (conferida no código)
1. `[VERIFICADO]` `app.ts` já despacha `if (opts.media && isMediaRoute(path))` (antes do catálogo). Sem `media`, cai no fim do roteador em `send(res, 404, NO_STORE, '')` (corpo vazio), enquanto `draftNotFound()` responde `json(404, DRAFT_NOT_FOUND_BODY)` com `DRAFT_HEADERS`. Os dois 404 diferem: é a fuga de informação do refino §2.2.
2. `[VERIFICADO]` `vercel.ts` monta tudo a cada chamada com `montarIntegracoes(process.env, { abrirClienteSql, fabricaCatalogo, fabricaRascunho })` e repassa cada opção a `handleRequest` com `...(x !== undefined ? { x } : {})`. Não há opção `media`. `fabricaRascunho = criarFabricaRascunho(abrirClienteSql)` memoiza o cliente SQL por URL **dentro da fábrica do rascunho**; a oferta e a sugestão usam `memoizarCliente(abrirClienteSql)` à parte.
3. `[VERIFICADO]` `Integracoes` (composicao.ts, linhas 87 a 114) não tem campo de mídia. O padrão a seguir é o par `professionalOffering` / `pendenciasOferta`, preenchido por `montarOfertaProfissional(env, { abrirCliente, relogio })` que devolve `{ options, pendencias }` com cliente memoizado em `Map` de módulo.
4. `[VERIFICADO]` Portas de mídia: `MediaDeps { store, storage, rate, hasher, clock, globalCap?, reduce }`; `ReduceDeps { store, storage, reducer, gate: ReduceGate, contadores: ReduceCounters }`; `GalleryDeps { gallery, reader, storage, store, rate, hasher, clock, contador? }`. Adaptadores: `PgMediaStore(client)`, `PgMediaGallery(client)`, `SupabaseQuarantineStorage`, `SupabaseMediaReduceStorage`, `SupabaseReducedPhotoReader`, todos com `QuarantineStorageOpcoes { baseUrl, serviceKey, fetchImpl? }`. `SharpImageReducer` carrega `sharp` de forma preguiçosa e devolve transitório `unavailable` (503) se não carregar.
5. `[VERIFICADO]` O rascunho usa `DATABASE_URL_APP_API`, `DRAFT_IP_HMAC_KEY` (mínimo `DRAFT_IP_KEY_MIN_LENGTH`) e `SITE_URL`, com `faltantesRascunho(env)` devolvendo nomes e a marca `(curta)`. `PgDraftRate(cliente)` e `createDraftHasher(chave)` são as portas `rate` e `hasher` que a mídia também precisa.
6. `[VERIFICADO]` `SUPABASE_URL` e `SUPABASE_SECRET_KEY` já são nomes usados por `consumo-link-composicao.ts` e constam em `.env.example`; `DATABASE_URL_APP_API` e `DRAFT_IP_HMAC_KEY` também. `MEDIA_*` não consta em `.env.example`.
7. `[VERIFICADO]` `fotos.js` é script clássico (IIFE sobre `globalThis`), expõe só `globalThis.FastProFotos`; a página liga `montarFotos(raiz, { documento, fetch })` sem `adicionarFoto`. A página já chama `POST /api/v1/media/{id}/finalize` (linha 373, no polling de cartões em estado `enviando`, limite `CONSULTAS_MAX = 20`) e tem `criarPedir(fetchImpl)` (mesma origem, JSON). Não há `AbortController`, nem `crypto.randomUUID`, nem `<input type=file>`.
8. `[VERIFICADO]` `fotos-page.test.ts` executa `fotos.js` num sandbox `vm` (`vm.runInContext(FOTOS_JS, sandbox)`), com DOM simulado próprio. `reduzir-foto.test.ts` cobre `prepararEnvio` e `enviarFoto` com portas falsas.
9. `[VERIFICADO]` `reduzir-foto.ts` importa `MEDIA_MAX_BYTES`, `escolherSaidaJpeg`, `planoDimensoes` de `@fastpro/domain`. O pacote `domain` é ESM, só exporta `"."` (barril `dist/index.js` com `export *` de todos os módulos), sem campo `sideEffects`. `reduce.ts` e `media.ts` só importam tipos (puros).
10. `[VERIFICADO]` `apps/web`: `build = copy-tokens + tsc`, `test = copy-tokens + vitest`; nenhum bundler. `apps/web/public/tokens.css` é gerado e está no `.gitignore` (precedente). `vercel.json` de `/fotos` já tem `script-src 'self'; connect-src 'self' https://<projeto>.supabase.co; img-src blob:` (decisão 149).
11. `[VERIFICADO]` `turbo.json`: `build`, `lint`, `typecheck` e `test` dependem de `^build` (o `dist` do `domain` existe antes de qualquer script de `web`).

## 1. Princípios
1. **Fechado por padrão.** Sem a variável de liberação, nenhuma rota de mídia existe. A liberação em produção é uma ação deliberada e fica fora desta Issue (H-110 / condição 3 de 88 §8).
2. **Um único 404.** Montada ou não, rota ausente, cookie ausente ou item alheio respondem o mesmo 404 (corpo e cabeçalhos de `draftNotFound()`).
3. **Montagem pura sobre o ambiente.** Não abre conexão, não faz I/O e não registra valores; só nomes nas pendências (padrão `faltantesRascunho`).
4. **Menor privilégio e um pool.** Só o papel `app_api` e o Storage por chave de serviço do servidor; um cliente SQL por URL, compartilhado com o rascunho.
5. **Uma fonte de regra de redução.** O navegador e o servidor usam as mesmas funções do domínio (`planoDimensoes`, `escolherSaidaJpeg`, constantes), sem cópia.
6. **Sem CSP nova, sem script externo, sem módulo.** O navegador recebe um segundo arquivo estático da própria origem.

## 2. Composição na API
### 2.1 Arquivo novo e assinatura `[PROPOSTA]`
`apps/api/src/media/media-composicao.ts` (junto das rotas; segue `professional-offering-composicao.ts`):

```
montarMidia(env, opcoes): { options: MediaRouteOptions | undefined,
                            pendencias: readonly string[] }
opcoes: { abrirCliente?: (url) => SqlClient   // já memoizado (ver 2.3)
          fetchImpl?: typeof fetch            // Storage; teste injeta fake
          relogio?: { nowMs(): number }
          reducer?: ImageReducerPort          // padrão: new SharpImageReducer()
          reducao?: { gate: ReduceGate; contadores: ReduceCounters }   // da instância
        }
```
- Funções internas separadas `montarUpload` e `montarGaleria` (galeria depende do mesmo cliente, hasher e `rate`, mais `PgMediaGallery`, `SupabaseReducedPhotoReader` e `SupabaseMediaReduceStorage`). Se o upload não monta, nada monta (`options: undefined`). Se o upload monta e a galeria não (por exemplo, `opcoes` sem os itens da galeria nos testes), `options` sai sem `galeria` e `pendencias` traz o item `portas da galeria (ainda nao montadas na funcao)`. É o mesmo mecanismo do precedente "fábrica do cliente SQL (ainda não montada na função)"; não há segunda variável de ambiente (ver pergunta A-141-2).
- Exporta `MEDIA_LIBERACAO_ENV = 'MEDIA_UPLOAD_ENABLED'`, `MEDIA_ENV_OBRIGATORIAS = ['DATABASE_URL_APP_API','DRAFT_IP_HMAC_KEY','SITE_URL','SUPABASE_URL','SUPABASE_SECRET_KEY']` e `faltantesMidia(env)`.

### 2.2 Variável de liberação e pendências (CA-02, CA-03) `[PROPOSTA]`
- **Liberação:** `MEDIA_UPLOAD_ENABLED` com o valor exato `1`. Qualquer outro valor ou ausência ⇒ fechado, com a pendência `MEDIA_UPLOAD_ENABLED (liberacao explicita)`. Vale em **todos** os ambientes (ausente = fechado, inclusive em desenvolvimento): o desenvolvimento a define no `.env.local`; a produção da Vercel **não** a define. Escolha deliberada por falhar fechado e não ler `APP_ENV` (a lista de ambientes da Vercel e o `APP_ENV` não são a mesma coisa).
- **Pendências** (somente nomes, sem tamanho): a liberação; cada item de `MEDIA_ENV_OBRIGATORIAS` vazio; `DRAFT_IP_HMAC_KEY (curta)` quando menor que `DRAFT_IP_KEY_MIN_LENGTH` (reusa `faltantesRascunho` para os três nomes do rascunho, sem reescrever a regra); `fabrica do cliente SQL da midia (ainda nao montada na funcao)` quando o ambiente está completo e `abrirCliente` falta.
- `SITE_URL` malformada: `siteOriginOf` pode lançar; a montagem captura e acrescenta a pendência `SITE_URL (invalida)`, sem eco do valor. `[NÃO VERIFICADO]` se `siteOriginOf` lança ou devolve vazio; o DEV confere.
- `Integracoes` ganha `media: MediaRouteOptions | undefined` e `pendenciasMidia: readonly string[]`; `montarIntegracoes` chama `montarMidia` (como faz com `montarOfertaProfissional`). `[NÃO VERIFICADO]` quem consome `pendencias*` hoje (log de partida, diagnóstico); o DEV mantém o consumo igual.

### 2.3 Cliente SQL, reduzir e instância (CA-06) `[PROPOSTA]`
- **Um pool `app_api` por URL**: em `vercel.ts`, `const abrirClienteApi = memoizarCliente(abrirClienteSql)` e **a mesma** função passada a `criarFabricaRascunho(abrirClienteApi)` e a `montarMidia`. Hoje o rascunho memoiza dentro da fábrica; sem compartilhar, a mídia abriria um segundo pool para a mesma URL, o que pesa no limite de conexões do plano gratuito do banco (`[NÃO VERIFICADO]` o limite). Efeito colateral: a linha 25 de `vercel.ts` muda de `criarFabricaRascunho(abrirClienteSql)` para `criarFabricaRascunho(abrirClienteApi)` (comportamento igual, pool compartilhado).
- **`ReduceGate` e `ReduceCounters` são de instância**, não de chamada: `vercel.ts` os cria **uma vez no módulo** (`const reducao = { gate: new ReduceGate(), contadores: new ReduceCounters() }`) e os passa a `montarMidia`. Se fossem criados a cada requisição, o limite de reduções simultâneas por instância (`MEDIA_REDUCE_MAX_CONCURRENT`, orçamento de pixels) nunca barraria nada. Teste: duas chamadas a `montarMidia` com a mesma `reducao` compartilham o `gate`.
- `MediaDeps.reduce = { store, storage: SupabaseMediaReduceStorage, reducer, gate, contadores }`, com o `store` igual ao `PgMediaStore` (mesma instância por montagem).
- `clock`: `{ nowMs: () => Date.now() }` se `relogio` não vier. Sem `globalCap` explícito (padrão `MEDIA_GLOBAL_CAP`).
- Credenciais do Storage: lidas de `env.SUPABASE_URL` e `env.SUPABASE_SECRET_KEY` (A: reaproveitar, decisão 153). Passadas só ao construtor dos três adaptadores; nunca a `options` serializáveis, nunca a log. Os adaptadores já registram só nomes fixos.

### 2.4 `vercel.ts` e `app.ts`
- `vercel.ts`: `...(integracoes.media !== undefined ? { media: integracoes.media } : {})` ao lado de `drafts`. Nada mais.
- `app.ts`, **404 uniforme sem montagem** (CA-03): depois do bloco `if (opts.media && isMediaRoute(path))`, acrescentar `if (isMediaRoute(path)) { const r = draftNotFound(); res.writeHead(r.status, r.headers); res.end(r.body); return; }`. `isMediaRoute` só casa `/v1/media` e `/v1/media/…`, então nenhuma outra rota é afetada. Sem rota de leitura de arquivo nem eco do caminho. `[NÃO VERIFICADO]` se `app.test.ts` ou outro teste afirma o 404 de corpo vazio para `/v1/media/*` sem `media` (o DEV ajusta a expectativa para o 404 uniforme e registra).
- **Resíduo aceito:** com a mídia montada, `Origin` estrangeira em POST/PUT/DELETE recebe 403 `origem_invalida` antes do cookie, enquanto não montada recebe 404. Quem manda `Origin` estrangeira distingue os dois estados. É o mesmo comportamento do rascunho (a checagem de origem vem primeiro por desenho 88 §1) e o estado de montagem não é segredo de valor; não se muda a ordem das checagens nesta Issue. Para GET o `checkDraftOrigin` não exige origem; o caso de CA-03 compara os mesmos pedidos (sem cookie, `Origin` correta).

### 2.5 Sequência de montagem por chamada
`montarIntegracoes` → `montarMidia(env, { abrirCliente: abrirClienteApi, reducao, ... })` → `faltantesMidia` → (se vazio) clientes e adaptadores → `{ options, pendencias: [] }`. Construir adaptadores não consulta o banco nem o Storage (CA-03: nenhuma chamada quando fechado). Custo por requisição: alocações de objetos finos; pool e `gate` reaproveitados.

## 3. Segurança, observabilidade e privacidade
1. Papel do banco: apenas `DATABASE_URL_APP_API` (CA-06); a montagem nunca lê `DATABASE_URL_APP_SYSTEM`. O teste usa fábrica espiã e confere a URL recebida (comparação com a sentinela, nunca impressa).
2. `SUPABASE_SECRET_KEY` só vai ao construtor. CA-05: o teste usa sentinelas distintas nas cinco variáveis, exercita sucesso, recusa (404/403/422), falha de Storage (503) e de banco, captura `console.*`, `process.stdout/stderr.write` e todas as respostas, e varre por substring. `check:logs` e `check:secrets` seguem rodando.
3. Leitura de imagem só no bucket fixo `request-photos` (`MEDIA_REDUCED_BUCKET`) pela porta estreita `SupabaseReducedPhotoReader`; o teste de espião (G-04 de 98) roda sobre a montagem real com `fetchImpl` falso que registra os caminhos pedidos e falha se aparecer `quarantine/` em GET (CA-08).
4. Resposta de imagem mantém os cabeçalhos já testados (`IMAGEM_HEADERS`). Nada novo.
5. Métrica/log: só nomes fixos já existentes (`GaleriaContador`, `ReduceCounters`). Nenhum identificador de foto ou de rascunho.

## 4. P-141-5: script público de `/fotos` a partir de `reduzir-foto.ts` (decisão)
### 4.1 Alternativas avaliadas
| Alt. | O que é | Prós | Contras | Veredito |
|---|---|---|---|---|
| A | esbuild, devDependency de `apps/web`, gera `public/fotos-envio.js` (IIFE, minificado), ignorado pelo git | Reusa `reduzir-foto.ts` **testado** e o domínio, uma só regra (CA-15); sem módulo no navegador; CSP intacta; custo zero (MIT) | Dependência nova de desenvolvimento; binário nativo por plataforma; passo a mais no build | **Escolhida** |
| B | `tsc` emite ESM e copia `dist` | Sem dependência nova | O navegador não resolve `@fastpro/domain` (especificador "nu"); import map é script embutido (viola `script-src 'self'`) e `type=module` exigiria reescrever imports: é um bundler caseiro | Rejeitada |
| C | JavaScript à mão com constantes copiadas e teste de paridade | Sem dependência, ~2 KB | Duplica `planoDimensoes` e `escolherSaidaJpeg`; `reduzir-foto.ts` vira código morto em produção e `reduzir-foto.test.ts` deixa de provar o que roda; paridade só por teste | Rejeitada (reserva se A falhar na instalação, ver §4.4) |
| D | Usar o bundler que o `vitest` traz de forma transitiva | Nada a instalar | Dependência não declarada, muda sem aviso, sem contrato estável | Rejeitada |

### 4.2 Desenho da alternativa A `[PROPOSTA]`
- **Entrada** `apps/web/src/media/fotos-entrada.ts` (nova): importa `enviarFoto` de `reduzir-foto.ts` e `criarPortasNavegador` de `portas-navegador.ts` (nova) e define `globalThis.FastProFotosEnvio = { disponivel(): boolean, enviar(arquivo, tipo, { emitir, enviar }): Promise<…> }`, onde `enviar` chama `enviarFoto({ arquivo, tipoDeclarado, portas, emitir, enviar })`. Sem efeito colateral na carga além de atribuir o global.
- **`portas-navegador.ts`** (nova): implementa `PortasNavegador` sobre um objeto `ambiente` injetado com tipos estruturais mínimos (para não exigir `lib: DOM` no `tsconfig` de `web`, que hoje usa `types: ["node"]`; `[NÃO VERIFICADO]` a `lib` do `tsconfig.base`). `decodificar`: `createImageBitmap(arquivo, { imageOrientation: 'from-image' })`; se a função ou a opção não existir ou lançar, devolve `null` (fallback CA-16). `codificar`: `OffscreenCanvas` quando existir, senão `<canvas>` do documento; **preenche fundo branco antes do `drawImage`** (PNG/WebP com transparência não pode virar preto no JPEG); `toBlob`/`convertToBlob('image/jpeg', qualidade)`; fecha o bitmap (`close()`) ao fim; devolve `null` em qualquer falha.
- **Gerador** `apps/web/scripts/build-fotos-envio.mjs` (novo, mesmo estilo de `copy-tokens.mjs`): `esbuild.buildSync`/`build` com `entryPoints: [src/media/fotos-entrada.ts]`, `bundle: true`, `format: 'iife'`, `platform: 'browser'`, `target: 'es2020'`, `minify: true`, `legalComments: 'none'`, `outfile: public/fotos-envio.js`, `logLevel: 'error'`. A resolução de `@fastpro/domain` vem do `dist` (garantido por `^build`). Falha com mensagem fixa e código de saída 1 se o `dist` do domínio faltar (como `copy-tokens`). Imprime só o tamanho em bytes.
- **Scripts do `apps/web/package.json`** (alterados): `build` = `copy-tokens && build-fotos-envio && tsc -p …`; `test` = `copy-tokens && build-fotos-envio && vitest run`; novo `build:fotos-envio`. `typecheck` não gera arquivos.
- **`.gitignore`**: `apps/web/public/fotos-envio.js` (junto de `tokens.css`; o arquivo gerado não é versionado e não entra em `check:hex`/`check:typography`).
- **`fotos.html`**: `<script src="/fotos-envio.js"></script>` **antes** de `<script src="/fotos.js">`. Se o arquivo não carregar (404, cache, versão), `FastProFotosEnvio` fica indefinido e o botão permanece desativado com o texto atual de "indisponível neste navegador": falha segura, sem exceção.
- **Tamanho esperado** `[NÃO VERIFICADO]`: com a ressalva abaixo, de 3 a 8 KB minificados (o código de `reduzir-foto.ts` mede 3,6 KB sem minificar; `planoDimensoes`, `escolherSaidaJpeg` e constantes são pequenas). **Orçamento: 20 KB minificados (sem gzip)**, imposto por teste (CA-13). Para evitar que o barril `export *` do domínio arraste módulos de outros assuntos, acrescentar `"sideEffects": false` ao `packages/domain/package.json` (o domínio é "regras puras sem I/O"); sem isso o esbuild retém instruções de módulo com possível efeito e o arquivo pode crescer. Se mesmo assim passar do orçamento, o fallback é um subcaminho `@fastpro/domain/media-reduce` no mapa `exports` (decisão do líder, A-141-5). O DEV mede e registra o tamanho real na Issue.
- **Pontos a conferir antes de implementar** `[NÃO VERIFICADO]`: (a) se o `pnpm` do repositório exige aprovar o script de instalação do esbuild (`onlyBuiltDependencies` em `package.json`/`pnpm-workspace.yaml`); o esbuild moderno usa pacote de binário por plataforma e geralmente dispensa o script; (b) se `check:deps` (`check-workspace-deps.mjs`) rejeita devDependency nova; (c) a versão: fixar exata, como o repositório faz com `vitest`; (d) como a Vercel gera `apps/web` (comando de build do projeto): `tokens.css` já depende do mesmo mecanismo, então `fotos-envio.js` chega junto se o `build` do `web` rodar na implantação.
### 4.3 Por que não gerar em `postinstall` ou commitar o arquivo
Gerar no `build` espelha `tokens.css`. Commitar um bundle minificado esconde divergência do código-fonte e atrapalha a revisão; o teste de paridade (§8, CA-15) falharia só se alguém lembrasse de regerar.
### 4.4 Plano de reserva
Se a instalação do esbuild for bloqueada (política do `check:deps` ou do `pnpm`), cair na alternativa C **com** teste de paridade que compara a saída do arquivo à mão com `planoDimensoes`/`MEDIA_REDUCE_QUALITY_STEPS` do domínio para uma tabela de dimensões, e registrar a decisão na Issue. Isto muda o desenho e volta ao líder.

## 5. Página `/fotos`: ligação do envio e exclusão com cancelamento
### 5.1 Contrato de `montarFotos` `[PROPOSTA]`
- Nova opção opcional `opcoes.envio` (a porta do §4.2: `{ disponivel(), enviar(arquivo, tipo, { emitir, enviar }) }`) e `opcoes.sortear` opcional para `client_upload_id` (padrão: `globalThis.crypto.randomUUID`). A opção atual `adicionarFoto` **continua** válida (os testes existentes e CA-12 dependem dela). Se `adicionarFoto` não vier e `envio` vier e `envio.disponivel()` for verdadeiro, `montarFotos` usa o fluxo interno abaixo; caso contrário o botão segue `aria-disabled` com `TEXTOS.indisponivelNoNavegador`.
- O bootstrap da página (fim de `fotos.js`) passa `envio: janela.FastProFotosEnvio` quando existir.
- `[NÃO VERIFICADO]` a forma exata do corpo de `POST /v1/media/uploads` e do JSON de resposta (`upload_url`, `id`); o DEV lê `parseMediaEmissaoBody` e `issueMedia` (o refino cita `client_upload_id`, `content_type`, `size_bytes` e `upload_url`).

### 5.2 Fluxo interno de "Adicionar foto" (CA-11, CA-12, CA-16)
1. Clique: se já há cinco vivas, anuncia `TEXTOS.limite` e não abre o seletor (já existe).
2. Cria (uma vez) `<input type="file" accept="image/jpeg,image/png,image/webp" hidden>`, `click()`, e no `change` pega o primeiro arquivo e zera o valor.
3. **Não há pré-recusa por tipo no cliente** (decisão do desenho, ver A-141-3): o tipo declarado vai ao servidor, que decide por conteúdo (96-DESENHO-H028). HEIC/GIF recebem 415 e o texto de "tipo não aceito" (B4). Tamanho acima de `MEDIA_MAX_BYTES` sem redução possível: `enviarFoto` devolve `{ code: 'arquivo_grande' }` e a tela mostra o texto aprovado (B3).
4. Sem `crypto.randomUUID` ou sem `AbortController`: o envio não começa; texto de navegador indisponível (B10). `AbortController` ausente é tratado do mesmo modo para nunca existir envio não cancelável.
5. `enviarFoto({ arquivo, tipoDeclarado, portas, emitir, enviar })` (reduz → emite com o tamanho reduzido → envia):
   - `emitir`: `pedir('POST', '/api/v1/media/uploads', { client_upload_id, content_type, size_bytes })`; guarda `upload_url` e `id` em variáveis do fechamento; ao receber `201`, registra `estado.envios[id] = { controle, cancelado: false, fim }` e recarrega a lista (o cartão "Enviando" aparece). 429/404/422 viram os textos já aprovados (CA-09 de 98).
   - `enviar`: `fetchImpl(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: controle.signal })`. **Fora de `criarPedir`** (não é JSON nem mesma origem, e não pode levar cookie). `[NÃO VERIFICADO]` cabeçalhos exigidos pela URL assinada do Storage (`QuarantineStoragePort`); o DEV lê o adaptador.
   - Após o `PUT` aceito: remove a entrada de `estado.envios` e chama `POST /finalize` **uma vez imediatamente**; o polling existente continua a cuidar de `processando` e de novas tentativas.
6. **O polling existente não pode finalizar foto cuja aba ainda está enviando.** Hoje o laço da linha 373 finaliza cartões em `enviando`. Para ids presentes em `estado.envios` a chamada de `finalize` é pulada (senão o `finalize` chega antes do objeto e pode gastar tentativa ou virar erro). `[NÃO VERIFICADO]` o que `finalizeMedia` responde quando o objeto não existe no Storage; o DEV lê `media-service.ts` e ajusta o texto desta regra, mantendo-a (ela é correta em qualquer caso).
7. Falha de rede/`PUT` (não cancelada): mantém o cartão como "Enviando"/"Tentar de novo" com o texto aprovado (B6); o TTL de 30 min e o varredor resolvem o órfão. Cancelamento (`AbortError` com `cancelado === true`) é silencioso.

### 5.3 Exclusão durante envio (CA-17, P-141-7 em #141)
No clique de "Excluir" confirmado (hoje `pedir('DELETE', caminhoItem(alvo.id))`, linha 640): se `estado.envios[alvo.id]` existir, marca `cancelado = true`, chama `controle.abort()`, **aguarda `fim`** (a promessa do envio em curso, que sempre resolve) e só então emite o `DELETE`. A foto sai da lista só depois da confirmação do servidor (comportamento existente). Casos:
- Abort antes do `PUT` terminar: o `fetch` rejeita com `AbortError`; o servidor fica com a linha pendente e a exclusão a apaga (`deletePhoto`) e remove o original; se um fragmento tiver chegado ao Storage, a remoção física do original cobre; resíduo, se houver, cai no varredor de órfãos de 3 h (88 §3).
- Abort depois do `PUT`, antes do `finalize`: nada em curso; o `DELETE` normal resolve.
- `AbortController` e `crypto.randomUUID` fazem parte de navegadores atuais; o suporte mínimo exato é `[NÃO VERIFICADO]`.
### 5.4 CSP e cabeçalhos
`vercel.json` **não muda**. `script-src 'self'` já cobre `/fotos-envio.js`; `connect-src` já inclui a origem do Storage (decisão 149) para o `PUT`; `img-src blob:` só serve a galeria. Nada de `unsafe-*`, `worker-src` ou `blob:` em `connect-src` (o corpo do `PUT` é um `Blob` em memória, não uma URL). Risco residual: se `SUPABASE_URL` do ambiente apontar para um projeto diferente do host fixo na CSP (preview com outro projeto), o `PUT` é bloqueado (B13). Teste estático (CA-14) compara apenas a CSP; a coincidência real de host é `[NÃO VERIFICADO]` até o roteiro manual.

## 6. Arquivos prováveis a tocar (para checagem de conflito)
Novos:
- `apps/api/src/media/media-composicao.ts`
- `apps/api/tests/media-composicao.test.ts`, `apps/api/tests/media-ponta-a-ponta.test.ts`
- `packages/db/tests/media-gallery.dbtest.mjs` (CA-09)
- `apps/web/src/media/fotos-entrada.ts`, `apps/web/src/media/portas-navegador.ts`
- `apps/web/scripts/build-fotos-envio.mjs`
- `apps/web/tests/fotos-envio-estatico.test.ts`, `apps/web/tests/portas-navegador.test.ts`, `apps/web/tests/fotos-envio-paridade.test.ts`

Alterados (**compartilhados ou sensíveis**):
- `apps/api/src/composicao.ts` (interface `Integracoes`, `montarIntegracoes`) · `apps/api/src/vercel.ts` (pool compartilhado, singleton de redução, opção `media`) · `apps/api/src/app.ts` (ramo de 404 uniforme). Os três são tocados por qualquer Issue que monte rota nova. As Issues ativas #30 (QA) e #43 (Code Review) mexem em identity/draft/pedido.*; **#43** pode alterar `Integracoes`/`vercel.ts` (revisão do rascunho, `drafts`): recomenda-se **serializar** (#141 só edita esses três arquivos depois do merge de #43 ou após `git pull`/rebase conferido) e manter as mudanças em blocos separados. `[NÃO VERIFICADO]` quais arquivos #30 e #43 realmente alteram; o orquestrador confere.
- `apps/api/tests/composicao-integracoes.test.ts` e, se existir expectativa de corpo vazio para `/v1/media/*` sem `media`, `apps/api/tests/app.test.ts` ou `media-route.test.ts`.
- `.env.example` (nome `MEDIA_UPLOAD_ENABLED`, sem valor), e conferir `scripts/check-env-example.mjs`.
- `apps/web/public/fotos.html` (segundo `<script>`), `apps/web/public/fotos.js` (opção `envio`, `estado.envios`, exclusão com abort, textos), `apps/web/tests/fotos-page.test.ts`.
- `apps/web/package.json` (devDependency `esbuild` e scripts), `pnpm-lock.yaml`, `.gitignore`, `packages/domain/package.json` (`sideEffects: false`, arquivo compartilhado de baixo risco).
- `apps/web/vercel.json`: **somente lido** pelo teste estático; sem alteração prevista. Se virar alteração, é conflito com qualquer Issue que mexa nas CSPs.
- Condicional: configuração de duração máxima da função da API (ver R-3), arquivo `[NÃO VERIFICADO]`.

## 7. Dados e migrações
Nenhuma migração nova. A migração `20261112190000_media_expand_photo_order.sql` (galeria, ordem, `media_list/media_delete/media_reorder/media_read_target`) precisa estar aplicada no banco de desenvolvimento antes de CA-09 e CA-10; o estado dela `[NÃO VERIFICADO]` (refino §0). Se não estiver, aplicar por `npx supabase` (regra do projeto; decisão do líder sobre o desvio `db:migrate`, P-141-10).

## 8. Plano de testes (mapa CA-01..CA-18)
Todos locais. Evidência: comando, contagem e código de saída na Issue. Nada de CI verde presumido.

| CA | Teste | Onde | Como |
|---|---|---|---|
| 01 | Rotas ligadas com ambiente completo | `media-composicao.test.ts` | Ambiente sentinela completo + `MEDIA_UPLOAD_ENABLED=1`, fábrica SQL e `fetchImpl` falsos; `handleRequest` com `media` montado: `POST /v1/media/uploads` com cookie válido ⇒ 201 com `upload_url`; `GET /v1/media/photos` ⇒ 200 `{fotos:[]}` |
| 02 | Pendências só com nomes | idem | Ambientes parciais (cada variável ausente, chave curta, liberação ausente ou `0`/`true`): `pendencias` igual à lista esperada de nomes; varredura por sentinelas em `pendencias` e em `JSON.stringify(options sem funções)` |
| 03 | 404 uniforme | idem + `app` | Matriz (liberação ausente, cada variável ausente, fábrica ausente, `media` não montado) × (POST uploads, POST finalize, GET item, GET photos, GET image, DELETE, PUT order, caminho `/v1/media/x/y`, métodos inesperados): resposta byte a byte (status, cabeçalhos, corpo) igual à de referência `draftNotFound()` do cenário montado sem cookie; contadores das fakes de banco e Storage em zero |
| 04 | Galeria separada | idem | Montagem com upload completo e portas da galeria omitidas: emissão/finalização/estado respondem; `photos`, `image`, `DELETE`, `order` ⇒ 404 uniforme; `pendencias` traz o item da galeria; inverso (nada monta se o upload falta) |
| 05 | Sem valor em log/resposta | idem | Sentinelas nas cinco variáveis; captura de `console`, `stdout`, `stderr`, corpos e cabeçalhos em sucesso, recusa, falha de Storage (503) e de banco |
| 06 | Papel de menor privilégio | idem | Fábrica espiã registra as URLs: só a sentinela de `DATABASE_URL_APP_API`; `DATABASE_URL_APP_SYSTEM` presente e **nunca** pedida; um cliente por URL em duas montagens; `gate` compartilhado entre montagens com a mesma `reducao` |
| 07 | Sem regressão | suítes existentes + `composicao-integracoes.test.ts` | `corepack pnpm check:all` e `corepack pnpm test` (turbo) com contagem; respostas de `uploads`, `finalize` e `GET /{id}` comparadas com o instantâneo anterior no teste de montagem |
| 08 | Storage só no bucket fixo | `media-composicao.test.ts` | `fetchImpl` espião sobre a montagem real: `GET image` toca só `request-photos`; falha se qualquer GET for em `quarantine/` |
| 09 | Banco real `app_api` | `packages/db/tests/media-gallery.dbtest.mjs` | `corepack pnpm db:test` (`--test-concurrency=1`): `PgMediaGallery` contra `media_list`, `media_delete`, `media_reorder`, `media_read_target` com rascunho de teste no banco de desenvolvimento; limpa os dados criados. Roda em série e depende da migração aplicada e da instabilidade conhecida do `db:test` (triagem #140) |
| 10 | Ponta a ponta em desenvolvimento | roteiro manual do DEV + `media-ponta-a-ponta.test.ts` (porta simulada) | **Automatizado (simulado):** servidor `http` real em porta 0 com `handleRequest` + `montarMidia` sobre fakes em memória de banco (`media-fakes-h027.ts`) e um `fetchImpl` que simula o Storage (URL assinada, `PUT`, `GET`, `DELETE`) e redutor falso: emitir → `PUT` → finalizar → listar → imagem → reordenar → excluir, conferindo o estado final nas fakes (some da lista e do Storage simulado). **Real (DEV):** o mesmo roteiro contra o banco e o Storage de desenvolvimento com `curl`/script descartável sem imprimir variáveis; saída de cada passo na Issue; `[NÃO VERIFICADO]` até a execução, e só depois da decisão sobre rotação das senhas (decisão 150) |
| 11 | Adicionar foto ligado | `fotos-page.test.ts` (sandbox `vm`) | `envio` falso, `<input>` simulado no DOM de teste, `fetch` falso: `change` → emissão com tamanho reduzido → `PUT` com `signal` e sem cookie → `finalize` → cartão "Enviando" e transição normal |
| 12 | Limite de cinco | `fotos-page.test.ts` + `media-route`/`media-gallery` | Cinco vivas: `aria-disabled`, mensagem anunciada, seletor não criado/aberto; servidor segue 422 `photo_limit` (teste de rota existente mantido) |
| 13 | Arquivo público sem build frágil | `fotos-envio-estatico.test.ts` | Lê `fotos.html` (ordem `fotos-envio.js` antes de `fotos.js`, só `src` de mesma origem, sem inline), `.gitignore` (arquivo gerado), `package.json` (`build` e `test` chamam o gerador), existência pós-geração e tamanho ≤ 20 KB, ausência de `import `, `require(`, `eval(`, `new Function` no bundle; `check:all` passa |
| 14 | CSP sem afrouxar | idem | Lê o bloco `/fotos` de `vercel.json`: `script-src 'self'` exato, sem `unsafe-inline`/`unsafe-eval`/`http:`/`https:` em `script-src`; `connect-src` somente `'self'` + a origem do Storage já aprovada; `img-src blob:`; `default-src 'none'`. Navegador real: `[NÃO VERIFICADO]` |
| 15 | Paridade da redução | `fotos-envio-paridade.test.ts` | Executa o **bundle gerado** em `vm` com `createImageBitmap`/canvas falsos para uma tabela de dimensões (4000×3000, 1280×720, 640×480, 10000×500, 1×1, retrato e paisagem) e curvas de tamanho por qualidade; afirma que as dimensões pedidas ao canvas e a sequência de qualidades são idênticas às de `planoDimensoes` e `MEDIA_REDUCE_QUALITY_STEPS`/`escolherSaidaJpeg` chamados direto no domínio (também prova que o tree-shaking manteve a regra real) |
| 16 | Fallback sem redução | `reduzir-foto.test.ts` (existente) + `portas-navegador.test.ts` + `fotos-page.test.ts` | Sem `createImageBitmap`, com opção não suportada, `decodificar` lançando, canvas ausente e `toBlob` nulo: envia o original até 10 MB com o tipo declarado; acima de 10 MB ⇒ `arquivo_grande` sem chamar a API |
| 17 | Exclusão cancela o envio | `fotos-page.test.ts` | `fetch` falso cujo `PUT` só resolve no `abort`; confirma exclusão: o evento `abort` ocorre **antes** da chamada `DELETE` (ordem registrada), o `AbortError` não gera mensagem, a foto sai da lista só depois da resposta do `DELETE`; caso sem envio em curso mantém o fluxo atual |
| 18 | Aviso e sem canal extra | `fotos-page.test.ts` (existente) | Mantido; acrescentar asserção de que `fotos.html` e `fotos-envio.js` não contêm `wa.me`/`whatsapp` |

Ordem de execução para o DEV: `corepack pnpm --filter @fastpro/domain build` → `corepack pnpm --filter @fastpro/tokens build` → testes de `api` e `web` → `check:all` → `db:test` (em série, por último).

## 9. Riscos e o que NÃO foi verificado
### 9.1 Riscos
| # | Risco | Tratamento |
|---|---|---|
| R-1 | Liberar produção por engano (variável definida na Vercel de produção) | Fechado por padrão em todos os ambientes; `.env.example` sem valor; a definição em produção é ato explícito do líder depois de H-110. Travar também por `VERCEL_ENV`? Não proposto (A-141-6) |
| R-2 | Dois pools `app_api` esgotam conexões do plano gratuito | Pool compartilhado (§2.3); teste CA-06; medir conexões `[NÃO VERIFICADO]` |
| R-3 | Prazo de 10 s da redução (`MEDIA_REDUCE_DEADLINE_MS`) igual ou maior que o tempo máximo da função da API na Vercel (plano gratuito) | Conferir a duração máxima configurada da função; se menor que o prazo, o `finalize` é interrompido pela plataforma e o servidor não devolve o 503 desenhado. `[NÃO VERIFICADO]` o limite vigente e onde configurar. O polling do cliente (até 20 chamadas) repete o `finalize`; falha repetida deixa foto em "processando" até o TTL |
| R-4 | `sharp` não carrega em Linux/Vercel ou não é incluído no pacote da função | Já tratado como 503 `unavailable` sem rejeitar a foto (93 §8); verificar no primeiro preview; aceite do risco em P-141-9 |
| R-5 | Bundle maior que o orçamento por causa do barril do domínio | `sideEffects:false`, orçamento de 20 KB em teste, medir; fallback de subcaminho (§4.2) |
| R-6 | `finalize` antecipado pelo polling enquanto o `PUT` ainda corre | Regra do §5.2 passo 6 e teste de CA-11/CA-17 |
| R-7 | CORS do Storage para `PUT` a partir da origem do site | A URL assinada é de outra origem: o Storage precisa aceitar a origem do site. `[NÃO VERIFICADO]`; o roteiro manual de CA-10 prova; não há CORS configurável pela API |
| R-8 | `createImageBitmap(..., { imageOrientation })` diferente entre navegadores (Safari antigo) | Fallback para o original (CA-16); o servidor reduz; orientação do servidor pelo EXIF (96) |
| R-9 | Cor/transparência: PNG/WebP com alfa vira JPEG escuro | Fundo branco antes do `drawImage` (§4.2) |
| R-10 | `app.ts` altera um 404 que outro teste espera vazio | Ajuste explícito da expectativa (CA-03) e registro na Issue |
| R-11 | Arquivo gerado não chega à produção se a Vercel só serve `public` sem rodar `build` | Falha segura: botão desativado. Conferir o comando de build do projeto web `[NÃO VERIFICADO]` |
| R-12 | Colisão com #30 e #43 nos três arquivos de composição | Serializar (§6) |

### 9.2 Não verificado (lista)
- Execução de qualquer teste, build, `db:test` ou roteiro; instalação e tamanho do esbuild; compatibilidade do `pnpm` (scripts de instalação) e de `check:deps`/`check:boundaries`/`check:env` com a mudança.
- Forma exata do corpo e da resposta de emissão; cabeçalhos exigidos pelo `PUT` assinado; resposta de `finalize` com objeto ausente; `siteOriginOf` com URL inválida; consumidores atuais das listas `pendencias*`.
- `lib` DOM no `tsconfig.base`; suporte mínimo de navegador; CSP, CORS e `PUT` em navegador real; leitor de tela e zoom (G-14 de 98).
- Limites da Vercel (duração, memória, pool) e do Supabase no plano gratuito; carga do `sharp` em Linux; estado da migração `20261112190000` no desenvolvimento; arquivos realmente alterados por #30 e #43; comando de build usado pela Vercel para o `web`.
- Conteúdo de `media-service.ts` (a partir da linha 70), `media-gallery-service.ts` (a partir da 70), `media-reduce-service.ts`, `reduce-gate.ts` além das assinaturas e do corpo de `fotos.js` fora dos trechos citados.

## 10. Divisão de trabalho sugerida (sem paralelismo dentro da Issue)
1. API: `media-composicao.ts`, `Integracoes`, `vercel.ts`, `app.ts` (404), `.env.example`, testes CA-01..CA-08 e o ponta a ponta simulado (CA-10 parte automatizada).
2. Banco: `media-gallery.dbtest.mjs` (CA-09), após conferir a migração.
3. Web: gerador, entrada, portas, `package.json`, `.gitignore`, `fotos.html`; testes CA-13..CA-16.
4. Página: `fotos.js` (`envio`, `estado.envios`, exclusão com abort, textos de P-141-6) e testes CA-11, CA-12, CA-17, CA-18.
5. Roteiro manual de CA-10 em desenvolvimento (depende da decisão 150) e verificação de navegador real.

## 11. Perguntas abertas (para o líder; numeração local A-141-n)
Nenhuma pergunta foi feita ao usuário.
- **A-141-1 Nome e regra da liberação.** Usar `MEDIA_UPLOAD_ENABLED=1`, obrigatório em todos os ambientes (ausente = fechado)?
  - Alternativa A: sim, falha fechada em todos os ambientes. **Recomendação.**
  - Alternativa B: exigir só quando `APP_ENV` for `production` (desenvolvimento e preview abertos por padrão). Menos configuração, mas depende do `APP_ENV` correto na Vercel.
  - Alternativa C: outro nome (por exemplo `MEDIA_ROUTES_ENABLED`).
  - Destrava: CA-01/CA-02 e o `.env.example`. O líder (ou o usuário, se preferir) define o valor no `.env.local` do desenvolvimento.
- **A-141-2 Segunda variável para a galeria.**
  - Alternativa A: não; a galeria sobe junto do upload e a separação é estrutural (portas da galeria opcionais; CA-04 prova com a omissão delas). **Recomendação.**
  - Alternativa B: `MEDIA_GALLERY_ENABLED` própria, útil se a migração da ordem de fotos ainda não estiver em algum ambiente.
  - Destrava: CA-04.
- **A-141-3 Recusa de tipo no cliente.** Manter só o `accept` do seletor e deixar o servidor decidir por conteúdo (HEIC/GIF recebem 415 e o texto "tipo não aceito")?
  - Alternativa A: sim. **Recomendação** (uma única autoridade, conforme 96).
  - Alternativa B: pré-recusar no cliente por `type`/extensão, que é falsificável e inconsistente entre navegadores.
  - Destrava: CA-11, B4 e o texto de P-141-6.
- **A-141-4 `sideEffects: false` no `domain`.** Aceitar a alteração em `packages/domain/package.json` (arquivo compartilhado, sem efeito em runtime do Node) para o bundle ficar pequeno?
  - Alternativa A: sim. **Recomendação.**
  - Alternativa B: criar o subcaminho `@fastpro/domain/media-reduce` no mapa `exports` (mais explícito, mais superfície).
  - Destrava: CA-13 (orçamento de 20 KB).
- **A-141-5 Aprovação da dependência.** O esbuild (devDependency, licença MIT, gratuito) entra em `apps/web`? É a decisão P-141-5 deste desenho; só vira pergunta se `check:deps`/`pnpm` o recusar (reserva C, §4.4).
  - Alternativa A: aprovar. **Recomendação.**
  - Alternativa B: ir direto à C com teste de paridade.
- **A-141-6 Segunda trava por ambiente.** Ignorar `MEDIA_UPLOAD_ENABLED` quando `VERCEL_ENV=production`, até uma Issue futura remover a trava (H-110)?
  - Alternativa A: não; a regra de A-141-1 basta e produção é decisão do líder. **Recomendação** (menos código e menos nomes).
  - Alternativa B: sim; mais seguro contra variável definida por engano, ao custo de um segundo mecanismo e um PR para abrir produção.
- **A-141-7 Duração máxima da função da API.** Confirmar (pelo painel/arquivo de configuração da Vercel, que a fábrica deve consultar por MCP antes de pedir ao usuário) o tempo máximo vigente para a função e compará-lo ao prazo de 10 s da redução (R-3).
  - Alternativa A: conferir e, se menor que 10 s, subir a duração máxima para cobrir o prazo e a espera do `gate`. **Recomendação.**
  - Alternativa B: reduzir `MEDIA_REDUCE_DEADLINE_MS` (mudança de domínio fora desta Issue).
  - Destrava: CA-10 em preview. Não bloqueia a implementação em desenvolvimento.
- **A-141-8 Coordenação de arquivos compartilhados.** Executar #141 nos arquivos `composicao.ts`, `vercel.ts` e `app.ts` somente depois que #43 (Code Review) for mesclada, ou aceitar mesclar com conflito resolvido pelo DEV?
  - Alternativa A: começar pelo web/página e pelo teste de banco e deixar a edição dos três arquivos para depois do merge de #43. **Recomendação.**
  - Alternativa B: editar já, com rebase no fim.

## 12. Registro de commit
Ver o relatório do arquiteto ao líder: o commit é feito pelo comando `git add` e `git commit` restritos ao caminho deste arquivo.
