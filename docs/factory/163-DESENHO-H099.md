# Desenho H-099 — Lembretes de prazo, trial e ciclo (Issue #109)

- **Issue:** #109 `[E11] Lembretes de prazo, trial e ciclo` · **História:** H-099 · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ2-109-20261120.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-20.
- **Entrada:** `docs/factory/159-REFINO-H099.md` (PO). Perguntas 870 a 889: todas **adotadas pelo líder** com a recomendação marcada (decisão do líder, vetável). Pontos `[PENDENTE JURÍDICO]` rodam como `[PROPOSTA]`.
- **Natureza:** somente documento. Nenhum código, migração, banco, quadro ou `11-DECISOES.md` alterado nesta etapa.
- **Etiquetas:** `[VERIFICADO]` lido no repositório · `[DECISÃO ARQ]` decisão deste desenho · `[PROPOSTA]` a validar · `[PASSO 0]` verificação obrigatória do DEV antes de codar a fatia · `NAO INICIAR` fatia bloqueada por Issue aberta.

---

## 1. Resumo da arquitetura

Entregar quatro lembretes por e-mail **já testáveis** (prazo do pedido T-24h e T0; trial T-3d e T0) e deixar **especificado, mas NÃO iniciado**, o lembrete do ciclo pago (T-3d e T0), que depende das Issues #60 a #63 e de BLQ-JUR L2/L3.

Ideia central: **nenhuma tabela nova e nenhum pipeline novo**. Reaproveita-se o que já existe.

```
reminder.scan (job recorrente, a cada 5 min, ops.job)
   |  olha adiante 15 min e para trás (tolerância) e acha marcos devidos
   v
ops.job  kind='reminder.fire'  run_at = instante exato do marco   (dedupe_key por recurso+marco)
   |  tick (A/C/D) reivindica o job no horário
   v
private.reminder_emit  ->  ops.outbox_event  (reminder.request | reminder.trial | reminder.cycle), sem PII
   v
outbox.dispatch (existente) -> rule.resolve -> ops.notification_item -> ops.email_outbox (classe lembrete, dedupe_key)
   v
email.send / processOutbox (existente): isStillRelevant -> cota (corte lembrete 70/dia, 2100/mês) -> provedor
```

`[VERIFICADO]` existe e é reaproveitado sem alteração:
- `ops.job` (`kind`, `dedupe_key` único, `run_at`, `payload_ref`, lease) e `private.job_enqueue` idempotente (`on conflict (dedupe_key) do nothing`) — migração `20261110130000`.
- `ops.email_outbox` (`dedupe_key` único, classe, estados `adiado_cota`/`descartado`), `ops.notification_item` (único por `source_event_id, recipient_user_id, category, scope_key`), `private.notification_ingest` — migração `20261111120000`.
- `dispatchOutbox`, `processOutbox` (revalida com `isStillRelevant` a cada claim, inclusive após `adiado_cota`; `MAX_SEND_ATTEMPTS = 8`), `registerNotificationHandlers` — `packages/db/src/notifications.ts`.
- `NotificationRule` (um `eventType`, lista de `emailTypes`, `resolve`, `isStillRelevant(item, nowIso)`) e `NotificationRuleRegistry` — `packages/domain/src/notifications/rules.ts`.
- `EMAIL_TYPE_POLICY` já tem `prazo_t24` e `prazo_t0` (categoria `prazo`, classe `lembrete`, `request_ref`) e os genéricos `acesso_trial` e `acesso_ciclo` (`params: []`) — `policy.ts`. `assertSafeTemplateParams`, `decideQuota`/`QUOTA_CUTS.lembrete`.
- `billing.access_grant` (trial 14 dias por constraint; `ends_at = starts_at + 14 days`; imutável; `status ativa|revogada`), `billing.subscription` (`mode`, `cancel_at_period_end`), `private.commercial_access(prof, at)` com estados `trial_ativo`, `trial_expirado`, `ativa`, `em_carencia`, `cancelada_com_acesso_ate_fim_do_periodo`, `expirada`, `sem_acesso`.
- `app.service_request` (`customer_user_id`, `status in (publicado, selecionado, concluido, cancelado)`, `published_at`, `acceptance_deadline_at = published_at + 168 h` por constraint) e `app.app_user.status in (ativo, bloqueado, em_eliminacao, anonimizado)`.

`[VERIFICADO]` por Grep: nada hoje enfileira jobs de lembrete nem emite eventos de lembrete (`private.job_enqueue` só é chamado pelo pipeline de e-mail e pelo expurgo; `request_publish_commit` e `trial_activate` não agendam nada). O pipeline `ops.email_outbox`, `ops.job` e a leitura de `access_grant` existem e estão versionados.

## 2. Decisões

### 2.1 Perguntas 870 a 889 (adotadas pelo líder, recomendação do PO)

| Nº | Decisão adotada | Onde aparece |
|---|---|---|
| 870 | Jobs pontuais com `run_at` exato, mais varredura de contingência | §2.2 A-1 (com ajuste de quem agenda) |
| 871 | Tolerância de atraso do T-24h: 6 h; depois disso `obsoleto` | §4.2, constante `REMINDER_LATE_TOLERANCE` |
| 872 | T0 do pedido vai só ao cliente dono | §4.1 |
| 873 | T0 com zero aceites: texto genérico, sem número, sugere revisar o pedido; sempre envia | §6 (textos) |
| 874, 875, 876 | `dedupe_key` `req:prazo_t24:<id>`, `req:prazo_t0:<id>`, `trial:t3d:<grant>`, `trial:t0:<grant>`, `ciclo:t3d:<grant>`, `ciclo:t0:<grant>` | §5.3 |
| 877 | Conta suspensa/bloqueada: `destinatario_invalido`, nada enviado | §4.2 |
| 878 | Trial T-3d resolvido no disparo (nada é apagado ao pagar) | §4.2 |
| 879 | Texto do trial T-3d com a frase de gratuidade em destaque | §6 |
| 880 | Ciclo cancelado: variação neutra, sem renovação nem cobrança | §8 (NAO INICIAR) |
| 881 | Ciclo T0: carência de 72 h, acesso mantido | §8 (NAO INICIAR) |
| 882 | Ordem pós-cota por `comparePriority` existente, sem código novo | §4.4 |
| 883 | Tipos explícitos em `policy.ts`: `acesso_trial_t3d`, `acesso_trial_t0` agora; `acesso_ciclo_*` na fatia 7 | §4.5 |
| 884 | Até 8 tentativas com recuo, reavaliando a relevância em cada claim | existente, sem código |
| 885 | Descarte não gera `audit_event`; motivo fica em `notification_item`/`email_outbox` | §7 |
| 886 | Um e-mail por pedido, sem agrupar | §4.1 |
| 887 | Teste estático de ausência de interruptor (decisão 27) | T-H099-31 |
| 888 | Relógio injetado (`FakeClock`, `p_now`), transação com rollback ou limpeza, sem sleep | §9 |
| 889 | Pode seguir ao Desenvolvimento; prazo e trial inteiros agora; ciclo só especificado | §10 |

### 2.2 Decisões do Arquiteto (vetáveis)

- **A-1 (ajuste da 870): quem agenda os jobs pontuais é a varredura, não os pontos de publicação/ativação.** `[DECISÃO ARQ]` O refino previa agendar no ato de publicar (H-031) e de ativar o trial (H-044). Isso exigiria alterar `private.request_publish_commit` e `private.trial_activate`, funções de histórias já concluídas, com testes e auditoria próprios. Em vez disso, o job recorrente `reminder.scan` olha **adiante 15 min** e cria o job `reminder.fire` com `run_at` igual ao instante exato do marco (a pontualidade da 870(a) é mantida: o e-mail sai no minuto do tick) e olha **para trás** a tolerância (contingência para queda do tick). Efeito: zero mudança em H-031, H-044, H-058; sem jobs órfãos (quem cria é quem confere o estado); pedidos já publicados antes do deploy entram sozinhos, sem script de carga. Alternativa descartada: gancho nas duas funções (acopla três histórias e reabre testes).
- **A-2: um evento e uma regra por assunto, não por tipo de e-mail.** `[DECISÃO ARQ]` `NotificationRuleRegistry` aceita um `eventType` por regra. Eventos `reminder.request`, `reminder.trial` e (fatia 7) `reminder.cycle`; o marco vai no payload (`{"marco":"t24"|"t0"|"t3d"}`) e o tipo de e-mail sai do marco. Payload sem PII, só marco.
- **A-3: tolerância de atraso.** `[PROPOSTA]` T-24h, T-3d: 6 h (871). T0 do pedido e T0 do trial: 24 h. Constantes únicas em domínio, ajustáveis sem migração. Fora da tolerância, `obsoleto` (nunca enviar lembrete caduco).
- **A-4: a regra decide duas vezes com a mesma função pura.** Em `resolve` (evita criar item/linha inútil) e em `isStillRelevant` (cobre mudança de estado entre ingestão e envio, e o reenvio após `adiado_cota`). Funções puras recebem uma visão do recurso e `nowIso`; nenhuma lê relógio.
- **A-5: leituras do recurso por funções SQL `security definer` dedicadas**, com colunas mínimas (sem e-mail, sem endereço, sem descrição). O domínio fala com a porta `ReminderSourcePort`; só o pacote `db` conhece SQL.
- **A-6: e-mail de login e demais classes não são tocados.** Lembretes ficam na classe `lembrete` (menor prioridade); nenhuma alteração em cota.
- **A-7: sem interruptor.** Nenhuma chave em `ops.app_config`, nenhuma variável de ambiente, nenhuma flag para ligar/desligar lembrete (decisão 27, RF-122). O limite é a cota existente.

## 3. Contratos

### 3.1 Domínio (`packages/domain/src/notifications/`)

Arquivo novo `reminders.ts` (funções puras e constantes; sem I/O):

```
export const H = 3_600_000;
export const REMINDER_OFFSETS_MS = {            // distância do marco ao instante-âncora
  prazo_t24: 144 * H,   // published_at + 144 h  (= deadline - 24 h)
  prazo_t0: 168 * H,    // published_at + 168 h  (= acceptance_deadline_at)
  trial_t3d: 264 * H,   // starts_at + 264 h     (= ends_at - 72 h)
  trial_t0: 336 * H,    // starts_at + 336 h     (= ends_at)
};
export const REMINDER_LATE_TOLERANCE_MS = { prazo_t24: 6*H, prazo_t0: 24*H, acesso_trial_t3d: 6*H, acesso_trial_t0: 24*H };
export const SCAN_LOOKAHEAD_MS = 15 * 60_000;   export const SCAN_INTERVAL_S = 300;

export type ReminderSubject = 'request' | 'trial';          // 'cycle' entra na fatia 7
export type ReminderMarco = 't24' | 't0' | 't3d';

export interface RequestReminderView {                     // vindo da porta; sem texto livre
  requestId: string; customerUserId: string;
  status: 'publicado'|'selecionado'|'concluido'|'cancelado';
  acceptanceDeadlineAt: string;                            // ISO
  customerStatus: 'ativo'|'bloqueado'|'em_eliminacao'|'anonimizado';
}
export interface TrialReminderView {
  grantId: string; professionalUserId: string;
  grantStatus: 'ativa'|'revogada'; endsAt: string;
  estado: 'trial_ativo'|'trial_expirado'|'ativa'|'em_carencia'|'cancelada_com_acesso_ate_fim_do_periodo'|'expirada'|'sem_acesso';
  userStatus: 'ativo'|'bloqueado'|'em_eliminacao'|'anonimizado';
}
export function decideRequestReminder(marco:'t24'|'t0', v: RequestReminderView, markAt: string, nowIso: string): Verdict;
export function decideTrialReminder(marco:'t3d'|'t0', v: TrialReminderView, markAt: string, nowIso: string): Verdict;
export function markInstant(anchor: string, key: keyof typeof REMINDER_OFFSETS_MS): string;
```

Porta nova em `ports.ts`:

```
export interface ReminderSourcePort {
  requestView(requestId: string, nowIso: string): Promise<RequestReminderView | null>;
  trialView(grantId: string, nowIso: string): Promise<TrialReminderView | null>;
}
```

Regras novas (`reminder-rules.ts`), cada uma implementa `NotificationRule`:
- `PrazoNotificationRule`: `eventType = 'reminder.request'`, `emailTypes = ['prazo_t24','prazo_t0']`. `resolve`: lê o payload (`marco`), consulta `requestView`; `[]` se `null` ou veredito diferente de `valido`; senão um alvo `{recipientUserId: customerUserId, category:'prazo', emailType, mailClass:'lembrete', scopeKey: requestId, templateParams:{request_ref: requestId}, dedupeKey:'req:prazo_t24:'+requestId}` (ou `prazo_t0`). `isStillRelevant(item, now)`: usa `item.scopeKey` como `requestId`, `item.emailType` define o marco, `item.occurredAt` é o instante do marco.
- `TrialNotificationRule`: `eventType = 'reminder.trial'`, `emailTypes = ['acesso_trial_t3d','acesso_trial_t0']`; `templateParams = {}`; `scopeKey = grantId`; `dedupeKey = 'trial:t3d:'+grantId | 'trial:t0:'+grantId`; destinatário é o próprio `professionalUserId`.
- `request_ref` é o `requestId` já usado pelas demais categorias de pedido (H-095); sem nome, sem endereço, sem descrição.

Sem mudança em `rules.ts` nem em `NotificationRuleRegistry`.

### 3.2 Regras de decisão (veredito)

`decideRequestReminder(marco, v, markAt, now)`, na ordem:
1. `v.customerStatus != 'ativo'` -> `destinatario_invalido`.
2. `v.status != 'publicado'` -> `obsoleto`.
3. `now - markAt > tolerância(marco)` -> `obsoleto`.
4. `t24`: `now >= acceptanceDeadlineAt` -> `obsoleto`. `t0`: `now < acceptanceDeadlineAt` -> `obsoleto` (ainda não venceu; o marco só vale a partir do vencimento).
5. senão `valido`.

`decideTrialReminder(marco, v, markAt, now)`, na ordem:
1. `v.userStatus != 'ativo'` -> `destinatario_invalido`.
2. `v.grantStatus = 'revogada'` -> `obsoleto`.
3. `now - markAt > tolerância(marco)` -> `obsoleto`.
4. `t3d`: `v.estado != 'trial_ativo'` -> `obsoleto` (cobre plano pago, `em_carencia`, trial já vencido).
   `t0`: `v.estado != 'trial_expirado'` -> `obsoleto` (se pagou, o estado é `ativa` ou outro).
5. senão `valido`.

Observação `[VERIFICADO]` em `commercial_access`: em `ends_at` exato o estado do trial é `trial_expirado` (o intervalo é `[starts_at, ends_at)`), e trial revogado nem entra no cálculo (`sem_acesso`), então o passo 2 é redundante por segurança e é testado separadamente.

### 3.3 Tipos de e-mail (`policy.ts`)

Acrescentar (aditivo; `prazo_t24` e `prazo_t0` já existem e não mudam):

```
acesso_trial_t3d: { category: 'acesso', mailClass: 'lembrete', params: [] },
acesso_trial_t0:  { category: 'acesso', mailClass: 'lembrete', params: [] },
```

`acesso_trial` e `acesso_ciclo` (genéricos) permanecem até o `[PASSO 0]` da fatia 1: o DEV faz Grep de uso (testes de snapshot da política, templates). Se ninguém usa, mantém sem remover (remoção seria fora de escopo; risco de quebra de snapshot). Os quatro tipos `acesso_ciclo_*` ficam para a fatia 7.

## 4. Dados, jobs e handlers

### 4.1 Mapa dos marcos

| Assunto | Marco | Instante | Destinatário | Tipo | Dedupe key |
|---|---|---|---|---|---|
| Pedido | T-24h | `published_at + 144 h` | `customer_user_id` | `prazo_t24` | `req:prazo_t24:<request_id>` |
| Pedido | T0 | `acceptance_deadline_at` | `customer_user_id` | `prazo_t0` | `req:prazo_t0:<request_id>` |
| Trial | T-3d | `starts_at + 264 h` | `professional_id` | `acesso_trial_t3d` | `trial:t3d:<grant_id>` |
| Trial | T0 | `ends_at` | `professional_id` | `acesso_trial_t0` | `trial:t0:<grant_id>` |
| Ciclo | T-3d / T0 | `ends_at - 72 h` / `ends_at` | `professional_id` | `acesso_ciclo_t3d/t0*` | `ciclo:t3d|t0:<grant_id>` — NAO INICIAR |

Um e-mail por pedido (886); dois pedidos no mesmo horário geram dois e-mails (lembrete não agrupa).

### 4.2 Migração `20261120200000_notifications_create_reminder_scheduling.sql`

Reservada a faixa 20261120200000 a 20261120299999. Esta fatia usa **uma** migração (aditiva e idempotente: `create or replace`, `if not exists`), com rollback em `supabase/rollbacks/20261120200000_notifications_create_reminder_scheduling.down.sql`. Aplicada com `npx supabase` (nunca MCP, nunca Docker).

Conteúdo, tudo em `private`, `security definer`, `set search_path = ''`, relógio injetado (`p_now timestamptz default null` -> `coalesce(p_now, clock_timestamp())`, mesmo padrão de `notification_ingest`):

1. **Índices parciais** (aditivos, para a varredura não percorrer a tabela toda):
   - `app.service_request (acceptance_deadline_at) where status = 'publicado'`
   - `billing.access_grant (ends_at) where type = 'trial' and status = 'ativa'`
2. `private.reminder_scan(p_now timestamptz default null) returns integer`: encontra marcos devidos e chama `private.job_enqueue('reminder.fire', 'reminder:<assunto>:<marco>:<id>', <instante do marco>, '<assunto>|<marco>|<id>', 5)`.
   - Pedido T-24h: `status = 'publicado'` e `acceptance_deadline_at - 24 h` em `[now - 6 h, now + 15 min]`. Pedido T0: `status = 'publicado'` e `acceptance_deadline_at` em `[now - 24 h, now + 15 min]`.
   - Trial T-3d: `type = 'trial' and status = 'ativa'` e `ends_at - 72 h` em `[now - 6 h, now + 15 min]`. Trial T0: `ends_at` em `[now - 24 h, now + 15 min]`.
   - `LIMIT 500` por assunto e marco, ordenado pelo instante do marco; o excedente é pego na varredura seguinte (a janela de tolerância cobre).
   - Devolve a quantidade de jobs criados ou já existentes. Idempotente: repetir não cria nada novo.
3. `private.reminder_emit(p_subject text, p_marco text, p_resource_id uuid, p_mark_at timestamptz, p_now timestamptz default null) returns text`: insere **um** `ops.outbox_event` com `type = 'reminder.request'|'reminder.trial'`, `aggregate_type`, `aggregate_id = p_resource_id`, `occurred_at = p_mark_at`, payload `{"marco": "..."}`. Devolve `'emitido'` ou `'ignorado'` (recurso inexistente). `[PASSO 0]` conferir as colunas e restrições exatas de `ops.outbox_event` e se existe chave natural; se `id` for chave primária, usar `id` determinístico (uuid derivado de `dedupe_key`) com `on conflict do nothing`; se não, a idempotência fica nas camadas seguintes (§5.1) e um evento duplicado é inofensivo (item novo, mas a linha de envio é reaproveitada pelo `dedupe_key`).
4. `private.reminder_request_view(p_request_id uuid)` e `private.reminder_trial_view(p_grant_id uuid, p_now timestamptz)`: leitura mínima das §3.1 (a do trial chama `private.commercial_access(professional_id, p_now)`). Sem e-mail, sem endereço, sem descrição, sem identidade/HMAC de documento.
5. Privilégios: `revoke all ... from public, anon, authenticated, service_role, app_api`; `grant execute ... to app_system` (papel que o tick usa). `[PASSO 0]` confirmar o papel executor do tick em `20261110160000_platform_enable_job_tick.sql` e replicar o padrão de grant das funções de `20261111120000`.

### 4.3 Jobs e handlers (`packages/db/src/reminders.ts`)

- `ReminderScanHandler` (`kind = 'reminder.scan'`): chama `private.reminder_scan(now)` e **rearma** o próximo `reminder.scan` com `dedupe_key = 'reminder.scan:' || <balde de 5 min>` e `run_at` no início do próximo balde. `[PASSO 0]` copiar exatamente o padrão de rearme/recorrência já usado por `retention-jobs.ts`/`ops-purge-jobs.ts`/`tickProbeDedupeKey` (nome da função de armar, onde o primeiro job é semeado no boot). O primeiro `reminder.scan` é semeado pelo mesmo ponto de composição que semeia os demais jobs recorrentes; sem semente, o tick oportunista C também arma.
- `ReminderFireHandler` (`kind = 'reminder.fire'`): lê `payload_ref` (`<assunto>|<marco>|<id>`, formato validado, sem PII; inválido -> erro de código fixo, nunca texto livre), chama `private.reminder_emit`. Falha técnica propaga (o tick reagenda com recuo; `max_attempts = 5`).
- Registro: acrescentado ao ponto de composição que já chama `registerNotificationHandlers` (`[PASSO 0]` localizar por Grep em `apps/api`), via `registerJobHandler(registry, 'reminder.scan' | 'reminder.fire', handler)`. Nenhum job muda de dono.
- O disparo do e-mail em si **não** muda: `reminder.fire` só emite o evento; `outbox.dispatch` e `email.send` já existem.

### 4.4 Cota e degradação

Sem código novo. `processOutbox` já reserva cota por classe (`QUOTA_CUTS.lembrete`: 70/dia UTC e 2100/mês) e, quando bloqueia, reagenda como `adiado_cota`; ao voltar, revalida com `isStillRelevant`. Como a decisão usa `item.occurredAt` (instante do marco) contra a tolerância, um T-24h adiado além de 6 h (ou após o prazo) vira `obsoleto` e **não sai atrasado** (CA-H099-13). Ordem de reavaliação por `comparePriority` já existente (882).

### 4.5 Fatia de ciclo (apenas contrato; NAO INICIAR)

Ver §8.

## 5. Idempotência e concorrência

### 5.1 Cinco camadas (exatamente um e-mail por marco e recurso)

1. `ops.job.dedupe_key = 'reminder:<assunto>:<marco>:<id>'`: varreduras repetidas ou concorrentes não duplicam o job (`on conflict do nothing`).
2. Lease de `ops.job` (`FOR UPDATE SKIP LOCKED`): dois workers não executam o mesmo `reminder.fire`.
3. `ops.notification_item` único por `(source_event_id, recipient_user_id, category, scope_key)`: reprocessar o mesmo evento não duplica item.
4. `ops.email_outbox.dedupe_key` único (`req:prazo_t24:<id>` etc.): evento repetido com `source_event_id` novo cai em `reaproveitado`; uma só linha de envio.
5. `idempotencyKey` do provedor igual ao `dedupe_key`: reenvio após falha de rede não gera segundo e-mail.

### 5.2 Recursos que mudam durante o voo

O job fica mesmo que o pedido seja selecionado ou cancelado, ou o trial vire plano pago (878): a decisão é no disparo (`resolve` e `isStillRelevant`), sem acoplamento do módulo financeiro com a fila (nada é apagado). Mudança de estado depois da ingestão e antes do envio: `processOutbox` descarta (`sem_item_valido`), item `descartado` com `discard_reason`.

### 5.3 Chaves

Prefixos e formatos fixados em §4.1. Comprimento máximo: `trial:t3d:` + UUID (36) = 46, `req:prazo_t24:` + UUID = 50; abaixo dos 200 do banco. `ops.job.kind` casa `^[a-z][a-z0-9_.]{0,99}$` (`reminder.scan`, `reminder.fire`).

## 6. Conteúdo e textos (`[PROPOSTA]`, copy institucional fixa; sem PII)

`[PASSO 0 da fatia 5]` Grep por `templateKey` e pelo adaptador Resend para localizar onde ficam os modelos por `email_type`, e seguir o padrão dos tipos de pedido já existentes (H-095, H-096). Regras de conteúdo, verificadas por teste:

- **Pedido T-24h:** faltam 24 horas para encerrar o recebimento de aceites; convida a abrir o pedido. Sem promessa de aceites (RF-119), sem número de aceites.
- **Pedido T0:** o prazo de aceites encerrou; conversas já abertas continuam; orienta a escolher entre os participantes ou, se não houve interessados, revisar descrição, urgência e fotos para publicar de novo. Mesmo texto com zero ou mais aceites (873); nenhum número.
- **Trial T-3d:** inclui, em destaque, a frase da 879: "Seu teste de 14 dias é 100% gratuito e não possui renovação automática. Ao final do período, você decide se deseja contratar um plano para continuar recebendo novos pedidos." Proibido: "cobrança", "cartão", "débito", "renovação" fora dessa frase, valores.
- **Trial T0:** o teste encerrou; a descoberta de novos pedidos foi pausada; histórico e conversas já abertas permanecem; para voltar, escolher um plano; nada foi cobrado.
- Parâmetros: só `request_ref` (prazo) e nenhum (trial), validados por `assertSafeTemplateParams`. Link só para a área autenticada do site; sem dado de terceiros.
- Textos de cobrança do ciclo ficam fora até BLQ-JUR L2/L3 (§8).

## 7. Segurança, privacidade e operação

- **Sem PII em lugar nenhum novo:** payload do evento = `{marco}`; `payload_ref` do job = ids; funções de leitura não devolvem e-mail, endereço, telefone, nome, descrição nem HMAC de documento; e-mail resolvido só no envio, pelo diretório existente.
- **Anti-enumeração:** não há rota HTTP nova. A superfície é só o tick (já autenticado por segredo, `isTickAuthorized`) e funções `private` sem grant para `anon`/`authenticated`/`service_role`/`app_api`.
- **LGPD:** cliente/profissional `em_eliminacao`, `anonimizado` ou `bloqueado` -> `destinatario_invalido` (A-4); o diretório inexistente/suprimido também já é tratado por `processOutbox`.
- **Sem interruptor (decisão 27):** nenhuma chave em `ops.app_config`/ambiente; teste estático (T-H099-31).
- **Sem envio real nos testes:** `FakeEmailProvider`/mock da porta; nenhum teste chama o Resend; nenhum teste consome a cota real; sem Docker e sem Mapbox.
- **Auditoria:** descarte não gera `audit_event` (885); o motivo fica em `notification_item.discard_reason` e `email_outbox.reason_code`.
- **Observabilidade:** `ReminderScanHandler` devolve/loga só contagens (varridos, enfileirados) e código de erro, nunca ids de usuário nem texto.
- **Rollback:** `.down.sql` remove as funções e os dois índices; o job recorrente deixa de ser rearmado ao remover o handler (job pendente sem handler falha com código fixo, sem efeito colateral).

## 8. Parte (b) — Ciclo pago: NAO INICIAR

Dependências **não concluídas** `[VERIFICADO no refino/quadro: Backlog]`: #60 (H-047, checkout), #61 (H-048, webhook), #62 (H-049, concessão paga), #63 (H-050, carência) e `BLQ-JUR L2`/`L3` (redação de cobrança/renovação). Enquanto não forem concluídas, **nenhuma linha de código, tipo de política, texto ou migração do ciclo entra em `feature/init`**. O DEV não deve criar fixtures de `paid` para "adiantar": o contrato abaixo existe só para o desenho não precisar ser refeito.

Contrato reservado (a ser reconfirmado quando as dependências fecharem):
- Migração reservada `20261120210000_notifications_expand_reminders_cycle.sql` (acrescenta marcos de ciclo a `private.reminder_scan`/`reminder_emit` e `private.reminder_cycle_view`; aditiva).
- Marcos: T-3d em `ends_at - 72 h`, T0 em `ends_at`, por `grant_id` de concessão `paid` e `status = 'ativa'`; `dedupe_key = 'ciclo:t3d:'|'ciclo:t0:' || grant_id`.
- Regra `CicloNotificationRule` (`eventType = 'reminder.cycle'`), variantes por tipo de e-mail (porque `params` é vazio): `acesso_ciclo_t3d_cartao` (renovação automática), `acesso_ciclo_t3d_manual` (pagar Pix a tempo), `acesso_ciclo_t3d_cancelada` (acesso até a data, sem renovação nem cobrança, 880), `acesso_ciclo_t0_carencia` (72 h de carência com acesso, 881), `acesso_ciclo_t0_encerrado` (cancelada: acesso encerrado, sem cobrança).
- Veredito: T-3d válido com `estado in ('ativa','cancelada_com_acesso_ate_fim_do_periodo')` e **sem concessão paga posterior** (renovação -> `obsoleto`); T0 válido com `em_carencia` (ou `expirada` se cancelada); `userStatus != 'ativo'` -> `destinatario_invalido`.
- Texto de cobrança/renovação roda como `[PROPOSTA]` até L2/L3; nenhuma cobrança nem valor no e-mail.
- Provas E2E com pagamento real do Mercado Pago só após #60 a #63.

## 9. Matriz de testes (T-H099-*)

Convenções: relógio injetado (`FakeClock` no domínio; `p_now` no banco); testes de banco no DEV (`db:test`) criam dados sintéticos e limpam ao fim (transação com rollback quando possível); provedor simulado; nenhum teste dorme.

| Id | Camada | Cenário | Esperado | CA |
|---|---|---|---|---|
| T-H099-01 | domínio | `markInstant` para os 4 marcos (anchor + 144/168/264/336 h) | instantes exatos; `prazo_t24 = deadline - 24 h`, `trial_t3d = ends_at - 72 h` | 01,02,05,06 |
| T-H099-02 | domínio | Pedido `publicado`, agora = T-24h + 1 min, antes do prazo | `valido` | 01 |
| T-H099-03 | domínio | Pedido `selecionado` / `cancelado` / `concluido` em T-24h e em T0 | `obsoleto` (6 casos) | 03,04 |
| T-H099-04 | domínio | T-24h com agora >= prazo; T-24h com atraso de 6 h + 1 ms; atraso de 6 h exatas | `obsoleto`; `obsoleto`; `valido` (limite inclusivo definido e fixado em teste) | 13 |
| T-H099-05 | domínio | T0 com agora < prazo; T0 com atraso 24 h + 1 ms; T0 no prazo exato | `obsoleto`; `obsoleto`; `valido` | 02 |
| T-H099-06 | domínio | Cliente `em_eliminacao`/`anonimizado`/`bloqueado` em qualquer marco | `destinatario_invalido` (precede os demais) | 03 |
| T-H099-07 | domínio | Trial T-3d com `estado = trial_ativo` | `valido` | 05 |
| T-H099-08 | domínio | Trial T-3d com `estado = ativa` / `em_carencia` / `trial_expirado` / `sem_acesso` | `obsoleto` | 07 |
| T-H099-09 | domínio | Trial T0 com `estado = trial_expirado` | `valido`; com `ativa` -> `obsoleto` | 06,07 |
| T-H099-10 | domínio | Trial `grantStatus = revogada` (qualquer marco) | `obsoleto` | 08 |
| T-H099-11 | domínio | Profissional `bloqueado`/`em_eliminacao` (trial) | `destinatario_invalido` | 08 |
| T-H099-12 | domínio | Registro: `PrazoNotificationRule`, `TrialNotificationRule` registram sem `evento_duplicado`/`tipo_duplicado`; `forEmailType` devolve a regra certa para os 4 tipos | ok | 12 |
| T-H099-13 | domínio | `resolve` devolve alvo com `category`, `mailClass='lembrete'`, `dedupeKey` conforme §4.1, `templateParams` só `request_ref` (prazo) ou `{}` (trial) | exato | 01,02,05,06 |
| T-H099-14 | domínio | `resolve` devolve `[]` para recurso nulo ou veredito não-válido | `[]` | 03,07 |
| T-H099-15 | domínio | `assertSafeTemplateParams` recusa telefone, texto livre, e-mail, endereço nos 4 tipos | `ContentGuardError` | 14 |
| T-H099-16 | domínio | `policyFor` dos 4 tipos: categoria `prazo`/`acesso`, classe `lembrete` | exato | 12 |
| T-H099-17 | banco | `reminder_scan(p_now)` com pedido em T-24h dentro da janela | 1 job `reminder.fire`, `run_at` = marco exato | 01 |
| T-H099-18 | banco | Janelas: fora (antes de -15 min) não enfileira; dentro da tolerância passada (atraso 5 h) enfileira; atraso > tolerância não enfileira | conforme | 13 |
| T-H099-19 | banco | `reminder_scan` duas vezes e concorrente (duas conexões) | exatamente 1 job por recurso e marco | 12 |
| T-H099-20 | banco | Pedido `selecionado`/`cancelado` não aparece na varredura (status != publicado) | 0 jobs | 03,04 |
| T-H099-21 | banco | Trial: marcos T-3d e T0 achados por `ends_at`; trial revogado fora da varredura | 1 job cada; 0 para revogado | 05,06,08 |
| T-H099-22 | banco | `reminder_emit` grava 1 evento com payload só `{marco}` e `occurred_at` = marco; recurso inexistente -> `ignorado` | exato; sem PII | 14 |
| T-H099-23 | banco | `reminder_request_view`/`reminder_trial_view`: só as colunas do contrato; `commercial_access` coerente | snapshot de chaves | 14 |
| T-H099-24 | banco | Privilégios: `anon`, `authenticated`, `service_role`, `app_api` não executam as funções novas | recusado | segurança |
| T-H099-25 | integração | Fluxo: scan -> fire -> dispatch -> processOutbox com relógio em 6 d (pedido) | linha `enviado` via `FakeEmailProvider`; `dedupe_key` `req:prazo_t24:<id>`; 1 envio | 01 |
| T-H099-26 | integração | Idem a 7 d (T0) e trial a 11 d e 14 d | 1 envio cada, tipos e classes corretos | 02,05,06 |
| T-H099-27 | integração | Pedido selecionado entre `fire` e `email.send` | item `descartado/obsoleto`, linha `descartado/sem_item_valido`, 0 envios | 03 |
| T-H099-28 | integração | Trial que virou pago no 8º dia: T-3d chega | `obsoleto`, 0 envios | 07 |
| T-H099-29 | integração | Duplo disparo do mesmo marco (reexecutar `fire`/`dispatch`) | 1 linha em `email_outbox`, 1 envio | 12 |
| T-H099-30 | integração | Cota do dia em 70 (classe `lembrete`) e T-24h chega: `adiado_cota`; no dia seguinte com pedido já vencido | adiado; depois `obsoleto`, 0 envios | 13 |
| T-H099-31 | estático | Varredura estática: nenhum arquivo novo nem `app_config` com chave/flag de ativar/desativar lembrete | 0 ocorrências | 15 |
| T-H099-32 | conteúdo | Textos do trial não contêm "cobrança"/"cartão"/"débito" fora da frase da 879; textos de prazo não prometem aceites; sem número de aceites | verde | 05,06,13 |
| T-H099-33 | infra | `corepack pnpm check:all` sem Docker, sem rede, sem Mapbox | código de saída 0 | 15 |
| T-H099-34 | handler | `ReminderFireHandler`: `payload_ref` malformado -> erro de código fixo; rearme do `reminder.scan` idempotente por balde | exato | 12 |

Fora da suíte (NAO INICIAR, fatia 7): variantes de ciclo, testes com `paid`, integração com Mercado Pago.

## 10. Plano de implementação em fatias (Desenvolvimento)

Todas em `feature/init`; cada fatia termina com testes locais verdes e commit; sem Docker, sem Mapbox, sem envio real, sem backup.

### (a) O que pode ser feito e testado já (dependências concluídas: #21, #44, #57, #58, #102, #103, #104)

| Fatia | Conteúdo | Arquivos | Testes | Migração |
|---|---|---|---|---|
| 1. Política e decisores | `policy.ts` + 2 tipos; `reminders.ts` (constantes, `markInstant`, `decideRequestReminder`, `decideTrialReminder`); `[PASSO 0]` Grep de uso de `acesso_trial`/`acesso_ciclo` | `packages/domain/src/notifications/policy.ts`, `reminders.ts` e testes | T-H099-01 a 11, 16 | não |
| 2. Porta e regras | `ReminderSourcePort`; `PrazoNotificationRule`, `TrialNotificationRule`; registro sem duplicidade; guarda de parâmetros | `ports.ts`, `reminder-rules.ts`, `index.ts` e testes | T-H099-12 a 15 | não |
| 3. Banco | Migração de índices e funções (`reminder_scan`, `reminder_emit`, views); `.down.sql`; `[PASSO 0]` colunas de `ops.outbox_event`, papel executor, padrão de grant; testes com `p_now` e limpeza | `supabase/migrations/20261120200000_notifications_create_reminder_scheduling.sql`, rollback, testes `packages/db` | T-H099-17 a 24 | **sim: 20261120200000** |
| 4. Adaptador e handlers | `PgReminderSource` (usa as views); `ReminderScanHandler` (rearme por balde); `ReminderFireHandler`; registro junto de `registerNotificationHandlers`; semente do primeiro `reminder.scan` pelo mesmo padrão dos jobs recorrentes | `packages/db/src/reminders.ts` e testes; composição em `apps/api` (`[PASSO 0]`) | T-H099-34 e base de 25 a 26 | não |
| 5. Textos | Modelos dos 4 e-mails no padrão dos tipos de pedido; teste de conteúdo; teste estático de interruptor | local dos modelos `[PASSO 0]`, testes | T-H099-31, 32 | não |
| 6. Integração no DEV e fechamento | Fluxo ponta a ponta com `FakeEmailProvider` e relógio injetado (pedido e trial); concorrência; cota; limpeza dos dados sintéticos; `check:all` completo; registro das contagens na Issue | testes `packages/db`/`apps/api` | T-H099-25 a 30, 33 | não |

Ordem: 1 -> 2 -> 3 -> 4 -> 5 -> 6 (a 5 pode andar em paralelo com a 3 e a 4, pois só toca modelos e testes; não compartilha arquivo com elas).

### (b) Depende de Issues não concluídas

| Fatia | Conteúdo | Condição | Estado |
|---|---|---|---|
| 7. Ciclo pago | Tipos `acesso_ciclo_*`, `CicloNotificationRule`, migração `20261120210000_notifications_expand_reminders_cycle.sql`, variantes, textos de cobrança | #60, #61, #62, #63 concluídas **e** BLQ-JUR L2/L3 resolvidos | **NAO INICIAR** |

Definição de pronto da Issue (parte a): `corepack pnpm check:all` com código de saída 0, contagens registradas na Issue, T-H099-01 a 34 verdes (exceto os de ciclo), um relatório de dados sintéticos criados e removidos no DEV, e nota explícita na Issue de que o ciclo ficou especificado e não implementado. O cartão pode ir a Aguardando aprovação como entrega parcial declarada; a conclusão completa depende da fatia 7. `[DECISÃO ARQ]` recomendação ao líder: abrir Issue irmã para a fatia 7 (ou manter #109 em aprovação com pendência registrada), decisão do líder.

## 11. Riscos

| Id | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Tick parado (pg_cron inativo) atrasa os lembretes | marco perdido | Tick oportunista C e janela de tolerância; passado o limite vira `obsoleto`, nunca sai caduco |
| R-02 | Colunas/constraints de `ops.outbox_event` diferentes do suposto | `reminder_emit` ajustar | `[PASSO 0]` da fatia 3; idempotência não depende do evento (camadas 1, 4, 5) |
| R-03 | Varredura lenta com muitos recursos | tick estoura 20 s | índices parciais, `LIMIT 500`, janela estreita, só contagem no log |
| R-04 | Tolerância por tipo desagradável ao negócio | lembrete descartado cedo | constantes únicas em domínio; ajuste sem migração; vetável (A-3) |
| R-05 | Acúmulo de lembretes no 1º dia após deploy (pedidos antigos) | pico de cota | janela de passado = tolerância (6 h/24 h), `NOTIFICATION_EFFECTIVE_FROM_MS` e cota 70/dia da classe `lembrete`; excedente expira como `obsoleto` |
| R-06 | Evento duplicado por reexecução parcial | item duplicado | linha de envio única por `dedupe_key`; item duplicado sem e-mail é inofensivo |
| R-07 | Texto do trial interpretado como cobrança | risco jurídico/consumidor | frase fixa da 879; teste de conteúdo T-H099-32; só `[PROPOSTA]` no ciclo até L2/L3 |
| R-08 | Remoção ou uso dos tipos genéricos `acesso_trial`/`acesso_ciclo` quebra snapshot de política | testes vermelhos | manter os genéricos; `[PASSO 0]` Grep antes de qualquer remoção |
| R-09 | Fatia 7 iniciada por engano com dados sintéticos | trabalho jogado fora e texto de cobrança sem revisão jurídica | marcação NAO INICIAR; Orquestrador não move cartão do ciclo; revisor verifica ausência de `acesso_ciclo_*` em `policy.ts` |
| R-10 | Recipient de prazo é `customer_user_id` e o diretório não achar e-mail | linha `descartado/destinatario_invalido` | comportamento existente de `processOutbox`; coberto em T-H099-25 |

## 12. Dúvidas que exigem o dono

Nenhuma. As perguntas 870 a 889 já foram adotadas pelo líder. Pendências jurídicas (BLQ-JUR L2/L3) afetam só a fatia 7 e não bloqueiam a parte (a).

## 13. Entrega ao Orquestrador (HANDOFF)

- Próxima etapa: Desenvolvimento (WF-03), fatia 1 em `feature/init`, depois 2 a 6. Fatia 7 NAO INICIAR.
- Para registro em `11-DECISOES.md` pelo líder: 870 a 889 como "adotada pelo líder"; A-1 a A-7 como decisões técnicas do Arquiteto (A-1 ajusta a 870: agendamento pela varredura, sem alterar H-031/H-044/H-058).
- Migração a aplicar com `npx supabase`: `20261120200000_notifications_create_reminder_scheduling.sql` (e `.down.sql`). Reservada, não criar agora: `20261120210000` (ciclo).
- Nenhuma alteração de quadro, `11-DECISOES.md`, banco, migração ou código nesta etapa.
