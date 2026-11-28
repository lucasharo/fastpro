// H-093 | Dublê offline do transporte HTTP. Nenhum abre conexao.
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/index.js';

export class FakeHttp implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private readonly script: Array<HttpResponse | Error> = [];

  queue(...items: Array<HttpResponse | Error>): this {
    this.script.push(...items);
    return this;
  }

  async post(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) throw new Error('FakeHttp sem resposta roteirizada');
    if (next instanceof Error) throw next;
    return next;
  }
}

export function response(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): HttpResponse {
  return { status, body, headers };
}

export function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('lista vazia no teste');
  return item;
}
