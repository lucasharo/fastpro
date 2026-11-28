// H-045 (Issue 58) | Adaptador Pg do acesso comercial derivado (docs/factory/114-DESENHO-H045.md, §4, §6 e §7).
// So chama private.commercial_access (papeis app_api e app_system, migracao 20261113170000). Parametros posicionais:
// o SQL nao e montado com dado de entrada. O instante vem do chamador (relogio injetado).
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao nem le variavel de ambiente.
//   - Erro do banco nunca e repassado: vira o codigo fixo acesso_comercial_indisponivel.
//   - Estado fora dos sete valores vira acesso_comercial_invalido (contrato quebrado, nao dado de usuario).
import {
  CommercialAccessError,
  aceitarEstado,
  type AcessoComercial,
  type CommercialAccessPort,
} from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_COMMERCIAL_ACCESS =
  'select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)';

function comoData(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) {
    throw new CommercialAccessError('acesso_comercial_invalido');
  }
  return data;
}

export function createPgCommercialAccess(client: SqlClient): CommercialAccessPort {
  return {
    async read(professionalId: string, at: Date): Promise<AcessoComercial> {
      let linhas: Record<string, unknown>[];
      try {
        const res = await client.query(SQL_COMMERCIAL_ACCESS, [professionalId, at.toISOString()]);
        linhas = res.rows;
      } catch {
        throw new CommercialAccessError('acesso_comercial_indisponivel');
      }
      const linha = linhas[0];
      if (!linha) {
        throw new CommercialAccessError('acesso_comercial_invalido');
      }
      return {
        estado: aceitarEstado(linha.estado),
        accessUntil: comoData(linha.access_until),
      };
    },
  };
}
