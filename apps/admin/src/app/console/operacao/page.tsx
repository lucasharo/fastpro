// H-108 (Issue 117) | Tela operacao: painel operacional minimo (docs/factory/76-DESENHO-H108.md §2 e §3).
// Renderizada no servidor a cada requisicao (sem cache). A API decide o acesso: sem a permissao ops.panel.read
// a resposta e 404 ou 403, e a tela responde como inexistente (notFound). So mostra agregados; bloco com fonte
// ausente (null) nao aparece. Cores, espacos e tipografia vem so dos tokens (globals.css).
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import { TEXTO_ERRO } from '../../../console-state';
import {
  contagemEstado,
  ESTADOS_EMAIL,
  estadoDoPainel,
  filaVazia,
  idadeTexto,
  instanteTexto,
  rotuloAlerta,
  rotuloCota,
  ROTULO_ESTADO,
  TEXTO_FILA_VAZIA,
  TEXTO_SEM_DADOS,
  type EstadoPainel,
  type PainelFotos,
  type PainelWebhooks,
} from '../../../ops-panel-state';

export const dynamic = 'force-dynamic';

async function carregarPainel(): Promise<EstadoPainel> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return { tipo: 'sem_acesso' };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { tipo: 'erro' };
  try {
    const resposta = await fetch(`${base}/v1/admin/ops/panel`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` },
      cache: 'no-store',
    });
    const corpo: unknown = resposta.status === 200 ? await resposta.json() : null;
    return estadoDoPainel(resposta.status, corpo);
  } catch {
    return { tipo: 'erro' };
  }
}

function BlocoWebhooks({ dados }: { readonly dados: PainelWebhooks }) {
  const { latencia } = dados;
  return (
    <section className="ops-bloco" aria-labelledby="ops-webhooks">
      <h2 id="ops-webhooks">Webhooks (últimas 24 horas)</h2>
      <ul className="ops-lista">
        <li>
          <span>Falhas</span> <strong>{dados.falhas}</strong>
        </li>
        <li>
          <span>Tempo de resposta</span>{' '}
          <strong>
            {latencia.media_ms === null ? TEXTO_SEM_DADOS : `média ${latencia.media_ms} ms`}
            {latencia.max_ms === null ? '' : `, máximo ${latencia.max_ms} ms`}
          </strong>{' '}
          <span>({latencia.n} eventos)</span>
        </li>
        <li>
          <span>Evento mais antigo sem processar</span>{' '}
          <strong>
            {dados.idade_pendente_s === null ? TEXTO_SEM_DADOS : `há ${idadeTexto(dados.idade_pendente_s)}`}
          </strong>
        </li>
      </ul>
    </section>
  );
}

function listaContagens(titulo: string, mapa: Readonly<Record<string, number>>) {
  const entradas = Object.entries(mapa);
  return (
    <>
      <h3>{titulo}</h3>
      {entradas.length === 0 ? (
        <p>Nenhuma ocorrência.</p>
      ) : (
        <ul className="ops-lista">
          {entradas.map(([codigo, n]) => (
            <li key={codigo}>
              <span>{codigo}</span> <strong>{n}</strong>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BlocoFotos({ dados }: { readonly dados: PainelFotos }) {
  return (
    <section className="ops-bloco" aria-labelledby="ops-fotos">
      <h2 id="ops-fotos">Fotos (últimas 24 horas)</h2>
      {listaContagens('Falhas de envio, por tipo', dados.falhas_upload_por_tipo)}
      {listaContagens('Falhas de conversão, por tipo', dados.falhas_reencode_por_tipo)}
    </section>
  );
}

export default async function PaginaOperacao() {
  const estado = await carregarPainel();
  if (estado.tipo === 'sem_acesso') notFound();
  if (estado.tipo === 'erro') {
    return (
      <main className="console">
        <h1>Painel operacional</h1>
        <p role="alert">{TEXTO_ERRO}</p>
      </main>
    );
  }

  const painel = estado.painel;
  const fila = painel.fila_email;
  const motivos = Object.keys(fila.falhas_por_codigo).length;

  return (
    <main className="console">
      <h1>Painel operacional</h1>
      <p className="ops-atualizado">Atualizado em {instanteTexto(painel.gerado_em)}</p>

      <section className="ops-bloco" aria-labelledby="ops-fila">
        <h2 id="ops-fila">Fila de e-mail</h2>
        <ul className="ops-lista">
          {ESTADOS_EMAIL.map((estadoEmail) => (
            <li key={estadoEmail}>
              <span>{ROTULO_ESTADO[estadoEmail]}</span> <strong>{contagemEstado(fila, estadoEmail)}</strong>
            </li>
          ))}
        </ul>
        {filaVazia(fila) ? <p>{TEXTO_FILA_VAZIA}</p> : null}
        {fila.idade_pendente_s !== null ? (
          <p>Pendente mais antigo: há {idadeTexto(fila.idade_pendente_s)}.</p>
        ) : null}
        {motivos > 0 ? listaContagens('Falhas por motivo', fila.falhas_por_codigo) : null}
      </section>

      <section className="ops-bloco" aria-labelledby="ops-cotas">
        <h2 id="ops-cotas">Cotas de uso</h2>
        <ul className="ops-lista">
          {painel.cotas.map((cota) => (
            <li key={`${cota.servico}:${cota.periodo}`}>
              <span>{rotuloCota(cota.servico, cota.periodo)}</span>{' '}
              {'sem_dados' in cota ? (
                <strong>{TEXTO_SEM_DADOS}</strong>
              ) : (
                <>
                  <progress value={cota.percentual} max={100} aria-label={`${cota.percentual}% usado`} />{' '}
                  <strong>{cota.percentual}%</strong>{' '}
                  <span>
                    ({cota.usado} de {cota.limite})
                  </span>
                  {rotuloAlerta(cota.alerta) !== null ? (
                    <span className="ops-alerta"> {rotuloAlerta(cota.alerta)}</span>
                  ) : null}
                  {cota.alertado_em !== null ? <span> · aviso em {instanteTexto(cota.alertado_em)}</span> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {painel.webhooks !== null ? <BlocoWebhooks dados={painel.webhooks} /> : null}
      {painel.fotos !== null ? <BlocoFotos dados={painel.fotos} /> : null}
      {painel.rls !== null ? (
        <section className="ops-bloco" aria-labelledby="ops-rls">
          <h2 id="ops-rls">Negações de acesso (últimas 24 horas)</h2>
          <p>
            Negações: <strong>{painel.rls.negacoes}</strong>
          </p>
        </section>
      ) : null}
    </main>
  );
}
