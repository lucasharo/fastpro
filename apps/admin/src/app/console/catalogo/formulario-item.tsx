'use client';
// H-107 (Issue 116) | Formulario de um item do catalogo (docs/factory/81-DESENHO-H107.md §5; 77-REFINO-H107.md CA-11).
// Acessivel: cada campo tem rotulo ligado (label htmlFor), erro ligado ao campo (aria-invalid e aria-describedby),
// resumo de erros com foco ao aparecer, tudo operavel so pelo teclado (botoes e campos nativos). O envio nao usa
// action nativa do formulario: assim o navegador nao limpa o que foi digitado quando a API recusa a alteracao.
import { useActionState, useEffect, useId, useRef, useTransition, type FormEvent } from 'react';
import { salvarCatalogo } from './actions';
import {
  ESTADO_INICIAL,
  MODALIDADES,
  ROTULO_CAMPO,
  type CatalogoGrupo,
  type CatalogoServico,
  type CatalogoSinonimo,
} from '../../../catalog-state';

export type EntidadeCatalogo = 'group' | 'service' | 'synonym';

export interface FormularioItemProps {
  readonly entidade: EntidadeCatalogo;
  /** Ausente = criacao. */
  readonly item?: CatalogoGrupo | CatalogoServico | CatalogoSinonimo;
  readonly grupos: readonly CatalogoGrupo[];
  readonly servicos: readonly CatalogoServico[];
  readonly titulo: string;
}

export function FormularioItem({ entidade, item, grupos, servicos, titulo }: FormularioItemProps) {
  const prefixo = useId();
  const [estado, despachar, pendente] = useActionState(salvarCatalogo, ESTADO_INICIAL);
  const [, iniciarTransicao] = useTransition();
  const resumoRef = useRef<HTMLDivElement>(null);
  const criacao = item === undefined;

  // Foco no resumo quando a API recusa (erro por campo ou conflito); o texto digitado nao e tocado.
  useEffect(() => {
    if (estado.situacao === 'erro' || estado.situacao === 'conflito') resumoRef.current?.focus();
  }, [estado]);

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const botao = (evento.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const dados = new FormData(formulario);
    if (botao?.name) dados.set(botao.name, botao.value);
    iniciarTransicao(() => {
      despachar(dados);
    });
  }

  const id = (nome: string) => `${prefixo}-${nome}`;
  const erroDe = (nome: string): string | undefined => estado.campos[nome];
  const descricaoDe = (nome: string): string | undefined => (erroDe(nome) ? id(`${nome}-erro`) : undefined);
  const camposComErro = Object.keys(estado.campos);
  const grupoOuServico = item as CatalogoGrupo | CatalogoServico | undefined;
  const sinonimo = item as CatalogoSinonimo | undefined;

  return (
    <form onSubmit={enviar} className="catalogo-item" aria-label={titulo}>
      <input type="hidden" name="entidade" value={entidade} />
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      {item ? <input type="hidden" name="expectedVersion" value={item.version} /> : null}

      {(estado.situacao === 'erro' || estado.situacao === 'conflito') && (
        <div ref={resumoRef} tabIndex={-1} role="alert" className="catalogo-resumo-erro">
          <p>{estado.mensagem}</p>
          {camposComErro.length > 0 ? (
            <ul>
              {camposComErro.map((nome) => (
                <li key={nome}>
                  <a href={`#${id(nome)}`}>{ROTULO_CAMPO[nome] ?? nome}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {estado.situacao === 'salvo' && (
        <p role="status" className="catalogo-status">
          {estado.mensagem}
        </p>
      )}
      {estado.situacao === 'sem_acesso' && <p role="alert">Sua sessão não permite esta alteração. Entre novamente.</p>}

      {(entidade === 'group' || entidade === 'service') && (
        <CampoTexto
          id={id('name')}
          nome="name"
          rotulo={entidade === 'group' ? 'Nome do grupo' : 'Nome do serviço'}
          padrao={grupoOuServico?.name ?? ''}
          erro={erroDe('name')}
          descricao={descricaoDe('name')}
          obrigatorio
        />
      )}

      {entidade === 'group' && (
        <CampoTexto
          id={id('position')}
          nome="position"
          tipo="number"
          rotulo="Posição na lista"
          padrao={item ? String((item as CatalogoGrupo).position) : ''}
          erro={erroDe('position')}
          descricao={descricaoDe('position')}
          obrigatorio
        />
      )}

      {entidade === 'service' && (
        <>
          <div className="catalogo-campo">
            <label htmlFor={id('group_id')}>Grupo</label>
            <select
              id={id('group_id')}
              name="group_id"
              defaultValue={(item as CatalogoServico | undefined)?.group_id ?? ''}
              aria-invalid={erroDe('group_id') ? true : undefined}
              aria-describedby={descricaoDe('group_id')}
              required
            >
              {criacao ? <option value="">Escolha um grupo</option> : null}
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {descricaoDe('group_id') ? <p id={descricaoDe('group_id')}>{erroDe('group_id')}</p> : null}
          </div>
          <div className="catalogo-campo">
            <label htmlFor={id('modality')}>Modalidade</label>
            <select
              id={id('modality')}
              name="modality"
              defaultValue={(item as CatalogoServico | undefined)?.modality ?? 'presencial'}
              aria-invalid={erroDe('modality') ? true : undefined}
              aria-describedby={descricaoDe('modality')}
            >
              {MODALIDADES.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>
            {descricaoDe('modality') ? <p id={descricaoDe('modality')}>{erroDe('modality')}</p> : null}
          </div>
          <CampoMarca
            id={id('regulated')}
            nome="regulated"
            rotulo="Regulamentado"
            marcado={(item as CatalogoServico | undefined)?.regulated ?? false}
            erro={erroDe('regulated')}
            descricao={descricaoDe('regulated')}
          />
        </>
      )}

      {entidade === 'synonym' && (
        <>
          <CampoTexto
            id={id('term')}
            nome="term"
            rotulo="Termo"
            padrao={sinonimo?.term ?? ''}
            erro={erroDe('term')}
            descricao={descricaoDe('term')}
            obrigatorio
          />
          {criacao ? (
            <div className="catalogo-campo">
              <label htmlFor={id('service_id')}>Serviço</label>
              <select
                id={id('service_id')}
                name="service_id"
                defaultValue=""
                aria-invalid={erroDe('service_id') ? true : undefined}
                aria-describedby={descricaoDe('service_id')}
                required
              >
                <option value="">Escolha um serviço</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {descricaoDe('service_id') ? <p id={descricaoDe('service_id')}>{erroDe('service_id')}</p> : null}
            </div>
          ) : null}
        </>
      )}

      {entidade !== 'synonym' || !criacao ? (
        <CampoMarca
          id={id('active')}
          nome="active"
          rotulo="Ativo"
          marcado={criacao ? false : item?.active === true}
          erro={erroDe('active')}
          descricao={descricaoDe('active')}
        />
      ) : null}

      <div className="catalogo-acoes">
        {criacao ? (
          <button type="submit" name="acao" value="salvar" disabled={pendente}>
            Criar
          </button>
        ) : (
          <>
            <button type="submit" name="acao" value="salvar" disabled={pendente}>
              Salvar
            </button>
            {item?.active ? (
              <button type="submit" name="acao" value="desativar" disabled={pendente}>
                Desativar
              </button>
            ) : (
              <button type="submit" name="acao" value="reativar" disabled={pendente}>
                Reativar
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}

function CampoTexto(props: {
  readonly id: string;
  readonly nome: string;
  readonly rotulo: string;
  readonly padrao: string;
  readonly erro: string | undefined;
  readonly descricao: string | undefined;
  readonly tipo?: 'text' | 'number';
  readonly obrigatorio?: boolean;
}) {
  return (
    <div className="catalogo-campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <input
        id={props.id}
        name={props.nome}
        type={props.tipo ?? 'text'}
        defaultValue={props.padrao}
        aria-invalid={props.erro ? true : undefined}
        aria-describedby={props.descricao}
        required={props.obrigatorio}
      />
      {props.descricao ? <p id={props.descricao}>{props.erro}</p> : null}
    </div>
  );
}

function CampoMarca(props: {
  readonly id: string;
  readonly nome: string;
  readonly rotulo: string;
  readonly marcado: boolean;
  readonly erro: string | undefined;
  readonly descricao: string | undefined;
}) {
  return (
    <div className="catalogo-campo">
      <label htmlFor={props.id}>
        <input
          id={props.id}
          name={props.nome}
          type="checkbox"
          defaultChecked={props.marcado}
          aria-invalid={props.erro ? true : undefined}
          aria-describedby={props.descricao}
        />{' '}
        {props.rotulo}
      </label>
      {props.descricao ? <p id={props.descricao}>{props.erro}</p> : null}
    </div>
  );
}
