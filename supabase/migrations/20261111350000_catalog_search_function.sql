-- H-019 | Busca de servico com sinonimos por funcao (#32, desenho 64-DESENHO-H019 §1).
-- Idempotente. Desfazer: supabase/rollbacks/20261111350000_catalog_search_function.down.sql (manual, so em dev).
-- Mesmo padrao de seguranca de private.catalog_public_list (H-018, 53 §2), que NAO e alterada.
-- Le sinonimos ativos; devolve so os 7 campos publicos (CATALOG_PUBLIC_FIELDS); nao grava nada; nao registra
-- o termo (sem raise, sem tabela de buscas). O termo entra como parametro ligado e vira texto (strpos, sem LIKE).
-- Relevancia: 1 nome comeca com o termo; 2 palavra do nome comeca com o termo; 3 nome contem o termo;
-- 4, 5 e 6: o mesmo para sinonimo ativo. Cada servico aparece uma vez (melhor ranking). Limite de 10.

create or replace function private.catalog_search(p_term text)
returns table (
  group_id uuid,
  group_name text,
  group_position integer,
  service_id uuid,
  service_name text,
  modality text,
  regulated boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select private.catalog_norm(p_term) as t
  ),
  cand as (
    select g.id as gid, g.name as gname, g.position as gpos, s.id as sid, s.name as sname,
           s.name_norm as sn, s.modality as modality, s.regulated as regulated,
           least(
             case when strpos(s.name_norm, q.t) = 1 then 1
                  when strpos(s.name_norm, ' ' || q.t) > 0 then 2
                  when strpos(s.name_norm, q.t) > 0 then 3
             end,
             (select min(case when strpos(y.term_norm, q.t) = 1 then 4
                              when strpos(y.term_norm, ' ' || q.t) > 0 then 5
                              when strpos(y.term_norm, q.t) > 0 then 6
                         end)
                from app.service_synonym y
               where y.service_id = s.id and y.active)
           ) as rnk
      from q
      cross join app.service s
      join app.service_group g on g.id = s.group_id
     where g.active and s.active
       and char_length(q.t) >= 2 and q.t ~ '[[:alnum:]]'
  )
  select gid, gname, gpos, sid, sname, modality, regulated
    from cand
   where rnk is not null
   order by rnk, gpos, gid, sn, sid
   limit 10
$$;
comment on function private.catalog_search(text) is
  'Busca de servico (H-019, 64 §1): so colunas publicas, so ativos, sinonimos ativos, max 10. Nao grava nem registra o termo. EXECUTE so para app_api.';

revoke all on function private.catalog_search(text) from public, anon, authenticated;
grant execute on function private.catalog_search(text) to app_api;
