// Issue 52 (H-039) | Leitura do documento para download (124 §5.3). POST com o motivo fixo do botao. O identificador do
// documento e buscado no servidor e nunca volta ao navegador. Falha volta para o caso com aviso generico; a
// negacao vira 404 uniforme (igual ao caso inexistente).
import { chamarVerificacao } from '../../verification-api';
import { ehMotivoLeitura, extensaoDoDocumento } from '../../../../../verification-detail-state';

export const dynamic = 'force-dynamic';

const NAO_ENCONTRADO = (): Response => new Response(null, { status: 404 });

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly caso: string }> },
): Promise<Response> {
  const { caso } = await params;
  const voltar = (): Response =>
    Response.redirect(
      new URL(`/console/verificacao/${encodeURIComponent(caso)}?leitura=erro`, request.url),
      303,
    );

  const motivo = String((await request.formData()).get('motivo') ?? '');
  if (!ehMotivoLeitura(motivo)) return voltar();

  const base = `/casos/${encodeURIComponent(caso)}`;
  const detalhe = await chamarVerificacao(base, 'GET');
  if (detalhe === 'sem_acesso') return NAO_ENCONTRADO();
  if (detalhe === 'indisponivel' || detalhe.status !== 200)
    return detalhe === 'indisponivel' ? voltar() : NAO_ENCONTRADO();
  const corpo = (await detalhe.json().catch(() => null)) as { documento?: unknown } | null;
  const documento = corpo?.documento;
  if (typeof documento !== 'string') return voltar();

  const leitura = await chamarVerificacao(`${base}/documento/leitura`, 'POST', {
    documento,
    motivo,
  });
  if (leitura === 'sem_acesso') return NAO_ENCONTRADO();
  if (leitura === 'indisponivel') return voltar();
  if (leitura.status === 404) return NAO_ENCONTRADO();
  const tipo = leitura.headers.get('content-type') ?? '';
  const extensao = extensaoDoDocumento(tipo);
  if (leitura.status !== 200 || extensao === null) return voltar();

  return new Response(await leitura.arrayBuffer(), {
    status: 200,
    headers: {
      'content-type': tipo,
      'content-disposition': `attachment; filename="documento-identidade.${extensao}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}
