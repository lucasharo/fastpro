-- Issue 120 (H-111) | Direitos do titular: jobs (ops.job) e tipos de e-mail que ainda fazem sentido sem o aviso final
-- (docs/factory/147-DESENHO-H111.md §4.4, §8, passo 8; decisoes do lider P1 a P8 sobre a fatia 6). Oitava fatia do
-- desenho. Expansiva: triggers de enfileiramento, funcoes-alvo para os handlers, uma linha de catalogo de auditoria.
-- Nenhuma tabela existente recebe coluna nova. Nenhum envio real: a linha de e-mail fica pendente na ops.email_outbox,
-- e o destinatario e resolvido pelo cadastro no momento do envio.
-- O que esta fatia faz:
--   - dsr.process_auto: ao abrir eliminacao pelo titular, enfileira o processamento automatico (677). A funcao
--     app.dsr_job_process_auto so age se a conta estiver em em_eliminacao e sem perfil profissional, sem pedido e sem
--     bloqueio legal (P1 e P2 ficam fora; o caso segue para o operador). Sem nenhuma etapa parcial: tudo ou nada.
--   - dsr.auth_cleanup: ao anonimizar a conta, enfileira a remocao do usuario no Supabase Auth (passo do handler, D-A5).
--   - dsr.export_purge: ao registrar um extrato, enfileira o expurgo no vencimento. Quem apaga o arquivo e o handler
--     (Storage), que chama app.dsr_job_export_target e so depois app.dsr_job_export_mark_purged.
--   - dsr_indeferido: aviso de indeferimento fundamentado (e-mail 3, sem aviso final de eliminacao, decisao P5).
-- O que NAO esta aqui (pendencias, cada uma com handler ou decisao proprios): handlers em TypeScript que chamam APIs
-- externas (Auth, Storage, provedor de pagamento); cancelamento de assinatura (campo de billing.subscription ainda
-- nao confirmado no DEV, DV-6); modelo do texto dos e-mails; abertura assistida; aplicacao de correcao.
-- Desfazer: supabase/rollbacks/20261113530000_privacy_create_dsr_jobs.down.sql (recusa se houver job pendente).

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.dsr_export') is null
     or to_regclass('app.professional_profile') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.legal_hold') is null
     or to_regclass('ops.job') is null
     or to_regclass('ops.email_outbox') is null
     or to_regclass('audit.action_catalog') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or to_regprocedure('private.dsr_anonymize_subject(uuid)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: expurgo do extrato (so por migracao; state_keys e a allowlist do estado gravado) ----------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.export_purged', 'dsr_case', false, array['kind', 'status'],
   'Expurgo do extrato de acesso apos o prazo de validade (H-111)')
on conflict (action, object_type) do nothing;

-- 1. Enfileiramento: eliminacao aberta pelo titular vai ao processamento automatico (677) -------------------------------
create or replace function private.dsr_case_enqueue_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'eliminacao' and new.channel = 'titular' then
    insert into ops.job (kind, dedupe_key, run_at, payload_ref)
    values ('dsr.process_auto', 'dsr.process_auto:' || new.id::text, now(), new.id::text)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists dsr_case_enqueue_process_auto on app.dsr_case;
create trigger dsr_case_enqueue_process_auto
  after insert on app.dsr_case
  for each row execute function private.dsr_case_enqueue_job();

-- 2. Enfileiramento: conta anonimizada vai a limpeza do Supabase Auth (idempotente, D-A5) ------------------------------
create or replace function private.dsr_usuario_enqueue_auth_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'anonimizado' and old.status is distinct from new.status then
    insert into ops.job (kind, dedupe_key, run_at, payload_ref)
    values ('dsr.auth_cleanup', 'dsr.auth_cleanup:' || new.id::text, now(), new.id::text)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists dsr_usuario_enqueue_auth_cleanup on app.app_user;
create trigger dsr_usuario_enqueue_auth_cleanup
  after update of status on app.app_user
  for each row execute function private.dsr_usuario_enqueue_auth_cleanup();

-- 3. Enfileiramento: extrato registrado vai ao expurgo no vencimento --------------------------------------------------
create or replace function private.dsr_export_enqueue_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ops.job (kind, dedupe_key, run_at, payload_ref)
  values ('dsr.export_purge', 'dsr.export_purge:' || new.case_id::text, new.expires_at, new.case_id::text)
  on conflict (dedupe_key) do nothing;
  return new;
end
$$;

drop trigger if exists dsr_export_enqueue_purge on app.dsr_export;
create trigger dsr_export_enqueue_purge
  after insert on app.dsr_export
  for each row execute function private.dsr_export_enqueue_purge();

-- 4. Aviso de indeferimento: linha pendente na ops.email_outbox (sem envio aqui; destinatario pelo cadastro) ---------
-- Nao ha aviso final de eliminacao (decisao P5): a conclusao da eliminacao fica so na tela.
create or replace function private.dsr_event_enqueue_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protocolo text;
  v_titular uuid;
  v_tipo constant text := 'dsr_indeferido';
  v_agora timestamptz := now();
begin
  if new.event <> 'rejected' then
    return new;
  end if;
  select c.protocol, c.subject_user_id into v_protocolo, v_titular from app.dsr_case c where c.id = new.case_id;
  insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params,
                                dedupe_key, state, next_attempt_at, created_at)
  values (v_titular, 'acesso', 'critico', v_tipo, v_tipo,
          jsonb_build_object('protocolo', v_protocolo, 'situacao', new.to_status),
          'dsr:' || new.case_id::text || ':' || v_tipo, 'pendente', v_agora, v_agora)
  on conflict (dedupe_key) do nothing;
  return new;
end
$$;

drop trigger if exists dsr_case_event_enqueue_email on app.dsr_case_event;
create trigger dsr_case_event_enqueue_email
  after insert on app.dsr_case_event
  for each row execute function private.dsr_event_enqueue_email();

-- 5. app.dsr_job_process_auto: passo do job de eliminacao automatica. Retorna codigo; nunca avanca parcialmente. ---------
-- Nao elegivel (perfil, pedido, bloqueio, conta fora de em_eliminacao): nada muda; o caso segue para o operador.
create or replace function app.dsr_job_process_auto(p_case uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_atual text;
begin
  if p_case is null then
    raise exception 'dsr_entrada_invalida' using errcode = '22023';
  end if;
  select c.* into v_caso from app.dsr_case c where c.id = p_case for update;
  if not found then
    return 'nao_encontrado';
  end if;
  if v_caso.kind <> 'eliminacao' or v_caso.channel <> 'titular' then
    return 'nao_elegivel';
  end if;
  if v_caso.status in ('indeferido_parcial', 'indeferido_total', 'concluido', 'cancelado') then
    return 'ja_encerrado';
  end if;
  if not exists (select 1 from app.app_user u
                  where u.id = v_caso.subject_user_id and u.status = 'em_eliminacao') then
    return 'nao_elegivel';
  end if;
  if exists (select 1 from app.professional_profile p where p.user_id = v_caso.subject_user_id)
     or exists (select 1 from app.service_request r where r.customer_user_id = v_caso.subject_user_id)
     or exists (select 1 from app.legal_hold h
                 where h.released_at is null and h.subject_type = 'user' and h.subject_id = v_caso.subject_user_id)
  then
    return 'nao_elegivel';
  end if;

  v_atual := v_caso.status;
  if v_atual = 'aberto' then
    update app.dsr_case set status = 'em_analise' where id = p_case;
    insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
    values (p_case, 'status_changed', 'aberto', 'em_analise', null, '{}'::jsonb);
    v_atual := 'em_analise';
  end if;
  if v_atual = 'em_analise' then
    update app.dsr_case set status = 'deferido' where id = p_case;
    insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
    values (p_case, 'status_changed', 'em_analise', 'deferido', null, '{}'::jsonb);
    perform private.audit_append('system:dsr_auto', 'system', 'dsr.case_deferred', 'dsr_case', p_case,
      jsonb_build_object('kind', 'eliminacao', 'status', 'em_analise'),
      jsonb_build_object('kind', 'eliminacao', 'status', 'deferido'), null, null);
  end if;

  -- Falha na anonimizacao desfaz tudo (a funcao inteira e uma so instrucao no banco).
  return private.dsr_anonymize_subject(p_case);
end
$$;

-- 6. app.dsr_job_export_target: o handler pergunta o que apagar; so devolve caminho depois do vencimento --------------
create or replace function app.dsr_job_export_target(p_case uuid)
returns table (
  out_status text,
  out_storage_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_extrato app.dsr_export%rowtype;
begin
  select e.* into v_extrato from app.dsr_export e where e.case_id = p_case;
  if not found then
    return query select 'nao_encontrado'::text, null::text;
    return;
  end if;
  if v_extrato.purged_at is not null then
    return query select 'ja_expurgado'::text, null::text;
    return;
  end if;
  if v_extrato.expires_at > now() then
    return query select 'ainda_valido'::text, null::text;
    return;
  end if;
  return query select 'pronto_para_expurgo'::text, v_extrato.storage_path;
end
$$;

-- 7. app.dsr_job_export_mark_purged: chamada pelo handler somente depois de apagar o arquivo --------------------------
create or replace function app.dsr_job_export_mark_purged(p_case uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extrato app.dsr_export%rowtype;
begin
  select e.* into v_extrato from app.dsr_export e where e.case_id = p_case for update;
  if not found then
    return 'nao_encontrado';
  end if;
  if v_extrato.purged_at is not null then
    return 'ja_expurgado';
  end if;
  if v_extrato.expires_at > now() then
    return 'ainda_valido';
  end if;

  update app.dsr_export set purged_at = now() where case_id = p_case;
  perform private.audit_append('system:dsr_export_purge', 'system', 'dsr.export_purged', 'dsr_case', p_case,
    '{}'::jsonb, jsonb_build_object('kind', 'acesso', 'status', 'concluido'), null, null);
  return 'expurgado';
end
$$;

-- 8. app.dsr_job_auth_cleanup_target: dados para o handler remover o usuario do Supabase Auth ----------------------------
create or replace function app.dsr_job_auth_cleanup_target(p_user uuid)
returns table (
  out_status text,
  out_auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario app.app_user%rowtype;
begin
  select u.* into v_usuario from app.app_user u where u.id = p_user;
  if not found then
    return query select 'nao_encontrado'::text, null::uuid;
    return;
  end if;
  if v_usuario.status <> 'anonimizado' then
    return query select 'nao_anonimizado'::text, null::uuid;
    return;
  end if;
  return query select 'pronto'::text, v_usuario.auth_user_id;
end
$$;

-- 9. Permissoes: triggers sem execucao direta; so app_system executa as funcoes-alvo ------------------------------------
revoke all on function
  private.dsr_case_enqueue_job(),
  private.dsr_usuario_enqueue_auth_cleanup(),
  private.dsr_export_enqueue_purge(),
  private.dsr_event_enqueue_email()
  from public, anon, authenticated, app_api;

revoke all on function
  app.dsr_job_process_auto(uuid),
  app.dsr_job_export_target(uuid),
  app.dsr_job_export_mark_purged(uuid),
  app.dsr_job_auth_cleanup_target(uuid)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_job_process_auto(uuid),
  app.dsr_job_export_target(uuid),
  app.dsr_job_export_mark_purged(uuid),
  app.dsr_job_auth_cleanup_target(uuid)
  to app_system;
