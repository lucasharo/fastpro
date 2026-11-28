'use client';
// Detalhe do pedido do cliente: dados (GET /v1/requests/:id) e quem aceitou (GET .../acceptances). O contato acontece
// no WhatsApp (o profissional chama o cliente); aqui o cliente ve o perfil, encerra o pedido e avalia.
// Pacote C: chamar mais profissionais (POST .../more-professionals) e republicar (POST .../republish), liberados por GET .../actions.
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirmacao } from '@/components/Confirmacao';
import { AvaliacaoPedido } from '@/components/AvaliacaoPedido';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, PaginaInterna, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData, formatarDataHora, rotuloUrgencia, STATUS_PEDIDO, UUID_RE } from '@/lib/formatos';
import { fotoDoServico, urlFoto } from '@/lib/mock';
import { FotosPedido } from '@/components/FotosPedido';
import { iniciais } from '@/lib/iniciais';
import { Toast } from '@/components/Toast';

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
  professionalSlug: string | null;
  status: string;
  acceptedAt: string | null;
}

type AcaoPedido = 'concluir' | 'desfazer' | 'cancelar';

const CAMINHO_ACAO: Record<AcaoPedido, string> = {
  concluir: 'complete',
  desfazer: 'uncomplete',
  cancelar: 'cancel',
};

const TEXTO_SUCESSO: Record<AcaoPedido, string> = {
  concluir: 'Pedido marcado como concluído. Você pode desfazer essa marcação em até 24 horas.',
  desfazer: 'A conclusão foi desfeita. O pedido voltou a ficar aberto.',
  cancelar: 'Pedido cancelado. Os profissionais não veem mais o seu WhatsApp.',
};

const DIALOGO_ACAO: Record<AcaoPedido, { titulo: string; texto: string; confirmar: string }> = {
  concluir: {
    titulo: 'Marcar como concluído?',
    texto: 'Confirme que o serviço foi realizado. Você poderá desfazer essa marcação em até 24 horas.',
    confirmar: 'Confirmar conclusão',
  },
  desfazer: {
    titulo: 'Desfazer a conclusão?',
    texto: 'O pedido volta a ficar aberto e quem aceitou pode ver seu WhatsApp de novo.',
    confirmar: 'Desfazer conclusão',
  },
  cancelar: {
    titulo: 'Cancelar este pedido?',
    texto: 'O pedido deixa de receber aceites e os profissionais não veem mais o seu WhatsApp.',
    confirmar: 'Cancelar pedido',
  },
};

export default function DetalhePedido() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [interessados, setInteressados] = useState<Interessado[] | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  // Pacote A: acao do pedido aguardando confirmacao (concluir, desfazer ou cancelar).
  const [acao, setAcao] = useState<AcaoPedido | null>(null);
  const [executando, setExecutando] = useState(false);
  const [acoes, setAcoes] = useState<Acoes | null>(null);
  const [acionando, setAcionando] = useState<'mais' | 'republicar' | null>(null);
  const [confirmandoRepublicar, setConfirmandoRepublicar] = useState(false);
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
  }, [id, router]);

  useEffect(() => {
    if (!UUID_RE.test(id)) {
      setErro('Pedido não encontrado.');
      return;
    }
    void carregar();
  }, [id, carregar]);

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
  const podeConcluir = (p.status === 'publicado' || p.status === 'selecionado') && ativos.length > 0;

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
            {podeConcluir ? (
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
              <FotosPedido pedidoId={id} papel="dono" />
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
              <div key={x.acceptanceId} className="item-lista" style={{ alignItems: 'flex-start' }}>
                <span className="avatar-letra" style={{ width: '3.5rem', height: '3.5rem', fontSize: '1.125rem' }} aria-hidden="true">
                  {iniciais(x.professionalName)}
                </span>
                <div className="item-corpo">
                  <div className="linha-entre">
                    <span className="item-titulo">{x.professionalName}</span>
                    {x.status !== 'ativo' ? (
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
                    {x.professionalSlug ? (
                      <Link href={`/p/${x.professionalSlug}`} className="btn btn-secondary btn-sm">
                        <Icone nome="usuario" tamanho={16} /> Ver perfil
                      </Link>
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
            <Toast aviso={aviso} />
          </div>
        </div>
        {p.status === 'concluido' ? (
          <AvaliacaoPedido
            pedidoId={id}
            profissionais={ativos.map((x) => ({ valor: x.acceptanceId, rotulo: x.professionalName }))}
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
