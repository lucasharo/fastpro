// H-107 (Issue 116) | Tela do catalogo: lista, criar, alterar e desativar grupos, servicos e sinonimos
// (docs/factory/81-DESENHO-H107.md §5; 77-REFINO-H107.md CA-03 a CA-11). Renderizada no servidor a cada requisicao.
// A API decide o acesso: sem catalog.manage (ou sem aal2) a resposta e 404 e a tela responde como inexistente
// (notFound), igual ao console. Cores, espacos e tipografia vem so dos tokens (globals.css).
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';
import {
  estadoDoCatalogo,
  rotuloModalidade,
  rotuloSituacao,
  TEXTO_ERRO_CARREGAR,
  TEXTO_LISTA_VAZIA,
  type CatalogoEstado,
  type CatalogoGrupo,
  type CatalogoServico,
  type CatalogoSinonimo,
} from '../../../catalog-state';
import { FormularioItem } from './formulario-item';

export const dynamic = 'force-dynamic';

async function carregarCatalogo(): Promise<CatalogoEstado> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return { tipo: 'sem_acesso' };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { tipo: 'erro' };
  try {
    const resposta = await fetch(`${base}/v1/admin/catalog`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` },
      cache: 'no-store',
    });
    const corpo: unknown = resposta.status === 200 ? await resposta.json() : null;
    return estadoDoCatalogo(resposta.status, corpo);
  } catch {
    return { tipo: 'erro' };
  }
}

function SecaoGrupos({ grupos, servicos }: { readonly grupos: readonly CatalogoGrupo[]; readonly servicos: readonly CatalogoServico[] }) {
  return (
    <section aria-labelledby="catalogo-grupos" className="cartao-plano pilha">
      <h2 id="catalogo-grupos">Grupos</h2>
      {grupos.length === 0 ? <EstadoVazio texto={TEXTO_LISTA_VAZIA} /> : null}
      <ul className="catalogo-lista">
        {grupos.map((g) => (
          <li key={`${g.id}-${g.version}`}>
            <FormularioItem
              entidade="group"
              item={g}
              grupos={grupos}
              servicos={servicos}
              titulo={`Grupo ${g.name}, ${rotuloSituacao(g.active)}`}
            />
          </li>
        ))}
      </ul>
      <h3>Novo grupo</h3>
      <FormularioItem entidade="group" grupos={grupos} servicos={servicos} titulo="Novo grupo" />
    </section>
  );
}

function SecaoServicos({ grupos, servicos }: { readonly grupos: readonly CatalogoGrupo[]; readonly servicos: readonly CatalogoServico[] }) {
  return (
    <section aria-labelledby="catalogo-servicos" className="cartao-plano pilha">
      <h2 id="catalogo-servicos">Serviços</h2>
      {servicos.length === 0 ? <EstadoVazio texto={TEXTO_LISTA_VAZIA} /> : null}
      <ul className="catalogo-lista">
        {servicos.map((s) => (
          <li key={`${s.id}-${s.version}`}>
            <FormularioItem
              entidade="service"
              item={s}
              grupos={grupos}
              servicos={servicos}
              titulo={`Serviço ${s.name}, ${rotuloModalidade(s.modality)}, ${rotuloSituacao(s.active)}`}
            />
          </li>
        ))}
      </ul>
      <h3>Novo serviço</h3>
      <FormularioItem entidade="service" grupos={grupos} servicos={servicos} titulo="Novo serviço" />
    </section>
  );
}

function SecaoSinonimos({
  sinonimos,
  servicos,
  grupos,
}: {
  readonly sinonimos: readonly CatalogoSinonimo[];
  readonly servicos: readonly CatalogoServico[];
  readonly grupos: readonly CatalogoGrupo[];
}) {
  const nomeDoServico = (id: string) => servicos.find((s) => s.id === id)?.name ?? 'serviço';
  return (
    <section aria-labelledby="catalogo-sinonimos" className="cartao-plano pilha">
      <h2 id="catalogo-sinonimos">Sinônimos</h2>
      {sinonimos.length === 0 ? <EstadoVazio texto={TEXTO_LISTA_VAZIA} /> : null}
      <ul className="catalogo-lista">
        {sinonimos.map((y) => (
          <li key={`${y.id}-${y.version}`}>
            <FormularioItem
              entidade="synonym"
              item={y}
              grupos={grupos}
              servicos={servicos}
              titulo={`Sinônimo ${y.term} do serviço ${nomeDoServico(y.service_id)}, ${rotuloSituacao(y.active)}`}
            />
          </li>
        ))}
      </ul>
      <h3>Novo sinônimo</h3>
      <FormularioItem entidade="synonym" grupos={grupos} servicos={servicos} titulo="Novo sinônimo" />
    </section>
  );
}

export default async function PaginaCatalogo() {
  const estado = await carregarCatalogo();
  if (estado.tipo === 'sem_acesso') notFound();
  if (estado.tipo === 'erro') {
    return (
      <div>
        <CabecaPagina titulo="Catálogo" />
        <AvisoErro texto={TEXTO_ERRO_CARREGAR} />
      </div>
    );
  }

  return (
    <div className="pilha">
      <CabecaPagina titulo="Catálogo" />
      <SecaoGrupos grupos={estado.grupos} servicos={estado.servicos} />
      <SecaoServicos grupos={estado.grupos} servicos={estado.servicos} />
      <SecaoSinonimos sinonimos={estado.sinonimos} servicos={estado.servicos} grupos={estado.grupos} />
    </div>
  );
}
