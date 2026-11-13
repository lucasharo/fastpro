// H-037 (Issue #50) | Storage dos documentos (107-DESENHO-H037.md, §2 D-1 e D-3). Tres portas, uma classe por
// finalidade. NENHUMA delas usa bucket, chave ou tabela de foto (R6, T-19). A classe do bucket
// final NAO tem metodo de leitura, URL assinada de leitura nem listagem (CA-06, CA-19). Endpoints REST seguem o
// padrao REST ja usado no projeto e estao [NAO VERIFICADO] contra o Storage remoto (ver entrega).
// Nomes dos buckets espelham packages/domain/src/identity-docs/constants.ts (o db nao importa o dominio ate a fase 2).
export const IDOC_INCOMING_BUCKET = 'identity-incoming' as const;
export const IDOC_FINAL_BUCKET = 'identity-docs' as const;

export class IdentityDocStorageError extends Error {
  readonly code = 'storage_falha' as const;
  constructor() {
    super('storage_falha');
    this.name = 'IdentityDocStorageError';
  }
}

export interface IdentityDocStorageOpcoes {
  /** URL base do projeto (sem barra final). Vem do ambiente. */
  readonly baseUrl: string;
  /** Chave de servico do Storage. Vem do ambiente do servidor; nunca e registrada. */
  readonly serviceKey: string;
  readonly fetchImpl?: typeof fetch;
}

/** Base comum: cabecalhos com a chave de servico e chamada HTTP que vira erro fixo. */
abstract class BaseIdentityDocStorage {
  protected readonly fetchImpl: typeof fetch;

  constructor(protected readonly opts: IdentityDocStorageOpcoes) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  protected cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey, ...extra };
  }

  protected async chamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch {
      throw new IdentityDocStorageError();
    }
  }

  protected objeto(bucket: string, chave: string): string {
    return `${this.opts.baseUrl}/storage/v1/object/${bucket}/${chave}`;
  }

  protected async statObjeto(bucket: string, chave: string): Promise<{ readonly bytes: number } | null> {
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/info/${bucket}/${chave}`, {
      method: 'GET',
      headers: this.cabecalhos(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new IdentityDocStorageError();
    const corpo = (await res.json().catch(() => null)) as { size?: unknown } | null;
    if (corpo === null || typeof corpo.size !== 'number') throw new IdentityDocStorageError();
    return { bytes: corpo.size };
  }

  protected async remover(bucket: string, chave: string): Promise<void> {
    const res = await this.chamar(this.objeto(bucket, chave), { method: 'DELETE', headers: this.cabecalhos() });
    if (res.status === 404) return;
    if (!res.ok) throw new IdentityDocStorageError();
  }
}

/**
 * Entrada (`identity-incoming`, chave `s/<uuid>`). Emite a URL de envio de uso unico e le o objeto uma vez, so para
 * a finalizacao. Nunca chamada por rota de leitura. O prazo do token e o do proprio Storage (ttlS e so informativo).
 */
export class SupabaseIdentityDocStagingStorage extends BaseIdentityDocStorage {
  async createUploadUrl(chave: string): Promise<string> {
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/upload/sign/${IDOC_INCOMING_BUCKET}/${chave}`, {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': 'application/json' }),
      body: '{}',
    });
    if (!res.ok) throw new IdentityDocStorageError();
    const corpo = (await res.json().catch(() => null)) as { url?: unknown } | null;
    if (corpo === null || typeof corpo.url !== 'string' || corpo.url.length === 0) throw new IdentityDocStorageError();
    const relativo = corpo.url.startsWith('/storage/v1') ? corpo.url : `/storage/v1${corpo.url}`;
    return `${this.opts.baseUrl}${relativo}`;
  }

  stat(chave: string): Promise<{ readonly bytes: number } | null> {
    return this.statObjeto(IDOC_INCOMING_BUCKET, chave);
  }

  async read(chave: string): Promise<Uint8Array | null> {
    const res = await this.chamar(this.objeto(IDOC_INCOMING_BUCKET, chave), { method: 'GET', headers: this.cabecalhos() });
    if (res.status === 404) return null;
    if (!res.ok) throw new IdentityDocStorageError();
    return new Uint8Array(await res.arrayBuffer());
  }

  remove(chave: string): Promise<void> {
    return this.remover(IDOC_INCOMING_BUCKET, chave);
  }

  /** Chaves `s/<nome>` mais antigas que a idade dada (varredura de orfaos, 107 §6.5). */
  async listOlderThan(olderThanMs: number, limit: number): Promise<readonly string[]> {
    const res = await this.chamar(`${this.opts.baseUrl}/storage/v1/object/list/${IDOC_INCOMING_BUCKET}`, {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: 's', limit, offset: 0, sortBy: { column: 'created_at', order: 'asc' } }),
    });
    if (!res.ok) throw new IdentityDocStorageError();
    const itens = (await res.json().catch(() => null)) as { name?: unknown; created_at?: unknown }[] | null;
    if (!Array.isArray(itens)) throw new IdentityDocStorageError();
    const limiteCriacao = Date.now() - olderThanMs;
    const chaves: string[] = [];
    for (const item of itens) {
      if (typeof item.name !== 'string' || typeof item.created_at !== 'string') continue;
      if (Date.parse(item.created_at) <= limiteCriacao) chaves.push(`s/${item.name}`);
    }
    return chaves;
  }
}

/**
 * Final (`identity-docs`, chave `i/<uuid>`). So grava, confere e remove. SEM leitura, SEM URL de leitura e SEM
 * listagem (CA-06, CA-19). A leitura da Verificacao fica numa porta separada, da #52.
 */
export class SupabaseIdentityDocFinalStorage extends BaseIdentityDocStorage {
  async put(id: string, bytes: Uint8Array, tipo: 'image/jpeg' | 'application/pdf'): Promise<void> {
    const res = await this.chamar(this.objeto(IDOC_FINAL_BUCKET, `i/${id}`), {
      method: 'POST',
      headers: this.cabecalhos({ 'content-type': tipo, 'x-upsert': 'true' }),
      body: bytes,
    });
    if (!res.ok) throw new IdentityDocStorageError();
  }

  stat(id: string): Promise<{ readonly bytes: number } | null> {
    return this.statObjeto(IDOC_FINAL_BUCKET, `i/${id}`);
  }

  remove(id: string): Promise<void> {
    return this.remover(IDOC_FINAL_BUCKET, `i/${id}`);
  }
}
