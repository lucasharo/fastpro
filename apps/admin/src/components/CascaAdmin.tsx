'use client';
// Casca do console admin no visual da web: cabecalho de vidro com a marca e o botao de tema, faixa de aurora
// no topo da area interna e menu lateral de vidro. Abaixo de 1024 px o menu lateral some e vira uma gaveta aberta
// pelo botao de menu do cabecalho (mesmo padrao da web). A permissao continua na API:
// cada tela responde como inexistente quando a sessao nao tem acesso, entao o menu so organiza a navegacao.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icone, type NomeIcone } from './Icone';
import { TrocaTema } from './TrocaTema';

const MENU: readonly { readonly href: string; readonly rotulo: string; readonly icone: NomeIcone }[] = [
  { href: '/console/verificacao', rotulo: 'Verificação', icone: 'escudo' },
  { href: '/console/catalogo', rotulo: 'Catálogo', icone: 'documento' },
  { href: '/console/operacao', rotulo: 'Operação', icone: 'painel' },
  { href: '/console/denuncias', rotulo: 'Denúncias', icone: 'alerta' },
  { href: '/console/avaliacoes', rotulo: 'Avaliações', icone: 'estrela' },
  { href: '/console/auditoria', rotulo: 'Auditoria', icone: 'documento' },
  { href: '/console/equipe', rotulo: 'Equipe', icone: 'usuario' },
];

export function CascaAdmin({ children }: { readonly children: ReactNode }) {
  const caminho = usePathname() ?? '';
  const router = useRouter();
  const naEntrada = caminho === '/entrar';
  const [aberto, setAberto] = useState(false);

  const cabecalho = useRef<HTMLElement>(null);

  // Fecha a gaveta ao trocar de tela, com a tecla Esc e com clique ou toque fora do cabecalho.
  useEffect(() => setAberto(false), [caminho]);
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    const fora = (e: PointerEvent) => {
      if (!cabecalho.current?.contains(e.target as Node)) setAberto(false);
    };
    window.addEventListener('keydown', tecla);
    document.addEventListener('pointerdown', fora);
    return () => {
      window.removeEventListener('keydown', tecla);
      document.removeEventListener('pointerdown', fora);
    };
  }, [aberto]);

  const itens = (aoClicar?: () => void) =>
    MENU.map((m) => (
      <Link
        key={m.href}
        href={m.href}
        className="menu-item"
        onClick={aoClicar}
        aria-current={caminho === m.href || caminho.startsWith(`${m.href}/`) ? 'page' : undefined}
      >
        <Icone nome={m.icone} tamanho={18} />
        {m.rotulo}
      </Link>
    ));

  async function sair() {
    await fetch('/api/v1/admin/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    router.push('/entrar');
    router.refresh();
  }

  return (
    <>
      <header className="nav" ref={cabecalho}>
        <nav className="nav-barra glass-card" aria-label="Principal">
          <Link href="/console" className="marca" aria-label="FastPro Admin, página inicial">
            <Icone nome="raio" tamanho={28} className="marca-icone" preenchido />
            <span>FastPro Admin</span>
          </Link>
          <div className="nav-acoes">
            <TrocaTema />
            {naEntrada ? null : (
              <>
                <button type="button" className="btn-link so-largo" onClick={() => void sair()}>
                  Sair
                </button>
                <button
                  type="button"
                  className="nav-menu-botao so-estreito"
                  aria-expanded={aberto}
                  aria-controls="menu-gaveta"
                  aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
                  onClick={() => setAberto((v) => !v)}
                >
                  <Icone nome={aberto ? 'fechar' : 'menu'} tamanho={24} />
                </button>
              </>
            )}
          </div>
        </nav>
        {aberto && !naEntrada ? (
          <nav id="menu-gaveta" className="menu-gaveta glass-card so-estreito" aria-label="Console administrativo">
            {itens(() => setAberto(false))}
            <hr className="divisor" />
            <button type="button" className="menu-item menu-item-botao" onClick={() => void sair()}>
              <Icone nome="sair" tamanho={18} />
              Sair
            </button>
          </nav>
        ) : null}
      </header>
      <div className="pagina">
        <div className="pagina-topo">
          <div className="aurora-bg" />
        </div>
        {naEntrada ? (
          <div className="pagina-conteudo pagina-estreita">{children}</div>
        ) : (
        <div className="pagina-conteudo layout-painel">
          <nav className="glass-card menu-lateral" aria-label="Console administrativo">
            {itens()}
          </nav>
          <main className="conteudo-console">{children}</main>
        </div>
        )}
      </div>
    </>
  );
}
