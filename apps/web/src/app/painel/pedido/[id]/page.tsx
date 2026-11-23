'use client';
// Detalhe do pedido do cliente: dados (GET /v1/requests/:id), quem aceitou (GET .../acceptances), conversa com cada
// um e escolha do profissional (POST .../selection). Tudo real; sem dados de demonstracao.
// Pacote C: chamar mais profissionais (POST .../more-professionals) e republicar (POST .../republish), liberados por GET .../actions.
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirmacao } from '@/components/Confirmacao';
import { Conversa, iniciais } from '@/components/Conversa';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, PaginaInterna, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
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

interface Acoes {
  canCallMore: boolean;
  canRepublish: boolean;
}

interface Interessado {
  acceptanceId: string;
  professionalName: string;
  status: string;
  acceptedAt: string | null;
  conversationId: string | null;
  selected: boolean;
}

type AcaoPedido = 'concluir' | 'desfazer' | 'cancelar';

const CAMINHO_ACAO: Record<AcaoPedido, string> = {
  concluir: 'complete',
  desfazer: 'uncomplete',
  cancelar: 'cancel',
};

const TEXTO_SUCESSO: Record<AcaoPedido, string> = {
  concluir: 'Pedido marcado como concluído. Você pode desfazer essa marcação em até 24 horas.',
  desfazer: 'A conclusão foi desfeita. O pedido voltou para selecionado.',
  cancelar: 'Pedido cancelado. As conversas com os profissionais ficaram somente de leitura.',
};

const DIALOGO_ACAO: Record<AcaoPedido, { titulo: string; texto: string; confirmar: string }> = {
  concluir: {
    titulo: 'Marcar como concluído?',
    texto: 'Confirme que o serviço foi realizado. Você poderá desfazer essa marcação em até 24 horas.',
    confirmar: 'Confirmar conclusão',
  },
  desfazer: {
    titulo: 'Desfazer a conclusão?',
    texto: 'O pedido volta para selecionado e a conversa com o profissional escolhido continua disponível.',
    confirmar: 'Desfazer conclusão',
  },
  cancelar: {
    titulo: 'Cancelar este pedido?',
    texto: 'O pedido deixa de receber aceites. As conversas com os profissionais ficam somente de leitura.',
    confirmar: 'Cancelar pedido',
  },
};

export default function DetalhePedido() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [interessados, setInteressados] = useState<Interessado[] | null>(null);
  const [conversaAberta, setConversaAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  // Pacote A: acao do pedido aguardando confirmacao (concluir, desfazer ou cancelar).
  const [acao, setAcao] = useState<AcaoPedido | null>(null);
  const [executando, setExecutando] = useState(false);
  const [acoes, setAcoes] = useState<Acoes | null>(null);
  const [acionando, setAcionando] = useState<'mais' | 'republicar' | null>(null);
  const [confirmandoRepublicar, setConfirmandoRepublicar] = useState(false);
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
    const [d, a, ac] = await Promise.all([
      chamarApi<Detalhe>(`/v1/requests/${id}`),
      chamarApi<{ items?: Interessado[] }>(`/v1/requests/${id}/acceptances`),
      chamarApi<Acoes>(`/v1/requests/${id}/actions`),
    ]);
    if (d.status === 401) {
      router.replace('/entrar');
      return;
    }
    setAcoes(ac.status === 200 && ac.corpo ? ac.corpo : null);
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

  // Pacote A: concluir, desfazer a conclusao (ate 24 h) ou cancelar. A regra mora no banco; a tela so mostra o resultado.
  async function executarAcao(tipo: AcaoPedido) {
    setExecutando(true);
    setAviso(null);
    const r = await chamarApi<{ code?: string }>(`/v1/requests/${id}/${CAMINHO_ACAO[tipo]}`, { method: 'POST' });
    setExecutando(false);
    setAcao(null);
    if (r.status === 200) {
      setAviso({ tipo: 'sucesso', texto: TEXTO_SUCESSO[tipo] });
      await carregar();
      return;
    }
    const c = r.corpo?.code;
    setAviso({
      tipo: 'erro',
      texto:
        r.status === 429
          ? MENSAGEM_LIMITE
          : r.status === 404
            ? 'Pedido não encontrado.'
            : c === 'prazo_encerrado'
              ? 'O prazo de 24 horas para desfazer a conclusão terminou.'
              : c === 'estado_invalido'
                ? 'Este pedido não pode mais ser alterado assim. A tela será atualizada.'
                : MENSAGEM_INDISPONIVEL,
    });
  }

  async function chamarMais() {
    setAcionando('mais');
    setAviso(null);
    const r = await chamarApi(`/v1/requests/${id}/more-professionals`, { method: 'POST' });
    setAcionando(null);
    if (r.status === 200) {
      setAviso({ tipo: 'sucesso', texto: 'Pronto. Novos profissionais verificados já podem aceitar este pedido.' });
    } else {
      setAviso({ tipo: 'erro', texto: r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível chamar mais profissionais agora. Tente de novo.' });
    }
    await carregar();
  }

  async function republicar() {
    setAcionando('republicar');
    setAviso(null);
    const r = await chamarApi<{ status?: string }>(`/v1/requests/${id}/republish`, { method: 'POST' });
    setAcionando(null);
    setConfirmandoRepublicar(false);
    if (r.status === 201) {
      router.push('/pedido');
      return;
    }
    if (r.status === 200) {
      setAviso({ tipo: 'erro', texto: 'Já existe uma republicação deste pedido em andamento.' });
      return;
    }
    setAviso({ tipo: 'erro', texto: r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível republicar este pedido agora. Tente de novo.' });
    await carregar();
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
        {p.status === 'selecionado' || p.status === 'concluido' || p.status === 'publicado' || p.status === 'cancelado' ? (
          <div className="pacote-a-acoes" aria-label="Ações do pedido">
            {p.status === 'selecionado' ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={executando} onClick={() => setAcao('concluir')}>
                <Icone nome="check" tamanho={16} /> Marcar como concluído
              </button>
            ) : null}
            {p.status === 'concluido' ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={executando} onClick={() => setAcao('desfazer')}>
                <Icone nome="seta" tamanho={16} /> Desfazer conclusão
              </button>
            ) : null}
            {p.status === 'publicado' || p.status === 'selecionado' ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={executando} onClick={() => setAcao('cancelar')}>
                <Icone nome="fechar" tamanho={16} /> Cancelar pedido
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="grade"style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', alignItems: 'start' }}>
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
            {acoes?.canCallMore ? (
              <div className="linha">
                <button type="button" className="btn btn-secondary" disabled={acionando !== null} onClick={() => void chamarMais()}>
                  {acionando === 'mais' ? 'Chamando…' : 'Chamar mais profissionais'}
                </button>
              </div>
            ) : null}
            {acoes?.canRepublish && !confirmandoRepublicar ? (
              <div className="linha">
                <button type="button" className="btn btn-secondary" disabled={acionando !== null} onClick={() => setConfirmandoRepublicar(true)}>
                  Republicar pedido
                </button>
              </div>
            ) : null}
            {acoes?.canRepublish && confirmandoRepublicar ? (
              <div className="pilha">
                <p style={{ color: 'var(--color-text-primary)', marginBottom: 0 }}>
                  Vamos criar um novo rascunho com os mesmos dados. Você revisa e publica pelo fluxo normal.
                </p>
                <div className="linha">
                  <button type="button" className="btn btn-primary" disabled={acionando !== null} onClick={() => void republicar()}>
                    {acionando === 'republicar' ? 'Republicando…' : 'Confirmar republicação'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={acionando !== null} onClick={() => setConfirmandoRepublicar(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
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
      <Confirmacao
        aberto={acao !== null}
        titulo={acao ? DIALOGO_ACAO[acao].titulo : ''}
        texto={acao ? DIALOGO_ACAO[acao].texto : ''}
        rotuloConfirmar={acao ? DIALOGO_ACAO[acao].confirmar : ''}
        rotuloCancelar={acao === 'desfazer' ? 'Manter conclusão' : 'Voltar'}
        ocupado={executando}
        onConfirmar={() => acao && void executarAcao(acao)}
        onFechar={() => setAcao(null)}
      />
    </PaginaInterna>
  );
}
