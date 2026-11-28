-- Desfaz 20261111370000_geo_create_geocode_point.sql (H-021). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove as duas tabelas (com o que houver nelas) e tira a migracao do registro.
-- Atencao: se as funcoes de reserva da proxima fatia de H-021 ja existirem, desfaca-as antes.
begin;

drop table if exists app.geocode_budget;
drop table if exists app.geocode_point;

delete from ops.schema_migration where version = '20261111370000';

commit;
