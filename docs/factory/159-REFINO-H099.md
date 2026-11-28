# Refino H-099 — Lembretes de prazo, trial e ciclo (Issue #109)

- **Issue:** #109 `[E11] Lembretes de prazo, trial e ciclo` · **História:** H-099 · **Épico:** E11 — Notificações (Ondas 3 a 5) · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-19.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, banco de dados, quadro nem `11-DECISOES.md` foi alterado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-19 local, após a Rodada 144).
- `14-BACKLOG.md` (linha H-099, H-092 a H-101, H-044, H-045, H-046, H-047 a H-052, H-031, H-072 a H-075, H-077, H-008 e §6 Bloqueios externos).
- `04-PRD.md` (RF-057, RF-058, RF-059, RF-061, RF-062, RF-064, RF-072, RF-073, RF-115 a RF-122, RNF-EMAIL §6.1).
- `05-CRITERIOS-ACEITE.md` (FA-005, FA-006, FA-012, FA-014, FA-016, FA-025, FA-029, FA-031).
- `07-AMBIGUIDADES.md` (AMB-06 A [DELEGADO], AMB-09, AMB-25 extinta, AMB-31 respondida, BLQ-JUR L2 e L3).
- `08-ARQUITETURA.md` (§1.1, §6, §7.2, §7.6, §8 Assinaturas, §12 Notificações, §14 Observabilidade, §16.2 Jobs e Tick).
- `09-MODELO-DADOS.md` (§3.1, §3.3, §3.10 billing: `access_grant`, `subscription`; §3.11 notifications/plataforma: `notification_item`, `email_outbox`, `notification_cooldown`, `external_quota`, `app.service_request`, `ops.outbox_event`, `ops.job`, `ops.app_config`).
- `10-ADRS.md` (ADR-007, ADR-011, ADR-018, ADR-020, ADR-022; SD-10, SD-16).
- `11-ARQ-RISCOS-E-TESTES.md` (Testes N-04, N-06, N-07, N-08, B-01 a B-08, Q-01, Q-09, Q-10, Q-11; Invariantes I-05, I-14, I-20, I-24, I-25).
- `11-DECISOES.md` (Decisões 15, 21, 23, 26, 27, 28, 29, 151, 166, 202, 206, 267 a 279, 343 a 348, 496 a 509, 582, 800+, Rodadas 12, 13, 61, 62, 72, 100, 102, 142, 144).
- Migrações versionadas conferidas no repositório:
  - `supabase/migrations/20261110130000_platform_create_outbox_jobs_idempotency.sql` (`ops.outbox_event`, `ops.job`, `private.job_claim`);
  - `supabase/migrations/20261110160000_platform_enable_job_tick.sql` (infraestrutura do tick de jobs, agendamento pg_cron);
  - `supabase/migrations/20261111120000_notifications_create_pipeline.sql` (`ops.email_outbox`, `ops.notification_item`, `ops.notification_cooldown`, `ops.external_quota`, `private.notification_ingest`, `private.email_outbox_claim`, `private.email_outbox_reservar_cota`, `private.email_outbox_marcar_enviado`, `private.email_outbox_reagendar`, `private.email_outbox_encerrar`, `private.email_outbox_ajustar_itens`);
  - `supabase/migrations/20261111270000_notifications_email_alert_levels.sql` (níveis de alerta 70% e 85%);
  - `supabase/migrations/20261113010000_requests_create_service_request.sql` (`app.service_request`, `acceptance_deadline_at`, `status = 'publicado'|'selecionado'|'concluido'|'cancelado'`);
  - `supabase/migrations/20261113170000_billing_create_access_grant.sql` (`billing.access_grant`, `billing.subscription`, `private.commercial_access`);
  - `supabase/migrations/20261113270000_billing_create_trial_activation.sql` (`private.trial_activate`, `private.identity_id_from_document_hmac`);
  - `supabase/migrations/20261113420000_eligibility_expand_professional_access_guard.sql`.
- Código existente inspecionado em `packages/domain` e `packages/db`:
  - `packages/domain/src/notifications/{policy.ts, rules.ts, priority.ts, quota.ts, content-guard.ts, ports.ts}`;
  - `packages/db/src/notifications.ts` (`dispatchOutbox`, `processOutbox`, `flushGroup`, `PgNotificationStore`, `SendPacer`, `registerNotificationHandlers`);
  - `packages/db/src/jobs-tick.ts` (`JobRegistry`, `JobHandler`, `registerJobHandler`).
- Modelos estruturais e de rigor: `docs/factory/139-REFINO-H055.md` e `docs/factory/158-REFINO-H058.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #109 no GitHub não foi lido por comando de rede (este agente opera no ambiente estritamente local e sem rede externa). O escopo e os critérios de aceite foram consolidados a partir da linha H-099 do backlog canônico (`14-BACKLOG.md`) e do cruzamento minucioso com PRD, Critérios de Aceite, Arquitetura, Modelo de Dados, ADRs e histórico de decisões.
- Nenhum comando destrutivo ou de modificação foi executado no banco de desenvolvimento (ambiente preservado; sem migrations ou escritas nesta fase).
- Não há Docker no ambiente de desenvolvimento: usa-se o projeto Supabase na nuvem ou scripts locais.
- Não há chamadas a provedores externos de mapas (sem Mapbox).
- Não há e-mail real enviado a destinatários humanos em desenvolvimento/teste: o envio real depende estritamente de domínio verificado no Resend (decisão 15). Em desenvolvimento e testes, o envio utiliza Mailpit local ou mock/testkit, com envio desligado/bloqueado para o mundo externo.
- Não há menção a backup de dados (excluído do escopo do projeto pela decisão 151).
- Resposta uniforme sem enumeração de recursos quando aplicável.

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro da fábrica (`docs/factory/quadro-status.md`) lista a Issue #109 (`[E11] Lembretes de prazo, trial e ciclo`) na primeira coluna de trabalho ativo: **Product Owner (7)**.
- `[VERIFICADO]` Total de 75 Issues Concluídas no quadro, com as fundações tecnológicas e de arquitetura de notificações e contas já entregues e estáveis:
  - **#18 (`H-005`):** Outbox, jobs, idempotência e `ops.app_config`;
  - **#21 (`H-008`):** Tick de jobs (A, C e D), `JobRegistry` e `private.job_claim`;
  - **#44 (`H-031`):** Publicação de pedidos (`app.service_request`, prazo imutável de 168 h, status `publicado`);
  - **#55 (`H-042`):** Guarda de elegibilidade na API e no banco;
  - **#57 (`H-044`):** Ativação de trial de 14 dias (`billing.access_grant` com `type = 'trial'`, `starts_at`, `ends_at = starts_at + 14 days`);
  - **#58 (`H-045`):** Acesso comercial derivado (`billing.access_grant`, `billing.subscription` e função estável `private.commercial_access`);
  - **#59 (`H-046`):** Planos e preços em centavos;
  - **#102 (`H-092`):** Pipeline de notificações e cooldown (tabelas `ops.email_outbox`, `ops.notification_item`, `ops.notification_cooldown`, `ops.external_quota`, funções `private.notification_ingest` e rotina `processOutbox`);
  - **#103 (`H-093`):** `EmailProviderPort` com adapter Resend e mock de testes;
  - **#104 (`H-094`):** Cota do Resend, cortes por classe e alertas;
  - **#107 (`H-097`):** E-mail de login com prioridade máxima na cota.
- `[VERIFICADO]` Dependências declaradas de H-099 no backlog (`14-BACKLOG.md`):
  1. **H-092 (#102):** `Concluído` no quadro. Entrega a infraestrutura do pipeline de notificação, tabela `ops.email_outbox` com classes, reavaliação antes do envio (`isStillRelevant`), reserva de cota e gravação de alertas.
  2. **H-008 (#21):** `Concluído` no quadro. Entrega o agendamento temporal no banco (`ops.job`) e o orquestrador do tick de jobs.
  3. **H-044 (#57):** `Concluído` no quadro. Entrega a ativação do trial de 14 dias pelo profissional e o registro da concessão em `billing.access_grant`.
- `[VERIFICADO]` **Situação das dependências de negócio e fatiamento de entrega:**
  - **Lembretes de prazo do pedido (T-24h e T0):** todas as dependências estão `Concluído` (#44, #102, #21). A tabela `app.service_request` com `published_at`, `acceptance_deadline_at` e `status` já existe e está populada. Pode ser implementada e testada integralmente agora.
  - **Lembretes de teste gratuito (Trial T-3d e T0):** todas as dependências estão `Concluído` (#57, #58, #102, #21). O trial de 14 dias com `billing.access_grant` do tipo `trial` já está implementado e integrado à função `commercial_access`. Pode ser implementada e testada integralmente agora.
  - **Lembretes de ciclo pago (Ciclo T-3d e T0):** as histórias de cobrança real, checkout e webhook do gateway Mercado Pago (#60 Checkout MP, #61 Webhook MP, #62 Concessão paga e #63 Carência) estão na coluna **Backlog**. A tabela `billing.access_grant` já suporta o tipo `paid` e a tabela `billing.subscription` já possui os campos de modo (`cartao_recorrente`/`manual`) e `cancel_at_period_end`. **Consequência arquitetural explícita:** o mecanismo de regras de ciclo, a validação de relevância e os testes de unidade/banco de H-099 para ciclo pago podem ser totalmente especificados e testados com fixtures sintéticas nesta Issue; porém, a prova E2E completa com pagamentos reais do Mercado Pago só terminará quando as Issues #60 a #63 forem desenvolvidas e concluídas.
  - **Bloqueios jurídicos externos declarados:** `BLQ-JUR L2` (termos de uso e comunicações) e `BLQ-JUR L3` (política de cobrança, renovação e reembolso) incidem sobre a redação do lembrete de cobrança futura de assinaturas pagas. O trial não sofre desse bloqueio porque não há meio de pagamento cadastrado, não há renovação automática e nenhuma cobrança pode ser gerada (RF-057, FA-005).

---

## 2. Objetivo

Permitir que o FastPro envie notificações automáticas por e-mail, rigorosamente checadas e revalidadas no instante do disparo, em marcos temporais cruciais da jornada do cliente e do profissional:

1. **Ao Cliente (dono do pedido de serviço):**
   - **Lembrete de Prazo T-24h:** 24 horas antes do encerramento da admissão de aceites (aos 6 dias da publicação), informando que restam 24 horas para o encerramento do recebimento de aceites de profissionais no pedido, sem fazer promessas de novos aceites;
   - **Aviso de Vencimento de Prazo T0:** exatamente aos 7 dias corridos da publicação (`acceptance_deadline_at`), informando que o prazo de aceites encerrou, explicando que as conversas já abertas permanecem ativas e orientando o cliente sobre os próximos passos (selecionar um profissional participante ou, se necessário, republicar futuramente).
2. **Ao Profissional (gestão do acesso comercial):**
   - **Lembrete de Fim de Teste Grátis (Trial T-3d):** 3 dias antes do término do período de 14 dias (no 11º dia do trial), alertando sobre o encerramento do teste e convidando o profissional a conhecer e assinar um dos planos pagos para não perder a descoberta de novas oportunidades de trabalho. **Regra de ouro:** o texto jamais induz ou menciona cobrança automática, pois o trial não exige meio de pagamento nem converte automaticamente (RF-057);
   - **Aviso de Encerramento do Teste (Trial T0):** no instante do término do 14º dia (`ends_at`), informando que o período de degustação expirou e que a descoberta e novos aceites cessaram (mantendo o histórico e as conversas ativas onde já havia participado), sem nenhuma cobrança gerada;
   - **Lembrete de Fim de Ciclo Pago (Ciclo T-3d):** 3 dias antes do término da vigência da assinatura paga (`ends_at`), lembrando da renovação automática programada (se cartão de crédito com adesão expressa) ou orientando o pagamento de novo ciclo via Pix (se modalidade manual), ou alertando sobre o encerramento definitivo caso o cancelamento no fim do período tenha sido solicitado (`cancel_at_period_end = true`);
   - **Aviso de Vencimento de Ciclo / Início de Carência (Ciclo T0):** no instante em que o ciclo pago termina sem confirmação prévia de novo pagamento, informando a entrada no período de tolerância de **72 horas de carência** (`em_carencia`), durante o qual os benefícios de descoberta e aceite permanecem plenamente ativos.

**Invariante de Não-Obsoletismo e Recheque Atômico:** Todo lembrete avalia obrigatoriamente a condição atual do recurso no exato segundo em que a linha de envio é processada. Se o pedido foi selecionado, cancelado ou concluído antes do envio, ou se o profissional já contratou um plano pago ou teve sua conta suspensa, o item é descartado silenciosamente com motivo `obsoleto` e nenhum e-mail sai.

---

## 3. Escopo (dentro de H-099)

1. **Definição dos Tipos de E-mail e Políticas no Domínio:**
   - Formalização dos tipos de e-mail na política do domínio (`packages/domain/src/notifications/policy.ts`):
     - `prazo_t24`: categoria `prazo`, classe `lembrete`, parâmetros autorizados `['request_ref']`;
     - `prazo_t0`: categoria `prazo`, classe `lembrete`, parâmetros autorizados `['request_ref']`;
     - `acesso_trial_t3d`: categoria `acesso`, classe `lembrete`, parâmetros autorizados `[]`;
     - `acesso_trial_t0`: categoria `acesso`, classe `lembrete`, parâmetros autorizados `[]`;
     - `acesso_ciclo_t3d`: categoria `acesso`, classe `lembrete`, parâmetros autorizados `[]`;
     - `acesso_ciclo_t0`: categoria `acesso`, classe `lembrete`, parâmetros autorizados `[]`.
2. **Implementação das Regras de Notificação (`NotificationRule`):**
   - Criação e registro das regras de negócio de notificação no registro oficial (`NotificationRuleRegistry`):
     - `PrazoNotificationRule`: trata eventos de aproximação de prazo e vencimento do pedido, resolvendo o destinatário `customer_user_id`;
     - `TrialNotificationRule`: trata marcos de teste gratuito, resolvendo o destinatário `professional_id` (usuário do profissional);
     - `CicloNotificationRule`: trata marcos de ciclos pagos de assinatura, resolvendo o destinatário `professional_id`.
3. **Lógica Estrita de Revalidação de Relevância (`isStillRelevant`):**
   - **Para pedidos (`prazo`):**
     - Consulta o pedido em `app.service_request`:
     - Se `status != 'publicado'` (isto é: `selecionado`, `concluido` ou `cancelado`), retorna `obsoleto`;
     - Para `prazo_t24`: se o instante de envio `now >= acceptance_deadline_at`, retorna `obsoleto` (não faz sentido avisar de 24 h se o prazo já acabou);
     - Se o cliente titular tiver sido anonimizado ou excluído via LGPD/DSR (`anonimizado`, `em_eliminacao`), retorna `destinatario_invalido`;
     - Se o pedido estiver aberto e dentro do intervalo aplicável, retorna `valido`.
   - **Para trial (`acesso_trial`):**
     - Consulta `billing.access_grant` e `private.commercial_access`:
     - Se o profissional já possui acesso pago ativo (`commercial_access` devolve `ativa`), retorna `obsoleto` (já virou assinante, lembrete de teste é irrelevante);
     - Se a concessão do trial foi revogada administrativamente (`status = 'revogada'`), retorna `obsoleto`;
     - Para `acesso_trial_t3d`: se `now >= ends_at`, retorna `obsoleto`;
     - Se a conta do profissional estiver em estado `bloqueado`, `suspenso` ou `encerrado`, retorna `destinatario_invalido`;
     - Caso contrário, retorna `valido`.
   - **Para ciclo pago (`acesso_ciclo`):**
     - Consulta `billing.access_grant`, `billing.subscription` e `private.commercial_access`:
     - Se já houver novo pagamento confirmado que estendeu a vigência para um ciclo futuro (`ends_at > marco_avaliado`), o lembrete de renovação daquele ciclo anterior retorna `obsoleto`;
     - Se o profissional tiver sido suspenso por infração de segurança, retorna `destinatario_invalido`;
     - Caso contrário, retorna `valido`.
4. **Mecanismo de Despacho e Agendamento via Tick (`ops.job`):**
   - Criação de jobs agendados no banco para disparo nos momentos exatos:
     - No ato da publicação do pedido (`H-031`): agendamento de jobs `reminder.request_t24` para `published_at + 144 hours` e `reminder.request_t0` para `published_at + 168 hours`;
     - No ato da ativação do trial (`H-044`): agendamento de jobs `reminder.trial_t3d` para `starts_at + 264 hours` (11 dias) e `reminder.trial_t0` para `starts_at + 336 hours` (14 dias);
     - No ato da concessão paga (`H-049`): agendamento de jobs `reminder.cycle_t3d` para `ends_at - 72 hours` e `reminder.cycle_t0` para `ends_at`;
   - Como contingência robusta contra cold starts ou perda de leases: job periódico de varredura (ex.: diário ou horário pelo Tick A/C) para identificar marcos atingidos sem duplicar linhas.
5. **Deduplicação Rigorosa e Imutabilidade (`dedupe_key`):**
   - Em conformidade com `08-ARQUITETURA.md` §12.4, toda linha gerada em `ops.email_outbox` utiliza chaves determinísticas únicas:
     - Prazo 24h: `dedupe_key = "req:prazo_t24:" || request_id`
     - Prazo T0: `dedupe_key = "req:prazo_t0:" || request_id`
     - Trial 3d: `dedupe_key = "trial:t3d:" || grant_id`
     - Trial T0: `dedupe_key = "trial:t0:" || grant_id`
     - Ciclo 3d: `dedupe_key = "ciclo:t3d:" || grant_id`
     - Ciclo T0: `dedupe_key = "ciclo:t0:" || grant_id`
   - Tentativas simultâneas ou reexecuções de jobs batem na constraint de chave única e não geram duplicatas.
6. **Políticas de Cota do Provedor e Degradação Controlada:**
   - Enquadramento obrigatório de todos os lembretes na classe `lembrete`;
   - Respeito estrito aos cortes da classe `lembrete`: corte diário em 70 e-mails (dia UTC) e mensal em 2.100 e-mails (`QUOTA_CUTS.lembrete`);
   - Se o contador atingir o corte, o envio é postergado com estado `adiado_cota`;
   - Na reavaliação no próximo dia UTC, o lembrete só é enviado se a janela temporal ainda for válida e o estado não tiver se tornado obsoleto (evitando entrega extemporânea de lembretes vencidos).
7. **Blindagem Absoluta de Conteúdo (PII e Segurança):**
   - Parâmetros validados por `assertSafeTemplateParams`: proibição total de texto livre, mensagens de terceiros, dados bancários, valores de cobrança, endereços, telefones ou nomes de concorrentes;
   - Os e-mails contêm apenas textos institucionais padrão aprovados e referências seguras para login na plataforma via link autenticado.
8. **Testes Automatizados Completos:**
   - Testes unitários no domínio de todas as regras e políticas de lembrete;
   - Testes de persistência e integração no Postgres com relógio controlado (`useDbClock: false` com `FakeClock`), simulando avanços de tempo de 6 dias, 7 dias, 11 dias e 14 dias;
   - Testes de descarte por mudança concorrente de estado (pedido selecionado ou cancelado entre o agendamento e o disparo).

---

## 4. Fora de escopo

- **Disparo de e-mail real para servidores SMTP externos:** proibido em desenvolvimento e testes. Toda a suíte deve executar em sandbox com o adapter simulado (`FakeEmailProvider`) ou Mailpit local, sem chamadas à internet e sem consumir a cota real da conta do Resend.
- **Outros canais de comunicação (Push, SMS, WhatsApp):** expressamente fora do MVP (PRD RF-121). O escopo limita-se exclusivamente a e-mail e à presença transacional no site.
- **Interruptores ou painéis de configuração para ativar/desativar lembretes:** expressamente proibidos por decisão do usuário (decisão 27 e PRD RF-122). Os lembretes são nativos do código, operam sob a cota do Resend e não admitem feature flags ou telas de admin.
- **Processamento de checkout ou geração de cobranças no Mercado Pago:** responsabilidade das histórias H-047, H-048 e H-049. H-099 apenas consome os marcos de concessão já gravados no banco.
- **Cobrança automática ao fim do trial:** proibição absoluta de produto (RF-057, FA-005). O trial termina sem meio de pagamento e sem débito.
- **Interface visual dos painéis do cliente ou do profissional:** os cards de alerta visual em tela pertencem ao Painel do Cliente (H-034 / #47) e ao canal "No site" (H-101 / #137). H-099 foca no pipeline assíncrono de e-mails.
- **Backup e rotinas de dump:** descartados do projeto pela decisão 151.
- **Alterações na tabela `ops.app_config` ou no schema do banco sem migração aprovada.**

---

## 5. Fluxos e estados

### 5.1 Visão Geral da Arquitetura de Lembretes

```
[Publicação do Pedido (H-031) / Ativação de Acesso (H-044/H-049)]
                           │
                           ▼
              Agendamento de Jobs no Banco
              (ops.job com run_at = T_alvo)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Tick de Jobs (H-008: pg_cron A, oportunista C ou diário D) │
│ - private.job_claim seleciona job cujo run_at <= now()      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              Emissão de Evento no Outbox
             (ops.outbox_event sem PII)
                           │
                           ▼
          Despachante do Pipeline (H-092)
          - dispatchOutbox lê ops.outbox_event
          - Consulta NotificationRuleRegistry
          - Executa Rule.resolve(evento)
          - Cria ops.notification_item
          - Cria ops.email_outbox (classe 'lembrete', dedupe_key)
                           │
                           ▼
         Processador de Envio (processOutbox)
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
Reavaliação de Relevância               Verificação de Cota
(isStillRelevant)                       (reserveQuota)
- Pedido selecionado/cancelado?         - Uso dia < 70 e mês < 2100?
  -> DESCARTA (motivo: obsoleto)          -> Se estourou: ADIA (adiado_cota)
- Trial já virou plano pago?
  -> DESCARTA (motivo: obsoleto)               │
- Concessão revogada ou conta inativa?         │ (Se válido e com cota)
  -> DESCARTA (destinatário inválido)          ▼
                                        Envio pelo Provedor
                                        (EmailProviderPort / Resend)
                                               │
                                               ▼
                                        200 OK / Enviado
                                        (ops.email_outbox: enviado)
```

### 5.2 Lembretes de Prazo do Pedido (T-24h e T0)

| Parâmetro | Marco T-24h | Marco T0 (Vencimento) |
|---|---|---|
| **Instante do Disparo** | `published_at + 144 hours` (6 dias) | `published_at + 168 hours` (7 dias) |
| **Destinatário** | Cliente titular (`customer_user_id`) | Cliente titular (`customer_user_id`) |
| **Tipo de E-mail** | `prazo_t24` | `prazo_t0` |
| **Categoria / Classe** | `prazo` / `lembrete` | `prazo` / `lembrete` |
| **Dedupe Key** | `req:prazo_t24:<request_id>` | `req:prazo_t0:<request_id>` |
| **Condição de Validade (`isStillRelevant`)** | `status = 'publicado'` e `now < acceptance_deadline_at` | `status = 'publicado'` e `now >= acceptance_deadline_at` |
| **Ação se `status != 'publicado'`** | Descarta com motivo `obsoleto` | Descarta com motivo `obsoleto` |
| **Ação se cliente excluído (LGPD)** | Descarta com motivo `destinatario_invalido` | Descarta com motivo `destinatario_invalido` |
| **Conteúdo Principal** | Faltam 24 h para fechar aceites; convite a acessar | Prazo de aceites encerrado; conversas continuam ativas |
| **Promessa de Aceites** | Expressamente vedada (RF-119) | Expressamente vedada (RF-119) |

### 5.3 Lembretes de Teste Gratuito (Trial T-3d e T0)

| Parâmetro | Marco T-3d | Marco T0 (Encerramento do Teste) |
|---|---|---|
| **Instante do Disparo** | `starts_at + 264 hours` (11º dia) | `starts_at + 336 hours` (14º dia) |
| **Destinatário** | Profissional titular (`professional_id`) | Profissional titular (`professional_id`) |
| **Tipo de E-mail** | `acesso_trial_t3d` | `acesso_trial_t0` |
| **Categoria / Classe** | `acesso` / `lembrete` | `acesso` / `lembrete` |
| **Dedupe Key** | `trial:t3d:<grant_id>` | `trial:t0:<grant_id>` |
| **Condição de Validade (`isStillRelevant`)** | `commercial_access = 'trial_ativo'` e `now < ends_at` | `commercial_access = 'trial_expirado'` ou término imediato |
| **Ação se contratou plano pago** | Descarta com motivo `obsoleto` | Descarta com motivo `obsoleto` |
| **Ação se trial foi revogado** | Descarta com motivo `obsoleto` | Descarta com motivo `obsoleto` |
| **Ação se conta suspensa/bloqueada** | Descarta com motivo `destinatario_invalido` | Descarta com motivo `destinatario_invalido` |
| **Regra sobre Cobrança** | Proibido induzir cobrança automática (RF-057) | Proibido gerar cobrança ou débito (FA-005) |
| **Conteúdo Principal** | Teste encerra em 3 dias; conheça os planos | Teste encerrado; ative um plano para voltar a receber pedidos |

### 5.4 Lembretes de Ciclo Pago (Ciclo T-3d e T0)

| Parâmetro | Marco T-3d | Marco T0 (Fim de Ciclo / Carência) |
|---|---|---|
| **Instante do Disparo** | `ends_at - 72 hours` | `ends_at` (início das 72 h de carência) |
| **Destinatário** | Profissional titular (`professional_id`) | Profissional titular (`professional_id`) |
| **Tipo de E-mail** | `acesso_ciclo_t3d` | `acesso_ciclo_t0` |
| **Categoria / Classe** | `acesso` / `lembrete` | `acesso` / `lembrete` |
| **Dedupe Key** | `ciclo:t3d:<grant_id>` | `ciclo:t0:<grant_id>` |
| **Condição de Validade (`isStillRelevant`)** | Concessão paga vigente sem renovação antecipada | Concessão expirando; transição para `em_carencia` |
| **Variante: Cartão com renovação** | Avisa sobre a data de débito da assinatura | Avisa sobre cobrança processada ou em retentativa |
| **Variante: Pagamento via Pix** | Lembra de gerar e pagar o Pix antes do fim | Avisa sobre início da carência de 72 h para pagamento |
| **Variante: Cancelado pelo usuário** | Avisa que o acesso cessa em definitivo em `ends_at` | Avisa que o acesso foi encerrado sem nova cobrança |
| **Ação se já houve renovação paga** | Descarta com motivo `obsoleto` | Descarta com motivo `obsoleto` |

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Atendimento em H-099 |
|---|---|---|---|
| **RN-H099-01** | **Recheque Mandatório de Estado.** Nenhum lembrete é enviado sem validar o estado do recurso no instante exato do processamento da linha de outbox. | RF-117, RF-119; FA-012, FA-029 | Método `isStillRelevant` descarta itens cujo estado original foi alterado (CA-H099-03, 04, 07, 10). |
| **RN-H099-02** | **Não Promessa de Aceites.** Os e-mails de prazo T-24h e T0 informam a situação temporal do pedido sem assegurar a chegada de novos profissionais ou aceites. | PRD RF-119 | Textos padronizados dos templates estritamente neutros e informativos (CA-H099-13). |
| **RN-H099-03** | **Preservação de Conversas Existentes no Vencimento.** O vencimento aos 7 dias fecha a entrada de novos aceites, mas não cancela o pedido nem apaga chats ativos. | RF-073, RF-119; FA-012 | O aviso T0 reforça que as conversas continuam disponíveis para negociação (CA-H099-02). |
| **RN-H099-04** | **Vedação de Cobrança Automática no Trial.** O teste gratuito encerra sem solicitar cartão, sem gerar débito e sem conversão tácita em assinatura paga. | RF-057; FA-005; AMB-06 A | E-mails de trial jamais solicitam dados bancários nem afirmam que haverá cobrança (CA-H099-05, 06). |
| **RN-H099-05** | **Suporte à Carência de 72 h no Ciclo Pago.** Ao vencer o ciclo pago (cartão ou Pix), o profissional entra em carência de 72 h com acesso preservado. | RF-059; H5; FA-006; I-25 | O e-mail de T0 do ciclo pago destaca o prazo de 72 h de carência antes do corte de acesso (CA-H099-09). |
| **RN-H099-06** | **Deduplicação Determinística.** Cada marco temporal de um recurso possui uma única chave imutável no outbox (`dedupe_key`), impedindo disparos duplicados. | `08` §12.4; ADR-011; C-13 | Invariante de chave única `(recurso, marco)` enforced pelo schema (CA-H099-11). |
| **RN-H099-07** | **Corte e Priorização de Cota.** Lembretes pertencem à classe `lembrete` (corte em 70/dia e 2.100/mês). Se postergados, não são enviados extemporaneamente. | `08` §12.6; ADR-022; RNF-EMAIL | Verificação de cota por `decideQuota` e descarte de lembretes obsoletos no dia seguinte (CA-H099-12). |
| **RN-H099-08** | **Blindagem Estrita de PII.** Os templates de e-mail e parâmetros de envio não carregam nomes completos, telefones, endereços ou credenciais. | RF-120; `09` §7; I-16 | Validação por `assertSafeTemplateParams` barrando qualquer campo sensível (CA-H099-14). |
| **RN-H099-09** | **Independência de Interruptores.** Nenhum lembrete é condicionado a feature flags, tabelas de controle ou telas de ativação/desativação. | Decisão 27; PRD RF-122 | Código nativo sem condicionais de ativação, sem flags em banco e sem rotinas de reenvio antigo (CA-H099-15). |
| **RN-H099-10** | **Determinismo Temporal.** Todas as funções de decisão aceitam relógio injetado (`p_now` / `ClockPort`), garantindo testes reprodutíveis e independentes de atrasos de máquina. | P4; Decisão 517; `08` §1.1 | Uso estrito de relógio injetado nas portas e regras (CA-H099-16). |

Invariantes rastreadas:
- **I-05:** Pedido com prazo vencido fecha admissão de aceites de forma definitiva.
- **I-14:** Trial único por identidade de documento; encerramento não gera cobrança automática nem segundo trial.
- **I-20:** Prazos e tempos resolvidos no uso de forma determinística, sem regressão de estados.
- **I-24:** Cota do provedor respeitada em todas as classes, garantindo disponibilidade de login e transações críticas.
- **I-25:** Carência de 72 horas para assinaturas pagas mantendo acesso total durante a janela.

---

## 7. Critérios de aceite (Given / When / Then)

### 7.1 Lembretes de Prazo do Pedido (Cliente)

- **CA-H099-01 (Lembrete de prazo T-24h para pedido aberto).**
  - **Dado** um pedido de serviço publicado em `app.service_request` com `status = 'publicado'` e data limite `acceptance_deadline_at`,
  - **Quando** o relógio atinge `acceptance_deadline_at - interval '24 hours'` e o job correspondente é processado pelo tick,
  - **Então** uma notificação é ingerida com tipo `prazo_t24`, categoria `prazo`, classe `lembrete` e `dedupe_key = "req:prazo_t24:" || request_id`,
  - **E** antes do envio o estado é revalidado como `status = 'publicado'`,
  - **E** o e-mail é colocado na fila do outbox com template institucional informando que restam 24 horas para encerramento de aceites, sem divulgar dados de terceiros ou prometer aceites.

- **CA-H099-02 (Aviso de encerramento de aceites T0 no vencimento de 7 dias).**
  - **Dado** um pedido publicado que atingiu o prazo de 7 dias corridos (`p_now >= acceptance_deadline_at`),
  - **Quando** o job de vencimento T0 é processado,
  - **Então** gera uma notificação do tipo `prazo_t0`, categoria `prazo`, classe `lembrete` e `dedupe_key = "req:prazo_t0:" || request_id`,
  - **E** o e-mail avisa que o prazo de novos aceites encerrou, esclarece que as conversas com profissionais que já aceitaram continuam ativas no site e instrui sobre a seleção do profissional.

- **CA-H099-03 (Descarte de lembrete T-24h se o pedido foi selecionado antes).**
  - **Dado** um pedido publicado para o qual o job de T-24h foi agendado,
  - **Mas** o cliente selecionou um dos profissionais participantes antes do marco de 24 h (`status = 'selecionado'`),
  - **Quando** o processador do outbox tenta despachar a notificação,
  - **Então** `isStillRelevant` identifica `status != 'publicado'`, o item é marcado como `descartado` com motivo `obsoleto`, a linha do outbox é cancelada (`sem_item_valido`) e **nenhum e-mail é enviado**.

- **CA-H099-04 (Descarte de lembrete se o pedido foi cancelado).**
  - **Dado** um pedido publicado cancelado pelo cliente (`status = 'cancelado'`),
  - **Quando** qualquer job de lembrete (T-24h ou T0) é executado,
  - **Então** a validação de relevância retorna `obsoleto`, o registro em `ops.email_outbox` é finalizado como `descartado` e nenhum e-mail sai.

### 7.2 Lembretes de Teste Gratuito (Profissional)

- **CA-H099-05 (Lembrete de trial a 3 dias do fim — Trial T-3d).**
  - **Dado** um profissional que ativou o trial de 14 dias em `billing.access_grant` e cuja concessão está em vigência normal (`commercial_access = 'trial_ativo'`),
  - **Quando** o relógio atinge `ends_at - interval '3 days'` (11º dia do teste),
  - **Então** é gerada uma notificação do tipo `acesso_trial_t3d`, classe `lembrete`,
  - **E** o e-mail avisa que faltam 3 dias para o fim do período de teste gratuito, convida a conhecer os planos disponíveis, e **não menciona cartão de crédito nem induz cobrança automática**.

- **CA-H099-06 (Aviso de encerramento do trial — Trial T0).**
  - **Dado** o término exato dos 14 dias de teste gratuito (`now >= ends_at`),
  - **Quando** o marco T0 do trial é processado,
  - **Então** é gerada notificação do tipo `acesso_trial_t0`, classe `lembrete`,
  - **E** o e-mail informa que o período de testes encerrou, que a descoberta de novos pedidos foi pausada, e orienta que para reativar o acesso basta escolher um plano pago na plataforma, sem criar qualquer débito.

- **CA-H099-07 (Descarte de lembrete de trial se o profissional já contratou plano pago).**
  - **Dado** um profissional em trial que, no 8º dia, optou por assinar um plano pago (`type = 'paid'`),
  - **E** `commercial_access` devolve `ativa`,
  - **Quando** o marco de T-3d do trial antigo atinge seu horário de disparo agendado,
  - **Então** a função de relevância detecta que o profissional já é assinante ativo, o item é descartado como `obsoleto` e o e-mail de lembrete de trial não é enviado.

- **CA-H099-08 (Descarte se o trial foi revogado administrativamente).**
  - **Dado** um profissional cujo trial foi revogado administrativamente (`status = 'revogada'`),
  - **Quando** qualquer job de lembrete de trial dispara,
  - **Então** a avaliação de relevância devolve `obsoleto` e nada é enviado.

### 7.3 Lembretes de Ciclo Pago (Profissional)

- **CA-H099-09 (Lembrete de ciclo pago T-3d para pagamento manual via Pix).**
  - **Dado** um profissional com assinatura ativa paga na modalidade manual (`billing.subscription.mode = 'manual'`),
  - **Quando** o relógio atinge `ends_at - interval '72 hours'`,
  - **Então** uma notificação `acesso_ciclo_t3d` é processada,
  - **E** o e-mail lembra que o período contratado encerra em 3 dias e convida a gerar o novo pagamento Pix com antecedência para não ter interrupção no serviço.

- **CA-H099-10 (Lembrete de ciclo pago para assinatura cancelada no fim do período).**
  - **Dado** um profissional que solicitou o cancelamento da assinatura (`cancel_at_period_end = true`),
  - **Quando** o lembrete de T-3d dispara,
  - **Então** o e-mail não menciona renovação automática nem gera cobrança, limitando-se a lembrar que o acesso estará disponível até a data limite programada.

- **CA-H099-11 (Aviso de fim de ciclo pago e entrada em carência de 72 h).**
  - **Dado** o término do período pago sem renovação detectada,
  - **Quando** o marco T0 dispara,
  - **Então** a notificação `acesso_ciclo_t0` é processada,
  - **E** o e-mail avisa que o ciclo encerrou e que o profissional entrou nas **72 horas de carência**, mantendo acesso total à descoberta e aos aceites durante esse intervalo de tolerância.

### 7.4 Idempotência, Cota, Degradação e Segurança

- **CA-H099-12 (Deduplicação de lembretes sob retries e concorrência).**
  - **Dado** a execução concorrente de múltiplos workers do tick ou reexecução após timeout de lease,
  - **Quando** tentam enfileirar ou enviar o mesmo marco temporal para o mesmo recurso,
  - **Então** a restrição única de `dedupe_key` impede inserções duplicadas em `ops.email_outbox`, garantindo exatamente uma entrega ao destinatário.

- **CA-H099-13 (Degradação por estouro de cota e expurgo de lembrete caduco).**
  - **Dado** o contador de e-mails do dia UTC atingindo 70 envios (corte da classe `lembrete`),
  - **Quando** um lembrete T-24h é processado,
  - **Então** ele é reagendado para o dia seguinte com estado `adiado_cota`,
  - **E** quando o novo dia UTC inicia, se o pedido já tiver ultrapassado `acceptance_deadline_at`, a reavaliação descarta o lembrete como `obsoleto` e não o dispara com atraso.

- **CA-H099-14 (Ausência total de dados pessoais sensíveis nos templates).**
  - **Dado** qualquer notificação de lembrete gerada pelo sistema,
  - **Quando** a linha do outbox e os parâmetros JSON são auditados,
  - **Então** nenhum endereço completo, telefone, e-mail de cliente, nome de concorrente ou dado financeiro sigiloso está presente no payload.

- **CA-H099-15 (Operação local sem envio externo e sem Docker).**
  - **Dado** o ambiente local de desenvolvimento,
  - **Quando** a suíte de testes de lembretes é executada,
  - **Então** todos os testes passam utilizando provedores simulados em memória, sem Docker, sem Mapbox e sem realizar requisições de rede para a internet.

---

## 8. Matriz de cenários de teste e cobertura

| ID | Cenário de Teste | Entidade Alvo | Condição Inicial / Fixture | Resultado Esperado | Critério de Aceite |
|---|---|---|---|---|---|
| **CT-01** | Lembrete T-24h em pedido aberto | Pedido | `published_at = now - 144h`, `status = 'publicado'` | Enfileira `prazo_t24`, estado `enviado`, template sem promessas | CA-H099-01 |
| **CT-02** | Vencimento T0 em pedido aberto | Pedido | `published_at = now - 168h`, `status = 'publicado'` | Enfileira `prazo_t0`, avisa encerramento e mantém conversas | CA-H099-02 |
| **CT-03** | T-24h em pedido já selecionado | Pedido | `published_at = now - 144h`, `status = 'selecionado'` | `isStillRelevant` descarta como `obsoleto`; outbox cancelado | CA-H099-03 |
| **CT-04** | T-24h em pedido já cancelado | Pedido | `published_at = now - 144h`, `status = 'cancelado'` | Descarta como `obsoleto`; nenhum e-mail enviado | CA-H099-04 |
| **CT-05** | T0 em pedido já concluído | Pedido | `published_at = now - 168h`, `status = 'concluido'` | Descarta como `obsoleto`; nenhum e-mail enviado | CA-H099-04 |
| **CT-06** | Lembrete Trial T-3d ativo | Trial | `starts_at = now - 264h` (11 d), sem concessão paga | Enfileira `acesso_trial_t3d`, sem menção a cartão/cobrança | CA-H099-05 |
| **CT-07** | Encerramento Trial T0 | Trial | `starts_at = now - 336h` (14 d), `ends_at = now` | Enfileira `acesso_trial_t0`, informa pausa sem cobrança | CA-H099-06 |
| **CT-08** | Trial T-3d para quem já pagou | Trial | Concessão trial em 11 d, mas existe concessão `paid` ativa | Descarta como `obsoleto`; nenhum lembrete de teste enviado | CA-H099-07 |
| **CT-09** | Trial T0 para trial revogado | Trial | `billing.access_grant.status = 'revogada'` | Descarta como `obsoleto`; nenhum e-mail enviado | CA-H099-08 |
| **CT-10** | Ciclo T-3d modalidade Pix | Ciclo | `subscription.mode = 'manual'`, `ends_at = now + 72h` | Enfileira `acesso_ciclo_t3d`, orienta emissão de novo Pix | CA-H099-09 |
| **CT-11** | Ciclo T-3d cancelado no fim | Ciclo | `subscription.cancel_at_period_end = true` | Enfileira aviso neutro de término em `ends_at`, sem renovação | CA-H099-10 |
| **CT-12** | Ciclo T0 e início de carência | Ciclo | `now = ends_at`, sem novo pagamento compensado | Enfileira `acesso_ciclo_t0`, destaca carência de 72 h | CA-H099-11 |
| **CT-13** | Duplo disparo do mesmo marco | Pedido/Trial | Chamadas simultâneas com a mesma `dedupe_key` | Exatamente 1 linha em `email_outbox` e 1 envio processado | CA-H099-12 |
| **CT-14** | Corte de cota diária (70/dia) | Quota | Uso do dia em 70/100 para classe `lembrete` | Linha fica `adiado_cota`; reavaliação no dia seguinte | CA-H099-13 |
| **CT-15** | Reavaliação pós-cota de item caduco | Pedido | Item T-24h adiado ontem, mas hoje o pedido já venceu | Descarta como `obsoleto`; lembrete atrasado não é enviado | CA-H099-13 |
| **CT-16** | Proibição de PII nos parâmetros | Segurança | Tentativa de incluir texto livre ou telefone em params | `assertSafeTemplateParams` lança erro e recusa gravação | CA-H099-14 |
| **CT-17** | Ausência de interruptores de e-mail | Governança | Varredura estática de rotas e banco procurando flags | 100% em conformidade com decisão 27 e PRD RF-122 | CA-H099-15 |
| **CT-18** | Reavaliação de titular excluído | Titular | Cliente com caso de eliminação LGPD concluído | Descarta como `destinatario_invalido`; não vaza dados | CA-H099-03 |
| **CT-19** | Prova com relógio injetado | Tempo | Avanço determinístico de tempo via `FakeClock` | Comportamento temporal idêntico e reprodutível | CA-H099-16 |
| **CT-20** | Execução sem rede e sem Docker | Infra | Execução dos testes em ambiente isolado | Todos os testes de unidade e banco passam localmente | CA-H099-15 |

---

## 9. Dependências

Estado real conferido em `docs/factory/quadro-status.md` e no código:

1. **Dependências Concluídas que habilitam o início imediato:**
   - **H-092 (#102 — Pipeline de notificações e cooldown):** `Concluído`. Tabela `ops.email_outbox`, classes de prioridade (`auth`, `critico`, `digest`, `lembrete`), registro de regras e rotinas de envio entregues.
   - **H-008 (#21 — Tick de jobs):** `Concluído`. Mecanismo de execução assíncrona por lease, `ops.job`, integrável aos agendamentos temporais.
   - **H-044 (#57 — Trial de 14 dias):** `Concluído`. Ativação de trial pelo profissional, gravação em `billing.access_grant` com `ends_at = starts_at + 14 days`.
   - **H-045 (#58 — Acesso comercial derivado):** `Concluído`. Função estável `private.commercial_access(p_professional_id, p_at)`.
   - **H-031 (#44 — Publicação idempotente com 7 dias):** `Concluído`. Tabela `app.service_request` com colunas `published_at`, `acceptance_deadline_at` e `status`.
   - **H-093 (#103) e H-094 (#104):** `Concluído`. Porta de envio e controle de cota com limites diários e mensais.
   - **H-042 (#55 — Guarda de elegibilidade):** `Concluído`.
2. **Dependências Pendentes no Backlog e impacto no término:**
   - **H-047 (#60), H-048 (#61), H-049 (#62), H-050 (#63):** `Backlog`. São as histórias de checkout, webhook, concessão paga e carência de pagamento no Mercado Pago.
   - **Impacto Explícito:** H-099 **pode ser desenvolvida e testada agora** nas fatias de Lembretes de Prazo (T-24h e T0) e Lembretes de Trial (T-3d e T0). A fatia de Ciclo Pago terá suas regras de domínio e testes com dados sintéticos entregues nesta história, mas sua integração E2E com webhooks do gateway Mercado Pago só poderá ser dada como concluída de ponta a ponta após a conclusão das Issues #60 a #63.
   - **H-074 (#84 Seleção) e H-077 (#87 Cancelamento):** `Backlog`. O teste de recheque de estado (`status = 'selecionado'` ou `'cancelado'`) é executado sobre a coluna de status que já existe no banco (`app.service_request.status`), sem depender da UI dessas histórias.
3. **Bloqueios Jurídicos Externos:**
   - `BLQ-JUR L2` e `L3`: incidem sobre a redação definitiva de avisos de cobrança futura e política de renovação para assinaturas pagas. O trial não sofre desse bloqueio.

---

## 10. Riscos e mitigações

- **R1. Risco de induzir o profissional a acreditar que o teste grátis será cobrado.** Se o e-mail de trial usar termos ambíguos de cobrança, gerará insatisfação e atrito legal.
  *Mitigação:* Regra estrita de produto (RN-H099-04). O template de trial enfatiza que o teste é 100% gratuito, sem cartão cadastrado e sem renovação automática.
- **R2. Envio de lembrete de prazo para pedido que o cliente já resolveu (selecionou ou cancelou).** Causaria impressão de desorganização do sistema se o cliente recebesse "faltam 24 h" após já ter contratado um profissional.
  *Mitigação:* Recheque obrigatório em `isStillRelevant` no exato momento do processamento da linha de envio (RN-H099-01). Se o status não for `publicado`, o item é descartado silenciosamente.
- **R3. Envio de lembretes obsoletos acumulados após o restabelecimento da cota diária.** Lembretes adiados por cota (acima de 70 no dia UTC) poderiam sair 24 h depois, quando o prazo do pedido já expirou.
  *Mitigação:* Reavaliação mandatória na liberação de cota. Lembretes cujo marco temporal já prescreveu são finalizados com motivo `obsoleto` e nunca enviados com atraso (RN-H099-07).
- **R4. Duplicação de e-mails de lembrete por concorrência de instâncias de tick.** O tick oportunista (C) rodando em paralelo ao tick agendado (A) poderia disparar o mesmo marco duas vezes.
  *Mitigação:* Deduplicação no banco por chave determinística única (`dedupe_key`) em `ops.email_outbox` e exclusão mútua por lease em `ops.job` (RN-H099-06).
- **R5. Disparo de e-mails para titulares que solicitaram eliminação de conta (LGPD/DSR).** Violação de privacidade se o sistema enviar lembretes a titulares em anonimização.
  *Mitigação:* O validador de relevância checa se o titular está com conta encerrada ou anonimizada, descartando com motivo `destinatario_invalido` (CA-H099-18).
- **R6. Vazamento de dados de concorrentes ou de detalhes do serviço no e-mail.** Envio de dados pessoais ou nomes de outros participantes.
  *Mitigação:* Blindagem total de parâmetros (RN-H099-08) e aplicação compulsória de `assertSafeTemplateParams`.
- **R7. Falha de disparo caso o agendador pg_cron fique inativo em homologação.**
  *Mitigação:* Contingência ativa pelo Tick Oportunista C (executado a cada requisição na API com intervalo mínimo de 60 s) e pelo job periódico de varredura.
- **R8. Bloqueio de desenvolvimento devido a pendências de gateway de pagamento.**
  *Mitigação:* Fatiamento claro da história. A entrega inicial cobre integralmente os prazos de pedidos e o trial; as regras de ciclo pago utilizam fixtures de concessão `paid` já suportadas pelo schema `billing.access_grant`.

---

## 11. Perguntas ao líder

Lista única numerada de **870 a 889** (faixa de 20 perguntas reservada para a Issue #109, sucedendo as perguntas 850 a 869 de H-058). Cada item contém alternativas e a recomendação do PO para adoção pelo líder.

**870. Mecanismo de disparo dos marcos temporais (Jobs agendados vs Varredura periódica).**
Como os marcos de T-24h, T0 de pedidos, T-3d e T0 de trial/ciclo devem ser detectados no banco?
- (a) Jobs agendados pontualmente no ato da criação do evento (ex.: `ops.job` criado com `run_at = published_at + 144h`), complementados por uma varredura periódica leve (ex.: horária) de contingência para capturar eventuais órfãos.
- (b) Apenas por varredura periódica horária que executa `SELECT` procurando registros na janela temporal.
- **Recomendação:** (a). Garante pontualidade exata nos envios, aproveita a infraestrutura de `ops.job` já concluída em H-008 e usa a varredura apenas como garantia contra falhas de agendamento. Destrava o desenho de banco da Arquitetura.

**871. Tolerância de atraso na entrega de lembretes (Janela de obsolescência).**
Qual a tolerância máxima aceitável de atraso para o envio de um lembrete T-24h antes que ele seja considerado obsoleto e descartado?
- (a) 6 horas: se o lembrete T-24h for processado com mais de 6 horas de atraso em relação ao horário previsto (isto é, restando menos de 18 horas para o fim dos aceites), ele ainda é enviado; se o atraso exceder 6 horas ou o pedido já tiver vencido, é descartado.
- (b) 2 horas: tolerância curta e rígida.
- **Recomendação:** (a). Em caso de estresse de cota noturna do Resend que adie o lembrete para a virada do dia UTC seguinte, 6 horas permite que o cliente ainda receba o aviso pela manhã antes do vencimento final.

**872. Destinatários do aviso de vencimento T0 do pedido de serviço.**
No momento em que o prazo de 7 dias de admissão de aceites encerra (T0), quem deve receber o e-mail informativo?
- (a) Apenas o cliente dono do pedido (`customer_user_id`), informando que o prazo de aceites encerrou e que suas conversas permanecem ativas para seleção.
- (b) O cliente e também todos os profissionais que já realizaram aceite no pedido.
- **Recomendação:** (a). Em conformidade com o PRD RF-073 e RF-119, o aviso de expiração é direcionado ao dono do pedido. Os profissionais participantes mantêm acesso natural à conversa no chat sem necessidade de consumir a cota com e-mails redundantes.

**873. Comportamento do aviso T0 quando o pedido encerra com ZERO aceites.**
O que o e-mail de vencimento T0 deve orientar ao cliente caso nenhum profissional tenha aceitado o pedido durante os 7 dias?
- (a) O template deve identificar genericamente que o prazo encerrou e sugerir revisar o pedido (descrição, urgência ou fotos) para uma futura republicação, sem prometer resultados ou citar números.
- (b) O e-mail não deve ser enviado se houver zero aceites.
- **Recomendação:** (a). O cliente precisa ser informado de que o pedido expirou e não receberá novos contatos, orientando-o sobre o que fazer em seguida, cumprindo RF-119 ("sem prometer aceites").

**874. Padrão de chave única (`dedupe_key`) para lembretes de prazo.**
Qual formato canônico deve ser adotado para a coluna `dedupe_key` em `ops.email_outbox` para os lembretes de prazo do pedido?
- (a) `req:prazo_t24:<request_id>` e `req:prazo_t0:<request_id>` — simples, legível e determinístico.
- (b) Hash SHA-256 da concatenação de pedido e evento.
- **Recomendação:** (a). Alinha-se diretamente ao padrão definido em `08-ARQUITETURA.md` §12.4 (`(request, 'T-24h')` e `(request, 'T0')`), facilita inspeção e auditoria no banco.

**875. Padrão de chave única (`dedupe_key`) para lembretes de trial.**
Qual formato canônico deve ser adotado para os lembretes de teste gratuito?
- (a) `trial:t3d:<grant_id>` e `trial:t0:<grant_id>` (usando o UUID imutável da concessão em `billing.access_grant`).
- (b) `trial:t3d:<identity_id>`.
- **Recomendação:** (a). Como a concessão de trial é única por identidade (índice único em `identity_id`), o `grant_id` identifica unicamente o ciclo do trial e respeita a blindagem de não expor `identity_id` fora da camada de banco.

**876. Padrão de chave única (`dedupe_key`) para lembretes de ciclo pago.**
Qual formato canônico deve ser adotado para os lembretes de ciclo de assinatura?
- (a) `ciclo:t3d:<grant_id>` e `ciclo:t0:<grant_id>` (amarrado à concessão de pagamento vigente).
- (b) `ciclo:t3d:<subscription_id>:<data>`.
- **Recomendação:** (a). Cada concessão paga em `billing.access_grant` possui datas de início e fim imutáveis; amarrar ao `grant_id` garante unicidade de ciclo sem risco de duplicatas em renovações.

**877. Revalidação de elegibilidade cadastral do profissional no disparo do trial.**
Se um profissional em trial for suspenso por violação de segurança ou conduta antes do disparo do lembrete T-3d do trial, como o processador deve agir?
- (a) `isStillRelevant` descarta o item com motivo `destinatario_invalido` e nenhum e-mail é enviado.
- (b) O e-mail é enviado informando a suspensão.
- **Recomendação:** (a). A suspensão de conta possui seu próprio fluxo de notificação crítica; lembretes comerciais ou de teste não devem ser enviados a usuários suspensos.

**878. Momento de descarte do lembrete de trial se houver contratação de plano pago.**
Se o profissional contratar um plano mensal enquanto estiver no 5º dia de trial, o agendamento de T-3d do trial deve ser apagado ou resolvido no disparo?
- (a) Resolvido no disparo: o job permanece, mas ao executar, a regra consulta `commercial_access`; ao constatar estado `ativa`, descarta como `obsoleto` e encerra a linha sem envio.
- (b) Deletar fisicamente o job agendado no momento em que o webhook do pagamento aprovar a concessão paga.
- **Recomendação:** (a). Alinha-se ao princípio P4 (tempo e relevância resolvidos no uso) e evita acoplamento reverso entre o módulo financeiro e a tabela de jobs de notificação.

**879. Conteúdo de texto do lembrete de Trial T-3d em relação à gratuidade.**
Como garantir a total blindagem contra alegação de indução a cobrança no e-mail de Trial T-3d?
- (a) O texto deve conter mensagem explícita e em destaque: "Seu teste de 14 dias é 100% gratuito e não possui renovação automática. Ao final do período, você decide se deseja contratar um plano para continuar recebendo novos pedidos."
- (b) Texto genérico sem menção a gratuidade.
- **Recomendação:** (a). Cumpre integralmente o PRD RF-057, Critério de Aceite FA-005 e previne atritos com órgãos de defesa do consumidor.

**880. Tratamento de lembrete de ciclo pago T-3d para assinatura cancelada.**
Se a assinatura estiver marcada com `cancel_at_period_end = true` no instante do lembrete T-3d de ciclo:
- (a) O template deve ser uma variação neutra que informa que o acesso comercial encerrará na data prevista conforme solicitado, agradecendo o período e informando que a reativação poderá ser feita a qualquer momento.
- (b) Não enviar nenhum lembrete nesse caso.
- **Recomendação:** (a). A transparência da data final de serviço é boa prática e evita surpresas ao profissional, sem oferecer cobrança indevida.

**881. Tratamento do e-mail de Ciclo T0 (Entrada em Carência de 72 h).**
Qual deve ser o tom e o conteúdo central do e-mail de término de ciclo sem pagamento identificado?
- (a) Notificar que o ciclo venceu e que o profissional está no período de carência de 72 horas, durante o qual pode continuar descobrindo e aceitando trabalhos normalmente enquanto regulariza o pagamento.
- (b) Notificar imediatamente que o acesso foi bloqueado.
- **Recomendação:** (a). Cumpre o requisito de negócio H5 e a regra de carência de 72 h (RF-059, FA-006, I-25), reforçando a confiança do parceiro.

**882. Prioridade de fila e desempate para lembretes adiados por cota.**
Quando houver liberação de cota diária (virada do dia UTC), qual a ordem de reavaliação entre múltiplos lembretes da classe `lembrete`?
- (a) Ordem cronológica da criação original (`created_at` crescente), respeitando o comparador `comparePriority` existente no domínio.
- (b) Lembretes de clientes antes de lembretes de profissionais.
- **Recomendação:** (a). O comparador já está padronizado e testado em `packages/domain/src/notifications/priority.ts`, mantendo simplicidade e justiça cronológica.

**883. Criação de novos tipos no enum/allowlist de políticas de e-mail.**
Para diferenciar com clareza os templates de 3 dias antes dos avisos de término imediato no trial e ciclo, devem ser criados novos tipos em `EMAIL_TYPE_POLICY`?
- (a) Sim: registrar formalmente `acesso_trial_t3d`, `acesso_trial_t0`, `acesso_ciclo_t3d` e `acesso_ciclo_t0` em `policy.ts`, todos com categoria `acesso`, classe `lembrete` e `params: []`.
- (b) Manter apenas `acesso_trial` e `acesso_ciclo` genéricos e usar um parâmetro interno para diferenciar.
- **Recomendação:** (a). Tipos explícitos facilitam o controle de políticas, métricas de observabilidade por tipo de e-mail e simplificam o template no provedor sem violar a guarda de parâmetros.

**884. Política de reenvio em caso de erro temporário do provedor Resend.**
Quantas tentativas de reenvio (`MAX_SEND_ATTEMPTS`) devem ser permitidas para lembretes que falharem por instabilidade de rede ou 503 do provedor?
- (a) Até 8 tentativas com recuo exponencial (padrão já configurado em `notifications.ts`), desde que o item continue relevante em cada nova tentativa.
- (b) Apenas 2 tentativas, desistindo em seguida.
- **Recomendação:** (a). O mecanismo de `processOutbox` já reavalia a relevância (`isStillRelevant`) a cada claim, evitando envio de itens que tenham ficado obsoletos durante os retries.

**885. Registro de auditoria para descarte de lembretes obsoletos.**
O descarte de um item de notificação obsoleto deve gerar evento na tabela de auditoria `audit.audit_event`?
- (a) Não: o motivo do descarte fica registrado na própria linha em `ops.notification_item (state = 'descartado', discard_reason = 'obsoleto')` e em `ops.email_outbox`, sem inflar a trilha de auditoria append-only de governança.
- (b) Sim: gravar um `audit_event` para cada descarte.
- **Recomendação:** (a). Em alinhamento com a arquitetura de observabilidade (§14), eventos operacionais de mensageria residem nas tabelas do schema `ops`, reservando `audit` para ações de governança e intervenções humanas.

**886. Tratamento de múltiplos pedidos do mesmo cliente atingindo T-24h juntos.**
Se um cliente tiver publicado 2 pedidos no mesmo horário e ambos atingirem T-24h juntos:
- (a) Cada pedido gera seu próprio e-mail de lembrete com seu respectivo `request_ref`, pois a classe `lembrete` não possui agrupamento digest de 15 min (apenas `aceite` e `mensagem` agrupam conforme RF-118).
- (b) Agrupar os pedidos em um único e-mail resumo.
- **Recomendação:** (a). Pelo desenho oficial (`08` §12.3 e `policy.ts`), apenas as categorias `aceite` e `mensagem` possuem mecanismo digest de cooldown; lembretes de pedidos são eventos independentes e pontuais por pedido.

**887. Teste de ausência de interruptores de e-mail na suíte de H-099.**
A suíte de testes de H-099 deve incluir asserção estática garantindo que não há chaves de configuração do tipo "desativar_lembretes" no código ou banco?
- (a) Sim: teste estático e de integração assegurando que nenhum ponto do código ou do `ops.app_config` condiciona o envio a chaves de ativação manual, em conformidade com o teste N-07 e a decisão 27.
- (b) Não é necessário testar ausência.
- **Recomendação:** (a). Garante a blindagem mandatória contra a regressão do interruptor revogado na decisão 27.

**888. Estratégia de dados sintéticos para testes de avanço temporal.**
Como deve ser estruturada a prova de avanço de 6 e 7 dias para pedidos e de 11 e 14 dias para o trial nos testes automatizados?
- (a) Utilização de `FakeClock` no domínio e injeção do parâmetro `p_now` nas funções de banco em transações com rollback imediato, sem sleeps reais de relógio e sem persistir resíduos no banco.
- (b) Aguardar tempo real no teste.
- **Recomendação:** (a). Torna a suíte de testes ultrarrápida, determinística, livre de dependências de relógio de sistema e atende à regra de preservação do banco de desenvolvimento.

**889. Condição formal de início do Desenvolvimento da Issue #109 (H-099).**
A Issue #109 pode avançar para a coluna Arquitetura e posterior Desenvolvimento imediatamente após este refino?
- (a) Sim: todas as dependências funcionais de infraestrutura (#102, #21, #57, #44) estão Concluídas no quadro. O desenvolvimento pode implementar a fatia completa de prazos de pedidos e de trial, deixando os contratos de ciclo pago integrados com dados sintéticos até a conclusão das Issues de pagamento (#60 a #63).
- (b) Não: aguardar a conclusão de todas as Issues de pagamento do Backlog.
- **Recomendação:** (a). Desbloqueia o progresso do épico E11 (Notificações) e entrega imediatamente valor de negócio na retenção de clientes e conversão de trial.

---

## 12. Próximos passos

1. **Apresentação ao Líder (Orquestrador):** submissão deste documento (`docs/factory/159-REFINO-H099.md`) ao líder da fábrica para revisão de conformidade e consolidação das respostas às perguntas **870 a 889** na próxima rodada oficial de decisões (`11-DECISOES.md`).
2. **Permanência na Coluna:** o cartão da Issue #109 permanece na coluna **Product Owner** do quadro local até que o líder execute a transição para **Arquitetura**.
3. **Desenho Técnico (Software Architect):**
   - Especificação dos jobs do tick para agendamento dos marcos temporais;
   - Atualização do arquivo `packages/domain/src/notifications/policy.ts` com os novos tipos explícitos (`acesso_trial_t3d`, `acesso_trial_t0`, `acesso_ciclo_t3d`, `acesso_ciclo_t0`);
   - Mapeamento das regras de resolução e classes de revalidação de relevância (`isStillRelevant`);
   - Desenho do plano de testes com dados sintéticos e relógio controlado.
4. **Alinhamento com a Fábrica:** manutenção da premissa de desenvolvimento estritamente local (sem Docker, sem Mapbox, sem e-mail real para o público e sem backup de banco).
