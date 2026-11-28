// H-110 (Issue 119) | Adaptador de Storage da quarentena (docs/factory/105-DESENHO-H110.md §3, "Adaptador de Storage proprio").
// Lista permitida de um unico bucket (quarantine) e validacao de nome. Nao reutiliza SupabaseStorageRetencao, para
// nao ampliar a lista de buckets de H-109. Erro com codigo fixo: sem URL, chave ou caminho na mensagem.
// 404 = objeto ja ausente = sucesso (mesma regra de CA-H109-09). A prova com Storage real esta pendente (A-4 de H-109).

export const BUCKET_QUARENTENA = 'quarantine' as const;

/** Nome de objeto: caminho relativo ao bucket, sem barra inicial, sem ".." e com alfabeto restrito. */
const NOME_VALIDO = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,299}$/;

export function nomeDeQuarentenaValido(nome: string): boolean {
  return NOME_VALIDO.test(nome) && !nome.split('/').some((parte) => parte === '..' || parte === '');
}

export class QuarentenaStorageError extends Error {
  readonly code: 'objeto_recusado' | 'storage_falha';
  constructor(code: 'objeto_recusado' | 'storage_falha') {
    super(code);
    this.name = 'QuarentenaStorageError';
    this.code = code;
  }
}

export interface QuarentenaStorageOpcoes {
  /** URL base do projeto (sem barra final). Vem do ambiente, nunca de codigo. */
  readonly baseUrl: string;
  /** Chave de servico do Storage. Vem do ambiente do job; nunca e registrada. */
  readonly serviceKey: string;
  readonly fetchImpl?: typeof fetch;
}

export class SupabaseStorageQuarentena {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QuarentenaStorageOpcoes) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Remove o objeto do bucket quarentena. 404 e sucesso; nome fora do padrao e recusado antes da rede. */
  async remover(nome: string): Promise<void> {
    if (!nomeDeQuarentenaValido(nome)) {
      throw new QuarentenaStorageError('objeto_recusado');
    }
    const caminho = nome.split('/').map(encodeURIComponent).join('/');
    const url = `${this.opts.baseUrl}/storage/v1/object/${BUCKET_QUARENTENA}/${caminho}`;
    let status: number;
    try {
      const res = await this.fetchImpl(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.opts.serviceKey}`, apikey: this.opts.serviceKey },
      });
      status = res.status;
    } catch {
      throw new QuarentenaStorageError('storage_falha');
    }
    if ((status >= 200 && status < 300) || status === 404) return;
    throw new QuarentenaStorageError('storage_falha');
  }
}
