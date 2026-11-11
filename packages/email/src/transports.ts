// H-093 | Transportes injetados. Os adaptadores nao abrem conexao por conta propria.
export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  /** Nomes de cabecalho em minusculas. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpTransport {
  post(request: HttpRequest): Promise<HttpResponse>;
}

export class HttpTransportError extends Error {
  readonly kind: 'timeout' | 'rede';

  constructor(kind: 'timeout' | 'rede') {
    super(kind);
    this.name = 'HttpTransportError';
    this.kind = kind;
  }
}

const TIMEOUT_ERROR_NAMES = new Set(['TimeoutError', 'AbortError']);

/** Transporte HTTP sobre fetch global, com tempo limite. Nao e usado pelos testes. */
export function createFetchHttpTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return {
    async post(request: HttpRequest): Promise<HttpResponse> {
      try {
        const res = await fetchImpl(request.url, {
          method: 'POST',
          headers: { ...request.headers },
          body: request.body,
          signal: AbortSignal.timeout(request.timeoutMs),
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        const body = await res.text();
        return { status: res.status, headers, body };
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        throw new HttpTransportError(TIMEOUT_ERROR_NAMES.has(name) ? 'timeout' : 'rede');
      }
    },
  };
}
