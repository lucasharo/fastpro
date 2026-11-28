'use client';
// Modal aberto pela URL (ex.: ?editar=<id>). Usa o <dialog> nativo em modo modal: foco preso dentro, Esc fecha e o
// resto da tela fica inerte. Fechar (Esc, botao ou clique fora) navega para `fecharHref`, que tira o parametro.
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icone } from './Icone';

export function ModalUrl({ titulo, fecharHref, children }: { readonly titulo: string; readonly fecharHref: string; readonly children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Foco no primeiro campo do formulario (o dialog focaria o botao Fechar).
    d?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus();
    return () => d?.close();
  }, []);

  const fechar = () => router.push(fecharHref, { scroll: false });

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        e.preventDefault();
        fechar();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
    >
      <div className="modal-corpo">
        <div className="modal-cabeca">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className="btn-icone" aria-label="Fechar" onClick={fechar}>
            <Icone nome="fechar" tamanho={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
