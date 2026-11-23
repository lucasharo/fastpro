'use client';
// Cabecalho de vidro flutuante (template de referencia): marca, links, chamada e gaveta no celular.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { chamarApi } from '@/lib/api';
import { Icone } from './Icone';
import { TrocaTema } from './TrocaTema';

const LINKS = [
  { href: '/#servicos', rotulo: 'Serviços' },
  { href: '/#como-funciona', rotulo: 'Como funciona' },
  { href: '/profissional', rotulo: 'Para profissionais' },
  { href: '/painel', rotulo: 'Meus pedidos' },
] as const;

export function Marca() {
  return (
    <Link href="/" className="marca" aria-label="FastPro, página inicial">
      <Icone nome="raio" tamanho={28} className="marca-icone" preenchido />
      <span>FastPro</span>
    </Link>
  );
}

export function Navegacao() {
  const caminho = usePathname() ?? '';
  const [aberto, setAberto] = useState(false);
  // Total de conversas nao lidas (H-101). Sem sessao a API responde 401 e nada aparece.
  const [naoLidas, setNaoLidas] = useState(0);
  const atualizarNaoLidas = useCallback(async () => {
    const r = await chamarApi<{ total?: number }>('/v1/conversations/unread');
    setNaoLidas(r.status === 200 && typeof r.corpo?.total === 'number' ? r.corpo.total : 0);
  }, []);
  useEffect(() => {
    void atualizarNaoLidas();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void atualizarNaoLidas();
    }, 30000);
    return () => clearInterval(t);
  }, [caminho, atualizarNaoLidas]);
  return (
    <header className="nav">
      <nav className="nav-barra glass-card" aria-label="Principal">
        <Marca />
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={caminho === l.href ? 'page' : undefined}>
              {l.rotulo}
              {l.href === '/painel' && naoLidas > 0 ? (
                <span className="selo selo-sm selo-alerta selo-contador" aria-label={`${naoLidas} conversas com mensagens não lidas`}>
                  {naoLidas}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
        <div className="nav-acoes">
          <TrocaTema />
          <Link href="/entrar" className="nav-link">
            Entrar
          </Link>
          <Link href="/pedido" className="btn btn-primary btn-sm">
            Pedir orçamento
          </Link>
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
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" onClick={() => setAberto(false)}>
              {l.rotulo}
            </Link>
          ))}
          <Link href="/entrar" className="nav-link" onClick={() => setAberto(false)}>
            Entrar
          </Link>
          <Link href="/pedido" className="btn btn-primary btn-sm" onClick={() => setAberto(false)}>
            Pedir orçamento
          </Link>
        </div>
      ) : null}
    </header>
  );
}
