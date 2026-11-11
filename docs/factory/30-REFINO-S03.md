# Refino S-03 — Mercado Pago: tarifas, recorrência, Pix e webhook (Issue #6, spike, WF-03, Product Owner)

- **Data:** 2026-11-10 · **Branch:** `feature/init` (confirmada em `.git/HEAD`) · **Rastro:** Issue #6 (21-ISSUES-CRIADAS, linha S-03); 19 §3.5, §4 (S-03), §7; 10-ADRS ADR-007, ADR-020 §20.1; 08 §8; 04 RF-055 a RF-061; 05 FA-006; 13 (Mercado Pago, tarifas com 403); 14 H-046 a H-054; 11-DECISOES nº 37; 12-TODO #12; `workflows/WF-03-FEATURE.md`.
- **Natureza:** SOMENTE documento. Nenhuma conta, aplicação, usuário de teste, cartão, Pix, assinatura, webhook ou chamada externa foi criado ou feito. `.env.local` não foi lido; aparecem aqui apenas nomes de variáveis.
- **EXEC-ID:** não gerado (sem ferramenta de shell nesta sessão; `execctl.py` não foi acionado).
- **Etiquetas:** `[APROVADO]` decisão do usuário ou regra vigente · `[DELEGADO]` escolha técnica ao DEV · `[PROPOSTA]` sugestão deste refino, pendente do Orquestrador · `NÃO VERIFICADO` fato externo sem fonte consultada nesta sessão.

---

## 0. Premissas

- **[APROVADO]** Checkout **Bricks** para cartão e Pix (decisão do usuário nesta rodada).
- **[APROVADO]** Planos e assinaturas pela aba **Assinaturas** do Mercado Pago (lido como API de planos e assinaturas; confirmar, D-S03-6).
- **[APROVADO]** Decisão 37: sandbox, dados sintéticos, sem cobrança real.
- **[APROVADO]** O teste grátis de 14 dias é do nosso app (RF-057; `access_grant`). O spike **não** cria período de teste no Mercado Pago.
- **[APROVADO]** Sem boleto (H5). Pix é cobrança avulso por ciclo (RF-058). Recorrência automática só no cartão **[PROPOSTA]** até D-S03-4.
- **[APROVADO]** Preços em centavos (H-046; RF-055): 2990, 8070, 14940 e 23880 (R$ 29,90; R$ 80,70; R$ 149,40; R$ 238,80).

---

## 1. Critérios Given/When/Then (sandbox)

**CA-S03-00 Credencial e ambiente [APROVADO; AGENTS item 9; 19 §7].** Dado que a aplicação e os dois usuários de teste só existem após autorização do spike (BK-6 b; SD-14; D-S03-1), quando o script roda, então lê `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` e `MP_ENV` **somente** de `.env.local`, sem imprimir valor; recusa rodar se `MP_ENV` não for `sandbox`; se faltar variável, para e registra "sem credencial". Nenhum valor vai a log, resultado, documento ou commit.

**CA-S03-01 Recorrência por ciclo [APROVADO objetivo; PROPOSTA método].** Dado a aplicação de teste, quando o spike cria um plano de sandbox para cada ciclo (1, 3, 6 e 12 meses) com o valor correspondente, então registra "aceito" ou "recusado" com o código literal devolvido. Se 3 ou 6 meses forem recusados, ativa-se o fallback "pagamento avulso por ciclo" (ADR-007). Isso é resultado válido, não falha do spike.

**CA-S03-02 Cartão de teste: aprovada, recusada, pendente [APROVADO; PROPOSTA].** Dado um cartão de teste oficial (números na documentação oficial, não reproduzidos aqui) e o plano mensal, quando o spike faz a adesão pelo Bricks em sandbox, então há um registro para cada resultado (aprovada, recusada, pendente) com: status literal; confirmação por consulta ao recurso na API (não pelo corpo do webhook); e o nome literal do campo de data de aprovação, insumo de `period_start` (08 §8.4).

**CA-S03-03 Bricks e dados de cartão fora do servidor [APROVADO checkout; NÃO VERIFICADO escopo PCI].** Dado a página de teste com Bricks sandbox, quando o usuário de teste paga com cartão de teste e com Pix de teste, então a tokenização ocorre no componente do Mercado Pago no navegador, e nenhuma requisição ao servidor de spike contém número de cartão, código de segurança ou validade (verificado no log de requisições do spike). Se o Bricks não renderizar sem origem pública, registrar o motivo; o critério fica NÃO VERIFICADO.

**CA-S03-04 Pix avulso de teste [APROVADO Pix; NÃO VERIFICADO simulação].** Dado um pagamento Pix de sandbox no valor de um plano, quando é criado, então registra: status inicial literal; se o QR existe (sem copiar código copia-e-cola); data de vencimento devolvida; e se o sandbox simula aprovação (sim, não ou NÃO VERIFICADO). Pix pendente não concede acesso (08 §8.5).

**CA-S03-05 Pix em recorrência [PROPOSTA; depende de D-S03-4].** Dado o pedido de "recorrência" também para Pix, quando o spike tenta uma assinatura com Pix como meio, então registra aceito ou recusado. Se recusado (esperado: "Pix Automático" não foi encontrado, 13), Pix segue manual por ciclo (RF-058). Se aceito, não vira regra sem nova decisão do usuário.

**CA-S03-06 Webhook com assinatura verificada [APROVADO; formato NÃO VERIFICADO; depende de URL pública, D-S03-2].** Dado um webhook de teste entregue à URL pública de spike, quando chega com `x-signature` e `x-request-id`, então o endpoint verifica a assinatura com `MP_WEBHOOK_SECRET` conforme o formato oficial (manifesto a confirmar e registrar com URL e data). Assinatura válida: responde 200 e grava em `provider_event`. Assinatura inválida ou ausente: responde 401 e não grava concessão. Sem URL pública, o critério fica NÃO VERIFICADO com motivo "sem URL pública"; não se substitui por simulador.

**CA-S03-07 Estado vem do recurso, não do corpo [APROVADO RF-060; 08 §8.7].** Dado um webhook com assinatura válida, quando processado, então o endpoint consulta o pagamento ou a assinatura pela API do Mercado Pago e usa o estado retornado. Se o corpo trouxer estado diferente do recurso de propósito, a concessão segue o recurso.

**CA-S03-08 Reenvio, duplicado e fora de ordem [APROVADO requisito; PROPOSTA método].** Dado um webhook que o spike deixa falhar de propósito (resposta não 2xx), quando o Mercado Pago reenvia, então registra o intervalo observado (13 cita 15 min; NÃO VERIFICADO) e a nova entrega não gera segunda concessão. Dado o mesmo evento reenviado manualmente ao endpoint com a mesma assinatura, então há um só registro em `provider_event` e um só efeito. Dado um evento antigo entregue depois de um novo, então o estado não regride.

**CA-S03-09 Cancelamento de teste [PROPOSTA; apoia H-052].** Dado uma assinatura de teste ativa, quando o spike a cancela pela API, então registra o status resultante e se chegam novos eventos. O acesso até o fim do período (RF-061) é regra do nosso livro (`access_grant`), não do Mercado Pago.

**CA-S03-10 Tarifas: o que mostrar [APROVADO regra de não inventar; valores NÃO VERIFICADOS].** Dado que a tabela oficial de tarifas não foi obtida (403 em 13; 12-TODO #12), quando o spike roda, então:
- (a) registra, por pagamento de sandbox, os campos de taxa que a própria resposta da API trouxer (nome literal do campo, valor e moeda), ou "não retornado";
- (b) marca esses valores como "sandbox, não é tarifa de produção";
- (c) a tabela oficial é obtida pelo usuário no painel, no atendimento ou em página aberta no navegador dele, sem dados pessoais, com URL e data; não se contorna bloqueio;
- (d) nenhum percentual, valor fixo ou margem simulada aparece em documento, fixture ou cálculo antes de a tabela estar registrada como VERIFICADA;
- (e) H-054 segue bloqueado.

**CA-S03-11 Fixtures e não produção [APROVADO; 19 §3.5 passo 7; DS-12].** Dado o fim do spike, quando gera as fixtures do simulador de CI, então elas contêm só dados sintéticos, sem segredo, token, número de cartão, código Pix ou identificador real de usuário de teste. Dado `MP_ENV=production`, então o spike recusa rodar; nenhum meio de pagamento real é cadastrado.

---

## 2. O que o resultado libera (conforme backlog)

| Item | Se os critérios aprovarem | Se recusarem ou ficarem pendentes | Continua bloqueado |
|---|---|---|---|
| **H-046** planos e preços | Não depende do resultado: preços são RF-055 [APROVADO]. Pode seguir após H-045 **[PROPOSTA]** | Igual | — |
| **H-047** checkout Bricks (Pix e cartão) | Libera com CA-S03-02, 03 e 04 aprovados | Fica no plano de fallback (avulso por ciclo) | BLQ-EXEC; BLQ-DEC (BK-3); D-S03-3 |
| **H-048** webhook idempotente | Libera com CA-S03-06, 07 e 08 aprovados | Sem URL pública, não libera | D-S03-2 |
| **H-049** concessão e início de período | Libera com CA-S03-02 (campo de aprovação confirmado); regra de 08 §8.4 segue | Igual | H-048 |
| **H-050** carência de 72 h | Pouco depende do MP (regra interna, 08 §8.5). Libera junto com H-049 **[PROPOSTA]** | Igual | H-049 |
| **H-051** adesão expressa e Pix manual | Libera com CA-S03-02 e CA-S03-05 (recorrência só cartão) | Igual, com Pix manual | D-S03-4 |
| **H-052** cancelamento | Libera com CA-S03-09 | Igual | H-049, H-050 |
| **H-053** reconciliação | CA-S03-07 confirma consulta por ID; listagem para reconciliação é NÃO VERIFICADO e fica para o próprio H-053 | Igual | H-008 (tick) |
| **H-054** gate de cobrança real | **Não liberado** pelo spike. Exige tarifas VERIFICADAS, L1 a L4 e L7, Vercel Pro, backup | Igual | Tarifas (12-TODO #12); Vercel Pro (ADR-018) |
| **H-021** e **H-022** | **Não liberados** por S-03. Pelo backlog dependem de S-04 (Mapbox) e de S-02 (PostGIS) (14 §4, linhas 117 e 118) | — | S-04, S-02 |

Se 3 ou 6 meses forem recusados (CA-S03-01), o fallback de avulso por ciclo afeta H-046, H-049 e H-051 e exige decisão do usuário **[PROPOSTA]**.

Nada disso libera cobrança real, produção ou `MP_ENV=production` (Gate M4).

---

## 3. Fora do escopo

- Cobrança real, cartão real, Pix pago de verdade, produção e `MP_ENV=production` (bloqueados até o Gate M4).
- Tarifas e mensalidade: não obtidas (NÃO VERIFICADO). Não são inventadas nem estimadas.
- Teste grátis do Mercado Pago: não usado (o trial é do app, RF-057).
- "Pix Automático": não encontrado (13); não é testado como produto.
- Webhook em URL pública sem S-09 ou túnel autorizado.
- Boleto (H5): não testar.
- Estorno e chargeback (H-106; BLQ-JUR L3); reembolso proporcional automatizado (RF-063 não automatiza).
- Código: Bricks, webhook e cobrança são do DEV, em `spike/S-03` (descartável) e depois em H-047 e H-048. Este refino não escreve código.
- Mapbox e PostGIS: S-04 e S-02.

---

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-S03-n`; o Orquestrador encaixa na lista contínua da sessão.

1. **[BLOQUEANTE para criar app e usuários de teste]** Autorização BLQ-EXEC (SD-14; BK-6 b) para S-03 em sandbox: criar a aplicação de teste e dois usuários de teste, sem credencial de produção e sem meio de pagamento real. A decisão 37 cobre a criação ou exige autorização explícita? **Recomendação:** autorizar só isso; BK-3 (a) pede confirmação de que sandbox no plano Hobby não é uso comercial.
2. **[BLOQUEANTE para CA-S03-06 a 08]** URL pública para o webhook: (a) esperar o S-09 (preview) ou (b) túnel temporário (NÃO VERIFICADO; exige autorização). **Recomendação:** (a). Sem URL, os critérios de webhook ficam NÃO VERIFICADO.
3. **[BLOQUEANTE para H-047]** A decisão do usuário é Bricks, mas H-047 e ADR-007 falam em "checkout hospedado". Bricks é componente embutido. **Recomendação:** o Architect troca o texto para "checkout Bricks (cartão e Pix), tokenização no navegador"; escopo PCI segue NÃO VERIFICADO.
4. **[BLOQUEANTE para desenho de H-048 e H-051]** "Aceita recorrência" com Pix: RF-058 e ADR-007 dizem Pix como cobrança manual por ciclo, e "Pix Automático" não foi encontrado. Opções: (a) recorrência só no cartão, Pix avulso por ciclo, sem mudar RF-058; (b) testar Pix em recorrência e, se aceito, nova decisão do usuário (muda RF-058). **Recomendação:** (a).
5. **[NÃO BLOQUEANTE para o spike; bloqueia H-054]** Tarifas: (a) o usuário consulta a tabela no painel ou no atendimento e informa, sem dados pessoais (**recomendado**); (b) pendência até o Gate M4. Não se tenta contornar o 403.
6. **[NÃO BLOQUEANTE]** Registrar em `11-DECISOES.md` com número sequencial: (i) checkout Bricks; (ii) "aba Assinaturas" (confirmar a leitura como API de planos e assinaturas); (iii) decisão 37 aplicada a S-03. Quem registra: Orquestrador.
7. **[NÃO BLOQUEANTE]** Fallback de 3 e 6 meses, se o Mercado Pago recusar (CA-S03-01): avulso por ciclo (ADR-007). **Recomendação:** tratar como fallback só com confirmação do usuário, pois muda a renovação para o cliente.
8. **[TÉCNICO, BLOQUEANTE para commit e push]** Esta sessão não tem ferramenta de shell. Não foi possível rodar `git add`, `git commit` nem `git push`. O arquivo foi criado e **não** foi commitado nem enviado. Pedido: commit com `Refs: #6` e os trailers indicados, feito em sessão com shell, após conferir este arquivo. Nada foi simulado.

---

## Resumo em linguagem simples

O teste com o Mercado Pago será feito só no ambiente de testes, com cartão e Pix de mentira, para ver se as assinaturas e os avisos de pagamento funcionam como esperado. Ninguém é cobrado, e valores de taxa só entram depois de conseguidos na fonte oficial.
