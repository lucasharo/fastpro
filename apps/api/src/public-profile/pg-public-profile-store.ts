// Issue 56 (H-043) | Adaptador do perfil publico no banco (docs/factory/143-DESENHO-H043.md, §7).
// Chama private.professional_public_profile pelo papel app_system. Null vira "nao encontrado". Nenhum corpo e registrado.
// O cliente SQL chega por parametro (decidido na borda); este modulo nao abre conexao nem le variavel de ambiente.
import type { LinhaPerfilPublico, PublicProfilePort } from '@fastpro/domain';

export const SQL_LER_PERFIL_PUBLICO = 'select private.professional_public_profile($1) as perfil';

export interface PublicProfileSqlClient {
  query(text: string, params: unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export class PgPublicProfileStore implements PublicProfilePort {
  constructor(private readonly client: PublicProfileSqlClient) {}

  async lerPorSlug(slug: string): Promise<LinhaPerfilPublico | null> {
    const r = await this.client.query(SQL_LER_PERFIL_PUBLICO, [slug]);
    const perfil = r.rows[0]?.perfil;
    if (perfil === null || perfil === undefined) return null;
    if (typeof perfil !== 'object' || Array.isArray(perfil)) {
      // Forma inesperada do banco: falha interna, sem detalhe (a rota responde 500 generico).
      throw new Error('public_profile_forma_inesperada');
    }
    return perfil as LinhaPerfilPublico;
  }
}
