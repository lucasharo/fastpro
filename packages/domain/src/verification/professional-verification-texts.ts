// Issue 54 (H-041) | Unica fonte de frases do estado visivel (docs/factory/141-DESENHO-H041.md §6.2 e §6.3).
// Modelo de texto (dec. 561): o dono aprova o texto antes de producao. Nenhuma frase fora deste arquivo,
// exceto TEXTO_EM_ANALISE, que vem da mensagem neutra da Issue 53 (dec. 483, reutilizada sem alteracao).
import { TEXTO_EM_ANALISE } from './professional-status-message.js';
import type { MotivoVisivel } from './professional-verification-state.js';

export const TEXTOS_ESTADO = {
  sem_envio: 'Você ainda não enviou seus documentos. Envie para começar a análise.',
  em_analise: TEXTO_EM_ANALISE,
  aprovada: 'Seu cadastro foi aprovado.',
  recusada: 'Seu cadastro não foi aprovado.',
  suspensa: 'Sua conta está com restrição. Entre em contato com o suporte.',
} as const;

export const TEXTO_MOTIVO: Readonly<Record<MotivoVisivel, string>> = {
  documento_ilegivel: 'O documento enviado não está legível.',
  documento_divergente: 'Os dados do documento não conferem com o cadastro.',
  tipo_nao_aceito: 'O tipo de arquivo enviado não é aceito.',
  certificacao_insuficiente: 'A certificação enviada não atende ao serviço escolhido.',
  outro: 'Veja a explicação abaixo.',
};

export const TEXTO_RECURSO_RECEBIDO = 'Seu pedido de revisão foi recebido.';
export const TEXTO_RECURSO_ANALISADO = 'Seu pedido de revisão já foi analisado.';
export const TEXTO_RECURSO_INDISPONIVEL = 'Não é possível pedir revisão agora.';
export const TEXTO_CARREGANDO = 'Carregando sua situação';
export const TEXTO_ERRO_CARREGAMENTO = 'Não foi possível carregar sua situação. Tente de novo.';

export const ROTULO_ENVIAR_DOCUMENTOS = 'Enviar documentos';
export const ROTULO_PEDIR_REVISAO = 'Pedir revisão';
export const ROTULO_DATA_DECISAO = 'Data da decisão';
export const ROTULO_MOTIVO = 'Motivo';
export const ROTULO_EXPLICACAO = 'Explicação';

/** Todas as frases de tela, para a varredura de testes (T41-14). */
export const TODAS_AS_FRASES: readonly string[] = [
  ...Object.values(TEXTOS_ESTADO),
  ...Object.values(TEXTO_MOTIVO),
  TEXTO_RECURSO_RECEBIDO,
  TEXTO_RECURSO_ANALISADO,
  TEXTO_RECURSO_INDISPONIVEL,
  TEXTO_CARREGANDO,
  TEXTO_ERRO_CARREGAMENTO,
  ROTULO_ENVIAR_DOCUMENTOS,
  ROTULO_PEDIR_REVISAO,
  ROTULO_DATA_DECISAO,
  ROTULO_MOTIVO,
  ROTULO_EXPLICACAO,
];
