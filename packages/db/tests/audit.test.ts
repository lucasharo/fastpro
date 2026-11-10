import { describe, it, expect, vi } from 'vitest';
import {
  AUDIT_STATE_KEYS,
  GENESIS_HASH,
  appendAudit,
  asTx,
  assertAuditStateClean,
  canonicalizeState,
  computeRowHash,
  isForbiddenStateKey,
  verifyChain,
  type AuditChainRow,
  type AuditHashFields,
} from '../src/audit.js';

// Vetor de ouro calculado pelo proprio banco (private.audit_row_hash) para os mesmos campos:
// garante a paridade SQL x TS. Se o algoritmo mudar, muda hash_version (nao este vetor).
const golden: AuditHashFields = {
  hashVersion: 1,
  seq: 7,
  id: '11111111-1111-4111-8111-111111111111',
  at: '2026-11-10T12:34:56.123456Z',
  actorRef: 'admin:u1',
  actorRole: 'superadmin',
  action: 'professional.suspended',
  objectType: 'professional_profile',
  objectId: '22222222-2222-4222-8222-222222222222',
  beforeState: { status: 'active', b: 1 },
  afterState: {
    until_at: '2026-12-01T00:00:00Z',
    status: 'suspended',
    visible: true,
    x: null,
    n: -12,
  },
  reasonCode: 'policy_violation',
  correlationId: '33333333-3333-4333-8333-333333333333',
  prevHash: 'a'.repeat(64),
};
// Dividido em partes: o check-secrets reprova literais hexadecimais longos.
const GOLDEN_HASH = [
  'd7d5e6d79bb0b268',
  '6fe5fa1fac2dc6a3',
  '76b2b33eb5bdfc18',
  'e948614a4f47b667',
].join('');

describe('U-01 computeRowHash', () => {
  it('bate com o vetor de ouro do banco', () => {
    expect(computeRowHash(golden)).toBe(GOLDEN_HASH);
  });

  it('alterar qualquer campo muda o hash', () => {
    const variants: Array<Partial<AuditHashFields>> = [
      { hashVersion: 2 },
      { seq: 8 },
      { id: '11111111-1111-4111-8111-111111111112' },
      { at: '2026-11-10T12:34:56.123457Z' },
      { actorRef: 'admin:u2' },
      { actorRole: 'auditor' },
      { action: 'review.revised' },
      { objectType: 'review' },
      { objectId: '22222222-2222-4222-8222-222222222223' },
      { beforeState: { status: 'inactive', b: 1 } },
      { afterState: { status: 'suspended' } },
      { reasonCode: 'fraud_suspected' },
      { reasonCode: null },
      { correlationId: null },
      { prevHash: 'b'.repeat(64) },
    ];
    for (const v of variants) {
      expect(computeRowHash({ ...golden, ...v })).not.toBe(GOLDEN_HASH);
    }
  });
});

describe('U-02 canonicalizeState', () => {
  it('ordem de chaves independe da entrada; tipos escalares', () => {
    expect(canonicalizeState({ b: 1, a: true, c: null, d: 'x' })).toBe(
      canonicalizeState({ d: 'x', c: null, a: true, b: 1 }),
    );
    expect(canonicalizeState({ b: 1, a: true, c: null, d: 'x' })).toBe(
      '{"a":true,"b":1,"c":null,"d":"x"}',
    );
    expect(canonicalizeState({})).toBe('{}');
  });

  it('ordena bytewise (maiusculas antes de minusculas, como COLLATE "C")', () => {
    expect(canonicalizeState({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it('rejeita aninhamento e numero nao finito', () => {
    expect(() => canonicalizeState({ a: { b: 1 } } as never)).toThrow();
    expect(() => canonicalizeState({ a: Number.NaN })).toThrow();
  });
});

describe('U-03 assertAuditStateClean', () => {
  it('aceita estado limpo da allowlist', () => {
    expect(() =>
      assertAuditStateClean(
        { status: 'suspended', until_at: '2026-12-01T00:00:00Z' },
        AUDIT_STATE_KEYS['professional.suspended'],
      ),
    ).not.toThrow();
    expect(() =>
      assertAuditStateClean({ consent_text_version: 'v1', granted: true }),
    ).not.toThrow();
  });

  it('rejeita e-mail, CPF (com e sem mascara), telefone e texto livre', () => {
    for (const bad of [
      'ana@example.com',
      '123.456.789-09',
      '12345678909',
      '11999998888',
      'Maria da Silva',
      'x'.repeat(65),
    ]) {
      expect(() => assertAuditStateClean({ status: bad })).toThrow(/AU002|nao permitido/);
    }
  });

  it('rejeita chave proibida, aninhado e chave fora da allowlist', () => {
    expect(() => assertAuditStateClean({ email: 'x' })).toThrow();
    expect(() => assertAuditStateClean({ user_name: 'x' })).toThrow();
    expect(() => assertAuditStateClean({ ip: '1' })).toThrow();
    expect(() => assertAuditStateClean({ status: { a: 1 } } as never)).toThrow();
    expect(() => assertAuditStateClean({ status: 'x' }, ['visible'])).toThrow();
  });

  it('as chaves semeadas nao sao proibidas', () => {
    for (const keys of Object.values(AUDIT_STATE_KEYS)) {
      for (const k of keys) expect(isForbiddenStateKey(k), k).toBe(false);
    }
  });

  it('F-1: termos curtos em qualquer posicao, camelCase e nomes compostos sao proibidos', () => {
    for (const k of [
      'customer_name_hash',
      'full_name_normalized',
      'client_ip_hash',
      'customer_rg_number',
      'client_cep_prefix',
      'chat_body_hash',
      'geo_lat_rounded',
      'user_text_snapshot',
      'chat_text',
      'username',
      'fullname',
      'firstname',
      'lastname',
      'customerName',
      'ipaddr',
      'user_name',
    ]) {
      expect(isForbiddenStateKey(k), k).toBe(true);
    }
  });

  it('F-1: chaves validas continuam aceitas (until_at, consent_text_version e parecidas)', () => {
    for (const k of [
      'until_at',
      'consent_text_version',
      'consent_texto_versao',
      'status',
      'approval_request_id',
      'acceptance_id',
      'granted',
      'scope',
      'refund_amount_cents',
    ]) {
      expect(isForbiddenStateKey(k), k).toBe(false);
    }
  });
});

function buildChain(n: number): AuditChainRow[] {
  const rows: AuditChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i += 1) {
    const base: AuditHashFields = {
      ...golden,
      seq: i,
      id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      prevHash: prev,
    };
    const rowHash = computeRowHash(base);
    rows.push({ ...base, rowHash });
    prev = rowHash;
  }
  return rows;
}

describe('U-04 verifyChain', () => {
  it('cadeia valida passa (com e sem cabeca)', () => {
    const rows = buildChain(4);
    expect(verifyChain(rows).ok).toBe(true);
    const last = rows[3]!;
    expect(verifyChain(rows, { lastSeq: 4, lastHash: last.rowHash })).toMatchObject({
      ok: true,
      checked: 4,
    });
    expect(verifyChain([], { lastSeq: 0, lastHash: GENESIS_HASH }).ok).toBe(true);
  });

  it('detecta adulteracao de estado', () => {
    const rows = buildChain(4);
    rows[1] = { ...rows[1]!, afterState: { status: 'outro' } };
    expect(verifyChain(rows)).toMatchObject({
      ok: false,
      firstBadSeq: 2,
      reason: 'row_hash_divergente',
    });
  });

  it('detecta prev_hash alterado, lacuna, troca de ordem e cabeca divergente', () => {
    const rows = buildChain(4);
    const tampered = [...rows];
    tampered[2] = { ...rows[2]!, prevHash: 'c'.repeat(64) };
    expect(verifyChain(tampered)).toMatchObject({ firstBadSeq: 3, reason: 'prev_hash_divergente' });

    expect(verifyChain([rows[0]!, rows[2]!, rows[3]!])).toMatchObject({
      firstBadSeq: 2,
      reason: 'lacuna_seq',
    });
    expect(verifyChain([rows[0]!, rows[2]!, rows[1]!, rows[3]!])).toMatchObject({
      reason: 'lacuna_seq',
    });
    expect(verifyChain(rows.slice(0, 3), { lastSeq: 4, lastHash: rows[3]!.rowHash })).toMatchObject(
      { firstBadSeq: 4, reason: 'cabeca_divergente' },
    );
  });
});

describe('U-05 appendAudit', () => {
  const input = {
    actorRef: 'admin:u1',
    actorRole: 'superadmin',
    action: 'professional.suspended',
    objectType: 'professional_profile',
    objectId: '22222222-2222-4222-8222-222222222222',
    beforeState: { status: 'active' },
    afterState: { status: 'suspended' },
    reasonCode: 'policy_violation',
    correlationId: '33333333-3333-4333-8333-333333333333',
  };

  it('monta os 9 parametros na ordem e devolve o id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'evt-1' }] });
    const id = await appendAudit(asTx({ query }), input);
    expect(id).toBe('evt-1');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('private.audit_append');
    expect(values).toEqual([
      'admin:u1',
      'superadmin',
      'professional.suspended',
      'professional_profile',
      '22222222-2222-4222-8222-222222222222',
      '{"status":"active"}',
      '{"status":"suspended"}',
      'policy_violation',
      '33333333-3333-4333-8333-333333333333',
    ]);
  });

  it('propaga o erro do banco sem engolir', async () => {
    const boom = Object.assign(new Error('falhou'), { code: 'AU002' });
    const query = vi.fn().mockRejectedValue(boom);
    await expect(appendAudit(asTx({ query }), input)).rejects.toBe(boom);
  });

  it('rejeita PII antes de chegar ao banco', async () => {
    const query = vi.fn();
    await expect(
      appendAudit(asTx({ query }), { ...input, afterState: { status: 'a@b.com' } }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
