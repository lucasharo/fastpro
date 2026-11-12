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
