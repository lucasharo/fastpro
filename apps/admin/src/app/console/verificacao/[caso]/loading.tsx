// Issue 52 (H-039) | Estado carregando do detalhe do caso, enquanto a pagina e buscada na API.
import { TEXTO_CARREGANDO_CASO } from '../../../../verification-detail-state';

export default function CarregandoCaso() {
  return (
    <main>
      <p role="status">{TEXTO_CARREGANDO_CASO}</p>
    </main>
  );
}
