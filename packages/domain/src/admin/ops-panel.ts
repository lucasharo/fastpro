// H-108 (Issue 117) | Painel operacional minimo (docs/factory/76-DESENHO-H108.md §1 a §3; 73-REFINO-H108.md).
// Logica pura: monta a resposta a partir do agregado que o banco devolve (private.ops_panel_read, migracao
// 20261111430000). So contadores e percentuais inteiros: nunca linha bruta, identificador ou texto livre.
// Ausencia de dado nunca vira zero: bloco sem fonte = null; servico sem linha = sem_dados (CA-H108-10).
// Leitura malformada lanca erro (a rota responde 503 sem detalhe), em vez de inventar um valor.

import { decideAdminGuard } from './guard.js';
import type { AdminGuardRecord } from './ports.js';
import { ADMIN_NOT_FOUND, adminReply, type AdminResponse } from './responses.js';
import type { AdminPermission } from './roles.js';

/** Permissao do painel: concedida so ao Superadmin (Q-D108-2; migracao 20261111430000). */
export const OPS_PANEL_PERMISSION: AdminPermission = 'ops.panel.read';

/** Estados da fila de e-mail (ops.email_outbox.state). Todos aparecem na resposta, mesmo com zero. */
export const EMAIL_ESTADOS = [
  'pendente',
  'enviando',
  'enviado',
  'falha',
  'suprimido',
  'adiado_cota',
  'descartado',
] as const;
export type EmailEstado = (typeof EMAIL_ESTADOS)[number];

/**
 * Cotas mostradas no painel (59 §2.4; Q-H108-3 (a)). Storage e banco nao entram: ainda sem escritor.
 * Servico sem linha no periodo = sem_dados, nunca zero (CA-H108-10).
 */
export const OPS_COTAS_CATALOGO: readonly { readonly servico: string; readonly periodos: readonly string[] }[] = [
  { servico: 'email', periodos: ['dia_utc', 'mes'] },
  { servico: 'mapbox_permanent', periodos: ['mes'] },
  { servico: 'mapbox_geocoding_temp', periodos: ['mes'] },
];

const ALERTA_MAXIMO_EMAIL = 2; // 59 §2.4: e-mail nao tem alerta de 95% (CA-H108-08).
const ALERTA_MAXIMO_GRAVADO = 3;
/** Codigo de motivo (ops.email_outbox.reason_code, migracao 20261111120000: ate 60 caracteres). */
const CODIGO = /^[a-z][a-z0-9_]{0,59}$/;
/** Dimensao de ops.ops_metric (migracao 20261111430000 e 76 §1.2: ate 40 caracteres, nunca identificador). */
const DIMENSAO = /^[a-z][a-z0-9_]{0,39}$/;
const SEM_TIPO = 'sem_tipo';

/** Leitura do banco (JSON de private.ops_panel_read). Nomes em snake_case, como no contrato. */
export interface OpsPanelCotaLinha {
  readonly servico: string;
  readonly periodo: string;
  readonly usado: number;
  readonly limite: number;
  readonly alerta: number;
  readonly alertado_em: string | null;
}

export interface OpsPanelMetricaLinha {
  readonly chave: string;
  readonly dimensao: string;
  readonly n: number;
  readonly soma_ms: number | null;
  readonly max_ms: number | null;
}

export interface OpsPanelLeitura {
  readonly fila: {
    readonly por_estado: Readonly<Record<string, number>>;
    readonly idade_pendente_s: number | null;
    readonly falhas_por_codigo: Readonly<Record<string, number>>;
  };
  readonly cotas: readonly OpsPanelCotaLinha[];
  readonly metricas: readonly OpsPanelMetricaLinha[];
}

export type OpsPanelCota =
  | { readonly servico: string; readonly periodo: string; readonly sem_dados: true }
  | {
      readonly servico: string;
      readonly periodo: string;
      readonly usado: number;
      readonly limite: number;
      readonly percentual: number;
      readonly alerta: number;
      readonly alertado_em: string | null;
    };

/** Resposta 200 de GET /v1/admin/ops/panel. Forma fechada: nada alem destes campos sai do dominio. */
export type OpsPanelBody = {
  readonly gerado_em: string;
  readonly fila_email: {
    readonly por_estado: Readonly<Record<EmailEstado, number>>;
    readonly idade_pendente_s: number | null;
    readonly falhas_por_codigo: Readonly<Record<string, number>>;
  };
  readonly cotas: readonly OpsPanelCota[];
  readonly webhooks: {
    readonly falhas: number;
    readonly latencia: { readonly n: number; readonly media_ms: number | null; readonly max_ms: number | null };
    readonly idade_pendente_s: number | null;
  } | null;
  readonly fotos: {
    readonly falhas_upload_por_tipo: Readonly<Record<string, number>>;
    readonly falhas_reencode_por_tipo: Readonly<Record<string, number>>;
  } | null;
  readonly rls: { readonly negacoes: number } | null;
};

const ERRO_LEITURA = 'painel_leitura_invalida';

function inteiro(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0) {
    throw new Error(ERRO_LEITURA);
  }
  return valor;
}

function inteiroOuNulo(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : inteiro(valor);
}

function instanteOuNulo(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return valor;
  throw new Error(ERRO_LEITURA);
}

/** Percentual inteiro, arredondado para baixo: 69,9% vira 69 e so 70% em diante aciona o alerta 1. */
export function percentualDeUso(usado: number, limite: number): number {
  return Math.floor((usado * 100) / limite);
}

function filaDoPainel(fila: OpsPanelLeitura['fila']): OpsPanelBody['fila_email'] {
  const porEstado = {} as Record<EmailEstado, number>;
  // Estado ausente na leitura = zero linhas no group by do banco; valor de tipo errado lanca erro.
  for (const estado of EMAIL_ESTADOS) porEstado[estado] = inteiro(fila.por_estado[estado] ?? 0);
  const falhas: Record<string, number> = {};
  for (const [codigo, n] of Object.entries(fila.falhas_por_codigo)) {
    if (CODIGO.test(codigo)) falhas[codigo] = inteiro(n);
  }
  return {
    por_estado: porEstado,
    idade_pendente_s: inteiroOuNulo(fila.idade_pendente_s),
    falhas_por_codigo: falhas,
  };
}

function cotasDoPainel(cotas: readonly OpsPanelCotaLinha[]): OpsPanelCota[] {
  const out: OpsPanelCota[] = [];
  for (const { servico, periodos } of OPS_COTAS_CATALOGO) {
    for (const periodo of periodos) {
      const linha = cotas.find((c) => c.servico === servico && c.periodo === periodo);
      if (linha === undefined) {
        out.push({ servico, periodo, sem_dados: true });
        continue;
      }
      const usado = inteiro(linha.usado);
      const limite = inteiro(linha.limite);
      const alerta = inteiro(linha.alerta);
      if (limite < 1 || alerta > ALERTA_MAXIMO_GRAVADO) throw new Error(ERRO_LEITURA);
      out.push({
        servico,
        periodo,
        usado,
        limite,
        percentual: percentualDeUso(usado, limite),
        alerta: servico === 'email' ? Math.min(alerta, ALERTA_MAXIMO_EMAIL) : alerta,
        alertado_em: instanteOuNulo(linha.alertado_em),
      });
    }
  }
  return out;
}

interface MetricaValidada {
  readonly chave: string;
  readonly dimensao: string;
  readonly n: number;
  readonly soma_ms: number | null;
  readonly max_ms: number | null;
}

function metricasValidas(metricas: readonly OpsPanelMetricaLinha[]): MetricaValidada[] {
  return metricas.map((m) => ({
    chave: String(m.chave),
    dimensao: String(m.dimensao),
    n: inteiro(m.n),
    soma_ms: inteiroOuNulo(m.soma_ms),
    max_ms: inteiroOuNulo(m.max_ms),
  }));
}

function somaN(linhas: readonly MetricaValidada[]): number {
  return linhas.reduce((total, m) => total + m.n, 0);
}

function somaMs(linhas: readonly MetricaValidada[]): number | null {
  const valores = linhas.map((m) => m.soma_ms).filter((v): v is number => v !== null);
  return valores.length === 0 ? null : valores.reduce((total, v) => total + v, 0);
}

function maiorMs(linhas: readonly MetricaValidada[]): number | null {
  const valores = linhas.map((m) => m.max_ms).filter((v): v is number => v !== null);
  return valores.length === 0 ? null : Math.max(...valores);
}

/** Contagem por tipo de falha. Dimensao vazia vira 'sem_tipo'; dimensao fora do padrao (DIMENSAO) nao sai. */
function porTipo(linhas: readonly MetricaValidada[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of linhas) {
    if (m.dimensao !== '' && !DIMENSAO.test(m.dimensao)) continue;
    const tipo = m.dimensao === '' ? SEM_TIPO : m.dimensao;
    out[tipo] = (out[tipo] ?? 0) + m.n;
  }
  return out;
}

/**
 * Webhooks: null enquanto nenhuma das tres chaves tiver ponto gravado (76 §2). A idade do evento mais
 * antigo sem processar esta em segundos e e gravada em max_ms (convencao registrada na migracao 20261111430000).
 */
function webhooksDoPainel(ms: readonly MetricaValidada[]): OpsPanelBody['webhooks'] {
  const falhas = ms.filter((m) => m.chave === 'webhook_falha');
  const latencia = ms.filter((m) => m.chave === 'webhook_latencia');
  const idade = ms.filter((m) => m.chave === 'webhook_pendente_idade');
  if (falhas.length + latencia.length + idade.length === 0) return null;
  const n = somaN(latencia);
  const total = somaMs(latencia);
  return {
    falhas: somaN(falhas),
    latencia: {
      n,
      media_ms: n > 0 && total !== null ? Math.round(total / n) : null,
      max_ms: maiorMs(latencia),
    },
    idade_pendente_s: maiorMs(idade),
  };
}

function fotosDoPainel(ms: readonly MetricaValidada[]): OpsPanelBody['fotos'] {
  const upload = ms.filter((m) => m.chave === 'foto_upload_falha');
  const reencode = ms.filter((m) => m.chave === 'foto_reencode_falha');
  if (upload.length + reencode.length === 0) return null;
  return { falhas_upload_por_tipo: porTipo(upload), falhas_reencode_por_tipo: porTipo(reencode) };
}

function rlsDoPainel(ms: readonly MetricaValidada[]): OpsPanelBody['rls'] {
  const negacoes = ms.filter((m) => m.chave === 'rls_negacao');
  return negacoes.length === 0 ? null : { negacoes: somaN(negacoes) };
}

/** Monta a resposta do painel. Campos fora do contrato da leitura sao ignorados (nunca saem). */
export function montarPainelOps(leitura: OpsPanelLeitura, nowMs: number): OpsPanelBody {
  const ms = metricasValidas(leitura.metricas);
  return {
    gerado_em: new Date(nowMs).toISOString(),
    fila_email: filaDoPainel(leitura.fila),
    cotas: cotasDoPainel(leitura.cotas),
    webhooks: webhooksDoPainel(ms),
    fotos: fotosDoPainel(ms),
    rls: rlsDoPainel(ms),
  };
}

/**
 * Guarda do painel: null = autorizado. Sem sessao, aal2, papel ou com sessao vencida = 404 identico;
 * com papel mas sem ops.panel.read = 403 (decideAdminGuard). A leitura agregada so acontece depois disto.
 */
export function opsPanelNegado(row: AdminGuardRecord | null, nowMs: number): AdminResponse | null {
  const decisao = decideAdminGuard(row, OPS_PANEL_PERMISSION, nowMs);
  if (decisao.kind === 'autorizada') return null;
  return decisao.kind === 'recusada' ? decisao.response : ADMIN_NOT_FOUND;
}

export interface OpsPanelInput {
  /** Linha que o banco devolveu na guarda (nulo = sem sessao valida). */
  readonly row: AdminGuardRecord | null;
  /** Agregado ja lido do banco; so e usado quando a conta esta autorizada. */
  readonly leitura: OpsPanelLeitura;
}

/** GET /v1/admin/ops/panel (76 §2). 200 com o painel; senao, a negacao da guarda. Sem cache. */
export function handleOpsPanel(input: OpsPanelInput, nowMs: number): AdminResponse {
  const negado = opsPanelNegado(input.row, nowMs);
  if (negado !== null) return negado;
  return adminReply(200, montarPainelOps(input.leitura, nowMs));
}
