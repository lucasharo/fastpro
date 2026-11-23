// Estado vazio: icone semantico dentro de circulo do design system (.circulo-icone) e a mensagem.
import { Icone, type NomeIcone } from './Icone';

export function EstadoVazio({ texto, icone = 'documento' }: { readonly texto: string; readonly icone?: NomeIcone }) {
  return (
    <div className="vazio">
      <span className="circulo-icone">
        <Icone nome={icone} tamanho={22} />
      </span>
      <p>{texto}</p>
    </div>
  );
}
