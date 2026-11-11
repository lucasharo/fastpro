# Desenho H-073 — Acesso excepcional a conversa (Issue #83, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 4 dúvidas não bloqueantes (§7).
- **Rastro:** 57-REFINO-H073 (CA-H073-01..08; D-H073-1..3 do Orquestrador, D-H073-4..6 do PO); 54-DESENHO-H102 (§1 aprovação, §3 guarda, §4 404/403); 08 §13; 09 (`access_case`, `sensitive_access_log`, RC-04); 11 T-08. Código lido (somente leitura): `packages/domain/src/admin/*`, migrações `20261110140000_audit_create_event_chain`, `20261111190000_admin_create_staff`, `20261111220000_admin_create_rbac`.
- **Natureza:** documento. Nenhum código, migração, teste, chave ou e-mail foi criado.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho.

## 0. Fatos e decisões de partida

1. `[VERIFICADO]` Existem `admin_staff`, papéis/permissões, `admin_session` (8 h; só `aal2_at`, sem marca de TOTP recente), `approval_request`/`approval_vote`, `private.audit_append` (devolve o id do evento) e catálogo `audit.action_catalog`. **Não existem** `conversation`/`message` (H-065/H-066, mesma onda), `access_case`, `sensitive_access_log`, nem a permissão `case.authorize_sensitive`.
2. `[VERIFICADO]` O modelo de aprovação de H-102 **não serve como está**: (a) `approval_request.action_type` só aceita `papel_superadmin|mfa_reenroll`; (b) `approval_vote_guard` exige que o aprovador seja Superadmin; (c) `admin_approval_open` exige `admin.role.manage`. H-073 estende (a) e (b) por migração e **não** usa (c): abre o pedido dentro da própria função do caso.
3. `[DECIDIDO]` D-H073-1: sem aviso ao participante no MVP (registro completo permite avisar depois). D-H073-2: `case.authorize_sensitive` nova; H-073 acrescenta só `acesso_conversa`, H-105 os seus. D-H073-3: TOTP recente de admin.
4. `[PROPOSTA]` D-H073-4..6 do PO aceitos: documentos fora; validade 30 min sem renovação; negação sempre 403 `permission_denied` sem pista; **uma conversa por caso**.
5. **Princípio:** a autoridade é o banco. Nenhum endpoint de navegação livre: a única leitura é `private.access_case_gate`, chamada **dentro** da função que lê a conversa. A RLS por participação não é afrouxada (admin nunca é membro; e-mail de admin é reservado, H-102).

## 1. Pedido de acesso excepcional com motivo e aprovação de outra pessoa (CA-01, 02, 03)

**Dados** (migração `admin_create_access_case`, RLS forçada, sem políticas, `revoke all` de todos menos `app_system`, acesso por funções `private.access_case_*`, `security definer`, `search_path=''`, como 54 §1):

| Tabela | Colunas e regras |
|---|---|
| `app.access_case` | `id`; `opened_by` → `admin_staff`; `authorized_by` → `admin_staff` (nulo até aprovar; check `<> opened_by`); `justification` (texto, 20 a 500 caracteres após `trim`, sem validar conteúdo); `scope_kind` check `= 'conversation'` (lista para ampliar depois); `scope_id uuid` (sem FK: a tabela de conversa nasce em H-065); `approval_request_id` único → `approval_request`; `created_at`; `approved_at`, `expires_at` (nulos até aprovar; **check `expires_at = approved_at + interval '30 minutes'`**; os três campos nulos ou os três preenchidos); `closed_at`, `closed_by`, `close_reason` `encerrado\|revogado`. **Estado derivado dos dados** (sem job): *pendente* (`approved_at` nulo e aprovação não vencida), *ativo* (`approved_at <= agora < expires_at` e `closed_at` nulo), *vencido/fechado* nos demais casos. Sem DELETE; sem coluna de renovação. |
| `app.sensitive_access_log` | `id`; `case_id`; `actor_id`; `scope_kind`; `scope_id`; `action` check `= 'read'`; `read_at`; `audit_event_id`. **Sem texto de mensagem, e-mail, telefone nem justificativa.** Append-only: trigger que recusa UPDATE, DELETE e TRUNCATE; `app_system` sem UPDATE/DELETE. Índices `(case_id, read_at)` e `(scope_id, read_at)` (para aviso futuro, D-H073-1). |

Alteração de H-102 (nesta migração): `approval_request.action_type` passa a aceitar `acesso_conversa` (o check é recriado com a lista **vigente na data da migração**; teste de §5 trava a lista); `detail_code` e `subject_user_id` ficam nulos nesse tipo (o caso liga-se ao pedido por `approval_request_id`); `approval_vote_guard` passa a decidir o aprovador **por tipo**: `papel_superadmin`/`mfa_reenroll` como hoje (Superadmin ativo); `acesso_conversa` exige `private.admin_has_permission(aprovador, 'case.authorize_sensitive')`. Em ambos: aprovador ≠ solicitante. Permissão nova `case.authorize_sensitive`, mapeada a `superadmin` `[PROPOSTA]` (D-7-1); Superadmin continua sem herdar as demais.

**Funções** (todas recebem `p_now` do relógio injetado, como H-102):
- `private.access_case_open(p_actor, p_session_hash, p_conversation, p_justification, p_case_id, p_now) → uuid`: revalida a permissão `case.open_sensitive` e a **sessão** (não revogada, não vencida, do mesmo usuário) e a **TOTP recente** (§4); recusa justificativa fora de 20..500 (`ADM22`), conversa nula (`ADM22`) e mais de 5 casos pendentes do mesmo solicitante `[PROPOSTA]`, ou outro caso pendente/ativo do mesmo solicitante para a mesma conversa (`ADM23`); cria `approval_request` (`acesso_conversa`, 24 h, `required_approvals=1`) e `access_case` e audita `access_case.opened`. Não libera nada (CA-02).
- `private.access_case_approve(p_actor, p_session_hash, p_case, p_now) → void`: `FOR UPDATE` no caso e no pedido; revalida permissão `case.authorize_sensitive`, sessão e TOTP recente; exige caso pendente; o voto reaproveita `private.admin_approval_vote` (aprovador ≠ solicitante por gatilho; um voto por pessoa; pedido vencido → `expirada`, sem efeito). Aprovado: na **mesma transação** preenche `authorized_by`, `approved_at`, `expires_at = approved_at + 30 min`, marca o pedido `consumida` (uso único) e audita `access_case.approved`. Autoaprovação, repetição, sem permissão, vencida ou já usada → negada e o caso fica como estava (CA-03).
- `private.access_case_close(p_actor, p_case, p_now)`: o solicitante (`encerrado`) ou quem tem `case.authorize_sensitive` (`revogado`) fecha um caso pendente ou ativo; idempotente; audita `access_case.closed`. Efeito imediato (CA-05).

**API** (registro de rotas de `packages/access-matrix`; guarda de 54 §3; mutações com `Origin` conferida):

| Rota | Permissão | Corpo → resposta |
|---|---|---|
| `POST /v1/admin/access-cases` | `case.open_sensitive` | `{conversation_id, justification}` → 201 `{id, status:"pendente"}` |
| `GET /v1/admin/access-cases` | `sessao` | casos que a pessoa abriu e, se tiver `case.authorize_sensitive`, os pendentes de outros. Campos: id, estado, `scope_id`, justificativa, `expires_at`; **nunca** conteúdo nem participantes |
| `POST /v1/admin/access-cases/{id}/approve` | `case.authorize_sensitive` | sem corpo → 200 `{status:"ativo", expires_at}` |
| `POST /v1/admin/access-cases/{id}/close` | `sessao` (a função decide) | sem corpo → 200 |
| `POST /v1/admin/access-cases/{id}/conversation/read` | `case.open_sensitive` | `{cursor?}` → 200 página de mensagens (§3) |

A leitura é `POST` porque tem efeito (grava o log): não é pré-carregada nem repetida por cache, e herda a checagem de `Origin`. Respostas: negação de caso (inexistente, de outra pessoa, de outra conversa, pendente, vencido, fechado, sem permissão na função) é **sempre 403 `permission_denied`**, mesmo corpo e cabeçalhos (D-H073-5, CA-01/05); validação 422 `justificativa_invalida` / `conversa_invalida`; excesso de pendentes 429 `muitos_casos_pendentes`; TOTP antigo 403 `step_up_required` (§4). Todas com `no-store`.

## 2. Janela de 30 minutos, sem renovação (CA-04, 05)

- A janela vale de `approved_at` (inclusive) até `expires_at` (**exclusivo**): `agora >= expires_at` já nega (limite estrito, igual ao desenho de 52 §4.2/§4.3). A mesma comparação existe no domínio (função pura) e no banco (`access_case_gate`); o banco é a autoridade.
- Sem renovação: não há operação que mexa em `expires_at` depois de preenchido (check de coluna + trigger `BEFORE UPDATE` que recusa mudar `approved_at`/`expires_at`/`authorized_by`). Precisando de mais tempo, abre-se **outro caso** com nova aprovação.
- A janela não depende da sessão de 8 h: sessão vencida ou revogada nega a leitura mesmo com caso ativo (revalidada a cada leitura, como 54 §3).
- O caso libera **somente** `scope_id` (uma conversa, D-H073-6) e **somente** ao `opened_by`; o autorizador não lê por causa da aprovação.
- Ler outra conversa, ou ler sem caso, nunca retorna dado nem metadado.

## 3. Registro de cada leitura na mesma transação (CA-06; H-006)

`private.access_case_gate(p_actor, p_session_hash, p_case, p_conversation, p_now) → uuid` (id do log) faz, **na transação de quem a chama**:
1. revalida permissão, sessão, `opened_by = p_actor`, `scope_id = p_conversation`, caso ativo na janela do §2;
2. chama `private.audit_append` (`access_case.conversation_read`; objeto `conversation`/`p_conversation`; estado só com `case_id` e `scope_kind`, **sem justificativa e sem texto**);
3. insere `sensitive_access_log` com o `audit_event_id`;
4. devolve o id do log. Qualquer falha (inclusive da auditoria) levanta `ADM20` e a transação inteira desfaz.

**Ponto de encaixe do chat (H-065/H-066):** a função de leitura de mensagens (`security definer`, só `app_system`) **chama o gate primeiro** e só então faz o `SELECT`. Assim a leitura sem registro é impossível por construção. H-073 entrega e testa o gate com uma tabela de conversa **provisória de teste**; a migração que cria `conversation`/`message` acrescenta a função de leitura, e o teste de aceite dela deve provar "sem caso, sem linha". Até lá a rota de leitura devolve 501 interno (não registrada em produção) `[PROPOSTA]`.

Cada **página** lida gera um registro. Tentativas negadas por quem já passou na guarda (ex.: caso vencido) são gravadas depois, **em transação própria**, como `access_case.read_denied` com `reason_code` (`sem_caso|vencido|outra_conversa|sem_permissao`), igual ao `self_grant_denied` de 54 §5.1; falha dessa gravação não muda a resposta (403) e vai a métrica.

Catálogo de ações novo (migração; chaves de estado sem dado pessoal): `access_case.opened`, `access_case.approved`, `access_case.closed`, `access_case.conversation_read`, `access_case.read_denied`. A justificativa **fica só em `access_case`** (texto livre pode conter dado pessoal).

## 4. TOTP recente exigido e dependência da H-102 (CA-08; D-H073-3)

**Regra:** abrir e aprovar caso exigem prova do segundo fator nos últimos 30 minutos; ler, listar e fechar não exigem. Vale `agora < totp_at + 30 min` (exatamente 30 min já exige nova prova, coerente com o §2; o PO escreveu "mais de 30 min", ver D-7-2).

**Dependência da H-102 (#111, já entregue; ajuste pequeno, sem reabrir a história):**
1. Migração `admin_add_session_step_up`: `app.admin_session.totp_at timestamptz` (preenchida com `aal2_at` nas linhas existentes e, a partir daí, `not null`); `private.admin_session_open` grava `totp_at = aal2_at` (o login já exige TOTP); função `private.admin_step_up(p_session_hash, p_now)` que só avança `totp_at` (nunca recua), de sessão válida; `private.admin_guard` passa a devolver `totp_at`.
2. `AdminGuardRecord` ganha `totpAtMs`; domínio expõe `isTotpRecent(totpAtMs, nowMs)` (30 min, estrito).
3. Rota `POST /v1/admin/session/step-up` (`sessao`): corpo `{password, code}`; **reaproveita `AdminAuthPort.signInWithPasswordAndTotp`** (caminho de H-102, mesmas defesas e limites H-015 do login: 5 falhas/15 min por usuário e 20 por IP, 429 uniforme) e confere que o `authUserId` devolvido é o da sessão; sucesso chama `admin_step_up`. Não há porta nova. Se a prova em desenvolvimento de H-102 (R-1) mostrar que o código sozinho basta, o corpo vira `{code}` sem mudar o resto.
4. Auditoria `admin.session.step_up` (nova ação no catálogo).
5. As funções `access_case_open`/`access_case_approve` **leem `totp_at` da sessão no banco** (a API não repassa o "recente" como booleano) e levantam `ADM21` → 403 `step_up_required`.

Ordem de entrega: (1) ajuste de H-102 (itens 1 a 4) com seus testes; (2) restante de H-073. Sem (1), CA-H073-08 não se cumpre.

## 5. Testes para o DEV (offline; domínio em Vitest, banco de desenvolvimento em `*.dbtest.mjs`; sem rede e sem envio real)

Setup bloqueia `fetch`/sockets como T-H102; relógio falso; e-mails `@example.test`; `AdminAuthPort` em memória; sentinelas de justificativa, texto de mensagem, e-mail e cookie varridas em logs, erros, `audit_event` e todas as colunas (`to_jsonb(row)::text`). Conversa de teste: tabela provisória criada dentro de transação com rollback.

**Domínio (Vitest)** — funções puras de `packages/domain/src/admin/access-case.ts` (decisões de abrir, aprovar, ler e janela) e `isTotpRecent`:
- T-H073-01 abrir: sem permissão → 403; justificativa vazia, com 19 caracteres, com 501 e só espaços → 422; sem conversa → 422; TOTP a 29:59 passa e a 30:00 exige `step_up_required`.
- T-H073-02 aprovar: solicitante → negado; mesmo aprovador duas vezes → negado; sem `case.authorize_sensitive` (inclusive Suporte, Auditor, Financeiro) → 403; pedido vencido (24 h) ou já consumido → negado.
- T-H073-03 janela: leitura em `approved_at` (ok), `expires_at - 1 ms` (ok), `expires_at` exato (**negada**), `+1 ms` (negada); caso fechado/revogado nega no mesmo instante; outra conversa nega; outro admin (mesmo com permissão) nega.
- T-H073-04 respostas: todas as negações de caso devolvem **o mesmo** 403 `permission_denied`, corpo e cabeçalhos idênticos byte a byte (sem pista de existência); `no-store`.
- T-H073-05 registro de rotas: cada rota do §1 declara permissão; rota fora do registro → 404; matriz papel × rota gerada por `access-matrix` (Superadmin aprova e não abre; Suporte abre e não aprova; Auditor nenhuma).
- T-H073-06 logs e erros sem justificativa, texto, e-mail, token ou cookie.

**Banco (várias conexões; limpeza sintética)**
- T-H073-20 RLS forçada e privilégios: `anon/authenticated/service_role/app_api` sem acesso; `app_system` só por função; `sensitive_access_log` rejeita UPDATE, DELETE e TRUNCATE (trigger e privilégio); sem coluna de texto de mensagem.
- T-H073-21 gate: sem caso, caso pendente, caso de outra pessoa, outra conversa, caso fechado, sessão revogada/vencida, papel revogado depois da aprovação → `ADM20`, **nenhuma linha em `sensitive_access_log` nem em `audit_event`** (as de `read_denied` são só da transação própria).
- T-H073-22 janela no banco: leitura com `p_now = expires_at` negada, `expires_at - 1 ms` aceita; `expires_at <> approved_at + 30 min` recusado pelo check; UPDATE de `expires_at`/`approved_at`/`authorized_by` recusado.
- T-H073-23 mesma transação: ação `access_case.conversation_read` desativada no catálogo → gate falha e a leitura da tabela provisória não ocorre; leitor provisório que falha **depois** do gate desfaz o log junto (rollback); leitura bem-sucedida deixa 1 linha de log + 1 evento com `audit_event_id` coerente; chain verificada (`audit_verify_chain`).
- T-H073-24 aprovação: autoaprovação (gatilho), aprovador sem permissão, voto repetido; 20 aprovações simultâneas do mesmo caso → exatamente 1 efeito (`approved_at` único, pedido `consumida` uma vez); 20 aberturas simultâneas na mesma conversa → 1 caso; o 6º pendente do mesmo solicitante é recusado.
- T-H073-25 TOTP recente no banco: `totp_at` a 29:59 abre/aprova; a 30:00 → `ADM21`; `admin_step_up` não recua `totp_at`; sessão revogada → recusa.
- T-H073-26 estende H-102: `approval_request` aceita `acesso_conversa` e continua recusando tipo desconhecido (teste lista os tipos vigentes para que H-105 amplie sem quebrar); `papel_superadmin` continua exigindo Superadmin; Superadmin não ganha `case.open_sensitive` nem as demais permissões.
- T-H073-27 varredura de colunas: justificativa sentinela só em `access_case.justification`.

Evidência: `corepack pnpm check:all` local; comando, contagem e código de saída na Issue.

### 5.1 Arquivos esperados
`packages/domain/src/admin/access-case.ts` (decisões, `isTotpRecent`), novas rotas em `packages/domain/src/admin/routes.ts` e `packages/access-matrix/src/`, `packages/db/src/admin-access-case.ts` (repositório Pg), `apps/api/src/admin-routes.ts` (rotas), migrações `AAAAMMDDHHMMSS_admin_add_session_step_up.sql` e `…_admin_create_access_case.sql` com rollbacks em `supabase/rollbacks/`, `…/tests/admin-access-case.dbtest.mjs`. Telas (abertura, aprovação, leitura): H-103.

## 6. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Tabelas `conversation`/`message` ainda não existem: a leitura real só nasce com H-065/H-066. | Gate testado com tabela provisória; critério de aceite na migração do chat ("sem caso, sem linha"); rota de leitura não registrada até lá. |
| R-2 | Sem aviso ao participante (D-H073-1) pode conflitar com a regra jurídica (RF-140, `[PENDENTE JURÍDICO]`). | Registro completo e indexado por conversa permite avisar depois; revisar quando L1/L2 sair. |
| R-3 | Só 2 Superadmins no máximo (H-102): a aprovação pode ficar indisponível; se um Superadmin tiver também o papel Suporte, aprova só casos de outros. | Gatilho já impede autoaprovação; pedido pendente vale 24 h; revisar o mapa de papéis em D-7-1. |
| R-4 | Colusão entre dois administradores. | Aceito (dupla aprovação é o controle de RF-148); toda abertura, aprovação e leitura na cadeia de auditoria, com consulta pelo Auditor (H-104). |
| R-5 | Justificativa em texto livre pode conter dado pessoal. | Guardada só em `access_case`, fora da auditoria e dos logs; limite de 500 caracteres; retenção na classe do caso (RC-04). |
| R-6 | Cada página lida grava log e evento na cadeia (volume e serialização do `audit_append`). | Páginas grandes (50 mensagens), caso de 30 min e uso raro; medir no teste de carga de H-006; separar por tabela de log se preciso. |
| R-7 | Prova de TOTP depende do caminho servidor do Supabase ainda não provado (R-1 de H-102). | Step-up reaproveita a porta do login; mesmo plano B de H-102 (TOTP em código próprio), sem mudar contrato. |
| R-8 | Duas histórias (H-073, H-105) redefinem o guarda de voto e o check de `action_type`. | Cada migração recria a lista completa vigente; T-H073-26 trava o conjunto; ordem de migração é por timestamp. |
| R-9 | Estado "ativo" derivado de timestamps depende de relógio coerente. | Relógio do banco/injetado passado como `p_now`; limites exatos testados. |

## 7. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-7-1 Quem tem `case.authorize_sensitive`.** (a) só `superadmin`; (b) novo papel; (c) também `auditor`. *Recomendação: (a), por já ser o aprovador de ações críticas; revisar se faltar pessoas (R-3).*
2. **D-7-2 Limite do TOTP recente.** O refino diz "mais de 30 min"; o desenho nega a partir de exatamente 30 min (coerente com a janela do caso). *Recomendação: aceitar e ajustar o texto de CA-H073-08.*
3. **D-7-3 Step-up com senha e código.** Reaproveita o caminho já desenhado no login; o código sozinho depende da prova de H-102. *Recomendação: aceitar senha e código agora.*
4. **D-7-4 Registro duplo (log + auditoria).** `sensitive_access_log` (contrato de 09) e evento na cadeia; atualizar 09 §3 (colunas de `access_case` com `approved_at` e `expires_at` nulos até a aprovação) e 08 §13. *Recomendação: aceitar.*

## Resumo em linguagem simples

Para ler uma conversa, um administrador precisa pedir com um motivo escrito, outra pessoa precisa aprovar, e ele só enxerga aquela conversa por 30 minutos, sem prorrogar. Cada leitura fica registrada junto com a própria leitura (se o registro falhar, a leitura não acontece), e o pedido e a aprovação exigem o código do celular dado há menos de 30 minutos.
Antes disso, a área administrativa precisa de um pequeno ajuste para guardar a hora do último código; os testes usam serviços de mentira e um banco de desenvolvimento, sem rede nem e-mail real.
