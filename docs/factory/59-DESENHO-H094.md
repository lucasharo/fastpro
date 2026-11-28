# Desenho H-094 — Cota do Resend: contador, alertas e degradação (Issue #104, WF-03, coluna Arquitetura)

- **Issue:** #104 · **História:** H-094 · **Workflow:** WF-03 · **Data:** 2026-11-11 · **Papel:** Software Architect
- **Decisão:** `APROVADO_ARQUITETURA` (sem dúvida pendente ao usuário; ver §7).
- **Rastro:** 58-REFINO-H094 (CA-H094-01..17; D1..D6 decididas pelo Orquestrador); 35-DESENHO-H092 §3.4 e §7; 08 §12.6; 09 §3.11; código lido (somente leitura): `supabase/migrations/20261111120000_notifications_create_pipeline.sql` (`ops.external_quota`, `private.email_outbox_reservar_cota`, `email_quota_release`, `email_quota_registrar_alerta`), `packages/domain/src/notifications/quota.ts`, `packages/db/src/notifications.ts`, `packages/observability/src/allowlist.json`.
- **Natureza:** somente documento. Nenhum código, migração, envio ou rede nesta etapa.

## 0. Achado principal: a maior parte já existe (H-092)

H-092 já entregou o contador diário UTC e mensal em `ops.external_quota`, a reserva atômica antes do envio, a devolução, os cortes por classe (`QUOTA_CUTS`), o adiamento para o próximo dia/mês UTC e o registro de nível de alerta. Os cortes da §2.3 do refino (70/85/90/100 no dia e 2.100/2.550/2.700/3.000 no mês) **já estão corretos em `quota.ts`** e testados (T-H92-02, T-H92-21). Logo H-094 é uma **mudança pequena e localizada**, não um subsistema novo:

| Item | Estado hoje | O que H-094 faz |
|---|---|---|
| Contador dia UTC e mês, por destinatário | Pronto (`reservar_cota`, `used`+1 por linha de envio; 1 linha = 1 destinatário) | Só testes de regressão e de virada (§5) |
| Cortes por classe, reserva de login | Pronto (`QUOTA_CUTS`; reserva = diferença entre corte de `auth` e de `critico`) | Só testes e travar a coerência (§4) |
| Alertas | **Divergente:** `alertLevelFor` gera níveis 1 (70%), 2 (85%) e **3 (95% ou 90/2.700)** | Reduzir a níveis 1 e 2; sinalizar a transição; emitir evento (§2) |
| Painel de alertas | Não existe | Fica em H-108; H-094 só garante o formato de leitura (§2.4) |
| Reconciliação com o Resend, `windowFactor` | Não existem | **Fora** (D4; ver §7) |
| Documentos com 95% | 14 (H-094, H-108), 35 §7, 08 §12.6 | Atualizar texto (§2.5) |

## 1. Contador (CA-H094-01..03)

- **Modelo (sem tabela nova).** `ops.external_quota` com `service='email'`; duas linhas por período, criadas sob demanda pela função de reserva: `period='dia_utc'`, `period_start` = dia UTC (100, soft 90, reserva 10) e `period='mes'`, `period_start` = 1º dia do mês **UTC** (3.000, soft 2.700, reserva 300). Chave `(service, period, period_start)`; `CHECK used <= hard_limit`. A virada do dia/mês é a troca de `period_start`: a linha nova nasce com `used=0` e a antiga fica como histórico (CA-H094-02). O fuso é sempre UTC (`at time zone 'UTC'`), nunca o do servidor nem America/Sao_Paulo (D3).
- **Quando conta.** A reserva soma 1 nas duas linhas na mesma transação, **antes** de chamar o provedor (DD-5 de 35). Se o provedor não aceita (limite de taxa, indisponível, recusa, suprimido, descartado), a devolução subtrai 1 da linha do dia/mês **da data da reserva** (`quota_reserved_at`), só se `used > 0`. Aceito ⇒ a reserva vira consumo. Erro entre reserva e resposta mantém a reserva (conta a mais, nunca a menos; CA-H094-03).
- **Por destinatário.** Uma linha de `email_outbox` tem um destinatário; o adaptador nunca usa CC/BCC (35 §3.4). Dois destinatários = duas linhas = 2 na cota. Nada a mudar.
- **Desenvolvimento** conta na mesma cota (D5): o contador não distingue ambiente. Os testes automáticos usam datas de 2099 (linhas isoladas) e dublê de provedor; não consomem a cota real.

## 2. Alertas em 70% e 85% (CA-H094-04..07)

### 2.1 Regra
`alertLevelFor(used, limit)`: nível 0 abaixo de 70%; **1** de 70% a 84%; **2** a partir de 85%. Aritmética inteira (`used*100 >= limit*pct`). Para o dia: 70 e 85; para o mês: 2.100 e 2.550. **Some o nível 3**: remove-se o degrau de 95% e o parâmetro `criticalAt` (90/2.700 passam a ser apenas o corte da classe `critico`, §3). O tipo vira `AlertLevel = 0 | 1 | 2`.

### 2.2 Idempotência e “uma única vez”
`private.email_quota_registrar_alerta` já usa `greatest(alert_level, novo)` e só atualiza `alerted_at` quando o nível sobe: repetir não duplica nem rebaixa. Falta saber **se subiu**, para emitir o evento só na primeira vez. Mudança de contrato (nova migração, §2.3): a função passa a **devolver** `(out_dia_subiu boolean, out_mes_subiu boolean, out_nivel_dia smallint, out_nivel_mes smallint)`, calculando a subida na própria `UPDATE ... RETURNING` (comparação do nível antigo e novo sob o bloqueio da linha). Dois envios concorrentes: o segundo vê o nível já subido e não emite.

### 2.3 Migração (nova, `supabase/migrations/2026111127xxxx_notifications_email_alert_levels.sql`, com `rollbacks/*.down.sql`)
- `drop function` da assinatura atual e `create function` com o novo retorno (o tipo de retorno não pode mudar por `create or replace`). Mesma assinatura de entrada `(smallint, smallint, timestamptz)`, `set search_path = ''`, `revoke ... from public, anon, authenticated, service_role` e `grant execute ... to app_system` (reaplicar, igual às linhas 803-846 da migração 120000).
- Validar entrada: `p_nivel_* between 0 and 2`, senão `22023`.
- **Não** alterar o `CHECK alert_level between 0 and 3` da tabela: ela é compartilhada com `mapbox_geocoding_temp` (níveis 0..2) e o email passa a usar só 0..2; apertar a restrição é opcional e fora do escopo.
- O desfazer recria a função antiga (retorno `void`).
- Sem mudança em `reservar_cota`, `release`, tabelas, índices ou RLS (o contrato de privilégios e a postura “somente `app_system`” permanecem).

### 2.4 Persistência, exibição e métrica
- **Gravação:** `alert_level` e `alerted_at` nas linhas `dia_utc`/`mes` do período corrente. Como as linhas são por período, o alerta “reinicia” sozinho na virada. `alerted_at` guarda o instante da última subida de nível (basta para o painel; o histórico por nível não é gravado — não há requisito).
- **Exibição:** nenhuma tela nova (D2). O painel H-108 lê `ops.external_quota where service='email'` (`used`, `hard_limit`, `alert_level`, `alerted_at`) e calcula `%`. H-094 não cria view nem endpoint; o formato acima é o contrato de leitura de H-108.
- **Métrica sem dado pessoal:** `NotificationDeps` ganha o ponto de injeção opcional `onQuotaAlert?: (a: { period: 'dia_utc'|'mes'; level: 1|2; used: number }) => void`, chamado **só quando a função devolve “subiu”**. O produto liga-o ao logger com campos já permitidos pela allowlist (`module='notifications'`, `event='email_quota_alert'`, `status='dia_70'|'dia_85'|'mes_70'|'mes_85'`, `count=used`). **Não** acrescentar campo novo à allowlist. `packages/db` não passa a depender de `packages/observability`.
- **Só informa (CA-H094-07):** o alerta não é lido pelo caminho de envio; a decisão de enviar usa apenas `decideQuota` sobre `used`.

### 2.5 Documentos a atualizar pelo DEV (texto, no mesmo commit)
14-BACKLOG linhas H-094 e H-108 (“70 e 85%”; tirar 95%; tirar “reconciliação”); 35 §7 (item Alertas e fronteira H-092×H-094: tirar 95% e reconciliação/`windowFactor`); 08 §12.6 item 4 (alertas 70/85; o “≥ 90 / ≥ 2.700” é corte da classe `critico`, não alerta; sem “reconciliado”); 09 §3.11 se citar 95%. O 17-CHECKLIST linha do Storage (70/85/95% do 1 GB) **não é de e-mail** e não muda.

## 3. Reserva de login e degradação por classe (CA-H094-08..14)

Sem mudança de lógica: `decideQuota(class, usedDia, usedMes, QUOTA_CUTS)` já implementa “permitido enquanto `used < corte`, no dia **e** no mês”, bloqueio por `mes` com precedência, e o caminho `processOutbox` reserva com os cortes da classe e reagenda `adiado_cota` para 00:00 UTC do dia seguinte (ou do mês seguinte) sem consumir tentativa.

| Classe | Dia | Mês | Efeito ao chegar no corte |
|---|---|---|---|
| `auth` | 100 | 3.000 | só ele usa a reserva (10/dia e 300/mês) |
| `critico` | 90 | 2.700 | adiado |
| `digest` | 85 | 2.550 | adiado |
| `lembrete` | 70 | 2.100 | adiado |

- **Reserva de login:** não é coluna nem contador à parte; é a diferença entre o corte de `auth` (100/3.000) e o de `critico` (90/2.700). A coluna `reserved_auth` é informativa (10/300) e deve permanecer igual a `hard_limit - soft_limit`; um teste trava essa coerência (§5, TD-12).
- **`auth` com dia cheio (100):** `adiado_cota` com recuo; a resposta HTTP do login continua uniforme 202 (H-097), sem depender de H-094.
- **Reavaliação por prioridade e descarte de fato obsoleto** (CA-H094-13, 17): já cobertos por H-092 (35 §5.4 passo 2, §7). H-094 só repete a regressão.
- **Chat e site** (CA-H094-14): a mensagem automática é gravada pelo domínio de chat, sem passar por `email_outbox` (35 §7). Sem mudança.
- **Sem interruptor** (CA-H094-15, 16): o único filtro de envio é `decideQuota`. Não há leitura de `ops.app_config`, flag, tabela de ativação ou tela para e-mail; nenhuma chave nova é criada. Um teste de guarda confirma (TD-13).

## 4. Constantes de código (D6)

Fonte única: `packages/domain/src/notifications/quota.ts`. Acrescentar:

```
export const ALERT_THRESHOLDS_PCT = Object.freeze({ nivel1: 70, nivel2: 85 });
export type AlertLevel = 0 | 1 | 2;
export function alertLevelFor(used: number, limit: number): AlertLevel;   // sem criticalAt
```
Já existem e permanecem: `PROVIDER_LIMITS = {dia:100, mes:3000}` (fato do serviço) e `QUOTA_CUTS` por classe (congelados com `Object.freeze`). **Nenhuma chave em `ops.app_config`**; nenhuma variável de ambiente para limite; trocar um valor é trocar código e fazer deploy. Os literais SQL em `reservar_cota` (100/90/10 e 3000/2700/300 ao criar as linhas, faixa `1..100` e `1..3000`) repetem `PROVIDER_LIMITS`: manter e **travar a coerência por teste** (TD-12), em vez de passá-los como parâmetro (evita alterar a assinatura já em uso por `processOutbox` e pelos testes de H-092).

Chamadas a ajustar em `packages/db/src/notifications.ts` (~linhas 333 e 508-511): `alertLevelFor(r.usadoDia, PROVIDER_LIMITS.dia)` e `alertLevelFor(r.usadoMes, PROVIDER_LIMITS.mes)`; `recordAlerts` passa a devolver `{ diaSubiu, mesSubiu, nivelDia, nivelMes }` e chama `d.onQuotaAlert` só nas subidas; pular a chamada ao banco quando os dois níveis forem 0 (evita duas escritas por envio abaixo de 70%).

## 5. Testes para o DEV (sem rede, sem envio real, sem conta)

Banco de desenvolvimento e unidade; relógio fixo em 2099 (linhas isoladas, transações desfeitas), guarda de rede do projeto (`fixtures/no-network.mjs`) ativa; provedor sempre `FakeEmailProvider`. Rodar localmente (`corepack pnpm check:all`, `db:test`).

**Unidade (`packages/domain/tests`)** — ajustar `notifications-policy.test.ts` (linhas ~122-127, hoje esperam nível 3) e acrescentar:
- TU-01 `alertLevelFor` dia: 69→0, 70→1, 84→1, 85→2, 90→2, 99→2, 100→2; mês: 2.099→0, 2.100→1, 2.549→1, 2.550→2, 2.700→2, 3.000→2. Nunca devolve 3.
- TU-02 coerência: `ALERT_THRESHOLDS_PCT` aplicado a `PROVIDER_LIMITS` dá 70/85 e 2.100/2.550; `QUOTA_CUTS.lembrete` = nível 1 e `QUOTA_CUTS.digest` = nível 2 (dia e mês); `QUOTA_CUTS.critico` = 90/2.700; `QUOTA_CUTS.auth` = `PROVIDER_LIMITS`.
- TU-03 constantes imutáveis (`Object.isFrozen`); a tabela completa de cortes de `decideQuota` (T-H92-02) permanece verde.
- TU-04 `recordAlerts` (com `SqlClient` dublê): `onQuotaAlert` chamado uma vez por subida; zero chamadas se a função devolve “não subiu”; nenhuma chamada ao banco quando os dois níveis são 0; o argumento do evento não contém campo livre (só `period`, `level`, `used`).

**Banco (`packages/db/tests/*.dbtest.mjs`, novo `notifications-cota-h094.dbtest.mjs`)**
- TD-01 contagem: envio aceito (dublê) soma 1 em `dia_utc` e `mes`; dois destinatários = 2; recusa/`limite_taxa`/`indisponível` devolve a reserva e o contador volta ao valor anterior; nunca fica abaixo de 0.
- TD-02 virada de dia: `p_now`=`2099-01-01T23:59:59.999Z` conta na linha de 01-01; `2099-01-02T00:00:00Z` abre linha nova com `used=1` e a de 01-01 não muda; o mês acumula.
- TD-03 virada de mês e fuso: `2099-01-31T23:59:59Z` → linha de `2099-01-01`; `2099-02-01T00:00:00Z` → `2099-02-01`; `2099-02-01T01:00:00Z` (ainda 31/01 em São Paulo) → mês de fevereiro (prova UTC, não Brasília).
- TD-04 alerta 70 no dia: com `used=69`, uma reserva leva a 70 ⇒ `alert_level=1`, `alerted_at` preenchido; função devolve `out_dia_subiu=true`. Segunda reserva (71) ⇒ continua 1, `alerted_at` não muda, `subiu=false`.
- TD-05 alerta 85 no dia: com `used=84` ⇒ 85 ⇒ nível 2; idem mensal com 2.099→2.100 (nível 1) e 2.549→2.550 (nível 2).
- TD-06 sem rebaixar: `release` depois do alerta (used volta a 69) mantém `alert_level`; `registrar_alerta(0,0)` não altera nada.
- TD-07 período novo, alerta novo: na virada do dia o nível começa em 0 na linha nova e o alerta do dia anterior permanece no histórico.
- TD-08 concorrência: 10 transações em paralelo cruzando o 70 produzem exatamente **uma** subida (`subiu=true` em só uma) e o `used` final correto.
- TD-09 degradação por classe com dados reais (reaproveitar o padrão de `notifications-cortes.dbtest.mjs`): `used`=70 adia `lembrete` e deixa passar `digest`; 85 adia `digest`; 90 adia `critico` e passa `auth`; 100 adia `auth` com `adiado_cota`/`next_attempt_at` = 00:00 UTC seguinte; mês cheio adia mesmo com dia livre e vice-versa.
- TD-10 reavaliação: linhas `adiado_cota` de classes diferentes, após virar o dia, saem na ordem `auth`, `critico`, `digest`, `lembrete`; item cujo fato ficou obsoleto é `descartado`; nenhum aceite antigo é reenviado (regressão CA-H094-13 e 17).
- TD-11 alerta não bloqueia: com `alert_level=2` e `used` < corte da classe, o envio segue (CA-H094-07).
- TD-12 coerência SQL × código: as linhas criadas por `reservar_cota` têm `hard_limit` 100/3.000, `soft_limit` 90/2.700 e `reserved_auth` 10/300 iguais a `PROVIDER_LIMITS`/`QUOTA_CUTS.critico` do TypeScript, e `reserved_auth = hard_limit - soft_limit`.
- TD-13 sem interruptor: `ops.app_config` não tem chave de e-mail/cota/limite/ativação (consulta por padrão `email|quota|cota|resend` retorna zero); busca estática em `packages/db/src/notifications.ts` e `packages/domain/src/notifications/` mostra que o caminho de envio não lê `app_config` além das janelas de digest já existentes; nenhuma rota de admin altera limite.
- TD-14 chat independente: com a cota esgotada (`used=100`), aceitar um pedido grava a mensagem automática no chat e o aceite funciona (regressão da garantia de 35 §7/§10).
- TD-15 migração: `up` aplica; função nova rejeita nível 3 (`22023`); `down` restaura a função antiga; privilégios: `app_api`/`anon`/`authenticated` sem `EXECUTE`.

Nenhum teste chama o Resend, abre SMTP ou usa a cota real; o relatório do DEV registra comando, contagem e código de saída.

## 6. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Mudança de assinatura/retorno da função de alerta quebra chamadores e testes de H-092 | Única chamada em `PgNotificationStore.recordAlerts`; teste TU-04/TD-15; `drop`+`create` explícito na migração com desfazer |
| R-2 | `recordAlerts` roda **depois** da reserva, fora da mesma transação; falha entre as duas perde a transição | Auto-corrigível: o próximo envio recalcula o nível pelo `used` atual e sobe (`greatest`). Só perde se não houver mais nenhum envio no período, caso sem consequência (nada a avisar). Risco aceito |
| R-3 | Literais de limite repetidos em SQL e TypeScript divergirem | Teste TD-12 trava a coerência; alteração de limite é sempre mudança de código + migração revisada |
| R-4 | Contador local divergir do painel do Resend (S-11: cabeçalhos de cota vieram 0) | Contagem conservadora (reserva antes; dúvida conta a mais). Reconciliação fora desta história (D4); ver §7 |
| R-5 | Os 100/dia e 3.000/mês são `[NÃO VERIFICADO]` em S-11 (herdados do doc 13) | Se o limite real for menor, a degradação chega tarde; confirmar no primeiro envio real, após domínio (BLQ-EXEC). Constantes em um só lugar facilitam o ajuste |
| R-6 | Devolução de reserva atravessando a meia-noite UTC decrementa a linha do dia antigo | Intencional: a devolução usa `quota_reserved_at`, a data da reserva; coberta por TD-02/TD-01 |
| R-7 | Alerta que “cruzou” e voltou (devolução) permanece gravado | Intencional (`greatest`): alerta informativo, sem efeito no envio; some na virada do período |
| R-8 | Dia cheio de `auth` (100) esgota a reserva; login adiado | Resposta uniforme 202 e recuo (H-097); evento de nível 2 já avisou antes (a 85) |
| R-9 | Remover o 95% deixa 08 §12.6, 35 §7 e 14 desatualizados | Atualização de texto obrigatória no mesmo commit (§2.5); revisão de código confere |
| R-10 | `adiado_cota` depende de job agendado para acordar em 00:00 UTC | `email_outbox_reagendar` já enfileira `outbox`/envio em `next_attempt_at`; TD-10 prova a reavaliação |
| R-11 | Envios de desenvolvimento reais (quando houver chave) gastam a cota de produção (D5) | Só testes com dublê; envio real apenas pontual, para a conta cadastrada, e registrado na evidência |

## 7. Dúvidas ao Orquestrador (com recomendação)

Nenhuma bloqueia o desenho.
- **E-1. `windowFactor` (alargar janela de digest com a cota) e reconciliação.** 35 §7 atribuía a H-094 o alargamento da janela de digest por nível de cota e a reconciliação com o provedor. O refino 58 (D4) tira a reconciliação e **não** traz critério de aceite para `windowFactor`. **Recomendação:** não implementar `windowFactor` em H-094 (o digest já é adiado a 85 pelo corte; alargar janela é refinamento sem requisito); registrar a retirada em 35 §7 e 14 (§2.5) e, se o usuário quiser, abrir história própria depois. Sem impacto nos CAs.
- **E-2. Aperto do `CHECK alert_level`.** Recomendação: não apertar (compartilhado com Mapbox; níveis do e-mail ficam 0..2 pela função e pelo tipo). Sem decisão pendente.

## Resumo em linguagem simples

O site já conta os e-mails por dia e por mês e já adia os avisos menos urgentes quando o limite grátis do Resend está perto; esta etapa só ajusta os avisos internos para 70% e 85% (sem o de 95%), garante que cada aviso apareça uma única vez e prova tudo com testes, sem enviar nenhum e-mail de verdade. O login continua com prioridade, o chat e o site não dependem de e-mail, e não existe botão para ligar ou desligar e-mails.
