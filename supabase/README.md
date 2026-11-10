# supabase/

Migracoes SQL versionadas (`migrations/`), desfazimentos manuais (`rollbacks/`), futuro `seed.sql`
(dados sinteticos) e testes de catalogo em `packages/db/tests/` (plano tecnico 19 §1, ajuste 1:
fica na raiz). Sem Docker: o desenvolvimento usa o projeto Supabase na nuvem (gratuito).

## Convencoes

- Nome: `AAAAMMDDHHMMSS_<modulo>_<verbo>_<objeto>.sql`; um arquivo por mudanca; idempotente
  (`if not exists`); nunca editar migracao ja aplicada; expand/contract (contrair em PR posterior).
- Desfazer, quando possivel: `rollbacks/<mesmo nome>.down.sql`, executado manualmente.
- Toda tabela nos esquemas `app`, `billing`, `audit`, `ops`, `private` habilita e forca RLS na
  mesma migracao e so recebe grants minimos para `app_api`/`app_system` (nunca `anon`,
  `authenticated` ou `PUBLIC`). Verificado por `pnpm db:test`.
- Executor: `packages/db/scripts/db.mjs` (usa `pg` fixado). Conexao: `DATABASE_URL_MIGRATIONS`
  (ambiente ou `.env.local`). Nenhum valor e impresso.

## Estado (H-003)

Migracao `20261110120000_platform_create_baseline.sql`: extensoes `postgis`, `pg_trgm`,
`unaccent`, `citext`, `btree_gist` (esquema `extensions`); esquemas `app`, `billing`, `audit`,
`ops`, `private`; tabela de controle `ops.schema_migration` (RLS habilitada e forcada); revoke de
`PUBLIC`/`anon`/`authenticated`/`service_role` nos esquemas do produto e nos privilegios padrao;
papeis `app_api` (sem BYPASSRLS) e `app_system` (BYPASSRLS), ambos `NOLOGIN` e sem senha.

## Estado (H-006)

Migracao `20261110140000_audit_create_event_chain.sql`: `audit.audit_event` (hash SHA-256
encadeado, selado pelo trigger `tg_event_seal`), `audit.chain_head`, `audit.action_catalog` (5 acoes
semeadas), funcoes `private.audit_append` (unica porta de escrita, SECURITY DEFINER) e
`private.audit_verify_chain`. Append-only: sem privilegio de alteracao, triggers `ENABLE ALWAYS`
(erro `AU001`) e deteccao por hash. Estado sem PII (erro `AU002`). Desenho:
`docs/factory/23-DESENHO-H006.md`. Os testes `audit.dbtest.mjs` usam so transacao com rollback
(a auditoria do banco compartilhado nao pode ser apagada); precisam de `pnpm build` em `packages/db`
(importam o espelho TypeScript compilado).

## Pendencias

1. Login e senha de `app_api`/`app_system`: passo manual fora das migracoes, lendo as variaveis
   `DB_PASSWORD_APP_API` e `DB_PASSWORD_APP_SYSTEM`; depende do pooler (usuario `papel.<ref>`) e
   do teste de `set_config` por transacao (S-02.5 / S-09).
2. `pg_cron` e `pg_net`: ficam para o spike S-10. `pgtap`: nao habilitado (testes em Node).
3. CI de banco: `ci-db.yml` desativado; host direto e IPv6 e o pooler esta pendente. Nao ha banco
   efemero: os testes sao somente leitura ou usam transacao com rollback.
4. Dados de dominio e seed sintetico: historias seguintes (H-005 em diante).
5. Auditoria (H-006): os testes T-21 (`40001` em REPEATABLE READ) e T-23 (estresse com 20 commits)
   exigem COMMIT e ficam `skip` (rodam com `AUDIT_ALLOW_COMMIT=1` apenas em banco descartavel);
   dependem de um CI de banco (`ci-db.yml`, item 3).
