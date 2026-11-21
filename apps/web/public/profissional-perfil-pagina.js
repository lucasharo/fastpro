/* global document, fetch, location */
// #155 (desenho 178, §7.3, S6c, AD-155-06, AD-155-11) | Perfil do profissional em leitura: nome, servicos ativos, base e raio.
// Guarda: sem sessao (401/403) vai para a entrada; sem aprovacao (perfilLiberado) vai para a situacao.
// A edicao de servicos, base e raio nao existe nesta entrega (D-1). Sem innerHTML: so textContent.
import { decidirSonda, montarEntrada, perfilLiberado } from '/navegacao-logica.js';

export const TEXTOS = Object.freeze({
  verificando: 'Verificando seu acesso…',
  carregando: 'Carregando seu perfil…',
  erro: 'Não foi possível carregar seu perfil agora. Tente de novo em instantes.',
  tentar: 'Tentar de novo',
  semBase: 'Base e raio ainda não definidos.',
  semServicos: 'Nenhum serviço ativo.',
  rotuloNome: 'Nome público',
  rotuloServicos: 'Serviços ativos',
  rotuloBase: 'Base',
  rotuloRaio: 'Raio de atendimento'
});

const CABECALHO_REQUISICAO = Object.freeze({
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  headers: { Accept: 'application/json' }
});

/** Lista de nomes dos servicos ativos (so os de active === true, com nome em texto). */
export function servicosAtivos(corpo) {
  const lista = Array.isArray(corpo?.services) ? corpo.services : [];
  return lista.filter((s) => s && s.active === true && typeof s.name === 'string').map((s) => s.name);
}

/** Texto de base e raio, ou a frase de "ainda nao definidos" quando configured nao e verdadeiro. */
export function baseERaio(corpo) {
  if (!corpo || corpo.configured !== true) return { definido: false };
  return {
    definido: true,
    base: typeof corpo.addressLabel === 'string' ? corpo.addressLabel : '',
    raio: Number.isFinite(corpo.radiusKm) ? `${corpo.radiusKm} km` : ''
  };
}

export function iniciarPerfil({ doc, fetchFn, navegar }) {
  const principal = doc.getElementById('conteudo') || doc.querySelector('main');
  const estado = doc.getElementById('estado');
  const area = doc.getElementById('conteudo-perfil');
  const erro = doc.getElementById('erro-geral');
  const tentar = doc.getElementById('tentar');

  function mostrarErro() {
    estado.textContent = '';
    area.hidden = true;
    erro.textContent = TEXTOS.erro;
    tentar.hidden = false;
    principal.setAttribute('aria-busy', 'false');
  }

  async function pedir(caminho) {
    const resposta = await fetchFn(caminho, CABECALHO_REQUISICAO);
    return resposta;
  }

  function linha(rotulo, valor) {
    const p = doc.createElement('p');
    const forte = doc.createElement('strong');
    forte.textContent = `${rotulo}: `;
    const texto = doc.createElement('span');
    texto.textContent = valor;
    p.appendChild(forte);
    p.appendChild(texto);
    area.appendChild(p);
  }

  async function desenhar() {
    erro.textContent = '';
    tentar.hidden = true;
    estado.textContent = TEXTOS.carregando;
    let perfil;
    let servicos;
    let base;
    try {
      const r1 = await pedir('/api/v1/professional/profile');
      const r2 = await pedir('/api/v1/professional/profile/services');
      const r3 = await pedir('/api/v1/professional/profile/area');
      for (const r of [r1, r2, r3]) {
        if (r.status === 401 || r.status === 403) {
          navegar(montarEntrada('profissional', '/profissional-perfil'));
          return;
        }
        if (r.status !== 200) {
          mostrarErro();
          return;
        }
      }
      perfil = await r1.json();
      servicos = await r2.json();
      base = await r3.json();
    } catch {
      mostrarErro();
      return;
    }
    area.textContent = '';
    linha(TEXTOS.rotuloNome, typeof perfil?.publicName === 'string' ? perfil.publicName : '');
    const ativos = servicosAtivos(servicos);
    linha(TEXTOS.rotuloServicos, ativos.length > 0 ? ativos.join(', ') : TEXTOS.semServicos);
    const local = baseERaio(base);
    if (local.definido) {
      linha(TEXTOS.rotuloBase, local.base);
      linha(TEXTOS.rotuloRaio, local.raio);
    } else {
      linha(TEXTOS.rotuloBase, TEXTOS.semBase);
    }
    area.hidden = false;
    estado.textContent = '';
    principal.setAttribute('aria-busy', 'false');
  }

  async function iniciar() {
    estado.textContent = TEXTOS.verificando;
    let resposta;
    try {
      resposta = await pedir('/api/v1/professional/verificacao');
    } catch {
      mostrarErro();
      return;
    }
    if (decidirSonda(resposta.status) === 'entrar') {
      navegar(montarEntrada('profissional', '/profissional-perfil'));
      return;
    }
    if (resposta.status !== 200) {
      mostrarErro();
      return;
    }
    let corpo;
    try {
      corpo = await resposta.json();
    } catch {
      mostrarErro();
      return;
    }
    if (!perfilLiberado(corpo?.estado)) {
      navegar('/profissional-situacao');
      return;
    }
    await desenhar();
  }

  tentar.addEventListener('click', () => iniciar());
  return iniciar();
}

if (typeof document !== 'undefined' && document.getElementById('conteudo-perfil')) {
  iniciarPerfil({
    doc: document,
    fetchFn: (url, opcoes) => fetch(url, opcoes),
    navegar: (caminho) => location.replace(caminho)
  });
}
