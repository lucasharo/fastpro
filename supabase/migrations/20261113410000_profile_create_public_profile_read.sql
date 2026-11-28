-- Issue 56 (H-043) | Leitura publica do perfil por slug (docs/factory/143-DESENHO-H043.md, §3, §4; decisoes 583 a 602 e 650 a 661).
-- Cria private.professional_public_profile(p_slug text) returns jsonb: SECURITY DEFINER, search_path vazio, STABLE, so leitura.
-- Monta o JSON por construcao positiva (jsonb_build_object com as chaves da lista fechada), nunca por select * nem to_jsonb(linha).
-- Visivel so se: slug valido, verification_status = 'aprovada', suspended_at nulo, app_user ativo e (sem caso ou caso aprovado).
-- Qualquer outro caso devolve null (o chamador responde 404 uniforme). Nao consulta acesso comercial (dec. 585).
-- Nenhuma tabela, coluna, indice, gatilho, cron ou grant de tabela novo. EXECUTE so para app_system (dec. 652).
-- Desfazer: supabase/rollbacks/20261113410000_profile_create_public_profile_read.down.sql (dev somente).

create or replace function private.professional_public_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select p.user_id, p.slug, p.public_name
      from app.professional_profile p
      join app.app_user u on u.id = p.user_id
     where p_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'
       and p.slug = p_slug
       and p.verification_status = 'aprovada'
       and p.suspended_at is null
       and u.status = 'ativo'
       and not exists (
         select 1
           from app.verification_case c
          where c.professional_id = p.user_id
            and c.status <> 'aprovada')
  ),
  servicos as (
    select g.name as group_name, s.name as item_name, ps.modality
      from app.professional_service ps
      join alvo a on a.user_id = ps.professional_id
      join app.service s on s.id = ps.service_id
      join app.service_group g on g.id = s.group_id
     where s.active
       and g.active
  ),
  por_servico as (
    select x.group_name, x.item_name, array_agg(distinct x.modality order by x.modality) as modalidades
      from servicos x
     group by x.group_name, x.item_name
  ),
  por_grupo as (
    select y.group_name,
           jsonb_agg(
             jsonb_build_object('name', y.item_name, 'modalities', to_jsonb(y.modalidades))
             order by y.item_name) as itens
      from por_servico y
     group by y.group_name
  )
  select (
    select jsonb_build_object(
             'publicName', a.public_name,
             'slug', a.slug,
             'verified', true,
             'services', coalesce(
               (select jsonb_agg(
                         jsonb_build_object('groupName', g.group_name, 'items', g.itens)
                         order by g.group_name)
                    from por_grupo g),
               '[]'::jsonb),
             'rating', jsonb_build_object('average', null::numeric, 'count', 0))
      from alvo a)
$$;

revoke all on function private.professional_public_profile(text)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.professional_public_profile(text) to app_system;

comment on function private.professional_public_profile(text) is
  'Leitura publica do perfil aprovado por slug (Issue 56, H-043). So leitura; lista fechada de chaves; null se nao visivel. EXECUTE so para app_system.';
