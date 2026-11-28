// API do FastPro dentro do console admin: toda chamada a /api e /api/* vai ao handler publico de @fastpro/api.
// Mesmo arranjo da web: o cookie da sessao admin fica na origem do admin.
import vercelHandler from '@fastpro/api/vercel';

export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
  maxDuration: 300,
};

export default vercelHandler;
