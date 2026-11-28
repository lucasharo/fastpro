// Issue 53 (H-040) | Mensagem neutra ao profissional sobre cadastro em analise ou retido (dec. 483, 530; RN-H040-10).
// Pendente, em revisao e retido recebem o mesmo estado publico e o mesmo texto. Nunca "duplicado",
// "ja existe" nem identificador. Demais estados tem texto definido por outra historia (fora de H-040).

export const ESTADO_PUBLICO_EM_ANALISE = 'em_analise';

export const TEXTO_EM_ANALISE = 'Não foi possível concluir seu cadastro agora. Vamos revisar seu caso.';

const ESTADOS_EM_ANALISE: readonly string[] = ['pendente', 'em_revisao', 'retida_duplicidade'];

export interface MensagemProfissional {
  readonly estado: string;
  readonly texto: string;
}

/** Estado publico: os tres estados internos em analise viram um so; os demais seguem como estao. */
export function estadoPublicoDoProfissional(estadoInterno: string): string {
  return ESTADOS_EM_ANALISE.includes(estadoInterno) ? ESTADO_PUBLICO_EM_ANALISE : estadoInterno;
}

/** Mensagem para os tres estados em analise; nulo para os demais (texto de outra historia). */
export function mensagemAoProfissional(estadoInterno: string): MensagemProfissional | null {
  if (!ESTADOS_EM_ANALISE.includes(estadoInterno)) return null;
  return { estado: ESTADO_PUBLICO_EM_ANALISE, texto: TEXTO_EM_ANALISE };
}
