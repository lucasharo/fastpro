-- Issue 120 (H-111) | Direitos do titular: amplia o CHECK de app.app_user.status com em_eliminacao e anonimizado
-- (docs/factory/147-DESENHO-H111.md §3.3 e §8, passo 3; decisao 674 e 'adotada pelo lider').
-- Terceira fatia do desenho. Expansiva: troca o CHECK de status e acrescenta um CHECK de coerencia. Nenhuma linha
-- existente muda (ninguem tem status novo ainda), nenhuma funcao, gatilho, job ou e-mail e criado aqui.
-- Coerencia com app_user_anonimizado_consistente (retention, 20261111470000). Essa constraint existente aceita
-- retention_state nulo quando anonymized_at esta preenchido (a expressao vira NULL e o CHECK passa), por isso sozinha
-- nao garante a cadeia. Este CHECK novo fecha o buraco so para status = 'anonimizado': exige anonymized_at nao nulo
-- e retention_state = 'expurgado'. A constraint existente nao e alterada aqui (fora do escopo desta Issue).
-- Guards: os de elegibilidade e RLS do banco usam status = 'ativo' (forma positiva), entao os valores novos ja contam
-- como nao ativos. Pendencia fora desta migracao: a verificacao de login em packages/db/src/challenge-consume.ts
-- compara com 'bloqueado' por negacao; precisa passar a exigir 'ativo' antes de a fatia que grava em_eliminacao.
-- Desfazer: supabase/rollbacks/20261113480000_privacy_expand_app_user_status.down.sql (recusa se houver conta
-- anonimizada ou em eliminacao).

do $$
begin
  if to_regclass('app.app_user') is null
     or not exists (select 1 from pg_constraint
                     where conrelid = 'app.app_user'::regclass and conname = 'app_user_status_check')
     or not exists (select 1 from pg_constraint
                     where conrelid = 'app.app_user'::regclass and conname = 'app_user_anonimizado_consistente')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Valores de status: ativo e bloqueado (ja existentes) mais em_eliminacao e anonimizado (Issue 120) ----------
alter table app.app_user drop constraint if exists app_user_status_check;
alter table app.app_user add constraint app_user_status_check
  check (status in ('ativo', 'bloqueado', 'em_eliminacao', 'anonimizado'));

-- 2. Conta anonimizada precisa do marcador de expurgo completo (anonymized_at e retention_state = 'expurgado') ----
alter table app.app_user drop constraint if exists app_user_status_anonimizado_consistente;
alter table app.app_user add constraint app_user_status_anonimizado_consistente
  check (status <> 'anonimizado'
         or (anonymized_at is not null and retention_state is not distinct from 'expurgado'));
