// H-030 (Issue #43) | Logica pura das telas de pedido e de revisao (docs/factory/90-DESENHO-H030.md, §5 e §7.3).
// Sem DOM e sem rede: relogio, temporizador e cliente sao injetados, para testar sem navegador.
// A visao (pedido.js e pedido-revisao.js) so desenha o estado devolvido aqui. A autoridade sobre campos
// faltando e o banco (private.draft_confirm); a lista feita aqui so orienta o erro antes do envio.

export const PEDIDO_DESCRICAO_MAX = 2000;
export const PEDIDO_BUSCA_MIN = 2;
export const PEDIDO_BUSCA_ATRASO_MS = 300;
export const PEDIDO_SALVAR_ATRASO_MS = 800;
export const PEDIDO_ESPERA_INTERVALO_MS = 5000;
export const PEDIDO_ESPERA_LIMITE_MS = 15 * 60 * 1000;

/** Lista de urgencia exata (CA-02, RF-011). A ordem e a da tela. */
export const PEDIDO_URGENCIAS = Object.freeze([
  Object.freeze({ valor: 'imediato', rotulo: 'Imediato' }),
  Object.freeze({ valor: 'proximas_semanas', rotulo: 'Nas próximas semanas' }),
  Object.freeze({ valor: 'proximo_mes', rotulo: 'Próximo mês' }),
  Object.freeze({ valor: 'nao_definido', rotulo: 'Ainda não defini' }),
]);

/** Ordem fixa de DRAFT_REVIEW_FIELDS (dominio). */
export const PEDIDO_CAMPOS_REVISAO = Object.freeze([
  'service_id',
  'address_text',
  'urgency',
  'description',
  'first_name',
  'email',
]);

export const PEDIDO_ROTULOS = Object.freeze({
  service_id: 'Serviço',
  address_text: 'Local',
  urgency: 'Urgência',
  description: 'Descrição',
  first_name: 'Primeiro nome',
  email: 'E-mail',
});

/** Textos aprovados (89 §3, decisao 61) e propostos (90 §5.3). Unica frase com "publicado": "Ainda não foi publicado.". */
export const PEDIDO_TEXTOS = Object.freeze({
  carregando: 'Carregando seu pedido…',
  carregandoFalhou: 'Não foi possível abrir seu pedido agora. Tente de novo.',
  tentarDeNovo: 'Tentar de novo',
  vazioFormulario: '',
  vazioRevisao: 'Não encontramos um pedido em andamento. Comece um novo pedido.',
  comecarNovo: 'Comece um novo pedido',
  faltaPrefixo: 'Falta preencher: ',
  salvarFalhou: 'Não foi possível salvar essa alteração. Tente de novo.',
  salvo: 'Alteração salva.',
  buscaSemResultado: 'Não encontramos esse serviço. Tente outra palavra.',
  buscaFalhou: 'Não foi possível buscar agora. Tente de novo.',
  muitasTentativas: 'Muitas tentativas. Aguarde um instante e tente de novo.',
  confirmando: 'Confirmando…',
  confirmar: 'Confirmar pedido',
  conteudoAlterado: 'Seu pedido mudou. Confira de novo antes de confirmar.',
  falhaConfirmar: 'Não foi possível confirmar agora. Seus dados continuam salvos. Tente de novo.',
  confirmado: 'Pedido confirmado. Ainda não foi publicado.',
  confiraEmail: 'Confira seu e-mail',
  confiraEmailTexto: 'Enviamos um link para o seu e-mail. Abra o link e volte a esta página.',
  jaConfirmei: 'Já confirmei meu e-mail',
  corrigirEmail: 'Corrigir e-mail',
  reenviar: 'Reenviar',
  codigoRotulo: 'Código de 6 dígitos',
  validarCodigo: 'Validar código',
  enviarLinkFalhou: 'Não foi possível enviar o link agora. Tente de novo.',
  identidadeInvalida: 'Confira o nome e o e-mail e tente de novo.',
  expirou: 'O link pode ter expirado. Confira o e-mail ou corrija o endereço.',
  editar: 'Editar',
  identificacao: 'Nome e e-mail',
  naoInformado: 'Não informado',
});

function vazio(valor) {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/**
 * Campos que faltam para revisar (mesma regra de draftMissingForReview, na ordem de PEDIDO_CAMPOS_REVISAO).
 * Urgencia fora da lista conta como faltando.
 */
export function faltandoParaRevisao(campos) {
  return PEDIDO_CAMPOS_REVISAO.filter((campo) => {
    if (campo === 'urgency') return !PEDIDO_URGENCIAS.some((u) => u.valor === campos.urgency);
    return vazio(campos[campo]);
  });
}

/** "Falta preencher: Serviço, Local." */
export function resumoFaltando(faltantes) {
  const nomes = faltantes.map((campo) => PEDIDO_ROTULOS[campo] ?? campo);
  return `${PEDIDO_TEXTOS.faltaPrefixo}${nomes.join(', ')}.`;
}

/** Descricao dentro do limite de caracteres (contador na tela). */
export function descricaoDentroDoLimite(texto) {
  return String(texto ?? '').length <= PEDIDO_DESCRICAO_MAX;
}

/** Resposta de GET /v1/drafts/current/review (90 §2.1). */
export function interpretarRevisao(status, corpo) {
  if (status === 200) return { tipo: 'pronto', view: corpo };
  if (status === 409) return { tipo: 'aguardando' };
  if (status === 422) return { tipo: 'campos', missing: Array.isArray(corpo?.missing) ? corpo.missing : [] };
  if (status === 404) return { tipo: 'vazio' };
  if (status === 429) return { tipo: 'limite' };
  return { tipo: 'erro' };
}

/** Resposta de POST /v1/drafts/current/confirm (90 §2.2). Nunca diz que o pedido foi publicado. */
export function interpretarConfirmacao(status, corpo) {
  if (status === 200 && corpo?.status === 'confirmado') {
    return { tipo: 'confirmado', confirmedAt: corpo.confirmed_at, contentRev: corpo.content_rev };
  }
  if (status === 409 && corpo?.code === 'conteudo_alterado') return { tipo: 'conteudo_alterado' };
  if (status === 409) return { tipo: 'email' };
  if (status === 422) return { tipo: 'campos', missing: Array.isArray(corpo?.missing) ? corpo.missing : [] };
  if (status === 404) return { tipo: 'vazio' };
  if (status === 429) return { tipo: 'limite' };
  return { tipo: 'falha' };
}

/**
 * Controlador da confirmacao expressa (CA-06, CA-08). So envia quando confirmar() e chamado pelo clique.
 * Enquanto uma chamada esta em curso, novas chamadas devolvem a mesma promessa (um clique so vale).
 */
export function criarControladorConfirmacao({ enviar, onEstado }) {
  let emCurso = null;
  let estado = { tipo: 'pronto' };
  const emitir = (novo) => {
    estado = novo;
    onEstado(novo);
  };
  return {
    estado: () => estado,
    emCurso: () => emCurso !== null,
    confirmar(contentRev) {
      if (emCurso !== null) return emCurso;
      emitir({ tipo: 'confirmando' });
      emCurso = (async () => {
        let resultado;
        try {
          const resposta = await enviar(contentRev);
          resultado = interpretarConfirmacao(resposta.status, resposta.corpo);
        } catch {
          resultado = { tipo: 'falha' };
        }
        emCurso = null;
        emitir(resultado);
        return resultado;
      })();
      return emCurso;
    },
  };
}

/**
 * Salvamento do rascunho enquanto o cliente preenche (H-025 R6): debounce de 800 ms e uma requisicao em voo.
 * alterar() acumula campos; liberar() envia o pendente agora e espera (usado antes de "Revisar pedido").
 * enviar(campos) devolve { status }. Status 2xx = salvo; 404 = rascunho nao existe mais; demais = erro.
 */
export function criarControladorSalvamento({ enviar, agendar, cancelar, onEstado, atrasoMs = PEDIDO_SALVAR_ATRASO_MS }) {
  let pendentes = {};
  let temporizador = null;
  let emCurso = null;
  let ultimoOk = true;

  const emitir = (tipo) => onEstado({ tipo });

  async function descarregar() {
    while (Object.keys(pendentes).length > 0) {
      const envio = pendentes;
      pendentes = {};
      let resposta;
      try {
        resposta = await enviar(envio);
      } catch {
        resposta = { status: 0 };
      }
      if (resposta.status >= 200 && resposta.status < 300) {
        ultimoOk = true;
        emitir('salvo');
      } else {
        // Nao perde o que o cliente digitou: devolve ao pendente, sem sobrescrever o que mudou depois.
        pendentes = { ...envio, ...pendentes };
        ultimoOk = false;
        emitir(resposta.status === 404 ? 'vazio' : 'erro_salvar');
        return;
      }
    }
  }

  function disparar() {
    if (emCurso === null) {
      emCurso = descarregar().finally(() => {
        emCurso = null;
      });
    }
    return emCurso;
  }

  return {
    alterar(parcial) {
      pendentes = { ...pendentes, ...parcial };
      if (temporizador !== null) cancelar(temporizador);
      temporizador = agendar(() => {
        temporizador = null;
        disparar();
      }, atrasoMs);
    },
    async liberar() {
      if (temporizador !== null) {
        cancelar(temporizador);
        temporizador = null;
      }
      await disparar();
      if (emCurso === null && Object.keys(pendentes).length > 0) await disparar();
      return ultimoOk && Object.keys(pendentes).length === 0;
    },
    pendente: () => Object.keys(pendentes).length > 0,
  };
}

/**
 * Busca de servico (H-019, CA-06 da busca): debounce de 300 ms e minimo de 2 caracteres.
 * enviar(q) devolve { status, corpo }. Resposta ok com items, vazio, ou erro.
 */
export function criarControladorBusca({ enviar, agendar, cancelar, onEstado, atrasoMs = PEDIDO_BUSCA_ATRASO_MS }) {
  let temporizador = null;
  let geracao = 0;
  const emitir = (estado) => onEstado(estado);

  async function buscar(q, numero) {
    let resposta;
    try {
      resposta = await enviar(q);
    } catch {
      resposta = { status: 0, corpo: null };
    }
    if (numero !== geracao) return;
    if (resposta.status === 200 && resposta.corpo?.status === 'ok') {
      emitir({ tipo: 'resultado', items: resposta.corpo.items ?? [] });
    } else if (resposta.status === 200 && resposta.corpo?.status === 'vazio') {
      emitir({ tipo: 'sem_resultado' });
    } else if (resposta.status === 429) {
      emitir({ tipo: 'limite' });
    } else {
      emitir({ tipo: 'erro' });
    }
  }

  return {
    digitar(texto) {
      const q = String(texto ?? '').trim();
      geracao += 1;
      const numero = geracao;
      if (temporizador !== null) cancelar(temporizador);
      temporizador = null;
      if (q.length < PEDIDO_BUSCA_MIN) {
        emitir({ tipo: 'curto' });
        return;
      }
      temporizador = agendar(() => {
        temporizador = null;
        buscar(q, numero);
      }, atrasoMs);
    },
  };
}

/**
 * Espera do e-mail (90 §5.1): consulta a revisao a cada 5 s, so com a aba visivel, por no maximo 15 min.
 * Ao chegar pronto, campos ou vazio, para e avisa. Nenhuma confirmacao acontece aqui (so leitura).
 */
export function criarControladorEspera({
  consultar,
  agendar,
  cancelar,
  agora,
  visivel = () => true,
  onEstado,
  intervaloMs = PEDIDO_ESPERA_INTERVALO_MS,
  limiteMs = PEDIDO_ESPERA_LIMITE_MS,
}) {
  let ativo = false;
  let inicio = 0;
  let temporizador = null;
  let consultando = false;

  const agendarProxima = (ms) => {
    if (temporizador !== null) cancelar(temporizador);
    temporizador = agendar(tique, ms);
  };

  async function consultarUma() {
    if (consultando) return;
    consultando = true;
    let resultado;
    try {
      resultado = await consultar();
    } catch {
      resultado = { tipo: 'erro' };
    } finally {
      consultando = false;
    }
    if (!ativo) return;
    if (resultado.tipo === 'aguardando' || resultado.tipo === 'erro' || resultado.tipo === 'limite') {
      if (agora() - inicio >= limiteMs) {
        parar();
        onEstado({ tipo: 'expirou' });
        return;
      }
      if (visivel()) agendarProxima(intervaloMs);
      return;
    }
    parar();
    onEstado(resultado);
  }

  function tique() {
    temporizador = null;
    if (!ativo) return;
    if (!visivel()) return;
    if (agora() - inicio >= limiteMs) {
      parar();
      onEstado({ tipo: 'expirou' });
      return;
    }
    consultarUma();
  }

  function parar() {
    ativo = false;
    if (temporizador !== null) {
      cancelar(temporizador);
      temporizador = null;
    }
  }

  return {
    iniciar() {
      if (ativo) return;
      ativo = true;
      inicio = agora();
      if (visivel()) consultarUma();
    },
    parar,
    /** Chamado quando a aba muda de visibilidade: volta a consultar ao ficar visivel. */
    aoVisibilidade(estaVisivel) {
      if (!ativo) return;
      if (estaVisivel && temporizador === null && !consultando) consultarUma();
      if (!estaVisivel && temporizador !== null) {
        cancelar(temporizador);
        temporizador = null;
      }
    },
    /** "Já confirmei meu e-mail": consulta agora, sem esperar o intervalo. */
    consultarAgora() {
      if (!ativo) return;
      consultarUma();
    },
    ativo: () => ativo,
  };
}

// ---------- publicacao do pedido (H-031, #44; 110 §8 e 109 §7) ----------
// Textos separados de PEDIDO_TEXTOS: a frase de CA-13 ("Ainda nao foi publicado.") continua a unica do confirmado.
const dataCurta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
export const PUBLICACAO_TEXTOS = Object.freeze({
  publicando: 'Publicando seu pedido…',
  publicar: 'Publicar pedido',
  publicado: 'Pedido publicado.',
  aceitesAte: (iso) => `Aceites até ${dataCurta(iso)}.`,
  revisar: 'Revisar',
  publicarMesmoAssim: 'Publicar mesmo assim',
  duplicidade: 'Você já tem um pedido parecido publicado recentemente.',
  conteudoAlterado: 'Seu pedido mudou. Confira de novo antes de publicar.',
  sessao: 'Entre de novo para publicar.',
  limite: 'Muitas tentativas. Tente de novo mais tarde.',
  enderecoNaoEncontrado: 'Não encontramos esse endereço. Corrija e tente de novo.',
  limiteEnderecos: 'Este pedido já usou o número máximo de endereços. Mantenha o endereço atual.',
  processando: 'Ainda processando o endereço. Tente de novo em instantes.',
  vencido: 'Seu pedido expirou. Refaça o pedido.',
  indisponivel: 'Não foi possível publicar agora. Seus dados continuam salvos. Tente de novo.',
  emailDivergente: 'Entre com o mesmo e-mail do pedido.',
  fotos: 'Suas fotos ainda estão sendo preparadas. Tente de novo em instantes.',
});

const TEXTO_POR_ESTADO = Object.freeze({
  conteudo_alterado: 'conteudoAlterado',
  sessao: 'sessao',
  limite: 'limite',
  endereco: 'enderecoNaoEncontrado',
  limite_enderecos: 'limiteEnderecos',
  processando: 'processando',
  vencido: 'vencido',
  indisponivel: 'indisponivel',
  email_divergente: 'emailDivergente',
  fotos: 'fotos',
});

/** Texto visivel de um desfecho de erro da publicacao (campos usa resumoFaltando). */
export function textoDaPublicacao(tipo) {
  const chave = TEXTO_POR_ESTADO[tipo];
  return chave === undefined ? '' : PUBLICACAO_TEXTOS[chave];
}

/** Resposta de POST /v1/requests (110 §3). Lista fechada de desfechos; nada de endereco ou coordenada. */
export function interpretarPublicacao(status, corpo) {
  const codigo = corpo?.code;
  if ((status === 201 || status === 200) && corpo?.status === 'publicado') {
    return { tipo: 'publicado', acceptanceDeadlineAt: corpo.acceptanceDeadlineAt };
  }
  if (status === 409 && codigo === 'duplicidade') {
    return { tipo: 'duplicidade', ackToken: typeof corpo.ackToken === 'string' ? corpo.ackToken : null };
  }
  if (status === 409 && codigo === 'conteudo_alterado') return { tipo: 'conteudo_alterado' };
  if (status === 409 && codigo === 'email_divergente') return { tipo: 'email_divergente' };
  if (status === 409 && codigo === 'fotos_em_processamento') return { tipo: 'fotos' };
  if (status === 202 || (status === 409 && (codigo === 'em_andamento' || codigo === 'geocodificacao_em_andamento'))) {
    return { tipo: 'processando' };
  }
  if (status === 401) return { tipo: 'sessao' };
  if (status === 404) return { tipo: 'vencido' };
  if (status === 429) return { tipo: 'limite' };
  if (status === 422 && codigo === 'endereco_nao_encontrado') return { tipo: 'endereco' };
  if (status === 422 && codigo === 'geocode_limit') return { tipo: 'limite_enderecos' };
  if (status === 422 && codigo === 'campos_faltando') {
    return { tipo: 'campos', missing: Array.isArray(corpo?.missing) ? corpo.missing : [] };
  }
  return { tipo: 'indisponivel' };
}
