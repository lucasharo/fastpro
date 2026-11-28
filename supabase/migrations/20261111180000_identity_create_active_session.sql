-- H-014 | Sessao de 7 dias: colunas de sessao ativa e funcoes de conversao, guarda e saida
-- (docs/factory/52-DESENHO-H014.md §1.2, §1.3, §2, §3). Idempotente.
-- Desfazer: supabase/rollbacks/20261111180000_identity_create_active_session.down.sql.
-- Nao altera migracoes aplicadas. Mesma postura de H-011/H-012: RLS forcada, sem politicas, so app_system
-- executa as funcoes. Nenhuma funcao devolve ou aceita segredo em claro: so o hash SHA-256.
-- Sem emissao de sessao do Supabase aqui (52 §1.4): a autoridade da API e o cookie opaco + esta linha.

-- 1. Colunas da sessao ativa --------------------------------------------------------------------------
-- recent_auth_at: ultima prova (link na conversao; codigo ou senha no step-up). Nulo na etapa.
alter table app.app_session add column if not exists recent_auth_at timestamptz;
-- auth_method: como a sessao foi aberta. Define o metodo de prova do step-up (52 §4.2).
alter table app.app_session add column if not exists auth_method text not null default 'link';

alter table app.app_session drop constraint if exists app_session_auth_method_valido;
alter table app.app_session add constraint app_session_auth_method_valido
  check (auth_method in ('link', 'password'));

-- Etapa e sessao ativa sao exclusivas: ativa exige prova recente e prazo absoluto; etapa nao tem prova.
alter table app.app_session drop constraint if exists app_session_ativa_consistente;
alter table app.app_session add constraint app_session_ativa_consistente
  check (
    (stage = 'ativa' and recent_auth_at is not null and expires_at = absolute_expires_at)
    or (stage = 'identificacao' and recent_auth_at is null)
  );

-- Busca por requisicao usa este indice (52 §2). Segredos distintos, por construcao.
create unique index if not exists app_session_secret_hash_uidx on app.app_session (secret_hash);

comment on column app.app_session.recent_auth_at is
  'H-014: ultima prova (conversao, codigo ou senha). Janela de step-up de 30 min; so avanca.';
comment on column app.app_session.auth_method is
  'H-014: link (acesso por e-mail) ou password (H-016). Define o metodo do step-up.';

-- 2. Conversao atomica da etapa em sessao ativa (52 §1.2) ---------------------------------------------
-- Uma instrucao: troca o hash (segredo novo; o antigo deixa de valer), fixa expires_at no teto
-- absoluto (7 dias do clique, sem renovacao) e grava recent_auth_at. Duas conversoes simultaneas: a
-- segunda reavalia o WHERE depois do bloqueio da linha e devolve zero linhas.
create or replace function private.app_session_convert(
  p_old_hash text, p_new_hash text, p_now timestamptz)
returns table (
  out_session_id uuid, out_user_id uuid, out_absolute_expires_at timestamptz,
  out_purpose text, out_draft_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  return query
    update app.app_session s
       set stage = 'ativa',
           secret_hash = p_new_hash,
           expires_at = s.absolute_expires_at,
           recent_auth_at = p_now,
           auth_method = 'link'
     where s.secret_hash = p_old_hash
       and s.stage = 'identificacao'
       and s.revoked_at is null
       and s.expires_at > p_now
       and exists (select 1 from app.app_user u where u.id = s.user_id and u.status = 'ativo')
    returning s.id, s.user_id, s.absolute_expires_at, s.purpose, s.draft_id;
end
$$;

-- 3. Guarda de sessao (52 §2): so a sessao ativa, nao revogada, dentro dos dois prazos e de usuario ativo.
-- Nenhuma escrita: a leitura nao renova prazo algum.
create or replace function private.app_session_get(p_hash text, p_now timestamptz)
returns table (
  out_session_id uuid, out_user_id uuid, out_recent_auth_at timestamptz, out_auth_method text)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query
    select s.id, s.user_id, s.recent_auth_at, s.auth_method
      from app.app_session s
     where s.secret_hash = p_hash
       and s.stage = 'ativa'
       and s.revoked_at is null
       and s.expires_at > p_now
       and s.absolute_expires_at > p_now
       and exists (select 1 from app.app_user u where u.id = s.user_id and u.status = 'ativo');
end
$$;

-- 4. Saida (52 §3). Revoga uma sessao ativa; revogar de novo mantem a primeira data.
create or replace function private.app_session_revoke(p_session_id uuid, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update app.app_session s
     set revoked_at = coalesce(s.revoked_at, p_now)
   where s.id = p_session_id
     and s.stage = 'ativa';
  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end
$$;

-- 5. Sair de todos (52 §3): revoga todas as linhas ainda nao revogadas da pessoa, ativas e etapas.
-- Corrida com a conversao: nas duas ordens o resultado e "revogada", nunca viva depois do 204.
create or replace function private.app_session_revoke_all(p_user_id uuid, p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update app.app_session s
     set revoked_at = coalesce(s.revoked_at, p_now)
   where s.user_id = p_user_id
     and s.revoked_at is null;
  get diagnostics v_linhas = row_count;
  return v_linhas;
end
$$;

-- 6. Prova recente (52 §4.2): a unica escrita de uso. So avanca (greatest) e so em sessao viva.
create or replace function private.app_session_mark_recent_auth(p_session_id uuid, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update app.app_session s
     set recent_auth_at = greatest(s.recent_auth_at, p_now)
   where s.id = p_session_id
     and s.stage = 'ativa'
     and s.revoked_at is null
     and s.expires_at > p_now;
  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end
$$;

-- 7. Postura de acesso (igual H-011/H-012) ------------------------------------------------------------
revoke all on function
  private.app_session_convert(text, text, timestamptz),
  private.app_session_get(text, timestamptz),
  private.app_session_revoke(uuid, timestamptz),
  private.app_session_revoke_all(uuid, timestamptz),
  private.app_session_mark_recent_auth(uuid, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.app_session_convert(text, text, timestamptz),
  private.app_session_get(text, timestamptz),
  private.app_session_revoke(uuid, timestamptz),
  private.app_session_revoke_all(uuid, timestamptz),
  private.app_session_mark_recent_auth(uuid, timestamptz)
  to app_system;
