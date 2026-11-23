'use client';
// Cabecalho de vidro flutuante (template de referencia): marca, links, chamada e gaveta no celular.
// Os itens dependem do papel da sessao: visitante, cliente ou profissional (cada um ve so o que e seu).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { chamarApi } from '@/lib/api';
import { Icone } from './Icone';
import { useSessao, type Papel } from './Sessao';
import { TrocaTema } from './TrocaTema';

interface ItemMenu {
  readonly href: string;
  readonly rotulo: string;
  /** Mostra o contador de conversas nao lidas ao lado deste item. */
  readonly naoLidas?: boolean;
}

const MENU: Record<Papel, readonly ItemMenu[]> = {
  anonimo: [
    { href: '/#servicos', rotulo: 'Serviços' },
    { href: '/#como-funciona', rotulo: 'Como funciona' },
    { href: '/profissional', rotulo: 'Para profissionais' },
  ],
  cliente: [
    { href: '/', rotulo: 'Início' },
    { href: '/painel', rotulo: 'Meus pedidos', naoLidas: true },
  ],
  profissional: [
    { href: '/profissional/painel', rotulo: 'Painel' },
    { href: '/profissional/pedidos', rotulo: 'Pedidos da região' },
    { href: '/profissional/conversas', rotulo: 'Conversas', naoLidas: true },
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
  // Total de conversas nao lidas (H-101). So com sessao.
  const [naoLidas, setNaoLidas] = useState(0);
  const logado = papel === 'cliente' || papel === 'profissional';
  const atualizarNaoLidas = useCallback(async () => {
    const r = await chamarApi<{ total?: number }>('/v1/conversations/unread');
    setNaoLidas(r.status === 200 && typeof r.corpo?.total === 'number' ? r.corpo.total : 0);
  }, []);
  useEffect(() => {
    if (!logado) {
      setNaoLidas(0);
      return;
    }
    void atualizarNaoLidas();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void atualizarNaoLidas();
    }, 30000);
    return () => clearInterval(t);
  }, [caminho, logado, atualizarNaoLidas]);

  // Enquanto o papel nao chega, nenhum item de area (evita mostrar o menu do papel errado por um instante).
  const itens = papel === undefined ? [] : MENU[papel];
  const inicio = papel === 'profissional' ? '/profissional/painel' : '/';
  const ativo = (href: string) => (caminho === href || (href !== '/' && caminho.startsWith(`${href}/`)) ? 'page' : undefined);

  function contador(item: ItemMenu) {
    return item.naoLidas && naoLidas > 0 ? (
      <span className="selo selo-sm selo-alerta selo-contador" aria-label={`${naoLidas} conversas com mensagens não lidas`}>
        {naoLidas}
      </span>
    ) : null;
  }

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
    <header className="nav">
      <nav className="nav-barra glass-card" aria-label="Principal">
        <Marca href={inicio} />
        <div className="nav-links">
          {itens.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={ativo(l.href)}>
              {l.rotulo}
              {contador(l)}
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
          {itens.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" onClick={() => setAberto(false)}>
              {l.rotulo}
              {contador(l)}
            </Link>
          ))}
          {acoes(() => setAberto(false))}
        </div>
      ) : null}
    </header>
  );
}
