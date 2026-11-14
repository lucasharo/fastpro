// Issue 55 (H-042), parte A | Adaptador Pg da guarda de elegibilidade (docs/factory/142-DESENHO-H042.md, §7 e §8).
// So chama private.professional_access_guard, papel app_system. Parametros posicionais: o SQL nao e montado com dado de entrada.
// Regras deste modulo:
//   - Recebe um SqlClient injetado: nao abre conexao nem le variavel de ambiente.
//   - So o booleano true do banco vira true. Qualquer outra resposta, excecao ou instante invalido vira false.
//   - Mensagem do banco nunca sai daqui.
import type { ModoGuarda, ProfessionalAccessPort } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const SQL_PROFESSIONAL_ACCESS =
  'select private.professional_access_guard($1::uuid, $2::text, $3::timestamptz) as ok';

export function createPgProfessionalAccess(client: SqlClient): ProfessionalAccessPort {
  return {
    async allowed(professionalId: string, mode: ModoGuarda, at: Date): Promise<boolean> {
      try {
        const res = await client.query(SQL_PROFESSIONAL_ACCESS, [professionalId, mode, at.toISOString()]);
        return res.rows[0]?.ok === true;
      } catch {
        return false;
      }
    },
  };
}
