# Desenho H-109 — Mecanismo de retenção sem prazos (Issue #118, WF-03, Arquitetura)

- **Issue:** #118 · **História:** H-109 · **Entrada:** 79-REFINO-H109 (CA-H109-01 a 12) · **Data:** 2026-11-12 · **Papel:** Software Architect
- **Etiquetas:** `[DECIDIDO]` em 11-DECISOES/ADR · `[VERIFICADO]` conferido em arquivo/migração · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` fora do alcance desta leitura.
- **Base `[VERIFICADO]`:** 09 §3 (`retention_policy`, `legal_hold`), 09 §8 (RC-01 a RC-11, "valor nulo = job desligado"); `audit.audit_event` append-only com `private.audit_append` e catálogo `audit.action_catalog` com allowlist de chaves (H-006); tick pg_cron de 1 min + `private.job_enqueue(kind, chave, null, null, 5)` e registro de handlers (`jobs-tick.ts`; padrão do `auth.challenge.purge`, H-011); RBAC `app.admin_permission`/`admin_role_permission` e `app.approval_request`/`approval_vote` com `private.approval_vote_guard` (H-102/H-105).
- **Decisão:** `ARQUITETURA_PRONTA`. Nenhum prazo, base legal ou ação por classe entra no código ou em migração `[DECIDIDO]`.

## 1. Política de retenção por classe

Tabelas novas (esquema `app`; migração em timestamp posterior à última existente, com rollback em `supabase/rollbacks/`) `[PROPOSTA]`:

| Tabela | Colunas principais | Regras (CHECK/gatilho) |
|---|---|---|
| `retention_policy` | `id`, `data_class` (único; RC-01 a RC-07, RC-10), `trigger_event`, `period interval` **nulo**, `action` {excluir, anonimizar, reter}, `legal_basis_ref`, `approved_by`, `effective_from`, `enabled` **false**, `dry_run` **true**, `updated_at` | `enabled` exige `period`, `action`, `legal_basis_ref`, `approved_by`, `effective_from` não nulos. RC-07 só aceita `reter` (guarda dura no banco). Sem DELETE; escrita só por função `private.*`. |
| `retention_policy_change` | `id`, `policy_id`, valores propostos, `requested_by`, `approval_request_id`, `status` | Única porta de mudança da política (seção 5). |
| `legal_hold` | `id`, `subject_type`, `subject_id`, `reason_code` (código, sem texto livre), `placed_by`, `placed_at`, `released_by?`, `released_at?` | Ativo = `released_at is null`. Nunca apagado. |
| `retention_object_queue` | `id`, `policy_id`, `bucket`, `object_path`, `state` {pendente, removido}, `attempts` | Só caminhos de objeto; sem dado pessoal em claro. |

- **Semeadura:** a migração cria uma linha por classe com `period = null`, `enabled = false`, `dry_run = true`. Nenhum número de dias, meses ou anos para RC-xx em migração, código ou seed `[DECIDIDO]`.
- **RC-08, RC-09, RC-11 ficam fora** da tabela (`data_class` não os aceita): TTL técnico é H-110; backup é operação `[DECIDIDO, refino §4]`.
- **`legal_hold`** suspende **todas** as classes do sujeito (`user` ou `request`); o hold é consultado de novo na fase final de cada lote (seção 2).
- **Privilégios:** `revoke all` para `public/anon/authenticated/service_role`; RLS forçada; execução apenas por `app_system`/papel do job, como nas demais tabelas de `app` `[VERIFICADO, padrão das migrações H-102]`.

## 2. Job de expurgo pelo tick

- **Job:** `retention.purge`, enfileirado 1x por dia por `pg_cron` (`select private.job_enqueue('retention.purge', 'retention.purge:<data>', null, null, 5)`), executado pelo tick (H-008). Idempotente por chave do dia; continuação: `retention.purge:<data>:c<n>` com teto de 50 por dia `[PROPOSTA]`.
- **Handler** em `packages/db/src/retention-jobs.ts`, registrado em `apps/api/src/composicao.ts` (padrão `registerChallengeHandlers`). Sem política `enabled`, o handler retorna sem tocar em nada (**CA-H109-01**).
- **Por classe habilitada e por lote** (padrão 100 linhas, teto de tempo por execução; valores em `ops.app_config`, não são prazos):
  1. **Fase A (SQL, 1 transação):** `select ... for update skip locked` das linhas elegíveis = gatilho ocorrido há mais de `period`, sem `legal_hold` ativo, `effective_from` vencido. Marca `retention_state='expurgando'` e grava os objetos em `retention_object_queue`.
  2. **Fase B (Node, fora do banco):** remove cada objeto no Storage pela API; remover objeto já ausente conta como sucesso. Falha: `attempts+1`, a linha continua `expurgando`.
  3. **Fase C (SQL, 1 transação):** para linhas cujos objetos estão todos `removido`: reconfere `legal_hold` (hold novo reverte a marca e conta como suspenso), aplica a ação (excluir ou anonimizar) e chama `private.audit_append` **na mesma transação**.
- **Auditoria por lote:** ação `retention.batch.executed`, `object_type='retention_policy'`, `object_id`=id da política, ator `system:retention` (papel `system`). Chaves do estado (allowlist no catálogo): `data_class`, `action`, `eligible`, `processed`, `held`, `failed`, `dry_run`, `batch_no`. Só contagens; sem id de sujeito, sem texto livre `[VERIFICADO, I-15 e 09 §3]`.
- **Simulação (`dry_run=true`):** calcula `eligible`/`held` e grava o evento, sem mutar. Passar a `dry_run=false` é uma mudança aprovada à parte (seção 5) `[PROPOSTA]`.
- **Idempotência:** exclusão é naturalmente repetível; anonimização marca `anonymized_at` e a segunda passada não casa; o evento só existe se a transação do lote confirmou, logo reexecução não duplica (**CA-H109-07**).

## 3. Expurgado, anonimizado ou retido, por classe

Alvos e colunas de cada classe são **código/contrato**, os prazos são **dado**. Cada classe é implementada por um adaptador `private.retention_apply_<classe>(lote, ação)` entregue pela história dona da tabela `[PROPOSTA]`. Classe sem adaptador registrado: o handler registra `sem_alvo` na contagem e não faz nada.

| Classe | Alvo hoje | Ação possível (valor vem da política) | Estado |
|---|---|---|---|
| RC-01 documentos do profissional | `professional_profile` (`document_enc`, `document_hmac`) e bucket `identity-docs` | excluir: zera campos e remove objetos; anonimizar: idem, mantém registro mínimo | adaptador entregue em H-109 (colunas em 09 §10, migração de perfil profissional) |
| RC-02 cadastro | `app_user` (e-mail), `professional_profile` campos pessoais | anonimizar (e-mail → marcador irreversível, sem HMAC reutilizável); a linha permanece por FK | adaptador entregue em H-109 |
| RC-03 pedido, fotos, endereço, telefone | `service_request`, bucket `request-photos` | excluir mídia e dados exatos, manter registro mínimo | `service_request` ainda não existe `[NÃO VERIFICADO]`: contrato e teste com tabela sintética; adaptador na história do pedido |
| RC-04 conversas e anexos | `message` | excluir/anonimizar; hold obrigatório respeitado | idem (sem tabela) |
| RC-05 avaliações | `review` | manter ou anonimizar autor; nunca "indefinido" | idem; depende do jurídico |
| RC-06 financeiro/fiscal | `billing.payment` | só `reter` (verificação registrada) | idem |
| RC-07 auditoria e logs de acesso | `audit_event`, `sensitive_access_log` | **sempre reter**; gatilho de banco recusa outra ação | entregue em H-109 (guarda) |
| RC-10 consentimentos de contato | `consent`/prova | reter prova; remoção de dado associado só por adaptador | sem tabela |

- **`audit_event` nunca é tocado:** o job não tem privilégio de UPDATE/DELETE/TRUNCATE nele e os gatilhos AU001 continuam ativos **(CA-H109-08)** `[VERIFICADO, H-006]`. Pseudonimizar `actor_ref` fica fora (D-H109-b: reter integralmente).
- **Anonimizar** significa nenhuma coluna da linha com e-mail, telefone, endereço ou texto livre em claro (**CA-H109-10**, verificado por consulta). Se o jurídico exigir um conceito mais forte (irreversibilidade comprovada), é nova decisão.
- **Sujeito eliminado e avaliação (CA-H109-12):** o adaptador RC-05/RC-03 expõe o marcador `retention_state`; a negação na avaliação é implementada pela história de avaliações, validada lá `[PROPOSTA]`.

## 4. Storage no mesmo ciclo

- **Ordem escolhida:** objeto **antes** da linha (fases A, B, C da seção 2). Motivo: transação do banco não cobre o Storage. Se a linha saísse primeiro e a remoção do objeto falhasse, sobraria objeto órfão sem ponteiro; com objeto primeiro, o pior caso é linha marcada `expurgando` sem objeto, que a próxima execução conclui `[PROPOSTA]`.
- **Fim de ciclo:** não há objeto sem linha. Linha `expurgando` há mais de uma execução gera alerta operacional (nível de e-mail já existente) e entra na contagem `failed` do evento (**CA-H109-09**).
- Credencial do Storage fica no `.env.local` e no ambiente do job; nunca em tabela ou log `[DECIDIDO]`. Operação restrita à lista de buckets conhecidos (`identity-docs`, `request-photos`).

## 5. Cadastro dos prazos: papel próprio e aprovação dupla

- **Papel:** `governanca_dados` ("Governança de dados"), com a permissão `retention.policy.manage`; `legal_hold` usa `retention.hold.manage` no mesmo papel. O Superadmin **não** herda (separação de funções) `[PROPOSTA]`. Registra-se em `app.admin_role`/`admin_permission` por migração e exige MFA/passo reforçado como os demais papéis `[VERIFICADO, H-102/H-105]`.
- **Fluxo:** `private.retention_policy_propose(...)` cria `retention_policy_change` + `approval_request` (`action_type='retencao_politica'`, `detail_code`=id da mudança; amplia o CHECK de `approval_request` como a H-105 fez). Outro administrador distinto vota; `approval_vote_guard` já bloqueia autoaprovação **(CA-H109-03)**. `private.retention_policy_apply(...)` consome o pedido (uso único, validade 24 h) e só então altera a política.
- **Habilitar:** exige período, ação, base legal (`legal_basis_ref` = referência ao parecer, não texto), aprovador e vigência; senão recusa e audita **(CA-H109-02)**. Tentativa recusada: gravar em transação separada da que levanta a exceção, como `admin_self_grant_denied_record` `[VERIFICADO, padrão]`.
- **Hold:** colocar é imediato (ato protetor) por quem tem `retention.hold.manage`; **liberar** exige a mesma aprovação dupla `[PROPOSTA]`. Eventos: `retention.policy.proposed|changed|denied`, `retention.hold.placed|released`.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Apagar dado com fundamento errado (prazo de fonte duvidosa) | Nenhum prazo no código; `enabled=false` por padrão; `legal_basis_ref` obrigatório; `dry_run` obrigatório antes da execução; aprovação dupla; migrações sem prazos. |
| Expurgo parcial (queda entre banco e Storage) | Fases A/B/C com marca `expurgando`, lote em transação única, retomada idempotente, alerta de pendência. |
| Perda de prova (litígio, auditoria, consentimento) | `legal_hold` relido na fase C; RC-07 e RC-06 só `reter`; `audit_event` intocável; RC-10 retém a prova. |
| Hold colocado depois da marcação | Fase C reconfere; hold novo reverte a marca. |
| Adaptador removendo mais que o devido | Teste por classe com tabela sintética; escopo do `DELETE/UPDATE` por `id` do lote, nunca por predicado largo. |
| Job lento no plano gratuito | Lotes pequenos, teto de tempo, continuação com teto diário; atraso de dias é aceitável. |
| Segredo ou dado pessoal em log/evento | Apenas contagens e códigos; allowlist do catálogo rejeita chaves proibidas `[VERIFICADO, H-006]`. |

## 7. Testes e critérios verificáveis (local)

Comandos: `corepack pnpm check:all`, `db:test`, `lint`, `typecheck`, `test`; resultado, contagem e código de saída registrados na Issue. Dados somente sintéticos; períodos curtos só em fixtures de teste `[VERIFICADO, ADR-016]`.

| Critério | Verificação |
|---|---|
| CA-H109-01 | db-test: todas as políticas `period null`; rodar o handler; contagem de linhas e objetos antes = depois. |
| CA-H109-02/03 | db-test: habilitar sem período recusa e deixa evento `retention.policy.denied`; autoaprovação recusada; sem voto distinto não há `apply`. |
| CA-H109-04/05 | tabela sintética com gatilho passado e futuro; só o primeiro recebe a ação; evento do lote na mesma transação (consulta por `seq`). |
| CA-H109-06 | hold ativo suspende e conta em `held`; hold liberado, entra no ciclo seguinte; hold posto entre A e C reverte. |
| CA-H109-07 | falha injetada entre fases; reexecução gera o mesmo estado final; um único evento por lote. |
| CA-H109-08 | cadeia `private.audit_verify_chain` íntegra antes/depois; UPDATE/DELETE em `audit_event` continuam negados. |
| CA-H109-09 | Storage fake no teste unitário: falha de remoção deixa a linha `expurgando` e nenhum objeto órfão. |
| CA-H109-10 | consulta nas colunas da linha anonimizada sem padrões de e-mail, telefone ou endereço. |
| CA-H109-11 | teste de busca nas fontes de retenção e migrações: nenhum literal `interval '<n> day|month|year'`, nem `<n> anos` associado a RC-xx; linhas semeadas com `period null`. |
| CA-H109-12 | **não verificável em H-109** (sem `review`); fica como contrato do adaptador e teste na história de avaliações. |
| Guardas | RC-07 com ação diferente de `reter` recusa; `data_class` RC-08/09/11 recusa; privilégios (`has_table_privilege`) negados para papéis de aplicação. |

## 8. Dúvidas

**Pendência jurídica (já aberta como Q-H109-1; não bloqueia o desenvolvimento, bloqueia só a ativação com dado real):**

- **J-1 (L1; L2 para RC-10):** prazo, gatilho, ação e base legal de cada classe RC-01 a RC-07 e RC-10; manter ou anonimizar avaliações; exclusão do titular versus backups (RC-11). **Recomendação:** `period` nulo até o parecer.
- **J-2 (L1):** o que o jurídico aceita como "anonimizado" para RC-02/RC-05 (descaracterizar o e-mail e o autor mantendo a linha). **Recomendação:** adotar a definição do parecer sem mudar o mecanismo; não afirmar conformidade antes dele.

**Não bloqueantes (recomendação do arquiteto):**

- **A-1, nome do papel:** `governanca_dados`. Alternativa: permissão avulsa em `superadmin` (rejeitada pela separação de funções).
- **A-2, liberação de hold com aprovação dupla:** recomendada; alternativa de aprovação simples é mais rápida, mas permite liberar prova sozinho.
- **A-3, `dry_run` obrigatório:** recomendado; custa uma mudança aprovada a mais por classe.
- **A-4, buckets `identity-docs` e `request-photos`:** `[NÃO VERIFICADO]` se já existem no projeto Supabase (este desenho não usou o MCP). O DEV confirma no ambiente local e, se faltarem, o adaptador RC-01 testa com Storage fake e a verificação real fica para a história dona do bucket.
- **A-5, entrega parcial de adaptadores:** RC-01, RC-02 e RC-07 agora; RC-03 a RC-06 e RC-10 acompanham a criação de suas tabelas. **Recomendação:** aceitar, com teste de contrato genérico em H-109.

## 9. Handoff ao DEV

Ordem: (1) migração + rollback + catálogo de ações + papel/permissões + ampliação de `approval_request`; (2) funções SQL de propor, aplicar, hold e lote (fases A e C); (3) handler Node (fase B) e registro em `composicao.ts`; (4) adaptadores RC-01, RC-02, RC-07; (5) testes da seção 7. Limites: não ativar prazo real; não tocar `audit_event`; sem e-mail novo; sem constantes de prazo.
