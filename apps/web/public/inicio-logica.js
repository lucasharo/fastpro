// Issue #153 | Logica pura da pagina inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §4, §5.3 e §8, fatia 1).
// Sem DOM e sem rede: as funcoes so decidem o que fazer com os dados ja lidos. A visao (inicio.js) liga o
// DOM, faz as chamadas e desenha o resultado. Imports relativos para rodar tanto no navegador quanto no vitest.
import { PEDIDO_TEXTOS } from './pedido-logica.js';
import { ADDRESS_MIN_CHARS, ADDRESS_MAX_CHARS, normalizeQuery } from './address-field.js';

/** Textos exclusivos da inicial. Sem termos comerciais, sem termos tecnicos e sem valores em reais (CA-W20). */
export const INICIO_TEXTOS = Object.freeze({
  titulo: 'FastPro',
  apoio: 'Diga o serviço e onde ele será feito. Na próxima tela você descreve o pedido.',
  rotuloServico: 'Qual serviço você precisa?',
  rotuloEndereco: 'Onde o serviço será feito?',
  buscando: 'Buscando serviços…',
  servicoEscolhido: 'Serviço escolhido.',
  servicoObrigatorio: 'Escolha um serviço da lista para continuar.',
  enderecoObrigatorio: `Preencha o endereço com pelo menos ${ADDRESS_MIN_CHARS} caracteres.`,
  enderecoLongo: `O endereço pode ter no máximo ${ADDRESS_MAX_CHARS} caracteres.`,
  continuar: 'Continuar',
  aguarde: 'Aguarde…',
  semConexao:
    'Não foi possível continuar agora. Seus dados estão aqui; tente de novo.',
  muitasTentativas: PEDIDO_TEXTOS.muitasTentativas,
  buscaSemResultado: PEDIDO_TEXTOS.buscaSemResultado,
  buscaFalhou: PEDIDO_TEXTOS.buscaFalhou,
  naoFoiPossivelBuscar: PEDIDO_TEXTOS.buscaFalhou,
  confirmacaoTitulo: 'Você já tem um pedido em andamento.',
  confirmacaoTexto:
    'Ele é de outro serviço. Trocar o serviço mantém a descrição e a urgência que você já escreveu.',
  confirmacaoTrocar: 'Trocar e continuar',
  confirmacaoVoltar: 'Voltar ao pedido que já existe',
});

/** Campos da inicial e os codigos de erro do desenho (E-01 a E-03). */
export const INICIO_CAMPOS = Object.freeze({ servico: 'servico', endereco: 'endereco' });

function preenchido(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== '';
}

/** Conta caracteres como a API (pontos de codigo, nao unidades UTF-16). */
function contarCaracteres(texto) {
  return [...texto].length;
}

/** Texto do endereco como vai ao servidor: NFC, sem controles, espacos colapsados. */
export function enderecoParaEnvio(endereco) {
  return normalizeQuery(endereco);
}

/**
 * Valida os dois campos antes de qualquer chamada (E-01, E-02, E-03). Devolve a lista de erros na ordem
 * servico -> endereco. Lista vazia = pode continuar. Nenhuma requisicao depende deste resultado para existir.
 */
export function validarCampos({ servicoId, endereco }) {
  const erros = [];
  if (!preenchido(servicoId)) {
    erros.push({ campo: INICIO_CAMPOS.servico, codigo: 'E-01', texto: INICIO_TEXTOS.servicoObrigatorio });
  }
  const n = contarCaracteres(enderecoParaEnvio(endereco));
  if (n < ADDRESS_MIN_CHARS) {
    erros.push({ campo: INICIO_CAMPOS.endereco, codigo: 'E-02', texto: INICIO_TEXTOS.enderecoObrigatorio });
  } else if (n > ADDRESS_MAX_CHARS) {
    erros.push({ campo: INICIO_CAMPOS.endereco, codigo: 'E-03', texto: INICIO_TEXTOS.enderecoLongo });
  }
  return erros;
}

/** Corpo do POST e do PATCH: so service_id e address_text (urgencia e descricao ficam para /pedido). */
export function montarCorpo({ servicoId, endereco }) {
  return { service_id: servicoId, address_text: enderecoParaEnvio(endereco) };
}

/**
 * Ramo de "Continuar" (desenho §5.3, decisao 941).
 * - atual === null: nao ha rascunho (404 da API) -> 'criar' (POST).
 * - rascunho com outro servico e com descricao ou urgencia -> 'confirmar' (pede confirmacao ao cliente).
 * - demais casos (mesmo servico, ou sem descricao/urgencia) -> 'atualizar' (PATCH).
 */
export function decidirCriacao({ atual, servicoId }) {
  if (atual === null || atual === undefined) return 'criar';
  const trocaDeServico = atual.service_id !== servicoId;
  if (trocaDeServico && (preenchido(atual.description) || preenchido(atual.urgency))) return 'confirmar';
  return 'atualizar';
}

/**
 * Interpreta GET /api/v1/drafts/current. So o 404 com corpo JSON da propria API ({code:'nao_encontrado'})
 * significa "sem rascunho". 404 sem JSON (plataforma fora do ar, ou API sem resposta) e qualquer outra falha
 * significam "indisponivel": nao se faz POST nesse caso (Issue 156 ainda em andamento).
 */
export function interpretarRascunhoAtual(status, corpo) {
  if (status === 200 && corpo !== null && typeof corpo === 'object') {
    return { tipo: 'rascunho', view: corpo };
  }
  if (status === 404 && corpo !== null && typeof corpo === 'object' && corpo.code === 'nao_encontrado') {
    return { tipo: 'sem_rascunho' };
  }
  return { tipo: 'indisponivel' };
}

/** Interpreta POST e PATCH do rascunho. 200/201 = gravado; 429 = limite; o resto = falha (E-07). */
export function interpretarEscrita(status) {
  if (status === 200 || status === 201) return { tipo: 'ok' };
  if (status === 429) return { tipo: 'limite' };
  return { tipo: 'falha' };
}

/** Texto visivel de um desfecho de erro de "Continuar". */
export function textoDoErro(tipo) {
  if (tipo === 'limite') return INICIO_TEXTOS.muitasTentativas;
  return INICIO_TEXTOS.semConexao;
}
