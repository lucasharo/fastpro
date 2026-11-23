'use client';
// Conversas do profissional (GET /v1/conversations): uma por pedido aceito, da mais recente para a mais antiga.
// Pacote A: retirar o aceite (ou desistir, se for o escolhido) com confirmacao (POST /v1/acceptances/:id/withdraw).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirmacao } from '@/components/Confirmacao';
import { Conversa, iniciais } from '@/components/Conversa';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarDataHora } from '@/lib/formatos';

interface Resumo {
  conversationId: string;
  acceptanceId: string;
  serviceName: string;
  otherName: string;
  state: string;
  requestStatus: string;
  selected: boolean;
  lastKind: string | null;
  lastEvent: string | null;
  lastBody: string | null;
  lastAt: string | null;
}

function previa(c: Resumo): string {
  if (c.lastKind === 'sistema' && c.lastEvent === 'aceite_retirado') return 'Aceite retirado.';
  if (c.lastKind === 'sistema') return 'Você aceitou o pedido.';
  return c.lastBody ?? '';
}

/** Retirar aceite só faz sentido com a conversa ativa e o pedido ainda aberto (publicado ou selecionado). */
function podeRetirar(c: Resumo): boolean {
  return c.state === 'ativa' && (c.requestStatus === 'publicado' || c.requestStatus === 'selecionado');
}

export default function Conversas() {
  const router = useRouter();
  const [itens, setItens] = useState<Resumo[] | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [retirada, setRetirada] = useState<Resumo | null>(null);
  const [executando, setExecutando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
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
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function retirar(c: Resumo) {
    setExecutando(true);
    setAviso(null);
    const r = await chamarApi<{ code?: string }>(`/v1/acceptances/${c.acceptanceId}/withdraw`, { body: {} });
    setExecutando(false);
    setRetirada(null);
    if (r.status === 200) {
      setAviso({
        tipo: 'sucesso',
        texto: c.selected
          ? 'Você desistiu do serviço. O pedido voltou a receber aceites, sem troca automática.'
          : 'Seu aceite foi retirado. A conversa ficou somente de leitura.',
      });
    } else {
      setAviso({
        tipo: 'erro',
        texto:
          r.status === 429
            ? MENSAGEM_LIMITE
            : r.status === 404 || r.corpo?.code === 'estado_invalido'
              ? 'Este pedido não permite mais essa ação. A lista será atualizada.'
              : MENSAGEM_INDISPONIVEL,
      });
    }
    await carregar();
  }

  if (itens === null) return <Carregando texto="Carregando conversas…" />;

  const atual = itens.find((x) => x.conversationId === ativo) ?? null;
  const textoRetirada = retirada?.selected
    ? {
        titulo: 'Desistir do serviço?',
        texto:
          'Você é o profissional escolhido. Ao desistir, o pedido volta a receber aceites, sem troca automática, e esta conversa fica somente de leitura. Sua vaga continua contando.',
        confirmar: 'Desistir do serviço',
      }
    : {
        titulo: 'Retirar seu aceite?',
        texto: 'O cliente deixa de contar com você para este pedido. A conversa fica somente de leitura e sua vaga continua contando.',
        confirmar: 'Retirar aceite',
      };

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
          {ativo ? (
            <div className="pilha" style={{ gap: '1rem' }}>
              {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
              {atual && podeRetirar(atual) ? (
                <div className="pacote-a-acoes">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={executando} onClick={() => setRetirada(atual)}>
                    <Icone nome="sair" tamanho={16} /> {atual.selected ? 'Desistir do serviço' : 'Retirar aceite'}
                  </button>
                </div>
              ) : null}
              <Conversa conversationId={ativo} />
            </div>
          ) : null}
        </div>
      ) : null}
      <Confirmacao
        aberto={retirada !== null}
        titulo={textoRetirada.titulo}
        texto={textoRetirada.texto}
        rotuloConfirmar={textoRetirada.confirmar}
        ocupado={executando}
        onConfirmar={() => retirada && void retirar(retirada)}
        onFechar={() => setRetirada(null)}
      />
    </>
  );
}
