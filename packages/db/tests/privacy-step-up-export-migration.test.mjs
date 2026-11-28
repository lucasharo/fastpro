// Issue 120 (H-111) | Testes estaticos da migracao de step-up e extrato do titular (147-DESENHO-H111 §3.2, §7:
// T-DB-02, T-DB-09, T-ST-01 e T-ST-03). Nao conecta ao banco: le os arquivos e confere RLS, privilegios, gatilhos,
// bucket, politica de Storage, rollback e ausencia de itens fora de escopo.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113470000';
const NOME = `${VERSAO}_privacy_create_step_up_and_export.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_step_up_and_export.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const codigoDown = down.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo.split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());

describe('migracao de step-up e extrato do titular (Issue 120, fatia 2)', () => {
  it('nome e prefixo validos, dentro da faixa desta Issue (460000 e seguintes) e posterior a fatia 1', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113460000', 'prefixo posterior a fatia 1').toBe(true);
    expect(m[1] < '20261113480000', 'prefixo dentro da faixa reservada a esta fatia').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
  });

  it('T-ST-01 | nenhuma rotina de backup, exportacao de banco, historico de fotos, mapa ou agenda no SQL', () => {
    for (const termo of ['backup', 'media_access', 'pg_dump', 'mapbox', 'cron', 'create event trigger', 'ops.job']) {
      expect(codigo.toLowerCase().includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
  });

  it('T-ST-03 | nenhuma concessao a papel de servico, publico, anon ou authenticated; so app_system recebe grant', () => {
    expect(codigo.toLowerCase().includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes).toEqual(['grant select on app.step_up_grant, app.dsr_export to app_system']);
    for (const s of concessoes) expect(s, s).toMatch(/to app_system$/);
  });

  it('T-DB-02 | RLS habilitada e forcada nas duas tabelas', () => {
    for (const tabela of ['app.step_up_grant', 'app.dsr_export']) {
      expect(instrucoes.includes(`alter table ${tabela} enable row level security`), `enable ${tabela}`).toBe(true);
      expect(instrucoes.includes(`alter table ${tabela} force row level security`), `force ${tabela}`).toBe(true);
    }
  });

  it('T-DB-02 | revoke total nas duas tabelas para public, anon, authenticated e app_api', () => {
    expect(instrucoes.some((s) => s.startsWith('revoke all on app.step_up_grant, app.dsr_export')
      && /from public, anon, authenticated, app_api$/.test(s)), 'revoke total').toBe(true);
  });

  it('T-DB-01 | colunas essenciais das duas tabelas', () => {
    const grant = ['id', 'user_id', 'purpose', 'token_hash', 'created_at', 'expires_at', 'consumed_at'];
    const extrato = ['id', 'case_id', 'storage_bucket', 'storage_path', 'sha256', 'signature', 'schema_version',
      'size_bytes', 'generated_at', 'expires_at', 'purged_at', 'download_count', 'last_download_at'];
    for (const c of grant) expect(new RegExp(`\\b${c}\\s`).test(codigo), `coluna do grant ${c}`).toBe(true);
    for (const c of extrato) expect(new RegExp(`\\b${c}\\s`).test(codigo), `coluna do extrato ${c}`).toBe(true);
  });

  it('T-DB-01 | finalidade de step-up restrita a dsr_open; hash de 64 hex; extrato de 10 MiB ou menos', () => {
    expect(codigo.includes("check (purpose in ('dsr_open'))")).toBe(true);
    expect(codigo.includes("check (token_hash ~ '^[0-9a-f]{64}$')")).toBe(true);
    expect(codigo.includes("check (sha256 ~ '^[0-9a-f]{64}$')")).toBe(true);
    expect(codigo.includes("check (signature ~ '^[0-9a-f]{64}$')")).toBe(true);
    expect(codigo.includes('between 1 and 10485760')).toBe(true);
    expect(codigo.includes("check (storage_bucket = 'dsr-exports')")).toBe(true);
  });

  it('extrato: um por caso (case_id unico, referencia o caso sem exclusao em cascata)', () => {
    expect(instrucoes.some((s) => s.includes('case_id uuid not null unique references app.dsr_case (id) on delete restrict')),
      'case_id unico e sem cascata').toBe(true);
  });

  it('indices unicos e de consulta do grant: token unico; uso recente por titular; abertos por titular', () => {
    expect(instrucoes.some((s) => s.startsWith('create unique index if not exists step_up_grant_token_uk on app.step_up_grant (token_hash)')),
      'indice unico do token').toBe(true);
    expect(instrucoes.some((s) => s.startsWith('create index if not exists step_up_grant_usuario_recente_idx on app.step_up_grant (user_id, created_at desc)')),
      'indice de limite por titular').toBe(true);
    expect(instrucoes.some((s) => s.startsWith('create index if not exists step_up_grant_abertos_idx on app.step_up_grant (user_id, expires_at)')
      && /where consumed_at is null$/.test(s)), 'indice de grants abertos').toBe(true);
  });

  it('gatilhos: guarda do grant, guarda do extrato, e exclusao proibida nas duas tabelas', () => {
    const gatilhos = [...codigo.matchAll(/create\s+trigger\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).sort();
    expect(gatilhos).toEqual(['dsr_export_guard', 'dsr_export_no_delete', 'dsr_step_up_grant_guard', 'dsr_step_up_grant_no_delete']);
    expect(/\bcreate\s+event\s+trigger\b/i.test(codigo), 'gatilho de evento de banco').toBe(false);
    expect(instrucoes.includes('create trigger dsr_step_up_grant_no_delete before delete or truncate on app.step_up_grant for each statement execute function private.dsr_registro_refuse_delete()')).toBe(true);
    expect(instrucoes.includes('create trigger dsr_export_no_delete before delete or truncate on app.dsr_export for each statement execute function private.dsr_registro_refuse_delete()')).toBe(true);
  });

  it('funcoes de gatilho novas usam search_path vazio e nao sao SECURITY DEFINER', () => {
    const blocos = codigo.split(/create or replace function /i).slice(1).filter((b) => /^private\.dsr_/i.test(b));
    expect(blocos.length).toBe(3);
    for (const bloco of blocos) {
      const cabecalho = bloco.split(/\$\$/)[0];
      expect(cabecalho, `search_path em ${bloco.slice(0, 50)}`).toMatch(/set search_path = ''/i);
      expect(/security definer/i.test(cabecalho), 'nao deve ser security definer').toBe(false);
    }
  });

  it('bucket dsr-exports privado, limitado a application/json, com upsert idempotente', () => {
    expect(instrucoes.some((s) => s.startsWith("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('dsr-exports', 'dsr-exports', false, 10485760, array['application/json'])")),
      'insercao do bucket').toBe(true);
    expect(codigo.includes('on conflict (id) do update')).toBe(true);
  });

  it('politica de Storage restritiva que nega o bucket dsr-exports a qualquer papel sem BYPASSRLS', () => {
    expect(instrucoes.some((s) => s.startsWith('create policy dsr_exports_negar_acesso_direto on storage.objects as restrictive for all to public')
      && /using \(bucket_id is distinct from 'dsr-exports'\) with check \(bucket_id is distinct from 'dsr-exports'\)$/.test(s)),
    'politica restritiva').toBe(true);
    const politicas = instrucoes.filter((s) => s.startsWith('create policy'));
    expect(politicas.length, 'so a politica restritiva').toBe(1);
    expect(codigo.toLowerCase().includes('as permissive'), 'nenhuma politica permissiva').toBe(false);
  });

  it('nao altera tabelas existentes (app_user, dsr_case, config, registro de migracoes) e nao abre transacao', () => {
    expect(/\balter\s+table\s+(?!app\.step_up_grant|app\.dsr_export\b)/i.test(codigo), 'alter em outra tabela').toBe(false);
    expect(/\bschema_migration\b/i.test(codigo), 'toca o registro de migracoes').toBe(false);
    expect(/\bapp_config\b/i.test(codigo), 'toca a configuracao').toBe(false);
    expect(/^\s*(begin|commit)\s*;/im.test(codigo), 'transacao explicita no arquivo').toBe(false);
  });

  it('desfazer | recusa com extrato, token ou arquivo; remove politica, tabelas e funcoes; apaga o registro da versao', () => {
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_extratos'")).toBe(true);
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_tokens'")).toBe(true);
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_arquivos'")).toBe(true);
    expect(codigoDown.includes('drop policy if exists dsr_exports_negar_acesso_direto on storage.objects;')).toBe(true);
    expect(codigoDown.includes("delete from storage.buckets where id = 'dsr-exports';")).toBe(true);
    expect(codigoDown.includes(`delete from ops.schema_migration where version = '${VERSAO}';`)).toBe(true);
    expect(codigoDown.toLowerCase().includes(PAPEL_SERVICO)).toBe(false);
  });
});
