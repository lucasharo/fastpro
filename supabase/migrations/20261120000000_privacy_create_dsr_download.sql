-- Issue 120 (H-111) | Direitos do titular: download do extrato por token de uso unico (147-DESENHO-H111 D-A6, §5.1,
-- §6.2). Expansiva: uma tabela nova (app.dsr_download_token), duas funcoes, a acao de auditoria e permissoes.
-- Nenhuma tabela existente e alterada.
-- Regras: o token (aleatorio, 256 bits) nunca e guardado, so o seu SHA-256; validade de 5 minutos, limitada a
-- validade do extrato; consumo atomico (uso unico); registro sem DELETE nem TRUNCATE (prova de entrega).

-- 1. Tabela de tokens emitidos -----------------------------------------------------------------------------------
create table if not exists app.dsr_download_token (
  token_hash      text primary key,
  export_id       uuid not null references app.dsr_export (id) on delete restrict,
  case_id         uuid not null references app.dsr_case (id) on delete restrict,
  subject_user_id uuid not null references app.app_user (id) on delete restrict,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz null,
  constraint dsr_download_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint dsr_download_token_validade_check check (expires_at > issued_at),
  constraint dsr_download_token_uso_check check (used_at is null or used_at >= issued_at)
);

create index if not exists dsr_download_token_export_idx on app.dsr_download_token (export_id, issued_at desc);

alter table app.dsr_download_token enable row level security;
alter table app.dsr_download_token force row level security;

revoke all on app.dsr_download_token from public, anon, authenticated, app_api;

-- Imutabilidade: so used_at muda, e uma vez. Sem DELETE nem TRUNCATE.
create or replace function private.dsr_download_token_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_hash is distinct from old.token_hash
     or new.export_id is distinct from old.export_id
     or new.case_id is distinct from old.case_id
     or new.subject_user_id is distinct from old.subject_user_id
     or new.issued_at is distinct from old.issued_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'dsr_token_imutavel' using errcode = '42501';
  end if;
  if old.used_at is not null and new.used_at is distinct from old.used_at then
    raise exception 'dsr_token_ja_usado' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists dsr_download_token_guard on app.dsr_download_token;
create trigger dsr_download_token_guard
  before update on app.dsr_download_token
  for each row execute function private.dsr_download_token_guard();

drop trigger if exists dsr_download_token_no_delete on app.dsr_download_token;
create trigger dsr_download_token_no_delete
  before delete or truncate on app.dsr_download_token
  for each statement execute function private.dsr_registro_refuse_delete();

-- 2. Catalogo de auditoria: a acao do download (so por migracao) ----------------------------------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.extract_downloaded', 'dsr_case', false, array['download_count'],
   'Download do extrato de acesso por token de uso unico (H-111)')
on conflict (action, object_type) do nothing;

-- 3. app.dsr_issue_extract_token: emite o token do titular dono (validade de 5 minutos, D-A6) ------------------------
-- Resposta uniforme para caso inexistente, de outro titular ou que nao e de acesso (dsr_nao_encontrado).
create or replace function app.dsr_issue_extract_token(p_subject uuid, p_case uuid, p_token_hash text)
returns table (
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_kind text;
  v_export record;
  v_expira timestamptz;
begin
  select c.kind into v_kind
    from app.dsr_case c
   where c.id = p_case
     and c.subject_user_id = p_subject;
  if not found or v_kind <> 'acesso' then
    raise exception 'dsr_nao_encontrado';
  end if;

  select e.id, e.expires_at, e.purged_at into v_export
    from app.dsr_export e
   where e.case_id = p_case;
  if not found or v_export.purged_at is not null or v_export.expires_at <= v_agora then
    raise exception 'dsr_extrato_indisponivel';
  end if;

  v_expira := least(v_agora + interval '5 minutes', v_export.expires_at);

  insert into app.dsr_download_token (token_hash, export_id, case_id, subject_user_id, issued_at, expires_at)
  values (p_token_hash, v_export.id, p_case, p_subject, v_agora, v_expira);

  return query select v_expira;
end
$$;

-- 4. app.dsr_consume_extract_token: consome o token (uso unico) e devolve o registro do arquivo ------------------------
-- O consumo e atomico (FOR UPDATE). Falhas: dsr_token_invalido, dsr_token_usado, dsr_token_expirado,
-- dsr_extrato_indisponivel. Cada consumo grava contador e auditoria, sem dado pessoal.
create or replace function app.dsr_consume_extract_token(p_token_hash text)
returns table (
  out_case_id uuid,
  out_subject_user_id uuid,
  out_storage_path text,
  out_sha256 text,
  out_signature text,
  out_size_bytes integer,
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_tok record;
  v_exp record;
begin
  select t.* into v_tok
    from app.dsr_download_token t
   where t.token_hash = p_token_hash
     for update;
  if not found then
    raise exception 'dsr_token_invalido';
  end if;
  if v_tok.used_at is not null then
    raise exception 'dsr_token_usado';
  end if;
  if v_tok.expires_at <= v_agora then
    raise exception 'dsr_token_expirado';
  end if;

  select e.* into v_exp
    from app.dsr_export e
   where e.id = v_tok.export_id
     for update;
  if not found or v_exp.purged_at is not null or v_exp.expires_at <= v_agora then
    raise exception 'dsr_extrato_indisponivel';
  end if;

  update app.dsr_download_token
     set used_at = v_agora
   where token_hash = p_token_hash;

  update app.dsr_export
     set download_count = download_count + 1,
         last_download_at = v_agora
   where id = v_exp.id;

  perform private.audit_append('system:dsr_download', 'system', 'dsr.extract_downloaded', 'dsr_case', v_tok.case_id,
    '{}'::jsonb, jsonb_build_object('download_count', v_exp.download_count + 1), null, null);

  return query select v_tok.case_id, v_tok.subject_user_id, v_exp.storage_path, v_exp.sha256, v_exp.signature,
                      v_exp.size_bytes, v_exp.expires_at;
end
$$;

-- 5. Permissoes: so app_system executa as duas funcoes da API -------------------------------------------------------
revoke all on function
  app.dsr_issue_extract_token(uuid, uuid, text),
  app.dsr_consume_extract_token(text)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_issue_extract_token(uuid, uuid, text),
  app.dsr_consume_extract_token(text)
  to app_system;
