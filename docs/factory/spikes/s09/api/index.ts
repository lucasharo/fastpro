import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/bootstrap';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// Cache de modulo: uma inicializacao por instancia quente.
let booting: Promise<Handler> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  booting ??= createApp() as Promise<Handler>;
  const app = await booting;
  app(req, res);
}
