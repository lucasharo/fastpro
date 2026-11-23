'use client';
// Endereco com sugestoes (POST /v1/geo/address-suggest). Sem sugestao, o texto livre continua valendo.
import { useEffect, useRef, useState } from 'react';
import { chamarApi } from '@/lib/api';

export const ENDERECO_MIN = 3;
export const ENDERECO_MAX = 120;

export interface CampoEnderecoProps {
  readonly id: string;
  readonly valor: string;
  readonly onMudar: (texto: string) => void;
  readonly contexto: 'request_draft' | 'professional_base';
  /** Falso enquanto a consulta ainda nao pode acontecer (ex.: rascunho ainda nao criado). */
  readonly podeConsultar?: boolean;
  readonly invalido?: boolean;
  readonly placeholder?: string;
  /** Classe do campo (padrao: entrada do formulario). Na busca da inicial o campo e transparente. */
  readonly className?: string;
  /** Chamado no primeiro foco ou digitacao (ex.: criar o rascunho que libera as sugestoes). */
  readonly onPreparar?: () => void;
}

export function CampoEndereco({
  id,
  valor,
  onMudar,
  contexto,
  podeConsultar = true,
  invalido,
  placeholder,
  className = 'entrada',
  onPreparar,
}: CampoEnderecoProps) {
  const [itens, setItens] = useState<string[]>([]);
  const [ativo, setAtivo] = useState(-1);
  const escolhido = useRef<string | null>(null);
  // So busca depois que a pessoa digita: valor preenchido pela tela (rascunho, inicial) nao abre sugestoes.
  const digitou = useRef(false);
  // Resposta que chega depois que a pessoa saiu do campo e descartada (a lista nao abre fora de hora).
  const focado = useRef(false);

  useEffect(() => {
    const q = valor.trim();
    if (!digitou.current || !podeConsultar || q.length < ENDERECO_MIN || q.length > ENDERECO_MAX || escolhido.current === valor) {
      setItens([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await chamarApi<{ mode?: string; items?: { label?: unknown }[] }>('/v1/geo/address-suggest', {
        body: { q, context: contexto },
      });
      if (!vivo || !focado.current) return;
      if (r.status === 200 && r.corpo?.mode === 'ok' && Array.isArray(r.corpo.items)) {
        setItens(r.corpo.items.map((i) => (typeof i.label === 'string' ? i.label : null)).filter((l): l is string => l !== null));
        setAtivo(-1);
      } else {
        setItens([]);
      }
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [valor, contexto, podeConsultar]);

  function escolher(rotulo: string) {
    escolhido.current = rotulo;
    onMudar(rotulo);
    setItens([]);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className={className}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={itens.length > 0}
        aria-controls={`${id}-lista`}
        aria-activedescendant={ativo >= 0 ? `${id}-op-${ativo}` : undefined}
        aria-invalid={invalido ? 'true' : undefined}
        maxLength={ENDERECO_MAX}
        placeholder={placeholder ?? 'Rua, número e bairro'}
        value={valor}
        onFocus={() => {
          focado.current = true;
          onPreparar?.();
        }}
        onBlur={() => {
          focado.current = false;
          setItens([]);
        }}
        onChange={(e) => {
          escolhido.current = null;
          digitou.current = true;
          onPreparar?.();
          onMudar(e.target.value);
        }}
        onKeyDown={(e) => {
          if (itens.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((a) => Math.min(a + 1, itens.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && ativo >= 0) {
            e.preventDefault();
            const r = itens[ativo];
            if (r) escolher(r);
          } else if (e.key === 'Escape') {
            setItens([]);
          }
        }}
      />
      {itens.length > 0 ? (
        <ul id={`${id}-lista`} role="listbox" className="lista-sugestoes lista-sugestoes-larga">
          {itens.map((rotulo, i) => (
            <li key={rotulo} id={`${id}-op-${i}`} role="option" aria-selected={i === ativo}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(rotulo)}>
                {rotulo}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
