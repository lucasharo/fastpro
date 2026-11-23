'use client';
// Entrada do profissional (POST /v1/auth/professional/login). Acesso completo vai ao painel.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MolduraConta } from '@/components/ContaProfissional';
import { Icone } from '@/components/Icone';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';

export default function EntrarProfissional() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  const [info, setInfo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }
    setOcupado(true);
    const r = await chamarApi<{ email_verified?: boolean; access_level?: string }>('/v1/auth/professional/login', {
      body: { email: email.trim(), password: senha },
    });
    setOcupado(false);
    setSenha('');
    if (r.status === 200 && r.corpo) {
      if (r.corpo.email_verified === true && r.corpo.access_level === 'full') router.push('/profissional/painel');
      else setPrecisaConfirmar(true);
      return;
    }
    if (r.status === 401) setErro('E-mail ou senha incorretos.');
    else if (r.status === 403) setErro('Esta conta não está disponível. Fale com o suporte.');
    else if (r.status === 429) setErro(MENSAGEM_LIMITE);
    else setErro('Não foi possível entrar agora. Tente de novo.');
  }

  async function reenviar() {
    const r = await chamarApi('/v1/auth/professional/verification/resend', { body: { email: email.trim() } });
    setInfo(r.status === 202 ? 'Enviamos o link de confirmação de novo.' : r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível reenviar agora.');
  }

  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Bem-vindo" destaque="de volta" texto="Entre para ver os pedidos da sua região.">
      <form className="form" onSubmit={enviar} noValidate>
        <Campo id="email" rotulo="E-mail">
          <input id="email" className="entrada" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo id="senha" rotulo="Senha">
          <input id="senha" className="entrada" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <div style={{ textAlign: 'right', marginTop: '-0.5rem' }}>
          <Link href="/profissional/recuperar" className="campo-dica" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>
            Esqueci minha senha
          </Link>
        </div>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {precisaConfirmar ? (
          <Aviso tipo="alerta">
            Falta confirmar seu e-mail. Abra o link que enviamos.{' '}
            <button type="button" onClick={() => void reenviar()} style={{ background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}>
              Reenviar link
            </button>
          </Aviso>
        ) : null}
        {info ? <Aviso tipo="info">{info}</Aviso> : null}
        <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
          {ocupado ? 'Entrando…' : 'Entrar'} <Icone nome="seta" tamanho={18} />
        </button>
        <p className="campo-dica" style={{ textAlign: 'center' }}>
          Ainda não tem conta? <Link href="/profissional/cadastro" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Cadastre-se grátis</Link>
        </p>
      </form>
    </MolduraConta>
  );
}
