'use client';
// Entrada do cliente: e-mail, codigo de 6 digitos e sessao. Sem senha.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CodigoEmail, pedirCodigo } from '@/components/CodigoEmail';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo, PaginaInterna } from '@/components/ui';

export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro('Digite um e-mail válido.');
      return;
    }
    setEnviando(true);
    const falha = await pedirCodigo(email.trim(), 'login');
    setEnviando(false);
    if (falha) setErro(falha);
    else setEnviado(true);
  }

  return (
    <PaginaInterna largura="estreita">
      <CabecaPagina
        sobretitulo="Área do cliente"
        titulo="Entrar"
        destaque="sem senha"
        texto="Acompanhe seus pedidos e veja quem aceitou. Mandamos um código para o seu e-mail."
      />
      <div className="glass-card painel-cartao">
        {enviado ? (
          <CodigoEmail email={email.trim()} finalidade="login" aoConfirmar={() => router.push('/painel')} aoTrocarEmail={() => setEnviado(false)} />
        ) : (
          <form className="form" onSubmit={enviar} noValidate>
            <Campo id="email" rotulo="E-mail" erro={erro}>
              <input
                id="email"
                className="entrada"
                type="email"
                autoComplete="email"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={erro ? 'true' : undefined}
              />
            </Campo>
            <button type="submit" className="btn btn-primary btn-bloco" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Receber código'}
              <Icone nome="seta" tamanho={18} />
            </button>
            <Aviso tipo="info">
              É profissional? <Link href="/profissional/entrar" style={{ fontWeight: 700, textDecoration: 'underline' }}>Entre pela área do profissional</Link>.
            </Aviso>
          </form>
        )}
      </div>
    </PaginaInterna>
  );
}
