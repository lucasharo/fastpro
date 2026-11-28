-- Desfaz os logins DEV criados por "corepack pnpm db:dev:logins" (Issue #156, desenho 177 §3).
-- Sem segredo. Nao e migracao: nao entra em supabase/migrations. Os papeis nao possuem objetos; a herança some junto.
drop role if exists fastpro_dev_api;
drop role if exists fastpro_dev_system;
