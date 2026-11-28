do $$
declare
  v_titular uuid := gen_random_uuid();
  v_perfil uuid := gen_random_uuid();
  v_acesso uuid := gen_random_uuid();
  v_expo uuid := gen_random_uuid();
  v_auth uuid := gen_random_uuid();
  v_caso uuid;
  v_caso_pro uuid;
  v_caso_ac uuid;
  v_caso_exp uuid;
  v_txt text;
  v_n integer;
  v_path text;
begin
  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  values (v_titular, v_titular::text || '@example.test', v_auth, 'em_eliminacao', now(), now()),
         (v_perfil, v_perfil::text || '@example.test', gen_random_uuid(), 'em_eliminacao', now(), now()),
         (v_acesso, v_acesso::text || '@example.test', gen_random_uuid(), 'ativo', now(), now()),
         (v_expo, v_expo::text || '@example.test', gen_random_uuid(), 'ativo', now(), now());
  insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
  values (v_perfil, 'aprovada', now(), now(), now());

  -- Gatilho de enfileiramento: so eliminacao pelo titular entra na fila de processamento automatico
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-FFFFFF', v_titular, 'eliminacao', 'titular', now() + interval '15 days') returning id into v_caso;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-GGGGGG', v_perfil, 'eliminacao', 'titular', now() + interval '15 days') returning id into v_caso_pro;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-HHHHHH', v_acesso, 'acesso', 'titular', now() + interval '15 days') returning id into v_caso_ac;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-JJJJJJ', v_expo, 'acesso', 'titular', now() + interval '15 days') returning id into v_caso_exp;

  select count(*) into v_n from ops.job where dedupe_key = 'dsr.process_auto:' || v_caso and kind = 'dsr.process_auto';
  if v_n <> 1 then raise exception 'ensaio: job de processamento automatico ausente'; end if;
  select count(*) into v_n from ops.job where dedupe_key = 'dsr.process_auto:' || v_caso_ac;
  if v_n <> 0 then raise exception 'ensaio: acesso nao deveria enfileirar processamento automatico'; end if;

  -- Processamento automatico: nao elegivel (perfil profissional) nao muda nada
  v_txt := app.dsr_job_process_auto(v_caso_pro);
  if v_txt <> 'nao_elegivel' then raise exception 'ensaio: perfil profissional nao recusado: %', v_txt; end if;
  select status into v_txt from app.dsr_case where id = v_caso_pro;
  if v_txt <> 'aberto' then raise exception 'ensaio: caso nao elegivel foi alterado'; end if;

  -- Elegivel: aberto passa por em_analise e deferido, e a conta e anonimizada numa so instrucao
  v_txt := app.dsr_job_process_auto(v_caso);
  if v_txt <> 'processado' then raise exception 'ensaio: processamento automatico nao processou: %', v_txt; end if;
  select status || '/' || outcome into v_txt from app.dsr_case where id = v_caso;
  if v_txt <> 'concluido/conta_anonimizada' then raise exception 'ensaio: caso nao concluido: %', v_txt; end if;
  select status into v_txt from app.app_user where id = v_titular;
  if v_txt <> 'anonimizado' then raise exception 'ensaio: conta nao anonimizada'; end if;
  select count(*) into v_n from app.dsr_case_event where case_id = v_caso and event = 'status_changed';
  if v_n <> 2 then raise exception 'ensaio: eventos de estado incompletos: %', v_n; end if;
  v_txt := app.dsr_job_process_auto(v_caso);
  if v_txt <> 'ja_encerrado' then raise exception 'ensaio: reexecucao nao e no-op: %', v_txt; end if;

  -- Limpeza do Supabase Auth: job criado na anonimizacao; alvo devolve o identificador so se anonimizada
  select count(*) into v_n from ops.job where dedupe_key = 'dsr.auth_cleanup:' || v_titular;
  if v_n <> 1 then raise exception 'ensaio: job de limpeza de autenticacao ausente'; end if;
  select out_status into v_txt from app.dsr_job_auth_cleanup_target(v_titular);
  if v_txt <> 'pronto' then raise exception 'ensaio: alvo de limpeza nao pronto'; end if;
  select out_status into v_txt from app.dsr_job_auth_cleanup_target(v_perfil);
  if v_txt <> 'nao_anonimizado' then raise exception 'ensaio: alvo de limpeza liberado sem anonimizacao'; end if;

  -- Aviso de indeferimento: so o evento rejected gera linha, uma vez, sem aviso final de eliminacao
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (v_caso_ac, 'assigned', null, null, null, '{}'::jsonb);
  select count(*) into v_n from ops.email_outbox where dedupe_key like 'dsr:' || v_caso_ac::text || ':%';
  if v_n <> 0 then raise exception 'ensaio: evento que nao e indeferimento gerou e-mail'; end if;
  insert into app.dsr_case_event (case_id, event, from_status, to_status, actor_ref, detail)
  values (v_caso_ac, 'rejected', 'aberto', 'indeferido_total', null, '{"outcome":"recusado_impedimento_legal"}'::jsonb);
  select count(*) into v_n from ops.email_outbox
   where dedupe_key = 'dsr:' || v_caso_ac::text || ':dsr_indeferido' and email_type = 'dsr_indeferido'
     and recipient_user_id = v_acesso and state = 'pendente';
  if v_n <> 1 then raise exception 'ensaio: aviso de indeferimento ausente'; end if;

  -- Expurgo do extrato: alvo so depois do vencimento; marca uma vez; job no vencimento
  insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, generated_at, expires_at)
  values (v_caso_exp, gen_random_uuid()::text || '.json', repeat('a', 64), repeat('b', 64), 1, 100,
          now() - interval '8 days', now() - interval '1 day');
  select count(*) into v_n from ops.job
   where dedupe_key = 'dsr.export_purge:' || v_caso_exp::text
     and run_at = (select expires_at from app.dsr_export where case_id = v_caso_exp);
  if v_n <> 1 then raise exception 'ensaio: job de expurgo ausente ou sem vencimento'; end if;
  select out_status, out_storage_path into v_txt, v_path from app.dsr_job_export_target(v_caso_exp);
  if v_txt <> 'pronto_para_expurgo' or v_path is null then raise exception 'ensaio: alvo de expurgo nao pronto'; end if;
  v_txt := app.dsr_job_export_mark_purged(v_caso_exp);
  if v_txt <> 'expurgado' then raise exception 'ensaio: expurgo nao marcado: %', v_txt; end if;
  v_txt := app.dsr_job_export_mark_purged(v_caso_exp);
  if v_txt <> 'ja_expurgado' then raise exception 'ensaio: expurgo repetido nao e no-op'; end if;

  insert into app.dsr_export (case_id, storage_path, sha256, signature, schema_version, size_bytes, generated_at, expires_at)
  values (v_caso_ac, gen_random_uuid()::text || '.json', repeat('c', 64), repeat('d', 64), 1, 100,
          now(), now() + interval '7 days');
  v_txt := app.dsr_job_export_mark_purged(v_caso_ac);
  if v_txt <> 'ainda_valido' then raise exception 'ensaio: extrato vigente foi marcado como expurgado'; end if;
  select out_status into v_txt from app.dsr_job_export_target(v_caso_ac);
  if v_txt <> 'ainda_valido' then raise exception 'ensaio: alvo expoe extrato vigente'; end if;
end
$$;
