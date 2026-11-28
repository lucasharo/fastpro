'use client';
// Meus pedidos (cliente): lista real em GET /v1/requests. Sem sessao, leva a entrada.
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icone } from '@/components/Icone';
import { useSessao } from '@/components/Sessao';
import { Aviso, CabecaPagina, Carregando, PaginaInterna, Vazio } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { formatarData, rotuloUrgencia, STATUS_PEDIDO, UUID_RE } from '@/lib/formatos';
import { fotoDoServico, urlFoto } from '@/lib/mock';

interface ItemPedido {
  id: string;
  serviceName?: string;
  status?: string;
  publishedAt?: string;
  urgency?: string;
  acceptanceDeadlineAt?: string;
}

export default function Painel() {
  const router = useRouter();
  const [itens, setItens] = useState<ItemPedido[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(
    async (depois?: string) => {
      setErro('');
      const r = await chamarApi<{ items?: ItemPedido[]; nextCursor?: string | null }>(
        depois ? `/v1/requests?cursor=${encodeURIComponent(depois)}` : '/v1/requests',
      );
      if (r.status === 401 || r.status === 403) {
        router.replace('/entrar');
        return;
      }
      if (r.status !== 200) {
        setItens((v) => v ?? []);
        setErro('Não foi possível carregar seus pedidos agora. Tente de novo em instantes.');
        return;
      }
      const novos = Array.isArray(r.corpo?.items) ? r.corpo.items : [];
      setItens((v) => (depois && v ? [...v, ...novos] : novos));
      setCursor(typeof r.corpo?.nextCursor === 'string' && r.corpo.nextCursor ? r.corpo.nextCursor : null);
    },
    [router],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const { sair } = useSessao();

  return (
    <PaginaInterna>
      <CabecaPagina
        sobretitulo="Área do cliente"
        titulo="Meus"
        destaque="pedidos"
        texto="Acompanhe quem aceitou e veja o perfil de cada profissional."
        acoes={
          <div className="linha">
            <Link href="/pedido" className="btn btn-primary btn-sm">
              <Icone nome="mais" tamanho={16} /> Novo pedido
            </Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sair()}>
              <Icone nome="sair" tamanho={16} /> Sair
            </button>
          </div>
        }
      />
      {itens === null ? <Carregando texto="Carregando seus pedidos…" /> : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {itens !== null && itens.length === 0 && !erro ? (
        <div className="glass-card">
          <Vazio
            titulo="Você ainda não publicou pedidos"
            texto="Peça um orçamento grátis e receba profissionais verificados da sua região."
            acao={
              <Link href="/pedido" className="btn btn-primary btn-sm">
                Pedir orçamento
              </Link>
            }
          />
        </div>
      ) : null}
      {itens && itens.length > 0 ? (
        <div className="grade grade-3">
          {itens.map((p) => {
            const st = STATUS_PEDIDO[p.status ?? ''];
            const conteudo = (
              <>
                <div className="servico-imagem">
                  <Image src={urlFoto(fotoDoServico(p.serviceName))} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" />
                  {st ? <span className={`nota-flutuante selo ${st.classe}`}>{st.rotulo}</span> : null}
                </div>
                <div className="servico-corpo">
                  <h3>{p.serviceName ?? 'Serviço'}</h3>
                  <div className="item-meta" style={{ marginBottom: '0.75rem' }}>
                    <span>
                      <Icone nome="calendario" tamanho={14} /> {formatarData(p.publishedAt)}
                    </span>
                    <span>
                      <Icone nome="relogio" tamanho={14} /> {rotuloUrgencia(p.urgency)}
                    </span>
                  </div>
                  <div className="servico-rodape">
                    <span className="preco-sufixo">Ver interessados</span>
                    <span className="btn-icone" aria-hidden="true">
                      <Icone nome="seta" tamanho={18} />
                    </span>
                  </div>
                </div>
              </>
            );
            return UUID_RE.test(p.id) ? (
              <Link key={p.id} href={`/painel/pedido/${p.id}`} className="cartao cartao-elevado servico-card">
                {conteudo}
              </Link>
            ) : (
              <div key={p.id} className="cartao">
                {conteudo}
              </div>
            );
          })}
        </div>
      ) : null}
      {cursor ? (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => void carregar(cursor)}>
            Carregar mais
          </button>
        </div>
      ) : null}
    </PaginaInterna>
  );
}
