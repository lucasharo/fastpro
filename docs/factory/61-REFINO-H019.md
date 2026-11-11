# FastPro — Refino H-019 (Issue #32): busca de serviço com sinônimos

- **Issue:** #32 (H-019, "[E2] Autocomplete de serviço e sinônimos") · **Workflow:** WF-03 (refinamento) · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, commit, push ou alteração no GitHub. Nenhum arquivo de outra Issue foi alterado. **Atenção:** o número #32 conflita com `21-ISSUES-CRIADAS.md` (ver dúvida a).
- **Fontes:** `14-BACKLOG` (H-019, E2), `04-PRD` (RF-002, RF-003, RF-010), `05-CRITERIOS-ACEITE` (FA-001, FA-034), `06-CATALOGO-PROPOSTO` (legenda e sinônimos), `52-REFINO-H018` e `53-DESENHO-H018` (catálogo, leitura pública, normalização), migração `20261111250000_catalog_public_list_function.sql`.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` premissa ou texto deste refinamento.

## 1. Contexto

H-019 entrega a busca de serviço por texto, usada em "Qual serviço você precisa?" (RF-002) e no campo de serviço do pedido (RF-010). A busca acha o serviço pelo nome e pelos sinônimos da semente de H-018 (provisória), ignora acento e maiúsculas, e mostra só itens ativos.

Estado de H-018 (#31, concluída): a leitura pública é `private.catalog_public_list()`, que traz grupo e serviço ativos, **sem sinônimos** (53 §2). Logo, a busca precisa de uma leitura própria que inclua sinônimos. A forma técnica é decisão do Architect (dúvida e).

## 2. Critérios de aceite (Given/When/Then)

**CA-01 [PROPOSTA] Sem acento e sem diferença de maiúsculas.**
- **Dado** o serviço "Projeto arquitetônico", **quando** o visitante digita "PROJETO ARQUITETONICO", **então** o serviço aparece.
- **Dado** o serviço "Ampliação / puxadinho", **quando** digita "ampliacao", **então** o serviço aparece.

**CA-02 [APROVADO] Retorno de serviços ativos, com grupo.**
- **Dado** um visitante sem conta na tela de pedido (RF-002, FA-001), **quando** digita parte de um serviço, **então** recebe a lista de serviços ativos, e cada item mostra o nome do serviço e o nome do grupo (RF-003).
- **Dado** a escolha de um item, **quando** confirmada, **então** o campo recebe o serviço escolhido (o gravar no pedido é de H-025).

**CA-03 [PROPOSTA] Resultados por relevância.**
- Ordem: (1) nome do serviço começa com o termo; (2) nome contém o termo; (3) sinônimo começa com o termo; (4) sinônimo contém o termo. Empate: posição do grupo e, depois, nome.
- **Dado** os serviços "Pedreiro" e "Servente de pedreiro", **quando** digita "pedr", **então** "Pedreiro" aparece antes.
- **Dado** mais de 10 resultados, **quando** a busca responde, **então** aparecem no máximo 10 (valor a confirmar, dúvida b).

**CA-04 [APROVADO] Sinônimos encontram o serviço.**
- **Dado** o serviço "Construção de casa" com sinônimo "empreiteiro", **quando** o visitante digita "empreiteiro" (ou parte dele, ex.: "empreit"), **então** "Construção de casa" aparece, com seu grupo.
- **Dado** o mesmo caso, **então** a lista mostra o serviço, não o sinônimo que casou (regra [PROPOSTA]).

**CA-05 [PROPOSTA] Nada inativo aparece.**
- **Dado** um serviço inativo, **quando** o termo é o seu nome ou um sinônimo dele, **então** não aparece.
- **Dado** um sinônimo inativo de serviço ativo, **quando** o visitante digita só esse sinônimo, **então** o serviço não aparece (aparece se o nome ou outro sinônimo ativo casar).
- **Dado** um grupo inativo, **quando** o visitante busca um dos seus serviços, **então** nenhum deles aparece.
- **Dado** um serviço de conselho profissional (inativo até parecer L4, 53 §4.1), **quando** buscado, **então** não aparece.

**CA-06 [PROPOSTA] Sem resultado, sempre com mensagem.**
- **Dado** um termo sem correspondência (ex.: "xyzw"), **quando** a busca termina, **então** aparece a mensagem "Não encontramos esse serviço. Tente outra palavra." (texto a validar, dúvida g). Nunca fica lista vazia sem texto.
- **Dado** um termo com menos de 2 caracteres (valor a confirmar, dúvida b), **quando** digitado, **então** nenhuma consulta é feita e nenhuma sugestão nem mensagem de erro aparece.

**CA-07 [PROPOSTA] Carregamento, falha e teclado.**
- **Dado** uma consulta em andamento, **quando** o visitante continua digitando, **então** o campo não trava e a lista indica carregamento.
- **Dado** falha da consulta, **quando** ocorre, **então** aparece "Não foi possível buscar agora. Tente de novo." (não aparece "nenhum resultado").
- **Dado** a lista aberta, **quando** navegada só pelo teclado, **então** setas movem entre itens, Enter escolhe e Esc fecha; leitor de tela anuncia a quantidade de sugestões (FA-034, RF-161 e RF-162).

## 3. Fora de escopo

- **Endereço** (autocomplete Mapbox): H-020, já em andamento. Nada deste refinamento toca endereço.
- **Cobertura geográfica e raio de atendimento**: H-023 e H-024.
- **Tela de gestão de sinônimos** no administrativo: H-107. Aqui os sinônimos só são lidos.
- **Promoções** e termos de busca pagos: fora do MVP (RF-153).
- **Tolerância a erro de digitação** além dos sinônimos cadastrados (ex.: "pedriro"): fora. Erros comuns entram como sinônimo (06, item 5).
- **Busca de profissional ou de perfil público.**
- **Registro de termos digitados** para análise de demanda: fora (ver dúvida i).
- **Mobile**: Onda 6.

## 4. Dependências e impacto (sem solução técnica)

- **Dados:** serviços e sinônimos da semente de H-018. A semente é provisória e o aceite do conteúdo continua com o titular (52, dúvida 1). H-019 pode ser implementada e testada com a semente provisória.
- **Normalização:** a mesma regra de acento e caixa de H-018 (`catalog_norm`), para não divergir da unicidade (53, R-9).
- **Leitura:** a busca precisa de sinônimos e só de itens ativos. Ampliar `catalog_public_list` quebraria o contrato de campos de H-018 (T-H018-06); a escolha é do Architect (dúvida e).
- **Privacidade:** o termo digitado é texto livre de visitante. Não deve ir para log junto de identificador (H-007, P8).

## 5. Dúvidas ao Orquestrador (líder)

Sem numeração própria. Cada dúvida traz a recomendação do PO.

a. **Número da Issue (bloqueia a referência do commit).** O pedido diz #32 = H-019. `21-ISSUES-CRIADAS.md` diz H-017 = #32 e H-019 = #32 (criadas e conferidas no Project 4, em 2026-11-10). `16-MANIFESTO-ISSUES.md` (proposta, anterior à criação) diz H-019 = #32. Recomendação: consultar o Project antes de fixar `Refs:`, e corrigir o número se for #32.
b. **Tamanho mínimo do termo e limite de sugestões.** Recomendação: mínimo 2 caracteres e máximo 10 sugestões (CA-03, CA-06). Destrava: fechar os valores.
c. **Trecho no meio da palavra.** Recomendação: sim ("reiro" acha "Pedreiro"), com prioridade para início de palavra (CA-03).
d. **Não mostrar o sinônimo que casou.** Recomendação: não mostrar (CA-04). Se o titular quiser, é ajuste de CA-04.
e. **Leitura da busca (Architect).** Recomendação: leitura própria da busca, com sinônimos ativos e só itens ativos, sem ampliar `catalog_public_list`. Não bloqueia o refinamento.
f. **Campo visual de busca: H-019 ou H-025?** Recomendação: H-019 entrega o campo reutilizável e H-025 apenas o consome no pedido.
g. **Textos de CA-06 e CA-07.** São [PROPOSTA]. Recomendação: aprovar ou pedir revisão. Liga-se a BK-5 (texto neutro ainda não definido).
h. **Latência alvo da busca.** O risco de `14-BACKLOG` não tem número. Recomendação: definir com Architect e QA a partir de medição local. Não invento valor.
i. **Termo digitado em log ou métrica.** Recomendação: não gravar o termo junto de identificador; só contagem agregada, se houver. Decisão do Architect (privacidade).

Nenhuma dúvida exige decisão do usuário agora. A dúvida 52/1 (aceite do conteúdo) segue como está e não bloqueia H-019.

## 6. Estado da entrega

- **Verificação feita:** H-019 em `14-BACKLOG`; RF-002, RF-003 e RF-010 em `04-PRD`; FA-001 e FA-034 em `05-CRITERIOS-ACEITE`; legenda, sinônimos e exemplos de `06-CATALOGO-PROPOSTO`; leitura pública e normalização em `53-DESENHO-H018`; função `catalog_public_list` na migração `20261111250000`.
- **Testes e build:** nenhum (documento).
- **Coluna do GitHub Project:** não consultada (`gh` proibido por instrução e sem ferramenta GitHub nesta sessão). A coluna Product Owner foi informada pelo Orquestrador.
- **Commit e push: NÃO executados.** Esta sessão não tem ferramenta de shell (só leitura, busca e escrita de arquivo), então não há como rodar `git` nem `py -3`. Mensagem proposta para quando houver shell: `docs(H-019): refino da busca de serviço com sinônimos`, com corpo `Refs: #32` (condicionado à dúvida a) e os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux`.
