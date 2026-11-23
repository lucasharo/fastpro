'use client';
// Botao que alterna entre tema claro e escuro. Grava a escolha em data-theme no <html> (os tokens EDS ja
// respondem a [data-theme='light'] e [data-theme='dark']) e guarda a preferencia neste navegador.
// Sem escolha salva, segue o tema do sistema.
import { useEffect, useState } from 'react';
import { Icone } from './Icone';

export const CHAVE_TEMA = 'fastpro-tema';

/** Script que roda antes da pintura: aplica o tema salvo e evita o "piscar" do tema errado. */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem('${CHAVE_TEMA}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

type Tema = 'light' | 'dark';

function temaAtual(): Tema {
  const salvo = document.documentElement.dataset.theme;
  if (salvo === 'light' || salvo === 'dark') return salvo;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function TrocaTema() {
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    setTema(temaAtual());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const seguirSistema = () => {
      if (!document.documentElement.dataset.theme) setTema(temaAtual());
    };
    mq.addEventListener('change', seguirSistema);
    return () => mq.removeEventListener('change', seguirSistema);
  }, []);

  function alternar() {
    const novo: Tema = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      /* sem armazenamento: vale so nesta visita */
    }
    setTema(novo);
  }

  const escuro = tema === 'dark';
  return (
    <button
      type="button"
      className="btn-icone troca-tema"
      onClick={alternar}
      aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
    >
      <Icone nome={escuro ? 'sol' : 'lua'} tamanho={18} />
    </button>
  );
}
