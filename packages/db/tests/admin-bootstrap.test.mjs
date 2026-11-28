// H-102 | T-H102-27: script local de primeiro Superadmin (docs/factory/54-DESENHO-H102.md §6, §7).
// Cobre as travas que recusam ANTES de qualquer conexao (processo filho, variaveis explicitas, host
// local sem servico), a logica pura (argumentos, link, cifra no formato do convite) e a ordem das travas.
// NAO COBERTO AQUI (NAO VERIFICADO): emissao real no banco de desenvolvimento, segunda execucao recusada
// pelo banco e modo --continuidade com um Superadmin ativo. Nao executa contra nada real.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import {
  adminCipherKey,
  adminEmailHmac,
  adminTokenHash,
  bootstrapRefusal,
  buildInviteLink,
  hostOfDbUrl,
  parseBootstrapArgs,
  sealAdminInviteEmail,
} from '../scripts/lib/admin-bootstrap.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/admin-bootstrap.mjs', import.meta.url));
const SEGREDO_DB = 'SEGREDO-SINTETICO-DB-7f3a';
const PEPPER = ['PEPPER', 'SINTETICO', '91bd'].join('-');
const CHAVE_B64 = Buffer.alloc(32, 7).toString('base64');
const DB_URL = `postgresql://usuario:${SEGREDO_DB}@localhost:1/bancoinexistente`;

/** Ambiente explicito do processo filho: nada vem do .env.local da maquina. */
function ambiente(sobrescreve = {}) {
  const base = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    APP_ENV: 'local',
    DATABASE_URL_MIGRATIONS: DB_URL,
    PEPPER_EMAIL_HMAC: PEPPER,
    ADMIN_BASE_URL: 'https://admin.example.test',
  };
  base[['AUTH', 'CHALLENGE', 'KEY'].join('_')] = CHAVE_B64;
  return { ...base, ...sobrescreve };
}

function rodar(argv, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...argv], { env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe('T-H102-27 travas do script antes de qualquer conexao (processo filho)', () => {
  const EMAIL = 'primeiro@example.test';
  const HOST = 'localhost';

  const casos = [
    {
      nome: 'sem --confirmar-host',
      argv: ['--email', EMAIL],
      env: ambiente(),
      codigo: 'host_nao_confirmado',
    },
    {
      nome: 'host diferente do confirmado',
      argv: ['--email', EMAIL, '--confirmar-host', 'outro.example.test'],
      env: ambiente(),
      codigo: 'host_diferente',
    },
    {
      nome: 'ambiente de producao',
      argv: ['--email', EMAIL, '--confirmar-host', HOST],
      env: ambiente({ APP_ENV: 'production' }),
      codigo: 'ambiente_nao_permitido',
    },
    {
      nome: 'ambiente de staging',
      argv: ['--email', EMAIL, '--confirmar-host', HOST],
      env: ambiente({ APP_ENV: 'staging' }),
      codigo: 'ambiente_nao_permitido',
    },
    {
      nome: 'e-mail invalido',
      argv: ['--email', 'nao-e-email', '--confirmar-host', HOST],
      env: ambiente(),
      codigo: 'email_invalido',
    },
    {
      nome: 'modo desconhecido',
      argv: ['--email', EMAIL, '--confirmar-host', HOST, '--modo', 'dono'],
      env: ambiente(),
      codigo: 'modo_invalido',
    },
    {
      nome: 'argumento desconhecido',
      argv: ['--email', EMAIL, '--confirmar-host', HOST, '--senha', 'x'],
      env: ambiente(),
      codigo: 'argumento_desconhecido',
    },
  ];

  for (const caso of casos) {
    it(`recusa (${caso.nome}): saida 2, sem valor de ambiente na saida`, () => {
      const r = rodar(caso.argv, caso.env);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
      expect(r.err).toContain(caso.codigo);
      for (const sentinela of [SEGREDO_DB, PEPPER, CHAVE_B64, DB_URL]) {
        expect(r.out + r.err).not.toContain(sentinela);
      }
    });
  }

  it('com todas as travas atendidas o script so tenta conectar depois (falha de conexao, saida 1)', () => {
    const r = rodar(['--email', EMAIL, '--confirmar-host', HOST], ambiente());
    expect(r.code).toBe(1);
    expect(r.err).not.toContain('recusado');
    expect(r.out + r.err).not.toContain(SEGREDO_DB);
  });
});

describe('T-H102-27 logica pura do script', () => {
  it('argumentos: --email, --modo, --confirmar-host e --reemitir', () => {
    const a = parseBootstrapArgs(['--email', 'x@example.test', '--confirmar-host', 'h', '--reemitir']);
    expect(a).toEqual({ email: 'x@example.test', modo: 'primeiro', confirmarHost: 'h', reemitir: true, extras: [] });
    expect(parseBootstrapArgs(['--modo', 'continuidade']).modo).toBe('continuidade');
    expect(parseBootstrapArgs(['--email']).email).toBeNull();
  });

  it('trava de host: le o host da URL sem expor usuario nem senha', () => {
    expect(hostOfDbUrl(DB_URL)).toBe('localhost');
    expect(hostOfDbUrl('nao e url')).toBeNull();
    const r = bootstrapRefusal(
      { email: 'a@example.test', modo: 'primeiro', confirmarHost: 'localhost', reemitir: false, extras: [] },
      ambiente(),
      DB_URL,
    );
    expect(r).toBeNull();
  });

  it('link do convite: fragmento #t=, sem barra duplicada', () => {
    expect(buildInviteLink('https://admin.example.test/', 'TOKEN')).toBe('https://admin.example.test/convite#t=TOKEN');
    expect(buildInviteLink('https://admin.example.test', 'TOKEN')).toBe('https://admin.example.test/convite#t=TOKEN');
  });

  it('HMAC do e-mail e hash do token sao hex de 64 caracteres', () => {
    expect(adminEmailHmac(PEPPER, 'a@example.test')).toMatch(/^[0-9a-f]{64}$/);
    expect(adminTokenHash('qualquer')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cifra do e-mail: abre so com o mesmo convite (AAD) e a mesma chave', () => {
    const key = adminCipherKey(CHAVE_B64);
    expect(key).not.toBeNull();
    const id = '11111111-2222-4333-8444-555555555555';
    const blob = sealAdminInviteEmail(key, 'primeiro@example.test', id);
    expect(blob[0]).toBe(1);

    const abre = (aad, k) => {
      const nonce = blob.subarray(1, 13);
      const tag = blob.subarray(13, 29);
      const body = blob.subarray(29);
      const d = createDecipheriv('aes-256-gcm', k, nonce);
      d.setAAD(Buffer.from(aad, 'utf8'));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]).toString('utf8');
    };
    expect(abre(`admin_invite|${id}|email_enc`, key)).toBe('primeiro@example.test');
    expect(() => abre('admin_invite|outro|email_enc', key)).toThrow();
    expect(() => abre(`admin_invite|${id}|email_enc`, Buffer.alloc(32, 9))).toThrow();
  });

  it('chave de cifra invalida (tamanho errado) e recusada sem expor valor', () => {
    expect(adminCipherKey(Buffer.alloc(16).toString('base64'))).toBeNull();
    expect(adminCipherKey('')).toBeNull();
    expect(adminCipherKey(randomBytes(32).toString('base64'))).not.toBeNull();
  });
});
