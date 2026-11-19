# Desenho técnico H-111 — Direitos do titular (`app.dsr_case`): acesso, correção e eliminação (Issue #120)

- Workflow: WF-03, etapa Arquitetura (tentativa 2). EXEC-ID: EXEC-ARQ2-120-20261119.
- Entrada: `144-REFINO-H111.md` (seções 3, 6, 7, 8, 9 e 11) e `09-MODELO-DADOS.md` (índice de tabelas).
- Escopo desta etapa: somente desenho. Nenhum código, migração, banco ou quadro foi alterado. Sem Docker, Mapbox, e-mail real ou backup de dados.
- Limitação declarada: por limite de turnos, não foram inspecionados no DEV os nomes físicos de colunas de chat, `service_request` e `review`. Onde o nome físico é suposto, aparece "(confirmar no DEV)". O DEV deve confirmar antes de escrever a migração; isso não muda a arquitetura.
Atualização 19/11/2026 (EXEC-DEV-120B-20261119, leitura somente): nomes físicos confirmados no DEV para as fatias 1 e 2, registrados em DV-6; demais itens seguem como estavam.

## 1. Decisões (todas as recomendações do PO adotadas, "adotada pelo líder")

| Nº | Decisão adotada (adotada pelo líder) | Efeito no desenho |
|---|---|---|
| 663 | Prazo de 15 dias corridos; `ops.app_config` chave `privacy.dsr_deadline_days=15`; confirmação do recebimento imediata (e-mail de abertura). `[PENDENTE JURIDICO]` | `deadline_at = opened_at + (config) days`, calculado na função de abertura. |
| 664 | Extrato em JSON canônico `fastpro-dsr-extrato-<protocolo>.json` + visualização simples na interface. | Sem PDF. Esquema versionado (`schema_version`). |
| 665 | Step-up por link/código no e-mail cadastrado, token efêmero de 15 min, exigido na abertura de acesso e eliminação. | Tabela `app.step_up_grant` (confirmado no DEV em 19/11: não existe; criada pela migração 470000. `app.auth_challenge` tem o step-up ligado à sessão e validade fixa, por isso não é reaproveitada). |
| 666 | Mensagens de chat mantidas, autor exibido como "Usuário excluído", ponteiro de perfil desfeito. `[PENDENTE JURIDICO]` | Passo do `private.dsr_anonymize_subject`. |
| 667 | Avaliações mantidas; só se rompe a ligação ao cadastro do autor. `[PENDENTE JURIDICO]` | Passo do expurgo. |
| 668 | IP já guardado só como HMAC; registros de conexão ficam retidos 6 meses para obrigação legal; não são expurgados pelo DSR imediato. `[PENDENTE JURIDICO]` | `audit_event` e logs de conexão intocados; nenhum prazo novo é criado aqui. |
| 669 | `billing.payment` retido integralmente (5 anos). `[PENDENTE JURIDICO]` | O expurgo nunca toca `billing.payment`. O prazo de 5 anos fica como política `[PROPOSTA]` em `retention_policy` (período nulo = job desligado, regra existente). |
| 670 | Profissional recusado/retido por duplicidade: limpar cadastro e documentos, preservar `document_hmac` como restrição antifraude, justificativa em `legal_basis_note`. `[PENDENTE JURIDICO]` | Passo condicional no expurgo; integra com H-040 (#53). |
| 671 | Eliminação cancela a assinatura recorrente (cancelamento imediato). | Marca local atômica + job idempotente para o provedor (seção 4.4). |
| 672 | Link do extrato válido 7 dias (168 h); depois o arquivo é expurgado. | `expires_at` em `app.dsr_export`; job de expurgo. |
| 673 | Abertura assistida pelo DPO/admin (`POST /v1/admin/privacy/dsr-cases`), com `opened_by_operator_id` e `channel='dpo_externo'`. `[PENDENTE JURIDICO]` | Colunas `channel` e `opened_by_operator_id`; função `app.dsr_open_assisted`. |
| 674 | Conta suspensa cautelarmente ao abrir eliminação. | O refino diz `account_state`; no modelo real a coluna é `app_user.status` (`ativo|bloqueado`). Decisão: ampliar o CHECK com `em_eliminacao` e `anonimizado` (seção 3.3). |
| 675 | Três e-mails (abertura, conclusão com link, conclusão/indeferimento fundamentado). | Via `ops.email_outbox` com `dedupe_key` e tipos novos no enum de código. Envio já está habilitado no projeto; o limite de taxa existente vale (sem chave liga/desliga). Em testes: Mailpit/mock, nunca provedor real. |
| 676 | Papéis: `DPO/Encarregado` e `Superadmin` decidem; suporte só vê status; auditor somente leitura. | Novas permissões em `admin_permission` (seção 6.3). |
| 677 | Autoatendimento com step-up dispensa dupla aprovação; abertura manual do admin/DPO exige dupla aprovação (`approval_request`) antes de anonimizar. | Função de anonimização checa `origin` do caso. |
| 678 | Eliminar `exact_point` e `address_text_enc`; manter `match_point` e `public_label`. `[PENDENTE JURIDICO]` | Passo do expurgo de pedidos. |
| 679 | E-mail anonimizado libera o original para novo cadastro (sem lista de bloqueio permanente), salvo fraude comprovada. | Marcador `anon-<hex>@anon.fastpro.internal` (hífen, como RN-H111-09; o texto 3.6 do refino usa sublinhado, vale o hífen). |
| 680 | Rascunho sem conta não gera `dsr_case`; descarte imediato por `DELETE /v1/request-drafts` e TTL da H-110. | Fronteira: H-111 não cria nada para rascunho anônimo. |
| 681 | `address_share` entra no extrato (profissional, data/hora). `[PENDENTE JURIDICO]` | Seção do extrato `address_shares`. |
| 682 | 1 exportação por titular a cada 30 dias; antes disso devolve o extrato vigente ou o prazo de carência. | Regra na função de abertura (seção 4.1). |

### 1.1 Decisões de desenho do arquiteto (além das recomendações do PO)

- **D-A1.** O índice único parcial (RN-H111-11) cobre `status IN ('aberto','em_analise','deferido')`, não só `aberto/em_analise`. Motivo: `deferido` ainda é caso em execução; sem isso daria para abrir segundo caso do mesmo tipo durante o processamento. Desvio pequeno e deliberado do texto do refino.
- **D-A2.** Os `kind` `bloqueio` e `confirmacao` existem no CHECK (alinhamento ao modelo 3.8), mas a H-111 só implementa `acesso`, `correcao` e `eliminacao`. A função de abertura recusa os outros dois com `kind_nao_suportado` até existir história própria.
- **D-A3.** Toda mutação passa por funções `SECURITY DEFINER` com `SET search_path = ''`, `EXECUTE` só para `app_system` (revogado de `PUBLIC`, `anon`, `authenticated`). Não há DML direto na tabela por nenhum papel de aplicação (RLS forçada e sem políticas para `anon/authenticated`).
- **D-A4.** Identidade de entrada vem do contexto autenticado da API (não de parâmetro do cliente): a API resolve `app_user.id` da sessão e passa para a função. O cliente nunca informa `subject_user_id`.
- **D-A5.** A anonimização é uma única transação no banco. A remoção do usuário no Supabase Auth é um passo posterior, idempotente e reexecutável (seção 4.4), porque o `auth` não pode ser alterado por função `app_system` em transação com `app.*`.
- **D-A6.** Download do extrato: o token de download é de uso único e curto (URL assinada de 5 min). A janela de 7 dias é a validade do extrato; dentro dela, `GET :id` gera nova URL curta. Isso concilia "uso único" (refino 3.4) com "devolver o link vigente" (Q682) sem deixar URL longa circulando.
- **D-A7.** Sem atraso de carência na eliminação por autoatendimento (PO e 677 mandam execução automatizada). Mitigações: step-up de 15 min, e-mail de confirmação ao endereço cadastrado, suspensão cautelar e janela em que o caso fica `aberto` até o job processar (seção 4.4). Ver dúvida DV-3.

## 2. Estados e transições (`dsr_case.status`)

Estados: `aberto`, `em_analise`, `deferido`, `indeferido_parcial`, `indeferido_total`, `concluido`, `cancelado`.

| De | Para | Quem | Condição |
|---|---|---|---|
| aberto | em_analise | operador (assign/process) ou job automático | atribuição ou início de processamento |
| aberto | cancelado | titular | `kind` ainda não iniciado; `outcome=cancelado_pelo_titular` |
| aberto, em_analise | deferido | operador/job | pré-condições do tipo atendidas |
| aberto, em_analise | indeferido_parcial / indeferido_total | operador/job | `legal_basis_note` não vazia e `closed_at` |
| deferido | concluido | job/operador | efeito executado (extrato pronto, correção aplicada ou anonimização feita); `outcome` obrigatório |
| qualquer final | qualquer | ninguém | `indeferido_*`, `concluido`, `cancelado` são terminais |

`indeferido_parcial` aplica-se a eliminação com retenção parcial (ex.: pagamentos). Nesse caso a anonimização ocorre e o caso fecha como `indeferido_parcial`? Decisão: **não**. Eliminação com retenção legal parcial de itens esperados (pagamentos, auditoria) é eliminação normal e fecha `concluido`, com a retenção descrita em `legal_basis_note`. `indeferido_parcial` é só para quando parte do pedido de correção é recusada ou há restrição não rotineira (ex.: retenção do `document_hmac` por antifraude, 670).

## 3. Modelo de dados

### 3.1 `app.dsr_case`

| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| protocol | text NOT NULL UNIQUE | `DSR-YYYYMMDD-XXXXXX`, sufixo de 6 caracteres base32 aleatório (CSPRNG), sem sequência; colisão resolvida por retry na função |
| subject_user_id | uuid NOT NULL FK app.app_user(id) | imutável; `ON DELETE RESTRICT` |
| kind | text NOT NULL | CHECK em (`acesso`,`correcao`,`eliminacao`,`bloqueio`,`confirmacao`); imutável |
| status | text NOT NULL default 'aberto' | CHECK nos 7 estados |
| channel | text NOT NULL default 'titular' | CHECK (`titular`,`dpo_externo`) |
| opened_by_operator_id | uuid NULL FK app.app_user(id) | obrigatório se `channel='dpo_externo'` (CHECK) |
| request_details | jsonb NOT NULL default '{}' | validado por CHECK de tipo objeto e tamanho máximo (8 KB); sem PII em claro de terceiros; correção guarda campo e novo valor em `proposed_changes` |
| legal_basis_note | text NULL | obrigatório (não vazio após trim) ao ir para `indeferido_*`; obrigatório em `concluido` de eliminação com retenção parcial |
| outcome | text NULL | CHECK nos 6 códigos do refino; obrigatório em terminal |
| assigned_to | uuid NULL FK app.app_user(id) | operador responsável |
| opened_at | timestamptz NOT NULL default now() | imutável |
| deadline_at | timestamptz NOT NULL | calculado na abertura; imutável |
| closed_at | timestamptz NULL | obrigatório em terminal (CHECK) |
| approval_request_id | uuid NULL | obrigatório para anonimizar caso `channel='dpo_externo'` (D-677) |
| created_at / updated_at | timestamptz | `updated_at` por trigger |

Constraints extras:
- CHECK `closed_at IS NOT NULL` se e somente se `status` terminal (`indeferido_*`, `concluido`, `cancelado`).
- CHECK `outcome` coerente com `kind` (ex.: `conta_anonimizada` só em `eliminacao`; `extrato_disponibilizado` só em `acesso`; `dados_corrigidos` só em `correcao`).
- Índice único parcial `(subject_user_id, kind) WHERE status IN ('aberto','em_analise','deferido')` (D-A1).
- Índices: `(subject_user_id, opened_at DESC)`, `(status, deadline_at)` para a fila administrativa, `(assigned_to) WHERE status IN ('aberto','em_analise')`.
- RLS habilitada e `FORCE`; `REVOKE ALL` de `PUBLIC, anon, authenticated`; `GRANT SELECT` somente a `app_system` (escrita só pelas funções).
- Trigger `BEFORE UPDATE`: (a) imutabilidade de `protocol`, `subject_user_id`, `kind`, `opened_at`, `deadline_at`, `channel`; (b) matriz de transições da seção 2, erro `violacao_maquina_estados`; (c) `nota_base_legal_obrigatoria`; (d) terminal não muda.
- Trigger `BEFORE DELETE`: proibido (`dsr_case_nao_deletavel`). A prova de atendimento é retida; não há expurgo do caso nesta história.

### 3.2 Tabelas auxiliares

- **`app.dsr_case_event`** (linha do tempo visível ao titular, só estados e IDs): `id`, `case_id` FK, `at`, `event` (`opened|assigned|status_changed|extract_ready|correction_applied|anonymized|closed|rejected|cancelled`), `from_status`, `to_status`, `actor_ref` (uuid, nulo para sistema), `detail` jsonb (apenas códigos). Append-only (trigger bloqueia UPDATE/DELETE). Existe porque `audit_event` é interno e não deve ser exposto ao titular (RC-07).
- **`app.dsr_export`**: `id`, `case_id` UNIQUE FK, `storage_bucket` (`dsr-exports`, privado), `storage_path`, `sha256`, `signature` (HMAC do payload canônico com chave do servidor, nunca em log), `schema_version`, `size_bytes`, `generated_at`, `expires_at` (= generated_at + 7 dias, por `app_config privacy.dsr_export_ttl_days`), `purged_at`, `download_count`, `last_download_at`.
- **`app.step_up_grant`** (não existe no DEV; criada pela migração 470000): `id`, `user_id`, `purpose` (`dsr_open`), `token_hash` (SHA-256, nunca o token), `created_at`, `expires_at` (15 min), `consumed_at`. Uso único: consumido na abertura. Limite de emissão por usuário (3 por hora).
- **`ops.app_config`** (chaves novas, valores `[PROPOSTA]`): `privacy.dsr_deadline_days=15`, `privacy.dsr_export_ttl_days=7`, `privacy.dsr_export_min_interval_days=30`, `privacy.dsr_step_up_minutes=15`.

### 3.3 Alterações em tabelas existentes

- `app.app_user.status`: ampliar CHECK (`app_user_status_check`, confirmado no DEV) de `{ativo, bloqueado}` para `{ativo, bloqueado, em_eliminacao, anonimizado}`. `em_eliminacao` bloqueia novos pedidos, aceites, compras e chat novo, mas permite login e consulta ao próprio caso. `anonimizado` bloqueia qualquer login. Confirmar no DEV todos os pontos que hoje testam `status='ativo'` (guards de elegibilidade da H-042/H-043 e RLS) para tratarem os novos valores como não ativos (teste T-DB-18).
- A trigger de unicidade de e-mail permanece; o e-mail anonimizado é único por construção (UUID aleatório).
- Nenhuma tabela de histórico de fotos (`media_access_log`/`media_access_daily`) é referenciada (CA-H111-17).

## 4. Funções SQL

Padrão comum: `SECURITY DEFINER`, `SET search_path = ''`, todos os objetos qualificados por schema, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO app_system`. Todas gravam `private.audit_append` (nome físico confirmado no DEV; a assinatura tem `p_actor_ref`, `p_actor_role`, `p_action`, `p_object_type`, `p_object_id`, `p_before_state`, `p_after_state`, `p_reason_code` e `p_correlation_id`) na mesma transação, com `case_id`, `subject_user_id`, `kind` e `actor_ref` (nunca dado pessoal ou conteúdo do extrato). Funções privadas ficam em schema `private` e só são chamadas por funções `app.*`.

### 4.1 Titular

- **`app.dsr_open(p_subject uuid, p_kind text, p_details jsonb, p_step_up_token_hash text, p_idempotency_key text)`** retorna `(case_id, protocol, status, deadline_at, deduplicated boolean)`.
  1. Recusa `kind` fora de acesso/correção/eliminação (`kind_nao_suportado`).
  2. Para acesso e eliminação: consome `step_up_grant` válido (≤ 15 min, propósito `dsr_open`, do próprio sujeito, não consumido), com `UPDATE ... WHERE consumed_at IS NULL RETURNING` (atômico). Falha: `step_up_obrigatorio`.
  3. Idempotência: mesma `p_idempotency_key` + sujeito devolve o caso já criado (`deduplicated=true`).
  4. Acesso: se houver exportação concluída nos últimos 30 dias (Q682), não cria caso; devolve o caso/extrato vigente (se `expires_at` futuro) ou `carencia_ate` (código `dsr_carencia`).
  5. Eliminação: verifica `legal_hold` ativo para o sujeito e pedidos em andamento (RN-H111-03/08). Se houver hold: cria o caso já em `indeferido_total` com `legal_basis_note` padrão de retenção legal (CA-H111-10), sem tocar o usuário. Se houver pedido em andamento: recusa com `pedido_em_andamento` sem criar caso (o titular precisa encerrar/cancelar antes).
  6. Insere o caso (violação do índice único vira `dsr_em_andamento` com o protocolo existente), grava evento `opened` e auditoria `dsr.case_opened`, enfileira e-mail 1 no `ops.email_outbox`.
  7. Eliminação: define `app_user.status='em_eliminacao'` (Q674) e revoga os aceites pendentes.
- **`app.dsr_cancel(p_case uuid, p_subject uuid)`**: só o dono; só em `aberto` (CA-H111-14); outcome `cancelado_pelo_titular`; se era eliminação, devolve `app_user.status` de `em_eliminacao` para `ativo` (somente se estava `em_eliminacao` por este caso).
- **`app.dsr_list_own(p_subject uuid, p_limit int, p_cursor ...)`** e **`app.dsr_get_own(p_subject uuid, p_case uuid)`**: filtram por `subject_user_id`; caso inexistente ou de outro titular retorna o mesmo "não encontrado" (CA-H111-16). Devolvem apenas protocolo, kind, status, datas, outcome, linha do tempo de `dsr_case_event` e metadados do extrato (sem `legal_basis_note` interna? Decisão: o titular vê a fundamentação do indeferimento, pois é direito de resposta clara, Art. 19; não vê notas internas de operador, que ficam em `request_details.internal`, nunca devolvido).

### 4.2 Operador/DPO (exigem permissão, ver 6.3; a API valida a permissão e passa `p_actor`; a função revalida pelo catálogo `admin_user_role`)

- **`app.dsr_admin_list(filtros status, kind, prazo, assigned_to, cursor)`** e **`app.dsr_admin_get(p_case)`** (inclui linha do tempo e pendências calculadas: hold, pedidos abertos, assinatura ativa).
- **`app.dsr_open_assisted(p_actor, p_subject_ref, p_kind, p_details, p_channel)`**: abertura pelo DPO; exige `opened_by_operator_id`, não exige step-up do titular (a verificação de identidade do solicitante é manual e registrada em `request_details.identity_check` com código, sem anexar documento). Para eliminação, o caso nasce com exigência de `approval_request` antes da anonimização.
- **`app.dsr_assign(p_actor, p_case, p_assignee)`**: move para `em_analise` se `aberto`; evento e auditoria `dsr.case_assigned`.
- **`app.dsr_process(p_actor, p_case)`**: despacha por `kind`:
  - acesso: chama `app.dsr_generate_extract`; ao final `deferido` e depois `concluido`/`extrato_disponibilizado`.
  - correção: aplica `proposed_changes` por whitelist de campos (nome civil/social, e-mail, endereço-base). Troca de e-mail só entra após revalidação de posse do novo e-mail (fluxo existente de verificação de e-mail); documento de profissional vira item da fila de verificação H-039, sem bypass (a correção fica `deferido` até o item ser decidido). Auditoria `dsr.correction_applied`.
  - eliminação: `private.dsr_anonymize_subject` (4.3).
- **`app.dsr_reject(p_actor, p_case, p_note text, p_partial boolean, p_outcome text)`**: exige `legal_basis_note`; evento `rejected`; e-mail 3.

### 4.3 Extração e anonimização

- **`private.dsr_build_extract(p_subject uuid) returns jsonb`**: monta payload com `schema_version`, `generated_at`, `subject_ref`, seções: cadastro (`app_user` sem `auth_user_id` interno), perfil (cliente/profissional), status histórico de verificação (sem `document_enc`, `document_hmac`, chaves, caminhos de Storage), `service_requests` do titular, `reviews` publicadas sob rótulo anônimo, `contact_consents` e `contact_reveal_log` do próprio titular, `messages` (texto das mensagens enviadas/recebidas pelo titular, sem metadados privados de terceiros: contraparte aparece como rótulo "Participante"), `address_shares` (profissional e data/hora, Q681), `subscriptions`, `access_grants` e `payments` do profissional (valores e datas, sem dados de cartão/identificadores do provedor). Allowlist explícita por coluna; qualquer coluna nova fica de fora até ser incluída por decisão (anti-vazamento por `SELECT *`). Não inclui `audit_event` (RC-07) nem sessões/desafios (RC-09). Não referencia tabelas de histórico de fotos.
- **`app.dsr_generate_extract(p_case uuid)`**: chama a função acima, grava metadados em `dsr_export` (o arquivo é escrito no bucket privado `dsr-exports` pela API, que devolve `storage_path` e `sha256`; a função registra e fecha o caso na sequência `deferido` para `concluido`). O HMAC é calculado na API com chave de servidor, para a chave não entrar no banco.
- **`private.dsr_anonymize_subject(p_case uuid)`**: uma transação, idempotente (reexecução em caso já `concluido` é no-op), com `SELECT ... FOR UPDATE` no caso e no usuário. Ordem:
  1. Revalida pré-condições: sem `legal_hold` ativo (recusa com indeferimento), sem pedido em andamento, caso `deferido`, e para `channel='dpo_externo'` exige `approval_request` aprovado (677).
  2. Assinaturas: marca `billing.subscription` do sujeito como cancelada localmente (`cancel_at_period_end` ou estado cancelado, o que o modelo atual usar) e insere job `subscription_cancel_provider` (4.4). `billing.payment` não é tocada (RC-06).
  3. `app_user.email` para `anon-<32 hex aleatórios>@anon.fastpro.internal`; `email_verified_at` nulo; `status='anonimizado'`; `blocked_reason='dsr_eliminacao'`.
  4. Perfil: apaga/zera nome, telefone, base, bio, foto, identificadores pessoais (cliente e profissional); mantém `public_label` generalizado.
  5. Documentos: enfileira objetos de `identity-docs` em `retention_object_queue` (H-109); limpa campos pessoais de documento. Se o titular é profissional recusado/retido por duplicidade, preserva `document_hmac` como restrição antifraude e registra isso em `legal_basis_note` (670).
  6. Pedidos: zera `exact_point` e `address_text_enc`, mantém `match_point`/`public_label` (678); descrições e fotos de pedidos fechados expurgadas ou dissociadas (RC-03), objetos de foto via `retention_object_queue`.
  7. Chat: mensagens preservadas, autor com rótulo "Usuário excluído" e ponteiro de perfil nulo (666). Avaliações: mantidas, ligação ao cadastro do autor desfeita (667).
  8. Consentimentos: `contact_consent` marcado revogado com motivo `encerramento_conta` e data; `contact_reveal_log` intocado (RC-10).
  9. Sessões: `app.app_session` do sujeito revogadas; rascunhos e fotos em quarentena do usuário descartados; desafios e `step_up_grant` abertos invalidados.
  10. Fecha caso: `concluido`, `outcome='conta_anonimizada'`, `closed_at`, `legal_basis_note` com o resumo das retenções (pagamentos, auditoria, consentimentos, registros de conexão).
  11. `private.audit_append(...)` com a ação `dsr.subject_anonymized` e e-mail 3 (ver nota de destino abaixo).
  Nunca faz UPDATE/DELETE em `audit.audit_event` (RN-H111-04).
  Nota de e-mail: o aviso final precisa ir ao endereço original, que é substituído no passo 3. A função copia o endereço original para o `ops.email_outbox` (destinatário já resolvido, uso único) na mesma transação antes do passo 3; depois do envio o `ops.email_outbox` segue a retenção própria e não é exportado. Isso é exceção documentada; ver DV-5.

### 4.4 Jobs idempotentes (fila `ops.job`, nome físico confirmado no DEV)

- **`dsr_process_auto`**: pega casos de eliminação `aberto` com `channel='titular'` e `status` sem pendência, marca `em_analise`, defere e executa a anonimização (autoatendimento, 677). Falha vira retry com backoff (máx. 3 tentativas, regra do projeto) e, esgotado, o caso fica `em_analise` com alerta ao DPO; nunca avança parcial.
- **`dsr_auth_cleanup`**: após `anonimizado` e commit, chama a Admin API do Supabase Auth para banir/excluir o `auth_user_id` e invalidar tokens. Idempotente. Mesmo que atrase, o acesso já está barrado no banco por `status='anonimizado'` (T-API-12).
- **`subscription_cancel_provider`**: cancela a assinatura no Mercado Pago por porta (`PaymentProviderPort`); usa a chave de teste do `.env.local` em DEV; nos testes é substituído por fake. Falha do provedor não desfaz a anonimização: reaparece em fila de pendência para o operador, e a assinatura local já cancelada impede nova renovação do lado do produto (ver DV-4).
- **`dsr_export_purge`**: remove do bucket os extratos com `expires_at` vencido e preenche `purged_at`; também limpa extratos de casos cancelados.
- **`dsr_deadline_watch`**: marca no painel casos a 3 dias do `deadline_at` e vencidos (sem e-mail extra além dos três previstos; só indicador).

## 5. Contratos de API

Todas as rotas exigem sessão autenticada. Respostas de erro seguem o envelope padrão do projeto `{code, message, correlation_id}`. `Idempotency-Key` obrigatório em POST que cria ou muda estado. Rate limit por usuário (limites de taxa existentes do projeto; valores novos abaixo `[PROPOSTA]`).

### 5.1 Titular (`apps/api/src/privacy/`)

| Rota | Entrada | Saída | Erros |
|---|---|---|---|
| `POST /v1/privacy/step-up` | `{purpose:"dsr_open"}` (dispara e-mail/código) | 202 sem corpo informativo (mesma resposta exista ou não problema de envio) | 429 |
| `POST /v1/privacy/step-up/confirm` | `{code}` | 200 `{step_up_token, expires_at}` | 400 `codigo_invalido` (mensagem genérica), 429 |
| `POST /v1/privacy/dsr-requests` | `{kind:"acesso|correcao|eliminacao", details?, step_up_token?}` (token obrigatório em acesso/eliminação) | 201 `{id, protocol, kind, status:"aberto", deadline_at}`; 200 com `deduplicated` ou extrato vigente (Q682) | 403 `step_up_obrigatorio`, 409 `dsr_em_andamento {protocol}`, 409 `pedido_em_andamento`, 422 `kind_nao_suportado`, 429 `dsr_carencia {carencia_ate}`, 200/201 com `status:"indeferido_total"` quando houver `legal_hold` (sem revelar o motivo da retenção além do código genérico `retencao_legal`) |
| `GET /v1/privacy/dsr-requests` | cursor/limit | lista do próprio titular | 401 |
| `GET /v1/privacy/dsr-requests/:id` | | caso, linha do tempo, `fundamentacao` (se indeferido), `extract:{download_url, expires_at}` quando houver (URL assinada de 5 min gerada a cada GET, válida enquanto `expires_at` futuro) | 404 uniforme para inexistente OU de outro titular |
| `POST /v1/privacy/dsr-requests/:id/cancel` | | 200 caso atualizado | 404 uniforme; 409 `dsr_nao_cancelavel` (fora de `aberto`) |

### 5.2 Operador/DPO

| Rota | Permissão | Notas |
|---|---|---|
| `GET /v1/admin/privacy/dsr-cases` | `dsr.read` | filtros `status, kind, prazo, assigned_to`; Suporte vê só protocolo e status (campos reduzidos por permissão) |
| `GET /v1/admin/privacy/dsr-cases/:id` | `dsr.read` | detalhe, pendências, linha do tempo; nunca devolve o conteúdo do extrato |
| `POST /v1/admin/privacy/dsr-cases` | `dsr.open_assisted` | abertura assistida; exige `subject` e `channel` |
| `POST /v1/admin/privacy/dsr-cases/:id/assign` | `dsr.decide` | |
| `POST /v1/admin/privacy/dsr-cases/:id/process` | `dsr.decide` (+ dupla aprovação para eliminação assistida) | |
| `POST /v1/admin/privacy/dsr-cases/:id/reject` | `dsr.decide` | `legal_basis_note` obrigatório (validado na API e no banco) |

Download do extrato pelo operador não existe: o conteúdo só chega ao titular. O DPO vê apenas metadados (tamanho, hash, validade).

## 6. Segurança

### 6.1 Anti-enumeração e anti-abuso
- Protocolo aleatório, não sequencial; busca por protocolo nunca é rota pública; só `id` + posse.
- Mesmo 404 (corpo, status e tempo aproximado) para caso inexistente e de outro titular. Teste de forma e de tempo grosso (T-API-09).
- `POST /step-up` responde igual sempre; códigos de 6 dígitos com hash, 5 tentativas e bloqueio temporário; rate limit por usuário e IP (HMAC).
- 409 `dsr_em_andamento` só devolve protocolo do próprio titular (o índice é por sujeito, nunca revela caso alheio).
- Limite: 5 aberturas por titular por dia (qualquer kind), 3 step-ups por hora, 1 exportação a cada 30 dias.

### 6.2 Dados e segredos
- Extrato nunca contém segredos técnicos (allowlist, 4.3) e não é logado; logs só trazem `case_id` e contagens.
- Bucket `dsr-exports` privado, sem política pública; acesso só por URL assinada curta gerada pela API (`app_system`); caminho com UUID aleatório; criptografia em repouso do provedor. `sha256` e assinatura permitem ao titular verificar integridade.
- Tokens (step-up e download) guardados só como hash; chaves de assinatura só em variável de ambiente do servidor.
- Auditoria sem PII em claro: `case_id`, `subject_user_id`, `kind`, `actor_ref` e códigos.
- LGPD: `[PENDENTE JURIDICO]` 663, 666, 667, 668, 669, 670, 673, 678, 681 seguem como `[PROPOSTA]` até validação jurídica; o código deve ler prazos e rótulos de configuração, não de constantes, para ajuste sem migração onde possível.

### 6.3 Papéis e permissões
Novas linhas em `admin_permission` e `admin_role_permission`: `dsr.read` (DPO, Superadmin, Auditor, Suporte em modo reduzido), `dsr.decide` (DPO, Superadmin), `dsr.open_assisted` (DPO, Superadmin). Criar a linha `dpo` em `app.admin_role` (a chave é `code`, não `id`; confirmado no DEV em 19/11: não existe. Já existem `auditor`, `financeiro`, `governanca_dados`, `moderador`, `superadmin`, `suporte` e `verificacao`). MFA/step-up administrativo do `admin_staff` ativo é pré-requisito. O próprio operador não pode decidir caso em que ele é o titular (checagem `subject_user_id <> p_actor`).

## 7. Matriz de testes

Camadas: `db` (testes SQL do `db:test`), `unit` (domínio/serviço), `api` (rota), `static` (varredura). Todos rodam localmente, sem rede externa (CA-H111-18).

| ID | Camada | O que prova | CA/RN |
|---|---|---|---|
| T-DB-01 | db | Tabela, colunas, tipos e CHECKs de `kind`, `status`, `outcome`, `channel` existem | CA-01 |
| T-DB-02 | db | `anon` e `authenticated` recebem `permission denied` em SELECT/INSERT/UPDATE/DELETE em `dsr_case`, `dsr_export`, `dsr_case_event`, `step_up_grant` | CA-02 |
| T-DB-03 | db | `EXECUTE` das funções só para `app_system`; todas com `search_path` vazio e `SECURITY DEFINER` (consulta ao catálogo) | D-A3 |
| T-DB-04 | db | Índice único parcial recusa segundo caso ativo do mesmo kind (aberto/em_analise/deferido) e permite após terminal | CA-05, D-A1 |
| T-DB-05 | db | Todas as transições válidas passam; `concluido→aberto`, terminal→qualquer e pulos inválidos dão `violacao_maquina_estados` | CA-06 |
| T-DB-06 | db | Imutabilidade de `protocol`, `subject_user_id`, `kind`, `opened_at`, `deadline_at` | RN-01 |
| T-DB-07 | db | Indeferimento sem `legal_basis_note` (nulo, vazio, só espaços) dá `nota_base_legal_obrigatoria` | CA-15 |
| T-DB-08 | db | `closed_at` e `outcome` obrigatórios em terminal; proibidos em não terminal | 3.1 |
| T-DB-09 | db | DELETE em `dsr_case` e UPDATE/DELETE em `dsr_case_event` proibidos | 3.1/3.2 |
| T-DB-10 | db | `dsr_open` calcula `deadline_at` a partir de `app_config` (testar 15 e valor alterado) | 663 |
| T-DB-11 | db | `dsr_open` de acesso/eliminação sem step-up, com token expirado, de outro usuário ou já consumido falha | CA-04 |
| T-DB-12 | db | Corrida: duas aberturas simultâneas do mesmo kind geram 1 caso e 1 `dsr_em_andamento` | CA-05 |
| T-DB-13 | db | Idempotência: mesma `Idempotency-Key` devolve o mesmo caso sem duplicar evento nem e-mail | 4.1 |
| T-DB-14 | db | Acesso dentro de 30 dias da exportação anterior devolve vigente/carência e não cria caso | 682 |
| T-DB-15 | db | Eliminação com `legal_hold` ativo: caso `indeferido_total`, usuário inalterado, nenhum UPDATE em tabelas do sujeito | CA-10 |
| T-DB-16 | db | Eliminação com pedido em andamento recusada, sem caso e sem mudar status da conta | RN-08 |
| T-DB-17 | db | Anonimização: e-mail vira `anon-<hex>@anon.fastpro.internal`, status `anonimizado`, perfil limpo, sessões revogadas, login impossível; e-mail original reutilizável em novo cadastro | CA-09, 679 |
| T-DB-18 | db | Status `em_eliminacao` e `anonimizado` são tratados como não ativos nos guards de elegibilidade e RLS existentes | 674 |
| T-DB-19 | db | `audit_event`: contagem e `row_hash` do sujeito idênticos antes/depois; nenhum UPDATE/DELETE emitido | CA-11 |
| T-DB-20 | db | `billing.payment` do profissional intacta (contagem, valores, datas) após eliminação | CA-12 |
| T-DB-21 | db | Assinatura recorrente marcada cancelada localmente e job de provedor enfileirado, na mesma transação | CA-13 |
| T-DB-22 | db | Consentimentos revogados com `encerramento_conta`; `contact_reveal_log` intocado | RC-10 |
| T-DB-23 | db | Chat preservado com autor "Usuário excluído"; avaliação mantida sem FK ao cadastro | 666/667 |
| T-DB-24 | db | Pedido: `exact_point` e `address_text_enc` nulos; `match_point` e `public_label` mantidos | 678 |
| T-DB-25 | db | Profissional recusado/retido: `document_hmac` preservado, documentos enfileirados em `retention_object_queue`, nota registrada | 670 |
| T-DB-26 | db | Atomicidade: falha forçada no meio do expurgo desfaz tudo; reexecução após sucesso é no-op | 4.3 |
| T-DB-27 | db | Abertura assistida exige `opened_by_operator_id`; anonimização assistida sem `approval_request` aprovado é recusada | 673/677 |
| T-DB-28 | db | Operador não decide caso do próprio titular; permissão `dsr.decide` ausente é recusada | 6.3 |
| T-DB-29 | db | Cada operação grava `audit_event` esperado (`dsr.case_opened` … `dsr.case_rejected`) sem PII | RN-12 |
| T-DB-30 | db | `dsr_cancel`: só dono, só em `aberto`; devolve `ativo` se estava `em_eliminacao` por este caso | CA-14 |
| T-UN-01 | unit | `dsr_build_extract` cumpre o esquema JSON e não contém chaves proibidas (`document_enc`, `document_hmac`, `auth_user_id`, tokens, hashes de senha, caminhos de Storage) | CA-07, RN-07 |
| T-UN-02 | unit | Extrato não inclui dados privados de terceiros nem `audit_event`; inclui `address_shares` e consentimentos | CA-07, 681 |
| T-UN-03 | unit | Assinatura e `sha256` do extrato verificáveis; adulteração detectada | 664 |
| T-UN-04 | unit | Cliente só vê seções de cliente; profissional vê as suas | 4.3 |
| T-API-01 | api | `POST /dsr-requests` com step-up válido: 201, linha no banco, evento e auditoria na mesma transação | CA-03 |
| T-API-02 | api | Sem step-up, expirado, reutilizado: 403 `step_up_obrigatorio`, nenhum caso criado | CA-04 |
| T-API-03 | api | Duplicado: 409 `dsr_em_andamento`; carência: `dsr_carencia` | CA-05, 682 |
| T-API-04 | api | `GET :id` com extrato: URL assinada curta, `expires_at` em 7 dias; após expirar não há URL e o arquivo foi purgado | CA-08 |
| T-API-05 | api | URL de download de uso único e curta: segunda tentativa após uso/expiração falha | D-A6 |
| T-API-06 | api | Cancelamento pelo dono ok; por outro usuário 404; fora de `aberto` 409 | CA-14 |
| T-API-07 | api | Dois titulares: lista só os próprios; `GET :id` do caso alheio e inexistente retornam 404 idêntico (corpo e status) | CA-16 |
| T-API-08 | api | Acesso administrativo: Suporte vê campos reduzidos, Auditor só leitura, DPO decide, Admin comum sem permissão recebe 403 | 676 |
| T-API-09 | api | Anti-enumeração: protocolos aleatórios, sem rota de busca por protocolo, tempo de resposta do 404 sem diferença grosseira | 6.1 |
| T-API-10 | api | Rate limits: step-up (3/h), aberturas (5/dia), código errado (5 tentativas) | 6.1 |
| T-API-11 | api | Eliminação fim a fim (autoatendimento): job processa, e-mail original não autentica, extrato não é gerado, auth cleanup chamado | CA-09 |
| T-API-12 | api | Com `dsr_auth_cleanup` atrasado/falho, login ainda é barrado por `status='anonimizado'`; reexecução idempotente | D-A5 |
| T-API-13 | api | Falha do provedor de pagamento no cancelamento não desfaz a anonimização e cria pendência | 4.4 |
| T-API-14 | api | E-mails: abertura, conclusão com link e conclusão/indeferimento via `ops.email_outbox` com `dedupe_key`; captura em Mailpit/mock; nenhum envio real | 675 |
| T-API-15 | api | Correção: campos fora da allowlist recusados; troca de e-mail só efetiva após revalidação; documento de profissional cria item na fila H-039 | 5.4 |
| T-API-16 | api | Abertura assistida pelo DPO registra canal e operador; anonimização assistida exige dupla aprovação | 673/677 |
| T-ST-01 | static | Nenhum símbolo `media_access_log`/`media_access_daily` nem rotina de backup/exportação de banco no código de H-111 | CA-17, RN-13/16 |
| T-ST-02 | static | Sem chamadas de rede externas (mapas, SMS, e-mail real) na suíte; mocks locais | CA-18 |
| T-ST-03 | static | Funções novas passam por varredura do catálogo: sem `SECURITY DEFINER` sem `search_path` vazio; sem `GRANT` a `anon/authenticated` | D-A3 |

Gates locais: `corepack pnpm check:all`, `db:test`, `lint`, `typecheck`, `test`, com comando, contagem e código de saída registrados na Issue.

## 8. Plano de migração

Prefixo livre depois de `20261113430000` (último existente: `20261113430000_requests_expand_customer_panel.sql`). Confirmar na hora de criar que o prefixo está livre. Cada `.sql` tem seu `.down.sql`. Aplicação somente no DEV com `npx supabase` (nunca pelo MCP); sem Docker.

| Ordem | Arquivo | Conteúdo |
|---|---|---|
| 1 | `20261113440000_privacy_create_dsr_case.sql` | `app.dsr_case`, `dsr_case_event`, índices, RLS forçada, revogações, triggers (imutabilidade, máquina de estados, base legal, anti-DELETE); config `privacy.*` |
| 2 | `20261113450000_privacy_create_step_up_and_export.sql` | `step_up_grant` (se não existir), `dsr_export`, bucket privado `dsr-exports`, política de Storage negando acesso direto |
| 3 | `20261113460000_privacy_expand_app_user_status.sql` | CHECK de `app_user.status` com `em_eliminacao`/`anonimizado`; ajuste dos guards de elegibilidade/RLS (tratar como não ativo) |
| 4 | `20261113470000_privacy_create_dsr_user_functions.sql` | `dsr_open`, `dsr_cancel`, `dsr_list_own`, `dsr_get_own` |
| 5 | `20261113480000_privacy_create_dsr_extract.sql` | `private.dsr_build_extract`, `dsr_generate_extract` |
| 6 | `20261113490000_privacy_create_dsr_anonymize.sql` | `private.dsr_anonymize_subject`, passos de chat, avaliação, pedidos, consentimento, sessões |
| 7 | `20261113500000_privacy_create_dsr_admin_functions.sql` | funções administrativas, permissões e papel `dpo` (seed idempotente) |
| 8 | `20261113510000_privacy_create_dsr_jobs.sql` | registro dos jobs e tipos de e-mail no `ops.email_outbox` |

`.down.sql`: remove em ordem inversa; o `down` do passo 3 só é permitido se não houver usuário `anonimizado` (senão falha com mensagem clara, pois reverter perderia estado irreversível). Os testes de banco (`T-DB-*`) acompanham cada migração. Ordem de implementação sugerida: 1, 2, 3, 4 (com T-DB-01 a 14), 5, 6 (T-DB-15 a 26), 7, 8, depois API e interface do titular e do console.

Prefixos já usados: passo 1 = `20261113460000` (fatia 1, aplicada no DEV); passo 2 = `20261113470000` (fatia 2, arquivo `supabase/migrations/20261113470000_privacy_create_step_up_and_export.sql`). Os passos seguintes seguem a ordem da tabela, com prefixos a partir de `20261113480000` (a tabela acima mostra o plano original).
Se alguma migração de outra Issue ocupar um dos prefixos, renumerar a mais nova mantendo a ordem relativa. Nenhum dado de demonstração é criado; fixtures de teste ficam nos próprios testes.

## 9. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Destruição irreversível por sessão sequestrada | Step-up de 15 min, e-mail de confirmação, auditoria; ver DV-3 |
| R-2 | Vazamento por `SELECT *` no extrato | Allowlist por coluna e teste de chaves proibidas (T-UN-01) |
| R-3 | Novo valor de `app_user.status` ignorado por guards antigos e permitir ação de conta em eliminação | T-DB-18 e revisão de todos os pontos que testam `status='ativo'` |
| R-4 | Auth ficar válido após anonimização | Barreira no banco (`status`), job idempotente de limpeza (T-API-12) |
| R-5 | Falha de provedor deixa cobrança recorrente viva | Cancelamento local imediato impede renovação do lado do produto; pendência visível; ver DV-4 |
| R-6 | Prazo legal estourar sem alerta | `dsr_deadline_watch` e filtro por prazo na fila |
| R-7 | Posições `[PENDENTE JURIDICO]` mudarem | Parametrizar via `app_config`/retention_policy e manter rótulos e prazos fora de código |
| R-8 | Colisão entre H-111 e outras Issues em `app_user.status` e guards | Migração 3 isolada; coordenação com Issues paralelas que toquem elegibilidade |
| R-9 | Unicidade de e-mail permitir recadastro de quem foi fraudador | `document_hmac` preservado para profissionais retidos (670); lista restritiva por fraude comprovada fica fora desta história |
| R-10 | Abuso do endpoint de acesso para esgotar armazenamento/CPU | Limite 1 por 30 dias, JSON simples, TTL de 7 dias, expurgo |

## 10. Dúvidas e pontos que exigem o dono

Nenhuma bloqueia o desenvolvimento em DEV; o líder adota a recomendação e segue, salvo as de dono/jurídico.

- **DV-1 (jurídico, dono).** Validar com advogado/encarregado as posições `[PENDENTE JURIDICO]` 663, 666, 667, 668, 669, 670, 673, 678 e 681 antes de produção. Em DEV rodam como `[PROPOSTA]`. Não gera pergunta agora (regra de volume; produção fora do escopo).
- **DV-2 (técnica, líder adota).** Colisão de nomes: o refino usa `app_user.state`/`account_state`; o modelo real usa `status`. Adotado `status` (seção 3.3). Conferir também a lista de `kind` fora de escopo (`bloqueio`, `confirmacao`).
- **DV-3 (decisão do líder, possível veto do dono).** Eliminação por autoatendimento sem prazo de arrependimento (PO). Alternativa: carência de 24 h com cancelamento por e-mail. Recomendação do arquiteto: manter sem carência em DEV e reavaliar antes de produção. Impacto: só segurança de uso real; reversível por configuração futura.
- **DV-4 (técnica, líder adota).** Cancelamento no Mercado Pago é chamada externa de pagamento. Em DEV usa a chave de teste do `.env.local` já autorizada; nos testes automáticos é fake. Sem decisão pendente com o dono.
- **DV-5 (técnica, líder adota).** O aviso final de eliminação vai ao endereço original, copiado para o `ops.email_outbox` antes da anonimização (4.3). Alternativa: não enviar aviso final de eliminação e mostrar só na tela até a sessão cair. Recomendado: enviar uma única vez; o `ops.email_outbox` não entra no extrato nem se reutiliza.
- **DV-6 (técnica, DEV confirma).** Resultado da confirmação no DEV em 19/11 (leitura somente): não havia tabela de step-up própria (criada na 470000); `app.auth_challenge` existe, mas o step-up dela é ligado à sessão; a fila de jobs é `ops.job` e o e-mail de saída é `ops.email_outbox`; `legal_hold` não tem `subject_ref`, e sim `subject_type` (`user` ou `request`) e `subject_id`; `app.app_session` existe; não há papel de banco `dpo` (é linha de `app.admin_role`, chave `code`); a função de auditoria é `private.audit_append`. Ainda por confirmar: tabelas de chat, `review`, `service_request` e o campo de cancelamento de `billing.subscription` (fatias 3 em diante). Se H-033 (QA no quadro) ainda não estiver `Concluído` quando a H-111 for para QA, `contact_consent` e `contact_reveal_log` já existem no DEV (migração `20261113250000` aplicada), mas a aceitação de H-111 depende de H-033 não ser revertida.
- **DV-7 (negócio, líder adota).** Troca de e-mail por correção reaproveita o fluxo de verificação existente; se esse fluxo não existir como serviço reutilizável, a correção de e-mail vira `indeferido_parcial` com orientação e entra como débito registrado, não como expansão desta história.

## 11. Próxima etapa

Passar a Issue #120 para Desenvolvimento (WF-03), seguindo a ordem de migrações da seção 8 e os testes da seção 7. Sem alterar quadro, `11-DECISOES.md` nem banco nesta etapa; o Orquestrador registra as decisões 663 a 682 como "adotada pelo líder" em `11-DECISOES.md` e move o cartão.
