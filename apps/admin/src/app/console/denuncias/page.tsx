'use client';
// Moderacao das denuncias do chat (permissao moderation.decide). O moderador ve motivo, texto da denuncia e o
// servico; o conteudo da conversa nao aparece aqui (acesso a conversa exige caso proprio, H-073).
import { useCallback, useEffect, useState } from 'react';
import { apiAdmin, dataHora, TEXTO_FALHA, TEXTO_SEM_ACESSO } from '../../../api-admin';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';

interface Denuncia {
  id: string;
  reason: string;
  text: string | null;
  status: string;
  createdAt: string | null;
  decidedAt: string | null;
  serviceName: string;
  reporterRole: string;
}

const MOTIVO: Record<string, string> = {
  assedio: 'Assédio',
  golpe: 'Golpe ou fraude',
  ofensa: 'Ofensa',
  spam: 'Spam',
  outro: 'Outro',
};
const STATUS: Record<string, { rotulo: string; classe: string }> = {
  aberto: { rotulo: 'Aberta', classe: 'selo-alerta' },
  resolvido: { rotulo: 'Resolvida', classe: '' },
  descartado: { rotulo: 'Descartada', classe: 'selo-neutro' },
};

export default function Denuncias() {
  const [filtro, setFiltro] = useState<'aberto' | 'resolvido' | 'descartado'>('aberto');
  const [itens, setItens] = useState<Denuncia[] | null>(null);
  const [erro, setErro] = useState('');
  const [decidindo, setDecidindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro('');
    const r = await apiAdmin<{ items?: Denuncia[] }>(`/v1/admin/moderation/reports?status=${filtro}`);
    if (r.status === 200) setItens(r.corpo?.items ?? []);
    else {
      setItens([]);
      setErro(r.status === 404 ? TEXTO_SEM_ACESSO : TEXTO_FALHA);
    }
  }, [filtro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function decidir(id: string, decisao: 'resolvido' | 'descartado') {
    setDecidindo(id);
    const r = await apiAdmin(`/v1/admin/moderation/reports/${id}/decision`, { decisao });
    setDecidindo(null);
    if (r.status !== 200) setErro(r.status === 409 ? 'Esta denúncia já foi decidida.' : TEXTO_FALHA);
    await carregar();
  }

  return (
    <div className="pilha">
      <CabecaPagina sobretitulo="Moderação" titulo="Denúncias do chat" descricao="Decida cada denúncia. Toda decisão fica na auditoria." />
      <div className="linha" role="group" aria-label="Filtrar por situação">
        {(['aberto', 'resolvido', 'descartado'] as const).map((s) => (
          <button key={s} type="button" className={`btn btn-sm ${filtro === s ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={filtro === s} onClick={() => setFiltro(s)}>
            {STATUS[s]?.rotulo}s
          </button>
        ))}
      </div>
      {erro ? <AvisoErro texto={erro} /> : null}
      {itens === null ? <p className="texto-suave">Carregando…</p> : null}
      {itens !== null && itens.length === 0 && !erro ? <EstadoVazio texto="Nenhuma denúncia nesta situação." icone="escudo" /> : null}
      {(itens ?? []).map((d) => (
        <div key={d.id} className="item-lista glass-card" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="linha-entre">
              <strong>{MOTIVO[d.reason] ?? d.reason}</strong>
              <span className={`selo ${STATUS[d.status]?.classe ?? ''}`}>{STATUS[d.status]?.rotulo ?? d.status}</span>
            </div>
            <p className="texto-suave" style={{ margin: '0.25rem 0' }}>
              {d.serviceName} · denunciada por {d.reporterRole === 'cliente' ? 'cliente' : 'profissional'} em {dataHora(d.createdAt)}
            </p>
            {d.text ? <p style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap' }}>“{d.text}”</p> : null}
            {d.status === 'aberto' ? (
              <div className="linha" style={{ marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={decidindo !== null} onClick={() => void decidir(d.id, 'resolvido')}>
                  Marcar como resolvida
                </button>
                <button type="button" className="btn-link" disabled={decidindo !== null} onClick={() => void decidir(d.id, 'descartado')}>
                  Descartar
                </button>
              </div>
            ) : (
              <p className="texto-suave">Decidida em {dataHora(d.decidedAt)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
