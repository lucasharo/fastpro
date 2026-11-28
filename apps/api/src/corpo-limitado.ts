// H-097 (Issue 107) | Leitura do corpo de uma requisicao com limite. Guarda no maximo o limite; o restante
// so e contado (memoria limitada) e o chamador responde 422 sem reset de conexao. Usado pelas rotas do
// pedido de login (challenge-request-route) e da verificacao do codigo (challenge-verify-route).
import type { IncomingMessage } from 'node:http';

export interface CorpoLimitado {
  readonly text: string;
  /** Verdadeiro quando o corpo passou do limite; o texto nao deve ser usado nesse caso. */
  readonly excedeu: boolean;
}

export function lerCorpoLimitado(req: IncomingMessage, limite: number): Promise<CorpoLimitado> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limite) partes.push(chunk);
    });
    req.on('end', () =>
      resolve({ text: Buffer.concat(partes).toString('utf8'), excedeu: total > limite }),
    );
    req.on('error', reject);
  });
}
