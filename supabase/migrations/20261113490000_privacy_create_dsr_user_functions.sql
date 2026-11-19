-- Issue 120 (H-111) | Direitos do titular: funcoes do proprio titular (abertura, cancelamento, lista e consulta
-- do caso) e helpers privados de protocolo e parametro (docs/factory/147-DESENHO-H111.md §3.2, §4.1, §6.1 e §8,
-- passo 4). Quarta fatia do desenho. Expansiva: so funcoes novas e permissao de execucao para app_system.
-- Nenhuma tabela existente recebe coluna nova; nenhum dado e alterado fora do fluxo do caso.
-- Abertura: consome o grant de step-up (uso unico), aplica a idempotencia pela chave, a carencia de 30 dias do extrato,
-- a retencao legal e o pedido em andamento, grava o caso (ou o caso ja indeferido), a linha do tempo, a auditoria
-- e o e-mail na ops.email_outbox (sem envio: a linha fica pendente para o envio existente). Eliminacao define
-- app.app_user.status = em_eliminacao (suspensao cautelar, decisao 674). Sem envio real neste arquivo.
-- Idempotencia: a chave e checada antes do consumo do step-up, para que a repeticao da chamada nao falhe por
-- grant ja gasto. Aceites pendentes: nao ha tabela fisica de aceite no banco hoje; o passo de revogacao nao tem alvo.
-- Desfazer: supabase/rollbacks/20261113490000_privacy_create_dsr_user_functions.down.sql.

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.dsr_export') is null
     or to_regclass('app.step_up_grant') is null
     or to_regclass('app.legal_hold') is null
     or to_regclass('app.service_request') is null
     or to_regclass('ops.email_outbox') is null
     or to_regclass('ops.idempotency_key') is null
     or to_regclass('ops.app_config') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: acoes do titular (so por migracao; state_keys e a allowlist do estado gravado) ----------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.case_opened', 'dsr_case', false, array['kind', 'status'],
   'Abertura de caso de direito do titular (H-111)'),
  ('dsr.case_cancelled', 'dsr_case', false, array['kind', 'status'],
   'Cancelamento de caso de direito pelo titular (H-111)')
on conflict (action, object_type) do nothing;

-- 1. Helpers privados -----------------------------------------------------------------------------------------
-- Protocolo DSR-AAAAMMDD-XXXXXX: 6 caracteres base32 de fonte CSPRNG (gen_random_uuid). Bytes 0 a 5 do UUID sao
-- aleatorios (o UUID v4 so fixa bits nos bytes 6 e 8). 256 e multiplo de 32, entao o modulo nao vicia a escolha.
create or replace function private.dsr_gerar_protocolo(p_agora timestamptz)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_sufixo text := '';
begin
  for v_i in 0..5 loop
    v_sufixo := v_sufixo || substr(v_alfabeto, (get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;
  return 'DSR-' || to_char(p_agora at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' || v_sufixo;
end
$$;

-- Le um parametro privacy.* de ops.app_config (valor numerico em jsonb). Sem valor, recusa: nao ha padrao escondido.
create or replace function private.dsr_config_inteiro(p_chave text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_valor integer;
begin
  select (c.value #>> '{}')::integer into v_valor
    from ops.app_config c
   where c.key = p_chave;
  if v_valor is null then
    raise exception 'dsr_config_ausente' using detail = p_chave;
  end if;
  return v_valor;
end
$$;

-- 2. app.dsr_open: abertura do caso pelo titular (desenho §4.1) ----------------------------------------------------
create or replace function app.dsr_open(
  p_subject uuid,
  p_kind text,
  p_details jsonb,
  p_step_up_token_hash text,
  p_idempotency_key text
)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_status text,
  out_deadline_at timestamptz,
  out_deduplicated boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_detalhes jsonb := coalesce(p_details, '{}'::jsonb);
  v_hash_pedido text;
  v_linhas integer;
  v_idem record;
  v_caso record;
  v_conta text;
  v_grant uuid;
  v_dias integer;
  v_janela_dias integer;
  v_abertos_dia integer;
  v_novo_id uuid := gen_random_uuid();
  v_protocolo text;
  v_prazo timestamptz;
  v_restricao text;
  v_existente text;
  v_status text := 'aberto';
  v_outcome text := null;
  v_nota text := null;
  v_fechado timestamptz := null;
  v_motivo text := null;
  v_tipo_email text;
  v_limite_dia constant integer := 5;
begin
  if p_subject is null then
    raise exception 'titular_obrigatorio';
  end if;
  if p_kind is null or p_kind not in ('acesso', 'correcao', 'eliminacao') then
    raise exception 'kind_nao_suportado';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'idempotencia_invalida';
  end if;
  if jsonb_typeof(v_detalhes) <> 'object' then
    raise exception 'detalhes_invalidos';
  end if;

  v_hash_pedido := encode(sha256(convert_to(p_kind || '|' || v_detalhes::text, 'UTF8')), 'hex');

  -- 1) Idempotencia antes do step-up: a repeticao devolve o caso ja criado e nao consome grant de novo.
  insert into ops.idempotency_key (principal_id, operation, key, request_hash, state, expires_at)
  values (p_subject::text, 'dsr.open', p_idempotency_key, v_hash_pedido, 'em_andamento', v_agora + interval '1 day')
  on conflict (principal_id, operation, key) do nothing;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    select i.request_hash, i.state, i.response_body_ref into v_idem
      from ops.idempotency_key i
     where i.principal_id = p_subject::text
       and i.operation = 'dsr.open'
       and i.key = p_idempotency_key;
    if v_idem.request_hash <> v_hash_pedido then
      raise exception 'idempotencia_conflito';
    end if;
    if v_idem.state <> 'concluida' then
      raise exception 'idempotencia_em_andamento';
    end if;
    select c.id, c.protocol, c.status, c.deadline_at into v_caso
      from app.dsr_case c
     where c.id = v_idem.response_body_ref::uuid;
    return query select v_caso.id, v_caso.protocol, v_caso.status, v_caso.deadline_at, true;
    return;
  end if;

  -- 2) Conta: so ativa; em eliminacao so pode pedir acesso (decisao 674, desenho §3.3).
  select u.status into v_conta from app.app_user u where u.id = p_subject;
  if v_conta is null then
    raise exception 'conta_nao_encontrada';
  end if;
  if v_conta <> 'ativo' and not (p_kind = 'acesso' and v_conta = 'em_eliminacao') then
    raise exception 'conta_nao_ativa';
  end if;

  -- 3) Limite de aberturas por titular em 24 h (desenho §6.1: 5 por dia, qualquer tipo).
  select count(*) into v_abertos_dia
    from app.dsr_case c
   where c.subject_user_id = p_subject
     and c.opened_at > v_agora - interval '24 hours';
  if v_abertos_dia >= v_limite_dia then
    raise exception 'dsr_limite_diario';
  end if;

  -- 4) Step-up (acesso e eliminacao): consumo atomico, uso unico, do proprio titular, dentro da validade.
  if p_kind in ('acesso', 'eliminacao') then
    update app.step_up_grant g
       set consumed_at = v_agora
     where g.token_hash = p_step_up_token_hash
       and g.user_id = p_subject
       and g.purpose = 'dsr_open'
       and g.consumed_at is null
       and g.expires_at > v_agora
    returning g.id into v_grant;
    if v_grant is null then
      raise exception 'step_up_obrigatorio';
    end if;
  end if;

  -- 5) Acesso: extrato gerado nos ultimos 30 dias (decisao 682). Vigente devolve o caso; senao, carencia.
  if p_kind = 'acesso' then
    v_janela_dias := private.dsr_config_inteiro('privacy.dsr_export_min_interval_days');
    select e.generated_at, e.expires_at, e.purged_at, c.id, c.protocol, c.status, c.deadline_at
      into v_caso
      from app.dsr_export e
      join app.dsr_case c on c.id = e.case_id
     where c.subject_user_id = p_subject
       and c.kind = 'acesso'
       and e.generated_at > v_agora - make_interval(days => v_janela_dias)
     order by e.generated_at desc
     limit 1;
    if found then
      if v_caso.purged_at is null and v_caso.expires_at > v_agora then
        update ops.idempotency_key
           set state = 'concluida', response_status = 200, response_body_ref = v_caso.id::text
         where principal_id = p_subject::text and operation = 'dsr.open' and key = p_idempotency_key;
        return query select v_caso.id, v_caso.protocol, v_caso.status, v_caso.deadline_at, true;
        return;
      end if;
      raise exception 'dsr_carencia' using detail = (v_caso.generated_at + make_interval(days => v_janela_dias))::text;
    end if;
  end if;

  -- 6) Eliminacao: retencao legal indefere sem tocar a conta; pedido em andamento recusa; senao suspende a conta.
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
      raise exception 'pedido_em_andamento';
    else
      update app.app_user set status = 'em_eliminacao' where id = p_subject and status = 'ativo';
    end if;
  end if;

  -- 7) Gravacao do caso. Protocolo repetido: nova tentativa. Caso ativo do mesmo tipo: dsr_em_andamento.
  v_dias := private.dsr_config_inteiro('privacy.dsr_deadline_days');
  v_prazo := v_agora + make_interval(days => v_dias);
  for v_tentativa in 1..5 loop
    v_protocolo := private.dsr_gerar_protocolo(v_agora);
    begin
      insert into app.dsr_case (id, protocol, subject_user_id, kind, status, channel, request_details,
                                legal_basis_note, outcome, opened_at, deadline_at, closed_at)
      values (v_novo_id, v_protocolo, p_subject, p_kind, v_status, 'titular', v_detalhes,
              v_nota, v_outcome, v_agora, v_prazo, v_fechado);
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
  values (v_novo_id, 'opened', null, 'aberto', p_subject, '{}'::jsonb);
  if v_status <> 'aberto' then
    insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
    values (v_novo_id, 'rejected', 'aberto', v_status, null, jsonb_build_object('codigo', v_motivo));
  end if;

  v_tipo_email := case when v_status = 'aberto' then 'dsr_abertura' else 'dsr_indeferimento' end;
  insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params,
                                dedupe_key, state, next_attempt_at, created_at)
  values (p_subject, 'acesso', 'critico', v_tipo_email, v_tipo_email,
          jsonb_build_object('protocolo', v_protocolo),
          'dsr:' || v_novo_id::text || ':' || v_tipo_email, 'pendente', v_agora, v_agora);

  perform private.audit_append('customer:' || p_subject::text, 'customer', 'dsr.case_opened', 'dsr_case',
    v_novo_id, '{}'::jsonb, jsonb_build_object('kind', p_kind, 'status', v_status), v_motivo, null);

  update ops.idempotency_key
     set state = 'concluida', response_status = 201, response_body_ref = v_novo_id::text
   where principal_id = p_subject::text and operation = 'dsr.open' and key = p_idempotency_key;

  return query select v_novo_id, v_protocolo, v_status, v_prazo, false;
end
$$;

-- 3. app.dsr_cancel: cancelamento pelo dono, so em aberto (CA-H111-14) ---------------------------------------------
create or replace function app.dsr_cancel(p_case uuid, p_subject uuid)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_status text,
  out_closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_caso record;
begin
  select c.id, c.protocol, c.status, c.kind into v_caso
    from app.dsr_case c
   where c.id = p_case
     and c.subject_user_id = p_subject
   for update;
  if not found then
    raise exception 'dsr_nao_encontrado';
  end if;
  if v_caso.status <> 'aberto' then
    raise exception 'dsr_nao_cancelavel';
  end if;

  update app.dsr_case
     set status = 'cancelado', outcome = 'cancelado_pelo_titular', closed_at = v_agora
   where id = p_case;

  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'cancelled', 'aberto', 'cancelado', p_subject, '{}'::jsonb);

  -- Eliminacao cancelada devolve a conta a ativo, se ela ainda estava suspensa (so por este caso: o caso ativo e unico).
  if v_caso.kind = 'eliminacao' then
    update app.app_user set status = 'ativo' where id = p_subject and status = 'em_eliminacao';
  end if;

  perform private.audit_append('customer:' || p_subject::text, 'customer', 'dsr.case_cancelled', 'dsr_case',
    p_case, '{}'::jsonb, jsonb_build_object('kind', v_caso.kind, 'status', 'cancelado'), null, null);

  return query select p_case, v_caso.protocol, 'cancelado'::text, v_agora;
end
$$;

-- 4. app.dsr_list_own: lista do proprio titular, paginada por cursor (opened_at, id) ------------------------------
create or replace function app.dsr_list_own(
  p_subject uuid,
  p_limit integer,
  p_cursor_opened_at timestamptz,
  p_cursor_id uuid
)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_kind text,
  out_status text,
  out_opened_at timestamptz,
  out_deadline_at timestamptz,
  out_closed_at timestamptz,
  out_outcome text,
  out_legal_basis_note text,
  out_extract_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_limite integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if (p_cursor_opened_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor_invalido';
  end if;

  return query
  select c.id, c.protocol, c.kind, c.status, c.opened_at, c.deadline_at, c.closed_at, c.outcome,
         c.legal_basis_note,
         case when e.purged_at is null and e.expires_at > v_agora then e.expires_at end
    from app.dsr_case c
    left join app.dsr_export e on e.case_id = c.id
   where c.subject_user_id = p_subject
     and (p_cursor_opened_at is null or (c.opened_at, c.id) < (p_cursor_opened_at, p_cursor_id))
   order by c.opened_at desc, c.id desc
   limit v_limite;
end
$$;

-- 5. app.dsr_get_own: detalhe e linha do tempo do proprio caso. Inexistente ou de outro titular: nenhuma linha. -------
create or replace function app.dsr_get_own(p_subject uuid, p_case uuid)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_kind text,
  out_status text,
  out_opened_at timestamptz,
  out_deadline_at timestamptz,
  out_closed_at timestamptz,
  out_outcome text,
  out_legal_basis_note text,
  out_extract_expires_at timestamptz,
  out_timeline jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
begin
  return query
  select c.id, c.protocol, c.kind, c.status, c.opened_at, c.deadline_at, c.closed_at, c.outcome,
         c.legal_basis_note,
         case when e.purged_at is null and e.expires_at > v_agora then e.expires_at end,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'at', ev.at, 'event', ev.event, 'from_status', ev.from_status, 'to_status', ev.to_status)
                 order by ev.at, ev.id), '[]'::jsonb)
            from app.dsr_case_event ev
           where ev.case_id = c.id)
    from app.dsr_case c
    left join app.dsr_export e on e.case_id = c.id
   where c.id = p_case
     and c.subject_user_id = p_subject;
end
$$;

-- 6. Permissoes: so app_system executa; PUBLIC, anon, authenticated e app_api nao ---------------------------------
revoke all on function private.dsr_gerar_protocolo(timestamptz), private.dsr_config_inteiro(text)
  from public, anon, authenticated, app_api;

revoke all on function
  app.dsr_open(uuid, text, jsonb, text, text),
  app.dsr_cancel(uuid, uuid),
  app.dsr_list_own(uuid, integer, timestamptz, uuid),
  app.dsr_get_own(uuid, uuid)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_open(uuid, text, jsonb, text, text),
  app.dsr_cancel(uuid, uuid),
  app.dsr_list_own(uuid, integer, timestamptz, uuid),
  app.dsr_get_own(uuid, uuid)
  to app_system;
