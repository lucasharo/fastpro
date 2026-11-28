// H-056 (Issue 69) | Acesso as fotos elegiveis no banco (docs/factory/167-DESENHO-H056.md, §3 e §4.2).
// So chama private.request_photo_* com o papel app_system. Negacao vira null (lista e alvo) ou false (acesso).
// Formato fora do esperado e erro do driver viram PhotoViewStoreError com codigo fixo: nenhum texto de banco sai daqui.
import type { PhotoTarget, PhotoViewRow, PhotoViewStorePort } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const FOTO_ACESSO_FALHOU = 'foto_acesso_falhou';

/** Erro com texto fixo: o codigo e o unico detalhe que sai do adaptador. */
export class PhotoViewStoreError extends Error {
  readonly code: typeof FOTO_ACESSO_FALHOU;

  constructor() {
    super(FOTO_ACESSO_FALHOU);
    this.name = 'PhotoViewStoreError';
    this.code = FOTO_ACESSO_FALHOU;
  }
}

const SQL_LIST =
  'select out_id, out_pos, out_width, out_height from private.request_photo_list($1::uuid, $2::uuid, $3::timestamptz)';
const SQL_TARGET =
  'select out_bytes, out_width, out_height from private.request_photo_target($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)';
const SQL_OWNER_LIST = 'select out_id, out_pos, out_width, out_height from private.request_photo_owner_list($1::uuid, $2::uuid)';
const SQL_OWNER_TARGET =
  'select out_bytes, out_width, out_height from private.request_photo_owner_target($1::uuid, $2::uuid, $3::uuid)';
const SQL_ACCESS =
  'select private.request_photo_access($1::uuid, $2::uuid, $3::uuid, $4::timestamptz) as out_ok';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Linha = Record<string, unknown>;

function formatoInvalido(): never {
  throw new PhotoViewStoreError();
}

function inteiroPositivo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

/** Zero linhas = negado (null). Uma linha com id nulo = autorizado sem foto pronta ([]). Senao, uma linha por foto. */
function listaDe(linhas: readonly unknown[]): PhotoViewRow[] | null {
  if (linhas.length === 0) return null;
  if (linhas.length === 1 && (linhas[0] as Linha).out_id === null) return [];
  return linhas.map((bruta) => {
    const l = bruta as Linha;
    const id = l.out_id;
    const ordem = l.out_pos;
    const largura = l.out_width;
    const altura = l.out_height;
    if (typeof id !== 'string' || !UUID_RE.test(id)) formatoInvalido();
    if (typeof ordem !== 'number' || !Number.isInteger(ordem)) formatoInvalido();
    if (!inteiroPositivo(largura) || !inteiroPositivo(altura)) formatoInvalido();
    return { id, sortOrder: ordem, width: largura, height: altura };
  });
}

/** Zero linhas = negado (null). Uma linha com bytes, largura e altura positivos = alvo. */
function alvoDe(linhas: readonly unknown[]): PhotoTarget | null {
  if (linhas.length === 0) return null;
  if (linhas.length !== 1) formatoInvalido();
  const l = linhas[0] as Linha;
  const bytes = l.out_bytes;
  const largura = l.out_width;
  const altura = l.out_height;
  if (!inteiroPositivo(bytes) || !inteiroPositivo(largura) || !inteiroPositivo(altura)) formatoInvalido();
  return { bytes, width: largura, height: altura };
}

function acessoDe(linhas: readonly unknown[]): boolean {
  if (linhas.length !== 1) formatoInvalido();
  const ok = (linhas[0] as Linha).out_ok;
  if (typeof ok !== 'boolean') formatoInvalido();
  return ok;
}

/** Adaptador da porta de fotos: papel app_system, sem escrita. Qualquer falha vira PhotoViewStoreError. */
export class PgPhotoViewStore implements PhotoViewStorePort {
  constructor(private readonly client: SqlClient) {}

  async list(professionalId: string, requestId: string, nowMs: number): Promise<readonly PhotoViewRow[] | null> {
    return this.executar(async () =>
      listaDe(
        (await this.client.query(SQL_LIST, [professionalId, requestId, new Date(nowMs).toISOString()])).rows,
      ),
    );
  }

  async target(
    professionalId: string,
    requestId: string,
    photoId: string,
    nowMs: number,
  ): Promise<PhotoTarget | null> {
    return this.executar(async () =>
      alvoDe(
        (await this.client.query(SQL_TARGET, [professionalId, requestId, photoId, new Date(nowMs).toISOString()])).rows,
      ),
    );
  }

  async ownerList(customerId: string, requestId: string): Promise<readonly PhotoViewRow[] | null> {
    return this.executar(async () => listaDe((await this.client.query(SQL_OWNER_LIST, [customerId, requestId])).rows));
  }

  async ownerTarget(customerId: string, requestId: string, photoId: string): Promise<PhotoTarget | null> {
    return this.executar(async () =>
      alvoDe((await this.client.query(SQL_OWNER_TARGET, [customerId, requestId, photoId])).rows),
    );
  }

  async access(requestId: string, professionalId: string, photoId: string | null, nowMs: number): Promise<boolean> {
    return this.executar(async () =>
      acessoDe(
        (
          await this.client.query(SQL_ACCESS, [requestId, professionalId, photoId, new Date(nowMs).toISOString()])
        ).rows,
      ),
    );
  }

  private async executar<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      if (erro instanceof PhotoViewStoreError) throw erro;
      throw new PhotoViewStoreError();
    }
  }
}
