'use client';
// Pedidos da regiao (GET /v1/professional/discovery/requests), com paginacao por cursor.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CartaoPedidoRegiao } from '@/components/CartaoPedidoRegiao';
import { Aviso, CabecaPagina, Carregando, Vazio } from '@/components/ui';
import { lerDescoberta, type ItemDescoberta } from '@/lib/profissional';

export default function PedidosRegiao() {
  const router = useRouter();
  const [itens, setItens] = useState<ItemDescoberta[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(
    async (depois?: string) => {
      const r = await lerDescoberta(depois);
      if (r.tipo === 'sessao') {
        router.replace('/profissional/entrar');
        return;
      }
      if (r.tipo === 'ok') {
        setItens((v) => (depois && v ? [...v, ...r.itens] : r.itens));
        setCursor(r.cursor);
      } else {
        setItens((v) => v ?? []);
        setAviso(r.tipo === 'sem_perfil' ? 'Complete seu perfil profissional para ver pedidos.' : r.texto);
      }
    },
    [router],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <CabecaPagina sobretitulo="Oportunidades" titulo="Pedidos" destaque="da sua região" texto="Pedidos publicados dentro do seu raio de atendimento, dos mais novos para os mais antigos." />
      {aviso ? <Aviso tipo="alerta">{aviso}</Aviso> : null}
      {itens === null ? <Carregando texto="Buscando pedidos…" /> : null}
      {itens && itens.length === 0 && !aviso ? (
        <div className="glass-card">
          <Vazio
            icone="local"
            titulo="Nenhum pedido disponível agora"
            texto="Para ver pedidos, é preciso estar verificado, com assinatura ativa e com serviços e área definidos."
            acao={
              <Link href="/profissional/perfil" className="btn btn-primary btn-sm">
                Revisar perfil e área
              </Link>
            }
          />
        </div>
      ) : null}
      {itens && itens.length > 0 ? (
        <div className="grade grade-3">
          {itens.map((p) => (
            <CartaoPedidoRegiao key={p.id} p={p} />
          ))}
        </div>
      ) : null}
      {cursor ? (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => void carregar(cursor)}>
            Carregar mais
          </button>
        </div>
      ) : null}
    </>
  );
}
