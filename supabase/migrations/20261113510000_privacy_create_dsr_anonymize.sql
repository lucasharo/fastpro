-- Issue 120 (H-111) | Direitos do titular: anonimizacao da conta do titular na eliminacao (docs/factory/147-DESENHO-H111.md
-- §4.3 e §8, passo 6). Sexta fatia do desenho. Expansiva: uma funcao privada nova e uma linha no catalogo de auditoria.
-- Nenhuma tabela e alterada e nenhum dado fora da conta do titular do caso e tocado.
-- O que a funcao faz (tudo numa transacao; qualquer recusa desfaz a chamada inteira):
--   confere pre-condicoes (caso de eliminacao em deferido, conta em em_eliminacao, sem bloqueio legal, sem pedido
--   em andamento); encerra as sessoes do titular; consome os grants de step-up abertos; troca o e-mail por marcador
--   anonimo (sem HMAC reutilizavel, decisao 679), marca a conta como anonimizada e fecha o caso como concluido
--   (conta_anonimizada), com linha do tempo e auditoria.
-- O que a funcao recusa (erro explicito, nada e gravado), por limite dos gatilhos e do catalogo atuais:
--   titular profissional (eliminacao_profissional_pendente): perfil, base, documentos, assinatura e retencao por
--     duplicidade (670) ainda nao tem passo; a regra de documento do perfil e de imutabilidade e de H-040/H-109.
--   titular com pedidos (pedido_conteudo_imutavel_pendente): descricao, nome e endereco cifrado do pedido sao
--     imutaveis pelos gatilhos de H-031/H-032; zerar exige decisao de dono, fora desta Issue.
--   eliminacao assistida (dsr_aprovacao_indisponivel): app.approval_request nao tem tipo de aprovacao para direitos.
-- Chat e avaliacoes: as tabelas nao existem no DEV (conferido em 19/11/2026); nenhum passo e escrito para elas.
-- Consentimentos de contato do titular (cliente) sao revogados pelo gatilho de telefone de H-033 quando o telefone
-- do pedido e apagado; nao ha consentimento de profissional a tratar enquanto o passo profissional nao existe.
-- Sessoes e grants de step-up: consumidos com o instante atual limitado ao prazo do proprio grant.
-- Desafios de autenticacao (app.auth_challenge) nao sao invalidados aqui: o CHECK de invalid_reason nao tem motivo
-- para isso; expiram em 15 min e o login ja e barrado por status (fatia 3). Pendencia registrada.
-- E-mail final de conclusao nao e enfileirado aqui: ops.email_outbox resolve o destinatario pelo cadastro na hora do
-- envio, e o endereco original sai do cadastro nesta funcao. Decisao de destino pendente (fatia 8).
-- Desfazer: supabase/rollbacks/20261113510000_privacy_create_dsr_anonymize.down.sql (recusa se houver conta anonimizada).

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.app_session') is null
     or to_regclass('app.step_up_grant') is null
     or to_regclass('app.dsr_case') is null
     or to_regclass('app.dsr_case_event') is null
     or to_regclass('app.legal_hold') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.professional_profile') is null
     or to_regclass('audit.action_catalog') is null
     or to_regprocedure('private.audit_append(text, text, text, text, uuid, jsonb, jsonb, text, uuid)') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_roles where rolname = 'app_api')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 0. Catalogo de auditoria: acao da anonimizacao (so por migracao; state_keys e a allowlist do estado gravado) -------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.subject_anonymized', 'dsr_case', false, array['kind', 'status'],
   'Anonimizacao da conta do titular na eliminacao, caso concluido (H-111)')
on conflict (action, object_type) do nothing;

-- 1. private.dsr_anonymize_subject: passo 6 do desenho (somente a partir do caso em deferido) -------------------------
-- Chamada somente por funcoes app.* (fatia 7 e job da fatia 8). Retorna 'processado' ou 'ja_anonimizado' (no-op).
create or replace function private.dsr_anonymize_subject(p_case uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caso app.dsr_case%rowtype;
  v_usuario app.app_user%rowtype;
begin
  select * into v_caso from app.dsr_case c where c.id = p_case for update;
  if not found then
    raise exception 'dsr_caso_nao_encontrado' using errcode = 'P0002';
  end if;
  if v_caso.status = 'concluido' and v_caso.outcome = 'conta_anonimizada' then
    return 'ja_anonimizado';
  end if;
  if v_caso.kind <> 'eliminacao' then
    raise exception 'dsr_tipo_invalido' using errcode = '23514';
  end if;
  if v_caso.status <> 'deferido' then
    raise exception 'dsr_nao_deferido' using errcode = '42501';
  end if;
  if v_caso.channel = 'dpo_externo' then
    raise exception 'dsr_aprovacao_indisponivel' using errcode = '42501';
  end if;

  select * into v_usuario from app.app_user u where u.id = v_caso.subject_user_id for update;
  if not found then
    raise exception 'dsr_titular_inexistente' using errcode = '23503';
  end if;
  if v_usuario.status <> 'em_eliminacao' then
    raise exception 'dsr_conta_fora_de_eliminacao' using errcode = '42501';
  end if;
  if exists (select 1 from app.professional_profile p where p.user_id = v_usuario.id) then
    raise exception 'eliminacao_profissional_pendente' using errcode = '0A000';
  end if;
  if exists (select 1 from app.legal_hold h
              where h.released_at is null
                and ((h.subject_type = 'user' and h.subject_id = v_usuario.id)
                  or (h.subject_type = 'request' and h.subject_id in (
                        select r.id from app.service_request r where r.customer_user_id = v_usuario.id)))) then
    raise exception 'retencao_legal_ativa' using errcode = '42501';
  end if;
  if exists (select 1 from app.service_request r
              where r.customer_user_id = v_usuario.id and r.status in ('publicado', 'selecionado')) then
    raise exception 'pedido_em_andamento' using errcode = '42501';
  end if;
  if exists (select 1 from app.service_request r where r.customer_user_id = v_usuario.id) then
    raise exception 'pedido_conteudo_imutavel_pendente' using errcode = '0A000';
  end if;

  -- Sessoes e grants de step-up do titular: encerrados antes de trocar o cadastro.
  update app.app_session s
     set revoked_at = now()
   where s.user_id = v_usuario.id and s.revoked_at is null;
  update app.step_up_grant g
     set consumed_at = least(now(), g.expires_at)
   where g.user_id = v_usuario.id and g.consumed_at is null;

  -- Conta: e-mail vira marcador anonimo (unico por construcao), sem HMAC reutilizavel; status e data na mesma instrucao.
  update app.app_user u
     set email = 'anon-' || replace(gen_random_uuid()::text, '-', '') || '@anon.fastpro.internal',
         email_hmac = null,
         email_verified_at = null,
         status = 'anonimizado',
         retention_state = 'expurgado',
         anonymized_at = now()
   where u.id = v_usuario.id;

  update app.dsr_case c
     set status = 'concluido',
         outcome = 'conta_anonimizada',
         closed_at = now(),
         legal_basis_note = 'Conta anonimizada a pedido do titular. Mantidos por obrigacao legal e como prova do atendimento: registros de auditoria e de conexao (prazo a validar juridicamente).'
   where c.id = p_case;

  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'anonymized', null, null, null, '{}'::jsonb);
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (p_case, 'closed', 'deferido', 'concluido', null, jsonb_build_object('outcome', 'conta_anonimizada'));

  perform private.audit_append('system:dsr_anonymize', 'system', 'dsr.subject_anonymized', 'dsr_case', p_case,
    jsonb_build_object('kind', 'eliminacao', 'status', 'deferido'),
    jsonb_build_object('kind', 'eliminacao', 'status', 'concluido'), null, null);

  return 'processado';
end
$$;

revoke all on function private.dsr_anonymize_subject(uuid) from public, anon, authenticated, app_api;
