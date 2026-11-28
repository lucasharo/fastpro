-- H-025 | Rascunho de pedido sem conta (docs/factory/74-DESENHO-H025.md, §1 a §3; D-05, D-10).
-- Idempotente. Desfazer: supabase/rollbacks/20261111440000_draft_create_request_draft.down.sql.
-- NAO APLICADA: escrita nesta etapa, aplicacao no banco fica para a etapa de banco (sequencia do WF-03).
-- Tabela sem coordenada (G-01, I-28): so o texto do endereco. Sem e-mail, nome ou telefone (R2).
-- Estados: a coluna aceita os quatro; as funcoes desta historia gravam so aberto e descartado.
-- Escrita e leitura so por funcoes security definer (search_path vazio), execute so para app_api.
-- Tempo: p_now informado pelo chamador (relogio do servidor), para o prazo, o teto e os testes.

create table if not exists app.request_draft (
  id                 uuid primary key default gen_random_uuid(),
  browser_nonce_hash text not null check (browser_nonce_hash ~ '^[0-9a-f]{64}$'),
  service_id         uuid references app.service (id),
  address_text       text check (address_text is null or char_length(address_text) between 3 and 200),
  urgency            text check (urgency is null or urgency in ('imediato', 'proximas_semanas', 'proximo_mes', 'nao_definido')),
  description        text check (description is null or char_length(description) between 1 and 2000),
  status             text not null default 'aberto'
                     check (status in ('aberto', 'aguardando_email', 'descartado', 'publicado')),
  expires_at         timestamptz not null,
  ip_hmac            text not null check (ip_hmac ~ '^[0-9a-f]{64}$'),
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp()
);
comment on table app.request_draft is
  'Rascunho de pedido sem conta (H-025, 09 request_draft). Escrita so por funcao; sem coordenada.';

-- Um rascunho vivo por segredo de navegador. Linhas descartadas ou publicadas ficam fora do indice.
create unique index if not exists request_draft_nonce_vivo_key
  on app.request_draft (browser_nonce_hash)
  where status in ('aberto', 'aguardando_email');
-- Expurgo por prazo (H-110) e limite de criacao por IP-HMAC.
create index if not exists request_draft_expires_at_idx on app.request_draft (expires_at);
create index if not exists request_draft_ip_created_idx on app.request_draft (ip_hmac, created_at);

-- Postura igual as migracoes anteriores: RLS habilitada e forcada, sem politicas, sem DML para papeis
-- de API. app_backup_reader recebe SELECT pelo privilegio padrao do schema app; a leitura direta e revogada.
alter table app.request_draft enable row level security;
alter table app.request_draft force row level security;
revoke all on app.request_draft
  from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;

-- 1. Leitura do rascunho vivo (aberto ou aguardando_email, prazo nao vencido). Zero linhas = nao existe.
create or replace function private.draft_get(p_hash text, p_now timestamptz)
returns table (
  out_id uuid, out_status text, out_service_id uuid, out_address_text text,
  out_urgency text, out_description text, out_expires_at timestamptz, out_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.status, r.service_id, r.address_text, r.urgency, r.description, r.expires_at, r.updated_at
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
$$;

-- 2. Criacao (estado aberto). Marca o cookie vencido como descartado, se informado. Servico precisa estar ativo.
--    p_fields traz so as chaves presentes no corpo (JSON). Chave ausente nao muda; null limpa.
create or replace function private.draft_create(
  p_hash text,
  p_ip_hmac text,
  p_now timestamptz,
  p_ttl_days integer,
  p_expired_hash text,
  p_fields jsonb,
  p_live_cap integer)
returns table (
  out_id uuid, out_status text, out_service_id uuid, out_address_text text,
  out_urgency text, out_description text, out_expires_at timestamptz, out_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.request_draft;
  v_vivos bigint;
begin
  if p_hash is null or p_ip_hmac is null or p_now is null or p_ttl_days is null
     or p_ttl_days < 1 or p_ttl_days > 30 or p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  if p_live_cap is null or p_live_cap < 1 or p_live_cap > 1000000 then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  if p_expired_hash is not null then
    update app.request_draft r
       set status = 'descartado', updated_at = p_now
     where r.browser_nonce_hash = p_expired_hash
       and r.status in ('aberto', 'aguardando_email')
       and r.expires_at <= p_now;
  end if;

  if p_fields ? 'service_id' and p_fields->>'service_id' is not null then
    if not exists (
      select 1 from app.service s
       where s.id = (p_fields->>'service_id')::uuid and s.active
    ) then
      raise exception 'servico_invalido' using errcode = 'P0001';
    end if;
  end if;

  -- Teto global (A1): rascunhos vivos (prazo nao vencido) contados antes da insercao; ao atingir, recusa.
  select count(*) into v_vivos
    from app.request_draft r
   where r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now;
  if v_vivos >= p_live_cap then
    raise exception 'teto_global_rascunhos' using errcode = 'P0001';
  end if;

  insert into app.request_draft (
    browser_nonce_hash, ip_hmac, service_id, address_text, urgency, description,
    status, expires_at, created_at, updated_at)
  values (
    p_hash, p_ip_hmac,
    (p_fields->>'service_id')::uuid,
    p_fields->>'address_text',
    p_fields->>'urgency',
    p_fields->>'description',
    'aberto', p_now + make_interval(days => p_ttl_days), p_now, p_now)
  returning * into v_row;

  return query select v_row.id, v_row.status, v_row.service_id, v_row.address_text,
                      v_row.urgency, v_row.description, v_row.expires_at, v_row.updated_at;
end;
$$;

-- 3. Salvamento parcial do rascunho vivo. Renova o prazo, sem passar de 30 dias desde a criacao.
--    Zero linhas = nao existe (ou vencido, descartado ou publicado). Servico inativo: erro servico_invalido.
create or replace function private.draft_patch(
  p_hash text,
  p_now timestamptz,
  p_ttl_days integer,
  p_fields jsonb)
returns table (
  out_id uuid, out_status text, out_service_id uuid, out_address_text text,
  out_urgency text, out_description text, out_expires_at timestamptz, out_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.request_draft;
begin
  if p_hash is null or p_now is null or p_ttl_days is null
     or p_ttl_days < 1 or p_ttl_days > 30 or p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_row
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return;
  end if;

  if p_fields ? 'service_id' and p_fields->>'service_id' is not null then
    if not exists (
      select 1 from app.service s
       where s.id = (p_fields->>'service_id')::uuid and s.active
    ) then
      raise exception 'servico_invalido' using errcode = 'P0001';
    end if;
  end if;

  update app.request_draft r
     set service_id   = case when p_fields ? 'service_id' then (p_fields->>'service_id')::uuid else r.service_id end,
         address_text = case when p_fields ? 'address_text' then p_fields->>'address_text' else r.address_text end,
         urgency      = case when p_fields ? 'urgency' then p_fields->>'urgency' else r.urgency end,
         description  = case when p_fields ? 'description' then p_fields->>'description' else r.description end,
         updated_at   = p_now,
         expires_at   = least(p_now + make_interval(days => p_ttl_days), r.created_at + interval '30 days')
   where r.id = v_row.id
  returning * into v_row;

  return query select v_row.id, v_row.status, v_row.service_id, v_row.address_text,
                      v_row.urgency, v_row.description, v_row.expires_at, v_row.updated_at;
end;
$$;

-- 4. Descarte do rascunho vivo. Verdadeiro quando havia um; falso caso contrario (sem distinguir o motivo).
create or replace function private.draft_discard(p_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_hash is null or p_now is null then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  update app.request_draft r
     set status = 'descartado', updated_at = p_now
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now;

  return found;
end;
$$;

-- Privilegios: nenhuma funcao para PUBLIC, anon, authenticated ou service_role; execute so para app_api.
revoke all on function private.draft_get(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.draft_create(text, text, timestamptz, integer, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.draft_patch(text, timestamptz, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.draft_discard(text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function private.draft_get(text, timestamptz) to app_api;
grant execute on function private.draft_create(text, text, timestamptz, integer, text, jsonb, integer) to app_api;
grant execute on function private.draft_patch(text, timestamptz, integer, jsonb) to app_api;
grant execute on function private.draft_discard(text, timestamptz) to app_api;
