// Issue 158 (desenho 182, D-2 plano B) | Funcao unica da API no projeto fastpro-web; /api/(.*) e reescrito para ela em vercel.json.
// Sem logica aqui: reexporta o handler publico de @fastpro/api. O roteamento de /api/... fica na API
// (routePath remove o prefixo /api, entao /api/health e /api/v1/... chegam as mesmas rotas).
export { default } from '@fastpro/api/vercel';
