'use client';
// Detalhe de um pedido da regiao (GET /v1/professional/requests/:id) e aceite (POST /v1/requests/:id/acceptances).
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData, formatarDataHora, rotuloUrgencia, UUID_RE } from '@/lib/formatos';
import { fotoDoServico, urlFoto } from '@/lib/mock';
import { distancia, ROTULO_MODALIDADE } from '@/lib/profissional';

interface Detalhe {
  id: string;
  serviceName?: string;
  urgency?: string;
  description?: string;
  publicLabel?: string;
  distanceKm?: number;
  modality?: string;
  publishedAt?: string;
  acceptanceDeadlineAt?: string;
}

export default function PedidoRegiao() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [aceite, setAceite] = useState<'nao' | 'enviando' | 'ok'>('nao');
  const [avisoAceite, setAvisoAceite] = useState('');
  const chave = useRef<string | null>(null);

  useEffect(() => {
    if (!UUID_RE.test(id)) {
      setErro('Pedido não encontrado ou não está mais disponível.');
      return;
    }
    (async () => {
      const r = await chamarApi<Detalhe>(`/v1/professional/requests/${id}`);
      if (r.status === 401) router.replace('/profissional/entrar');
      else if (r.status === 200 && r.corpo) setP(r.corpo);
      else setErro(r.status === 404 ? 'Pedido não encontrado ou não está mais disponível.' : 'Não foi possível abrir o pedido agora.');
    })();
  }, [id, router]);

  async function aceitar() {
    chave.current ??= crypto.randomUUID();
    setAceite('enviando');
    setAvisoAceite('');
    const r = await chamarApi<{ code?: string; message?: string }>(`/v1/requests/${id}/acceptances`, {
      body: {},
      headers: { 'Idempotency-Key': chave.current },
    });
    if (r.status === 200 || r.status === 201) {
      setAceite('ok');
      return;
    }
    setAceite('nao');
    if (r.status === 0) return setAvisoAceite('Sem conexão. Tente de novo.');
    chave.current = null;
    if (r.status === 401) router.replace('/profissional/entrar');
    else if (r.status === 429) setAvisoAceite(MENSAGEM_LIMITE);
    else if (r.status === 404) setAvisoAceite('Este pedido não está mais disponível.');
    else setAvisoAceite(r.corpo?.message ?? 'Não foi possível aceitar agora. Confira sua verificação e assinatura.');
  }

  if (erro) {
    return (
      <>
        <CabecaPagina titulo="Pedido" voltar={{ href: '/profissional/pedidos', rotulo: 'Pedidos da região' }} />
        <Aviso tipo="erro">{erro}</Aviso>
      </>
    );
  }
  if (!p) return <Carregando texto="Carregando o pedido…" />;

  return (
    <>
      <CabecaPagina
        sobretitulo={`Publicado em ${formatarData(p.publishedAt)}`}
        titulo={p.serviceName ?? 'Pedido'}
        voltar={{ href: '/profissional/pedidos', rotulo: 'Pedidos da região' }}
      />
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))', alignItems: 'start' }}>
        <div className="cartao">
          <div className="servico-imagem" style={{ aspectRatio: '16 / 9' }}>
            <Image src={urlFoto(fotoDoServico(p.serviceName), 900, 500)} alt="" fill sizes="50vw" />
          </div>
          <div className="servico-corpo pilha">
            <div className="item-meta">
              {p.publicLabel ? (
                <span>
                  <Icone nome="local" tamanho={14} /> {p.publicLabel}
                </span>
              ) : null}
              {p.distanceKm !== undefined ? <span>{distancia(p.distanceKm)} de você</span> : null}
              <span>
                <Icone nome="relogio" tamanho={14} /> {rotuloUrgencia(p.urgency)}
              </span>
              {p.modality ? <span>{ROTULO_MODALIDADE[p.modality] ?? p.modality}</span> : null}
            </div>
            <p style={{ color: 'var(--fp-text)', whiteSpace: 'pre-wrap', marginBottom: 0 }}>{p.description}</p>
          </div>
        </div>
        <div className="glass-card painel-cartao pilha">
          <h2 style={{ fontSize: '1.25rem' }}>
            Tem interesse? <span className="destaque">Aceite o pedido</span>
          </h2>
          <p className="texto-suave">
            Ao aceitar, o cliente vê seu perfil e pode conversar com você. O endereço completo só aparece se ele escolher você.
          </p>
          {p.acceptanceDeadlineAt ? (
            <div className="item-meta">
              <span>
                <Icone nome="calendario" tamanho={14} /> Aceites até {formatarDataHora(p.acceptanceDeadlineAt)}
              </span>
            </div>
          ) : null}
          {aceite === 'ok' ? (
            <>
              <Aviso tipo="sucesso">Pedido aceito! Avisamos o cliente. Acompanhe pelas conversas.</Aviso>
              <Link href="/profissional/conversas" className="btn btn-primary btn-bloco">
                Ir para as conversas <Icone nome="conversa" tamanho={18} />
              </Link>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-bloco" disabled={aceite === 'enviando'} onClick={() => void aceitar()}>
              {aceite === 'enviando' ? 'Aceitando…' : 'Aceitar pedido'} <Icone nome="check" tamanho={18} />
            </button>
          )}
          {avisoAceite ? <Aviso tipo="erro">{avisoAceite}</Aviso> : null}
        </div>
      </div>
    </>
  );
}
