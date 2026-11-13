// Issue 57 (H-044) | Adaptador Pg da ativacao do trial (docs/factory/135-DESENHO-H044.md, §4 e §5.3).
// So chama private.trial_activate (papel app_system, migracao 20261113270000). Parametros posicionais: o SQL
// nao e montado com dado de entrada. O instante vem do chamador (relogio do servidor da API).
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao nem le variavel de ambiente.
//   - Erro do banco nunca e repassado: vira o codigo fixo trial_indisponivel.
//   - Codigo fora dos quatro valores vira trial_indisponivel (contrato quebrado, nao dado de usuario).
//   - out_grant_id nunca sai deste modulo: o id do livro nao e dado de resposta.
//   - O ator e montado a partir do id da sessao (professional:<uuid>); o corpo da requisicao nunca chega aqui.
import { TrialActivationError, type TrialActivationOutcome, type TrialActivationPort } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_TRIAL_ACTIVATE =
  'select out_code, out_grant_id, out_starts_at, out_ends_at from private.trial_activate($1::uuid, $2::text, $3::timestamptz, $4::uuid)';

export interface PgTrialActivationOpcoes {
  /** Gerador opcional do id de correlacao da auditoria. Sem ele, a correlacao fica nula. */
  readonly novaCorrelacao?: () => string;
}

function comoData(valor: unknown): Date {
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) {
    throw new TrialActivationError('trial_indisponivel');
  }
  return data;
}

function comoResultado(linha: Record<string, unknown>): TrialActivationOutcome {
  const codigo = String(linha.out_code);
  switch (codigo) {
    case 'ok':
      return { code: 'ok', startsAt: comoData(linha.out_starts_at), endsAt: comoData(linha.out_ends_at) };
    case 'not_verified':
      return { code: 'not_verified' };
    case 'trial_used':
      return { code: 'trial_used' };
    case 'paid_access_active':
      return { code: 'paid_access_active' };
    default:
      throw new TrialActivationError('trial_indisponivel');
  }
}

export function createPgTrialActivation(
  client: SqlClient,
  opcoes: PgTrialActivationOpcoes = {},
): TrialActivationPort {
  return {
    async activate(professionalId: string, at: Date): Promise<TrialActivationOutcome> {
      let linhas: Record<string, unknown>[];
      try {
        const res = await client.query(SQL_TRIAL_ACTIVATE, [
          professionalId,
          `professional:${professionalId}`,
          at.toISOString(),
          opcoes.novaCorrelacao ? opcoes.novaCorrelacao() : null,
        ]);
        linhas = res.rows;
      } catch {
        throw new TrialActivationError('trial_indisponivel');
      }
      const linha = linhas[0];
      if (!linha) {
        throw new TrialActivationError('trial_indisponivel');
      }
      return comoResultado(linha);
    },
  };
}
