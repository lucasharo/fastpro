'use client';
// Nova senha pelo link do e-mail (#t=...): POST /v1/auth/password/reset.
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MolduraConta, MOTIVOS_SENHA } from '@/components/ContaProfissional';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE, tokenDoFragmento } from '@/lib/api';

export default function Redefinir() {
  const token = useRef<string | null>(null);
  const [semLink, setSemLink] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    token.current = tokenDoFragmento(window.location.hash);
    history.replaceState(null, '', '/profissional/redefinir');
    if (!token.current) setSemLink(true);
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha.length < 8) {
      setErro(MOTIVOS_SENHA.curta ?? '');
      return;
    }
    const r = await chamarApi<{ motivo?: string }>('/v1/auth/password/reset', { body: { token: token.current, new_password: senha } });
    setSenha('');
    if (r.status === 200 || r.status === 204) {
      token.current = null;
      setOk(true);
    } else if (r.status === 422) setErro(MOTIVOS_SENHA[r.corpo?.motivo ?? ''] ?? 'Escolha outra senha.');
    else if (r.status === 410 || r.status === 400) setErro('Este link não pode mais ser usado. Peça uma nova redefinição.');
    else setErro(r.status === 429 ? MENSAGEM_LIMITE : MENSAGEM_INDISPONIVEL);
  }

  return (
    <MolduraConta sobretitulo="Área do profissional" titulo="Criar" destaque="nova senha">
      {ok ? (
        <div className="form">
          <Aviso tipo="sucesso">Senha trocada. Entre com a senha nova.</Aviso>
          <Link href="/profissional/entrar" className="btn btn-primary btn-bloco">
            Entrar
          </Link>
        </div>
      ) : semLink ? (
        <div className="form">
          <Aviso tipo="alerta">Este link não está completo. Peça uma nova redefinição de senha.</Aviso>
          <Link href="/profissional/recuperar" className="btn btn-primary btn-bloco">
            Pedir nova redefinição
          </Link>
        </div>
      ) : (
        <form className="form" onSubmit={enviar} noValidate>
          <Campo id="senha" rotulo="Nova senha" erro={erro} dica="Pelo menos 8 caracteres.">
            <input id="senha" className="entrada" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Campo>
          <button type="submit" className="btn btn-primary btn-bloco">
            Salvar senha
          </button>
        </form>
      )}
    </MolduraConta>
  );
}
