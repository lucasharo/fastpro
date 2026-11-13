// H-017 (Issue #30) | Auditoria da recusa de exclusividade de papeis (101-DESENHO-H017.md, §3.5 e §4.2).
// A recusa vem do banco (gatilho, errcode 23514). Quem grava a auditoria e a API, fora da transacao que falhou:
// a exceção desfaz tudo o que a transacao gravou, inclusive a linha que um gatilho tivesse criado.
// Registro sem dado pessoal: ator = o proprio usuario (id opaco), objeto = o mesmo id, estado = so o codigo da regra.
import type { RoleExclusivityRule } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

export const ROLE_EXCLUSIVITY_ACTION = 'identity.role_exclusivity.denied' as const;
const ROLE_EXCLUSIVITY_OBJECT_TYPE = 'app_user' as const;
const ROLE_EXCLUSIVITY_ACTOR_ROLE = 'usuario' as const;

/**
 * Grava a recusa em private.audit_append. Melhor esforco: devolve false se falhar (o chamador registra o
 * fato sem dado pessoal e NAO muda a resposta ao usuario). Usar um cliente fora da transacao recusada.
 */
export async function recordRoleExclusivityDenied(
  client: SqlClient,
  actorUserId: string,
  rule: RoleExclusivityRule,
): Promise<boolean> {
  try {
    await client.query(
      'select private.audit_append($1, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8, $9::uuid) as id',
      [
        actorUserId,
        ROLE_EXCLUSIVITY_ACTOR_ROLE,
        ROLE_EXCLUSIVITY_ACTION,
        ROLE_EXCLUSIVITY_OBJECT_TYPE,
        actorUserId,
        JSON.stringify({}),
        JSON.stringify({ rule }),
        null,
        null,
      ],
    );
    return true;
  } catch {
    return false;
  }
}
