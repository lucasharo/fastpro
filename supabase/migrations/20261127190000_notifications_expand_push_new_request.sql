-- Push de pedido novo na regiao (decisao do dono, 2026-11-27): na publicacao e na segunda onda, avisa quem pode ver e
-- aceitar o pedido. So push (sem e-mail, por causa da cota). A regra e a mesma da descoberta: guarda unica
-- (professional_access_guard, modo descoberta_aceite) e discovery_serves (online sem raio; presencial dentro do raio).

create or replace function private.push_request_targets(p_request uuid, p_now timestamptz)
returns table (out_service_name text, out_platform text, out_token text, out_p256dh text, out_auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, d.platform, d.token, d.p256dh, d.auth
    from app.service_request r
    join app.service s on s.id = r.service_id
    left join app.geocode_point rg
      on rg.id = r.geocode_point_id and rg.state = 'ok' and rg.match_grid_version = 1
    join app.push_device d on d.user_id <> r.customer_user_id
   where r.id = p_request
     and private.discovery_open(r.status, r.acceptance_deadline_at, p_now)
     and exists (
       select 1
         from app.professional_service ps
         left join app.professional_area pa on pa.professional_id = ps.professional_id
         left join app.geocode_point g
           on g.id = pa.geocode_point_id and g.subject_kind = 'professional_base'
          and g.state = 'ok' and g.match_grid_version = 1
        where ps.professional_id = d.user_id
          and ps.service_id = r.service_id
          and private.discovery_serves(
                private.discovery_mod_pres(ps.modality),
                private.discovery_mod_onl(ps.modality, s.regulated),
                g.id is not null and rg.id is not null,
                private.discovery_dist_m(g.match_lon, g.match_lat, rg.match_lon, rg.match_lat),
                pa.radius_m))
     and not exists (select 1 from app.acceptance a where a.request_id = r.id and a.professional_id = d.user_id)
     and private.professional_access_guard(d.user_id, 'descoberta_aceite', p_now)
   order by d.last_seen_at desc, d.id
   limit 200
$$;

-- Publicacao e abertura da segunda onda enfileiram um job por vez (chave por pedido e momento).
create or replace function private.service_request_enfileira_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.push_device) then
    perform private.job_enqueue(
      'push.request',
      'push.request:' || new.id::text || case when tg_op = 'UPDATE' then ':onda2' else '' end,
      clock_timestamp(), new.id::text, 3);
  end if;
  return null;
end
$$;

drop trigger if exists service_request_push_novo on app.service_request;
create trigger service_request_push_novo
  after insert on app.service_request
  for each row when (new.status = 'publicado')
  execute function private.service_request_enfileira_push();

drop trigger if exists service_request_push_onda on app.service_request;
create trigger service_request_push_onda
  after update of wave2_opened_at on app.service_request
  for each row when (old.wave2_opened_at is null and new.wave2_opened_at is not null)
  execute function private.service_request_enfileira_push();

revoke all on function private.push_request_targets(uuid, timestamptz) from public, anon, authenticated, service_role, app_api;
revoke all on function private.service_request_enfileira_push() from public, anon, authenticated, service_role, app_api;
grant execute on function private.push_request_targets(uuid, timestamptz) to app_system;
