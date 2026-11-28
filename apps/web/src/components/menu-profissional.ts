// Menu da area do profissional: barra lateral (telas largas) e gaveta do cabecalho (celular).
import type { NomeIcone } from './Icone';

export const MENU_PROFISSIONAL: readonly { readonly href: string; readonly rotulo: string; readonly icone: NomeIcone }[] = [
  { href: '/profissional/painel', rotulo: 'Painel', icone: 'painel' },
  { href: '/profissional/gestao', rotulo: 'Gestão profissional', icone: 'check' },
  { href: '/profissional/pedidos', rotulo: 'Pedidos da região', icone: 'local' },
  { href: '/profissional/aceitos', rotulo: 'Pedidos aceitos', icone: 'conversa' },
  { href: '/profissional/avaliacoes', rotulo: 'Avaliações', icone: 'estrela' },
  { href: '/profissional/perfil', rotulo: 'Perfil e área', icone: 'usuario' },
  { href: '/profissional/galeria', rotulo: 'Galeria', icone: 'camera' },
  { href: '/profissional/assinatura', rotulo: 'Assinatura', icone: 'carteira' },
  { href: '/profissional/configuracoes', rotulo: 'Configurações', icone: 'engrenagem' },
];
