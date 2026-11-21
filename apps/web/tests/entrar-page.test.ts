// #154 (desenho 176, S2; CA-154-02, 03, 04, 05, 19, 24; RN-154-02, 13) | Pagina /entrar com DOM simulado (node:vm).
// Nenhum teste usa rede: o fetch e substituido por resposta fabricada. Textos conferidos exatamente (refino 172, 4.1).
import { describe, it, expect } from 'vitest';
import { carregarPagina, documentoFalso, resposta, type RespostaFalsa } from './entrada-dom-falso';

const IDS = ['formulario', 'email', 'erro-email', 'erro-geral', 'resultado', 'enviar'];
const CAMINHO = '/api/v1/auth/challenges';
const ENVIADO = 'Se o e-mail estiver cadastrado, enviamos um novo código.';
const ENVIADO_LINK = 'Ou abra o link que enviamos ao seu e-mail.';
const EMAIL_INVALIDO = 'Informe um e-mail válido para pedir o código.';
const LIMITE = 'Muitos pedidos. Aguarde alguns minutos antes de pedir outro código.';
const INDISPONIVEL = 'Não foi possível enviar agora. Tente de novo em instantes.';

type Responder = (url: string, opcoes: Record<string, unknown>) => Promise<RespostaFalsa>;

function montar(responder: Responder) {
  const doc = documentoFalso(IDS, 'entrar');
  const pagina = carregarPagina(['entrada-comum.js', 'entrar.js'], doc, responder);
  return {
    ...pagina,
    campo: doc.el('email'),
    botao: doc.el('enviar'),
    formulario: doc.el('formulario'),
    erroCampo: doc.el('erro-email'),
    erroGeral: doc.el('erro-geral'),
    resultado: doc.el('resultado'),
  };
}
type Mundo = ReturnType<typeof montar>;

function enviar(m: Mundo, email: string) {
  m.campo.value = email;
  return m.formulario.disparar('submit');
}

function diferido() {
  let resolver!: (r: RespostaFalsa) => void;
  const promessa = new Promise<RespostaFalsa>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe('/entrar: pedido uniforme (CA-154-02, RN-154-02)', () => {
  it('202 mostra a mesma mensagem para e-mail cadastrado e para e-mail nao cadastrado', async () => {
    const responder: Responder = async () => resposta(202, { status: 'accepted' });
    const a = montar(responder);
    const b = montar(responder);
    enviar(a, 'cadastrado@exemplo.com');
    enviar(b, 'nao-cadastrado@exemplo.com');
    await a.esperar();
    expect(a.resultado.textContent).toBe(`${ENVIADO} ${ENVIADO_LINK}`);
    expect(b.resultado.textContent).toBe(a.resultado.textContent);
    expect(a.erroGeral.textContent).toBe('');
  });

  it('pedido usa a rota de desafio com finalidade de acesso e o e-mail sem espacos', async () => {
    const m = montar(async () => resposta(202, {}));
    enviar(m, '  pessoa@exemplo.com  ');
    await m.esperar();
    expect(m.chamadas).toHaveLength(1);
    const [url, opcoes] = m.chamadas[0];
    expect(url).toBe(CAMINHO);
    expect(opcoes.method).toBe('POST');
    expect(opcoes.cache).toBe('no-store');
    expect(opcoes.redirect).toBe('error');
    expect(opcoes.credentials).toBe('same-origin');
    expect(opcoes.referrerPolicy).toBe('no-referrer');
    expect(JSON.parse(String(opcoes.body))).toEqual({ email: 'pessoa@exemplo.com', purpose: 'login' });
  });

  it('o e-mail nao vai para a URL nem para o armazenamento (RN-154-13, CA-154-24)', async () => {
    const m = montar(async () => resposta(202, {}));
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.chamadas[0][0]).not.toMatch(/@|\?|#/);
    expect(m.trocas).toEqual([]);
    expect(m.redirecionamentos).toEqual([]);
    expect(m.armazenou).toEqual([]);
  });
});

describe('/entrar: validacao e envio unico (CA-154-03, CA-154-04)', () => {
  it('e-mail sem arroba mostra erro junto ao campo, move o foco e nao chama a rede', () => {
    const m = montar(async () => resposta(202, {}));
    const evento = enviar(m, 'sem-arroba');
    expect(evento.prevented).toBe(true);
    expect(m.chamadas).toHaveLength(0);
    expect(m.erroCampo.textContent).toBe(`Erro: ${EMAIL_INVALIDO}`);
    expect(m.campo.attrs['aria-invalid']).toBe('true');
    expect(m.campo.focos).toBe(1);
  });

  it('segundo envio enquanto o primeiro esta pendente nao faz outro pedido', async () => {
    const d = diferido();
    const m = montar(() => d.promessa);
    enviar(m, 'pessoa@exemplo.com');
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.chamadas).toHaveLength(1);
    expect(m.botao.disabled).toBe(true);
    expect(m.botao.attrs['aria-busy']).toBe('true');
    expect(m.botao.textContent).toBe('');
    d.resolver(resposta(202, {}));
    await m.esperar();
    expect(m.botao.disabled).toBe(false);
    expect(m.botao.attrs['aria-busy']).toBeUndefined();
    expect(m.resultado.textContent).toContain(ENVIADO);
  });

  it('422 do servidor mostra o erro junto ao campo de e-mail', async () => {
    const m = montar(async () => resposta(422, { code: 'campo_invalido', campo: 'email' }));
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.erroCampo.textContent).toBe(`Erro: ${EMAIL_INVALIDO}`);
    expect(m.erroGeral.textContent).toBe('');
  });
});

describe('/entrar: limite e indisponibilidade (CA-154-05, CA-154-19, AD-154-06, AD-154-08)', () => {
  it('429 mostra o limite e segura o botao pelo tempo do cabecalho, sem mostrar o numero', async () => {
    const m = montar(async () => resposta(429, { code: 'muitos_pedidos' }, '42'));
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(`Erro: ${LIMITE}`);
    expect(m.erroGeral.textContent).not.toMatch(/\d/);
    expect(m.botao.disabled).toBe(true);
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0][1]).toBe(42_000);
    m.timers[0][0]();
    expect(m.botao.disabled).toBe(false);
  });

  it('429 sem cabecalho espera 30 s; cabecalho abaixo do minimo usa 5 s', async () => {
    const semCabecalho = montar(async () => resposta(429, {}));
    enviar(semCabecalho, 'pessoa@exemplo.com');
    await semCabecalho.esperar();
    expect(semCabecalho.timers[0][1]).toBe(30_000);

    const minimo = montar(async () => resposta(429, {}, '1'));
    enviar(minimo, 'pessoa@exemplo.com');
    await minimo.esperar();
    expect(minimo.timers[0][1]).toBe(5_000);
  });

  it.each([
    ['falha de rede', async (): Promise<RespostaFalsa> => Promise.reject(new Error('rede_simulada'))],
    ['404 da API ainda nao publicada', async (): Promise<RespostaFalsa> => resposta(404)],
    ['erro do servidor', async (): Promise<RespostaFalsa> => resposta(500, {})],
    ['503 do servico', async (): Promise<RespostaFalsa> => resposta(503, { code: 'service_unavailable' })],
  ])('%s mostra indisponivel e preserva o e-mail', async (_nome, responder) => {
    const m = montar(responder);
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(`Erro: ${INDISPONIVEL}`);
    expect(m.campo.value).toBe('pessoa@exemplo.com');
    expect(m.botao.disabled).toBe(false);
    expect(m.botao.attrs['aria-busy']).toBeUndefined();
    expect(m.resultado.textContent).toBe('');
  });

  it('depois de um erro, um novo envio com sucesso limpa a mensagem de erro', async () => {
    let vez = 0;
    const m = montar(async () => (vez++ === 0 ? resposta(500, {}) : resposta(202, {})));
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.erroGeral.textContent).not.toBe('');
    enviar(m, 'pessoa@exemplo.com');
    await m.esperar();
    expect(m.erroGeral.textContent).toBe('');
    expect(m.resultado.textContent).toContain(ENVIADO);
  });
});
