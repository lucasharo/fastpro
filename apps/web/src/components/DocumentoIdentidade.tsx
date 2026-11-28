'use client';
// Documento de identidade, dentro da Gestao profissional. Envio em um so passo: o arquivo fica escolhido na tela e
// nada e enviado antes do clique em "Enviar para analise". Ao clicar: valida tudo, grava o cadastro
// (PUT /v1/professional/profile) e so entao envia o arquivo. Se o arquivo falhar, o cadastro ja esta salvo e o mesmo
// botao tenta de novo, sem digitar nada outra vez. Lista os arquivos enviados (GET /v1/professional/documents).
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArquivoEnviado } from '@/components/ArquivoEnviado';
import { CampoArquivo } from '@/components/CampoArquivo';
import { Icone } from '@/components/Icone';
import { Selecao } from '@/components/Selecao';
import { Campo } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { enviarDocumento, erroDoArquivo } from '@/lib/enviar-documento';
import { formatarData } from '@/lib/formatos';
import { Toast } from '@/components/Toast';

const CAMPO_OBRIGATORIO = 'Campo obrigatório.';

interface Documento {
  id: string;
  kind?: string;
  documentKind?: string;
  status?: string;
  receivedAt?: string;
  deletable?: boolean;
}

function motivoCampo(campo: string, motivo: string): string {
  if (campo === 'document') {
    if (motivo === 'tamanho') return 'CPF tem 11 números e CNPJ tem 14. Confira o número.';
    if (motivo === 'formato') return 'Use apenas números. Pontos, traços e barras são aceitos.';
    if (motivo === 'obrigatorio') return CAMPO_OBRIGATORIO;
    return 'Este número não é válido. Confira os dígitos.';
  }
  if (campo === 'publicName') return motivo === 'tamanho' ? 'O nome público deve ter de 2 a 80 caracteres.' : CAMPO_OBRIGATORIO;
  if (campo === 'documentType') return 'Escolha CPF ou CNPJ.';
  return 'Confira este campo.';
}

export function DocumentoIdentidade({
  aberto,
  travado,
  aoMudar,
}: {
  /** Cadastro aprovado ou suspenso: o banco nao aceita trocar o documento de identidade. */
  readonly travado: boolean;
  /** Passo pendente: o formulario ja aparece. Concluido: aparece ao pedir um novo envio. */
  readonly aberto: boolean;
  readonly aoMudar: () => Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const router = useRouter();
  const [tipo, setTipo] = useState('');
  const [nome, setNome] = useState('');
  const [numero, setNumero] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [enviando, setEnviando] = useState(false);
  // Cadastro ja gravado nesta tela: se so o arquivo falhou, o proximo clique nao regrava os dados.
  const [cadastroSalvo, setCadastroSalvo] = useState(false);

  const carregar = useCallback(async () => {
    const [perfil, lista] = await Promise.all([
      chamarApi<{ publicName?: string; documentType?: string }>('/v1/professional/profile'),
      chamarApi<{ documents?: Documento[] }>('/v1/professional/documents'),
    ]);
    if (perfil.status === 401 || lista.status === 401) {
      router.replace('/profissional/entrar');
      return;
    }
    if (perfil.status === 200 && perfil.corpo) {
      setNome((n) => n || perfil.corpo?.publicName || '');
      setTipo((t) => t || perfil.corpo?.documentType || '');
    }
    if (lista.status === 200 && Array.isArray(lista.corpo?.documents))
      setDocs(lista.corpo.documents.filter((x) => x.documentKind !== 'certificacao'));
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O arquivo e sempre obrigatorio; o rotulo muda quando ja existe um documento.
  const arquivoObrigatorio = docs.length === 0;

  function escolherArquivo(f: File | undefined) {
    if (!f) return;
    const problema = erroDoArquivo(f);
    setAviso(null);
    if (problema) {
      setArquivo(null);
      setErros((e) => ({ ...e, arquivo: problema }));
      return;
    }
    setArquivo(f);
    setErros((e) => {
      const resto = { ...e };
      delete resto.arquivo;
      return resto;
    });
  }

  // Cadastro: PUT do perfil. Devolve true se gravou; senao ja mostrou o motivo.
  async function gravarCadastro(): Promise<boolean> {
    const r = await chamarApi<{ fields?: { field?: string; reason?: string; motivo?: string }[]; code?: string }>('/v1/professional/profile', {
      method: 'PUT',
      body: { publicName: nome.trim(), documentType: tipo, document: numero.trim() },
    });
    if (r.status === 201 || r.status === 200) return true;
    if (r.status === 422) {
      const novos: Record<string, string> = {};
      for (const f of r.corpo?.fields ?? []) if (f.field) novos[f.field] = motivoCampo(f.field, f.reason ?? f.motivo ?? '');
      setErros(novos);
      setAviso({ tipo: 'erro', texto: 'Confira os campos destacados. Nada foi enviado.' });
    } else if (r.status === 401) router.replace('/profissional/entrar');
    else if (r.status === 403 && r.corpo?.code === 'email_nao_verificado')
      setAviso({ tipo: 'erro', texto: 'Confirme seu e-mail antes de enviar o documento.' });
    else setAviso({ tipo: 'erro', texto: 'Não foi possível salvar agora. Nada foi enviado. Tente de novo em alguns minutos.' });
    return false;
  }

  // Arquivo: devolve true se o documento foi recebido.
  async function enviarArquivo(f: File): Promise<boolean> {
    const r = await enviarDocumento(f);
    if (r.ok) return true;
    if (r.trocarArquivo) {
      setArquivo(null);
      setAviso({ tipo: 'erro', texto: r.texto });
    } else
      setAviso({
        tipo: 'erro',
        texto: docs.length > 0 ? r.texto : `${r.texto} Seu cadastro foi salvo; clique em Enviar para análise para tentar de novo.`,
      });
    return false;
  }

  async function enviarParaAnalise(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setAviso(null);
    const er: Record<string, string> = {};
    const soArquivo = docs.length > 0;
    if (soArquivo && arquivo === null) {
      setErros({ arquivo: CAMPO_OBRIGATORIO });
      return;
    }
    if (!soArquivo && !tipo) er.documentType = CAMPO_OBRIGATORIO;
    if (!soArquivo && nome.trim().length < 2) er.publicName = nome.trim() === '' ? CAMPO_OBRIGATORIO : motivoCampo('publicName', 'tamanho');
    if (!soArquivo && !numero.trim() && !cadastroSalvo) er.document = CAMPO_OBRIGATORIO;
    if (arquivo === null && arquivoObrigatorio) er.arquivo = CAMPO_OBRIGATORIO;
    setErros(er);
    if (Object.keys(er).length > 0) return;

    setEnviando(true);
    try {
      if (!soArquivo && !cadastroSalvo && !(await gravarCadastro())) return;
      setCadastroSalvo(true);
      if (arquivo !== null && !(await enviarArquivo(arquivo))) return;
      setNumero('');
      setArquivo(null);
      setCadastroSalvo(false);
      setExpandido(false);
      setAviso({
        tipo: 'sucesso',
        texto: arquivo !== null ? 'Recebemos seu cadastro e o documento. A equipe de verificação vai analisar.' : 'Cadastro atualizado.',
      });
      await carregar();
      await aoMudar();
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: string) {
    const r = await chamarApi(`/v1/professional/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.status === 409) setAviso({ tipo: 'erro', texto: 'Este documento já foi analisado e não pode ser excluído.' });
    await carregar();
    await aoMudar();
  }

  return (
    <>
      {docs.length > 0 ? (
        <div className="pilha" style={{ gap: '0.5rem' }}>
          {docs.map((d) => (
            <div key={d.id} className="item-lista" style={{ padding: '0.75rem' }}>
              {d.status === 'recebido' ? <ArquivoEnviado id={d.id} pdf={d.kind === 'pdf'} rotulo="o documento" /> : <Icone nome="documento" />}
              <div className="item-corpo">
                <div className="item-titulo">{d.kind === 'pdf' ? 'PDF' : 'Foto'} do documento</div>
                <div className="campo-dica">{d.status === 'em_envio' ? 'Enviando' : d.receivedAt ? `Recebido em ${formatarData(d.receivedAt)}` : ''}</div>
              </div>
              {d.deletable ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void excluir(d.id)}>
                  Excluir
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {travado ? (
        <p className="campo-dica">Documento já aprovado: não é possível trocar. Se ele estiver errado, fale com o suporte.</p>
      ) : !aberto && !expandido ? (
        <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setExpandido(true)}>
          Enviar novo arquivo
        </button>
      ) : (
      <form className="form" onSubmit={enviarParaAnalise} noValidate>
        {docs.length === 0 ? (
          <>
        <Campo id="tipo" rotulo="Tipo de documento" erro={erros.documentType}>
          <Selecao
            id="tipo"
            valor={tipo}
            onMudar={(v) => {
              setTipo(v);
              setCadastroSalvo(false);
            }}
            invalido={Boolean(erros.documentType)}
            placeholder="Escolha"
            opcoes={[
              { valor: 'CPF', rotulo: 'CPF (pessoa física)' },
              { valor: 'CNPJ', rotulo: 'CNPJ (empresa ou MEI)' },
            ]}
          />
        </Campo>
        <Campo id="nome" rotulo="Nome público" erro={erros.publicName} dica="Como os clientes vão ver você.">
          <input
            id="nome"
            className="entrada"
            value={nome}
            aria-invalid={erros.publicName ? true : undefined}
            onChange={(e) => {
              setNome(e.target.value);
              setCadastroSalvo(false);
            }}
          />
        </Campo>
        <Campo id="numero" rotulo="Número do documento" erro={erros.document} dica="Não aparece para ninguém além da verificação.">
          <input
            id="numero"
            className="entrada"
            inputMode="numeric"
            autoComplete="off"
            value={numero}
            aria-invalid={erros.document ? true : undefined}
            onChange={(e) => {
              setNumero(e.target.value);
              setCadastroSalvo(false);
            }}
          />
        </Campo>
          </>
        ) : null}

        <Campo
          id="arquivo"
          rotulo={arquivoObrigatorio ? 'Foto ou PDF do documento' : 'Novo arquivo'}
          erro={erros.arquivo}
          dica="Frente e verso legíveis. Foto até 5 MB (JPG, PNG, WebP) ou PDF até 2 MB. O arquivo só é enviado quando você clicar em Enviar para análise."
        >
          <CampoArquivo
            id="arquivo"
            deQue="do documento"
            arquivo={arquivo}
            aoEscolher={escolherArquivo}
            aoRemover={() => setArquivo(null)}
            desabilitado={enviando}
            invalido={Boolean(erros.arquivo)}
          />
        </Campo>

        <Toast aviso={aviso} />
        <button type="submit" className="btn btn-primary btn-bloco" disabled={enviando}>
          <Icone nome={enviando ? 'relogio' : 'enviar'} tamanho={18} />
          {enviando ? 'Enviando…' : 'Enviar para análise'}
        </button>
      </form>
      )}
    </>
  );
}
