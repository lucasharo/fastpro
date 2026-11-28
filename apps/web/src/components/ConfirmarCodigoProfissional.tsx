'use client';
// Confirmacao do e-mail do profissional por codigo de 6 digitos (OTP; decisao do dono, 2026-11-23).
// POST /v1/auth/professional/verification/confirm {email, code}; reenvio em /verification/resend.
// Depois de confirmar, entra com a senha que a pessoa acabou de digitar (so em memoria) e vai ao painel.
import { useRouter } from 'next/navigation';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { Aviso } from './ui';

export interface ConfirmarCodigoProfissionalProps {
  readonly email: string;
  /** Senha digitada agora (so em memoria), para entrar logo depois da confirmacao. */
  readonly senha: string;
  readonly aoTrocarEmail?: () => void;
}

export function ConfirmarCodigoProfissional({ email, senha, aoTrocarEmail }: ConfirmarCodigoProfissionalProps) {
  const router = useRouter();
  const [digitos, setDigitos] = useState<string[]>(['', '', '', '', '', '']);
  const [erro, setErro] = useState('');
  const [info, setInfo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const caixas = useRef<(HTMLInputElement | null)[]>([]);

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

  async function confirmar() {
    const codigo = digitos.join('');
    setErro('');
    setInfo('');
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Digite os 6 números do código.');
      return;
    }
    setEnviando(true);
    const r = await chamarApi('/v1/auth/professional/verification/confirm', { body: { email, code: codigo } });
    if (r.status !== 204) {
      setEnviando(false);
      setErro(
        r.status === 410
          ? 'Código incorreto ou vencido. Confira ou peça um novo.'
          : r.status === 429
            ? MENSAGEM_LIMITE
            : MENSAGEM_INDISPONIVEL,
      );
      return;
    }
    // Confirmado: entra com a senha que acabou de ser digitada.
    const login = await chamarApi<{ access_level?: string }>('/v1/auth/professional/login', { body: { email, password: senha } });
    setEnviando(false);
    if (login.status === 200 && login.corpo?.access_level === 'full') {
      router.push('/profissional/painel');
      return;
    }
    setInfo('E-mail confirmado. Entre com seu e-mail e senha.');
    router.push('/profissional/entrar');
  }

  async function reenviar() {
    setErro('');
    const r = await chamarApi('/v1/auth/professional/verification/resend', { body: { email } });
    if (r.status === 202) setInfo('Enviamos um novo código.');
    else setErro(r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível reenviar agora.');
  }

  return (
    <div className="form">
      <p className="texto-suave" style={{ textAlign: 'center' }}>
        Enviamos um código de 6 dígitos para <strong style={{ color: 'var(--color-text-primary)' }}>{email}</strong>. Confira também a caixa de spam.
      </p>
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
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {info && !erro ? <Aviso tipo="sucesso">{info}</Aviso> : null}
      <button type="button" className="btn btn-primary btn-bloco" onClick={() => void confirmar()} disabled={enviando}>
        {enviando ? 'Confirmando…' : 'Confirmar e entrar'}
      </button>
      <div className="linha" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn-link" onClick={() => void reenviar()}>
          Reenviar código
        </button>
        {aoTrocarEmail ? (
          <button type="button" className="btn-link" onClick={aoTrocarEmail}>
            Trocar e-mail
          </button>
        ) : null}
      </div>
    </div>
  );
}
