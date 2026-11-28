-- Decisao do dono (2026-11-27):
--   1. Um servico regulamentado aceita ate 5 arquivos de certificacao; um envio novo SOMA, nao substitui.
--   2. Arquivo novo reabre tambem o caso APROVADO como 'pendente': o profissional volta a "em analise" (e deixa de
--      receber pedidos e de aparecer no perfil publico) ate a nova aprovacao.

-- 1. Varios arquivos por servico.
drop index if exists app.identity_document_cert_viva_key;

create or replace function private.idoc_confirm_done(p_user uuid, p_id uuid, p_attempt smallint, p_stored_type text,
  p_stored_bytes integer, p_sha256 bytea, p_now timestamp with time zone)
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

  perform private.audit_append('professional:' || p_user::text, 'professional',
    case when v_row.kind = 'certificacao' then 'identity.cert.received' else 'identity.doc.received' end,
    'identity_document', p_id, '{}'::jsonb,
    jsonb_build_object('file_kind', case when p_stored_type = 'application/pdf' then 'pdf' else 'imagem' end,
                       'size_bytes', p_stored_bytes),
    null, null);
  return 'received';
end;
$$;

-- Cota: no maximo 5 arquivos recebidos por servico (e um envio pendente por vez, como antes).
do $$
declare
  v_def text := pg_get_functiondef('private.idoc_issue_cert(uuid,uuid,uuid,text,integer,timestamptz,bigint)'::regprocedure);
  v_antes text := 'if v_pendentes >= 1 then';
  v_depois text := 'if v_pendentes >= 1
     or (select count(*) from app.identity_document d
          where d.professional_id = p_user and d.service_id = p_service_id and d.kind = ''certificacao''
            and d.status = ''recebido'' and d.purge_requested_at is null) >= 5 then';
begin
  if position(v_antes in v_def) = 0 then
    raise exception 'idoc_issue_cert_inesperada';
  end if;
  execute replace(v_def, v_antes, v_depois);
end
$$;

-- Detalhe do admin: arquivos do mesmo servico em ordem estavel (a tela os identifica pela posicao).
do $$
declare
  v_def text := pg_get_functiondef('private.verification_case_certificates(uuid,text,uuid,timestamptz)'::regprocedure);
begin
  if position('order by s.name, s.id;' in v_def) = 0 then
    raise exception 'certificacoes_do_caso_inesperada';
  end if;
  execute replace(v_def, 'order by s.name, s.id;', 'order by s.name, s.id, d.received_at, d.id;');
end
$$;

-- 2. Aprovada -> pendente.
create or replace function private.verification_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pendente', 'em_revisao'),
    ('em_revisao', 'em_revisao'),
    ('em_revisao', 'aprovada'),
    ('em_revisao', 'recusada'),
    ('em_revisao', 'retida_duplicidade'),
    ('retida_duplicidade', 'aprovada'),
    ('retida_duplicidade', 'recusada'),
    ('retida_duplicidade', 'retida_duplicidade'),
    ('recusada', 'em_revisao'),
    ('recusada', 'pendente'),
    ('aprovada', 'pendente'),
    ('retida_duplicidade', 'em_revisao'))
$$;

do $$
declare
  v_def text := pg_get_functiondef('private.professional_profile_guard_update()'::regprocedure);
  v_antes text := 'and old.verification_status = ''recusada''
          and private.verification_case_mirrors';
  v_depois text := 'and old.verification_status in (''recusada'', ''aprovada'')
          and private.verification_case_mirrors';
begin
  v_def := replace(v_def, chr(13), '');
  v_antes := replace(v_antes, chr(13), '');
  if position(v_antes in v_def) = 0 then
    raise exception 'guarda_do_perfil_inesperada';
  end if;
  execute replace(v_def, v_antes, replace(v_depois, chr(13), ''));
end
$$;

create or replace function private.verification_case_reopen(p_professional uuid, p_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_audit uuid;
begin
  select * into v_case from app.verification_case c where c.professional_id = p_professional for update;
  if not found or v_case.status not in ('recusada', 'aprovada') or p_at < v_case.decided_at then
    return false;
  end if;
  if exists (select 1 from app.professional_profile p
              where p.user_id = p_professional and p.verification_status = 'suspensa') then
    return false;
  end if;

  update app.verification_case c
     set status = 'pendente', assigned_to = null, assigned_at = null,
         sla_target_at = private.verification_sla_target(p_at), updated_at = p_at
   where c.id = v_case.id;
  if not private.verification_profile_mirror_blocked(p_professional) then
    update app.professional_profile p
       set verification_status = 'pendente', updated_at = p_at
     where p.user_id = p_professional and p.verification_status in ('recusada', 'aprovada');
  end if;

  v_audit := private.audit_append('professional:' || p_professional::text, 'profissional',
    'verification.case.resubmitted', 'verification_case', v_case.id,
    jsonb_build_object('status', v_case.status), '{"status":"pendente"}'::jsonb, null, null);
  perform private.verification_event_add(v_case.id, 'resubmitted', null, 'profissional', v_case.status,
    'pendente', null, null, v_audit, p_at);
  return true;
end
$$;

-- Certificacoes trocadas depois da aprovacao, antes desta regra: voltam para analise.
do $$
declare
  r record;
begin
  for r in
    select c.professional_id
      from app.verification_case c
     where c.status = 'aprovada'
       and exists (select 1 from app.identity_document d
                    where d.professional_id = c.professional_id and d.status = 'recebido'
                      and d.purge_requested_at is null and d.received_at > c.decided_at)
  loop
    perform private.verification_case_reopen(r.professional_id, clock_timestamp());
  end loop;
end
$$;
