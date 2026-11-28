# Desenho técnico H-032 — Visibilidade de localização (Issue #45)

- **Issue:** #45 `[E3] Visibilidade de localização` · **História:** H-032 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `126-REFINO-H032.md` (CA-01 a CA-19, RN-01 a RN-10), decisões 404 a 419 (Rodada 90, adotadas como recomendadas), `110-DESENHO-H031.md` (§4.4, §11), `124-DESENHO-H039.md` (padrão de migração, RLS, grants, funções `private`), e leitura de código: `supabase/migrations/20261113150000_requests_fix_teto_30_dias.sql` (versão vigente de `request_publish_begin/commit`), `20261113210000_geo_expand_discovery_requests.sql` (#36), `20261112120500_geo_expand_match_point.sql`, `20261111370000_geo_create_geocode_point.sql`, `packages/db/src/request-publish.ts`, `apps/api/src/requests/publish-*.ts`, `apps/api/src/professional-document-crypto.ts`.
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§12).

## 0. Achados da leitura que mudam o refino

1. `[VERIFICADO]` **O geocodificador permanente não devolve rótulo.** `PermanentPoint` é `{lon, lat, precision}` e `app.geocode_point` não tem coluna de texto de lugar. A premissa 408(b) do refino ("o rótulo sai do resultado da geocodificação") **não existe no código**. O desenho usa uma derivação local e estrita (§5) e aceita rótulo nulo. `[PERGUNTA 420]`.
2. `[VERIFICADO]` **A #36 não tem rota nem guarda de elegibilidade** (cabeçalho da migração `20261113210000`: "Sem rota e sem guarda de elegibilidade aqui (Issue 68, H-055)"). Verificação aprovada e acesso comercial vigente não são checados por nenhuma função hoje. `[PERGUNTA 421]`.
3. `[VERIFICADO]` `request_publish_commit` (9 argumentos) insere `address_text` em claro e recebe `p_point_id`. O banco gera o `id` do pedido (`gen_random_uuid()`); `origin_draft_id` é `on delete set null`. Por isso o `id` do rascunho **não serve** como dado associado da cifra (§3); a API passa a gerar o `id` do pedido.
4. `[VERIFICADO]` Já existe cifra AES-256-GCM na API (`professional-document-crypto.ts`: versão de 1 byte + nonce + tag + texto). O desenho **reaproveita o formato e a biblioteca `node:crypto`**; nenhuma dependência nova.
5. `[VERIFICADO]` Última migração: `20261113210000_geo_expand_discovery_requests.sql`; última reversão: `supabase/rollbacks/20261113210000_geo_expand_discovery_requests.down.sql`.
6. `[DECIDIDO 417]` O centro da célula **não** é exposto como coordenada. Como o índice `match_cell` é derivável do centro (fórmula pública no repositório), o **índice da célula também não sai**. Ao profissional saem só rótulo, distância arredondada e modalidade.

## 1. Decisões de arquitetura

| # | Decisão | Alternativa recusada | Motivo |
|---|---|---|---|
| D-01 | **Duas migrações em fases (expandir, depois contrair):** M1 expansiva (colunas novas, funções novas, `address_text` passa a aceitar nulo) e M2 de contração (remove `address_text` e a função antiga). Entre as duas há o backfill do DEV. | Uma migração que troca tudo | A #44 está concluída e seus testes precisam continuar passando até a troca; só depois M2 remove o que ficou sem uso |
| D-02 | **A API cifra** (AES-256-GCM, `node:crypto`), o banco só guarda `bytea`. Chave `ADDRESS_ENC_KEY` fora do banco `[DECIDIDO 405, 406]`. | `pgcrypto` com chave no banco | Chave e dado no mesmo lugar anulam a cifra; o banco nunca vê a chave |
| D-03 | **O `id` do pedido passa a ser gerado pela API** e enviado à função (`p_request_id`). Ele é o dado associado (AAD) da cifra. | AAD = id do rascunho | `origin_draft_id` vira nulo no expurgo do rascunho (`on delete set null`) e a decifragem quebraria; `service_request.id` é imutável |
| D-04 | **Nova função de publicação com nome próprio** `private.request_publish_commit_enc`; a `request_publish_commit` da #44 **não é editada** em M1. | `create or replace` sobre a antiga; sobrecarga com o mesmo nome | Editar a antiga arriscaria os testes T-DB04 a T-DB14 da #44; sobrecarga confunde testes de catálogo que buscam por nome. A antiga é removida só em M2 |
| D-05 | **Duas funções de leitura separadas por papel**: `private.request_owner_get` (dono) e `private.request_detail_professional` (profissional). Participante e admin: **só lista de chaves e teste de função pura**, sem função de banco nem rota (§7). | Uma função com papel como parâmetro | Parâmetro de papel vira ponto de erro; funções separadas permitem catálogo por papel (CA-11) |
| D-06 | **Rotas separadas por tipo de sessão**: `GET /v1/requests/:id` (cliente) e `GET /v1/pro/requests/:id` (profissional). Respostas de recusa **idênticas byte a byte**. `[PERGUNTA 424]` | Uma rota que decide pelo papel | Sem ramificação por papel dentro do handler; a recusa não revela o motivo |
| D-07 | **Distância calculada no banco** entre o centro da célula da base do profissional e o centro da célula do pedido (mesma fórmula esférica da #36), **arredondada para cima em passos de 0,5 km, mínimo 0,5 km**. Nunca distância ao ponto exato. | Arredondar a mais próxima; calcular na API | Para cima nunca diz "0 km"; o cálculo no banco evita coordenada trafegar até a API |
| D-08 | **Rótulo gravado na publicação**, derivado por função pura de domínio (`derivePublicLabel`) a partir do texto já em mãos da API; CHECK no banco barra dígito e `@`. Sem chamada externa. | Chamar Mapbox; campo novo na #43 | Mapbox proibido (Rodada 74); não mexer na #43 `[DECIDIDO 407, 408]` |
| D-09 | **Elegibilidade do profissional re-implementa a regra de casamento da #36 para um único pedido**, com teste de paridade contra `private.discover_scan`. A guarda de verificação/acesso fica em **uma função** (`private.request_visibility_guard`), ponto único que H-055 estende. | Chamar `discover_scan` e filtrar; duplicar sem teste | `discover_scan` devolve página; a duplicação sem paridade deriva com o tempo |

## 2. Visão geral do fluxo

```
Publicação (#44, alterada):  begin (igual, devolve o texto em claro do rascunho)
   -> geocodifica (igual)
   -> API: gera request_id, cifra address_text (AAD = request_id), deriva public_label
   -> commit_enc (grava address_text_enc e public_label; address_text = null)

Leitura do dono:        GET /v1/requests/:id    -> request_owner_get  -> API decifra -> corpo fechado
Leitura do profissional: GET /v1/pro/requests/:id -> request_detail_professional -> corpo fechado (sem decifrar)
```

O texto em claro existe apenas: (a) no rascunho até expirar (dívida, `[DECIDIDO 407]`); (b) na memória da API durante a publicação e a leitura do dono. Nunca em log, auditoria, resposta de profissional ou erro.

## 3. Cifra de `address_text` (CA-12, CA-13, RN-09)

- **Arquivo:** `apps/api/src/requests/address-crypto.ts`. Fábrica `createAddressVault(rawKey: string)` devolve `{ seal(text, requestId): Buffer; open(blob, requestId): string }`.
- **Chave:** `ADDRESS_ENC_KEY` com **mínimo 32 caracteres** `[DECIDIDO 406]`. A chave AES de 32 bytes é **derivada** por HKDF-SHA-256 (`ikm` = UTF-8 da variável, `salt` = `fastpro-address-v1`, `info` = `service_request.address_text`). Variável com menos de 32 caracteres ou ausente = configuração inválida.
- **Algoritmo:** AES-256-GCM, nonce aleatório de 12 bytes por gravação (`randomBytes`), tag de 16 bytes. **AAD** = `addr1|<request_id>` (UTF-8). Texto normalizado em NFC, UTF-8, 3 a 200 caracteres (mesmo limite do CHECK antigo).
- **Formato do blob (`bytea`):** `[1 byte de versão = 1][12 nonce][16 tag][texto cifrado]`. Mesma estrutura de `professional-document-crypto.ts`; o byte de versão reserva a rotação futura (`ADDRESS_ENC_KEY_V2`), **sem rotação nesta fase** `[DECIDIDO 406]`.
- **Round-trip (CA-12):** `open(seal(t, id), id) === t`. `open` com outro `request_id`, com byte alterado, com versão desconhecida ou chave diferente lança erro **fixo** `endereco_indisponivel` (sem trecho do texto nem da chave). O dono recebe 503 `{code:"endereco_indisponivel"}` e o restante do pedido não é devolvido (falha fechada).
- **Sem a chave a rota fecha:** `publish-composicao.ts` passa a exigir `ADDRESS_ENC_KEY` por **nome** (entra em `pendencias` se faltar, como as demais). Sem ela a rota de publicação **não é montada** (padrão da casa, D-12 da #44) e as duas rotas de leitura também não. Defesa adicional: o serviço de publicação recebe o `vault` como dependência obrigatória e, se ausente, responde 503 `publicacao_indisponivel` **antes** de abrir o banco.
- **Variável nova:** `ADDRESS_ENC_KEY=` em `.env.example` **sem valor**. O valor só o dono grava, em `.env.local` e no ambiente de implantação. O DEV não lê nem imprime `.env.local`; nos testes a chave é uma constante de teste do próprio arquivo de teste.
- **Backfill do DEV** (pedidos sintéticos em claro): script `scripts/address-backfill.ts` (usa a mesma `createAddressVault` e a chave do ambiente) que lê lotes por `private.request_address_legacy_list`, cifra e grava por `private.request_address_backfill_set`. Imprime **só contagens**. Roda uma vez no DEV, entre M1 e M2.

## 4. Dados: migrações

### 4.1 M1 (expansiva) e reversão `[PROPOSTA]`
- **Migração:** `supabase/migrations/20261113220000_requests_expand_location_visibility.sql` (prefixo maior que `20261113210000`; o DEV reconfere com `ls supabase/migrations | tail -3` ao criar, porque a #37 ou outra pode ocupar o prefixo, e renomeia os dois arquivos juntos).
- **Reversão:** `supabase/rollbacks/20261113220000_requests_expand_location_visibility.down.sql`.
- **Aplicação:** `npx supabase`, nunca pelo MCP. Idempotente (`if not exists`, `create or replace`, `drop ... if exists`).

Conteúdo de M1, na ordem:
1. **Guarda de pré-requisito** no molde da #36: conta colunas em `pg_attribute` de `service_request` (`id, service_id, status, acceptance_deadline_at, geocode_point_id, customer_user_id, address_text, description, urgency, first_name`), `geocode_point` (`match_lon, match_lat, match_cell, match_grid_version`), `professional_service`, `professional_area`, `service`; senão `raise exception 'visibilidade_pre_requisito_ausente'`.
2. **Colunas novas em `app.service_request`:** `address_text_enc bytea` e `public_label text`, ambas nulas.
   - `service_request_endereco_enc_ck`: `address_text_enc is null or (octet_length(address_text_enc) between 30 and 1024 and get_byte(address_text_enc, 0) = 1)`.
   - `service_request_public_label_ck`: `public_label is null or (char_length(public_label) between 3 and 80 and public_label !~ '[0-9@]')`.
3. **`address_text` aceita nulo** (`alter column address_text drop not null`; o CHECK de 3 a 200 continua e aceita nulo) e nova `service_request_endereco_presente_ck`: `address_text is not null or address_text_enc is not null`. Nenhuma linha existente quebra; a função antiga continua inserindo em claro.
4. **Gatilho** `service_request_endereco_bu` (before update, definer): `address_text_enc` e `public_label`, uma vez gravados, não mudam (`23514 pedido_campo_imutavel`); `address_text` só pode passar de valor para nulo, e só junto de `address_text_enc` não nulo. **A função `service_request_imutaveis_bu` da #44 não é tocada.**
5. **Funções `private` (todas `security definer`, `set search_path = ''`, `set lock_timeout = '5s'`, erro fixo):**
   - `private.request_publish_commit_enc(p_user uuid, p_draft_id uuid, p_secret_hash text, p_idem_key text, p_body_hash text, p_content_rev integer, p_point_id uuid, p_ack boolean, p_now timestamptz, p_request_id uuid, p_address_enc bytea, p_public_label text)` com a **mesma tabela de retorno** da antiga. Corpo = cópia da `request_publish_commit` vigente (`20261113150000`), com três diferenças: valida `p_request_id` não nulo e diferente de `p_draft_id` e `p_address_enc` com a mesma regra do CHECK (senão `22023 endereco_cifrado_invalido`); `insert` grava `id = p_request_id`, `address_text = null`, `address_text_enc = p_address_enc`, `public_label = p_public_label`; o resto (ordem de trava, duplicidade, fotos, auditoria, idempotência) é idêntico. Teste de paridade (T-DB02).
   - `private.request_owner_get(p_user uuid, p_request_id uuid)` → `(out_id, out_status, out_service_id, out_service_name, out_urgency, out_description, out_first_name, out_address_text text, out_address_enc bytea, out_public_label, out_published_at, out_deadline_at, out_acceptances_count)`; **zero linhas** se o pedido não é do cliente. `out_address_text` só vem preenchido em linha legada (some em M2).
   - `private.request_visibility_guard(p_professional_id uuid, p_now timestamptz) returns boolean`: hoje, perfil com `verification_status = 'aprovada'` e conta ativa `[NÃO VERIFICADO: o DEV confere o nome do estado "ativo" em app.professional_account/professional_profile]`; acesso comercial vigente entra aqui quando existir (H-055). `[PERGUNTA 421]`.
   - `private.request_detail_professional(p_professional_id uuid, p_request_id uuid, p_now timestamptz)` → `(out_id uuid, out_service_id uuid, out_service_name text, out_urgency text, out_description text, out_public_label text, out_distance_km numeric, out_modality text, out_published_at timestamptz, out_deadline_at timestamptz)`; **zero linhas** quando: guarda falha, pedido inexistente, `status <> 'publicado'`, `p_now >= acceptance_deadline_at`, ou sem casamento. Casamento = regra de `discover_scan` para um pedido: serviço do profissional com modalidade presencial dentro do raio (`match_grid_version = 1`, haversine entre centros das células, `<= radius_m`), ou online de serviço não regulamentado (`out_modality = 'online'`, `out_distance_km = null`). A função **lê `match_lon/match_lat`, nunca `exact_point`**, e não devolve nenhuma coordenada.
   - `private.request_address_legacy_list(p_limit integer)` e `private.request_address_backfill_set(p_request_id uuid, p_enc bytea) returns boolean` (só para o backfill do DEV; removidas em M2).
6. **Privilégios:** `revoke all on function ... from public, anon, authenticated, service_role, app_api, app_backup_reader` e `grant execute ... to app_system` **somente**. Nenhum grant em tabela (RLS forçada e sem política, como na #44).
7. **Sem dado, sem agendamento, sem `cron`.** Nenhuma coluna existente muda de tipo.

### 4.2 M2 (contração) `[PROPOSTA]`, depende de `[PERGUNTA 422]`
- **Migração:** `supabase/migrations/20261113230000_requests_contract_address_text.sql` (prefixo livre maior que M1). **Reversão:** `supabase/rollbacks/20261113230000_requests_contract_address_text.down.sql`.
- **Pré-condição dentro da migração:** se existir linha com `address_text is not null`, `raise exception 'contrair_endereco_pendente'` (backfill não rodou). Depois: remove `request_publish_commit` (9 args), `request_address_legacy_list`, `request_address_backfill_set`; recria `request_owner_get` sem `out_address_text`; `alter table drop column address_text`; `alter column address_text_enc set not null`; remove a CHECK `..._endereco_presente_ck`.
- **Reversão de M2:** recria `address_text text` nula e as funções removidas (definições copiadas de `20261113150000` e M1). **Não restaura texto em claro** (por desenho; documentado no cabeçalho). Recusa se a coluna já existir.
- **Reversão de M1:** remove as funções novas, o gatilho, as CHECKs e as duas colunas; **recusa** (`rollback_recusado_com_dados`) se alguma linha tiver `address_text` nulo (o dado só existe cifrado e a restauração perderia o endereço), e, para linha com os dois campos, só passa com `set app.rollback_force = '1'` (padrão da #44).

## 5. Rótulo público (CA-14, CA-15)

- **Função pura** `derivePublicLabel(addressText: string): string | null` em `packages/domain/src/request/visibility.ts`. Regra estrita: separa o texto por vírgula; pega o **último segmento** que termine em `- UF`, `/UF` ou `, UF` com UF entre as 27 siglas; a cidade é o texto imediatamente anterior ao separador; **recusa** (devolve `null`) se a cidade tiver dígito, `@`, mais de 60 caracteres, ou se sobrar mais de uma palavra de via (`rua|avenida|av|travessa|rodovia|estrada|alameda|praça`, comparação sem acento e sem caixa). Saída `"<Cidade> - <UF>"`.
- **Bairro não é prometido** (não há fonte confiável sem provedor). Quando o rótulo é nulo, o profissional vê "Região aproximada" e a distância. `[PERGUNTA 420]`.
- **Dupla defesa:** o CHECK do banco (sem dígito nem `@`, 3 a 80 caracteres) pega vazamento de CEP ou número mesmo que a função de domínio erre.
- **Sem rede:** `derivePublicLabel` é pura; CA-14 é provado executando publicação e leitura com o provedor ausente.

## 6. API

### 6.1 Publicação (alteração mínima da #44)
- `publish-service.ts`: depois de `ensurePermanentPoint` (passo 3) e antes do `commit`, chama `deps.vault.seal(addressText, requestId)` e `derivePublicLabel(addressText)`; `requestId = randomUUID()` (injetável para teste). `PublishCommitInput` ganha `requestId`, `addressEnc: Uint8Array`, `publicLabel: string | null`.
- `packages/db/src/request-publish.ts`: `SQL_PUBLISH_COMMIT` passa a `select * from private.request_publish_commit_enc($1::uuid, ..., $9::timestamptz, $10::uuid, $11::bytea, $12::text)`. `begin` e `abort` **não mudam**. Resposta 201 **não muda** (corpo de 4 chaves da #44).
- Erro de cifra ou de banco: caminho já existente (503 `indisponivel` + `abort`), sem texto do endereço no erro.

### 6.2 Leitura do dono: `GET /v1/requests/:id`
Cabeçalhos: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json`. Sem CORS. Ordem: formato do `:id` (uuid; inválido = 404 uniforme) → cookie de sessão (ausente = 401 `sessao_necessaria`) → `authenticate` (nula = 401) → `request_owner_get` (zero linhas = 404 uniforme) → decifra → corpo.

**Corpo do dono, lista fechada:** `id, status, serviceId, serviceName, urgency, description, firstName, addressText, publicLabel, publishedAt, acceptanceDeadlineAt, acceptancesCount`. Nada de coordenada, `geocode_point_id`, e-mail, `customer_user_id`, `version`, hash.

### 6.3 Leitura do profissional: `GET /v1/pro/requests/:id`
Mesma ordem, com a sessão de profissional e `request_detail_professional(p_professional_id, :id, agora)`. Zero linhas = 404 uniforme (`{ "code": "pedido_nao_encontrado" }`), **igual byte a byte** a pedido inexistente, id mal formado, pedido fechado, fora do raio, profissional não aprovado, pedido de outro cliente.

**Corpo do profissional elegível, lista fechada (RN-10):** `id, serviceId, serviceName, urgency, description, publicLabel (nulo permitido), distanceKm (nulo se online), modality ('presencial' | 'online'), publishedAt, acceptanceDeadlineAt`. **Não saem:** `firstName`, `status`, `addressText`, coordenada, índice ou nome da célula, `geocode_point_id`, e-mail, telefone, `customer_user_id`, foto.

### 6.4 Regras de erro e logs
Mensagens fixas. Nenhum log carrega corpo, cookie, endereço, rótulo, `id` de pedido junto de `id` de usuário, nem o texto de exceção do driver (padrão `PUBLISH_BANCO_FALHOU`). Sem rate limit novo nesta história: o `id` é uuid v4 e a sessão é obrigatória; fica registrado como risco R-05.

## 7. Visibilidade por papel: listas fechadas (domínio)

Arquivo `packages/domain/src/request/visibility.ts`: constantes imutáveis (`as const`) e função pura `visibleKeys(role, flags)` onde `role` ∈ `owner | eligible_professional | participant | admin_with_case` e `flags = { addressShared: boolean }`. **São a fonte única de verdade** que os testes de contrato, o adaptador e as rotas importam.

| Papel | Chaves |
|---|---|
| `owner` | as 12 de §6.2 |
| `eligible_professional` | as 10 de §6.3 |
| `participant` (aceite ativo) | as de `eligible_professional` + `firstName`; + `addressText` **só** com `addressShared = true` (`address_share` ativo, não revogado) |
| `admin_with_case` | as de `participant` com `addressText`, **só** com `access_case` aberto |

`participant` e `admin_with_case` ficam **só como lista e teste de função pura**: não há tabela de aceite (E6) nem `address_share` (dono: história de aceite/seleção `[DECIDIDO 410]`) nem leitura administrativa (`[DECIDIDO 415]`). **Nenhuma função de banco nem rota** é criada para esses dois papéis na #45. CA-09 e CA-10 ficam `PENDENTES` com registro explícito na Issue (não simulados).

## 8. Domínio e adaptador (nomes de arquivo; barris só listados)

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Domínio | `packages/domain/src/request/visibility.ts` (**novo**) | listas fechadas, `visibleKeys`, `roundDistanceKm(meters)` (teto em passos de 0,5, mínimo 0,5), `derivePublicLabel`, tipos de saída |
| Domínio (barril, só listar) | `packages/domain/src/request/index.ts`, `packages/domain/src/index.ts` | reexportar o novo arquivo |
| Adaptador Pg | `packages/db/src/request-visibility.ts` (**novo**) | `PgRequestVisibilityStore`: `readOwner(userId, requestId)`, `readProfessional(professionalId, requestId, nowMs)`; SQL em constantes; mapeia só as chaves da lista fechada; erro fixo `visibilidade_banco_falhou` |
| Adaptador Pg (alterado) | `packages/db/src/request-publish.ts` | `SQL_PUBLISH_COMMIT`, entrada do `commit` (§6.1) |
| Barril db (só listar) | `packages/db/src/index.ts` | reexportar `request-visibility` |
| API cifra | `apps/api/src/requests/address-crypto.ts` (**novo**) | §3 |
| API serviço | `apps/api/src/requests/detail-service.ts` (**novo**) | `readRequestAsOwner`, `readRequestAsProfessional`; sem HTTP; usa as listas de domínio e a cifra |
| API rota | `apps/api/src/requests/detail-route.ts` (**novo**) | as duas rotas, cabeçalhos, 404 uniforme |
| API composição | `apps/api/src/requests/detail-composicao.ts` (**novo**) | `ADDRESS_ENC_KEY`, `DATABASE_URL_APP_SYSTEM`, sessões; sem chave = não monta |
| API (alterados) | `apps/api/src/requests/publish-service.ts`, `publish-composicao.ts` | §6.1 e §3 |
| Montagem (só listar) | `apps/api/src/app.ts`, `apps/api/src/index.ts` | registrar as duas rotas |
| Ambiente | `.env.example` | linha `ADDRESS_ENC_KEY=` sem valor |
| Script DEV | `scripts/address-backfill.ts` (**novo**) | §3 |
| Barril de testes (só listar) | `apps/api/tests/geo-permanent-store-fake.ts` já existe; **sem** novo fake de geocodificação | reaproveitado |

## 9. Plano de testes (locais, sintéticos, com marcador `H032`)

Padrão: `*.test.ts` (unidade/rota), `*.dbtest.mjs` (Postgres real). Evidência: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test` na Issue.

### 9.1 Domínio e API (arquivos novos)
`packages/domain/tests/request-visibility.test.ts`, `apps/api/tests/request-address-crypto.test.ts`, `apps/api/tests/request-detail-route.test.ts`, `apps/api/tests/request-publish-enc.test.ts`. `[NÃO VERIFICADO]` a convenção exata de pastas de teste do `packages/domain`; o DEV segue a dos testes vizinhos (`discovery-rules`).

### 9.2 Banco
`packages/db/tests/request-visibility-h032.dbtest.mjs` e `packages/db/tests/request-visibility-migration.test.mjs` (estático: nomes, `revoke/grant`, ausência de `exact_point` no `prosrc`, ordem de M1 e M2).

| # | Teste | CA |
|---|---|---|
| T-01 | Contrato do detalhe do profissional: chaves **exatamente** as de §6.3, na ordem, com pedido aberto e elegível (rota, banco real, provedor simulado) | CA-01 |
| T-02 | Varredura do corpo e dos cabeçalhos do profissional: sem par numérico de coordenada (`-?\d{1,3}\.\d{4,}`), sem `geocode_point_id`, sem hash hex de 64, sem nome nem índice de célula; o centro da célula conhecido do fixture **não** aparece em nenhuma forma | CA-02 |
| T-03 | Varredura de padrão de e-mail e telefone (BR) no corpo; ausência de `firstName` e `addressText` | CA-03 |
| T-04 | E-mail do cliente (sentinela única `h032-<rand>@example.test`) ausente em corpo e cabeçalhos do profissional, do dono-de-outro e da recusa; presente **só** onde permitido (nenhum corpo de pedido o contém, nem do dono) | CA-04 |
| T-05 | Dono recebe `addressText` igual ao original após publicar pela rota e ler pela rota | CA-05 |
| T-06 | Outro cliente, profissional não elegível e pedido inexistente: as três respostas são **idênticas** (status, cabeçalhos, corpo, comprimento); id mal formado idem | CA-06 |
| T-07 | Três fixtures de profissional, cada uma com uma única causa: fora do raio; verificação não aprovada; serviço não atendido. Todas 404 uniforme. Quarta (acesso comercial vigente) só quando `[PERGUNTA 421]` definir | CA-07 |
| T-08 | Fronteira: com relógio fixo, `acceptance_deadline_at - 1 µs` devolve; `= deadline` e `+ 1 µs` dão 404; dono continua lendo depois do prazo | CA-08 |
| T-09 | Função pura `visibleKeys('participant', {addressShared:false/true})` e `admin_with_case`: listas esperadas; **pendência registrada** (não simulada) da prova com banco | CA-09, CA-10 |
| T-10 | Catálogo (`pg_proc`, `pg_get_function_result`, `prosrc`): `request_detail_professional` não tem coluna de saída chamada `address*`, `exact_point`, `geocode_point_id`, `first_name`, `email*`, `phone*`, `customer_user_id`, `match_*`, `lat`, `lon`; o `prosrc` não menciona `exact_point`, `address_text`, `first_name`, `email`, `phone`; nenhuma função `request_*` de leitura devolve `exact_point` | CA-11 |
| T-11 | `address_text_enc` e `address_text`: `select` direto por `app_api`, `app_system`, `anon`, `authenticated` falha; só as funções `private` leem | CA-12 |
| T-12 | Round-trip cifra/decifra (vários textos, UTF-8 com acento, 3 e 200 caracteres); `open` com AAD de outro `request_id`, byte alterado, versão 2 e chave errada falham com erro fixo | CA-12 |
| T-13 | Chave ausente ou curta (< 32): `montarPublicacaoPedido` lista `ADDRESS_ENC_KEY` em `pendencias`; rotas não montadas; serviço sem `vault` responde 503 antes do banco e **nenhum pedido é criado** | CA-12 |
| T-14 | Publicação via `commit_enc`: `address_text is null`, `address_text_enc` presente, `octet_length` coerente, `id` = `p_request_id`; blob com versão ≠ 1 ou `p_request_id = p_draft_id` ⇒ `22023` e nada criado | CA-12, CA-15 |
| T-15 | Sentinela de endereço e de chave (strings únicas) varridas em: saída de log capturada, corpos de erro (400 a 503), `audit.audit_event` do pedido e mensagens de exceção do banco; zero ocorrências | CA-13 |
| T-16 | Publicação e as duas leituras com `provedor` de geocodificação ausente/lançando erro na leitura: leitura não chama provedor (contador do fake = 0); `derivePublicLabel` executa sem rede | CA-14 |
| T-17 | Rótulo: 12 textos (com rua e número, com CEP, só cidade e UF, UF inválida, sem vírgula, cidade com dígito) ⇒ `Cidade - UF` ou `null` esperado; CHECK do banco recusa `São Paulo 01310`, `a@b`, 2 e 81 caracteres; nenhum rótulo contém dígito | CA-15 |
| T-18 | `roundDistanceKm`: 0, 1, 499, 500, 501, 749, 750, 1000, 12 345 m ⇒ 0,5; 0,5; 0,5; 0,5; 1; 1; 1; 1; 12,5; resultado sempre múltiplo de 0,5 e nunca menor que a distância real; via banco, `out_distance_km` coincide com o oráculo de JS (haversine entre centros) | CA-16 |
| T-19 | Migração M1: aplicar duas vezes (idempotência); `db:test` antes e depois; prefixo maior que `20261113210000`; `.down.sql` recusa com dados e passa vazio; M2 recusa com linha em claro | CA-17 |
| T-20 | Paridade com a #36: para 30 pedidos de fixture (dentro/fora do raio, online, regulamentado, fechado, `selecionado`), o conjunto de pedidos para os quais `request_detail_professional` devolve linha = o conjunto de `discover_scan` para o mesmo profissional e relógio | CA-07, CA-08 |
| T-21 | Paridade da #44: `request_publish_commit` (antiga) e `request_publish_commit_enc` dão o mesmo `out_status` nos cenários de T-DB04, T-DB07, T-DB09, T-DB10, T-DB11 da #44 (executados com as duas) | CA-17, CA-19 |
| T-22 | Concorrência: 20 conexões, mesma chave ⇒ 1 pedido (T-DB07 reexecutado com `commit_enc`); `xmin` inalterado | CA-19 |
| T-23 | Backfill (DEV sintético): pedido em claro vira cifrado, `address_text = null`; segunda execução não altera (0 linhas); o gatilho recusa regravar `address_text_enc` | CA-12, CA-17 |
| T-24 | Tela (**só se houver**, `[PERGUNTA 425]`): texto "bairro, cidade e UF" e "a cerca de X km"; sem "endereço exato", coordenada ou mapa | CA-18 |
| T-25 | Fechamento: `corepack pnpm check:all` e `db:test` locais, contagem e código de saída na Issue; sem declarar CI | CA-19 |

## 10. Segurança e privacidade

1. **IDOR:** toda leitura exige o par (sessão, dono do pedido) ou (profissional, casamento); qualquer outra combinação = 404 uniforme. Corpo da recusa é uma constante única compartilhada pelas duas rotas.
2. **Falha fechada:** erro de decifragem não devolve o pedido parcial. Erro de banco = 503 fixo.
3. **Cifra:** AES-256-GCM autenticado (detecta adulteração e troca de linha por causa do AAD). Nonce nunca repete (aleatório de 96 bits, volume pequeno). Chave derivada; texto da chave nunca em log, erro ou Issue.
4. **Distância e triangulação (R3 do refino):** a distância é entre centros de células de 500 m, arredondada para cima em 0,5 km; quem repete buscas com bases diferentes aprende a célula, não o endereço. Risco aceito em `08 §9.2`; sem coordenada de pedido em nenhuma resposta a profissional.
5. **Rótulo:** gravado em tempo de publicação, passa por função estrita e por CHECK do banco (sem dígito ou `@`). Nulo é o estado seguro.
6. **Banco:** RLS forçada e sem política mantidas; nenhum `grant` fora de `app_system`; funções `definer` com `search_path = ''`; PostGIS não é usado nas leituras novas (só colunas `match_*`).
7. **Auditoria:** a publicação continua gravando `request.published` sem localização (#44 §9.4). Leitura pelo dono não gera evento. Sem leitura de admin nesta história.
8. **Dívidas registradas:** `request_draft.address_text` em claro até expirar (30 dias) `[DECIDIDO 407]`; retenção do endereço após o pedido `[DECIDIDO 419, adiada]`; descrição livre pode conter telefone ou endereço (aviso e bloqueio de padrões óbvios `[DECIDIDO 412]`, texto da revisão fora da #45).

## 11. Impacto em outras histórias

- **#36 (H-023, QA):** `discover_scan`, `discover_requests` e a guarda `discover_pre_requisito_ausente` **não são editadas**; a guarda confere 17 colunas, nenhuma é removida (`address_text` não está nela). A migração M1 tem prefixo **maior** que o da #36. A #45 adiciona uma consulta de um pedido que **repete a regra** de casamento; T-20 trava a divergência. Se a #36 mudar a regra depois, T-20 quebra e obriga a atualizar a função de detalhe. A #36 continua sem rota; a rota de detalhe da #45 é o primeiro consumidor de elegibilidade do profissional.
- **#44 (H-031, concluída):** (a) `request_publish_begin/abort` intactas; (b) `request_publish_commit` intacta até M2, quando é removida; (c) o adaptador `packages/db/src/request-publish.ts` e o serviço `publish-service.ts` mudam; (d) **como manter os testes da #44:** em M1 todos os testes de banco da #44 continuam passando sem edição, pois a função antiga permanece e `address_text` aceita nulo; os testes de adaptador/serviço que afirmam o texto do SQL ou o formato de `PublishCommitInput` (`packages/db/tests/request-publish-adapter.test.ts`, testes de `publish-service`) são **ajustados no mesmo commit** do adaptador; os `*.dbtest.mjs` da #44 que chamam o commit passam por **um único auxiliar** (`callCommit`) trocado para `commit_enc` antes de M2, e T-21 prova a paridade com as duas funções; (e) corpo 201 e todos os códigos de §3.1 da #44 não mudam; (f) `[NÃO VERIFICADO]` testes da #44 que leem `service_request.address_text`: o DEV roda `grep -rn "address_text" packages/db/tests apps/api/tests` ao começar e converte cada um (leitura pela função do dono).
- **#37 (H-024):** não lê `address_text`; deve conferir seu próprio prefixo de migração (maior que M1 se aplicada depois).
- **#46 (H-033):** acrescentará `phone_*` por expansão; a lista do profissional já não tem telefone.
- **E6 a E8 (aceite, seleção, `address_share`):** usam as listas de §7; criam as funções `participant`.
- **#43 (H-030):** não editada.

## 12. Ordem de execução

1. **Arquitetura (este documento).** O líder responde 420 a 426 e atualiza `11-DECISOES.md`.
2. **Desenvolvimento só depois da #36 sair de QA para Aguardando aprovação** `[DECIDIDO 413]`. Antes de começar, o DEV confere no quadro local e roda `ls supabase/migrations | tail -3`.
3. Sequência do DEV: (a) `.env.example` e domínio (`visibility.ts` + testes T-09, T-17, T-18); (b) cifra `address-crypto.ts` + T-12; (c) M1 + reversão + `request-visibility-migration.test.mjs` (T-10, T-19), aplicar no DEV com `npx supabase`; (d) adaptador `request-visibility.ts` e alteração de `request-publish.ts`; (e) serviço de publicação e composição + T-13, T-14, T-15, T-16, T-21, T-22; (f) rotas de leitura + T-01 a T-08, T-20; (g) backfill (`scripts/address-backfill.ts`) no DEV + T-23; (h) M2 `[PERGUNTA 422]` + ajuste do `callCommit` e remoção da função antiga; (i) `check:all` e `db:test` (T-25).
4. **Code Review e QA** seguem o Workflow; QA reexecuta T-20, T-21 e T-15.

## 13. Riscos

- **R-01 Rótulo vazio com frequência** (§0 item 1): aceitável, a tela diz "Região aproximada".
- **R-02 Perda da chave** `ADDRESS_ENC_KEY`: endereços ilegíveis. Registrar onde ela vive; sem rotação agora.
- **R-03 Duplicação da regra de casamento** (D-09): mitigada por T-20.
- **R-04 Conflito de prefixo de migração** com #37 e outras: DEV reconfere ao criar.
- **R-05 Sem limite de taxa na leitura** de detalhe: uuid v4 e sessão exigidos; reavaliar em H-055.
- **R-06 Cópia do corpo de `request_publish_commit`** em `commit_enc` pode divergir da antiga até M2: T-21 cobre; M2 elimina a cópia.
- **R-07 Participante e admin sem prova de banco** (§7): pendência declarada.

## 14. Perguntas ao líder (numeração contínua a partir de 420)

**420. Fonte do rótulo público sem Mapbox.** O geocodificador permanente não devolve rótulo (§0.1), então "bairro, cidade e UF" não tem origem pronta.
- (a) Derivar só "Cidade - UF" do texto digitado por regra estrita, rótulo nulo quando não bater; bairro não prometido (recomendado).
- (b) Exigir bairro, cidade e UF no formulário (muda a #43, concluída).
- (c) Tabela local de municípios por proximidade (dado externo grande, sujeito a erro perto de divisas).
- **Recomendação:** (a). Destrava CA-14, CA-15 e T-17. Consequência: "bairro" deixa de ser garantido até produção.

**421. Guarda de elegibilidade do profissional na #45.** A #36 não checa verificação nem acesso comercial vigente (H-055, #68).
- (a) Incluir já, em `request_visibility_guard`, `verification_status = 'aprovada'` e conta ativa; acesso comercial entra quando a H-055 existir (recomendado).
- (b) Sem guarda até a H-055.
- **Recomendação:** (a), pois RN-02 e a seção 7.2 do refino pedem verificação. Destrava T-07.

**422. Contração na mesma Issue (M2).** Remover `address_text` e a função antiga depois do backfill do DEV.
- (a) Entregar M2 na #45, só no DEV (recomendado; não há produção).
- (b) Deixar `address_text` nulável e adiar a remoção.
- **Recomendação:** (a). Com (b) o texto em claro poderia voltar por qualquer inserção que contorne a API; RN-09 só fica garantida com M2. Destrava CA-12.

**423. Participante e administrador na #45.** Sem tabela de aceite, `address_share` ou leitura administrativa.
- (a) Só listas fechadas e teste de função pura; CA-09 e CA-10 ficam pendentes e declarados (recomendado).
- (b) Criar tabelas e funções provisórias.
- **Recomendação:** (a), em linha com `[DECIDIDO 410, 415]`. Destrava o escopo e T-09.

**424. Nomes das rotas e tipo de sessão do profissional.** Propostas `GET /v1/requests/:id` (cliente) e `GET /v1/pro/requests/:id` (profissional).
- (a) Adotar as duas rotas (recomendado). O DEV confere o prefixo e o tipo de sessão de profissional já usados em `apps/api/src/professional-*-route.ts` e alinha o nome sem mudar o contrato.
- (b) Uma rota única que resolve o papel.
- **Recomendação:** (a). Destrava T-01 a T-08.

**425. Tela da #45 (CA-18).** A #36 não tem tela e o refino só pede tela "se houver".
- (a) Sem tela na #45; CA-18 e T-24 ficam para a história de tela do profissional (recomendado).
- (b) Tela mínima de detalhe do profissional.
- **Recomendação:** (a). Destrava o tamanho da Issue.

**426. Arredondamento da distância.** Para cima em passos de 0,5 km, mínimo 0,5 km (nunca "0 km"), contra "mais próxima".
- (a) Para cima, mínimo 0,5 (recomendado; `[DECIDIDO 414]` fixa só o passo de 0,5 km).
- (b) À mais próxima, aceitando 0 km.
- **Recomendação:** (a). Destrava T-18.

**Ciência sem decisão:** a API passa a gerar o `id` do pedido (D-03). Não muda o contrato público da #44 (`id` continua sendo um uuid novo, nunca o do rascunho).
