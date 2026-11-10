# FastPro — Ambiguidades abertas

- **Data:** 2026-11-09 · **Papel:** Product Owner · **Status:** revisão 6 (AMB-32 resolvida pela decisão 33 C; nova AMB-33 aberta, documentos de identidade); AMB-21..29 e AMB-31 respondidas/extintas; AMB-30 respondida pela decisão 26 (aviso do sistema); abertas: [PENDENTE JURÍDICO]
- O PO **não decide mudanças de produto**. Cada item traz alternativas A/B/C e uma **recomendação [PROPOSTA]**; nenhuma está em vigor até decisão do usuário. Itens D3, D4, D5, D8, D10 já foram decididos [DELEGADO] e não constam aqui.
- Não alteram preços, 4+4, 7 dias, 14 dias de trial, EDS.
- Referências: RF (`04-PRD.md`), FA (`05-CRITERIOS-ACEITE.md`).

## Histórico de mudanças
### Revisão 6 — 2026-11-10 (decisão 33 C)
- **AMB-32 resolvida pela decisão 33 (C):** chat somente texto, sem nenhum anexo (nem imagem, nem PDF). Fotos extras e documentos entre cliente e profissional só pelo WhatsApp, se o cliente autorizar.
- **Nova: AMB-33** (formatos e limites dos documentos de identidade do profissional; A imagem / B imagem e PDF / C só PDF; rec. B). Decidida: decisão 34 B + decisão 35.
- **Impactos (QA/Architect):** Storage sem bucket de chat; sem antimalware/moderação de anexo de chat; matriz de visibilidade sem anexos; testes de API recusando arquivo no chat; upload de identidade pendente da AMB-33. Detalhe em `04-PRD.md` e `05-CRITERIOS-ACEITE.md` (Rev. 6).

### Revisão 5 — 2026-11-10 (Rodadas 13 e 14: decisões 30, 31, 32)
- **[AMB-32 resolvida na Rev. 6.]**
- **Aplicadas:** 5 fotos por pedido reduzidas no envio para ≈ 0,5 MB (máx. 1.280 px) (decisões 30, 31); fotos extras só pelo WhatsApp com autorização do contato, senão só as 5; chat sem imagens (decisão 32).
- **Nova: AMB-32** (PDF no chat após a decisão 32). Mantido como estava por suposição do líder, a confirmar.
- **Impactos (Architect/QA devem revisar):** Storage do chat (só PDF; imagem recusada por conteúdo); redução das fotos do pedido (≈ 0,5 MB, 1.280 px; capacidade ≈ 2,5 MB/pedido); EXIF somente nas fotos do pedido; moderação/antimalware do chat só para PDF. Detalhe em `04-PRD.md` e `05-CRITERIOS-ACEITE.md` (Rev. 5).

### Revisão 4 — 2026-11-09 (Rodada 12, decisão 27)
- **AMB-31 respondida:** todos os e-mails ficam **habilitados** no código (aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo, verificação, login). A recomendação A (todos desativados) foi **superada**. Sem interruptor, sem tela, sem reenvio de aceites antigos.
- **AMB-25 (extinta) e decisões 21/23:** a desativação "no código" deixa de valer; permanecem apenas "sem interruptor/tela" e "sem reenvio de antigos".
- **Dependência:** envio real exige domínio verificado no Resend (decisão 15); em desenvolvimento, Mailpit. Cota gratuita (100/dia UTC, 3.000/mês, por destinatário) vira requisito não funcional com degradação (PRD §6.1).
- **AMB-30:** atribuição definida pela decisão 26 (aviso do sistema, remetente nulo); mantida aqui apenas como registro.
- **Impactos (QA/Architect devem checar):** ver Impactos de `04-PRD.md` e `05-CRITERIOS-ACEITE.md` (Rev. 4): testes positivos por tipo de e-mail, ausência de flag/código comentado, não retroatividade, simulação de cota com login prioritário e chat/site intactos, nenhum envio real sem domínio.

### Revisão 3 — 2026-11-09 (Rodadas 6 a 9 de `11-DECISOES.md`)
- **Respondidas:** AMB-21 = A (decisão 1); AMB-22 = A (decisão 2); AMB-23 = B (decisão 3) + decisão 19: quem retirou não aceita de novo; AMB-24 = A (decisão 4); AMB-26 respondida (decisão 10: cliente vê os aceites ao abrir o site; aviso na tela após publicar; sem opção de e-mail por pedido); AMB-27 = A (decisão 20); AMB-28 respondida (decisão 22: aviso "FastPro apenas conecta; não é contrato" somente nos termos de uso, fora do botão; sem diálogo de compromisso; redação jurídica em L2/L7); AMB-29 = A "Chamar mais profissionais" (decisão 7).
- **Extinta:** AMB-25 (quais e-mails ficam sob flag): decisão 23 elimina o interruptor; e-mail de aviso de aceite e de mensagem não lida fica implementado porém desativado no código (comentado, ponto único de ativação), sem tela, sem reenvio de aceites antigos; link mágico e e-mails de conta sempre ativos. Os demais e-mails (lembretes, seleção, cancelamento) passam à AMB-31.
- **Efeitos colaterais de decisões:** decisão 14 define o texto fixo da mensagem automática ("Estou disponível para trabalhar"); decisão 17 fecha SD-16 (novo período no fim do anterior, inclusive carência Pix); AMB-16 e AMB-19 seguem a Rodada 3 (A); AMB-27 e AMB-23 harmonizadas.
- **AMB-01..AMB-20:** permanecem como adotadas por delegação na Rodada 3 (recomendação de cada item), exceto os itens [PENDENTE JURÍDICO] (AMB-06 lembrete de cobrança, AMB-14) e AMB-10 (extinta). AMB-03, 04, 05, 07, 09, 11, 12, 13, 15..20: ver Rodada 3; nenhuma alteração nesta revisão.
- **Novas:** AMB-30 (atribuição da mensagem automática na tela do chat) e AMB-31 (e-mails de lembrete, seleção e cancelamento antes do lançamento).

### Revisão 2 — 2026-11-09 (H4 e H5)
- **AMB-10 EXTINTA** (conteúdo mínimo da oferta): a oferta deixou de existir (H4 [APROVADO]). A decisão [DELEGADO] AMB-10=A da Rodada 3 perde o objeto.
- **AMB-04, AMB-15, AMB-16, AMB-19** ajustadas apenas de vocabulário (oferta/participação → aceite). Alternativas e recomendações inalteradas.
- **Novas, sem decisão (aguardam o usuário):** AMB-21 (aceitar ocupa vaga e cria chat), AMB-22 (cliente ainda seleciona?), AMB-23 (desistir do aceite), AMB-24 (negociação de preço só no chat), AMB-25 (quais e-mails ficam sob flag/cota), AMB-26 (cliente sem acesso à plataforma com e-mail desligado), AMB-27 (o que conta como "4 aceites"), AMB-28 (semântica do aceite como compromisso), AMB-29 (rótulo do botão da 2ª onda).
- **SD-08** (janela de edição da oferta, do Architect) fica extinta; **SD-10** (carência para Pix) respondida por H5 [APROVADO]: carência de 72 h vale também para Pix, sem boleto.
- Nenhuma das alternativas abaixo está em vigor sem decisão do usuário, inclusive as recomendações das AMB-21..29.

## Resumo
| ID | Tema | Origem | Impacto | Bloqueia |
|---|---|---|---|---|
| AMB-01 | Mesmo serviço × distinto (D6) | Pacote D6 | Republicação, duplicatas | Refinamento FA-022 |
| AMB-02 | Cadeia "ativa" em casos extremos (D7) | Pacote D7 | Republicação, suspensão | FA-022/023 |
| AMB-03 | Sem profissional elegível no raio | Jornada J1 | Experiência do cliente, retenção | Texto e fluxo |
| AMB-04 | Profissional elegível sem vaga | Jornada J2 | Experiência do profissional | Texto e fluxo |
| AMB-05 | Login Google/Apple (D9) | Pacote D9 | Cadastro profissional | Cadastro |
| AMB-06 | Lembretes de fim de trial/ciclo | Jornada J2 | Churn, receita | Conteúdo e canal |
| AMB-07 | Contato direto × intermediado | Entrevista | Produto | Confirmar |
| AMB-08 | Telas e permissões por papel admin | D1 | Admin | Admin |
| AMB-09 | Reativação do trial (segundo trial) | Novo | Abuso, receita | FA-005 |
| AMB-10 | ~~Conteúdo mínimo da oferta~~ **EXTINTA (H4)** | Novo | — | — |
| AMB-11 | Limite exato das 24 h (inclusivo/exclusivo) | Novo | Conclusão | FA-018 |
| AMB-12 | Avaliação reprovada no filtro automático | D4 derivada | Avaliações | FA-019 |
| AMB-13 | Sessão/links em dispositivo compartilhado | Risco | Segurança | Arquitetura |
| AMB-14 | Retenção e "avaliação sem prazo" | L1 | LGPD | FA-020 |
| AMB-15 | Profissional deixa de ser elegível durante o pedido | Novo | Distribuição | RF-065 |
| AMB-16 | Vaga de profissional que desiste ou é suspenso | Novo | Distribuição | RF-066 |
| AMB-17 | Alcance do opt-in de telefone (granularidade) | Rodada 2 | Privacidade | RF-017 |
| AMB-18 | Quem pode ser "online" e alcance nacional | D (delegado) | Catálogo | RF-004 |
| AMB-19 | Ordem/critério de quem ocupa as vagas | Pacote | Distribuição | RF-066 |
| AMB-20 | Fronteira do MVP e recorte de lançamento | Escopo §5 | GTM | Planejamento |
| AMB-21 | Aceitar já ocupa a vaga e cria o chat? | H4 | **RESPONDIDA: A (decisão 1)** | RF-075 |
| AMB-22 | Cliente ainda escolhe (seleciona) entre quem aceitou? | H4 | **RESPONDIDA: A (decisão 2)** | RF-080 |
| AMB-23 | Profissional pode desistir do aceite? | H4 | **RESPONDIDA: B (decisão 3) + sem novo aceite (decisão 19)** | RF-077, RF-087 |
| AMB-24 | Negociação de preço só no chat? | H4 | **RESPONDIDA: A (decisão 4)** | RF-070 |
| AMB-25 | ~~Quais e-mails ficam sob flag/cota gratuita~~ | H4 | **EXTINTA (decisão 23: sem flag)** | RF-122 |
| AMB-26 | Cliente retorna à plataforma sem e-mail de aviso | H4 | **RESPONDIDA (decisão 10)** | RF-115 |
| AMB-27 | O que conta como "4 aceites" para a 2ª onda | H4 | **RESPONDIDA: A (decisão 20)** | RF-067 |
| AMB-28 | "Aceitar trabalho" é compromisso? | H4 | **RESPONDIDA (decisão 22: aviso só nos termos de uso)** | RF-078 |
| AMB-29 | Rótulo do botão da 2ª onda | H4 | **RESPONDIDA: A (decisão 7)** | RF-076 |
| AMB-30 | Atribuição da mensagem automática do aceite na tela do chat | Decisão 14 | **RESPONDIDA (decisão 26 A: aviso do sistema)** | RF-075 |
| AMB-31 | E-mails de lembrete, seleção e cancelamento antes do lançamento | Decisões 21/23 | **RESPONDIDA (decisão 27: todos ativos)** | RF-064, 118, 119 |
| AMB-32 | PDF no chat após retirar imagens | Decisão 32 | **RESOLVIDA pela decisão 33 (C): chat só texto, sem anexos** | RF-101, 102 |
| AMB-33 | Documentos de verificação de identidade do profissional: formatos e limites | Decisão 33 (efeito colateral) | **RESPONDIDA (decisão 34 B; limites decisão 35: imagem reduzida, PDF ≤ 2 MB)** | RF-046, 052; FA-004 |

---

## AMB-01 Mesmo serviço × serviço distinto (D6)
**Contexto:** a regra "uma republicação ativa por cadeia" e a proibição de "restringir serviços realmente distintos" exigem critério. Origem: D6.
- **A. Heurística automática:** mesmo serviço do catálogo + mesmo endereço (ou a menos de X m) + pedido ativo = possível duplicata; o sistema **avisa e deixa o cliente confirmar** que é distinto. Nunca bloqueia.
- **B. Bloqueio rígido:** mesma combinação serviço+endereço impede novo pedido enquanto houver um ativo.
- **C. Sem heurística:** apenas a cadeia explícita (republicação) é controlada; pedidos novos nunca são comparados.
**Recomendação [PROPOSTA]:** A. Respeita "não restringir serviços distintos" e reduz duplicidade involuntária. B contradiz o princípio aprovado. Parâmetros (distância, janela) ficam com o Architect.
**Afeta:** RF-092, FA-022.

## AMB-02 Cadeia ativa em casos extremos (D7)
**Contexto:** definir "ativa" quando há suspensão do profissional, contestação, correção retroativa de conclusão ou cancelamento tardio.
- **A. Ativa = qualquer pedido da cadeia em `publicado` ou `selecionado` (não concluído/cancelado)**; suspensão do selecionado não altera; correção de conclusão que volta a `selecionado` torna a cadeia ativa de novo e **bloqueia** nova republicação, com aviso.
- **B. Ativa = apenas pedidos que ainda admitem ofertas**; seleção não conta.
- **C. Decisão caso a caso por Suporte** em suspensão/contestação; regra A nos demais.
**Recomendação [PROPOSTA]:** A com exceção explícita: se o selecionado for suspenso por segurança, o cliente pode cancelar e republicar (equivale a desistência sem substituto, FA-024). Regra B contradiz a matriz do doc 05 §4 (republicação selecionada conta como ativa), então não é compatível.
**Afeta:** RF-091, RF-094, FA-022, FA-023.

## AMB-03 Sem profissional elegível no raio
**Contexto:** texto e comportamento não definidos. Não revelar contadores internos.
- **A. Publicar normalmente e informar** "Ainda não há profissionais disponíveis para este pedido. Avisaremos por e-mail se alguém participar." Sem prometer.
- **B. Avisar antes de publicar** (na revisão) que a cobertura é baixa na região, permitindo ajustar local/serviço ou publicar assim mesmo.
- **C. Fila de interesse:** cliente pode deixar o pedido em "aguardando cobertura" (prazo de 7 dias segue valendo).
**Recomendação [PROPOSTA]:** A + B combinadas, sem número de profissionais; avisar na revisão e depois no estado do pedido. Não implica mudar os 7 dias. B exige medir cobertura sem expor contagem: Architect avalia.
**Afeta:** RF-020; Escopo §5.1 (gatilho de abertura da demanda).

## AMB-04 Profissional elegível sem vaga
**Contexto:** mensagem não definida e sem contadores.
- **A. Mensagem neutra:** "Este pedido não está recebendo novos participantes no momento."
- **B. Ocultar o pedido** da descoberta para quem não pode participar.
- **C. Mostrar e permitir "seguir"/receber aviso** se uma 2ª onda for liberada.
**Recomendação [PROPOSTA]:** A. B impede que o profissional entenda por que um pedido sumiu e pode ser lido como falha; C cria expectativa e exige nova regra de notificação. Se C for desejado, é decisão de produto.
**Afeta:** RF-071, FA-010. *(Rev. 2: "participar" lido como "aceitar o trabalho"; sugestão de texto: "Este pedido não está recebendo novos profissionais no momento.")*

## AMB-05 Login Google/Apple (D9)
**Contexto:** "quando suportadas"; regras da App Store podem exigir "Entrar com Apple" se Google for oferecido em iOS. [NÃO VERIFICADO]
- **A. Lançar web só com e-mail/senha**, adicionar sociais na fase mobile após verificar as regras vigentes.
- **B. Oferecer Google e Apple juntos** desde o web.
- **C. Só Google no web; Apple apenas se mobile iOS exigir.**
**Recomendação [PROPOSTA]:** A para o MVP web (menor risco, menos superfície de identidade a verificar com documento); decisão final após o Architect confirmar as regras das lojas.
**Afeta:** RF-045.

## AMB-06 Lembretes de fim de trial e de ciclo
**Contexto:** só e-mail está aprovado; conteúdo, antecedência e frequência não definidos. Risco de churn (R3).
- **A. Mínimo:** um e-mail 3 dias antes e um no vencimento (trial e ciclo pago).
- **B. Cadência maior:** 7, 3 e 1 dia antes, e no vencimento.
- **C. Sem lembrete;** somente aviso na interface ao entrar.
**Recomendação [PROPOSTA]:** A, com aviso na interface; o texto não pode induzir a cobrança automática no trial (RF-057) nem prometer pedidos. Para ciclo pago com renovação automática, lembrete informativo de cobrança futura é recomendável por transparência (confirmar exigência jurídica, [PENDENTE JURÍDICO] L2/L3).
**Afeta:** RF-064, FA-005.

## AMB-07 Contato direto × intermediado
**Contexto:** pergunta aberta na entrevista. Já decidido: chat na plataforma e telefone/WhatsApp só por opt-in.
- **A. Confirmar** que chat + opt-in respondem à pergunta (híbrido: intermediado no chat; direto apenas por consentimento).
- **B. Somente intermediado** (retirar o opt-in de telefone).
- **C. Direto liberado após a seleção.**
**Recomendação [PROPOSTA]:** A, já coerente com a decisão da Rodada 2. B e C contradizem decisões aprovadas.
**Afeta:** RF-016, RF-138.

## AMB-08 Telas e permissões por papel admin
**Contexto:** matriz original ausente (D1).
- **A. Aprovar uma matriz mínima proposta pelo PO** (ex.: Verificação: fila de verificação; Moderador: denúncias/contestações; Financeiro: cobranças e estornos; Suporte: casos e correção de conclusão; Auditor: leitura de trilha; Superadmin: gestão de papéis, catálogo, promoções, com MFA e dupla aprovação para ações críticas).
- **B. Aguardar recuperar a original.**
- **C. Começar pelos papéis Verificação e Superadmin** e detalhar os demais depois.
**Recomendação [PROPOSTA]:** A como base de trabalho, revogável se a original for encontrada; a matriz detalhada fica como artefato do Architect/PO em refinamento próprio.
**Afeta:** RF-146, FA-031.

## AMB-09 Segundo trial
**Contexto:** não está dito se o profissional pode repetir o trial (nova conta, cancelamento e retorno).
- **A. Um trial por identidade verificada** (CPF/CNPJ).
- **B. Um trial por conta,** sem checagem de identidade.
- **C. Permitir novo trial por política administrável** (ex.: após X meses).
**Recomendação [PROPOSTA]:** A, alinhado à verificação de identidade já aprovada e à retenção de duplicidade (RF-049). C é opção futura.
**Afeta:** RF-057, FA-005.

## AMB-10 ~~Conteúdo mínimo da oferta~~ — EXTINTA (H4)
**Motivo:** a oferta/proposta deixou de existir por decisão do usuário (H4 [APROVADO]): o profissional apenas clica em "Aceitar trabalho". Não há conteúdo, valor, prazo nem anexo no aceite. A recomendação anterior (A) e a decisão [DELEGADO] da Rodada 3 ficam sem objeto. A necessidade de comparar preços reaparece em AMB-24.
**Afeta:** nada (histórico).

## AMB-11 Limite exato das 24 h
**Contexto:** "até 24 horas" para correção direta.
- **A. Inclusivo:** permitido até o instante T+24:00:00 inclusive.
- **B. Exclusivo:** só antes de T+24 h.
- **C. 24 h a partir da conclusão em fuso fixo (BRT).**
**Recomendação [PROPOSTA]:** A, medindo em instantes absolutos (não por data de calendário), exibindo o horário limite ao cliente. É questão de teste/QA, sem efeito material de negócio.
**Afeta:** FA-018.

## AMB-12 Avaliação reprovada no filtro automático
**Contexto (D4):** publicação é automática após antifraude e filtro de conteúdo. O que acontece quando o filtro retém?
- **A. Retém e envia para revisão humana,** informando o cliente que será analisada (cria exceção à moderação "apenas por denúncia").
- **B. Rejeita com mensagem** pedindo ajuste do comentário (nota fica preservada).
- **C. Publica só a nota, sem o comentário,** e informa o cliente.
**Recomendação [PROPOSTA]:** B para conteúdo ofensivo evidente (permite correção sem fila humana) e A somente para suspeita de fraude, desde que o usuário aceite essa exceção a D4. Se não aceitar, usar B ou C. Decisão de produto, pois altera D4.
**Afeta:** RF-126, FA-019.

## AMB-13 Dispositivo compartilhado e sessão de 7 dias
**Contexto:** sessão de 7 dias sem senha; risco em computadores compartilhados.
- **A. Manter 7 dias** com opção "sair" visível e revogação por novo link.
- **B. Sessão curta (24 h)** para dados sensíveis (ex.: telefone).
- **C. Reautenticação por link/código** para ações críticas (cancelar, concluir, compartilhar telefone).
**Recomendação [PROPOSTA]:** A + C. Preserva a decisão de 7 dias [DELEGADO] e protege ações críticas. Exige atenção do Architect.
**Afeta:** RF-038.

## AMB-14 Retenção e avaliação "sem prazo comercial"
**Contexto:** a avaliação não tem prazo comercial, mas retenção é [PENDENTE JURÍDICO] (L1).
- **A. Aguardar jurídico** e marcar FA-020 como condicionado.
- **B. Adotar prazo de retenção provisório proposto (ex.: 5 anos)** sujeito a validação.
- **C. Sem prazo** (não recomendado).
**Recomendação [PROPOSTA]:** A. A fábrica não deve inventar prazo legal. B só como placeholder de configuração, jamais afirmado como compatível com a lei.
**Afeta:** RF-127, RF-140, FA-020.

## AMB-15 Profissional deixa de ser elegível durante o pedido
**Contexto:** assinatura vence, verificação é revogada, raio muda após participar.
- **A. Mantém a participação** e a conversa; só perde novas participações. Se a verificação for revogada ou perfil suspenso, perde a elegibilidade para seleção (já previsto).
- **B. Revoga a participação** em qualquer mudança de elegibilidade.
**Recomendação [PROPOSTA]:** A, coerente com RF-062/FA-025. Para mudança de raio: aplicar só a novos pedidos (a participação anterior permanece).
**Afeta:** RF-062, RF-065. *(Rev. 2: "participação" = aceite de trabalho.)*

## AMB-16 Vaga de quem desiste ou é suspenso
**Contexto:** a desistência "não reabre vagas" (aprovado). Não está dito o caso de um participante suspenso ou banido antes da seleção.
- **A. A vaga permanece consumida** (consistente com "não reabrir vagas").
- **B. Vaga é liberada** se o participante for removido por segurança.
**Recomendação [PROPOSTA]:** A, mais simples e coerente com a regra aprovada; B poderia ser usado para contornar o teto de 8 e precisaria de decisão explícita.
**Afeta:** RF-066, RF-087. *(Rev. 2: interage com AMB-23, desistência do aceite antes da seleção, e AMB-27, contagem para a 2ª onda.)*

## AMB-17 Granularidade do opt-in de telefone
**Contexto:** a Rodada 2 define opt-in no pedido (desmarcado). Falta definir a granularidade.
- **A. Único para todos os participantes** do pedido (liberar ou não).
- **B. Por profissional,** o cliente libera individualmente no chat.
- **C. A + B:** opt-in geral no pedido e revogação/liberação individual depois.
**Recomendação [PROPOSTA]:** C: o opt-in do pedido vale para participantes; o cliente pode revogar para o futuro, e pode também autorizar individualmente quando não marcou. Isto está alinhado ao doc 06 §1 (consentimento por pedido ou individual).
**Afeta:** RF-016, RF-017, RF-138; FA-030.

## AMB-18 Serviços online e alcance nacional
**Contexto:** online tem alcance nacional [DELEGADO]; quem é elegível não foi detalhado.
- **A. Qualquer profissional aprovado que declarou o serviço como online** vê o pedido, qualquer UF.
- **B. Preferência regional** (mesma UF/região primeiro).
- **C. Restrição por tipo de serviço** (ex.: jurídico, saúde exigem registro na UF).
**Recomendação [PROPOSTA]:** A como regra geral; C como exceção para categorias REG (a lista depende de jurídico L4).
**Afeta:** RF-004, catálogo.

## AMB-19 Quem ocupa as vagas
**Contexto:** "primeiros direitos de participação" é a regra de 1ª onda; ordem de chegada ou critério de ranking não explicitado. (Rev. 2: sem oferta, "ocupar a vaga" = clicar primeiro em "Aceitar trabalho".)
- **A. Ordem de chegada** (quem participa primeiro).
- **B. Distribuição por ranking** (avaliação, proximidade).
- **C. Rodízio/sorteio entre elegíveis.**
**Recomendação [PROPOSTA]:** A, a única que está implícita ("obter legitimamente um lugar") e transparente. B/C mudam o produto. Sublinhar que a plataforma não deve prometer prioridade comercial.
**Afeta:** RF-066.

## AMB-20 Fronteira do MVP e recorte de lançamento
**Contexto:** `02-ESCOPO-MVP.md` §5 (recorte GTM [PROPOSTA]).
- **A. Tudo de §2 entra na primeira entrega web.**
- **B. Fatiar** em ondas (núcleo cliente+oferta+chat; depois assinatura; depois avaliações/admin avançado).
- **C. Lançar com poucas categorias/regiões** (GTM) e abrir depois.
**Recomendação [PROPOSTA]:** B para desenvolvimento e C para GTM, ambos sem mudar os preços, 4+4, 7 dias ou 14 dias. A cobrança real depende de jurídico (L1–L4, L7).
**Afeta:** Backlog, GTM. *(Rev. 2: a fatia "núcleo cliente+oferta+chat" passa a ser "núcleo cliente+aceite+chat".)*

---

## AMB-21 Aceitar já ocupa a vaga e cria o chat? (H4)
**STATUS: RESPONDIDA, A [APROVADO] (decisão 1).** Texto abaixo é histórico.
**Contexto:** antes havia participação (vaga) e depois oferta. Agora só existe o aceite. A hipótese de base do PRD (RF-075) é que o aceite faz tudo no mesmo ato; isso precisa de confirmação.
- **A. Sim:** aceitar = ocupar vaga + criar conversa + mensagem automática ao cliente + profissional passa a ver o primeiro nome do cliente.
- **B. Em duas etapas:** "Ver/Participar" ocupa a vaga e só "Aceitar trabalho" cria o chat (recria a distinção que H4 eliminou).
- **C. O aceite ocupa a vaga, mas o chat só é liberado quando o cliente responde ou abre a conversa.**
**Recomendação [PROPOSTA]:** A. É a leitura direta de H4 (clique → mensagem no chat) e a mais simples. Atenção: o profissional passa a ver o primeiro nome do cliente (e telefone, se houver opt-in) ao clicar, sem nenhum filtro do cliente; o risco de aceites impulsivos é tratado em AMB-28.
**Afeta:** RF-066, RF-075, RF-100, RF-110, FA-011, FA-009.

## AMB-22 O cliente ainda escolhe (seleciona) entre quem aceitou? (H4)
**STATUS: RESPONDIDA, A [APROVADO] (decisão 2).** Texto abaixo é histórico.
**Contexto:** a seleção única por pedido (RF-080..084, FA-013..015) assumia ofertas a comparar. Sem oferta, o cliente conversa com os que aceitaram.
- **A. Mantém a seleção** como passo distinto: o cliente conversa com todos e seleciona um (encerra novos aceites, define conclusão e avaliação).
- **B. O primeiro aceite já é a seleção** (primeiro a aceitar fica com o trabalho; fim da 2ª onda e das 8 vagas).
- **C. Seleção implícita:** a seleção ocorre quando o cliente confirma "contratar" dentro do chat do profissional; sem tela de seleção separada.
**Recomendação [PROPOSTA]:** A. Preserva decisões aprovadas (teto 8, 4+4, seleção única, conclusão, avaliação do selecionado, troca de selecionado). B elimina a razão de ser da 2ª onda e do 4+4 e muda o produto; C é variação de UI de A e pode ser avaliada no refinamento de telas. Decisão do usuário.
**Afeta:** RF-080..084, RF-125, FA-013..015, FA-017, FA-019.

## AMB-23 O profissional pode desistir do aceite? (H4)
**STATUS: RESPONDIDA, B [APROVADO] (decisão 3); decisão 19 acrescenta: quem retirou não pode aceitar de novo o mesmo pedido.** Texto abaixo é histórico.
**Contexto:** não há "retirar oferta". Se o profissional se arrepende antes da seleção, o que acontece? (RF-087 cobre desistência apenas **após** a seleção.)
- **A. Não pode desistir do aceite;** pode apenas deixar de responder/avisar no chat. A vaga fica consumida.
- **B. Pode retirar o aceite** (vaga permanece consumida, conversa passa a somente leitura, cliente é avisado no chat).
- **C. Pode retirar o aceite e a vaga é liberada** (risco: contornar o teto de 8; contradiz AMB-16 A).
**Recomendação [PROPOSTA]:** B. Evita prender o profissional a um compromisso (AMB-28) e mantém a regra "não reabre vagas". C não é recomendado.
**Afeta:** RF-070, RF-087, RF-066, AMB-16, AMB-27.

## AMB-24 Negociação de preço só no chat? (H4)
**STATUS: RESPONDIDA, A [APROVADO] (decisão 4): preço e contratação direto entre as partes, no chat ou WhatsApp; FastPro apenas conecta.** Texto abaixo é histórico.
**Contexto:** sem oferta, o cliente não vê valor estruturado para comparar. RF-070 estabelece que preço/prazo/condições são combinados no chat.
- **A. Somente no chat** (texto livre) e, por opt-in, telefone/WhatsApp. Sem campo de valor em lugar algum.
- **B. Perfil do profissional mostra faixa de preço ou "a partir de"** (informativo, não vinculante).
- **C. O chat oferece modelo de "orçamento" opcional** (estrutura de valor/prazo dentro da mensagem), que é mensagem comum, sem edição.
**Recomendação [PROPOSTA]:** A para o MVP, coerente com H4 e com a ausência de intermediação de pagamento. B e C reintroduzem o conceito de proposta por outro caminho e exigem decisão explícita do usuário.
**Afeta:** RF-070, RF-005, FA-011; efeito em conversão.

## AMB-25 Quais e-mails ficam sob feature flag / cota gratuita? (H4)
**STATUS: EXTINTA (decisão 23).** Não há flag nem interruptor. E-mail de aviso de aceite e de mensagem não lida: implementado e desativado no código (ponto único de ativação). Os demais e-mails de notificação passam à AMB-31. Texto abaixo é histórico.
**Contexto:** H4 desliga apenas o e-mail de aviso de aceite. Há outros e-mails: mensagem não lida (RF-116), lembrete 24 h e aviso de expiração (RF-119), lembretes de trial/ciclo (RF-064), notificações de seleção/cancelamento (RF-118). O link mágico e o código (autenticação) são essenciais e não entram.
- **A. Somente o e-mail de aceite fica desligado;** os demais seguem aprovados e consomem cota.
- **B. Cada tipo de e-mail tem a sua flag;** inicialmente desligados os de aceite e de mensagem não lida; ligados os demais.
- **C. Todos os e-mails de notificação (exceto autenticação) desligados** até haver provedor/cota definidos (SD-03).
**Recomendação [PROPOSTA]:** B: uma flag por tipo, com o estado inicial a confirmar pelo usuário. Reduz risco de estourar o plano gratuito sem remover canais aprovados. Aceites ocorridos com a flag desligada não geram e-mail retroativo ao ligar (a confirmar).
**Afeta:** RF-064, 116, 118, 119, 122; FA-012, FA-029.

## AMB-26 Cliente sem e-mail de aviso: como volta à plataforma? (H4)
**STATUS: RESPONDIDA (decisão 10):** o cliente só vê os aceites abrindo o site; aviso na tela logo após publicar o pedido; e-mails preparados mas desativados. Sem opção de ligar e-mail por pedido. Texto abaixo é histórico.
**Contexto:** com o e-mail de aceite desligado, o cliente só vê a mensagem no chat se estiver com sessão ativa ou voltar por conta própria. A sessão dura 7 dias e voltar exige link mágico.
- **A. Aceitar a limitação no início:** o cliente volta por iniciativa; a tela do pedido mostra o chat com indicador de não lida.
- **B. Ligar a flag de e-mail apenas para o primeiro aceite de cada pedido** (menor consumo de cota).
- **C. Mostrar aviso após publicar:** "Você será avisado aqui no FastPro; volte para ver as respostas" e opção de ligar o e-mail por pedido.
**Recomendação [PROPOSTA]:** C + A no lançamento restrito, com B como primeiro degrau de upgrade quando houver cota. O risco é o cliente não perceber respostas dentro dos 7 dias; medir (Architect/QA).
**Afeta:** RF-115, RF-122, RF-073; FA-029.

## AMB-27 O que conta como "4 aceites" para liberar a 2ª onda? (H4)
**STATUS: RESPONDIDA, A [APROVADO] (decisão 20): vagas consumidas, inclusive de quem retirou.** Texto abaixo é histórico.
**Contexto:** D3 usava "4 ofertas recebidas". Com AMB-23 B, um aceite pode ser retirado, e com AMB-16 A a vaga permanece consumida.
- **A. Contam as vagas consumidas** (4 aceites já feitos, ativos ou retirados): o botão aparece quando a 1ª onda está cheia.
- **B. Contam apenas aceites ativos** (se um retirar, o botão pode sumir).
- **C. Aparece com ao menos 1 aceite** (não depender de 4).
**Recomendação [PROPOSTA]:** A, consistente com "vaga não reabre" e com o teto 4+4 (1ª onda cheia = 4 aceites). B cria flutuação e confusão; C muda D3 e não é recomendado.
**Afeta:** RF-067, FA-010.

## AMB-28 "Aceitar trabalho" cria compromisso? (H4)
**STATUS: RESPONDIDA (decisão 22, opção C do usuário):** o aviso "FastPro apenas conecta; não é contrato" aparece somente nos termos de uso, não no botão nem em diálogo de confirmação. Redação jurídica pendente (L2, L7). Texto abaixo é histórico.
**Contexto:** o rótulo "Aceitar trabalho" pode ser lido pelo cliente como acordo fechado (preço, prazo, comparecimento), e pelo profissional como obrigação. Os Termos (L2/L7) ainda não existem.
- **A. Deixar claro na interface e nos Termos** que aceitar significa "tenho interesse e disponibilidade para conversar", sem preço nem contrato; a contratação ocorre ao combinar no chat e quando o cliente selecionar.
- **B. Mudar o rótulo** (ex.: "Tenho interesse"), mantendo a mesma ação. É mudança de nome decidida pelo usuário, não pelo PO (H4 define "Aceitar trabalho").
- **C. Confirmação em duas etapas** antes de aceitar (diálogo com texto de compromisso).
**Recomendação [PROPOSTA]:** A + texto curto de confirmação antes de concluir o aceite (versão leve de C), sem mudar o rótulo aprovado. A redação jurídica depende de L2/L7.
**Afeta:** RF-070, RF-075, textos; [PENDENTE JURÍDICO] L2, L7.

## AMB-29 Rótulo do botão da 2ª onda ao cliente (substitui "Receber mais ofertas")
**STATUS: RESPONDIDA, A [APROVADO] (decisão 7): "Chamar mais profissionais".** Texto abaixo é histórico.
**Contexto:** sem números, vagas ou ondas (RF-018, RF-066). O PRD usa um rótulo [PROPOSTA] em RF-076.
- **A. "Chamar mais profissionais"** (proposta do PO).
- **B. "Receber mais profissionais".**
- **C. "Ver mais opções"** (mais neutro, porém menos claro sobre o que acontece).
**Recomendação [PROPOSTA]:** A. Verbo direto, deixa claro que dispara uma ação e não revela quantidades. Texto de apoio opcional: "Convidamos outros profissionais compatíveis a aceitar o seu pedido." (sem números). Decisão de redação do usuário.
**Afeta:** RF-076, FA-010.

---

## AMB-30 Como a mensagem automática do aceite aparece na tela do chat? (decisão 14)
**Contexto:** a decisão 14 fixa o texto "Estou disponível para trabalhar". Falta definir a atribuição visual e de dados: remetente do sistema ou do profissional. Impacta honestidade da interface, auditoria, denúncia/bloqueio, notificação e a regra de RF-103 (não editável).
- **A. Mensagem de sistema com remetente nulo,** exibida como evento: "Fulano aceitou o trabalho: Estou disponível para trabalhar". Não é contada como mensagem humana (não dispara e-mail de não lida nem marca resposta).
- **B. Exibida como se fosse do profissional** (balão do profissional com o texto fixo), com remetente = profissional no dado.
- **C. Híbrida:** dado com tipo "sistema" mas atribuído ao profissional (autor = profissional, marcador "mensagem automática" discreto no balão).
**Recomendação [PROPOSTA]:** A. É transparente (o profissional não escreveu), evita confundir o cliente e impede que a mensagem seja tratada como conversa humana em denúncia, moderação, leitura e e-mail de não lida; o texto exato da decisão 14 é preservado na frase. B é a leitura mais literal de "envia ao cliente a mensagem", mas atribui ao profissional um texto que ele não digitou. C é um meio-termo se o usuário quiser o balão do profissional.
**Afeta:** RF-075, RF-103, RF-115, RF-116, FA-011, FA-029; modelo de mensagem (Architect).

## AMB-31 E-mails de lembrete, seleção e cancelamento antes do lançamento
**STATUS: RESPONDIDA (Rodada 12, decisão 27):** todos os e-mails estão habilitados no código (inclusive lembretes, seleção, cancelamento, desistência e trial/ciclo). A alternativa A (recomendada) foi superada. Sem interruptor, sem tela, sem reenvio de aceites antigos; envio real depende do domínio verificado (decisão 15); Mailpit em desenvolvimento; cota do Resend tratada como RNF (PRD §6.1). Texto abaixo é histórico.
**Contexto:** a decisão 23 desativa só os e-mails de aviso de aceite e de mensagem não lida; a decisão 21 diz que os e-mails ficam preparados e não são enviados. Não está dito o que ocorre com: lembrete de expiração 24 h e aviso de vencimento (RF-119), seleção/cancelamento/desistência (RF-118) e lembretes de trial/ciclo (RF-064). Não há domínio nem cota até o lançamento.
- **A. Todos desativados no código junto com os de aviso;** os avisos ficam só na plataforma até o lançamento.
- **B. Ficam ativos** (consomem cota; sem domínio só chegam ao modo de teste do Resend).
- **C. Cobrança/trial (RF-064) ativos; os demais desativados.**
**Recomendação [PROPOSTA]:** A até o lançamento com domínio (alinha à decisão 21 "criados mas não enviados"); no lançamento reativa-se por alteração de código, sem retroatividade. Avisos na plataforma permanecem. Exceção: lembrete de cobrança segue [PENDENTE JURÍDICO] (AMB-06).
**Afeta:** RF-064, 118, 119; FA-012, FA-016, FA-029.

## AMB-32 PDF no chat após a retirada das imagens (decisão 32)
**STATUS: RESOLVIDA pela decisão 33 (C): o chat é somente texto, sem nenhum anexo (nem imagem, nem PDF). Fotos extras e documentos só pelo WhatsApp, se o cliente autorizar.** O texto abaixo é histórico.
**Contexto:** a decisão 32 elimina imagens do chat e não menciona PDF. Hoje: PDF, até 5 por mensagem, 10 MB cada. O Storage gratuito é de 1 GB (`13-VERIFICACAO-SERVICOS.md`); PDF de 10 MB é o maior consumidor potencial.
- **A. Manter PDF como está** (5 por mensagem, 10 MB). Simples; risco de consumo de Storage e de ser canal para contato fora da plataforma.
- **B. Manter PDF com limites menores** (ex.: 1 a 3 por mensagem, 2 a 5 MB) para proteger o 1 GB.
- **C. Chat só texto** (sem nenhum anexo); documentos pelo WhatsApp.
**Recomendação [PROPOSTA]:** A agora, por ser a suposição vigente e não alterar o aprovado; reavaliar B com a medição de uso de Storage (Architect). C só se o usuário quiser eliminar o pipeline de arquivos do chat.
**Afeta:** RF-101, RF-102, RF-107; FA-027; Storage (08/09).

## AMB-33 Documentos de verificação de identidade do profissional: formatos e limites
**STATUS: ABERTA. O PO não decide.** Surge porque a decisão 33 elimina anexos do chat; o upload dos documentos de identidade (RF-046, RF-052, FA-004) é um fluxo separado e nunca foi especificado em formato e tamanho. Storage gratuito: 1 GB (`13-VERIFICACAO-SERVICOS.md`).
- **A. Somente imagem** (JPG/PNG/WebP, foto de frente/verso e selfie), com redução no envio como nas fotos do pedido (limite de entrada e alvo a definir). Menor consumo; legibilidade do documento pode cair se reduzido demais.
- **B. Imagem e PDF** (JPG/PNG/WebP e PDF), por exemplo até 5 arquivos por verificação, até 5 MB cada na entrada; imagens reduzidas no envio; PDF validado por conteúdo e antimalware, sem reduzir. Cobre CNH digital e comprovantes em PDF; PDF é o maior consumidor de Storage.
- **C. Somente PDF.** Pouco prático no celular; não recomendado.
**Recomendação [PROPOSTA]:** B, com limites de 5 arquivos e 5 MB cada (valores sujeitos à medição de Storage do Architect e ao L1 de retenção). Acesso restrito conforme RF-052 e RF-148, independente do chat.
**Afeta:** RF-046, RF-052, RF-148; FA-004, FA-031; Storage e antimalware (08/09).

---

## Pendências que não são ambiguidades de produto
- Jurídico: L1 (retenção), L2 (termos/privacidade/DPO), L3 (reembolso), L4 (certificações, inclusive coluna REG do catálogo), L7 (responsabilidade por "verificado" e conteúdo).
- Fontes originais (D1/D2): PRD, EDS, RN-001..408 e 641..675, 10 grupos de categorias: continuam não recebidos; este conjunto de documentos é [PROPOSTA].
- Repositório GitHub (owner/nome/visibilidade) para o Gate 2.
