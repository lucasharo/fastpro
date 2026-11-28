'use client';
// Selecao no visual do Select do DriveMais (pedido do dono, 2026-11-27), com os tokens do FastPro. Substitui o
// <select> nativo, cuja lista aberta e desenhada pelo sistema. O valor vai no formulario por um input oculto (nome).
// Teclado: Enter, Espaco ou seta abrem; setas movem; letra salta para a opcao; Enter escolhe; Esc fecha; Tab sai.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icone } from './Icone';

export interface OpcaoSelecao {
  readonly valor: string;
  readonly rotulo: string;
}

export interface SelecaoProps {
  readonly id?: string;
  readonly opcoes: readonly OpcaoSelecao[];
  /** Valor controlado pela tela. Sem ele, a selecao guarda o proprio valor, a partir de `valorInicial`. */
  readonly valor?: string;
  readonly valorInicial?: string;
  readonly onMudar?: (valor: string) => void;
  /** Nome do campo enviado no formulario. */
  readonly nome?: string;
  readonly desabilitado?: boolean;
  readonly invalido?: boolean;
  readonly descritoPor?: string;
}

const semAcento = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function Selecao({
  id,
  opcoes,
  valor,
  valorInicial,
  onMudar,
  nome,
  desabilitado,
  invalido,
  descritoPor,
}: SelecaoProps) {
  const idPadrao = useId();
  const idCampo = id ?? idPadrao;
  const [interno, setInterno] = useState(valorInicial ?? opcoes[0]?.valor ?? '');
  const escolhido = valor ?? interno;
  const indiceAtual = opcoes.findIndex((o) => o.valor === escolhido);
  const [aberta, setAberta] = useState(false);
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

  // Mantem a opcao ativa visivel nas listas longas.
  useEffect(() => {
    if (!aberta) return;
    document.getElementById(`${idCampo}-op-${ativo}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [aberta, ativo, idCampo]);

  function abrir() {
    setAtivo(Math.max(indiceAtual, 0));
    setAberta(true);
  }

  function escolher(i: number) {
    const o = opcoes[i];
    if (o) {
      setInterno(o.valor);
      onMudar?.(o.valor);
    }
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
    } else if (e.key.length === 1) {
      const letra = semAcento(e.key);
      const ordem = [...opcoes.keys()].map((i) => (ativo + 1 + i) % opcoes.length);
      const achou = ordem.find((i) => semAcento(opcoes[i]?.rotulo ?? '').startsWith(letra));
      if (achou !== undefined) setAtivo(achou);
    }
  }

  const atual = opcoes[indiceAtual];

  return (
    <div ref={raiz} className="selecao">
      <button
        ref={botao}
        id={idCampo}
        type="button"
        className="selecao-botao"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={aberta}
        aria-controls={`${idCampo}-opcoes`}
        aria-activedescendant={aberta ? `${idCampo}-op-${ativo}` : undefined}
        aria-invalid={invalido ? 'true' : undefined}
        aria-describedby={descritoPor}
        disabled={desabilitado}
        onClick={() => (aberta ? setAberta(false) : abrir())}
        onKeyDown={tecla}
      >
        <span>{atual?.rotulo ?? 'Escolha'}</span>
        <Icone
          nome="seta"
          tamanho={16}
          className={`selecao-seta${aberta ? ' selecao-seta-aberta' : ''}`}
        />
      </button>
      {aberta ? (
        <ul id={`${idCampo}-opcoes`} role="listbox" className="selecao-lista">
          {opcoes.map((o, i) => (
            <li
              key={o.valor}
              id={`${idCampo}-op-${i}`}
              role="option"
              data-valor={o.valor}
              aria-selected={o.valor === escolhido}
              className={`selecao-opcao${i === ativo ? ' selecao-opcao-ativa' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(i)}
            >
              <span>{o.rotulo}</span>
              {o.valor === escolhido ? <Icone nome="check" tamanho={16} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {nome ? <input type="hidden" name={nome} value={escolhido} /> : null}
    </div>
  );
}
