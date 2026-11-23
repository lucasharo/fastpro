'use client';
// Detalhe do pedido do cliente: dados reais (GET /v1/requests/:id). Interessados, conversa e escolha sao
// DEMONSTRACAO ate o backlog E6 a E8 chegar a tela (o aceite do profissional ja existe na API).
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Conversa } from '@/components/Conversa';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, PaginaInterna, SeloMock } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { formatarData, formatarDataHora, rotuloUrgencia, STATUS_PEDIDO, UUID_RE } from '@/lib/formatos';
import { fotoDoServico, INTERESSADOS, urlFoto } from '@/lib/mock';

interface Detalhe {
  serviceName?: string;
  status?: string;
  publishedAt?: string;
  urgency?: string;
  description?: string;
  addressText?: string;
  acceptanceDeadlineAt?: string;
}

export default function DetalhePedido() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [conversaCom, setConversaCom] = useState(INTERESSADOS[0]?.id ?? '');
  const [escolhido, setEscolhido] = useState<string | null>(null);

  useEffect(() => {
    if (!UUID_RE.test(id)) {
      setErro('Pedido não encontrado.');
      return;
    }
    (async () => {
      const r = await chamarApi<Detalhe>(`/v1/requests/${id}`);
      if (r.status === 401) router.replace('/entrar');
      else if (r.status === 200 && r.corpo) setP(r.corpo);
      else setErro(r.status === 404 ? 'Pedido não encontrado.' : 'Não foi possível abrir o pedido agora.');
    })();
  }, [id, router]);

  if (erro) {
    return (
      <PaginaInterna largura="media">
        <CabecaPagina titulo="Pedido" voltar={{ href: '/painel', rotulo: 'Meus pedidos' }} />
        <Aviso tipo="erro">{erro}</Aviso>
      </PaginaInterna>
    );
  }
  if (!p) {
    return (
      <PaginaInterna>
        <Carregando texto="Carregando o pedido…" />
      </PaginaInterna>
    );
  }

  const st = STATUS_PEDIDO[p.status ?? ''];
  const pro = INTERESSADOS.find((x) => x.id === conversaCom) ?? INTERESSADOS[0];

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
              <p style={{ color: 'var(--fp-text)', whiteSpace: 'pre-wrap', marginBottom: 0 }}>{p.description}</p>
            </div>
          </div>

          <div className="pilha">
            <div className="linha-entre">
              <h2 style={{ fontSize: '1.25rem' }}>
                {INTERESSADOS.length} profissionais <span className="destaque">aceitaram</span>
              </h2>
              <SeloMock />
            </div>
            {INTERESSADOS.map((x) => (
              <div key={x.id} className="item-lista" style={{ alignItems: 'flex-start' }}>
                <Image src={x.foto} alt="" width={56} height={56} className="avatar" style={{ width: '3.5rem', height: '3.5rem' }} />
                <div className="item-corpo">
                  <div className="linha-entre">
                    <span className="item-titulo">{x.nome}</span>
                    <span className="nota-flutuante" style={{ position: 'static' }}>
                      <Icone nome="estrela" tamanho={12} preenchido className="estrela" /> {x.nota} ({x.avaliacoes})
                    </span>
                  </div>
                  <p className="texto-suave" style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                    {x.resumo}
                  </p>
                  <div className="item-meta">
                    <span>
                      <Icone nome="local" tamanho={14} /> {x.distancia}
                    </span>
                    <span>
                      <Icone nome="check" tamanho={14} /> {x.servicos} serviços
                    </span>
                    <span>
                      <Icone nome="escudo" tamanho={14} /> Verificado desde {x.desde}
                    </span>
                  </div>
                  <div className="linha" style={{ marginTop: '0.75rem' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConversaCom(x.id)}>
                      <Icone nome="conversa" tamanho={16} /> Conversar
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${escolhido === x.id ? 'btn-escuro' : 'btn-primary'}`}
                      onClick={() => setEscolhido(x.id)}
                    >
                      {escolhido === x.id ? 'Escolhido' : 'Escolher'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {escolhido ? (
              <Aviso tipo="sucesso">
                Você escolheu {INTERESSADOS.find((x) => x.id === escolhido)?.nome}. Os outros profissionais serão avisados. (Demonstração: a escolha ainda não é gravada.)
              </Aviso>
            ) : null}
          </div>
        </div>
        {pro ? <Conversa nome={pro.nome} foto={pro.foto} subtitulo={`Nota ${pro.nota} · ${pro.distancia}`} /> : null}
        <p className="campo-dica" style={{ textAlign: 'center' }}>
          Dúvidas? <Link href="/#como-funciona">Veja como funciona</Link>.
        </p>
      </div>
    </PaginaInterna>
  );
}
