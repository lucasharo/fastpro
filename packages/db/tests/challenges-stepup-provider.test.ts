// H-014 | Decorador do provedor para o codigo de step-up (docs/factory/52-DESENHO-H014.md §4.3).
// Envia so o codigo e os minutos (nenhum link nem token) pelo provedor simulado. Sem rede, sem banco.
import { describe, expect, it } from 'vitest';
import type { EmailMessage, EmailProviderPort, SendResult } from '@fastpro/domain';
import { ChallengeEmailProvider, type ChallengeStore } from '../src/challenges.js';
import { challengeAad, sealChallengeBlob } from '../src/challenges-crypto.js';

const KEY = Buffer.alloc(32, 9);
const ID = '55555555-5555-4555-8555-555555555555';
const OUTRO_ID = '66666666-6666-4666-8666-666666666666';
const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const EMAIL = 'pessoa@example.test';

/** Provedor simulado: guarda o que receberia e responde aceito. Nunca envia de verdade. */
function provedorSimulado() {
  const enviados: EmailMessage[] = [];
  const inner: EmailProviderPort = {
    name: 'simulado',
    async send(message: EmailMessage): Promise<SendResult> {
      enviados.push(message);
      return { kind: 'aceito', providerMessageId: 'simulado-1' };
    },
  };
  return { enviados, inner };
}

function lojaFalsa(linha: Record<string, unknown> | null) {
  const entregues: string[] = [];
  const store = {
    async findRow() {
      return linha;
    },
    async markDelivered(id: string) {
      entregues.push(id);
    },
  } as unknown as ChallengeStore;
  return { store, entregues };
}

const mensagem = (challengeRef: string): EmailMessage => ({
  to: EMAIL,
  templateKey: 'acesso_stepup',
  params: { challenge_ref: challengeRef },
  idempotencyKey: `ac:${challengeRef}`,
});

const clock = { nowMs: () => NOW };

describe('ChallengeEmailProvider: acesso_stepup', () => {
  it('envia so o codigo e os minutos, sem link, e marca a entrega', async () => {
    const segredo = sealChallengeBlob(KEY, JSON.stringify({ code: '482913' }), challengeAad(ID, 'secrets_enc'));
    const { enviados, inner } = provedorSimulado();
    const { store, entregues } = lojaFalsa({ id: ID, active: true, emailEnc: null, secretsEnc: segredo, delivered: false });
    const provedor = new ChallengeEmailProvider(inner, store, { key: KEY, siteUrl: 'https://fastpro.example.test', clock });

    const r = await provedor.send(mensagem(ID));
    expect(r.kind).toBe('aceito');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.params).toEqual({ code: '482913', minutos: 15 });
    expect(JSON.stringify(enviados[0]!.params)).not.toMatch(/link|#t=|token/);
    expect(entregues).toEqual([ID]);
  });

  it('desafio inexistente ou inativo: recusa sem chamar o provedor', async () => {
    const { enviados, inner } = provedorSimulado();
    const provedor = new ChallengeEmailProvider(inner, lojaFalsa(null).store, { key: KEY, siteUrl: 'https://fastpro.example.test', clock });
    expect(await provedor.send(mensagem(ID))).toEqual({ kind: 'recusa_permanente', code: 'desafio_inativo' });
    expect(enviados).toHaveLength(0);
  });

  it('ja entregue: aceito sem reenviar', async () => {
    const { enviados, inner } = provedorSimulado();
    const { store } = lojaFalsa({ id: ID, active: true, emailEnc: null, secretsEnc: null, delivered: true });
    const provedor = new ChallengeEmailProvider(inner, store, { key: KEY, siteUrl: 'https://fastpro.example.test', clock });
    expect(await provedor.send(mensagem(ID))).toEqual({ kind: 'aceito', providerMessageId: 'ja_entregue' });
    expect(enviados).toHaveLength(0);
  });

  it('segredo cifrado para outro desafio (AAD diferente): recusa, sem vazar o codigo', async () => {
    const segredo = sealChallengeBlob(KEY, JSON.stringify({ code: '482913' }), challengeAad(OUTRO_ID, 'secrets_enc'));
    const { enviados, inner } = provedorSimulado();
    const { store, entregues } = lojaFalsa({ id: ID, active: true, emailEnc: null, secretsEnc: segredo, delivered: false });
    const provedor = new ChallengeEmailProvider(inner, store, { key: KEY, siteUrl: 'https://fastpro.example.test', clock });
    const r = await provedor.send(mensagem(ID));
    expect(r.kind).toBe('recusa_permanente');
    expect(enviados).toHaveLength(0);
    expect(entregues).toHaveLength(0);
  });
});
