// H-045 (Issue 58) | Teste estatico da migracao do acesso comercial (114-DESENHO-H045 §3, §4, §7, T-05, T-06, T-14, T-15).
// Sem banco e sem rede: le o arquivo SQL e o rollback. A prova no Postgres fica em commercial-access.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261113170000_billing_create_access_grant.sql';
const DOWN = '20261113170000_billing_create_access_grant.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// SQL sem linhas de comentario (o cabecalho cita regras, de proposito).
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const corpoDaFuncao = (nome) => {
  const inicio = lower(sql).indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  const fim = lower(sql).indexOf('$$;', inicio);
  return lower(sql).slice(inicio, fim);
};
const leitura = corpoDaFuncao('private.commercial_access');
const revogacao = corpoDaFuncao('private.access_grant_revoke');

describe('T-05 relogio injetado e T-06 sem job', () => {
  it('a leitura nao chama relogio do banco nem tem default em p_at', () => {
    expect(leitura).not.toBe('');
    expect(leitura).not.toMatch(/now\(\)|clock_timestamp|current_timestamp/);
    expect(leitura).toContain('p_at timestamptz)');
    expect(leitura).not.toContain('default');
  });

  it('a migracao nao cria cron, job, tick nem gatilho de tempo', () => {
    expect(lower(sql)).not.toMatch(/cron\.|cron_schedule|ops\.job|pg_cron|schedule|tick/);
  });
});

describe('T-14 privilegios no SQL', () => {
  it('RLS habilitada e forcada nas duas tabelas, sem politica', () => {
    for (const t of ['billing.access_grant', 'billing.subscription']) {
      expect(sql).toContain(`alter table ${t} enable row level security;`);
      expect(sql).toContain(`alter table ${t} force row level security;`);
    }
    expect(lower(sql)).not.toContain('create policy');
  });

  it('leitura so para app_system; funcao de leitura para app_api e app_system; revogacao so app_system', () => {
    expect(sql).toContain('grant select on billing.access_grant, billing.subscription to app_system;');
    expect(sql).toContain(
      'grant execute on function private.commercial_access(uuid, timestamptz) to app_api, app_system;',
    );
    expect(sql).toContain(
      'grant execute on function private.access_grant_revoke(uuid, text, text, text, uuid) to app_system;',
    );
  });
});

describe('T-18 revogacao auditada na mesma transacao', () => {
  it('a revogacao grava auditoria, trava a linha e nao aceita a volta de revogada', () => {
    expect(revogacao).not.toBe('');
    expect(revogacao).toContain('for update');
    expect(revogacao).toContain("private.audit_append(");
    expect(revogacao).toContain("'billing.access_grant.revoke'");
    expect(revogacao).not.toMatch(/\bdelete\b/);
  });
});

describe('T-15 saida minima e estados', () => {
  it('a funcao devolve so estado e access_until', () => {
    expect(sql).toContain('returns table (estado text, access_until timestamptz)');
    expect(leitura).toContain('language sql');
    expect(leitura).toContain('stable');
    expect(leitura).toContain("set search_path = ''");
  });
});

describe('T-01 e T-09 restricoes do livro', () => {
  it('trial de 14 dias, pago com pagamento e nao sobreposicao com gist', () => {
    expect(sql).toContain("ends_at - starts_at = interval '14 days'");
    expect(sql).toContain('check (type <> \'paid\' or source_payment_id is not null)');
    expect(sql).toContain('exclude using gist');
    expect(sql).toContain('extensions.gist_uuid_ops with =');
    expect(sql).toContain("where (type = 'paid' and status = 'ativa')");
  });

  it('acao de auditoria cadastrada (audit_event_action_fk)', () => {
    expect(sql).toContain("('billing.access_grant.revoke', 'access_grant', true,");
  });
});

describe('rollback', () => {
  it('guarda contra perda de dados e remove o que a migracao criou', () => {
    expect(down).toContain('rollback_recusado_com_dados');
    expect(down).toContain('drop table if exists billing.access_grant;');
    expect(down).toContain('drop table if exists billing.subscription;');
    expect(down).toContain('drop function if exists private.commercial_access(uuid, timestamptz);');
    expect(down).not.toContain('drop extension');
  });
});
