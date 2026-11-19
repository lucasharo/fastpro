-- Issue 120 (H-111) | Direitos do titular: geracao e registro do extrato de acesso (docs/factory/147-DESENHO-H111.md
-- §4.3 e §8, passo 5). Quinta fatia do desenho. Expansiva: so funcoes novas, catalogo de auditoria e permissao de
-- execucao para app_system. Nenhuma tabela e alterada e nenhum dado existente e tocado.
-- Fluxo em duas chamadas, feitas pela API (fatia de API, fora desta migracao):
--   1) app.dsr_generate_extract(caso): so para caso de acesso em deferido sem extrato. Devolve o JSON canonico
--      (texto do jsonb). A API grava exatamente esses bytes no bucket dsr-exports, calcula o sha256 deles e a
--      assinatura HMAC com a chave do servidor (a chave nunca entra no banco).
--   2) app.dsr_register_extract(caso, caminho, sha256, assinatura, tamanho): grava app.dsr_export com validade de
--      privacy.dsr_export_ttl_days, fecha o caso como concluido (extrato_disponibilizado) e enfileira o e-mail de
--      conclusao com o protocolo (o link nao vai no e-mail).
-- Allowlist: private.dsr_build_extract monta cada secao por coluna explicita (nunca SELECT *). Ficam de fora:
-- auditoria, sessoes, desafios, auth_user_id, documentos e telefone/endereco cifrados, hashes HMAC, chaves de
-- provedor, caminhos de Storage, notas internas de suspensao e identificadores internos de terceiros.
-- Pendente (tabela inexistente no DEV hoje, nao criada aqui): mensagens do chat, avaliacoes, enderecos
-- compartilhados (address_share) e pagamentos (billing.payment). Ate essas tabelas existirem o extrato e incompleto.
-- Desfazer: supabase/rollbacks/20261113500000_privacy_create_dsr_extract.down.sql.

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.dsr_export') is null
     or to_regclass('app.customer_profile') is null
     or to_regclass('app.professional_profile') is null
     or to_regclass('app.professional_area') is null
     or to_regclass('app.professional_service') is null
     or to_regclass('app.identity_document') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.contact_consent') is null
     or to_regclass('app.contact_reveal_log') is null
     or to_regclass('billing.subscription') is null
     or to_regclass('billing.access_grant') is null
     or to_regclass('ops.email_outbox') is null
     or to_regclass('ops.app_config') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or to_regprocedure('private.dsr_config_inteiro(text)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: acoes do extrato (so por migracao; state_keys e a allowlist do estado gravado) -----------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.extract_generated', 'dsr_case', false, array['kind', 'status'],
   'Geracao do JSON do extrato de acesso do titular (H-111)'),
  ('dsr.extract_ready', 'dsr_case', false, array['kind', 'status'],
   'Extrato de acesso registrado no bucket privado e caso concluido (H-111)')
on conflict (action, object_type) do nothing;

-- 1. private.dsr_build_extract: monta o JSON canonico do titular (desenho §4.3, allowlist por coluna) ----------------
-- Secoes sem linha ficam vazias ([] ou null); nunca vazam dado de outro titular: pedidos e consentimentos entram so
-- pelos pedidos do proprio titular; o nome publico do profissional e o unico dado de terceiro que aparece (ja publico).
create or replace function private.dsr_build_extract(p_subject uuid, p_protocolo text, p_agora timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cadastro jsonb;
  v_perfil_cliente jsonb;
  v_perfil_profissional jsonb;
  v_areas jsonb;
  v_servicos jsonb;
  v_documentos jsonb;
  v_pedidos jsonb;
  v_consentimentos jsonb;
  v_revelacoes jsonb;
  v_assinatura jsonb;
  v_acessos jsonb;
begin
  select jsonb_build_object('email', u.email, 'situacao_conta', u.status,
                            'conta_criada_em', u.created_at, 'email_verificado_em', u.email_verified_at)
    into v_cadastro
    from app.app_user u
   where u.id = p_subject;
  if v_cadastro is null then
    raise exception 'conta_nao_encontrada';
  end if;

  select jsonb_build_object('cadastrado_em', cp.created_at)
    into v_perfil_cliente
    from app.customer_profile cp
   where cp.user_id = p_subject;

  select jsonb_build_object('nome_publico', pp.public_name, 'situacao_verificacao', pp.verification_status,
                            'verificado_em', pp.verified_at, 'suspenso_em', pp.suspended_at,
                            'cadastrado_em', pp.created_at, 'atualizado_em', pp.updated_at)
    into v_perfil_profissional
    from app.professional_profile pp
   where pp.user_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('rotulo_base', a.base_label, 'raio_m', a.radius_m,
                    'valida_desde', a.valid_since, 'atualizada_em', a.updated_at)
                  order by a.valid_since, a.professional_id), '[]'::jsonb)
    into v_areas
    from app.professional_area a
   where a.professional_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('servico_id', s.service_id, 'modalidade', s.modality,
                    'declarado_em', s.declared_at)
                  order by s.declared_at, s.service_id), '[]'::jsonb)
    into v_servicos
    from app.professional_service s
   where s.professional_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', d.kind, 'tipo_declarado', d.declared_type,
                    'situacao', d.status, 'recebido_em', d.received_at, 'analisado_em', d.analyzed_at,
                    'criado_em', d.created_at)
                  order by d.created_at, d.id), '[]'::jsonb)
    into v_documentos
    from app.identity_document d
   where d.professional_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', r.id, 'servico_id', r.service_id, 'situacao', r.status,
                    'urgencia', r.urgency, 'descricao', r.description, 'endereco_informado', r.address_text,
                    'primeiro_nome', r.first_name, 'publicado_em', r.published_at, 'criado_em', r.created_at)
                  order by r.created_at, r.id), '[]'::jsonb)
    into v_pedidos
    from app.service_request r
   where r.customer_user_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', c.request_id, 'tipo', c.kind, 'alcance', c.scope,
                    'profissional', pp.public_name, 'concedido_em', c.granted_at, 'canal', c.granted_via,
                    'versao_texto', c.text_version, 'revogado_em', c.revoked_at,
                    'motivo_revogacao', c.revoked_reason)
                  order by c.granted_at, c.id), '[]'::jsonb)
    into v_consentimentos
    from app.contact_consent c
    left join app.professional_profile pp on pp.user_id = c.professional_id
   where c.request_id in (select r.id from app.service_request r where r.customer_user_id = p_subject);

  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', l.request_id, 'tipo', l.kind, 'ocorrido_em', l.at,
                    'papel', case when l.professional_id = p_subject then 'profissional' else 'cliente' end)
                  order by l.at, l.id), '[]'::jsonb)
    into v_revelacoes
    from app.contact_reveal_log l
   where l.professional_id = p_subject
      or l.request_id in (select r.id from app.service_request r where r.customer_user_id = p_subject);

  select coalesce(jsonb_agg(jsonb_build_object('modo', s.mode, 'cancelar_no_fim_do_periodo',
                    s.cancel_at_period_end, 'cancelada_em', s.canceled_at, 'criada_em', s.created_at)
                  order by s.created_at, s.id), '[]'::jsonb)
    into v_assinatura
    from billing.subscription s
   where s.professional_id = p_subject;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', g.type, 'inicio', g.starts_at, 'fim', g.ends_at,
                    'situacao', g.status, 'revogada_em', g.revoked_at, 'criada_em', g.created_at)
                  order by g.starts_at, g.id), '[]'::jsonb)
    into v_acessos
    from billing.access_grant g
   where g.professional_id = p_subject;

  return jsonb_build_object(
    'schema_version', 1,
    'protocolo', p_protocolo,
    'gerado_em', p_agora,
    'secoes', jsonb_build_object(
      'cadastro', v_cadastro,
      'perfil_cliente', v_perfil_cliente,
      'perfil_profissional', v_perfil_profissional,
      'areas_de_atuacao', v_areas,
      'servicos_profissional', v_servicos,
      'documentos_verificacao', v_documentos,
      'pedidos', v_pedidos,
      'consentimentos_de_contato', v_consentimentos,
      'revelacoes_de_contato', v_revelacoes,
      'assinatura', v_assinatura,
      'acessos_comerciais', v_acessos));
end
$$;

-- 2. app.dsr_generate_extract: JSON do caso de acesso em deferido (sem extrato ainda) ---------------------------------
-- Nao muda estado do caso. O texto devolvido e o que a API grava no bucket, byte a byte.
create or replace function app.dsr_generate_extract(p_case uuid)
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
  v_agora timestamptz := now();
  v_caso record;
  v_payload jsonb;
begin
  select c.id, c.protocol, c.subject_user_id, c.kind, c.status into v_caso
    from app.dsr_case c
   where c.id = p_case
     for update;
  if not found then
    raise exception 'dsr_nao_encontrado';
  end if;
  if v_caso.kind <> 'acesso' then
    raise exception 'dsr_tipo_invalido';
  end if;
  if v_caso.status <> 'deferido' then
    raise exception 'dsr_nao_deferido';
  end if;
  if exists (select 1 from app.dsr_export e where e.case_id = p_case) then
    raise exception 'dsr_extrato_ja_gerado';
  end if;

  v_payload := private.dsr_build_extract(v_caso.subject_user_id, v_caso.protocol, v_agora);

  perform private.audit_append('system:dsr_extract', 'system', 'dsr.extract_generated', 'dsr_case', p_case,
    '{}'::jsonb, jsonb_build_object('kind', v_caso.kind, 'status', v_caso.status), null, null);

  return query select p_case, v_caso.protocol, v_payload::text;
end
$$;

-- 3. app.dsr_register_extract: registra o arquivo, conclui o caso e enfileira o aviso (desenho §4.3, §6.2) -------------
-- Validade do extrato vem de privacy.dsr_export_ttl_days (7 dias [PROPOSTA]). O formato do caminho, do sha256, da
-- assinatura e o limite de tamanho sao checados pelas restricoes da tabela dsr_export.
create or replace function app.dsr_register_extract(
  p_case uuid,
  p_storage_path text,
  p_sha256 text,
  p_signature text,
  p_size_bytes integer
)
returns table (
  out_case_id uuid,
  out_status text,
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_caso record;
  v_dias integer;
  v_expira timestamptz;
  v_tipo_email constant text := 'dsr_extrato_pronto';
begin
  select c.id, c.protocol, c.subject_user_id, c.kind, c.status into v_caso
    from app.dsr_case c
   where c.id = p_case
     for update;
  if not found then
    raise exception 'dsr_nao_encontrado';
  end if;
  if v_caso.kind <> 'acesso' then
    raise exception 'dsr_tipo_invalido';
  end if;
  if v_caso.status <> 'deferido' then
    raise exception 'dsr_nao_deferido';
  end if;
  if exists (select 1 from app.dsr_export e where e.case_id = p_case) then
    raise exception 'dsr_extrato_ja_gerado';
  end if;

  v_dias := private.dsr_config_inteiro('privacy.dsr_export_ttl_days');
  v_expira := v_agora + make_interval(days => v_dias);

  insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes,
                              generated_at, expires_at)
  values (p_case, p_storage_path, p_sha256, p_signature, 1, p_size_bytes, v_agora, v_expira);

  update app.dsr_case
     set status = 'concluido', outcome = 'extrato_disponibilizado', closed_at = v_agora
   where id = p_case;

  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'extract_ready', null, null, null, jsonb_build_object('schema_version', 1));
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'closed', 'deferido', 'concluido', null, '{}'::jsonb);

  insert into ops.email_outbox (recipient_user_id, category, class, email_type, template, template_params,
                                dedupe_key, state, next_attempt_at, created_at)
  values (v_caso.subject_user_id, 'acesso', 'critico', v_tipo_email, v_tipo_email,
          jsonb_build_object('protocolo', v_caso.protocol),
          'dsr:' || p_case::text || ':' || v_tipo_email, 'pendente', v_agora, v_agora);

  perform private.audit_append('system:dsr_extract', 'system', 'dsr.extract_ready', 'dsr_case', p_case,
    '{}'::jsonb, jsonb_build_object('kind', 'acesso', 'status', 'concluido'), null, null);

  return query select p_case, 'concluido'::text, v_expira;
end
$$;

-- 4. Permissoes: so app_system executa as duas funcoes da API; o montador e privado ----------------------------------
revoke all on function private.dsr_build_extract(uuid, text, timestamptz)
  from public, anon, authenticated, app_api;

revoke all on function
  app.dsr_generate_extract(uuid),
  app.dsr_register_extract(uuid, text, text, text, integer)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_generate_extract(uuid),
  app.dsr_register_extract(uuid, text, text, text, integer)
  to app_system;
