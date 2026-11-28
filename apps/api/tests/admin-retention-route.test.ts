// H-109 (Issue 118) | Rotas /v1/admin/retention/* em memoria (docs/factory/82-DESENHO-H109.md §5; 79 CA-H109-02 e 03).
// Sem banco e sem rede: a porta do cadastro e uma versao em memoria que segue as regras das funcoes do banco
// (aprovador distinto, permissao do cadastro ou do hold, uso unico, aprovacao antes de aplicar).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-109');
};

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_SESSION_COOKIE,
  RetentionAdminError,
  adminPermissionsOf,
  type AdminGuardRecord,
  type RetentionAdminPort,
} from '@fastpro/domain';
import {
  casarRotaRetencao,
  handleAdminRetentionRoute,
  type AdminRetentionRouteOptions,
} from '../src/admin-retention-route.js';

const BASE = 'https://admin.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);
const HORA = 60 * 60 * 1000;
const SEG = (nome: string) => `example-admin-secret-${nome}-retention-000000000`;

function linha(userId: string, roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId,
    roles,
    permissions: [...adminPermissionsOf(roles)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: T0 + 8 * HORA,
    totpAtMs: T0,
    ...extra,
  };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG('gov1'), linha('gov-1', ['governanca_dados'])],
  [SEG('gov2'), linha('gov-2', ['governanca_dados'])],
  [SEG('super'), linha('super-1', ['superadmin'])],
  [SEG('auditor'), linha('aud-1', ['auditor'])],
  [SEG('sem-aal2'), linha('gov-3', ['governanca_dados'], { aal2: false })],
]);

interface Aprovacao {
  readonly id: string;
  readonly acao: 'retencao_politica';
  readonly detalhe: string;
  readonly solicitante: string;
  status: 'pendente' | 'aprovada' | 'consumida';
  readonly votos: Set<string>;
}

/** Porta em memoria com as regras do banco: sem autoaprovacao, permissao por tipo, uso unico e ordem. */
class CadastroEmMemoria implements RetentionAdminPort {
  readonly auditoria: string[] = [];
  readonly aprovacoes = new Map<string, Aprovacao>();
  readonly holds = new Map<string, { id: string; ativo: boolean }>();
  readonly politicas = new Map([['RC-01', { id: 'pol-rc01', simulacao: false }]]);
  private seq = 0;
  private readonly permissoesDeAprovador = new Map<string, string[]>([
    ['gov-1', ['retention.policy.manage', 'retention.hold.manage']],
    ['gov-2', ['retention.policy.manage', 'retention.hold.manage']],
    ['super-1', ['admin.role.manage', 'catalog.manage']],
  ]);

  private nova(detalhe: string, solicitante: string): string {
    const id = randomUUID();
    this.seq++;
    this.aprovacoes.set(id, { id, acao: 'retencao_politica', detalhe, solicitante, status: 'pendente', votos: new Set() });
    return id;
  }

  async lerPolitica(classe: 'RC-01' | 'RC-02' | 'RC-03' | 'RC-04' | 'RC-05' | 'RC-06' | 'RC-07' | 'RC-10') {
    const p = this.politicas.get(classe);
    return p ? { id: p.id, simulacaoRegistrada: p.simulacao } : null;
  }
  async proporPolitica(ator: string, _m: unknown, _pol: string, changeId: string) {
    const aprovacao = this.nova(changeId, ator);
    this.auditoria.push('retention.policy.proposed');
    return { approvalRequestId: aprovacao };
  }
  async registrarNegacaoPolitica(_ator: string, _classe: string, motivo: string) {
    this.auditoria.push(`retention.policy.denied:${motivo}`);
  }
  async votar(aprovacaoId: string, aprovador: string) {
    const a = this.aprovacoes.get(aprovacaoId);
    if (!a) throw new RetentionAdminError('aprovacao_inexistente');
    if (a.status !== 'pendente') throw new RetentionAdminError('aprovacao_nao_pendente');
    if (aprovador === a.solicitante) throw new RetentionAdminError('aprovacao_propria');
    const exigida = a.detalhe.startsWith('hold:') ? 'retention.hold.manage' : 'retention.policy.manage';
    if (!(this.permissoesDeAprovador.get(aprovador) ?? []).includes(exigida)) {
      throw new RetentionAdminError('aprovador_sem_permissao');
    }
    a.votos.add(aprovador);
    a.status = 'aprovada';
    return 'aprovada' as const;
  }
  async aplicarPolitica(ator: string, changeId: string) {
    const a = [...this.aprovacoes.values()].find((x) => x.detalhe === changeId);
    if (!a || a.status !== 'aprovada' || a.solicitante !== ator) throw new RetentionAdminError('aprovacao_invalida');
    a.status = 'consumida';
    this.auditoria.push('retention.policy.changed');
  }
  async colocarHold() {
    const id = `hold-${++this.seq}`;
    this.holds.set(id, { id, ativo: true });
    this.auditoria.push('retention.hold.placed');
    return { holdId: id };
  }
  async proporLiberacaoHold(ator: string, holdId: string) {
    const h = this.holds.get(holdId);
    if (!h || !h.ativo) throw new RetentionAdminError('hold_inexistente');
    this.auditoria.push('retention.hold.release_requested');
    return { approvalRequestId: this.nova(`hold:${holdId}`, ator) };
  }
  async liberarHold(ator: string, holdId: string, aprovacaoId: string) {
    const a = this.aprovacoes.get(aprovacaoId);
    if (!a || a.detalhe !== `hold:${holdId}` || a.status !== 'aprovada' || a.solicitante !== ator) {
      throw new RetentionAdminError('aprovacao_invalida');
    }
    a.status = 'consumida';
    const h = this.holds.get(holdId);
    if (h) h.ativo = false;
    this.auditoria.push('retention.hold.released');
  }
}

interface Resposta {
  readonly status: number;
  readonly corpo: Record<string, unknown> | null;
}

function opcoes(port: CadastroEmMemoria): AdminRetentionRouteOptions {
  return {
    guard: async (secret) => LINHAS.get(secret) ?? null,
    port,
    baseUrl: BASE,
    clock: { nowMs: () => T0 },
    novoId: (() => {
      let n = 0;
      return () => `chg-${++n}`;
    })(),
  };
}

async function pedir(
  opts: AdminRetentionRouteOptions,
  caminho: string,
  { segredo = SEG('gov1') as string | null, corpo = undefined as unknown, metodo = 'POST', origem = BASE } = {},
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {
    'content-type': 'application/json',
    origin: origem,
    'sec-fetch-site': 'same-origin',
  };
  if (segredo !== null) cabecalhos.cookie = `${ADMIN_SESSION_COOKIE}=${segredo}`;
  const req = Readable.from(corpo === undefined ? [] : [Buffer.from(JSON.stringify(corpo))]) as unknown as IncomingMessage;
  Object.assign(req, { method: metodo, url: caminho, headers: cabecalhos });

  let status = 0;
  let texto = '';
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(b?: string) {
      texto = b ?? '';
    },
  } as unknown as ServerResponse;

  await handleAdminRetentionRoute(req, res, opts, caminho);
  return { status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : null };
}

const POLITICA_VALIDA = {
  dataClass: 'RC-01',
  periodSeconds: null,
  action: null,
  legalBasisRef: null,
  effectiveFrom: null,
  enabled: false,
  dryRun: true,
};

describe('casamento de rotas (H-109)', () => {
  it('so POST nas rotas do cadastro; qualquer outra coisa e 404', () => {
    expect(casarRotaRetencao('POST', '/v1/admin/retention/policy-changes')?.rota.nome).toBe('proposta');
    expect(casarRotaRetencao('POST', '/v1/admin/retention/holds/abc/release')?.params).toEqual(['abc']);
    expect(casarRotaRetencao('GET', '/v1/admin/retention/policy-changes')).toBeNull();
    expect(casarRotaRetencao('POST', '/v1/admin/retention/unknown')).toBeNull();
  });
});

describe('guarda e permissao (CA-H109-02 e 03; 404 sem permissao)', () => {
  it('sem cookie, sem sessao ou com AAL1 = 404 vazio, sem tocar o cadastro', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    expect(await pedir(opts, '/v1/admin/retention/policy-changes', { segredo: null, corpo: POLITICA_VALIDA })).toEqual({ status: 404, corpo: null });
    expect(await pedir(opts, '/v1/admin/retention/policy-changes', { segredo: SEG('desconhecido'), corpo: POLITICA_VALIDA })).toEqual({ status: 404, corpo: null });
    expect(await pedir(opts, '/v1/admin/retention/policy-changes', { segredo: SEG('sem-aal2'), corpo: POLITICA_VALIDA })).toEqual({ status: 404, corpo: null });
    expect(port.auditoria).toEqual([]);
  });

  it('auditor e superadmin nao veem as rotas: 404 identico ao de rota inexistente', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    for (const segredo of [SEG('auditor'), SEG('super')]) {
      expect(await pedir(opts, '/v1/admin/retention/policy-changes', { segredo, corpo: POLITICA_VALIDA })).toEqual({ status: 404, corpo: null });
      expect(await pedir(opts, '/v1/admin/retention/holds', { segredo, corpo: { subjectType: 'user', subjectId: '11111111-2222-4333-8444-555555555555', reasonCode: 'litigio' } })).toEqual({ status: 404, corpo: null });
    }
    expect(port.auditoria).toEqual([]);
  });

  it('Origin divergente em mutacao = 403, antes de qualquer efeito', async () => {
    const port = new CadastroEmMemoria();
    const r = await pedir(opcoes(port), '/v1/admin/retention/policy-changes', { corpo: POLITICA_VALIDA, origem: 'https://outro.test' });
    expect(r.status).toBe(403);
    expect(r.corpo).toEqual({ code: 'origem_invalida' });
  });
});

describe('cadastro da politica: aprovacao dupla e negacao auditada (CA-H109-02 e 03)', () => {
  it('habilitar sem periodo e recusado com 422 e negacao gravada na auditoria', async () => {
    const port = new CadastroEmMemoria();
    const r = await pedir(opcoes(port), '/v1/admin/retention/policy-changes', {
      corpo: { ...POLITICA_VALIDA, enabled: true, action: 'anonimizar', legalBasisRef: 'parecer-1', effectiveFrom: '2099-01-01T00:00:00Z' },
    });
    expect(r.status).toBe(422);
    expect(r.corpo).toMatchObject({ code: 'habilitacao_incompleta' });
    expect(port.auditoria).toEqual(['retention.policy.denied:habilitacao_incompleta']);
  });

  it('desligar a simulacao sem simulacao registrada e recusado', async () => {
    const port = new CadastroEmMemoria();
    const r = await pedir(opcoes(port), '/v1/admin/retention/policy-changes', { corpo: { ...POLITICA_VALIDA, dryRun: false } });
    expect(r.status).toBe(422);
    expect(r.corpo).toMatchObject({ code: 'simulacao_pendente' });
  });

  it('classe fora da tabela (RC-08) e recusada antes de qualquer consulta ao cadastro', async () => {
    const port = new CadastroEmMemoria();
    const r = await pedir(opcoes(port), '/v1/admin/retention/policy-changes', { corpo: { ...POLITICA_VALIDA, dataClass: 'RC-08' } });
    expect(r.status).toBe(400);
    expect(r.corpo).toEqual({ code: 'classe_invalida' });
  });

  it('fluxo completo: propoe, o proprio solicitante nao vota, outro aprova, o solicitante aplica', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    const p = await pedir(opts, '/v1/admin/retention/policy-changes', { corpo: POLITICA_VALIDA });
    expect(p.status).toBe(201);
    const { changeId, approvalRequestId } = p.corpo as { changeId: string; approvalRequestId: string };

    const autoVoto = await pedir(opts, `/v1/admin/retention/approvals/${approvalRequestId}/votes`, { segredo: SEG('gov1') });
    expect(autoVoto).toEqual({ status: 403, corpo: { code: 'aprovacao_propria' } });

    const aplicarAntes = await pedir(opts, `/v1/admin/retention/policy-changes/${changeId}/apply`, { segredo: SEG('gov1') });
    expect(aplicarAntes.status).toBe(409);

    const voto = await pedir(opts, `/v1/admin/retention/approvals/${approvalRequestId}/votes`, { segredo: SEG('gov2') });
    expect(voto).toEqual({ status: 200, corpo: { estado: 'aprovada' } });

    const aplicar = await pedir(opts, `/v1/admin/retention/policy-changes/${changeId}/apply`, { segredo: SEG('gov1') });
    expect(aplicar).toEqual({ status: 200, corpo: { estado: 'aplicada' } });
    expect(port.auditoria).toEqual(['retention.policy.proposed', 'retention.policy.changed']);
  });

  it('superadmin nao pode aprovar politica de retencao (nao herda a permissao do cadastro)', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    const p = await pedir(opts, '/v1/admin/retention/policy-changes', { corpo: POLITICA_VALIDA });
    const { approvalRequestId } = p.corpo as { approvalRequestId: string };
    // O superadmin nao tem a rota (404) e, mesmo que a chamada chegasse ao banco, o aprovador seria recusado.
    const r = await pedir(opts, `/v1/admin/retention/approvals/${approvalRequestId}/votes`, { segredo: SEG('super') });
    expect(r.status).toBe(404);
    await expect(port.votar(approvalRequestId, 'super-1', T0)).rejects.toMatchObject({ code: 'aprovador_sem_permissao' });
  });
});

describe('hold: colocar imediato, liberar com aprovacao dupla (82 §5)', () => {
  const HOLD = { subjectType: 'user', subjectId: '11111111-2222-4333-8444-555555555555', reasonCode: 'litigio_1' };

  it('coloca, pede liberacao, exige aprovacao distinta e so depois libera', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    const colocado = await pedir(opts, '/v1/admin/retention/holds', { corpo: HOLD });
    expect(colocado.status).toBe(201);
    const { holdId } = colocado.corpo as { holdId: string };

    const pedido = await pedir(opts, `/v1/admin/retention/holds/${holdId}/release-requests`, {});
    expect(pedido.status).toBe(202);
    const { approvalRequestId } = pedido.corpo as { approvalRequestId: string };

    const semVoto = await pedir(opts, `/v1/admin/retention/holds/${holdId}/release`, {
      corpo: { approvalRequestId },
    });
    expect(semVoto).toEqual({ status: 409, corpo: { code: 'aprovacao_invalida' } });

    const autoVoto = await pedir(opts, `/v1/admin/retention/approvals/${approvalRequestId}/votes`, { segredo: SEG('gov1') });
    expect(autoVoto.status).toBe(403);
    await pedir(opts, `/v1/admin/retention/approvals/${approvalRequestId}/votes`, { segredo: SEG('gov2') });

    const liberado = await pedir(opts, `/v1/admin/retention/holds/${holdId}/release`, {
      corpo: { approvalRequestId },
    });
    expect(liberado).toEqual({ status: 200, corpo: { estado: 'liberado' } });
    expect(port.auditoria).toEqual([
      'retention.hold.placed',
      'retention.hold.release_requested',
      'retention.hold.released',
    ]);
  });

  it('corpo sem identificador de aprovacao valido = 400; hold sem campos = 400', async () => {
    const port = new CadastroEmMemoria();
    const opts = opcoes(port);
    expect((await pedir(opts, '/v1/admin/retention/holds', { corpo: { ...HOLD, reasonCode: 'Texto livre com espaco' } })).status).toBe(400);
    expect((await pedir(opts, '/v1/admin/retention/holds/hold-1/release', { corpo: { approvalRequestId: 'x' } })).status).toBe(400);
  });

  it('falha inesperada do cadastro = 503 sem detalhe', async () => {
    const port = new CadastroEmMemoria();
    port.colocarHold = async () => {
      throw new Error('postgres://senha-vazada');
    };
    const r = await pedir(opcoes(port), '/v1/admin/retention/holds', { corpo: HOLD });
    expect(r).toEqual({ status: 503, corpo: { code: 'retencao_indisponivel' } });
  });
});
