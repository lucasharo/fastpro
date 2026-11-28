'use client';
// Perfil publico do profissional (/p/[slug]). Sem sessao. Dados reais: GET /v1/public/professionals/:slug (nome,
// servicos, selo) e GET .../reviews (media e avaliacoes; autor sempre "Cliente do FastPro"). Textos e regras de tela
// vem do dominio (construirTelaPerfil), nunca de frases escritas aqui.
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { construirTelaPerfil, type PublicProfileGroup, type TelaPerfil } from '@fastpro/domain';
import { CartaoAvaliacao, EstrelasNota } from '@/components/Avaliacao';
import { GaleriaPerfil } from '@/components/GaleriaPerfil';
import { FotoPublica, SobreProfissional } from '@/components/SobreProfissional';
import { Icone } from '@/components/Icone';
import { iniciais } from '@/lib/iniciais';
import { Aviso, Carregando, PaginaInterna } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import type { AvaliacaoPublicada } from '@/lib/avaliacoes';

interface PerfilApi {
  readonly publicName: string;
  readonly slug: string;
  readonly verified: boolean;
  readonly services: readonly PublicProfileGroup[];
  readonly rating: { readonly average: number | null; readonly count: number };
}

interface AvaliacoesApi {
  readonly summary: { readonly average: number | null; readonly count: number };
  readonly items: readonly AvaliacaoPublicada[];
}

const ESTADO_INICIAL: TelaPerfil = { tipo: 'carregando' };

export default function PerfilPublico() {
  const slug = useParams<{ slug: string }>()?.slug ?? '';
  const [tela, setTela] = useState<TelaPerfil>(ESTADO_INICIAL);
  const [avaliacoes, setAvaliacoes] = useState<readonly AvaliacaoPublicada[]>([]);
  const [media, setMedia] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [perfil, reviews] = await Promise.all([
        chamarApi<PerfilApi>(`/v1/public/professionals/${encodeURIComponent(slug)}`),
        chamarApi<AvaliacoesApi>(`/v1/public/professionals/${encodeURIComponent(slug)}/reviews`),
      ]);
      if (!vivo) return;
      if (perfil.status === 404) return setTela(construirTelaPerfil({ tipo: 'nao_encontrado' }));
      if (perfil.status !== 200 || !perfil.corpo) return setTela(construirTelaPerfil({ tipo: 'erro' }));
      const resumo = reviews.status === 200 && reviews.corpo ? reviews.corpo.summary : { average: null, count: 0 };
      setTela(
        construirTelaPerfil({
          tipo: 'perfil',
          perfil: { publicName: perfil.corpo.publicName, services: perfil.corpo.services, rating: resumo },
        }),
      );
      setMedia(resumo.average);
      setAvaliacoes(reviews.status === 200 && reviews.corpo ? reviews.corpo.items : []);
    })();
    return () => {
      vivo = false;
    };
  }, [slug]);

  if (tela.tipo === 'carregando') {
    return (
      <PaginaInterna largura="media">
        <Carregando texto={tela.aviso} />
      </PaginaInterna>
    );
  }
  if (tela.tipo === 'nao_encontrado' || tela.tipo === 'erro') {
    return (
      <PaginaInterna largura="media">
        <Aviso tipo={tela.tipo === 'erro' ? 'erro' : 'info'}>{tela.aviso}</Aviso>
      </PaginaInterna>
    );
  }

  const textos = tela.textos;
  const nome = tela.titulo ?? '';

  return (
    <PaginaInterna largura="media">
      <section className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem' }} aria-labelledby="perfil-nome">
        <div className="linha" style={{ gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <FotoPublica slug={slug} iniciais={iniciais(nome)} />
          <div className="pilha" style={{ gap: '0.5rem' }}>
            <h1 id="perfil-nome" style={{ marginBottom: 0 }}>
              {nome}
            </h1>
            {tela.selo ? (
              <span className="selo selo-sm">
                <Icone nome="escudo" tamanho={14} /> {tela.selo.rotulo}
              </span>
            ) : null}
          </div>
        </div>
        {tela.selo ? (
          <details style={{ marginTop: '1rem' }}>
            <summary style={{ cursor: 'pointer' }}>{tela.selo.rotuloLimites}</summary>
            <p className="texto-suave" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              {tela.selo.limitacao}
            </p>
          </details>
        ) : null}
        <div className="linha" style={{ gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {media !== null ? <EstrelasNota nota={media} tamanho={20} /> : null}
          <span className="texto-suave">{tela.reputacao?.rotulo}</span>
        </div>
      </section>

      <SobreProfissional slug={slug} />

      <section className="pilha" style={{ gap: '1rem', marginBottom: '2rem' }} aria-labelledby="perfil-servicos">
        <h2 id="perfil-servicos" style={{ fontSize: '1.25rem' }}>
          {textos?.tituloServicos ?? 'Serviços'}
        </h2>
        {tela.tipo === 'perfil_sem_servicos' ? (
          <Aviso tipo="info">{tela.aviso}</Aviso>
        ) : (
          (tela.servicos ?? []).map((grupo) => (
            <div key={grupo.groupName} className="glass-card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>{grupo.groupName}</h3>
              <ul className="pilha" style={{ gap: '0.5rem', listStyle: 'none', padding: 0, margin: 0 }}>
                {grupo.items.map((item) => (
                  <li key={item.name} className="linha" style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span>{item.name}</span>
                    <span className="texto-suave">
                      {item.modalities
                        .map((m) => (m === 'presencial' ? textos?.modalidades.presencial : textos?.modalidades.online) ?? m)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <GaleriaPerfil slug={slug} />

      <section className="pilha" style={{ gap: '1rem' }} aria-labelledby="perfil-avaliacoes">
        <h2 id="perfil-avaliacoes" style={{ fontSize: '1.25rem' }}>
          {textos?.tituloReputacao ?? 'Avaliações'}
        </h2>
        {avaliacoes.length > 0 ? (
          <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))', alignItems: 'start' }}>
            {avaliacoes.map((item, i) => (
              <CartaoAvaliacao key={`${item.publishedAt ?? 'sem-data'}-${i}`} item={item} />
            ))}
          </div>
        ) : null}
      </section>
    </PaginaInterna>
  );
}
