// Issue 120 (H-111) | Testes estaticos da migracao que amplia app_user.status (147-DESENHO-H111 §3.3, §7: T-DB-01,
// T-DB-02, T-ST-01 e T-ST-03). Nao conecta ao banco: le os arquivos e confere o CHECK, a coerencia com
// app_user_anonimizado_consistente, o rollback recusando contas irreversiveis e a ausencia de itens fora de escopo.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113480000';
const NOME = `${VERSAO}_privacy_expand_app_user_status.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_expand_app_user_status.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const codigoDown = down.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo.split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);

describe('migracao que amplia app_user.status (Issue 120, fatia 3)', () => {
  it('nome e prefixo validos, dentro da faixa desta fatia (480000 em diante) e posterior a fatia 2', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113470000', 'prefixo posterior a fatia 2').toBe(true);
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

  it('T-ST-03 | nenhuma concessao, papel de servico, funcao, gatilho ou tabela nova', () => {
    expect(codigo.toLowerCase().includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    expect(instrucoes.some((s) => s.startsWith('grant ')), 'grant').toBe(false);
    expect(instrucoes.some((s) => s.startsWith('create ')), 'create').toBe(false);
    expect(/\bcreate\s+(or\s+replace\s+)?(function|trigger|table|policy)/i.test(codigo), 'objeto novo').toBe(false);
  });

  it('T-DB-01 | alteracoes so em app.app_user, e so nas duas constraints desta fatia', () => {
    const alters = instrucoes.filter((s) => s.startsWith('alter table'));
    expect(alters.length, 'quatro comandos alter (drop/add de duas constraints)').toBe(4);
    for (const s of alters) expect(s.startsWith('alter table app.app_user '), s).toBe(true);
  });

  it('T-DB-01 | CHECK de status com os quatro valores exatos', () => {
    expect(instrucoes.includes(
      "alter table app.app_user add constraint app_user_status_check check (status in ('ativo', 'bloqueado', 'em_eliminacao', 'anonimizado'))",
    ), 'check de status').toBe(true);
  });

  it('coerencia | status anonimizado exige anonymized_at e retention_state expurgado (fecha o NULL da constraint existente)', () => {
    expect(instrucoes.includes(
      "alter table app.app_user add constraint app_user_status_anonimizado_consistente check (status <> 'anonimizado' or (anonymized_at is not null and retention_state is not distinct from 'expurgado'))",
    ), 'check de coerencia').toBe(true);
  });

  it('nao toca registro de migracoes, configuracao, tabelas de outras Issues nem abre transacao', () => {
    expect(/\bschema_migration\b/i.test(codigo), 'toca o registro de migracoes').toBe(false);
    expect(/\bapp_config\b/i.test(codigo), 'toca a configuracao').toBe(false);
    expect(/^\s*(begin|commit)\s*;/im.test(codigo), 'transacao explicita no arquivo').toBe(false);
  });

  it('pre-requisitos | exige a tabela e as duas constraints que a migracao espera', () => {
    expect(codigo.includes("conname = 'app_user_status_check'")).toBe(true);
    expect(codigo.includes("conname = 'app_user_anonimizado_consistente'")).toBe(true);
  });

  it('desfazer | recusa conta anonimizada e conta em eliminacao; restaura o CHECK antigo; apaga o registro da versao', () => {
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_conta_anonimizada'")).toBe(true);
    expect(codigoDown.includes("raise exception 'dsr_rollback_com_conta_em_eliminacao'")).toBe(true);
    expect(codigoDown.includes("check (status in ('ativo', 'bloqueado'))")).toBe(true);
    expect(codigoDown.includes('drop constraint if exists app_user_status_anonimizado_consistente;')).toBe(true);
    expect(codigoDown.includes(`delete from ops.schema_migration where version = '${VERSAO}';`)).toBe(true);
    expect(codigoDown.toLowerCase().includes(PAPEL_SERVICO)).toBe(false);
  });
});
