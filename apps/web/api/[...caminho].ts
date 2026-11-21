// Issue 158 (desenho 182, D-1 e D-2) | Funcao catch-all da API no projeto fastpro-web (preview).
// Sem logica aqui: reexporta o handler publico de @fastpro/api. O roteamento de /api/... fica na API
// (routePath remove o prefixo /api, entao /api/health e /api/v1/... chegam as mesmas rotas).
export { default } from '@fastpro/api/vercel';
