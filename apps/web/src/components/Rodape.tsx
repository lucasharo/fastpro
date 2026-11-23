'use client';
// Rodape escuro (template de referencia), na cor da marca. As colunas de links seguem o papel da sessao.
import Link from 'next/link';
import { Icone } from './Icone';
import { useSessao } from './Sessao';

const CLIENTES_VISITANTE = {
  titulo: 'Para clientes',
  links: [
    { href: '/pedido', rotulo: 'Pedir orçamento' },
    { href: '/#servicos', rotulo: 'Serviços' },
    { href: '/entrar', rotulo: 'Entrar' },
  ],
};
const PROFISSIONAIS_VISITANTE = {
  titulo: 'Para profissionais',
  links: [
    { href: '/profissional/cadastro', rotulo: 'Cadastre-se' },
    { href: '/profissional/entrar', rotulo: 'Entrar' },
    { href: '/profissional#planos', rotulo: 'Planos' },
  ],
};
const CLIENTE_LOGADO = {
  titulo: 'Sua conta',
  links: [
    { href: '/painel', rotulo: 'Meus pedidos' },
    { href: '/pedido', rotulo: 'Pedir orçamento' },
    { href: '/#como-funciona', rotulo: 'Como funciona' },
  ],
};
const PROFISSIONAL_LOGADO = {
  titulo: 'Sua área',
  links: [
    { href: '/profissional/painel', rotulo: 'Painel' },
    { href: '/profissional/pedidos', rotulo: 'Pedidos da região' },
    { href: '/profissional/conversas', rotulo: 'Conversas' },
    { href: '/profissional/assinatura', rotulo: 'Assinatura' },
  ],
};

export function Rodape() {
  const { papel } = useSessao();
  const COLUNAS =
    papel === 'cliente' ? [CLIENTE_LOGADO] : papel === 'profissional' ? [PROFISSIONAL_LOGADO] : [CLIENTES_VISITANTE, PROFISSIONAIS_VISITANTE];
  return (
    <footer className="rodape">
      <div className="container">
        <div className="rodape-grade">
          <div>
            <Link href={papel === 'profissional' ? '/profissional/painel' : '/'} className="marca">
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
