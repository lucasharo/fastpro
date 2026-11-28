# Refino H-097: e-mail de login com prioridade (Issue #107)

- Produto: FastPro (`D:\projetos\fastpro`), branch `feature/init`
- Issue: #107 · Backlog H-097 · Workflow WF-03 (Product Owner)
- Data: 2026-11-12
- Dependências (H-011, H-093, H-094): informadas pelo usuário como concluídas
- Próximo passo: Arquitetura, após aprovação do líder

Legenda: **[DECIDIDO]** aprovado pelo usuário nos documentos; **[VERIFICADO]** conferido nos arquivos nesta data; **[PROPOSTA]** sugestão do PO, não aprovada; **[NÃO VERIFICADO]** sem fonte confirmada.

## 1. Objetivo

- [DECIDIDO] O e-mail de link ou código de login (RF-041, FA-003) tem prioridade máxima sobre os demais e é tentado na própria requisição, sem depender do tick de jobs (08 §12.6).
- [DECIDIDO] Não existe interruptor de e-mail (decisões 23 e 27).
- Objetivo desta história: o código de login chega sem esperar a fila de outros e-mails, mesmo com a fila cheia, e a resposta ao solicitante continua uniforme (202).

## 2. Quem recebe e quando

| Destinatário | Gatilho | Momento | Classe |
|---|---|---|---|
| Cliente que pede acesso por link ou código | POST de desafio (H-011; RF-036, RF-037) | Na requisição, fora do tick | `auth` |
| Cliente que pede novo código ou link | Reenvio (RF-040; H-015) | Na requisição, respeitando intervalo mínimo | `auth` |
| Profissional (login por senha) | Verificação ou redefinição pelo Supabase Auth | [NÃO VERIFICADO]; ver D-H097-2 | fora do escopo até decisão |
| Destinatário fora da conta cadastrada (dev e teste) | Qualquer e-mail | Recusado antes de chamar a API | (decisão 15; I-27; N-09) |

[DECIDIDO, 08 §12.6] Ordem na cota: `auth` > crítico (seleção, cancelamento, desistência, verificação) > aceite e mensagem não lida > lembretes.
[PROPOSTA] Reserva para `auth` de 10 envios por dia e 300 por mês.

## 3. Regras de negócio

- RN-1 [DECIDIDO] O e-mail de login é tentado no momento do pedido, antes de qualquer item pendente (aceite, digest, lembrete), sem esperar o tick.
- RN-2 [DECIDIDO] Com 90 envios ou mais no dia UTC, só `auth` passa. Os demais ficam `adiado_cota` e são reavaliados no dia UTC seguinte, ou descartados se obsoletos.
- RN-3 [DECIDIDO] Limite do plano gratuito: 100 por dia UTC e 3.000 por mês, contados por destinatário (decisão do usuário de 2026-11-11). Ver D-H097-1.
- RN-4 [DECIDIDO] Falha ou recusa do provedor: o e-mail fica em `email_outbox` com recuo e nunca gera duplicata (chave única por desafio).
- RN-5 [DECIDIDO] A resposta é 202, com o mesmo corpo e tempo aproximado, exista ou não a conta (RF-039). O envio não pode alterar essa resposta.
- RN-6 [DECIDIDO] O e-mail traz só link ou código de uso único, sem credencial permanente (RF-041) e sem dados sensíveis (RF-120).
- RN-7 [DECIDIDO] Nenhuma configuração desliga o e-mail de login (decisão 27).
- RN-8 [DECIDIDO] O envio respeita o teto de 5 envios por segundo (08 §12.6), com preferência para login.

## 4. Critérios de aceite

- CA-01 Fila interna cheia. Dado que há 200 e-mails de aceite ou digest pendentes, quando o cliente pede o código, então o e-mail de login vai ao provedor antes desses pendentes e a resposta é 202.
- CA-02 Sem tick. Dado que o tick de jobs não está executando, quando o cliente pede o código, então o envio é tentado na própria requisição.
- CA-03 Abaixo do corte. Dado que o contador do dia UTC está em 50, quando o cliente pede o código, então o e-mail é enviado e o contador passa a 51.
- CA-04 Reserva de login. Dado que o contador está em 90 e chega um aceite novo, quando o aceite gera e-mail, então o item fica `adiado_cota` e não é enviado; e, se o cliente pedir o código nesse momento, o e-mail é enviado.
- CA-05 Cota esgotada. Dado que o contador do dia UTC está em 100, quando o cliente pede o código, então o e-mail fica pendente com recuo, a resposta é 202 e o envio é reavaliado na virada do dia UTC (depende de D-H097-1).
- CA-06 Falha do provedor. Dado que o provedor está indisponível, quando o cliente pede o código, então a resposta é 202, o e-mail fica em `email_outbox` com recuo e, ao voltar o provedor, sai uma única vez.
- CA-07 Tempo uniforme. Dado um e-mail cadastrado e outro não cadastrado, quando cada um pede acesso, então status e corpo são iguais e a diferença de tempo fica dentro do limite definido pela Arquitetura (H-011).
- CA-08 Dev e teste. Dado um ambiente de desenvolvimento ou teste, quando o login é pedido para destinatário fora da conta cadastrada, então nenhuma chamada à API do provedor é feita.
- CA-09 Sem interruptor. Dado o painel administrativo e as configurações, quando inspecionados, então não há opção para desligar o e-mail de login.
- CA-10 Chat e site intactos. Dado que a cota está em 100, quando um cliente envia mensagem no chat, então a mensagem aparece de imediato, sem depender de e-mail.

## 5. Fora de escopo

- Aumento da cota, plano pago ou upgrade (orçamento zero; decisão de custo do usuário).
- Envio ao público real: depende de domínio verificado (decisão 15; BK-10; H-093).
- Texto e layout do e-mail de login (revisão de copy é outra história).
- Prioridade de aceite, mensagem não lida, lembretes e digest (H-095, H-096, H-098, H-099).
- Canais além de e-mail (RF-121).
- Implementação do tick (S-10) e do contador de cota (H-094, já concluído).
- Reenvio de aceites antigos (proibido pela decisão 27).

## 6. Estado verificado

- [VERIFICADO] `packages/email/src/resend.ts` classifica respostas 429 como cota diária ou mensal, por marcadores provisórios. O texto real do provedor é [NÃO VERIFICADO] (S-11).
- [VERIFICADO] `packages/email/src/select.ts` escolhe o adaptador por ambiente e recusa valores inválidos. O pacote não tem ordenação por classe de prioridade. A prioridade deve ficar na camada de fila e notificações (H-092, H-094), a confirmar pela Arquitetura.
- [NÃO VERIFICADO] Estado de H-011, H-093, H-094 e do cartão #107 no quadro. Não consultei o GitHub nem movi cartões.

## 7. Conflitos nos documentos

- Alertas de cota: 08 §12.6 e H-094 falam em alerta a 70% e 85% (dia: 70 e 85; mês: 2.100 e 2.550). R-34, N-08 e Q-10 falam em 90 por dia e 2.700 por mês. A decisão 27 cita "alerta perto de 100/dia" como sugestão do líder. A Arquitetura deve escolher um conjunto único. Não bloqueia este refino, porque o login não depende de alerta.

## 8. Perguntas ao líder (não bloqueantes, exceto D-H097-1)

Identificadores locais; o líder atribui os números da sessão.

- D-H097-1 (decisão do usuário; recomendação do PO). "Sem atraso" com cota diária esgotada. No plano gratuito, 100 por dia é limite do provedor, e nenhum desenho sem custo entrega o código nesse caso. Opções: (a) login tem preferência até 100 por dia, e acima disso espera a virada UTC; (b) reserva maior para login, com menos espaço para aceite e lembretes; (c) plano pago, fora do orçamento zero. Recomendação: (a), com alerta em 70%. Destrava CA-05 e a frase de objetivo.
- D-H097-2 (escopo). Verificação e redefinição de senha do profissional saem pelo Supabase Auth (SMTP, S-11), fora da nossa fila. Recomendação: este refino cobre só os e-mails gerados pelo backend (link e código do cliente); os e-mails do Supabase Auth viram item separado após o resultado de S-11.
- D-H097-3 (comportamento). Conta não cadastrada. Recomendação: não enviar e-mail, para evitar enumeração e gasto de cota, mantendo a resposta igual (RN-5). Confirmar com H-011 [NÃO VERIFICADO nos documentos].
- D-H097-4 (meta). Tempo até o provedor aceitar o login. Não há meta nos documentos. Recomendação: a Arquitetura propõe a meta a partir das medições de S-11 e S-09; não fixar número agora.
- D-H097-5 (parâmetros). Intervalo mínimo e teto de reenvio (RF-040; H-015). Recomendação: manter com a Arquitetura.

## 9. Handoff para Arquitetura

- Critérios rastreáveis: RN-1 a RN-8 e CA-01 a CA-10.
- Pontos de desenho: ordem de envio por classe; contador por destinatário no dia UTC em `external_quota`; chave de idempotência por desafio; teste de tempo uniforme (RN-5).
- Antes de avançar: decisão do líder sobre D-H097-1 e D-H097-2.
