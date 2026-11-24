'use client';
// Issue 52 (H-039) | Formulario de decisao do caso (124 §5.4; decs. 375, 386, 387). A decisao e escolhida em botoes
// (Aprovar, Recusar, Reter por duplicidade) e o motivo so lista os que combinam com ela (mesma regra do dominio).
// "Outro" exige complemento. Complemento com contador de 500 e aviso sobre dados pessoais. O envio nao usa action
// nativa: assim o texto digitado nao some quando a API recusa a decisao.
import { useActionState, useId, useState, useTransition, type FormEvent } from 'react';
import { decidirCaso } from './acoes';
import {
  contadorComplemento,
  DECISOES_TELA,
  ESTADO_INICIAL_DECISAO,
  motivosDaDecisao,
  TEXTO_AVISO_COMPLEMENTO,
} from '../../../../verification-detail-state';

export interface FormularioDecisaoProps {
  readonly caso: string;
  readonly versao: number;
  /** Caso retido por duplicidade: a recusa pode usar "Duplicidade suspeita" e reter de novo nao se aplica. */
  readonly retido: boolean;
}

const CAMPO_OBRIGATORIO = 'Campo obrigatório.';

export function FormularioDecisao({ caso, versao, retido }: FormularioDecisaoProps) {
  const prefixo = useId();
  const [estado, despachar, pendente] = useActionState(decidirCaso, ESTADO_INICIAL_DECISAO);
  const [decisao, setDecisao] = useState<string>('aprovada');
  const motivos = motivosDaDecisao(decisao, retido);
  const [motivo, setMotivo] = useState<string>(motivos[0]?.valor ?? '');
  const [complemento, setComplemento] = useState('');
  const [tentou, setTentou] = useState(false);
  const [, iniciarTransicao] = useTransition();
  const contador = contadorComplemento(complemento);
  const id = (nome: string) => `${prefixo}-${nome}`;
  const faltaComplemento = motivo === 'outro' && complemento.trim() === '';
  const mostrarFalta = tentou && faltaComplemento;
  const decisoes = DECISOES_TELA.filter((d) => !(retido && d.valor === 'retida_duplicidade'));

  function escolher(valor: string) {
    setDecisao(valor);
    setMotivo(motivosDaDecisao(valor, retido)[0]?.valor ?? '');
    setTentou(false);
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setTentou(true);
    if (contador.excedeu || faltaComplemento) return;
    const dados = new FormData(evento.currentTarget);
    iniciarTransicao(() => {
      despachar(dados);
    });
  }

  if (estado.situacao === 'salvo') {
    return (
      <p role="status" className="aviso aviso-sucesso">
        {estado.mensagem}
      </p>
    );
  }

  return (
    <form onSubmit={enviar} aria-label="Decisão do caso" className="verificacao-decisao" noValidate>
      <input type="hidden" name="caso" value={caso} />
      <input type="hidden" name="versao" value={versao} />
      <input type="hidden" name="decisao" value={decisao} />
      <input type="hidden" name="motivo" value={motivo} />

      {estado.mensagem ? (
        <p role="alert" className="verificacao-aviso">
          {estado.mensagem}
        </p>
      ) : null}

      <fieldset className="verificacao-escolha">
        <legend>Decisão</legend>
        <div className="verificacao-opcoes">
          {decisoes.map((d) => (
            <button
              key={d.valor}
              type="button"
              className={`btn btn-bloco ${decisao === d.valor ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={decisao === d.valor}
              onClick={() => escolher(d.valor)}
            >
              {d.rotulo}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="verificacao-campo">
        <label htmlFor={id('motivo')}>Motivo</label>
        <select id={id('motivo')} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={motivos.length === 1}>
          {motivos.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="verificacao-campo">
        <label htmlFor={id('complemento')}>{motivo === 'outro' ? 'Complemento' : 'Complemento (opcional)'}</label>
        <textarea
          id={id('complemento')}
          name="complemento"
          rows={4}
          value={complemento}
          onChange={(e) => setComplemento(e.target.value)}
          aria-describedby={`${mostrarFalta ? `${id('erro')} ` : ''}${id('aviso')} ${id('contador')}`}
          aria-invalid={contador.excedeu || mostrarFalta ? true : undefined}
        />
        {mostrarFalta ? (
          <p id={id('erro')} className="campo-erro">
            {CAMPO_OBRIGATORIO}
          </p>
        ) : null}
        <p id={id('aviso')} className="verificacao-ajuda">
          O profissional pode ver este texto. {TEXTO_AVISO_COMPLEMENTO}
        </p>
        <p
          id={id('contador')}
          aria-live="polite"
          className={contador.excedeu ? 'verificacao-contador verificacao-contador-excedido' : 'verificacao-contador'}
        >
          {contador.excedeu ? `${contador.rotulo}. Encurte o texto para registrar.` : contador.rotulo}
        </p>
      </div>

      <button type="submit" className="btn btn-primary btn-bloco" disabled={pendente || contador.excedeu}>
        {pendente ? 'Registrando...' : 'Registrar decisão'}
      </button>
    </form>
  );
}
