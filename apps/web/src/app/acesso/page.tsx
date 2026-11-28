'use client';
// Link de acesso do e-mail (/acesso#t=...). O token sai da barra de endereco na carga e so vai a API no clique.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, PaginaInterna } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, tokenDoFragmento } from '@/lib/api';

type Estado = 'pronto' | 'sem_link' | 'enviando' | 'confirmado' | 'invalido' | 'indisponivel';

export default function Acesso() {
  const token = useRef<string | null>(null);
  const [estado, setEstado] = useState<Estado>('pronto');

  useEffect(() => {
    token.current = tokenDoFragmento(window.location.hash);
    history.replaceState(null, '', '/acesso');
    if (token.current === null) setEstado('sem_link');
  }, []);

  async function confirmar() {
    const valor = token.current;
    if (!valor) return;
    token.current = null;
    setEstado('enviando');
    const r = await chamarApi('/v1/auth/challenges/consume', { body: { token: valor } });
    if (r.status === 200) {
      const s = await chamarApi('/v1/auth/session', { body: {} });
      setEstado(s.status === 200 ? 'confirmado' : s.status === 401 ? 'invalido' : 'indisponivel');
      return;
    }
    setEstado(r.status === 400 || r.status === 404 || r.status === 410 ? 'invalido' : 'indisponivel');
  }

  return (
    <PaginaInterna largura="estreita">
      <CabecaPagina sobretitulo="Acesso" titulo="Confirmar" destaque="seu e-mail" />
      <div className="glass-card painel-cartao form">
        {estado === 'pronto' || estado === 'enviando' ? (
          <>
            <p className="texto-suave">Clique para confirmar que este e-mail é seu e continuar de onde parou.</p>
            <button type="button" className="btn btn-primary btn-bloco" onClick={confirmar} disabled={estado === 'enviando'}>
              {estado === 'enviando' ? 'Confirmando…' : 'Confirmar e continuar'}
            </button>
          </>
        ) : null}
        {estado === 'sem_link' ? (
          <Aviso tipo="alerta">Este link não está completo. Peça um novo código na tela de entrada.</Aviso>
        ) : null}
        {estado === 'invalido' ? <Aviso tipo="erro">Este link venceu ou já foi usado. Peça um novo código.</Aviso> : null}
        {estado === 'indisponivel' ? <Aviso tipo="erro">{MENSAGEM_INDISPONIVEL}</Aviso> : null}
        {estado === 'confirmado' ? (
          <>
            <Aviso tipo="sucesso">E-mail confirmado. Você já pode continuar.</Aviso>
            <div className="linha">
              <Link href="/pedido/revisao" className="btn btn-primary btn-sm">
                Revisar meu pedido <Icone nome="seta" tamanho={16} />
              </Link>
              <Link href="/painel" className="btn btn-secondary btn-sm">
                Meus pedidos
              </Link>
            </div>
          </>
        ) : null}
        {estado === 'sem_link' || estado === 'invalido' ? (
          <Link href="/entrar" className="btn btn-secondary btn-bloco">
            Ir para a entrada
          </Link>
        ) : null}
      </div>
    </PaginaInterna>
  );
}
