# Desenho H-031 — Publicação idempotente com 7 dias (Issue #44, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante para o desenvolvimento. Dúvidas não bloqueantes em §15 (numeração local A1 a A14; o líder renumera).
- **Rastro:** 109-REFINO-H031 (RN-01..RN-15, CA-01..CA-19, Q1..Q17); decisões 229 a 245 (`11-DECISOES.md`, rodada 51, adotadas como recomendadas; a 239 é pergunta ao usuário e **segue a recomendação**: tudo com porta simulada, nenhuma chamada real ao Mapbox); 89-REFINO-H030 e 90-DESENHO-H030 (revisão e confirmação que **não** publicam; §3.3 é o contrato desta Issue); 68-DESENHO-H021 (§3.1 passos 0 a 4, §3.2, §3.3, §3.4, §5); 74-DESENHO-H025; 96-REFINO-H023 e 97-DESENHO-H023 (§0.2, §3.2, §11: o que a #36 lê de `app.service_request`); 101-DESENHO-H017 (gatilho I-19); 08-ARQUITETURA §5.1, §5.4, §10.2; 09-MODELO-DADOS §3.4; 10-ADRS ADR-015; spike S-02 (`spikes/S-02-RESULTADO.md`); código lido em §0.
- **Natureza:** somente documento (mais a nota de `exact_point` em 09 §3.4, ver §13). Nenhum código de produção, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` dono ou líder, com número · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento ou de leitura que não ocorreu.

## 0. Situação encontrada
1. `[VERIFICADO]` **Não existe** `app.service_request` (nenhuma migração). Última migração: `20261112235000_identity_fix_documents_audit_object.sql`. Existe `supabase/rollbacks/*.down.sql` por migração.
2. `[VERIFICADO]` `app.request_draft` tem `service_id, address_text, urgency, description, status ('aberto'|'aguardando_email'|'descartado'|'publicado'), expires_at, first_name, email, email_hmac, email_verified_at` (migrações `20261111440000` e `20261112130000`); a #43 (`20261112150000`) acrescentou `confirmed_at` e `content_rev` e o gatilho `draft_confirmation_guard`. O índice único de `browser_nonce_hash` é **parcial** (só `aberto` e `aguardando_email`): depois de publicar, o mesmo cookie pode abrir um rascunho novo, e o hash **deixa de identificar sozinho** o rascunho publicado (ver D-02).
3. `[VERIFICADO]` `app.geocode_point` tem `unique (subject_kind, subject_id, address_hash)`, `exact_point geography(Point,4326)`, `state`, `geocode_mode`, `match_cell/match_lon/match_lat/match_grid_version` (gatilho da #35). `geocode_budget` tem CHECK `subject_kind <> 'request' or calls <= 3`. `ensurePermanentPoint` (`apps/api/src/geo/permanent-geocode-service.ts`) devolve só `{status, pointId}` e já libera a reserva nas falhas; `PgGeoPointStore` (`packages/db/src/geo-point-store.ts`) recebe `subjectKind` (a H-036 usa `professional_base`; a #44 usa `request`, `[NÃO VERIFICADO]` em execução real, mas as funções SQL e o CHECK já preveem `request`).
4. `[VERIFICADO]` Idempotência da plataforma (H-005): `ops.idempotency_key (principal_id, operation, key)` e as funções `private.idempotency_begin(p_principal_id, p_operation, p_key, p_request_hash, p_ttl_seconds)` → `nova|repetida|em_andamento|conflito` e `private.idempotency_complete(...)`. Chave expirada é reinicializada como `nova`; **não há lease separado** do prazo (o TTL é um só). Isso dirige D-06.
5. `[VERIFICADO]` `app.app_user (id, email, status, email_verified_at)`; sessão de cliente por cookie `__Host-fp_sess` (`SESSION_COOKIE_NAME`), `PgSessionRepository.authenticate(hash, nowMs)` devolve `{sessionId, userId, ...}`. `private.acceptance_not_own_request()` (migração `20261112200000`) lê `customer_user_id` da tabela passada em `TG_ARGV[0]` pelo `id` do pedido e compara com `new.professional_id`.
6. `[VERIFICADO]` `app.media_asset (id, draft_id, status ('pending'|'ready'|'rejected'), confirmed_at, pending_expires_at, purge_requested_at, ...)`; não tem coluna de pedido.
7. `[VERIFICADO]` Padrão de composição por ambiente: `professional-offering-composicao.ts` (variáveis obrigatórias por nome, `provedor` opcional injetado, `pendencias` sem valores). Rotas do rascunho: `apps/api/src/drafts/draft-route.ts` (ordem fixa Origin → Content-Type → cookie → corpo → limite → banco), registradas em `app.ts` (`opts.drafts`) e montadas em `composicao.ts`/`vercel.ts`.
8. `[VERIFICADO]` PostGIS foi criado na linha de base (`20261110120000_platform_create_baseline.sql`, `create extension if not exists postgis with schema extensions`) e `exact_point` já é `geography`. O S-02 (`§ decisão`) manteve PostGIS como caminho principal e a fórmula/`earthdistance` como contingência; a decisão 57 só dispensa PostGIS **na consulta da #36** (índice por célula).
9. `[VERIFICADO]` 08 §10.2 trata do **pipeline de upload de fotos**, não de limites de publicação. O refino (Q12) mandava validar os limites ali: **não há valor de publicação em 08 §10.2**; os valores continuam `[PROPOSTA]` em `app_config` (D-09).
10. `[VERIFICADO]` 08 §5.4 lista as ações com step-up (cancelar, concluir, corrigir conclusão, compartilhar/revogar telefone ou endereço, selecionar/trocar). **Publicar não está na lista**: confirma a decisão 230 (sessão comum de 7 dias, sem step-up).

## 1. Decisões de arquitetura
| # | Decisão | Alternativa recusada | Motivo |
|---|---|---|---|
| D-01 | **Quem manda é o banco; a API orquestra em 3 chamadas**: `request_publish_begin` (verifica sem custo e reserva a chave), geocodificação fora de transação, `request_publish_commit` (tudo ou nada). `request_publish_abort` libera a chave em qualquer falha. | Uma única função/transação que chama o provedor | Chamada paga não pode ser desfeita por rollback e não pode segurar o lock do rascunho (68 §3.1, "transação separada, de propósito") |
| D-02 | **O corpo leva `draft_id`** (a revisão da #43 já devolve `id`) **e o cookie do rascunho prova a posse**: a função busca `id = p_draft_id and browser_nonce_hash = p_hash`. | Buscar só pelo hash | O hash de um rascunho `publicado` pode ser reaproveitado por um rascunho novo do mesmo navegador (§0.2); sem o `id`, uma aba velha poderia publicar o rascunho errado se o `content_rev` coincidisse |
| D-03 | **Rota `POST /v1/requests`**, arquivo novo `apps/api/src/requests/`. | `POST /v1/drafts/current/publish` | O recurso criado é o pedido; fora de `draft-route.ts` não reabre o que a #43 entregou; #47 e #92 usam a mesma família |
| D-04 | **Papel `app_system`** executa as funções novas (sessão, geocodificação e `app_user` já estão nele). Nenhum `grant` a `app_api`. | `app_api` | `app_api` não lê `app_user` nem as funções `geo_*` |
| D-05 | **Distância da duplicidade por PostGIS**: `extensions.st_dwithin(a.exact_point, b.exact_point, raio_m)` sobre `geography` (metros reais). Sem fórmula de esfera. | Fórmula no banco | PostGIS está instalado e `exact_point` já é `geography`; o S-02 o fixa como caminho principal; a fórmula só entraria se `create extension` falhasse, o que não ocorre (baseline aplicada) |
| D-06 | **Chave de idempotência em dois tempos**: `begin` grava `em_andamento` com TTL curto (lease de 120 s, `[PROPOSTA]`, `app_config`); `commit` conclui e **prorroga** `expires_at` para 24 h. Falha ou desistência apaga a linha (`abort`); processo morto deixa a linha expirar em 120 s e `idempotency_begin` já a reinicializa. | TTL único de 24 h na abertura | Com 24 h a chave ficaria presa depois de um 503; com a prorrogação o lease some sem job |
| D-07 | **Só a resposta de sucesso é guardada** (201). 409 de duplicidade, 422, 429, 503 e 202 **não** ficam na chave: a chave é liberada para a repetição legítima (corrigir endereço, reenviar com token de duplicidade). | Guardar todas as respostas | O token de duplicidade muda o corpo; sem liberar a chave a repetição cairia em 422 |
| D-08 | **Token de duplicidade sem tabela**: HMAC-SHA256 (chave `REQUEST_PUBLISH_HMAC_KEY`, ≥ 32 caracteres) sobre `{draft_id, content_rev, similar_request_id, user_id, exp}`, validade 300 s, devolvido no 409 e reenviado em `duplicate_ack`. Verificado **na API**; o banco só recebe o booleano `p_ack` e grava `app.duplicate_ack`. | Tabela de tokens; flag booleano no corpo | Decisão 229; sem estado novo e prova de que o aviso foi emitido para aquele usuário, rascunho e versão |
| D-09 | **Limites em `ops.app_config`** (`publish.limits`), cada campo revalidado a cada chamada: 5 publicações/h por cliente, 20/dia por IP-HMAC, duplicidade 100 m e 24 h, token 300 s, lease 120 s, TTL da chave 86 400 s. O prazo de aceites (168 h) **não é configurável** (RF-015, I-07). | Constantes no código | Decisão 240; ADR-015 manda `app_config` |
| D-10 | **Prazo = `published_at + interval '168 hours'`** (absoluto), com CHECK `acceptance_deadline_at = published_at + interval '168 hours'`. Nunca `interval '7 days'` em `timestamptz` (depende do fuso da sessão). | `7 days` | Decisão 243; independe de `TimeZone` |
| D-11 | **`published_at` vem de `p_now`** (relógio da API, como todas as funções do repositório), o que permite teste com relógio fixo (CA-04, CA-05). | `clock_timestamp()` no banco | Convenção do repositório; o teste de fronteira exige relógio controlado |
| D-12 | **Sem rota → 503, não 404, quando falta só o provedor de geocodificação.** A rota existe quando o ambiente está completo; sem `provedor` injetado, responde `503 publicacao_indisponivel` **antes** de tocar o banco. Variável de ambiente ausente (banco, chave, `SITE_URL`) mantém o padrão da casa: rota não montada (404). | 404 também sem provedor (padrão da H-036) | A tela de revisão precisa distinguir "indisponível" (texto de §8) de "pedido expirou" (404 uniforme); decisão 239 mantém o provedor real fechado |
| D-13 | **Fotos**: coluna nova `app.media_asset.request_id` (nulo, FK `on delete restrict`) preenchida na publicação para as fotos `ready` e confirmadas do rascunho; `pending` não vencida bloqueia (409 `fotos_em_processamento`). | Tabela pivô; copiar arquivos | Decisão 242; menor mudança; #69 lerá por `request_id` |

## 2. Fluxo ponta a ponta (cada passo diz onde roda)
Entrada: `POST /v1/requests`, cabeçalhos `Idempotency-Key`, `Content-Type: application/json`, `Origin`; cookies `__Host-fp_sess` (sessão) e `__Host-fp_draft` (posse do rascunho). Corpo: `{ "draft_id": uuid, "content_rev": inteiro >= 0, "duplicate_ack"?: texto }` (nenhuma outra chave).

1. **API, sem banco:** Origin + `Sec-Fetch-Site` → `Content-Type` → provedor presente (senão 503) → formato da chave (`Idempotency-Key` 16..64 caracteres `[A-Za-z0-9_-]`) → cookie de sessão (ausente ou malformado → 401) → cookie do rascunho (ausente ou malformado → 404 uniforme) → corpo (limite 1 KB, chaves exatas) → `PgSessionRepository.authenticate` (401 se nula).
2. **Banco, `request_publish_begin` (uma transação curta):** trava o rascunho (`for update`), registra a chave, confere tudo que não custa e consome a cota de taxa (§5). Devolve `ok`, ou um desfecho final (`repetida`, `ja_publicado`, recusas).
3. **API, fora de transação:** `ensurePermanentPoint({ subject: draft_id, addressText })` com a porta de geocodificação (simulada em teste). Desfechos mapeados em §3.3.
4. **Banco, `request_publish_commit` (uma transação):** trava o rascunho de novo, **reconfere tudo** (o estado pode ter mudado entre 2 e 4), valida o ponto, procura duplicidade, cria o pedido, vincula as fotos, marca o rascunho `publicado`, grava auditoria e conclui a chave. Tudo ou nada.
5. **API:** monta a resposta fechada (§3.2). Em qualquer desfecho que não seja criação ou repetição, chama `request_publish_abort` (idempotente) antes de responder.

A chamada paga do passo 3 só ocorre depois de todas as recusas baratas do passo 2 (68 §3.1 passo 1). Repetição por chave, por segundo clique ou por outra aba cai nos passos 2 ou 4 **sem nova chamada paga**: o ponto do texto já está `ok` em `geocode_point` (`geo_reserve` devolve `reutilizar`).

## 3. API

### 3.1 Contrato de entrada e ordem das recusas
| Situação (nesta ordem) | Status | Corpo |
|---|---|---|
| Origin inválido | 403 | `{ code:"origem_invalida" }` (padrão H-025) |
| Não é JSON | 415 | `{ code:"tipo_invalido" }` |
| Falta provedor de geocodificação (D-12) | 503 | `{ code:"publicacao_indisponivel" }` |
| `Idempotency-Key` ausente ou fora do formato | 422 | `{ code:"chave_invalida" }` |
| Sem sessão válida | 401 | `{ code:"sessao_necessaria" }` |
| Cookie do rascunho ausente/malformado; `draft_id` de outro navegador, vencido, descartado; rascunho `publicado` de **outro** cliente | 404 | **byte a byte** igual a `draftNotFound()` da #43 |
| Corpo com chave extra, tipo errado ou > 1 KB | 422 / 413 | `{ code:"corpo_invalido" }` / `{ code:"corpo_grande" }` |
| Mesma chave, corpo diferente (`idempotency_begin`=`conflito`) | 422 | `{ code:"chave_reutilizada" }` |
| Mesma chave, primeira ainda em andamento | 409 | `{ code:"em_andamento" }` + `Retry-After: 2` |
| Falta campo ou serviço inativo | 422 | `{ code:"campos_faltando", missing:[...] }` (ordem de `DRAFT_REVIEW_FIELDS`) |
| Rascunho `aguardando_email` ou `email_verified_at` nulo, ou e-mail da conta não verificado | 409 | `{ code:"email_nao_confirmado" }` |
| E-mail do rascunho diferente do e-mail da conta da sessão (decisão 231) | 409 | `{ code:"email_divergente" }` |
| `content_rev` diferente do atual | 409 | `{ code:"conteudo_alterado" }` |
| `confirmed_at` nulo | 409 | `{ code:"nao_confirmado" }` |
| Foto em processamento (D-13) | 409 | `{ code:"fotos_em_processamento" }` + `Retry-After: 5` |
| Excesso de publicações (por cliente ou IP) | 429 | `{ code:"limite" }` + `Retry-After`; **sem** número do limite |
| Geocodificação (§3.3) | 409/422/202/503 | códigos fixos |
| Duplicidade sem token válido | 409 | `{ code:"duplicidade", similar:{ id, publishedAt, serviceName }, ackToken, ackExpiresAt }` (só o próprio cliente; nunca pedido de outro) |
| Criado agora | **201** | corpo de §3.2 |
| Mesma chave e mesmo corpo, já concluída | **201** | **mesmo corpo** da primeira (status guardado na chave) |
| Rascunho já publicado por **outra** chave (segunda aba, decisão 237) | **200** | mesmo corpo de §3.2 do pedido já criado |

Cabeçalhos de toda resposta: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json`. Sem CORS. Nenhum log leva corpo, cookie, e-mail, nome, descrição, endereço ou token.

### 3.2 Corpo de sucesso (lista fechada, RN-10)
`{ "id": uuid, "status": "publicado", "publishedAt": ISO, "acceptanceDeadlineAt": ISO }`. Nada de coordenada, ponto, célula, `geocode_point_id`, endereço, e-mail, nome ou contagem de vagas. Teste de contrato com lista fechada de chaves e varredura de padrão de coordenada.

### 3.3 Mapa dos desfechos da geocodificação (68 §3.1 passo 3)
| `ensurePermanentPoint` | Resposta | Chave |
|---|---|---|
| `ok` | segue para `commit` | mantida |
| `em_andamento` | 409 `{ code:"geocodificacao_em_andamento" }` + `Retry-After: 2` | liberada |
| `teto` (3 endereços diferentes já usados neste assunto) | 422 `{ code:"geocode_limit" }`, sem custo | liberada |
| `endereco_nao_encontrado` | 422 `{ code:"endereco_nao_encontrado" }`; texto preservado; o mesmo texto nunca é cobrado de novo | liberada |
| `entrada_invalida` | 422 `{ code:"endereco_invalido" }` | liberada |
| `aguardando_geocodificacao` (breaker) | **202** `{ code:"aguardando_geocodificacao" }` + `Retry-After: 30`; **sem estado novo no rascunho** (decisão 234); a tela reenvia | liberada |
| `indisponivel`, exceção do adaptador | 503 `{ code:"indisponivel" }` + `Retry-After: 10`; rascunho intacto | liberada |

O **assunto** (`subject`) da geocodificação é o **id do rascunho** (teto de 3 por rascunho, decisão 29 e refino §12.8). O ponto fica ligado ao rascunho, não ao pedido: a #36 junta por `geocode_point.id`, nunca por `subject_id` (97 §0 item 3). A republicação (H-082) define o assunto da cadeia (pergunta A6).

## 4. Dados: migração por expansão, reversível `[PROPOSTA]`
- **Arquivo:** `supabase/migrations/20261113010000_requests_create_service_request.sql`; **rollback:** `supabase/rollbacks/20261113010000_requests_create_service_request.down.sql`. `ls supabase/migrations` hoje termina em `20261112235000`; o DEV reconfere ao começar e renomeia os dois arquivos juntos para um prefixo maior que a última migração existente (R12 da #43). Aplicar com `npx supabase`, nunca pelo MCP.
- **Natureza:** cria tabelas e funções novas e **uma** coluna nula em `app.media_asset`. Nenhuma coluna existente muda de tipo; nenhum dado é preenchido; código atual não quebra. Idempotente (`if not exists`, `create or replace`, `drop ... if exists`).
- **Postura de segurança:** RLS habilitada **e forçada**, sem políticas; `revoke all` de `public, anon, authenticated, service_role, app_api, app_system, app_backup_reader` nas tabelas (nenhum DML e nenhum SELECT direto); funções `security definer`, `set search_path = ''`, `set lock_timeout = '5s'`, mensagens de erro fixas, sem valor interpolado; `revoke ... from public, anon, authenticated, service_role, app_api` e `grant execute` **só a `app_system`**.

### 4.1 `app.service_request` (contrato exato que a #36 lê)
| Coluna | Tipo e restrições |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` (**novo**, nunca o id do rascunho, RN-03) |
| `customer_user_id` | `uuid not null references app.app_user(id) on delete restrict` (nome exigido por `acceptance_not_own_request`) |
| `origin_draft_id` | `uuid unique references app.request_draft(id) on delete set null` (um pedido por rascunho; `set null` para que o expurgo de rascunhos não seja travado pelo pedido, A5) |
| `service_id` | `uuid not null references app.service(id) on delete restrict` |
| `status` | `text not null default 'publicado'` com CHECK em `('publicado','selecionado','concluido','cancelado')`; o gatilho de INSERT só aceita `publicado` |
| `urgency` | `text not null` CHECK nas 4 chaves de `request_draft` |
| `description` | `text not null` CHECK `char_length between 1 and 2000` |
| `address_text` | `text not null` CHECK `char_length between 3 and 200` (texto, sem coordenada; ver A4 sobre cifrar) |
| `first_name` | `text not null` CHECK `char_length between 2 and 60` |
| `geocode_point_id` | `uuid not null unique references app.geocode_point(id) on delete restrict` |
| `published_at` | `timestamptz not null` |
| `acceptance_deadline_at` | `timestamptz not null`, CHECK `= published_at + interval '168 hours'` |
| `acceptances_count` | `integer not null default 0 check (>= 0)` (só E6 altera) |
| `wave2_opened_at` | `timestamptz` nulo, CHECK `is null or >= published_at` |
| `version` | `integer not null default 1` (concorrência otimista, 09 §3.4) |
| `is_republication` | `boolean not null default false`; `chain_id uuid`; `republished_from_id uuid references app.service_request(id)`; **nulos, sem índice** (decisão 238) |
| `created_at` | `timestamptz not null default clock_timestamp()` |

Fora desta migração (entram por expansão nas histórias donas): `phone_*` (#46), `public_label`/rótulo generalizado (#45), `completed_at/cancelled_at/cancelled_by` (E7/E8), índice único parcial de cadeia (H-083). `exact_point`, `match_point`, `geocode_mode` e `address_text_enc` de 09 §3.4 **não existem** na tabela (decisão 233; I-28): a coordenada vive só em `geocode_point`.

**Índices (CA-18):** `service_request_pkey`; `(service_id, status, acceptance_deadline_at)` (**é o da #36**, 09 §6); `(customer_user_id, status)` (#47); `(customer_user_id, service_id, published_at desc)` (duplicidade, §6); únicos por restrição em `origin_draft_id` e `geocode_point_id`. Sem GiST de `match_point` (decisão 57: a consulta da #36 usa o índice por célula de `geocode_point`).

**Gatilhos:**
- `service_request_ponto_bi` (before insert, definer): o ponto referenciado tem `subject_kind='request'`, `state='ok'`, `geocode_mode='permanent'`, `match_cell is not null` **e** `subject_id = origin_draft_id`; senão `23514 pedido_ponto_invalido`. `status` só `publicado`. Isso vale também para SQL direto do dono do banco e é o que a #36 pressupõe (97 §3.2).
- `service_request_imutaveis_bu` (before update): `id, customer_user_id, origin_draft_id, service_id, geocode_point_id, published_at, acceptance_deadline_at` imutáveis (`23514 pedido_campo_imutavel`, texto fixo). Inclui `published_at` (decisão 244). `status`, `version`, `acceptances_count`, `wave2_opened_at` ficam livres para E6 a E10.
- `service_request_sem_delete_bd` (before delete): recusa (`23514 pedido_nao_apagavel`); retenção e DSR definem o caminho seguro (L1/L2, ADR-016).

### 4.2 `app.duplicate_ack` (09 §3.4, AMB-01)
`id uuid pk`, `request_id uuid not null references service_request(id)`, `similar_request_id uuid not null references service_request(id)`, `confirmed_at timestamptz not null`. Medição de avisos e confirmações para recalibrar (ADR-015). Mesma postura de RLS.

### 4.3 `app.media_asset.request_id`
`alter table app.media_asset add column if not exists request_id uuid references app.service_request(id) on delete restrict;` e índice parcial `(request_id) where request_id is not null`. `[NÃO VERIFICADO]` se existe gatilho que proíbe `update` de colunas de `media_asset` ou job de expurgo que apaga mídia de rascunho `publicado`: o DEV lê `20261112120000`, `20261112140000`, `20261112190000` e `ops-purge-*`/`retention-*` antes de gravar o `update`; a regra é que **foto com `request_id` não pode ser expurgada como órfã** (R5).

### 4.4 Funções `private.*` (todas `app_system`)
1. `private.request_publish_limits() returns jsonb` (interna): lê `ops.app_config` chave `publish.limits`; cada campo revalidado (inteiro em faixa segura; ausente ou inválido → padrão), no molde de `professional_offering_limits`. A migração semeia a chave com `on conflict do nothing` (`version=1`).
2. `private.request_publish_missing(p_draft app.request_draft) returns text[]`: campos faltando na ordem de `DRAFT_REVIEW_FIELDS` (nulo ou só espaços; serviço inexistente ou `active=false` conta como `service_id`; urgência `nao_definido` conta como faltando, como na #43). **Cópia** da regra de `draft_confirm`; a #43 não é tocada; teste de paridade (T-DB09) trava a divergência.
3. `private.request_publish_begin(p_user uuid, p_draft_id uuid, p_secret_hash text, p_idem_key text, p_body_hash text, p_content_rev integer, p_user_rate_key text, p_ip_rate_key text, p_now timestamptz)` → `(out_status text, out_request_id uuid, out_published_at timestamptz, out_deadline_at timestamptz, out_address_text text, out_missing text[], out_retry_after integer)`. Ordem (sempre na mesma, e a trava do rascunho **antes** da linha da chave, que é a ordem de trava global, §9):
   1. valida entradas (`22023`, texto fixo);
   2. `select ... from app.request_draft where id = p_draft_id and browser_nonce_hash = p_secret_hash for update`; sem linha, `descartado`, ou vencido (`expires_at <= p_now`, exceto `publicado`) → `nao_encontrado`;
   3. `idempotency_begin(principal = p_user::text, operation = 'request.publish', key, hash, lease)`: `conflito` → `conflito`; `em_andamento` → `em_andamento`; `repetida` → `repetida` com o pedido de `response_body_ref`;
   4. rascunho `publicado`: se `service_request.origin_draft_id = id` e `customer_user_id = p_user` → conclui a chave (prorroga 24 h) e devolve `ja_publicado` com o pedido; se for de outro cliente → apaga a chave e `nao_encontrado` (404 uniforme);
   5. validações baratas, **na ordem da tabela de §3.1**: usuário `ativo` e `email_verified_at` (`email_nao_confirmado`); rascunho `aberto` e `email_verified_at` (`email_nao_confirmado`); `lower(draft.email) = app_user.email` (`email_divergente`); `request_publish_missing` (`campos_faltando`); `content_rev` (`conteudo_alterado`); `confirmed_at` (`nao_confirmado`); fotos `pending` não vencidas (`fotos_em_processamento`);
   6. taxa: `rl_check` das duas chaves; recusa → `limite` com `retry_after`; **só depois** `rl_hit` das duas (padrão da H-025; replays e recusas anteriores não contam, borda 11 do refino);
   7. `ok` com o texto do endereço.
   Em **toda** saída que não seja `ok`/`repetida`/`ja_publicado`, a função apaga a linha da chave que ela mesma abriu (`state='em_andamento'`, mesmo `request_hash`) antes de retornar: recusa não deixa chave presa.
4. `private.request_publish_commit(p_user uuid, p_draft_id uuid, p_secret_hash text, p_idem_key text, p_body_hash text, p_content_rev integer, p_point_id uuid, p_ack boolean, p_now timestamptz)` → `(out_status text, out_request_id uuid, out_published_at timestamptz, out_deadline_at timestamptz, out_similar_id uuid, out_similar_published_at timestamptz, out_similar_service_name text, out_missing text[])`. Uma transação: trava o rascunho; `publicado` por este cliente → `ja_publicado`; **repete as validações 5 de `begin`** (rascunho pode ter mudado); confere que a chave ainda é nossa (`em_andamento` com o mesmo hash), senão `raise exception 'publicacao_chave_perdida'` (rollback; a API responde 503 e a repetição reinicia); ponto: `geocode_point.id = p_point_id`, `subject_kind='request'`, `subject_id = p_draft_id`, `state='ok'`, `match_cell` não nulo (`ponto_invalido`); **duplicidade** (§6) se `not p_ack` → `duplicidade` com os dados mínimos do pedido semelhante (a chave **não** é concluída; a API a apaga por `abort`); insere o pedido (`published_at = p_now`, `acceptance_deadline_at = p_now + interval '168 hours'`, `acceptances_count = 0`); vincula fotos (`update media_asset set request_id = ... where draft_id = ... and status='ready' and confirmed_at is not null and purge_requested_at is null`); `update app.request_draft set status='publicado', updated_at = p_now` (o gatilho da #43 preserva `confirmed_at`, ver §10); se `p_ack`, grava `duplicate_ack`; `private.audit_append` (§9.4); `idempotency_complete(..., 201, request_id::text)` e prorroga `expires_at` para `p_now + ttl` (UPDATE em `ops.idempotency_key` dentro da função; se `idempotency_complete` devolver falso, a mesma exceção de chave perdida).
5. `private.request_publish_abort(p_user uuid, p_idem_key text, p_body_hash text) returns boolean`: apaga a linha `em_andamento` com o mesmo hash. Idempotente. Chamada pela API em todo desfecho sem criação e também no `catch` de erro inesperado.

Nenhuma função devolve `exact_point`, `match_*`, `geocode_point_id` nem hash. As saídas de duplicidade devolvem só `id`, data e nome do serviço de pedido **do próprio cliente**.

### 4.5 Catálogo de auditoria
`insert into audit.action_catalog` (molde de `20261112170000_profile_audit_actions.sql`): ação `request.published`, `object_type='service_request'`, `reason_required=false`, `state_keys` = `{status, photos, duplicate_ack}`. Chaves fora de `private.audit_key_is_forbidden` (sem `endereco`, `lat`, `email`, `nome`). `[NÃO VERIFICADO]` o valor de `actor_role` aceito para cliente (a H-036 usa `professional`); o DEV confere o CHECK em `20261110140000` e usa o papel de cliente existente.

### 4.6 Desfazer (`...down.sql`)
Ordem: remover funções `request_publish_*` e `request_publish_limits`; remover gatilhos; `alter table app.media_asset drop column if exists request_id` (e o índice); remover `duplicate_ack`, depois `service_request`; remover a chave `publish.limits` se `version=1`; remover a linha do catálogo de auditoria **só se não referenciada**; `delete from ops.schema_migration where version = '...'`. **Guarda:** se `service_request` ou `duplicate_ack` tiver linha, aborta com `rollback_recusado_com_dados` a menos que `set app.rollback_force = '1'` (perda de pedido de usuário só de propósito, só em dev), como o rollback da H-036. Idempotente. Não toca `request_draft`, `geocode_point`, `ops.idempotency_key`, auditoria já gravada nem a #43.

## 5. Idempotência, duplicidade e limites

### 5.1 Idempotência (RN-06, CA-06, CA-07, CA-08)
Três camadas independentes, da mais externa à final: (1) **chave** `(app_user.id, 'request.publish', Idempotency-Key)` com hash do corpo canônico (`sha256` de `draft_id|content_rev|duplicate_ack ou vazio`); (2) **trava do rascunho** `for update`; (3) **unicidade física** `origin_draft_id`. Cenários:
- Mesma chave, mesmo corpo, depois de concluída → `repetida`: o banco devolve o id guardado em `response_body_ref`; a API reconstrói o corpo lendo o pedido (via `begin`) e responde **201 com o mesmo corpo**.
- Mesma chave, corpo diferente → 422. Mesma chave enquanto a primeira roda (geocodificação em curso) → 409 `em_andamento`, porque a linha `em_andamento` foi **confirmada em transação curta** pelo `begin`.
- Chaves diferentes, mesmo rascunho, simultâneas: ambas passam o `begin`, uma geocodifica e a outra recebe `geocodificacao_em_andamento` ou `reutilizar`; no `commit` o `for update` serializa: a primeira cria, a segunda vê `publicado` e responde **200** com o mesmo pedido. A unicidade de `origin_draft_id` é a rede de segurança se alguém contornar a função.
- Falha forçada entre inserir o pedido e marcar o rascunho (CA-08): o `commit` é uma transação; a exceção desfaz pedido, vínculo de fotos, `duplicate_ack`, auditoria e a conclusão da chave. A chave volta a `em_andamento` até o `abort`/lease; a repetição refaz.
- Processo morto depois do `begin`: a linha expira em 120 s (lease) e `idempotency_begin` a reinicializa. Processo morto depois do `commit` e antes da resposta: a repetição com a mesma chave devolve o pedido (borda 12 do refino).

### 5.2 Limites (RN-14, CA-16)
`rl_check/rl_hit` com chaves HMAC (64 hex, exigência de `ops.rate_counter.key_hmac`): `publish:user:<user_id>` (5/h) e `publish:ip:<ip>` (20/dia), HMAC com `REQUEST_PUBLISH_HMAC_KEY` e separação de domínio por rótulo. O IP vem de `normalizeClientIp(req.socket.remoteAddress)` como na H-025. A cota é consumida **no `begin`**, depois das recusas baratas e antes da chamada paga: o limite protege justamente o custo do provedor. Consequência aceita: uma tentativa que falha por provedor (503) consome uma unidade. Replay por chave e recusas de validação **não** consomem. Excesso → 429 com `Retry-After` e sem expor o limite.

## 6. Duplicidade (RN-08, ADR-015, decisões 62 e 229)
No `commit`, depois do ponto validado e antes do `insert`:
```
select r.id, r.published_at, s.name
  from app.service_request r
  join app.geocode_point g on g.id = r.geocode_point_id
  join app.service s on s.id = r.service_id
 where r.customer_user_id = p_user
   and r.service_id = <service_id do rascunho>
   and (r.status in ('publicado','selecionado') or r.published_at > p_now - make_interval(secs => dup_window_s))
   and extensions.st_dwithin(g.exact_point, <exact_point do ponto novo>, dup_radius_m)
 order by r.published_at desc limit 1
```
Só pedidos **do próprio cliente** (nunca vaza outro cliente, CA-09); o ponto exato é lido **dentro** da função, sem sair do banco. Índice `(customer_user_id, service_id, published_at desc)` limita a varredura aos pedidos do cliente naquele serviço; `st_dwithin` sobre `geography` usa metros. A comparação é **depois da geocodificação** (precisa do ponto), por isso o aviso é desta história e não da #43. Com `p_ack` verdadeiro o aviso é dispensado e o par é gravado em `duplicate_ack`. A decisão 62 impede bloqueio: o aviso é sempre superável.

## 7. Geocodificação e composição (porta simulada, decisão 239)
- **Reuso:** `ensurePermanentPoint` e `PgGeoPointStore` (`subjectKind: 'request'`, `clock`) da #34/H-036; nada novo no serviço de geocodificação.
- **Composição:** `apps/api/src/requests/publish-composicao.ts` no molde de `professional-offering-composicao.ts`: `montarPublicacaoPedido(env, opcoes)` com variáveis obrigatórias por **nome** (`DATABASE_URL_APP_SYSTEM`, `SITE_URL`, `ADDRESS_HASH_KEY`, `REQUEST_PUBLISH_HMAC_KEY` ≥ 32), `abrirCliente`, `relogio`, `provedor` opcionais; `pendencias` lista só nomes. `caps` via `parseBreakerCaps(MAPBOX_PERMANENT_SOFT_LIMIT, MAPBOX_PERMANENT_HARD_LIMIT)`. Sem `provedor` → rota montada devolvendo 503 (D-12). **O provedor real da Mapbox só entra depois de BLQ-EXEC (decisão 116/239).**
- **Em teste:** fake de `GeocodingPermanentPort` contando chamadas e fake de `GeoPointStorePort` (já existe em `apps/api/tests/geo-permanent-store-fake.ts`) para os testes de rota; os testes de banco usam o armazenamento Pg real com o provedor simulado.
- **Variável nova:** `REQUEST_PUBLISH_HMAC_KEY` (chave HMAC dos baldes de taxa e do token de duplicidade). Valor só em `.env.local` do produto (gitignored) e nas variáveis do ambiente de implantação; nunca no código nem na Issue. O DEV não lê nem imprime `.env.local`.

## 8. Tela (botão na revisão, mínimo necessário na #43)
Arquivos: `apps/web/public/pedido-revisao.js` (controlador), `apps/web/public/pedido/revisao.html`, `apps/web/public/pedido.css` (tokens). **Só aditivo**: nenhum estado de H-030 é removido.
- No estado **Confirmado** o texto "Pedido confirmado. Ainda não foi publicado." **permanece** e passa a haver o botão "Publicar pedido" (decisão 235). Antes da resposta do servidor a palavra "publicado" só aparece dentro de "Ainda não foi publicado." (CA-14).
- O controlador gera **uma** `Idempotency-Key` por tentativa lógica (`crypto.randomUUID()`), reusa a mesma em novo envio **do mesmo conteúdo** (retry de rede) e gera outra após qualquer resposta de erro que a libere (409 duplicidade, 422, 202, 503). Botão `disabled` e `aria-busy` enquanto envia; Enter repetido não envia.
- Estados e textos: os de 109 §7 (Publicando, Publicado com "Aceites até [data]" em `role="status"`, Aviso de duplicidade com "Revisar" e "Publicar mesmo assim" em `role="alert"` com foco no primeiro botão, Conteúdo alterado, Sessão ausente, Limite, Endereço não encontrado, Limite de endereços, Processando endereço, Vencido, Indisponível). Acrescentam-se: `email_divergente` ("Entre com o mesmo e-mail do pedido."), `fotos_em_processamento` ("Suas fotos ainda estão sendo preparadas. Tente de novo em instantes."), `aguardando_geocodificacao` (reuso do texto de "Processando endereço"). Todos com texto visível, sem depender só de cor, teclado e 320 px (herdado da #43).
- 401 leva ao `/acesso` (link para o acesso, decisão 230); o rascunho continua confirmado.
- Não grava nem exibe telefone, coordenada, mapa ou id interno. A resposta 201 não é guardada no navegador; a tela pós-publicação completa é da #47.

## 9. Segurança e privacidade
1. **Posse e IDOR:** o rascunho exige o **par** `id` + hash do cookie; o pedido exige o **cliente da sessão** igual a `customer_user_id`; tudo que não for do chamador responde o 404 uniforme (08 §5.3). A chave de idempotência é por `app_user.id`: chave de um cliente nunca repete resposta de outro.
2. **CSRF/fixação:** Origin, `Sec-Fetch-Site`, `application/json`, cookies `__Host-` (`SameSite=Strict` no do rascunho; `[NÃO VERIFICADO]` o `SameSite` do cookie de sessão, a #27 o define).
3. **Atribuição em massa:** o corpo só aceita `draft_id`, `content_rev`, `duplicate_ack`. Dono, serviço, urgência, endereço e prazo vêm do banco, nunca do cliente.
4. **Auditoria sem localização:** `audit_append(actor_ref='customer:<uuid>', actor_role=<cliente>, action='request.published', object_type='service_request', object_id=<request id>, before_state=null, after_state={status:'publicado', photos:<n>, duplicate_ack:<bool>})`. Sem texto de endereço, ponto, e-mail, nome, descrição.
5. **Banco:** RLS forçada e sem política; tabelas sem acesso direto para nenhum papel (inclusive `app_system`); funções definer com `search_path=''`; PostGIS chamado com nome qualificado (`extensions.st_dwithin`). Teste estático: nenhuma coluna `lat|lon|point|geom` em `service_request`; nenhum `grant` fora de `app_system`.
6. **Privacidade:** a #44 grava `first_name` (C2) e `description`/`address_text` (C3) na tabela do pedido; **não** copia o e-mail (a identidade do cliente é a conta). Resposta e logs não carregam esses campos. Retenção do pedido: `[PENDENTE JURÍDICO]` (ADR-016).
7. **Custo:** a chamada paga só ocorre depois das recusas baratas e é única por texto (reserva atômica `geo_reserve`); o breaker de gasto de 68 §5 continua valendo; limite de taxa no `begin`.
8. **Ordem de trava (anti-deadlock):** sempre rascunho → linha da chave de idempotência → (fotos) → inserção do pedido. `begin` e `commit` seguem a mesma ordem; `lock_timeout` 5 s transforma espera longa em 503.

## 10. Concorrência (resumo verificável)
| Cenário | Resultado |
|---|---|
| 20 envios simultâneos, mesma chave | 1 pedido; 1×201 e os demais 201 repetido ou 409 `em_andamento` |
| 20 envios simultâneos, 20 chaves, mesmo rascunho | 1 pedido; 1×201, 19×200 |
| Publicar enquanto outra aba edita (PATCH) | o `commit` reconfere `content_rev`: `conteudo_alterado`, pedido não criado |
| Duas publicações do mesmo endereço (rascunhos diferentes do mesmo cliente) | uma geocodificação por `(assunto, hash)`; duplicidade avisa a segunda |
| Queda entre `begin` e `commit` | lease de 120 s libera; sem pedido |
| Queda entre `commit` e resposta | repetição com a mesma chave devolve o pedido |

## 11. Impacto sobre outras histórias
- **#43 (H-030, Aguardando aprovação):** (a) o gatilho `draft_confirmation_guard` **não** atrapalha: `status` passa a `publicado` (permitido pelo CHECK `confirmed_at is null or status in ('aberto','publicado')`), nenhuma coluna de conteúdo muda, logo `confirmed_at` e `content_rev` ficam; `[VERIFICADO no desenho 90 §3.1]`, o DEV confirma no SQL da `20261112150000`; (b) `draft_get`, `draft_review_get` e `draft_confirm` filtram estados vivos, então rascunho publicado responde o 404 uniforme (T-DB07 da #43 continua verdadeiro); (c) **única mudança de comportamento visível:** o estado Confirmado ganha o botão "Publicar pedido" (H-030 §5.3 dizia "sem botão de publicar"). Testes da #43 que afirmam a **ausência** do botão devem ser ajustados pela #44 (`[NÃO VERIFICADO]` quais, ver §14); o texto "Pedido confirmado. Ainda não foi publicado." e a regra "publicado só depois do servidor" não mudam; (d) `draft-route.ts`, `draft-service.ts`, `request-draft.ts`, `review.ts` **não são editados**.
- **#36 (H-023):** todo o contrato de 97 §3.2 é atendido: `id`, `service_id`, `status`, `acceptance_deadline_at` (imutável, CHECK de 168 h), `geocode_point_id` (único, ponto `ok`, `permanent`, com `match_*`, garantidos por gatilho), índice `(service_id, status, acceptance_deadline_at)`. `publicado` é o único estado de admissão aberta; `selecionado|concluido|cancelado` existem como valores válidos. **Modalidade não é gravada** (decisão 232): a #36 usa serviço e modalidade declarada pelo profissional. Nada de dado pessoal é lido. A guarda de pré-requisito da #36 (`discover_pre_requisito_ausente`) passa quando esta migração está aplicada antes da dela; a migração da #36 deve ter prefixo **maior** que o da #44. O T-D07 da #36 (pedido publicado aparece dentro do raio e some após o prazo) usa o `commit` com a porta simulada.
- **#37 (H-024):** consome `service_id, status, published_at, geocode_point_id` pela mesma tabela; nenhuma coluna a mais. `[NÃO VERIFICADO]` `99-DESENHO-H024` não foi relido nesta rodada; a #37 deve conferir a lista de colunas que lê.
- **#45 (H-032, visibilidade):** terá de acrescentar rótulo generalizado por expansão; a resposta de publicação não contém localização. `address_text` fica em texto (A4).
- **#46 (H-033, telefone):** acrescentará `phone_*` por expansão; nada de telefone no corpo, tela ou auditoria agora; republicação não herda opt-in.
- **#47 (H-034, painel):** usa `(customer_user_id, status)` e uma função de leitura do dono (dela); recebe de graça o `id` da resposta; decide limpar ou não o cookie do rascunho (A12).
- **#92/#93 (H-082/H-083):** colunas de cadeia já existem nulas; o índice único parcial e o assunto da cadeia (A6) são deles.
- **#30 (H-017, regra I-19):** `private.acceptance_not_own_request()` já existe e lê `customer_user_id` pelo `id` da tabela de `TG_ARGV[0]`. A #44 entrega **tabela e coluna com esses nomes**; o gatilho em `app.acceptance` é anexado pela migração de E6 (`'app.service_request'` no argumento). O teste T-DB15 prova o contrato com uma tabela de fixture contra `app.service_request` real.
- **Backlog/rastreabilidade:** atualizar H-031 em `14-BACKLOG`/`15-RASTREABILIDADE` com os nomes definitivos (D-03 e §4).

## 12. Plano de testes (mapeado aos CA do refino 109)
Padrão do repositório: `*.test.ts` (unidade/rota), `*.dbtest.mjs` (Postgres real efêmero), e o Playwright/axe já introduzidos pela #43. Tudo local, sem rede, dados sintéticos, provedores e e-mail simulados. Evidência: comando, contagem de passou/falhou e código de saída de `corepack pnpm check:all`, `db:test` e do navegador; nunca declarar CI verde.

### 12.1 Banco (`packages/db/tests/request-publish-h031.dbtest.mjs` e `request-publish-migration.test.mjs`)
| # | Teste | CA |
|---|---|---|
| T-DB01 | Contrato da #36 por catálogo: colunas e tipos de §4.1; índice `(service_id,status,acceptance_deadline_at)`; unicidade de `geocode_point_id` e `origin_draft_id`; CHECK de `status`; RLS forçada | CA-18 |
| T-DB02 | `acceptance_deadline_at = published_at + 168 h` exatos; `update` direto de `acceptance_deadline_at` e de `published_at` falha; demais imutáveis; `delete` falha; relógio fixo | CA-04 |
| T-DB03 | Fronteira: com a mesma expressão que a #36 usa (`status='publicado' and p_at < acceptance_deadline_at`): aberta em T−1 µs, **fechada** em T e T+1 µs | CA-05 |
| T-DB04 | Publicar: `id` do pedido ≠ id do rascunho; rascunho `publicado` com `confirmed_at` e `content_rev` preservados; `status='publicado'`, `acceptances_count=0`, `version=1`, `wave2_opened_at` nulo | CA-03 |
| T-DB05 | Nada publica sozinho: rodar `draft_identity_set`, `draft_review_get`, `draft_confirm`, expiração e leitura; `count(*)` em `service_request` = 0 | CA-01 |
| T-DB06 | E-mail: rascunho sem verificação; conta sem verificação; e-mail divergente; conta `bloqueado`; cada um recusa e **nada** é criado nem a chave fica presa | CA-02 |
| T-DB07 | **Concorrência:** 20 conexões, mesma chave ⇒ 1 pedido; 20 conexões, 20 chaves ⇒ 1 pedido (19× `ja_publicado`); verificar `xmin` do pedido inalterado | CA-06 |
| T-DB08 | Chave: corpo diferente ⇒ `conflito`; chave em andamento (lease vivo) ⇒ `em_andamento`; lease vencido ⇒ reinicia; `abort` libera; resposta guardada reconstrói o mesmo pedido | CA-07 |
| T-DB09 | Atomicidade: gatilho de teste que levanta erro quando o rascunho vira `publicado` (e outro, no `insert` de `duplicate_ack`) ⇒ nenhum pedido, rascunho `aberto`, fotos sem `request_id`, sem auditoria, chave não concluída; paridade de `request_publish_missing` com `draft_confirm` (20 casos) | CA-08 |
| T-DB10 | Duplicidade: mesmo cliente/serviço, 60 m, ativo ⇒ `duplicidade`, nada criado; 140 m ⇒ cria; outro cliente no mesmo ponto ⇒ cria sem aviso; cancelado há 25 h a 50 m ⇒ cria; cancelado há 2 h a 50 m ⇒ avisa; com `p_ack` ⇒ cria e grava `duplicate_ack`; oráculo independente (haversine em JS) para as distâncias | CA-09 |
| T-DB11 | Ponto: de outro assunto, `state<>'ok'`, sem `match_cell`, ou de `professional_base` ⇒ `ponto_invalido`/`23514 pedido_ponto_invalido` (também por `insert` direto) | CA-10 (banco) |
| T-DB12 | Limites: 6ª publicação do cliente na hora ⇒ `limite` com `retry_after`; limite por IP; replays e recusas baratas não consomem; valores vindos de `publish.limits`, com campo inválido ⇒ padrão | CA-16 |
| T-DB13 | Uniformidade: rascunho vencido, descartado, inexistente, de outro hash, `id` de outro e `publicado` de outro cliente ⇒ o **mesmo** conjunto de colunas (`nao_encontrado`); acima do teto de 30 dias idem | CA-15 |
| T-DB14 | Fotos: `pending` não vencida ⇒ `fotos_em_processamento`; `pending` vencida e `rejected` ignoradas; `ready` confirmada ganha `request_id`; foto marcada para expurgo não vincula | CA-17 |
| T-DB15 | Segurança: `search_path=''`; só `app_system` com execute; `app_api/anon/authenticated/service_role` sem; nenhuma coluna `lat|lon|point|geom`; **I-19:** anexar `private.acceptance_not_own_request('app.service_request')` a uma tabela de fixture e provar `aceite_proprio_pedido` com pedido real | CA-18, #30 |
| T-DB16 | Sem efeitos colaterais: `ops.outbox_event` e `ops.job` inalterados; sem `acceptance`/conversa; `acceptances_count=0` | CA-13 |
| T-DB17 | Migração: aplicada sobre banco com a #43; duas vezes sem erro; `.down.sql` recusa com dados e remove tudo sem dados; reaplicar volta; `request_draft` e `draft_*` intactos | expansão |

### 12.2 API (`apps/api/tests/request-publish-route.test.ts`, banco real e portas fake)
| # | Teste | CA |
|---|---|---|
| T-API01 | Lista fechada de chaves no 201/200 (`id,status,publishedAt,acceptanceDeadlineAt`); varredura: nenhum par numérico com cara de coordenada, nenhum `geocode_point_id`/hash/endereço/e-mail | CA-12 |
| T-API02 | Geocodificação: endereço novo ⇒ **1** chamada ao provedor fake com a flag permanente; repetição do mesmo texto (outra chave) ⇒ 0 chamadas; 4º endereço diferente do assunto ⇒ `geocode_limit` sem chamar | CA-10 |
| T-API03 | Provedor falha ⇒ 503 `Retry-After`, rascunho `aberto`, teto não consumido, chave liberada; nova tentativa com a **mesma** chave cria o pedido; `sem_resultado`, `breaker` (202), `em_andamento` (409) mapeados | CA-11 |
| T-API04 | Ordem das recusas de §3.1: Origin, tipo, sem provedor (503 sem tocar o banco), chave inválida, 401, 404 uniforme **byte a byte** igual ao da #43, corpo extra, 413 | CA-01, CA-02, CA-15 |
| T-API05 | Duplicidade: 409 com `ackToken`; reenvio com o token ⇒ 201; token adulterado, expirado, de outro rascunho/versão/usuário ⇒ novo 409; o 409 não grava a chave | CA-09 |
| T-API06 | 429 com `Retry-After` e corpo sem número do limite | CA-16 |
| T-API07 | Sentinela: e-mail, nome, endereço, descrição, token e `Idempotency-Key` sintéticos não aparecem em log nem em corpo de erro | privacidade |
| T-API08 | Nenhum e-mail enfileirado, nenhum aceite criado (fake do enfileirador vazio; contagens do banco) | CA-13 |
| T-API09 | Reenvio `Idempotency-Key` igual com sessão de **outro** cliente ⇒ não repete a resposta do primeiro | segurança |

### 12.3 Unidade e navegador
- Domínio puro `packages/domain/src/request/publish.ts`: `parsePublishBody`, formato da chave, emissão e verificação do token (HMAC injetado, relógio fixo), textos fixos; sem rede.
- Controlador de `/pedido/revisao` com relógio e rede falsos: uma requisição por clique; chave reusada no retry e nova após erro liberado; "publicado" só depois de 201/200; botão desabilitado (CA-14).
- Estático: HTML sem `style=`/script em linha/hex fora de tokens; nenhuma palavra `lat|lon|map`.
- Playwright/axe (herdado da #43): todos os estados de 109 §7 com captura; foco e `role`; botão ausente sem confirmação e presente só em Confirmado; 320 px e teclado (CA-19). NVDA continua pendente do testador humano.

### 12.4 Cobertura dos critérios
| CA | Provas | CA | Provas |
|---|---|---|---|
| CA-01 | T-DB05, T-API04 | CA-11 | T-API03 |
| CA-02 | T-DB06, T-API04 | CA-12 | T-API01 |
| CA-03 | T-DB04 | CA-13 | T-DB16, T-API08 |
| CA-04 | T-DB02 | CA-14 | controlador, Playwright |
| CA-05 | T-DB03 | CA-15 | T-DB13, T-API04 |
| CA-06 | T-DB07, T-DB08 | CA-16 | T-DB12, T-API06 |
| CA-07 | T-DB08 | CA-17 | T-DB14 |
| CA-08 | T-DB09 | CA-18 | T-DB01, T-DB15 |
| CA-09 | T-DB10, T-API05 | CA-19 | Playwright (estados de 109 §7) |
| CA-10 | T-DB11, T-API02 | | |

## 13. Arquivos prováveis a tocar (para o orquestrador checar conflito)
**Novos (sem conflito esperado):** `supabase/migrations/20261113010000_requests_create_service_request.sql` e rollback; `packages/domain/src/request/{publish.ts,index.ts}`; `packages/db/src/request-publish.ts`; `apps/api/src/requests/{publish-route.ts,publish-service.ts,publish-composicao.ts}`; `packages/db/tests/request-publish-*`; `apps/api/tests/request-publish-route.test.ts`; testes de unidade e Playwright novos.

**Edições pontuais em arquivos compartilhados (aditivas, fazer por último, em commit pequeno):**
| Arquivo | Edição | Conflito conhecido |
|---|---|---|
| `apps/api/src/composicao.ts` | importar `montarPublicacaoPedido`, campo `publish` em `Integracoes`, chamada após `montarRascunho` | **#141 fase 2 e #119** editam este arquivo |
| `apps/api/src/app.ts` | opção `requests?: PublishRouteOptions` e bloco `if (opts.requests && isPublishRoute(path))` junto de `opts.drafts` | **#141 fase 2 e #119** |
| `apps/api/src/vercel.ts` | passar `integracoes.publish` ao `createApp`; abrir cliente `app_system` | **#141 fase 2 e #119** |
| `packages/db/src/index.ts` e `packages/domain/src/index.ts` | `export` dos módulos novos | baixo |
| `apps/web/public/pedido/revisao.html`, `pedido-revisao.js`, `pedido.css` | botão e estados (aditivo) | só a #43, já entregue |
| `apps/web/tests/**` da #43 | ajustar asserções "sem botão de publicar" no estado Confirmado | #43 |
| `docs/factory/09-MODELO-DADOS.md` | nota de §3.4 (feita neste desenho) | nenhum |
| `docs/factory/14-BACKLOG.md`, `15-RASTREABILIDADE.md` | nomes definitivos de H-031 | nenhum |

Sugestão ao orquestrador: se o registro de handlers da #119 já tiver pousado quando a #44 iniciar, **registrar o handler pelo novo mecanismo** e não editar `app.ts`; se não, adiar as três edições compartilhadas para o fim do Desenvolvimento e fazê-las em commit próprio sobre o HEAD então vigente. Nada em `draft-route.ts`, `draft-service.ts`, `compose.ts` (rascunho), `request-draft.ts`, `packages/domain/src/draft/*` e nas migrações da #43 é editado.

**Nota de 09 §3.4 (feita):** o bloco `service_request` de `09-MODELO-DADOS.md` passa a registrar que `exact_point`, `match_point`, `geocode_mode`, `geocoded_at` e `address_text_enc` foram **substituídos por `geocode_point_id`** (decisão 233; I-28) e que o GiST de `match_point` não existe (decisão 57), com ponteiro para este desenho.

## 14. Riscos e o que NÃO foi verificado
### Riscos
| # | Risco | Mitigação |
|---|---|---|
| R1 | Duplicar a regra de campos faltando (`request_publish_missing` × `draft_confirm`) | Teste de paridade T-DB09; o SQL é a autoridade |
| R2 | Foto alterada depois de confirmar sem incrementar `content_rev` (a #43 transferiu isso às #39/#42, ver 90 §3.3) | O DEV confere em `20261112120000`/`190000` e no código da #42; se faltar, esta migração cria `private.draft_content_touch(uuid)` e as funções de foto a chamam (A13); teste "adicionar/remover foto após confirmar ⇒ `conteudo_alterado`" |
| R3 | Chave de idempotência presa após falha | Lease de 120 s + `abort` + remoção dentro de `begin`; T-DB08 |
| R4 | `st_dwithin` e papéis: função definer precisa achar `extensions.*` com `search_path=''` | Nome qualificado; T-DB10 roda com `app_system` |
| R5 | Expurgo de rascunhos publicados ou de mídia vinculada | `origin_draft_id on delete set null`; foto com `request_id` nunca é órfã; DEV lê `ops-purge-*`/`retention-*` (A5, A7) |
| R6 | O provedor real fica fechado (BLQ-EXEC): sem prova de ponta a ponta com Mapbox | Decisão 239; testes só com porta simulada; CA-10 em ambiente real fica **pendente** de autorização do dono |
| R7 | Relógio da API (p_now) com deriva afeta `published_at` | Mesmo padrão do repositório; prazo é calculado a partir do mesmo `p_now`; deriva de segundos não muda a regra de 7 dias |
| R8 | Aviso de duplicidade pode irritar (falso positivo em prédio) | Nunca bloqueia; medição por `duplicate_ack` (ADR-015) |
| R9 | Migração fora de ordem entre #44, #36 e outras | A #36 exige prefixo maior; DEV reconfere `ls supabase/migrations` e renomeia migração e rollback juntos |
| R10 | Conflito de edição em `composicao.ts/app.ts/vercel.ts` (§13) | Edições por último, aditivas, em commit próprio |

### Não verificado
- Não li o SQL final de `20261112150000_draft_expand_review_confirmation.sql` (apenas o desenho 90 e o uso do banco por `request-draft.ts`); a conclusão de que o gatilho preserva `confirmed_at` ao virar `publicado` vem do desenho 90 §3.1 item 3.
- Não li `media_asset` funções/gatilhos além do cabeçalho e das colunas; não sei se um gatilho proíbe o `update` de `request_id`, nem se o expurgo apaga mídia de rascunho `publicado`.
- Não verifiquei se a #42 (Concluída) incrementa `content_rev` nas mudanças de foto (R2).
- Não li `20261112200000` nem `20261110140000` inteiros: o CHECK de `actor_role` e `state_keys` de `action_catalog` precisam de conferência do DEV.
- Não li `99-DESENHO-H024` (#37) nem o `SameSite` do cookie de sessão (#27).
- Não li o código de `PgGeoPointStore` além do uso na composição: a aceitação de `subjectKind: 'request'` em execução real é `[NÃO VERIFICADO]`.
- Não verifiquei os testes da #43 que afirmam ausência do botão "Publicar pedido" (§11).
- Não executei testes, builds nem migrações; não consultei o GitHub Project (fonte: quadro local); não li `.env.local` e não fiz grep recursivo que o imprima.
- A afirmação do refino sobre ausência de horário de verão no Brasil não é usada: D-10 torna o prazo independente de fuso.

## 15. Perguntas abertas (o Architect não pergunta ao usuário; o líder consolida e renumera)
Todas **não bloqueantes**: o DEV pode seguir a recomendação.
- **A1 — Rota.** (a) `POST /v1/requests` com `Idempotency-Key`; (b) `POST /v1/drafts/current/publish`. **Recomendação: (a)** (D-03). Destrava: nome do contrato e da tela.
- **A2 — `draft_id` no corpo.** (a) exigir o `id` já devolvido pela revisão; (b) só o cookie. **Recomendação: (a)** (D-02). Destrava: segurança de aba velha.
- **A3 — Sem provedor.** (a) 503 `publicacao_indisponivel` com a rota montada; (b) rota inexistente (404) como na H-036. **Recomendação: (a)** (D-12), para a tela mostrar "Indisponível" e não "expirou". Destrava: estado da tela em dev.
- **A4 — Endereço do pedido em texto puro.** (a) `address_text` simples (igual ao rascunho e à `base_label` do profissional) e cifrar na história de leitura/visibilidade; (b) `address_text_enc` agora (09 §3.4). **Recomendação: (a)**, porque a cifra de aplicação exige a chave e o fluxo de leitura da #45; registrar a dívida na #45. Destrava: coluna da migração.
- **A5 — `origin_draft_id` e expurgo.** (a) `on delete set null`; (b) `restrict`. **Recomendação: (a)**, para o expurgo de rascunhos não ser travado pelo pedido. O DEV confirma em `ops-purge-*`.
- **A6 — Assunto do teto de geocodificação.** (a) id do rascunho (teto de 3 por rascunho); (b) id novo do pedido, gerado antes do `begin`. **Recomendação: (a)** nesta história; a H-082 decide o assunto da cadeia na republicação (o refino §12.8 recomenda "por rascunho até a publicação").
- **A7 — Foto no pedido.** (a) `media_asset.request_id`; (b) tabela pivô própria da #69. **Recomendação: (a)** (D-13).
- **A8 — Cota de taxa consumida no `begin`.** (a) sim, para proteger o custo do provedor (uma falha de provedor consome 1 de 5/h); (b) só no sucesso. **Recomendação: (a)**; o teto de 5/h está em `app_config` e pode subir para 8 se falsos 503 incomodarem.
- **A9 — Nova variável `REQUEST_PUBLISH_HMAC_KEY`.** (a) uma chave (≥ 32) para token e baldes, com separação de domínio; (b) duas chaves. **Recomendação: (a)**. O líder cria o valor no `.env.local` do produto (nunca no chat).
- **A10 — Token de duplicidade.** (a) HMAC sem tabela (D-08); (b) tabela de tokens. **Recomendação: (a)**.
- **A11 — Status da repetição.** (a) mesma chave ⇒ 201 idêntico; outra chave no mesmo rascunho ⇒ 200 (decisão 237); (b) sempre 200. **Recomendação: (a)** (CA-06 pede resposta idêntica).
- **A12 — Cookie do rascunho depois de publicar.** (a) **não** limpar nesta história (a segunda aba continua resolvendo pelo par `id`+hash); (b) limpar. **Recomendação: (a)**; a #47 decide a tela pós-publicação.
- **A13 — `content_rev` para fotos.** (a) o DEV verifica #39/#42 e, se faltar, cria `draft_content_touch` na migração da #44; (b) devolver à #42. **Recomendação: (a)** (R2), porque a #42 já está Concluída.
- **A14 — `actor_role` da auditoria do cliente.** Valor a confirmar no CHECK de auditoria (§4.5). Recomendação: o papel de cliente já existente; se não houver, ampliar o CHECK na própria migração (expansão).

**Decisão 239 (pergunta ao usuário):** seguida a recomendação. Nenhuma chamada real ao Mapbox; a publicação real em desenvolvimento permanece fechada (D-12) até autorização do dono; todos os testes usam porta simulada.

## 16. Entrega ao DEV `[PROPOSTA]`
Pré-condição: #43 concluída por decisão humana (ou aceita pelo usuário), conforme a correção de fluxo (cadeia #43 → #44 → #36 → #37). Ordem: (1) migração, rollback e T-DB01 a T-DB17 (incluindo as verificações de §14 sobre mídia, auditoria e `content_rev`); (2) domínio `request/publish.ts`, adaptador `request-publish.ts` e serviço/rota com T-API01 a T-API09; (3) controlador e botão na revisão, ajuste dos testes da #43, estático e Playwright; (4) composição e as edições compartilhadas de §13 por último; (5) atualizar 14-BACKLOG/15-RASTREABILIDADE; (6) evidência na Issue (comando, contagens, código de saída) e lembrar que CA-10 em ambiente real continua pendente da autorização do Mapbox. Aplicar migrações com `npx supabase` no banco de desenvolvimento, sem Docker.
