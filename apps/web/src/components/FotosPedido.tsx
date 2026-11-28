'use client';
// Fotos que o cliente enviou na solicitacao do servico (H-056). A API lista as fotos do pedido e, para cada uma, emite
// um link de 60 s (GET .../photos/:id/view) que entrega a imagem com marca d'agua. Dono: /v1/requests/:id/photos;
// profissional elegivel: /v1/professional/requests/:id/photos. Sem foto, a secao nao aparece.
import { useCallback, useEffect, useState } from 'react';
import { chamarApi } from '@/lib/api';
import { ModalFoto } from './ModalFoto';

interface FotoLista {
  readonly id: string;
  readonly sortOrder: number;
}

interface FotoCarregada {
  readonly id: string;
  readonly url: string;
}

export function FotosPedido({ pedidoId, papel }: { readonly pedidoId: string; readonly papel: 'dono' | 'profissional' }) {
  const base = papel === 'dono' ? `/v1/requests/${pedidoId}/photos` : `/v1/professional/requests/${pedidoId}/photos`;
  const [fotos, setFotos] = useState<FotoCarregada[] | null>(null);
  const [erro, setErro] = useState(false);
  const [aberta, setAberta] = useState<{ indice: number; url: string } | null>(null);

  // Link novo para a foto (o token vale 60 s): usado na miniatura e de novo ao ampliar.
  const link = useCallback(
    async (fotoId: string, variante: 'preview' | 'full'): Promise<string | null> => {
      const r = await chamarApi<{ view_url?: string }>(`${base}/${fotoId}/view?variant=${variante}`);
      return r.status === 200 && r.corpo?.view_url ? `/api${r.corpo.view_url}` : null;
    },
    [base],
  );

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await chamarApi<{ photos?: FotoLista[] }>(base);
      if (r.status !== 200) {
        if (vivo) setErro(r.status !== 404);
        if (vivo) setFotos([]);
        return;
      }
      const lista = [...(r.corpo?.photos ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      const carregadas: FotoCarregada[] = [];
      for (const f of lista) {
        const url = await link(f.id, 'preview');
        if (url) carregadas.push({ id: f.id, url });
      }
      if (vivo) {
        setFotos(carregadas);
        setErro(carregadas.length < lista.length);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [base, link]);

  async function ampliar(indice: number) {
    const foto = fotos?.[indice];
    if (!foto) return;
    const url = await link(foto.id, 'full');
    setAberta({ indice, url: url ?? foto.url });
  }

  if (fotos === null) {
    return (
      <section className="fotos-pedido" aria-busy="true" aria-label="Fotos do pedido">
        <h3>Fotos do pedido</h3>
        <p className="texto-suave">Carregando fotos…</p>
      </section>
    );
  }
  if (fotos.length === 0 && !erro) return null;

  return (
    <section className="fotos-pedido" aria-labelledby={`fotos-${pedidoId}`}>
      <h3 id={`fotos-${pedidoId}`}>
        Fotos do pedido <span className="texto-suave">({fotos.length})</span>
      </h3>
      {erro ? <p className="campo-erro">Não foi possível carregar todas as fotos. Recarregue a página para tentar de novo.</p> : null}
      <ul className="fotos-pedido-grade">
        {fotos.map((f, i) => (
          <li key={f.id}>
            <button type="button" className="fotos-pedido-item" onClick={() => void ampliar(i)} aria-label={`Ampliar foto ${i + 1} de ${fotos.length}`}>
              <img src={f.url} alt={`Foto ${i + 1} enviada no pedido`} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {aberta ? (
        <ModalFoto
          url={aberta.url}
          titulo={`Foto ${aberta.indice + 1} de ${fotos.length}`}
          onFechar={() => setAberta(null)}
          onAnterior={aberta.indice > 0 ? () => void ampliar(aberta.indice - 1) : undefined}
          onProxima={aberta.indice < fotos.length - 1 ? () => void ampliar(aberta.indice + 1) : undefined}
        />
      ) : null}
    </section>
  );
}
