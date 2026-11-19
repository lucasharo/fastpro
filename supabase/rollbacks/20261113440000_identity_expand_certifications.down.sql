-- Desfaz 20261113440000_identity_expand_certifications.sql (H-038, Issue 51). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Restaura os corpos da Issue 50 (20261112220000 e 20261112235000) e remove a expansao.
-- Guarda: se houver linha kind = 'certificacao', aborta com rollback_recusado_com_dados, a menos que
-- set app.rollback_force = '1' (convencao do H-036 e do down da Issue 50; so dev).
-- Remover private.certificacoes_completas devolve a verificacao ao comportamento fail-closed (incompletas).
-- Idempotente (if exists / on conflict). Nao toca professional_profile, app_user nem buckets.
begin;

-- 0. Guarda de dados.
do $$
declare
  v_certs bigint := 0;
begin
  if to_regclass('app.identity_document') is not null then
    execute 'select count(*) from app.identity_document where kind = ''certificacao''' into v_certs;
  end if;
  if v_certs > 0 and coalesce(current_setting('app.rollback_force', true), '') <> '1' then
    raise exception 'rollback_recusado_com_dados'
      using detail = format('%s linha(s) de certificacao em app.identity_document; use set app.rollback_force = ''1'' somente em dev',
                            v_certs);
  end if;
end;
$$;

-- 1. Funcoes novas.
drop function if exists private.certificacao_servico_ok(uuid, uuid);
drop function if exists private.certificacoes_completas(uuid);
drop function if exists private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint);

-- 2. Funcoes da Issue 50 restauradas (corpos de 20261112220000, com a correcao de 20261112235000 em idoc_issue).
create or replace function private.idoc_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vivas bigint;
begin
  perform 1 from app.professional_profile p where p.user_id = new.professional_id for update;
  select count(*) into v_vivas
    from app.identity_document d
   where d.professional_id = new.professional_id
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido');
  if v_vivas >= 5 then
    raise exception 'limite_documentos' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.idoc_limite() from public;

create or replace function private.idoc_issue(
  p_user uuid,
  p_client_upload_id uuid,
  p_type text,
  p_bytes integer,
  p_now timestamptz,
  p_global_bytes_cap bigint)
returns table (out_code text, out_id uuid, out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_verificado timestamptz;
  v_row app.identity_document;
  v_vivas bigint;
  v_total bigint;
begin
  if p_user is null or p_client_upload_id is null or p_now is null or p_global_bytes_cap is null
     or p_global_bytes_cap < 1 or p_global_bytes_cap > 10000000000
     or p_type is null or p_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     or p_bytes is null or p_bytes < 1
     or p_bytes > (case when p_type = 'application/pdf' then 2097152 else 5242880 end) then
    raise exception 'idoc_entrada_invalida' using errcode = '22023';
  end if;

  select p.verification_status, u.email_verified_at
    into v_estado, v_verificado
    from app.professional_profile p
    join app.app_user u on u.id = p.user_id
   where p.user_id = p_user
   for update of p;
  if not found then
    out_code := 'no_profile';
    return next;
    return;
  end if;
  if v_verificado is null then
    out_code := 'email_unverified';
    return next;
    return;
  end if;
  if v_estado not in ('pendente', 'em_revisao', 'retida_duplicidade', 'recusada') then
    perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.refused',
      'identity_document', p_user, '{}'::jsonb, jsonb_build_object('reason_code', 'estado_nao_aceita'),
      null, null);
    out_code := 'state_denied';
    return next;
    return;
  end if;

  update app.identity_document d
     set purge_requested_at = p_now
   where d.professional_id = p_user
     and d.status = 'pendente_envio'
     and d.purge_requested_at is null
     and d.pending_expires_at <= p_now;

  select d.* into v_row
    from app.identity_document d
   where d.professional_id = p_user
     and d.client_upload_id = p_client_upload_id
     and d.purge_requested_at is null;
  if found then
    out_code := case when v_row.status = 'recebido' then 'replay_received' else 'replay' end;
    out_id := v_row.id;
    out_status := v_row.status;
    return next;
    return;
  end if;

  select count(*) into v_vivas
    from app.identity_document d
   where d.professional_id = p_user
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido');
  if v_vivas >= 5 then
    perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.refused',
      'identity_document', p_user, '{}'::jsonb, jsonb_build_object('reason_code', 'limite_documentos'),
      null, null);
    out_code := 'doc_limit';
    return next;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('identity_docs_teto_global'));
  select coalesce(sum(d.stored_bytes), 0)
       + 2097152::bigint * count(*) filter (where d.status = 'pendente_envio')
    into v_total
    from app.identity_document d;
  if v_total + 2097152 > p_global_bytes_cap then
    out_code := 'cap';
    return next;
    return;
  end if;

  insert into app.identity_document (professional_id, client_upload_id, declared_type, declared_bytes,
                                     status, pending_expires_at, created_at)
  values (p_user, p_client_upload_id, p_type, p_bytes, 'pendente_envio',
          p_now + interval '30 minutes', p_now)
  returning id, status into out_id, out_status;
  out_code := 'new';
  return next;
end;
$$;

drop function if exists private.idoc_list(uuid, timestamptz);
create function private.idoc_list(p_user uuid, p_now timestamptz)
returns table (out_id uuid, out_file_kind text, out_status text, out_received_at timestamptz, out_deletable boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.id,
         (case when coalesce(d.stored_type, d.declared_type) = 'application/pdf' then 'pdf' else 'imagem' end)::text,
         (case when d.status = 'recebido' then 'recebido' else 'em_envio' end)::text,
         d.received_at,
         (d.analyzed_at is null)
    from app.identity_document d
   where d.professional_id = p_user
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido')
     and (d.status = 'recebido' or d.pending_expires_at > p_now)
   order by d.created_at, d.id;
end;
$$;

create or replace function private.idoc_confirm_done(
  p_user uuid,
  p_id uuid,
  p_attempt smallint,
  p_stored_type text,
  p_stored_bytes integer,
  p_sha256 bytea,
  p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.identity_document;
begin
  select d.* into v_row
    from app.identity_document d
   where d.id = p_id and d.professional_id = p_user
   for update;
  if not found or v_row.status <> 'pendente_envio' or v_row.purge_requested_at is not null then
    return 'gone';
  end if;
  if v_row.attempts <> p_attempt then
    return 'lost';
  end if;

  update app.identity_document d
     set status = 'recebido',
         stored_type = p_stored_type,
         stored_bytes = p_stored_bytes,
         content_sha256 = p_sha256,
         received_at = p_now,
         lease_until = null
   where d.id = p_id;

  if exists (select 1 from app.professional_profile p
              where p.user_id = p_user and p.verification_status = 'recusada') then
    update app.identity_document d
       set status = 'substituido'
     where d.professional_id = p_user
       and d.id <> p_id
       and d.status = 'recebido'
       and d.analyzed_at is not null
       and d.purge_requested_at is null;
  end if;

  perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.received',
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('file_kind', case when p_stored_type = 'application/pdf' then 'pdf' else 'imagem' end,
                       'size_bytes', p_stored_bytes),
    null, null);
  return 'received';
end;
$$;

create or replace function private.idoc_delete(p_user uuid, p_id uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.identity_document;
begin
  select d.* into v_row
    from app.identity_document d
   where d.id = p_id
     and d.professional_id = p_user
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido')
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.analyzed_at is not null then
    return 'already_analyzed';
  end if;

  update app.identity_document d
     set purge_requested_at = p_now,
         lease_until = null
   where d.id = p_id;

  perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.deleted',
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('file_kind', case when coalesce(v_row.stored_type, v_row.declared_type) = 'application/pdf'
                                        then 'pdf' else 'imagem' end,
                       'size_bytes', coalesce(v_row.stored_bytes, v_row.declared_bytes)),
    null, null);
  return 'deleted';
end;
$$;

-- 3. Grants das funcoes restauradas (idoc_list foi recriada e perdeu os grants).
revoke all on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_list(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_delete(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint) to app_system;
grant execute on function private.idoc_list(uuid, timestamptz) to app_system;
grant execute on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz) to app_system;
grant execute on function private.idoc_delete(uuid, uuid, timestamptz) to app_system;

-- 4. Linhas de certificacao (so existem se a guarda foi forcada em dev).
delete from app.identity_document where kind = 'certificacao';

-- 5. Indices, coerencia, coluna e constraint de kind como estavam em 20261112220000.
drop index if exists app.identity_document_cert_servico_idx;
drop index if exists app.identity_document_cert_viva_key;
alter table app.identity_document drop constraint if exists identity_document_service_kind_ck;
alter table app.identity_document drop column if exists service_id;
alter table app.identity_document drop constraint if exists identity_document_kind_ck;
alter table app.identity_document drop constraint if exists identity_document_kind_check;
alter table app.identity_document add constraint identity_document_kind_check check (kind in ('identidade'));

-- 6. Linhas de catalogo de auditoria da certificacao (falham por FK se ja houver evento; e o desejado).
delete from audit.action_catalog
 where object_type = 'identity_document'
   and action in ('identity.cert.received', 'identity.cert.replaced', 'identity.cert.deleted');

commit;
