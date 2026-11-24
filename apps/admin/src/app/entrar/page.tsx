'use client';
// Entrada do admin por codigo de 6 digitos no e-mail (decisao do dono, 2026-11-24). So a equipe ativa com papel
// recebe o codigo; a tela nao diz se o e-mail e da equipe. Com o codigo certo, a API abre a sessao admin (8 horas).
import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { CabecaPagina } from '../../components/CabecaPagina';

async function postar(caminho: string, corpo: unknown): Promise<number> {
  try {
    const r = await fetch(`/api${caminho}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    return r.status;
  } catch {
    return 0;
  }
}

export default function EntrarAdmin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [digitos, setDigitos] = useState<string[]>(['', '', '', '', '', '']);
  const [erro, setErro] = useState('');
  const [info, setInfo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const caixas = useRef<(HTMLInputElement | null)[]>([]);

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault();
    setErro('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro('Digite um e-mail válido.');
      return;
    }
    setOcupado(true);
    const s = await postar('/v1/admin/auth/code', { email: email.trim() });
    setOcupado(false);
    if (s === 202) {
      setEtapa('codigo');
      setInfo('Se este e-mail for da equipe, o código chega em instantes.');
    } else setErro('Não foi possível enviar o código agora. Tente de novo.');
  }

  function definir(i: number, valor: string) {
    const v = valor.replace(/\D/g, '').slice(-1);
    setDigitos((d) => d.map((x, j) => (j === i ? v : x)));
    if (v && i < 5) caixas.current[i + 1]?.focus();
  }

  function colar(e: ClipboardEvent<HTMLInputElement>) {
    const v = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (v.length === 6) {
      e.preventDefault();
      setDigitos(v.split(''));
      caixas.current[5]?.focus();
    }
  }

  function tecla(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digitos[i] && i > 0) caixas.current[i - 1]?.focus();
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const codigo = digitos.join('');
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Digite os 6 números do código.');
      return;
    }
    setOcupado(true);
    const s = await postar('/v1/admin/auth/verify', { email: email.trim(), code: codigo });
    setOcupado(false);
    if (s === 204) {
      router.push('/console');
      router.refresh();
      return;
    }
    setErro(s === 429 ? 'Muitas tentativas com este código. Peça um novo.' : s === 401 ? 'Código incorreto ou vencido.' : 'Não foi possível entrar agora.');
  }

  return (
    <div>
      <CabecaPagina titulo="Entrar no painel administrativo" descricao="Mandamos um código de 6 dígitos para o e-mail da equipe." />
      <div className="glass-card cartao-painel">
        {etapa === 'email' ? (
          <form className="form" onSubmit={pedirCodigo} noValidate>
            <div className="campo">
              <label htmlFor="email">E-mail da equipe</label>
              <input
                id="email"
                className="entrada"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={erro ? 'true' : undefined}
              />
              {erro ? <span className="campo-erro">{erro}</span> : null}
            </div>
            <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Receber código'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={entrar} noValidate>
            {info ? <p className="texto-suave" style={{ textAlign: 'center' }}>{info}</p> : null}
            <div className="codigo-caixas" role="group" aria-label="Código de 6 dígitos">
              {digitos.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    caixas.current[i] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  aria-label={`Dígito ${i + 1}`}
                  value={d}
                  onChange={(e) => definir(i, e.target.value)}
                  onKeyDown={(e) => tecla(i, e)}
                  onPaste={colar}
                />
              ))}
            </div>
            {erro ? (
              <p className="campo-erro" role="alert" style={{ textAlign: 'center' }}>
                {erro}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
              {ocupado ? 'Entrando…' : 'Entrar'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button type="button" className="btn-link" onClick={() => void pedirCodigo()}>
                Reenviar código
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEtapa('email');
                  setDigitos(['', '', '', '', '', '']);
                  setErro('');
                }}
              >
                Trocar e-mail
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
