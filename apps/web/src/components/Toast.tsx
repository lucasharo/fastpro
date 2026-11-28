'use client';
// Retorno de uma acao (sucesso ou erro) em toast, no canto da tela. Cada novo objeto `aviso` abre o toast de novo;
// sucesso some em 4 s e erro em 8 s, ou no botao de fechar. O recipiente (#toasts) fica no layout e empilha.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from './Icone';
import { Aviso, type TipoAviso } from './ui';

export function Toast({ aviso }: { readonly aviso: { readonly tipo: TipoAviso; readonly texto: string } | null }) {
  const [fechado, setFechado] = useState<object | null>(null);

  useEffect(() => {
    if (aviso === null) return;
    const t = setTimeout(() => setFechado(aviso), aviso.tipo === 'erro' ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const alvo = typeof document === 'undefined' ? null : document.getElementById('toasts');
  if (aviso === null || aviso === fechado || alvo === null) return null;
  return createPortal(
    <div className="toast">
      <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
      <button type="button" className="toast-fechar" aria-label="Fechar aviso" onClick={() => setFechado(aviso)}>
        <Icone nome="fechar" tamanho={16} />
      </button>
    </div>,
    alvo,
  );
}
