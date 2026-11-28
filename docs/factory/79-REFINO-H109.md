# Refino H-109 — Mecanismo de retenção sem prazos (Issue #118, WF-03, Product Owner)

- **Issue:** #118 · **História:** H-109 ("[E13] Mecanismo de retenção sem prazos") · **Workflow:** WF-03 · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO. Pronto para Arquitetura. **1 pergunta única ao líder** (jurídico, L1): ela bloqueia apenas a ativação de expurgo com dados reais, não o desenvolvimento do mecanismo.
- **Dependências:** H-006 (auditoria append-only) e H-005 (job com lease e idempotência). Informadas como concluídas no pedido; `[NÃO VERIFICADO]` no quadro nesta tarefa.
- **Etiquetas:** `[DECIDIDO]` registrado em 11-DECISOES ou ADR · `[VERIFICADO]` conferido nos arquivos citados · `[PROPOSTA]` deste refino · `[NÃO VERIFICADO]` fora do alcance desta leitura.
- **Rastro:** 14-BACKLOG (H-109, H-110, H-111, BLQ-JUR L1); 04-PRD RF-140; 05-CRITERIOS FA-020; 07-AMBIGUIDADES AMB-14; 09-MODELO-DADOS §3 (`retention_policy`, `legal_hold`, `audit_event`), §8 (RC-01 a RC-11), §10; 10-ADRS ADR-016, ADR-019; 11-ARQ-RISCOS R-16, R-17, I-15; 11-DECISOES Rodada 3.

---

## 1. Objetivo

Entregar o mecanismo que, para cada classe de dado pessoal (RC-01 a RC-11, 09 §8), aplica um prazo e uma ação de retenção vindos de **configuração**, não de constante no código.

- **Componentes** `[DECIDIDO, ADR-016]`: `retention_policy` por classe; `legal_hold` que suspende o expurgo de um sujeito; expurgo idempotente e auditado; eliminação de objetos no Storage no mesmo ciclo.
- **Regra de desligamento** `[VERIFICADO, 09 §3 e §8]`: `period` nulo = política não definida = job desligado.
- **Nenhum prazo inventado** `[DECIDIDO, 11-DECISOES]`: o produto não define prazo legal. AMB-14 opção B (prazo provisório de 5 anos) fica rejeitada `[VERIFICADO, ADR-016]`.
- **Sem prazo no código** `[PROPOSTA]`: nenhum número de dias, meses ou anos para RC-01 a RC-11 no código-fonte. Fixtures de teste podem usar períodos curtos, apenas em ambiente de teste, com dados sintéticos `[VERIFICADO, ADR-016: dados de teste sintéticos]`.

## 2. Quem configura os prazos

- **Valor do prazo e base legal:** vêm do parecer jurídico (L1; L2 para termos, privacidade e RC-10). O produto não decide o prazo. `[DECIDIDO]`
- **Quem cadastra:** um papel administrativo com permissão específica de política de retenção, dentro do RBAC de 08 §13. O nome do papel é definido pela Arquitetura. `[PROPOSTA]`
- **Aprovação:** criar ou alterar `period`, `action` ou `enabled` exige aprovação de **dois administradores distintos**, sem autoaprovação, com `legal_basis_ref` e `approved_by` preenchidos. Reaproveita o padrão `approval_request` de 08 §13. `[PROPOSTA]`
- **Habilitação:** `enabled = true` só é aceito com período, base legal, aprovador e vigência preenchidos. `[PROPOSTA]`
- **Auditoria:** criação, alteração, habilitação e tentativa recusada geram evento em `audit_event`. `[VERIFICADO, 09 §3]`

## 3. O que é expurgado, como e quando

- **Elegibilidade:** classe com política habilitada, gatilho (`trigger_event`) ocorrido há mais de `period` e nenhum `legal_hold` ativo para o sujeito. Gatilho não ocorrido = não elegível. `[PROPOSTA]`
- **Ações** `[VERIFICADO, 09 §3 `retention_policy.action`]`:
  - `excluir`: apaga a linha e o objeto de Storage;
  - `anonimizar`: zera campos pessoais e mantém o registro mínimo, sem dado em claro;
  - `reter`: não altera nada; apenas registra a verificação.
- **Como:** lotes pequenos, uma transação por lote. O evento de auditoria (contagem por classe e ação, ids de política, sem dado pessoal) é gravado na mesma transação `[VERIFICADO, I-15]`.
- **Storage:** o objeto sai no mesmo ciclo `[VERIFICADO, 09 §8]`. Se a remoção falhar, o registro fica marcado para nova tentativa, sem objeto órfão ao fim do ciclo `[PROPOSTA]`.
- **Idempotência:** reexecução ou falha no meio produz o mesmo estado final e não duplica evento `[PROPOSTA, H-005]`.
- **Quando:** o job roda pelo tick (H-008), com cadência diária `[PROPOSTA]`. O plano gratuito permite cron do Hobby 1 vez por dia `[VERIFICADO, 14-BACKLOG H-008]`. Atraso de até um dia é aceitável, pois os prazos são em dias ou meses.
- **Auditoria nunca é apagada:** `audit_event` é append-only, com UPDATE e DELETE negados `[VERIFICADO, H-006; 09 §3]`. Logs de acesso não são expurgados por H-109; o expurgo e o rollup de `media_access_log` pertencem a H-110.

## 4. Fora de escopo

- **Expurgos operacionais por TTL técnico** (quarentena e rascunhos, desafios, sessões, inbox de webhook, outbox entregue, idempotência, rollup de `media_access_log`): H-110, RC-08 e RC-09 `[VERIFICADO, 14-BACKLOG H-110]`.
- **Direitos do titular sob demanda** (acesso, correção, eliminação; `dsr_case`): H-111, bloqueada por L1 e L2 `[VERIFICADO]`.
- **Definição de prazos, bases legais e ações por classe:** jurídico (L1/L2). `[DECIDIDO]`
- **Rotação de backups e exclusão em cópias** (RC-11): operação, após parecer L1 `[VERIFICADO, R-17]`.
- **Exclusão de conta pelo app nas lojas** (ADR-019) e fase mobile `[NÃO VERIFICADO]`.
- **Ativação de qualquer prazo com dados reais** antes do parecer `[VERIFICADO, ADR-016; R-16]`.

## 5. Critérios de aceite (Given/When/Then)

- **CA-H109-01** `[VERIFICADO, ADR-016]` Dado que nenhuma política tem período preenchido, quando o job de expurgo roda, então nenhuma linha de dado pessoal é alterada e nenhum objeto é removido.
- **CA-H109-02** `[PROPOSTA]` Dado uma política com período nulo, quando alguém tenta habilitá-la, então a operação é recusada, nada é alterado e a tentativa fica em `audit_event`.
- **CA-H109-03** `[PROPOSTA]` Dado uma política criada ou alterada por um administrador, quando esse mesmo administrador tenta aprová-la, então a aprovação é recusada.
- **CA-H109-04** `[PROPOSTA]` Dado um pedido concluído cujo período da classe RC-03 já passou, e política habilitada, quando o job roda, então o registro recebe a ação configurada e um evento com a contagem é gravado na mesma transação.
- **CA-H109-05** `[PROPOSTA]` Dado um pedido cujo gatilho ainda não ocorreu, quando o job roda, então o pedido não é alterado.
- **CA-H109-06** `[PROPOSTA]` Dado uma conversa com `legal_hold` ativo, quando o job roda, então ela não é alterada e a suspensão aparece na contagem; quando o hold é liberado, ela entra no ciclo seguinte.
- **CA-H109-07** `[PROPOSTA]` Dado um lote interrompido no meio, quando o job é reexecutado, então o estado final é igual ao de uma execução sem interrupção e nenhum evento de exclusão é duplicado.
- **CA-H109-08** `[VERIFICADO, H-006]` Dado registros de `audit_event` relacionados a um sujeito elegível, quando o expurgo roda, então nenhuma linha de auditoria é apagada ou alterada, e UPDATE e DELETE continuam negados.
- **CA-H109-09** `[PROPOSTA]` Dado um registro com foto ou documento no Storage, quando é excluído pelo expurgo, então o objeto sai no mesmo ciclo; se a remoção falhar, nenhum objeto fica órfão ao fim do ciclo.
- **CA-H109-10** `[PROPOSTA]` Dado um registro com ação `anonimizar`, quando o expurgo termina, então e-mail, telefone, endereço e texto livre não aparecem em claro em nenhuma coluna do registro (verificado por consulta).
- **CA-H109-11** `[PROPOSTA]` Dado o código da entrega, quando revisado por teste de busca, então não há prazo literal para RC-01 a RC-11; prazos existem somente em registros de política.
- **CA-H109-12** `[VERIFICADO, FA-020]` Dado um cliente que tenta avaliar após a eliminação dos dados do seu pedido ou identidade, quando submete, então recebe negação com mensagem adequada e nenhuma avaliação é criada.

## 6. Dúvidas

**Pergunta única ao líder (jurídico):**

- **Q-H109-1 (L1; L2 para RC-10):** quais prazos e ações valem para cada classe RC-01 a RC-11? Incluir: se avaliações (RC-05) são mantidas ou anonimizadas; se backups (RC-11) têm rotação e como tratar exclusão do titular; e a base legal de cada classe.
  - **Recomendação do PO:** não definir agora; manter `period` nulo até o parecer. Desenvolver o mecanismo com política de teste.
  - **Destrava:** ativação de qualquer expurgo com dados reais (ADR-016, R-16) e a aplicação real de CA-H109-12.

**Dúvidas não bloqueantes (recomendação do PO):**

- **D-H109-a, fronteira com H-110:** pedido e fotos (RC-03) são expurgados pela política do H-109, não por TTL. **Recomendação:** H-109 cuida de toda classe com `retention_policy`; H-110 cuida só de TTL técnico (RC-08, RC-09).
- **D-H109-b, ator em `audit_event` (RC-07):** anonimizar `actor_ref` por UPDATE quebra o append-only. **Recomendação:** reter integralmente. Se o jurídico exigir pseudonimização, usar tabela de vínculo separada com acesso restrito, decidida pela Arquitetura após L1.
- **D-H109-c, papel e aprovação:** **Recomendação:** papel administrativo próprio com aprovação dupla. Nome do papel pela Arquitetura.
- **D-H109-d, cadência do job:** **Recomendação:** diária pelo tick (H-008), sem horário garantido.
- **D-H109-e, backups e direitos do titular:** **Recomendação:** fora de escopo; registrar como dependência de H-111 e da operação.

## 7. Handoff para Arquitetura

- **Entrada:** seção 1 (componentes), seção 2 (quem configura) e seção 3 (expurgo) como requisitos. Seção 5 como critérios de aceite. Seção 4 como limite.
- **Pedido à Arquitetura:** nomear o papel de política; confirmar a ordem entre remoção de objeto no Storage e remoção da linha (CA-H109-09); definir o modelo lógico de `retention_policy` e `legal_hold` a partir de 09 §3.
- **Estado do cartão:** não movido por este refino. Movimento e conferência ficam com o Orquestrador.
