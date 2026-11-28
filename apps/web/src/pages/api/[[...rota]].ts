// API do FastPro dentro do app Next.js: toda chamada a /api e /api/* vai ao handler publico de @fastpro/api.
// O Pages Router entrega IncomingMessage e ServerResponse do Node, que e o contrato do handler. Sem parser de
// corpo do Next (a API le o corpo cru e aplica os proprios limites).
import vercelHandler from '@fastpro/api/vercel';

export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
  maxDuration: 300,
};

export default vercelHandler;
