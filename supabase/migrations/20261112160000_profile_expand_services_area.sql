-- H-036 | Perfil profissional: servicos, base e raio (docs/factory/99-DESENHO-H036.md, §3, §4; decisoes 109 a 116).
-- Idempotente. Desfazer: supabase/rollbacks/20261112160000_profile_expand_services_area.down.sql.
-- Natureza: so tabelas e funcoes novas, mais uma chave semeada em ops.app_config. Nenhuma coluna existente muda,
-- nenhum dado e preenchido e nenhum codigo atual quebra. Unica via de escrita: funcoes security definer com
-- search_path vazio; o execute fica so com app_system. Nenhum papel recebe DML nem SELECT direto nas tabelas.
-- Endereco e coordenada: a base usa app.geocode_point (#34); esta migracao nao cria nem altera ponto algum.

-- 0. Parametros administraveis (§3.2). Semeados sem sobrescrever: visiveis e ajustaveis sem deploy.
insert into ops.app_config (key, value, version, updated_by)
values (
  'profile.offering_limits',
  '{"change_max":3,"change_window_s":86400,"geocode_max":10,"geocode_window_s":86400,"calls_cap":40,"services_max":30,"write_max":30,"write_window_s":3600}'::jsonb,
  1,
  'migration:20261112160000')
on conflict (key) do nothing;

-- 1. Tabelas (§3.1) ------------------------------------------------------------------------------------------
-- 1a. Servico declarado pelo profissional, por modalidade ("ambos" = duas linhas; decisao 109).
create table if not exists app.professional_service (
  professional_id uuid not null references app.professional_profile (user_id) on delete restrict,
  service_id      uuid not null references app.service (id) on delete restrict,
  modality        text not null check (modality in ('presencial', 'online')),
  declared_at     timestamptz not null,
  constraint professional_service_pkey primary key (professional_id, service_id, modality)
);
create index if not exists professional_service_service_modality_idx
  on app.professional_service (service_id, modality);
comment on table app.professional_service is
  'Servicos declarados pelo profissional por modalidade (H-036, decisao 109). Escrita so por private.professional_services_save.';

-- 1b. Base e raio vigentes (um por profissional; decisoes 110 a 113). Coordenada so em geocode_point.
create table if not exists app.professional_area (
  professional_id  uuid primary key references app.professional_profile (user_id) on delete restrict,
  geocode_point_id uuid not null references app.geocode_point (id) on delete restrict,
  base_label       text not null
                     check (char_length(base_label) between 3 and 120 and base_label !~ '[[:cntrl:]]'),
  radius_m         integer not null check (radius_m between 5000 and 100000),
  valid_since      timestamptz not null,
  updated_at       timestamptz not null
);
comment on table app.professional_area is
  'Base e raio vigentes do profissional (H-036, decisoes 110 a 113). Privada: sem SELECT direto; escrita por private.professional_area_save.';

-- 1c. Historico de base e raio com "vigente desde" (decisao 110). Imutavel, exceto o fechamento de valid_to.
create table if not exists app.professional_area_history (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references app.professional_profile (user_id) on delete restrict,
  geocode_point_id uuid not null references app.geocode_point (id) on delete restrict,
  radius_m         integer not null check (radius_m between 5000 and 100000),
  valid_from       timestamptz not null,
  valid_to         timestamptz,
  change_kind      text not null check (change_kind in ('definida', 'alterada')),
  constraint professional_area_history_intervalo check (valid_to is null or valid_to > valid_from),
  constraint professional_area_history_inicio_unico unique (professional_id, valid_from)
);
create unique index if not exists professional_area_history_aberta_key
  on app.professional_area_history (professional_id) where valid_to is null;
create index if not exists professional_area_history_vigencia_idx
  on app.professional_area_history (professional_id, valid_from desc);
comment on table app.professional_area_history is
  'Historico de base e raio (H-036, decisao 110). No maximo uma linha aberta por profissional. Imutavel.';

-- 2. Parametros lidos com revalidacao por campo (molde de auth_challenge_config) -------------------------------
create or replace function private.offering_cfg_int(p_value jsonb, p_field text, p_min integer, p_max integer, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case when p_value is not null
          and jsonb_typeof(p_value -> p_field) = 'number'
          and (p_value ->> p_field)::numeric between p_min and p_max
          and (p_value ->> p_field)::numeric = trunc((p_value ->> p_field)::numeric)
         then ((p_value ->> p_field)::numeric)::integer
    end,
    p_default)
$$;

-- Ausente, invalido ou fora da faixa = padrao daquele campo (T-P10).
create or replace function private.professional_offering_limits()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'change_max',       private.offering_cfg_int(c.value, 'change_max', 1, 50, 3),
    'change_window_s',  private.offering_cfg_int(c.value, 'change_window_s', 60, 2592000, 86400),
    'geocode_max',      private.offering_cfg_int(c.value, 'geocode_max', 1, 100, 10),
    'geocode_window_s', private.offering_cfg_int(c.value, 'geocode_window_s', 3600, 2592000, 86400),
    'calls_cap',        private.offering_cfg_int(c.value, 'calls_cap', 1, 1000, 40),
    'services_max',     private.offering_cfg_int(c.value, 'services_max', 1, 200, 30),
    'write_max',        private.offering_cfg_int(c.value, 'write_max', 1, 1000, 30),
    'write_window_s',   private.offering_cfg_int(c.value, 'write_window_s', 300, 86400, 3600))
  from (select 1) s
  left join ops.app_config c on c.key = 'profile.offering_limits'
$$;

-- 3. Gatilhos (§3.1) -----------------------------------------------------------------------------------------
-- 3a. Servico: na inclusao, ativo, modalidade compativel e base para presencial. Update de chave e proibido.
create or replace function private.professional_service_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modalidade text;
  v_ativo boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'servico_chave_imutavel' using errcode = '23514';
  end if;
  select s.modality, s.active into v_modalidade, v_ativo from app.service s where s.id = new.service_id;
  if not found or v_ativo is not true then
    raise exception 'servico_indisponivel' using errcode = '23514';
  end if;
  if (v_modalidade = 'presencial' and new.modality <> 'presencial')
     or (v_modalidade = 'online' and new.modality <> 'online') then
    raise exception 'servico_modalidade_incompativel' using errcode = '23514';
  end if;
  if new.modality = 'presencial'
     and not exists (select 1 from app.professional_area a where a.professional_id = new.professional_id) then
    raise exception 'servico_presencial_sem_base' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists professional_service_regras_biu on app.professional_service;
create trigger professional_service_regras_biu
  before insert or update on app.professional_service
  for each row execute function private.professional_service_regras();

-- 3b. Base: o ponto precisa ser permanente, do proprio profissional e ter celula de #35 (CA-05, CA-06).
create or replace function private.professional_area_ponto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from app.geocode_point g
     where g.id = new.geocode_point_id
       and g.subject_kind = 'professional_base'
       and g.subject_id = new.professional_id
       and g.state = 'ok'
       and g.geocode_mode = 'permanent'
       and g.match_cell is not null
  ) then
    raise exception 'area_ponto_invalido' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists professional_area_ponto_biu on app.professional_area;
create trigger professional_area_ponto_biu
  before insert or update on app.professional_area
  for each row execute function private.professional_area_ponto();

-- 3c. Base em uso por servico presencial nao pode ser apagada (area_em_uso).
create or replace function private.professional_area_apagar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from app.professional_service ps
     where ps.professional_id = old.professional_id and ps.modality = 'presencial'
  ) then
    raise exception 'area_em_uso' using errcode = '23514';
  end if;
  return old;
end
$$;

drop trigger if exists professional_area_apagar_bd on app.professional_area;
create trigger professional_area_apagar_bd
  before delete on app.professional_area
  for each row execute function private.professional_area_apagar();

-- 3d. Historico imutavel: so valid_to passa de nulo a valor. Delete so com a flag de expurgo (§3.3).
create or replace function private.professional_area_history_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.offering_purge', true), '') = '1' then
      return old;
    end if;
    raise exception 'historico_imutavel' using errcode = '23514';
  end if;
  if old.valid_to is null and new.valid_to is not null
     and new.id = old.id
     and new.professional_id = old.professional_id
     and new.geocode_point_id = old.geocode_point_id
     and new.radius_m = old.radius_m
     and new.valid_from = old.valid_from
     and new.change_kind = old.change_kind then
    return new;
  end if;
  raise exception 'historico_imutavel' using errcode = '23514';
end
$$;

drop trigger if exists professional_area_history_guard_bud on app.professional_area_history;
create trigger professional_area_history_guard_bud
  before update or delete on app.professional_area_history
  for each row execute function private.professional_area_history_guard();

-- 4. Funcoes de escrita e de leitura (§3.2, §4) ----------------------------------------------------------------
-- 4a. Pre-verificacao antes de qualquer chamada paga (§5, passo 3). Trava o perfil; so conta quando aceita.
create or replace function private.professional_area_precheck(
  p_user uuid,
  p_write_key text,
  p_geocode_key text,
  p_will_geocode boolean,
  p_now timestamptz)
returns table (out_status text, out_retry_after integer, out_calls_cap integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := private.professional_offering_limits();
  v_status text;
  v_ok boolean;
  v_retry integer;
  v_cnt integer;
  v_oldest timestamptz;
  v_janela integer := (private.professional_offering_limits() ->> 'change_window_s')::integer;
begin
  if p_user is null or p_write_key is null or p_geocode_key is null or p_will_geocode is null or p_now is null then
    raise exception 'offering_entrada_invalida' using errcode = '22023';
  end if;

  select p.verification_status into v_status from app.professional_profile p where p.user_id = p_user for update;
  if not found then
    return query select 'sem_perfil'::text, null::integer, null::integer;
    return;
  end if;
  if v_status = 'suspensa' then
    return query select 'suspenso'::text, null::integer, null::integer;
    return;
  end if;

  select r.out_ok, r.out_retry_after into v_ok, v_retry
    from private.rl_check(p_write_key, (v_lim ->> 'write_window_s')::integer, 300, (v_lim ->> 'write_max')::integer, p_now) r;
  if not v_ok then
    return query select 'limite_escrita'::text, v_retry, null::integer;
    return;
  end if;

  select count(*)::integer, min(h.valid_from) into v_cnt, v_oldest
    from app.professional_area_history h
   where h.professional_id = p_user and h.change_kind = 'alterada'
     and h.valid_from > p_now - make_interval(secs => v_janela);
  if v_cnt >= (v_lim ->> 'change_max')::integer then
    v_retry := least(86400, greatest(1, extract(epoch from (v_oldest + make_interval(secs => v_janela) - p_now))::integer));
    return query select 'limite_mudanca'::text, v_retry, null::integer;
    return;
  end if;

  if p_will_geocode then
    select r.out_ok, r.out_retry_after into v_ok, v_retry
      from private.rl_check(p_geocode_key, (v_lim ->> 'geocode_window_s')::integer, 3600, (v_lim ->> 'geocode_max')::integer, p_now) r;
    if not v_ok then
      return query select 'limite_tentativas'::text, v_retry, null::integer;
      return;
    end if;
    perform private.rl_hit(p_geocode_key, 3600, p_now);
  end if;

  perform private.rl_hit(p_write_key, 300, p_now);
  return query select 'ok'::text, null::integer, (v_lim ->> 'calls_cap')::integer;
end
$$;

-- 4b. Gravacao atomica da base e do raio (§4.2). Trava o perfil; unica fonte da verdade do limite.
create or replace function private.professional_area_save(
  p_user uuid,
  p_point_id uuid,
  p_label text,
  p_radius_km integer,
  p_now timestamptz)
returns table (out_status text, out_retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := private.professional_offering_limits();
  v_janela integer := (private.professional_offering_limits() ->> 'change_window_s')::integer;
  v_status text;
  v_cur app.professional_area%rowtype;
  v_has boolean;
  v_point uuid;
  v_label text;
  v_radius integer;
  v_base_mudou boolean;
  v_kind text;
  v_switch timestamptz;
  v_prev_from timestamptz;
  v_cnt integer;
  v_oldest timestamptz;
  v_retry integer;
  v_antes jsonb;
  v_depois jsonb;
begin
  if p_user is null or p_now is null then
    raise exception 'offering_entrada_invalida' using errcode = '22023';
  end if;

  select p.verification_status into v_status from app.professional_profile p where p.user_id = p_user for update;
  if not found then
    return query select 'sem_perfil'::text, null::integer;
    return;
  end if;
  if v_status = 'suspensa' then
    return query select 'suspenso'::text, null::integer;
    return;
  end if;
  if p_radius_km is not null and (p_radius_km < 5 or p_radius_km > 100) then
    return query select 'raio_invalido'::text, null::integer;
    return;
  end if;

  select a.* into v_cur from app.professional_area a where a.professional_id = p_user for update;
  v_has := found;
  if not v_has and (p_point_id is null or p_label is null or p_radius_km is null) then
    return query select 'dados_incompletos'::text, null::integer;
    return;
  end if;

  v_point := coalesce(p_point_id, v_cur.geocode_point_id);
  v_label := coalesce(p_label, v_cur.base_label);
  v_radius := coalesce(p_radius_km * 1000, v_cur.radius_m);
  v_base_mudou := (not v_has) or v_point is distinct from v_cur.geocode_point_id;

  if v_base_mudou and not exists (
    select 1 from app.geocode_point g
     where g.id = v_point and g.subject_kind = 'professional_base' and g.subject_id = p_user
       and g.state = 'ok' and g.geocode_mode = 'permanent' and g.match_cell is not null
  ) then
    return query select 'ponto_invalido'::text, null::integer;
    return;
  end if;

  if v_has and not v_base_mudou and v_radius = v_cur.radius_m then
    return query select 'unchanged'::text, null::integer;
    return;
  end if;

  if v_has then
    select count(*)::integer, min(h.valid_from) into v_cnt, v_oldest
      from app.professional_area_history h
     where h.professional_id = p_user and h.change_kind = 'alterada'
       and h.valid_from > p_now - make_interval(secs => v_janela);
    if v_cnt >= (v_lim ->> 'change_max')::integer then
      v_retry := least(86400, greatest(1, extract(epoch from (v_oldest + make_interval(secs => v_janela) - p_now))::integer));
      return query select 'limite_mudanca'::text, v_retry;
      return;
    end if;
    select h.valid_from into v_prev_from
      from app.professional_area_history h
     where h.professional_id = p_user and h.valid_to is null
       for update;
    v_switch := greatest(p_now, coalesce(v_prev_from, p_now) + interval '1 microsecond');
    update app.professional_area_history
       set valid_to = v_switch
     where professional_id = p_user and valid_to is null;
    v_kind := 'alterada';
    v_antes := jsonb_build_object('radius_m', v_cur.radius_m);
  else
    v_switch := p_now;
    v_kind := 'definida';
    v_antes := null;
  end if;

  insert into app.professional_area_history (professional_id, geocode_point_id, radius_m, valid_from, valid_to, change_kind)
  values (p_user, v_point, v_radius, v_switch, null, v_kind);

  insert into app.professional_area (professional_id, geocode_point_id, base_label, radius_m, valid_since, updated_at)
  values (p_user, v_point, v_label, v_radius, v_switch, p_now)
  on conflict (professional_id) do update
     set geocode_point_id = excluded.geocode_point_id,
         base_label = excluded.base_label,
         radius_m = excluded.radius_m,
         valid_since = excluded.valid_since,
         updated_at = excluded.updated_at;

  -- Auditoria sem localizacao (§6): so raio, tipo da mudanca e se a base mudou.
  v_depois := jsonb_build_object('radius_m', v_radius, 'change_kind', v_kind, 'base_changed', v_base_mudou);
  perform private.audit_append('professional:' || p_user::text, 'professional', 'profile.area.changed',
    'professional_area', p_user, v_antes, v_depois, null, null);

  return query select v_kind, null::integer;
end
$$;

-- 4c. Substituicao do conjunto de servicos (§4.1). Itens: [{service_id, modality, idx}] expandidos pela API.
-- Compatibilidade e status ativo valem so para inclusoes novas (L-6). Serviços nao tem historico (L-2).
create or replace function private.professional_services_save(
  p_user uuid,
  p_items jsonb,
  p_now timestamptz,
  p_write_key text)
returns table (out_status text, out_index integer, out_retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := private.professional_offering_limits();
  v_status text;
  v_ok boolean;
  v_retry integer;
  v_n integer;
  v_item record;
  v_formato_ok boolean;
  v_ativo boolean;
  v_modalidade_svc text;
  v_primeiro_presencial integer;
  v_add integer;
  v_del integer;
  v_antes jsonb;
  v_depois jsonb;
begin
  if p_user is null or p_items is null or p_now is null or p_write_key is null then
    raise exception 'offering_entrada_invalida' using errcode = '22023';
  end if;

  select p.verification_status into v_status from app.professional_profile p where p.user_id = p_user for update;
  if not found then
    return query select 'sem_perfil'::text, null::integer, null::integer;
    return;
  end if;
  if v_status = 'suspensa' then
    return query select 'suspenso'::text, null::integer, null::integer;
    return;
  end if;

  select r.out_ok, r.out_retry_after into v_ok, v_retry
    from private.rl_check(p_write_key, (v_lim ->> 'write_window_s')::integer, 300, (v_lim ->> 'write_max')::integer, p_now) r;
  if not v_ok then
    return query select 'limite_escrita'::text, null::integer, v_retry;
    return;
  end if;
  perform private.rl_hit(p_write_key, 300, p_now);

  if jsonb_typeof(p_items) <> 'array' then
    return query select 'formato'::text, null::integer, null::integer;
    return;
  end if;
  v_n := jsonb_array_length(p_items);

  -- Formato de cada item: exatamente service_id (uuid), modality (presencial|online), sem repeticao.
  for v_item in select e.value as valor, e.ord as ordem from jsonb_array_elements(p_items) with ordinality e(value, ord) loop
    v_formato_ok := false;
    if jsonb_typeof(v_item.valor) = 'object' then
      -- Duas condicoes separadas: jsonb_object_keys so pode rodar sobre objeto (evita erro por ordem de OR).
      v_formato_ok := (select count(*) from jsonb_object_keys(v_item.valor)) = 2
        and v_item.valor ? 'service_id' and v_item.valor ? 'modality'
        and jsonb_typeof(v_item.valor -> 'service_id') = 'string'
        and jsonb_typeof(v_item.valor -> 'modality') = 'string'
        and (v_item.valor ->> 'service_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (v_item.valor ->> 'modality') in ('presencial', 'online');
    end if;
    if not v_formato_ok then
      return query select 'formato'::text, (v_item.ordem - 1)::integer, null::integer;
      return;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
     group by e ->> 'service_id', e ->> 'modality' having count(*) > 1
  ) then
    return query select 'formato'::text, null::integer, null::integer;
    return;
  end if;

  if (select count(distinct e ->> 'service_id') from jsonb_array_elements(p_items) e)
     > (v_lim ->> 'services_max')::integer then
    return query select 'limite_servicos'::text, null::integer, null::integer;
    return;
  end if;

  -- Inclusoes novas: servico ativo e modalidade compativel com a flag do catalogo (CA-02).
  for v_item in select e.value as valor, e.ord as ordem from jsonb_array_elements(p_items) with ordinality e(value, ord) loop
    if not exists (
      select 1 from app.professional_service ps
       where ps.professional_id = p_user
         and ps.service_id = (v_item.valor ->> 'service_id')::uuid
         and ps.modality = v_item.valor ->> 'modality'
    ) then
      select s.modality, s.active into v_modalidade_svc, v_ativo
        from app.service s where s.id = (v_item.valor ->> 'service_id')::uuid;
      if not found or v_ativo is not true then
        return query select 'servico_indisponivel'::text, (v_item.ordem - 1)::integer, null::integer;
        return;
      end if;
      if (v_modalidade_svc = 'presencial' and v_item.valor ->> 'modality' <> 'presencial')
         or (v_modalidade_svc = 'online' and v_item.valor ->> 'modality' <> 'online') then
        return query select 'modalidade_incompativel'::text, (v_item.ordem - 1)::integer, null::integer;
        return;
      end if;
    end if;
  end loop;

  -- Presencial exige base vigente (CA-04).
  select min(e.ord - 1)::integer into v_primeiro_presencial
    from jsonb_array_elements(p_items) with ordinality e(value, ord)
   where e.value ->> 'modality' = 'presencial';
  if v_primeiro_presencial is not null
     and not exists (select 1 from app.professional_area a where a.professional_id = p_user) then
    return query select 'base_obrigatoria'::text, v_primeiro_presencial, null::integer;
    return;
  end if;

  select count(*)::integer into v_del
    from app.professional_service ps
   where ps.professional_id = p_user
     and not exists (select 1 from jsonb_array_elements(p_items) e
                      where e ->> 'service_id' = ps.service_id::text and e ->> 'modality' = ps.modality);
  select count(*)::integer into v_add
    from jsonb_array_elements(p_items) e
   where not exists (select 1 from app.professional_service ps
                      where ps.professional_id = p_user
                        and ps.service_id = (e ->> 'service_id')::uuid
                        and ps.modality = e ->> 'modality');
  if v_add = 0 and v_del = 0 then
    return query select 'unchanged'::text, null::integer, null::integer;
    return;
  end if;

  v_antes := (select jsonb_build_object(
                 'total', count(*),
                 'presencial', count(*) filter (where ps.modality = 'presencial'),
                 'online', count(*) filter (where ps.modality = 'online'))
                from app.professional_service ps where ps.professional_id = p_user);

  delete from app.professional_service ps
   where ps.professional_id = p_user
     and not exists (select 1 from jsonb_array_elements(p_items) e
                      where e ->> 'service_id' = ps.service_id::text and e ->> 'modality' = ps.modality);

  insert into app.professional_service (professional_id, service_id, modality, declared_at)
  select p_user, (e ->> 'service_id')::uuid, e ->> 'modality', p_now
    from jsonb_array_elements(p_items) e
   where not exists (select 1 from app.professional_service ps
                      where ps.professional_id = p_user
                        and ps.service_id = (e ->> 'service_id')::uuid
                        and ps.modality = e ->> 'modality');

  v_depois := (select jsonb_build_object(
                 'total', count(*),
                 'presencial', count(*) filter (where ps.modality = 'presencial'),
                 'online', count(*) filter (where ps.modality = 'online'))
                from app.professional_service ps where ps.professional_id = p_user);
  perform private.audit_append('professional:' || p_user::text, 'professional', 'profile.services.changed',
    'professional_services', p_user, v_antes, v_depois, null, null);

  return query select 'saved'::text, null::integer, null::integer;
end
$$;

-- 4d. Leitura do dono: servicos (sem grupo interno, sem dado de outro profissional).
create or replace function private.professional_services_list(p_user uuid)
returns table (out_service_id uuid, out_name text, out_regulated boolean, out_active boolean, out_modality text)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.service_id, s.name, s.regulated, s.active, ps.modality
    from app.professional_service ps
    join app.service s on s.id = ps.service_id
   where ps.professional_id = p_user
   order by s.name, ps.modality
$$;

-- 4e. Leitura do dono: base e raio (rotulo, km, vigencia e limite de mudanca). Nunca ponto nem identificador.
create or replace function private.professional_area_get(p_user uuid, p_now timestamptz)
returns table (
  out_configured boolean,
  out_label text,
  out_radius_m integer,
  out_valid_since timestamptz,
  out_changes_remaining integer,
  out_next_change_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := private.professional_offering_limits();
  v_janela integer := (private.professional_offering_limits() ->> 'change_window_s')::integer;
  v_cur app.professional_area%rowtype;
  v_has boolean;
  v_cnt integer;
  v_oldest timestamptz;
begin
  select a.* into v_cur from app.professional_area a where a.professional_id = p_user;
  v_has := found;
  select count(*)::integer, min(h.valid_from) into v_cnt, v_oldest
    from app.professional_area_history h
   where h.professional_id = p_user and h.change_kind = 'alterada'
     and h.valid_from > p_now - make_interval(secs => v_janela);
  if not v_has then
    return query select false, null::text, null::integer, null::timestamptz, (v_lim ->> 'change_max')::integer, null::timestamptz;
    return;
  end if;
  return query select
    true,
    v_cur.base_label,
    v_cur.radius_m,
    v_cur.valid_since,
    greatest(0, (v_lim ->> 'change_max')::integer - coalesce(v_cnt, 0)),
    case when coalesce(v_cnt, 0) >= (v_lim ->> 'change_max')::integer
         then v_oldest + make_interval(secs => v_janela) end;
end
$$;

-- 4f. Contrato para #36 e H-031 (decisao 110): base e raio vigentes no instante p_at. Vazio sem base naquele instante.
create or replace function private.professional_area_at(p_professional_id uuid, p_at timestamptz)
returns table (out_geocode_point_id uuid, out_radius_m integer)
language sql
stable
security definer
set search_path = ''
as $$
  select h.geocode_point_id, h.radius_m
    from app.professional_area_history h
   where h.professional_id = p_professional_id
     and h.valid_from <= p_at
     and (h.valid_to is null or p_at < h.valid_to)
$$;

-- 4g. Expurgo do assunto (retencao e exclusao de conta; L-5). Unico caminho que apaga o historico.
create or replace function private.professional_offering_purge(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    raise exception 'offering_entrada_invalida' using errcode = '22023';
  end if;
  perform set_config('app.offering_purge', '1', true);
  delete from app.professional_service where professional_id = p_user;
  delete from app.professional_area_history where professional_id = p_user;
  delete from app.professional_area where professional_id = p_user;
  perform set_config('app.offering_purge', '', true);
  delete from app.geocode_point where subject_kind = 'professional_base' and subject_id = p_user;
  delete from app.geocode_budget where subject_kind = 'professional_base' and subject_id = p_user;
  return true;
end
$$;

-- 5. Postura (igual aos arquivos de identidade): RLS habilitada e forcada, sem politicas, sem DML/SELECT direto.
alter table app.professional_service      enable row level security;
alter table app.professional_service      force row level security;
alter table app.professional_area         enable row level security;
alter table app.professional_area         force row level security;
alter table app.professional_area_history enable row level security;
alter table app.professional_area_history force row level security;

revoke all on app.professional_service, app.professional_area, app.professional_area_history
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

-- 6. Privilegios de funcao: so app_system executa as funcoes de servico e de leitura/escrita da oferta.
revoke all on function private.offering_cfg_int(jsonb, text, integer, integer, integer),
  private.professional_offering_limits(),
  private.professional_service_regras(),
  private.professional_area_ponto(),
  private.professional_area_apagar(),
  private.professional_area_history_guard()
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

revoke all on function
  private.professional_area_precheck(uuid, text, text, boolean, timestamptz),
  private.professional_area_save(uuid, uuid, text, integer, timestamptz),
  private.professional_services_save(uuid, jsonb, timestamptz, text),
  private.professional_services_list(uuid),
  private.professional_area_get(uuid, timestamptz),
  private.professional_area_at(uuid, timestamptz),
  private.professional_offering_purge(uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function
  private.professional_area_precheck(uuid, text, text, boolean, timestamptz),
  private.professional_area_save(uuid, uuid, text, integer, timestamptz),
  private.professional_services_save(uuid, jsonb, timestamptz, text),
  private.professional_services_list(uuid),
  private.professional_area_get(uuid, timestamptz),
  private.professional_area_at(uuid, timestamptz),
  private.professional_offering_purge(uuid)
  to app_system;
