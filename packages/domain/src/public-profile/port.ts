// Issue 56 (H-043) | Porta de leitura do perfil publico (docs/factory/143-DESENHO-H043.md, §6.1).
// O dominio depende so desta interface; o adaptador de banco fica em apps/api (pg-public-profile-store.ts).

/** Linha bruta devolvida pela funcao de leitura. Nao confiavel: passa por montarPerfilPublico antes de sair. */
export type LinhaPerfilPublico = Readonly<Record<string, unknown>>;

export interface PublicProfilePort {
  /** Devolve a linha do perfil visivel para o slug, ou null (nao visivel, inexistente ou slug invalido). */
  lerPorSlug(slug: string): Promise<LinhaPerfilPublico | null>;
}
