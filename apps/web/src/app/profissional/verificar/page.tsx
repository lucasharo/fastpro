'use client';
// Links antigos de confirmacao (/profissional/verificar#t=...). A confirmacao agora e por codigo de 6 digitos
// (decisao do dono, 2026-11-23): esta pagina so orienta a entrar, onde o codigo e pedido.
import Link from 'next/link';
import { MolduraConta } from '@/components/ContaProfissional';
import { Aviso } from '@/components/ui';

export default function Verificar() {
  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Confirmar" destaque="e-mail">
      <div className="form">
        <Aviso tipo="info">A confirmação agora é por código. Entre com seu e-mail e senha: enviamos um código para você digitar.</Aviso>
        <Link href="/profissional/entrar" className="btn btn-primary btn-bloco">
          Ir para a entrada
        </Link>
      </div>
    </MolduraConta>
  );
}
