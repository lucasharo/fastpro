-- H-108 (Issue 117) | Painel operacional minimo: tabela de metricas agregadas ops.ops_metric, funcao de escrita
-- private.ops_metric_incr, funcao de leitura private.ops_panel_read e a permissao ops.panel.read
-- (docs/factory/76-DESENHO-H108.md §1.2, §2; Q-D108-1 a Q-D108-3 com as recomendacoes).
-- Idempotente. Desfazer: supabase/rollbacks/20261111430000_ops_create_ops_metric_panel.down.sql.
-- ESCRITA, NAO APLICADA: esta migracao so entra no banco em etapa propria (banco de desenvolvimento).
-- Depende de 20261111220000 (app.admin_permission, app.admin_role_permission) e de 20261111120000
-- (ops.email_outbox, ops.external_quota). O painel le a fila e a cota direto dessas tabelas.
--
-- Sem PII por construcao (CA-H108-14): lista fechada de metric_key (CHECK), dimension so com codigo
-- (regex), sem coluna de identificador, texto livre ou jsonb. Nenhum emissor e ligado aqui: webhook,
-- upload e RLS sao das historias donas (76 §1.2).
-- Convencao: webhook_pendente_idade grava a idade em SEGUNDOS no campo max_ms (um unico valor por ponto).
-- Postura igual a H-092 e H-073: RLS forcada, sem politicas; nenhum privilegio direto na tabela; so
-- app_system executa as funcoes. Leitura so por funcao (security definer, search_path vazio).
-- Tempo: relogio do banco; o periodo de cota e calculado em UTC no banco (R-5 da 76 §3).

-- 1. ops.ops_metric: uma linha por (metrica, hora UTC, dimensao de codigo) -----------------------------
create table if not exists ops.ops_metric (
  metric_key   text        not null
                 check (metric_key in ('webhook_falha', 'webhook_latencia', 'webhook_pendente_idade',
                                       'foto_upload_falha', 'foto_reencode_falha', 'rls_negacao')),
  bucket_start timestamptz not null,
  dimension    text        not null default ''
                 check (dimension ~ '^([a-z][a-z0-9_]{0,39})?$'),
  value        bigint      not null default 0 check (value >= 0),
  sum_ms       bigint      check (sum_ms is null or sum_ms >= 0),
  max_ms       bigint      check (max_ms is null or max_ms >= 0),
  constraint ops_metric_pkey primary key (metric_key, bucket_start, dimension)
);

comment on table ops.ops_metric is
  'Metrica operacional agregada por hora (H-108, 76 §1.2). Sem identificador, sem texto livre, sem jsonb.';

alter table ops.ops_metric enable row level security;
alter table ops.ops_metric force row level security;

-- 2. Escrita: upsert com soma; so por funcao ---------------------------------------------------------
-- Hora truncada no banco; soma o valor e o tempo, e guarda o maior valor observado.
create or replace function private.ops_metric_incr(
  p_metric_key text, p_dimension text, p_at timestamptz,
  p_value bigint, p_sum_ms bigint, p_max_ms bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_metric_key is null or p_at is null or p_value is null or p_value < 0 then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;

  insert into ops.ops_metric (metric_key, bucket_start, dimension, value, sum_ms, max_ms)
  values (p_metric_key, date_trunc('hour', p_at), coalesce(p_dimension, ''), p_value, p_sum_ms, p_max_ms)
  on conflict (metric_key, bucket_start, dimension) do update
     set value  = ops.ops_metric.value + excluded.value,
         sum_ms = case when ops.ops_metric.sum_ms is null and excluded.sum_ms is null then null
                       else coalesce(ops.ops_metric.sum_ms, 0) + coalesce(excluded.sum_ms, 0) end,
         max_ms = greatest(ops.ops_metric.max_ms, excluded.max_ms);
end
$$;

-- 3. Leitura do painel: um jsonb com o agregado; nenhuma linha bruta --------------------------------
-- Fila: contagem por estado, idade do pendente mais antigo e falhas por codigo (ops.email_outbox).
-- Cotas: linhas do periodo corrente de e-mail e Mapbox (ops.external_quota). Metricas: ultimas 24 h.
create or replace function private.ops_panel_read(p_now timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now       timestamptz := coalesce(p_now, now());
  v_dia       date := (v_now at time zone 'UTC')::date;
  v_mes       date := date_trunc('month', v_now at time zone 'UTC')::date;
  v_mais_antigo timestamptz;
  v_idade     bigint;
  v_estado    jsonb;
  v_falhas    jsonb;
  v_cotas     jsonb;
  v_metricas  jsonb;
begin
  select coalesce(jsonb_object_agg(s.estado, s.n), '{}'::jsonb) into v_estado
    from (select e.state as estado, count(*) as n from ops.email_outbox e group by e.state) s;

  select min(e.created_at) into v_mais_antigo from ops.email_outbox e where e.state = 'pendente';
  v_idade := case when v_mais_antigo is null then null
                  else greatest(0, floor(extract(epoch from (v_now - v_mais_antigo))))::bigint end;

  select coalesce(jsonb_object_agg(s.codigo, s.n), '{}'::jsonb) into v_falhas
    from (select e.reason_code as codigo, count(*) as n
            from ops.email_outbox e
           where e.state = 'falha' and e.reason_code is not null
           group by e.reason_code) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'servico', q.service, 'periodo', q.period, 'usado', q.used, 'limite', q.hard_limit,
           'alerta', q.alert_level, 'alertado_em', q.alerted_at)
         order by q.service, q.period), '[]'::jsonb) into v_cotas
    from ops.external_quota q
   where q.service in ('email', 'mapbox_permanent', 'mapbox_geocoding_temp')
     and ((q.period = 'dia_utc' and q.period_start = v_dia)
          or (q.period = 'mes' and q.period_start = v_mes));

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', m.metric_key, 'dimensao', m.dimension, 'n', m.n,
           'soma_ms', m.soma_ms, 'max_ms', m.max_ms)
         order by m.metric_key, m.dimension), '[]'::jsonb) into v_metricas
    from (select o.metric_key, o.dimension, sum(o.value) as n, sum(o.sum_ms) as soma_ms, max(o.max_ms) as max_ms
            from ops.ops_metric o
           where o.bucket_start > v_now - interval '24 hours' and o.bucket_start <= v_now
           group by o.metric_key, o.dimension) m;

  return jsonb_build_object(
    'fila', jsonb_build_object(
      'por_estado', v_estado,
      'idade_pendente_s', v_idade,
      'falhas_por_codigo', v_falhas),
    'cotas', v_cotas,
    'metricas', v_metricas);
end
$$;

-- 4. Permissao do painel: so o Superadmin (Q-D108-2; 76 §2). Nenhum outro papel recebe a permissao. --
insert into app.admin_permission (code, label) values
  ('ops.panel.read', 'Ver painel operacional')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('superadmin', 'ops.panel.read')
on conflict do nothing;

-- 5. Privilegios: ninguem le ou escreve a tabela direto; so app_system executa as duas funcoes ------
revoke all on ops.ops_metric from public, anon, authenticated, service_role, app_api;

revoke all on function
  private.ops_metric_incr(text, text, timestamptz, bigint, bigint, bigint),
  private.ops_panel_read(timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.ops_metric_incr(text, text, timestamptz, bigint, bigint, bigint),
  private.ops_panel_read(timestamptz)
  to app_system;
