'use client';
// Confirmacao por codigo de 6 digitos enviado ao e-mail (POST /v1/auth/challenges e /verify). Depois do
// codigo certo, converte o desafio em sessao (POST /v1/auth/session) e chama aoConfirmar.
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE, ok } from '@/lib/api';
import { Aviso } from './ui';

export interface CodigoEmailProps {
  readonly email: string;
  readonly finalidade: 'login' | 'publish';
  readonly aoConfirmar: () => void;
  readonly aoTrocarEmail?: () => void;
  /** Cria a sessao depois do codigo (login). No pedido, a sessao vem do proprio fluxo de revisao. */
  readonly criarSessao?: boolean;
}

export async function pedirCodigo(email: string, finalidade: 'login' | 'publish'): Promise<string | null> {
  const r = await chamarApi('/v1/auth/challenges', { body: { email, purpose: finalidade } });
  if (ok(r.status)) return null;
  if (r.status === 429) return MENSAGEM_LIMITE;
  if (r.status === 422) return 'Confira o e-mail digitado.';
  return 'Não foi possível enviar o código agora. Tente de novo.';
}

export function CodigoEmail({ email, finalidade, aoConfirmar, aoTrocarEmail, criarSessao = true }: CodigoEmailProps) {
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

  async function validar() {
    const codigo = digitos.join('');
    setErro('');
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Digite os 6 números do código.');
      return;
    }
    setEnviando(true);
    const r = await chamarApi('/v1/auth/challenges/verify', { body: { email, code: codigo, purpose: finalidade } });
    if (!ok(r.status)) {
      setEnviando(false);
      setErro(r.status === 429 ? MENSAGEM_LIMITE : r.status === 422 ? 'Código incorreto ou vencido. Confira e tente de novo.' : MENSAGEM_INDISPONIVEL);
      return;
    }
    if (criarSessao) {
      const s = await chamarApi('/v1/auth/session', { body: {} });
      if (s.status !== 200) {
        setEnviando(false);
        setErro(MENSAGEM_INDISPONIVEL);
        return;
      }
    }
    aoConfirmar();
  }

  async function reenviar() {
    setErro('');
    const falha = await pedirCodigo(email, finalidade);
    if (falha) setErro(falha);
    else setInfo('Enviamos um novo código.');
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
      <button type="button" className="btn btn-primary btn-bloco" onClick={validar} disabled={enviando}>
        {enviando ? 'Validando…' : 'Validar código'}
      </button>
      <div className="linha" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={reenviar}>
          Reenviar código
        </button>
        {aoTrocarEmail ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={aoTrocarEmail}>
            Trocar e-mail
          </button>
        ) : null}
      </div>
    </div>
  );
}
