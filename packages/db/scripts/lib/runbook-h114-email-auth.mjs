// R-EMAIL (cota e fila de e-mail) e R-AUTH (orfaos Auth x app.app_user) do runbook H-114 (Issue #123,
// fatia S7; desenho 165 §4.7, §4.8 e §5 CA-13 a CA-16).
// Funcoes puras: a entrada sao numeros, listas e instantes UTC; a saida e a classificacao. Sem I/O.
// Limites e cortes chegam por parametro: a fonte unica e QUOTA_CUTS/PROVIDER_LIMITS de @fastpro/domain
// (testes comparam os valores). Nada escreve em ops.* nem em auth.users; a leitura do provedor de e-mail
// e uma porta com fake (esta funcao recebe apenas o numero lido). Saidas passam por redactForRunbook.
import { redactForRunbook } from './runbook-h114.mjs';
import { mascararIdExterno } from './runbook-h114-rmp.mjs';

/** Limiares de alerta da cota em % do limite do dia ou do mes (desenho §4.7, alerta 1 e alerta 2). */
export const LIMIARES_ALERTA_PCT = Object.freeze({ nivel1: 70, nivel2: 85 });

/** Idade maxima de um item adiado ou pendente antes de virar obsoleto (A-9, decisao 719 a). */
export const HORAS_OBSOLESCENCIA_EMAIL = 12;

/** Janela de tolerancia de conta sem perfil de aplicacao (A-11, decisao 715 a). */
export const MINUTOS_ORFAO_AUTH = 15;

const MS_HORA = 3600_000;
const MS_MINUTO = 60_000;

function instante(iso, rotulo) {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) throw new TypeError(`instante invalido em ${rotulo}`);
  return t;
}

/** Dia UTC (AAAA-MM-DD) de um instante em milissegundos. */
const diaUtc = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Nivel de alerta de um contador: 0 abaixo de 70%, 1 de 70% a 84%, 2 a partir de 85%.
 * Aritmetica inteira. Espelha alertLevelFor de @fastpro/domain (teste de deriva).
 * @returns {0|1|2}
 */
export function nivelAlertaCota(usado, limite, limiares = LIMIARES_ALERTA_PCT) {
  if (usado * 100 >= limite * limiares.nivel2) return 2;
  if (usado * 100 >= limite * limiares.nivel1) return 1;
  return 0;
}

/**
 * Avaliacao da cota de e-mail (R-EMAIL, passos 1 e 2). Mesma precedencia de decideQuota: o mes
 * bloqueia antes do dia. Uma classe so envia enquanto os dois contadores estao abaixo do corte.
 * @param {object} entrada
 * @param {number} entrada.usadoDia
 * @param {number} entrada.usadoMes
 * @param {{dia: number, mes: number}} entrada.limites   Limites do provedor (100 e 3.000).
 * @param {Record<string, {dia: number, mes: number}>} entrada.cortes  Corte por classe.
 * @returns {{nivelDia: 0|1|2, nivelMes: 0|1|2, classes: Record<string, 'envia'|'corta_dia'|'corta_mes'>}}
 */
export function avaliarCotaEmail({ usadoDia, usadoMes, limites, cortes }) {
  const classes = {};
  for (const [classe, corte] of Object.entries(cortes)) {
    if (usadoMes >= corte.mes) classes[classe] = 'corta_mes';
    else if (usadoDia >= corte.dia) classes[classe] = 'corta_dia';
    else classes[classe] = 'envia';
  }
  return {
    nivelDia: nivelAlertaCota(usadoDia, limites.dia),
    nivelMes: nivelAlertaCota(usadoMes, limites.mes),
    classes,
  };
}

/**
 * Ajuste pelo uso informado pelo provedor (R-EMAIL, passo 2, decisao 718 a). Soma apenas o delta
 * positivo ao contador local e nunca passa do teto fisico (ops.external_quota.hard_limit).
 * Sem leitura real: o numero do provedor chega pronto (em DEV, vem de um fake).
 * @returns {{usadoNovo: number, deltaAplicado: number, limitado: boolean}}
 */
export function aplicarDeltaProvedor({ usadoLocal, usadoProvedor, tetoFisico }) {
  const delta = Math.max(0, usadoProvedor - usadoLocal);
  const bruto = usadoLocal + delta;
  const usadoNovo = Math.min(tetoFisico, bruto);
  return { usadoNovo, deltaAplicado: usadoNovo - usadoLocal, limitado: bruto > tetoFisico };
}

/**
 * Decisao sobre um item da fila (R-EMAIL, passo 3). Vocabulario real de ops.email_outbox:
 * pendente, adiado_cota, enviando, enviado, falha, suprimido, descartado. A acao "descartar" grava
 * estado descartado com motivo obsoleto (o nome descartado_obsoleto do desenho nao existe no banco).
 * Zero reenvio: item em estado final ou em envio nunca volta a sair.
 * @param {object} item
 * @param {string} item.state                 Estado atual em ops.email_outbox.
 * @param {string} item.factAtUtc             Instante do fato gerador (ISO 8601 UTC).
 * @param {string|null} [item.adiadoEmUtc]    Instante em que foi adiado por cota (so adiado_cota).
 * @param {boolean|null} [item.aceiteAberto]  false se o pedido de aceite nao esta mais aberto.
 * @param {string} agoraUtc                   Instante da execucao.
 * @returns {{acao: 'manter'|'descartar'|'reavaliar'|'aguardar'|'enviar_possivel', motivo: string}}
 */
export function decidirItemFila(item, agoraUtc) {
  if (item.state !== 'pendente' && item.state !== 'adiado_cota') {
    return { acao: 'manter', motivo: 'estado_final_ou_em_envio' };
  }
  const tAgora = instante(agoraUtc, 'agoraUtc');
  const tFato = instante(item.factAtUtc, 'factAtUtc');
  if (tAgora - tFato > HORAS_OBSOLESCENCIA_EMAIL * MS_HORA) {
    return { acao: 'descartar', motivo: 'obsoleto' };
  }
  if (item.aceiteAberto === false) return { acao: 'descartar', motivo: 'obsoleto' };
  if (item.state === 'adiado_cota') {
    const tAdiado = instante(item.adiadoEmUtc, 'adiadoEmUtc');
    return diaUtc(tAgora) > diaUtc(tAdiado)
      ? { acao: 'reavaliar', motivo: 'virada_do_dia_utc' }
      : { acao: 'aguardar', motivo: 'mesmo_dia_utc' };
  }
  return { acao: 'enviar_possivel', motivo: 'pendente_valido' };
}

/** Conta as decisoes da fila para o relatorio de execucao. */
export function planejarFila(itens, agoraUtc) {
  const contagens = { manter: 0, descartar: 0, reavaliar: 0, aguardar: 0, enviar_possivel: 0 };
  const decisoes = itens.map((item) => {
    const d = decidirItemFila(item, agoraUtc);
    contagens[d.acao] += 1;
    return d;
  });
  return { contagens, decisoes };
}

/**
 * Orfaos entre Auth e app.app_user (R-AUTH, desenho §4.8). So classifica: conta sem perfil de
 * aplicacao com idade estritamente acima da janela vira `orfao_expirado`. Nunca exclui nada.
 * @param {object} entrada
 * @param {Array<{id: string, criadoEmUtc: string}>} entrada.contasAuth
 * @param {Array<{authUserId: string}>} entrada.perfisApp
 * @param {string} entrada.agoraUtc
 * @param {number} [entrada.janelaMinutos]
 */
export function classificarOrfaosAuth({ contasAuth, perfisApp, agoraUtc, janelaMinutos = MINUTOS_ORFAO_AUTH }) {
  const tAgora = instante(agoraUtc, 'agoraUtc');
  const limite = tAgora - janelaMinutos * MS_MINUTO;
  const comPerfil = new Set(perfisApp.map((p) => p.authUserId));
  let pareados = 0;
  let naJanela = 0;
  const sinalizados = [];
  for (const conta of contasAuth) {
    if (comPerfil.has(conta.id)) {
      pareados += 1;
      continue;
    }
    const criado = instante(conta.criadoEmUtc, 'criadoEmUtc');
    if (criado < limite) {
      sinalizados.push({
        idMascarado: mascararIdExterno(conta.id),
        idadeMinutos: Math.floor((tAgora - criado) / MS_MINUTO),
        classe: 'orfao_expirado',
      });
    } else {
      naJanela += 1;
    }
  }
  return {
    contagens: { pareados, naJanela, sinalizados: sinalizados.length },
    sinalizados: redactForRunbook(sinalizados),
  };
}
