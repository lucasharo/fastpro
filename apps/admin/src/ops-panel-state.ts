// H-108 (Issue 117) | Estado da tela operacao a partir da resposta de GET /v1/admin/ops/panel
// (docs/factory/76-DESENHO-H108.md §2 e §3; 73-REFINO-H108.md CA-H108-06, 10, 15, 16). Funcao pura, sem React
// e sem I/O. A tela so mostra o que a API devolveu; quem decide o acesso e o servidor (404/403 = sem acesso).
// Bloco com fonte ausente (null na resposta) nao aparece. Corpo fora do contrato = erro, nunca dado inventado.

/** Estados da fila de e-mail (ops.email_outbox.state), na ordem de exibicao. */
export const ESTADOS_EMAIL = [
  'pendente',
  'enviando',
  'enviado',
  'falha',
  'suprimido',
  'adiado_cota',
  'descartado',
] as const;
export type EstadoEmail = (typeof ESTADOS_EMAIL)[number];

/** Rotulos dos estados da fila (texto de tela, nao vem da API). */
export const ROTULO_ESTADO: Readonly<Record<EstadoEmail, string>> = {
  pendente: 'Pendentes',
  enviando: 'Enviando',
  enviado: 'Enviados',
  falha: 'Com falha',
  suprimido: 'Suprimidos',
  adiado_cota: 'Adiados por cota',
  descartado: 'Descartados',
};

/** Estados que ainda aguardam envio: sao a "pendencia" da fila. */
const ESTADOS_PENDENTES: readonly EstadoEmail[] = ['pendente', 'enviando', 'adiado_cota'];

/** Texto da fila sem itens pendentes (CA-H108-06). */
export const TEXTO_FILA_VAZIA = 'Nenhuma pendência no momento.';
/** Texto de servico sem registro de uso (CA-H108-10): nunca 0%. */
export const TEXTO_SEM_DADOS = 'Sem dados';

/** Rotulos dos servicos e periodos de cota (texto de tela). */
const ROTULO_SERVICO: Readonly<Record<string, string>> = {
  email: 'E-mail',
  mapbox_permanent: 'Mapbox (permanente)',
  mapbox_geocoding_temp: 'Mapbox (geocodificação temporária)',
  storage: 'Armazenamento',
  banco: 'Banco de dados',
};
const ROTULO_PERIODO: Readonly<Record<string, string>> = {
  dia_utc: 'Hoje (UTC)',
  mes: 'No mês',
};

/** Forma da resposta 200 (snake_case, igual ao contrato de 76 §2). */
export interface PainelFila {
  readonly por_estado: Readonly<Record<string, number>>;
  readonly idade_pendente_s: number | null;
  readonly falhas_por_codigo: Readonly<Record<string, number>>;
}
export type PainelCota =
  | { readonly servico: string; readonly periodo: string; readonly sem_dados: true }
  | {
      readonly servico: string;
      readonly periodo: string;
      readonly usado: number;
      readonly limite: number;
      readonly percentual: number;
      readonly alerta: number;
      readonly alertado_em: string | null;
    };
export interface PainelWebhooks {
  readonly falhas: number;
  readonly latencia: { readonly n: number; readonly media_ms: number | null; readonly max_ms: number | null };
  readonly idade_pendente_s: number | null;
}
export interface PainelFotos {
  readonly falhas_upload_por_tipo: Readonly<Record<string, number>>;
  readonly falhas_reencode_por_tipo: Readonly<Record<string, number>>;
}
export interface PainelBody {
  readonly gerado_em: string;
  readonly fila_email: PainelFila;
  readonly cotas: readonly PainelCota[];
  readonly webhooks: PainelWebhooks | null;
  readonly fotos: PainelFotos | null;
  readonly rls: { readonly negacoes: number } | null;
}

export type EstadoPainel =
  | { readonly tipo: 'painel'; readonly painel: PainelBody }
  | { readonly tipo: 'sem_acesso' }
  | { readonly tipo: 'erro' };

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ehNumeroOuNulo = (v: unknown): boolean => v === null || ehNumero(v);
const ehMapaNumerico = (v: unknown): boolean => ehObjeto(v) && Object.values(v).every(ehNumero);

function cotaValida(c: unknown): boolean {
  if (!ehObjeto(c) || typeof c.servico !== 'string' || typeof c.periodo !== 'string') return false;
  if (c.sem_dados === true) return true;
  return (
    ehNumero(c.usado) &&
    ehNumero(c.limite) &&
    ehNumero(c.percentual) &&
    ehNumero(c.alerta) &&
    (c.alertado_em === null || typeof c.alertado_em === 'string')
  );
}

function filaValida(f: unknown): boolean {
  return (
    ehObjeto(f) &&
    ehMapaNumerico(f.por_estado) &&
    ehNumeroOuNulo(f.idade_pendente_s) &&
    ehMapaNumerico(f.falhas_por_codigo)
  );
}

function webhooksValidos(w: unknown): boolean {
  if (w === null) return true;
  if (!ehObjeto(w) || !ehNumero(w.falhas) || !ehNumeroOuNulo(w.idade_pendente_s)) return false;
  const l = w.latencia;
  return ehObjeto(l) && ehNumero(l.n) && ehNumeroOuNulo(l.media_ms) && ehNumeroOuNulo(l.max_ms);
}

function fotosValidas(f: unknown): boolean {
  if (f === null) return true;
  return ehObjeto(f) && ehMapaNumerico(f.falhas_upload_por_tipo) && ehMapaNumerico(f.falhas_reencode_por_tipo);
}

function rlsValido(r: unknown): boolean {
  if (r === null) return true;
  return ehObjeto(r) && ehNumero(r.negacoes);
}

/** Corpo 200 fora do contrato = erro (nunca mostra zero no lugar de dado ausente). */
function painelValido(corpo: unknown): corpo is PainelBody {
  if (!ehObjeto(corpo) || typeof corpo.gerado_em !== 'string') return false;
  return (
    filaValida(corpo.fila_email) &&
    Array.isArray(corpo.cotas) &&
    corpo.cotas.every(cotaValida) &&
    webhooksValidos(corpo.webhooks) &&
    fotosValidas(corpo.fotos) &&
    rlsValido(corpo.rls)
  );
}

/**
 * Mapeia a resposta HTTP do painel para um dos tres estados. 404 (sem sessao) e 403 (sem a permissao) viram
 * sem_acesso: a tela nao existe para quem nao e Superadmin. Qualquer outra falha vira erro.
 */
export function estadoDoPainel(status: number, corpo: unknown): EstadoPainel {
  if (status === 404 || status === 403) return { tipo: 'sem_acesso' };
  if (status !== 200) return { tipo: 'erro' };
  return painelValido(corpo) ? { tipo: 'painel', painel: corpo } : { tipo: 'erro' };
}

/** Fila sem itens pendentes: nenhum pendente, enviando ou adiado por cota (CA-H108-06). */
export function filaVazia(fila: PainelFila): boolean {
  return ESTADOS_PENDENTES.every((estado) => (fila.por_estado[estado] ?? 0) === 0);
}

/** Contagem de um estado (ausente na resposta = zero linhas no banco). */
export function contagemEstado(fila: PainelFila, estado: EstadoEmail): number {
  return fila.por_estado[estado] ?? 0;
}

/** Rotulo de servico e periodo da cota; codigo desconhecido aparece como esta, sem inventar nome. */
export function rotuloCota(servico: string, periodo: string): string {
  return `${ROTULO_SERVICO[servico] ?? servico} · ${ROTULO_PERIODO[periodo] ?? periodo}`;
}

/** Aviso do nivel de alerta gravado (70, 85 ou 95). Zero = sem aviso. */
export function rotuloAlerta(alerta: number): string | null {
  if (alerta === 1) return 'Aviso: 70% do limite';
  if (alerta === 2) return 'Aviso: 85% do limite';
  if (alerta === 3) return 'Aviso: 95% do limite';
  return null;
}

/** Idade em texto simples: "45 segundos", "12 minutos", "3 horas e 5 minutos". */
export function idadeTexto(segundos: number): string {
  if (segundos < 60) return `${segundos} segundos`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} horas` : `${horas} horas e ${resto} minutos`;
}

/** Instante gravado, em horario de Brasilia (produto brasileiro). */
export function instanteTexto(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
