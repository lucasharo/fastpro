// H-011 | Barrel do desafio de acesso (logica pura; I/O fica em @fastpro/db).
export * from './challenge.js';
// H-012 | Consumo do link por POST (corpo, cabecalhos, cookie e portas).
export * from './consume.js';
// H-015 | Limites e anti-enumeracao (logica pura; HMAC fica em @fastpro/db).
export * from './rate-limit.js';
// H-014 | Sessao de 7 dias: cookie, Max-Age, conversao e guarda (logica pura).
export * from './session.js';
// H-014 | Step-up: acoes criticas, requireRecentAuth e contrato do step-up (logica pura).
export * from './step-up.js';
// H-016 | Politica de senha do profissional (minimo 8, teto 72 bytes, lista local de comuns; logica pura).
export * from './password.js';
export * from './common-passwords.js';
// H-016 | Cadastro, verificacao e login do profissional (logica pura; I/O fica no adaptador).
export * from './professional-auth.js';
