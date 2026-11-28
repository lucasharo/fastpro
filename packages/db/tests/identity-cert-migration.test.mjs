// H-038 (Issue 51) | Teste estatico da migracao das certificacoes (docs/factory/148-DESENHO-H038.md, secoes 2, 3, 7).
// Sem banco e sem rede: le o SQL da migracao 20261113440000 e o seu desfazimento. As mesmas regras de dados
// sao verificadas no banco em identity-cert-h038.dbtest.mjs (rodam com db:test).
// Executar: vitest (pnpm test) em packages/db.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261113440000_identity_expand_certifications.sql';
const DOWN = '20261113440000_identity_expand_certifications.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const bruto = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const sql = semComentario(bruto).toLowerCase().replace(/\s+/g, ' ');
const rbBruto = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
const rb = semComentario(rbBruto).toLowerCase().replace(/\s+/g, ' ');

// Trecho de uma funcao: do seu cabecalho ate o proximo cabecalho de funcao ou de bloco.
const trecho = (texto, inicio) => {
  const i = texto.indexOf(inicio);
  const j = texto.indexOf('create or replace function', i + inicio.length);
  return texto.slice(i, j === -1 ? undefined : j);
};

describe('T-H038-MIG esquema aditivo (148 §2, CA-H038-01)', () => {
  it('kind passa a aceitar identidade e certificacao, com constraint de nome proprio', () => {
    expect(sql).toContain("check (kind in ('identidade', 'certificacao'))");
    expect(sql).toContain('identity_document_kind_ck');
    expect(sql).toContain('drop constraint if exists identity_document_kind_check');
  });

  it('service_id e FK para app.service com on delete restrict, nula para identidade', () => {
    expect(sql).toContain(
      'add column if not exists service_id uuid references app.service (id) on delete restrict',
    );
  });

  it('coerencia tipo x servico, criada sem validar e validada depois', () => {
    expect(sql).toContain(
      "check ((kind = 'identidade' and service_id is null) or (kind = 'certificacao' and service_id is not null)) not valid",
    );
    expect(sql).toContain('validate constraint identity_document_service_kind_ck');
  });

  it('indice unico parcial de uma certificacao viva por (profissional, servico)', () => {
    expect(sql).toContain('create unique index if not exists identity_document_cert_viva_key');
    expect(sql).toContain(
      "on app.identity_document (professional_id, service_id) where kind = 'certificacao' and status = 'recebido' and purge_requested_at is null",
    );
  });

  it('migracao e aditiva: nao remove tabela, coluna existente, nem bucket', () => {
    expect(sql).not.toMatch(/drop table/);
    expect(sql).not.toMatch(/alter column/);
    expect(sql).not.toMatch(/drop column(?! if exists service_id)/);
    expect(sql).not.toMatch(/storage\.buckets/);
    expect(sql).not.toMatch(/create table/);
  });

  it('nao usa media_asset (RN-H038-04)', () => {
    expect(sql).not.toContain('media_asset');
  });
});

describe('T-H038-MIG limite e cotas (CA-H038-06)', () => {
  it('idoc_limite ignora certificacao e conta apenas identidade', () => {
    const f = trecho(sql, 'create or replace function private.idoc_limite()');
    expect(f).toContain("if new.kind <> 'identidade' then");
    expect(f).toContain("and d.kind = 'identidade'");
  });

  it('idoc_issue conta apenas identidade no limite de 5', () => {
    const f = trecho(sql, 'create or replace function private.idoc_issue(');
    expect(f).toContain("and d.kind = 'identidade'");
    expect(f).toContain('if v_vivas >= 5 then');
  });

  it('teto global de bytes continua somando todas as linhas (sem filtro de kind)', () => {
    const f = trecho(sql, 'create or replace function private.idoc_issue_cert(');
    expect(f).toContain("pg_advisory_xact_lock(hashtext('identity_docs_teto_global'))");
    expect(f).toContain("if v_total + 2097152 > p_global_bytes_cap then");
  });
});

describe('T-H038-MIG emissao de certificacao (148 §3.2, D-H038-A1)', () => {
  it('idoc_issue_cert existe com a assinatura do desenho e valida o servico', () => {
    expect(sql).toContain(
      'create or replace function private.idoc_issue_cert( p_user uuid, p_client_upload_id uuid, p_service_id uuid, p_type text, p_bytes integer, p_now timestamptz, p_global_bytes_cap bigint)',
    );
    expect(sql).toContain('if not found or not v_regulado then');
    expect(sql).toContain("out_code := 'service_denied';");
    expect(sql).toContain("'certificacao', p_service_id, p_type, p_bytes, 'pendente_envio'");
  });

  it('estados aceitos incluem aprovada (decisao 305) e recusam so suspensa', () => {
    expect(sql).toContain(
      "if v_estado not in ('pendente', 'em_revisao', 'retida_duplicidade', 'recusada', 'aprovada') then",
    );
  });

  it('cota propria de uma reserva pendente viva por servico', () => {
    expect(sql).toContain("out_code := 'limite_certificacao';");
  });
});

describe('T-H038-MIG substituicao e exclusao (148 §3.4, CA-H038-05, CA-H038-11)', () => {
  it('idoc_confirm_done substitui a viva anterior do mesmo servico antes de gravar a nova', () => {
    const f = trecho(sql, 'create or replace function private.idoc_confirm_done(');
    expect(f).toContain("pg_advisory_xact_lock(hashtext('identity_cert:'");
    const i = f.indexOf("set status = 'substituido'");
    const j = f.indexOf("set status = 'recebido'");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('a regra de recusado por perfil fica restrita a identidade', () => {
    const f = trecho(sql, 'create or replace function private.idoc_confirm_done(');
    expect(f).toContain("if v_row.kind = 'identidade'");
    expect(f).toContain("and d.kind = 'identidade'");
  });

  it('idoc_delete escolhe o evento pelo kind', () => {
    const f = trecho(sql, 'create or replace function private.idoc_delete(');
    expect(f).toContain("'identity.cert.deleted' else 'identity.doc.deleted'");
    expect(f).toContain('if v_row.analyzed_at is not null then');
  });
});

describe('T-H038-MIG leitura (148 §3.4, CA-H038-08)', () => {
  it('idoc_list e recriada (formato de retorno mudou) e devolve kind e service_id', () => {
    expect(sql).toContain('drop function if exists private.idoc_list(uuid, timestamptz);');
    expect(sql).toContain('out_kind text, out_service_id uuid');
  });

  it('nenhuma funcao devolve caminho, bytes ou url', () => {
    expect(sql).not.toMatch(/returns table[^)]*stored_/);
    expect(sql).not.toMatch(/returns table[^)]*content_sha256/);
  });
});

describe('T-H038-MIG funcoes do gate e da guarda (148 §3.1, §3.3, CA-H038-03, CA-H038-04)', () => {
  it('certificacoes_completas: sql, stable, security definer, search_path vazio, boolean', () => {
    const f = trecho(sql, 'create or replace function private.certificacoes_completas(');
    expect(f).toContain('returns boolean');
    expect(f).toContain('language sql');
    expect(f).toContain('stable');
    expect(f).toContain('security definer');
    expect(f).toContain("set search_path = ''");
    expect(f).toContain("and d.kind = 'certificacao'");
    expect(f).toContain("and d.status = 'recebido'");
    expect(f).toContain('and d.purge_requested_at is null');
  });

  it('certificacao_servico_ok: regulamentado depende de certificacao recebida', () => {
    const f = trecho(sql, 'create or replace function private.certificacao_servico_ok(');
    expect(f).toContain('returns boolean');
    expect(f).toContain('not exists (select 1 from app.service s where s.id = p_service and s.regulated)');
  });
});

describe('T-H038-MIG permissoes (148 §5.2, T-16)', () => {
  const funcoes = [
    'private.idoc_issue_cert(uuid, uuid, uuid, text, integer, timestamptz, bigint)',
    'private.certificacoes_completas(uuid)',
    'private.certificacao_servico_ok(uuid, uuid)',
    'private.idoc_list(uuid, timestamptz)',
    'private.idoc_delete(uuid, uuid, timestamptz)',
  ];
  it('cada funcao nova ou alterada tem revoke amplo e grant so para app_system', () => {
    for (const f of funcoes) {
      expect(sql).toContain(`revoke all on function ${f}`);
      expect(sql).toContain(`grant execute on function ${f} to app_system`);
    }
  });

  it('revoke explicito de public, anon e authenticated', () => {
    expect(sql).toContain('from public, anon, authenticated');
  });
});

describe('T-H038-MIG catalogo de auditoria (148 §2 item 8, CA-H038-10)', () => {
  it('tres acoes de certificacao com chaves permitidas e sem PII', () => {
    for (const acao of ['identity.cert.received', 'identity.cert.replaced', 'identity.cert.deleted']) {
      expect(sql).toContain(`'${acao}', 'identity_document'`);
    }
    expect(sql).toContain("array['file_kind', 'size_bytes', 'reason_code']");
    expect(sql).not.toMatch(/file_name|original_name|ip_address|storage_path/);
  });
});

describe('T-H038-MIG higiene do arquivo', () => {
  it('comentarios sem referencia de issue no formato numerico', () => {
    const comentarios = bruto
      .split(/\r?\n/)
      .filter((l) => l.trimStart().startsWith('--'))
      .join('\n');
    expect(comentarios).not.toMatch(/#\d/);
  });

  it('comentarios sem mapbox, e-mail real, backup nem o nome por extenso do papel de servico', () => {
    const comentarios = bruto
      .split(/\r?\n/)
      .filter((l) => l.trimStart().startsWith('--'))
      .join('\n')
      .toLowerCase();
    expect(comentarios).not.toMatch(/mapbox|resend|backup/);
  });

  it('o codigo da migracao nao chama servico externo (sem mapbox nem e-mail)', () => {
    expect(sql).not.toMatch(/mapbox|resend/);
  });
});

describe('T-H038-MIG desfazimento (148 §7)', () => {
  it('guarda de dados com a mesma convencao da 20261112220000', () => {
    expect(rb).toContain("rollback_recusado_com_dados");
    expect(rb).toContain("app.rollback_force");
  });

  it('remove as tres funcoes novas e restaura as da Issue 50', () => {
    expect(rb).toContain('drop function if exists private.certificacao_servico_ok(uuid, uuid);');
    expect(rb).toContain('drop function if exists private.certificacoes_completas(uuid);');
    expect(rb).toContain('drop function if exists private.idoc_issue_cert(');
    expect(rb).toContain('create or replace function private.idoc_confirm_done(');
    expect(rb).toContain('create function private.idoc_list(');
  });

  it('restaura a constraint de kind original e remove service_id, indices e coerencia', () => {
    expect(rb).toContain("add constraint identity_document_kind_check check (kind in ('identidade'))");
    expect(rb).toContain('drop column if exists service_id');
    expect(rb).toContain('drop index if exists app.identity_document_cert_viva_key');
    expect(rb).toContain('drop constraint if exists identity_document_service_kind_ck');
  });

  it('o rollback e transacional', () => {
    expect(rbBruto.trimStart().startsWith('-- Desfaz')).toBe(true);
    expect(rb).toContain('begin;');
    expect(rb).toContain('commit;');
  });
});
