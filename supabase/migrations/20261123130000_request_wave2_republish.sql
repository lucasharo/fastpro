-- Pacote C (H-060, H-082, H-083) | Segunda onda de profissionais e republicacao de pedido.
-- Expansao: duas colunas em app.request_draft (dono do rascunho de republicacao e pedido de origem), um gatilho
-- de insercao em app.service_request que copia o vinculo de republicacao do rascunho e as funcoes:
--   private.request_wave_actions            (leitura: o que o dono pode fazer agora)
--   private.request_open_wave2              (H-060: abre a segunda onda UMA vez, slots 5 a 8)
--   private.request_republish_draft_create  (H-082/H-083: cria o RASCUNHO novo a partir do pedido de origem)
-- A republicacao nao publica sozinha: o rascunho segue o fluxo normal de /pedido (confirma e-mail e publica).
-- private.acceptance_create NAO e alterada: ela ja libera 5 a 8 quando wave2_opened_at esta preenchido.
-- Idempotente (if not exists / create or replace). Nao altera dados existentes.

-- 0. Pre-requisitos: falha com mensagem clara se a base nao estiver aplicada.
do $$
begin
  if to_regprocedure('private.draft_create(text,text,timestamptz,integer,text,jsonb,integer)') is null
     or to_regprocedure('private.request_acceptance_active(uuid,uuid)') is null
     or to_regclass('app.request_draft') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.app_user') is null then
    raise exception 'onda_republicacao_pre_requisito_ausente' using errcode = '42P01';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'app' and table_name = 'service_request' and column_name = 'wave2_opened_at')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'app' and table_name = 'service_request' and column_name = 'selected_acceptance_id') then
    raise exception 'onda_republicacao_pre_requisito_ausente' using errcode = '42P01';
  end if;
end
$$;

-- 1. Vinculo do rascunho de republicacao: dono (cliente) e pedido de origem. Nulos nos rascunhos comuns.
alter table app.request_draft add column if not exists customer_user_id uuid references app.app_user (id) on delete set null;
alter table app.request_draft add column if not exists republish_of_request_id uuid references app.service_request (id) on delete restrict;
create index if not exists request_draft_republish_idx
  on app.request_draft (republish_of_request_id) where republish_of_request_id is not null;

-- 2. Regra de elegibilidade da republicacao (uma so fonte para leitura e escrita).
--    Origem cancelada, ou publicada com prazo vencido e sem selecao.
create or replace function private.request_republish_allowed(
  p_status text,
  p_deadline timestamptz,
  p_selected uuid,
  p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'cancelado'
      or (p_status = 'publicado' and p_selected is null and p_now >= p_deadline)
$$;

-- 3. Pedido publicado a partir de rascunho de republicacao herda o vinculo (antes da insercao).
--    Assim a publicacao normal (request_publish_commit) nao precisa mudar. A cadeia usa chain_id.
create or replace function private.service_request_republicacao_bi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem uuid;
begin
  select d.republish_of_request_id into v_origem
    from app.request_draft d
   where d.id = new.origin_draft_id;
  if v_origem is not null then
    new.republished_from_id := v_origem;
    new.is_republication := true;
    new.chain_id := coalesce((select o.chain_id from app.service_request o where o.id = v_origem), v_origem);
  end if;
  return new;
end
$$;

drop trigger if exists service_request_republicacao_bi on app.service_request;
create trigger service_request_republicacao_bi
  before insert on app.service_request
  for each row execute function private.service_request_republicacao_bi();

-- 4. Leitura do que o dono pode fazer. Zero linhas = pedido inexistente ou de outro (a rota responde 404 uniforme).
create or replace function private.request_wave_actions(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_can_call_more boolean, out_can_republish boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (r.status = 'publicado'
       and r.acceptances_count >= 4
       and p_now < r.acceptance_deadline_at
       and r.selected_acceptance_id is null
       and r.wave2_opened_at is null) as out_can_call_more,
    (private.request_republish_allowed(r.status, r.acceptance_deadline_at, r.selected_acceptance_id, p_now)
       and not exists (select 1 from app.service_request x where x.republished_from_id = r.id)
       and not exists (
         select 1 from app.request_draft d
          where d.republish_of_request_id = r.id
            and d.status in ('aberto', 'aguardando_email')
            and d.expires_at > p_now)) as out_can_republish
    from app.service_request r
   where r.id = p_request_id
     and r.customer_user_id = p_customer_id
$$;

-- 5. Segunda onda (H-060). Abre UMA vez: grava wave2_opened_at, que libera os slots 5 a 8 em private.acceptance_create.
--    Repeticao devolve sem_mudanca (antes das demais checagens).
create or replace function private.request_open_wave2(p_request_id uuid, p_customer_id uuid, p_now timestamptz)
returns table (out_outcome text, out_wave2_opened_at timestamptz, out_acceptances_count integer)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_request_id is null or p_customer_id is null or p_now is null then
    raise exception 'onda_parametro_invalido' using errcode = '22023';
  end if;

  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::timestamptz, null::integer;
    return;
  end if;

  if v_req.wave2_opened_at is not null then
    return query select 'sem_mudanca'::text, v_req.wave2_opened_at, v_req.acceptances_count;
    return;
  end if;

  if v_req.status <> 'publicado' or v_req.selected_acceptance_id is not null then
    return query select 'estado_invalido'::text, null::timestamptz, v_req.acceptances_count;
    return;
  end if;

  if p_now >= v_req.acceptance_deadline_at then
    return query select 'admissao_encerrada'::text, null::timestamptz, v_req.acceptances_count;
    return;
  end if;

  -- A contagem inclui aceites retirados (acceptances_count so cresce).
  if v_req.acceptances_count < 4 then
    return query select 'abaixo_do_minimo'::text, null::timestamptz, v_req.acceptances_count;
    return;
  end if;

  update app.service_request r
     set wave2_opened_at = p_now,
         version = r.version + 1
   where r.id = p_request_id;

  return query select 'aberta'::text, p_now, v_req.acceptances_count;
end
$$;

-- 6. Republicacao (H-082, H-083). Cria UM rascunho novo com servico, urgencia, descricao e endereco em texto do
--    pedido de origem. O endereco chega decifrado pela API (cofre do pedido); o banco nunca recebe a chave.
--    Uma republicacao viva por pedido de origem (ja_existe) e uma unica por origem (ja_republicado).
--    Reutiliza private.draft_create (mesmas regras de servico ativo e teto global de rascunhos vivos).
create or replace function private.request_republish_draft_create(
  p_request_id uuid,
  p_customer_id uuid,
  p_secret_hash text,
  p_ip_hmac text,
  p_now timestamptz,
  p_ttl_days integer,
  p_live_cap integer,
  p_address_text text)
returns table (out_outcome text, out_draft_id uuid, out_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_req app.service_request%rowtype;
  v_draft record;
  v_fields jsonb;
begin
  if p_request_id is null or p_customer_id is null or p_secret_hash is null or p_ip_hmac is null
     or p_now is null or p_ttl_days is null or p_live_cap is null or p_address_text is null then
    raise exception 'republicacao_parametro_invalido' using errcode = '22023';
  end if;

  -- Serializa as republicacoes do mesmo pedido de origem (FOR UPDATE no pedido).
  select * into v_req from app.service_request r where r.id = p_request_id for update;
  if not found or v_req.customer_user_id <> p_customer_id then
    return query select 'nao_encontrado'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if not private.request_republish_allowed(v_req.status, v_req.acceptance_deadline_at, v_req.selected_acceptance_id, p_now) then
    return query select 'origem_invalida'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if exists (select 1 from app.service_request x where x.republished_from_id = p_request_id) then
    return query select 'ja_republicado'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if exists (
    select 1 from app.request_draft d
     where d.republish_of_request_id = p_request_id
       and d.customer_user_id = p_customer_id
       and d.status in ('aberto', 'aguardando_email')
       and d.expires_at > p_now) then
    return query select 'ja_existe'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_fields := jsonb_build_object(
    'service_id', v_req.service_id,
    'address_text', p_address_text,
    'urgency', v_req.urgency,
    'description', v_req.description);

  -- Sem cookie vencido a descartar aqui (p_expired_hash nulo): o cookie anterior do navegador e substituido pela rota.
  select * into v_draft from private.draft_create(
    p_secret_hash, p_ip_hmac, p_now, p_ttl_days, null, v_fields, p_live_cap);

  -- Mudanca so de vinculo (nao toca campos de conteudo, entao o gatilho de confirmacao nao zera nada).
  update app.request_draft d
     set customer_user_id = p_customer_id,
         republish_of_request_id = p_request_id
   where d.id = v_draft.out_id;

  return query select 'rascunho_criado'::text, v_draft.out_id, v_draft.out_expires_at;
end
$$;

-- 7. Privilegios: nenhuma funcao nova executavel por public, anon, authenticated, service_role, app_api ou
--    app_backup_reader. So app_system executa (mesmo padrao de 20261123100000_chat_selection_core).
revoke all on function
  private.request_republish_allowed(text, timestamptz, uuid, timestamptz),
  private.request_wave_actions(uuid, uuid, timestamptz),
  private.request_open_wave2(uuid, uuid, timestamptz),
  private.request_republish_draft_create(uuid, uuid, text, text, timestamptz, integer, integer, text)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.request_republish_allowed(text, timestamptz, uuid, timestamptz) to app_system;
grant execute on function private.request_wave_actions(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_open_wave2(uuid, uuid, timestamptz) to app_system;
grant execute on function private.request_republish_draft_create(uuid, uuid, text, text, timestamptz, integer, integer, text) to app_system;

-- O gatilho de insercao e chamado pelo proprio banco; nenhum papel executa a funcao diretamente.
revoke all on function private.service_request_republicacao_bi()
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;
