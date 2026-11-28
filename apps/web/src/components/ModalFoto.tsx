'use client';
// Foto ampliada em <dialog> nativo (foco preso, Esc fecha, clique fora fecha), com anterior e proxima.
import { useEffect, useRef } from 'react';
import { Icone } from './Icone';

export function ModalFoto({
  url,
  titulo,
  onFechar,
  onAnterior,
  onProxima,
}: {
  readonly url: string;
  readonly titulo: string;
  readonly onFechar: () => void;
  readonly onAnterior?: () => void;
  readonly onProxima?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onAnterior) onAnterior();
      if (e.key === 'ArrowRight' && onProxima) onProxima();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onAnterior, onProxima]);

  return (
    <dialog
      ref={ref}
      className="modal-foto"
      aria-label={titulo}
      onCancel={(e) => {
        e.preventDefault();
        onFechar();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="modal-foto-topo">
        <span>{titulo}</span>
        <button type="button" className="nav-menu-botao" aria-label="Fechar" onClick={onFechar}>
          <Icone nome="fechar" tamanho={22} />
        </button>
      </div>
      <img src={url} alt={titulo} className="modal-foto-imagem" />
      <div className="modal-foto-nav">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAnterior} disabled={!onAnterior}>
          <Icone nome="voltar" tamanho={16} /> Anterior
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onProxima} disabled={!onProxima}>
          Próxima <Icone nome="seta" tamanho={16} />
        </button>
      </div>
    </dialog>
  );
}
