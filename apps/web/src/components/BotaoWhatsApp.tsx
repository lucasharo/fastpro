'use client';
// Abre a conversa no WhatsApp com o cliente do pedido aceito. O numero e pedido ao servidor so no clique (cada leitura
// fica registrada) e nao aparece na tela.
import { useState } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { linkWhatsApp } from '@/lib/whatsapp';

export function BotaoWhatsApp({
  pedidoId,
  servico,
  compacto = false,
}: {
  readonly pedidoId: string;
  readonly servico: string;
  /** Botao pequeno com o rotulo curto (linha da lista de aceitos). */
  readonly compacto?: boolean;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState('');

  async function abrir() {
    setErro('');
    setAbrindo(true);
    // A aba e aberta ja no clique para o navegador nao bloquear.
    const aba = window.open('', '_blank');
    if (aba) aba.opener = null;
    const r = await chamarApi<{ phone?: string }>(`/v1/pro/requests/${pedidoId}/phone/reveal`, { method: 'POST' });
    setAbrindo(false);
    if (r.status === 200 && r.corpo?.phone) {
      const url = linkWhatsApp(r.corpo.phone, servico);
      if (aba) aba.location.href = url;
      else window.location.href = url;
      return;
    }
    aba?.close();
    setErro(
      r.status === 429
        ? MENSAGEM_LIMITE
        : r.status === 404
          ? 'O contato não está disponível. Confira se o pedido continua aberto e se sua assinatura está ativa.'
          : MENSAGEM_INDISPONIVEL,
    );
  }

  return (
    <div className={compacto ? 'pilha aceito-whatsapp' : 'pilha'} style={{ gap: '0.5rem' }}>
      <button type="button" className={`btn btn-primary ${compacto ? 'btn-sm' : 'btn-bloco'}`} disabled={abrindo} onClick={() => void abrir()}>
        <Icone nome="conversa" tamanho={compacto ? 16 : 18} /> {abrindo ? 'Abrindo…' : compacto ? 'WhatsApp' : 'Enviar mensagem no WhatsApp'}
      </button>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
