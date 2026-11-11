// H-093 | Dublês offline dos transportes HTTP e SMTP. Nenhum abre conexao.
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
  SmtpMail,
  SmtpTransport,
} from '../src/index.js';

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

export class FakeSmtp implements SmtpTransport {
  readonly mails: SmtpMail[] = [];
  private readonly script: Array<number | Error> = [];

  queue(...items: Array<number | Error>): this {
    this.script.push(...items);
    return this;
  }

  async sendMail(mail: SmtpMail): Promise<number> {
    this.mails.push(mail);
    const next = this.script.shift();
    if (next === undefined) return 250;
    if (next instanceof Error) throw next;
    return next;
  }
}

export function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('lista vazia no teste');
  return item;
}
