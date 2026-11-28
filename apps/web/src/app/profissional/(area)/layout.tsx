'use client';
// Area logada do profissional: menu lateral de vidro e conteudo. Sem sessao, cada tela leva a entrada.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icone } from '@/components/Icone';
import { MENU_PROFISSIONAL } from '@/components/menu-profissional';
import { useSessao } from '@/components/Sessao';

export default function LayoutArea({ children }: { readonly children: ReactNode }) {
  const caminho = usePathname() ?? '';
  const { sair } = useSessao();

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <div className="aurora-bg" />
      </div>
      <div className="pagina-conteudo layout-painel">
        <nav className="glass-card menu-lateral" aria-label="Área do profissional">
          {MENU_PROFISSIONAL.map((m) => (
            <Link key={m.href} href={m.href} className="menu-item" aria-current={caminho === m.href || caminho.startsWith(`${m.href}/`) ? 'page' : undefined}>
              <Icone nome={m.icone} tamanho={18} />
              {m.rotulo}
            </Link>
          ))}
          <hr className="divisor" style={{ margin: '0.5rem 0' }} />
          <button type="button" className="menu-item" style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => void sair()}>
            <Icone nome="sair" tamanho={18} />
            Sair
          </button>
        </nav>
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
