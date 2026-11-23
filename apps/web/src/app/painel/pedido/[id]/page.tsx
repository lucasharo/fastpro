'use client';
// Detalhe do pedido do cliente: dados (GET /v1/requests/:id), quem aceitou (GET .../acceptances), conversa com cada
// um e escolha do profissional (POST .../selection). Tudo real; sem dados de demonstracao.
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Conversa, iniciais } from '@/components/Conversa';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, PaginaInterna, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData, formatarDataHora, rotuloUrgencia, STATUS_PEDIDO, UUID_RE } from '@/lib/formatos';
import { fotoDoServico, urlFoto } from '@/lib/mock';

interface Detalhe {
  serviceName?: string;
  status?: string;
  publishedAt?: string;
  urgency?: string;
  description?: string;
  addressText?: string;
  acceptanceDeadlineAt?: string;
}

interface Interessado {
  acceptanceId: string;
  professionalName: string;
  status: string;
  acceptedAt: string | null;
  conversationId: string | null;
  selected: boolean;
}

export default function DetalhePedido() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [interessados, setInteressados] = useState<Interessado[] | null>(null);
  const [conversaAberta, setConversaAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  // Nao lidas por conversa (H-101), lidas de GET /v1/conversations e atualizadas a cada 10 s.
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});

  const atualizarNaoLidas = useCallback(async () => {
    const r = await chamarApi<{ items?: { conversationId: string; unreadCount?: number }[] }>('/v1/conversations');
    if (r.status !== 200 || !Array.isArray(r.corpo?.items)) return;
    const mapa: Record<string, number> = {};
    for (const c of r.corpo.items) if (c.unreadCount) mapa[c.conversationId] = c.unreadCount;
    setNaoLidas(mapa);
  }, []);

  const carregar = useCallback(async () => {
    const [d, a] = await Promise.all([
      chamarApi<Detalhe>(`/v1/requests/${id}`),
      chamarApi<{ items?: Interessado[] }>(`/v1/requests/${id}/acceptances`),
    ]);
    if (d.status === 401) {
      router.replace('/entrar');
      return;
    }
    if (d.status === 200 && d.corpo) setP(d.corpo);
    else setErro(d.status === 404 ? 'Pedido não encontrado.' : 'Não foi possível abrir o pedido agora.');
    const lista = a.status === 200 && Array.isArray(a.corpo?.items) ? a.corpo.items : [];
    setInteressados(lista);
    setConversaAberta((atual) => atual ?? lista.find((x) => x.selected)?.conversationId ?? lista[0]?.conversationId ?? null);
    void atualizarNaoLidas();
  }, [id, router, atualizarNaoLidas]);

  useEffect(() => {
    if (!UUID_RE.test(id)) {
      setErro('Pedido não encontrado.');
      return;
    }
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void atualizarNaoLidas();
    }, 10000);
    return () => clearInterval(t);
  }, [id, carregar, atualizarNaoLidas]);

  async function escolher(x: Interessado) {
    setEscolhendo(x.acceptanceId);
    setAviso(null);
    const r = await chamarApi<{ code?: string }>(`/v1/requests/${id}/selection`, { body: { acceptance_id: x.acceptanceId } });
    setEscolhendo(null);
    if (r.status === 200) {
      setAviso({ tipo: 'sucesso', texto: `Você escolheu ${x.professionalName}. Combine os detalhes pela conversa.` });
      setConversaAberta(x.conversationId);
      await carregar();
      return;
    }
    const c = r.corpo?.code;
    setAviso({
      tipo: 'erro',
      texto:
        r.status === 429
          ? MENSAGEM_LIMITE
          : c === 'aceite_invalido'
            ? 'Este profissional não está mais disponível para este pedido.'
            : c === 'estado_invalido'
              ? 'Este pedido já foi concluído ou cancelado.'
              : 'Não foi possível escolher agora. Tente de novo.',
    });
  }

  if (erro) {
    return (
      <PaginaInterna largura="media">
        <CabecaPagina titulo="Pedido" voltar={{ href: '/painel', rotulo: 'Meus pedidos' }} />
        <Aviso tipo="erro">{erro}</Aviso>
      </PaginaInterna>
    );
  }
  if (!p || interessados === null) {
    return (
      <PaginaInterna>
        <Carregando texto="Carregando o pedido…" />
      </PaginaInterna>
    );
  }

  const st = STATUS_PEDIDO[p.status ?? ''];
  const ativos = interessados.filter((x) => x.status === 'ativo');
  const podeEscolher = p.status === 'publicado' || p.status === 'selecionado';

  return (
    <PaginaInterna>
      <CabecaPagina
        sobretitulo={`Publicado em ${formatarData(p.publishedAt)}`}
        titulo={p.serviceName ?? 'Pedido'}
        voltar={{ href: '/painel', rotulo: 'Meus pedidos' }}
        acoes={st ? <span className={`selo ${st.classe}`}>{st.rotulo}</span> : undefined}
      />
      <div className="pilha" style={{ gap: '1.5rem' }}>
        <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', alignItems: 'start' }}>
          <div className="cartao">
            <div className="servico-imagem" style={{ aspectRatio: '16 / 9' }}>
              <Image src={urlFoto(fotoDoServico(p.serviceName), 900, 500)} alt="" fill sizes="50vw" />
            </div>
            <div className="servico-corpo pilha">
              <div className="item-meta">
                <span>
                  <Icone nome="relogio" tamanho={14} /> {rotuloUrgencia(p.urgency)}
                </span>
                {p.acceptanceDeadlineAt ? (
                  <span>
                    <Icone nome="calendario" tamanho={14} /> Aceites até {formatarDataHora(p.acceptanceDeadlineAt)}
                  </span>
                ) : null}
              </div>
              {p.addressText ? (
                <div className="linha" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Icone nome="local" tamanho={18} className="estrela" />
                  <span>{p.addressText}</span>
                </div>
              ) : null}
              <p style={{ color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', marginBottom: 0 }}>{p.description}</p>
            </div>
          </div>

          <div className="pilha">
            <h2 style={{ fontSize: '1.25rem' }}>
              {ativos.length === 0 ? (
                <>
                  Aguardando <span className="destaque">profissionais</span>
                </>
              ) : (
                <>
                  {ativos.length} {ativos.length === 1 ? 'profissional' : 'profissionais'}{' '}
                  <span className="destaque">{ativos.length === 1 ? 'aceitou' : 'aceitaram'}</span>
                </>
              )}
            </h2>
            {interessados.length === 0 ? (
              <div className="glass-card">
                <Vazio
                  icone="relogio"
                  titulo="Ninguém aceitou ainda"
                  texto="Os profissionais verificados da sua região já podem ver seu pedido. Quando alguém aceitar, ele aparece aqui."
                />
              </div>
            ) : null}
            {interessados.map((x) => (
              <div key={x.acceptanceId} className="item-lista" style={{ alignItems: 'flex-start', borderColor: x.selected ? 'var(--color-primary)' : undefined }}>
                <span className="avatar-letra" style={{ width: '3.5rem', height: '3.5rem', fontSize: '1.125rem' }} aria-hidden="true">
                  {iniciais(x.professionalName)}
                </span>
                <div className="item-corpo">
                  <div className="linha-entre">
                    <span className="item-titulo">{x.professionalName}</span>
                    {x.selected ? (
                      <span className="selo selo-sm selo-sucesso">Escolhido</span>
                    ) : x.status !== 'ativo' ? (
                      <span className="selo selo-sm selo-neutro">Retirou o aceite</span>
                    ) : null}
                  </div>
                  <div className="item-meta">
                    <span>
                      <Icone nome="escudo" tamanho={14} /> Verificado
                    </span>
                    {x.acceptedAt ? (
                      <span>
                        <Icone nome="relogio" tamanho={14} /> Aceitou em {formatarDataHora(x.acceptedAt)}
                      </span>
                    ) : null}
                  </div>
                  <div className="linha" style={{ marginTop: '0.75rem' }}>
                    {x.conversationId ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-pressed={conversaAberta === x.conversationId}
                        onClick={() => setConversaAberta(x.conversationId)}
                      >
                        <Icone nome="conversa" tamanho={16} /> Conversar
                        {naoLidas[x.conversationId] ? (
                          <span className="selo selo-sm selo-alerta selo-contador" aria-label={`${naoLidas[x.conversationId]} mensagens não lidas`}>
                            {naoLidas[x.conversationId]}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {x.status === 'ativo' && !x.selected && podeEscolher ? (
                      <button type="button" className="btn btn-primary btn-sm" disabled={escolhendo !== null} onClick={() => void escolher(x)}>
                        {escolhendo === x.acceptanceId ? 'Escolhendo…' : p.status === 'selecionado' ? 'Trocar para este' : 'Escolher'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
          </div>
        </div>
        {conversaAberta ? (
          <Conversa
            conversationId={conversaAberta}
            subtitulo={`Conversa sobre ${p.serviceName ?? 'o pedido'}`}
            aoMudar={() => void atualizarNaoLidas()}
          />
        ) : null}
      </div>
    </PaginaInterna>
  );
}
