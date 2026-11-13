-- H-110 (Issue #119) | Expurgos operacionais (docs/factory/105-DESENHO-H110.md §2 a §6; decisoes 158 a 168 e 198 a 210).
-- Expansao pura e idempotente: create or replace, if not exists. Nenhum valor de TTL e semeado aqui: as chaves
-- purge.* vem de ops.app_config (valores propostos no runbook, docs/factory/). Chave ausente, nao numerica ou
-- menor ou igual a zero = bloco desligado. Todo criterio combina o fim natural de vida com a janela (principio 1).
-- Nenhum literal de prazo de dado aparece aqui (CA-H110-14). legal_hold e so lido. audit_event nao e tocado.
-- Rollback: supabase/rollbacks/20261112230000_ops_create_operational_purge.down.sql

-- 1. Tabela de rollup diario de media_access_log (E8). Sem FK: a origem ainda nao existe. Sem DML para ninguem.
create table if not exists ops.media_access_daily (
  professional_id uuid not null,
  day             date not null,
  outcome         text not null check (outcome in ('ok', 'negado', 'limitado')),
  n               bigint not null check (n >= 0),
  rolled_at       timestamptz not null,
  primary key (professional_id, day, outcome)
);
alter table ops.media_access_daily enable row level security;
alter table ops.media_access_daily force row level security;
revoke all on table ops.media_access_daily
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
comment on table ops.media_access_daily is
  'Rollup diario do acesso a fotos (H-110, E8). Dia fechado e congelado (on conflict do nothing). Sem DML direto.';

-- 2. Leitura de configuracao: NULL = desligado (ausente, nao numerico, zero ou negativo). Teto tecnico de
--    seguranca para o intervalo; nao e prazo de dado.
create or replace function private.ops_purge_cfg(p_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_valor jsonb;
  v_n numeric;
begin
  select c.value into v_valor from ops.app_config c where c.key = p_key;
  if v_valor is null or jsonb_typeof(v_valor) <> 'number' then
    return null;
  end if;
  v_n := (v_valor #>> '{}')::numeric;
  if v_n is null or v_n <= 0 then
    return null;
  end if;
  return least(floor(v_n), 3153600000)::bigint;
end;
$$;

create or replace function private.ops_purge_check_limit(p_limit integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'purge_limite_invalido' using errcode = '22023';
  end if;
end;
$$;

-- 3. E3 desafio: vencido ou consumido, com idade acima da janela. Desafio pendente e vivo nunca sai.
create or replace function private.ops_purge_auth_challenge(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.auth_challenge_seconds');
  v_n integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e3')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  with alvo as (
    select c.id
      from app.auth_challenge c
     where c.created_at <= p_now - make_interval(secs => v_ttl)
       and (c.consumed_at is not null or c.invalidated_at is not null or c.expires_at <= p_now)
     order by c.created_at, c.id
     limit p_limit
     for update skip locked
  ), apagado as (
    delete from app.auth_challenge c using alvo where c.id = alvo.id returning c.id
  )
  select count(*)::integer into v_n from apagado;
  return query select 'ok'::text, v_n, 0, 0;
end;
$$;

-- 4. E4 sessao: (a) identificacao vencida; (b) ativa vencida (menor entre expiracao e teto absoluto);
--    (c) revogada ha mais que a janela de revogacao. Hold do sujeito (user_id) retem.
create or replace function private.ops_purge_session(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp bigint := private.ops_purge_cfg('purge.session_expired_seconds');
  v_rev bigint := private.ops_purge_cfg('purge.session_revoked_seconds');
  v_removidos integer := 0;
  v_retidos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_exp is null and v_rev is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e4')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  with alvo as (
    select s.id
      from app.app_session s
     where ((v_exp is not null and s.stage = 'identificacao'
              and s.expires_at <= p_now - make_interval(secs => v_exp))
         or (v_exp is not null and s.stage = 'ativa'
              and least(s.expires_at, s.absolute_expires_at) <= p_now - make_interval(secs => v_exp))
         or (v_rev is not null and s.revoked_at is not null
              and s.revoked_at <= p_now - make_interval(secs => v_rev)))
       and not exists (select 1 from app.legal_hold h
                        where h.subject_type = 'user' and h.subject_id = s.user_id and h.released_at is null)
     order by s.created_at, s.id
     limit p_limit
     for update skip locked
  ), apagado as (
    delete from app.app_session s
     using alvo
     where s.id = alvo.id
       and not exists (select 1 from app.legal_hold h
                        where h.subject_type = 'user' and h.subject_id = s.user_id and h.released_at is null)
    returning s.id
  )
  select count(*)::integer into v_removidos from apagado;

  select count(*)::integer into v_retidos
    from app.app_session s
   where ((v_exp is not null and s.stage = 'identificacao'
            and s.expires_at <= p_now - make_interval(secs => v_exp))
       or (v_exp is not null and s.stage = 'ativa'
            and least(s.expires_at, s.absolute_expires_at) <= p_now - make_interval(secs => v_exp))
       or (v_rev is not null and s.revoked_at is not null
            and s.revoked_at <= p_now - make_interval(secs => v_rev)))
     and exists (select 1 from app.legal_hold h
                  where h.subject_type = 'user' and h.subject_id = s.user_id and h.released_at is null);
  return query select 'ok'::text, v_removidos, v_retidos, 0;
end;
$$;

-- 5. E2 rascunho (parte do banco). Fase A: marca as fotos do rascunho para expurgo e descarta o rascunho
--    (decisao 161). Rascunho com foto ready fica retido e contado (ver nota de Q-A110-3 no desenho).
--    Fase C: apaga o rascunho somente quando nao resta nenhuma linha de media_asset (FK restrict).
--    Rascunho publicado nunca entra (decisao 210).
create or replace function private.ops_purge_draft(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.draft_inactive_seconds');
  v_alterados integer := 0;
  v_apagados integer := 0;
  v_retidos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e2')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);

  -- Fase A: marca e descarta.
  with alvo as (
    select d.id
      from app.request_draft d
     where d.status in ('aberto', 'aguardando_email', 'descartado')
       and d.expires_at <= p_now
       and d.updated_at <= p_now - make_interval(secs => v_ttl)
       and not exists (select 1 from app.media_asset m where m.draft_id = d.id and m.status = 'ready')
       and not exists (select 1 from app.media_asset m where m.draft_id = d.id and m.purge_requested_at is not null)
     order by d.updated_at, d.id
     limit p_limit
     for update skip locked
  ), marca as (
    update app.media_asset m
       set purge_requested_at = p_now
      from alvo a
     where m.draft_id = a.id and m.purge_requested_at is null
    returning m.id
  ), descarte as (
    update app.request_draft d
       set status = 'descartado'
      from alvo a
     where d.id = a.id and d.status <> 'descartado'
    returning d.id
  )
  select (select count(*) from marca) + (select count(*) from descarte) into v_alterados;

  -- Fase C: apaga rascunhos descartados que ja nao tem linha de foto.
  with alvo as (
    select d.id
      from app.request_draft d
     where d.status = 'descartado'
       and d.expires_at <= p_now
       and d.updated_at <= p_now - make_interval(secs => v_ttl)
       and not exists (select 1 from app.media_asset m where m.draft_id = d.id)
     order by d.updated_at, d.id
     limit p_limit
     for update skip locked
  ), apagado as (
    delete from app.request_draft d using alvo where d.id = alvo.id returning d.id
  )
  select count(*)::integer into v_apagados from apagado;

  select count(*)::integer into v_retidos
    from app.request_draft d
   where d.status in ('aberto', 'aguardando_email', 'descartado')
     and d.expires_at <= p_now
     and d.updated_at <= p_now - make_interval(secs => v_ttl)
     and exists (select 1 from app.media_asset m where m.draft_id = d.id and m.status = 'ready');

  return query select 'ok'::text, v_alterados + v_apagados, v_retidos, 0;
end;
$$;

-- 6. E1 quarentena (SQL): marca linhas de upload nao concluido alem da janela. A remocao do objeto e do Node
--    (porta QuarentenaStorePort). Lista de marcadas para o Node concluir.
create or replace function private.ops_purge_media_mark(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.quarantine_pending_seconds');
  v_n integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e1')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  with alvo as (
    select m.id
      from app.media_asset m
     where m.status = 'pending'
       and m.confirmed_at is null
       and m.purge_requested_at is null
       and m.created_at <= p_now - make_interval(secs => v_ttl)
     order by m.created_at, m.id
     limit p_limit
     for update skip locked
  ), marca as (
    update app.media_asset m set purge_requested_at = p_now from alvo a where m.id = a.id returning m.id
  )
  select count(*)::integer into v_n from marca;
  return query select 'ok'::text, v_n, 0, 0;
end;
$$;

-- Lista (somente leitura) das linhas marcadas para expurgo cujo objeto ainda deve sair da quarentena.
create or replace function private.ops_purge_media_marcados(p_limit integer)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform private.ops_purge_check_limit(p_limit);
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids
    from (
      select m.id
        from app.media_asset m
       where m.purge_requested_at is not null
       order by m.purge_requested_at, m.id
       limit p_limit
    ) x;
  return v_ids;
end;
$$;

-- 7. E9 orfaos (SQL lista): objetos do bucket quarantine mais velhos que a janela. Nunca apaga em storage.objects.
--    Esquema ausente = pulado_ausente. O nome do objeto nao e registrado em log (RN-H110-10).
create or replace function private.ops_purge_media_orfaos(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_nome text, out_id uuid, out_existe boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.quarantine_pending_seconds');
  v_nome text;
  v_id uuid;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, null::text, null::uuid, null::boolean;
    return;
  end if;
  if to_regclass('storage.objects') is null then
    return query select 'pulado_ausente'::text, null::text, null::uuid, null::boolean;
    return;
  end if;
  for v_nome in
    execute format(
      'select o.name::text from storage.objects o where o.bucket_id = %L and o.created_at <= $1 order by o.created_at, o.name limit $2',
      'quarantine')
    using p_now - make_interval(secs => v_ttl), p_limit
  loop
    v_id := null;
    if v_nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
      v_id := substring(v_nome from '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid;
    end if;
    return query select 'ok'::text, v_nome, v_id,
      (v_id is not null and exists (select 1 from app.media_asset m where m.id = v_id));
  end loop;
end;
$$;

-- 8. E5 inbox de webhook: so se a tabela existir com o contrato (id, processed_at, received_at).
--    Tabela ausente = pulado_ausente (decisao 165). Identificadores fixos; nada de entrada externa em SQL.
create or replace function private.ops_purge_provider_event(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.provider_event_seconds');
  v_colunas integer;
  v_n integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if to_regclass('ops.provider_event') is null then
    return query select 'pulado_ausente'::text, 0, 0, 0;
    return;
  end if;
  select count(*)::integer into v_colunas
    from pg_attribute a
   where a.attrelid = to_regclass('ops.provider_event')
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('id', 'processed_at', 'received_at');
  if v_colunas <> 3 then
    return query select 'pulado_incompativel'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e5')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  execute format(
    'with alvo as (select e.id from %1$I.%2$I e where e.processed_at is not null and e.processed_at <= $1 - make_interval(secs => $2) order by e.received_at, e.id limit $3 for update skip locked) delete from %1$I.%2$I e using alvo where e.id = alvo.id',
    'ops', 'provider_event')
    using p_now, v_ttl, p_limit;
  get diagnostics v_n = row_count;
  return query select 'ok'::text, v_n, 0, 0;
end;
$$;

-- 9. E6a outbox de eventos: so despachados alem da janela. Preserva o ultimo evento de cada agregado
--    (R-3: produtor de aggregate_seq nao verificado). Hold do agregado (aggregate_id) retem.
create or replace function private.ops_purge_outbox_event(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.outbox_dispatched_seconds');
  v_removidos integer := 0;
  v_retidos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e6a')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  with alvo as (
    select o.id
      from ops.outbox_event o
     where o.dispatched_at is not null
       and o.dispatched_at <= p_now - make_interval(secs => v_ttl)
       and not exists (select 1 from app.legal_hold h
                        where h.released_at is null and h.subject_id = o.aggregate_id)
       and exists (select 1 from ops.outbox_event n
                    where n.aggregate_type = o.aggregate_type
                      and n.aggregate_id = o.aggregate_id
                      and n.aggregate_seq > o.aggregate_seq)
     order by o.dispatched_at, o.id
     limit p_limit
     for update skip locked
  ), apagado as (
    delete from ops.outbox_event o using alvo where o.id = alvo.id returning o.id
  )
  select count(*)::integer into v_removidos from apagado;

  select count(*)::integer into v_retidos
    from ops.outbox_event o
   where o.dispatched_at is not null
     and o.dispatched_at <= p_now - make_interval(secs => v_ttl)
     and exists (select 1 from app.legal_hold h where h.released_at is null and h.subject_id = o.aggregate_id);
  return query select 'ok'::text, v_removidos, v_retidos, 0;
end;
$$;

-- 10. E6b saida de e-mail (decisao 166). Antes de apagar, a notificacao ligada passa a descartada/expirado
--     (invariante de notification_item: enviado <=> outbox_id nao nulo); a unicidade de notification_item
--     continua valendo, sem reenvio. Hold do destinatario retem.
create or replace function private.ops_purge_email_outbox(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.email_outbox_seconds');
  v_removidos integer := 0;
  v_retidos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e6b')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  create temporary table if not exists ops_purge_email_alvo (id uuid primary key) on commit drop;
  delete from ops_purge_email_alvo;
  insert into ops_purge_email_alvo (id)
    select e.id
      from ops.email_outbox e
     where e.state in ('enviado', 'suprimido', 'descartado')
       and coalesce(e.sent_at, e.created_at) <= p_now - make_interval(secs => v_ttl)
       and not exists (select 1 from app.legal_hold h
                        where h.released_at is null and h.subject_type = 'user'
                          and h.subject_id = e.recipient_user_id)
     order by coalesce(e.sent_at, e.created_at), e.id
     limit p_limit;
  update ops.notification_item n
     set outbox_id = null,
         state = 'descartado',
         discard_reason = 'expirado',
         decided_at = coalesce(n.decided_at, p_now)
   where n.outbox_id in (select a.id from ops_purge_email_alvo a);
  delete from ops.email_outbox e using ops_purge_email_alvo a where e.id = a.id;
  get diagnostics v_removidos = row_count;
  select count(*)::integer into v_retidos
    from ops.email_outbox e
   where e.state in ('enviado', 'suprimido', 'descartado')
     and coalesce(e.sent_at, e.created_at) <= p_now - make_interval(secs => v_ttl)
     and exists (select 1 from app.legal_hold h
                  where h.released_at is null and h.subject_type = 'user'
                    and h.subject_id = e.recipient_user_id);
  return query select 'ok'::text, v_removidos, v_retidos, 0;
end;
$$;

-- 11. E7 chave de idempotencia: vencida e com idade acima da janela (decisao 167). Sem sujeito.
create or replace function private.ops_purge_idempotency(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl bigint := private.ops_purge_cfg('purge.idempotency_seconds');
  v_n integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_ttl is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e7')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);
  with alvo as (
    select k.principal_id, k.operation, k.key
      from ops.idempotency_key k
     where k.expires_at <= p_now
       and k.created_at <= p_now - make_interval(secs => v_ttl)
     order by k.created_at, k.principal_id, k.operation, k.key
     limit p_limit
     for update skip locked
  ), apagado as (
    delete from ops.idempotency_key k
     using alvo
     where k.principal_id = alvo.principal_id and k.operation = alvo.operation and k.key = alvo.key
     returning k.principal_id
  )
  select count(*)::integer into v_n from apagado;
  return query select 'ok'::text, v_n, 0, 0;
end;
$$;

-- 12. E8 acesso a fotos: rollup de dias fechados (dia congelado) e, so com chave propria, remocao do detalhe
--     dos dias ja presentes no rollup. Tabela ausente ou sem o contrato (at, professional_id, outcome) = pulado.
create or replace function private.ops_purge_media_access(p_now timestamptz, p_limit integer)
returns table (out_estado text, out_removidos integer, out_retidos integer, out_falhos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rollup bigint := private.ops_purge_cfg('purge.media_access_rollup_after_seconds');
  v_detalhe bigint := private.ops_purge_cfg('purge.media_access_detail_seconds');
  v_rel text;
  v_colunas integer;
  v_n integer := 0;
  v_grupos integer := 0;
begin
  perform private.ops_purge_check_limit(p_limit);
  if v_rollup is null and v_detalhe is null then
    return query select 'desligado'::text, 0, 0, 0;
    return;
  end if;
  if to_regclass('ops.media_access_log') is not null then
    v_rel := 'ops.media_access_log';
  elsif to_regclass('app.media_access_log') is not null then
    v_rel := 'app.media_access_log';
  else
    return query select 'pulado_ausente'::text, 0, 0, 0;
    return;
  end if;
  select count(*)::integer into v_colunas
    from pg_attribute a
   where a.attrelid = to_regclass(v_rel)
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('at', 'professional_id', 'outcome');
  if v_colunas <> 3 then
    return query select 'pulado_incompativel'::text, 0, 0, 0;
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('ops.purge.e8')) then
    return query select 'ocupado'::text, 0, 0, 0;
    return;
  end if;
  perform set_config('statement_timeout', '8000', true);

  if v_rollup is not null then
    execute format($q$
      insert into ops.media_access_daily (professional_id, day, outcome, n, rolled_at)
      select l.professional_id, (l.at at time zone 'utc')::date, l.outcome, count(*), $1
        from %1$s l
       where (l.at at time zone 'utc')::date < ((($2 at time zone 'utc')::date) - 1)
         and l.at <= $2 - make_interval(secs => $3)
       group by l.professional_id, (l.at at time zone 'utc')::date, l.outcome
      on conflict do nothing$q$, v_rel)
      using p_now, p_now, v_rollup;
    get diagnostics v_grupos = row_count;
  end if;

  if v_detalhe is not null then
    execute format($q$
      delete from %1$s l
       where l.ctid in (
         select l2.ctid from %1$s l2
          where l2.at <= $1 - make_interval(secs => $2)
            and (l2.at at time zone 'utc')::date < ((($1 at time zone 'utc')::date) - 1)
            and exists (select 1 from ops.media_access_daily d
                         where d.professional_id = l2.professional_id
                           and d.day = (l2.at at time zone 'utc')::date
                           and d.outcome = l2.outcome)
          limit $3)$q$, v_rel)
      using p_now, v_detalhe, p_limit;
    get diagnostics v_n = row_count;
  end if;
  return query select 'ok'::text, v_n, 0, 0;
end;
$$;

-- 13. Enfileiramento do job diario (kind ops.purge) e de continuacoes (ops.purge:<data>:c<n>, decisao 203).
create or replace function private.ops_purge_enqueue(p_now timestamptz, p_execucao integer default 1)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text := 'ops.purge:' || to_char(p_now at time zone 'utc', 'YYYY-MM-DD');
begin
  if p_execucao is null or p_execucao < 1 or p_execucao > 100 then
    raise exception 'purge_execucao_invalida' using errcode = '22023';
  end if;
  if p_execucao > 1 then
    v_chave := v_chave || ':c' || p_execucao::text;
  end if;
  return private.job_enqueue('ops.purge', v_chave, null, null, 5);
end;
$$;

-- 14. Auditoria: um evento por execucao do job, so com contagens (decisao 203). Ator de sistema.
create or replace function private.ops_purge_audit(p_job uuid, p_counts jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.audit_append(
    'system:ops_purge', 'system', 'ops.purge.executed', 'ops_job', p_job, '{}'::jsonb, p_counts, null, null);
end;
$$;

-- 15. Acao de auditoria. Chaves: run_no e, por bloco e1 a e9, removidos, retidos, falhos e pulado (37 chaves).
do $$
declare
  v_chaves text[] := array['run_no'];
  v_bloco text;
begin
  foreach v_bloco in array array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'] loop
    v_chaves := v_chaves || array[
      v_bloco || '_removidos', v_bloco || '_retidos', v_bloco || '_falhos', v_bloco || '_pulado'];
  end loop;
  insert into audit.action_catalog (action, object_type, reason_required, state_keys, description)
  values ('ops.purge.executed', 'ops_job', false, v_chaves,
          'Execucao diaria dos expurgos operacionais (H-110), so contagens')
  on conflict do nothing;
end;
$$;

-- 16. Privilegios: nenhuma funcao para PUBLIC, anon, authenticated, service_role ou app_api; execute so para app_system.
revoke all on function private.ops_purge_cfg(text) from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_check_limit(integer) from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_auth_challenge(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_session(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_draft(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_media_mark(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_media_marcados(integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_media_orfaos(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_provider_event(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_outbox_event(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_email_outbox(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_idempotency(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_media_access(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_enqueue(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.ops_purge_audit(uuid, jsonb)
  from public, anon, authenticated, service_role, app_api;

grant execute on function private.ops_purge_cfg(text) to app_system;
grant execute on function private.ops_purge_check_limit(integer) to app_system;
grant execute on function private.ops_purge_auth_challenge(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_session(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_draft(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_media_mark(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_media_marcados(integer) to app_system;
grant execute on function private.ops_purge_media_orfaos(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_provider_event(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_outbox_event(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_email_outbox(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_idempotency(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_media_access(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_enqueue(timestamptz, integer) to app_system;
grant execute on function private.ops_purge_audit(uuid, jsonb) to app_system;

-- Funcoes de H-026 usadas pelo E1 (sem recriar): concessao minima a app_system.
grant execute on function private.media_original_cleanup_list(integer) to app_system;
grant execute on function private.media_original_removed(uuid, timestamptz) to app_system;
grant execute on function private.media_purge_done(uuid[]) to app_system;

-- 17. Agendamento diario: somente se a extensao pg_cron existir (decisao 204). Sem ela, disparo manual (runbook).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-purge-daily', '23 3 * * *', 'select private.ops_purge_enqueue(now())');
  end if;
end;
$$;
