// Batimento R-MP: Mercado Pago x livro (H-114, Issue #123, fatia S6; desenho 165 §4.6 e §5 CA-11/CA-12).
// Funcao pura: recebe pagamentos do gateway, linhas do livro, precos vigentes e o instante `agora`
// (injetado; sem relogio global). Devolve achados mascarados. NUNCA escreve nas tabelas do livro de
// cobranca e NUNCA altera a entrada (RN-H114-04, 08 §8.8). Toda acao corretiva e humana (Financeiro, #60 a #66).
// Sem I/O, sem rede e sem credenciais. Contrato sem persistencia (persistencia futura: #66).
import { redactForRunbook } from './runbook-h114.mjs';

/** Tolerancia do batimento (A-10, decisao 717 a): ignora pagamentos aprovados nas ultimas 2 h. */
export const TOLERANCIA_RMP_MS = 2 * 60 * 60 * 1000;

/** Tipos de achado (desenho §4.6). */
export const TIPOS_ACHADO_RMP = Object.freeze([
  'T1_faltando_local',
  'T2_concessao_sem_pagamento',
  'T3_valor_divergente',
  'T4_recorrencia_divergente',
]);

// Estados do gateway que invalidam uma concessao paga (estorno, contestacao ou rejeicao).
const ESTADOS_GATEWAY_INVALIDOS = new Set(['refunded', 'charged_back', 'rejected']);

/** Identificador externo mascarado: `***` + 4 ultimos caracteres (nunca o valor inteiro). */
export function mascararIdExterno(id) {
  if (typeof id !== 'string' || id.length === 0) return '(sem identificador)';
  return `***${id.slice(-4)}`;
}

function instante(iso, rotulo) {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) throw new TypeError(`instante invalido em ${rotulo}`);
  return t;
}

/** Preco vigente do plano no instante informado (tabela de precos, recebida como dados). */
function precoVigente(precos, planCode, t) {
  let melhor = null;
  for (const p of precos) {
    if (p.planCode !== planCode) continue;
    const de = Date.parse(p.validoDe);
    const ate = p.validoAte ? Date.parse(p.validoAte) : Number.POSITIVE_INFINITY;
    if (t >= de && t < ate && (melhor === null || de > melhor.de)) {
      melhor = { de, valor: p.amountCents };
    }
  }
  return melhor === null ? null : melhor.valor;
}

/**
 * Batimento R-MP. Regras (desenho §4.6):
 *  1. Pagamento aprovado ha menos de 2 h (e concessao recente) fica fora do batimento.
 *  2. T1: aprovado no gateway e ausente no livro.
 *  3. T2: concessao `paid` sem pagamento aprovado no gateway, ou com estorno/contestacao/rejeicao.
 *  4. T3: valor divergente. Entre gateway e livro no mesmo identificador; ou gateway diferente do
 *     preco vigente em `precos` na data da aprovacao (quando o plano tem preco cadastrado).
 *  5. T4: recorrencia cancelada de um lado e ativa do outro (gateway `cancelled` x livro sem
 *     cancelamento, ou gateway `approved` x livro cancelado ate `agora`).
 *  6. Devolve achados e nunca altera a entrada.
 *
 * @param {object} entrada
 * @param {string} entrada.agora                              ISO 8601 UTC, instante da execucao.
 * @param {Array<object>} entrada.pagamentos                  GatewayPayment (desenho §4.6).
 * @param {Array<object>} entrada.livro                       LedgerEntry (desenho §4.6).
 * @param {Array<object>} [entrada.precos]                    {planCode, amountCents, validoDe, validoAte|null}.
 * @returns {{janela: object, contagens: Record<string, number>, achados: Array<object>}}
 */
export function reconciliarMercadoPagoComLivro({ agora, pagamentos, livro, precos = [] }) {
  const tAgora = instante(agora, 'agora');
  const limite = tAgora - TOLERANCIA_RMP_MS;
  const lancamentoPorExterno = new Map();
  for (const l of livro) {
    if (l.externalId) lancamentoPorExterno.set(l.externalId, l);
  }
  const pagamentoPorExterno = new Map();
  for (const p of pagamentos) pagamentoPorExterno.set(p.externalId, p);

  const achados = [];
  const achar = (type, externalId, expected, found, severity) =>
    achados.push({ type, externalIdMasked: mascararIdExterno(externalId), expected, found, severity });

  // Pagamentos do gateway: T1, T3 e T4 (lado gateway).
  for (const p of pagamentos) {
    const aprovadoEm = p.approvedAt ? instante(p.approvedAt, 'approvedAt') : null;
    if (p.status === 'approved' && aprovadoEm === null) {
      throw new TypeError('pagamento aprovado sem data: batimento interrompido');
    }
    // Regra 1: aprovado ha menos de 2 h fica fora do batimento.
    if (aprovadoEm !== null && aprovadoEm > limite) continue;

    const lanc = lancamentoPorExterno.get(p.externalId);
    if (p.status === 'approved') {
      if (!lanc) {
        achar(
          'T1_faltando_local',
          p.externalId,
          { amountCents: p.amountCents, planCode: p.planCode, status: 'approved' },
          null,
          'alta',
        );
        continue;
      }
      if (lanc.amountCents !== p.amountCents) {
        achar('T3_valor_divergente', p.externalId, p.amountCents, lanc.amountCents, 'media');
      } else {
        const vigente = precoVigente(precos, p.planCode, aprovadoEm);
        if (vigente !== null && p.amountCents !== vigente) {
          achar('T3_valor_divergente', p.externalId, vigente, p.amountCents, 'media');
        }
      }
      if (lanc.kind === 'recorrencia' && lanc.cancelAtPeriodEnd === true && Date.parse(lanc.endsAt) <= tAgora) {
        achar('T4_recorrencia_divergente', p.externalId, 'ativo', 'cancelado', 'media');
      }
    }
    if (p.status === 'cancelled' && lanc && lanc.kind === 'recorrencia' && lanc.cancelAtPeriodEnd !== true) {
      achar('T4_recorrencia_divergente', p.externalId, 'cancelado', 'ativo', 'media');
    }
  }

  // Lancamentos do livro: T2 (concessao paga sem pagamento aprovado valido).
  for (const l of livro) {
    if (l.kind !== 'paid') continue;
    // Regra 1 tambem vale para a concessao recente: o gateway pode ainda nao ter reportado.
    if (instante(l.startsAt, 'startsAt') > limite) continue;
    const p = l.externalId ? pagamentoPorExterno.get(l.externalId) : undefined;
    if (!p || p.status !== 'approved' || ESTADOS_GATEWAY_INVALIDOS.has(p.status)) {
      achar(
        'T2_concessao_sem_pagamento',
        l.externalId,
        { status: 'approved' },
        p ? { status: p.status } : null,
        'alta',
      );
    }
  }

  const contagens = Object.fromEntries(TIPOS_ACHADO_RMP.map((t) => [t, 0]));
  for (const a of achados) contagens[a.type] += 1;

  return {
    janela: {
      agoraUtc: new Date(tAgora).toISOString(),
      toleranciaMs: TOLERANCIA_RMP_MS,
      limiteUtc: new Date(limite).toISOString(),
    },
    contagens,
    achados: redactForRunbook(achados),
  };
}
