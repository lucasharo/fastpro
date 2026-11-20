// Utilidades puras do runbook de incidente e reconciliacao (H-114, Issue #123; desenho 165 §2 A-7).
// Sem I/O, sem rede, sem relogio global: a entrada e o unico insumo. Toda saida de relatorio do
// runbook passa por redactForRunbook (CA-17: nenhuma saida com e-mail, telefone ou CPF em claro).

/** Marcador obrigatorio em todo dado sintetico criado por teste no DEV. */
export const MARCADOR_TESTE = '[TESTE-H114]';

/** Substituto de texto livre (campos de descricao, mensagem e observacao nunca saem em claro). */
export const TEXTO_LIVRE_REMOVIDO = '[TEXTO LIVRE REMOVIDO]';

// Chaves cujo conteudo e texto livre: o valor inteiro e removido em qualquer saida.
const CHAVES_TEXTO_LIVRE = new Set([
  'texto',
  'descricao',
  'observacao',
  'mensagem',
  'conteudo',
  'comentario',
  'nota',
  'motivo_livre',
]);

// E-mail: parte local, arroba, dominio, ponto e extensao.
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// CPF (11 digitos) e CNPJ (14 digitos), com ou sem pontuacao. Mantem os 4 ultimos digitos.
const RE_DOCUMENTO =
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
// Telefone brasileiro com DDD, opcional DDI, parenteses, espaco ou hifen. Mantem os 2 ultimos digitos.
const RE_TELEFONE = /(?:\+?\d{2}\s?)?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}\b/g;

const apenasDigitos = (s) => s.replace(/\D/g, '');

/** e-mail `teste.h114@exemplo.invalid` -> `t***@e***.invalid` (formato do runbook). */
export function mascararEmail(email) {
  const [local, dominio] = email.split('@');
  const pontos = dominio.split('.');
  const tld = pontos[pontos.length - 1];
  return `${local[0]}***@${pontos[0][0]}***.${tld}`;
}

/** CPF ou CNPJ -> `***` + 4 ultimos digitos. */
export function mascararDocumento(doc) {
  return `***${apenasDigitos(doc).slice(-4)}`;
}

/** Telefone -> `***` + 2 ultimos digitos. */
export function mascararTelefone(fone) {
  return `***${apenasDigitos(fone).slice(-2)}`;
}

/** Redige um texto solto: e-mails, documentos e telefones, nesta ordem. Idempotente. */
export function redigirTexto(texto) {
  return texto
    .replace(RE_EMAIL, (m) => mascararEmail(m))
    .replace(RE_DOCUMENTO, (m) => mascararDocumento(m))
    .replace(RE_TELEFONE, (m) => mascararTelefone(m));
}

/**
 * Redige qualquer estrutura (texto, numero, lista, objeto, data). Nao altera a entrada.
 * Chaves de texto livre perdem o valor inteiro. Datas viram ISO 8601 em UTC.
 * @param {unknown} valor
 * @returns {unknown}
 */
export function redactForRunbook(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') return redigirTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map((item) => redactForRunbook(item));
  if (typeof valor === 'object') {
    const saida = {};
    for (const [chave, conteudo] of Object.entries(valor)) {
      const nomeSeguro = redigirTexto(chave);
      saida[nomeSeguro] =
        CHAVES_TEXTO_LIVRE.has(chave.toLowerCase()) && typeof conteudo === 'string'
          ? TEXTO_LIVRE_REMOVIDO
          : redactForRunbook(conteudo);
    }
    return saida;
  }
  return String(valor);
}

/**
 * Tipos do runbook (JSDoc; a persistencia e de H-053/#66).
 * @typedef {object} RelatorioIncidente  Formulario fixo do D-09 (desenho §4.5).
 * @property {string} titulo
 * @property {string} instanteUtc           ISO 8601 em UTC.
 * @property {string} rotaOuVetor
 * @property {number} contagemTitulares
 * @property {string[]} classesDeDado
 * @property {string[]} medidas
 * @property {string} statusContencao
 *
 * @typedef {object} GatewayPayment          Contrato R-MP (desenho §4.6), sem persistencia.
 * @property {string} externalId
 * @property {string} status
 * @property {number} amountCents
 * @property {string} approvedAt             ISO 8601 em UTC, ou nulo.
 * @property {string} planCode
 * @property {string|null} subscriptionExternalId
 *
 * @typedef {object} LedgerEntry            Linha do livro no batimento R-MP.
 * @property {string|null} externalId
 * @property {string} grantId
 * @property {string} kind
 * @property {number} amountCents
 * @property {string} planCode
 * @property {string} startsAt
 * @property {string} endsAt
 * @property {boolean} cancelAtPeriodEnd
 *
 * @typedef {object} ReconciliationFinding  Achado do R-MP; o identificador e sempre mascarado.
 * @property {'T1_faltando_local'|'T2_concessao_sem_pagamento'|'T3_valor_divergente'|'T4_recorrencia_divergente'} type
 * @property {string} externalIdMasked
 * @property {unknown} expected
 * @property {unknown} found
 * @property {'alta'|'media'|'baixa'} severity
 */
