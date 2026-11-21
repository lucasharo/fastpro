# Desenho de arquitetura H-115 — Autorização por recurso e paridade API x banco (Issue #124)

- **Issue:** #124 `[E15] Autorização por recurso e paridade` · **História:** H-115 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ2-124-20261120
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-20.
- **Entrada:** `docs/factory/161-REFINO-H115.md` (PO; perguntas 910 a 929). **Estrutura de referência:** `153-DESENHO-H055.md`.
- **Natureza:** somente documento. Nenhum código, migração, banco, quadro nem `11-DECISOES.md` foi alterado. Nenhuma pergunta ao usuário.
- **Etiquetas:** `[VERIFICADO]` lido no repositório nesta rodada · `[ADOTADA]` decisão adotada pelo líder (recomendação do PO), vetável · `[AJUSTE]` correção do refino por divergência com o código real · `[NÃO VERIFICADO]` a confirmar pelo DEV no passo 0.
- **Migrações reservadas:** `20261120300000` a `20261120399999`. Previsão: nenhuma. Só se o passo 0 provar uma lacuna real de RLS/`search_path` (seção 6.3).

---

## 1. Resumo da arquitetura

H-115 entrega um **gate permanente de segurança** com três peças, todas derivadas de **uma única fonte** (a matriz em `packages/access-matrix`):

1. **Matriz de acesso legível por máquina** (`packages/access-matrix/src`): papéis, recursos, ações, condições, projeção autorizada (campos permitidos e proibidos), resposta esperada na API e comportamento esperado no banco, mais o estado de cada caso (`active` ou `deferred`).
2. **Testes de catálogo RLS** (T-05) no banco de desenvolvimento: RLS habilitada e forçada, isolamento de `anon`/`authenticated`, `SECURITY DEFINER` com `search_path` vazio, `app_api` sem `BYPASSRLS`, ausência de leitura pública no Storage.
3. **Testes de autorização por recurso (IDOR, T-02) e de paridade (T-06)**: cada caso da matriz é exercitado nas duas camadas (contrato HTTP da API e banco sob `app_api` com contexto transacional), ambos contra o **mesmo valor esperado vindo da matriz**. Um guarda de cobertura falha se um caso ativo não tiver as duas camadas.

Não há tabela, rota nem migração nova esperada. H-115 é, em essência, matriz + testes + um relatório. Entidades futuras (chat, seleção, avaliação) ficam **declaradas** na matriz como `deferred`.

### 1.1 Fatos verificados no repositório

- `[VERIFICADO]` `packages/access-matrix/src/index.ts` é placeholder: só `PACKAGE_NAME`, `PERMISSIONS.catalogManage` e `ROLE_PERMISSIONS.superadmin`. O `package.json` tem script `test` com `vitest run --passWithNoTests`, sem dependências além de `@fastpro/config`, e nenhum outro pacote o importa hoje.
- `[VERIFICADO]` `packages/domain/src/admin/roles.ts` exporta `ADMIN_ROLES` (7 papéis), `ADMIN_PERMISSIONS` (15), `ADMIN_ROLE_PERMISSIONS` (superadmin sem herança) e `adminPermissionsOf`. É a fonte do RBAC administrativo no código.
- `[VERIFICADO]` Existe `scripts/check-module-boundaries.mjs` e `check-workspace-deps.mjs`. Por isso a matriz **não importa** `@fastpro/domain`; a igualdade entre os dois é provada por teste fora de ambos (seção 5.3).
- `[VERIFICADO]` A API é **Node `http` sem framework** (`apps/api/src/app.ts`, `composicao.ts`). O refino fala em NestJS: `[AJUSTE]` o texto da matriz usa "API" e não "NestJS". Os testes de API ficam em `apps/api/tests/` (92 arquivos; o refino citou `apps/api/test/`, `[AJUSTE]`).
- `[VERIFICADO]` Papéis de banco criados em migração: `app_api` (`nobypassrls`), `app_system` (`bypassrls`), `app_backup_reader` (`bypassrls`) e `app_keepalive` (`nobypassrls`). O teste de catálogo deve cobrir os quatro, não só `app_api`.
- `[VERIFICADO]` Variáveis de sessão realmente usadas em `set_config`: `app.principal_id`, `app.principal_type`, `app.aal` e `app.permissions` (mais `app.offering_purge`, interna). **`app.sid` não aparece em nenhum `set_config`.** `[AJUSTE]` da pergunta 913: a matriz adota as quatro variáveis reais; `app.sid` fica fora do contrato até existir.
- `[VERIFICADO]` Já existe varredura de catálogo em `packages/db/tests/catalog.dbtest.mjs` (consulta `NON_COMPLIANT_OBJECTS`: tabela sem `relrowsecurity and relforcerowsecurity`, view sem `security_invoker`, view materializada ou estrangeira). Outros testes citam `forcerowsecurity` (`admin-rbac`, `admin-access-case`, `commercial-access`, `audit`, etc.). **Não duplicar**: o DEV deve ler a consulta existente e decidir entre estender ou extrair para um auxiliar comum (seção 6.3).
- `[VERIFICADO]` Padrão dos testes de banco: `*.dbtest.mjs` com `connect()` de `packages/db/scripts/lib/env.mjs`, `begin ... rollback` por teste, dados sintéticos `@example.test`, execução por `pnpm db:test` (`node --test --test-concurrency=1 "packages/db/tests/*.dbtest.mjs"`). Fixtures: `fixtures/professional-access.mjs` (`concederAcessoVigente`), `fixtures/no-network.mjs`.
- `[VERIFICADO]` 96 migrações; as últimas são `20261113530000_privacy_create_dsr_jobs.sql` e `20261119100000_requests_expand_discovery_photo_flags.sql`.
- `[NÃO VERIFICADO]` Quais tabelas o `app_api` acessa diretamente e quais ele só alcança por funções de fachada (`private.*`/`app.*`). Muitas rotas passam por funções `SECURITY DEFINER`. Determina o tipo de sonda de banco de cada caso (seção 4.2). Passo 0 do DEV.
- `[NÃO VERIFICADO]` Nomes exatos de todas as relações citadas pelo refino (`app.contact_consent`, `app.approval_vote`, `app.media_asset`, `app.admin_access_case`...). O guarda da seção 5.4 falha se um caso ativo apontar relação inexistente, o que obriga a confirmação.

---

## 2. Decisões

Todas `[ADOTADA]` (recomendação marcada pelo PO), vetáveis pelo usuário. As perguntas 910 a 929 são adotadas como estão, exceto os ajustes indicados.

| Nº | Decisão adotada | Efeito no desenho |
|---|---|---|
| 910 | Matriz em TypeScript tipado, arquivo canônico `src/matrix.ts`, dados imutáveis (`as const`/`Object.freeze`) e funções puras de consulta. Nada de JSON lido do disco. | Seção 3. "Legível por máquina" = tipada e exportada, consumível por API, testes e relatório. |
| 911 | Regra rica por caso: papel, recurso, ação, condição, campos permitidos, campos proibidos, resposta HTTP esperada, comportamento esperado no banco. | Seção 3.2. |
| 912 | IDOR responde **404 uniforme** `{ code: ... }` idêntico ao recurso inexistente, nunca 403. `[AJUSTE]` O código do corpo é o que cada rota **já** devolve (`recurso_nao_encontrado`, `rascunho_nao_encontrado`...). A matriz o declara por caso; não se muda rota existente. | Casos IDOR. Sem teste de tempo mensurável (fica para H-117/anti-enumeração já coberta em H-013/H-097). |
| 913 | Contexto transacional por `set_config(..., true)`. `[AJUSTE]` Variáveis reais: `app.principal_id`, `app.principal_type`, `app.aal`, `app.permissions`. `app.sid` fora. | Executor de banco (4.2). |
| 914 | Default-deny: `app_api` sem contexto vê 0 linhas ou recebe 42501. | Teste de catálogo/contexto (6.3). |
| 915 | Divergência entre camadas é falha bloqueante (`exit != 0`). | 5.2, 7. |
| 916 | Varredura de RLS em `app`, `billing`, `ops` (e `private`, se contiver tabelas; o teste lista os esquemas com tabelas, em vez de fixar a lista). | 6.3. |
| 917 | `anon` e `authenticated` sem nenhum privilégio de tabela nesses esquemas. | 6.3. |
| 918 | Execução modular: casos de entidades inexistentes entram como `deferred`; ativos rodam agora. Ativação automática detectada por `to_regclass` (seção 5.5). | Matriz e relatório. |
| 919 | Sentinelas sintéticos e busca recursiva por substring em toda a resposta e nas colunas. | 4.3. |
| 920 | Nenhuma política de leitura pública em `storage.objects` para `request-photos`/`identity-docs`; acesso só por URL assinada pela API. | 6.3. |
| 921 | Funções administrativas do banco exigem `app.aal = 'aal2'`. `[AJUSTE]` Se o passo 0 mostrar função admin que não checa, vira achado (6.4), não requisito novo silencioso. | 6.4. |
| 922 | Dono não lê o próprio documento de identidade (decisão 170); verificação lê só com tarefa atribuída. | Casos CP-18 a CP-20. |
| 923 | Autoatendimento negado (I-19). Só ativável se existir ponto de aceite; o aceite é futuro, então o caso nasce `deferred`; o gatilho de exclusividade de papéis (H-017) já existente é testável agora. | 5.5. |
| 924 | Admin lê conversa/documento só com `app.admin_access_case` aberto, com justificativa, e evento em `ops.audit_event`. | CP-19 e casos admin. |
| 925 | Auditor: `INSERT`/`UPDATE`/`DELETE` negados em `ops.audit_event` e em tabelas de domínio. | Casos admin. |
| 926 | Toda `SECURITY DEFINER` com `search_path` vazio, por `pg_proc`. | 6.3. |
| 927/928 | Motor e tipos em `packages/access-matrix/src/`; banco em `packages/db/tests/*.dbtest.mjs` (entra em `pnpm db:test`); API em `apps/api/tests/*.test.ts` (entra em `pnpm test`). | Seção 8. |
| 929 | Transição por decisão do líder; este documento cumpre a etapa de Arquitetura. | Seção 10. |

Decisões novas do Arquiteto (também vetáveis):

- **A-1 — "Paridade" é medida por esperado único, não por execução cruzada.** As duas camadas rodam em processos de teste distintos (API em `pnpm test`, banco em `pnpm db:test`) mas leem o **mesmo `expected` da matriz**. Um guarda estático garante que cada caso ativo tem teste nas duas camadas. Divergência = um dos lados diferir do esperado único (seção 5.2). Evita acoplar o servidor HTTP a transações revertidas, o que não é viável (a API abre as próprias conexões).
- **A-2 — Sem dependência de pacotes.** `access-matrix` continua sem importar `domain`/`db`. A igualdade com `ADMIN_ROLE_PERMISSIONS` é testada em `apps/api/tests` (que já importa `@fastpro/domain`; o DEV confirma se pode importar `@fastpro/access-matrix` conforme `check-workspace-deps`, e declara a dependência em `apps/api/package.json` e `packages/db/package.json` se preciso).
- **A-3 — Falha por padrão só em divergência e em cobertura de casos ativos.** Caso `deferred` cuja relação já existe gera **aviso nominal** no relatório; vira falha apenas com `PARITY_STRICT=1` (usado no QA final e no release). Evita travar o merge de outras Issues (#71, #84, #96) por um teste que elas ainda nem têm como escrever.
- **A-4 — Banco só em DEV, sempre em transação desfeita.** Nenhum teste deixa dado. Sem Docker, sem rede, sem Mapbox, sem e-mail real.

---

## 3. Matriz de acesso (`packages/access-matrix/src`)

### 3.1 Arquivos

| Arquivo | Conteúdo |
|---|---|
| `src/roles.ts` | `ACCESS_PRINCIPALS`: papéis de teste e seus contextos de sessão. |
| `src/resources.ts` | `ACCESS_RESOURCES`: recurso, relação no banco (`schema.tabela` ou função de fachada), rota(s), sensibilidade (C0 a C4), campos classificados. |
| `src/matrix.ts` | `ACCESS_MATRIX`: lista imutável de `AccessCase`. Funções `casesFor`, `activeCases`, `deferredCases`, `canAccess`. |
| `src/projections.ts` | Listas fechadas por visão: chaves do dono, do profissional elegível, do participante, e `FORBIDDEN_FOR_PROFESSIONAL` (e-mail, coordenadas, endereço exato...). |
| `src/sentinels.ts` | Valores sintéticos de PII e `containsSentinel(obj, sentinels)` recursivo. |
| `src/report.ts` | Gerador puro do relatório (seção 7). |
| `src/index.ts` | Reexporta tudo e **mantém** `PACKAGE_NAME`, `PERMISSIONS`, `ROLE_PERMISSIONS` (compatibilidade com H-018/uso atual). |

Substituir a descrição "Placeholder" no `package.json` do pacote. Não há dependências em tempo de execução.

### 3.2 Tipos (contrato)

```ts
export type PrincipalType = 'anonymous' | 'customer' | 'professional' | 'admin' | 'system';
export type Aal = 'aal0' | 'aal1' | 'aal2';

export type AccessPrincipalId =
  | 'anonymous'
  | 'customer_owner' | 'customer_other'
  | 'pro_eligible' | 'pro_ineligible_unapproved' | 'pro_ineligible_expired' | 'pro_ineligible_geo'
  | 'pro_participant' | 'pro_participant_withdrawn' | 'pro_other' | 'pro_owner'
  | 'admin_superadmin' | 'admin_verificacao' | 'admin_moderador' | 'admin_financeiro'
  | 'admin_suporte' | 'admin_auditor' | 'admin_governanca_dados'
  | 'admin_no_mfa'          // admin com aal1
  | 'app_system';

export interface PrincipalContext {           // o que o executor de banco injeta (set_config local)
  principalType: PrincipalType;
  aal: Aal;
  permissions?: readonly string[];            // espelha app.permissions, só para admin
}

export type AccessAction = 'read' | 'list' | 'create' | 'update' | 'delete' | 'execute' | 'reveal';
export type HttpExpectation =
  | { status: 200 | 201 | 204; mustHaveKeys?: readonly string[]; mustNotHaveKeys: readonly string[]; emptyItems?: boolean }
  | { status: 401 | 403 | 404; code: string };          // code igual ao que a rota já devolve
export type DbExpectation =
  | { kind: 'rows'; minRows: number; columns?: readonly string[]; forbiddenColumns?: readonly string[] }
  | { kind: 'no_rows' }                                   // RLS filtra
  | { kind: 'denied'; sqlstate: '42501' }                 // sem privilégio ou função recusa
  | { kind: 'exception'; sqlstate: string };              // regra de função/gatilho (ex.: papel exclusivo)

export type DbProbe =
  | { kind: 'table_select'; relation: string; where?: string }
  | { kind: 'table_write'; relation: string; verb: 'insert' | 'update' | 'delete' }
  | { kind: 'function_call'; fn: string; args: readonly string[] }   // a mesma função que a API chama
  | { kind: 'none' };                                                  // ex.: rota pública sem banco

export interface AccessCase {
  id: string;                                 // 'CP-01'... estável, usado nos títulos dos testes
  resource: string;                           // chave de ACCESS_RESOURCES
  action: AccessAction;
  principal: AccessPrincipalId;
  condition: string;                          // texto curto, ex.: 'pedido publicado do próprio usuário'
  criteria: readonly string[];                // 'CA-H115-08'...
  invariants: readonly string[];              // 'I-16'...
  route?: { method: string; path: string };
  http: HttpExpectation;
  db: DbExpectation;
  probe: DbProbe;
  status: 'active' | 'deferred';
  requiresRelation?: string;                  // só para deferred: 'app.conversation'
  deferredBy?: readonly string[];             // Issues: '#71'
}
```

Regras da matriz (verificadas pelo teste estático da seção 5.1):

- `id` único; todo `criteria` existe em `CA-H115-01..20`; todo `principal`/`resource` existe.
- Caso `active` exige `probe != none` quando `http.status` for 200/201 ou 404/403 de recurso de banco; `deferred` exige `requiresRelation` e `deferredBy`.
- `http.status === 404` exige `db.kind` em `no_rows` ou `denied`. `http.status 200` com `mustNotHaveKeys` exige `db.forbiddenColumns` coerente (mesma lista de chaves proibidas). **É aqui que nasce a coerência entre camadas, antes de qualquer execução.**

### 3.3 Conteúdo mínimo

- **Principais:** os 19 acima, com `PrincipalContext` (cliente `aal1`, profissional `aal1`, admin `aal2`, `admin_no_mfa` `aal1`, anônimo `aal0`).
- **Recursos ativos agora:** `request` (pedido, lista e detalhe do dono), `professional_request_view` (visão do profissional elegível e participante), `request_discovery`, `request_draft`, `request_media` (fotos), `contact_consent`/revelação de telefone, `professional_profile`, `professional_area`/`professional_service`, `identity_document`, `verification_case`, `access_grant`/`subscription` (billing), `audit_event`, `admin_access_case`, `approval` (dupla aprovação), `catalog_admin`, `ops_panel`, `retention`, `public_professional` (perfil público).
- **Recursos `deferred`:** `conversation`, `message` (par legítimo, I-12, requer `app.conversation`/`app.message`; Issues #71, #76, #77, #136), `selection` (seleção, cancelamento, conclusão; #84 a #91), `review` (avaliação, I-09; #96 a #101), `checkout` (#60 a #67).
- **Casos:** parte dos 26 cenários CP-01 a CP-26 do refino (seção 8) e os necessários para cobrir CA-H115-01 a 20. Os CP que dependem de estado futuro (aceite ativo `pro_participant`, `address_share` ativo, conversa) entram `deferred` com `requiresRelation` correspondente. `[VERIFICADO]` CP-06/07/11/12 pressupõem aceite e consentimento de chat; só os casos cuja origem de dados já existe hoje (consentimento de telefone no pedido, H-033) são ativos.
- **Reaproveitamento:** `OWNER_KEYS`, `ELIGIBLE_PROFESSIONAL_KEYS` e `VISIBILITY_ROLES` (`packages/domain/src/request/visibility.ts`) são fonte de verdade das chaves. A matriz declara cópia congelada em `projections.ts`; o teste de igualdade (5.3) compara com o domínio, assim uma alteração de um lado sem o outro falha.

---

## 4. Executores

### 4.1 Executor de API (`apps/api/tests/authorization-matrix.test.ts`)

- Para cada caso `active` com `route`, monta a requisição com a sessão do principal usando o **mesmo harness já usado pelos testes de rota** (fakes de composição de `apps/api/tests`; o DEV reutiliza, não cria servidor novo) e compara status, `code`, `mustHaveKeys`, `mustNotHaveKeys` e `items` vazio com `http`.
- Sentinelas: o fake do repositório do pedido devolve e-mail e telefone sintéticos do cliente; o teste exige `containsSentinel(resposta, sentinelas) === false` em toda resposta a profissional (CA-H115-11, I-16). O telefone só aparece nos casos cujo `http` o permite (opt-in e participação).
- Título de cada teste: `[CP-xx] ...` (para o guarda de cobertura).
- Admin: casos de MFA e RBAC percorrem as rotas `/v1/admin/*` reais já registradas, usando o harness admin existente.

### 4.2 Executor de banco (`packages/db/tests/authorization-parity.dbtest.mjs`)

Por caso `active` com `probe != none`:

1. `begin`; cria dados sintéticos pelas fixtures existentes (usuários, perfil, concessão de acesso, pedido); marca `h115-<uuid>`.
2. `set local role app_api` (ou o papel pedido pelo caso), `select set_config('app.principal_id', $1, true)`, idem `app.principal_type`, `app.aal`, `app.permissions`.
3. Executa a sonda: `table_select` (esperado típico: `denied` ou `no_rows`, já que o `app_api` quase nunca lê tabela de domínio direto), `table_write`, ou `function_call` (a função que a rota usa; é o caminho de produção e onde a paridade é real).
4. Compara com `db`: `rows` (com colunas permitidas e proibidas), `no_rows`, `denied` (SQLSTATE 42501) ou `exception`.
5. `rollback` no `finally`. Cada caso em transação própria e savepoint para erros esperados (um 42501 aborta a transação; usar `savepoint`/`rollback to`).

Caso especial: contexto ausente (CA-H115-04): sem nenhum `set_config`, a mesma sonda deve resultar em `no_rows`/`denied`.

### 4.3 Executor estático (`packages/access-matrix/tests/*.test.ts`, vitest)

Integridade da matriz (3.2), coerência HTTP x banco (3.2), cobertura por título (5.4) e igualdade com domínio (5.3).

---

## 5. Paridade e detecção de divergência

### 5.1 Integridade da matriz (`packages/access-matrix/tests/matrix.test.ts`)

Validações da seção 3.2 mais: todos os 7 papéis administrativos existem como principais; nenhuma permissão fora de `ADMIN_PERMISSIONS`; `superadmin` sem `finance.refund.approve`, `verification.review`, `moderation.decide`, `retention.*` (RN-H115-12, CA-H115-17).

### 5.2 Taxonomia de divergência

| Tipo | Significado | Como a suíte detecta |
|---|---|---|
| 1, vazamento | API entrega o que a matriz proíbe | Teste de API falha (chave proibida, sentinela, status errado) |
| 2, bloqueio indevido | Matriz permite, banco nega (42501 ou 0 linhas) | Teste de banco falha em caso `rows` |
| 3, exposição latente | API nega, mas o banco permitiria a sonda crua | Teste de banco falha em caso `no_rows`/`denied` |

Como ambos os lados usam o mesmo `expected`, qualquer descompasso aparece como falha de um dos dois arquivos, nomeando o `[CP-xx]`. Saída diferente de zero bloqueia (decisão 915).

### 5.3 Igualdade com o domínio (`apps/api/tests/access-matrix-domain-parity.test.ts`)

Compara `ADMIN_ROLE_PERMISSIONS` e `ADMIN_ROLES` com os papéis da matriz, e as chaves congeladas com `OWNER_KEYS`/`ELIGIBLE_PROFESSIONAL_KEYS`/`VISIBILITY_ROLES`. Compara também as permissões semeadas em `app.admin_role_permission` (consulta no DEV, dentro de `admin-rbac`-like, em `authorization-parity.dbtest.mjs`) com `ADMIN_ROLE_PERMISSIONS`.

### 5.4 Guarda de cobertura por título

Teste estático (em `packages/access-matrix/tests`, lendo arquivos por caminho relativo ao repositório): extrai `[CP-xx]` dos títulos em `apps/api/tests/authorization-matrix.test.ts` e `packages/db/tests/authorization-parity.dbtest.mjs`. Falha se algum caso `active` não tiver o id em **ambos** (ou em apenas o lado aplicável: rota pública sem banco = só API; caso de catálogo = só banco, declarado por `probe`/`route`) e se algum id citado nos testes não existir na matriz. Falha também se `requiresRelation`/`relation` de caso ativo não existir (a checagem da relação ocorre no teste de banco).

### 5.5 Casos futuros (A-3 e 918)

No teste de banco, para cada caso `deferred`: `to_regclass(requiresRelation)`.
- Não existe: registra `pendente` no relatório (ok).
- Existe: registra `ativável sem caso`: **aviso** por padrão e **falha** com `PARITY_STRICT=1`. O DEV da Issue dona da tabela promove o caso a `active` e escreve as duas camadas.

---

## 6. Banco: catálogo (T-05) e achados

### 6.1 Arquivo

`packages/db/tests/authorization-catalog.dbtest.mjs` (somente leitura em `pg_catalog`; sem escrita). Antes, o DEV lê `catalog.dbtest.mjs` e reaproveita `NON_COMPLIANT_OBJECTS` (extrair para `fixtures/rls-catalog.mjs` só se for pequeno e sem mudar o teste existente; caso contrário, nova consulta equivalente).

### 6.2 Verificações

| ID | Verificação | CA / RN |
|---|---|---|
| CAT-01 | Em `app`, `billing`, `ops` (e outro esquema que contenha tabela criada pelas migrações), toda tabela (`relkind r`/`p`) com `relrowsecurity` e `relforcerowsecurity`. Esquemas obtidos por consulta, não por lista fixa; extensões e `pg_*`/`information_schema` excluídos. | CA-H115-02, RN-01 |
| CAT-02 | `anon` e `authenticated`: `has_table_privilege` (select, insert, update, delete, references, trigger) falso em toda tabela e view desses esquemas; sem `usage` desnecessário em esquemas de negócio (apenas aviso se `usage` existir sem uso). | CA-H115-03, RN-02 |
| CAT-03 | Papéis `app_api`, `app_keepalive`: `rolbypassrls = false`, `rolsuper = false`. `app_system` e `app_backup_reader` são `bypassrls` por desenho: o teste afirma que **nenhum papel com `LOGIN` utilizável pela API** é `bypassrls` e que `app_api` não é membro de papel `bypassrls`/superuser (`pg_auth_members`). | R-H115-01 |
| CAT-04 | Toda função `prosecdef = true` nos esquemas `private` e `app` tem `proconfig` com `search_path=` vazio (ou `search_path=""`/`''`, o teste normaliza). Lista nominal das violações. | CA-H115-19, RN-15 |
| CAT-05 | Toda view em esquema de negócio com `security_invoker=true` (já em `catalog.dbtest`; só confirmado, sem duplicar a regra se já coberta). | RN-01 |
| CAT-06 | Execução de funções: `EXECUTE` de funções `private.*` negado a `PUBLIC`, `anon`, `authenticated` (exceto as listadas em uma lista explícita revisada no teste). | R-H115-01 |
| CAT-07 | `storage.objects`: nenhuma política `SELECT` para `anon`/`public` que alcance os buckets `request-photos` e `identity-docs` (nomes reais conferidos no passo 0; se o bucket tiver outro nome, usar o nome real). | pergunta 920 |
| CAT-08 | Contexto ausente: sonda de leitura em duas tabelas de domínio como `app_api` sem `set_config` retorna `no_rows` ou 42501 (CA-H115-04); com `principal_id` do dono, só as linhas dele. | CA-H115-04, 914 |

### 6.3 Tratamento de falhas

Cada falha vira lista nominal (`schema.objeto: motivo`). **Corrigir o banco só é permitido por nova migração** na faixa `20261120300000` a `20261120399999`, aplicada com `npx supabase` em DEV, após o achado documentado na Issue. Nada de editar migração antiga. Se o DEV não achar violação, nenhuma migração é criada.

### 6.4 Funções administrativas e `aal2`

Para cada função admin (`private.admin_*` e as funções de H-102 a H-110), o teste chama com `app.aal='aal1'` e espera 42501, e com `aal2` mais permissão certa espera sucesso (ou erro de negócio, não de privilégio). Se alguma não checar `aal2`, é achado e corrigido em migração reservada (decisão 921). `[NÃO VERIFICADO]` cobertura hoje; `admin-rbac.dbtest.mjs` e `admin-access-case.dbtest.mjs` provavelmente cobrem parte, e o DEV deve citar, não duplicar.

---

## 7. Relatório de paridade

`access-matrix/src/report.ts` expõe `buildParityReport(cases, evidence)`, função pura. O teste agregador (`packages/access-matrix/tests/report.test.ts`) valida só a função com entradas sintéticas. A emissão para o QA/Issue é um **resumo impresso pelos próprios executores no fim**: cada arquivo de teste imprime, via `console.log`, `H115 PARIDADE camada=<api|db> ativos=N ok=N falhas=[CP-..] pendentes=[CP-..]`. O relatório "100%" para a Issue é a união dessas duas linhas mais a saída do guarda de cobertura. Não se grava arquivo de relatório no repositório (evita arquivo gerado versionado).

---

## 8. Plano de implementação em fatias para o DEV

Ordem e independência: F1 não depende de nada; F2, F3, F4 dependem de F1; F5 depende de F1 a F4. Nenhuma fatia depende de Issue não concluída.

| Fatia | Entrega | Arquivos | Prova | Depende |
|---|---|---|---|---|
| **F0 — Inventário (sem alterar nada)** | Confirmar o que o `app_api` acessa direto vs por função; nomes reais de tabelas/buckets; rotas reais (grep em `apps/api/src`); consulta existente em `catalog.dbtest.mjs`. Registrar a tabela de sondas na Issue. | nenhum | tabela de sondas na Issue | — |
| **F1 — Matriz e integridade** | Tipos, principais, recursos, projeções, sentinelas, casos ativos e `deferred`, `report.ts`; `index.ts` mantém exports atuais; testes 5.1 e `report.test.ts` (vitest). Atualizar `package.json` (descrição). | `packages/access-matrix/src/*`, `packages/access-matrix/tests/*` | `pnpm --filter @fastpro/access-matrix typecheck lint test` com saída 0 | F0 |
| **F2 — Catálogo RLS** | CAT-01 a CAT-08, 6.4. Somente leitura (e transações desfeitas para CAT-08). | `packages/db/tests/authorization-catalog.dbtest.mjs` (+ fixture opcional) | `node --test --test-concurrency=1 packages/db/tests/authorization-catalog.dbtest.mjs` saída 0 em DEV | F0 |
| **F3 — Executor de API** | Casos ativos com rota: IDOR de pedido e rascunho, visão do profissional (sem e-mail, sem endereço exato, sem coordenadas), descoberta (`{ items: [] }` para inelegível), documento do dono negado, perfil/área de outro profissional, admin MFA e RBAC, auditor sem escrita, superadmin sem permissões operacionais, rotas públicas anônimas. | `apps/api/tests/authorization-matrix.test.ts`, `apps/api/tests/access-matrix-domain-parity.test.ts` | `pnpm --filter @fastpro/api test` saída 0 | F1 |
| **F4 — Executor de banco** | Sondas 4.2 para os casos ativos; contexto ausente; permissões admin semeadas x domínio; casos `deferred` com `to_regclass`. | `packages/db/tests/authorization-parity.dbtest.mjs` | execução isolada e `pnpm db:test` saída 0 em DEV; nenhum dado remanescente (contagem antes/depois nas tabelas tocadas) | F1, F0 |
| **F5 — Guarda de cobertura e fechamento** | Teste 5.4; execução completa `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm check:all`; comentário na Issue com as linhas `H115 PARIDADE`. | `packages/access-matrix/tests/coverage.test.ts` | saídas 0 registradas | F1 a F4 |

### 8.1 Casos ativos mínimos por fatia (rastreados a CA-H115)

| CA | Cobertura ativa agora | Deferred |
|---|---|---|
| 01 | F1 (tipagem, integridade) | — |
| 02, 03, 04, 19 | F2 (CAT-01 a 04, 08) | — |
| 05 | CP-01, CP-02, CP-03, CP-15 (pedido e rascunho, dono, outro cliente, anônimo) | autoatendimento no aceite (923) |
| 06 | Perfil e área de outro profissional; documento de outro profissional | — |
| 07 | — | `conversation`/`message` (#71, #76, #77, #136) |
| 08, 09 | CP-01, CP-04, CP-13, CP-14 (descoberta e visão do elegível; `items: []` inelegível por `pro_ineligible_unapproved`, `_expired`, `_geo`) | CP-06 participante com aceite |
| 10 | CP-18 a CP-20 (dono não lê; verificação com tarefa; financeiro negado) | — |
| 11 | CP-10 (sentinelas em todas as respostas a profissional; colunas sem e-mail) | variantes de participante/selecionado |
| 12 | CP-07 a CP-09 quando a origem do consentimento de telefone existir hoje (H-033); caso contrário `deferred` | revelação via chat |
| 13 | CP-11 e CP-12 (`publicLabel`/`distanceKm` apenas na descoberta); liberação por `address_share` | `address_share` (chat/aceite) |
| 14, 15 | CP-20, CP-21 e casos de cada papel contra permissões alheias; `aal1` recusado na API e no banco | — |
| 16 | admin sem caso aberto não lê documento; com caso lê e auditoria registra | leitura de conversa (chat) |
| 17 | CP-22 (superadmin sem voto de estorno/decisão de moderação) | — |
| 18 | CP-23, CP-24 (auditor lê; escrita 42501 em `ops.audit_event` e em duas tabelas de domínio) | — |
| 20 | F5 | — |

Fotos (CP-16, CP-17): `active` no lado API (URL assinada; sem URL para anônimo) e no banco via CAT-07; sem leitura direta em `storage.objects`.

---

## 9. Segurança, privacidade e riscos

- **Dados:** somente sintéticos (`@example.test`, sentinelas fixos). Nenhum dado real. Sem log de PII em saída de teste (o relatório imprime só ids de caso).
- **DEV:** transação desfeita; sem `DROP`/`TRUNCATE`; leitura de catálogo apenas. Sem Docker, sem Mapbox, sem e-mail.
- **Credenciais:** usar `connect()` existente (`.env.local`); nada de valor de chave em saída.

| ID | Risco | Mitigação |
|---|---|---|
| R-01 (crítico) | Divergência entre camadas | Esperado único + guarda de cobertura + falha bloqueante |
| R-H115-A | Sonda de banco não representa o caminho real (app_api quase não lê tabela direto) | `function_call` usa a função que a rota chama; F0 inventaria antes de escrever os casos |
| R-H115-B | Casos de API apoiados em fakes podem divergir do repositório real | O teste de domínio (5.3) e as sondas de banco (mesma função de produção) fecham o laço; limite documentado: a camada HTTP só é validada com fakes |
| R-H115-C | `SET LOCAL ROLE app_api` pode falhar se o papel de conexão de DEV não for membro | F0 verifica; se não for, usar conexão com o papel adequado só em DEV ou `set role` por superuser de DEV; não alterar grants sem migração reservada |
| R-H115-D | Teste frágil por nome de relação/bucket | Guarda "relação inexistente" obriga atualização explícita |
| R-H115-E | Falsa sensação de cobertura em rota nova sem caso | O guarda só cobre casos declarados; QA deve conferir lista de rotas x matriz (F0 deixa a lista de rotas registrada) |
| R-H115-F | Faixa de numeração de migração | Reservada, sem previsão de uso |

Riscos de privacidade: o e-mail do cliente nunca deve aparecer em resposta a profissional (I-16); a suíte falha com sentinela.

---

## 10. Pendências de outras Issues e dúvidas

**Não bloqueiam F0 a F5.** Só ativam casos `deferred`:
- Chat e mensagem: #71 (H-058), #76 (H-065), #77 (H-066), #136 (H-068).
- Seleção, troca, cancelamento, conclusão: #84 a #91 (H-078 a H-085).
- Avaliação: #96 a #101 (H-086 a H-091).
- Checkout e pagamento: #60 a #67.
- Aceite do profissional e `address_share` (origem de `pro_participant` e CP-06/11/12): dependem das Issues acima; até lá, `deferred`.
- #68 (H-055, QA): a descoberta já tem rota e visão; os casos CP-04 e CP-13/14 podem entrar como ativos. Se a #68 voltar de QA com mudança de contrato, o DEV de H-115 ajusta a matriz antes do fechamento.

**Dúvidas ao líder (adotadas por recomendação, vetáveis; nenhuma exige o usuário):**
1. A-3: caso `deferred` já ativável vira aviso por padrão e falha só com `PARITY_STRICT=1`. Alternativa: sempre falhar.
2. 913: `app.sid` fora do contrato porque não existe no código.
3. 912: o `code` do 404 é o que a rota já devolve, não unificado em `recurso_nao_encontrado`.

---

## 11. Entrega ao Orquestrador (HANDOFF)

- **Próxima etapa:** Desenvolvimento (WF-03). Fatias F0 a F5 da seção 8, com F0 obrigatória primeiro.
- **Critérios de prova do DEV:** `pnpm --filter @fastpro/access-matrix test`, `pnpm --filter @fastpro/api test`, `pnpm db:test` (ou os arquivos novos isolados), `pnpm lint`, `pnpm typecheck`, `pnpm check:all`, todos com saída 0, registrados na Issue com comando e contagem. Linhas `H115 PARIDADE` das duas camadas.
- **Proibido ao DEV:** alterar migração antiga; criar tabela de domínio; mudar rota existente para "casar" com a matriz (a matriz descreve o que existe; discrepâncias reais viram achado para correção por Issue própria ou migração reservada documentada); usar Docker, Mapbox ou e-mail real; deixar dado em DEV.
- **QA (happy path por API, só no final):** executar o conjunto da fatia F5 e conferir as duas linhas `H115 PARIDADE` sem falhas. Sem teste de tela.
