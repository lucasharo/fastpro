// Rodape escuro (template de referencia), na cor da marca.
import Link from 'next/link';
import { Icone } from './Icone';

const COLUNAS = [
  {
    titulo: 'Para clientes',
    links: [
      { href: '/pedido', rotulo: 'Pedir orçamento' },
      { href: '/#servicos', rotulo: 'Serviços' },
      { href: '/painel', rotulo: 'Meus pedidos' },
      { href: '/entrar', rotulo: 'Entrar' },
    ],
  },
  {
    titulo: 'Para profissionais',
    links: [
      { href: '/profissional/cadastro', rotulo: 'Cadastre-se' },
      { href: '/profissional/entrar', rotulo: 'Entrar' },
      { href: '/profissional/assinatura', rotulo: 'Planos' },
      { href: '/profissional/pedidos', rotulo: 'Pedidos da região' },
    ],
  },
] as const;

export function Rodape() {
  return (
    <footer className="rodape">
      <div className="container">
        <div className="rodape-grade">
          <div>
            <Link href="/" className="marca">
              <Icone nome="raio" tamanho={28} className="marca-icone" preenchido />
              <span>FastPro</span>
            </Link>
            <p className="rodape-sobre">
              Peça serviços de graça e receba propostas de profissionais verificados da sua região.
            </p>
            <div className="sociais">
              <a className="social" href="#" aria-label="Instagram">
                <Icone nome="instagram" tamanho={18} />
              </a>
              <a className="social" href="#" aria-label="Facebook">
                <Icone nome="facebook" tamanho={18} />
              </a>
              <a className="social" href="#" aria-label="LinkedIn">
                <Icone nome="linkedin" tamanho={18} />
              </a>
            </div>
          </div>
          {COLUNAS.map((c) => (
            <div key={c.titulo}>
              <h4>{c.titulo}</h4>
              <ul>
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.rotulo}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h4>Contato</h4>
            <ul>
              <li>
                <span>
                  <Icone nome="email" tamanho={16} /> contato@fastpro.com.br
                </span>
              </li>
              <li>
                <span>
                  <Icone nome="telefone" tamanho={16} /> (11) 4000-0000
                </span>
              </li>
              <li>
                <span>
                  <Icone nome="local" tamanho={16} /> São Paulo, SP
                </span>
              </li>
            </ul>
          </div>
        </div>
        <div className="rodape-base">
          <p>© 2026 FastPro. Todos os direitos reservados.</p>
          <nav aria-label="Legal">
            <a href="#">Privacidade</a>
            <a href="#">Termos de uso</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
