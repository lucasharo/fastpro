# Desenho H-017 — Exclusividade de papéis (Issue #30, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com duas dúvidas não bloqueantes (§10, A1 e A2) que o líder pode adotar como recomendadas, como fez com 136 a 141.
- **Rastro:** 100-REFINO-H017 (CA-01..CA-13); decisões 136 a 141 (`11-DECISOES.md`, rodada 37, adotadas como recomendadas, não reabertas); 08-ARQUITETURA §5.2; 09-MODELO-DADOS §3.1 (`app_user`, `customer_profile`, check "admin sem perfil"), §3.5 (`acceptance`); 11-ARQ I-19, T-04, T-05; 54-DESENHO-H102 (§1 gancho "Perfil proibido", R-6); 46-DESENHO-H012 (§4 `ensureCustomer`); 99-DESENHO-H036 (formato); migrações `20261111150000` (`app_user`), `20261111190000` e `20261111220000` (`admin_staff`, convite, `admin_email_is_reserved`), `20261111400000` e `20261112100500` (`professional_profile`), `20261112100000` (`email_hmac`), `20261112170000` (modelo de cadastro de ação de auditoria).
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` dono do produto ou líder · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento ou de outra Issue.

## 0. Situação encontrada (o que muda o escopo do refino)
1. `[VERIFICADO]` **Não existe `app.customer_profile`.** O cliente é hoje o próprio `app.app_user`, criado por `private.app_user_ensure` (chamado por `PgCustomerAccounts.ensureCustomer`, `packages/db/src/challenge-consume.ts`). `app.professional_profile` (PK `user_id` → `app_user.id`) e `app.admin_staff` (PK `user_id` → `app_user.id`, status `pendente_mfa|ativo|desativado`) existem. Sem um objeto "perfil de cliente" não há onde ancorar a regra "admin sem perfil de cliente". 09 §3.1 já prevê `customer_profile (user_id PK/FK, created_at)`; este desenho a cria.
2. `[VERIFICADO]` **Hoje nada impede que um link de cliente seja consumido com o e-mail de um admin.** `app_user_ensure` devolve a linha existente; `admin_email_is_reserved` existe (`20261111220000`) mas **não é chamada** pelo código (gancho "na #27" de 54 §1 nunca foi ligado; grep em `apps/*/src` e `packages/*/src` sem ocorrência). Isso é a lacuna real do lado do cliente; o convite de admin já recusa e-mail com `app_user` (D-H102-11), o que fecha o outro sentido, mas só pela API.
3. `[VERIFICADO]` **Não existem `app.service_request` nem `app.acceptance`** (Ondas 2 e 3). A regra I-19 (profissional não aceita o próprio pedido) só pode ser entregue como **função de gatilho pronta e testada com tabelas de fixture**, e anexada à tabela real pela história que criar `acceptance` (§4.3 e §8).
4. `[VERIFICADO]` Unicidades já existentes de `app_user`: `email` único, `auth_user_id` único, `email_hmac` único parcial. CA-01 já é verdadeiro no banco; falta apenas o teste que o prove e a imutabilidade de `auth_user_id` (§3.4).
5. `[VERIFICADO]` Atribuição de admin: `admin_staff` só nasce no passo 1 do convite (`private.admin_invite_mark_waiting`, `security definer`) e o primeiro Superadmin via `packages/db/scripts/admin-bootstrap.mjs` (convite, execução local). Autoatribuição já é barrada (`admin_staff_nao_convida_a_si`, `admin_user_role_nao_autoconcede`). A decisão 139 ("só ferramenta de linha de comando ou seed") é **mais estrita** que o mecanismo vigente (convite por Superadmin com dupla aprovação, #111/#112): ver A1 em §10.

## 1. Princípios
1. **O banco decide.** As três regras vivem em gatilhos `BEFORE INSERT` com função `security definer` e `search_path=''`, não em código de API.
2. **Uma só seção crítica por pessoa.** Toda checagem de papel toma o mesmo `pg_advisory_xact_lock` por `user_id`, o que serializa criação de perfil de cliente, de profissional e de `admin_staff` do mesmo usuário (corrida de CA-10).
3. **Mensagem do banco ≠ mensagem da API.** O banco levanta erros com código estável por regra (para diagnóstico e teste). A API traduz todos para um único texto fixo (CA-11, decisão 141). Nenhuma mensagem de erro contém identificador, e-mail ou valor.
4. **Sem operação destrutiva.** A migração não apaga nem altera dados de usuário; falha com lista de casos se houver violação (decisão 140).
5. **Reuso.** `audit.action_catalog` + `private.audit_append`, `ops.app_config` não é necessário (sem parâmetro).

## 2. Modelo de papéis `[PROPOSTA]`
- **Cliente** = existe linha em `app.customer_profile`. **Profissional** = existe linha em `app.professional_profile`. **Admin** = existe linha em `app.admin_staff`, **em qualquer status** (inclusive `pendente_mfa` e `desativado`; um admin desativado não vira cliente ou profissional por essa via; reativar é decisão futura).
- Matriz (decisões 136 e 137): cliente+profissional no mesmo `app_user` permitido; admin+cliente e admin+profissional proibidos nos dois sentidos.
- Papéis RBAC dentro do admin (`admin_user_role`) não entram: são subpapéis de quem já é admin.

## 3. Dados: migração por expansão, reversível `[PROPOSTA]`
Arquivo: `supabase/migrations/20261112200000_identity_create_role_exclusivity.sql` (número **livre** em 2026-11-12: o maior existente é `20261112190000`; o DEV reconfere antes de gravar e ajusta o prefixo mantendo ordem crescente). Desfazer: `supabase/rollbacks/20261112200000_identity_create_role_exclusivity.down.sql`. Aplicar depois com `npx supabase` (banco de desenvolvimento), nunca pelo MCP. Idempotente (`if not exists`, `create or replace`, `drop trigger if exists`). Mesma postura de RLS das migrações de identidade.

### 3.1 Verificação prévia (CA-12, decisão 140)
Bloco `do $$ ... $$` **antes** de qualquer DDL: conta e lista (ids opacos de `app_user`, nunca e-mail) os usuários que já violam a matriz: (a) `admin_staff` e `professional_profile` para o mesmo `user_id`; (b) `admin_staff` e evidência de cliente (§3.2); (c) se `app.acceptance` e `app.service_request` já existirem (migração aplicada tarde), pares com `acceptance.professional_id = service_request.customer_user_id`, via SQL dinâmico protegido por `to_regclass`. Se houver qualquer caso: `raise exception 'h017_violacao_existente' using detail = <lista>`, sem alterar nada. A base de desenvolvimento atual provavelmente tem zero casos `[NÃO VERIFICADO]` (o DEV roda a contagem antes de aplicar e registra na Issue).

### 3.2 `app.customer_profile` e retroalimentação
- `app.customer_profile (user_id uuid primary key references app.app_user(id) on delete restrict, created_at timestamptz not null)`. RLS habilitada e forçada, sem políticas; `revoke all` de `public, anon, authenticated, service_role`; `grant select, insert on app.customer_profile to app_system` (sem UPDATE e sem DELETE: perfil não muda de dono nem some; exclusão de conta é da H-040).
- **Retroalimentação (uma vez, na mesma migração):** `insert into app.customer_profile select u.id, u.created_at` para todo `app_user` que **não** tem `admin_staff` e que **ou** não tem `professional_profile` **ou** tem `app_session` com `purpose in ('login','publish')` (sessão de cliente; o profissional usa `purpose='password'`). `on conflict do nothing`. Usuários só de admin ficam sem perfil. A retroalimentação roda **depois** da verificação de §3.1, portanto um admin com evidência de cliente já teria abortado a migração.
- Ordem na migração: verificação (§3.1) → tabela → retroalimentação → funções → gatilhos.

### 3.3 Funções e gatilhos (todos `security definer`, `set search_path = ''`, erros com `errcode '23514'` e mensagem fixa sem interpolação)
1. `private.role_excl_lock(p_user uuid) returns void`: `pg_advisory_xact_lock(hashtextextended('fastpro:role_excl:' || p_user::text, 0))`. Além disso, verifica `current_setting('transaction_isolation') = 'read committed'`; senão `raise exception 'papel_isolamento_nao_suportado'` (a garantia da corrida depende de cada instrução ver o commit anterior; o padrão do Postgres e das conexões da API já é read committed, `[NÃO VERIFICADO]` para os pools de produção; o teste T-17 prova que o código recusa outro nível).
2. `private.role_excl_guard_customer()` (BEFORE INSERT em `customer_profile`): lock; se existe `admin_staff` do `NEW.user_id` ⇒ `papel_exclusivo_admin_cliente`.
3. `private.role_excl_guard_professional()` (BEFORE INSERT em `professional_profile`): lock; se existe `admin_staff` ⇒ `papel_exclusivo_admin_profissional`. **Cuidado de compatibilidade:** `professional_register_create` e a recuperação inserem `app_user` e `professional_profile` na mesma transação; o gatilho só consulta `admin_staff`, então o caminho feliz não muda.
4. `private.role_excl_guard_admin()` (BEFORE INSERT em `admin_staff`): lock; se existe `customer_profile` ou `professional_profile` do `NEW.user_id` ⇒ `papel_exclusivo_perfil_admin`. Substitui o "teste pendente" de 54 §1 / R-6.
5. Imutabilidade (BEFORE UPDATE OF `user_id`): `customer_profile` não aceita UPDATE para `app_system` (sem privilégio); para `professional_profile` e `admin_staff`, gatilho `BEFORE UPDATE` que recusa mudança de `user_id` (`papel_chave_imutavel`). Evita mover uma linha de perfil para outro usuário e contornar a regra. `[PROPOSTA]`
6. `private.customer_profile_ensure(p_user_id uuid, p_now timestamptz) returns table(out_status text)`: `ok|reservado`. Se já existe perfil ⇒ `ok`. Se existe `admin_staff` ⇒ `reservado` (sem gravar; é o caso "link de cliente para conta admin"). Senão `insert ... on conflict do nothing` e `ok`. Captura `23514` do gatilho e devolve `reservado` (corrida). Grant execute só a `app_system`. **Ligação:** `PgCustomerAccounts.ensureCustomer` chama esta função depois de resolver o usuário (existente ou recém-criado) e, se `reservado`, devolve o mesmo resultado de usuário bloqueado (`link_invalido` uniforme, sem revelar que a conta é admin; RF-039, 5.3 de 08). `[PROPOSTA]`
7. `private.acceptance_not_own_request()` (função de gatilho, **ainda sem tabela alvo**): BEFORE INSERT OR UPDATE OF `request_id, professional_id` em `acceptance`. Recebe em `TG_ARGV[0]` o nome da tabela de pedidos como texto, converte com `::regclass` (impede injeção) e executa `format('select customer_user_id from %s where id = $1', ...) using NEW.request_id`; se `customer_user_id is not distinct from NEW.professional_id` e não é nulo ⇒ `aceite_proprio_pedido`. Pedido inexistente ⇒ não decide (a FK recusa). Cliente anonimizado (`customer_user_id` nulo, H-040) ⇒ não bloqueia, porque não há quem comparar `[NÃO VERIFICADO]`. A regra **não depende do estado do pedido** (CA-03, 3.2 do refino). Anexo previsto na migração que criar `acceptance`: `create trigger acceptance_nao_proprio_pedido before insert or update of request_id, professional_id on app.acceptance for each row execute function private.acceptance_not_own_request('app.service_request');`.
   - A mesma garantia vale para `selection`, `conversation` e `contact_reveal` por construção: todas dependem de `acceptance` por FK composta (09 §3.5); nenhum gatilho adicional.
8. Todas as funções: `revoke all ... from public, anon, authenticated, service_role, app_api`; `grant execute` só a `app_system`, exceto as funções de gatilho (executadas pelo dono da tabela, sem grant).

### 3.4 Identidade única (CA-01)
- Sem mudança de esquema: `email`, `auth_user_id` e `email_hmac` já são únicos. Acrescenta-se o gatilho `app_user_identidade_imutavel` (BEFORE UPDATE OF `auth_user_id` em `app_user`): recusa qualquer alteração (`app_user_identidade_imutavel`). O e-mail não fica imutável (troca de e-mail pode vir a existir). `[PROPOSTA]`, ver A2.
- Dois e-mails para a mesma pessoa: limitação aceita, nenhum mecanismo (CA-13).

### 3.5 Auditoria da recusa (decisão 141, CA-11)
- Uma ação nova em `audit.action_catalog`, no modelo de `20261112170000`: `('identity.role_exclusivity.denied', 'app_user', false, array['rule'], 'Operacao recusada pela exclusividade de papeis (H-017); so o codigo da regra')`.
- **Quem grava:** a API, **fora** da transação que falhou (a exceção desfaz tudo o que a transação gravou, inclusive uma linha de auditoria feita pelo gatilho). O adaptador captura `23514` com a mensagem de uma das quatro chaves (`papel_exclusivo_admin_cliente`, `papel_exclusivo_admin_profissional`, `papel_exclusivo_perfil_admin`, `aceite_proprio_pedido`), abre transação nova e chama `private.audit_append` com `actor_ref` = id do próprio ator (opaco, sem dado do terceiro), `object_type='app_user'`, `object_id` = id do ator, `after = {"rule": "<chave>"}` (chave `rule` e valor `[A-Za-z0-9_.:-]` passam por `audit_key_is_forbidden`; DEV confirma com `private.audit_keys_are_clean`). Nunca grava id do cliente do pedido, e-mail, nome ou CPF. Falha ao auditar não muda a resposta ao usuário (melhor esforço, com log sem dado pessoal).
- Cadastro de ação nova exige migração: está na mesma migração de §3.

### 3.6 Desfazer (`...down.sql`)
Ordem: remover gatilhos de `customer_profile`, `professional_profile`, `admin_staff`, `app_user`; remover funções `private.role_excl_*`, `customer_profile_ensure`, `acceptance_not_own_request`; remover a linha de `audit.action_catalog` **só se não referenciada** por `audit.audit_event` (senão mantém, a cadeia de auditoria é imutável); remover `app.customer_profile`. **Guarda:** se `customer_profile` tiver linha, aborta com `rollback_recusado_com_dados` a menos que `set app.rollback_force = '1'` (mesma convenção do desenho H-036; só dev). Se existir gatilho `acceptance_nao_proprio_pedido` em `app.acceptance` (anexado depois), o desfazer o remove antes de apagar a função (via `to_regclass`). Idempotente. Não toca `app_user`, `professional_profile`, `admin_*` além dos gatilhos.

## 4. Contratos de interface

### 4.1 Banco (para o DEV)
| Função | Entrada | Saída | Quem chama |
|---|---|---|---|
| `private.customer_profile_ensure(p_user_id, p_now)` | usuário resolvido por `ensureCustomer` | `out_status` `ok` ou `reservado` | `PgCustomerAccounts.ensureCustomer` |
| gatilhos 2, 3, 4, 5, `app_user_identidade_imutavel` | — | erro `23514` com chave fixa | automático em qualquer INSERT/UPDATE (inclui SQL direto do dono) |
| `private.acceptance_not_own_request()` | `TG_ARGV[0]` = `'app.service_request'` | erro `aceite_proprio_pedido` | gatilho a anexar na migração que criar `acceptance` |

### 4.2 Domínio e adaptador (sem rota HTTP nova)
- `packages/domain/src/identity/role-exclusivity.ts` `[PROPOSTA]`: tipo `RoleExclusivityRule = 'admin_cliente' | 'admin_profissional' | 'perfil_admin' | 'aceite_proprio_pedido'`; `ROLE_EXCLUSIVITY_MESSAGE` (texto fixo único, em português do produto: "Operação não permitida."); `parseRoleExclusivityError(err): RoleExclusivityRule | null` (reconhece `code === '23514'` e as quatro chaves em `message`; qualquer outro erro devolve `null`). Função pura, testável sem banco.
- `packages/db/src/role-exclusivity.ts` `[PROPOSTA]`: `recordRoleExclusivityDenied(client, actorUserId, rule, now)` (transação própria, melhor esforço, §3.5).
- `CustomerAccountResult` (`packages/domain/src/identity/consume.ts`) **não muda de forma**: `reservado` mapeia para `{ status: 'bloqueado' }`, que a rota de consumo já trata como `link_invalido` uniforme. Reutilizar evita nova ramificação visível.
- **Contrato futuro (H-069, aceite):** ao receber `23514` com `aceite_proprio_pedido`, responder com a mesma mensagem fixa e o mesmo código HTTP de "aceite indisponível" que a rota escolher; nunca devolver a chave nem o motivo (CA-11, estados de interface do refino §6). Registrar na Issue da H-069 que o anexo do gatilho (§3.3 item 7) é obrigatório e conferido pelo teste T-12.

## 5. Segurança
- **Anti-enumeração:** link de cliente para e-mail de admin responde como link inválido (mesmo corpo e tempo). A diferença de tempo de `customer_profile_ensure` é irrisória (uma consulta por PK a mais) e já está dentro do orçamento de tempo uniforme da H-097 `[NÃO VERIFICADO]`: T-14 mede a razão.
- **Privilégio mínimo:** `customer_profile` sem UPDATE/DELETE para `app_system`; funções `security definer` com `search_path=''` e nomes qualificados; nenhum acesso para `anon/authenticated/service_role/app_api` (T-05 de 11-ARQ cobre RLS/catálogo: o teste de catálogo existente passa a incluir a tabela nova).
- **Ninguém se atribui admin:** continua por `admin_invite_issue` (Superadmin com aprovação) e `admin-bootstrap.mjs`; o gatilho de §3.3 item 4 é a rede de segurança contra um convite ativado para e-mail que ganhou perfil entre a emissão e a ativação (R-6 de 54).
- **Sem dado pessoal em erro, log e auditoria** (§3.5, CA-11).
- **Limitações:** dois e-mails = duas contas (aceita); o gatilho não olha CPF/CNPJ (decisão 138).

## 6. Concorrência
- **Corrida principal (CA-10):** T1 insere `admin_staff` e T2 insere `customer_profile` (ou `professional_profile`) para o mesmo `user_id`. Ambos tomam o mesmo `pg_advisory_xact_lock`; o segundo espera o commit/rollback do primeiro e, em read committed, a consulta do gatilho enxerga o commit ⇒ recusa. Resultado: nunca as duas linhas coexistem. Sem deadlock: cada transação toma um único lock de papel e a ordem dos demais bloqueios (FK em `app_user`) é a mesma nos três caminhos.
- **Mesmo papel duas vezes:** `PK (user_id)` + `on conflict do nothing` (idempotência de `customer_profile_ensure`).
- **Pedido × aceite:** `service_request.customer_user_id` precisa ser **imutável** (a história do pedido, H-031/#44 e seguintes, deve incluir gatilho que bloqueie UPDATE dessa coluna; registrar como pré-requisito na Issue). Com a coluna imutável, a checagem do aceite não precisa de lock sobre o pedido; sem a imutabilidade, o gatilho de §3.3 item 7 teria de usar `for share` no pedido. `[NÃO VERIFICADO]` até a tabela existir.
- **Isolamento:** trabalho em read committed; o outro nível é recusado explicitamente (§3.3 item 1).

## 7. Plano de testes `[PROPOSTA]`
Todos de banco em `packages/db/tests/role-exclusivity.dbtest.mjs` (transação com rollback, valores sintéticos `@example.test`, UUIDs gerados, mesmo molde de `admin-staff.dbtest.mjs`); concorrência em `role-exclusivity-concorrencia.dbtest.mjs` (dois clientes, molde de `approval-dual-h105-concorrencia.dbtest.mjs`); unitários de domínio em `packages/domain/tests/` ou `packages/db/tests/role-exclusivity.test.ts`; estático da migração em `role-exclusivity-migration.test.mjs` (molde de `draft-migration.test.mjs`). O comando de evidência local é `corepack pnpm check:all` e `db:test`.

| Teste | O que prova | CA |
|---|---|---|
| T-01 | segundo `app_user` com o mesmo `auth_user_id`, ou mesmo `email`, ou mesmo `email_hmac` ⇒ erro de unicidade; UPDATE de `auth_user_id` ⇒ `app_user_identidade_imutavel` | CA-01 |
| T-02 | mesmo `user_id` com `customer_profile` e `professional_profile` ⇒ ambos gravados | CA-02 |
| T-03 | fixture (schema de teste na transação: `request(id, customer_user_id)` e `acceptance(request_id, professional_id)`) com o gatilho `private.acceptance_not_own_request('<schema>.request')`: inserir aceite de U em pedido de U ⇒ recusado `aceite_proprio_pedido`, contagem de linhas e de vagas inalterada; também por UPDATE de `professional_id`; vale com pedido em qualquer estado (coluna de estado na fixture: aberto, selecionado, cancelado, encerrado) | CA-03 |
| T-04 | aceite de U2 em pedido de U1 ⇒ aceito | CA-04 |
| T-05 | U com os dois perfis aceita pedido de U3 ⇒ aceito | CA-05 |
| T-06 | U com os dois perfis insere pedido (fixture) como cliente ⇒ aceito (a regra não toca a publicação) | CA-06 |
| T-07 | `admin_staff` existente (cada status: `pendente_mfa`, `ativo`, `desativado`) e insert de `customer_profile` ⇒ `papel_exclusivo_admin_cliente` | CA-07 |
| T-08 | idem para `professional_profile` ⇒ `papel_exclusivo_admin_profissional`; SQL direto como dono também recusa | CA-08 |
| T-09 | `customer_profile` existente e insert de `admin_staff` ⇒ `papel_exclusivo_perfil_admin`; idem com `professional_profile`; caminho `private.admin_invite_mark_waiting` com usuário que ganhou perfil ⇒ erro tratado (não conta como ativado) | CA-09 |
| T-10 | **corrida:** 50 rodadas, dois clientes em paralelo (`admin_staff` x `customer_profile`, e `admin_staff` x `professional_profile`) para o mesmo usuário novo; ao fim, em toda rodada, nunca existem as duas linhas; exatamente um dos dois comandos falha com a chave esperada; nenhum deadlock | CA-10 |
| T-11 | unitário `parseRoleExclusivityError`: as quatro chaves ⇒ regra; `23505`, mensagem desconhecida, erro sem `code` ⇒ `null`; `ROLE_EXCLUSIVITY_MESSAGE` idêntico para as quatro regras e sem `email`, UUID, CPF; varredura do texto do erro final HTTP com sentinelas de e-mail, nome e id do terceiro ⇒ ausentes (e do registro `audit.audit_event` criado pela recusa) | CA-11 |
| T-12 | teste de catálogo condicional: se `to_regclass('app.acceptance')` existe, deve haver gatilho `acceptance_nao_proprio_pedido` ligado a `private.acceptance_not_own_request`; se não existe, o teste registra `adiado: tabela ainda inexistente` (cobre o anexo obrigatório da H-069 sem falsear verde) | CA-03 (anexo) |
| T-13 | migração com violação plantada (via função de teste que roda o bloco de §3.1 sobre o catálogo sintético ou em banco descartável): admin com perfil profissional ⇒ exceção `h017_violacao_existente`, lista só ids, nada alterado; sem violação ⇒ passa e retroalimenta `customer_profile` corretamente (usuário só cliente, usuário só profissional sem sessão de cliente, profissional com sessão `login`, admin) | CA-12 |
| T-14 | `customer_profile_ensure`: usuário comum ⇒ `ok` e linha criada, repetido ⇒ `ok` sem duplicar; usuário admin ⇒ `reservado` sem linha; `PgCustomerAccounts.ensureCustomer` com e-mail de admin ⇒ `bloqueado` (mesmo corpo da rota de consumo que usuário bloqueado); razão de tempo entre e-mail de admin e de cliente dentro da tolerância da H-097 | CA-09/CA-11 |
| T-15 | duas contas com e-mails diferentes e dois `app_user`: aceite no próprio pedido **não** é bloqueado; o teste registra "limitação aceita (14-BACKLOG H-017)" e passa | CA-13 |
| T-16 | estático da migração: RLS habilitada e forçada em `customer_profile`; sem grants para `anon/authenticated/service_role/app_api`; todas as funções `security definer` com `search_path=''`; sem `delete`/`drop` de dado de usuário fora do `.down.sql`; ação de auditoria cadastrada | segurança |
| T-17 | `set transaction isolation level repeatable read` e insert de `admin_staff`/perfil ⇒ `papel_isolamento_nao_suportado` | CA-10 |
| T-18 | desfazer: aplicar `.down.sql` em banco com `customer_profile` vazio funciona e é idempotente; com linha aborta `rollback_recusado_com_dados` | reversibilidade |

Dependência de teste: os critérios de aceite que exigem "pedido" e "aceite" reais (T-03 a T-06 pela API/tela) só serão provados na Onda 3; aqui são provados no banco com fixture, como o refino já registrou. `[NÃO VERIFICADO]` até a H-069.

## 8. Impacto sobre histórias existentes
- **H-011/H-012/H-013/H-014 (cliente):** `ensureCustomer` passa a criar o `customer_profile` e a recusar e-mail de admin. Resultado externo igual (mesmos códigos); testes de `h013-*.test.ts` e `challenge-consume*.test.ts` com `SqlClient` simulado precisam do mock da nova chamada. Risco baixo, localizado.
- **H-016/H-035 (profissional):** o gatilho de `professional_profile` só consulta `admin_staff`; nenhum fluxo atual quebra. `professional_register_create`, `professional_verify_confirm` e a recuperação não mudam.
- **H-102 (#111/#112):** `admin_staff` ganha gatilho; o "teste pendente" de 54 §1/R-6 é substituído por T-09. `admin_invite_mark_waiting` pode levantar `23514` na corrida rara; o adaptador do passo 1 deve mapeá-lo para `convite_invalido` (400 uniforme). O DEV localiza o chamador (hoje só aparece em `packages/db/tests/admin-rbac.dbtest.mjs`; o adaptador de produção pode estar em outra Issue `[NÃO VERIFICADO]`).
- **Demo (`packages/db/scripts/demo-load.mjs`, linha `appUser`):** usuários cliente de demonstração passam a precisar de `customer_profile` (inserir junto, `on conflict do nothing`); a remoção da demo apaga a linha antes de `app_user`. O guard da demo não muda.
- **H-045 (acesso comercial derivado):** destravada; usa `professional_profile` e `customer_profile` como fontes de papel.
- **Onda 2/3 (pedido, aceite):** compromissos novos nas Issues dessas ondas: (1) anexar o gatilho `acceptance_nao_proprio_pedido`; (2) `service_request.customer_user_id` imutável; (3) mapear `aceite_proprio_pedido` para a mensagem fixa. Registrar nas Issues correspondentes quando forem refinadas.
- **11-ARQ I-19 e 08 §5.2:** passam de "trigger" prometido para "trigger entregue com fixture; anexo pendente da H-069". Atualizar a linha I-19 e 09 §3.1 (criação efetiva de `customer_profile`) quando a Issue for fechada.
- **Retenção (H-040, `retention/*`):** a rotina de anonimização/expurgo deve tratar `customer_profile` como tabela dependente de `app_user` (inclusão na lista de dependências; `[NÃO VERIFICADO]`, conferir `packages/domain/src/retention` e `20261111470000_retention_create_policy.sql`).

## 9. Arquivos prováveis a tocar `[PROPOSTA]`
**Novos:**
- `supabase/migrations/20261112200000_identity_create_role_exclusivity.sql` e `supabase/rollbacks/20261112200000_identity_create_role_exclusivity.down.sql` (prefixo a reconferir).
- `packages/domain/src/identity/role-exclusivity.ts`
- `packages/db/src/role-exclusivity.ts`
- `packages/db/tests/role-exclusivity.dbtest.mjs`, `role-exclusivity-concorrencia.dbtest.mjs`, `role-exclusivity-migration.test.mjs`, `role-exclusivity.test.ts` (ou equivalente em `packages/domain/tests`).

**Existentes (edição pequena):**
- `packages/db/src/challenge-consume.ts` (`PgCustomerAccounts.ensureCustomer`: chamada a `customer_profile_ensure`).
- `packages/db/tests/challenge-consume*.test.ts`, `apps/api/tests/h013-*.test.ts` (mocks da nova consulta), se usarem `SqlClient` simulado.
- `packages/db/scripts/demo-load.mjs` (e o teste `demo-*.test.mjs` que o cobre).
- `packages/domain/src/identity/index.ts` (exportar o módulo novo), e **possivelmente** `packages/domain/src/index.ts` e `packages/db/src/index.ts` (exports): **pontos quentes**, pois ambos aparecem modificados e não commitados por outras Issues; o DEV só acrescenta uma linha de export e confere o `git diff` antes.

**Conflito com #42, #43 e #49 (ocupam `request-draft`/`media` e `professional-offering`):** `[VERIFICADO]` nenhum arquivo novo desta Issue está nessas áreas. Os únicos pontos de contato possíveis são os arquivos `index.ts` acima (ou `apps/api/src/composicao.ts` se o DEV decidir ligar o adaptador de auditoria ali; este desenho **não** prevê toque em `composicao.ts` nem em `app.ts`, porque não há rota nova). A numeração da migração é o outro risco: #42/#43/#49 também criam migrações; ordem de prefixo cresce, e o DEV deve reconferir o maior prefixo existente imediatamente antes de gravar o arquivo. Não toca em `request_draft`, `media_*`, `professional_area`, `professional_service`.

## 10. Perguntas abertas (para o líder; numeração local A1, A2; o líder renumera)
**A1 — Atribuição de admin versus a decisão 139.** A decisão 139 diz "só ferramenta de linha de comando ou seed, com auditoria". O mecanismo já entregue (#111/#112) emite convite por Superadmin com dupla aprovação (há também `admin-bootstrap.mjs` para o primeiro). Este desenho **não altera** o mecanismo.
- A. Interpretar 139 como "nenhum caminho público ou de autoatribuição" e manter o convite por Superadmin vigente (recomendado; não regride H-102 e a autoatribuição já está barrada por constraint).
- B. Restringir a criação de `admin_staff` ao script de linha de comando, desativando o convite (mudança de H-102, retrabalho em #111/#112).
- **Destrava:** nada do desenho muda em A; B abre Issue própria.

**A2 — Imutabilidade de `auth_user_id`.** O gatilho que proíbe alterar `app_user.auth_user_id` reforça CA-01, mas impede um eventual processo de migração de conta de provedor.
- A. Incluir o gatilho (recomendado; nenhum processo de troca existe hoje e qualquer troca futura passa por migração e decisão humana).
- B. Não incluir e testar só unicidade.
- **Destrava:** T-01 (parte do UPDATE).

**Observação (não é pergunta):** `customer_profile` é criação nova (não está em nenhuma migração). A Q1 do refino (136) é atendida por ela; sem aprovação humana em contrário, o desenho segue assim.

## 11. Riscos
| Risco | Mitigação |
|---|---|
| Gatilho do aceite nunca ser anexado na Onda 3 | Teste condicional T-12 (falha se `acceptance` existir sem o gatilho) e compromisso registrado nas Issues das Ondas 2/3 |
| Retroalimentação classifica mal um usuário antigo | Verificação prévia aborta com lista; DEV roda a contagem antes de aplicar e anexa o resultado à Issue |
| Pool de produção usar isolamento diferente de read committed | Gatilho recusa outro nível (T-17); falha visível em vez de corrida silenciosa |
| Adaptador de convite não tratar `23514` | Mapeamento para `convite_invalido` e teste T-09 |
| Mocks de `ensureCustomer` quebrados nos testes existentes | Ajuste localizado listado em §9 |
