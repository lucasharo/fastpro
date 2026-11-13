// Issue 52 (H-039) | Tela da fila de verificacao (124-DESENHO-H039 §5.4; decs. 384 a 387). Lista e abas.
// A API decide o acesso: sem verification.review a resposta e 404 e a tela responde como inexistente (notFound).
// Detalhe do caso, leitura do documento e formulario de decisao ficam para a proxima entrega da Issue 52.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import {
  ESCOPOS_FILA,
  escopoDaUrl,
  estadoDaFila,
  rotuloEstado,
  rotuloPrazo,
  TEXTO_ERRO_CARREGAR,
  TEXTO_LISTA_VAZIA,
  type EstadoFila,
  type EscopoFila,
} from '../../../verification-state';

export const dynamic = 'force-dynamic';

async function carregarFila(escopo: EscopoFila): Promise<EstadoFila> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return { tipo: 'sem_acesso' };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { tipo: 'erro' };
  try {
    const resposta = await fetch(`${base}/v1/admin/verificacao/casos?escopo=${escopo}&limite=20`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` },
      cache: 'no-store',
    });
    const corpo: unknown = resposta.status === 200 ? await resposta.json() : null;
    return estadoDaFila(resposta.status, corpo);
  } catch {
    return { tipo: 'erro' };
  }
}

function formatarData(iso: string | null): string {
  if (iso === null) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default async function PaginaVerificacao({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly escopo?: string }>;
}) {
  const { escopo: valor } = await searchParams;
  const escopo = escopoDaUrl(valor);
  const estado = await carregarFila(escopo);
  if (estado.tipo === 'sem_acesso') notFound();

  return (
    <main>
      <h1>Verificação de identidade</h1>
      <nav aria-label="Listas da verificação">
        <ul>
          {ESCOPOS_FILA.map((e) => (
            <li key={e.valor}>
              <a href={`?escopo=${e.valor}`} aria-current={e.valor === escopo ? 'page' : undefined}>
                {e.rotulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {estado.tipo === 'erro' ? <p role="alert">{TEXTO_ERRO_CARREGAR}</p> : null}
      {estado.tipo === 'vazia' ? <p>{TEXTO_LISTA_VAZIA}</p> : null}
      {estado.tipo === 'lista' ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Caso</th>
              <th scope="col">Serviços</th>
              <th scope="col">Enviado em</th>
              <th scope="col">Estado</th>
              <th scope="col">Prazo</th>
            </tr>
          </thead>
          <tbody>
            {estado.itens.map((item) => (
              <tr key={item.id}>
                <td>{item.short_id}</td>
                <td>{item.services.length > 0 ? item.services.join(', ') : 'Não informado'}</td>
                <td>{formatarData(item.received_at)}</td>
                <td>{rotuloEstado(item.status)}</td>
                <td>{rotuloPrazo(item.overdue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
