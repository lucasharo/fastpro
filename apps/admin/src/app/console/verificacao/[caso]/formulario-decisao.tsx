'use client';
// Issue 52 (H-039) | Formulario de decisao do caso (124 §5.4; decs. 375, 386, 387). Motivo em lista fixa, complemento
// com contador de 500 e aviso sobre dados pessoais. O envio nao usa action nativa: assim o texto digitado nao some
// quando a API recusa a decisao. Campos com rotulo ligado e aviso anunciado por leitor de tela.
import { useActionState, useId, useState, useTransition, type FormEvent } from 'react';
import { decidirCaso } from './acoes';
import {
  contadorComplemento,
  DECISOES_TELA,
  ESTADO_INICIAL_DECISAO,
  MOTIVOS_DECISAO_TELA,
  TEXTO_AVISO_COMPLEMENTO,
} from '../../../../verification-detail-state';

export interface FormularioDecisaoProps {
  readonly caso: string;
  readonly versao: number;
}

export function FormularioDecisao({ caso, versao }: FormularioDecisaoProps) {
  const prefixo = useId();
  const [estado, despachar, pendente] = useActionState(decidirCaso, ESTADO_INICIAL_DECISAO);
  const [complemento, setComplemento] = useState('');
  const [, iniciarTransicao] = useTransition();
  const contador = contadorComplemento(complemento);
  const id = (nome: string) => `${prefixo}-${nome}`;

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (contador.excedeu) return;
    const dados = new FormData(evento.currentTarget);
    iniciarTransicao(() => {
      despachar(dados);
    });
  }

  return (
    <form onSubmit={enviar} aria-label="Decisão do caso" className="verificacao-decisao">
      <input type="hidden" name="caso" value={caso} />
      <input type="hidden" name="versao" value={versao} />

      {estado.mensagem ? (
        <p role={estado.situacao === 'salvo' ? 'status' : 'alert'} className="verificacao-aviso">
          {estado.mensagem}
        </p>
      ) : null}

      <div className="verificacao-campo">
        <label htmlFor={id('decisao')}>Decisão</label>
        <select id={id('decisao')} name="decisao" defaultValue="aprovada" required>
          {DECISOES_TELA.map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="verificacao-campo">
        <label htmlFor={id('motivo')}>Motivo</label>
        <select id={id('motivo')} name="motivo" defaultValue="aprovado" required>
          {MOTIVOS_DECISAO_TELA.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="verificacao-campo">
        <label htmlFor={id('complemento')}>Complemento (opcional)</label>
        <textarea
          id={id('complemento')}
          name="complemento"
          rows={4}
          value={complemento}
          onChange={(e) => setComplemento(e.target.value)}
          aria-describedby={`${id('aviso')} ${id('contador')}`}
          aria-invalid={contador.excedeu ? true : undefined}
        />
        <p id={id('aviso')} className="verificacao-ajuda">
          {TEXTO_AVISO_COMPLEMENTO}
        </p>
        <p
          id={id('contador')}
          aria-live="polite"
          className={contador.excedeu ? 'verificacao-contador verificacao-contador-excedido' : 'verificacao-contador'}
        >
          {contador.excedeu ? `${contador.rotulo}. Encurte o texto para registrar.` : contador.rotulo}
        </p>
      </div>

      <button type="submit" className="btn btn-primary" disabled={pendente || contador.excedeu}>
        {pendente ? 'Registrando...' : 'Registrar decisão'}
      </button>
    </form>
  );
}
