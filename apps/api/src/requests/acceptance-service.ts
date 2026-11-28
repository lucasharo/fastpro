// Issue 71 (H-058) | Servico do aceite idempotente (docs/factory/162-DESENHO-H058.md, §1, §2 A-2, §3.4).
// Um unico instante por requisicao (relogio lido UMA vez). Toda regra de negocio (vaga, prazo, elegibilidade,
// casamento, identidade) fica no banco, dentro da transacao do adaptador PgAcceptanceStore. Este modulo so
// entrega o comando ao adaptador e converte falha inesperada em 503 fixo, sem texto de driver.
import {
  ACCEPTANCE_BANCO_INDISPONIVEL,
  type AcceptanceRequest,
  type AcceptanceResult,
} from '@fastpro/db';

/** Porta do aceite (implementada por PgAcceptanceStore em producao). */
export interface AcceptanceStorePort {
  aceitar(input: AcceptanceRequest): Promise<AcceptanceResult>;
}

export interface AcceptanceServiceDeps {
  readonly store: AcceptanceStorePort;
  /** Relogio injetado: lido UMA vez por requisicao (A-2). */
  readonly clock: { nowMs(): number };
}

/** Dados ja validados pela rota: id do pedido (UUID canonico), id do profissional e chave (UUID v4). */
export interface AcceptanceCommand {
  readonly requestId: string;
  readonly professionalId: string;
  readonly key: string;
}

export async function aceitarTrabalho(
  comando: AcceptanceCommand,
  deps: AcceptanceServiceDeps,
): Promise<AcceptanceResult> {
  const agora = new Date(deps.clock.nowMs());
  try {
    return await deps.store.aceitar({
      requestId: comando.requestId,
      professionalId: comando.professionalId,
      key: comando.key,
      now: agora,
    });
  } catch {
    // Falha que escapou do adaptador vira o mesmo 503 fixo do banco indisponivel (sem texto de erro).
    return ACCEPTANCE_BANCO_INDISPONIVEL;
  }
}
