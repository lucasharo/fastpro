// T-BK-01 (estatico): varre o codigo do backup e do keep-alive e reprova o que nao pode existir:
// ferramenta de dump, opcao de RLS do pg_dump, frase-senha fora do descritor (--passphrase-fd),
// URL de banco com credencial literal, chave de servico e gravacao de frase-senha ou de texto claro
// em disco. Tambem confere a cifragem (AES256, simetrica, frase-senha pela entrada) e o isolamento
// da leitura (transacao REPEATABLE READ READ ONLY).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../scripts/lib/env.mjs';

const SCRIPTS = join(REPO_ROOT, 'packages', 'db', 'scripts');
const FILES = [
  join(SCRIPTS, 'backup.mjs'),
  join(SCRIPTS, 'keepalive.mjs'),
  ...readdirSync(join(SCRIPTS, 'lib'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(SCRIPTS, 'lib', f)),
];
const SOURCE = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const read = (...parts) => SOURCE[join(SCRIPTS, ...parts)];

const FORBIDDEN = [
  ['ferramenta de dump do PostgreSQL', /\bpg_dump\b|\bpg_restore\b/],
  ['opcao de RLS do pg_dump', /enable-row-security/],
  // So --passphrase-fd e aceito; --passphrase-file, --passphrase-repeat e --passphrase=<valor> nao.
  ['frase-senha fora do descritor (--passphrase-*)', /--passphrase(?!-fd\b)/],
  ['URL de banco com credencial literal', /postgres(?:ql)?:\/\/[^\s:'"`]+:[^\s@'"`<]{4,}@/],
  // Nome montado em partes: o check-secrets so aceita a referencia em modulos especificos.
  [
    'chave de servico',
    new RegExp(`${['service', 'role'].join('_')}|${['SUPABASE', 'SECRET', 'KEY'].join('_')}`),
  ],
  ['frase-senha atribuida a valor literal', /BACKUP_PASSPHRASE\s*[:=]\s*['"`]/],
];

// Qualquer API que grava em disco (sincrona, assincrona, por descritor, por copia, fs.promises).
const WRITE_API =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|openSync|copyFile|copyFileSync|promises)\b/;

describe('T-BK-01: codigo do backup e do keep-alive sem padroes proibidos', () => {
  for (const [label, pattern] of FORBIDDEN) {
    it(`nao contem: ${label}`, () => {
      for (const [file, text] of Object.entries(SOURCE)) {
        expect(pattern.test(text), `${file} contem ${label}`).toBe(false);
      }
    });
  }

  it('nenhuma API de gravacao em disco recebe a frase-senha (writeFile, fs.promises, openSync, copyFileSync...)', () => {
    for (const [file, text] of Object.entries(SOURCE)) {
      const writes = text.split(/\r?\n/).filter((l) => WRITE_API.test(l));
      for (const line of writes) {
        expect(/passphrase/i.test(line), `${file}: ${line.trim()}`).toBe(false);
      }
    }
  });

  it('o unico fluxo de dados para disco e o cifrado parcial (texto claro nunca vai a arquivo)', () => {
    const streams = read('lib', 'export.mjs')
      .split(/\r?\n/)
      .filter((l) => l.includes('createWriteStream('));
    expect(streams).toHaveLength(1);
    expect(streams[0]).toContain('partial');
    expect(read('lib', 'gpg.mjs')).not.toMatch(/createWriteStream|writeFileSync|openSync/);
  });

  it('a unica escrita sincrona de conteudo no exportador e o manifesto', () => {
    const sync = read('lib', 'export.mjs')
      .split(/\r?\n/)
      .filter((l) => /writeFileSync\(/.test(l));
    expect(sync.length).toBeGreaterThan(0);
    for (const line of sync) expect(line).toContain('manifestTmp');
  });
});

describe('T-BK-01 (cifragem e leitura): asserções estaticas', () => {
  it('a leitura roda em transacao REPEATABLE READ READ ONLY', () => {
    expect(read('lib', 'export.mjs')).toContain('repeatable read read only');
  });

  it('gpg: AES256, cifragem simetrica e frase-senha pelo descritor 0 (entrada padrao)', () => {
    const gpg = read('lib', 'gpg.mjs');
    expect(gpg).toContain("'AES256'");
    expect(gpg).toContain("'--symmetric'");
    expect(gpg).toMatch(/'--passphrase-fd',\s*'0'/);
    expect(gpg).not.toMatch(/--passphrase-fd',\s*'3'/);
  });
});
