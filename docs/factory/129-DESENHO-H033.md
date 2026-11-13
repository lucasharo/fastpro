# Desenho técnico H-033 — Opt-in de telefone e WhatsApp no pedido (Issue #46)

- **Issue:** #46 `[E3] Opt-in de telefone no pedido` · **História:** H-033 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `128-REFINO-H033.md` (CA-01 a CA-18, R1 a R15), `11-DECISOES.md` Rodada 95 (427 a 442, 444, 445 adotadas; 439 = dono do registro de revelação é a #121; 443 texto v1 de desenvolvimento; 446 adiada), `127-DESENHO-H032.md` (padrão da #45: cifra, funções `private`, 404 uniforme, listas fechadas), `09-MODELO-DADOS.md` (§3.4, §3.8, tabela de classes: telefone = C3), `ls supabase/migrations` e buscas por `phone` e por tabela de aceite nas migrações.
- **Etiquetas:** `[DECIDIDO n]` · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§13).

## 0. Achados da leitura que mudam o refino

1. `[VERIFICADO]` **Não existe coluna de telefone no código.** Nenhuma migração cria `phone_enc` nem `phone_share_opt_in` em `request_draft` ou `service_request` (a busca por `phone` só acha as migrações de auditoria). O `09` §3.4 descreve as colunas, mas a #43 e a #44 não as implementaram. O desenho **não usa o rascunho** (§6) e cria `phone_enc` só em `service_request`. `[PERGUNTA 449]`.
2. `[VERIFICADO]` **Não existe tabela de aceite** (E6). A busca por tabela de aceite só acha a migração de exclusividade de papéis, que não é isso. Logo "aceite ativo" não pode ser lido do banco hoje. O desenho isola a regra em **uma função de guarda** (`private.request_acceptance_active`), fechada por padrão, que a história de aceite substitui. `[PERGUNTA 448]`.
3. `[VERIFICADO]` Última migração existente: `20261113230000_requests_expand_location_visibility.sql` (M1 da #45). A Rodada 94 reserva `20261113240000` para a M2 da #45. A #46 usa **`20261113250000`** (maior que as duas). O DEV reconfere com `ls supabase/migrations | tail -3`.
4. `[VERIFICADO]` A #45 já deixou aplicadas `private.request_visibility_guard` (verificação aprovada e conta ativa) e o padrão de cifra `address-crypto.ts`. A #46 **reutiliza a guarda** e **repete o formato da cifra** com chave própria.
5. `[DECIDIDO 439]` O dono do registro de revelação é a #121 (H-112). Como o telefone precisa do registro para ser revelado, o desenho cria a tabela **exatamente no contrato do `09` §3.8** e a #121 só estende por expansão (§4.3). `[PERGUNTA 447]` pede a confirmação desta leitura.
6. `[VERIFICADO]` Existe um mecanismo de autenticação recente só para o administrador (`apps/api/src/admin-step-up-route.ts`). Para o cliente, `[NÃO VERIFICADO]`. `[PERGUNTA 450]`.

## 1. Decisões de arquitetura

| # | Decisão | Alternativa recusada | Motivo |
|---|---|---|---|
| D-01 | **Uma migração expansiva** (`contact_create_phone_consent`): coluna `service_request.phone_enc`, duas tabelas novas, funções `private`. Sem contração. | Duas fases como na #45 | Nada em claro a remover; só se acrescenta |
| D-02 | **A API cifra** (AES-256-GCM, `node:crypto`); o banco guarda só `bytea`. Chave **`PHONE_ENC_KEY`**, separada de `ADDRESS_ENC_KEY` `[DECIDIDO 438]`. | `pgcrypto`; reusar a chave do endereço | Chave e dado no mesmo lugar anulam a cifra; separar permite girar uma sem afetar a outra |
| D-03 | **AAD = `ph1|<request_id>`** (id do pedido, imutável). | AAD = id do rascunho | O telefone não passa pelo rascunho (D-05); o id do pedido já é gerado pela API na #45 |
| D-04 | **Regra de revelação em uma função de banco** (`private.contact_reveal_phone`) que confere, na mesma transação, guarda de visibilidade, pedido aberto, aceite ativo, consentimento ativo e grava o log. A API nunca decide sozinha. | Decidir na API e só gravar o log | Concorrência: a revogação e a revelação disputam a mesma linha; a transação do banco fecha a janela |
| D-05 | **O telefone não passa pelo rascunho.** Ele chega no corpo da publicação (campos aditivos) e é anexado ao pedido logo depois do `commit`, por função idempotente. `[PERGUNTA 449]` | Colunas no rascunho (`09` §3.4) | Evita segundo armazenamento cifrado, retenção de 30 dias do rascunho e edição da #43 |
| D-06 | **Revelação por `POST`** (nunca `GET`): não é pré-carregada nem armazenada em cache; resposta `no-store`. | `GET` | Navegador e proxy podem repetir `GET`; a revelação grava log |
| D-07 | **Negativa uniforme.** Elegível sem aceite, aceito sem consentimento, outro pedido, pedido fechado, retirado e chave ausente respondem com a **mesma** constante de 404 da #45 (`pedido_nao_encontrado`). A única resposta diferente é 429, e só depois de passar em todas as conferências (não vaza nada a quem não tem direito). | 403 com motivo | Não revelar a existência do telefone nem o estado do consentimento |
| D-08 | **R9 imposta no banco por gatilho**: trocar ou apagar `phone_enc` revoga as liberações ativas do pedido, na mesma transação. | Só na função/API | Nenhuma via contorna (CA-13) |
| D-09 | **Registros imutáveis para fora**: consentimento só ganha `revoked_at` (uma vez); registro de revelação só recebe `insert`. `DELETE`, `TRUNCATE` e demais `UPDATE` recusados por gatilho. | Apagar na revogação | Prova do que foi aceito e revelado (R-L2); histórico preservado (R6, CA-08, CA-09) |
| D-10 | **Texto do consentimento versionado no código** (`CONTACT_CONSENT_TEXT_V1`, `text_version = 'v1'`) `[DECIDIDO 443]`; o banco guarda só a versão. | Gravar o texto por linha | Texto e versão ficam rastreáveis pelo Git; linha pequena |

## 2. Visão geral do fluxo

```
Publicação (#44/#45, alterada de forma aditiva):
  corpo ganha phone? e sharePhone? (padrão false)
  -> begin, geocodifica, commit_enc (iguais)
  -> se phone presente: API normaliza (+55), cifra (AAD = request_id), chama request_phone_attach
       (grava phone_enc; se sharePhone = true cria contact_consent todos_participantes, via formulario_pedido, text_version v1)

Revelação:  POST /v1/pro/requests/:id/phone/reveal
  -> sessão de profissional -> contact_reveal_phone (guarda, aberto, aceite ativo, consentimento ativo, limite, log)
  -> API decifra -> { phone } no-store     | qualquer recusa = 404 uniforme (429 só após autorizado)

Liberação individual / revogação / troca do telefone: rotas do dono (§6), com autenticação recente.
```

O telefone em claro existe apenas na memória da API (publicação, troca, revelação e leitura do próprio dono para republicar). Nunca em log, auditoria, e-mail, mensagem automática, lista ou erro.

## 3. Cifra de `phone_enc` (CA-03, CA-16, R11, R12)

- **Arquivo:** `apps/api/src/contact/phone-crypto.ts`. Fábrica `createPhoneVault(rawKey: string)` devolve `{ seal(e164, requestId): Buffer; open(blob, requestId): string }`.
- **Chave:** `PHONE_ENC_KEY`, **mínimo 32 caracteres**. Chave AES de 32 bytes derivada por HKDF-SHA-256 (`ikm` = UTF-8 da variável, `salt` = `fastpro-phone-v1`, `info` = `service_request.phone_enc`). Ausente ou curta = configuração inválida.
- **Algoritmo:** AES-256-GCM, nonce aleatório de 12 bytes por gravação, tag de 16 bytes. **AAD** = `ph1|<request_id>`. Entrada já normalizada em E.164 (`+55` mais DDD e 8 ou 9 dígitos).
- **Blob (`bytea`):** `[1 byte versão = 1][12 nonce][16 tag][texto cifrado]`, igual ao `address-crypto.ts`. O byte de versão reserva rotação futura, sem rotação agora.
- **Falha fechada:** `open` com outro `request_id`, byte alterado, versão desconhecida ou chave diferente lança erro fixo `telefone_indisponivel`; a revelação responde o 404 uniforme (D-07) e **não** devolve nada. Sem a chave, as rotas de contato **não são montadas** (padrão da casa) e a publicação com telefone responde 503 `telefone_indisponivel` **antes** de abrir o banco (publicação sem telefone segue normal).
- **Variável nova:** `PHONE_ENC_KEY=` em `.env.example` **sem valor** `[DECIDIDO 438]`. Nos testes, a chave é constante do próprio arquivo de teste; o DEV não lê nem imprime `.env.local`.

## 4. Dados: migração e reversão

### 4.1 Arquivos `[PROPOSTA]`
- **Migração:** `supabase/migrations/20261113250000_contact_create_phone_consent.sql`.
- **Reversão:** `supabase/rollbacks/20261113250000_contact_create_phone_consent.down.sql`.
- **Aplicação:** `npx supabase`, nunca pelo MCP. Idempotente (`if not exists`, `create or replace`, `drop ... if exists`). O DEV reconfere o prefixo ao criar (maior que qualquer existente, inclusive a M2 da #45).

### 4.2 Conteúdo, na ordem
1. **Guarda de pré-requisito** no molde da #45: existem `app.service_request` (colunas `id, customer_user_id, status, acceptance_deadline_at`), a função `private.request_visibility_guard` e a tabela de perfil de profissional; senão `raise exception 'contato_pre_requisito_ausente'`.
2. **`app.service_request.phone_enc bytea` nulo** com `service_request_phone_enc_ck`: `phone_enc is null or (octet_length(phone_enc) between 30 and 128 and get_byte(phone_enc, 0) = 1)`.
3. **`app.contact_consent`** (contrato do `09` §3.8):
   - `id uuid pk default gen_random_uuid()`, `request_id uuid not null` (FK `app.service_request`, `on delete restrict`), `kind text not null check (kind = 'telefone')`, `scope text not null check (scope in ('todos_participantes','profissional'))`, `professional_id uuid null` (FK para o perfil de profissional `[NÃO VERIFICADO: nome da tabela, o DEV confere]`), `granted_at timestamptz not null`, `granted_via text not null check (granted_via in ('formulario_pedido','chat'))`, `text_version text not null check (text_version ~ '^v[0-9]{1,3}$')`, `revoked_at timestamptz null`.
   - **Coluna a mais, `[PROPOSTA]` (fora do `09`):** `revoked_reason text null check (revoked_reason in ('cliente_geral','cliente_individual','telefone_alterado','telefone_apagado'))`, preenchida junto com `revoked_at`. Serve à prova e à tela do dono. `[PERGUNTA 451]` não é necessária: é aditiva e pode ser descartada pelo líder.
   - Restrições: `(scope = 'profissional') = (professional_id is not null)`; `revoked_at is null or revoked_at >= granted_at`; `(revoked_at is null) = (revoked_reason is null)`; `granted_via = 'formulario_pedido'` só com `scope = 'todos_participantes'`.
   - Únicos parciais: `(request_id) where scope = 'todos_participantes' and revoked_at is null` e `(request_id, professional_id) where scope = 'profissional' and revoked_at is null`. Índice `(request_id)`.
4. **`app.contact_reveal_log`** (contrato do `09` §3.8, ver §4.3): `id uuid pk default gen_random_uuid()`, `request_id uuid not null` (FK, `restrict`), `professional_id uuid not null`, `kind text not null check (kind in ('telefone','endereco'))`, `consent_id uuid null` (FK `contact_consent`; qual consentimento autorizou), `at timestamptz not null`. Índices `(request_id, at)` e `(professional_id, at)`. **Sem coluna de valor**: o número nunca é gravado.
5. **Gatilhos (definer, `search_path = ''`):**
   - `contact_consent_bu`: antes de `update`, só `revoked_at` e `revoked_reason` podem mudar, uma única vez (de nulo para valor); qualquer outra coisa = `23514 consentimento_imutavel`. `delete` e `truncate` recusados.
   - `contact_reveal_log_bu`: `update`, `delete` e `truncate` recusados (`23514 log_somente_insercao`).
   - `service_request_phone_au` (depois de `update of phone_enc` em `service_request`): se `phone_enc` mudou (inclusive para nulo), revoga todas as linhas ativas de `contact_consent` do pedido com `revoked_reason = 'telefone_alterado'` ou `'telefone_apagado'`. É a barreira de R9/CA-13. `[NÃO VERIFICADO]` o DEV confere o gatilho `service_request_endereco_bu` da #45: ele só deve olhar `address_text(_enc)` e `public_label`; se comparar a linha inteira, ajusta para não bloquear `phone_enc`.
6. **Funções `private`** (todas `security definer`, `set search_path = ''`, `set lock_timeout = '5s'`, erro fixo, nenhuma devolve o número em claro, o banco nunca o vê):
   - `private.request_acceptance_active(p_request_id uuid, p_professional_id uuid) returns boolean`. **Corpo `select false`** (fechada) com comentário "a história de aceite (E6) substitui por `create or replace`". `[PERGUNTA 448]`.
   - `private.request_open_for_contact(p_request_id uuid, p_now timestamptz) returns boolean`: pedido existe e **não** está concluído, cancelado ou expirado (R13/CA-15). `[NÃO VERIFICADO]` os nomes exatos dos estados em `service_request_status_ck`; o DEV os lê. Concluído/cancelado/expirado negam no mesmo instante, sem carência `[DECIDIDO 430]`.
   - `private.request_phone_attach(p_user uuid, p_request_id uuid, p_phone_enc bytea, p_grant boolean, p_text_version text, p_now timestamptz)` → `(out_state text)` com valores `consentimento_ativo | sem_consentimento | ja_definido | pedido_inexistente`. Trava a linha (`for update`), confere dono, exige `phone_enc` ainda nulo (senão `ja_definido`, sem alterar: idempotência), grava `phone_enc` e, se `p_grant`, insere o consentimento geral (`formulario_pedido`).
   - `private.request_phone_replace(p_user uuid, p_request_id uuid, p_phone_enc bytea, p_now timestamptz)` → `(out_state text)`: dono; `p_phone_enc` nulo apaga; o gatilho revoga as liberações. Não cria consentimento (R9: número novo exige nova marcação).
   - `private.contact_consent_grant_professional(p_user uuid, p_request_id uuid, p_professional_id uuid, p_text_version text, p_now timestamptz)` → `(out_state text)` com `liberado | ja_liberado | coberto_pelo_geral | sem_telefone | sem_aceite | pedido_fechado | pedido_inexistente`. Exige `phone_enc` não nulo, pedido aberto e `request_acceptance_active` verdadeiro (RF-138: só com aceite ativo; antes do aceite, recusa). Grava `scope='profissional'`, `granted_via='chat'`.
   - `private.contact_consent_revoke(p_user uuid, p_request_id uuid, p_professional_id uuid, p_now timestamptz)` → `(out_revoked integer, out_state text)`: `p_professional_id` nulo = revogação **geral** (revoga o consentimento geral e **todos** os individuais ativos `[DECIDIDO 431]`, motivo `cliente_geral`); preenchido = só a liberação individual daquele profissional `[DECIDIDO 432]`, motivo `cliente_individual`. Se o profissional só está coberto pelo consentimento geral, devolve `exige_revogar_geral` sem alterar. `[PERGUNTA 452]`. Revogar o que já está revogado devolve 0 (idempotente).
   - `private.contact_reveal_phone(p_professional_id uuid, p_request_id uuid, p_now timestamptz)` → `(out_phone_enc bytea, out_limited boolean)`. Ordem: (1) `request_visibility_guard` da #45; (2) pedido aberto; (3) `request_acceptance_active`; (4) existe consentimento ativo (geral, ou individual deste profissional) e `phone_enc` não nulo; (5) limite de leituras (§7); (6) insere em `contact_reveal_log` e devolve o blob. Falha em 1 a 4 = **zero linhas**. Falha em 5 = uma linha com `out_limited = true` e blob nulo. A leitura do pedido usa `for share` para não correr contra a revogação.
   - `private.contact_available_professional(p_professional_id uuid, p_request_id uuid, p_now timestamptz) returns boolean`: mesmas conferências 1 a 4, **sem** log e sem blob; serve ao botão "ver telefone". Falso é igual para "sem aceite" e "sem consentimento" (nada vaza).
   - `private.contact_owner_status(p_user uuid, p_request_id uuid)` → linhas `(out_phone_present boolean, out_consent_id uuid, out_scope text, out_professional_id uuid, out_granted_at timestamptz, out_granted_via text, out_revoked_at timestamptz, out_revoked_reason text)`; zero linhas se não é do dono. Sem `phone_enc`.
   - `private.request_phone_owner_get(p_user uuid, p_request_id uuid) returns bytea`: só o dono lê o próprio blob (usado na republicação, `[DECIDIDO 440]`). Não grava log de revelação (não é revelação a terceiro).
7. **Privilégios:** `revoke all on function ... from public, anon, authenticated, service_role, app_api, app_backup_reader` e `grant execute ... to app_system` somente. Tabelas: RLS habilitada e **forçada**, sem política, nenhum grant (padrão da #44/#45).
8. **Sem dado, sem agendamento, sem `cron`.** Nenhuma coluna existente muda de tipo. `request_owner_get`, `request_detail_professional` e `request_publish_commit_enc` da #45 **não são editadas** (a lista fechada do profissional segue sem telefone, `127` RN-10).

### 4.3 Contrato único com a #121 (sem duplicar) `[PERGUNTA 447]`
- A #46 cria `app.contact_reveal_log` e `app.contact_consent` com o contrato acima. O `kind` do log já aceita `'endereco'` para a #121 não precisar alterar a restrição.
- A #121 **não recria** a tabela: grava `kind = 'endereco'` pelo mesmo contrato, e só acrescenta colunas se precisar (expansão). A função de insert do log é interna a `contact_reveal_phone`; a #121 cria a sua para endereço, usando a mesma tabela.
- `address_share` continua da #45/#121 (fora desta história).

### 4.4 Reversão
`...down.sql` remove, nesta ordem: gatilhos, funções, `contact_reveal_log`, `contact_consent`, CHECK e coluna `phone_enc`. **Recusa** (`rollback_recusado_com_dados`) se existir linha em `contact_consent`, em `contact_reveal_log` ou `phone_enc` não nulo (perderia prova e dado); com `set app.rollback_force = '1'` passa. Recusa se a #121 já tiver gravado `kind = 'endereco'` no log.

## 5. Domínio, adaptador e API (nomes de arquivo; barris só listados)

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Domínio | `packages/domain/src/contact/phone.ts` (**novo**) | `normalizePhoneBr(input): string \| null` (E.164 `+55`, DDD e 8 ou 9 dígitos, sem texto livre), `maskForLog` (não usado em resposta) |
| Domínio | `packages/domain/src/contact/consent.ts` (**novo**) | `CONTACT_CONSENT_TEXT_V1`, `CONTACT_CONSENT_VERSION = 'v1'`, tipos de escopo e origem, `canRevealPhone({ visible, open, accepted, consentActive, phonePresent })` função pura (oráculo dos testes) |
| Domínio (barril, só listar) | `packages/domain/src/contact/index.ts`, `packages/domain/src/index.ts` | reexportar |
| Adaptador Pg | `packages/db/src/contact-consent.ts` (**novo**) | `PgContactStore`: `attachPhone`, `replacePhone`, `grantProfessional`, `revoke`, `revealPhone`, `availableForProfessional`, `ownerStatus`, `ownerPhone`; SQL em constantes; erro fixo `contato_banco_falhou` |
| Barril db (só listar) | `packages/db/src/index.ts` | reexportar |
| API cifra | `apps/api/src/contact/phone-crypto.ts` (**novo**) | §3 |
| API serviço | `apps/api/src/contact/contact-service.ts` (**novo**) | casos de uso, sem HTTP; usa cifra, normalização e adaptador |
| API rota | `apps/api/src/contact/contact-route.ts` (**novo**) | as rotas de §6, cabeçalhos, 404 uniforme |
| API composição | `apps/api/src/contact/contact-composicao.ts` (**novo**) | exige `PHONE_ENC_KEY`, `DATABASE_URL_APP_SYSTEM`, sessões e autenticação recente; sem chave = não monta |
| API publicação (**alterados, mesma superfície da #45**) | `apps/api/src/requests/publish-service.ts`, `apps/api/src/requests/publish-composicao.ts` | corpo aditivo `phone?`, `sharePhone?`; chamada a `attachPhone` após o `commit`; falha do `attach` não desfaz a publicação (o dono repete pela rota de troca) |
| Adaptador publicação (**alterado**) | `packages/db/src/request-publish.ts` | só se o hash do corpo (`p_body_hash`) tiver de incluir os campos novos `[NÃO VERIFICADO]`, §10 |
| Montagem (só listar) | `apps/api/src/app.ts`, `apps/api/src/index.ts` | registrar as rotas de contato |
| Ambiente | `.env.example` | linha `PHONE_ENC_KEY=` sem valor |

## 6. Rotas (nível de contrato)

Todas: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, sem CORS, `:id` uuid (inválido = 404 uniforme), sessão obrigatória (ausente = 401 `sessao_necessaria`). Prefixos conferidos pelo DEV com os `professional-*-route.ts`, como na decisão 424.

| Rota | Papel | Corpo | Resposta |
|---|---|---|---|
| `POST /v1/pro/requests/:id/phone/reveal` | profissional | vazio | 200 `{ "phone": "+55..." }`; 404 uniforme; 429 `{ "code": "limite_de_leituras" }` |
| `GET /v1/pro/requests/:id/contact` | profissional | | 200 `{ "phoneAvailable": boolean }`; 404 uniforme |
| `GET /v1/requests/:id/contact` | dono | | 200 `{ phonePresent, consents: [{ scope, professionalId?, grantedAt, grantedVia, revokedAt?, revokedReason? }] }` |
| `PUT /v1/requests/:id/phone` | dono, **autenticação recente** | `{ "phone": string \| null }` | 204; apagar/trocar revoga as liberações; 401 `step_up_required` |
| `POST /v1/requests/:id/contact/consents` | dono, **autenticação recente** | `{ "professionalId": uuid }` | 201 / 200 (`ja_liberado`); 409 `sem_aceite`, `sem_telefone`, `pedido_fechado`; 401 `step_up_required` |
| `POST /v1/requests/:id/contact/revoke` | dono, **autenticação recente** | `{ "professionalId"?: uuid }` | 200 `{ "revoked": n }`; 409 `exige_revogar_geral`; 401 `step_up_required` |
| `GET /v1/requests/:id/phone` | dono | | 200 `{ "phone": "+55..." }` (só para pré-preencher a republicação) |

- **Publicação:** `POST` de publicação da #44 ganha campos opcionais `phone` e `sharePhone` (padrão `false`). A resposta 201 de 4 chaves **não muda**. `sharePhone = true` sem `phone` = 400 `telefone_necessario` (CA-02).
- **Recusas do profissional:** o corpo e os cabeçalhos do 404 são **idênticos byte a byte** ao 404 da #45 (constante compartilhada), inclusive para id mal formado.
- **Logs:** nenhum log com telefone, blob, `id` de pedido junto de `id` de usuário ou texto de exceção do driver.
- **Revelação não é cacheável nem repetível por navegador** (`POST`, `no-store`).

## 7. Limite de leituras (`[DECIDIDO 442]`, números `[PROPOSTA]`)
Dentro de `contact_reveal_phone`, depois de autorizar: **no máximo 10 revelações por (pedido, profissional) em 10 minutos** e **60 por profissional em 1 hora**, contadas em `contact_reveal_log`. Estouro = `out_limited = true` → 429 `limite_de_leituras`, sem gravar nova linha. Sem tabela nova. Reavaliar em H-055.

## 8. Plano de testes (locais, sintéticos, marcador `H033`)

Padrão: `*.test.ts` (unidade/rota) e `*.dbtest.mjs` (Postgres real). Evidência: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test`, registrados na Issue. Sem serviço externo, sem SMS ou WhatsApp, sem e-mail. Testes de banco que dependem de aceite **substituem `private.request_acceptance_active` dentro de uma transação revertida** (`create or replace`, depois `rollback`), de modo que a função real permanece fechada. `[PERGUNTA 448]`.

Arquivos: `packages/domain/tests/contact-phone.test.ts`, `packages/domain/tests/contact-consent.test.ts`, `apps/api/tests/contact-phone-crypto.test.ts`, `apps/api/tests/contact-route.test.ts`, `apps/api/tests/contact-publish.test.ts`, `packages/db/tests/contact-h033.dbtest.mjs`, `packages/db/tests/contact-migration.test.mjs` (estático: nomes, `revoke/grant`, ordem, prefixo, ausência de coluna de valor no log).

| # | Teste | CA |
|---|---|---|
| T-01 | `normalizePhoneBr`: 12 entradas (com máscara, sem DDD, com 8 e 9 dígitos, `+55`, letras, vazio) para E.164 ou nulo; idempotente | CA-02, R15 |
| T-02 | Publicação com telefone e sem marcar: `phone_enc` gravado, **zero** linhas em `contact_consent` | CA-01 |
| T-03 | `sharePhone = true` sem `phone` recusado 400 e nada criado; sem telefone, nenhuma linha de consentimento possível (CHECK de `granted_via`, gatilho e função) | CA-02 |
| T-04 | Publicação com `sharePhone = true`: uma linha com `kind='telefone'`, `scope='todos_participantes'`, `granted_via='formulario_pedido'`, `text_version='v1'`, `granted_at`; varredura do valor de todas as colunas de `contact_consent`, do log e de `phone_enc` pelo número sentinela: zero ocorrências em claro | CA-03, CA-16 |
| T-05 | Elegível sem aceite (guarda real fechada): `reveal` e `contact` = 404 uniforme e **idênticos** aos de pedido inexistente, id inválido e outro pedido; log sem linha | CA-04, CA-07 |
| T-06 | Com guarda substituída (aceite ativo) e consentimento ativo: `reveal` devolve o número igual ao informado, grava **uma** linha no log (profissional, pedido, `kind`, `at`, `consent_id`) e o log não contém o número | CA-05 |
| T-07 | Aceite ativo sem consentimento: 404 uniforme; `phoneAvailable = false` igual a "sem aceite" | CA-06 |
| T-08 | Profissional de outro pedido; administrador sem caso (sem função nem rota para admin); `app_api`, `anon` e `authenticated` sem `select` direto em `phone_enc`, `contact_consent`, `contact_reveal_log` | CA-07 |
| T-09 | Retirada e remoção por segurança: com a guarda substituída devolvendo falso depois de revelar, a próxima revelação é negada e o histórico do log permanece. **Prova da regra real fica com E6**, declarada na Issue | CA-08 |
| T-10 | Revogação geral: `revoked_at` e `revoked_reason='cliente_geral'` preenchidos, próxima revelação negada, linhas antigas do log intactas, individuais ativas também revogadas; gatilho recusa `update` de outra coluna e segunda revogação | CA-09 |
| T-11 | Duas liberações individuais: revogar uma mantém a outra revelando; revogar quem só está coberto pelo geral devolve `exige_revogar_geral` | CA-10 |
| T-12 | Liberação individual no chat: com aceite, cria `scope='profissional'`, `granted_via='chat'`; sem aceite, 409 `sem_aceite`; sem telefone, 409 `sem_telefone`; repetir = idempotente | CA-11 |
| T-13 | Republicação: novo pedido nasce sem consentimento, mesmo com telefone pré-preenchido pela rota do dono; nenhuma cópia de `contact_consent` (contagem) | CA-12 |
| T-14 | Trocar e apagar o telefone: o gatilho revoga as liberações (`telefone_alterado` e `telefone_apagado`), inclusive por `update` direto feito pelo teste no banco; número novo não revela sem nova marcação | CA-13 |
| T-15 | Varredura de padrão de telefone brasileiro e do sentinela em: corpos de lista, `GET /v1/pro/requests/:id` (#45), `request_detail_professional`, corpos de erro (400 a 503), saída de log capturada, `audit.audit_event` e mensagens de exceção; zero ocorrências fora do corpo da revelação e da rota do dono | CA-14 |
| T-16 | Relógio controlado: concluído, cancelado e expirado negam a revelação no mesmo instante (`now` injetado), sem carência | CA-15 |
| T-17 | Cifra: round-trip (vários números, 13 e 14 caracteres); `open` com AAD de outro pedido, byte alterado, versão 2 e chave errada falham com erro fixo; leitura direta do `bytea` não contém o número nem sua forma sem máscara | CA-16 |
| T-18 | Chave ausente ou curta: rotas de contato não montadas, `PHONE_ENC_KEY` listada em `pendencias`, publicação com telefone responde 503 antes do banco e **nada** é criado; publicação sem telefone segue 201 | CA-16 |
| T-19 | Autenticação recente: `PUT phone`, liberar e revogar sem ela dão 401 `step_up_required`; com ela passam | CA-17 |
| T-20 | Limite: 11 revelações em 10 min = 429 na 11ª, sem linha nova; quem não tem direito recebe 404, nunca 429 | CA-04, R10 |
| T-21 | Migração: aplicar duas vezes (idempotência); `db:test` antes e depois; prefixo maior que qualquer existente; `.down.sql` recusa com dados e passa vazio; catálogo (`pg_proc`): nenhuma função devolve coluna chamada `phone`/`email`; `contact_owner_status` e `contact_available_professional` não têm saída de blob | CA-18 |
| T-22 | Concorrência: revogação e revelação simultâneas (20 conexões): nenhuma revelação autorizada depois do commit da revogação; `attach` repetido com a mesma chave = estado `ja_definido`, sem segunda linha | CA-09, CA-13 |
| T-23 | Fechamento: `corepack pnpm check:all` e `db:test` locais; contagem e código de saída na Issue; sem declarar CI | CA-18 |

## 9. Segurança e privacidade

1. **Falha fechada em três camadas:** guarda de aceite fechada por padrão, chave ausente fecha a rota, erro de decifragem não devolve nada.
2. **IDOR:** toda função recebe o par (sessão, dono) ou (profissional, pedido) e devolve zero linhas na falta de qualquer condição; 404 uniforme (D-07).
3. **Dado C3:** `phone_enc` só em `service_request`, cifrado; nunca em view, log, cache, auditoria, evento, e-mail ou mensagem automática. Corpo de evento sem PII (`08`).
4. **Prova:** consentimento e revelação imutáveis (D-09); `text_version` e `granted_at` provam o que foi aceito (R-L2). O texto v1 é `[PENDENTE JURÍDICO]` antes de produção `[DECIDIDO 443]`.
5. **Banco:** RLS forçada, sem política, execução só `app_system`, `definer` com `search_path = ''`.
6. **Raspagem:** limite de leituras (§7) e `POST` sem cache.
7. **Cópia fora da plataforma:** irrevogável; o aviso do texto v1 e da tela cobre (R-L3). Sem aviso ao profissional na revogação `[DECIDIDO 444]`.
8. **Fora do desenho `[DECIDIDO 446 adiada]`:** exclusão e prazo de retenção do telefone e do log; o corte de acesso no fim do pedido existe (CA-15), a exclusão não.
9. **Admin:** sem função nem rota de leitura nesta história; a regra de caso autorizado `[DECIDIDO 441]` fica com a história do caso de acesso (`[PERGUNTA 453]`).

## 10. Impacto e ordem de execução (#45)

**Superfície em comum com a #45 (em Desenvolvimento):** `apps/api/src/requests/publish-service.ts`, `publish-composicao.ts`, `packages/db/src/request-publish.ts` (condicional), `apps/api/src/app.ts`, `apps/api/src/index.ts`, `packages/db/src/index.ts`, `packages/domain/src/index.ts`, `.env.example`, e na parte de banco o gatilho `service_request_endereco_bu` e a guarda `request_visibility_guard` (só lidos). Também a ordem de migrações: a M2 da #45 (`20261113240000`) tem prefixo **menor** que o da #46; se a #46 fosse aplicada antes, a M2 ficaria fora de ordem.

**Regra de execução:**
1. **Desenvolvimento da #46 só começa depois que a #45 sair de Desenvolvimento** (Aguardando aprovação ou concluída), confirmado no quadro local. Antes, o DEV roda `git status`, `ls supabase/migrations | tail -3` e `grep -rn "publish-service\|PublishCommitInput" apps packages` para ver o estado final dos arquivos.
2. A #46 **não edita** `request_owner_get`, `request_detail_professional` nem `request_publish_commit_enc`; só **chama** `request_visibility_guard`. Isso evita conflito com a M2 da #45 (que recria `request_owner_get`).
3. `[NÃO VERIFICADO]` O hash do corpo da publicação (`p_body_hash`, idempotência da #44) deve passar a incluir `phone` e `sharePhone`; se hoje é calculado sobre campos fixos, o DEV decide se muda (T-02 e T-18 detectam divergência). Mudar o hash é alteração em arquivo da #45, mais um motivo para esperar.
4. **Sequência do DEV:** (a) `.env.example` e domínio `contact/` + T-01; (b) cifra + T-17, T-18; (c) migração e reversão + T-21, aplicar com `npx supabase`; (d) adaptador `contact-consent.ts` + `contact-h033.dbtest.mjs` (T-04 a T-14, T-16, T-22); (e) serviço, rotas e composição + T-02, T-03, T-05, T-15, T-19, T-20; (f) integração à publicação + T-02, T-13; (g) `check:all` e `db:test` (T-23).
5. **Code Review e QA** repetem T-15, T-14 e T-22.
6. Impacto em outras histórias: **#121 (H-112)** reutiliza `contact_reveal_log` (§4.3); **E6 (aceite)** substitui `request_acceptance_active` e prova CA-08 de verdade; **#37, #47, #53, #57** sem superfície comum conhecida, mas conferem o próprio prefixo de migração.

## 11. Ambiente

`.env.example` ganha `PHONE_ENC_KEY=` sem valor. O valor só o dono grava, em `.env.local` e no ambiente de implantação. Nenhum serviço externo, nenhum e-mail, nenhum Docker.

## 12. Riscos

- **R-01 Guarda de aceite fechada:** até a E6, a revelação real não funciona em nenhum ambiente. É intencional (falha fechada). Mitigação: pergunta 448 e testes com substituição transacional.
- **R-02 Perda de `PHONE_ENC_KEY`:** telefones ilegíveis; sem rotação agora. Registrar onde a chave vive.
- **R-03 Conflito com a #45** (§10). Mitigação: ordem de execução.
- **R-04 Falha do `attach` depois do `commit`:** pedido publicado sem telefone. Fail-safe (ninguém vê); o dono repete pela rota de troca.
- **R-05 Estado de pedido fechado:** nomes dos estados `[NÃO VERIFICADO]`; teste T-16 pega divergência.
- **R-06 Revogação individual limitada** de quem está coberto pelo geral até a E6 (pergunta 452).
- **R-07 Autenticação recente do cliente** `[NÃO VERIFICADO]` (pergunta 450).

## 13. Perguntas ao líder (numeração contínua a partir de 447)

**447. Contrato do registro de revelação com a #121 (leitura da decisão 439).** A #121 é a dona, mas o telefone precisa da tabela agora.
- (a) A #46 cria `contact_consent` e `contact_reveal_log` exatamente no contrato do `09` §3.8, com `kind` já aceitando `'endereco'`; a #121 só reutiliza e estende por expansão (recomendado).
- (b) Esperar a #121 criar as tabelas (a #46 não pode ser entregue antes).
- **Recomendação:** (a). Destrava o §4.3 e a ordem das duas histórias.

**448. "Aceite ativo" sem a tabela de aceite (E6).** Não existe tabela de aceite no código.
- (a) `private.request_acceptance_active` nasce fechada (`select false`); a E6 a substitui; os testes de banco a trocam dentro de uma transação revertida; CA-08 real fica pendente e declarada na Issue (recomendado).
- (b) Criar já uma tabela mínima de aceite na #46 (invade a E6 e conflita com seu desenho).
- (c) Dispensar o aceite até a E6 (viola FA-030).
- **Recomendação:** (a), no mesmo espírito do `[DECIDIDO 423]`. Destrava T-05 a T-12.

**449. Por onde o telefone entra.** O `09` §3.4 prevê `phone_enc` no rascunho, mas o código não tem.
- (a) Campos aditivos `phone` e `sharePhone` no corpo da publicação; anexado ao pedido logo depois do `commit`; rascunho intocado; troca e apagamento pela rota `PUT /v1/requests/:id/phone` (recomendado).
- (b) Acrescentar colunas ao rascunho (edita a #43/#44, retém telefone 30 dias).
- **Recomendação:** (a). Destrava §5 e §6.

**450. Autenticação recente do cliente (R8, CA-17).** Só existe o mecanismo do administrador.
- (a) O DEV reutiliza o mesmo padrão de autenticação recente de 30 minutos para a sessão de cliente; se o cliente não tiver nada equivalente, a lacuna é registrada e o líder decide antes do Desenvolvimento (recomendado).
- (b) Criar o mecanismo do cliente dentro da #46.
- **Recomendação:** (a). Destrava T-19.

**451. Coluna `revoked_reason` (fora do `09`).** Aditiva, serve à prova e à tela do dono.
- (a) Manter (recomendado). (b) Remover e guardar só `revoked_at`.
- **Recomendação:** (a). Destrava §4.2 item 3.

**452. Revogar um profissional coberto só pelo consentimento geral.**
- (a) Até a E6, devolve `exige_revogar_geral`; o caso completo (revogar o geral e recriar individuais para os demais aceitantes) entra com a E6 (recomendado).
- (b) Revogar o geral sem recriar os demais (perde a liberação dos outros).
- **Recomendação:** (a). CA-10 fica provado com liberações individuais. Destrava T-11.

**453. Leitura do telefone pelo administrador (decisão 441).**
- (a) Sem função nem rota na #46; entra com a história do caso de acesso, com justificativa e registro (recomendado).
- (b) Entregar na #46.
- **Recomendação:** (a), como no `[DECIDIDO 415]`. Destrava o escopo.

**454. O dono lê o próprio número (rota `GET /v1/requests/:id/phone`).** Necessário para pré-preencher a republicação `[DECIDIDO 440]`.
- (a) Sim, só o dono, `no-store`, sem log de revelação (recomendado).
- (b) Não; o cliente digita de novo (muda a decisão 440).
- **Recomendação:** (a). Destrava T-13.

**455. Limites de leituras (§7).** 10 por pedido e profissional em 10 minutos; 60 por profissional em 1 hora.
- (a) Adotar (recomendado). (b) Outros números.
- **Recomendação:** (a). Destrava T-20.
