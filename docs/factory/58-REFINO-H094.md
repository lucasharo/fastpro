# Refino H-094 — Cota do Resend: contador, alertas e degradação (Issue #104, WF-03, coluna Product Owner)

- **Issue:** #104 · **História:** H-094 ("[E11] Cota do Resend") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, conta, chave, domínio ou envio. O estado da coluna veio do Orquestrador; não foi conferido no GitHub Project nesta etapa.
- **Etiquetas:** `[APROVADO]` decisão do usuário ou regra já aprovada · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` texto deste refino, a validar.
- **Fontes:** 14-BACKLOG (H-094, E11); 04-PRD §6.1 (RNF-EMAIL), RF-041, RF-120, RF-122; 08-ARQUITETURA §12.2 e §12.6; 35-DESENHO-H092 §2, §3.4, §7 (cortes, reserva, alertas); 11-DECISOES, decisão 27 (atualizada em 2026-11-11).

## 1. Escopo

- Contador de uso diário (dia UTC) e mensal do Resend, por destinatário.
- Alertas em 70% e 85% dos limites (ver D1).
- Reserva de login preservada e degradação por classe, com os cortes já desenhados em 35 §7.
- **Nenhum interruptor** de e-mail: nem tela, nem flag, nem chave de configuração, nem endpoint.

Limites fixos: 100 e-mails por dia (UTC) e 3.000 por mês, contados por destinatário (fatos do Resend, RNF-EMAIL). `[APROVADO]`

## 2. Critérios de aceite (Given/When/Then)

### 2.1 Contador de uso
- **CA-H094-01 [APROVADO, RNF-EMAIL].** Dado um envio reservado para um destinatário, quando o provedor aceita, então o contador do dia UTC e o do mês sobem 1. Um envio com dois destinatários conta 2, pois cada destinatário conta. Envio recusado ou devolvido à fila não fica contado.
- **CA-H094-02 [APROVADO, RNF-EMAIL].** Dado a virada do dia UTC (23:59:59 para 00:00:00), quando o contador diário é consultado, então volta a zero e o contador mensal continua acumulando.
- **CA-H094-03 [PROPOSTA].** Dado um envio em andamento, quando o pipeline reserva a cota antes do envio e devolve a reserva se o provedor não aceitar, então o contador nunca fica abaixo do uso real. Em caso de dúvida, conta-se a mais (35 DD-5).

### 2.2 Alertas em 70% e 85%
- **CA-H094-04 [PROPOSTA, pedido do Orquestrador].** Dado que o uso diário chega a 70 (de 100), quando o contador cruza esse valor, então é gravado o alerta de nível 70 do dia UTC, uma única vez, e é emitida uma métrica sem dados pessoais.
- **CA-H094-05 [PROPOSTA, pedido do Orquestrador].** Dado que o uso diário chega a 85, quando o contador cruza esse valor, então é gravado o alerta de nível 85 do dia UTC, uma única vez. O mesmo vale para o mensal, com 2.100 (70%) e 2.550 (85%).
- **CA-H094-06 [PROPOSTA].** Dado um alerta já gravado no mesmo período e no mesmo nível, quando o contador passa de novo pelo valor, então nenhum alerta duplicado é gravado (idempotente).
- **CA-H094-07 [PROPOSTA].** Dado um alerta, quando ele é gravado, então ele não bloqueia nem altera o envio por si só. Quem reage aos cortes é a degradação por classe (2.3). O alerta só informa.

### 2.3 Degradação por classe e reserva de login
Cortes de 35 §7, aceitos pelo usuário por referência. Os valores 85 (digest) e 70 (lembrete) eram `[PROPOSTA]` em 35. `[APROVADO]`

| Classe (exemplos) | Corte diário | Corte mensal |
|---|---|---|
| `auth` (login, link, código, conta) | 100 (usa a reserva) | 3.000 |
| `critico` (seleção, cancelamento, desistência, verificação) | 90 | 2.700 |
| `digest` (aviso de aceite, mensagem não lida) | 85 | 2.550 |
| `lembrete` (prazo, trial, ciclo) | 70 | 2.100 |

- **CA-H094-08 [APROVADO, RNF-EMAIL; 35 §7].** Dado uso diário em 70 ou mais, quando chega um lembrete, então ele é adiado, e não enviado.
- **CA-H094-09 [APROVADO, RNF-EMAIL; 35 §7].** Dado uso diário em 85 ou mais, quando chega um aviso de aceite ou de mensagem não lida, então ele é adiado, e não enviado. Um lembrete adiado nessa faixa continua adiado.
- **CA-H094-10 [APROVADO, RNF-EMAIL; 35 §7].** Dado uso diário em 90 ou mais, quando chega um e-mail crítico (seleção, cancelamento, desistência, verificação), então ele é adiado. Só `auth` continua passando.
- **CA-H094-11 [APROVADO, RNF-EMAIL; RF-041].** Dado uso diário em 90 ou mais, quando chega um e-mail de login ou conta, então ele passa, usando a reserva de 10 por dia (e 300 por mês). Dado uso em 100, o login é adiado com recuo, e a resposta ao usuário continua uniforme (202).
- **CA-H094-12 [APROVADO, RNF-EMAIL].** Dado que o mês atingiu o corte de uma classe, quando chega um e-mail dessa classe, então é adiado mesmo com o dia livre. Vale o mesmo no sentido inverso (35 §7: dia e mês são verificados juntos).
- **CA-H094-13 [APROVADO, 35 §7 e CA-17 a CA-21].** Dado um e-mail adiado, quando chega o dia UTC seguinte, então é reavaliado por prioridade (`auth`, `critico`, `digest`, `lembrete`). Se o fato já não for válido (pedido selecionado, cancelado ou concluído, ou mensagem já lida), é descartado e não sai.
- **CA-H094-14 [APROVADO, RNF-EMAIL, 08 §12.6 (5)].** Dado qualquer nível de cota, quando o usuário usa o chat ou o site, então nada muda: a mensagem automática e o chat não dependem de e-mail.

### 2.4 Nenhum interruptor
- **CA-H094-15 [APROVADO, decisão 27 atualizada em 2026-11-11].** Dado qualquer tipo de e-mail, quando a aplicação decide enviar, então não consulta flag, interruptor, tabela de ativação, chave de configuração nem tela. O único filtro de envio é a cota por classe (2.3).
- **CA-H094-16 [APROVADO, decisão 27].** Dado o painel administrativo, quando um administrador procura controle de envio de e-mail, então não há campo para ligar, desligar ou alterar limite de envio. Os limites ficam em constante de código, não em configuração editável (ver D6).
- **CA-H094-17 [APROVADO, decisão 27].** Dado a cota recuperada ou o dia virado, quando os envios são retomados, então nenhum e-mail antigo é reenviado (sem reenvio retroativo de aceites).

## 3. Fora desta história
- Envio real a qualquer pessoa, inclusive o público: depende de domínio verificado no Resend (decisão 15; BLQ-EXEC).
- Domínio: não comprar, configurar nem verificar (SD-03; H2).
- Conta e chave do Resend (criadas pelo usuário, só com autorização de execução).
- Adaptador do provedor, classificação de respostas e webhook de bounce (H-093).
- Textos finais dos e-mails (H-095 a H-099).
- Painel visual de alertas (H-108; ver D2).

## 4. Dúvidas ao Orquestrador (com recomendação)

- **D1. Limiares de alerta.** O pedido diz 70% e 85%. O backlog (H-094) e 35 §7 dizem 70, 85 e 95%. O 04-PRD §6.1 e 08 §12.6 dizem ≥ 90 por dia e ≥ 2.700 por mês. **Recomendação:** alertas em 70 e 85 (diário e mensal, 2.100 e 2.550), como pedido. Retirar o 95%. Os 90 e 2.700 são o corte da classe `critico` (2.3), não um alerta separado. Atualizar 14-BACKLOG (H-094), 35 §7 e 08 §12.6 para ficarem iguais. Destrava CA-H094-04 e CA-H094-05.
- **D2. Onde os alertas aparecem.** (a) Só gravados em `external_quota` e mostrados no painel H-108; (b) tela nova em H-094; (c) só em log. **Recomendação:** (a). Não criar tela nova nem controle de limite, em linha com "não há teto em tela". Destrava a parte de exibição de CA-H094-04 e CA-H094-05.
- **D3. Fuso do mês.** O dia é UTC. Para o mês: UTC ou America/Sao_Paulo? **Recomendação:** UTC, igual ao dia. O reinício mensal do Resend não está verificado (`[NÃO VERIFICADO]`), então a contagem local não deve presumir esse reinício. Destrava CA-H094-02.
- **D4. Reconciliação com o painel do Resend.** 35 D-2 atribui a reconciliação a H-094. Na S-11, os cabeçalhos de cota vieram zerados (35 R-3). **Recomendação:** nesta história, só contagem local conservadora. A reconciliação fica para quando houver fonte confiável de uso do provedor. Se aceitarem, tirar de H-094. Destrava o escopo de CA-H094-03.
- **D5. Envios de desenvolvimento.** Com o Mailpit removido (decisão de 2026-11-11), os testes vão pelo Resend para a conta cadastrada e consomem a mesma cota (`resend.dev` também conta, 13). **Recomendação:** o contador conta esses envios. Manter baixo volume de testes e registrar o uso nas evidências. Destrava CA-H094-01 no ambiente de desenvolvimento. Observação para o Orquestrador: 36-REFINO-H093 ainda cita Mailpit para desenvolvimento; não alterei por não ser esta Issue.
- **D6. Limites em constante ou em configuração.** 35 usa "constante única ajustável por H-094". **Recomendação:** constante de código, sem chave em `app_config`, para não criar um interruptor disfarçado. Destrava CA-H094-16.

## Resumo em linguagem simples

Este refino define como o site conta os e-mails enviados por dia e por mês, avisa quando o uso chega perto de 70% e de 85% do limite gratuito, e adia os avisos menos urgentes primeiro. O e-mail de entrada no site (login) continua tendo prioridade, e o chat e o site seguem funcionando mesmo com o limite cheio. Não há botão para desligar os e-mails, e nada é enviado de verdade nesta etapa.
