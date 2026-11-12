// H-120 (Issue 129) | Testes sem banco do script de carga e remocao (85-DESENHO-H120 §1, §3, §5).
// Cliente falso registra o SQL; nenhuma conexao e aberta. Executar: pnpm test (vitest).
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { carregarCamada1, removerDemo, runCamada2, REMOCAO, SQL, CAMADA2_BLOCOS } from '../scripts/demo-load.mjs';
import { loadDemoKeys } from '../scripts/lib/demo-guard.mjs';
import { DEMO_ID_LIKE, isDemoId } from '../scripts/lib/demo-ids.mjs';

function fakeClient({ presente = false, servico = true, conflito = [] } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      log.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ presente }], rowCount: 1 };
      if (sql.includes('from app.service where active order by')) {
        return servico ? { rows: [{ id: 'svc-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('select id::text as id from app.app_user')) {
        return { rows: conflito, rowCount: conflito.length };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const NOMES_CHAVES = ['DOCUMENT_HMAC_KEY', 'DATA_ENC_KEY_V1', 'ADDRESS_HASH_KEY'];
function gerarValor(nome) {
  return nome === 'ADDRESS_HASH_KEY' ? randomBytes(24).toString('hex') : randomBytes(32).toString('base64');
}
function envChaves() {
  const env = Object.fromEntries(NOMES_CHAVES.map((n) => [n, gerarValor(n)]));
  env.DATA_ENC_KEY_ACTIVE_VERSION = '1';
  return env;
}

function chaves() {
  const r = loadDemoKeys(envChaves());
  if (!r.ok) throw new Error('chaves de teste invalidas no proprio teste');
  return r.keys;
}

const ESCRITA = /^\s*(insert|update|delete)\b/i;

describe('T-H120-06 carga da camada 1 (CA-H120-04, CA-H120-09)', () => {
  it('conta as quantidades do refino com cliente que aceita tudo', async () => {
    const c = fakeClient();
    const r = await carregarCamada1(c, chaves());
    expect(r.falha).toBeUndefined();
    expect(r.contagens).toEqual({ clientes: 2, profissionais: 13, profissionaisAprovados: 8, rascunhos: 2, coordenadas: 1 });
  });

  it('nao toca audit, nem a fila de e-mail, nem o provedor', async () => {
    const c = fakeClient();
    await carregarCamada1(c, chaves());
    await runCamada2(c);
    expect(c.log.length).toBeGreaterThan(0);
    for (const { sql } of c.log) {
      expect(sql.toLowerCase()).not.toContain('audit');
      expect(sql.toLowerCase()).not.toContain('email_outbox');
      expect(sql.toLowerCase()).not.toContain('ops.');
    }
  });

  it('toda chave primaria gravada pela carga tem o prefixo reservado', async () => {
    const c = fakeClient();
    await carregarCamada1(c, chaves());
    const inserts = c.log.filter(({ sql }) => ESCRITA.test(sql));
    expect(inserts.length).toBeGreaterThan(0);
    for (const { params } of inserts) {
      const primeiro = params[0];
      const ehDemo = isDemoId(primeiro) || primeiro === 'svc-1';
      expect(ehDemo).toBe(true);
    }
  });

  it('servico vazio recusa a carga antes de qualquer escrita', async () => {
    const c = fakeClient({ servico: false });
    const r = await carregarCamada1(c, chaves());
    expect(r.falha).toContain('db:seed:catalog');
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
  });

  it('cada insert usa on conflict (id) do nothing, nunca um conflito generico', async () => {
    const c = fakeClient();
    await carregarCamada1(c, chaves());
    for (const { sql } of c.log.filter(({ sql }) => /^\s*insert/i.test(sql))) {
      expect(sql).toMatch(/on conflict \((id|user_id)\) do nothing/);
    }
  });
});

describe('T-H120-07 camada 2 nao executa sem a tabela ou sem Storage (CA-H120-04, cliente falso)', () => {
  it('sem tabela: consulta as tabelas de cada bloco e nao escreve nada', async () => {
    const c = fakeClient({ presente: false });
    const blocos = await runCamada2(c, { keys: chaves(), storage: null });
    const tabelas = CAMADA2_BLOCOS.flatMap((b) => b.tabelas);
    expect(blocos).toHaveLength(CAMADA2_BLOCOS.length);
    expect(c.log.filter(({ sql }) => sql === SQL.camada2Existe)).toHaveLength(tabelas.length);
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
    expect(blocos.every((b) => b.status.includes('tabela ausente'))).toBe(true);
  });

  it('sem chaves nem Storage, com tabelas presentes: nenhum bloco escreve', async () => {
    const c = fakeClient({ presente: true });
    const blocos = await runCamada2(c);
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
    expect(blocos.every((b) => b.status.startsWith('nao executado'))).toBe(true);
  });
});

describe('T-H120-08 remocao seletiva (CA-H120-06, CA-H120-07)', () => {
  it('recusa estado misto e nao apaga nada', async () => {
    const c = fakeClient({ conflito: [{ id: '11111111-2222-4333-8444-555555555555' }] });
    const r = await removerDemo(c);
    expect(r.falha).toContain('nada foi apagado');
    expect(c.log.some(({ sql }) => ESCRITA.test(sql))).toBe(false);
  });

  it('apaga de baixo para cima: usuarios por ultimo, cada comando filtrado pelo prefixo', async () => {
    const c = fakeClient();
    const r = await removerDemo(c);
    expect(r.falha).toBeUndefined();
    expect(REMOCAO[REMOCAO.length - 1][0]).toBe('usuarios');
    expect(REMOCAO[0][0]).toBe('sessoes');
    const apagues = c.log.filter(({ sql }) => ESCRITA.test(sql));
    expect(apagues.map(({ sql }) => sql)).toEqual(REMOCAO.map(([, sql]) => sql));
    for (const { sql, params } of apagues) {
      expect(sql).toMatch(/where/i);
      expect(params).toEqual([DEMO_ID_LIKE]);
    }
  });

  it('a consulta de inconsistencia usa marcador de e-mail e de id, nunca so o e-mail', () => {
    expect(SQL.inconsistencia).toContain('id::text not like $2');
    expect(SQL.inconsistencia).toContain('id::text like $2');
    expect(REMOCAO.every(([, sql]) => !/where\s+email\b/i.test(sql))).toBe(true);
  });
});
