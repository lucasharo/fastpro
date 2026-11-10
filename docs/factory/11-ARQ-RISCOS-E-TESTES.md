# FastPro — Invariantes, contratos, riscos e plano de testes de arquitetura

- **Etapa:** architecture · **Data:** 2026-11-09 · **Papel:** Software Architect · **Status:** rascunho para validação humana (revisão 2)

## Histórico de mudanças
### Revisão 6 — 2026-11-10 (Rodada 14 nº 31 e 32; Revisão 5 do PO)
- **Fotos do pedido (decisão 31):** reduzidas **no envio** para ≈ **0,5 MB** e **no máximo 1.280 px**, **5 por pedido** (≈ 2,5 MB/pedido; ≈ 280 pedidos em ≈ 700 MB de Storage). **Só a versão reduzida é guardada**: o original e qualquer *master* maior nunca são persistidos. Supera o alvo "1–2 MB" da revisão 5.
- **Chat somente texto (decisões 32 e 33):** nenhum anexo, nem imagem nem PDF. **Removidos:** bucket `chat-attachments`, tabela `message_attachment`, validação por conteúdo e antimalware de anexos do chat, URLs assinadas e limites (5 × 10 MB) de anexo, miniatura e marca d'água do chat, e os riscos/testes de PDF do chat. A API **rejeita qualquer anexo** no chat. EXIF só se aplica às fotos do pedido.
- **Fotos extras** só via WhatsApp com opt-in (inalterado). **AMB-32 (PDF no chat) fica superada** pela decisão 33. **SD-12** (antivírus) é reduzida: sem anexos no chat, resta apenas o risco menor dos documentos de verificação (acesso só da Verificação).
- **Storage passa a ter apenas fotos do pedido e documentos de verificação de identidade**; estimativas refeitas (09 §9). O **egress de fotos (5 GB/mês)** segue como limite mais apertado.

- **Testes (revisão 6):** T-07 reescrito; P-03..P-06 (foto ≤ 1.280 px e ≈ 0,5 MB, só versão reduzida, 6ª recusada, marca d'água sobre a reduzida); **M-01/M-02 (chat sem anexos: a API rejeita qualquer anexo; nada de bucket/rota/tabela de anexo)**; Q-12/Q-13 recalibrados. Invariantes I-29 ajustada e I-30 nova. Removidos os testes e o risco de PDF do chat (R-07 reduzido).

### Revisão 5 — 2026-11-10 (Rodada 13 nº 28–30; doc 13)
- **Riscos:** R-04 (Mapbox) reescrito com o fato verificado (permanente pago); R-28 e R-30 verificados (Hobby não comercial; cron 1x/dia); R-06 (MP) com tarifas não obtidas; novos **R-35** (Storage 1 GB com 5 fotos), **R-36** (custo/cartão Mapbox), **R-37** (egress de fotos), **R-38** (PostGIS/`pg_cron`/`pg_net` não encontrados no Free).
- **Invariantes:** novas I-28 (coordenada só de geocodificação permanente) e I-29 (≤ 5 fotos por pedido). **Testes novos:** G-01..G-07 (geocodificação), P-01..P-03 (fotos), Q-12..Q-14 (Storage, egress, tick sem cron), F-05 atualizado, T-09/§4.1 com tópicos do MP.
- **Spikes:** S-02, S-03, S-04, S-09, S-10 atualizados com o que o doc 13 verificou e o que segue em aberto.

### Revisão 4 — 2026-11-09 (Rodada 12 nº 27)
- **Testes N-01..N-10 reescritos:** e-mail habilitado **enfileira e envia pelo `EmailProviderPort`** (Mailpit em dev); sem interruptor e sem reenvio de antigos; cota do Resend (100/dia UTC, 3.000/mês, por destinatário, 10 req/s), contador/alertas, reserva para `auth`, agrupamento de 15 min e degradação (Q-10, Q-11). I-23/I-24/I-27 reescritas; R-27 e R-33 revistos; novo R-34 (cota). Os testes de "e-mail desativado" e do "ponto de ativação" (revisão 3) foram removidos.

### Revisão 3 — 2026-11-09 (Rodadas 8 e 9; trecho de e-mail desativado SUPERADO pela revisão 4)
- **Removidos** o endpoint/permissão/auditoria de flag e os testes de interruptor (antigos N-01..N-08). **Novos N-01..N-08:** e-mail de aviso desativado **não enfileira e não envia**; ponto único de ativação documentado e exercitado só em teste; sem reenvio de aceites antigos; link mágico sempre ativo.
- I-23/I-24 reescritas; R-27 e R-32 ajustados; B-03 segue a decisão do período (fim do anterior). Mensagem automática do aceite com texto fixo "Estou disponível para trabalhar".

### Revisão 2 — 2026-11-09 (Rodadas 5, 6 e 7; T6, T8)
- **Invariantes:** I-01..I-06 reescritas para aceite (sem oferta); I-03 vira "um aceite ⇒ uma conversa ⇒ uma mensagem de sistema"; novas **I-22..I-27** (retirada mantém a vaga, interruptores de e-mail, sem boleto/carência 72 h, sem campos de preço, `auth_*` travados, e-mail de teste redirecionado).
- **Contratos:** `POST /requests/{id}/acceptances`, `POST /requests/{id}/acceptances/me/withdraw`, `POST /requests/{id}/second-wave` (rótulo "Chamar mais profissionais"), (revogado na revisão 3) `PUT /admin/notification-flags/{type}`. Removido `PUT …/offer`. Eventos `WorkAccepted`/`AcceptanceWithdrawn` no lugar de `ParticipationCreated`/`Offer*`.
- **Riscos:** R-12 extinto (H4); R-08/R-10/R-11 revistos para Vercel e H3; novos **R-26..R-33** (aceite abusivo, cliente sem aviso, termos da Vercel, NestJS serverless, cron, mídia em serverless, backup manual, domínio/Resend).
- **Spikes:** S-03 sem boleto; novos **S-09** (NestJS na Vercel), **S-10** (agendador do tick), **S-11** (Resend: domínio, cota, SMTP do Supabase Auth, modo de teste). Leitura de documentação só quando autorizada (Rodada 7, nº 12): tudo `[NÃO VERIFICADO]`.
- **Testes:** corrida de aceites (nunca 9) C-01/C-02/C-04b/C-17; idempotência da mensagem de sistema C-16/F-10; e-mail desativado não enfileira/não envia N-01..N-10; carência 72 h com Pix B-01..B-10; e-mail local em dev e **redirecionamento único do Resend em modo de teste (T8)** N-09/N-10; Q-08..Q-10.
- **Segredos:** este documento cita apenas **nomes** de variáveis (ex.: `RESEND_API_KEY`, `EMAIL_TEST_REDIRECT_TO`, `EMAIL_PROVIDER`, `TICK_SECRET`), nunca valores.
- **Natureza:** planejamento. **Nenhum teste foi executado**; nenhuma evidência é afirmada. Contratos em **nível lógico** (não OpenAPI final).
- **Etiquetas:** `[APROVADO]` `[DELEGADO]` `[PROPOSTA]` `[NÃO VERIFICADO]` `[PENDENTE JURÍDICO]`
- **Relacionados:** `08-ARQUITETURA.md`, `09-MODELO-DADOS.md`, `10-ADRS.md`, `05-CRITERIOS-ACEITE.md`.
- Dados de teste: **exclusivamente sintéticos** (RF-163). Ambiente de teste: local/efêmero (Postgres com PostGIS); nenhum serviço externo real.

---

## 1. Invariantes transacionais
Cada invariante tem (a) onde é imposta, (b) como é verificada continuamente. "Monitor" = consulta SQL que deve retornar zero linhas, executável por job de verificação e em CI após testes.

| ID | Invariante | Imposta por | Verificação | FA |
|---|---|---|---|---|
| I-01 | Aceites por pedido ≤ 4 se `wave2_opened_at` nulo; ≤ 8 sempre; `acceptances_count` = linhas de `acceptance` | lock + `slot_no` 1..8 + únicos + trigger (`slot_no>4` exige onda 2) | monitor + corrida C-01/C-02 (**nunca 9**) | FA-010, FA-035 |
| I-02 | Um profissional e uma identidade (CPF/CNPJ) ocupam no máximo um aceite por pedido (regra única, vale após retirada) | únicos `(request, professional)` e `(request, identity)` | monitor + C-03 | FA-011 |
| I-03 | Cada aceite tem exatamente 1 conversa e exatamente 1 mensagem de sistema `aceite` (e no máximo 1 `aceite_retirado`); não existe entidade de oferta | `conversation.acceptance_id` único + `dedupe_key` única + transação única | monitor (join) + C-16, F-10 | FA-011, FA-029 |
| I-04 | No máximo uma seleção ativa por pedido; seleção refere aceite `ativo` do mesmo pedido | único parcial + FK composta + checagem sob lock | monitor + C-05, C-17 | FA-013..015 |
| I-05 | Aceite só com `status='publicado' AND now() < acceptance_deadline_at` | verificação sob lock + trigger de inserção | teste de limite temporal C-06 | FA-012, FA-014 |
| I-06 | `wave2_opened_at` definido no máximo uma vez, só com `acceptances_count >= 4` e admissão aberta; nunca anulado | `UPDATE … WHERE wave2_opened_at IS NULL AND …` + trigger (imutável) | C-04, C-04b | FA-010 |
| I-07 | `acceptance_deadline_at` imutável; nunca estendido por qualquer evento | trigger bloqueia UPDATE | monitor | FA-012, FA-024 |
| I-08 | Conclusão exige seleção ativa e ator cliente; no máximo uma conclusão não revertida | único parcial + checagem | C-07 | FA-017 |
| I-09 | Avaliação: uma por pedido; exige conclusão não revertida e profissional = selecionado | único + trigger | C-08 | FA-019 |
| I-10 | No máximo uma republicação ativa (`publicado|selecionado`) por cadeia | único parcial + lock na cadeia | C-09 | FA-022 |
| I-11 | "Cancelar republicação + selecionar no original" é tudo-ou-nada | transação única + idempotência | C-10, F-02 | FA-023 |
| I-12 | Conversa única por `(pedido, profissional)`; mensagem só em conversa `ativa` sem restrição e por membro | único + trigger | teste de API e DB | FA-009, FA-028 |
| I-13 | Mensagem idempotente por `(conversa, remetente, client_message_id)`; sem UPDATE/DELETE pela aplicação | único + trigger | teste de retry | FA-026, FA-028 |
| I-14 | Pagamento idempotente: `provider_payment_id` único; acesso derivado de concessões; **trial único por identidade**; fim de trial não cria assinatura nem cobrança | únicos + ausência de agendamento de cobrança | C-11, B-01..B-06 | FA-005, FA-006 |
| I-15 | Escrita de auditoria na mesma transação da ação crítica; `audit_event` append-only | transação + privilégios + trigger | teste: falha após ação ⇒ sem ação sem auditoria | FA-031 |
| I-16 | Nenhuma consulta voltada a profissional retorna e-mail do cliente; telefone só com consentimento ativo + participação; endereço exato só com `address_share` | views sem coluna + RLS + teste de contrato | T-02, T-03, T-05, T-06 | FA-030 |
| I-17 | Admissão nunca volta de `encerrado` para `aberto` (correção de conclusão, desistência, troca não reabrem) | admissão derivada de `status='publicado'` | C-07, teste de regressão | FA-014, FA-018 |
| I-18 | Aprovador de estorno > R$ 200,00 ≠ solicitante; dois aprovadores distintos; R$ 200,00 exato = uma aprovação | triggers `approval_vote` | teste dedicado | FA-032 |
| I-19 | Profissional não participa do próprio pedido (`app_user` igual) | trigger | teste | FA-009 |
| I-20 | Concessão de acesso é idempotente e monotônica: reprocessar eventos em qualquer ordem não reduz acesso nem duplica período | livro de concessões + chave de pagamento | B-05, B-06 | FA-006 |
| I-21 | Contadores derivados (`acceptances_count`, médias) = recontagem | rotina de consistência | monitor diário | FA-010 |
| I-22 | Retirar aceite **não** libera vaga: `slot_no` e `acceptances_count` inalterados; `DELETE` de `acceptance` negado; conversa do aceite retirado sempre `somente_leitura` | trigger + recompute | monitor + C-17 | FA-010, FA-011 |
| I-23 | Todo evento com e-mail previsto gera linha em `email_outbox` (com `dedupe_key`) e envio pelo `EmailProviderPort`; **não existe** interruptor, tabela de flags, rota ou ponto de ativação; **não existe** rotina de reenvio de aceites/mensagens antigos | manipuladores sempre registrados + ausência de backfill | N-01..N-05, N-07 | FA-029 |
| I-24 | Cota do provedor: contagem **por destinatário** em `external_quota(email)`; acima do limiar só `auth` (e crítico) passam; `auth` nunca é descartado por política; a mensagem automática no chat independe do e-mail | contador + prioridade + reserva | N-08, Q-01, Q-11 | FA-003, FA-029 |
| I-25 | `payment.method ∈ {cartao, pix}`; boleto inexistente; carência de 72 h = `period_end + 72 h` para pago sem `cancel_at_period_end`; trial sem carência | CHECK + função `commercial_access` | B-01..B-10 | FA-006 |
| I-26 | Nenhuma tabela de pedido/aceite/mensagem guarda preço, prazo ou valor do serviço; sem campos extras no aceite | revisão de esquema (teste de catálogo) + 422 | T-17 | FA-011 |
| I-27 | Em dev/CI todo e-mail vai ao **Mailpit local** (nenhum envio externo); envio real só com domínio verificado e segredo presente | adapter por ambiente (`EMAIL_PROVIDER`) | N-09, N-10 | FA-029 |
| I-28 | Toda coordenada persistida (`exact_point`, `base_point`) vem de geocodificação `permanent=true`; nenhum resultado temporário é gravado, em cache ou em log; no máximo 3 chamadas permanentes por rascunho | CHECK `geocode_mode` + única função de persistência + teto | G-01..G-04 | FA-001, FA-007 |
| I-29 | No máximo 5 fotos por pedido/rascunho; cada uma persistida **só em versão reduzida** (≤ 1.280 px, bytes ≤ teto); sem original/*master* no Storage; a 6ª é recusada | trigger + CHECK + 422 `photo_limit` | P-01..P-05 | FA-001, FA-007 |
| I-30 | O chat é somente texto: nenhum anexo (imagem ou PDF) existe em mensagem; não há bucket, tabela, URL assinada, miniatura nem marca d'água de chat | a API rejeita qualquer anexo + ausência de tabela/bucket | M-01, M-02 | FA-027, FA-028 |

---

## 2. Contratos de API (nível lógico)

### 2.1 Convenções [PROPOSTA]
- REST/JSON, `/v1`, contrato em OpenAPI gerado de `packages/contracts`.
- Autenticação: cookie HttpOnly `SameSite=Lax` (web) ou Bearer (mobile futuro); proteção CSRF por verificação de `Origin` e token em rotas mutáveis.
- Erros: `application/problem+json` com `code` estável (ex.: `no_slot`, `admission_closed`, `step_up_required`, `idempotency_conflict`, `version_mismatch`). Recurso de terceiro ⇒ **404** (não 403). Mensagens sem contadores, sem existência de e-mail.
- `Idempotency-Key` obrigatório nas operações da tabela (coluna Idem).
- Paginação por cursor. Rate limit com cabeçalhos `RateLimit-*` e `Retry-After`.
- Códigos de status: 200/201 (efeito ou repetição idempotente), 202 (assíncrono), 409 (conflito de estado/versão), 422 (validação), 429 (limite).

### 2.2 Catálogo de operações
| Operação | Método/caminho | Ator | Idem | Pré-condições principais | Efeitos / eventos | Erros relevantes |
|---|---|---|---|---|---|---|
| Buscar serviços | GET `/catalog/search?q=` | público | — | rate limit | — | 429 |
| Cobertura | GET `/coverage?service&place` | público (rate limit) | — | — | resposta booleana | 429 |
| Sugestões de endereço | (Mapbox direto no navegador) | público | — | token restrito | — | cota |
| Criar/atualizar rascunho | POST/PATCH `/drafts` | visitante (nonce) | sim | TTL | — | 422 |
| Upload de mídia | POST `/media/uploads` → PUT URL → POST `/media/{id}/finalize` | dono | sim | tipo/tamanho/cota | `MediaReady`/`MediaRejected` | 413/415/422 |
| Iniciar desafio | POST `/auth/challenges` | público | — | rate limit | e-mail de login (resposta uniforme 202) | 429 |
| Consumir desafio | POST `/auth/challenges/consume` | público | — | token/código válidos | cria sessão | 401 uniforme |
| Step-up | POST `/auth/step-up` | autenticado | — | sessão | atualiza `recent_auth_at` | 429 |
| Revisar pedido | GET `/drafts/{id}/review` | cliente | — | e-mail verificado | aviso de duplicidade/cobertura | — |
| **Publicar** | POST `/requests` | cliente | **sim** | revisão e confirmação expressa | `RequestPublished`; agenda jobs T-24h/T0 | 409 (duplicada), 422 |
| Pedido (detalhe) | GET `/requests/{id}` | dono/participante/elegível | — | política de acesso | — | 404 |
| Descoberta | GET `/discovery/requests` | profissional | — | aprovado + acesso vigente | — | 403 `no_access` |
| **Aceitar trabalho** | POST `/requests/{id}/acceptances` (corpo vazio) | profissional | **sim** | §7.2 de 08 | `WorkAccepted`; cria conversa + mensagem de sistema | 409 `no_slot`/`admission_closed`/`acceptance_closed`, 422 campos extras, 404 |
| Retirar aceite | POST `/requests/{id}/acceptances/me/withdraw` | profissional | **sim** | aceite ativo, não selecionado | `AcceptanceWithdrawn`; vaga permanece consumida | 409 `acceptance_not_active`/`already_selected` |
| **Chamar mais profissionais** | POST `/requests/{id}/second-wave` | cliente | **sim** | `acceptances_count >= 4`, aberto, não aberto antes | `SecondWaveOpened` (uma vez) | 409 `not_available` |
| **Selecionar/trocar** | POST `/requests/{id}/selection` | cliente | **sim** | participante elegível; `expected_version`; step-up; opcional `confirm_cancel_republication` | `ProfessionalSelected`/`SelectionChanged` (+ `RequestCancelled` da republicação) | 409, 401 step-up |
| Registrar desistência | POST `/requests/{id}/selection/withdraw` | profissional selecionado | **sim** | seleção ativa | `ProfessionalWithdrew` | 409 |
| **Cancelar** | POST `/requests/{id}/cancel` | cliente | **sim** | confirmação; step-up | `RequestCancelled` | 409 |
| **Concluir** | POST `/requests/{id}/complete` | cliente | **sim** | seleção ativa; step-up | `RequestCompleted` | 409 |
| Corrigir conclusão | POST `/requests/{id}/complete/revert` | cliente | **sim** | `now() <= completed_at+24h`, sem avaliação publicada | `CompletionReverted` | 409 `window_closed` |
| Solicitar correção administrativa | POST `/requests/{id}/completion-review` | cliente | sim | fora da janela ou avaliada | caso para Suporte | — |
| **Republicar** | POST `/requests/{id}/republish` | cliente | **sim** | origem permitida (SD-09); sem republicação ativa | `RequestRepublished` | 409 + link da existente |
| Consentimento de telefone | PUT `/requests/{id}/consents/phone` | cliente | sim | step-up | grava `contact_consent` | — |
| Revelar telefone | GET `/requests/{id}/contact` | participante | — | consentimento ativo | `contact_reveal_log` | 404 |
| Conversas/mensagens | GET/POST `/conversations/{id}/messages` | membro | **sim** (mensagem) | conversa ativa | `MessageSent` | 409 `read_only` |
| Arquivar | PUT `/conversations/{id}/archive` | membro | sim | — | preferência | — |
| Denunciar/bloquear | POST `/reports`, `/blocks` | autenticado | sim | — | caso de moderação | — |
| Foto (visualizar) | GET `/requests/{id}/photos/{pid}/view` | dono/participante/elegível | — | política de mídia; rate limit | log de acesso; URL curta | 404/429 |
| Avaliar | POST `/requests/{id}/review` | cliente | **sim** | conclusão válida | `ReviewSubmitted` → `ReviewPublished|Rejected|Held` | 409, 422 |
| Resposta/contestação | POST `/reviews/{id}/reply`, `/dispute` | profissional | sim | — | caso | — |
| Cadastro profissional | Supabase Auth + POST `/professionals` | profissional | sim | e-mail verificado | `ProfessionalRegistered` | — |
| Enviar documentos | `/professionals/me/documents` | profissional | sim | — | caso de verificação | 413/415 |
| **Ativar trial** | POST `/billing/trial/activate` | profissional | **sim** | `aprovada`; sem trial anterior da identidade | `TrialActivated` | 409 `trial_used` |
| Criar checkout | POST `/billing/checkout` | profissional | **sim** | plano; aprovado | cria assinatura/pagamento no MP | 502 tratado |
| Cancelar assinatura | POST `/billing/subscription/cancel` | profissional | sim | — | `cancel_at_period_end` | — |
| Admin (todas) | `/admin/*` | staff `aal2` | conforme | permissão | auditoria | 403 |
| Tick de jobs | POST `/internal/jobs/tick` | agendador (segredo) | — | autenticação de máquina | executa jobs vencidos | 401 |

---

## 3. Contratos de eventos

### 3.1 Envelope [PROPOSTA]
```
event_id (uuid, = outbox id)    type (string)    version (int)
occurred_at (UTC)               aggregate_type / aggregate_id / aggregate_seq
actor { kind: customer|professional|admin|system, ref: id opaco }
correlation_id / causation_id   payload { apenas IDs, enums e valores não pessoais }
```
Garantias: entrega **pelo menos uma vez**; ordem por agregado via `aggregate_seq`; consumidores **idempotentes** por `event_id` (tabela de consumo); versão incrementa em mudanças incompatíveis (consumidores toleram campos novos). Falha de consumidor ⇒ recuo exponencial e *dead letter* com alerta. **Sem PII** no payload.

### 3.2 Catálogo
| Evento | Gerado quando | Consumidores |
|---|---|---|
| `RequestPublished` | publicação | notificações (agenda lembretes), métricas |
| `WorkAccepted` | aceite (mesma transação da conversa e da mensagem automática) | notificações (aviso de aceite por e-mail, agrupado em 15 min), D3, métricas |
| `AcceptanceWithdrawn` | retirada | notificações (somente no site), métricas de abuso |
| `SecondWaveOpened` | 2ª onda | métricas |
| `ProfessionalSelected` / `SelectionChanged` | seleção/troca | conversas, notificações (sem identidade a concorrentes) |
| `ProfessionalWithdrew` | desistência | notificações |
| `RequestCompleted` / `CompletionReverted` | conclusão/correção | conversas, avaliação, notificações |
| `RequestCancelled` | cancelamento (inclui republicação cancelada na seleção atômica) | conversas, notificações |
| `AdmissionDeadlineApproaching` / `AdmissionDeadlineReached` | jobs T-24h / T0 (apenas se ainda aberto) | notificações |
| `RequestRepublished` | republicação | métricas |
| `MessageSent` / `MessageRead` | chat | Realtime (sinal), notificações |
| `MediaReady` / `MediaRejected` | pipeline | cliente (estado) |
| `ReviewSubmitted` → `ReviewPublished` / `ReviewRejected` / `ReviewHeld` | avaliação | agregado de nota, moderação |
| `VerificationDecided` | decisão | notificações, acesso |
| `TrialActivated` / `AccessGranted` / `AccessGraceStarted` / `AccessExpired` | billing | notificações, métricas |
| `PaymentApproved` / `PaymentFailed` / `PaymentRefunded` / `ChargebackOpened` | webhook processado | billing, Financeiro |
| `ConsentChanged` | opt-in/revogação | auditoria |
| `AbuseSignalRaised` | detecção | Suporte/Moderador |
| `AuditRecorded` (interno) | ação crítica | — |

---

## 4. Contratos de webhooks

### 4.1 Mercado Pago (entrada) — resumo do doc 13 **a reconfirmar**; demais detalhes `[NÃO VERIFICADO]`
Tópicos esperados: `subscription_preapproval` e `subscription_authorized_payment`; cabeçalho `x-signature`; reenvio pelo MP a cada 15 min em falha. Não há webhook de boleto (H5). Tarifas não obtidas.
1. `POST /v1/webhooks/mercadopago`. Valida **assinatura** conforme documentação vigente (segredo por ambiente; comparação em tempo constante; tolerância de relógio). Inválido ⇒ 401 e registro em `provider_event.signature_ok=false`, sem processar.
2. Persistir em `provider_event` (único `(provider, event_key)`; `event_key` derivado de tópico+recurso+versão/instante) e responder **200 imediatamente** (sem processar no caminho da requisição, por causa do cold start e tempo limite).
3. Processar via job: **consultar o recurso na API do MP** (assinatura/pagamento) e decidir pela resposta, não pelo corpo recebido. Comparar `date_last_updated`/status com o último processado; **nunca regredir** estado; eventos fora de ordem ou desconhecidos ⇒ `outcome=ignorado` com alerta.
4. Efeito: criar/atualizar `payment` (único por `provider_payment_id`) e **conceder acesso** (idempotente); falha ⇒ iniciar carência; cancelamento ⇒ `cancel_at_period_end`.
5. Reentrega do mesmo evento ⇒ nenhum efeito adicional (I-14, I-20). Reconciliação diária cobre perda de webhooks.
6. Falha do nosso lado (5xx) ⇒ o provedor reenviará `[NÃO VERIFICADO: política de retentativa]`; o *replay* manual por administrador fica disponível.

### 4.2 Provedor de e-mail, Resend (entrada) [PROPOSTA; formato NÃO VERIFICADO]
`POST /v1/webhooks/email`: assinatura do provedor; eventos `entregue|bounce|complaint`; atualiza `email_outbox` e `email_suppression`; idempotente por ID do evento.

### 4.3 Interno
`POST /internal/jobs/tick`: segredo de máquina rotativo; executa até N jobs vencidos com *lease*; idempotente; resposta curta. Nunca exposto no frontend.

---

## 5. Registro de riscos
Severidade: A (alta), M (média), B (baixa). Probabilidade: A/M/B.

| ID | Risco | Sev/Prob | Mitigação | Gatilho/Responsável |
|---|---|---|---|---|
| R-01 | Divergência NestJS × RLS gera vazamento ou bloqueio indevido | A/M | Matriz única + testes de paridade; RLS default-deny | Falha em T-05/T-06 ⇒ bloquear release |
| R-02 | Concorrência: 9º participante, seleção dupla, republicação dupla | A/M | ADR-003, I-01..I-11, testes C-xx | Qualquer falha ⇒ P1 |
| R-03 | Fotos revelam fachada/interior sem EXIF; raspagem por elegíveis (inclui trial) | A/M | D10, marca d'água, rate limit, aviso ao cliente | Sinal de raspagem ⇒ suspensão cautelar do acesso a fotos |
| R-04 | Mapbox: coordenadas só podem ser guardadas via geocodificação **permanente** (US$ 5/1.000, sem faixa gratuita, cartão); termos de produto (PDF) não lidos | M/A **VERIFICADO (doc 13)** | Decisão 29: 1 chamada permanente por rascunho revisto; limite de gasto na conta; contador e breaker (R-36); G-xx | Antes de implementar Geo |
| R-05 | Complexidade/desempenho de RLS com `set_config` por transação e views | M/M | pgTAP, `EXPLAIN` com dados sintéticos | Latência p95 > meta |
| R-06 | Mercado Pago não cobre o modelo (recorrência por plano, Pix recorrente, webhooks) | A/M `[NÃO VERIFICADO]` | S-03; porta de gateway; fallback avulso | Resultado do S-03 |
| R-07 | **Reduzido (decisão 33):** sem anexos no chat; resta documento de verificação malicioso enviado por profissional (visto só pela Verificação) | B/B | Bucket privado, validação por conteúdo, reencode de imagens, sem renderização no servidor; SD-12 (a) | Incidente ⇒ SD-12 |
| R-08 | Supabase gratuito: pausa de projeto, sem backup gerenciado (H3 aceito pelo usuário) | A/A `[NÃO VERIFICADO]` | ADR-020; *keep-alive*; **backup manual periódico (`12-TODO.md`)**; reavaliar antes de cobrar | **Bloqueia cobrança real e dados reais** |
| R-09 | Cota de e-mail esgota ⇒ links de login não chegam | A/M | Prioridade de classes; digest elástico; teto por pedido | 70% da cota |
| R-10 | Cold start da função serverless derruba UX e webhooks | M/A `[NÃO VERIFICADO]` | Webhook só grava; login síncrono; S-09 mede | p95 de resposta |
| R-11 | Reencode de imagem estoura memória/duração da função (ver R-31) | M/M | Um ativo por invocação; limites de resolução; reprocesso; S-06 | OOM/timeouts |
| R-12 | ~~Ocupante fantasma trava D3~~ **EXTINTO (H4/SD-07)**: aceite é atômico | — | — | — |
| R-13 | Enumeração de e-mail / brute force no desafio | A/M | §5 de 08; respostas uniformes; limites | Testes S-xx |
| R-14 | Sessão de 7 dias em dispositivo compartilhado | M/M | Step-up; sair de todos | — |
| R-15 | Login CSRF/link aberto por terceiro (cenário do e-mail alheio) | M/M | Nonce de navegador; sessão nasce onde ocorre o POST; rascunho só anexa se e-mail igual | Teste |
| R-16 | Acúmulo de dados sem política de retenção | A/M | ADR-016; não lançar com dados reais antes de L1/L2 | Jurídico |
| R-17 | Backup contém dados "excluídos" | M/M | Política de rotação `[PENDENTE JURÍDICO]` | L1 |
| R-18 | Provedores como suboperadores sem contrato | M/A `[PENDENTE JURÍDICO]` | SD-11 | L2 |
| R-19 | Mobile: IAP/contas pagas/exclusão de conta | M/M `[NÃO VERIFICADO]` | ADR-019; SD-13 | Início do mobile |
| R-20 | Falha parcial entre cancelar republicação e selecionar | A/B | Transação única; teste F-02 | — |
| R-21 | Perda de dispositivo MFA do admin | M/B | Reenrolamento com dupla aprovação | — |
| R-22 | Crescimento da auditoria no banco de 500 MB | M/M | Compactação; arquivamento comprimido (SD) | 70% do espaço |
| R-23 | Relógio: expiração calculada por pod divergente | M/B | Relógio do banco | — |
| R-24 | Acessibilidade WCAG 2.2 AA sem evidência | M/A | FA-034; só declarar com evidência | Release |
| R-25 | Biblioteca de decodificação de imagem vulnerável | A/B | Atualizações, limites, isolamento | Boletim de segurança |
| R-26 | Aceite abusivo: profissional aceita só para ver o primeiro nome/telefone, ou aceita e retira para ocupar vagas | M/M | 1 CPF/CNPJ = 1 vaga; telefone só com opt-in; sinal de abuso por taxa de aceites/retiradas; fila humana; 2ª onda do cliente | Sinal persistente |
| R-27 | Cliente não percebe aceites se o e-mail atrasar/for adiado por cota; o site sempre mostra | B/M | Indicador de não lida no site; aviso após publicar; prioridade/reserva de login | Baixo retorno medido |
| R-28 | Vercel Hobby é não comercial (processar pagamento conta como comercial): cobrar no Hobby viola os termos | A/A **VERIFICADO (doc 13)** | Decisão 28: Hobby só em dev/teste; **Pro ao cobrar** | **Bloqueia cobrança real** até migrar |
| R-29 | NestJS inviável/lento em serverless (cold start, pacote, bibliotecas nativas) | M/M `[NÃO VERIFICADO]` | S-09; alternativas B/C/D (ADR-018) | Resultado do S-09 |
| R-30 | Cron do Hobby roda 1x/dia (±59 min): digest/lembretes atrasariam | M/A **VERIFICADO (doc 13)** | Sem depender do cron da Vercel: `pg_cron`/`pg_net` (R-38), plano B chamada externa, plano C tick oportunista; login e mensagem automática independem do tick | Resultado do S-10 |
| R-31 | Limites de corpo/resposta/memória de função inviabilizam foto servida com marca d'água | M/M `[NÃO VERIFICADO]` | Derivada pequena; upload direto ao Storage; S-06/S-09 | Teste Q-08 |
| R-32 | Backup manual atrasado ou perdido | A/M | Rotina e periodicidade em `12-TODO.md` (adiada); teste D-01 | Antes de dados reais |
| R-33 | **Resend exige domínio verificado para enviar** (doc 13); sem domínio não há envio real nem login de usuários reais | A/A (VERIFICADO) | Mailpit em dev/CI; homologação só com endereços `resend.dev` (consomem cota); lançamento bloqueado até o domínio (decisão 15) | **Bloqueia login de usuários reais** |
| R-34 | Cota gratuita do Resend (100/dia UTC, 3.000/mês, por destinatário, 10 req/s) esgota com todos os e-mails habilitados | A/M | Contador e alertas (≥ 90/dia, ≥ 2.700/mês); reserva de 10/dia e 300/mês para `auth`; agrupamento 15 min; degradação (chat/site seguem); remetente ≤ 5/s | ≥ 70% em 3 dias ⇒ decisão de upgrade |
| R-35 | Storage de 1 GB: 5 fotos × ≈ 0,5 MB ≈ 2,5 MB/pedido ⇒ ≈ 280 pedidos em ≈ 700 MB; documentos de verificação consomem o restante (chat sem anexos) | M/A (hipótese sobre limite VERIFICADO) | Redução no envio e só versão reduzida (decisão 31); chat sem imagens (decisão 32); gatilho de upgrade | ≥ 70% do Storage |
| R-36 | Mapbox permanente: custo desde o 1º pedido e cartão obrigatório; abandono de rascunhos gera custo | M/M | Chamada só após e-mail verificado e revisão; teto 3; limite de gasto na conta; breaker; alternativa "permanente na publicação" | Gasto ≥ 70% do limite |
| R-37 | Egress de 5 GB/mês: ≈ 25–50 MB por pedido em fotos ⇒ ≈ 100–200 pedidos/mês (limite mais apertado) | A/M (hipótese) | Prévias ≈ 320 px, foto inteira só ao abrir, rate limit por profissional, medir (Q-13) | ≥ 70% do mês |
| R-38 | PostGIS, `pg_cron` e `pg_net` no Free: NÃO ENCONTRADOS na documentação | M/M | Spike S-02/S-10; geo sem PostGIS (índice por célula/`earthdistance`); tick por plano B/C | Resultado do S-02 |

---

## 6. Spikes (antes de implementar; todos locais ou de leitura de documentação, sem criar contas)
| ID | Pergunta | Saída | Bloqueia |
|---|---|---|---|
| S-01 | Como criar sessão Supabase para usuário verificado pelo nosso desafio (admin API + verificação no servidor)? Alternativa nativa com POST? | Decisão do ADR-005 ou fallback | Identidade |
| S-02 | `pg_cron`, `pg_net`, PostGIS e pooler em modo transação no Supabase Free/local: **no Free, PostGIS/pg_cron/pg_net = NÃO ENCONTRADO na documentação**; pooler (200) e `set_config` por transação a confirmar | Disponibilidade; decisão entre geo com/sem PostGIS e tick por A/B/C | Jobs, Geo |
| S-03 | Mercado Pago: **tarifas não obtidas**; recorrência por ciclo (1/3/6/12 meses), Pix manual (Pix Automático não encontrado), assinatura de webhook (`x-signature`), reenvio 15 min, tópicos `subscription_preapproval`/`subscription_authorized_payment` (resumo, a reconfirmar), sandbox | Matriz de capacidades e tarifas | Billing |
| S-04 | Mapbox: **verificado** (temporário não armazena; permanente US$ 5/1.000 com cartão). Resta ler os termos de produto (PDF) e confirmar o que conta como "armazenar" | Parecer final; ajuste do ADR-008 | Geo |
| S-05 | Realtime: canais privados com autorização, limites gratuitos | Viabilidade/fallback | Chat |
| S-06 | Memória/tempo de reencode (JPG/PNG/WebP/HEIC de 10 MB) e marca d'água em instância pequena | Limites de concorrência | Mídia |
| S-07 | Regras das lojas (login social, IAP, exclusão de conta) em fontes oficiais | Parecer de ADR-006/019 | Mobile |
| S-08 | Verificação oficial dos limites gratuitos de ADR-020 (todos os serviços) | Tabela verificada | Planejamento de custos |
| S-09 | NestJS como função única na Vercel: **suporte confirmado** (Fluid, bundle ≤ 250 MB); medir cold start, cliente Postgres via pooler, biblioteca nativa de imagem | Parecer e contingência B/C/D | API |
| S-10 | Tick de jobs: **cron do Hobby = 1x/dia (verificado)**; testar `pg_cron`/`pg_net` (S-02), chamada externa gratuita (plano B) e tick oportunista (plano C) | Escolha e atraso real | Jobs, lembretes |
| S-11 | Resend: **verificado no doc 13** (limites, domínio exigido, SMTP, guia do Supabase Auth). Resta validar na execução: verificação do domínio, webhooks de bounce, comportamento ao exceder a cota (código de erro/429) | Parecer de execução | E-mail |

---

## 7. Plano de testes de concorrência
Ferramentas: Postgres efêmero real (nunca mock), N clientes paralelos (workers ou processos), **barreiras determinísticas** (`pg_sleep`/ponto de pausa injetado) para forçar intercalações, testes de modelo/propriedade (sequências aleatórias de operações com verificação dos invariantes I-xx), e execução repetida (N≥100 iterações por cenário). Cada teste termina rodando os monitores SQL dos invariantes.

| ID | Cenário | Resultado esperado |
|---|---|---|
| C-01 | 50 profissionais elegíveis clicam em "Aceitar trabalho" simultaneamente na 1ª onda | exatamente 4 aceites (cada um com 1 conversa e 1 mensagem de sistema); os demais `no_slot`; slots 1..4 sem lacunas |
| C-02 | Onda 2 aberta; 50 profissionais disputam (repetir ≥100×, incluindo abrir a onda 2 durante a disputa) | exatamente 8 no total; **nunca 9** |
| C-03 | Mesmo profissional dispara 10 requisições de aceite simultâneas (e duas contas do mesmo CPF) | 1 aceite, 1 vaga, 1 conversa, 1 mensagem de sistema; segunda conta com o mesmo CPF não consome 2ª vaga |
| C-04 | Duplo clique e duas abas em "Chamar mais profissionais" com 4 aceites | uma única `wave2_opened_at`; ambas as respostas coerentes |
| C-04b | 4º aceite × clique no botão ao mesmo tempo; retirada de um dos 4 aceites × clique | nunca abre com menos de 4; com retirada a contagem de vagas consumidas segue 4 (botão disponível); abre no máximo uma vez |
| C-05 | Selecionar P1 e P2 simultâneos | uma seleção ativa final; a outra é troca ou 409; sem seleção dupla |
| C-06 | Aceites concorrentes no instante de `acceptance_deadline_at` (±1 s) e com seleção em curso | nenhum aceite após o prazo/seleção; sem deadlock |
| C-07 | Concluir × cancelar; dupla conclusão; correção direta no limite de 24 h (exato, −1 ms, +1 ms) | estado consistente; limite inclusivo (AMB-11 A); admissão não reabre |
| C-08 | Dupla avaliação; avaliação durante correção de conclusão | uma avaliação ou rejeição consistente |
| C-09 | Duas republicações quase simultâneas na mesma cadeia | uma criada, outra 409 com referência |
| C-10 | Selecionar no original com republicação ativa: duas requisições idênticas e uma com chave diferente | efeito único; a segunda vê estado consistente |
| C-11 | Webhook duplicado, concorrente e fora de ordem (aprovado→pendente) | uma concessão; sem regressão |
| C-12 | Mensagem de texto reenviada 5× com o mesmo `client_message_id` | 1 mensagem |
| C-13 | Dois processos executando o tick do digest | no máximo um e-mail por janela; sem resumo obsoleto |
| C-14 | Mesma `Idempotency-Key` com corpo diferente / em andamento | 422 / 409 |
| C-15 | Carga com contenção em um pedido "quente" | `lock_timeout` respeitado; sem tempestade de retries; latência p95 documentada |
| C-16 | **Idempotência da mensagem de sistema:** aceite repetido 5× com a mesma chave, com chave diferente, retry após queda antes do `COMMIT`, replay do evento do outbox, e `INSERT` manual duplicado com a mesma `dedupe_key` | 1 aceite, 1 conversa, 1 mensagem `aceite`; duplicata manual viola o unique; retirada gera no máximo 1 `aceite_retirado` |
| C-17 | Retirar × selecionar o mesmo aceite; retirada repetida; retirada de aceite já selecionado | um vence (409 no outro); retirada repetida 200 idêntico; selecionado não retira (vale desistência); vaga sempre consumida |
| C-18 | Mensagem humana enviada à conversa no mesmo instante da retirada | mensagem de sistema de retirada antes da transição; humana depois recebe `read_only` |

**Injeção de falhas (F-xx):**
| ID | Falha | Esperado |
|---|---|---|
| F-01 | Queda do processo após `INSERT acceptance`, antes do `COMMIT` | nada persistido; retry com mesma chave cria 1 |
| F-02 | Falha entre "cancelar republicação" e "selecionar" (matar conexão, erro forçado) | rollback total; nenhum estado parcial |
| F-03 | Queda após `COMMIT`, antes de publicar o evento | outbox despacha depois; nenhum evento perdido/duplicado com efeito duplo |
| F-04 | Provedor de e-mail indisponível por horas | e-mails em `pendente` com recuo; nenhuma duplicação ao voltar; classe `auth` priorizada |
| F-05 | Mapbox indisponível, cota temporária esgotada ou limite de gasto permanente atingido (breaker) | rascunho fica "aguardando geocodificação" com o texto do endereço; nada se perde; nenhuma coordenada é gravada fora do modo permanente |
| F-06 | Realtime indisponível | chat funciona por polling |
| F-07 | MP indisponível ao criar checkout | 502 tratado; sem concessão; nova tentativa idempotente |
| F-08 | Instância dorme/reinicia durante tick | *lease* expira; job reprocessado idempotente |
| F-09 | Upload interrompido no meio | asset `pending` expurgado; reenvio sem duplicar |
| F-10 | Falha entre criar a conversa e gravar a mensagem de sistema (erro forçado) | rollback total: sem aceite, sem conversa, vaga não consumida |
| F-11 | Função serverless excede duração/memória no meio da transação do aceite ou do reencode | transação revertida; retry com a mesma chave cria 1; ativo de mídia volta a `pending` |
| F-12 | Resend indisponível ao enviar o link de login | resposta uniforme 202; item em `email_outbox` com recuo; sem duplicação |

---

## 8. Plano de testes de segurança
Todos exercitam **chamada direta de API e acesso direto ao banco com papéis**, não apenas a UI.

| ID | Alvo | Casos |
|---|---|---|
| T-01 | Identidade | link já usado, expirado (15 min ± limite), adulterado; GET do link por scanner não consome (D8); código errado 5× invalida; respostas e tempos uniformes para e-mail existente/inexistente; sessão de 7 dias expira e revogação funciona; consumo em outro navegador não anexa rascunho de e-mail diferente |
| T-02 | Autorização por recurso (IDOR) | cliente A × recursos de B; profissional P1 × conversa de P2; ID previsível; 404 indistinguível; foto/miniatura sem acesso; URL assinada vazada após expirar ou usada por outro profissional |
| T-03 | Visibilidade (matriz doc 05 §6) | elegível não participante não vê primeiro nome; ninguém vê e-mail; telefone só com consentimento ativo e participação; revogação corta acesso futuro; republicação não herda consentimento; endereço só com compartilhamento |
| T-04 | Estado × elegibilidade | profissional `pendente|em_revisao|retida_duplicidade|recusada|suspensa` não aceita trabalho por API; assinatura expirada não descobre novos pedidos, mantém participação e pode ser selecionado; suspensão de segurança impede seleção |
| T-05 | RLS | com papéis `anon`/`authenticated`/`app_api` sem principal: nenhuma tabela legível; `app_api` com principal A não lê B; migração não cria tabela sem RLS (teste de catálogo); funções `SECURITY DEFINER` com `search_path` fixo |
| T-06 | Paridade de políticas | gerar casos a partir de `access-matrix` e comparar API × banco |
| T-07 | Mídia | Fotos do pedido: EXIF removido (GPS, orientação aplicada); tipo falso por extensão; imagem bomba; HEIC; arquivo >10 MB de entrada; 6ª foto recusada; marca d'água com identificador correto; sem original/*master* guardado; rate limit/raspagem gera 429, log e sinal; URL de ~60 s expira. Documentos de verificação: tipo por conteúdo, acesso só da Verificação. Chat: ver M-01/M-02 |
| T-08 | Admin | sem MFA nega; papel inadequado nega na API; sem `access_case` não abre chat/documento; log de cada leitura; autoaprovação e dupla aprovação do mesmo aprovador negadas; Auditor não altera; estorno 200,00 (1 aprovação) × 200,01 (2) |
| T-09 | Billing | assinatura inválida de webhook; corpo forjado diferente do recurso; replay; ordem trocada; segundo trial da mesma identidade negado; cartão sem adesão não renova; Pix exige novo pagamento manual; **boleto recusado (422) e inexistente em API/tela/e-mail**; carência e período: ver B-01..B-10 |
| T-10 | Injeções | SQL, XSS armazenado em mensagem/descrição/comentário (saída escapada), upload com nome malicioso, SSRF em qualquer URL fornecida, cabeçalhos de redirecionamento; CSRF em rotas mutáveis |
| T-11 | Logs/PII | varredura automática de logs e eventos de teste por padrões de e-mail/telefone/CPF/token; falha de teste se encontrar |
| T-12 | Abuso | publicação em massa (limites), enumeração de cobertura, brute force de login do profissional, tentativas de burlar vagas com múltiplas contas |
| T-13 | Segredos | nenhum segredo/`service_role` em repositório, bundle de web/admin/mobile ou log (varredura de segredos no CI) |
| T-14 | Dependências | auditoria de vulnerabilidades no CI (gratuita) |
| T-15 | Acessibilidade e EDS | varredura de hex em componentes; teclado/leitor/contraste nos fluxos (FA-033/034); não declarar WCAG sem evidência |
| T-16 | Aceite e chat | corpo do aceite com texto/valor/prazo ⇒ 422 e nada persistido; primeiro nome só após aceite `ativo`; telefone só com opt-in; mensagem de sistema sem e-mail/telefone do profissional e sem endereço; `kind=sistema` recusado na API pública de mensagens; edição/exclusão da mensagem de sistema negada |
| T-17 | Sem intermediação de preço | teste de catálogo: nenhuma coluna de preço/valor/prazo do serviço em `app.*` de pedido, aceite ou mensagem; nenhuma rota de pagamento entre cliente e profissional |

---

## 9. Plano de recuperação
Metas provisórias para o plano gratuito com **backup manual periódico (H3)**: **RPO = intervalo entre exports** (proposta semanal, `12-TODO.md`) e **RTO ≤ 8 h** `[PROPOSTA]`; metas melhores só após o gatilho SD-04. Nenhum desses números foi medido.

| ID | Cenário | Procedimento a validar | Critério de sucesso |
|---|---|---|---|
| D-01 | Restauração do banco a partir do backup lógico em ambiente limpo | restaurar dump criptografado, aplicar migrações, rodar monitores I-xx | invariantes sem violações; tempo ≤ RTO |
| D-02 | Restauração de objetos (Storage) e conferência de integridade | reconciliar `media_asset` × objetos | órfãos e ausentes reportados |
| D-03 | Pós-restauração: webhooks e e-mails | reconciliação com MP; reenfileirar `email_outbox` sem duplicar | acesso e cobranças corretos |
| D-04 | Projeto pausado/indisponível | retomar, verificar jobs, *keep-alive* | sem perda; alertas |
| D-05 | Migração malsucedida | rollback via compensação (expand/contract) em staging | sem perda |
| D-06 | Rotação de segredos (MP, Mapbox, pepper, chave de criptografia) | rotacionar com chave versionada | sem indisponibilidade; dados antigos legíveis |
| D-07 | Comprometimento de conta admin | revogar sessão, redefinir MFA com dupla aprovação, revisar auditoria | tempo de resposta documentado |
| D-08 | Exclusão do titular × backups | procedimento definido com jurídico | `[PENDENTE JURÍDICO]` |
| D-09 | Incidente de dados | runbook: detecção por métricas, contenção, avaliação, comunicação | `[PENDENTE JURÍDICO]` para notificações |
Teste de restauração: antes do lançamento e periodicamente `[PROPOSTA]`; backups com dados sintéticos em ambientes de teste.

---

## 9b. Testes de billing (B-xx): Pix, cartão e carência de 72 h [H5]
Relógio controlado no banco (`now()` simulado); instante do vencimento = `period_end`.

| ID | Cenário | Esperado |
|---|---|---|
| B-01 | Pix pago, período termina sem novo pagamento | `ativa` até `period_end`; `em_carencia` em `period_end` até `+72 h` (inclusive o limite de 72 h exatos conforme a regra do doc 08); `expirada` depois; nenhum job necessário |
| B-02 | Cartão: renovação automática falha | mesma carência de 72 h; depois `expirada` |
| B-03 | Pix pago **dentro** da carência (ex.: +60 h) | volta a `ativa` sem lacuna; novo período começa em `period_end` anterior (Rodada 8 nº 17); sem pagamento em duplicidade |
| B-04 | Pix pago após 72 h | novo período começa no instante do pagamento; houve `expirada` entre os dois |
| B-05 | Webhook do mesmo Pix duplicado, concorrente e fora de ordem | uma concessão; sem regressão; `period_end` inalterado |
| B-06 | Pix `pendente` (gerado e não pago) no vencimento | não estende acesso nem carência |
| B-07 | Trial expirado | sem carência; sem cobrança; sem assinatura criada |
| B-08 | Assinatura com `cancel_at_period_end` | acesso até `period_end`, sem carência |
| B-09 | Criar pagamento por boleto (API direta), tela de pagamento, e-mail | recusado 422 `method_not_supported`; opção inexistente; sem tabela/valor de boleto |
| B-10 | Pagamento antecipado de Pix antes do vencimento | novo período começa em `period_end` vigente; sem perda de dias |

## 9c. Testes de notificações por e-mail (N-xx) [Rodada 12 nº 27, T6]
Ambiente de teste: Mailpit local, relógio controlado; nenhum envio externo. Segredos só por nome de variável.

| ID | Cenário | Esperado |
|---|---|---|
| N-01 | Ocorre aceite | mensagem automática no chat **e** 1 linha em `email_outbox` (aviso de aceite) enviada pelo `EmailProviderPort`; capturada no Mailpit; sem endereço/telefone/e-mail de terceiros |
| N-02 | 4 aceites do mesmo pedido em 15 min | 1º e-mail imediato; os demais agrupados em 1 resumo (economia de cota); aceite visto antes do resumo ⇒ resumo omitido; pedido selecionado/cancelado ⇒ sem resumo obsoleto |
| N-03 | Mensagem humana não lida | e-mail imediato na primeira, seguintes agrupadas (15 min); a mensagem automática do aceite não aciona este aviso |
| N-04 | Lembrete T-24h, vencimento, seleção, cancelamento, desistência, trial/ciclo, verificação | cada um enfileira e envia; lembretes rechecam o estado (selecionado/cancelado ⇒ não enviam) |
| N-05 | Link mágico/código | enviado direto na requisição; resposta uniforme 202; independe do tick; falha do provedor ⇒ fila com recuo |
| N-06 | Todos os tipos habilitados simultaneamente | nenhum duplicado (dedupe_key); `email_type` correto no corpo; contador de uso por destinatário incrementado |
| N-07 | Procurar interruptor, tabela de flags, ponto de ativação ou rotina de reenvio | **não existem** (teste de catálogo e de rotas/jobs); aceites anteriores não geram e-mail retroativo |
| N-08 | Cota: 85/90/100 destinatários no dia UTC; 2.700/3.000 no mês | alertas; acima do limiar só `auth`/crítico; demais `adiado_cota` e reavaliados; chat/site continuam; login nunca descartado |
| N-09 | Dev/CI com Mailpit | e-mail capturado localmente; zero chamadas externas |
| N-10 | Adapter Resend com domínio **não** verificado/segredo ausente | recusa enviar (erro explícito), nada é perdido (fica `pendente`); com `EMAIL_PROVIDER` de dev usa Mailpit |

## 9d. Testes de geocodificação e fotos (G-xx, P-xx) [decisões 29 e 30]
Provedor Mapbox simulado em teste (respostas "temporária" e "permanente" distintas); nenhuma chamada externa.

| ID | Cenário | Esperado |
|---|---|---|
| G-01 | Cliente digita e escolhe sugestão (resultado temporário) | nenhuma coordenada gravada em rascunho, log ou cache; só o texto do endereço |
| G-02 | Revisão do rascunho completo e identificado | exatamente 1 chamada `permanent=true`; `exact_point`, `match_point`, `geocode_mode='permanent'` gravados; duplicidade e cobertura usam essa coordenada |
| G-03 | Publicar após a revisão; publicar de novo (retry) | nenhuma nova chamada paga; mesma coordenada; idempotente |
| G-04 | Editar o endereço 4 vezes | chamadas 1 a 3 permitidas; a 4ª recusada (422) sem custo |
| G-05 | Tentar gravar `exact_point` sem `geocode_mode='permanent'` (SQL direto) | CHECK rejeita |
| G-06 | Breaker de gasto atingido | rascunho "aguardando geocodificação", texto preservado, aviso ao cliente, contador no painel |
| G-07 | Cadastro/alteração da base do profissional | 1 chamada permanente, limitada em taxa; sem chamada para visitantes anônimos |
| P-01 | Enviar 6 fotos a um pedido (API e SQL) | a 6ª recusada `photo_limit`; as 5 anteriores intactas |
| P-02 | Procurar caminho de upload extra de foto de pedido | não existe; mensagem ao cliente oferece WhatsApp apenas se ele compartilhar o contato (opt-in) |
| P-03 | Foto de 10 MB (JPG/PNG/WebP/HEIC) enviada ao pedido | resultado ≤ 1.280 px e ≈ 0,5 MB (teto técnico configurado); EXIF removido; consumo registrado em `external_quota(storage)`; se não couber no teto, recusa com mensagem |
| P-04 | Inspecionar o Storage após o envio | só existe o objeto reduzido; **nenhum original nem *master*** (nem em `quarantine` depois do prazo); `media_asset` sem coluna de original |
| P-05 | Visualização por profissional | derivada = versão reduzida + marca d'água, nunca maior que a guardada; prévia ≈ 320 px na listagem; `no-store` |
| P-06 | Capacidade: carga sintética de pedidos com 5 fotos | consumo ≈ 2,5 MB/pedido; ≈ 280 pedidos em ≈ 700 MB; alerta em 70/85/95% |

## 9e. Teste do chat sem anexos (M-xx) [decisões 32 e 33]
| ID | Cenário | Esperado |
|---|---|---|
| M-01 | **API rejeita qualquer anexo no chat:** imagem (JPG/PNG/WebP/GIF/HEIC), PDF, arquivo renomeado, multipart, campo `attachments`, pedido de URL de upload (API direta e UI) | 422 `attachments_not_allowed`; nada persistido; a UI nem oferece anexar |
| M-02 | Catálogo de esquema, rotas e buckets | não existem bucket `chat-attachments`, tabela `message_attachment`, rota de upload/download/miniatura/URL assinada de chat nem `media_asset` com `owner_kind='message'` |

## 10. Testes de cota e plano gratuito (Q-xx)
| ID | Cenário | Esperado |
|---|---|---|
| Q-01 | Cota de e-mail a 70/85/100% | alerta; digest elástico; `auth` nunca descartado; lembretes de baixo valor suprimidos |
| Q-02 | Mapbox temporário a 70/85/95% de 100.000/mês e permanente a 70/100% do limite de gasto | alertas; breaker; rascunho aguardando geocodificação; sem mapas obrigatórios |
| Q-03 | Armazenamento a 70/85/95% | alertas; cotas endurecidas; uploads de baixo valor bloqueados; documentos de identidade ainda aceitos |
| Q-04 | Banco a 70/85% | expurgos antecipados; alerta de upgrade |
| Q-05 | Cold start da API com webhook do MP | webhook responde ao acordar; sem perda |
| Q-06 | Conexões esgotadas | fila/erro 503 controlado; sem queda de dados |
| Q-07 | Carga sintética de volume realista (pedidos × aceites × mensagens) | estimativas de ADR-020/09 §9 recalibradas |
| Q-08 | Reencode/marca d'água de foto de 10 MB em função com memória/duração do plano gratuito | dentro do limite ou ativo reprocessado sem perda (F-11); decisão registrada em S-09 |
| Q-09 | Tick em frequência mínima do agendador escolhido (S-10) | lembretes/digest atrasam sem perda; login e mensagem de sistema inalterados |
| Q-10 | Cota diária: simular 90, 100 e 101 destinatários no dia UTC (virada de dia UTC incluída) | alerta em ≥ 90; acima do limiar só `auth`/crítico; itens `adiado_cota` reavaliados no dia seguinte; chat/site normais |
| Q-11 | Cota mensal (2.700 e 3.000) e rajada acima de 10 req/s | alertas; reserva de `auth` preservada; remetente respeita ≤ 5/s e recua em 429; nenhuma perda de e-mail de login |
| Q-12 | Storage a 70/85/95% com pedidos de 5 fotos reduzidas (≈ 0,5 MB; teto 0,75 MB) | alertas; cotas endurecidas; capacidade medida ≈ 280 pedidos em ≈ 700 MB recalibra 09 §9; documentos de identidade ainda aceitos |
| Q-13 | Egress: 20 profissionais visualizam as 5 fotos de um pedido (prévias + foto inteira) | volume medido ≈ 25–50 MB/pedido (hipótese); rate limit por profissional ativo; alerta a 70% de 5 GB |
| Q-14 | Tick sem cron: (a) só tick oportunista; (b) só cron diário; (c) chamada externa | lembretes T-24h e digest executados dentro do atraso medido; login, aceite e mensagem automática intactos; jobs idempotentes sob *lease* |

---

## 11. Viabilidade e dependência técnica
Checklist (sem execução):
- [ ] S-01..S-08 concluídos (principalmente S-03 e S-04, que podem forçar SD).
- [ ] SD-01 (hospedagem) e domínio verificado no Resend (decisão 15) antes de qualquer e-mail real.
- [ ] Matriz de acesso (`access-matrix`) escrita e revisada pelo PO/Reviewer.
- [ ] Política de retenção (L1/L2) antes de dados reais.
- [ ] Gatilho SD-04 aceito antes de cobrança real.
- [ ] SD-09 respondida; SD-15 e backup (`12-TODO.md`) tratados antes da primeira cobrança/dados reais (SD-16, 18, 19, 20 respondidas).
- [ ] S-09..S-11 concluídos quando a leitura de documentação for autorizada.
- [ ] Domínio verificado antes de qualquer e-mail real (SD-03).
- [ ] RF-146 (telas/permissões de admin) detalhado.

**Dependência técnica para fatiamento (AMB-20 B; o backlog é do Backlog Architect):** E0 fundação (monorepo, CI, tokens) → E1 identidade → E2 catálogo/geo (condicionado a S-04/SD-02) → E3 pedido/mídia → E4 verificação → E6 distribuição/aceites (invariantes I-01..I-07 e I-22 desde o início) → E7 chat → E8 seleção/conclusão → E9 republicação → E5 billing (pode ser antecipado após E4 se o trial for suficiente para validar demanda; cobrança real depende de L1–L4/L7 e SD-04) → E10 avaliações → E11 notificações (esqueleto desde E6) → E12 admin (esqueleto desde E4) → E13 retenção/observabilidade. Os esqueletos de outbox, idempotência, auditoria e `app_config` entram em E0/E1 porque todas as fatias dependem deles.

## 12. Rastreio FA → testes principais
| FA | Testes |
|---|---|
| FA-001..003 | T-01, T-12, F-05 |
| FA-004 | T-04, T-08 |
| FA-005, 006 | T-09, B-01..B-10, C-11, I-14/I-20/I-25 |
| FA-007, 008 | T-02, T-03, T-07 |
| FA-009 | T-02, T-03, I-12 |
| FA-010, 011 | C-01..C-04b, C-12, C-16..C-18, F-10, I-01..I-06, I-22, T-16 |
| FA-012..015 | C-05..C-07, I-04, I-05, I-17 |
| FA-016..018 | C-07, I-08, I-17 |
| FA-019, 020 | C-08, I-09 (FA-020 condicionado a L1) |
| FA-021..024 | C-09, C-10, F-02, I-10, I-11 |
| FA-025 | T-04 |
| FA-026..028 | C-12, F-09, T-07, M-01, M-02, I-12/I-13/I-30 |
| FA-029 | C-13, C-16, F-04, F-12, Q-01, Q-10, N-01..N-10 |
| FA-030 | T-03, I-16 |
| FA-031, 032 | T-08, I-15, I-18 |
| FA-033, 034 | T-15 |
| FA-035 | C-xx, F-xx, I-xx |
