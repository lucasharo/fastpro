// #154 (desenho 176, S5 e S6; CA-154-15, 17, 24; AD-154-01) | Confirmacao do e-mail do profissional pelo link.
// Nenhum teste usa rede: o fetch e substituido por resposta fabricada. O token e sintetico (43 caracteres base64url).
import { describe, it, expect } from 'vitest';
import { carregarPagina, documentoFalso, resposta, type RespostaFalsa } from './entrada-dom-falso';

const TOKEN = 'tok-sintetico_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';
const HASH = `#t=${TOKEN}`;
const CAMINHO_CONFIRMAR = '/api/v1/auth/professional/verification/confirm';
const CAMINHO_REENVIO = '/api/v1/auth/professional/verification/resend';
const CAMINHO_PAGINA = '/profissional/verificar';
const EMAIL = 'pessoa@exemplo.com';
const SEM_LINK = 'Erro: Este link não está completo. Abra o link que enviamos ao seu e-mail ou peça um novo.';
const LINK_INVALIDO = 'Erro: Este link não pode mais ser usado. Peça um novo link.';
const INDISPONIVEL = 'Erro: Não foi possível confirmar agora. Tente de novo em instantes.';
const CONFIRMADO = 'E-mail confirmado. Agora você pode enviar seus documentos.';
const REENVIADO = 'Se este e-mail puder ser usado, enviamos o link de novo.';
const LIMITE = 'Erro: Muitas tentativas. Aguarde alguns minutos e tente de novo.';
const EMAIL_INVALIDO = 'Erro: Informe um e-mail válido.';

type Responder = (url: string, opcoes: Record<string, unknown>) => Promise<RespostaFalsa>;

const IDS = [
  'confirmar', 'aviso', 'erro-geral', 'proximo', 'continuar', 'novo-link', 'formulario-novo',
  'email', 'erro-email', 'reenviar', 'resultado',
];

function montar(responder: Responder, hash = HASH) {
  const doc = documentoFalso(IDS, 'verificar');
  const estado = carregarPagina(['entrada-comum.js', 'profissional-link.js'], doc, responder, hash);
  return {
    ...estado,
    botao: doc.el('confirmar'),
    aviso: doc.el('aviso'),
    erroGeral: doc.el('erro-geral'),
    proximo: doc.el('proximo'),
    continuar: doc.el('continuar'),
    novoLink: doc.el('novo-link'),
    formulario: doc.el('formulario-novo'),
    email: doc.el('email'),
    erroEmail: doc.el('erro-email'),
    reenviar: doc.el('reenviar'),
    resultado: doc.el('resultado'),
  };
}
type Mundo = ReturnType<typeof montar>;

/** Libera o botao como faria o temporizador de 1 s da pagina. */
function liberarBotao(m: Mundo) {
  const agendado = m.timers.find(([, ms]) => ms === 1000);
  if (agendado) agendado[0]();
}

function clicar(m: Mundo) {
  m.botao.disparar('click');
}

describe('verificar: confirmacao do e-mail pelo link (S5; CA-154-15)', () => {
  it('o token sai da barra logo na carga e nao vai para armazenamento nem URL nova', () => {
    const m = montar(async () => resposta(204));
    expect(m.trocas).toEqual([CAMINHO_PAGINA]);
    expect(m.trocas.join('|')).not.toContain(TOKEN);
    expect(m.armazenou).toEqual([]);
  });

  it('nenhuma chamada de rede antes do clique; o botao so libera depois de 1 s', () => {
    const m = montar(async () => resposta(204));
    expect(m.chamadas).toHaveLength(0);
    expect(m.botao.disabled).toBe(true);
    expect(m.timers.map(([, ms]) => ms)).toEqual([1000]);
    liberarBotao(m);
    expect(m.botao.disabled).toBe(false);
    expect(m.chamadas).toHaveLength(0);
  });

  it('clique envia o token por POST no corpo e 204 mostra confirmado, sem redirecionar', async () => {
    const m = montar(async () => resposta(204));
    liberarBotao(m);
    clicar(m);
    await m.esperar();
    expect(m.chamadas).toHaveLength(1);
    expect(m.chamadas[0][0]).toBe(CAMINHO_CONFIRMAR);
    expect(m.chamadas[0][1].method).toBe('POST');
    expect(JSON.parse(String(m.chamadas[0][1].body))).toEqual({ token: TOKEN });
    expect(m.aviso.textContent).toBe(CONFIRMADO);
    expect(m.proximo.hidden).toBe(false);
    expect(m.continuar.getAttribute('href')).toBe('/profissional-documentos');
    expect(m.botao.disabled).toBe(true);
    expect(m.redirecionamentos).toEqual([]);
    expect(m.armazenou).toEqual([]);
  });

  it('duplo clique enquanto pendente envia uma vez so (CA-154-04)', async () => {
    let liberar!: (r: RespostaFalsa) => void;
    const pendente = new Promise<RespostaFalsa>((r) => {
      liberar = r;
    });
    const m = montar(() => pendente);
    liberarBotao(m);
    clicar(m);
    clicar(m);
    await m.esperar();
    expect(m.chamadas).toHaveLength(1);
    expect(m.botao.attrs['aria-busy']).toBe('true');
    liberar(resposta(204));
    await m.esperar();
    expect(m.botao.attrs['aria-busy']).toBeUndefined();
  });

  it('410 mostra link invalido e oferece pedir novo link, sem dizer o motivo', async () => {
    const m = montar(async () => resposta(410, { code: 'link_invalid' }));
    liberarBotao(m);
    clicar(m);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(LINK_INVALIDO);
    expect(m.novoLink.hidden).toBe(false);
    expect(m.proximo.hidden).toBe(true);
    expect(m.botao.disabled).toBe(true);
  });

  it('503 e falha de rede mostram indisponivel e deixam o botao tentar de novo com o mesmo token', async () => {
    const m = montar(async () => resposta(503, { code: 'service_unavailable' }));
    liberarBotao(m);
    clicar(m);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(INDISPONIVEL);
    expect(m.botao.disabled).toBe(false);
    clicar(m);
    await m.esperar();
    expect(m.chamadas).toHaveLength(2);
    expect(JSON.parse(String(m.chamadas[1][1].body))).toEqual({ token: TOKEN });

    const rede = montar(() => Promise.reject(new Error('rede_simulada')) as never);
    liberarBotao(rede);
    clicar(rede);
    await rede.esperar();
    expect(rede.erroGeral.textContent).toBe(INDISPONIVEL);
  });

  it('404 da API ainda nao publicada tambem vira indisponivel (AD-154-06)', async () => {
    const m = montar(async () => resposta(404));
    liberarBotao(m);
    clicar(m);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(INDISPONIVEL);
  });

  it('sem fragmento: nao chama a rede, mostra o aviso e oferece pedir novo link', async () => {
    const m = montar(async () => resposta(204), '');
    expect(m.chamadas).toHaveLength(0);
    expect(m.botao.disabled).toBe(true);
    expect(m.erroGeral.textContent).toBe(SEM_LINK);
    expect(m.novoLink.hidden).toBe(false);
    expect(m.trocas).toEqual([CAMINHO_PAGINA]);
  });

  it('fragmento de forma errada conta como sem link', () => {
    const m = montar(async () => resposta(204), '#t=curto com espaco');
    expect(m.erroGeral.textContent).toBe(SEM_LINK);
    expect(m.chamadas).toHaveLength(0);
  });
});

describe('verificar: pedir novo link (S5; AD-154-01)', () => {
  it('e-mail invalido nao sai na rede e leva o foco ao campo', () => {
    const m = montar(async () => resposta(202), '');
    m.email.value = 'sem-arroba';
    m.formulario.disparar('submit');
    expect(m.chamadas).toHaveLength(0);
    expect(m.erroEmail.textContent).toBe(EMAIL_INVALIDO);
    expect(m.email.focos).toBe(1);
  });

  it('202 mostra o texto neutro igual para qualquer e-mail', async () => {
    const m = montar(async () => resposta(202, {}), '');
    m.email.value = EMAIL;
    m.formulario.disparar('submit');
    await m.esperar();
    expect(m.chamadas[0][0]).toBe(CAMINHO_REENVIO);
    expect(JSON.parse(String(m.chamadas[0][1].body))).toEqual({ email: EMAIL });
    expect(m.resultado.textContent).toBe(REENVIADO);
    expect(m.trocas.join('|')).not.toContain('@');
  });

  it('429 mostra limite sem numero e segura o botao pelo tempo do cabecalho', async () => {
    const m = montar(async () => resposta(429, {}, '45'), '');
    m.email.value = EMAIL;
    m.formulario.disparar('submit');
    await m.esperar();
    expect(m.resultado.textContent).toBe(LIMITE);
    expect(m.reenviar.disabled).toBe(true);
    expect(m.timers[0][1]).toBe(45_000);
  });

  it('falha de rede no reenvio mostra indisponivel e preserva o e-mail', async () => {
    const m = montar(async () => resposta(503, {}), '');
    m.email.value = EMAIL;
    m.formulario.disparar('submit');
    await m.esperar();
    expect(m.resultado.textContent).toBe('Erro: Não foi possível enviar agora. Tente de novo em instantes.');
    expect(m.email.value).toBe(EMAIL);
  });

  it('o envio do novo link nunca leva o e-mail nem o token a URL ou armazenamento', async () => {
    const m = montar(async () => resposta(202, {}));
    liberarBotao(m);
    m.email.value = EMAIL;
    m.formulario.disparar('submit');
    await m.esperar();
    expect(m.armazenou).toEqual([]);
    expect(m.trocas).toEqual([CAMINHO_PAGINA]);
    expect(m.redirecionamentos).toEqual([]);
  });
});
