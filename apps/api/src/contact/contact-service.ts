// Issue 46 (H-033) | Casos de uso do telefone e do consentimento de contato (docs/factory/129-DESENHO-H033.md, §5, §6, §7, §9).
// Sem HTTP: cada funcao devolve um desfecho fechado (status e corpo). Toda recusa de pedido sai como o MESMO 404 da
// Issue 45 (PEDIDO_NAO_ENCONTRADO_BODY), por id inexistente, id de outro dono ou falta de direito. Falha da cifra
// ou do banco vira codigo fixo: nunca texto de driver, numero, blob ou chave na resposta.
import { CONTACT_CONSENT_VERSION, normalizePhoneBr } from '@fastpro/domain';
import type { OwnerContactStatus, RevealResult } from '@fastpro/db';
import { PEDIDO_NAO_ENCONTRADO_BODY } from '../requests/detail-service.js';
import type { PhoneVault } from './phone-crypto.js';

/** Porta do banco do contato (implementada por PgContactStore). */
export interface ContactStorePort {
  replacePhone(userId: string, requestId: string, phoneEnc: Uint8Array | null, nowMs: number): Promise<string>;
  grantProfessional(userId: string, requestId: string, professionalId: string, textVersion: string, nowMs: number): Promise<string>;
  revoke(userId: string, requestId: string, professionalId: string | null, nowMs: number): Promise<{ revoked: number; state: string }>;
  revealPhone(professionalId: string, requestId: string, nowMs: number): Promise<RevealResult | null>;
  availableForProfessional(professionalId: string, requestId: string, nowMs: number): Promise<boolean>;
  ownerStatus(userId: string, requestId: string): Promise<OwnerContactStatus | null>;
  ownerPhone(userId: string, requestId: string): Promise<Uint8Array | null>;
}

export interface ContactServiceDeps {
  readonly store: ContactStorePort;
  readonly phoneVault: Pick<PhoneVault, 'seal' | 'open'>;
  readonly clock: { nowMs(): number };
}

export type ContactOutcome =
  | { readonly status: 200 | 201; readonly body: Readonly<Record<string, unknown>> }
  | { readonly status: 204 }
  | { readonly status: 401 | 404 | 409 | 422 | 429 | 503; readonly body: Readonly<Record<string, unknown>> };

/** Resposta de recusa de pedido: a mesma da leitura do pedido (Issue 45). */
const NAO_ENCONTRADO: ContactOutcome = { status: 404, body: PEDIDO_NAO_ENCONTRADO_BODY };
const INDISPONIVEL: ContactOutcome = { status: 503, body: { code: 'indisponivel' } };

/** Telefone de contato: uma linha por consentimento, sem valor de telefone. */
function linhaDeConsentimento(c: OwnerContactStatus['consents'][number]): Record<string, unknown> {
  return {
    scope: c.scope,
    ...(c.professionalId !== null ? { professionalId: c.professionalId } : {}),
    grantedAt: c.grantedAt,
    grantedVia: c.grantedVia,
    ...(c.revokedAt !== null ? { revokedAt: c.revokedAt } : {}),
    ...(c.revokedReason !== null ? { revokedReason: c.revokedReason } : {}),
  };
}

/** Estado do telefone e das liberacoes para o dono. Sem telefone em claro. */
export async function estadoDoDono(userId: string, requestId: string, deps: ContactServiceDeps): Promise<ContactOutcome> {
  const estado = await deps.store.ownerStatus(userId, requestId);
  if (estado === null) return NAO_ENCONTRADO;
  return { status: 200, body: { phonePresent: estado.phonePresent, consents: estado.consents.map(linhaDeConsentimento) } };
}

/** Leitura do proprio telefone pelo dono (so para pre-preencher a republicacao). */
export async function telefoneDoDono(userId: string, requestId: string, deps: ContactServiceDeps): Promise<ContactOutcome> {
  const blob = await deps.store.ownerPhone(userId, requestId);
  if (blob === null) return NAO_ENCONTRADO;
  try {
    return { status: 200, body: { phone: deps.phoneVault.open(blob, requestId) } };
  } catch {
    return INDISPONIVEL;
  }
}

/** Troca (telefone novo) ou apaga (null) o telefone. O banco revoga as liberacoes ativas (gatilho). */
export async function definirTelefone(
  userId: string,
  requestId: string,
  telefone: string | null,
  deps: ContactServiceDeps,
): Promise<ContactOutcome> {
  let blob: Uint8Array | null = null;
  if (telefone !== null) {
    const e164 = normalizePhoneBr(telefone);
    if (e164 === null) return { status: 422, body: { code: 'telefone_invalido' } };
    try {
      blob = deps.phoneVault.seal(e164, requestId);
    } catch {
      return INDISPONIVEL;
    }
  }
  const estado = await deps.store.replacePhone(userId, requestId, blob, deps.clock.nowMs());
  if (estado === 'trocado' || estado === 'apagado') return { status: 204 };
  if (estado === 'pedido_inexistente') return NAO_ENCONTRADO;
  return INDISPONIVEL;
}

/** Liberacao individual no chat (ou no pedido) para um profissional. */
export async function liberarProfissional(
  userId: string,
  requestId: string,
  professionalId: string,
  deps: ContactServiceDeps,
): Promise<ContactOutcome> {
  const estado = await deps.store.grantProfessional(userId, requestId, professionalId, CONTACT_CONSENT_VERSION, deps.clock.nowMs());
  if (estado === 'liberado') return { status: 201, body: { state: estado } };
  if (estado === 'ja_liberado' || estado === 'coberto_pelo_geral') return { status: 200, body: { state: estado } };
  if (estado === 'pedido_inexistente') return NAO_ENCONTRADO;
  if (estado === 'sem_aceite' || estado === 'sem_telefone' || estado === 'pedido_fechado') {
    return { status: 409, body: { code: estado } };
  }
  return INDISPONIVEL;
}

/** Revogacao: geral (professionalId nulo) ou individual. Quem so esta coberto pelo geral recebe exige_revogar_geral. */
export async function revogarLiberacao(
  userId: string,
  requestId: string,
  professionalId: string | null,
  deps: ContactServiceDeps,
): Promise<ContactOutcome> {
  const resultado = await deps.store.revoke(userId, requestId, professionalId, deps.clock.nowMs());
  if (resultado.state === 'pedido_inexistente') return NAO_ENCONTRADO;
  if (resultado.state === 'exige_revogar_geral') return { status: 409, body: { code: 'exige_revogar_geral' } };
  if (resultado.state !== 'revogado') return INDISPONIVEL;
  return { status: 200, body: { revoked: resultado.revoked } };
}

/** Disponibilidade para o botao "ver telefone". Falso e igual para qualquer recusa (sem aceite, sem consentimento, sem direito). */
export async function telefoneDisponivel(professionalId: string, requestId: string, deps: ContactServiceDeps): Promise<ContactOutcome> {
  const ok = await deps.store.availableForProfessional(professionalId, requestId, deps.clock.nowMs());
  return { status: 200, body: { phoneAvailable: ok } };
}

/** Revelacao ao profissional. Negada = 404 uniforme; estouro de leituras = 429 (o banco registra o log so quando libera). */
export async function revelarTelefone(professionalId: string, requestId: string, deps: ContactServiceDeps): Promise<ContactOutcome> {
  const r = await deps.store.revealPhone(professionalId, requestId, deps.clock.nowMs());
  if (r === null) return NAO_ENCONTRADO;
  if (r.limited) return { status: 429, body: { code: 'limite_de_leituras' } };
  if (r.phoneEnc === null) return NAO_ENCONTRADO;
  try {
    return { status: 200, body: { phone: deps.phoneVault.open(r.phoneEnc, requestId) } };
  } catch {
    return INDISPONIVEL;
  }
}
