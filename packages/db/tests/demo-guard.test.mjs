// H-120 (Issue 129) | Testes sem banco da trava, dos identificadores e das chaves da carga de demonstracao.
// 85-DESENHO-H120 §1, §2 e §5 (CA-03) e decisao 58 (banco de desenvolvimento do projeto).
// Executar: pnpm test (vitest). Nenhuma conexao e aberta. Refs e senhas sao ficticios.
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { randomBytes, createDecipheriv } from 'node:crypto';
import {
  demoGuardRefusal,
  loadDemoKeys,
  documentHmac,
  sealDocument,
  normalizeAddress,
  hostOfDbUrl,
  projectRefOf,
} from '../scripts/lib/demo-guard.mjs';
import {
  DEMO_ID_RE,
  DEMO_ID_PREFIX,
  CLIENTES,
  PROFISSIONAIS,
  RASCUNHOS,
  COORDENADA,
  CONTAGENS_CAMADA1,
  demoId,
  demoCpfDigits,
  isDemoEmail,
  isDemoId,
} from '../scripts/lib/demo-ids.mjs';

const SENHA_TESTE = 'segredo-de-teste';
const LOCAL_URL = 'postgresql://postgres:' + SENHA_TESTE + '@127.0.0.1:54322/postgres';
const ALLOW = { FASTPRO_DEMO_ALLOW: 'local' };
const NOMES_CHAVES = ['DOCUMENT_HMAC_KEY', 'DATA_ENC_KEY_V1', 'ADDRESS_HASH_KEY'];
const gerarChave = () => randomBytes(32);
const gerarCurta = () => randomBytes(16).toString('base64');
function gerarValor(nome) {
  return nome === 'ADDRESS_HASH_KEY' ? randomBytes(24).toString('hex') : randomBytes(32).toString('base64');
}
function envChaves() {
  const env = Object.fromEntries(NOMES_CHAVES.map((n) => [n, gerarValor(n)]));
  env.DATA_ENC_KEY_ACTIVE_VERSION = '1';
  return env;
}

describe('T-H120-01 trava de ambiente (CA-03)', () => {
  it('recusa sem FASTPRO_DEMO_ALLOW, com valor errado ou vazio, mesmo com host local', () => {
    for (const env of [{}, { FASTPRO_DEMO_ALLOW: '' }, { FASTPRO_DEMO_ALLOW: 'Local' }, { FASTPRO_DEMO_ALLOW: '1' }, { FASTPRO_DEMO_ALLOW: 'true' }]) {
      expect(demoGuardRefusal(env, LOCAL_URL)?.codigo).toBe('ambiente_nao_permitido');
    }
  });

  it('recusa host remoto que nao e o banco de desenvolvimento, mesmo com FASTPRO_DEMO_ALLOW=local (decisao 58)', () => {
    const remotos = [
      'postgresql://postgres:<senha>@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://postgres.abc:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:<senha>@10.0.0.5:5432/postgres',
      'postgresql://postgres:<senha>@meu-servidor.example:5432/postgres',
    ];
    for (const url of remotos) {
      expect(demoGuardRefusal(ALLOW, url)?.codigo).toBe('host_nao_local');
    }
  });

  it('recusa parametro host ou hostaddr na URL, mesmo com host local', () => {
    expect(demoGuardRefusal(ALLOW, `${LOCAL_URL}?host=db.abc.supabase.co`)?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(ALLOW, `${LOCAL_URL}?hostaddr=10.0.0.1`)?.codigo).toBe('host_nao_local');
  });

  it('recusa variavel de conexao ausente ou invalida, sem a conexao no texto', () => {
    expect(demoGuardRefusal(ALLOW, undefined)?.codigo).toBe('banco_nao_configurado');
    expect(demoGuardRefusal(ALLOW, '')?.codigo).toBe('banco_nao_configurado');
    const invalida = demoGuardRefusal(ALLOW, 'nao e uma url segredo-de-teste');
    expect(invalida?.codigo).toBe('banco_invalido');
    expect(JSON.stringify(invalida)).not.toContain('segredo-de-teste');
  });

  it('aceita localhost, 127.0.0.1 e ::1 com FASTPRO_DEMO_ALLOW=local', () => {
    expect(demoGuardRefusal(ALLOW, LOCAL_URL)).toBeNull();
    expect(demoGuardRefusal(ALLOW, 'postgresql://postgres:<senha>@localhost:54322/postgres')).toBeNull();
    expect(demoGuardRefusal(ALLOW, 'postgresql://postgres:<senha>@[::1]:54322/postgres')).toBeNull();
  });

  it('nenhuma recusa expoe a senha da conexao', () => {
    const casos = [
      demoGuardRefusal({}, LOCAL_URL),
      demoGuardRefusal(ALLOW, 'postgresql://postgres:' + SENHA_TESTE + '@10.0.0.5:5432/postgres'),
    ];
    for (const r of casos) expect(JSON.stringify(r)).not.toContain('segredo-de-teste');
  });

  it('extrai o host sem colchetes', () => {
    expect(hostOfDbUrl('postgresql://u:<senha>@[::1]:5432/db')).toBe('::1');
    expect(hostOfDbUrl('postgresql://u:<senha>@127.0.0.1:5432/db')).toBe('127.0.0.1');
  });
});

describe('T-H120-01b banco de desenvolvimento do projeto (decisao 58)', () => {
  // Refs ficticios de 20 caracteres minusculos. Nenhum e chave ou projeto real.
  const DEV_REF = 'abcdefghijklmnopqrst';
  const OUTRO_REF = 'zyxwvutsrqponmlkjihg';
  const DEV_URL = `https://${DEV_REF}.supabase.co`;
  const DEV_ENV = { APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: DEV_URL };
  const DIRETO = (ref) => `postgresql://postgres:<senha>@db.${ref}.supabase.co:5432/postgres`;
  const POOLER = (ref) => `postgresql://postgres.${ref}:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

  it('aceita APP_ENV=development com ref igual: host direto e pooler, com e sem FASTPRO_DEMO_ALLOW', () => {
    expect(demoGuardRefusal(DEV_ENV, DIRETO(DEV_REF))).toBeNull();
    expect(demoGuardRefusal(DEV_ENV, POOLER(DEV_REF))).toBeNull();
    expect(demoGuardRefusal({ ...DEV_ENV, FASTPRO_DEMO_ALLOW: 'local' }, POOLER(DEV_REF))).toBeNull();
  });

  it('aceita sslmode como unico parametro de URL', () => {
    expect(demoGuardRefusal(DEV_ENV, `${DIRETO(DEV_REF)}?sslmode=require`)).toBeNull();
    expect(demoGuardRefusal(DEV_ENV, `${POOLER(DEV_REF)}?sslmode=require`)).toBeNull();
  });

  it('recusa APP_ENV diferente de development: production, staging, Development, vazio e ausente', () => {
    for (const extra of [{ APP_ENV: 'production' }, { APP_ENV: 'staging' }, { APP_ENV: 'Development' }, { APP_ENV: '' }, {}]) {
      const env = { NEXT_PUBLIC_SUPABASE_URL: DEV_URL, ...extra };
      expect(demoGuardRefusal(env, DIRETO(DEV_REF))?.codigo).toBe('ambiente_nao_permitido');
      expect(demoGuardRefusal(env, POOLER(DEV_REF))?.codigo).toBe('ambiente_nao_permitido');
    }
  });

  it('recusa ref diferente do NEXT_PUBLIC_SUPABASE_URL, direto e pooler', () => {
    expect(demoGuardRefusal(DEV_ENV, DIRETO(OUTRO_REF))?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(DEV_ENV, POOLER(OUTRO_REF))?.codigo).toBe('host_nao_local');
  });

  it('recusa NEXT_PUBLIC_SUPABASE_URL ausente ou fora do formato https://<ref>.supabase.co', () => {
    expect(demoGuardRefusal({ APP_ENV: 'development' }, DIRETO(DEV_REF))?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal({ APP_ENV: 'development' }, POOLER(DEV_REF))?.codigo).toBe('host_nao_local');
    const sufixoEvil = { APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: `${DEV_URL}.evil.com` };
    expect(demoGuardRefusal(sufixoEvil, DIRETO(DEV_REF))?.codigo).toBe('host_nao_local');
    const http = { APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: `http://${DEV_REF}.supabase.co` };
    expect(demoGuardRefusal(http, POOLER(DEV_REF))?.codigo).toBe('host_nao_local');
  });

  it('recusa parametros fora de sslmode: options, host, hostaddr, service, dbname', () => {
    const extras = [
      `options=reference%3D${OUTRO_REF}`,
      `host=db.${OUTRO_REF}.supabase.co`,
      `hostaddr=10.0.0.1`,
      `service=outro`,
      `dbname=producao`,
    ];
    for (const p of extras) {
      expect(demoGuardRefusal(DEV_ENV, `${POOLER(DEV_REF)}?${p}`)).not.toBeNull();
      expect(demoGuardRefusal(DEV_ENV, `${DIRETO(DEV_REF)}?sslmode=require&${p}`)).not.toBeNull();
    }
    expect(demoGuardRefusal(DEV_ENV, `${POOLER(DEV_REF)}?options=reference%3D${OUTRO_REF}`)?.codigo).toBe('parametro_nao_permitido');
    expect(demoGuardRefusal(DEV_ENV, `${DIRETO(DEV_REF)}?dbname=producao`)?.codigo).toBe('parametro_nao_permitido');
  });

  it('recusa host db de outro projeto com usuario postgres.<dev> (ref no usuario nao basta)', () => {
    const url = `postgresql://postgres.${DEV_REF}:<senha>@db.${OUTRO_REF}.supabase.co:5432/postgres`;
    expect(demoGuardRefusal(DEV_ENV, url)?.codigo).toBe('host_nao_local');
  });

  it('recusa ref so na senha, pooler sem ref no usuario e ref so no host do pooler', () => {
    expect(demoGuardRefusal(DEV_ENV, `postgresql://postgres:<senha>@db.${OUTRO_REF}.supabase.co:5432/postgres`)?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(DEV_ENV, `postgresql://postgres:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`)?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(DEV_ENV, `postgresql://postgres:<senha>@db.${DEV_REF}.pooler.supabase.com:6543/postgres`)?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(DEV_ENV, `postgresql://postgres.${DEV_REF}x:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`)?.codigo).toBe('host_nao_local');
  });

  it('recusa host com sufixo de outro dominio (.evil.com), direto e pooler', () => {
    const direto = `postgresql://postgres:<senha>@db.${DEV_REF}.supabase.co.evil.com:5432/postgres`;
    const pooler = `postgresql://postgres.${DEV_REF}:<senha>@aws-0-sa-east-1.pooler.supabase.com.evil.com:6543/postgres`;
    expect(demoGuardRefusal(DEV_ENV, direto)?.codigo).toBe('host_nao_local');
    expect(demoGuardRefusal(DEV_ENV, pooler)?.codigo).toBe('host_nao_local');
  });

  it('nenhuma recusa deste bloco expoe a senha da conexao', () => {
    // Sentinela propria deste teste, montada por partes para nao existir como literal de URL no codigo.
    // O marcador <senha> das URLs acima e trocado por ela: a prova e que a recusa nao a ecoa.
    const SENTINELA = ['sentinela', 'nao', 'pode', 'vazar'].join('-');
    const comSentinela = (url) => url.replace('<senha>', SENTINELA);
    const urls = [
      comSentinela(DIRETO(DEV_REF)),
      comSentinela(`${POOLER(DEV_REF)}?options=x`),
      comSentinela(DIRETO(OUTRO_REF)),
    ];
    const casos = [
      demoGuardRefusal({ ...DEV_ENV, APP_ENV: 'production' }, urls[0]),
      demoGuardRefusal(DEV_ENV, urls[1]),
      demoGuardRefusal(DEV_ENV, urls[2]),
    ];
    for (const url of urls) expect(url).toContain(SENTINELA);
    for (const r of casos) {
      expect(r).not.toBeNull();
      expect(JSON.stringify(r)).not.toContain(SENTINELA);
    }
  });

  it('projectRefOf aceita so https://<ref de 20>.supabase.co, com barra final opcional', () => {
    expect(projectRefOf(DEV_URL)).toBe(DEV_REF);
    expect(projectRefOf(`${DEV_URL}/`)).toBe(DEV_REF);
    expect(projectRefOf(`${DEV_URL}.evil.com`)).toBeNull();
    expect(projectRefOf(`https://${DEV_REF.slice(1)}.supabase.co`)).toBeNull();
    expect(projectRefOf(undefined)).toBeNull();
  });
});

describe('T-H120-02 chaves de teste locais', () => {
  const env = envChaves;

  it('recusa com a lista dos nomes ausentes, sem valores', () => {
    const r = loadDemoKeys({});
    expect(r.ok).toBe(false);
    expect(r.refusal.codigo).toBe('configuracao_ausente');
    expect(r.refusal.mensagem).toContain('DOCUMENT_HMAC_KEY');
    expect(r.refusal.mensagem).toContain('ADDRESS_HASH_KEY');
  });

  it('aceita o conjunto completo e recusa chave de tamanho errado', () => {
    expect(loadDemoKeys(env()).ok).toBe(true);
    const ruim = env();
    ruim.DATA_ENC_KEY_V1 = gerarCurta();
    expect(loadDemoKeys(ruim).ok).toBe(false);
  });
});

describe('T-H120-03 identificadores e marcador (desenho §2)', () => {
  const todosIds = [
    ...CLIENTES.flatMap((c) => [c.id, c.authId]),
    ...PROFISSIONAIS.flatMap((p) => [p.id, p.authId]),
    ...RASCUNHOS.map((r) => r.id),
    COORDENADA.id,
  ];

  it('todo id de demo segue fa57d120-0000-4000-8000-<12 hex> e e unico', () => {
    for (const id of todosIds) {
      expect(id).toMatch(DEMO_ID_RE);
      expect(id.startsWith(DEMO_ID_PREFIX)).toBe(true);
      expect(isDemoId(id)).toBe(true);
    }
    expect(new Set(todosIds).size).toBe(todosIds.length);
  });

  it('ids de exemplo do desenho: cliente A e fixo e o numero entra no fim', () => {
    expect(demoId('a', 1)).toBe('fa57d120-0000-4000-8000-000000000a01');
    expect(() => demoId('A', 1)).toThrow();
    expect(() => demoId('a', 100)).toThrow();
  });

  it('todo e-mail de demo termina em @sintetico.test e nenhum outro e marcado', () => {
    for (const cl of CLIENTES) expect(isDemoEmail(cl.email)).toBe(true);
    for (const p of PROFISSIONAIS) expect(isDemoEmail(p.email)).toBe(true);
    expect(isDemoEmail('alguem@gmail.com')).toBe(false);
    expect(isDemoEmail('alguem@sintetico.test.com')).toBe(false);
  });

  it('nomes publicos trazem a marca Sintetico e ficam dentro de 2 a 80 caracteres', () => {
    for (const p of PROFISSIONAIS) {
      expect(p.publicName).toContain('Sintético');
      expect(p.publicName.length).toBeGreaterThanOrEqual(2);
      expect(p.publicName.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('T-H120-04 quantidades, estados e endereco (refino §3, CA-H120-04)', () => {
  it('2 clientes, 13 perfis (8 aprovados e um por estado), 2 rascunhos e 1 coordenada', () => {
    expect(CONTAGENS_CAMADA1).toEqual({ clientes: 2, profissionais: 13, profissionaisAprovados: 8, rascunhos: 2, coordenadas: 1 });
    const estados = PROFISSIONAIS.map((p) => p.status);
    expect(estados.filter((s) => s === 'aprovada')).toHaveLength(8);
    for (const s of ['pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'suspensa']) {
      expect(estados.filter((x) => x === s)).toHaveLength(1);
    }
  });

  it('coordenada fica dentro da caixa do Brasil do CHECK e o endereco normaliza como a chave', () => {
    expect(COORDENADA.lng).toBeGreaterThanOrEqual(-74.0);
    expect(COORDENADA.lng).toBeLessThanOrEqual(-34.0);
    expect(COORDENADA.lat).toBeGreaterThanOrEqual(-34.0);
    expect(COORDENADA.lat).toBeLessThanOrEqual(6.0);
    expect(normalizeAddress(COORDENADA.endereco)).toBe(COORDENADA.enderecoNormalizado);
    expect(COORDENADA.endereco).toBe('Rua Sintética 000');
  });

  it('CPF sintetico tem digitos verificadores validos (calculo independente) e nao e sequencia repetida', () => {
    const valido = (cpf) => {
      const d = cpf.split('').map(Number);
      const dv = (len) => {
        const soma = d.slice(0, len).reduce((acc, x, i) => acc + x * (len + 1 - i), 0);
        const r = (soma * 10) % 11;
        return r === 10 ? 0 : r;
      };
      return dv(9) === d[9] && dv(10) === d[10] && new Set(d).size > 1;
    };
    for (const p of PROFISSIONAIS) {
      const cpf = demoCpfDigits(p.n);
      expect(cpf).toHaveLength(11);
      expect(valido(cpf)).toBe(true);
    }
  });
});

describe('T-H120-05 hash do documento e cifra (mesma forma da API)', () => {
  it('HMAC e deterministico e muda com o tipo; cifra abre com a mesma AAD do usuario', () => {
    const hmacKey = gerarChave();
    const encKey = gerarChave();
    const digits = demoCpfDigits(1);
    expect(documentHmac(hmacKey, 'CPF', digits)).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHmac(hmacKey, 'CPF', digits)).toBe(documentHmac(hmacKey, 'CPF', digits));
    expect(documentHmac(hmacKey, 'CPF', digits)).not.toBe(documentHmac(hmacKey, 'CNPJ', digits));

    const userId = demoId('b', 1);
    const blob = sealDocument(encKey, 1, userId, digits);
    expect(blob[0]).toBe(1);
    const decipher = createDecipheriv('aes-256-gcm', encKey, blob.subarray(1, 13));
    decipher.setAAD(Buffer.from(`doc1|${userId}|document_enc`, 'utf8'));
    decipher.setAuthTag(blob.subarray(13, 29));
    const aberto = Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
    expect(aberto).toBe(digits);
  });
});
