// H-037 (Issue #50) | Adaptador Pg dos documentos de identidade (107-DESENHO-H037.md, §4.2 e §6). Cada metodo e uma
// chamada a uma funcao private.idoc_* (security definer, executada como app_system). Parametros posicionais; nenhum
// SQL e montado com entrada de fora. Erro de banco vira IdentityDocStoreError com codigo fixo (sem eco de SQL).
import type { SqlClient } from './jobs-tick.js';
// O db nao importa @fastpro/domain ate o barril receber o modulo (fase 2, depois da Issue 141): os tipos abaixo espelham
// packages/domain/src/identity-docs. A paridade com o dominio e provada em tests/identity-docs-adaptadores.test.ts.

/** Limite de documentos vivos por profissional (espelha IDOC_MAX_VIVOS do dominio). */
export const IDOC_MAX_VIVOS = 5;

export type IdentityDocDeclaredType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export type IdentityDocDeleteCode = 'deleted' | 'not_found' | 'already_analyzed';

export interface IdentityDocIssueInput {
  readonly userId: string;
  readonly clientUploadId: string;
  readonly declaredType: IdentityDocDeclaredType;
  readonly declaredBytes: number;
  readonly nowMs: number;
  readonly globalBytesCap: number;
}

export interface IdentityDocIssueResult {
  readonly code: string;
  readonly id: string | null;
  readonly status: 'em_envio' | 'recebido' | null;
}

export interface IdentityDocListItem {
  readonly id: string;
  readonly kind: 'imagem' | 'pdf';
  readonly status: 'em_envio' | 'recebido';
  readonly receivedAt: string | null;
  readonly deletable: boolean;
}

export interface IdentityDocConfirmBeginResult {
  readonly code: string;
  readonly attempt: number | null;
  readonly declaredType: IdentityDocDeclaredType | null;
}

export interface IdentityDocSweepItem {
  readonly id: string;
  readonly stagingKey: boolean;
  readonly finalKey: boolean;
}

export class IdentityDocStoreError extends Error {
  readonly code = 'store_falha' as const;
  constructor() {
    super('store_falha');
    this.name = 'IdentityDocStoreError';
  }
}

const ISSUE_CODES: ReadonlySet<string> = new Set([
  'new',
  'replay',
  'replay_received',
  'no_profile',
  'email_unverified',
  'state_denied',
  'doc_limit',
  'cap',
]);
const BEGIN_CODES: ReadonlySet<string> = new Set(['begin', 'replay', 'not_found', 'expired', 'busy', 'too_many']);
const DONE_CODES: ReadonlySet<string> = new Set(['received', 'lost', 'gone']);
const REFUSE_CODES: ReadonlySet<string> = new Set(['refused', 'lost', 'gone']);
const DELETE_CODES: ReadonlySet<string> = new Set(['deleted', 'not_found', 'already_analyzed']);

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function tipoDeclarado(valor: unknown): IdentityDocDeclaredType | null {
  const v = texto(valor);
  if (v === 'image/jpeg' || v === 'image/png' || v === 'image/webp' || v === 'application/pdf') return v;
  return null;
}

export class PgIdentityDocStore {
  constructor(private readonly client: SqlClient) {}

  private async consulta(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    try {
      const res = await this.client.query(sql, params);
      return res.rows as unknown as Record<string, unknown>[];
    } catch {
      throw new IdentityDocStoreError();
    }
  }

  async issue(input: IdentityDocIssueInput): Promise<IdentityDocIssueResult> {
    const linhas = await this.consulta(
      'select out_code, out_id, out_status from private.idoc_issue($1::uuid, $2::uuid, $3::text, $4::integer, $5::timestamptz, $6::bigint)',
      [
        input.userId,
        input.clientUploadId,
        input.declaredType,
        input.declaredBytes,
        new Date(input.nowMs).toISOString(),
        input.globalBytesCap,
      ],
    );
    const linha = linhas[0];
    const code = texto(linha?.['out_code']);
    if (!ISSUE_CODES.has(code)) throw new IdentityDocStoreError();
    const status = texto(linha?.['out_status']);
    return {
      code: code as IdentityDocIssueResult['code'],
      id: linha?.['out_id'] ? texto(linha['out_id']) : null,
      status: status === 'em_envio' || status === 'recebido' ? status : null,
    };
  }

  async list(userId: string): Promise<{ readonly documents: readonly IdentityDocListItem[]; readonly slotsRemaining: number }> {
    const linhas = await this.consulta('select * from private.idoc_list($1::uuid, $2::timestamptz)', [
      userId,
      new Date().toISOString(),
    ]);
    const documents: IdentityDocListItem[] = linhas.map((l) => ({
      id: texto(l['out_id']),
      kind: texto(l['out_file_kind']) === 'pdf' ? 'pdf' : 'imagem',
      status: texto(l['out_status']) === 'recebido' ? 'recebido' : 'em_envio',
      receivedAt: l['out_received_at'] ? new Date(texto(l['out_received_at'])).toISOString() : null,
      deletable: l['out_deletable'] === true,
    }));
    // Vagas restantes contadas sobre a lista do dono (o banco aplica o limite de 5 vivos no insert).
    return { documents, slotsRemaining: Math.max(0, IDOC_MAX_VIVOS - documents.length) };
  }

  async confirmBegin(userId: string, id: string, nowMs: number, leaseS: number): Promise<IdentityDocConfirmBeginResult> {
    const linhas = await this.consulta(
      'select out_code, out_attempt, out_declared_type from private.idoc_confirm_begin($1::uuid, $2::uuid, $3::timestamptz, $4::integer)',
      [userId, id, new Date(nowMs).toISOString(), leaseS],
    );
    const linha = linhas[0];
    const code = texto(linha?.['out_code']);
    if (!BEGIN_CODES.has(code)) throw new IdentityDocStoreError();
    const tentativa = linha?.['out_attempt'];
    return {
      code: code as IdentityDocConfirmBeginResult['code'],
      attempt: tentativa === null || tentativa === undefined ? null : Number(tentativa),
      declaredType: tipoDeclarado(linha?.['out_declared_type']),
    };
  }

  async confirmDone(
    userId: string,
    id: string,
    attempt: number,
    storedType: 'image/jpeg' | 'application/pdf',
    storedBytes: number,
    sha256: Uint8Array,
    nowMs: number,
  ): Promise<'received' | 'lost' | 'gone'> {
    const linhas = await this.consulta(
      'select private.idoc_confirm_done($1::uuid, $2::uuid, $3::smallint, $4::text, $5::integer, $6::bytea, $7::timestamptz) as out',
      [userId, id, attempt, storedType, storedBytes, Buffer.from(sha256), new Date(nowMs).toISOString()],
    );
    const code = texto(linhas[0]?.['out']);
    return DONE_CODES.has(code) ? (code as 'received' | 'lost' | 'gone') : 'lost';
  }

  async confirmRefuse(
    userId: string,
    id: string,
    attempt: number,
    reasonCode: string,
    nowMs: number,
  ): Promise<'refused' | 'lost' | 'gone'> {
    const linhas = await this.consulta(
      'select private.idoc_confirm_refuse($1::uuid, $2::uuid, $3::smallint, $4::text, $5::timestamptz) as out',
      [userId, id, attempt, reasonCode, new Date(nowMs).toISOString()],
    );
    const code = texto(linhas[0]?.['out']);
    return REFUSE_CODES.has(code) ? (code as 'refused' | 'lost' | 'gone') : 'lost';
  }

  async confirmRelease(id: string, attempt: number, count: boolean): Promise<void> {
    await this.consulta('select private.idoc_confirm_release($1::uuid, $2::smallint, $3::boolean)', [id, attempt, count]);
  }

  async remove(userId: string, id: string, nowMs: number): Promise<IdentityDocDeleteCode> {
    const linhas = await this.consulta('select private.idoc_delete($1::uuid, $2::uuid, $3::timestamptz) as out', [
      userId,
      id,
      new Date(nowMs).toISOString(),
    ]);
    const code = texto(linhas[0]?.['out']);
    return DELETE_CODES.has(code) ? (code as IdentityDocDeleteCode) : 'not_found';
  }

  async sweep(nowMs: number, limit: number): Promise<readonly IdentityDocSweepItem[]> {
    const linhas = await this.consulta('select * from private.idoc_sweep($1::timestamptz, $2::integer)', [
      new Date(nowMs).toISOString(),
      limit,
    ]);
    return linhas.map((l) => ({
      id: texto(l['out_id']),
      stagingKey: l['out_staging'] === true,
      finalKey: l['out_final'] === true,
    }));
  }

  async purgeDone(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const linhas = await this.consulta('select private.idoc_purge_done($1::uuid[]) as n', [[...ids]]);
    return Number(linhas[0]?.['n'] ?? 0);
  }

  async knownPending(ids: readonly string[]): Promise<readonly string[]> {
    if (ids.length === 0) return [];
    const linhas = await this.consulta('select out_id from private.idoc_known_pending($1::uuid[])', [[...ids]]);
    return linhas.map((l) => texto(l['out_id']));
  }
}
