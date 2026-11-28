-- Issue 120 (H-111) | Direitos do titular: processamento do caso pelo operador (app.dsr_process), vigia de prazo
-- (app.dsr_deadline_watch) e abertura assistida pelo DPO (app.dsr_open_assisted). Desenho 147 §4.2, §4.4, §6.1, §6.3
-- e §10 (DV-7). Pendencias P-C, P-D e P-E do 166-ENTREGA-H111.md. Expansiva: so funcoes novas, catalogo de auditoria
-- e uma funcao auxiliar privada. Nenhuma tabela e alterada e nenhum dado de demonstracao e criado.
-- Decisoes desta migracao (ver 166-ENTREGA-H111.md, secao de pendencias):
--   - P-C: app.dsr_process despacha por tipo. Acesso nao passa por aqui (o extrato e gravado pela API via
--     app.dsr_admin_generate_extract). Eliminacao chama app.dsr_admin_anonymize. Correcao so aplica campos da lista
--     private.dsr_correcao_campos(), que comeca vazia: a conta nao tem coluna de nome civil/social nem de endereco-base
--     (o nome so existe em rascunho e pedido). Qualquer campo fora da lista e recusado com campo_nao_corrigivel e o caso
--     fica deferido para o operador recusar com fundamentacao. Lista e aplicacao dependem da decisao DP-1.
--   - P-D: app.dsr_deadline_watch e so indicador (sem escrita e sem e-mail extra): lista casos abertos com prazo vencido
--     ou em ate N dias. O painel usa o mesmo criterio no filtro de prazo de app.dsr_admin_list.
--   - P-E: app.dsr_open_assisted segue o §4.2: sem step-up do titular, canal 'dpo_externo', operador registrado em
--     opened_by_operator_id, identidade conferida registrada por codigo em request_details.identity_check. Eliminacao
--     assistida nasce com conta em em_eliminacao e a anonimizacao continua recusada pela fatia 6 (dpo_externo).
-- Desfazer: supabase/rollbacks/20261120410000_privacy_create_dsr_process_watch_assisted.down.sql

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.legal_hold') is null
     or to_regclass('app.service_request') is null
     or to_regclass('ops.email_outbox') is null
     or to_regclass('audit.action_catalog') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or to_regprocedure('private.admin_has_permission(uuid, text)') is null
     or to_regprocedure('private.dsr_admin_caso(uuid, uuid, text)') is null
     or to_regprocedure('private.dsr_config_inteiro(text)') is null
     or to_regprocedure('app.dsr_admin_anonymize(uuid, uuid)') is null
     or to_regprocedure('app.dsr_admin_generate_extract(uuid, uuid)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: abertura assistida pelo operador (so por migracao) ----------------------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.case_opened_assisted', 'dsr_case', false, array['kind', 'status', 'channel'],
   'Abertura de caso de direito do titular pelo DPO, em nome do titular (H-111, canal dpo_externo)'),
  ('dsr.case_processed', 'dsr_case', false, array['kind', 'status'],
   'Processamento do caso deferido pelo operador (despacho por tipo, H-111)')
on conflict (action, object_type) do nothing;

-- 1. Lista de campos corrigiveis (P-C, DP-1). Comeca vazia: nenhum campo da conta e corrigido ate decisao. ------------
create or replace function private.dsr_correcao_campos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[]::text[]
$$;

-- 2. app.dsr_process: processamento do caso deferido (P-C, §4.2). Acesso e tratado pela API (extrato). ---------------
create or replace function app.dsr_process(p_actor uuid, p_case uuid)
returns table (
  out_case_id uuid,
  out_status text,
  out_outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_mudancas jsonb;
  v_chave text;
  v_permitidos text[] := private.dsr_correcao_campos();
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if v_caso.status <> 'deferido' then
    raise exception 'dsr_nao_deferido' using errcode = '42501';
  end if;

  if v_caso.kind = 'acesso' then
    raise exception 'dsr_acesso_usa_extrato' using errcode = '22023';
  elsif v_caso.kind = 'eliminacao' then
    perform app.dsr_admin_anonymize(p_actor, p_case);
  elsif v_caso.kind = 'correcao' then
    v_mudancas := coalesce(v_caso.request_details -> 'proposed_changes', '{}'::jsonb);
    if jsonb_typeof(v_mudancas) <> 'object' or v_mudancas = '{}'::jsonb then
      raise exception 'correcao_sem_alteracao' using errcode = '22023';
    end if;
    for v_chave in select jsonb_object_keys(v_mudancas) loop
      if not (v_chave = any (v_permitidos)) then
        raise exception 'campo_nao_corrigivel' using errcode = '42501', detail = v_chave;
      end if;
    end loop;
    -- Todos os campos estao na lista (hoje vazia). A aplicacao das alteracoes e outra fatia (DP-1).
    raise exception 'correcao_aplicacao_pendente' using errcode = '0A000';
  else
    raise exception 'dsr_tipo_invalido' using errcode = '23514';
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.case_processed', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status),
    jsonb_build_object('kind', v_caso.kind), null, null);

  return query select c.id, c.status, c.outcome from app.dsr_case c where c.id = p_case;
end
$$;

-- 3. app.dsr_deadline_watch: indicador de prazo (P-D, §4.4). Somente leitura; sem e-mail extra. -------------------------
create or replace function app.dsr_deadline_watch(p_janela_dias integer default 3)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_status text,
  out_deadline_at timestamptz,
  out_situacao text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_janela integer := coalesce(p_janela_dias, 3);
  v_agora timestamptz := now();
begin
  if v_janela < 0 or v_janela > 30 then
    raise exception 'janela_invalida' using errcode = '22023';
  end if;

  return query
    select c.id, c.protocol, c.status, c.deadline_at,
           case when c.deadline_at < v_agora then 'vencido' else 'ate_3_dias' end::text
      from app.dsr_case c
     where c.status in ('aberto', 'em_analise', 'deferido')
       and c.deadline_at <= v_agora + make_interval(days => v_janela)
     order by c.deadline_at, c.id;
end
$$;

-- 4. app.dsr_open_assisted: abertura pelo DPO em nome do titular (P-E, §4.2, decisao 673) -----------------------------
create or replace function app.dsr_open_assisted(
  p_actor uuid,
  p_subject uuid,
  p_kind text,
  p_details jsonb,
  p_channel text
)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_status text,
  out_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_detalhes jsonb := coalesce(p_details, '{}'::jsonb);
  v_conta text;
  v_dias integer;
  v_prazo timestamptz;
  v_status text := 'aberto';
  v_outcome text := null;
  v_nota text := null;
  v_fechado timestamptz := null;
  v_motivo text := null;
  v_novo_id uuid := gen_random_uuid();
  v_protocolo text;
  v_restricao text;
  v_existente text;
  v_tentativa integer;
  v_tipo_email text;
begin
  if p_actor is null then
    raise exception 'operador_obrigatorio' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'dsr.open_assisted') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if p_subject is null then
    raise exception 'titular_obrigatorio' using errcode = '22023';
  end if;
  if p_subject = p_actor then
    raise exception 'dsr_operador_e_titular' using errcode = '42501';
  end if;
  if p_channel is distinct from 'dpo_externo' then
    raise exception 'canal_invalido' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('acesso', 'correcao', 'eliminacao') then
    raise exception 'kind_nao_suportado' using errcode = '22023';
  end if;
  if jsonb_typeof(v_detalhes) <> 'object' then
    raise exception 'detalhes_invalidos' using errcode = '22023';
  end if;
  if coalesce(v_detalhes #>> '{identity_check,code}', '') !~ '\S' then
    raise exception 'identity_check_obrigatorio' using errcode = '22023';
  end if;

  select u.status into v_conta from app.app_user u where u.id = p_subject;
  if v_conta is null then
    raise exception 'conta_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_conta <> 'ativo' and not (p_kind = 'acesso' and v_conta = 'em_eliminacao') then
    raise exception 'conta_nao_ativa' using errcode = '42501';
  end if;

  if p_kind = 'eliminacao' then
    if exists (
         select 1
           from app.legal_hold h
          where h.released_at is null
            and ((h.subject_type = 'user' and h.subject_id = p_subject)
              or (h.subject_type = 'request' and h.subject_id in (
                    select r.id from app.service_request r where r.customer_user_id = p_subject)))
       ) then
      v_status := 'indeferido_total';
      v_outcome := 'recusado_impedimento_legal';
      v_nota := 'Retencao legal ativa para esta conta. A eliminacao nao pode ser executada enquanto ela durar; '
             || 'a conta permanece sem alteracao.';
      v_fechado := v_agora;
      v_motivo := 'retencao_legal';
    elsif exists (
         select 1 from app.service_request r
          where r.customer_user_id = p_subject
            and r.status in ('publicado', 'selecionado')
       ) then
      raise exception 'pedido_em_andamento' using errcode = '42501';
    else
      update app.app_user set status = 'em_eliminacao' where id = p_subject and status = 'ativo';
    end if;
  end if;

  v_dias := private.dsr_config_inteiro('privacy.dsr_deadline_days');
  v_prazo := v_agora + make_interval(days => v_dias);
  for v_tentativa in 1..5 loop
    v_protocolo := private.dsr_gerar_protocolo(v_agora);
    begin
      insert into app.dsr_case (id, protocol, subject_user_id, kind, status, channel, opened_by_operator_id,
                                request_details, legal_basis_note, outcome, opened_at, deadline_at, closed_at)
      values (v_novo_id, v_protocolo, p_subject, p_kind, v_status, 'dpo_externo', p_actor,
              v_detalhes, v_nota, v_outcome, v_agora, v_prazo, v_fechado);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_restricao = constraint_name;
      if v_restricao = 'dsr_case_um_ativo_por_tipo_uk' then
        select c.protocol into v_existente
          from app.dsr_case c
         where c.subject_user_id = p_subject
           and c.kind = p_kind
           and c.status in ('aberto', 'em_analise', 'deferido');
        raise exception 'dsr_em_andamento' using detail = v_existente;
      elsif v_restricao <> 'dsr_case_protocol_key' or v_tentativa = 5 then
        raise;
      end if;
    end;
  end loop;

  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (v_novo_id, 'opened', null, 'aberto', p_actor, jsonb_build_object('canal', 'dpo_externo'));
  if v_status <> 'aberto' then
    insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
    values (v_novo_id, 'rejected', 'aberto', v_status, p_actor, jsonb_build_object('codigo', v_motivo));
  end if;

  v_tipo_email := case when v_status = 'aberto' then 'dsr_abertura' else 'dsr_indeferimento' end;
  insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params,
                                dedupe_key, state, next_attempt_at, created_at)
  values (p_subject, 'acesso', 'critico', v_tipo_email, v_tipo_email,
          jsonb_build_object('protocolo', v_protocolo),
          'dsr:' || v_novo_id::text || ':' || v_tipo_email, 'pendente', v_agora, v_agora);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.case_opened_assisted', 'dsr_case', v_novo_id,
    '{}'::jsonb, jsonb_build_object('kind', p_kind, 'status', v_status, 'channel', 'dpo_externo'), v_motivo, null);

  return query select v_novo_id, v_protocolo, v_status, v_prazo;
end
$$;

-- 5. Permissoes: so app_system executa; a funcao auxiliar e privada --------------------------------------------------
revoke all on function private.dsr_correcao_campos() from public, anon, authenticated, app_api;
grant execute on function private.dsr_correcao_campos() to app_system;

revoke all on function
  app.dsr_process(uuid, uuid),
  app.dsr_deadline_watch(integer),
  app.dsr_open_assisted(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_process(uuid, uuid),
  app.dsr_deadline_watch(integer),
  app.dsr_open_assisted(uuid, uuid, text, jsonb, text)
  to app_system;
