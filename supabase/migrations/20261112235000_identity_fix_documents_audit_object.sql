-- H-037 (Issue #50) | Correcao da 20261112220000: a recusa auditada por estado ou por limite (decisao 218) gravava
-- object_id nulo, e audit.audit_event.object_id e not null. Passa a usar o proprio profissional como objeto
-- (a recusa nao tem documento). Migracao de correcao: a 20261112220000 ja aplicada no DEV nao e editada (checksum).
-- Recria private.idoc_issue com a mesma assinatura, o mesmo corpo e as mesmas permissoes (create or replace
-- preserva o grant de app_system). Idempotente. Desfazer: a 20261112220000 .down.sql remove a funcao.

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
