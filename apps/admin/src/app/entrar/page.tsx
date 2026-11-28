'use client';
// Entrada do admin por e-mail e senha (decisao do dono, 2026-11-27). Nao ha cadastro nem recuperacao nesta tela:
// um admin e cadastrado pela tela de Equipe ou direto no banco. Com o acerto, a API abre a sessao (8 horas).
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CabecaPagina } from '../../components/CabecaPagina';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBRIGATORIO = 'Campo obrigatório.';

const validarEmail = (v: string): string =>
  v.trim() === '' ? OBRIGATORIO : EMAIL_RE.test(v.trim()) ? '' : 'Digite um e-mail válido.';
const validarSenha = (v: string): string => (v === '' ? OBRIGATORIO : '');

export default function EntrarAdmin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erroEmail, setErroEmail] = useState('');
  const [erroSenha, setErroSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const ee = validarEmail(email);
    const es = validarSenha(senha);
    setErroEmail(ee);
    setErroSenha(es);
    if (ee || es) return;
    setOcupado(true);
    let status: number;
    try {
      const r = await fetch('/api/v1/admin/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: senha }),
      });
      status = r.status;
    } catch {
      status = 0;
    }
    setOcupado(false);
    if (status === 200) {
      router.push('/console');
      router.refresh();
      return;
    }
    setErro(
      status === 401
        ? 'E-mail ou senha incorretos.'
        : status === 429
          ? 'Muitas tentativas. Aguarde 15 minutos e tente de novo.'
          : 'Não foi possível entrar agora. Tente de novo.',
    );
  }

  return (
    <div>
      <CabecaPagina titulo="Entrar no painel administrativo" descricao="Use o e-mail e a senha da sua conta de equipe." />
      <div className="glass-card cartao-painel">
        <form className="form" onSubmit={entrar} noValidate>
          <div className="campo">
            <label htmlFor="email">E-mail da equipe</label>
            <input
              id="email"
              className="entrada"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (erroEmail) setErroEmail(validarEmail(e.target.value));
              }}
              aria-invalid={erroEmail ? 'true' : undefined}
              aria-describedby={erroEmail ? 'email-erro' : undefined}
            />
            {erroEmail ? (
              <span id="email-erro" className="campo-erro" role="alert">
                {erroEmail}
              </span>
            ) : null}
          </div>
          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              className="entrada"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value);
                if (erroSenha) setErroSenha(validarSenha(e.target.value));
              }}
              aria-invalid={erroSenha ? 'true' : undefined}
              aria-describedby={erroSenha ? 'senha-erro' : undefined}
            />
            {erroSenha ? (
              <span id="senha-erro" className="campo-erro" role="alert">
                {erroSenha}
              </span>
            ) : null}
          </div>
          {erro ? (
            <p className="campo-erro" role="alert" style={{ textAlign: 'center' }}>
              {erro}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
            {ocupado ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
