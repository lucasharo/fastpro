# H-029 — Desenho: pré-visualização, exclusão e reordenação das fotos

- **Issue:** #42 · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-12 · **Papel:** Architect
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou pelo líder · `[VERIFICADO]` conferido no código ou documento · `[PROPOSTA]` sugestão do Architect · `[NÃO VERIFICADO]` sem fonte ou sem medição
- **Base:** 98-REFINO-H029 (CA-01 a CA-16), decisões 117 a 123 (11-DECISOES, rodada 33, não reabertas), 88-DESENHO-H026 (§1, §2, §4, §5), 93-DESENHO-H027 (§2, §3, §5.3), 96-DESENHO-H028 (fronteira de arquivos), 90-DESENHO-H030 (§3.3, contrato de `content_rev` para fotos). Código lido: `apps/api/src/media/{media-route,media-service}.ts`, `packages/domain/src/media/{ports,media}.ts`, `packages/db/src/media-quarantine.ts`, migrações `20261112120000`, `20261112140000`, `20261112150000`, `apps/web/public/{codigo.html,codigo.css,tokens.css}`, `apps/web/vercel.json`, `apps/web/src/media/reduzir-foto.ts`.

## 0. Situação encontrada e decisões do dono do produto (não reabertas)

- `[DECIDIDO]` 117 leitura da foto pelo dono, listagem e motivo da recusa, pelo cookie do rascunho, `no-store`, 404 uniforme, o original nunca é exibido · 118 botão "Adicionar foto" nesta tela · 119 ordem guardada no servidor, migração nova aplicada pelo `npx supabase` · 120 sem capa · 121 textos da 98-REFINO §5 aprovados, inclusive o aviso de fachada, interior e rostos · 122 H-027 como dependência · 123 sem deduplicação.
- `[VERIFICADO]` Já existem e **não são refeitos**: as rotas `POST /v1/media/uploads`, `POST /v1/media/{id}/finalize`, `GET /v1/media/{id}`; a reserva de vaga com o limite de 5 por gatilho de banco; a redução síncrona no `finalize` com lease, `reduce_attempts` e `reject_code`; os buckets `quarantine` (original) e `request-photos` (reduzida `p/<id>`); o varredor `sweepQuarantine`, que já remove `d/<id>` e `p/<id>` de toda linha marcada com `purge_requested_at`; as políticas de taxa `MEDIA_RATE_*`; `draftNotFound()` (404 uniforme) e `DRAFT_HEADERS`; o módulo de redução no navegador `prepararEnvio`.
- `[VERIFICADO]` Última migração no disco: `20261112150000_draft_expand_review_confirmation.sql` (par em `supabase/rollbacks/*.down.sql`). Os desenhos 99-DESENHO-H036/H024 reservam `20261112160000`, `...170000` e `...180000`, ainda sem arquivo. **Migração nova desta história: `20261112190000_media_expand_photo_order.sql`** com `supabase/rollbacks/20261112190000_media_expand_photo_order.down.sql`. O DEV roda `ls supabase/migrations` de novo antes de criar o arquivo e, se o número estiver tomado, usa o próximo livre maior.
- `[VERIFICADO]` Não existe `private.draft_content_touch` (o desenho 90 §3.3 só o previu). Ver §2.3.
- Fronteira de arquivos com a #41 (em Desenvolvimento): a #41 altera `media-reduce-service.ts`, `media-route.test.ts`, `media-fakes-h027.ts` e `packages/domain/src/media/index.ts`. O DEV da #42 só começa depois que a #41 sair de Desenvolvimento, ou trabalha apenas em arquivos novos (lista na §8) e deixa as edições em arquivos compartilhados (`index.ts`, `media-route.ts`, `ports.ts`, fakes) para o fim, sobre a árvore já limpa.

## 1. Visão geral

```
/fotos (página estática)
  |-- GET  /v1/media/photos            lista (estado, motivo, posição) -- só dono
  |-- GET  /v1/media/{id}/image        bytes da versão reduzida p/<id> -- só dono, só ready
  |-- DELETE /v1/media/{id}            marca para remoção -- só dono
  |-- PUT  /v1/media/photos/order      grava a ordem (comparar-e-trocar)
  `-- (reuso) POST /uploads -> PUT no Storage -> POST /{id}/finalize
```

Tudo sob o prefixo `/v1/media/` que `isMediaRoute` já captura; qualquer outro método ou caminho continua no mesmo 404 uniforme. Ordem fixa de cada rota nova, igual à da #39: Origin e `Sec-Fetch-Site` (exigido em `PUT` e `DELETE`; no `GET` só se o cabeçalho existir) → `Content-Type` JSON (só no `PUT`) → cookie (ausente ou malformado ⇒ 404 imediato, sem banco) → `id` uuid (senão 404 sem banco) → corpo (1 KB) → limite de taxa (`rl_check`) → função do banco → Storage → `rl_hit` só depois de aceite. Falha interna ⇒ 503 `{ "code":"indisponivel" }` fixo.

## 2. Contratos novos

### 2.1 Listagem `GET /v1/media/photos` `[PROPOSTA]`

200 `{ "fotos": [ ... ] }`, lista fechada de chaves por item:

| Chave | Valor |
|---|---|
| `id` | uuid da foto (já exposto pela #39) |
| `estado` | `enviando` · `aguardando` · `processando` · `pronta` · `recusada` |
| `motivo` | só em `recusada`: um dos 4 códigos fixos de `MEDIA_REJECT_CODES`; senão ausente |
| `posicao` | inteiro 1..N, só nas não recusadas; ausente nas recusadas |

Ordem do array: as não recusadas por `posicao`, depois as recusadas por criação. **Nunca** vão tamanho, dimensões, bucket, caminho, `confirmed_*`, `ready_*`, `reduce_attempts`, lease, `draft_id`, nonce, IP, `upload_url`.

Derivação do `estado` (no banco, uma só vez): `rejected` ⇒ `recusada`; `ready` ⇒ `pronta`; não confirmada ⇒ `enviando`; confirmada com `reduce_lease_until > agora` ⇒ `processando`; confirmada sem lease ⇒ `aguardando` (ninguém está reduzindo; a tela dispara `finalize`, que é idempotente). Pendente **não confirmada e vencida** não aparece: a função a marca para remoção antes de listar (mesma liberação preguiçosa de `media_issue`), para a lista e o limite de 5 nunca discordarem.

Rascunho vivo sem foto ⇒ 200 `{ "fotos": [] }` (não é erro). Rascunho inexistente, vencido, descartado, de outro navegador, cookie ausente ou malformado ⇒ 404 uniforme (corpo e cabeçalhos byte a byte iguais aos de H-026). 429 (só `Retry-After`) e 503 como na #39. Cabeçalhos `DRAFT_HEADERS` (inclui `no-store`).

### 2.2 Leitura da versão reduzida `GET /v1/media/{id}/image` `[PROPOSTA]`

**Forma escolhida: bytes pela API** (decisão 117 deixou ao Architect). Alternativa descartada: URL curta assinada do Storage. Ela exigiria um método de assinatura de leitura na porta (88 §4 proíbe), é uma credencial ao portador que vaza em log e histórico, e não permite 404 uniforme nem `no-store` controlados por nós. A versão reduzida tem no máximo 750.000 bytes, bem abaixo do limite de corpo da função.

- Serve **somente** foto do rascunho do cookie, viva (`purge_requested_at` nulo), com `status='ready'`. Qualquer outro caso (sem cookie, malformado, outro dono, outro rascunho, rascunho vencido ou descartado, `id` não uuid, foto `pending`, `rejected`, excluída, `HEAD`, `POST`, `OPTIONS`) ⇒ o **mesmo** `draftNotFound()` da #39. A resposta de "não está pronta" é igual à de "não existe" (CA-10).
- 200: corpo = bytes do objeto `p/<id>`; cabeçalhos exatos: `Content-Type: image/jpeg`, `Content-Length`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: default-src 'none'; sandbox`. **Sem** `ETag`, `Last-Modified`, `Content-Disposition`, nome de arquivo ou qualquer chave de objeto.
- **Porta estreita nova** `ReducedPhotoReaderPort { readReduced(id): Promise<Uint8Array | null> }` em `packages/domain/src/media/ports.ts`, implementada por um método novo da classe `SupabaseMediaReduceStorage` que só lê `request-photos/p/<uuid>`. O serviço de leitura recebe **só esta porta**: ele não tem `readOriginal`, nem a porta de quarentena, nem `mediaObjectKey`. O original não é alcançável por tipo, e um teste estático garante isso (G-04).
- **Conferência antes de servir (defesa em profundidade):** a função de banco `media_read_target` devolve `ready_bytes`; o serviço só envia se o objeto lido tem exatamente esse tamanho, ≤ 750.000 bytes e começa com `FF D8 FF`. Divergência ou objeto ausente de uma foto `ready` do próprio dono ⇒ **503** fixo e contador `leitura_divergente` (nunca serve o que não bate; só o dono chega a este ponto, então o 503 não revela nada a terceiros).
- Taxa: política nova `MEDIA_RATE_IMAGEM_IP` (`media_imagem_ip`, janela 60 s, balde 10 s, 120 por IP-HMAC) `[PROPOSTA]`; conta só no sucesso. A listagem usa `MEDIA_RATE_LEITURA_IP` (já existe).

### 2.3 Exclusão `DELETE /v1/media/{id}` `[PROPOSTA]`

- Sem corpo. Origin obrigatório. Posse pelo cookie, como todas.
- Função `private.media_delete`: trava a linha do rascunho (`for update`, a mesma ordem de `media_issue`: rascunho primeiro, foto depois), localiza a foto do dono; se está viva, grava `purge_requested_at = p_now` (a vaga é liberada na hora, pois deixa de contar para o limite); resposta `deleted`. Se a linha existe, é do dono e já está marcada ⇒ `already`. Qualquer outra coisa ⇒ `not_found`. Funciona em **qualquer estado**: enviando, aguardando, processando, pronta, recusada.
- Resposta: 200 `{ "excluida": true }` para `deleted` e `already` (duas chamadas, mesma resposta, um só efeito: CA-06); 404 uniforme para `not_found`. Depois da remoção física a linha some, e uma terceira chamada vira 404; a tela trata 404 do `DELETE` como "já sumiu" e recarrega a lista (se o rascunho morreu, a lista responde 404 e a tela mostra o texto de rascunho vencido).
- **Remoção física no mesmo pedido, sem condicionar o sucesso:** depois da marcação, o serviço tenta `removeOriginal(id)` e `removeReduced(id)` (portas já existentes na redução) com orçamento de 2 s no total; se as duas passarem, chama `media_purge_done([id])`. Se falhar ou estourar o tempo, a linha fica marcada, o cliente continua recebendo 200 e o `sweepQuarantine` repete a limpeza (contador `remocao_fisica_falhou`). A marcação é o ponto de confirmação (CA-06); só a falha da marcação vira 503, com a foto ainda na lista.
- **Excluir durante a redução:** a marcação faz `media_reduce_done` e `media_reduce_reject` devolverem `gone` (93 §2.2); o serviço de redução já remove o reduzido que acabou de gravar. A remoção física do `delete` e a do redutor são idempotentes (ausente conta como sucesso). Não há caminho em que sobre objeto sem linha: o varredor de órfãos de 3 h é a última rede.
- Taxa: `MEDIA_RATE_EXCLUI_RASCUNHO` (`media_exclui_rascunho`, 30 por hora por rascunho) `[PROPOSTA]`; conta só depois de aceite.
- `content_rev`: a função incrementa `request_draft.photo_rev` (ver §3) para que o contrato do 90 §3.3 valha: excluir foto zera a confirmação do pedido.

### 2.4 Reordenação `PUT /v1/media/photos/order` `[PROPOSTA]`

Corpo JSON, limite 1 KB, só estas chaves: `ordem_atual` (array de uuid, a sequência que a tela mostra) e `ordem_nova` (array dos mesmos uuid em outra ordem). Chave desconhecida ⇒ 422 `campo_desconhecido`; vazio ⇒ 422 `vazio`; mais de 5 itens, item que não é uuid, repetido, ou `ordem_nova` que não é permutação de `ordem_atual` ⇒ 422 `ordem_invalida`.

**Comparar e trocar (CA-08, sem coluna de versão):** `private.media_reorder` trava o rascunho, monta a sequência viva atual (`purge_requested_at` nulo e `status <> 'rejected'`, ordenada por `sort_order, created_at, id`) e compara com `ordem_atual`:

| Resultado da função | HTTP | Corpo |
|---|---|---|
| igual e `ordem_nova` diferente: grava | 200 | `{ "fotos": [...] }` (a lista nova, mesmo formato de §2.1) |
| igual e `ordem_nova` = `ordem_atual` | 200 | idem, sem escrita e sem mudar `photo_rev` |
| diferente (outra aba mexeu, ou entrou, saiu ou foi recusada uma foto) | 409 | `{ "code":"ordem_mudou", "fotos": [...] }` com a lista atual |
| `ordem_nova` não é permutação | 422 | `{ "code":"ordem_invalida" }` |
| rascunho não é do cookie | 404 | uniforme |

A gravação renumera `sort_order` de 1 a N numa só instrução, sob a trava do rascunho. Duas requisições concorrentes se serializam: uma grava, a outra vê `ordem_atual` velha e recebe 409 com a lista vencedora; nunca há mistura. Taxa: `MEDIA_RATE_ORDEM_RASCUNHO` (120 por hora por rascunho) `[PROPOSTA]`. A repetição da mesma requisição depois de sucesso devolve 409 com a lista já na ordem desejada; a tela trata esse caso como sucesso silencioso (G-11).

### 2.5 Motivo da recusa nas respostas existentes `[PROPOSTA]`

`finalize` já devolve `422 { code }` com o motivo (93 §2.3) e não muda. `GET /v1/media/{id}` e a repetição de `POST /uploads` **não mudam** (continuam `{ id, status, confirmed }`): o motivo para a tela vem só da listagem (§2.1), que é a fonte única. Assim o contrato antigo fica estável e a #41 não é afetada.

### 2.6 Limites e constantes novas (domínio, `packages/domain/src/media/gallery.ts`) `[PROPOSTA]`

| Constante | Valor | Uso |
|---|---|---|
| `MEDIA_PHOTOS_PATH` / `MEDIA_ORDER_PATH` | `/v1/media/photos` / `/v1/media/photos/order` | caminhos |
| `MEDIA_ORDER_BODY_LIMIT_BYTES` | 1024 | corpo do `PUT` |
| `MEDIA_IMAGE_MAX_BYTES` | 750000 | teto da leitura (igual ao bucket) |
| `MEDIA_DELETE_PHYSICAL_BUDGET_MS` | 2000 | orçamento da remoção física inline |
| `MEDIA_POLL_INTERVAL_MS` / `MEDIA_POLL_MAX` | 3000 / 20 | CA-03: consulta a cada 3 s (acompanha o `Retry-After: 3` de 93), no máximo 20 vezes (60 s: cobre a lease de 30 s + uma nova tentativa); `Retry-After` maior do que 3 s prevalece |
| taxas | ver §2.2 a §2.4 | `MEDIA_RATE_IMAGEM_IP`, `MEDIA_RATE_EXCLUI_RASCUNHO`, `MEDIA_RATE_ORDEM_RASCUNHO` |

## 3. Dados (migração por expansão, reversível)

`20261112190000_media_expand_photo_order.sql`, idempotente (`if not exists`, `create or replace`, blocos `do $$` que consultam `pg_constraint`). Aplicada com `npx supabase` (nunca pelo MCP). Não redefine nenhuma função da #39 nem da #40 (`media_issue`, `media_get`, `media_finalize`, `media_sweep`, `media_purge_done`, `media_reduce_*`).

1. **`app.media_asset.sort_order integer`** com `check (sort_order between 1 and 100000)`. Preenchimento das linhas existentes na própria migração: `row_number()` por rascunho ordenado por `created_at, id`, só onde nulo. Depois do preenchimento, `set not null` (num bloco que confere se já é). Linhas inseridas por código antigo continuam válidas porque o gatilho abaixo preenche antes da checagem de nulo.
2. **Gatilho `media_asset_ordem`** `before insert`: `new.sort_order := coalesce(max(sort_order) das linhas não purgadas do rascunho, 0) + 1`. Seu nome vem **depois** de `media_asset_limite` na ordem alfabética de gatilhos do mesmo evento; o de limite já trava a linha do rascunho, então duas inserções simultâneas nunca recebem o mesmo número. O teste G-08 prova a ordem e a concorrência. Nova foto entra no fim; foto recusada e foto excluída saem da sequência exposta (a sequência exposta é sempre recalculada por `row_number()` sobre as vivas não recusadas, então 1..N sem buraco mesmo que o valor guardado tenha folga). Sem índice único (o renumerar numa só instrução violaria um índice não adiável a meio da instrução); a leitura desempata por `created_at, id`.
3. **Índice** `(draft_id, sort_order) where purge_requested_at is null`.
4. **`app.request_draft.photo_rev integer not null default 0`** (constante, sem reescrita de tabela) com `check (photo_rev >= 0)`, e **`create or replace` de `private.draft_confirmation_guard()`** (função da #43/H-030) com **uma única mudança**: `v_conteudo` passa a incluir `or new.photo_rev is distinct from old.photo_rev`. Efeito: mudar fotos soma 1 em `content_rev` e zera `confirmed_at` (90 §3.3, critério herdado). O DEV copia o corpo **vigente** do arquivo `20261112150000_...sql` no momento do DEV, altera só essa linha e prova que os testes T-DB do #43 seguem verdes. `[NÃO VERIFICADO]` até lá se o corpo da #43 mudou. Lacuna declarada (R-02): a passagem `pending → ready` (função da #40) e a inclusão não somam `photo_rev`; hoje a revisão do pedido não mostra fotos, e a H-031 deve ler as fotos `ready` na hora de publicar.
5. **Funções novas** (`security definer`, `set search_path = ''`, `p_now` informado pelo chamador, `revoke all` de `public, anon, authenticated, service_role, app_system, app_backup_reader`, `grant execute` só a `app_api`):
   - `private.media_list(p_hash text, p_now timestamptz)` ⇒ `(out_id, out_state, out_reject_code, out_pos)`. Trava o rascunho vivo do hash, marca para remoção os pendentes não confirmados e vencidos **deste** rascunho, devolve as fotos como em §2.1. Zero linhas = rascunho não existe (404). Rascunho sem foto = uma linha com `out_id` nulo.
   - `private.media_delete(p_hash text, p_id uuid, p_now timestamptz)` ⇒ `out_code` ∈ `deleted | already | not_found`; soma `photo_rev` só em `deleted`.
   - `private.media_reorder(p_hash text, p_current uuid[], p_new uuid[], p_now timestamptz)` ⇒ `out_code` ∈ `ok | unchanged | changed | invalid | not_found`.
   - `private.media_read_target(p_hash text, p_id uuid, p_now timestamptz)` ⇒ `out_bytes integer`; zero linhas salvo se dono + rascunho vivo + `purge_requested_at` nulo + `status='ready'`.
   Ordem de trava: sempre rascunho antes da foto, igual a `media_issue`. Não há gatilho em `media_asset` que atualize o rascunho (evita inverter essa ordem e criar impasse com `media_sweep` e `media_reduce_*`).
6. **Desfazer** (`...down.sql`, execução manual): restaura o corpo original de `draft_confirmation_guard` (cópia literal do arquivo `20261112150000`), remove as quatro funções, o gatilho, o índice, a coluna `photo_rev` e a coluna `sort_order`. Perde-se só a ordem escolhida (as fotos ficam, na ordem de criação); por isso não recusa por existência de dados. Idempotente. Segunda aplicação da migração não gera erro.

Nenhuma coluna de nome, caminho, EXIF, IP, URL ou tipo detectado (CA-16 e I-29 mantidos).

## 4. Telas e estados (página estática `/fotos`)

Arquivos novos: `apps/web/public/fotos.html`, `fotos.css`, `fotos.js` (mesmo padrão de `codigo.*`, sem biblioteca), e a lógica testável em controlador puro com portas injetadas (`fetch`, relógio, `URL`, DOM mínimo), como `codigo-page.test.ts`. Cores só por tokens de `tokens.css` (sem hexadecimal, T-15); o DEV confere o nome do token de foco existente. Entrada `/fotos` em `vercel.json` com `no-store`, `noindex` e CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' <origem do Storage>; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. A origem do Storage é necessária porque o `PUT` da foto vai direto ao Supabase (88 §1); sem ela o envio quebra no navegador. `[NÃO VERIFICADO]` em navegador real.

### 4.1 Estrutura e textos

`<main>` com `<h1>Fotos do pedido</h1>`, o aviso de conteúdo **sempre visível** perto da grade (mesmo sem fotos, para ser lido antes de enviar): "Evite fotos que mostrem fachada, interior ou rostos.", o contador "N de 5 fotos" (N conta só as não recusadas), a grade `<ul>` e o botão "Adicionar foto". Uma região `role="status"` (`aria-live="polite"`) sempre presente anuncia mudanças; erros usam `role="alert"` dentro do próprio cartão. Os textos de estado, motivo, erro e limite são **exatamente** os da 98-REFINO §5 (aprovados na decisão 121), em uma tabela de constantes única, e nenhum mostra código, caminho ou nome de arquivo. "Rascunho vencido" reusa a constante que o `/pedido` já usa (o DEV a localiza; não duplicar o texto).

Textos complementares que a §5 não trazia `[PROPOSTA]` (para o líder confirmar; não bloqueiam o DEV): título "Fotos do pedido"; contador "N de 5 fotos"; diálogo "Excluir esta foto?" com os botões "Excluir" e "Cancelar"; "Salvando ordem"; anúncios "Foto N excluída", "Foto N movida para a posição M de X" e "A ordem das fotos mudou; a lista foi atualizada."; botão "Adicionar foto" no estado vazio igual ao da lista.

### 4.2 Cartão de cada foto

Cada `<li>` tem `<h2 tabindex="-1">Foto N de M</h2>`, o estado em texto (nunca só cor ou ícone), o espaço da miniatura e os botões. Estado → conteúdo: `enviando` "Enviando" + Excluir; `aguardando` e `processando` "Preparando a foto. Isso leva alguns segundos." + Excluir; `pronta` miniatura + "Pronta" + "Mover foto N para antes" + "Mover foto N para depois" + "Excluir foto N"; `recusada` "Não foi possível usar esta foto: {motivo}." + "Excluir foto N" (sai da lista e não ocupa vaga); envio órfão (foto `enviando` que esta aba não está enviando) "O envio desta foto não foi concluído." + Excluir. O texto visível dos botões é o próprio nome acessível (rótulo no nome: WCAG 2.5.3), sem ícone isolado.

### 4.3 Carregamento, polling e erros

- **Abertura:** "Carregando fotos" (texto) até a lista chegar. Lista vazia ⇒ "Nenhuma foto adicionada. Fotos são opcionais." Erros da lista (CA-09): 503 "Não foi possível carregar as fotos." + "Tentar de novo"; 429 "Aguarde alguns instantes e tente de novo." (sem número); 404 texto de rascunho vencido, sem botão.
- **Miniatura (CA-02):** `fetch('/v1/media/{id}/image')` ⇒ `Blob` ⇒ `URL.createObjectURL` (por isso `img-src blob:`), no máximo 2 leituras em paralelo; espaço com "Carregando foto N" enquanto espera; `alt="Foto N de M"`. Cada URL de objeto é revogada ao trocar, excluir ou sair da página (`pagehide`). Falha ⇒ "Não foi possível mostrar esta foto." + "Tentar de novo". **Foco (resolve a tensão entre CA-02 e CA-12):** o foco só vai para "Tentar de novo" se o foco atual já está dentro desse cartão ou no corpo da página; senão a mensagem é só anunciada (`role="alert"`), sem tirar o foco de quem digita ou navega em outro lugar.
- **Polling (CA-03):** enquanto houver foto `processando`, a tela consulta a listagem a cada 3 s, no máximo 20 vezes por episódio, pausa com a aba oculta (`visibilitychange`), respeita `Retry-After` e para ao sair. Foto `aguardando` ⇒ a tela chama `finalize` **uma vez** por foto por episódio e depois consulta; 200 ⇒ recarrega; 409 `processando` ⇒ continua consultando; 422 ⇒ recarrega (a foto vira recusada). Esgotadas as 20 consultas ⇒ "Ainda preparando a foto." + "Tentar de novo" (volta a chamar `finalize`, que é idempotente e não reprocessa foto pronta).
- **Exclusão (CA-05, CA-06):** "Excluir foto N" abre `<dialog>` modal com o foco em "Cancelar"; Esc ou "Cancelar" fecham e devolvem o foco ao botão que abriu; confirmar chama o `DELETE` e **nada sai da lista antes da resposta**. 200 ou 404 ⇒ a foto sai, o contador atualiza, anuncia "Foto N excluída" e o foco vai ao `<h2>` da foto que passou a ocupar a posição seguinte, senão da anterior, senão ao botão "Adicionar foto". 503 ou 429 ⇒ a foto continua, o cartão mostra "Não foi possível excluir a foto. Tente de novo." (alerta) e "Tentar de novo". Botão do diálogo fica `aria-busy` durante a chamada; clique repetido não envia segunda chamada.
- **Reordenação (CA-07, CA-08):** "Mover foto N para antes/depois" troca com a vizinha; a troca aparece na hora; o foco continua no mesmo botão da mesma foto na nova posição (renderização por chave `id`, sem recriar o nó); o anúncio é "Foto N movida para a posição M de X". Nas pontas o botão fica `aria-disabled="true"`, continua focável e não faz nada. Enquanto grava, o cartão mostra "Salvando ordem" e **todos** os botões de mover ficam `aria-disabled` (decisão do Architect: só uma gravação em voo, para que `ordem_atual` nunca seja velha dentro da mesma aba; é um superconjunto do que CA-08 pedia). 200 ⇒ confirma; erro/503/429 ⇒ volta à ordem gravada e mostra "Não foi possível salvar a nova ordem. Ela voltou à anterior." com "Tentar de novo"; 409 ⇒ substitui pela lista do corpo e anuncia "A ordem das fotos mudou; a lista foi atualizada."; 409 cuja lista já é a desejada ⇒ sucesso silencioso. Não há arrastar; se existir no futuro, nunca é o único caminho. Sem capa e sem rótulo "principal" na primeira (decisão 120).
- **Adicionar foto (CA-04):** `<button>` que dispara um `<input type="file" accept="image/jpeg,image/png,image/webp" hidden>`. Fluxo reaproveitado: `prepararEnvio` (H-027, portas do navegador) ⇒ `POST /uploads` (`client_upload_id` novo por foto) ⇒ `PUT` na `upload_url` ⇒ `POST /finalize`. Entre a escolha e a resposta de `/uploads`, um cartão local "Enviando" (chave local) ocupa o lugar; ao receber o `id`, o cartão passa a ser o da lista. Com 5 vivas o botão fica `aria-disabled` e a mensagem "Você já tem 5 fotos. Para adicionar outra, exclua uma." é exibida e anunciada. Falhas do envio (415, 413, 422 `photo_limit`, 429, 503) usam os motivos já aprovados da §5, sem código. Sem WhatsApp, sem outro canal. Excluir uma foto que esta aba está enviando cancela o envio (`AbortController`) antes do `DELETE`.
- **Fora de escopo da tela:** não publica, não avança para a revisão (H-030), não chama nenhuma rota do estado do pedido (CA-15). Qualquer mudança de página é link simples, sem estado.

### 4.4 Acessibilidade, 320 px e zoom

- Teclado (CA-11): ordem visual = ordem do DOM: aviso, contador, cartões (Excluir ou Mover/Excluir, em ordem), "Adicionar foto". Enter e Espaço ativam; Esc fecha o diálogo; foco sempre visível pelo contorno do token de foco; nenhum `tabindex` positivo; nenhum foco perdido ao excluir, falhar ou recarregar (o foco de destino é definido em cada transição acima).
- Leitor de tela (CA-12): "Foto N de M" no `<h2>` com o estado em texto; nomes dos botões dizem a foto; mudanças anunciadas pela região de status; erros em `role="alert"` sem tirar o foco.
- Layout (CA-14): grade `repeat(auto-fill, minmax(min(100%, 14rem), 1fr))`, unidades em `rem`, `overflow-wrap:anywhere`, miniatura com `aspect-ratio` e `max-width:100%`, botões empilhados em largura total abaixo de 30rem. Sem rolagem horizontal em 320 px de largura; legível e operável a 200% de zoom (e verificado também a 400%, reflow de 320 px). Alvos com no mínimo 44 px de altura (o piso exigido é 24 por 24, WCAG 2.5.8). Sem animação; `prefers-reduced-motion` respeitado.
- Contraste (CA-13): medido nos temas claro e escuro, valores registrados; não declarar WCAG 2.2 AA sem a medição (R-24).

## 5. Privacidade e segurança

| Risco | Tratamento |
|---|---|
| Ver foto de outro (T-02) | Posse só pelo cookie; `id` nunca decide posse; 404 uniforme (mesma função `draftNotFound`) para os 12 casos de §2.2; cookie malformado ⇒ zero chamadas ao banco |
| Original exibido | Serviço de leitura só recebe `ReducedPhotoReaderPort`; sem `readOriginal`, sem `d/`, sem `mediaObjectKey`; teste estático e espião de Storage (G-04); a função de banco só devolve alvo para `status='ready'` |
| Cache | `no-store` em 200, 404, 409, 429, 503; sem `ETag`; `Referrer-Policy: no-referrer`; cliente usa `Blob` em memória, nunca URL pública |
| Vazamento de dado interno (CA-16, T-11) | listagem com lista fechada de chaves; erros `{ code }` fixo; sem nome, caminho, bucket, tamanho, dimensões, EXIF, IP, `upload_url` ou texto de biblioteca; contadores com nomes fixos (`lista_ok`, `imagem_ok`, `imagem_404`, `exclusao_ok`, `exclusao_repetida`, `ordem_ok`, `ordem_conflito`, `leitura_divergente`, `remocao_fisica_falhou`), sem identificador; sem registro de linha, query ou cabeçalho |
| CSRF | `SameSite=Strict`, Origin e `Sec-Fetch-Site` em `PUT` e `DELETE`, JSON no `PUT`; as leituras não mudam estado de produto (a listagem só faz a liberação preguiçosa, idempotente) |
| Abuso de leitura e escrita | taxas novas (§2.2 a §2.4), 429 sem campo de limite; consultas sem aceite não consomem cota |
| Corrida exclusão × redução | `gone` (93); remoção idempotente; órfão de 3 h como rede |
| Conteúdo da foto (fachada, rosto, R-03) | aviso permanente na tela (decisão 121); a fábrica não analisa a imagem (fora de escopo) |
| XSS | a página cria nós por `textContent`; nenhum `innerHTML` com dado do servidor; CSP `script-src 'self'` |

## 6. Observabilidade

Contadores da §5; sinais operacionais: taxa de `leitura_divergente` (deve ser zero), `remocao_fisica_falhou` e idade da linha marcada mais antiga. Nenhum log de linha com id de foto, cookie, corpo ou IP.

## 7. Testes que provam cada critério

Padrão `[VERIFICADO]`: Vitest em `apps/api/tests`, `packages/domain/tests`, `apps/web/tests`; banco em `packages/db/tests/*.dbtest.mjs`; execução local `corepack pnpm check:all` e `db:test`. Fakes: `MediaStorePort` ganha `list`, `delete`, `reorder`, `readTarget`; o Storage falso ganha `readReduced`. Arquivos novos: `apps/api/tests/media-gallery-h029.test.ts`, `packages/db/tests/media-gallery-h029.dbtest.mjs`, `apps/web/tests/fotos-page.test.ts`.

| ID | Prova | Critérios |
|---|---|---|
| G-01 | Listagem: cada estado derivado (A, B, C, `ready`, `rejected`) com relógio injetado; ordem = posições e recusadas ao fim; vazio ⇒ 200 `[]`; sem rascunho, vencido, descartado, outro cookie ⇒ 404 byte a byte igual ao de H-026; pendente vencido some e libera vaga (limite de 5 coerente); lista fechada de chaves | CA-01, CA-03, CA-09 |
| G-02 | Leitura 200 do dono: bytes iguais aos do objeto `p/<id>` falso; `Content-Type`, `Content-Length` e demais cabeçalhos da §2.2 exatos; sem `ETag`, `Content-Disposition`, `Last-Modified` | CA-02, CA-10 |
| G-03 | 404 uniforme da leitura: sem cookie, malformado, outro dono, outro rascunho, vencido, descartado, `id` não uuid, foto `pending`, em redução, `rejected`, excluída, métodos `HEAD`/`POST`/`OPTIONS` ⇒ corpo e cabeçalhos idênticos à linha de base (técnica de M-06); cookie malformado ⇒ zero chamadas ao banco e ao Storage | CA-10 |
| G-04 | Nunca o original: teste estático (o arquivo do serviço de leitura e a rota não citam `readOriginal`, `QuarantineStoragePort`, `mediaObjectKey`, `d/`); Storage espião com `leiturasDoOriginal === 0` em todos os casos; objeto com tamanho diferente de `ready_bytes`, sem `FF D8 FF` ou ausente ⇒ 503, nada servido, contador `leitura_divergente` | CA-10, CA-16 |
| G-05 | `Cache-Control: no-store` presente em 200, 404, 409, 422, 429, 503 de todas as rotas novas; `Referrer-Policy` e `nosniff` | CA-10 |
| G-06 | Exclusão: duas chamadas sequenciais e duas simultâneas ⇒ 200 igual, uma marcação, uma soma de `photo_rev`; em cada estado (A, B, C, ready, rejected); vaga liberada (5 vivas, exclui 1, a 6ª é emitida); 404 uniforme para foto alheia; depois da limpeza física, nova chamada ⇒ 404 | CA-05, CA-06 |
| G-07 | Falhas: marcação lança erro ⇒ 503 e a foto continua na lista; só a remoção física falha ⇒ 200, linha marcada, `sweepQuarantine` remove depois, contador; estouro do orçamento de 2 s ⇒ 200 sem apagar a linha; excluir durante redução (lease) ⇒ `reduceDone` devolve `gone`, nenhum objeto `d/` nem `p/` sobra | CA-06 |
| G-08 | Banco (`dbtest`): preenchimento das linhas antigas; gatilho dá `max+1` com duas conexões inserindo ao mesmo tempo (nunca repete); ordem alfabética dos gatilhos; `media_reorder` grava 1..N; comparar-e-trocar: lista velha ⇒ `changed`, permutação inválida ⇒ `invalid`, igual ⇒ `unchanged` sem escrita; duas reordenações concorrentes ⇒ uma `ok` e uma `changed`, sem mistura; exclusão e recusa não deixam buraco na sequência exposta; a ordem sobrevive a nova leitura | CA-07, CA-08 |
| G-09 | Rota da ordem: validações (422 `campo_desconhecido`, `vazio`, `ordem_invalida`, mais de 5, não uuid, repetido), 200 e 409 trazem `fotos`, Origin e JSON exigidos, 429 sem campo de limite, 404 uniforme, cota só conta no aceite | CA-07, CA-08 |
| G-10 | Migração: aplicar duas vezes sem erro; RLS e `execute` só `app_api`; `search_path` vazio; `photo_rev` soma `content_rev` e zera `confirmed_at` em exclusão e reordenação, e não em reordenação idêntica; testes T-DB do #43 inalterados e verdes; `.down.sql` restaura o guarda original e deixa o banco como antes; `corepack pnpm db:test` | CA-08 e geral |
| G-11 | Controlador web com DOM simulado e relógio injetado: textos exatos da §5 do refino; polling (3 s, 20 vezes, pausa com aba oculta, `Retry-After`); `finalize` uma vez por episódio; erros da lista (503, 429, 404); foto com erro e regra do foco; exclusão (foco inicial em "Cancelar", Esc, devolução do foco, nada sai antes da resposta, foco no seguinte/anterior/"Adicionar foto", erro mantém a foto, clique duplo = 1 chamada); ordem (otimista, `aria-busy`, volta à anterior, 409, sucesso silencioso, pontas `aria-disabled`, foco no mesmo botão, anúncio); adicionar com portas falsas (fluxo reduz → `/uploads` → `PUT` → `finalize`, limite de 5 com `aria-disabled`, sem WhatsApp) | CA-03, CA-04, CA-05, CA-06, CA-07, CA-08, CA-09, CA-11, CA-12 |
| G-12 | Estático da página: sem hexadecimal (T-15 em `check:all`); só tokens; `lang`, `h1`, região de status, `<dialog>`; sem `innerHTML` com dado do servidor; URLs de objeto revogadas; entrada `/fotos` do `vercel.json` com `no-store` e a CSP da §4; aviso de conteúdo presente com o texto aprovado; página sem chamada a rota de pedido, revisão ou publicação | CA-13, CA-15 |
| G-13 | Sem dado interno: varredura em respostas e saídas capturadas (console, `stdout`, `stderr`, contadores) com sentinelas (`rua-das-flores-12`, chaves `d/`, `p/`, nome de bucket, IP, `upload_url`, `ready_bytes`, `confirmed_bytes`, `reduce_attempts`); corpos de erro só `{ code }`; chaves dos contadores só da lista fixa | CA-16 |
| G-14 | Manual com evidência na Issue (não declarar sem fazer; Playwright e axe não estão instalados, como na #26, salvo se a #43 os instalar): roteiro de teclado por passo; leitura com NVDA e navegador; 320 px e zoom de 200% e 400%; contraste medido nos dois temas; capturas dos estados (vazio, carregando, processando, recusada, erro da lista, erro de exclusão, erro de ordem). Sem isso: `NÃO VERIFICADO` | CA-11, CA-12, CA-13, CA-14 |
| G-15 | Regressão: suítes da #39, #40 e #41 verdes depois de ampliar `MediaStorePort` e os fakes; `finalize`, `GET /v1/media/{id}` e `POST /uploads` com respostas idênticas às de antes | geral |

**Cobertura:** CA-01 G-01 · CA-02 G-02/G-11 · CA-03 G-01/G-11 · CA-04 G-06/G-11 · CA-05 G-06/G-11 · CA-06 G-06/G-07/G-11 · CA-07 G-08/G-09/G-11 · CA-08 G-08/G-09/G-10/G-11 · CA-09 G-01/G-11 · CA-10 G-02 a G-05 · CA-11 G-11/G-14 · CA-12 G-11/G-14 · CA-13 G-12/G-14 · CA-14 G-14 · CA-15 G-12 · CA-16 G-04/G-13. Os 16 critérios têm prova; CA-11 a CA-14 dependem de teste manual e ficam `NÃO VERIFICADO` até ele ser feito.

**Evidência na Issue #42** (comando, contagem e código de saída; nunca declarar CI verde): `corepack pnpm check:all`, `corepack pnpm db:test`, saída do `npx supabase` na aplicação da migração, tabela dos casos de 404 e de cabeçalhos, resultado do roteiro manual por passo.

## 8. Arquivos e plano para o DEV

Novos: `supabase/migrations/20261112190000_media_expand_photo_order.sql`, `supabase/rollbacks/20261112190000_media_expand_photo_order.down.sql`, `packages/domain/src/media/gallery.ts` (constantes, `parseMediaOrderBody`, tipos), `apps/api/src/media/media-gallery-service.ts`, `apps/web/public/fotos.{html,css,js}`, os três arquivos de teste da §7. Alterados no fim, com a árvore limpa: `packages/domain/src/media/{ports,index}.ts`, `packages/db/src/media-quarantine.ts` (quatro métodos + `readReduced`), `apps/api/src/media/media-route.ts` (roteamento das quatro rotas novas), `apps/api/src/composicao.ts`, fakes dos testes de mídia, `apps/web/vercel.json`.

Ordem: 0) conferir #41 fora de Desenvolvimento, `ls supabase/migrations` e o corpo vigente do guarda da #43. 1) Migração, rollback e G-08/G-10. 2) Domínio, portas e adaptador do banco. 3) Serviço e rotas (listagem, leitura, exclusão, ordem) com G-01 a G-07, G-09, G-13. 4) Página e controlador com G-11/G-12. 5) `check:all`, `db:test`, roteiro manual e evidência na Issue.

## 9. Limitações

1. Contraste, leitor de tela, zoom e navegador real não são provados por teste automático nesta entrega; ficam `NÃO VERIFICADO` até o roteiro manual (G-14).
2. O endpoint de leitura do Storage (`request-photos/p/<id>` com a credencial de serviço) é `[NÃO VERIFICADO]` contra o Storage remoto, como os demais métodos da classe.
3. A foto passa pela função da API (arranque a frio e custo de uma leitura por miniatura). Aceito: no máximo 5 fotos de até 0,75 MB por pedido.
4. Uma foto `enviando` que está sendo enviada por outra aba aparece como "O envio desta foto não foi concluído." nesta aba, até a outra terminar. Aceito.
5. Sem capa, sem deduplicação, sem ampliação da foto, sem marca d'água (fora do escopo, decisões 120 e 123).
6. O aviso de fachada, interior e rostos não impede o envio; nenhuma análise da imagem é feita.

## 10. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R-01 | #41 e #42 mexem nos mesmos arquivos de mídia | #42 espera a #41 sair de Desenvolvimento ou usa só arquivos novos até o fim (§0) |
| R-02 | Mexer no guarda de `request_draft` (objeto da #43) e deixar `ready` fora do `photo_rev` | Mudança de uma linha, corpo copiado do vigente, T-DB do #43 verdes; H-031 lê as fotos `ready` ao publicar e reconfere `content_rev` |
| R-03 | Impasse entre `media_delete`/`media_reorder` e `media_sweep`/`media_reduce_*` | As funções novas travam rascunho antes da foto, como `media_issue`; sem gatilho na foto que atualize o rascunho; teste de concorrência (G-08) |
| R-04 | `connect-src` sem a origem do Storage quebra o envio | Entrada própria em `vercel.json` com a origem; teste estático e verificação manual no navegador |
| R-05 | `sort_order` com folga ou ordem dos gatilhos mudar | Posição exposta sempre por `row_number()`; teste da ordem alfabética dos gatilhos e da concorrência |
| R-06 | Servir objeto errado ou corrompido | Conferência de tamanho e assinatura; 503 e contador, nunca serve |
| R-07 | Mover ao lado de foto ainda em preparo | A troca vale entre vizinhas na sequência viva; foto em preparo ocupa sua posição, só sem botões de mover |
| R-08 | Foco e leitor de tela divergem entre navegadores | Roteiro manual (G-14) com NVDA; diálogo nativo `<dialog>` com devolução explícita do foco |
| R-09 | Recusadas acumulam na lista | O cliente as exclui; saem com o rascunho no expurgo |

## 11. Dúvidas ao líder (não bloqueiam o DEV)

1. **Mexer no guarda de confirmação da #43** (§3 item 4) para que excluir ou reordenar foto zere a confirmação do pedido. **Recomendação:** sim, porque 90 §3.3 deixou isso como critério da #42. **Alternativa:** não tocar na função da #43 e deixar a reconferência das fotos só para a H-031; mais simples, mas o pedido confirmado não percebe a mudança de fotos.
2. **Textos complementares** da §4.1 (título, contador, diálogo de exclusão, anúncios). **Recomendação:** aprovar como estão.
3. **Aviso de conteúdo sempre visível**, mesmo sem fotos (a refino pedia "com fotos"). **Recomendação:** sempre visível, pois o aviso vale antes do envio.
