'use client';
// Confirmacao do e-mail do profissional pelo link (#t=...): POST /v1/auth/professional/verification/confirm.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MolduraConta } from '@/components/ContaProfissional';
import { Aviso } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, tokenDoFragmento } from '@/lib/api';

export default function Verificar() {
  const token = useRef<string | null>(null);
  const [estado, setEstado] = useState<'pronto' | 'sem_link' | 'enviando' | 'ok' | 'vencido' | 'erro'>('pronto');

  useEffect(() => {
    token.current = tokenDoFragmento(window.location.hash);
    history.replaceState(null, '', '/profissional/verificar');
    if (!token.current) setEstado('sem_link');
  }, []);

  async function confirmar() {
    if (!token.current) return;
    setEstado('enviando');
    const r = await chamarApi('/v1/auth/professional/verification/confirm', { body: { token: token.current } });
    if (r.status === 204 || r.status === 200) {
      token.current = null;
      setEstado('ok');
    } else if (r.status === 410 || r.status === 400) {
      token.current = null;
      setEstado('vencido');
    } else setEstado('erro');
  }

  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Confirmar" destaque="e-mail">
      <div className="form">
        {estado === 'pronto' || estado === 'enviando' ? (
          <>
            <p className="texto-suave">Confirme que este e-mail é seu para continuar.</p>
            <button type="button" className="btn btn-primary btn-bloco" onClick={() => void confirmar()} disabled={estado === 'enviando'}>
              {estado === 'enviando' ? 'Confirmando…' : 'Confirmar e-mail'}
            </button>
          </>
        ) : null}
        {estado === 'ok' ? (
          <>
            <Aviso tipo="sucesso">E-mail confirmado. Agora entre e envie seus documentos.</Aviso>
            <Link href="/profissional/entrar" className="btn btn-primary btn-bloco">
              Entrar
            </Link>
          </>
        ) : null}
        {estado === 'sem_link' ? <Aviso tipo="alerta">Este link não está completo. Entre e peça um novo link de confirmação.</Aviso> : null}
        {estado === 'vencido' ? <Aviso tipo="erro">Este link não pode mais ser usado. Entre e peça um novo.</Aviso> : null}
        {estado === 'erro' ? <Aviso tipo="erro">{MENSAGEM_INDISPONIVEL}</Aviso> : null}
        {estado === 'sem_link' || estado === 'vencido' ? (
          <Link href="/profissional/entrar" className="btn btn-secondary btn-bloco">
            Ir para a entrada
          </Link>
        ) : null}
      </div>
    </MolduraConta>
  );
}
