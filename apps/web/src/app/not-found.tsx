// Pagina nao encontrada, no mesmo estilo das telas internas.
import Link from 'next/link';
import { Icone } from '@/components/Icone';
import { PaginaInterna } from '@/components/ui';

export default function NaoEncontrada() {
  return (
    <PaginaInterna largura="estreita">
      <div className="glass-card painel-cartao" style={{ textAlign: 'center' }}>
        <div className="circulo-icone" style={{ margin: '0 auto 1rem' }}>
          <Icone nome="busca" />
        </div>
        <span className="sobretitulo">Erro 404</span>
        <h1 style={{ fontSize: '2rem', margin: '0.5rem 0 1rem' }}>
          Página <span className="destaque">não encontrada</span>
        </h1>
        <p className="texto-suave" style={{ marginBottom: '1.5rem' }}>
          O endereço pode ter mudado. Volte ao início ou peça um orçamento.
        </p>
        <div className="linha" style={{ justifyContent: 'center' }}>
          <Link href="/" className="btn btn-primary btn-sm">
            Ir para o início
          </Link>
          <Link href="/pedido" className="btn btn-secondary btn-sm">
            Pedir orçamento
          </Link>
        </div>
      </div>
    </PaginaInterna>
  );
}
