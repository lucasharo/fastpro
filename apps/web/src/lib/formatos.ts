// Formatos de exibicao (fuso de Sao Paulo, reais) e rotulos fixos do produto.

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** 2990 -> "R$ 29,90". */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const URGENCIAS = [
  { valor: 'imediato', rotulo: 'Imediato', dica: 'Para hoje ou amanhã' },
  { valor: 'proximas_semanas', rotulo: 'Nas próximas semanas', dica: 'Tenho alguma flexibilidade' },
  { valor: 'proximo_mes', rotulo: 'Próximo mês', dica: 'Estou me planejando' },
  { valor: 'nao_definido', rotulo: 'Ainda não defini', dica: 'Quero só orçamentos' },
] as const;

export function rotuloUrgencia(valor: string | null | undefined): string {
  return URGENCIAS.find((u) => u.valor === valor)?.rotulo ?? 'Não informado';
}

/** Mapeia o "quando" da busca da inicial para a urgencia do pedido. */
export function urgenciaDoQuando(quando: string | null): string | null {
  if (quando === 'urgente') return 'imediato';
  if (quando === 'esta_semana') return 'proximas_semanas';
  if (quando === 'flexivel') return 'nao_definido';
  return null;
}

export const STATUS_PEDIDO: Record<string, { rotulo: string; classe: string }> = {
  publicado: { rotulo: 'Publicado', classe: 'selo-info' },
  selecionado: { rotulo: 'Profissional escolhido', classe: 'selo-sucesso' },
  concluido: { rotulo: 'Concluído', classe: 'selo-neutro' },
  cancelado: { rotulo: 'Cancelado', classe: 'selo-erro' },
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
