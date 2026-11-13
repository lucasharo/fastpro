-- Issue 150 | Remove o historico de acesso as fotos: ops.media_access_daily (resumo diario) e a funcao do bloco E8.
-- Decisoes: Rodada 67 (decisao 158, opcao A, autorizada pelo usuario; substitui RF-030 e o criterio do D10 no que
-- exigem log de acesso); Rodada 68 (320 a 328); Rodada 69 (329 auditoria com 33 chaves e catalogo intacto; 330 valor
-- do rollback). Desenho: docs/factory/118-DESENHO-REMOCAO-HISTORICO-ACESSO.md §2.
-- A origem ops.media_access_log nunca foi criada em migracao (o bloco E8 sempre devolveu pulado_ausente): nada e
-- apagado dela, e este arquivo nao a referencia. Nao toca nenhuma outra tabela, funcao, papel ou auditoria.
-- Sem begin/commit: a transacao e do executor (packages/db/scripts/db.mjs). Idempotente (if exists, delete sem efeito).
-- Rollback (so estrutura vazia, sem funcao e sem linhas): supabase/rollbacks/20261113180000_ops_remove_media_access_history.down.sql

-- 0. Falha rapida se o job de expurgo segurar a funcao (desenho §2, passo 1 e secao 8).
set local lock_timeout = '5s';

-- 1. Funcao primeiro, para ninguem mais escrever na tabela. A orquestracao dos blocos e em TypeScript; no banco
--    so existe esta funcao. Os privilegios (so app_system) saem com ela.
drop function if exists private.ops_purge_media_access(timestamptz, integer);

-- 2. Evidencia sem identificador de sujeito: so o numero de linhas que existiam antes (CA-H150-04). Nao aborta: a
--    remocao e autorizada pela Rodada 67, mesmo se houver linhas.
do $$
declare
  v_n bigint;
begin
  if to_regclass('ops.media_access_daily') is not null then
    execute 'select count(*) from ops.media_access_daily' into v_n;
    raise notice 'media_access_daily_linhas=%', v_n;
  end if;
end $$;

-- 3. Chaves de configuracao do recurso removido (decisao 325). Antes do delete, registra chave e valor (prazo em
--    segundos, nao dado pessoal) para o rollback ser fiel (decisao 330).
do $$
declare
  v_rec record;
begin
  for v_rec in
    select key, value::text as valor from ops.app_config where key like 'purge.media_access\_%' escape '\'
  loop
    raise notice 'config_removida: % = %', v_rec.key, v_rec.valor;
  end loop;
end $$;

delete from ops.app_config
 where key in ('purge.media_access_rollup_after_seconds', 'purge.media_access_detail_seconds');

-- Guarda: RLS forcada sem BYPASSRLS apagaria zero linhas sem erro. Se sobrar chave, aborta com erro explicito.
do $$
begin
  if exists (select 1 from ops.app_config where key like 'purge.media_access\_%' escape '\') then
    raise exception 'config_media_access_nao_removida' using errcode = '23514';
  end if;
end $$;

-- 4. Tabela de resumo. Sem cascade: a tabela nao tem dependentes conhecidos (sem FK); se alguem criou um, o erro e o
--    desejado. Os privilegios (nenhum a papel algum) saem com ela.
drop table if exists ops.media_access_daily;
