// H-115 (Issue 124) | Sentinelas sinteticas de PII (desenho §4.1 e R-H115). Valores fixos, sem dado real.
// Prefixo 'dummy-h115-' para o verificador de segredos reconhecer como teste (commit 24ddb0d).

export const SENTINELS = Object.freeze({
  email: 'dummy-h115-email@example.test',
  phone: 'dummy-h115-phone-5500000000',
  address: 'dummy-h115-rua-sentinela-0',
} as const);

export const SENTINEL_VALUES: readonly string[] = Object.freeze(Object.values(SENTINELS));

/**
 * Busca recursiva por substring em toda a estrutura (valores de texto e chaves). `true` se alguma
 * sentinela aparece. Usada nas respostas a profissional e nas colunas de sondas de banco.
 */
export function containsSentinel(value: unknown, sentinels: readonly string[] = SENTINEL_VALUES): boolean {
  const seen = new Set<unknown>();
  const visit = (node: unknown): boolean => {
    if (typeof node === 'string') return sentinels.some((s) => node.includes(s));
    if (node === null || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (sentinels.some((s) => key.includes(s))) return true;
      if (visit(child)) return true;
    }
    return false;
  };
  return visit(value);
}
