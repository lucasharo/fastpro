import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { performance } from 'node:perf_hooks';
import { AppModule } from './app.module';
import { state } from './state';

export const BODY_LIMIT = '4mb';

// Erro do parser acima do limite: resposta 413 propria (JSON), sem depender do limite da plataforma (L3).
function bodyTooLarge(err: unknown, _req: unknown, res: express.Response, next: express.NextFunction) {
  const e = err as { type?: string; status?: number; statusCode?: number } | undefined;
  if (e && (e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413)) {
    res.status(413).json({ error: 'payload_too_large', limit: BODY_LIMIT });
    return;
  }
  next(err);
}

// Cria o app Nest uma vez por instancia e devolve o handler Express.
export async function createApp() {
  const t0 = performance.now();
  const server = express();
  server.use(express.json({ limit: BODY_LIMIT }));
  server.use(bodyTooLarge);
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  await app.init();
  state.bootMs = Math.round(performance.now() - t0);
  return server;
}
