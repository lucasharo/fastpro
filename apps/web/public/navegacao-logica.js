// #155 (desenho 178, AD-155-02, 03, 05, 06, 11, 12) | Logica pura da navegacao entre as telas. Sem DOM, sem rede e sem relogio.
// Fonte unica da tabela de rotas: o gerador de blocos (scripts/navegacao-blocos.mjs) e os testes leem daqui.
// Modulo ES: carregado com <script type="module"> nas telas novas e importado pelos testes.

/** Rotas do produto que aparecem na navegacao. `item` marca o item do menu principal; `subitem` o passo do profissional. */
export const ROTAS = Object.freeze([
  { rota: '/', arquivo: 'index.html', area: 'publica', item: 'inicio', subitem: null, retornavel: false },
  { rota: '/pedido', arquivo: 'pedido.html', area: 'publica', item: 'pedir', subitem: null, retornavel: false },
  { rota: '/fotos', arquivo: 'fotos.html', area: 'publica', item: 'pedir', subitem: null, retornavel: false },
  { rota: '/pedido/revisao', arquivo: 'pedido/revisao.html', area: 'publica', item: 'pedir', subitem: null, retornavel: true },
  { rota: '/entrar', arquivo: 'entrar.html', area: 'publica', item: 'entrar', subitem: null, retornavel: false },
  { rota: '/acesso', arquivo: 'acesso.html', area: 'publica', item: 'entrar', subitem: null, retornavel: false },
  { rota: '/codigo', arquivo: 'codigo.html', area: 'publica', item: 'entrar', subitem: null, retornavel: false },
  { rota: '/painel', arquivo: 'painel.html', area: 'cliente', item: 'painel', subitem: null, retornavel: true },
  { rota: '/painel/pedido', arquivo: 'painel/pedido.html', area: 'cliente', item: 'painel', subitem: null, retornavel: false },
  { rota: '/profissional/entrar', arquivo: 'profissional/entrar.html', area: 'publica', item: 'profissional', subitem: null, retornavel: false },
  { rota: '/profissional/cadastro', arquivo: 'profissional/cadastro.html', area: 'publica', item: 'profissional', subitem: null, retornavel: false },
  { rota: '/profissional/recuperar', arquivo: 'profissional/recuperar.html', area: 'publica', item: 'profissional', subitem: null, retornavel: false },
  { rota: '/profissional/redefinir', arquivo: 'profissional/redefinir.html', area: 'publica', item: 'profissional', subitem: null, retornavel: false },
  { rota: '/profissional/verificar', arquivo: 'profissional/verificar.html', area: 'publica', item: 'profissional', subitem: null, retornavel: false },
  { rota: '/profissional-documentos', arquivo: 'profissional-documentos.html', area: 'profissional', item: 'profissional', subitem: 'documentos', retornavel: true },
  { rota: '/profissional-situacao', arquivo: 'profissional-situacao.html', area: 'profissional', item: 'profissional', subitem: 'situacao', retornavel: true },
  { rota: '/profissional-perfil', arquivo: 'profissional-perfil.html', area: 'profissional', item: 'profissional', subitem: 'perfil', retornavel: true },
  { rota: '/profissional-assinatura', arquivo: 'profissional-assinatura.html', area: 'profissional', item: 'profissional', subitem: 'assinatura', retornavel: true },
  { rota: '/404', arquivo: '404.html', area: 'publica', item: null, subitem: null, retornavel: false }
]);

/** Pagina de public que nao aparece na navegacao (redireciona; AD-155-08). */
export const SEM_NAVEGACAO = Object.freeze(['profissional-documento.html']);

/** Estado da verificacao que libera o perfil (valor exato de ESTADOS_PUBLICOS_VERIFICACAO, dominio). */
export const ESTADO_APROVADO = 'aprovada';

/** Destinos de botao que a tela de situacao aceita (lista fixa; qualquer outro valor e ignorado). */
export const DESTINOS_SITUACAO = Object.freeze([
  '/profissional-documentos',
  '/profissional-situacao',
  '/profissional-perfil',
  '/profissional-assinatura',
  '/profissional/entrar',
  '/entrar',
  '/pedido',
  '/painel'
]);

/** Rota da lista que o mesmo caminho do retorno (?voltar=) pode usar. Qualquer outro valor vira nulo. */
export function rotaRetornavel(caminho) {
  const entrada = ROTAS.find((r) => r.rota === caminho);
  return entrada && entrada.retornavel ? caminho : null;
}

/**
 * Caminho da tela de entrada da area. Cliente vai a /entrar; profissional a /profissional/entrar.
 * Com caminhoAtual na lista de retorno, acrescenta ?voltar=<caminho>. Area desconhecida devolve nulo.
 */
export function montarEntrada(area, caminhoAtual) {
  const base = area === 'cliente' ? '/entrar' : area === 'profissional' ? '/profissional/entrar' : null;
  if (!base) return null;
  const retorno = rotaRetornavel(caminhoAtual);
  return retorno ? `${base}?voltar=${encodeURIComponent(retorno)}` : base;
}

/**
 * Decisao da guarda de sessao a partir do status da sonda de API (AD-155-03).
 * 200 e 404 (ainda sem registro) liberam; 401 e 403 mandam entrar; o resto (5xx, 429, falha de rede) e indisponivel.
 */
export function decidirSonda(status) {
  if (status === 200 || status === 404) return 'liberar';
  if (status === 401 || status === 403) return 'entrar';
  return 'indisponivel';
}

/** O perfil so aparece depois da aprovacao (AD-155-06, RN-NAV-08). */
export function perfilLiberado(estado) {
  return estado === ESTADO_APROVADO;
}

/** Destino de botao da situacao, somente se estiver na lista fixa. */
export function destinoSituacao(destino) {
  return DESTINOS_SITUACAO.includes(destino) ? destino : null;
}
