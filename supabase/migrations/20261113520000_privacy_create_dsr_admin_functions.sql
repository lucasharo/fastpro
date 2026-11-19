-- Issue 120 (H-111) | Direitos do titular: funcoes administrativas do operador e do DPO (listar, ver, atribuir,
-- deferir, indeferir, gerar extrato e anonimizar), permissoes e papel dpo (docs/factory/147-DESENHO-H111.md §4.2,
-- §5.2, §6.3 e §8, passo 7). Setima fatia do desenho. Expansiva: so funcoes novas, linhas de catalogo de auditoria,
-- permissoes e o papel dpo. Nenhuma tabela e alterada e nenhum dado de demonstracao e criado.
-- Postura: cada funcao exige a permissao pelo catalogo de papeis (private.admin_has_permission, que valida conta ativa
-- e papel ativo); a API resolve o operador da sessao e passa p_actor. Nas decisoes, o operador que e o proprio titular
-- do caso e recusado. Toda mudanca grava private.audit_append na mesma transacao, sem dado pessoal.
-- Escopo desta fatia (decisoes do lider sobre as pendencias da fatia 6):
--   - abertura assistida (app.dsr_open_assisted) nao entra aqui; o canal dpo_externo continua recusado na
--     anonimizacao (fatia 6, decisao P6) ate existir tipo de aprovacao;
--   - deferir correcao e recusado (correcao_pendente_de_implementacao): a aplicacao das alteracoes e outra fatia.
--     O indeferimento de correcao e permitido;
--   - a anonimizacao de titular profissional ou com pedido continua recusada pela fatia 6 (P1 e P2): o caso
--     permanece deferido e vira Issue propria.
-- Desfazer: supabase/rollbacks/20261113520000_privacy_create_dsr_admin_functions.down.sql

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.admin_staff') is null
     or to_regclass('app.admin_role') is null
     or to_regclass('app.admin_permission') is null
     or to_regclass('app.admin_role_permission') is null
     or to_regclass('app.admin_user_role') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.dsr_export') is null
     or to_regclass('app.legal_hold') is null
     or to_regclass('app.service_request') is null
     or to_regclass('audit.action_catalog') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or to_regprocedure('private.admin_has_permission(uuid, text)') is null
     or to_regprocedure('private.dsr_anonymize_subject(uuid)') is null
     or to_regprocedure('app.dsr_generate_extract(uuid)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: acoes do operador (so por migracao; state_keys e a allowlist do estado gravado) -----------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.case_assigned', 'dsr_case', false, array['kind', 'status'],
   'Atribuicao de caso de direito do titular a operador (H-111)'),
  ('dsr.case_deferred', 'dsr_case', false, array['kind', 'status'],
   'Deferimento de caso de direito do titular (H-111)'),
  ('dsr.case_rejected', 'dsr_case', false, array['kind', 'status'],
   'Indeferimento fundamentado de caso de direito do titular (H-111)'),
  ('dsr.extract_requested', 'dsr_case', false, array['kind', 'status'],
   'Pedido do operador para gerar o extrato de acesso (H-111)'),
  ('dsr.anonymization_requested', 'dsr_case', false, array['kind', 'status'],
   'Pedido do operador para anonimizar a conta na eliminacao (H-111)')
on conflict (action, object_type) do nothing;

-- 1. Permissoes e papel dpo (desenho §6.3; seed idempotente) -----------------------------------------------------------
insert into app.admin_permission (code, label) values
  ('dsr.read', 'Consultar direitos do titular'),
  ('dsr.decide', 'Decidir direitos do titular'),
  ('dsr.open_assisted', 'Abrir direito do titular assistido')
on conflict (code) do nothing;

insert into app.admin_role (code, label) values
  ('dpo', 'DPO/Encarregado')
on conflict (code) do nothing;

insert into app.admin_role_permission (role_code, permission_code) values
  ('dpo', 'dsr.read'),
  ('dpo', 'dsr.decide'),
  ('dpo', 'dsr.open_assisted'),
  ('superadmin', 'dsr.read'),
  ('superadmin', 'dsr.decide'),
  ('superadmin', 'dsr.open_assisted'),
  ('auditor', 'dsr.read'),
  ('suporte', 'dsr.read')
on conflict do nothing;

-- 2. Helper privado: confere permissao, carrega o caso com trava e recusa operador que e o titular -------------------
create or replace function private.dsr_admin_caso(p_actor uuid, p_case uuid, p_permissao text)
returns app.dsr_case
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
begin
  if p_actor is null or p_case is null then
    raise exception 'dsr_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, p_permissao) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select c.* into v_caso from app.dsr_case c where c.id = p_case for update;
  if not found then
    raise exception 'dsr_nao_encontrado' using errcode = 'P0002';
  end if;
  if v_caso.subject_user_id = p_actor then
    raise exception 'dsr_operador_e_titular' using errcode = '42501';
  end if;
  return v_caso;
end
$$;

-- 3. app.dsr_admin_list: fila administrativa paginada por cursor (opened_at, id). Sem dado pessoal na leitura reduzida ----
-- Suporte (dsr.read sem dsr.decide nem audit.read) ve so protocolo e status; filtros que revelam mais sao recusados.
create or replace function app.dsr_admin_list(
  p_actor uuid,
  p_status text,
  p_kind text,
  p_prazo text,
  p_assigned_to uuid,
  p_limit integer,
  p_cursor_opened_at timestamptz,
  p_cursor_id uuid
)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_kind text,
  out_status text,
  out_channel text,
  out_opened_at timestamptz,
  out_deadline_at timestamptz,
  out_assigned_to uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_limite integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_completo boolean;
begin
  if p_actor is null then
    raise exception 'dsr_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'dsr.read') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if (p_cursor_opened_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor_invalido' using errcode = '22023';
  end if;
  v_completo := private.admin_has_permission(p_actor, 'dsr.decide')
             or private.admin_has_permission(p_actor, 'audit.read');
  if not v_completo and (p_kind is not null or p_prazo is not null or p_assigned_to is not null) then
    raise exception 'filtro_nao_permitido' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('aberto', 'em_analise', 'deferido', 'indeferido_parcial',
                                               'indeferido_total', 'concluido', 'cancelado') then
    raise exception 'filtro_invalido' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('acesso', 'correcao', 'eliminacao') then
    raise exception 'filtro_invalido' using errcode = '22023';
  end if;
  if p_prazo is not null and p_prazo not in ('vencido', 'ate_3_dias') then
    raise exception 'filtro_invalido' using errcode = '22023';
  end if;

  return query
  select c.id,
         c.protocol,
         case when v_completo then c.kind end,
         c.status,
         case when v_completo then c.channel end,
         case when v_completo then c.opened_at end,
         case when v_completo then c.deadline_at end,
         case when v_completo then c.assigned_to end
    from app.dsr_case c
   where (p_status is null or c.status = p_status)
     and (p_kind is null or c.kind = p_kind)
     and (p_assigned_to is null or c.assigned_to = p_assigned_to)
     and (p_prazo is null or (c.status in ('aberto', 'em_analise', 'deferido')
          and ((p_prazo = 'vencido' and c.deadline_at < v_agora)
            or (p_prazo = 'ate_3_dias' and c.deadline_at >= v_agora
                and c.deadline_at < v_agora + interval '3 days'))))
     and (p_cursor_opened_at is null or (c.opened_at, c.id) < (p_cursor_opened_at, p_cursor_id))
   order by c.opened_at desc, c.id desc
   limit v_limite;
end
$$;

-- 4. app.dsr_admin_get: detalhe do caso para o operador (sem conteudo do extrato; so metadados) ----------------------
-- Leitura reduzida (sem dsr.decide nem audit.read): so protocolo e status.
create or replace function app.dsr_admin_get(p_actor uuid, p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_completo boolean;
begin
  if p_actor is null or p_case is null then
    raise exception 'dsr_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'dsr.read') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select c.* into v_caso from app.dsr_case c where c.id = p_case;
  if not found then
    raise exception 'dsr_nao_encontrado' using errcode = 'P0002';
  end if;
  v_completo := private.admin_has_permission(p_actor, 'dsr.decide')
             or private.admin_has_permission(p_actor, 'audit.read');
  if not v_completo then
    return jsonb_build_object('protocol', v_caso.protocol, 'status', v_caso.status);
  end if;

  return jsonb_build_object(
    'case_id', v_caso.id,
    'protocol', v_caso.protocol,
    'kind', v_caso.kind,
    'channel', v_caso.channel,
    'status', v_caso.status,
    'opened_at', v_caso.opened_at,
    'deadline_at', v_caso.deadline_at,
    'closed_at', v_caso.closed_at,
    'outcome', v_caso.outcome,
    'legal_basis_note', v_caso.legal_basis_note,
    'assigned_to', v_caso.assigned_to,
    'request_details', v_caso.request_details,
    'pendencias', jsonb_build_object(
      'retencao_legal_ativa', exists (
        select 1 from app.legal_hold h
         where h.released_at is null and h.subject_type = 'user' and h.subject_id = v_caso.subject_user_id),
      'pedidos_total', (select count(*) from app.service_request r
                         where r.customer_user_id = v_caso.subject_user_id),
      'pedidos_em_andamento', (select count(*) from app.service_request r
                                where r.customer_user_id = v_caso.subject_user_id
                                  and r.status in ('publicado', 'selecionado')),
      'perfil_profissional', exists (
        select 1 from app.professional_profile p where p.user_id = v_caso.subject_user_id)),
    'extrato', (select jsonb_build_object('generated_at', e.generated_at, 'expires_at', e.expires_at,
                                          'size_bytes', e.size_bytes, 'sha256', e.sha256,
                                          'purged_at', e.purged_at)
                  from app.dsr_export e where e.case_id = p_case),
    'linha_do_tempo', coalesce((
      select jsonb_agg(jsonb_build_object('at', t.at, 'event', t.event, 'from_status', t.from_status,
                                          'to_status', t.to_status)
                       order by t.at, t.id)
        from app.dsr_case_event t where t.case_id = p_case), '[]'::jsonb));
end
$$;

-- 5. app.dsr_assign: atribui o caso a um operador com dsr.decide; aberto passa a em_analise -------------------------
create or replace function app.dsr_assign(p_actor uuid, p_case uuid, p_assignee uuid)
returns table (
  out_case_id uuid,
  out_status text,
  out_assigned_to uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_status_antes text;
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if p_assignee is null or not private.admin_has_permission(p_assignee, 'dsr.decide') then
    raise exception 'dsr_responsavel_invalido' using errcode = '22023';
  end if;
  if p_assignee = v_caso.subject_user_id then
    raise exception 'dsr_operador_e_titular' using errcode = '42501';
  end if;
  if v_caso.status not in ('aberto', 'em_analise') then
    raise exception 'dsr_nao_atribuivel' using errcode = '42501';
  end if;
  v_status_antes := v_caso.status;

  update app.dsr_case set status = 'em_analise', assigned_to = p_assignee where id = p_case;
  if v_status_antes = 'aberto' then
    insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
    values (p_case, 'status_changed', 'aberto', 'em_analise', p_actor, '{}'::jsonb);
  end if;
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'assigned', null, null, p_actor, '{}'::jsonb);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.case_assigned', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_status_antes),
    jsonb_build_object('kind', v_caso.kind, 'status', 'em_analise'), null, null);

  return query select p_case, 'em_analise'::text, p_assignee;
end
$$;

-- 6. app.dsr_defer: deferimento (aberto ou em_analise para deferido). Correcao ainda nao tem aplicacao: recusada. ----
create or replace function app.dsr_defer(p_actor uuid, p_case uuid)
returns table (
  out_case_id uuid,
  out_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if v_caso.kind = 'correcao' then
    raise exception 'correcao_pendente_de_implementacao' using errcode = '0A000';
  end if;
  if v_caso.status not in ('aberto', 'em_analise') then
    raise exception 'dsr_nao_deferivel' using errcode = '42501';
  end if;

  update app.dsr_case set status = 'deferido' where id = p_case;
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'status_changed', v_caso.status, 'deferido', p_actor, '{}'::jsonb);

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.case_deferred', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status),
    jsonb_build_object('kind', v_caso.kind, 'status', 'deferido'), null, null);

  return query select p_case, 'deferido'::text;
end
$$;

-- 7. app.dsr_reject: indeferimento fundamentado (aberto ou em_analise). Eliminacao volta a conta a ativo. -----------
-- Desfechos de indeferimento: so os dois codigos da tabela (impedimento legal, fraude de identidade).
create or replace function app.dsr_reject(
  p_actor uuid,
  p_case uuid,
  p_note text,
  p_partial boolean,
  p_outcome text
)
returns table (
  out_case_id uuid,
  out_status text,
  out_closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_novo text;
  v_agora timestamptz := now();
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if v_caso.status not in ('aberto', 'em_analise') then
    raise exception 'dsr_nao_indeferivel' using errcode = '42501';
  end if;
  if p_note is null or p_note !~ '\S' then
    raise exception 'nota_base_legal_obrigatoria' using errcode = '23514';
  end if;
  if p_outcome is null or p_outcome not in ('recusado_impedimento_legal', 'recusado_fraude_identidade') then
    raise exception 'desfecho_invalido' using errcode = '22023';
  end if;
  v_novo := case when coalesce(p_partial, false) then 'indeferido_parcial' else 'indeferido_total' end;

  update app.dsr_case
     set status = v_novo, outcome = p_outcome, legal_basis_note = p_note, closed_at = v_agora
   where id = p_case;

  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'rejected', v_caso.status, v_novo, p_actor, jsonb_build_object('outcome', p_outcome));

  -- Eliminacao indeferida devolve a conta a ativo, se ainda estava suspensa (o caso ativo e unico por tipo).
  if v_caso.kind = 'eliminacao' then
    update app.app_user set status = 'ativo' where id = v_caso.subject_user_id and status = 'em_eliminacao';
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.case_rejected', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status),
    jsonb_build_object('kind', v_caso.kind, 'status', v_novo), null, null);

  return query select p_case, v_novo, v_agora;
end
$$;

-- 8. app.dsr_admin_generate_extract: pedido do operador para gerar o extrato de um caso deferido de acesso --------------
-- O conteudo volta so para a API, que assina e grava o arquivo; o operador nunca recebe o conteudo.
create or replace function app.dsr_admin_generate_extract(p_actor uuid, p_case uuid)
returns table (
  out_case_id uuid,
  out_protocol text,
  out_payload text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if v_caso.kind <> 'acesso' then
    raise exception 'dsr_tipo_invalido' using errcode = '23514';
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.extract_requested', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status),
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status), null, null);

  return query select g.out_case_id, g.out_protocol, g.out_payload from app.dsr_generate_extract(p_case) g;
end
$$;

-- 9. app.dsr_admin_anonymize: pedido do operador para anonimizar a conta de um caso de eliminacao ------------------
-- Usa a funcao da fatia 6, que recusa o que ainda nao tem passo (profissional, pedido, bloqueio legal, dpo_externo).
create or replace function app.dsr_admin_anonymize(p_actor uuid, p_case uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
begin
  v_caso := private.dsr_admin_caso(p_actor, p_case, 'dsr.decide');
  if v_caso.kind <> 'eliminacao' then
    raise exception 'dsr_tipo_invalido' using errcode = '23514';
  end if;

  perform private.audit_append('admin:' || p_actor::text, 'admin', 'dsr.anonymization_requested', 'dsr_case', p_case,
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status),
    jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status), null, null);

  return private.dsr_anonymize_subject(p_case);
end
$$;

-- 10. Permissoes: so app_system executa as funcoes da API; o helper e privado -----------------------------------------
revoke all on function private.dsr_admin_caso(uuid, uuid, text)
  from public, anon, authenticated, app_api;

revoke all on function
  app.dsr_admin_list(uuid, text, text, text, uuid, integer, timestamptz, uuid),
  app.dsr_admin_get(uuid, uuid),
  app.dsr_assign(uuid, uuid, uuid),
  app.dsr_defer(uuid, uuid),
  app.dsr_reject(uuid, uuid, text, boolean, text),
  app.dsr_admin_generate_extract(uuid, uuid),
  app.dsr_admin_anonymize(uuid, uuid)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_admin_list(uuid, text, text, text, uuid, integer, timestamptz, uuid),
  app.dsr_admin_get(uuid, uuid),
  app.dsr_assign(uuid, uuid, uuid),
  app.dsr_defer(uuid, uuid),
  app.dsr_reject(uuid, uuid, text, boolean, text),
  app.dsr_admin_generate_extract(uuid, uuid),
  app.dsr_admin_anonymize(uuid, uuid)
  to app_system;
