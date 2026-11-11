// H-092 | Portas do pipeline de notificacoes (docs/factory/35-DESENHO-H092.md, §4.1 e §4.2).
// So interfaces e tipos. A implementacao do provedor real e de H-093; em H-092 os testes usam o
// provedor simulado de @fastpro/testkit. Nenhuma porta aqui faz I/O.

import type { DigestCategory } from './policy.js';

export type SendResult =
  | { readonly kind: 'aceito'; readonly providerMessageId: string }
  | { readonly kind: 'recusa_permanente'; readonly code: string }
  | { readonly kind: 'limite_taxa'; readonly retryAfterSeconds: number }
  | { readonly kind: 'indisponivel'; readonly code: string }
  | {
      readonly kind: 'nao_configurado';
      readonly code: 'dominio_nao_verificado' | 'segredo_ausente';
    };

export interface EmailMessage {
  /** Endereco resolvido no envio. Nunca gravado em tabela nem em log. */
  readonly to: string;
  readonly templateKey: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Igual a dedupe_key da linha: reenvio com a mesma chave nao gera segundo e-mail (R-2). */
  readonly idempotencyKey: string;
}

export interface EmailProviderPort {
  /** Nome do provedor para registro em ops.email_outbox.provider (ex.: 'simulado'). */
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export type RecipientResolution =
  | { readonly status: 'ok'; readonly email: string }
  | { readonly status: 'suprimido' }
  | { readonly status: 'inexistente' };

export interface RecipientDirectoryPort {
  resolve(recipientUserId: string): Promise<RecipientResolution>;
}

export interface ClockPort {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export interface ConfigPort {
  /** Valor bruto de ops.app_config para a janela da categoria; validado por windowSecondsFrom. */
  readConfig(key: string): Promise<unknown>;
}

export type { DigestCategory };
