'use client';
// Escolha de arquivo sem depender de clique por script: o rotulo cerca o proprio campo de arquivo (o navegador abre a
// janela por conta propria) e a area tambem aceita arrastar e soltar.
import { useState, type ReactNode } from 'react';

export interface EscolherArquivoProps {
  readonly id?: string;
  readonly tipos: readonly string[];
  readonly aoEscolher: (arquivo: File | undefined) => void;
  /** Informado, a escolha aceita varios arquivos de uma vez e todos chegam aqui. */
  readonly aoEscolherVarios?: (arquivos: File[]) => void;
  readonly rotuloAcessivel: string;
  readonly className: string;
  readonly desabilitado?: boolean;
  readonly invalido?: boolean;
  readonly children: ReactNode;
}

export function EscolherArquivo({ id, tipos, aoEscolher, aoEscolherVarios, rotuloAcessivel, className, desabilitado, invalido, children }: EscolherArquivoProps) {
  const [sobre, setSobre] = useState(false);
  const entregar = (lista: FileList) => {
    if (aoEscolherVarios) aoEscolherVarios(Array.from(lista));
    else aoEscolher(lista[0]);
  };

  return (
    <label
      className={`escolher-arquivo ${className}${sobre ? ' escolher-arquivo-sobre' : ''}`}
      aria-invalid={invalido ? true : undefined}
      aria-disabled={desabilitado ? true : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (!desabilitado) setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      // Colar (Ctrl+V) com o campo em foco: imagem copiada ou arquivo copiado no Explorador.
      onPaste={(e) => {
        if (e.clipboardData.files.length === 0 || desabilitado) return;
        e.preventDefault();
        entregar(e.clipboardData.files);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        if (!desabilitado) entregar(e.dataTransfer.files);
      }}
    >
      {children}
      <input
        id={id}
        type="file"
        className="sr-only"
        accept={tipos.join(',')}
        multiple={aoEscolherVarios !== undefined}
        disabled={desabilitado}
        aria-label={rotuloAcessivel}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) entregar(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}
