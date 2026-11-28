'use client';
// Troca de senha: a senha atual e confirmada pelo proprio login (que limita as tentativas e renova a prova recente
// exigida pela troca); depois, POST /v1/professional/password/change.
import { useState, type FormEvent } from 'react';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE, ok } from '@/lib/api';
import { MOTIVOS_SENHA } from './ContaProfissional';
import { Campo } from './ui';
import { Toast } from '@/components/Toast';

const CAMPOS = [
  { id: 'senha-atual', rotulo: 'Senha atual', auto: 'current-password', dica: undefined },
  { id: 'senha-nova', rotulo: 'Nova senha', auto: 'new-password', dica: 'Pelo menos 8 caracteres.' },
  { id: 'senha-repete', rotulo: 'Repita a nova senha', auto: 'new-password', dica: undefined },
] as const;

type Id = (typeof CAMPOS)[number]['id'];
type Valores = Record<Id, string>;
const VAZIO: Valores = { 'senha-atual': '', 'senha-nova': '', 'senha-repete': '' };

export function TrocaSenha() {
  const [valores, setValores] = useState<Valores>(VAZIO);
  const [erros, setErros] = useState<Partial<Valores>>({});
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function trocar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const er: Partial<Valores> = {};
    for (const c of CAMPOS) if (!valores[c.id]) er[c.id] = 'Campo obrigatório.';
    if (!er['senha-nova'] && valores['senha-nova'].length < 8) er['senha-nova'] = MOTIVOS_SENHA.curta ?? '';
    if (!er['senha-repete'] && valores['senha-repete'] !== valores['senha-nova']) er['senha-repete'] = 'As senhas não são iguais.';
    setErros(er);
    if (Object.keys(er).length > 0) return;
    setOcupado(true);
    const conta = await chamarApi<{ email?: string }>('/v1/professional/account');
    const login = conta.corpo?.email
      ? await chamarApi('/v1/auth/professional/login', { body: { email: conta.corpo.email, password: valores['senha-atual'] } })
      : null;
    if (login === null || !ok(login.status)) {
      setOcupado(false);
      if (login?.status === 401) return setErros({ 'senha-atual': 'Senha atual incorreta.' });
      return setAviso({ tipo: 'erro', texto: login?.status === 429 ? MENSAGEM_LIMITE : MENSAGEM_INDISPONIVEL });
    }
    const r = await chamarApi<{ motivo?: string }>('/v1/professional/password/change', { body: { new_password: valores['senha-nova'] } });
    setOcupado(false);
    if (ok(r.status)) {
      setValores(VAZIO);
      return setAviso({ tipo: 'sucesso', texto: 'Senha alterada.' });
    }
    if (r.status === 422) return setErros({ 'senha-nova': MOTIVOS_SENHA[r.corpo?.motivo ?? ''] ?? 'Escolha outra senha.' });
    setAviso({ tipo: 'erro', texto: r.status === 429 ? MENSAGEM_LIMITE : MENSAGEM_INDISPONIVEL });
  }

  return (
    <form className="glass-card painel-cartao form" onSubmit={trocar} noValidate>
      <h2 style={{ fontSize: '1.125rem' }}>Senha</h2>
      {CAMPOS.map((c) => (
        <Campo key={c.id} id={c.id} rotulo={c.rotulo} erro={erros[c.id]} dica={c.dica}>
          <input
            id={c.id}
            className="entrada"
            type="password"
            autoComplete={c.auto}
            value={valores[c.id]}
            aria-invalid={erros[c.id] ? 'true' : undefined}
            onChange={(e) => {
              setValores((v) => ({ ...v, [c.id]: e.target.value }));
              setErros((x) => ({ ...x, [c.id]: undefined }));
            }}
          />
        </Campo>
      ))}
      <Toast aviso={aviso} />
      <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} disabled={ocupado}>
        {ocupado ? 'Alterando…' : 'Alterar senha'}
      </button>
    </form>
  );
}
