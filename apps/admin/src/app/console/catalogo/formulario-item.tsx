'use client';
// H-107 (Issue 116) | Formulario de um item do catalogo (docs/factory/81-DESENHO-H107.md §5; 77-REFINO-H107.md CA-11).
// Acessivel: cada campo tem rotulo ligado (label htmlFor), erro ligado ao campo (aria-invalid e aria-describedby),
// resumo de erros com foco ao aparecer, tudo operavel so pelo teclado (botoes e campos nativos). O envio nao usa
// action nativa do formulario: assim o navegador nao limpa o que foi digitado quando a API recusa a alteracao.
import { useActionState, useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { AvisoErro } from '../../../components/AvisoErro';
import { Selecao } from '../../../components/Selecao';
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
export interface OpcaoCatalogo {
  readonly id: string;
  readonly name: string;
}

export interface FormularioItemProps {
  readonly entidade: EntidadeCatalogo;
  /** Ausente = criacao. */
  readonly item?: CatalogoGrupo | CatalogoServico | CatalogoSinonimo;
  /** So id e nome sao usados (campos Grupo e Servico); a tela passa as opcoes leves. */
  readonly grupos: readonly OpcaoCatalogo[];
  readonly servicos: readonly OpcaoCatalogo[];
  readonly titulo: string;
}

export function FormularioItem({ entidade, item, grupos, servicos, titulo }: FormularioItemProps) {
  const prefixo = useId();
  const [estado, despachar, pendente] = useActionState(salvarCatalogo, ESTADO_INICIAL);
  const [, iniciarTransicao] = useTransition();
  const resumoRef = useRef<HTMLDivElement>(null);
  const criacao = item === undefined;
  // Campos de selecao obrigatorios deixados em branco (o input oculto nao tem validacao nativa).
  const [faltando, setFaltando] = useState<readonly string[]>([]);

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
    const vazios = ['group_id', 'service_id'].filter((nome) => dados.get(nome) === '');
    setFaltando(vazios);
    if (vazios.length > 0) return;
    iniciarTransicao(() => {
      despachar(dados);
    });
  }

  const id = (nome: string) => `${prefixo}-${nome}`;
  const erroDe = (nome: string): string | undefined =>
    faltando.includes(nome) ? 'Campo obrigatório.' : estado.campos[nome];
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
      {estado.situacao === 'sem_acesso' && <AvisoErro texto="Sua sessão não permite esta alteração. Entre novamente." />}

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
            <Selecao
              id={id('group_id')}
              nome="group_id"
              valorInicial={(item as CatalogoServico | undefined)?.group_id ?? ''}
              invalido={Boolean(erroDe('group_id'))}
              descritoPor={descricaoDe('group_id')}
              onMudar={() => setFaltando((f) => f.filter((nome) => nome !== 'group_id'))}
              opcoes={[
                ...(criacao ? [{ valor: '', rotulo: 'Escolha um grupo' }] : []),
                ...grupos.map((g) => ({ valor: g.id, rotulo: g.name })),
              ]}
            />
            {descricaoDe('group_id') ? <p id={descricaoDe('group_id')}>{erroDe('group_id')}</p> : null}
          </div>
          <div className="catalogo-campo">
            <label htmlFor={id('modality')}>Modalidade</label>
            <Selecao
              id={id('modality')}
              nome="modality"
              valorInicial={(item as CatalogoServico | undefined)?.modality ?? 'presencial'}
              invalido={Boolean(erroDe('modality'))}
              descritoPor={descricaoDe('modality')}
              opcoes={MODALIDADES}
            />
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
              <Selecao
                id={id('service_id')}
                nome="service_id"
                valorInicial=""
                invalido={Boolean(erroDe('service_id'))}
                descritoPor={descricaoDe('service_id')}
                onMudar={() => setFaltando((f) => f.filter((nome) => nome !== 'service_id'))}
                opcoes={[
                  { valor: '', rotulo: 'Escolha um serviço' },
                  ...servicos.map((s) => ({ valor: s.id, rotulo: s.name })),
                ]}
              />
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
          <button type="submit" name="acao" value="salvar" className="btn btn-primary" disabled={pendente}>
            Criar
          </button>
        ) : (
          <>
            <button type="submit" name="acao" value="salvar" className="btn btn-primary" disabled={pendente}>
              Salvar
            </button>
            {item?.active ? (
              <button type="submit" name="acao" value="desativar" className="btn btn-secondary" disabled={pendente}>
                Desativar
              </button>
            ) : (
              <button type="submit" name="acao" value="reativar" className="btn btn-secondary" disabled={pendente}>
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
