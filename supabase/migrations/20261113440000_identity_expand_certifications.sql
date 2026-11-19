-- H-038 (Issue 51) | Certificacoes para atividades regulamentadas (docs/factory/148-DESENHO-H038.md, secoes 2, 3, 7;
-- decisoes D-H038-A1 a A4 e 302 a 319 de 11-DECISOES.md, adotadas pelo lider).
-- Idempotente. Desfazer: supabase/rollbacks/20261113440000_identity_expand_certifications.down.sql.
-- Migracao por expansao sobre app.identity_document: sem tabela nova, sem bucket novo, sem media_asset.
-- Assinaturas das funcoes de Issue 50 preservadas. Excecao: private.idoc_list muda o formato de retorno
-- (acrescenta kind e service_id); por isso e recriada (drop + create) e recebe os grants de novo.
-- Certificacao tem cota propria: nao conta nos 5 documentos de identidade. O teto global de bytes
-- (idoc_issue e idoc_issue_cert) ja soma todas as linhas, identidade e certificacao.
-- Tempo: p_now informado pelo chamador (relogio do servidor), como na Issue 50.

-- 1. kind aceita 'certificacao'. A constraint antiga tem nome verificado em pg_constraint: identity_document_kind_check.
do $$
begin
  alter table app.identity_document drop constraint if exists identity_document_kind_check;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'app.identity_document'::regclass and conname = 'identity_document_kind_ck') then
    alter table app.identity_document
      add constraint identity_document_kind_ck check (kind in ('identidade', 'certificacao'));
  end if;
end;
$$;

-- 2. Servico vinculado (nulo para identidade). Aditivo: linhas existentes ficam com service_id nulo.
alter table app.identity_document
  add column if not exists service_id uuid references app.service (id) on delete restrict;

-- 3. Coerencia tipo x servico. Criada sem validar e validada em seguida (linhas existentes sao todas identidade).
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'app.identity_document'::regclass
                    and conname = 'identity_document_service_kind_ck') then
    alter table app.identity_document add constraint identity_document_service_kind_ck
      check ((kind = 'identidade' and service_id is null)
          or (kind = 'certificacao' and service_id is not null)) not valid;
    alter table app.identity_document validate constraint identity_document_service_kind_ck;
  end if;
end;
$$;

-- 4. Uma certificacao viva (recebida e nao marcada para expurgo) por profissional e servico (RN-H038-03).
create unique index if not exists identity_document_cert_viva_key
  on app.identity_document (professional_id, service_id)
  where kind = 'certificacao' and status = 'recebido' and purge_requested_at is null;
create index if not exists identity_document_cert_servico_idx
  on app.identity_document (professional_id, service_id)
  where kind = 'certificacao' and purge_requested_at is null;

-- 5. Limite de 5 documentos vivos conta apenas identidade (CA-H038-06). Certificacao nao passa pelo limite.
create or replace function private.idoc_limite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vivas bigint;
begin
  if new.kind <> 'identidade' then
    return new;
  end if;
  perform 1 from app.professional_profile p where p.user_id = new.professional_id for update;
  select count(*) into v_vivas
    from app.identity_document d
   where d.professional_id = new.professional_id
     and d.kind = 'identidade'
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido');
  if v_vivas >= 5 then
    raise exception 'limite_documentos' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.idoc_limite() from public;

drop trigger if exists identity_document_limite on app.identity_document;
create trigger identity_document_limite
  before insert on app.identity_document
  for each row execute function private.idoc_limite();

-- 6. Emissao de identidade (idoc_issue): mesmo corpo e assinatura de 20261112235000, com o limite de 5
--    contando apenas identidade.
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
    -- Recusa sem documento: o objeto auditado e o proprio profissional (audit_event exige object_id).
    perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.refused',
      'identity_document', p_user, '{}'::jsonb, jsonb_build_object('reason_code', 'estado_nao_aceita'),
      null, null);
    out_code := 'state_denied';
    return next;
    return;
  end if;

  -- Liberacao preguicosa: pendentes vencidos deste profissional deixam de contar (107 §4.2).
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
     and d.kind = 'identidade'
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

  -- Teto global (D-8, decisao 220): soma dos objetos gravados mais 2 MiB por reserva pendente, de qualquer kind.
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

-- 7. Emissao de certificacao (idoc_issue_cert, D-H038-A1). Mesmo pipeline de envio; cota propria:
--    1 reserva pendente viva por (profissional, servico) e o teto global de bytes.
--    Servico invalido, nao regulamentado ou nao vinculado responde o mesmo codigo (service_denied): sem enumeracao.
--    Estados aceitos: pendente, em_revisao, retida_duplicidade, recusada e aprovada (decisao 305: certificacao
--    depois da aprovacao). Apenas suspensa e recusada pelo estado.
--    Sem auditoria em recusa de estado ou de cota (decisao 316: audita-se so transicao de estado).
--    out_code: new | replay | replay_received | no_profile | email_unverified | state_denied | service_denied |
--              client_upload_em_uso | limite_certificacao | cap.
create or replace function private.idoc_issue_cert(
  p_user uuid,
  p_client_upload_id uuid,
  p_service_id uuid,
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
  v_regulado boolean;
  v_row app.identity_document;
  v_pendentes bigint;
  v_total bigint;
begin
  if p_user is null or p_client_upload_id is null or p_service_id is null or p_now is null
     or p_global_bytes_cap is null or p_global_bytes_cap < 1 or p_global_bytes_cap > 10000000000
     or p_type is null or p_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     or p_bytes is null or p_bytes < 1
     or p_bytes > (case when p_type = 'application/pdf' then 2097152 else 5242880 end) then
    raise exception 'idoc_entrada_invalida' using errcode = '22023';
  end if;

  -- Trava o perfil: serializa emissoes do mesmo profissional (cota por servico e replay).
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
  if v_estado not in ('pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'aprovada') then
    out_code := 'state_denied';
    return next;
    return;
  end if;

  -- Servico: precisa ser regulamentado e estar vinculado ao perfil. Qualquer falha responde igual.
  select s.regulated
    into v_regulado
    from app.service s
    join app.professional_service ps on ps.service_id = s.id and ps.professional_id = p_user
   where s.id = p_service_id
   limit 1;
  if not found or not v_regulado then
    out_code := 'service_denied';
    return next;
    return;
  end if;

  -- Liberacao preguicosa: pendentes vencidos deste profissional (de qualquer kind) deixam de contar.
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
    if v_row.kind = 'certificacao' and v_row.service_id = p_service_id then
      out_code := case when v_row.status = 'recebido' then 'replay_received' else 'replay' end;
    else
      out_code := 'client_upload_em_uso';
    end if;
    out_id := v_row.id;
    out_status := v_row.status;
    return next;
    return;
  end if;

  select count(*) into v_pendentes
    from app.identity_document d
   where d.professional_id = p_user
     and d.service_id = p_service_id
     and d.kind = 'certificacao'
     and d.status = 'pendente_envio'
     and d.purge_requested_at is null;
  if v_pendentes >= 1 then
    out_code := 'limite_certificacao';
    return next;
    return;
  end if;

  -- Teto global (decisao 220), mesma trava consultiva de idoc_issue.
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

  insert into app.identity_document (professional_id, client_upload_id, kind, service_id,
                                     declared_type, declared_bytes, status, pending_expires_at, created_at)
  values (p_user, p_client_upload_id, 'certificacao', p_service_id, p_type, p_bytes, 'pendente_envio',
          p_now + interval '30 minutes', p_now)
  returning id, status into out_id, out_status;
  out_code := 'new';
  return next;
end;
$$;

-- 8. Lista do dono (idoc_list). Acrescenta kind e service_id. Sem tamanho, caminho ou nome.
--    Substituido e expurgo ficam de fora. Recriada: o formato de retorno mudou (create or replace nao aceita).
drop function if exists private.idoc_list(uuid, timestamptz);
create function private.idoc_list(p_user uuid, p_now timestamptz)
returns table (out_id uuid, out_file_kind text, out_status text, out_received_at timestamptz,
               out_deletable boolean, out_kind text, out_service_id uuid)
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
         (d.analyzed_at is null),
         d.kind::text,
         d.service_id
    from app.identity_document d
   where d.professional_id = p_user
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido')
     and (d.status = 'recebido' or d.pending_expires_at > p_now)
   order by d.created_at, d.id;
end;
$$;

-- 9. Conclusao (idoc_confirm_done). Identidade: mesmo comportamento da Issue 50, restrito a kind identidade.
--    Certificacao (D-H038-A2): serializa por (profissional, servico) com trava consultiva, marca a viva anterior
--    como substituido e so depois grava a nova como recebido, na mesma transacao (R-04, CA-H038-05).
--    out: received | lost | gone.
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
  v_anterior uuid;
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

  if v_row.kind = 'certificacao' then
    perform pg_advisory_xact_lock(hashtext('identity_cert:' || p_user::text || ':' || v_row.service_id::text));
    update app.identity_document d
       set status = 'substituido'
     where d.professional_id = p_user
       and d.service_id = v_row.service_id
       and d.kind = 'certificacao'
       and d.id <> p_id
       and d.status = 'recebido'
       and d.purge_requested_at is null
    returning d.id into v_anterior;
  end if;

  update app.identity_document d
     set status = 'recebido',
         stored_type = p_stored_type,
         stored_bytes = p_stored_bytes,
         content_sha256 = p_sha256,
         received_at = p_now,
         lease_until = null
   where d.id = p_id;

  if v_row.kind = 'identidade'
     and exists (select 1 from app.professional_profile p
                  where p.user_id = p_user and p.verification_status = 'recusada') then
    update app.identity_document d
       set status = 'substituido'
     where d.professional_id = p_user
       and d.id <> p_id
       and d.kind = 'identidade'
       and d.status = 'recebido'
       and d.analyzed_at is not null
       and d.purge_requested_at is null;
  end if;

  if v_row.kind = 'certificacao' then
    if v_anterior is not null then
      perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.cert.replaced',
        'identity_document', v_anterior, '{}'::jsonb, '{}'::jsonb, null, null);
    end if;
    perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.cert.received',
      'identity_document', p_id, '{}'::jsonb,
      jsonb_build_object('file_kind', case when p_stored_type = 'application/pdf' then 'pdf' else 'imagem' end,
                         'size_bytes', p_stored_bytes),
      null, null);
    return 'received';
  end if;

  perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.received',
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('file_kind', case when p_stored_type = 'application/pdf' then 'pdf' else 'imagem' end,
                       'size_bytes', p_stored_bytes),
    null, null);
  return 'received';
end;
$$;

-- 10. Exclusao pelo dono (idoc_delete). Vale para certificacao (CA-H038-11): so enquanto nao analisada.
--     out: deleted | not_found | already_analyzed. Evento: identity.cert.deleted (certificacao) ou identity.doc.deleted.
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

  perform private.audit_append('professional:' || p_user::text, 'professional',
    case when v_row.kind = 'certificacao' then 'identity.cert.deleted' else 'identity.doc.deleted' end,
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('file_kind', case when coalesce(v_row.stored_type, v_row.declared_type) = 'application/pdf'
                                        then 'pdf' else 'imagem' end,
                       'size_bytes', coalesce(v_row.stored_bytes, v_row.declared_bytes)),
    null, null);
  return 'deleted';
end;
$$;

-- 11. Verificacao de certificacoes (private.certificacoes_completas, contrato da Issue 52, desenho 148 §3.1).
--     true: nao ha servico regulamentado vinculado sem certificacao recebida e sem expurgo. Nunca devolve nulo.
create or replace function private.certificacoes_completas(p_professional uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from app.professional_service ps
      join app.service s on s.id = ps.service_id
     where ps.professional_id = p_professional
       and s.regulated
       and not exists (
         select 1
           from app.identity_document d
          where d.professional_id = p_professional
            and d.service_id = s.id
            and d.kind = 'certificacao'
            and d.status = 'recebido'
            and d.purge_requested_at is null));
$$;

-- 12. Consulta por servico (desenho 148 §3.3, D-H038-A4): usada pela guarda da Issue 68. Nao altera nada.
create or replace function private.certificacao_servico_ok(p_professional uuid, p_service uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from app.service s where s.id = p_service and s.regulated)
      or exists (
         select 1
           from app.identity_document d
          where d.professional_id = p_professional
            and d.service_id = p_service
            and d.kind = 'certificacao'
            and d.status = 'recebido'
            and d.purge_requested_at is null);
$$;

-- 13. Permissoes: so app_system executa; PUBLIC, anon, authenticated e app_api ficam sem execucao.
--     Somente app_system executa (mesmo padrao de 20261112220000).
revoke all on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_list(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_delete(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.certificacoes_completas(uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.certificacao_servico_ok(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint) to app_system;
grant execute on function private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint) to app_system;
grant execute on function private.idoc_list(uuid, timestamptz) to app_system;
grant execute on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz) to app_system;
grant execute on function private.idoc_delete(uuid, uuid, timestamptz) to app_system;
grant execute on function private.certificacoes_completas(uuid) to app_system;
grant execute on function private.certificacao_servico_ok(uuid, uuid) to app_system;

-- 14. Catalogo de auditoria da certificacao. Mesmas chaves permitidas de identidade; sem nome, caminho ou IP (CA-H038-10).
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('identity.cert.received', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Certificacao recebida'),
  ('identity.cert.replaced', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Certificacao substituida por nova versao'),
  ('identity.cert.deleted', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Certificacao excluida pelo dono')
on conflict (action, object_type) do nothing;

comment on function private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint) is
  'Emissao de certificacao de servico regulamentado (H-038, Issue 51). Cota propria; sem limite de identidade.';
comment on function private.certificacoes_completas(uuid) is
  'Gate da verificacao (Issue 52): true se todo servico regulamentado vinculado tem certificacao recebida.';
comment on function private.certificacao_servico_ok(uuid, uuid) is
  'Consulta por servico para a guarda de elegibilidade (Issue 68). Somente leitura.';
