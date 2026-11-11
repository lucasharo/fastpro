-- H-021 | Coordenada permanente, uma chamada na publicacao (docs/factory/68-DESENHO-H021.md, §2.1 a §2.3).
-- Idempotente. Desfazer: supabase/rollbacks/20261111370000_geo_create_geocode_point.down.sql.
-- Cria a unica tabela com coordenada exata (app.geocode_point, I-28) e o teto por pedido (app.geocode_budget).
-- Os CHECKs impedem coordenada sem o selo permanente, mesmo por SQL direto (CA-4, G-05).
-- Esta fatia NAO cria as funcoes de reserva e de gravacao (geo_reserve, geo_store_permanent): entram na
-- proxima fatia de H-021 e sao a unica via de escrita. Ate la nenhum papel recebe DML nestas tabelas.
-- A cota mensal (ops.external_quota, servico 'mapbox_permanent') nao muda aqui: a linha nasce na primeira reserva.

create table if not exists app.geocode_point (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null check (subject_kind in ('request', 'professional_base')),
  subject_id    uuid not null,
  address_hash  text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  state         text not null check (state in ('aguardando', 'reservado', 'ok', 'sem_resultado')),
  exact_point   extensions.geography(Point, 4326),
  geocode_mode  text check (geocode_mode is null or geocode_mode = 'permanent'),
  precision     text check (precision in ('endereco', 'rua', 'bairro', 'localidade')),
  reserved_at   timestamptz,
  geocoded_at   timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  constraint geocode_point_subject_hash_key unique (subject_kind, subject_id, address_hash),
  -- is not distinct from: com geocode_mode nulo a comparacao seria nula e o CHECK aceitaria (nulo passa).
  constraint geocode_point_selo_permanente check (exact_point is null or geocode_mode is not distinct from 'permanent'),
  constraint geocode_point_estado_ponto check ((state = 'ok') = (exact_point is not null)),
  constraint geocode_point_precisao_ok check (state <> 'ok' or precision is not null),
  constraint geocode_point_caixa_brasil check (
    exact_point is null
    or (extensions.st_x(exact_point::extensions.geometry) between -74.0 and -34.0
        and extensions.st_y(exact_point::extensions.geometry) between -34.0 and 6.0)
  )
);
comment on table app.geocode_point is
  'Coordenada exata de pedido ou base (H-021, I-28). Unica tabela com ponto. Escrita so por funcao.';

create table if not exists app.geocode_budget (
  subject_kind  text not null check (subject_kind in ('request', 'professional_base')),
  subject_id    uuid not null,
  calls         smallint not null default 0 check (calls >= 0),
  constraint geocode_budget_pkey primary key (subject_kind, subject_id),
  constraint geocode_budget_teto_pedido check (subject_kind <> 'request' or calls <= 3)
);
comment on table app.geocode_budget is
  'Chamadas permanentes por assunto (teto de 3 por pedido, decisao 29; H-021). Escrita so por funcao.';

-- Postura (igual H-005 e H-020): RLS habilitada e forcada, sem politicas, sem DML para nenhum papel.
alter table app.geocode_point  enable row level security;
alter table app.geocode_point  force row level security;
alter table app.geocode_budget enable row level security;
alter table app.geocode_budget force row level security;

-- app_backup_reader recebe SELECT por privilegio padrao do schema app; a leitura direta e revogada (desenho §2.3).
revoke all on app.geocode_point, app.geocode_budget
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;
