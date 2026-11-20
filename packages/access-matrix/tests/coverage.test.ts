// H-115 (Issue 124), fatia F5: guarda de cobertura por titulo (docs/factory/164-DESENHO-H115.md, §5.4).
// Le, por caminho relativo ao repositorio, os testes das tres camadas e confere que todo caso ATIVO da matriz tem um
// teste com o seu [CP-xx] em cada camada declarada (api, db, catalog), ou uma pendencia registrada aqui com o motivo.
// Tambem falha se algum id citado nos testes nao existir na matriz, ou se uma pendencia ja estiver coberta.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCESS_MATRIX, type AccessLayer } from '../src/index.js';

const ARQUIVOS: Record<'api' | 'db' | 'catalog', string> = {
  api: 'apps/api/tests/authorization-matrix.test.ts',
  db: 'packages/db/tests/authorization-parity.dbtest.mjs',
  catalog: 'packages/db/tests/authorization-catalog.dbtest.mjs',
};

/**
 * Pendencias explicitas: caso ativo sem teste ainda, por camada. Cada item precisa de motivo e sai da lista quando o
 * teste existir (a guarda falha se a pendencia ja estiver coberta). Nao e' permissao para pular: e' divida registrada.
 */
const PENDENCIAS: ReadonlyMap<string, string> = new Map([
  ['CP-16:db', 'foto para profissional elegivel: exige fixture de midia (private.media_get)'],
  ['CP-17:db', 'visitante e foto: exige fixture de midia (a parte de catalogo, CAT-07, ja esta coberta)'],
  ['CP-18:db', 'documento de identidade do proprio profissional: exige caso de verificacao; assinatura de private.idoc_review_target a mapear'],
  ['CP-19:db', 'verificador com tarefa atribuida: exige caso de verificacao e sessao admin'],
  ['CP-20:db', 'admin financeiro sem permissao de verificacao: exige sessao admin; SQLSTATE P0001 nao verificado'],
  ['CP-21:api', 'verificacao admin sem MFA: exige o harness da guarda admin (cookie e aal) em admin-verification-route'],
  ['CP-21:db', 'private.admin_guard com aal1: exige sessao admin no banco'],
  ['CP-22:api', 'dupla aprovacao de estorno (rota de aprovacoes): harness nao montado'],
  ['CP-22:db', 'private.approval_dual_vote: exige sessao admin e estorno pendente; SQLSTATE nao verificado'],
  ['CP-23:api', 'auditoria admin (POST /v1/admin/audit/query): harness de handleAdminAuditQuery nao montado'],
  ['CP-23:db', 'private.audit_query: exige sessao de auditor'],
  ['CP-27:db', 'verificador sem caso aberto: exige sessao admin e caso de verificacao'],
  ['CP-28:db', 'area de outro profissional: private.professional_area_get le so o proprio principal; caso a redefinir'],
]);

const raiz = (rel: string): string => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

function idsCitados(texto: string): string[] {
  return [...texto.matchAll(/\[(CP-\d{2})\]/g)].map((m) => m[1] ?? '');
}

const citadosPorCamada: Record<'api' | 'db' | 'catalog', ReadonlySet<string>> = {
  api: new Set(idsCitados(readFileSync(raiz(ARQUIVOS.api), 'utf8'))),
  db: new Set(idsCitados(readFileSync(raiz(ARQUIVOS.db), 'utf8'))),
  catalog: new Set(idsCitados(readFileSync(raiz(ARQUIVOS.catalog), 'utf8'))),
};

const ativos = ACCESS_MATRIX.filter((c) => c.status === 'active');
const idsMatriz = new Set(ACCESS_MATRIX.map((c) => c.id));

describe('H-115 F5: guarda de cobertura por titulo', () => {
  it('todo caso ativo tem teste em cada camada declarada, ou pendencia registrada com motivo', () => {
    const faltando: string[] = [];
    for (const c of ativos) {
      for (const camada of c.layers as AccessLayer[]) {
        if (camada === 'api' || camada === 'db' || camada === 'catalog') {
          if (citadosPorCamada[camada].has(c.id)) continue;
          if (PENDENCIAS.has(`${c.id}:${camada}`)) continue;
          faltando.push(`${c.id}:${camada}`);
        }
      }
    }
    expect(faltando, 'casos ativos sem teste nem pendencia registrada').toEqual([]);
  });

  it('nenhum id citado nos testes fica fora da matriz', () => {
    const desconhecidos = [...citadosPorCamada.api, ...citadosPorCamada.db, ...citadosPorCamada.catalog].filter(
      (id) => !idsMatriz.has(id),
    );
    expect([...new Set(desconhecidos)], 'ids citados que a matriz nao tem').toEqual([]);
  });

  it('pendencia so existe para caso ativo e camada declarada, e nao pode estar coberta', () => {
    const invalidas: string[] = [];
    for (const chave of PENDENCIAS.keys()) {
      const [id, camada] = chave.split(':') as [string, 'api' | 'db' | 'catalog'];
      const caso = ativos.find((c) => c.id === id);
      if (caso === undefined || !(caso.layers as string[]).includes(camada)) invalidas.push(`${chave}: nao e caso ativo com essa camada`);
      if (citadosPorCamada[camada]?.has(id)) invalidas.push(`${chave}: ja coberta, remover da lista`);
    }
    expect(invalidas).toEqual([]);
  });

  it('resumo de cobertura por camada (linha H115 PARIDADE)', () => {
    const pendentes = [...PENDENCIAS.keys()].sort();
    const cobertos = ativos.filter((c) => (c.layers as string[]).every((l) => l === 'api' || l === 'db' || l === 'catalog')).length;
    console.log(
      `H115 PARIDADE camada=cobertura ativos=${ativos.length} casos_com_todas_camadas=${cobertos} pendencias=${pendentes.length} [${pendentes.join(',')}]`,
    );
    expect(ativos.length).toBeGreaterThan(0);
  });
});
