# Refino H-039 — Fila de verificação (Issue #52)

- **Issue:** #52 `[E4] Fila de verificação` · **História:** H-039 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, chamada externa ou alteração no quadro. A Issue permanece na coluna Product Owner até o líder decidir a movimentação.
- **Perguntas ao líder:** numeração 370 a 389, faixa reservada a esta Issue.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `14-BACKLOG.md` (linhas H-037 a H-042, H-044 e H-055), `04-PRD.md` (RF-046 a RF-053, RF-147, RF-148), `05-CRITERIOS-ACEITE.md` (FA-004, FA-005), `08-ARQUITETURA.md` (quadro de acesso, Verificação, documentos de identidade, RF-148), `09-MODELO-DADOS.md` (`verification_case`, `access_case`, `sensitive_access_log`, matriz de acesso), `11-DECISOES.md` (Rodadas 54, 60, 63, 64, 72, 73 e decisões 34, 170, 184), `107-DESENHO-H037.md` (§4.1, §5, §7 e D-H037-15), `106-REFINO-H037.md`, `116-REFINO-H038.md` e `113-REFINO-H045.md` (formato e fronteiras).

Conferido no código (somente leitura):
- `supabase/migrations/20261112220000_identity_create_documents.sql` (tabela `app.identity_document`, funções `private.idoc_*`).
- `packages/domain/src/identity-docs/ports.ts` (interface `IdentityDocReaderPort`, linhas 29 e 30).
- `supabase/migrations/20261111290000_admin_create_access_case.sql` (tabela `app.sensitive_access_log`).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #52 no GitHub não foi lido nesta rodada. O líder deve conferi-lo antes da Arquitetura.
- Nenhum banco foi consultado nem alterado. A existência de objetos foi conferida apenas pelas migrações versionadas.
- O estado de H-073 (acesso excepcional por caso, RF-148) e de H-103 e #112 (console admin por papel) não foi aprofundado. Usado só como fronteira.

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` O quadro mostra #52 na coluna **Product Owner** (ao lado de #51). Não está em Backlog, como dizia a nota de 116. A ordem de colunas está correta para esta etapa.
- `[VERIFICADO]` Dependências declaradas no backlog para H-039: **H-037 (#50)**, **H-006 (#19)** e **H-102 (#111)**. As três estão em **Concluído** no quadro (#50 concluída pelo usuário, Rodada 72).
- `[VERIFICADO]` Base já entregue e usada por H-039: H-035 (#48, cadastro com `document_hmac`) e H-036 (#49, serviços e base) estão Concluídas.
- `[VERIFICADO]` Auditoria append-only (H-006, #19) e pipeline de notificações (#102) estão Concluídas.
- `[VERIFICADO]` Não existe, em migração, a tabela `app.verification_case` nem a função `private.idoc_review_target`. Ambas são de H-039 (ver §8).
- `[VERIFICADO]` Existe a interface `IdentityDocReaderPort.readForReview(id)` em `packages/domain/src/identity-docs/ports.ts`, sem implementação. Pela decisão 184 e pelo desenho 107 §7, a implementação é de H-039.
- `[VERIFICADO]` `app.identity_document` já tem `analyzed_at`, `content_sha256`, `stored_type`, `stored_bytes` e `status` (`pendente_envio`, `recebido`, `substituido`). A constraint `analyzed_at` só é aceita em `recebido` ou `substituido`.

**Resposta à pergunta de início de Desenvolvimento:**
- As dependências declaradas estão Concluídas. Nenhuma delas impede o núcleo da fila (caso, atribuição, decisão, recurso, auditoria, leitura pela porta).
- **Desenvolvimento ainda não pode começar agora.** O workflow WF-03 manda o cartão primeiro para **Arquitetura**, que precisa desenhar `verification_case`, `private.idoc_review_target`, a tarefa atribuída e as rotas. Só depois vem o Desenvolvimento.
- **A aprovação completa depende de #51 (H-038).** FA-004 exige que atividade regulamentada sem certificação não conclua a aprovação. H-038 está em Product Owner e não é dependência declarada de H-039. Ver pergunta 373.

## 2. Objetivo

Dar à Verificação uma fila de casos em que ela pode atribuir um caso a si, ler o documento de identidade recebido por uma porta própria, e então aprovar, recusar, reter por duplicidade (manual), explicar a decisão e receber recurso. Toda decisão deixa registro de auditoria com ator, papel, data e motivo.

Resultado de negócio: o FastPro só aprova profissional com identidade analisada por pessoa, com motivo registrado e possibilidade de recurso. A meta de 2 dias úteis é acompanhada, mas não é promessa (RF-048).

## 3. Escopo (dentro de H-039)

1. Tabela `app.verification_case` com as colunas de `09` §3.3 (`id`, `professional_id`, `status`, `assigned_to`, `reason_code`, `explanation_to_professional`, `appeal_status`, `decided_by`, `decided_at`, `sla_target_at`) e a tabela de histórico imutável `verification_case_event`. Aplicada por migração nova, `npx supabase` ou runner do repo, nunca editando migração antiga.
2. Criação do caso no primeiro envio de identidade recebido (ver pergunta 370).
3. Atribuição da tarefa ao papel Verificação (`assigned_to`) e transição `pendente → em_revisao`.
4. Leitura do documento pela porta de H-039 (`private.idoc_review_target` e a classe que implementa `IdentityDocReaderPort`), conforme o contrato de 107 §7.
5. Decisões: `aprovada`, `recusada` e `retida_duplicidade` (manual), sempre com `reason_code` e explicação.
6. Recebimento de recurso (`appeal_status`), com retorno a `em_revisao`.
7. Meta `sla_target_at` (dois dias úteis), sem alerta nem job nesta história.
8. Atualização de `verification_status` do perfil (H-035) na mesma transação da decisão. H-039 é o único escritor desse campo.
9. Eventos de auditoria para atribuição, leitura, decisão e recurso (sem PII).
10. Fila da Verificação (lista ordenada e paginada) e tela de detalhe, conforme pergunta 386.
11. Testes de banco, de domínio e de rota, com dados sintéticos marcados.

## 4. Fora de escopo

- Detecção automática de duplicidade e regra de retenção: H-040 (#53). H-039 só oferece a retenção manual pela Verificação.
- Estado visível ao profissional e tela de recurso do profissional: H-041 (#54). H-039 só recebe o recurso no backend.
- Guarda de aceite e de descoberta por aprovação: H-042 (#55) e H-055 (#68).
- Certificação para atividade regulamentada e a função `certificacoes_completas`: H-038 (#51). H-039 só consome o resultado (ver 373).
- Perfil público e selo "verificado": H-043 (#56).
- Trial e assinatura: H-044 e H-045 (já concluída pelo lado de dados, #58).
- Suspensão e revogação administrativa (`suspensa`, dupla aprovação para permanente): console admin. H-039 não faz essa transição (ver 380).
- Acesso excepcional de admin a documento (RF-148, `access_case`): H-073. H-039 não cria rota para isso.
- Expurgo, retenção e prazo de guarda de documentos: pendência jurídica L1. H-039 não cria job nem apaga documento por decisão.
- E-mail de decisão e lembretes de prazo: histórias de E11 (ver 385). Sem envio nesta Issue.
- Verificação do conteúdo da identidade por automação ou base externa. Não há chamada externa; a análise é humana.
- Mapbox: proibido nesta Issue (decisão 74).

## 5. Fluxos e estados

### 5.1 Estados do caso (`verification_case.status`)

Conjunto da tabela de estados de `08` (Verificação) e de `09` §3.3: `pendente`, `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa`.

| De | Para | Quem | Condição |
|---|---|---|---|
| (criação) | `pendente` | sistema | primeiro envio de identidade com status `recebido` (ver 370) |
| `pendente` | `em_revisao` | Verificação | atribuição a si (`assigned_to`) |
| `em_revisao` | `aprovada` | Verificação | `reason_code` e explicação; identidade analisada; regra REG (373) |
| `em_revisao` | `recusada` | Verificação | `reason_code` e explicação |
| `em_revisao` | `retida_duplicidade` | Verificação | `reason_code` `duplicidade_suspeita`; nada é bloqueado |
| `recusada` ou `retida_duplicidade` | `em_revisao` | sistema | recurso recebido (`appeal_status` vira `pendente`) |
| `retida_duplicidade` | `aprovada` ou `recusada` | Verificação | decisão motivada (379) |
| `aprovada` | (qualquer) | ninguém nesta história | mudança só por histórias de admin ou por recurso de H-040 |
| `suspensa` | (qualquer) | ninguém nesta história | fora de escopo (380) |

`verification_status` do perfil (H-035) espelha o `status` do caso mais recente, atualizado na mesma transação. `[PROPOSTA]`, pergunta 371.

### 5.2 Fluxo da Verificação

1. Abre a fila: casos `pendente` e `em_revisao` atribuídos a ela, ordenados pelo prazo-meta.
2. Atribui um caso `pendente` a si. Registra evento de atribuição.
3. Abre o detalhe: dados não sensíveis (serviços, datas, estado de envio) e botão de leitura do documento.
4. Lê o documento pela porta de leitura (5.3). A leitura é registrada.
5. Decide (aprovar, recusar, reter), com motivo fixo e explicação. Cada decisão gera evento de auditoria e atualiza o perfil.
6. Se houver recurso, o caso volta a `em_revisao` e reaparece na fila da própria Verificação ou de outra, conforme 378.

### 5.3 Leitura pela porta (contrato de 107 §7, `[DECIDIDO]` pela decisão 184)

Condições exigidas, todas na mesma transação:
1. O caso está atribuído ao usuário que lê e em `em_revisao`. Sem atribuição, a leitura é negada.
2. Se `analyzed_at` for nulo, grava `analyzed_at = now()` no documento. Isso faz a exclusão pelo dono (`idoc_delete`) virar 409 depois.
3. Grava uma linha em `app.sensitive_access_log` (quem, o quê, caso, instante).
4. Devolve bytes e tipo armazenado (`image/jpeg` ou `application/pdf`). Nunca devolve nome de arquivo, caminho ou SHA-256 ao cliente.
5. A entrega ao navegador é como anexo, com `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` e sem URL pública. Forma exata em 381.
6. A classe leitora usa credencial só de leitura do bucket `identity-docs`, fica em arquivo separado e não é importada pelo serviço de envio (teste estático de #50, CA-19).

### 5.4 Estados de tela (Verificação)

- **Fila vazia:** mensagem de estado vazio, sem erro. Texto a aprovar (386).
- **Leitura falha** (arquivo ausente, caso não atribuído, erro de storage): mensagem genérica "Não foi possível abrir o documento. Tente de novo." `[PROPOSTA]`, sem caminho e sem detalhe técnico.
- **Decisão recusada** (caso já decidido por outra pessoa, ou status mudou): mensagem de conflito e recarregamento do caso.

## 6. Regras de negócio

| Ref. | Regra | Fonte | Como H-039 atende |
|---|---|---|---|
| RN-H039-01 | Só o papel Verificação, com caso atribuído, decide e lê documento. Admin comum, Superadmin e demais papéis não leem nem decidem. | RF-052; `08` (matriz de acesso: Documentos de identidade, Verificação com tarefa atribuída); `09` (matriz de acesso e de dados) | CA-H039-02, CA-H039-11 |
| RN-H039-02 | Toda decisão tem `reason_code` de lista fixa. Texto livre só como complemento e sem dado pessoal. | RF-147; RF-053; [PROPOSTA] pergunta 375 | CA-H039-04 |
| RN-H039-03 | Toda decisão, atribuição, leitura e recurso gera evento de auditoria com ator, papel, ação, objeto, estado antes e depois e motivo. Sem PII em claro. | RF-147; 09 §7; H-006 (#19) | CA-H039-07 |
| RN-H039-04 | Aprovação exige identidade `recebido` com `analyzed_at` preenchido, e a regra REG de FA-004. | FA-004; RF-047; RF-048 | CA-H039-05, CA-H039-06 |
| RN-H039-05 | Duplicidade suspeita retém. Não bloqueia definitivamente nem suspende a conta. | RF-049; FA-004 | CA-H039-13 |
| RN-H039-06 | Recurso é recebido em `recusada` e `retida_duplicidade`, e volta o caso a `em_revisao`. Nenhum recurso apaga histórico. | RF-053; RF-147; 09 §3.3 | CA-H039-14 |
| RN-H039-07 | Histórico de decisão é imutável (`verification_case_event`). Correção vira novo evento. | 09 §3.3 | CA-H039-03 |
| RN-H039-08 | Meta de dois dias úteis é campo de acompanhamento. Não é prazo contratual e não gera bloqueio. | RF-048; 09 §3.3 (`sla_target_at`) | CA-H039-15 |
| RN-H039-09 | Documento não é apagado por decisão. Não há job de expurgo nesta história. Prazo de guarda sem definição até a pendência L1. | 107 R-8; #50 CA-08; pendência L1 | CA-H039-18 |
| RN-H039-10 | Não há rota de leitura de documento para perfil público, dono, admin comum ou API de cliente. | RF-052; 107 §1 princípio 1 | CA-H039-11 |
| RN-H039-11 | Nenhuma resposta de API ou tela expõe CPF/CNPJ completo, nome de arquivo ou SHA-256 na fila. | 09 §7; 107 §4 | CA-H039-16 |

## 7. Critérios de aceite (numerados e testáveis)

Testes de banco usam dados sintéticos com marcador único e transação desfeita sempre que a concorrência não for o objeto da prova (regra da Rodada 65).

- **CA-H039-01 (criação do caso).** Ao primeiro envio de identidade com status `recebido`, existe um caso `pendente` do profissional. Sem envio recebido, nenhum caso existe. Prova: dbtest com e sem envio.
- **CA-H039-02 (papéis).** Leitura de documento, atribuição e decisão por papel diferente de Verificação são negadas com resposta uniforme, sem revelar existência do caso. Prova: matriz de papéis (Admin, Superadmin, Auditor, Suporte, Financeiro, Moderador, profissional dono) e a Verificação.
- **CA-H039-03 (transições).** As transições da tabela §5.1 são aceitas; qualquer outra é recusada. `verification_case_event` não aceita UPDATE nem DELETE. Prova: uma transição válida e uma inválida por linha da tabela; tentativa de UPDATE no histórico recusada.
- **CA-H039-04 (motivo).** Decisão sem `reason_code` ou com código fora da lista é recusada. Código `outro` exige explicação. Explicação com padrão de CPF/CNPJ é recusada. Prova: casos positivos e negativos.
- **CA-H039-05 (aprovação com REG).** Profissional com serviço REG ativo não é aprovado enquanto a função de elegibilidade de #51 não devolver `completas` (fail closed). Sem serviço REG ativo, a aprovação segue. Prova: dois cenários; o primeiro depende de #51 (ver 373).
- **CA-H039-06 (aprovação exige identidade).** Aprovação sem identidade `recebido` com `analyzed_at` preenchido é recusada. Prova: três cenários (sem envio, envio sem leitura, envio lido).
- **CA-H039-07 (auditoria).** Atribuição, leitura, decisão e recurso geram um evento cada, com ator, papel, ação, objeto, estado antes e depois e motivo; a cadeia de hash da auditoria continua válida; nenhum evento contém CPF/CNPJ, nome de arquivo ou texto livre. Prova: captura de eventos e verificação de cadeia.
- **CA-H039-08 (leitura pela porta).** Leitura pela Verificação atribuída: devolve bytes e tipo, grava `analyzed_at` se nulo e grava `sensitive_access_log`, tudo na mesma transação. Falha na gravação do log desfaz a leitura. Prova: teste de sucesso e teste com falha injetada.
- **CA-H039-09 (exclusão × primeira leitura).** Com duas conexões, primeira leitura e exclusão pelo dono se serializam: depois de `analyzed_at`, a exclusão responde 409; a exclusão nunca apaga documento já analisado. Prova: teste de concorrência com marcador (herda T-24 de #50).
- **CA-H039-10 (entrega segura).** A resposta de leitura tem `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` e nenhuma URL pública. Prova: teste de rota.
- **CA-H039-11 (sem rota comum).** Nenhuma rota de leitura de documento fora da Verificação; varredura de rotas e teste estático do adaptador. Prova: varredura como T-06 e T-17 de #50.
- **CA-H039-12 (isolamento da porta).** A classe leitora é arquivo novo; nenhum arquivo do serviço de envio importa ou instancia a porta. Prova: teste estático, mantendo CA-19 de #50.
- **CA-H039-13 (retenção manual).** Decisão `retida_duplicidade` com motivo grava o estado; a conta não é suspensa, o perfil não é bloqueado e nenhum pedido é afetado. Prova: estado do perfil antes e depois.
- **CA-H039-14 (recurso).** Recurso em `recusada` ou `retida_duplicidade` muda `appeal_status` para `pendente`, leva o caso a `em_revisao` e gera evento. Recurso em `pendente` ou `aprovada` é recusado. Prova: quatro cenários.
- **CA-H039-15 (meta).** `sla_target_at` é calculado na criação (dois dias úteis, conforme 384). Nenhum alerta, bloqueio ou job é criado. Prova: cálculo em três datas de fronteira (sexta, sábado e véspera de fim de semana).
- **CA-H039-16 (fila).** A lista ordena por `sla_target_at`, pagina, não mostra CPF/CNPJ, nome de arquivo nem SHA-256. Fila vazia mostra estado vazio. Prova: contrato da resposta e teste de tela.
- **CA-H039-17 (erros).** Falha de leitura mostra a mensagem genérica sem caminho nem detalhe técnico. Prova: teste de tela com storage simulado indisponível.
- **CA-H039-18 (sem expurgo).** Nenhum job, cron, trigger de tempo ou rota de exclusão por decisão é criado. Prova: consulta ao catálogo de jobs e varredura de rotas.
- **CA-H039-19 (execução local).** `corepack pnpm check:all` e `db:test` rodam localmente, com comando, contagem e código de saída registrados na Issue. Sem chamada externa, sem Mapbox e sem alegação de CI verde.

## 8. Modelo de dados (referência de Arquitetura)

- **Nova:** `app.verification_case`, `app.verification_case_event` (imutável), e `private.idoc_review_target` (ou nome equivalente definido pela Arquitetura).
- **Existentes e usadas:** `app.identity_document` (de #50), `app.professional_profile` (`verification_status`, `document_hmac`), `app.sensitive_access_log` (de `20261111290000`), `audit.audit_event` (H-006).
- **Tarefa atribuída:** `assigned_to` em `verification_case`. Mecanismo de permissão ligado ao papel Verificação (H-102, #111, concluída).
- **Corrigir na Arquitetura:** `09` §3.3 e §6 falam em "tarefa atribuída" sem definir a tabela; `08` §5 lista os estados. Ver 107 §12 sobre a correção de `identity_document`.

## 9. Riscos

- **R1. Aprovação sem certificação.** Se H-039 aprovar profissional com serviço REG antes de #51, FA-004 é violado. Mitigação: fail closed (CA-H039-05); pergunta 373.
- **R2. Duplicidade × índice único.** `document_hmac` é único entre perfis não recusados (`09` §3.3). O índice pode recusar o segundo cadastro antes de existir caso, e isso conflita com "retenção, não bloqueio". Mitigação: pergunta 374; H-040 deve resolver a interação.
- **R3. Vazamento de documento.** Leitura errada expõe identidade. Mitigação: CA-H039-02, CA-H039-08, CA-H039-10 a 12.
- **R4. Expectativa da meta.** O prazo de dois dias úteis pode virar promessa. Mitigação: RN-H039-08; sem alerta nesta história.
- **R5. Ordem de execução.** Desenvolvimento antes de Arquitetura e antes de #51 gera retrabalho. Mitigação: §1; pergunta 388.
- **R6. Dados de teste no banco de desenvolvimento.** Casos de teste deixam linhas. Mitigação: marcador único, transação desfeita, contagem por marcador (Rodada 65).
- **R7. Escopo do admin.** Pedidos de leitura por admin podem entrar na fila sem caso. Mitigação: CA-H039-02; RF-148 fica com H-073.
- **R8. Retenção sem prazo.** Documentos ficam sem expurgo até L1. Mitigação: RN-H039-09; registrar como risco aceito até a decisão jurídica.

## 10. Perguntas ao líder

Lista única, numerada de 370 a 389. Cada item traz a recomendação do PO e a decisão que destrava. Nenhuma é enviada ao usuário.

**370. Quando o caso nasce?**
- (a) No primeiro envio de identidade com status `recebido`.
- (b) Quando o profissional pede análise.
- **Recomendação:** (a), que é o que o ciclo de #50 pressupõe. Destrava CA-H039-01.

**371. Relação entre `verification_status` do perfil e `verification_case.status`.**
- **Recomendação:** o caso é a fonte; o perfil espelha o caso mais recente, na mesma transação, e só H-039 escreve nele. `[PROPOSTA]`. Destrava RN e §5.1.

**372. Atribuição da tarefa.**
- (a) A própria Verificação pega um caso `pendente` (autoatribuição); Superadmin pode reatribuir com evento.
- (b) Só Superadmin atribui.
- **Recomendação:** (a), com reatribuição auditada. Destrava CA-H039-02.

**373. Aprovação de profissional com serviço REG antes de #51.**
- (a) Fail closed: profissional com serviço REG ativo não é aprovado até #51 entregar a função; sem REG, a aprovação segue.
- (b) H-039 aguarda #51 inteiro antes de qualquer aprovação.
- (c) Aprovar sem checagem até #51.
- **Recomendação:** (a). (c) viola FA-004. Destrava CA-H039-05 e R1.

**374. Duplicidade e índice único de `document_hmac`.**
- (a) H-039 faz só a retenção manual; H-040 altera o índice para permitir a retenção, e a Arquitetura desenha a interação.
- (b) O índice continua e a duplicidade é recusada no cadastro (sem retenção).
- **Recomendação:** (a), que segue RF-049 ("não há bloqueio definitivo automático"). Destrava R2 e a Arquitetura.

**375. Lista de motivos (`reason_code`).**
- **Recomendação:** `documento_ilegivel`, `documento_divergente`, `tipo_nao_aceito`, `duplicidade_suspeita`, `certificacao_insuficiente`, `outro`, mais `aprovado`. `[PROPOSTA]`. Destrava CA-H039-04.

**376. Texto da explicação ao profissional.**
- (a) Modelo por motivo, com complemento livre curto, sem dado pessoal.
- (b) Texto livre completo.
- **Recomendação:** (a), com limite de 500 caracteres `[PROPOSTA]`. Destrava CA-H039-04 e H-041.

**377. Recurso: quantidade e prazo.**
- **Recomendação:** um recurso por decisão, sem prazo fixo nesta história; prazo é decisão do dono. `[PROPOSTA]`. Destrava CA-H039-14.

**378. Recurso decidido por quem.**
- (a) Verificação diferente da que decidiu.
- (b) Qualquer Verificação.
- **Recomendação:** (a), por conflito de interesse. Destrava §5.2 passo 6.

**379. Liberação de caso `retida_duplicidade`.**
- **Recomendação:** só por decisão motivada da Verificação, que leva a `aprovada` ou `recusada`. Sem liberação automática. Destrava CA-H039-13.

**380. Estado `suspensa`.**
- (a) Fora de H-039; fica para o admin (dupla aprovação para permanente, tabela de estados de `09`).
- (b) H-039 permite suspensão pela Verificação.
- **Recomendação:** (a). Destrava §4 e §5.1.

**381. Forma de entrega do documento ao navegador.**
- (a) Fluxo pela API, anexo, `no-store`, sem URL.
- (b) URL curta de cerca de 60 s, anexo.
- **Recomendação:** (a), porque a URL não aparece em histórico nem em log. Ambas são permitidas por 107 §7. Destrava CA-H039-10.

**382. Limite de leituras por caso ou por Verificação.**
- **Recomendação:** sem limite nesta história; cada leitura é registrada. Eventual limite contra raspagem não está previsto no backlog para esta história; se o dono quiser, vira item próprio. `[PROPOSTA]`. Destrava CA-H039-08.

**383. Leitura por admin e Superadmin.**
- **Recomendação:** nenhuma leitura fora da Verificação; acesso excepcional fica com H-073 (`access_case`, pessoa diferente, validade curta). Destrava CA-H039-02.

**384. Dias úteis do prazo-meta.**
- **Recomendação:** segunda a sexta, sem feriados nesta versão, fuso América/Sao_Paulo, sem alerta. `[PROPOSTA]`; calendário de feriados fica como pendência. Destrava CA-H039-15.

**385. Evento de decisão e e-mail.**
- (a) Gravar evento de saída (outbox) na decisão, sem e-mail nesta história; o modelo de e-mail é de E11.
- (b) Enviar e-mail de decisão já nesta história.
- **Recomendação:** (a). Não há envio nesta fase (regra de desenvolvimento). Destrava o contrato de evento.

**386. Onde fica a tela da fila.**
- (a) Dentro do console admin por papel (#112, concluída), no papel Verificação.
- (b) Aplicativo separado.
- **Recomendação:** (a). Destrava CA-H039-16 e os textos de estado vazio e erro.

**387. Dados visíveis na fila.**
- **Recomendação:** identificador curto do caso, serviços, data de envio, estado e prazo-meta. Sem CPF/CNPJ, nome de arquivo ou nome completo na fila; o detalhe mostra só o que §5.2 passo 3 prevê. `[PROPOSTA]`. Destrava CA-H039-16.

**388. Ordem entre #51 e #52.**
- **Recomendação:** #51 entrega a função de elegibilidade antes da aprovação de #52, como recomendado em 116 (pergunta 309). Destrava a ordem de execução (R5).

**389. Motivo na leitura do documento.**
- (a) Código fixo de análise no momento da leitura, gravado em `sensitive_access_log`.
- (b) Texto livre digitado pela Verificação.
- **Recomendação:** (a), para não criar campo de texto com dado pessoal. Destrava CA-H039-08.

## 11. Próximos passos

1. Líder confirma o texto da Issue #52 no GitHub e responde as perguntas 370 a 389 em lista única.
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas adotadas.
4. Mover #52 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura desenha a tabela de caso, a função de leitura, a tarefa atribuída e as permissões. Desenvolvimento só começa depois.
6. Aprovação completa só é fechada com #51 entregue, ou com a decisão 373 registrada.

## 12. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\123-REFINO-H039.md`.
- **Nenhum código, migração, teste, chamada externa ou alteração de quadro foi feito.** A Issue #52 permanece em Product Owner.
- **Sem alteração do backlog nem de outros documentos.** Itens de backup não fazem parte deste refino.
