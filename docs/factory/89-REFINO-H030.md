# H-030 — Refino: tela de pedido, revisão e confirmação expressa

- **Issue:** #43 "[E3] Revisão e confirmação expressa" · **Backlog:** H-030 · **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA ou backlog, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de decisão em aberto
- **Fontes lidas:** 14-BACKLOG (H-030 e dependências H-013, H-021, H-024, H-025, H-026, H-029, H-031; BK-5); 21-ISSUES-CRIADAS (H-030 = #43, H-031 = #44); 04-PRD (RF-010 a RF-016, RF-019, RF-025a, RF-078, RF-092, RF-161, RF-162); 05-CRITERIOS-ACEITE (FA-002, FA-022, FA-034); 07-AMBIGUIDADES (AMB-01); 09-MODELO-DADOS (`request_draft`, `duplicate_ack`); 11-ARQ-RISCOS-E-TESTES §2.2 (revisar e publicar); 18-PLANO-QA §6.3 e §6.4 (EE-01, AX-01 a AX-05); 19-PLANO-TECNICO-DEV (O-6; caminho de teste sem envio de e-mail); 68-DESENHO-H021 (§3.5 e dúvida 1); 74-DESENHO-H025 (CA-04 transferido para esta história); 61-REFINO-H019 (busca, já aprovada); 71-REFINO-H025 e 87-REFINO-H026 (padrão deste documento).

## 1. Objetivo

Entregar a primeira tela real do cliente: a tela de pedido, que reúne a busca de serviço (#32, aprovada), o rascunho sem conta (#38, aprovado) e a revisão com confirmação expressa. O visitante preenche, identifica-se por e-mail, revisa tudo e confirma. `[DECIDIDO]` RF-010 a RF-014, FA-002; pedido do dono do produto.

Nesta história a confirmação **não publica**. Publicar (novo ID, admissão de aceites aberta, prazo de 7 dias corridos) é de H-031 (#44). `[VERIFICADO]` 14-BACKLOG (H-031); `[DECIDIDO]` FA-002 separa "confirma" de "é publicado".

A tela **funciona sem fotos**. Fotos são opcionais no pedido. `[DECIDIDO]` RF-010. H-026 (#39, em desenvolvimento) não é dependência desta história.

## 2. O que o cliente faz (passo a passo)

| Passo | Tela | O que acontece | Origem |
|---|---|---|---|
| 1. Serviço | Pergunta "Qual serviço você precisa?" | Campo de busca (H-019) com sinônimos; escolhe um serviço ativo | `[DECIDIDO]` RF-002; `[APROVADO]` #32 |
| 2. Local | Endereço em texto | Digita e escolhe sugestão (H-020). O rascunho guarda só o texto | `[VERIFICADO]` G-01, 08 §5 |
| 3. Urgência | Lista de 4 opções | Imediato, Nas próximas semanas, Próximo mês, Ainda não defini | `[DECIDIDO]` RF-011 |
| 4. Descrição | Texto livre | Sem limite definido (D-H030-8) | `[DECIDIDO]` RF-010 |
| 5. Identificação | Primeiro nome e e-mail | Pedidos só aqui, não no preenchimento. Botão "Revisar pedido" | `[DECIDIDO]` RF-012, FA-002 |
| 6. Link de e-mail | Tela "confira seu e-mail" | Cliente abre o link e confirma (POST). Volta à tela de revisão | `[DECIDIDO]` FA-002, RF-035; etapa de H-013 (D-H030-1) |
| 7. Revisão | Todos os dados, em leitura | Cada bloco tem "Editar", que volta ao passo. Sem fotos, a seção de fotos não aparece (D-H030-6) | `[DECIDIDO]` RF-014 |
| 8. Confirmação | Botão "Confirmar pedido" | Ação explícita. Grava a confirmação, sem publicar (D-H030-2 e D-H030-3) | `[DECIDIDO]` RF-014, FA-002 |

- Os campos são gravados no rascunho enquanto o cliente preenche, com a regra de H-025 (salvamento parcial, sem exigir nome nem e-mail). `[VERIFICADO]` H-025 CA-03.
- O rascunho segue o cookie do navegador (`current`). `[VERIFICADO]` 74-DESENHO-H025 (rotas `/v1/drafts/current`).
- Para revisar, são obrigatórios serviço, local, urgência e descrição. Primeiro nome e e-mail são obrigatórios para enviar à revisão. `[PROPOSTA]` D-H030-7 (recomendação de D-H025-5).
- O texto "o FastPro apenas conecta; não é contrato" **não** aparece nesta tela. `[DECIDIDO]` RF-078, decisão 22.

## 3. Estados da tela

| Estado | Quando | O que aparece | Marcação |
|---|---|---|---|
| Carregando | Abrir a tela ou a revisão, enquanto o rascunho é lido | "Carregando seu pedido…"; campos desabilitados; sem dado antigo na tela | `[PROPOSTA]` RF-162, FA-034 |
| Vazio | Não há rascunho do navegador (primeira visita, ou rascunho descartado ou expirado) | Formulário em branco. Na revisão: "Não encontramos um pedido em andamento. Comece um novo pedido." com link ao formulário | `[PROPOSTA]`; 404 indistinguível `[PROPOSTA]` D-H025-7 |
| Campo faltando | Tentativa de revisar ou de confirmar com dado obrigatório vazio | Erro por campo, na ordem da tela, com resumo no topo: "Falta preencher: …" | `[PROPOSTA]`; FA-002 |
| Erro ao carregar | Falha de rede ou servidor na leitura | "Não foi possível abrir seu pedido agora. Tente de novo." e botão "Tentar de novo". Nenhum campo é apagado | `[PROPOSTA]` RF-162 |
| Erro ao salvar campo | Falha ao gravar o rascunho | "Não foi possível salvar essa alteração. Tente de novo." O valor continua na tela | `[PROPOSTA]` |
| Sem resultado na busca | Termo sem serviço | "Não encontramos esse serviço. Tente outra palavra." (texto da busca, a validar) | `[PROPOSTA]` 61-REFINO-H019 CA-06; `[NÃO VERIFICADO]` BK-5 |
| Confirmando | Após clicar em "Confirmar pedido" | Botão desabilitado, "Confirmando…"; um clique só | `[PROPOSTA]` (idempotência, `[VERIFICADO]` 11-ARQ §2.2) |
| Falha ao confirmar | Erro na confirmação | "Não foi possível confirmar agora. Seus dados continuam salvos. Tente de novo." Não usa a palavra "publicado" | `[PROPOSTA]` |
| Confirmado | Confirmação gravada | Texto de D-H030-3. Não diz que o pedido foi publicado | `[PROPOSTA]`; `[DECIDIDO]` FA-002 |

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Tela de pedido com os quatro campos.** Dado um visitante sem conta, quando preenche serviço (pela busca), local, urgência e descrição, então o rascunho é salvo e nenhuma tela pede senha. `[DECIDIDO]` RF-010 a RF-012, FA-001; `[VERIFICADO]` H-025 CA-01.
- **CA-02 Urgência exata.** Dado o campo urgência, quando o visitante abre a lista, então vê exatamente "Imediato", "Nas próximas semanas", "Próximo mês" e "Ainda não defini". `[DECIDIDO]` RF-011; `[VERIFICADO]` H-025 CA-02.
- **CA-03 Identificação obrigatória.** Dado um rascunho sem primeiro nome ou sem e-mail, quando o cliente pede a revisão, então o envio é bloqueado com erro por campo e nenhum link é enviado. `[DECIDIDO]` FA-002, RF-012; regra transferida de H-025 CA-04 (74-DESENHO-H025).
- **CA-04 Revisão só com e-mail confirmado.** Dado um e-mail ainda não confirmado pelo link, quando o cliente tenta abrir a revisão, então é levado ao passo de link e a revisão não abre. `[VERIFICADO]` 11-ARQ §2.2 (revisar: "e-mail verificado"); `[VERIFICADO]` FA-002 (ordem: identificação, link, revisão, confirmação). Depende de D-H030-1.
- **CA-05 Revisão mostra tudo, sem alterar nada.** Dado um rascunho completo, quando o cliente abre a revisão, então vê serviço (nome), local (texto), urgência (valor exato), descrição e nome e e-mail; cada bloco tem "Editar" que volta ao passo. Abrir a revisão não confirma nem publica. `[DECIDIDO]` RF-014; `[PROPOSTA]` "Editar" por bloco.
- **CA-06 Confirmação expressa.** Dado um cliente na revisão, quando clica em "Confirmar pedido", então a confirmação é gravada e a tela mostra o estado "Confirmado" (texto de D-H030-3). Nenhuma outra ação (ler, rolar, voltar, fechar a aba) confirma. `[DECIDIDO]` RF-014 ("confirma expressamente"), FA-002.
- **CA-07 Nada publicado nesta etapa.** Dado um pedido confirmado nesta história, quando é consultado no banco e na API, então o rascunho segue em `aberto`, não existe pedido publicado, não há novo ID de pedido e não há prazo de aceites. `[DECIDIDO]` FA-002, RF-015 (vai para #44); `[VERIFICADO]` 14-BACKLOG (H-031).
- **CA-08 Confirmação idempotente.** Dado um clique duplo ou um reenvio da mesma confirmação, quando chegam ao servidor, então existe uma só confirmação e a resposta é a mesma. O botão fica desabilitado durante o envio. `[PROPOSTA]` (D-H030-2); `[VERIFICADO]` 11-ARQ §2.2 (idempotência), FA-035.
- **CA-09 Edição desfaz a confirmação.** Dado um pedido confirmado, quando o cliente altera qualquer campo, então a confirmação é desfeita e uma nova é exigida na revisão. `[PROPOSTA]` (D-H030-9).
- **CA-10 Sem fotos.** Dado um pedido sem fotos, quando o cliente revisa e confirma, então a confirmação é aceita e nenhuma mensagem sobre fotos aparece. `[DECIDIDO]` RF-010 (fotos opcionais); pedido do dono do produto.
- **CA-11 Sem coordenada na tela.** Dado qualquer passo da tela de pedido, quando o local é mostrado ou confirmado, então só o texto do endereço aparece; nenhuma coordenada, mapa ou ponto é exibido, devolvido pela API ou escrito em log. `[VERIFICADO]` G-01, 68-DESENHO-H021 §3 (opção b), H-025 CA-07.
- **CA-12 Posse pelo navegador.** Dado um rascunho criado em outro navegador, quando a tela de revisão ou a confirmação é chamada sem o cookie do rascunho, então responde "não encontrado" (404) sem revelar se o pedido existe. `[PROPOSTA]` (D-H025-7 e H-025 CA-05); base `[VERIFICADO]` T-02.
- **CA-13 Estados obrigatórios.** Dado cada estado da seção 3, quando ocorre, então a tela mostra o texto correspondente, nunca uma área vazia sem mensagem, e nunca afirma que o pedido foi publicado. `[DECIDIDO]` RF-162 (estados vazio, carregando e erro); `[PROPOSTA]` textos.
- **CA-14 Teclado e leitura.** Dado a tela de pedido e a revisão, quando navegadas só pelo teclado, então todos os controles são alcançáveis em ordem lógica, os erros são anunciados a leitor de tela e o conteúdo funciona com zoom de 200% e largura de 320 px. Cores vêm de tokens EDS, sem hex em componente. `[DECIDIDO]` RF-160, RF-161, FA-033, FA-034; `[VERIFICADO]` 18-PLANO-QA AX-01, AX-02, AX-05.

## 5. Fora de escopo

- Publicação, novo ID, prazo de 7 dias, admissão de aceites, e-mail de confirmação de publicação: H-031 (#44). `[VERIFICADO]` 14-BACKLOG.
- Aviso de possível duplicidade: depende de D-H030-4. Não há critério numerado nesta etapa. Se D-H030-4 mantiver o aviso em #43, o líder pede um CA novo; se for para #44, sai daqui. Regra de base já decidida: o aviso só avisa e exige confirmação, nunca bloqueia (`[DECIDIDO]` AMB-01 A).
- Fotos: envio (H-026, #39), redução e EXIF (H-027, H-028, #40 e #41), pré-visualização, exclusão e reordenação (H-029, #42). `[VERIFICADO]` 14-BACKLOG.
- Cobertura (aviso de "com" ou "sem" cobertura): H-024 (#37). `[VERIFICADO]` 68 §3.5 (cobertura passa a aparecer depois de publicar).
- Telefone e opt-in de WhatsApp: H-033 (#46). A revisão não mostra telefone. `[DECIDIDO]` RF-016.
- Painel do cliente e tela pós-publicação: H-034 (#47).
- Texto jurídico do "apenas conecta": H-063 e H-113 (BLQ-JUR L2, L7). `[VERIFICADO]` 14-BACKLOG.
- Busca de serviço: já entregue por H-019 (#32). Esta história só a usa.

## 6. Dependências e impacto

- **Antes:** H-025 (#38, concluída), H-019 (#32, concluída), H-020 (#33, concluída), H-021 (#34, concluída; por opção (b), sem coordenada na revisão, `[VERIFICADO]` 68 §3.5), H-011 e H-012 (#24 e #25, concluídas). **Pendentes:** H-013 (#26, na fila de backlog; ver D-H030-1) e H-024 (#37, na fila; ver D-H030-5).
- **Libera:** H-031 (#44). Ela recebe o rascunho confirmado e faz a publicação.
- **Modelo:** `request_draft` tem `status` com os valores `aberto`, `aguardando_email`, `descartado`, `publicado`; não há valor "confirmado". `[VERIFICADO]` 09. A confirmação precisa de um campo próprio (D-H030-2).
- **Conflito de documentos sobre duplicidade:** 14-BACKLOG (H-030) põe o aviso na revisão; 11-ARQ §2.2 também na rota de revisão; 68 §3.5 (recomendação de 68, dúvida 1) põe a checagem dentro da publicação, com 409 `duplicate_warning`, porque sem coordenada não há ponto para consultar. Decisão em D-H030-4.

## 7. Evidência exigida

Registrada na Issue #43, com comando, contagem de testes e código de saída de cada execução local. Não declarar CI verde (ver AGENTS.md, "Builds e testes locais").

**Testes locais**
- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem.
- Unitários: função `draftMissingForReview` (H-025) cobre CA-02 e CA-03; teste da regra de edição que desfaz a confirmação (CA-09).
- Postgres real (não mock) para CA-07, CA-08 e CA-12: confirmação repetida gera uma só; rascunho continua `aberto`; cookie de outro navegador recebe 404 igual ao de "não existe" (`[VERIFICADO]` 18-PLANO-QA: concorrência e RLS em Postgres real).
- Provedores externos simulados (`[VERIFICADO]` 18-PLANO-QA §1); nenhum e-mail real é enviado.

**Verificação no navegador (Playwright, navegador real)**
- Jornada da tela: preencher sem fotos, identificar, revisar, confirmar. Capturas em cada estado da seção 3 (CA-13). Evidência do EE-01 sem o passo de fotos.
- Sessão obtida pelo caminho sintético de geração de link, sem envio de e-mail (`[VERIFICADO]` 19-PLANO-TECNICO-DEV, caminho 1).
- Campo faltando, erro de rede simulado, clique duplo em "Confirmar pedido" (CA-08).
- Teclado: roteiro AX-01 com registro por tela (CA-14).
- Viewport de 320 CSS px e zoom de 200% (AX-05).
- Triagem axe (AX-04) em cada tela tocada: relatório JSON registrado.
- Leitor de tela (AX-02, NVDA): manual, por testador humano (N7). Fica como **pendente** até o testador registrar nota; a fábrica não declara conformidade sem ela.

## 8. Próximo passo

Este refino fica em Product Owner até o líder validar D-H030-1 a D-H030-4 (bloqueiam o escopo). Só então a Issue #43 vai para Arquitetura. A movimentação do cartão é do Orquestrador, não deste refino.

## 9. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida traz recomendação e o que destrava.

- **D-H030-1 (bloqueia o início; ordem de fila).** FA-002 e 11-ARQ §2.2 exigem e-mail confirmado antes da revisão. A etapa do link é H-013 (#26), que está na fila e não aparece nas dependências de H-030 em 14-BACKLOG. **Alternativas:** (a) acrescentar H-013 como dependência de #43 e manter a ordem de FA-002; (b) abrir a revisão sem link e deixar a confirmação de e-mail para H-031. **Recomendação:** (a). (b) contraria FA-002 e a rota de revisão.
- **D-H030-2 (bloqueia o que a confirmação grava).** O modelo não tem estado "confirmado". **Alternativas:** (a) campo de data de confirmação no rascunho (ou no registro que `duplicate_ack` já usa em 09), com status `aberto` até H-031; (b) novo valor de status, o que muda 09 e a máquina de estados de H-025; (c) não gravar nada e publicar direto em H-031. **Recomendação:** (a), com limpeza quando o cliente edita (CA-09). Destrava H-031.
- **D-H030-3 (bloqueia o texto final e o escopo visível).** O que o cliente vê depois de "Confirmar pedido" sem publicação? **Alternativas:** (a) "Pedido confirmado. Ainda não foi publicado." (honesto; o cliente não conclui até #44); (b) botão de publicar visível e desabilitado, com "Publicação em breve"; (c) juntar #43 e #44 numa só entrega. **Recomendação:** (a), que segue o pedido do dono do produto (publicação depois).
- **D-H030-4 (bloqueia parte do escopo; conflito de documentos).** Onde fica o aviso de possível duplicidade? **Alternativas:** (a) na confirmação de #43, com ponto geocodificado na revisão; isso contraria a opção (b) de H-021 e aciona a chamada paga de BK-2, ainda não confirmada; (b) dentro da publicação (#44), com 409 `duplicate_warning` e confirmação; #43 sem aviso; (c) em #43 comparando só serviço e texto, sem distância; não atende AMB-01 (100 m). **Recomendação:** (b). Exige ajustar o texto de H-030 e de 11-ARQ §2.2, que hoje põem o aviso na revisão.
- **D-H030-5 (dependência; ordem de fila).** 14-BACKLOG e 19 (O-6) põem H-024 (cobertura, #37) antes de H-030. A cobertura só aparece depois de publicar (68 §3.5, AMB-03 A). **Alternativas:** (a) retirar H-024 das dependências de #43; (b) manter e esperar #37. **Recomendação:** (a), a confirmar com o Architect.
- **D-H030-6 (fotos; não bloqueia).** Quando não há fotos, a seção de fotos fica oculta. **Alternativas:** (a) ocultar (recomendado); (b) mostrar "Nenhuma foto enviada" como bloco visível. Quando H-026 e H-029 entrarem, a revisão ganha o bloco de fotos.
- **D-H030-7 (campos obrigatórios; não bloqueia).** Confirma D-H025-5: serviço, local, urgência e descrição obrigatórios para revisar; "Ainda não defini" é valor válido. **Recomendação:** aceitar.
- **D-H030-8 (limite de texto; não bloqueia).** Qual o tamanho máximo da descrição? Sem valor nas fontes. **Recomendação:** o Architect propõe valor `[PROPOSTA]` (D-H025-6).
- **D-H030-9 (edição após confirmar; não bloqueia).** CA-09 desfaz a confirmação ao editar. **Recomendação:** aceitar; sem isso, o cliente confirma uma coisa e publica outra.
- **D-H030-10 (valores de duplicidade; não bloqueia).** 100 m e 24 h vêm de H-030 e ADR-015 e são `[PROPOSTA]`. **Recomendação:** aceitar; o Architect confirma junto com D-H030-4.
- **D-H030-11 (textos; não bloqueia).** Textos de botões e estados (seções 2 e 3, incluindo "Confirmar pedido") são `[PROPOSTA]`. Liga-se a BK-5 e à dúvida g de H-019. **Recomendação:** aprovar ou pedir revisão.

## 10. Comando de commit

Não executado: esta sessão não tem ferramenta de shell (só leitura, busca e escrita de arquivo), então não há `git`. Mensagem sugerida quando houver shell: `docs(H-030): refino da tela de pedido, revisão e confirmação`, com corpo `Refs: #43`, e os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVPL2o53TuuaUzciSZp`.
