'use client';
// Pedidos que o profissional aceitou, com o contato por WhatsApp e a retirada do aceite. A lista vem de
// GET /v1/conversations (um registro por aceite); o chat do app nao existe mais.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BotaoWhatsApp } from '@/components/BotaoWhatsApp';
import { Confirmacao } from '@/components/Confirmacao';
import { Aviso, CabecaPagina, Carregando, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { STATUS_PEDIDO } from '@/lib/formatos';
import { iniciais } from '@/lib/iniciais';
import { Toast } from '@/components/Toast';

interface Aceito {
  conversationId: string;
  requestId: string;
  acceptanceId: string;
  serviceName: string;
  otherName: string;
  state: string;
  requestStatus: string;
}

const aberto = (a: Aceito): boolean => a.state === 'ativa' && (a.requestStatus === 'publicado' || a.requestStatus === 'selecionado');

export default function PedidosAceitos() {
  const router = useRouter();
  const [itens, setItens] = useState<Aceito[] | null>(null);
  const [erro, setErro] = useState('');
  const [retirada, setRetirada] = useState<Aceito | null>(null);
  const [executando, setExecutando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<{ items?: Aceito[] }>('/v1/conversations');
    if (r.status === 401) {
      router.replace('/profissional/entrar');
      return;
    }
    if (r.status !== 200) {
      setItens((atual) => atual ?? []);
      setErro('Não foi possível carregar seus pedidos agora.');
      return;
    }
    setErro('');
    setItens(Array.isArray(r.corpo?.items) ? r.corpo.items : []);
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function retirar(a: Aceito) {
    setExecutando(true);
    setAviso(null);
    const r = await chamarApi<{ code?: string }>(`/v1/acceptances/${a.acceptanceId}/withdraw`, { body: {} });
    setExecutando(false);
    setRetirada(null);
    if (r.status === 200) setAviso({ tipo: 'sucesso', texto: 'Seu aceite foi retirado.' });
    else
      setAviso({
        tipo: 'erro',
        texto:
          r.status === 429
            ? MENSAGEM_LIMITE
            : r.status === 404 || r.corpo?.code === 'estado_invalido'
              ? 'Este pedido não permite mais essa ação. A lista foi atualizada.'
              : MENSAGEM_INDISPONIVEL,
      });
    await carregar();
  }

  if (itens === null) return <Carregando texto="Carregando seus pedidos…" />;

  return (
    <>
      <CabecaPagina sobretitulo="Meus aceites" titulo="Pedidos" destaque="aceitos" texto="Fale com o cliente pelo WhatsApp e combine o serviço." />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <Toast aviso={aviso} />
      {itens.length === 0 && !erro ? (
        <div className="glass-card">
          <Vazio
            icone="conversa"
            titulo="Nenhum pedido aceito"
            texto="Quando você aceitar um pedido, ele aparece aqui com o botão do WhatsApp."
            acao={
              <Link href="/profissional/pedidos" className="btn btn-primary btn-sm">
                Ver pedidos da região
              </Link>
            }
          />
        </div>
      ) : null}
      <div className="aceitos-lista">
        {itens.map((a) => {
          const st = STATUS_PEDIDO[a.requestStatus];
          // A API so mostra os detalhes enquanto o pedido esta publicado.
          const detalhes = a.requestStatus === 'publicado' ? `/profissional/pedidos/${a.requestId}` : null;
          return (
            <div key={a.acceptanceId} className="glass-card aceito">
              <span className="avatar-letra" aria-hidden="true">
                {iniciais(a.otherName)}
              </span>
              <div className="aceito-corpo">
                <div className="aceito-titulo">
                  {detalhes ? (
                    <Link href={detalhes} className="item-titulo">
                      {a.serviceName}
                    </Link>
                  ) : (
                    <span className="item-titulo">{a.serviceName}</span>
                  )}
                  <span className={`selo selo-sm ${a.state !== 'ativa' ? 'selo-neutro' : (st?.classe ?? 'selo-neutro')}`}>
                    {a.state !== 'ativa' && aberto({ ...a, state: 'ativa' }) ? 'Aceite retirado' : (st?.rotulo ?? a.requestStatus)}
                  </span>
                </div>
                <div className="campo-dica">{a.otherName}</div>
              </div>
              {detalhes || aberto(a) ? (
                <div className="aceito-acoes">
                  {aberto(a) ? <BotaoWhatsApp pedidoId={a.requestId} servico={a.serviceName} compacto /> : null}
                  {detalhes ? (
                    <Link href={detalhes} className="btn btn-secondary btn-sm">
                      Detalhes
                    </Link>
                  ) : null}
                  {aberto(a) ? (
                    <button type="button" className="btn-link aceito-retirar" disabled={executando} onClick={() => setRetirada(a)}>
                      Retirar aceite
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <Confirmacao
        aberto={retirada !== null}
        titulo="Retirar seu aceite?"
        texto="O cliente deixa de contar com você para este pedido. Sua vaga continua contando."
        rotuloConfirmar="Retirar aceite"
        ocupado={executando}
        onConfirmar={() => retirada && void retirar(retirada)}
        onFechar={() => setRetirada(null)}
      />
    </>
  );
}
