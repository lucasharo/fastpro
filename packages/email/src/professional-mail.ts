// H-016 | Adaptador de envio dos e-mails do profissional (docs/factory/33-DESENHO-H016.md §4, §6.1, §10;
// CA-H016-06, decisao 55 de 11-DECISOES.md). Liga as portas de db (link de verificacao, link de recuperacao ou
// ativacao, aviso de senha alterada) aos modelos versionados de professional-renderer.ts. A entrega passa por um
// sink: em producao, providerSink() usa o mesmo EmailProviderPort (Resend) que o login usa; nos testes,
// capturaEmMemoria(). Sem interruptor de liga/desliga. Falha de entrega nao vira erro para quem chama: responder
// 503 so nos pedidos de conta existente revelaria a conta; por isso a falha vira evento sem dado pessoal.
import { createHash } from 'node:crypto';
import type { EmailProviderPort } from '@fastpro/domain';
import type { EmailRenderer } from './renderer.js';
import {
  PASSWORD_CHANGED_TEMPLATE,
  PROFESSIONAL_ACTIVATE_TEMPLATE,
  PROFESSIONAL_RECOVERY_TEMPLATE,
  PROFESSIONAL_TEMPLATE_VERSIONS,
  PROFESSIONAL_VERIFY_TEMPLATE,
} from './professional-renderer.js';

/** Prazo informado no corpo dos modelos com link (15 min, 33 §4 e §6.1). */
export const PROFESSIONAL_LINK_MINUTES = 15;

/** Caminhos das paginas que recebem o segredo no fragmento (#t=). [PROPOSTA] exceto o de verificacao. */
export const PROFESSIONAL_VERIFY_PATH = '/profissional/verificar';
export const PROFESSIONAL_RESET_PATH = '/profissional/redefinir';
export const PROFESSIONAL_ACTIVATE_PATH = '/profissional/ativar';

export interface ProfessionalMailMessage {
  readonly to: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly subject: string;
  readonly text: string;
  /** Parametros do modelo (o link ja vai aqui; o provedor renderiza a partir deles). */
  readonly params: Readonly<Record<string, unknown>>;
  /** Mesmo link, mesma chave: um reenvio do mesmo segredo nao gera segundo e-mail no provedor. */
  readonly idempotencyKey: string;
}

/** Ponto de entrega. */
export interface ProfessionalMailSink {
  deliver(message: ProfessionalMailMessage): Promise<void>;
}

/**
 * Sink de producao: entrega pelo EmailProviderPort (Resend, o mesmo do login). Resultado que nao seja 'aceito'
 * vira evento sem destinatario nem link; nao lanca, para a resposta da rota nao revelar a conta.
 */
export function providerSink(
  provider: EmailProviderPort,
  evento?: (nome: string, motivo: string) => void,
): ProfessionalMailSink {
  return {
    async deliver(message) {
      let resultado: { readonly kind: string; readonly code?: string };
      try {
        resultado = await provider.send({
          to: message.to,
          templateKey: message.templateKey,
          params: message.params,
          idempotencyKey: message.idempotencyKey,
        });
      } catch {
        evento?.('professional_envio_falhou', 'excecao');
        return;
      }
      if (resultado.kind !== 'aceito') evento?.('professional_envio_nao_aceito', resultado.code ?? resultado.kind);
    },
  };
}

/** Sink de captura para testes: guarda as mensagens em memoria. */
export function capturaEmMemoria(): ProfessionalMailSink & { readonly enviadas: ProfessionalMailMessage[] } {
  const enviadas: ProfessionalMailMessage[] = [];
  return {
    enviadas,
    async deliver(message) {
      enviadas.push(message);
    },
  };
}

export interface ProfessionalMailAdapterOptions {
  readonly renderer: EmailRenderer;
  readonly sink: ProfessionalMailSink;
  /** Origem publica do app, sem barra final (APP_BASE_URL). Validada aqui. */
  readonly baseUrl: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProfessionalMailConfigError extends Error {
  readonly code = 'configuracao_invalida';
  constructor() {
    super('configuracao_invalida');
    this.name = 'ProfessionalMailConfigError';
  }
}

export class ProfessionalMailInputError extends Error {
  readonly code = 'entrada_invalida';
  constructor() {
    super('entrada_invalida');
    this.name = 'ProfessionalMailInputError';
  }
}

export interface ProfessionalMailAdapter {
  verificationCode(email: string, code: string): Promise<void>;
  recoveryLink(email: string, token: string, purpose: 'password_reset' | 'professional_activate'): Promise<void>;
  passwordChangedNotice(email: string): Promise<void>;
}

/** Monta o link com o segredo so no fragmento. Origem sem barra final e sem fragmento previo. */
function montarLink(base: string, caminho: string, token: string): string {
  return `${base}${caminho}#t=${token}`;
}

export function createProfessionalMailAdapter(opts: ProfessionalMailAdapterOptions): ProfessionalMailAdapter {
  const base = opts.baseUrl;
  if (!/^https?:\/\/[^\s/#?]+$/.test(base)) throw new ProfessionalMailConfigError();

  async function enviar(email: string, templateKey: string, params: Record<string, unknown>): Promise<void> {
    if (!EMAIL_RE.test(email)) throw new ProfessionalMailInputError();
    const rendered = opts.renderer.render(templateKey, params);
    // A chave nao contem o link: so o digest dele, para o provedor deduplicar sem ver o segredo.
    const idempotencyKey = createHash('sha256')
      .update(`${templateKey}|${email}|${String(params.link ?? params.code ?? '')}`)
      .digest('hex');
    await opts.sink.deliver({
      to: email,
      templateKey,
      templateVersion: PROFESSIONAL_TEMPLATE_VERSIONS[templateKey] ?? 0,
      subject: rendered.subject,
      text: rendered.text,
      params,
      idempotencyKey,
    });
  }

  function linkParams(caminho: string, token: string): Record<string, unknown> {
    if (!TOKEN_RE.test(token)) throw new ProfessionalMailInputError();
    return { link: montarLink(base, caminho, token), minutos: PROFESSIONAL_LINK_MINUTES };
  }

  return {
    async verificationCode(email, code) {
      if (!/^[0-9]{6}$/.test(code)) throw new ProfessionalMailInputError();
      await enviar(email, PROFESSIONAL_VERIFY_TEMPLATE, { code, minutos: PROFESSIONAL_LINK_MINUTES });
    },
    async recoveryLink(email, token, purpose) {
      if (purpose === 'password_reset') {
        await enviar(email, PROFESSIONAL_RECOVERY_TEMPLATE, linkParams(PROFESSIONAL_RESET_PATH, token));
        return;
      }
      if (purpose === 'professional_activate') {
        await enviar(email, PROFESSIONAL_ACTIVATE_TEMPLATE, linkParams(PROFESSIONAL_ACTIVATE_PATH, token));
        return;
      }
      throw new ProfessionalMailInputError();
    },
    async passwordChangedNotice(email) {
      await enviar(email, PASSWORD_CHANGED_TEMPLATE, {});
    },
  };
}
