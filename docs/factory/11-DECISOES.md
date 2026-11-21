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
- **158 (Q-H110-1, juridico/produto):** o detalhe do registro de acesso a fotos (media_access_log) pode ser removido por janela tecnica? Conflito: 09 §7 o classifica como RC-03 (prazo legal, H-109) e 09 §10 manda a remocao no H-110. Recomendacao: (a) rollup agora e remocao do detalhe so quando L1 definir o prazo. Alternativas: (b) remover em 90 dias ja; (c) tirar do escopo. Enquanto nao houver resposta, o desenho segue (a), que e' a opcao conservadora. **Nota (Issue 150, 2026-11-13): substituido pela Rodada 67 (opcao A, autorizada pelo usuario); a tabela e a funcao foram removidas pela migracao 20261113180000.**
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

## Rodada 45 (refino dos documentos de identidade, #50 / H-037 — 106-REFINO-H037.md)
Perguntas ao usuario (numeracao continua), com a recomendacao do lider; o desenho segue a recomendacao ate haver resposta:
- **170 (Q-H037-2, leitura pelo dono):** quem le o documento enviado? Recomendacao (a): ninguem le pela aplicacao; o profissional so ve o estado e pode excluir enquanto nao analisado; a leitura e' da Verificacao (#52). Alternativa (b): o dono le a propria copia por URL curta. A (a) pede corrigir 08 §5 e 09 §8, que davam leitura ao dono.
- **171 (Q-H037-12, producao antes de L1):** recomendacao (a): envio de documentos fechado em producao ate o parecer juridico L1 sobre retencao. Alternativa (b): abrir com retencao sem prazo.
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **172 (Q1):** modelo proprio de documento de profissional (nao reaproveitar media_asset, que e' por rascunho).
- **173 (Q3):** imagem de entrada ate 5 MB.
- **174 (Q4):** PDF ate 2 MB (decisao 35, posterior e mais especifica que a 34).
- **175 (Q5):** ate 5 arquivos vivos por profissional.
- **176 (Q6):** imagem reduzida com as constantes de foto (1.280 px, 750 KB), com inspecao de legibilidade como gate.
- **177 (Q7):** validacao do PDF por cabecalho e tamanho, mais recusa de acao embutida.
- **178 (Q8):** PDF com senha e' recusado.
- **179 (Q9):** envio aceito em pendente, em revisao, retida e recusada; negado em aprovada e suspensa.
- **180 (Q10):** o profissional pode excluir arquivo ainda nao analisado.
- **181 (Q11):** sem criptografia de aplicacao agora: bucket privado e acesso so pela API.
- **182 (Q13):** a #50 depende tambem da #48 (H-035, perfil profissional), ja concluida; dependencia acrescentada ao registro.
- **183 (Q14):** a #50 faz dominio, migracao e servico antes da #141 e so monta a rota depois dela; o envio ponta a ponta espera a #141.
- **184 (Q15):** a leitura positiva pela Verificacao e' da #52; a #50 prova a negacao e define a porta interna de leitura.
- **185 (Q16):** BK-1 considerada respondida pela decisao 35 com limites provisorios; remove-se o bloqueio BLQ-DEC de H-037 no registro.
- **186 (Q17):** textos da interface (§6 do refino) aprovados como estao.
- **187 (Q18):** documento de terceiro enviado pelo profissional: fora de escopo, decide a Verificacao.
- **188 (Q19):** cotas de emissao com os valores de H-026.
- **189 (Q20):** teto global de documentos vivos: valor fixo definido pelo Arquiteto.
- **Fatos do refino a tratar no desenho:** o bucket identity-docs nao existe (a migracao o cria); identity_document e verification_case nao existem; o detector de tipo recusa PDF (precisa de validador de PDF); o redutor de fotos grava sempre em request-photos (nao reaproveitar sem parametrizar: risco R6 com teste obrigatorio).

## Rodada 46 (desenho da composicao da midia, #141 — 104-DESENHO-MIDIA-COMPOSICAO.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **190 (A-141-1):** a midia so liga com `MEDIA_UPLOAD_ENABLED=1`; ausente = fechada em todos os ambientes (falha fechada). A producao da Vercel nao define a variavel.
- **191 (A-141-2):** sem segunda variavel para a galeria (a separacao e' estrutural, pelas portas opcionais).
- **192 (A-141-3):** no cliente so o `accept` do seletor; o servidor decide por conteudo (HEIC e GIF recebem 415).
- **193 (A-141-4):** `"sideEffects": false` em packages/domain/package.json para o bundle nao arrastar o barril.
- **194 (A-141-5):** aprovado esbuild como devDependency gratuita do apps/web (reserva: alternativa C com teste de paridade se o pnpm/check:deps recusar).
- **195 (A-141-6):** sem segunda trava por VERCEL_ENV=production.
- **196 (A-141-7):** conferir a duracao maxima da funcao da API na Vercel contra o prazo de 10 s da reducao; se menor, subir; nao bloqueia o desenvolvimento.
- **197 (A-141-8):** o desenvolvimento da #141 comeca pelo web (esbuild, fotos-envio, portas do navegador, testes) e pelo teste de banco da galeria; `composicao.ts`, `vercel.ts` e `app.ts` (compartilhados com a #43) so sao editados depois que a #43 sair de Desenvolvimento. A #141 nao termina sozinha antes disso.

## Rodada 47 (desenho dos expurgos operacionais, #119 / H-110 — 105-DESENHO-H110.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **198 (Q-A110-1):** valores de TTL ficam no runbook (docs/factory), sem valores na migracao.
- **199 (Q-A110-2):** ajustar CA-H110-10 e RN-H110-04: legal_hold so alcanca dado com vinculo de sujeito (sessao, e-mail, evento de outbox); rascunho, desafio, midia e idempotencia nao tem vinculo.
- **200 (Q-A110-3):** apagar tambem as fotos prontas de rascunho nao publicado (completa a decisao 161).
- **201 (Q-A110-4):** linha de midia pendente expirada e' apagada, como a H-026 ja faz.
- **202 (Q-A110-5):** TTL sem decisao anterior, como [PROPOSTA]: sessao vencida 7 d, provider_event 7 d, outbox_event 7 d, email_outbox 30 d.
- **203 (Q-A110-6):** um evento de auditoria por execucao (nao por dia), so com contagens.
- **204 (Q-A110-7):** pg_cron em producao; disparo manual em desenvolvimento quando a extensao nao existir.
- **205 (Q-A110-8):** sem metrica em ops.ops_metric agora; so auditoria.
- **206 (Q-A110-9):** acumulos fora do escopo (ops.job concluido, notification_item, cooldown, code_lock) viram um cartao E10 no Backlog, a criar no fechamento da #119.
- **207 (Q-A110-10):** manter o auth_challenge_purge da H-011 em paralelo.
- **208 (Q-A110-11):** entrega parcial: E1 (quarentena) e E9 (orfaos) ficam atras de portas, provados so com Storage fake ate a #141; cartao de continuacao a criar no fechamento.
- **209 (Q-A110-12):** janela de idempotencia de 48 h (decisao 167), a confirmar com os provedores.
- **210 (Q-A110-13):** rascunho `publicado` fica fora do expurgo ate existir service_request.
- **Coordenacao de migracoes:** a #119 usa o prefixo 20261112210000; a #50 usara o seguinte (20261112220000 ou maior) e deve reconferir.

## Rodada 48 (fechamento do ciclo de correcao 1 da #43)
- **211 (integracao /acesso -> /pedido/revisao):** conforme o desenho 90 §0.4 e R11, o caminho previsto e' a aba original do pedido em polling indo para a revisao (coberto no E2E, 14 testes Playwright); link aberto em outro dispositivo ou navegador nao leva a revisao e e' limitacao aceita e registrada. O `acesso.js` nao ganha redirecionamento nesta Issue.
- **212 (tokens de tamanho de fonte):** o pacote de tokens do EDS so tem familia e peso; nao ha token de tamanho. Aceitos os literais 16px, 1.5rem e 1.25rem em pedido.css por ora (check:typography nao acusa); a criacao de tokens de tamanho vira divida para a gestao do Design System (cartao a criar no fechamento).
- **E2E:** Playwright e @axe-core/playwright instalados como devDependency de apps/web (Chromium em cache fora do repositorio); 14 testes passam (foco, aria, clique unico, estados, fluxo, axe sem violacoes serias). Pendentes: T-E01 completo (busca de servico e fotos), T-E07, T-E08, T-E10 a T-E12 e T-E13 (NVDA, humano).
- **Arquivos compartilhados com a #141:** apps/web/package.json, .gitignore e pnpm-lock.yaml tem hunks da #43 (Playwright, axe, test:e2e) e da #141 (esbuild, build:fotos-envio). Quem commitar primeiro leva o arquivo inteiro; conferir `git diff` antes e registrar no commit.

## Rodada 49 (desenho dos documentos de identidade, #50 / H-037 — 107-DESENHO-H037.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **213 (D-H037-1):** bucket de entrada proprio `identity-incoming` (5 MiB), alem do final `identity-docs` (2 MiB, JPEG e PDF); a quarentena de fotos NAO e' usada para documentos (a varredura de orfaos da H-026 apagaria o documento).
- **214 (D-H037-2):** CA-03 e CA-04 ("sem linha") passam a valer como "sem linha viva e sem objeto no final".
- **215 (D-H037-3):** enviar documento exige e-mail verificado.
- **216 (D-H037-4):** nao exigir o CPF/CNPJ da H-035 cadastrado antes do arquivo.
- **217 (D-H037-5):** com perfil `recusada`, os documentos ja analisados viram `substituido` no primeiro novo recebido e liberam vaga.
- **218 (D-H037-6):** auditar so as recusas por conteudo, limite ou estado do perfil.
- **219 (D-H037-7):** trava dupla em producao: `IDENTITY_DOCS_ENABLED=1` e, com VERCEL_ENV=production, tambem `IDENTITY_DOCS_L1_PARECER=1` (consistente com a recomendacao da pergunta 171).
- **220 (D-H037-8):** teto global em bytes (250.000.000), nao em contagem (confirma a 189).
- **221 (D-H037-9):** conta sem perfil profissional recebe 404 uniforme.
- **222 (D-H037-10):** guardar `content_sha256`, nunca exposto.
- **223 (D-H037-11):** a reducao no navegador so depois do bundle da #141; antes disso o servidor reduz.
- **224 (D-H037-12):** lista de nomes ativos do PDF sem `/OpenAction` e `/AA`.
- **225 (D-H037-13):** MiB como unidade.
- **226 (D-H037-14):** aprovados o texto novo de recusa por conteudo e o do estado do perfil que nao aceita envio.
- **227 (D-H037-15):** o refino da #52 deve incluir `analyzed_at` na primeira leitura, `attachment` com `nosniff` e `sensitive_access_log`.
- **228 (D-H037-16):** a #50 pode corrigir 08 §5, 09 §3.3/§7/§8 e 14-BACKLOG.
- **Coordenacao de migracoes:** a #119 usa 20261112210000; a #50 usa 20261112220000 (reconferir antes de gravar).
- **Dependencias:** a #50 faz dominio, migracao, adaptadores, servico, rota isolada e pagina nova antes; a montagem em composicao.ts, vercel.ts, app.ts e os barris index.ts fica para o fim, depois da #43 sair de Desenvolvimento e da fase 2 da #141.

## Rodada 50 (conclusoes pelo usuario e fechamento da #43)
- **Autorizacao registrada (2026-11-13):** o usuario moveu a #30 e a #42 para Concluido no quadro.html (acao humana, confirmada no quadro-status.md, Concluido = 54). Antes, a #41, a #49 e a #129 pelo mesmo caminho.
- **#43 QA:** complemento de 375 px feito pelo lider (o QA nao tem ferramenta de escrita): /pedido e /pedido/revisao sem rolagem horizontal (scrollWidth = clientWidth = 375); alvos interativos >= 44 px de altura; todos os alvos de teclado com outline solid 2px; confirmacao alcancada por Tab e acionada por Enter; botao desabilitado durante a chamada; Enter repetido nao duplica (1 chamada de confirmacao). Spec temporario apagado do repositorio. NAO verificado: aria-busy no instante medido (os 14 testes Playwright ja o cobrem), T-E01 completo, T-E07, T-E08, T-E10 a T-E12, NVDA humano, T-API09 (it.todo), integracao em outro dispositivo (211), tokens de fonte (212), Linux/Vercel.

## Rodada 51 (refino da publicacao idempotente, #44 / H-031 — 109-REFINO-H031.md)
Pergunta ao usuario (numeracao continua):
- **239 (Q11, chamada real ao provedor de mapa):** a publicacao exige a coordenada permanente do pedido (uma chamada paga ao Mapbox). Enquanto o dono nao liberar a chamada real (BLQ-EXEC, decisao 116), tudo roda com porta simulada e a publicacao real em desenvolvimento fica fechada. Recomendacao: manter assim ate voce autorizar o uso real do Mapbox (custo e credenciais).
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **229 (Q1):** a confirmacao apos aviso de duplicidade usa token de reconhecimento de 5 min devolvido no 409.
- **230 (Q2):** sessao comum de 7 dias na publicacao, sem step-up.
- **231 (Q3):** o e-mail do rascunho deve ser o e-mail verificado da conta da sessao.
- **232 (Q4):** a modalidade nao e' gravada no pedido; a regra usa o servico e a declaracao do profissional (conferir no desenho).
- **233 (Q5):** a localizacao do pedido e' geocode_point_id (como implementado); atualizar 09 §3.4.
- **234 (Q6):** geocodificacao pendente (202) nao cria estado novo no rascunho.
- **235 (Q7):** o botao "Publicar pedido" fica na tela de revisao, na #44.
- **236 (Q8):** um pedido por rascunho, por coluna origin_draft_id unica no pedido.
- **237 (Q9):** segunda aba com chave diferente recebe o pedido ja criado (200 idempotente).
- **238 (Q10):** colunas de cadeia (is_republication, chain_id, republished_from_id) nulas agora, sem indice.
- **240 (Q12):** limites [PROPOSTA]: 5 publicacoes por hora por cliente e 20 por dia por IP-HMAC; duplicidade 100 m e 24 h (ADR-015); o Arquiteto valida contra 08 §10.2.
- **241 (Q13):** geocodificacao so na publicacao, nao na revisao.
- **242 (Q14):** fotos em processamento bloqueiam a publicacao com 409.
- **243 (Q15):** prazo de 168 h absolutas.
- **244 (Q16):** published_at tambem imutavel.
- **245 (Q17):** mecanismo de distancia da duplicidade (PostGIS ou formula) decidido pelo Arquiteto a partir do spike S-02 (#4, concluido).
- **Dependencia:** a #44 depende da #43 (codigo no HEAD, em Aguardando aprovacao); o Desenvolvimento da #44 comeca quando a #43 estiver concluida ou o usuario a aceitar; PO e Arquitetura avancam.

## Rodada 52 (desenho da publicacao idempotente, #44 / H-031 — 110-DESENHO-H031.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **246 (A1):** rota `POST /v1/requests`.
- **247 (A2):** `draft_id` obrigatorio no corpo (alem de `content_rev`).
- **248 (A3):** sem provedor de geocodificacao a rota responde 503 `publicacao_indisponivel` antes de tocar o banco.
- **249 (A4):** `address_text` em texto puro agora; cifrar na #45.
- **250 (A5):** `origin_draft_id` com `on delete set null`.
- **251 (A6):** assunto do teto de geocodificacao = id do rascunho; a H-082 decide o da cadeia.
- **252 (A7):** coluna `media_asset.request_id` para ligar as fotos ao pedido.
- **253 (A8):** a cota de taxa e' consumida no `begin` (falha de provedor gasta 1 das 5 por hora).
- **254 (A9):** nova variavel `REQUEST_PUBLISH_HMAC_KEY` (minimo 32 caracteres), uma chave com separacao de dominio. O nome entra em `.env.example` sem valor; o valor so no `.env.local` (o DEV pode gerar um valor aleatorio local sem imprimir); em producao a chave e' do dono (TODO 6).
- **255 (A10):** token de duplicidade por HMAC, sem tabela.
- **256 (A11):** repeticao com a mesma chave devolve 201; outra chave no mesmo rascunho devolve 200 com o pedido ja criado.
- **257 (A12):** o cookie do rascunho nao e' limpo apos publicar; a #47 decide.
- **258 (A13):** o DEV verifica se #39/#42 incrementam `content_rev` nas fotos; se faltar, cria `draft_content_touch`.
- **259 (A14):** o DEV confirma o CHECK de `actor_role` da auditoria e usa o papel do cliente conforme o catalogo.
- **Migracao:** `20261113010000_requests_create_service_request.sql` (a #36 precisa de prefixo maior). Decisao 239 mantida: tudo com porta simulada, sem Mapbox real.
- **Coordenacao:** a #44 cria so arquivos novos primeiro (migracao, dominio request/, db request-publish, apps/api/src/requests/*, testes); as edicoes em composicao.ts, app.ts, vercel.ts, barris index.ts e na tela de revisao da #43 ficam por ultimo, em commit proprio, depois da fase 2 da #141 e do registro de handlers da #119.

## Rodada 53 (textos da tela de documentos, #50 / H-037)
- **260 (textos, decisao do lider; o usuario pode vetar):** aprovados para a tela de documentos e a acrescentar em packages/domain/src/identity-docs/textos.ts: "Enviando documento..." (ja aprovado na 107 §6); 403 email_nao_verificado: "Confirme seu e-mail para enviar documentos."; 409 ja_analisado na exclusao: "Este documento ja foi analisado e nao pode ser excluido."; falha ao carregar a lista: "Nao foi possivel carregar seus documentos. Tente de novo."; e os rotulos [PROPOSTA] da 106 §8 (titulos "Documento de identidade", "Enviar documento", "Seus documentos"; botoes "Cancelar envio", "Repetir envio", "Excluir", "Escolher arquivo"; itens "Foto", "PDF", "Documento" e "recebido em dd/mm/aaaa"), com acentuacao correta como nos demais textos. A troca do texto generico por estes entra no ciclo de correcao do Code Review, se o Reviewer pedir.
- **#50 fase 1 concluida pelo DEV** (eefd0fe, 78a2d14, 15356c8, 0da561a): pagina profissional-documentos, 58 testes web, correcoes de 08/09/14. Segue a Code Review como fase 1; a montagem (fase 2) depende da #141 e e' condicao explicita do aceite (decisao 183).

## Rodada 54 (QA da fase 1 da #50)
- **#50 fase 1: QA APROVADO** (banco 24/24, domain 41, adaptadores 27, api 57, web 60, eslint limpo; consulta somente leitura ao DEV: buckets privados com limites 5 MiB e 2 MiB e MIME restrito, app.identity_document com RLS forcada e sem privilegios, 11 funcoes private.idoc_* security definer com execute so para app_system, media_asset sem linhas). Pendencias de evidencia: **T-08/CA-08** (busca estatica sem prazo de retencao para identity-docs) NAO existe como teste, apesar de o desenho 107 §13 dizer que todos os CA tem prova: escrever na fase 2; parciais: T-05 (corrida com 4 vivos), T-14 (falha injetada de audit_append), T-20 (cotas por IP), T-24 (duas finalizacoes), search_path das funcoes, retention_policy do bucket.
- **#50 nao avanca para Aguardando aprovacao ainda:** a fase 2 (montagem, barris, CSP, troca dos tipos espelhados, prova ponta a ponta) e T-08 sao condicao do aceite (decisao 183) e dependem do barril packages/db/src/index.ts (aguardando decisao do usuario). A Issue fica em QA.

## Rodada 55 (Code Review da #141)
- **#141 Code Review APROVADO tecnicamente** (suite da API 832 passam, 3 todo; web 89; dbtest da galeria 6/6; Playwright 14; env ok). Pre-condicoes para LIGAR MEDIA_UPLOAD_ENABLED=1 em producao (nao sao reprovacao): duracao maxima da funcao da API na Vercel (decisao 196) conferida; Storage real, CORS do PUT e coincidencia de host da CSP verificados em navegador; o deploy da web precisa rodar o `build` do apps/web (fotos-envio.js e' gerado e ignorado pelo git). Ajustes: SupabaseReducedPhotoReader (packages/db/src/media-gallery.ts) precisa do mesmo padrao `#serviceKey` e teste de serializacao antes de a galeria ser montada; teste da pendencia 'SITE_URL (invalida)'; nao ha Playwright para /fotos (cobertura estatica e simulada).
- **Condicao para fechar a #141:** galeria ligada na borda (depende do barril packages/db/src/index.ts, decisao do usuario) e CA-09 completo.

## Rodada 56 (QA da #141 e retomada da triagem #140)
- **#141 QA APROVADO para a parte entregue** (fases 1 e 2 parciais): API 55 e 832 passam; web 89; dbtest da galeria 6/6; serializacao 3; Playwright 14 (so do /pedido); bundle 2304 bytes e ignorado pelo git; lock coerente; eslint limpo. Ressalvas: os testes rodaram sobre a arvore de trabalho (ha 7 arquivos modificados por outros trabalhos); comparacao do 404 uniforme cobre status e corpo, nao os cabecalhos (parcial); CA-07 e CA-13 sem check:all; CA-09/CA-10 reais no DEV aguardam a decisao 150. **A #141 fica em QA** ate ligar a galeria na borda (barril packages/db/src/index.ts, decisao do usuario).
- **Retomada da #140** (triagem das 22 falhas do db:test): sem agentes concorrentes no banco DEV agora, entra em Product Owner. A causa do T-DB02 da #43 ja foi corrigida (fixture); confirmar quais das 22 falhas continuam.
- **Estado de espera:** #44 (Desenvolvimento), #119 (Desenvolvimento), #50 e #141 (QA) dependem do barril packages/db/src/index.ts, restauracao pedida ao usuario.

## Rodada 57 (refino da triagem do db:test, #140 — 111-REFINO-TRIAGEM-DBTEST.md)
Pergunta ao usuario (numeracao continua):
- **261 (P-140-1, remocao de linhas de teste residuais no DEV):** recomendacao: autorizar a remocao SOMENTE de linhas com marcador de teste (sintetico), depois de dry-run e com recontagem antes e depois. Sem sua resposta, a #140 nao apaga nada e so classifica.
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **262 (P-140-2):** os dados de demonstracao ficam carregados durante a triagem; remover so se uma falha depender da contagem.
- **263 (P-140-3):** o db:test roda em serie por arquivo (limite de 300 s cada), em segundo plano; registrar qual forma foi usada.
- **264 (P-140-4):** pode-se alterar fixture ou expectativa dentro da #140 so quando uma decisao registrada sustenta a expectativa; bug real vira Issue propria.
- **265 (P-140-5):** a atribuicao das falhas e' por arquivo (nomes de teste se repetem).
- **266 (P-140-7):** a conclusao aceita falhas conhecidas so com Issue de origem aberta; zero e' o alvo.
- **P-140-6 e P-140-8:** ja sao as perguntas 157 (executor de migracoes) e 150 (rotacao de senhas); a triagem usa db:migrate enquanto a 157 nao for respondida e NAO espera a 150.
- **Escopo desta rodada:** F1 a F3 do refino (preparacao, linha de base por arquivo, classificacao): so leitura e execucao de testes; sem apagar dados, sem corrigir codigo, sem migrar. Correcoes seguem em ciclo proprio.

## Rodada 58 (retomada do fluxo continuo, 2026-11-13)
- **#43 Concluido** (WF-03). Autorizacao: o usuario autorizou explicitamente, em 2026-11-11 e de novo na ordem de hoje, concluir as Issues que chegam a Aguardando aprovacao sem consulta previa; evidencias: Rodada 44 a 50 (Code Review reaprovado apos o ciclo de correcao 1; QA com 14 testes Playwright e complemento de 375 px). Pendencias de evidencia ja registradas na Rodada 50 (T-API09 it.todo, NVDA humano etc.) seguem como acompanhamento, nao bloqueiam.
- **Barril e arquivos compartilhados restaurados (decisao do lider, com base na autonomia de 2026-11-11):** a arvore de trabalho tinha 6 arquivos (packages/db/src/index.ts, packages/domain/src/index.ts, packages/domain/src/admin/index.ts, apps/api/src/app.ts, composicao.ts, vercel.ts) com edicoes antigas nao commitadas que removiam as exportacoes de media-gallery e ops-purge-* e reordenavam trechos (gravadas em bloco as 02:30 e 21:25 do dia anterior, sem Issue dona). Foi feito um backup do diff em `scratchpad/deriva-arvore-trabalho-2026-11-13.patch` e os arquivos voltaram ao HEAD (`git checkout --`). Typecheck depois: 16 de 17 pacotes passam; a unica falha e' dos arquivos novos ainda nao commitados da #44 (imports relativos para packages/*, TS6059), a corrigir pelo DEV da #44. Isso resolve o que as Rodadas 53 a 56 aguardavam do usuario.
- **Cadeia #43 -> #44 -> #36 -> #37 mantida:** #36 e #37 ficam em Arquitetura (verde) ate a #44 terminar.
- **Ordem das edicoes compartilhadas (composicao.ts, app.ts, vercel.ts, barris):** #119, depois #141 (fase 2), depois #50 (fase 2), por fim #44. Uma por vez.

## Rodada 59 (Code Review da #119 e fase 2 da #141, 2026-11-13)
- **#119 Code Review APROVADO tecnicamente** (WF-03; dominio 11/11, composicao 6/6; seguranca, grants e search_path conferidos). Achados NAO bloqueantes, a tratar no ciclo de correcao antes do aceite: (1) `ops_purge_media_orfaos` aplica o limite antes de filtrar nome fora do padrao e objeto com linha (risco de starvation; mover o filtro para o SQL, exige migracao nova); (2) `marcados(limite)` pode travar em objeto com falha persistente (`objeto_recusado`); (3) chave do Map de clientes por connection string (usar rotulo fixo); (4) registrar no runbook que o pg_cron enfileira `ops.purge` mas o handler so tem efeito depois de ligado ao tick. check:secrets nos testes H-110 e' falso positivo (cita o NOME service_role); ajustar o verificador ou os testes. Vai para QA; os dbtests H-110 so rodam quando a #140 liberar o banco DEV.
- **#141 fase 2 entregue pelo DEV** (3ddacec, f03fa8c, b0a7469): galeria ligada na borda (so monta com MEDIA_UPLOAD_ENABLED e portas completas; senao 404 uniforme), SupabaseReducedPhotoReader com campos privados, teste estatico de contrato do adaptador. API 865 passam; erros de typecheck restantes sao so os TS6059 da #44. Volta a Code Review (codigo novo). Pendentes para o QA: CA-09 real (dbtest + migracao 20261112190000 no DEV) e CA-10 (depende da decisao 150).
- **Fato novo:** `check:all` esta vermelho no repo (hex 33, secrets 89, logs 10, boundaries 2, typography 2, em arquivos de varias historias) e `packages/db/tests/challenge-consume-wiring.test.ts` falha (espera 200, recebe 503). Nenhum e' da #119/#141. A #130 (gate de release) e a #140 precisam absorver; vou abrir Issue de acompanhamento na proxima sincronizacao com o GitHub.
- **Limite de turnos dos agentes:** os DEVs estouraram 48 turnos duas vezes sem relatorio; passei a pedir commits pequenos e relatorio reservado.
- **#141 Code Review APROVADO** (fase 2; API 7/7, db 12/12). Achados de gravidade baixa a tratar no QA/correcao: comentarios desatualizados em media-composicao.ts (linhas 6-7, 51 e JSDoc solto 86-90), assercao vazia da URL do banco em media-galeria-borda.test.ts (81-87), teste de colunas do contrato comparando com lista manual (media-gallery-contrato.test.ts 79-84). Vai para QA; CA-09 real e CA-10 dependem do banco DEV (#140) e da decisao 150.
- **#50 fase 2 entregue** (81c15f9, 23dea37, 9a55eb8; API 872 passam, typecheck do monorepo 17/17 no momento da revisao) e **Code Review APROVADO tecnicamente**. Achados a tratar antes do aceite: (1) apagar `identity-doc-composicao.ts` e seu teste (duplicado por `identity-doc-montagem.ts`), acrescentando o caso positivo de producao com IDENTITY_DOCS_L1_PARECER=1; (2) mover o bloco de documentos em composicao.ts para fora do comentario da midia; (3) documentar IDENTITY_DOCS_ENABLED e IDENTITY_DOCS_L1_PARECER no .env.example (desligadas). Vai para QA; T-12 (cabecalhos) e parciais T-05/T-14/T-20/T-24 seguem abertos e dependem do banco.
- **#44 Code Review APROVADO com 3 achados importantes** (API 38/38, web 306/306, typecheck 17/17 em cache): (1) regra CA-13 afrouxada demais no teste estatico, (2) erro de publicacao sem regiao viva (role=alert), (3) begin com 'ja_publicado' guarda 201 em vez de 200 (decisao 256). Ciclo de correcao 1 de 2 aberto (nova migracao 20261113120000). Sugestoes 4, 8 e 9 ficam como risco aceito/registrado (D-08, A8).
- **#119 QA APROVADO COM RESSALVAS** (unitarios 11+61+6; dbtest H-110 18/18 no DEV). CA-06 sem prova direta e CA-05, 08, 09, 10, 11, 12, 15 parciais. Como a QA nao recomenda seguir sem CA-06, a #119 volta ao Desenvolvimento no ciclo de correcao 1 de 2 (teste de CA-06/CA-05, achados 1 a 4 do Code Review, nova migracao 20261113130000).
- **#140:** serie completa da rodada 3: 64 arquivos, 670 testes, 654 passam, 4 falham (antes 22), 12 ignorados; restam backup-roles T-BK-09, catalog-service T-H018-13 e draft-rollback-h025 (2). DEV de fechamento em andamento.
- **#140 triagem fechada pelo DEV** (37a666b, 2b8e1f2; secao 12 do doc 112): 64 arquivos, 670 testes, 653 passam, 5 falham, 12 ignorados (antes 22 falhas). Falhas conhecidas com Issue de origem (decisao 266): #145 (media_asset fora do backup; precisa decisao do dono/Arquiteto), #146 (T-H018-13 semente ausente), #147 (rollback H-025 fora de ordem), #148 (URL ficticia com senha em identity-docs-montagem.test.ts, da #50; corrigir no ciclo da #50). Issues #145 a #148 entram no Backlog. Pergunta 261 (apagar residuos) segue sem uso; nada foi apagado.
- **#141 QA REPROVADO nesta rodada** (gate): funcional solido (API 872, db 12, dbtest galeria 18/18 no DEV, web 306, typecheck 17/17 --force; 12 CA reais, 5 parciais, CA-10 sem prova real por depender da decisao 150), mas `check:all` sai com 1. Ciclo de correcao 1 de 2: o DEV da #141 corrige os falsos positivos de hex/secrets nos proprios arquivos (trocar "#141" em comentarios por "Issue 141"), os 3 achados baixos do Code Review e roda os checks de novo. A linha de base vermelha de outras historias vira a Issue #149 (Backlog), nao bloqueia a #141 alem dos arquivos dela; CA-07/CA-13 ficam fechados como risco registrado se so restarem violacoes de outras historias.
- **#119 ciclo de correcao 1 concluido pelo DEV** (1fdf957, d0d40df, e03f4f1; migracao 20261113130000 aplicada no DEV por `db:migrate`; dbtest H-110 26/26, unitarios 65 + 8 + 675, typecheck 17/17 --force). Decisao do lider (a pedido da ressalva 1 do DEV): o CA-06 vale para a selecao do EXPURGO (ready sem marca nao e' removida); a sobra de original do H-026 e' limpeza do H-026 e nao entra no CA-06. Residual aceito e registrado: falha persistente de remocao de sobra de original e de orfao em storage_falha ainda ocupa o topo da fila (sem cursor); tratar em ciclo proprio. Volta a QA.

## Rodada 60 (fechamentos, 2026-11-13)
- **#119 CONCLUIDO** (WF-03). Autorizacao: o usuario autorizou explicitamente (2026-11-11, registrada em memoria da fabrica, e reiterada na ordem de hoje) concluir as Issues que chegam a Aguardando aprovacao sem consulta. Evidencias: Code Review aprovado; QA reteste "com ressalvas": dbtest H-110 26/26 no DEV, domain 11, db 65, api 8, typecheck 17/17 --force; matriz CA-01..16 com CA-06 agora provado. Residuos registrados (nao bloqueiam): Storage real de E1/E9 (A-4 de H-109); CA-04 de API, CA-08 (contrato H-005) e CA-12 (dois processos) parciais; falha persistente de sobra de original/orfao em storage_falha sem cursor; 7 linhas de check:secrets em testes H-110 que apenas citam o NOME service_role (falso positivo, Issue #149). Alerta: a CLI do Supabase rotulou o projeto vinculado (fastpro-dev) como "production"; conferir antes de qualquer db:migrate fora do runner do repo.
- **#141 em Aguardando aprovacao (NAO concluida):** ciclo de correcao 1 entregue (24ddaff, ca65d96, 4746636, b483937; API 879, db 15, web 310, typecheck 17/17; hex e secrets limpos nos arquivos da Issue). Falta prova real do CA-10 (ponta a ponta no DEV), que depende da decisao 150 (rotacao de senhas do DEV), pergunta ainda sem resposta do usuario. Por isso fica aguardando, nao conclui sozinha. MEDIA_UPLOAD_ENABLED segue desligada em producao (decisao 151). O DEV tambem pede decidir se a leitura do Storage fica em apps/api/src/media ou modules/media (Issue #149).
- **#44 e #50 em QA** apos re-revisao aprovada (44: 39/39 api, 310 web, dbtest 12/12 no DEV, typecheck 17/17; 50: 66 testes api da area, typecheck 17/17, #148 resolvida).
- **#44 QA COM RESSALVAS, devolvida ao Desenvolvimento (ciclo de correcao 2 de 2):** passou 12/12 no banco, API 39, web 310, Playwright 14, typecheck 17/17; faltam provas diretas: concorrencia (T-DB07: 20 conexoes), atomicidade com falha forcada (T-DB09), limite de 20/dia por IP, e recomendados T-DB03, T-DB13, T-DB14, T-DB16 e teste de navegador do botao. Pelo precedente da #119 (QA nao recomenda seguir sem prova direta da concorrencia).
- **#50 QA COM RESSALVAS, devolvida ao Desenvolvimento (ciclo de correcao 2 de 2) pelo mesmo criterio:** banco 24/24, API 879, domain 41, web 310, typecheck 17/17; consulta somente leitura ao DEV confirmou search_path vazio nas 11 funcoes, buckets privados 2 MiB, 0 politicas em storage.objects, retention_policy sem classe ligada a identity-docs. Faltam: concorrencia real com duas conexoes (limite de 5 vivos, teto, finalizacao T-05/T-20/T-24), falha de auditoria desfazendo a acao (T-14/CA-14), conferencia do registro de versao da migracao >= 20261112200000, ajuste de 107 §5 (~23 profissionais em MiB). CA-15 (legibilidade), Storage real e leitor de tela ficam como gates de liberacao em producao (107 §9), nao desta Issue.
- **#140 Code Review APROVADO** (achado importante: prova de vazamento do demo-guard ficou vacua apos bf2147d; corrigida em d20f38b; #148 corrigida e a fechar).
- **#141 CONCLUIDA pelo usuario** (acao humana confirmada no quadro-status.md: Aguardando aprovacao = 0, Concluido = 57). Pendencias de evidencia que seguem como acompanhamento: CA-10 ponta a ponta no DEV (decisao 150) e pre-condicoes de producao da Rodada 55.
- **#58 em Product Owner** (puxada do Backlog: depende so de H-005 e H-017, concluidas; independente das Issues em andamento). **#148 fechada** pelo lider (corrigida em 41519f5); **#140** corrigida (d20f38b, 2d4dee3) e em QA.

## Rodada 61 (refino do acesso comercial derivado, #58 / H-045 — 113-REFINO-H045.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **267:** em `T1 + 72 h` exatos o estado e' `expirada` (convencao "prazo expirado" da 08 §6); B-01 perde o "inclusive".
- **268:** trial de 14 dias corridos (`ends_at = starts_at + 14 dias`).
- **269:** o acesso pago prevalece sobre o trial quando coexistem (inclusive em carencia).
- **270:** tabela `subscription` minima em H-045 com `cancel_at_period_end` e `canceled_at`, para cumprir os oito estados.
- **271:** NAO criar `grace_until` em `access_grant`; carencia derivada, uma unica fonte de verdade.
- **272:** o CHECK aceita `adjustment`, mas a funcao ignora `adjustment` e `revogada` ate a decisao L3 ([PROPOSTA]).
- **273:** unicidade do trial por `identity_id` redundante, como a 09 define; confirmar com H-040.
- **274:** `commercial_access` NAO verifica aprovacao do profissional (a guarda e' de H-042/H-044).
- **275:** livro imutavel: `starts_at` e `ends_at` fixos; `status` so de `ativa` para `revogada`, por sistema/Financeiro com auditoria; sem DELETE pela aplicacao.
- **276:** nao sobreposicao de concessoes pagas por restricao de exclusao (`btree_gist`) se disponivel no DEV; senao trigger (Arquiteto confirma).
- **277:** `commercial_access` executavel so pelo papel de aplicacao do servidor; leitura direta de `access_grant` negada a `anon` e `authenticated`.
- **278 (onda):** opcao (b): H-045 entra agora porque depende so de H-005 e H-017 (concluidas) e nao consome verificacao; excecao registrada no backlog.
- **#58 avanca de Product Owner para Arquitetura.**
- **#50 ciclo de correcao 2 entregue** (db255bf, 0e4839a): concorrencia real com conexoes separadas (T-05, T-20, T-24), falha injetada em audit_append desfazendo a acao (T-14), desenho 107 §5 corrigido (~23 profissionais). dbtest 28/28; api identity-docs 68; typecheck 17/17. `db:status`: 67 aplicadas, 0 pendentes para a #50. Volta a QA.
- **Efeito colateral aceito (decisao do lider):** os testes concorrentes deixaram no DEV 18 eventos de auditoria `identity.doc.*` (15 refused, 3 received) de perfis sinteticos ja removidos; a auditoria e' append-only e nao se apaga. Como consequencia o caminho "sem dados" do rollback T-21 nao roda mais no DEV (o teste agora exige a recusa por `audit_event_action_fk`). Conferido por leitura: os gatilhos `tg_block_mutation`, `tg_block_truncate` e `tg_event_seal` de audit.audit_event estao habilitados (`A`) e nao ha sessao aberta em transacao; a sessao `fastpro-db-tools` vista pelo DEV era transitoria de teste.
- **Checksum da migracao 20261113140000 (#44) reconciliado no DEV:** o arquivo foi editado (cabecalho) depois de aplicado e o `db:status` denunciava. O lider reexecutou o proprio SQL do arquivo (idempotente, `create or replace`) e atualizou o checksum em ops.schema_migration por script no scratchpad; `db:status` voltou a 67 aplicadas, 0 pendentes, sem problema. Regra reforcada: nunca editar migracao ja aplicada.
- **#140 QA REPROVADO nesta rodada (pausada, sem bloquear):** as falhas conhecidas #145, #146 e #147 estao corretas e demo-guard 28/28, mas `audit.dbtest.mjs` falhou diferente em cada rodada (T-05 deadlock 40P01, T-07 last_seq com 7 a mais, T-02 seq/hash), compativel com outras sessoes escrevendo em audit_event no DEV (inclusive os testes concorrentes da #50). Sem exclusividade do DEV nao ha evidencia valida. Decisao do lider: a #140 volta ao Desenvolvimento e fica PAUSADA ate haver uma janela sem outro agente usando o banco; nessa janela: (1) rodar audit.dbtest.mjs tres vezes em serie, (2) contagem antes/depois, (3) serie completa dos 64 arquivos depois dos ultimos commits, (4) corrigir a contagem da entrada anterior (o numero final e' o da serie). Se audit continuar falhando em janela exclusiva, abrir Issue de origem (#19).

## Rodada 62 (desenho do acesso comercial derivado, #58 / H-045 — 114-DESENHO-H045.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar):
- **279:** EXECUTE de `commercial_access` para `app_api` e `app_system`.
- **280:** `subscription` com `unique(professional_id)`.
- **281:** H-049 (#62) e H-052 (#65) zeram `cancel_at_period_end` ao reassinar; registrar nas duas Issues.
- **282:** `app_system` so com SELECT agora; INSERT/UPDATE chegam com os escritores.
- **283:** `access_until` nulo em `expirada`, `trial_expirado` e `sem_acesso`.
- **284:** a criacao de concessoes e' auditada pelos escritores (H-044, H-049); H-045 audita so a revogacao e nao cria outbox.
- **285:** colunas alem da 09 §3.10 (`revoked_at`, `created_at`, `mode`); atualizar a 09.
- **286:** linha revogada ignorada para qualquer `at` (a revogacao retroage).
- **287:** `paid` exige `source_payment_id`, sem FK ate H-047.
- **288:** CHECK exato de 336 h para o trial.
- **289:** origem de `identity_id` fornecida pela H-044.
- **#58 avanca de Arquitetura para Desenvolvimento.** Migracao `20261113170000_billing_create_access_grant.sql` (confira o prefixo contra `ls supabase/migrations`).

## Rodada 63 (ciclo 2 de #44 e #50, 2026-11-13)
- **#44 ciclo de correcao 2 entregue** (4595059, 4cd413e; migracao 20261113150000 aplicada). Bug real achado e corrigido: o teto de 30 dias do rascunho nao era aplicado na publicacao (T-DB13). Novas provas: T-DB03, T-DB07a/b/c (20 conexoes), T-DB09, T-DB12b, T-DB13, T-DB14, T-DB16. Ultima rodada: 20 de 21 (T-DB02 com deadlock/lock timeout sob contencao de outra sessao; T-DB02 isolado passa). Riscos registrados: deadlock sob contencao nao explicado; `rl_check`/`rl_hit` nao atomicos entre rascunhos distintos do mesmo usuario/IP (pode passar acima de 5/h ou 20/dia sob corrida: virar correcao em ciclo proprio/Backlog); teste de navegador do botao nao feito. Os dois ciclos de correcao de codigo da #44 estao esgotados: a Issue vai para QA e a QA decide, sem novo ciclo sem decisao.
- **#50 QA (reteste) COM RESSALVAS -> Aguardando aprovacao (nao concluida):** 12 CA reais, 7 parciais, 1 nao verificado (CA-15, gate de producao). Concorrencia real (CA-05, T-20, T-24) e falha de auditoria (CA-14, T-14) agora reais. Unica ressalva que pode mudar o veredito: 1 de 3 execucoes da suite de concorrencia falhou (27/28) sem identificar o teste, provavelmente contencao com outras sessoes no DEV. Por isso nao concluo sozinha: sera reexecutada na janela exclusiva do DEV.
- **Janela exclusiva do DEV (decisao do lider):** quando o #58 terminar o desenvolvimento, nenhum outro agente usa o banco; uma unica QA roda em serie: audit (3x), request-publish-h031, identity-docs-h037 (3x), commercial-access e a serie completa dos 64 arquivos, com contagem antes/depois. Esse resultado fecha #140, #44 e #50.

## Rodada 64 (Code Review da #58 e refinos de #59 e #51, 2026-11-13)
- **#58 Code Review APROVADO** (domain 8, db 14, typecheck 17/17 --force; so sugestoes: cabecalho do rollback sobre o catalogo de auditoria, validar Date no adaptador, T-14 sem privilegios TRUNCATE/REFERENCES/TRIGGER; a normalizacao CRLF->LF em 3 linhas de packages/domain/src/index.ts e' correta por .gitattributes). T-09 (concorrencia de duas conexoes) aceito como parcial por desenho (a restricao gist serializa). Vai para QA, que roda na janela exclusiva do DEV (serie rodada 4 em andamento).
- **#59 refinada** (115-REFINO-H046.md, perguntas 290 a 299). Adotadas como RECOMENDADAS (o usuario pode vetar): 290 (Desenvolvimento so depois da #58 chegar a Aguardando aprovacao/concluida), 291 (H-046 cria plan/plan_price; plan_id em H-047), 292 (sem campo de promocao agora), 293 (preco gravado no pagamento; prazo de aviso ao cliente e' decisao do dono), 294 (um preco vigente por plano, restricao de exclusao), 295 (migracao de referencia idempotente), 296 (sem tabela de beneficios), 297 (tela de planos em H-047), 299 (S-03 continua bloqueando H-047, nao H-046). **298 (executor de migracoes: decisao 157 + conferir o projeto vinculado da CLI, que se rotulou "production") fica ABERTA para o dono**; nao bloqueia, pois o runner do repo (`db:migrate`) segue em uso. #59 avanca para Arquitetura (so documento; Desenvolvimento aguarda a #58).
- **#51 refinada** (116-REFINO-H038.md, 16 CA, perguntas 300 a 319): permanece em Product Owner (verde). Desenvolvimento NAO pode comecar sozinho: depende da #50 (ainda sem aceite) e da fila de verificacao (#52). As perguntas 300 a 319 incluem pontos juridicos (lista REG, L4/BLQ-JUR) e o conflito de `certification` como dono de media_asset (310); o lider as consolida na proxima rodada.

## Rodada 65 (resultado da serie exclusiva do DEV, rodada 4, 2026-11-13 11:42)
- **Serie rodada 4 terminou** (65 arquivos, 709 testes, 687 passam, 10 falham, 12 ignorados; saida em scratchpad\dbtest-baseline\rodada4\resumo.tsv). Falhas conhecidas: backup-roles T-BK-09 (#145), draft-rollback D-10 testes 2 e 3 (#147). Falhas NOVAS, todas por consequencia de dados e funcoes novas, nao por instabilidade:
  - audit D-02b: `private.commercial_access` (#58, decisao 279) agora e' executavel por app_api e a lista fechada do teste nao a inclui. Atualizar a lista da D-02b (fixture/expectativa sustentada pela decisao 279 e 114 §6). Dono: #140/#58.
  - audit T-02 (seq consecutivo, encadeamento, paridade de hash): falha tambem em janela sem outros agentes; provavel efeito dos eventos de auditoria gravados de verdade pelos testes concorrentes de #44/#50 (append-only). Investigar; se for defeito real da verificacao, abrir Issue de origem (#19). Dono: #140.
  - catalog-service T-H018-11, T-H018-12 (alem do T-H018-13 ja conhecido, #146): servicos e grupos sinteticos com marcador, que os testes concorrentes da #44 deixaram no catalogo do DEV (o esquema nao deixa apagar: FK de pedidos). Os testes de catalogo precisam contar so a semente (seed_key) ou o DEV precisa de limpeza autorizada (pergunta 261). Dono: #140/#44.
  - request-publish-h031 T-DB05 e T-DB06: assercoes globais "nenhum pedido" (esperado 0, obtido 3) quebradas pelos 3 pedidos sinteticos remanescentes de rodadas anteriores. Reescrever para contar so as linhas do proprio teste (marcador). Dono: #44.
- **Consequencia para o fluxo:** #44 e #140 NAO fecham ainda. #58 e #50: comparar com a serie (commercial-access e identity-docs-h037 passaram nesta serie: nenhuma falha listada para eles). Regra nova: testes de concorrencia que gravam de verdade devem usar marcador unico e as demais suites devem contar so por marcador; preferir transacao desfeita sempre que a concorrencia nao for o objeto da prova.

## Rodada 66 (decisao do usuario sobre a pergunta 239, 2026-11-13)
- **239 (Mapbox real no desenvolvimento) — AUTORIZADA PELO USUARIO:** pode-se usar o Mapbox de verdade no ambiente de DESENVOLVIMENTO, com a chave que ja esta no `.env.local`, sem consultar de novo. Isso substitui a decisao anterior de manter tudo com porta simulada ate o dono liberar (BLQ-EXEC, decisao 116) apenas para o ambiente de desenvolvimento; producao continua sem uso real sem autorizacao propria. Cobranca real continua fora. A chave nunca vai a chat, log ou arquivo versionado.
- **Escopo desta mensagem:** nada alem disso. A rotacao de senhas (pergunta 150) e a limpeza de registros de teste (pergunta 261) CONTINUAM aguardando a confirmacao do usuario; nada foi feito sobre elas.
- **#44 volta a Desenvolvimento** para ligar o provedor real de geocodificacao a publicacao (POST /v1/requests) no desenvolvimento e provar a publicacao real do pedido, alem de corrigir os testes T-DB05 e T-DB06 para contarem so as linhas do proprio teste. Isto e' mudanca de escopo pela decisao do usuario, nao um terceiro ciclo de correcao de codigo.

## Rodada 67 (decisao do usuario sobre a pergunta 158, 2026-11-13)
- **158 (historico de acesso as fotos) — AUTORIZADA PELO USUARIO, opcao A:** remover por completo o historico de acesso as fotos (`media_access_log`) e o resumo diario dele (`ops.media_access_daily`). O usuario nao pediu esse historico e ele consome o banco. **Substitui RF-030 e o criterio de aceite do D10** no que exigem log de acesso. Escopo: nova Issue **#150** (Backlog -> Product Owner); remover referencias no codigo, nos documentos (04, 05, 08, 09, 103, 108, 14-BACKLOG) e nos testes; nova migracao que remove a tabela do historico e a de resumo, se existirem no DEV, pelo executor oficial (`db:migrate`) ou `npx supabase`, SEM editar migracao antiga; nenhum outro dado apagado e nenhuma senha rotacionada. A #150 segue a ordem completa de colunas, um especialista por vez.
- **Impacto conhecido:** as Issues #69 e #70 (fotos a elegiveis com marca d'agua; limite de visualizacao e sinal de raspagem) dependiam do historico; o refino da #150 define a protecao contra raspagem sem historico de acesso ([PROPOSTA] do PO, decisao do lider depois). Tambem afeta o bloco de rollup da migracao de expurgos da #119 e o teste CA-16 dela.

## Rodada 68 (refino da #150 — 117-REFINO-REMOCAO-HISTORICO-ACESSO.md)
Fato verificado pelo PO: `ops.media_access_log` nunca foi criada em migracao (o bloco E8 do expurgo sempre devolveu `pulado_ausente`); `ops.media_access_daily` foi criada pela migracao 20261112230000 (aplicada no DEV) e deve estar vazia (contagem real a registrar antes de remover). Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar), todas a opcao (a):
- **320:** protecao contra raspagem sem historico: URL de 60 s de uso unico, marca d'agua opaca do profissional, contador de visualizacoes por profissional em `rate_counter`, sinal em `abuse_signal` so quando o limite estoura. Perde-se: quem viu qual foto e quando, prova por registro e deteccao de padrao alem da janela.
- **321:** sinal registrado so no estouro, sem gravar cada acesso.
- **322:** suspensao cautelar so do acesso a fotos (nao banir a conta).
- **323:** NAO reabrir a #119 (Concluida); a #150 faz a remocao (bloco E8 e CA-H110-09; CA-H110-16 permanece para provider_event).
- **324:** manter E9 e a auditoria como estao.
- **325:** as chaves de configuracao do recurso removido saem na mesma migracao nova e voltam no rollback.
- **326:** rollback no padrao do projeto, sem copiar codigo antigo.
- **327:** remover `ops.media_access_daily` da lista de excecoes do backup (T-BK-09); a #145 segue com `app.media_asset`.
- **328 (juridico, RC-07):** registrado para o usuario confirmar no pedido de L1; NAO bloqueia a #150.
- **#150 avanca de Product Owner para Arquitetura.** #69 pode seguir sem log; #70 depende da protecao definida na #150.

## Rodada 69 (desenho da #150 e resultado do Mapbox real na #44)
- **#150 desenho (118-DESENHO-REMOCAO-HISTORICO-ACESSO.md):** a orquestracao E1..E9 e' em TypeScript; no banco so cai `private.ops_purge_media_access` e a tabela `ops.media_access_daily`; nova migracao `20261113180000_ops_remove_media_access_history.sql` (+ rollback), sem editar migracoes antigas. Adotadas como RECOMENDADAS pelo lider: **329** emitir 33 chaves e nao mexer no catalogo de 37 da auditoria (o banco aceita subconjunto; esclarece a 324); **330** rollback reinsere so `rollup` = 86400; **331** os CA-H150-09..12 (contador, sinal, suspensao, URL de 60 s) passam a ser entregas da #70 e #69, e a #150 fica com prova negativa e documental; **332** a #69 so vai a producao junto com a #70. **#150 avanca para Desenvolvimento.**
- **#44 — Mapbox real no DEV (autorizado, decisao 239):** codigo entregue (3caa1f6, 4eee211): provedor real so com chave no ambiente e APP_ENV de desenvolvimento/teste; sem isso 503. dbtest H-031 21/21 (T-DB05 e T-DB06 corrigidos), tipos 17/17, API 879. **A PROVA REAL NAO FECHOU:** a Mapbox respondeu HTTP 429 (limite de taxa, softRateLimit) na chamada permanente; foram gastas 3 chamadas (cota 9 para 12, teto autorizado do DEV atingido), nenhum pedido novo foi criado. Hipotese nao confirmada: o modo permanente exige cartao/contrato ou ha limite da conta/token; conferir no painel da Mapbox. Falha do DEV registrada: o script repetiu a publicacao sem checar o status da primeira e gastou uma chamada. Os tetos `MAPBOX_PERMANENT_SOFT_LIMIT` e `HARD_LIMIT` nao estao no `.env.local`; o provedor so liga com eles (usados 1000000/2000000 so em variavel de processo). Nenhuma nova tentativa sem conferir a conta. #44 vai para Code Review (codigo) com a prova real PENDENTE.
- Linhas sinteticas ainda no DEV (nao apagadas; pergunta 261): +2 usuarios, 2 grupos, 2 servicos e 2 rascunhos desta prova; no total 15 usuarios @example.test, 11 servicos H031, 5 rascunhos.
- **#44 Code Review REPROVADO (codigo novo do Mapbox real):** achado importante: a condicao de ambiente que protege a producao (`provedorMapboxDesenvolvimento` / `montarPublicacaoPedido`) nao tem teste unitario. Nao ha vazamento de chave nem violacao de teto. Correcao pedida: `apps/api/tests/publish-composicao.test.ts` com os casos liga/nao liga. Decisao do lider sobre a sugestao 2: exigir tambem `VERCEL_ENV` ausente ou `development` (mais estrito; preview e producao nunca ligam o provedor real) e importar `MAPBOX_TOKEN_ENV` de um unico lugar. Volta a Desenvolvimento (correcao 1 do codigo novo).
- **#44 re-revisao APROVADA** (2b7cacd, 79a6c5a, b6545eb, e1c70fa): 23 testes novos da condicao de ambiente, API 902 passam, `check:env` verde (63 nomes). Vai para QA (verde), que depende da janela exclusiva do DEV. Prova real da publicacao com o Mapbox segue PENDENTE (429 na conta/token): so refazer apos conferir o painel da Mapbox e gravar `MAPBOX_PERMANENT_SOFT_LIMIT`/`HARD_LIMIT` no `.env.local`. Nenhuma nova chamada sem essa conferencia.

## Rodada 70 (parada por limite de uso, 2026-11-13 ~13:05)
- O limite de 5 horas de uso do servico de IA foi atingido (volta as 14h, horario de Brasilia); o Code Review da #150 foi interrompido por isso, sem relatorio. Nenhum agente esta ativo. Estado a retomar: **#150** em Code Review (refazer a revisao; DEV entregou 6f6220a, 680e86e, ee62174, 34b01dd; migracao 20261113180000 aplicada no DEV, `db:status` 70 aplicadas, 0 pendentes); **#44** em QA (prova real do Mapbox pendente por 429; so refazer apos conferir a conta); **#58** em QA; **#140** em Desenvolvimento (pausada, falhas novas por dados sinteticos: D-02b da auditoria precisa incluir `commercial_access`, T-02 da auditoria, catalog-service T-H018-11/12); **#50** em Aguardando aprovacao; **#59** e **#150** conforme o quadro; **#36**, **#37** em Arquitetura aguardando a #44; **#51** em Product Owner. Ordem sugerida na retomada: Code Review da #150, depois a janela exclusiva do DEV (serie completa, sem outros agentes) para fechar #140, #44, #58 e reavaliar #50.

## Rodada 71 (nova politica agy e retomada, 2026-11-13)
- **Politica AGENTS.md "Revisor e QA via Antigravity (agy)":** Code Review e QA passam a rodar por `node D:/Fabrica/scripts/agy-agente.mjs --papel factory-reviewer|factory-qa --tarefa <arquivo.md> --repo D:/projetos/fastpro`, e o lider confere a saida e o codigo de saida antes de aceitar o veredito. Aplicado ja ao Code Review da #150 (tarefa e saida em scratchpad\agy) e ao QA da #58. Se o agy ficar indisponivel, o bloqueio e' registrado na Issue.
- **#128 puxada do Backlog para Product Owner** (teste de restauracao de backup; independente das Issues em andamento).
- **#150 Code Review via agy APROVADO TECNICAMENTE** (saida: scratchpad\agy\saida-150-review.txt, codigo de saida 0 conferido; domain 11, db 78, typecheck 17/17 --force; sem dbtests). Achados: sugestao de nota na linha 11 deste arquivo (D10) e registro das contagens antes/depois da migracao (CA-H150-04) a fazer na QA. Nota sobre D10 (linha 11): substituido quanto ao log de acesso pela Rodada 67 e Issue 150. Vai para QA.
- **#128 refinada** (119-REFINO-H119.md, CA-H119-01..17, perguntas 333 a 342): permanece em Product Owner (verde). Dependencia declarada #126 (suite de concorrencia, Backlog) trata-se como bloqueio de inicio do Desenvolvimento (338) e a #145 bloqueia parcialmente; o lider adota as recomendacoes do PO nas demais (333 a 337, 339 a 342) e o usuario pode vetar.
- **#58 CONCLUIDA** (WF-03). QA via agy (saida em scratchpad\agy\saida-58-qa.txt, codigo de saida 0 conferido): APROVADO COM RESSALVAS; dbtest 18/18 no DEV, domain/db unitarios 22, tipos 17/17; B-01..B-08 reais exceto B-05/B-06 parciais por desenho (H-047/H-048) e T-09 (concorrencia de duas conexoes) parcial por desenho. Autorizacao: o usuario autorizou explicitamente concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13). Sugestoes do Code Review ficam como acompanhamento. Desbloqueia a #59 (Desenvolvimento).

## Rodada 72 (desenho de planos e precos, #59 / H-046 — 120-DESENHO-H046.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **343** omitir `active` em `plan`; **344** CA-H046-02 reescrito: a recusa de preco fracionario e' provada por parametro de texto (erro 22P02) e no dominio, porque o Postgres arredonda o literal 29.90 para 30 em coluna inteira; **345** EXECUTE da funcao para `app_api` e `app_system`, tabelas so para `app_system` (como a 279); **346** `valid_from` constante 2026-01-01Z na carga e troca de preco so por migracao revisada ate a tela admin (RF-153); **347** H-046 nao cria `subscription.plan_id` nem FK de pagamento (decisao 291); **348** uma unica funcao `private.plan_price_at` com filtro opcional. Lembrete do desenho: incluir a funcao nova na lista D-02b de `audit.dbtest.mjs`. **#59 avanca para Desenvolvimento** (a #58 esta concluida).
- **#140 correcoes entregues** (a54c75e D-02b com commercial_access; 61877cd catalogo conta so a semente; 4052ebd T-02 ordena por coluna `seq`, nao pelo alias texto). A causa do T-02 era defeito do proprio teste (ordem textual 1,10,11,...,2), nao contencao nem defeito do verificador: reproduz sempre com 10 ou mais linhas; nenhuma Issue de origem necessaria. audit 27 testes, 25 passam, 2 ignorados (AUDIT_ALLOW_COMMIT) em tres rodadas em serie; catalog-service 12 de 13 (T-H018-13 = Issue 146). Volta a QA via agy.
- **#150 CONCLUIDA** (WF-03). QA via agy (saida em scratchpad\agy\saida-150-qa.txt, codigo de saida 0 conferido): APROVADO COM RESSALVAS. Evidencias: `db:status` 70 aplicadas, 0 pendentes; `ops.media_access_daily` tinha 0 linhas antes de ser removida e as 49 tabelas de app, audit e ops mantiveram as mesmas contagens; funcao e chaves `purge.media_access_*` ausentes; migracoes antigas inalteradas; backup-roles so com a falha conhecida `app.media_asset` (#145). Ressalva: `CA-H110-08` do dbtest de expurgos falhou (27 !== 1) por 26 chaves de idempotencia sinteticas remanescentes dos testes da #44 (contagem global); nao tem relacao com a remocao e entra no mesmo trabalho de teste da #140 (contar so as linhas do proprio teste). Autorizacao: conclusao autorizada de forma permanente pelo usuario (2026-11-11, reiterada em 2026-11-13); a decisao 158 (opcao A) e' do proprio usuario. CA-H150-09 a 12 foram movidos para #69 e #70 (decisao 331).
- **#50 CONCLUIDA pelo usuario** (acao humana confirmada no quadro-status.md, Concluido = 60, Aguardando aprovacao = 0). A ressalva da falha intermitente da suite de concorrencia e as pendencias de producao (CA-15, Storage real, navegador/leitor de tela, 107 §9) seguem como acompanhamento.
- **#59 em Code Review via agy** (DEV: a9a659e, 5f09ef6, dde4e45, e3f5960, af03300; dbtest 12/12, domain 12, db 34, tipos 17/17; migracao 20261113190000 aplicada, `db:status` 71 aplicadas, 0 pendentes). Atualizar 09-MODELO-DADOS e 14-BACKLOG (desenho §4) e confirmar se `backup.test.mjs` (5 timeouts) e `challenge-consume-wiring.test.ts` ja falhavam antes.
- **#44 QA via agy: APROVADO COM RESSALVAS** (saida em scratchpad\agy\saida-44-qa.txt, codigo de saida 0 conferido): dbtest H-031 21/21, geo-match-point 27/27, API 62, web 310, tipos 17/17, check:env ok. Ressalvas: prova real do Mapbox PENDENTE (HTTP 429 da conta), teste de navegador/leitor de tela, contadores de taxa nao atomicos entre rascunhos distintos (candidato a Issue propria) e contencao/deadlock em rajadas de 20 conexoes. **#44 vai para Aguardando aprovacao e NAO e concluida pelo lider**, porque a publicacao real no desenvolvimento (pedida pelo usuario) ainda nao foi provada e depende da conta da Mapbox. Libera #36 e #37 para a Arquitetura/Desenvolvimento apos a decisao do usuario.

## Rodada 73 (decisao do usuario: backup fora do escopo, 2026-11-13)
- **BACKUP DE DADOS FORA DO PROJETO — AUTORIZADA PELO USUARIO:** backup de dados nao faz parte do projeto, em nenhum ambiente, porque nunca foi discutido. Nova Issue **#151** (Backlog -> Product Owner), com a ordem completa de colunas e um especialista por vez, retira de 14-BACKLOG, 12-TODO, 08 (§17 e §16.7), 09 (RC-11, §9), 10-ADRS (ADR-020 e SD-17), 11-ARQ-RISCOS-E-TESTES (R-08, R-17, R-32, D-01) e 17-CHECKLIST as referencias a backup, restauracao e exportacao. As Issues **#128** (teste de restauracao) e **#145** (media_asset fora do backup) foram **fechadas como removidas do escopo (not planned), sem concluir nada** e movidas para Descartado no quadro local. Restricoes desta etapa: nao apagar dados, nao criar nem alterar tabelas, nao rodar nada contra o banco; o que ja existe em codigo/scripts/migracoes/testes de backup (backup.mjs, papel app_backup_reader, backup-roles.dbtest, T-BK-09) NAO e' tocado agora; o refino da #151 faz o inventario e a remocao desse codigo fica para decisao do usuario. A falha T-BK-09 (antes #145) deixa de ser "falha conhecida com Issue" e passa a depender dessa decisao. As perguntas 333 a 342 (refino da #128) ficam sem efeito.
- **Parada do Mapbox continua valendo** (instrucao urgente do usuario): nenhuma chamada ao provedor real, nenhum teste/serie/QA/publicacao que o chame, nenhuma alteracao do `.env.local`.

## Rodada 74 (decisoes do usuario sobre Mapbox e fechamentos, 2026-11-13)
- **MAPBOX REAL PROIBIDO — AUTORIZADA PELO USUARIO (substitui a decisao 239 e a Rodada 66):** as duas chaves (`MAPBOX_PUBLIC_TOKEN` e `MAPBOX_ACCESS_TOKEN`) foram removidas do `.env.local`. Nenhum teste, prova ou rota usa o Mapbox real; so provedores simulados. Sem a chave, a rota de publicacao responde 503 `publicacao_indisponivel` em qualquer ambiente (o provedor real da #44 so liga com chave); os testes injetam provedor simulado. A cota `mapbox_permanent` ficou em used = 12.
- **#44 CONCLUIDA** (WF-03), por instrucao explicita do usuario: fechar com o teste simulado. QA via agy (APROVADO COM RESSALVAS, saida 0): dbtest H-031 21/21, geo-match-point 27/27, API 62, web 310, tipos 17/17, check:env ok. **Pendencia registrada, sem nova tarefa: a prova real de publicacao com Mapbox fica para depois da producao.** Outras ressalvas (acompanhamento): teste de navegador/leitor de tela e contadores de taxa nao atomicos entre rascunhos distintos.
- **#59 Code Review via agy APROVADO TECNICAMENTE** (saida 0 conferida; criterios CA-H046-01..14 atendidos). Achado importante: atualizar 09-MODELO-DADOS §3.10 e 14-BACKLOG (status de H-046), a fazer DEPOIS do Desenvolvimento da #151 (que edita os mesmos documentos) para nao haver conflito. Vai para QA (via agy) sem Mapbox.
- **#140 QA via agy: APROVADO COM RESSALVAS** (saida 0 conferida): D-02b, T-H018-11/12 e T-02 resolvidos; ressalvas: serie completa de 65 arquivos so em janela exclusiva (nao rodada) e T-BK-09 ficou sem Issue de origem porque a #145 foi removida do escopo. Vai para **Aguardando aprovacao, nao concluida** (a meta da decisao 266 depende da decisao do usuario sobre o codigo de backup).
- **Desenvolvimento segue so com a documentacao** (instrucao do usuario): sem chamadas externas reais.

## Rodada 75 (refino da #151 — 121-REFINO-REMOCAO-BACKUP.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **349** a #151 remove backup e exportacao de COPIA do banco; os direitos do titular (acesso, correcao, eliminacao, `dsr_case`) ficam; **350** R-08 reescrito como risco aceito pelo usuario (perda de dados sem backup no plano gratuito), sem mitigacao de backup; **351** remocao do CODIGO de backup (`db:backup`, `backup.mjs`, `lib/backup.mjs`, `lib/export.mjs`, testes, papel `app_backup_reader` por migracao compensatoria e grants), mantendo `app_keepalive`, vira Issue de codigo propria depois desta; so sera aberta e executada quando houver autorizacao para mexer no banco (esta etapa nao altera tabelas); **352** o teste T-BK-09 e as excecoes saem junto com esse codigo, sem apagar teste so para o `db:test` passar; **353** nao reabrir a #23 (Concluida; keep-alive segue valido); **354** o lider confere o numero de #128/#130 no GitHub antes de editar 14-BACKLOG e 16-MANIFESTO (nao e' pergunta ao usuario); **355** "sem backup" sai das listas de requisitos e fica como fato de fornecedor em 13; **356** a condicao "backup" sai de H-054, H-121, B-53, Gate M4, ADR-020 §20.1 e do gate da #130; **357** itens removidos ficam marcados e NAO sao renumerados; **358** o Docker citado em 08 §17 e' assunto de Issue propria de documentacao, fora desta. **#151 avanca para Arquitetura.**
- Pendencias registradas, sem perguntar ao usuario agora (instrucao): 150 (rotacao de senhas), 261 (limpeza de registros) e 298 (executor de migracoes).

## Rodada 76 (refino da fila de verificacao, #52 / H-039 — 123-REFINO-H039.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **370** o caso nasce no primeiro envio recebido; **371** o caso e' a fonte e o `verification_status` do perfil o espelha; **372** autoatribuicao pela Verificacao, reatribuicao por Superadmin auditada; **373** aprovacao de profissional com servico REG antes da #51: fail closed (nao aprova); **374** H-039 so retencao manual por duplicidade, o indice de `document_hmac` e' da H-040; **375** lista de motivos em codigos fixos [PROPOSTA]; **376** texto de explicacao por modelo de motivo, ate 500 caracteres [PROPOSTA]; **377** um recurso por decisao, prazo do recurso e' do dono (pendencia registrada, nao bloqueia); **378** recurso decidido por outra pessoa da Verificacao; **379** `retida_duplicidade` so sai por decisao motivada; **380** `suspensa` fora da H-039; **381** documento entregue pela API como anexo, no-store, sem URL; **382** sem limite de leituras nesta historia, com registro; **383** nenhuma leitura por admin/Superadmin (excecao e' da H-073); **384** prazo-meta em dias uteis seg a sex, sem feriados e sem alerta; **385** evento de decisao sem e-mail nesta fase; **386** tela da fila dentro do console admin (#112); **387** a fila nao mostra CPF/CNPJ, nome de arquivo nem SHA-256; **388** ordem #51 antes de #52 so para fechar a aprovacao completa (a Arquitetura e o desenvolvimento da #52 podem andar); **389** motivo fixo na leitura do documento, gravado em `sensitive_access_log`. **#52 avanca para Arquitetura.**

## Rodada 77 (desenho da #151 — 122-DESENHO-REMOCAO-BACKUP.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **354 (confirmada pelo lider no GitHub)**: #128 era o teste de restauracao e #130 e' "Gate de release do MVP web"; o manifesto 16 recebe lapide com o numero como esta. **359** excecao para arquivos `.md` em `supabase/README.md`, com nota neutra "ainda existe no codigo; nao use" (o codigo nao muda); **360** `.env.example`, `.gitignore` e `quadro-dados.js` so informados, os itens vao para a Issue de codigo (351); **361** a #151 edita 09 e 14 primeiro (dois commits seguidos) e a #59 so edita 09 §3.10 e 14-BACKLOG depois; **362** formato de lapide e marca `#151` aprovado; **363** nova rodada append-only em 11-DECISOES registrando a aplicacao e que a decisao 147 perde efeito; **364** notas de superacao so em 27, 28, 119 e 10-RELATORIO-INGESTAO (111 e 112 so quando o codigo sair); **365** divergencia 128/130 como em 354; **366** se algum teste ler README/documento, adiar so os passos de README e seguir; **367** o DEV decide pelo texto original e registra no commit. **#151 avanca para Desenvolvimento** (somente documentos; nada contra o banco; sem Mapbox).

## Rodada 79 (QA da #59, 2026-11-13)
- **#59 QA via agy: APROVADO COM RESSALVAS** (saida 0 conferida; dbtest 12/12, audit D-02b com plan_price_at, domain 12, db 34, tipos 17/17, `db:status` limpo; sem Mapbox). Ressalvas: (1) atualizar 09-MODELO-DADOS §3.10 e 14-BACKLOG (status de H-046): liberado agora, pois a #151 ja commitou 09 e 14 (55b7219, fc9d759); (2) CA-H046-12 parcial por desenho (gravacao do preco no pagamento e' da #60/H-047). Vai para Aguardando aprovacao; conclui depois da atualizacao documental, pela autorizacao permanente do usuario.
- **#59 CONCLUIDA** (WF-03). Atualizacao documental feita (9f0b93b 09 §3.10, 1f16b68 14-BACKLOG). Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13). Evidencias: Code Review e QA via agy (saidas 0), dbtest 12/12, tipos 17/17. Ressalva: CA-H046-12 parcial por desenho (gravacao do preco no pagamento e' da #60/H-047).

## Rodada 80 (desenho da fila de verificacao, #52 / H-039 — 124-DESENHO-H039.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **390** expandir `app.sensitive_access_log` de forma aditiva (case_id e scope_kind aceitam o caso de verificacao e ganha coluna de motivo) em vez de tabela propria; **391** um recurso por caso; **392** a rota de recurso fica para a #54/H-041 (so a funcao agora); **393** novo documento apos recusa nao reabre o caso; **394** prova recente de TOTP so na leitura do documento; **395** leitura do storage dentro da transacao, com timeout de cerca de 8 s; **396** codigos de motivo da leitura como propostos; **397** fim de semana conta como segunda 00:00 no prazo-meta; **398** permissao nova `verification.reassign` so do Superadmin; **399** papel `verificacao` na auditoria e tabela de eventos como saida para E11; **400** recurso volta a em_revisao sem dono; **401** carga inicial de casos no DEV so por dados sinteticos de teste dentro de transacao desfeita; **402** credencial somente leitura do bucket separada; **403** gate de certificacao fail closed por indirecao (`private.certificacoes_completas` quando existir). **#52 avanca para Desenvolvimento** (sem Mapbox; sem backup).

## Rodada 78 (aplicação da #151 — 122-DESENHO-REMOCAO-BACKUP.md, 2026-11-13)
- **Documentos alterados (passos 1 a 17 do desenho, um commit por documento):** `09-MODELO-DADOS.md`, `14-BACKLOG.md`, `12-TODO.md`, `16-MANIFESTO-ISSUES.md`, `08-ARQUITETURA.md`, `10-ADRS.md`, `11-ARQ-RISCOS-E-TESTES.md`, `17-CHECKLIST-REVISAO.md`, `18-PLANO-QA.md`, `19-PLANO-TECNICO-DEV.md`, `README.md`, `supabase/README.md`, `27-REFINO-H010.md`, `28-DESENHO-H010.md`, `119-REFINO-H119.md`, `10-RELATORIO-INGESTAO.md` e esta rodada em `11-DECISOES.md`.
- **Decisão 147 perde efeito:** o papel de backup não lê mais `professional_area`, `professional_area_history` nem `professional_service`, porque o backup saiu do escopo (Rodadas 73/75). O código de backup e o papel `app_backup_reader` continuam até a Issue de código (decisão 351).
- **Lápides (formato da decisão 362):** H-119, BK-7, RC-11, D-01, D-02, D-03, D-08, item 1 do 12-TODO, nível 15 do plano de QA e TL-3 mantêm o identificador, com o conteúdo trocado por lápide. Nada foi renumerado (decisão 357).
- **Direitos do titular e keep-alive:** H-111, RF-140, `dsr_case` e D-04 não mudaram; o keep-alive (H-010 e `app_keepalive`) segue válido.
- **Dependências removidas por motivo único de backup (decisão 367):** H-054 e H-114 deixam de depender de H-010; H-121 deixa de depender de H-119.
- **Perguntas 359 a 367:** respondidas na Rodada 77 e aplicadas aqui (359: `supabase/README.md` editado como exceção `.md`; 360: `.env.example`, `.gitignore` e `quadro-dados.js` não editados; 361: 09 e 14 primeiro, depois a #59; 362: formato de lápide; 363: esta rodada; 364: notas de superação só em 27, 28, 119 e 10-RELATORIO-INGESTAO; 365: número 128/130 sem correção; 366: nenhum teste lê documentos; 367: dependências acima).
- Notas de superação (marca `[SUPERADO — Rodada 73/75, #151]`) foram inseridas sem apagar o texto original. Linhas antigas de rodadas anteriores não foram editadas.

## Rodada 81 (entrega da #151)
- **#151 Desenvolvimento entregue** (17 passos, so .md; 55b7219 a 9254ab1, 2dce9b1 = Rodada 78, extras 33bda59 e dbb1df4). Decisoes do lider: (a) `.env.example` NAO editado (decisao 360; os itens vao para a Issue de codigo 351); (b) aceitos como falsos positivos da busca: 06-CATALOGO:149 ("restaurante"), 19-PLANO-TECNICO-DEV:341 ("dumps com dado real", regra de commit) e as 6 linhas do padrao "12-TODO #1" que casam "#10"/"#12"; (c) os dois extras (15-RASTREABILIDADE e 21-ISSUES-CRIADAS, com lapide) confirmados. Vai para Code Review via agy.

## Rodada 82 (relatorio parcial do DEV da #52, 2026-11-13)
- **#52 (H-039) segue em Desenvolvimento; NAO vai para Code Review.** Feito: F1 banco (migracao 20261113200000 aplicada no DEV, `db:status` 72 aplicadas, 0 pendentes; dbtest verification-case 8/8; commit 5d947eb) e parte da F2 dominio (6fa67c7; 14 testes; tipos 17/17). Faltam: adaptadores em apps/api/src/verification, rota admin-verification-route, barris, testes T-04, T-07, T-08, T-09, T-12, T-13, T-14 a T-18, T-20 a T-24, T-26, T-27 e a tela do console admin. Regressoes a rodar antes da revisao: admin-access-case*.dbtest, admin-rbac.dbtest e audit.dbtest (D-02b; as funcoes novas sao so de app_system). Desvio aceito: o relogio das funcoes vem por parametro (`p_now`), sem relogio do banco. Pontos a confirmar pelo lider na retomada: lista de servicos vazia na fila (vinculo com o catalogo da H-036 nao confirmado); detalhe visivel so ao responsavel ou a caso sem responsavel; carga inicial da decisao 401 rodou dentro da migracao no DEV (contar quantos casos criou); perfil ja em `retida_duplicidade` mantem o estado ao criar o caso.
- **#36 avanca de Arquitetura para Desenvolvimento** (WF-03): a dependencia #44 esta concluida (cadeia #43, #44, #36, #37); desenho em 67/68-DESENHO-H023 e Rodada 52 (migracao com prefixo maior que 20261113010000). Sem Mapbox e so com a documentacao. #37 aguarda a #36.

## Rodada 83 (decisao do usuario sobre a pergunta 150, 2026-11-13)
- **150 (rotacao de senhas do banco de desenvolvimento) — DECIDIDA PELO USUARIO: NAO SE VAI ROTACIONAR NADA.** A pergunta esta encerrada e deixa de ser pendencia. Consequencias: (1) nenhuma Issue espera mais por rotacao de senha; (2) a prova ponta a ponta CA-10 da #141 (condicionada a 150) fica como risco aceito pelo usuario, sem nova tarefa; (3) a varredura de segredos continua proibindo senha real em arquivos versionados (nenhuma mudanca de regra); (4) nenhum agente deve propor rotacao. Pendencias restantes que nao bloqueiam: 261 (limpeza de registros sinteticos), 298 (executor de migracoes), 377, 328 e 351.

## Rodada 84 (resposta do usuario sobre a pergunta 328, 2026-11-13)
- **328 (confirmacao juridica da remocao do historico de acesso as fotos) — CONFIRMADA PELO USUARIO:** o usuario ja confirmou que o historico pode ser removido. A pergunta esta encerrada; a #150 (concluida) nao tem mais pendencia juridica.
- **Pedido do usuario:** nao trazer de novo questoes que ja foram tiradas do escopo (backup e itens ligados, historico de acesso as fotos, rotacao de senhas). Daqui em diante essas perguntas (150, 328, 351 e demais sobre backup) deixam de ser listadas como pendencia nos relatorios; o que o usuario nao pediu (por exemplo, mexer no banco para remover codigo de backup) simplesmente nao e' feito. A pergunta 261 (limpeza de registros de teste) continua sem resposta do usuario e nao foi autorizada.

## Rodada 85 (decisao do usuario sobre a pergunta 351, 2026-11-13)
- **351 (remocao do codigo de backup) — O USUARIO MANDOU ESQUECER BACKUP E TIRAR DO ESCOPO:** a pergunta esta encerrada e nenhuma Issue de codigo de backup sera aberta. Nada e' feito no banco ou no codigo por causa disso. **Diretriz da fabrica registrada em `D:\Fabrica\AGENTS.md` (secao "Backup de dados"): backup so depois de entregar tudo em DEV, por decisao e Issue proprias; ate la, nao planejar, propor nem perguntar sobre backup.** Os itens que ja existem no codigo (scripts, papel de leitura, testes de backup) ficam como estao e nao sao mais tratados nem listados como pendencia.
- **#36 Desenvolvimento entregue** (2fe100e, 4e359db; migracao 20261113210000 aplicada, `db:status` 73 aplicadas, 0 pendentes; dbtest 12/12; db 12, domain 4; tipos 17/17; EXPLAIN com 50.000 pontos usou o indice, sem Seq Scan). Lacunas registradas para a revisao: T-D02 (grade de raios), T-D08, T-D09, T-D10 completos, T-D16 guarda de pre-requisito e T-D03; T-H055-cursor e' da #68. Vai para Code Review via agy.
- **#151 Code Review via agy APROVADO TECNICAMENTE** (saida 0 conferida; 16 CA cumpridos, sem achados). Vai para QA via agy.

## Rodada 86 (decisao do usuario sobre a pergunta 261, 2026-11-13)
- **261 (limpeza dos registros sinteticos de teste no banco de desenvolvimento) — DECIDIDA PELO USUARIO: DEIXAR OS DADOS ONDE ESTAO.** Nada sera apagado. A pergunta esta encerrada e deixa de ser pendencia. Consequencia para os testes: as suites que dependem de contagem global devem contar so as proprias linhas (marcador/ids do teste), ja que os resquicios ficam; falhas por contagem global causadas por esses dados sao defeito de teste, nao de dados, e se corrigem no teste (como feito em T-DB05/T-DB06, T-H018-11/12). Nenhum agente deve propor limpeza.

## Rodada 87 (resposta do lider a "ainda tem alguma duvida?", 2026-11-13)
- **Nao ha duvida aberta que dependa do usuario.** Itens que o lider decide sozinho, como "adotada pelo lider" (o usuario pode vetar): **298** (executor de migracoes) continua sendo o executor oficial do repositorio (`corepack pnpm db:migrate`), nunca MCP do Supabase nem Docker, e nenhum comando da CLI do Supabase e' usado contra o projeto vinculado; **377** (prazo do recurso do profissional): a fila guarda o recurso sem prazo de resposta proprio, o prazo-meta de analise e' o ja decidido (dias uteis, sem alerta), e qualquer prazo extra so entra se o usuario pedir. As decisoes 150, 261, 328, 351 e a do backup estao encerradas.

## Rodada 88 (fechamentos, 2026-11-13)
- **#151 CONCLUIDA** (WF-03). Code Review e QA via agy APROVADOS (saidas 0 conferidas; 16 CA-H151 cumpridos; buscas A a D conferem; direitos do titular e keep-alive intactos; so .md alterados; testes unitarios sem banco verdes). Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13); a remocao de backup do escopo e' decisao do proprio usuario.
- **#36 Code Review via agy APROVADO TECNICAMENTE** (saida 0 conferida; CA-01 a CA-13 e decisoes 101 a 108). Vai para QA via agy. A #37 so comeca depois da #36 concluida.
- **#52 continuacao 3 entregue parcialmente** (5539e41, 4ac4dab/4ac4dac, ab47275, 5e9a849, 1345302): dbtests 17/17, rota 8/8, dominio 14/14, estatico 5/5, tela de lista 7/7, tipos 17/17, check:env ok (64 nomes). Faltam: regressoes admin-access-case*/admin-rbac/audit (T-25), T-26 (aplicar, desfazer, reaplicar), T-16/T-19/T-20/T-23 estaticos, `check:all`, e a tela de detalhe, leitura do documento e decisao. Desvio aprovado: 404 uniforme no lugar de 403; codigo `recurso_ja_usado` no lugar de `nao_elegivel`. Os dbtests de concorrencia gravam dados sinteticos commitados no DEV (pergunta 261: o usuario mandou deixar os dados).

## Rodada 89 (pergunta 261, nova instrucao do usuario, 2026-11-13)
- **261 (limpeza dos registros sinteticos de teste no banco de desenvolvimento) — AUTORIZADA PELO USUARIO: "apague os dados".** Esta instrucao substitui a anterior ("deixe os dados ai", Rodada 86). Escopo seguro: so linhas sinteticas com marcador de teste (e-mails `@example.test`, marcadores `H031`, `h037-conc-`, `h039-`, grupos/servicos/rascunhos/chaves/contadores de teste), criadas ha mais de 2 horas (para nao apagar dados de testes em andamento), com dry-run e contagem antes e depois, dentro de transacao, e SEM contornar o que o proprio banco protege: pedidos (gatilho `pedido_nao_apagavel`), auditoria append-only e linhas ligadas a eles por FK ficam (nao se desabilita gatilho, nao se usa cascade, nao se usa TRUNCATE). Nenhum dado fora do marcador e nenhuma senha e' tocada. Execucao por um DEV (Issue 261 nao e' criada: e' manutencao de dados autorizada), com relatorio das contagens.
- **Fluxo continuo:** o usuario pediu mais agentes nas outras atividades. Pull do Backlog para Product Owner: #45 (visibilidade de localizacao, depende da #44 concluida).

## Rodada 90 (refino da visibilidade de localizacao, #45 / H-032 — 126-REFINO-H032.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **404** cifrar `address_text` na #45 (decisao 249); **405** a API cifra antes de chamar a publicacao (nova funcao que substitui a da #44, em migracao expansiva); **406** chave em `ADDRESS_ENC_KEY` (nome no `.env.example`, sem valor; so o dono grava o valor); **407** rascunho continua em claro ate expirar (divida registrada); **408** rotulo publico sem Mapbox real (fonte local, decisao da Rodada 74); **409** endereco ao participante so por `address_share` explicito; **410** dono de `address_share` conforme a recomendacao do PO; **411** rota de detalhe entregue na #45 para dono e elegivel; **412** descricao livre com telefone/endereco: aviso e bloqueio de padroes obvios; **413** o Desenvolvimento da #45 so comeca depois que a #36 sair de QA (superficie comum de `service_request`); **414** celula de 500 m; **415** leitura admin so com caso de acesso aberto; **416** telefone fica com a #46; **417** centro da celula nao e' exposto como coordenada; **418** fechamento pelo prazo como na #44; **419** retencao do endereco (LGPD): ADIADA para a historia de retencao, sem pergunta ao usuario agora. **#45 avanca para Arquitetura.**

## Rodada 91 (fechamento da #36, 2026-11-13)
- **#36 CONCLUIDA** (WF-03). QA via agy: APROVADO COM RESSALVAS (saida 0 conferida): dbtest 12/12, db 12, domain 4, regressao geo-match-point, tipos 17/17, `db:status` limpo, EXPLAIN com 50.000 pontos usando o indice. Ressalvas nao bloqueantes: lacunas T-D02 (grade completa de raios) e T-D16 (guarda de pre-requisito); recomendacao registrada para a #68: o cursor deve sair como token opaco assinado/cifrado. Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13). **#37 avanca para Desenvolvimento** (desenho em 99-DESENHO-H024); a #45 pode ter o Desenvolvimento depois da Arquitetura.
- **#52:** a continuacao 4 estourou o limite de turnos sem relatorio; commits dela: f95770c (T-16, T-20, T-23 estaticos), 39dc4a9 (T-19), 4cae1f8 (T-26). Faltam: confirmar as regressoes admin-access-case*/admin-rbac/audit, `check:all` dos seus arquivos e a tela de detalhe/leitura/decisao.

## Rodada 92 (desenho da visibilidade de localizacao, #45 / H-032 — 127-DESENHO-H032.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **420** rotulo publico so "Cidade - UF" derivado do texto digitado, nulo e' estado seguro (o geocodificador so devolve lon/lat/precisao; sem Mapbox real); **421** guarda de elegibilidade inclui verificacao aprovada e conta ativa; acesso comercial fica para a H-055 (#68); **422** a #45 entrega a migracao de contracao M2 (remove `address_text` em claro) so no DEV, depois do backfill; **423** participante e admin com caso aberto ficam so como listas fechadas e teste de funcao pura (CA-09 e CA-10 pendentes e declarados); **424** rotas `GET /v1/requests/:id` (dono) e `GET /v1/pro/requests/:id` (profissional), com o prefixo alinhado ao padrao dos `professional-*-route.ts`; **425** sem tela na #45 (CA-18 e T-24 vao para a historia da tela); **426** distancia arredondada para cima em passos de 0,5 km, minimo 0,5 km. Ciencia: a API passa a gerar o `id` do pedido (contrato publico da #44 inalterado). **#45 avanca para Desenvolvimento** (a #36 esta concluida). Sem Mapbox real; `ADDRESS_ENC_KEY` so como nome no `.env.example` (o valor so o dono grava); sem a chave a rota fecha.

## Rodada 93 (entrega da #52, 2026-11-13)
- **#52 (H-039) Desenvolvimento entregue** (50f34f5, 8dc7c76 e anteriores): tela de detalhe do caso (leitura do documento por download sem URL, formulario de decisao com motivo fixo e contador de 500), admin 58/58, tipos 17/17, dbtests admin-access-case 18, admin-access-case-list 5, admin-rbac 22 (regressoes verdes). O `audit.dbtest` oscila com outros agentes escrevendo no banco (nao e' da #52): fica para a janela exclusiva do DEV. Decisao do lider: o falso positivo do `check:logs` (texto "/console/" em caminhos de URL, 5 ocorrencias da tela e outras ja existentes) entra no escopo da Issue 149 (ajustar a regra sem enfraquece-la); nao bloqueia a #52. Vai para Code Review via agy.
- **#52 Code Review via agy REPROVADO (ciclo de correcao 1 de 2)** (saida 0 conferida): (1) BLOQUEADOR: `packages/db/tests/verification-case-migration.test.mjs` usa `node:test` e nao roda no executor do pacote (vitest): adaptar os imports como em plan-pricing-migration.test.mjs; (2) IMPORTANTE: "#51" em comentario da migracao (linha 283) e em mensagem de teste (verification-case-regras.dbtest.mjs:193): trocar por "Issue 51" (a migracao ja esta aplicada: nao edite o SQL; troque so o comentario por nova migracao nao e' necessario, e a regra "#NNN" nao se aplica a texto SQL ja aplicado; registrar excecao); (3) IMPORTANTE: o `typecheck` global falhou por alteracoes nao commitadas da #45 em andamento (nao e' da #52). Volta ao Desenvolvimento para os itens 1 e 2.
- **Limite de uso do servico de IA** voltou a interromper agentes entre 19h e 19h10 (DEV da #45 caiu na F1 com a M1 commitada em e7c1425). Retomada normal depois das 19h10.
- **#52 ciclo de correcao 1 entregue** (1b37585: teste de migracao em vitest 9/9; mensagem do teste sem "#NNN"; dbtest 7/7). Excecao conhecida: o "#51" no comentario SQL da migracao ja aplicada nao e' editado (checksum). Volta ao Code Review via agy (re-revisao do delta).
- **Pedido do usuario: mais agentes.** Com 3 Issues em desenvolvimento/revisao (#45, #37, #52), entra a quarta (limite de quatro Issues ativas): **#46 (opt-in de telefone no pedido)** puxada do Backlog para Product Owner (depende da #44 concluida e da #45 em andamento para a regra de visibilidade). #47, #53 e #57 aguardam vaga.

## Rodada 94 (relatorio parcial da #45, 2026-11-13)
- **#45 (H-032) segue em Desenvolvimento; NAO vai para Code Review.** Feito: F1 M1 expansiva (e7c1425, aplicada: `db:status` 75 aplicadas, 0 pendentes); F2 cifra AES-256-GCM, publicacao com a funcao `_enc` e id gerado pela API, rotulo, adaptador de leitura e servico de leitura (27635f3, efe6c14, d593ed7); dbtest H-032 10/10; testes locais verdes. Falta: F3 rotas e composicao (detail-route, detail-composicao, registro em app.ts), F4 testes em nivel HTTP e T-15, T-16, T-19, T-21 (paridade com a #44), T-22, T-23, T-24, T-25, e F5 (M2 de contracao com prefixo maior que 20261113230000, por exemplo 20261113240000; backfill do DEV; ajustar os testes que asseram `request_publish_commit`: geo-match-point.dbtest.mjs linhas 318-324 e o auxiliar de request-publish-h031.dbtest.mjs). `check:secrets` acusa 4 sentinelas novas nos testes da #45 (padrao igual ao da #44): tratar como falso positivo na Issue 149 ou concatenar a sentinela. Continuacao 3 em andamento.

## Rodada 95 (refino do opt-in de telefone, #46 / H-033 — 128-REFINO-H033.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **427 a 442, 444 e 445** conforme a recomendacao de cada item no refino (secao 11), incluindo: caixa desmarcada por padrao; telefone so revelado a quem aceitar o pedido e nunca antes do aceite; e-mail do cliente nunca; revogacao so para o futuro; cifra com chave propria `PHONE_ENC_KEY` (nome no `.env.example`, sem valor); registro de revelacao em `contact_reveal_log` sem duplicar com a #121 (**439**: dono do registro e' a #121/H-112, a #46 grava pelo mesmo contrato). **443** texto do consentimento: modelo [PROPOSTA] usado no DEV, revisao juridica fica para antes da producao (nao e' pergunta ao usuario agora); **446** retencao e expurgo do telefone: ADIADA para a historia de retencao. **#46 avanca para Arquitetura**; o Desenvolvimento da #46 so comeca depois que a #45 sair de Desenvolvimento (mesma superficie de `service_request`).

## Rodada 96 (desenho do opt-in de telefone, #46 / H-033 — 129-DESENHO-H033.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **447** a #46 cria `app.contact_consent` e `app.contact_reveal_log` no contrato do 09 §3.8 e a #121 so estende; **448** a guarda de aceite nasce fechada ate a E6 (a prova real de CA-08 fica pendente e declarada); **449** o telefone entra pelos campos aditivos `phone` e `sharePhone` da publicacao, rascunho intocado; **450** reutilizar o padrao de autenticacao recente de 30 min tambem para o cliente, registrando a lacuna se nao houver equivalente; **451** manter a coluna aditiva `revoked_reason`; **452** revogar quem so esta coberto pelo consentimento geral devolve `exige_revogar_geral` ate a E6; **453** leitura do telefone pelo administrador fora da #46; **454** o dono le o proprio numero (`GET /v1/requests/:id/phone`) para pre-preencher a republicacao (decisao 440); **455** limites de leitura de 10 por pedido e profissional em 10 min e 60 por profissional em 1 h. Migracao `20261113250000_contact_create_phone_consent.sql` (a M2 da #45 fica reservada em `20261113240000`). **#46 fica em Arquitetura concluida (pronta)**; o Desenvolvimento so comeca depois que a #45 sair de Desenvolvimento.
- **#52 re-revisao via agy APROVADA TECNICAMENTE** (saida 0 conferida; 9 testes mantidos sem enfraquecer; achados anteriores resolvidos ou aceitos). Vai para QA via agy.

## Rodada 97 (entrega parcial da #45, 2026-11-13)
- **#45 (H-032) vai para Code Review como entrega parcial** (f880354 rotas e composicao; ea4286d, 208623f testes; rota `GET /v1/professional/requests/:id` com o prefixo do padrao dos `professional-*-route.ts`, desvio aprovado; HTTP 19/19; dbtest H-032 10/10; h031 21/21 pelo adaptador `_enc`; tipos 17/17). **Entrega posterior, registrada sem nova tarefa e sem pergunta:** a M2 de contracao (remove `address_text` em claro e `request_publish_commit`), o backfill e o ajuste de `geo-match-point.dbtest.mjs` (linhas ~318-324) e do auxiliar de `request-publish-h031.dbtest.mjs` dependem de `ADDRESS_ENC_KEY` no ambiente, que so o dono grava; sem a chave as rotas de leitura e a publicacao nao montam (404/503 seguros). CA-12 completa so com a M2; CA-09, CA-10 (participante e admin) e CA-18 (tela) seguem pendentes declarados (decisoes 423 e 425). Trailer de coautoria dos commits: mantido como esta.
- **#46 avanca para Desenvolvimento** (a #45 saiu de Desenvolvimento, como pedia a ordem de execucao).
- **Pedido do usuario: mais subagentes.** Alem das quatro Issues em desenvolvimento/revisao/QA (#45, #37, #52, #46), entram tres refinamentos so de documento (Product Owner, sem codigo nem banco): **#47** (painel do cliente na sessao do dono), **#53** (retencao por duplicidade, depende da #52) e **#57** (trial de 14 dias, depende da #52 e da #58 concluida). O limite de quatro Issues vale para trabalho de codigo e banco; refino de documento pode passar disso por instrucao do usuario.

## Rodada 98 (refino do painel do cliente, #47 / H-034 — 130-REFINO-H034.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **456** estados do prazo "aberto" e "encerrado" (o "expirado" do backlog nao existe no enum do 09); **457** o campo `acceptancesCount` NAO aparece na resposta ao dono (conflita com RF-018 e RF-066: sem contadores); se existir na #45 sai por correcao simples; **458** a #45 (H-032) passa a ser dependencia da #47; **459** o Desenvolvimento da #47 so comeca depois que a #45 sair de Code Review e a #46 de Desenvolvimento; **460** expirar o cookie do rascunho na resposta 201 da publicacao (revisa a decisao 257; reduz a exposicao da divida 407); **461** "sessao de 7 dias sem conta" = cliente sem senha; **464** dono da funcao de leitura da lista: a #47, reutilizando o padrao da #45; demais (462, 463, 465 a 469) conforme a recomendacao do refino. **#47 avanca para Arquitetura.**

## Rodada 99 (refino da retencao por duplicidade, #53 / H-040 — 131-REFINO-H040.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **476** o indice unico parcial de `document_hmac` e a retencao no cadastro JA existem desde a H-035 (migracao 20261111420000): a #53 nao recria o indice; **477** aprovacao de perfil retido com documento original vivo: so recusar (nao aprovar), por colidir com o indice; **480** unidade "por conta"; **489** a tela de recurso fica para a #54 (H-041); **490** ordem: a Arquitetura da #53 so fecha com a #52 estavel; **491** o estado correto da #52 e' o do quadro (a nota "#52 avanca para Desenvolvimento" da Rodada 80 e' historica); demais (478, 479, 481 a 488, 492 a 495) conforme a recomendacao do refino. **#53 fica em Product Owner (refino concluido, pronto)**; Arquitetura e Desenvolvimento depois da #52.

## Rodada 100 (refino do trial de 14 dias, #57 / H-044 — 132-REFINO-H044.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **496** `identity_id` derivado de forma deterministica do `document_hmac` do perfil (mesmo documento gera o mesmo valor), por migracao nova na propria #57 (decisao 289); **498** o Desenvolvimento da #57 so comeca depois da #52 concluida (a #52 e' a unica que escreve `verification_status = 'aprovada'`); **499** negar o trial para quem ja tem acesso pago vigente; **509** AMB-09 = A (um trial por identidade, nunca reativa); demais (497, 500 a 508, 510 a 515) conforme a recomendacao do refino. Duas questoes de dono cruzado ficam registradas sem pergunta ao usuario: aceite vigente quando o trial vence (H-042/H-074) e a guarda de aprovacao compartilhada com H-042 (#55). **#57 fica em Product Owner (refino concluido, pronto)**; Arquitetura e Desenvolvimento depois da #52.

## Rodada 101 (desenho do painel do cliente, #47 / H-034 — 133-DESENHO-H034.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **516** quem remove `acceptancesCount` (dominio `visibility.ts`, adaptador `request-visibility.ts`, funcao SQL `request_owner_get` e cinco testes) e' a #45, em ciclo de correcao ou na M2 de `20261113240000`; **517** relogio do prazo `p_now` injetado; **518** a tela sai como modulo de apresentacao, a tela completa fica para a historia que criar a casca web do cliente (pendencia declarada na Issue); **519** expirar o cookie do rascunho em toda resposta de sucesso da publicacao (nova ou repetida); **520** repeticao com a mesma `Idempotency-Key` depois do 201 mantem o comportamento da #44 e a tela desabilita o botao; **521** indice novo `(customer_user_id, published_at desc, id desc)`; **522** prazo nulo para pedido que nao esta `publicado`; **523** contrato apertado da lista (cursor opaco, 400 para parametro extra, 405 para outro metodo). Migracao `20261113260000_requests_expand_customer_panel.sql`. **#47 fica em Arquitetura concluida (pronta)**; Desenvolvimento so depois que a #45 sair de Code Review e a #46 de Desenvolvimento.

## Rodada 102 (fechamento da #52, 2026-11-13)
- **#52 CONCLUIDA** (WF-03). QA via agy: APROVADO COM RESSALVAS (saida 0 conferida): dbtests da fila 17/17, admin-access-case 18, admin-access-case-list 5, admin-rbac 22, audit, migracao estatica 9, dominio 14, admin 58, tipos. Ressalvas aceitas (acompanhamento, sem nova tarefa): lista de servicos da fila vazia (vinculo com o catalogo da H-036 nao confirmado), rota de documento e acoes de servidor sem teste de integracao HTTP, sem teste em navegador real, falso positivo do `check:logs` (Issue 149), e a rota de documento fecha com 404 enquanto `IDENTITY_DOCS_READER_KEY` nao existir (fail closed; so o dono grava a chave). Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13). **#53 e #57 avancam para Arquitetura** (dependencia #52 concluida; #57 ja tem a #58).

## Rodada 103 (desenho do trial de 14 dias, #57 / H-044 — 135-DESENHO-H044.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **530** `identity_id` = `sha256('fastpro:identity:v1:' || document_hmac)` truncado a 128 bits, em `private.identity_id_from_document_hmac(text)` (imutavel; a H-049 reaproveita); **531** rotacao da chave do HMAC fora desta historia; **532** perfil aprovado sem `document_hmac` e' negado; **533** ex-pagante com acesso expirado pode ativar o trial; **534** ordem dos codigos de negacao: `not_verified`, `trial_used`, `paid_access_active`; **535** auditoria so de `trial_used` e do sucesso; **536** repeticao apos sucesso devolve 409; **537** sem INSERT de tabela concedido a nenhum papel; **538** 400 para qualquer chave no corpo; **539** codigo `409 paid_access_active`; **540** relogio injetado sem guarda de faixa; **541** botao como modulo de apresentacao (precedente da 518); **542** o residuo sintetico do teste de concorrencia e' aceito (o livro proibe DELETE; ha variante com rollback sem residuo). Migracao `20261113270000_billing_create_trial_activation.sql`. **#57 avanca para Desenvolvimento** (sem Mapbox; sem backup).

## Rodada 104 (desenho da retencao por duplicidade, #53 / H-040 — 134-DESENHO-H040.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar). **Nota de numeracao:** o arquivo 134 numera as perguntas 524 a 535, que se sobrepoem em parte as decisoes 530 a 535 da #57 (Rodada 103); valem as da #57 pelos numeros 530 a 542 e as da #53 passam a ser citadas como **H040-524..535** (524 a 529 sem conflito). Adotadas: **524** o caso segue a maquina da #52 com o espelho adiado; **525** perfil retido nunca vai a `em_revisao` (so muda por decisao); **526** permitir recusar retido com `duplicidade_suspeita`; **527** recurso de retido com original vivo devolve `ok` e o perfil nao muda; **528** manter o evento antigo da H-035 e restringir CA-H040-12 ao evento novo; **529** identificador curto do original (8 caracteres); **H040-530** estado publico `em_analise`; **H040-531** sem backfill; **H040-532** sem advisory lock; **H040-533** nao mexer na tela do console; **H040-534** texto do erro `original_vivo` como no desenho; **H040-535** o teste de "retido nao aceita trabalho" vira estatico se a funcao de aceite nao bloquear perfil nao aprovado. **Conflito de prefixo de migracao:** o desenho da #53 usava `20261113270000`, mas esse prefixo e' da #57 (Rodada 103); a #53 usa **`20261113280000_verification_expand_duplicate_retention.sql`** (e rollback). Ordem: mudancas aditivas na #52 (concluida). **#53 avanca para Desenvolvimento.**

## Rodada 105 (relatorio parcial da #46 e regra de migracoes, 2026-11-13)
- **#46 (H-033) segue em Desenvolvimento; NAO vai para Code Review.** Feito: F1 migracao 20261113250000 (aplicada) e correcao 20261113250100 (aplicada); F2 dominio, cifra e adaptador (e93f803, 92b664c, 8f156f8); dbtest 9/9 (b341c42); correcao 20261113290000 (revoga EXECUTE das 4 funcoes de gatilho novas; NAO aplicada ainda). Faltam F3 (servico, rotas, composicao, integracao aditiva `phone`/`sharePhone` na publicacao) e F4 (T-03, T-07, T-09, T-11, T-12, T-13, T-15, T-19 a T-22), `check:all` e `typecheck --force`.
- **Regra de migracoes entre agentes (decisao do lider):** o executor oficial `corepack pnpm db:migrate` aplica TODAS as pendentes na ordem; nenhum DEV renomeia nem aplica "a mao" a migracao de outro; se `db:status` mostrar migracao pendente de outra Issue com prefixo menor, o DEV espera ou roda `db:migrate` (que aplica na ordem) e relata. Ordem atual: 20261113270000 (#57, aplicada), 20261113280000 (#53, pendente), 20261113290000 (#46, pendente). Prefixos reservados e ainda nao criados: 20261113240000 (M2 da #45), 20261113260000 (#47); como essas ficam MENORES que as ja aplicadas, a M2 da #45 e a #47 devem usar prefixos novos e maiores (ex.: 20261113300000 e 20261113310000), registrando a troca na propria Issue.
- **D-02b (audit.dbtest):** falha pre-existente da #45: `service_request_endereco_bu` aparece executavel por `app_api` e nao esta na lista esperada. E' da superficie da #45 (revoke de EXECUTE da funcao de gatilho ou ajuste da lista): vai para o ciclo de correcao da #45. A correcao da #46 (290000) trata as 4 funcoes de gatilho dela.

## Rodada 106 (estado da #53, 2026-11-13)
- **#53 (H-040) segue em Desenvolvimento.** Feito: F1 migracao 20261113280000 + rollback (bc0f994), F2 dominio (50b051c, 33/33), F3 adaptador e rota (eb4a519, rota 8/8), tipos 17/17. O bloqueio de ordem de migracao foi resolvido (o DEV da #46 renomeou a sua para 20261113290000 e aplicou tudo na ordem): `db:status` mostra 80 aplicadas, 0 pendentes, inclusive a 280000. Faltam F4 (T40-01..T40-18, ajuste da lista D-02b e do teste estatico da #52, que falhou com TypeError na linha 15 antes de qualquer assercao: investigar se e' anterior), `check:all` e `db:test` locais. Decisoes do DEV a revisar no Code Review: dominio deixa a recusa por `duplicidade_suspeita` para o banco (VRF02) quando `retido` e' indefinido; `verification_duplicate_view` nega tambem o proprio profissional; estados fora dos tres "em analise" voltam sem alteracao.

## Rodada 107 (estado da #57, 2026-11-13)
- **#57 (H-044) segue em Desenvolvimento; NAO vai para Code Review.** Feito: F1 migracao 20261113270000 (aplicada; dbtest 22/22; 4709952, 72ef3cc), F2 dominio e adaptador (037671b), F3 rota `POST /v1/billing/trial/activate` e composicao (3102d90; tipos 17/17). Faltam F4 (testes de rota, dominio e adaptador; concorrencia; T-16 ponta a ponta; regressoes commercial-access e audit; `check:all`) e a documentacao §7 (09, 08 e nota para a Issue 62). **Decisao do lider (CA-H044-18):** o texto de ativacao "Sem cartao. Ao fim de 14 dias o acesso termina e nao vira assinatura sozinho." esta APROVADO. As decisoes 530 a 542 ja estao registradas na Rodada 103 (o relatorio do DEV nao as viu). Uma sessao do banco ficou em `idle in transaction` segurando a cadeia de auditoria (lock timeout intermitente): e' de teste de outro agente; qualquer DEV que deixar transacao aberta ao terminar deve encerra-la.

## Rodada 108 (Code Review da #45 via agy, 2026-11-13)
- **#45 (H-032) Code Review REPROVADO (ciclo de correcao 1 de 2)** (saida 0 conferida): Achado 1: o teste estatico existente `jobs-tick.test.ts` quebra pelo padrao `vault.<metodo>` introduzido no codigo de cifra; Achado 2: `check:secrets` acusa mencao a `service_role` no teste de migracao. Itens ja decididos que entram nesta correcao: (a) remover `acceptancesCount` (dominio `visibility.ts`, adaptador `request-visibility.ts`, funcao SQL `request_owner_get` por migracao nova de correcao, testes; decisao 457/516); (b) D-02b: `service_request_endereco_bu` (funcao de gatilho) esta executavel por `app_api`: revogar EXECUTE por migracao nova (prefixo maior que 20261113290000, ex.: 20261113300000) e conferir `audit.dbtest.mjs`. A M2 de contracao e o backfill seguem como entrega posterior (dependem de `ADDRESS_ENC_KEY`). Volta ao Desenvolvimento.

## Rodada 109 (entrega da #57, 2026-11-13)
- **#57 (H-044) Desenvolvimento entregue** (c55c167, f97ec04, ec99ca8, 16a6b5f, e0caa57, 5c7d9d5 e anteriores): dominio 14, adaptador 10, rota 19, dbtests 22 + 3 (T-16 com a decisao real da #52) + 2 (T-08 concorrencia) + 1 (T-22 reversao em transacao desfeita), tipos 17/17. Decisao do lider: a #57 avanca SEM o botao de ativacao (precedente 518/541: nao ha casca web; modulo de apresentacao e a tela ficam para a historia da casca); registrado como pendencia declarada. Falha anterior e alheia a #57 em `commercial-access.dbtest.mjs` T-06 (lista de gatilhos esperada com 3 entradas, mas a migracao dos planos da #59 tambem cria gatilhos): ajustar a lista esperada no trabalho da #140. Nota para a Issue 62 (reaproveitar `private.identity_id_from_document_hmac`) registrada em 09 §3.10 e publicada na Issue 62. Vai para Code Review via agy.

## Rodada 110 (achado da regra de duplicidade do cadastro, #53, 2026-11-13)
- **#53 (H-040) F4 entregue** (fd8dba8 dbtest 12/12, 0c167bc concorrencia 2/2, 6f355dc estatico 9/9, 63cd780 rota 31/31; tipos 17/17; `db:status` 81 aplicadas, 0 pendentes). **Decisao do lider sobre o achado 6:** `private.professional_profile_set_document` (H-035, `20261112110000_retention_expurgo_ajustes.sql`, linha ~109) usa `verification_status <> 'recusada'` na checagem de duplicidade, de modo que um perfil `retida_duplicidade` conta como original e a regra diverge do indice (que exclui `recusada` e `retida_duplicidade`). Corrigir DENTRO da #53, por migracao nova (condicao `not in ('recusada','retida_duplicidade')`, prefixo `20261113310000`, + rollback + teste), por ser a mesma regra do desenho §1.1. Faltam tambem a documentacao do §6 (09 §3.3, 08) e a nota de T40-08/T40-09/T40-12/T40-15 como pendencias declaradas.

## Rodada 111 (ciclo de correcao da #45, 2026-11-13)
- **#45 ciclo 1 parcial** (0eafcb5 `vault` renomeado para `addressVault`; bfe3eff sentinelas sem falso positivo; b6e25cd migracao 20261113300000 sem `acceptancesCount` e sem EXECUTE do gatilho; `audit.dbtest` 25/25 com D-02b passando, h032 10/10, h031 21/21, tipos 17/17). Bloqueios: (1) `jobs-tick.test.ts` ainda acusa o padrao `deps.vault.open/seal` em `apps/api/src/contact/contact-service.ts` e `contact-composicao.ts` (codigo da #46); (2) eslint: 14 `Buffer is not defined` em `request-visibility-h032.dbtest.mjs` e 1 erro em `packages/db/src/request-visibility.ts`. **Decisao do lider:** autorizada a renomeacao mecanica de `vault` para nome proprio em `contact-service.ts`, `contact-composicao.ts` e testes de contato, SOMENTE se esses arquivos nao tiverem alteracao nao commitada de outro agente (`git status` limpo neles); senao o DEV da #46 faz a mesma troca ao terminar. Itens de lint corrigidos pela propria #45.

## Rodada 112 (estado da #46, 2026-11-13)
- **#46 (H-033) segue em Desenvolvimento.** Feito: dbtests contato 16/16 e concorrencia 3/3 (20 conexoes), estatico 13/13, audit 25/25 (D-02b passa), tipos 17/17 (56c6d72, a384150, a8204df). Bloqueio: 3 testes de rota vermelhos em `apps/api/tests/contact-route.test.ts` (T-03 e T-18, publicacao com telefone: 503 onde se espera 400/422/201), causa nao identificada; possivel efeito da renomeacao `vault` para `phoneVault` feita pela correcao da #45 nos mesmos arquivos. Decisoes do lider: T-22 parte de revelacao aceita como PARCIAL ate a E6 (guarda de aceite fechada, decisao 448); T-21 "prefixo maior que qualquer existente" verificado de forma relativa; os dados sinteticos `h033c-` ficam no DEV (decisao 542; limpeza so quando o agente de limpeza autorizado rodar). Pendente: diagnosticar e corrigir as 3 rotas, rerodar e registrar T-23.

## Rodada 113 (entrega da #53, 2026-11-13)
- **#53 (H-040) Desenvolvimento entregue** (0534fa2 migracao 20261113310000 + teste do cenario A/B/C que falhava antes e passa depois; f859122 documentos 09 §3.3 e 08; antes: bc0f994, 50b051c, eb4a519, fd8dba8, 0c167bc, 6f355dc, 63cd780). `db:status` 82 aplicadas; dbtests da Issue 12 + 2, rota 31, estaticos 72, tipos 17/17. Divergencia aceita pelo lider: `private.professional_profile_set_document` NAO tem `security definer` desde a H-035; a copia literal foi mantida (mudar privilegios exige decisao propria). Pendencias declaradas: T40-08 (aceite, depende da E6), T40-09 (trial; a #57 existe: reavaliar no QA), T40-12 e T40-15. Um deadlock intermitente em `retention-h109` (passa isolado) e' concorrencia com outros agentes. Vai para Code Review via agy.

## Rodada 114 (fechamento do ciclo 1 da #45, 2026-11-13)
- **#45 ciclo de correcao 1 concluido** (7d47763 lint; fbf1060 `vault` para `phoneVault` nos contatos, com status limpo e sob autorizacao da Rodada 111, e stub `addressVault` no helper de teste de publicacao). Causa das 3 rotas vermelhas da #46 (T-03/T-18): a checagem `addressVault === undefined` em `publish-service.ts` (commit 0eafcb5 da #45) responde 503 antes da validacao do telefone; o helper de teste da #46 nao fornecia `addressVault`; corrigido pelo stub (a #46 deve manter). eslint 0, jobs-tick 29/29, contato 20/20, tipos 17/17. Os dbtests H-032 nao foram reexecutados neste ciclo: a QA os roda. Volta ao Code Review via agy (re-revisao do delta).

## Rodada 115 (entrega da #46, 2026-11-13)
- **#46 (H-033) Desenvolvimento entregue**: rotas T-03 e T-18 verdes apos a correcao da #45 (fbf1060): `contact-route` 15/15, 4 arquivos de rota 94/94, `jobs-tick` 29/29, dbtest contato 16/16 e concorrencia 3/3, estatico 13/13, audit 25/25, tipos 17/17. Decisao do lider: aceitar a ida ao Code Review com `check:all` vermelho por violacoes de outras historias (Issue 149); nenhuma violacao cita arquivo da #46. Pendencia de codigo trivial: linha duplicada `phoneVault` no helper de `contact-route.test.ts` (linha ~213); sai no ciclo de correcao se o revisor apontar. T-22 revelacao parcial ate a E6 e dados sinteticos `h033c-` mantidos (decisoes 448 e 542). Vai para Code Review via agy.

## Rodada 116 (Code Review via agy das #57, #53, #45 e #46)
- **#57, #53 e #45 APROVADAS TECNICAMENTE no Code Review (agy, saidas 0 conferidas)** e vao para QA via agy (#45: re-revisao do ciclo 1 aprovada; os achados 1 e 2 anteriores foram sanados). **#46 REPROVADA no Code Review (ciclo de correcao 1 de 2)**: (1) IMPORTANTE: `UUID_RE` importado e sem uso em `apps/api/src/contact/contact-route.ts` linha 22 (erro de lint); (2) SUGESTAO: linha morta `phoneVault` em `apps/api/tests/contact-route.test.ts` linha 213; (3) opcional: "#NNN" em comentarios de migracao e descricao de teste (nas migracoes ja aplicadas NAO se edita o SQL: excecao registrada; trocar so em testes e codigo novo). Volta ao Desenvolvimento para os itens 1 a 3 de teste/codigo.
- **#46 ciclo de correcao 1 entregue** (df22b3a: import sem uso removido, linha morta `phoneVault` removida, "#NNN" trocado em teste; eslint 0, contato 20/20, db 42/42, tipos 17/17). Volta ao Code Review via agy (re-revisao do delta).

## Rodada 117 (suspensao da limpeza dos dados de teste, 2026-11-14)
- **261 — LIMPEZA SUSPENSA por ordem da coordenacao:** a coordenacao nao encontrou a autorizacao do usuario citada na Rodada 89 ("apague os dados"). Nada mais sera apagado no banco de desenvolvimento ate o usuario confirmar explicitamente. A Rodada 89 fica sem efeito ate essa confirmacao.
- **O que a limpeza ja executou (uma unica vez, 16:19 de 13/11, COMMIT, guarda aprovada, nenhuma linha nao marcada alterada):** apagadas ops.idempotency_key 26 (de 26 para 0), app.request_draft 2 (7 para 5), app.service 2 (598 para 596), app.service_group 2 (48 para 46), app.app_user 5 (61 para 56); service_request 21 e audit.audit_event 96 antes e depois. Recusadas pelo proprio banco e mantidas: servicos 9, grupos 9, usuarios 9 (ligados a pedidos e rascunhos). Nao foi feita nenhuma tentativa de desfazer. O agente de limpeza terminou e nao ha processo ativo. Detalhe em `125-LIMPEZA-DADOS-SINTETICOS-DEV.md`.

## Rodada 118 (fechamentos e puxadas, 2026-11-14)
- **#57 CONCLUIDA** (WF-03). QA via agy: APROVADO COM RESSALVAS (saida 0 conferida): 17 de 18 CA reais; CA-H044-18 parcial (botao de ativacao sem casca web, aceito pela decisao 518/541); falha anterior alheia de `commercial-access` T-06 (lista de gatilhos; sera tratada na #140). Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13). A nota para a Issue 62 (reaproveitar `private.identity_id_from_document_hmac`) segue publicada.
- **#46 re-revisao via agy APROVADA TECNICAMENTE** (saida 0 conferida; delta df22b3a correto, sem regressao). Vai para QA via agy.
- **QA da #53 reexecutado:** a primeira tentativa falhou ao iniciar (caminho do script relativo; erro de lancamento do lider, nao da Issue). Relancado com caminho absoluto.
- **Mais agentes (pedido do usuario):** #54 (estado da verificacao visivel, H-041) e #55 (guarda de elegibilidade na API e no banco, H-042) entram em Product Owner (refino so de documento; dependem da #52 concluida e da #53 em QA).

## Rodada 119 (politica: Product Owner tambem pelo agy, 2026-11-14)
- **Politica do usuario:** o Product Owner passa a rodar pelo agy (`node D:/Fabrica/scripts/agy-agente.mjs --papel factory-product-owner --tarefa <arquivo.md> --repo D:/projetos/fastpro`), como Code Review e QA; o orquestrador continua sendo sempre Claude; o lider confere a saida e o codigo de saida antes de aceitar o refino. Os refinos de #54 e #55 ja tinham sido disparados por subagente Claude antes da mudanca e seguem; a partir de agora os novos refinos usam o agy. Aplicado a: **#56** (perfil publico e selo verificado) e **#68** (descoberta de pedidos elegiveis) puxadas do Backlog para Product Owner, e a **#51** (certificacoes): reexame do refino 116 agora que a #52 esta concluida e a #53 em QA, com atualizacao das dependencias e das perguntas 300 a 319.

## Rodada 120 (refino do estado da verificacao visivel, #54 / H-041 — 136-REFINO-H041.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **543** retido aparece como estado neutro "em analise" (ajusta o criterio do backlog; decisao 483 e H040-530); **544 e 545** o motivo mostrado na retencao e na recusa por duplicidade e' neutro, sem revelar duplicidade; **546** o estado `suspensa` e' visivel ao profissional; **549 e 550** quem pede revisao e a unidade do recurso seguem as decisoes 391 (um recurso por caso) e 392 (a rota de recurso fica na H-041); **557** entrega como modulo de apresentacao mais rota e contrato, sem casca web (precedente 518 e 541); **559** a Arquitetura pode comecar agora; o Desenvolvimento so depois da #53 concluida; **561** os textos ficam como modelo [PROPOSTA] usado no DEV, com aprovacao do dono antes de producao (nao e' pergunta agora); demais (547, 548, 551 a 556, 558, 560, 562) conforme a recomendacao do refino. **#54 avanca para Arquitetura.**

## Rodada 121 (refino da guarda de elegibilidade, #55 / H-042 — 137-REFINO-H042.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **563 e 568** guarda unica nova que chama `professional_eligible` (H-016, exige e-mail verificado) e `commercial_access`, com troca do corpo da funcao de visibilidade da #45 por nova migracao; **565** "revogado" (RF-050) mapeia para `suspensa`; **566** a decisao 421 passa a valer com e-mail verificado exigido no modo descoberta/aceite (a opcao sem e-mail da migracao 20261113230000 sera substituida); **574** aceite vigente quando o trial vence: mantem ate o fim do pedido (H-074); **579** a #55 divide-se em parte A (guarda unica: agora) e parte B (aceite #71, fotos #69 e rota de descoberta #68: depois), sem criar cartao novo; **580** dependencia de H-058 sobre H-042 registrada como nao verificada; demais (564, 567, 569 a 573, 575 a 578, 581, 582) conforme a recomendacao do refino. Guarda: modo descoberta_aceite exige aprovacao, conta ativa, e-mail verificado e acesso vigente; modo participacao nao exige acesso vigente; fail closed; resposta uniforme para negado e inexistente. **#55 avanca para Arquitetura (parte A).**

## Rodada 122 (desenho do estado da verificacao, #54 / H-041 — 141-DESENHO-H041.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **623** o estado publico e' lido do caso, nao do perfil; **624** suprimir tambem a explicacao na recusa por duplicidade; **625** a restricao de recurso (so `recusada`, uma vez) fica numa funcao-envelope nova, sem editar a funcao da #52; **626** rotas `GET /v1/professional/verificacao` e `POST /v1/professional/verificacao/recurso`; **627** 401 sem sessao ou com sessao de console, 404 uniforme se nao ha perfil, 409 `recurso_indisponivel` identico para os tres motivos; **628** incluir o renderizador `apps/web/public/profissional-situacao.js` (sem casca web); **629** reservar o prefixo `20261113320000` para a #54 (migracao `verification_create_professional_state`); **630** a data da aprovacao vem de `case.decided_at`, com `verified_at` de reserva; **631** acrescentar `analisado` em `recurso.situacao` (desvio do contrato do refino, aceito); **632** "so o proprio profissional" depende da sessao na API, como nas #52 e #53, com teste de rota. **#54 fica em Arquitetura concluida (pronta)**: o Desenvolvimento so depois da #53 concluida (decisao 559) e sem rodar em paralelo com a #55 nos arquivos de composicao da API.

## Rodada 123 (desenho da guarda de elegibilidade, parte A, #55 / H-042 — 142-DESENHO-H042.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **640** `p_now` obrigatorio, sem default; **641** `discover_requests` ganha `p_now` com o mesmo nome e a versao de 5 argumentos e' removida na mesma migracao; **642** os fixtures de teste das #45 e #46 (profissional sem e-mail verificado ou sem acesso comercial) sao ajustados so em arquivos de teste, sem devolver cartoes de coluna; **643** a fachada mantem o `raise 22023` para parametro nulo e a guarda nova devolve `false`; **644** a fachada `request_visibility_guard` permanece ate a H-055, com consumidores novos chamando a guarda direto; **645** negacao de aceite com corpo uniforme `{code:"indisponivel"}`. Migracao `20261113400000_eligibility_expand_professional_access_guard.sql`. **#55 fica em Arquitetura concluida (pronta)**: o Desenvolvimento da parte A so depois que o QA das #45 e #46 terminar (a troca da fachada mexe nas funcoes que elas usam).

## Rodada 124 (refino do perfil publico, #56 / H-043 — 138-REFINO-H043.md, feito pelo agy, saida 0 conferida)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **583 a 602 conforme a recomendacao do PO no refino (secao 12)**, em resumo: rota publica `GET /v1/public/professionals/:slug` por slug (nao por UUID, 601); 404 uniforme para perfil inexistente, nao aprovado ou retido (584); selo "Verificado" com o texto de limitacao de responsabilidade como [PROPOSTA] de modelo no DEV, revisao juridica antes de producao, sem pergunta ao usuario agora (586); nenhum telefone, WhatsApp ou e-mail no perfil (594); contrato de avaliacao `count: 0` com "Ainda sem avaliacoes" (590); limite de taxa na rota (596); `noindex` no DEV (599); sem casca web: modulo de apresentacao (597); servico regulamentado sem certificacao (#51) nao e' exibido como verificado (592). **#56 avanca para Arquitetura.**

## Rodada 125 (desenho do perfil publico, #56 / H-043 — 143-DESENHO-H043.md)
Adotadas como RECOMENDADAS pelo lider (o usuario pode vetar): **650** cidade/UF, rotulo PF/PJ e botao "Solicitar servico" ficam FORA desta versao (a lista fechada nao os contem e a base e' privada); CA-12 vira prova negativa; diverge das recomendacoes 588a, 589a e 595a do refino; **651** o texto do selo vai no corpo da API (`verificationBadge`), acrescentado pelo dominio; **652** `execute` so para `app_system` (diverge da 598a); **653** cache de borda pode manter perfil suspenso visivel por ate ~15 min: aceito no DEV, reavaliar antes de producao; **654** limitador de taxa reutiliza o existente, senao em memoria declarado como limite do DEV; **655** diretiva de robos por constante, `noindex` no DEV; **656** slug mal formado = 404; **657** perfil aprovado com caso aberto = 404 (fail closed); **658** servico regulamentado listado sem marca de certificacao; **659** servicos sem identificador publico; **660** prefixo `20261113410000` reservado a #56 (`profile_create_public_profile_read`); **661** entrega de apresentacao sem pagina HTML. **#56 fica em Arquitetura concluida (pronta)**; Desenvolvimento so depois da #53 concluida e sem paralelismo com #54/#55 nos arquivos de composicao da API.

## Rodada 126 (entrega da #37, 2026-11-14)
- **#37 (H-024) Desenvolvimento entregue (banco e dominio)**: migracao 20261113220000 aplicada (`db:status` 82 aplicadas, 0 pendentes), dbtest 12/12 (apos duas rodadas com deadlock por contencao de outras sessoes), dominio 6/6, adaptador e migracao estatica 19/19, audit D-02b passa, tipos 17/17; os arquivos de dominio e adaptador entraram no commit e7c1425 (da #45): registrar no historico. **Correcao de fato:** o relatorio do DEV disse que #36 e #49 estao no Backlog; ambas estao CONCLUIDAS (a #36 pela Rodada 91 e a #49 pelo usuario) e as funcoes de descoberta existem no DEV. Decisoes do lider: a parte de API (campo `cobertura` no estado do pedido do dono e `GET /pedidos/:id/estado`, T-C09 e T-C10) passa para o escopo da **#47** (painel do cliente); T-C03/T-C13 (plano de consulta com 50.000 bases) ficam como pendencia declarada ate haver volume; CA-11/BK-5 (textos com e sem cobertura): modelo [PROPOSTA] no DEV, aprovacao do dono antes de producao; elegibilidade (D-H024-3) depende da #55 parte A; ajustes documentais D-6 (08 §9.4, 14-BACKLOG, 11-ARQ §2.2, 09) ficam com o lider em lote. `eslint` ignora `**/coverage/**` no dominio (configuracao raiz): corrigir restringindo o ignore a raiz, em tarefa da #149. Vai para Code Review via agy como entrega parcial.

## Rodada 127 (mais agentes, 2026-11-14)
- **Pedido do usuario: nao parar nunca, mais agentes.** Entram em Product Owner, via agy (segunda cadeia, em paralelo com a primeira): **#120** (direitos do titular, `dsr_case`), **#131** (app Expo base) e **#123** (runbook de incidente e reconciliacao). Refino so de documento; sem codigo, banco, Mapbox ou backup.
- **261:** a coordenacao informou que o usuario CONFIRMOU explicitamente a limpeza dos dados de teste do banco de desenvolvimento, no escopo estrito (so marcador de teste e mais de 2 horas; sem tocar pedidos, auditoria, rascunhos ligados a pedidos; sem CASCADE, TRUNCATE nem desligar gatilhos). Dry-run relancado; a execucao vem depois da conferencia do dry-run.

## Rodada 128 (fechamentos e novas frentes, 2026-11-14)
- **#45, #53 e #46 CONCLUIDAS** (WF-03). QA via agy: as tres APROVADAS COM RESSALVAS (saidas 0 conferidas). Ressalvas aceitas: #45: M2 de contracao e backfill dependem de `ADDRESS_ENC_KEY` (so o dono grava), CA-09, CA-10 e CA-18 pendentes declarados; #53: T40-08 (aceite, epico E6) postergado, oscilacao do `audit.dbtest` e' contencao no banco compartilhado, T40-09 sanado pela #57; #46: revelacao do telefone parcial ate o aceite (E6, decisao 448) e check:all vermelho por outras historias (Issue 149). Autorizacao: o usuario autorizou concluir as Issues que chegam a Aguardando aprovacao sem consulta (2026-11-11, reiterada em 2026-11-13).
- **#37 Code Review via agy APROVADO TECNICAMENTE** (saida 0) e vai para QA via agy. **Refinos feitos pelo agy:** #68 e #51 (saidas 0; arquivos de refino a revisar pelo lider na proxima rodada).
- **Instrucao do usuario (mensagem com imagem nao visivel a este agente): "um agente por atividade ou o quanto puder".** Entram em Desenvolvimento, cada uma com seu agente: **#54, #55 (parte A), #56 e #47**. Regra de migracoes entre estas quatro: cada DEV calcula o prefixo no momento de criar (maior prefixo existente + 10000) e aplica a migracao logo em seguida com `corepack pnpm db:migrate`; se o executor acusar "pendente fora de ordem", o DEV renomeia SO a propria migracao ainda nao aplicada para um prefixo maior; ninguem edita nem renomeia migracao aplicada ou de outro. Edicoes em arquivos compartilhados (app.ts, composicao.ts, barris) sao feitas relendo o arquivo atual e commitando em seguida.

## Rodada 129 (estado da #47, 2026-11-14)
- **#47 (H-034) segue em Desenvolvimento; NAO vai para Code Review.** Feito: dominio (e1696f5, 16/16), migracao 20261113430000 aplicada na ordem com as das #54 (320000) e #55 (420000) (92e24f3, estatico 12/12), adaptador e dbtest 9/9 (dc1e417), servico, rota GET /v1/requests e cookie de limpeza do rascunho na publicacao (2a72d2e, publicacao 39/39); `db:status` 86 aplicadas, 0 pendentes. O dispatch em `app.ts` entrou no commit 587d540 da #54 (arquivo compartilhado). Faltam: testes de rota e servico (T-02, T-08, T-11, T-12, T-14, T-17), T-10 (cookie), T-03 em HTTP, audit D-02b, eslint, `check:all`, `typecheck --force`, e ligar `montarListaPedidos` na entrada do servidor. Desvios aceitos pelo lider: 405 para metodos diferentes de GET nao implementado (POST segue para a publicacao e os demais caem no 404 da publicacao, regra da #44); cursor com dia 31 de fevereiro vira 503 (risco baixo, declarado); API de cobertura da #37 nao prevista no desenho 133: pendencia declarada.

## Rodada 130 (entrega da #54, 2026-11-14)
- **#54 (H-041) Desenvolvimento entregue** (4819132, 8dacc88, 4bd94ad, 587d540, 1de5fc8): migracao 20261113320000 aplicada (`db:status` 86 aplicadas, 0 pendentes); dbtest 10/10 e estatico 7/7; dominio 44; rota 11/11; renderizador 6/6; tipos 17/17; audit D-02b passa (25/25). Decisao do lider: segue para Code Review via agy com as pendencias declaradas: T41-07b (concorrencia de dois POST), T41-18 (aplicar/reverter/reaplicar em banco descartavel: nao existe; fica estatico), regressoes de verificacao a rodar no QA, T41-15 e T41-16, T41-09 com cookie de admin, documentacao (09, 08, 05, 14-BACKLOG) a fazer em lote pelo lider, e conferir a falha de `composicao-caso.test.ts` (pendencias do caso de acesso H-073: pode ser alteracao nao commitada de outro agente em `composicao.ts`). Desvios aceitos: titulo como frase principal; explicacao so com motivo visivel; motivo `aprovado` suprimido; `analisado` como aviso (631).

## Rodada 131 (estado da #56, 2026-11-14)
- **#56 (H-043) segue em Desenvolvimento; NAO vai para Code Review.** Backend pronto e verde: migracao 20261113410000 aplicada (`db:status` 86 aplicadas, 0 pendentes), contrato e adaptador (1610ba6), rota `GET /v1/public/professionals/:slug` (97d2f5c), testes (b3dd1d9, d0cb59a), composicao e registro (d98d072); API 24/24, contrato 5/5, dominio 15/15, estatico 8/8, tipos 17/17. Transparencia: o historico de `vercel.ts` tem estados intermediarios errados (commits 00a1cab e 63efd50); o HEAD final (0cc47bf) tem uma linha `publicProfile` e uma `requestList`. Faltam: renderizador `apps/web/public/profissional-perfil.js` e CSS com tokens e testes T43-13, 14, 15, 17; T43-04, 05, 07, 09 a 12, 19; documentacao 09 e 08; barril opcional. Pendencias menores aceitas: rota sem montagem responde o corpo do rascunho; `/v1/public/professionals` sem slug cai no 404 generico; limite de 60/min em memoria por instancia (decisao 654).

## Rodada 132 (estado da #47, 2026-11-14)
- **#47 (H-034) segue em Desenvolvimento.** Feito nesta continuacao: acb0b82 (503 com Retry-After na lista; publicacao repetida tambem limpa o cookie), 403afd9 (testes T-02, T-03, T-08, T-10, T-11, T-12, T-14, T-17), 3bde672 (lista ligada na composicao do servidor); 89/89 nos arquivos da Issue e vizinhos; audit D-02b 25/25; dominio 16/16; adaptador 5/5; estatico 12/12; tipos 17/17. **Falha aberta:** T-16 do dbtest (8 de 9): o plano usa `service_request_cliente_status_idx` com Sort em vez do indice novo `service_request_cliente_recente_idx` (hipotese nao confirmada: indice ausente no banco ou plano diferente por volume de dados); o DEV nao pode conferir `pg_indexes` (nao leu o `.env.local`: correto). A proxima continuacao confere com `db:status` e uma consulta somente leitura pelo `connect()` do repositorio. **Defeito achado na #45 (concluida), a corrigir pela #47 de forma aditiva:** `apps/api/src/vercel.ts` nao repassa `requestDetail` (so requestPublish, requestContact, requestList, publicProfile), entao em producao `GET /v1/requests/:id` responde 404 uniforme; ligar `requestDetail` (e registrar no historico da #45). Desvios aceitos: Content-Type `application/json; charset=utf-8`; assercao da H-073 em `composicao-caso.test.ts` relaxada (a lista abre o mesmo cliente pela mesma fabrica); T-03 em HTTP com visibilidade falsa (prova de banco e' a da #45); T-08/T-09 de tela so no nivel de dominio (decisao 518).

## Rodada 133 (estado da #55 parte A, 2026-11-14)
- **#55 (H-042) parte A segue em Desenvolvimento; NAO vai para Code Review.** Feito: 21917c8 (guarda unica `private.professional_access_guard`, dominio e adaptador, `discover_requests` com 6 argumentos); migracao 20261113420000 aplicada (o `db:migrate` aplicou junto as pendentes 320000 da #54, 410000 da #56 e 430000 da #47, na ordem: comportamento previsto da regra da Rodada 128; `db:status` 86 aplicadas, 0 pendentes); dominio 9/9, adaptador 4/4, estatico 9/9, tipos 17/17. Linha de base do `db:test` antes: 256 ok e 7 not ok (CA-H105-01, CA-H105-09, T-H104-26, T-09 CA-11, T-BK-09, T-H018-13, T-06 "nenhum job ou gatilho de tempo"): falhas ja conhecidas ou de contencao. Hashes md5(prosrc) de `discover_scan`, `professional_eligible` e `commercial_access` registrados antes da migracao (T-15/T-16). Falta: corrigir T-01 da guarda (comparar `proconfig` com `startsWith('search_path=')`) e T-06 (fixture de trial expirado respeitando `access_grant_trial_14d`); investigar regressao de T-D08/T-D09/T-D10 da #36 ("esperado 2, obtido 3") ligada a nova assinatura; paridade T-07, T-08, T-13, T-14; T-18 no banco; custo com 1.000 pedidos; commitar fixtures e testes (auxiliar `packages/db/tests/fixtures/professional-access.mjs`, ajustes nos testes das #45, #46 e #36, adaptador da #36).

## Rodada 132 (entrega da continuacao da #56, 2026-11-14)
- **#56 (H-043) pronta para Code Review, a confirmar pelo lider no quadro.** Backend da Rodada 131 mais renderizador `apps/web/public/profissional-perfil.js` e CSS com tokens (commit 17dcf56), testes de apresentacao T43-04, 05, 13, 14, 15 e 17 em `apps/web/tests`, e testes T43-07 (caso em revisao), T43-12 (sem localizacao) e T43-19 (imutabilidade com auditoria) no banco e no dominio (commit ffb9c95).
- **Ajuste de apresentacao (dec. 661):** a tela recebe os rotulos fixos das secoes, das modalidades e do detalhe do selo (`textos` e `rotuloLimites`), para o script nao ter frase propria. O detalhe do selo usa o rotulo "Limites do selo", novo texto em `PUBLIC_PROFILE_TEXTS` sem as palavras proibidas.
- **Desvio do desenho:** o icone decorativo do selo (§6.3) nao foi criado, para nao inventar elemento visual; o estado do selo vai por texto.
- **Caso em revisao no banco:** a restricao `vc_revisao_com_responsavel` exige responsavel; o teste cria um revisor sintetico em `pendente_mfa` na transacao, desfeita ao fim.
- **Pendencias declaradas:** inspecao em navegador real (T43-13 e T43-15, `NAO_EXECUTADO`); o teste estatico de migracao roda pelo vitest do pacote de banco, nao pelo `node --test`.
- **Decisoes mantidas:** texto do selo segue modelo [PROPOSTA] com revisao juridica antes de producao (BLQ-JUR L7); cache (dec. 653) e limite em memoria (dec. 654) continuam como registrados.

## Rodada 134 (entrega da #47, 2026-11-14)
- **#47 (H-034) Desenvolvimento entregue** (737bc9f T-16 mede o plano com 1000 pedidos e `analyze`; 965aa5b `vercel.ts` repassa `requestDetail` (defeito da #45 corrigido); b39248e teste de montagem): T-16 era escolha de custo do planejador com tabela pequena, nao indice faltando (o indice `service_request_cliente_recente_idx` existe); dbtest 9/9; 62/62 nos 7 arquivos da API; tipos 17/17. **Decisao do lider:** o efeito colateral do `analyze` do T-16 sobre as estatisticas de catalogo do DEV (`reltuples` 1051 em `app.service_request` com 51 pedidos reais) e' ACEITO (o autovacuum recalibra); nao autorizo `ANALYZE` fora de transacao. Pendencias declaradas: T-03 em HTTP, API de cobertura da #37, `check:all` nao rodado nesta continuacao (Issue 149). Vai para Code Review via agy.

## Rodada 135 (entrega da #56, 2026-11-14)
- **#56 (H-043) Desenvolvimento entregue** (17dcf56 renderizador e CSS com rotulos no dominio; ffb9c95 T43-12, T43-07, T43-19; ce16022 documentos 08 e 09; c5f0586 lint): dominio 16/16, renderizador 17/17, dbtest 26/26, estatico 8/8, audit D-02b 25/25, tipos 17/17. Nota de numeracao: a nota que o DEV acrescentou ao 11-DECISOES com o titulo "Rodada 132" colide com a Rodada 132 do lider (estado da #47); vale a numeracao do lider e a nota do DEV e' lida como "Rodada 132b (#56)". Pendencias declaradas: T43-13 e T43-15 em navegador real (nao executado); icone decorativo do selo nao criado; casca web fora de escopo (decisao 661); revisao juridica do texto do selo antes de producao. Vai para Code Review via agy.

## Rodada 136 (Code Review e QA via agy, 2026-11-14)
- **#54, #47 e #56 APROVADAS TECNICAMENTE no Code Review (agy, saidas 0 conferidas)** e vao para QA via agy, em cadeia unica (#54, #47, #56) para limitar a contencao no banco.
- **#37 QA via agy: APROVADO COM RESSALVAS** (saida 0): banco 12/12, dominio 6, adaptador e migracao estatica 19. Decisao do lider: a #37 fica em **Aguardando aprovacao, NAO concluida**, porque a parte de API (`cobertura` no estado do pedido do dono, T-C09 e T-C10) ainda nao existe; um DEV a entrega agora (sem rodar em paralelo com mudancas nos arquivos de composicao de outros); depois a #37 conclui pela autorizacao permanente.
- **Refinos pelo agy prontos (saidas 0):** #68, #51 (reexame), #120, #131 e #123: arquivos 139, 140, 144 a 146 a revisar pelo lider (adocao das recomendacoes e avanco para Arquitetura) na proxima rodada.

## Rodada 137 (parte de API da #37, 2026-11-14)
- **#37 (H-024) parte de API entregue** (cb07ab8: campo `cobertura` booleano so na leitura do dono, `GET /v1/requests/:id`; `true`/`false`/`null`; chave ausente em pedido nao `publicado` ou fora do prazo (CA-08); IP so como HMAC com `PEPPER_IP_HMAC`; textos [PROPOSTA] numa constante do dominio; `OWNER_KEYS` com 12 chaves; `ELIGIBLE_PROFESSIONAL_KEYS` inalterada; T-C09 e T-C10): API 55/55 nos arquivos afetados e 1066 na suite completa, dominio 907/907, tipos 17/17. Desvios aceitos: rota existente da #45 em vez de `GET /pedidos/:id/estado`; campo ausente (nao `null`) em pedido fechado. Riscos registrados: `PEPPER_IP_HMAC` precisa existir no ambiente (so o dono grava; sem ele o campo sai `null`); IP via proxy; limite de 20 por hora por pedido. Vai para Code Review via agy (delta cb07ab8) e QA; BK-5 (aprovacao dos textos) segue como modelo [PROPOSTA] ate antes de producao.

## Rodada 138 (verificacoes de Code Review e QA via agy, 2026-11-19)
- **Um agy por vez, QA so caminho feliz por API/servico, sem tela e sem `check:all` (bateria completa fica para o fim).** Locks do `execctl.py` (EXEC-QA-54, EXEC-QA-47, EXEC-CR-56, EXEC-QA-56, EXEC-CR-55, EXEC-QA-55, EXEC-CR-37, EXEC-QA-37, todos de 2026-11-19), todos com saida 0 do agy conferida.
- **#54 QA APROVADO:** dominio 11/11, rota 11/11, dbtest 10/10, migracao estatica 7/7 (saida 0; o lider reexecutou dominio, rota e migracao: 11, 11, 7, saida 0). CA de tela (12, 14, 15) NAO EXECUTADO. Code Review aprovado na Rodada 136.
- **#47 QA APROVADO COM RESSALVAS:** dominio 16, API 38, banco 17 e dbtest 9, saida 0. Ressalvas: T-03 em HTTP real e telas NAO EXECUTADOS; casca web nao existe (D-518).
- **#56 Code Review APROVADO** (saida 0; dominio 16, API 16, contratos 5, web 17, migracao estatica 8, typecheck 17/17; achados SUGESTAO: `#NNN` num comentario do rollback; ALTERACAO NAO COMMITADA em `apps/api/src/vercel.ts` (inversao de duas linhas e fim de linha), de origem desconhecida, nao incluida em nenhum commit; o HEAD esta correto) e **QA APROVADO COM RESSALVAS** (dominio 16, contratos 5, API 16, migracao 8, dbtest 26/26, saida 0; T43-13, T43-14 e T43-15 NAO EXECUTADOS).
- **#55 (parte A) Code Review APROVADO** (saida 0; dominio 9, banco 17, typecheck 17/17; achados SUGESTAO: `#NNN` em comentarios) e **QA APROVADO** (dominio 9, banco 17, dbtest guarda 11/11, paridade 6/6, saida 0). Os testes de adaptador e dominio e as fixtures que estavam fora do Git foram commitados (f68fce3). **Criterios [B] (CA-06, 09, 13, 16) NAO EXECUTADOS: dependem de #68, #69 e #71.** A #55 fica em Aguardando aprovacao como parte A, nao concluida (mesmo tratamento da #37).
- **#37 parte de API (cb07ab8) Code Review APROVADO** (saida 0; dominio 31, API 55, suites completas dominio 907 e API 1066, typecheck 17/17; achado SUGESTAO: IP via proxy) e **QA APROVADO** (dominio 25, API 32, saida 0). BK-5, `PEPPER_IP_HMAC` no ambiente e T-C03/T-C13 seguem como pendencias.
- **Cartoes #54, #47, #56, #37 e #55 movidos para Aguardando aprovacao** (veredito registrado; nenhum concluido). #120 e #51 foram para Arquitetura (refino do agy, recomendacoes adotadas pelo lider), mas o `execctl` tem vaga unica e as execucoes de Arquitetura foram canceladas para depois; #68 espera a #55 concluida.

## Rodada 139 (Arquitetura da #51, 2026-11-19)
- **#51 (H-038) Arquitetura entregue** (148-DESENHO-H038.md, EXEC-ARQ2-51-20261119; perguntas 300 a 319 adotadas pelo lider; migracao prevista 20261113440000, aditiva em `app.identity_document`, sem `media_asset`). Risco R-01: certificacao recusada pela Verificacao pode continuar `recebido` e liberar o gate; o DEV deve ler `verification_case_decide` antes de codar e devolver ao lider se precisar mudar a #52. R-02, R-03 e R-07 a confirmar no codigo. Sem duvida que exija o dono. #51 vai para Desenvolvimento. #120: Arquitetura em segunda tentativa (a primeira parou no limite de turnos sem documento).
- **#120 (H-111) Arquitetura entregue na segunda tentativa** (147-DESENHO-H111.md, EXEC-ARQ2-120-20261119; perguntas 663 a 682 adotadas pelo lider; as de ordem juridica seguem [PENDENTE JURIDICO] e rodam como [PROPOSTA] em DEV). Desvios do refino aceitos: indice unico parcial inclui `deferido` (D-A1); coluna real `app_user.status`, CHECK ampliado com `em_eliminacao` e `anonimizado`; download do extrato por URL assinada de 5 minutos e uso unico (D-A6). Confirmar no DEV (DV-6) nomes fisicos de tabelas de chat, review, billing.subscription, app_session, `legal_hold.subject_ref`, step_up e papel dpo. **Prefixos de migracao para nao colidir em paralelo: #51 usa 20261113440000 a 20261113459999; #120 usa 20261113460000 em diante.** #51 e #120 vao para Desenvolvimento (um DEV por Issue; edicoes em arquivos compartilhados so aditivas, commit so dos proprios arquivos).

## Rodada 140 (conclusao pelo usuario, 2026-11-19)
- **O usuario concluiu #54, #47, #56, #37 e #55 (decisao humana)**; o quadro local (`quadro-status.md`) ja reflete isso (Concluido 75). O orquestrador NAO devolve nenhuma delas a Aguardando aprovacao nem edita essas linhas. Pendencias dessas Issues (telas, parte B da #55, textos BK-5 etc.) seguem registradas nas Rodadas 138, e a parte B da #55 sera tratada nas Issues #68, #69 e #71.

## Rodada 141 (execucao em paralelo, 2026-11-19)
- **Limite de execucoes simultaneas elevado de 4 para 6 pelo usuario** (`execctl.py` com `MAX_SLOTS=6` e uma execucao ativa por Issue). QA e Code Review pelo agy seguem um por vez.
- **#68 (H-055) Arquitetura entregue** (153-DESENHO-H055.md; perguntas 603 a 622 adotadas pelo lider) e Desenvolvimento em fatias: 7576f6d (dominio e cursor cifrado) e fc6cdc3 (adaptadores de projecao e limite de taxa); dominio 934 testes e db 14, saida 0. Desvio aceito: cursor em `packages/domain`. `has_more = (linhas == limit)` porque o banco recusa limite 201. Faltam servico, rota e testes de privacidade. #68 em Desenvolvimento.
- **#51 (H-038)** banco entregue (fb6db92; estatico 29/29, dbtest 17/17). A migracao 20261113440000 estava aplicada no DEV com checksum de um rascunho; as 8 funcoes tinham corpo identico; o orquestrador reaplicou o arquivo final e atualizou o checksum (`db:status` sem problema). Falta dominio e API.
- **#120 (H-111)** fatias 1 a 3 aplicadas e testadas (3bf55f0, 6618f91, 57584be; db:status 90 aplicadas, 0 pendentes; dbtests 13, 9 e 8 aprovados). Pendencia aceita: o guard de login precisa bloquear `em_eliminacao` e `anonimizado` antes da fatia 4; a constraint existente `app_user_anonimizado_consistente` aceita retention_state nulo (buraco da area de retencao, fica como pendencia).
- Os agentes de Desenvolvimento usam o token da CLI (TOKEN_SUPABASE_FULL do .env.local, sem imprimir) para aplicar migracoes no DEV, como regra permanente do dono. Atribuicao: trailers dos commits dos agentes vieram como Claude Haiku 5.5; os novos prompts exigem Sonnet 5.5.

## Rodada 142 (Code Review #51, desenhos e testes de banco, 2026-11-19)
- **#51 Code Review via agy APROVADO TECNICAMENTE** (EXEC-CR-51-20261119, saida 0; 103 testes aplicaveis, saida 0). Achados: AC-01 IMPORTANTE (risco R-01: certificacao recusada por `certificacao_insuficiente` continua `recebido` e `certificacoes_completas` segue verdadeira; exige alteracao na decisao da Verificacao, Issue 52 concluida) e duas sugestoes (T-05 concorrente sem commits reais; 409 `upload_em_uso`). **Decisao do lider:** AC-01 vira pendencia aberta da #51 a tratar antes de producao e antes de concluir (marcar o documento com `purge_requested_at` quando a recusa for registrada); QA caminho feliz em andamento.
- **Arquiteturas entregues, recomendacoes adotadas pelo lider:** #149 (154-DESENHO-CHECKALL.md, decisoes 800 a 808, excecoes estreitas, 8 fatias), #146 (155-DESENHO-DBTEST-146.md, decisoes 810 a 814), #147 (156-DESENHO-DBTEST-147.md, decisoes 800 a 804). Colisao de numeracao: 800 a 804 aparecem em #149 e #147; vale o numero com a Issue (800-149 a 808-149; 800-147 a 804-147).
- **#147 Desenvolvimento entregue** (c51343f; 6 testes, 4 passam, 0 falham, 2 pulados por limite conhecido do ciclo destrutivo completo; reexecutado pelo orquestrador com o mesmo resultado, saida 0). Em Code Review (fila do agy).
- **#68 entregue em fatias** (7576f6d, fc6cdc3, 140fa07, 4b78f02, fb8ec0b), **#120 fatias 1 a 5** (ate 5da380c), **#51** (fb6db92, 9272398, 7e59368). Falta Code Review e QA da #68 (fila do agy).
- **Incidente de processo:** um segundo agy foi iniciado por engano em paralelo ao QA #51 (script com gatilho errado); foi encerrado em seguida e o lock EXEC-CR-147-20261119 marcado como FALHA. A fila do agy esta serializada por arquivo-marcador (51, 68, 147).

## Rodada 143 (#120 fatia 6 e decisoes do lider, 2026-11-19)
- **#120 fatia 6 entregue** (c517f55; migracao 20261113510000 aplicada no DEV, 94 migracoes; estatico 14/14, dbtest 11/11, saida 0): `private.dsr_anonymize_subject` anonimiza a conta do titular, revoga sessoes e step-up, fecha o caso e audita; 8 recusas com erro explicito.
- **Decisoes do lider sobre as pendencias P1 a P10 (adotadas, vetaveis):** P1 e P2 (titular profissional e cliente com pedido com conteudo imutavel) ficam RECUSADOS e o caso fica em `deferido`; viram Issue propria quando o dono pedir. P3 aceito (limpar o match de pedido encerrado; a descoberta usa so `status = 'publicado'`, conferido em 20261113210000). P4 aceito. P5: o aviso final de eliminacao fica so na tela, sem e-mail (DV-5 retirada). P6 mantida (dpo_externo recusado). P7 e P8 aguardam as tabelas e motivos. P10: a funcao so fica acessivel a funcoes `app.*` na fatia 7.
- Fatias 7 e 8 em Desenvolvimento (EXEC-DEV-120G-20261119). Pendencia conhecida do pacote de banco (nao desta Issue): `request-list-migration.test.mjs` exige prefixo maior que as migracoes existentes e `challenge-consume-wiring.test.ts` (503 em vez de 200); a conferir antes do gate.

## Rodada 144 (QA #51 e fila de Product Owner, 2026-11-19)
- **#51 QA via agy APROVADO** (EXEC-QA-51-20261119, saida 0; 96 testes: dominio 30, API 17, migracao estatica 29, dbtests 17 e 3; criterios de tela NAO EXECUTADOS). Code Review aprovado na Rodada 142. **#51 em Aguardando aprovacao, com a pendencia aberta AC-01 (R-01)**: certificacao recusada por `certificacao_insuficiente` continua `recebido` e o gate segue liberado; tratar antes de producao e antes de concluir (decisao humana).
- **Pedido do usuario: mais Product Owner trabalhando.** Fila de PO pelo agy (um agy por vez), na frente de Code Review e QA das Issues #68, #147 e #146: #69 (H-056 fotos a elegiveis), #71 (H-058 aceitar trabalho), #109 (H-099 lembretes), #137 (H-101 canal no site) e #124 (H-115 autorizacao por recurso e paridade); perguntas numeradas a partir de 830 (cada Issue com faixa de 20). Todas as dependencias conferidas no quadro; #60 a #67 (pagamento) ficam de fora.

## Rodada 145 (retomada apos sessao encerrada, 2026-11-20)
- **Estado verificado:** a sessao anterior morreu apos EXEC-QA-149-20261119 (17:20 de 19/11) sem registrar os vereditos de Code Review e QA das Issues #68, #147, #146 e #149 (os locks do `execctl` mostram so "agy saida 0"; nenhum comentario no GitHub nem arquivo guarda o veredito). **Decisao do lider:** nao presumir aprovacao; refazer Code Review e QA via agy, em fila serial (um agy por vez), com locks `EXEC-*-R-20261120`: #68, #147, #146, #149 (e o refino de PO da #69, que tinha falhado em 19/11). Prompts reaproveitados de `D:/Fabrica/.agy-tmp`.
- **#120:** o lock `EXEC-DEV-120G-20261119` estava expirado sem processo vivo (reconciliado como FALHA com evidencia). A fatia 7 estava commitada (2c5f301); a fatia 8 (jobs, migracao 20261113530000) ficou sem commit. Novo DEV (EXEC-DEV-120H-20261120). A faixa de migracoes da #120 passa a 20261120000000 a 20261120099999 caso a 530000 ainda nao esteja aplicada (o executor recusa prefixo menor que o maior aplicado, 20261119100000 da #68).
- **Product Owner → Arquitetura (recomendacoes dos refinos adotadas pelo lider, vetaveis):** #71 (H-058), #109 (H-099), #124 (H-115), #123 (H-114). Faixas de migracao: #71 20261120100000-199999; #109 20261120200000-299999; #124 20261120300000-399999; #123 20261120400000-499999. Desenhos a gravar como 162 a 165.
- **Mantidas no Product Owner (dependem de outra historia inacabada):** #137 (H-101; precisa das tabelas de chat das #71, #76 e #77) e #131 (H-122; fase mobile depois do MVP web, SD-13). #69 aguarda novo refino. O Dev da #71 so fecha depois da #68 estabilizada.

## Rodada 146 (fechamentos e novas frentes, 2026-11-20)
- **#68 (H-055) Code Review via agy APROVADO TECNICAMENTE** (EXEC-CR-68R-20261120, saida 0; achados so SUGESTAO: `has_more` igual a `limit` pode gerar uma pagina vazia; chave do limitador derivada da chave do cursor) e **QA via agy APROVADO** (EXEC-QA-68R-20261120, saida 0; dominio 27, API 30, banco 14, dbtest 3: 74 testes, saida 0; criterios de tela NAO EXECUTADOS). **#68 em Aguardando aprovacao.** A #71 (fatias 5 e 6) pode seguir.
- **Arquiteturas entregues (as tres primeiras tentativas pararam no limite de 16 turnos sem documento; as segundas, com "gravar cedo", entregaram), recomendacoes adotadas pelo lider:** #71 (162-DESENHO-H058.md; 850 a 869; pontos vetaveis A-1 tabelas minimas de chat criadas pela #71, A-5, A-6, R-12), #109 (163-DESENHO-H099.md; 870 a 889; A-1 job recorrente `reminder.scan` a cada 5 min; A-3 tolerancia de atraso [PROPOSTA]; fatia 7 do ciclo pago NAO INICIAR, depende de #60 a #63), #124 (164-DESENHO-H115.md; 910 a 929; F0 a F5, casos futuros `deferred`) e #123 (165-DESENHO-H114.md; 703 a 722; S1 a S8; sem migracao obrigatoria).
- **Achado a tratar (nao e escopo de #123):** o desenho da #123 (R-09) acusa que ainda existem artefatos de backup no repositorio (`db:backup`, `packages/db/scripts/backup.mjs`, testes `backup*.test.mjs`, papel de banco na migracao 20261110180000), embora a #151 conste concluida. Registrado como pendencia para verificacao pelo lider; nenhum cartao novo sem pedido do usuario.
- **Desenvolvimento em paralelo (cada um com o seu agente, commit por fatia):** #120 (continuacao 2), #123 (S1 a S8), #124 (F0 a F5), #109 (fatias 1 a 6, a 7 NAO INICIAR) e #71 (fatias 1 a 4; 5 e 6 depois).

## Rodada 147 (decisoes do lider sobre os relatorios de Desenvolvimento, 2026-11-20)
- **Git com indice compartilhado:** dois commits de agentes levaram arquivos alheios (663a7a3 e 98064ac); ambos corrigidos sem reset (commits refeitos antes de publicar). Regra a partir de agora: todo agente commita com `git commit --only -- <caminhos>`.
- **#123:** (1) defasagem do tick sem job concluido no DEV = "sem historico" informativo; (2) L-1 (rotacao da chave de cifra, so leitor versao 1) e L-2 (janela de segredo do webhook) ficam como pendencias fora da #123; (3) migracao condicional `admin.session.revoked` AUTORIZADA se o catalogo for fechado; (4) artefatos de backup remanescentes NAO sao tratados na #123.
- **#109:** o tick HTTP nao esta montado e pg_cron esta desativado pelo dono: o disparo automatico dos lembretes depende de uma Issue propria do tick (pendencia registrada; nenhum lembrete sai sozinho no DEV ate la). Fatia 7 (ciclo pago) vira Issue irma futura (nao criada agora).
- **#124:** achado CAT-06 (8 funcoes `private.dsr_*` de gatilho com EXECUTE para public/anon/authenticated): migracao `20261120300000_authorization_revoke_dsr_trigger_execute` AUTORIZADA (so grants). Achado: papel de banco `app_backup_reader` existe com LOGIN e BYPASSRLS, resto de backup apesar da #151.
- **#71:** chave de idempotencia = UUID v4 estrito; CHECK de codigo curto em `removed_reason`/`restricted_reason` mantido; tabelas `app.acceptance`, `app.conversation`, `app.message` criadas pela #71 (A-1); migracao 20261120100000 aplicada; #46 sera ajustada na fatia 3 (R-09).
- **Atribuicao de commits:** agentes reportam que o modelo real e Haiku 5.5 e usaram esse trailer; mantido o trailer do modelo real (nao inventar atribuicao).
- **#147 e #146 Code Review via agy APROVADO TECNICAMENTE e QA APROVADO** (EXEC-CR/QA-147R e 146R, saidas 0; #147: 6 testes, 4 passam, 2 pulados por limite conhecido (QA APROVADO COM RESSALVAS); #146: 13/13 em duas execucoes). **Ambas em Aguardando aprovacao.**
- **Defeito novo #152 (achado do factory-release):** `node apps/web/scripts/build-fotos-envio.mjs` falha no HEAD (stub de `node:crypto` do bundle do navegador sem `createCipheriv`, `createDecipheriv`, `hkdfSync` e `randomBytes`, importados desde o commit 7576f6d da #68); o `build` do web quebra. Nao coberto pela #149 (verificado: reproduzido). Issue criada no GitHub e posta em Backlog no quadro local; segue WF-04 (Product Owner primeiro) quando houver vaga.

## Rodada 148 (continuacoes de Desenvolvimento, 2026-11-20)
- **#120:** fatias 9 e 10 entregues (09ac1a7, 73d22d7, 3168dfe; dbtests de privacidade 82/82, unitarios 70, saida 0). Falta: rotas do titular e do DPO, processamento da correcao e vigia de prazo (P-A a P-E de 166-ENTREGA-H111.md). Validade do token de download fixa em 5 min (adotada).
- **#123:** S1 a S5 (S5 parcial) entregues (ate 8027f12; migracao 20261120400000 aplicada; dbtests D-07 9/9, D-09 3/3). Lacunas L-3 (reset de MFA aceita 1 voto; CA-08 pede 2), L-4 (revogacao nao grava evento por si) e L-5 (a API nao le a chave de contencao; 503 nao provado): **pendencias para cartoes separados** (recomendacao adotada pelo lider; nenhum cartao criado ainda).
- **#124:** F0 a F2 e migracao CAT-06 (07f6b88, 8e185d2; catalogo 11/11). Achados: `private.dsr_case_transition_allowed` ainda executavel por public/anon/authenticated (revoke autorizado); o papel `postgres` nao pode `SET ROLE app_api` no DEV, entao o executor de banco prova por catalogo e sondas como `postgres` (limitacao registrada); `app_backup_reader` (LOGIN + BYPASSRLS) permanece como achado de resto de backup.
- **#109:** fatias 1 a 4 (ate d73789c). O disparo automatico depende de Issue propria do tick (pg_cron desativado pelo dono; tick HTTP nao montado).
- **#71:** fatias 1 a 3 (ate b9ff30a); 4 a 6 em andamento.
- **#69 (H-056) refino de PO via agy entregue** (EXEC-PO-69R-20261120, saida 0; 157-REFINO-H056.md, a revisar pelo lider). Arquitetura aguarda vaga (seis execucoes ativas).

## Rodada 149 (2026-11-20, tarde)
- **#124:** F3 a F5 entregues (52bed09, 81f0e3b, 24e5519, 16d1ee1; API 8/8, paridade de banco 12/12, catalogo 11/11, access-matrix 28/28, saida 0). Cobertura: 13 de 23 casos ativos nas duas camadas, 9 pendentes e 1 parcial declarados na guarda. Ajustes da matriz mantidos (404 de pedido `pedido_nao_encontrado`; CP-03 com 22023). Casos `deferred` nao promovidos agora. Migracao 20261120430000 (revoke em `dsr_case_transition_allowed`, fora da faixa reservada por regra de ordem). Continua em Desenvolvimento para cobrir os pendentes.
- **#109 (parte a) e #123 (S1 a S8) vao para Code Review via agy** (fila serial; a #109 sai com a composicao na API pendente do Issue do tick; a #123 com as lacunas L-1 a L-5 declaradas).
- **#152:** refino 168-REFINO-BUILD-WEB.md (subagente Claude, agy ocupado); perguntas 930 a 932 adotadas com a recomendacao (acrescentar as 4 funcoes ao stub + teste de regressao em apps/web/tests lendo o dist; cursor fora do bundle obrigatorio). Vai para Arquitetura e depois Desenvolvimento (WF-04).
- **#69:** Arquitetura entregue (167-DESENHO-H056.md; perguntas 830 a 849 adotadas; vetaveis A-1 a A-11; migracao 20261120500000) e vai para Desenvolvimento (a #71 ja tem migracoes aplicadas no DEV).
- **#149 Code Review via agy APROVADO TECNICAMENTE e QA REPROVADO** (EXEC-CR-149R e EXEC-QA-149R, saida 0 do agy; `test:scripts` 27/27 e `lint:scripts` OK; `check:all` vermelho com 11 violacoes NOVAS introduzidas por codigo recente de outras Issues: `check:hex` em `packages/access-matrix/src/matrix.ts:282` (#124), `check:env` em `authorization-parity.dbtest.mjs` (variavel `PARITY_STRICT` ausente de `.env.example`, #124) e 9 em `check:secrets` (#109, #120, #124)). **Decisao do lider:** as correcoes da #149 em si estao validas; o cartao volta a Desenvolvimento (coluna) para a higiene dos novos achados, a executar quando os DEVs em curso (#120, #71, #124, #69, #152) terminarem (para nao editar arquivos que eles estao mudando), e depois novo QA da #149. Nao e erro da #149.
- **#120:** rotas do titular (abrir, listar, detalhe, cancelar) e painel do DPO (listar, abrir assistido, atribuir, processar, recusar) commitadas (c9319da, 6cda75a, 118c07a; API 48 testes, tsc e eslint saida 0). `vercel.ts` (alteracao nao commitada de origem na #68) commitado pelo orquestrador (2def804) repassando `requestDiscovery`, `privacyTitular` e `privacyDpo`. Falta: step-up por codigo de 6 digitos do titular (sem ele acesso e eliminacao respondem 403 `step_up_obrigatorio`), download_url com URL assinada, limites na API e geracao do extrato composta.
- **#152 Desenvolvimento entregue** (7a44b24; build do web com saida 0; bundle sem literais do cursor (CA-04 confirmado); teste de regressao 6/6 e vizinhos 37/37; ensaio manual de regressao falha como esperado). Vai para Code Review via agy. Achado: o `lint` do pacote web falha por arquivos alheios (`codigo.js:83`, `profissional-situacao.js:55`, e o bundle gerado `fotos-envio.js`); decisao do lider: o bundle gerado entra nos ignores do eslint e os dois arquivos entram na higiene da #149.
- **#71 fatias 1 a 6 entregues** (a7b9174 a 6c11cd8; concorrencia 6/6 com 10 conexoes na ultima vaga, funcoes 22/22, tabelas 5/5, #46 16/16 e 3/3, #68 15/15; saida 0). Dados de teste `h058-` ficam como dados sinteticos de DEV (nao e possivel apagar sem desligar protecoes de exclusao; decisao (a) adotada). Falta ligar a rota na composicao e em `vercel.ts` (feito em rodada seguinte), depois Code Review.

## Rodada 150 (2026-11-20, fim da rodada)
- **#124 Desenvolvimento entregue (F6: d3231ce, f00be4a; paridade de banco 19/19 e API 11/11, catalogo 11/11, access-matrix 28/28, saida 0; cobertura 20 de 23 casos ativos nas duas camadas; pendentes CP-16, CP-17 (banco) e CP-28). Ajustes de matriz [AJUSTE F6] adotados pelo lider (CP-18/20/22/27 banco: 42501; CP-21: 404 uniforme; rota de auditoria real). Pergunta sobre fotos do pedido antes do aceite (CP-16): adotada a opcao B (foto so depois do aceite; confirmar no desenho 167 da #69). Vai para Code Review via agy.**
- **#109 Code Review via agy APROVADO TECNICAMENTE** (EXEC-CR-109-20261120, saida 0; unico achado SUGESTAO: comentarios com "(Issue 109)" em db, email e migracoes). QA em curso.
- **#120 e #69:** DEVs pararam no limite de turnos sem relatorio. #120 tem commits ate 118c07a e WIP nao commitado do step-up (migracao 20261120600000, `packages/db/src/privacy-dsr-step-up.ts`), que deixa `apps/api` com erros de tipo em `src/privacy/*` ate ser fechado. #69 tem commit 588baa9 (funcoes de acesso as fotos) e WIP (domínio da marca d'agua, compositor sharp). Ambas continuam em Desenvolvimento e precisam de nova execucao.
- **#71 Desenvolvimento entregue (fatias 1 a 6 e ligacao: dc82102; composicao.ts, vercel.ts e sql-pool.ts com a fabrica da conexao dedicada, adotada pelo lider; 75 testes de aceite e descoberta com stub do e-mail, saida 0).** Ressalva: `packages/email/src/auth-renderer.ts` (trabalho nao commitado da #120) tem erro de sintaxe nas linhas 95 a 97 e quebra 7 suites de composicao da API ate ser corrigido pelo DEV da #120. Vai para Code Review via agy (fila 5).
- **#109 (parte a) QA via agy APROVADO COM RESSALVAS** (EXEC-QA-109-20261120, saida 0; dominio 56, banco 24, dbtests 9 e 6 passam; a suite do pacote de e-mail falhou so por erro de sintaxe alheio em `auth-renderer.ts`, corrigido depois pela #120 em f296980); Code Review aprovado. **#109 em Aguardando aprovacao** como parte (a): ciclo pago (fatia 7, depende de #60 a #63) e composicao em `apps/api` (depende de Issue do tick) ficam pendentes e declarados. **#123 Code Review via agy APROVADO TECNICAMENTE**; QA em curso.
- **#120:** step-up do titular entregue (f296980, 962cba8; migracoes 20261120600000 e 20261120620000 aplicadas; dbtest 9/9, unitarios 22, API 32+11; catalogo 11/11). Falta ligar o decorador do e-mail do codigo ao consumidor da outbox (P-C; despacho de `ops.email_outbox` nao montado em `apps/api`), teste ponta a ponta e a geracao do extrato na API. Continua em Desenvolvimento.
- **#69:** fatias 1 a 3 (588baa9, 5457982, 2812cfc: marca d'agua, compositor sharp, rotas de lista e link; testes db 19, api 89, dominio 18, saida 0). Faltam a rota de entrega da imagem (fatia 4) e testes negativos/documentacao (fatia 5); o link emitido ainda nao entrega imagem. Os dois segredos `WATERMARK_TOKEN_SECRET` e `WATERMARK_ID_SALT` foram gerados aleatoriamente pelo orquestrador e gravados so no `.env.local` (valores nao exibidos; arquivo no gitignore).
- **#123 QA via agy APROVADO COM RESSALVAS** (EXEC-QA-123-20261120, saida 0; vitest 71 testes (5 arquivos), API 9, dbtests 22 passam e 1 pulado (pg_cron nao instalado no DEV); Code Review aprovado). **#123 em Aguardando aprovacao**, com as lacunas L-1 a L-5 como pendencias para cartoes separados.
- **#152 Code Review via agy APROVADO TECNICAMENTE e QA APROVADO COM RESSALVAS** (EXEC-CR-152 e EXEC-QA-152, saida 0; dominio build 0, bundle gerado 0, 43 testes web, build web 0, typecheck 0; ressalva: lint do pacote web falha por arquivos alheios). **#152 em Aguardando aprovacao.**

## Rodada 151 (fechamento da rodada, 2026-11-20 a 21)
- **Conclusoes humanas observadas no quadro local:** #51, #68, #146 e #147 estao em Concluido (decisao do usuario; o orquestrador nao alterou essas linhas). Nota de processo: ao reabrir o quadro, tres cartoes meus (#109, #123, #152) tinham sumido porque o cabecalho de Aguardando aprovacao mudou para (0); corrigido nesta rodada, com conferencia por `grep`.
- **#124 Code Review via agy APROVADO TECNICAMENTE (2 achados IMPORTANTE, nao bloqueantes) e QA APROVADO COM RESSALVAS** (EXEC-CR-124 e EXEC-QA-124, saida 0; access-matrix build 0, 28 testes, API 11, paridade de banco 19 e catalogo 11; 68 tabelas com RLS forcada; pendentes CP-16, CP-17 (banco) e CP-28 declarados). **#71 Code Review APROVADO TECNICAMENTE (sem BLOQUEADOR nem IMPORTANTE) e QA APROVADO COM RESSALVAS** (EXEC-CR-71 e EXEC-QA-71, saida 0; 77 testes, 0 falhas). **#124 e #71 em Aguardando aprovacao.**
- **Higiene da #149 (QA reprovado por violacoes novas de `check:all`) segue pendente** e deve rodar quando #120 e #69 terminarem; a corrente: `check:hex` em `packages/access-matrix/src/matrix.ts`, `check:env` (PARITY_STRICT ausente de `.env.example`) e 9 em `check:secrets`.
- **Casca web / telas navegaveis (pedido do usuario via coordenador):** o `14-BACKLOG.md` nao tem historia de tela de busca, login ou painel alem das paginas simples ja existentes em `apps/web/public` (acesso, codigo, pedido, fotos, profissional-*); as decisoes 518 e 661 deixaram a casca web fora das historias de API. Falta decisao de escopo do dono (ver relatorio).

## Rodada 152 (prioridade do dono: telas navegaveis, 2026-11-21)
- **Nova prioridade do dono (via coordenador):** o preview web mostra so a pagina provisoria; entregar telas navegaveis (inicial com busca, entrada de cliente e profissional, navegacao ligando as telas) com EDS/tokens e WCAG. Nao havia Issue no `14-BACKLOG.md` (so paginas simples em `apps/web/public`); criadas no GitHub e no quadro local: **#153** (pagina inicial com busca de servico e endereco), **#154** (telas de entrada: cliente por link/codigo e profissional por cadastro/login), **#155** (navegacao ligando as telas existentes; depende de #153 e #154) e, pelo achado do lider sobre a API local (rotas `/api/v1/*` em 404 por falta de variaveis e papeis `app_api`/`app_system` NOLOGIN), **#156** (ambiente DEV executavel: papeis de login, chaves DEV so no `.env.local`, script `dev` local, rotas respondendo). Prioridade acima das demais (as Issues em curso #69 e #120 seguem em paralelo nos vagas livres).
- **PO via subagente Claude (nao agy) para as quatro, em paralelo, por prioridade (registrado):** refinos 171 (#153; perguntas 940 a 947), 172 (#154; 950 em diante), 173 (#155; 960 em diante), 174 (#156; 970 em diante). Recomendacoes adotadas pelo lider (vetaveis). #153 e #155 editam `index.html`: a #155 so entra depois da #153.
- **Decisao do lider sobre a hospedagem da API (adotada pelo lider, vetavel pelo dono):** a Vercel recusou o primeiro envio do projeto novo `fastpro-api` (o primeiro deployment de um projeto e sempre producao, regra de parada do 44-ROTEIRO-H009 §4). Opcao (b): a funcao da API passa a ser publicada dentro do projeto `fastpro-web` (mesma origem, conforme ADR-018), sem primeiro envio de producao. Entra no escopo da **#156** (ambiente DEV executavel), que vem primeiro; o preview com API so faz sentido depois dela. O projeto vazio `fastpro-api` fica como esta ate decisao.
- **#154 refino (172-REFINO-WEB-ENTRADA.md):** perguntas 950 a 956 adotadas pelo lider (link Entrar na inicial so o link; tela propria /entrar; login e cadastro do profissional em paginas separadas; mensagem neutra se o e-mail ja existe; codigo de 6 digitos na mesma tela; "Esqueci minha senha" incluido; sem botoes Google/Apple). Pendencia a confirmar na Arquitetura: rotas reais de cadastro e login por senha do profissional e POST /v1/auth/challenges/consume.
- **#155 refino (173-REFINO-WEB-NAVEGACAO.md), perguntas 960 a 966 adotadas pelo lider (vetaveis):** 960 ordem do cliente = pedido, fotos, revisao, acesso e codigo so ao publicar, painel (B); 961 profissional = entrada, documentos, situacao, perfil depois da aprovacao (B, jornada J2); 962 criar tela minima "Meus pedidos" sobre a API da #47 (A); 963 `profissional-documentos` oficial e `profissional-documento` redireciona (A); 964 criar as paginas de situacao e perfil nesta Issue (A); 965 excecao controlada a regra de QA: um cenario feliz em Playwright mais axe, rodado localmente, para a navegacao (A); 966 guarda do rascunho 7 dias (A). **#155 so entra em Desenvolvimento depois de #153 e #154** (conflito em `index.html` e componentes compartilhados).
- **#153:** desenho 175-DESENHO-WEB-INICIAL.md (940 a 947 adotadas): sem framework, `inicio.css`/`inicio.js`/`inicio-logica.js`, contexto de endereco `request_draft`, rascunho por cookie do servidor, sem mudanca na API; vai para Desenvolvimento.
- **#156 refino (174-REFINO-AMBIENTE-DEV.md), perguntas 970 a 972 adotadas pelo lider:** APP_ENV de DEV = local; limites de Mapbox vazios; so as chaves necessarias as duas rotas e a sessao. Achados: faltam `CATALOG_RATE_HMAC_KEY` e `SITE_URL` na lista; `IDENTITY_DOCS_READER_KEY` e credencial real de Storage (nao gerar); nao regenerar chaves ja preenchidas; o ponto de entrada local precisa injetar as fabricas de pool; papeis `app_api`/`app_system` NOLOGIN: logins dedicados com senha so no `.env.local`.
- **#154 Arquitetura entregue (176-DESENHO-WEB-ENTRADA.md), recomendacoes adotadas pelo lider:** todas as rotas necessarias existem (cadastro, login, verificacao, recuperacao e `POST /v1/auth/challenges/consume`); **954 corrigida:** a confirmacao do e-mail do profissional e por LINK, nao por codigo (nao existe API de codigo): adotado o link (AD-154-01); destino do login = `/profissional-documentos` ate a #155 entregar a situacao; o link "Entrar" fica hospedado na #153 (`<a href="/entrar">`) e a #154 so o testa; `/api/*` em `vercel.json` do web e da #156. Vai para Desenvolvimento (S1 a S7; S8 depende da #156).
- **#69 Desenvolvimento entregue (fatias 4 e 5: f6d7761, 9481e70; API 30/30 e vizinhos 139/139, tsc 0, eslint 0).** Incidente de commit: f6d7761 levou trechos do H-111 (`waitUntil` em composicao.ts e vercel.ts), de que o commit 53e692e da #120 depende; **decisao do lider: manter o historico como esta** (nao reescrever commits ja empilhados) e registrar. Vai para Code Review via agy.
- **#120 continua em Desenvolvimento:** envio do codigo do step-up ligado ao pipeline (53e692e; 48 testes de privacidade, tsc 0). Falta a geracao do extrato no processamento de acesso (P-B 3), limites na API (P-F) e o teste ponta a ponta com banco (depende do ambiente DEV da #156).
- **#156 Arquitetura entregue (177-DESENHO-AMBIENTE-DEV.md), recomendacoes adotadas pelo lider (vetaveis):** servidor local unico em `127.0.0.1:3000` (`pnpm dev`: `/api/*` para o handler compilado da API e o resto de `apps/web/public`; `SITE_URL` forcado so no processo); logins dedicados `fastpro_dev_api` e `fastpro_dev_system` (LOGIN INHERIT, sem superusuario, sem CREATEDB/CREATEROLE; o de sistema com BYPASSRLS proprio, porque BYPASSRLS nao e herdado, igual ao `app_system`), senha so no `.env.local`, criados pelo executor `pg` do repo com verificador SCRAM (CLI do Supabase so para verificar e desfazer); gerador de chaves que so preenche ausentes (nao regenera), `IDENTITY_DOCS_READER_KEY` fica vazia (credencial real); **achado:** `vercel.ts` nunca passa `session` ao app, entao `POST /v1/auth/session` responde 404 mesmo com tudo configurado: fatia F5b `session-composicao.ts`; prefixo `/api` ja tratado em `routePath`; hospedagem so depois do local: funcao catch-all `apps/web/api/[...caminho].ts` dentro de `fastpro-web`, so preview. Vai para Desenvolvimento.
- **#155 Arquitetura entregue (178-DESENHO-WEB-NAVEGACAO.md), D-1 a D-6 adotadas pelo lider:** perfil como pagina de leitura (edicao em Issue nova); botao Sair fora do escopo; correcoes ao refino 173 registradas (cookie `__Host-fp_sess`, parametro `?voltar=`, `/profissional` redireciona 307); textos minimos provisorios para estados vazios; "Entrar" fica no cabecalho comum e o CA-W21 da #153 passa a valer so para `<main>`; QA com prova simulada e a pendencia da #156 declarada. Dev so depois de #153 e #154.
- **#153 Desenvolvimento entregue (be40352, 7b4761a, 5948291, 62ab50b e mais dois commits do orquestrador: links de entrada e CA-W21 so no conteudo): pagina inicial real em `/` (h1, busca de servico com combobox, endereco por `request_draft`, "Continuar" que cria ou atualiza o rascunho e vai para `/pedido`; links Entrar e Sou profissional no cabecalho); 64 testes web, build e typecheck do web com saida 0.** Pendencias declaradas: Playwright+axe (CA-W14 a CA-W17) e prova com a API real (depende da #156); `profissional-documentos-estatico.test.ts` com 2 falhas ja existentes (nao e da #153). O bloco `"/"` de `vercel.json` tinha sido perdido numa edicao concorrente e foi restaurado pelo orquestrador. Vai para Code Review via agy.
