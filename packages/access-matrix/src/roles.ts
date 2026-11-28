// H-115 (Issue 124) | Principais de teste e seus contextos de sessao (desenho §3.3).
// Copia congelada dos papeis administrativos de packages/domain/src/admin/roles.ts (H-102). A igualdade
// com o dominio e provada em apps/api/tests (access-matrix-domain-parity), nao aqui (sem dependencia).
import type { AccessPrincipal } from './types.js';

export const ADMIN_ROLE_IDS = [
  'superadmin',
  'verificacao',
  'moderador',
  'financeiro',
  'suporte',
  'auditor',
  'governanca_dados',
] as const;

/** Espelho de ADMIN_ROLE_PERMISSIONS (dominio). Superadmin nao herda as demais permissoes. */
export const ADMIN_ROLE_PERMISSIONS_MIRROR: Readonly<Record<(typeof ADMIN_ROLE_IDS)[number], readonly string[]>> = {
  superadmin: ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive', 'ops.panel.read'],
  verificacao: ['verification.review'],
  moderador: ['moderation.decide', 'account.suspend.approve'],
  financeiro: ['finance.refund.request', 'finance.refund.approve'],
  suporte: ['support.completion.correct', 'case.open_sensitive', 'account.suspend.request'],
  auditor: ['audit.read'],
  governanca_dados: ['retention.policy.manage', 'retention.hold.manage'],
};

const adminPrincipal = (
  id: string,
  role: (typeof ADMIN_ROLE_IDS)[number],
  description: string,
): AccessPrincipal => ({
  id,
  description,
  principalType: 'admin',
  aal: 'aal2',
  permissions: ADMIN_ROLE_PERMISSIONS_MIRROR[role],
});

export const ACCESS_PRINCIPALS: Readonly<Record<string, AccessPrincipal>> = Object.freeze({
  anonymous: { id: 'anonymous', description: 'Visitante sem sessao', principalType: 'anonymous', aal: 'aal0' },
  customer_owner: { id: 'customer_owner', description: 'Cliente dono do pedido', principalType: 'customer', aal: 'aal1' },
  customer_other: { id: 'customer_other', description: 'Outro cliente', principalType: 'customer', aal: 'aal1' },
  pro_eligible: { id: 'pro_eligible', description: 'Profissional elegivel, sem aceite', principalType: 'professional', aal: 'aal1' },
  pro_ineligible_unapproved: {
    id: 'pro_ineligible_unapproved',
    description: 'Profissional com verificacao pendente ou recusada',
    principalType: 'professional',
    aal: 'aal1',
  },
  pro_ineligible_expired: {
    id: 'pro_ineligible_expired',
    description: 'Profissional com assinatura expirada ou trial encerrado',
    principalType: 'professional',
    aal: 'aal1',
  },
  pro_ineligible_geo: {
    id: 'pro_ineligible_geo',
    description: 'Profissional fora da area de atendimento',
    principalType: 'professional',
    aal: 'aal1',
  },
  pro_participant: { id: 'pro_participant', description: 'Profissional com aceite ativo', principalType: 'professional', aal: 'aal1' },
  pro_participant_withdrawn: {
    id: 'pro_participant_withdrawn',
    description: 'Profissional que retirou o aceite',
    principalType: 'professional',
    aal: 'aal1',
  },
  pro_other: { id: 'pro_other', description: 'Outro profissional', principalType: 'professional', aal: 'aal1' },
  pro_owner: { id: 'pro_owner', description: 'Profissional dono do proprio documento', principalType: 'professional', aal: 'aal1' },
  admin_superadmin: adminPrincipal('admin_superadmin', 'superadmin', 'Superadmin'),
  admin_verificacao: adminPrincipal('admin_verificacao', 'verificacao', 'Verificacao'),
  admin_moderador: adminPrincipal('admin_moderador', 'moderador', 'Moderador'),
  admin_financeiro: adminPrincipal('admin_financeiro', 'financeiro', 'Financeiro'),
  admin_suporte: adminPrincipal('admin_suporte', 'suporte', 'Suporte'),
  admin_auditor: adminPrincipal('admin_auditor', 'auditor', 'Auditor'),
  admin_governanca_dados: adminPrincipal('admin_governanca_dados', 'governanca_dados', 'Governanca de dados'),
  admin_no_mfa: {
    id: 'admin_no_mfa',
    description: 'Admin com sessao sem segundo fator (aal1)',
    principalType: 'admin',
    aal: 'aal1',
    permissions: ADMIN_ROLE_PERMISSIONS_MIRROR.verificacao,
  },
  app_system: { id: 'app_system', description: 'Processo do sistema (jobs)', principalType: 'system', aal: 'aal0' },
});
