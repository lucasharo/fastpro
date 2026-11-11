// H-093 | Adaptador Resend (desenho 37 §2.3, §3, §4.1). Falha fechada antes de qualquer chamada.
// Desvio do desenho 37 (decisao do titular): o remetente de teste onboarding@resend.dev e aceito
// somente para o destinatario da conta (RESEND_ACCOUNT_RECIPIENT); outro destino vira
// destinatario_nao_permitido antes da API. A trava de dominio verificado vale para os demais casos.
import type { ClockPort, EmailMessage, EmailProviderPort, SendResult } from '@fastpro/domain';
import {
  domainOf,
  extractAddress,
  isSafeAddress,
  normalizeDomain,
  RESEND_TEST_DOMAIN,
  RESEND_TEST_SENDER,
  sameAddress,
} from './address.js';
import type { EmailEnv } from './env.js';
import { idempotencyToken } from './idempotency.js';
import type { EmailRenderer } from './renderer.js';
import { HttpTransportError } from './transports.js';
import type { HttpResponse, HttpTransport } from './transports.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const RESEND_TIMEOUT_MS = 10_000;
const DAY_SECONDS = 86_400;
const DEFAULT_RATE_WAIT_SECONDS = 60;
// NAO VERIFICADO (S-11 §5): texto real da cota excedida. Marcadores provisorios, a ajustar no primeiro caso real.
const DAILY_QUOTA_MARKERS: readonly RegExp[] = [/daily[_ ]quota/i];
const MONTHLY_QUOTA_MARKERS: readonly RegExp[] = [/monthly[_ ]quota/i];

export function secondsUntilNextUtcDay(nowMs: number): number {
  const next = (Math.floor(nowMs / 86_400_000) + 1) * 86_400_000;
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

function naoConfigurado(code: 'dominio_nao_verificado' | 'segredo_ausente'): SendResult {
  return { kind: 'nao_configurado', code };
}

function recusa(code: string): SendResult {
  return { kind: 'recusa_permanente', code };
}

function matchesAny(body: string, markers: readonly RegExp[]): boolean {
  return markers.some((re) => re.test(body));
}

function retryAfterOf(headers: Readonly<Record<string, string>>): number {
  const raw = (headers['retry-after'] ?? '').trim();
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return seconds > 0 ? seconds : DEFAULT_RATE_WAIT_SECONDS;
}

function extractId(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) return null;
  const id = parsed.id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/** Classificacao pura pelo status HTTP. O corpo e lido so para 2xx (id), 429 (cota) e 403 (dominio). */
export function classifyResendResponse(res: HttpResponse, nowMs: number): SendResult {
  const { status } = res;
  if (status >= 200 && status < 300) {
    const id = extractId(res.body);
    return id !== null
      ? { kind: 'aceito', providerMessageId: id }
      : { kind: 'indisponivel', code: 'resposta_invalida' };
  }
  if (status === 429) {
    if (matchesAny(res.body, MONTHLY_QUOTA_MARKERS)) {
      return { kind: 'limite_taxa', retryAfterSeconds: DAY_SECONDS };
    }
    if (matchesAny(res.body, DAILY_QUOTA_MARKERS)) {
      return { kind: 'limite_taxa', retryAfterSeconds: secondsUntilNextUtcDay(nowMs) };
    }
    return { kind: 'limite_taxa', retryAfterSeconds: retryAfterOf(res.headers) };
  }
  if (status === 401) return naoConfigurado('segredo_ausente');
  if (status === 403 && /validation_error/.test(res.body))
    return naoConfigurado('dominio_nao_verificado');
  if (status === 408 || (status >= 500 && status <= 599)) {
    return { kind: 'indisponivel', code: `resend_http_${status}` };
  }
  if (status === 409) return { kind: 'indisponivel', code: 'resend_conflito' };
  if (status >= 400 && status <= 499) return recusa(`resend_http_${status}`);
  return { kind: 'indisponivel', code: 'resend_inesperado' };
}

export interface ResendDeps {
  readonly http: HttpTransport;
  readonly renderer: EmailRenderer;
  readonly clock: ClockPort;
}

export class ResendProvider implements EmailProviderPort {
  readonly name = 'resend';
  /** Guarda a referencia do ambiente e le as variaveis no momento de cada envio. */
  private readonly env: EmailEnv;
  private readonly deps: ResendDeps;

  constructor(env: EmailEnv, deps: ResendDeps) {
    this.env = env;
    this.deps = deps;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      return await this.attempt(message);
    } catch (err) {
      if (err instanceof HttpTransportError) return { kind: 'indisponivel', code: err.kind };
      return { kind: 'indisponivel', code: 'resend_inesperado' };
    }
  }

  /** So o nome aparece em JSON; segredos nunca. */
  toJSON(): { name: string } {
    return { name: this.name };
  }

  private async attempt(message: EmailMessage): Promise<SendResult> {
    const fromRaw = (this.env.EMAIL_FROM ?? '').trim();
    const from = extractAddress(fromRaw);

    if (from === RESEND_TEST_SENDER) {
      // Remetente de teste: so para o e-mail da conta, sem depender de dominio verificado.
      if (!sameAddress(message.to, this.env.RESEND_ACCOUNT_RECIPIENT)) {
        return recusa('destinatario_nao_permitido');
      }
    } else {
      // Ordem do desenho 37 §3: marcador, remetente no dominio, depois segredo.
      const domain = normalizeDomain(this.env.RESEND_VERIFIED_DOMAIN);
      if (domain === '') return naoConfigurado('dominio_nao_verificado');
      if (from === null || domainOf(from) !== domain || domainOf(from) === RESEND_TEST_DOMAIN) {
        return naoConfigurado('dominio_nao_verificado');
      }
    }

    const key = (this.env.RESEND_API_KEY ?? '').trim();
    if (key === '') return naoConfigurado('segredo_ausente');
    if (!isSafeAddress(message.to)) return recusa('destinatario_invalido');

    const rendered = this.deps.renderer.render(message.templateKey, message.params);
    const res = await this.deps.http.post({
      url: RESEND_ENDPOINT,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyToken(message.idempotencyKey),
      },
      body: JSON.stringify({
        from: fromRaw,
        to: message.to,
        subject: rendered.subject,
        text: rendered.text,
      }),
      timeoutMs: RESEND_TIMEOUT_MS,
    });
    return classifyResendResponse(res, this.deps.clock.nowMs());
  }
}
