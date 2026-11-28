// H-120 (Issue 129) | Identificadores, e-mails e conteudo fixos da carga de demonstracao (camada 1).
// Sem banco e sem rede. Marcador de origem (85-DESENHO-H120 §2): UUID reservado com prefixo
// fa57d120-0000-4000-8000-<12 hex>, e-mail @sintetico.test e caminho demo-h120/ no Storage.
// Reservado: nenhum outro codigo pode gerar ids com este prefixo, e migracoes nunca o usam.

export const DEMO_ID_PREFIX = 'fa57d120-';
export const DEMO_ID_LIKE = 'fa57d120-%';
export const DEMO_ID_RE = /^fa57d120-0000-4000-8000-[0-9a-f]{12}$/;
export const DEMO_EMAIL_DOMAIN = 'sintetico.test';
export const DEMO_EMAIL_LIKE = '%@sintetico.test';
export const DEMO_STORAGE_PREFIX = 'demo-h120/';
export const DEMO_NAME_MARK = 'Sintético';

// Tipo de id (um caractere hexadecimal) + numero do item (dois digitos). Doze hex no total.
export const KIND = Object.freeze({
  CLIENTE: 'a',
  PROFISSIONAL: 'b',
  RASCUNHO: 'c',
  COORDENADA: 'd',
  AUTH_CLIENTE: 'f',
  AUTH_PROFISSIONAL: 'e',
});

export function demoId(kind, n) {
  if (!/^[0-9a-f]$/.test(kind)) throw new Error('tipo de id invalido');
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('numero de id invalido');
  return `${DEMO_ID_PREFIX}0000-4000-8000-000000000${kind}${String(n).padStart(2, '0')}`;
}

export function isDemoId(value) {
  return typeof value === 'string' && DEMO_ID_RE.test(value);
}

export function isDemoEmail(email) {
  return typeof email === 'string' && email.endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

// Clientes (2): nomes e e-mails fixos, no dominio reservado .test.
export const CLIENTES = Object.freeze(
  [1, 2].map((n) => {
    const letra = n === 1 ? 'a' : 'b';
    return Object.freeze({
      n,
      id: demoId(KIND.CLIENTE, n),
      authId: demoId(KIND.AUTH_CLIENTE, n),
      email: `cliente.${letra}@${DEMO_EMAIL_DOMAIN}`,
    });
  }),
);

// Profissionais (13): 8 aprovados e um por estado de verificacao (refino §3, desenho §1).
const ESTADOS_PROFISSIONAIS = Object.freeze([
  'aprovada', 'aprovada', 'aprovada', 'aprovada', 'aprovada', 'aprovada', 'aprovada', 'aprovada',
  'pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'suspensa',
]);

export const PROFISSIONAIS = Object.freeze(
  ESTADOS_PROFISSIONAIS.map((status, i) => {
    const n = i + 1;
    return Object.freeze({
      n,
      id: demoId(KIND.PROFISSIONAL, n),
      authId: demoId(KIND.AUTH_PROFISSIONAL, n),
      email: `profissional.${String(n).padStart(2, '0')}@${DEMO_EMAIL_DOMAIN}`,
      status,
      publicName: `Profissional ${DEMO_NAME_MARK} ${String(n).padStart(2, '0')}`,
      slug: `profissional-sintetico-${String(n).padStart(2, '0')}`,
    });
  }),
);

// Rascunhos de pedido (2; quantidade proposta pelo DEV, o refino nao a fixa).
export const RASCUNHOS = Object.freeze(
  [1, 2].map((n) => Object.freeze({ n, id: demoId(KIND.RASCUNHO, n) })),
);

// Coordenada comum (uma so) para perfis e pedidos da demo. Ponto dentro da caixa do Brasil (CHECK).
export const COORDENADA = Object.freeze({
  id: demoId(KIND.COORDENADA, 1),
  subjectKind: 'professional_base',
  subjectId: demoId(KIND.COORDENADA, 1),
  endereco: 'Rua Sintética 000',
  // Forma normalizada do endereco (NFC, aparada, minusculas, espacos colapsados; 68 §2.1).
  enderecoNormalizado: 'rua sintética 000',
  lng: -47.8825,
  lat: -15.7942,
});

// Contagens da camada 1 (CA-H120-04).
export const CONTAGENS_CAMADA1 = Object.freeze({
  clientes: CLIENTES.length,
  profissionais: PROFISSIONAIS.length,
  profissionaisAprovados: PROFISSIONAIS.filter((p) => p.status === 'aprovada').length,
  rascunhos: RASCUNHOS.length,
  coordenadas: 1,
});

// CPF sintetico com digitos verificadores validos. Base 9 + 8 digitos do numero (faixa determinística).
export function demoCpfDigits(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('numero de CPF invalido');
  const base = `9${String(n).padStart(8, '0')}`.split('').map(Number);
  const d1 = cpfDigit(base, 10);
  const d2 = cpfDigit([...base, d1], 11);
  return [...base, d1, d2].join('');
}

function cpfDigit(digits, pesoInicial) {
  let soma = 0;
  for (let i = 0; i < digits.length; i += 1) soma += digits[i] * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}
