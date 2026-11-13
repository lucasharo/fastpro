// H-046 (Issue 59) | Teste estatico da migracao de planos e precos (120-DESENHO-H046 §2 a §6; T-01, T-04, T-05, T-09 a T-11, T-16).
// Sem banco e sem rede: le o SQL e o rollback. A prova no Postgres fica em plan-pricing.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261113190000_billing_create_plan_pricing.sql';
const DOWN = '20261113190000_billing_create_plan_pricing.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// SQL sem linhas de comentario (o cabecalho cita regras, de proposito).
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const minusculo = lower(sql);
const corpoDaFuncao = (nome) => {
  const inicio = minusculo.indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  const fim = minusculo.indexOf('$$;', inicio);
  return minusculo.slice(inicio, fim);
};
const leitura = corpoDaFuncao('private.plan_price_at');
// Nomes de colunas de beneficio, limite, recurso ou promocao (T-04, T-05), em portugues e ingles.
const TERMOS_PROIBIDOS = /benef|limit|feature|recurso|quota|cota|promo|discount|desconto|coupon|cupom|launch|lancamento/;

describe('T-01 e T-02 modelo e centavos no SQL', () => {
  it('plan tem quatro pares fixos (code, months) e unicidade nos dois campos', () => {
    expect(minusculo).toContain(
      "check ((code, months) in (('mensal', 1), ('trimestral', 3), ('semestral', 6), ('anual', 12)))",
    );
    expect(minusculo).toContain('code text not null unique');
    expect(minusculo).toContain('months integer not null unique');
  });

  it('precos sao inteiros positivos em BRL e a vigencia e semiaberta', () => {
    expect(minusculo).toContain('amount_cents integer not null check (amount_cents > 0)');
    expect(minusculo).toContain("currency text not null default 'brl' check (currency = 'brl')");
    expect(minusculo).toContain('tstzrange(valid_from, valid_to, \'[)\') with &&');
    expect(minusculo).toContain('plan_id extensions.gist_uuid_ops with =');
  });
});

describe('T-04 e T-05 sem beneficio, limite nem promocao', () => {
  it('nenhuma coluna, tabela ou funcao da migracao tem termo de beneficio, limite ou promocao', () => {
    expect(minusculo).not.toMatch(TERMOS_PROIBIDOS);
  });
});

describe('T-09 leitura estavel, relogio injetado, sem default em p_at', () => {
  it('funcao stable com p_at sem default, filtro opcional e sem relogio do banco', () => {
    expect(leitura).not.toBe('');
    expect(minusculo).toContain('p_at timestamptz, p_plan_code text default null');
    expect(minusculo).toContain('returns table (plan_code text, months integer, plan_price_id uuid, amount_cents integer, currency text)');
    expect(leitura).toContain('language sql stable security definer');
    expect(leitura).not.toMatch(/now\(\)|clock_timestamp|current_timestamp/);
    expect(leitura).not.toMatch(/\bp_at\s+timestamptz\s+default/);
  });

  it('fronteira [valid_from, valid_to) na leitura', () => {
    expect(leitura).toContain('pp.valid_from <= p_at');
    expect(leitura).toContain('p_at < pp.valid_to');
  });
});

describe('T-10 carga de referencia idempotente', () => {
  it('a carga e o ultimo bloco, com on conflict e not exists', () => {
    const inicio = minusculo.indexOf('insert into billing.plan (code, months)');
    expect(inicio).toBeGreaterThan(0);
    const carga = minusculo.slice(inicio);
    expect(carga).toContain('on conflict (code) do nothing');
    expect(carga).toContain('where not exists (select 1 from billing.plan_price x where x.plan_id = p.id)');
    expect(carga).toContain("(values ('mensal', 2990), ('trimestral', 8070), ('semestral', 14940), ('anual', 23880))");
    expect(carga).toContain("timestamptz '2026-01-01 00:00:00+00'");
  });
});

describe('T-11 RLS forcada e privilegios no SQL', () => {
  it('RLS habilitada e forcada nas duas tabelas, sem politica', () => {
    for (const t of ['billing.plan', 'billing.plan_price']) {
      expect(sql).toContain(`alter table ${t} enable row level security;`);
      expect(sql).toContain(`alter table ${t} force row level security;`);
    }
    expect(minusculo).not.toContain('create policy');
  });

  it('leitura so para app_system; funcao para app_api e app_system', () => {
    expect(sql).toContain('grant select on billing.plan, billing.plan_price to app_system;');
    expect(sql).toContain(
      'grant execute on function private.plan_price_at(timestamptz, text) to app_api, app_system;',
    );
    expect(minusculo).not.toMatch(/grant (insert|update|delete|truncate)/);
  });
});

describe('T-16 migracao sem rede, job ou relogio do banco', () => {
  it('sem http, pg_net, cron, schedule, tick nem now()', () => {
    expect(minusculo).not.toMatch(/http|pg_net|cron|schedule|tick|now\(\)/);
  });
});

describe('imutabilidade e rollback', () => {
  it('gatilhos de plano e de preco existem para update, delete e truncate', () => {
    for (const nome of ['plan_guard_bu', 'plan_guard_bd', 'plan_guard_bt', 'plan_price_guard_bu', 'plan_price_sem_delete_bd', 'plan_price_sem_truncate_bt']) {
      expect(minusculo).toContain(`create trigger ${nome}`);
    }
    expect(sql).toContain("raise exception 'plan_imutavel'");
    expect(sql).toContain("raise exception 'plan_price_imutavel'");
    expect(sql).toContain("raise exception 'plan_price_fechamento_invalido'");
  });

  it('rollback desfaz funcao, gatilhos e tabelas sem cascade (preco antes do plano)', () => {
    const lowerDown = lower(down);
    expect(lowerDown).toContain('drop function if exists private.plan_price_at');
    expect(lowerDown.indexOf('drop table if exists billing.plan_price')).toBeLessThan(
      lowerDown.indexOf('drop table if exists billing.plan;'),
    );
    const downSemComentario = lowerDown
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(downSemComentario).not.toMatch(/cascade/);
  });
});
