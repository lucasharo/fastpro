// H-036 (reutilizavel por H-031) | Adaptador Pg da GeoPointStorePort (docs/factory/99-DESENHO-H036.md, §5 passo 6;
// docs/factory/68-DESENHO-H021.md, §2.3, §3.2, §3.4). So chama as funcoes private.geo_* ja existentes, com o papel
// app_system. A porta fica em apps/api (permanent-ports.ts) e este adaptador e estruturalmente igual a ela.
// Regras deste modulo:
//   - storePermanent que falhar libera a reserva (geo_release) e relanca erro fixo `geo_store_falhou`: a rota traduz
//     em 503 e nenhuma coordenada parcial e gravada (CA-06).
//   - Nenhum erro do banco e impresso ou repassado: o texto do driver pode conter dados.
//   - Nenhuma coordenada volta ao chamador exceto no ponto que o servico de geocodificacao acabou de receber.
import type { PermanentPoint } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Quem e o assunto da coordenada (a tabela aceita os dois; a chave do pedido e a da base do profissional). */
export type GeoSubjectKind = 'request' | 'professional_base';

/** Mesma forma de GeoReserveInput/GeoReserveOutcome de apps/api/src/geo/permanent-ports.ts. */
export interface PgGeoReserveInput {
  readonly subject: string;
  readonly hash: string;
  readonly nowMs: number;
  readonly leaseMs: number;
  readonly callsCap: number;
  readonly caps: { readonly soft: number; readonly hard: number } | null;
}

export type PgGeoReserveOutcome =
  | { readonly acao: 'chamar'; readonly ref: string }
  | { readonly acao: 'reutilizar'; readonly pointId: string }
  | { readonly acao: 'sem_resultado' | 'em_andamento' | 'teto' | 'breaker' };

const ACOES = new Set(['chamar', 'reutilizar', 'sem_resultado', 'em_andamento', 'teto', 'breaker']);

const SQL_RESERVE =
  'select out_acao, out_ref, out_point_id from private.geo_reserve($1::text, $2::uuid, $3::text, $4::timestamptz, $5::integer, $6::integer, $7::integer, $8::integer)';
const SQL_STORE =
  "select private.geo_store_permanent($1::uuid, 'permanent', $2::double precision, $3::double precision, $4::text, $5::timestamptz) as point_id";
const SQL_NO_RESULT = 'select private.geo_mark_no_result($1::uuid, $2::timestamptz) as ok';
const SQL_RELEASE = 'select private.geo_release($1::uuid) as ok';
const SQL_PANEL = 'select out_used, out_aguardando from private.geo_panel($1::timestamptz)';

/** Erro fixo: a rota traduz em 503 sem detalhe tecnico. */
export const GEO_STORE_FALHOU = 'geo_store_falhou';

function linha(rows: unknown[]): Record<string, unknown> {
  const primeira = rows[0];
  if (typeof primeira !== 'object' || primeira === null) throw new Error('geo_resposta_invalida');
  return primeira as Record<string, unknown>;
}

function paraIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface PgGeoPointStoreDeps {
  readonly client: SqlClient;
  readonly subjectKind: GeoSubjectKind;
  /** Relogio para markNoResult, que na porta nao recebe o instante. Padrao: relogio do sistema. */
  readonly clock?: () => number;
}

export class PgGeoPointStore {
  private readonly clock: () => number;

  constructor(private readonly deps: PgGeoPointStoreDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  /** Decisao atomica no banco (reutilizar, sem resultado, em andamento, teto, breaker ou chamar). */
  async reserve(input: PgGeoReserveInput): Promise<PgGeoReserveOutcome> {
    const res = await this.deps.client.query(SQL_RESERVE, [
      this.deps.subjectKind,
      input.subject,
      input.hash,
      paraIso(input.nowMs),
      Math.ceil(input.leaseMs / 1000),
      input.callsCap,
      input.caps?.soft ?? null,
      input.caps?.hard ?? null,
    ]);
    const r = linha(res.rows);
    const acao = String(r.out_acao ?? '');
    if (!ACOES.has(acao)) throw new Error('geo_acao_desconhecida');
    if (acao === 'chamar') return { acao, ref: String(r.out_ref ?? '') };
    if (acao === 'reutilizar') return { acao, pointId: String(r.out_point_id ?? '') };
    return { acao: acao as 'sem_resultado' | 'em_andamento' | 'teto' | 'breaker' };
  }

  /** Grava a coordenada permanente. Se falhar, libera a reserva e relanca erro fixo. */
  async storePermanent(ref: string, point: PermanentPoint, nowMs: number): Promise<string> {
    try {
      const res = await this.deps.client.query(SQL_STORE, [
        ref,
        point.lon,
        point.lat,
        point.precision,
        paraIso(nowMs),
      ]);
      return String(linha(res.rows).point_id);
    } catch {
      try {
        await this.deps.client.query(SQL_RELEASE, [ref]);
      } catch {
        // A liberacao tambem falhou: a reserva expira pelo prazo de 60 s (decisao de H-021). Nada e impresso.
      }
      throw new Error(GEO_STORE_FALHOU);
    }
  }

  async markNoResult(ref: string): Promise<void> {
    await this.deps.client.query(SQL_NO_RESULT, [ref, paraIso(this.clock())]);
  }

  async release(ref: string): Promise<void> {
    await this.deps.client.query(SQL_RELEASE, [ref]);
  }

  async panel(nowMs: number): Promise<{ readonly used: number; readonly aguardando: number }> {
    const r = linha((await this.deps.client.query(SQL_PANEL, [paraIso(nowMs)])).rows);
    return { used: Number(r.out_used ?? 0), aguardando: Number(r.out_aguardando ?? 0) };
  }
}
