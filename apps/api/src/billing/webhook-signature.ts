// S-03 / H-048 | Verificacao do cabecalho x-signature do Mercado Pago (manifesto do spike, s03/verify_signature.py).
// Manifesto: id:<data.id em minusculas se alfanumerico>;request-id:<x-request-id>;ts:<ts>;  com HMAC-SHA256 hex em v1.
// O formato foi conferido so localmente com dados sinteticos. A entrega real segue NAO VERIFICADO (sem URL publica).
// Sem segredo configurado, a verificacao falha fechada.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookSignatureInput {
  /** Segredo do webhook (nome da variavel: MP_WEBHOOK_SECRET). Nunca registrado. */
  readonly secret: string | undefined;
  readonly xSignature: string | undefined;
  readonly xRequestId: string | undefined;
  readonly dataId: string | undefined;
}

function normalizarDataId(dataId: string): string {
  return /^[A-Za-z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
}

function lerPartes(xSignature: string): Map<string, string> {
  const partes = new Map<string, string>();
  for (const parte of xSignature.split(',')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim());
  }
  return partes;
}

/** Retorna true somente se a assinatura do cabecalho confere com o segredo e com os dados recebidos. */
export function verificarAssinaturaMercadoPago(input: WebhookSignatureInput): boolean {
  const { secret, xSignature, xRequestId, dataId } = input;
  if (!secret || !xSignature || !xRequestId || !dataId) return false;

  const partes = lerPartes(xSignature);
  const ts = partes.get('ts');
  const recebida = partes.get('v1');
  if (!ts || !recebida) return false;

  const manifesto = `id:${normalizarDataId(dataId)};request-id:${xRequestId};ts:${ts};`;
  const calculada = createHmac('sha256', secret).update(manifesto).digest('hex');

  const a = Buffer.from(calculada, 'utf8');
  const b = Buffer.from(recebida, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
