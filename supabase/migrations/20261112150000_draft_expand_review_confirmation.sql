-- H-030 (Issue #43) | Revisao e confirmacao expressa do pedido (docs/factory/90-DESENHO-H030.md, §3).
-- Expansao pura: colunas novas em app.request_draft, restricoes, gatilho de conteudo e duas funcoes novas.
-- Idempotente. Desfazer: supabase/rollbacks/20261112150000_draft_expand_review_confirmation.down.sql.
-- Depende da migracao da #26 (20261112130000): usa first_name, email e email_verified_at.
-- Nada publica: status segue 'aberto'; nenhuma tabela de pedido e tocada; sem coordenada.
-- Posse: so o hash do cookie (browser_nonce_hash) abre as funcoes; execute so para app_api.

-- 1. Confirmacao e contador de versao do conteudo. Constante: a tabela nao e reescrita.
alter table app.request_draft
  add column if not exists confirmed_at timestamptz,
  add column if not exists content_rev integer not null default 0;

alter table app.request_draft drop constraint if exists request_draft_content_rev_nao_negativo;
alter table app.request_draft add constraint request_draft_content_rev_nao_negativo
  check (content_rev >= 0);

-- 2. So rascunho aberto ou publicado pode estar confirmado (CA-09). Linhas existentes: confirmed_at nulo.
alter table app.request_draft drop constraint if exists request_draft_confirmed_status_check;
alter table app.request_draft add constraint request_draft_confirmed_status_check
  check (confirmed_at is null or status in ('aberto', 'publicado'));

-- 3. Gatilho de conteudo (CA-06, CA-09). Qualquer mudanca em um campo do pedido soma 1 em content_rev e
--    zera a confirmacao, venha de onde vier. Salvar o mesmo valor nao conta. Gravar confirmed_at junto com
--    mudanca de conteudo na mesma instrucao e erro. Sem execute para nenhum papel (so o gatilho o chama).
create or replace function private.draft_confirmation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conteudo boolean;
begin
  v_conteudo :=
    (new.service_id, new.address_text, new.urgency, new.description, new.first_name, new.email, new.email_verified_at)
    is distinct from
    (old.service_id, old.address_text, old.urgency, old.description, old.first_name, old.email, old.email_verified_at);

  if old.confirmed_at is null and new.confirmed_at is not null and v_conteudo then
    raise exception 'confirmacao_com_conteudo_alterado' using errcode = '23514';
  end if;

  new.content_rev := old.content_rev + case when v_conteudo then 1 else 0 end;

  if new.confirmed_at is not distinct from old.confirmed_at
     and (v_conteudo or new.status not in ('aberto', 'publicado')) then
    new.confirmed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists request_draft_confirmation_guard on app.request_draft;
create trigger request_draft_confirmation_guard
  before update on app.request_draft
  for each row execute function private.draft_confirmation_guard();

-- 4a. Leitura da revisao (CA-01, CA-04, CA-05). Rascunho vivo do hash; zero linhas = nao existe.
--     O servico vem junto (nome e se esta ativo). A regra de campos faltando fica na API (draftMissingForReview).
create or replace function private.draft_review_get(p_hash text, p_now timestamptz)
returns table (
  out_id uuid, out_status text, out_service_id uuid, out_service_name text, out_service_active boolean,
  out_address_text text, out_urgency text, out_description text, out_first_name text, out_email text,
  out_email_verified boolean, out_confirmed_at timestamptz, out_content_rev integer, out_expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.status, r.service_id, s.name, coalesce(s.active, false),
         r.address_text, r.urgency, r.description, r.first_name, r.email,
         (r.email_verified_at is not null), r.confirmed_at, r.content_rev, r.expires_at
    from app.request_draft r
    left join app.service s on s.id = r.service_id
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
$$;

-- 4b. Confirmacao expressa (CA-06, CA-07, CA-08). Trava a linha; ordem fixa de recusas (90 §2.2):
--     nao_encontrado -> campos_faltando (ordem de DRAFT_REVIEW_FIELDS) -> email_nao_confirmado ->
--     conteudo_alterado -> ok. Ja confirmado na mesma versao: ok com o mesmo confirmed_at, sem update.
--     Nao grava status, pedido, prazo de aceite nem nada de publicacao.
create or replace function private.draft_confirm(
  p_hash text,
  p_now timestamptz,
  p_content_rev integer,
  p_ttl_days integer)
returns table (out_result text, out_confirmed_at timestamptz, out_content_rev integer, out_missing text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r app.request_draft%rowtype;
  v_ativo boolean;
  v_faltam text[] := array[]::text[];
begin
  if p_hash is null or p_now is null or p_content_rev is null or p_content_rev < 0
     or p_ttl_days is null or p_ttl_days < 1 then
    raise exception 'draft_entrada_invalida' using errcode = '22023';
  end if;

  select * into v_r
    from app.request_draft r
   where r.browser_nonce_hash = p_hash
     and r.status in ('aberto', 'aguardando_email')
     and r.expires_at > p_now
   for update;
  if not found then
    return query select 'nao_encontrado'::text, null::timestamptz, null::integer, null::text[];
    return;
  end if;

  select s.active into v_ativo from app.service s where s.id = v_r.service_id;
  if v_r.service_id is null or coalesce(v_ativo, false) = false then
    v_faltam := array_append(v_faltam, 'service_id');
  end if;
  if v_r.address_text is null or v_r.address_text ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'address_text');
  end if;
  if v_r.urgency is null then
    v_faltam := array_append(v_faltam, 'urgency');
  end if;
  if v_r.description is null or v_r.description ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'description');
  end if;
  if v_r.first_name is null or v_r.first_name ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'first_name');
  end if;
  if v_r.email is null or v_r.email ~ '^\s*$' then
    v_faltam := array_append(v_faltam, 'email');
  end if;
  if cardinality(v_faltam) > 0 then
    return query select 'campos_faltando'::text, null::timestamptz, null::integer, v_faltam;
    return;
  end if;

  if v_r.status <> 'aberto' or v_r.email_verified_at is null then
    return query select 'email_nao_confirmado'::text, null::timestamptz, null::integer, null::text[];
    return;
  end if;

  if p_content_rev <> v_r.content_rev then
    return query select 'conteudo_alterado'::text, null::timestamptz, null::integer, null::text[];
    return;
  end if;

  if v_r.confirmed_at is not null then
    return query select 'ok'::text, v_r.confirmed_at, v_r.content_rev, null::text[];
    return;
  end if;

  update app.request_draft r
     set confirmed_at = p_now,
         expires_at = least(p_now + make_interval(days => p_ttl_days), r.created_at + interval '30 days'),
         updated_at = p_now
   where r.id = v_r.id;

  return query select 'ok'::text, p_now, v_r.content_rev, null::text[];
end
$$;

-- 5. Privilegios: funcoes so para app_api; o gatilho nao tem execute para ninguem.
revoke all on function
  private.draft_review_get(text, timestamptz),
  private.draft_confirm(text, timestamptz, integer, integer),
  private.draft_confirmation_guard()
  from public, anon, authenticated, service_role, app_system;

grant execute on function
  private.draft_review_get(text, timestamptz),
  private.draft_confirm(text, timestamptz, integer, integer)
  to app_api;
