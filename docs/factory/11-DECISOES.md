# FastPro — Registro de decisões

Decisões tomadas em 2026-11-09 por **delegação do usuário** ("pode seguir com as suas recomendações nessas perguntas"), a partir do relatório `10-RELATORIO-INGESTAO.md`. Origem: recomendação do Orquestrador. Revogáveis pelo usuário a qualquer momento. Não autorizam desenvolvimento.

| ID | Decisão [DELEGADO] |
|---|---|
| D3 | "Receber mais ofertas" aparece quando existirem **4 ofertas recebidas** e o pedido estiver **aberto** (dentro dos 7 dias, sem seleção/cancelamento). Libera a 2ª onda (até +4 participações), uma única vez. Após a expiração dos 7 dias não está disponível. |
| D4 | Avaliação é **publicada automaticamente** após validação antifraude e filtro automático de conteúdo. Moderação **humana apenas por denúncia/contestação**, com decisão fundamentada e recurso. Alinha o doc 03 §7 e o 06; o "sem avaliação automática" do §10 é lido como "sem avaliação gerada/atribuída pelo sistema". |
| D5 | Os 4 planos (mensal, trimestral, semestral, anual) têm **benefícios idênticos**; muda somente o ciclo de cobrança e o preço. |
| D8 | Link mágico mantém 15 min e uso único, mas o consumo exige **confirmação por ação na página (POST)**, não por simples abertura do link, para resistir a leitores/scanners de e-mail. Alternativa de **código de 6 dígitos** como fallback. Sem mudança de prazo nem de sessão (7 dias). |
| D10 | Mantida a decisão aprovada: elegíveis com acesso vigente veem as fotos antes de ofertar. **Mitigações obrigatórias:** remoção de EXIF, URL assinada curta, sem download do original, marca d'água com identificador do profissional, rate limit e log de acesso por profissional, detecção de raspagem. Nenhum dado pessoal junto das fotos. |

Pendentes (não decididos): D1, D2, D6, D7, D9 e itens jurídicos L1–L7 do relatório.

## Rodada 2 — decisões do usuário (2026-11-09, mensagem direta)

| ID | Decisão [APROVADO pelo usuário] |
|---|---|
| D1/D2 | O Product Owner está **autorizado a propor** o texto faltante (PRD, RN e catálogo) marcado como [PROPOSTA]. Para o catálogo: incluir **o máximo de categorias e serviços que conseguir** (amplo, não restrito a 10 grupos). Tudo sujeito a validação posterior do usuário; os 10 grupos originais, se recuperados, prevalecem. |
| Contato | Telefone/WhatsApp do cliente só é compartilhado com profissionais se o cliente **liberar expressamente ao preencher o pedido de serviço** (opt-in no pedido; desmarcado por padrão). Chat na plataforma permanece. |

## Rodada 3 — decisões delegadas (2026-11-09)

O usuário respondeu: "pode seguir com as recomendações, responda com o que achar melhor para o projeto".
Ficam adotadas como **[DELEGADO]** todas as recomendações de `07-AMBIGUIDADES.md` (AMB-01 a AMB-20), conforme a "Recomendação" de cada item (inclui D6=AMB-01, D7=AMB-02, D9=AMB-05: A no MVP, sujeita à confirmação do Architect sobre as regras das lojas).

Destaques:
- **AMB-12 — exceção explícita a D4:** avaliação com conteúdo ofensivo evidente é barrada pelo filtro e o cliente pode corrigir (B); somente **suspeita de fraude** vai para revisão humana (A). Revogável pelo usuário.
- **AMB-10:** oferta com conteúdo mínimo conforme alternativa A (valor estruturado opcional; sem obrigar).
- **AMB-17:** opt-in de telefone vale para participantes do pedido, revogável para o futuro, com autorização individual possível (C).
- **AMB-20:** MVP por fatias de desenvolvimento (B) e recorte de lançamento por foco (C), sem alterar preços, 4+4, 7 dias, 14 dias.
- Itens **[PENDENTE JURÍDICO]** (L1–L4, L7, AMB-06 quanto a lembrete de cobrança, AMB-14 prazos de retenção) continuam **não decididos**; nenhum prazo legal é inventado.
- Parâmetros técnicos (ex.: AMB-01 distância/janela) ficam com o Software Architect, como proposta.

## Restrição de orçamento (2026-11-09, usuário)
**[APROVADO] Não há orçamento.** Durante o desenvolvimento e o início do projeto, usar somente recursos **gratuitos** (planos free/open source). Consequências:
- A stack aprovada permanece, mas cada serviço deve ser dimensionado para o **plano gratuito** e ter limites, risco e plano de migração documentados (Supabase, Mapbox, Mercado Pago, hospedagem, e-mail transacional, mapas, armazenamento).
- Nenhuma contratação de serviço pago sem decisão do usuário. Planos pagos entram como "gatilho de upgrade" (ex.: ao passar de X assinantes), nunca como premissa.
- Alternativas gratuitas que alterem a stack aprovada exigem solicitação de decisão.
- Observação: o Mercado Pago cobra taxa por transação (não há mensalidade); isso é custo variável de receita, a ser confirmado na documentação vigente [NÃO VERIFICADO].

## Rodada 4 — decisões do usuário sobre tecnologia (2026-11-09, mensagem direta)

| ID | Decisão [APROVADO pelo usuário] |
|---|---|
| T1 | **Supabase confirmado** (Postgres/Auth/Storage/Realtime), no plano gratuito, com plano de migração e gatilhos de upgrade (ADR-020). |
| T2 | NestJS: usuário perguntou para que serve; explicação dada. Sem decisão de troca (permanece na stack aprovada até nova decisão). |
| T3 | **Mapbox mantido.** A verificação da licença de geocodificação (SD-02 / spike S-04) continua obrigatória antes de desenvolver o Geo; se houver conflito com a restrição de orçamento, volta como solicitação de decisão. |
| T4 | **Mercado Pago confirmado** para assinaturas. "Implementar" = incluir no backlog e na arquitetura; a implementação só começa após o gate de execução (Gate 3). Capacidades exatas ainda a verificar no spike S-03. |
| T5 | **Mobile fica para depois** da web (fase posterior; contas de loja pagas fora do início). |

## Rodada 5 — decisões do usuário (2026-11-09, mensagem direta)

| ID | Decisão [APROVADO pelo usuário] |
|---|---|
| H1 | **Hospedagem: Vercel** (Next.js; o NestJS/API também deve rodar na Vercel ou o Architect propõe a forma, sem custo). Pendente verificar [NÃO VERIFICADO]: termos do plano gratuito (uso comercial) e suporte a NestJS na Vercel. |
| H2 | **Domínio:** ainda não existe. Em desenvolvimento usar e-mail local/teste; a solução de envio em produção sem domínio próprio é a verificar pelo Architect (SD-03). |
| H3 | **Supabase gratuito** mantido, inclusive até o início; o usuário aceita o risco de pausa/backup do plano gratuito (SD-04), com projeto sempre em uso e **backup manual periódico (export) como mitigação proposta**. Antes de cobrar valores reais, reavaliar. |
| H4 | **MUDANÇA DE PRODUTO — fim da "oferta":** não existe oferta/proposta. O profissional clica em **"Aceitar trabalho"** e o cliente recebe **automaticamente uma mensagem no chat** e um **e-mail**. O envio de e-mail de aviso fica **DESLIGADO por enquanto** (para não consumir a cota gratuita), mas a arquitetura deve deixá-lo **pronto** (feature flag). Impacta: RF/FA de ofertas, D3 (gatilho "4 ofertas" → aceites), AMB-10 (conteúdo da oferta: extinto), edição de oferta (SD-08: extinto), notificações de oferta (FA-029), nomes de tela/botões. |
| H5 | **Sem boleto.** Pix e cartão apenas. A **carência de 72 h vale também para Pix** (SD-10). |

## Rodada 6 — respostas do usuário à lista de 9 perguntas (2026-11-09)

Numeração da lista de 9 perguntas apresentada pelo Orquestrador (AMB-21..29 do PO e itens do líder).

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 1 | **Sim.** "Aceitar trabalho" ocupa uma das 8 vagas, cria o chat com o cliente e libera o primeiro nome do cliente ao profissional (AMB-21 = A). |
| 2 | O cliente **conversa com os profissionais que aceitaram e fecha com o que gostar mais**; mantém seleção/conclusão/avaliação (AMB-22 = sim). |
| 3 | **Sim, recomendação adotada:** o profissional pode retirar o aceite antes de ser selecionado; a vaga permanece consumida (AMB-23). |
| 4 | **Preço e contratação direto entre as partes, no chat ou WhatsApp.** O papel do FastPro é **apenas conectar as pessoas**. (O aviso "não é contrato" não foi respondido explicitamente; texto jurídico depende de L2/L7.) |
| 5 | **Recomendação adotada:** interruptor por tipo de aviso; aviso de aceite e de mensagem não lida **desligados**; demais ligados, incluindo o link de login do cliente (AMB-25). |
| 6 | Resposta "ainda não" — **ambígua, pendente de esclarecimento** (como o cliente volta à plataforma sem e-mail de aviso; AMB-26). |
| 7 | **Sim.** Rótulo "Chamar mais profissionais" (AMB-29). |
| 8, 9 | **Sem resposta.** |

## Rodada 7 — respostas do usuário (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 10 | O cliente **só vê os aceites abrindo o site** por enquanto; os **e-mails ficam preparados** (interruptor desligado, pronto para ligar). Aviso na tela logo após publicar o pedido (recomendação do líder, não contestada). |
| 11 | **Backlog Architect: ainda não** — só depois de não haver mais perguntas em aberto. |
| 12 | **Leitura de documentação oficial dos serviços: ainda não** — só quando não houver mais perguntas. Limites seguem [NÃO VERIFICADO]. |
| T6 | **Provedor de e-mail: Resend.** Verificar plano gratuito e exigência de domínio próprio (provável: envio a terceiros exige domínio verificado) [NÃO VERIFICADO]. |

| T7 | **[APROVADO]** Em desenvolvimento e testes, usar **servidor de e-mail local de teste** (ex.: Mailpit ou Inbucket do Supabase local; escolha final do Architect); nenhum e-mail real sai e nada consome cota. Em produção o envio passa pelo Resend (adapter trocável), com domínio verificado. (Resposta do usuário: "pode ser".) |

| 13 | **[APROVADO]** Chaves/segredos ficam em **`.env.local`** (fora do repositório, no `.gitignore`) por enquanto. Valores nunca em prompts, logs, docs ou chat; documentos só citam **nomes** de variáveis. Revisitar (variáveis de ambiente da Vercel/Supabase, gerenciador de senhas) antes de produção/cobrança real. |
| T8 | **[APROVADO]** Modo de teste do Resend: redirecionar todo e-mail para o endereço do usuário (cadastro do Resend); desligado quando houver domínio verificado. Conta e chave criadas pelo usuário, só após autorização de execução. |

## Rodada 8 — respostas do usuário à lista 14–21 (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 14 | O "Aceitar trabalho" envia ao cliente a mensagem **"Estou disponível para trabalhar"** (texto da mensagem automática de sistema, PRD RF-075). O aviso "FastPro apenas conecta; não é contrato" **não foi confirmado** (pendente; texto jurídico em L2/L7). |
| 15 | **Sim.** Lançamento real bloqueado até existir domínio; até lá Mailpit local + modo de teste do Resend (T8). |
| 16 | **Vercel mantida** (H1). A verificação dos termos do plano gratuito (uso comercial) e do NestJS em função única continua como item a confirmar na leitura da documentação oficial (pergunta 12), antes da primeira cobrança. |
| 17 | **Sim.** O novo período começa a contar no **fim do período anterior**, sem lacuna (SD-16). |
| 18 | **Adiado:** periodicidade do backup manual vai para o TODO (`12-TODO.md`). |
| 19 | **Não.** O profissional que retirou o aceite **não pode aceitar de novo** o mesmo pedido; mantém só histórico somente leitura (SD-18). |
| 20 | **Sim.** "4 aceites" = vagas consumidas, inclusive de quem retirou (AMB-27). |
| 21 | Os **e-mails são criados e preparados (templates, fila, interruptores) mas NÃO são enviados** para não consumir cota. No lançamento o e-mail será configurado (falta o domínio). Retroatividade ao ligar o interruptor não foi confirmada explicitamente; padrão adotado: **não retroativo**. |

## Rodada 9 — respostas do usuário (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 22 | **C:** o aviso "o FastPro apenas conecta; preço e contratação são combinados diretamente / não é contrato" aparece **somente nos termos de uso** (texto jurídico em L2/L7), não no botão. |
| 23 | **Sem aceites antigos e sem botão/tela para ligar e desligar e-mail.** Não haverá interruptor administrável. O envio de e-mail de aviso (aceite, mensagem não lida) fica **implementado porém comentado/desativado no código**; o link mágico de login continua ativo. Substitui o interruptor por tipo (AMB-25, ADR-022, RF-122/RF-154). |

## Rodada 10 — ordem das próximas etapas (2026-11-09)

| Nº | Decisão |
|---|---|
| 25 | **[APROVADO]** Verificar na documentação oficial (somente leitura) preços, limites e termos de Vercel, Supabase, Resend, Mapbox e Mercado Pago **antes** de acionar o Backlog Architect, pois o resultado pode mudar a arquitetura (ex.: licença de geocodificação do Mapbox, uso comercial da Vercel, pausa/backup do Supabase, exigência de domínio no Resend, assinatura recorrente/Pix no Mercado Pago). Resultado vira `13-VERIFICACAO-SERVICOS.md` com fonte e data; qualquer conflito com a restrição de orçamento ou a stack vira solicitação de decisão. |
| 24 | **Depois da 25** (Backlog Architect), após os ajustes pendentes do PO (RF-122/RF-154) e a revisão do Architect. |

## Rodada 11 (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 26 | **A:** a mensagem automática do aceite aparece no chat como **aviso do sistema** (remetente nulo): "Fulano aceitou o trabalho: Estou disponível para trabalhar" (AMB-30 = A). |
| 27 | **Sem resposta** (pendente: e-mails de lembrete de 24 h, seleção, cancelamento, desistência e fim de teste/ciclo ficam desativados no código?). |

**Nota (2026-11-09):** a decisão T8 (modo de teste do Resend enviando ao e-mail do titular sem domínio) **não foi confirmada** na documentação oficial; ver `13-VERIFICACAO-SERVICOS.md`. Em desenvolvimento, usar apenas o Mailpit local e os endereços `resend.dev` até confirmar.

## Rodada 12 (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 27 | **Habilitar todos os e-mails** (aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo e login). Supera a parte da decisão 23 que mantinha o envio de aviso "comentado/desativado no código": o código de envio fica **ativo**. Permanece: **sem tela/interruptor administrável** e **sem reenvio de aceites antigos**. Motivo do usuário: o volume não deve consumir a cota. Em desenvolvimento o destino é o Mailpit local (sem domínio, nada real sai); o envio real ao público depende do domínio verificado no Resend (decisão 15). Sugestão do líder (não decidida): contador de uso diário/mensal com alerta perto de 100/dia e 3.000/mês para não ser surpreendido. |

## Rodada 13 (2026-11-09)

Resposta do usuário: "Vamos seguir com essas tecnologias" + decisão sobre fotos. Interpretação do líder (revogável): as recomendações do líder para 28 e 29 foram aceitas.

| Nº | Decisão |
|---|---|
| 28 | **[APROVADO, interpretado]** Vercel mantida. Desenvolvimento/testes no plano gratuito (Hobby); **ao começar a cobrar, migrar para o Pro** (≈ US$ 20/mês + US$ 20 por seat de desenvolvedor), pois o Hobby proíbe uso comercial/processamento de pagamento. Nada é contratado agora. |
| 29 | **[APROVADO, interpretado]** Mapbox mantido. Para guardar coordenadas, usar o modo **permanente** (≈ US$ 5 por 1.000 consultas, exige cartão cadastrado), com **limite de gasto configurado na conta** e só nas consultas que guardam coordenadas; autocomplete e mapas seguem no gratuito (temporário). Cartão e conta são criados pelo usuário só na fase de execução. |
| 30 | **[APROVADO]** O pedido mantém **5 fotos** (10 MB/foto como especificado). Fotos adicionais só pelo **WhatsApp**, se o cliente aceitar compartilhar o contato; se o cliente não quiser ir ao WhatsApp, o pedido fica **apenas com as 5 fotos**. **[PROPOSTA técnica, não decidida]:** redimensionar/comprimir no envio (alvo 1–2 MB) para caber no 1 GB do Supabase gratuito; o usuário não respondeu a isso explicitamente. |

## Rodada 14 (2026-11-10)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 31 | **A:** reduzir cada foto do pedido no envio para ≈ 0,5 MB (máx. 1.280 px de lado). Mantém 5 fotos por pedido. |
| 32 | **Não haverá imagens no chat.** Fotos extras só pelo WhatsApp, se o cliente autorizar. PDF no chat não foi mencionado: **permanece como aprovado (RF-102) até decisão contrária** (suposição do líder, a confirmar). |

| 33 | **[APROVADO] C:** o chat é **somente texto**, sem nenhum anexo (nem imagem, nem PDF). Resolve AMB-32. Fotos extras e documentos só pelo WhatsApp, se o cliente autorizar. Impacta RF-101/RF-102/RF-107, FA-027 (PO) e Storage/antimalware do chat (Architect: sai o bucket de anexos do chat). |

**Nota:** a suposição da decisão 32 ("PDF permanece") foi **superada pela decisão 33** (chat somente texto, sem nenhum anexo).

| 34 | **[APROVADO] B:** documentos de verificação do profissional aceitam **imagem e PDF**; limites provisórios (até 5 arquivos, 5 MB cada) a confirmar com o Architect (Storage) e a retenção jurídica (L1). Resolve AMB-33. |

**Lista de perguntas fechada em 2026-11-10** (nenhuma pendente do líder). Próxima etapa: Backlog Architect (decisão 24), somente documentos, sem criar Issues.

## Rodada 15 (2026-11-10) — respostas à lista 35–40

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 35 | **B:** documentos de identidade: imagens reduzidas no envio e PDF limitado a 2 MB (provisório; retenção jurídica pendente, L1). |
| 36 | **A:** Mapbox em modo permanente confirmado (cartão + limite de gasto), com a consulta paga feita na **revisão do pedido**. |
| 37 | Checkout do Mercado Pago em **modo de teste (sandbox), dados sintéticos, sem cobrança real**, permitido na fase de desenvolvimento; sem necessidade de nova confirmação. |
| 38 | **A:** só se republica pedido **expirado ou cancelado**. |
| 39 | Textos aprovados: "Este pedido não está recebendo novos profissionais no momento." (sem vaga) e "Ainda não encontramos profissionais para este serviço na sua região. Avisaremos quando houver." (sem cobertura). |
| 40 | **Sim.** Primeira entrega web = núcleo (pedido → aceite → chat de texto); cobrança real só no marco M4. |

**Instrução do usuário (2026-11-10):** reduzir perguntas; só perguntar o que for realmente bloqueante; seguir adiante com as recomendações. Registrado como diretriz do líder.

## Rodada 16 (2026-11-10)

| 41 | **[APROVADO pelo usuário]** Repositório existente https://github.com/lucasharo/fastpro e Project https://github.com/users/lucasharo/projects/4 (informados pelo usuário). Verificação do líder em 2026-11-10: repositório existe, **PÚBLICO e vazio**; 2 Issues antigas (#1 aberta [SETUP], #2 fechada [TESTE]); o Project **não pôde ser lido** (token do gh sem escopo project). Nada foi criado ou alterado no GitHub. |

| 42 | **[APROVADO pelo usuário] C:** repositório permanece **público** e recebe toda a pasta de documentos. Push inicial feito em 2026-11-10 (commit 4aaceb7, branch main). Atenção: tudo em docs/factory/ e as Issues são públicos; nunca incluir segredos, dados de clientes ou texto jurídico não revisado. |

| 43 | **[APROVADO pelo usuário]** Criar as Issues do manifesto. Executado em 2026-11-10: 135 Issues (#3 a #137), labels criadas e itens no Project 4 em Backlog. Observação: a automação do Project "Item added to project" coloca itens novos em "Product Owner"; foi corrigido para Backlog com `scripts/projectstatus.py` da fábrica (mapa em `21-ISSUES-CRIADAS.md`). Ajuste pedido pelo usuário: o status correto é Backlog (regra reforçada na fábrica). |
