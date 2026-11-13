# Refino H-110 — Expurgos operacionais (Issue #119, WF-03, Product Owner)

- **Issue:** #119 · **História:** H-110 ("[E13] Expurgos operacionais") · **Workflow:** WF-03 · **Data:** 2026-11-12 · **Papel:** Product Owner
- **Estado no quadro (verificado em `docs/factory/quadro-status.md`):** #119 está na coluna **Product Owner**. Dependências #18 (H-005), #21 (H-008) e #118 (H-109) estão em **Concluído**.
- **Decisão:** REFINADO_PO com ressalvas. Pronto para Arquitetura nas partes independentes. A parte de **quarentena de fotos** depende de #141 (ver seção 8), por isso não deve ser tratada como concluível sozinha. Nenhuma pergunta abaixo bloqueia o desenvolvimento das demais partes.
- **Etiquetas:** `[VERIFICADO]` conferido em arquivo, migração ou quadro · `[DECIDIDO]` em 11-DECISOES, ADR ou refino anterior · `[PROPOSTA]` deste refino · `[PENDENTE JURÍDICO]` depende de L1 · `[NÃO VERIFICADO]` fora do alcance desta leitura.

---

## 1. Objetivo

Remover, por configuração e de forma idempotente, os dados **técnicos** que só existem para operar o sistema (quarentena de upload, rascunhos, desafios, sessões, inbox de webhook, outbox já entregue, chaves de idempotência e detalhe de `media_access_log`). Esses dados não são prova nem obrigação legal, e o acúmulo deles ameaça o limite de armazenamento gratuito (09 §9, Q-04 em 11-ARQ-RISCOS-E-TESTES).

O expurgo **não** decide prazo legal. Os TTL desta história são técnicos `[PROPOSTA]`. Nenhum dado com `legal_hold` pode ser apagado.

Fontes lidas: 14-BACKLOG (H-109, H-110), 79-REFINO-H109, 82-DESENHO-H109 (§1 a §5 e perguntas J-1, A-4, A-6), 09-MODELO-DADOS §3, §7, §8 (RC-08, RC-09) e §10, 10-ADRS ADR-016, 11-DECISOES (itens 34, 35 e a nota de AMB-14), 04-PRD RF-140, 05-CRITERIOS-ACEITE FA-020 (apenas o cabeçalho), 07-AMBIGUIDADES AMB-14, `packages/db/src/retention-jobs.ts` e `retention-store.ts` (apenas trechos por busca).

**Correção de rastro:** RC-08 e RC-09 **não** estão em 04-PRD nem em 05-CRITERIOS. Estão definidos em 09 §8 (linhas de classe). 04-PRD só tem RF-140 e 05-CRITERIOS só tem FA-020, ambos bloqueados por L1.

---

## 2. Escopo (dentro)

| Parte | Dado | Tabela ou local (estado verificado) | Situação |
|---|---|---|---|
| E1 | Original de foto em quarentena (pronto ou rejeitado) e upload não concluído | `app.media_asset` + bucket `quarantine` (migração 20261112120000) e marca de saída (migração 20261112140000 §8–9) | **Depende de #141** |
| E2 | Rascunhos vencidos por TTL | `app.request_draft` (migração 20261111440000) | Independente (TTL pendente, Q-H110-2) |
| E3 | Desafios vencidos ou consumidos | `app.auth_challenge` (migração 20261111140000; `expires_at` = +15 min) | Independente |
| E4 | Sessões vencidas ou revogadas | `app.app_session` (migração 20261111150000) | Independente |
| E5 | Inbox de webhook já processada | `provider_event` (09 §3) | **Tabela não encontrada nas migrações: bloco pulado com aviso** |
| E6 | Outbox já despachada | `ops.outbox_event` (migração 20261110130000, coluna `dispatched_at`) | Independente |
| E7 | Chaves de idempotência vencidas | `ops.idempotency_key` (migração 20261110130000) | Independente, com restrição de janela (RN-H110-08) |
| E8 | Rollup diário e remoção de detalhe de `media_access_log` | `media_access_log` (09 §3) | **Tabela não encontrada nas migrações: bloco pulado com aviso.** Remoção de detalhe depende de Q-H110-1 |
| E9 | Anexos órfãos (objeto sem linha, linha sem objeto dentro da janela técnica) | Storage e tabelas acima | Independente, depois de E1 e E2 |

Notas sobre o que foi verificado:
- `ops.job`, `ops.idempotency_key`, `ops.app_config`, `ops.rate_counter` e `ops.outbox_event` existem `[VERIFICADO, migração 20261110130000]`. Colunas além de `dispatched_at` não foram lidas.
- `media_access_log` e `provider_event` não aparecem em nenhuma migração (busca textual por nome, sem diferença de maiúsculas). `[VERIFICADO: ausência]`
- `app.app_session`, `app.auth_challenge`, `app.request_draft`, `app.media_asset`, `app.retention_policy` e `app.legal_hold` existem `[VERIFICADO, migrações]`.
- `email_outbox` (09 §3.11) não foi procurado com prefixo de schema `ops.`. `[NÃO VERIFICADO]` (ver Q-H110-9).

---

## 3. Fora de escopo

- **Prazos legais de retenção** (RC-01 a RC-07, RC-10, RC-11) e a ativação de qualquer `retention_policy` com período: pertencem a H-109 e só são ativados com L1 `[PENDENTE JURÍDICO]`. Nenhum número de dia ou mês dos prazos legais entra no código (CA-H109-11).
- **Fotos do pedido e documentos de identidade já aprovados** (RC-01, RC-03): cobertos pela política do H-109, não por TTL (D-H109-a, 79 §10).
- **`legal_hold`:** nunca apagado, nunca editado por este job. É só lido (RN-H110-04).
- **`audit_event`:** intocável (H-006, CA-H109-08). Nenhum expurgo desta história o toca.
- **RC-08 (logs operacionais e métricas do provedor):** é configuração de retenção do provedor, não tabela do produto. Ver Q-H110-5.
- **RC-11 (backups):** operação, depende de L1 `[PENDENTE JURÍDICO]`.
- **Direitos do titular (`dsr_case`, eliminação a pedido):** H-111, bloqueada por L1 e L2.
- **Painel de métricas:** H-108 só consome as contagens. Esta história não cria tela.

---

## 4. Regras de negócio

| ID | Regra | Fonte |
|---|---|---|
| RN-H110-01 | Este job só remove dado de classe técnica (E1 a E9). Não toca RC-01 a RC-07, RC-10, RC-11 nem `audit_event`. | `[PROPOSTA]`, 09 §8 e 79 §10 |
| RN-H110-02 | Todo expurgo é idempotente, roda com lease (`ops.job`) e registra apenas contagens. Repetir a execução não muda o resultado final. | `[VERIFICADO, 09 §10; H-005]` |
| RN-H110-03 | Cada TTL é valor de `ops.app_config`. Valor nulo, zero ou ausente = **desligado** (mesmo padrão do H-109). Nenhum TTL fica como constante no código. | `[PROPOSTA]`, padrão H-109 |
| RN-H110-04 | `legal_hold` ativo do sujeito suspende o expurgo de **todo** dado vinculado ao sujeito nesta história. O hold é relido na fase final de cada lote. | `[PROPOSTA]`, 82 §1 (`legal_hold` suspende todas as classes do sujeito) |
| RN-H110-05 | Dado ainda não processado ou não entregue nunca é removido por TTL: outbox não despachada, inbox não processada, rascunho com atividade dentro da janela, upload em andamento dentro da janela, sessão ativa, desafio pendente. | `[PROPOSTA]` |
| RN-H110-06 | Original em quarentena só sai depois que a foto está pronta ou rejeitada **e** a marca de saída da quarentena existe. | `[DECIDIDO, decisão 82; migração 20261112140000 §8]` |
| RN-H110-07 | Rascunho expirado leva consigo as fotos em quarentena vinculadas que não chegaram a ficar prontas (pergunta Q-H110-4). | `[PROPOSTA]` |
| RN-H110-08 | Expurgo de chave de idempotência não pode encurtar a janela de deduplicação do contrato de H-005 (mesma chave com corpo diferente → 422; em andamento → 409). A janela de expurgo é sempre maior que a janela de repetição. | `[VERIFICADO, H-005]`, `[PROPOSTA]` para o valor |
| RN-H110-09 | Antes de remover detalhe de `media_access_log`, grava-se agregado diário por profissional e dia. A soma do agregado é igual à soma das linhas removidas. Reexecução não duplica agregado. | `[PROPOSTA]`, 09 §10 e §9 |
| RN-H110-10 | Métrica e evento de auditoria do job carregam só contagens: sem id de sujeito, sem texto livre, sem caminho de objeto. | `[VERIFICADO, I-15 e 09 §3]`, padrão H-109 |
| RN-H110-11 | Tabela ausente = o bloco é pulado e a contagem registra `pulado_ausente`. O job não falha e não cria tabela. | `[PROPOSTA]`, padrão `sem_alvo` do H-109 |
| RN-H110-12 | Ordem dentro de cada item de quarentena ou anexo: objeto no Storage antes da linha. Se a remoção do objeto falhar, a linha fica marcada e a próxima execução conclui. Não sobra objeto órfão ao fim do ciclo. | `[PROPOSTA]`, padrão CA-H109-09 |
| RN-H110-13 | Limite de lote por execução e por sub-etapa (proposta: 500 linhas) e continuação com chave do dia, como no H-109. Sub-etapas são independentes: falha numa não interrompe as outras. | `[PROPOSTA]` |

---

## 5. Fluxos

**F1. Execução diária (job de expurgo operacional)**
1. O tick (H-008) executa um job de expurgo operacional, enfileirado 1 vez por dia com chave `operacional.expurgo:<data>`, no mesmo mecanismo do `retention.purge` do H-109. Sem TTL ligado, o job retorna sem tocar em nada.
2. Para cada sub-etapa, em ordem: E1 quarentena, E2 rascunhos, E3 desafios, E4 sessões, E5 inbox, E6 outbox, E7 idempotência, E8 rollup e detalhe, E9 órfãos.
3. Em cada sub-etapa: seleciona elegíveis (TTL vencido, sem `legal_hold` do sujeito, dentro do lote), marca, remove objeto (se houver), remove linha ou grava agregado, e registra contagem.
4. Ao fim, grava métrica e, se Q-H110-8 for aprovada, um evento de auditoria só com contagens.

**F2. Quarentena (E1), depois de #141**
1. Foto `ready` ou `rejected` com original ainda em `quarantine` e marca de saída ausente: remove original, marca saída, registra.
2. Upload em `quarantine` sem conclusão além da janela técnica: remove objeto e marca a linha como expirada. A linha `media_asset` não é apagada.
3. Foto `ready` nunca tem o original removido antes da marca de saída (RN-H110-06).

**F3. Rascunho (E2)**
1. Rascunho com última atividade além do TTL (Q-H110-2): marca como expirado. Quem tenta abri-lo vê que não existe (CA-09 da H-025).
2. Fotos vinculadas em quarentena seguem F2 (RN-H110-07).
3. A linha sai na mesma transação do marcador, depois de as fotos seguirem a ordem da RN-H110-12.

**F4. Rollup de `media_access_log` (E8)**
1. Se a tabela existir: agrega dias fechados (anteriores ao dia corrente) por profissional e dia, grava agregado em tabela própria e só então remove detalhe elegível.
2. Se a tabela não existir: `pulado_ausente` e segue para E9.

---

## 6. Critérios de aceite (testáveis)

Cada critério tem fonte da regra de negócio. Todos são `[PROPOSTA]`, salvo nota.

- **CA-H110-01** Dado que todos os TTL estão nulos, quando o job roda, então nenhuma linha é alterada e nenhum objeto é removido (contagem antes = depois). *Teste: db-test, como CA-H109-01.*
- **CA-H110-02** Dado um desafio vencido e um desafio pendente, quando o job roda, então só o vencido sai; o pendente permanece. *Teste: db-test.*
- **CA-H110-03** Dado uma sessão vencida, uma revogada e uma ativa, quando o job roda com TTL vencido, então só as duas primeiras saem; `audit_event` do logout continua íntegro (CA-H109-08). *Teste: db-test.*
- **CA-H110-04** Dado um rascunho com atividade dentro do TTL e outro fora dele, quando o job roda, então só o segundo é expirado e não aparece mais para o cliente. *Teste: db-test e teste de API, consistente com CA-09 da H-025.*
- **CA-H110-05** Dado um original em quarentena de foto `ready` com marca de saída, quando o job roda após a janela, então o objeto sai do bucket `quarantine`, a linha de `media_asset` permanece com estado `ready`, e nenhum original fica sem marca (verificado por consulta). *Teste: db-test com Storage fake; prova com Storage real fica pendente como A-4 do H-109.*
- **CA-H110-06** Dado uma foto `ready` cuja marca de saída ainda não existe, quando o job roda, então o original não é removido. *Teste: db-test.*
- **CA-H110-07** Dado uma outbox com linha despachada além do TTL e outra não despachada além do TTL, quando o job roda, então só a despachada sai. *Teste: db-test.*
- **CA-H110-08** Dado uma chave de idempotência vencida, quando o job roda, então ela sai, e uma chave dentro da janela de repetição continua produzindo 422 para corpo diferente e 409 para requisição em andamento (regressão de H-005). *Teste: db-test e teste de contrato.*
- **CA-H110-09** Dado linhas de `media_access_log` de dias fechados, quando o job roda, então o agregado diário por profissional e dia soma igual às linhas removidas, e uma segunda execução não cria agregado duplicado. *Teste: db-test. Só válido se a tabela existir (ver caso de borda 1).*
- **CA-H110-10** Dado um sujeito com `legal_hold` ativo e rascunho, sessão, desafio, foto em quarentena ou outbox vinculados, quando o job roda com TTL vencido, então nenhuma dessas linhas nem objetos é removido, e a contagem registra `held`. Quando o hold é liberado, os dados entram no ciclo seguinte. *Teste: db-test, padrão CA-H109-06.*
- **CA-H110-11** Dado uma falha de remoção de objeto de quarentena, quando o job roda, então a linha fica marcada, a contagem registra `failed`, e na execução seguinte o item é concluído, sem objeto órfão ao fim do ciclo. *Teste: Storage fake, padrão CA-H109-09.*
- **CA-H110-12** Dado duas execuções simultâneas do mesmo dia, quando rodam, então só uma processa (lease), e o resultado final é o mesmo de uma execução. *Teste: db-test com dois processos.*
- **CA-H110-13** Dado os TTL de `app_config` alterados para outro valor, quando o job roda, então o comportamento muda sem alteração de código. *Teste: db-test. Também confirma RN-H110-03.*
- **CA-H110-14** Dado o código e as migrações da entrega, quando revisados por teste de busca, então não há literal de prazo legal (dias, meses ou anos) associado a RC-01 a RC-11, nem constante de TTL fora de `app_config` (ampliação de CA-H109-11). *Teste: busca no código, como CA-H109-11.*
- **CA-H110-15** Dado métricas e eventos gerados pelo job, quando inspecionados, então carregam só contagens: sem id de sujeito, sem caminho de objeto e sem texto livre. *Teste: consulta e busca.*
- **CA-H110-16** Dado tabela ausente (`media_access_log` ou `provider_event`), quando o job roda, então o bloco é pulado, a contagem registra `pulado_ausente` e as demais sub-etapas rodam normalmente. *Teste: db-test com tabela simulada ausente (remoção em ambiente de teste).*

---

## 7. Casos de borda

1. **Tabela ausente (`media_access_log`, `provider_event`).** Hoje as duas não existem nas migrações. O bloco E5 e E8 vira `pulado_ausente` (RN-H110-11). A história não cria essas tabelas: quem as cria é a história dona do webhook (E5) ou a de acesso a mídia (E8). Quando a tabela surgir, o bloco é ativado com seu próprio teste. *Aviso registrado no quadro e no relatório.*
2. **Upload em andamento no limite do TTL.** Só se expurga upload sem conclusão depois do TTL técnico, nunca na primeira hora. Evita remover um envio lento.
3. **Rascunho reaberto no mesmo instante do expurgo.** Expurgo e atualização do rascunho disputam a mesma linha. Usar bloqueio de linha (`skip locked`) e reconferir a data de atividade na fase final.
4. **Webhook que chega depois da limpeza da chave de idempotência.** Pode gerar processamento duplicado. A janela de idempotência precisa ser maior que o prazo de reentrega do provedor (Q-H110-1 e RN-H110-08).
5. **Sujeito com hold e expurgo de sessão.** A sessão do titular sob hold fica no banco com a conta ativa ou revogada. Aceito, por RN-H110-04.
6. **Volume inicial alto.** Primeira execução pode ter muitas linhas vencidas. O limite por lote (RN-H110-13) distribui em vários dias e é registrado nas métricas.
7. **Mesmo sujeito no H-109 e no H-110 no mesmo dia.** As duas jobs usam o `legal_hold` e nunca apagam o mesmo dado: H-109 cuida das classes com política, H-110 das técnicas. Sem sobreposição de tabelas, exceto `request_draft`, cuja foto vinculada pode estar em RC-03 (ver Q-H110-4).
8. **Exclusão de conta (anonimização RC-02, H-109).** Sessões e desafios do titular anonimizado ficam sem sentido. Devem seguir o TTL normal, sem bloqueio extra.
9. **Falha em uma sub-etapa.** O job continua nas demais e registra a falha. Nenhuma sub-etapa pode deixar o job inteiro em erro permanente.

---

## 8. Dependências com outras histórias

| Dependência | Estado | Efeito |
|---|---|---|
| H-005 (#18) outbox, jobs, idempotência e config | **Concluído** `[VERIFICADO, quadro]` | Tabelas `ops.*` existem. Base de E6, E7 e lease. |
| H-008 (#21) tick de jobs | **Concluído** `[VERIFICADO, quadro]` | Mecanismo de execução diária. |
| H-109 (#118) mecanismo de retenção | **Concluído** `[VERIFICADO, quadro]` | `legal_hold`, padrão de job, `sem_alvo`, teste de busca. |
| H-006 auditoria (`audit_event`) | `[NÃO VERIFICADO]` no quadro (é dependência de H-109, que está concluída) | Usada por RN-H110-10 e CA-H110-03. |
| H-025 rascunho (`request_draft`) | `[NÃO VERIFICADO]` no quadro. Tabela existe. | E2 depende de D-H025-1 (prazo do rascunho, `[NÃO VERIFICADO]` na H-025). |
| H-026 quarentena de foto (`media_asset`) | Migração existe `[VERIFICADO]`. Estado no quadro `[NÃO VERIFICADO]`. | Base de E1. |
| **#141 [E3] rota de mídia (upload, redução e galeria)** | **Em Product Owner** `[VERIFICADO, quadro]` | E1 depende da marca de saída da quarentena (migração 20261112140000 §8 e §9). Enquanto #141 não estiver concluída, E1 não fica pronta. Também pode haver arquivos em comum, o que impede execução paralela sobre os mesmos arquivos (regra de até quatro Issues independentes). |
| História dona do webhook (`provider_event`) | `[NÃO VERIFICADO]` (tabela ausente) | E5 é pulado até ela existir. |
| H-108 painel operacional (`ops_metric`) | Migração existe `[VERIFICADO]`. Estado `[NÃO VERIFICADO]`. | Recebe as contagens. Sem ele, o job continua e grava só na auditoria, se aprovada. |
| L1 (jurídico, BLQ-JUR L1 e AMB-14) | **Pendente** `[PENDENTE JURÍDICO]` | Bloqueia só a ativação de detalhe de `media_access_log` (E8) se houver base legal, e qualquer prazo legal (fora desta história). |
| H-111 direitos do titular | Bloqueada | Não é dependência. H-110 não espera H-111. |

**Sequência sugerida para a Arquitetura:** E2, E3, E4, E6 e E7 podem seguir já, com TTL padrão `[PROPOSTA]`. E5 e E8 ficam como bloco pulado até a tabela existir. E1 e E9 esperam #141. Nenhuma parte depende de outra história inacabada, exceto E1.

---

## 9. Perguntas abertas (para o líder consolidar; não enviadas ao usuário)

Numeração local `Q-H110-n`. O líder renumera na lista única da sessão.

**Q-H110-1 — `media_access_log`: remoção do detalhe depende de L1? (prioridade alta)**
- Conflito: 09 §7 classifica o log de acesso de fotos do pedido como **RC-03** (classe com política do H-109, prazo legal). 09 §10 e 79 §10 mandam o rollup e a remoção do detalhe no H-110, por janela técnica.
- Alternativas: (a) fazer rollup agora e deixar a remoção do detalhe com TTL nulo até L1; (b) remover detalhe em janela técnica já (ex.: 90 dias); (c) não tratar `media_access_log` nesta história.
- **Recomendação: (a).** Rollup não apaga contagem. Remoção do detalhe só com L1, pelo mesmo critério de ADR-016 ("nenhum prazo sem L1").

**Q-H110-2 — Prazo técnico do rascunho (D-H025-1).**
- Alternativas: 7, 30 ou 90 dias de inatividade.
- **Recomendação: 30 dias** de inatividade, em `app_config`, `[PROPOSTA]`. Rascunho é RC-09, técnico, não é prazo legal. Confirmar com o dono da H-025.

**Q-H110-3 — Janela de upload em quarentena sem conclusão.**
- Alternativas: 24 h, 72 h, 7 dias.
- **Recomendação: 24 h**, `[PROPOSTA]`. Upload não concluído não tem valor.

**Q-H110-4 — Foto de rascunho expirado: cai junto?**
- Alternativas: (a) cai junto com o rascunho, quando nunca ficou pronta; (b) só a quarentena expira no próprio TTL.
- **Recomendação: (a).** Foto sem rascunho não tem ponteiro para o cliente. Não confundir com foto já aprovada (RC-03, H-109).

**Q-H110-5 — RC-08 (logs operacionais e métricas do provedor): entra no código?**
- Alternativas: (a) fora do código, documentado como configuração de retenção do provedor e verificado no runbook; (b) criar job de expurgo para tabela própria de logs.
- **Recomendação: (a).** Não há tabela de logs do produto; a retenção é do provedor. Registrar na documentação de operação.

**Q-H110-6 — `legal_hold` suspende também os TTL técnicos?**
- Alternativas: (a) sim, todo dado do sujeito sob hold fica fora do expurgo desta história; (b) só classes com política do H-109 respeitam o hold; técnicas seguem o TTL.
- **Recomendação: (a).** Mantém "legal_hold nunca apagado" sem exceção e custa pouco (dados técnicos pequenos).

**Q-H110-7 — Auditoria por execução do job.**
- Alternativas: (a) um evento de auditoria por execução diária, só com contagens (padrão do H-109); (b) só métrica, sem auditoria.
- **Recomendação: (a)**, com uma linha por dia e sub-etapa, para permitir reconstituir o que foi removido sem registrar identidade.

**Q-H110-8 — Sequenciamento de E1 e #141.**
- Alternativas: (a) iniciar H-110 com E2 a E9 e deixar E1 para depois de #141; (b) esperar #141 para começar tudo; (c) assumir E1 dentro de #141.
- **Recomendação: (a).** Não começar E1 como se pudesse terminar sozinha (regra de dependências). Decisão do líder sobre a ordem do quadro.

**Q-H110-9 — `email_outbox` entra no expurgo de outbox?**
- 09 §10 cita só `outbox_event` despachada. 09 §3.11 tem `email_outbox` com estado `enviado`, `suprimido` e `falha`.
- Alternativas: (a) incluir linhas `enviado` e `suprimido` além da janela, se a tabela existir; (b) manter fora desta história.
- **Recomendação: (a)**, com verificação de existência na Arquitetura (`[NÃO VERIFICADO]` aqui). Se a tabela não existir, o bloco é pulado (RN-H110-11).

**Q-H110-10 — Janela de idempotência.**
- Alternativas: 24 h, 48 h, 7 dias. Deve ser maior que o prazo de reentrega do provedor de pagamento e de e-mail.
- **Recomendação: 48 h**, `[PROPOSTA]`, confirmada pela Arquitetura com os prazos dos provedores (`[NÃO VERIFICADO]`).

**Q-H110-11 — Expurgo de sessão revogada: manter ou remover?**
- A revogação já tem registro em `audit_event`. A linha da sessão não precisa ficar.
- Alternativas: (a) remover ao vencer ou ser revogada, após janela; (b) manter sessão revogada indefinidamente.
- **Recomendação: (a)**, janela de 30 dias, `[PROPOSTA]`.

---

## 10. O que não foi verificado nesta leitura

- Não li as colunas completas de `ops.job`, `ops.outbox_event` e `ops.idempotency_key` (só os nomes das tabelas).
- Não li o corpo de `retention-jobs.ts` e `retention-store.ts` além das linhas de busca (constante do job, classes com adaptador, handler). A fase de expurgo não foi reavaliada.
- Não li o texto integral de RF-140 (04-PRD) nem de FA-020 (05-CRITERIOS). Só o que aparece nas linhas de busca.
- Não confirmei no quadro o estado de H-006, H-025, H-026 e H-108 (ver seção 8).
- Não confirmei a história que cria `provider_event` nem a que cria `media_access_log`.
- Não confirmei a existência de `email_outbox` com prefixo de schema (Q-H110-9).
- Não consultei o GitHub Project nem o banco de dados. O quadro local é a fonte da verdade.
- Não rodei testes nem builds. Este é um documento de refino, sem código.
- Não criei nem alterei tabelas, migrações ou código.

---

## 11. Próximo passo

- O líder consolida as perguntas Q-H110-1 a Q-H110-11 em lista única numerada e registra as respostas em `docs/factory/11-DECISOES.md`.
- A Arquitetura recebe este refino com E2 a E7 como frente imediata; E5 e E8 aguardam a tabela; E1 aguarda #141.
- Commit deste arquivo: feito pelo líder (ver relatório).
