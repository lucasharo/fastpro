import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { performance } from 'node:perf_hooks';
import { AppModule } from './app.module';
import { state } from './state';

// Cria o app Nest uma vez por instancia e devolve o handler Express.
export async function createApp() {
  const t0 = performance.now();
  const server = express();
  // Limite alto de proposito: o teste de 413 e feito pelo limite da plataforma (4,5 MB).
  server.use(express.json({ limit: '10mb' }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  await app.init();
  state.bootMs = Math.round(performance.now() - t0);
  return server;
}
