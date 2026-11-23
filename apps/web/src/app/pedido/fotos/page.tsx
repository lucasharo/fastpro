'use client';
// Fotos do pedido (ate 5): emissao (POST /v1/media/uploads), envio direto ao Storage, finalizacao e lista.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, PaginaInterna } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { prepararFoto } from '@/lib/reduzir-foto';

const LIMITE = 5;

interface Foto {
  id: string;
  estado: string;
  motivo?: string | null;
}

const TEXTO_ESTADO: Record<string, string> = {
  pronta: 'Pronta',
  processando: 'Preparando…',
  aguardando: 'Enviando…',
  recusada: 'Não aceita',
};

function Miniatura({ id }: { readonly id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let criada: string | null = null;
    (async () => {
      try {
        const r = await fetch(`/api/v1/media/${id}/image`, { credentials: 'same-origin', cache: 'no-store' });
        if (!r.ok || !vivo) return;
        criada = URL.createObjectURL(await r.blob());
        setUrl(criada);
      } catch {
        /* sem miniatura */
      }
    })();
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [id]);
  return url ? (
    <img src={url} alt="Foto do pedido" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    <Icone nome="camera" tamanho={28} />
  );
}

export default function FotosPedido() {
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<{ fotos?: Foto[] }>('/v1/media/photos');
    if (r.status === 200 && Array.isArray(r.corpo?.fotos)) {
      setFotos(r.corpo.fotos.filter((f) => typeof f.id === 'string'));
      return r.corpo.fotos;
    }
    setFotos([]);
    if (r.status === 404) setErro('Não encontramos um pedido em andamento. Comece pelo formulário do pedido.');
    else if (r.status === 429) setErro(MENSAGEM_LIMITE);
    else setErro('Não foi possível carregar as fotos agora.');
    return [];
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Enquanto houver foto sendo preparada, consulta a lista de novo.
  useEffect(() => {
    if (!fotos?.some((f) => f.estado !== 'pronta' && f.estado !== 'recusada')) return;
    const t = setTimeout(() => void carregar(), 3000);
    return () => clearTimeout(t);
  }, [fotos, carregar]);

  async function enviar(arquivo: File) {
    setErro('');
    setEnviando(true);
    try {
      const preparada = await prepararFoto(arquivo);
      if (preparada === 'grande') {
        setErro('A foto é grande demais. Escolha uma de até 10 MB.');
        return;
      }
      const emissao = await chamarApi<{ id?: string; upload_url?: string }>('/v1/media/uploads', {
        body: { client_upload_id: crypto.randomUUID(), content_type: preparada.tipo, size_bytes: preparada.blob.size },
      });
      if ((emissao.status !== 200 && emissao.status !== 201) || typeof emissao.corpo?.id !== 'string') {
        const c = codigoDe(emissao.corpo);
        setErro(
          emissao.status === 415
            ? 'Esse tipo de arquivo não é aceito. Use JPG, PNG ou WebP.'
            : emissao.status === 413
              ? 'A foto é grande demais.'
              : emissao.status === 429
                ? MENSAGEM_LIMITE
                : c === 'photo_limit'
                  ? `Você já tem ${LIMITE} fotos.`
                  : 'Não foi possível enviar a foto agora.',
        );
        return;
      }
      if (typeof emissao.corpo.upload_url === 'string') {
        const put = await fetch(emissao.corpo.upload_url, {
          method: 'PUT',
          body: preparada.blob,
          headers: { 'Content-Type': preparada.tipo },
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        }).catch(() => null);
        if (!put?.ok) {
          setErro('Não foi possível enviar a foto agora. Tente de novo.');
          return;
        }
        const fim = await chamarApi(`/v1/media/${emissao.corpo.id}/finalize`, { method: 'POST' });
        if (fim.status !== 200) setErro(fim.status === 413 ? 'A foto é grande demais.' : 'A foto não pôde ser preparada.');
      }
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  async function remover(id: string) {
    const r = await chamarApi(`/v1/media/${id}`, { method: 'DELETE' });
    if (r.status !== 200 && r.status !== 204 && r.status !== 404) setErro('Não foi possível remover agora.');
    await carregar();
  }

  const vivas = (fotos ?? []).filter((f) => f.estado !== 'recusada');

  return (
    <PaginaInterna largura="media">
      <CabecaPagina
        sobretitulo="Opcional"
        titulo="Fotos do"
        destaque="serviço"
        voltar={{ href: '/pedido/revisao', rotulo: 'Voltar à revisão' }}
        texto="Até 5 fotos. Elas ajudam o profissional a entender o serviço antes de aceitar."
      />
      <div className="glass-card painel-cartao pilha">
        {fotos === null ? <Carregando texto="Carregando fotos…" /> : null}
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {fotos !== null ? (
          <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }}>
            {(fotos ?? []).map((f) => (
              <div key={f.id} className="cartao" style={{ position: 'relative' }}>
                <div className="servico-imagem" style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--fp-bg-light)' }}>
                  {f.estado === 'pronta' ? <Miniatura id={f.id} /> : <Icone nome={f.estado === 'recusada' ? 'alerta' : 'relogio'} tamanho={28} />}
                  <span className={`nota-flutuante ${f.estado === 'recusada' ? 'selo-erro' : ''}`}>{TEXTO_ESTADO[f.estado] ?? f.estado}</span>
                </div>
                <div style={{ padding: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm btn-bloco" onClick={() => void remover(f.id)}>
                    Remover
                  </button>
                </div>
              </div>
            ))}
            {vivas.length < LIMITE ? (
              <button
                type="button"
                className="opcao"
                style={{ flexDirection: 'column', justifyContent: 'center', aspectRatio: '1 / 1', borderStyle: 'dashed' }}
                onClick={() => seletor.current?.click()}
                disabled={enviando}
              >
                <Icone nome={enviando ? 'relogio' : 'mais'} tamanho={28} />
                <span style={{ fontWeight: 500 }}>{enviando ? 'Enviando…' : 'Adicionar foto'}</span>
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={seletor}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void enviar(f);
          }}
        />
        <Link href="/pedido/revisao" className="btn btn-primary btn-bloco">
          Continuar para a revisão <Icone nome="seta" tamanho={18} />
        </Link>
      </div>
    </PaginaInterna>
  );
}
