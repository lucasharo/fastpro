'use client';
// Campo "Qual servico?" com sugestoes do catalogo real (debounce de 250 ms, teclado e leitor de tela).
import { useEffect, useId, useRef, useState } from 'react';
import { buscarServicos, type ServicoCatalogo } from '@/lib/api';

export interface CampoServicoProps {
  readonly valor: string;
  readonly onTexto: (texto: string) => void;
  readonly onEscolher: (servico: ServicoCatalogo) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly id?: string;
  readonly invalido?: boolean;
}

export function CampoServico({ valor, onTexto, onEscolher, placeholder, className, id, invalido }: CampoServicoProps) {
  const idPadrao = useId();
  const idCampo = id ?? idPadrao;
  const [opcoes, setOpcoes] = useState<ServicoCatalogo[]>([]);
  const [aviso, setAviso] = useState('');
  const [ativo, setAtivo] = useState(-1);
  const escolhido = useRef<string | null>(null);
  // So busca depois que a pessoa digita: valor preenchido pela tela (rascunho, inicial) nao abre sugestoes.
  const digitou = useRef(false);
  // Resposta que chega depois que a pessoa saiu do campo e descartada (a lista nao abre fora de hora).
  const focado = useRef(false);

  useEffect(() => {
    const q = valor.trim();
    if (!digitou.current || q.length < 2 || escolhido.current === valor) {
      setOpcoes([]);
      setAviso('');
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await buscarServicos(q);
      if (!vivo || !focado.current) return;
      if (r === 'limite') {
        setOpcoes([]);
        setAviso('Muitas buscas seguidas. Aguarde um instante.');
      } else if (r === 'erro') {
        setOpcoes([]);
        setAviso('Não foi possível buscar agora.');
      } else {
        setOpcoes(r);
        setAtivo(-1);
        setAviso(r.length === 0 ? 'Nenhum serviço encontrado. Tente outro nome.' : '');
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [valor]);

  function escolher(s: ServicoCatalogo) {
    escolhido.current = s.service_name;
    onTexto(s.service_name);
    onEscolher(s);
    setOpcoes([]);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={idCampo}
        className={className}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={opcoes.length > 0}
        aria-controls={`${idCampo}-lista`}
        aria-activedescendant={ativo >= 0 ? `${idCampo}-op-${ativo}` : undefined}
        aria-invalid={invalido ? 'true' : undefined}
        placeholder={placeholder ?? 'Ex.: eletricista, faxina, pintor'}
        value={valor}
        onFocus={() => {
          focado.current = true;
        }}
        onBlur={() => {
          focado.current = false;
          setOpcoes([]);
        }}
        onChange={(e) => {
          escolhido.current = null;
          digitou.current = true;
          onTexto(e.target.value);
        }}
        onKeyDown={(e) => {
          if (opcoes.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((a) => Math.min(a + 1, opcoes.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && ativo >= 0) {
            e.preventDefault();
            const s = opcoes[ativo];
            if (s) escolher(s);
          } else if (e.key === 'Escape') {
            setOpcoes([]);
          }
        }}
      />
      {opcoes.length > 0 ? (
        <ul id={`${idCampo}-lista`} role="listbox" className="lista-sugestoes lista-sugestoes-larga">
          {opcoes.map((s, i) => (
            <li key={s.service_id} id={`${idCampo}-op-${i}`} role="option" aria-selected={i === ativo}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(s)}>
                {s.service_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="campo-dica" aria-live="polite">
        {aviso}
      </p>
    </div>
  );
}
