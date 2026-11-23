'use client';
// Area logada do profissional: menu lateral de vidro e conteudo. Sem sessao, cada tela leva a entrada.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icone, type NomeIcone } from '@/components/Icone';
import { useSessao } from '@/components/Sessao';
import { chamarApi } from '@/lib/api';

const MENU: readonly { href: string; rotulo: string; icone: NomeIcone }[] = [
  { href: '/profissional/painel', rotulo: 'Painel', icone: 'painel' },
  { href: '/profissional/pedidos', rotulo: 'Pedidos da região', icone: 'local' },
  { href: '/profissional/conversas', rotulo: 'Conversas', icone: 'conversa' },
  { href: '/profissional/avaliacoes', rotulo: 'Avaliações', icone: 'estrela' },
  { href: '/profissional/perfil', rotulo: 'Perfil e área', icone: 'usuario' },
  { href: '/profissional/documentos', rotulo: 'Documentos', icone: 'documento' },
  { href: '/profissional/assinatura', rotulo: 'Assinatura', icone: 'carteira' },
];

export default function LayoutArea({ children }: { readonly children: ReactNode }) {
  const caminho = usePathname() ?? '';
  const [naoLidas, setNaoLidas] = useState(0);

  // Contador de nao lidas (H-101) do item "Conversas": atualiza ao trocar de tela e a cada 30 s.
  const atualizarNaoLidas = useCallback(async () => {
    const r = await chamarApi<{ total?: number }>('/v1/conversations/unread');
    if (r.status === 200 && typeof r.corpo?.total === 'number') setNaoLidas(r.corpo.total);
  }, []);

  useEffect(() => {
    void atualizarNaoLidas();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void atualizarNaoLidas();
    }, 30000);
    return () => clearInterval(t);
  }, [caminho, atualizarNaoLidas]);

  const { sair } = useSessao();

  return (
    <div className="pagina">
      <div className="pagina-topo">
        <div className="aurora-bg" />
      </div>
      <div className="pagina-conteudo layout-painel">
        <nav className="glass-card menu-lateral" aria-label="Área do profissional">
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className="menu-item" aria-current={caminho === m.href || caminho.startsWith(`${m.href}/`) ? 'page' : undefined}>
              <Icone nome={m.icone} tamanho={18} />
              {m.rotulo}
              {m.href === '/profissional/conversas' && naoLidas > 0 ? (
                <span className="selo selo-sm selo-alerta selo-contador" aria-label={`${naoLidas} mensagens não lidas`}>
                  {naoLidas}
                </span>
              ) : null}
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
