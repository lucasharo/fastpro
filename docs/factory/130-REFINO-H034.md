# Refino H-034 — Painel do cliente na sessão do dono (Issue #47)

- **Issue:** #47 `[E3] Painel do cliente na sessão do dono` · **História:** H-034 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, consulta a banco ou chamada externa (Mapbox proibido). Nenhuma alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido nos documentos ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30), `21-ISSUES-CRIADAS.md` (H-034 = #47), `14-BACKLOG.md` (linha H-034, §2 Ondas, linhas de H-014, H-031, H-032), `04-PRD.md` (RF-015, RF-016 a RF-018, RF-038, RF-066, RF-110, RF-136, RF-139), `05-CRITERIOS-ACEITE.md` (FA-001, FA-002, FA-003, FA-010, FA-012, FA-024, FA-025), `09-MODELO-DADOS.md` (§service_request, §acceptance, índices e matriz de dados), `11-DECISOES.md` (decisão 257 = A12, linha 558; Rodada 92, linhas 801 a 803), `110-DESENHO-H031.md` (§0.13, §225 com a nota sobre #47), `113-REFINO-H045.md` (formato), `126-REFINO-H032.md` e `127-DESENHO-H032.md` (leitura do dono e do profissional).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #47 no GitHub não foi lido. Esta rodada não tem shell nem `gh`. O objetivo foi reconstruído da linha H-034 do backlog e dos documentos. O líder deve conferir o texto da Issue antes da Arquitetura.
- O código real das rotas de rascunho e de `service_request` não foi lido nesta rodada. Os nomes de tabela e função vêm de `09` e `110`/`127`.
- O banco de desenvolvimento não foi consultado.
- A Rodada 92 de `11-DECISOES.md` adota as decisões 420 a 426 e não cita a 257. A decisão 257 está na lista de decisões, linha 558: "o cookie do rascunho nao e' limpo apos publicar; a #47 decide" (A12).

---

## 1. Verificação de fila e dependências

- `[VERIFICADO]` O quadro mostra #47 em "Product Owner (4)". A Issue está na coluna certa e é a primeira da ordem de colunas.
- `[VERIFICADO]` Dependências declaradas de H-034 no backlog: **H-031 (#44)** e **H-014 (#27)**.

| Dependência | Estado no quadro (2026-11-13 12:30) | Efeito sobre #47 |
|---|---|---|
| H-031 (#44) publicação idempotente | **Concluído** | Atendida. `service_request`, `request_publish_commit` e o cookie do rascunho existem. |
| H-014 (#27) sessão de 7 dias e step-up | **Concluído** | Atendida. Sessão do cliente por cookie `__Host-fp_sess`. |
| H-032 (#45) visibilidade de localização | **Code Review** | **Não está na lista formal de H-034, mas é dependência real.** A rota `GET /v1/requests/:id` e a leitura do dono (`request_owner_get`) são de #45 (`127` §4.1 e §6.2). O critério "pedido de terceiro retorna 404" da #47 só se prova com essa rota. Ver pergunta 458. |
| H-033 (#46) opt-in de telefone | **Desenvolvimento** | Não é dependência funcional. Mas #46 acrescenta `phone_*` em `service_request` e no rascunho, mesma tabela que o painel lê. Ver §1.1. |
| H-023 (#36) descoberta por raio | **Concluído** | Não é dependência. O painel não usa descoberta. |
| E9 republicação (#92) | Backlog | Não é dependência. Pedido republicado aparece como pedido novo (pergunta 468). |

### 1.1 Pode começar Desenvolvimento?

**Resposta: não, ainda.** Arquitetura pode começar quando o líder mover o cartão, porque as dependências formais (#44 e #27) estão concluídas.

Motivos para esperar o Desenvolvimento:
1. `[VERIFICADO]` **#45 (H-032) está em Code Review** e mexe na mesma superfície: rotas em `apps/api/src/requests/`, função de leitura do dono e migração em `service_request`. Pelo `AGENTS.md` (§3), Issues com arquivos em comum não andam em paralelo.
2. `[VERIFICADO]` **#46 (H-033) está em Desenvolvimento** e acrescenta colunas `phone_*` em `service_request` e no rascunho. A #47 lê `service_request`. Há risco de conflito de migração e de contrato de leitura.
3. `[PROPOSTA]` Recomendação (pergunta 459): o Desenvolvimento da #47 só começa depois que #45 saia de Code Review para Aguardando aprovação e que #46 saia de Desenvolvimento, ou que o DEV confirme por `ls supabase/migrations | tail -3` e pela leitura dos arquivos que não há sobreposição.

Pelo quadro, a fila de Desenvolvimento já tem #46. Com #45 em Code Review, há no máximo duas Issues ativas na superfície de `requests`. O limite de quatro Issues em paralelo não impede a espera, porque o conflito é de arquivo, não de capacidade.

---

## 2. Objetivo

Dar ao cliente, na sessão do dono, uma lista dos próprios pedidos com o estado de cada um (publicado, selecionado, concluído, cancelado) e o estado do prazo de aceites (aberto ou encerrado), sem contadores, vagas ou ondas. Depois da publicação, a tela de confirmação orienta o cliente a voltar ao FastPro para acompanhar.

Resultado de negócio: o cliente encontra os próprios pedidos sem precisar guardar links, e nunca vê pedido de outra pessoa.

---

## 3. Escopo (dentro de H-034)

1. **Lista de pedidos do dono** (`GET` de lista, nome de rota `[PROPOSTA]`, pergunta 466), restrita a `customer_user_id` da sessão, com estado derivado e estado do prazo.
2. **Função de leitura da lista** no banco (`private.request_list_owner`, `[PROPOSTA]`), com `(customer_user_id, status, published_at DESC)` como índice, conforme `09` (consulta "Painel do cliente"). Lista de colunas fechada.
3. **Mapeamento de estado** para rótulo (função pura), incluindo o estado do prazo calculado por `acceptance_deadline_at` no instante da leitura.
4. **Tela de painel** do cliente com estados vazio, carregando e erro (pergunta 467).
5. **Tela pós-publicação** com a orientação de voltar ao FastPro (texto em pergunta 465).
6. **Tratamento do cookie do rascunho após publicar** (decisão 257, A12), na forma escolhida pelo líder (pergunta 460).
7. **Testes** de contrato, de catálogo, de isolamento entre donos, de fronteira de prazo e de ausência de contadores (§8).

## 4. Fora de escopo

- Detalhe do pedido do dono (descrição, endereço, fotos): é a rota `GET /v1/requests/:id` de **#45**. A #47 só linka para ela.
- Contadores de aceites, vagas e ondas (RF-066, RF-018): nunca aparecem no painel.
- Ações de cancelar, selecionar, concluir e republicar (E8, E9): só o estado é mostrado.
- Descoberta, aceite, chat e avaliação (E6 a E10).
- Tempo real no painel: a lista é atualizada ao recarregar (ver R4).
- Retenção e expurgo de pedido e de rascunho: `[PENDENTE JURÍDICO]` e dívida de #44/#45.
- Chamada a provedor de mapas. Mapbox real é proibido (Rodada 74).
- Notificação por e-mail do pedido (E11).

---

## 5. Fluxos e estados

### 5.1 Lista do dono (`[PROPOSTA]`)
1. Sessão do cliente: cookie `__Host-fp_sess` válido → `authenticate`. Sem cookie, cookie malformado ou sessão vencida/revogada: 401 `sessao_necessaria`. Nenhum dado.
2. Função de lista com `customer_user_id = sessão.userId`. Sem pedidos: lista vazia (não é erro).
3. Cada item: `id`, `serviceName`, `status` (rótulo derivado, §5.2), `prazo` (aberto ou encerrado, §5.3), `publishedAt`, `acceptanceDeadlineAt`. Sem contadores, sem endereço, sem coordenada, sem e-mail e sem telefone.
4. Ordenação `published_at DESC, id DESC`. Página de 20 itens com cursor `[PROPOSTA]` (pergunta 463).

### 5.2 Estado do pedido (rótulo para o cliente)

| Valor gravado (`09`, `service_request.status`) | Rótulo para o cliente | Observação |
|---|---|---|
| `publicado` | "Publicado" + prazo (§5.3) | Estado principal de quem aguarda aceites |
| `selecionado` | "Profissional selecionado" | Não mostra nome aqui; nome e detalhe são de E8 |
| `concluido` | "Concluído" | |
| `cancelado` | "Cancelado" | |

- `[AMBIGUIDADE]` O backlog de H-034 lista "expirado" entre os estados. O enum de `09` não tem `expirado`, e RF-018 diz "aberto/encerrado". Recomendação na pergunta 456: não criar estado novo; o vencimento do prazo é o estado do prazo, não do pedido.

### 5.3 Estado do prazo (derivado no instante da leitura)
- `aberto`: `now < acceptance_deadline_at`.
- `encerrado`: `now >= acceptance_deadline_at`.
- O prazo é `published_at + 7 dias corridos`, imutável (`09`). Nenhum job grava o estado. O cálculo usa o relógio do banco no momento da chamada `[PROPOSTA]`.

### 5.4 Pós-publicação
1. Publicação bem-sucedida (201, contrato da #44 sem mudança) abre a tela de confirmação.
2. A tela mostra que o pedido foi publicado, que o prazo de aceites é de 7 dias corridos e que o cliente pode acompanhar pelo FastPro (texto em pergunta 465).
3. Cookie do rascunho: tratado conforme a pergunta 460 (ver §6).

### 5.5 Sessão vencida
- Sessão de até 7 dias (RF-038, `09` app_session). Vencida ou revogada: 401, e o cliente pede novo link (FA-003). Os pedidos continuam no banco.

---

## 6. Regras de negócio

| Ref. | Regra | Fonte | Como H-034 atende |
|---|---|---|---|
| RN-H034-01 | O painel mostra só pedidos do próprio dono (`customer_user_id` da sessão). | RF-038; FA-003 (Cliente A não vê Cliente B) | Filtro na função de banco; CA-01 |
| RN-H034-02 | Pedido de terceiro, inexistente ou de outra sessão: resposta uniforme, sem confirmar existência. | FA-003; 08 §5.3 | CA-03 (depende de #45) |
| RN-H034-03 | Sem contadores, vagas ou ondas no painel. | RF-018; RF-066; FA-010 | CA-06 |
| RN-H034-04 | O estado do prazo é derivado de `acceptance_deadline_at`; nenhum job grava. | P4 (`08` §1.1); RF-015; FA-012 | §5.3; CA-05 |
| RN-H034-05 | O painel não mostra endereço, e-mail, telefone, coordenada nem dado de profissional. | RF-137; RF-139; `09` matriz | CA-16 |
| RN-H034-06 | Leitura do painel não grava nada e não gera auditoria. | Consistência com #45 (`127` §10.7) | CA-13 |
| RN-H034-07 | Respostas do painel com `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, sem CORS. | `110` §6.4; `11` (cookies) | CA-11 |
| RN-H034-08 | Histórico não some por expiração de prazo, sessão vencida ou conclusão. | RF-109; FA-012 | Lista inclui todos os estados (pergunta 462) |

---

## 7. Critérios de aceite (numerados e testáveis)

Todos os testes são locais, com dados sintéticos e marcador de teste. Evidência: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test`, registrada na Issue.

- **CA-01 (isolamento de dono).** Dado cliente A com 3 pedidos e cliente B com 2, quando A lista o painel, então vê exatamente os 3 de A e nenhum de B. Prova: teste de banco com dois usuários.
- **CA-02 (sessão).** Sem cookie, com cookie malformado, com sessão revogada e com sessão vencida: 401 `sessao_necessaria`, sem corpo de dado. Prova: teste de rota com quatro casos.
- **CA-03 (404 uniforme de terceiro).** Dado pedido de B, quando A pede o detalhe por id, então a resposta é byte a byte igual à de id inexistente. Prova: comparação de respostas. Depende da rota de #45 (pergunta 458).
- **CA-04 (estados).** Fixtures sintéticas: publicado com prazo aberto, publicado com prazo encerrado, selecionado, concluído e cancelado. Cada um aparece com o rótulo da §5.2. Prova: teste de mapeamento e teste de banco.
- **CA-05 (fronteira de prazo).** Com relógio fixo: em `acceptance_deadline_at − 1 µs` o prazo é `aberto`; em `acceptance_deadline_at` e depois, `encerrado`. O pedido continua `publicado`. Prova: três verificações.
- **CA-06 (sem contadores).** A resposta da lista não contém `acceptances_count`, `acceptancesCount`, palavras "vaga", "onda" ou números de limite (4 e 8) em rótulos. Prova: varredura de chaves e de textos. Se a pergunta 457 mudar a resposta do dono (#45), a varredura cobre também o detalhe.
- **CA-07 (ordem e página).** Lista ordenada por `published_at DESC, id DESC`; com 25 pedidos, a primeira página tem 20 itens e a segunda, 5, sem repetição nem falta. Pedido novo aparece no topo. Prova: teste de banco.
- **CA-08 (vazio).** Cliente sem pedidos recebe lista vazia com texto e ação de novo pedido, sem erro. Prova: teste de contrato e de tela.
- **CA-09 (pós-publicação).** Após publicar, a tela mostra que o pedido foi publicado, o prazo de 7 dias e a orientação de voltar ao FastPro para acompanhar. Nenhum termo técnico. Prova: teste de interface e revisão de texto.
- **CA-10 (cookie do rascunho, decisão 257/A12).** Conforme a pergunta 460: se (b), a resposta 201 da publicação expira o cookie do rascunho (`Max-Age=0`, mesmos atributos `__Host-`); se (a), o cookie permanece e o teste registra isso. Em qualquer caso, republicação com a mesma chave e o cookie presente devolve a mesma resposta. Prova: teste de rota.
- **CA-11 (cabeçalhos).** Painel e lista respondem `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json`, sem CORS. Prova: teste de rota.
- **CA-12 (sem dado em log).** Sentinela de descrição e de e-mail não aparece em log capturado nem em corpo de erro. Prova: varredura de saída.
- **CA-13 (somente leitura).** Chamar a lista não altera nenhuma linha (contagem e soma de conferência iguais antes e depois) e não cria registro de auditoria. Prova: comparação antes e depois.
- **CA-14 (sem provedor externo).** O painel e a tela pós-publicação passam com provedor de mapas ausente, com zero chamadas. Prova: contador do fake = 0.
- **CA-15 (evidência local).** `corepack pnpm check:all` e `db:test` rodados localmente, com contagem e código de saída na Issue. Não se declara CI verde sem execução.
- **CA-16 (catálogo).** A função de lista não tem coluna de saída `address*`, `exact_point`, `geocode_point_id`, `email*`, `phone*`, `customer_user_id`, `acceptances_count` nem `match_*`. Prova: consulta a `pg_proc` e `pg_get_function_result`.

---

## 8. Casos de teste previstos (resumo)

| # | Teste | CA |
|---|---|---|
| T-01 | Dois donos, pedidos cruzados: cada um vê só os seus | CA-01 |
| T-02 | Quatro casos de sessão sem dado | CA-02 |
| T-03 | Terceiro, inexistente e inválido com a mesma resposta | CA-03 |
| T-04 | Cinco estados com rótulo esperado | CA-04 |
| T-05 | Fronteira de prazo com relógio fixo | CA-05 |
| T-06 | Varredura de contadores e de palavras proibidas | CA-06 |
| T-07 | 25 pedidos, paginação e ordem | CA-07 |
| T-08 | Lista vazia | CA-08 |
| T-09 | Texto da tela pós-publicação | CA-09 |
| T-10 | Cookie do rascunho após 201 e republicação idempotente | CA-10 |
| T-11 | Cabeçalhos de resposta | CA-11 |
| T-12 | Sentinelas em log e erro | CA-12 |
| T-13 | Leitura sem escrita nem auditoria | CA-13 |
| T-14 | Provedor ausente | CA-14 |
| T-15 | Catálogo da função de lista | CA-16 |

---

## 9. Riscos

- **R1. Contadores na resposta do dono (#45).** A `127` §6.2 inclui `acceptancesCount` na resposta ao dono. RF-018 e RF-066 proíbem contadores e vagas para o cliente. Conflito com #45, que está em Code Review. Mitigação: pergunta 457.
- **R2. Rascunho em claro após publicar.** O `address_text` do rascunho continua em claro até expirar (dívida `[DECIDIDO 407]`). Enquanto o cookie existir, a leitura do rascunho pelo cookie pode devolver esse texto. `[NÃO VERIFICADO]` se há rota de leitura do rascunho que devolve o endereço. Mitigação: pergunta 460.
- **R3. Dependência de #45 para o 404 de terceiro.** Sem a rota de #45, CA-03 fica pendente. Mitigação: pergunta 458 e ordem de Desenvolvimento (pergunta 459).
- **R4. Painel desatualizado.** Sem tempo real, o estado pode mudar (por exemplo, selecionado) enquanto a tela está aberta. Recomendação: recarregar ao abrir e ao voltar à aba; tempo real é de E7 (#80) e não entra aqui.
- **R5. Conflito de arquivos e migrações.** #45 e #46 mexem na mesma superfície. Mitigação: pergunta 459 e confirmação de prefixo de migração antes de criar.
- **R6. Sessão de 7 dias.** O cliente que volta após 7 dias precisa de novo link. É aceitável (FA-003), mas o painel vazio por sessão vencida não deve parecer "sem pedidos" (CA-02 cobre o 401).
- **R7. Acessibilidade.** A lista e a tela pós-publicação entram na auditoria WCAG 2.2 AA da #127 (E15). Texto e foco devem seguir o design system.
- **R8. Republicação (E9).** Pedido republicado é um pedido novo; a cadeia não aparece no painel nesta história (pergunta 468).

---

## 10. Ambiguidades

- `[AMBIGUIDADE]` Estado "expirado" no backlog × enum sem `expirado` em `09` × "aberto/encerrado" em RF-018 (§5.2; pergunta 456).
- `[AMBIGUIDADE]` "Sessão de 7 dias sem conta": interpretado como cliente sem senha, com sessão de até 7 dias criada por link mágico (RF-035, RF-038). Confirmar na pergunta 461.
- `[AMBIGUIDADE]` Dono da função de leitura da lista: `110` §225 diz que a #47 cria a sua própria função de leitura do dono; `127` §4.1 atribui `request_owner_get` à #45 (detalhe). Recomendação: #47 cria a lista, #45 mantém o detalhe (pergunta 464).
- `[AMBIGUIDADE]` A decisão 257 (A12) está em `11-DECISOES.md`, linha 558; a Rodada 92 não a cita. A decisão diz "a #47 decide" (pergunta 460).
- `[AMBIGUIDADE]` O texto da Issue #47 no GitHub não foi lido (§0).

---

## 11. Perguntas ao líder

Lista única, numerada de 456 a 469, sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava. A numeração segue a última resposta da sessão (última registrada: 426 na Rodada 92; 455 não é usada por este refino).

**456. Estado "expirado" no backlog.** O enum de `09` não tem `expirado`; RF-018 usa "aberto/encerrado".
- (a) Não criar estado. Mostrar "Publicado" com prazo "aberto" ou "encerrado", derivado de `acceptance_deadline_at` (recomendado).
- (b) Criar estado `expirado` gravado por job.
- **Recomendação:** (a), por P4 e por RF-018. Destrava CA-04 e CA-05.

**457. Contadores na resposta ao dono.** `127` §6.2 inclui `acceptancesCount` no detalhe do dono (#45, em Code Review). RF-018 e RF-066 proíbem contadores para o cliente.
- (a) Remover `acceptancesCount` da resposta do dono, ajustando #45 antes de concluir (recomendado).
- (b) Manter e tratar como "número de aceites", sem vagas nem ondas.
- **Recomendação:** (a). Destrava CA-06 e exige decisão para #45 também. Registrar na Issue #45.

**458. Dependência real de H-032 (#45).** O backlog lista só H-031 e H-014. O 404 de terceiro e o detalhe do pedido dependem da rota de #45.
- (a) Incluir H-032 (#45) como dependência de H-034 no backlog (recomendado).
- (b) Manter só H-031 e H-014 e testar o 404 com a rota da #47.
- **Recomendação:** (a). Destrava CA-03 e a ordem de Desenvolvimento.

**459. Ordem de Desenvolvimento.** #47 mexe na mesma superfície de #45 (Code Review) e de #46 (Desenvolvimento).
- (a) Desenvolvimento da #47 só depois que #45 saia de Code Review e #46 saia de Desenvolvimento (recomendado).
- (b) Paralelo, com o DEV verificando conflito de arquivos e de prefixo de migração antes de criar.
- **Recomendação:** (a). Destrava o início do Desenvolvimento. Arquitetura pode começar já.

**460. Cookie do rascunho após publicar (decisão 257, A12).** O cookie `__Host-fp_draft` permanece após a publicação e pode dar acesso ao rascunho com endereço em claro (dívida 407).
- (a) Manter o cookie até expirar, sem mudança na #44 (status quo).
- (b) Expirar o cookie na própria resposta 201 da publicação (`Max-Age=0`). Muda a rota da #44 (concluída), com teste de regressão; a retentativa só ocorre se a resposta foi perdida, e então o cookie também não foi removido (recomendado).
- (c) Rota de limpeza chamada pela tela pós-publicação, sem mudar a #44. Mais uma chamada e uma rota nova.
- **Recomendação:** (b). Reduz a exposição do endereço em claro do rascunho. Destrava CA-10 e a decisão da A12.

**461. Sessão de 7 dias sem senha.** Confirmar que o cliente não tem senha, que a sessão vale até 7 dias e que, vencida, a tela pede novo link sem perder pedidos.
- **Recomendação:** sim. Destrava CA-02 e R6.

**462. Quais pedidos entram na lista.** Todos (publicado, selecionado, concluído, cancelado), ou só os ativos?
- (a) Todos, ordenados pelo mais recente, sem filtro nesta história (recomendado; RN-H034-08).
- (b) Só ativos, com link "ver encerrados" em história própria.
- **Recomendação:** (a). Destrava CA-07 e CA-08.

**463. Paginação.** 20 itens por página, com "carregar mais" e cursor `(published_at, id)`.
- (a) Página de 20 com cursor (recomendado).
- (b) Lista completa sem paginação.
- **Recomendação:** (a). Destrava CA-07.

**464. Campos da linha da lista.** Recomendado: `id`, nome do serviço, rótulo do estado, rótulo do prazo, data de publicação, prazo; sem endereço, descrição longa nem urgência.
- (a) Campos acima (recomendado). Descrição só no detalhe de #45.
- (b) Incluir descrição resumida (até 120 caracteres).
- **Recomendação:** (a). Destrava CA-16 e o contrato da lista.

**465. Tela pós-publicação e texto.** A #47 entrega a tela pós-publicação com orientação de voltar ao FastPro. Texto proposto `[PROPOSTA]`: "Seu pedido foi publicado. Ele fica aberto para aceites por 7 dias. Para acompanhar, volte ao FastPro e abra Meus pedidos."
- (a) Aprovar o texto e a tela (recomendado).
- (b) Trocar o texto pelo líder antes da Arquitetura.
- **Recomendação:** (a). Destrava CA-09 e T-09.

**466. Nome da rota da lista.** Proposta `GET /v1/requests` (lista do dono), em par com `GET /v1/requests/:id` (detalhe, #45).
- (a) Adotar `GET /v1/requests` (recomendado; alinha com #45 e o padrão de `professional-*-route.ts`).
- (b) Outro nome, a definir na Arquitetura.
- **Recomendação:** (a). Destrava T-01 a T-07.

**467. Estado vazio e erro.** Sem pedidos: texto e ação "Novo pedido". Erro de rede ou 503: mensagem fixa, sem detalhe técnico.
- **Recomendação:** sim. Destrava CA-08 e a tela.

**468. Republicação na lista.** Pedido republicado (E9, #92) é um pedido novo. A cadeia não aparece nesta história.
- (a) Pedidos independentes, sem vínculo visível (recomendado).
- (b) Mostrar vínculo com o pedido original.
- **Recomendação:** (a). Destrava o escopo; a cadeia é de E9.

**469. Auditoria de leitura.** Confirmar que a leitura do painel não gera registro de auditoria nem evento, como #45 (`127` §10.7).
- **Recomendação:** sim. Destrava CA-13.

---

## 12. Próximos passos

1. Líder confere o texto da Issue #47 no GitHub e a coluna no quadro (ainda em Product Owner).
2. Líder responde 456 a 469 (adota as recomendações, registra em `11-DECISOES.md` com os mesmos números) e envia ao usuário apenas o que for decisão de produto. Nenhuma pergunta de 456 a 469 foi enviada ao usuário por este refino.
3. Atualizar este refino com as respostas que mudarem regra. Registrar na Issue #45 a pergunta 457 se for adotada.
4. Mover #47 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura desenha a lista, a função de banco, o índice `(customer_user_id, status, published_at DESC)`, a rota e o tratamento do cookie. Desenvolvimento só depois da pergunta 459.
