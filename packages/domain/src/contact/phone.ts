// Issue 46 (H-033) | Telefone brasileiro do pedido: normalizacao pura (docs/factory/129-DESENHO-H033.md, §5).
// Aceita mascara, espacos e o prefixo +55. Recusa letras, texto livre e numero sem DDD. Saida: E.164 (+55 DDD numero).
// Sem rede, sem banco, sem relogio. O numero nunca vai para resposta, log ou erro: maskForLog so existe para testes e
// diagnostico interno que nao cruza a fronteira da API.

const CARACTERES_PERMITIDOS = /^[0-9\s()\-.+]*$/;
const NACIONAL = /^[1-9][0-9]([0-9]{8}|[0-9]{9})$/;

/** Normaliza para E.164 (+55 + DDD + 8 ou 9 digitos). Devolve null quando a entrada nao e um telefone brasileiro valido. */
export function normalizePhoneBr(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null;
  const bruto = entrada.trim();
  if (bruto === '' || bruto.length > 40 || !CARACTERES_PERMITIDOS.test(bruto)) return null;

  const digitos = bruto.replace(/\D/g, '');
  let nacional: string;
  if (bruto.startsWith('+')) {
    if (!digitos.startsWith('55')) return null;
    nacional = digitos.slice(2);
  } else if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    nacional = digitos.slice(2);
  } else {
    nacional = digitos;
  }

  if (!NACIONAL.test(nacional)) return null;
  return `+55${nacional}`;
}

/** Forma mascarada para diagnostico interno: mantem so o DDI, o DDD e os dois ultimos digitos. Nunca vai para resposta. */
export function maskForLog(e164: string): string {
  if (!/^\+55[0-9]{10,11}$/.test(e164)) return '+55 (**) *****-****';
  return `+55 (${e164.slice(3, 5)}) *****-**${e164.slice(-2)}`;
}
