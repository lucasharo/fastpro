-- Desfaz H-014 (secrets_enc do step-up), migracao 20261111360000. Idempotente.
-- Restaura step_up_request com 14 argumentos, como em 20261111310000 (secrets_enc nulo).
begin;

drop function if exists private.step_up_request(uuid, uuid, text, text, text, bytea, bytea, text,
  timestamptz, text, text, text, integer, integer, integer);

create or replace function private.step_up_request(
  p_session_id uuid,
  p_id uuid,
  p_email_hash text,
  p_token_hash text,
  p_code_hmac text,
  p_email_enc bytea,
  p_ip_hmac text,
  p_now timestamptz,
  p_ip_key text,
  p_global_h_key text,
  p_global_d_key text,
  p_ip_limit integer,
  p_global_h_limit integer,
  p_global_d_limit integer)
returns table (out_resultado text, out_challenge_id uuid, out_outbox_id uuid,
               out_retry_after integer, out_motivo text)
language plpgsql
set search_path = ''
as $$
begin
  if p_session_id is null or p_now is null then
    raise exception 'step_up_entrada_invalida' using errcode = '22023';
  end if;

  if not exists (
    select 1 from app.app_session s
      join app.app_user u on u.id = s.user_id
     where s.id = p_session_id
       and s.stage = 'ativa'
       and s.revoked_at is null
       and s.expires_at > p_now
       and s.absolute_expires_at > p_now
       and s.auth_method = 'link'
       and u.status = 'ativo') then
    return query select 'negado'::text, null::uuid, null::uuid, null::integer, 'sessao'::text;
    return;
  end if;

  return query
    select r.out_resultado, r.out_challenge_id, r.out_outbox_id, r.out_retry_after, r.out_motivo
      from private.auth_challenge_request(p_id, p_email_hash, 'step_up', p_token_hash, p_code_hmac,
        p_email_enc, null, null, p_ip_hmac, p_now, p_ip_key, p_global_h_key, p_global_d_key,
        p_ip_limit, p_global_h_limit, p_global_d_limit, p_session_id) r;
end
$$;

revoke all on function
  private.step_up_request(uuid, uuid, text, text, text, bytea, text, timestamptz, text, text, text,
    integer, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  private.step_up_request(uuid, uuid, text, text, text, bytea, text, timestamptz, text, text, text,
    integer, integer, integer)
  to app_system;

commit;
