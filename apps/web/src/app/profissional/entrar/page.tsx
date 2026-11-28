'use client';
// Entrada do profissional (POST /v1/auth/professional/login). Acesso completo vai ao painel.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MolduraConta } from '@/components/ContaProfissional';
import { Icone } from '@/components/Icone';
import { ConfirmarCodigoProfissional } from '@/components/ConfirmarCodigoProfissional';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';

export default function EntrarProfissional() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  // Senha so em memoria, para entrar logo depois de confirmar o codigo.
  const [senhaEnviada, setSenhaEnviada] = useState('');
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
    if (r.status === 200 && r.corpo) {
      if (r.corpo.email_verified === true && r.corpo.access_level === 'full') {
        setOcupado(false);
        setSenha('');
        router.push('/profissional/painel');
        return;
      }
      // Conta ainda sem e-mail confirmado: manda um codigo novo e pede na tela.
      await chamarApi('/v1/auth/professional/verification/resend', { body: { email: email.trim() } });
      setOcupado(false);
      setSenhaEnviada(senha);
      setSenha('');
      setPrecisaConfirmar(true);
      return;
    }
    setOcupado(false);
    setSenha('');
    if (r.status === 401) setErro('E-mail ou senha incorretos.');
    else if (r.status === 403) setErro('Esta conta não está disponível. Fale com o suporte.');
    else if (r.status === 429) setErro(MENSAGEM_LIMITE);
    else setErro('Não foi possível entrar agora. Tente de novo.');
  }

  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Bem-vindo" destaque="de volta" texto="Entre para ver os pedidos da sua região.">
      {precisaConfirmar ? (
        <ConfirmarCodigoProfissional
          email={email.trim()}
          senha={senhaEnviada}
          aoTrocarEmail={() => {
            setPrecisaConfirmar(false);
            setSenhaEnviada('');
          }}
        />
      ) : (
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
        <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
          {ocupado ? 'Entrando…' : 'Entrar'} <Icone nome="seta" tamanho={18} />
        </button>
        <p className="campo-dica" style={{ textAlign: 'center' }}>
          Ainda não tem conta? <Link href="/profissional/cadastro" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Cadastre-se grátis</Link>
        </p>
      </form>
      )}
    </MolduraConta>
  );
}
