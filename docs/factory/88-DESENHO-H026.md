# H-026 — Desenho: upload de fotos em quarentena

- **Issue:** #39 · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-12 · **Papel:** Architect
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou pelo líder · `[VERIFICADO]` conferido no código ou documento · `[PROPOSTA]` sugestão do Architect · `[NÃO VERIFICADO]` sem fonte
- **Base:** 87-REFINO-H026 (CA-01 a CA-13), 74-DESENHO-H025 (rascunho, cookie-nonce), 08 §10.1 a §10.4, 09 (`media_asset`), 11-ARQ §2.2, I-29, F-09, P-01, P-02, T-02, T-10, T-11; 82-DESENHO-H109 (fila de objetos e expurgo); código de `apps/api/src/drafts` e `packages/domain/src/draft`.

## 0. Situação encontrada e decisões do líder
- `[VERIFICADO]` Não existe `app.media_asset` em nenhuma migração (só em scripts de demonstração). Última migração: `20261112110000`. **Migração nova:** `20261112120000_media_create_asset_quarantine.sql` (o DEV reconfere o próximo número livre na hora de criar) e `supabase/rollbacks/20261112120000_media_create_asset_quarantine.down.sql` (padrão `.down.sql`).
- `[VERIFICADO]` Reaproveita: cookie `__Host-fp_draft` e `draftSecretFromCookie`/`draft-hash` (H-025), `checkDraftOrigin`/`checkDraftJson`, `private.rl_check/rl_hit`, o padrão de rota com portas injetadas e o 404 uniforme de `draft-route.ts`, a fila de objetos de H-109 (`retention_object_queue`, `RetentionStoragePort`).
- `[VERIFICADO]` Não existe bucket `quarantine` no repositório nem adaptador de Storage com URL de envio. A lista fechada de buckets de `packages/domain/src/retention/types.ts` só tem `identity-docs` e `request-photos`.
- `[DECIDIDO pelo líder]` D-H026-1 dono antes da identificação = nonce do rascunho (cookie), como H-025. D-H026-2 desenvolve já, **não libera** antes de H-027 e H-028 (§8). D-H026-3 HEIC recusado com 415 até H-027 ligar a conversão. D-H026-5 sem exclusão de foto até H-029. D-H026-6 aviso de fachada/interior fica com H-029 e UX. D-H026-7 corrigida a referência errada em 08 §10.2 (ver §9).

## 1. Rotas (sob `/v1`, sem CORS, `Cache-Control: no-store`)
`[PROPOSTA]` Caminhos de 11-ARQ §2.2. O dono nunca vem no corpo nem na URL: é sempre o rascunho do cookie `__Host-fp_draft` (CA-06, CA-10). Não há rota de leitura do arquivo, de listagem, de exclusão nem de envio por outro dono (CA-08, CA-10).

| Rota | Efeito | Sucesso | Erros |
|---|---|---|---|
| `POST /v1/media/uploads` | Reserva uma vaga de foto no rascunho do cookie, cria `media_asset` `pending` e devolve a URL de envio de uso único | 201 (nova) ou 200 (repetição) | 403, 404, 413, 415, 422, 429, 503 |
| `PUT <upload_url>` | Direto navegador para a quarentena (Storage). **Não passa pela API** (limite de corpo de ~4,5 MB da função) | 200 do Storage | do Storage |
| `POST /v1/media/{id}/finalize` | Confirma que o arquivo chegou; idempotente | 200 | 403, 404, 409, 413, 429, 503 |
| `GET /v1/media/{id}` | Estado do registro (sem URL, sem arquivo): consulta de posse | 200 | 404, 429, 503 |

**Corpo de `POST /v1/media/uploads`** (JSON, limite 2 KB, só estas chaves; qualquer outra, inclusive `filename`, `name`, `exif`, `draft_id`, `owner`, `status`, `bucket`, `path` ⇒ 422 `campo_desconhecido`; corpo vazio ⇒ 422 `vazio`):
- `client_upload_id` uuid gerado pelo navegador por foto escolhida. É a chave de idempotência (unique por rascunho). O servidor não confia nele para posse.
- `content_type` exatamente `image/jpeg`, `image/png` ou `image/webp`. `image/heic`/`image/heif` e qualquer outro ⇒ **415** `tipo_nao_aceito` (D-H026-3). Só o tipo declarado; a detecção pelo conteúdo é de H-028 (CA-05).
- `size_bytes` inteiro de 1 a 10.485.760 (10 MB). Maior ⇒ **413** `arquivo_grande`.
- **Nome do arquivo não é aceito nem guardado** (CA-13, T-10).

**Resposta de `POST /v1/media/uploads`**: `{ id, status: "pending", upload_url, upload_expires_at }`. Na repetição de uma foto já confirmada: `{ id, status, confirmed: true }` sem `upload_url`. A `upload_url` carrega token na query: nunca é logada, vem só nesta resposta `no-store`. **Resposta de finalize e de GET**: `{ id, status, confirmed }`. Nunca devolvem caminho, bucket, tamanho exato, tipo, `draft_id`, nonce ou qualquer metadado do arquivo. Erros: `{ code }` fixo, sem eco da entrada.

**Ordem fixa** (como H-025): Origin/Sec-Fetch-Site → Content-Type JSON (só no POST de uploads) → formato do cookie (43 caracteres; malformado ou ausente ⇒ 404 sem ir ao banco) → corpo → limite de taxa por IP-HMAC (`rl_check`) → função do banco (posse + limite de fotos + cota do rascunho) → Storage → `rl_hit` só após aceite. Erro interno ou do Storage ⇒ 503 fixo. 404 é idêntico (corpo e cabeçalhos) para: sem cookie, cookie malformado, de outro navegador, rascunho vencido/descartado/publicado, `id` de foto inexistente ou de outro rascunho, `id` que não é uuid (CA-06).

**Semântica**
- **Emissão (`media_issue`)**: trava a linha do rascunho (`for update`), marca como expurgáveis os pendentes vencidos *deste* rascunho (libera vaga de forma preguiçosa), conta as vagas vivas e: se `client_upload_id` já existe ⇒ repetição (pendente vivo: assina de novo a URL do mesmo `id`; confirmado: 200 sem URL; expirado: libera e cria novo); senão, com 5 vagas vivas ⇒ **422 `photo_limit`** antes de assinar qualquer URL, sem gravar nada e sem tocar nas 5 anteriores (CA-02). Vaga viva = linha com `purge_requested_at is null` e `status <> 'rejected'`.
- **URL de uso único**: o caminho do objeto é derivado do id (`d/<media_id>`, uuid v4 gerado no banco; sem extensão, sem nome original, sem coluna de caminho). Assinada com `upsert:false`: o segundo `PUT` no mesmo caminho falha. O bucket impõe 10 MB e os 3 tipos (§3).
- **Confirmação (`media_finalize`)**: (1) `media_get` por posse ⇒ 404 uniforme se não for do cookie; (2) o adaptador faz `stat` do objeto (existe? tamanho?) **sem baixar bytes**; (3) `media_finalize(p_hash, p_id, p_stored_bytes, p_now)`: objeto ausente ⇒ 409 `upload_nao_encontrado` (nada muda); tamanho > 10 MB ⇒ 413 `arquivo_grande` e o registro vai para expurgo (CA-05); pendente vencido ⇒ 409 `upload_expirado` (vaga já liberada); primeira confirmação ⇒ grava `confirmed_at` e `confirmed_bytes`; repetição ⇒ 200 com o mesmo resultado, sem tocar contagem (CA-04). **Nunca grava `ready`** e nunca copia ou lê o objeto (CA-09).
- Rascunho que sai de `aberto|aguardando_email` (descartado, vencido, publicado) ⇒ todas as rotas respondem 404.

## 2. Dados (migração por expansão, reversível)
`[PROPOSTA]` Só **cria** objetos novos; não altera `request_draft` nem `draft_*` de H-025 (nenhuma função existente é redefinida, por isso o desfazer é limpo).

**Tabela `app.media_asset`**:
| Coluna | Tipo / regra |
|---|---|
| `id` | uuid pk, `gen_random_uuid()` (também deriva o caminho do objeto) |
| `draft_id` | uuid not null, FK `app.request_draft(id)` **`on delete restrict`** (a história do pedido H-031 relaxa para aceitar `request_id`); impede apagar rascunho com foto antes do expurgo do objeto |
| `client_upload_id` | uuid not null; **unique `(draft_id, client_upload_id)`** (idempotência, CA-04) |
| `declared_type` | text check in (`image/jpeg`,`image/png`,`image/webp`) |
| `declared_bytes` | integer check between 1 and 10485760 |
| `status` | text not null default `pending` check in (`pending`,`ready`,`rejected`) (08 §10.2; esta história só grava `pending`) |
| `confirmed_at`, `confirmed_bytes` | timestamptz / integer null; `check (confirmed_at is null or confirmed_bytes between 1 and 10485760)` |
| `pending_expires_at` | timestamptz not null (emissão + 30 min) |
| `purge_requested_at` | timestamptz null (marca para expurgo; vaga liberada) |
| `created_at` | timestamptz default `clock_timestamp()` |

Sem coluna de nome original, de caminho, de original, de EXIF, de IP, de tipo detectado, de `owner_type` (`[VERIFICADO]` refino §6; I-29). Índices: `(draft_id)` parcial onde `purge_requested_at is null`; `(pending_expires_at)` parcial onde `confirmed_at is null and purge_requested_at is null` (para o expurgo); `(purge_requested_at)` parcial onde não nulo.

**Limite como invariante de banco (I-29, CA-03)** `[PROPOSTA]`: trigger `BEFORE INSERT` que primeiro trava a linha do rascunho (`select 1 from app.request_draft where id = new.draft_id for update`), depois conta linhas com `purge_requested_at is null and status <> 'rejected'` e, se já houver 5, levanta `photo_limit` (errcode `23514`). A trava serializa inserções simultâneas; independe de a API checar antes. A API traduz para 422 `photo_limit`. O trigger não usa relógio (a liberação preguiçosa do pendente vencido é feita pela função com `p_now`, antes do insert).

**Bucket `quarantine`** `[PROPOSTA]`, na mesma migração, idempotente: `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('quarantine','quarantine', false, 10485760, array['image/jpeg','image/png','image/webp']) on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types`. **Nenhuma política** em `storage.objects` para o bucket (RLS do Storage nega `anon` e `authenticated` por padrão): ninguém lê, nem o visitante (CA-08, 08 §10.1). Quem escreve e remove é só a API, com a credencial de serviço do Storage no ambiente do servidor (`.env.local`, nunca em tabela, log ou resposta; `[VERIFICADO]` 82 §59). `[NÃO VERIFICADO]` se o ambiente Supabase remoto já tem o bucket; o DEV cria pela migração (`npx supabase`, não pelo MCP).

**Postura** igual às migrações anteriores `[VERIFICADO]`: RLS habilitada e forçada, sem políticas; `revoke all` de `public, anon, authenticated, service_role, app_api, app_system, app_backup_reader`; acesso só por funções `security definer` em `private`, `set search_path = ''`, `p_now` informado pelo chamador; `grant execute` só a `app_api`:
- `private.media_issue(p_hash text, p_client_upload_id uuid, p_type text, p_bytes integer, p_now timestamptz, p_global_cap integer)` ⇒ `(out_code, out_id, out_status, out_confirmed)`; `out_code` ∈ `new|replay|not_found|photo_limit|cap`.
- `private.media_get(p_hash text, p_id uuid, p_now timestamptz)` ⇒ `(out_id, out_status, out_confirmed)` (zero linhas = 404).
- `private.media_finalize(p_hash text, p_id uuid, p_stored_bytes integer, p_now timestamptz)` ⇒ `out_code` ∈ `confirmed|replay|not_found|expired|missing|too_large`.
- `private.media_sweep(p_now timestamptz, p_limit integer)` ⇒ marca `purge_requested_at` em (a) pendentes vencidos e (b) fotos de rascunho `descartado` ou com `expires_at <= p_now` (não `publicado`); devolve os `id` marcados (limite do lote).
- `private.media_purge_done(p_ids uuid[])` ⇒ apaga as linhas marcadas depois de o Storage confirmar a remoção.

Estados nesta história: `(criação) → pending`; confirmação **não** muda `status` (fica `pending` com `confirmed_at`); `ready`/`rejected` são de H-027/H-028. `[PROPOSTA]` O limite global de vagas vivas na quarentena (`p_global_cap`) é 150 ⇒ 429 neutro (1 GB de Storage grátis ÷ 10 MB piores casos ≈ 100; fotos reais de celular ficam em 3 a 5 MB). Sem trava global, como em H-025 (lacuna aceita no ensaio).

## 3. Valores decididos (D-H026-4) — `[PROPOSTA]` do Architect, constantes `MEDIA_*` no domínio
| Parâmetro | Valor | Justificativa |
|---|---|---|
| TTL do pendente sem confirmação | **30 min** (PO sugeriu 1 h) | 10 MB a 1 Mbit/s levam ≈ 80 s; 30 min cobre rede ruim e retentativa e libera a vaga (que conta no limite de 5) o dobro de rápido |
| Validade da URL de envio | **15 min** como alvo | Cobre o envio mais lento aceitável; menor que o pendente, então a URL morre antes do registro. `[NÃO VERIFICADO]` O Storage pode fixar o token em ~2 h; se não for configurável, vale o controle compensatório: caminho de uso único (`upsert:false`), limite de 10 MB/3 tipos no bucket, `finalize` recusa após o TTL do pendente e objeto sem registro é varrido (abaixo). O DEV confirma o comportamento real e registra |
| Varredura de órfãos | objeto do bucket sem linha com mais de **3 h** | Maior que o token mais longo (2 h) + folga |
| Cota de emissões por rascunho | **12 por hora, 25 por dia** | 5 vagas + retentativas de falha de rede; não deixa um navegador enfileirar lixo |
| Cota por IP-HMAC | **40 por hora, 150 por dia** | Folga para NAT/CGNAT e vários rascunhos legítimos; barra automação |
| Confirmações por rascunho | **30 por hora** | `finalize` toca o Storage; 5 fotos × retentativas |
| Vagas vivas globais | **150** | Proteção do Storage gratuito até H-027 reduzir os originais |

Respostas 429: só `Retry-After`, sem campo que revele limite (CA-12, RF-021). Chave do balde: SHA-256 de `media:<política>:<valor>` (64 hex, como na correção de D-08 de H-025). `rl_hit` só após aceite. Valores em constantes de domínio, como H-025 (lacuna A2 de leitura de `ops.app_config` herdada, revisitar com H-110).

## 4. Armazenamento em quarentena e expurgo (CA-07, CA-08, CA-11)
- **Sem leitura:** nenhuma rota de leitura, nenhuma política em `storage.objects`, nenhuma assinatura de `download`/`createSignedUrl` no adaptador (a porta nem expõe o método). O arquivo só sai da quarentena por H-027.
- **Porta `QuarantineStoragePort`** `[PROPOSTA]` (injetada, com versão falsa para teste): `createUploadUrl(key, ttlSeconds)`, `stat(key) ⇒ {bytes}|null`, `remove(key)` (ausente conta como sucesso), `listOlderThan(date)`. Somente o bucket fixo `quarantine`; chave só no formato `d/<uuid>`; nenhum erro devolve URL, token ou caminho.
- **Expurgo junto com o rascunho:** não precisa de alteração em `draft_discard`. O job de expurgo chama `media_sweep(now, lote)`, remove cada objeto no Storage e então chama `media_purge_done`. Falha de Storage deixa a linha marcada (nova tentativa), sem órfão silencioso. A varredura de órfãos cobre objeto sem linha (URL usada depois do TTL). Reaproveita o modelo de duas fases de 82 §2; `quarantine` entra como bucket conhecido do adaptador de retenção (ajuste em `RETENTION_BUCKETS`, `[PROPOSTA]`).
- **Entrega desta história:** as funções SQL, a porta, o serviço `sweepQuarantine(deps)` testado com Storage falso e a prova com Storage local. O **agendamento** (job com tick do H-005) é de H-110; até lá, o expurgo pode ser disparado manualmente. Isso vira condição de liberação (§8).
- Expiração preguiçosa: a emissão libera os pendentes vencidos do próprio rascunho, então o limite de 5 nunca fica preso por envio interrompido, mesmo sem job (F-09).

## 5. Segurança
| Risco | Mitigação |
|---|---|
| IDOR/enumeração (T-02) | Sem id de rascunho; foto só pelo cookie; busca por hash; 404 byte a byte igual; `id` não uuid nem toca o banco |
| EXIF, nome e IP vazando (CA-13, T-10, T-11) | A API **nunca lê os bytes** (envio direto ao Storage), então não há como o EXIF chegar a resposta ou log. Nome do arquivo não é aceito (422) nem gravado; objeto com nome aleatório; IP só como HMAC e só no balde de taxa, sem coluna em `media_asset`. Log com lista permitida: rota, status, `code`, duração, id da requisição; **nunca** corpo, query, `upload_url`, cabeçalhos, IP, `Content-Type` do arquivo |
| URL de envio vazada | Uso único por caminho, curta, `no-store`, só na resposta de emissão; não aparece em log, erro, rastro nem `Referer` (API sem redirecionamento) |
| CSRF / fixação | `SameSite=Strict` + Origin + JSON; o servidor gera os ids |
| Tipo falso (arquivo `.exe` rotulado JPEG) | Só declarado nesta história; fica em quarentena sem leitura nem renderização, então não executa nada; detecção por conteúdo em H-028 antes de qualquer uso |
| Enchimento do Storage | Cotas por rascunho/IP, teto de 5 por rascunho, global de 150, TTL de 30 min, varredura de órfãos |
| Original com EXIF guardado | Risco real e por isso **não liberar** antes de H-027/H-028 (§8) |
| Segredo | Credencial de serviço do Storage só no servidor, `.env.local`; nunca no cliente, no log, em teste impresso |

## 6. Observabilidade
Contadores por `code` (emitido, repetição, `photo_limit`, 415, 413, 429, expirado, expurgado, órfão removido) sem identificador. Sinal operacional: quantidade de vagas vivas globais e idade do pendente mais antigo, para ver se o expurgo parou.

## 7. Testes e critérios verificáveis
Padrão `[VERIFICADO]`: unidade/rota `*.test.ts` em `apps/api/tests` e `packages/domain/tests`; banco `*.dbtest.mjs` em `packages/db/tests` (`media-quarantine-h026.dbtest.mjs`); execução local `corepack pnpm check:all` e `db:test`; Storage falso nas unidades e Storage local (`npx supabase`) na prova de CA-08/CA-09.

| ID | Prova | Critérios |
|---|---|---|
| M-01 | POST com cookie válido, JPG/PNG/WebP de 1 byte a 10 MB ⇒ 201, `upload_url`, linha `pending` ligada ao rascunho; nenhuma exigência de senha, e-mail ou nome | CA-01 |
| M-02 | Com 5 vagas vivas, a 6ª ⇒ 422 `photo_limit`; linhas, objetos e URLs inalterados (nenhuma assinatura chamada); as 5 anteriores intactas (API e SQL, P-01) | CA-02 |
| M-03 | Concorrência no banco: duas conexões inserindo com 4 vagas ⇒ exatamente 5 linhas, a outra recebe `photo_limit`; também por duas emissões HTTP simultâneas ⇒ 201 e 422; insert direto sem a função é barrado pelo trigger | CA-03 |
| M-04 | Mesmo `client_upload_id` duas vezes ⇒ mesmo `id`, uma linha; `finalize` duas vezes ⇒ 200 com mesmo resultado, `confirmed_at` do primeiro mantido, contagem inalterada; reenvio após confirmar ⇒ 200 sem `upload_url` | CA-04 |
| M-05 | `size_bytes` 10 MB + 1 ⇒ 413 e nada gravado; `finalize` com objeto de tamanho maior que 10 MB ⇒ 413 e linha marcada para expurgo; `image/gif`, `application/pdf`, `image/heic`, `image/heif`, ausente ⇒ 415 (HEIC explicitamente, D-H026-3); bucket recusa o PUT de tipo/tamanho indevidos (Storage local) | CA-05 |
| M-06 | Nonce A aceito; sem cookie, malformado, nonce B, rascunho vencido, descartado, `id` de foto de outro rascunho e `id` não uuid ⇒ 404 com corpo e cabeçalhos byte a byte iguais nas 3 rotas; malformado/sem cookie ⇒ zero chamadas ao banco (T-02) | CA-06 |
| M-07 | Relógio injetado: pendente vivo em 30 min − 1 s, expirado em 30 min; `finalize` após o TTL ⇒ 409 `upload_expirado`; `media_sweep` marca e devolve; remoção no Storage falso + `media_purge_done` apaga a linha; falha de Storage deixa a linha marcada; reenvio não duplica; vaga volta a ficar livre sem job (F-09) | CA-07 |
| M-08 | Storage local: com os papéis `anon` e `authenticated` (e com cookie de dono) listar, baixar, assinar leitura e ler o objeto ⇒ negado; `storage.objects` sem política para o bucket; o adaptador não tem método de leitura; nenhuma rota `GET` de arquivo (varredura de rotas); bucket `public=false` | CA-08 |
| M-09 | Após `finalize`, inspeção do Storage local: objeto só em `quarantine`; `request-photos` vazio; nenhuma linha `ready`; teste estático: nenhuma função da migração atribui `'ready'` nem chama cópia/leitura | CA-09 |
| M-10 | Varredura de rotas (P-02): só `/v1/media/uploads`, `/v1/media/{id}/finalize`, `/v1/media/{id}`, dono sempre do cookie; corpo com `draft_id`/`owner`/`request_id` ⇒ 422; esquema: `media_asset` só tem FK para `request_draft`; nenhum caminho de foto no chat (decisão 33) | CA-10 |
| M-11 | Rascunho `descartado` ou com `expires_at` vencido: `media_sweep` devolve as fotos pendentes e confirmadas; após remoção, zero linhas e zero objetos; `publicado` não é varrido; `on delete restrict` barra apagar rascunho com foto | CA-11 |
| M-12 | Emissão nº 13 na hora no mesmo rascunho e nº 41 por IP-HMAC ⇒ 429 com `Retry-After` e sem campo de limite; `rl_hit` só após aceite; consulta não conta; teto global de 150 ⇒ 429 | CA-12 |
| M-13 | Sentinelas (T-11): arquivo de teste com EXIF falso (coordenada fictícia), nome `rua-das-flores-12.jpg`, IP e cabeçalho sentinela; capturar todas as linhas de log e todas as respostas (corpo e cabeçalhos): nenhuma contém sentinela, `upload_url`, caminho, nome ou IP; corpo com `filename` ⇒ 422; objeto no Storage com nome uuid sem extensão | CA-13 |
| M-14 | Segurança de banco: RLS forçada; `anon/authenticated/service_role/PUBLIC/app_api` sem DML em `media_asset`; execute só `app_api`; `search_path` vazio; migração aplicada duas vezes sem erro; desfazer remove tudo e recusa se houver linhas | geral |
| M-15 | Fluxo ponta a ponta com Storage local: emitir, `PUT` pela URL, segundo `PUT` na mesma URL falha (uso único), `finalize`, estado final consistente | CA-01, CA-04 |

Cobertura de critérios: CA-01 M-01/M-15; CA-02 M-02; CA-03 M-03; CA-04 M-04; CA-05 M-05; CA-06 M-06; CA-07 M-07; CA-08 M-08; CA-09 M-09; CA-10 M-10; CA-11 M-11; CA-12 M-12; CA-13 M-13. Os 13 critérios têm prova.

## 8. Condição de liberação (D-H026-2) — não vai para produção sozinha
H-026 pode ser desenvolvida, revisada, testada e movida normalmente, mas **o fluxo de envio não é aberto a visitantes reais** (rota desligada na composição de produção ou bucket sem uso) até:
1. **H-027 pronta** (desenho em `93-DESENHO-H027.md`): redução para ≈ 0,5 MB / ≤ 1.280 px e só a versão reduzida persistida (I-29, "sem original no Storage"; hoje a quarentena guarda o original de até 10 MB).
2. **H-028 pronta**: prova formal de remoção de EXIF/metadados e detecção do tipo pelo conteúdo (RF-027). **Revisada pela decisão 82 (2026-11-12):** com a H-027, o original é apagado da quarentena logo depois de gravar a versão reduzida (e em toda recusa definitiva), então o original com GPS deixa de ficar retido depois do `finalize`; a quarentena só guarda o original entre o envio e o `finalize` (até 30 min) e o envio nunca finalizado até o expurgo (condição 3). A saída reduzida sai sem metadado de entrada por construção na #40 (93 §5.1); a condição 2 continua exigindo a **prova formal** e a checagem de tipo da H-028, que ainda não existem. Texto anterior: "Enquanto não, o original com GPS fica retido na quarentena."
3. **Expurgo agendado** `[PROPOSTA ao líder, adicional]`: a varredura de §4 rodando por tick (H-005/H-110) ou manualmente documentada, para que o original com EXIF não passe de ~1 dia na quarentena. Sem isso, o pendente confirmado de um rascunho vivo ficaria até 7 dias (até 30 pelo teto). O líder confirma ou dispensa na fase de ensaio sem usuário real (mesma lacuna aceita em H-025 §6).
4. HEIC só passa de 415 para aceito quando houver conversão comprovada, em mudança própria. **Revisada pela decisão 80:** a H-027 não liga a conversão; HEIC continua recusado com 415 depois dela.
5. **Nota sobre o `finalize`** (decisão 81): a H-027 faz o `finalize` reduzir de forma síncrona e é a única que grava `ready` (via `media_reduce_done`). O trecho "Nunca grava `ready`" de §1 vale para a H-026 isolada; o novo contrato está em `93-DESENHO-H027.md` §2.3.

## 9. Documentos atualizados nesta entrega
- `08-ARQUITETURA.md` §10.2 passo 2: referência trocada de "FA-028" (que trata do chat) para "FA-001; P-01, F-09" (D-H026-7).
- `11-DECISOES.md`: decisão 56, com D-H026-1 a D-H026-7 e os valores de D-H026-4.

## 10. Riscos e lacunas
| # | Risco / lacuna | Tratamento |
|---|---|---|
| R1 | Original com EXIF na quarentena até H-027/H-028 | Condição de liberação (§8); sem leitura por ninguém (CA-08) |
| R2 | Validade real do token de envio do Storage pode ser maior que 15 min `[NÃO VERIFICADO]` | Controles compensatórios (§3); DEV mede e registra; a regra de negócio (TTL do pendente) é do banco, não do Storage |
| R3 | Mesma foto reenviada com novo `client_upload_id` consome outra vaga (deduplicação por conteúdo exigiria ler o arquivo) | Aceito: "reenvio não duplica" vale para a mesma ação (mesmo `client_upload_id`) e para a confirmação. Dedupe por conteúdo fica com H-029/UX se o produto quiser |
| R4 | Sem exclusão até H-029: foto errada ocupa vaga | Aceito (D-H026-5); vaga volta com o expurgo do rascunho. Mitigação de UX em H-029 |
| R5 | Teto global (150) sem trava de concorrência | Aceito no ensaio, como em H-025 |
| R6 | Valores em constantes, não em `ops.app_config` | Aceito, herdado de H-025 A2; revisitar com H-110 |
| R7 | Storage não transacional com o banco: linha criada e URL não assinada, ou objeto subido sem `finalize` | Pendente repetível (mesmo `client_upload_id`), TTL de 30 min e varredura de órfãos de 3 h |
| R8 | `RETENTION_BUCKETS` fechado em dois valores | Ajuste pequeno e testado em H-026 ou H-110 (o DEV decide onde, sem relaxar a lista para qualquer nome) |
| R9 | `on delete restrict` pode barrar o expurgo físico de rascunho de H-110 | Proposital: H-110 deve chamar `media_sweep`/`purge_done` antes; registrado como dependência |

## 11. Plano para o DEV (ordem sugerida)
1. Domínio `packages/domain/src/media/`: constantes `MEDIA_*`, validação do corpo, tipos aceitos, caminho `d/<uuid>`, chave de balde. 2. Migração + rollback + `media-quarantine-h026.dbtest.mjs` (M-03, M-07, M-11, M-14). 3. Porta e adaptador de Storage (falso e real) e `sweepQuarantine`. 4. Serviço e rota `media-route.ts` no padrão de `draft-route.ts`, ligada em `app.ts`/`composicao.ts` por opção, **desligada por padrão em produção** (§8). 5. Testes de rota e de ponta a ponta (M-01 a M-15). 6. Evidência na Issue #39 com comando, contagem e código de saída; sem declarar CI verde.

## 12. Dúvidas ao líder (não bloqueiam o DEV)
1. **Condição 3 da §8** (expurgo agendado antes de qualquer visitante real). Recomendação: aceitar como condição de liberação, já que o original com EXIF mora na quarentena.
2. **TTL do pendente 30 min em vez de 1 h** (sugestão do PO). Recomendação: aceitar 30 min.
3. **R3** (sem deduplicação por conteúdo). Recomendação: aceitar.
