# Refino H-044 — Trial de 14 dias (Issue #57)

- **Issue:** #57 `[E5] Trial de 14 dias` · **História:** H-044 · **Épico:** E5 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, consulta ao banco ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Perguntas ao líder:** numeração 496 a 515, faixa reservada a esta Issue.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (linha H-044 = #57), `14-BACKLOG.md` (H-039, H-044, H-045, H-050), `04-PRD.md` (RF-057, RF-058, RF-064, FA-005), `05-CRITERIOS-ACEITE.md` (FA-005, FA-025), `07-AMBIGUIDADES.md` (AMB-06, AMB-09), `08-ARQUITETURA.md` (§ billing, itens 2 a 6; bloco de transações e relógio), `09-MODELO-DADOS.md` (`access_grant`, `professional_profile`), `11-ARQ-RISCOS-E-TESTES.md` (I-14, I-25, tabela de rotas, B-07), `11-DECISOES.md` (rodadas 61 e 62, decisões 267 a 289), `113-REFINO-H045.md`, `114-DESENHO-H045.md`, `123-REFINO-H039.md` (formato e fronteiras).

Conferido no repositório (somente leitura, por migrações versionadas):
- `supabase/migrations/20261111400000_identity_create_professional_account.sql`: `app.professional_profile.verification_status` com valores `pendente`, `em_revisao`, `aprovada`, `retida_duplicidade`, `recusada`, `suspensa`; `app_api` não recebe UPDATE nessa coluna.
- `supabase/migrations/20261111420000_identity_professional_profile_document.sql`: `document_hmac text` (regex de 64 hex) e índice único parcial `professional_profile_document_hmac_vivo_key`, que exclui `recusada` e `retida_duplicidade`.
- `supabase/migrations/20261113170000_billing_create_access_grant.sql`: arquivo existe (entrega de H-045, #58).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #57 no GitHub não foi lido. O objetivo foi reconstruído da linha H-044 do backlog e das fontes acima. O líder deve conferir o texto antes da Arquitetura.
- Nenhum banco foi consultado. Não se sabe se a migração de `access_grant` já foi aplicada no banco de desenvolvimento, nem se a coluna `identity_id` existe lá. Pela leitura das migrações, `identity_id` não existe em nenhuma tabela.
- A decisão de aprovação que grava `aprovada` (H-039) ainda não foi concluída. O comportamento real dessa função não foi testado.

---

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` O quadro mostra #57 em **Product Owner** (coluna 3 de 4 da coluna, junto de #47, #53 e #51). A ordem de colunas está correta para esta etapa.
- `[VERIFICADO]` Dependências declaradas de H-044 no backlog: **H-039 (#52)** e **H-045 (#58)**.
- `[VERIFICADO]` Estado real delas no quadro:
  - **#58 (H-045): Concluído.** Sua entrega (tabela `access_grant`, função `commercial_access`) está no repositório. A aplicação no banco de desenvolvimento é `[NÃO VERIFICADO]`.
  - **#52 (H-039): em QA, não Concluída.** Somente decisão humana conclui. Até lá, a aprovação de verificação não é um fato consolidado do sistema.
- `[VERIFICADO]` **H-039 é o único escritor de `verification_status = 'aprovada'`.** Pela migração 20261111400000 (comentário do item 1), a função de decisão de H-039 é que muda essa coluna, e `app_api` não tem UPDATE nela. Consequência: a ativação do trial só pode ser provada de ponta a ponta quando #52 estiver Concluída. Antes disso, a prova usa fixture com `aprovada` (mesmo critério usado em H-045). Ver pergunta 498.

**Decisão 289 (origem de `identity_id` fornecida por H-044). O que falta:**
- `[VERIFICADO]` `identity_id` não existe em nenhuma migração, nem em `professional_profile`. A `09` §3.1 e §3.10 a citam, mas a coluna não foi criada (ver também `114-DESENHO-H045.md` §2).
- `[VERIFICADO]` `access_grant.identity_id` foi definido como `uuid not null`, sem FK (`114-DESENHO-H045.md`, tabela de colunas).
- `[VERIFICADO]` A identidade real que existe hoje é `professional_profile.document_hmac`, um `text` de 64 caracteres hexadecimais, único entre perfis vivos (migração 20261111420000, H-035/#48, Concluída).
- **Incompatibilidade de tipo:** o livro espera `uuid`; a identidade existente é texto hexadecimal. Não há, hoje, nenhum uuid estável derivado de um documento.
- **Falta decidir:** (1) como o `identity_id` uuid é obtido (derivação determinística do `document_hmac`, nova coluna, ou troca de tipo no livro); (2) quem o grava e em qual história; (3) se a regra de unicidade do trial passa a valer pelo mesmo critério de `document_hmac`. Ver perguntas 496 e 497.
- **Risco se a derivação for aleatória por perfil:** um segundo perfil com o mesmo documento teria outro `identity_id` e poderia ganhar um segundo trial. Por isso a derivação deve ser determinística (ver R1).

---

## 2. Objetivo

Permitir que um profissional **aprovado** ative, por ação própria, um teste gratuito de **14 dias** de acesso comercial, **sem meio de pagamento**, sem conversão automática em assinatura e sem cobrança ao fim. Cada identidade tem no máximo um trial.

Resultado de negócio: o profissional experimenta a plataforma por 14 dias antes de decidir pagar. O FastPro não cria cobrança a partir do trial, e o trial não reabre quando termina.

---

## 3. Escopo (dentro de H-044)

1. Rota `POST /v1/billing/trial/activate`, chamada pelo próprio profissional autenticado (`08`, billing, item 2; `11` tabela de rotas).
2. Checagem de elegibilidade no instante da ativação: `verification_status = 'aprovada'` e nenhum trial anterior da identidade. Checagem de ausência de concessão paga ou assinatura conforme pergunta 499.
3. Inserção de uma linha `access_grant` com `type = 'trial'`, `status = 'ativa'`, `starts_at` = instante do servidor (ver pergunta 507), `ends_at = starts_at + 14 dias`, `source_payment_id` nulo, e `identity_id` conforme pergunta 496.
4. Auditoria da criação (decisão 284: a criação de concessões é auditada pelos escritores, e H-044 é um deles). Evento `TrialActivated` com ator e data, sem dado pessoal.
5. Resposta de sucesso com início e fim do trial. O estado de acesso passa a ser lido de `commercial_access` (H-045). H-044 não reimplementa a regra de estados.
6. Resposta `409 trial_used` quando a identidade já teve trial, em qualquer status.
7. Testes de banco, de rota e de domínio, com dados sintéticos marcados (R8).

---

## 4. Fora de escopo

- Checkout, cobrança, webhook, assinatura e qualquer chamada ao Mercado Pago (H-047, H-048, H-053). O trial é local (`08`, item 8: "o teste grátis de 14 dias sem cartão é do nosso app (trial local, `access_grant`), não do MP").
- Conversão automática do trial em assinatura paga. `[DECIDIDO]` RF-057: "sem conversão automática".
- Concessão paga e início de período (H-049), carência de 72 h (H-050), cancelamento (H-052).
- Lembretes de fim de trial e envio de e-mail (H-099 / #109). H-044 não envia e-mail (pergunta 506).
- Regra de aprovação em si (H-039, #52) e guarda geral de descoberta e aceite (H-042 / #55). H-044 só checa a elegibilidade do próprio trial (pergunta 504).
- Segundo trial, reativação e política administrável de novo trial (AMB-09 C, opção futura; pergunta 510).
- Revogação de trial pelo administrador (fluxo de Financeiro ou sistema; ver pergunta 513).

---

## 5. Fluxos e estados

### 5.1 Caminho feliz
1. Profissional com `verification_status = 'aprovada'` e sem trial da identidade abre a tela de estado (H-041) e aciona "Ativar teste grátis de 14 dias" (pergunta 503).
2. Confirma a ação (pergunta 502). A confirmação não pede cartão nem Pix.
3. O sistema grava um único `access_grant` do tipo `trial` e registra a auditoria.
4. A resposta mostra início e fim do teste. Em seguida, `commercial_access` retorna `trial_ativo`, com `access_until = ends_at`.

### 5.2 Ação não tomada
- `[DECIDIDO]` FA-005, primeira regra: profissional aprovado que não clica em ativar não recebe trial. Nada é criado por aprovação, cadastro ou job.

### 5.3 Profissional não aprovado
- Estados `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` ou `suspensa`: a ativação é negada com mensagem neutra (pergunta 500). Nada é criado.
- `[DECIDIDO]` FA-005: "profissional não aprovado, quando tenta ativar o trial, então é negado".
- A mensagem não revela detalhe de duplicidade nem o motivo interno da verificação (`08`, RN de retenção por duplicidade; T-04 e T-03 de `11`).

### 5.4 Identidade que já teve trial
- Trial em qualquer status (ativo, expirado, revogado) ou com outro perfil de mesma identidade: `409 trial_used`. Nada é criado.
- Não há reativação. Terminado o trial, uma nova conta com o mesmo documento não ganha outro trial (`[DECIDIDO]` I-14, AMB-09 A, pergunta 509).

### 5.5 Ativações simultâneas
- Duas chamadas ao mesmo tempo para a mesma identidade: uma linha, uma resposta de sucesso e uma `409 trial_used`. A unicidade é garantida pelo índice único do livro (CA-H044-07), e não por checagem prévia na aplicação.

### 5.6 Fim do trial
- No instante `ends_at` (14 dias corridos), `commercial_access` devolve `trial_expirado` sem carência (`[DECIDIDO]` FA-005, `08`, RF-059).
- Nenhuma cobrança, nenhuma linha `paid`, nenhuma assinatura e nenhum job. O estado é derivado na leitura (P4).

---

## 6. Regras de negócio

| Ref. | Regra | Fonte | Como H-044 atende |
|---|---|---|---|
| RN-H044-01 | Ativação é ação explícita do próprio profissional. Nenhum processo cria trial sozinho. | RF-057 `[APROVADO]`; FA-005 | Só a rota de ativação grava trial (CA-H044-03) |
| RN-H044-02 | Exige `verification_status = 'aprovada'` no instante da ativação. A checagem lê a verificação, não a copia. | RF-057; FA-005; `08` item 2 | CA-H044-01 |
| RN-H044-03 | Um trial por identidade, em qualquer status (inclusive revogado). | RF-057; I-14; AMB-09 A `[DELEGADO]`; `09` (único parcial de trial) | Índice único do livro (H-045); CA-H044-05 e CA-H044-06 |
| RN-H044-04 | Não reativa: trial vencido ou revogado não gera novo trial, mesmo com nova conta ou retorno. | AMB-09 A; FA-005 | CA-H044-06 |
| RN-H044-05 | Duração exata de 14 dias corridos (336 h). | Decisão 268; decisão 288 (CHECK de H-045) | CA-H044-02 e CA-H044-11 |
| RN-H044-06 | Sem meio de pagamento: nenhum campo de cartão ou Pix é lido, nenhuma chamada ao gateway, `source_payment_id` nulo. | RF-057; `08` item 8 | CA-H044-04 |
| RN-H044-07 | Não converte: fim de trial não cria `paid`, assinatura ou cobrança. | RF-057; FA-005; I-14 | CA-H044-08 |
| RN-H044-08 | Trial não tem carência. | FA-005; decisão 269; RN-H045-03 | CA-H044-09 |
| RN-H044-09 | O início é o instante do servidor no momento da chamada, não a data de cadastro nem a data de aprovação. | `08`, bloco de relógio (funções recebem o instante do chamador) | CA-H044-02 |
| RN-H044-10 | Sem dado pessoal na resposta nem no evento de auditoria. | `08` §1.1; T-03, T-04 | CA-H044-13 |

---

## 7. Critérios de aceite (testáveis)

Todos os testes de banco usam instantes explícitos. Dados sintéticos têm marcador de teste (R8).

- **CA-H044-01 (não aprovado é negado).** Para cada um dos estados `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` e `suspensa`, a ativação devolve negação (código `403 not_verified` `[PROPOSTA]`, pergunta 500) e nenhuma linha é gravada em `access_grant`. Prova: cinco casos de teste.
- **CA-H044-02 (aprovado ativa por ação própria).** Para perfil `aprovada` sem trial, a ativação devolve `201` e grava exatamente uma linha com `type = 'trial'`, `status = 'ativa'`, `ends_at − starts_at = 336 h` e `source_payment_id` nulo. Prova: consulta à linha e comparação do intervalo.
- **CA-H044-03 (sem ação, sem trial).** Perfil aprovado que não chama a rota não tem linha `trial` criada. Prova: após aprovação simulada e leitura de estado, nenhuma linha `trial` existe.
- **CA-H044-04 (sem meio de pagamento).** A ativação funciona com corpo vazio. Campos de cartão ou Pix enviados no corpo são ignorados ou recusados (pergunta 502). Nenhuma chamada ao gateway ocorre (contador de chamadas = 0). Prova: teste com corpo vazio e com campo de pagamento, contador zerado.
- **CA-H044-05 (um trial por identidade).** Segunda ativação da mesma identidade devolve `409 trial_used` e não cria linha. Prova: duas chamadas, uma linha.
- **CA-H044-06 (não reativa).** Após revogar o trial (status `revogada`) ou após o vencimento, nova ativação da mesma identidade, inclusive por outro perfil com o mesmo documento, devolve `409 trial_used`. Prova: três casos (revogado, vencido, nova conta).
- **CA-H044-07 (ativações simultâneas).** Duas chamadas concorrentes da mesma identidade produzem exatamente uma linha, uma resposta `201` e uma `409 trial_used`. Nenhuma resposta `500`. Prova: teste de concorrência com duas conexões e marcador único, rodado na janela exclusiva do banco de desenvolvimento (R8).
- **CA-H044-08 (trial não converte).** Com o relógio em `ends_at + 1 h` e em `ends_at + 72 h`, `commercial_access` devolve `trial_expirado`. A contagem de linhas `paid`, de assinaturas e de chamadas ao gateway permanece igual a zero. Prova: três contagens e duas leituras de estado.
- **CA-H044-09 (sem carência).** Trial vencido nunca devolve `em_carencia`, em `ends_at + 1 h` e em `ends_at + 72 h`. Prova: dois casos. É a mesma verificação de T-10 de H-045, reexecutada com linha criada pela rota.
- **CA-H044-10 (estado visível logo após a ativação).** Imediatamente após o `201`, `commercial_access(prof, instante_da_resposta + 1 s)` devolve `trial_ativo` com `access_until = ends_at`. Prova: uma leitura.
- **CA-H044-11 (fronteira de 14 dias).** Em `ends_at − 1 s` o estado é `trial_ativo`; em `ends_at` é `trial_expirado`. Prova: duas leituras. Segue a convenção de "prazo expirado" da decisão 267.
- **CA-H044-12 (concessão paga antes do trial).** Se o profissional tem concessão paga ou assinatura, a ativação é negada (pergunta 499). Prova: um caso com fixture paga. Se a resposta for "permitir", este critério é removido.
- **CA-H044-13 (sem dado pessoal).** A resposta e o evento `TrialActivated` não contêm nome, e-mail, CPF/CNPJ, `document_hmac`, `identity_id` nem valor de pagamento. Prova: inspeção das chaves da resposta e do registro de auditoria.
- **CA-H044-14 (auditoria).** Cada ativação bem-sucedida gera exatamente um evento `TrialActivated`, com ator, data e identificador do profissional. Recusas por `trial_used` seguem a pergunta 501. Prova: contagem de eventos antes e depois.
- **CA-H044-15 (identidade do chamador).** O profissional ativa somente o próprio trial. O corpo não aceita `professional_id`. Chamada sem autenticação devolve `401` e nada é criado. Prova: três casos (sem token, token de outro profissional, corpo com `professional_id`).
- **CA-H044-16 (sem job).** A migração e a rota não criam cron, job, tick nem agendamento. Prova: consulta ao catálogo de jobs sem novas linhas.
- **CA-H044-17 (execução local).** Os testes rodam localmente, sem conta externa, sem chave e sem rede externa. A evidência é o resultado local registrado na Issue (comando, contagem e código de saída). Prova: linha de execução na Issue.
- **CA-H044-18 (texto da ativação).** A tela e a resposta dizem que o teste não tem cobrança e não vira assinatura sozinho, e não prometem pedidos. Prova: revisão do texto pelo líder (pergunta 502) e checagem de que o texto não menciona cobrança futura. Se mencionar, depende de BLQ-JUR L2 e L3 (pergunta 515).

---

## 8. Casos B-07 e I-14

- **B-07 (trial expirado):** fixture com trial `[T0, T0 + 14 dias)`. Coberto pelo `trial_expirado` sem carência (CA-H044-08 e CA-H044-09) e pela ausência de assinatura criada pela rota (CA-H044-08). A função em si é de H-045.
- **I-14 (pagamento idempotente; trial único; fim de trial sem cobrança):** trial único por identidade (CA-H044-05 e CA-H044-06) e fim de trial sem cobrança nem agendamento (CA-H044-08 e CA-H044-16). A parte de `provider_payment_id` é de H-047 e H-048, fora desta história.
- **I-25 (carência e trial):** trial sem carência (CA-H044-09). O restante é de H-045 e H-050.

---

## 9. Dependências (reais)

- **H-039 (#52): não Concluída, em QA.** É a única fonte de `aprovada`. A prova ponta a ponta depende dela. Até a conclusão humana, o Desenvolvimento só pode usar fixture (pergunta 498).
- **H-045 (#58): Concluída.** Fornece `access_grant`, o índice único de trial, o CHECK de 336 h e `commercial_access`. Aplicação no banco de desenvolvimento `[NÃO VERIFICADO]`.
- **Origem de `identity_id` (decisão 289): pendente, de responsabilidade de H-044.** O que falta:
  1. Definir o uuid (ou o tipo) a partir de `document_hmac` (pergunta 496).
  2. Garantir que a mesma identidade produza o mesmo `identity_id` em todos os perfis (pergunta 497).
  3. Criar a coluna ou a função de derivação por migração nova. Não editar migração já aplicada (regra da fábrica).
  4. Confirmar com H-040 (#53, em Product Owner) a regra de identidade para duplicidade. A decisão 273 pede essa confirmação.
- **H-035 (#48) e H-036 (#49): Concluídas.** Fornecem `document_hmac` e `professional_profile`.
- **H-042 (#55): em Backlog.** Consome a mesma regra de aprovação e de acesso. Ver pergunta 504.
- **H-049, H-050, H-047: não são dependências.** H-044 não cria nem lê concessão paga. Só a checagem da pergunta 499 toca esse tema.
- **H-099 (#109): consumidor.** Lembretes de fim de trial dependem de H-044, não o contrário.
- **Ordem de ondas:** H-044 está na Onda 3 do backlog, cuja entrada é "Onda 2 concluída" (ver `113` §9 e pergunta 278 de H-045). Esta história depende de H-039, que está na Onda 2 e não concluída. Essa é a mesma exceção que o líder já tratou em H-045 e precisa ser registrada aqui também (pergunta 498).

---

## 10. Riscos

- **R1. Identidade sem chave estável (alto).** `access_grant.identity_id` é uuid e a identidade existente é hex. Se o valor for gerado aleatoriamente por perfil, a unicidade do trial falha. Mitigação: derivação determinística do `document_hmac` (pergunta 496) e teste de que dois perfis com o mesmo documento geram o mesmo valor.
- **R2. Verificação revogada depois do trial.** `commercial_access` não verifica aprovação (decisão 274). Um profissional suspenso mantém o trial até a guarda de H-042 atuar. Mitigação: H-042 aplica a checagem de aprovação em descoberta e aceite (pergunta 505). Nenhuma revogação automática sem decisão humana.
- **R3. Corrida na ativação.** Duas chamadas simultâneas podem criar dois trials se a unicidade não for real. Mitigação: índice único (já em H-045) e CA-H044-07.
- **R4. Trial depois de concessão paga.** Se a checagem não existir, um profissional pagante ganha 14 dias extras. Mitigação: pergunta 499.
- **R5. Relógio.** Se o início vier do cliente, o trial pode começar em data falsa. Mitigação: instante do servidor (RN-H044-09, pergunta 507).
- **R6. Retenção do registro após expurgo.** Um trial com identidade derivada de documento é dado pessoal indireto. Se o perfil for expurgado e o registro apagado, a unicidade se perde. Mitigação: pergunta 512, com E13 (#118, #119).
- **R7. Aceite durante o trial que vence antes do fim do pedido.** Não é decisão de H-044, mas a história afeta o usuário. Ver pergunta 508 (dono: H-042 e H-074).
- **R8. Dados de teste no banco de desenvolvimento.** As fixtures precisam de marcador sintético (`@example.test` e identificadores gerados), para que a triagem de #140 separe o resíduo. Testes de concorrência gravam de verdade e devem rodar na janela exclusiva do banco, sem outro agente usando o mesmo banco (regra da rodada 64 e da janela exclusiva da rodada 63).
- **R9. Expiração sem job.** Fim de trial é visível pela leitura (P4). Os lembretes precisam de tick próprio (H-099).
- **R10. Mensagem enganosa.** Um texto que diga "grátis" sem explicar o fim pode induzir a expectativa de conversão. Mitigação: CA-H044-18.

---

## 11. Perguntas ao líder

Lista única, numerada de 496 a 515, sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava.

**496. Origem de `identity_id` (decisão 289).** Como obter o uuid a partir de `document_hmac`, que é texto hexadecimal?
- (a) Derivação determinística do `document_hmac` (por exemplo, uuid derivado do hash), sem nova coluna. Nenhuma escrita de H-035 muda.
- (b) Nova coluna `identity_id uuid` em `professional_profile`, preenchida junto com `document_hmac`, com índice único (nova migração).
- (c) Trocar o tipo de `access_grant.identity_id` para texto, igual ao `document_hmac` (nova migração sobre o livro de H-045).
- **Recomendação:** (a) `[PROPOSTA]`, porque não altera história concluída e garante o mesmo valor para o mesmo documento. Arquitetura confirma a função exata. Destrava R1, CA-H044-05 e CA-H044-06.

**497. Identidade e recusa.** Se o perfil de um profissional foi recusado ou retido e ele se cadastra de novo com o mesmo documento, a identidade é a mesma?
- (a) Sim: a identidade é o documento, independente do perfil.
- (b) Não: cada perfil tem sua identidade.
- **Recomendação:** (a), porque AMB-09 A e RF-049 tratam a identidade como o documento. Destrava a regra de unicidade e CA-H044-06.

**498. Dependência de #52 para o Desenvolvimento.** A prova ponta a ponta depende de `aprovada`, que só H-039 grava.
- (a) Arquitetura agora; Desenvolvimento só depois de #52 Concluída por decisão humana.
- (b) Desenvolvimento pode começar com fixture `aprovada`, e a prova ponta a ponta fica para depois de #52.
- **Recomendação:** (a), para não começar uma parte que não fecha sozinha (regra do líder). Registrar a exceção no backlog, como em H-045 (pergunta 278). Destrava o início do Desenvolvimento.

**499. Ativação com concessão paga ou assinatura.** Um profissional que já tem acesso pago pode ativar o trial?
- (a) Não: a ativação é negada se houver concessão paga ou assinatura.
- (b) Sim: o trial é concedido, e a decisão 269 faz o pago prevalecer.
- **Recomendação:** (a), porque o trial é para quem ainda não pagou e evita benefício indevido. Destrava CA-H044-12 e R4.

**500. Código de resposta para não aprovado.**
- (a) `403 not_verified`, com mensagem neutra.
- (b) `409 not_eligible`.
- **Recomendação:** (a) `[PROPOSTA]`, porque 403 descreve melhor a falta de permissão. Destrava CA-H044-01.

**501. Recusas por `trial_used` geram auditoria?**
- (a) Não: só ativação bem-sucedida gera evento.
- (b) Sim: cada `trial_used` gera evento sem dado pessoal, para detectar abuso.
- **Recomendação:** (b) para `trial_used` (sinal de abuso, AMB-09), e (a) para não aprovado (ruído). Destrava CA-H044-14.

**502. Confirmação da ativação.**
- (a) Um clique com texto de confirmação curto (por exemplo: "Sem cartão. Ao fim de 14 dias o acesso termina e não vira assinatura sozinho").
- (b) Dois passos de confirmação.
- **Recomendação:** (a) `[PROPOSTA]`, com texto aprovado pelo líder. Destrava CA-H044-04 e CA-H044-18.

**503. Interface da ativação.**
- (a) Botão mínimo na tela de estado de H-041 (#54), nesta história.
- (b) Só a rota; o botão fica em história própria.
- **Recomendação:** (a), para que a ativação exista ponta a ponta. Confirmar com H-041 se a tela de estado já está no backlog. Destrava o escopo de tela.

**504. Checagem de aprovação compartilhada.**
- (a) Uma função única de elegibilidade, usada por H-044 e pela guarda de H-042 (#55).
- (b) H-044 checa sozinho; H-042 duplica a regra.
- **Recomendação:** (a), para uma só fonte de verdade para aprovação. Destrava R2 e CA-H044-01.

**505. Verificação perdida depois do trial.** Se o profissional for suspenso ou recusado depois de ativar, o que acontece com o trial?
- (a) O trial continua até `ends_at`; a guarda de H-042 bloqueia pedidos.
- (b) O trial é suspenso automaticamente.
- **Recomendação:** (a), porque suspensão automática sem decisão humana viola a regra da fábrica. Destrava R2.

**506. E-mail na ativação.**
- (a) Nenhum e-mail nesta história; o aviso fica em H-099 (#109).
- (b) E-mail de confirmação da ativação.
- **Recomendação:** (a), para não aumentar a cota de envio e manter o escopo. Destrava o evento de saída de H-044.

**507. Instante do início do trial.**
- (a) O instante do servidor no momento da chamada.
- (b) A data de aprovação da verificação.
- **Recomendação:** (a) `[PROPOSTA]`, porque o profissional decide quando começa. Destrava RN-H044-09 e R5.

**508. Aceite vigente quando o trial vence (cruza H-042 e H-074).** Um pedido aceito durante o trial, que termina depois do fim do trial, continua?
- (a) Sim: o aceite continua até o fim do pedido.
- (b) Não: o aceite é encerrado no vencimento do trial.
- **Recomendação:** (a) `[PROPOSTA]`, para não cancelar trabalho já combinado. A decisão é de H-042 e H-074, e H-044 só registra. Destrava R7.

**509. Status de AMB-09.** `07-AMBIGUIDADES.md` marca AMB-09 como `[PROPOSTA]` (recomendação A). `08` e `14-BACKLOG` marcam como `[DELEGADO]`. Confirmar A como decisão?
- **Recomendação:** confirmar A (um trial por identidade verificada) e registrar em `11-DECISOES.md`. Sem isso, RN-H044-03 e RN-H044-04 são propostas. Destrava CA-H044-05 e CA-H044-06.

**510. Segundo trial por política administrável (AMB-09 C).**
- (a) Adiar: nenhuma política de novo trial no MVP.
- (b) Incluir agora: um parâmetro de intervalo, administrável.
- **Recomendação:** (a), para não criar tela nem regra sem demanda. Destrava o escopo de fora.

**511. Janela para ativar depois da aprovação.** Há prazo para ativar o trial após a aprovação?
- (a) Não: a ativação vale a qualquer tempo depois da aprovação.
- (b) Sim: prazo de X dias após a aprovação.
- **Recomendação:** (a), porque nenhuma fonte fixa prazo (`[AMBIGUIDADE]`). Destrava CA-H044-02 (sem prazo na regra de elegibilidade).

**512. Retenção de registro de trial após expurgo do perfil.**
- (a) Manter a linha do trial enquanto a unicidade for necessária, com a identidade derivada, dentro do mecanismo de retenção de E13.
- (b) Expurgar junto com o perfil e aceitar a perda da unicidade.
- **Recomendação:** (a), porque a unicidade é a regra de negócio (I-14). Confirmar com E13 (#118, #119). Destrava R6.

**513. Revogação de trial pelo administrador.** A revogação é permitida, e ela reabre o trial?
- (a) Permitida, e não reabre o trial (a linha continua contando para unicidade).
- (b) Não permitida nesta fase.
- **Recomendação:** (a), com registro de auditoria, conforme a regra de H-045 para `revogada`. Destrava CA-H044-06.

**514. Limite de tentativas na rota de ativação.**
- (a) Usar o limite geral da API (#82).
- (b) Limite próprio para a ativação.
- **Recomendação:** (a), para não criar regra nova sem evidência. Destrava o teste de limite de tentativas, se houver.

**515. Texto de trial e cobrança futura.** O texto de tela e de resposta menciona cobrança futura?
- (a) Não: o texto só diz que não há cobrança no teste e que o fim não vira assinatura sozinho.
- (b) Sim: a menção depende de decisão jurídica (BLQ-JUR L2 e L3).
- **Recomendação:** (a), para não depender de jurídico nesta história. Destrava CA-H044-18.

---

## 12. Próximos passos

1. Líder confirma o texto da Issue #57 no GitHub e responde as perguntas 496 a 515 (lista única).
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas, se houver mudança de regra. Atualizar `09-MODELO-DADOS.md` §3.1 e §3.10 com a origem de `identity_id`.
4. Mover #57 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura define a derivação de `identity_id`, a rota, o formato de resposta e as permissões. Desenvolvimento começa só depois da decisão 498.
