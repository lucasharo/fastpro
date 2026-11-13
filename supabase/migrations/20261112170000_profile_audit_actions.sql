-- H-036 | Cadastro das acoes de auditoria do perfil profissional (docs/factory/99-DESENHO-H036.md, §6; CA-10).
-- Sem este cadastro, private.audit_append falha: audit.audit_event tem chave estrangeira para
-- audit.action_catalog (action, object_type). As chaves de estado sao so contagens, raio, tipo da mudanca e um
-- booleano: nunca rotulo, ponto, hash, celula ou identificador de servico (CA-10).
-- Idempotente (on conflict do nothing). Natureza: so linhas de catalogo, sem dado de usuario.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('profile.area.changed', 'professional_area', false,
   array['radius_m', 'change_kind', 'base_changed'],
   'Base e raio do perfil profissional definidos ou alterados (H-036, sem localizacao)'),
  ('profile.services.changed', 'professional_services', false,
   array['total', 'presencial', 'online'],
   'Servicos declarados pelo profissional alterados (H-036, so contagens)')
on conflict (action, object_type) do nothing;
