// H-099 | Lembretes de prazo, trial e ciclo: constantes e decisores puros (docs/factory/163-DESENHO-H099.md, §3.1 e §3.2).
// Sem I/O e sem relogio: o instante "agora" entra sempre por parametro (nowIso). Constantes unicas: ajustar aqui,
// sem migracao (A-3). Os vereditos reusam o tipo Verdict de rules.ts.
import type { Verdict } from './rules.js';

const H = 3_600_000;

/** Distancia do marco ao instante-ancora (published_at para pedido; starts_at para trial). */
export const REMINDER_OFFSETS_MS = Object.freeze({
  prazo_t24: 144 * H, // published_at + 144 h = acceptance_deadline_at - 24 h
  prazo_t0: 168 * H, // published_at + 168 h = acceptance_deadline_at
  trial_t3d: 264 * H, // starts_at + 264 h = ends_at - 72 h
  trial_t0: 336 * H, // starts_at + 336 h = ends_at
});

export type ReminderOffsetKey = keyof typeof REMINDER_OFFSETS_MS;

/** Atraso maximo aceito entre o marco e a decisao; depois disso o lembrete vira obsoleto (nunca sai caduco). */
export const REMINDER_LATE_TOLERANCE_MS: Readonly<Record<ReminderOffsetKey, number>> = Object.freeze({
  prazo_t24: 6 * H,
  prazo_t0: 24 * H,
  trial_t3d: 6 * H,
  trial_t0: 24 * H,
});

/** Janela de varredura: olha ate 15 min adiante do agora; a cada 5 min. */
export const SCAN_LOOKAHEAD_MS = 15 * 60_000;
export const SCAN_INTERVAL_S = 300;

export type ReminderSubject = 'request' | 'trial';
export type ReminderMarco = 't24' | 't0' | 't3d';

export interface RequestReminderView {
  readonly requestId: string;
  readonly customerUserId: string;
  readonly status: 'publicado' | 'selecionado' | 'concluido' | 'cancelado';
  readonly acceptanceDeadlineAt: string;
  readonly customerStatus: 'ativo' | 'bloqueado' | 'em_eliminacao' | 'anonimizado';
}

export type TrialEstado =
  | 'trial_ativo'
  | 'trial_expirado'
  | 'ativa'
  | 'em_carencia'
  | 'cancelada_com_acesso_ate_fim_do_periodo'
  | 'expirada'
  | 'sem_acesso';

export interface TrialReminderView {
  readonly grantId: string;
  readonly professionalUserId: string;
  readonly grantStatus: 'ativa' | 'revogada';
  readonly endsAt: string;
  readonly estado: TrialEstado;
  readonly userStatus: 'ativo' | 'bloqueado' | 'em_eliminacao' | 'anonimizado';
}

/** Instante do marco: ancora + distancia do marco. Entrada invalida lanca erro (falha fechada). */
export function markInstant(anchor: string, key: ReminderOffsetKey): string {
  const base = Date.parse(anchor);
  if (Number.isNaN(base)) throw new RangeError('ancora_invalida');
  return new Date(base + REMINDER_OFFSETS_MS[key]).toISOString();
}

/** Atrasado alem da tolerancia, ou data ilegivel: obsoleto (fail closed). */
function atrasado(key: ReminderOffsetKey, markAt: string, nowIso: string): boolean {
  const mark = Date.parse(markAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(mark) || Number.isNaN(now)) return true;
  return now - mark > REMINDER_LATE_TOLERANCE_MS[key];
}

/** Pedido (prazo): T-24h e T0. Ordem de avaliacao fixada no desenho §3.2. */
export function decideRequestReminder(
  marco: 't24' | 't0',
  v: RequestReminderView,
  markAt: string,
  nowIso: string,
): Verdict {
  if (v.customerStatus !== 'ativo') return 'destinatario_invalido';
  if (v.status !== 'publicado') return 'obsoleto';
  const key: ReminderOffsetKey = marco === 't24' ? 'prazo_t24' : 'prazo_t0';
  if (atrasado(key, markAt, nowIso)) return 'obsoleto';
  const now = Date.parse(nowIso);
  const deadline = Date.parse(v.acceptanceDeadlineAt);
  if (Number.isNaN(deadline)) return 'obsoleto';
  if (marco === 't24' && now >= deadline) return 'obsoleto';
  if (marco === 't0' && now < deadline) return 'obsoleto';
  return 'valido';
}

/** Trial: T-3d (ainda em trial) e T0 (trial expirado e nao pago). Ordem fixada no desenho §3.2. */
export function decideTrialReminder(
  marco: 't3d' | 't0',
  v: TrialReminderView,
  markAt: string,
  nowIso: string,
): Verdict {
  if (v.userStatus !== 'ativo') return 'destinatario_invalido';
  if (v.grantStatus === 'revogada') return 'obsoleto';
  const key: ReminderOffsetKey = marco === 't3d' ? 'trial_t3d' : 'trial_t0';
  if (atrasado(key, markAt, nowIso)) return 'obsoleto';
  if (marco === 't3d' && v.estado !== 'trial_ativo') return 'obsoleto';
  if (marco === 't0' && v.estado !== 'trial_expirado') return 'obsoleto';
  return 'valido';
}
