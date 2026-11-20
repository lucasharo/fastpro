// Issue 120 (H-111) | Download do extrato de acesso por token de uso unico (147-DESENHO-H111 D-A6, §5.1, §6.2).
// O token (256 bits, aleatorio) so existe na resposta: o banco guarda o SHA-256 (app.dsr_issue_extract_token) e o
// consumo e atomico (app.dsr_consume_extract_token). Antes de devolver o conteudo, o servico confere sha256 e HMAC
// com a chave de servidor. Token, conteudo e chave nunca sao logados.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { type SqlClient } from './jobs-tick.js';
import { DsrPayloadInvalido } from './privacy-dsr-jobs.js';
import { DSR_EXTRATO_CHAVE_MIN, DsrExtratoChaveInvalida } from './privacy-dsr-extrato.js';

/** Validade do token (D-A6). A regra vive no banco (5 min, limitada a validade do extrato); a constante documenta. */
export const DSR_TOKEN_VALIDADE_SEGUNDOS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32 bytes em base64url (sem preenchimento) tem 43 caracteres. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Motivos que o banco devolve (codigos fixos, sem dado pessoal). A API responde uniforme para os de posse. */
const MOTIVOS_DO_BANCO = [
  'dsr_nao_encontrado',
  'dsr_extrato_indisponivel',
  'dsr_token_invalido',
  'dsr_token_usado',
  'dsr_token_expirado',
] as const;

export class DsrDownloadRecusado extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
  }
}

/** Conteudo baixado nao confere com o registro (sha256 ou HMAC). O token ja foi consumido: nada e devolvido. */
export class DsrExtratoIntegridadeFalha extends Error {}

export interface DsrDownloadEmitido {
  readonly token: string;
  readonly expiresAt: string;
}

export interface DsrDownloadRegistro {
  readonly caseId: string;
  readonly subjectUserId: string;
  readonly storagePath: string;
  readonly sha256: string;
  readonly signature: string;
  readonly sizeBytes: number;
  readonly expiresAt: string;
}

/** Leitura do arquivo do extrato no bucket privado (implementada por SupabaseStorageExtratos.ler). */
export interface DsrExtratoLeituraPort {
  ler(caminho: string): Promise<Uint8Array>;
}

/** Porta SQL do download (implementada por PgDsrDownloadSql). Recebe so o hash do token. */
export interface DsrDownloadSqlPort {
  emitir(sujeito: string, caso: string, tokenHash: string): Promise<{ expiresAt: string }>;
  consumir(tokenHash: string): Promise<DsrDownloadRegistro>;
}

function sha256Hex(conteudo: string | Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

function iso(valor: unknown): string {
  return valor instanceof Date ? valor.toISOString() : String(valor ?? '');
}

/** Converte a mensagem de erro do banco no motivo fixo; outros erros seguem sem mudanca. */
function recusaDoBanco(err: unknown): DsrDownloadRecusado | undefined {
  const mensagem = err instanceof Error ? err.message : '';
  const achado = MOTIVOS_DO_BANCO.find((motivo) => mensagem.includes(motivo));
  return achado ? new DsrDownloadRecusado(achado) : undefined;
}

/** Acesso SQL das funcoes app.dsr_issue_extract_token e app.dsr_consume_extract_token. */
export class PgDsrDownloadSql implements DsrDownloadSqlPort {
  constructor(private readonly client: SqlClient) {}

  async emitir(sujeito: string, caso: string, tokenHash: string): Promise<{ expiresAt: string }> {
    try {
      const res = await this.client.query(
        'select out_expires_at from app.dsr_issue_extract_token($1::uuid, $2::uuid, $3)',
        [sujeito, caso, tokenHash],
      );
      const linha = res.rows[0] as { out_expires_at?: unknown } | undefined;
      return { expiresAt: iso(linha?.out_expires_at) };
    } catch (err) {
      throw recusaDoBanco(err) ?? err;
    }
  }

  async consumir(tokenHash: string): Promise<DsrDownloadRegistro> {
    try {
      const res = await this.client.query('select * from app.dsr_consume_extract_token($1)', [tokenHash]);
      const linha = res.rows[0] as Record<string, unknown> | undefined;
      if (!linha) throw new DsrDownloadRecusado('dsr_token_invalido');
      return {
        caseId: String(linha.out_case_id),
        subjectUserId: String(linha.out_subject_user_id),
        storagePath: String(linha.out_storage_path),
        sha256: String(linha.out_sha256),
        signature: String(linha.out_signature),
        sizeBytes: Number(linha.out_size_bytes),
        expiresAt: iso(linha.out_expires_at),
      };
    } catch (err) {
      throw recusaDoBanco(err) ?? err;
    }
  }
}

export class ServicoDownloadExtrato {
  private readonly chave: Buffer;

  constructor(
    private readonly deps: {
      readonly sql: DsrDownloadSqlPort;
      readonly arquivos: DsrExtratoLeituraPort;
      /** Chave de assinatura do servidor (mesma do GeradorExtratoDsr). Nunca vai ao banco. */
      readonly chaveAssinatura: string;
    },
  ) {
    if (typeof deps.chaveAssinatura !== 'string' || deps.chaveAssinatura.length < DSR_EXTRATO_CHAVE_MIN) {
      throw new DsrExtratoChaveInvalida();
    }
    this.chave = Buffer.from(deps.chaveAssinatura, 'utf8');
  }

  /** Emite o token do titular dono do caso. O token em claro so sai nesta resposta; o banco guarda o hash. */
  async emitir(sujeito: string, caso: string): Promise<DsrDownloadEmitido> {
    if (!UUID_RE.test(sujeito) || !UUID_RE.test(caso)) throw new DsrPayloadInvalido();
    const token = randomBytes(32).toString('base64url');
    const { expiresAt } = await this.deps.sql.emitir(sujeito, caso, sha256Hex(token));
    return { token, expiresAt };
  }

  /** Consome o token (uso unico), le o arquivo e confere sha256 e HMAC antes de devolver. */
  async baixar(token: string): Promise<{ conteudo: Uint8Array; sha256: string; caseId: string; expiresAt: string }> {
    // Formato errado nao chega ao banco: a recusa e a mesma de token desconhecido.
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new DsrDownloadRecusado('dsr_token_invalido');
    const registro = await this.deps.sql.consumir(sha256Hex(token));
    const conteudo = await this.deps.arquivos.ler(registro.storagePath);
    const sha = sha256Hex(conteudo);
    const assinatura = createHmac('sha256', this.chave).update(conteudo).digest('hex');
    if (sha !== registro.sha256 || !hexIgual(assinatura, registro.signature)) {
      throw new DsrExtratoIntegridadeFalha();
    }
    return { conteudo, sha256: sha, caseId: registro.caseId, expiresAt: registro.expiresAt };
  }
}

function hexIgual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

