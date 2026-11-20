// H-115 (Issue 124) | Recursos da matriz (desenho §3.1 e §3.3). Relacoes conferidas no DEV em
// 166-INVENTARIO-H115.md. Recursos de entidades futuras ficam como `deferred` nos casos.
import type { AccessResource } from './types.js';

export const ACCESS_RESOURCES: Readonly<Record<string, AccessResource>> = Object.freeze({
  request: {
    key: 'request',
    relation: 'app.service_request',
    routes: ['GET /v1/requests', 'GET /v1/requests/:id'],
    sensitivity: 'C2',
  },
  professional_request_view: {
    key: 'professional_request_view',
    relation: 'app.service_request',
    routes: ['GET /v1/professional/requests/:id'],
    sensitivity: 'C2',
  },
  request_discovery: {
    key: 'request_discovery',
    relation: 'app.service_request',
    routes: ['GET /v1/professional/discovery/requests'],
    sensitivity: 'C2',
  },
  request_draft: {
    key: 'request_draft',
    relation: 'app.request_draft',
    routes: [],
    sensitivity: 'C1',
  },
  request_media: {
    key: 'request_media',
    relation: 'app.media_asset',
    routes: [],
    sensitivity: 'C3',
  },
  contact_consent: {
    key: 'contact_consent',
    relation: 'app.contact_consent',
    routes: [],
    sensitivity: 'C3',
  },
  professional_profile: {
    key: 'professional_profile',
    relation: 'app.professional_profile',
    routes: ['GET /v1/professional/profile'],
    sensitivity: 'C2',
  },
  professional_area: {
    key: 'professional_area',
    relation: 'app.professional_area',
    routes: ['GET /v1/professional/profile/area'],
    sensitivity: 'C2',
  },
  identity_document: {
    key: 'identity_document',
    relation: 'app.identity_document',
    routes: [],
    sensitivity: 'C4',
  },
  verification_case: {
    key: 'verification_case',
    relation: 'app.verification_case',
    routes: ['GET /v1/admin/verificacao/casos', 'GET /v1/admin/verificacao/casos/:id'],
    sensitivity: 'C3',
  },
  access_grant: {
    key: 'access_grant',
    relation: 'billing.access_grant',
    routes: [],
    sensitivity: 'C2',
  },
  audit_event: {
    key: 'audit_event',
    relation: 'audit.audit_event',
    routes: ['POST /v1/admin/audit/query'],
    sensitivity: 'C3',
  },
  admin_access_case: {
    key: 'admin_access_case',
    relation: 'app.access_case',
    routes: [],
    sensitivity: 'C3',
  },
  approval: {
    key: 'approval',
    relation: 'app.approval_request',
    routes: [],
    sensitivity: 'C2',
  },
  catalog_admin: {
    key: 'catalog_admin',
    relation: 'app.service_group',
    routes: ['GET /v1/admin/catalog'],
    sensitivity: 'C0',
  },
  ops_panel: {
    key: 'ops_panel',
    relation: 'ops.ops_metric',
    routes: ['GET /v1/admin/ops/panel'],
    sensitivity: 'C1',
  },
  retention: {
    key: 'retention',
    relation: 'app.retention_policy',
    routes: ['GET /v1/admin/retention'],
    sensitivity: 'C2',
  },
  public_professional: {
    key: 'public_professional',
    relation: 'app.professional_profile',
    routes: ['GET /v1/public/professionals/:slug'],
    sensitivity: 'C0',
  },
  // Entidades futuras (deferred): a relacao ainda nao existe no DEV.
  conversation: { key: 'conversation', relation: 'app.conversation', routes: [], sensitivity: 'C3' },
  message: { key: 'message', relation: 'app.message', routes: [], sensitivity: 'C3' },
  selection: { key: 'selection', relation: 'app.selection', routes: [], sensitivity: 'C2' },
  review: { key: 'review', relation: 'app.review', routes: [], sensitivity: 'C2' },
  checkout: { key: 'checkout', relation: 'billing.checkout', routes: [], sensitivity: 'C2' },
});
