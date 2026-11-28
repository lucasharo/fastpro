-- Catalogo da auditoria para as acoes do console de moderacao (20261124110000): a auditoria recusa acao fora dele.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('moderation.report.decided', 'chat_report', false, array['status'],
   'Denuncia do chat decidida pelo moderador no console (resolvida ou descartada)'),
  ('moderation.review.hidden', 'review', false, array['visivel'],
   'Avaliacao ocultada pelo moderador (sai do perfil publico e da media)'),
  ('moderation.review.shown', 'review', false, array['visivel'],
   'Avaliacao publicada de novo pelo moderador')
on conflict (action, object_type) do nothing;
