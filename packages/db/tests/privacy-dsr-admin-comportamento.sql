do $$
declare
  v_dpo uuid := gen_random_uuid();
  v_outro uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_titular uuid := gen_random_uuid();
  v_titular2 uuid := gen_random_uuid();
  v_acesso_user uuid := gen_random_uuid();
  v_corr_user uuid := gen_random_uuid();
  v_caso uuid;
  v_caso_rej uuid;
  v_caso_ac uuid;
  v_caso_cor uuid;
  v_caso_op uuid;
  v_n integer;
  v_ok boolean;
  v_status text;
  v_resp uuid;
  v_txt text;
  v_json jsonb;
begin
  insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
  select u.id, u.id::text || '@example.test', gen_random_uuid(), u.st, now(), now()
    from (values (v_dpo, 'ativo'), (v_outro, 'ativo'), (v_sup, 'ativo'), (v_titular, 'em_eliminacao'),
                 (v_titular2, 'em_eliminacao'), (v_acesso_user, 'ativo'), (v_corr_user, 'ativo')) as u(id, st);

  insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
  values (v_dpo, 'ativo', 'bootstrap', null, now(), now(), now()),
         (v_outro, 'ativo', 'bootstrap', null, now(), now(), now()),
         (v_sup, 'ativo', 'bootstrap', null, now(), now(), now());

  insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
  values (gen_random_uuid(), v_dpo, 'dpo', null, 'bootstrap', now()),
         (gen_random_uuid(), v_outro, 'dpo', null, 'bootstrap', now()),
         (gen_random_uuid(), v_sup, 'suporte', null, 'bootstrap', now());

  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-AAAAAA', v_titular, 'eliminacao', 'titular', now() + interval '15 days') returning id into v_caso;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-BBBBBB', v_titular2, 'eliminacao', 'titular', now() + interval '15 days') returning id into v_caso_rej;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-CCCCCC', v_acesso_user, 'acesso', 'titular', now() + interval '15 days') returning id into v_caso_ac;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-DDDDDD', v_corr_user, 'correcao', 'titular', now() + interval '15 days') returning id into v_caso_cor;
  insert into app.dsr_case (protocol, subject_user_id, kind, channel, deadline_at)
  values ('DSR-20261119-EEEEEE', v_dpo, 'acesso', 'titular', now() + interval '15 days') returning id into v_caso_op;

  -- Leitura reduzida do suporte: so protocolo e status
  select bool_and(l.out_kind is null) and count(*) > 0 into v_ok from app.dsr_admin_list(v_sup, null, null, null, null, 50, null, null) l;
  if not v_ok then raise exception 'ensaio: leitura reduzida do suporte falhou'; end if;
  v_json := app.dsr_admin_get(v_sup, v_caso);
  if v_json ? 'kind' or not (v_json ? 'protocol') or not (v_json ? 'status') then
    raise exception 'ensaio: detalhe reduzido do suporte vazou campos';
  end if;
  v_json := app.dsr_admin_get(v_dpo, v_caso);
  if not (v_json ? 'pendencias') or not (v_json ? 'linha_do_tempo') then raise exception 'ensaio: detalhe completo do DPO incompleto'; end if;

  -- Negativos de permissao e de identidade
  begin
    perform app.dsr_assign(v_sup, v_caso, v_outro);
    raise exception 'ensaio: suporte atribuiu caso';
  exception when others then
    if sqlerrm <> 'permissao_negada' then raise; end if;
  end;
  begin
    perform 1 from app.dsr_admin_list(v_sup, null, 'eliminacao', null, null, 10, null, null);
    raise exception 'ensaio: filtro nao recusado ao suporte';
  exception when others then
    if sqlerrm <> 'filtro_nao_permitido' then raise; end if;
  end;
  begin
    perform app.dsr_assign(v_dpo, v_caso_op, v_outro);
    raise exception 'ensaio: operador titular decidiu o proprio caso';
  exception when others then
    if sqlerrm <> 'dsr_operador_e_titular' then raise; end if;
  end;
  begin
    perform app.dsr_assign(v_dpo, v_caso, v_sup);
    raise exception 'ensaio: responsavel sem dsr.decide aceito';
  exception when others then
    if sqlerrm <> 'dsr_responsavel_invalido' then raise; end if;
  end;

  -- Atribuicao: aberto vai a em_analise e grava o responsavel
  select out_status, out_assigned_to into v_status, v_resp from app.dsr_assign(v_dpo, v_caso, v_outro);
  if v_status <> 'em_analise' or v_resp <> v_outro then raise exception 'ensaio: atribuicao incorreta'; end if;
  select count(*) into v_n from app.dsr_case_event where case_id = v_caso and event = 'assigned';
  if v_n <> 1 then raise exception 'ensaio: evento assigned ausente'; end if;

  -- Deferimento: correcao recusada; eliminacao em_analise vai a deferido
  begin
    perform app.dsr_defer(v_dpo, v_caso_cor);
    raise exception 'ensaio: correcao deferida sem aplicacao';
  exception when others then
    if sqlerrm <> 'correcao_pendente_de_implementacao' then raise; end if;
  end;
  select out_status into v_status from app.dsr_defer(v_dpo, v_caso);
  if v_status <> 'deferido' then raise exception 'ensaio: deferimento incorreto'; end if;
  begin
    perform app.dsr_defer(v_sup, v_caso_op);
    raise exception 'ensaio: suporte deferiu';
  exception when others then
    if sqlerrm <> 'permissao_negada' then raise; end if;
  end;

  -- Indeferimento: nota e desfecho validados; eliminacao devolve a conta a ativo
  begin
    perform app.dsr_reject(v_dpo, v_caso_rej, '   ', false, 'recusado_impedimento_legal');
    raise exception 'ensaio: indeferimento sem nota aceito';
  exception when others then
    if sqlerrm <> 'nota_base_legal_obrigatoria' then raise; end if;
  end;
  begin
    perform app.dsr_reject(v_dpo, v_caso_rej, 'Motivo de teste.', false, 'extrato_disponibilizado');
    raise exception 'ensaio: desfecho invalido aceito';
  exception when others then
    if sqlerrm <> 'desfecho_invalido' then raise; end if;
  end;
  select out_status into v_status from app.dsr_reject(v_dpo, v_caso_rej, 'Motivo de teste.', false, 'recusado_impedimento_legal');
  if v_status <> 'indeferido_total' then raise exception 'ensaio: indeferimento incorreto'; end if;
  select status into v_txt from app.app_user where id = v_titular2;
  if v_txt <> 'ativo' then raise exception 'ensaio: conta nao voltou a ativo apos indeferimento'; end if;

  -- Anonimizacao pelo operador (caso deferido, conta sem pendencias)
  v_txt := app.dsr_admin_anonymize(v_dpo, v_caso);
  if v_txt <> 'processado' then raise exception 'ensaio: anonimizacao nao processou'; end if;
  select status into v_txt from app.app_user where id = v_titular;
  if v_txt <> 'anonimizado' then raise exception 'ensaio: conta nao anonimizada'; end if;
  select status || '/' || outcome into v_txt from app.dsr_case where id = v_caso;
  if v_txt <> 'concluido/conta_anonimizada' then raise exception 'ensaio: caso nao concluido'; end if;
  begin
    perform app.dsr_admin_anonymize(v_dpo, v_caso_ac);
    raise exception 'ensaio: anonimizou caso de acesso';
  exception when others then
    if sqlerrm <> 'dsr_tipo_invalido' then raise; end if;
  end;

  -- Extrato: so de caso deferido de acesso; o conteudo volta a API
  begin
    perform 1 from app.dsr_admin_generate_extract(v_dpo, v_caso_ac);
    raise exception 'ensaio: extrato gerado sem deferimento';
  exception when others then
    if sqlerrm <> 'dsr_nao_deferido' then raise; end if;
  end;
  perform app.dsr_defer(v_dpo, v_caso_ac);
  select count(*) into v_n from app.dsr_admin_generate_extract(v_dpo, v_caso_ac) g where g.out_payload is not null;
  if v_n <> 1 then raise exception 'ensaio: extrato nao gerado para caso deferido'; end if;

  -- Filtros de fila para o DPO
  select count(*) into v_n from app.dsr_admin_list(v_dpo, 'deferido', null, null, null, 50, null, null) l where l.out_case_id = v_caso_ac;
  if v_n <> 1 then raise exception 'ensaio: fila nao filtrou por status'; end if;

  -- Permissoes semeadas
  if not exists (select 1 from app.admin_role_permission where role_code = 'dpo' and permission_code = 'dsr.decide') then
    raise exception 'ensaio: dpo sem dsr.decide';
  end if;
  if exists (select 1 from app.admin_role_permission where role_code = 'suporte' and permission_code = 'dsr.decide') then
    raise exception 'ensaio: suporte com dsr.decide';
  end if;
end
$$;
