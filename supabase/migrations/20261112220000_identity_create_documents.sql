-- H-037 (Issue #50) | Documentos de identidade do profissional (docs/factory/107-DESENHO-H037.md §2, §4, §5, §6.5;
-- decisoes 170 a 189 e 213 a 228 de 11-DECISOES.md).
-- Idempotente. Desfazer: supabase/rollbacks/20261112220000_identity_create_documents.down.sql (recusa se houver dados).
-- Migracao por expansao: so cria objetos novos (buckets, tabela, gatilho, funcoes, linhas de catalogo de auditoria).
-- Nao altera professional_profile, app_user, media_asset, quarentena nem buckets de fotos (R6, R7).
-- Documento nao e foto: buckets, chaves e tabela proprios. Nenhuma politica em storage.objects para os dois buckets.
-- Ninguem le depois do envio: nenhuma funcao devolve caminho, bytes ou URL. A leitura da Verificacao e da #52.
-- Tempo: p_now informado pelo chamador (relogio do servidor), para prazos, teto e testes.
-- Constantes espelhadas no dominio (packages/domain/src/identity-docs/constants.ts): pendente de 30 min,
-- 5 vivos por perfil, 5 MiB de entrada, 2 MiB de PDF e de arquivo final.

-- 1. Buckets privados (idempotentes). Entrada aceita imagem e PDF ate 5 MiB; final so JPEG e PDF ate 2 MiB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-incoming', 'identity-incoming', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-docs', 'identity-docs', false, 2097152,
        array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Tabela do documento. Sem nome original, EXIF, IP, caminho, texto livre ou tamanho exposto (CA-10, RN-11).
create table if not exists app.identity_document (
  id                 uuid primary key default gen_random_uuid(),
  professional_id    uuid not null references app.professional_profile (user_id) on delete restrict,
  client_upload_id   uuid not null,
  kind               text not null default 'identidade' check (kind in ('identidade')),
  declared_type      text not null check (declared_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  declared_bytes     integer not null check (declared_bytes between 1 and 5242880),
  status             text not null default 'pendente_envio'
                       check (status in ('pendente_envio', 'recebido', 'substituido')),
  stored_type        text check (stored_type in ('image/jpeg', 'application/pdf')),
  stored_bytes       integer check (stored_bytes between 1 and 2097152),
  content_sha256     bytea check (octet_length(content_sha256) = 32),
  pending_expires_at timestamptz not null,
  lease_until        timestamptz,
  attempts           smallint not null default 0 check (attempts between 0 and 3),
  received_at        timestamptz,
  analyzed_at        timestamptz,
  purge_requested_at timestamptz,
  created_at         timestamptz not null default clock_timestamp(),
  constraint identity_document_recebido_ck check (
    status <> 'recebido'
    or (stored_type is not null and stored_bytes is not null and received_at is not null
        and content_sha256 is not null)),
  constraint identity_document_analise_ck check (
    analyzed_at is null or status in ('recebido', 'substituido'))
);
comment on table app.identity_document is
  'Documento de identidade do profissional (H-037, 107 §4.1). Escrita so por funcao; o arquivo mora em identity-incoming ou identity-docs.';

-- Idempotencia por profissional (CA-11 de H-026 aplicado a documento). Parcial: linha marcada para expurgo nao bloqueia.
create unique index if not exists identity_document_cliente_vivo_key
  on app.identity_document (professional_id, client_upload_id) where purge_requested_at is null;
create index if not exists identity_document_profissional_vivo_idx
  on app.identity_document (professional_id) where purge_requested_at is null;
create index if not exists identity_document_pendente_vencimento_idx
  on app.identity_document (pending_expires_at)
  where status = 'pendente_envio' and purge_requested_at is null;
create index if not exists identity_document_purge_idx
  on app.identity_document (purge_requested_at) where purge_requested_at is not null;

alter table app.identity_document enable row level security;
alter table app.identity_document force row level security;
revoke all on app.identity_document
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

-- 3. Limite de 5 documentos vivos por profissional como invariante do banco (CA-05, RN-05).
--    Trava a linha do perfil (serializa insercoes simultaneas) e conta as vivas antes de inserir.
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

drop trigger if exists identity_document_limite on app.identity_document;
create trigger identity_document_limite
  before insert on app.identity_document
  for each row execute function private.idoc_limite();

-- 4. Emissao (idoc_issue). Ordem: perfil travado -> e-mail verificado -> estado que aceita envio ->
--    libera pendentes vencidos deste profissional -> repeticao do client_upload_id -> limite de 5 ->
--    teto global em bytes sob trava consultiva -> insercao (pendente, 30 min).
--    Nao altera verification_status (CA-09). out_code: new | replay | replay_received | no_profile |
--    email_unverified | state_denied | doc_limit | cap.
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
      'identity_document', null, '{}'::jsonb, jsonb_build_object('reason_code', 'estado_nao_aceita'),
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
     and d.purge_requested_at is null
     and d.status in ('pendente_envio', 'recebido');
  if v_vivas >= 5 then
    perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.refused',
      'identity_document', null, '{}'::jsonb, jsonb_build_object('reason_code', 'limite_documentos'),
      null, null);
    out_code := 'doc_limit';
    return next;
    return;
  end if;

  -- Teto global (D-8, decisao 220): soma dos objetos gravados mais 2 MiB por reserva pendente.
  -- Trava consultiva transacional: a emissao de documento e rara, a corrida fica fechada.
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

-- 5. Lista do dono (idoc_list). Sem tamanho, sem caminho, sem nome. Substituido e expurgo ficam de fora.
create or replace function private.idoc_list(p_user uuid, p_now timestamptz)
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

-- 6. Inicio da finalizacao (idoc_confirm_begin): posse, validade, lease de p_lease_s e tentativas (maximo 3).
--    out_code: begin | replay | not_found | expired | busy | too_many.
create or replace function private.idoc_confirm_begin(
  p_user uuid,
  p_id uuid,
  p_now timestamptz,
  p_lease_s integer)
returns table (out_code text, out_attempt smallint, out_declared_type text, out_stored_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.identity_document;
begin
  if p_user is null or p_id is null or p_now is null or p_lease_s is null or p_lease_s < 1 then
    raise exception 'idoc_entrada_invalida' using errcode = '22023';
  end if;

  select d.* into v_row
    from app.identity_document d
   where d.id = p_id and d.professional_id = p_user and d.purge_requested_at is null
   for update;
  if not found then
    out_code := 'not_found';
    return next;
    return;
  end if;
  if v_row.status = 'recebido' then
    out_code := 'replay';
    out_attempt := v_row.attempts;
    out_declared_type := v_row.declared_type;
    out_stored_type := v_row.stored_type;
    return next;
    return;
  end if;
  if v_row.status <> 'pendente_envio' then
    out_code := 'not_found';
    return next;
    return;
  end if;
  if v_row.pending_expires_at <= p_now then
    out_code := 'expired';
    return next;
    return;
  end if;
  if v_row.lease_until is not null and v_row.lease_until > p_now then
    out_code := 'busy';
    return next;
    return;
  end if;
  if v_row.attempts >= 3 then
    out_code := 'too_many';
    return next;
    return;
  end if;

  update app.identity_document d
     set attempts = d.attempts + 1,
         lease_until = p_now + make_interval(secs => p_lease_s)
   where d.id = p_id
  returning d.attempts into out_attempt;
  out_code := 'begin';
  out_declared_type := v_row.declared_type;
  out_stored_type := null;
  return next;
end;
$$;

-- 7. Conclusao (idoc_confirm_done): grava 'recebido' e a auditoria na mesma transacao (CA-14).
--    Se o perfil estiver 'recusada', os documentos ja analisados viram 'substituido' e liberam vaga (decisao 217).
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

-- 8. Recusa por conteudo (idoc_confirm_refuse): marca para expurgo e audita com codigo fixo (decisao 218).
--    out: refused | lost | gone.
create or replace function private.idoc_confirm_refuse(
  p_user uuid,
  p_id uuid,
  p_attempt smallint,
  p_code text,
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
     set purge_requested_at = p_now,
         lease_until = null
   where d.id = p_id;

  perform private.audit_append('professional:' || p_user::text, 'professional', 'identity.doc.refused',
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('reason_code', p_code),
    null, null);
  return 'refused';
end;
$$;

-- 9. Devolve a lease. p_count = false devolve a tentativa (falha transitoria, decisao 84 a 86 de H-027).
create or replace function private.idoc_confirm_release(p_id uuid, p_attempt smallint, p_count boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.identity_document d
     set lease_until = null,
         attempts = case when p_count then d.attempts else greatest(d.attempts - 1, 0) end
   where d.id = p_id
     and d.attempts = p_attempt
     and d.status = 'pendente_envio';
end;
$$;

-- 10. Exclusao pelo dono (idoc_delete), tambem cancela envio pendente. Nao exclui documento analisado (decisao 180).
--     out: deleted | not_found | already_analyzed.
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

-- 11. Varredura (idoc_sweep): marca pendentes vencidos e devolve o que deve ser removido do Storage.
--     Devolve id, se ha objeto na entrada (pendente) e se ha objeto no final (gravado). Limite por rodada.
create or replace function private.idoc_sweep(p_now timestamptz, p_limit integer)
returns table (out_id uuid, out_staging boolean, out_final boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'idoc_entrada_invalida' using errcode = '22023';
  end if;

  update app.identity_document d
     set purge_requested_at = p_now
   where d.status = 'pendente_envio'
     and d.purge_requested_at is null
     and d.pending_expires_at <= p_now;

  return query
  select d.id,
         (d.status = 'pendente_envio'),
         (d.stored_bytes is not null)
    from app.identity_document d
   where d.purge_requested_at is not null
   order by d.purge_requested_at, d.id
   limit p_limit;
end;
$$;

-- 12. Conclui o expurgo depois que o Storage confirmou a remocao (idoc_purge_done). Devolve quantas linhas saíram.
create or replace function private.idoc_purge_done(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from app.identity_document d
   where d.id = any(p_ids)
     and d.purge_requested_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 13. Ids conhecidos (idoc_known_pending): para a varredura de orfaos da entrada, qualquer linha conhecida protege o objeto.
create or replace function private.idoc_known_pending(p_ids uuid[])
returns table (out_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.id from app.identity_document d where d.id = any(p_ids);
end;
$$;

-- 14. Permissoes: nada para anon, authenticated, service_role, PUBLIC, app_api nem app_backup_reader.
--     Somente app_system executa (rotas do profissional rodam com app_system, como H-035 e H-036).
revoke all on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_list(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_begin(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_refuse(uuid, uuid, smallint, text, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_confirm_release(uuid, smallint, boolean)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_delete(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_sweep(timestamptz, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_purge_done(uuid[])
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.idoc_known_pending(uuid[])
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint) to app_system;
grant execute on function private.idoc_list(uuid, timestamptz) to app_system;
grant execute on function private.idoc_confirm_begin(uuid, uuid, timestamptz, integer) to app_system;
grant execute on function private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz) to app_system;
grant execute on function private.idoc_confirm_refuse(uuid, uuid, smallint, text, timestamptz) to app_system;
grant execute on function private.idoc_confirm_release(uuid, smallint, boolean) to app_system;
grant execute on function private.idoc_delete(uuid, uuid, timestamptz) to app_system;
grant execute on function private.idoc_sweep(timestamptz, integer) to app_system;
grant execute on function private.idoc_purge_done(uuid[]) to app_system;
grant execute on function private.idoc_known_pending(uuid[]) to app_system;

-- 15. Catalogo de auditoria (sem chave proibida: file_kind, size_bytes, reason_code). Sem PII (CA-10, CA-14).
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('identity.doc.received', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Documento de identidade recebido'),
  ('identity.doc.refused', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Documento de identidade recusado'),
  ('identity.doc.deleted', 'identity_document', false, array['file_kind', 'size_bytes', 'reason_code'],
   'Documento de identidade excluido pelo dono')
on conflict (action, object_type) do nothing;

-- 16. Buckets: nenhuma politica em storage.objects para identity-incoming ou identity-docs (CA-06).
--     A retention_policy de identity-docs nao e tocada e permanece desligada (RN-08, CA-08).
