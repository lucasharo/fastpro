// Issue 46 (H-033) | Teste estatico das migracoes do telefone e do consentimento (docs/factory/129-DESENHO-H033.md, §8, T-21).
// Sem banco e sem rede: le os arquivos SQL e os rollbacks. A prova no Postgres fica em contact-h033.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);

const CRIACAO = '20261113250000_contact_create_phone_consent.sql';
const CORRECAO_VOLATILE = '20261113250100_contact_fix_available_volatile.sql';
const CORRECAO_GATILHO = '20261113290000_contact_revoke_trigger_execute.sql';
const ARQUIVOS = [CRIACAO, CORRECAO_VOLATILE, CORRECAO_GATILHO];

const lerMig = (arq) => readFileSync(new URL(arq, MIGRATIONS), 'utf8');
const lerDown = (arq) => readFileSync(new URL(arq.replace(/\.sql$/, '.down.sql'), ROLLBACKS), 'utf8');
/** SQL sem linhas de comentario e em minusculas, com espacos normalizados. */
const sem = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');
const prefixo = (arq) => arq.slice(0, 14);

describe('T-21 prefixo e ordem das migracoes da Issue 46', () => {
  it('os tres arquivos e seus rollbacks existem e tem prefixo de 14 digitos', () => {
    for (const arq of ARQUIVOS) {
      expect(arq).toMatch(/^\d{14}_[a-z_]+\.sql$/);
      expect(() => lerMig(arq)).not.toThrow();
      expect(() => lerDown(arq)).not.toThrow();
    }
  });

  it('o prefixo e unico no diretorio de migracoes (nenhum outro arquivo com o mesmo prefixo)', () => {
    const todos = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map(prefixo);
    for (const arq of ARQUIVOS) {
      expect(todos.filter((p) => p === prefixo(arq))).toHaveLength(1);
    }
  });

  it('a ordem e crescente (criacao, correcao de volatilidade, correcao dos gatilhos)', () => {
    const p = ARQUIVOS.map(prefixo);
    expect(p[0] < p[1]).toBe(true);
    expect(p[1] < p[2]).toBe(true);
  });

  it('a correcao dos gatilhos vem depois dos prefixos de Issue 57 e Issue 53 ja existentes', () => {
    expect(prefixo(CORRECAO_GATILHO) > '20261113280000').toBe(true);
    expect(prefixo(CORRECAO_GATILHO) > '20261113270000').toBe(true);
  });
});

describe('T-21 privilegios e registro de revelacao', () => {
  const criacao = sem(lerMig(CRIACAO));

  it('todo grant da criacao vai so para app_system (nenhum outro papel recebe execucao ou leitura)', () => {
    const destinos = [...criacao.matchAll(/grant\s+[^;]+?\s+to\s+([a-z_, ]+?)\s*;/g)].map((m) => m[1].trim());
    expect(destinos.length).toBeGreaterThan(0);
    for (const d of destinos) expect(d).toBe('app_system');
  });

  it('toda revogacao de funcao cita PUBLIC, anon, authenticated e app_api', () => {
    const revogacoes = [...criacao.matchAll(/revoke all on function [^;]+;/g)].map((m) => m[0]);
    expect(revogacoes.length).toBeGreaterThan(0);
    for (const r of revogacoes) {
      for (const papel of ['public', 'anon', 'authenticated', 'app_api']) {
        expect(r).toContain(papel);
      }
    }
  });

  it('as tabelas de consentimento e de revelacao nao tem coluna de telefone ou e-mail', () => {
    for (const tabela of ['contact_consent', 'contact_reveal_log']) {
      const m = criacao.match(new RegExp(`create table if not exists app\\.${tabela} \\((.*?)\\);`));
      expect(m, tabela).not.toBeNull();
      // Nome de coluna no inicio de cada definicao (o valor 'telefone' de kind nao conta).
      expect(m[1]).not.toMatch(/(^|,\s*)(phone|email|telefone)[a-z_]*\s/);
    }
  });

  it('o registro de revelacao aceita so telefone ou endereco como tipo', () => {
    expect(criacao).toContain("check (kind in ('telefone', 'endereco'))");
  });

  it('a migracao nao cria agendamento, job, tick nem chamada externa', () => {
    for (const arq of ARQUIVOS) {
      expect(sem(lerMig(arq))).not.toMatch(/cron\.|cron_schedule|ops\.job|pg_cron|schedule|tick|http_|net\./);
    }
  });

  it('a correcao dos gatilhos so revoga execucao (nao concede nada)', () => {
    const correcao = sem(lerMig(CORRECAO_GATILHO));
    expect(correcao).not.toMatch(/\bgrant\b/);
    expect(correcao).toMatch(/revoke all on function/);
  });
});

describe('T-21 rollback', () => {
  it('o rollback da criacao recusa com dados e registra a remocao da versao', () => {
    const down = sem(lerDown(CRIACAO));
    expect(down).toContain('rollback_recusado_com_dados');
    expect(down).toContain("delete from ops.schema_migration where version = '20261113250000'");
  });

  it('o rollback da criacao remove as tabelas e a coluna de telefone so depois da conferencia', () => {
    const down = sem(lerDown(CRIACAO));
    const conferencia = down.indexOf('rollback_recusado_com_dados');
    expect(conferencia).toBeGreaterThan(-1);
    expect(down.indexOf('drop table if exists app.contact_consent')).toBeGreaterThan(conferencia);
    expect(down.indexOf('drop column if exists phone_enc')).toBeGreaterThan(conferencia);
  });

  it('o rollback da correcao dos gatilhos devolve EXECUTE a PUBLIC e remove a versao', () => {
    const down = sem(lerDown(CORRECAO_GATILHO));
    expect(down).toContain('grant execute on function private.service_request_phone_au() to public');
    expect(down).toContain("delete from ops.schema_migration where version = '20261113290000'");
  });
});
