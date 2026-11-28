// Issue 160 | Destino do e-mail em DEV/teste (desenho 188 §3.1, decisao 1000 do dono).
// Com o remetente de teste, o destino original vira a conta do titular nos ambientes local e test.
// Funcoes puras: sem process.env, sem relogio, sem I/O e sem log. O endereco original nunca sai
// daqui em erro ou resultado: so entra no corpo HTTP (marcarRedirecionado), decidido em ResendProvider.
import { isSafeAddress, RESEND_TEST_SENDER, sameAddress } from './address.js';
import { isOneOf, REDIRECT_APP_ENVS } from './env.js';
import type { RenderedEmail } from './renderer.js';

export type DestinoDecisao =
  | { readonly kind: 'direto' }
  | { readonly kind: 'redirecionado'; readonly to: string }
  | { readonly kind: 'recusado'; readonly code: 'destinatario_nao_permitido' };

export interface DecidirDestinoInput {
  /** env.APP_ENV */
  readonly appEnv: string | undefined;
  /** extractAddress(EMAIL_FROM): endereco minusculo ou null */
  readonly from: string | null;
  /** message.to (destino original) */
  readonly recipient: string;
  /** env.RESEND_ACCOUNT_RECIPIENT */
  readonly accountRecipient: string | undefined;
}

export const MARCADOR_ASSUNTO = '[Teste] ';

const RECUSADO: DestinoDecisao = { kind: 'recusado', code: 'destinatario_nao_permitido' };

/**
 * Ordem fixa (a primeira condicao que bate vence):
 * 1. remetente diferente do remetente de teste: direto (as travas de dominio ficam em ResendProvider);
 * 2. conta ausente ou insegura: recusado;
 * 3. destino igual a conta: direto, sem marcador, em qualquer APP_ENV;
 * 4. APP_ENV fora de REDIRECT_APP_ENVS (inclui vazio, ausente e maiusculas): recusado;
 * 5. redirecionado, com to = conta.
 */
export function decidirDestino(input: DecidirDestinoInput): DestinoDecisao {
  if (input.from !== RESEND_TEST_SENDER) return { kind: 'direto' };

  const account = (input.accountRecipient ?? '').trim();
  if (account === '' || !isSafeAddress(account)) return RECUSADO;

  if (sameAddress(input.recipient, account)) return { kind: 'direto' };

  const appEnv = (input.appEnv ?? '').trim();
  if (!isOneOf(REDIRECT_APP_ENVS, appEnv)) return RECUSADO;

  return { kind: 'redirecionado', to: account };
}

/**
 * Marcador do envio redirecionado (1002a): assunto com prefixo, sem o endereco; corpo com o
 * endereco original na primeira linha, uma linha em branco e o texto do modelo intacto.
 */
export function marcarRedirecionado(rendered: RenderedEmail, originalTo: string): RenderedEmail {
  return {
    subject: `${MARCADOR_ASSUNTO}${rendered.subject}`,
    text: `[Teste] Este e-mail era destinado a: ${originalTo}. Foi redirecionado para a conta de teste.\n\n${rendered.text}`,
  };
}
