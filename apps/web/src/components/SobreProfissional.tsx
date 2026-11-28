'use client';
// Foto e biografia no perfil publico (GET /v1/public/professionals/:slug/about e .../photo).
import { useEffect, useState } from 'react';
import { chamarApi } from '@/lib/api';

interface Sobre {
  bio: string | null;
  hasPhoto: boolean;
}

const base = (slug: string) => `/v1/public/professionals/${encodeURIComponent(slug)}`;

function useSobre(slug: string): Sobre | null {
  const [sobre, setSobre] = useState<Sobre | null>(null);
  useEffect(() => {
    void chamarApi<Sobre>(`${base(slug)}/about`).then((r) => setSobre(r.status === 200 ? r.corpo : null));
  }, [slug]);
  return sobre;
}

export function FotoPublica({ slug, iniciais }: { readonly slug: string; readonly iniciais: string }) {
  const sobre = useSobre(slug);
  return (
    <span className="avatar-letra avatar-grande" aria-hidden="true">
      {/* Imagem servida pela propria API. */}
      {sobre?.hasPhoto ? <img src={`/api${base(slug)}/photo`} alt="" /> : iniciais}
    </span>
  );
}

export function SobreProfissional({ slug }: { readonly slug: string }) {
  const sobre = useSobre(slug);
  if (!sobre?.bio) return null;
  return (
    <section className="glass-card" style={{ padding: '1.25rem', marginBottom: '2rem' }} aria-labelledby="perfil-sobre">
      <h2 id="perfil-sobre" style={{ fontSize: '1.25rem' }}>
        Sobre
      </h2>
      <p className="texto-suave" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
        {sobre.bio}
      </p>
    </section>
  );
}
