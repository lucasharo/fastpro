# Runbook de incidente e reconciliação — FastPro (H-114, Issue #123)

- **Issue:** #123 `[E13] Runbook de incidente e reconciliação` · **História:** H-114 · **Workflow:** WF-03 · **Etapa:** Desenvolvimento · **EXEC-ID:** EXEC-DEV-123-20261120.
- **Desenho de origem:** `165-DESENHO-H114.md` (seções 3 e 4). **Refino:** `146-REFINO-H114.md` (perguntas 703 a 722, adotadas pelo líder).
- **Local deste arquivo:** `147` já era ocupado por outro desenho (`147-DESENHO-H111.md`); o próximo prefixo livre é `149`, registrado aqui como decisão de implementação (A-1 do desenho).
- **Situação:** versões S1 a S3 (D-06a e D-06b parciais, com lacunas L-1 e L-2). Seções 0 a 11 presentes. D-04 e D-05 completos. Os demais procedimentos têm o molde completo, com o conteúdo do desenho; o que ainda não foi provado está marcado como `[PENDENTE fatia Sx]`.
- **Ambiente:** somente DEV (projeto Supabase de desenvolvimento, branch `release/*` para DEV/TST). Nenhum procedimento aqui é executado em produção.

Etiquetas usadas neste documento:
- `[VERIFICADO]` conferido no repositório ou no banco de DEV nesta rodada (2026-11-20).
- `[PROPOSTA]` definição deste runbook, a validar pelo Operador.
- `[PENDENTE JURIDICO]` matéria que depende de parecer jurídico ou do encarregado (DPO). Nada disso é enviado em DEV.
- `[PENDENTE fatia Sx]` conteúdo previsto, ainda sem prova automatizada.
- `[NÃO VERIFICADO]` valor que o Operador deve conferir no ambiente antes de usar.

Glossário curto:
- **Projeto:** o projeto Supabase de DEV (banco, autenticação e funções).
- **Livro:** registro local de cobranças e concessões de acesso (`billing.*`).
- **Gateway:** provedor de pagamento externo (Mercado Pago).
- **Cota:** limite diário ou mensal de envio de e-mail do provedor de e-mail (Resend), guardado em `ops.external_quota`.
- **Marcador `[TESTE-H114]`:** texto obrigatório em todo dado criado por teste no DEV.

---

## 0. Cabeçalho, escopo e exclusões

**Escopo.** Procedimentos para quatro situações operacionais do ambiente de DEV: projeto pausado ou indisponível (D-04), migração falha (D-05), rotação de segredos (D-06), conta administrativa comprometida (D-07) e incidente de dados pessoais (D-09). Também descreve três reconciliações: pagamentos contra o livro (R-MP), cota e fila de e-mail (R-EMAIL) e contas do Auth contra o perfil de aplicação (R-AUTH).

**Exclusões.** Nada deste runbook se aplica a:
- produção, deploy, domínio e cobrança real;
- pagamento real, envio real de e-mail e chamadas reais a provedores em qualquer teste;
- recursos de mapa;
- rotação de senha do banco de DEV (decisão 150);
- parecer jurídico, que fica com o encarregado (ver seção 11).

---

## 1. Regras gerais

1. **Papéis.**
   - *Operador:* executa os passos técnicos e registra a evidência.
   - *Administrador de segundo nível:* segundo aprovador exigido pela dupla aprovação (D-07).
   - *Financeiro:* decide ações corretivas sobre cobrança (R-MP).
   - *Encarregado (DPO):* valida qualquer comunicação de incidente (D-09).
2. **Canal de aviso** `[PROPOSTA]`: alerta interno no painel operacional. Nenhum e-mail é enviado nesta fase.
3. **Relógio.** Todo instante é registrado em UTC. Os cálculos de prazo (15 min, 24 h, 2 h, 12 h, 15 min de órfão) usam o instante de início do procedimento.
4. **Marcador de teste.** Todo dado criado por teste no DEV leva `[TESTE-H114]` no texto. Testes de banco rodam em transação desfeita; quando não for possível, limpam pelo marcador no final.
5. **Redação de PII.** Toda saída de relatório passa pela função única `redactForRunbook` (fatia S2). Exemplos de mascaramento: e-mail `u***@d***.com`; telefone só com os dois últimos dígitos; CPF e CNPJ só com os quatro últimos dígitos; texto livre removido.
6. **Auditoria.** Cada ação gera uma linha em `audit.audit_event`. A tabela é só de acréscimo: `UPDATE`, `DELETE` e `TRUNCATE` nela são proibidos, e os gatilhos de bloqueio estão ativos (verificado: `tg_block_mutation`, `tg_block_truncate` e `tg_event_seal` com `tgenabled = 'A'`).

---

## 2. D-04 — Projeto pausado ou indisponível

- **Gatilho.** Qualquer um destes sinais:
  - erro de conexão (DNS ou TCP) na API;
  - falha do comando `corepack pnpm db:keepalive`;
  - nenhum job com `state = 'concluido'` em `ops.job` há mais de 24 h, com o último `updated_at` desses jobs como referência.
- **Quem.** Operador.
- **Pré-condições.** Acesso ao console do projeto de DEV (sem chave mestra de gestão guardada no repositório, no chat ou em log).
- **Passos.**
  1. Confirmar o sinal: repetir a conexão e registrar o código de erro (sem o host).
  2. No console do projeto de DEV, despausar o projeto. Esperado: estado "ativo" em poucos minutos. Ação manual, não automatizada.
  3. Rodar `corepack pnpm db:status`. Esperado: zero pendências.
  4. Rodar `corepack pnpm db:keepalive`. Esperado: execução com sucesso.
  5. Conferir o processamento de `ops.job` e `ops.outbox_event`: nenhum acúmulo anormal de `pendente` com `run_at` antigo.
  6. Conferir que os gatilhos de `audit.audit_event` estão habilitados (consulta a `pg_trigger.tgenabled`). Esperado: `A` (verificado em 2026-11-20).
  7. Conferir `cron.job` somente se `pg_cron` estiver instalado. Em 2026-11-20 ele não está instalado em DEV: este passo é pulado com motivo registrado.
- **Verificação.** Os passos 3, 4 e 6 devolvem o resultado esperado e ficam na evidência.
- **Auditoria.** Um evento por execução do runbook, com ator, papel, motivo e instante.
- **Exercício sintético** `[PENDENTE fatia S1 — parcial]`. O teste `packages/db/tests/runbook-h114.dbtest.mjs` prova: o gatilho habilitado (`tgenabled = 'A'`), a consulta de defasagem em `ops.job` com um job sintético de 25 h, e o pulo do `cron.job` com motivo. A despausa real no console é manual e não é testável no DEV.
- **Registro de evidência.** Comando, contagem e código de saída de cada passo.
- **Nota de DEV (achado da S1).** Em 2026-11-20 o DEV não tem nenhum job `concluido` em `ops.job` (apenas `pendente`: 19 de `email.send` e 48 de `outbox.dispatch`). Por isso o sinal de defasagem deste gatilho dispara no DEV sem falha real. Registrar como "sem histórico" e tratar pelo passo 1 até que o tick grave `concluido`.

---

## 3. D-05 — Migração falha (compensação)

- **Gatilho.** `corepack pnpm db:migrate` termina com erro.
- **Quem.** Operador.
- **Pré-condições.** Saída completa do erro disponível.
- **Passos.**
  1. **Contenção.** Parar a esteira local. Não repetir `db:migrate` às cegas. Registrar a saída do erro.
  2. **Diagnóstico.** Rodar `corepack pnpm db:status`. Consultar `ops.schema_migration` (colunas `version`, `name`, `checksum`, `applied_at`, `applied_by`; verificado em 2026-11-20). Pelo script `packages/db/scripts/db.mjs`, cada migração roda em `begin` … `commit`, com `rollback` no erro, e a linha de `ops.schema_migration` é gravada na mesma transação. Logo, uma migração que falhou não deixa versão registrada.
  3. **Correção.** Nunca editar migração já aplicada. Criar migração compensatória com prefixo igual à maior versão existente somada a `10000`. Padrão expandir e contrair. Nada de `DROP` com dado vivo. Toda migração tem rollback pareado, no padrão do repositório.
  4. **Verificação.** `corepack pnpm db:migrate` e `corepack pnpm db:status` com zero pendências. Depois, `corepack pnpm db:test` completo (executado no fechamento da entrega, não nesta fatia).
- **Verificação.** Os passos 2 e 4.
- **Auditoria.** Um evento com a versão tentada, o erro (código, sem texto livre) e a versão compensatória.
- **Exercício sintético** `[PENDENTE fatia S1 — parcial]`. O teste de banco cria um schema descartável com nome `h114_mig_<aleatório>`, dentro de transação desfeita. Prova que: (a) uma inserção que viola `check` aborta a transação e nada persiste após o `rollback`; (b) a migração compensatória com a constraint correta aplica e aceita a linha válida. Tudo é desfeito ao final.
- **Registro de evidência.** Saída do erro (código), `db:status` antes e depois, e o resultado do teste.

---

## 4. D-06 — Rotação de segredos

### 4.1 D-06a — Chave de envelope `[PARCIAL fatia S3: lacuna L-1]`

- **Gatilho.** Suspeita de vazamento da chave de cifra, ou rotação planejada.
- **Quem.** Operador.
- **Pré-condições.** Acesso ao segredo do ambiente DEV (`.env.local` ou segredo do ambiente). Nunca em chat ou commit.
- **Passos** `[PROPOSTA]`.
  1. Gerar chave nova de 32 bytes e guardá-la no segredo do ambiente.
  2. Configurar a nova como escrita e a anterior como leitura. Lacuna L-1 (verificada na S3): o byte de versão existe (`VERSION = 1`), mas o leitor aceita só a versão 1 e o formato não tem identificador de chave. Logo, a leitura dupla de chave **não existe** hoje (`apps/api/src/requests/address-crypto.ts`, `apps/api/src/contact/phone-crypto.ts`). Esta rotação exige cartão separado de expansão do formato; a S3 não altera o formato.
  3. Implantar leitura dupla. Novos registros saem só com a chave nova.
  4. Recifrar em lotes, de forma retomável e idempotente.
  5. Consultar a contagem por versão. Só remover a chave anterior com **zero** registros na versão antiga.
  6. Falha de decifragem em registro antigo gera alerta e **não** apaga dado.
- **Verificação.** Contagem por versão igual a zero antes de remover a chave anterior.
- **Auditoria.** Um evento por lote recifrado, com contagem e versão.
- **Exercício sintético.** `[PARCIAL fatia S3]`: provado que V1 sela e abre, e que V2 e chave anterior são recusadas (L-1). A recifragem em lote e a contagem de V1 chegando a zero dependem da expansão do formato (cartão separado).
- **Registro de evidência.** Contagens por versão antes e depois.

### 4.2 D-06b — Token de provedor `[PARCIAL fatia S3: lacuna L-2]`

- **Gatilho.** Suspeita de vazamento de token do Gateway ou do Resend, ou rotação planejada.
- **Quem.** Operador.
- **Pré-condições.** Acesso ao painel do provedor (ação manual).
- **Passos** `[PROPOSTA]`.
  1. Gerar token novo no painel do provedor.
  2. Trocar a variável no segredo do ambiente.
  3. Rodar teste sintético de aceitação, sem chamada real de cobrança ou de envio.
  4. Revogar o token antigo em até 1 hora.
  5. Durante a troca, webhooks pendentes continuam aceitos: a assinatura aceita o par atual e o anterior por janela curta. Lacuna L-2 (verificada na S3): `verificarAssinaturaMercadoPago` aceita um único segredo (`apps/api/src/billing/webhook-signature.ts`); a janela de dois segredos **não existe** e exige cartão separado.
- **Verificação.** Teste sintético de aceitação com resultado de sucesso e token antigo recusado.
- **Auditoria.** Um evento com o nome da variável trocada (nunca o valor).
- **Exercício sintético.** `[PARCIAL fatia S3]`: provado que o segredo atual é aceito e o anterior recusado (L-2). A aceitação do par durante a troca depende de cartão separado.
- **Registro de evidência.** Resultado do teste sintético e confirmação de revogação (manual, no painel).

### 4.3 D-06c — Pepper de documento e segredos de sessão `[PENDENTE fatia S3]`

- **Gatilho.** Rotação planejada de pepper ou de segredo de sessão.
- **Quem.** Operador.
- **Pré-condições.** Versão nova do segredo disponível no ambiente.
- **Passos** `[PROPOSTA]`. Mesma lógica de versão de D-06a, com revalidação no login. A troca do segredo de sessão invalida sessões de forma controlada e comunicada aos usuários.
- **Verificação.** Login com a versão nova funciona e sessões antigas são recusadas somente no ponto previsto.
- **Auditoria.** Um evento por troca, com versão anterior e nova.
- **Exercício sintético.** `[PENDENTE fatia S3]`.
- **Registro de evidência.** Resultado do login sintético.

---

## 5. D-07 — Conta administrativa comprometida

- **Gatilho.** Suspeita de uso indevido de conta de administrador.
- **Quem.** Operador e segundo aprovador (outra identidade distinta).
- **Pré-condições.** Identidade do administrador afetado conhecida.
- **Passos** `[PROPOSTA]`.
  1. **T0 a T+5 min.** Revogar as sessões do operador afetado em `app.admin_session` (função `private.admin_session_revoke`, pelo hash do segredo da sessão) e bloquear a conta em `app.app_user` (`status = 'bloqueado'`, valor aceito pela restrição verificada no DEV). Só essa conta é afetada; os demais administradores permanecem.
  2. Confirmar que o token antigo não abre mais a área administrativa: `private.admin_guard` devolve vazio para o hash revogado (a API responde 401 ou 403).
  3. **T+5 a T+30 min.** Redefinição de segundo fator (`mfa_reenroll`) pelo pedido de aprovação do H-102 (`private.admin_approval_open` e `private.admin_approval_vote`). O solicitante não pode votar no próprio pedido. **Lacuna L-3:** hoje um único voto de outro Superadmin conclui o pedido; o critério CA-08 pede dois aprovadores distintos. Até a decisão sobre L-3, este passo só pode ser executado com o registro dessa limitação na evidência.
  4. **T+30 min a T+2 h.** Consultar `audit.audit_event` pelo ator no intervalo: visualizações excepcionais, mudança de papel e acesso a caso. Acesso indevido comprovado aciona D-09.
- **Verificação.** Passo 2 e a consulta do passo 4 com resultado registrado.
- **Auditoria.** O evento de revogação usa a ação `admin.session.revoked`, verificada no catálogo `audit.action_catalog` pela migração `20261120400000_audit_add_runbook_actions` (S4). **Lacuna L-4:** `private.admin_session_revoke` não grava evento por conta própria; quem executa o passo 1 grava `admin.session.revoked` com motivo (código, por exemplo `d07_contencao`) na mesma sequência de ações.
- **Exercício sintético** `[EXECUTADO fatia S4]`: `packages/db/tests/runbook-h114-d07.dbtest.mjs`. Verificado: sessão revogada nega acesso; revogação de um operador não afeta os demais; `bloqueado` é valor aceito; catálogo fechado recusa ação desconhecida; reset de MFA recusa autoaprovação; um voto basta (caracterização de L-3). Os testes de catálogo e de evento ficam pulados enquanto a migração não estiver aplicada no DEV, com o motivo registrado no próprio teste.
- **Registro de evidência.** Comando, contagem e saída do teste D-07, e o identificador dos eventos `admin.session.revoked` gravados no exercício.

---

## 6. D-09 — Incidente de dados pessoais

- **Gatilho.** Qualquer exposição não autorizada de dado protegido (documento, foto de verificação, telefone ou endereço exato), sem limite mínimo de quantidade.
- **Quem.** Operador, Encarregado (DPO).
- **Pré-condições.** Rota ou vetor de exposição identificado.
- **Passos** `[PROPOSTA]`.
  1. **Contenção até 15 min.** Gravar a chave de degradação da rota afetada em `ops.app_config` (nome sugerido: `degradacao.rota.<nome-da-rota>`, valor booleano). Efeito esperado: a rota responde 503 constante, sem redeploy. Revogar credencial (D-06) e invalidar sessões suspeitas (D-07).
  2. **Apuração até 24 h.** Preencher o formulário fixo: título, instante UTC, rota ou vetor, contagem de titulares, classes de dado, medidas e estado da contenção. Todo valor passa por `redactForRunbook`.
  3. **Comunicação.** Minutas para a ANPD e para os titulares são `[PENDENTE JURIDICO]` e rodam como `[PROPOSTA]`. Uso real só após validação do Encarregado. Nada é enviado em DEV.
- **Verificação.** Chave de degradação gravada e resposta 503 constante na rota de teste.
- **Auditoria.** Um evento por passo, com ator, motivo e instante.
- **Exercício sintético** `[PARCIAL fatia S5]`: `packages/db/tests/runbook-h114-d09.dbtest.mjs` prova gravar, ler, desligar a chave (`degradacao.rota.<nome>`, com sublinhado no lugar de hífen) e recusar nome fora do padrão. **Lacuna L-5:** a API ainda não lê essa chave; a resposta 503 da rota não está provada e fica como cartão próprio. O formulário de relatório da apuração (item 2) traz título, instante UTC, rota ou vetor, contagem de titulares, classes de dado e estado da contenção; a minuta de comunicação segue marcada como `[PENDENTE JURIDICO]`.
- **Registro de evidência.** Relatório preenchido com valores redigidos.

---

## 7. R-MP — Reconciliação Mercado Pago × livro `[PENDENTE fatia S6]`

- **Gatilho.** Execução diária, ou sob demanda após suspeita de divergência.
- **Quem.** Operador (execução) e Financeiro (decisão).
- **Pré-condições.** Janela de tempo definida. Pagamentos aprovados há menos de 2 h ficam fora do batimento.
- **Contrato** `[PROPOSTA]` (somente tipos, sem persistência nesta fatia):
  - `GatewayPayment { externalId, status, amountCents, approvedAt, planCode, subscriptionExternalId }`
  - `LedgerEntry { externalId | null, grantId, kind, amountCents, planCode, startsAt, endsAt, cancelAtPeriodEnd }`
  - Achado: `ReconciliationFinding { type, externalIdMasked, expected, found, severity }`, com `type` em `T1_faltando_local`, `T2_concessao_sem_pagamento`, `T3_valor_divergente` ou `T4_recorrencia_divergente`.
- **Regras** `[PROPOSTA]`:
  1. Ignorar pagamento aprovado há menos de 2 h.
  2. T1: aprovado no gateway e ausente no livro.
  3. T2: concessão `paid` sem pagamento aprovado, ou com estorno ou rejeição.
  4. T3: valor diferente do vigente em `billing.plan_price` na data.
  5. T4: cancelado de um lado e ativo do outro.
  6. A função devolve achados e **nunca altera a entrada**.
  7. Toda ação corretiva é humana (Financeiro, ajuste manual justificado e auditado, nas Issues #60 a #66).
- **Passos.** Executar o batimento sobre os dados da janela, gerar o relatório e encaminhar os achados ao Financeiro.
- **Verificação.** Relatório com contagem por tipo e achados mascarados.
- **Auditoria.** Um evento com a janela e as contagens.
- **Exercício sintético** `[PENDENTE fatia S6]`: três divergências intencionais geram três achados; a entrada permanece idêntica; nenhuma tabela de cobrança é escrita.
- **Registro de evidência.** Contagens por tipo e o teste de imutabilidade.

---

## 8. R-EMAIL — Cota e fila de e-mail `[PENDENTE fatia S7]`

- **Gatilho.** Alerta de cota ou execução diária na virada do dia UTC.
- **Quem.** Operador.
- **Pré-condições.** Linha de `ops.external_quota` do serviço do provedor de e-mail.
- **Limiares** `[PROPOSTA]` sobre `ops.external_quota`:
  - 70% gera alerta 1;
  - 85% gera alerta 2;
  - 90% corta as classes não críticas (resumo, lembrete e marketing);
  - reserva de 10% só para o Auth (100 por dia, 3.000 por mês).
- **Delta do Auth** `[PROPOSTA]`: a rotina compara o uso informado pelo provedor com `used` e ajusta `used` pelo delta positivo. Em DEV, a leitura do provedor é uma porta com fake; nenhuma chamada real é feita.
- **Fila** `[PROPOSTA]`: itens `adiado_cota` são reavaliados na virada do dia UTC. Obsoletos viram `descartado_obsoleto`. Zero reenvio retroativo. O vocabulário real de status de `ops.email_outbox` é conferido na fatia S7.
- **Passos.** Ler a cota, aplicar a regra de limiar, reavaliar a fila e registrar o resultado.
- **Verificação.** Alerta correto para 70, 85 e 90 mensagens; `auth` passa até 100.
- **Auditoria.** Um evento por mudança de nível de alerta.
- **Exercício sintético** `[PENDENTE fatia S7]`.
- **Registro de evidência.** Contagens e níveis antes e depois.

---

## 9. R-AUTH — Órfãos entre Auth e perfil de aplicação `[PENDENTE fatia S7]`

- **Gatilho.** Execução periódica ou sob demanda.
- **Quem.** Operador.
- **Pré-condições.** Lista de contas do Auth e lista de `app.app_user` disponíveis.
- **Passos** `[PROPOSTA]`. A função pura recebe as duas listas e o instante `now`, e devolve as contas sem par com idade acima de 15 min. A função só **classifica** (`orfao_expirado`). A exclusão em Auth é ação manual no console, em DEV, com dupla conferência.
- **Verificação.** Lista de órfãos classificados com idade registrada.
- **Auditoria.** Um evento por conta sinalizada, sem e-mail em claro.
- **Exercício sintético** `[PENDENTE fatia S7]`: órfão com mais de 15 min é sinalizado; com menos, não.
- **Registro de evidência.** Contagem de órfãos e de sinalizados.

---

## 10. Tabela de exercícios e evidências

| Critério | Procedimento | Como se prova | Estado em 2026-11-20 |
|---|---|---|---|
| CA-01 | Todo | Teste estático: nenhum termo fora de escopo no runbook (lista no teste) | S1 (ver `runbook-h114-static.test.mjs`) |
| CA-02 | Todo | Teste estático: nenhum termo de recurso de mapa | S1 |
| CA-20 | Estrutura | Teste estático: seções 0 a 11 em ordem; oito campos em cada procedimento | S1 |
| CA-03 | D-04 | Teste de banco em transação desfeita | S1 (parcial: sem `cron.job`) |
| CA-04 | D-05 | Teste de banco em schema descartável | S1 |
| CA-05 a CA-06 | D-06 | Testes unitários e de fake de provedor | S3 |
| CA-07 a CA-08 | D-07 | Testes de banco (reuso de H-105) | S4 |
| CA-09 | D-09 | Teste de composição com `ops.app_config` | S5 |
| CA-10 | D-09 | Teste unitário do formulário e estático da etiqueta jurídica | S5 |
| CA-11 a CA-12 | R-MP | Testes unitários sobre fixtures | S6 |
| CA-13 a CA-16 | R-EMAIL e R-AUTH | Testes unitários | S7 |
| CA-17 | Todo | Teste unitário: nenhuma saída com e-mail, telefone ou CPF em claro | S2 |
| CA-18 | Todo | Teste de banco: cada exercício grava evento em `audit.audit_event` | S8 |
| CA-19 | Todo | Suíte offline com `now` injetado | S8 |

---

## 11. Pendências e itens `[PENDENTE JURIDICO]`

1. Minuta de comunicação à ANPD (D-09). `[PENDENTE JURIDICO]` `[PROPOSTA]`.
2. Minuta de comunicação aos titulares (D-09). `[PENDENTE JURIDICO]` `[PROPOSTA]`.
3. Prazo de 72 h para a ANPD e critérios de gravidade. `[PENDENTE JURIDICO]`.
4. Confirmar com o Encarregado a redação do formulário de relatório de incidente.
5. Achado de DEV: nenhum job `concluido` em `ops.job` em 2026-11-20 (ver D-04).
