# Refino H-058 — Aceitar trabalho idempotente (Issue #71)

- **Issue:** #71 `[E6] Aceitar trabalho idempotente` · **História:** H-058 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-19.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-19 local).
- `14-BACKLOG.md` (H-058, H-055, H-059, H-060, H-061, H-062, H-063, H-064, H-065, H-066, H-068, H-074, H-095).
- `04-PRD.md` (RF-018, RF-029, RF-048..RF-050, RF-062, RF-065..RF-075, RF-077, RF-078, RF-100, RF-103, RF-106, RF-109, RF-110, RF-115, RF-120, RF-122, RF-136..RF-139).
- `05-CRITERIOS-ACEITE.md` (FA-004, FA-009, FA-010, FA-011, FA-012, FA-013, FA-014, FA-025, FA-029, FA-030, FA-035).
- `08-ARQUITETURA.md` (§0, §1.1, §3, §4.2, §6.1, §7.1, §7.2, §7.3, §7.5, §7.6, §9.3, §10.3, §11, §12.3).
- `09-MODELO-DADOS.md` (§3.1, §3.3, §3.4, §3.5, §3.7, §3.8, §3.10, §6, §7, §9).
- `10-ADRS.md` (ADR-002, ADR-003, ADR-004, ADR-010, ADR-011, ADR-020, ADR-021, ADR-022; SD-07, SD-08, SD-16, SD-18, SD-19, SD-20).
- `11-ARQ-RISCOS-E-TESTES.md` (Invariantes I-01, I-02, I-03, I-04, I-05, I-06, I-07, I-12, I-16, I-21, I-22, I-26; Testes C-01, C-02, C-03, C-04, C-04b, C-06, C-16, F-01, F-10, T-02, T-03, T-04, T-16, T-17; Riscos R-02, R-26, AMB-04, AMB-21, AMB-23, AMB-24, AMB-27, AMB-28, AMB-30).
- `11-DECISOES.md` (Rodadas 5, 6, 8, 9, 12, 13, 96, 98, 107, 118, 121, 123, 128, 138, 140, 141, 142, 144; Decisões D3, D5, D8, D10, H4, H5, 1, 2, 3, 4, 7, 10, 14, 19, 20, 22, 26, 27, 448, 457, 516, 563 a 582, 640 a 645, 830+).
- Migrações existentes:
  - `20261113010000_requests_create_service_request.sql` (tabela `app.service_request`, `acceptance_deadline_at`, `acceptances_count`, `wave2_opened_at`);
  - `20261113230000_requests_expand_location_visibility.sql` (coluna `first_name` persistida no pedido);
  - `20261113250000_contact_create_phone_consent.sql` (`app.contact_consent`, `app.contact_reveal_log`, stub `private.request_acceptance_active` fechada até a E6 via decisão 448);
  - `20261113270000_billing_create_trial_activation.sql` (`private.identity_id_from_document_hmac`);
  - `20261113420000_eligibility_expand_professional_access_guard.sql` (`private.professional_access_guard` modo `descoberta_aceite` e `participacao`).
- Modelo estrutural: `docs/factory/139-REFINO-H055.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto original da Issue #71 no GitHub não foi lido por comando de rede (este agente opera no ambiente estritamente local). O escopo e os critérios foram reconstruídos a partir da linha H-058 do backlog canônico (`14-BACKLOG.md`) e do cruzamento minucioso com PRD, Critérios de Aceite, Arquitetura, Modelo de Dados, ADRs e histórico de decisões.
- Nenhum comando destrutivo ou de modificação foi executado no banco de desenvolvimento (ambiente preservado; sem migrations ou escritas).
- Não há menção a Docker nem a provedores externos de mapas em tempo de execução (sem Mapbox no aceite).
- E-mails transacionais em desenvolvimento utilizam estritamente Mailpit ou templates locais sem envio real (envio real desligado ou restrito à conta cadastrada, conforme decisões 15 e 27).
- Sem backup de dados (fora do escopo do projeto, decisão 151).

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro da fábrica (`docs/factory/quadro-status.md`) lista a Issue #71 (`[E6] Aceitar trabalho idempotente`) no Backlog oficial.
- `[VERIFICADO]` Total de 75 Issues Concluídas no quadro, incluindo fundações críticas já consolidadas no banco de dados e na API:
  - **#44 (`H-031`):** Publicação idempotente de pedidos (tabela `app.service_request` com colunas `status`, `acceptance_deadline_at`, `acceptances_count`, `wave2_opened_at`, `version`);
  - **#45 (`H-032`):** Visibilidade de localização e dados do pedido (preserva `first_name` em `app.service_request` e oculta de não participantes);
  - **#46 (`H-033`):** Opt-in de telefone no pedido (`app.contact_consent`, `app.contact_reveal_log`, e a função stub `private.request_acceptance_active` explicitamente marcada para ser concretizada pela E6 / decisão 448);
  - **#47 (`H-034`):** Painel do cliente na sessão do dono (`private.request_list_owner`);
  - **#48 (`H-035`):** Cadastro profissional com CPF/CNPJ cifrado e `document_hmac` gerado;
  - **#49 (`H-036`):** Perfil profissional, serviços, base geográfica e raio (`app.professional_area`, `app.professional_service`);
  - **#52 (`H-039`):** Fila de verificação cadastral (`verification_status = 'aprovada'`);
  - **#53 (`H-040`):** Retenção por duplicidade documental;
  - **#54 (`H-041`):** Estado da verificação visível;
  - **#55 (`H-042`):** Guarda de elegibilidade na API e no banco (Parte A concluída na Rodada 140; função `private.professional_access_guard` criada e operando com os modos `descoberta_aceite` e `participacao`);
  - **#56 (`H-043`):** Perfil público e selo verificado;
  - **#57 (`H-044`):** Trial de 14 dias (função pura `private.identity_id_from_document_hmac` disponível para derivação determinística de identidade);
  - **#58 (`H-045`):** Acesso comercial derivado (`billing.access_grant` e `private.commercial_access`);
  - **#102, #103, #104, #107:** Pipeline de notificações, outbox e cota;
  - **#18, #19, #20, #21:** Infraestrutura de outbox transacional, auditoria append-only, logs sem PII e agendador de tick;
  - **#150:** Eliminação total de `media_access_log` e resumos de mídia;
  - **#151:** Exclusão definitiva de backup, restauração e exportação do escopo do projeto.
- `[VERIFICADO]` Em Desenvolvimento no momento:
  - **#68 (`H-055`):** Descoberta de pedidos elegíveis (entregue em fatias, aguardando Code Review e QA pelo agy);
  - **#120 (`H-111`):** Direitos do titular (`dsr_case`);
  - **#146, #149:** Ajustes de testes e `check:all`.
- `[VERIFICADO]` No Backlog aguardando ou correlacionadas a H-058:
  - **#69 (`H-056`):** Fotos a elegíveis com marca d'água;
  - **#70 (`H-057`):** Limite de visualização de fotos;
  - **#72 (`H-059`):** Vagas 4+4 e teto de 8;
  - **#73 (`H-061`):** Retirada do aceite;
  - **#74 (`H-062`):** Encerramento de aceites;
  - **#75 (`H-064`):** Aceite sem campos de conteúdo;
  - **#76 (`H-065`):** Conversa criada no aceite;
  - **#136 (`H-068`):** Mensagem automática do aceite;
  - **#105 (`H-095`):** E-mail de aviso de aceite.
- `[VERIFICADO]` Dependências reais e condição de bloqueio:
  - **H-055 (#68):** A descoberta de pedidos é o passo que antecede o aceite. Embora o contrato de banco de H-058 seja independente, **o Desenvolvimento de H-058 não deve ser concluído antes da estabilização da rota de descoberta de #68**, garantindo consistência no fluxo ponta a ponta do profissional.
  - **H-064 (#75):** O critério de rejeitar campos de preço, prazo e texto no corpo da requisição com HTTP 422 é um requisito de validação intrínseco de H-058 e é absorvido formalmente por este refino.
  - **H-042 (#55, Parte B):** A chamada de `private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)` no aceite é o consumo direto da Parte B prevista na Rodada 121 (decisão 579).

---

## 2. Objetivo

Implementar a ação atômica e idempotente de **aceitar trabalho** (`POST /v1/requests/{id}/acceptances`), pela qual um **profissional elegível** manifesta interesse formal em atender um pedido de serviço publicado, ocupando uma vaga de atendimento (respeitando o teto de 4 vagas na 1ª onda ou 8 na 2ª onda).

Ao aceitar o trabalho:
1. Uma linha única é registrada na tabela `app.acceptance`, associando o pedido, o profissional e sua identidade física imutável (`identity_id` derivado do CPF/CNPJ), garantindo que um mesmo profissional ou documento jamais ocupe duas vagas no mesmo pedido (I-02, C-03);
2. Na **mesma transação e no mesmo COMMIT**:
   - É criada a conversa individual e privada entre cliente e profissional em `app.conversation` (I-03, RF-100);
   - É inserida a **mensagem de sistema automática** do aceite em `app.message`, com o texto fixo oficial **"Estou disponível para trabalhar"** (decisões 14 e 26, RF-075), sem remetente humano e deduplicada;
   - É gerado o evento de domínio `WorkAccepted` em `ops.outbox_event` para disparo assíncrono de notificações externas;
   - É incrementado o contador de vagas consumidas `acceptances_count` e a versão do pedido em `app.service_request`;
3. O profissional passa a ter acesso autorizado ao **primeiro nome do cliente** (`first_name`) por derivação de sua participação ativa (RF-110, FA-009);
4. A função de segurança `private.request_acceptance_active(p_request_id, p_professional_id)` é concretizada para devolver `true`, desbloqueando o acesso ao telefone/WhatsApp caso o cliente tenha fornecido consentimento expresso (`contact_consent` modo `todos_participantes`, decisão 448 / #46).

Resultado de negócio: eliminação definitiva do conceito de "proposta" ou "oferta" concorrencial com disputa de preços (decisão H4). O FastPro atua exclusivamente como ponte de conexão; o profissional aceita com um único clique (corpo vazio, sem digitação de preços ou prazos) e a negociação comercial ocorre diretamente entre as partes no chat ou via telefone com opt-in.

---

## 3. Escopo (dentro de H-058)

1. **Rota HTTP de Aceite:**
   - Criação do endpoint autenticado `POST /v1/requests/:id/acceptances` (ou `POST /v1/professional/requests/:id/acceptances`, conforme Pergunta 850), exigindo sessão ativa do profissional via cookie `fastpro_session`.
2. **Idempotência estrita na Borda:**
   - Exigência mandatória do cabeçalho `Idempotency-Key` (UUID v4 válido).
   - Verificação e gravação na tabela `ops.idempotency_key` sob chave `(principal_id, 'request_acceptance', key)`.
   - Reexecução da mesma requisição (mesma chave e mesmo corpo) devolve HTTP `200 OK` com o payload original idêntico, sem duplicar registros no banco.
   - Concorrência imediata em andamento devolve HTTP `409 Conflict` com cabeçalho `Retry-After: 1` e `{code: "operacao_em_andamento"}`.
   - Reutilização da mesma chave com payload alterado devolve HTTP `422 Unprocessable Entity` `{code: "chave_reutilizada_com_corpo_diferente"}`.
3. **Validação do Corpo da Requisição (Absorção de H-064):**
   - O corpo da requisição deve ser estritamente vazio `{}`.
   - O envio de quaisquer campos adicionais (ex.: `price`, `amount`, `deadline`, `text`, `message`, `attachment`, `conditions`) resulta em rejeição com HTTP `422 Unprocessable Entity` `{code: "campos_extras_recusados"}` (RF-070, I-26, T-16). Nenhuma proposta de preço ou prazo é gravada.
4. **Controle de Concorrência e Bloqueio Serializado:**
   - Execução sob transação com `SELECT ... FROM app.service_request WHERE id = :id FOR UPDATE` com `SET LOCAL lock_timeout = '3s'` (RF-088, ADR-003, FA-035).
   - Bloqueio por agregado garante que requisições simultâneas de aceites para o mesmo pedido sejam rigorosamente serializadas por ordem de chegada do lock (AMB-19 A).
5. **Verificação de Admissão e Ciclo de Vida do Pedido:**
   - O pedido deve existir e estar com `status = 'publicado'`.
   - O instante da operação deve cumprir `p_now < acceptance_deadline_at`. Pedidos com prazo de 168 horas vencido, selecionados, cancelados ou concluídos respondem HTTP `409 Conflict` `{code: "admissao_encerrada"}` (RF-072, FA-012, I-05).
6. **Guarda de Elegibilidade Mandatória (H-042 Parte B):**
   - Invocação mandatória de `private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)`.
   - Exige que o profissional esteja com `verification_status = 'aprovada'`, `account_state = 'ativo'`, `email_verified = true` e acesso comercial vigente (trial ativo, assinatura ativa, período de carência de 72 h ou cancelada em vigência).
   - Profissional não elegível recebe recusa HTTP `403 Forbidden` com código uniforme `{code: "profissional_inelegivel"}` (sem vazar motivo detalhado nem situação financeira).
7. **Validação de Territorialidade e Compatibilidade de Serviço:**
   - O profissional deve possuir em seu perfil (`app.professional_service`) o serviço exato do pedido (`service_id`).
   - Modalidade presencial: o centro da célula da base do profissional deve estar dentro do raio declarado (5 a 100 km) em relação ao centro da célula do pedido (`distance_m <= radius_m`).
   - Modalidade online: serviço declarado online de alcance nacional.
   - Caso incompatível: recusa com HTTP `403 Forbidden` `{code: "servico_ou_raio_incompativel"}`.
8. **Impedimento de Auto-aceite:**
   - O profissional não pode aceitar um pedido de serviço publicado por ele próprio (`service_request.customer_user_id != professional_user_id`). Se tentar, responde HTTP `403 Forbidden` `{code: "autoaceite_proibido"}`.
9. **Controle de Vagas (1ª e 2ª Onda) e Teto:**
   - Capacidade calculada dinamicamente sob o lock:
     - Se `wave2_opened_at IS NULL`: capacidade máxima = 4 vagas.
     - Se `wave2_opened_at IS NOT NULL`: capacidade máxima = 8 vagas.
   - Se `acceptances_count >= capacidade`: recusa com HTTP `409 Conflict` `{code: "sem_vagas"}` (mensagem neutra sem divulgar contadores, ondas ou vagas restantes; RF-066, RF-071, AMB-04 A).
10. **Unicidade de Aceite e Bloqueio de Reaceite:**
    - Verificação na tabela `app.acceptance` para a tupla `(request_id, professional_id)`:
      - Se já existe com `status = 'ativo'`: responde HTTP `200 OK` devolvendo o aceite existente (idempotência natural).
      - Se já existe com `status in ('retirado', 'removido_por_seguranca')`: recusa com HTTP `409 Conflict` `{code: "reaceite_proibido"}` (quem retirou o aceite jamais pode aceitar de novo o mesmo pedido; decisão 19, SD-18).
11. **Unicidade de Identidade (Anti-fraude de CPF/CNPJ):**
    - Derivação determinística de `identity_id = private.identity_id_from_document_hmac(document_hmac)`.
    - Verificação de constraint única `(request_id, identity_id)` em `app.acceptance`.
    - Se outro perfil com o mesmo CPF/CNPJ já tiver aceito o pedido: recusa com HTTP `409 Conflict` `{code: "aceite_duplicado_identidade"}` (I-02, C-03).
12. **Persistência Atômica do Aceite, Conversa e Mensagem de Sistema:**
    - Em operação única e indivisível (tudo ou nada):
      - Inserção em `app.acceptance` (`id`, `request_id`, `professional_id`, `identity_id`, `slot_no = acceptances_count + 1`, `wave = ((slot_no - 1)/4) + 1`, `status = 'ativo'`, `accepted_at = p_now`);
      - Atualização em `app.service_request` (`acceptances_count = acceptances_count + 1`, `version = version + 1`);
      - Inserção em `app.conversation` (`id`, `request_id`, `customer_user_id`, `professional_id`, `acceptance_id`, `state = 'ativa'`, `created_at = p_now`);
      - Inserção em `app.message` (`id`, `conversation_id`, `kind = 'sistema'`, `sender_user_id = null`, `system_event = 'aceite'`, `template_version = 1`, `dedupe_key = 'acceptance:' || id || ':accepted'`, `body_text = null`, `state = 'enviada'`, `created_at = p_now`);
      - Inserção em `ops.outbox_event` do evento `WorkAccepted` (`aggregate_type = 'service_request'`, `aggregate_id = request_id`, payload com identificadores opacos e timestamps, sem PII).
13. **Desbloqueio de Dados Autorizados do Cliente:**
    - O primeiro nome do cliente (`first_name`) passa a ser liberado na resposta e nas visualizações autorizadas do profissional (RF-110, FA-009).
    - Concretização de `private.request_acceptance_active(p_request_id, p_professional_id)` retornando `true`, permitindo acesso aos dados protegidos do pedido e telefone (quando concedido opt-in).
14. **Contrato de Resposta HTTP:**
    - Resposta HTTP `201 Created` no primeiro aceite; HTTP `200 OK` em repetição idempotente.
    - Envelope JSON estruturado com dados do aceite e da conversa criada.
    - Cabeçalhos de segurança: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json; charset=utf-8`.
15. **Suíte Completa de Testes Automatizados:**
    - Testes unitários de domínio e validação de corpo;
    - Testes de concorrência com 10 requisições simultâneas (C-03, C-16, nunca 9 aceites);
    - Testes de injeção de falhas e rollback total (F-01, F-10);
    - Testes de integridade da mensagem de sistema e outbox.

---

## 4. Fora de escopo

- **Abertura da 2ª onda / Botão "Chamar mais profissionais":** pertence à história H-060 (#134) e H-059 (#72). H-058 apenas respeita a flag `wave2_opened_at` pré-existente no pedido para definir o teto (4 ou 8).
- **Retirada do aceite pelo profissional (`POST .../withdraw`):** pertence à história H-061 (#73). H-058 apenas checa se já houve retirada para impedir o reaceite.
- **Encerramento formal de pedidos aos 7 dias corridos:** pertence a H-062 (#74). H-058 apenas lê o prazo `acceptance_deadline_at` e recusa aceites posteriores.
- **Envio e troca de mensagens de texto humanas no chat:** pertence a H-066 (#77). H-058 cria a conversa e a mensagem inicial de sistema, mas não processa envio humano de mensagens.
- **Bloqueio total de anexos no chat:** pertence a H-067 (#78).
- **Notificações por e-mail de aviso de aceite:** pertencem a H-095 (#105). H-058 apenas emite o evento `WorkAccepted` em `ops.outbox_event`.
- **Seleção do profissional pelo cliente e conclusão:** pertencem a H-074 (#84), H-075 (#85) e H-078 (#88).
- **Aviso "FastPro apenas conecta; não é contrato" no botão de aceite:** formalmente proibido em telas ou botões pela decisão 22 e RF-078 (constará apenas nos termos de uso, sob H-063 / #135 e revisão jurídica L2/L7).
- **Negociação de preço, orçamento, prazos ou escrow financeiro:** proibição total no sistema (H4, decisão 4, RF-070, I-26, T-17). O FastPro não intermedia pagamento de serviços nem colhe propostas.
- **Docker, containers ou serviços externos de mapa em tempo de execução:** estritamente proibidos em desenvolvimento.
- **Backup e rotinas de exportação de dados:** formalmente extintos do projeto pela decisão 151.

---

## 5. Fluxos e estados

### 5.1 Rota e sequência de execução

O fluxo de processamento de `POST /v1/requests/:id/acceptances` é totalmente atômico e protegido por bloqueio pessimista:

```
[Profissional Autenticado]
        |
        | POST /v1/requests/{id}/acceptances
        | Headers: Cookie fastpro_session, Idempotency-Key: <UUID>
        | Body: {} (estritamente vazio)
        v
[1. Middleware de Autenticação]
   - Sem sessão ou sessão expirada? -------------> 401 sessao_necessaria
   - Usuário não possui professional_profile? ----> 403 perfil_profissional_obrigatorio
        |
        v
[2. Validação de Idempotência de Borda]
   - Falta cabeçalho Idempotency-Key? -----------> 400 chave_idempotencia_obrigatoria
   - UUID de Idempotency-Key inválido? ----------> 400 chave_idempotencia_invalida
   - Corpo contém campos extras (preço/prazo)? --> 422 campos_extras_recusados (H-064)
   - Chave em andamento no banco? ---------------> 409 operacao_em_andamento (Retry-After: 1)
   - Chave concluída com corpo idêntico? --------> 200 OK (Replay da resposta anterior)
   - Chave concluída com corpo diferente? -------> 422 chave_reutilizada_com_corpo_diferente
        |
        v
[3. Início de Transação DB & Lock]
   - BEGIN TRANSACTION;
   - SET LOCAL lock_timeout = '3s';
   - SELECT * FROM app.service_request WHERE id = :id FOR UPDATE;
        |
        +---> Pedido inexistente? ----------------> 404 pedido_nao_encontrado
        +---> Status != 'publicado' ou expirado? -> 409 admissao_encerrada
        +---> Profissional é o dono do pedido? ---> 403 autoaceite_proibido
        |
        v
[4. Verificações de Elegibilidade e Compatibilidade]
   - private.professional_access_guard(prof, 'descoberta_aceite', now) = false?
        +----------------------------------------> 403 profissional_inelegivel
   - Serviço ou raio geográfico incompatível? ----> 403 servico_ou_raio_incompativel
        |
        v
[5. Verificações de Unicidade e Vagas]
   - Já existe aceite ativo do profissional? -----> 200 OK (Idempotente de domínio)
   - Já existe aceite retirado do profissional? --> 409 reaceite_proibido (SD-18)
   - Já existe aceite do mesmo CPF/CNPJ? ---------> 409 aceite_duplicado_identidade (I-02)
   - acceptances_count >= capacidade (4 ou 8)? ----> 409 sem_vagas (AMB-04 A, RF-066)
        |
        v
[6. Gravação Atômica (No mesmo COMMIT)]
   - INSERT INTO app.acceptance (slot_no, wave, status='ativo', ...)
   - UPDATE app.service_request SET acceptances_count += 1, version += 1
   - INSERT INTO app.conversation (state='ativa', ...)
   - INSERT INTO app.message (kind='sistema', system_event='aceite', text="Estou disponível...", dedupe_key=...)
   - INSERT INTO ops.outbox_event (event_type='WorkAccepted', ...)
   - INSERT INTO ops.idempotency_key (status='concluida', response_payload=...)
   - COMMIT;
        |
        v
[7. Resposta HTTP 201 Created]
   - Devolve { acceptance: {...}, conversation: {...}, customer: { first_name: "..." } }
   - Telefone desbloqueado via contact_reveal_phone (se opt-in concedido)
```

### 5.2 Estados do Aceite e da Conversa

```
                     [Profissional Clica "Aceitar trabalho"]
                                       |
                                       v
                            +--------------------+
                            |  acceptance: ATIVO |
                            | conversation: ATIVA|
                            +--------------------+
                                       |
            +--------------------------+--------------------------+
            | (H-061: Retirada)                                   | (H-074: Selecionado)
            v                                                     v
+------------------------+                               +------------------------+
|  acceptance: RETIRADO  |                               | acceptance: ATIVO      |
| conversation: SOMENTE  |                               | (SELECIONADO)          |
|              LEITURA   |                               | conversation: ATIVA    |
+------------------------+                               +------------------------+
  - Vaga NÃO é liberada                                    - Aceites encerrados
  - Reaceite PROIBIDO                                      - Demais viram leitura
```

### 5.3 Composição Atômica da Mensagem de Sistema

Conforme ADR-010, ADR-021 e decisões 14 e 26:
- A mensagem de sistema é persistida na tabela `app.message` na **mesma transação** de criação do aceite.
- Propriedades obrigatórias:
  - `kind`: `'sistema'`;
  - `sender_user_id`: `NULL` (mensagens de sistema não possuem remetente de usuário);
  - `system_event`: `'aceite'`;
  - `params`: `jsonb_build_object('acceptance_id', v_acceptance_id, 'slot_no', v_slot_no)`;
  - `template_version`: `1`;
  - `dedupe_key`: `'acceptance:' || v_acceptance_id::text || ':accepted'` (garante unicidade estrita por índice parcial único);
  - `body_text`: `NULL` (o texto físico exibido na interface é resolvido pelo modelo fixo aprovado: `"Estou disponível para trabalhar"`, RF-075, decisão 14);
  - `state`: `'enviada'`.

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-058 atende |
|---|---|---|---|
| RN-H058-01 | **Fim da oferta e corpo vazio.** Não existe proposta, preço, prazo ou edição. O corpo da requisição é estritamente vazio. Qualquer campo extra devolve HTTP 422 e nada é persistido. | H4, RF-070; I-26, T-16; H-064 | Validação rigorosa de payload vazio no schema Zod da rota; CA-H058-03 |
| RN-H058-02 | **Idempotência tripla mandatória.** Proteção por `Idempotency-Key` na borda, unique de domínio `(request_id, professional_id)` no banco e `dedupe_key` na mensagem de sistema. | RF-069, RF-088; ADR-021; C-16 | Registro em `ops.idempotency_key` e constraint única de banco; CA-H058-01, 02, 13 |
| RN-H058-03 | **Concorrência serializada por agregado.** O processamento de aceites adquire lock pessimista exclusivo `FOR UPDATE` no registro de `service_request` com timeout de 3 s. | ADR-003, 08 §7.1, §7.2; FA-035 | Lock pessimista na tabela de pedidos antes da contagem de vagas; CA-H058-04 |
| RN-H058-04 | **Controle estrito de vagas (4+4, teto 8).** A 1ª onda admite até 4 aceites (`slot_no` 1 a 4). Slots 5 a 8 exigem `wave2_opened_at IS NOT NULL`. O 9º aceite é invariavelmente impossível. | RF-066, RF-067, RF-074; I-01; D3/H4 | Cálculo de capacidade e verificação de `acceptances_count < capacidade`; CA-H058-05 |
| RN-H058-05 | **Silêncio de vagas e concorrência.** Respostas de sucesso e mensagens de erro não revelam a contagem de vagas consumidas, vagas restantes ou número da onda. | RF-066, RF-071, AMB-04 A; FA-010 | Mensagem padronizada `{code: "sem_vagas"}` sem números; CA-H058-05 |
| RN-H058-06 | **Admissão temporal estrita.** Aceites só são admitidos com `status = 'publicado'` e `p_now < acceptance_deadline_at`. Pedidos selecionados, concluídos, cancelados ou com mais de 7 dias são recusados. | RF-072; I-05; FA-012 | Checagem de status e prazo absoluto de 168 h sob lock; CA-H058-06 |
| RN-H058-07 | **Elegibilidade total do profissional.** O profissional deve cumprir `private.professional_access_guard` modo `descoberta_aceite` (aprovado, ativo, e-mail verificado e acesso comercial vigente). | RF-050, RF-065; FA-004, FA-025; 08 §9.3 | Invocação da guarda de elegibilidade única da Issue #55; CA-H058-07 |
| RN-H058-08 | **Compatibilidade de serviço e território.** O profissional deve declarar o serviço em seu perfil e estar dentro do raio presencial (5–100 km) ou o serviço ser de abrangência online nacional. | RF-051; 08 §9.3 | Revalidação sob lock na tabela de áreas e serviços do profissional; CA-H058-08 |
| RN-H058-09 | **Impedimento de auto-aceite.** Um usuário não pode aceitar seu próprio pedido publicado como cliente. | 08 §7.2; regra de integridade | Checagem `service_request.customer_user_id != user.id`; CA-H058-09 |
| RN-H058-10 | **Unicidade por documento (CPF/CNPJ).** Uma mesma identidade física só pode aceitar o pedido uma única vez, impedindo que contas múltiplas do mesmo titular ocupem mais de 1 vaga. | I-02; C-03; 09 §3.5 | Derivação de `identity_id` e unique `(request_id, identity_id)`; CA-H058-10 |
| RN-H058-11 | **Proibição definitiva de reaceite.** Quem retirou o aceite (`status = 'retirado'`) não pode aceitar novamente o mesmo pedido (a vaga permanece consumida para sempre). | Decisão 19, SD-18; RF-077; I-22 | Checagem de status anterior em `app.acceptance`; CA-H058-11 |
| RN-H058-12 | **Atomicidade tudo-ou-nada (COMMIT único).** Aceite, incremento de contadores, criação de conversa, gravação da mensagem de sistema e evento de outbox ocorrem no mesmo COMMIT. | RF-075; ADR-021; F-01, F-10 | Transação ACID única com rollback integral em caso de falha em qualquer passo; CA-H058-12 |
| RN-H058-13 | **Mensagem de sistema automática.** Mensagem inicial do aceite com texto fixo "Estou disponível para trabalhar", tipo `sistema`, remetente nulo e imutável. Não editável. | Decisões 14 e 26; RF-075; I-03 | Inserção com `kind='sistema'` e `dedupe_key` padronizada; CA-H058-13 |
| RN-H058-14 | **Liberação do primeiro nome do cliente.** O profissional passa a ter direito de ler `service_request.first_name` apenas após o aceite ativo; e-mail nunca é exposto. | RF-110, RF-137; FA-009, I-16, T-03 | Projeção condicional no serializer da resposta; CA-H058-14 |
| RN-H058-15 | **Desbloqueio de telefone sob opt-in.** A função `private.request_acceptance_active` é concretizada retornando `true`, liberando a revelação de telefone para profissionais aceitos. | Decisão 448; H-033 (#46); RF-016 | Substituição da stub fechada por checagem real em `app.acceptance`; CA-H058-15 |
| RN-H058-16 | **Disparo de evento de outbox para notificações.** Emissão de `WorkAccepted` em `ops.outbox_event` para processamento assíncrono de notificações de e-mail pela Issue #105. | RF-115; ADR-011, ADR-021 | Gravação de evento estruturado no outbox; CA-H058-16 |
| RN-H058-17 | **Proibição de aviso no botão ou tela.** O aviso "FastPro apenas conecta; não é contrato" não deve constar no botão "Aceitar trabalho" nem em diálogos de confirmação (só em Termos de Uso). | Decisão 22, RF-078; AMB-28 | Interface e contratos livres de cláusulas de contrato no endpoint; CA-H058-17 |
| RN-H058-18 | **Imutabilidade e proibição de DELETE.** Registros de aceite e mensagens de sistema não podem ser excluídos fisicamente do banco de dados (`DELETE` negado por trigger/RLS). | RF-103; 09 §3.5, §3.7; I-13 | Triggers de banco bloqueando remoções; CA-H058-18 |

Invariantes citadas:
- **I-01:** Aceites por pedido ≤ 4 se `wave2_opened_at` nulo; ≤ 8 sempre; `acceptances_count` = total de linhas em `acceptance`.
- **I-02:** Um profissional e uma identidade (CPF/CNPJ) ocupam no máximo um aceite por pedido (regra única, válida após retirada).
- **I-03:** Cada aceite possui exatamente 1 conversa e exatamente 1 mensagem de sistema de aceite.
- **I-05:** Aceite somente com `status = 'publicado'` e `now() < acceptance_deadline_at`.
- **I-16:** Consulta de pedidos e aceites jamais retorna e-mail do cliente; telefone apenas sob consentimento com revelação auditada.
- **I-22:** Retirada do aceite mantém a vaga consumida e impede novo aceite pelo mesmo profissional.
- **I-26:** Nenhuma entidade de oferta ou campo de preço/prazo existe no banco ou na API.
- **P4:** Prazos e vigências avaliados no instante `p_now` fornecido pela aplicação (tempo resolvido no uso).

---

## 7. Critérios de aceite (Given / When / Then)

Todos os critérios são mensuráveis, testáveis e devem ser comprovados por suíte automatizada de testes locais (unitários, integração e banco com rollback).

- **CA-H058-01 (Autenticação e sessão obrigatórias).**
  - **Dado** uma requisição `POST /v1/requests/:id/acceptances` sem o cookie de sessão `fastpro_session` ou com cookie expirado/inválido,
  - **Quando** acionada,
  - **Então** responde HTTP `401 Unauthorized` `{ code: "sessao_necessaria" }`, com `Cache-Control: no-store` e nenhuma mutação no banco.

- **CA-H058-02 (Perfil não profissional recebe recusa).**
  - **Dado** uma sessão válida de um usuário cliente que não possui registro em `app.professional_profile`,
  - **Quando** requisita o aceite de um pedido,
  - **Então** responde HTTP `403 Forbidden` `{ code: "perfil_profissional_obrigatorio" }`.

- **CA-H058-03 (Corpo com campos extras é rejeitado com 422 — H-064).**
  - **Dado** uma requisição de aceite enviada com payload contendo campos adicionais como `{"price": 15000}`, `{"deadline_days": 3}`, `{"message": "Faço amanhã"}` ou `{"attachment": "url"}`,
  - **Quando** processada pela API,
  - **Então** responde HTTP `422 Unprocessable Entity` `{ code: "campos_extras_recusados" }`, garantindo que nada seja persistido como proposta ou oferta comercial.

- **CA-H058-04 (Exigência e validação do cabeçalho Idempotency-Key).**
  - **Dado** uma requisição de aceite enviada sem o cabeçalho `Idempotency-Key` ou com valor que não seja um UUID v4 válido,
  - **Quando** processada,
  - **Então** responde HTTP `400 Bad Request` `{ code: "chave_idempotencia_obrigatoria" }` (ou `chave_idempotencia_invalida`).

- **CA-H058-05 (Aceite bem-sucedido dentro da 1ª onda).**
  - **Dado** um profissional elegível com serviço compatível e base dentro do raio de um pedido publicado com 2 vagas ocupadas (`acceptances_count = 2`) e `wave2_opened_at IS NULL`,
  - **Quando** o profissional envia `POST /v1/requests/:id/acceptances` com corpo vazio e `Idempotency-Key` inédita,
  - **Então** responde HTTP `201 Created` contendo o ID do aceite, `slot_no = 3`, `wave = 1`, `status = "ativo"`, o ID da conversa criada, o primeiro nome do cliente (`customer.first_name`) e `acceptances_count` atualizado para 3.

- **CA-H058-06 (Replay idempotente de requisição bem-sucedida).**
  - **Dado** um profissional que já aceitou com sucesso um pedido utilizando uma determinada `Idempotency-Key`,
  - **Quando** a mesma requisição (mesma chave, mesmo profissional, corpo vazio) é reenviada 5 vezes seguidas,
  - **Então** todas as chamadas subsequentes respondem HTTP `200 OK` devolvendo exatamente o mesmo payload de resposta original, sem criar novas vagas, sem criar novas conversas e sem reinserir mensagens de sistema.

- **CA-H058-07 (Teto da 1ª onda atingido bloqueia o 5º aceite sem 2ª onda).**
  - **Dado** um pedido publicado que já atingiu 4 aceites (`acceptances_count = 4`) e cujo botão de 2ª onda ainda não foi acionado pelo cliente (`wave2_opened_at IS NULL`),
  - **Quando** um 5º profissional elegível tenta aceitar o trabalho,
  - **Então** responde HTTP `409 Conflict` `{ code: "sem_vagas" }`, sem divulgar números ou contadores na mensagem.

- **CA-H058-08 (Aceite na 2ª onda aberta e bloqueio no teto absoluto de 8 vagas).**
  - **Dado** um pedido onde o cliente abriu a 2ª onda (`wave2_opened_at IS NOT NULL`) que possui 7 aceites (`acceptances_count = 7`),
  - **Quando** um 8º profissional aceita,
  - **Então** o aceite é deferido com HTTP `201 Created` (`slot_no = 8`, `wave = 2`);
  - **E** quando um 9º profissional tenta aceitar logo em seguida,
  - **Então** recebe HTTP `409 Conflict` `{ code: "sem_vagas" }` (o teto de 8 vagas é intransponível).

- **CA-H058-09 (Admissão encerrada por expiração de prazo de 7 dias).**
  - **Dado** um pedido publicado onde o relógio injetado cumpre `p_now >= acceptance_deadline_at` (168 horas completadas),
  - **Quando** um profissional elegível tenta aceitar,
  - **Então** responde HTTP `409 Conflict` `{ code: "admissao_encerrada" }`, e o pedido não admite novos aceites.

- **CA-H058-10 (Admissão encerrada por seleção ou cancelamento do pedido).**
  - **Dado** um pedido com `status = 'selecionado'` ou `status = 'cancelado'`,
  - **Quando** qualquer profissional tenta aceitar,
  - **Então** responde HTTP `409 Conflict` `{ code: "admissao_encerrada" }`.

- **CA-H058-11 (Profissional com verificação não aprovada é recusado).**
  - **Dado** um profissional cuja verificação cadastral está em `pendente`, `em_revisao`, `recusada`, `retida_duplicidade` ou `suspensa`,
  - **Quando** tenta aceitar um pedido,
  - **Então** responde HTTP `403 Forbidden` `{ code: "profissional_inelegivel" }`, e nada é gravado.

- **CA-H058-12 (Profissional com acesso comercial expirado é recusado).**
  - **Dado** um profissional aprovado, mas cujo acesso comercial está expirado (trial expirado ou assinatura vencida há mais de 72 h de carência no instante `p_now`),
  - **Quando** tenta aceitar um pedido,
  - **Então** responde HTTP `403 Forbidden` `{ code: "profissional_inelegivel" }`, sem vazar detalhes financeiros na resposta.

- **CA-H058-13 (Tentativa de auto-aceite pelo próprio cliente é bloqueada).**
  - **Dado** um usuário que publicou um pedido de serviço como cliente e que também possui conta profissional na plataforma,
  - **Quando** ele tenta aceitar o seu próprio pedido,
  - **Então** responde HTTP `403 Forbidden` `{ code: "autoaceite_proibido" }`.

- **CA-H058-14 (Incompatibilidade territorial de raio ou modalidade).**
  - **Dado** um pedido presencial cuja célula dista 40 km da base do profissional, tendo o profissional configurado um raio de atuação de apenas 15 km,
  - **Quando** o profissional requisita o aceite diretamente via API,
  - **Então** responde HTTP `403 Forbidden` `{ code: "servico_ou_raio_incompativel" }`.

- **CA-H058-15 (Bloqueio de aceite duplicado pelo mesmo CPF/CNPJ).**
  - **Dado** dois perfis profissionais distintos no sistema cadastrados sob o mesmo documento físico (`document_hmac` idêntico),
  - **Quando** o perfil P1 aceita o pedido e, posteriormente, o perfil P2 tenta aceitar o mesmo pedido,
  - **Então** a requisição de P2 responde HTTP `409 Conflict` `{ code: "aceite_duplicado_identidade" }`, garantindo que uma identidade física jamais ocupe duas vagas.

- **CA-H058-16 (Tentativa de reaceite após retirada é terminantemente recusada).**
  - **Dado** um profissional que aceitou um pedido e posteriormente retirou seu aceite (`status = 'retirado'`),
  - **Quando** ele tenta acionar novamente o endpoint de aceite para o mesmo pedido,
  - **Então** responde HTTP `409 Conflict` `{ code: "reaceite_proibido" }` (SD-18, Rodada 8 nº 19).

- **CA-H058-17 (Atomicidade do COMMIT: mensagem de sistema e conversa indivisíveis).**
  - **Dado** um cenário de injeção de falha onde a inserção de `app.message` ou o evento de outbox é forçado a falhar,
  - **Quando** a transação de aceite é abortada,
  - **Então** ocorre rollback integral: nenhuma linha em `app.acceptance` é criada, nenhuma conversa é criada em `app.conversation`, a vaga não é consumida e `acceptances_count` permanece inalterado (F-01, F-10).

- **CA-H058-18 (Mensagem de sistema no padrão oficial e não editável).**
  - **Dado** um aceite concluído com sucesso,
  - **Quando** o cliente ou o profissional abre a conversa recém-criada,
  - **Então** a primeira mensagem possui `kind = 'sistema'`, `sender_user_id = null`, exibe o texto fixo `"Estou disponível para trabalhar"`, e qualquer tentativa de `UPDATE` ou `DELETE` sobre ela via API é terminantemente rejeitada.

- **CA-H058-19 (Liberação do primeiro nome do cliente na resposta).**
  - **Dado** um pedido de um cliente chamado "Carlos Alberto Silva" com `first_name = "Carlos"`,
  - **Quando** o profissional elegível conclui o aceite com sucesso,
  - **Então** a resposta HTTP 201 retorna `customer.first_name = "Carlos"`, sem conter sobrenome, e-mail, telefone não autorizado ou endereço exato.

- **CA-H058-20 (Desbloqueio da função de segurança para revelação de telefone).**
  - **Dado** um cliente que marcou opt-in de telefone (`todos_participantes`) na publicação do pedido,
  - **Quando** o profissional conclui o aceite,
  - **Então** a função `private.request_acceptance_active(pedido_id, profissional_id)` passa a devolver `true`, permitindo que o profissional consulte o telefone via rota de revelação de contato com log em `contact_reveal_log`.

- **CA-H058-21 (Concorrência massiva sem exceder o teto — nunca 9 aceites).**
  - **Dado** um pedido aberto na 2ª onda com 7 vagas preenchidas, e 10 profissionais elegíveis disparando aceites simultâneos em paralelo,
  - **Quando** as requisições disputam o lock no banco,
  - **Então** exatamente 1 profissional obtém a 8ª vaga (HTTP 201), os outros 9 recebem HTTP 409 `{ code: "sem_vagas" }`, e `acceptances_count` crava exatamente 8. Prova: teste C-01/C-02.

- **CA-H058-22 (Emissão de evento WorkAccepted no outbox transacional).**
  - **Dado** a conclusão atômica do aceite,
  - **Quando** a tabela `ops.outbox_event` é inspecionada,
  - **Então** contém uma linha com `event_type = 'WorkAccepted'`, associada ao `aggregate_id = request_id`, contendo IDs e timestamps, sem conter e-mail ou dados privados em claro.

---

## 8. Matriz de cenários de teste e cobertura

| Identificador | Cenário de Teste | Condição / Fixture | Resultado Esperado | Critério de Aceite |
|---|---|---|---|---|
| CT-01 | Sessão anônima | Requisição sem cookie `fastpro_session` | 401 `{code: "sessao_necessaria"}` | CA-H058-01 |
| CT-02 | Sessão de cliente | Usuário autenticado sem `professional_profile` | 403 `{code: "perfil_profissional_obrigatorio"}` | CA-H058-02 |
| CT-03 | Campos extras no body | Envio de `{"price": 5000}` no corpo da requisição | 422 `{code: "campos_extras_recusados"}` | CA-H058-03 |
| CT-04 | Sem Idempotency-Key | Cabeçalho ausente na requisição | 400 `{code: "chave_idempotencia_obrigatoria"}` | CA-H058-04 |
| CT-05 | Chave malformada | `Idempotency-Key: "chave-invalida-123"` | 400 `{code: "chave_idempotencia_invalida"}` | CA-H058-04 |
| CT-06 | 1º Aceite bem-sucedido | Elegível, presencial dentro do raio, 0 aceites no pedido | 201 Created, `slot_no = 1`, `wave = 1`, conversa e mensagem criadas | CA-H058-05 |
| CT-07 | Replay com mesma chave | Reenvio da mesma requisição com a mesma chave | 200 OK idêntico, sem novos registros no banco | CA-H058-06 |
| CT-08 | Replay sem chave (domínio) | Reenvio com chave diferente pelo mesmo profissional ativo | 200 OK idêntico (idempotência natural por chave de domínio) | CA-H058-06 |
| CT-09 | Chave com corpo alterado | Reutilização de chave prévia enviando payload diferente | 422 `{code: "chave_reutilizada_com_corpo_diferente"}` | CA-H058-04 |
| CT-10 | Teto da 1ª onda (4 aceites) | Pedido com 4 aceites e `wave2_opened_at IS NULL` | 409 `{code: "sem_vagas"}` para o 5º profissional | CA-H058-07 |
| CT-11 | 2ª onda aberta (5º aceite) | Pedido com 4 aceites e `wave2_opened_at` preenchido | 201 Created, `slot_no = 5`, `wave = 2` | CA-H058-08 |
| CT-12 | Teto absoluto de 8 vagas | Pedido com 8 aceites na 2ª onda | 409 `{code: "sem_vagas"}` para o 9º profissional | CA-H058-08 |
| CT-13 | Prazo de admissão vencido | Pedido com `p_now >= acceptance_deadline_at` (168 h) | 409 `{code: "admissao_encerrada"}` | CA-H058-09 |
| CT-14 | Pedido selecionado | Pedido com `status = 'selecionado'` | 409 `{code: "admissao_encerrada"}` | CA-H058-10 |
| CT-15 | Pedido cancelado | Pedido com `status = 'cancelado'` | 409 `{code: "admissao_encerrada"}` | CA-H058-10 |
| CT-16 | Verificação pendente | Perfil profissional com `verification_status = 'pendente'` | 403 `{code: "profissional_inelegivel"}` | CA-H058-11 |
| CT-17 | Verificação recusada | Perfil com `verification_status = 'recusada'` | 403 `{code: "profissional_inelegivel"}` | CA-H058-11 |
| CT-18 | E-mail não verificado | Perfil aprovado, mas `app_user.email_verified_at IS NULL` | 403 `{code: "profissional_inelegivel"}` | CA-H058-11 |
| CT-19 | Acesso comercial expirado | Assinatura expirada há mais de 72 h da carência | 403 `{code: "profissional_inelegivel"}` | CA-H058-12 |
| CT-20 | Auto-aceite | Profissional tenta aceitar pedido criado por sua conta de cliente | 403 `{code: "autoaceite_proibido"}` | CA-H058-13 |
| CT-21 | Fora do raio presencial | Pedido a 50 km para profissional com raio de 20 km | 403 `{code: "servico_ou_raio_incompativel"}` | CA-H058-14 |
| CT-22 | Serviço não atendido | Profissional não cadastrou a especialidade do pedido | 403 `{code: "servico_ou_raio_incompativel"}` | CA-H058-14 |
| CT-23 | Duplicidade de CPF/CNPJ | Conta 2 do mesmo CPF tenta aceitar pedido já aceito pela Conta 1 | 409 `{code: "aceite_duplicado_identidade"}` | CA-H058-15 |
| CT-24 | Reaceite após retirada | Profissional com aceite `retirado` tenta aceitar novamente | 409 `{code: "reaceite_proibido"}` | CA-H058-16 |
| CT-25 | Falha de injeção e rollback | Queda provocada antes do COMMIT da mensagem de sistema | Rollback total: nenhum aceite ou conversa gravados (F-01, F-10) | CA-H058-17 |
| CT-26 | Mensagem de sistema | Inspecionar a linha em `app.message` criada | `kind='sistema'`, `text="Estou disponível..."`, dedupe válida | CA-H058-18 |
| CT-27 | Exposição de primeiro nome | Inspecionar JSON de resposta 201 | Contém `customer.first_name`; sem e-mail ou endereço | CA-H058-19 |
| CT-28 | Concretização de active | Testar `private.request_acceptance_active` pós-aceite | Retorna `true` para o par (pedido, profissional); `false` para outros | CA-H058-20 |
| CT-29 | Corrida de 10 aceites na 8ª vaga | Disparo simultâneo de 10 conexões na última vaga disponível | Exatamente 1 aceite criado (total 8), 9 recusas (409 sem_vagas) | CA-H058-21 |
| CT-30 | Gravação de outbox | Inspecionar `ops.outbox_event` após aceite | Evento `WorkAccepted` gravado com aggregate correto | CA-H058-22 |
| CT-31 | Ausência de aviso de contrato | Inspecionar texto do botão e contrato da API | Sem menção a "não é contrato"; aviso exclusivo nos Termos | CA-H058-17 |

---

## 9. Dependências

Estado real conferido em `docs/factory/quadro-status.md` e no histórico de decisões consolidadas:

- **H-044 (#57, Trial de 14 dias):** `Concluído` no quadro. Fornece a função determinística de derivação de identidade `private.identity_id_from_document_hmac(p_hmac text)`, essencial para garantir a regra de 1 aceite por documento físico (I-02).
- **H-045 (#58, Acesso comercial derivado):** `Concluído` no quadro. Fornece o livro `billing.access_grant` e a função de vigência comercial `private.commercial_access(p_professional_id, p_at)`.
- **H-042 (#55, Guarda de elegibilidade):** `Concluído` no quadro (Parte A aprovada e concluída na Rodada 140). Disponibiliza a função única de segurança `private.professional_access_guard(p_professional_id, p_mode, p_now)`, que deve ser acionada em modo `descoberta_aceite` no início da transação de aceite.
- **H-031 (#44, Publicação idempotente com 7 dias):** `Concluído` no quadro. Fornece a tabela `app.service_request`, colunas `acceptance_deadline_at`, `acceptances_count`, `wave2_opened_at` e o status `publicado`.
- **H-032 (#45, Visibilidade de localização):** `Concluído` no quadro. Padronizou a coluna `first_name` em `app.service_request` e estabeleceu a matriz de visibilidade para participantes.
- **H-033 (#46, Opt-in de telefone no pedido):** `Concluído` no quadro. Criou as tabelas de consentimento de contato e a assinatura da função stub `private.request_acceptance_active`, que será concretizada por H-058 (decisão 448).
- **H-036 (#49, Perfil, serviços e raio):** `Concluído` no quadro. Fornece `app.professional_service` e `app.professional_area` para validação de compatibilidade territorial.
- **H-064 (#75, Aceite sem campos de conteúdo):** `Backlog` no quadro. O critério de rejeitar campos de preço e prazo com 422 é uma regra de validação mandatória de H-058 e é incorporado neste refino.
- **H-055 (#68, Descoberta de pedidos elegíveis):** `Desenvolvimento` no quadro. Entrega em fatias concluída pelo DEV, aguardando Code Review e QA. O aceite é a etapa que sucede a descoberta.
- **Consumidores que dependem de H-058 (#71):**
  - **H-059 (#72, Backlog):** Vagas 4+4 e teto de 8 (especializações de transição e contadores).
  - **H-061 (#73, Backlog):** Retirada do aceite (atualização de status para `retirado` e conversa para somente leitura).
  - **H-065 (#76, Backlog):** Ciclo de vida estendido da conversa.
  - **H-068 (#136, Backlog):** Renderização e atribuição visual da mensagem automática.
  - **H-074 (#84, Backlog):** Seleção de participante (só pode selecionar quem possui aceite ativo).
  - **H-095 (#105, Backlog):** Envio de e-mail de aviso de aceite ao cliente via consumo do evento do outbox.
- **Condição de Início de Desenvolvimento de H-058:**
  - O início do Desenvolvimento de H-058 (#71) deve aguardar a conclusão formal da história **H-055 (#68)** em Code Review e QA, assegurando que o motor de busca e as chaves de dados do pedido estejam consolidados.

---

## 10. Riscos e mitigações

- **R1. Aceite predatório para colheita de dados pessoais (Scraping de PII / R-26).** Profissionais mal-intencionados poderiam aceitar trabalhos em massa unicamente para descobrir o primeiro nome e tentar obter o telefone do cliente, retirando o aceite em seguida.
  *Mitigação:* Teto rígido de vagas; cada CPF/CNPJ só pode aceitar 1 vez por pedido; quem retira não pode aceitar de novo; a vaga retirada permanece consumida (não se recupera a cota); rate limit estrito na rota de aceite; telefone protegido por opt-in e log auditado em `contact_reveal_log`.
- **R2. Contenção e Deadlock em "Pedidos Quentes" (R-02 / C-15).** Múltiplos profissionais disputando simultaneamente a 4ª ou 8ª vaga de um pedido com alta procura, gerando contenção de conexões no Postgres.
  *Mitigação:* Aquisição serializada de lock exclusivo `FOR UPDATE` no pedido com timeout curto `SET LOCAL lock_timeout = '3s'`. Se a transação não obtiver o lock no prazo, encerra com HTTP 409 `{ code: "contencao_temporaria" }` com cabeçalho `Retry-After: 1`, evitando filas travadas de conexões no banco compartilhado da Supabase.
- **R3. Race Condition no estouro do teto (Vazar o 9º aceite / C-01, C-02).** Duas requisições paralelas avaliando a contagem de vagas ao mesmo tempo e ambas efetuando a inserção.
  *Mitigação:* A contagem de vagas e a verificação do teto rodam obrigatoriamente dentro da transação sob o lock do pedido; a tabela `app.acceptance` possui constraint CHECK `slot_no BETWEEN 1 AND 8` e índice único em `(request_id, slot_no)`. O banco rejeita fisicamente qualquer 9º aceite.
- **R4. Falha parcial de transação deixando estados órfãos (F-01, F-10).** Criação do aceite sem a criação da conversa, ou criação da conversa sem a mensagem automática do sistema.
  *Mitigação:* Atomicidade estrita em transação ACID única no Postgres. O aceite, a conversa, a mensagem de sistema, a atualização do pedido e o outbox ocorrem no mesmo bloco com rollback total em caso de erro em qualquer instrução.
- **R5. Reaceite indevido após retirada pelo profissional (SD-18 / I-22).** Profissional retirando aceite e tentando reaceitar para limpar conversas ou reocupar slots.
  *Mitigação:* Índice único permanente `(request_id, professional_id)` em `app.acceptance`, mantido mesmo após a retirada (`status = 'retirado'`). O banco impede nova inserção e a API responde 409 `{ code: "reaceite_proibido" }`.
- **R6. Confusão do cliente entre aceite e contrato fechado (AMB-28).** Cliente acreditar que o profissional que aceitou o pedido já foi contratado e possui preço/prazo estipulados.
  *Mitigação:* A mensagem de sistema inicial possui redação neutra e clara: `"Estou disponível para trabalhar"`. Não existem campos de preço ou prazo no aceite. A contratação só é concretizada na etapa de seleção (H-074). O aviso de que o FastPro apenas conecta consta dos Termos de Uso (decisão 22).
- **R7. Falha ou esgotamento na infraestrutura de envio de e-mails.** O envio síncrono de notificações de e-mail durante a requisição HTTP poderia provocar timeout do cliente.
  *Mitigação:* Desacoplamento arquitetural total via outbox transacional (`ops.outbox_event`). A rota HTTP de aceite apenas grava o evento `WorkAccepted` e responde de imediato; o worker de notificações processa o envio de forma assíncrona respeitando as cotas do Resend (Issue #105 / ADR-011).
- **R8. Contaminação do banco de desenvolvimento em testes sintéticos.** Testes automatizados concorrentes inserindo dados residuais de aceites.
  *Mitigação:* Execução obrigatória de todos os testes de integração em transação desfeita (`ROLLBACK`) ou com marcadores sintéticos identificados `h058-`, com rotina de limpeza comprovada no pós-teste.

---

## 11. Perguntas ao líder

Lista única numerada de **850 a 869** (conforme orientação oficial). Cada item apresenta as opções consideradas, a recomendação fundamentada do Product Owner e o impacto prático que destrava para o Arquiteto e Desenvolvedor.

**850. Caminho canônico da rota HTTP de aceite.**
Qual caminho exato deve ser registrado na API para a ação de aceitar trabalho?
- (a) `POST /v1/requests/:id/acceptances` — alinhado à especificação canônica de `08-ARQUITETURA.md` §7.2, `14-BACKLOG.md` (H-058) e ADR-021.
- (b) `POST /v1/professional/requests/:id/acceptances` — adicionando o prefixo `/v1/professional/` adotado na descoberta (#68) e detalhes (#45).
- **Recomendação:** (a). Mantém fidelidade estrita ao PRD e à arquitetura canônica aprovada em ADR-021 e §7.2. O recurso aceito é o sub-recurso de aceites do pedido (`/requests/:id/acceptances`). Destrava o desenho de rotas e CA-H058-01.

**851. Validação e exigência do cabeçalho `Idempotency-Key`.**
Como a API deve reagir se o cabeçalho `Idempotency-Key` for omitido ou não for um UUID v4 válido?
- (a) Rejeição obrigatória com HTTP `400 Bad Request` `{ code: "chave_idempotencia_obrigatoria" }` (ou `chave_idempotencia_invalida`).
- (b) Processar a requisição sem chave de borda, confiando apenas na constraint natural de banco `(request_id, professional_id)`.
- **Recomendação:** (a). Conforme ADR-003 e 08 §7.5, operações mutáveis críticas que alocam recursos exigem idempotência explícita na borda para prevenir cobranças/duplicações por retry de rede. Destrava CA-H058-04.

**852. Validação estrita do corpo da requisição (absorção de H-064).**
Qual deve ser o comportamento da rota ao receber um payload JSON contendo qualquer propriedade no corpo?
- (a) Rejeição estrita com HTTP `422 Unprocessable Entity` `{ code: "campos_extras_recusados" }` para qualquer objeto que não seja estritamente vazio `{}`.
- (b) Ignorar silenciosamente os campos enviados e processar o aceite.
- **Recomendação:** (a). Cumpre formalmente H-064, RF-070, I-26 e T-16. Garante que nenhum profissional ou cliente de API imagine que um campo de valor ou prazo foi considerado ou acordado. Destrava CA-H058-03.

**853. Contrato de dados retornado em HTTP 201 Created.**
Quais campos devem compor o envelope JSON devolvido em caso de aceite realizado com sucesso?
- (a) `{ acceptance: { id, requestId, slotNo, wave, status, acceptedAt }, conversation: { id, state }, customer: { firstName } }`.
- (b) Apenas `{ id, status }`.
- **Recomendação:** (a). Fornece à aplicação front-end tudo o que é necessário para redirecionar o profissional diretamente para o chat recém-criado, já exibindo o primeiro nome do cliente, sem requisições adicionais de busca. Destrava o schema de resposta e CA-H058-05.

**854. Código HTTP e comportamento em repetição idempotente.**
Quando a mesma requisição com a mesma `Idempotency-Key` e corpo vazio é reenviada após sucesso prévio, qual deve ser a resposta?
- (a) HTTP `200 OK` devolvendo o payload idêntico gravado no registro de idempotência.
- (b) HTTP `201 Created` idêntico.
- **Recomendação:** (a). Padronizado com as rotas idempotentes do FastPro (publicação #44, trial #57): a primeira execução que cria o recurso devolve 201; consultas idempotentes posteriores devolvem 200 OK com o estado existente. Destrava CA-H058-06.

**855. Tratamento de reaceite pelo mesmo profissional sem `Idempotency-Key` (idempotência de domínio).**
Se o mesmo profissional disparar nova requisição com chave de idempotência nova para um pedido onde seu aceite já está ativo:
- (a) Retornar HTTP `200 OK` com os dados do aceite e da conversa existente, sem criar novo registro (idempotência por chave de domínio).
- (b) Responder erro HTTP 409 Conflict `{ code: "aceite_ja_existente" }`.
- **Recomendação:** (a). Conforme 08 §7.2 passo 3: "Se já existe aceite ativo do mesmo profissional: devolve o aceite existente (200, mesma resposta, nenhum efeito novo)". Isso torna a API imune a falhas de armazenamento de chave pelo cliente. Destrava CT-08.

**856. Tentativa de reaceite após retirada prévia (`status = 'retirado'`).**
Se o profissional já aceitou o pedido no passado e depois retirou o aceite, como o sistema reage se ele tentar aceitar novamente?
- (a) Rejeição com HTTP `409 Conflict` `{ code: "reaceite_proibido" }`.
- (b) Reativar o aceite anterior e devolver 200 OK.
- **Recomendação:** (a). Cumpre expressamente a decisão 19 da Rodada 8, SD-18 e RF-077: quem retirou o aceite jamais pode aceitar de novo o mesmo pedido. Destrava CA-H058-16.

**857. Tentativa de aceite duplicado pelo mesmo documento (CPF/CNPJ).**
Como responder se duas contas profissionais distintas vinculadas ao mesmo CPF/CNPJ tentarem aceitar o mesmo pedido?
- (a) Responder HTTP `409 Conflict` `{ code: "aceite_duplicado_identidade" }`.
- (b) Permitir que ambas aceitem se forem contas separadas.
- **Recomendação:** (a). Conforme regra canônica I-02 e teste C-03: uma identidade física só ocupa 1 vaga por pedido. Utiliza `private.identity_id_from_document_hmac` para fiscalizar. Destrava CA-H058-15.

**858. Tentativa de auto-aceite pelo cliente dono do pedido.**
Se o criador do pedido possuir também perfil profissional e tentar aceitar o próprio pedido:
- (a) Responder HTTP `403 Forbidden` `{ code: "autoaceite_proibido" }`.
- (b) Permitir normalmente o aceite.
- **Recomendação:** (a). Uma transação consigo mesmo não possui valor comercial e geraria distorções em contagem de vagas e chat do cliente consigo mesmo. Destrava CA-H058-13.

**859. Mensagem de erro ao esgotar vagas (silêncio de contadores).**
Qual código e mensagem devem ser emitidos quando um pedido atinge a capacidade máxima (4 vagas na 1ª onda ou 8 na 2ª)?
- (a) HTTP `409 Conflict` `{ code: "sem_vagas" }` com mensagem neutra `"O pedido não está mais disponível para novos atendimentos"`.
- (b) HTTP 409 divulgando o número de aceites (ex.: "Limite de 4 aceites atingido").
- **Recomendação:** (a). Cumpre a decisão canônica de anti-enumeração e privacidade competitiva (RF-066, RF-071, AMB-04 A): clientes e profissionais não devem saber contadores nem posições de vagas. Destrava CA-H058-07 e 08.

**860. Mensagem ao tentar aceitar pedido expirado ou com status encerrado.**
Como a API deve sinalizar a tentativa de aceite quando `p_now >= acceptance_deadline_at` ou o status for `selecionado`/`cancelado`?
- (a) HTTP `409 Conflict` `{ code: "admissao_encerrada" }`.
- (b) HTTP 400 Bad Request.
- **Recomendação:** (a). 409 Conflict representa fielmente que o estado atual do recurso não permite a operação de admissão. Destrava CA-H058-09 e 10.

**861. Revalidação de compatibilidade geográfica e de serviço sob o lock.**
A rota de aceite deve reexecutar o teste de compatibilidade de serviço e raio geográfico do profissional?
- (a) Sim, revalidação obrigatória no banco sob a transação, verificando se o profissional possui o serviço e está dentro do raio presencial (ou online nacional).
- (b) Não, presumir que se ele chamou a rota de aceite, ele já havia descoberto o pedido legitimamente.
- **Recomendação:** (a). Previne ataques de chamada direta à API (`POST /requests/:id/acceptances`) forjando UUIDs de pedidos fora do raio de atuação do profissional (RF-050, T-04). Destrava CA-H058-14.

**862. Resposta para profissional inelegível na guarda de acesso.**
Quando `private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)` retorna `false`:
- (a) Responder HTTP `403 Forbidden` com código uniforme `{ code: "profissional_inelegivel" }` (silêncio financeiro e documental).
- (b) Responder discriminando a causa ("assinatura_vencida", "documento_recusado", etc.).
- **Recomendação:** (a). Segue a política estrita de anti-enumeração e silêncio financeiro consolidada nas decisões 569, 577 e na Issue #68. O profissional consulta suas pendências nas rotas próprias de verificação e assinatura. Destrava CA-H058-11 e 12.

**863. Localização da persistência física de `app.acceptance`.**
Em qual schema e tabela deve residir a entidade de aceite de trabalho?
- (a) Tabela `app.acceptance`, mantendo o padrão adotado para `app.service_request`, `app.request_draft` e `app.media_asset`.
- (b) Schema separado `distribution.acceptance`.
- **Recomendação:** (a). O monólito modular do FastPro concentra as entidades operacionais da aplicação no schema `app`, reservando `ops` para infraestrutura e `private` para funções de banco protegidas. Destrava o modelo físico.

**864. Modelo e integridade da mensagem de sistema automática.**
Como o texto "Estou disponível para trabalhar" deve ser persistido em `app.message`?
- (a) `kind = 'sistema'`, `sender_user_id = null`, `system_event = 'aceite'`, `params = { acceptance_id: ... }`, `body_text = null`, sendo o texto renderizado na apresentação pelo template versionado correspondente (RF-075, 09 §3.7).
- (b) Gravar a string bruta "Estou disponível para trabalhar" na coluna `body_text`.
- **Recomendação:** (a). Garante consistência arquitetural com `09-MODELO-DADOS.md` §3.7 e ADR-010, permitindo internacionalização futura e impedindo falsificação de mensagens de sistema por usuários comuns. Destrava CA-H058-18.

**865. Concretização da função stub `private.request_acceptance_active`.**
Como deve ser reescrita a função de segurança criada como stub na Issue #46 (decisão 448)?
- (a) Substituir o corpo por `SELECT EXISTS(SELECT 1 FROM app.acceptance WHERE request_id = p_request_id AND professional_id = p_professional_id AND status = 'ativo')`.
- (b) Manter como stub e criar outra função.
- **Recomendação:** (a). Cumpre perfeitamente a decisão 448 ("a guarda de aceite nasce fechada até a E6 substituir a função"). Essa substituição destrava imediatamente a revelação de telefone auditada sem alterar os consumidores da Issue #46. Destrava CA-H058-20.

**866. Momento e forma de revelação do telefone do cliente com opt-in.**
O telefone do cliente deve ser retornado diretamente no corpo da resposta 201 do aceite?
- (a) Não, o aceite retorna apenas os dados do pedido e o primeiro nome. A revelação do telefone ocorre sob demanda via rota existente `GET /v1/professional/requests/:id/phone` (Issue #46), que registra a revelação em `app.contact_reveal_log`.
- (b) Sim, incluir o telefone decifrado direto no JSON do aceite.
- **Recomendação:** (a). Preserva a separação de responsabilidades e garante auditoria precisa e individual de quando o profissional efetivamente visualizou o telefone do cliente (decisão 439, 448). Destrava CA-H058-20.

**867. Nome canônico e payload do evento de domínio no Outbox.**
Qual identificador de evento e conteúdo deve ser inserido em `ops.outbox_event`?
- (a) `event_type = 'WorkAccepted'`, com payload `{ requestId, acceptanceId, professionalId, customerUserId, slotNo, acceptedAt }` (sem e-mail, telefone ou nomes em claro).
- (b) `event_type = 'AcceptanceCreated'` com payload completo contendo dados de contato.
- **Recomendação:** (a). Alinhado ao contrato canônico definido em `08-ARQUITETURA.md` §7.6 e `11-ARQ-RISCOS-E-TESTES.md` §3, garantindo privacidade e blindagem de PII no outbox. Destrava CA-H058-22.

**868. Timeout de lock e contingência de contenção.**
Qual parâmetro de timeout deve ser configurado no lock pessimista do pedido para prevenir congelamento de conexões?
- (a) `SET LOCAL lock_timeout = '3s'`, com captura de erro `55P03` (lock_not_available) e resposta HTTP `409 Conflict` `{ code: "contencao_temporaria" }` com `Retry-After: 1`.
- (b) Sem lock timeout, aguardando indefinidamente a liberação do lock.
- **Recomendação:** (a). Protege a aplicação e o banco compartilhado contra exaustão de pool de conexões sob concorrência aguda. Destrava R2 e a resiliência da API.

**869. Rate limit na rota de aceites por profissional.**
Qual teto de taxa de requisições deve ser imposto no endpoint de aceites?
- (a) 20 requisições de aceite por minuto por profissional autenticado (`rate_counter`), com resposta `429 Too Many Requests`.
- (b) Sem rate limit na aplicação.
- **Recomendação:** (a). Um profissional humano operando legitimamente não aceita mais de 20 trabalhos por minuto. Esse limite bloqueia bots de aceitação instantânea em massa e protege a integridade das vagas. Destrava a proteção anti-automação predatória.

---

## 12. Próximos passos

1. **Revisão pelo Líder (Orquestrador):** O líder valida os limites de fronteira com H-059/H-061/H-065/H-095 e consolida as respostas às perguntas **850 a 869** na próxima rodada de decisões de `11-DECISOES.md`.
2. **Transição de Coluna:** A Issue #71 permanece na coluna "Product Owner" do quadro local até que o líder execute a transição para "Arquitetura".
3. **Elaboração do Desenho Técnico:** A Arquitetura desenhará o módulo NestJS/API, o schema de migração para `app.acceptance`, `app.conversation` e `app.message`, a função de lock e substituição de `private.request_acceptance_active`.
4. **Condição de Início de Desenvolvimento:** O Desenvolvimento de H-058 (#71) poderá iniciar assim que a história predecessora **H-055 (#68)** concluir suas etapas de Code Review e QA pelo agy.
