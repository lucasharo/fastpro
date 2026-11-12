# H-029 — Refino: pré-visualização, exclusão e reordenação das fotos

- **Issue:** #42 "[E3] Pré-visualização e reordenação de fotos" · **Backlog:** H-029 · **Dependências:** H-026 (#39, Concluído no quadro); H-027 (#40, Concluído no quadro), dependência de fato, ver D-H029-6
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA, backlog ou quadro, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de teste manual ainda não feito
- **Fontes lidas:** 14-BACKLOG (H-029, H-118, H-056); 04-PRD (RF-010, RF-025, RF-025a, RF-026, RF-030, RF-136, RF-161, RF-162, RF-164); 05-CRITERIOS-ACEITE (FA-033, FA-034); 11-ARQ-RISCOS-E-TESTES (R-03, R-24, T-15, P-02, P-04, P-05); 11-DECISOES (30 a 33, 56 com D-H026-1 a D-H026-7, 79 a 88, 93 a 100); 87-REFINO-H026 (D-H026-5, D-H026-6); 88-DESENHO-H026 (§1, §2, §4, §5, §8, R3, R4); 92-REFINO-H027 (CA-11, §5); 93-DESENHO-H027 (§2.1, §2.2, §2.3, §3, R-13); 95-REFINO-H028 (§ de risco de conteúdo); 12-TODO (item 13); quadro-status.md (colunas de #39 a #42).

## 1. Objetivo

Permitir que o cliente, antes de publicar o pedido, veja as fotos já enviadas, exclua a que não quer e troque a ordem, sabendo em cada momento se a foto está enviando, processando, pronta ou recusada, com mensagem acionável quando algo falha. Tudo deve funcionar por teclado e com leitor de tela.

`[DECIDIDO]` RF-026 (preview, estado de carregamento, exclusão, reordenação) e backlog H-029. `[DECIDIDO]` RF-025: "é a versão reduzida que fica armazenada e é exibida".

Esta história não publica, não revisa o pedido e não muda o estado do pedido. Isso é de H-030 e H-031.

## 2. Situação de partida

- `[VERIFICADO]` Já existem (H-026, H-027): envio para quarentena, limite de 5 fotos vivas (a 6ª é recusada), redução síncrona no `finalize`, versão reduzida em `request-photos` e original removido depois da redução. 93 §2.1 e §2.3.
- `[VERIFICADO]` Estados da foto hoje: `pending` sem `confirmed_at` (enviando); `pending` confirmada com lease (processando; `finalize` responde 409 `processando` com `Retry-After: 3`); `ready` (pronta); `rejected` com um de 4 códigos fixos (`imagem_invalida`, `imagem_grande_demais`, `nao_cabe_no_limite`, `nao_processavel`). 93 §2.1 e §2.3.
- `[VERIFICADO]` Não existe hoje leitura da foto para o dono. 88 §1 e §4 dizem que não há rota de leitura, e 92 CA-11 diz que a visualização é de H-029 e H-056.
- `[VERIFICADO]` Não existe rota de listagem das fotos do rascunho (88 §1).
- `[VERIFICADO]` Não existe rota de exclusão. D-H026-5 (88 §0 e R4) diz que a exclusão é entregue por H-029.
- `[VERIFICADO]` As respostas de `GET /v1/media/{id}` e de `finalize` são só `{ id, status, confirmed }` (88 §1; 93 R-13). Não trazem o código da recusa, então a tela não consegue dizer o motivo sem mudar o contrato (D-H029-1).
- `[VERIFICADO]` Não há coluna de posição em `app.media_asset` (88 §2; 93 §3). A ordem das fotos não é guardada hoje (D-H029-3).
- `[VERIFICADO]` Enviar foto é opcional no pedido (RF-010, "fotos opcionais"); o máximo é 5 (RF-025). Zero foto é estado válido, não erro.
- `[VERIFICADO]` Foto `rejected` e foto marcada para expurgo não contam no limite (88 §1 e §2).
- `[VERIFICADO]` Aviso sobre fachada, interior e rostos: R-03 de 08 e 11-ARQ; D-H026-6 deixa o aviso com H-029 e com o desenho de UX.
- `[VERIFICADO]` Nenhuma história entregou ainda a tela de escolha de foto no navegador. H-027 entregou só o módulo de redução, com portas injetadas (93 §4.4; 92 CA-12).

## 3. Escopo

1. Lista das fotos vivas e recusadas do rascunho, na ordem escolhida, com contagem "N de 5" (só as vivas contam).
2. Pré-visualização da versão reduzida de cada foto `ready`.
3. Estado visível de cada foto: enviando, processando, pronta, recusada (com motivo fixo), envio não concluído.
4. Exclusão de qualquer foto do rascunho, em qualquer estado, com confirmação (D-H026-5).
5. Reordenação por controles de teclado, gravada no servidor (D-H029-3).
6. Estados de carregamento e de erro, na tela e por foto (§5 e CA-09).
7. Aviso sobre fachada, interior e rostos, com texto a aprovar (D-H029-5).
8. Botão "Adicionar foto" ligado ao envio de H-026 e H-027, somente se D-H029-2 for confirmada.
9. Acessibilidade (teclado, leitor de tela, contraste por tokens) e layout responsivo (web primeiro, RF-164).

## 4. O que fica fora

- Revisão do pedido e aviso de duplicidade: H-030 (#43).
- Publicação, novo ID, prazo de 7 dias e vínculo da foto ao pedido: H-031 (#44).
- Visualização por profissional, marca d'água e URL de 60 s: H-056 e H-057. Esta tela não aplica marca d'água, porque a foto é do próprio cliente `[PROPOSTA]`.
- Ampliação da foto em diálogo ou zoom: não previsto. Vira item próprio se o líder pedir `[PROPOSTA]`.
- Fotos extras por WhatsApp: fora. A tela não oferece esse canal (RF-025a, P-02).
- Leitura do original da quarentena: nunca. A tela só recebe a versão reduzida.
- Conversão de HEIC e mensagem específica de HEIC: fora (decisões 80 e 95).
- Deduplicação por conteúdo: fora (88 R3), salvo D-H029-7.
- Liberação do fluxo para visitantes reais: segue a condição de 88 §8. H-029 não a altera.

## 5. Estados e textos da tela `[PROPOSTA]`

Os textos são sugestão para revisão do líder (D-H029-5). Nenhum texto mostra código de erro, nome de arquivo, caminho, limite técnico ou texto de biblioteca.

| Estado | Texto na tela | Ação disponível |
|---|---|---|
| Lista carregando | "Carregando fotos" (com texto, não só ícone) | nenhuma |
| Sem fotos | "Nenhuma foto adicionada. Fotos são opcionais." | "Adicionar foto" (se D-H029-2) |
| Enviando | "Enviando" | Excluir |
| Processando | "Preparando a foto. Isso leva alguns segundos." | Excluir |
| Pronta | "Pronta" e a miniatura | Mover antes, Mover depois, Excluir |
| Recusada | "Não foi possível usar esta foto: {motivo}." | Excluir (sai da lista; não ocupa vaga) |
| Motivo `imagem_invalida` | "o arquivo não é JPG, PNG ou WebP" | — |
| Motivo `imagem_grande_demais` | "a imagem é grande demais" | — |
| Motivo `nao_cabe_no_limite` | "não foi possível reduzi-la o bastante" | — |
| Motivo `nao_processavel` | "não foi possível processar a foto" | — |
| Envio não concluído | "O envio desta foto não foi concluído." | Excluir |
| Processamento demorado | "Ainda preparando a foto." | Tentar de novo |
| Erro ao carregar a lista | "Não foi possível carregar as fotos." | Tentar de novo |
| Erro ao mostrar a foto | "Não foi possível mostrar esta foto." | Tentar de novo |
| Erro ao excluir | "Não foi possível excluir a foto. Tente de novo." | Tentar de novo |
| Erro ao reordenar | "Não foi possível salvar a nova ordem. Ela voltou à anterior." | Tentar de novo |
| Limite de 5 | "Você já tem 5 fotos. Para adicionar outra, exclua uma." | Adicionar foto (aria-disabled) |
| Rascunho vencido ou não encontrado | texto já usado pelo pedido para rascunho vencido (D-H029-5) | nenhuma |
| Muitas ações em pouco tempo | "Aguarde alguns instantes e tente de novo." | Tentar de novo |
| Aviso de conteúdo | "Evite fotos que mostrem fachada, interior ou rostos." (D-H029-5) | nenhuma |

## 6. Critérios de aceite (Given/When/Then)

- **CA-01 Lista e contagem.** Dado um rascunho com fotos vivas e recusadas, quando a tela abre, então mostra "Carregando fotos" até a lista chegar; depois mostra as fotos na ordem gravada, com "N de 5" contando só as vivas; sem fotos, mostra o estado vazio, sem tratar como erro. `[VERIFICADO]` 88 §2 (recusada não conta) e RF-010 (fotos opcionais); textos `[PROPOSTA]`.

- **CA-02 Pré-visualização da versão reduzida.** Dado uma foto `ready`, quando a tela mostra a miniatura, então a imagem é a versão reduzida (até 1.280 px no maior lado, cerca de 0,5 MB), com texto alternativo "Foto N de 5". Enquanto carrega, aparece um espaço com "Carregando foto N". Se falhar, aparece "Não foi possível mostrar esta foto." com "Tentar de novo", e o foco vai para o botão. `[DECIDIDO]` RF-025. A forma da leitura depende de D-H029-1.

- **CA-03 Estado por foto.** Dado cada foto, quando a tela a mostra, então o estado aparece em texto, nunca só em cor ou ícone, conforme a §5: enviando, processando, pronta, recusada com o motivo fixo, envio não concluído. Enquanto a foto estiver processando, a tela consulta de novo sozinha, com intervalo e número máximo definidos pelo Architect. Esgotado o número, mostra "Ainda preparando a foto." com "Tentar de novo". `[VERIFICADO]` 93 §2.3 (409 e `Retry-After: 3`); intervalo e limite `[PROPOSTA]`.

- **CA-04 Adicionar foto dentro do limite.** Dado menos de 5 fotos vivas, quando o cliente ativa "Adicionar foto" e escolhe uma imagem, então o envio segue o fluxo de H-026 e H-027 e a foto entra como enviando. Com 5 vivas, o botão fica com aria-disabled e a mensagem da §5 explica o limite. A tela não oferece WhatsApp nem outro canal de foto. Condicionado a D-H029-2. `[VERIFICADO]` RF-025, RF-025a e P-02.

- **CA-05 Exclusão por teclado com confirmação.** Dado qualquer foto do rascunho, quando o cliente ativa "Excluir foto N" (Tab e Enter), então abre um diálogo com o foco no botão "Cancelar". Esc ou "Cancelar" fecha o diálogo e devolve o foco ao botão "Excluir foto N". Confirmar com Enter ou Espaço remove a foto da lista, atualiza a contagem e leva o foco ao item seguinte. Se não houver seguinte, vai ao anterior; se não houver mais fotos, vai a "Adicionar foto". `[VERIFICADO]` D-H026-5 (exclusão é de H-029); confirmação e foco `[PROPOSTA]`.

- **CA-06 Exclusão sem duplicidade e com erro.** Dado uma exclusão em curso, quando o cliente clica de novo ou usa outra aba, então o servidor executa uma vez e a resposta é a mesma. A foto só sai da lista depois da confirmação do servidor; não há remoção antecipada. A exclusão é confirmada quando o servidor marca a foto para remoção; se a remoção física do arquivo falhar depois, a limpeza repete e o cliente não vê erro (88 §4). Se a marcação falhar, a foto continua na lista com "Não foi possível excluir a foto. Tente de novo.", anunciado, com o botão "Tentar de novo". Excluir foto em processamento é permitido: o servidor descarta o resultado (`gone`). `[VERIFICADO]` 88 §4 e 93 §3 (`gone`); a forma da resposta `[PROPOSTA]`.

- **CA-07 Reordenação por teclado.** Dado duas ou mais fotos, quando o cliente foca "Mover foto N para antes" ou "Mover foto N para depois" e ativa, então a foto troca de posição, o foco continua nela na nova posição e é anunciado "Foto N movida para a posição M de X". Nas extremidades, o botão fica com aria-disabled e não faz nada. Não existe ação que exija arrastar: arrastar pode existir, mas nunca é o único caminho. `[DECIDIDO]` RF-161 e FA-034 (teclado); forma dos controles `[PROPOSTA]`. Depende de D-H029-3 e D-H029-4.

- **CA-08 Ordem gravada e sem conflito.** Dado uma troca de ordem, quando feita, então a nova ordem aparece na hora. Enquanto grava, o item mostra "Salvando ordem" e seus botões de mover ficam indisponíveis (aria-busy). Se o servidor não gravar, a ordem volta à última gravada e aparece "Não foi possível salvar a nova ordem. Ela voltou à anterior.". Se outra aba mudou a ordem, a tela recarrega a lista do servidor e anuncia "A ordem das fotos mudou; a lista foi atualizada." As posições são sempre de 1 a N, sem repetição nem buraco, mesmo com duas abas. `[PROPOSTA]`; persistência depende de D-H029-3.

- **CA-09 Erros ao abrir a tela.** Dado a abertura da tela, quando a lista falha: 503 mostra "Não foi possível carregar as fotos." com "Tentar de novo"; 429 mostra "Aguarde alguns instantes e tente de novo.", sem número de limite; 404 (rascunho vencido, descartado ou de outro navegador) mostra a mensagem de rascunho vencido e não revela se a foto existe. `[VERIFICADO]` 88 §1 (404 uniforme, 429 sem limite, 503 fixo); textos `[PROPOSTA]`.

- **CA-10 Leitura só do dono, só a versão reduzida e sem cache.** Dado um pedido de imagem de uma foto, quando a API responde, então só serve foto `ready`, só a versão reduzida, só para quem tem o cookie do rascunho. Em qualquer outro caso (sem cookie, outro dono, foto de outro rascunho, foto que não está pronta, identificador inválido) responde 404 com corpo e cabeçalhos iguais aos de H-026. A resposta é `no-store`. Nem a URL nem o caminho aparecem na tela ou em log. O original da quarentena nunca é lido. `[DECIDIDO]` 88 §1 (404 uniforme), 92 CA-11 (leitura nova só em H-029) e RF-025; a forma da leitura (bytes pela API ou URL curta) `[PROPOSTA]`, D-H029-1.

- **CA-11 Teclado completo.** Dado a tela, quando navegada só pelo teclado, então todos os controles (miniatura, Tentar de novo, Excluir, Mover antes, Mover depois, Adicionar, diálogo) são alcançáveis na ordem visual. Enter ou Espaço ativam, Esc fecha diálogos e o foco é sempre visível (contorno do token de foco). Nenhum foco se perde ao trocar de estado (ao excluir, ao falhar, ao recarregar). O roteiro de teclado é registrado na Issue. `[DECIDIDO]` RF-161 e FA-034 ("todos os controles são alcançáveis, com foco visível e ordem lógica").

- **CA-12 Leitor de tela.** Dado um leitor de tela, quando usa a tela, então ouve "Foto N de M" com o estado (pronta, processando, recusada com o motivo). Os botões dizem a qual foto se referem ("Excluir foto 2"). Mudanças (exclusão, troca de ordem, erro, limite) são anunciadas por região de status, e mensagens de erro são lidas sem tirar o foco. `[DECIDIDO]` FA-034 (estados e erros anunciados). A conferência com leitor de tela é `[NÃO VERIFICADO]` até o teste manual.

- **CA-13 Tokens e contraste.** Dado os temas claro e escuro, quando a tela é renderizada, então as cores vêm de tokens (sem hex em componentes, T-15). O contraste de texto e das bordas dos controles atende WCAG 2.2 AA e é medido, não presumido (item 13 de 12-TODO sobre contraste não textual). Nenhum estado depende só de cor. `[DECIDIDO]` FA-033, FA-034, T-15; `[VERIFICADO]` 12-TODO item 13.

- **CA-14 Responsivo e alvos de toque.** Dado largura de celular (cerca de 360 px) e de desktop, quando a tela é usada, então a grade se reorganiza sem perder nenhuma ação e sem rolagem horizontal. Cada alvo de toque tem pelo menos 24 por 24 px (WCAG 2.2, 2.5.8). `[DECIDIDO]` RF-164 (web primeiro, responsivo); 360 px e 24 px `[PROPOSTA]`.

- **CA-15 Aviso e limites da tela.** Dado a tela aberta com fotos, quando o cliente a vê, então o aviso sobre fachada, interior e rostos aparece perto da grade, com o texto de D-H029-5. A tela não publica, não avança para a revisão (que é de H-030) e não muda o estado do pedido. `[VERIFICADO]` D-H026-6 e R-03; a regra de não publicar `[DECIDIDO]` (H-031).

- **CA-16 Sem dado interno.** Dado qualquer tela, resposta ou log desta história, quando verificados, então não aparecem nome do arquivo, caminho, chave de objeto, identificador técnico de objeto, EXIF, IP, URL de leitura, código de erro cru ou texto de biblioteca. Os motivos de recusa vêm de lista fixa. `[VERIFICADO]` 88 §5, 93 §5.1 e T-11.

## 7. Dependências e condições antes do Desenvolvimento

- **H-026 (#39) e H-027 (#40):** concluídas no quadro. Os dados que a tela precisa já existem.
- **H-028 (#41):** em Desenvolvimento. Não bloqueia H-029, porque a tela só recebe a versão já reduzida e sem metadado. Mas a Issue de H-029 não pode mexer nos mesmos arquivos de #41 ao mesmo tempo (regra de paralelismo, AGENTS.md item 3). O Orquestrador confere antes de iniciar.
- **Decisões que travam partes do DEV:** D-H029-1 (leitura, listagem e motivo) trava CA-02, CA-03, CA-09 e CA-10. D-H029-2 trava CA-04. D-H029-3 trava CA-07 e CA-08 e, se for "servidor", cria migração nova (`npx supabase`, nunca pelo MCP).
- **Exclusão:** já decidida (D-H026-5), não precisa de nova decisão.
- **Liberação:** a condição de 88 §8 continua valendo. Esta tela não abre o fluxo para visitantes reais.
- **Backlog:** a linha de H-029 cita só H-026 (D-H029-6).

## 8. Evidência exigida

Registrada na Issue #42, em comentário técnico com comando, contagem e código de saída de cada execução local. Não declarar CI verde.

- `corepack pnpm check:all` (código de saída e contagem de testes); `corepack pnpm db:test` se houver migração.
- Testes de rota: leitura só do dono; 404 idêntico byte a byte (mesma técnica de M-06 em 88 §7); `no-store`; nunca o original; nunca foto que não esteja `ready`.
- Testes de exclusão: duas chamadas produzem um só efeito; marcação falha devolve erro e a foto continua na lista; falha só na remoção física não aparece para o cliente e a limpeza repete; exclusão durante processamento leva a `gone`.
- Testes de ordem: posições de 1 a N sem repetição; duas requisições concorrentes; falha devolve a ordem anterior.
- Roteiro de teclado (CA-11) e leitura com leitor de tela (CA-12): resultado por passo. Se não feito, `NÃO VERIFICADO`.
- Capturas dos estados da §5 (vazio, carregando, processando, recusada, erro da lista, erro de exclusão, erro de ordem) anexadas à Issue.
- Varredura de hex em componentes (T-15) como parte de `check:all`.
- Contraste medido nos dois temas (CA-13): método e valores registrados. Não declarar WCAG 2.2 AA sem evidência (RF-161, R-24).

## 9. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação. A numeração D-H029-n é deste refino; o líder consolida na lista única da sessão. D-H029-1 a D-H029-3 mudam escopo, contrato ou dados e devem ser decididas antes do DEV das partes afetadas. As demais são textos e ajustes de registro.

- **D-H029-1 (leitura, listagem e motivo de recusa).** A tela precisa de três coisas que hoje não existem: uma rota de listagem das fotos do rascunho, a leitura da versão reduzida (CA-02, CA-10) e o código do motivo na resposta, porque hoje só vem `{ id, status, confirmed }`. **Recomendação:** abrir, só para o dono pelo cookie, uma listagem com identificador, estado, posição e motivo de lista fixa (sem tamanho, nome ou caminho), e uma leitura da versão reduzida com `no-store` e 404 uniforme. A forma da leitura (bytes pela API ou URL curta gerada na hora) fica com o Architect. **Alternativa:** a tela mostra só o estado, sem miniatura nem motivo, e perde o item 2 do escopo. Altera 88 §1 e §5.

- **D-H029-2 (botão "Adicionar foto").** Nenhuma história entrega hoje a tela de escolha de foto no navegador. H-027 entregou só o módulo de redução, e H-026 entregou as rotas. **Recomendação:** H-029 inclui o botão e reaproveita as rotas de H-026 e o módulo de redução de H-027 (R-12), porque sem ele a tela não recebe foto nova. **Alternativa:** item separado; H-029 cuida só de foto existente, e CA-04 sai do escopo. Destrava CA-04 e o texto "Sem fotos" da §5.

- **D-H029-3 (ordem guardada no servidor).** Não há posição guardada (88 §2; 93 §3). **Recomendação:** guardar a posição no servidor, por rascunho, com migração nova, porque a ordem precisa sobreviver a recarregar a página e H-030 e H-031 usam a mesma ordem. **Alternativa:** guardar só no navegador até a publicação e enviar a ordem em H-031; mais simples, mas a ordem se perde se o cliente trocar de aparelho. Destrava CA-07, CA-08 e a migração.

- **D-H029-4 (capa).** Nenhum documento diz qual é a primeira foto nem se existe capa. **Recomendação:** não há capa nesta história; a primeira da lista é só a primeira. Se houver capa, ela vem em H-030 ou H-056. **Alternativa:** definir já a primeira foto pronta como capa. Destrava o uso da ordem em CA-07 e em H-030 e H-056.

- **D-H029-5 (textos).** O aviso sobre fachada, interior e rostos (D-H026-6; R-03; risco de conteúdo em 95-REFINO-H028) precisa de texto aprovado, e a §5 tem textos sugeridos, inclusive a mensagem de rascunho vencido que o pedido já usa. **Recomendação:** o líder aprova ou troca os textos da §5; o aviso proposto é "Evite fotos que mostrem fachada, interior ou rostos." Nenhum texto da §5 vai a QA sem aprovação. **Alternativa:** a equipe de UX escreve e o líder revisa. Destrava CA-15 e a revisão da §5.

- **D-H029-6 (dependência no backlog).** A linha de H-029 cita só H-026, mas a tela precisa de H-027 (versão reduzida `ready`). **Recomendação:** registrar H-027 como dependência de H-029; o Orquestrador atualiza o backlog. **Alternativa:** manter como está; sem efeito prático, porque #40 já está concluída, mas a rastreabilidade fica incompleta. Não bloqueia.

- **D-H029-7 (foto repetida).** Uma mesma foto enviada duas vezes ocupa duas vagas (88 R3). Deduplicação por conteúdo exige comparar bytes no servidor, e o backlog não pede. **Recomendação:** fica fora desta história. **Alternativa:** incluir um aviso "parece igual a outra foto", sem bloquear, o que exige comparação de conteúdo. Não bloqueia.

**Para o Architect (decisão técnica, não de produto):** intervalo e número máximo de consultas enquanto a foto processa (CA-03); forma da leitura da versão reduzida (D-H029-1); resposta de conflito de ordem entre abas (CA-08); e a marcação de exclusão com a limpeza do arquivo (CA-06).

## 10. Próximo passo

O líder valida D-H029-1, D-H029-2 e D-H029-3, que mudam contrato, escopo e dados, e aprova os textos de D-H029-5. Depois disso, o Architect desenha a listagem, a leitura, a exclusão com marcação, a ordem e os intervalos de consulta. O cartão #42 permanece na coluna Product Owner até essa validação. A movimentação é do Orquestrador, não deste refino. As decisões registradas em 11-DECISOES.md são feitas pelo líder, com a numeração contínua da sessão, quando ele responder.
