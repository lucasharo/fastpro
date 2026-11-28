// Issue 120 (H-111) | Testes estaticos da migracao do extrato de acesso (147-DESENHO-H111 §4.3, §7: T-ST-01,
// T-ST-03, T-UN-01 na camada do banco). Nao conecta ao banco: le os arquivos e confere privilegios, search_path,
// termos proibidos, colunas que nunca podem entrar no extrato e o arquivo de desfazer.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MIGRATION_NAME } from '../scripts/lib/migrations.mjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const VERSAO = '20261113500000';
const NOME = `${VERSAO}_privacy_create_dsr_extract.sql`;
const MIGRACAO = join(RAIZ, 'supabase', 'migrations', NOME);
const DESFAZER = join(RAIZ, 'supabase', 'rollbacks', `${VERSAO}_privacy_create_dsr_extract.down.sql`);

const sql = readFileSync(MIGRACAO, 'utf8');
const down = readFileSync(DESFAZER, 'utf8');
// Sem comentarios de linha, para que textos explicativos nao mascarem o SQL real.
const semComentario = (texto) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
const codigo = semComentario(sql);
const codigoDown = semComentario(down);
const PAPEL_SERVICO = ['service', 'role'].join('_');
const instrucoes = codigo
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);

const FUNCOES = [
  'private.dsr_build_extract(uuid, text, timestamptz)',
  'app.dsr_generate_extract(uuid)',
  'app.dsr_register_extract(uuid, text, text, text, integer)',
];

// Divide o SQL em blocos de funcao (cada "create or replace function" ate o proximo).
const blocosFuncao = codigo.split(/create or replace function /i).slice(1);
const bloco = (nome) => blocosFuncao.find((b) => b.startsWith(`${nome}(`));

describe('migracao do extrato de acesso (Issue 120, fatia 5)', () => {
  it('nome e prefixo validos, depois da fatia 4 (490000) e com arquivo de desfazer', () => {
    const m = MIGRATION_NAME.exec(NOME);
    expect(m, 'nome segue a convencao').not.toBeNull();
    expect(m[1] > '20261113490000', 'prefixo posterior a fatia 4').toBe(true);
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(existsSync(DESFAZER), 'arquivo de desfazer existe').toBe(true);
  });

  it('nenhum arquivo com fim de linha CRLF', () => {
    expect(sql.includes('\r'), 'migracao com CR').toBe(false);
    expect(down.includes('\r'), 'desfazer com CR').toBe(false);
  });

  it('a migracao nao registra a propria versao (o registro e feito no script de aplicacao)', () => {
    expect(codigo.toLowerCase().includes('ops.schema_migration')).toBe(false);
  });

  it('T-ST-01 | sem backup, exportacao de banco, historico de fotos, mapa, agenda, job ou envio de e-mail real', () => {
    for (const termo of [
      'backup',
      'media_access',
      'pg_dump',
      'mapbox',
      'cron',
      'create event trigger',
      'ops.job',
      'enfileirar',
      'pg_net',
      'smtp',
    ]) {
      expect(codigo.toLowerCase().includes(termo), `termo proibido: ${termo}`).toBe(false);
    }
  });

  it('T-ST-03 | nenhuma concessao a papel de servico, publico, anon, authenticated ou app_api; so app_system executa', () => {
    expect(codigo.toLowerCase().includes(PAPEL_SERVICO), 'papel de servico nao deve aparecer').toBe(false);
    const concessoes = instrucoes.filter((s) => s.startsWith('grant '));
    expect(concessoes).toHaveLength(1);
    expect(concessoes[0]).toMatch(/^grant execute on function /);
    expect(concessoes[0]).toMatch(/to app_system$/);
    expect(concessoes[0].includes('app.dsr_generate_extract(uuid)')).toBe(true);
    expect(concessoes[0].includes('app.dsr_register_extract(uuid, text, text, text, integer)')).toBe(true);
    expect(concessoes[0].includes('private.')).toBe(false);
  });

  it('T-DB-03 | revoke total das funcoes novas para public, anon, authenticated e app_api', () => {
    const revogacoes = instrucoes.filter((s) => s.startsWith('revoke all on function'));
    expect(revogacoes).toHaveLength(2);
    for (const s of revogacoes) expect(s).toMatch(/from public, anon, authenticated, app_api$/);
    expect(revogacoes.some((s) => s.includes('private.dsr_build_extract(uuid, text, timestamptz)'))).toBe(true);
  });

  it('T-DB-03 | toda funcao nova fixa search_path vazio e e SECURITY DEFINER quando expoe a API', () => {
    expect(blocosFuncao.length).toBe(3);
    for (const b of blocosFuncao) {
      const nome = b.split('(')[0].trim();
      expect(b.includes("set search_path = ''"), `search_path ausente em ${nome}`).toBe(true);
    }
    expect(/security definer/i.test(bloco('app.dsr_generate_extract'))).toBe(true);
    expect(/security definer/i.test(bloco('app.dsr_register_extract'))).toBe(true);
    expect(/security definer/i.test(bloco('private.dsr_build_extract'))).toBe(false);
  });

  it('as tres funcoes existem com a assinatura do desenho', () => {
    for (const assinatura of FUNCOES) {
      const nome = assinatura.split('(')[0];
      expect(codigo.includes(`create or replace function ${nome}(`), `definicao de ${nome}`).toBe(true);
    }
  });

  it('T-UN-01 | o montador nao le colunas proibidas (credenciais, cifrados, HMAC, auditoria, sessoes, caminhos)', () => {
    const montador = bloco('private.dsr_build_extract').toLowerCase();
    for (const coluna of [
      'auth_user_id',
      'document_enc',
      'document_hmac',
      'email_hmac',
      'phone_enc',
      'address_text_enc',
      'exact_point',
      'suspension_reason',
      'retention_state',
      'storage_path',
      'signature',
      'sha256',
      'token',
      'password',
      'audit',
      'app_session',
      'auth_challenge',
      'provider',
      'geocode_point_id',
      'professional_id, service_id',
    ]) {
      expect(montador.includes(coluna), `coluna proibida no montador: ${coluna}`).toBe(false);
    }
  });

  it('T-UN-01 | nenhuma leitura com SELECT * em nenhuma funcao (allowlist explicita por coluna)', () => {
    expect(/select\s+\*/i.test(codigo), 'select * encontrado').toBe(false);
  });

  it('desenho §4.3 | o montador le so as tabelas e as secoes previstas, sem auditoria nem sessao', () => {
    const montador = bloco('private.dsr_build_extract');
    for (const secao of [
      'cadastro',
      'perfil_cliente',
      'perfil_profissional',
      'areas_de_atuacao',
      'servicos_profissional',
      'documentos_verificacao',
      'pedidos',
      'consentimentos_de_contato',
      'revelacoes_de_contato',
      'assinatura',
      'acessos_comerciais',
    ]) {
      expect(montador.includes(secao), `secao ${secao}`).toBe(true);
    }
    expect(montador).not.toMatch(/audit\./);
    expect(montador).not.toMatch(/app_session|auth_challenge/);
  });

  it('desenho §4.3 | a geracao nao muda estado do caso e a registro conclui deferido -> concluido com extrato disponibilizado', () => {
    const geracao = bloco('app.dsr_generate_extract');
    expect(geracao).not.toMatch(/update app\.dsr_case/);
    expect(geracao).not.toMatch(/insert into app\.dsr_export/);
    expect(geracao).toMatch(/for update/);
    expect(geracao).toMatch(/dsr_nao_deferido/);
    expect(geracao).toMatch(/dsr_extrato_ja_gerado/);

    const registro = bloco('app.dsr_register_extract');
    expect(registro).toMatch(/insert into app\.dsr_export/);
    expect(registro).toMatch(/status = 'concluido', outcome = 'extrato_disponibilizado'/);
    expect(registro).toMatch(/private\.dsr_config_inteiro\('privacy\.dsr_export_ttl_days'\)/);
    expect(registro).toMatch(/insert into ops\.email_outbox/);
    expect(registro).toMatch(/'dsr_extrato_pronto'/);
    expect(registro).toMatch(/private\.audit_append\('system:dsr_extract'/);
  });

  it('desenho §4.3 | o aviso de conclusao leva so o protocolo; o link nao entra no e-mail', () => {
    const registro = bloco('app.dsr_register_extract');
    expect(registro).toMatch(/jsonb_build_object\('protocolo', v_caso\.protocol\)/);
    expect(registro.toLowerCase().includes('http')).toBe(false);
    expect(registro.toLowerCase().includes('url')).toBe(false);
  });

  it('desfazer | remove as tres funcoes e o registro da versao, sem apagar extratos, casos ou auditoria', () => {
    for (const assinatura of FUNCOES) {
      const nome = assinatura.split('(')[0];
      expect(codigoDown.includes(`drop function if exists ${nome}(`), `drop de ${nome}`).toBe(true);
    }
    expect(codigoDown).toMatch(/delete from ops\.schema_migration where version = '20261113500000'/);
    expect(codigoDown).not.toMatch(/delete from app\./);
    expect(codigoDown).not.toMatch(/delete from audit\./);
    expect(codigoDown).not.toMatch(/truncate/);
  });
});
