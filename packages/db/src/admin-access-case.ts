// H-073 (Issue 83, docs/factory/60-DESENHO-H073.md §1, §3 e §4) | Adaptadores Pg do acesso excepcional a conversa
// e da confirmacao recente do segundo fator (step-up). O segredo do cookie vira hash SHA-256 antes de qualquer
// chamada ao banco; o segredo em claro nao sai deste modulo. So chamam funcoes private.* (role app_system).
// Permissao, janela de 30 min, prova recente e voto estao no SQL (autoridade) e em @fastpro/domain.
// Leitor da conversa: nao ha adaptador ainda; depende das tabelas de H-065/H-066 (rota segue 501).
import type {
  AccessCaseActionInput,
  AccessCaseListInput,
  AccessCaseListItem,
  AccessCaseOpenInput,
  AccessCasePort,
  AdminGuardRecord,
  AdminRepository,
  AdminSessionSubject,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';
import { hashSessionSecret } from './session.js';

const iso = (ms: number): string => new Date(ms).toISOString();

/** Instante vindo do driver (Date) ou em texto ISO. Qualquer outra coisa e resposta invalida. */
function instante(valor: unknown, campo: string): number {
  const ms = valor instanceof Date ? valor.getTime() : typeof valor === 'string' ? Date.parse(valor) : Number.NaN;
  if (!Number.isFinite(ms)) throw new Error(`${campo}_invalido`);
  return ms;
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw new Error(`${campo}_invalido`);
  return valor;
}

function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map((v) => String(v)) : [];
}

const SQL_OPEN =
  'select private.access_case_open($1::uuid, $2::text, $3::uuid, $4::text, $5::uuid, $6::timestamptz) as id';
const SQL_APPROVE = 'select private.access_case_approve($1::uuid, $2::text, $3::uuid, $4::timestamptz)';
const SQL_APPROVED_EXPIRY = 'select expires_at from app.access_case where id = $1::uuid';
const SQL_CLOSE = 'select private.access_case_close($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_LIST = 'select * from private.access_case_list($1::uuid, $2::text, $3::timestamptz)';

/**
 * Porta do caso. Erros do banco sobem como estao (com `code` = SQLSTATE ou ADMnn); quem traduz para
 * 403/409/422/429/503 e o dominio (mapAccessCaseDbError), sem eco de dado.
 */
export class PgAccessCasePort implements AccessCasePort {
  constructor(private readonly client: SqlClient) {}

  async open(input: AccessCaseOpenInput): Promise<void> {
    await this.client.query(SQL_OPEN, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      input.conversationId,
      input.justification,
      input.caseId,
      iso(input.nowMs),
    ]);
  }

  /** Aprova e le o vencimento gravado pelo banco (approved_at + 30 min), nao um calculo local. */
  async approve(input: AccessCaseActionInput): Promise<{ readonly expiresAtMs: number }> {
    await this.client.query(SQL_APPROVE, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      input.caseId,
      iso(input.nowMs),
    ]);
    const res = await this.client.query(SQL_APPROVED_EXPIRY, [input.caseId]);
    const row = res.rows[0] as { expires_at?: unknown } | undefined;
    return { expiresAtMs: instante(row?.expires_at, 'expira') };
  }

  async close(input: AccessCaseActionInput): Promise<void> {
    await this.client.query(SQL_CLOSE, [input.actorUserId, input.caseId, iso(input.nowMs)]);
  }

  /**
   * Lista de casos visiveis a quem pede. O banco decide o que cada pessoa ve (proprios casos e, com
   * case.authorize_sensitive, os pendentes de outros); o parametro canAuthorize do dominio nao e repassado.
   */
  async list(input: AccessCaseListInput): Promise<readonly AccessCaseListItem[]> {
    const res = await this.client.query(SQL_LIST, [
      input.actorUserId,
      hashSessionSecret(input.secret),
      iso(input.nowMs),
    ]);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: texto(row.out_id, 'caso'),
        estado: texto(row.out_estado, 'estado'),
        scope_id: texto(row.out_scope_id, 'conversa'),
        justificativa: texto(row.out_justificativa, 'justificativa'),
        expires_at: row.out_expires_at === null || row.out_expires_at === undefined
          ? null
          : iso(instante(row.out_expires_at, 'expira')),
      };
    });
  }
}

/** Guarda, conta da sessao e avanco de totp_at da sessao admin (H-102 e H-073). So estes tres metodos. */
const SQL_GUARD = `select g.out_user_id, g.out_roles, g.out_permissions, g.out_totp_at,
  private.admin_session_expiry($1::text, $2::timestamptz) as out_expires_at
  from private.admin_guard($1::text, $2::timestamptz) g`;
const SQL_SUBJECT = 'select * from private.admin_session_subject($1::text, $2::timestamptz)';
const SQL_STEP_UP = 'select private.admin_step_up($1::text, $2::timestamptz) as ok';

export type AdminSessionPort = Pick<AdminRepository, 'guard' | 'sessionSubject' | 'stepUp'>;

export class PgAdminSessionRepository implements AdminSessionPort {
  constructor(private readonly client: SqlClient) {}

  /**
   * Uma consulta. private.admin_guard so devolve sessao com aal2_at, conta ativa, papel vigente e nao
   * vencida ou revogada; por isso aal2 e active sao verdadeiros nas linhas devolvidas. Sem linha = nulo.
   */
  async guard(secret: string, nowMs: number): Promise<AdminGuardRecord | null> {
    const res = await this.client.query(SQL_GUARD, [hashSessionSecret(secret), iso(nowMs)]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined || row.out_user_id === null || row.out_user_id === undefined) return null;
    return {
      userId: texto(row.out_user_id, 'usuario'),
      roles: lista(row.out_roles),
      permissions: lista(row.out_permissions),
      aal2: true,
      active: true,
      expiresAtMs: instante(row.out_expires_at, 'expira'),
      totpAtMs: instante(row.out_totp_at, 'totp'),
    };
  }

  async sessionSubject(secret: string, nowMs: number): Promise<AdminSessionSubject | null> {
    const res = await this.client.query(SQL_SUBJECT, [hashSessionSecret(secret), iso(nowMs)]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined || row.out_user_id === null || row.out_user_id === undefined) return null;
    return {
      userId: texto(row.out_user_id, 'usuario'),
      email: texto(row.out_email, 'email'),
      authUserId: texto(row.out_auth_user_id, 'conta'),
    };
  }

  /** Avanca totp_at da sessao valida (nunca recua). False = sessao invalida. */
  async stepUp(secret: string, nowMs: number): Promise<boolean> {
    const res = await this.client.query(SQL_STEP_UP, [hashSessionSecret(secret), iso(nowMs)]);
    return (res.rows[0] as { ok?: unknown } | undefined)?.ok === true;
  }
}
