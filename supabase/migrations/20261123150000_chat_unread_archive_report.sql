-- Pacote E (2026-11-23): nao lidas (H-101), arquivar (H-069), denunciar e bloquear (H-071) e filtro de texto.
-- Tabelas novas fechadas (RLS forcada, sem politicas); tudo passa por funcoes security definer do papel
-- app_system, que conferem a participacao de quem chama. Mensagens seguem imutaveis.

-- 1. Tabelas.
-- Ultima leitura de cada participante (base das nao lidas).
create table if not exists app.conversation_read (
  conversation_id uuid not null references app.conversation (id) on delete restrict,
  user_id         uuid not null references app.app_user (id) on delete restrict,
  last_read_at    timestamptz not null,
  primary key (conversation_id, user_id)
);

-- Preferencia individual de arquivo: so afeta quem arquivou.
create table if not exists app.conversation_pref (
  conversation_id uuid not null references app.conversation (id) on delete restrict,
  user_id         uuid not null references app.app_user (id) on delete restrict,
  archived_at     timestamptz,
  primary key (conversation_id, user_id)
);

-- Bloqueio da conversa: vale para os dois lados (recusa novas mensagens; a leitura continua).
create table if not exists app.conversation_block (
  conversation_id    uuid primary key references app.conversation (id) on delete restrict,
  blocked_by_user_id uuid not null references app.app_user (id) on delete restrict,
  created_at         timestamptz not null
);

-- Denuncia com motivo de lista fechada e texto opcional de ate 500 caracteres. Abre caso (status aberto).
create table if not exists app.chat_report (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references app.conversation (id) on delete restrict,
  reporter_user_id uuid not null references app.app_user (id) on delete restrict,
  reported_user_id uuid not null references app.app_user (id) on delete restrict,
  reason           text not null check (reason in ('assedio', 'golpe', 'ofensa', 'spam', 'outro')),
  body_text        text check (body_text is null or char_length(body_text) between 1 and 500),
  status           text not null default 'aberto' check (status in ('aberto')),
  created_at       timestamptz not null
);

create index if not exists chat_report_conversa_idx on app.chat_report (conversation_id, created_at desc);

comment on table app.chat_report is
  'Denuncia de conversa (H-071). Motivo de lista fechada; texto opcional; abre caso para moderacao (H-090).';

-- 2. Seguranca: RLS forcada sem politica; leitura so por app_system; escrita so pelas funcoes.
alter table app.conversation_read enable row level security;
alter table app.conversation_read force row level security;
alter table app.conversation_pref enable row level security;
alter table app.conversation_pref force row level security;
alter table app.conversation_block enable row level security;
alter table app.conversation_block force row level security;
alter table app.chat_report enable row level security;
alter table app.chat_report force row level security;

revoke all on app.conversation_read, app.conversation_pref, app.conversation_block, app.chat_report
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant select on app.conversation_read, app.conversation_pref, app.conversation_block, app.chat_report to app_system;

-- 3. Auxiliares (sem grant direto: so chamadas pelas funcoes do mesmo dono).
-- Mensagens humanas do outro participante depois da ultima leitura.
create or replace function private.conversation_unread_for(p_conversation_id uuid, p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
    from app.message m
   where m.conversation_id = p_conversation_id
     and m.kind = 'humana'
     and m.sender_user_id <> p_user_id
     and m.created_at > coalesce(
       (select r.last_read_at from app.conversation_read r
         where r.conversation_id = p_conversation_id and r.user_id = p_user_id),
       '-infinity'::timestamptz)
$$;

-- Arquivada para o usuario: tem archived_at e nenhuma mensagem do outro participante depois dele.
create or replace function private.conversation_archived_for(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.conversation_pref pr
     where pr.conversation_id = p_conversation_id and pr.user_id = p_user_id and pr.archived_at is not null
  )
  and not exists (
    select 1
      from app.conversation_pref pr
      join app.message m on m.conversation_id = pr.conversation_id
     where pr.conversation_id = p_conversation_id and pr.user_id = p_user_id and pr.archived_at is not null
       and m.kind = 'humana' and m.sender_user_id <> p_user_id and m.created_at > pr.archived_at
  )
$$;

-- Participacao (cliente dono ou profissional da conversa).
create or replace function private.conversation_is_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.conversation c
     where c.id = p_conversation_id
       and (c.customer_user_id = p_user_id or c.professional_id = p_user_id)
  )
$$;

-- 4. Nao lidas (H-101): total das conversas na caixa do usuario (arquivadas sem retorno ficam fora).
create or replace function private.conversation_unread_total(p_user_id uuid)
returns table (out_total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(private.conversation_unread_for(c.id, p_user_id)), 0)::bigint
    from app.conversation c
   where (c.customer_user_id = p_user_id or c.professional_id = p_user_id)
     and not private.conversation_archived_for(c.id, p_user_id)
$$;

-- 5. Marca como lida (abrir a conversa). Nunca volta no tempo; cobre a mensagem mais recente da conversa.
create or replace function private.conversation_mark_read(p_conversation_id uuid, p_user_id uuid, p_now timestamptz)
returns table (out_outcome text, out_last_read_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_limite timestamptz;
begin
  if not private.conversation_is_member(p_conversation_id, p_user_id) then
    return query select 'nao_encontrada'::text, null::timestamptz;
    return;
  end if;
  select greatest(p_now, coalesce(max(m.created_at), p_now)) into v_limite
    from app.message m
   where m.conversation_id = p_conversation_id;
  insert into app.conversation_read (conversation_id, user_id, last_read_at)
  values (p_conversation_id, p_user_id, v_limite)
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(app.conversation_read.last_read_at, excluded.last_read_at);
  return query
    select 'marcada'::text, r.last_read_at
      from app.conversation_read r
     where r.conversation_id = p_conversation_id and r.user_id = p_user_id;
end
$$;

-- 6. Arquivar (H-069): preferencia individual. Arquivar de novo reabre a arquivada apos nova mensagem.
create or replace function private.conversation_archive(p_conversation_id uuid, p_user_id uuid, p_archive boolean,
  p_now timestamptz)
returns table (out_outcome text, out_archived boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
begin
  if not private.conversation_is_member(p_conversation_id, p_user_id) then
    return query select 'nao_encontrada'::text, false;
    return;
  end if;
  if p_archive then
    if private.conversation_archived_for(p_conversation_id, p_user_id) then
      return query select 'sem_mudanca'::text, true;
      return;
    end if;
    insert into app.conversation_pref (conversation_id, user_id, archived_at)
    values (p_conversation_id, p_user_id, p_now)
    on conflict (conversation_id, user_id) do update set archived_at = excluded.archived_at;
    return query select 'arquivada'::text, true;
    return;
  end if;
  if not private.conversation_archived_for(p_conversation_id, p_user_id) then
    return query select 'sem_mudanca'::text, false;
    return;
  end if;
  update app.conversation_pref set archived_at = null
   where conversation_id = p_conversation_id and user_id = p_user_id;
  return query select 'desarquivada'::text, false;
end
$$;

-- 7. Denunciar (H-071). Motivo de lista fechada; texto opcional (aparado; vazio vira nulo; ate 500).
create or replace function private.conversation_report(p_conversation_id uuid, p_user_id uuid, p_reason text,
  p_text text, p_now timestamptz)
returns table (out_outcome text, out_report_id uuid)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_conv app.conversation%rowtype;
  v_texto text := nullif(btrim(coalesce(p_text, '')), '');
  v_id uuid;
begin
  select * into v_conv from app.conversation c where c.id = p_conversation_id;
  if not found or (v_conv.customer_user_id <> p_user_id and v_conv.professional_id <> p_user_id) then
    return query select 'nao_encontrada'::text, null::uuid;
    return;
  end if;
  if p_reason is null or p_reason not in ('assedio', 'golpe', 'ofensa', 'spam', 'outro') then
    return query select 'motivo_invalido'::text, null::uuid;
    return;
  end if;
  if v_texto is not null and char_length(v_texto) > 500 then
    return query select 'texto_invalido'::text, null::uuid;
    return;
  end if;
  insert into app.chat_report (conversation_id, reporter_user_id, reported_user_id, reason, body_text, status, created_at)
  values (p_conversation_id, p_user_id,
          case when v_conv.customer_user_id = p_user_id then v_conv.professional_id else v_conv.customer_user_id end,
          p_reason, v_texto, 'aberto', p_now)
  returning id into v_id;
  return query select 'registrada'::text, v_id;
end
$$;

-- 8. Bloquear (H-071): idempotente; vale para os dois lados; a conversa continua legivel.
create or replace function private.conversation_block(p_conversation_id uuid, p_user_id uuid, p_now timestamptz)
returns table (out_outcome text, out_blocked_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_em timestamptz;
begin
  if not private.conversation_is_member(p_conversation_id, p_user_id) then
    return query select 'nao_encontrada'::text, null::timestamptz;
    return;
  end if;
  insert into app.conversation_block (conversation_id, blocked_by_user_id, created_at)
  values (p_conversation_id, p_user_id, p_now)
  on conflict (conversation_id) do nothing
  returning created_at into v_em;
  if found then
    return query select 'bloqueada'::text, v_em;
    return;
  end if;
  select b.created_at into v_em from app.conversation_block b where b.conversation_id = p_conversation_id;
  return query select 'sem_mudanca'::text, v_em;
end
$$;

-- 9. Lista de conversas: mesmas colunas de antes, mais out_unread_count, out_archived e out_blocked no fim.
drop function if exists private.conversation_list_for_user(uuid);
create function private.conversation_list_for_user(p_user_id uuid)
returns table (out_conversation_id uuid, out_request_id uuid, out_service_name text, out_papel text,
  out_other_name text, out_state text, out_request_status text, out_selected boolean,
  out_last_kind text, out_last_event text, out_last_body text, out_last_at timestamptz,
  out_unread_count bigint, out_archived boolean, out_blocked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, r.id, s.name,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         c.state, r.status, (r.selected_acceptance_id = c.acceptance_id),
         m.kind, m.system_event, m.body_text, m.created_at,
         private.conversation_unread_for(c.id, p_user_id),
         private.conversation_archived_for(c.id, p_user_id),
         exists (select 1 from app.conversation_block cb where cb.conversation_id = c.id)
    from app.conversation c
    join app.service_request r on r.id = c.request_id
    join app.service s on s.id = r.service_id
    left join app.professional_profile p on p.user_id = c.professional_id
    left join lateral (
      select mm.kind, mm.system_event, mm.body_text, mm.created_at
        from app.message mm
       where mm.conversation_id = c.id
       order by mm.created_at desc, mm.id desc
       limit 1
    ) m on true
   where c.customer_user_id = p_user_id or c.professional_id = p_user_id
   order by coalesce(m.created_at, c.created_at) desc
   limit 100
$$;

-- 10. Mensagens da conversa: mesmas colunas de antes, mais out_archived e out_blocked no fim.
drop function if exists private.conversation_messages_for_user(uuid, uuid);
create function private.conversation_messages_for_user(p_conversation_id uuid, p_user_id uuid)
returns table (out_message_id uuid, out_kind text, out_mine boolean, out_body text, out_event text,
  out_created_at timestamptz, out_state text, out_other_name text, out_service_name text, out_request_id uuid,
  out_papel text, out_archived boolean, out_blocked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.kind, (m.sender_user_id = p_user_id), m.body_text, m.system_event, m.created_at, c.state,
         case when c.customer_user_id = p_user_id then coalesce(p.public_name, 'Profissional') else r.first_name end,
         s.name, r.id,
         case when c.customer_user_id = p_user_id then 'cliente' else 'profissional' end,
         private.conversation_archived_for(c.id, p_user_id),
         exists (select 1 from app.conversation_block cb where cb.conversation_id = c.id)
    from app.conversation c
    join app.service_request r on r.id = c.request_id
    join app.service s on s.id = r.service_id
    left join app.professional_profile p on p.user_id = c.professional_id
    join app.message m on m.conversation_id = c.id
   where c.id = p_conversation_id
     and (c.customer_user_id = p_user_id or c.professional_id = p_user_id)
   order by m.created_at, m.id
   limit 500
$$;

-- 11. Envio (H-071 filtro de texto e bloqueio). Mesma assinatura e retorno da versao anterior.
create or replace function private.message_send(p_conversation_id uuid, p_user_id uuid, p_client_message_id uuid,
  p_body text, p_now timestamptz)
returns table (out_outcome text, out_message_id uuid, out_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_conv app.conversation%rowtype;
  v_texto text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_em timestamptz;
begin
  select * into v_conv from app.conversation c where c.id = p_conversation_id for share;
  if not found or (v_conv.customer_user_id <> p_user_id and v_conv.professional_id <> p_user_id) then
    return query select 'nao_encontrada'::text, null::uuid, null::timestamptz;
    return;
  end if;
  select m.id, m.created_at into v_id, v_em
    from app.message m
   where m.conversation_id = p_conversation_id and m.sender_user_id = p_user_id
     and m.client_message_id = p_client_message_id and m.kind = 'humana';
  if found then
    return query select 'repetida'::text, v_id, v_em;
    return;
  end if;
  if v_conv.state <> 'ativa' or v_conv.restricted_reason is not null then
    return query select 'somente_leitura'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- Pacote E: filtro e bloqueio
  if exists (select 1 from app.conversation_block cb where cb.conversation_id = p_conversation_id) then
    return query select 'conversa_bloqueada'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if char_length(v_texto) < 1 or char_length(v_texto) > 4000 then
    return query select 'texto_invalido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- E-mail e telefone brasileiro (DDD + 8 ou 9 digitos, com ou sem +55 e separadores) nao passam no chat.
  if v_texto ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
     or v_texto ~ '(^|\D)(\+?55[ .-]?)?\(?[0-9]{2}\)?[ .-]?9?[0-9]{4}[ .-]?[0-9]{4}(\D|$)' then
    return query select 'conteudo_nao_permitido'::text, null::uuid, null::timestamptz;
    return;
  end if;
  insert into app.message (conversation_id, kind, sender_user_id, client_message_id, body_text, state, created_at)
  values (p_conversation_id, 'humana', p_user_id, p_client_message_id, v_texto, 'enviada', p_now)
  returning id, created_at into v_id, v_em;
  return query select 'enviada'::text, v_id, v_em;
end
$$;

-- 12. Privilegios das funcoes novas e recriadas.
revoke all on function
  private.conversation_unread_for(uuid, uuid),
  private.conversation_archived_for(uuid, uuid),
  private.conversation_is_member(uuid, uuid),
  private.conversation_unread_total(uuid),
  private.conversation_mark_read(uuid, uuid, timestamptz),
  private.conversation_archive(uuid, uuid, boolean, timestamptz),
  private.conversation_report(uuid, uuid, text, text, timestamptz),
  private.conversation_block(uuid, uuid, timestamptz),
  private.conversation_list_for_user(uuid),
  private.conversation_messages_for_user(uuid, uuid),
  private.message_send(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.conversation_unread_total(uuid) to app_system;
grant execute on function private.conversation_mark_read(uuid, uuid, timestamptz) to app_system;
grant execute on function private.conversation_archive(uuid, uuid, boolean, timestamptz) to app_system;
grant execute on function private.conversation_report(uuid, uuid, text, text, timestamptz) to app_system;
grant execute on function private.conversation_block(uuid, uuid, timestamptz) to app_system;
grant execute on function private.conversation_list_for_user(uuid) to app_system;
grant execute on function private.conversation_messages_for_user(uuid, uuid) to app_system;
grant execute on function private.message_send(uuid, uuid, uuid, text, timestamptz) to app_system;
