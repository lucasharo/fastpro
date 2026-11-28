'use client';
// Moderacao das avaliacoes (permissao moderation.decide). Ocultar tira a avaliacao do perfil publico e da media;
// a nota nunca e editada. Toda mudanca fica na auditoria.
import { useCallback, useEffect, useState } from 'react';
import { apiAdmin, dataHora, TEXTO_FALHA, TEXTO_SEM_ACESSO } from '../../../api-admin';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';

interface Avaliacao {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  publishedAt: string | null;
  hidden: boolean;
  professionalName: string;
  serviceName: string;
}

export default function Avaliacoes() {
  const [itens, setItens] = useState<Avaliacao[] | null>(null);
  const [erro, setErro] = useState('');
  const [mudando, setMudando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro('');
    const r = await apiAdmin<{ items?: Avaliacao[] }>('/v1/admin/moderation/reviews');
    if (r.status === 200) setItens(r.corpo?.items ?? []);
    else {
      setItens([]);
      setErro(r.status === 404 ? TEXTO_SEM_ACESSO : TEXTO_FALHA);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(a: Avaliacao) {
    setMudando(a.id);
    const r = await apiAdmin(`/v1/admin/moderation/reviews/${a.id}/visibility`, { oculta: !a.hidden });
    setMudando(null);
    if (r.status !== 200) setErro(TEXTO_FALHA);
    await carregar();
  }

  return (
    <div className="pilha">
      <CabecaPagina sobretitulo="Moderação" titulo="Avaliações" descricao="As mais recentes primeiro. Ocultar tira a avaliação do perfil público e da média." />
      {erro ? <AvisoErro texto={erro} /> : null}
      {itens === null ? <p className="texto-suave">Carregando…</p> : null}
      {itens !== null && itens.length === 0 && !erro ? <EstadoVazio texto="Nenhuma avaliação publicada ainda." icone="estrela" /> : null}
      {(itens ?? []).map((a) => (
        <div key={a.id} className="item-lista glass-card" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="linha-entre">
              <strong>
                {'★'.repeat(a.rating)}
                <span className="texto-suave">{'★'.repeat(5 - a.rating)}</span> · {a.professionalName}
              </strong>
              <span className={`selo ${a.hidden ? 'selo-neutro' : ''}`}>{a.hidden ? 'Oculta' : 'Publicada'}</span>
            </div>
            <p className="texto-suave" style={{ margin: '0.25rem 0' }}>
              {a.serviceName} · {dataHora(a.publishedAt)}
            </p>
            {a.comment ? <p style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap' }}>“{a.comment}”</p> : null}
            {a.reply ? (
              <p className="texto-suave" style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap' }}>
                Resposta do profissional: {a.reply}
              </p>
            ) : null}
            <button type="button" className={`btn btn-sm ${a.hidden ? 'btn-primary' : 'btn-secondary'}`} disabled={mudando !== null} onClick={() => void alternar(a)}>
              {a.hidden ? 'Publicar de novo' : 'Ocultar'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
