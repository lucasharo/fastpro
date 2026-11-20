-- Issue 120 (H-111) | Correcao do guarda do codigo de step-up do titular (migracao 20261120600000, ja aplicada no DEV).
-- Defeito: o guarda recusava qualquer alteracao de outbox_id, mas app.dsr_step_up_issue grava a saida do e-mail logo
-- depois de inserir o codigo (null -> valor). Resultado: toda emissao falhava com dsr_step_up_code_imutavel.
-- Correcao: outbox_id pode ser preenchido uma vez (null -> valor) e depois nunca mais muda. O restante da regra
-- (identidade, HMAC, validade, tentativas, consumo, invalidacao e blob) fica igual.
-- Desfazer: supabase/rollbacks/20261120620000_privacy_fix_dsr_step_up_guard.down.sql.

create or replace function private.dsr_step_up_code_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.code_hmac is distinct from old.code_hmac
     or (old.outbox_id is not null and new.outbox_id is distinct from old.outbox_id)
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'dsr_step_up_code_imutavel' using errcode = '42501';
  end if;
  if new.code_enc is distinct from old.code_enc and new.code_enc is not null then
    raise exception 'dsr_step_up_code_imutavel' using errcode = '42501';
  end if;
  if new.attempts < old.attempts then
    raise exception 'dsr_step_up_code_tentativas_regressivas' using errcode = '42501';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'dsr_step_up_code_ja_consumido' using errcode = '42501';
  end if;
  if old.invalidated_at is not null and new.invalidated_at is distinct from old.invalidated_at then
    raise exception 'dsr_step_up_code_ja_invalidado' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.dsr_step_up_code_guard() from public, anon, authenticated;
