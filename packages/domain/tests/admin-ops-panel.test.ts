// H-108 (Issue 117) | Painel operacional minimo (docs/factory/76-DESENHO-H108.md §4).
// T-H108-01 tela e menu por papel; T-H108-02 guarda do handler (404 identico, 403 sem permissao, 200);
// T-H108-03 mapa papel x permissao e registro (so GET, so superadmin); T-H108-04 percentual, alerta,
// sem_dados e null. Logica pura: sem banco, sem rede. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_NOT_FOUND,
  ADMIN_OPS_PANEL_PATH,
  ADMIN_PERMISSION_DENIED,
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROUTES,
  adminPermissionsOf,
  consoleMenuFor,
  handleOpsPanel,
  montarPainelOps,
  resolveAdminRoute,
  type AdminGuardRecord,
  type OpsPanelLeitura,
} from '../src/admin/index.js';
import { SYNTH_NOW } from './admin-fakes.js';

function linha(papeis: readonly string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: 'u-teste',
    roles: papeis,
    permissions: [...adminPermissionsOf(papeis)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: SYNTH_NOW + 3600_000,
    totpAtMs: SYNTH_NOW,
    ...extra,
  };
}

const VAZIA: OpsPanelLeitura = {
  fila: { por_estado: {}, idade_pendente_s: null, falhas_por_codigo: {} },
  cotas: [],
  metricas: [],
};

function corpo(leitura: OpsPanelLeitura = VAZIA): Record<string, any> {
  const out = handleOpsPanel({ row: linha(['superadmin']), leitura }, SYNTH_NOW);
  expect(out.status).toBe(200);
  return out.body as Record<string, any>;
}

describe('T-H108-01 tela operacao no catalogo do console (CA-H108-01, 02, 15)', () => {
  it('Superadmin ve a tela operacao, com o caminho do console', () => {
    const menu = consoleMenuFor(adminPermissionsOf(['superadmin']), ADMIN_ROUTES);
    expect(menu.find((t) => t.id === 'operacao')).toEqual({
      id: 'operacao',
      rotulo: 'Painel operacional',
      caminho: '/console/operacao',
    });
  });

  it('os outros cinco papeis nao veem a tela operacao', () => {
    for (const papel of ['verificacao', 'moderador', 'financeiro', 'suporte', 'auditor']) {
      const menu = consoleMenuFor(adminPermissionsOf([papel]), ADMIN_ROUTES);
      expect(menu.map((t) => t.id), papel).not.toContain('operacao');
    }
  });

  it('sem a rota do painel no registro, nem o Superadmin ve a tela', () => {
    const semPainel = ADMIN_ROUTES.filter((r) => r.pattern !== ADMIN_OPS_PANEL_PATH);
    const menu = consoleMenuFor(adminPermissionsOf(['superadmin']), semPainel);
    expect(menu.map((t) => t.id)).not.toContain('operacao');
  });
});

describe('T-H108-02 guarda do painel (CA-H108-02, 03)', () => {
  it('sem linha, sem aal2, sessao vencida, conta inativa ou sem papel: 404 identico ao de rota inexistente', () => {
    const casos: (AdminGuardRecord | null)[] = [
      null,
      linha(['superadmin'], { aal2: false }),
      linha(['superadmin'], { expiresAtMs: SYNTH_NOW - 1 }),
      linha(['superadmin'], { active: false }),
      linha([]),
    ];
    for (const row of casos) {
      const out = handleOpsPanel({ row, leitura: VAZIA }, SYNTH_NOW);
      expect(out).toEqual(ADMIN_NOT_FOUND);
    }
  });

  it('papel sem ops.panel.read recebe 403 permission_denied e nenhum dado', () => {
    for (const papel of ['auditor', 'suporte', 'verificacao']) {
      const out = handleOpsPanel({ row: linha([papel]), leitura: VAZIA }, SYNTH_NOW);
      expect(out, papel).toEqual(ADMIN_PERMISSION_DENIED);
    }
  });

  it('Superadmin recebe 200 com o painel', () => {
    const out = handleOpsPanel({ row: linha(['superadmin']), leitura: VAZIA }, SYNTH_NOW);
    expect(out.status).toBe(200);
    expect(out.headers['Cache-Control']).toBe('no-store');
  });
});

describe('T-H108-03 mapa e registro da permissao (CA-H108-04, R-6)', () => {
  it('o unico papel com ops.panel.read e superadmin', () => {
    const papeis = ADMIN_ROLES.filter((p) => ADMIN_ROLE_PERMISSIONS[p].includes('ops.panel.read'));
    expect(papeis).toEqual(['superadmin']);
  });

  it('a rota do painel so tem GET; POST, PUT, PATCH e DELETE nao existem (404)', () => {
    expect(resolveAdminRoute(ADMIN_ROUTES, 'GET', ADMIN_OPS_PANEL_PATH)?.permission).toBe('ops.panel.read');
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(resolveAdminRoute(ADMIN_ROUTES, metodo, ADMIN_OPS_PANEL_PATH), metodo).toBeNull();
    }
  });
});

describe('T-H108-04 cotas em percentual, alerta e sem dados (CA-H108-07, 08, 10)', () => {
  function cota(servico: string, periodo: string, usado: number, limite: number, alerta: number) {
    return { servico, periodo, usado, limite, alerta, alertado_em: null };
  }
  const achar = (cotas: readonly Record<string, any>[], servico: string, periodo: string) =>
    cotas.find((c) => c.servico === servico && c.periodo === periodo);

  it('e-mail diario 70/100 mostra 70% e alerta 1; 85/100 mostra 85% e alerta 2', () => {
    const a = achar(corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 70, 100, 1)] }).cotas, 'email', 'dia_utc');
    expect(a).toMatchObject({ usado: 70, limite: 100, percentual: 70, alerta: 1 });
    const b = achar(corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 85, 100, 2)] }).cotas, 'email', 'dia_utc');
    expect(b).toMatchObject({ percentual: 85, alerta: 2 });
  });

  it('e-mail mensal 2.100 e 2.550 de 3.000: 70% e 85%, com os alertas 1 e 2', () => {
    const cotas = corpo({
      ...VAZIA,
      cotas: [cota('email', 'mes', 2100, 3000, 1), cota('email', 'dia_utc', 2550, 3000, 2)],
    }).cotas;
    expect(achar(cotas, 'email', 'mes')).toMatchObject({ percentual: 70, alerta: 1 });
    expect(achar(cotas, 'email', 'dia_utc')).toMatchObject({ percentual: 85, alerta: 2 });
  });

  it('e-mail em 86/100 nunca mostra alerta 3, mesmo se a linha gravar 3 (CA-H108-08)', () => {
    const a = achar(corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 86, 100, 2)] }).cotas, 'email', 'dia_utc');
    expect(a).toMatchObject({ percentual: 86, alerta: 2 });
    const b = achar(corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 95, 100, 3)] }).cotas, 'email', 'dia_utc');
    expect(b).toMatchObject({ alerta: 2 });
  });

  it('percentual arredonda para baixo: 69/100 mostra 69% e ainda sem alerta 1', () => {
    const a = achar(corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 69, 100, 0)] }).cotas, 'email', 'dia_utc');
    expect(a).toMatchObject({ percentual: 69, alerta: 0 });
  });

  it('servico sem linha no periodo aparece como sem_dados, nunca como zero (CA-H108-10)', () => {
    const cotas = corpo({ ...VAZIA, cotas: [cota('email', 'dia_utc', 10, 100, 0)] }).cotas;
    const mes = achar(cotas, 'email', 'mes');
    expect(mes).toEqual({ servico: 'email', periodo: 'mes', sem_dados: true });
    expect(achar(cotas, 'mapbox_permanent', 'mes')).toEqual({
      servico: 'mapbox_permanent',
      periodo: 'mes',
      sem_dados: true,
    });
  });

  it('storage e banco nao aparecem (sem escritor, CA-H108-15)', () => {
    const cotas = corpo().cotas as Record<string, any>[];
    expect(cotas.map((c) => c.servico)).not.toContain('storage');
    expect(cotas.map((c) => c.servico)).not.toContain('banco');
  });

  it('fila vazia: zeros em todos os estados e idade nula (CA-H108-06)', () => {
    const fila = corpo().fila_email;
    expect(Object.values(fila.por_estado)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(fila.idade_pendente_s).toBeNull();
    expect(fila.falhas_por_codigo).toEqual({});
  });

  it('fila com dados: contagem por estado, idade do pendente e falhas por codigo', () => {
    const fila = corpo({
      ...VAZIA,
      fila: {
        por_estado: { pendente: 3, enviado: 10, falha: 2 },
        idade_pendente_s: 120,
        falhas_por_codigo: { smtp_timeout: 2 },
      },
    }).fila_email;
    expect(fila.por_estado).toMatchObject({ pendente: 3, enviado: 10, falha: 2, descartado: 0 });
    expect(fila.idade_pendente_s).toBe(120);
    expect(fila.falhas_por_codigo).toEqual({ smtp_timeout: 2 });
  });

  it('webhooks, fotos e RLS sao null sem nenhum ponto gravado (cada bloco so aparece com dado)', () => {
    const b = corpo();
    expect(b.webhooks).toBeNull();
    expect(b.fotos).toBeNull();
    expect(b.rls).toBeNull();
  });

  it('webhooks com pontos: falhas somadas, latencia com media arredondada e maximo', () => {
    const b = corpo({
      ...VAZIA,
      metricas: [
        { chave: 'webhook_falha', dimensao: '', n: 2, soma_ms: null, max_ms: null },
        { chave: 'webhook_latencia', dimensao: '', n: 3, soma_ms: 1000, max_ms: 600 },
        { chave: 'webhook_latencia', dimensao: '', n: 1, soma_ms: 200, max_ms: 900 },
      ],
    });
    expect(b.webhooks).toEqual({
      falhas: 2,
      latencia: { n: 4, media_ms: 300, max_ms: 900 },
      idade_pendente_s: null,
    });
  });

  it('fotos e RLS com pontos: contagem por tipo de falha e negacoes', () => {
    const b = corpo({
      ...VAZIA,
      metricas: [
        { chave: 'foto_upload_falha', dimensao: 'heic_invalido', n: 4, soma_ms: null, max_ms: null },
        { chave: 'foto_reencode_falha', dimensao: 'timeout', n: 1, soma_ms: null, max_ms: null },
        { chave: 'rls_negacao', dimensao: '', n: 7, soma_ms: null, max_ms: null },
      ],
    });
    expect(b.fotos).toEqual({
      falhas_upload_por_tipo: { heic_invalido: 4 },
      falhas_reencode_por_tipo: { timeout: 1 },
    });
    expect(b.rls).toEqual({ negacoes: 7 });
  });

  it('dimensao: ate 40 caracteres (1 inicial + 39, igual a migracao); 41 ou mais, ou fora do padrao, nao sai', () => {
    const dentro = 'a'.repeat(40);
    const fora = 'a'.repeat(41);
    const b = corpo({
      ...VAZIA,
      metricas: [
        { chave: 'foto_upload_falha', dimensao: dentro, n: 2, soma_ms: null, max_ms: null },
        { chave: 'foto_upload_falha', dimensao: fora, n: 5, soma_ms: null, max_ms: null },
        { chave: 'foto_upload_falha', dimensao: 'Com_Maiuscula', n: 3, soma_ms: null, max_ms: null },
      ],
    });
    expect(b.fotos?.falhas_upload_por_tipo).toEqual({ [dentro]: 2 });
  });

  it('codigo de motivo da fila aceita ate 60 caracteres (limite de reason_code, nao o da dimensao)', () => {
    const codigo60 = 'b'.repeat(60);
    const b = corpo({
      ...VAZIA,
      fila: { por_estado: { falha: 1 }, idade_pendente_s: null, falhas_por_codigo: { [codigo60]: 1 } },
    });
    expect(b.fila_email.falhas_por_codigo).toEqual({ [codigo60]: 1 });
  });

  it('leitura malformada (valor negativo ou texto onde cabe numero) lanca erro, nunca vira zero', () => {
    expect(() =>
      montarPainelOps({ ...VAZIA, metricas: [{ chave: 'rls_negacao', dimensao: '', n: -1, soma_ms: null, max_ms: null }] }, SYNTH_NOW),
    ).toThrow();
    expect(() =>
      montarPainelOps(
        { ...VAZIA, fila: { por_estado: { pendente: 'x' as unknown as number }, idade_pendente_s: null, falhas_por_codigo: {} } },
        SYNTH_NOW,
      ),
    ).toThrow();
  });

  it('resposta fechada: campo fora do contrato da leitura nunca sai (CA-H108-14)', () => {
    const leitura = {
      ...VAZIA,
      fila: { por_estado: { falha: 1 }, idade_pendente_s: null, falhas_por_codigo: {} },
      ultimo_erro: 'destinatario@exemplo.test',
      destinatario: 'pessoa@exemplo.test',
    } as unknown as OpsPanelLeitura;
    const texto = JSON.stringify(corpo(leitura));
    expect(texto).not.toMatch(/exemplo\.test|destinatario|ultimo_erro/);
    expect(Object.keys(corpo(leitura)).sort()).toEqual(
      ['cotas', 'fila_email', 'fotos', 'gerado_em', 'rls', 'webhooks'].sort(),
    );
  });
});
