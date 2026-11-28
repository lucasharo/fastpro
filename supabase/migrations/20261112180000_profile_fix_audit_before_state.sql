-- H-036 | Correcao da auditoria da primeira definicao de base (docs/factory/99-DESENHO-H036.md, §6; CA-10).
-- Motivo: private.audit_state_is_valid recusa estado nulo (AU002). A primeira definicao gravava before_state nulo e
-- falhava. Agora grava {} (sem chaves): antes da primeira base nao ha raio. Recria so private.professional_area_save
-- (create or replace preserva os privilegios de 20261112160000). Idempotente. Nenhum dado e alterado.

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
    v_antes := '{}'::jsonb;
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
