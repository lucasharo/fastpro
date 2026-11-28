# H-027 — Desenho: redução e reencode das fotos

- **Issue:** #40 · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-12 · **Papel:** Architect
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou pelo líder · `[VERIFICADO]` conferido no código ou documento · `[PROPOSTA]` sugestão do Architect · `[NÃO VERIFICADO]` sem fonte ou sem medição
- **Base:** 92-REFINO-H027 (CA-01 a CA-13), 88-DESENHO-H026 (§1 a §4, §8), decisões 79 a 85 (11-DECISOES, rodada 25), spikes/S-06-RESULTADO.md, spikes/S-09-RESULTADO.md §6, 41-DECISAO-S09-CAMINHO, 08 §10.1 a §10.4, 11-ARQ (R-11, R-25, R-31, F-09, F-11, P-03, P-04, T-11); código de `apps/api/src/media`, `packages/domain/src/media`, `packages/db/src/media-quarantine.ts` e a migração `20261112120000`.

## 0. Situação encontrada e decisões do dono do produto (não reabertas)

- `[VERIFICADO]` A #39 entrega `app.media_asset` (`pending`, `confirmed_at`, `confirmed_bytes`), o bucket `quarantine`, as rotas `POST /v1/media/uploads`, `POST /v1/media/{id}/finalize`, `GET /v1/media/{id}`, o expurgo em duas fases e o limite de 5 fotos vivas. **Esta história reaproveita tudo isso e só acrescenta.**
- `[VERIFICADO]` O bucket `request-photos` aparece em 08 §10 e na lista fechada `RETENTION_BUCKETS`, mas **nenhuma migração o cria** (grep em `supabase/migrations`; só `retention_object_queue` o cita no `check`). Esta migração o cria.
- `[VERIFICADO]` Não existe `sharp` no repositório (só em `docs/factory/spikes/s09`). Não existe código de redução nem módulo de upload no navegador.
- `[DECIDIDO]` 79 rotação na #40 · 80 HEIC segue 415 · 81 reencode síncrono no `finalize` · 82 original apagado logo após gravar a reduzida (altera 88 §8, condição 2; feito nesta entrega) · 83 alvo 0,5 MB, teto 0,75 MB, redução no navegador antes de emitir o tamanho · 84 `rejected` só para falha que não se resolve, saída JPEG · 85 carga do `sharp` em Linux x64 verificada antes da construção (§8).
- `[VERIFICADO]` Migração mais recente no disco: `20261112130000` (`draft_expand_identity_attach`, ainda não versionada). **Migração nova: `20261112140000_media_expand_reduce_ready.sql`** e `supabase/rollbacks/20261112140000_media_expand_reduce_ready.down.sql`. O DEV reconfere o próximo número livre em `supabase/migrations` na hora de criar (outras sessões acrescentam arquivos).

## 1. Visão geral do fluxo

```
navegador                          API (Vercel)                         Storage
 escolhe foto
 reduz (canvas, JPEG <= 1280 px, ~0,5 MB)  [CA-12]; se não conseguir, mantém o original <= 10 MB
 POST /uploads {tipo, tamanho REDUZIDO}  -> media_issue (H-026, inalterado)
 PUT upload_url ------------------------------------------------------> quarantine/d/<id>
 POST /{id}/finalize -> (1) confirma (stat + media_finalize, H-026)
                        (2) reduce_begin (lease) -> (3) lê d/<id> -> (4) reencode (sharp)
                        (5) grava request-photos/p/<id> (upsert) -> (6) reduce_done (ready)
                        (7) remove quarantine/d/<id> -> (8) original_removed
 <- 200 {id, status:"ready", confirmed:true}
```

A API passa a **ler** os bytes do original, mas só dentro da etapa de redução, por uma porta própria (§4). A porta de quarentena da #39 não ganha método de leitura. O servidor é a única garantia: o que o navegador reduziu é reencodado do mesmo jeito (CA-12).

## 2. Contratos da etapa de redução

### 2.1 Estados do registro

`[PROPOSTA]` Sem estado novo no enum `status` (continua `pending|ready|rejected`). Os subestados vêm das colunas novas (§3):

| Sigla | Condição | Observação |
|---|---|---|
| A | `pending`, `confirmed_at` nulo | H-026, inalterado |
| B | `pending`, `confirmed_at` preenchido, sem lease ativa | aguardando redução (ou nova tentativa) |
| C | como B, com `reduce_lease_until > agora` | reduzindo em alguma instância |
| D | `ready`, `ready_*` preenchidos | final; objeto `request-photos/p/<id>` existe |
| E | `rejected`, `reject_code` preenchido | final; nenhum objeto reduzido; original removido |

### 2.2 Transições

| De → Para | Gatilho | Efeito |
|---|---|---|
| A → B | `finalize` confirma (H-026, `media_finalize` inalterada) | segue direto para a redução na mesma chamada |
| B → C | `media_reduce_begin` | grava `reduce_lease_until = agora + 30 s` e `reduce_attempts + 1`; devolve o número da tentativa |
| C → D | `media_reduce_done` (objeto reduzido já gravado) | `status='ready'`, `ready_at/bytes/width/height`, lease limpa; só aceita a tentativa dona |
| C → E | `media_reduce_reject` (falha definitiva, §2.4) | `status='rejected'`, `reject_code`; vaga liberada (`rejected` não conta, 88 §2) |
| C → B | falha transitória: `media_reduce_release` | lease limpa; `reduce_attempts` mantido se o tempo ou a memória estouraram, devolvido (−1) se foi erro do armazenamento ou carga do `sharp` |
| C → C' | lease vencida (instância morreu) | outra chamada de `finalize` toma a lease; a tentativa antiga fica obsoleta (`lost`) |
| D → D | `finalize` repetido | `media_reduce_begin` devolve `ready`; **nenhum reencode** (CA-06) |
| E → E | `finalize` repetido | devolve o mesmo código de recusa, sem reprocessar |
| B (tentativa 4) → E | já foram 3 tentativas sem concluir | `media_reduce_begin` grava `rejected` com `nao_processavel` (ver 2.4 e pergunta 1) |

Nunca existe `ready` sem objeto nem objeto reduzido definitivo sem registro (CA-03, CA-05): a ordem é **objeto primeiro, registro depois, remoção do original por último**. Falha entre o passo (5) e o (6) deixa um objeto reduzido sem registro `ready`; ele é sobrescrito pela nova tentativa (chave determinística, §4) ou removido pelo expurgo do rascunho (§5.3). Falha entre (6) e (7) deixa o original além do necessário; o passo (8) e a lista de limpeza o recolhem (§5.2).

### 2.3 O que muda no `finalize` (substitui o CA-09 de H-026 só neste ponto)

Antes, o `finalize` "nunca grava `ready`". Agora ele continua **confirmando** como antes (stat do tamanho, `media_finalize`, 404/409/413 idênticos) e **em seguida** reduz. `ready` só é gravado por `private.media_reduce_done`. Respostas:

| Resultado | HTTP | Corpo |
|---|---|---|
| reduzida agora ou já pronta | 200 | `{ id, status:"ready", confirmed:true }` |
| outra chamada está reduzindo (lease ativa) | 409 | `{ code:"processando" }` + `Retry-After: 3` |
| arquivo não decodifica como JPG, PNG ou WebP | 422 | `{ code:"imagem_invalida" }` |
| área acima de 64 MP | 422 | `{ code:"imagem_grande_demais" }` |
| não cabe em 0,75 MB no piso de qualidade | 422 | `{ code:"nao_cabe_no_limite" }` |
| 3 tentativas sem concluir | 422 | `{ code:"nao_processavel" }` |
| tempo, memória, erro de Storage, `sharp` não carregou | 503 | corpo fixo já existente na #39 + `Retry-After: 5` |
| instância cheia (4 reduções em curso, espera de 2 s esgotada) | 503 | mesmo corpo fixo + `Retry-After: 2`, **sem tocar o banco** |
| nenhuma das condições de H-026 | 404/409/413/429 | inalterado |

Corpos de erro continuam `{ code }` fixo, sem eco de entrada, sem mensagem de biblioteca, sem caminho. A mensagem em português para o visitante é montada no cliente a partir do `code`. `GET /v1/media/{id}` e a repetição de `POST /uploads` passam a poder devolver `status:"ready"` ou `"rejected"`; continuam sem URL, tamanho, dimensões ou caminho (CA-11, CA-13). Repetir `POST /uploads` com o mesmo `client_upload_id` de uma foto `rejected` devolve 200 com `status:"rejected"` (a vaga está livre; para tentar outra foto, o navegador gera outro `client_upload_id`).

### 2.4 Falha definitiva versus transitória (decisão 84)

| Situação | Classe | Efeito |
|---|---|---|
| `sharp.metadata` falha, ou o formato detectado não é `jpeg`, `png` ou `webp` (inclui GIF, TIFF, SVG, AVIF, HEIC) | definitiva `imagem_invalida` | rejeita; remove original |
| `width × height > 64.000.000` (`limitInputPixels`) | definitiva `imagem_grande_demais` | idem |
| no piso de qualidade (q32) a saída passa de 750.000 bytes | definitiva `nao_cabe_no_limite` | idem |
| passou de 10 s no reencode ou faltou memória | transitória (conta tentativa) | 503; lease limpa |
| Storage falha ao ler, gravar ou remover | transitória (não conta) | 503; lease limpa, tentativa devolvida |
| `sharp` não carrega no ambiente | transitória (não conta) | 503; **nunca** vira `rejected` |
| 3 tentativas contadas sem concluir (4ª chamada) | definitiva `nao_processavel` | `[PROPOSTA]` ver pergunta 1 |

A leitura incompleta ou o arquivo truncado é definitivo: o que está na quarentena é o que está (não há outra cópia).

## 3. Dados (migração por expansão, reversível)

`[PROPOSTA]` `20261112140000_media_expand_reduce_ready.sql`. Só **acrescenta** colunas anuláveis, restrições compatíveis com as linhas existentes (todas `pending`, colunas novas nulas), funções novas e o bucket. Não redefine nenhuma função da #39 (`media_issue`, `media_get`, `media_finalize`, `media_sweep`, `media_purge_done`, `media_known`, o trigger de limite), por isso o desfazer é limpo. Idempotente (`add column if not exists`, constraints em bloco `do $$` que consulta `pg_constraint`).

**Colunas novas em `app.media_asset`:**

| Coluna | Tipo / regra | Uso |
|---|---|---|
| `ready_at` | timestamptz null | momento da passagem a `ready` |
| `ready_bytes` | integer null, `between 1 and 750000` | tamanho final (CA-13) |
| `ready_width`, `ready_height` | smallint null, `between 1 and 1280` | dimensões finais (CA-13) |
| `reject_code` | text null, `in ('imagem_invalida','imagem_grande_demais','nao_cabe_no_limite','nao_processavel')` | motivo fixo da recusa; sem texto livre |
| `reduce_lease_until` | timestamptz null | lease da instância que reduz |
| `reduce_attempts` | smallint not null default 0, `between 0 and 4` | tentativas contadas; também é o "token" da tentativa |
| `original_removed_at` | timestamptz null | quando o original saiu da quarentena |

**Restrições (fecham os estados válidos):** `media_asset_ready_ck`: `(status = 'ready') = (ready_at is not null and ready_bytes is not null and ready_width is not null and ready_height is not null)`; `media_asset_reject_ck`: `(status = 'rejected') = (reject_code is not null)`; `media_asset_ready_confirmed_ck`: `status <> 'ready' or confirmed_at is not null`. **Sem coluna de caminho, nome original, EXIF, IP ou tipo detectado** (CA-13). A "referência" da versão reduzida é derivada: `request-photos/p/<id>` (§4).

**Funções novas** (`security definer`, `set search_path = ''`, `p_now` informado pelo chamador, `revoke all` de `public, anon, authenticated, service_role`, `grant execute` só a `app_api`):

- `private.media_reduce_begin(p_hash text, p_id uuid, p_now timestamptz, p_lease_s integer)` ⇒ `(out_code, out_attempt, out_reject_code, out_original_pending)`. `out_code` ∈ `begin | ready | rejected | busy | not_confirmed | not_found`. Posse pelo `p_hash` como em `media_get`; `for update of m`; ordem: não encontrado → `ready` (com `out_original_pending = original_removed_at is null`) → `rejected` (com o código) → não confirmado → lease ativa (`busy`) → `reduce_attempts >= 3` (grava `rejected/nao_processavel` e devolve `rejected`) → toma a lease, soma 1 e devolve `begin` com o número da tentativa. `p_lease_s` entre 5 e 120.
- `private.media_reduce_done(p_id uuid, p_attempt smallint, p_bytes integer, p_width integer, p_height integer, p_now timestamptz)` ⇒ `out_code` ∈ `done | lost | gone`. Só grava `ready` se a linha não está marcada para expurgo, está `pending` e confirmada e `reduce_attempts = p_attempt`. `gone` = linha marcada ou apagada durante a redução (o serviço remove o objeto reduzido que acabou de gravar). `lost` = outra tentativa assumiu.
- `private.media_reduce_reject(p_id uuid, p_attempt smallint, p_code text, p_now timestamptz)` ⇒ `rejected | lost | gone`; valida `p_code` na lista.
- `private.media_reduce_release(p_id uuid, p_attempt smallint, p_count boolean)` ⇒ boolean; limpa a lease da tentativa dona e, se `p_count = false`, subtrai 1 de `reduce_attempts`.
- `private.media_original_removed(p_id uuid, p_now timestamptz)` ⇒ boolean; grava `original_removed_at` só em `ready` ou `rejected`.
- `private.media_original_cleanup_list(p_limit integer)` ⇒ `uuid[]` de linhas `ready` ou `rejected` com `original_removed_at` nulo e `purge_requested_at` nulo (limite 1 a 1000).

**Bucket `request-photos`** `[PROPOSTA]`, mesma migração, idempotente: `public=false`, `file_size_limit=750000`, `allowed_mime_types=array['image/jpeg']`, `on conflict (id) do update`. **Nenhuma política em `storage.objects`.** Só a API escreve e remove, com a credencial de serviço do ambiente do servidor (`.env.local`, nunca em tabela, log ou resposta). `[NÃO VERIFICADO]` se o ambiente remoto já tem esse bucket com outra configuração; o DEV aplica pela migração (`npx supabase`, nunca pelo MCP).

**Desfazer** (`.down.sql`, execução manual, só em desenvolvimento): recusa se existir linha `ready` ou `rejected`, ou objeto em `request-photos`; senão remove funções, restrições e colunas novas e o registro `ops.schema_migration`. O bucket vazio é removido depois pela API do Storage (o Supabase bloqueia `DELETE` direto em `storage.buckets`, mesmo padrão do rollback da #39). Segunda aplicação da migração não gera erro.

## 4. Processamento

### 4.1 Portas (domínio recebe a interface; implementação na API)

- `[PROPOSTA]` `MediaReduceStoragePort` (nova, **interna ao serviço de redução**, não exposta a rota): `readOriginal(id) ⇒ Uint8Array|null` (bucket `quarantine`, chave `d/<id>`, aborta se passar de 10 MB), `putReduced(id, bytes) ⇒ void` (bucket `request-photos`, chave `p/<id>`, `content-type image/jpeg`, `x-upsert: true`), `removeOriginal(id)` (ausente conta como sucesso), `removeReduced(id)`, `statReduced(id)`. A chave `p/<uuid>` é **determinística a partir do id** (uuid v4 do banco, sem nome original): a nova tentativa sobrescreve o mesmo objeto, então não há segunda versão (CA-05, CA-06), e não precisa coluna de caminho.
- `QuarantineStoragePort` da #39 **não muda** (continua sem leitura). O teste M-08 da #39 segue valendo.
- `ImageReducerPort` `[PROPOSTA]`: `reduce(bytes, { deadlineMs }) ⇒ { ok:true, bytes, width, height } | { ok:false, kind:'definitive', code } | { ok:false, kind:'transient', cause:'timeout'|'memory'|'unavailable' }`. A implementação real usa `sharp` carregado de forma preguiçosa (`await import('sharp')`); versão falsa nos testes de serviço. Nenhuma mensagem de biblioteca atravessa a porta: o erro vira código.

### 4.2 Algoritmo do reencode (determinístico) `[VERIFICADO]` S-06 §2 a §4

1. `sharp.concurrency(1)` e `sharp.cache(false)` na carga do módulo.
2. `sharp(input, { limitInputPixels: 64_000_000, failOn: 'error' })`; `metadata()` lê só o cabeçalho: formato fora de `jpeg|png|webp` ou erro ⇒ `imagem_invalida`; área > 64 MP ⇒ `imagem_grande_demais`. Endurecimento opcional do DEV: `sharp.block({ operation: ['VipsForeignLoad'] })` seguido de `unblock` só dos carregadores JPEG, PNG e WebP, para que SVG, TIFF e GIF nem cheguem a decodificar `[NÃO VERIFICADO]` a API existe na versão instalada.
3. Pipeline: `.rotate()` (aplica a orientação; CA-08) → `.resize(1280, 1280, { fit:'inside', withoutEnlargement:true })` (foto menor não é ampliada; a orientação já foi aplicada, então o maior lado de 1.280 vale no eixo real) → `.toColourspace('srgb')` → `.flatten({ background:'#ffffff' })` (PNG com transparência) → saída bruta em memória, **uma vez**.
4. Do bruto, JPEG `mozjpeg` com qualidade em degraus `80, 72, 65, 58, 50, 44, 38, 32`: para no primeiro resultado `<= 500.000` bytes. Se no degrau 32 o resultado passa de 500.000 mas fica `<= 750.000`, aceita (é o teto). Se passa de 750.000 ⇒ `nao_cabe_no_limite`. (1 MB = 1.000.000 bytes, como no S-06.)
5. **Nenhuma** chamada a `withMetadata`, `keepMetadata`, `withExif`, `withIccProfile` ou `withXmp` no módulo (teste estático, §7). O sharp, por padrão, não copia metadado da entrada.
6. Prazo: `deadlineMs = início + 10.000`; checado antes de cada passo (decodificar, redimensionar, cada degrau). Estourou ⇒ `transient/timeout`. O sharp não é cancelável no meio de um passo; cada passo medido dura menos de 0,6 s (S-06), então o excesso é pequeno.
7. Saída: bytes JPEG, largura e altura finais (do `info` do sharp).

### 4.3 Limites (CA-07) `[PROPOSTA]` S-06 §4.3, R-11

| Limite | Valor | Como é imposto |
|---|---|---|
| Arquivos por vez em cada redução | 1 | etapas em sequência, `sharp.concurrency(1)`, sem `Promise.all` sobre o mesmo arquivo |
| Reduções simultâneas por instância | 4 | semáforo em memória com 4 permissões; a permissão é tomada **antes** de ler o original e do `reduce_begin`; espera até 2 s; depois 503 com `Retry-After: 2` sem tocar o banco |
| Memória-alvo | 512 MB por instância | orçamento de pixels em voo: soma de `largura × altura` das reduções em curso ≤ 128 MP (cada permissão registra a área lida em `metadata()`; área acima do que sobra espera como as demais). Cobre o pior caso PNG de 64 MP (≈ 256 MB decodificado) sem somar 4 deles `[PROPOSTA; NÃO VERIFICADO no Linux]` |
| Duração por foto | 10 s no reencode | prazo cooperativo (§4.2 passo 6); lease do banco de 30 s cobre leitura, gravação e remoção; `maxDuration` da função configurada com folga e verificada na primeira pré-visualização |
| Entrada | 10 MB | já imposto por bucket e `finalize` (H-026) |

### 4.4 Redução no navegador (CA-12) `[PROPOSTA]`

Módulo no `apps/web` com **portas injetadas** (decodificar, desenhar, codificar), para teste sem navegador. Passos: `createImageBitmap(arquivo, { imageOrientation:'from-image' })` → escala para maior lado ≤ 1.280 sem ampliar → `canvas.toBlob('image/jpeg', q)` no mesmo degrau de qualidade do servidor, parando em ≤ 500.000 bytes → `POST /uploads` com `content_type:"image/jpeg"` e `size_bytes` do blob reduzido → `PUT` do blob. O plano de dimensões e a escada de qualidade são funções puras de `packages/domain/src/media/reduce-plan.ts`, usadas pelo navegador e pelos testes do servidor (uma só regra). **Fallback:** sem `createImageBitmap`/canvas, erro de decodificação (inclui HEIC, que continua 415 no servidor, decisão 80) ou blob que não fecha ≤ 750.000: envia o original (≤ 10 MB) com o tipo declarado; o servidor reduz. O servidor nunca confia no que o navegador fez. A rotação do canvas (`from-image`) é recurso do navegador `[NÃO VERIFICADO]` em Safari antigo; se a orientação não for aplicada lá, o JPEG sai sem EXIF e o servidor não consegue corrigir. Por isso o cliente só usa a redução quando `createImageBitmap` aceita a opção, senão envia o original.

## 5. Segurança e privacidade

### 5.1 Saída sem metadado de entrada (CA-09) e sem dado pessoal (CA-10)

- Reencode reconstrói o JPEG do bruto, sem copiar EXIF, XMP, IPTC, GPS ou ICC; o perfil de cor é aplicado (convertido a sRGB) antes de ser descartado. `[VERIFICADO]` S-06 §3.5. Perfil Display P3 `[NÃO VERIFICADO]`: teste de cor (R-12 abaixo) e registro.
- Log com **lista permitida**: rota, status, `code`, duração em ms, id da requisição, número da tentativa. Nunca: bytes, tamanhos exatos, dimensões, nome, EXIF, IP, query, `upload_url`, chave do objeto, corpo ou cabeçalho, `error.message` ou `error.stack` de biblioteca (o erro vira código na porta). IP continua só como HMAC no balde de taxa.
- Respostas só com `{ id, status, confirmed }` ou `{ code }` (§2.3). Nenhuma devolve tamanho, dimensões, caminho ou bucket (CA-13 vale para o registro; as colunas existem para H-029 e H-056, não para esta API).
- **Sem leitura nova (CA-11):** nenhuma rota `GET` de arquivo, nenhuma política em `storage.objects` de `request-photos` ou `quarantine`, nenhum `createSignedUrl` de leitura, nenhum método de download exposto a rota. `readOriginal` só é chamado por `reduceMedia`. Visualização é de H-056 e H-029.
- Superfície do decodificador: só `jpeg|png|webp` após `metadata()`; limite de 64 MP; WebP animado: só o primeiro quadro (`pages` padrão), `[NÃO VERIFICADO]` com WebP animado grande, entra no conjunto de teste.

### 5.2 Original apagado logo e limpeza de sobras (decisão 82)

O original sai da quarentena no passo (7), logo depois de `media_reduce_done`, e também em toda recusa definitiva. Se a remoção falhar, a linha fica sem `original_removed_at`; três recolhimentos independentes: (a) o próximo `finalize` da mesma foto (`out_original_pending` em `media_reduce_begin`) tenta de novo sem reencodar; (b) `sweepQuarantine` ganha o passo "limpar originais" usando `media_original_cleanup_list`, a porta de remoção e `media_original_removed`; (c) a varredura de órfãos por idade de 3 h (H-026) continua. **Quarentena deixa de reter original com EXIF depois da redução**; fica retido apenas o intervalo entre o envio e o `finalize` (até 30 min, TTL do pendente), e o envio que nunca é finalizado até o expurgo (88 §8, condição 3).

### 5.3 Expurgo junto com o rascunho

`media_sweep` e `media_purge_done` da #39 não mudam. `sweepQuarantine` passa a remover, para cada id marcado, `quarantine/d/<id>` **e** `request-photos/p/<id>` (ausente conta como sucesso) antes de chamar `media_purge_done`; objeto reduzido sem registro (queda entre os passos 5 e 6) fica coberto porque a linha existe até o expurgo. Foto de rascunho `publicado` não é varrida (vínculo ao pedido é H-030/H-031).

## 6. Observabilidade

Contadores por código, sem identificador: `reduzida`, `recusa_<code>` (4), `transitoria_timeout|memoria|storage|sharp`, `ocupado`, `processando`, `perdida` (lease), `limpeza_original_pendente`. Sinais operacionais: quantidade de linhas com `original_removed_at` nulo e `status <> 'pending'` (deve ficar perto de zero), idade da lease mais antiga, taxa de `nao_processavel`. Latência da redução (p50 e p95 em ms) para comparar com os 10 s.

## 7. Testes e critérios verificáveis

Padrão `[VERIFICADO]` da #39: unidade e rota em `apps/api/tests` e `packages/domain/tests`; banco em `packages/db/tests/media-reduce-h027.dbtest.mjs`; execução local `corepack pnpm check:all` e `db:test`; Storage falso nas unidades, Storage local (`npx supabase`) na prova de objetos. **Conjunto de imagens gerado dentro do teste** (sem foto real, sem arquivo binário versionado), com o próprio `sharp`: JPG 3000x4000, PNG 3000x4000, ruído branco (pior caso), JPG e PNG 8000x6000, WebP, PNG-bomba 15.000x15.000, texto renomeado `.jpg`, cabeçalho HEIC falso, GIF, SVG, JPEG truncado, PNG com transparência, JPEG com orientação 6 e EXIF/GPS fictício, perfil Display P3, foto menor que 1.280 px.

| ID | Prova | Critérios |
|---|---|---|
| R-01 | Para cada imagem aceita do conjunto: saída JPEG com maior lado ≤ 1.280 (foto pequena não ampliada), tamanho ≤ 750.000 e, nas fotos comuns, ≤ 500.000; ruído branco ≤ 750.000; leitura da saída com `sharp.metadata` confere largura, altura e formato; imagem que não cabe em 750.000 no piso q32 (entrada fabricada com um redutor falso que devolve sempre 800 KB) ⇒ `nao_cabe_no_limite` | CA-01 |
| R-02 | Serviço com Storage falso e depois Storage local: após `finalize`, `quarantine` sem `d/<id>`, `request-photos` com exatamente 1 objeto `p/<id>` (nome uuid, sem extensão, sem nome original), nenhum outro objeto; `original_removed_at` preenchido | CA-02 |
| R-03 | Ordem das chamadas registrada pelos falsos: `putReduced` < `media_reduce_done` < `removeOriginal`; `ready_*` no banco só com o objeto existente (`statReduced` verdadeiro); falha injetada em cada passo nunca deixa `ready` sem objeto; `done` devolvendo `gone` ⇒ o serviço remove o objeto reduzido gravado; constraint `media_asset_ready_ck` barra `ready` sem colunas e colunas sem `ready` (SQL direto) | CA-03 |
| R-04 | Cada recusa do conjunto (texto `.jpg`, HEIC falso, GIF, SVG, truncado, bomba de 225 MP, 64 MP + 1) ⇒ `rejected` com o `reject_code` correto, 422 com `{ code }` fixo (sem mensagem de biblioteca), original removido, nenhum objeto em `request-photos`, vaga liberada (6ª foto aceita depois de 5 vivas com 1 `rejected`); mesma recusa no `finalize` repetido sem reprocessar | CA-04 |
| R-05 | Falhas injetadas: tempo (relógio falso passa de 10 s), memória (redutor falso), erro de Storage na leitura, na gravação e na remoção, `sharp` indisponível ⇒ 503, nunca `rejected`, original permanece (exceto falha só na remoção, que mantém `ready`), `reduce_attempts` conforme §2.2, nova tentativa do mesmo `finalize` conclui com 1 só objeto; 3 tentativas contadas falhando ⇒ a 4ª ⇒ `rejected` com `nao_processavel`; falha de Storage 5 vezes seguidas **não** chega a rejeitar | CA-05 |
| R-06 | `finalize` duas vezes e duas chamadas simultâneas (banco): a 2ª recebe `ready` (ou `processando`) sem reencode (contador do redutor falso = 1), sem segundo objeto, mesmo corpo; `finalize` após `ready` com `original_removed_at` nulo tenta só a remoção | CA-06 |
| R-07 | Redutor falso com atraso controlado: 10 `finalize` simultâneos ⇒ máximo observado de reduções em voo = 4, nenhuma foto em dois processamentos paralelos, o 5º+ espera até 2 s e então 503 `Retry-After: 2` sem consultar o banco; orçamento de 128 MP respeitado; **medição com `sharp` real** (script reproduzível, tempo e `maxRSS` por processo) registrada na Issue: ≤ 10 s por foto e pico por instância conforme §4.3, no Windows local; Linux/Vercel `NÃO VERIFICADO` | CA-07 |
| R-08 | JPEG e PNG com orientação 6 (e 3, 8): saída 960x1280 para entrada 4000x3000 girada, pixel de referência na posição certa | CA-08 |
| R-09 | Entrada com EXIF, GPS, XMP e ICC fictícios: `sharp.metadata` da saída sem `exif`, `xmp`, `icc`; varredura de bytes sem `Exif`, `GPS`, `http://ns.adobe.com`, marcador `APP1`/`APP2`; teste estático proíbe `withMetadata|keepMetadata|withExif|withIccProfile|withXmp` no módulo; **a prova formal (ExifTool e checagem de tipo pelo conteúdo) é da #41** | CA-09 |
| R-10 | Sentinelas (T-11): nome `rua-das-flores-12.jpg`, coordenada fictícia, IP e cabeçalho sentinela; captura de todas as linhas de log e de todas as respostas (corpo e cabeçalhos) em sucesso, recusa e falha transitória: nenhuma contém sentinela, nome, IP, caminho, chave `p/…`/`d/…`, tamanho exato, dimensões ou texto de erro do `sharp` | CA-10 |
| R-11 | Varredura de rotas: só as 3 rotas da #39; nenhum `GET` de arquivo; `QuarantineStoragePort` sem método de leitura; `MediaReduceStoragePort` referenciada só por `reduceMedia`; nenhuma chamada a `createSignedUrl`/`download` fora dessa porta; Storage local: `anon` e `authenticated` (e dono) não listam, não leem, não assinam em `request-photos` e `quarantine`; `storage.objects` sem política; ambos os buckets `public=false` | CA-11 |
| R-12 | Módulo do navegador com portas falsas: escolhe a foto ⇒ reduz ⇒ **primeiro** emite com `content_type image/jpeg` e `size_bytes` do blob reduzido ⇒ envia; sem `createImageBitmap`, erro de decodificação, HEIC ou blob > 750.000 ⇒ envia o original com o tipo e o tamanho dele; `reduce-plan` é a mesma função usada no servidor (um teste de paridade com o conjunto); perfil Display P3 convertido sem cor lavada (comparação de pixel por tolerância). Em navegador real: `NÃO VERIFICADO` até a primeira conferência manual | CA-12 |
| R-13 | Banco: colunas novas existem; `ready_bytes > 750000`, `ready_width > 1280`, `reject_code` fora da lista ⇒ barrados; nenhuma coluna de nome, caminho, EXIF, IP ou tipo detectado (consulta ao catálogo); resposta de `media_get`/`finalize` só com `id/status/confirmed` | CA-13 |
| R-14 | Banco (`media-reduce-h027.dbtest.mjs`): `begin` com duas conexões ⇒ uma `begin` e uma `busy`; lease vencida ⇒ outra assume e a antiga recebe `lost` em `done`; `done` com a linha marcada para expurgo ⇒ `gone`; `release` com `p_count false` devolve a tentativa; 4ª chamada ⇒ `rejected/nao_processavel`; `cleanup_list` devolve só `ready|rejected` sem `original_removed_at`; RLS forçada, `anon/authenticated/service_role/PUBLIC` sem execute, `app_api` com execute, `search_path` vazio; migração aplicada duas vezes sem erro; rollback recusa com `ready`/`rejected` ou objeto em `request-photos`; teste estático: só `media_reduce_done` atribui `'ready'` | geral, CA-03, CA-05 |
| R-15 | Ponta a ponta com Storage local: emitir ⇒ PUT em `quarantine` ⇒ `finalize` ⇒ `ready`, 1 objeto em `request-photos`, 0 em `quarantine`; expurgo do rascunho (`sweepQuarantine`) remove o reduzido e a linha | CA-02, CA-03 |

**Cobertura:** CA-01 R-01 · CA-02 R-02/R-15 · CA-03 R-03/R-14 · CA-04 R-04 · CA-05 R-05/R-14 · CA-06 R-06 · CA-07 R-07 · CA-08 R-08 · CA-09 R-09 · CA-10 R-10 · CA-11 R-11 · CA-12 R-12 · CA-13 R-13. Os 13 critérios têm prova. **Ajuste obrigatório de testes da #39:** o teste estático M-09 (nenhuma função da migração atribui `'ready'`) passa a valer só para a migração `20261112120000`; o equivalente novo é R-14. O teste que exige `finalize` sem `ready` muda para o novo contrato (§2.3).

## 8. Gate do `sharp` em Linux x64 (decisão 85) — primeiro passo do DEV

1. `[VERIFICADO]` hoje: o pacote de produção para `linux-x64` mede 51 MB (S-09 §6, meta ≤ 250 MB) e o `sharp` carrega no Windows. Carga em Linux: `NÃO VERIFICADO`. Verifiquei de novo neste desenho: `wsl.exe -l -v` informa que **não há distribuição WSL instalada**, e a decisão 41 proíbe instalar algo novo para isso; não há Docker.
2. Passo 0 do DEV: (a) adicionar `sharp` a `apps/api` com `supportedArchitectures` do pnpm para `linux/x64/glibc` além do ambiente atual (assim o `pnpm-lock.yaml` já fixa os binários `@img/sharp-linux-x64` e `@img/sharp-libvips-linux-x64`) `[NÃO VERIFICADO neste repositório]`; (b) conferir que o empacotamento da função inclui esses binários (o spike S-09 usa `--external:sharp`); (c) tentar a carga real em Linux por caminho gratuito já disponível; se não houver, a carga fica registrada como `NÃO VERIFICADO` e é exercida na **primeira pré-visualização** (H-009).
3. **Desenho que protege contra o pior caso:** `sharp` é carregado de forma preguiçosa dentro de `ImageReducerPort`; falha de carga vira `transient/unavailable` ⇒ 503 `Retry-After: 5`, **sem alterar o registro e sem consumir tentativa**. Assim, mesmo sem a verificação, nenhuma foto boa é rejeitada por culpa do ambiente e a história pode ser desenvolvida e testada no Windows (a decisão 41 diz que, sem a carga, a história fica presa à primeira pré-visualização para liberação, não para desenvolvimento).
4. Contingência se o binário não carregar no Linux (ADR-018): a mesma porta aceita outra implementação (WASM, por exemplo o build `wasm32` oficial do `sharp` ou `jSquash`); custo de tempo e memória `NÃO MEDIDO`, exigiria nova medição contra R-07. Não é recomendada sem evidência de falha.

## 9. Documentos atualizados nesta entrega

- `88-DESENHO-H026.md` §8, condição 2 (decisão 82): reescrita; §1 (finalize) e §8 itens 1 e 4 com a referência cruzada para este desenho.
- Nada em `11-DECISOES.md` (decisões 79 a 85 já registradas). A linha do S-06 em 14-BACKLOG segue pendente de atualização pelo Orquestrador (92 §6).

## 10. Riscos e lacunas

| # | Risco / lacuna | Tratamento |
|---|---|---|
| R1 | `sharp` não carrega ou tem comportamento diferente no Linux da Vercel `[NÃO VERIFICADO]` | §8: 503 sem rejeitar, verificação na primeira pré-visualização, contingência WASM |
| R2 | Memória: 4 reduções simultâneas de PNG de 64 MP somam bem mais que 512 MB | Orçamento de 128 MP em voo (§4.3); medição R-07 e ajuste; 2 GB do plano Hobby deixa folga `[NÃO VERIFICADO]` |
| R3 | Tempo: 1 vCPU na Vercel pode ser mais lento que os 12 núcleos do S-06 (mediana 459 ms, máx. 1.121 ms) | Prazo de 10 s com 9× de folga sobre o pior medido; transitório (nunca rejeita); `maxDuration` verificado no preview |
| R4 | Foto com timeouts repetidos entra em loop de CPU | Teto de 3 tentativas contadas ⇒ `nao_processavel` (pergunta 1) e cota de 30 `finalize` por hora por rascunho (H-026) |
| R5 | Falha entre gravar o reduzido e registrar `ready`, ou entre `ready` e remover o original | Chave determinística (sobrescreve), `reduce_done` antes da remoção, lista de limpeza, expurgo do rascunho remove os dois objetos |
| R6 | Dois reencodes ao mesmo tempo da mesma foto (lease vencida) | Lease de 30 s + número de tentativa no `done`; saída determinística, então as duas gravações são iguais; só a tentativa dona registra |
| R7 | Abandono do envio (nunca chama `finalize`) mantém o original com EXIF até o expurgo | Persiste a condição 3 de 88 §8 (expurgo agendado), agora limitada ao envio não finalizado |
| R8 | Redução no navegador não testada em dispositivo real; Safari e orientação | Servidor reencoda sempre; cliente cai para o original quando algo não está disponível (§4.4); conferência manual registrada como `NÃO VERIFICADO` |
| R9 | HEIC continua 415; foto de iPhone em HEIC não funciona pelo servidor | Decisão 80; conversão é decisão e spike próprios (R-25); o navegador pode converter por canvas quando decodifica |
| R10 | Constantes (`MEDIA_REDUCE_*`: 1.280, 500.000, 750.000, 64 MP, 10 s, 4, 128 MP, 30 s) em código, não em `app_config` | Aceito, herdado de H-025 A2 e H-026 R6; revisitar com H-110 |
| R11 | Qualidade visual do JPEG q32 em foto com muito ruído; perfil Display P3 | Só no pior caso e dentro do teto; teste R-12 compara cores; sem medida de qualidade subjetiva |
| R12 | `ready` e `request-photos/p/<id>` ainda não vinculados a pedido; H-030 pode precisar mover o objeto | Vínculo é de H-030/H-031; a chave derivada do id facilita o vínculo sem coluna nova nesta história |
| R13 | A #41 (prova formal de metadado e checagem de tipo) depende desta; a recusa de formato por `metadata()` aqui antecipa parte da checagem de tipo | Fronteira de D-H027-1 mantida: #40 só garante que o decodificador só vê jpeg/png/webp; #41 prova e trata o tipo declarado diferente do real |

## 11. Plano para o DEV (ordem sugerida)

0. Gate do `sharp` (§8). 1. Domínio `packages/domain/src/media/`: constantes `MEDIA_REDUCE_*`, `reduce-plan.ts` (dimensões e escada de qualidade, puro), códigos de recusa, tipos das portas. 2. Migração + rollback + `media-reduce-h027.dbtest.mjs` (R-13, R-14). 3. `ImageReducerPort` real (`sharp`) e falso, e testes R-01, R-08, R-09 com o conjunto gerado. 4. `MediaReduceStoragePort` (falsa e real, Supabase REST) e adaptador `PgMediaStore` com as funções novas. 5. Serviço `reduceMedia` (semáforo, lease, ordem objeto → registro → remoção) e mudança em `finalizeMedia`; atualizar `sweepQuarantine`. 6. Módulo do navegador (R-12). 7. Testes R-02 a R-07, R-10, R-11, R-15. 8. Evidência na Issue #40 com comando, contagem e código de saída; sem declarar CI verde; Vercel e Linux como `NÃO VERIFICADO` até o preview.

## 12. Dúvidas ao líder (não bloqueiam o DEV)

1. **Teto de 3 tentativas contadas (R4, §2.4).** A decisão 84 diz que tempo e memória são transitórios. Sem um teto, uma imagem que estoura sempre o prazo é repetida sem fim. Proposta: após 3 tentativas contadas (só tempo, memória ou queda da instância; erros de Storage e de carga do `sharp` não contam), a 4ª chamada marca `rejected/nao_processavel`. **Recomendação:** aceitar (é o limite de 3 tentativas da fábrica aplicado ao produto). **Alternativa:** sem teto, deixando só a cota de 30 por hora.
2. **Gate do `sharp` (§8).** Sem WSL nem Docker, a carga em Linux só se prova na primeira pré-visualização. **Recomendação:** seguir o desenvolvimento no Windows com o desenho que nunca rejeita por falha de ambiente, e registrar a verificação como condição de liberação junto com 88 §8. **Alternativa:** instalar uma distribuição WSL (instala algo novo, vedado pela decisão 41 sem nova autorização).
3. **Bucket `request-photos` criado nesta migração** com 750.000 bytes e só `image/jpeg`. **Recomendação:** aceitar; ele nunca existiu em migração e só a API o usa.
