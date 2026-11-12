// H-016 | Adaptador de envio do profissional com captura em memoria (CA-H016-06). Sem rede: fetch bloqueado.
// Sem provedor: o sink desligado nao chama nada. Token e e-mail sinteticos.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de e-mail');
};

import { describe, it, expect } from 'vitest';
import {
  capturaEmMemoria,
  createMinimalRenderer,
  createProfessionalAwareRenderer,
  createProfessionalMailAdapter,
  envioDesligado,
  ProfessionalMailConfigError,
  ProfessionalMailInputError,
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

describe('envio desligado (CA-H016-06)', () => {
  it('aceita e descarta sem chamar nada; resolve sem erro', async () => {
    const adaptador = createProfessionalMailAdapter({ renderer, sink: envioDesligado(), baseUrl: BASE });
    await expect(adaptador.verificationLink(EMAIL, TOKEN)).resolves.toBeUndefined();
    await expect(adaptador.passwordChangedNotice(EMAIL)).resolves.toBeUndefined();
  });
});
