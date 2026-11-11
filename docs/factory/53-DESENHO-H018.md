# Desenho H-018 — Catálogo com semente de 25 grupos (Issue #31, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA. Sem dúvida bloqueante para o DEV; o conteúdo da semente segue provisório (§4.5) e o aceite de conteúdo fica com o titular.
- **Rastro:** 52-REFINO-H018 (CA-01..12); decisões do Orquestrador (1 grupo por serviço; REG? conta como regulamentado; conselho profissional entra inativo até L4; SENS por arquiteto; Superadmin; semente é conteúdo do produto); 09 §3.2 e §6; 08 §4.1/§4.2; ADR-002, ADR-003, ADR-017; 23-DESENHO-H006 (auditoria); migrações `…120000` (papéis, postura RLS) e `…140000` (`private.audit_append`).
- **Natureza:** somente documento. Nada de código, migração ou teste foi criado.
- **Etiquetas:** `[VERIFICADO]` lido no repositório · `[DECIDIDO]` Orquestrador · `[PROPOSTA]` deste desenho.

## 0. Fatos verificados

1. `app_api` (sem BYPASSRLS) e `app_system` (BYPASSRLS) existem; esquema `app` existe e nasce sem grants; `pnpm db:test` reprova tabela sem RLS habilitada e forçada, view sem `security_invoker` e acesso de `anon`/`authenticated`/`PUBLIC`. Migrações em `supabase/migrations`, rollback manual em `supabase/rollbacks`.
2. `private.audit_append(actor_ref, actor_role, action, object_type, object_id uuid, before, after, reason, correlation)` exige a ação em `audit.action_catalog`. O estado é **plano, escalar, strings até 64 caracteres em `[A-Za-z0-9_.:-]` e chave que não contenha `name`/`text`/etc.** Logo, o nome de um grupo ("Reformas e construção") **não cabe** no evento de auditoria. Consequência no §3.3.
3. Não existem ainda `admin_staff`, papéis ou permissões (H-102, mesma onda). H-018 não pode depender delas; ver §3.1.
4. `06-CATALOGO-PROPOSTO.md` tem 578 linhas de serviço (não ~550), 1 linha de referência cruzada ("ver G12") e 6 nomes repetidos entre grupos. `[VERIFICADO por contagem]`

## 1. Modelo de tabelas (esquema `app`, módulo `catalog`)

Convenções: `uuid` com `gen_random_uuid()`, `created_at`/`updated_at timestamptz`, `version int not null default 1` (concorrência otimista; ADR-003), sem DELETE para ninguém (só desativar; evita ressuscitar item na reaplicação da semente). Normalização `norm(x)` = minúsculas + sem acento + espaços colapsados, por função `private.catalog_norm(text)` **IMMUTABLE** (envoltório de `extensions.unaccent`); espelho em TypeScript para teste de paridade.

| Tabela | Colunas (além das convenções) | Regras |
|---|---|---|
| `app.service_group` | `id`, `seed_key text unique null` (ex.: `g01`), `name text` (1–80), `name_norm` (gerada), `position int not null` (>0), `active bool not null`, `updated_by_ref text null` | único `name_norm`; ordem de exibição `(position, id)` |
| `app.service` | `id`, `seed_key text unique null` (ex.: `g01-pedreiro`), `group_id uuid not null → service_group` (**um grupo por serviço**), `name` (1–120), `name_norm`, `modality text` {`presencial`,`online`,`ambos`}, `regulated bool not null`, `regulation_source text not null default 'proposta_po'` {`proposta_po`,`juridico`}, `council_body text null` (≤40, ex.: `CRM/CRO`), `moderation_sensitive bool not null default false`, `active bool not null`, `updated_by_ref` | único `(group_id, name_norm)`; check `council_body is null or regulated`; sem vínculo N:N |
| `app.service_synonym` | `id`, `service_id → service`, `term` (1–80), `term_norm`, `active bool not null default true` | único `(service_id, term_norm)`; sem DELETE (desativar) |
| `app.catalog_revision` | `id`, `entity` {`group`,`service`,`synonym`}, `entity_id`, `version`, `before jsonb null`, `after jsonb`, `audit_event_id uuid`, `at` | **append-only** (sem UPDATE/DELETE; trigger `ENABLE ALWAYS` como em H-006). Guarda os valores completos, inclusive nomes (§3.3) |
| `app.catalog_seed_run` | `seed_version text`, `checksum` (64 hex), `applied_at`, `groups_inserted`, `services_inserted`, `synonyms_inserted`, `groups_total`, `services_total` | PK `(seed_version, checksum)`; registro de execução |

Indicadores `[DECIDIDO/PROPOSTA]`:
- **Marca de regulamentado:** `regulated = true` para REG **e** REG? da semente (conservador). `regulation_source='proposta_po'` marca que ainda não houve parecer; `council_body` guarda o órgão quando a fonte `06` indica conselho. Só a leitura interna usa `council_body` e `regulation_source` (H-038/H-107).
- **SENS** vira a coluna `moderation_sensitive` (interna, **fora** da leitura pública). Motivo: a política de moderação reforçada precisa de um marcador consultável; custa uma coluna e nenhuma regra nova no H-018. A política em si fica fora do escopo. Semente: 27 itens com SENS em `06` (medir na conversão).
- **Invariante de grupo (CA-02):** `service_group.active` verdadeiro exige ao menos um `service.active` no grupo. Imposta por **gatilho de restrição `DEFERRABLE INITIALLY DEFERRED`** em `service_group` e `service` (avalia no COMMIT, permitindo criar grupo e serviços na mesma transação e trocar de grupo). Erro `CT002`. Um grupo desativado esconde seus serviços na leitura pública, sem alterar o `active` deles.
- **Vínculo (CA-03):** é `service.group_id` (FK `on delete restrict`), mais `service_synonym.service_id`.
- **Duas camadas de ativo:** item público = `group.active and service.active` (e `synonym.active` para sinônimo).

## 2. Leitura pública sem login (CA-05..07)

- **Quem lê:** a API, como `app_api`, em qualquer principal (`anonymous` inclusive). Nenhuma checagem de sessão. Não há acesso do navegador ao banco (esquema `app` não exposto, sem grant a `anon`/`authenticated`).
- **Grants mínimos a `app_api` (colunas, não tabela inteira):** `select (id, name, position, active)` em `service_group`; `select (id, group_id, name, modality, regulated, active)` em `service`; `select (service_id, term, active)` em `service_synonym`. `seed_key`, `council_body`, `regulation_source`, `moderation_sensitive`, `updated_by_ref`, `version`, carimbos e `catalog_revision`/`catalog_seed_run` **sem grant** a `app_api`. Se a API pedir coluna interna, o banco devolve 42501.
- **RLS (`for select to app_api`):** grupo `using (active)`; serviço `using (active and exists (grupo ativo))`; sinônimo `using (active and exists (serviço ativo de grupo ativo))`. `app_system` (BYPASSRLS) lê tudo.
- **Contrato:** view `app.catalog_public` com `security_invoker = true` (exigência do teste de catálogo) devolvendo `group_id, group_name, group_position, service_id, service_name, modality, regulated`; grant de `select` só a `app_api`. A API monta a árvore e **projeta por lista de campos permitidos** (lista de permissão em `packages/contracts`), nunca `select *`. Sinônimos: expostos por H-019; aqui só carregados (sem exposição pública).
- **Cache:** resposta idêntica para todos, sem cookie; `Cache-Control: public, max-age=300, stale-while-revalidate` `[PROPOSTA]`. Só a camada HTTP (H-018 não implementa cache).

## 3. Alteração só por administrador, com auditoria (CA-08..10)

### 3.1 Autorização `[PROPOSTA]`
- **Nenhum grant de escrita direta** a `app_api` nas tabelas do catálogo. A escrita passa por funções `private.catalog_*` **SECURITY DEFINER**, `search_path=''`, `execute` só a `app_api` e `app_system`, com a verificação única `private.catalog_assert_admin()`:
  - `app.principal_type = 'admin'`, `app.aal = 'aal2'`, `app.principal_id` uuid válido e `app.permissions` contendo `catalog.manage`; senão `42501`. A API converte: sem sessão 401, sem permissão 403 (CA-08).
  - **Permissão `catalog.manage`**, atribuída ao papel **Superadmin** `[DECIDIDO]`; entra em `packages/access-matrix` (e gera teste de contrato e teste de banco, ADR-002). Visitante, cliente e profissional não a possuem.
  - Quando H-102 existir, só `catalog_assert_admin()` muda: além dos ajustes de sessão, confere `admin_staff` ativo e a permissão pelo papel. Ponto único de troca, sem tocar nas demais funções.
- **Funções:** `catalog_group_save(p_id, p_expected_version, p_patch jsonb)`, `catalog_service_save(...)`, `catalog_synonym_save(...)`. `p_id null` cria; senão altera. `p_patch` aceita só chaves permitidas (`name`, `position`, `active`; em serviço também `group_id`, `modality`, `regulated`, `regulation_source`, `council_body`, `moderation_sensitive`); chave desconhecida = erro `CT004`. Versão diferente de `p_expected_version` = `CT003` (409). Nome vazio, modalidade fora da lista ou `council_body` sem `regulated` = `CT004`. Reordenar é alterar `position`.
- Leitura administrativa completa: função `private.catalog_admin_list()` com a mesma verificação (a tela é H-107).

### 3.2 Gravação e auditoria na mesma transação (CA-09)
Cada função, na própria transação: atualiza a linha (`version+1`, `updated_by_ref='admin:<id>'`), grava `catalog_revision` e chama `private.audit_append` por último (padrão H-006, lock curto da cadeia). Falha de auditoria desfaz a mudança.

### 3.3 O que vai na auditoria e por quê `[PROPOSTA]`
Pelo fato 0.2 o nome não passa no filtro do evento. Então:
- Novas ações em `audit.action_catalog` (migração própria): `catalog.group.changed`, `catalog.service.changed`, `catalog.synonym.changed` (`object_type` `service_group|service|service_synonym`, `reason_required=false`) e `catalog.seed.applied` (ator `system:catalog_seed`, papel `system`). `state_keys` (todas escalares e válidas): `version`, `active`, `position`, `group_id`, `modality`, `regulated`, `sensitive`, `fields` (campos tocados, ex.: `name.active`, ≤64 caracteres).
- Antes/depois **completos** (com nome e termo) ficam em `app.catalog_revision`, ligados por `audit_event_id`. Assim RF-154 (ator, objeto, antes, depois, instante) se cumpre sem alterar o filtro do H-006. Alternativa rejeitada: relaxar o filtro de chaves/alfabeto do evento (enfraquece a proteção contra PII para todos).
- A semente grava **um** evento `catalog.seed.applied` com contagens, não um por linha (evita segurar o lock da cadeia por centenas de gravações).

### 3.4 Proteção em RLS (CA-10)
Todas as tabelas: `enable` e `force row level security` na mesma migração; políticas só de `select` (§2). Sem política de `insert/update/delete` para `app_api`: a tentativa direta falha por falta de privilégio (42501) e, mesmo com privilégio concedido por engano, por falta de política. `catalog_revision` e `catalog_seed_run`: nenhum grant a `app_api`; `app_system` só `select/insert`.

## 4. Semente idempotente (CA-01..04)

### 4.1 Formato e origem
- Arquivo versionado `supabase/seed/catalog/catalog.v1.json` (estrutura: `version`, `groups[{key,position,name}]`, `services[{key,group_key,name,modality,regulated,council_body,sensitive,active,synonyms[]}]`), **gerado uma única vez** de `06-CATALOGO-PROPOSTO.md` por script `packages/db/scripts/catalog-build-seed.mjs` e commitado; revisão humana é o diff do JSON. Chaves estáveis: `g01..g25` e `g01-<slug ASCII do nome>`.
- Regras de conversão (determinísticas, o script e o teste as conferem):
  1. Marcas: PR→`presencial`, ON→`online`, HI→`ambos`. REG e REG?→`regulated=true`. SENS→`moderation_sensitive=true`. Tag entre parênteses que contenha órgão conhecido (`OAB, CRC, CRM, CRO, CRP, CREFITO, COREN, CRN, CREF, CRMV, CAU, CREA, CFT, CRECI, CRFa, CRF, CRQ, CFM`) vira `council_body`.
  2. **Conselho profissional ⇒ `active=false`** `[DECIDIDO]`, qualquer que seja REG ou REG?. Os demais REG/REG? (NR-10, NR-35, gás, licença, Polícia Federal, etc.) entram ativos e `regulated=true`. Estimativa do arquiteto: da ordem de 100 itens inativos; o DEV registra a contagem medida.
  3. Linha "ver Gxx" (referência cruzada) **não é serviço**: descartada. Nome repetido em dois grupos: fica no **primeiro** grupo; o nome da ocorrência descartada e seus sinônimos são somados aos sinônimos do item mantido (nota 7 de `06`, um grupo por serviço).
  4. Grupo da semente: `active=true` se tiver ao menos um serviço ativo; senão `active=false` (o script falha e relata, em vez de adivinhar, se isso ocorrer; pela estimativa nenhum grupo fica vazio, o menor tem cerca de 8 ativos).
  5. Modalidade ausente/inválida, nome vazio ou sinônimo vazio: o script falha.
- **Marca provisória:** `version` do arquivo tem o sufixo `-provisorio` e o `README` do diretório diz que o conteúdo não tem aceite (decisão do Orquestrador). Quando o titular decidir (reagrupar sob os 10 grupos originais ou mudar nomes), isso entra como **nova migração/semente** que altera o que for necessário, nunca por reaplicar a v1.

### 4.2 Aplicação
Função `private.catalog_seed_apply(p_seed jsonb)`, `execute` só `app_system`, SECURITY DEFINER, uma transação:
1. Valida o JSON (mesmas regras do §4.1) e calcula o checksum.
2. `insert … on conflict (seed_key) do nothing` em grupos, depois serviços (resolve `group_id` por `seed_key`), depois sinônimos `on conflict (service_id, term_norm) do nothing`. **Nunca `do update`**: o que o administrador renomeou, desativou, moveu ou reordenou permanece. Item removido do arquivo não é apagado (sem DELETE no sistema). Item novo de uma versão futura entra; item que o administrador desativou não volta, porque a linha continua existindo.
3. Conflito por **nome** (`name_norm`) com um item criado à mão por administrador (sem `seed_key`): o item da semente é **pulado e contado** em `skipped_conflict` no evento de auditoria, sem erro.
4. Grava `catalog_seed_run` e um evento `catalog.seed.applied`; se o par `(versão, checksum)` já existe, devolve as contagens com `inserted = 0` (reexecução é no-op).
Execução: `node packages/db/scripts/catalog-seed.mjs` (conexão do papel de migração, sem imprimir valores; mesma convenção de `db.mjs`) e o script `pnpm db:seed:catalog`. Não é uma migração: o conteúdo muda por versão e o esquema não. A migração de esquema cria apenas tabelas, funções e ações de auditoria. A semente é conteúdo do produto, não dado de teste (RF-163 não se aplica) `[DECIDIDO]`.

## 5. Arquivos para o DEV (previstos)

`supabase/migrations/<ts>_catalog_create_service_catalog.sql` (tabelas, índices, gatilhos, RLS, grants, view) · `<ts>_catalog_create_admin_functions.sql` (assert, saves, admin_list, seed_apply, ações de auditoria) · rollbacks correspondentes · `supabase/seed/catalog/catalog.v1.json` + README · `packages/db/scripts/{catalog-build-seed,catalog-seed}.mjs` · tipos/validador em `packages/db/src/catalog.ts` · lista de permissão em `packages/contracts` · linha `catalog.manage` em `packages/access-matrix` · seção "Estado (H-018)" no `supabase/README.md`. Rotas HTTP públicas e tela admin são de outras histórias (H-107 e navegação; ver dúvida 9 do refino).

## 6. Testes para o DEV

### 6.1 Offline (vitest/`node:test`, sem rede e sem banco)
- T-H018-01 Semente: 25 grupos `g01..g25`, posições 1..25, nomes únicos e na ordem de `06`; serviços com `group_key` existente, modalidade válida, nomes únicos por grupo, `regulated` booleano.
- T-H018-02 Conversão: PR/ON/HI→modalidade; REG e REG?→regulated; SENS→27 (medido); linha "ver G12" ausente; 6 nomes repetidos somente no primeiro grupo e seus sinônimos incorporados; **contagens medidas** (serviços totais, inativos por conselho) gravadas no teste e no relato da Issue.
- T-H018-03 Regra do conselho: todo item com órgão da lista tem `active=false`; nenhum REG? sem órgão está inativo; cada grupo ativo tem ao menos um serviço ativo.
- T-H018-04 Rebuild reproduzível: regenerar do `06` dá o mesmo JSON (checksum igual).
- T-H018-05 Normalização: `catalogNorm` em TypeScript dá os mesmos casos que a função SQL (lista de pares fixa, com acento, caixa, espaços).
- T-H018-06 Contrato público: o tipo/lista de permissão tem exatamente `group_id, group_name, group_position, service_id, service_name, modality, regulated`; teste falha se aparecer `council_body`, `moderation_sensitive`, `seed_key`, `version`, `updated_by_ref`, `regulation_source`.
- T-H018-07 Estático das migrações: cada `create table` do catálogo tem `enable` e `force row level security`; nenhum `grant` a `anon/authenticated/public`; nenhum grant de `insert/update/delete` a `app_api` nas tabelas; funções `security definer` com `set search_path = ''`; ausência de `delete` concedido; `on conflict … do update` ausente em `catalog_seed_apply`.
- T-H018-08 Matriz de acesso: `catalog.manage` só no Superadmin; os papéis restantes não a têm.
- T-H018-09 Validador de semente rejeita: nome vazio, modalidade inválida, `group_key` inexistente, chave duplicada, grupo ativo sem serviço ativo, `council_body` sem `regulated`.

### 6.2 Banco de desenvolvimento (`pnpm db:test`, `*.dbtest.mjs`; cada caso dentro de transação com `rollback`; sem rede além do banco)
- T-H018-10 Catálogo do banco: as 5 tabelas com RLS habilitada e forçada; view com `security_invoker`; sem acesso de `anon`/`authenticated`/`PUBLIC` (o teste existente cobre; conferir que lista as novas).
- T-H018-11 Semente aplicada na transação: 25 grupos, contagens iguais às do arquivo; segunda aplicação: `inserted = 0`, nenhuma duplicata, mesma contagem (CA-01, CA-04).
- T-H018-12 Preservação: após a semente, renomear grupo, desativar serviço, mover serviço e reordenar (como admin simulado); reaplicar a semente; nada volta ao valor da semente (CA-04).
- T-H018-13 Conflito por nome: serviço criado à mão com o mesmo nome de um da semente; semente pula e conta `skipped_conflict`, sem erro.
- T-H018-14 Leitura anônima (`set local role app_api`, `app.principal_type='anonymous'`): vê só grupos e serviços ativos; grupo desativado some com seus serviços; `select` de coluna interna falha com 42501; `catalog_revision` e `catalog_seed_run` falham com 42501 (CA-05..07).
- T-H018-15 Escrita negada: como `app_api` com principal `anonymous`, `customer` e `professional` (e `admin` com `aal1`, e `admin` sem `catalog.manage`): `insert/update/delete` direto = 42501; funções `catalog_*_save` = 42501; nada muda (CA-08, CA-10).
- T-H018-16 Escrita permitida (`admin`, `aal2`, `catalog.manage`): criar, alterar e desativar grupo, serviço e sinônimo; `version` sobe; `expected_version` errado = `CT003`; chave fora da lista no `p_patch` = `CT004`.
- T-H018-17 Auditoria: cada mudança gera 1 evento (`audit.audit_event`) e 1 `catalog_revision` com antes e depois completos, ator `admin:<id>`, na mesma transação; falha forçada em `audit_append` desfaz a mudança; `audit_verify_chain` íntegro.
- T-H018-18 Invariante: desativar o último serviço ativo de um grupo ativo (e ativar grupo sem serviço ativo) falha no COMMIT com `CT002`; desativar o grupo e o serviço na mesma transação passa; mover o último serviço ativo para outro grupo falha para o grupo de origem.
- T-H018-19 Unicidade: nomes iguais com acento/caixa diferentes no mesmo grupo e sinônimo repetido são rejeitados; mesmo nome em grupos diferentes é aceito.
- T-H018-20 `catalog_revision` e `audit_event` imutáveis: `update`/`delete` falham até para o dono.
- T-H018-21 `council_body` sem `regulated` é rejeitado pela restrição; SENS e conselho nunca aparecem em `catalog_public`.

## 7. Riscos e mitigação

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Permissão de administrador no banco vem de `set_config` da API (confiança na API) até H-102 existir | Defesa em profundidade: API nega primeiro (ADR-002); funções exigem os três ajustes; H-102 troca `catalog_assert_admin()` para checar `admin_staff` e papéis; teste T-H018-15; revisão obrigatória do Reviewer nesse ponto |
| R-2 | Semente é conteúdo provisório; os 10 grupos originais podem reorganizá-la | Versão `-provisorio`, chaves estáveis, nunca sobrescreve; reagrupamento por migração/semente nova; nada de contagem fixa no aceite além da medida |
| R-3 | Todos os itens de conselho entram inativos: busca e cadastro de profissionais de saúde/jurídico ficam pobres até L4 | Intencional `[DECIDIDO]`; relatar a contagem; a ativação é alteração de administrador (auditada) quando o parecer sair |
| R-4 | REG? tratado como regulamentado pode travar cadastro (H-038 exige certificação) | Conservador por decisão; `regulation_source='proposta_po'` permite listar o que ainda é palpite; reversível por administrador |
| R-5 | Auditoria não aceita nomes (fato 0.2); duas fontes de verdade (evento e revisão) | `catalog_revision` ligada ao evento por `audit_event_id`, append-only; teste T-H018-17 garante 1:1 |
| R-6 | Invariante "grupo ativo com serviço ativo" bloqueia edições legítimas parciais | Verificação adiada ao COMMIT; mensagem de erro `CT002` clara para a tela (H-107) |
| R-7 | Semente de 578 linhas aplicada no banco compartilhado de desenvolvimento deixa dados reais do produto lá | É o que se quer (conteúdo do produto); o teste usa transação com rollback; aplicação real só por comando explícito `db:seed:catalog` |
| R-8 | Dupla contagem/duplicatas na dedupe de 6 nomes pode esconder um serviço de outro grupo | Regra explícita (primeiro grupo) e sinônimo incorporado; teste T-H018-02 lista os 6 casos; revisão humana do diff do JSON |
| R-9 | Divergência entre normalização em TypeScript e SQL quebra H-019 e a unicidade | Teste de paridade T-H018-05; função única `catalog_norm` reutilizada por H-019 |
| R-10 | Leitura pública sem cache pesa no plano gratuito | Cabeçalho de cache na rota (H-018 só define o contrato); 25 grupos e ~500 itens são poucos kB |

## 8. Dúvidas para o líder (não bloqueiam o DEV)

1. Confirmar `catalog.manage` no Superadmin dentro do lote de decisões de AMB-08.
2. Confirmar que "conselho profissional" usa a lista de órgãos do §4.1(1) e que REG sem órgão (NR-10, NR-35, gás, licença) entra ativo. Recomendação: sim.
3. Confirmar que a aplicação real da semente no banco de desenvolvimento só ocorre após o QA (recomendação) e por comando explícito.
