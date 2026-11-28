// Configuracoes do profissional.
import type { Metadata } from 'next';
import { AvisosPush } from '@/components/AvisosPush';
import { CabecaPagina } from '@/components/ui';

export const metadata: Metadata = { title: 'Configurações' };

export default function ConfiguracoesProfissional() {
  return (
    <>
      <CabecaPagina sobretitulo="Área do profissional" titulo="Suas" destaque="configurações" texto="Ajuste como o FastPro funciona neste aparelho." />
      <AvisosPush />
    </>
  );
}
