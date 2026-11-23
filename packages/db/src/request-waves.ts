// Pacote C (H-060, H-082, H-083) | Adaptador das funcoes de segunda onda e republicacao do pedido
// (migracao 20261123130000_request_wave2_republish). Papel app_system; cada funcao confere o dono do pedido.
import type { SqlClient } from './jobs-tick.js';

export const SQL_WAVE_ACTIONS = 'select * from private.request_wave_actions($1, $2, $3::timestamptz)';
export const SQL_WAVE2_OPEN = 'select * from private.request_open_wave2($1, $2, $3::timestamptz)';
export const SQL_REPUBLISH_DRAFT_CREATE =
  'select * from private.request_republish_draft_create($1, $2, $3, $4, $5::timestamptz, $6::integer, $7::integer, $8)';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

/** O que o dono pode fazer agora com o pedido. */
export interface AcoesPedido {
  readonly canCallMore: boolean;
  readonly canRepublish: boolean;
}

export type ResultadoOnda2 =
  | {
      readonly outcome: 'aberta' | 'sem_mudanca';
      readonly wave2OpenedAt: string | null;
    }
  | {
      readonly outcome: 'estado_invalido' | 'admissao_encerrada' | 'abaixo_do_minimo' | 'nao_encontrado';
      readonly wave2OpenedAt: null;
    };

export type ResultadoRepublicacao =
  | { readonly outcome: 'rascunho_criado'; readonly draftId: string; readonly expiresAt: string | null }
  | {
      readonly outcome: 'ja_existe' | 'ja_republicado' | 'origem_invalida' | 'nao_encontrado' | 'servico_invalido' | 'teto_global';
      readonly draftId: null;
      readonly expiresAt: null;
    };

export interface EntradaRepublicacao {
  readonly originId: string;
  readonly customerId: string;
  /** SHA-256 do segredo do cookie do novo rascunho (o segredo nunca vai ao banco). */
  readonly secretHash: string;
  /** HMAC do IP normalizado (64 caracteres hexadecimais). */
  readonly ipHmac: string;
  readonly agora: Date;
  readonly ttlDays: number;
  readonly liveCap: number;
  /** Endereco em texto, ja decifrado pela API (cofre do pedido de origem). */
  readonly addressText: string;
}

/** Mensagens fixas que o banco levanta e que viram resultado (qualquer outra falha sobe como erro). */
function codigoDoBanco(erro: unknown): 'servico_invalido' | 'teto_global' | null {
  const msg = erro instanceof Error ? erro.message : '';
  if (msg === 'servico_invalido') return 'servico_invalido';
  if (msg === 'teto_global_rascunhos') return 'teto_global';
  return null;
}

const ONDA_OUTCOMES = ['aberta', 'sem_mudanca', 'estado_invalido', 'admissao_encerrada', 'abaixo_do_minimo', 'nao_encontrado'] as const;
const REPUBLICACAO_OUTCOMES = [
  'rascunho_criado',
  'ja_existe',
  'ja_republicado',
  'origem_invalida',
  'nao_encontrado',
] as const;

export class PgRequestWaveStore {
  constructor(private readonly client: SqlClient) {}

  /** Null quando o pedido nao existe ou e de outro dono (a rota responde 404 uniforme). */
  async acoes(requestId: string, customerId: string, agora: Date): Promise<AcoesPedido | null> {
    const r = await this.client.query(SQL_WAVE_ACTIONS, [requestId, customerId, agora]);
    const l = r.rows[0];
    if (l === undefined) return null;
    return { canCallMore: l.out_can_call_more === true, canRepublish: l.out_can_republish === true };
  }

  async abrirOnda2(requestId: string, customerId: string, agora: Date): Promise<ResultadoOnda2> {
    const r = await this.client.query(SQL_WAVE2_OPEN, [requestId, customerId, agora]);
    const l = r.rows[0] ?? {};
    const outcome = ONDA_OUTCOMES.find((v) => v === l.out_outcome) ?? 'nao_encontrado';
    if (outcome === 'aberta' || outcome === 'sem_mudanca') {
      return { outcome, wave2OpenedAt: iso(l.out_wave2_opened_at) };
    }
    return { outcome, wave2OpenedAt: null };
  }

  async republicar(entrada: EntradaRepublicacao): Promise<ResultadoRepublicacao> {
    let l: Record<string, unknown>;
    try {
      const r = await this.client.query(SQL_REPUBLISH_DRAFT_CREATE, [
        entrada.originId,
        entrada.customerId,
        entrada.secretHash,
        entrada.ipHmac,
        entrada.agora,
        entrada.ttlDays,
        entrada.liveCap,
        entrada.addressText,
      ]);
      l = r.rows[0] ?? {};
    } catch (erro) {
      const codigo = codigoDoBanco(erro);
      if (codigo === null) throw erro;
      return { outcome: codigo, draftId: null, expiresAt: null };
    }
    const outcome = REPUBLICACAO_OUTCOMES.find((v) => v === l.out_outcome) ?? 'nao_encontrado';
    if (outcome === 'rascunho_criado') {
      return { outcome, draftId: String(l.out_draft_id), expiresAt: iso(l.out_expires_at) };
    }
    return { outcome, draftId: null, expiresAt: null };
  }
}
