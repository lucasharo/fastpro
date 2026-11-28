# Refino H-041 — Estado da verificação visível ao profissional (Issue #54)

- **Issue:** #54 `[E4] Estado da verificação visível` · **História:** H-041 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, banco, chamada externa (Mapbox proibido) ou alteração no quadro. A Issue permanece na coluna Product Owner até o líder decidir a movimentação.
- **Perguntas ao líder:** numeração 543 a 562, faixa reservada a esta Issue.
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (H-041 = #54), `14-BACKLOG.md` (linha H-041, H-039, H-040, H-042), `04-PRD.md` (RF-046 a RF-053, RF-147), `05-CRITERIOS-ACEITE.md` (FA-004, FA-005), `123-REFINO-H039.md`, `124-DESENHO-H039.md`, `131-REFINO-H040.md`, `134-DESENHO-H040.md`, `11-DECISOES.md` (Rodadas 76, 80, 99, 102, 103, 104, 118), e o formato de `113-REFINO-H045.md`.

Conferido no repositório (somente existência e leitura de cabeçalho; nada alterado):
- `supabase/migrations/20261113200000_verification_create_case_queue.sql`: `appeal_status` (`nenhum`, `pendente`, `decidido`), função `private.verification_case_appeal` (códigos `ok`, `sem_caso`, `nao_elegivel`, `recurso_ja_usado`), `private.verification_queue_list` e `verification_event_add`.
- `apps/api/src/admin-verification-route.ts` existe (rotas de console da #52). Não há rota de profissional para o estado da verificação.
- `apps/api/src/professional-profile-route.ts`: contém `ProfessionalDocumentOutcome` (`pendente`, `retida_duplicidade`, `ja_cadastrado`) e declara que o corpo da resposta é igual para pendente e retido. `[NÃO VERIFICADO]` que a resposta não ecoe o valor interno em outra rota; o DEV confere.
- `packages/domain/src/verification/` contém `duplicate-retention.ts` e `professional-status-message.ts`, criados pela #53 (em QA). `[NÃO VERIFICADO]` o conteúdo final; o refino não os leu linha a linha.
- `supabase/migrations/20261113310000_verification_fix_duplicate_original_rule.sql` existe e é posterior à `20261113280000` da #53. `[NÃO VERIFICADO]` o conteúdo; o refino só registra a existência.
- `apps/web/public/` tem páginas de documentos do profissional (`profissional-documentos.js`, `profissional-documento.js`) e testes em `apps/web/tests/`. Não há tela de estado da verificação (busca por `em_revisao`, `retida`, `recusada` e `verification_status` sem resultado nas páginas do profissional).
- `apps/mobile/` contém só `.gitkeep`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #54 no GitHub não foi lido. Este agente não executou `gh`. O objetivo foi reconstruído da linha H-041 do backlog e das fontes acima. O líder deve conferir o texto da Issue antes da Arquitetura.
- Nenhum banco foi consultado. A existência de objetos vem só de migrações e arquivos versionados.
- O estado atual da #53 (QA) não foi reavaliado. Este refino depende do que ela entrega (ver §8 e pergunta 559).

---

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` Quadro: #54 está na coluna **Product Owner**, junto de #55 e #51. A única etapa correta agora é o refino. Não há Arquitetura nem Desenvolvimento antes deste refino.
- `[VERIFICADO]` Dependência declarada no backlog para H-041: **H-039 (#52)**. No quadro, **#52 está em Concluído** (Rodada 102: fechamento com QA aprovado com ressalvas, autorização do usuário para concluir Issues que chegam a Aguardando aprovação).
- `[VERIFICADO]` **#53 (H-040) está em QA** (quadro, seção QA). A Rodada 118 registra que o QA da #53 foi reexecutado. A #53 não é dependência declarada de H-041, mas é dependência de fato: o estado de retido (`retida_duplicidade`) mostrado ao profissional segue a regra de `em_analise` e a mensagem neutra, que vêm da #53 (decisão H040-530 e decisão 483).
- `[VERIFICADO]` #51 (H-038) está em Product Owner. Não bloqueia o backend de leitura de H-041. Aprovação com serviço regulamentado continua fail closed (decisão 373 e 403).
- `[VERIFICADO]` #55 (H-042) está em Product Owner. Não é dependência de H-041. Consome o mesmo estado, mas não depende da tela.
- `[VERIFICADO]` Concluídas e usadas: #48 (H-035, `verification_status`, `verified_at`, documento), #50 (H-037, documentos e tela de envio), #29 (H-016, sessão do profissional), #19 (H-006, auditoria), #57 (H-044) e #58 (H-045), que H-041 não consome.
- `[VERIFICADO]` **Sem casca web:** não existe no repositório a área logada do profissional com tela de estado. As páginas existentes são de documentos (H-037). O app móvel é só estrutura (#131, Backlog). Por isso a entrega de H-041 é um **módulo de apresentação** (ver §5.4 e pergunta 557), no mesmo padrão aceito para #47 (decisão 518) e #57 (decisões 541 e 118).

### 1.1 Resposta à pergunta de início de Desenvolvimento

- `[VERIFICADO]` H-041 **não pode começar Desenvolvimento agora**. WF-03 manda o cartão primeiro para **Arquitetura**. A Arquitetura pode começar, porque a dependência declarada (#52) está concluída.
- `[PROPOSTA]` Recomendo que o Desenvolvimento de H-041 comece só depois de #53 estar Concluída por decisão humana, porque a rota de estado depende da mensagem neutra e da regra de `em_analise` de #53 (pergunta 559).

---

## 2. Objetivo

Dar ao profissional uma leitura clara da situação do seu cadastro (sem envio, em análise, aprovado, recusado, suspenso), com o motivo e a explicação quando puderem ser mostrados, e um canal para pedir revisão de uma recusa. Nada disso pode revelar que existe outro cadastro com o mesmo documento.

Resultado de negócio: o profissional sabe em que pé está e o que fazer, sem depender de contato com o suporte, e a Verificação recebe o pedido de revisão com a trilha de auditoria já pronta (H-039).

---

## 3. Escopo (dentro de H-041)

1. **Estado público.** Regra pura que converte o estado interno do cadastro em um dos estados visíveis (§5.1), com texto neutro. Reaproveita o arquivo de mensagem da #53, se ele já tiver o mapeamento (pergunta 560).
2. **Leitura do próprio estado.** Função de leitura, sem escrita, que devolve somente os campos da lista branca (§6.3), e a rota correspondente do profissional (`GET`). `[PROPOSTA]` caminho: `GET /v1/professional/verificacao`.
3. **Motivo e explicação.** Código de motivo em texto legível e o complemento da Verificação (até 500 caracteres, já filtrado na escrita por H-039). Motivo `duplicidade_suspeita` nunca é mostrado (ver §7, RN-H041-02).
4. **Recurso do profissional.** Rota `POST` que chama `private.verification_case_appeal` (já existe em #52). Decisão 392: a rota de recurso é de H-041. `[PROPOSTA]` caminho: `POST /v1/professional/verificacao/recurso`, sem corpo de texto livre nesta versão (pergunta 553).
5. **Módulo de apresentação da tela.** Estados de tela (§5.4), textos e acessibilidade, sem casca web (pergunta 557).
6. **Testes.** Domínio, leitura e rota, com dados sintéticos marcados e transação desfeita. Testes de neutralidade (CA-H041-02 a 04).

---

## 4. Fora de escopo

- Aprovar, recusar, reter e atribuir: H-039 (#52).
- Detecção de duplicidade, índice e retenção no cadastro: H-040 (#53) e H-035 (#48).
- Console da Verificação e sua tela de fila: #52 e #112.
- Guarda de aceite e de descoberta por aprovação: H-042 (#55) e H-055 (#68). H-041 não nega nem libera nada.
- Selo "verificado" e perfil público: H-043 (#56).
- Trial e assinatura: H-044 e H-045.
- Suspensão e revogação administrativa (decisão 380): H-041 só mostra o estado `suspensa` (pergunta 546).
- Prazo-meta de dois dias úteis exibido ao profissional: não exibido nesta história (pergunta 548; RN-H039-08).
- E-mail, aviso ou push de mudança de estado: E11, sem envio nesta fase (decisão 385; regra de desenvolvimento).
- Casca web completa, área logada e navegação do profissional: história própria (pergunta 557).
- Aplicativo móvel (#131, #133): fora.
- Job, cron, tick ou alerta: nenhum (CA-H041-17).
- Mapbox, backup e chamada externa: fora.

---

## 5. Estados visíveis e fluxos

### 5.1 Estados públicos (o que o profissional vê)

| Estado público | Quando (estado interno) | Texto ao profissional `[PROPOSTA]` salvo onde indicado | Ação disponível |
|---|---|---|---|
| `sem_envio` | Nenhum documento de identidade `recebido` (H-037) | "Você ainda não enviou seus documentos. Envie para começar a análise." | Ir à tela de envio de documentos (H-037) |
| `em_analise` | `pendente`, `em_revisao` (inclusive recurso sem dono) e `retida_duplicidade` (H040-530) | "Não foi possível concluir seu cadastro agora. Vamos revisar seu caso." (decisão 483; ver pergunta 561 sobre o texto de `pendente`) | Nenhuma. Se houver recurso, mostra "Seu pedido de revisão foi recebido." |
| `aprovada` | `aprovada` | "Seu cadastro foi aprovado." e data da aprovação (`verified_at`) | Nenhuma |
| `recusada` | `recusada` | "Seu cadastro não foi aprovado." + motivo legível (§5.2) + explicação, se houver | "Pedir revisão", se o recurso ainda não foi usado (pergunta 549) |
| `suspensa` | `suspensa` | "Sua conta está com restrição. Entre em contato com o suporte." `[PROPOSTA]` | Nenhuma (recurso fica fora, decisão 380) (pergunta 546) |

Regra de mapeamento: `pendente`, `em_revisao` e `retida_duplicidade` viram o mesmo estado público `em_analise`, com o mesmo texto e o mesmo corpo de resposta (`[DECIDIDO 483]`, `[DECIDIDO H040-530]`).

### 5.2 Motivos legíveis (`reason_code` de H-039, decisão 375)

| Código interno | Texto `[PROPOSTA]` | Observação |
|---|---|---|
| `documento_ilegivel` | "O documento enviado não está legível." | |
| `documento_divergente` | "Os dados do documento não conferem com o cadastro." | |
| `tipo_nao_aceito` | "O tipo de arquivo enviado não é aceito." | Limites exatos de AMB-33 (formato) ainda abertos (ver §10) |
| `certificacao_insuficiente` | "A certificação enviada não atende ao serviço escolhido." | Vinculado a H-038 |
| `outro` | "Veja a explicação abaixo." | Explicação obrigatória (CHECK de H-039) |
| `duplicidade_suspeita` | **nunca mostrado** | Ver RN-H041-02 e pergunta 545 |

### 5.3 Fluxo do profissional

1. Abre a tela de situação. A tela pede ao servidor o estado (§6.1). Mostra "carregando".
2. Recebe um dos estados de §5.1 e mostra o texto, o motivo e a explicação quando existirem.
3. Em `recusada` sem recurso usado, pode "Pedir revisão". A API cria o recurso (§6.2). A tela mostra "Seu pedido de revisão foi recebido." e desabilita o botão.
4. Em `sem_envio`, leva à tela de documentos (H-037). Enviar documento não reabre caso recusado (decisão 393; pergunta 554).

### 5.4 Estados de tela (módulo de apresentação)

- **Carregando:** indicador com texto "Carregando sua situação".
- **Sem envio:** texto de §5.1 e link para envio.
- **Em análise, aprovada, suspensa, recusada:** conteúdo de §5.1 e §5.2.
- **Recurso recebido:** mensagem de confirmação; botão desabilitado.
- **Erro de carregamento:** "Não foi possível carregar sua situação. Tente de novo." `[PROPOSTA]`, sem código, sem caminho e sem detalhe técnico.
- **Recurso indisponível (409):** "Não é possível pedir revisão agora." `[PROPOSTA]`.
- **Sem sessão:** redireciona ao login do profissional (padrão de H-016); sem texto de erro próprio.

---

## 6. Contratos (proposta de Arquitetura, sem implementação)

### 6.1 Leitura do estado

- `GET /v1/professional/verificacao`. Sessão do profissional (H-016). `Cache-Control: no-store`.
- Resposta (lista branca): `{ estado, motivo?, explicacao?, decididoEm?, recurso: { situacao } }`, em que `estado` ∈ {`sem_envio`, `em_analise`, `aprovada`, `recusada`, `suspensa`} e `recurso.situacao` ∈ {`indisponivel`, `disponivel`, `recebido`}.
- `motivo` só aparece em `recusada`, com um código da lista de §5.2 (nunca `duplicidade_suspeita`; nesse caso `motivo` fica ausente e o texto é o neutro, pergunta 545).
- `explicacao` é o complemento da Verificação (texto de até 500 caracteres) e só aparece em `recusada`.
- A leitura é uma função de banco de leitura (`STABLE`, `security definer`, `search_path = ''`, sem grant de tabela a papéis de API, `execute` só a `app_system`), no padrão de #52. `[PROPOSTA]` para a Arquitetura decidir se é função nova ou reaproveita `verification_case_detail` com visão limitada.

### 6.2 Recurso

- `POST /v1/professional/verificacao/recurso`. Sem corpo de texto livre nesta versão (pergunta 553). CSRF e cabeçalhos de origem como nas rotas de profissional existentes.
- Mapeamento de `verification_case_appeal`:
  - `ok` → `200 { recurso: 'recebido' }`;
  - `sem_caso`, `nao_elegivel` e `recurso_ja_usado` → `409 { code: 'recurso_indisponivel' }`, com o texto de §5.4 (mesma resposta para os três, para não distinguir caso, estado ou uso anterior).
- Efeito: `appeal_status = 'pendente'`, caso sem dono em `em_revisao`, evento `appeal_received` e auditoria, tudo já feito por #52 (CA-H039-14).

### 6.3 Campos proibidos na resposta

Nunca aparecem: identificador do caso, identificador do analista (`assigned_to`, `decided_by`), identificador ou prefixo de outro perfil, `document_id`, `stored_type`, nome ou caminho de arquivo, SHA-256, HMAC, CPF ou CNPJ, valores internos (`pendente`, `em_revisao`, `retida_duplicidade`), `version`, `reason_code` de duplicidade, e datas de envio do documento além de `decididoEm`.

---

## 7. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-041 atende |
|---|---|---|---|
| RN-H041-01 | O profissional só vê os estados de §5.1. Nenhum valor interno aparece em resposta, tela ou texto. | RF-053 `[PROPOSTA]`; decisões 483 e H040-530 | CA-H041-01, CA-H041-11 |
| RN-H041-02 | Duplicidade nunca é revelada ao profissional: não aparece como estado, motivo, texto, código ou identificador. | RF-049 (retém sem bloquear); decisão 483; 131 §5 (RN-H040-08) | CA-H041-02, CA-H041-03, CA-H041-04 |
| RN-H041-03 | A explicação mostrada é só o complemento da Verificação, sem dado pessoal, como escrito por H-039. | Decisão 376; CHECK de H-039 | CA-H041-12 |
| RN-H041-04 | Recurso só em `recusada`, uma vez por caso, pela função de #52. Recurso em `em_analise` (retido) segue a pergunta 549. | Decisões 377, 391, 392, 400 | CA-H041-07, CA-H041-08 |
| RN-H041-05 | Sem prazo-meta, alerta ou promessa de tempo na tela. | RF-048 (meta, não promessa); decisão 384; RN-H039-08 | CA-H041-05 (aprovada sem prazo) e CA-H041-13 |
| RN-H041-06 | Estados internos equivalentes têm a mesma resposta (corpo, status HTTP e texto). | 131 §5 (RN-H040-08); 134 §6 (anti-enumeração) | CA-H041-02 |
| RN-H041-07 | Leitura não altera nada e não concede nem nega acesso (aceite, descoberta e trial). | `08` §1.1 (P4); H-042 e H-055 são donos da guarda | CA-H041-10, CA-H041-16 |
| RN-H041-08 | Aprovação não cria selo, garantia nem certificação na tela. | H-043; FA-019 | CA-H041-05 |
| RN-H041-09 | Textos finais são aprovados pelo dono antes do Desenvolvimento. | Decisão 483 (texto neutro adotado sem aprovação de copy) | CA-H041-14 (pergunta 561) |

---

## 8. Critérios de aceite (numerados e testáveis)

Testes de banco usam dados sintéticos com marcador único e transação desfeita, salvo concorrência (Rodada 65).

- **CA-H041-01 (estados).** Para cada estado interno (`sem_envio`, `pendente`, `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa`), a leitura devolve exatamente um estado de §5.1. Prova: tabela de teste com sete linhas.
- **CA-H041-02 (neutralidade de em análise).** `pendente`, `em_revisao` e `retida_duplicidade` devolvem o mesmo `estado`, o mesmo texto e o mesmo corpo HTTP (comparação byte a byte, `200`). Prova: três fixtures e comparação.
- **CA-H041-03 (nunca duplicidade).** Nenhum corpo de resposta, texto de tela ou mensagem de erro contém "duplic", "já existe", "outro cadastro", identificador de outro perfil, CPF/CNPJ ou o código `duplicidade_suspeita`. Prova: varredura de todos os textos e de respostas de fixtures retidas e recusadas por duplicidade.
- **CA-H041-04 (recusa por duplicidade).** Recusa com `duplicidade_suspeita` (decisão 526 de #53) mostra o texto neutro de recusa e não mostra motivo. Prova: fixture de retido recusado e comparação com recusa comum.
- **CA-H041-05 (aprovada).** Aprovada mostra o texto de aprovação e a data `verified_at`, sem selo, sem garantia e sem prazo. Prova: fixture aprovada e varredura de texto.
- **CA-H041-06 (sem envio).** Profissional sem documento `recebido` vê `sem_envio` e o link de envio, e não existe caso. Prova: dbtest com e sem envio.
- **CA-H041-07 (recurso em recusada).** Em `recusada` com recurso não usado, `POST` devolve `200 { recurso: 'recebido' }`, o caso vai a `em_revisao` sem dono com `appeal_status = 'pendente'`, e há um evento. Segundo `POST` devolve `409 recurso_indisponivel`. Prova: dois cenários de rota e dbtest.
- **CA-H041-08 (recurso em retido).** Conforme a pergunta 549: se aceito, recurso de retido devolve a mesma resposta de CA-H041-07, sem revelar a retenção e sem erro de servidor. Prova: fixture de retido com e sem original vivo.
- **CA-H041-09 (permissões).** Leitura e recurso só para o próprio profissional. Caso de outro profissional ou inexistente devolve a mesma resposta uniforme (`404 nao_encontrado`). Sem sessão, `401`. Admin e Superadmin não usam essas rotas. Prova: três cenários de rota.
- **CA-H041-10 (somente leitura).** `GET` não altera linhas de `app.verification_case`, `app.verification_case_event`, `app.professional_profile` nem `audit.audit_event` (contagem e soma antes e depois). Prova: dbtest.
- **CA-H041-11 (lista branca).** Resposta tem só os campos de §6.1. Varredura do corpo: nenhum campo de §6.3. Prova: esquema da resposta com lista branca e teste de fixtures completas.
- **CA-H041-12 (explicação).** A explicação aparece como texto puro (sem HTML interpretado), com no máximo 500 caracteres, e a tela não usa `innerHTML` com esse conteúdo. Prova: teste de markup e teste de texto com `<script>`.
- **CA-H041-13 (sem prazo).** Nenhuma tela ou resposta mostra prazo-meta, "dois dias úteis" ou data prevista. Prova: varredura de textos e de campos.
- **CA-H041-14 (textos e estados de tela).** Os textos de §5.1, §5.2 e §5.4 estão no módulo de apresentação, sem frase fora dessa lista. Estados de carregando, sem envio, erro e recurso recebido existem e são testados. Prova: teste de tabela de textos e de estados.
- **CA-H041-15 (acessibilidade e responsividade).** Estado indicado por texto (não só por cor); foco visível; mensagens de estado em região de aviso (`aria-live`); layout legível em 375 px. Contraste conforme os tokens do Design System do console/perfil. Prova: teste de marcação e checklist; navegador real não verificado nesta rodada (`[NÃO VERIFICADO]`).
- **CA-H041-16 (sem efeito sobre acesso).** Consultar o estado não altera `commercial_access` (H-045), a guarda de aceite (H-042) nem a descoberta (H-055). Prova: comparação de `commercial_access` antes e depois da leitura.
- **CA-H041-17 (sem job e sem e-mail).** Nenhum cron, job, tick, trigger de tempo ou envio de e-mail é criado. Prova: consulta ao catálogo de jobs sem novas linhas e varredura de envio.
- **CA-H041-18 (execução local).** `corepack pnpm check:all` e `corepack pnpm db:test` rodam localmente, com comando, contagem e código de saída registrados na Issue. Sem chamada externa, sem Mapbox e sem alegação de CI verde.

---

## 9. Dependências (conferidas no quadro de 2026-11-13 12:30 UTC)

| Item | Estado | Papel em H-041 | Bloqueia? |
|---|---|---|---|
| H-039 (#52) | **Concluído** | Caso, estados, `verification_case_appeal`, `verification_queue_list`, evento e auditoria | Não (cumprida) |
| H-040 (#53) | **QA** | `retida_duplicidade` vira `em_analise`; mensagem neutra (`professional-status-message`); regra de recurso de retido e de recusa com `duplicidade_suspeita` | **Sim, para Desenvolvimento** (pergunta 559). Não para Arquitetura |
| H-035 (#48) | Concluído | `verification_status`, `verified_at`, retenção no cadastro | Não |
| H-037 (#50) | Concluído | Documentos recebidos (base do `sem_envio`) e tela de envio | Não |
| H-016 (#29) | Concluído | Sessão do profissional e login | Não |
| H-006 (#19) | Concluído | Auditoria append-only | Não |
| H-038 (#51) | Product Owner | Certificação REG (aprovação completa, fail closed) | Não para H-041 |
| H-042 (#55) | Product Owner | Guarda de aceite; consome o mesmo estado | Não (independente), mas compartilha arquivos de composição de API (ver §10, R7) |
| H-043 (#56) | Backlog | Selo verificado | Não |
| H-044 (#57) e H-045 (#58) | Concluídas | Trial e acesso comercial (não usados por H-041) | Não |
| Casca web do profissional | **Não existe** (`apps/web/public` só tem páginas de documentos; `apps/mobile` só `.gitkeep`) | Tela de situação | Sim, para a tela completa; não para o módulo (pergunta 557) |

Observação sobre a regra do backlog: a linha H-041 declara só H-039. A dependência real inclui H-040, porque o estado mostrado ao profissional depende do que #53 entrega.

---

## 10. Riscos

- **R1. Vazamento de duplicidade pelo motivo.** Recusa com `duplicidade_suspeita` (permitida por #53, decisão 526) pode mostrar a palavra ao profissional. Mitigação: RN-H041-02, CA-H041-03 e CA-H041-04; pergunta 545.
- **R2. Diferença de corpo ou de tempo entre estados.** Mitigação: mesmo corpo e mesmo texto (CA-H041-02). Tempo não é medido por teste; risco residual aceito, como em 134 §6.
- **R3. Texto de `em_analise` soa como falha.** A frase da decisão 483 ("Não foi possível concluir seu cadastro agora") é usada também para cadastros normais em `pendente`. Mitigação: pergunta 561.
- **R4. Requisito de visibilidade ainda em proposta.** RF-053 é `[PROPOSTA]` no PRD, enquanto FA-004 é aprovado e exige que o profissional "informe o motivo" na retenção. Essa frase conflita com o texto neutro da decisão 483. Mitigação: pergunta 544.
- **R5. Backlog × decisão de estado.** O backlog de H-041 pede que "retida" seja "exibida corretamente"; a decisão 483 e H040-530 pedem `em_analise` neutro. Mitigação: pergunta 543 (a decisão mais recente prevalece se o líder confirmar).
- **R6. Recurso sem prazo.** A decisão 377 deixa o prazo do recurso com o dono. Mitigação: pergunta 551; a tela não mostra prazo.
- **R7. Arquivos comuns com H-042.** H-041 e H-042 tocam a composição de rotas da API (`apps/api/src/app.ts` e `composicao.ts`). Mitigação: não iniciar as duas em paralelo sem exclusividade de arquivos (`execctl`), ou separar a composição.
- **R8. Estado da #53 ainda em QA.** Os nomes e as mensagens de `professional-status-message` podem mudar. Mitigação: pergunta 559 e 560.
- **R9. Módulo sem uso imediato.** Sem casca web, o módulo não aparece ao profissional até a casca existir. Mitigação: pergunta 557; a rota já fica pronta e testada.
- **R10. Textos duplicados.** A regra de texto pode existir em #53 e em H-041. Mitigação: pergunta 560 (reaproveitar).
- **R11. Numeração de decisões.** Os números 530 a 535 foram usados pela #57 (Rodada 103) e pela #53 (Rodada 104, com prefixo `H040-`). Este refino cita a #53 sempre com o prefixo `H040-`.
- **R12. Prefixo de migração.** `20261113270000` é da #57 e `20261113280000` e `20261113310000` são da #53. H-041 deve usar prefixo maior que o último existente (conferir na hora de criar).

---

## 11. Ambiguidades

- `[AMBIGUIDADE]` Estado da retenção: backlog ("retida exibida") × decisão 483 e H040-530 ("em_analise", neutro). Pergunta 543.
- `[AMBIGUIDADE]` Motivo na retenção: FA-004 ("informa o motivo") × decisão 483 (sem motivo detalhado no primeiro nível). Perguntas 544 e 545.
- `[AMBIGUIDADE]` Recurso: decisão 377 ("um recurso por decisão") × decisão 391 e Rodada 80 ("um por caso"). Pergunta 550.
- `[AMBIGUIDADE]` Estado `suspensa`: aparece em FA-004 e em RF-050, mas não na lista de estados do backlog de H-041. Pergunta 546.
- `[AMBIGUIDADE]` Estado sem envio: não aparece no backlog nem na decisão de #52. Pergunta 562.
- `[AMBIGUIDADE]` Recurso do profissional sem texto: a Verificação pode precisar de contexto. Pergunta 553.

---

## 12. Perguntas ao líder

Lista única, numerada de 543 a 562. Cada item traz a recomendação do PO e a decisão que destrava. Nenhuma é enviada ao usuário.

**543. Estado de retido na tela do profissional.**
- (a) `em_analise` com texto neutro, como nas decisões 483 e H040-530.
- (b) Mostrar "retida" com explicação.
- **Recomendação:** (a). É a única forma compatível com RN-H041-02. O critério "retida exibida" do backlog deve ser ajustado para "estado neutro". Destrava §5.1 e CA-H041-02.

**544. Motivo na retenção (FA-004 × decisão 483).**
- (a) Não mostrar motivo de retenção; o texto neutro basta, e o detalhe segue no recurso.
- (b) Mostrar um texto de retenção sem a palavra duplicidade ("Seu caso precisa de análise adicional.").
- **Recomendação:** (a), por consistência com a decisão 483. Ajustar FA-004 com nota de que o motivo detalhado não é mostrado ao profissional nesta fase. Destrava §5.1 e RN-H041-02.

**545. Recusa com `duplicidade_suspeita`.**
- (a) Texto neutro de recusa ("Seu cadastro não foi aprovado.") e sem motivo.
- (b) Mostrar o motivo "documento já usado em outro cadastro".
- **Recomendação:** (a). (b) viola RN-H041-02. Destrava CA-H041-04.

**546. Estado `suspensa` para o profissional.**
- (a) Mostrar "Sua conta está com restrição. Entre em contato com o suporte.", sem recurso.
- (b) Não mostrar nada (tratar como em análise).
- **Recomendação:** (a), porque o profissional precisa saber que a conta está restrita. Recurso fica fora (decisão 380). Destrava §5.1.

**547. Texto da aprovação.**
- **Recomendação:** "Seu cadastro foi aprovado." e a data, sem selo e sem garantia (RN-H041-08). Destrava CA-H041-05.

**548. Prazo-meta na tela.**
- (a) Não mostrar prazo nem data prevista.
- (b) Mostrar "Costumamos responder em até 2 dias úteis".
- **Recomendação:** (a), porque RF-048 diz que a meta não é promessa e a decisão 384 deixa o prazo como acompanhamento interno. Destrava RN-H041-05.

**549. Quem pode pedir revisão.**
- (a) Só em `recusada` (o botão some em `em_analise`).
- (b) Em `recusada` e também em `em_analise` (inclusive retido), com a mesma resposta neutra.
- **Recomendação:** (a) no primeiro ciclo, porque (b) exige mostrar o botão a quem está retido sem revelar a causa; a regra de #52 aceita recurso de retido, e isso pode virar nova rodada. Destrava CA-H041-08.

**550. Um recurso por caso ou por decisão.**
- (a) Um recurso por caso (decisão 391; Rodada 80).
- (b) Um recurso por decisão (decisão 377).
- **Recomendação:** (a), já adotado na Rodada 80 e no desenho de #52. Confirmar que a decisão 377 é substituída. Destrava CA-H041-07.

**551. Prazo para pedir revisão.**
- (a) Sem prazo nesta história; prazo é decisão do dono (decisão 377).
- (b) Prazo fixo (ex.: 30 dias) definido agora.
- **Recomendação:** (a). A tela não mostra prazo. O dono registra o prazo em outra rodada. Destrava RN-H041-04.

**552. Mostrar a explicação da Verificação.**
- **Recomendação:** sim, como texto puro até 500 caracteres, apenas em `recusada` (decisão 376). Destrava CA-H041-12.

**553. Recurso com texto livre.**
- (a) Sem texto livre nesta versão; o pedido é só o botão.
- (b) Texto opcional de até 500 caracteres, filtrado por dado pessoal (como H-039).
- **Recomendação:** (a), para não criar mais um campo com dado pessoal nesta história. A Verificação já lê o caso e o histórico. Destrava §6.2.

**554. Envio de documento novo depois de recusa.**
- **Recomendação:** não reabre o caso e não conta como recurso; a tela explica que o pedido de revisão é o caminho (decisão 393). H-041 não cria regra de recurso por novo envio. Destrava CA-H041-06 e §5.3.

**555. Aviso de mudança de estado.**
- **Recomendação:** nenhum aviso ativo nesta fase (sem e-mail, decisão 385). Só o estado na tela. O evento de saída para E11 fica como está (#52). Destrava CA-H041-17.

**556. Sessão do profissional para a leitura.**
- **Recomendação:** usar a sessão existente de H-016 (login do profissional), sem prova recente (TOTP vale só para o console, decisão 394). `[NÃO VERIFICADO]` o DEV confirma o nome da validação de sessão. Destrava CA-H041-09.

**557. Entrega sem casca web.**
- (a) Entregar um módulo de apresentação (estado, textos, tela de apresentação em HTML e JavaScript, com testes), e a tela completa fica para a história da casca web do profissional.
- (b) Esperar a casca web para entregar qualquer parte de H-041.
- **Recomendação:** (a), pelo precedente das decisões 518 e 541. A rota e o contrato ficam prontos e testados. Destrava o escopo de §3 e §4.

**558. Padrão de acessibilidade e tamanho mínimo.**
- **Recomendação:** WCAG 2.2 AA, 375 px, estado por texto e não só por cor, região de aviso para mudanças de estado. Igual ao console. Destrava CA-H041-15.

**559. Ordem entre Desenvolvimento de H-041 e a conclusão de #53.**
- (a) Arquitetura de H-041 agora; Desenvolvimento só depois de #53 Concluída por decisão humana.
- (b) Desenvolvimento de H-041 já, em paralelo com #53 em QA.
- **Recomendação:** (a). H-041 usa a regra de estado e a mensagem da #53. Destrava o início do Desenvolvimento.

**560. Reaproveitar `professional-status-message` da #53.**
- **Recomendação:** sim. H-041 consome o arquivo da #53 (mapeamento e textos) e não cria outro. Se a #53 mudar o mapeamento na correção de QA, H-041 segue o arquivo final. Destrava RN-H041-01 e R10.

**561. Textos finais.**
- **Recomendação:** o dono aprova os textos de §5.1, §5.2 e §5.4 antes do Desenvolvimento. Em especial, o texto de `em_analise` para cadastro comum em `pendente` (R3). Destrava CA-H041-14 e RN-H041-09.

**562. Estado `sem_envio`.**
- (a) Mostrar `sem_envio` com link para a tela de documentos.
- (b) Mostrar a tela de documentos direto, sem texto de situação.
- **Recomendação:** (a), para o profissional entender o que falta. Destrava CA-H041-06.

---

## 13. Próximos passos

1. Líder confirma o texto da Issue #54 no GitHub e responde as perguntas 543 a 562 em lista única.
2. Registrar as respostas em `docs/factory/11-DECISOES.md`, com os mesmos números, em rodada nova (append-only). Atenção: os números 530 a 535 já foram usados pela #57; as respostas de H-041 usam 543 a 562.
3. Atualizar este refino com as respostas adotadas, incluindo a correção do critério "retida exibida" do backlog (pergunta 543) e a nota de FA-004 (pergunta 544).
4. Mover #54 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura define as funções de leitura e de recurso, a rota e o módulo de apresentação. Desenvolvimento só começa depois de #53 Concluída por decisão humana (pergunta 559).
6. Aprovação completa do cadastro continua dependente de #51 (fail closed, decisões 373 e 403). H-041 não muda esse ponto.

## 14. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\136-REFINO-H041.md`.
- **Nenhum código, migração, teste, banco, chamada externa ou alteração de quadro foi feito.** A Issue #54 permanece em Product Owner.
- **Sem alteração do backlog, do PRD ou de outros documentos.**
