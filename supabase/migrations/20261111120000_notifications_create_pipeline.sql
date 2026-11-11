-- H-092 | Pipeline de notificacoes e cooldown (desenho docs/factory/35-DESENHO-H092.md, secoes 3 a 7).
-- Idempotente. Desfazer: supabase/rollbacks/20261111120000_notifications_create_pipeline.down.sql.
-- Fontes: 09 §3.11 (email_outbox, external_quota); 08 §7.6 e §12; 10 ADR-011 e ADR-022.
-- Nada aqui guarda endereco de e-mail, texto de mensagem ou credencial: so ids, enums e contagens.
-- Sem FK para app.app_user (o esquema ainda nao existe; a FK entra na historia dele).
--
-- Postura (igual H-005): RLS habilitada e forcada, sem politicas, nenhum privilegio para
-- PUBLIC/anon/authenticated/service_role. Somente app_system recebe privilegios minimos.
-- Os valores de cota do provedor (100/dia e 3.000/mes, S-11) ficam aqui como fato do servico;
-- os cortes por classe ficam numa constante unica em packages/domain (ajustavel sem migracao).
-- Tempo: relogio do banco (clock_timestamp), com p_now opcional para os testes (35 DD-4).

-- 1. ops.email_outbox (09 §3.11, com ajustes da 35 §3.3) ------------------------------------------
-- Uma linha = um e-mail a enviar. Nunca carrega endereco: o destinatario e resolvido no envio.
create table if not exists ops.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  recipient_user_id   uuid not null,
  category            text not null check (category in ('aceite','mensagem','selecao','cancelamento',
                                                       'desistencia','verificacao','prazo','acesso')),
  class               text not null check (class in ('auth','critico','digest','lembrete')),
  email_type          text not null check (email_type ~ '^[a-z][a-z0-9_]{0,59}$'),
  template            text not null check (template ~ '^[a-z][a-z0-9_]{0,59}$'),
  template_params     jsonb not null default '{}'::jsonb check (jsonb_typeof(template_params) = 'object'),
  dedupe_key          text not null unique check (length(dedupe_key) between 1 and 200),
  provider            text check (length(provider) between 1 and 40),
  state               text not null default 'pendente'
                        check (state in ('pendente','enviando','enviado','falha','suprimido',
                                         'adiado_cota','descartado')),
  attempts            integer not null default 0 check (attempts >= 0),
  schedule_seq        integer not null default 0 check (schedule_seq >= 0),
  next_attempt_at     timestamptz not null default clock_timestamp(),
  lease_until         timestamptz,
  quota_reserved      boolean not null default false,
  quota_reserved_at   timestamptz,
  provider_message_id text check (length(provider_message_id) between 1 and 200),
  bounce_state        text check (length(bounce_state) between 1 and 40),
  reason_code         text check (reason_code ~ '^[a-z][a-z0-9_]{0,59}$'),
  created_at          timestamptz not null default clock_timestamp(),
  sent_at             timestamptz,
  constraint email_outbox_lease_consistente check ((state = 'enviando') = (lease_until is not null)),
  constraint email_outbox_cota_consistente check (quota_reserved = (quota_reserved_at is not null))
);
create index if not exists email_outbox_fila_idx on ops.email_outbox (state, next_attempt_at)
  where state in ('pendente', 'adiado_cota', 'enviando');
create index if not exists email_outbox_destinatario_idx on ops.email_outbox (recipient_user_id, created_at);
comment on table ops.email_outbox is
  'Saida de e-mail (H-092, 09 §3.11). Sem endereco. Estado descartado = itens ficaram obsoletos ou lidos.';

-- 2. ops.notification_item (35 §3.1) ---------------------------------------------------------------
-- Um item por destinatario, categoria e evento. Sem texto e sem endereco. 'enviado' = coberto por
-- uma linha de ops.email_outbox; a entrega real e do estado da linha.
create table if not exists ops.notification_item (
  id                 uuid primary key default gen_random_uuid(),
  recipient_user_id  uuid not null,
  category           text not null check (category in ('aceite','mensagem','selecao','cancelamento',
                                                      'desistencia','verificacao','prazo','acesso')),
  scope_key          text not null check (length(scope_key) between 1 and 80),
  source_event_id    uuid not null,
  occurred_at        timestamptz not null,
  email_type         text not null check (email_type ~ '^[a-z][a-z0-9_]{0,59}$'),
  class              text not null check (class in ('auth','critico','digest','lembrete')),
  state              text not null default 'pendente' check (state in ('pendente','enviado','descartado')),
  outbox_id          uuid references ops.email_outbox (id),
  discard_reason     text check (discard_reason in ('lido','obsoleto','destinatario_invalido','expirado')),
  created_at         timestamptz not null default clock_timestamp(),
  decided_at         timestamptz,
  constraint notification_item_unico unique (source_event_id, recipient_user_id, category, scope_key),
  constraint notification_item_descarte_consistente
    check ((state = 'descartado') = (discard_reason is not null)),
  constraint notification_item_envio_consistente check ((state = 'enviado') = (outbox_id is not null))
);
create index if not exists notification_item_pendente_idx
  on ops.notification_item (recipient_user_id, category, scope_key) where state = 'pendente';
create index if not exists notification_item_outbox_idx
  on ops.notification_item (outbox_id) where outbox_id is not null;
comment on table ops.notification_item is
  'Item de notificacao (H-092, 35 §3.1). Sem endereco e sem texto: so ids, enums e contagens.';

-- 3. ops.notification_cooldown (35 §3.2) -----------------------------------------------------------
-- Uma linha por (destinatario, categoria digest, escopo). Trava de serializacao do agrupamento.
create table if not exists ops.notification_cooldown (
  recipient_user_id  uuid not null,
  category           text not null check (category in ('aceite','mensagem')),
  scope_key          text not null check (length(scope_key) between 1 and 80),
  cooldown_until     timestamptz not null,
  flush_job_id       uuid,
  updated_at         timestamptz not null default clock_timestamp(),
  constraint notification_cooldown_pkey primary key (recipient_user_id, category, scope_key)
);
comment on table ops.notification_cooldown is
  'Janela de agrupamento (H-092, 35 §3.2). Somente categorias digest (aceite e mensagem).';

-- 4. ops.external_quota (09 §3.11, linhas do servico email; 35 §3.4) -------------------------------
-- used conta 1 por destinatario (nunca CC/BCC). Limites do provedor (S-11): dia 100, mes 3000.
create table if not exists ops.external_quota (
  service        text not null check (service ~ '^[a-z][a-z0-9_]{0,39}$'),
  period         text not null check (period in ('dia_utc', 'mes')),
  period_start   date not null,
  used           integer not null default 0 check (used >= 0),
  soft_limit     integer not null check (soft_limit >= 0),
  hard_limit     integer not null check (hard_limit >= 1),
  reserved_auth  integer not null default 0 check (reserved_auth >= 0),
  breaker_state  text not null default 'fechado' check (breaker_state in ('fechado','aberto','meio_aberto')),
  alert_level    smallint not null default 0 check (alert_level between 0 and 3),
  alerted_at     timestamptz,
  constraint external_quota_pkey primary key (service, period, period_start),
  constraint external_quota_teto check (used <= hard_limit)
);
comment on table ops.external_quota is
  'Contador de cota externa (H-092, 09 §3.11). Linhas do servico email: dia_utc e mes.';

-- 5. Postura de seguranca: RLS habilitada e forcada, sem politicas -----------------------------------
alter table ops.email_outbox          enable row level security;
alter table ops.email_outbox          force row level security;
alter table ops.notification_item     enable row level security;
alter table ops.notification_item     force row level security;
alter table ops.notification_cooldown enable row level security;
alter table ops.notification_cooldown force row level security;
alter table ops.external_quota        enable row level security;
alter table ops.external_quota        force row level security;

revoke all on ops.email_outbox, ops.notification_item, ops.notification_cooldown, ops.external_quota
  from public, anon, authenticated, service_role;

-- 6. Chave de instante (microssegundos): usada em dedupe_key de job e de e-mail ----------------------
-- Precisao de microssegundo evita colisao de chave com um job do mesmo segundo ja concluido.
create or replace function private.notification_epoch_us(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select ((extract(epoch from p_ts) * 1000000)::bigint)::text
$$;

-- 7. Despacho: gatilho de insercao no outbox_event (35 §3.5) ---------------------------------------
-- SECURITY DEFINER: quem insere o evento (ex.: app_api) nao tem privilegio em ops.job. Chave por
-- instante: um job ja concluido nao impede o despacho de um evento novo (desvio do 35 §3.5, anotado).
create or replace function private.outbox_event_enfileira_despacho()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.job_enqueue(
    'outbox.dispatch',
    'outbox.dispatch:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
    clock_timestamp(), null, 5);
  return null;
end
$$;

drop trigger if exists outbox_event_enfileira_despacho on ops.outbox_event;
create trigger outbox_event_enfileira_despacho
  after insert on ops.outbox_event
  for each row execute function private.outbox_event_enfileira_despacho();

-- 8. Funcoes de e-mail: fila, cota e alertas ------------------------------------------------------

-- 8.1 Enfileira o job de envio de uma linha do outbox (payload_ref = id; sem endereco).
create or replace function private.email_outbox_enfileirar_envio(p_outbox_id uuid, p_run_at timestamptz)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  return private.job_enqueue(
    'email.send',
    'email.send:' || p_outbox_id::text || ':' || private.notification_epoch_us(p_run_at),
    p_run_at, p_outbox_id::text, 5);
end
$$;

-- 8.2 Insere a linha do e-mail; se a chave ja existe, devolve a linha existente (sem novo job).
create or replace function private.email_outbox_inserir(
  p_recipient_user_id uuid,
  p_category text,
  p_classe text,
  p_email_type text,
  p_template text,
  p_template_params jsonb,
  p_dedupe_key text,
  p_now timestamptz
)
returns table (out_outbox_id uuid, out_inserido boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into ops.email_outbox (recipient_user_id, category, class, email_type, template,
                                template_params, dedupe_key, next_attempt_at, created_at)
  values (p_recipient_user_id, p_category, p_classe, p_email_type, p_template,
          coalesce(p_template_params, '{}'::jsonb), p_dedupe_key, p_now, p_now)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null then
    perform private.email_outbox_enfileirar_envio(v_id, p_now);
    out_outbox_id := v_id;
    out_inserido := true;
    return next;
    return;
  end if;

  select o.id into v_id from ops.email_outbox o where o.dedupe_key = p_dedupe_key;
  out_outbox_id := v_id;
  out_inserido := false;
  return next;
end
$$;

-- 8.3 Agenda (ou reaproveita) o job de flush do agrupamento; grava o id no cooldown.
create or replace function private.notification_flush_agendar(
  p_recipient_user_id uuid,
  p_category text,
  p_scope_key text,
  p_run_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job uuid;
begin
  v_job := private.job_enqueue(
    'notification.flush',
    'nflush:' || p_recipient_user_id::text || ':' || p_category || ':' || p_scope_key || ':'
      || private.notification_epoch_us(p_run_at),
    p_run_at,
    p_recipient_user_id::text || '|' || p_category || '|' || p_scope_key,
    5);
  update ops.notification_cooldown c
     set flush_job_id = v_job, updated_at = clock_timestamp()
   where c.recipient_user_id = p_recipient_user_id and c.category = p_category
     and c.scope_key = p_scope_key;
  return v_job;
end
$$;

-- 8.4 Reserva de cota para uma linha do outbox (35 §7). Ordem de bloqueio: linha, dia, mes.
-- Cortes por classe vem de quem chama (constante em packages/domain). Idempotente: se a linha ja
-- tem cota reservada, nao reserva de novo (contagem conservadora, 35 §5.4 passo 7).
create or replace function private.email_outbox_reservar_cota(
  p_outbox_id uuid,
  p_corte_dia integer,
  p_corte_mes integer,
  p_now timestamptz default null
)
returns table (
  out_permitido boolean,
  out_bloqueado_por text,
  out_usado_dia integer,
  out_usado_mes integer,
  out_proxima_tentativa timestamptz,
  out_reservado boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_dia date := (v_now at time zone 'UTC')::date;
  v_mes date := date_trunc('month', v_now at time zone 'UTC')::date;
  v_ja_reservado boolean;
  v_bloqueio text;
  v_usado_dia integer;
  v_usado_mes integer;
begin
  if p_corte_dia is null or p_corte_dia not between 1 and 100
     or p_corte_mes is null or p_corte_mes not between 1 and 3000 then
    raise exception 'cortes de cota fora da faixa' using errcode = '22023';
  end if;

  perform 1 from ops.email_outbox o where o.id = p_outbox_id for update;
  if not found then
    return;
  end if;
  select o.quota_reserved into v_ja_reservado from ops.email_outbox o where o.id = p_outbox_id;

  insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth)
  values ('email', 'dia_utc', v_dia, 0, 90, 100, 10)
  on conflict do nothing;
  insert into ops.external_quota (service, period, period_start, used, soft_limit, hard_limit, reserved_auth)
  values ('email', 'mes', v_mes, 0, 2700, 3000, 300)
  on conflict do nothing;

  select q.used into v_usado_dia from ops.external_quota q
   where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia for update;
  select q.used into v_usado_mes from ops.external_quota q
   where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes for update;

  if v_ja_reservado then
    out_permitido := true;
    out_bloqueado_por := null;
    out_usado_dia := v_usado_dia;
    out_usado_mes := v_usado_mes;
    out_proxima_tentativa := null;
    out_reservado := true;
    return next;
    return;
  end if;

  if v_usado_mes >= p_corte_mes then
    v_bloqueio := 'mes';
  elsif v_usado_dia >= p_corte_dia then
    v_bloqueio := 'dia';
  else
    v_bloqueio := null;
  end if;

  if v_bloqueio is null then
    update ops.external_quota q set used = q.used + 1
     where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia
    returning q.used into v_usado_dia;
    update ops.external_quota q set used = q.used + 1
     where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes
    returning q.used into v_usado_mes;
    update ops.email_outbox o set quota_reserved = true, quota_reserved_at = v_now
     where o.id = p_outbox_id;
    out_permitido := true;
    out_bloqueado_por := null;
    out_proxima_tentativa := null;
    out_reservado := true;
  else
    out_permitido := false;
    out_bloqueado_por := v_bloqueio;
    out_proxima_tentativa := case
      when v_bloqueio = 'mes' then ((v_mes + interval '1 month')::timestamp at time zone 'UTC')
      else ((v_dia + 1)::timestamp at time zone 'UTC')
    end;
    out_reservado := false;
  end if;
  out_usado_dia := v_usado_dia;
  out_usado_mes := v_usado_mes;
  return next;
end
$$;

-- 8.5 Devolve uma reserva (o envio nao foi aceito). Decrementa so se o contador for > 0.
create or replace function private.email_quota_release(p_reservado_em timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_dia date := (p_reservado_em at time zone 'UTC')::date;
  v_mes date := date_trunc('month', p_reservado_em at time zone 'UTC')::date;
begin
  update ops.external_quota q set used = q.used - 1
   where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia and q.used > 0;
  update ops.external_quota q set used = q.used - 1
   where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes and q.used > 0;
end
$$;

-- 8.6 Registra nivel de alerta (0 a 3) dos contadores do dia e do mes (35 §7, painel em H-094).
create or replace function private.email_quota_registrar_alerta(
  p_nivel_dia smallint,
  p_nivel_mes smallint,
  p_now timestamptz default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_dia date := (v_now at time zone 'UTC')::date;
  v_mes date := date_trunc('month', v_now at time zone 'UTC')::date;
begin
  update ops.external_quota q
     set alert_level = greatest(q.alert_level, p_nivel_dia),
         alerted_at = case when p_nivel_dia > q.alert_level then v_now else q.alerted_at end
   where q.service = 'email' and q.period = 'dia_utc' and q.period_start = v_dia;
  update ops.external_quota q
     set alert_level = greatest(q.alert_level, p_nivel_mes),
         alerted_at = case when p_nivel_mes > q.alert_level then v_now else q.alerted_at end
   where q.service = 'email' and q.period = 'mes' and q.period_start = v_mes;
end
$$;

-- 9. Ingestao: evento -> item -> (linha de envio ou agrupamento) -------------------------------------
-- Classe nao digest: cria a linha de envio na hora (sem cooldown). Classe digest: cooldown por
-- (destinatario, categoria, escopo); envio imediato se a janela esta livre e nao ha pendente,
-- senao o item fica pendente e ha no maximo um job de flush por janela.
-- Ordem de bloqueio: item (unicidade), cooldown, depois job. Resultados:
--   duplicado | enfileirado | reaproveitado | enviado_agora | pendente
create or replace function private.notification_ingest(
  p_recipient_user_id uuid,
  p_category text,
  p_scope_key text,
  p_source_event_id uuid,
  p_occurred_at timestamptz,
  p_email_type text,
  p_class text,
  p_template_params jsonb,
  p_dedupe_key text,
  p_window_seconds integer,
  p_now timestamptz default null
)
returns table (out_resultado text, out_item_id uuid, out_outbox_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_item_id uuid;
  v_ate timestamptz;
  v_outras integer;
  v_outbox uuid;
  v_inserido boolean;
begin
  if p_class not in ('auth', 'critico', 'digest', 'lembrete') then
    raise exception 'classe de e-mail invalida' using errcode = '22023';
  end if;
  if p_class = 'digest' and (p_category not in ('aceite', 'mensagem')
     or p_window_seconds is null or p_window_seconds not between 60 and 3600) then
    raise exception 'digest exige categoria aceite ou mensagem e janela de 60 a 3600 s'
      using errcode = '22023';
  end if;
  if p_class <> 'digest' and (p_dedupe_key is null or length(p_dedupe_key) = 0) then
    raise exception 'chave de deduplicacao obrigatoria fora do digest' using errcode = '22023';
  end if;

  insert into ops.notification_item (recipient_user_id, category, scope_key, source_event_id,
                                     occurred_at, email_type, class)
  values (p_recipient_user_id, p_category, p_scope_key, p_source_event_id, p_occurred_at,
          p_email_type, p_class)
  on conflict (source_event_id, recipient_user_id, category, scope_key) do nothing
  returning id into v_item_id;
  if v_item_id is null then
    out_resultado := 'duplicado';
    out_item_id := null;
    out_outbox_id := null;
    return next;
    return;
  end if;

  if p_class <> 'digest' then
    select e.out_outbox_id, e.out_inserido into v_outbox, v_inserido
      from private.email_outbox_inserir(p_recipient_user_id, p_category, p_class, p_email_type,
                                        p_email_type, p_template_params, p_dedupe_key, v_now) e;
    update ops.notification_item i
       set state = 'enviado', outbox_id = v_outbox, decided_at = v_now
     where i.id = v_item_id;
    out_resultado := case when v_inserido then 'enfileirado' else 'reaproveitado' end;
    out_item_id := v_item_id;
    out_outbox_id := v_outbox;
    return next;
    return;
  end if;

  insert into ops.notification_cooldown (recipient_user_id, category, scope_key, cooldown_until,
                                         updated_at)
  values (p_recipient_user_id, p_category, p_scope_key, v_now, v_now)
  on conflict (recipient_user_id, category, scope_key) do nothing;

  select c.cooldown_until into v_ate from ops.notification_cooldown c
   where c.recipient_user_id = p_recipient_user_id and c.category = p_category
     and c.scope_key = p_scope_key
   for update;

  select count(*)::integer into v_outras from ops.notification_item i
   where i.recipient_user_id = p_recipient_user_id and i.category = p_category
     and i.scope_key = p_scope_key and i.state = 'pendente' and i.id <> v_item_id;

  if v_ate <= v_now and v_outras = 0 then
    select e.out_outbox_id, e.out_inserido into v_outbox, v_inserido
      from private.email_outbox_inserir(p_recipient_user_id, p_category, 'digest', p_email_type,
                                        p_email_type, p_template_params,
                                        'n1:' || v_item_id::text, v_now) e;
    update ops.notification_item i
       set state = 'enviado', outbox_id = v_outbox, decided_at = v_now
     where i.id = v_item_id;
    update ops.notification_cooldown c
       set cooldown_until = v_now + make_interval(secs => p_window_seconds),
           flush_job_id = null, updated_at = v_now
     where c.recipient_user_id = p_recipient_user_id and c.category = p_category
       and c.scope_key = p_scope_key;
    out_resultado := 'enviado_agora';
    out_item_id := v_item_id;
    out_outbox_id := v_outbox;
    return next;
    return;
  end if;

  perform private.notification_flush_agendar(p_recipient_user_id, p_category, p_scope_key,
                                             greatest(v_ate, v_now));
  out_resultado := 'pendente';
  out_item_id := v_item_id;
  out_outbox_id := null;
  return next;
end
$$;

-- 10. Flush do agrupamento (35 §5.3). Passo 1: comeco (trava o cooldown).
create or replace function private.notification_flush_begin(
  p_recipient_user_id uuid,
  p_category text,
  p_scope_key text,
  p_now timestamptz default null
)
returns table (out_estado text, out_cooldown_ate timestamptz, out_item_ids uuid[])
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_ate timestamptz;
begin
  select c.cooldown_until into v_ate from ops.notification_cooldown c
   where c.recipient_user_id = p_recipient_user_id and c.category = p_category
     and c.scope_key = p_scope_key
   for update;
  if not found then
    out_estado := 'sem_cooldown';
    out_cooldown_ate := null;
    out_item_ids := '{}'::uuid[];
    return next;
    return;
  end if;

  if v_ate > v_now then
    perform private.notification_flush_agendar(p_recipient_user_id, p_category, p_scope_key, v_ate);
    out_estado := 'reagendado';
    out_cooldown_ate := v_ate;
    out_item_ids := '{}'::uuid[];
    return next;
    return;
  end if;

  select coalesce(array_agg(i.id order by i.occurred_at, i.id), '{}'::uuid[]) into out_item_ids
    from ops.notification_item i
   where i.recipient_user_id = p_recipient_user_id and i.category = p_category
     and i.scope_key = p_scope_key and i.state = 'pendente';
  out_estado := 'pronto';
  out_cooldown_ate := v_ate;
  return next;
end
$$;

-- 11. Flush do agrupamento. Passo 3: fechamento (uma transacao; trava o cooldown de novo).
-- p_cooldown_esperado = cooldown lido no passo 1; se mudou, outro flush ja agiu: nao envia.
-- p_descartes = [{"id": uuid, "motivo": "lido|obsoleto|destinatario_invalido|expirado"}].
-- Resultados: enviado | reaproveitado | sem_envio | cooldown_movido | sem_cooldown.
create or replace function private.notification_flush_commit(
  p_recipient_user_id uuid,
  p_category text,
  p_scope_key text,
  p_cooldown_esperado timestamptz,
  p_keep_ids uuid[],
  p_descartes jsonb,
  p_email_type text,
  p_template_params jsonb,
  p_window_seconds integer,
  p_now timestamptz default null
)
returns table (out_resultado text, out_outbox_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_ate timestamptz;
  v_n integer;
  v_outbox uuid;
  v_inserido boolean;
begin
  if p_window_seconds is null or p_window_seconds not between 60 and 3600 then
    raise exception 'janela de agrupamento fora da faixa' using errcode = '22023';
  end if;

  select c.cooldown_until into v_ate from ops.notification_cooldown c
   where c.recipient_user_id = p_recipient_user_id and c.category = p_category
     and c.scope_key = p_scope_key
   for update;
  if not found then
    out_resultado := 'sem_cooldown';
    out_outbox_id := null;
    return next;
    return;
  end if;

  update ops.notification_item i
     set state = 'descartado', discard_reason = d.motivo, decided_at = v_now
    from jsonb_to_recordset(coalesce(p_descartes, '[]'::jsonb)) as d(id uuid, motivo text)
   where i.id = d.id and i.state = 'pendente'
     and i.recipient_user_id = p_recipient_user_id and i.category = p_category
     and i.scope_key = p_scope_key;

  if v_ate is distinct from p_cooldown_esperado then
    out_resultado := 'cooldown_movido';
    out_outbox_id := null;
  else
    select count(*)::integer into v_n from ops.notification_item i
     where i.id = any(coalesce(p_keep_ids, '{}'::uuid[])) and i.state = 'pendente'
       and i.recipient_user_id = p_recipient_user_id and i.category = p_category
       and i.scope_key = p_scope_key;

    if v_n = 0 then
      out_resultado := 'sem_envio';
      out_outbox_id := null;
    else
      select e.out_outbox_id, e.out_inserido into v_outbox, v_inserido
        from private.email_outbox_inserir(
               p_recipient_user_id, p_category, 'digest', p_email_type, p_email_type,
               coalesce(p_template_params, '{}'::jsonb) || jsonb_build_object('count', v_n),
               'nd:' || p_recipient_user_id::text || ':' || p_category || ':' || p_scope_key || ':'
                 || private.notification_epoch_us(p_cooldown_esperado),
               v_now) e;

      update ops.notification_item i
         set state = 'enviado', outbox_id = v_outbox, decided_at = v_now
       where i.id = any(p_keep_ids) and i.state = 'pendente'
         and i.recipient_user_id = p_recipient_user_id and i.category = p_category
         and i.scope_key = p_scope_key;

      update ops.notification_cooldown c
         set cooldown_until = v_now + make_interval(secs => p_window_seconds),
             flush_job_id = null, updated_at = v_now
       where c.recipient_user_id = p_recipient_user_id and c.category = p_category
         and c.scope_key = p_scope_key;

      out_resultado := case when v_inserido then 'enviado' else 'reaproveitado' end;
      out_outbox_id := v_outbox;
    end if;
  end if;

  -- Itens que ainda estao pendentes (chegaram depois do passo 1) ganham novo flush no fim da janela.
  if exists (select 1 from ops.notification_item i
              where i.recipient_user_id = p_recipient_user_id and i.category = p_category
                and i.scope_key = p_scope_key and i.state = 'pendente') then
    select c.cooldown_until into v_ate from ops.notification_cooldown c
     where c.recipient_user_id = p_recipient_user_id and c.category = p_category
       and c.scope_key = p_scope_key;
    perform private.notification_flush_agendar(p_recipient_user_id, p_category, p_scope_key,
                                               greatest(v_ate, v_now));
  end if;
  return next;
end
$$;

-- 12. Envio (35 §5.4): reivindica, reserva cota, fecha o resultado do provedor -----------------------

-- 12.1 Reivindica a linha com lease de 60 s. Dois executores nunca reivindicam a mesma linha.
create or replace function private.email_outbox_claim(p_outbox_id uuid, p_now timestamptz default null)
returns setof ops.email_outbox
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  return query
  update ops.email_outbox o
     set state = 'enviando', lease_until = v_now + make_interval(secs => 60)
   where o.id = p_outbox_id
     and ((o.state in ('pendente', 'adiado_cota') and o.next_attempt_at <= v_now)
          or (o.state = 'enviando' and o.lease_until < v_now))
  returning o.*;
end
$$;

-- 12.2 Aceito pelo provedor.
create or replace function private.email_outbox_marcar_enviado(
  p_outbox_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_now timestamptz default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  update ops.email_outbox o
     set state = 'enviado', provider = p_provider, provider_message_id = p_provider_message_id,
         sent_at = v_now, lease_until = null
   where o.id = p_outbox_id and o.state = 'enviando';
  return found;
end
$$;

-- 12.3 Volta para pendente ou adiado_cota com novo horario; opcionalmente devolve a cota.
create or replace function private.email_outbox_reagendar(
  p_outbox_id uuid,
  p_state text,
  p_attempts integer,
  p_next_attempt_at timestamptz,
  p_reason_code text,
  p_liberar_cota boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_reservado_em timestamptz;
begin
  if p_state not in ('pendente', 'adiado_cota') then
    raise exception 'estado de reagendamento invalido' using errcode = '22023';
  end if;
  select o.quota_reserved_at into v_reservado_em from ops.email_outbox o
   where o.id = p_outbox_id and o.state = 'enviando'
   for update;
  if not found then
    return false;
  end if;
  if p_liberar_cota and v_reservado_em is not null then
    perform private.email_quota_release(v_reservado_em);
  end if;
  update ops.email_outbox o
     set state = p_state, attempts = p_attempts, next_attempt_at = p_next_attempt_at,
         reason_code = p_reason_code, lease_until = null,
         quota_reserved = case when p_liberar_cota and v_reservado_em is not null
                               then false else o.quota_reserved end,
         quota_reserved_at = case when p_liberar_cota and v_reservado_em is not null
                                  then null else o.quota_reserved_at end
   where o.id = p_outbox_id;
  perform private.email_outbox_enfileirar_envio(p_outbox_id, p_next_attempt_at);
  return true;
end
$$;

-- 12.4 Encerra a linha: falha (recusa ou limite de tentativas), suprimido ou descartado.
create or replace function private.email_outbox_encerrar(
  p_outbox_id uuid,
  p_state text,
  p_reason_code text,
  p_liberar_cota boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_reservado_em timestamptz;
begin
  if p_state not in ('falha', 'suprimido', 'descartado') then
    raise exception 'estado de encerramento invalido' using errcode = '22023';
  end if;
  select o.quota_reserved_at into v_reservado_em from ops.email_outbox o
   where o.id = p_outbox_id and o.state = 'enviando'
   for update;
  if not found then
    return false;
  end if;
  if p_liberar_cota and v_reservado_em is not null then
    perform private.email_quota_release(v_reservado_em);
  end if;
  update ops.email_outbox o
     set state = p_state, reason_code = p_reason_code, lease_until = null,
         quota_reserved = case when p_liberar_cota and v_reservado_em is not null
                               then false else o.quota_reserved end,
         quota_reserved_at = case when p_liberar_cota and v_reservado_em is not null
                                  then null else o.quota_reserved_at end
   where o.id = p_outbox_id;
  return true;
end
$$;

-- 12.5 Revalidacao no envio: descarta itens obsoletos/lidos da linha e ajusta a contagem do digest.
-- Devolve quantos itens continuam enviados pela linha (0 = a linha deve ser encerrada).
create or replace function private.email_outbox_ajustar_itens(p_outbox_id uuid, p_descartes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_classe text;
  v_restantes integer;
begin
  select o.class into v_classe from ops.email_outbox o where o.id = p_outbox_id for update;
  if not found then
    return 0;
  end if;

  update ops.notification_item i
     set state = 'descartado', discard_reason = d.motivo, decided_at = v_now
    from jsonb_to_recordset(coalesce(p_descartes, '[]'::jsonb)) as d(id uuid, motivo text)
   where i.id = d.id and i.outbox_id = p_outbox_id and i.state = 'enviado';

  select count(*)::integer into v_restantes from ops.notification_item i
   where i.outbox_id = p_outbox_id and i.state = 'enviado';

  if v_classe = 'digest' and v_restantes > 0 then
    update ops.email_outbox o
       set template_params = o.template_params || jsonb_build_object('count', v_restantes)
     where o.id = p_outbox_id;
  end if;
  return v_restantes;
end
$$;

-- 13. Privilegios minimos ---------------------------------------------------------------------------
revoke all on function
  private.notification_epoch_us(timestamptz),
  private.email_outbox_enfileirar_envio(uuid, timestamptz),
  private.email_outbox_inserir(uuid, text, text, text, text, jsonb, text, timestamptz),
  private.notification_flush_agendar(uuid, text, text, timestamptz),
  private.email_outbox_reservar_cota(uuid, integer, integer, timestamptz),
  private.email_quota_release(timestamptz),
  private.email_quota_registrar_alerta(smallint, smallint, timestamptz),
  private.notification_ingest(uuid, text, text, uuid, timestamptz, text, text, jsonb, text,
                              integer, timestamptz),
  private.notification_flush_begin(uuid, text, text, timestamptz),
  private.notification_flush_commit(uuid, text, text, timestamptz, uuid[], jsonb, text, jsonb,
                                    integer, timestamptz),
  private.email_outbox_claim(uuid, timestamptz),
  private.email_outbox_marcar_enviado(uuid, text, text, timestamptz),
  private.email_outbox_reagendar(uuid, text, integer, timestamptz, text, boolean),
  private.email_outbox_encerrar(uuid, text, text, boolean),
  private.email_outbox_ajustar_itens(uuid, jsonb),
  private.outbox_event_enfileira_despacho()
  from public, anon, authenticated, service_role;

-- Tabelas: somente app_system (BYPASSRLS). app_api nao recebe nada nesta migracao.
grant select, insert, update, delete on ops.email_outbox, ops.notification_item,
  ops.notification_cooldown, ops.external_quota to app_system;

-- Funcoes de uso do executor de sistema (SECURITY INVOKER; o gatilho e SECURITY DEFINER).
grant execute on function
  private.notification_epoch_us(timestamptz),
  private.email_outbox_enfileirar_envio(uuid, timestamptz),
  private.email_outbox_inserir(uuid, text, text, text, text, jsonb, text, timestamptz),
  private.notification_flush_agendar(uuid, text, text, timestamptz),
  private.email_outbox_reservar_cota(uuid, integer, integer, timestamptz),
  private.email_quota_release(timestamptz),
  private.email_quota_registrar_alerta(smallint, smallint, timestamptz),
  private.notification_ingest(uuid, text, text, uuid, timestamptz, text, text, jsonb, text,
                              integer, timestamptz),
  private.notification_flush_begin(uuid, text, text, timestamptz),
  private.notification_flush_commit(uuid, text, text, timestamptz, uuid[], jsonb, text, jsonb,
                                    integer, timestamptz),
  private.email_outbox_claim(uuid, timestamptz),
  private.email_outbox_marcar_enviado(uuid, text, text, timestamptz),
  private.email_outbox_reagendar(uuid, text, integer, timestamptz, text, boolean),
  private.email_outbox_encerrar(uuid, text, text, boolean),
  private.email_outbox_ajustar_itens(uuid, jsonb)
  to app_system;
