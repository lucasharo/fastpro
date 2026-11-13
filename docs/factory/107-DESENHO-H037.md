# Desenho H-037 — Documentos de identidade do profissional (Issue #50, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante para começar o desenvolvimento da parte que não depende da #141 (§10). Dúvidas não bloqueantes em §13.
- **Rastro:** 106-REFINO-H037 (CA-01..CA-20, R1..R11, B1..B14); decisões 34, 35, 170 a 189 de `11-DECISOES.md` (170 e 171 seguem a recomendação (a) até haver resposta do usuário); 88-DESENHO-H026 (quarentena, TTL, cotas, expurgo em duas fases); 93-DESENHO-H027 e `reduce.ts`/`image-reducer-sharp.ts` (redução); 75-DESENHO-H035 e 99-DESENHO-H036 (rota do profissional, sessão, `app_system`, auditoria); 104-DESENHO-MIDIA-COMPOSICAO (#141, ainda não commitado); 09 §3.3, §7, §8, §9; 08 §5 e §10; 82-DESENHO-H109 (retenção).
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado. O `.env.local` não foi lido nem pesquisado.
- **Etiquetas:** `[DECIDIDO]` líder, dono do produto ou decisão numerada · `[VERIFICADO]` lido no repositório nesta leitura · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem leitura ou sem execução.

## 0. Situação encontrada (conferida no código)

1. `[VERIFICADO]` Não existem `identity_document`, `verification_case`, bucket `identity-docs`, validador de PDF nem rota de documento. `identity-docs` aparece só em `RETENTION_BUCKETS` (`packages/domain/src/retention/types.ts`) e no `check` de `retention_object_queue` (`20261111470000`, bucket in `identity-docs`/`request-photos`). A última migração é `20261112200000_identity_create_role_exclusivity.sql`; o rollback usa o padrão `supabase/rollbacks/<prefixo>_<nome>.down.sql`.
2. `[VERIFICADO]` **O acoplamento a fotos está no adaptador de Storage, não no redutor.** `SharpImageReducer` (`apps/api/src/media/image-reducer-sharp.ts`) recebe bytes e devolve bytes JPEG (formato por `sharp.metadata()`, rotação EXIF, achatamento do alfa em branco, escada de qualidade, nenhum metadado copiado); não conhece bucket nem chave. Quem fixa `request-photos` e `p/<uuid>` é `SupabaseMediaReduceStorage` (`packages/db/src/media-quarantine.ts`, linhas 309 a 398, `MEDIA_REDUCED_BUCKET`). Logo, o redutor é reaproveitado **sem nenhuma alteração** e o que se cria é um adaptador de Storage próprio (R6).
3. `[VERIFICADO]` **Armadilha não prevista no refino:** o bucket `quarantine` aceita só `image/jpeg|png|webp` (sem PDF) e a varredura de órfãos de H-026 (`listOlderThan` prefixo `d/` + `media_asset` via `known(ids)`) **removeria qualquer objeto de documento** que fosse colocado ali, porque ele não tem linha em `media_asset`. Portanto o documento não pode usar a quarentena de fotos (D-1, §2).
4. `[VERIFICADO]` Detector de imagem `detectarTipoImagem` (domínio) devolve `jpeg|png|webp|null` e recusa PDF de forma explícita; ele **não será alterado** (o PDF tem validador próprio). `ReduceGate` (`apps/api/src/media/reduce-gate.ts`) implementa `ReduceBudgetPort` e limita 4 reduções e 128 MP por instância; `ReduceDeps = { store, storage, reducer, gate, contadores }`.
5. `[VERIFICADO]` Padrão do profissional: H-035/H-036 usam sessão `__Host-fp_sess` (`SessionRepositoryPort.authenticate`), `Origin`/`Sec-Fetch-Site` antes do corpo, `no-store`, funções `security definer` em `private.*` com `grant execute` só a `app_system`, RLS forçada sem políticas, `private.audit_append` na mesma transação. `app.professional_profile` tem `user_id` (PK) e `verification_status`; `app.app_user.email_verified_at` existe (H-035 exige e-mail verificado para cadastrar o documento).
6. `[VERIFICADO]` Auditoria: `audit.audit_event` tem chave estrangeira para `audit.action_catalog (action, object_type)`; as chaves do estado passam por `private.audit_key_is_forbidden` (barra, entre outras, `documento`, `nome`, `ip`, `content`/`conteudo` como primeiro ou último termo, `lat`, `email`) e os valores string precisam casar `^[A-Za-z0-9_.:-]*$` com até 64 caracteres.
7. `[VERIFICADO]` **Mudanças locais não commitadas da #141 (ou de outra Issue):** `git status` mostra `apps/api/src/app.ts`, `composicao.ts`, `vercel.ts`, `packages/db/src/index.ts`, `packages/domain/src/index.ts`, `packages/domain/src/admin/index.ts`, `apps/web/package.json` e `pnpm-lock.yaml` modificados, e `104-DESENHO-MIDIA-COMPOSICAO.md` novo. Os barris `index.ts` também são compartilhados (§11).
8. `[VERIFICADO]` A #141 (104) cria `media-composicao.ts`, o singleton de `ReduceGate`/`ReduceCounters` em `vercel.ts` e o bundle `fotos-envio.js` (esbuild) com `FastProFotosEnvio`. Nada disso existe ainda no código commitado.
9. `[VERIFICADO]` Já existe a página `apps/web/public/profissional-documento.html/.js/.css` (cadastro do CPF/CNPJ, H-035). Não existe página de envio de arquivo.
10. `[NÃO VERIFICADO]` Estado de #48, #52, #51, #111 (H-102), #141, #43 e #119 no quadro; só a linha de #50 (coluna Arquitetura) foi vista. Concessões de `rl_check`/`rl_hit` a `app_system`; forma exata das chamadas de `audit_append` de H-036; `spikes/S-06-RESULTADO.md`.

## 1. Princípios

1. **Documento não é foto.** Nenhum objeto de documento passa por `quarantine`, `request-photos`, `media_asset` ou pelo redutor/adaptador de fotos. Buckets, chaves e tabelas próprios (R6, R7).
2. **Ninguém lê depois do envio** (decisões 170a, 34, RF-052). Nenhuma rota `GET` de arquivo, nenhuma URL de leitura, nenhum método de leitura no adaptador do bucket final. A única leitura futura é a da Verificação (#52), por uma **porta separada** definida aqui só como interface, sem implementação nesta Issue.
3. **O banco decide, a API traduz** (H-036): limite de 5, estados que aceitam envio, dono, teto global e idempotência vivem em funções e gatilhos; a rota valida formato e mapeia códigos fixos.
4. **A API lê os bytes uma vez, no servidor**, para decidir o tipo e reencodar (ao contrário de H-026, que nunca lia). O arquivo só vai ao bucket final **depois** de validado; o que é recusado nunca chega ao bucket final.
5. **Fechado por padrão e fechado em produção até a L1** (decisão 171a), com trava dupla (§9).
6. **Sem PII** em log, resposta, auditoria, nome de objeto e tabela (nome original, EXIF, IP, tamanho exato nas respostas).

## 2. Decisões de desenho

- **D-1 Dois buckets privados, criados pela migração `[PROPOSTA]`:**
  - `identity-incoming` (entrada): `public=false`, `file_size_limit=5242880` (5 MiB), `allowed_mime_types = image/jpeg, image/png, image/webp, application/pdf`. Recebe o `PUT` direto do navegador pela URL assinada de uso único. Chave `s/<uuid>`. Tem varredura própria de órfãos (§6.5); **não** está em `RETENTION_BUCKETS`.
  - `identity-docs` (final): `public=false`, `file_size_limit=2097152` (2 MiB), `allowed_mime_types = image/jpeg, application/pdf` (CA-07). Chave `i/<uuid>`. Só a API escreve (chave de serviço do servidor).
  - Nenhuma política em `storage.objects` para os dois buckets (RLS do Storage nega `anon` e `authenticated`).
  - Alternativas descartadas: reaproveitar `quarantine` (PDF não passa pelo `allowed_mime_types` e o varredor de H-026 apagaria o objeto; ver §0.3); entrada em prefixo do próprio `identity-docs` (o limite do bucket subiria para 5 MiB e o `allowed_mime_types` incluiria PNG/WebP, quebrando CA-07); a API receber o corpo (limite de ~4,5 MB do corpo da função, menor que os 5 MiB de entrada da decisão 173).
- **D-2 Tabela única `app.identity_document`**, ligada ao `professional_profile`; **`verification_case` não é criado aqui** (a H-035 já decidiu que a tabela é da fila de H-039/#52; 75 §0). A coluna `media_asset_id` do modelo 09 §3.3 **não existe**: não se reaproveita `media_asset` (decisão 172). A 09 §3.3 e §8 precisam ser corrigidas (§12).
- **D-3 Três portas de Storage, separadas por finalidade** (domínio define interfaces; `packages/db` implementa):
  - `IdentityDocStagingPort`: `createUploadUrl(key, ttlS)`, `stat(key)`, `read(key)` (uso interno do serviço de finalização, nunca de rota), `remove(key)`, `listOlderThan(ms, limite)`. Só o bucket `identity-incoming`, só chave `s/<uuid>`.
  - `IdentityDocFinalPort`: `put(id, bytes, tipo)` (upsert, para a nova tentativa ser idempotente), `stat(id)`, `remove(id)`. **Sem leitura, sem URL assinada de leitura, sem listagem.** Só o bucket `identity-docs`, só chave `i/<uuid>` (CA-06, CA-19).
  - `IdentityDocReaderPort` (interface apenas): `readForReview(id)`. **Sem implementação em #50**; a #52 cria a classe, em arquivo separado, e só a injeta no serviço da Verificação. Teste estático: nenhum arquivo de #50 importa ou instancia essa porta (CA-19).
- **D-4 Redutor sem alteração:** o serviço de finalização injeta o mesmo `ImageReducerPort` (`SharpImageReducer`) e o mesmo `ReduceGate` da instância (para a soma de reduções de fotos e documentos respeitar o limite de 4 simultâneas e 128 MP) e as mesmas constantes (decisão 176: 1.280 px, alvo 500 KB, teto 750 KB). Nenhum arquivo de `media-quarantine.ts`, `reduce.ts`, `image-reducer-sharp.ts`, `media-reduce-service.ts` ou `image-type.ts` é editado.
- **D-5 Envio em duas chamadas, como H-026:** emitir (reserva a vaga e devolve URL de uso único para `identity-incoming`) e finalizar (valida, reencoda, grava no bucket final, apaga a entrada). O navegador pode reduzir antes de enviar (§8), mas a **autoridade é o servidor**: tudo que chega é revalidado e reencodado.

## 3. Rotas (sob `/v1/professional/documents`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, sem CORS)

O dono é sempre o profissional da sessão. O corpo e a URL nunca trazem identificador de profissional (CA-12, CA-18).

| Rota | Efeito | Sucesso | Erros |
|---|---|---|---|
| `GET /v1/professional/documents` | Lista do dono: `{ documents: [{ id, kind: "imagem"\|"pdf", status: "recebido"\|"em_envio", receivedAt, deletable }], slotsRemaining }` | 200 | 401, 404, 429, 503 |
| `POST /v1/professional/documents/uploads` | Reserva a vaga e devolve `{ id, status: "em_envio", upload_url, upload_expires_at }` | 201 (nova) ou 200 (repetição) | 401, 403, 404, 413, 415, 422, 429, 503 |
| `PUT <upload_url>` | Direto do navegador ao `identity-incoming`; **não passa pela API** | do Storage | do Storage |
| `POST /v1/professional/documents/{id}/finalize` | Valida, reencoda, grava no final, apaga a entrada; idempotente | 200 `{ id, status: "recebido", kind }` | 401, 404, 409, 413, 415, 422, 429, 503 |
| `DELETE /v1/professional/documents/{id}` | Exclui enquanto não analisado | 204 | 401, 404, 409 `ja_analisado`, 429, 503 |

- **Não existem** rota `GET /{id}`, rota de arquivo, listagem de objetos nem URL de leitura (CA-06). Resposta nunca traz caminho, bucket, tamanho exato, tipo MIME, nome, `professional_id` ou hash.
- **Corpo de `POST uploads`** (JSON, até 2 KB, só estas chaves; qualquer outra, inclusive `filename`, `name`, `owner`, `professional_id`, `bucket`, `path`, `status` ⇒ 422 `campo_desconhecido`): `client_upload_id` (uuid do navegador, chave de idempotência por profissional), `content_type` (`image/jpeg|image/png|image/webp|application/pdf`, senão **415** `tipo_nao_aceito`; HEIC/HEIF/GIF/SVG recusados), `size_bytes` (inteiro ≥ 1). Limite pelo tipo declarado: imagem ≤ 5 MiB (5.242.880), PDF ≤ 2 MiB (2.097.152); acima ⇒ **413** `arquivo_grande` antes de gravar qualquer coisa (CA-03).
- **Ordem fixa:** `Origin`/`Sec-Fetch-Site` (escrita) → `Content-Type` JSON (só POST de emissão) → sessão (sem cookie válido ⇒ 401; cookie de conta sem perfil profissional ⇒ **404 uniforme**, CA-12/CA-18; ver D-9) → corpo → cota por IP-HMAC (`rl_check`) → função do banco (dono, e-mail verificado, estado do perfil, limite, teto) → Storage → `rl_hit` só após aceite. Falha interna ou do Storage ⇒ 503 fixo `{code}`.
- **404 uniforme** (corpo e cabeçalhos idênticos) para: id inexistente, id de outro profissional, id que não é uuid (não toca o banco), conta sem perfil profissional (admin, cliente, Verificação). Sem sessão é 401.
- **Códigos de resposta de `finalize`** (fixos, sem eco): 409 `upload_nao_encontrado` (objeto ausente na entrada), 409 `upload_expirado` (TTL vencido; vaga já liberada), 409 `em_processamento` (outra finalização com lease viva), 413 `arquivo_grande` (tamanho real > limite do tipo **detectado**), 415 `tipo_nao_aceito` (assinatura não é JPEG, PNG, WebP nem PDF), 422 `pdf_invalido`, `pdf_protegido`, `pdf_ativo`, `imagem_invalida`, `imagem_grande_demais` (> 64 Mpx) e `nao_cabe_no_limite` (não cabe em 750 KB mesmo no piso), 503 transitório (redutor indisponível, tempo, Storage).
  - Observação sobre B4 do refino: o código de domínio para mais de 64 Mpx é `imagem_grande_demais` (reduce.ts); o refino o chamou `nao_cabe_no_limite`. Vale o do código existente.
- **Tipo por conteúdo (B1):** o tipo declarado só decide o limite de emissão; a decisão final é pela assinatura. Declarado `.pdf` com JPEG real é aceito como JPEG; declarado imagem de 4 MiB com PDF real de 3 MiB é **413** (limite do PDF detectado) e é recusado.

## 4. Dados — migração por expansão, reversível `[PROPOSTA]`

Arquivo: `supabase/migrations/20261112210000_identity_create_documents.sql` (próximo prefixo livre depois de `20261112200000` em 2026-11-12; **o DEV reconfere a lista na hora**, porque #43, #119 ou #141 podem tomar o número) e `supabase/rollbacks/20261112210000_identity_create_documents.down.sql`. Só cria objetos novos; não altera tabela nem função existente. Aplicar com `npx supabase` no banco de desenvolvimento (nunca pelo MCP).

### 4.1 Tabela `app.identity_document`

| Coluna | Tipo / regra |
|---|---|
| `id` | uuid pk `gen_random_uuid()` (deriva as chaves `s/<id>` e `i/<id>`; sem coluna de caminho) |
| `professional_id` | uuid not null, FK `app.professional_profile(user_id)` **`on delete restrict`** |
| `client_upload_id` | uuid not null; **unique `(professional_id, client_upload_id)`** (idempotência) |
| `kind` | text not null default `identidade` check in (`identidade`) — a #51 amplia o check para `certificacao` e acrescenta `service_id` por expansão |
| `declared_type` | text check in os 4 tipos aceitos |
| `declared_bytes` | integer check between 1 and 5242880 |
| `status` | text not null default `pendente_envio` check in (`pendente_envio`,`recebido`,`substituido`) |
| `stored_type` | text null check in (`image/jpeg`,`application/pdf`) |
| `stored_bytes` | integer null check between 1 and 2097152 |
| `content_sha256` | bytea null (32 bytes; **nunca exposto**; usado na prova de integridade e por #52) `[PROPOSTA]` (D-13) |
| `pending_expires_at` | timestamptz not null (emissão + 30 min) |
| `lease_until`, `attempts` | timestamptz null / smallint not null default 0 (finalização, igual a 93 §2.2) |
| `received_at` | timestamptz null |
| `analyzed_at` | timestamptz null — **definida por #52** na primeira concessão de leitura à Verificação; enquanto nulo, o dono pode excluir |
| `purge_requested_at` | timestamptz null (marca para expurgo; a vaga é liberada) |
| `created_at` | timestamptz default `clock_timestamp()` |

Checks de coerência: `status='recebido'` ⇒ `stored_type`, `stored_bytes`, `received_at` e `content_sha256` não nulos; `analyzed_at` só com `status in ('recebido','substituido')`. Índices: `(professional_id)` parcial onde `purge_requested_at is null`; `(pending_expires_at)` parcial onde `status='pendente_envio' and purge_requested_at is null`; `(purge_requested_at)` parcial onde não nulo. **Sem** coluna de nome original, EXIF, IP, caminho, `owner_type` ou texto livre.

**Invariante de limite no banco (CA-05):** gatilho `before insert` que trava a linha do perfil (`select 1 from app.professional_profile where user_id = new.professional_id for update`), conta linhas vivas (`purge_requested_at is null and status in ('pendente_envio','recebido')`) e, havendo 5, levanta `23514 limite_documentos`. Vale mesmo para SQL direto. Linha `substituido` e linha marcada para expurgo não contam.

### 4.2 Funções (`security definer`, `set search_path = ''`, em `private`, `p_now` informado pelo chamador, `grant execute` só a `app_system`) `[PROPOSTA]`

- `private.idoc_issue(p_user, p_client_upload_id, p_type, p_bytes, p_now, p_global_bytes_cap)` ⇒ `(out_code, out_id, out_status)` com `out_code` em `new | replay | replay_received | no_profile | email_unverified | state_denied | doc_limit | cap`. Trava o perfil `for update`; confere e-mail verificado (D-3 do 106, espelhando H-035) e `verification_status` em (`pendente`, `em_revisao`, `retida_duplicidade`, `recusada`) — **`aprovada` e `suspensa` ⇒ `state_denied`** (decisão 179); marca como expurgáveis os pendentes vencidos **deste** profissional (liberação preguiçosa); trata repetição por `client_upload_id`; confere o limite de 5; confere o teto global (D-8) sob `pg_advisory_xact_lock`; insere. **Não altera `verification_status`** (CA-09).
- `private.idoc_list(p_user)`: id, `file_kind` (`imagem`/`pdf` derivado de `stored_type`), `status` público, `received_at`, `deletable` (`analyzed_at is null`). Sem tamanho.
- `private.idoc_confirm_begin(p_user, p_id, p_now, p_lease_s)` ⇒ `(out_code, out_attempt, out_declared_type)` com `begin | replay | not_found | expired | busy | too_many`. Posse pelo `professional_id`; lease de 30 s; máximo de 3 tentativas contadas.
- `private.idoc_confirm_done(p_user, p_id, p_attempt, p_stored_type, p_stored_bytes, p_sha256, p_now)` ⇒ `received | lost | gone`. Grava `recebido` e, **na mesma transação**, `private.audit_append('identity.doc.received', 'identity_document', …)`. Se o perfil estiver `recusada`, marca como `substituido` os documentos **já analisados** (`analyzed_at is not null`) do profissional, liberando vagas (D-4). Falha de auditoria desfaz tudo (CA-14).
- `private.idoc_confirm_refuse(p_user, p_id, p_attempt, p_code, p_now)`: marca `purge_requested_at` e grava `identity.doc.refused` com `reason_code` fixo (lista de §3), na mesma transação. A linha some no `purge_done` depois que o objeto de entrada sai.
- `private.idoc_confirm_release(p_id, p_attempt, p_count)`: devolve a lease; `p_count=false` devolve a tentativa (falha transitória).
- `private.idoc_delete(p_user, p_id, p_now)` ⇒ `deleted | not_found | already_analyzed`. Trava a linha; só exclui se `analyzed_at is null`; marca `purge_requested_at`; grava `identity.doc.deleted`. É também o cancelamento de um envio pendente.
- `private.idoc_sweep(p_now, p_limit)`: marca (a) pendentes vencidos e devolve os ids marcados com a informação de qual bucket limpar; `private.idoc_purge_done(p_ids)` apaga as linhas depois do Storage confirmar; `private.idoc_known_pending(p_ids)` para a varredura de órfãos.
- **A #52 cria `private.idoc_review_target(...)`** (fora de #50) com o contrato: trava a linha `for update`, **grava `analyzed_at` se nulo na mesma transação**, registra `sensitive_access_log` e devolve só `id` e `stored_type`. Assim exclusão e primeira leitura se serializam e nunca se cruzam.

### 4.3 Postura de segurança (igual às migrações de identidade)

RLS habilitada e **forçada**, sem políticas; `revoke all` da tabela e das funções de `public, anon, authenticated, service_role, app_api, app_system, app_backup_reader`; nenhum DML ou SELECT direto; `grant execute` das funções só a `app_system`. `app_api` não recebe nada (as rotas do profissional rodam com `app_system`, como H-035 e H-036). Buckets criados por `insert into storage.buckets … on conflict (id) do update set public=false, file_size_limit=…, allowed_mime_types=…`. Cadastro das 3 ações em `audit.action_catalog` (`on conflict do nothing`): `identity.doc.received`, `identity.doc.refused`, `identity.doc.deleted`, `object_type='identity_document'`, `state_keys` = `file_kind`, `size_bytes`, `reason_code` (nenhuma casa com `audit_key_is_forbidden`; o teste passa as chaves por `private.audit_keys_are_clean`). `retention_policy` de `identity-docs` **não é tocada** e permanece desligada (RN-08, CA-08).

### 4.4 Rollback

`.down.sql` recusa (raise exception) se houver linhas em `identity_document` ou objetos nos dois buckets; senão remove funções, gatilho, tabela, buckets e as 3 linhas do catálogo (que falham por FK se já houver evento de auditoria, o que é o desejado). Idempotente (`if exists`). Testado: aplicar, aplicar de novo, desfazer, desfazer de novo, reaplicar.

## 5. Regras, cotas e teto

- **Quantidade (decisão 175):** 5 vivos por profissional (D-4 define "vivo").
- **Cotas de emissão (decisão 188):** por profissional 12/h e 25/dia; por IP-HMAC 40/h e 150/dia; finalização 30/h por profissional; leitura da lista 120/min por IP. Constantes novas de domínio (`IDOC_RATE_*`, ids próprios), mesma forma de `MEDIA_RATE_*`; chave do balde SHA-256 de `idoc:<política>:<valor>`; `rl_hit` só após aceite; 429 só com `Retry-After`, sem campo que revele o limite.
- **D-8 Teto global (decisão 189), `[PROPOSTA]` do Arquiteto:** em **bytes**, não em contagem. `IDOC_GLOBAL_BYTES_CAP = 250.000.000` (≈ 250 MB, dentro dos 300 MB de documentos de 09 §9, com ≈ 50 MB de folga para a entrada transitória de até 5 MiB por envio). Soma = `stored_bytes` das linhas com objeto + **2.097.152** reservados por linha `pendente_envio` (pior caso do que será gravado). Sob trava consultiva transacional, porque emissão de documento é rara (ao contrário de H-025, a corrida é fechada). Resposta ao atingir: 429 neutro (`Retry-After` fixo, sem revelar o teto). Pior caso por profissional: 5 × 2 MiB = 10.485.760 bytes ⇒ 250.000.000 ÷ 10.485.760 ≈ 23,8, ou seja, ≈ 23 profissionais com o pior caso em MiB (≈ 25 se o pior caso for lido como 5 × 2 MB decimais, 10 MB); caso típico (3 imagens de ≈ 0,5 MB + 1 PDF de 1 MB ≈ 2,5 MB) ⇒ ≈ 100 (CA-16). O valor é constante e pode ser revisto na L1.
- **TTL do pendente 30 min; URL de envio 15 min de alvo; varredura de órfãos 3 h** (mesmos valores e a mesma ressalva `[NÃO VERIFICADO]` de H-026 §3 sobre a validade real do token do Storage).

## 6. Validação e reencode

### 6.1 Finalização, passo a passo (serviço `finalizeIdentityDoc`)

1. `confirm_begin` (posse, expiração, lease, tentativa) ⇒ 404/409 conforme o código.
2. `staging.stat(s/<id>)`: ausente ⇒ 409; tamanho > 5 MiB ⇒ 413 e `confirm_refuse`.
3. `ReduceGate.entrar()` (503 sem tocar o banco se não houver vaga em 2 s) e `staging.read` (leitura única, ≤ 5 MiB).
4. **Detecção por conteúdo:** `detectarTipoImagem` ⇒ `jpeg|png|webp`; senão `validarPdf` (§6.2) se começar com `%PDF-`; senão 415 `tipo_nao_aceito`.
5. **Limite pelo tipo detectado:** imagem ≤ 5 MiB (já garantido), PDF ≤ 2 MiB (senão 413).
6. **Imagem:** `ImageReducerPort.reduce(bytes, { deadlineMs: MEDIA_REDUCE_DEADLINE_MS, orcamento: gate })` ⇒ JPEG de ≤ 1.280 px e ≤ 750 KB, sem metadado; erro definitivo ⇒ `confirm_refuse` com o código do redutor (`imagem_invalida`, `imagem_grande_demais`, `nao_cabe_no_limite`); transitório ⇒ `confirm_release` e 503, três tentativas contadas como em 93 (decisões 84 a 86). **PDF:** os bytes seguem **sem alteração** (CA-17).
7. `final.put(i/<id>, bytes, tipo)` (upsert) e `final.stat` conferindo o tamanho; SHA-256 dos bytes gravados.
8. `confirm_done` (linha `recebido`, auditoria, substituição se aplicável); em seguida `staging.remove(s/<id>)`. Falha só na remoção ⇒ sobra tratada pela varredura (§6.5), a resposta ao profissional é 200.
9. Repetição de `finalize` em `recebido` ⇒ 200 com o mesmo resultado, sem tocar contagem, sem reler o Storage.

Nenhum nome de arquivo, cabeçalho de arquivo, EXIF ou erro de biblioteca atravessa a porta nem vai a log; contadores só por código fixo.

### 6.2 Validador de PDF (`packages/domain/src/identity-docs/pdf.ts`, puro, sem I/O) `[PROPOSTA]` (decisões 177 e 178)

`validarPdf(bytes): { ok: true } | { ok: false, code: 'pdf_invalido' | 'pdf_protegido' | 'pdf_ativo' }`, em tempo linear e sem lançar exceção:
- **Estrutura mínima:** começa em `%PDF-` no deslocamento 0 (sem tolerância de lixo antes, para não aceitar poliglota), versão `1.0` a `1.7` ou `2.0`, e `%%EOF` nos últimos 1.024 bytes; senão `pdf_invalido`.
- **Protegido por senha:** o nome `/Encrypt` ocorre no arquivo ⇒ `pdf_protegido` (o dicionário do trailer ou do fluxo de referência cruzada não é comprimido, então a busca em bytes cobre o caso comum).
- **Ação embutida:** nomes `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/EmbeddedFiles`, `/RichMedia`, `/SubmitForm`, `/ImportData`, `/GoToE`, `/GoToR` ⇒ `pdf_ativo`. A busca decodifica os escapes de nome `#xx` antes de comparar (evita `/J#61vaScript`), é sensível a maiúsculas (como o PDF) e exige que o nome termine em delimitador PDF (espaço, `/`, `<`, `>`, `[`, `]`, `(`, `)`, `%`, fim) para `/JS` não casar `/JSON`. `/OpenAction` e `/AA` **não** entram na lista inicial por serem comuns em PDF legítimo (D-12).
- **Limite honesto:** é uma heurística sobre os bytes. Fluxos comprimidos e fluxos de objetos (`/ObjStm`) escondem nomes; ficam sem detecção. Falsos positivos: um texto visível contendo exatamente `/JavaScript` não comprimido seria recusado. O risco residual é aceito (08 §10, SD-12 reduzida) e compensado por: o servidor **nunca renderiza nem converte** o PDF; ele só é lido pela Verificação, que o recebe como anexo para baixar (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`), requisito entregue à #52 (§7).
- O corpus de teste inclui PDFs gerados no próprio teste (sintéticos, ADR-016), com nome escapado, `/Encrypt` no trailer, cabeçalho deslocado, versão inválida, truncado e sem `%%EOF`.

### 6.3 Imagem e legibilidade (CA-15)

As constantes de foto (decisão 176) valem. A legibilidade de texto pequeno em 1.280 px é `[NÃO VERIFICADO]`: o QA inspeciona um conjunto sintético (RG/CNH fictícios) e registra. Se reprovar, mudar o alvo é decisão nova e vira constante própria do documento (`IDOC_REDUCE_*`) sem tocar as de foto, porque o redutor de domínio hoje lê constantes globais; nesse caso o redutor precisaria de parâmetros (alteração em `reduce.ts`/`image-reducer-sharp.ts`), o que **não** faz parte desta Issue e voltaria ao líder.

### 6.4 Exclusão pelo dono (decisão 180)

`DELETE` chama `idoc_delete` (só `analyzed_at is null`); a API então remove `i/<id>` (e `s/<id>` se pendente), e chama `idoc_purge_done`. Falha de Storage deixa a linha marcada (próxima varredura repete). `ja_analisado` ⇒ 409; o arquivo analisado fica retido (retenção é L1).

### 6.5 Varredura (`sweepIdentityDocs`)

(a) `idoc_sweep` marca pendentes vencidos e recusados; (b) remove no Storage `s/<id>` e, se houver, `i/<id>`; (c) `idoc_purge_done`; (d) órfãos: `staging.listOlderThan(3 h)` em `identity-incoming`, descartando os ids que `idoc_known_pending` conhece. O **agendamento** é de H-110 (ou manual, documentado), como em H-026 §4; vira condição de liberação (§9).

## 7. Porta de leitura para a #52 (contrato, sem implementação aqui)

- Interface `IdentityDocReaderPort { readForReview(id): Promise<{ bytes: Uint8Array, type: 'image/jpeg' | 'application/pdf' } | null> }` e a função de banco `private.idoc_review_target` ficam na #52, junto com `verification_case`, a tarefa atribuída e o papel de Verificação (H-102).
- Exigências para a #52: (1) autorização por tarefa atribuída; (2) gravar `analyzed_at` na mesma transação; (3) `sensitive_access_log`; (4) entregar o arquivo como `attachment` com `nosniff`, URL curta de ~60 s ou fluxo pela API, nunca inline; (5) o leitor usa credencial de leitura só do bucket `identity-docs` e a classe não é importada pelo serviço de envio.
- #50 prova a **negação** (CA-06, CA-18, CA-19); a leitura positiva é provada na #52 (decisão 184).

## 8. Interface do profissional (CA-20)

Página nova `apps/web/public/profissional-documentos.html/.js/.css` (arquivos novos; reaproveita tokens e o estilo de `profissional-documento.css`), no padrão de `fotos.js` (script clássico, testado em sandbox `vm`), com os estados e textos de 106 §6 **aprovados pela decisão 186**. Estados novos sem texto aprovado (`pdf_protegido`, `pdf_ativo`, `pdf_invalido`, `imagem_invalida`, `imagem_grande_demais`, `nao_cabe_no_limite`, estado do perfil que não aceita envio): texto único e neutro `[PROPOSTA]` ("Não foi possível aceitar este arquivo. Envie outra foto ou outro PDF do documento."), a aprovar (D-14). Redução no navegador: **só quando o bundle `fotos-envio.js` da #141 existir e for reaproveitável**; antes disso o navegador envia o original (≤ 5 MiB) e o servidor reduz, o que já atende CA-01 e a decisão 35 do ponto de vista do armazenamento (a decisão 35 fala em "reduzir no envio"; a banda do navegador só melhora depois). `[NÃO VERIFICADO]` se `FastProFotosEnvio` aceita callbacks de `emitir`/`enviar` genéricos para documentos.

## 9. Produção fechada até a L1 (decisões 171a, R1)

- **Trava 1 (padrão):** a rota só monta com `IDENTITY_DOCS_ENABLED=1` (qualquer outro valor ou ausência ⇒ fechado, em todos os ambientes). Pendências só com nomes, como `faltantesRascunho`.
- **Trava 2 (recomendada, D-10):** com `VERCEL_ENV=production`, mesmo com a variável acima, a rota **continua fechada** a menos que exista também `IDENTITY_DOCS_L1_PARECER=1`, que só se define depois do parecer jurídico L1 sobre retenção. Diferente de A-141-6 (fotos), aqui o dado é C3 (documento) sem prazo nem base legal; um segundo mecanismo é justificado.
- Fechado ⇒ 404 uniforme com os mesmos bytes das demais rotas inexistentes (reuso de `draftNotFound()`), zero chamadas a banco ou Storage.
- Condições de liberação (não se abre a profissional real antes): (1) parecer L1; (2) varredura de §6.5 agendada ou procedimento manual registrado; (3) bucket e migração aplicados no ambiente de destino e conferidos; (4) CA-15 aprovado; (5) leitura da Verificação (#52) e H-102 em pé (senão ninguém lê e os documentos acumulam).

## 10. O que pode ser feito antes da #141 e o que depende dela (decisão 183)

**Antes, sem tocar arquivo compartilhado:**
1. Domínio novo `packages/domain/src/identity-docs/` (constantes, corpo, chaves `s/…`/`i/…`, `validarPdf`, tipos de porta, políticas de cota) com testes.
2. Migração, rollback e `packages/db/tests/identity-docs-h037.dbtest.mjs`.
3. `packages/db/src/identity-docs.ts` (adaptador Pg, `app_system`) e `identity-docs-storage.ts` (adaptadores de entrada e final).
4. `apps/api/src/identity-docs/identity-doc-service.ts`, `identity-doc-sweep.ts` e `identity-doc-route.ts` (função de despacho exportada, testada com servidor `http` em porta 0 e portas falsas, **sem passar por `app.ts`**).
5. `identity-doc-montagem.ts` (`montarDocumentosIdentidade(env, opcoes)` ⇒ `{ options, pendencias }`), testado isoladamente.
6. Página `profissional-documentos.*` e seus testes de sandbox.

**Depois da #141 (e, nos arquivos compartilhados, depois do merge de #43):**
- Montagem em `composicao.ts` (campo `identityDocs`), `vercel.ts` (um `...spread`, usando o `ReduceGate` singleton da #141 e o cliente `app_system`) e `app.ts` (bloco de despacho e 404 uniforme), mais exports nos barris `packages/domain/src/index.ts` e `packages/db/src/index.ts`.
- Prova ponta a ponta com servidor real e Storage de desenvolvimento (CA-01 a CA-05 em ambiente), e a redução no navegador.
- **#50 pode ir a Aguardando aprovação sem a #141 só se o aceite aceitar a montagem como condição explícita** (decisão 183); caso contrário espera.

## 11. Arquivos prováveis a tocar (para o orquestrador checar conflitos)

**Novos (sem conflito esperado):**
- `docs/factory/107-DESENHO-H037.md` (este)
- `supabase/migrations/20261112210000_identity_create_documents.sql` e `supabase/rollbacks/20261112210000_identity_create_documents.down.sql` (conferir o número)
- `packages/domain/src/identity-docs/{constants,body,pdf,keys,ports,index}.ts` e `packages/domain/tests/identity-docs-*.test.ts`
- `packages/db/src/identity-docs.ts`, `packages/db/src/identity-docs-storage.ts`, `packages/db/tests/identity-docs-h037.dbtest.mjs`, `packages/db/tests/identity-docs-storage.test.ts`
- `apps/api/src/identity-docs/{identity-doc-service,identity-doc-sweep,identity-doc-route,identity-doc-montagem}.ts` e `apps/api/tests/identity-docs-*.test.ts` (inclui o teste de R6 e a varredura de rotas)
- `apps/web/public/profissional-documentos.{html,js,css}` e `apps/web/tests/profissional-documentos-*.test.ts`

**Compartilhados (conflito possível, editar só no fim e em blocos separados):**
- `apps/api/src/composicao.ts`, `apps/api/src/vercel.ts`, `apps/api/src/app.ts`, `apps/web/vercel.json` (só se a CSP da página nova exigir; hoje a página de documento do profissional tem a própria; `[NÃO VERIFICADO]`) — **todos modificados na árvore local por outra Issue (#141)**.
- `packages/domain/src/index.ts` e `packages/db/src/index.ts` (barris, também modificados localmente): acrescentar uma linha `export * from './identity-docs/index.js'` em cada, no fim do arquivo.
- `.env.example` (nomes `IDENTITY_DOCS_ENABLED`, `IDENTITY_DOCS_L1_PARECER`, sem valor) e `scripts/check-env-example.mjs` (conferir).
- `apps/web/package.json`/`pnpm-lock.yaml`: **não tocar** (a #141 os altera por causa do esbuild).

**Não tocar (garantia de R6/R7):** `media-quarantine.ts`, `image-type.ts`, `reduce.ts`, `gallery.ts`, `media.ts`, `ports.ts` de `domain/media`, `image-reducer-sharp.ts`, `media-reduce-service.ts`, `app.media_asset` e suas migrações, `RETENTION_BUCKETS`.

## 12. Documentos a corrigir junto da entrega

- `08-ARQUITETURA.md` §5 (linha de `identity-docs`) e `09-MODELO-DADOS.md` §3.3 (sem `media_asset_id`; `analyzed_at`; `status`), §7 (leitura do dono) e §8 (linha 201: "próprio" ⇒ escrita e exclusão pelo dono, sem leitura), conforme a decisão 170a.
- `14-BACKLOG`: H-037 depende também de H-035 (decisão 182) e BLQ-DEC removido (decisão 185).

## 13. Plano de testes (mapa para os CA do refino)

Todos locais: `corepack pnpm check:all` e `db:test` (em série, por último), com contagem e código de saída na Issue. Nada de CI verde presumido. Banco de teste: instância DEV (`npx supabase`), dados criados e limpos pelo próprio teste, sem Docker.

| ID | Prova | CA |
|---|---|---|
| T-01 | Imagem JPG de 4 MiB: emite, `PUT` (Storage falso e, na etapa de ambiente, o de desenvolvimento), finaliza ⇒ `recebido`; objeto em `identity-docs` ≤ 1.280 px e ≤ 750 KB; PNG e WebP viram JPEG; alfa em branco | CA-01 |
| T-02 | PDF de exatamente 2 MiB válido ⇒ `recebido`; objeto com **mesmo tamanho e mesmo SHA-256** do enviado | CA-02, CA-17 |
| T-03 | PDF com 2 MiB + 1 byte: 413 na emissão (declarado) e 413 na finalização (real maior que o declarado); nenhuma linha viva e nenhum objeto no final; imagem declarada com PDF real de 3 MiB ⇒ 413 | CA-03 |
| T-04 | Conjunto: GIF, HEIC, executável com extensão `.jpg`, texto com `Content-Type: image/jpeg`, `%PDF` falso (cabeçalho sem estrutura) ⇒ 415 ou 422 conforme §3, sem linha viva e sem objeto no final | CA-04 |
| T-05 | Cinco vivos ⇒ sexto 422 `limite_documentos`, nada gravado, os cinco intactos (API e SQL); concorrência: duas conexões com 4 vivos ⇒ exatamente 5; insert direto barrado pelo gatilho; `substituido` e marcado para expurgo não contam | CA-05 |
| T-06 | Storage local: `anon`, `authenticated` (inclusive o dono), `service_role` fora da API e admin sem caso não listam, não baixam, não assinam leitura; `storage.objects` sem política para os dois buckets; **varredura de rotas**: só as 5 rotas de §3, nenhum `GET /{id}`; teste estático: `IdentityDocFinalPort` e seu adaptador não têm método de leitura | CA-06, CA-19 |
| T-07 | Bucket via `storage.buckets`: `identity-docs` `public=false`, `file_size_limit=2097152`, mimes só `image/jpeg` e `application/pdf`; `identity-incoming` com os limites de D-1; migração aplicada duas vezes | CA-07 |
| T-08 | Busca estática: nenhum literal de prazo para `identity-docs`; `retention_policy` do bucket desligada; nenhum job de expurgo ativado por #50 | CA-08 |
| T-09 | Com perfil `pendente`, receber documento não muda `verification_status` nem cria/altera `verification_case` (nem existe); nenhuma função da migração atribui `verification_status` | CA-09, RN-10 |
| T-10 | Sentinelas (nome `rg-frente-maria.jpg`, GPS fictício no EXIF, IP, cabeçalho): capturar `console`, `stdout`, `stderr`, corpos e cabeçalhos em sucesso, recusa e falha de Storage; nenhuma sentinela, caminho, `upload_url` ou tamanho exato; corpo com `filename` ⇒ 422; objetos com nome uuid sem extensão | CA-10 |
| T-11 | Relógio injetado: pendente vivo em 30 min − 1 s, vencido em 30 min; `finalize` depois ⇒ 409; nova emissão libera a vaga; `idoc_sweep` + remoção + `purge_done`; falha de Storage deixa a linha marcada; órfão > 3 h na entrada é removido e órfão com linha viva, não | CA-11 |
| T-12 | Profissional B em recurso de A, id alheio, id inexistente, id não uuid, admin, cliente e Verificação sem perfil ⇒ 404 com corpo e cabeçalhos byte a byte iguais; não uuid não toca o banco; sem cookie ⇒ 401 | CA-12, CA-18 |
| T-13 | Perfil em cada estado: aceita em `pendente`, `em_revisao`, `retida_duplicidade`, `recusada`; nega em `aprovada` e `suspensa`; e-mail não verificado nega; estado nunca muda | CA-13 |
| T-14 | Recebimento, recusa por conteúdo e exclusão geram evento na mesma transação, sem nome nem conteúdo; falha injetada em `audit_append` desfaz a ação; `audit_keys_are_clean` para as chaves | CA-14 |
| T-15 | Inspeção visual do QA (RG/CNH sintéticos) após a redução; resultado registrado, não automático | CA-15 |
| T-16 | Cálculo do pior caso (5 × 2 MiB), do típico e do teto de 250.000.000 bytes, registrado no QA e em `external_quota` `[NÃO VERIFICADO]` se a tabela existir | CA-16 |
| T-17 | Porta de envio exercitada: nenhuma chamada de leitura do bucket final; `IdentityDocReaderPort` sem implementação e sem importação em #50 | CA-19 |
| T-18 | Página: cada estado de 106 §6 com o texto aprovado, teclado, `aria-live`, sem `wa.me`; leitor de tela `[NÃO VERIFICADO]` | CA-20 |
| T-19 | **Obrigatório, R6 (documento nunca no bucket de fotos).** (i) Estático: nenhum arquivo de `identity-docs/` em `domain`, `db` e `api` referencia `request-photos`, `MEDIA_REDUCED_BUCKET`, `quarantine`, `MEDIA_BUCKET`, `SupabaseMediaReduceStorage`, `SupabaseQuarantineStorage` ou `media_asset`. (ii) Dinâmico: fluxo completo (imagem e PDF, sucesso, recusa e exclusão) com um `fetchImpl` espião que registra toda URL; todas as chamadas a `/storage/v1/object/…` têm bucket `identity-incoming` ou `identity-docs`, e **nenhuma** `request-photos` ou `quarantine`; o espião falha o teste se aparecer um prefixo `p/` ou `d/`. (iii) Banco: após o fluxo, `app.media_asset` não ganhou linhas. (iv) Inverso: `sweepQuarantine` e `media_sweep` de fotos não enxergam nada de documento (buckets diferentes) e a varredura de documentos não toca objetos de foto. (v) Os arquivos de foto listados em §11 "Não tocar" não aparecem em `git diff` da entrega | R6, R7 |
| T-20 | Cotas: 13ª emissão na hora e 41ª por IP-HMAC ⇒ 429 só com `Retry-After`; consulta não conta; teto global ⇒ 429 neutro; corrida de duas emissões no limite do teto ⇒ no máximo uma aceita | RN-13, RN-15 |
| T-21 | Banco: RLS forçada; `anon/authenticated/service_role/PUBLIC/app_api` sem DML nem execute; execute só `app_system`; `search_path` vazio; rollback recusa com linhas e funciona sem; idempotência | geral |
| T-22 | Validador de PDF: corpus de §6.2 (nome escapado, `/Encrypt`, poliglota, versão inválida, sem `%%EOF`, `/JS` versus `/JSON`, arquivo de 2 MiB em tempo limitado, entrada vazia e de 1 byte sem exceção) | CA-02, CA-04, B2, B3 |
| T-23 | Trava de produção: sem `IDENTITY_DOCS_ENABLED=1` ⇒ 404 uniforme e zero chamadas; com `VERCEL_ENV=production` e sem `IDENTITY_DOCS_L1_PARECER` ⇒ idem; pendências só com nomes (sem valores) | R1, decisão 171 |
| T-24 | Concorrência de finalização: duas chamadas simultâneas ⇒ uma processa, a outra 409 `em_processamento`; repetição depois de `recebido` ⇒ 200 idempotente; exclusão e primeira leitura (simulando `analyzed_at` de #52) serializadas: nunca `deleted` depois de analisado | D-5, F4 |

Cobertura: CA-01 T-01; CA-02 T-02, T-22; CA-03 T-03; CA-04 T-04, T-22; CA-05 T-05; CA-06 T-06; CA-07 T-07; CA-08 T-08; CA-09 T-09; CA-10 T-10; CA-11 T-11; CA-12 T-12; CA-13 T-13; CA-14 T-14; CA-15 T-15; CA-16 T-16; CA-17 T-02; CA-18 T-12; CA-19 T-06, T-17; CA-20 T-18; R6 T-19. Todos os 20 critérios e o risco R6 têm prova.

## 14. Riscos e o que NÃO foi verificado

### 14.1 Riscos

| # | Risco | Tratamento |
|---|---|---|
| R-1 | Varredura de H-026 apagaria documento colocado na quarentena | D-1: buckets próprios; T-19(iv) |
| R-2 | PDF com conteúdo ativo escondido em fluxo comprimido | Heurística + nunca renderizar + entrega como anexo na #52 (§6.2); risco residual aceito |
| R-3 | Poliglota (arquivo que é PDF e outra coisa) | `%PDF-` só no deslocamento 0, `%%EOF` no fim, leitura sem renderização |
| R-4 | Tempo da função ao ler 5 MiB, reduzir e gravar (prazo de 10 s do redutor contra o limite da função) | Mesma lacuna de R-3 de 104; conferir duração máxima da função; polling/nova tentativa do cliente |
| R-5 | `sharp` indisponível em Linux/Vercel | 503 transitório sem rejeitar o documento (comportamento do redutor existente) |
| R-6 | Documentos acumulam sem Verificação | Fora de #50 (R11 do refino); teto de 250 MB protege o Storage |
| R-7 | Sem criptografia de objeto (decisão 181) | Bucket privado, acesso só pela API; risco registrado para a L1 |
| R-8 | Linhas `substituido` retêm objetos sem prazo | Retenção é L1; entram na soma do teto global |
| R-9 | Colisão nos arquivos compartilhados com #141, #43 e #119 | §10 e §11: montagem só depois |
| R-10 | Reducer com constantes globais impede alvo próprio de documento | §6.3: se o CA-15 reprovar, volta ao líder; não se altera o redutor nesta Issue |
| R-11 | Documento de terceiro enviado pelo profissional | Decisão 187: fora de escopo; decide a Verificação |
| R-12 | Conta com perfil `retida_duplicidade` acumula arquivos | Mesmos limites e cotas; decide a Verificação (B11) |

### 14.2 Não verificado

- Execução de qualquer teste, build, `db:test` ou migração; instalação e carga de `sharp` em Linux.
- Concessões atuais de `rl_check`/`rl_hit` a `app_system`; a forma exata das chamadas de `audit_append` e o valor de `actor_role` usado em H-036; nomes dos arquivos de teste de rota existentes que servem de molde.
- Se o `PUT` assinado do Storage aceita `Content-Type` igual ao declarado e se o CORS do Storage deixa a página enviar; validade real do token de envio (R2 de 88).
- Existência e esquema de `external_quota`, `sensitive_access_log` e do papel de Verificação (H-102/#111).
- Estados de #48, #52, #51, #141, #43, #119 e a existência de migrações novas além de `20261112200000`.
- Legibilidade dos documentos reduzidos; leitor de tela e zoom (G-14 de 98).
- Se a CSP/`vercel.json` da página nova precisa de entrada própria.
- Texto integral de `93-DESENHO-H027.md`, `82-DESENHO-H109.md`, `57-REFINO-H073.md` e dos testes de mídia (lidos apenas por trechos e pelo código).

## 15. Perguntas abertas (para o líder; numeração local D-H037-n; nenhuma foi feita ao usuário)

- **D-H037-1 Bucket de entrada próprio.** (a) `identity-incoming` separado, com varredura própria; (b) reaproveitar `quarantine` (inviável: PDF recusado pelo bucket e objeto apagado pela varredura de fotos); (c) prefixo dentro de `identity-docs` (quebra CA-07). **Recomendação: (a).** Destrava migração e adaptadores.
- **D-H037-2 Linha de recusa.** Recusa por conteúdo só é conhecida depois do envio; a linha existe até o objeto de entrada sair. (a) Reinterpretar "sem linha" de CA-03/CA-04 como "sem linha viva e sem objeto no final", com a linha removida em seguida pelo `purge_done`; (b) manter linha `recusado` para histórico. **Recomendação: (a)** (a auditoria guarda o fato). Destrava T-03/T-04.
- **D-H037-3 E-mail verificado.** Exigir e-mail verificado para enviar documento, como H-035 exige para cadastrar o CPF/CNPJ? (a) sim; (b) não. **Recomendação: (a)** (protege o Storage de contas descartáveis). Destrava `idoc_issue`.
- **D-H037-4 CPF/CNPJ já cadastrado.** Exigir o documento de H-035 cadastrado antes de aceitar arquivo? (a) não, ordem livre; (b) sim. **Recomendação: (a)**, menos atrito; a Verificação cruza depois. Destrava `idoc_issue`.
- **D-H037-5 Regra de substituição.** (a) ao primeiro documento recebido com perfil `recusada`, os documentos **já analisados** viram `substituido` e liberam vaga; os não analisados continuam vivos; (b) substituição só manual por exclusão. **Recomendação: (a).** Destrava RN-05/RN-09 e T-05.
- **D-H037-6 Auditoria de recusa na emissão.** Recusas por corpo/tipo declarado (antes de existir objeto) entram na auditoria encadeada? (a) não, só contador; auditar recusas por conteúdo, por limite e por estado do perfil; (b) auditar todas. **Recomendação: (a)** (evita encher a cadeia com lixo; a cota de IP já limita). Destrava T-14.
- **D-H037-7 Trava dupla em produção.** (a) `IDENTITY_DOCS_ENABLED` e, em produção, também `IDENTITY_DOCS_L1_PARECER`; (b) só a primeira. **Recomendação: (a)** (R1, dado C3, decisão 171). Destrava T-23 e `.env.example`.
- **D-H037-8 Teto global em bytes.** (a) 250.000.000 bytes sob trava consultiva; (b) contagem fixa de documentos (ex.: 150). **Recomendação: (a)** (reflete o Storage real; 09 §9). Confirma a decisão 189.
- **D-H037-9 Conta sem perfil.** Conta de cliente, admin ou Verificação chamando a rota: (a) 404 uniforme, como pedem CA-12 e CA-18; (b) 403 `sem_perfil`, como H-036. **Recomendação: (a).** Destrava T-12.
- **D-H037-10 Hash do conteúdo.** Guardar `content_sha256` em `identity_document`, nunca exposto, para integridade e para a #52 conferir? (a) sim; (b) não. **Recomendação: (a).** Destrava T-02 e o esquema.
- **D-H037-11 Redução no navegador.** (a) entregar #50 com redução só no servidor e acrescentar a do navegador quando o bundle da #141 existir; (b) esperar a #141. **Recomendação: (a)** (coerente com a decisão 183). Destrava a ordem de §10.
- **D-H037-12 Lista de nomes ativos do PDF.** (a) lista de §6.2, sem `/OpenAction` nem `/AA`; (b) incluir `/OpenAction` e `/AA` (mais seguro, mais falsos positivos em PDF de escâner e de editor). **Recomendação: (a)**, revisada por Reviewer e Architect (decisão 177). Destrava T-22.
- **D-H037-13 Unidades.** "5 MB" e "2 MB" foram implementados como 5 MiB (5.242.880) e 2 MiB (2.097.152), coerente com `MEDIA_MAX_BYTES` = 10.485.760. Aceitar? **Recomendação: sim.** Destrava CA-03.
- **D-H037-14 Textos novos da tela.** Aprovar o texto único para recusa por conteúdo ("Não foi possível aceitar este arquivo. Envie outra foto ou outro PDF do documento.") e o do estado do perfil que não aceita envio. **Recomendação: aprovar.** Destrava T-18.
- **D-H037-15 Contrato com a #52.** Incluir no refino/desenho da #52 as exigências de §7 (gravar `analyzed_at` na leitura, `attachment`/`nosniff`, `sensitive_access_log`)? **Recomendação: sim**, para a exclusão do dono e a análise não se cruzarem. Destrava o fechamento de F4.
- **D-H037-16 Correção de 08/09/14.** Autorizar a atualização de 08 §5, 09 §3.3/§7/§8 e 14-BACKLOG listada em §12 como parte da entrega de #50? **Recomendação: sim.**

## 16. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\107-DESENHO-H037.md`
- **Commit:** feito pelo Architect com `git add docs/factory/107-DESENHO-H037.md` e `git commit -m "docs(H-037): desenho dos documentos de identidade (#50)" -- docs/factory/107-DESENHO-H037.md`; o SHA está no relatório ao líder. Nenhum outro arquivo foi alterado.
