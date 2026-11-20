-- H-058 (Issue #71) | Aceite idempotente: nascimento minimo das tabelas de aceite e de chat
-- (docs/factory/162-DESENHO-H058.md, §4.1 a §4.3, decisao A-1). Fatia 2.
-- Cria app.acceptance, app.conversation e app.message com constraints, indices, gatilhos de defesa em
-- profundidade, RLS habilitada e forcada SEM politicas e privilegios somente para app_system.
-- Idempotente (if not exists / create or replace / drop trigger if exists).
-- Desfazer: supabase/rollbacks/20261120100000_distribution_create_acceptance_and_chat_base.down.sql.
-- Nao cria a funcao de aceite (fatia 3, 20261120110000). Regras de negocio ficam na funcao; os gatilhos
-- aqui so recusam o que nunca pode ser gravado (defesa em profundidade, desenho §4.1).

-- 0. Pre-requisitos: falha com mensagem clara se a base nao estiver aplicada.
do $$
begin
  if to_regprocedure('private.professional_access_guard(uuid,text,timestamptz)') is null
     or to_regprocedure('private.identity_id_from_document_hmac(text)') is null
     or to_regprocedure('private.acceptance_not_own_request()') is null
     or to_regclass('ops.outbox_event') is null
     or to_regclass('app.service_request') is null
     or to_regclass('app.professional_profile') is null then
    raise exception 'h058_pre_requisito_ausente' using errcode = '42P01';
  end if;
end
$$;

-- 1. app.acceptance (§4.1). Uma linha por aceite; vaga (slot_no) e unica no pedido; sem texto, valor, prazo
--    ou anexo (I-26). professional_id e o user_id do perfil profissional (mesma chave de #55/#68 e do gatilho
--    private.acceptance_not_own_request, que compara com app.service_request.customer_user_id).
create table if not exists app.acceptance (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references app.service_request (id) on delete restrict,
  professional_id uuid not null references app.professional_profile (user_id) on delete restrict,
  identity_id     uuid not null,
  slot_no         smallint not null check (slot_no between 1 and 8),
  wave            smallint generated always as (((slot_no - 1) / 4) + 1) stored,
  status          text not null default 'ativo'
                    check (status in ('ativo', 'retirado', 'removido_por_seguranca')),
  accepted_at     timestamptz not null,
  withdrawn_at    timestamptz,
  -- Codigo curto da remocao (ex.: 'risco_fraude'), nunca texto livre.
  removed_reason  text check (removed_reason is null or removed_reason ~ '^[a-z][a-z_]{0,39}$'),
  created_at      timestamptz not null default now(),
  constraint acceptance_retirada_consistente check ((status = 'retirado') = (withdrawn_at is not null)),
  constraint acceptance_pedido_profissional_key unique (request_id, professional_id),
  constraint acceptance_pedido_identidade_key unique (request_id, identity_id),
  constraint acceptance_pedido_vaga_key unique (request_id, slot_no)
);

create index if not exists acceptance_profissional_status_idx
  on app.acceptance (professional_id, status);

comment on table app.acceptance is
  'Aceite de pedido por profissional (H-058, 162-DESENHO §4.1). Vaga unica por pedido; retirada nao libera vaga. Sem texto livre.';

-- 2. app.conversation (§4.2). Nasce ativa, uma por aceite. Estado de leitura e recalculo sao H-065/H-061.
create table if not exists app.conversation (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references app.service_request (id) on delete restrict,
  customer_user_id    uuid not null references app.app_user (id) on delete restrict,
  professional_id     uuid not null references app.professional_profile (user_id) on delete restrict,
  acceptance_id       uuid not null unique references app.acceptance (id) on delete restrict,
  state               text not null default 'ativa' check (state in ('ativa', 'somente_leitura')),
  security_restricted_at timestamptz,
  restricted_reason   text check (restricted_reason is null or restricted_reason ~ '^[a-z][a-z_]{0,39}$'),
  created_at          timestamptz not null default now(),
  constraint conversation_pedido_profissional_key unique (request_id, professional_id)
);

comment on table app.conversation is
  'Conversa individual cliente-profissional criada no aceite (H-058, 162-DESENHO §4.2). Identidade do pedido imutavel.';

-- 3. app.message (§4.3). Nesta historia so nascem mensagens de sistema; envio humano e a #77.
create table if not exists app.message (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references app.conversation (id) on delete restrict,
  kind              text not null check (kind in ('humana', 'sistema')),
  sender_user_id    uuid references app.app_user (id) on delete restrict,
  client_message_id uuid,
  system_event      text check (system_event is null or system_event in ('aceite', 'aceite_retirado')),
  params            jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 512),
  template_version  smallint check (template_version is null or template_version >= 1),
  dedupe_key        text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  body_text         text check (body_text is null or char_length(body_text) between 1 and 4000),
  state             text not null default 'enviada' check (state in ('enviada', 'restrita')),
  created_at        timestamptz not null default now(),
  constraint message_sistema_forma check (
    kind <> 'sistema'
    or (sender_user_id is null and system_event is not null and body_text is null
        and dedupe_key is not null and template_version is not null)
  ),
  constraint message_humana_forma check (
    kind <> 'humana' or (sender_user_id is not null and system_event is null)
  )
);

create unique index if not exists message_sistema_dedupe_key
  on app.message (conversation_id, dedupe_key) where kind = 'sistema';
create unique index if not exists message_humana_cliente_key
  on app.message (conversation_id, sender_user_id, client_message_id) where kind = 'humana';

comment on table app.message is
  'Mensagens da conversa (H-058, 162-DESENHO §4.3). Sistema sem remetente e sem texto gravado (modelo versionado). Imutavel.';

-- 4. Funcoes de gatilho (security definer, search_path vazio, nomes qualificados).
-- 4.1 Aceite: insercao so no estado correto (defesa em profundidade; a funcao de aceite ja valida).
create or replace function private.acceptance_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status     text;
  v_prazo      timestamptz;
  v_contagem   integer;
  v_onda2      timestamptz;
  v_capacidade integer;
begin
  select s.status, s.acceptance_deadline_at, s.acceptances_count, s.wave2_opened_at
    into v_status, v_prazo, v_contagem, v_onda2
    from app.service_request s
   where s.id = new.request_id
     for update;
  if not found then
    raise exception 'aceite_pedido_inexistente' using errcode = '23514';
  end if;
  if new.status <> 'ativo' or new.withdrawn_at is not null then
    raise exception 'aceite_inicia_ativo' using errcode = '23514';
  end if;
  if v_status <> 'publicado' or new.accepted_at >= v_prazo then
    raise exception 'aceite_fora_do_prazo' using errcode = '23514';
  end if;
  if new.slot_no <> v_contagem + 1 then
    raise exception 'aceite_vaga_incorreta' using errcode = '23514';
  end if;
  v_capacidade := case when v_onda2 is null then 4 else 8 end;
  if new.slot_no > v_capacidade then
    raise exception 'aceite_sem_vaga' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 4.2 Aceite: identidade e vaga imutaveis; status so vai de ativo para retirado ou removido (H-061).
create or replace function private.acceptance_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_id is distinct from old.request_id
     or new.professional_id is distinct from old.professional_id
     or new.identity_id is distinct from old.identity_id
     or new.slot_no is distinct from old.slot_no
     or new.accepted_at is distinct from old.accepted_at then
    raise exception 'aceite_campo_imutavel' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'ativo' and new.status in ('retirado', 'removido_por_seguranca')) then
    raise exception 'aceite_transicao_invalida' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 4.3 Negacao de remocao (aceite e conversa): a vaga nunca e liberada e a conversa nao some.
create or replace function private.chat_nega_remocao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'registro_nao_removivel' using errcode = '23514';
end
$$;

-- 4.4 Conversa: nasce ativa, aponta para aceite ativo do mesmo pedido e profissional; chaves imutaveis.
create or replace function private.conversation_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request      uuid;
  v_professional uuid;
  v_status       text;
  v_customer     uuid;
begin
  select a.request_id, a.professional_id, a.status, s.customer_user_id
    into v_request, v_professional, v_status, v_customer
    from app.acceptance a
    join app.service_request s on s.id = a.request_id
   where a.id = new.acceptance_id;
  if not found then
    raise exception 'conversa_aceite_inexistente' using errcode = '23514';
  end if;
  if new.state <> 'ativa' or v_status <> 'ativo' then
    raise exception 'conversa_inicia_ativa' using errcode = '23514';
  end if;
  if new.request_id is distinct from v_request
     or new.professional_id is distinct from v_professional
     or new.customer_user_id is distinct from v_customer then
    raise exception 'conversa_chave_inconsistente' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function private.conversation_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_id is distinct from old.request_id
     or new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id is distinct from old.professional_id
     or new.acceptance_id is distinct from old.acceptance_id then
    raise exception 'conversa_campo_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 4.5 Mensagem: nesta historia nao ha insercao humana (a #77 abre); sistema so com conversa existente (FK).
create or replace function private.message_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'humana' then
    raise exception 'mensagem_humana_indisponivel' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 4.6 Mensagem: imutavel para todos os papeis, inclusive o de sistema (RF-103).
create or replace function private.message_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'mensagem_imutavel' using errcode = '23514';
end
$$;

revoke all on function
  private.acceptance_guard_insert(),
  private.acceptance_guard_update(),
  private.chat_nega_remocao(),
  private.conversation_guard_insert(),
  private.conversation_guard_update(),
  private.message_guard_insert(),
  private.message_imutavel()
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

-- 5. Gatilhos (drop if exists + create: idempotente).
drop trigger if exists acceptance_guard_insert on app.acceptance;
create trigger acceptance_guard_insert
  before insert on app.acceptance
  for each row execute function private.acceptance_guard_insert();

drop trigger if exists acceptance_nao_proprio_pedido on app.acceptance;
create trigger acceptance_nao_proprio_pedido
  before insert on app.acceptance
  for each row execute function private.acceptance_not_own_request('app.service_request');

drop trigger if exists acceptance_guard_update on app.acceptance;
create trigger acceptance_guard_update
  before update on app.acceptance
  for each row execute function private.acceptance_guard_update();

drop trigger if exists acceptance_nega_delete on app.acceptance;
create trigger acceptance_nega_delete
  before delete on app.acceptance
  for each row execute function private.chat_nega_remocao();

drop trigger if exists conversation_guard_insert on app.conversation;
create trigger conversation_guard_insert
  before insert on app.conversation
  for each row execute function private.conversation_guard_insert();

drop trigger if exists conversation_guard_update on app.conversation;
create trigger conversation_guard_update
  before update on app.conversation
  for each row execute function private.conversation_guard_update();

drop trigger if exists conversation_nega_delete on app.conversation;
create trigger conversation_nega_delete
  before delete on app.conversation
  for each row execute function private.chat_nega_remocao();

drop trigger if exists message_guard_insert on app.message;
create trigger message_guard_insert
  before insert on app.message
  for each row execute function private.message_guard_insert();

drop trigger if exists message_imutavel_update on app.message;
create trigger message_imutavel_update
  before update on app.message
  for each row execute function private.message_imutavel();

drop trigger if exists message_imutavel_delete on app.message;
create trigger message_imutavel_delete
  before delete on app.message
  for each row execute function private.message_imutavel();

-- 6. RLS habilitada e forcada, sem politicas (nega tudo a quem nao ignora RLS). Privilegios so para app_system.
alter table app.acceptance enable row level security;
alter table app.acceptance force row level security;
alter table app.conversation enable row level security;
alter table app.conversation force row level security;
alter table app.message enable row level security;
alter table app.message force row level security;

revoke all on app.acceptance, app.conversation, app.message
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant select on app.acceptance, app.conversation, app.message to app_system;
