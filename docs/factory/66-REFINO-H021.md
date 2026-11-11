# Refino de Product Owner — #34 (H-021) Coordenada permanente (uma chamada)

Data: 2026-11-11 · Workflow: WF-03 (Product Owner) · Decisão de base: 46 (`11-DECISOES.md`, Mapbox adotado; BK-2 opção **(b)**). Fontes: `14-BACKLOG.md` (H-021), `11-ARQ-RISCOS-E-TESTES.md` (I-28, R-04, R-36, G-02 a G-06), `56-DESENHO-H020.md` (temporário já entregue).

## Objetivo

Guardar a coordenada exata de um pedido ou da base do profissional **uma única vez**, na publicação, usando o modo permanente do Mapbox, sem nenhum resultado temporário gravado e com teto de gasto.

## Decisão de base (46, opção b)

- A chamada **permanente** acontece **somente na publicação** do pedido (ou ao salvar a base do profissional, em H-036), nunca na revisão do rascunho.
- Rascunho, revisão e edição usam só o modo temporário gratuito (H-020).
- Consequência: edições de endereço antes da publicação não geram custo pago. Isto substitui a formulação original de G-02 ("revisão do rascunho"); os critérios abaixo refletem essa mudança.

## Critérios de aceite

- CA-1 (G-02, adaptado): publicar um pedido com endereço completo faz exatamente **1 chamada** `permanent=true`; `exact_point`, `match_point` e `geocode_mode='permanent'` são gravados.
- CA-2 (G-03): repetir a publicação (retry ou duplo clique) não gera nova chamada paga; a coordenada é a mesma (idempotente).
- CA-3 (G-04, adaptado): editar o endereço várias vezes **antes** da publicação não gera chamada permanente; o limite de 3 chamadas permanentes por pedido (I-28) só se aplica a republicações e alterações de endereço após publicação.
- CA-4 (G-05): tentar gravar `exact_point` sem `geocode_mode='permanent'` (SQL direto) é rejeitado pelo CHECK.
- CA-5 (G-06): ao atingir o teto de gasto configurado no proxy, o pedido fica "aguardando geocodificação", o texto é preservado, o cliente recebe aviso e o contador aparece no painel. Nenhuma resposta temporária é gravada no lugar.
- CA-6 (I-28): nenhuma coordenada vem de resultado temporário; nem em cache, nem em log, nem em tabela auxiliar.

## Fora de escopo

- Criação da conta, cartão e limite de gasto (já feito pelo usuário; a configuração do teto no código é da Issue).
- Modo de publicação de base do profissional (H-036).
- Leitura dos termos de licença do Mapbox (S-04). Continua como ponto de verificação, sem bloquear os testes locais, que usam simulador.

## Evidência exigida

- Testes locais com provedor simulado (sem rede), cobrindo CA-1 a CA-6.
- Nenhum teste chama o Mapbox real; isso só ocorre com autorização explícita para um teste pontual.

## Dúvidas registradas para o líder (sem bloquear)

- D-1: o teto de gasto por pedido (3) segue a decisão 29; recomendação: manter.
- D-2: o valor do breaker de gasto mensal fica em configuração, sem valor fixo no código; recomendação: o usuário define o valor na conta Mapbox e no proxy.
