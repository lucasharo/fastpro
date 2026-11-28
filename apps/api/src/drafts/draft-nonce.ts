// H-013 (Issue #26) | Nonce do navegador (docs/factory/91-DESENHO-H013.md, §1.4, decisao 66).
// O nonce e o SHA-256 do segredo do cookie __Host-fp_draft, o mesmo valor guardado em request_draft.
// Helper unico usado pelas tres rotas (pedido, verificacao e consumo). Sem cookie valido: null.
// O segredo em claro nunca sai daqui nem vai a log.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { draftSecretFromCookie } from '@fastpro/domain';

/** SHA-256 em hexadecimal (64 caracteres) do segredo do cookie do rascunho, ou null se ausente ou invalido. */
export function draftNonceHashFromRequest(req: Pick<IncomingMessage, 'headers'>): string | null {
  const cookie = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
  const segredo = draftSecretFromCookie(cookie);
  if (segredo === null) return null;
  return createHash('sha256').update(segredo, 'utf8').digest('hex');
}
