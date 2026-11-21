# Refino H-101 — Canal “no site” (Issue #137)

- **Issue:** #137 `[E11] Canal “no site”` · **História:** H-101 · **Épico:** E11 — Notificações (Ondas 3 a 5) · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-19.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, banco de dados, quadro nem `11-DECISOES.md` foi alterado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-19 local, após a Rodada 144).
- `14-BACKLOG.md` (linha H-101, H-068, H-094, H-092 a H-100, H-065, H-066, H-070, H-058 e §2 Ondas).
- `04-PRD.md` (RF-075, RF-100 a RF-104, RF-115, RF-116, RF-117, RF-120, RF-122; RNF-EMAIL §6.1).
- `05-CRITERIOS-ACEITE.md` (FA-010, FA-011, FA-026, FA-027, FA-029, FA-033).
- `08-ARQUITETURA.md` (§0, §1.1, §4.3, §6.1, §7.2, §11 Chat e Realtime, §12 Notificações, §12.3 Cooldown e Digest, §12.6 Cota e Degradação, §14 Observabilidade).
- `09-MODELO-DADOS.md` (§3.7 chat/mídia: `conversation`, `conversation_member_state`, `message`; §3.11 notifications: `notification_item`, `email_outbox`, `external_quota`; §6 RLS e isolamento; §7 Matriz de dados sensíveis).
- `10-ADRS.md` (ADR-001, ADR-010 Chat e Realtime como sinal, ADR-011 Notificações outbox/digest, ADR-014 Abuso, ADR-020 Limites de serviços, ADR-021 Aceite e mensagens de sistema, ADR-022 E-mails habilitados e cota do Resend).
- `11-ARQ-RISCOS-E-TESTES.md` (Riscos R-27, R-30, R-34; Invariantes I-03, I-23, I-24; Testes Q-01, Q-10, Q-11, FA-029, C-16, N-01 a N-10, F-06, T-02).
- `11-DECISOES.md` (Decisões 4, 10, 14, 15, 22, 23, 26, 27, 28, 32, 33, 448, 569, 582, 800+, Rodadas 5, 8, 9, 12, 13, 128, 142, 144).
- `15-RASTREABILIDADE.md` (linhas FA-029 e M11 Notificações: RF-115, H-068, H-095, H-101).
- `18-PLANO-QA.md` e `19-PLANO-TECNICO-DEV.md` (cenários de cota e teste do canal no site independente de e-mail).
- Refinos prévios de referência estrutural e técnica:
  - `docs/factory/139-REFINO-H055.md` (modelo canônico de estrutura e rigor de PO);
  - `docs/factory/158-REFINO-H058.md` (aceite de trabalho, criação atômica da conversa e mensagem de sistema RF-075);
  - `docs/factory/159-REFINO-H099.md` (pipeline de lembretes e digest).

Limitações `[NÃO VERIFICADO]`:
- O texto original da Issue #137 no GitHub não foi lido por comando de rede (este agente opera no ambiente estritamente local e sem rede externa). O escopo e os critérios de aceite foram consolidados a partir da linha H-101 do backlog canônico (`14-BACKLOG.md`) e do cruzamento minucioso com PRD, Critérios de Aceite, Arquitetura, Modelo de Dados, ADRs e histórico de decisões.
- Nenhum comando destrutivo ou de modificação foi executado no banco de desenvolvimento (ambiente preservado; sem migrations ou escritas nesta fase).
- Não há Docker no ambiente de desenvolvimento: usa-se o projeto Supabase na nuvem ou scripts locais.
- Não há chamadas a provedores externos de mapas (sem Mapbox).
- Não há e-mail real enviado a destinatários humanos em desenvolvimento/teste: o envio real depende estritamente de domínio verificado no Resend (decisão 15). Em desenvolvimento e testes, o envio utiliza Mailpit local ou mock/testkit, com envio desligado/bloqueado para o mundo externo.
- Não há menção a backup de dados (excluído do escopo do projeto pela decisão 151).
- Resposta uniforme sem enumeração de recursos quando aplicável.

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro da fábrica (`docs/factory/quadro-status.md`) lista a Issue #137 (`[E11] Canal “no site”`) na primeira coluna de trabalho ativo: **Product Owner (7)**.
- `[VERIFICADO]` Total de 75 Issues Concluídas no quadro, com as fundações tecnológicas e de arquitetura de identidade, pedidos e notificações já entregues e estáveis:
  - **#18 (`H-005`):** Outbox, jobs, idempotência e `ops.app_config`;
  - **#21 (`H-008`):** Tick de jobs (A, C e D), `JobRegistry` e `private.job_claim`;
  - **#24 a #28 (`H-011` a `H-015`):** Identidade, autenticação e sessão do cliente e profissional;
  - **#44 (`H-031`):** Publicação de pedidos (`app.service_request`, prazo imutável de 168 h, status `publicado`);
  - **#47 (`H-034`):** Painel do cliente na sessão do dono;
  - **#55 (`H-042`):** Guarda de elegibilidade na API e no banco;
  - **#57 (`H-044`):** Ativação de trial de 14 dias (`billing.access_grant` com `type = 'trial'`);
  - **#58 (`H-045`):** Acesso comercial derivado (`billing.access_grant`, `billing.subscription` e função estável `private.commercial_access`);
  - **#102 (`H-092`):** Pipeline de notificações e cooldown (tabelas `ops.email_outbox`, `ops.notification_item`, `ops.notification_cooldown`, `ops.external_quota`, funções `private.notification_ingest` e rotina `processOutbox`);
  - **#103 (`H-093`):** `EmailProviderPort` com adapter Resend e mock de testes;
  - **#104 (`H-094`):** Cota do Resend, cortes por classe e alertas;
  - **#107 (`H-097`):** E-mail de login com prioridade máxima na cota.
- `[VERIFICADO]` Dependências declaradas de H-101 no backlog (`14-BACKLOG.md`):
  1. **H-068 (#136):** `Backlog` no quadro. Define a mensagem automática do aceite (texto fixo "Estou disponível para trabalhar", aviso do sistema com remetente nulo, RF-075, decisões 14 e 26).
  2. **H-094 (#104):** `Concluído` no quadro. Entrega a governança de cota do Resend, cortes por classe e a regra não funcional RNF-EMAIL de degradação graciosa com preservação do site.
- `[VERIFICADO]` **Situação das dependências de negócio, interconexão de épicos e fatiamento de entrega:**
  - **Relação com o Épico E6 (Aceite) e E7 (Chat):**
    - A história H-101 pertence ao épico E11 (Notificações) e define o **Canal "no site"**: a via soberana e independente de e-mail para exibição de indicadores de mensagens não lidas e entrega imediata na interface web.
    - No modelo de dados de referência (`09` §3.7 e `08` §11), as tabelas fundamentais de chat são `app.conversation`, `app.conversation_member_state` e `app.message`.
    - As histórias donas dessas tabelas e de suas mutações principais estão em etapas anteriores do fluxo:
      - **#71 (`H-058`):** `Product Owner` (refino entregue em `158-REFINO-H058.md`). Cria atomicamente `app.acceptance`, abre `app.conversation` e insere a mensagem inicial de sistema do aceite;
      - **#76 (`H-065`):** `Backlog`. Formaliza a criação da conversa e isolamento de participação;
      - **#77 (`H-066`):** `Backlog`. Cria o envio de mensagens de texto humanas e a tabela `app.message`;
      - **#80 (`H-070`):** `Backlog`. Implementa o canal Supabase Realtime privado `conv:{id}` e polling adaptativo de contingência;
      - **#136 (`H-068`):** `Backlog`. Renderização e garantia de idempotência da mensagem automática do aceite.
  - **Consequência arquitetural explícita (Fatiamento de H-101):**
    - **O que pode ser feito e testado integralmente nesta Issue (#137):**
      1. Os contratos de domínio (`UnreadSummary`, `ConversationUnreadState`, `UnreadQueryPort`, `MarkConversationReadPort`);
      2. O endpoint HTTP `GET /v1/me/unread-summary` para consulta agregada e ultraleve de mensagens não lidas por usuário autenticado;
      3. O endpoint HTTP `POST /v1/conversations/:id/read` para marcação atômica e monotônica de leitura;
      4. Os componentes visuais na aplicação web (`apps/web`): badge no cabeçalho/navegação global com acessibilidade WCAG 2.2 AA (FA-033), indicador visual na lista de conversas, e o aviso mandatório na tela pós-publicação do pedido (Decisão 10, RF-115);
      5. O teste de integração provando que mesmo com a cota de e-mail 100% esgotada (simulação de H-094 / Q-01), o canal no site opera com 100% de sucesso, latência normal e integridade;
      6. A integração de retroalimentação com o pipeline de e-mails (RF-117): comprovar que a leitura no site atualiza o estado de modo que o flush de cooldown de 15 min descarte o e-mail como `obsoleto`.
    - **O que só pode terminar após as Issues pendentes (#71, #76, #77, #136):**
      - A homologação ponta a ponta (E2E) com dados reais persistidos no banco de desenvolvimento compartilhado dependerá da aplicação das migrações SQL que criam formalmente `app.conversation`, `app.conversation_member_state` e `app.message` (entregues por #71, #76 e #77). Enquanto essas migrações não forem aplicadas, os testes de H-101 utilizam fixtures locais ou migração complementar de estrutura mínima.

---

## 2. Objetivo

Estabelecer o **Canal "no site"** como a via de comunicação e notificação primária, imediata, transacional e **100% independente do canal de e-mail** no FastPro, assegurando que o cliente e o profissional acompanhem todas as interações da plataforma em tempo real diretamente pela interface web.

A história H-101 resolve um dos riscos operacionais mais críticos identificados na arquitetura (**R-27: cliente não percebe aceites se o e-mail atrasar, cair em spam ou for adiado por corte de cota**):
1. **Indicador de Não Lidas no Site (Badge):** Permite que qualquer usuário autenticado (cliente ou profissional) visualize de imediato, no cabeçalho global e nos menus de navegação, a existência de novas mensagens não lidas em suas conversas de atendimento;
2. **Mensagem Imediata no Aceite:** Garante que no momento em que um profissional elegível aceita um pedido (RF-075), o cliente receba a mensagem automática ("Estou disponível para trabalhar") de forma instantânea na interface, ativando o indicador de não lida sem depender de qualquer fila assíncrona externa;
3. **Independência Absoluta de Provedores de E-mail (RNF-EMAIL, FA-029, Q-01):** Assegura que, mesmo sob falha catastrófica do provedor Resend, instabilidade de SMTP, atraso de rede ou esgotamento total da cota diária (100/dia no plano gratuito), o chat, as mensagens e as notificações em tela continuem funcionando perfeitamente;
4. **Economia de Cota e Eliminação de Resumos Obsoletos (RF-117):** Ao ler a mensagem no site dentro da janela de 15 minutos de cooldown, a leitura registrada na plataforma suprime o disparo de e-mails obsoletos, poupando a cota externa do serviço;
5. **Aviso Mandatório de Retorno (Decisão 10):** Orienta expressamente o cliente, ao término da publicação de um pedido, sobre a necessidade de retornar ao site do FastPro para acompanhar as respostas dos profissionais, mitigando o risco de desatenção por ausência de e-mail.

Resultado de negócio: uma experiência de mensageria transparente, ágil e confiável que nunca deixa cliente ou profissional desinformados, protegendo a conversão da plataforma contra limitações de serviços gratuitos de e-mail.

---

## 3. Escopo (dentro de H-101)

1. **Endpoint de Sumário de Mensagens Não Lidas (`GET /v1/me/unread-summary`):**
   - Criação de rota autenticada e ultraleve na API (`packages/contracts` e `apps/api`);
   - Exige sessão válida do usuário (`SESSION_COOKIE_NAME`);
   - Retorno JSON enxuto: `{ has_unread: boolean, total_unread_conversations: number, updated_at: string }`;
   - Filtro restrito ao contexto do usuário autenticado (cliente ou profissional), garantindo isolamento total entre usuários.
2. **Endpoint de Marcação de Leitura de Conversa (`POST /v1/conversations/:id/read`):**
   - Criação de rota autenticada e idempotente na API;
   - Recebe opcionalmente `{ last_read_message_id?: string }` no corpo;
   - Se `last_read_message_id` não for informado, assume a mensagem mais recente da conversa no instante da requisição;
   - Atualiza atômica e monotonicamente o estado de leitura do membro (`app.conversation_member_state.last_read_message_id`);
   - Responde 200 OK com `{ ok: true, last_read_message_id: string }`.
3. **Regra de Cálculo de Não Lidas no Domínio (`packages/domain`):**
   - Implementação da lógica de cômputo de não lidas:
     - Uma mensagem é considerada não lida para o usuário `U` se seu identificador for estritamente maior que `last_read_message_id` (ou se este for nulo) E a mensagem não tiver sido enviada pelo próprio `U` (para mensagens humanas) OU for mensagem de sistema destinada ao usuário (como a mensagem automática do aceite dirigida ao cliente);
     - Mensagens enviadas pelo próprio usuário nunca contam como não lidas para ele mesmo;
     - A mensagem automática de sistema do aceite gerada no aceite de trabalho (RF-075) nasce marcada como lida para o profissional que aceitou, mas **não lida para o cliente dono do pedido**.
4. **Atualização Visual Imediata e Reatividade na Interface (`apps/web`):**
   - Badge visual de alerta no cabeçalho/barra de navegação global;
   - Exibição de contador numérico (1 a 9, com teto "9+") ou ponto discreto quando `has_unread = true`;
   - Atualização em tempo real via escuta do evento de sinal Realtime (canal privado `user:{id}` ou `conv:{id}`, ADR-010);
   - Mecanismo de contingência por **polling adaptativo com ETag / `since_id`** em caso de ausência ou falha de WebSockets (ADR-010): frequência de 30 s com aba em foco, 120 s em segundo plano, pausado se aba oculta via Page Visibility API.
5. **Indicadores Visuais na Lista de Conversas:**
   - Destaque visual (tipografia em semibold, ponto colorido conforme design system EDS) nas conversas que possuem mensagens não lidas;
   - Exibição da contagem de não lidas por conversa na visualização detalhada.
6. **Aviso Pós-Publicação de Pedido (Decisão 10, RF-115):**
   - Inclusão de card de aviso permanente na tela de sucesso/confirmação imediata após a publicação do pedido (`apps/web`):
     - *"Seu pedido foi publicado! Os profissionais interessados responderão aqui no FastPro. Acesse sua conta periodicamente para conferir novas mensagens e escolher o melhor atendimento."*
7. **Retroalimentação para o Pipeline de E-mails (RF-117):**
   - Ao registrar a leitura no site (`POST /v1/conversations/:id/read`), a condição `isStillRelevant` do pipeline de notificações passa a avaliar que a mensagem já foi lida, descartando o item do outbox como `obsoleto` antes do envio do e-mail.
8. **Isolamento Absoluto contra Degradação de E-mail (FA-029, Q-01):**
   - Blindagem total do canal no site: nenhuma chamada às rotas de mensageria, chat, leitura ou sumário consulta o Resend, Mailpit ou qualquer tabela de fila de e-mail para responder ao usuário.
   - Mesmo com cota do Resend zerada ou provedor fora do ar, a latência e o sucesso do site permanecem inalterados.
9. **Segurança, Anti-Enumeração e Rate Limiting:**
   - Resposta uniforme 404 `{ "code": "conversa_nao_encontrada" }` caso um usuário tente marcar leitura em conversa da qual não é participante;
   - Limite de taxa (rate limiting) no endpoint `unread-summary` (ex.: 120 requisições por minuto por sessão) e em `conversations/:id/read` (60 requisições por minuto).
10. **Acessibilidade e Tokens EDS (FA-033, WCAG 2.2 AA):**
    - Uso exclusivo de tokens de cor do EDS (`packages/tokens`), sem valores hexadecimais literais;
    - Atributos ARIA adequados no badge: `aria-live="polite"` e rótulo explicativo acessível para leitores de tela (`aria-label="X conversas com mensagens não lidas"`).
11. **Suíte de Testes Automatizados:**
    - Testes unitários de domínio para cômputo de não lidas e monotonicidade de leitura;
    - Testes de integração de API para `unread-summary` e `conversations/:id/read`;
    - Teste de degradação e independência comprovando que o site opera normalmente com cota de e-mail esgotada (Q-01 / FA-029);
    - Teste de supressão de e-mail obsoleto via leitura no site (RF-117).

---

## 4. Fora de escopo

- **Criação das tabelas base de chat (`app.conversation`, `app.message`, `app.acceptance`):** pertence formalmente às histórias de Aceite (#71 / H-058) e Chat (#76 / H-065, #77 / H-066). H-101 consome a estrutura e define o estado de leitura `conversation_member_state`.
- **Envio de mensagens de texto humanas pelo chat:** pertence à história H-066 (#77). H-101 apenas reage ao evento de mensagem recebida.
- **Anexos, imagens ou PDFs no chat:** estritamente proibidos em todo o sistema (decisão 33, RF-101, RF-102, H-067 / #78).
- **Implementação do servidor de infraestrutura do Supabase Realtime:** pertence ao Spike S-05 e história H-070 (#80). H-101 define o consumo no cliente e o fallback obrigatório de polling.
- **Pipeline assíncrono de envio de e-mails, templates Resend e controle de cota:** já entregues nas histórias H-092 (#102), H-093 (#103) e H-094 (#104). H-101 apenas dialoga com a regra de relevância (RF-117).
- **Envio de e-mail de mensagem não lida:** pertence à história H-096 (#106).
- **Canais adicionais como Push Notification para navegador/celular, SMS ou WhatsApp:** mantidos fora do MVP conforme PRD RF-121 e decisão do produto.
- **Seleção, cancelamento ou conclusão de pedidos:** pertencem às histórias do épico E8 (#84 a #91).
- **Chamadas externas de mapas:** proibição permanente de chamadas ao Mapbox em tempo de execução no chat.
- **Backup de banco de dados:** excluído em definitivo do escopo do projeto (decisão 151).

---

## 5. Fluxos e estados

### 5.1 Diagrama geral do canal no site e independência de e-mail

```
[Profissional Elegível]
       |
       | POST /v1/requests/{id}/acceptances (Aceitar trabalho)
       v
[API: Transação Atômica do Aceite (H-058 / RF-075)]
       |
       +---> Grava app.acceptance
       +---> Cria app.conversation (membros: cliente e profissional)
       +---> Insere app.message (kind='sistema', "Estou disponível para trabalhar")
       +---> app.conversation_member_state:
       |        - profissional: last_read_message_id = msg.id (LIDA)
       |        - cliente: last_read_message_id = NULL (NÃO LIDA)
       +---> Emite outbox_event('WorkAccepted')
       |
       v (COMMIT)
       |
       +=======================================================+
       |                                                       |
       v (Via Soberana: Canal "No Site" - H-101)               v (Via Externa: E-mail - H-095)
[Sinal Realtime conv:{id} / user:{id}]                  [ops.email_outbox / Pipeline]
       |                                                       |
       | (Cliente com navegador aberto)                        | (Janela de Cooldown: 15 min)
       v                                                       v
[Cliente Web: Recebe sinal leve]                        [Cota Resend estourada ou atraso de rede?]
       |                                                       |
       | Busca GET /v1/me/unread-summary                       +---> SE SIM: E-mail adiado/suprimido!
       v                                                       |     (R-27 evitado: o cliente já viu no site!)
[UI: Badge ACENDE no cabeçalho (1 não lida)]                   |
       |                                                       +---> SE NÃO: E-mail enfileirado normalmente.
       | Cliente clica e abre a conversa                       |
       v                                                       |
[API: POST /v1/conversations/{id}/read]                        |
       | Atualiza last_read_message_id no banco                |
       v                                                       |
[Badge APAGA na interface]                                     |
       |                                                       |
       +-----> Atualiza estado de relevância (RF-117) --------+
               No flush do tick, o e-mail pendente é
               DESCARTADO como "obsoleto" (poupa cota!).
```

### 5.2 Fluxo detalhado de consulta de não lidas (`GET /v1/me/unread-summary`)

1. O cliente HTTP envia `GET /v1/me/unread-summary` acompanhado do cookie de sessão `fastpro_session`.
2. A API valida a presença e integridade do cookie de sessão:
   - Sem sessão ou sessão expirada: responde `401 Unauthorized` com `{ "code": "sessao_necessaria" }`.
3. A API resolve o usuário autenticado (`user_id`).
4. A API executa consulta de leitura agregada (ou função de banco otimizada):
   - Localiza todas as conversas em que `user_id` é participante (`customer_user_id = user_id` ou `professional_id` associado ao usuário);
   - Filtra conversas ativas ou arquivadas sem restrição de segurança;
   - Para cada conversa, verifica se existe ao menos uma mensagem com `id > last_read_message_id` (ou `last_read_message_id IS NULL`), desconsiderando mensagens enviadas pelo próprio usuário;
   - Conta a quantidade total de conversas distintas com mensagens pendentes (`total_unread_conversations`);
   - Define `has_unread = total_unread_conversations > 0`.
5. A API responde `200 OK` com cabeçalho `Cache-Control: no-store` e payload:
   ```json
   {
     "has_unread": true,
     "total_unread_conversations": 2,
     "updated_at": "2026-11-19T14:30:00.000Z"
   }
   ```
6. O componente de navegação no frontend (`HeaderNav`) atualiza o elemento visual do badge.

### 5.3 Fluxo detalhado de marcação de leitura (`POST /v1/conversations/:id/read`)

1. O usuário clica e abre a conversa na interface web (`/pedidos/:id/conversas/:conv_id` ou `/painel/mensagens/:conv_id`).
2. A interface carrega a lista de mensagens da conversa via `GET /v1/conversations/:id/messages`.
3. Imediatamente após a renderização das mensagens em tela, a interface dispara em background `POST /v1/conversations/:id/read` com o payload:
   ```json
   {
     "last_read_message_id": "019343ba-7600-7000-8000-000000000005"
   }
   ```
4. A API valida a sessão:
   - Sem sessão: `401 Unauthorized`.
5. A API verifica a autorização do usuário na conversa:
   - Se o usuário não for participante da conversa: responde uniforme `404 Not Found` com `{ "code": "conversa_nao_encontrada" }` (anti-enumeração).
6. A API valida o `last_read_message_id`:
   - Se informado: verifica se a mensagem pertence à referida conversa; se não pertencer, responde `400 Bad Request` com `{ "code": "mensagem_invalida" }`;
   - Se omitido: obtém o `id` da mensagem mais recente daquela conversa.
7. A API executa a atualização atômica e monotônica em `app.conversation_member_state`:
   - Atualiza `last_read_message_id = GREATEST(last_read_message_id, p_new_id)` (ou critério monotônico por timestamp/UUID v7);
   - Registra o instante da leitura.
8. A API responde `200 OK` com:
   ```json
   {
     "ok": true,
     "last_read_message_id": "019343ba-7600-7000-8000-000000000005"
   }
   ```
9. A interface web decrementa/apaga localmente o contador do badge e atualiza a lista de conversas.
10. O evento de leitura fica disponível para que o módulo de notificações de e-mail descarte itens de resumo que tenham ficado obsoletos (RF-117).

### 5.4 Estados do indicador e da conversa

```
+--------------------------------------------------------------------------------+
| ESTADOS DE LEITURA NA CONVERSA                                                 |
+--------------------------------------------------------------------------------+
|                                                                                |
|  [Sem Mensagens Pendentes] <------- (Usuário abre conversa / POST read)        |
|     - has_unread = false                                                       |
|     - last_read_message_id >= MAX(message.id)                                  |
|     - Badge desligado / neutro                                                 |
|            |                                                                   |
|            | Nova mensagem chega (aceite de sistema ou mensagem do outro)     |
|            v                                                                   |
|  [Mensagem Não Lida Presente]                                                  |
|     - has_unread = true                                                        |
|     - last_read_message_id < MAX(message.id) OU last_read_message_id IS NULL   |
|     - Badge ACESO no cabeçalho (exibe "1" ou ponto)                            |
|     - Destaque em negrito na listagem de conversas                             |
|                                                                                |
+--------------------------------------------------------------------------------+
```

---

## 6. Regras de negócio

- **RN-H101-01 (Independência Absoluta do Canal de E-mail — R-27, RNF-EMAIL):** O Canal "no site" é o canal oficial e soberano de entrega e consumo de informações. Nenhuma funcionalidade de chat, visualização de aceites, indicador de mensagens ou navegação no site pode depender, esperar ou ser bloqueada por indisponibilidade, recusa de rede, erro ou esgotamento de cota do serviço de e-mail.
- **RN-H101-02 (Mensagem Automática do Aceite como Não Lida para o Cliente — RF-075, RF-115):** No ato atômico do aceite de trabalho pelo profissional, a mensagem automática de sistema ("Estou disponível para trabalhar") é criada com estado não lido para o cliente dono do pedido, acendendo imediatamente o badge do cliente no site.
- **RN-H101-03 (Não Auto-Notificação — Usabilidade e Domínio):** O profissional que realiza o aceite de trabalho não tem seu badge ativado pela sua própria mensagem automática. Para o profissional remetente, o estado inicial da conversa nasce com a mensagem de aceite considerada lida. De forma análoga, nenhuma mensagem enviada pelo próprio usuário ativa badge de não lida para si mesmo.
- **RN-H101-04 (Métrica de Contagem por Conversas Distintas — UX e EDS):** O indicador numérico do badge no cabeçalho representa a quantidade de **conversas distintas** com ao menos uma mensagem não lida, e não o somatório total de mensagens. Para valores superiores a 9, a interface exibe a notação padronizada **"9+"**.
- **RN-H101-05 (Marcação Atômica e Monotônica de Leitura):** A marcação de leitura de uma conversa atualiza `last_read_message_id` de forma estritamente monotônica crescente. Uma requisição com ID de mensagem antigo ou defasado jamais rebaixa o ponteiro de leitura da conversa.
- **RN-H101-06 (Supressão de E-mails Obsoletos — RF-117):** Se o destinatário ler as mensagens de uma conversa na interface web antes do encerramento da janela de cooldown do digest de e-mails (15 minutos), o pipeline de notificações deve reconhecer a leitura na checagem de relevância (`isStillRelevant`) e descartar silenciosamente o e-mail de notificação de mensagens não lidas com o status `obsoleto`, economizando a cota do Resend.
- **RN-H101-07 (Desarquivamento Automático por Nova Mensagem — RF-104):** Caso uma conversa tenha sido arquivada individualmente pelo usuário (`archived_at IS NOT NULL`), a chegada de uma nova mensagem pelo interlocutor faz a conversa voltar a contar no indicador de não lidas e a reexibe na caixa de entrada principal do usuário.
- **RN-H101-08 (Exclusão de Conversas com Restrição de Segurança):** Conversas bloqueadas com `state = 'restrita_por_seguranca'` (RF-102) não incrementam o badge de não lidas e têm seu envio desabilitado.
- **RN-H101-09 (Aviso Mandatório de Retorno na Publicação — Decisão 10, RF-115):** A tela de confirmação e sucesso de publicação do pedido pelo cliente deve exibir de forma compulsória e em destaque a orientação de que os aceites e contatos dos profissionais ocorrerão dentro da plataforma, alertando o usuário a retornar com frequência para checar suas mensagens.
- **RN-H101-10 (Anti-Enumeração Estrita):** Tentativas de consulta ou marcação de leitura em identificadores de conversas que não pertençam ao usuário autenticado devem responder uniformemente com HTTP 404 `{ "code": "conversa_nao_encontrada" }`, impedindo a descoberta da existência de conversas de terceiros.
- **RN-H101-11 (Acessibilidade e Tokens EDS — FA-033, WCAG 2.2 AA):** O badge visual deve utilizar estritamente os tokens semânticos do EDS (`packages/tokens`), com contraste mínimo de 4,5:1, sem depender exclusivamente da cor para transmitir informação, contendo rótulo acessível via `aria-label` e container com `aria-live="polite"`.
- **RN-H101-12 (Estratégia de Polling Adaptativo — ADR-010):** Quando o cliente web não puder utilizar a conexão Realtime por WebSockets, o fallback de polling deve seguir intervalo adaptativo (30 segundos em foco, 120 segundos em aba secundária) e suspender completamente as requisições se a aba for ocultada ou minimizada (Page Visibility API), evitando sobrecarga desnecessária na infraestrutura serverless da Vercel e do Supabase.

---

## 7. Critérios de aceite Given/When/Then testáveis com prova

### Bloco A: Indicador de Não Lidas e Consulta de Sumário

- **CA-H101-01 [GET /v1/me/unread-summary — Usuário sem mensagens não lidas]**
  - **Dado** um usuário autenticado (cliente ou profissional) que não possui nenhuma conversa com mensagens pendentes,
  - **Quando** envia `GET /v1/me/unread-summary`,
  - **Então** a API responde `200 OK` com `{ "has_unread": false, "total_unread_conversations": 0, "updated_at": "..." }`,
  - **E** a interface web não exibe o badge numérico no cabeçalho.
  - *Prova:* Teste automatizado de rota validando status 200 e payload zerado.

- **CA-H101-02 [GET /v1/me/unread-summary — Cliente recebe primeiro aceite (RF-075, RF-115)]**
  - **Dado** um cliente autenticado com um pedido publicado,
  - **Quando** um profissional elegível aceita o pedido gerando atomicamente a conversa e a mensagem de sistema "Estou disponível para trabalhar",
  - **Então** a consulta `GET /v1/me/unread-summary` para o cliente retorna `200 OK` com `{ "has_unread": true, "total_unread_conversations": 1 }`,
  - **E** o badge no cabeçalho do cliente acende exibindo o indicador visual "1".
  - *Prova:* Teste de integração de aceite e consulta de sumário atestando `has_unread = true`.

- **CA-H101-03 [Profissional não recebe badge pelo próprio aceite (Não auto-notificação)]**
  - **Dado** o profissional elegível que acabou de aceitar um pedido de serviço,
  - **Quando** esse profissional consulta `GET /v1/me/unread-summary`,
  - **Então** o sumário retorna `has_unread: false` (ou contagem inalterada em relação a mensagens de outras conversas),
  - **E** a mensagem automática do seu próprio aceite não conta como não lida para ele.
  - *Prova:* Teste de unidade/integração verificando que `last_read_message_id` do profissional é sincronizado com a mensagem criada ou que a regra desconsidera auto-mensagens.

- **CA-H101-04 [Múltiplas conversas com mensagens e teto visual 9+]**
  - **Dado** um cliente que possui 12 conversas com diferentes profissionais, todas contendo mensagens não lidas,
  - **Quando** a API retorna `{ "has_unread": true, "total_unread_conversations": 12 }`,
  - **Então** o componente visual do badge na interface web renderiza o texto **"9+"** com atributo acessível `aria-label="12 conversas com mensagens não lidas"`.
  - *Prova:* Teste de renderização de componente React/Web validando texto "9+" e acessibilidade ARIA.

- **CA-H101-05 [GET /v1/me/unread-summary sem autenticação]**
  - **Dado** uma requisição HTTP sem cookie de sessão ou com cookie inválido/expirado,
  - **Quando** chama `GET /v1/me/unread-summary`,
  - **Então** a API responde `401 Unauthorized` com `{ "code": "sessao_necessaria" }`.
  - *Prova:* Teste de rota com ausência de cabeçalho/cookie de sessão.

---

### Bloco B: Marcação de Leitura e Supressão de E-mails

- **CA-H101-06 [POST /v1/conversations/:id/read — Marcação com sucesso]**
  - **Dado** um usuário participante de uma conversa que possui mensagens não lidas,
  - **Quando** o usuário abre a conversa e a aplicação dispara `POST /v1/conversations/:id/read`,
  - **Então** o banco atualiza `app.conversation_member_state.last_read_message_id` para o ID da mensagem mais recente,
  - **E** a API responde `200 OK` com `{ "ok": true, "last_read_message_id": "..." }`,
  - **E** a consulta subsequente a `GET /v1/me/unread-summary` decrementa o contador e apaga o badge se não houver outras conversas pendentes.
  - *Prova:* Teste de integração de abertura de conversa e reavaliação de sumário.

- **CA-H101-07 [POST /v1/conversations/:id/read — Monotonicidade de leitura]**
  - **Dado** uma conversa cujo `last_read_message_id` já é a mensagem de ID `M2`,
  - **Quando** uma requisição atrasada enviar `POST /v1/conversations/:id/read` com o ID da mensagem anterior `M1`,
  - **Então** o banco mantém `last_read_message_id = M2` inalterado (garantia monotônica),
  - **E** a API responde `200 OK`.
  - *Prova:* Teste de concorrência/ordenação validando que o ponteiro de leitura nunca retrocede.

- **CA-H101-08 [POST /v1/conversations/:id/read — Anti-enumeração em conversa alheia]**
  - **Dado** um usuário autenticado que NÃO é membro da conversa `C_OUTRO`,
  - **Quando** envia `POST /v1/conversations/C_OUTRO/read`,
  - **Então** a API responde uniforme `404 Not Found` com `{ "code": "conversa_nao_encontrada" }`, sem confirmar se o ID existe.
  - *Prova:* Teste de rota com ID de conversa pertencente a terceiros.

- **CA-H101-09 [Supressão de e-mail de notificação por leitura prévia no site (RF-117)]**
  - **Dado** que um profissional enviou uma mensagem de texto humana ao cliente, gerando um item de e-mail na fila `ops.email_outbox` com janela de cooldown de 15 minutos,
  - **Quando** o cliente entra no site aos 5 minutos, visualiza o badge, abre a conversa e executa a leitura,
  - **Então** o estado da conversa é atualizado para lido,
  - **E** quando o tick de jobs executar o flush de notificações aos 15 minutos, a rotina `isStillRelevant` detecta que a mensagem já foi lida no site,
  - **E** o item de e-mail é marcado como `descartado` com motivo `obsoleto`, sem consumir envio nem cota do Resend.
  - *Prova:* Teste de integração do pipeline de notificação demonstrando descarte silencioso por leitura antecipada.

---

### Bloco C: Independência de E-mail e Degradação de Cota (Q-01 / FA-029)

- **CA-H101-10 [Operação do site com cota de e-mail 100% esgotada (Q-01, FA-029)]**
  - **Dado** que a cota do provedor de e-mail Resend atingiu 100/100 no dia UTC e todos os e-mails não críticos estão bloqueados/adiados por cota (`adiado_cota`),
  - **Quando** o profissional aceita um pedido ou envia mensagens no chat,
  - **Então** o chat e o site continuam funcionando normalmente sem qualquer interrupção, erro ou lentidão,
  - **E** o cliente que acessa o site visualiza imediatamente o badge de nova mensagem não lida,
  - **E** consegue abrir o chat, ler o texto e interagir normalmente com o profissional.
  - *Prova:* Teste de integração de cenário simulado Q-01 com adaptador de e-mail saturado comprovando sucesso total do canal no site.

- **CA-H101-11 [Aviso na tela após publicar pedido (Decisão 10, RF-115)]**
  - **Dado** um cliente que acabou de confirmar e publicar com sucesso um novo pedido de serviço,
  - **Quando** a página de confirmação de publicação é renderizada no navegador,
  - **Então** a interface exibe em destaque o card de aviso orientando o cliente a retornar ao FastPro para conferir respostas e mensagens,
  - **E** a mensagem permanece visível até navegação explícita do usuário.
  - *Prova:* Teste de componente da tela de confirmação de pedido validando presença do texto oficial de orientação.

---

### Bloco D: Casos de Borda, Acessibilidade e Resiliência

- **CA-H101-12 [Conversa arquivada que recebe nova mensagem (RF-104)]**
  - **Dado** uma conversa que havia sido arquivada pelo usuário (`archived_at IS NOT NULL`),
  - **Quando** uma nova mensagem humana ou de sistema é recebida na referida conversa,
  - **Então** o sumário `GET /v1/me/unread-summary` passa a incluir a conversa na contagem de não lidas,
  - **E** a conversa volta a figurar como pendente de atenção.
  - *Prova:* Teste de unidade/banco validando desarquivamento lógico na contagem de não lidas.

- **CA-H101-13 [Conversa com restrição de segurança não acende badge (RF-102)]**
  - **Dado** uma conversa que foi colocada em `restrita_por_seguranca`,
  - **Quando** o usuário consulta `GET /v1/me/unread-summary`,
  - **Então** as mensagens dessa conversa não são computadas no total de não lidas ativas,
  - **E** o badge não é incrementado por conversas restritas.
  - *Prova:* Teste de consulta excluindo conversas com `security_restricted_at IS NOT NULL`.

- **CA-H101-14 [Acessibilidade WCAG 2.2 AA no badge visual (FA-033)]**
  - **Dado** a interface web renderizando o cabeçalho com mensagens não lidas,
  - **Quando** inspecionados os nós DOM e estilos CSS,
  - **Então** as cores de fundo e texto do badge respeitam tokens do EDS (`packages/tokens`) com contraste mínimo de 4,5:1,
  - **E** leitores de tela leem o elemento com texto alternativo claro via `aria-label`,
  - **E** atualizações assíncronas do contador utilizam `aria-live="polite"`.
  - *Prova:* Teste automatizado de acessibilidade com varredura de contraste e nós ARIA.

- **CA-H101-15 [Fallback de polling adaptativo em caso de queda de WebSockets]**
  - **Dado** que o cliente web perdeu a conexão com o Supabase Realtime (rede instável ou cota de conexões gratuitas),
  - **Quando** o cliente permanece com a página aberta,
  - **Então** o cliente web ativa automaticamente o polling adaptativo a cada 30 segundos enquanto a aba estiver visível,
  - **E** ao receber nova mensagem, atualiza o badge e o chat sem intervenção manual do usuário.
  - *Prova:* Teste de cliente simulando desconexão de Realtime e validação de requisições de polling espaçadas.

---

## 8. Dependências reais conferidas em docs/factory/quadro-status.md

### 8.1 Matriz de dependências

| Item / Issue | Título | Coluna no Quadro | Papel em relação a H-101 |
|---|---|---|---|
| **#18 (`H-005`)** | Outbox, jobs, idempotência e config | `Concluído` | Infraestrutura transacional e persistência de eventos. |
| **#21 (`H-008`)** | Agendamento e tick de jobs | `Concluído` | Execução periódica de rotinas de limpeza e expurgos. |
| **#24 a #28 (`H-011` a `H-015`)** | Identidade e sessão do cliente | `Concluído` | Autenticação do cliente e emissão de cookie de sessão para chamadas à API. |
| **#29, #30 (`H-016`, `H-017`)** | Identidade e login do profissional | `Concluído` | Autenticação do profissional. |
| **#44 (`H-031`)** | Publicação de pedidos | `Concluído` | Fornece `app.service_request`, prazos e status do pedido. |
| **#47 (`H-034`)** | Painel do cliente na sessão do dono | `Concluído` | Tela e rotas onde o cliente acompanha seus pedidos publicados. |
| **#55 (`H-042`)** | Guarda de elegibilidade | `Concluído` | Garante que somente profissionais elegíveis interagem em pedidos. |
| **#102 (`H-092`)** | Pipeline de notificações e cooldown | `Concluído` | Fila de e-mails, janelas de 15 min e função de relevância `isStillRelevant`. |
| **#103 (`H-093`)** | `EmailProviderPort`: Mailpit e Resend | `Concluído` | Porta e adapters de envio de e-mail. |
| **#104 (`H-094`)** | Cota do Resend | `Concluído` | Limites diários de 100 e-mails/dia e regras de degradação RNF-EMAIL. |
| **#71 (`H-058`)** | Aceitar trabalho idempotente | `Product Owner` | Cria atomicamente `app.acceptance`, abre `app.conversation` e mensagem de sistema RF-075. |
| **#76 (`H-065`)** | Conversa criada no aceite | `Backlog` | Tabela formal `app.conversation`, membros e estados. |
| **#77 (`H-066`)** | Mensagens de texto idempotentes | `Backlog` | Tabela formal `app.message` e rota de envio de texto. |
| **#80 (`H-070`)** | Realtime como sinal com polling | `Backlog` | Publicação de sinais Realtime `conv:{id}` e polling adaptativo. |
| **#136 (`H-068`)** | Mensagem automática do aceite | `Backlog` | Renderização do texto fixo "Estou disponível para trabalhar". |
| **#106 (`H-096`)** | E-mail de mensagem não lida | `Backlog` | Enfileira e-mails de mensagens não lidas com cooldown de 15 min. |

### 8.2 Fatiamento e estratégia de conclusão

1. **Desenvolvimento e Testabilidade Imediatos:**
   - A especificação das regras de cômputo de não lidas, a porta de consulta `UnreadQueryPort`, a porta de atualização `MarkConversationReadPort`, os schemas Zod de contrato em `packages/contracts`, e as rotas HTTP correspondentes podem ser integralmente desenvolvidos e testados nesta história utilizando o banco com fixtures sintéticas ou mocks de domínio.
   - Os componentes visuais de interface em `apps/web` (badge de cabeçalho, indicador na listagem de mensagens, aviso na confirmação de publicação) podem ser entregues e validados com testes de componentes e acessibilidade.
2. **Parte que só pode terminar após Issues Pendentes:**
   - A prova ponta a ponta (E2E) que conecta um aceite real no banco de desenvolvimento com a exibição do badge no navegador e o subsequente descarte de e-mails na fila `ops.email_outbox` requer a presença das tabelas físicas `app.conversation`, `app.conversation_member_state` e `app.message`.
   - Essas tabelas são formalmente introduzidas pelas migrações das issues de Aceite e Chat (#71, #76, #77, #136).
   - Portanto, o Desenvolvimento de #137 pode ser concluído com a migração e contratos do estado de leitura (`conversation_member_state`), mas a homologação integrada da cadeia de aceite-chat-notificação será completada na esteira da conclusão das referidas issues de chat.

---

## 9. Riscos e mitigações

| ID | Risco | Severidade / Probabilidade | Mitigação no Desenho |
|---|---|---|---|
| **R-27** | Cliente não percebe aceites caso o e-mail de aviso atrase, caia em spam ou seja adiado por estouro de cota do Resend. | Alta / Alta | O Canal "no site" é soberano: o badge acende imediatamente após o aceite, e o aviso na tela pós-publicação alerta o cliente a voltar com frequência ao FastPro. |
| **R-H101-01** | Sobrecarga de polling na API e no banco Supabase Free gerada por múltiplas abas abertas em segundo plano. | Média / Média | Polling adaptativo rigoroso: frequência espaçada (30 s / 120 s) e suspensão total das requisições via Page Visibility API quando a aba estiver oculta. |
| **R-H101-02** | Concorrência de leitura: cliente com duas abas abertas marca leitura em instantes diferentes e gera retrocesso no ponteiro. | Baixa / Média | Atualização estritamente monotônica via operador `GREATEST` ou comparação de timestamps/UUID v7 no banco; o ponteiro nunca retrocede. |
| **R-H101-03** | Enumeração de conversas de terceiros via requisições de marcação de leitura na API. | Alta / Baixa | Autorização estrita e resposta uniforme 404 `{ "code": "conversa_nao_encontrada" }` para qualquer ID de conversa que não pertença ao usuário. |
| **R-H101-04** | E-mail de notificação de mensagem não lida ser enviado mesmo após o cliente já ter lido a conversa no site. | Média / Média | Integração com a regra RF-117: a rotina `isStillRelevant` checa atomicamente `last_read_message_id` antes de qualquer envio de digest, descartando itens obsoletos. |
| **R-H101-05** | Vazamento de dados pessoais ou conteúdo da mensagem no cabeçalho ou payload do sumário de não lidas. | Alta / Baixa | A rota `GET /v1/me/unread-summary` trafega apenas contadores inteiros e booleanos; nenhum texto de mensagem, nome ou e-mail é exposto no endpoint global. |

---

## 10. Perguntas ao líder com recomendação

**890. Formato e conteúdo da resposta de `GET /v1/me/unread-summary`.**
Qual estrutura de dados deve ser retornada pelo endpoint de sumário de não lidas consumido pelo cabeçalho global do site?
- (a) Objeto minimalista `{ has_unread: boolean, total_unread_conversations: number, updated_at: string }` otimizado para transferências ultraleves e frequentes.
- (b) Lista detalhada com os IDs de todas as conversas e o ID da última mensagem de cada uma.
- **Recomendação:** (a). O cabeçalho global está presente em todas as páginas da aplicação e necessita apenas de indicadores booleanos e contadores agregados; transferir listas completas aumentaria desnecessariamente o tráfego de dados e o tempo de resposta.

**891. Métrica do contador numérico no badge do cabeçalho.**
O badge numérico na barra de navegação principal deve refletir a quantidade de conversas distintas com mensagens pendentes ou o total bruto de mensagens não lidas somadas?
- (a) Quantidade de **conversas distintas** com mensagens não lidas (ex.: "2" se há duas conversas com pendências, independentemente de haver 5 mensagens em uma e 10 na outra), com teto visual "9+".
- (b) Somatório de todas as mensagens não lidas de todas as conversas.
- **Recomendação:** (a). A contagem por conversa é o padrão de excelência de UX em plataformas de serviços e mensageria (Slack, WhatsApp, Mercado Livre); previne contadores gigantescos que geram ansiedade no usuário e mantém a interface limpa e estável.

**892. Mensagem automática do aceite (RF-075) como mensagem não lida para o cliente.**
A mensagem automática gerada no momento do aceite de trabalho ("Estou disponível para trabalhar") deve ser computada como mensagem não lida para o cliente no site?
- (a) Sim: a mensagem de sistema do aceite conta como mensagem não lida para o cliente, ativando imediatamente o badge no site no primeiro acesso após o aceite, conforme RF-115.
- (b) Não: apenas mensagens humanas escritas pelo profissional ativam o badge.
- **Recomendação:** (a). Cumpre expressamente o PRD RF-115 e mitiga o risco central R-27, assegurando que o cliente saiba que há um profissional pronto para atendê-lo mesmo se nenhum e-mail for entregue.

**893. Tratamento da mensagem automática do aceite para o profissional que realizou o aceite.**
A mensagem automática gerada no aceite de trabalho deve ser considerada não lida para o profissional que efetuou a ação?
- (a) Não: para o profissional, a conversa nasce com a mensagem automática já marcada como lida (`last_read_message_id` sincronizado no momento da criação), impedindo que o badge acenda para quem acabou de aceitar o trabalho.
- (b) Sim: a mensagem nasce não lida para ambos os lados.
- **Recomendação:** (a). Auto-notificação por uma ação própria do usuário geraria confusão imediata e atrito de usabilidade na interface do profissional.

**894. Contrato e idempotência de `POST /v1/conversations/:id/read`.**
Qual deve ser o comportamento e assinatura da rota de marcação de leitura de uma conversa?
- (a) A rota aceita opcionalmente `{ last_read_message_id?: string }` no corpo; se omitido, o backend utiliza a mensagem mais recente da referida conversa, atualizando `app.conversation_member_state` de forma monotônica e retornando `200 OK` com `{ ok: true, last_read_message_id: string }`.
- (b) Rota sem corpo que apenas executa um comando genérico baseado na hora atual do relógio.
- **Recomendação:** (a). A amarração explícita ao ID da mensagem garante rastreabilidade exata do ponto de leitura, elimina ambiguidades de relógio entre cliente e servidor e assegura idempotência plena.

**895. Supressão de e-mails de notificação via regra RF-117 por leitura no site.**
Como a marcação de leitura no site deve interagir com a fila de e-mails em `ops.email_outbox` que esteja em período de cooldown (15 minutos)?
- (a) A rotina de envio de notificações (`isStillRelevant`), ao ser executada pelo tick de jobs, consulta o `last_read_message_id` da conversa; se constatar que a mensagem que motivou o e-mail já foi lida, marca o item como `descartado` com motivo `obsoleto` e cancela o disparo do e-mail.
- (b) O e-mail é enviado independentemente de a conversa ter sido lida na tela.
- **Recomendação:** (a). Atende expressamente ao requisito de negócio RF-117 ("resumo não é enviado se a mensagem já foi lida"), poupando a cota diária do Resend e evitando enviar avisos inúteis ao usuário.

**896. Estratégia de reatividade no cliente web: Realtime vs Polling adaptativo.**
Como o cliente web (`apps/web`) deve atualizar o badge de mensagens não lidas enquanto o usuário navega na aplicação?
- (a) Modelo híbrido conforme ADR-010: se a conexão com o Supabase Realtime estiver ativa, escuta o evento leve no canal do usuário; em caso de falha de conexão, erro ou indisponibilidade, entra em polling adaptativo (30 s com aba em foco, 120 s em segundo plano, suspenso se aba oculta).
- (b) Polling contínuo e fixo a cada 3 segundos ininterruptos.
- **Recomendação:** (a). Respeita rigorosamente a cota gratuita do Supabase e evita desperdício de requisições serverless na Vercel, mantendo atualização ágil em qualquer circunstância de rede.

**897. Comportamento do Canal no site quando a cota de e-mail estiver esgotada (Q-01 / FA-029).**
Caso a cota diária do Resend (100 e-mails/dia) esteja 100% consumida e todos os e-mails não críticos estejam pausados pelo sistema:
- (a) O site opera normalmente sem qualquer mensagem de erro ou bloqueio visual: a troca de mensagens, o acendimento de badges e o atendimento continuam 100% íntegros e transparentes para o usuário final.
- (b) Exibir banner vermelho de alerta na interface informando que os e-mails estão paralisados.
- **Recomendação:** (a). O princípio arquitetural de degradação graciosa (RNF-EMAIL §6.1 e FA-029) estabelece que o usuário final não deve sofrer interrupções nem ser alarmado por limitações técnicas de serviços secundários quando a via primária está em pleno funcionamento.

**898. Texto e localização do aviso ao cliente após a publicação do pedido (Decisão 10, RF-115).**
Onde e com qual redação o aviso de retorno ao site deve ser exibido na jornada do cliente?
- (a) Card fixo na tela de sucesso/confirmação imediata da publicação do pedido (`apps/web`), com texto: *"Seu pedido foi publicado! Os profissionais interessados responderão aqui no FastPro. Acesse sua conta periodicamente para conferir novas mensagens e escolher o melhor atendimento."*
- (b) Um toast flutuante temporário de 3 segundos que desaparece automaticamente.
- **Recomendação:** (a). Um card permanente na página de confirmação assegura que o cliente assimile a informação e entenda que o FastPro é o ambiente de retorno para contratação, prevenindo a desatenção por ausência de e-mail (R-27).

**899. Controle de acesso e autorização em `GET /v1/me/unread-summary`.**
Quais perfis e papéis têm autorização para consultar o endpoint de sumário de não lidas?
- (a) Qualquer usuário com sessão autenticada ativa (`customer` ou `professional`); a consulta isola estritamente as conversas das quais o `user_id` da sessão é participante ativo.
- (b) Somente clientes donos de pedidos de serviço.
- **Recomendação:** (a). Ambos os atores (clientes e profissionais) participam de conversas de atendimento e dependem de sinalização de mensagens novas para responder prontamente aos seus interlocutores.

**900. Comportamento do badge diante de conversas arquivadas (`archived_at IS NOT NULL`, RF-104).**
Se o usuário tiver arquivado individualmente uma conversa e o interlocutor enviar uma nova mensagem:
- (a) A nova mensagem desarquiva a conversa para o destinatário e a inclui na contagem de conversas não lidas do badge, conforme RF-104.
- (b) A conversa permanece arquivada e oculta, não gerando badge nem notificação.
- **Recomendação:** (a). Garante que mensagens novas relevantes não fiquem perdidas em conversas arquivadas, em estrita conformidade com o PRD RF-104.

**901. Comportamento do badge diante de conversas com restrição de segurança (RF-102).**
Se uma conversa for bloqueada pela moderação ou auditoria com `state = 'restrita_por_seguranca'`:
- (a) A conversa deixa de ser contabilizada no badge de não lidas ativas, e o envio de novas mensagens permanece bloqueado na API.
- (b) Continua incrementando o badge até que o usuário tente abri-la.
- **Recomendação:** (a). Conversas restritas por segurança não permitem interação; induzir o usuário a abri-las por meio de badges ativos é incoerente com a política de segurança da plataforma.

**902. Mensagens de sistema de encerramento ou retirada de aceite.**
Mensagens automáticas de encerramento de negociação (ex.: aviso de aceite retirado antes da seleção) devem ativar o badge de não lidas?
- (a) Sim: conta como não lida até que o cliente abra a conversa e tome ciência da saída do profissional, permitindo que ele tome ações como chamar a 2ª onda ou avaliar outros participantes.
- (b) Não: apenas a mensagem inicial de aceite conta.
- **Recomendação:** (a). A saída de um profissional impacta a decisão do cliente, que deve ser prontamente informado na tela da plataforma.

**903. Rota dedicada de sumário versus inclusão exclusiva na listagem de conversas.**
O sumário de não lidas deve possuir rota própria (`GET /v1/me/unread-summary`) ou vir somente como atributo da rota de listagem de conversas (`GET /v1/conversations`)?
- (a) Deve possuir a rota dedicada e ultraleve `GET /v1/me/unread-summary` para o cabeçalho global presente em todas as páginas do site, complementada por atributos `unread_count` e `last_read_message_id` na listagem de conversas.
- (b) Somente embutido na listagem completa de conversas.
- **Recomendação:** (a). Carregar a lista completa de conversas com histórico em todas as páginas navegadas pelo usuário degradaria a performance e aumentaria o consumo de banco; a rota dedicada de sumário executa uma agregação ultrarrápida.

**904. Resposta anti-enumeração na rota de leitura (`POST /v1/conversations/:id/read`).**
Se um usuário tentar marcar leitura enviando o identificador de uma conversa da qual não faz parte:
- (a) A API responde uniforme `404 Not Found` com `{ "code": "conversa_nao_encontrada" }`, sem vazar a existência da conversa.
- (b) Responde 403 Forbidden com `{ "code": "permissao_negada" }`.
- **Recomendação:** (a). Segue a política canônica de anti-enumeração do FastPro (ADR-005, decisões 569 e 607), impedindo que invasores descubram IDs de conversas privadas de terceiros.

**905. Tratamento de concorrência na gravação de leitura.**
Se múltiplas requisições de leitura da mesma conversa chegarem simultaneamente (ex.: duas abas abertas pelo mesmo usuário):
- (a) A atualização de `app.conversation_member_state` utiliza lógica monotônica atômica (`last_read_message_id = GREATEST(old, new)`), retornando 200 OK sem necessidade de locks pessimistas ou contenção de transação.
- (b) Adquirir `SELECT ... FOR UPDATE` com risco de lock contention.
- **Recomendação:** (a). A monotonicidade atômica é simples, não trava o banco e resolve a concorrência entre abas de forma elegante e transparente.

**906. Padrão de acessibilidade para o badge no cabeçalho (WCAG 2.2 AA / FA-033).**
Como o elemento de badge deve ser estruturado para atender plenamente a usuários de leitores de tela?
- (a) O badge possui tag semântica com `aria-live="polite"`, `aria-atomic="true"` e rótulo explicativo dinâmico (ex.: `aria-label="2 conversas com mensagens não lidas"`), com contraste estrito conforme tokens EDS, sem depender unicamente de cor.
- (b) Um elemento visual simples sem propriedades ARIA.
- **Recomendação:** (a). Cumpre integralmente os requisitos de acessibilidade estipulados em FA-033 e na Issue #127.

**907. Resiliência do cliente web diante de falhas momentâneas de rede no envio da leitura.**
Se a requisição assíncrona de `POST /v1/conversations/:id/read` falhar por instabilidade transitória de rede móvel:
- (a) A interface web assume a leitura de forma otimista na memória local e enfileira uma tentativa de sincronização silenciosa; se falhar em definitivo, o badge reaparecerá no próximo carregamento de página sem travar o aplicativo.
- (b) Bloquear a tela do chat com modal intrusivo de erro de conexão.
- **Recomendação:** (a). Otimismo de interface e resiliência a desconexões temporárias proporcionam uma experiência fluida de mensageria.

**908. Estrutura de teste de independência de e-mail na suíte automatizada (Q-01 / FA-029).**
Como deve ser implementada a prova de independência do Canal no site em relação ao e-mail?
- (a) Teste de integração automatizado configurado com `EMAIL_PROVIDER=resend_mock` com cota zerada: simula aceite de pedido, comprova que nenhum e-mail sai para a rede externa, e valida que o cliente obtém `has_unread = true` via API, lê a mensagem automática e zera o badge com 100% de sucesso.
- (b) Testar o site apenas em cenários onde o e-mail funciona com sucesso.
- **Recomendação:** (a). Constitui a prova cabal e auditável exigida pelo Critério de Aceite FA-029 e teste Q-01, blindando o produto contra quebras do princípio de autonomia do canal no site.

**909. Fatiamento da Issue #137 frente às pendências de chat do Épico E7.**
Considerando que as migrações das tabelas físicas de chat (`app.conversation` e `app.message`) pertencem às histórias #71, #76 e #77:
- (a) A Issue #137 entrega os contratos de domínio, as rotas da API, a camada de UI com acessibilidade e a suíte de testes de contrato/integração mockada; a validação final integrada com banco de dados compartilhado aguardará as migrações das issues de chat, sem paralisar o pipeline de PO e Arquitetura.
- (b) Interromper a Issue #137 e deixá-la bloqueada até que todo o Épico E7 esteja finalizado.
- **Recomendação:** (a). Permite o avanço contínuo do Épico E11 (Notificações) e define com rigor o contrato de leitura e notificação que as histórias de chat devem respeitar ao nascer.

---

## 11. Próximos passos

1. **Apresentação e Consolidação pelo Orquestrador (Líder):** Submissão deste refino ao Orquestrador da fábrica. As 20 recomendações técnicas e de produto formuladas nas perguntas 890 a 909 devem ser adotadas para orientar a etapa subsequente.
2. **Elaboração da Arquitetura e Desenho Técnico (Etapa de Arquitetura):**
   - Criação do documento `docs/factory/161-DESENHO-H101.md` detalhando:
     - Os schemas Zod de validação de payload em `packages/contracts` (`UnreadSummaryResponseSchema`, `MarkConversationReadRequestSchema`);
     - A interface das portas de domínio em `packages/domain/src/notifications/unread-ports.ts`;
     - O serviço de aplicação e orquestrador de consulta de não lidas e marcação de leitura;
     - A estratégia de componentes de UI em `apps/web/src/components/nav/unread-badge.tsx` com acessibilidade WCAG 2.2 AA;
     - Os cenários de teste automatizados em `packages/domain/tests` e `packages/db/tests`.
3. **Alinhamento com as Histórias de Aceite e Chat (#71, #76, #77, #136):**
   - Garantir que a implementação da tabela `app.conversation_member_state` e os gatilhos atômicos de criação de mensagem de sistema em H-058 (#71) e H-065 (#76) integrem de forma nativa a coluna `last_read_message_id` conforme especificado neste refino.
