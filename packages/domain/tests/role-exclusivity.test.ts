// H-017 (Issue #30) | T-11 da exclusividade de papeis: traducao do erro do banco (101-DESENHO-H017.md, §4.2, §7).
// Logica pura, sem banco. A migracao e a fonte das chaves: a checagem cruzada le o SQL e confere que cada chave
// de ROLE_EXCLUSIVITY_DB_KEYS e levantada por um raise da migracao com errcode 23514.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseRoleExclusivityError,
  ROLE_EXCLUSIVITY_DB_KEYS,
  ROLE_EXCLUSIVITY_MESSAGE,
} from '../src/identity/role-exclusivity.js';

const MIGRATION = new URL('../../../supabase/migrations/20261112200000_identity_create_role_exclusivity.sql', import.meta.url);

const erro = (code: string | undefined, message: string) => ({ code, message });

describe('T-11 parseRoleExclusivityError (unitario)', () => {
  it('as quatro chaves do banco viram a regra correspondente', () => {
    expect(parseRoleExclusivityError(erro('23514', 'papel_exclusivo_admin_cliente'))).toBe('admin_cliente');
    expect(parseRoleExclusivityError(erro('23514', 'papel_exclusivo_admin_profissional'))).toBe('admin_profissional');
    expect(parseRoleExclusivityError(erro('23514', 'papel_exclusivo_perfil_admin'))).toBe('perfil_admin');
    expect(parseRoleExclusivityError(erro('23514', 'aceite_proprio_pedido'))).toBe('aceite_proprio_pedido');
  });

  it('erro de outro codigo, mensagem desconhecida, sem codigo ou nao-objeto devolve null', () => {
    expect(parseRoleExclusivityError(erro('23505', 'papel_exclusivo_admin_cliente'))).toBeNull();
    expect(parseRoleExclusivityError(erro('23514', 'mensagem qualquer'))).toBeNull();
    expect(parseRoleExclusivityError(erro('23514', 'papel_isolamento_nao_suportado'))).toBeNull();
    expect(parseRoleExclusivityError(erro(undefined, 'papel_exclusivo_admin_cliente'))).toBeNull();
    expect(parseRoleExclusivityError(null)).toBeNull();
    expect(parseRoleExclusivityError('papel_exclusivo_admin_cliente')).toBeNull();
    expect(parseRoleExclusivityError(undefined)).toBeNull();
  });

  it('chaves herdadas do Object.prototype nao sao confundidas com regra', () => {
    expect(parseRoleExclusivityError(erro('23514', 'constructor'))).toBeNull();
    expect(parseRoleExclusivityError(erro('23514', '__proto__'))).toBeNull();
  });

  it('a mensagem de resposta e unica para as quatro regras e nao traz e-mail, id nem CPF', () => {
    expect(ROLE_EXCLUSIVITY_MESSAGE).toBe('Operação não permitida.');
    expect(ROLE_EXCLUSIVITY_MESSAGE).not.toMatch(/@/);
    expect(ROLE_EXCLUSIVITY_MESSAGE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(ROLE_EXCLUSIVITY_MESSAGE).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  });

  it('o erro original (com e-mail e id de terceiro) nunca e devolvido: so a regra', () => {
    const sentinela = 'terceiro@example.test 0f9c2a7e-1111-4222-8333-944455556666';
    const rule = parseRoleExclusivityError(erro('23514', `papel_exclusivo_admin_cliente ${sentinela}`));
    expect(rule).toBeNull();
    const ok = parseRoleExclusivityError(erro('23514', 'papel_exclusivo_admin_cliente'));
    expect(ok).toBe('admin_cliente');
    expect(JSON.stringify(ok)).not.toContain('example.test');
  });

  it('as quatro chaves batem com os raises da migracao, todos com errcode 23514', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const chave of Object.keys(ROLE_EXCLUSIVITY_DB_KEYS)) {
      const re = new RegExp(`raise exception '${chave}'\\s+using errcode = '23514'`);
      expect(sql, `raise da chave ${chave}`).toMatch(re);
    }
  });
});
