// Issue 46 (H-033) | Consentimento de contato: texto versionado, tipos e regra pura de revelacao
// (docs/factory/129-DESENHO-H033.md, §1 D-10, §5). O banco guarda so a versao; o texto fica no Git.
// [PENDENTE JURIDICO] o texto v1 e um modelo de desenvolvimento e precisa de revisao antes de producao (decisao 443).
// Sem rede, sem banco, sem relogio.

export const CONTACT_CONSENT_VERSION = 'v1' as const;

export const CONTACT_CONSENT_TEXT_V1 =
  'Autorizo que o telefone informado neste pedido seja mostrado aos profissionais que aceitarem o pedido, ' +
  'enquanto eu nao revogar esta autorizacao. A revogacao vale para o futuro. Entendo que, depois de visto, ' +
  'o numero pode ser usado pelo profissional fora da plataforma, e a plataforma nao controla esse uso.';

export type ContactScope = 'todos_participantes' | 'profissional';
export type ContactGrantedVia = 'formulario_pedido' | 'chat';
export type ContactRevokedReason = 'cliente_geral' | 'cliente_individual' | 'telefone_alterado' | 'telefone_apagado';

/** Entradas da regra de revelacao. Cada campo ja vem decidido pelo banco ou pela API; a funcao so combina. */
export interface RevealInput {
  readonly visible: boolean;
  readonly open: boolean;
  readonly accepted: boolean;
  readonly consentActive: boolean;
  readonly phonePresent: boolean;
}

/**
 * Oraculo puro da regra de revelacao (D-04): so revela quando todas as condicoes valem.
 * A decisao real fica no banco (private.contact_reveal_phone); esta funcao serve de referencia aos testes.
 */
export function canRevealPhone(entrada: RevealInput): boolean {
  return (
    entrada.visible === true &&
    entrada.open === true &&
    entrada.accepted === true &&
    entrada.consentActive === true &&
    entrada.phonePresent === true
  );
}
