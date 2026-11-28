// Issue 52 (H-039) | Estado carregando do detalhe do caso, enquanto a pagina e buscada na API.
import { TEXTO_CARREGANDO_CASO } from '../../../../verification-detail-state';

export default function CarregandoCaso() {
  return (
    <div>
      <p role="status" className="texto-suave">
        {TEXTO_CARREGANDO_CASO}
      </p>
    </div>
  );
}
