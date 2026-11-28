// Issue 120 (H-111) | Testes das rotas do DPO (147-DESENHO-H111 §5.2, §7: T-API-08 e T-API-16 na parte de contrato).
// Sem banco e sem rede: guarda e porta SQL falsas. Permissao vem do registro da guarda (como no banco).
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { AdminGuardRecord } from '@fastpro/domain';
import { handlePrivacyDpoRoute, isPrivacyDpoRoute, privacyDpoRoute, type PrivacyDpoRouteOptions } from './dpo-route.js';
import { DsrDpoErro, ServicoDsrDpo, traduzirErroDpo, type DsrDpoSql } from './dpo-service.js';

const BASE = 'https://admin.test';
const CASO = '22222222-2222-4222-8222-222222222222';
const ATOR = '33333333-3333-4333-8333-333333333333';
const TITULAR = '11111111-1111-4111-8111-111111111111';
const AGORA = Date.parse('2026-11-20T12:00:00Z');
const RESPONSAVEL = '44444444-4444-4444-8444-444444444444';

interface Resposta {
  status: number;
  corpo: unknown;
  vazio: boolean;
}

function erro(mensagem: string, detalhe?: string): Error {
  return Object.assign(new Error(mensagem), { detail: detalhe, code: 'P0001' });
}

function registro(permissoes: readonly string[], papeis: readonly string[] = ['dpo']): AdminGuardRecord {
  return { userId: ATOR, roles: papeis, permissions: permissoes, aal2: true, active: true, expiresAtMs: AGORA + 3_600_000, totpAtMs: AGORA };
}

const TODAS = ['dsr.read', 'dsr.decide', 'dsr.open_assisted'] as const;

function sqlFalso(sobrescrita: Partial<DsrDpoSql> = {}): DsrDpoSql & { chamadas: Record<string, unknown[]> } {
  const chamadas: Record<string, unknown[]> = {};
  const registrar = (nome: string, valor: unknown) => {
    chamadas[nome] = [...(chamadas[nome] ?? []), valor];
  };
  const base: DsrDpoSql = {
    async listar(...args) {
      registrar('listar', args);
      return [];
    },
    async obter(...args) {
      registrar('obter', args);
      return { case_id: CASO, status: 'aberto' };
    },
    async abrir(...args) {
      registrar('abrir', args);
      return { out_case_id: CASO, out_protocol: 'DSR-20261120-ABCDEF', out_status: 'em_analise', out_deadline_at: '2026-12-05T00:00:00Z' };
    },
    async atribuir(...args) {
      registrar('atribuir', args);
      return { out_case_id: CASO, out_status: 'em_analise', out_assigned_to: RESPONSAVEL };
    },
    async processar(...args) {
      registrar('processar', args);
      return { out_case_id: CASO, out_status: 'concluido', out_outcome: 'deferido' };
    },
    async recusar(...args) {
      registrar('recusar', args);
      return { out_case_id: CASO, out_status: 'indeferido_total', out_closed_at: '2026-11-20T12:00:00Z' };
    },
    ...sobrescrita,
  };
  return Object.assign(base, { chamadas });
}

function opcoes(sql: DsrDpoSql, permissoes: readonly string[] = TODAS, papeis?: readonly string[]): PrivacyDpoRouteOptions {
  return {
    guard: async () => registro(permissoes, papeis),
    service: new ServicoDsrDpo(sql),
    baseUrl: BASE,
    clock: { nowMs: () => AGORA },
  };
}

interface Opcoes {
  cookie?: boolean;
  origem?: string | null;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

async function chamar(metodo: string, url: string, op: PrivacyDpoRouteOptions, { cookie = true, origem = BASE, corpo, cabecalhos = {} }: Opcoes = {}): Promise<Resposta> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...cabecalhos };
  if (origem !== null) headers.origin = origem;
  if (cookie) headers.cookie = '__Host-fp_admin=segredo-sintetico-120';
  const texto = corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const req = Object.assign(Readable.from(texto === '' ? [] : [Buffer.from(texto, 'utf8')]), {
    method: metodo,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
  const resposta: Resposta = { status: 0, corpo: undefined, vazio: false };
  let escrito = false;
  const res = {
    headersSent: false,
    writeHead(status: number) {
      resposta.status = status;
    },
    end(conteudo?: string) {
      escrito = true;
      resposta.vazio = conteudo === undefined || conteudo === '';
      resposta.corpo = resposta.vazio ? undefined : JSON.parse(conteudo as string);
    },
  } as unknown as ServerResponse;
  await handlePrivacyDpoRoute(req, res, url.split('?')[0] ?? '', op);
  expect(escrito).toBe(true);
  return resposta;
}

const ABERTURA = { subject: TITULAR, kind: 'correcao', channel: 'dpo_externo' };

describe('caminhos e registro', () => {
  it('reconhece o prefixo do DPO e interpreta colecao, detalhe e acoes', () => {
    expect(isPrivacyDpoRoute('/v1/admin/privacy/dsr-cases')).toBe(true);
    expect(isPrivacyDpoRoute('/v1/admin/privacy/other')).toBe(false);
    expect(privacyDpoRoute('/v1/admin/privacy/dsr-cases')?.rota).toEqual({ acao: 'colecao' });
    expect(privacyDpoRoute(`/v1/admin/privacy/dsr-cases/${CASO}`)?.rota).toEqual({ acao: 'detalhe' });
    expect(privacyDpoRoute(`/v1/admin/privacy/dsr-cases/${CASO}/reject`)?.rota).toEqual({ acao: 'recusar' });
    expect(privacyDpoRoute('/v1/admin/privacy/dsr-cases/nao-e-uuid')).toBeNull();
    expect(privacyDpoRoute(`/v1/admin/privacy/dsr-cases/${CASO}/apagar`)).toBeNull();
  });

  it('traduz erros do banco para o contrato e nao vaza mensagem desconhecida', () => {
    expect(traduzirErroDpo(erro('dsr_em_andamento', 'DSR-1'))?.corpo).toEqual({ code: 'dsr_em_andamento', protocol: 'DSR-1' });
    expect(traduzirErroDpo(erro('permissao_negada'))?.status).toBe(403);
    expect(traduzirErroDpo(erro('conexao caiu em 10.0.0.5'))).toBeUndefined();
    expect(new DsrDpoErro(422, { code: 'x' }).status).toBe(422);
  });
});

describe('guarda do painel', () => {
  it('sem cookie ou sem sessao valida responde 404 vazio, sem tocar o banco', async () => {
    const sql = sqlFalso();
    const semCookie = await chamar('GET', '/v1/admin/privacy/dsr-cases', opcoes(sql), { cookie: false });
    expect(semCookie).toEqual({ status: 404, corpo: undefined, vazio: true });
    const semSessao = await chamar('GET', '/v1/admin/privacy/dsr-cases', { ...opcoes(sql), guard: async () => null });
    expect(semSessao.status).toBe(404);
    expect(sql.chamadas.listar).toBeUndefined();
  });

  it('papel sem a permissao da rota responde 403 e nao chama o banco (T-API-08)', async () => {
    const sql = sqlFalso();
    const r = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/process`, opcoes(sql, ['dsr.read'], ['suporte']));
    expect(r.status).toBe(403);
    expect(sql.chamadas.processar).toBeUndefined();
  });

  it('suporte le (dsr.read) mas nao decide: 403 em process', async () => {
    const sql = sqlFalso();
    const leitura = await chamar('GET', `/v1/admin/privacy/dsr-cases/${CASO}`, opcoes(sql, ['dsr.read'], ['suporte']));
    expect(leitura.status).toBe(200);
    const decisao = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/process`, opcoes(sql, ['dsr.read'], ['suporte']));
    expect(decisao.status).toBe(403);
  });
});

describe('mutacoes', () => {
  it('sem Origin igual a ADMIN_BASE_URL responde 403 antes do corpo e do banco', async () => {
    const sql = sqlFalso();
    const r = await chamar('POST', '/v1/admin/privacy/dsr-cases', opcoes(sql), { origem: 'https://outro.test', corpo: ABERTURA });
    expect(r.status).toBe(403);
    expect(sql.chamadas.abrir).toBeUndefined();
  });

  it('abertura assistida exige canal dpo_externo e corpo de chaves exatas (422)', async () => {
    const sql = sqlFalso();
    const canalErrado = await chamar('POST', '/v1/admin/privacy/dsr-cases', opcoes(sql), { corpo: { ...ABERTURA, channel: 'titular' } });
    expect(canalErrado).toEqual({ status: 422, corpo: { code: 'corpo_invalido' }, vazio: false });
    const chaveExtra = await chamar('POST', '/v1/admin/privacy/dsr-cases', opcoes(sql), { corpo: { ...ABERTURA, papel: 'dpo' } });
    expect(chaveExtra.status).toBe(422);
    expect(sql.chamadas.abrir).toBeUndefined();
  });

  it('abertura valida registra o operador da sessao e o canal (T-API-16)', async () => {
    const sql = sqlFalso();
    const r = await chamar('POST', '/v1/admin/privacy/dsr-cases', opcoes(sql), { corpo: ABERTURA });
    expect(r.status).toBe(201);
    expect(r.corpo).toEqual({ id: CASO, protocol: 'DSR-20261120-ABCDEF', status: 'em_analise', deadline_at: '2026-12-05T00:00:00Z' });
    const [actor, entrada] = (sql.chamadas.abrir ?? [])[0] as [string, { subject: string; channel: string }];
    expect(actor).toBe(ATOR);
    expect(entrada.subject).toBe(TITULAR);
    expect(entrada.channel).toBe('dpo_externo');
  });

  it('atribuir valida o responsavel e devolve o caso', async () => {
    const sql = sqlFalso();
    const invalido = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/assign`, opcoes(sql), { corpo: { assignee: 'x' } });
    expect(invalido.status).toBe(422);
    const ok = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/assign`, opcoes(sql), { corpo: { assignee: RESPONSAVEL } });
    expect(ok).toEqual({ status: 200, corpo: { id: CASO, status: 'em_analise', assigned_to: RESPONSAVEL }, vazio: false });
  });

  it('recusa exige nota; a funcao SQL recusa a falta de base legal com 422', async () => {
    const sql = sqlFalso({
      async recusar() {
        throw erro('nota_base_legal_obrigatoria');
      },
    });
    const semNota = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/reject`, opcoes(sql), { corpo: { outcome: 'indeferido_total' } });
    expect(semNota.status).toBe(422);
    const semBase = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/reject`, opcoes(sql), {
      corpo: { note: 'Retencao legal ativa.', outcome: 'indeferido_total' },
    });
    expect(semBase).toEqual({ status: 422, corpo: { code: 'nota_base_legal_obrigatoria' }, vazio: false });
  });

  it('process de caso de acesso fora do extrato responde 409 com codigo fixo', async () => {
    const sql = sqlFalso({
      async processar() {
        throw erro('dsr_acesso_usa_extrato');
      },
    });
    const r = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/process`, opcoes(sql));
    expect(r).toEqual({ status: 409, corpo: { code: 'dsr_acesso_usa_extrato' }, vazio: false });
  });

  it('caso inexistente vira 404 nao_encontrado e erro desconhecido vira 503 sem detalhe', async () => {
    const naoEncontrado = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/process`, opcoes(sqlFalso({
      async processar() {
        throw erro('dsr_nao_encontrado');
      },
    })));
    expect(naoEncontrado).toEqual({ status: 404, corpo: { code: 'not_found' }, vazio: false });
    const falha = await chamar('POST', `/v1/admin/privacy/dsr-cases/${CASO}/process`, opcoes(sqlFalso({
      async processar() {
        throw new Error('conexao caiu em 10.0.0.5 com senha de exemplo');
      },
    })));
    expect(falha).toEqual({ status: 503, corpo: { code: 'leitura_indisponivel' }, vazio: false });
  });
});

describe('leitura e lista', () => {
  it('lista tira o prefixo out_ e informa o cursor com a pagina cheia', async () => {
    const linha = (i: number) => ({
      out_case_id: `00000000-0000-4000-8000-00000000000${i}`,
      out_protocol: `DSR-20261120-AAAAA${i}`,
      out_kind: 'correcao',
      out_status: 'aberto',
      out_opened_at: `2026-11-2${i}T00:00:00Z`,
    });
    const sql = sqlFalso();
    sql.listar = async (...args) => {
      sql.chamadas.listar = [args];
      return [linha(1), linha(2)];
    };
    const r = await chamar('GET', '/v1/admin/privacy/dsr-cases?limit=2&status=aberto', opcoes(sql));
    expect(r.status).toBe(200);
    const corpo = r.corpo as { itens: Record<string, unknown>[]; proximo_cursor: { id: string } | null };
    expect(corpo.itens[0]).toEqual({ case_id: linha(1).out_case_id, protocol: 'DSR-20261120-AAAAA1', kind: 'correcao', status: 'aberto', opened_at: '2026-11-21T00:00:00Z' });
    expect(corpo.proximo_cursor?.id).toBe('00000000-0000-4000-8000-000000000002');
    expect((sql.chamadas.listar?.[0] as [string, { status: string }])[1].status).toBe('aberto');
  });

  it('paginacao invalida responde 422 e detalhe devolve o caso sem alteracao', async () => {
    const sql = sqlFalso();
    expect((await chamar('GET', '/v1/admin/privacy/dsr-cases?limit=0', opcoes(sql))).status).toBe(422);
    expect((await chamar('GET', '/v1/admin/privacy/dsr-cases?cursor_id=' + CASO, opcoes(sql))).status).toBe(422);
    const detalhe = await chamar('GET', `/v1/admin/privacy/dsr-cases/${CASO}`, opcoes(sql));
    expect(detalhe).toEqual({ status: 200, corpo: { case_id: CASO, status: 'aberto' }, vazio: false });
  });
});
