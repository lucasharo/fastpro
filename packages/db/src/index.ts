export const PACKAGE_NAME = '@fastpro/db' as const;

export * from './platform.js';
export * from './audit.js';
export * from './jobs-tick.js';
export * from './notifications.js';
export * from './challenge-consume.js';
// H-014 | Repositorio da sessao de 7 dias (funcoes private.app_session_*).
export * from './session.js';
// H-104 (Issue 113) | Adaptadores Pg da consulta a auditoria (private.audit_query).
export * from './admin-audit.js';
// H-073 (Issue 83) | Adaptadores Pg do caso de acesso excepcional e do step-up da sessao admin.
export * from './admin-access-case.js';
// H-073 (Issue 83) / H-015 | Limites de tentativas do login admin (rl_check e rl_hit) e HMAC das chaves.
export * from './admin-login-limits.js';
export { challengeHmacHex, loadChallengeKey } from './challenges-crypto.js';
// H-097 (Issue 107) | Pedido de acesso, envio do login com prioridade e diretorio do desafio (challenges.ts).
export {
  ACCESS_TEMPLATE_KEY,
  ChallengeEmailProvider,
  ChallengeRecipientDirectory,
  PgChallengeStore,
  dispatchChallengeOutbox,
  requestChallenge,
  verifyChallengeCode,
  type ChallengeEmailOptions,
  type ChallengeHttpResponse,
  type ChallengeSecrets,
  type ChallengeStore,
  type CreateChallengeInput,
  type CreateChallengeResult,
  type OutboxDispatchPort,
  type RateContext,
  type RequestChallengeDeps,
  type VerifyChallengeDeps,
} from './challenges.js';

// H-019 | Adaptadores Pg da busca de servico (limite de taxa e transacao curta).
export * from './catalog-search.js';
// H-016 | Adaptador do cadastro, verificacao e login por senha do profissional.
export * from './professional-auth.js';
// H-016 | Contador de envios do cadastro e do reenvio sobre ops.rate_counter (rl_check e rl_hit).
export * from './professional-send-limit.js';
// H-016 | Adaptadores da conta do profissional, da recuperacao e da troca de senha (funcoes private.*).
export * from './professional-account.js';
export * from './professional-recovery.js';
export * from './professional-password.js';
// H-035 | Adaptador Pg do cadastro do documento do perfil profissional (private.professional_profile_set_document).
export * from './professional-profile.js';
// H-108 (Issue 117) | Adaptador Pg da leitura do painel operacional (private.ops_panel_read).
export * from './admin-ops-panel.js';
// H-107 (Issue 116) | Adaptador Pg da gestao do catalogo (private.catalog_admin_list, *_save, catalog_revision_list).
export * from './catalog-admin.js';
// H-105 (Issue 114) | Adaptador Pg da dupla aprovacao de estorno e suspensao (private.approval_dual_*).
export * from './admin-dual-approval.js';
export * from './request-draft.js';
// H-031 (#44) | Adaptador Pg da publicacao idempotente do pedido (private.* do servico, 110-DESENHO-H031 §4).
export * from './request-publish.js';
// Issue 45 (H-032) | Adaptador Pg da leitura do pedido por papel (dono e profissional elegivel).
export * from './request-visibility.js';
// H-026 | Adaptadores da quarentena de fotos (media_* e Storage quarantine).
export * from './media-quarantine.js';
// H-029 (Issue #42) | Galeria do dono: consulta, exclusao, reordenacao e leitura da versao reduzida.
export * from './media-gallery.js';
// H-109 (Issue 118) | Adaptador Pg da politica de retencao e do hold (private.retention_*, private.legal_hold_*).
export * from './retention-store.js';

// H-036 | Oferta do perfil profissional (servicos, base e raio) e adaptador da porta de coordenada.
export * from './professional-offering.js';
export * from './geo-point-store.js';
// H-017 (Issue #30) | Auditoria da recusa de exclusividade de papeis (private.audit_append).
export * from './role-exclusivity.js';
// H-110 (Issue 119) | Expurgos operacionais: adaptador Pg, Storage da quarentena e job ops.purge.
export * from './ops-purge-store.js';
export * from './ops-purge-jobs.js';
export * from './ops-purge-storage.js';
// H-037 (Issue #50) | Documentos de identidade: adaptador Pg (app_system) e Storage (identity-incoming e identity-docs).
export * from './identity-docs.js';
export * from './identity-docs-storage.js';
// H-045 (Issue 58) | Adaptador Pg do acesso comercial derivado (private.commercial_access, somente leitura).
export * from './commercial-access.js';
// H-044 (Issue 57) | Adaptador Pg da ativacao do trial (private.trial_activate, somente escrita por funcao).
export * from './trial-activation.js';
// H-046 (Issue 59) | Adaptador Pg de planos e precos (private.plan_price_at, somente leitura).
export * from './plan-pricing.js';
export * from './discovery-requests.js';
// Issue 68 (H-055) | Adaptadores da lista do profissional: projecao, limite de taxa e fotos prontas (153 §5.2, §5.3).
export * from './discovery-projection.js';
export * from './discovery-rate-limit.js';
export * from './discovery-photos.js';
// Issue 37 (H-024) | Adaptador Pg da cobertura booleana (private.coverage_for_request, so com ou sem).
export * from './coverage-requests.js';
// Issue 46 (H-033) | Adaptador do telefone e do consentimento (docs/factory/129-DESENHO-H033.md, §5).
export * from './contact-consent.js';
// Issue 55 (H-042) | Adaptador Pg da guarda de elegibilidade (private.professional_access_guard).
export * from './professional-access.js';
// Issue 47 (H-034) | Adaptador Pg da lista do painel do cliente.
export * from './request-list.js';
export * from './privacy-dsr-jobs.js';
export * from './privacy-dsr-extrato.js';
