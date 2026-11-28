// H-045 (Issue 58) | Porta e leitura do acesso comercial derivado (docs/factory/114-DESENHO-H045.md, §4 a §6).
// O estado nao e gravado: o banco o deriva na leitura (private.commercial_access). O instante vem do relogio
// injetado (CA-H045-05), nunca de now() do banco ou de Date.now() escondido. Erros viram codigos fixos.
import { ESTADOS_ACESSO_COMERCIAL, type AcessoComercial, type EstadoAcessoComercial } from './types.js';

/** Porta de leitura: a implementacao em banco fica em packages/db (createPgCommercialAccess). */
export interface CommercialAccessPort {
  read(professionalId: string, at: Date): Promise<AcessoComercial>;
}

/** Relogio injetado. Os testes e os consumidores passam um relogio controlado. */
export interface Clock {
  now(): Date;
}

export type CommercialAccessErrorCode =
  | 'acesso_comercial_profissional_invalido'
  | 'acesso_comercial_relogio_invalido'
  | 'acesso_comercial_invalido'
  | 'acesso_comercial_indisponivel';

export class CommercialAccessError extends Error {
  constructor(readonly code: CommercialAccessErrorCode) {
    super(code);
    this.name = 'CommercialAccessError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita so os sete estados da 08 §6; qualquer outro valor vindo do banco e erro de contrato. */
export function aceitarEstado(valor: unknown): EstadoAcessoComercial {
  if (typeof valor === 'string' && (ESTADOS_ACESSO_COMERCIAL as readonly string[]).includes(valor)) {
    return valor as EstadoAcessoComercial;
  }
  throw new CommercialAccessError('acesso_comercial_invalido');
}

/**
 * Le o acesso comercial do profissional no instante do relogio injetado.
 * Nao decide o que cada estado permite: isso e dos consumidores (RN-H045-06).
 */
export async function lerAcessoComercial(
  port: CommercialAccessPort,
  clock: Clock,
  professionalId: string,
): Promise<AcessoComercial> {
  if (typeof professionalId !== 'string' || !UUID.test(professionalId)) {
    throw new CommercialAccessError('acesso_comercial_profissional_invalido');
  }
  const at = clock.now();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new CommercialAccessError('acesso_comercial_relogio_invalido');
  }
  return port.read(professionalId, at);
}
