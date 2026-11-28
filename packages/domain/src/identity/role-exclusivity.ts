// H-017 (Issue #30) | Exclusividade de papeis: codigos de regra e traducao de erro do banco (logica pura).
// Desenho: docs/factory/101-DESENHO-H017.md, §4.2 e §5. O banco decide (gatilhos, errcode 23514, mensagem fixa =
// chave da regra). A API responde sempre com ROLE_EXCLUSIVITY_MESSAGE: nenhum nome, e-mail, CPF ou id de terceiro
// aparece na resposta (CA-11, decisao 141).

/** Regras de exclusividade. Cliente+profissional e permitido (decisao 136); admin nao e cliente nem profissional (137). */
export type RoleExclusivityRule =
  | 'admin_cliente'
  | 'admin_profissional'
  | 'perfil_admin'
  | 'aceite_proprio_pedido';

/** Chave que o banco levanta como mensagem do erro (errcode 23514) para cada regra. */
export const ROLE_EXCLUSIVITY_DB_KEYS: Readonly<Record<string, RoleExclusivityRule>> = Object.freeze({
  papel_exclusivo_admin_cliente: 'admin_cliente',
  papel_exclusivo_admin_profissional: 'admin_profissional',
  papel_exclusivo_perfil_admin: 'perfil_admin',
  aceite_proprio_pedido: 'aceite_proprio_pedido',
});

/** Texto unico para qualquer recusa desta historia. Sem motivo e sem dado de terceiros. */
export const ROLE_EXCLUSIVITY_MESSAGE = 'Operação não permitida.';

/** Codigo SQLSTATE que os gatilhos usam para recusa de regra (check_violation). */
const CHECK_VIOLATION = '23514';

/**
 * Devolve a regra recusada pelo banco, ou null para qualquer outro erro (outro codigo, mensagem
 * desconhecida ou erro sem codigo). Nunca devolve a mensagem original.
 */
export function parseRoleExclusivityError(err: unknown): RoleExclusivityRule | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code !== CHECK_VIOLATION || typeof message !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(ROLE_EXCLUSIVITY_DB_KEYS, message)
    ? ROLE_EXCLUSIVITY_DB_KEYS[message] ?? null
    : null;
}
