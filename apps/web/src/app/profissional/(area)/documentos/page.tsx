'use client';
// Cadastro do documento (PUT /v1/professional/profile) e envio dos arquivos (POST /v1/professional/documents/uploads,
// PUT no Storage, finalize). Lista em GET /v1/professional/documents.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData } from '@/lib/formatos';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const LIMITE_IMAGEM = 5_242_880;
const LIMITE_PDF = 2_097_152;

interface Documento {
  id: string;
  kind?: string;
  status?: string;
  receivedAt?: string;
  deletable?: boolean;
}

function motivoCampo(campo: string, motivo: string): string {
  if (campo === 'document') {
    if (motivo === 'tamanho') return 'CPF tem 11 números e CNPJ tem 14. Confira o número.';
    if (motivo === 'formato') return 'Use apenas números. Pontos, traços e barras são aceitos.';
    if (motivo === 'obrigatorio') return 'Informe o número do documento.';
    return 'Este número não é válido. Confira os dígitos.';
  }
  if (campo === 'publicName') return motivo === 'tamanho' ? 'O nome público deve ter de 2 a 80 caracteres.' : 'Informe o nome público.';
  if (campo === 'documentType') return 'Escolha CPF ou CNPJ.';
  return 'Confira este campo.';
}

export default function Documentos() {
  const router = useRouter();
  const [tipo, setTipo] = useState('');
  const [nome, setNome] = useState('');
  const [numero, setNumero] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [avisoCadastro, setAvisoCadastro] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [avisoArquivo, setAvisoArquivo] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
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

  async function salvarCadastro(e: FormEvent) {
    e.preventDefault();
    setAvisoCadastro(null);
    const er: Record<string, string> = {};
    if (!tipo) er.documentType = 'Escolha CPF ou CNPJ.';
    if (nome.trim().length < 2) er.publicName = 'Informe o nome público.';
    if (!numero.trim()) er.document = 'Informe o número do documento.';
    setErros(er);
    if (Object.keys(er).length > 0) return;
    const r = await chamarApi<{ fields?: { field?: string; reason?: string; motivo?: string }[]; code?: string }>('/v1/professional/profile', {
      method: 'PUT',
      body: { publicName: nome.trim(), documentType: tipo, document: numero.trim() },
    });
    if (r.status === 201 || r.status === 200) {
      setNumero('');
      setAvisoCadastro({ tipo: 'sucesso', texto: 'Recebemos seu cadastro. Agora envie a foto do documento.' });
    } else if (r.status === 422) {
      const novos: Record<string, string> = {};
      for (const f of r.corpo?.fields ?? []) if (f.field) novos[f.field] = motivoCampo(f.field, f.reason ?? f.motivo ?? '');
      setErros(novos);
      setAvisoCadastro({ tipo: 'erro', texto: 'Confira os campos destacados.' });
    } else if (r.status === 401) router.replace('/profissional/entrar');
    else if (r.status === 403 && r.corpo?.code === 'email_nao_verificado') setAvisoCadastro({ tipo: 'erro', texto: 'Confirme seu e-mail antes de enviar o documento.' });
    else setAvisoCadastro({ tipo: 'erro', texto: 'Não foi possível salvar agora. Tente de novo em alguns minutos.' });
  }

  async function enviarArquivo(arquivo: File) {
    setAvisoArquivo(null);
    if (!TIPOS.includes(arquivo.type)) return setAvisoArquivo({ tipo: 'erro', texto: 'Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF.' });
    const limite = arquivo.type === 'application/pdf' ? LIMITE_PDF : LIMITE_IMAGEM;
    if (arquivo.size > limite)
      return setAvisoArquivo({ tipo: 'erro', texto: arquivo.type === 'application/pdf' ? 'O PDF pode ter até 2 MB.' : 'A foto pode ter até 5 MB.' });
    setEnviando(true);
    try {
      const emissao = await chamarApi<{ id?: string; upload_url?: string }>('/v1/professional/documents/uploads', {
        body: { client_upload_id: crypto.randomUUID(), content_type: arquivo.type, size_bytes: arquivo.size },
      });
      if (emissao.status !== 200 && emissao.status !== 201) {
        const c = codigoDe(emissao.corpo);
        const texto =
          emissao.status === 429
            ? MENSAGEM_LIMITE
            : c === 'email_nao_verificado'
              ? 'Confirme seu e-mail antes de enviar documentos.'
              : c === 'estado_perfil'
                ? 'Preencha o cadastro do documento acima antes de enviar o arquivo.'
                : c === 'limite_documentos'
                  ? 'Você já enviou o número máximo de arquivos.'
                  : 'Não foi possível enviar agora. Tente de novo.';
        return setAvisoArquivo({ tipo: 'erro', texto });
      }
      if (typeof emissao.corpo?.upload_url === 'string' && typeof emissao.corpo.id === 'string') {
        const put = await fetch(emissao.corpo.upload_url, {
          method: 'PUT',
          body: arquivo,
          headers: { 'Content-Type': arquivo.type },
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        }).catch(() => null);
        if (!put?.ok) return setAvisoArquivo({ tipo: 'erro', texto: 'Não foi possível enviar o arquivo. Tente de novo.' });
        const fim = await chamarApi(`/v1/professional/documents/${encodeURIComponent(emissao.corpo.id)}/finalize`, { method: 'POST' });
        if (fim.status !== 200) return setAvisoArquivo({ tipo: 'erro', texto: 'O arquivo não pôde ser conferido. Envie outro.' });
      }
      setAvisoArquivo({ tipo: 'sucesso', texto: 'Documento recebido. A equipe de verificação vai analisar.' });
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: string) {
    const r = await chamarApi(`/v1/professional/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.status === 409) setAvisoArquivo({ tipo: 'erro', texto: 'Este documento já foi analisado e não pode ser excluído.' });
    await carregar();
  }

  return (
    <>
      <CabecaPagina sobretitulo="Verificação" titulo="Seus" destaque="documentos" texto="Conferimos seu documento para dar o selo de verificado. Só a equipe de verificação vê os arquivos." />
      <div className="grade grade-2" style={{ alignItems: 'start' }}>
        <form className="glass-card painel-cartao form" onSubmit={salvarCadastro} noValidate>
          <div className="linha">
            <div className="circulo-icone">
              <Icone nome="usuario" />
            </div>
            <h2 style={{ fontSize: '1.125rem' }}>1. Cadastro</h2>
          </div>
          <Campo id="tipo" rotulo="Tipo de documento" erro={erros.documentType}>
            <select id="tipo" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Escolha</option>
              <option value="CPF">CPF (pessoa física)</option>
              <option value="CNPJ">CNPJ (empresa ou MEI)</option>
            </select>
          </Campo>
          <Campo id="nome" rotulo="Nome público" erro={erros.publicName} dica="Como os clientes vão ver você.">
            <input id="nome" className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} />
          </Campo>
          <Campo id="numero" rotulo="Número do documento" erro={erros.document} dica="Não aparece para ninguém além da verificação.">
            <input id="numero" className="entrada" inputMode="numeric" autoComplete="off" value={numero} onChange={(e) => setNumero(e.target.value)} />
          </Campo>
          {avisoCadastro ? <Aviso tipo={avisoCadastro.tipo}>{avisoCadastro.texto}</Aviso> : null}
          <button type="submit" className="btn btn-primary btn-bloco">
            Salvar cadastro
          </button>
        </form>

        <div className="glass-card painel-cartao pilha">
          <div className="linha">
            <div className="circulo-icone">
              <Icone nome="camera" />
            </div>
            <h2 style={{ fontSize: '1.125rem' }}>2. Foto ou PDF do documento</h2>
          </div>
          <p className="texto-suave" style={{ fontSize: '0.875rem' }}>
            Frente e verso legíveis. Foto até 5 MB (JPG, PNG, WebP) ou PDF até 2 MB.
          </p>
          <button
            type="button"
            className="opcao"
            style={{ justifyContent: 'center', padding: '2rem', borderStyle: 'dashed', flexDirection: 'column' }}
            onClick={() => seletor.current?.click()}
            disabled={enviando}
          >
            <Icone nome={enviando ? 'relogio' : 'mais'} tamanho={28} />
            <span style={{ fontWeight: 500 }}>{enviando ? 'Enviando…' : 'Escolher arquivo'}</span>
          </button>
          <input
            ref={seletor}
            type="file"
            accept={TIPOS.join(',')}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void enviarArquivo(f);
            }}
          />
          {avisoArquivo ? <Aviso tipo={avisoArquivo.tipo}>{avisoArquivo.texto}</Aviso> : null}
          {docs.length > 0 ? (
            <div className="pilha" style={{ gap: '0.5rem' }}>
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
        </div>
      </div>
    </>
  );
}
