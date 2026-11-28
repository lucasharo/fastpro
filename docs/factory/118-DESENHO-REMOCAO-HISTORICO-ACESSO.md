# 118 — Desenho técnico: remoção do histórico de acesso às fotos (Issue #150)

- **Issue:** #150 `[E6] Remover o histórico de acesso às fotos (media_access_log e resumo diário)`
- **Workflow:** WF-03, etapa Arquitetura. Entrada: `117-REFINO-REMOCAO-HISTORICO-ACESSO.md`, Rodadas 67 e 68 de `11-DECISOES.md`.
- **Data:** 2026-11-13. Este documento não altera código, migrações, banco nem quadro.
- **Etiquetas:** `[VERIFICADO]` lido nesta etapa · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` a conferir pelo DEV.

---

## 1. Fatos verificados que moldam o desenho

1. `[VERIFICADO]` A orquestração dos blocos E1 a E9 é **em TypeScript** (`packages/db/src/ops-purge-jobs.ts`, `montaExecutoresOpsPurge`), uma chamada SQL por bloco. **Não existe função SQL orquestradora** com bloco E8. Logo a "remoção do bloco E8" no banco é só `drop function private.ops_purge_media_access(timestamptz, integer)`. Nenhum `create or replace` de orquestrador é necessário.
2. `[VERIFICADO]` Prefixo livre: o último arquivo é `20261113170000_billing_create_access_grant.sql` (e seu `.down.sql` em `supabase/rollbacks`). **Prefixo novo: `20261113180000`.** Conferir de novo com `ls` imediatamente antes de criar (outra Issue pode ter tomado o número).
3. `[VERIFICADO]` As migrações **não** levam `begin/commit`; o executor (`packages/db/scripts/db.mjs`) abre a transação. Os rollbacks **levam** `begin; ... commit;`.
4. `[VERIFICADO]` `ops.media_access_daily` tem RLS forçada e **nenhum** privilégio a papel algum (revoke de `public, anon, authenticated, service_role, app_api, app_backup_reader`). Ao apagar a tabela, os privilégios somem com ela. A função tem `execute` só para `app_system`, que some com o `drop function`. **Não há `revoke`/`grant` a escrever na migração nova.**
5. `[VERIFICADO]` `ops.app_config` tem `key text primary key` e `value jsonb`, RLS **forçada e sem políticas**. Risco: um `delete` feito por papel sem `BYPASSRLS` apagaria **zero linhas sem erro**. Mitigação no desenho (seção 2, passo 4).
6. `[VERIFICADO]` O catálogo de auditoria `ops.purge.executed` (migração antiga, seção 15) lista **37 chaves** (`run_no` + 9 blocos x 4). O gatilho de `audit_event` exige que as chaves gravadas sejam **subconjunto** (`k <> all(state_keys)` falha). Logo, emitir 33 chaves (sem `e8_*`) é aceito pelo banco sem mudar o catálogo. **Ponto de conflito com a decisão 324 ("auditoria como está") tratado na pergunta 329.**
7. `[VERIFICADO]` Testes que fixam "37": `packages/domain/tests/ops-purge.test.ts` (linhas 125 a 129), `packages/db/tests/ops-purge-adapters.test.ts` (333 a 343), `packages/db/tests/ops-purge-h110.dbtest.mjs` (423, que lê o **catálogo**, e continua 37 se o catálogo não mudar).
8. `[VERIFICADO]` O teste de grants D-02b (`audit.dbtest.mjs`, linha 183) lista funções de `private` que `app_api` executa; **não cita** `ops_purge_media_access` nem `media_access`. Nenhuma edição nele.
9. `[VERIFICADO]` `ops.rate_counter` existe (migração `20261110130000`: `key_hmac`, `window_start`, `count`). `abuse_signal` **não aparece** em nenhuma migração: é criada pela #70, não por esta Issue.
10. `[NÃO VERIFICADO]` Papel que o executor usa no DEV (precisa ser dono da função e ter `BYPASSRLS` ou ser superusuário para o `delete` em `app_config`). A migração falha de forma explícita se não for (passo 4).

---

## 2. Migração nova

**Arquivo:** `supabase/migrations/20261113180000_ops_remove_media_access_history.sql`
**Rollback:** `supabase/rollbacks/20261113180000_ops_remove_media_access_history.down.sql`

Cabeçalho obrigatório: Issue #150, Rodada 67 (decisão 158 opção A), Rodada 68, "não toca nenhuma outra tabela", caminho do rollback.

Conteúdo, **nesta ordem** (sem `begin/commit`; transação do executor):

1. `set local lock_timeout = '5s';` (falha rápida se o job de expurgo segurar a função; sem espera longa).
2. Função primeiro, para ninguém mais escrever na tabela:
   `drop function if exists private.ops_purge_media_access(timestamptz, integer);`
   Isso **é** a remoção do bloco E8 do banco. Perde-se junto o `pg_try_advisory_xact_lock(hashtext('ops.purge.e8'))` (sem objeto a limpar).
3. Evidência, sem identificador de sujeito:
   `do $$ ... if to_regclass('ops.media_access_daily') is not null then execute 'select count(*) from ops.media_access_daily' into v_n; raise notice 'media_access_daily_linhas=%', v_n; end if; end $$;`
   Só o número (CA-H150-04). A migração **não** aborta se o número for maior que zero: a remoção é autorizada pela Rodada 67 (risco 1 do refino). O DEV registra a contagem **antes** com consulta própria (seção 7).
4. Chaves de configuração: 
   `delete from ops.app_config where key in ('purge.media_access_rollup_after_seconds','purge.media_access_detail_seconds');`
   Em seguida, guarda: `if exists (select 1 from ops.app_config where key like 'purge.media_access\_%' escape '\') then raise exception 'config_media_access_nao_removida' using errcode = '23514'; end if;` Assim o caso "RLS forçada sem BYPASSRLS" vira erro, nunca sucesso silencioso. Antes do `delete`, um `raise notice` com **chave e valor** das linhas encontradas (valor é prazo em segundos, não dado pessoal), para o rollback poder ser fiel (pergunta 330).
5. Tabela: `drop table if exists ops.media_access_daily;` (sem `cascade`: a tabela não tem dependentes `[VERIFICADO]`, sem FK; se alguém criou dependente, o erro é desejável).
6. **Nada mais.** Sem `create`, `grant`, `revoke`, `insert`. Sem `drop` de `ops.media_access_log` nem de `app.media_access_log` (nunca existiram, CA-H150-05). **Não alterar** `audit.action_catalog` (pergunta 329). Não tocar `audit_event`, `contact_reveal_log`, `app.media_asset`, `ops.rate_counter`, E1 a E7 e E9.

Idempotência (CA-H150-03): `drop ... if exists`, `delete` sem efeito na segunda vez, guarda passa. Reaplicar sem erro.

Por que `drop function` e não `create or replace` esvaziando o bloco: não há orquestrador no banco; esvaziar a função manteria código morto e a concessão a `app_system`. É a menor mudança possível.

### 2.1 Rollback (`.down.sql`), sem copiar código antigo

`begin; ... commit;`, idempotente, execução manual só em DEV (mesmo cabeçalho dos demais):

1. Recria **somente a estrutura vazia** de `ops.media_access_daily` com `create table if not exists`, colunas e restrições iguais às da migração `20261112230000` (`professional_id uuid`, `day date`, `outcome text` com check `('ok','negado','limitado')`, `n bigint >= 0`, `rolled_at timestamptz`, PK `(professional_id, day, outcome)`); `enable` e `force row level security`; `revoke all` dos mesmos papéis; `comment`. Isso é a **definição da estrutura**, não código de função, e é o que a convenção do projeto pede (pergunta 326).
2. Chaves de `ops.app_config`: reinserir `purge.media_access_rollup_after_seconds` com o valor proposto no runbook (86400) **somente** `on conflict do nothing`; **não** reinserir `purge.media_access_detail_seconds` (a regra do runbook é "nulo"). Detalhe na pergunta 330. Dado que o valor real do DEV é impresso na migração (passo 4), o executor do rollback pode ajustar à mão.
3. **Não restaura a função** `ops_purge_media_access` e **não restaura linhas**. Termina com `raise notice` explicando: "a função está em 20261112230000 seção 12; para reativar, recriar a função a partir dela e reintroduzir o bloco no TypeScript; dados removidos não voltam" (CA-H150-16).

---

## 3. Mudanças por arquivo de código

| Arquivo | Mudança |
|---|---|
| `packages/domain/src/ops-purge/types.ts` | `BLOCOS_OPS_PURGE = ['e1','e2','e3','e4','e5','e6','e7','e9']` (8 itens). Atualizar o comentário "E1 a E9" para "E1 a E7 e E9 (E8 removido pela #150, letra não reaproveitada)". Decisão 324: E9 mantém a letra. |
| `packages/domain/src/ops-purge/orquestra.ts` | Só o comentário da linha 2 ("E1 a E7 e E9"). Verificar que a montagem das chaves de contagem deriva de `BLOCOS_OPS_PURGE` (então passa a emitir 33 chaves sozinha); se houver lista literal de chaves, remover `e8_*`. `[NÃO VERIFICADO]` (arquivo não lido por inteiro nesta etapa). |
| `packages/db/src/ops-purge-jobs.ts` | Remover a linha `blocoSql('e8', store, agora, 'ops_purge_media_access')` de `montaExecutoresOpsPurge`; comentários das linhas 3 e "Monta os executores E1 a E9" para "E1 a E7 e E9". Conferir se `blocoSql` ainda é usado (sim: e2 a e5) para não deixar import morto. |
| `packages/db/src/ops-purge-store.ts` | Remover `'ops_purge_media_access'` do tipo `FuncaoBlocoOpsPurge`. Se houver lista de funções permitidas em tempo de execução (allowlist de nomes de função usada para montar o SQL), remover lá também. `[NÃO VERIFICADO]` |
| `apps/**` | Nenhuma mudança (busca do PO: sem ocorrência). |

Nenhuma dependência nova, nenhuma variável de ambiente, nenhum segredo.

## 4. Mudanças por arquivo de teste

| Arquivo | Mudança |
|---|---|
| `packages/domain/tests/ops-purge.test.ts` | Ordem "E1 a E9" passa a `BLOCOS_OPS_PURGE` sem `e8` (o teste já usa a constante: só ajustar o título e conferir `toEqual` de 8 itens). Linhas 46 a 71: o teste que usa `'e8'` como bloco de exemplo (`pulado_incompativel`) passa a usar `'e5'` (E5 é o bloco que também pode ser pulado), mantendo a asserção `e5_pulado`. Linhas 125 a 129: `toHaveLength(33)`; título "33 chaves inteiras (subconjunto do catálogo de 37)". A regex `e[1-9]` continua válida. |
| `packages/db/tests/ops-purge-adapters.test.ts` | Linhas 333 a 345: `toHaveLength(33)`; título "33 contagens". Sem outra mudança (não cita E8). |
| `packages/db/tests/ops-purge-h110.dbtest.mjs` | (a) linhas 160 a 161: tirar `ops_purge_media_access` da lista de funções com grant; (b) 307 a 336 (CA-H110-09) e 347 a 352 (CA-H110-16b): **remover**; (c) 340 a 343: remover só a parte E8 de CA-H110-16, **manter** `provider_event`; (d) linha 441: trocar `has_table_privilege('ops.media_access_daily')` por asserção `to_regclass('ops.media_access_daily') is null`; (e) linha 423: **manter 37** (catálogo inalterado); acrescentar comentário "o catálogo é allowlist; a execução emite 33"; (f) **novo** teste CA-H150-02/05/06 (ausência de tabela, função e chaves) e CA-H150-03 (reaplicar o SQL da migração nova uma segunda vez sem erro; ler o arquivo e executar). Os dbtests rodam contra o banco já migrado, então o teste de ausência vale **depois** da migração nova aplicada. |
| `packages/db/tests/ops-purge-migration.test.mjs` | Os asserts sobre o arquivo **antigo** (linhas 37, 92 a 95, 124, 132 a 133) continuam válidos: o arquivo antigo não muda e o teste prova isso. Só tirar `ops_purge_media_access` de qualquer lista que represente o **estado ativo** (a lista da linha 37 é "funções criadas pela migração antiga": manter e renomear a constante para deixar claro que é histórica). |
| `packages/db/tests/ops-remove-media-access-migration.test.mjs` | **Criar** (estático, sem banco): lê a migração nova e o rollback novo e afirma: nome e prefixo maiores que o último anterior; contém `drop function if exists private.ops_purge_media_access`; `drop table if exists ops.media_access_daily` **sem** `cascade`; contém o `delete` das duas chaves e a guarda `config_media_access_nao_removida`; **não** contém `create`, `grant`, `insert`, `truncate`, `alter`, `drop ... media_access_log`, nem `audit_event`/`contact_reveal_log`/`media_asset` (CA-H150-05 e 16); rollback tem `begin`/`commit`, `if not exists`, não contém `create or replace function` (sem código antigo) e não contém `insert into ops.media_access_daily`. |
| `packages/db/tests/backup-roles.dbtest.mjs` | Remover `'ops.media_access_daily'` do `Set` (linha 124) e a linha de comentário 112. Demais exceções intactas (CA-H150-13). |
| `packages/db/tests/ops-purge-sem-prazo-fontes.test.mjs` | Manter; só conferir que segue verde (lê arquivos antigos). |
| `packages/db/tests/audit.dbtest.mjs` (D-02b) | **Sem mudança**; só conferir verde (grep: não cita a função). |

Nenhum teste existente é apagado sem substituto: E8 é substituído por ausência (CA-H150-08).

## 5. Documentos a editar (o que dizer)

Regra geral: texto vigente muda; histórico ganha **nota**, sem reescrita. Cada nota: "Substituído pela Rodada 67 e pela #150 em 2026-11-13: sem log por acesso a foto; limite por contador e sinal de raspagem."

| Doc | Edição |
|---|---|
| `04-PRD.md` (RF-030, ~l.153) | Trocar "log de acesso por profissional" por: "limite de visualizações por profissional (contador por janela), marca d'água opaca e URL de uso único de ~60 s; excesso gera 429 e um sinal de raspagem por janela estourada; **nenhum registro por acesso**". Nota de supersessão pela Rodada 67. |
| `05-CRITERIOS-ACEITE.md` (FA-007/D10, ~l.127) | "o acesso é registrado em log por profissional" vira "o acesso é limitado (429) e o excesso gera sinal de raspagem, sem registro de cada acesso". |
| `08-ARQUITETURA.md` (l.127 e §10.3 ~l.380) | Tirar `media_access_log` da tabela de módulos; §10.3: "contador por profissional em `ops.rate_counter` e sinal em `abuse_signal` (criado na #70) só no estouro". Acrescentar o que se perde (quem viu qual foto e quando; prova por registro; padrão além da janela). |
| `09-MODELO-DADOS.md` (§3 l.109; §7 l.211/218; §9 l.265; §10 l.271/273) | Remover a entidade `media_access_log`, a linha de capacidade e o rollup/remoção de detalhe; "Log de acesso" da linha de fotos vira "—". Se `media_access_daily` for citada, remover. |
| `10-ADRS.md` (ADR-009, l.113) | "log compacto" vira "contador de limite" (sem log por acesso). Referenciar Rodada 67. |
| `11-ARQ-RISCOS-E-TESTES.md` (l.118, R-03 l.193, T-07 l.303) | "log de acesso" para "contador de limite"; T-07: "429 e sinal" (sem "log"). R-03: acrescentar o risco aceito de proteção mais fraca (refino §6.3). |
| `14-BACKLOG.md` (H-057 l.175; H-110 l.265) | H-057: título e critérios "limite de visualizações por profissional (contador) e sinal de raspagem; excesso → 429 e sinal"; H-110: remover "rollup de `media_access_log`" e acrescentar "E8 removido pela #150". |
| `15-RASTREABILIDADE.md` | A busca do PO não citou o arquivo e a busca desta etapa por `media_access`/"log de acesso" não achou ocorrência. O DEV roda `grep -n -i "media_access\|log de acesso\|raspagem"`; se RF-030/FA-007/D10/H-057 aparecerem, apontar para #150 e Rodada 67; senão **sem edição**. Adicionar a linha de rastreio RF-030 → #150 se o arquivo tiver coluna de Issue. |
| `16-MANIFESTO-ISSUES.md` (l.139/140) e `17-CHECKLIST-REVISAO.md` (l.248) | "429 e log por profissional" / "log de acesso" para "contador de limite e sinal". Nota da divergência de numeração (67/68 do manifesto = #69/#70 do quadro). |
| `103-REFINO-H110.md` e `105-DESENHO-H110.md` | **Só nota de supersessão no topo**; marcar Q-H110-1 como obsoleta; E8, RN-H110-09, CA-H110-09 e parte E8 de CA-H110-16 sem objeto. Não reescrever. |
| `108-RUNBOOK-TTL-EXPURGOS.md` (l.29, 30, 44, 94, 102) | Remover as duas linhas de chave E8, a conferência da l.94 e a pendência da l.102; nota na decisão 158: "removido pela #150". Acrescentar passo de conferência pós-migração: `select key from ops.app_config where key like 'purge.media_access%'` deve devolver zero linhas. Atualizar "37 chaves" para "33 emitidas (catálogo permite 37)" onde aparecer. |
| `11-DECISOES.md` | Nota no D10 (e na l.421, pergunta 158) apontando a Rodada 67; ao final, Rodada 69 com as decisões 329 a 332 do líder. Não apagar histórico. |
| `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md` (l.249) | Nota opcional: "exceção `ops.media_access_daily` removida pela #150". |
| `quadro-status.md` / `quadro-dados.js` | Fora do DEV; Orquestrador move o cartão; `quadro-dados.js` é regenerado. |

## 6. Ordem de execução do DEV

0. Confirmar branch `feature/init`, árvore limpa e `ls supabase/migrations | tail -3` (prefixo livre > último). Não rodar em paralelo com #140 e #145 nos mesmos arquivos de teste (risco 8 do refino).
1. Capturar linha de base (somente leitura, via `npx supabase`/executor, sem Docker, sem MCP): `count(*)` de `ops.media_access_daily` e contagem de linhas de todas as demais tabelas de `ops`, `app` e `audit` (consulta genérica sobre `pg_stat_user_tables`/`count(*)` por tabela, resultado só numérico); `select key from ops.app_config where key like 'purge.media_access%'`; `to_regclass` das duas origens de log. Registrar na Issue (CA-H150-04).
2. Escrever os testes novos/alterados **primeiro** (ausência, estático da migração, 33 chaves) e ver falharem onde esperado.
3. Alterar TypeScript (seção 3) e testes unitários; rodar `corepack pnpm typecheck`, `test`, `lint`.
4. Criar migração e rollback; rodar o teste estático.
5. Aplicar no DEV com `npx supabase` (ou `db:migrate`); registrar o `notice` da contagem e das chaves.
6. Reaplicar o SQL da migração uma segunda vez (CA-H150-03) e conferir sem erro.
7. Repetir a contagem das demais tabelas (CA-H150-04) e comparar.
8. `corepack pnpm db:test`, depois `check:all`; registrar comando, contagem e código de saída (CA-H150-18). Não declarar CI verde.
9. Editar documentos (seção 5). Rodar a busca textual de CA-H150-01 e registrar o resultado; a lista de exceções é: migrações e rollbacks antigos, doc 117, este doc 118, documentos históricos do refino 117 §5.4, notas de supersessão, a migração nova (cita o nome para remover) e os testes que afirmam ausência.
10. CA-H150-17: `git diff --exit-code <commit-base> -- supabase/migrations/20261112230000_* supabase/migrations/20261113130000_* supabase/rollbacks/20261112230000_* supabase/rollbacks/20261113130000_*` com código 0; registrar o commit-base.
11. Commit em `feature/init` (sem push de produção, sem merge pelo DEV), mensagem citando #150.

## 7. Plano de testes por critério

| CA | Como é provado |
|---|---|
| H150-01 | `grep -rn -i "media_access_log\|media_access_daily\|ops_purge_media_access\|log de acesso" packages apps supabase docs/factory`; resultado só nas exceções acima. Evidência: saída arquivada na Issue. |
| H150-02 | dbtest: `to_regclass('ops.media_access_daily') is null` e `count(*) from pg_proc where proname='ops_purge_media_access'` = 0. |
| H150-03 | dbtest: executar o texto da migração duas vezes, sem erro. |
| H150-04 | Consulta antes e depois (seção 6, passos 1 e 7), números iguais fora da tabela removida. |
| H150-05 | Estático (sem `drop` de `*.media_access_log`) e dbtest (migração roda sem erro mesmo sem as origens). |
| H150-06 | dbtest: zero linhas `purge.media_access%` em `ops.app_config`; teste da guarda (inserir a chave, aplicar o bloco, esperar zero). |
| H150-07 | Unitário de domínio: ordem `e1..e7,e9`; adapters: 33 chaves sem `e8_*`; dbtest: evento `ops.purge.executed` aceito pelo gatilho com 33 chaves. |
| H150-08 | dbtest: CA-H110-09 e E8 de CA-H110-16 trocados por ausência; `provider_event` de CA-H110-16 verde. |
| H150-09, 10, 11, 12 | **Não são desta entrega.** Pertencem à #70 (contador, sinal, suspensão) e à #69 (URL de 60 s). Nesta Issue, só a **prova negativa**: nenhuma tabela de log por acesso existe. Registrar com a pergunta 331. |
| H150-13 | dbtest T-BK-09 verde com a exceção removida e as demais iguais. |
| H150-14, 15 | Revisão documental com a lista da seção 5; busca de CA-01 como apoio. |
| H150-16 | Estático no teste novo (rollback só estrutura vazia, sem função, sem inserção de dados do histórico). |
| H150-17 | `git diff --exit-code` (seção 6, passo 10). |
| H150-18 | Execução local registrada. |

## 8. Segurança e risco

- **Superfície reduzida:** some uma tabela com PII indireta (identificador de profissional por foto e dia) e uma função `security definer`. Nenhum privilégio novo, nenhuma exceção, nenhum papel novo. `app_api`, `anon`, `authenticated` e `service_role` seguem sem acesso a nada tocado.
- **Auditoria preservada:** `audit_event` e `contact_reveal_log` intactos. O catálogo `ops.purge.executed` permanece (allowlist de 37, emissão de 33).
- **Dados do DEV:** sem dado de produção. A remoção é autorizada como regra permanente para o DEV. Contagem registrada antes; o `notice` repete o número (sem identificadores).
- **Falha silenciosa evitada:** guarda pós-`delete` em `app_config` (RLS forçada, risco 5 da seção 1).
- **Concorrência:** `drop function` tem de aguardar o job de expurgo em andamento; `lock_timeout` de 5 s falha de forma explícita e a migração pode ser reaplicada. Rodar fora da janela do job diário (`ops-purge-daily`, só se `pg_cron` existir).
- **Risco residual aceito (do refino §6.3):** perde-se prova por foto/dia e detecção além da janela. Mitigação: marca d'água e contador (#69, #70). Registrar no R-03.
- **Jurídico RC-07:** pergunta 328 já registrada; **não bloqueia** esta Issue.
- **Atenção a #70:** enquanto a #70 não entrega contador e sinal, a produção não terá proteção de raspagem **por contador**; como a entrega de fotos a profissionais (#69) ainda é Backlog, não há exposição hoje `[VERIFICADO pelo refino: apps/ não tem ocorrência]`. A #69 e a #70 devem ser entregues juntas ou a #69 só pode ir a produção com a #70.
- **Sem e-mail, sem Docker, sem MCP do Supabase, sem rotação de senha** (pergunta 150 segue pendente e fora de escopo).

## 9. Perguntas ao líder (numeração a partir de 329)

**329 — Auditoria do expurgo sem E8: 33 chaves emitidas, catálogo mantido em 37.** A decisão 324 diz "manter E9 e a auditoria como estão"; ao tirar E8 do TypeScript, o evento deixa de trazer `e8_*` (33 chaves). O banco aceita (o catálogo é lista permitida, subconjunto).
- Opções: (a) emitir 33 e **não** mexer no catálogo; (b) emitir 33 e **reduzir** o catálogo para 33 por `update` na migração nova; (c) manter `e8_*` zerados fixos no evento.
- **Recomendação: (a).** Menor mudança; o catálogo tem FK dos eventos já gravados e é "alterado só por migração", (b) é risco sem ganho; (c) mantém contagem de um recurso removido (CA-H150-07 pede sem contagem de acesso). Destrava: testes "33" e CA-H150-07.

**330 — Valores das chaves de configuração no rollback.** O rollback pode devolver as chaves apagadas.
- Opções: (a) reinserir só `purge.media_access_rollup_after_seconds` = 86400 (valor do runbook) e deixar `detail` nulo; (b) reinserir os valores reais lidos no DEV antes (impressos no `notice`); (c) não reinserir chave alguma.
- **Recomendação: (a)** como padrão e o DEV ajusta à mão se o `notice` mostrar outro valor. (c) contraria a decisão 325 ("voltam no rollback"). Destrava: texto do `.down.sql`.

**331 — Prova de CA-H150-09 a 12 nesta Issue.** Esses critérios descrevem contador, sinal, suspensão e URL de 60 s, que são **entregas da #70 e da #69**, não da remoção.
- Opções: (a) mover os quatro critérios para a #70/#69 e manter na #150 apenas a prova negativa e documental; (b) implementar contador e sinal dentro da #150; (c) deixá-los "não aplicáveis" sem registro.
- **Recomendação: (a).** A #150 é remoção; (b) cria a #70 por dentro e mistura escopo. Registrar a transferência na Issue #70. Destrava: aceite da #150 e refino da #70.

**332 — Ordem de entrega #69 e #70 em produção.** Para a #69 não expor fotos sem contador.
- Opções: (a) #69 só vai a produção junto com a #70; (b) #69 antes, só com URL de 60 s e marca d'água; (c) sem restrição.
- **Recomendação: (a).** Mantém a proteção contra raspagem prevista no D10 depois de remover o log. Destrava: planejamento de ondas, não a #150.

## 10. Handoff

- **Pronto para Desenvolvimento** assim que as recomendações 329 a 332 forem adotadas pelo líder (ou vetadas). 329 e 330 só mudam texto de teste e do rollback; podem ser adotadas sem esperar.
- **Não há `ARQUITETURA_NAO_NECESSARIA`:** há decisão de contrato (auditoria 33 de 37, ausência de orquestrador SQL, guarda de RLS), por isso este documento existe.
- Interfaces: nenhuma API pública muda. `BlocoOpsPurge` perde `'e8'` (mudança de tipo interna ao domínio), `FuncaoBlocoOpsPurge` perde `'ops_purge_media_access'`.
