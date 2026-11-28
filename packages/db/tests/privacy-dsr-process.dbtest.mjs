// Issue 120 (H-111) | Processamento do caso (app.dsr_process), vigia de prazo (app.dsr_deadline_watch) e abertura
// assistida pelo DPO (app.dsr_open_assisted): 147-DESENHO-H111 §4.2, §4.4 e §7 (T-DB-27, T-DB-28, T-DB-29 e T-DB-03).
// Banco de desenvolvimento. Cada teste roda em transacao e e desfeito (rollback). Valores sinteticos (@example.test).
// Sem rede, sem e-mail real. Nenhum dado e deixado no banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../scripts/lib/env.mjs';

const COMPORTAMENTO = `
do $$
declare
  v_dpo uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_titular uuid := gen_random_uuid();
  v_titular2 uuid := gen_random_uuid();
  v_corr_user uuid := gen_random_uuid();
  v_w1 uuid := gen_random_uuid();
  v_w2 uuid := gen_random_uuid();
  v_w3 uuid := gen_random_uuid();
  v_detalhes jsonb := '{"identity_check":{"code":"conferido_presencial"}}'::jsonb;
  v_caso uuid;
  v_caso_el uuid;
  v_caso_cor uuid;
  v_caso_el_ok uuid;
  v_caso_w1 uuid;
  v_caso_w2 uuid;
  v_caso_w3 uuid;
  v_aberto uuid;
  v_proto text;
  v_st text;
  v_prazo timestamptz;
  v_n integer;
  v_outcome text;
  v_conta text;
  v_msg text;
begin
  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  select u.id, u.id::text || '@example.test', gen_random_uuid(), 'ativo', now(), now()
    from (values (v_dpo), (v_sup), (v_titular), (v_titular2), (v_corr_user), (v_w1), (v_w2), (v_w3)) as u(id);

  insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
  values (v_dpo, 'ativo', 'bootstrap', null, now(), now(), now()),
         (v_sup, 'ativo', 'bootstrap', null, now(), now(), now());

  insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
  values (gen_random_uuid(), v_dpo, 'dpo', null, 'bootstrap', now()),
         (gen_random_uuid(), v_sup, 'suporte', null, 'bootstrap', now());

  -- A. Abertura assistida de acesso: sem step-up, canal dpo_externo, operador registrado, e-mail na fila.
  select out_case_id, out_protocol, out_status, out_deadline_at into v_caso, v_proto, v_st, v_prazo
    from app.dsr_open_assisted(v_dpo, v_titular, 'acesso', v_detalhes, 'dpo_externo');
  if v_st <> 'aberto' then raise exception 'ensaio A: status inicial %', v_st; end if;
  select count(*) into v_n from app.dsr_case c
   where c.id = v_caso and c.channel = 'dpo_externo' and c.opened_by_operator_id = v_dpo and c.subject_user_id = v_titular;
  if v_n <> 1 then raise exception 'ensaio A: canal ou operador nao gravados'; end if;
  select count(*) into v_n from app.dsr_case_event e where e.case_id = v_caso and e.event = 'opened';
  if v_n <> 1 then raise exception 'ensaio A: evento opened ausente'; end if;
  select count(*) into v_n from ops.email_outbox o where o.dedupe_key like 'dsr:' || v_caso::text || ':%';
  if v_n <> 1 then raise exception 'ensaio A: e-mail de abertura nao enfileirado'; end if;
  if (select count(*) from audit.audit_event a where a.action = 'dsr.case_opened_assisted') < 1 then
    raise exception 'ensaio A: auditoria dsr.case_opened_assisted ausente';
  end if;

  -- B. Negativos da abertura assistida (cada um deve falhar com o codigo esperado).
  begin
    perform app.dsr_open_assisted(v_sup, v_titular2, 'acesso', v_detalhes, 'dpo_externo');
    raise exception 'ensaio B1: suporte abriu caso assistido';
  exception when others then
    if sqlerrm <> 'permissao_negada' then raise; end if;
  end;
  begin
    perform app.dsr_open_assisted(v_dpo, v_dpo, 'acesso', v_detalhes, 'dpo_externo');
    raise exception 'ensaio B2: operador abriu caso sobre si mesmo';
  exception when others then
    if sqlerrm <> 'dsr_operador_e_titular' then raise; end if;
  end;
  begin
    perform app.dsr_open_assisted(v_dpo, v_titular2, 'acesso', v_detalhes, 'titular');
    raise exception 'ensaio B3: canal titular aceito na abertura assistida';
  exception when others then
    if sqlerrm <> 'canal_invalido' then raise; end if;
  end;
  begin
    perform app.dsr_open_assisted(v_dpo, v_titular2, 'acesso', '{}'::jsonb, 'dpo_externo');
    raise exception 'ensaio B4: abertura sem conferencia de identidade aceita';
  exception when others then
    if sqlerrm <> 'identity_check_obrigatorio' then raise; end if;
  end;
  begin
    perform app.dsr_open_assisted(v_dpo, v_titular, 'acesso', v_detalhes, 'dpo_externo');
    raise exception 'ensaio B5: segundo caso de acesso ativo aceito';
  exception when others then
    if sqlerrm <> 'dsr_em_andamento' then raise; end if;
  end;

  -- C. Eliminacao assistida: conta suspensa (em_eliminacao) e caso deferido; a anonimizacao segue recusada (dpo_externo).
  select out_case_id into v_caso_el from app.dsr_open_assisted(v_dpo, v_titular2, 'eliminacao', v_detalhes, 'dpo_externo');
  select status into v_conta from app.app_user where id = v_titular2;
  if v_conta <> 'em_eliminacao' then raise exception 'ensaio C1: conta nao suspensa na eliminacao assistida'; end if;
  perform app.dsr_defer(v_dpo, v_caso_el);
  begin
    perform app.dsr_process(v_dpo, v_caso_el);
    raise exception 'ensaio C2: anonimizacao assistida executou sem dupla aprovacao';
  exception when others then
    if sqlerrm like 'ensaio%' then raise; end if;
  end;
  select status into v_st from app.dsr_case where id = v_caso_el;
  if v_st <> 'deferido' then raise exception 'ensaio C3: caso mudou apos processamento recusado (%)', v_st; end if;

  -- D. Eliminacao pelo titular (caso direto, sem step-up): processar anonimiza e fecha o caso.
  update app.app_user set status = 'em_eliminacao' where id = v_corr_user;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261120-ELIMAA', v_corr_user, 'eliminacao', 'titular', now() + interval '15 days')
  returning id into v_caso_el_ok;
  perform app.dsr_defer(v_dpo, v_caso_el_ok);
  select out_outcome into v_outcome from app.dsr_process(v_dpo, v_caso_el_ok);
  if v_outcome <> 'conta_anonimizada' then raise exception 'ensaio D1: desfecho da eliminacao (%)', v_outcome; end if;
  select status into v_conta from app.app_user where id = v_corr_user;
  if v_conta <> 'anonimizado' then raise exception 'ensaio D2: conta nao anonimizada (%)', v_conta; end if;

  -- E. Correcao: a lista de campos corrigiveis comeca vazia, entao qualquer campo e recusado.
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, request_details, deadline_at)
  values ('DSR-20261120-CORRIG', v_titular, 'correcao', 'titular',
          '{"proposed_changes":{"email":"novo@example.test"}}'::jsonb, now() + interval '15 days')
  returning id into v_caso_cor;
  update app.dsr_case set status = 'deferido' where id = v_caso_cor;
  begin
    perform app.dsr_process(v_dpo, v_caso_cor);
    raise exception 'ensaio E1: correcao de e-mail aplicada sem lista permitida';
  exception when others then
    if sqlerrm <> 'campo_nao_corrigivel' then raise; end if;
  end;
  update app.dsr_case set request_details = '{}'::jsonb where id = v_caso_cor;
  begin
    perform app.dsr_process(v_dpo, v_caso_cor);
    raise exception 'ensaio E2: correcao sem alteracao processada';
  exception when others then
    if sqlerrm <> 'correcao_sem_alteracao' then raise; end if;
  end;
  if (select status from app.dsr_case where id = v_caso_cor) <> 'deferido' then
    raise exception 'ensaio E3: correcao saiu de deferido sem aplicacao';
  end if;

  -- F. Acesso nao passa pelo processamento (extrato e gravado pela API) e caso nao deferido e recusado.
  begin
    perform app.dsr_process(v_dpo, v_caso);
    raise exception 'ensaio F1: acesso processado pelo despacho geral';
  exception when others then
    if sqlerrm <> 'dsr_nao_deferido' and sqlerrm <> 'dsr_acesso_usa_extrato' then raise; end if;
  end;

  -- G. Vigia de prazo: ate 3 dias, vencido; caso com prazo longo fica fora; janela invalida recusada.
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261120-WATCHA', v_w1, 'acesso', 'titular', now() + interval '1 day') returning id into v_caso_w1;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, opened_at, deadline_at)
  values ('DSR-20261120-WATCHB', v_w2, 'acesso', 'titular', now() - interval '20 days', now() - interval '1 day')
  returning id into v_caso_w2;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261120-WATCHC', v_w3, 'acesso', 'titular', now() + interval '15 days') returning id into v_caso_w3;
  if (select out_situacao from app.dsr_deadline_watch() where out_case_id = v_caso_w1) <> 'ate_3_dias' then
    raise exception 'ensaio G1: caso a 1 dia nao sinalizado como ate_3_dias';
  end if;
  if (select out_situacao from app.dsr_deadline_watch() where out_case_id = v_caso_w2) <> 'vencido' then
    raise exception 'ensaio G2: caso vencido nao sinalizado';
  end if;
  select count(*) into v_n from app.dsr_deadline_watch() where out_case_id = v_caso_w3;
  if v_n <> 0 then raise exception 'ensaio G3: caso com prazo longo apareceu no vigia'; end if;
  begin
    perform 1 from app.dsr_deadline_watch(31);
    raise exception 'ensaio G4: janela de 31 dias aceita';
  exception when others then
    if sqlerrm <> 'janela_invalida' then raise; end if;
  end;
end
$$;
`;

let client;
before(async () => {
  client = await connect();
});
after(async () => {
  await client?.end();
});

test('T-DB-27/28/29 | abertura assistida, processamento por tipo e vigia de prazo (comportamento, rollback)', async () => {
  await client.query('begin');
  try {
    await client.query(COMPORTAMENTO);
  } finally {
    await client.query('rollback');
  }
});

test('T-DB-03 | app.dsr_process, app.dsr_deadline_watch e app.dsr_open_assisted: security definer, search_path vazio, execute so para app_system', async () => {
  const { rows } = await client.query(`
    select p.oid::regprocedure::text as assinatura,
           p.prosecdef,
           p.proconfig,
           has_function_privilege('app_system', p.oid, 'EXECUTE') as app_system,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api,
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('dsr_process', 'dsr_deadline_watch', 'dsr_open_assisted')`);
  assert.equal(rows.length, 3, 'tres funcoes novas');
  for (const r of rows) {
    assert.equal(r.prosecdef, true, `security definer em ${r.assinatura}`);
    assert.ok((r.proconfig ?? []).some((c) => c.startsWith('search_path=')), `search_path em ${r.assinatura}`);
    assert.equal(r.app_system, true, `app_system executa ${r.assinatura}`);
    assert.equal(r.anon, false, `anon nao executa ${r.assinatura}`);
    assert.equal(r.authenticated, false, `authenticated nao executa ${r.assinatura}`);
    assert.equal(r.app_api, false, `app_api nao executa ${r.assinatura}`);
    assert.equal(r.publico, false, `PUBLIC nao executa ${r.assinatura}`);
  }
});

test('T-DB-03 | a lista de campos corrigiveis (privada) nao e executavel por anon, authenticated, app_api nem PUBLIC', async () => {
  const { rows } = await client.query(`
    select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('app_api', p.oid, 'EXECUTE') as app_api
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'dsr_correcao_campos'`);
  assert.equal(rows.length, 1, 'funcao auxiliar existe');
  assert.equal(rows[0].anon, false);
  assert.equal(rows[0].authenticated, false);
  assert.equal(rows[0].app_api, false);
});
