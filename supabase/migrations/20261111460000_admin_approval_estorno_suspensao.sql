-- H-105 (Issue 114) | Dupla aprovacao para estorno e suspensao permanente (docs/factory/80-DESENHO-H105.md §2).
-- Idempotente. Desfazer: supabase/rollbacks/20261111460000_admin_approval_estorno_suspensao.down.sql.
-- Numero 20261111460000 (e nao 20261111450000 do desenho): a 450000 ja e de catalog_revision_list.
-- Depende de 20261111190000 (approval_request/vote), 20261111220000 (RBAC e private.admin_approval_vote),
-- 20261111290000 (private.access_case_session_totp, prova recente), 20261111300000 (acesso_conversa) e
-- 20261111420000 (guarda de professional_profile, reescrita aqui so para aceitar a suspensao).
-- Sem tabela nova. Colunas novas anulaveis; linhas existentes nao mudam (tipos antigos ficam com os campos nulos).
-- Postura igual a H-102/H-073: RLS forcada, funcoes so para app_system. Toda decisao grava auditoria na
-- MESMA transacao (private.audit_append), exceto a negacao de voto, gravada em transacao propria (80 §4).

-- 1. Colunas do pedido: alvo (sem FK: pagamento ainda nao existe e o profissional nao e admin_staff),
--    valor em centavos (so estorno) e motivo (so aqui, texto livre; 80 R-7). -----------------------------
alter table app.approval_request add column if not exists subject_ref uuid;
alter table app.approval_request add column if not exists amount_cents integer;
alter table app.approval_request add column if not exists reason text;

-- 2. Constraints recriadas com a lista vigente completa (padrao R-8 de 60) ------------------------------
alter table app.approval_request drop constraint if exists approval_request_required_approvals_check;
alter table app.approval_request add constraint approval_request_required_approvals_check
  check (required_approvals in (1, 2));

alter table app.approval_request drop constraint if exists approval_request_action_type_check;
alter table app.approval_request add constraint approval_request_action_type_check
  check (action_type in ('papel_superadmin', 'mfa_reenroll', 'acesso_conversa', 'estorno', 'suspensao_permanente'));

alter table app.approval_request drop constraint if exists approval_request_amount_positivo;
alter table app.approval_request add constraint approval_request_amount_positivo
  check (amount_cents is null or amount_cents > 0);

alter table app.approval_request drop constraint if exists approval_request_reason_tamanho;
alter table app.approval_request add constraint approval_request_reason_tamanho
  check (reason is null or char_length(btrim(reason)) between 10 and 500);

-- Votos exigidos pelo valor (RF-151, 78 §2): estorno 1 ate 20000 centavos e 2 acima; suspensao sempre 2.
alter table app.approval_request drop constraint if exists approval_request_votos_por_tipo;
alter table app.approval_request add constraint approval_request_votos_por_tipo check (
     (action_type = 'estorno' and required_approvals = case when amount_cents <= 20000 then 1 else 2 end)
  or (action_type = 'suspensao_permanente' and required_approvals = 2)
  or (action_type not in ('estorno', 'suspensao_permanente') and required_approvals = 1));

-- Campos por tipo: o novo tipo exige alvo, motivo (e valor, so no estorno); os antigos nao tem nenhum deles.
alter table app.approval_request drop constraint if exists approval_request_campos_por_tipo;
alter table app.approval_request add constraint approval_request_campos_por_tipo check (
     (action_type = 'estorno' and subject_ref is not null and amount_cents is not null
        and reason is not null and subject_user_id is null)
  or (action_type = 'suspensao_permanente' and subject_ref is not null and amount_cents is null
        and reason is not null and subject_user_id is null)
  or (action_type not in ('estorno', 'suspensao_permanente') and subject_ref is null
        and amount_cents is null and reason is null));

-- 3. Um pedido aberto por alvo (pendente ou aprovada). Pedido vencido sai do indice ao ser marcado expirada.
create unique index if not exists approval_request_alvo_aberto_key
  on app.approval_request (action_type, subject_ref)
  where status in ('pendente', 'aprovada') and subject_ref is not null;

-- 4. Campos do pedido nao mudam depois de gravados (R-4): valor, alvo, motivo, tipo, solicitante e prazos.
create or replace function private.approval_request_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action_type is distinct from old.action_type
     or new.subject_ref is distinct from old.subject_ref
     or new.amount_cents is distinct from old.amount_cents
     or new.reason is distinct from old.reason
     or new.requested_by is distinct from old.requested_by
     or new.required_approvals is distinct from old.required_approvals
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'aprovacao_origem_imutavel' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists approval_request_guard_update on app.approval_request;
create trigger approval_request_guard_update
  before update on app.approval_request
  for each row execute function private.approval_request_guard_update();

-- 5. Guarda de voto por tipo (recriada com todos os ramos). Em todos: aprovador ativo, diferente do
--    solicitante e do alvo, um voto por pessoa, pedido pendente (gatilhos da 220000, sem afrouxar nada).
create or replace function private.approval_vote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
begin
  select * into v_req from app.approval_request r where r.id = new.approval_request_id;
  if not found then
    raise exception 'aprovacao_inexistente' using errcode = '23503';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'aprovacao_nao_pendente' using errcode = '23514';
  end if;
  if new.approver_id = v_req.requested_by or new.approver_id = v_req.subject_user_id then
    raise exception 'aprovacao_propria' using errcode = '42501';
  end if;
  if not exists (select 1 from app.admin_staff s where s.user_id = new.approver_id and s.status = 'ativo') then
    raise exception 'aprovador_nao_ativo' using errcode = '42501';
  end if;

  if v_req.action_type = 'acesso_conversa' then
    if not private.admin_has_permission(new.approver_id, 'case.authorize_sensitive') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  elsif v_req.action_type = 'estorno' then
    if not private.admin_has_permission(new.approver_id, 'finance.refund.approve') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  elsif v_req.action_type = 'suspensao_permanente' then
    if new.approver_id = v_req.subject_ref then
      raise exception 'aprovacao_propria' using errcode = '42501';
    end if;
    if not private.admin_has_permission(new.approver_id, 'account.suspend.approve') then
      raise exception 'aprovador_sem_permissao' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1
        from app.admin_staff s
        join app.admin_user_role r on r.user_id = s.user_id and r.revoked_at is null
       where s.user_id = new.approver_id and s.status = 'ativo' and r.role_code = 'superadmin'
    ) then
      raise exception 'aprovador_nao_superadmin' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- 6. Guarda do perfil profissional: a suspensao permanente e a unica troca de status nova. So vale se o
--    pedido de suspensao do mesmo profissional foi consumido nesta mesma transacao (mesmo instante).
--    Resto da regra igual a 20261111420000.
create or replace function private.professional_profile_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.document_hmac is not null and (
       new.public_name is distinct from old.public_name
    or new.slug is distinct from old.slug
    or new.document_type is distinct from old.document_type
    or new.document_enc is distinct from old.document_enc
    or new.document_hmac is distinct from old.document_hmac) then
    raise exception 'professional_documento_imutavel' using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (
         (old.document_hmac is null
          and old.verification_status = 'pendente'
          and new.verification_status in ('pendente', 'retida_duplicidade')
          and new.document_hmac is not null)
      or (new.verification_status = 'suspensa'
          and old.verification_status <> 'suspensa'
          and new.suspended_at is not null
          and exists (
            select 1 from app.approval_request r
             where r.action_type = 'suspensao_permanente'
               and r.subject_ref = new.user_id
               and r.status = 'consumida'
               and r.consumed_at = new.suspended_at))
    ) then
      raise exception 'professional_status_protegido' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- 7. Permissoes novas (80 §1 e D-7-2): Suporte pede suspensao; Moderador aprova. Superadmin nao herda.
insert into app.admin_permission (code, label) values
  ('account.suspend.request', 'Solicitar suspensao de conta'),
  ('account.suspend.approve', 'Aprovar suspensao de conta')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('suporte', 'account.suspend.request'),
  ('moderador', 'account.suspend.approve')
on conflict do nothing;

-- 8. Acoes de auditoria (80 §4). Chaves de estado sem dado pessoal; motivo nunca vai para a auditoria.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('approval.requested', 'approval_request', false, array['status', 'action_type', 'required_approvals', 'amount_cents'],
   'Pedido de dupla aprovacao aberto (H-105)'),
  ('approval.voted', 'approval_request', false, array['status', 'votes', 'required_approvals'],
   'Voto registrado em pedido de dupla aprovacao (H-105)'),
  ('approval.cancelled', 'approval_request', false, array['status'],
   'Pedido de dupla aprovacao cancelado pelo solicitante (H-105)'),
  ('approval.expired', 'approval_request', false, array['status'],
   'Pedido de dupla aprovacao vencido, sem efeito (H-105)'),
  ('approval.vote_denied', 'approval_request', true, array['status'],
   'Voto negado em pedido de dupla aprovacao (H-105; gravado em transacao propria)')
on conflict (action) do nothing;

-- 9. Funcoes (security definer, search_path vazio, prazo injetado em p_now) -------------------------------

-- 9.1 Abrir pedido. Ordem: permissao do tipo, sessao e prova recente (30 min), alvo, valor, motivo, alvo
--     ainda sem pedido aberto (vencidos do alvo viram expirada antes), limite de 5 pendentes por solicitante.
create or replace function private.approval_dual_open(
  p_actor uuid, p_session_hash text, p_action text, p_subject uuid, p_amount integer, p_reason text,
  p_id uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_totp timestamptz;
  v_old record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_required smallint;
begin
  if p_actor is null or p_session_hash is null or p_action is null or p_id is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if p_action not in ('estorno', 'suspensao_permanente') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not private.admin_has_permission(
       p_actor, case when p_action = 'estorno' then 'finance.refund.request' else 'account.suspend.request' end) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not (p_now < v_totp + interval '30 minutes') then
    raise exception 'step_up_required' using errcode = 'ADM21';
  end if;
  if p_subject is null then
    raise exception 'alvo_invalido' using errcode = 'ADM22';
  end if;
  if p_action = 'estorno' and (p_amount is null or p_amount <= 0) then
    raise exception 'valor_invalido' using errcode = 'ADM22';
  end if;
  if p_action = 'suspensao_permanente' and p_amount is not null then
    raise exception 'valor_invalido' using errcode = 'ADM22';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'motivo_invalido' using errcode = 'ADM22';
  end if;
  if p_action = 'suspensao_permanente'
     and not exists (select 1 from app.professional_profile pp where pp.user_id = p_subject) then
    raise exception 'alvo_invalido' using errcode = 'ADM22';
  end if;

  -- Serializa pedidos do mesmo alvo (20 simultaneos = 1 pedido) e do mesmo solicitante (limite).
  perform pg_advisory_xact_lock(hashtext('approval_dual_alvo:' || p_action || ':' || p_subject::text));
  perform pg_advisory_xact_lock(hashtext('approval_dual_pedidor:' || p_actor::text));

  for v_old in
    select r.id from app.approval_request r
     where r.action_type = p_action and r.subject_ref = p_subject
       and r.status in ('pendente', 'aprovada') and r.expires_at <= p_now
     for update
  loop
    update app.approval_request set status = 'expirada' where id = v_old.id;
    perform private.audit_append('admin:' || p_actor::text, 'admin', 'approval.expired',
      'approval_request', v_old.id, '{}'::jsonb, '{"status":"expirada"}'::jsonb, null, null);
  end loop;

  if (select count(*) from app.approval_request r
       where r.requested_by = p_actor and r.action_type in ('estorno', 'suspensao_permanente')
         and r.status = 'pendente' and r.expires_at > p_now) >= 5 then
    raise exception 'muitos_pedidos_pendentes' using errcode = 'ADM24';
  end if;

  if exists (select 1 from app.approval_request r
              where r.action_type = p_action and r.subject_ref = p_subject
                and r.status in ('pendente', 'aprovada')) then
    raise exception 'pedido_ja_aberto' using errcode = 'ADM23';
  end if;

  v_required := case when p_action = 'estorno' and p_amount > 20000 then 2
                     when p_action = 'estorno' then 1
                     else 2 end;

  insert into app.approval_request (id, action_type, subject_user_id, detail_code, requested_by,
                                    required_approvals, status, created_at, expires_at,
                                    subject_ref, amount_cents, reason)
  values (p_id, p_action, null, null, p_actor, v_required, 'pendente', p_now,
          p_now + interval '24 hours', p_subject,
          case when p_action = 'estorno' then p_amount end, v_reason);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'approval.requested',
    'approval_request', p_id, '{}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('status', 'pendente', 'action_type', p_action,
      'required_approvals', v_required, 'amount_cents', p_amount)),
    null, null);
  return p_id;
end
$$;

-- 9.2 Votar. Permissao da familia, sessao e prova recente; depois o voto (admin_approval_vote, que trata
--     o prazo sem erro). Pedido vencido: marca expirada e devolve status 'expirada' (sem erro, para o
--     registro nao desfazer). Suspensao que chega a duas aprovacoes: consome e suspende na mesma transacao.
create or replace function private.approval_dual_vote(
  p_actor uuid, p_session_hash text, p_family text, p_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
  v_totp timestamptz;
  v_votes integer;
  v_status text;
begin
  if p_actor is null or p_session_hash is null or p_family is null or p_id is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if p_family not in ('estorno', 'suspensao_permanente') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not private.admin_has_permission(
       p_actor, case when p_family = 'estorno' then 'finance.refund.approve' else 'account.suspend.approve' end) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  v_totp := private.access_case_session_totp(p_actor, p_session_hash, p_now);
  if v_totp is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if not (p_now < v_totp + interval '30 minutes') then
    raise exception 'step_up_required' using errcode = 'ADM21';
  end if;

  select * into v_req from app.approval_request r where r.id = p_id for update;
  if not found or v_req.action_type <> p_family then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'aprovacao_nao_pendente' using errcode = 'ADM27';
  end if;

  if v_req.expires_at <= p_now then
    perform private.admin_approval_vote(p_id, p_actor, p_now);
    perform private.audit_append('admin:' || p_actor::text, 'admin', 'approval.expired',
      'approval_request', p_id, '{"status":"pendente"}'::jsonb, '{"status":"expirada"}'::jsonb, null, null);
    select count(*) into v_votes from app.approval_vote v where v.approval_request_id = p_id;
    return jsonb_build_object('status', 'expirada', 'votes', v_votes, 'required', v_req.required_approvals);
  end if;

  v_status := private.admin_approval_vote(p_id, p_actor, p_now);
  select count(*) into v_votes from app.approval_vote v where v.approval_request_id = p_id;

  if v_status = 'aprovada' and p_family = 'suspensao_permanente' then
    update app.approval_request set status = 'consumida', consumed_at = p_now where id = p_id;
    update app.professional_profile
       set verification_status = 'suspensa',
           suspended_at = p_now,
           suspension_reason = v_req.reason,
           updated_at = p_now
     where user_id = v_req.subject_ref;
    if not found then
      raise exception 'alvo_invalido' using errcode = 'ADM22';
    end if;
    perform private.audit_append('admin:' || p_actor::text, 'admin', 'professional.suspended',
      'professional_profile', v_req.subject_ref, '{}'::jsonb,
      jsonb_build_object('status', 'suspensa', 'suspension_kind', 'permanente', 'approval_request_id', p_id),
      'suspensao_permanente', null);
    v_status := 'consumida';
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'approval.voted',
    'approval_request', p_id,
    jsonb_build_object('status', 'pendente', 'votes', v_votes - 1),
    jsonb_build_object('status', v_status, 'votes', v_votes, 'required_approvals', v_req.required_approvals),
    null, null);

  return jsonb_build_object('status', v_status, 'votes', v_votes, 'required', v_req.required_approvals);
end
$$;

-- 9.3 Cancelar. So o solicitante, da familia certa, enquanto o pedido estiver aberto e dentro do prazo
--     (pendente, ou aprovada de estorno ainda nao executada). Repetir em rejeitada devolve rejeitada.
create or replace function private.approval_dual_cancel(
  p_actor uuid, p_family text, p_id uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
begin
  if p_actor is null or p_family is null or p_id is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_req from app.approval_request r where r.id = p_id for update;
  if not found or v_req.requested_by <> p_actor or v_req.action_type <> p_family then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_req.status = 'rejeitada' then
    return 'rejeitada';
  end if;
  if v_req.expires_at > p_now and (v_req.status = 'pendente'
       or (v_req.status = 'aprovada' and p_family = 'estorno')) then
    update app.approval_request set status = 'rejeitada' where id = p_id;
    perform private.audit_append('admin:' || p_actor::text, 'admin', 'approval.cancelled',
      'approval_request', p_id, jsonb_build_object('status', v_req.status),
      '{"status":"rejeitada"}'::jsonb, null, null);
    return 'rejeitada';
  end if;
  raise exception 'aprovacao_nao_pendente' using errcode = 'ADM27';
end
$$;

-- 9.4 Negacao de voto para a auditoria. Chamada pela API em transacao propria, depois do erro do voto.
--     Sem pedido do tipo, nao grava nada (devolve nulo): so pedido real entra na trilha.
create or replace function private.approval_dual_denied_record(
  p_actor uuid, p_family text, p_id uuid, p_reason_code text, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req app.approval_request%rowtype;
begin
  if p_actor is null or p_family is null or p_id is null or p_reason_code is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_req from app.approval_request r where r.id = p_id;
  if not found or v_req.action_type <> p_family then
    return null;
  end if;
  return private.audit_append('admin:' || p_actor::text, 'admin', 'approval.vote_denied',
    'approval_request', p_id, '{}'::jsonb, jsonb_build_object('status', v_req.status),
    p_reason_code, null);
end
$$;

-- 9.5 Listar. Meus pedidos da familia e os pendentes dentro do prazo que esta pessoa pode votar. Nunca
--     devolve o motivo. Pendente vencido aparece como expirada (sem gravar nada aqui).
create or replace function private.approval_dual_list(p_actor uuid, p_family text, p_now timestamptz)
returns table (
  out_id uuid,
  out_estado text,
  out_valor_centavos integer,
  out_subject_ref uuid,
  out_votos integer,
  out_required_approvals smallint,
  out_expires_at timestamptz,
  out_solicitado_por_mim boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         case when r.status in ('pendente', 'aprovada') and r.expires_at <= p_now then 'expirada' else r.status end,
         r.amount_cents,
         r.subject_ref,
         (select count(*)::integer from app.approval_vote v where v.approval_request_id = r.id),
         r.required_approvals,
         r.expires_at,
         r.requested_by = p_actor
    from app.approval_request r
   where r.action_type = p_family
     and (r.requested_by = p_actor
          or (r.status = 'pendente'
              and r.expires_at > p_now
              and private.admin_has_permission(p_actor, case when p_family = 'estorno'
                    then 'finance.refund.approve' else 'account.suspend.approve' end)
              and not exists (select 1 from app.approval_vote v
                               where v.approval_request_id = r.id and v.approver_id = p_actor)))
   order by r.created_at desc, r.id
$$;

-- 10. Privilegios: so app_system (como nas migracoes de H-102 e H-073) --------------------------------
revoke all on function
  private.approval_request_guard_update(),
  private.approval_vote_guard(),
  private.professional_profile_guard_update(),
  private.approval_dual_open(uuid, text, text, uuid, integer, text, uuid, timestamptz),
  private.approval_dual_vote(uuid, text, text, uuid, timestamptz),
  private.approval_dual_cancel(uuid, text, uuid, timestamptz),
  private.approval_dual_denied_record(uuid, text, uuid, text, timestamptz),
  private.approval_dual_list(uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  private.approval_dual_open(uuid, text, text, uuid, integer, text, uuid, timestamptz),
  private.approval_dual_vote(uuid, text, text, uuid, timestamptz),
  private.approval_dual_cancel(uuid, text, uuid, timestamptz),
  private.approval_dual_denied_record(uuid, text, uuid, text, timestamptz),
  private.approval_dual_list(uuid, text, timestamptz)
  to app_system;
