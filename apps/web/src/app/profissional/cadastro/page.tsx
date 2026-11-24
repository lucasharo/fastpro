'use client';
// Cadastro do profissional (POST /v1/auth/professional/register). Resposta igual para e-mail novo ou ja usado.
// Confirmacao do e-mail por codigo de 6 digitos na propria tela; com o codigo certo, ja entra no painel.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MolduraConta, MOTIVOS_SENHA } from '@/components/ContaProfissional';
import { Icone } from '@/components/Icone';
import { ConfirmarCodigoProfissional } from '@/components/ConfirmarCodigoProfissional';
import { Aviso, Campo } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';

export default function Cadastro() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<{ email?: string; senha?: string; geral?: string }>({});
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  // Senha so em memoria, para entrar logo depois da confirmacao do codigo.
  const [senhaEnviada, setSenhaEnviada] = useState('');

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
    if (r.status === 202) {
      setSenhaEnviada(senha);
      setSenha('');
      setEnviado(true);
      return;
    }
    setSenha('');
    if (r.status === 422)
      setErros(r.corpo?.campo === 'email' ? { email: 'Digite um e-mail válido.' } : { senha: MOTIVOS_SENHA[r.corpo?.motivo ?? ''] ?? 'Escolha outra senha.' });
    else setErros({ geral: r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível criar a conta agora. Tente de novo.' });
  }

  return (
    <MolduraConta sobretitulo="Para profissionais" titulo="Crie sua" destaque="conta grátis" texto="Depois, envie seu documento. Com a aprovação, você ganha 14 dias grátis.">
      {enviado ? (
        <ConfirmarCodigoProfissional
          email={email.trim()}
          senha={senhaEnviada}
          aoTrocarEmail={() => {
            setEnviado(false);
            setSenhaEnviada('');
          }}
        />
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
