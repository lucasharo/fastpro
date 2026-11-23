// Aviso de erro no padrao da web: icone de alerta sem caixa propria e a mensagem dentro do aviso.
import { Icone } from './Icone';

export function AvisoErro({ texto }: { readonly texto: string }) {
  return (
    <div role="alert" className="aviso aviso-erro">
      <Icone nome="alerta" tamanho={20} />
      <p>{texto}</p>
    </div>
  );
}
