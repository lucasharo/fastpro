# Desenho H-114 — Runbook de incidente e reconciliação (Issue #123)

- **Issue:** #123 `[E13] Runbook de incidente e reconciliação` · **História:** H-114 · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ2-123-20261120.
- **Entrada:** `146-REFINO-H114.md` (PO, perguntas 703 a 722). **Decisão do líder (vetável):** todas as recomendações marcadas foram adotadas (703 a, 704 a, 705 a, 706 a, 707 b, 708 a, 709 a, 710 a, 711 a, 712 a, 713 a, 714 a, 715 a, 716 a, 717 a, 718 a, 719 a, 720 a, 721 a, 722 a). Matéria `[PENDENTE JURIDICO]` roda como `[PROPOSTA]`.
- **Natureza:** documento de desenho. Nenhum código, migração, banco ou quadro foi alterado. Somente DEV; sem produção, sem Docker, sem rede externa, sem e-mail real.
- **Etiquetas:** `[VERIFICADO]` lido no repositório nesta rodada · `[PROPOSTA]` deste desenho · `[PENDENTE JURIDICO]` · `[NÃO VERIFICADO]` a conferir pelo Dev.

---

## 1. Resumo da arquitetura

H-114 entrega **três coisas**, nenhuma delas um motor de cobrança:

1. **O runbook** (documento canônico, procedimentos passo a passo D-04, D-05, D-06, D-07, D-09 e três reconciliações).
2. **Funções puras e fixtures sintéticas** que provam, sem rede, a lógica que o runbook descreve (batimento MP × livro, classificação de cota de e-mail, descarte de obsoletos, detecção de órfãos, redação de PII, formato do relatório de incidente).
3. **Testes de DEV** (estáticos sobre o runbook, unitários sobre as funções puras e `db:test` sobre as garantias já existentes no banco) que dão a evidência de cada critério.

Princípio de menor mudança: **nenhuma tabela nova obrigatória**. O contrato de `ops.reconciliation_report` (pergunta 714) fica **documentado como DDL proposto para a #66**, porque o motor e a persistência do batimento pertencem a H-053. Faixa de migração reservada (`20261120400000` a `20261120499999`): **não usada**, exceto a fatia opcional S3 (catálogo de ações de auditoria), só se o Dev confirmar que o catálogo é fechado.

### 1.1 Correções à premissa do refino (verificadas no repositório)

| Refino diz | Realidade `[VERIFICADO]` | Consequência no runbook |
|---|---|---|
| tabela `ops.app_keepalive` com `last_ping_at` | `app_keepalive` é um **papel de banco** (migração `20261110180000_platform_create_backup_keepalive_roles.sql`), não tabela; o keep-alive é o script `packages/db/scripts/keepalive.mjs` (`db:keepalive`) | D-04 não consulta tabela de heartbeat. Detecção por **falha de conexão** + execução de `db:keepalive`; sinal de defasagem vem de `ops.job` (último tick concluído), ver 4.1 |
| `admin.session`, `identity.app_user` | `app.admin_session`, `app.app_user` | usar nomes reais |
| `app.access_grant`, `app.payment` | `billing.access_grant`, `billing.subscription`, `billing.plan_price`, `billing.plan`. **Não existe tabela de pagamento** | batimento opera sobre estrutura-contrato (tipos TS) com campos mínimos; ver 5 |
| `access_adjustment`, `reconciliation_report` | inexistentes no banco | contrato documental para #66 |
| `ops.rate_counter` guarda uso diário de e-mail | `ops.rate_counter` é contador por **HMAC de chave e janela** (limite de taxa). A cota de e-mail está em `ops.external_quota` (`service`, `period` dia_utc/mes, `used`, `soft_limit`, `hard_limit`, `reserved_auth`, `alert_level`, `breaker_state`) | reconciliação de cota atua em `ops.external_quota` |
| `ADDRESS_ENC_KEY`, cofre de telefone | existem `apps/api/src/requests/address-crypto.ts` e `apps/api/src/contact/phone-crypto.ts` | versionamento de chave: Dev confirma se o formato já carrega versão (fatia S3) |

Também `[VERIFICADO]`: **restam artefatos de backup no repositório** (`packages/db/scripts/backup.mjs`, `db:backup` em `package.json`, `backup*.test.mjs`, migração `20261110180000` com papel de backup). A #151 é dada como concluída, mas isso contradiz a decisão. Não é escopo de H-114 alterar; ver riscos R-09. O runbook **não os referencia**.

---

## 2. Decisões de arquitetura

| Id | Decisão | Alternativa descartada | Motivo |
|---|---|---|---|
| A-1 | Runbook em arquivo único `docs/factory/147-RUNBOOK-INCIDENTE-RECONCILIACAO.md` (pergunta 721 a). Se o prefixo 147 já estiver ocupado na criação, usar o próximo livre e registrar. | vários arquivos | precedente do 108 |
| A-2 | Lógica verificável em **funções puras** (entrada: dados e `now`; saída: resultado), sem I/O e sem relógio global. | job completo com banco | batimento real é da #66; pura permite prova hoje (CA-H114-12, 19) |
| A-3 | **Nenhuma função do H-114 escreve em `billing.*`.** O batimento devolve relatório; teste prova imutabilidade (cópia profunda antes/depois e proxy somente leitura). | job que corrige acesso | RN-H114-04, 08 §8.8 |
| A-4 | Contenção D-09 por `ops.app_config` (chave booleana de degradação por rota, pergunta 712 a). O runbook define o **nome da chave e o efeito esperado (503 seguro)**. Se a API ainda não lê a chave, vira lacuna registrada e fatia S5 cria a porta mínima de leitura. | commit e deploy | segundos, não minutos |
| A-5 | Revogação D-07 escopo individual (709 a): revoga em `app.admin_session` e bloqueia `app.app_user` do operador; demais admins intactos. Reset de MFA reutiliza o mecanismo de **dupla aprovação** (`app.approval_request`/`app.approval_vote`, H-105). Nenhum caminho novo de aprovação. | derrubada global | precisão |
| A-6 | Chave criptográfica: janela de leitura da chave anterior **até contagem zero** (707 b), sem prazo fixo. O runbook define a consulta de contagem por versão. | 7 dias fixos | evita perda de leitura |
| A-7 | Redação de PII por **uma função única** `redactForRunbook` usada por todo gerador de relatório (e-mail `u***@d***.com`, telefone, CPF/CNPJ, texto livre removido). | redação por relatório | CA-H114-17 |
| A-8 | Marcador sintético `[TESTE-H114]` em todo dado criado em teste DB; limpeza no `after` do teste. Sem tocar dado fora do marcador. | dados soltos | R10 do refino |
| A-9 | Descarte de e-mail represado: fato gerador com mais de **12 h** ou pedido não aberto a aceites vira `descartado_obsoleto` (719 a). Nenhum reenvio de aceite antigo. | enviar tudo | decisão 27 |
| A-10 | Tolerância do batimento: ignora transações dos últimos **2 h** antes da execução (717 a). | tempo real | falso positivo |
| A-11 | Órfão Auth × `app.app_user`: janela de **15 min**; a função só **classifica** (`orfao_expirado`). A exclusão em `auth.users` fica atrás de porta, provada com fake. Não se escreve em `auth.users` real. | excluir direto | sem teste destrutivo no Auth |
| A-12 | Detecção D-04 (703 a adaptada): defasagem do último tick concluído em `ops.job` acima de 24 h = alerta, porque não há tabela de heartbeat. Dev confirma o campo exato (fatia S1). `[NÃO VERIFICADO]` | tabela nova de heartbeat | menor mudança; heartbeat tabela só se Dev provar que `ops.job` não serve |

---

## 3. Estrutura do runbook (arquivo a ser produzido pelo Dev)

Seções obrigatórias, nesta ordem, cada procedimento com o mesmo molde: **Gatilho, Quem, Pré-condições, Passos numerados (comando ou ação, resultado esperado), Verificação, Auditoria, Exercício sintético (como provar em DEV), Registro de evidência**.

0. Cabeçalho, escopo, etiquetas, glossário curto. Seção **Exclusões** (única que menciona backup, Mapbox e rotação de senha de banco, só para negar).
1. Regras gerais: papéis, canal de aviso, relógio em UTC, marcador `[TESTE-H114]`, redação de PII, uma linha de auditoria por ação.
2. D-04 Projeto pausado ou indisponível.
3. D-05 Migração falha (compensação).
4. D-06a Rotação de chave de envelope. D-06b Rotação de token de provedor (MP, Resend).
5. D-07 Conta administrativa comprometida.
6. D-09 Incidente de dados pessoais (contenção 15 min, apuração 24 h, minuta `[PENDENTE JURIDICO]`).
7. R-MP Reconciliação MP × livro (matriz, contrato do relatório, ações do Financeiro).
8. R-EMAIL Reconciliação de cota e fila de e-mail.
9. R-AUTH Reconciliação Auth × `app.app_user`.
10. Tabela de exercícios sintéticos e evidências (liga cada critério a um teste).
11. Pendências e itens `[PENDENTE JURIDICO]`.

---

## 4. Procedimentos (conteúdo mínimo a transcrever)

### 4.1 D-04 Projeto pausado
1. **Detecção:** erro de conexão (DNS/TCP) na API, ou `db:keepalive` falhando, ou último tick concluído em `ops.job` há mais de 24 h (A-12).
2. **Ação:** operador abre o console do projeto e aciona restaurar/despausar (704 a). Sem chave mestra de gestão guardada. Espera típica de poucos minutos.
3. **Verificação pós-retomada:** (a) `corepack pnpm db:status` sem pendências; (b) `corepack pnpm db:keepalive` com sucesso; (c) tick processa `ops.job` e `ops.outbox_event` sem acúmulo anormal; (d) gatilhos de imutabilidade de `audit.audit_event` habilitados (consulta a `pg_trigger.tgenabled` no catálogo, esperado `O` ou `A` conforme réplica, ver nota); (e) `pg_cron`, se instalado, com agenda presente em `cron.job`.
4. **Nota `[NÃO VERIFICADO]`:** o refino cita `tgenabled = 'A'`; o valor padrão é `O` (origem). O Dev lê o valor real do gatilho no banco e fixa o esperado no teste.
5. **Auditoria:** evento de execução do runbook (ver 6).

### 4.2 D-05 Migração falha
1. **Contenção (706 a):** parar a esteira local (nenhum `db:migrate` repetido às cegas); registrar a saída do erro.
2. **Diagnóstico:** `db:status` e consulta a `ops.schema_migration` (versão, checksum). Se a migração rodou em transação única, nada ficou aplicado.
3. **Correção (705 a):** nunca editar migração já aplicada; criar migração compensatória com prefixo = maior existente + `10000`; padrão expandir e contrair, sem `DROP` com dado vivo; toda migração com rollback pareado como o padrão do repositório.
4. **Verificação:** `db:migrate` e `db:status` com zero pendências; `db:test` verde.
5. **Exercício:** migração sintética que falha por constraint em schema descartável de teste, provando que `ops.schema_migration` não registra a versão falha e que a compensatória aplica.

### 4.3 D-06 Rotação
**a) Chave de envelope (707 b).**
1. Gerar chave nova (32 bytes), guardar em `.env.local` ou segredo do ambiente; **nunca** em chat ou commit.
2. Configurar nova como escrita e a anterior como leitura (formato com identificador de versão; Dev confirma o formato existente em `address-crypto.ts` e `phone-crypto.ts`).
3. Implantar leitura dupla. Novos registros saem só com a chave nova.
4. Recifrar progressivamente (lote, retomável, idempotente).
5. Consulta de contagem por versão; só com **zero** registros na versão antiga remover a chave anterior.
6. Falha de decifragem em registro antigo gera alerta e **não** apaga dado.

**b) Token de provedor (708 a).** Gerar novo no painel; trocar variável; teste sintético de aceitação; revogar o antigo em até 1 h; webhooks pendentes continuam aceitos durante a troca (segredo de assinatura aceita par atual e anterior por janela curta, `[PROPOSTA]`: o Dev confere como `webhook-signature.ts` trata isso).

**c) Pepper de documento e segredos de sessão.** Mesma lógica de versão com revalidação no login; troca de segredo de sessão invalida sessões de forma controlada e comunicada. Proibido: rotação de senha do banco de DEV (decisão 150) e qualquer item de mapa.

### 4.4 D-07 Conta administrativa comprometida
1. **T0 a T+5 min:** revogar sessões de `app.admin_session` do operador e bloquear o `app.app_user` (709 a). Confirmar que o token antigo recebe 401 ou 403.
2. **T+5 a T+30 min:** redefinição de segundo fator só por dupla aprovação de duas identidades distintas (710 a), sem autoaprovação, reutilizando `approval_request` e `approval_vote`.
3. **T+30 min a T+2 h:** consulta a `audit.audit_event` pelo ator no intervalo (visualizações excepcionais, mudança de papel, acesso a caso). Acesso indevido comprovado aciona D-09.
4. **Auditoria:** cada ação gera evento; a trilha nunca é alterada.
5. Os nomes de ação (`admin.session.revoked` etc.) só valem se existirem em `audit.action_catalog`; o Dev os confere (S4).

### 4.5 D-09 Incidente de dados
1. **Gatilho (711 a):** qualquer exposição não autorizada de dado protegido (documento, foto de verificação, telefone, endereço exato), sem piso de quantidade.
2. **Contenção até 15 min (712 a):** gravar chave de degradação em `ops.app_config` para a rota afetada (resposta 503 constante); revogar credencial (D-06, D-07); invalidar sessões suspeitas.
3. **Apuração até 24 h:** formulário fixo de relatório (título, instante UTC, rota ou vetor, contagem de titulares, classes de dado, medidas, status da contenção). Todo valor passa por `redactForRunbook`.
4. **Comunicação (713 a):** minuta de ANPD e de titulares como `[PROPOSTA]` e `[PENDENTE JURIDICO]` (L1/L2). Uso real só após validação do encarregado. Nada é enviado em DEV.

### 4.6 R-MP Reconciliação MP × livro
Contrato `[PROPOSTA]` (tipos TS, sem persistência):

- `GatewayPayment { externalId, status, amountCents, approvedAt, planCode, subscriptionExternalId }`
- `LedgerEntry { externalId | null, grantId, kind, amountCents, planCode, startsAt, endsAt, cancelAtPeriodEnd }`
- Saída `ReconciliationFinding { type: 'T1_faltando_local' | 'T2_concessao_sem_pagamento' | 'T3_valor_divergente' | 'T4_recorrencia_divergente', externalIdMasked, expected, found, severity }`

Regras: (1) ignora pagamento aprovado há menos de 2 h (A-10); (2) T1 = aprovado no gateway e ausente no livro; (3) T2 = concessão `paid` sem pagamento aprovado ou com estorno/rejeição; (4) T3 = valor diferente do vigente em `billing.plan_price` na data; (5) T4 = cancelado de um lado e ativo do outro; (6) **a função devolve achados e nunca altera entrada**; (7) toda ação corretiva é humana (Financeiro, ajuste manual justificado e auditado, #66+).
Persistência futura (para #66, não criada aqui): `ops.reconciliation_report` (714 a) com id, janela, contagens por tipo, achados mascarados, `created_at`; e alerta interno sem e-mail.

### 4.7 R-EMAIL Cota e fila
1. Limiares de `ops.external_quota` (serviço Resend): 70% alerta 1, 85% alerta 2, 90% corte de classes não críticas (digest, lembrete, marketing); reserva de 10% só para `auth` (100/dia, 3.000/mês).
2. **Delta do SMTP do Auth (718 a):** a rotina compara o uso informado pelo Resend com `used` e ajusta `used` pelo delta positivo. Em DEV a leitura do Resend é uma **porta com fake**; nenhuma chamada real.
3. **Fila (719 a):** itens `adiado_cota` são reavaliados na virada do dia UTC; obsoletos viram `descartado_obsoleto`; zero reenvio retroativo.
4. Dev confere o vocabulário real de status em `ops.email_outbox` (migração `20261111120000`) e adapta os nomes; a regra de negócio não muda.

### 4.8 R-AUTH Órfãos
Função pura recebe duas listas (contas do Auth, `app.app_user`) e `now`; devolve as contas sem par com idade acima de 15 min (A-11). Execução real só atrás de porta; o runbook descreve o procedimento manual no console do Auth para DEV.

---

## 5. Testes e o que é testável no DEV com dados sintéticos

Todos sem rede, com `now` injetado, dados marcados `[TESTE-H114]`.

| Critério | O que se prova | Tipo | Onde |
|---|---|---|---|
| CA-01 | runbook não contém `pg_dump`, `restore_db`, `dump_s3`, `app_backup_reader`, `db:backup`; a palavra backup só na seção Exclusões | estático | `*.test.mjs` |
| CA-02 | zero menção a Mapbox fora de Exclusões | estático | idem |
| CA-20 | seções 0 a 11 presentes e cada procedimento com os 8 campos do molde | estático | idem |
| CA-03 | D-04: consultas do passo 3 funcionam em DEV; gatilhos de `audit.audit_event` habilitados; tick consome job sintético | `db:test` | `packages/db/tests/runbook-h114.dbtest.mjs` |
| CA-04 | D-05: falha induzida em schema descartável não registra versão; compensatória aplica | `db:test` | idem |
| CA-05 | D-06a: cifra com V1, lê com V1+V2, grava com V2, contagem de V1 vai a zero após recifragem | unitário | `apps/api/tests` ou `packages/domain` |
| CA-06 | D-06b: troca de segredo de assinatura aceita par atual e anterior; fake de provedor | unitário | idem |
| CA-07, 08 | D-07: sessão revogada nega acesso; reset de MFA exige dois aprovadores distintos, nega autoaprovação; eventos de auditoria gravados | `db:test` (reuso de H-105) | idem |
| CA-09 | D-09: chave em `ops.app_config` muda resposta da rota de teste para 503 constante, sem redeploy | unitário/composição | idem |
| CA-10 | relatório de incidente com os 4 campos; minuta marcada `[PENDENTE JURIDICO]` | unitário + estático | idem |
| CA-11, 12 | R-MP: 3 divergências intencionais geram 3 achados; entrada intacta; sem `billing.*` real; sem credencial | unitário | idem |
| CA-13 | R-EMAIL: 70, 85 e 90 mensagens produzem alerta 1, alerta 2, corte; `auth` passa até 100 | unitário sobre regra de `external_quota` | idem |
| CA-14 | obsoletos viram `descartado_obsoleto`; zero envio | unitário | idem |
| CA-15 | delta do Resend ajusta `used` sem passar de `hard_limit` | unitário | idem |
| CA-16 | órfão com mais de 15 min é sinalizado; com menos, não | unitário | idem |
| CA-17 | nenhuma saída contém e-mail, telefone ou CPF em claro | unitário (todas as saídas) | idem |
| CA-18 | cada exercício grava um evento em `audit.audit_event` com ator, papel, motivo, instante | `db:test` | idem |
| CA-19 | suíte completa roda offline com `p_now`/`now` injetado | execução | `check:all` local |

Nada é provado contra Mercado Pago, Resend ou Auth reais. Fica **não testável no DEV**: despausa real do console (D-04 passo 2), revogação real em painel de provedor (D-06b), exclusão real em `auth.users` (R-AUTH), parecer jurídico (D-09). Esses passos são descritos e marcados como manuais.

---

## 6. Segurança e privacidade

- Redação única (A-7); nenhuma saída contém PII; nenhum segredo em log, relatório ou comentário de Issue.
- Menor privilégio: nenhuma chave mestra de gestão de infraestrutura guardada; o runbook usa console.
- Auditoria só acrescenta (RN-H114-06). O runbook proíbe `UPDATE`, `DELETE` ou `TRUNCATE` em `audit.audit_event`.
- Nada de produção, backup, exportação de dados, Mapbox ou rotação de senha do banco.

## 7. Fatias de Desenvolvimento (ordem sequencial; uma por vez)

| Fatia | Entrega | Critérios | Migração |
|---|---|---|---|
| **S1** | Runbook esqueleto completo (seções 0 a 11), D-04 e D-05 escritos; teste estático (CA-01, 02, 20); dbtest D-04/D-05 sobre schema descartável; confirmar campo de defasagem em `ops.job` e valor de `tgenabled` | 01, 02, 03, 04, 20 | não |
| **S2** | Pacote puro de utilidades: `redactForRunbook`, modelos de tipos, fixtures sintéticas `[TESTE-H114]`; testes de redação | 17 | não |
| **S3** | D-06: runbook D-06a, D-06b, c; teste de versionamento V1/V2 sobre `address-crypto` e `phone-crypto` (se o formato não tiver versão, registrar lacuna e propor expansão como cartão separado, sem mudar formato aqui); janela dupla de segredo de webhook | 05, 06 | opcional: nenhuma |
| **S4** | D-07: runbook; dbtest de revogação de sessão e dupla aprovação sobre mecanismos existentes; conferir `audit.action_catalog` | 07, 08, 18 | **condicional** `20261120400000_audit_add_runbook_actions` (+ rollback) só se o catálogo for fechado e faltar ação |
| **S5** | D-09: runbook, formulário de relatório, minuta `[PENDENTE JURIDICO]`; teste de contenção por `ops.app_config`; porta mínima de leitura da chave se faltar | 09, 10 | não |
| **S6** | R-MP: função pura de batimento, fixtures de 3 divergências, teste de imutabilidade; contrato documentado para #66 | 11, 12 | não |
| **S7** | R-EMAIL e R-AUTH: funções puras e testes; runbook das duas seções | 13, 14, 15, 16 | não |
| **S8** | Exercício integrado: executa todos os cenários, anexa a evidência (comando, contagem, saída) à Issue; revisão final de CA-18 e CA-19 | 18, 19 | não |

Independência: S2 antes de S5, S6, S7 (usam redação e fixtures). S1, S3, S4 independentes entre si. Nenhuma fatia depende de #60 a #66.

## 8. Riscos

| Id | Risco | Mitigação |
|---|---|---|
| R-01 | Premissa do refino divergente do banco (heartbeat, nomes, `external_quota`) | tabela 1.1; Dev confere cada nome antes de escrever o teste |
| R-02 | Runbook descreve estrutura de #66 que depois mude | contrato marcado `[PROPOSTA]`; #66 pode ajustar com registro |
| R-03 | Formato de chave de envelope sem versão no código atual | S3 registra lacuna e abre cartão; H-114 não altera formato |
| R-04 | Ações de auditoria inexistentes no catálogo | S4 cobre; migração condicional na faixa reservada |
| R-05 | Teste DB sujar banco compartilhado de DEV | marcador `[TESTE-H114]`, limpeza no `after`, schema descartável para D-05 |
| R-06 | PII em relatório | A-7 e CA-17 sobre todas as saídas |
| R-07 | Minuta jurídica tratada como definitiva | etiqueta obrigatória e teste estático da etiqueta |
| R-08 | Prefixo 147 ocupado | A-1 prevê o próximo livre |
| R-09 | **Artefatos de backup ainda no repositório** (`db:backup`, `backup.mjs`, testes, papel de backup) contradizem a #151 | fora do escopo de H-114; o runbook não os cita; **o líder deve decidir se reabre limpeza** (registrar como pendência, não como tarefa de H-114) |
| R-10 | Teste de contenção D-09 depende de rota real | usar rota de teste na composição; sem rota de produção |

## 9. Perguntas e pendências ao líder (sem envio ao usuário)

1. **P-1 (R-09):** artefatos de backup remanescentes. Recomendação: abrir cartão de limpeza fora de H-114 se a decisão da Rodada 73 for vigente.
2. **P-2:** ausência de heartbeat em tabela (A-12). Recomendação: usar `ops.job`; criar tabela só se o Dev provar insuficiência.
3. **P-3:** tabela de pagamento inexistente. Recomendação: seguir com contrato em tipos até #60 a #66.

Nada bloqueia o Dev: as três têm caminho adotado.
