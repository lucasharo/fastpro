/* global document, fetch, location */
// #155 (desenho 178, §7.4 e §7.6, AD-155-03) | Guarda de sessao por sonda de API (o cookie de sessao e HttpOnly, nao e lido aqui).
// A pagina marca o <main data-guarda="<area>" data-sonda="<rota>" data-caminho="<rota atual>"> e o conteudo protegido com
// data-protegido e hidden. So e revelado depois da resposta: 200 ou 404 liberam; 401 ou 403 mandam entrar;
// rede ou 5xx mostram "Tentar de novo" e nao liberam dado.
import { decidirSonda, montarEntrada } from '/navegacao-logica.js';

export const TEXTOS = Object.freeze({
  verificando: 'Verificando seu acesso…',
  indisponivel: 'Não foi possível verificar seu acesso agora. Tente de novo em instantes.',
  tentar: 'Tentar de novo'
});

const CABECALHO_REQUISICAO = Object.freeze({
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  headers: { Accept: 'application/json' }
});

export function iniciarGuarda({ doc, fetchFn, navegar }) {
  const principal = doc.querySelector('[data-guarda]');
  const area = principal.getAttribute('data-guarda');
  const sonda = principal.getAttribute('data-sonda');
  const caminho = principal.getAttribute('data-caminho');
  const estado = doc.getElementById('guarda-estado');
  const tentar = doc.getElementById('guarda-tentar');
  const protegidos = doc.querySelectorAll('[data-protegido]');

  async function verificar() {
    tentar.hidden = true;
    estado.textContent = TEXTOS.verificando;
    principal.setAttribute('aria-busy', 'true');
    let status;
    try {
      status = (await fetchFn(sonda, CABECALHO_REQUISICAO)).status;
    } catch {
      status = null;
    }
    const acao = decidirSonda(status);
    if (acao === 'entrar') {
      navegar(montarEntrada(area, caminho));
      return;
    }
    if (acao === 'liberar') {
      for (const bloco of protegidos) bloco.hidden = false;
      estado.textContent = '';
      principal.setAttribute('aria-busy', 'false');
      return;
    }
    estado.textContent = TEXTOS.indisponivel;
    tentar.hidden = false;
    principal.setAttribute('aria-busy', 'false');
  }

  tentar.addEventListener('click', () => verificar());
  return verificar();
}

if (typeof document !== 'undefined' && document.querySelector('[data-guarda]')) {
  iniciarGuarda({
    doc: document,
    fetchFn: (url, opcoes) => fetch(url, opcoes),
    navegar: (caminho) => location.replace(caminho)
  });
}
