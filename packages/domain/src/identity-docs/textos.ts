// H-037 (Issue #50) | Textos da interface de documentos (106-REFINO-H037 §6; aprovados pela decisao 186, e a recusa por
// conteudo e o estado do perfil pela decisao 226). Os codigos sao fixos: a tela nunca mostra eco da entrada.

/** Codigos de recusa e de estado que a tela traduz em texto. */
export type IdentityDocTextoCodigo =
  | 'vazio'
  | 'recebido'
  | 'tipo_nao_aceito'
  | 'arquivo_grande_imagem'
  | 'arquivo_grande_pdf'
  | 'limite_documentos'
  | 'falha_envio'
  | 'muitas_tentativas'
  | 'sessao'
  | 'conteudo_recusado'
  | 'estado_perfil';

export const IDOC_TEXTOS: Readonly<Record<IdentityDocTextoCodigo, string>> = {
  vazio: 'Envie seu documento de identidade. Aceitos: foto JPG, PNG ou WebP de até 5 MB, ou PDF de até 2 MB.',
  recebido: 'Documento recebido. A equipe de verificação vai analisar.',
  tipo_nao_aceito: 'Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF.',
  arquivo_grande_imagem: 'Esta imagem é grande demais. Escolha uma imagem de até 5 MB.',
  arquivo_grande_pdf: 'Este PDF tem mais de 2 MB. Envie um arquivo menor.',
  limite_documentos: 'Você já enviou o máximo de 5 documentos.',
  falha_envio: 'Não foi possível enviar. Tente de novo.',
  muitas_tentativas: 'Muitas tentativas. Tente mais tarde.',
  sessao: 'Entre de novo para enviar.',
  conteudo_recusado: 'Não foi possível aceitar este arquivo. Envie outra foto ou outro PDF do documento.',
  // [PROPOSTA] da 107 §8: texto do estado do perfil que nao aceita envio. Aprovacao registrada na decisao 226,
  // mas o texto exato nao consta no refino; o Architect deve confirmar a redacao antes da tela final.
  estado_perfil: 'Não é possível enviar documentos agora. Fale com a equipe de verificação.',
};
