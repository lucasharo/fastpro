// Issue 68 (H-055) | Limite de taxa da descoberta por profissional (docs/factory/153-DESENHO-H055.md, §2 A-3, §5.2; decisao 610).
// 60 requisicoes por minuto, sobre private.rl_check e private.rl_hit (ja existentes; sem migracao).
// A chave chega em HMAC pela composicao com o prefixo "discovery:": o id do profissional nunca vai em claro
// ao banco nem aparece em log. Erro do banco segue o caminho do SqlClient (sem texto de driver aqui).
import { clampRetryAfter, type RateWindowDecision } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { createHash } from 'node:crypto';

/** 60 por minuto (decisao 610). Janela e bucket de 60 s. */
export const DISCOVERY_RATE_LIMIT = { limit: 60, spanSeconds: 60, bucketSeconds: 60 } as const;
/** H-056 (#69): forma de uma politica de limite de taxa (janela e balde em segundos). */
export interface RatePolitica {
  readonly limit: number;
  readonly spanSeconds: number;
  readonly bucketSeconds: number;
}
/** H-056 (#69): lista e link de foto do profissional e do dono, 60 por minuto, balde proprio (A-10). */
export const PHOTO_VIEW_RATE_LIMIT: RatePolitica = { limit: 60, spanSeconds: 60, bucketSeconds: 60 };
/** H-056 (#69): entrega da imagem marcada, 120 por minuto por usuario do token (A-10). */
export const PHOTO_DELIVER_RATE_LIMIT: RatePolitica = { limit: 120, spanSeconds: 60, bucketSeconds: 60 };
const PREFIXO_CHAVE = 'discovery:';

const SQL_CHECK =
  'select out_ok, out_retry_after from private.rl_check($1::text, $2::int, $3::int, $4::int, $5::timestamptz)';
const SQL_HIT = 'select private.rl_hit($1::text, $2::int, $3::timestamptz)';

export interface PgDiscoveryRateLimitDeps {
  readonly client: SqlClient;
  /** Devolve o HMAC (hex) do profissional, calculado pela composicao com a chave propria da taxa. */
  readonly chaveDoProfissional: (professionalId: string) => string;
  /** H-056 (#69): politica e prefixo proprios da lista e do link de foto; padrao = descoberta (#68). */
  readonly politica?: RatePolitica;
  readonly prefixo?: string;
}

export class PgDiscoveryRateLimit {
  constructor(private readonly deps: PgDiscoveryRateLimitDeps) {}

  /** Decide se a requisicao cabe na janela. Barrado devolve Retry-After em segundos, limitado pelo dominio. */
  async check(professionalId: string, nowMs: number): Promise<RateWindowDecision> {
    const res = await this.deps.client.query(SQL_CHECK, [
      this.chave(professionalId),
      this.politica.spanSeconds,
      this.politica.bucketSeconds,
      this.politica.limit,
      new Date(nowMs).toISOString(),
    ]);
    const linha = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (typeof linha?.out_ok !== 'boolean') throw new Error('rate_limit_resposta_invalida');
    if (linha.out_ok) return { decision: 'permitido' };
    return { decision: 'barrado', retryAfterSeconds: clampRetryAfter(Number(linha.out_retry_after)) };
  }

  /** Registra uma requisicao aceita no balde do instante. */
  async record(professionalId: string, nowMs: number): Promise<void> {
    await this.deps.client.query(SQL_HIT, [
      this.chave(professionalId),
      this.politica.bucketSeconds,
      new Date(nowMs).toISOString(),
    ]);
  }

  private get politica(): RatePolitica {
    return this.deps.politica ?? DISCOVERY_RATE_LIMIT;
  }

  /**
   * Chave do contador: o prefixo (dominio da politica) e o HMAC do profissional viram um SHA-256 em hexadecimal.
   * ops.rate_counter so aceita key_hmac com exatamente 64 hexadecimais; o prefixo em claro quebrava o registro
   * (erro 503 nas rotas de fotos e de descoberta). Prefixos diferentes continuam gerando contadores separados.
   */
  private chave(professionalId: string): string {
    const bruta = `${this.deps.prefixo ?? PREFIXO_CHAVE}${this.deps.chaveDoProfissional(professionalId)}`;
    return createHash('sha256').update(bruta, 'utf8').digest('hex');
  }
}
