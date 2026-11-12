# FastPro — Desenho H-107 (Issue #116): gestão de catálogo e promoções

- **Issue:** #116 (H-107) · **Workflow:** WF-03 · **Coluna:** Arquitetura · **Data:** 2026-11-12 · **Papel:** Architect
- **Fontes lidas (código):** migrações `20261111200000_catalog_create_service_catalog.sql`, `..210000_catalog_create_seed_apply.sql`, `..220000_admin_create_rbac.sql`, `..250000`, `..350000` (busca H-019), `..440000` (rascunho de pedido); `packages/domain/src/admin/{routes,guard,console,roles,ports}.ts`; `apps/api/src/{app.ts,admin-ops-route.ts,catalog/*}`; `docs/factory/77-REFINO-H107.md`, `08-ARQUITETURA` §10, `09-MODELO-DADOS`.
- **Legenda:** [DECIDIDO] · [VERIFICADO] (visto no arquivo) · [PROPOSTA] · [NÃO VERIFICADO]

## 1. O que o catálogo gerencia e as rotas

[VERIFICADO] Já existem em `app`: `service_group` (nome, posição, ativo), `service` (grupo, nome, `modality` presencial/online/ambos, `regulated`, `council_body`, `regulation_source`, `moderation_sensitive`, ativo), `service_synonym` (termo, ativo), `catalog_revision` (antes/depois completos, append-only) e `catalog_seed_run`. Todas com `version` para concorrência otimista, sem DELETE (FK `on delete restrict`), RLS forçada e leitura pública só de linhas ativas e colunas permitidas.

[VERIFICADO] Escrita só pelas funções `private.catalog_group_save`, `catalog_service_save`, `catalog_synonym_save` (`p_id` nulo = criar; `p_expected_version` obrigatório ao alterar) e leitura administrativa `private.catalog_admin_list()` (grupos, serviços e sinônimos, inclusive inativos). Todas exigem `private.catalog_assert_admin()`: `app.principal_type='admin'`, `app.aal='aal2'`, `app.principal_id` uuid e `catalog.manage` em `app.permissions`. Executáveis só por `app_api` e `app_system`.

[VERIFICADO] `catalog.manage` já existe e só o papel `superadmin` a tem (`roles.ts`, RBAC). O menu do console já traz o item `catalogo` com `rota: null` e `historiaDona: 'H-107'`.

**Rotas novas** [PROPOSTA] (o registro `AdminMethod` só admite GET, POST, DELETE; como não há exclusão, tudo é GET e POST; desativar é POST com `{"active":false}`). Todas com permissão `catalog.manage`, registradas em `ADMIN_ROUTES` ao lado das demais:

| Método e caminho | Faz | Função de banco |
|---|---|---|
| `GET /v1/admin/catalog` | lista tudo (inclusive inativos) | `catalog_admin_list` |
| `POST /v1/admin/catalog/groups` e `/groups/:id` | cria / altera grupo | `catalog_group_save` |
| `POST /v1/admin/catalog/services` e `/services/:id` | cria / altera serviço | `catalog_service_save` |
| `POST /v1/admin/catalog/synonyms` e `/synonyms/:id` | cria / altera sinônimo | `catalog_synonym_save` |
| `GET /v1/admin/catalog/:entity/:id/revisions` | histórico de um item | função nova (§2) |

Corpo da alteração: `{expectedVersion, patch}`; `patch` só com as chaves que a função aceita (a função já recusa as demais com CT004). Verificação de origem em POST (54 §3), corpo até 8 KB, `Cache-Control: no-store`, sem corpo nos logs. Ordem igual à de H-108: cookie, guarda (uma consulta), permissão, só então o banco. Tela: o item `catalogo` do console ganha `rota` e uma página em `apps/admin` (lista, formulário por campo, desativar/reativar, ordem dos grupos).

**Ponte de identidade** [PROPOSTA]: a rota abre uma transação curta e faz `set_config(..., true)` (local à transação) de `app.principal_type='admin'`, `app.principal_id` (= `userId` da guarda), `app.aal='aal2'` (só se `guard.aal2`) e `app.permissions` (= permissões da guarda), depois chama a função. Esse é o "ponto único de troca" previsto na migração (`catalog_assert_admin`). Os valores vêm só da guarda do servidor, nunca do corpo ou de cabeçalho.

## 2. Migração nova e o que já existe

- **Já existe (nada a recriar):** tabelas, índices de unicidade, funções de escrita e leitura, ações de auditoria (`catalog.group|service|synonym.changed`), revisões, semente, busca (`catalog_search`), lista pública, permissão e papel.
- **Migração nova (única, pequena)** [PROPOSTA]: `catalog_revision_list(p_entity text, p_id uuid)` em `private`, `security definer`, que exige `catalog_assert_admin()` e devolve as revisões do item (versão, antes, depois, data, ator por `updated_by_ref`). Sem ela a tela não consegue mostrar o histórico, pois `app_api` não tem `select` em `catalog_revision` (só `app_system` tem). Rollback manual em `supabase/rollbacks/`. Nenhuma tabela, coluna ou grant de escrita novo.
- **Sem migração** para promoção (§3). **Lacuna conhecida:** nenhuma função reordena vários grupos de uma vez; trocar duas posições são duas chamadas (cada uma com sua versão e auditoria). [VERIFICADO] não há unicidade em `position`, então a troca não colide. Reordenação em lote fica fora do MVP.

## 3. Regra de promoção no MVP

- [DECIDIDO] RF-153 e `08` §10: promoção futura é tabela administrável, fora do MVP; `09`: valores `plan_price` 2990, 8070, 14940, 23880 e "sem promoção no MVP". Nenhuma promoção se aplica sozinha.
- [PROPOSTA] **Sem tabela, sem rota, sem tela, sem permissão nova** (o texto "Superadmin ... promoções" de `08` §424 é papel futuro; `catalog.manage` não cobre preço). Registro da regra, em três lugares: (a) esta seção e o relatório de entrega; (b) uma entrada em `11-DECISOES` feita pelo líder; (c) um teste de banco que falha se existir relação em `app` com nome contendo `promo`, `discount` ou `coupon`, e se `plan_price` não for a única fonte de valor lida pela consulta de planos (a consulta de planos é de H-046, então este segundo item só vale quando ela existir).
- [PROPOSTA] Nenhuma função desta história lê ou grava `plan`, `plan_price` ou `payment`. O teste de CA-10 confere, por inspeção do corpo das funções do catálogo em `pg_proc`, que não citam essas tabelas.

## 4. Auditoria de cada alteração

[VERIFICADO] Cada função de escrita, na mesma transação: grava a linha, chama `private.audit_append` (ação `catalog.*.changed`, ator `admin:<uuid>`, estado antes/depois só com escalares: versão, ativo, posição, grupo, modalidade, regulamentado, sensível, lista de campos alterados) e insere em `catalog_revision` o JSON completo antes/depois, ligado ao evento por `audit_event_id` (único). Falha na auditoria aborta a transação inteira, então não há alteração sem registro (CA-07). Nomes e termos não vão para a trilha de auditoria (sem PII/texto livre), só para a revisão.

[PROPOSTA] A rota não faz nenhum outro registro e não repete a auditoria. Falhas de permissão não geram evento de catálogo (a guarda já registra o que é dela). Valor anterior e posterior da modalidade (CA-06) saem da trilha (`modality` antes/depois) e da revisão.

## 5. Riscos e tratamento

| Risco | Tratamento |
|---|---|
| Alteração que quebra a busca ou a navegação | [VERIFICADO] a busca (`catalog_search`) lê as tabelas ao vivo e só ativos; nada a invalidar. Invariante CT002 (grupo ativo exige serviço ativo) é adiada para o COMMIT: a rota deve tratar erro no commit, não só no `select` da função, e responder 409 sem efeito parcial. Cada chamada é uma transação; para desativar o último serviço de um grupo, desativar o grupo antes (a tela orienta essa ordem; ao reativar, reativar o serviço antes do grupo). Cache público de lista: [NÃO VERIFICADO] se `catalog_public_list` tem cache na API; a rota de escrita deve apenas servir `no-store`. |
| Sinônimo duplicado | [VERIFICADO] `unique (service_id, term_norm)`; sem acento e sem caixa. Erro 23505 vira 409 com campo `term`. Sinônimo inativo ainda ocupa o termo: a mensagem deve sugerir reativar. O mesmo termo em dois serviços é permitido e devolve os dois na busca. |
| Perda de histórico | [VERIFICADO] sem DELETE, `restrict`, revisões e semente append-only (gatilhos `enable always`); semente só insere e nunca desfaz edição (`on conflict do nothing`, sem `update`). Risco restante: dois administradores editando juntos; `CT003` (versão em conflito) vira 409 e a tela recarrega sem perder o texto digitado. |
| Mudança de modalidade ou regulamentado afeta pedidos | [VERIFICADO] o rascunho de pedido só guarda `service_id` (FK) e exige serviço ativo ao criar; nenhuma cópia de modalidade. [NÃO VERIFICADO] a tabela do pedido publicado (história posterior). Regra [PROPOSTA]: vale só para busca e novos pedidos. |
| Ponte de identidade confia no servidor | `app_api` executa as funções e poderia, se comprometido, forjar os `set_config`. Mesmo risco já aceito em H-108 (leitura do painel sem checagem no banco). Mitigação: só a rota chama; teste de que `anon`/`authenticated` não executam. |
| Tirar a marca de regulamentado | Risco jurídico (L4). [PROPOSTA] auditado como as demais; dupla aprovação fica em P-107-2. |

## 6. Testes e critérios verificáveis (local, `corepack pnpm check:all`)

- **Banco** (`packages/db/tests/catalog-service.dbtest.mjs` já cobre as funções; acrescentar): listagem de revisão exige `catalog.manage`; ausência de relação `promo|discount|coupon` em `app`; funções do catálogo não citam `plan`/`payment`.
- **Domínio** (`packages/domain`): rotas novas no registro com `catalog.manage`; item `catalogo` do menu com `rota` e sem ela para outros papéis; mapeamento de erros (42501, CT002, CT003, CT004, CT005, 23505, 23503) para estados e campos.
- **API** (`apps/api/tests`, no padrão de `admin-ops-route`): sem cookie, sem `aal2`, sem permissão e papel diferente de superadmin (todos os cinco outros papéis) negados e **sem chamar o banco**; origem inválida; corpo acima de 8 KB; ponte de identidade monta os quatro `set_config` a partir da guarda; erro de banco gera 503 sem detalhe; `no-store`.
- **Fim a fim com banco** (CA do refino): CA-03 criar serviço; CA-04 "Obra", "OBRA", "óbra" recusados; CA-05 desativar some da busca H-019 e reativar volta; CA-06 modalidade com antes/depois na trilha; CA-07 cada operação gera exatamente um evento e uma revisão (contagem antes/depois); CA-08 troca de posição aparece em `catalog_public`; CA-09 semente reaplicada mantém renome/desativação.
- **Tela** (`apps/admin`): rótulos nos campos, uso só por teclado, erro ligado ao campo, estado vazio "Nenhum item encontrado", erro ao salvar mantém o texto.
- **Critério de saída:** `check:all` verde com contagens registradas na Issue; nenhum teste usa credencial real; nenhuma chamada ao Supabase remoto.

## 7. Dúvidas não bloqueantes (com recomendação)

- **P-107-1.** Respostas de negação: o refino (CA-01) pede 401 sem sessão e 403 sem permissão; o padrão atual (H-102/H-108) responde 404 idêntico à rota inexistente para quem não tem sessão/`aal2`, e distingue só o caso de permissão. Recomendação: seguir o padrão atual do console (não revela a rota) e ajustar o texto de CA-01 no refino; os testes afirmam o padrão atual.
- **P-107-2.** Dupla aprovação para remover a marca de regulamentado. Existe `approval_request` na migração `..300000`, mas ligada ao acesso a conversa [NÃO VERIFICADO] que sirva para catálogo. Recomendação: MVP com aprovação simples e auditoria; dupla aprovação como item futuro.
- **P-107-3.** Exigir confirmação recente do segundo fator (`totp_at`, H-073) nas alterações, além de `aal2`? Recomendação: não no MVP; `aal2` basta e o volume é baixo. Reavaliar se o catálogo ganhar preço.
- **P-107-4.** Migração do histórico (`catalog_revision_list`) aceita? Sem ela a tela não mostra "quem mudou o quê". Recomendação: aceitar (é leitura, sem tabela).
- **P-107-5.** Reordenação em lote de grupos. Recomendação: fora do MVP; troca de duas posições em duas chamadas basta para ~25 grupos.

## 8. Handoff ao DEV

Ordem: (1) migração de leitura de revisões + teste de banco; (2) registro de rotas e erros no domínio; (3) adaptador da ponte de identidade e rotas na API, ligadas por opção em `composicao.ts` (sem opção = 404, como H-108); (4) tela e menu; (5) testes de §6. Não alterar as funções de escrita existentes sem nova migração e sem revisão deste desenho. Não alterei GitHub, Project, banco remoto nem código.
