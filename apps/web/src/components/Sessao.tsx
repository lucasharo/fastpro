'use client';
// Papel da sessao (GET /v1/auth/me) para a tela inteira: o cabecalho e o rodape mostram so os itens do papel, e a
// guarda leva cada papel para a sua area quando ele abre uma tela do outro. A API continua sendo a autoridade:
// isto so organiza a navegacao.
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { chamarApi } from '@/lib/api';
import { Carregando } from './ui';

export type Papel = 'cliente' | 'profissional' | 'anonimo';

interface ValorSessao {
  /** undefined enquanto a primeira consulta nao voltou. */
  readonly papel: Papel | undefined;
  readonly recarregar: () => Promise<void>;
  readonly sair: () => Promise<void>;
}

const ContextoSessao = createContext<ValorSessao>({
  papel: undefined,
  recarregar: async () => undefined,
  sair: async () => undefined,
});

export function useSessao(): ValorSessao {
  return useContext(ContextoSessao);
}

/** Telas exclusivas de cada papel (e as de entrada de quem ainda nao entrou). */
const SO_PROFISSIONAL = (p: string) => p === '/profissional' || p.startsWith('/profissional/');
const ENTRADA_PROFISSIONAL = ['/profissional', '/profissional/entrar', '/profissional/cadastro', '/profissional/recuperar'];
const SO_CLIENTE = (p: string) => p.startsWith('/painel') || p.startsWith('/pedido');

export const INICIO_DO_PAPEL: Record<Exclude<Papel, 'anonimo'>, string> = {
  cliente: '/painel',
  profissional: '/profissional/painel',
};

/** Para onde levar este papel nesta tela, ou null quando a tela e dele (ou publica). */
export function destinoDaGuarda(papel: Papel | undefined, caminho: string): string | null {
  if (papel === 'profissional') {
    if (caminho === '/' || caminho === '/entrar' || SO_CLIENTE(caminho) || ENTRADA_PROFISSIONAL.includes(caminho)) {
      return INICIO_DO_PAPEL.profissional;
    }
  }
  if (papel === 'cliente') {
    if (caminho === '/entrar' || SO_PROFISSIONAL(caminho)) return INICIO_DO_PAPEL.cliente;
  }
  return null;
}

export function ProvedorSessao({ children }: { readonly children: ReactNode }) {
  const caminho = usePathname() ?? '/';
  const router = useRouter();
  const [papel, setPapel] = useState<Papel | undefined>(undefined);

  const recarregar = useCallback(async () => {
    const r = await chamarApi<{ papel?: string }>('/v1/auth/me');
    if (r.status === 200 && (r.corpo?.papel === 'cliente' || r.corpo?.papel === 'profissional')) setPapel(r.corpo.papel);
    else if (r.status === 401 || r.status === 404) setPapel('anonimo');
    // Falha de rede: mantem o papel conhecido (nao derruba a navegacao).
    else setPapel((atual) => atual ?? 'anonimo');
  }, []);

  // Consulta a cada troca de tela: depois de entrar ou sair, o menu acompanha.
  useEffect(() => {
    void recarregar();
  }, [caminho, recarregar]);

  const sair = useCallback(async () => {
    await chamarApi('/v1/auth/logout', { body: {} });
    setPapel('anonimo');
    router.push('/');
  }, [router]);

  const destino = destinoDaGuarda(papel, caminho);
  useEffect(() => {
    if (destino !== null) router.replace(destino);
  }, [destino, router]);

  return (
    <ContextoSessao.Provider value={{ papel, recarregar, sair }}>
      {destino !== null ? (
        <div className="pagina">
          <Carregando texto="Abrindo sua área…" />
        </div>
      ) : (
        children
      )}
    </ContextoSessao.Provider>
  );
}
