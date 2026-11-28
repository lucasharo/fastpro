// Issue 54 (H-041) | Adaptador do estado visivel e do recurso do profissional (docs/factory/141-DESENHO-H041.md §7).
// Chama so as funcoes private.professional_verification_state e private.professional_verification_appeal, pelo papel
// app_system. Parametros posicionais; nenhum valor de linha e registrado em log. Sem tabela, sem escrita direta.
import type { SqlClient } from '@fastpro/db';
import {
  CODIGO_RECURSO_INDISPONIVEL,
  type LinhaEstadoVerificacao,
  type ProfessionalVerificationPort,
  type ResultadoRecurso,
} from '@fastpro/domain';

const SQL_ESTADO =
  'select out_state, out_reason_code, out_explanation, out_decided_at, out_appeal from private.professional_verification_state($1)';
const SQL_RECURSO = 'select out_code from private.professional_verification_appeal($1, $2)';

export class PgProfessionalVerificationStore implements ProfessionalVerificationPort {
  constructor(private readonly client: SqlClient) {}

  /** Linha do estado do profissional; nulo quando a funcao nao devolve linha (sem perfil). */
  async lerEstado(profissional: string): Promise<LinhaEstadoVerificacao | null> {
    const res = await this.client.query(SQL_ESTADO, [profissional]);
    const linha = res.rows[0];
    if (linha === undefined) return null;
    return {
      out_state: String(linha.out_state ?? ''),
      out_reason_code: typeof linha.out_reason_code === 'string' ? linha.out_reason_code : null,
      out_explanation: typeof linha.out_explanation === 'string' ? linha.out_explanation : null,
      out_decided_at: linha.out_decided_at instanceof Date || typeof linha.out_decided_at === 'string'
        ? linha.out_decided_at
        : null,
      out_appeal: String(linha.out_appeal ?? ''),
    };
  }

  /** Pedido de revisao. Qualquer codigo diferente de ok (sem caso, nao elegivel, ja usado) vira indisponivel. */
  async pedirRecurso(profissional: string, agora: Date): Promise<ResultadoRecurso> {
    const res = await this.client.query(SQL_RECURSO, [profissional, agora.toISOString()]);
    return res.rows[0]?.out_code === 'ok' ? 'ok' : CODIGO_RECURSO_INDISPONIVEL;
  }
}
