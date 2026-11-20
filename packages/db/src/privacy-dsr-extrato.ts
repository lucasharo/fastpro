// Issue 120 (H-111) | Geracao do extrato de acesso (docs/factory/147-DESENHO-H111.md §4.3, §6.2; fatia 7 no SQL).
// Fluxo: app.dsr_admin_generate_extract devolve o JSON canonico (texto); o servico grava o arquivo no bucket privado
// com nome aleatorio, calcula sha256 e HMAC-SHA256 com chave de servidor (so em memoria, nunca no banco) e registra
// com app.dsr_register_extract. Se o registro falhar, o arquivo gravado e apagado (compensacao). Nada e logado: o
// conteudo do extrato e dado pessoal. A chave de assinatura chega por parametro (o ambiente a le na composicao).
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { type SqlClient } from './jobs-tick.js';
import { DsrPayloadInvalido, DsrRetornoDesconhecido, type DsrExtratosArquivosPort } from './privacy-dsr-jobs.js';

/** Limite do banco (dsr_export_tamanho_check): 10 MiB. */
export const DSR_EXTRATO_TAMANHO_MAX_BYTES = 10_485_760;
/** Chave de assinatura com pelo menos 32 caracteres (256 bits em texto). */
export const DSR_EXTRATO_CHAVE_MIN = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DsrExtratoChaveInvalida extends Error {}
export class DsrExtratoTamanhoInvalido extends Error {}

export interface DsrExtratoRegistro {
  readonly status: string;
  readonly expiresAt: string;
}

/** Porta SQL da geracao (implementada por PgDsrExtratoSql). */
export interface DsrExtratoSqlPort {
  gerarPayload(ator: string, caso: string): Promise<string>;
  registrar(caso: string, caminho: string, sha256: string, assinatura: string, tamanho: number): Promise<DsrExtratoRegistro>;
}

/** Arquivos do extrato: gravar (nome aleatorio, sem sobrescrita) e remover (compensacao e expurgo). */
export interface DsrExtratoArquivosPort extends DsrExtratosArquivosPort {
  gravar(caminho: string, conteudo: Uint8Array): Promise<void>;
}

export interface DsrExtratoGerado {
  readonly caminho: string;
  readonly sha256: string;
  readonly tamanho: number;
  readonly expiresAt: string;
}

/** Acesso SQL das funcoes app.dsr_admin_generate_extract e app.dsr_register_extract. */
export class PgDsrExtratoSql implements DsrExtratoSqlPort {
  constructor(private readonly client: SqlClient) {}

  async gerarPayload(ator: string, caso: string): Promise<string> {
    const res = await this.client.query(
      'select out_payload from app.dsr_admin_generate_extract($1::uuid, $2::uuid)',
      [ator, caso],
    );
    const linha = res.rows[0] as { out_payload?: unknown } | undefined;
    if (typeof linha?.out_payload !== 'string') throw new DsrRetornoDesconhecido();
    return linha.out_payload;
  }

  async registrar(caso: string, caminho: string, sha256: string, assinatura: string, tamanho: number): Promise<DsrExtratoRegistro> {
    const res = await this.client.query(
      'select out_status, out_expires_at from app.dsr_register_extract($1::uuid, $2, $3, $4, $5::integer)',
      [caso, caminho, sha256, assinatura, tamanho],
    );
    const linha = res.rows[0] as { out_status?: string; out_expires_at?: unknown } | undefined;
    return {
      status: linha?.out_status ?? 'desconhecido',
      expiresAt: linha?.out_expires_at instanceof Date ? linha.out_expires_at.toISOString() : String(linha?.out_expires_at ?? ''),
    };
  }
}

export class GeradorExtratoDsr {
  private readonly chave: Buffer;

  constructor(
    private readonly deps: {
      readonly sql: DsrExtratoSqlPort;
      readonly arquivos: DsrExtratoArquivosPort;
      readonly chaveAssinatura: string;
      readonly novoCaminho?: () => string;
    },
  ) {
    if (typeof deps.chaveAssinatura !== 'string' || deps.chaveAssinatura.length < DSR_EXTRATO_CHAVE_MIN) {
      throw new DsrExtratoChaveInvalida();
    }
    this.chave = Buffer.from(deps.chaveAssinatura, 'utf8');
  }

  /** Gera, grava e registra o extrato de um caso de acesso deferido. Ator e caso sao UUID validados antes do banco. */
  async gerar(ator: string, caso: string): Promise<DsrExtratoGerado> {
    if (!UUID_RE.test(ator) || !UUID_RE.test(caso)) throw new DsrPayloadInvalido();

    const payload = await this.deps.sql.gerarPayload(ator, caso);
    const bytes = Buffer.from(payload, 'utf8');
    if (bytes.length === 0 || bytes.length > DSR_EXTRATO_TAMANHO_MAX_BYTES) throw new DsrExtratoTamanhoInvalido();

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const assinatura = createHmac('sha256', this.chave).update(bytes).digest('hex');
    const caminho = this.deps.novoCaminho?.() ?? `${randomUUID()}.json`;

    await this.deps.arquivos.gravar(caminho, bytes);
    let registro: DsrExtratoRegistro;
    try {
      registro = await this.deps.sql.registrar(caso, caminho, sha256, assinatura, bytes.length);
    } catch (err) {
      // Registro recusado (nenhuma linha gravada): o arquivo nao tem dono. Se a remocao falhar, o erro original segue.
      await this.deps.arquivos.remover(caminho).catch(() => undefined);
      throw err;
    }
    // Depois do registro commitado o arquivo e do titular: nunca se apaga aqui, mesmo que a resposta se perca.
    return { caminho, sha256, tamanho: bytes.length, expiresAt: registro.expiresAt };
  }
}
