-- H-018 | Aplicacao da semente do catalogo: validacao do JSON e insercao idempotente (so insere).
-- Idempotente. Desfazer: supabase/rollbacks/20261111210000_catalog_create_seed_apply.down.sql (manual, so em dev).
-- Fontes: docs/factory/53-DESENHO-H018.md §4.2 (CA-01..CA-04); 52-REFINO-H018.md.
-- Regras: nunca "on conflict ... do update" (o que o administrador mudou permanece); item removido do
-- arquivo nao e apagado; conflito de nome com item manual e pulado e contado (skipped_conflict);
-- (versao, checksum) ja aplicado = no-op (inserted = 0). Um evento catalog.seed.applied por execucao.
-- Codigo de erro de validacao: CT004. Execucao: pnpm db:seed:catalog (comando explicito, nunca automatico).

-- 1. Validacao do JSON (mesmas regras de packages/db/scripts/lib/catalog-seed.mjs). ----------------------
create or replace function private.catalog_seed_validate(p_seed jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  g jsonb;
  s jsonb;
  t jsonb;
  v_pos numeric;
begin
  if p_seed is null or jsonb_typeof(p_seed) <> 'object' then
    raise exception 'semente: objeto esperado' using errcode = 'CT004';
  end if;
  if exists (select 1 from jsonb_object_keys(p_seed) k where k not in ('version', 'groups', 'services')) then
    raise exception 'semente: campo desconhecido' using errcode = 'CT004';
  end if;
  if jsonb_typeof(p_seed -> 'version') is distinct from 'string'
     or char_length(p_seed ->> 'version') not between 1 and 40 then
    raise exception 'semente: versao invalida' using errcode = 'CT004';
  end if;
  if jsonb_typeof(p_seed -> 'groups') is distinct from 'array'
     or jsonb_typeof(p_seed -> 'services') is distinct from 'array' then
    raise exception 'semente: groups e services devem ser listas' using errcode = 'CT004';
  end if;

  for g in select value from jsonb_array_elements(p_seed -> 'groups') loop
    if jsonb_typeof(g) <> 'object'
       or jsonb_typeof(g -> 'key') is distinct from 'string'
       or (g ->> 'key') !~ '^g[0-9]{2}$' then
      raise exception 'semente: chave de grupo invalida' using errcode = 'CT004';
    end if;
    if jsonb_typeof(g -> 'position') is distinct from 'number' then
      raise exception 'semente: posicao de grupo invalida' using errcode = 'CT004';
    end if;
    v_pos := (g ->> 'position')::numeric;
    if v_pos <> trunc(v_pos) or v_pos < 1 then
      raise exception 'semente: posicao de grupo invalida' using errcode = 'CT004';
    end if;
    if jsonb_typeof(g -> 'name') is distinct from 'string'
       or char_length(btrim(g ->> 'name')) not between 1 and 80 then
      raise exception 'semente: nome de grupo invalido' using errcode = 'CT004';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_seed -> 'groups'))
     <> (select count(distinct value ->> 'key') from jsonb_array_elements(p_seed -> 'groups')) then
    raise exception 'semente: chave de grupo repetida' using errcode = 'CT004';
  end if;
  if (select count(*) from jsonb_array_elements(p_seed -> 'groups'))
     <> (select count(distinct private.catalog_norm(value ->> 'name')) from jsonb_array_elements(p_seed -> 'groups')) then
    raise exception 'semente: nome de grupo repetido' using errcode = 'CT004';
  end if;

  for s in select value from jsonb_array_elements(p_seed -> 'services') loop
    if jsonb_typeof(s) <> 'object'
       or jsonb_typeof(s -> 'key') is distinct from 'string'
       or (s ->> 'key') !~ '^g[0-9]{2}-[a-z0-9-]+$' then
      raise exception 'semente: chave de servico invalida' using errcode = 'CT004';
    end if;
    if not exists (select 1 from jsonb_array_elements(p_seed -> 'groups') x where x ->> 'key' = s ->> 'group_key') then
      raise exception 'semente: group_key inexistente' using errcode = 'CT004';
    end if;
    if jsonb_typeof(s -> 'name') is distinct from 'string'
       or char_length(btrim(s ->> 'name')) not between 1 and 120 then
      raise exception 'semente: nome de servico invalido' using errcode = 'CT004';
    end if;
    if jsonb_typeof(s -> 'modality') is distinct from 'string'
       or (s ->> 'modality') not in ('presencial', 'online', 'ambos') then
      raise exception 'semente: modalidade invalida' using errcode = 'CT004';
    end if;
    if jsonb_typeof(s -> 'regulated') is distinct from 'boolean'
       or jsonb_typeof(s -> 'sensitive') is distinct from 'boolean'
       or jsonb_typeof(s -> 'active') is distinct from 'boolean' then
      raise exception 'semente: flags de servico devem ser booleanas' using errcode = 'CT004';
    end if;
    if jsonb_typeof(s -> 'council_body') is null or jsonb_typeof(s -> 'council_body') = 'null' then
      if (s ->> 'active')::boolean is not true then
        raise exception 'semente: servico sem conselho deve estar ativo' using errcode = 'CT004';
      end if;
    else
      if jsonb_typeof(s -> 'council_body') is distinct from 'string'
         or char_length(s ->> 'council_body') not between 1 and 40 then
        raise exception 'semente: council_body invalido' using errcode = 'CT004';
      end if;
      if (s ->> 'regulated')::boolean is not true then
        raise exception 'semente: council_body exige regulamentado' using errcode = 'CT004';
      end if;
      if (s ->> 'active')::boolean is not false then
        raise exception 'semente: conselho profissional deve estar inativo' using errcode = 'CT004';
      end if;
    end if;
    if jsonb_typeof(s -> 'synonyms') is not null and jsonb_typeof(s -> 'synonyms') <> 'array' then
      raise exception 'semente: sinonimos devem ser lista' using errcode = 'CT004';
    end if;
    for t in select value from jsonb_array_elements(coalesce(s -> 'synonyms', '[]'::jsonb)) loop
      if jsonb_typeof(t) <> 'string' or char_length(btrim(t #>> '{}')) not between 1 and 80
         or private.catalog_norm(t #>> '{}') = '' then
        raise exception 'semente: sinonimo invalido' using errcode = 'CT004';
      end if;
    end loop;
  end loop;

  if (select count(*) from jsonb_array_elements(p_seed -> 'services'))
     <> (select count(distinct value ->> 'key') from jsonb_array_elements(p_seed -> 'services')) then
    raise exception 'semente: chave de servico repetida' using errcode = 'CT004';
  end if;
  if (select count(*) from jsonb_array_elements(p_seed -> 'services'))
     <> (select count(distinct (value ->> 'group_key', private.catalog_norm(value ->> 'name')))
           from jsonb_array_elements(p_seed -> 'services')) then
    raise exception 'semente: nome repetido no mesmo grupo' using errcode = 'CT004';
  end if;
  for g in select value from jsonb_array_elements(p_seed -> 'groups') loop
    if not exists (select 1 from jsonb_array_elements(p_seed -> 'services') x
                    where x ->> 'group_key' = g ->> 'key' and (x ->> 'active')::boolean) then
      raise exception 'semente: grupo sem servico ativo' using errcode = 'CT004';
    end if;
  end loop;
end
$$;

-- 2. Aplicacao: uma transacao (a do chamador). Somente insercao. ---------------------------------------
create or replace function private.catalog_seed_apply(p_seed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  g            jsonb;
  s            jsonb;
  t            jsonb;
  v_version    text;
  v_checksum   text;
  v_prior      app.catalog_seed_run%rowtype;
  v_gid        uuid;
  v_sid        uuid;
  v_run        uuid := gen_random_uuid();
  v_audit      uuid;
  v_rows       integer;
  v_groups_ins integer := 0;
  v_svc_ins    integer := 0;
  v_syn_ins    integer := 0;
  v_skipped    integer := 0;
  v_groups_tot integer;
  v_svc_tot    integer;
begin
  perform private.catalog_seed_validate(p_seed);
  v_version := p_seed ->> 'version';
  v_checksum := encode(sha256(convert_to(p_seed::text, 'UTF8')), 'hex');
  v_groups_tot := jsonb_array_length(p_seed -> 'groups');
  v_svc_tot := jsonb_array_length(p_seed -> 'services');

  select * into v_prior from app.catalog_seed_run where seed_version = v_version and checksum = v_checksum;
  if found then
    return jsonb_build_object(
      'status', 'ja_aplicada', 'run_id', v_prior.id,
      'groups_inserted', 0, 'services_inserted', 0, 'synonyms_inserted', 0, 'skipped_conflict', 0,
      'groups_total', v_prior.groups_total, 'services_total', v_prior.services_total);
  end if;

  -- Grupos: existe por seed_key -> intocado (preserva alteracao do administrador).
  for g in select value from jsonb_array_elements(p_seed -> 'groups') loop
    if exists (select 1 from app.service_group where seed_key = g ->> 'key') then
      continue;
    end if;
    if exists (select 1 from app.service_group where name_norm = private.catalog_norm(g ->> 'name')) then
      v_skipped := v_skipped + 1;  -- conflito por nome com item criado a mao: pula e conta
      continue;
    end if;
    insert into app.service_group (seed_key, name, position, active, updated_by_ref)
    values (
      g ->> 'key',
      btrim(g ->> 'name'),
      (g ->> 'position')::integer,
      exists (select 1 from jsonb_array_elements(p_seed -> 'services') x
               where x ->> 'group_key' = g ->> 'key' and (x ->> 'active')::boolean),
      'system:catalog_seed');
    v_groups_ins := v_groups_ins + 1;
  end loop;

  -- Servicos e sinonimos. Nunca atualiza linha existente; sinonimo novo entra, sinonimo existente fica.
  for s in select value from jsonb_array_elements(p_seed -> 'services') loop
    select id into v_sid from app.service where seed_key = s ->> 'key';
    if v_sid is null then
      select id into v_gid from app.service_group where seed_key = s ->> 'group_key';
      if v_gid is null then
        v_skipped := v_skipped + 1;  -- grupo pulado por conflito de nome
        continue;
      end if;
      if exists (select 1 from app.service where group_id = v_gid and name_norm = private.catalog_norm(s ->> 'name')) then
        v_skipped := v_skipped + 1;  -- conflito por nome dentro do grupo com item criado a mao
        continue;
      end if;
      insert into app.service (seed_key, group_id, name, modality, regulated, council_body,
                               moderation_sensitive, active, updated_by_ref)
      values (
        s ->> 'key', v_gid, btrim(s ->> 'name'), s ->> 'modality', (s ->> 'regulated')::boolean,
        case when jsonb_typeof(s -> 'council_body') = 'string' then s ->> 'council_body' end,
        (s ->> 'sensitive')::boolean, (s ->> 'active')::boolean, 'system:catalog_seed')
      returning id into v_sid;
      v_svc_ins := v_svc_ins + 1;
    end if;

    for t in select value from jsonb_array_elements(coalesce(s -> 'synonyms', '[]'::jsonb)) loop
      insert into app.service_synonym (service_id, term, active, updated_by_ref)
      values (v_sid, btrim(t #>> '{}'), true, 'system:catalog_seed')
      on conflict (service_id, term_norm) do nothing;
      get diagnostics v_rows = row_count;
      v_syn_ins := v_syn_ins + v_rows;
    end loop;
  end loop;

  v_audit := private.audit_append(
    'system:catalog_seed', 'system', 'catalog.seed.applied', 'catalog_seed_run', v_run,
    '{}'::jsonb,
    jsonb_build_object(
      'version', v_version, 'checksum', v_checksum,
      'groups_inserted', v_groups_ins, 'services_inserted', v_svc_ins,
      'synonyms_inserted', v_syn_ins, 'skipped_conflict', v_skipped));

  insert into app.catalog_seed_run (id, seed_version, checksum, groups_inserted, services_inserted,
                                    synonyms_inserted, skipped_conflict, groups_total, services_total,
                                    audit_event_id)
  values (v_run, v_version, v_checksum, v_groups_ins, v_svc_ins, v_syn_ins, v_skipped,
          v_groups_tot, v_svc_tot, v_audit);

  return jsonb_build_object(
    'status', 'aplicada', 'run_id', v_run,
    'groups_inserted', v_groups_ins, 'services_inserted', v_svc_ins, 'synonyms_inserted', v_syn_ins,
    'skipped_conflict', v_skipped, 'groups_total', v_groups_tot, 'services_total', v_svc_tot);
end
$$;

revoke all on function
  private.catalog_seed_validate(jsonb),
  private.catalog_seed_apply(jsonb)
  from public, anon, authenticated;
grant execute on function private.catalog_seed_apply(jsonb) to app_system;
