// H-016 | Adaptador Pg do profissional com cliente falso e Auth falso (T-H016-01, 05, 07, 08, 12, 16 no
// adaptador; 33 §3.2 compensacao). Nenhum banco, nenhuma rede: o SQL e conferido pelos parametros
// e pela ordem das chamadas. A prova no Postgres real fica para o teste de banco (dbtest).
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { challengeSha256Hex } from '../src/challenges-crypto.js';
import { hashSessionSecret } from '../src/session.js';
import {
  PgProfessionalAuth,
  PROFESSIONAL_LOGIN_KEY_PURPOSE,
  SupabaseAuthGateway,
  type ProfessionalAuthGateway,
  type ProfessionalMailPort,
} from '../src/professional-auth.js';
import type { SqlClient } from '../src/jobs-tick.js';

const PEPPER = 'pimenta-x';
const EMAIL = 'pessoa.sintetica@example.test';
const SENHA = 'senha-sintetica-x';
const AGORA = Date.UTC(2099, 0, 1, 12);
const AGORA_ISO = '2099-01-01T12:00:00.000Z';
const hmac = (texto: string): string => createHmac('sha256', PEPPER).update(texto, 'utf8').digest('hex');

interface Resposta {
  readonly contem: string;
  readonly rows: Record<string, unknown>[];
}

/** Cliente falso: grava cada SQL e devolve linhas conforme o trecho do SQL. */
class ClienteFalso implements SqlClient {
  readonly chamadas: Array<{ sql: string; params: unknown[] }> = [];
  falhaEm: string | null = null;
  constructor(private readonly respostas: Resposta[] = []) {}
  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.chamadas.push({ sql: text, params });
    if (this.falhaEm !== null && text.includes(this.falhaEm)) throw new Error('falha de banco simulada');
    const achada = this.respostas.find((r) => text.includes(r.contem));
    const rows = achada ? achada.rows : [];
    return { rows, rowCount: rows.length };
  }
  chamada(trecho: string): { sql: string; params: unknown[] } | undefined {
    return this.chamadas.find((c) => c.sql.includes(trecho));
  }
}

/** Auth falso: registra remocoes e devolve o que o teste configurar. */
class AuthFalso implements ProfessionalAuthGateway {
  deleteFalha = false;
  senhasTrocadas: Array<{ authUserId: string; senha: string }> = [];
  criarResultado: { authUserId: string } | 'existente' = { authUserId: 'auth-1' };
  entrarResultado: { authUserId: string } | null = { authUserId: 'auth-1' };
  removidos: string[] = [];
  criados: Array<{ email: string; senha: string }> = [];
  async createUser(email: string, password: string) {
    this.criados.push({ email, senha: password });
    return this.criarResultado;
  }
  async deleteUser(authUserId: string): Promise<void> {
    if (this.deleteFalha) throw new Error('falha de remocao simulada');
    this.removidos.push(authUserId);
  }
  async updatePassword(authUserId: string, password: string): Promise<void> {
    this.senhasTrocadas.push({ authUserId, senha: password });
  }
  async signInWithPassword(): Promise<{ authUserId: string } | null> {
    return this.entrarResultado;
  }
}

function montar(opcoes: { cliente?: ClienteFalso; auth?: AuthFalso; mailFalha?: boolean } = {}) {
  const eventos: Array<[string, Record<string, string>]> = [];
  const cliente = opcoes.cliente ?? new ClienteFalso();
  const auth = opcoes.auth ?? new AuthFalso();
  const enviados: Array<{ email: string; token: string }> = [];
  const mail: ProfessionalMailPort = {
    async verificationLink(email, token) {
      if (opcoes.mailFalha) throw new Error('falha de envio simulada');
      enviados.push({ email, token });
    },
  };
  let n = 0;
  const porta = new PgProfessionalAuth({
    client: cliente,
    gateway: auth,
    mail,
    pepperEmail: PEPPER,
    evento: (nome, dados) => eventos.push([nome, dados]),
    newId: () => `id-${++n}`,
    newSecret: () => 'segredo-x',
  });
  return { porta, cliente, auth, enviados, eventos };
}

describe('T-H016-01 cadastro no adaptador (CA-H016-01, 33 §3.2)', () => {
  it('cria no Auth primeiro, grava no banco com hashes e envia o link', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_register_create', rows: [{ out_resultado: 'criado' }] }]);
    const { porta, auth, enviados } = montar({ cliente });
    await porta.register(EMAIL, SENHA, AGORA);
    expect(auth.criados).toEqual([{ email: EMAIL, senha: SENHA }]);
    const chamada = cliente.chamada('professional_register_create');
    expect(chamada?.params).toEqual([
      'id-1',
      'auth-1',
      EMAIL,
      hmac(EMAIL),
      'id-2',
      challengeSha256Hex('segredo-x'),
      AGORA_ISO,
    ]);
    expect(enviados).toEqual([{ email: EMAIL, token: 'segredo-x' }]);
    expect(auth.removidos).toEqual([]);
  });

  it('e-mail existente no Auth: nada no banco, nada enviado (anti-enumeracao)', async () => {
    const cliente = new ClienteFalso();
    const auth = new AuthFalso();
    auth.criarResultado = 'existente';
    const { porta, enviados } = montar({ cliente, auth });
    await porta.register(EMAIL, SENHA, AGORA);
    expect(cliente.chamada('professional_register_create')).toBeUndefined();
    expect(enviados).toEqual([]);
  });

  it('banco responde existente: remove o usuario recem-criado no Auth e nao envia', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_register_create', rows: [{ out_resultado: 'existente' }] }]);
    const { porta, auth, enviados } = montar({ cliente });
    await porta.register(EMAIL, SENHA, AGORA);
    expect(auth.removidos).toEqual(['auth-1']);
    expect(enviados).toEqual([]);
  });

  it('falha do banco: remove o usuario do Auth e repassa o erro (vira 503 na rota)', async () => {
    const cliente = new ClienteFalso();
    cliente.falhaEm = 'professional_register_create';
    const { porta, auth, enviados } = montar({ cliente });
    await expect(porta.register(EMAIL, SENHA, AGORA)).rejects.toThrow('falha de banco simulada');
    expect(auth.removidos).toEqual(['auth-1']);
    expect(enviados).toEqual([]);
  });
});

describe('T-H016-07 e T-H016-08 consumo do link no adaptador', () => {
  it('confere pelo hash do segredo; linha devolvida = consumido', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_verify_confirm', rows: [{ out_user_id: 'u-1' }] }]);
    const { porta } = montar({ cliente });
    expect(await porta.confirmVerification('segredo-x', AGORA)).toBe(true);
    expect(cliente.chamada('professional_verify_confirm')?.params).toEqual([
      challengeSha256Hex('segredo-x'),
      AGORA_ISO,
    ]);
  });

  it('sem linha (usado, vencido, desconhecido): falso, sem detalhe', async () => {
    const { porta } = montar();
    expect(await porta.confirmVerification('outro-segredo', AGORA)).toBe(false);
  });
});

describe('T-H016-12 contador de login no adaptador (chave HMAC com finalidade)', () => {
  it('usa a chave HMAC com a finalidade de login, nunca o e-mail em claro', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_login_gate', rows: [{ out_bloqueada: false, out_retry_after: 0 }] }]);
    const { porta } = montar({ cliente });
    expect(await porta.loginGate(EMAIL, AGORA)).toEqual({ kind: 'tentativa' });
    const chave = String(cliente.chamada('professional_login_gate')?.params[0]);
    expect(chave).toBe(hmac(`${PROFESSIONAL_LOGIN_KEY_PURPOSE}${EMAIL}`));
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chave).not.toBe(hmac(EMAIL));
  });

  it('linha barrada: devolve bloqueada com a espera do banco', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_login_gate', rows: [{ out_bloqueada: true, out_retry_after: 30 }] }]);
    const { porta } = montar({ cliente });
    expect(await porta.loginGate(EMAIL, AGORA)).toEqual({ kind: 'bloqueada', retryAfterSeconds: 30 });
  });

  it('login correto zera o contador pela mesma chave', async () => {
    const cliente = new ClienteFalso();
    const { porta } = montar({ cliente });
    await porta.loginSucceeded(EMAIL);
    expect(cliente.chamada('professional_login_success')?.params).toEqual([
      hmac(`${PROFESSIONAL_LOGIN_KEY_PURPOSE}${EMAIL}`),
    ]);
  });
});

describe('T-H016-11 e T-H016-13 conferencia da senha e da conta', () => {
  it('senha errada no Auth: nulo, sem consulta ao banco', async () => {
    const auth = new AuthFalso();
    auth.entrarResultado = null;
    const cliente = new ClienteFalso();
    const { porta } = montar({ cliente, auth });
    expect(await porta.verifyPassword(EMAIL, 'errada')).toBeNull();
    expect(cliente.chamadas).toEqual([]);
  });

  it('senha certa e conta do mesmo usuario: credencial com verificacao e atividade', async () => {
    const cliente = new ClienteFalso([
      {
        contem: 'professional_account_by_email',
        rows: [{ out_user_id: 'u-1', out_auth_user_id: 'auth-1', out_active: true, out_verified: false }],
      },
    ]);
    const { porta } = montar({ cliente });
    expect(await porta.verifyPassword(EMAIL, SENHA)).toEqual({
      userId: 'u-1',
      emailVerified: false,
      active: true,
    });
  });

  it('auth_user_id diferente do que o Auth confirmou: inativa (nunca abre sessao)', async () => {
    const cliente = new ClienteFalso([
      {
        contem: 'professional_account_by_email',
        rows: [{ out_user_id: 'u-1', out_auth_user_id: 'outro', out_active: true, out_verified: true }],
      },
    ]);
    const { porta } = montar({ cliente });
    expect((await porta.verifyPassword(EMAIL, SENHA))?.active).toBe(false);
  });
});

describe('T-H016-16 sessao por senha no adaptador (33 §5.1 passo 5)', () => {
  it('grava so o hash do segredo e devolve o segredo em claro', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_session_open', rows: [{ out_session_id: 's-1' }] }]);
    const { porta } = montar({ cliente });
    const sessao = await porta.openSession({ userId: 'u-1', emailVerified: true, active: true }, AGORA);
    expect(sessao.secret).toBe('segredo-x');
    const params = cliente.chamada('professional_session_open')?.params ?? [];
    expect(params).toEqual(['id-1', 'u-1', hashSessionSecret('segredo-x'), AGORA_ISO]);
    expect(params).not.toContain('segredo-x');
  });

  it('sem linha de sessao: erro, sem segredo devolvido', async () => {
    const { porta } = montar();
    await expect(porta.openSession({ userId: 'u-1', emailVerified: true, active: true }, AGORA)).rejects.toThrow(
      'sessao_nao_aberta',
    );
  });
});


describe('cadastro: falhas de envio e de compensacao (33 §3.2, pedido de revisao)', () => {
  it('falha do envio do link: a conta fica e o cadastro repetido reenvia (nova senha, link novo, sessoes revogadas)', async () => {
    const cliente = new ClienteFalso([
      { contem: 'professional_register_create', rows: [{ out_resultado: 'criado' }] },
      {
        contem: 'professional_account_by_email',
        rows: [{ out_user_id: 'u-1', out_auth_user_id: 'auth-1', out_active: false, out_verified: false, out_professional: true }],
      },
      { contem: 'professional_register_resend', rows: [{ out_resultado: 'reenviado' }] },
    ]);
    const { porta, auth, enviados } = montar({ cliente, mailFalha: true });
    await expect(porta.register(EMAIL, SENHA, AGORA)).rejects.toThrow('falha de envio simulada');
    expect(auth.removidos).toEqual([]);
    expect(enviados).toEqual([]);

    // Segunda vez: o Auth ja conhece o e-mail; o envio agora funciona.
    auth.criarResultado = 'existente';
    const mailOk = montar({ cliente, auth });
    await mailOk.porta.register(EMAIL, 'nova-senha-x', AGORA);
    expect(auth.senhasTrocadas).toEqual([{ authUserId: 'auth-1', senha: 'nova-senha-x' }]);
    expect(cliente.chamada('professional_register_resend')?.params).toEqual([
      'u-1',
      hmac(EMAIL),
      'id-1',
      challengeSha256Hex('segredo-x'),
      AGORA_ISO,
    ]);
    expect(mailOk.enviados).toEqual([{ email: EMAIL, token: 'segredo-x' }]);
  });

  it('conta verificada ou sem perfil profissional: nada e trocado nem enviado', async () => {
    const cliente = new ClienteFalso([
      {
        contem: 'professional_account_by_email',
        rows: [{ out_user_id: 'u-1', out_auth_user_id: 'auth-1', out_active: true, out_verified: true, out_professional: true }],
      },
    ]);
    const auth = new AuthFalso();
    auth.criarResultado = 'existente';
    const { porta, enviados } = montar({ cliente, auth });
    await porta.register(EMAIL, SENHA, AGORA);
    expect(auth.senhasTrocadas).toEqual([]);
    expect(cliente.chamada('professional_register_resend')).toBeUndefined();
    expect(enviados).toEqual([]);
  });

  it('falha ao desfazer no Auth depois de erro do banco: registra pendencia sem e-mail e repassa o erro do banco', async () => {
    const cliente = new ClienteFalso();
    cliente.falhaEm = 'professional_register_create';
    const auth = new AuthFalso();
    auth.deleteFalha = true;
    const { porta, eventos } = montar({ cliente, auth });
    await expect(porta.register(EMAIL, SENHA, AGORA)).rejects.toThrow('falha de banco simulada');
    expect(eventos).toEqual([
      ['professional_auth_compensacao_pendente', { motivo: 'banco', auth_user_id: 'auth-1' }],
    ]);
    expect(JSON.stringify(eventos)).not.toContain(EMAIL);
  });

  it('banco diz existente e a remocao falha: o cadastro responde normalmente (sem erro que revele o e-mail)', async () => {
    const cliente = new ClienteFalso([{ contem: 'professional_register_create', rows: [{ out_resultado: 'existente' }] }]);
    const auth = new AuthFalso();
    auth.deleteFalha = true;
    const { porta, eventos } = montar({ cliente, auth });
    await expect(porta.register(EMAIL, SENHA, AGORA)).resolves.toBeUndefined();
    expect(eventos[0][0]).toBe('professional_auth_compensacao_pendente');
  });

  it('e-mail existente e falha ao consultar a conta: responde normalmente e registra o evento', async () => {
    const cliente = new ClienteFalso();
    cliente.falhaEm = 'professional_account_by_email';
    const auth = new AuthFalso();
    auth.criarResultado = 'existente';
    const { porta, eventos } = montar({ cliente, auth });
    await expect(porta.register(EMAIL, SENHA, AGORA)).resolves.toBeUndefined();
    expect(eventos).toEqual([['professional_reenvio_falhou', { etapa: 'reenvio' }]]);
  });
});

describe('Supabase Auth por HTTP (plano gratuito, sem SDK)', () => {
  type Chamada = { url: string; init: RequestInit };
  const cfg = { url: 'https://projeto-sintetico.test/', secretKey: 'chave-x', publishableKey: 'publica-x' };
  function http(respostas: Array<{ status: number; corpo?: unknown }>) {
    const chamadas: Chamada[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      const r = respostas.shift() ?? { status: 500 };
      return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status });
    }) as typeof fetch;
    return { chamadas, fetch: fn };
  }

  it('createUser: cria com e-mail confirmado e a chave secreta; 422 email_exists vira existente', async () => {
    const ok = http([{ status: 200, corpo: { id: 'auth-9' } }]);
    const gw = new SupabaseAuthGateway({ ...cfg, fetch: ok.fetch });
    expect(await gw.createUser(EMAIL, SENHA)).toEqual({ authUserId: 'auth-9' });
    expect(ok.chamadas[0].url).toBe('https://projeto-sintetico.test/auth/v1/admin/users');
    expect(JSON.parse(String(ok.chamadas[0].init.body))).toEqual({ email: EMAIL, password: SENHA, email_confirm: true });
    expect((ok.chamadas[0].init.headers as Record<string, string>).apikey).toBe(cfg.secretKey);

    const dup = http([{ status: 422, corpo: { error_code: 'email_exists' } }]);
    expect(await new SupabaseAuthGateway({ ...cfg, fetch: dup.fetch }).createUser(EMAIL, SENHA)).toBe('existente');
  });

  it('erro do Auth: a mensagem traz so o passo e o status, nunca e-mail ou senha', async () => {
    const falha = http([{ status: 500, corpo: { msg: EMAIL + SENHA } }]);
    const gw = new SupabaseAuthGateway({ ...cfg, fetch: falha.fetch });
    const erro = await gw.createUser(EMAIL, SENHA).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('auth_createUser_500');
    expect((erro as Error).message).not.toContain(SENHA);
  });

  it('signInWithPassword: 400 vira nulo; 200 devolve o id e nao guarda tokens', async () => {
    const errada = http([{ status: 400, corpo: { error_code: 'invalid_credentials' } }]);
    expect(await new SupabaseAuthGateway({ ...cfg, fetch: errada.fetch }).signInWithPassword(EMAIL, 'x')).toBeNull();
    expect((errada.chamadas[0].init.headers as Record<string, string>).apikey).toBe(cfg.publishableKey);
    expect(errada.chamadas[0].url).toBe('https://projeto-sintetico.test/auth/v1/token?grant_type=password');

    const certa = http([{ status: 200, corpo: { access_token: 'nao-guardar', user: { id: 'auth-3' } } }]);
    expect(await new SupabaseAuthGateway({ ...cfg, fetch: certa.fetch }).signInWithPassword(EMAIL, SENHA)).toEqual({
      authUserId: 'auth-3',
    });
  });

  it('deleteUser: 404 (ja removido) e aceito', async () => {
    const r = http([{ status: 404 }]);
    await expect(new SupabaseAuthGateway({ ...cfg, fetch: r.fetch }).deleteUser('auth-7')).resolves.toBeUndefined();
    expect(r.chamadas[0].url).toBe('https://projeto-sintetico.test/auth/v1/admin/users/auth-7');
    expect(r.chamadas[0].init.method).toBe('DELETE');
  });
});
