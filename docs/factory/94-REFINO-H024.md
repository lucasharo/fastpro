# H-024 — Refino: cobertura booleana sem contagem

- **Issue:** #37 "[E2] Cobertura booleana sem contagem" · **Backlog:** H-024
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA, backlog ou quadro, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[PENDENTE]` depende de texto ou decisão em aberto · `[NÃO VERIFICADO]` sem fonte
- **Fontes lidas:** 14-BACKLOG (H-024, H-022, H-023, H-036, H-055, BK-5); 16-MANIFESTO-ISSUES (#37 = H-024, dependência H-023); 21-ISSUES-CRIADAS (H-024 = #37); quadro-status (#37 em Product Owner, #35 Concluído, #36 e #49 em Backlog); 04-PRD (RF-004, RF-013, RF-018, RF-020, RF-021, RF-051, RF-065); 05-CRITERIOS-ACEITE (FA-010); 07-AMBIGUIDADES (AMB-03 A, B, C); 08-ARQUITETURA §9.3, §9.4, §9.5, §15; 09-MODELO-DADOS (`professional_area`); 10-ADRS (ADR-014); 11-ARQ-RISCOS-E-TESTES (§2.2 rotas, G-02, T-03, T-11, T-12); 11-DECISOES (decisões 46, 54, 55, 56 (duplicidade e cobertura), 57); 88-DESENHO-H022 (§1, §2, §5, §7, §9); 94 é o próximo número livre (último existente: 93-DESENHO-H027); padrão: 87-REFINO-H026.

## 1. Objetivo

Permitir que o cliente, depois de publicar o pedido, veja no estado do pedido se há profissional elegível na área, com uma resposta só: "com" ou "sem". Não aparecem número, faixa, lista nem identificador. A resposta também fica limitada contra sondagem. `[DECIDIDO]` RF-020, decisão 56 (cobertura no estado do pedido publicado); `[VERIFICADO]` 08 §9.4, 14-BACKLOG H-024 ("resposta só com ou sem; sondagem limitada").

Esta história entrega o booleano e a sua exposição no estado do pedido publicado. Não entrega a elegibilidade completa (aprovação e acesso vigente, §5), nem aviso antes da publicação.

## 2. Escopo

### 2.1 Fluxo do cliente

| Passo | O que acontece | Origem |
|---|---|---|
| 1. Pedido publicado | Só depois da publicação (com a coordenada permanente gravada) a cobertura passa a existir para o pedido | `[DECIDIDO]` decisões 46 e 56; `[VERIFICADO]` 11-ARQ G-02 |
| 2. Consulta do estado | O cliente dono vê "com" ou "sem" no estado do pedido aberto | `[DECIDIDO]` RF-018, RF-020; `[VERIFICADO]` decisão 56 |
| 3. Sem cobertura | Aparece o texto aprovado para "sem" (BK-5) | `[PENDENTE]` BK-5 |
| 4. Sondagem | Consultas acima do limite recebem 429 sem detalhe | `[PROPOSTA]` 08 §9.4 e §15; ADR-014 |

### 2.2 Regra do booleano

- **"com"**: existe pelo menos um profissional que atende a regra de descoberta do pedido (RF-065): serviço compatível; aprovado e com acesso vigente; e, se o serviço for presencial, base a até o próprio raio (5 a 100 km) do pedido; se o serviço for online, sem raio (alcance nacional). `[DECIDIDO]` RF-004, RF-051, RF-065, FA-010; `[VERIFICADO]` 08 §9.3.
- **"sem"**: nenhum profissional cumpre a regra acima. `[PROPOSTA]` definição do PO.
- A pergunta é de **existência**: a consulta para no primeiro profissional que cumpre a regra. Nunca conta. `[PROPOSTA]` (CA-03).
- A posição é a **célula**: o centro da célula do pedido e o centro da célula da base do profissional. Nenhuma leitura de ponto exato. `[DECIDIDO]` decisão 57 (D-2); `[VERIFICADO]` 88 §1 e §7; 08 §9.4 (`has_coverage(service, match_cell)`).

### 2.3 Impacto em dados e APIs `[PROPOSTA]`

- Um campo no estado do pedido publicado (nome pelo Architect). Não há resposta de cobertura para visitante, rascunho ou profissional (CA-09 e CA-10).
- Possível cache de 5 min guardado no banco (D-H024-5). Possível contador de limite (ADR-014, `rate_counter`).
- Não cria tabela de pedidos nem altera `app.geocode_point` além do que a #35 já criou.

## 3. Fora de escopo

- **Aviso antes de publicar (AMB-03 B):** a decisão 56 tirou a cobertura da revisão; a revisão mostra só o texto do endereço. O backlog ainda diz "AMB-03 A+B" (D-H024-8).
- **Contagem, faixa, lista, nome ou identificador de profissional, distância:** proibido por RF-020 e FA-010.
- **Fila de interesse "aguardando cobertura" (AMB-03 C):** não aprovada; fora.
- **Aviso por e-mail quando surgir profissional:** o texto A de AMB-03 promete esse aviso, mas não há história de notificação no backlog. Fica fora (D-H024-7).
- **Rota pública de cobertura antes da publicação** (11-ARQ §2.2 `GET /coverage`): conflita com a decisão 56 (D-H024-1).
- **Cálculo completo de elegibilidade** (guarda de elegibilidade, verificação de aprovação, acesso vigente): H-055 (#55), H-039 e E5. Esta história consome o que existir (D-H024-3).
- **Descoberta de pedidos pelo profissional:** H-023 (#36) e H-055.
- **Rótulo de bairro, cidade ou UF:** H-032.
- **PostGIS no caminho de consulta:** fora (decisão 57, D-2). PostGIS só serve como oráculo de teste.

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Dois valores.** Dado um pedido publicado e aberto, quando o cliente dono consulta a cobertura, então recebe somente "com" ou "sem". Nenhum outro valor, número ou faixa. `[DECIDIDO]` RF-020, decisão 56; `[VERIFICADO]` 14-BACKLOG H-024.

- **CA-02 Sem contagem nem identificador.** Dado qualquer resposta de cobertura, quando é examinada na API e no banco, então não contém quantidade, lista, identificador de profissional, distância ou coordenada. Dado o mesmo pedido com 0, 1 e 5 profissionais elegíveis na célula, então a resposta tem a mesma forma e só o valor muda. `[DECIDIDO]` RF-020, FA-010; `[PROPOSTA]` teste de forma.

- **CA-03 Existência, não contagem.** Dado uma área com um profissional elegível, quando a cobertura é calculada, então a consulta para no primeiro encontrado (limite 1) e o resultado é "com". Dado nenhum profissional elegível, o resultado é "sem". `[PROPOSTA]` (D-H024-2); base `[VERIFICADO]` 08 §9.4.

- **CA-04 Regra igual à de descoberta.** Dado um profissional presencial que atende o serviço, está aprovado, com acesso vigente e tem base a até o próprio raio do pedido (5 a 100 km), então conta como "com". Dado um profissional com serviço online compatível, então conta sem raio. Se falta qualquer requisito, não conta. Cada requisito é testado isolado. `[DECIDIDO]` RF-004, RF-051, RF-065, FA-010; `[VERIFICADO]` 08 §9.3. Aprovação e acesso vigente dependem de H-039 e de #55 (D-H024-3).

- **CA-05 Só célula, nunca ponto exato.** Dado dois pedidos com pontos exatos diferentes na mesma célula, quando a cobertura é calculada para ambos, então o resultado é igual. O caminho de consulta não lê ponto exato e não usa PostGIS. `[DECIDIDO]` decisão 57 (D-2); `[VERIFICADO]` 88 §1, §7. Uso de `match_cell` do pedido: D-H024-6.

- **CA-06 Cache curto.** Dado uma cobertura calculada há menos de 5 min para o mesmo par (serviço, célula), quando é consultada de novo, então devolve o valor guardado. Após 5 min, recalcula. O cache guarda só o booleano, por (serviço, célula), sem dado de pedido ou de profissional. `[PROPOSTA]` 08 §9.4; onde guardar: D-H024-5.

- **CA-07 Sondagem limitada.** Dado um cliente que passa do limite de consultas de cobertura na janela, quando consulta de novo, então recebe 429 sem informar o limite nem quantas consultas fez. O contador fica em Postgres (ADR-014). `[DECIDIDO]` RF-021 (sem detalhe de limite); `[PROPOSTA]` valores (D-H024-9); base T-12.

- **CA-08 Só o dono e só pedido aberto.** Dado um pedido de outra pessoa, quando alguém pede a cobertura dele, então recebe "não encontrado" (404), igual ao CA-06 de H-026. Dado um pedido selecionado, encerrado ou cancelado, então o campo de cobertura não aparece. `[PROPOSTA]` (D-H024-6); estados `[VERIFICADO]` RF-018.

- **CA-09 Sem rota antes da publicação.** Dado um visitante ou um rascunho sem pedido publicado, quando procura cobertura, então não existe rota para isso. A revisão mostra só o texto do endereço. `[DECIDIDO]` decisão 56; conflito com 11-ARQ §2.2 (`GET /coverage` público): D-H024-1.

- **CA-10 Profissional não consulta cobertura.** Dado um profissional, quando consulta um pedido (inclusive um pedido elegível para ele), então o campo de cobertura não vem na resposta. `[VERIFICADO]` 14-BACKLOG H-055 (sem dado de pedido além do permitido), T-03.

- **CA-11 Textos aprovados.** Dado cobertura "sem" ou "com", quando o cliente vê o estado, então o texto é o aprovado em BK-5: sem número, sem promessa de atendimento e sem promessa de aviso por e-mail. A história não fecha sem BK-5. `[PENDENTE]` BK-5 (líder ou usuário); RF-020; texto A de AMB-03 (D-H024-7).

- **CA-12 Nada de valor em log ou erro.** Dado qualquer chamada de cobertura, quando há log ou erro, então não grava célula, coordenada, contagem nem identificador de profissional. Mensagens de erro têm texto fixo. `[VERIFICADO]` 88 §7 item 4; 11-ARQ T-11.

## 5. Dependências

- **#35 (H-022), Concluída:** fornece `match_cell`, `match_point`, `match_grid_version`, a grade e a função de grade. `[VERIFICADO]` quadro-status; 88 §0 e §3.
- **H-023 (#36), no Backlog:** o 16-MANIFESTO e o 14-BACKLOG listam H-023 como dependência de H-024, além da #35. A dependência real é, portanto, #36, e não só #35. Esta história pode ser refinada agora, mas só deve ser desenvolvida e concluída depois de H-023. `[VERIFICADO]` 16-MANIFESTO (#37), quadro-status (#36 em Backlog).
- **H-036 (#49), no Backlog:** base, raio e serviços do profissional. Sem ela não há lado profissional para a cobertura. `[VERIFICADO]` 14-BACKLOG H-036, quadro-status (#49 em Backlog), 09 (`professional_area`).
- **Publicação (H-030):** a cobertura só existe para pedido publicado, com coordenada permanente gravada. No quadro o cartão está em Arquitetura (#43); no 16-MANIFESTO consta #41. O Orquestrador confere o número. `[VERIFICADO]` decisões 46 e 56; quadro-status; 16-MANIFESTO.
- **H-039 e #55 (guarda de elegibilidade):** aprovação do profissional e acesso vigente. A transição de aprovação ainda será desenhada em H-039. `[VERIFICADO]` decisão 54.
- **H-005 (contador de taxa, ADR-014):** o limite de CA-07 depende do contador em Postgres. `[VERIFICADO]` 14-BACKLOG (H-005 citado por H-026).
- **BK-5 (textos):** decisão do líder ou do usuário. `[VERIFICADO]` 14-BACKLOG BK-5; BLQ-DEC.

## 6. Evidência exigida

Registrada na Issue #37, com comando, contagem e código de saída de cada execução local. Não declarar CI verde.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de passou e falhou.
- **CA-01 e CA-02:** teste de forma da resposta com 0, 1 e 5 profissionais elegíveis na mesma célula; a resposta varia só no valor.
- **CA-03:** teste de existência com limite 1; `explain` da consulta com índice, sem `Seq Scan` nas tabelas de geocodificação (mesma regra de 88 T-CA08).
- **CA-04:** um caso por requisito (aprovado, acesso vigente, serviço, raio em 5 km e 100 km, online); fronteira do raio com tolerância definida em D-H024-4.
- **CA-05:** dois pontos exatos na mesma célula com resultado igual; varredura de funções: nenhuma lê ponto exato ou usa PostGIS no caminho de consulta.
- **CA-06:** relógio simulado: resultado dentro de 5 min vem do cache; após 5 min recalcula. Não usar espera real.
- **CA-07 (T-12):** após o limite, 429 sem detalhe de limite nem contagem.
- **CA-08:** 404 para pedido de outra pessoa; campo ausente em pedido selecionado, encerrado e cancelado.
- **CA-09 e CA-10:** varredura de rotas e de respostas: nenhuma rota pública de cobertura; resposta de profissional sem o campo.
- **CA-11:** texto aprovado em BK-5, com quem aprovou e quando, registrado na Issue. Sem isso a Issue não fecha.
- **CA-12 (T-11):** varredura de log e de erro sem célula, coordenada, contagem ou identificador.

## 7. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação. Os números serão consolidados pelo líder em lista única.

- **D-H024-1 (rota pública de cobertura).** 11-ARQ §2.2 traz `GET /coverage?service&place` público, com limite. A decisão 56 tira a cobertura da revisão, e a decisão 46 proíbe guardar coordenada temporária. **Recomendação:** remover a rota pública; a cobertura existe só no estado do pedido publicado do dono. **Alternativa:** manter a rota com coordenada temporária só em memória (08 §9.5, não adotada). Descartada por contrariar a decisão 46. Não bloqueia o refino; o Architect não cria a rota sem essa decisão.

- **D-H024-2 (sentido inverso da consulta).** A #35 pesquisa pedidos a partir de uma base (`match_points_within`, filtro `subject_kind = 'request'`). A cobertura pesquisa bases de profissional a partir de um pedido, cada uma com o próprio raio. Não existe primitiva para isso. **Recomendação:** função de existência própria, com limite 1, que reusa a grade e as faixas da #35 e filtra profissionais. Não reutilizar `match_points_within` sem mudança. Não bloqueia.

- **D-H024-3 (regra de elegível antes de #55 e H-039).** Sem a guarda de elegibilidade e a aprovação, "aprovado" e "acesso vigente" não existem no banco. **Recomendação:** usar a regra completa de RF-065. Enquanto #55 e H-039 não existirem, o desenho pode seguir, mas a história não pode ser concluída. Bloqueia a conclusão, não o desenho.

- **D-H024-4 (tolerância da fronteira do raio).** Os dois lados usam centro de célula; cada um tem erro de até 355 m (88 §2.3), então o erro somado pode chegar a cerca de 710 m. **Recomendação:** aceitar; o teste de fronteira exclui a faixa de 710 m em torno do raio, e a regra vai para a Issue. **Alternativa:** usar o ponto exato da base do profissional. Descartada, porque contraria CA-05. Não bloqueia.

- **D-H024-5 (onde guardar o cache de 5 min).** Em serverless não há memória compartilhada (ADR-014). **Recomendação:** tabela no Postgres, com validade de 5 min, só com o booleano por (serviço, célula). Se o banco gratuito pesar, a história pode seguir sem cache, com o limite de CA-07 segurando a carga. Não bloqueia.

- **D-H024-6 (quando aparece e qual célula).** **Recomendação:** cobertura só para pedido aberto (publicado e dentro dos 7 dias); some em selecionado, encerrado e cancelado. Usa `match_cell` do pedido, como em 08 §9.4. 11-ARQ G-02 diz "coordenada"; a recomendação é ler isso como célula, sem ponto exato. Não bloqueia.

- **D-H024-7 (textos, BK-5).** **Recomendação para "sem":** "Ainda não há profissionais disponíveis para este pedido." (texto A de AMB-03, sem "Avisaremos por e-mail", porque não há história de notificação). **Recomendação para "com":** "Há profissionais na sua região para este serviço." (proposta nova, a aprovar). Não bloqueia o desenho; bloqueia o fechamento (CA-11).

- **D-H024-8 (AMB-03 B e backlog).** A decisão 56 deixou só o A de AMB-03, mas o 14-BACKLOG ainda diz "A+B" e 08 §9.4 ainda cita a revisão. **Recomendação:** registrar a decisão 56 no backlog e em 08 §9.4 (a própria decisão 56 pede esse ajuste). Ajuste de texto, feito pelo Orquestrador. Não bloqueia.

- **D-H024-9 (limites de consulta).** Os valores não existem nas fontes (08 §15 não traz números). **Recomendação [PROPOSTA]:** 20 consultas por hora por pedido e 60 por hora por IP-HMAC, com cache de 5 min (CA-06). O Architect confirma. Não bloqueia.

- **D-H024-10 (numeração da decisão 56).** A decisão 56 aparece duas vezes em 11-DECISOES (linhas 210 e 212). Esta história usa a de duplicidade e cobertura (linha 210). **Recomendação:** o líder confirma essa leitura e renumera a de H-026 (a nota da linha 216 já reserva 58 para outra rodada). Não bloqueia.

## 8. Próximo passo

O líder valida D-H024-1 (rota pública), D-H024-7 (textos, BK-5) e D-H024-3 (regra de elegível e ordem com H-023, H-036 e #55). As demais dúvidas seguem para o Architect com as recomendações acima. O cartão #37 permanece na coluna Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino.
