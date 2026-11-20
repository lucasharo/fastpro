-- H-058 (Issue #71) | Aceite idempotente: funcoes de banco (162-DESENHO-H058.md, §4.4 a §4.6; fatia 3).
-- Cria private.acceptance_create (regra inteira do aceite sob FOR UPDATE do pedido, A-2 e A-5),
-- private.acceptance_read (remonta o envelope no replay, A-8) e troca o stub private.request_acceptance_active
-- (decisao 865) por create or replace, com a mesma assinatura e os mesmos privilegios.
-- Passo 0 (A-4): private.request_detail_professional(professional, request, now) ja usa a guarda descoberta_aceite
-- (via request_visibility_guard), status e prazo; zero linhas com a guarda ativa = so casamento de servico/raio.
-- Por isso nao ha private.request_matches_professional (migracao condicional 20261120120000 nao e necessaria).
-- Desfazer: supabase/rollbacks/20261120310000_distribution_create_acceptance_functions.down.sql (restaura select false).
-- Idempotente (create or replace). Nao altera tabelas nem dados existentes.

-- 0. Pre-requisitos: falha com mensagem clara se a base nao estiver aplicada.
do $$
begin
  if to_regprocedure('private.professional_access_guard(uuid,text,timestamptz)') is null
     or to_regprocedure('private.request_detail_professional(uuid,uuid,timestamptz)') is null
     or to_regprocedure('private.identity_id_from_document_hmac(text)') is null
     or to_regprocedure('private.request_acceptance_active(uuid,uuid)') is null
     or to_regprocedure('private.idempotency_begin(text,text,text,text,integer)') is null
     or to_regclass('app.acceptance') is null
     or to_regclass('app.conversation') is null
     or to_regclass('app.message') is null
     or to_regclass('ops.outbox_event') is null
     or to_regclass('app.professional_profile') is null
     or to_regclass('app.service_request') is null then
    raise exception 'h058_funcoes_pre_requisito_ausente' using errcode = '42P01';
  end if;
end
$$;

-- 1. Aceite ativo do par (pedido, profissional): troca o stub "select false" (decisao 865).
--    Efeito nas funcoes de telefone da #46: liberam-se somente com aceite ativo; o restante da guarda segue (R-09).
create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from app.acceptance a
     where a.request_id = p_request_id
       and a.professional_id = p_professional_id
       and a.status = 'ativo'
  )
$$;

-- 2. Replay e leitura do envelope (A-8): so devolve linha se o aceite for do profissional (anti-enumeracao).
--    first_name so com aceite ativo; senao nulo.
create or replace function private.acceptance_read(p_acceptance_id uuid, p_professional_id uuid)
returns table (out_acceptance_id uuid, out_request_id uuid, out_slot_no smallint, out_wave smallint,
  out_status text, out_accepted_at timestamptz, out_conversation_id uuid, out_conversation_state text,
  out_first_name text)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
begin
  if p_acceptance_id is null or p_professional_id is null then
    raise exception 'aceite_parametro_invalido' using errcode = '22023';
  end if;
  return query
    select a.id, a.request_id, a.slot_no, a.wave, a.status::text, a.accepted_at,
           c.id, c.state::text,
           (case when a.status = 'ativo' then s.first_name end)::text
      from app.acceptance a
      join app.conversation c on c.acceptance_id = a.id
      join app.service_request s on s.id = a.request_id
     where a.id = p_acceptance_id
       and a.professional_id = p_professional_id;
end
$$;

-- 3. Criacao do aceite (162-DESENHO §4.4). Ordem das checagens (A-5):
--    (1) guarda descoberta_aceite; (2) FOR UPDATE do pedido; (3) status e prazo; (4) dono; (5) casamento de
--    servico e raio (A-4); (6) aceite do par; (7) mesma identidade; (8) capacidade 4/8; (9) escritas.
--    Rejeicao de negocio devolve out_outcome sem escrever (A-3). Argumento nulo = bug de chamador (22023).
create or replace function private.acceptance_create(
  p_request_id uuid,
  p_professional_id uuid,
  p_now timestamptz)
returns table (out_outcome text, out_acceptance_id uuid, out_request_id uuid, out_slot_no smallint,
  out_wave smallint, out_status text, out_accepted_at timestamptz, out_conversation_id uuid,
  out_conversation_state text, out_first_name text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req        app.service_request%rowtype;
  v_existente  app.acceptance%rowtype;
  v_hmac       text;
  v_identity   uuid;
  v_cap        integer;
  v_slot       smallint;
  v_acc_id     uuid;
  v_conv_id    uuid;
  v_seq        bigint;
  v_outcome    text;
begin
  if p_request_id is null or p_professional_id is null or p_now is null then
    raise exception 'aceite_parametro_invalido' using errcode = '22023';
  end if;

  -- (1) guarda de elegibilidade, antes de qualquer lock (o inelegivel nao ocupa o pedido nem aprende sobre ele).
  if not private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now) then
    return query select 'profissional_inelegivel'::text, null::uuid, p_request_id, null::smallint, null::smallint,
      null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- (2) lock por agregado: serializa aceites do mesmo pedido (ADR-003); pedidos distintos nao se bloqueiam.
  select r.* into v_req
    from app.service_request r
   where r.id = p_request_id
     for update;
  if not found then
    return query select 'pedido_nao_encontrado'::text, null::uuid, p_request_id, null::smallint, null::smallint,
      null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- (3) status publicado e prazo aberto a direita (p_now < prazo).
  if v_req.status <> 'publicado' or p_now >= v_req.acceptance_deadline_at then
    return query select 'admissao_encerrada'::text, null::uuid, p_request_id, null::smallint, null::smallint,
      null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- (4) dono do pedido nao aceita o proprio pedido. professional_id e o user_id do perfil (mesma chave da #55/#68).
  if p_professional_id = v_req.customer_user_id then
    return query select 'autoaceite_proibido'::text, null::uuid, p_request_id, null::smallint, null::smallint,
      null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- (5) casamento de servico e raio pela mesma regra da descoberta (A-4). Zero linhas = incompativel.
  if not exists (select 1 from private.request_detail_professional(p_professional_id, p_request_id, p_now)) then
    return query select 'servico_ou_raio_incompativel'::text, null::uuid, p_request_id, null::smallint, null::smallint,
      null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- (6) aceite do mesmo par: ativo devolve o existente (855); retirado ou removido proibe reaceite (856).
  select a.* into v_existente
    from app.acceptance a
   where a.request_id = p_request_id
     and a.professional_id = p_professional_id;
  if found then
    if v_existente.status <> 'ativo' then
      return query select 'reaceite_proibido'::text, null::uuid, p_request_id, null::smallint, null::smallint,
        null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;
    v_outcome := 'existente';
    v_acc_id := v_existente.id;
  else
    -- (7) mesma identidade (CPF/CNPJ por HMAC) ja com aceite no pedido (857). Perfil sem documento = inelegivel.
    select p.document_hmac into v_hmac
      from app.professional_profile p
     where p.user_id = p_professional_id
       for share;
    if v_hmac is null then
      return query select 'profissional_inelegivel'::text, null::uuid, p_request_id, null::smallint, null::smallint,
        null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;
    v_identity := private.identity_id_from_document_hmac(v_hmac);
    if exists (select 1 from app.acceptance a where a.request_id = p_request_id and a.identity_id = v_identity) then
      return query select 'aceite_duplicado_identidade'::text, null::uuid, p_request_id, null::smallint, null::smallint,
        null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    -- (8) capacidade: 4 sem a 2a onda; 8 depois de aberta (859). Mensagem neutra, sem contador na resposta.
    v_cap := case when v_req.wave2_opened_at is null then 4 else 8 end;
    if v_req.acceptances_count >= v_cap then
      return query select 'sem_vagas'::text, null::uuid, p_request_id, null::smallint, null::smallint,
        null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    -- (9) escritas, todas sob o lock do pedido e na transacao do chamador.
    v_outcome := 'criado';
    v_acc_id := gen_random_uuid();
    v_conv_id := gen_random_uuid();
    v_slot := (v_req.acceptances_count + 1)::smallint;

    insert into app.acceptance (id, request_id, professional_id, identity_id, slot_no, status, accepted_at)
    values (v_acc_id, p_request_id, p_professional_id, v_identity, v_slot, 'ativo', p_now);

    update app.service_request r
       set acceptances_count = r.acceptances_count + 1,
           version = r.version + 1
     where r.id = p_request_id;

    insert into app.conversation (id, request_id, customer_user_id, professional_id, acceptance_id, state)
    values (v_conv_id, p_request_id, v_req.customer_user_id, p_professional_id, v_acc_id, 'ativa');

    insert into app.message (conversation_id, kind, system_event, params, template_version, dedupe_key, state)
    values (v_conv_id, 'sistema', 'aceite',
            jsonb_build_object('acceptance_id', v_acc_id, 'slot_no', v_slot), 1,
            'acceptance:' || v_acc_id::text || ':accepted', 'enviada');

    -- Outbox: aggregate_seq sequencial por pedido, calculado sob o lock do pedido (sem reaproveitar helper).
    select coalesce(max(e.aggregate_seq), 0) + 1 into v_seq
      from ops.outbox_event e
     where e.aggregate_type = 'service_request'
       and e.aggregate_id = p_request_id;

    insert into ops.outbox_event (type, version, aggregate_type, aggregate_id, aggregate_seq, occurred_at, payload)
    values ('work_accepted', 1, 'service_request', p_request_id, v_seq, p_now,
            jsonb_build_object(
              'requestId', p_request_id,
              'acceptanceId', v_acc_id,
              'professionalId', p_professional_id,
              'customerUserId', v_req.customer_user_id,
              'slotNo', v_slot,
              'acceptedAt', p_now));
  end if;

  -- Saida comum (criado ou existente): le o que ficou gravado nesta transacao.
  return query
    select v_outcome, a.id, a.request_id, a.slot_no, a.wave, a.status::text, a.accepted_at,
           c.id, c.state::text,
           (case when a.status = 'ativo' then s.first_name end)::text
      from app.acceptance a
      join app.conversation c on c.acceptance_id = a.id
      join app.service_request s on s.id = a.request_id
     where a.id = v_acc_id;
end
$$;

-- 4. Privilegios: nenhuma funcao nova ou alterada executavel por anon, authenticated, service_role, app_api ou
--    app_backup_reader. So app_system executa (mesmo padrao da #46/#55 e da #68).
revoke all on function private.acceptance_create(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.acceptance_read(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_acceptance_active(uuid, uuid)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.acceptance_create(uuid, uuid, timestamptz) to app_system;
grant execute on function private.acceptance_read(uuid, uuid) to app_system;
grant execute on function private.request_acceptance_active(uuid, uuid) to app_system;
