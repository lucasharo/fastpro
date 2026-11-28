// Issue 120 (H-111) | Step-up do titular para abrir acesso e eliminacao (147-DESENHO-H111 §3.2, §4.1, §5.1, §6.1; P-A).
// Emissao: gera o codigo de 6 digitos, guarda so o HMAC (pepper da API) e o blob cifrado para o envio, e chama
// app.dsr_step_up_issue (limite de 3 por hora, invalida o codigo anterior, enfileira o e-mail em ops.email_outbox).
// Confirmacao: confere o codigo por app.dsr_step_up_confirm e devolve o token de uso unico (so o hash vai ao banco).
// Envio: o decorador DsrStepUpEmailProvider troca a referencia do e-mail pelo codigo em memoria, no instante do envio.
// Nada e logado: codigo, token e pepper nunca saem deste modulo em texto de erro ou registro.
import { randomUUID } from 'node:crypto';
import type {
  EmailMessage,
  EmailProviderPort,
  RecipientDirectoryPort,
  RecipientResolution,
  SendResult,
} from '@fastpro/domain';
import { type SqlClient } from './jobs-tick.js';
import { DsrPayloadInvalido } from './privacy-dsr-jobs.js';
import {
  ChallengeCryptoError,
  challengeHmacHex,
  challengeSha256Hex,
  generateChallengeCode,
  generateChallengeToken,
  openChallengeBlob,
  sealChallengeBlob,
} from './challenges-crypto.js';

/** Modelo e tipo do e-mail do codigo do titular (categoria acesso, classe auth). */
export const DSR_STEPUP_TEMPLATE = 'dsr_stepup';
/** Pepper minimo do HMAC do codigo (PEPPER_CODE_HMAC). */
export const DSR_STEPUP_PEPPER_MIN = 16;
/** Chave AES-256 do blob cifrado (AUTH_CHALLENGE_KEY decodificada: 32 bytes). */
export const DSR_STEPUP_CHAVE_BYTES = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_RE = /^[0-9]{6}$/;

export class DsrStepUpConfiguracaoInvalida extends Error {}

export type DsrStepUpEmissao =
  | { readonly resultado: 'criado'; readonly outboxId: string }
  | { readonly resultado: 'limite' | 'bloqueado'; readonly retryAfter: number }
  | { readonly resultado: 'negado' };

export type DsrStepUpConfirmacao =
  | { readonly resultado: 'ok'; readonly token: string; readonly expiresAt: string }
  | { readonly resultado: 'bloqueado'; readonly retryAfter: number }
  | { readonly resultado: 'invalido' | 'negado' };

export interface DsrStepUpSqlResposta {
  readonly resultado: string;
  readonly outboxId: string | null;
  readonly expiresAt: string | null;
  readonly retryAfter: number | null;
}

/** Porta SQL do step-up (implementada por PgDsrStepUpSql; em testes, por um fake). */
export interface DsrStepUpSqlPort {
  emitir(usuario: string, codigo: string, codigoHmac: string, codigoEnc: Buffer): Promise<DsrStepUpSqlResposta>;
  confirmar(usuario: string, codigoHmac: string, grantHash: string): Promise<DsrStepUpSqlResposta>;
  /** Blob cifrado do codigo ainda vivo; null quando consumido, invalidado, vencido ou inexistente. */
  selado(codigo: string): Promise<Buffer | null>;
}

/** Ponte para as funcoes app.dsr_step_up_* (papel app_system). Nenhuma consulta direta a tabela. */
export class PgDsrStepUpSql implements DsrStepUpSqlPort {
  constructor(private readonly client: SqlClient) {}

  async emitir(usuario: string, codigo: string, codigoHmac: string, codigoEnc: Buffer): Promise<DsrStepUpSqlResposta> {
    const res = await this.client.query(
      'select out_resultado, out_outbox_id, out_retry_after from app.dsr_step_up_issue($1::uuid, $2::uuid, $3, $4::bytea)',
      [usuario, codigo, codigoHmac, codigoEnc],
    );
    return linhaResposta(res.rows[0], 'out_outbox_id');
  }

  async confirmar(usuario: string, codigoHmac: string, grantHash: string): Promise<DsrStepUpSqlResposta> {
    const res = await this.client.query('select out_resultado, out_expires_at, out_retry_after from app.dsr_step_up_confirm($1::uuid, $2, $3)', [
      usuario,
      codigoHmac,
      grantHash,
    ]);
    return linhaResposta(res.rows[0], 'out_expires_at');
  }

  async selado(codigo: string): Promise<Buffer | null> {
    const res = await this.client.query('select out_code_enc from app.dsr_step_up_code_sealed($1::uuid)', [codigo]);
    const linha = res.rows[0] as { out_code_enc?: unknown } | undefined;
    return Buffer.isBuffer(linha?.out_code_enc) ? (linha.out_code_enc as Buffer) : null;
  }
}

function linhaResposta(linha: Record<string, unknown> | undefined, campoExtra: 'out_outbox_id' | 'out_expires_at'): DsrStepUpSqlResposta {
  const extra = linha?.[campoExtra];
  const valorExtra = extra instanceof Date ? extra.toISOString() : typeof extra === 'string' ? extra : null;
  const retry = linha?.out_retry_after;
  return {
    resultado: typeof linha?.out_resultado === 'string' ? linha.out_resultado : 'desconhecido',
    outboxId: campoExtra === 'out_outbox_id' ? valorExtra : null,
    expiresAt: campoExtra === 'out_expires_at' ? valorExtra : null,
    retryAfter: typeof retry === 'number' ? retry : null,
  };
}

/** AAD que amarra o blob ao codigo e a coluna (mesmo formato de challengeAad, com prefixo proprio). */
function aadCodigo(codigoId: string): string {
  return `dsr1|${codigoId}|code_enc`;
}

export interface DsrStepUpDeps {
  readonly sql: DsrStepUpSqlPort;
  /** AUTH_CHALLENGE_KEY decodificada (32 bytes). Nunca registrada. */
  readonly chave: Buffer;
  /** PEPPER_CODE_HMAC. Nunca registrado. */
  readonly pepperCodigo: string;
}

export class ServicoDsrStepUp {
  constructor(private readonly deps: DsrStepUpDeps) {
    if (!Buffer.isBuffer(deps.chave) || deps.chave.length !== DSR_STEPUP_CHAVE_BYTES) {
      throw new DsrStepUpConfiguracaoInvalida();
    }
    if (typeof deps.pepperCodigo !== 'string' || deps.pepperCodigo.length < DSR_STEPUP_PEPPER_MIN) {
      throw new DsrStepUpConfiguracaoInvalida();
    }
  }

  /** Emite o codigo do titular. O codigo em claro existe so em memoria, ate ser cifrado e enviado ao banco. */
  async emitir(usuario: string): Promise<DsrStepUpEmissao> {
    if (!UUID_RE.test(usuario)) throw new DsrPayloadInvalido();
    const codigoId = randomUUID();
    const codigo = generateChallengeCode();
    const hmac = challengeHmacHex(this.deps.pepperCodigo, `${usuario}|${codigo}`);
    const enc = sealChallengeBlob(this.deps.chave, codigo, aadCodigo(codigoId));
    const r = await this.deps.sql.emitir(usuario, codigoId, hmac, enc);
    if (r.resultado === 'criado' && r.outboxId !== null) return { resultado: 'criado', outboxId: r.outboxId };
    if ((r.resultado === 'limite' || r.resultado === 'bloqueado') && r.retryAfter !== null) {
      return { resultado: r.resultado, retryAfter: r.retryAfter };
    }
    return { resultado: 'negado' };
  }

  /** Troca o codigo digitado pelo token de uso unico (15 min). Formato errado nao chega ao banco. */
  async confirmar(usuario: string, codigo: string): Promise<DsrStepUpConfirmacao> {
    if (!UUID_RE.test(usuario) || typeof codigo !== 'string' || !CODIGO_RE.test(codigo)) {
      return { resultado: 'invalido' };
    }
    const hmac = challengeHmacHex(this.deps.pepperCodigo, `${usuario}|${codigo}`);
    const token = generateChallengeToken();
    const r = await this.deps.sql.confirmar(usuario, hmac, challengeSha256Hex(token));
    if (r.resultado === 'ok' && r.expiresAt !== null) return { resultado: 'ok', token, expiresAt: r.expiresAt };
    if (r.resultado === 'bloqueado') return { resultado: 'bloqueado', retryAfter: r.retryAfter ?? 1 };
    return { resultado: r.resultado === 'negado' ? 'negado' : 'invalido' };
  }

  /** Codigo em claro de um envio pendente (uso do decorador). Blob invalido ou ausente devolve null. */
  async codigoParaEnvio(codigoId: string): Promise<string | null> {
    if (!UUID_RE.test(codigoId)) return null;
    const blob = await this.deps.sql.selado(codigoId);
    if (blob === null) return null;
    try {
      const plano = openChallengeBlob(this.deps.chave, blob, aadCodigo(codigoId));
      return CODIGO_RE.test(plano) ? plano : null;
    } catch (erro) {
      if (erro instanceof ChallengeCryptoError) return null;
      throw erro;
    }
  }
}

/**
 * Envolve o provedor real para o modelo dsr_stepup: troca a referencia (challenge_ref) pelo codigo, em memoria,
 * no instante do envio. Outros modelos seguem sem alteracao. A entrega real so ocorre pelo pipeline e pela cota.
 */
export class DsrStepUpEmailProvider implements EmailProviderPort {
  readonly name: string;

  constructor(
    private readonly inner: EmailProviderPort,
    private readonly servico: ServicoDsrStepUp,
    private readonly minutos: number,
  ) {
    this.name = inner.name;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (message.templateKey !== DSR_STEPUP_TEMPLATE) return this.inner.send(message);
    const id = message.params.challenge_ref;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return { kind: 'recusa_permanente', code: 'desafio_inativo' };
    const codigo = await this.servico.codigoParaEnvio(id);
    if (codigo === null) return { kind: 'recusa_permanente', code: 'segredo_indisponivel' };
    return this.inner.send({ ...message, params: { code: codigo, minutos: this.minutos } });
  }
}

/**
 * Diretorio do titular para o envio dsr_stepup (P-C). O destinatario e o proprio titular: o e-mail cadastrado
 * (app.app_user) e lido so no instante do envio, em memoria, e nunca gravado fora da tabela de usuarios.
 * Conta bloqueada nao recebe (suprimido); usuario inexistente ou id mal formado vira inexistente.
 */
export class PgDsrTitularDirectory implements RecipientDirectoryPort {
  constructor(private readonly client: SqlClient) {}

  async resolve(usuario: string): Promise<RecipientResolution> {
    if (!UUID_RE.test(usuario)) return { status: 'inexistente' };
    const res = await this.client.query('select email, status from app.app_user where id = $1::uuid', [usuario]);
    const linha = res.rows[0] as { email?: unknown; status?: unknown } | undefined;
    if (linha === undefined || typeof linha.email !== 'string') return { status: 'inexistente' };
    if (linha.status !== 'ativo') return { status: 'suprimido' };
    return { status: 'ok', email: linha.email };
  }
}
