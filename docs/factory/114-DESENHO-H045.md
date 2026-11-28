# Desenho técnico H-045 — Acesso comercial derivado (Issue #58)

- **Issue:** #58 `[E5] Acesso comercial derivado` · **História:** H-045 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura (segunda tentativa; a primeira não chegou a escrever).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco ou quadro foi alterado nesta etapa.
- **Entradas:** `113-REFINO-H045.md` (CA-H045-01 a 17, B-01 a B-08, RN-H045-01 a 11), decisões 267 a 278 (Rodada 61), `09` §3.10, `08` §4.2, §6, §8.4, §8.5, migração `20261113010000_requests_create_service_request.sql` (modelo de estilo e de privilégios).
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere · `[AMBIGUIDADE]` lacuna.
- **Limites desta leitura:** não li o texto da Issue no GitHub nem rodei banco. Li para a Arquitetura só os arquivos listados acima; o papel `roles/factory-software-architect.md` não foi relido nesta tentativa (orçamento de turnos).

## 1. Decisões fixadas (entrada)

| Dec. | Efeito neste desenho |
|---|---|
| 267 | Fronteira aberta à direita: em `T1 + 72 h` exatos o estado é `expirada`. |
| 268 | Trial de 14 dias corridos: `ends_at = starts_at + 14 dias`. |
| 269 | Pago (inclusive em carência) prevalece sobre trial. |
| 270 | `billing.subscription` mínima nesta história. |
| 271 | Sem coluna `grace_until`. |
| 272 | Função ignora `type='adjustment'` e `status='revogada'`. |
| 273 | Unicidade do trial por `identity_id` no próprio livro. |
| 274 | Função não verifica aprovação do profissional. |
| 275 | Livro imutável (`starts_at`, `ends_at`); `status` só `ativa` para `revogada`, com auditoria; sem DELETE. |
| 276 | Não sobreposição de pagas por restrição de exclusão `btree_gist`; trigger só como plano B. |
| 277 | Função executável só pelo papel de aplicação do servidor; leitura direta negada a `anon` e `authenticated`. |
| 278 | H-045 entra agora (depende só de H-005 e H-017). |

## 2. Fatos verificados que moldam o desenho

- `[VERIFICADO]` Esquemas existentes: `app`, `billing`, `audit`, `ops`, `private` (baseline). `billing` já existe e está vazio de tabelas conhecidas; as tabelas novas vão em `billing`, a função em `private` (padrão das migrações anteriores).
- `[VERIFICADO]` `btree_gist` é criada no baseline (`create extension if not exists btree_gist with schema extensions`, linha 13) e o spike S-02 a lista como disponível (versão 1.7). Falta apenas confirmar no DEV que a restrição de exclusão com `uuid WITH =` e `tstzrange WITH &&` compila (classe de operador `gist_uuid_ops`). `[NÃO VERIFICADO]` a criação efetiva; ver plano B no §3.4.
- `[VERIFICADO]` Chave do profissional: `app.professional_profile (user_id uuid pk)` referencia `app.app_user (id)`. O "professional_id" do livro é esse `user_id`.
- `[VERIFICADO]` **Nenhuma migração cria a coluna `identity_id`** (nem em `professional_profile`). A `09` §3.10/§3.1 a prevê, mas ela não existe. Logo `access_grant.identity_id` é `uuid not null` **sem FK**; quem grava (H-044/H-049) obtém o valor da identidade (H-040). Ver pergunta 289.
- `[VERIFICADO]` Auditoria: `private.audit_append(p_actor_ref text, p_actor_role text, p_action text, p_object_type text, p_object_id uuid, p_before_state jsonb, p_after_state jsonb, p_reason_code text default null, p_correlation_id uuid default null) returns uuid`, `security definer`. Os valores aceitos de `p_actor_role` e as chaves proibidas de estado são validados por `private.audit_key_is_forbidden`/`audit_state_is_valid` (o DEV lê a regra antes de montar o estado; não incluir dado pessoal).
- `[VERIFICADO]` Papéis: `app_api` (sem BYPASSRLS, RLS lê `app.principal_*`) e `app_system` (BYPASSRLS, grants mínimos por tabela) — `08` §4.2 `[PROPOSTA]`. Padrão da H-031: `alter table ... force row level security`, `revoke all ... from public, anon, authenticated, service_role, app_api`, `grant execute ... to app_system`.
- `[VERIFICADO]` Última migração: `20261113140000_requests_fix_begin_ja_publicado_status.sql`. Rollbacks ficam em `supabase/rollbacks/<versão>_<nome>.down.sql`. Testes de banco em `packages/db/tests/*.dbtest.mjs` (`corepack pnpm db:test`, `--test-concurrency=1`, transação com rollback, conexão por `../scripts/lib/env.mjs`).

## 3. Modelo de dados

### 3.1 Migração e rollback (nomes)

- **Migração:** `supabase/migrations/20261113170000_billing_create_access_grant.sql` (prefixo maior que `20261113160000`, conforme pedido). Aplicar com `npx supabase`. Idempotente (`if not exists`, `create or replace`), expansão pura: só tabelas, gatilhos e funções novas. Nenhuma alteração em tabelas existentes; nenhum `cron`, `pg_cron`, `ops.job`, agendamento nem gatilho de tempo (CA-H045-06).
- **Rollback:** `supabase/rollbacks/20261113170000_billing_create_access_grant.down.sql`: `drop function` (as 2 funções), `drop trigger`/funções de gatilho, `drop table billing.access_grant`, `drop table billing.subscription`. Não remove `btree_gist` (é do baseline). Seguro enquanto não houver linha de produção (nenhuma é criada por H-045); se houver, o rollback exige exportação prévia (registrar no cabeçalho).

### 3.2 `billing.access_grant` (CA-H045-01, 02, 08, 09)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` pk `default gen_random_uuid()` | |
| `professional_id` | `uuid not null` | FK `app.professional_profile (user_id)` `on delete restrict` |
| `identity_id` | `uuid not null` | sem FK (a coluna de origem ainda não existe, §2); pergunta 289 |
| `type` | `text not null` | `check (type in ('trial','paid','adjustment'))` |
| `starts_at` | `timestamptz not null` | |
| `ends_at` | `timestamptz not null` | `check (ends_at > starts_at)` |
| `source_payment_id` | `uuid` | sem FK até H-047 (a tabela `payment` não existe); H-047 acrescenta a FK |
| `status` | `text not null default 'ativa'` | `check (status in ('ativa','revogada'))` |
| `revoked_at` | `timestamptz` | `[PROPOSTA]` fora da `09`; `check ((status='revogada') = (revoked_at is not null))` (pergunta 285) |
| `created_at` | `timestamptz not null default clock_timestamp()` | |

**Sem** `grace_until` (dec. 271) e sem coluna de estado (RN-H045-01, CA-H045-16).

CHECKs adicionais `[PROPOSTA]`:
- `access_grant_trial_14d`: `type <> 'trial' or ends_at - starts_at = interval '14 days'`. A subtração de `timestamptz` é imutável e dá 336 h exatas; o Brasil não tem horário de verão desde 2019, então coincide com "14 dias corridos" (dec. 268). Pergunta 288.
- `access_grant_paid_com_pagamento`: `type <> 'paid' or source_payment_id is not null` (perguntas 287).
- `access_grant_trial_sem_pagamento`: `type <> 'trial' or source_payment_id is null`.

Índices:
- `access_grant_trial_unico`: `unique (identity_id) where type = 'trial'` (todas as `status`, inclusive revogada, para não reabrir trial por revogação) — CA-H045-02.
- `access_grant_pagamento_unico`: `unique (source_payment_id) where source_payment_id is not null` — CA-H045-08 (I-20).
- Restrição de exclusão `access_grant_pago_sem_sobreposicao`: `exclude using gist (professional_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (type = 'paid' and status = 'ativa')` — CA-H045-09. Intervalos semiabertos: pagas contíguas `[T0,T1)` e `[T1,T2)` não colidem (B-03).
- `access_grant_consulta_idx`: `(professional_id, ends_at desc) include (starts_at, type) where status = 'ativa' and type in ('trial','paid')` — cobre a consulta da função (R5).

### 3.3 `billing.subscription` mínima (dec. 270; CA-H045-11, 12)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` pk `default gen_random_uuid()` | |
| `professional_id` | `uuid not null` | FK `app.professional_profile (user_id)` `on delete restrict`; **`unique`** (uma assinatura por profissional nesta etapa; pergunta 280) |
| `mode` | `text not null default 'manual'` | `check (mode in ('cartao_recorrente','manual'))` (necessário a CA-H045-11) |
| `cancel_at_period_end` | `boolean not null default false` | |
| `canceled_at` | `timestamptz` | `check (canceled_at is null or cancel_at_period_end)` |
| `created_at` | `timestamptz not null default clock_timestamp()` | |

Sem `plan_id`, `provider*`, `status_provider`, `auto_renew_*`: H-046/H-047 acrescentam por `alter table` (compatível: colunas nulas ou com default). Sem coluna de estado.

### 3.4 Plano B para a exclusão (dec. 276)

Se o `create table ... exclude using gist` falhar no DEV (`[NÃO VERIFICADO]`), trocar por um gatilho `BEFORE INSERT` em `access_grant` que, com `pg_advisory_xact_lock(hashtextextended(professional_id::text, 0))`, recusa se existir pago `ativa` do mesmo profissional com `tstzrange(...) && tstzrange(new...)`. O advisory lock é obrigatório para fechar a corrida entre duas inserções concorrentes (a restrição de exclusão já é segura sozinha). O teste CA-H045-09 é o mesmo nas duas variantes; o DEV registra qual foi usada no cabeçalho da migração.

### 3.5 Imutabilidade (dec. 275, CA-H045-08)

Função de gatilho `private.access_grant_guard()` (`security invoker`, `search_path = ''`):
- `BEFORE UPDATE`: recusa se mudar qualquer coluna além de `status` e `revoked_at`; recusa `status` diferente da transição `ativa` para `revogada`; recusa `revogada` para `ativa`; exige `revoked_at` preenchido na transição. Mensagens fixas (`access_grant_imutavel`, `access_grant_transicao_invalida`).
- `BEFORE DELETE` e `BEFORE TRUNCATE` (por instrução): recusa sempre (`access_grant_sem_delete`).
- `BEFORE UPDATE` em `billing.subscription` não é restrito aqui (H-047/H-052 definem); apenas `professional_id` não pode mudar `[PROPOSTA]`.

Revogação (única escrita de H-045): `private.access_grant_revoke(p_grant_id uuid, p_actor_ref text, p_actor_role text, p_reason_code text, p_correlation_id uuid default null) returns boolean`, `security definer`, `search_path = ''`: trava a linha (`for update`); se já `revogada` devolve `false` (idempotente, sem nova auditoria); senão atualiza `status`/`revoked_at = clock_timestamp()` e chama `private.audit_append(p_actor_ref, p_actor_role, 'billing.access_grant.revoke', 'access_grant', p_grant_id, before, after, p_reason_code, p_correlation_id)` **na mesma transação**: falha de auditoria desfaz a revogação (#19). `before`/`after` só com `type`, `status`, `starts_at`, `ends_at` (sem identidade nem pagamento). Revogação não retroage no calendário: a função passa a ignorar a linha para qualquer `at` (pergunta 286).

### 3.6 RLS e privilégios (dec. 277, CA-H045-14)

- `alter table billing.access_grant enable row level security; ... force row level security;` idem `billing.subscription`. **Nenhuma política** para `app_api`/`anon`/`authenticated`: negação por padrão, mesmo se um grant escapar.
- `revoke all on billing.access_grant, billing.subscription from public, anon, authenticated, service_role, app_api;`
- `grant select on billing.access_grant, billing.subscription to app_system;` (apenas leitura). INSERT/UPDATE para `app_system` chegam com as migrações dos escritores (H-044, H-049, H-052), pelo princípio do privilégio mínimo (pergunta 282). Testes inserem como o dono da conexão do `db:test`.
- Funções: `revoke all ... from public, anon, authenticated, service_role;` `grant execute on function private.commercial_access(uuid, timestamptz) to app_api, app_system;` `grant execute on function private.access_grant_revoke(...) to app_system;` (revogação nunca pela API de usuário). Pergunta 279 sobre incluir `app_api`.
- Gatilhos e funções de gatilho: sem `execute` para ninguém além do dono.

## 4. Função `private.commercial_access` (CA-H045-03 a 07, 10 a 13, 15)

Assinatura: `private.commercial_access(p_professional_id uuid, p_at timestamptz) returns table (estado text, access_until timestamptz)`. O nome do parâmetro é `p_at` (evita colisão com a palavra `AT`); a porta de domínio o chama `at`.

Propriedades: `language sql`, `stable`, `security definer`, `set search_path = ''`, tudo qualificado por esquema. **Sem `default now()` em `p_at` e sem referência a `now()`, `clock_timestamp()` ou `current_timestamp` no corpo** (relógio injetado: o chamador sempre informa o instante; CA-H045-05). Sempre devolve exatamente uma linha (select agregado sem `from` de linhas). Só duas colunas (CA-H045-15).

Corpo (referência; o DEV pode refatorar mantendo a semântica):

```sql
with g as (
  select type, starts_at, ends_at
    from billing.access_grant
   where professional_id = p_professional_id
     and status = 'ativa'
     and type in ('trial', 'paid')
),
c as (
  select coalesce((select s.cancel_at_period_end
                     from billing.subscription s
                    where s.professional_id = p_professional_id), false) as cancelada
),
pn as (select max(ends_at) as e from g where type = 'paid'  and starts_at <= p_at and p_at < ends_at),
pe as (select max(ends_at) as e from g where type = 'paid'  and ends_at <= p_at),
tn as (select max(ends_at) as e from g where type = 'trial' and starts_at <= p_at and p_at < ends_at),
te as (select max(ends_at) as e from g where type = 'trial' and ends_at <= p_at)
select
  case
    when pn.e is not null and c.cancelada then 'cancelada_com_acesso_ate_fim_do_periodo'
    when pn.e is not null                 then 'ativa'
    when pe.e is not null and not c.cancelada
         and p_at < pe.e + interval '72 hours' then 'em_carencia'
    when tn.e is not null                 then 'trial_ativo'
    when pe.e is not null and (te.e is null or pe.e >= te.e) then 'expirada'
    when te.e is not null                 then 'trial_expirado'
    else 'sem_acesso'
  end as estado,
  case
    when pn.e is not null then pn.e
    when pe.e is not null and not c.cancelada
         and p_at < pe.e + interval '72 hours' then pe.e + interval '72 hours'
    when tn.e is not null then tn.e
    else null
  end as access_until
from c, pn, pe, tn, te;
```

Ordem de precedência (dec. 267, 269): (1) pago vigente (cancelado ou não); (2) carência do pago mais recente já terminado, só se a assinatura não está cancelada; (3) trial vigente; (4) expirado: pago terminado mais recente (empate favorece `expirada`), depois trial terminado, senão `sem_acesso`. "Pago antes de trial" vale também para a carência (um trial vigente não encobre a carência de um pago). Carência: `[ends_at, ends_at + 72 h)`; em `ends_at + 72 h` exatos o resultado é `expirada`. Trial terminado nunca produz `em_carencia`. `adjustment` e `revogada` ignorados (dec. 272). Pix pendente não tem linha, logo não estende nada (B-06). `access_until` é nulo para `expirada`, `trial_expirado` e `sem_acesso` (pergunta 283).

Observações:
- `cancel_at_period_end` é lido por profissional (a assinatura é única, §3.3). Se o profissional reassina após cancelar, H-049/H-052 devem zerar o flag; registrar nas Issues #62 e H-052 (pergunta 281). O defeito inverso (flag preso em `true` mostrar `cancelada_...` para um período novo) é o risco aceito.
- Não há conversão de fuso nem aritmética de mês (RN-H045-10): só comparação de instantes e soma de 72 horas exatas.
- Consulta a `at` passado é permitida e determinística (dado o livro atual).
- A função não lê `professional_profile`, logo não verifica aprovação (dec. 274) e não devolve dado pessoal (RN-H045-11).

## 5. Relógio injetado e ausência de job

- O instante vem sempre do chamador: o adaptador recebe um `Clock` do domínio (`now(): Date`), converte para ISO-8601 e passa como parâmetro posicional. Nenhum SQL de H-045 chama o relógio do banco.
- Nenhuma tabela de job, `ops.job_*`, `cron.schedule` ou gatilho de tempo é criado ou alterado; expirar é comparação na leitura (P4, RN-H045-01). Um tick atrasado não muda resultado.
- H-045 **não** cria evento de outbox nem notificação (R8, R9): lembretes são H-099.

## 6. Domínio e adaptador (nomes de arquivo)

**`packages/domain/src/billing/`** (lógica pura, sem I/O):
- `types.ts`: `ESTADOS_ACESSO_COMERCIAL` (os 7 valores, `as const`), tipo `EstadoAcessoComercial`, `AcessoComercial = { estado; accessUntil: Date | null }`, constantes `CARENCIA_HORAS = 72` e `TRIAL_DIAS = 14`.
- `commercial-access.ts`: porta `CommercialAccessPort { read(professionalId: string, at: Date): Promise<AcessoComercial> }`, porta `Clock { now(): Date }`, classe `CommercialAccessError` (códigos fixos) e a função `lerAcessoComercial(port, clock, professionalId)` que injeta `clock.now()`. Sem regra de negação: **consumidores (H-042, H-055, H-074) decidem o que cada estado permite** (R4, RN-H045-06).
- `index.ts`: barril (`export * from './types.js'; export * from './commercial-access.js'`).
- Barril de topo: acrescentar `export * from './billing/index.js'` em `packages/domain/src/index.ts` (apenas listado; o DEV edita).

**`packages/db/src/`**:
- `commercial-access.ts`: `createPgCommercialAccess(client: SqlClient): CommercialAccessPort`. Executa `select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)` com parâmetros posicionais (nunca SQL montado com dado de entrada, como `retention-store.ts`). Valida que o `estado` retornado pertence aos 7 valores (senão erro `acesso_comercial_invalido`). Qualquer falha do banco vira `CommercialAccessError('acesso_comercial_indisponivel')` sem expor mensagem do banco.
- Barril: acrescentar `export * from './commercial-access.js'` em `packages/db/src/index.ts` (apenas listado).
- Documentação: atualizar `09-MODELO-DADOS.md` §3.10 (retirar `grace_until`, acrescentar `revoked_at`, `created_at`, `mode`, nota "sem FK em `identity_id` e `source_payment_id` até H-040/H-047") e `08` §8.5/§6 com a fronteira `T1 + 72 h = expirada` (dec. 267) e remover o "inclusive" de B-01 em `11-ARQ-RISCOS-E-TESTES.md` §9b.

## 7. Segurança

- **Mínimo privilégio:** tabelas fechadas por RLS forçada sem política; só `app_system` lê; execução de `commercial_access` só nos papéis de servidor; revogação só `app_system`. CA-H045-14 prova por consulta ao catálogo (`has_table_privilege`, `has_function_privilege`) para `anon`, `authenticated`, `service_role` (e `app_api` nas tabelas).
- **SECURITY DEFINER seguro:** `search_path = ''`, nomes qualificados, `revoke ... from public` antes do `grant`, dono sem permissão de escrita em runtime.
- **Privacidade:** a função devolve só `estado` e `access_until`. O estado revela situação financeira; consumidores que servem clientes (H-055) devem expor no máximo "disponível/indisponível", nunca o estado nem `access_until` (registrar na Issue #68). Isso é obrigação do consumidor, não desta história.
- **IDOR:** a função responde para qualquer `professional_id`. Quem chama a partir de uma rota deve autorizar o profissional dono ou o consumidor legítimo antes (a API, não o banco, decide).
- **Sem segredo, sem rede:** nada de Mercado Pago, e-mail ou chave. Fixtures com marcador sintético (R6): `app_user.email` em `@example.test` e `source_payment_id`/`identity_id` gerados por `randomUUID()`; todos os testes dentro de transação desfeita ao final, de modo que nada persiste no DEV.
- **Auditoria (#19):** revogação audita na mesma transação; criação de concessões é auditada pelos escritores (H-044/H-049) no momento em que têm ator (gatilho de banco não conhece o ator; pergunta 284). H-045 não grava `audit` ao ser lida (leitura de função não gera evento).

## 8. Plano de testes

Arquivos (nomes): `packages/db/tests/commercial-access.dbtest.mjs` (banco), `packages/db/tests/commercial-access-migration.test.mjs` (verificação estática do SQL, roda sem banco), `packages/db/src/commercial-access.test.ts` (adaptador com cliente falso), `packages/domain/src/billing/commercial-access.test.ts` (porta, relógio e constantes). Execução local: `corepack pnpm db:test` e `corepack pnpm test`; a evidência (comando, contagem, código de saída) vai na Issue (CA-H045-17). Os testes de banco rodam com o DEV exclusivo (R-DEV-1) e dentro de transação com rollback.

Instantes de referência: `T0` e `T1 = T0 + 30 dias`, `T2 = T1 + 30 dias`. Fixtures: `app_user` + `professional_profile` sintéticos; `access_grant` e `subscription` inseridos diretamente.

| ID | Cobre | O que verifica |
|---|---|---|
| T-01 | CA-H045-01 | 3 inserções inválidas recusadas (`type`, `status`, `ends_at <= starts_at`), 1 válida aceita; trial com duração diferente de 14 dias recusado; `paid` sem `source_payment_id` recusado |
| T-02 | CA-H045-02 | segundo trial da mesma `identity_id` recusado (inclusive após revogar o primeiro); `paid` e `adjustment` da mesma identidade aceitos |
| T-03 | CA-H045-03 | 7 fixtures, 1 por estado, com `estado` e `access_until` exatos (nulo onde a §4 diz) |
| T-04 | CA-H045-04 | 9 verificações de fronteira: trial `starts_at`/`ends_at`, pago `starts_at`/`ends_at`, carência `ends_at + 72 h`, em −1 s, exato, +1 s |
| T-05 | CA-H045-05 | mesmo `at`, duas chamadas com 2 s de intervalo real, resultado idêntico; inspeção estática: corpo sem `now()`/`clock_timestamp()`/`current_timestamp` e sem `default` em `p_at` |
| T-06 | CA-H045-06 | `pg_proc`/catálogo de jobs sem linhas novas (`cron.job` se existir, `ops` sem job de acesso); fixture vencida sem tick devolve `em_carencia`/`expirada` |
| T-07 | CA-H045-07 | `provolatile = 's'`; contagem e soma de conferência das duas tabelas iguais antes e depois |
| T-08 | CA-H045-08 | repetir `source_payment_id` recusado; `UPDATE` de `starts_at`/`ends_at`/`type`/`professional_id` recusado; `DELETE` e `TRUNCATE` recusados; `revogada` para `ativa` recusado; estado idêntico depois |
| T-09 | CA-H045-09 | sobreposição parcial e total de pagas recusadas; contígua `[T1,T2)` aceita; sobreposição com paga `revogada` aceita; duas inserções concorrentes (duas conexões) → só uma entra |
| T-10 | CA-H045-10 | pago `ends_at=T`: `T+71h59m59s` = `em_carencia`; `T+72h` = `expirada`; trial terminado: `T+1h` e `T+72h` = `trial_expirado` |
| T-11 | CA-H045-11 | mesma fixture com `mode='cartao_recorrente'` e `mode='manual'`, saída idêntica |
| T-12 | CA-H045-12 | com `cancel_at_period_end`: `ends_at−1 s` = `cancelada_com_acesso_ate_fim_do_periodo` (`access_until = ends_at`); `ends_at` e `+1 h` = `expirada` |
| T-13 | CA-H045-13 | `[T0,T1)` + `[T1,T2)`: `T1+60h` = `ativa`, `access_until=T2`; `[T0,T1)` + `[T1+73h,T2)`: `T1+72h` = `expirada`, `T1+73h` = `ativa` |
| T-14 | CA-H045-14 | `has_table_privilege`/`has_function_privilege` negam `anon`, `authenticated`, `service_role` (e `app_api` nas tabelas); `app_system` só lê; `relrowsecurity` e `relforcerowsecurity` verdadeiros; zero políticas |
| T-15 | CA-H045-15 | `pg_get_function_result` devolve apenas `estado` e `access_until` |
| T-16 | CA-H045-16 | nenhuma coluna `text` com CHECK de estado nem coluna chamada `estado` nas tabelas de `billing` e em `professional_profile` |
| T-17 | CA-H045-17 | linha de execução local registrada na Issue; testes sem rede |
| T-18 | dec. 272/275/#19 | `adjustment` e `revogada` ignorados; `access_grant_revoke` audita (`audit` ganha 1 evento), é idempotente (2ª chamada = `false`, sem 2º evento) e falha de auditoria desfaz a revogação |
| T-19 | dec. 269 | trial vigente + pago vigente = `ativa`; trial vigente + pago em carência = `em_carencia` |
| T-20 | porta/adaptador | adaptador usa parâmetros posicionais, converte data, rejeita estado fora dos 7, mapeia erro do banco para código fixo; `lerAcessoComercial` usa o relógio injetado |

Casos B:

| Caso | Teste | Cobertura em H-045 |
|---|---|---|
| B-01 | T-04 + T-10 (`ativa` em `T1−1 s`; `em_carencia` em `T1`; `em_carencia` em `T1+71h59m59s`; `expirada` em `T1+72h`) | Total |
| B-02 | T-11 (modo `cartao_recorrente`, igual a B-01) | Total; falha da cobrança é H-048 |
| B-03 | T-13 primeira parte | Total na leitura |
| B-04 | T-13 segunda parte | Total na leitura |
| B-05 | T-08 (unicidade) | Parcial; concorrência e fora de ordem em H-048 |
| B-06 | T-03/T-04 sem linha de concessão: nada estende | Parcial; registro pendente é H-047 |
| B-07 | T-10 trial; sem assinatura criada: depende de H-044 | Total na função |
| B-08 | T-12 | Total na função |

## 9. Riscos e pendências

- **R-A1 (exclusão `btree_gist`):** compilação da restrição no DEV `[NÃO VERIFICADO]`; plano B no §3.4.
- **R-A2 (`identity_id` sem origem):** a coluna não existe em nenhuma migração; H-044/H-040 definem de onde vem. H-045 só guarda e garante unicidade (pergunta 289).
- **R-A3 (flag de cancelamento por profissional):** pode mostrar `cancelada_...` para um período novo se H-049/H-052 não limparem o flag (pergunta 281).
- **R-A4 (revogação retroage):** rever só se surgir necessidade de histórico temporal (pergunta 286).
- **R-A5 (desempenho):** a função lê um índice parcial por profissional; em listas (H-055) chamar em lote ou por junção lateral. Medir com `explain` no DEV com uma massa sintética em transação; não é gate desta história.
- **R-A6 (shape de `audit_append`):** o DEV lê `p_actor_role` aceito e a regra de chaves proibidas antes de implementar a revogação.
- **Ordem de entrega:** a migração antes do domínio e do adaptador; nenhum consumidor começa antes de H-045 estar pronta (H-042 #55, H-044 #57, H-046 #59, H-049 #62, H-055 #68, H-074).
- Nada aqui toca produção, Mercado Pago, e-mail ou GitHub.

## 10. Perguntas ao líder (a partir de 279; lista única)

**279. Papéis com EXECUTE em `commercial_access`.** A dec. 277 diz "papel de aplicação do servidor". (a) `app_api` e `app_system`; (b) só `app_system` (como a H-031).
- **Recomendação:** (a). As listas de H-055 e as guardas de H-042 rodam na API em nome de um principal e precisam executar a função sem passar por `app_system`. A leitura direta das tabelas continua negada. Destrava a migração e T-14.

**280. `subscription` com `unique (professional_id)` nesta etapa?** (a) sim; (b) várias linhas, função usa a mais recente.
- **Recomendação:** (a). Uma assinatura por profissional simplifica a leitura do flag; H-047 relaxa se precisar de histórico. Destrava a função e T-11/T-12.

**281. Quem zera `cancel_at_period_end` ao reassinar?** Registrar como obrigação de H-049 (#62) e H-052.
- **Recomendação:** sim, registrar nas duas Issues. Evita estado `cancelada_...` num período novo.

**282. Privilégios de escrita em `app_system`.** (a) H-045 concede só SELECT (mais `execute` da revogação); INSERT/UPDATE vêm com os escritores; (b) conceder INSERT agora.
- **Recomendação:** (a), privilégio mínimo.

**283. `access_until` nulo em `expirada`, `trial_expirado` e `sem_acesso`?**
- **Recomendação:** sim (não há mais acesso a datar). O refino deixava só `sem_acesso` explícito.

**284. Auditoria da criação de concessões.** (a) a cargo dos escritores H-044/H-049 (têm ator); H-045 audita só a revogação; (b) gatilho de banco audita toda inserção com ator `system`.
- **Recomendação:** (a). Sem outbox em H-045 (R8). Destrava T-18.

**285. Colunas além da `09` §3.10:** `revoked_at`, `created_at` em `access_grant`; `mode`, `created_at` em `subscription`; atualizar a `09`.
- **Recomendação:** sim. `mode` é necessário a CA-H045-11; `revoked_at` espelha `withdrawn_at` do aceite.

**286. Revogação retroage na função?** A linha `revogada` é ignorada para qualquer `at`.
- **Recomendação:** sim, por simplicidade; reabrir só se aparecer necessidade de histórico (auditoria guarda o fato).

**287. `paid` exige `source_payment_id` (CHECK), sem FK até H-047?**
- **Recomendação:** sim. Sustenta a idempotência de I-20 e CA-H045-08; H-047 acrescenta a FK para `billing.payment`.

**288. Trial de 14 dias por CHECK exato (336 h)?** O CHECK usa `ends_at - starts_at = interval '14 days'` (imutável). Se um dia o fuso/horário de verão voltar, o CHECK exigiria revisão.
- **Recomendação:** sim, o Brasil não tem horário de verão e a regra fica no banco.

**289. Origem de `identity_id`.** Nenhuma migração cria `identity_id` (nem em `professional_profile`). H-045 guarda `uuid not null` sem FK; a origem (H-040/HMAC do documento) é de quem grava (H-044). Confirmar que H-044 recebe essa obrigação e que a FK entra quando a coluna existir.
- **Recomendação:** sim. Destrava T-02 (fixtures usam UUID sintético).

## 11. Próximos passos

1. Líder responde 279 a 289 (lista única) e registra em `11-DECISOES.md`.
2. Mover #58 para Desenvolvimento só após conferir a coluna no quadro.
3. DEV confere os pontos `[NÃO VERIFICADO]` (§3.4, R-A6) antes de escrever a migração e registra a variante usada.
4. Code Review verifica o corpo da função contra a §4, os privilégios (T-14) e a ausência de relógio/job (T-05/T-06).
