// H-056 (Issue 69) | Rota de entrega da foto com marca d'agua: GET /v1/media/watermarked-photos/:token (167 §4.1, §6).
// Sem cookie e sem CORS: o token de 60 s e o portador do acesso. So GET; outro metodo ou caminho = 404 uniforme.
// Erros em JSON sem cache, como as demais rotas de foto. A imagem leva os cabecalhos da decisao 839 e
// Cross-Origin-Resource-Policy same-site (A-9). Nenhum log de token, identificador ou foto.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FOTO_INDISPONIVEL_BODY, FOTO_NAO_ENCONTRADA_BODY } from '../requests/photo-view-service.js';
import { entregarFoto, type WatermarkDeliveryDeps } from '../requests/photo-watermark-service.js';

const CAMINHO_RE = /^\/v1\/media\/watermarked-photos\/([^/]+)$/;

const CABECALHOS_JSON = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

/** Decisao 839 (sem ETag, sem Last-Modified, sem nome de arquivo) mais CORP same-site (A-9). */
const CABECALHOS_IMAGEM = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Content-Disposition': 'inline',
  'Cross-Origin-Resource-Policy': 'same-site',
} as const;

export interface WatermarkedPhotoRouteOptions {
  readonly service: WatermarkDeliveryDeps;
}

export function isWatermarkedPhotoRoute(path: string): boolean {
  return CAMINHO_RE.test(path);
}

function enviarJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...CABECALHOS_JSON, ...extra });
  res.end(JSON.stringify(body));
}

export async function handleWatermarkedPhotoRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: WatermarkedPhotoRouteOptions,
): Promise<void> {
  try {
    const casado = CAMINHO_RE.exec(path);
    if (req.method !== 'GET' || casado === null) {
      enviarJson(res, 404, FOTO_NAO_ENCONTRADA_BODY);
      return;
    }
    const r = await entregarFoto(casado[1] ?? '', opts.service);
    if (r.status === 200) {
      res.writeHead(200, { ...CABECALHOS_IMAGEM, 'Content-Length': String(r.jpeg.byteLength) });
      res.end(Buffer.from(r.jpeg));
      return;
    }
    if (r.status === 404) {
      enviarJson(res, 404, FOTO_NAO_ENCONTRADA_BODY);
      return;
    }
    if (r.status === 429) {
      enviarJson(res, 429, { code: 'muitas_requisicoes' }, { 'Retry-After': String(r.retryAfterS) });
      return;
    }
    enviarJson(res, 503, { code: r.code });
  } catch {
    // Falha nossa vira 503 fixo: sem texto de banco, de Storage, de cifra ou de token na resposta.
    if (!res.headersSent) enviarJson(res, 503, FOTO_INDISPONIVEL_BODY);
  }
}
