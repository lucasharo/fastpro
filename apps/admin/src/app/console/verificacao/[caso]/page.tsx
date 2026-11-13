// Issue 52 (H-039) | Pagina de detalhe do caso (124 §5.4). A API decide o acesso: negacao (404) vira notFound, igual ao
// caso inexistente. O aviso de leitura com erro vem da rota de download por ?leitura=erro.
import { notFound } from 'next/navigation';
import { chamarVerificacao } from '../verification-api';
import { estadoDoDetalhe, type EstadoDetalhe } from '../../../../verification-detail-state';
import { DetalheCaso } from './detalhe-caso';

export const dynamic = 'force-dynamic';

async function carregarCaso(caso: string): Promise<EstadoDetalhe> {
  const resposta = await chamarVerificacao(`/casos/${encodeURIComponent(caso)}`, 'GET');
  if (resposta === 'sem_acesso') return { tipo: 'sem_acesso' };
  if (resposta === 'indisponivel') return { tipo: 'erro' };
  const corpo: unknown = resposta.status === 200 ? await resposta.json().catch(() => null) : null;
  return estadoDoDetalhe(resposta.status, corpo);
}

export default async function PaginaCaso({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly caso: string }>;
  readonly searchParams: Promise<{ readonly leitura?: string }>;
}) {
  const { caso } = await params;
  const { leitura } = await searchParams;
  const estado = await carregarCaso(caso);
  if (estado.tipo === 'sem_acesso') notFound();
  return <DetalheCaso estado={estado} leituraErro={leitura === 'erro'} />;
}
