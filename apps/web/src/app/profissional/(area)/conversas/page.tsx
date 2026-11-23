'use client';
// Conversas do profissional (GET /v1/conversations): uma por pedido aceito, da mais recente para a mais antiga.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Conversa, iniciais } from '@/components/Conversa';
import { Aviso, CabecaPagina, Carregando, Vazio } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { formatarDataHora } from '@/lib/formatos';

interface Resumo {
  conversationId: string;
  serviceName: string;
  otherName: string;
  state: string;
  requestStatus: string;
  selected: boolean;
  lastKind: string | null;
  lastBody: string | null;
  lastAt: string | null;
}

function previa(c: Resumo): string {
  if (c.lastKind === 'sistema') return 'Você aceitou o pedido.';
  return c.lastBody ?? '';
}

export default function Conversas() {
  const router = useRouter();
  const [itens, setItens] = useState<Resumo[] | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      const r = await chamarApi<{ items?: Resumo[] }>('/v1/conversations');
      if (r.status === 401) {
        router.replace('/profissional/entrar');
        return;
      }
      if (r.status !== 200) {
        setItens([]);
        setErro('Não foi possível carregar as conversas agora.');
        return;
      }
      const lista = Array.isArray(r.corpo?.items) ? r.corpo.items : [];
      setItens(lista);
      setAtivo((a) => a ?? lista[0]?.conversationId ?? null);
    })();
  }, [router]);

  if (itens === null) return <Carregando texto="Carregando conversas…" />;

  return (
    <>
      <CabecaPagina sobretitulo="Mensagens" titulo="Suas" destaque="conversas" texto="Uma conversa para cada pedido que você aceitou." />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {itens.length === 0 && !erro ? (
        <div className="glass-card">
          <Vazio
            icone="conversa"
            titulo="Nenhuma conversa ainda"
            texto="Quando você aceitar um pedido, a conversa com o cliente aparece aqui."
            acao={
              <Link href="/profissional/pedidos" className="btn btn-primary btn-sm">
                Ver pedidos da região
              </Link>
            }
          />
        </div>
      ) : null}
      {itens.length > 0 ? (
        <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))', alignItems: 'start' }}>
          <div className="pilha" style={{ gap: '0.75rem' }}>
            {itens.map((x) => (
              <button
                key={x.conversationId}
                type="button"
                className="item-lista"
                style={{ textAlign: 'left', cursor: 'pointer', borderColor: x.conversationId === ativo ? 'var(--color-primary)' : undefined }}
                aria-pressed={x.conversationId === ativo}
                onClick={() => setAtivo(x.conversationId)}
              >
                <span className="avatar-letra" aria-hidden="true">
                  {iniciais(x.otherName)}
                </span>
                <span className="item-corpo">
                  <span className="linha-entre">
                    <span className="item-titulo">
                      {x.otherName} · {x.serviceName}
                    </span>
                    {x.selected ? <span className="selo selo-sm selo-sucesso">Você foi escolhido</span> : null}
                  </span>
                  <span className="campo-dica" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {previa(x)}
                  </span>
                  <span className="campo-dica">{formatarDataHora(x.lastAt)}</span>
                </span>
              </button>
            ))}
          </div>
          {ativo ? <Conversa conversationId={ativo} /> : null}
        </div>
      ) : null}
    </>
  );
}
