// Issue 56 (H-043) | View-model da tela do perfil publico (docs/factory/143-DESENHO-H043.md, §6.1 e §6.2).
// Lógica pura: a apresentacao so recebe o resultado. Nenhuma frase fora de PUBLIC_PROFILE_TEXTS.
import { PUBLIC_PROFILE_TEXTS } from './texts.js';
import type { PublicProfileGroup } from './fields.js';

/** Forma minima da reputacao aceita pela tela (a API atual devolve count 0; a E10 podera devolver notas). */
export interface PublicProfileReputacao {
  readonly average: number | null;
  readonly count: number;
}

export interface PublicProfileView {
  readonly publicName: string;
  readonly services: readonly PublicProfileGroup[];
  readonly rating: PublicProfileReputacao;
}

export type EntradaTelaPerfil =
  | { readonly tipo: 'carregando' }
  | { readonly tipo: 'nao_encontrado' }
  | { readonly tipo: 'erro' }
  | { readonly tipo: 'perfil'; readonly perfil: PublicProfileView };

export type TipoTelaPerfil = 'carregando' | 'perfil' | 'perfil_sem_servicos' | 'nao_encontrado' | 'erro';

export interface TelaPerfil {
  readonly tipo: TipoTelaPerfil;
  readonly titulo?: string;
  readonly selo?: { readonly rotulo: string; readonly limitacao: string; readonly rotuloLimites: string };
  readonly servicos?: readonly PublicProfileGroup[];
  readonly reputacao?: { readonly rotulo: string };
  /** Rotulos fixos das secoes e das modalidades: a apresentacao nao tem frase propria (dec. 586). */
  readonly textos?: {
    readonly tituloServicos: string;
    readonly tituloReputacao: string;
    readonly modalidades: { readonly presencial: string; readonly online: string };
  };
  readonly aviso?: string;
}

/** Rotulo da reputacao: sem notas, texto fixo; com notas, media com 1 casa decimal e numero de avaliacoes. */
export function rotuloReputacao(r: PublicProfileReputacao): string {
  if (r.count === 0 || r.average === null) return PUBLIC_PROFILE_TEXTS.reputacaoSemAvaliacoes;
  const media = r.average.toFixed(1).replace('.', ',');
  return `Média ${media} · ${r.count} ${r.count === 1 ? 'avaliação' : 'avaliações'}`;
}

export function construirTelaPerfil(entrada: EntradaTelaPerfil): TelaPerfil {
  switch (entrada.tipo) {
    case 'carregando':
      return { tipo: 'carregando', aviso: PUBLIC_PROFILE_TEXTS.carregando };
    case 'nao_encontrado':
      return { tipo: 'nao_encontrado', aviso: PUBLIC_PROFILE_TEXTS.naoEncontrado };
    case 'erro':
      return { tipo: 'erro', aviso: PUBLIC_PROFILE_TEXTS.erro };
    case 'perfil': {
      const { perfil } = entrada;
      const base = {
        titulo: perfil.publicName,
        selo: {
          rotulo: PUBLIC_PROFILE_TEXTS.rotuloSelo,
          limitacao: PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo,
          rotuloLimites: PUBLIC_PROFILE_TEXTS.rotuloLimitesSelo,
        },
        reputacao: { rotulo: rotuloReputacao(perfil.rating) },
        textos: {
          tituloServicos: PUBLIC_PROFILE_TEXTS.tituloServicos,
          tituloReputacao: PUBLIC_PROFILE_TEXTS.tituloReputacao,
          modalidades: {
            presencial: PUBLIC_PROFILE_TEXTS.modalidadePresencial,
            online: PUBLIC_PROFILE_TEXTS.modalidadeOnline,
          },
        },
      };
      if (perfil.services.length === 0) {
        return { tipo: 'perfil_sem_servicos', ...base, servicos: [], aviso: PUBLIC_PROFILE_TEXTS.servicosVazios };
      }
      return { tipo: 'perfil', ...base, servicos: perfil.services };
    }
  }
}
