# FastPro — Escopo do MVP

- **Etapa:** conception · **Data:** 2026-11-09 · **Status:** rascunho para validação humana
- **Etiquetas:** `[APROVADO]` · `[DELEGADO]` · `[PROPOSTA]` · `[PENDENTE JURÍDICO]`
- Nenhuma RN nova é criada. O pacote não define uma fronteira "MVP" explícita: o que está descrito como escopo aprovado é tratado como núcleo; o recorte de lançamento é [PROPOSTA]. Itens que dependem de texto de RN ausente estão marcados.

## 1. Estratégia de entrega
- Web primeiro; mobile (React Native + Expo) depois. [APROVADO]
- Sequência sugerida de épicos: fundação → identidade → catálogo/geo → pedido → verificação → assinaturas → distribuição/ofertas → chat → seleção/conclusão → republicação → avaliações → notificações → admin → LGPD/observabilidade; mobile após estabilização do núcleo web. [PROPOSTA] (do relatório de ingestão E; a ser refinada pelo PO/Architect)

## 2. Entra no MVP (web)
### Cliente
- Navegação pública sem conta: categorias, site, perfis públicos. [APROVADO]
- Autocomplete de serviço e de endereço (Mapbox); endereço preciso privado. [APROVADO]
- Pedido: serviço, local, urgência (exatamente: Imediato, Nas próximas semanas, Próximo mês, Ainda não defini), descrição, fotos opcionais (até 5, 10 MB cada). [APROVADO]
- Identificação: primeiro nome e e-mail obrigatórios, telefone opcional; link mágico (15 min, uso único) com confirmação por ação na página e fallback por código de 6 dígitos; sessão até 7 dias. [APROVADO / DELEGADO D8]
- Revisão e confirmação expressa antes de publicar; validade de 7 dias. [APROVADO]
- Receber ofertas, "Receber mais ofertas" (2ª onda uma única vez, com 4 ofertas recebidas e pedido aberto). [APROVADO / DELEGADO D3]
- Chat por par cliente–profissional (texto, imagens, PDF; até 5 anexos de 10 MB; sem editar/excluir mensagens; arquivar). [APROVADO]
- Selecionar e trocar profissional; declarar conclusão; correção direta em até 24 h sem avaliação publicada; cancelar; republicar (uma ativa por cadeia). [APROVADO]
- Avaliar o selecionado (1–5, comentário opcional, publicação automática, edição em 7 dias); autor exibido como "Cliente do FastPro". [APROVADO / DELEGADO D4]
- Notificações por e-mail: nova oferta e nova mensagem (imediata na primeira, agrupada em 15 min nas seguintes), cancelamento/seleção, lembrete 24 h antes da expiração. [APROVADO / DELEGADO nos 15 min]

### Profissional
- Cadastro com e-mail/senha; Google/Apple "quando suportadas" (D9 pendente). [APROVADO]
- CPF/CNPJ e documentos; certificações para atividades regulamentadas conforme catálogo; aprovação humana. [APROVADO] (verificação de certificações: [PENDENTE JURÍDICO])
- Perfil público, serviços atendidos, base e raio em km (5–100). [APROVADO / DELEGADO]
- Teste gratuito de 14 dias e 4 planos via Mercado Pago, carência de 72 h. [APROVADO]
- Descobrir pedidos elegíveis, ver fotos (com mitigações D10), participar (até 8 por pedido), enviar oferta única editável, conversar. [APROVADO / DELEGADO D10]
- Responder publicamente e contestar avaliação. [APROVADO]
- Pós-expiração da assinatura: não descobre novos pedidos; mantém participações e pode ser selecionado onde já participou. [APROVADO]

### Admin (painel web separado)
- Papéis Superadmin, Verificação, Moderador, Financeiro, Suporte, Auditor; MFA; auditoria; segregação de funções. [APROVADO]
- Fila de verificação de profissionais (meta de 2 dias úteis). [APROVADO]
- Moderação por denúncia/contestação com decisão fundamentada e recurso. [DELEGADO D4]
- Financeiro: estornos ≤ R$200 por um Financeiro; > R$200 por dois aprovadores. [APROVADO] (depende da política de reembolso: [PENDENTE JURÍDICO])
- Gestão do catálogo e promoções futuras. [APROVADO]
- Telas e permissões detalhadas por papel: texto ausente, ver pendências.

### Transversais
- EDS/Design System aprovado (Roboto, tokens, claro/escuro, sem cores hardcoded). [APROVADO]
- LGPD, consentimento granular, acessibilidade (WCAG 2.2 AA só afirmado com evidência). [APROVADO]

## 3. Não entra no MVP / fora de escopo
- Aplicativos móveis (fase posterior ao núcleo web). [APROVADO]
- Mensagens de áudio no chat (versão futura). [APROVADO]
- Pagamento/escrow do serviço e comissão sobre o serviço. [APROVADO]
- Cobrança por lead, moedas, limites comerciais de mensagens. [APROVADO]
- Desconto inicial de lançamento. [APROVADO]
- Conversão automática do trial em assinatura paga. [APROVADO]
- Publicação automática de pedidos e reabertura silenciosa de ofertas. [APROVADO]
- Avaliação do cliente pelo profissional. [APROVADO]
- Segmentação de preço por cidade/categoria; teste A/B de preço. [APROVADO]
- Vigilância sobre conversas em WhatsApp externo. [APROVADO]
- Reembolso proporcional automatizado. [PENDENTE JURÍDICO]

## 4. Premissas e dependências do escopo
- Catálogo de serviços (10 grupos) é pré-requisito para busca e para certificações. Sem os nomes, não é possível popular. [bloqueia desenvolvimento]
- Jurídico (L1–L4, L7) é pré-requisito de lançamento com cobrança real. [PENDENTE JURÍDICO]
- Lojas Apple/Google só relevantes na fase mobile.

## 5. Recorte de lançamento (todo [PROPOSTA], para decisão)
Não altera preços, 4+4, 7 dias nem trial; atua só em GTM e operação.

### 5.1 Cold start
- **Lançamento concentrado:** abrir captação em poucas categorias e regiões metropolitanas antes de "Brasil todo", embora a abrangência nacional seja [APROVADA] como meta de produto. Isto limitaria só o foco de aquisição, não bloquearia pedidos de outras áreas. Decisão do usuário: quais categorias/regiões (depende da lista dos 10 grupos).
- **Oferta-semente:** recrutar profissionais antes de captar clientes e usar o teste de 14 dias (aprovado) como porta de entrada; aprovar em lotes compatíveis com a capacidade de verificação.
- **Gatilho de abertura da demanda:** só direcionar tráfego de clientes a uma categoria/região quando houver profissionais aprovados e ativos suficientes (limiar numérico: pendente).
- **Pedido sem cobertura:** definir a mensagem ao cliente quando não houver profissional elegível no raio (texto não definido; sem revelar contadores internos).

### 5.2 Desvio para WhatsApp
- Manter regra aprovada: telefone só por consentimento. Não propor barreiras de contato (não está aprovado).
- Reforçar valor retido: fluxo de novos pedidos, reputação (avaliações só pela plataforma), histórico. Medir taxa de pares que continuam no chat até a conclusão.
- Registrar que links externos já compartilhados são irrevogáveis e comunicar quando relevante. [APROVADO]

### 5.3 Churn
- Instrumentar desde o início: pedidos elegíveis por profissional por mês, ofertas enviadas, seleções, motivo de cancelamento.
- Alertas de inatividade e comunicação ao profissional (conteúdo a definir) antes do fim do trial e do ciclo.
- Planos longos já com menor valor mensal [APROVADO]; nenhuma alteração de preço proposta.

### 5.4 Operação
- Capacidade de verificação humana e de moderação dimensionada ao volume previsto do lançamento.
- Dados de teste apenas sintéticos. [APROVADO]

## Decisões pendentes
1. Nomes dos 10 grupos de categorias e serviços (D2).
2. Documentos mestres PRD/EDS/RN (D1) ou autorização para o PO propor texto.
3. Confirmar a fronteira do MVP: tudo o que está listado em §2 entra na primeira entrega web, ou há fatias? (Proposta de fatiamento fica para o PO/Backlog Architect.)
4. Aprovar ou rejeitar o recorte de lançamento por categoria/região (§5.1) e o limiar de oferta mínima.
5. Texto ao cliente quando não há profissional elegível no raio.
6. Login Google/Apple (D9), mesmo serviço × distinto (D6), casos extremos de cadeia (D7).
7. Política de reembolso e demais itens jurídicos (L1–L7).
8. Telas e permissões por papel admin; metas de triagem de risco elevado.
