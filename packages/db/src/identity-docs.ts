// H-037 (Issue #50) | Adaptador Pg dos documentos de identidade (107-DESENHO-H037.md, §4.2 e §6). Cada metodo e uma
// chamada a uma funcao private.idoc_* (security definer, executada como app_system). Parametros posicionais; nenhum
// SQL e montado com entrada de fora. Erro de banco vira IdentityDocStoreError com codigo fixo (sem eco de SQL).
import { createHash } from 'node:crypto';
import type { SqlClient } from './jobs-tick.js';



// Tipos do contrato vem do dominio (107 §4.2): o adaptador so traduz o retorno das funcoes private.idoc_*.
import type {
  IdentityDocConfirmBeginResult,
  IdentityDocDeclaredType,
  IdentityDocDeleteCode,
  IdentityDocIssueCertInput,
  IdentityDocIssueInput,
  IdentityDocIssueResult,
  IdentityDocListItem,
  IdentityDocSweepItem,
} from '@fastpro/domain';
import { IDOC_MAX_VIVOS } from '@fastpro/domain';
export { IDOC_MAX_VIVOS };

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
  'service_denied',
  'limite_certificacao',
  'client_upload_em_uso',
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
  /** O relogio e o deps.clock do servico (injetado); sem ele, usa o relogio do processo. Nao muda o contrato da porta. */
  constructor(
    private readonly client: SqlClient,
    private readonly relogio: { nowMs(): number } = { nowMs: () => Date.now() },
  ) {}

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

  /** H-038 (desenho 148 §3.2): reserva de certificacao; os codigos seguem o mesmo contrato de issue. */
  async issueCert(input: IdentityDocIssueCertInput): Promise<IdentityDocIssueResult> {
    const linhas = await this.consulta(
      'select out_code, out_id, out_status from private.idoc_issue_cert($1::uuid, $2::uuid, $3::uuid, $4::text, $5::integer, $6::timestamptz, $7::bigint)',
      [
        input.userId,
        input.clientUploadId,
        input.serviceId,
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
      new Date(this.relogio.nowMs()).toISOString(),
    ]);
    const documents: IdentityDocListItem[] = linhas.map((l) => ({
      id: texto(l['out_id']),
      kind: texto(l['out_file_kind']) === 'pdf' ? 'pdf' : 'imagem',
      documentKind: texto(l['out_kind']) === 'certificacao' ? 'certificacao' : 'identidade',
      serviceId: l['out_service_id'] ? texto(l['out_service_id']) : null,
      status: texto(l['out_status']) === 'recebido' ? 'recebido' : 'em_envio',
      receivedAt: l['out_received_at'] ? new Date(texto(l['out_received_at'])).toISOString() : null,
      deletable: l['out_deletable'] === true,
      analyzed: l['out_deletable'] !== true,
    }));
    // Vagas restantes: so os documentos de identidade contam no limite de 5 (desenho 148 §2, item 7).
    const identidade = documents.filter((d) => d.documentKind === 'identidade').length;
    return { documents, slotsRemaining: Math.max(0, IDOC_MAX_VIVOS - identidade) };
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

// H-037 (#50, 107 §5): cota por politica sobre private.rl_check e private.rl_hit (mesmas funcoes da busca e do cadastro).
// A chave do balde e o SHA-256 de `idoc:<politica>:<valor>`; o valor ja vem como HMAC do IP (ou o id da conta). Sem eco.
export const SQL_IDOC_RL_CHECK = 'select out_ok, out_retry_after from private.rl_check($1, $2, $3, $4, $5::timestamptz)';
export const SQL_IDOC_RL_HIT = 'select private.rl_hit($1, $2, $3::timestamptz)';

export class PgIdentityDocRateLimit {
  constructor(
    private readonly client: SqlClient,
    private readonly relogio: { nowMs(): number } = { nowMs: () => Date.now() },
  ) {}

  private chave(politica: { readonly id: string }, valor: string): string {
    return createHash('sha256').update(`idoc:${politica.id}:${valor}`, 'utf8').digest('hex');
  }

  async check(
    politica: { readonly id: string; readonly spanS: number; readonly bucketS: number; readonly limit: number },
    valor: string,
  ): Promise<{ readonly ok: boolean; readonly retryAfterS: number }> {
    const res = await this.client.query(SQL_IDOC_RL_CHECK, [
      this.chave(politica, valor),
      politica.spanS,
      politica.bucketS,
      politica.limit,
      new Date(this.relogio.nowMs()).toISOString(),
    ]);
    const linha = res.rows[0] as { out_ok?: unknown; out_retry_after?: unknown } | undefined;
    if (!linha || typeof linha.out_ok !== 'boolean') throw new IdentityDocStoreError();
    const retry = Number(linha.out_retry_after ?? 0);
    return { ok: linha.out_ok, retryAfterS: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 0 };
  }

  async hit(politica: { readonly id: string; readonly bucketS: number }, valor: string): Promise<void> {
    await this.client.query(SQL_IDOC_RL_HIT, [
      this.chave(politica, valor),
      politica.bucketS,
      new Date(this.relogio.nowMs()).toISOString(),
    ]);
  }
}

// H-037 (#50) | Porta de perfil do profissional: a conta da sessao tem professional_profile? (app_system ja tem select).
export class PgIdentityDocProfile {
  constructor(private readonly client: SqlClient) {}

  async existe(userId: string): Promise<boolean> {
    const res = await this.client.query('select 1 from app.professional_profile where user_id = $1 limit 1', [userId]);
    return res.rows.length > 0;
  }
}
