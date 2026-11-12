// H-108 (Issue 117) | Adaptador Pg da leitura do painel operacional (docs/factory/76-DESENHO-H108.md §2).
// So chama private.ops_panel_read (papel app_system), com o instante como parametro: o SQL e constante, sem
// concatenacao. Nao aplica regra de negocio: a forma da resposta e montada e validada em @fastpro/domain
// (montarPainelOps). Erro do banco sobe como esta; quem responde 503 sem detalhe e a rota da API.
import type { OpsPanelLeitura } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

const iso = (ms: number): string => new Date(ms).toISOString();

const SQL_OPS_PANEL_READ = 'select private.ops_panel_read($1::timestamptz) as leitura';

/** Porta de leitura agregada do painel. Devolve o jsonb da funcao; nunca linha bruta. */
export class PgOpsPanelReader {
  constructor(private readonly client: SqlClient) {}

  async ler(nowMs: number): Promise<OpsPanelLeitura> {
    const res = await this.client.query(SQL_OPS_PANEL_READ, [iso(nowMs)]);
    const leitura = (res.rows[0] as { leitura?: unknown } | undefined)?.leitura;
    if (typeof leitura !== 'object' || leitura === null) {
      throw new Error('ops_painel_resposta_invalida');
    }
    return leitura as OpsPanelLeitura;
  }
}
