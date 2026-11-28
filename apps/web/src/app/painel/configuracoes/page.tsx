// Configuracoes do cliente.
import type { Metadata } from 'next';
import { AvisosPush } from '@/components/AvisosPush';
import { CabecaPagina, PaginaInterna } from '@/components/ui';

export const metadata: Metadata = { title: 'Configurações' };

export default function Configuracoes() {
  return (
    <PaginaInterna largura="estreita">
      <CabecaPagina sobretitulo="Área do cliente" titulo="Suas" destaque="configurações" texto="Ajuste como o FastPro funciona neste aparelho." />
      <AvisosPush />
    </PaginaInterna>
  );
}
