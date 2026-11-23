'use client';
// Cadastro do profissional (POST /v1/auth/professional/register). Resposta igual para e-mail novo ou ja usado.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MolduraConta, MOTIVOS_SENHA } from '@/components/ContaProfissional';
import { Icone } from '@/components/Icone';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';

export default function Cadastro() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<{ email?: string; senha?: string; geral?: string }>({});
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [info, setInfo] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const er: typeof erros = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) er.email = 'Digite um e-mail válido.';
    if (senha.length < 8) er.senha = MOTIVOS_SENHA.curta;
    setErros(er);
    if (er.email || er.senha) return;
    setOcupado(true);
    const r = await chamarApi<{ campo?: string; motivo?: string }>('/v1/auth/professional/register', {
      body: { email: email.trim(), password: senha },
    });
    setOcupado(false);
    setSenha('');
    if (r.status === 202) setEnviado(true);
    else if (r.status === 422)
      setErros(r.corpo?.campo === 'email' ? { email: 'Digite um e-mail válido.' } : { senha: MOTIVOS_SENHA[r.corpo?.motivo ?? ''] ?? 'Escolha outra senha.' });
    else setErros({ geral: r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível criar a conta agora. Tente de novo.' });
  }

  async function reenviar() {
    const r = await chamarApi('/v1/auth/professional/verification/resend', { body: { email: email.trim() } });
    setInfo(r.status === 202 ? 'Se houver uma conta para este e-mail, enviamos o link de novo.' : r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível reenviar agora.');
  }

  return (
    <MolduraConta sobretitulo="Para profissionais" titulo="Crie sua" destaque="conta grátis" texto="Depois, envie seu documento. Com a aprovação, você ganha 14 dias grátis.">
      {enviado ? (
        <div className="form">
          <div className="circulo-icone">
            <Icone nome="email" />
          </div>
          <h2 style={{ fontSize: '1.25rem' }}>Confira seu e-mail</h2>
          <p className="texto-suave">
            Se o endereço {email.trim()} puder ser usado, enviamos um link para confirmar. Abra o link para continuar.
          </p>
          {info ? <Aviso tipo="info">{info}</Aviso> : null}
          <button type="button" className="btn btn-secondary" onClick={() => void reenviar()}>
            Reenviar link
          </button>
          <Link href="/profissional/entrar" className="btn btn-primary">
            Ir para a entrada
          </Link>
        </div>
      ) : (
        <form className="form" onSubmit={enviar} noValidate>
          <Campo id="email" rotulo="E-mail" erro={erros.email}>
            <input id="email" className="entrada" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={erros.email ? 'true' : undefined} />
          </Campo>
          <Campo id="senha" rotulo="Senha" erro={erros.senha} dica="Pelo menos 8 caracteres.">
            <input id="senha" className="entrada" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} aria-invalid={erros.senha ? 'true' : undefined} />
          </Campo>
          {erros.geral ? <Aviso tipo="erro">{erros.geral}</Aviso> : null}
          <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
            {ocupado ? 'Criando…' : 'Criar conta'} <Icone nome="seta" tamanho={18} />
          </button>
          <p className="campo-dica" style={{ textAlign: 'center' }}>
            Já tem conta? <Link href="/profissional/entrar" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Entrar</Link>
          </p>
        </form>
      )}
    </MolduraConta>
  );
}
