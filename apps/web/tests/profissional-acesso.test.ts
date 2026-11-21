// #154 (desenho 176, S3 e S4; CA-154-14, 15, 16, 19; AD-154-03; decisao 953) | Cadastro e entrada do profissional com DOM simulado.
// Nenhum teste usa rede: o fetch e substituido por resposta fabricada. Textos conferidos exatamente (refino 172, 4.4 e 4.5).
import { describe, it, expect } from 'vitest';
import { carregarPagina, documentoFalso, resposta, type RespostaFalsa } from './entrada-dom-falso';

const IDS_CADASTRO = [
  'formulario', 'email', 'erro-email', 'senha', 'erro-senha', 'erro-geral', 'enviar',
  'alternar-senha', 'confira', 'confira-titulo', 'resultado', 'reenviar',
];
const IDS_ENTRAR = [
  'formulario', 'email', 'erro-email', 'senha', 'erro-senha', 'erro-geral', 'enviar',
  'alternar-senha', 'confirma', 'reenviar', 'resultado',
];
const SENHA = 'senha-sintetica-123';
const EMAIL = 'pessoa@exemplo.com';
const CAMINHO_CADASTRO = '/api/v1/auth/professional/register';
const CAMINHO_ENTRADA = '/api/v1/auth/professional/login';
const CAMINHO_REENVIO = '/api/v1/auth/professional/verification/resend';
const EMAIL_INVALIDO = 'Erro: Informe um e-mail válido.';
const SENHA_CURTA = 'Erro: A senha precisa ter pelo menos 8 caracteres.';
const SENHA_COMUM = 'Erro: Esta senha é comum demais. Escolha outra mais difícil de adivinhar.';
const LIMITE = 'Erro: Muitas tentativas. Aguarde alguns minutos e tente de novo.';
const CADASTRO_INDISPONIVEL = 'Erro: Não foi possível criar sua conta agora. Tente de novo em instantes.';
const ENTRAR_INDISPONIVEL = 'Erro: Não foi possível entrar agora. Tente de novo em instantes.';
const DADOS_INCORRETOS = 'Erro: E-mail ou senha incorretos.';
const CONTA_INDISPONIVEL = 'Erro: Esta conta não pode entrar agora.';
const REENVIADO = 'Se este e-mail puder ser usado, enviamos o link de novo.';

type Responder = (url: string, opcoes: Record<string, unknown>) => Promise<RespostaFalsa>;

function montar(pagina: 'cadastro' | 'entrar', responder: Responder) {
  const ids = pagina === 'cadastro' ? IDS_CADASTRO : IDS_ENTRAR;
  const doc = documentoFalso(ids, pagina);
  const estado = carregarPagina(['entrada-comum.js', 'profissional-acesso.js'], doc, responder);
  return {
    ...estado,
    email: doc.el('email'),
    senha: doc.el('senha'),
    formulario: doc.el('formulario'),
    erroGeral: doc.el('erro-geral'),
    erroEmail: doc.el('erro-email'),
    erroSenha: doc.el('erro-senha'),
    enviar: doc.el('enviar'),
    reenviar: doc.el('reenviar'),
    resultado: doc.el('resultado'),
    confirma: ids.includes('confirma') ? doc.el('confirma') : null,
  };
}
type Mundo = ReturnType<typeof montar>;

function enviar(m: Mundo, email: string, senha: string) {
  m.email.value = email;
  m.senha.value = senha;
  m.formulario.disparar('submit');
}

describe('cadastro do profissional (S3; CA-154-15, CA-154-16)', () => {
  it('202 vai para "Confira seu e-mail", apaga a senha e nao diz se a conta ja existia (decisao 953)', async () => {
    const responder: Responder = async () => resposta(202, { status: 'accepted' });
    const novo = montar('cadastro', responder);
    const existente = montar('cadastro', responder);
    enviar(novo, EMAIL, SENHA);
    enviar(existente, 'ja-cadastrada@exemplo.com', SENHA);
    await novo.esperar();
    await existente.esperar();
    expect(novo.formulario.hidden).toBe(true);
    expect(novo.senha.value).toBe('');
    expect(novo.chamadas[0][0]).toBe(CAMINHO_CADASTRO);
    expect(JSON.parse(String(novo.chamadas[0][1].body))).toEqual({ email: EMAIL, password: SENHA });
    expect(existente.formulario.hidden).toBe(true);
    expect(existente.erroGeral.textContent).toBe('');
  });

  it('senha curta ou e-mail sem arroba nao saem na rede e levam o foco ao campo', () => {
    const m = montar('cadastro', async () => resposta(202, {}));
    enviar(m, EMAIL, 'curta');
    expect(m.chamadas).toHaveLength(0);
    expect(m.erroSenha.textContent).toBe(SENHA_CURTA);
    expect(m.senha.focos).toBe(1);

    const n = montar('cadastro', async () => resposta(202, {}));
    enviar(n, 'sem-arroba', SENHA);
    expect(n.chamadas).toHaveLength(0);
    expect(n.erroEmail.textContent).toBe(EMAIL_INVALIDO);
  });

  it('422 de senha mostra o motivo do servidor e mantem a senha digitada', async () => {
    const m = montar('cadastro', async () => resposta(422, { code: 'campo_invalido', campo: 'password', motivo: 'comum' }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroSenha.textContent).toBe(SENHA_COMUM);
    expect(m.senha.value).toBe(SENHA);
    expect(m.erroEmail.textContent).toBe('');
  });

  it('422 de e-mail mostra o erro no campo de e-mail', async () => {
    const m = montar('cadastro', async () => resposta(422, { code: 'campo_invalido', campo: 'email', motivo: 'email' }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroEmail.textContent).toBe(EMAIL_INVALIDO);
  });

  it('429 mostra limite e segura o botao pelo tempo do cabecalho', async () => {
    const m = montar('cadastro', async () => resposta(429, {}, '10'));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(LIMITE);
    expect(m.enviar.disabled).toBe(true);
    expect(m.timers[0][1]).toBe(10_000);
  });

  it('falha de rede ou 503 mostra indisponivel, preserva o e-mail e apaga a senha', async () => {
    const m = montar('cadastro', async () => resposta(503, { code: 'service_unavailable' }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(CADASTRO_INDISPONIVEL);
    expect(m.email.value).toBe(EMAIL);
    expect(m.senha.value).toBe('');
    expect(m.enviar.disabled).toBe(false);
  });

  it('duplo envio enquanto pendente nao repete o cadastro (CA-154-04)', async () => {
    let liberar!: (r: RespostaFalsa) => void;
    const pendente = new Promise<RespostaFalsa>((r) => {
      liberar = r;
    });
    const m = montar('cadastro', () => pendente);
    enviar(m, EMAIL, SENHA);
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.chamadas).toHaveLength(1);
    expect(m.enviar.attrs['aria-busy']).toBe('true');
    liberar(resposta(202, {}));
    await m.esperar();
    expect(m.enviar.attrs['aria-busy']).toBeUndefined();
  });

  it('reenviar o link mostra o texto neutro com 202', async () => {
    const m = montar('cadastro', async (url) => (url === CAMINHO_REENVIO ? resposta(202, {}) : resposta(202, {})));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    m.reenviar.disparar('click');
    await m.esperar();
    expect(m.chamadas[m.chamadas.length - 1][0]).toBe(CAMINHO_REENVIO);
    expect(m.resultado.textContent).toBe(REENVIADO);
  });

  it('a senha nunca vai para URL, historico ou armazenamento', async () => {
    const m = montar('cadastro', async () => resposta(202, {}));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.trocas).toEqual([]);
    expect(m.redirecionamentos).toEqual([]);
    expect(m.armazenou).toEqual([]);
    expect(m.chamadas[0][0]).not.toContain(SENHA);
  });
});

describe('entrada do profissional (S4; CA-154-14, AD-154-03)', () => {
  it('200 com acesso completo e e-mail confirmado redireciona para o destino do profissional', async () => {
    const m = montar('entrar', async () => resposta(200, { access_level: 'full', email_verified: true }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.chamadas[0][0]).toBe(CAMINHO_ENTRADA);
    expect(m.redirecionamentos).toEqual(['/profissional-documentos']);
    expect(m.senha.value).toBe('');
  });

  it('200 so de verificacao nao redireciona e pede a confirmacao do e-mail (AD-154-03)', async () => {
    const m = montar('entrar', async () => resposta(200, { access_level: 'verification_only', email_verified: false }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.redirecionamentos).toEqual([]);
    expect(m.confirma?.hidden).toBe(false);
  });

  it('401 mostra dados incorretos sem indicar qual campo esta errado (CA-154-14)', async () => {
    const m = montar('entrar', async () => resposta(401, { code: 'invalid_credentials' }));
    enviar(m, EMAIL, 'senha-errada-000');
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(DADOS_INCORRETOS);
    expect(m.erroEmail.textContent).toBe('');
    expect(m.erroSenha.textContent).toBe('');
    expect(m.senha.value).toBe('');
  });

  it('403 mostra conta indisponivel, com texto proprio', async () => {
    const m = montar('entrar', async () => resposta(403, { code: 'account_unavailable' }));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(CONTA_INDISPONIVEL);
  });

  it('429 mostra limite e segura o botao pelo tempo do cabecalho', async () => {
    const m = montar('entrar', async () => resposta(429, { code: 'login_temporarily_blocked' }, '20'));
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    expect(m.erroGeral.textContent).toBe(LIMITE);
    expect(m.timers[0][1]).toBe(20_000);
  });

  it('falha de rede e 200 sem corpo valido mostram indisponivel e apagam a senha', async () => {
    const rede = montar('entrar', async () => Promise.reject(new Error('rede_simulada')) as never);
    enviar(rede, EMAIL, SENHA);
    await rede.esperar();
    expect(rede.erroGeral.textContent).toBe(ENTRAR_INDISPONIVEL);
    expect(rede.email.value).toBe(EMAIL);
    expect(rede.senha.value).toBe('');

    const semCorpo = montar('entrar', async () => resposta(200));
    enviar(semCorpo, EMAIL, SENHA);
    await semCorpo.esperar();
    expect(semCorpo.erroGeral.textContent).toBe(ENTRAR_INDISPONIVEL);
    expect(semCorpo.redirecionamentos).toEqual([]);
  });

  it('reenviar o link a partir da tela de entrada mostra o texto neutro', async () => {
    const m = montar('entrar', async (url) =>
      url === CAMINHO_ENTRADA ? resposta(200, { access_level: 'verification_only', email_verified: false }) : resposta(202, {}),
    );
    enviar(m, EMAIL, SENHA);
    await m.esperar();
    m.reenviar.disparar('click');
    await m.esperar();
    expect(m.chamadas[m.chamadas.length - 1][0]).toBe(CAMINHO_REENVIO);
    expect(m.resultado.textContent).toBe(REENVIADO);
  });
});
