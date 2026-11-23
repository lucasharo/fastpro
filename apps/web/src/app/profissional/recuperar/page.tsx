'use client';
// Recuperacao de senha (POST /v1/auth/password/recovery). Resposta igual exista ou nao a conta.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MolduraConta } from '@/components/ContaProfissional';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';

export default function Recuperar() {
  const [email, setEmail] = useState('');
  const [estado, setEstado] = useState<'form' | 'enviado'>('form');
  const [erro, setErro] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro('Digite um e-mail válido.');
      return;
    }
    const r = await chamarApi('/v1/auth/password/recovery', { body: { email: email.trim() } });
    if (r.status === 202) setEstado('enviado');
    else setErro(r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível enviar agora. Tente de novo.');
  }

  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Recuperar" destaque="senha" texto="Mandamos um link para você criar uma senha nova.">
      {estado === 'enviado' ? (
        <div className="form">
          <Aviso tipo="sucesso">Se houver uma conta para {email.trim()}, o link chega em alguns minutos.</Aviso>
          <Link href="/profissional/entrar" className="btn btn-primary btn-bloco">
            Voltar para a entrada
          </Link>
        </div>
      ) : (
        <form className="form" onSubmit={enviar} noValidate>
          <Campo id="email" rotulo="E-mail" erro={erro}>
            <input id="email" className="entrada" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <button type="submit" className="btn btn-primary btn-bloco">
            Enviar link
          </button>
          <Link href="/profissional/entrar" className="btn btn-secondary btn-bloco">
            Voltar
          </Link>
        </form>
      )}
    </MolduraConta>
  );
}
