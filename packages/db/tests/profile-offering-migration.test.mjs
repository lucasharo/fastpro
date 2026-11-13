// H-036 | Testes estaticos da migracao 20261112160000 (docs/factory/99-DESENHO-H036.md, §3, §4.6, §7; T-P12 e T-P21).
// Sem banco e sem rede: le o arquivo SQL e o rollback. O comportamento real (CA-09 em execucao, grants reais) fica
// nos testes de banco (profile-offering.dbtest.mjs). Molde: geo-geocode-point-migration.test.mjs.
// Executar: pnpm test (vitest) dentro de packages/db.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261112160000_profile_expand_services_area.sql';
const DOWN = '20261112160000_profile_expand_services_area.down.sql';
const ANTERIOR = '20261112150000';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// SQL sem linhas de comentario (o cabecalho cita o que nao existe, de proposito).
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

/** Cada `create or replace function` com cabecalho (ate `as $$`) e corpo (entre os `$$`). */
function funcoes() {
  return sql
    .split(/create or replace function /i)
    .slice(1)
    .map((bloco) => {
      const nome = /^(private\.[a-z_]+)/.exec(bloco)?.[1] ?? '';
      const ini = bloco.search(/\bas\s+\$\$/i);
      const cabecalho = ini < 0 ? bloco : bloco.slice(0, ini);
      const corpo = ini < 0 ? '' : bloco.slice(bloco.indexOf('$$', ini) + 2, bloco.indexOf('$$', bloco.indexOf('$$', ini) + 2));
      return { nome, cabecalho, corpo };
    });
}

const FUNCOES_ESCRITA = [
  'private.professional_area_precheck',
  'private.professional_area_save',
  'private.professional_services_save',
  'private.professional_offering_purge',
];

// Tabelas e funcoes que as funcoes de escrita podem tocar (desenho §4.6, T-P12). Qualquer outra referencia falha.
const PERMITIDAS = new Set([
  'app.professional_service',
  'app.professional_area',
  'app.professional_area_history',
  'app.professional_profile', // so com for update (verificado abaixo)
  'app.service', // catalogo, leitura
  'app.geocode_point', // leitura (e purge do assunto professional_base)
  'app.geocode_budget', // purge
  'app.offering_purge', // configuracao de sessao do purge, nao e tabela
  'ops.app_config',
  'private.professional_offering_limits',
  'private.offering_cfg_int',
  'private.rl_check',
  'private.rl_hit',
  'private.audit_append',
  'private.professional_offering_purge',
  'private.professional_area_history_guard',
]);

describe('T-P12 CA-09 estatico: funcoes de escrita nao tocam pedido nem participacao', () => {
  const porNome = Object.fromEntries(funcoes().map((f) => [f.nome, f]));

  it('as quatro funcoes de escrita existem no arquivo', () => {
    for (const nome of FUNCOES_ESCRITA) expect(porNome[nome], nome).toBeDefined();
  });

  it('cada corpo de escrita referencia so tabelas permitidas pelo desenho', () => {
    for (const nome of FUNCOES_ESCRITA) {
      const refs = new Set([...porNome[nome].corpo.matchAll(/\b(app|private|ops)\.[a-z_]+/g)].map((m) => m[0]));
      const fora = [...refs].filter((r) => !PERMITIDAS.has(r));
      expect(fora, `${nome} referencia fora da lista`).toEqual([]);
    }
  });

  it('nenhum corpo de escrita menciona pedido, publicacao ou participacao', () => {
    for (const nome of FUNCOES_ESCRITA) {
      expect(porNome[nome].corpo, nome).not.toMatch(/service_request|participa|publica|pedido/i);
    }
  });

  it('professional_profile aparece so com for update (nenhuma gravacao no perfil)', () => {
    for (const nome of FUNCOES_ESCRITA) {
      const linhas = porNome[nome].corpo.split(/\r?\n/).filter((l) => /app\.professional_profile/.test(l));
      for (const linha of linhas) expect(linha, nome).toMatch(/for update/i);
      expect(porNome[nome].corpo, nome).not.toMatch(/(update|insert into|delete from)\s+app\.professional_profile/i);
    }
  });

  it('o arquivo inteiro nao cita tabela de pedido nem de participacao', () => {
    expect(sql).not.toMatch(/service_request|participacao|participation/i);
  });
});

describe('T-P21 padrao do repo estatico: search_path, grants, rollback e numero', () => {
  it('toda funcao tem search_path vazio no cabecalho', () => {
    const todas = funcoes();
    expect(todas.length).toBeGreaterThan(10);
    for (const f of todas) expect(f.cabecalho, f.nome).toMatch(/set search_path = ''/);
  });

  it('grant execute so para app_system, em todas as ocorrencias', () => {
    const grants = [...sql.matchAll(/grant\s+execute\s+on\s+function[\s\S]*?\sto\s+([a-z_, ]+);/gi)];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g[1].trim()).toBe('app_system');
  });

  it('funcao de servico nao recebe execute para papel de API, anonimo ou servico', () => {
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*?\sto\s+[^;]*(public|anon|authenticated|service_role|app_api)/i);
  });

  it('as tres tabelas tem RLS habilitada e forcada e revogacao total para todos os papeis', () => {
    for (const tabela of ['professional_service', 'professional_area', 'professional_area_history']) {
      expect(sql).toMatch(new RegExp(`alter table app\\.${tabela}\\s+enable row level security;`));
      expect(sql).toMatch(new RegExp(`alter table app\\.${tabela}\\s+force row level security;`));
    }
    const revoke = /revoke all on app\.professional_service, app\.professional_area, app\.professional_area_history\s+from ([^;]+);/i.exec(sql);
    expect(revoke).not.toBeNull();
    for (const papel of ['public', 'anon', 'authenticated', 'service_role', 'app_api', 'app_system', 'app_backup_reader']) {
      expect(revoke[1]).toContain(papel);
    }
  });

  it('nenhum grant de DML ou SELECT nas tabelas novas', () => {
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)[^;]*on\s+app\.professional_(service|area|area_history)/i);
  });

  it('o rollback existe e e idempotente (drop ... if exists)', () => {
    expect(down.length).toBeGreaterThan(0);
    expect(down).toMatch(/drop function if exists/i);
    expect(down).toMatch(/drop table if exists app\.professional_area_history/i);
    expect(down).toMatch(/app\.rollback_force/);
  });

  it('o numero e unico no diretorio e vem depois da migracao anterior da fila', () => {
    const prefixos = readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith('.sql'))
      .map((n) => n.slice(0, 14));
    expect(prefixos.filter((p) => p === FILE.slice(0, 14))).toHaveLength(1);
    expect(FILE.slice(0, 14) > ANTERIOR).toBe(true);
    const ordenados = [...prefixos].sort();
    expect(ordenados.indexOf(FILE.slice(0, 14))).toBeGreaterThan(ordenados.indexOf(ANTERIOR));
  });
});
