// Issue 46 (H-033) | Adaptador Pg do telefone e do consentimento (docs/factory/129-DESENHO-H033.md, §5).
// So chama as funcoes private.request_phone_* e private.contact_* com papel app_system. Nao decide regra: a regra de
// revelacao fica no banco (D-04). Recebe um SqlClient injetado: nao abre conexao nem le ambiente.
// Erro do banco nunca e repassado: vira o codigo fixo contato_banco_falhou (sem texto de driver, numero ou blob).
import type { SqlClient } from './jobs-tick.js';

export const SQL_PHONE_ATTACH =
  'select out_state from private.request_phone_attach($1::uuid, $2::uuid, $3::bytea, $4::boolean, $5::text, $6::timestamptz)';
export const SQL_PHONE_REPLACE = 'select out_state from private.request_phone_replace($1::uuid, $2::uuid, $3::bytea, $4::timestamptz)';
export const SQL_CONSENT_GRANT =
  'select out_state from private.contact_consent_grant_professional($1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz)';
export const SQL_CONSENT_REVOKE = 'select out_revoked, out_state from private.contact_consent_revoke($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)';
export const SQL_REVEAL = 'select out_phone_enc, out_limited from private.contact_reveal_phone($1::uuid, $2::uuid, $3::timestamptz)';
export const SQL_AVAILABLE = 'select private.contact_available_professional($1::uuid, $2::uuid, $3::timestamptz) as ok';
export const SQL_OWNER_STATUS = 'select * from private.contact_owner_status($1::uuid, $2::uuid)';
export const SQL_OWNER_PHONE = 'select private.request_phone_owner_get($1::uuid, $2::uuid) as phone_enc';

/** Erro fixo: nunca carrega texto de driver, numero, blob ou identificador. */
export const CONTATO_BANCO_FALHOU = 'contato_banco_falhou';

export interface ContactConsentRow {
  readonly id: string;
  readonly scope: string;
  readonly professionalId: string | null;
  readonly grantedAt: string;
  readonly grantedVia: string;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
}

export interface OwnerContactStatus {
  readonly phonePresent: boolean;
  readonly consents: readonly ContactConsentRow[];
}

/** Resultado da revelacao: null (zero linhas) = negada; limited = estouro de leituras; phoneEnc = blob para decifrar. */
export interface RevealResult {
  readonly phoneEnc: Uint8Array | null;
  readonly limited: boolean;
}

type Linha = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : String(valor ?? '');
}

function textoOuNulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : texto(valor);
}

function instante(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return valor instanceof Date ? valor.toISOString() : texto(valor);
}

function bytes(valor: unknown): Uint8Array | null {
  if (valor === null || valor === undefined) return null;
  return valor instanceof Uint8Array ? valor : Buffer.from(texto(valor), 'utf8');
}

async function consultar(client: SqlClient, sql: string, params: unknown[]): Promise<Linha[]> {
  try {
    const r = await client.query(sql, params);
    return r.rows as Linha[];
  } catch {
    throw new Error(CONTATO_BANCO_FALHOU);
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export class PgContactStore {
  constructor(private readonly client: SqlClient) {}

  /** Anexa o telefone cifrado ao pedido do dono (publicacao). Estados: consentimento_ativo | sem_consentimento | ja_definido | pedido_inexistente. */
  async attachPhone(userId: string, requestId: string, phoneEnc: Uint8Array, grant: boolean, textVersion: string, nowMs: number): Promise<string> {
    const rows = await consultar(this.client, SQL_PHONE_ATTACH, [userId, requestId, Buffer.from(phoneEnc), grant, textVersion, iso(nowMs)]);
    return texto(rows[0]?.out_state);
  }

  /** Troca (blob) ou apaga (null) o telefone. O gatilho revoga as liberações ativas. Estados: trocado | apagado | pedido_inexistente. */
  async replacePhone(userId: string, requestId: string, phoneEnc: Uint8Array | null, nowMs: number): Promise<string> {
    const rows = await consultar(this.client, SQL_PHONE_REPLACE, [userId, requestId, phoneEnc === null ? null : Buffer.from(phoneEnc), iso(nowMs)]);
    return texto(rows[0]?.out_state);
  }

  /** Liberacao individual no chat. Estados: liberado | ja_liberado | coberto_pelo_geral | sem_telefone | sem_aceite | pedido_fechado | pedido_inexistente. */
  async grantProfessional(userId: string, requestId: string, professionalId: string, textVersion: string, nowMs: number): Promise<string> {
    const rows = await consultar(this.client, SQL_CONSENT_GRANT, [userId, requestId, professionalId, textVersion, iso(nowMs)]);
    return texto(rows[0]?.out_state);
  }

  /** Revogacao pelo dono. professionalId nulo = geral. Devolve quantas liberações foram revogadas e o estado. */
  async revoke(userId: string, requestId: string, professionalId: string | null, nowMs: number): Promise<{ revoked: number; state: string }> {
    const rows = await consultar(this.client, SQL_CONSENT_REVOKE, [userId, requestId, professionalId, iso(nowMs)]);
    const r = rows[0];
    return { revoked: Number(r?.out_revoked ?? 0), state: texto(r?.out_state) };
  }

  /** Revelacao ao profissional. Null = negada (404 uniforme). O log guarda so o vinculo, nunca o numero. */
  async revealPhone(professionalId: string, requestId: string, nowMs: number): Promise<RevealResult | null> {
    const rows = await consultar(this.client, SQL_REVEAL, [professionalId, requestId, iso(nowMs)]);
    const r = rows[0];
    if (r === undefined) return null;
    return { phoneEnc: bytes(r.out_phone_enc), limited: r.out_limited === true };
  }

  /** Disponibilidade para o botao "ver telefone". Falso e igual para "sem aceite" e "sem consentimento". */
  async availableForProfessional(professionalId: string, requestId: string, nowMs: number): Promise<boolean> {
    const rows = await consultar(this.client, SQL_AVAILABLE, [professionalId, requestId, iso(nowMs)]);
    return rows[0]?.ok === true;
  }

  /** Estado do pedido para o dono. Null quando o pedido nao e do dono. Sem telefone em claro nem blob. */
  async ownerStatus(userId: string, requestId: string): Promise<OwnerContactStatus | null> {
    const rows = await consultar(this.client, SQL_OWNER_STATUS, [userId, requestId]);
    if (rows.length === 0) return null;
    const consents: ContactConsentRow[] = [];
    for (const r of rows) {
      if (r.out_consent_id === null || r.out_consent_id === undefined) continue;
      consents.push({
        id: texto(r.out_consent_id),
        scope: texto(r.out_scope),
        professionalId: textoOuNulo(r.out_professional_id),
        grantedAt: instante(r.out_granted_at) ?? '',
        grantedVia: texto(r.out_granted_via),
        revokedAt: instante(r.out_revoked_at),
        revokedReason: textoOuNulo(r.out_revoked_reason),
      });
    }
    return { phonePresent: rows[0]?.out_phone_present === true, consents };
  }

  /** Leitura do proprio telefone pelo dono (republicacao). Null quando nao ha telefone ou o pedido nao e do dono. */
  async ownerPhone(userId: string, requestId: string): Promise<Uint8Array | null> {
    const rows = await consultar(this.client, SQL_OWNER_PHONE, [userId, requestId]);
    return bytes(rows[0]?.phone_enc);
  }
}
