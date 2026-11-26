'use client';
// Envio do documento para analise em UM so passo (2026-11-24): o arquivo fica escolhido na tela e nada e enviado
// antes do clique em "Enviar para analise". Ao clicar: valida tudo, grava o cadastro (PUT /v1/professional/profile) e
// so entao envia o arquivo (POST /v1/professional/documents/uploads, PUT no Storage, finalize). Se o arquivo falhar,
// o cadastro ja esta salvo e o mesmo botao tenta de novo, sem digitar nada outra vez. Lista em GET /v1/professional/documents.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icone } from '@/components/Icone';
import { Selecao } from '@/components/Selecao';
import { Aviso, CabecaPagina, Campo } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData } from '@/lib/formatos';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const LIMITE_IMAGEM = 5_242_880;
const LIMITE_PDF = 2_097_152;
const CAMPO_OBRIGATORIO = 'Campo obrigatório.';

interface Documento {
  id: string;
  kind?: string;
  status?: string;
  receivedAt?: string;
  deletable?: boolean;
}

function tamanhoLegivel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Erro do arquivo escolhido (tipo e tamanho), ou null se estiver dentro das regras. */
function erroDoArquivo(arquivo: File): string | null {
  if (!TIPOS.includes(arquivo.type)) return 'Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF.';
  const pdf = arquivo.type === 'application/pdf';
  if (arquivo.size > (pdf ? LIMITE_PDF : LIMITE_IMAGEM)) return pdf ? 'O PDF pode ter até 2 MB.' : 'A foto pode ter até 5 MB.';
  return null;
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

export default function Documentos() {
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
  const seletor = useRef<HTMLInputElement>(null);

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
    if (lista.status === 200 && Array.isArray(lista.corpo?.documents)) setDocs(lista.corpo.documents);
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Sem documento enviado ainda, o arquivo e obrigatorio; com um ja recebido, e possivel so atualizar o cadastro.
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

  // Arquivo: emissao, PUT no Storage e finalize. Devolve true se o documento foi recebido.
  async function enviarArquivo(f: File): Promise<boolean> {
    const retentar = 'Seu cadastro foi salvo; clique em Enviar para análise para tentar de novo.';
    const emissao = await chamarApi<{ id?: string; upload_url?: string }>('/v1/professional/documents/uploads', {
      body: { client_upload_id: crypto.randomUUID(), content_type: f.type, size_bytes: f.size },
    });
    if (emissao.status !== 200 && emissao.status !== 201) {
      const c = codigoDe(emissao.corpo);
      const texto =
        emissao.status === 429
          ? MENSAGEM_LIMITE
          : c === 'email_nao_verificado'
            ? 'Confirme seu e-mail antes de enviar documentos.'
            : c === 'limite_documentos'
              ? 'Você já enviou o número máximo de arquivos.'
              : 'Não foi possível enviar o arquivo agora.';
      setAviso({ tipo: 'erro', texto: `${texto} ${retentar}` });
      return false;
    }
    if (typeof emissao.corpo?.upload_url === 'string' && typeof emissao.corpo.id === 'string') {
      const put = await fetch(emissao.corpo.upload_url, {
        method: 'PUT',
        body: f,
        headers: { 'Content-Type': f.type },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }).catch(() => null);
      if (!put?.ok) {
        setAviso({ tipo: 'erro', texto: `Não foi possível enviar o arquivo. ${retentar}` });
        return false;
      }
      const fim = await chamarApi(`/v1/professional/documents/${encodeURIComponent(emissao.corpo.id)}/finalize`, { method: 'POST' });
      if (fim.status !== 200) {
        setAviso({ tipo: 'erro', texto: 'O arquivo não pôde ser conferido. Escolha outro arquivo e envie de novo.' });
        setArquivo(null);
        return false;
      }
    }
    return true;
  }

  async function enviarParaAnalise(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setAviso(null);
    const er: Record<string, string> = {};
    if (!tipo) er.documentType = CAMPO_OBRIGATORIO;
    if (nome.trim().length < 2) er.publicName = nome.trim() === '' ? CAMPO_OBRIGATORIO : motivoCampo('publicName', 'tamanho');
    if (!numero.trim() && !cadastroSalvo) er.document = CAMPO_OBRIGATORIO;
    if (arquivo === null && arquivoObrigatorio) er.arquivo = CAMPO_OBRIGATORIO;
    setErros(er);
    if (Object.keys(er).length > 0) return;

    setEnviando(true);
    try {
      if (!cadastroSalvo && !(await gravarCadastro())) return;
      setCadastroSalvo(true);
      if (arquivo !== null && !(await enviarArquivo(arquivo))) return;
      setNumero('');
      setArquivo(null);
      setCadastroSalvo(false);
      setAviso({
        tipo: 'sucesso',
        texto: arquivo !== null ? 'Recebemos seu cadastro e o documento. A equipe de verificação vai analisar.' : 'Cadastro atualizado.',
      });
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: string) {
    const r = await chamarApi(`/v1/professional/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.status === 409) setAviso({ tipo: 'erro', texto: 'Este documento já foi analisado e não pode ser excluído.' });
    await carregar();
  }

  return (
    <>
      <CabecaPagina sobretitulo="Verificação" titulo="Seus" destaque="documentos" texto="Conferimos seu documento para dar o selo de verificado. Só a equipe de verificação vê os arquivos." />
      <form className="glass-card painel-cartao form" onSubmit={enviarParaAnalise} noValidate style={{ maxWidth: '40rem' }}>
        <div className="linha">
          <div className="circulo-icone">
            <Icone nome="usuario" />
          </div>
          <h2 style={{ fontSize: '1.125rem' }}>Dados e documento</h2>
        </div>
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

        <Campo
          id="arquivo"
          rotulo={arquivoObrigatorio ? 'Foto ou PDF do documento' : 'Novo arquivo (opcional)'}
          erro={erros.arquivo}
          dica="Frente e verso legíveis. Foto até 5 MB (JPG, PNG, WebP) ou PDF até 2 MB. O arquivo só é enviado quando você clicar em Enviar para análise."
        >
          {arquivo ? (
            <div className="item-lista" style={{ padding: '0.75rem' }}>
              <Icone nome="documento" />
              <div className="item-corpo">
                <div className="item-titulo">{arquivo.name}</div>
                <div className="campo-dica">{tamanhoLegivel(arquivo.size)} · aguardando envio</div>
              </div>
              <button type="button" className="btn-link" disabled={enviando} onClick={() => seletor.current?.click()}>
                Trocar
              </button>
              <button type="button" className="btn-link" disabled={enviando} onClick={() => setArquivo(null)}>
                Remover
              </button>
            </div>
          ) : (
            <button
              type="button"
              id="arquivo"
              className="opcao"
              aria-invalid={erros.arquivo ? true : undefined}
              style={{ justifyContent: 'center', padding: '1.5rem', borderStyle: 'dashed', flexDirection: 'column' }}
              onClick={() => seletor.current?.click()}
              disabled={enviando}
            >
              <Icone nome="camera" tamanho={28} />
              <span style={{ fontWeight: 500 }}>Escolher arquivo</span>
            </button>
          )}
          <input
            ref={seletor}
            type="file"
            accept={TIPOS.join(',')}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              escolherArquivo(f);
            }}
          />
        </Campo>

        {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
        <button type="submit" className="btn btn-primary btn-bloco" disabled={enviando}>
          <Icone nome={enviando ? 'relogio' : 'enviar'} tamanho={18} />
          {enviando ? 'Enviando…' : 'Enviar para análise'}
        </button>
      </form>

      {docs.length > 0 ? (
        <div className="glass-card painel-cartao pilha" style={{ maxWidth: '40rem', marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem' }}>Arquivos enviados</h2>
          {docs.map((d) => (
            <div key={d.id} className="item-lista" style={{ padding: '0.75rem' }}>
              <Icone nome="documento" />
              <div className="item-corpo">
                <div className="item-titulo">{d.kind === 'pdf' ? 'PDF' : d.kind === 'imagem' ? 'Foto' : 'Documento'}</div>
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
    </>
  );
}
