// Escolha unica em chips, no padrao do ReasonChips do DriveMais (pedido do dono, 2026-11-27), com tokens do FastPro.
export interface OpcaoChip {
  readonly valor: string;
  readonly rotulo: string;
}

export interface ChipsProps {
  readonly opcoes: readonly OpcaoChip[];
  readonly valor: string;
  readonly onMudar: (valor: string) => void;
  /** Nome acessivel do grupo. */
  readonly rotulo: string;
}

export function Chips({ opcoes, valor, onMudar, rotulo }: ChipsProps) {
  return (
    <div className="chips" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          className="chip"
          onClick={() => onMudar(o.valor)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export interface ChipsMultiplosProps {
  readonly opcoes: readonly OpcaoChip[];
  readonly valores: readonly string[];
  readonly onMudar: (valores: readonly string[]) => void;
  /** Nome acessivel do grupo. */
  readonly rotulo: string;
  readonly invalido?: boolean;
  readonly descritoPor?: string;
}

/** Mesmo visual dos chips, com varias escolhas. */
export function ChipsMultiplos({ opcoes, valores, onMudar, rotulo, invalido, descritoPor }: ChipsMultiplosProps) {
  return (
    <div className="chips" role="group" aria-label={rotulo} data-invalido={invalido ? 'true' : undefined} aria-describedby={descritoPor}>
      {opcoes.map((o) => {
        const marcado = valores.includes(o.valor);
        return (
          <button
            key={o.valor}
            type="button"
            role="checkbox"
            aria-checked={marcado}
            className="chip"
            onClick={() => onMudar(marcado ? valores.filter((v) => v !== o.valor) : [...valores, o.valor])}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
