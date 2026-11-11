# Desenho H-092 — Pipeline de notificações e cooldown (Issue #102, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§12).
- **Rastro:** 34-REFINO-H092 (CA-H092-01..22, D-H092-1..7 já decididas pelo Orquestrador); 08 §7.6 e §12; 09 §3.11; 10 ADR-011 e ADR-022; 11 §3 (eventos), N-02, N-03, N-08..N-10, Q-10, Q-11, C-13; spikes/S-11-RESULTADO; 24-DESENHO-H008 (tick, lease, handlers); 33-DESENHO-H016 (classe `auth`); `supabase/migrations/20261110130000_*` (`ops.outbox_event`, `ops.job`, `private.job_*`, `ops.app_config`).
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, e-mail ou configuração foi criado ou alterado.
- **Etiquetas:** `[DECIDIDO]` decisões D-H092-1..7 do Orquestrador · `[VERIFICADO]` lido no repositório nesta sessão · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem fonte nem teste.

## 0. Fatos do repositório que moldam o desenho [VERIFICADO]

1. Existem `ops.outbox_event`, `ops.job` (lease, `job_enqueue/claim/complete/fail`), `ops.app_config` (sem valores semeados) e o `TickService` com `JobRegistry` (handlers por `kind`). Cada história registra seu handler.
2. **Não existem** `notification_item`, `notification_cooldown`, `email_outbox`, `external_quota`, `app.app_user`, pedidos nem conversas. A tabela de saída de e-mail do modelo (09 §3.11) é criada por esta história, em `ops` (§3).
3. **Nenhum produtor de evento existe** (só a tabela). Também **não existe o despachante** do outbox (quem lê `dispatched_at is null` e entrega aos consumidores): nenhuma história do backlog o possui. Esta história o inclui, em versão mínima (§5.1). Ver dúvida D-1.
4. Consequência: o pipeline é um **motor genérico** com regras por categoria (`NotificationRule`) registradas por H-095, H-096, H-098 e H-099. H-092 entrega o motor, as tabelas, os jobs e a política; as regras de destinatário e de validade que dependem de pedidos e conversas entram com cada categoria, pela porta `NotificationRule` (§4).

## 1. Decisões de desenho

| # | Decisão | Motivo |
|---|---|---|
| DD-1 | Cooldown, cota e fila são **funções SQL `private.*` atômicas** (linha de cooldown e linhas de cota travadas com `FOR UPDATE`); a lógica pura (política, regras de cota, guarda de conteúdo, ordem de prioridade) fica em **TypeScript puro** em `packages/domain`, testável sem banco. | Segue o padrão de H-005/H-008. Concorrência (C-13) só é garantida no banco. |
| DD-2 | **Item não carrega endereço de e-mail nem texto.** Só IDs, enums e contagens. O endereço é resolvido no envio por `RecipientDirectoryPort`. | CA-14; 09 §7 (C3). |
| DD-3 | **Revalidação em dois pontos:** no *flush* (item → e-mail) e **de novo imediatamente antes de chamar o provedor** (para classes ≠ `auth`). "Lido" e "obsoleto" são sempre decididos lendo o estado do domínio por `NotificationRule.isStillRelevant`, não por marca no item. | CA-07..11, CA-13. Uma só regra cobre item pendente, linha adiada por cota e retentativa. |
| DD-4 | O tempo é o relógio do banco (`clock_timestamp()`), com parâmetro opcional `p_now` nas funções para os testes. | Testes determinísticos nas viradas de dia UTC e de janela. |
| DD-5 | Cota é **reservada antes de enviar** e devolvida se o provedor não aceitou. | Dois envios concorrentes não passam de 100 (§7). |
| DD-6 | Todas as tabelas novas: RLS habilitada e forçada, sem políticas, privilégios só para `app_system` (mesma postura de H-005). Sem FK para `app.app_user` (não existe); a FK entra na migração dele. | Consistência; evita dependência circular. |
| DD-7 | Nenhum interruptor, flag ou rota de reenvio. A regra "sem backfill" (CA-12) vem do despachante: evento sem regra registrada é marcado como despachado sem efeito (§5.1). | Decisão 27; H-100. |

## 2. Política por categoria [PROPOSTA, sobre 08 §12.1 e 04 RF-115..119]

A **classe** é declarada pela regra por `email_type` (não só pela categoria: lembrete de trial/ciclo é categoria `acesso`, classe `lembrete`). Combinação não listada é recusada (falha fechada).

| Categoria | Classe | Cooldown | Escopo | Janela | Validade (relida no flush e no envio) |
|---|---|---|---|---|---|
| `aceite` | `digest` | sim | pedido | `accept.window` (900 s) | pedido ainda aberto (nem selecionado, cancelado ou concluído) **e** cliente não abriu o pedido depois de `occurred_at` do evento [DECIDIDO 2] |
| `mensagem` | `digest` | sim | conversa | `messages.window` (900 s) | destinatário ainda tem mensagem **humana** não lida na conversa (a automática de aceite nunca gera item) |
| `selecao`, `cancelamento`, `desistencia`, `verificacao` | `critico` | não | pedido (ou usuário) | — | sempre válido (o fato já ocorreu); só `destinatario_invalido` descarta |
| `prazo` (T-24h, T0) | `lembrete` | não | pedido | — | pedido ainda aberto e sem seleção no instante do disparo (CA-11) |
| `acesso` (login, conta) | `auth` | não | usuário | — | sempre válido; envio direto na requisição (H-097), fila como contingência |
| `acesso` (trial, ciclo) | `lembrete` | não | usuário | — | acesso ainda no estado que motivou o lembrete (regra de H-099) |
| `outro` | recusado | — | — | — | — |

- Janelas: chaves de `ops.app_config` (`notification.accept.window_seconds`, `notification.messages.window_seconds`), faixa aceita 60–3600 s, padrão 900 s no código quando ausente. Independentes por categoria (CA-05).
- **Cooldown só vale para `digest`.** Fatos críticos e lembretes nunca são agrupados nem atrasados por janela (RF-118).
- **Destinatários de seleção e cancelamento** [DECIDIDO 5]: a regra devolve só os pertinentes; concorrentes não recebem e-mail de seleção. O desenho reforça isso no conteúdo: o `template_params` de `selecao` e `cancelamento` tem allowlist sem qualquer referência ao profissional selecionado (§6).
- **Conteúdo** [DECIDIDO 4 e 6]: `aceite` e `mensagem` levam aviso genérico, sem nome de profissional, sem trecho de mensagem, com `count` opcional e convite para entrar no FastPro.

## 3. Modelo de dados [PROPOSTA]

Migração sugerida `supabase/migrations/20261111120000_notifications_create_pipeline.sql` com par `supabase/rollbacks/…down.sql`. Esquema `ops`. Idempotente (`if not exists`).

### 3.1 `ops.notification_item`
`id uuid pk`, `recipient_user_id uuid not null`, `category text` (check na lista de 09), `scope_key text not null` (uuid do pedido/conversa como texto, ≤ 80), `source_event_id uuid not null`, `occurred_at timestamptz not null` (do evento; base de "lido depois do aceite"), `email_type text not null`, `class text` {`auth|critico|digest|lembrete`}, `state text` {`pendente|enviado|descartado`}, `outbox_id uuid null`, `discard_reason text null` {`lido|obsoleto|destinatario_invalido|expirado`}, `created_at`, `decided_at`.
- **Único** `(source_event_id, recipient_user_id, category, scope_key)` → reentrega do evento não cria segundo item (CA-01).
- Check: `(state='descartado') = (discard_reason is not null)` e `(state='enviado') = (outbox_id is not null)`.
- Índice parcial `(recipient_user_id, category, scope_key) where state='pendente'`.
- `enviado` significa **coberto por uma linha do `email_outbox`**; a entrega real é do `email_outbox.state`.

### 3.2 `ops.notification_cooldown` (09 §3.11)
PK `(recipient_user_id, category, scope_key)`, `cooldown_until timestamptz not null`, `flush_job_id uuid null` (informativo; a unicidade do flush vem do `dedupe_key` do job).

### 3.3 `ops.email_outbox` (09 §3.11, com ajustes)
`id uuid pk`, `recipient_user_id uuid not null` (referência a `app_user`, nunca endereço), `category`, `class`, `email_type text`, `template text`, `template_params jsonb` (allowlist da §6), `dedupe_key text not null unique (≤ 200)`, `provider text null` (preenchido no envio), `state text` {`pendente|enviando|enviado|falha|suprimido|adiado_cota|descartado`}, `attempts int`, `schedule_seq int`, `next_attempt_at`, `lease_until`, `quota_reserved bool default false`, `provider_message_id text null`, `bounce_state text null`, `reason_code text null` (≤ 60, só código), `created_at`, `sent_at`.
- **Ajuste a 09:** estado novo `descartado` (linha cujos itens ficaram obsoletos ou lidos; distinto de `suprimido`, que é bounce/complaint/endereço bloqueado). `reason_code` e `schedule_seq` são novos.
- Check de lease: `(state='enviando') = (lease_until is not null)`.
- Índices: `(state, next_attempt_at) where state in ('pendente','adiado_cota','enviando')`; `(recipient_user_id, created_at)`.
- `email_suppression` continua com H-093 (webhook). H-092 só consome a porta (`suprimido`).

### 3.4 `ops.external_quota` (09 §3.11, linhas de e-mail)
`(service, period, period_start)` único, `used`, `soft_limit`, `hard_limit`, `reserved_auth`, `breaker_state`, `alerted_at`, `alert_level smallint`. Linhas do serviço `email`: `dia_utc` (100 / soft 90 / reserva 10) e `mes` (3000 / soft 2700 / reserva 300), criadas sob demanda pela função de reserva. `used` conta **por destinatário** (nunca usar CC/BCC: 1 e-mail = 1 destinatário = 1).

### 3.5 Gatilho de despacho [PROPOSTA]
`AFTER INSERT` em `ops.outbox_event` chamando `private.job_enqueue('outbox.dispatch', 'outbox.dispatch:'||<minuto UTC>, now())`. Assim o despachante roda no tick seguinte sem agendador recorrente (não existe um). Estados presos são recuperados quando chegar o próximo evento (ver R-4).

## 4. Portas e fronteira domínio × provedor

### 4.1 Do domínio (`packages/domain/src/notifications/`, TypeScript puro)
- `policy.ts`: tabela da §2; `classFor(emailType)`, `windowFor(category, config)`; recusa combinações inválidas.
- `quota.ts`: `decideQuota(class, usedDay, usedMonth, limits) → {allow, blockedBy:'dia'|'mes'|null, alertLevel}` e a tabela de degraus (§7). Função pura e determinística.
- `content-guard.ts`: `assertSafeTemplateParams(emailType, params)` com allowlist por tipo (§6).
- `priority.ts`: ordem `auth(0) < critico(1) < digest(2) < lembrete(3)`, desempate por `created_at`.
- `rules.ts`: contrato `NotificationRule` e `NotificationRuleRegistry` (um registro por `eventType`; duplicidade falha no boot).
- `ports.ts`: `EmailProviderPort`, `RecipientDirectoryPort`, `ClockPort`, `ConfigPort` (janelas).

```
interface NotificationRule {
  eventType: string;
  resolve(event: OutboxEventView): Promise<Array<{
    recipientUserId: string; category: Category; emailType: string; class: MailClass;
    scopeKey: string; dedupeSuffix?: string; templateParams: Record<string,unknown>;
  }>>;                                   // lista vazia = sem aviso (ex.: mensagem automática)
  isStillRelevant(item: ItemView, nowIso: string): Promise<'valido'|'lido'|'obsoleto'|'destinatario_invalido'>;
}
interface EmailProviderPort {
  send(m: { to: string; templateKey: string; params: Record<string,unknown>;
            idempotencyKey: string; }): Promise<SendResult>;
}
type SendResult =
  | { kind:'aceito'; providerMessageId: string }
  | { kind:'recusa_permanente'; code: string }            // endereço inválido, 403 validation_error por destinatário
  | { kind:'limite_taxa'; retryAfterSeconds: number }     // 429
  | { kind:'indisponivel'; code: string }                 // 5xx, timeout
  | { kind:'nao_configurado'; code: 'dominio_nao_verificado'|'segredo_ausente' }; // N-10
interface RecipientDirectoryPort {
  resolve(userId: string): Promise<{status:'ok'; email: string} | {status:'suprimido'|'inexistente'}>;
}
```
`EmailProviderPort`: só a **interface e os tipos** nascem em H-092 (o backlog diz que H-093 depende de H-092). A implementação (Resend, Mailpit/local, mapeamento de HTTP) é de H-093.

### 4.2 Do provedor (fora de H-092)
Transporte HTTP, cabeçalhos e mapeamento de resposta para `SendResult`; cabeçalho de idempotência (se existir, **[NÃO VERIFICADO]** no doc 13 e em S-11); recusa sem domínio (403 `validation_error`, contrato em S-11 §4); segredo; webhook de bounce/complaint e `email_suppression` (H-093); adaptador local de teste/Mailpit [DECIDIDO 7: H-093]; renderização dos textos finais (H-095..H-099).

### 4.3 Entregue em H-092 fora do domínio puro
Migração e funções SQL; `packages/db/src/notifications.ts` (adaptadores Pg das portas de armazenamento e os handlers `outbox.dispatch`, `notification.flush`, `email.send`); dublês em `packages/testkit` (`FakeEmailProvider` com respostas roteirizadas e captura em memória, `FakeRecipientDirectory`, `FakeClock`, `StubRule`). **Nenhum adaptador de arquivo, Mailpit ou rede.**

## 5. Fluxo evento → item → fila de e-mail

### 5.1 Despacho (`outbox.dispatch`)
1. Handler lê até 50 eventos `dispatched_at is null` por `(occurred_at, id)` (leitura; o lease do job evita corrida; a idempotência de item protege se houver duas).
2. Para cada evento: sem regra registrada → só marca `dispatched_at` (DD-7). Com regra: `rule.resolve(event)` (leitura do domínio, **fora** de transação) e, **numa transação**, `private.notification_ingest(...)` para cada destinatário e `update ops.outbox_event set dispatched_at=now() where id=$1 and dispatched_at is null`.
3. Falha em um evento: registra código (sem PII), segue para o próximo; o evento tenta de novo na próxima execução.
4. O consumidor é **independente de ordem**: validade é relida do domínio. Por isso H-092 não usa `aggregate_seq`.

### 5.2 `private.notification_ingest` (transação curta)
Entrada: destinatário, categoria, escopo, `email_type`, classe, `source_event_id`, `occurred_at`, `dedupe_key` base, `template_params`, `window_seconds`, `p_now`.
1. `insert into notification_item … on conflict (unique) do nothing`. Sem inserção ⇒ devolve `duplicado` (CA-01).
2. Classe ≠ `digest`: cria a linha em `email_outbox` com `dedupe_key = 'nc:'||source_event_id||':'||recipient||':'||category||':'||scope` (para `prazo`, `dedupe_suffix` da regra, ex.: `prazo:{request}:T-24h`, CA-11/RN de lembrete), marca o item `enviado`, enfileira `email.send` e devolve `enfileirado`. Sem cooldown.
3. Classe `digest`: `insert into notification_cooldown … on conflict do nothing`, depois `select … for update` na linha (serializa chegadas simultâneas, CA-03/04).
   - **Envio imediato** quando `cooldown_until <= now` **e** não existe outro item `pendente` na mesma chave: cria a linha de `email_outbox` (`dedupe_key = 'n1:'||item.id`), item `enviado`, `cooldown_until = now + janela`, enfileira `email.send`.
   - **Caso contrário** o item fica `pendente` e garante-se **um** job `notification.flush` com `dedupe_key = 'nflush:'||recipient||':'||category||':'||scope||':'||epoch(run_at)`, `run_at = greatest(cooldown_until, now)`. No máximo um envio agendado por janela (CA-04). `payload_ref` = referência da chave (nunca endereço).
4. Ordem de bloqueio única (cooldown → job) evita deadlock. A condição "sem item pendente" fecha a corrida de fronteira em que o flush está vencendo e chega um evento novo.

### 5.3 `notification.flush` (três passos)
1. **Começo** (`private.notification_flush_begin(key)`, transação curta): trava a linha de cooldown. Se `cooldown_until > now` (alguém enviou nesse meio tempo) reagenda a si mesmo para `cooldown_until` (novo `dedupe_key` por epoch) e termina sem enviar. Senão devolve os ids dos itens `pendente`.
2. **Avaliação, fora de transação:** para cada item, `rule.isStillRelevant` → `valido|lido|obsoleto|destinatario_invalido`.
3. **Fechamento** (`private.notification_flush_commit(key, keep_ids[], drop[{id,reason}])`, uma transação, trava o cooldown de novo): só age em itens ainda `pendente` (segunda execução não encontra nada). Descartados recebem `descartado` + motivo. Se sobrou ≥ 1 válido: **uma** linha de `email_outbox` (`dedupe_key = 'nd:'||key||':'||epoch(cooldown_until lido no início)`, `unique` ⇒ CA-06), itens `enviado`, **`cooldown_until = now + janela`** [DECIDIDO 1], `count = n` em `template_params`, enfileira `email.send`. Se não sobrou nenhum: **nenhum e-mail e cooldown inalterado** (CA-09). Se restarem itens `pendente` chegados depois do passo 1: reagenda novo flush no fim da janela.

### 5.4 `email.send` / `processOutboxRow(id)` (função única; usada pelo job e, em H-097, direto na requisição)
1. **Reivindica** com um `update … set state='enviando', lease_until=now+60 s where id=$1 and (state in ('pendente','adiado_cota') and next_attempt_at<=now or (state='enviando' and lease_until<now)) returning *`. Dois executores nunca enviam a mesma linha (C-13).
2. Classe ≠ `auth`: **revalida** os itens ligados; todos `lido/obsoleto/destinatario_invalido` ⇒ `descartado` (CA-07..11, CA-13); parcialmente válidos ⇒ segue com a contagem ajustada.
3. `RecipientDirectoryPort.resolve`: `suprimido` ⇒ `suprimido`; `inexistente` ⇒ `descartado` (`destinatario_invalido`).
4. **Cota** (§7): `private.email_quota_reserve(class)` (pula se `quota_reserved`). Negado ⇒ `adiado_cota`, `next_attempt_at` = início do próximo dia UTC (ou do próximo mês, se o mês bloqueou), reagenda job; **não é falha** e não consome tentativa.
5. **Ritmo:** pausa mínima de 200 ms entre envios dentro do lote do job (≤ 5/s, CA-22) e lote de até 20 linhas por execução.
6. `provider.send(…)` com `idempotencyKey = dedupe_key`:
   - `aceito` ⇒ `enviado`, `provider_message_id`, `sent_at`.
   - `limite_taxa` ⇒ devolve a cota, volta a `pendente`, `next_attempt_at = now + max(retryAfter, recuo)`, **interrompe o lote**.
   - `indisponivel` ⇒ devolve a cota, `attempts+1`, recuo `60·2^(n−1)` s até 1 h; após 8 tentativas ⇒ `falha` (dead letter com métrica).
   - `recusa_permanente` ⇒ devolve a cota, `falha`.
   - `nao_configurado` (N-10) ⇒ devolve a cota, `pendente` com `next_attempt_at = now + 1 h`, **sem** gastar tentativa, métrica; nada se perde.
7. Linha com `lease_until` vencido é retomada; se `quota_reserved=true` não reserva de novo (contagem conservadora, nunca abaixo do real).

## 6. Conteúdo: o que um e-mail pode carregar (CA-14..16)

`template_params` aceita só chaves de uma allowlist por `email_type`; valores só `uuid`, inteiro, booleano ou enum fixo. `assertSafeTemplateParams` falha em chave desconhecida, string livre, valor com `@` ou sequência de ≥ 8 dígitos, e em qualquer chave de endereço, telefone, mensagem, anexo, nome, `token`, `url`, `link`. Allowlists iniciais:

| `email_type` | Chaves permitidas |
|---|---|
| `aceite_aviso`, `aceite_resumo` | `request_ref`, `count` |
| `mensagem_aviso`, `mensagem_resumo` | `conversation_ref`, `count` |
| `selecao`, `cancelamento` | `request_ref` (**sem** referência ao profissional) |
| `prazo_t24`, `prazo_t0` | `request_ref` |

Link do e-mail: apenas a URL base do site com caminho fixo por categoria, sem token (login é H-097). O texto final é de H-095..H-099; H-092 só garante o formato e a guarda.

## 7. Cota (decisão 3) [DECIDIDO 3; degraus PROPOSTA]

Limites do serviço `email` (S-11 §2, 100/dia e 3.000/mês herdados de 13, **[NÃO VERIFICADO]** em S-11): dia UTC 100, mês 3.000, reserva `auth` 10 e 300.

Regra por classe: **permitido enquanto `used < corte`**, no dia **e** no mês.

| Classe | Corte dia | Corte mês | Observação |
|---|---|---|---|
| `auth` | 100 | 3.000 | usa a reserva: únicos que passam de 90 e 2.700 |
| `critico` | **90** | **2.700** | para em 90 por dia [DECIDIDO 3] |
| `digest` | 85 | 2.550 | 85% do limite [PROPOSTA] |
| `lembrete` | 70 | 2.100 | 70% do limite; suprime lembretes de baixo valor primeiro [PROPOSTA] |

- Com `used=90`: `auth` passa, `critico` já é adiado (CA-17, CA-20, CA-21). O texto de 08 §12.6 ("acima de 90 passam `auth` e crítico") fica **superado** por esta regra; ajuste a aplicar em 08 §12.6 e ADR-022.
- **Reserva atômica** `private.email_quota_reserve(class, p_now)`: cria as linhas `dia_utc` e `mes` se faltarem, trava dia e depois mês, aplica `decideQuota`, e incrementa **as duas** linhas na mesma transação. Devolve `{permitido, bloqueado_por, alert_level, proxima_tentativa}`. A devolução (`email_quota_release`) só decrementa se a linha de reserva existir (>0).
- **Alertas (H-094, 59-DESENHO-H094 §2):** ao cruzar 70% e 85% do limite (dia: 70 e 85; mês: 2.100 e 2.550), grava `alert_level` e `alerted_at` uma vez por subida e emite evento sem PII. Não há alerta de 95%. Os cortes de 90/dia e 2.700/mês são o corte da classe `critico` (linha da tabela acima), não alerta. Painel: H-108.
- **Adiados** voltam por prioridade (`auth`, `critico`, `digest`, `lembrete`, depois `created_at`) na virada do dia UTC; são revalidados (§5.4, passo 2) e, se obsoletos, descartados.
- **Chat e site nunca dependem disto** (CA-19): a mensagem automática é gravada pelo domínio de chat na transação do aceite, sem passar pelo `email_outbox`. Teste de garantia na §10.
- **Resposta uniforme do login** (CA-18): quando `auth` não passa por razão do provedor, a linha fica `pendente` com recuo; a resposta HTTP continua 202 (H-097).
- **Fronteira H-092 × H-094 (decidida em 59-DESENHO-H094 §7):** H-092 entrega reserva/devolução, degraus, descarte e adiamento. H-094 entrega o contador, os alertas em 70/85% (gravação e evento na subida) e os testes de virada e degradação. **Fora de H-094:** reconciliação com o provedor, alargamento da janela de digest (`windowFactor` não é implementado) e o painel (H-108).

## 8. Leitura e cancelamento de resumo (resumo das regras)

| Situação | Efeito |
|---|---|
| Mensagem humana lida antes do flush | `isStillRelevant`=`lido` ⇒ item `descartado(lido)` (CA-07) |
| Cliente abre o pedido depois do aceite [DECIDIDO 2] | item de aceite `descartado(lido)`; vale por `occurred_at` do evento (CA-08) |
| Todos descartados no flush | nenhum e-mail; cooldown não é reiniciado (CA-09) |
| Pedido selecionado, cancelado ou concluído antes do envio | `descartado(obsoleto)` no flush **e** de novo antes de enviar (CA-10, CA-11) |
| Linha adiada por cota revalidada no dia seguinte | enviada só se válida; senão `descartado` (CA-13) |
| Mensagem automática de aceite (remetente nulo) | `rule.resolve` devolve lista vazia; só nasce o item de `aceite` (CA-02) |
| Eventos anteriores à entrada em vigor | despachados sem efeito (CA-12) |

"Ler" não escreve em tabela de notificação: o endpoint de leitura (H-066/H-068…) só atualiza o estado do domínio; a regra enxerga isso na releitura. Isso evita corrida entre leitura e envio e dispensa evento extra.

## 9. Segurança, privacidade e observabilidade

- Tabelas só para `app_system`, RLS forçada, sem políticas; `private.*` com `search_path=''` e `revoke` de `public/anon/authenticated/service_role` (padrão H-005).
- Sem PII em `dedupe_key`, `payload_ref`, `reason_code`, `last_error` e métricas (apenas ids pseudônimos e códigos).
- Métricas: tamanho da fila por estado, idade do item pendente mais antigo, `adiado_cota`, falhas por código, nível de cota. Entrega ao painel em H-108.
- Retenção: itens e linhas enviadas entram no expurgo operacional de 09 §10 (a rotina é de história própria; não criar agora). Itens guardam só ids, sem endereço.

## 10. Testes para o DEV (nenhum com rede real; provedor sempre `FakeEmailProvider`)

**Unidade (Vitest, sem banco, `FakeClock`)**
- T-H92-01 `policy`: toda categoria/`email_type` da §2 mapeia à classe certa; `outro` e combinações inválidas são recusadas; janela fora de 60–3600 cai no padrão.
- T-H92-02 `quota`: tabela completa de cortes por classe, no dia e no mês: `used` 69/70, 84/85, 89/90, 99/100 e 2.099/2.100, 2.549/2.550, 2.699/2.700, 2.999/3.000. `auth` passa até 99; `critico` para em 90 (CA-17, 20, 21). Bloqueio por mês com dia livre e vice-versa.
- T-H92-03 `content-guard`: rejeita e-mail, telefone, endereço, `message`, `url`, nome, string livre, chave desconhecida; aceita as allowlists; `selecao`/`cancelamento` sem referência ao profissional (CA-14..16).
- T-H92-04 `priority`: ordenação `auth<critico<digest<lembrete` e desempate por tempo.
- T-H92-05 `rules`: duplicidade de regra para o mesmo `eventType` falha no boot.

**Banco (`*.dbtest.mjs`, conexão de desenvolvimento, dentro de transação com rollback quando possível; concorrência com várias conexões)**
- T-H92-10 Reentrega do mesmo evento 3× ⇒ 1 item (CA-01).
- T-H92-11 Sem cooldown ⇒ 1 `email_outbox` imediato e `cooldown_until = now+15 min` (CA-03).
- T-H92-12 8 aceites no mesmo pedido em 15 min ⇒ 1 imediato + 8−1 itens `pendente` + exatamente 1 job `notification.flush` (CA-04, N-02).
- T-H92-13 20 ingestões simultâneas na mesma chave ⇒ exatamente 1 imediato, 19 pendentes, 1 flush.
- T-H92-14 Aceite e mensagem no mesmo destinatário: cooldowns independentes (CA-05).
- T-H92-15 Flush: com 3 itens válidos ⇒ 1 `email_outbox` (`count=3`), itens `enviado`, cooldown reiniciado (decisão 1).
- T-H92-16 Flush executado duas vezes e em duas conexões simultâneas ⇒ 1 e-mail (CA-06, C-13).
- T-H92-17 Flush com todos `lido/obsoleto` ⇒ 0 e-mail, cooldown inalterado (CA-07..10).
- T-H92-18 Flush antes do fim da janela (alguém enviou antes) ⇒ reagenda e não envia.
- T-H92-19 Evento chega entre `begin` e `commit` do flush ⇒ fica pendente com novo flush; não cria rajada.
- T-H92-20 Classe `critico`, `lembrete`, `auth`: sem cooldown, `dedupe_key` natural; `prazo` repetido não duplica (CA-11).
- T-H92-21 `external_quota_reserve`: 20 reservas concorrentes com `used=95` para `auth` ⇒ no máximo 5 concedidas; `used` nunca > 100. Virada de dia UTC (23:59:59 → 00:00:00) usa `p_now`.
- T-H92-22 Permissões: `anon/authenticated/service_role/app_api` sem acesso às tabelas e funções; `app_system` com acesso mínimo.
- T-H92-23 `outbox.dispatch`: evento sem regra é marcado e não gera item; falha em um evento não bloqueia os demais (CA-12).

**Integração do motor (Vitest com repositório Pg, `FakeEmailProvider`, `FakeRecipientDirectory`, `StubRule`)**
- T-H92-30 Evento → item → linha → `aceito`: fluxo completo (CA-01, 03).
- T-H92-31 Resposta `limite_taxa` ⇒ cota devolvida, lote interrompido, `next_attempt_at` respeita `retryAfter` (CA-22).
- T-H92-32 `indisponivel` 8× ⇒ `falha`; `recusa_permanente` ⇒ `falha`; cota devolvida em ambos.
- T-H92-33 `nao_configurado` ⇒ linha segue `pendente`, sem gastar tentativa (N-10).
- T-H92-34 Cota 90 e 100 (dia) e 2.700 e 3.000 (mês): `auth` passa; os demais viram `adiado_cota` com `next_attempt_at` correto; no dia seguinte saem por prioridade e só se ainda válidos (CA-17..21, Q-10, Q-11).
- T-H92-35 Cota esgotada: o chat não é afetado (o teste confirma que nenhuma gravação de mensagem depende de `email_outbox`) (CA-19).
- T-H92-36 Ritmo: 15 envios saem em ≥ 2,8 s simulados (200 ms de pausa) (CA-22).
- T-H92-37 Revalidação no envio: item válido no flush e obsoleto no envio ⇒ `descartado`, sem chamar o provedor (CA-10, 11).
- T-H92-38 Crash simulado após a reserva: segunda execução não reserva de novo e usa o mesmo `idempotencyKey`.
- T-H92-39 Nenhum teste faz chamada de rede (bloquear `fetch`/sockets no setup do teste).

## 11. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | "Imediato" depende do tick (≥ 1 min, ADR-011): o primeiro aviso sai em até ~1–2 min | Documentar nos textos de H-095/H-096; `auth` continua direto na requisição (H-097) |
| R-2 | Timeout/queda após o provedor aceitar e antes de gravar `enviado` ⇒ e-mail duplicado | `idempotencyKey = dedupe_key` (suporte do Resend **[NÃO VERIFICADO]**, a confirmar em H-093); duplicata é rara e aceita no pior caso |
| R-3 | Contador local diverge do painel do Resend (S-11: cabeçalhos de cota vieram 0) | Contagem conservadora (reserva antes); reconciliação fora de H-094 (59-DESENHO-H094 §7) |
| R-4 | Despachante sem agendador: eventos presos se o job chegar a `falha` e nenhum evento novo entrar | Métrica de idade do evento mais antigo; H-108 alerta; no pior caso o próximo evento reativa |
| R-5 | Evento "venenoso" repete falha a cada execução | Falha isolada por evento e métrica; coluna de tentativas em `outbox_event` fica como melhoria se ocorrer |
| R-6 | `NotificationRule.isStillRelevant` depende de tabelas futuras (pedido, conversa) | Contrato testado com `StubRule`; cada história de categoria entrega a regra real e o teste dela |
| R-7 | Janela de digest (15 min) mais atraso do tick ⇒ resumo em ~16–17 min | Aceito; janela medida em `notification_cooldown` |
| R-8 | Corte de `lembrete` em 70/dia pode adiar lembretes legítimos em dias cheios | Adiados voltam no dia seguinte se válidos; cortes em constante única, ajustável por H-094 |
| R-9 | Deadlock entre cooldown, job e cota | Ordem fixa de bloqueio: cooldown → job; cota: dia → mês; `lock_timeout` 3 s nas funções |
| R-10 | Conta/destinatário apagado (LGPD) deixa itens com id órfão | Itens e linhas só têm ids; `isStillRelevant` devolve `destinatario_invalido`; expurgo em 09 §10 |
| R-11 | Quem chama o ritmo de 5/s não é global (serverless com várias instâncias) | Com 100/dia o risco de passar de 10 req/s é desprezível; a resposta 429 já recua |

## 12. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-1 Despachante do outbox:** nenhuma história o possui; este desenho o inclui em H-092 em versão mínima (job `outbox.dispatch` + gatilho). *Recomendação: manter em H-092; se preferir, abrir história própria antes de H-092.*
2. **D-2 Fronteira com H-094:** reserva, degraus e adiamento ficam em H-092 (os critérios CA-17..22 já estão nesta Issue). H-094 fica com alertas persistentes, reconciliação, alargamento de janela e painel. *Recomendação: aceitar e ajustar a descrição de H-094.*
3. **D-3 Degraus de cota** (digest 85%, lembrete 70%) são propostas minhas além do corte de 90 já decidido. *Recomendação: aceitar, valores em constante ajustável.*
4. **D-4 "Imediato"** = enfileirado na hora e enviado no próximo tick (≈ 1 min), exceto `auth` direto. *Recomendação: aceitar e refletir nos textos de aceite.*
5. **D-5 Tabela de saída:** interpretei "tabela de saída existente" como `ops.outbox_event` (fonte) e criei `ops.email_outbox` do modelo 09 §3.11 (ainda sem migração). Estado novo `descartado` e colunas `reason_code`, `schedule_seq`, `quota_reserved` em `email_outbox`; coluna `occurred_at` em `notification_item`. *Recomendação: aceitar e atualizar 09 §3.11 e 08 §12.6 junto com a migração.*

## 13. Plano de execução para o DEV (ordem sugerida)

1. Domínio puro e testes T-H92-01..05 (`packages/domain/src/notifications/`).
2. Dublês em `packages/testkit`.
3. Migração + rollback + funções SQL + testes T-H92-10..22.
4. Adaptadores Pg e handlers (`outbox.dispatch`, `notification.flush`, `email.send`), registro no `JobRegistry`, testes T-H92-23 e T-H92-30..39.
5. `corepack pnpm check:all` local; registrar comando, contagem e código de saída na Issue.

Fora do escopo (confirmado): adapter Resend/Mailpit/segredos (H-093), textos finais (H-095..H-099), painel e alertas persistentes (H-094/H-108), login direto (H-097), expurgo (história própria), qualquer interruptor ou reenvio (H-100).

## Resumo em linguagem simples

Este desenho define como cada acontecimento do site vira um aviso por e-mail sem estourar o limite gratuito: o primeiro aviso sai logo, os seguintes são juntados em um único resumo a cada 15 minutos, e o resumo some se a pessoa já viu a novidade ou o pedido mudou. Quando o limite diário ou mensal chega perto, o e-mail de login tem prioridade, os outros esperam o dia seguinte, e o chat e o site continuam funcionando normalmente. Nada é enviado de verdade nesta etapa.
