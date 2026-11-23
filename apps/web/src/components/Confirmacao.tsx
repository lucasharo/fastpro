'use client';
// Pacote A | Confirmacao de acao que muda o pedido (concluir, desfazer, cancelar, retirar aceite). Usa o <dialog>
// nativo: foco preso, Esc fecha e o botao de cancelar recebe o foco ao abrir (acao irreversivel).
import { useEffect, useId, useRef } from 'react';
import { Icone } from './Icone';

export interface ConfirmacaoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly texto: string;
  readonly rotuloConfirmar: string;
  readonly rotuloCancelar?: string;
  readonly ocupado?: boolean;
  readonly onConfirmar: () => void;
  readonly onFechar: () => void;
}

export function Confirmacao({
  aberto,
  titulo,
  texto,
  rotuloConfirmar,
  rotuloCancelar = 'Voltar',
  ocupado = false,
  onConfirmar,
  onFechar,
}: ConfirmacaoProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idTexto = useId();

  useEffect(() => {
    const dialogo = ref.current;
    if (dialogo === null) return;
    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className="pacote-a-dialogo"
      aria-labelledby={idTitulo}
      aria-describedby={idTexto}
      onClose={onFechar}
    >
      <div className="pacote-a-dialogo-corpo">
        <h2 id={idTitulo} className="pacote-a-dialogo-titulo">
          <Icone nome="alerta" tamanho={20} /> {titulo}
        </h2>
        <p id={idTexto} className="pacote-a-dialogo-texto">
          {texto}
        </p>
        <div className="pacote-a-acoes">
          <button type="button" className="btn btn-secondary btn-sm" autoFocus disabled={ocupado} onClick={onFechar}>
            {rotuloCancelar}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={ocupado} onClick={onConfirmar}>
            {ocupado ? 'Aguarde…' : rotuloConfirmar}
          </button>
        </div>
      </div>
    </dialog>
  );
}
