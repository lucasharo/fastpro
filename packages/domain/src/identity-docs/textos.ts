// H-037 (Issue #50) | Textos da interface de documentos (106-REFINO-H037 §6; aprovados pela decisao 186, e a recusa por
// conteudo e o estado do perfil pela decisao 226, e os textos de envio, exclusao, lista e rotulos pela decisao 260).
// Os codigos sao fixos: a tela nunca mostra eco da entrada.

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
  | 'estado_perfil'
  | 'enviando'
  | 'email_nao_verificado'
  | 'ja_analisado'
  | 'falha_lista'
  | 'titulo_pagina'
  | 'titulo_envio'
  | 'titulo_lista'
  | 'escolher_arquivo'
  | 'cancelar_envio'
  | 'repetir_envio'
  | 'excluir'
  | 'rotulo_foto'
  | 'rotulo_pdf'
  | 'rotulo_documento'
  | 'recebido_em';

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
  // Estado do perfil que nao aceita envio (decisao 226).
  estado_perfil: 'Não é possível enviar documentos agora. Fale com a equipe de verificação.',
  // Decisao 260: envio (107 §6), 403 sem e-mail verificado, exclusao ja analisada, falha da lista e rotulos (106 §8).
  enviando: 'Enviando documento...',
  email_nao_verificado: 'Confirme seu e-mail para enviar documentos.',
  ja_analisado: 'Este documento já foi analisado e não pode ser excluído.',
  falha_lista: 'Não foi possível carregar seus documentos. Tente de novo.',
  titulo_pagina: 'Documento de identidade',
  titulo_envio: 'Enviar documento',
  titulo_lista: 'Seus documentos',
  escolher_arquivo: 'Escolher arquivo',
  cancelar_envio: 'Cancelar envio',
  repetir_envio: 'Repetir envio',
  excluir: 'Excluir',
  rotulo_foto: 'Foto',
  rotulo_pdf: 'PDF',
  rotulo_documento: 'Documento',
  recebido_em: 'recebido em dd/mm/aaaa',
};
