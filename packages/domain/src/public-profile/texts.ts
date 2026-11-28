// Issue 56 (H-043) | Fonte unica das frases do perfil publico (docs/factory/143-DESENHO-H043.md, §6.2; dec. 586 e 651).
// Modelo [PROPOSTA]: o texto de limitacao do selo precisa de revisao juridica antes de producao (BLQ-JUR L7).
// Nenhuma frase do perfil fica fora deste arquivo (varredura em public-profile-texts.test.ts).

export const PUBLIC_PROFILE_TEXTS = {
  rotuloSelo: 'Identidade verificada',
  rotuloLimitesSelo: 'Limites do selo',
  textoLimitacaoSelo:
    'Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo atesta apenas a conferência de identificação cadastral e não constitui garantia de qualidade, certificação técnica, recomendação ou cobertura securitária sobre os serviços prestados.',
  reputacaoSemAvaliacoes: 'Ainda sem avaliações',
  servicosVazios: 'Este profissional ainda não cadastrou serviços para exibição.',
  naoEncontrado: 'Perfil não encontrado ou indisponível.',
  erro: 'Não foi possível carregar o perfil agora. Tente novamente em instantes.',
  carregando: 'Carregando perfil.',
  tituloServicos: 'Serviços',
  tituloReputacao: 'Avaliações',
  modalidadePresencial: 'Presencial',
  modalidadeOnline: 'Online',
} as const;

/** Frases proibidas em qualquer texto do perfil (dec. 586). Verificadas por teste sobre todo o conjunto de textos. */
export const PUBLIC_PROFILE_FORBIDDEN_PHRASES = [
  'Profissional Garantido',
  'Qualidade Certificada',
  'Super Profissional',
  'Seguro FastPro',
  'garantia FastPro',
] as const;
