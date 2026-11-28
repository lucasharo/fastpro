// Montagem da galeria do profissional: DATABASE_URL_APP_SYSTEM, SITE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY e a
// fabrica do cliente SQL. Faltando algo, nada monta (404 uniforme).
import { PgProfessionalGalleryStore, PgSessionRepository, SupabaseGalleryStorage, type SqlClient } from '@fastpro/db';
import sharp from 'sharp';
import type { GalleryRouteOptions, ImagemPreparada } from '../../gallery/gallery-route.js';

type Ambiente = Readonly<Record<string, string | undefined>>;
const LADO_MAX = 1600;

export async function prepararImagemDaGaleria(bytes: Uint8Array): Promise<ImagemPreparada | null> {
  try {
    const origem = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' });
    const { format } = await origem.metadata();
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') return null;
    const { data, info } = await origem
      .rotate()
      .resize(LADO_MAX, LADO_MAX, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

export function montarGaleria(
  env: Ambiente,
  opcoes: { readonly abrirCliente?: (connectionString: string) => SqlClient; readonly relogio?: { nowMs(): number } } = {},
): GalleryRouteOptions | undefined {
  const banco = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  const supabase = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const chave = env.SUPABASE_SECRET_KEY ?? '';
  if (!banco || !site || !supabase || !chave || opcoes.abrirCliente === undefined) return undefined;
  const cliente = opcoes.abrirCliente(banco);
  return {
    siteUrl: site,
    sessions: new PgSessionRepository(cliente),
    store: new PgProfessionalGalleryStore(cliente),
    storage: new SupabaseGalleryStorage({ baseUrl: supabase, serviceKey: chave }),
    preparar: prepararImagemDaGaleria,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
  };
}
