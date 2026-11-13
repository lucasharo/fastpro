// Issue 52 (H-039) | Tela de detalhe do caso (124 §5.4). So dados nao sensiveis. O documento nunca aparece como URL:
// o botao envia um formulario para a rota de leitura, que devolve o arquivo como download.
import { FormularioDecisao } from './formulario-decisao';
import {
  motivoLeituraPadrao,
  rotuloMotivo,
  TEXTO_ERRO_CASO,
  TEXTO_ERRO_LEITURA,
  TEXTO_SEM_DOCUMENTO,
  type EstadoDetalhe,
} from '../../../../verification-detail-state';
import { rotuloEstado, rotuloPrazo } from '../../../../verification-state';

export interface DetalheCasoProps {
  readonly estado: EstadoDetalhe;
  readonly leituraErro: boolean;
}

function formatarData(iso: string | null): string {
  if (iso === null) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function DetalheCaso({ estado, leituraErro }: DetalheCasoProps) {
  if (estado.tipo !== 'ok') {
    return (
      <main>
        <p>
          <a href="/console/verificacao">Voltar para a fila</a>
        </p>
        <p role="alert">{TEXTO_ERRO_CASO}</p>
      </main>
    );
  }
  const c = estado.caso;

  return (
    <main>
      <p>
        <a href="/console/verificacao">Voltar para a fila</a>
      </p>
      <h1>Caso {c.short_id}</h1>

      <dl className="verificacao-dados">
        <dt>Serviços</dt>
        <dd>{c.services.length > 0 ? c.services.join(', ') : 'Não informado'}</dd>
        <dt>Enviado em</dt>
        <dd>{formatarData(c.received_at)}</dd>
        <dt>Estado</dt>
        <dd>{rotuloEstado(c.status)}</dd>
        <dt>Prazo</dt>
        <dd>{rotuloPrazo(c.overdue)}</dd>
        <dt>Motivo da decisão</dt>
        <dd>{rotuloMotivo(c.motivo)}</dd>
        {c.explicacao !== null ? (
          <>
            <dt>Complemento da decisão</dt>
            <dd>{c.explicacao}</dd>
          </>
        ) : null}
      </dl>

      <section aria-labelledby="verificacao-documento">
        <h2 id="verificacao-documento">Documento</h2>
        {leituraErro ? <p role="alert">{TEXTO_ERRO_LEITURA}</p> : null}
        {c.documentoDisponivel ? (
          <form method="post" action={`/console/verificacao/${encodeURIComponent(c.id)}/documento`}>
            <input type="hidden" name="motivo" value={motivoLeituraPadrao(c.appeal_status)} />
            <button type="submit">Abrir documento</button>
            <p className="verificacao-ajuda">O arquivo é baixado para o seu computador. Ele não aparece nesta página.</p>
          </form>
        ) : (
          <p>{TEXTO_SEM_DOCUMENTO}</p>
        )}
      </section>

      <section aria-labelledby="verificacao-decisao-titulo">
        <h2 id="verificacao-decisao-titulo">Decisão</h2>
        <FormularioDecisao caso={c.id} versao={c.version} />
      </section>
    </main>
  );
}
