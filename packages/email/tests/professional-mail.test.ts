// H-016 | Adaptador de envio do profissional com captura em memoria (CA-H016-06). Sem rede: fetch bloqueado.
// Provedor: so o transporte falso (nenhuma conexao real ao Resend). Token e e-mail sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de e-mail');
};

import { describe, it, expect } from 'vitest';
import {
  capturaEmMemoria,
  createMinimalRenderer,
  createProfessionalAwareRenderer,
  createProfessionalMailAdapter,
  providerSink,
  ProfessionalMailConfigError,
  ProfessionalMailInputError,
  ResendProvider,
  type ProfessionalMailSink,
} from '../src/index.js';

const BASE = 'https://app.example.test';
const EMAIL = 'pessoa.sintetica@example.test';
const TOKEN = 'T'.repeat(43);
const renderer = createProfessionalAwareRenderer(createMinimalRenderer());

function montar(sink: ProfessionalMailSink = capturaEmMemoria()) {
  return createProfessionalMailAdapter({ renderer, sink, baseUrl: BASE });
}

describe('links do profissional vao ao sink com modelo, versao e prazo (CA-H016-06)', () => {
  it('verificacao: modelo professional_verificacao, link no fragmento, prazo de 15 min', async () => {
    const sink = capturaEmMemoria();
    await montar(sink).verificationLink(EMAIL, TOKEN);
    expect(sink.enviadas).toHaveLength(1);
    const m = sink.enviadas[0]!;
    expect(m.to).toBe(EMAIL);
    expect(m.templateKey).toBe('professional_verificacao');
    expect(m.templateVersion).toBe(1);
    expect(m.text).toContain(`${BASE}/profissional/verificar#t=${TOKEN}`);
    expect(m.text).toContain('valido por 15 minutos');
  });

  it('recuperacao: modelo professional_recuperacao e pagina de redefinicao', async () => {
    const sink = capturaEmMemoria();
    await montar(sink).recoveryLink(EMAIL, TOKEN, 'password_reset');
    expect(sink.enviadas[0]?.templateKey).toBe('professional_recuperacao');
    expect(sink.enviadas[0]?.text).toContain(`${BASE}/profissional/redefinir#t=${TOKEN}`);
  });

  it('ativacao de cliente: modelo professional_ativacao e pagina de ativacao', async () => {
    const sink = capturaEmMemoria();
    await montar(sink).recoveryLink(EMAIL, TOKEN, 'professional_activate');
    expect(sink.enviadas[0]?.templateKey).toBe('professional_ativacao');
    expect(sink.enviadas[0]?.text).toContain(`${BASE}/profissional/ativar#t=${TOKEN}`);
    expect(sink.enviadas[0]?.text).toContain('Sua senha de cliente nao muda');
  });

  it('finalidade desconhecida na recuperacao e recusada', async () => {
    await expect(
      montar().recoveryLink(EMAIL, TOKEN, 'outra' as 'password_reset'),
    ).rejects.toBeInstanceOf(ProfessionalMailInputError);
  });
});

describe('aviso de senha alterada (CA-H016-20)', () => {
  it('modelo senha_alterada, sem link, sem token e sem codigo no corpo', async () => {
    const sink = capturaEmMemoria();
    await montar(sink).passwordChangedNotice(EMAIL);
    const m = sink.enviadas[0]!;
    expect(m.templateKey).toBe('senha_alterada');
    expect(m.subject).toBe('Sua senha do FastPro foi alterada');
    expect(m.text).not.toContain(TOKEN);
    expect(m.text).not.toContain('#t=');
  });
});

describe('entradas e configuracao recusadas antes de qualquer envio', () => {
  it('token com formato errado nao sai', async () => {
    const sink = capturaEmMemoria();
    await expect(montar(sink).verificationLink(EMAIL, 'curto')).rejects.toBeInstanceOf(ProfessionalMailInputError);
    expect(sink.enviadas).toEqual([]);
  });

  it('e-mail sem forma valida nao sai', async () => {
    const sink = capturaEmMemoria();
    await expect(montar(sink).passwordChangedNotice('nao-e-email')).rejects.toBeInstanceOf(ProfessionalMailInputError);
    expect(sink.enviadas).toEqual([]);
  });

  it('origem invalida (barra final, caminho, sem esquema) falha na construcao', () => {
    for (const baseUrl of ['https://app.example.test/', 'app.example.test', 'ftp://x.example.test', 'https://a.test/x']) {
      expect(() => createProfessionalMailAdapter({ renderer, sink: capturaEmMemoria(), baseUrl })).toThrow(
        ProfessionalMailConfigError,
      );
    }
  });

  it('falha do sink propaga (quem chama decide a resposta)', async () => {
    const sink: ProfessionalMailSink = {
      async deliver() {
        throw new Error('falha do sink');
      },
    };
    await expect(montar(sink).verificationLink(EMAIL, TOKEN)).rejects.toThrow('falha do sink');
  });
});

// Transporte falso: registra as requisicoes e responde o que o teste mandar. Nenhuma conexao real.
function transporteFalso(status = 200, corpo = JSON.stringify({ id: 'msg-sintetica-1' })) {
  const pedidos: { url: string; headers: Record<string, string>; body: string }[] = [];
  return {
    pedidos,
    transporte: {
      async post(req: { url: string; headers: Record<string, string>; body: string }) {
        pedidos.push(req);
        return { status, headers: {}, body: corpo };
      },
    },
  };
}

const CHAVE = 'dummy-chave-sintetica';

const ENV_TESTE = {
  APP_ENV: 'test',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'onboarding@resend.dev',
  RESEND_API_KEY: CHAVE,
  RESEND_ACCOUNT_RECIPIENT: 'conta.sintetica@example.test',
  RESEND_VERIFIED_DOMAIN: '',
};

function provedor(status?: number, corpo?: string) {
  const { pedidos, transporte } = transporteFalso(status, corpo);
  const prov = new ResendProvider(ENV_TESTE, {
    http: transporte,
    renderer,
    clock: { nowMs: () => Date.UTC(2099, 0, 1), sleep: async () => {} },
  });
  return { prov, pedidos };
}

describe('envio pelo provedor do login (decisao 55 de 11-DECISOES.md)', () => {
  it('entrega pelo Resend (transporte falso): URL oficial, chave so no cabecalho, modelo renderizado', async () => {
    const { prov, pedidos } = provedor();
    const eventos: string[] = [];
    const adaptador = createProfessionalMailAdapter({
      renderer,
      sink: providerSink(prov, (nome) => eventos.push(nome)),
      baseUrl: BASE,
    });
    await adaptador.verificationLink('conta.sintetica@example.test', TOKEN);
    expect(eventos).toEqual([]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe('https://api.resend.com/emails');
    expect(pedidos[0]?.headers.Authorization).toBe(`Bearer ${CHAVE}`);
    const corpo = JSON.parse(pedidos[0]!.body) as { to: string; subject: string; text: string };
    expect(corpo.to).toBe('conta.sintetica@example.test');
    expect(corpo.subject).toBe('Confirme seu e-mail no FastPro');
    expect(corpo.text).toContain(`${BASE}/profissional/verificar#t=${TOKEN}`);
  });

  it('o mesmo link gera a mesma chave de idempotencia (reenvio nao duplica)', async () => {
    const { prov, pedidos } = provedor();
    const adaptador = createProfessionalMailAdapter({ renderer, sink: providerSink(prov), baseUrl: BASE });
    await adaptador.recoveryLink('conta.sintetica@example.test', TOKEN, 'password_reset');
    await adaptador.recoveryLink('conta.sintetica@example.test', TOKEN, 'password_reset');
    expect(pedidos[0]?.headers['Idempotency-Key']).toBe(pedidos[1]?.headers['Idempotency-Key']);
  });

  // ATUALIZADO na Issue 160 (decisao 1000 do dono): em test, o destino fora da conta agora e
  // redirecionado para a conta (desenho 188, D-188-03). Antes era recusado sem chamada HTTP.
  it('destinatario fora da conta registrada: redirecionado para a conta em test, com marcador (Issue 160)', async () => {
    const { prov, pedidos } = provedor();
    const eventos: { nome: string; motivo: string }[] = [];
    const sink = providerSink(prov, (nome, motivo) => eventos.push({ nome, motivo }));
    await expect(
      createProfessionalMailAdapter({ renderer, sink, baseUrl: BASE }).passwordChangedNotice('outra.pessoa@example.test'),
    ).resolves.toBeUndefined();
    expect(pedidos).toHaveLength(1);
    const corpo = JSON.parse(pedidos[0]!.body) as { to: string; subject: string; text: string };
    expect(corpo.to).toBe('conta.sintetica@example.test');
    expect(corpo.subject.startsWith('[Teste] ')).toBe(true);
    expect(corpo.subject).not.toContain('outra.pessoa');
    expect(corpo.text).toContain('outra.pessoa@example.test');
    expect(eventos).toEqual([]);
  });

  it('falha do provedor (HTTP 500): vira evento sem o link e a operacao nao lanca', async () => {
    const { prov } = provedor(500, '{}');
    const eventos: string[] = [];
    const sink = providerSink(prov, (nome, motivo) => eventos.push(`${nome}:${motivo}`));
    await expect(
      createProfessionalMailAdapter({ renderer, sink, baseUrl: BASE }).verificationLink('conta.sintetica@example.test', TOKEN),
    ).resolves.toBeUndefined();
    expect(eventos).toEqual(['professional_envio_nao_aceito:resend_http_500']);
    expect(eventos.join(' ')).not.toContain(TOKEN);
  });

  it('excecao do provedor: evento generico, sem lancar', async () => {
    const quebrado = {
      name: 'resend',
      async send(): Promise<never> {
        throw new Error('falha inesperada');
      },
    };
    const eventos: string[] = [];
    const sink = providerSink(quebrado, (nome) => eventos.push(nome));
    await expect(
      createProfessionalMailAdapter({ renderer, sink, baseUrl: BASE }).passwordChangedNotice(EMAIL),
    ).resolves.toBeUndefined();
    expect(eventos).toEqual(['professional_envio_falhou']);
  });
});
