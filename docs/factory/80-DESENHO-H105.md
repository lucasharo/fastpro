# Desenho H-105 — Dupla aprovação para estorno e suspensão (Issue #114, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§7). **Natureza:** documento; nenhum código, migração ou teste criado.
- **Rastro:** 78-REFINO-H105; 60-DESENHO-H073 (mecanismo de aprovação); 09 §3.10 e §3.3; RF-151, RF-152, RF-154. Lido (somente leitura): migrações `20261111190000` (tabelas, gatilho), `20261111220000` (papéis, `admin_approval_open`, `admin_approval_vote`), `20261111290000`/`300000` (caso de acesso, guarda por tipo), `20261110140000` (catálogo), `20261111400000` (`professional_profile`).
- **Etiquetas:** `[DECIDIDO]` refino/Orquestrador · `[VERIFICADO]` lido no repo · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]`.

## 0. Fatos de partida

1. `[VERIFICADO]` `app.approval_request` tem `required_approvals smallint check (= 1)`, `subject_user_id` FK para `admin_staff` (nulo desde `220000`), `detail_code` obrigatório só em `papel_superadmin`, validade 24 h por constraint (`expires_at = created_at + 24 h`) e estados `pendente|aprovada|rejeitada|expirada|consumida`. `app.approval_vote` tem `unique (approval_request_id, approver_id)`.
2. `[VERIFICADO]` `private.approval_vote_guard` (versão vigente em `300000`) recusa autoaprovação, pedido não pendente e decide o aprovador **por tipo**; `private.admin_approval_vote` trava o pedido (`FOR UPDATE`), marca `expirada` sem erro quando vencido, conta votos e passa a `aprovada` ao atingir `required_approvals`. Ou seja, **o contador de votos já existe**; só o `check (= 1)` o impede de chegar a 2.
3. `[VERIFICADO]` Permissões já existentes: `finance.refund.request` e `finance.refund.approve` (só Financeiro), `moderation.decide` (Moderador). **Não existe** permissão de pedir ou aprovar suspensão. Não existem `payment` nem `refund_request` (09 os descreve, mas nenhuma migração os cria).
4. `[VERIFICADO]` `professional_profile` tem `verification_status` com `suspensa`, `suspended_at` e `suspension_reason` (consistentes por constraint). O catálogo de auditoria já traz `professional.suspended` e `payment.refunded` com `approval_request_id`.
5. `[DECIDIDO]` Estorno: pedido pelo Financeiro, aprovado por Financeiros distintos. Suspensão permanente: pedida pelo Suporte, aprovada por dois Moderadores distintos, sem Superadmin. Validade 24 h. Só a suspensão **permanente** exige dupla aprovação. A execução do estorno é da H-106.

## 1. Tipos de ação e encaixe no mecanismo existente

| Tipo (`action_type`) | Quem pede | Quem aprova | Votos (`required_approvals`) | Efeito em H-105 |
|---|---|---|---|---|
| `estorno` | `finance.refund.request` | `finance.refund.approve` | 1 se `amount_cents <= 20000`; 2 se `> 20000` (R$ 200,00 exatos = 1) | Nenhum financeiro: o pedido fica `aprovada` e **não consumido** (H-106 consome ao executar) |
| `suspensao_permanente` | `account.suspend.request` (nova) | `account.suspend.approve` (nova) | sempre 2 | Na mesma transação do 2º voto: `professional_profile` → `suspensa`, `suspended_at`, `suspension_reason`; pedido `consumida` |

- `[PROPOSTA]` Permissões novas: `account.suspend.request` → `suporte`; `account.suspend.approve` → `moderador`. Superadmin não herda nenhuma delas (coerente com 60 §0 e R-3: poucos Superadmins).
- **Pedido** = uma linha em `approval_request` (`requested_by` = quem pede) + `status='pendente'`. **Votos** = linhas em `approval_vote`. **Validade** = a constraint de 24 h existente, sem mudança. **Autoaprovação** continua barrada pelo gatilho, que não é afrouxado: o novo ramo só acrescenta o teste de permissão do tipo; o teste `approver_id <> requested_by` e o `unique` por aprovador (voto repetido) valem para todos os tipos. Quem tem os dois papéis (ex.: Suporte + Moderador) nunca aprova o próprio pedido, pois a comparação é por pessoa.
- `[PROPOSTA]` Dois votos distintos: o 1º voto deixa `pendente` e devolve `{votes:1, required:2}`; o 2º, de outra pessoa (diferente do solicitante e do 1º votante), passa a `aprovada` na mesma transação. 20 votos simultâneos: o `FOR UPDATE` serializa; depois de `aprovada`/`consumida` o gatilho recusa (`aprovacao_nao_pendente`), logo há **um** efeito.
- `[PROPOSTA]` Estorno com `aprovada` e validade vencida antes de H-106 executar: a execução exige `status='aprovada'` **e** `expires_at > agora`; vencido, é preciso novo pedido (24 h vale do pedido, não do voto). H-106 herda esta regra.

## 2. Mudanças de dados (migração `20261111450000_admin_approval_estorno_suspensao.sql`; rollback `supabase/rollbacks/…down.sql`)

Sem tabela nova. Só colunas anuláveis e constraints recriadas; **nenhuma linha existente é alterada ou apagada** (as linhas atuais têm tipos antigos, `required_approvals=1` e os novos campos nulos, então satisfazem tudo).

1. `app.approval_request` ganha: `subject_ref uuid` (profissional ou pagamento; **sem FK**, porque `payment` ainda não existe e o profissional não é `admin_staff`), `amount_cents integer check (> 0)`, `reason text` (10 a 500 caracteres após `trim`; texto livre, só nesta tabela).
2. Constraints recriadas com a **lista vigente completa** (padrão R-8 de 60): `action_type in ('papel_superadmin','mfa_reenroll','acesso_conversa','estorno','suspensao_permanente')`; `required_approvals in (1,2)`; nova `approval_request_votos_por_tipo` (`estorno`: 1 se `amount_cents<=20000`, 2 se maior; `suspensao_permanente`: 2; demais: 1); nova `approval_request_campos_por_tipo` (`estorno` exige `subject_ref`, `amount_cents`, `reason`; `suspensao_permanente` exige `subject_ref` e `reason`, sem `amount_cents`; os demais exigem os três nulos); `detalhe_por_acao` mantida. Índice único parcial `(action_type, subject_ref) where status in ('pendente','aprovada') and subject_ref is not null` impede dois pedidos abertos para o mesmo alvo.
3. `private.approval_vote_guard` recriada com todos os ramos: `acesso_conversa` como hoje; `estorno` exige `finance.refund.approve`; `suspensao_permanente` exige `account.suspend.approve`; `papel_superadmin`/`mfa_reenroll` como hoje. Em todos: aprovador ativo, ≠ solicitante, ≠ alvo.
4. Funções novas (`security definer`, `search_path=''`, `p_now` injetado, mesmos `revoke` de `300000`; só `app_system`):
   - `private.approval_dual_open(p_actor, p_session_hash, p_type, p_subject, p_amount, p_reason, p_id, p_now) → uuid`: permissão do tipo, sessão e TOTP recente (reuso de `access_case_session_totp`, `ADM21`), validações, limite de 5 pendentes por solicitante (`ADM24`), marca `expirada` os pedidos vencidos do mesmo alvo antes de testar duplicidade (`ADM23`), insere o pedido com `required_approvals` pela regra do §1 e audita.
   - `private.approval_dual_vote(p_actor, p_session_hash, p_id, p_now) → jsonb {status, votes, required}`: permissão, sessão, TOTP; reaproveita `admin_approval_vote` (que vence o prazo sem erro). Se aprovou e o tipo é `suspensao_permanente`, aplica o efeito e consome na mesma transação. Códigos novos: `ADM26` pedido vencido, `ADM27` pedido não pendente.
   - `private.approval_dual_cancel(p_actor, p_id, p_now)`: só o solicitante, só `pendente` (ou `aprovada` de estorno ainda não consumido); vai a `rejeitada`; idempotente.
   - `private.approval_dual_list(p_actor, p_now)`: pedidos do solicitante e os pendentes que a pessoa pode votar; estado derivado (`pendente` com `expires_at <= p_now` aparece como `expirada`).
5. Catálogo de auditoria (§4) e as duas permissões novas, com `on conflict do nothing`. O espelho em TypeScript (`packages/domain/src/admin/roles.ts`) e o teste que trava a lista de tipos (T-H073-26) são atualizados.
6. Rollback: remove as funções, as permissões novas, os índices e as constraints novas, recria as antigas (`= 1`, 3 tipos) e **aborta com mensagem se existir linha dos tipos novos** (não apaga dados; o operador decide).

## 3. Contratos de rota e guarda por papel

`[PROPOSTA]` Segue o padrão de `access-cases` (registro de rotas em `packages/access-matrix`, `Origin` conferida nas mutações, `no-store`, a função de banco é a autoridade). Duas famílias, cada rota com uma permissão: `refund-approvals` e `suspension-approvals` sob `/v1/admin/`.

| Rota | Permissão | Corpo → resposta |
|---|---|---|
| `POST /v1/admin/refund-approvals` | `finance.refund.request` | `{payment_id, amount_cents, reason}` → 201 `{id, status:"pendente", required_approvals, expires_at}` |
| `POST /v1/admin/suspension-approvals` | `account.suspend.request` | `{professional_id, reason}` → 201 idem |
| `POST …/{id}/vote` (as duas famílias) | `finance.refund.approve` / `account.suspend.approve` | sem corpo → 200 `{status, votes, required_approvals}` |
| `GET …` (as duas famílias) | `sessao` (a função filtra pela permissão) | lista: id, tipo, estado, valor, `subject_ref`, votos/exigidos, `expires_at`; **nunca** `reason` de outro solicitante nem dados do profissional |
| `POST …/{id}/cancel` | `sessao` (a função decide: só o solicitante) | sem corpo → 200 |

Respostas: negação (sem permissão, autoaprovação, voto repetido, pedido de outra família, inexistente, aprovador inativo) é sempre 403 `permission_denied`, mesmo corpo e cabeçalhos (como D-H073-5). Validação: 422 `valor_invalido`, `motivo_invalido`, `alvo_invalido`. Duplicado: 409 `pedido_ja_aberto`. Excesso de pendentes: 429 `muitos_pedidos_pendentes`. Pedido vencido: 409 `aprovacao_expirada` (só depois de passar na permissão, para não revelar existência). TOTP antigo: 403 `step_up_required`. Rota fora do registro: 404. A guarda de papel está **na função de banco**, não só na rota nem na tela (CA-H105-06). Telas: H-103.

## 4. Auditoria (RF-154)

Tudo por `private.audit_append`, **na mesma transação** da ação (se a auditoria falhar, a ação desfaz). Ações novas no catálogo (chaves de estado sem dado pessoal, sem `reason` livre): `approval.requested`, `approval.voted`, `approval.cancelled`, `approval.expired`, `approval.vote_denied`. Estado anterior/posterior: `status`, `required_approvals`, `votes`, `action_type`, `amount_cents` (estorno). Efeito da suspensão: reutiliza `professional.suspended` (já no catálogo; `suspension_kind='permanente'`, `approval_request_id`), objeto `professional_profile`. O evento `payment.refunded` **não** é escrito em H-105 (é da H-106). Negações de voto (`reason_code`: `autoaprovacao|voto_repetido|sem_permissao|inativo|vencido|nao_pendente`) são gravadas depois, em transação própria, como `self_grant_denied` de 54; falha dessa gravação não muda o 403 e vai a métrica. `[NÃO VERIFICADO]` assinatura exata dos parâmetros de motivo em `audit_append`; o DEV confere no código ao implementar. A consulta é do Auditor (H-104).

## 5. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Conluio: solicitante e dois aprovadores combinados (ou duas contas de uma só pessoa). | Aceito como residual (dupla aprovação não impede 3 pessoas combinadas); aprovadores têm de ser pessoas distintas e ativas, TOTP recente, trilha completa para o Auditor; consulta de pares repetidos (solicitante + aprovadores) fica para H-104. |
| R-2 | Aprovação sem prazo ou aprovada que "dorme" até a H-106. | Constraint de 24 h por pedido; voto vencido nega; execução exige `expires_at > agora`; pedidos vencidos viram `expirada` ao reabrir o alvo. |
| R-3 | Voto repetido ou corrida entre aprovadores. | `unique (approval_request_id, approver_id)`, `FOR UPDATE` e gatilho que recusa pedido não pendente; teste de 20 votos simultâneos. |
| R-4 | Valor adulterado depois do pedido (ex.: baixar de R$ 200,01 para R$ 200,00). | `amount_cents` imutável após inserir (gatilho `BEFORE UPDATE`), e a constraint liga o valor ao número de votos. |
| R-5 | Aprovador perde o papel entre o 1º e o 2º voto. | Permissão e status ativo revalidados em cada voto (banco). Voto já dado permanece, mas conta só se o aprovador ainda passar no teste ao votar; não há reavaliação retroativa `[PROPOSTA]`. |
| R-6 | Poucos Moderadores/Financeiros: a dupla aprovação trava. | O pedido expira em 24 h e pode ser refeito; alerta operacional se pedido vencer sem 2º voto (métrica, sem e-mail). |
| R-7 | Texto livre `reason` com dado pessoal. | Só em `approval_request`; fora de auditoria, logs e listagem de terceiros. |
| R-8 | Estorno sem tabela `payment`. | `subject_ref` sem FK; H-106 acrescenta a FK ou checagem quando `payment` existir. |

## 6. Testes e critérios verificáveis (offline; Vitest para domínio e rotas, `*.dbtest.mjs` para banco; relógio falso; sem rede e sem e-mail)

Mapeiam CA-H105-01..12 do refino.
- **T-H105-01 (CA-01/02/03)** valor: 15000 e 20000 → `required=1`; 20001 → `required=2`; com 20001, 1 voto = `pendente`, 2º voto distinto = `aprovada`. Banco recusa `required_approvals` incoerente com o valor.
- **T-H105-02 (CA-04/05)** solicitante vota → 403 e 0 linhas em `approval_vote`; mesmo aprovador duas vezes → negado, 1 voto; suspensão com o mesmo Moderador duas vezes → continua `pendente`.
- **T-H105-03 (CA-06)** matriz papel × rota: Suporte e Auditor não votam estorno; Financeiro não pede nem vota suspensão; Superadmin não pede nem vota nenhum dos dois; chamada direta à API sem permissão → 403 mesmo com botão oculto.
- **T-H105-04 (CA-07)** suspensão: 1 voto → `pendente`, perfil intacto; 2º voto de outro Moderador → perfil `suspensa`, `suspended_at`/`suspension_reason` preenchidos, pedido `consumida`, evento `professional.suspended`.
- **T-H105-05 (CA-08)** vencimento: voto em `expires_at - 1 ms` ok; em `expires_at` e `+1 s` → 409, status `expirada`, perfil e dados intactos; novo pedido reabre o alvo.
- **T-H105-06 (CA-09)** aprovador desativado ou sem papel antes do 2º voto → 403 e pedido não avança.
- **T-H105-07 (CA-10)** 20 votos simultâneos de aprovadores distintos → exatamente 1 efeito e 1 `consumida`; 20 pedidos simultâneos do mesmo alvo → 1 pedido.
- **T-H105-08 (CA-11)** cada decisão (pedido, voto, cancelamento, expiração, efeito) gera 1 evento com ator, objeto, estado anterior/posterior e hora; ação desativada no catálogo → ação desfeita; `audit_verify_chain` íntegro; negações só na transação própria.
- **T-H105-09 (CA-12)** estorno aprovado: nenhuma chamada ao Mercado Pago (setup bloqueia `fetch`/sockets) e nenhuma tabela de pagamento tocada; pedido permanece `aprovada`, não `consumida`.
- **T-H105-10 migração** aplicada sobre dados antigos preserva as linhas existentes; `papel_superadmin`, `mfa_reenroll`, `acesso_conversa` continuam funcionando (regressão dos testes de H-102 e H-073); lista de tipos travada; rollback recusa quando há linha nova e reverte limpo quando não há.
- **T-H105-11 privilégios e varredura** funções só para `app_system`; RLS forçada; `reason` sentinela só em `approval_request`, nunca em logs, erros, `audit_event` nem listagem alheia; respostas de negação idênticas byte a byte.
- Evidência: `corepack pnpm check:all` e `db:test` locais, com comando, contagem e código de saída na Issue.

### 6.1 Arquivos esperados `[PROPOSTA]`
`packages/domain/src/admin/dual-approval.ts` (regras puras: votos por valor, decisão de voto) e `…-handler.ts`; rotas em `packages/domain/src/admin/routes.ts` e `packages/access-matrix/src/`; `packages/db/src/admin-dual-approval.ts`; `apps/api/src/admin-dual-approval-route.ts` e ligação em `admin-composicao.ts`/`app.ts` (padrão dos arquivos `admin-access-case-*`); migração e rollback citados no §2; `…/tests/admin-dual-approval.dbtest.mjs`.

## 7. Dúvidas não bloqueantes (recomendação em itálico)

1. **D-7-1 Estorno até R$ 200,00.** O pedido do Orquestrador diz "dois Financeiros distintos"; o refino (RF-151, CA-H105-01/02) pede 1 aprovador até R$ 200,00 e 2 acima. Este desenho segue o refino. *Recomendação: manter 1 voto até R$ 200,00 e 2 acima; trocar para sempre 2 é só mudar a constraint do §2.*
2. **D-7-2 Permissões novas** `account.suspend.request` (Suporte) e `account.suspend.approve` (Moderador), em vez de reusar `moderation.decide`. *Recomendação: aceitar; evita dar ao Moderador o poder de pedir e mantém o mínimo privilégio.*
3. **D-7-3 TOTP recente (30 min) para pedir e votar**, como no caso de acesso. *Recomendação: aceitar; reaproveita o ajuste de H-073.*
4. **D-7-4 Cancelamento.** Só o solicitante cancela; aprovadores não "rejeitam" por voto. *Recomendação: aceitar no MVP; rejeição por aprovador entra se o negócio pedir.*
5. **D-7-5 Aviso de expiração ao solicitante** aparece na listagem (e-mail de desenvolvimento desligado). *Recomendação: aceitar; e-mail só no lançamento.*

## Resumo em linguagem simples

Estorno acima de R$ 200,00 e suspensão definitiva de uma conta passam a exigir duas pessoas diferentes de quem pediu, e cada pedido vale por 24 horas. Quem pede não aprova o próprio pedido, a mesma pessoa não vota duas vezes e tudo fica registrado no histórico de auditoria. A suspensão vale assim que o segundo moderador aprova; o estorno só fica "autorizado", e quem faz o estorno de verdade é a próxima história, que depende de uma definição jurídica.
