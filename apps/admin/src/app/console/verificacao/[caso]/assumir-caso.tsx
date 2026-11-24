'use client';
// Botao "Assumir caso" (POST .../atribuir). O banco so aceita a decisao de quem assumiu o caso.
import { useActionState } from 'react';
import { assumirCaso } from './acoes';
import { ESTADO_INICIAL_DECISAO } from '../../../../verification-detail-state';

export function AssumirCaso({ caso, versao }: { readonly caso: string; readonly versao: number }) {
  const [estado, acao, pendente] = useActionState(assumirCaso, ESTADO_INICIAL_DECISAO);
  return (
    <form action={acao} className="pilha">
      <input type="hidden" name="caso" value={caso} />
      <input type="hidden" name="versao" value={versao} />
      {estado.mensagem && estado.situacao !== 'salvo' ? (
        <p role="alert" className="verificacao-aviso">
          {estado.mensagem}
        </p>
      ) : null}
      <p className="verificacao-ajuda">Ao assumir, o caso passa a ser seu: só você abre o documento e decide.</p>
      <button type="submit" className="btn btn-primary btn-bloco" disabled={pendente}>
        {pendente ? 'Assumindo...' : 'Assumir caso'}
      </button>
    </form>
  );
}
