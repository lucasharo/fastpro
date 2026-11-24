// Issue 52 (H-039) | Estado do detalhe do caso, do formulario de decisao e da leitura do documento
// (docs/factory/124-DESENHO-H039.md §5.4; decs. 375, 386, 387). Funcoes puras, sem React e sem I/O.
// O estado copia so os campos da tela: o identificador do documento nunca entra aqui e nunca chega ao navegador.
import { daApi, type LinhaFilaTela } from './verification-state';

/** Limite tecnico do complemento livre da decisao (dec. 375). */
export const COMPLEMENTO_MAX = 500;
export const TEXTO_AVISO_COMPLEMENTO = 'Não escreva CPF, CNPJ, e-mail ou telefone.';
export const TEXTO_CARREGANDO_CASO = 'Carregando o caso...';
export const TEXTO_ERRO_CASO = 'Não foi possível carregar o caso. Tente de novo.';
export const TEXTO_ERRO_LEITURA = 'Não foi possível abrir o documento. Tente de novo.';
export const TEXTO_SEM_DOCUMENTO = 'Documento indisponível neste caso.';
export const TEXTO_DECISAO_SALVA = 'Decisão registrada.';
export const TEXTO_CONFLITO_DECISAO =
  'Este caso mudou enquanto você olhava. Recarregue a página e confira antes de decidir.';
export const TEXTO_INVALIDO_DECISAO = 'Não foi possível aceitar esta decisão. Confira o motivo e o complemento.';
export const TEXTO_ERRO_DECISAO = 'Não foi possível registrar a decisão. Tente de novo.';
export const TEXTO_SEM_ACESSO_DECISAO = 'Este caso não está disponível para você.';

export const DECISOES_TELA = [
  { valor: 'aprovada', rotulo: 'Aprovar' },
  { valor: 'recusada', rotulo: 'Recusar' },
  { valor: 'retida_duplicidade', rotulo: 'Reter por duplicidade' },
] as const;

export const MOTIVOS_DECISAO_TELA = [
  { valor: 'aprovado', rotulo: 'Documento conferido' },
  { valor: 'documento_ilegivel', rotulo: 'Documento ilegível' },
  { valor: 'documento_divergente', rotulo: 'Documento divergente dos dados' },
  { valor: 'tipo_nao_aceito', rotulo: 'Tipo de documento não aceito' },
  { valor: 'duplicidade_suspeita', rotulo: 'Duplicidade suspeita' },
  { valor: 'certificacao_insuficiente', rotulo: 'Certificação insuficiente' },
  { valor: 'outro', rotulo: 'Outro (explique no complemento)' },
] as const;

export const MOTIVOS_LEITURA_TELA = [
  { valor: 'analise_inicial', rotulo: 'Análise inicial' },
  { valor: 'conferencia_duvida', rotulo: 'Conferência de dúvida' },
  { valor: 'reanalise_recurso', rotulo: 'Reanálise de recurso' },
] as const;

export type MotivoLeituraTela = (typeof MOTIVOS_LEITURA_TELA)[number]['valor'];

/** Linha da fila mais o resultado da decisao (so os campos que a tela usa). */
export interface DetalheTela extends LinhaFilaTela {
  readonly motivo: string | null;
  readonly explicacao: string | null;
  readonly decididoEm: string | null;
  readonly documentoDisponivel: boolean;
  readonly documentoRecebidoEm: string | null;
}

export type EstadoDetalhe =
  | { readonly tipo: 'sem_acesso' }
  | { readonly tipo: 'erro' }
  | { readonly tipo: 'ok'; readonly caso: DetalheTela };

function texto(x: unknown): x is string {
  return typeof x === 'string';
}

function anulavelTexto(x: unknown): x is string | null {
  return x === null || typeof x === 'string';
}

function casoValido(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    texto(c.id) &&
    texto(c.short_id) &&
    texto(c.status) &&
    texto(c.appeal_status) &&
    texto(c.sla_target_at) &&
    anulavelTexto(c.received_at) &&
    Array.isArray(c.services) &&
    c.services.every(texto) &&
    typeof c.overdue === 'boolean' &&
    typeof c.assigned_to_me === 'boolean' &&
    typeof c.version === 'number' &&
    anulavelTexto(c.motivo) &&
    anulavelTexto(c.explicacao) &&
    anulavelTexto(c.decididoEm) &&
    typeof c.documentoDisponivel === 'boolean' &&
    anulavelTexto(c.documentoRecebidoEm)
  );
}

/** Copia explicitamente os campos da tela; qualquer outro campo da resposta (inclusive o do documento) fica de fora. */
function paraDetalhe(c: Record<string, unknown>): DetalheTela {
  return {
    id: c.id as string,
    short_id: c.short_id as string,
    status: c.status as string,
    appeal_status: c.appeal_status as string,
    sla_target_at: c.sla_target_at as string,
    received_at: c.received_at as string | null,
    services: c.services as string[],
    overdue: c.overdue as boolean,
    assigned_to_me: c.assigned_to_me as boolean,
    version: c.version as number,
    motivo: c.motivo as string | null,
    explicacao: c.explicacao as string | null,
    decididoEm: c.decididoEm as string | null,
    documentoDisponivel: c.documentoDisponivel as boolean,
    documentoRecebidoEm: c.documentoRecebidoEm as string | null,
  };
}

/** 404 e a negacao uniforme (o caso nao existe ou nao e visivel); resposta fora do formato vira erro generico. */
export function estadoDoDetalhe(status: number, corpo: unknown): EstadoDetalhe {
  if (status === 404) return { tipo: 'sem_acesso' };
  const caso = daApi(corpo);
  if (status !== 200 || !casoValido(caso)) return { tipo: 'erro' };
  return { tipo: 'ok', caso: paraDetalhe(caso) };
}

export function rotuloMotivo(valor: string | null): string {
  if (valor === null) return 'Ainda não decidido';
  return MOTIVOS_DECISAO_TELA.find((m) => m.valor === valor)?.rotulo ?? 'Motivo não reconhecido';
}

export function ehMotivoLeitura(valor: string): valor is MotivoLeituraTela {
  return MOTIVOS_LEITURA_TELA.some((m) => m.valor === valor);
}

/** Motivo fixo do botao de leitura: recurso pendente pede reanalise; o resto e analise inicial. */
export function motivoLeituraPadrao(appealStatus: string): MotivoLeituraTela {
  return appealStatus === 'pendente' ? 'reanalise_recurso' : 'analise_inicial';
}

/** Tipos aceitos para download (o servico de leitura so devolve estes dois). */
export function extensaoDoDocumento(tipo: string): 'jpg' | 'pdf' | null {
  if (tipo === 'image/jpeg') return 'jpg';
  if (tipo === 'application/pdf') return 'pdf';
  return null;
}

export interface ContadorComplemento {
  readonly usados: number;
  readonly excedeu: boolean;
  readonly rotulo: string;
}

export function contadorComplemento(valor: string): ContadorComplemento {
  const usados = valor.length;
  const excedeu = usados > COMPLEMENTO_MAX;
  return { usados, excedeu, rotulo: `${usados} de ${COMPLEMENTO_MAX} caracteres` };
}

export type SituacaoDecisao = 'inicial' | 'salvo' | 'conflito' | 'invalido' | 'sem_acesso' | 'erro';

export interface EstadoDecisao {
  readonly situacao: SituacaoDecisao;
  readonly mensagem: string | null;
}

export const ESTADO_INICIAL_DECISAO: EstadoDecisao = { situacao: 'inicial', mensagem: null };

/** Mapeia a resposta da decisao: 409 = o caso mudou (recarregar), 422 = entrada recusada, 404 = sem acesso. */
export function estadoDaDecisao(status: number): EstadoDecisao {
  if (status === 200) return { situacao: 'salvo', mensagem: TEXTO_DECISAO_SALVA };
  if (status === 409) return { situacao: 'conflito', mensagem: TEXTO_CONFLITO_DECISAO };
  if (status === 422) return { situacao: 'invalido', mensagem: TEXTO_INVALIDO_DECISAO };
  if (status === 404) return { situacao: 'sem_acesso', mensagem: TEXTO_SEM_ACESSO_DECISAO };
  return { situacao: 'erro', mensagem: TEXTO_ERRO_DECISAO };
}

/** Motivos aceitos para cada decisao (mesma regra do dominio, motivoCombina): aprovar so com "aprovado", reter so
 * com duplicidade; recusar com os demais, e duplicidade_suspeita na recusa so de cadastro retido. */
export function motivosDaDecisao(decisao: string, retido: boolean): readonly { readonly valor: string; readonly rotulo: string }[] {
  if (decisao === 'aprovada') return MOTIVOS_DECISAO_TELA.filter((m) => m.valor === 'aprovado');
  if (decisao === 'retida_duplicidade') return MOTIVOS_DECISAO_TELA.filter((m) => m.valor === 'duplicidade_suspeita');
  return MOTIVOS_DECISAO_TELA.filter((m) => m.valor !== 'aprovado' && (retido || m.valor !== 'duplicidade_suspeita'));
}

export const TEXTO_CASO_ASSUMIDO = 'Caso assumido. Abra o documento e registre a decisão.';
export const TEXTO_ERRO_ASSUMIR = 'Não foi possível assumir o caso. Recarregue a página e tente de novo.';
