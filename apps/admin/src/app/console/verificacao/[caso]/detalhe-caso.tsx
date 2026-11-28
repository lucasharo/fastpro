// Issue 52 (H-039) | Tela de detalhe do caso (124 §5.4). So dados nao sensiveis. O documento nunca aparece como URL:
// o botao envia um formulario para a rota de leitura, que abre o arquivo em uma nova aba.
import { AvisoErro } from '../../../../components/AvisoErro';
import { CabecaPagina } from '../../../../components/CabecaPagina';
import { EstadoVazio } from '../../../../components/EstadoVazio';
import { Icone } from '../../../../components/Icone';
import { AssumirCaso } from './assumir-caso';
import { FormularioDecisao } from './formulario-decisao';
import {
  motivoLeituraPadrao,
  rotuloMotivo,
  TEXTO_CASO_INDISPONIVEL,
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
        <a href="/console/verificacao" className="btn-link voltar">
          <Icone nome="voltar" tamanho={18} />
          Voltar para a fila
        </a>
        <AvisoErro
          texto={estado.tipo === 'sem_acesso' ? TEXTO_CASO_INDISPONIVEL : TEXTO_ERRO_CASO}
        />
      </div>
    );
  }
  const c = estado.caso;
  // Quem pode agir: o banco so aceita leitura do documento e decisao de quem assumiu o caso.
  const aberto =
    c.status === 'pendente' || c.status === 'em_revisao' || c.status === 'retida_duplicidade';
  const meu = c.assigned_to_me;
  const podeDecidir = meu && (c.status === 'em_revisao' || c.status === 'retida_duplicidade');
  // Assumivel: pendente, ou recurso pendente ainda sem responsavel (mesma regra de private.verification_case_assign).
  const assumivel =
    c.status === 'pendente' ||
    (c.status === 'em_revisao' && !meu && c.appeal_status === 'pendente');

  return (
    <div>
      <a href="/console/verificacao" className="btn-link voltar">
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
            <dt>
              {(c.status === 'pendente' || c.status === 'em_revisao') && c.motivo !== null
                ? 'Motivo da recusa anterior'
                : 'Motivo da decisão'}
            </dt>
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
          {!meu && aberto ? (
            <p className="verificacao-ajuda">Assuma o caso para abrir o documento.</p>
          ) : c.documentoDisponivel ? (
            <form
              method="post"
              action={`/console/verificacao/${encodeURIComponent(c.id)}/documento`}
              target="_blank"
              className="pilha"
            >
              <input type="hidden" name="motivo" value={motivoLeituraPadrao(c.appeal_status)} />
              <p className="verificacao-ajuda">O arquivo abre em uma nova aba.</p>
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

        {c.certificacoes.length > 0 ? (
          <section className="cartao-plano" aria-labelledby="verificacao-certificacoes">
            <h2 id="verificacao-certificacoes">Certificações</h2>
            {!meu && aberto ? (
              <p className="verificacao-ajuda">Assuma o caso para abrir as certificações.</p>
            ) : null}
            <ul className="verificacao-certificacoes">
              {c.certificacoes.map((cert) => (
                <li key={`${cert.servicoId}-${cert.posicao}`}>
                  <div>
                    <strong>
                      {cert.servico}
                      {cert.recebidoEm ? ` (arquivo ${cert.posicao + 1})` : ''}
                    </strong>
                    <p className="verificacao-ajuda">
                      {cert.recebidoEm ? `Enviada em ${formatarData(cert.recebidoEm)}` : 'Não enviada'}
                    </p>
                  </div>
                  {cert.recebidoEm && meu ? (
                    <form
                      method="post"
                      action={`/console/verificacao/${encodeURIComponent(c.id)}/documento`}
                      target="_blank"
                    >
                      <input type="hidden" name="motivo" value={motivoLeituraPadrao(c.appeal_status)} />
                      <input type="hidden" name="servico" value={cert.servicoId} />
                      <input type="hidden" name="posicao" value={cert.posicao} />
                      <button type="submit" className="btn btn-secondary btn-sm">
                        <Icone nome="documento" tamanho={18} />
                        Abrir certificação
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="cartao-plano" aria-labelledby="verificacao-decisao-titulo">
          <h2 id="verificacao-decisao-titulo">Decisão</h2>
          {assumivel ? (
            <AssumirCaso caso={c.id} versao={c.version} />
          ) : podeDecidir ? (
            <FormularioDecisao
              caso={c.id}
              versao={c.version}
              retido={c.status === 'retida_duplicidade'}
              semDocumento={!c.documentoDisponivel}
            />
          ) : aberto ? (
            <p className="verificacao-ajuda">
              Este caso está em revisão com outra pessoa da equipe.
            </p>
          ) : (
            <p className="verificacao-ajuda">
              Caso {rotuloEstado(c.status).toLowerCase()} em {formatarData(c.decididoEm)}. Motivo:{' '}
              {rotuloMotivo(c.motivo)}.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
