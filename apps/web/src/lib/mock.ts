// Dados MOCK de vitrine (decisao do dono, 2026-11-23): preenchem a aparencia do template enquanto o produto
// nao tem volume real. Nada aqui vem do banco; numeros, depoimentos e fotos sao ilustrativos.

const foto = (id: string, largura: number, altura: number): string =>
  `https://images.unsplash.com/photo-${id}?w=${largura}&h=${altura}&fit=crop&auto=format&q=80`;

export const FOTOS = {
  eletricista: '1621905251189-08b45d6a269e',
  encanador: '1585704032915-c3400ca199e7',
  pintor: '1562259949-e8e7689d7828',
  diarista: '1581578731548-c64695cc6952',
  montador: '1504148455328-c376907d081c',
  jardinagem: '1416879595882-3373a0480b5b',
  reforma: '1503387762-592deb58ef4e',
  banheiro: '1584622650111-993a426fbf0a',
  sala: '1513694203232-719a280e022f',
} as const;

export type ChaveFoto = keyof typeof FOTOS;

export const urlFoto = (chave: ChaveFoto, largura = 600, altura = 400): string => foto(FOTOS[chave], largura, altura);

export interface ServicoVitrine {
  readonly nome: string;
  readonly busca: string;
  readonly descricao: string;
  readonly foto: ChaveFoto;
  readonly nota: string;
  readonly profissionais: number;
}

export const SERVICOS_POPULARES: readonly ServicoVitrine[] = [
  {
    nome: 'Eletricista',
    busca: 'Eletricista residencial',
    descricao: 'Tomadas, disjuntores, chuveiros e instalações completas',
    foto: 'eletricista',
    nota: '4,9',
    profissionais: 1240,
  },
  {
    nome: 'Encanador',
    busca: 'Encanador / bombeiro hidráulico',
    descricao: 'Vazamentos, desentupimentos e troca de registros',
    foto: 'encanador',
    nota: '4,8',
    profissionais: 980,
  },
  {
    nome: 'Pintor',
    busca: 'Pintor residencial',
    descricao: 'Pintura interna, externa, textura e acabamento',
    foto: 'pintor',
    nota: '4,9',
    profissionais: 1530,
  },
  {
    nome: 'Diarista',
    busca: 'Diarista / faxina',
    descricao: 'Faxina completa, limpeza pós-obra e passadoria',
    foto: 'diarista',
    nota: '4,7',
    profissionais: 2110,
  },
];

export const NUMEROS_HERO = [
  { valor: '12 mil+', rotulo: 'Profissionais' },
  { valor: '80 mil+', rotulo: 'Pedidos atendidos' },
] as const;

export const NOTA_MEDIA = '4,9';

export interface Depoimento {
  readonly texto: string;
  readonly servico: string;
  readonly nome: string;
  readonly cidade: string;
  readonly foto: string;
}

export const DEPOIMENTOS: readonly Depoimento[] = [
  {
    texto:
      'Pedi um eletricista de manhã e à tarde já tinha três profissionais conversando comigo. Escolhi pelo perfil e foi impecável.',
    servico: 'Eletricista',
    nome: 'Mariana Souza',
    cidade: 'Pinheiros, São Paulo',
    foto: foto('1494790108377-be9c29b29330', 100, 100),
  },
  {
    texto:
      'Como pintor, parei de pagar por contato. Com a assinatura recebo pedidos da minha região e converso direto com o cliente.',
    servico: 'Pintor',
    nome: 'Ricardo Lima',
    cidade: 'Santo André, SP',
    foto: foto('1507003211169-0a1dd7228f2d', 100, 100),
  },
  {
    texto:
      'Gostei de não precisar criar conta para pedir. Mandei as fotos do vazamento e o encanador já chegou sabendo o que fazer.',
    servico: 'Encanador',
    nome: 'Fernanda Alves',
    cidade: 'Moema, São Paulo',
    foto: foto('1438761681033-6461ffad8d80', 100, 100),
  },
];

/** Avatar ilustrativo de profissional (listas e conversas). */
export const AVATAR_PROFISSIONAL = foto('1500648767791-00dcc994a43e', 100, 100);

export interface ProfissionalInteressado {
  readonly id: string;
  readonly nome: string;
  readonly foto: string;
  readonly nota: string;
  readonly avaliacoes: number;
  readonly servicos: number;
  readonly distancia: string;
  readonly desde: string;
  readonly resumo: string;
}

/** Interessados de demonstracao no detalhe do pedido (o aceite real ainda nao chega a tela do cliente). */
export const INTERESSADOS: readonly ProfissionalInteressado[] = [
  {
    id: 'mock-1',
    nome: 'Carlos Mendes',
    foto: foto('1500648767791-00dcc994a43e', 100, 100),
    nota: '4,9',
    avaliacoes: 128,
    servicos: 312,
    distancia: '2,4 km',
    desde: '2021',
    resumo: 'Eletricista com NR-10. Atendo no mesmo dia na zona oeste.',
  },
  {
    id: 'mock-2',
    nome: 'Rafael Oliveira',
    foto: foto('1507003211169-0a1dd7228f2d', 100, 100),
    nota: '4,8',
    avaliacoes: 74,
    servicos: 190,
    distancia: '4,1 km',
    desde: '2022',
    resumo: 'Instalações residenciais e comerciais. Orçamento sem compromisso.',
  },
  {
    id: 'mock-3',
    nome: 'Juliana Costa',
    foto: foto('1494790108377-be9c29b29330', 100, 100),
    nota: '5,0',
    avaliacoes: 41,
    servicos: 96,
    distancia: '5,8 km',
    desde: '2023',
    resumo: 'Atendimento caprichado, com garantia de 90 dias no serviço.',
  },
];

export interface MensagemMock {
  readonly de: 'eu' | 'eles';
  readonly texto: string;
  readonly hora: string;
}

export const CONVERSA_MOCK: readonly MensagemMock[] = [
  { de: 'eles', texto: 'Olá! Vi seu pedido e posso ir amanhã às 9h. As tomadas são de 10 A ou 20 A?', hora: '09:12' },
  { de: 'eu', texto: 'Oi, Carlos! Acho que são de 10 A. O chuveiro é de 7.500 W.', hora: '09:20' },
  { de: 'eles', texto: 'Perfeito. Vou levar o disjuntor certo para o chuveiro. Fica em torno de R$ 280 com material.', hora: '09:24' },
];

/** Metricas de demonstracao do painel do profissional. */
export const METRICAS_PROFISSIONAL = [
  { valor: '18', rotulo: 'Pedidos na sua região hoje' },
  { valor: '7', rotulo: 'Aceites neste mês' },
  { valor: '4', rotulo: 'Conversas abertas' },
  { valor: '4,9', rotulo: 'Sua nota média' },
] as const;

/** Foto ilustrativa pelo nome do servico (vitrine); sem correspondencia, uma foto neutra. */
export function fotoDoServico(nome: string | undefined): ChaveFoto {
  const n = (nome ?? '').toLowerCase();
  if (n.includes('eletric')) return 'eletricista';
  if (n.includes('encan') || n.includes('hidr')) return 'encanador';
  if (n.includes('pint')) return 'pintor';
  if (n.includes('diar') || n.includes('faxin') || n.includes('limp')) return 'diarista';
  if (n.includes('mont') || n.includes('marcen')) return 'montador';
  if (n.includes('jardin')) return 'jardinagem';
  if (n.includes('reform') || n.includes('pedreir')) return 'reforma';
  if (n.includes('banheir')) return 'banheiro';
  return 'sala';
}
