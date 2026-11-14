// Issue 45 (H-032) | Leitura do pedido por papel (docs/factory/127-DESENHO-H032.md, §6.2, §6.3, §6.4, §10).
// Sem HTTP. O dono recebe o corpo fechado com o endereco decifrado; o profissional elegivel recebe o corpo
// da RN-10 sem decifrar nada. Toda recusa (id mal formado, pedido de outro, inexistente, fechado, fora do raio,
// profissional nao aprovado) sai como a MESMA resposta 404 (corpo constante). Erro de banco ou de cifra vira
// codigo fixo: nunca o texto do endereco, da chave ou da mensagem do driver.
import {
  ELIGIBLE_PROFESSIONAL_KEYS,
  OWNER_KEYS,
  coverageFlag,
  coverageIsOpen,
  type CoverageFlag,
  type CoverageResult,
} from '@fastpro/domain';
import type { OwnerRequestRow, ProfessionalRequestRow } from '@fastpro/db';
import type { AddressVault } from './address-crypto.js';

/** Corpo constante da recusa: igual para todos os motivos de 404 (§6.3). */
export const PEDIDO_NAO_ENCONTRADO_BODY = { code: 'pedido_nao_encontrado' } as const;
/** Erro fixo do banco de leitura (§6.4). */
export const LEITURA_INDISPONIVEL_BODY = { code: 'visibilidade_indisponivel' } as const;
/** Erro fixo da decifragem: falha fechada, nunca devolve o pedido parcial (§3, §10.2). */
export const ENDERECO_INDISPONIVEL_BODY = { code: 'endereco_indisponivel' } as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DetailOutcome =
  | { readonly status: 200; readonly body: Readonly<Record<string, unknown>> }
  | { readonly status: 404; readonly body: typeof PEDIDO_NAO_ENCONTRADO_BODY }
  | { readonly status: 503; readonly body: typeof LEITURA_INDISPONIVEL_BODY | typeof ENDERECO_INDISPONIVEL_BODY };

/** Porta de leitura (implementada por PgRequestVisibilityStore). */
export interface VisibilityStorePort {
  readOwner(userId: string, requestId: string): Promise<OwnerRequestRow | null>;
  readProfessional(professionalId: string, requestId: string, nowMs: number): Promise<ProfessionalRequestRow | null>;
}

/**
 * Porta da cobertura do dono (Issue 37, H-024). Só a leitura do dono a usa; o profissional nunca chega a ela.
 * `ipKey` recebe o IP em claro e devolve o HMAC de 64 caracteres (ADR-014): o IP nunca vai ao banco.
 */
export interface CoverageReaderPort {
  coverageFor(entrada: { requestId: string; customerId: string; ipKey: string; now: Date }): Promise<CoverageResult>;
  ipKey(ip: string): string;
}

export interface DetailServiceDeps {
  readonly store: VisibilityStorePort;
  readonly addressVault: AddressVault;
  readonly clock: { nowMs(): number };
  /** Ausente: o campo `cobertura` do pedido aberto sai como null (sem consulta, sem IP). */
  readonly cobertura?: CoverageReaderPort;
}

const NAO_ENCONTRADO: DetailOutcome = { status: 404, body: PEDIDO_NAO_ENCONTRADO_BODY };
const LEITURA_FALHOU: DetailOutcome = { status: 503, body: LEITURA_INDISPONIVEL_BODY };

/** Monta o corpo somente com as chaves da lista fechada, na ordem dela. */
function recorte(origem: object, chaves: readonly string[]): Record<string, unknown> {
  const valores = origem as Record<string, unknown>;
  const corpo: Record<string, unknown> = {};
  for (const chave of chaves) corpo[chave] = valores[chave];
  return corpo;
}

/**
 * Campo `cobertura` do dono (Issue 37, CA-08, CA-07): só pedido aberto tem o campo. Sem porta, ou com falha da
 * consulta, ou com limite excedido, sai null: sem número, sem detalhe e sem derrubar o restante do pedido.
 */
async function coberturaDoDono(
  linha: OwnerRequestRow,
  userId: string,
  ip: string,
  deps: DetailServiceDeps,
  agora: number,
): Promise<CoverageFlag | undefined> {
  if (!coverageIsOpen(linha.status, Date.parse(linha.acceptanceDeadlineAt), agora)) return undefined;
  if (deps.cobertura === undefined) return null;
  try {
    const resultado = await deps.cobertura.coverageFor({
      requestId: linha.id,
      customerId: userId,
      ipKey: deps.cobertura.ipKey(ip),
      now: new Date(agora),
    });
    return coverageFlag(resultado);
  } catch {
    return null;
  }
}

/** Leitura do dono (GET /v1/requests/:id). Decifra o endereco com o id do pedido como dado associado. */
export async function readRequestAsOwner(
  userId: string,
  requestId: string,
  deps: DetailServiceDeps,
  ip = 'desconhecido',
): Promise<DetailOutcome> {
  if (!UUID_RE.test(requestId)) return NAO_ENCONTRADO;
  let linha: OwnerRequestRow | null;
  try {
    linha = await deps.store.readOwner(userId, requestId);
  } catch {
    return LEITURA_FALHOU;
  }
  if (linha === null) return NAO_ENCONTRADO;

  let addressText: string | null;
  if (linha.addressEnc !== null) {
    try {
      addressText = deps.addressVault.open(linha.addressEnc, linha.id);
    } catch {
      return { status: 503, body: ENDERECO_INDISPONIVEL_BODY };
    }
  } else {
    addressText = linha.addressTextLegado;
  }
  const cobertura = await coberturaDoDono(linha, userId, ip, deps, deps.clock.nowMs());
  const corpo = recorte({ ...linha, addressText, cobertura }, OWNER_KEYS);
  if (cobertura === undefined) delete corpo.cobertura;
  return { status: 200, body: corpo };
}

/** Leitura do profissional elegivel (GET /v1/pro/requests/:id). Nao decifra nada: o endereco nunca sai. */
export async function readRequestAsProfessional(
  professionalId: string,
  requestId: string,
  deps: DetailServiceDeps,
): Promise<DetailOutcome> {
  if (!UUID_RE.test(requestId)) return NAO_ENCONTRADO;
  const agora = deps.clock.nowMs();
  let linha: ProfessionalRequestRow | null;
  try {
    linha = await deps.store.readProfessional(professionalId, requestId, agora);
  } catch {
    return LEITURA_FALHOU;
  }
  if (linha === null) return NAO_ENCONTRADO;
  return { status: 200, body: recorte(linha, ELIGIBLE_PROFESSIONAL_KEYS) };
}
