// H-110 (Issue #119) | Adaptador Pg dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §2, §3, §6).
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
  if (!linha) return { estado: 'falha', removidos: 0, retidos: 0, falhos: 1 };
  const estado = ESTADOS.has(linha.out_estado) ? (linha.out_estado as EstadoBlocoOpsPurge) : 'falha';
  return {
    estado,
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
  | 'ops_purge_idempotency'
  | 'ops_purge_media_access';

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

  /** Objetos do bucket quarantine a considerar como orfaos (E9). Sem nome nem caminho em log. */
  async orfaos(agora: number, limite: number): Promise<readonly { estado: string; nome: string | null; id: string | null; existe: boolean | null }[]> {
    const res = await this.client.query(
      'select out_estado, out_nome, out_id, out_existe from private.ops_purge_media_orfaos($1::timestamptz, $2::integer)',
      [new Date(agora).toISOString(), limite],
    );
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        estado: String(row.out_estado),
        nome: row.out_nome === null ? null : String(row.out_nome),
        id: row.out_id === null ? null : String(row.out_id),
        existe: row.out_existe === null ? null : row.out_existe === true,
      };
    });
  }

  /** Auditoria da execucao: so contagens inteiras (CA-H110-15). */
  async auditar(jobId: string, contagens: Readonly<Record<string, number>>): Promise<void> {
    await this.client.query('select private.ops_purge_audit($1::uuid, $2::jsonb) as id', [jobId, JSON.stringify(contagens)]);
  }
}
