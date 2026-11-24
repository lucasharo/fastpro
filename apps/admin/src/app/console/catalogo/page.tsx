// Catalogo em abas (decisao do dono, 2026-11-24): uma aba por vez (Grupos, Servicos ou Sinonimos), em tabela com
// filtros e paginas de 50 itens paginadas no banco (private.catalog_admin_page). Tudo vem da URL (aba, q, situacao,
// grupo, servico, pagina, editar, novo), entao a tela e renderizada no servidor e os links podem ser compartilhados.
// A API decide o acesso: sem catalog.manage a resposta e 404 e a tela responde como inexistente (notFound).
// Edicao e criacao continuam pelo FormularioItem (H-107), que grava pela rota /v1/admin/catalog.
import Form from 'next/form';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';
import { ModalUrl } from '../../../components/ModalUrl';
import {
  rotuloModalidade,
  rotuloSituacao,
  TEXTO_ERRO_CARREGAR,
  type CatalogoGrupo,
  type CatalogoServico,
  type CatalogoSinonimo,
} from '../../../catalog-state';
import { Icone, type NomeIcone } from '../../../components/Icone';
import { FormularioItem, type EntidadeCatalogo } from './formulario-item';

export const dynamic = 'force-dynamic';

type Aba = 'grupos' | 'servicos' | 'sinonimos';
type Parametros = Record<string, string | string[] | undefined>;

interface Opcao {
  readonly id: string;
  readonly name: string;
  readonly group_id?: string;
  readonly active: boolean;
}
interface Opcoes {
  readonly groups: readonly Opcao[];
  readonly services: readonly Opcao[];
}
type LinhaGrupo = CatalogoGrupo & { readonly services: number };
type LinhaServico = CatalogoServico & { readonly group_name: string; readonly synonyms: number };
type LinhaSinonimo = CatalogoSinonimo & { readonly service_name: string; readonly group_name: string };
interface Pagina {
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
  readonly items: readonly (LinhaGrupo | LinhaServico | LinhaSinonimo)[];
}

const ABAS: readonly { readonly valor: Aba; readonly rotulo: string; readonly novo: string; readonly entidade: EntidadeCatalogo; readonly icone: NomeIcone }[] = [
  { valor: 'grupos', rotulo: 'Grupos', novo: 'Novo grupo', entidade: 'group', icone: 'painel' },
  { valor: 'servicos', rotulo: 'Serviços', novo: 'Novo serviço', entidade: 'service', icone: 'ferramenta' },
  { valor: 'sinonimos', rotulo: 'Sinônimos', novo: 'Novo sinônimo', entidade: 'synonym', icone: 'busca' },
];

const CAMINHO = '/console/catalogo';
const um = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');

async function chamar<T>(caminho: string): Promise<{ readonly status: number; readonly corpo: T | null }> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return { status: 404, corpo: null };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 0, corpo: null };
  try {
    const r = await fetch(`${base}${caminho}`, { headers: { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` }, cache: 'no-store' });
    return { status: r.status, corpo: r.status === 200 ? ((await r.json()) as T) : null };
  } catch {
    return { status: 0, corpo: null };
  }
}

export default async function PaginaCatalogo({ searchParams }: { readonly searchParams: Promise<Parametros> }) {
  const sp = await searchParams;
  const aba: Aba = um(sp.aba) === 'servicos' ? 'servicos' : um(sp.aba) === 'sinonimos' ? 'sinonimos' : 'grupos';
  const filtros = {
    q: um(sp.q).slice(0, 80),
    situacao: ['ativos', 'inativos'].includes(um(sp.situacao)) ? um(sp.situacao) : '',
    grupo: aba === 'grupos' ? '' : um(sp.grupo),
    servico: aba === 'sinonimos' ? um(sp.servico) : '',
  };
  const pagina = Math.max(1, Number.parseInt(um(sp.pagina), 10) || 1);
  const editar = um(sp.editar);
  const novo = um(sp.novo) === '1';

  // Monta a URL da tela preservando a aba e os filtros; `mudar` troca ou remove (valor vazio) parametros.
  const url = (mudar: Record<string, string | number> = {}): string => {
    const p = new URLSearchParams();
    const base: Record<string, string | number> = { aba, ...filtros, pagina, ...mudar };
    for (const [k, v] of Object.entries(base)) {
      if (v === '' || (k === 'pagina' && v === 1) || (k === 'aba' && v === 'grupos')) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `${CAMINHO}?${s}` : CAMINHO;
  };

  // O formulario de filtros envia tambem os campos vazios: volta para a URL limpa (so os filtros usados).
  if (Object.values(sp).some((v) => v === '')) redirect(url());

  const consulta = new URLSearchParams({ aba, pagina: String(pagina) });
  for (const [k, v] of Object.entries(filtros)) if (v) consulta.set(k, v);
  const [lista, opcoes] = await Promise.all([
    chamar<Pagina>(`/v1/admin/listas/catalogo?${consulta.toString()}`),
    chamar<Opcoes>('/v1/admin/listas/catalogo-opcoes'),
  ]);
  if (lista.status === 404 || opcoes.status === 404) notFound();
  const abaAtual = ABAS.find((a) => a.valor === aba) ?? ABAS[0]!;

  if (lista.corpo === null || opcoes.corpo === null) {
    return (
      <div className="pilha">
        <CabecaPagina titulo="Catálogo" />
        <AvisoErro texto={TEXTO_ERRO_CARREGAR} />
      </div>
    );
  }

  const { total, items, porPagina } = lista.corpo;
  const grupos = opcoes.corpo.groups;
  const servicos = opcoes.corpo.services;
  const servicosDoFiltro = filtros.grupo ? servicos.filter((s) => s.group_id === filtros.grupo) : servicos;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(total, pagina * porPagina);
  const itemEditado = editar ? items.find((i) => i.id === editar) : undefined;
  // Rotulo acessivel do item (formulario e link Editar) e titulo curto do modal.
  const tituloDe = (item: LinhaGrupo | LinhaServico | LinhaSinonimo): string =>
    aba === 'grupos'
      ? `Grupo ${(item as LinhaGrupo).name}, ${rotuloSituacao(item.active)}`
      : aba === 'servicos'
        ? `Serviço ${(item as LinhaServico).name}, ${rotuloModalidade((item as LinhaServico).modality)}, ${rotuloSituacao(item.active)}`
        : `Sinônimo ${(item as LinhaSinonimo).term} do serviço ${(item as LinhaSinonimo).service_name}, ${rotuloSituacao(item.active)}`;
  const tituloModal = (item: LinhaGrupo | LinhaServico | LinhaSinonimo): string =>
    aba === 'grupos'
      ? `Editar grupo: ${(item as LinhaGrupo).name}`
      : aba === 'servicos'
        ? `Editar serviço: ${(item as LinhaServico).name}`
        : `Editar sinônimo: ${(item as LinhaSinonimo).term} (${(item as LinhaSinonimo).service_name})`;

  return (
    <div className="pilha">
      <CabecaPagina titulo="Catálogo" descricao="Grupos, serviços e sinônimos usados na busca. 50 itens por página." />

      <nav className="abas" aria-label="Partes do catálogo">
        {ABAS.map((a) => (
          <Link
            key={a.valor}
            href={a.valor === 'grupos' ? '/console/catalogo' : `/console/catalogo?aba=${a.valor}`}
            className={`aba${a.valor === aba ? ' aba-ativa' : ''}`}
            aria-current={a.valor === aba ? 'page' : undefined}
          >
            <Icone nome={a.icone} tamanho={16} aria-hidden="true" />
            <span>{a.rotulo}</span>
          </Link>
        ))}
      </nav>

      <Form action={CAMINHO} scroll={false} className="catalogo-filtros cartao-plano">
        {aba !== 'grupos' ? <input type="hidden" name="aba" value={aba} /> : null}
        <div className="catalogo-campo">
          <label htmlFor="filtro-q">{aba === 'sinonimos' ? 'Termo' : 'Nome'}</label>
          <input id="filtro-q" name="q" type="search" defaultValue={filtros.q} placeholder="Buscar" maxLength={80} />
        </div>
        <div className="catalogo-campo">
          <label htmlFor="filtro-situacao">Situação</label>
          <select id="filtro-situacao" name="situacao" defaultValue={filtros.situacao}>
            <option value="">Todos</option>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
          </select>
        </div>
        {aba !== 'grupos' ? (
          <div className="catalogo-campo">
            <label htmlFor="filtro-grupo">Grupo</label>
            <select id="filtro-grupo" name="grupo" defaultValue={filtros.grupo}>
              <option value="">Todos os grupos</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {aba === 'sinonimos' ? (
          <div className="catalogo-campo">
            <label htmlFor="filtro-servico">Serviço</label>
            <select id="filtro-servico" name="servico" defaultValue={filtros.servico}>
              <option value="">Todos os serviços</option>
              {servicosDoFiltro.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="catalogo-filtros-acoes">
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          <Link href={aba === 'grupos' ? '/console/catalogo' : `/console/catalogo?aba=${aba}`} className="btn-link">
            Limpar
          </Link>
        </div>
      </Form>

      <div className="linha-entre">
        <p className="texto-suave" role="status">
          {total === 0 ? 'Nenhum item encontrado.' : `Mostrando ${inicio} a ${fim} de ${total}`}
        </p>
        <Link href={url({ novo: '1', editar: '' })} className="btn btn-primary btn-sm" scroll={false}>
          {abaAtual.novo}
        </Link>
      </div>

      {novo ? (
        <ModalUrl titulo={abaAtual.novo} fecharHref={url({ novo: '' })}>
          <FormularioItem entidade={abaAtual.entidade} grupos={grupos} servicos={servicos} titulo={abaAtual.novo} />
        </ModalUrl>
      ) : null}
      {itemEditado ? (
        <ModalUrl key={itemEditado.id} titulo={tituloModal(itemEditado)} fecharHref={url({ editar: '' })}>
          <FormularioItem
            key={`${itemEditado.id}-${itemEditado.version}`}
            entidade={abaAtual.entidade}
            item={itemEditado}
            grupos={grupos}
            servicos={servicos}
            titulo={tituloDe(itemEditado)}
          />
        </ModalUrl>
      ) : null}

      {items.length === 0 ? (
        <EstadoVazio texto="Nenhum item com estes filtros." />
      ) : (
        <div className="tabela-envoltorio glass-card">
          <table className="tabela">
            <thead>
              {aba === 'grupos' ? (
                <tr>
                  <th scope="col">Posição</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Serviços</th>
                  <th scope="col">Situação</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              ) : aba === 'servicos' ? (
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Grupo</th>
                  <th scope="col">Modalidade</th>
                  <th scope="col">Regulamentado</th>
                  <th scope="col">Sinônimos</th>
                  <th scope="col">Situação</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              ) : (
                <tr>
                  <th scope="col">Termo</th>
                  <th scope="col">Serviço</th>
                  <th scope="col">Grupo</th>
                  <th scope="col">Situação</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {items.map((item) => {
                const situacao = <span className={`selo ${item.active ? '' : 'selo-neutro'}`}>{item.active ? 'Ativo' : 'Inativo'}</span>;
                let celulas;
                if (aba === 'grupos') {
                  const g = item as LinhaGrupo;
                  celulas = (
                    <>
                      <td>{g.position}</td>
                      <td>{g.name}</td>
                      <td>{g.services}</td>
                      <td>{situacao}</td>
                    </>
                  );
                } else if (aba === 'servicos') {
                  const s = item as LinhaServico;
                  celulas = (
                    <>
                      <td>{s.name}</td>
                      <td>{s.group_name}</td>
                      <td>{rotuloModalidade(s.modality)}</td>
                      <td>{s.regulated ? 'Sim' : 'Não'}</td>
                      <td>{s.synonyms}</td>
                      <td>{situacao}</td>
                    </>
                  );
                } else {
                  const y = item as LinhaSinonimo;
                  celulas = (
                    <>
                      <td>{y.term}</td>
                      <td>{y.service_name}</td>
                      <td>{y.group_name}</td>
                      <td>{situacao}</td>
                    </>
                  );
                }
                return (
                  <tr key={item.id}>
                    {celulas}
                    <td className="tabela-acao">
                      <Link href={url({ editar: item.id, novo: '' })} className="btn-link" scroll={false} aria-label={`Editar ${tituloDe(item)}`}>
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 ? (
        <nav className="paginacao" aria-label="Páginas">
          {pagina > 1 ? (
            <Link href={url({ pagina: pagina - 1, editar: '' })} className="btn btn-secondary btn-sm">
              Anterior
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              Anterior
            </span>
          )}
          <span className="texto-suave">
            Página {Math.min(pagina, paginas)} de {paginas}
          </span>
          {pagina < paginas ? (
            <Link href={url({ pagina: pagina + 1, editar: '' })} className="btn btn-secondary btn-sm">
              Próxima
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">
              Próxima
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
