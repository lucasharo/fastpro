// H-110 (Issue 119) | Adaptador Pg dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §2, §3, §6).
// Cada metodo e uma chamada a uma funcao private.ops_purge_* (ou a uma funcao de H-026 ja concedida a app_system).
// Parametros sempre posicionais; nenhum SQL e montado com entrada de fora. Erros do banco viram codigo fixo.
import type { SqlClient } from './jobs-tick.js';
import type { EstadoBlocoOpsPurge, ResultadoLoteOpsPurge } from '@fastpro/domain';

const ESTADOS: ReadonlySet<string> = new Set([
  'ok', 'desligado', 'ocupado', 'pulado_ausente', 'pulado_incompativel',
]);

interface LinhaBloco {
  readonly out_estado: string;
  readonly out_removidos: number | string;
  readonly out_retidos: number | string;
  readonly out_falhos: number | string;
}

function paraResultado(linha: LinhaBloco | undefined): ResultadoLoteOpsPurge {
  // Sem linha ou estado fora da lista fechada: falha do bloco, contada como uma falha.
  if (!linha || !ESTADOS.has(linha.out_estado)) return { estado: 'falha', removidos: 0, retidos: 0, falhos: 1 };
  return {
    estado: linha.out_estado as EstadoBlocoOpsPurge,
    removidos: Number(linha.out_removidos),
    retidos: Number(linha.out_retidos),
    falhos: Number(linha.out_falhos),
  };
}

/** Funcoes SQL de bloco que retornam (out_estado, out_removidos, out_retidos, out_falhos). */
export type FuncaoBlocoOpsPurge =
  | 'ops_purge_auth_challenge'
  | 'ops_purge_session'
  | 'ops_purge_draft'
  | 'ops_purge_media_mark'
  | 'ops_purge_provider_event'
  | 'ops_purge_outbox_event'
  | 'ops_purge_email_outbox'
  | 'ops_purge_idempotency';

export class PgOpsPurgeStore {
  constructor(private readonly client: SqlClient) {}

  /** Executa um bloco SQL e devolve o resultado do lote. Erro de banco vira falha do bloco (codigo fixo). */
  async bloco(funcao: FuncaoBlocoOpsPurge, agora: number, limite: number): Promise<ResultadoLoteOpsPurge> {
    try {
      const res = await this.client.query(
        `select out_estado, out_removidos, out_retidos, out_falhos from private.${funcao}($1::timestamptz, $2::integer)`,
        [new Date(agora).toISOString(), limite],
      );
      return paraResultado(res.rows[0] as unknown as LinhaBloco | undefined);
    } catch {
      return { estado: 'falha', removidos: 0, retidos: 0, falhos: 1 };
    }
  }

  /** Lista de ids de linhas de quarentena com original a remover (sobras de H-026). */
  async sobrasOriginais(limite: number): Promise<readonly string[]> {
    const res = await this.client.query('select private.media_original_cleanup_list($1::integer) as ids', [limite]);
    return ((res.rows[0] as { ids: string[] | null }).ids ?? []).map(String);
  }

  /** Marca que o original de uma foto ready/rejected saiu do Storage (somente depois da remocao do objeto). */
  async marcarOriginalRemovido(id: string, agora: number): Promise<boolean> {
    const res = await this.client.query('select private.media_original_removed($1::uuid, $2::timestamptz) as ok', [
      id,
      new Date(agora).toISOString(),
    ]);
    return (res.rows[0] as { ok: boolean }).ok === true;
  }

  /** Ids marcados para expurgo cujo objeto ainda deve sair da quarentena. */
  async marcados(limite: number): Promise<readonly string[]> {
    const res = await this.client.query('select private.ops_purge_media_marcados($1::integer) as ids', [limite]);
    return ((res.rows[0] as { ids: string[] | null }).ids ?? []).map(String);
  }

  /** Apaga as linhas de midia cujo objeto ja saiu (H-026, media_purge_done). Devolve quantas sairam. */
  async concluirMarcados(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.client.query('select private.media_purge_done($1::uuid[]) as n', [ids]);
    return Number((res.rows[0] as { n: number | string }).n);
  }

  /** Adia (fim da fila de marcados) as fotos cuja remocao falhou, para uma falha persistente nao travar o lote. */
  async adiarMarcados(ids: readonly string[], agora: number): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.client.query('select private.ops_purge_media_adia($1::uuid[], $2::timestamptz) as n', [
      ids,
      new Date(agora).toISOString(),
    ]);
    return Number((res.rows[0] as { n: number | string }).n);
  }

  /**
   * Orfaos do bucket quarantine (E9). O SQL ja filtra (padrao uuid e sem linha em app.media_asset) e devolve so
   * os nomes orfaos, ate o limite; os fora do padrao vem como contagem em retidos. Nomes nao vao para log.
   */
  async orfaos(agora: number, limite: number): Promise<{ estado: EstadoBlocoOpsPurge; nomes: readonly string[]; retidos: number }> {
    try {
      const res = await this.client.query(
        'select out_estado, out_nomes, out_retidos from private.ops_purge_media_orfaos($1::timestamptz, $2::integer)',
        [new Date(agora).toISOString(), limite],
      );
      const row = res.rows[0] as { out_estado: string; out_nomes: string[] | null; out_retidos: number | string } | undefined;
      if (!row || !ESTADOS.has(row.out_estado)) return { estado: 'falha', nomes: [], retidos: 0 };
      return {
        estado: row.out_estado as EstadoBlocoOpsPurge,
        nomes: (row.out_nomes ?? []).map(String),
        retidos: Number(row.out_retidos),
      };
    } catch {
      return { estado: 'falha', nomes: [], retidos: 0 };
    }
  }

  /** Auditoria da execucao: so contagens inteiras (CA-H110-15). */
  async auditar(jobId: string, contagens: Readonly<Record<string, number>>): Promise<void> {
    await this.client.query('select private.ops_purge_audit($1::uuid, $2::jsonb) as id', [jobId, JSON.stringify(contagens)]);
  }
}
