-- Desfaz 20261112120500_geo_expand_match_point.sql (H-022). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove o gatilho, as funcoes da grade e da consulta, o indice e os CHECKs, e as quatro colunas
-- match_*. Essas colunas sao derivadas de exact_point (recalculaveis); nenhum dado de origem e apagado.
-- exact_point, geocode_point_*, geo_* e o teto de chamadas nao sao tocados. Idempotente (if exists).
begin;

alter table app.geocode_point drop constraint if exists geocode_point_match_estado;

drop trigger if exists geocode_point_match_biu on app.geocode_point;
drop function if exists private.geocode_point_set_match();

drop function if exists private.match_points_within(double precision, double precision, integer, integer, smallint);
drop function if exists private.match_janela(double precision, double precision, integer);
drop function if exists private.match_grid(smallint, double precision, double precision);
drop function if exists private.match_grid_dlon(integer);

drop index if exists app.geocode_point_match_cell_idx;

alter table app.geocode_point drop constraint if exists geocode_point_match_dominio;
alter table app.geocode_point drop constraint if exists geocode_point_match_origem;
alter table app.geocode_point drop constraint if exists geocode_point_match_tudo_ou_nada;

alter table app.geocode_point
  drop column if exists match_grid_version,
  drop column if exists match_lat,
  drop column if exists match_lon,
  drop column if exists match_cell;

delete from ops.schema_migration where version = '20261112120500';

commit;
