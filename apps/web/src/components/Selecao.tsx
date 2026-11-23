'use client';
// Selecao no padrao do app (substitui o <select> nativo, cuja lista aberta e desenhada pelo sistema e ignora as
// cores do tema). Botao com o valor atual e seta; lista em cartao com o mesmo visual das sugestoes.
// Teclado: Enter, Espaco ou seta abrem; setas movem; Enter escolhe; Esc fecha; Tab sai. Padrao ARIA de listbox.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icone } from './Icone';

export interface OpcaoSelecao {
  readonly valor: string;
  readonly rotulo: string;
}

export interface SelecaoProps {
  readonly id?: string;
  readonly valor: string;
  readonly opcoes: readonly OpcaoSelecao[];
  readonly onMudar: (valor: string) => void;
  /** Texto quando nenhum valor foi escolhido. */
  readonly placeholder?: string;
  /** 'campo' segue o estilo dos campos do formulario; 'limpo' e o campo transparente da busca da inicial. */
  readonly variante?: 'campo' | 'limpo';
  readonly invalido?: boolean;
  /** Id do rotulo visivel (aria-labelledby). */
  readonly rotuloId?: string;
}

export function Selecao({ id, valor, opcoes, onMudar, placeholder = 'Escolha', variante = 'campo', invalido, rotuloId }: SelecaoProps) {
  const idPadrao = useId();
  const idCampo = id ?? idPadrao;
  const [aberta, setAberta] = useState(false);
  const indiceAtual = opcoes.findIndex((o) => o.valor === valor);
  const [ativo, setAtivo] = useState(Math.max(indiceAtual, 0));
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberta(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberta]);

  function abrir() {
    setAtivo(Math.max(indiceAtual, 0));
    setAberta(true);
  }

  function escolher(i: number) {
    const o = opcoes[i];
    if (o) onMudar(o.valor);
    setAberta(false);
    botao.current?.focus();
  }

  function tecla(e: KeyboardEvent<HTMLButtonElement>) {
    if (!aberta) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => Math.min(a + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setAtivo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setAtivo(opcoes.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      escolher(ativo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAberta(false);
    } else if (e.key === 'Tab') {
      setAberta(false);
    }
  }

  const atual = indiceAtual >= 0 ? opcoes[indiceAtual] : undefined;

  return (
    <div ref={raiz} className={`selecao selecao-${variante}`}>
      <button
        ref={botao}
        id={idCampo}
        type="button"
        className={variante === 'campo' ? 'entrada selecao-botao' : 'selecao-botao'}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={aberta}
        aria-controls={`${idCampo}-opcoes`}
        aria-activedescendant={aberta ? `${idCampo}-op-${ativo}` : undefined}
        aria-labelledby={rotuloId ? `${rotuloId} ${idCampo}` : undefined}
        aria-invalid={invalido ? 'true' : undefined}
        onClick={() => (aberta ? setAberta(false) : abrir())}
        onKeyDown={tecla}
      >
        <span className={atual ? undefined : 'selecao-placeholder'}>{atual?.rotulo ?? placeholder}</span>
        <Icone nome="seta" tamanho={16} className={`selecao-seta${aberta ? ' selecao-seta-aberta' : ''}`} />
      </button>
      {aberta ? (
        <ul id={`${idCampo}-opcoes`} role="listbox" className="lista-sugestoes selecao-lista" aria-labelledby={rotuloId}>
          {opcoes.map((o, i) => (
            <li
              key={o.valor}
              id={`${idCampo}-op-${i}`}
              role="option"
              aria-selected={o.valor === valor}
              className={`selecao-opcao${i === ativo ? ' selecao-opcao-ativa' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(i)}
            >
              <span>{o.rotulo}</span>
              {o.valor === valor ? <Icone nome="check" tamanho={16} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
