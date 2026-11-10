# FastPro — Visão

- **Etapa:** conception · **Data:** 2026-11-09 · **Papel:** Product Strategist · **Status:** rascunho para validação humana
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação (revogável; ver `11-DECISOES.md`) · `[PROPOSTA]` sugestão deste documento, não é fato fornecido pelo usuário · `[PENDENTE JURÍDICO]`
- **Fontes:** `00-ENTREVISTA.md`, `10-RELATORIO-INGESTAO.md`, `11-DECISOES.md`, pacote 03/05/06 (resumos; os documentos mestres e as RN-001..675 em texto individual NÃO foram recebidos). Nenhuma RN nova é criada aqui.

## 1. Visão
Marketplace brasileiro de pedidos de serviço: clientes solicitam atendimento; profissionais verificados encontram pedidos compatíveis, enviam ofertas e conversam. [APROVADO]
Inspirado no GetNinjas, mas sem cobrança por lead/aceite. [APROVADO]

## 2. Proposta de valor
- **Profissional:** paga uma assinatura e acessa oportunidades compatíveis sem custo por lead, sem moedas, sem comissão e sem limite comercial de mensagens. [APROVADO]
- **Cliente:** navega sem conta, descreve o serviço e recebe ofertas de profissionais verificados e elegíveis pelo raio de atendimento. [APROVADO]
- **Diferencial:** o negócio monetiza o acesso profissional, não a compra isolada de leads nem o valor executado do serviço. [APROVADO]
- "Verificado" certifica processo de identidade, não competência, garantia ou seguro. [APROVADO]

## 3. Público
- **Contratantes:** qualquer pessoa que queira encontrar profissional de diversas áreas. [APROVADO]
- **Profissionais:** quem precisa ser contratado e assina para ter visibilidade. [APROVADO]
- **Abrangência:** Brasil todo; todas as categorias. Os 10 grandes grupos de categorias foram aprovados, mas seus nomes são desconhecidos (ver Decisões pendentes). [APROVADO]
- Serviços online compatíveis têm alcance nacional. [DELEGADO]
- **Admin:** equipe interna com papéis Superadmin, Verificação, Moderador, Financeiro, Suporte, Auditor; MFA obrigatório. [APROVADO]

## 4. Modelo de receita [APROVADO]
Assinatura recorrente do profissional; sem cobrança por lead/aceite, sem comissão, sem pagamento/escrow do serviço.

| Plano | Preço nacional |
|---|---:|
| Mensal | R$ 29,90 |
| Trimestral | R$ 80,70 |
| Semestral | R$ 149,40 |
| Anual | R$ 238,80 |

- Benefícios idênticos nos 4 planos; muda só o ciclo de cobrança e o preço. [APROVADO / D5 DELEGADO]
- Preço único nacional; sem desconto inicial de lançamento; promoções futuras administráveis. [APROVADO]
- Teste gratuito de 14 dias, após aprovação de identidade e ativação pelo próprio profissional; sem meio de pagamento; não converte automaticamente. [APROVADO]
- Mercado Pago como gateway; cartão com renovação automática só por adesão expressa; Pix/boleto, se oferecidos, em cobrança manual. [APROVADO]
- Falha em renovação paga: 72 h de carência; teste expirado: sem carência. [APROVADO]
- Reembolso proporcional com retenção de 50% foi apenas proposto: não validado, não automatizar. [PENDENTE JURÍDICO]

## 5. Princípios
1. Navegação pública sem conta do cliente; pedido pode ser preenchido antes de autenticar (nome e e-mail no envio final, link mágico). [APROVADO]
2. Profissional só participa após verificação de identidade e aprovação humana. [APROVADO]
3. Transparência dos estados sem expor contadores, vagas, ondas ou lógica interna de distribuição. [APROVADO]
4. Distribuição limitada: até 8 profissionais por pedido, em 2 ondas de 4 (4+4). [APROVADO]
5. Pedido recebe novas ofertas por 7 dias corridos. [APROVADO]
6. LGPD, menor privilégio, auditabilidade, acessibilidade e consentimento granular. [APROVADO]
7. Nenhuma alegação de conformidade jurídica, segurança ou WCAG sem evidência. [APROVADO]
8. Identidade visual conforme EDS aprovado (Roboto, tokens, claro/escuro); este documento não o altera. [APROVADO]

## 6. Estratégia de plataforma
- Web e mobile, **web primeiro**. [APROVADO]
- Stack aprovada: Next.js, React Native + Expo, NestJS, Supabase, Mapbox, Mercado Pago, pnpm + Turborepo; Admin web separado. [APROVADO]
- Busca: contratante informa serviço e endereço; sistema calcula se está dentro do raio definido por cada profissional. [APROVADO]
- Raio configurável de 5 a 100 km, a revisar com dados reais. [DELEGADO]

## 7. Riscos de negócio (sem alterar o modelo aprovado)
| # | Risco | Leitura | Mitigação (todas [PROPOSTA]) |
|---|---|---|---|
| R1 | Cold start: profissional paga antes de haver demanda; cliente não volta sem ofertas | Marketplace de dois lados com monetização só no lado profissional | Ver `02-ESCOPO-MVP.md` §5 (recorte de lançamento); o teste de 14 dias aprovado já reduz o risco do profissional |
| R2 | Desvio para WhatsApp: plataforma não intermedeia pagamento; após a primeira troca o par pode sair | Telefone só por consentimento explícito do cliente [APROVADO]; links externos estão fora do controle [APROVADO] | Reter pelo valor do acesso contínuo (fluxo constante de pedidos novos, reputação/avaliações dentro da plataforma), não por barreiras de contato |
| R3 | Churn do assinante: se um mês sem pedido compatível, cancela | Receita depende de recorrência | Medir pedidos elegíveis por profissional/mês; planos longos já existem com preço menor [APROVADO]; métricas a definir |
| R4 | Raspagem de fotos por elegíveis (inclusive em trial) | Fotos visíveis antes de ofertar são [APROVADO]; mitigações obrigatórias em D10 [DELEGADO] | Seguir D10 |
| R5 | Qualidade/fraude de perfis e avaliações | Verificação humana em 2 dias úteis como meta [APROVADO]; antifraude de avaliações [DELEGADO] | Capacidade de triagem do admin dimensionada ao volume de cadastro |
| R6 | Responsabilidade por conteúdo trocado fora/dentro do chat e por "verificado" | | [PENDENTE JURÍDICO] L7 |
| R7 | Gargalo operacional da aprovação humana no lançamento | Aprovação é obrigatória | Dimensionar equipe/prazo; meta de 2 dias úteis não é promessa |

## 8. Métricas de sucesso
Nenhuma meta numérica foi fornecida. [PROPOSTA] acompanhar: profissionais aprovados e ativados no trial; conversão trial→pago; pedidos publicados vs. pedidos com ≥1 oferta; tempo até primeira oferta; seleções e conclusões; churn mensal; avaliações publicadas. Valores-alvo: ver Decisões pendentes.

## Decisões pendentes
1. **Nomes dos 10 grupos de categorias e serviços** (D2) — sem eles não há catálogo nem recorte por categoria.
2. **Documentos mestres PRD/EDS/RN-001..408 e 641..675** (D1) — ou autorizar o PO a propor texto marcado como proposta.
3. **Contato cliente↔profissional: direto ou intermediado** (da entrevista). O pacote descreve chat dentro da plataforma e telefone/WhatsApp por consentimento; confirmar que isto responde à pergunta.
4. **Metas numéricas** (assinantes, conversão, churn) e orçamento de aquisição: não fornecidos.
5. Itens jurídicos L1–L4, L7 e reembolso (3 de `10-RELATORIO-INGESTAO.md`).
6. Pendentes de `11-DECISOES.md`: D6, D7, D9.
