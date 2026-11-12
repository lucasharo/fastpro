# Refino de Product Owner — #35 (H-022) Célula generalizada e match_point

- **Data:** 2026-11-12 · **Workflow:** WF-03 (Product Owner, refino) · **Papel:** Product Owner · **Status:** rascunho para o líder (Orquestrador)
- **Natureza:** somente documento. Nenhuma Issue, Project, código ou teste foi criado ou alterado. Nenhum teste foi executado. Nenhuma consulta ao GitHub foi feita nesta rodada; o estado da Issue vem de `14-BACKLOG.md` e `16-MANIFESTO-ISSUES.md`.
- **Fontes:** `14-BACKLOG.md` (H-022, BLQ-SPK, BK-2); `16-MANIFESTO-ISSUES.md` (linha 85: #35 = H-022); `11-DECISOES.md` (decisão 46); `08-ARQUITETURA.md` §9.1–9.5; `09-MODELO-DADOS.md` §3.4; `11-ARQ-RISCOS-E-TESTES.md` (I-28, R-05, R-38, S-02, T-03, G-02); `17-CHECKLIST-REVISAO.md` (B-16); `04-PRD.md` (RF-013); `05-CRITERIOS-ACEITE.md` (FA-007); `66-REFINO-H021.md` (padrão).

---

## Objetivo

Transformar a coordenada exata de um pedido (gravada pela H-021, #34) em um ponto generalizado (`match_point`), centro de uma célula de grade de ≈ 500 m, usado para casar pedidos com profissionais. O ponto exato nunca sai em consulta de profissional.

## Decisão de base

- **RF-013 [APROVADO]:** endereço preciso é privado; profissional vê localização generalizada.
- **08 §9.2 [PROPOSTA]:** o casamento usa o centro de célula de grade de 500 m, de forma determinística; erro aceitável de até metade da diagonal da célula.
- **09 §3.4:** `exact_point` só vem de `permanent=true`; `match_point` é a célula generalizada; há índice sobre `match_point`.
- **Decisão 46 (opção b):** a coordenada permanente só é gravada na publicação (H-021). Isso gera a dúvida D-1 abaixo.

## Pré-condições (não são critérios de aceite)

- **P-a:** H-021 (#34) entregue. H-022 usa a mesma função única de persistência de coordenada (I-28), logo os mesmos arquivos.
- **P-b:** S-02 decidido (PostGIS ou fallback) e registrado antes de implementar (BLQ-SPK). PostGIS, `pg_cron` e `pg_net` não foram encontrados no plano gratuito (R-38).
- **P-c:** tamanho da célula (500 m) confirmado pelo líder (D-4).

## Escopo

- Cálculo da célula de grade a partir de `exact_point`, gravado como `match_point` na mesma transação que `exact_point`.
- Função de consulta por distância sobre `match_point`, primitiva para H-023, com a mesma semântica nas duas opções de S-02.
- Índice sobre `match_point`, adequado à opção escolhida.
- Garantia de privacidade: nenhum caminho de profissional expõe `exact_point`.
- Migração por expansão (expand/contract) da coluna, sem perda de pedidos existentes.

## Critérios de aceite

- **CA-01 (I-28, 09 §3.4):** ao publicar (fluxo da H-021), o pedido recebe `exact_point` e `match_point` na mesma transação. Falha no meio não grava nenhum dos dois.
- **CA-02 (determinismo):** a mesma coordenada, gravada em execuções ou pedidos diferentes, gera sempre o mesmo `match_point`. Repetir a publicação (retry ou duplo clique) não altera o valor.
- **CA-03 (precisão, 08 §9.2):** para pontos sintéticos distribuídos no território brasileiro, a distância entre `exact_point` e `match_point` é de no máximo metade da diagonal da célula (≈ 354 m para lado de 500 m) em todos os casos.
- **CA-04 (origem, I-28):** `match_point` só existe com `exact_point` gravado com `geocode_mode='permanent'`. Gravar `match_point` sem `exact_point`, ou com `exact_point` sem modo permanente, é rejeitado pelo banco (CHECK ou trigger). Mesmo padrão de G-05.
- **CA-05 (privacidade, T-03, I-16, B-16):** nenhuma resposta, view, consulta ou log voltado a profissional contém `exact_point` nem endereço textual. Profissional recebe no máximo o ponto generalizado (ou o rótulo mais o ponto generalizado, conforme H-032). Teste de contrato com papel de profissional.
- **CA-06 (triangulação, 08 §9.2):** duas coordenadas diferentes dentro da mesma célula produzem o mesmo `match_point` e o mesmo resultado de consulta. Um profissional que repete pesquisas com bases diferentes só aprende a célula.
- **CA-07 (paridade de consulta, S-02):** para o mesmo conjunto sintético, a consulta por distância sobre `match_point` retorna o mesmo conjunto de pedidos na opção PostGIS e na opção de fallback. Pontos a menos de uma faixa de tolerância da fronteira do raio podem divergir por arredondamento; a faixa é definida pelo Architect [PROPOSTA: 10 m] e o teste a exclui explicitamente.
- **CA-08 (desempenho, R-05):** a consulta por distância usa índice sobre `match_point` (plano de execução verificado com dados sintéticos, em banco local).
- **CA-09 (borda de grade):** a grade cobre todo o território brasileiro (extremos norte, sul, leste e oeste) e um ponto na fronteira entre células recebe exatamente uma célula.
- **CA-10 (migração):** a coluna entra por expansão; pedidos existentes sem `exact_point` ficam com `match_point` nulo, sem reescrita destrutiva, e a migração pode ser revertida.

## Fora de escopo

- Descoberta por raio de 5 a 100 km e filtros por serviço e status (H-023).
- Chamada permanente, teto de 3 chamadas, breaker de gasto e CHECK de `geocode_mode` (H-021).
- Célula e ponto da base do profissional (`base_point`) e seu raio (H-036).
- Regra de duplicidade (≤ 100 m, H-030) e cobertura (H-024). São consumidoras de `match_point`; como consomem depende de D-1.
- Rótulo público (bairro, cidade e UF): nenhuma história o cobre explicitamente (ver D-5).
- Leitura dos termos de produto do Mapbox (S-04).
- Qualquer execução contra Supabase Free real ou Mapbox real (BLQ-EXEC).

## Evidência exigida

- Testes locais com Postgres efêmero (com PostGIS apenas se a opção escolhida o exigir) e provedor simulado, sem rede, cobrindo CA-01 a CA-10.
- Para cada comando: comando exato, contagem de passou e falhou, e código de saída, registrados na Issue #35. Não declarar CI verde.
- Testes de referência: T-03 (visibilidade), G-02 (`match_point` gravado junto com `exact_point`), B-16 (checklist), I-16, I-28, R-05 (plano de execução).
- Teste de paridade PostGIS × fallback (CA-07) se as duas opções forem implementadas; caso contrário, justificativa registrada da opção escolhida.
- Migração aplicada localmente com `npx supabase`. Nenhum caminho pelo MCP do Supabase.
- Dados exclusivamente sintéticos (RF-163).

## Dúvidas para o líder (sem bloquear este refino)

- **D-1 (conflito: decisão 46 × H-030, H-024 e 08 §9.4) — decidir antes da Arquitetura.** A decisão 46 (b) permite a chamada permanente só na publicação, mas a revisão do rascunho calcula duplicidade (≤ 100 m) e cobertura, que dependem de coordenada ou célula. Alternativas: (a) a revisão usa resultado temporário só em memória, sem gravar (risco: termos de uso não lidos, S-04); (b) duplicidade e cobertura passam para a publicação, e a revisão mostra só o texto do endereço; (c) cobertura na revisão só por serviço e texto. **Recomendação: (b)**, que mantém custo zero até a publicação e não depende de interpretar termos não lidos. Exige registrar em `11-DECISOES.md` e ajustar H-030, H-024 e FA-002. Destrava: H-030, H-024 e o desenho de H-022.

- **D-2 (PostGIS ou fallback).** S-02 não confirmou PostGIS no plano gratuito (R-38). Alternativas: (a) esperar S-02, que exige autorização para projeto de teste (BLQ-EXEC); (b) fallback: célula como chave inteira com índice B-tree e filtro de distância na aplicação ou em função; (c) PostGIS só local, sem garantia em produção. **Recomendação: (b)** como caminho que não depende de S-02, com CA-07 provando paridade; PostGIS apenas se S-02 confirmar. Destrava: escolha técnica do Architect.

- **D-3 (sequência e arquivos em comum).** #35 usa a mesma função de persistência de coordenada da #34 (I-28). Pela regra de paralelismo (sem arquivos em comum), **recomendação:** a Arquitetura de #35 pode começar, mas o Desenvolvimento só entra depois que #34 chegar a Aguardando aprovação. Destrava: ordem da fila.

- **D-4 (parâmetros da grade).** O lado de 500 m é [PROPOSTA]. **Recomendação:** confirmar 500 m e registrar a versão da grade junto de `match_point`, para que uma mudança futura de tamanho não altere pedidos em silêncio. Detalhe de desenho para o Architect. Destrava: CA-03 e CA-09.

- **D-5 (correções de rastro e lacuna).** (i) H-022 cita "09 §9.1–9.2", mas o modelo geo está em 08 §9.1–9.2 (09 §9 é orçamento de dados). **Recomendação:** corrigir o rastro em `14-BACKLOG.md`. (ii) O rótulo público (bairro, cidade e UF) não tem história explícita; H-032 o cita. **Recomendação:** tratar em H-032 e não aqui.

- **Observado fora desta Issue (para o líder):** `18-PLANO-QA.md` (N13) diz que a decisão 36 aprovou a opção A para BK-2, mas a decisão 46 aplicou a opção (b). Pertence à #34; registrar a divergência antes de liberar H-021.
