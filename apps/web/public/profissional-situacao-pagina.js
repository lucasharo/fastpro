// #155 (desenho 178, §7.2, S6b, AD-155-03, AD-155-12) | Situacao do profissional: le GET /api/v1/professional/verificacao,
// monta a tela com construirTela (bundle do dominio) e desenha com renderizarSituacao (profissional-situacao.js).
// 401/403 = entrar; 404 = sem documento enviado ainda; falha de rede ou 5xx = erro com "Tentar de novo".
import { decidirSonda, destinoSituacao, montarEntrada } from '/navegacao-logica.js';

/** Caminho real de cada destino que o dominio devolve (documentos e recurso). Recurso ainda nao tem tela (pendencia). */
const CAMINHO_DESTINO = Object.freeze({ documentos: '/profissional-documentos' });

const CABECALHO_REQUISICAO = Object.freeze({
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  headers: { Accept: 'application/json' }
});

export function iniciarSituacao({ doc, fetchFn, navegar, construir, desenhar }) {
  const raiz = doc.getElementById('situacao');
  const principal = doc.getElementById('conteudo') || doc.querySelector('main');
  const erro = doc.getElementById('erro-geral');
  const tentar = doc.getElementById('tentar');

  function aplicarDestinos() {
    for (const botao of raiz.querySelectorAll('button[data-destino]')) {
      const caminho = CAMINHO_DESTINO[botao.getAttribute('data-destino')];
      if (!caminho || destinoSituacao(caminho) === null) {
        botao.disabled = true;
        continue;
      }
      botao.addEventListener('click', () => navegar(caminho));
    }
  }

  function mostrar(entrada) {
    desenhar(raiz, construir(entrada));
    aplicarDestinos();
  }

  async function carregar() {
    erro.textContent = '';
    tentar.hidden = true;
    mostrar({ tipo: 'carregando' });
    let resposta;
    try {
      resposta = await fetchFn('/api/v1/professional/verificacao', CABECALHO_REQUISICAO);
    } catch {
      return falhar();
    }
    if (decidirSonda(resposta.status) === 'entrar') {
      navegar(montarEntrada('profissional', '/profissional-situacao'));
      return;
    }
    if (resposta.status === 404) {
      mostrar({ tipo: 'estado', estado: { estado: 'sem_envio', recurso: { situacao: 'indisponivel' } } });
      principal.setAttribute('aria-busy', 'false');
      return;
    }
    if (resposta.status !== 200) return falhar();
    let corpo;
    try {
      corpo = await resposta.json();
    } catch {
      return falhar();
    }
    mostrar({ tipo: 'estado', estado: corpo });
    principal.setAttribute('aria-busy', 'false');
  }

  function falhar() {
    mostrar({ tipo: 'erro' });
    erro.textContent = 'Não foi possível carregar agora. Tente de novo em instantes.';
    tentar.hidden = false;
    principal.setAttribute('aria-busy', 'false');
  }

  tentar.addEventListener('click', () => carregar());
  return carregar();
}

if (typeof document !== 'undefined' && document.getElementById('situacao')) {
  const escopo = globalThis.FastProSituacao;
  iniciarSituacao({
    doc: document,
    fetchFn: (url, opcoes) => fetch(url, opcoes),
    navegar: (caminho) => location.replace(caminho),
    construir: (entrada) => escopo.construirTela(entrada),
    desenhar: (raiz, tela) => globalThis.renderizarSituacao(raiz, tela)
  });
}
