// Edicao dos dados do profissional (2026-11-27): funcoes private.professional_account_* (papel app_system).
import type { SqlClient } from './jobs-tick.js';

export interface DadosDoProfissional {
  readonly publicName: string | null;
  readonly bio: string | null;
  readonly photoId: string | null;
  /** E-mail da propria conta (a troca de senha confirma a senha atual pelo login). */
  readonly email: string | null;
}

export type ResultadoDados = 'ok' | 'sem_perfil' | 'suspenso' | 'nome_sem_documento' | 'invalido';

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class PgProfessionalAccountEditStore {
  constructor(private readonly client: SqlClient) {}

  async ler(userId: string): Promise<DadosDoProfissional | null> {
    const r = await this.client.query('select * from private.professional_account_get($1)', [userId]);
    const l = r.rows[0];
    return l ? { publicName: texto(l.out_public_name), bio: texto(l.out_bio), photoId: texto(l.out_photo_id), email: texto(l.out_email) } : null;
  }

  async salvar(userId: string, publicName: string, bio: string, agora: Date): Promise<ResultadoDados> {
    const r = await this.client.query('select * from private.professional_account_save($1, $2, $3, $4)', [userId, publicName, bio, agora]);
    return String(r.rows[0]?.out_code) as ResultadoDados;
  }

  /** `anterior` e a foto que saiu (para apagar o arquivo). */
  async trocarFoto(userId: string, photoId: string | null, agora: Date): Promise<{ code: ResultadoDados; anterior: string | null }> {
    const r = await this.client.query('select * from private.professional_profile_photo_set($1, $2, $3)', [userId, photoId, agora]);
    return { code: String(r.rows[0]?.out_code) as ResultadoDados, anterior: texto(r.rows[0]?.out_previous) };
  }

  async publico(slug: string): Promise<{ readonly bio: string | null; readonly photoId: string | null } | null> {
    const r = await this.client.query('select * from private.professional_about_public($1)', [slug]);
    const l = r.rows[0];
    return l ? { bio: texto(l.out_bio), photoId: texto(l.out_photo_id) } : null;
  }
}
