'use client';
// Cabecalho de vidro flutuante (template de referencia): marca, links, chamada e gaveta no celular.
// Os itens dependem do papel da sessao: visitante, cliente ou profissional (cada um ve so o que e seu).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icone } from './Icone';
import { MENU_PROFISSIONAL } from './menu-profissional';
import { useSessao, type Papel } from './Sessao';
import { TrocaTema } from './TrocaTema';

interface ItemMenu {
  readonly href: string;
  readonly rotulo: string;
}

const MENU: Record<Papel, readonly ItemMenu[]> = {
  anonimo: [
    { href: '/#servicos', rotulo: 'Serviços' },
    { href: '/#como-funciona', rotulo: 'Como funciona' },
    { href: '/profissional', rotulo: 'Para profissionais' },
  ],
  cliente: [
    { href: '/', rotulo: 'Início' },
    { href: '/painel', rotulo: 'Meus pedidos' },
    { href: '/painel/configuracoes', rotulo: 'Configurações' },
  ],
  profissional: [
    { href: '/profissional/painel', rotulo: 'Painel' },
    { href: '/profissional/pedidos', rotulo: 'Pedidos da região' },
    { href: '/profissional/aceitos', rotulo: 'Pedidos aceitos' },
    { href: '/profissional/configuracoes', rotulo: 'Configurações' },
  ],
};

export function Marca({ href = '/' }: { readonly href?: string }) {
  return (
    <Link href={href} className="marca" aria-label="FastPro, página inicial">
      <Icone nome="raio" tamanho={28} className="marca-icone" preenchido />
      <span>FastPro</span>
    </Link>
  );
}

export function Navegacao() {
  const caminho = usePathname() ?? '';
  const { papel, sair } = useSessao();
  const [aberto, setAberto] = useState(false);
  const cabecalho = useRef<HTMLElement>(null);
  // A gaveta fecha com clique ou toque fora do cabecalho e com a tecla Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!cabecalho.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);
  // Enquanto o papel nao chega, nenhum item de area (evita mostrar o menu do papel errado por um instante).
  const itens = papel === undefined ? [] : MENU[papel];
  const inicio = papel === 'profissional' ? '/profissional/painel' : '/';
  const cobre = (href: string) => caminho === href || (href !== '/' && caminho.startsWith(`${href}/`));
  // So o item mais especifico fica marcado (ex.: Configuracoes, e nao tambem Meus pedidos).
  const ativo = (href: string) => (cobre(href) && !itens.some((i) => i.href.length > href.length && cobre(i.href)) ? 'page' : undefined);


  function acoes(fechar?: () => void) {
    if (papel === 'cliente') {
      return (
        <>
          <button type="button" className="nav-link nav-sair" onClick={() => void sair()}>
            Sair
          </button>
          <Link href="/pedido" className="btn btn-primary btn-sm" onClick={fechar}>
            Pedir orçamento
          </Link>
        </>
      );
    }
    if (papel === 'profissional') {
      return (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sair()}>
          <Icone nome="sair" tamanho={16} /> Sair
        </button>
      );
    }
    if (papel === 'anonimo') {
      return (
        <>
          <Link href="/entrar" className="nav-link" onClick={fechar}>
            Entrar
          </Link>
          <Link href="/pedido" className="btn btn-primary btn-sm" onClick={fechar}>
            Pedir orçamento
          </Link>
        </>
      );
    }
    return null;
  }

  return (
    <header className="nav" ref={cabecalho}>
      <nav className="nav-barra glass-card" aria-label="Principal">
        <Marca href={inicio} />
        <div className="nav-links">
          {itens.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={ativo(l.href)}>
              {l.rotulo}
            </Link>
          ))}
        </div>
        <div className="nav-acoes">
          <TrocaTema />
          {acoes()}
        </div>
        <div className="nav-celular">
          <TrocaTema />
          <button
            type="button"
            className="nav-menu-botao"
            aria-expanded={aberto}
            aria-controls="nav-gaveta"
            aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setAberto((v) => !v)}
          >
            <Icone nome={aberto ? 'fechar' : 'menu'} tamanho={24} />
          </button>
        </div>
      </nav>
      {aberto ? (
        <div id="nav-gaveta" className="nav-gaveta glass-card">
          {papel === 'profissional'
            ? // No celular a barra lateral some: a gaveta leva o menu completo da area.
              MENU_PROFISSIONAL.map((m) => (
                <Link key={m.href} href={m.href} className="menu-item" aria-current={cobre(m.href) ? 'page' : undefined} onClick={() => setAberto(false)}>
                  <Icone nome={m.icone} tamanho={18} />
                  {m.rotulo}
                </Link>
              ))
            : itens.map((l) => (
                <Link key={l.href} href={l.href} className="nav-link" onClick={() => setAberto(false)}>
                  {l.rotulo}
                </Link>
              ))}
          {acoes(() => setAberto(false))}
        </div>
      ) : null}
    </header>
  );
}
