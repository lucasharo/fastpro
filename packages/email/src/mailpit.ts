// H-093 | Adaptador Mailpit por contrato SMTP (desenho 37 §2.2, §4.2). Sem HTTP, sem Resend.
import type { ClockPort, EmailMessage, EmailProviderPort, SendResult } from '@fastpro/domain';
import { isSafeAddress } from './address.js';
import { idempotencyToken } from './idempotency.js';
import type { EmailRenderer } from './renderer.js';
import { SmtpFailure } from './transports.js';
import type { SmtpTransport } from './transports.js';

export const MAILPIT_MESSAGE_ID_DOMAIN = 'fastpro.invalid';
const TEMPLATE_KEY_RE = /^[a-z][a-z0-9_.-]{0,59}$/;

export interface MailpitConfig {
  readonly host: string;
  readonly port: number;
  /** Valor de EMAIL_FROM para o cabecalho From (ja validado na partida). */
  readonly fromHeader: string;
  /** Endereco usado no envelope (MAIL FROM). */
  readonly fromAddress: string;
}

export interface MailpitDeps {
  readonly smtp: SmtpTransport;
  readonly renderer: EmailRenderer;
  readonly clock: ClockPort;
}

export function encodeHeaderWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

export interface RawMessageParts {
  readonly fromHeader: string;
  readonly to: string;
  readonly date: string;
  readonly subject: string;
  readonly messageId: string;
  readonly templateKey: string;
  readonly text: string;
}

export function buildRawMessage(p: RawMessageParts): string {
  return [
    `From: ${p.fromHeader}`,
    `To: ${p.to}`,
    `Date: ${p.date}`,
    `Subject: ${encodeHeaderWord(p.subject)}`,
    `Message-ID: ${p.messageId}`,
    `X-FastPro-Template: ${p.templateKey}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(p.text),
    '',
  ].join('\r\n');
}

function classifyRejection(code: number): SendResult {
  if (code >= 400 && code <= 499) return { kind: 'indisponivel', code: 'smtp_4xx' };
  if (code >= 500 && code <= 599) return { kind: 'recusa_permanente', code: 'smtp_5xx' };
  return { kind: 'indisponivel', code: 'smtp_inesperado' };
}

function classifySmtpFailure(err: unknown): SendResult {
  if (!(err instanceof SmtpFailure)) return { kind: 'indisponivel', code: 'smtp_inesperado' };
  switch (err.kind) {
    case 'conexao_recusada':
      return { kind: 'indisponivel', code: 'mailpit_indisponivel' };
    case 'timeout':
      return { kind: 'indisponivel', code: 'timeout' };
    case 'resposta':
      return err.replyCode === undefined
        ? { kind: 'indisponivel', code: 'smtp_inesperado' }
        : classifyRejection(err.replyCode);
  }
}

export class MailpitProvider implements EmailProviderPort {
  readonly name = 'mailpit';
  private readonly config: MailpitConfig;
  private readonly deps: MailpitDeps;

  constructor(config: MailpitConfig, deps: MailpitDeps) {
    this.config = config;
    this.deps = deps;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (!isSafeAddress(message.to))
      return { kind: 'recusa_permanente', code: 'destinatario_invalido' };
    if (!TEMPLATE_KEY_RE.test(message.templateKey)) {
      return { kind: 'recusa_permanente', code: 'template_invalido' };
    }
    const messageId = `<${idempotencyToken(message.idempotencyKey)}@${MAILPIT_MESSAGE_ID_DOMAIN}>`;
    let raw: string;
    try {
      const rendered = this.deps.renderer.render(message.templateKey, message.params);
      raw = buildRawMessage({
        fromHeader: this.config.fromHeader,
        to: message.to,
        date: new Date(this.deps.clock.nowMs()).toUTCString(),
        subject: rendered.subject,
        messageId,
        templateKey: message.templateKey,
        text: rendered.text,
      });
    } catch {
      return { kind: 'indisponivel', code: 'smtp_inesperado' };
    }
    try {
      const reply = await this.deps.smtp.sendMail({
        host: this.config.host,
        port: this.config.port,
        envelope: { from: this.config.fromAddress, to: message.to },
        raw,
      });
      return reply >= 200 && reply <= 299
        ? { kind: 'aceito', providerMessageId: messageId }
        : classifyRejection(reply);
    } catch (err) {
      return classifySmtpFailure(err);
    }
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }
}
