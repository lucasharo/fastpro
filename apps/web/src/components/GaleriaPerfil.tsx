'use client';
// Fotos da galeria no perfil publico do profissional. Sem foto, a secao nao aparece.
import { useEffect, useState } from 'react';
import { ModalFoto } from '@/components/ModalFoto';
import { chamarApi } from '@/lib/api';

export function GaleriaPerfil({ slug }: { readonly slug: string }) {
  const [fotos, setFotos] = useState<string[]>([]);
  const [aberta, setAberta] = useState<number | null>(null);
  const base = `/v1/public/professionals/${encodeURIComponent(slug)}/gallery`;

  useEffect(() => {
    let vivo = true;
    void chamarApi<{ items?: { id: string }[] }>(base).then((r) => {
      if (vivo && r.status === 200) setFotos((r.corpo?.items ?? []).map((f) => f.id));
    });
    return () => {
      vivo = false;
    };
  }, [base]);

  if (fotos.length === 0) return null;
  const url = (id: string) => `/api${base}/${id}`;

  return (
    <section className="pilha" style={{ gap: '1rem', marginBottom: '2rem' }} aria-labelledby="perfil-galeria">
      <h2 id="perfil-galeria" style={{ fontSize: '1.25rem' }}>
        Galeria <span className="texto-suave">({fotos.length})</span>
      </h2>
      <ul className="galeria-pro">
        {fotos.map((id, i) => (
          <li key={id}>
            <button type="button" className="fotos-pedido-item" onClick={() => setAberta(i)} aria-label={`Ampliar foto ${i + 1} de ${fotos.length}`}>
              <img src={url(id)} alt={`Foto ${i + 1} de um serviço do profissional`} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {aberta !== null && fotos[aberta] ? (
        <ModalFoto
          url={url(fotos[aberta])}
          titulo={`Foto ${aberta + 1} de ${fotos.length}`}
          onFechar={() => setAberta(null)}
          onAnterior={aberta > 0 ? () => setAberta(aberta - 1) : undefined}
          onProxima={aberta < fotos.length - 1 ? () => setAberta(aberta + 1) : undefined}
        />
      ) : null}
    </section>
  );
}
