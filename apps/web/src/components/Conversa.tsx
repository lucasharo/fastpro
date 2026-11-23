'use client';
// Conversa de texto real (GET /v1/conversations/:id e POST .../messages). Atualiza a cada 5 s enquanto a aba esta
// visivel. Envio idempotente por client_message_id; so texto, sem anexos.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarDataHora } from '@/lib/formatos';
import { Icone } from './Icone';
import { Aviso } from './ui';

interface Mensagem {
  id: string;
  kind: 'humana' | 'sistema';
  mine: boolean;
  body: string | null;
  event: string | null;
  createdAt: string | null;
}

interface Dados {
  serviceName: string;
  otherName: string;
  papel: 'cliente' | 'profissional';
  state: string;
  messages: Mensagem[];
}

/** Texto fixo das mensagens de sistema (o banco guarda so o evento). */
function textoSistema(evento: string | null): string {
  if (evento === 'aceite') return 'Estou disponível para trabalhar.';
  if (evento === 'aceite_retirado') return 'O profissional retirou o aceite.';
  return 'Aviso do sistema.';
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function Conversa({ conversationId, subtitulo }: { readonly conversationId: string; readonly subtitulo?: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const pendente = useRef<{ chave: string; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<Dados>(`/v1/conversations/${conversationId}`);
    if (r.status === 200 && r.corpo) {
      setDados(r.corpo);
      setErro('');
    } else if (r.status === 404) setErro('Conversa não encontrada.');
    else if (r.status === 401) setErro('Sua sessão terminou. Entre de novo.');
  }, [conversationId]);

  useEffect(() => {
    setDados(null);
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar();
    }, 5000);
    return () => clearInterval(t);
  }, [carregar]);

  const total = dados?.messages.length ?? 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [total]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    if (pendente.current === null || pendente.current.texto !== t) pendente.current = { chave: crypto.randomUUID(), texto: t };
    setEnviando(true);
    setErro('');
    const r = await chamarApi(`/v1/conversations/${conversationId}/messages`, {
      body: { client_message_id: pendente.current.chave, body: t },
    });
    setEnviando(false);
    if (r.status === 201 || r.status === 200) {
      pendente.current = null;
      setTexto('');
      await carregar();
      return;
    }
    if (r.status === 0) setErro('Sem conexão. Sua mensagem não foi enviada; tente de novo.');
    else if (r.status === 409) setErro('Esta conversa está encerrada e só pode ser lida.');
    else if (r.status === 429) setErro(MENSAGEM_LIMITE);
    else setErro('Não foi possível enviar agora. Tente de novo.');
  }

  const somenteLeitura = dados !== null && dados.state !== 'ativa';

  return (
    <div className="cartao conversa">
      <div className="linha-entre" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
        <div className="linha">
          <span className="avatar-letra" aria-hidden="true">
            {iniciais(dados?.otherName ?? '')}
          </span>
          <div>
            <div className="autor-nome">{dados?.otherName ?? 'Carregando…'}</div>
            <div className="autor-local">{subtitulo ?? dados?.serviceName ?? ''}</div>
          </div>
        </div>
        {somenteLeitura ? <span className="selo selo-sm selo-neutro">Somente leitura</span> : null}
      </div>
      <div className="mensagens" aria-live="polite">
        {(dados?.messages ?? []).map((m) =>
          m.kind === 'sistema' ? (
            <div key={m.id} className="balao balao-deles" style={{ alignSelf: 'center', textAlign: 'center' }}>
              <Icone nome="check" tamanho={14} /> {textoSistema(m.event)}
              <span className="balao-hora">{formatarDataHora(m.createdAt)}</span>
            </div>
          ) : (
            <div key={m.id} className={`balao ${m.mine ? 'balao-meu' : 'balao-deles'}`} style={{ whiteSpace: 'pre-wrap' }}>
              {m.body}
              <span className="balao-hora">{formatarDataHora(m.createdAt)}</span>
            </div>
          ),
        )}
        <div ref={fim} />
      </div>
      {erro ? (
        <div style={{ padding: '0 1rem' }}>
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      ) : null}
      <form className="compositor" onSubmit={enviar}>
        <label htmlFor={`mensagem-${conversationId}`} className="sr-only">
          Mensagem
        </label>
        <input
          id={`mensagem-${conversationId}`}
          className="entrada"
          placeholder={somenteLeitura ? 'Conversa encerrada' : 'Escreva uma mensagem…'}
          value={texto}
          maxLength={4000}
          disabled={somenteLeitura}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" aria-label="Enviar mensagem" style={{ padding: '0 1.25rem' }} disabled={enviando || somenteLeitura}>
          <Icone nome="enviar" tamanho={18} />
        </button>
      </form>
    </div>
  );
}
