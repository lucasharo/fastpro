// E5 (Issues 60 a 67) | Tela de assinatura do profissional: situacao, planos, checkout hospedado, retorno e cancelamento.
// So chama a propria API (/api/v1/billing/*). Sem HTML dinamico, sem armazenamento do navegador, sem log.
// O pagamento acontece no Mercado Pago: esta tela nunca recebe dado de cartao.

export const ROTULOS_PLANO = Object.freeze({
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
});

const ESTADOS = Object.freeze({
  ativa: 'Assinatura ativa',
  cancelada_com_acesso_ate_fim_do_periodo:
    'Renovação cancelada. O acesso continua até o fim do período pago',
  em_carencia: 'Período vencido. Você está na carência de 72 horas para pagar sem perder o acesso',
  expirada: 'Assinatura vencida. Escolha um plano para voltar a receber pedidos',
  trial_ativo: 'Teste grátis ativo',
  trial_expirado: 'Teste grátis encerrado. Escolha um plano para continuar',
  sem_acesso: 'Você ainda não tem assinatura',
});

const STATUS = Object.freeze({
  aprovado: 'Aprovado',
  pendente: 'Aguardando pagamento',
  recusado: 'Recusado',
  estornado: 'Estornado',
  chargeback: 'Contestado',
});

const ERROS = Object.freeze({
  not_verified:
    'Seu documento ainda não foi aprovado. A assinatura fica liberada depois da aprovação.',
  adesao_obrigatoria: 'Para renovar automaticamente no cartão, marque a autorização.',
  plano_invalido: 'Escolha um plano.',
  method_not_supported: 'Escolha Pix ou cartão.',
  cobranca_bloqueada: 'A cobrança está desligada neste ambiente.',
  padrao: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.',
});

const ERROS_TRIAL = Object.freeze({
  not_verified: 'O teste grátis fica liberado depois que seu documento for aprovado.',
  trial_used: 'O teste grátis já foi usado para este documento.',
  paid_access_active: 'Você já tem uma assinatura ativa.',
});

const REQ = Object.freeze({
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
});

/** 2990 -> "R$ 29,90". */
export function formatarReais(centavos) {
  const inteiro = Math.floor(centavos / 100);
  const resto = String(centavos % 100).padStart(2, '0');
  return `R$ ${String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${resto}`;
}

/** Data ISO -> "10/04/2031" no fuso de Sao Paulo. */
export function formatarData(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Frase da situacao a partir da resposta de /v1/billing/status. */
export function textoSituacao(s) {
  const base = ESTADOS[s.estado] ?? ESTADOS.sem_acesso;
  const ate = s.access_until ? ` (até ${formatarData(s.access_until)})` : '';
  const plano = s.plan ? ` Plano ${ROTULOS_PLANO[s.plan] ?? s.plan}.` : '';
  const renova = s.auto_renew ? ' Renovação automática no cartão ligada.' : '';
  return `${base}${ate}.${plano}${renova}`;
}

/** Valor mensal equivalente do plano, para comparar ("R$ 19,90/mês"). */
export function porMes(plano) {
  return `${formatarReais(Math.round(plano.amount_cents / plano.months))}/mês`;
}

/** Parametros que o Mercado Pago acrescenta na volta do checkout. */
export function lerRetorno(busca) {
  const p = new globalThis.URLSearchParams(busca);
  const pagamento = p.get('payment_id') ?? p.get('collection_id');
  const assinatura = p.get('preapproval_id');
  const ok = (v) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) && v !== 'null' ? v : null);
  return { paymentId: ok(pagamento), preapprovalId: ok(assinatura) };
}

export function ligarPagina(janela) {
  const doc = janela.document;
  const el = (id) => doc.getElementById(id);
  const principal = el('conteudo');
  const estado = el('estado');
  let situacaoAtual = null;

  async function api(caminho, corpo) {
    const init =
      corpo === undefined
        ? { ...REQ, headers: { Accept: 'application/json' } }
        : {
            ...REQ,
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
          };
    const res = await janela.fetch(`/api${caminho}`, init);
    let json;
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    return { status: res.status, json };
  }

  function mandarEntrar() {
    janela.location.assign('/profissional/entrar?voltar=%2Fprofissional-assinatura');
  }

  function mostrarSituacao(s) {
    situacaoAtual = s;
    el('situacao-texto').textContent = textoSituacao(s);
    el('situacao').hidden = false;
    const podeCancelar =
      (s.estado === 'ativa' || s.estado === 'em_carencia') && !s.cancel_at_period_end;
    el('cancelar').hidden = !podeCancelar;
    el('trial').hidden = s.estado !== 'sem_acesso';
    el('texto-adesao').textContent = s.auto_renew_text ?? '';
    const lista = el('pagamentos');
    lista.replaceChildren();
    for (const p of s.payments ?? []) {
      const item = doc.createElement('li');
      const periodo = p.period_start
        ? `, período ${formatarData(p.period_start)} a ${formatarData(p.period_end)}`
        : '';
      item.textContent = `${p.method === 'pix' ? 'Pix' : 'Cartão'}: ${formatarReais(p.amount_cents)}, ${STATUS[p.status] ?? p.status}${periodo}`;
      lista.append(item);
    }
    el('historico').hidden = (s.payments ?? []).length === 0;
  }

  function mostrarPlanos(planos) {
    const caixa = el('planos');
    caixa.replaceChildren();
    planos.forEach((p, i) => {
      const rotulo = doc.createElement('label');
      rotulo.className = 'assinatura-plano';
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = 'plano';
      radio.value = p.code;
      if (p.code === 'anual' || (i === 0 && !planos.some((x) => x.code === 'anual')))
        radio.checked = true;
      const nome = doc.createElement('strong');
      nome.textContent = ROTULOS_PLANO[p.code] ?? p.code;
      const preco = doc.createElement('span');
      preco.textContent = `${formatarReais(p.amount_cents)} (${porMes(p)})`;
      rotulo.append(radio, nome, preco);
      caixa.append(rotulo);
    });
    el('formulario').hidden = false;
  }

  function metodo() {
    const marcado = doc.querySelector('input[name="metodo"]:checked');
    return marcado ? marcado.value : 'pix';
  }

  function atualizarRenovacao() {
    el('renovacao').hidden = metodo() !== 'cartao';
  }

  for (const r of doc.querySelectorAll('input[name="metodo"]'))
    r.addEventListener('change', atualizarRenovacao);

  el('formulario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    el('erro').textContent = '';
    const plano = doc.querySelector('input[name="plano"]:checked');
    const corpo = {
      plan: plano ? plano.value : null,
      method: metodo(),
      auto_renew: metodo() === 'cartao' && el('renovar').checked,
      accept_text_version: situacaoAtual?.auto_renew_text_version ?? null,
    };
    el('pagar').disabled = true;
    try {
      const r = await api('/v1/billing/checkout', corpo);
      if (r.status === 401) return mandarEntrar();
      if (
        r.status === 200 &&
        typeof r.json.redirect_url === 'string' &&
        r.json.redirect_url.startsWith('https://')
      ) {
        janela.location.assign(r.json.redirect_url);
        return;
      }
      el('erro').textContent = ERROS[r.json.error] ?? ERROS.padrao;
    } catch {
      el('erro').textContent = ERROS.padrao;
    } finally {
      el('pagar').disabled = false;
    }
  });

  el('cancelar').addEventListener('click', async () => {
    if (!janela.confirm('Cancelar a renovação? Você mantém o acesso até o fim do período já pago.'))
      return;
    el('cancelar').disabled = true;
    try {
      const r = await api('/v1/billing/cancel', {});
      if (r.status === 401) return mandarEntrar();
      el('cancelar-aviso').textContent = r.status === 200 ? 'Renovação cancelada.' : ERROS.padrao;
      if (r.status === 200) await carregar();
    } catch {
      el('cancelar-aviso').textContent = ERROS.padrao;
    } finally {
      el('cancelar').disabled = false;
    }
  });

  el('trial').addEventListener('click', async () => {
    el('trial').disabled = true;
    try {
      const r = await api('/v1/billing/trial/activate', {});
      if (r.status === 401) return mandarEntrar();
      el('trial-aviso').textContent =
        r.status === 201
          ? `Teste grátis ativo até ${formatarData(r.json.ends_at)}.`
          : (ERROS_TRIAL[r.json.error] ?? ERROS.padrao);
      if (r.status === 201) await carregar();
    } catch {
      el('trial-aviso').textContent = ERROS.padrao;
    } finally {
      el('trial').disabled = false;
    }
  });

  el('tentar').addEventListener('click', () => {
    el('tentar').hidden = true;
    carregar();
  });

  async function carregar() {
    estado.textContent = 'Carregando sua assinatura…';
    try {
      const retorno = lerRetorno(janela.location.search);
      if (retorno.paymentId || retorno.preapprovalId) {
        estado.textContent = 'Confirmando o pagamento no Mercado Pago…';
        const c = await api('/v1/billing/confirm', {
          ...(retorno.paymentId ? { payment_id: retorno.paymentId } : {}),
          ...(retorno.preapprovalId ? { preapproval_id: retorno.preapprovalId } : {}),
        });
        if (c.status === 401) return mandarEntrar();
        janela.history.replaceState(null, '', '/profissional-assinatura');
        estado.textContent =
          c.status === 200
            ? c.json.resultado === 'concedido' ||
              c.json.resultado === 'sem_mudanca' ||
              c.json.resultado === 'assinatura_ligada'
              ? 'Pagamento confirmado. Obrigado!'
              : 'Pagamento recebido pelo Mercado Pago. Assim que for aprovado, o acesso é liberado.'
            : 'Não foi possível confirmar agora. Se você pagou, o acesso é liberado assim que o Mercado Pago avisar.';
      }
      const [s, p] = await Promise.all([api('/v1/billing/status'), api('/v1/billing/plans')]);
      if (s.status === 401 || s.status === 403) return mandarEntrar();
      if (s.status !== 200 || p.status !== 200) throw new Error('indisponivel');
      mostrarSituacao(s.json);
      mostrarPlanos(Array.isArray(p.json.plans) ? p.json.plans : []);
      atualizarRenovacao();
      if (!retorno.paymentId && !retorno.preapprovalId) estado.textContent = '';
    } catch {
      estado.textContent = 'Não foi possível carregar sua assinatura agora.';
      el('tentar').hidden = false;
    } finally {
      principal.setAttribute('aria-busy', 'false');
    }
  }

  return carregar();
}

if (
  typeof globalThis.window !== 'undefined' &&
  globalThis.window.document?.getElementById('formulario')
) {
  ligarPagina(globalThis.window);
}
