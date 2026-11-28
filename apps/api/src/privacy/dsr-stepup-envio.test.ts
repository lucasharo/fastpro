// Issue 120 (H-111) | Testes do envio do codigo do step-up ligado ao pipeline de ops.email_outbox (P-C).
// Sem banco e sem rede: porta SQL do step-up falsa, cliente SQL falso que responde as funcoes do pipeline, e provedor
// de e-mail falso que so guarda a mensagem. Nenhum e-mail real e enviado; o codigo de teste e sintetico.
import { describe, expect, it } from 'vitest';
import type { EmailMessage, EmailProviderPort, SendResult } from '@fastpro/domain';
import { ServicoDsrStepUp, type DsrStepUpSqlPort, type DsrStepUpSqlResposta, type SqlClient } from '@fastpro/db';
import { comEnvioStepUp } from './dsr-stepup-envio.js';

const TITULAR = '11111111-1111-4111-8111-111111111111';
const OUTBOX = '55555555-5555-4555-8555-555555555555';
const AGORA = Date.parse('2026-11-21T12:00:00.000Z');
const relogio = { nowMs: () => AGORA, sleep: async () => {} };

interface Cenario {
  readonly statusUsuario?: 'ativo' | 'bloqueado';
  readonly resultadoEmissao?: DsrStepUpSqlResposta['resultado'];
}

/** Porta SQL do step-up: guarda o blob cifrado na emissao e o devolve no envio (como o banco faria). */
function sqlStepUp(cenario: Cenario): DsrStepUpSqlPort & { blob: Buffer | null; codigoId: string | null } {
  const porta = {
    blob: null as Buffer | null,
    codigoId: null as string | null,
    async emitir(_usuario: string, codigo: string, _hmac: string, codigoEnc: Buffer): Promise<DsrStepUpSqlResposta> {
      if (cenario.resultadoEmissao !== undefined && cenario.resultadoEmissao !== 'criado') {
        return { resultado: cenario.resultadoEmissao, outboxId: null, expiresAt: null, retryAfter: 60 };
      }
      porta.blob = codigoEnc;
      porta.codigoId = codigo;
      return { resultado: 'criado', outboxId: OUTBOX, expiresAt: null, retryAfter: null };
    },
    async confirmar(): Promise<DsrStepUpSqlResposta> {
      return { resultado: 'invalido', outboxId: null, expiresAt: null, retryAfter: null };
    },
    async selado(): Promise<Buffer | null> {
      return porta.blob;
    },
  };
  return porta;
}

/** Cliente do pipeline: responde so as consultas usadas no envio de uma linha dsr_stepup (classe auth). */
function clienteFalso(cenario: Cenario, chamadas: string[], codigoId: () => string | null): SqlClient {
  return {
    async query(texto: string): Promise<{ rows: Record<string, unknown>[] }> {
      chamadas.push(texto.split(' ').slice(0, 4).join(' '));
      if (texto.includes('email_outbox_claim')) {
        return {
          rows: [
            {
              id: OUTBOX,
              recipient_user_id: TITULAR,
              class: 'auth',
              template: 'dsr_stepup',
              template_params: { challenge_ref: codigoId() },
              dedupe_key: `dsrstp:${OUTBOX}`,
              attempts: 0,
              quota_reserved: false,
            },
          ],
        };
      }
      if (texto.includes('ops.notification_item')) return { rows: [] };
      if (texto.includes('app.app_user')) {
        return { rows: [{ email: 'titular@example.test', status: cenario.statusUsuario ?? 'ativo' }] };
      }
      if (texto.includes('email_outbox_reservar_cota')) {
        return {
          rows: [
            { out_permitido: true, out_bloqueado_por: null, out_usado_dia: 1, out_usado_mes: 1, out_proxima_tentativa: null },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

function provedorFalso(enviadas: EmailMessage[]): EmailProviderPort {
  return {
    name: 'fake',
    async send(mensagem: EmailMessage): Promise<SendResult> {
      enviadas.push(mensagem);
      return { kind: 'aceito', providerMessageId: 'msg-teste-1' };
    },
  };
}

function montar(cenario: Cenario, enviadas: EmailMessage[], chamadas: string[], agendadas: Promise<unknown>[]) {
  const sql = sqlStepUp(cenario);
  const servico = new ServicoDsrStepUp({ sql, chave: Buffer.alloc(32, 7), pepperCodigo: 'dummy-pepper-de-teste-0123456789' });
  const envio = comEnvioStepUp(servico, {
    client: clienteFalso(cenario, chamadas, () => sql.codigoId),
    email: provedorFalso(enviadas),
    relogio,
    waitUntil: (promessa) => {
      agendadas.push(promessa);
    },
  });
  return { envio, servico };
}

describe('envio do codigo do step-up (P-C)', () => {
  it('emissao criada agenda o envio, que passa pelo pipeline e entrega o codigo ao titular', async () => {
    const enviadas: EmailMessage[] = [];
    const chamadas: string[] = [];
    const agendadas: Promise<unknown>[] = [];
    const { envio } = montar({}, enviadas, chamadas, agendadas);

    const r = await envio.emitir(TITULAR);
    expect(r).toEqual({ resultado: 'criado', outboxId: OUTBOX });
    expect(agendadas).toHaveLength(1);
    await Promise.all(agendadas);

    expect(enviadas).toHaveLength(1);
    const [mensagem] = enviadas;
    expect(mensagem?.to).toBe('titular@example.test');
    expect(mensagem?.templateKey).toBe('dsr_stepup');
    expect(mensagem?.idempotencyKey).toBe(`dsrstp:${OUTBOX}`);
    expect(mensagem?.params.minutos).toBe(10);
    expect(String(mensagem?.params.code)).toMatch(/^[0-9]{6}$/);
    // A referencia (challenge_ref) foi trocada pelo codigo: ela nao vai ao provedor.
    expect(mensagem?.params).not.toHaveProperty('challenge_ref');
    expect(chamadas.some((c) => c.includes('email_outbox_claim'))).toBe(true);
  });

  it('conta bloqueada nao recebe o codigo (suprimido, sem envio)', async () => {
    const enviadas: EmailMessage[] = [];
    const chamadas: string[] = [];
    const agendadas: Promise<unknown>[] = [];
    const { envio } = montar({ statusUsuario: 'bloqueado' }, enviadas, chamadas, agendadas);

    await envio.emitir(TITULAR);
    await Promise.all(agendadas);

    expect(enviadas).toHaveLength(0);
    expect(chamadas.some((c) => c.includes('email_outbox_encerrar'))).toBe(true);
  });

  it('emissao recusada (limite) devolve o resultado e nao agenda envio', async () => {
    const enviadas: EmailMessage[] = [];
    const chamadas: string[] = [];
    const agendadas: Promise<unknown>[] = [];
    const { envio } = montar({ resultadoEmissao: 'limite' }, enviadas, chamadas, agendadas);

    const r = await envio.emitir(TITULAR);
    expect(r).toEqual({ resultado: 'limite', retryAfter: 60 });
    expect(agendadas).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
  });

  it('sem primitiva pos-resposta nada e agendado: a linha fica pendente, sem tick nem envio', async () => {
    const enviadas: EmailMessage[] = [];
    const chamadas: string[] = [];
    const sql = sqlStepUp({});
    const servico = new ServicoDsrStepUp({ sql, chave: Buffer.alloc(32, 7), pepperCodigo: 'dummy-pepper-de-teste-0123456789' });
    const envio = comEnvioStepUp(servico, { client: clienteFalso({}, chamadas, () => sql.codigoId), email: provedorFalso(enviadas), relogio });

    const r = await envio.emitir(TITULAR);
    expect(r.resultado).toBe('criado');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(enviadas).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
  });

  it('confirmacao segue o servico sem alteracao', async () => {
    const enviadas: EmailMessage[] = [];
    const chamadas: string[] = [];
    const agendadas: Promise<unknown>[] = [];
    const { envio } = montar({}, enviadas, chamadas, agendadas);
    const r = await envio.confirmar(TITULAR, '123456');
    expect(r).toEqual({ resultado: 'invalido' });
  });
});
