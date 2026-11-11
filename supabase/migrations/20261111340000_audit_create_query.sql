-- H-104 (#113) | Consulta a auditoria pelo Auditor: private.audit_query, acao audit.queried e dois indices.
-- Desenho: docs/factory/63-DESENHO-H104.md §1 a §4. Idempotente.
-- Desfazer: supabase/rollbacks/20261111340000_audit_create_query.down.sql (manual, so em dev).
-- Depende de 20261110140000 (audit), 20261111220000 (rbac: audit.read e papel auditor) e
-- 20261111280000 (admin_guard com totp_at).
-- Leitura so por esta funcao (SECURITY DEFINER, EXECUTE somente de app_system). app_api continua sem
-- privilegio de tabela (54 §1). Cada chamada grava uma entrada audit.queried na mesma transacao;
-- qualquer erro propaga e desfaz tudo (sem EXCEPTION e sem savepoint, regra B-08 de 23).
-- Erros: ADM30 = sem sessao/papel valido (API: 404); ADM31 = validacao, a mensagem traz o codigo
-- (periodo_invalido, periodo_acima_do_teto, paginacao_invalida, filtro_invalido; API: 422);
-- 42501 = sem audit.read (API: 403); 22023 = entrada nula.

-- 1. Indices por periodo e por acao (63 §1.4). Tabela so de insercao; custo de escrita pequeno.
create index if not exists audit_event_at_idx on audit.audit_event (at, seq);
create index if not exists audit_event_action_idx on audit.audit_event (action, at);

-- 2. Acao da propria consulta. O estado guarda so filtros, quantidades e instantes: nunca o conteudo
-- dos eventos lidos (CA-H104-03). Chaves revisadas contra a regra de chaves proibidas (23 §1.4).
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('audit.queried', 'audit_query', false,
   array['period_from', 'period_to', 'filter_action', 'filter_object_type', 'filter_object_id',
         'after_seq', 'page_limit', 'returned_count', 'has_more'],
   'Consulta a trilha de auditoria pelo Auditor (H-104)')
on conflict (action, object_type) do nothing;

-- 3. Consulta. Ordem: entrada e validacao (nada e lido nem gravado se falhar); autoridade revalidada
-- no banco (admin_guard + audit.read); leitura em memoria; entrada da consulta como ultima escrita.
-- A leitura usa intervalo semiaberto [p_from, p_to), ordem cronologica por seq e cursor por seq.
create or replace function private.audit_query(
  p_actor uuid,
  p_session_hash text,
  p_from timestamptz,
  p_to timestamptz,
  p_action text default null,
  p_object_type text default null,
  p_object_id uuid default null,
  p_after_seq bigint default 0,
  p_limit int default 50,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_guard_user uuid;
  v_role       text;
  v_consulta   uuid := gen_random_uuid();
  v_eventos    jsonb := '[]'::jsonb;
  v_linha      audit.audit_event%rowtype;
  v_vistas     int := 0;
  v_devolvidos int := 0;
  v_tem_mais   boolean := false;
  v_proximo    bigint := null;
begin
  -- 1. Entrada, periodo, paginacao e filtros (teto de 90 dias fixo no banco; espelho na API).
  if p_actor is null or p_session_hash is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'periodo_invalido' using errcode = 'ADM31';
  end if;
  if p_to - p_from > interval '90 days' then
    raise exception 'periodo_acima_do_teto' using errcode = 'ADM31';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_after_seq is null or p_after_seq < 0 then
    raise exception 'paginacao_invalida' using errcode = 'ADM31';
  end if;
  if p_object_id is not null and p_object_type is null then
    raise exception 'filtro_invalido' using errcode = 'ADM31';
  end if;
  if p_action is not null and not exists (
       select 1 from audit.action_catalog c where c.action = p_action and c.active) then
    raise exception 'filtro_invalido' using errcode = 'ADM31';
  end if;
  if p_object_type is not null and not exists (
       select 1 from audit.action_catalog c where c.object_type = p_object_type and c.active) then
    raise exception 'filtro_invalido' using errcode = 'ADM31';
  end if;

  -- 2. Autoridade revalidada no banco, na mesma transacao (efeito imediato da revogacao, CA-H104-07).
  select g.out_user_id into v_guard_user
    from private.admin_guard(p_session_hash, p_now) g
   where g.out_user_id = p_actor;
  if not found then
    raise exception 'sessao_invalida' using errcode = 'ADM30';
  end if;
  if not private.admin_has_permission(p_actor, 'audit.read') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  -- Papel que concede audit.read (o primeiro em ordem de codigo); vai na entrada da consulta.
  select r.role_code into v_role
    from app.admin_user_role r
    join app.admin_role_permission rp on rp.role_code = r.role_code
   where r.user_id = p_actor and r.revoked_at is null and rp.permission_code = 'audit.read'
   order by r.role_code
   limit 1;
  if v_role is null then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  -- 3. Leitura em memoria: pede uma linha a mais para saber se ha mais paginas.
  for v_linha in
    select e.* from audit.audit_event e
     where e.at >= p_from and e.at < p_to
       and e.seq > p_after_seq
       and (p_action is null or e.action = p_action)
       and (p_object_type is null or e.object_type = p_object_type)
       and (p_object_id is null or e.object_id = p_object_id)
     order by e.seq
     limit p_limit + 1
  loop
    v_vistas := v_vistas + 1;
    if v_vistas > p_limit then
      v_tem_mais := true;
      exit;
    end if;
    -- Lista fechada de campos (CA-H104-04): sem prev_hash nem row_hash.
    v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
      'seq', v_linha.seq,
      'id', v_linha.id,
      'at', to_char(v_linha.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'actor_ref', v_linha.actor_ref,
      'actor_role', v_linha.actor_role,
      'action', v_linha.action,
      'object_type', v_linha.object_type,
      'object_id', v_linha.object_id,
      'before_state', v_linha.before_state,
      'after_state', v_linha.after_state,
      'reason_code', v_linha.reason_code,
      'correlation_id', v_linha.correlation_id));
    v_proximo := v_linha.seq;
  end loop;
  v_devolvidos := least(v_vistas, p_limit);

  -- 4. Entrada da consulta: ultima escrita (23 §3 item 4). Filtros e contagens; nunca o conteudo lido.
  perform private.audit_append('admin:' || p_actor::text, v_role, 'audit.queried', 'audit_query', v_consulta,
    '{}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'period_from', to_char(p_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'period_to', to_char(p_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'filter_action', p_action,
      'filter_object_type', p_object_type,
      'filter_object_id', p_object_id,
      'after_seq', p_after_seq,
      'page_limit', p_limit,
      'returned_count', v_devolvidos,
      'has_more', v_tem_mais)),
    null, null);

  -- 5. Resposta: so sai aqui; qualquer erro acima ja desfez a transacao inteira.
  return jsonb_build_object(
    'consulta_id', v_consulta,
    'eventos', v_eventos,
    'tem_mais', v_tem_mais,
    'proximo_cursor', v_proximo);
end
$$;

-- 4. Privilegios: so app_system executa. app_api nao recebe nenhum privilegio de tabela (54 §1).
revoke all on function
  private.audit_query(uuid, text, timestamptz, timestamptz, text, text, uuid, bigint, int, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function
  private.audit_query(uuid, text, timestamptz, timestamptz, text, text, uuid, bigint, int, timestamptz)
  to app_system;
