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

| T7 | **[APROVADO]** Em desenvolvimento e testes, usar **servidor de e-mail local de teste** (ex.: Mailpit ou Inbucket do Supabase local; escolha final do Architect); nenhum e-mail real sai e nada consome cota. Em produção o envio passa pelo Resend (adapter trocável), com domínio verificado. (Resposta do usuário: "pode ser".) **Atualização (2026-11-11):** o Mailpit foi removido do projeto por decisão do usuário; em desenvolvimento e teste o envio passa pelo Resend, somente para a conta cadastrada. |

| 13 | **[APROVADO]** Chaves/segredos ficam em **`.env.local`** (fora do repositório, no `.gitignore`) por enquanto. Valores nunca em prompts, logs, docs ou chat; documentos só citam **nomes** de variáveis. Revisitar (variáveis de ambiente da Vercel/Supabase, gerenciador de senhas) antes de produção/cobrança real. |
| T8 | **[APROVADO]** Modo de teste do Resend: redirecionar todo e-mail para o endereço do usuário (cadastro do Resend); desligado quando houver domínio verificado. Conta e chave criadas pelo usuário, só após autorização de execução. |

## Rodada 8 — respostas do usuário à lista 14–21 (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 14 | O "Aceitar trabalho" envia ao cliente a mensagem **"Estou disponível para trabalhar"** (texto da mensagem automática de sistema, PRD RF-075). O aviso "FastPro apenas conecta; não é contrato" **não foi confirmado** (pendente; texto jurídico em L2/L7). |
| 15 | **Sim.** Lançamento real bloqueado até existir domínio. Até lá: envio pelo Resend, **somente para a conta cadastrada** (decisão do usuário, 2026-11-11; substitui a menção ao "modo de teste" da T8). |
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

**Nota (2026-11-09):** a decisão T8 (modo de teste do Resend enviando ao e-mail do titular sem domínio) **não foi confirmada** na documentação oficial; ver `13-VERIFICACAO-SERVICOS.md`. Em desenvolvimento, usar apenas o Mailpit local e os endereços `resend.dev` até confirmar. **Atualização (2026-11-11):** o Mailpit foi removido por decisão do usuário; em desenvolvimento e teste o envio passa pelo Resend, somente para a conta cadastrada.

## Rodada 12 (2026-11-09)

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 27 | **Habilitar todos os e-mails** (aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo e login). Supera a parte da decisão 23 que mantinha o envio de aviso "comentado/desativado no código": o código de envio fica **ativo**. Permanece: **sem reenvio de aceites antigos**. **Atualização (2026-11-11, decisão do usuário):** não haverá interruptor de e-mail de nenhum tipo (nem tela, nem chave de configuração, nem flag). O envio segue apenas o limite de cota já existente do Resend (100/dia e 3.000/mês), com as regras de prioridade e de cota já desenhadas em H-092. Motivo do usuário: o volume não deve consumir a cota. Em desenvolvimento o destino é o Mailpit local (sem domínio, nada real sai); o envio real ao público depende do domínio verificado no Resend (decisão 15). **Atualização (2026-11-11):** o Mailpit foi removido por decisão do usuário; em desenvolvimento e teste o envio passa pelo Resend, somente para a conta cadastrada. Sugestão do líder (não decidida): contador de uso diário/mensal com alerta perto de 100/dia e 3.000/mês para não ser surpreendido. |

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

## Rodada 17 (2026-11-10) — Gate 3

| Nº | Decisão [APROVADO pelo usuário] |
|---|---|
| 44 | **Gate 3 autorizado** (início do desenvolvimento, Onda 0). **Sem Docker:** usar apenas o projeto Supabase na nuvem. **Fluxo de branches:** `feature/*` -> `release/*` -> `main`; `main` = produção (PRD), `release/*` = DEV/TST, `feature/*` = trabalho; merges em `release/*` e `main` sempre por Pull Request. Executado: branch `release/0.1` criada a partir da `main` e dois rulesets ativos no GitHub (PR obrigatório, sem force-push, sem exclusão) em `main` e `release/*`. Aprovações exigidas: 0 (o dono é o único mantenedor; o merge é humano). |

| 45 | **[APROVADO pelo usuário]** O trabalho é **sempre em `feature/init`**; branches auxiliares só se necessário e com merge nela. Caminho à produção: `feature/init` -> `release/*` -> `main`, por PR. Substitui o modelo `feature/H-xxx` -> `release/*` da decisão 44. A `feature/init` não tem proteção (commits diretos permitidos). |

| 46 | **[APROVADO pelo usuário em 2026-11-11: "vamos usar o mapbox"]** Mapbox adotado. BK-2 aplicado na opção **(b)**, recomendada pelo líder: coordenada permanente (modo pago, cartão e limite de gasto) só na publicação do pedido. Autocomplete segue no temporário gratuito. Criação da conta, do cartão e do limite de gasto é feita pelo usuário (BLQ-EXEC), e a Issue #34 (H-021) segue bloqueada até essa etapa. |

## Rodada 18 (2026-11-11) — H-103, console admin por papel (Issue #112)

Números das decisões 48 a 52 seguem o desenho `70-DESENHO-H103.md` §5. O refino `69-REFINO-H103.md` §6 usa os mesmos rótulos D-H103-1 a 4 para outras perguntas; em caso de dúvida, vale a numeração de 70.

| Nº | Decisão |
|---|---|
| 47 | **[DELEGADO, revogável] RF-146 (console admin por papel), base AMB-08 A (CA-H103-13).** Cada conta vê só as telas dos próprios papéis: Verificação, Moderador, Financeiro, Suporte, Auditor e Superadmin. RF-146 não consta no PRD; a base é a proposta de AMB-08 (07-AMBIGUIDADES). Referências: `69-REFINO-H103.md` §0 e §2; `70-DESENHO-H103.md` §1. BK-11 fica resolvida por esta delegação. Revogável pelo usuário se a versão original de RF-146 for encontrada. |
| 48 | **[DECIDIDO pelo líder]** (70 §5, D-H103-1) A listagem de equipe (`GET /v1/admin/staff`, só leitura) entra em H-103. H-102 não é reaberta. |
| 49 | **[DECIDIDO pelo líder]** (70 §5, D-H103-2) H-103 entrega as telas de acesso excepcional (pedido e aprovação); H-073 entrega as rotas. **Correção do refino 69:** ele atribuía essas telas a H-073; vale o desenho 70. |
| 50 | **[DECIDIDO pelo líder]** (70 §5, D-H103-3) A tela Financeiro fica sem permissão própria por enquanto. Só aparece quando a história dona (H-053, H-105) registrar a rota no registro. |
| 51 | **[DECIDIDO pelo líder]** (70 §5, D-H103-4) H-103 em duas entregas: (1) lógica, menu e testes; (2) tela em `apps/admin`. |
| 52 | **[DECIDIDO pelo líder]** (70 §5, D-H103-5) `apps/admin` usa Next.js, conforme o placeholder, sem outro framework. |

| 53 | **[APROVADO pelo usuario, pedido em 2026-11-11]** Limite de envio do cadastro e reenvio do profissional (H-016): 5 por hora por e-mail (o desenho 33 §2 fixava 3 para o cadastro; o usuario pediu 5, e cadastro e reenvio passam pela mesma rota), intervalo de 60 s e teto de 10 por hora por IP. **Riscos aceitos:** (a) check e record nao sao atomicos, entao requisicoes simultaneas podem passar do intervalo; alternativa futura: rl_check_and_hit atomico em migracao propria; (b) o IP vem de req.socket.remoteAddress, e atras de proxy o teto por IP vira global: a composicao deve definir o IP real (vale para todas as rotas). Nota: o HMAC do e-mail e do IP depende da composicao, ainda nao ligada. |

## Rodada 19 (2026-11-11) — H-035, gravação do documento do profissional (Issue #48)

| Nº | Decisão |
|---|---|
| 54 | **[DECIDIDO, revisão da #48 com a recomendação do revisor]** Proteção de status e documento do perfil profissional, sem `security definer`: (1) `app_system` recebe `update` por coluna só em `public_name`, `slug`, `document_type`, `document_enc`, `document_hmac`, `verification_status` e `updated_at`; (2) gatilho `BEFORE UPDATE` aceita mudança de `verification_status` só no primeiro cadastro do documento (de `pendente` para `pendente` ou `retida_duplicidade`, com `document_hmac` preenchido na mesma atualização) e recusa qualquer outra mudança de status; (3) os campos do documento são write-once depois de gravados; (4) a função `private.professional_profile_set_document` trava a linha, checa duplicidade, trata `23505` do índice de HMAC como retida e re-lança colisão de slug. Referências: `75-DESENHO-H035.md` §2 e §4; migração `20261111420000`. Substitui a premissa de "sem update em verification_status" do desenho anterior, que não fechava com o caminho de retida. Pendente para H-039: a transição de aprovação e recusa precisa de caminho próprio, a desenhar. |
| 55 | **[DECIDIDO pelo dono do produto, mudança de 2026-11-12]** Envio de e-mail liberado. Os e-mails do profissional (verificação, recuperação, ativação e aviso de senha alterada, H-016) saem pelo adaptador Resend já existente, o mesmo usado pelo login. Sem interruptor de liga/desliga. Valem os limites de cota já definidos (limites de envio por e-mail e IP, classe `auth`) e a trava de destinatário da conta registrada enquanto o remetente for o de teste. Chave de envio: somente a que já está em `.env.local` (variável `RESEND_API_KEY`); nenhuma chave nova. Substitui o envio desligado até o lançamento (CA-H016-06, registrado na #29) e a regra de não enviar e-mail em desenvolvimento. |
| 56 | **[DECIDIDO pelo líder, refino 87 D-1, opção (b) da dúvida de duplicidade]** Em consequência da decisão 46 (coordenada permanente só na publicação), a verificação de **duplicidade** (mesmo serviço, até 100 m) e a **cobertura** deixam a revisão do rascunho e passam para a **publicação**; a revisão mostra só o texto do endereço. Duplicidade roda dentro do banco sobre `exact_point` (nunca sobre `match_point`, grosseiro demais) e só avisa (409 `duplicate_warning`, nunca bloqueia); cobertura aparece no estado do pedido já publicado (AMB-03 A). Referências: `68-DESENHO-H021.md` §3.5 e dúvida 1; `87-REFINO-H022.md` D-1. **Pendente:** ajustar H-030, H-024 e FA-002 no backlog e nos critérios de aceite.
| 57 | **[DECIDIDO pelo líder, refino 87 D-2, D-3, D-4, D-5]** H-022 (#35): (D-2) casamento por célula como chave inteira, índice B-tree e filtro de distância, sem depender de PostGIS na consulta; PostGIS só como oráculo de teste (CA-07); (D-3) #34 concluída, sequência livre; (D-4) grade de 500 m com versão da grade gravada junto de `match_point` (`match_grid_version`); (D-5) rastro corrigido: o modelo geo está em 08 §9.1–9.2 (14-BACKLOG H-022 ajustado). Referência: `88-DESENHO-H022.md`.
| 56 | **[DECIDIDO pelo líder; valores do Architect, desenho 88 §3, Issue #39 H-026]** Upload de fotos em quarentena: (1) o dono do envio antes da identificação é o nonce do rascunho (cookie `__Host-fp_draft`), como em H-025; (2) H-026 é desenvolvida, mas não liberada a visitantes reais antes de H-027 e H-028 estarem prontas (o original com EXIF mora na quarentena); (3) HEIC recusado com 415 até H-027 ligar a conversão; (4) valores `[PROPOSTA]`: pendente sem confirmação vence em 30 min, URL de envio com alvo de 15 min, varredura de órfãos após 3 h, cota de 12 emissões por hora e 25 por dia por rascunho, 40 por hora e 150 por dia por IP-HMAC, 30 confirmações por hora por rascunho, teto global de 150 vagas vivas; (5) sem exclusão de foto até H-029; (6) aviso de fachada e interior fica com H-029 e UX; (7) em 08 §10.2 a referência a FA-028 (chat) foi trocada por FA-001, P-01 e F-09. |

## Rodada 20 (2026-11-12) — H-120, dados sintéticos de demonstração (Issue #129)

Nota: o número 56 aparece duplicado nas rodadas 19 (decisões de H-022 e H-026). Esta decisão usa a próxima numeração livre, 58.

| Nº | Decisão |
|---|---|
| 58 | **[DECIDIDO pelo dono do produto, 2026-11-12, regra permanente]** A carga de demonstração (`pnpm db:demo:load`) e sua remoção seletiva (`pnpm db:demo:remove`) podem rodar no **banco de desenvolvimento compartilhado** do `.env.local`, sem variável de confirmação de exceção e sem flag de forçar. Trava: `APP_ENV=development` (variável já existente no `.env.local`) e banco local, ou banco Supabase do projeto indicado por `NEXT_PUBLIC_SUPABASE_URL` do mesmo `.env.local`. Continuam recusados: outro `APP_ENV`, host ou projeto de outro ambiente, variável ausente, argumento extra e `--force` (inexistente). A remoção só apaga registros com o prefixo de demonstração (`fa57d120-`) e objetos de Storage marcados. Substitui, para este banco, a trava que recusava qualquer banco não local (85-DESENHO-H120 §1). Referências: `85-DESENHO-H120` §1 e §3; `84-REFINO-H120` §4. |

## Rodada 21 (refino da tela de pedido, #43 / H-030)

- **59 (D-H030-1):** a revisão do pedido exige e-mail confirmado pelo link (FA-002). A Issue #26 (código de 6 dígitos e nonce) entra como dependência de H-030; a construção da tela espera a #26.
- **60 (D-H030-2):** sem estado "confirmado" no modelo; o pedido guarda a data de confirmação e o status segue "aberto" até H-031.
- **61 (D-H030-3):** texto após confirmar, sem publicar: "Pedido confirmado. Ainda não foi publicado."
- **62 (D-H030-4):** o aviso de duplicidade fica na publicação (#44), porque sem coordenada não há ponto para comparar.
- **63 (D-H030-5):** H-024 (cobertura, #37) sai das dependências de H-030.
- **64 (D-H030-6 a 11):** fotos ocultas sem fotos; campos obrigatórios conforme o refino; limite da descrição e valores de duplicidade e textos ficam como propostas revisáveis pelo desenho.

## Rodada 22 (refino do código de 6 dígitos e nonce, #26 / H-013)

- **65 (D-H013-2):** o rascunho é anexado também pelo link, com função compartilhada com o código (CA-07).
- **66 (D-H013-3):** o nonce do rascunho fica no cookie __Host-fp_draft (decisão 56), e não num segundo cookie.
- **67 (D-H013-4):** a #26 grava e-mail e primeiro nome no rascunho (CA-10).
- **68 (D-H013-5):** o e-mail confirmado é um campo de data no rascunho, sem status novo (usado pela #43).
- **69 (D-H013-1 e D-H013-6):** o código é POST /v1/auth/challenges/verify (a 08 §5.1 deve ser corrigida). A tela do código é entregue pela #26.

## Rodada 23 (desenho da tela de pedido, #43 / H-030)

- **70:** quem grava primeiro nome e e-mail no rascunho é a rota de identificação da #26.
- **71:** a revisão usa "e-mail confirmado no rascunho", não a sessão de 7 dias (a sessão continua exigida na publicação, #44).
- **72:** o corpo da confirmação leva content_rev.
- **73:** limite da descrição em 2000 caracteres (fecha D-H030-8).
- **74:** Playwright e @axe-core/playwright como devDependencies gratuitas, para os testes de navegador.
- **75:** duas páginas estáticas no web, sem framework.
- **Portão:** a construção da #43 começa só depois da #26 (decisão 59).

## Rodada 24 (QA da #29, ciclo de correção 1 de 2)

- **76 (CA-23, cliente que vira profissional):** segue o desenho 33 §3.1 e 67 §9: o e-mail verificado é do app_user. Aceito como decisão do dono do produto; o critério literal "nasce não verificado" fica substituído por esta decisão.
- **77 (CA-06, envio):** vale a decisão 55 (envio liberado, com trava de destinatário na conta registrada). O texto de Mailpit no CA-06 é atualizado.
- **78 (CA-12):** autorizada a execução do teste de concorrência de login no banco de desenvolvimento, com limpeza no final (sem resíduo).

## Rodada 25 (refino da redução e reencode das fotos, #40 / H-027)

- **79 (D-H027-1):** a rotação da foto fica na #40, para a medida de 1.280 px sair no eixo certo.
- **80 (D-H027-2):** HEIC continua recusado com 415 até haver conversão comprovada.
- **81 (D-H027-3):** o reencode acontece de forma síncrona no envio final (o job gratuito roda uma vez por dia).
- **82 (D-H027-4):** o original é apagado logo depois de gravar a versão reduzida. Isso altera a condição 2 do desenho 88 §8; o desenho deve ser atualizado.
- **83 (D-H027-5 e D-H027-6):** alvo de 0,5 MB e teto de 0,75 MB; a redução acontece no navegador antes de emitir o tamanho declarado.
- **84 (D-H027-7 e D-H027-8):** rejeição definitiva só para falha que não se resolve; tempo, memória e erro de armazenamento são transitórios. A saída é JPEG (medido no S-06).
- **85 (D-H027-9):** a carga do sharp em Linux precisa ser verificada antes da construção (não bloqueia o desenho).

## Rodada 26 (desenho da redução de fotos, #40 / H-027)

- **86 (93 §12.1):** teto de 3 tentativas por foto que sempre estoura tempo ou memória; a 4ª vira rejected/nao_processavel. Erro de armazenamento e carga da biblioteca de imagem nunca contam.
- **87 (93 §12.2):** desenvolvimento no Windows; a carga da biblioteca de imagem em Linux x64 vira condição de liberação (junto da 88 §8).
- **88 (93 §12.3):** o bucket request-photos é criado na migração 20261112140000.

## Rodada 27 (refino da cobertura booleana, #37 / H-024)

- **89:** cobertura é só "com" ou "sem" profissional na área, mostrada depois de publicar o pedido; sem contagem, identificador ou coordenada, e com limite contra sondagem. Antes da publicação não há cobertura (decisão 56).
- **90:** não há rota pública de cobertura (conflito com a decisão 46 registrado em 11-ARQ §2.2); a informação sai só na resposta do dono do pedido publicado.
- **91:** a #37 depende da #36 (H-023, descoberta por raio) e da #49 (H-036, base do profissional) para ser construída; o refino está pronto e a construção espera essas duas.

## Rodada 28 (descarte da #110)

- **92:** não haverá interruptor de e-mail (decisão 23 prevalece sobre a 27 nesse ponto). A Issue #110 (teste de ausência de interruptor) fica descartada; não será construída.

## Rodada 29 (refino da remocao de EXIF e tipo por conteudo, #41 / H-028)

- **93 (D-H028-1):** o conteudo do arquivo decide o tipo (aceita se JPG, PNG ou WebP); o nome e o tipo declarado nao decidem.
- **94 (D-H028-2):** nao instalar ferramenta externa de prova (ExifTool); a checagem fica com leitura propria, com a limitacao registrada na Issue.
- **95 (D-H028-3):** HEIC/HEIF recusado com imagem_invalida, sem codigo novo nem migracao.
- **96 (D-H028-4):** checagem de assinatura antes do decodificador (CA-05).
- **97 (D-H028-5):** a janela do original ate o finalize nao muda nesta historia; a condicao 2 do desenho 88 §8 segue o que a decisao 82 registrou.

## Rodada 30 (desenho da remocao de EXIF e tipo por conteudo, #41 / H-028)

- **98:** a checagem de metadado nao roda em tempo de execucao antes de gravar; a prova fica nos testes (96-DESENHO-H028 §11).
- **99:** HEIC com tipo declarado JPEG recebe mensagem generica (decisao 95).
- **100:** o caso "sem tipo declarado" segue sendo a recusa de 415 da #39, apenas confirmado por teste.
- **Portao:** o desenvolvimento da #41 comeca so depois que a #40 sair de QA (mesmos arquivos de servico e teste).

## Rodada 31 (refino da descoberta por raio e online nacional, #36 / H-023)

- **101 (D-H023-1):** a #36 cobre so a regra e a consulta no banco; a rota de descoberta e a guarda de aprovacao ficam na H-055.
- **102 (D-H023-2):** a H-031 (pedidos com servico, modalidade e status) e' condicao de construcao da #36; o desenho pode avancar antes.
- **103 (D-H023-3):** a busca parte do centro da celula da base.
- **104 (D-H023-4):** faixa de incerteza de 710 m mais 0,3 % do raio.
- **105 (D-H023-5):** servico nas duas modalidades vale o online.
- **106 (D-H023-6):** servico online regulamentado nao ganha alcance nacional ate L4.
- **107 (D-H023-7):** a distancia nao e' exposta ao profissional.
- **108 (D-H023-8):** paginacao por cursor.

## Rodada 32 (refino do perfil profissional, #49 / H-036)

- **109 (D-H036-1):** a modalidade entra na chave de professional_service, para permitir "ambos" (duas linhas).
- **110 (D-H036-2):** base e raio tem historico com "vigente desde"; a publicacao usa a base vigente naquele momento. Destrava o desenho da #36.
- **111 (D-H036-3):** limite de mudanca de base ou raio: 3 por 24 h [PROPOSTA], valor em parametro.
- **112 (D-H036-4):** raio em km inteiros, gravado em metros.
- **113 (D-H036-5):** texto completo do endereco so no campo privado.
- **114 (D-H036-6):** edicao em status suspenso e recusada; em outros status, permitida sem conceder elegibilidade.
- **115 (D-H036-7):** servico REG e declaravel; alcance nacional de online regulamentado fica para L4.
- **116 (D-H036-8):** testes com a porta simulada da #34; chamada real ao Mapbox so apos BLQ-EXEC.

## Rodada 33 (refino da pre-visualizacao e reordenacao das fotos, #42 / H-029)

- **117 (D-H029-1):** leitura da foto pelo dono, listagem e motivo da recusa, pelo cookie do rascunho, com no-store e 404 uniforme; o original nunca e' exibido.
- **118 (D-H029-2):** botao "Adicionar foto" nesta tela.
- **119 (D-H029-3):** ordem das fotos guardada no servidor, com migracao nova aplicada pelo npx supabase.
- **120 (D-H029-4):** sem capa nesta historia.
- **121 (D-H029-5):** textos da tela aprovados, inclusive o aviso sobre fachada, interior e rostos.
- **122 (D-H029-6):** H-027 entra como dependencia da #42 no backlog.
- **123 (D-H029-7):** deduplicacao de foto repetida fica fora desta historia.

## Rodada 34 (desenho da cobertura booleana, #37 / H-024)

- **124:** rota minima do estado do dono entregue junto, se a #47 nao existir na construcao.
- **125:** a #36 cria as funcoes de regra de descoberta (discovery_*), compartilhadas com a cobertura.
- **126:** limites de sondagem aceitos (20 por pedido, 60 por dono e 60 por IP por hora), medidos depois.
- **127:** a tolerancia da fronteira do raio segue a decisao 104.
- **128:** textos "com" e "sem" (BK-5) continuam pendentes; bloqueiam o fechamento, nao o desenvolvimento.

## Rodada 35 (desenho do perfil profissional, #49 / H-036)

- **129:** valores de limite aceitos em parametro: 10 tentativas de geocodificacao por 24 h, 40 chamadas por profissional, 30 servicos, 30 escritas por hora.
- **130:** base geocodificada por "localidade" aceita agora, por coerencia com a #34; precisao maior fica como parametro futuro.
- **131:** servicos sem historico "vigente desde"; mudar servico vale ja para a descoberta de pedidos abertos (possivel Issue futura).
- **132:** remocao de base fica para uma historia propria, depois.

## Rodada 36 (desenho da pre-visualizacao e reordenacao das fotos, #42 / H-029)

- **133:** a migracao altera a regra de confirmacao do pedido, para que excluir ou reordenar foto zere a confirmacao; o desenvolvimento copia a funcao vigente e confere que os testes da #43 seguem verdes.
- **134:** textos novos da tela aprovados como estao (titulo, contador, dialogo de exclusao, anuncios).
- **135:** o aviso de fachada, interior e rostos fica sempre visivel, mesmo sem fotos.
- **Portao:** o desenvolvimento da #42 comeca so quando a #41 sair de desenvolvimento (mesmos arquivos de midia).

## Rodada 37 (refino da exclusividade de papeis, #30 / H-017)

Perguntas do refino 100-REFINO-H017.md, numeradas de forma continua. Adotadas como RECOMENDADAS pelo lider para nao parar o fluxo; o usuario pode vetar ou trocar a qualquer momento (aguardando confirmacao).

- **136 (Q1):** a mesma pessoa pode ter perfil de cliente e de profissional no mesmo app_user (recomendacao A).
- **137 (Q2):** admin nao pode ter perfil de cliente nem de profissional, e o inverso tambem (recomendacao A; coerente com a linha H-017 do backlog).
- **138 (Q3):** a mesma pessoa e' identificada pelo app_user; dois e-mails continuam sendo duas contas, limitacao ja aceita (recomendacao A).
- **139 (Q4):** o papel admin e' atribuido so por ferramenta de linha de comando ou seed, com auditoria e sem autoatribuicao (recomendacao A).
- **140 (Q5):** dados que ja violem a regra nao sao apagados; a migracao falha com lista para revisao manual (recomendacao A; hoje nao ha aceite construido).
- **141 (Q6):** a recusa responde texto fixo generico e registra auditoria sem dado pessoal (recomendacao A).
- **Escopo:** "profissional nao aceita o proprio pedido" so e' testavel no nivel do banco (aceite e publicacao ainda nao existem); teste por API e tela fica para as ondas seguintes.

## Rodada 38 (desenho da exclusividade de papeis, #30 / H-017)

Recomendadas pelo lider; o usuario pode vetar (aguardando confirmacao).

- **142 (A1):** a decisao 139 vale como "nenhum caminho publico nem autoatribuicao de admin"; o convite por Superadmin com dupla aprovacao das #111/#112 e o bootstrap continuam. Nao ha retrabalho nelas.
- **143 (A2):** incluir o gatilho que torna app_user.auth_user_id imutavel, com teste.
- **Registro para as Issues das Ondas 2 e 3:** anexar o gatilho acceptance_nao_proprio_pedido ao criar acceptance; tornar service_request.customer_user_id imutavel; mapear o erro aceite_proprio_pedido para a mensagem fixa.
- **Achados do desenho 101:** nao existe customer_profile (sera criado, com verificacao previa que aborta a migracao se houver violacao); admin_email_is_reserved nao era chamada por nenhum codigo (link de cliente com e-mail de admin deve ficar uniforme, link_invalido).

## Incidente de processo (2026-11-12) — indice do git compartilhado
- Os commits 903c87a (refino #30) e dd25616 (decisoes #30) levaram, sem querer, arquivos da #49 que ja estavam no indice compartilhado (fiacao de app.ts, composicao.ts, index.ts, geo-point-store, professional-offering, migracoes 20261112160000/170000/180000 e testes). O HEAD ficou consistente; nao se reescreveu historico. Causa: agentes em paralelo na mesma arvore e commit sem restringir caminhos.
- Regra daqui em diante: todo commit usa `git commit -m ... -- <caminhos>` (so os arquivos da Issue) e confere `git diff --cached --stat` antes.
- Desvio registrado: migracoes aplicadas pelo executor do repositorio (`corepack pnpm db:migrate`, tabela ops.schema_migration, dry-run transacional, documentado em supabase/README.md) e nao por `npx supabase db push`, que usa outra tabela de historico e poderia reexecutar as 59 migracoes. O MCP do Supabase continua proibido.
- db:test completo no DEV: 22 falhas fora da #49 (D-02b, T-BK-09, T-H019-09..16, T-H018-11/13, D-01, D-10, T-DB02, desfazer de rascunho, CA-4 e T-CA10 de geo). Registrado para triagem; nao bloqueia a #49.

## Rodada 39 (respostas do usuario, 2026-11-12)
- **145:** SIM. A #41 em Concluido foi decisao do usuario (CONCLUIR). Nada a desfazer.
- **144:** o usuario respondeu "sim" a "CONCLUIR ou BLOQUEAR a #129?". Resposta ambigua entre as duas opcoes; confirmacao pedida antes de mover. A #129 permanece em Aguardando aprovacao.
- **Resposta "sim para todas" (2026-11-12):** 
  - **144:** CONCLUIR a #129. Movida para Concluido por decisao humana.
  - **146:** decisoes 136 a 143 da #30 confirmadas.
  - **147:** aceito: o papel de backup nao le professional_area, professional_area_history e professional_service (dados de localizacao); o procedimento de backup (TODO 1) deve tratar essas tabelas.
  - **148:** autorizada a triagem das falhas do db:test; criada a Issue #140 [E15] no Backlog.

## Rodada 40 (Code Review de #49 e #42, 2026-11-12)
- **#49:** Code Review APROVADO com condicao A1 (commit do callsCap), cumprida em 1d9cc44 com teste. Dividas registradas: T-P19 (serializacao com lock_timeout entre duas conexoes) a cobrir antes de ligar a rota em producao; teste da funcao real ensurePermanentPoint contra o banco (o pacote db nao importa apps); T-P14 sem service_role; escrita invalida consome slot das 30/h (conservador).
- **#42:** Code Review reprovou so por 2 erros de lint em fotos.js (corrigidos em 5bd5d07). Pendencias para a QA: composicao da rota de midia (nova Issue #141, no Backlog; sem ela as rotas da galeria dao 404 em runtime), dbtest do adaptador PgMediaGallery, roteiro manual G-14 (NVDA, zoom, contraste).
- **T-DB02 da #43** falha por estado do catalogo no DEV (CT002), nao pela #42; tratar na triagem #140.

## Rodada 41 (QA da #42 e fechamento da #49)
- **149 (CSP da pagina /fotos x teste T-H020-11a):** a origem do Storage do Supabase na CSP de `/fotos` e' exigida pelo desenho aprovado (98-DESENHO-H029 §4, R-04: o envio da foto vai direto ao Storage). Decisao do lider (recomendada, o usuario pode vetar): o teste T-H020-11a passa a aceitar `connect-src 'self'` mais exatamente a origem do Storage do projeto SOMENTE na entrada `/fotos`; continuam proibidos Mapbox e qualquer outro dominio, e as demais paginas ficam como estao. Correcao pelo DEV da #42 (ciclo de correcao 1 de 2).
- **#42 QA reprovado (1a rodada):** CSP acima; falta teste nomeado do fluxo "adicionar foto" (CA-04); reexecutar a suite completa do apps/api. T-H013-03 deu timeout de 5 s sob carga do DEV e passou isolado (instabilidade, vai para a triagem #140).
- **#49:** QA reprovou so por 1 erro de eslint; corrigido em 6b811b6 (ciclo de correcao 1), reexecutados eslint, vitest da rota (14/14) e tsc. #49 em Aguardando aprovacao.
- **#30 Code Review APROVADO (3864041):** sem bloqueantes. Condicoes registradas para outras historias: (1) a historia que criar `app.acceptance` deve criar o gatilho `acceptance_nao_proprio_pedido` passando a tabela de pedidos em TG_ARGV[0]; o T-12 deixa de ficar ignorado; (2) a rota que receber o erro 23514 deve ligar `recordRoleExclusivityDenied` (perfil e admin); (3) o adaptador de convite mapeia 23514 para `convite_invalido`; (4) falta dbtest de `recordRoleExclusivityDenied` contra `audit_append` (ajuste nao bloqueante).
- **Correcao da hipotese da triagem #140:** a falha T-DB02 da #43 vem do fixture do proprio teste (grupo e servico em transacoes separadas contra o gatilho deferrable do catalogo), nao do estado do catalogo do DEV; corrigida na 2a passada do DEV da #43.
- **#42 correcao (ciclo 1, a4fffd8):** CSP e teste T-H020-11a ajustados conforme a decisao 149; 8 testes do fluxo "adicionar foto" (CA-04) com fakes; suite completa do apps/api 738 passam. **Lacuna de produto registrada:** fotos.js nao liga a opcao `adicionarFoto` (enviarFoto esta em apps/web/src/media/reduzir-foto.ts, TypeScript, nao carregado pela pagina publica); o botao "Adicionar foto" fica indisponivel em producao. Tratada no escopo da Issue #141 (composicao da midia + ligacao do envio na pagina), nao como defeito escondido: a #42 vai a Aguardando aprovacao com essa ressalva explicita.
- **150 (seguranca, pergunta ao usuario):** durante a correcao da #42 um grep imprimiu na saida do agente linhas do .env.local com as senhas de banco (DATABASE_URL_*). Nao foram gravadas em arquivo nem commit. Recomendacao: rotacionar as senhas do banco de desenvolvimento no Supabase e atualizar o .env.local. Aguardando decisao do usuario.

## Correcao de fluxo (2026-11-12): dependencia da #36
- O DEV da #36 parou sem alterar nada porque a decisao 102 e o desenho 97 (§0.2, §3.2, §11) exigem H-031 (#44) construida antes da #36 (a funcao de descoberta le service_request, que ainda nao existe). Erro do lider: a #36 foi puxada para Desenvolvimento sem checar essa dependencia. Corrigido: #36 volta a Arquitetura (pronta, aguardando), #37 espera a #36.
- Cadeia de dependencia: #43 (H-030) -> #44 (H-031) -> #36 (H-023) -> #37 (H-024). A #44 so entra em Desenvolvimento depois da #43; o PO da #44 pode comecar antes, se houver vaga.
- Proxima atividade independente puxada: #119 [E13] Expurgos operacionais (H-110: depende de H-005, H-008, H-109, todas concluidas). Candidata seguinte: #50 [E4] Documentos de identidade (H-037: depende de H-026, H-016, S-06, concluidos), depois da #141 para nao disputar a infraestrutura de midia.
- Quadro: o servidor do quadro.html reescreveu o arquivo quando o usuario concluiu a #49 e a #42 sumiu; restaurada em Aguardando aprovacao.

## Rodada 42 (refino da composicao da midia, #141 — 102-REFINO-MIDIA-COMPOSICAO.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **151 (P-141-1):** a midia e' montada na raiz da API, mas liberada em producao somente com variavel explicita de liberacao, ausente em producao ate o expurgo agendado (H-110, #119) existir (condicao 3 de 88 §8). Em desenvolvimento e preview, montada.
- **152 (P-141-3):** reaproveitar SUPABASE_URL e SUPABASE_SECRET_KEY para o Storage da midia.
- **153 (P-141-4):** galeria separada do upload (cada uma com as proprias pendencias na composicao).
- **154 (P-141-6):** aprovados os tres textos novos propostos no refino (arquivo grande demais; tipo nao aceito; falha de envio).
- **155 (P-141-7):** a ligacao do AbortController (excluir foto durante o envio) entra na #141.
- **156 (P-141-9):** aceitar em desenvolvimento e preview a reducao no servidor sem a carga do sharp em Linux verificada (falha vira 503); producao fechada pela 151.
- **P-141-5 (como gerar o script publico de /fotos):** vai para o Arquiteto (recomendacao do PO: esbuild como dependencia de desenvolvimento gratuita, saida gerada e ignorada pelo git).
Perguntas ao usuario (numeracao continua):
- **157 (P-141-10, executor de migracoes):** `npx supabase db push/migration list` deu 403 nesta conta (relatado pelo DEV da #42) e `db push` usa outra tabela de historico; o executor do repositorio (`corepack pnpm db:migrate`, ops.schema_migration, dry-run transacional) e' o que todos os agentes usam. Recomendacao: formalizar `db:migrate` como o executor oficial e manter proibido o MCP do Supabase. Aguardando decisao.
- **P-141-2 e P-141-8:** ja respondidas pelo fluxo: a #42 espera a decisao do usuario com a ressalva; o teste ponta a ponta da #141 espera a decisao 150 (senhas).

## Rodada 43 (refino dos expurgos operacionais, #119 / H-110 — 103-REFINO-H110.md)
Pergunta ao usuario (numeracao continua):
- **158 (Q-H110-1, juridico/produto):** o detalhe do registro de acesso a fotos (media_access_log) pode ser removido por janela tecnica? Conflito: 09 §7 o classifica como RC-03 (prazo legal, H-109) e 09 §10 manda a remocao no H-110. Recomendacao: (a) rollup agora e remocao do detalhe so quando L1 definir o prazo. Alternativas: (b) remover em 90 dias ja; (c) tirar do escopo. Enquanto nao houver resposta, o desenho segue (a), que e' a opcao conservadora.
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar), todas em app_config, [PROPOSTA]:
- **159 (Q2):** rascunho expira por 30 dias de inatividade.
- **160 (Q3):** upload em quarentena sem conclusao expira em 24 h.
- **161 (Q4):** foto de rascunho expirado sai junto com o rascunho, quando nunca ficou pronta.
- **162 (Q5):** RC-08 (logs do provedor) so documentado como configuracao do provedor, sem codigo.
- **163 (Q6):** legal_hold suspende tambem os TTL tecnicos de todo dado do sujeito.
- **164 (Q7):** um evento de auditoria por execucao diaria, so com contagens.
- **165 (Q8):** comecar sem a parte de quarentena (E1), que depende da #141; E2 a E4, E6 e E7 podem seguir; E5 e E8 ficam como bloco pulado ate as tabelas existirem.
- **166 (Q9):** email_outbox entra no expurgo de outbox, se a tabela existir.
- **167 (Q10):** janela de idempotencia de 48 h, a confirmar com os prazos de reentrega dos provedores.
- **168 (Q11):** sessao revogada e' removida apos 30 dias (a revogacao ja fica em audit_event).

## Rodada 44 (Code Review da #43 REPROVADO, ciclo de correcao 1 de 2)
- Achado 1 (foco): h1#titulo e p#confirmado de pedido/revisao.html sem tabindex="-1" (e verificar resumo/titulo-email em pedido.html); corrigir com teste estatico.
- Achado 2 (CA-14 sem evidencia de navegador): **decisao 169 do lider:** o DEV instala Playwright e @axe-core/playwright como devDependency gratuita e entrega os testes T-E essenciais (foco, aria, axe, clique unico, fluxo) para /pedido e /pedido/revisao; o roteiro humano com NVDA continua para a aprovacao. Se o ambiente nao permitir rodar o navegador, registrar como NAO VERIFICADO com o motivo; a infraestrutura serve tambem as proximas telas (#42, #141).
- Achados 3 a 8: integracao /acesso -> /pedido/revisao testada no E2E conforme o desenho (aba original com polling; link em outro dispositivo e' limitacao a registrar); separar describe T-API06 e T-API09; registrar na documentacao de rollback a ordem 190000 antes de 150000; conferir tokens de tamanho de fonte em pedido.css; conferir que a ligacao da rota de revisao na composicao esta commitada.
