// H-115 (Issue 124) | Matriz de acesso: lista imutavel de casos (desenho §3.2 e §3.3).
// CP-01 a CP-26 vem do refino 161-REFINO-H115.md (secao de cenarios). CP-27 a CP-35 cobrem CA-H115
// que os CP originais deixam sem caso. Casos `deferred` dependem de Issues ainda nao concluidas.
// Nota: os codigos de erro seguem o refino; a F3 confirma cada um contra as rotas reais.
import {
  ELIGIBLE_PROFESSIONAL_KEYS,
  FORBIDDEN_FOR_PROFESSIONAL,
  OWNER_FORBIDDEN,
  OWNER_KEYS,
  PARTICIPANT_KEYS,
} from './projections.js';
import { ACCESS_PRINCIPALS } from './roles.js';
import { ACCESS_RESOURCES } from './resources.js';
import type { AccessCase, DbExpectation, HttpExpectation } from './types.js';

const OWNER_REVEAL = { kind: 'rows', minRows: 1, forbiddenColumns: OWNER_FORBIDDEN } as const satisfies DbExpectation;
const PRO_REVEAL = { kind: 'rows', minRows: 1, forbiddenColumns: FORBIDDEN_FOR_PROFESSIONAL } as const satisfies DbExpectation;
const NO_ROWS = { kind: 'no_rows' } as const satisfies DbExpectation;
const DENIED = { kind: 'denied', sqlstate: '42501' } as const satisfies DbExpectation;

const http200 = (mustHaveKeys: readonly string[], mustNotHaveKeys: readonly string[]): HttpExpectation => ({
  status: 200,
  mustHaveKeys,
  mustNotHaveKeys,
});
const http404 = (code = 'recurso_nao_encontrado'): HttpExpectation => ({ status: 404, code });

const GET_REQUEST = { method: 'GET', path: '/v1/requests/:id' } as const;
const GET_PRO_REQUEST = { method: 'GET', path: '/v1/professional/requests/:id' } as const;
const GET_DISCOVERY = { method: 'GET', path: '/v1/professional/discovery/requests' } as const;
const GET_VERIFICATION_CASES = { method: 'GET', path: '/v1/admin/verificacao/casos' } as const;
const POST_AUDIT_QUERY = { method: 'POST', path: '/v1/admin/audit/query' } as const;

const CA = (...n: number[]): string[] => n.map((i) => `CA-H115-${String(i).padStart(2, '0')}`);

export const ACCESS_MATRIX: readonly AccessCase[] = Object.freeze([
  // --- Pedido do dono e de outros clientes ---
  {
    id: 'CP-01', resource: 'request', action: 'read', principal: 'customer_owner',
    condition: 'pedido publicado do proprio usuario',
    criteria: CA(8), invariants: ['I-16'], layers: ['api', 'db'],
    route: GET_REQUEST, http: http200(OWNER_KEYS, OWNER_FORBIDDEN), db: OWNER_REVEAL,
    probe: { kind: 'function_call', fn: 'private.request_owner_get', args: ['$principal.id', '$request.own_published'] },
    status: 'active',
  },
  {
    id: 'CP-02', resource: 'request', action: 'read', principal: 'customer_other',
    condition: 'pedido de outro cliente (IDOR)',
    criteria: CA(5), invariants: [], layers: ['api', 'db'],
    route: GET_REQUEST, http: http404(), db: NO_ROWS,
    probe: { kind: 'function_call', fn: 'private.request_owner_get', args: ['$principal.id', '$request.other_owner'] },
    status: 'active',
  },
  {
    id: 'CP-03', resource: 'request', action: 'read', principal: 'anonymous',
    condition: 'sem sessao de autenticacao',
    criteria: CA(3), invariants: [], layers: ['api', 'db'],
    route: GET_REQUEST, http: { status: 401, code: 'sessao_necessaria' }, db: DENIED,
    probe: { kind: 'function_call', fn: 'private.request_owner_get', args: ['null', '$request.own_published'] },
    status: 'active',
  },
  // --- Visao do profissional ---
  {
    id: 'CP-04', resource: 'professional_request_view', action: 'read', principal: 'pro_eligible',
    condition: 'pedido no raio, profissional elegivel sem aceite',
    criteria: CA(9), invariants: ['I-16'], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http200(ELIGIBLE_PROFESSIONAL_KEYS, FORBIDDEN_FOR_PROFESSIONAL), db: PRO_REVEAL,
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.in_radius'] },
    status: 'active',
  },
  {
    id: 'CP-05', resource: 'professional_request_view', action: 'read', principal: 'pro_ineligible_unapproved',
    condition: 'verificacao pendente ou recusada',
    criteria: CA(9), invariants: [], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http404(), db: NO_ROWS,
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.in_radius'] },
    status: 'active',
  },
  {
    id: 'CP-06', resource: 'professional_request_view', action: 'read', principal: 'pro_participant',
    condition: 'aceite ativo no pedido: chaves de participante com primeiro nome',
    criteria: CA(9), invariants: ['I-16'], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http200(PARTICIPANT_KEYS, FORBIDDEN_FOR_PROFESSIONAL),
    db: { kind: 'rows', minRows: 1, forbiddenColumns: FORBIDDEN_FOR_PROFESSIONAL },
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.accepted'] },
    status: 'deferred', requiresRelation: 'app.acceptance', deferredBy: ['#71'],
  },
  {
    id: 'CP-07', resource: 'contact_consent', action: 'reveal', principal: 'pro_participant',
    condition: 'pedido com opt-in de telefone: revelacao pela funcao auditada',
    criteria: CA(12), invariants: ['I-16'], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.contact_reveal_phone', args: ['$principal.id', '$request.phone_optin'] },
    db: { kind: 'rows', minRows: 1 },
    status: 'deferred', requiresRelation: 'app.acceptance', deferredBy: ['#71'],
  },
  {
    id: 'CP-08', resource: 'contact_consent', action: 'reveal', principal: 'pro_participant',
    condition: 'pedido sem opt-in de telefone',
    criteria: CA(12), invariants: ['I-16'], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.contact_reveal_phone', args: ['$principal.id', '$request.no_phone_optin'] },
    db: NO_ROWS,
    status: 'deferred', requiresRelation: 'app.acceptance', deferredBy: ['#71'],
  },
  {
    id: 'CP-09', resource: 'contact_consent', action: 'reveal', principal: 'pro_eligible',
    condition: 'elegivel sem aceite: telefone omitido',
    criteria: CA(12), invariants: ['I-16'], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.contact_reveal_phone', args: ['$principal.id', '$request.phone_optin'] },
    db: NO_ROWS,
    status: 'active',
  },
  {
    id: 'CP-10', resource: 'professional_request_view', action: 'read', principal: 'pro_eligible',
    condition: 'nenhuma resposta a profissional contem e-mail nem sentinela de PII',
    criteria: CA(11), invariants: ['I-16'], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http200(ELIGIBLE_PROFESSIONAL_KEYS, FORBIDDEN_FOR_PROFESSIONAL), db: PRO_REVEAL,
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.in_radius'] },
    status: 'active',
  },
  {
    id: 'CP-11', resource: 'professional_request_view', action: 'read', principal: 'pro_participant',
    condition: 'participante sem address_share: endereco completo omitido',
    criteria: CA(13), invariants: [], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http200(PARTICIPANT_KEYS, FORBIDDEN_FOR_PROFESSIONAL), db: PRO_REVEAL,
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.accepted'] },
    status: 'deferred', requiresRelation: 'app.address_share', deferredBy: ['#71', '#84'],
  },
  {
    id: 'CP-12', resource: 'professional_request_view', action: 'read', principal: 'pro_participant',
    condition: 'participante com address_share ativo',
    criteria: CA(13), invariants: [], layers: ['api', 'db'],
    route: GET_PRO_REQUEST, http: http200(PARTICIPANT_KEYS, []), db: { kind: 'rows', minRows: 1 },
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.address_shared'] },
    status: 'deferred', requiresRelation: 'app.address_share', deferredBy: ['#71', '#84'],
  },
  // --- Descoberta ---
  {
    id: 'CP-13', resource: 'request_discovery', action: 'list', principal: 'pro_eligible',
    condition: 'pedidos abertos no raio de atendimento',
    criteria: CA(9, 13), invariants: ['I-16'], layers: ['api', 'db'],
    route: GET_DISCOVERY, http: { status: 200, mustNotHaveKeys: FORBIDDEN_FOR_PROFESSIONAL },
    db: { kind: 'rows', minRows: 1, forbiddenColumns: FORBIDDEN_FOR_PROFESSIONAL },
    probe: { kind: 'function_call', fn: 'private.discover_requests', args: ['$principal.id', '$radius.default'] },
    status: 'active',
  },
  {
    id: 'CP-14', resource: 'request_discovery', action: 'list', principal: 'pro_ineligible_expired',
    condition: 'assinatura expirada ou trial encerrado: silencio financeiro',
    criteria: CA(9), invariants: [], layers: ['api', 'db'],
    route: GET_DISCOVERY, http: { status: 200, mustNotHaveKeys: [], emptyItems: true }, db: NO_ROWS,
    probe: { kind: 'function_call', fn: 'private.discover_requests', args: ['$principal.id', '$radius.default'] },
    status: 'active',
  },
  // --- Rascunho e fotos ---
  {
    id: 'CP-15', resource: 'request_draft', action: 'read', principal: 'customer_other',
    condition: 'rascunho de outro cliente (IDOR); rota de rascunho confirmada na F3',
    criteria: CA(5), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.draft_get', args: ['$principal.id', '$draft.other_owner'] },
    db: NO_ROWS,
    status: 'active',
  },
  {
    id: 'CP-16', resource: 'request_media', action: 'read', principal: 'pro_eligible',
    condition: 'foto para profissional elegivel: acesso so pela API',
    criteria: CA(9), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.media_get', args: ['$principal.id', '$media.eligible'] },
    db: { kind: 'rows', minRows: 1 },
    status: 'active',
  },
  {
    id: 'CP-17', resource: 'request_media', action: 'read', principal: 'anonymous',
    condition: 'visitante sem login: storage nega acesso',
    criteria: CA(3), invariants: [], layers: ['db', 'catalog'],
    probe: { kind: 'function_call', fn: 'private.media_get', args: ['null', '$media.eligible'] },
    db: DENIED,
    status: 'active',
  },
  // --- Documento de identidade ---
  {
    id: 'CP-18', resource: 'identity_document', action: 'read', principal: 'pro_owner',
    condition: 'profissional tentando baixar o proprio documento (decisao 170)',
    criteria: CA(10), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.idoc_review_target', args: ['$principal.id', '$document.own'] },
    db: NO_ROWS,
    status: 'active',
  },
  {
    id: 'CP-19', resource: 'identity_document', action: 'read', principal: 'admin_verificacao',
    condition: 'verificador com tarefa atribuida no caso',
    criteria: CA(10, 16), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.idoc_review_target', args: ['$principal.id', '$document.assigned'] },
    db: { kind: 'rows', minRows: 1 },
    status: 'active',
  },
  {
    id: 'CP-20', resource: 'identity_document', action: 'read', principal: 'admin_financeiro',
    condition: 'papel administrativo sem permissao de verificacao',
    criteria: CA(14), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.idoc_review_target', args: ['$principal.id', '$document.assigned'] },
    db: { kind: 'exception', sqlstate: 'P0001' }, // [NAO VERIFICADO] SQLSTATE real: confirmar na F4
    status: 'active',
  },
  // --- Admin: MFA, aprovacao e auditoria ---
  {
    id: 'CP-21', resource: 'verification_case', action: 'list', principal: 'admin_no_mfa',
    condition: 'sessao admin sem MFA (aal1)',
    criteria: CA(15), invariants: [], layers: ['api', 'db'],
    route: GET_VERIFICATION_CASES, http: { status: 403, code: 'mfa_obrigatorio' }, db: DENIED,
    probe: { kind: 'function_call', fn: 'private.admin_guard', args: ['$principal.id', 'aal1'] },
    status: 'active',
  },
  {
    id: 'CP-22', resource: 'approval', action: 'execute', principal: 'admin_superadmin',
    condition: 'superadmin tentando aprovar estorno (segregacao)',
    criteria: CA(17), invariants: [], layers: ['api', 'db'],
    route: { method: 'POST', path: '/v1/admin/approvals/:id/vote' },
    http: { status: 403, code: 'permissao_insuficiente' },
    db: { kind: 'exception', sqlstate: 'P0001' }, // [NAO VERIFICADO] SQLSTATE real: confirmar na F4
    probe: { kind: 'function_call', fn: 'private.approval_dual_vote', args: ['$principal.id', '$approval.refund'] },
    status: 'active',
  },
  {
    id: 'CP-23', resource: 'audit_event', action: 'list', principal: 'admin_auditor',
    condition: 'auditor consultando eventos',
    criteria: CA(18), invariants: [], layers: ['api', 'db'],
    route: POST_AUDIT_QUERY, http: { status: 200, mustNotHaveKeys: [] },
    db: { kind: 'rows', minRows: 0 },
    probe: { kind: 'function_call', fn: 'private.audit_query', args: ['$principal.id', '$audit.filter.empty'] },
    status: 'active',
  },
  {
    id: 'CP-24', resource: 'audit_event', action: 'write', principal: 'admin_auditor',
    condition: 'auditor tentando atualizar a trilha (append-only)',
    criteria: CA(18), invariants: [], layers: ['db'],
    probe: { kind: 'table_write', relation: 'audit.audit_event', verb: 'update' },
    db: DENIED,
    status: 'active',
  },
  {
    id: 'CP-25', resource: 'access_grant', action: 'read', principal: 'anonymous',
    condition: 'varredura: RLS forcada em todas as tabelas de dominio',
    criteria: CA(2), invariants: [], layers: ['catalog'],
    status: 'active',
  },
  {
    id: 'CP-26', resource: 'access_grant', action: 'execute', principal: 'anonymous',
    condition: 'varredura: search_path vazio em todas as funcoes SECURITY DEFINER',
    criteria: CA(19), invariants: [], layers: ['catalog'],
    status: 'active',
  },
  // --- Casos complementares (cobertura de CA-H115) ---
  {
    id: 'CP-27', resource: 'identity_document', action: 'read', principal: 'admin_verificacao',
    condition: 'verificador sem caso aberto: leitura negada',
    criteria: CA(16), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.idoc_review_target', args: ['$principal.id', '$document.no_case'] },
    db: NO_ROWS,
    status: 'active',
  },
  {
    id: 'CP-28', resource: 'professional_area', action: 'read', principal: 'pro_other',
    condition: 'area de atendimento de outro profissional',
    criteria: CA(6), invariants: [], layers: ['db'],
    probe: { kind: 'function_call', fn: 'private.professional_area_get', args: ['$principal.id', '$area.other_professional'] },
    db: NO_ROWS,
    status: 'active',
  },
  {
    id: 'CP-29', resource: 'conversation', action: 'read', principal: 'pro_participant',
    condition: 'conversa do pedido com aceite (chat)',
    criteria: CA(7), invariants: ['I-12'], layers: ['api', 'db'],
    requiresRelation: 'app.conversation', deferredBy: ['#71', '#76'],
    status: 'deferred', route: { method: 'GET', path: '/v1/conversations/:id' },
    http: http200([], []), db: { kind: 'rows', minRows: 1 },
    probe: { kind: 'table_select', relation: 'app.conversation' },
  },
  {
    id: 'CP-30', resource: 'message', action: 'create', principal: 'pro_participant',
    condition: 'mensagem em conversa de pedido com aceite (par legitimo)',
    criteria: CA(7), invariants: ['I-12'], layers: ['db'],
    requiresRelation: 'app.message', deferredBy: ['#77', '#136'],
    status: 'deferred',
    probe: { kind: 'table_write', relation: 'app.message', verb: 'insert' },
    db: { kind: 'rows', minRows: 1 },
  },
  {
    id: 'CP-31', resource: 'selection', action: 'update', principal: 'customer_owner',
    condition: 'selecao de participante pelo dono (#84)',
    criteria: CA(15), invariants: [], layers: ['db'],
    requiresRelation: 'app.selection', deferredBy: ['#84'],
    status: 'deferred',
    probe: { kind: 'table_write', relation: 'app.selection', verb: 'update' },
    db: { kind: 'rows', minRows: 1 },
  },
  {
    id: 'CP-32', resource: 'review', action: 'create', principal: 'pro_participant',
    condition: 'avaliacao sem vinculo de selecao (I-09)',
    criteria: CA(15), invariants: ['I-09'], layers: ['db'],
    requiresRelation: 'app.review', deferredBy: ['#96'],
    status: 'deferred',
    probe: { kind: 'table_write', relation: 'app.review', verb: 'insert' },
    db: DENIED,
  },
  {
    id: 'CP-33', resource: 'checkout', action: 'create', principal: 'customer_owner',
    condition: 'checkout sem concessao paga (#60)',
    criteria: CA(15), invariants: [], layers: ['db'],
    requiresRelation: 'billing.checkout', deferredBy: ['#60'],
    status: 'deferred',
    probe: { kind: 'table_write', relation: 'billing.checkout', verb: 'insert' },
    db: DENIED,
  },
  {
    id: 'CP-34', resource: 'professional_request_view', action: 'read', principal: 'pro_participant_withdrawn',
    condition: 'profissional que retirou o aceite: sem acesso de participante',
    criteria: CA(9), invariants: [], layers: ['api', 'db'],
    requiresRelation: 'app.acceptance', deferredBy: ['#73'],
    status: 'deferred', route: GET_PRO_REQUEST, http: http404(), db: NO_ROWS,
    probe: { kind: 'function_call', fn: 'private.request_detail_professional', args: ['$principal.id', '$request.withdrawn'] },
  },
  {
    id: 'CP-35', resource: 'professional_profile', action: 'update', principal: 'customer_owner',
    condition: 'autoatendimento no aceite (cliente aceitando o proprio pedido)',
    criteria: CA(5), invariants: [], layers: ['db'],
    requiresRelation: 'app.acceptance', deferredBy: ['#71'],
    status: 'deferred',
    probe: { kind: 'none' }, // sem funcao de aceite no DEV; a sonda entra quando a Issue #71 criar o aceite
    db: DENIED,
  },
]);

export function casesFor(filter: { principal?: string; resource?: string } = {}): readonly AccessCase[] {
  return ACCESS_MATRIX.filter(
    (c) =>
      (filter.principal === undefined || c.principal === filter.principal) &&
      (filter.resource === undefined || c.resource === filter.resource),
  );
}

export function activeCases(): readonly AccessCase[] {
  return ACCESS_MATRIX.filter((c) => c.status === 'active');
}

export function deferredCases(): readonly AccessCase[] {
  return ACCESS_MATRIX.filter((c) => c.status === 'deferred');
}

/** Permissao esperada: algum caso ativo com resposta de sucesso (HTTP 200/201 ou linhas no banco). */
export function canAccess(principal: string, resource: string, action: AccessCase['action']): boolean {
  return activeCases().some(
    (c) =>
      c.principal === principal &&
      c.resource === resource &&
      c.action === action &&
      ((c.http !== undefined && (c.http.status === 200 || c.http.status === 201)) || c.db?.kind === 'rows'),
  );
}

/** Checagem de referencia: todo principal e recurso citado existe nas tabelas de dados. */
export function unknownReferences(): readonly string[] {
  const out: string[] = [];
  for (const c of ACCESS_MATRIX) {
    if (!(c.principal in ACCESS_PRINCIPALS)) out.push(`${c.id}: principal ${c.principal}`);
    if (!(c.resource in ACCESS_RESOURCES)) out.push(`${c.id}: recurso ${c.resource}`);
  }
  return out;
}
