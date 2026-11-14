// Issue 47 (H-034) | Adaptador Pg da lista do painel do cliente (docs/factory/133-DESENHO-H034.md, §5, §9).
// So chama private.request_list_owner, papel app_system. Recebe o SqlClient injetado: nao abre conexao nem le variavel
// de ambiente. Mapeia so a lista fechada (sem endereco, contato, coordenada, dono ou contador). Erro do banco nunca e
// repassado: vira o codigo fixo LISTA_BANCO_FALHOU, sem texto do driver.
import type { SqlClient } from './jobs-tick.js';

export const SQL_LIST_OWNER =
  'select * from private.request_list_owner($1::uuid, $2::timestamptz, $3::timestamptz, $4::uuid, $5::integer)';

/** Erro fixo: nunca carrega texto de driver, cursor, endereco ou identificador. */
export const LISTA_BANCO_FALHOU = 'lista_banco_falhou';

/** Cursor ja validado pela borda (texto com microssegundos e uuid). */
export interface RequestListCursorInput {
  readonly publishedAt: string;
  readonly id: string;
}

export type RequestListPrazo = 'aberto' | 'encerrado' | null;

/** Linha da lista, so com as chaves fechadas. cursorTs e o texto exato do banco (preserva microssegundos). */
export interface RequestListRow {
  readonly id: string;
  readonly serviceName: string;
  readonly status: string;
  readonly prazo: RequestListPrazo;
  readonly publishedAt: string;
  readonly acceptanceDeadlineAt: string;
  readonly cursorTs: string;
}

export interface RequestListStorePort {
  listOwner(
    userId: string,
    nowMs: number,
    cursor: RequestListCursorInput | null,
    limit: number,
  ): Promise<readonly RequestListRow[]>;
}

type Linha = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : String(valor ?? '');
}

function instante(valor: unknown): string {
  return valor instanceof Date ? valor.toISOString() : texto(valor);
}

function prazo(valor: unknown): RequestListPrazo {
  return valor === 'aberto' || valor === 'encerrado' ? valor : null;
}

function linha(r: Linha): RequestListRow {
  return {
    id: texto(r.out_id),
    serviceName: texto(r.out_service_name),
    status: texto(r.out_status),
    prazo: prazo(r.out_deadline_state),
    publishedAt: instante(r.out_published_at),
    acceptanceDeadlineAt: instante(r.out_deadline_at),
    cursorTs: texto(r.out_cursor_ts),
  };
}

export class PgRequestListStore implements RequestListStorePort {
  constructor(private readonly client: SqlClient) {}

  /** Lista uma pagina do dono (limite 1 a 21; a rota busca 21 para saber se ha proxima pagina). */
  async listOwner(
    userId: string,
    nowMs: number,
    cursor: RequestListCursorInput | null,
    limit: number,
  ): Promise<readonly RequestListRow[]> {
    let rows: Linha[];
    try {
      const r = await this.client.query(SQL_LIST_OWNER, [
        userId,
        new Date(nowMs).toISOString(),
        cursor?.publishedAt ?? null,
        cursor?.id ?? null,
        limit,
      ]);
      rows = r.rows as Linha[];
    } catch {
      throw new Error(LISTA_BANCO_FALHOU);
    }
    return rows.map(linha);
  }
}
