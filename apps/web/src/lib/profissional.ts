// Tipos e leituras da area do profissional.
import { chamarApi } from './api';

export interface ItemDescoberta {
  id: string;
  service_id?: string;
  service_name?: string;
  urgency?: string;
  description?: string;
  public_label?: string;
  distance_km?: number;
  modality?: string;
  published_at?: string;
  acceptance_deadline_at?: string;
  has_photos?: boolean;
}

export type ResultadoDescoberta =
  | { tipo: 'ok'; itens: ItemDescoberta[]; cursor: string | null }
  | { tipo: 'sessao' }
  | { tipo: 'sem_perfil' }
  | { tipo: 'erro'; texto: string };

export async function lerDescoberta(cursor?: string): Promise<ResultadoDescoberta> {
  const r = await chamarApi<{ items?: ItemDescoberta[]; next_cursor?: string | null }>(
    cursor ? `/v1/professional/discovery/requests?cursor=${encodeURIComponent(cursor)}` : '/v1/professional/discovery/requests',
  );
  if (r.status === 401) return { tipo: 'sessao' };
  if (r.status === 403) return { tipo: 'sem_perfil' };
  if (r.status !== 200) return { tipo: 'erro', texto: r.status === 429 ? 'Muitas consultas seguidas. Aguarde um instante.' : 'Não foi possível carregar os pedidos agora.' };
  return { tipo: 'ok', itens: Array.isArray(r.corpo?.items) ? r.corpo.items : [], cursor: r.corpo?.next_cursor ?? null };
}

export function distancia(km: number | undefined): string {
  if (typeof km !== 'number') return '';
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export const ROTULO_MODALIDADE: Record<string, string> = { presencial: 'Presencial', online: 'Online' };
