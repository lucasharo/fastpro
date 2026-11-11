# Refino H-092 — Pipeline de notificações e cooldown (Issue #102, WF-03, coluna Product Owner)

- **Issue:** #102 · **História:** H-092 (E11) · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, commit ou alteração de Project. O estado da coluna foi informado pelo Orquestrador; não foi conferido no Project nesta etapa.
- **Etiquetas:** `[APROVADO]` vem do PRD, do FA ou de decisão do usuário · `[DELEGADO]` vem de decisão delegada registrada · `[PROPOSTA]` texto deste refino, pendente do Orquestrador.
- **Fontes:** 14-BACKLOG (H-092 a H-101); 04-PRD (RF-115 a RF-122, RNF-EMAIL §6.1); 05-CRITERIOS-ACEITE (FA-012, FA-014, FA-016, FA-029); 08-ARQUITETURA §12; 10-ADRS (ADR-011, ADR-022); 09-MODELO-DADOS §3.11 e §7; 11-DECISOES (decisões 15, 26 e 27).

## 1. Escopo

Pipeline interno: evento de domínio (outbox) → `notification_item` → cooldown por (destinatário, categoria, escopo) → `email_outbox` com `dedupe_key` → envio pelo `EmailProviderPort`, sob cota diária e mensal.

- Todos os e-mails estão habilitados (decisão 27, `[APROVADO]`). Não há interruptor, tela, flag nem reenvio de avisos antigos.
- Em desenvolvimento, o envio vai para um destino local de teste. Nenhum envio real nesta etapa.
- Janela de 15 min: `[DELEGADO]` (RF-116). Demais limiares: `[PROPOSTA]`, em configuração.

## 2. Critérios de aceite (Given/When/Then)

### 2.1 Evento vira item de notificação

- **CA-H092-01 [APROVADO, 08 §12.1].** Dado um evento de domínio de notificação (aceite, mensagem humana, seleção, cancelamento, desistência, prazo), quando o consumidor processa, então cria um `notification_item` por destinatário e categoria, com referência ao evento. Reentrega do mesmo evento não cria segundo item.
- **CA-H092-02 [APROVADO, RF-075 e RF-116].** Dado uma mensagem automática de aceite (remetente nulo), quando é criada, então não gera item de mensagem não lida nem e-mail de mensagem. Gera só o item de aceite. A mensagem aparece no chat de imediato, sem depender de e-mail.

### 2.2 Cooldown de 15 min e agrupamento

- **CA-H092-03 [DELEGADO, RF-116; 08 §12.3].** Dado um (destinatário, categoria, escopo) sem janela ativa, quando chega o primeiro evento, então o e-mail sai de imediato e a janela de 15 min começa.
- **CA-H092-04 [DELEGADO, RF-116].** Dado uma janela ativa para (destinatário, categoria, escopo), quando chegam novos eventos, então nenhum e-mail sai no momento. Cada evento vira item pendente, e há no máximo um envio agendado para o fim da janela. Exemplo: 8 aceites no mesmo pedido em 15 min geram 1 e-mail imediato e 1 resumo.
- **CA-H092-05 [PROPOSTA, RF-116].** Dado janelas de aceite e de mensagem ativas ao mesmo tempo, então são independentes. Aceite não suprime mensagem e vice-versa. Escopo do aceite = pedido; escopo da mensagem = conversa.
- **CA-H092-06 [PROPOSTA].** Dado o envio agrupado executado duas vezes (retry ou concorrência) sobre os mesmos itens, então sai um único e-mail (`dedupe_key` do envio).

### 2.3 Resumo cancelado quando lido

- **CA-H092-07 [APROVADO, RF-117; FA-029].** Dado uma mensagem humana pendente no cooldown, quando o destinatário lê a conversa antes do envio, então o item é descartado e nenhum e-mail sai por ele.
- **CA-H092-08 [PROPOSTA; dúvida 2].** Dado um aceite pendente no cooldown, quando o cliente abre o pedido depois do aceite e antes do envio, então o item é descartado.
- **CA-H092-09 [PROPOSTA].** Dado que todos os itens pendentes de um agrupamento foram descartados, quando o envio roda, então nenhum e-mail vazio é enviado.

### 2.4 Nenhum aviso obsoleto

- **CA-H092-10 [APROVADO, RF-117; FA-029].** Dado um item pendente de pedido que é selecionado, cancelado ou concluído antes do envio, quando o envio roda, então o item é descartado.
- **CA-H092-11 [APROVADO, RF-073 e RF-119; FA-012].** Dado um lembrete de 24 h ou de vencimento criado, e o pedido selecionado ou cancelado antes do envio, quando o envio roda, então o lembrete não sai. O estado é checado de novo no momento do disparo.
- **CA-H092-12 [APROVADO, RF-122; FA-029].** Dado eventos ocorridos antes de o pipeline entrar em vigor, quando ele é habilitado, então nenhum item nem e-mail é gerado para eles (sem reenvio).
- **CA-H092-13 [PROPOSTA, RNF-EMAIL].** Dado um item adiado por cota, quando é reavaliado no dia UTC seguinte, então é enviado só se ainda for válido. Caso contrário, é descartado.

### 2.5 Nenhum conteúdo sensível no e-mail

- **CA-H092-14 [APROVADO, RF-120; 09 §7].** Dado qualquer e-mail gerado pelo pipeline, quando inspecionado, então não contém endereço completo, telefone, e-mail de terceiro, corpo de mensagem, anexo, link de login nem credencial permanente.
- **CA-H092-15 [APROVADO, RF-086 e RF-118; FA-014 e FA-016].** Dado uma seleção ou cancelamento com concorrentes, quando os e-mails são gerados, então o e-mail enviado a concorrente não identifica o profissional selecionado.
- **CA-H092-16 [PROPOSTA; dúvidas 4 e 6].** Dado um e-mail de aceite ou de mensagem não lida, quando gerado, então traz aviso genérico (ex.: "há novidades no seu pedido ou conversa") e convite para entrar no FastPro. Não traz nome de profissional nem trecho de mensagem.

### 2.6 Cota respeitada, com degradação (login primeiro)

- **CA-H092-17 [APROVADO, decisão 27; RNF-EMAIL; 08 §12.6].** Dado o contador do dia UTC em 90 de 100 (ou do mês em 2.700 de 3.000), quando um e-mail não crítico é gerado, então dispara alerta e o e-mail fica adiado. A contagem é por destinatário.
- **CA-H092-18 [APROVADO, RNF-EMAIL].** Dado a cota diária esgotada, quando alguém pede link ou código de login, então o e-mail de login segue na fila com prioridade máxima, e a resposta ao usuário continua uniforme.
- **CA-H092-19 [APROVADO, RNF-EMAIL].** Dado cota degradada ou esgotada, quando ocorre um evento de chat, então a mensagem automática e a mensagem no site continuam imediatas. Chat e site não param.
- **CA-H092-20 [APROVADO, RNF-EMAIL].** Ordem de prioridade: login e conta > seleção, cancelamento, desistência e verificação > aceite e mensagem não lida > lembretes (trial, ciclo, prazo). Testes: simular 90 e 100 por dia UTC e 2.700 e 3.000 por mês. Em cada caso, o login passa e os demais seguem a ordem.
- **CA-H092-21 [PROPOSTA; dúvida 3].** Reserva de 10 por dia e 300 por mês usada somente para login e conta.
- **CA-H092-22 [PROPOSTA, 08 §12.6].** Remetente limitado a 5 envios por segundo.

## 3. Fora desta história

- **Envio real a usuários:** depende de domínio verificado no Resend (decisão 15; BK-10; BLQ-EXEC). Nenhum e-mail real sai nesta etapa.
- **Mailpit:** não instalar binário nem Supabase CLI nesta etapa, por decisão do usuário. O destino de teste é local e não exige instalação externa.
- **Adapter Resend e segredos:** H-093.
- **Textos finais dos e-mails:** H-095 a H-099 (com o PO, conforme L-4).
- **Painel de cota:** H-108. **Login:** H-097. **Lembretes:** H-099.
- **Interruptor, tela ou flag de e-mail:** proibidos (decisão 27; H-100).
- **Push, SMS, WhatsApp:** fora do escopo (RF-121).

## 4. Dúvidas ao Orquestrador (numeração provisória D-H092-n)

1. **Cooldown após o envio do resumo:** a janela de 15 min recomeça quando o resumo sai? Recomendação: sim, para evitar rajada. Alternativa: não, e um novo evento pode sair logo em seguida.
2. **"Lido" para aceite:** Recomendação: o cliente abriu o pedido depois do aceite. Alternativa: só mensagem humana é descartada por leitura, e aceite sempre sai.
3. **Conflito na cota (08 §12.6):** o texto diz que a reserva de 10 por dia é exclusiva para login, e também que, acima de 90 por dia, passam só login e crítico. As duas regras não batem. Recomendação: crítico para em 90 e os últimos 10 ficam só para login. Alternativa: crítico pode usar a reserva.
4. **Nome no e-mail de aceite:** Recomendação: sem nome de profissional, só aviso genérico. Alternativa: primeiro nome do profissional, que já é público no perfil.
5. **Concorrentes na seleção:** Recomendação: concorrentes não recebem e-mail de seleção, e o cancelamento sai como aviso genérico aos pertinentes. Alternativa: aviso genérico de "outro profissional foi escolhido", sem identidade.
6. **Corpo da mensagem no e-mail:** Recomendação: não incluir (mensagens são classe C3 em 09 §7). Alternativa: trecho limitado.
7. **Destino local de teste antes do Mailpit:** qual adapter o Architect usa até o Mailpit existir (ex.: gravação local sem dados pessoais)? Recomendação: o Architect decide em H-093; o PO só registra o requisito de não enviar externamente.

## Resumo em linguagem simples

Este refino define como os avisos por e-mail são agrupados para caber na cota gratuita, e quando eles devem sumir por já não fazerem sentido, por exemplo se o pedido já foi escolhido ou a pessoa já leu. O chat e o site seguem funcionando mesmo com o e-mail limitado, e o e-mail de login sempre tem prioridade. Ainda faltam sete definições finas (lista acima) e o envio real a pessoas depende de ter um domínio próprio verificado.
