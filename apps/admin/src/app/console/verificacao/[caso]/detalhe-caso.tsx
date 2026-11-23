// Issue 52 (H-039) | Tela de detalhe do caso (124 §5.4). So dados nao sensiveis. O documento nunca aparece como URL:
// o botao envia um formulario para a rota de leitura, que devolve o arquivo como download.
import { AvisoErro } from '../../../../components/AvisoErro';
import { CabecaPagina } from '../../../../components/CabecaPagina';
import { EstadoVazio } from '../../../../components/EstadoVazio';
import { Icone } from '../../../../components/Icone';
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
      <div>
        <a href="/console/verificacao" className="voltar">
          <Icone nome="voltar" tamanho={18} />
          Voltar para a fila
        </a>
        <AvisoErro texto={TEXTO_ERRO_CASO} />
      </div>
    );
  }
  const c = estado.caso;

  return (
    <div>
      <a href="/console/verificacao" className="voltar">
        <Icone nome="voltar" tamanho={18} />
        Voltar para a fila
      </a>
      <CabecaPagina titulo={`Caso ${c.short_id}`} />

      <div className="pilha">
        <section className="cartao-plano" aria-label="Dados do caso">
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
        </section>

        <section className="cartao-plano" aria-labelledby="verificacao-documento">
          <h2 id="verificacao-documento">Documento</h2>
          {leituraErro ? <AvisoErro texto={TEXTO_ERRO_LEITURA} /> : null}
          {c.documentoDisponivel ? (
            <form method="post" action={`/console/verificacao/${encodeURIComponent(c.id)}/documento`} className="pilha">
              <input type="hidden" name="motivo" value={motivoLeituraPadrao(c.appeal_status)} />
              <p className="verificacao-ajuda">O arquivo é baixado para o seu computador. Ele não aparece nesta página.</p>
              <div>
                <button type="submit" className="btn btn-secondary btn-sm">
                  <Icone nome="documento" tamanho={18} />
                  Abrir documento
                </button>
              </div>
            </form>
          ) : (
            <EstadoVazio texto={TEXTO_SEM_DOCUMENTO} icone="documento" />
          )}
        </section>

        <section className="cartao-plano" aria-labelledby="verificacao-decisao-titulo">
          <h2 id="verificacao-decisao-titulo">Decisão</h2>
          <FormularioDecisao caso={c.id} versao={c.version} />
        </section>
      </div>
    </div>
  );
}
