'use client';
// Cadastro de um admin pela tela de Equipe (decisao do dono, 2026-11-27): e-mail, senha inicial e papeis. A API
// confere a permissao admin.role.manage e a senha; Superadmin nao e oferecido (exige dupla aprovacao ou o banco).
import { useState, type FormEvent } from 'react';
import { apiAdmin, TEXTO_SEM_ACESSO } from '../../../api-admin';
import { ChipsMultiplos } from '../../../components/Chips';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBRIGATORIO = 'Campo obrigatório.';
// Copia das regras da API (@fastpro/domain: ADMIN_GRANTABLE_ROLES e adminPasswordProblem). O pacote nao entra no
// navegador porque traz modulos do Node; o teste desta tela confere que as duas listas continuam iguais.
export const PAPEIS_OFERECIDOS = ['verificacao', 'moderador', 'financeiro', 'suporte', 'auditor', 'governanca_dados'];
const SENHA_MIN = 12;
const SENHA_MAX = 128;

function problemaDaSenha(senha: string, email: string): 'curta' | 'longa' | 'igual_email' | null {
  if (senha.length < SENHA_MIN) return 'curta';
  if (senha.length > SENHA_MAX) return 'longa';
  return senha.toLowerCase() === email.toLowerCase() ? 'igual_email' : null;
}

const TEXTO_SENHA: Record<string, string> = {
  curta: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`,
  longa: 'A senha é longa demais (máximo de 128 caracteres).',
  igual_email: 'A senha não pode ser igual ao e-mail.',
};

interface Erros {
  email?: string;
  senha?: string;
  confirmacao?: string;
  papeis?: string;
}

export function FormularioAdmin({
  rotulos,
  onCriado,
}: {
  readonly rotulos: Readonly<Record<string, string>>;
  readonly onCriado: () => void;
}) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [papeis, setPapeis] = useState<readonly string[]>([]);
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function validar(): Erros {
    const e: Erros = {};
    if (email.trim() === '') e.email = OBRIGATORIO;
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Digite um e-mail válido.';
    if (senha === '') e.senha = OBRIGATORIO;
    else {
      const p = problemaDaSenha(senha, email.trim());
      if (p !== null) e.senha = TEXTO_SENHA[p];
    }
    if (confirmacao === '') e.confirmacao = OBRIGATORIO;
    else if (confirmacao !== senha) e.confirmacao = 'As senhas não são iguais.';
    if (papeis.length === 0) e.papeis = OBRIGATORIO;
    return e;
  }

  const limpar = (campo: keyof Erros) => setErros((atual) => ({ ...atual, [campo]: undefined }));

  async function cadastrar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setAviso('');
    const e = validar();
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setOcupado(true);
    const r = await apiAdmin<{ campo?: string; motivo?: string }>('/v1/admin/staff', {
      email: email.trim(),
      password: senha,
      roles: papeis,
    });
    setOcupado(false);
    if (r.status === 201) {
      setEmail('');
      setSenha('');
      setConfirmacao('');
      setPapeis([]);
      setAviso('Admin cadastrado. Entregue a senha à pessoa por um canal seguro.');
      onCriado();
    } else if (r.status === 409) setErros({ email: 'Este e-mail já tem conta. Use outro (por exemplo, com +admin).' });
    else if (r.status === 422 && r.corpo?.campo === 'email') setErros({ email: 'Digite um e-mail válido.' });
    else if (r.status === 422 && r.corpo?.campo === 'password') {
      setErros({ senha: TEXTO_SENHA[r.corpo.motivo ?? ''] ?? 'Escolha outra senha.' });
    } else if (r.status === 422) setErros({ papeis: 'Escolha papéis válidos.' });
    else setErro(r.status === 404 ? TEXTO_SEM_ACESSO : 'Não foi possível cadastrar agora. Tente de novo.');
  }

  const campo = (
    id: 'email' | 'senha' | 'confirmacao',
    rotulo: string,
    tipo: 'email' | 'password',
    valor: string,
    mudar: (v: string) => void,
  ) => (
    <div className="campo">
      <label htmlFor={`novo-${id}`}>{rotulo}</label>
      <input
        id={`novo-${id}`}
        name={`novo-${id}`}
        className="entrada"
        type={tipo}
        autoComplete={tipo === 'password' ? 'new-password' : 'off'}
        value={valor}
        onChange={(ev) => {
          mudar(ev.target.value);
          limpar(id);
        }}
        aria-invalid={erros[id] ? 'true' : undefined}
        aria-describedby={erros[id] ? `novo-${id}-erro` : undefined}
      />
      {erros[id] ? (
        <span id={`novo-${id}-erro`} className="campo-erro" role="alert">
          {erros[id]}
        </span>
      ) : null}
    </div>
  );

  return (
    <section className="glass-card cartao-painel" aria-labelledby="novo-admin-titulo">
      <form className="form" onSubmit={cadastrar} noValidate>
        <h2 id="novo-admin-titulo">Cadastrar admin</h2>
        {campo('email', 'E-mail', 'email', email, setEmail)}
        {campo('senha', 'Senha inicial', 'password', senha, setSenha)}
        {campo('confirmacao', 'Repita a senha', 'password', confirmacao, setConfirmacao)}
        <div className="campo">
          <span className="campo-rotulo">Papéis</span>
          <ChipsMultiplos
            rotulo="Papéis"
            opcoes={PAPEIS_OFERECIDOS.map((p) => ({ valor: p, rotulo: rotulos[p] ?? p }))}
            valores={papeis}
            onMudar={(v) => {
              setPapeis(v);
              limpar('papeis');
            }}
            invalido={erros.papeis !== undefined}
            descritoPor={erros.papeis ? 'novo-papeis-erro' : undefined}
          />
          {erros.papeis ? (
            <span id="novo-papeis-erro" className="campo-erro" role="alert">
              {erros.papeis}
            </span>
          ) : null}
        </div>
        {erro ? (
          <p className="campo-erro" role="alert">
            {erro}
          </p>
        ) : null}
        {aviso ? (
          <p className="texto-suave" role="status">
            {aviso}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-bloco" disabled={ocupado}>
          {ocupado ? 'Cadastrando…' : 'Cadastrar admin'}
        </button>
      </form>
    </section>
  );
}
