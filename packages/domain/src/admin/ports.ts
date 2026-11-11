// H-102 | Portas da area admin (54 §7). Implementacoes reais ficam em @fastpro/db e no provedor de
// autenticacao; os testes usam versoes em memoria. O dominio nunca recebe chave, pepper ou segredo
// de ambiente. Token e segredo chegam ja gerados e saem so como hash no banco (feito pelo adaptador).

import type { AdminRole } from './roles.js';

export type AdminInviteState = 'emitido' | 'aguardando_totp' | 'usado' | 'invalidado';

/** Convite lido do banco. email vem decifrado pelo adaptador, so enquanto o convite estiver vivo. */
export interface AdminInviteRecord {
  readonly id: string;
  readonly kind: 'ativacao' | 'reenrolamento';
  readonly state: AdminInviteState;
  readonly roleCodes: readonly string[];
  readonly email: string;
  readonly userId: string | null;
  readonly attempts: number;
  readonly expiresAtMs: number;
}

/** Linha da guarda (private.admin_guard). Vazia = 404 na API. */
export interface AdminGuardRecord {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly aal2: boolean;
  readonly active: boolean;
  readonly expiresAtMs: number;
  /** Ultima prova do segundo fator da sessao (H-073, 60 §4). */
  readonly totpAtMs: number;
}

/** Conta da sessao (e-mail e identificador do provedor), so para a confirmacao de TOTP (H-073). */
export interface AdminSessionSubject {
  readonly userId: string;
  readonly email: string;
  readonly authUserId: string;
}

export interface AdminIssueInput {
  readonly inviterId: string;
  readonly email: string;
  readonly roles: readonly AdminRole[];
  readonly approvalRequestId: string | null;
  readonly token: string;
  readonly nowMs: number;
}

export type AdminIssueResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'aprovacao_invalida' | 'email_indisponivel' };

export interface AdminRepository {
  /** Um unico acesso ao banco por tentativa de convite (inclusive para token malformado). */
  lookupInvite(token: string, nowMs: number): Promise<AdminInviteRecord | null>;
  /** Conta do app_user com o e-mail (qualquer status). Usada antes de emitir convite. */
  emailHasAccount(email: string): Promise<boolean>;
  issueInvite(input: AdminIssueInput): Promise<AdminIssueResult>;
  /** Passo 1: cria a conta pendente_mfa (uma vez) e leva o convite a aguardando_totp. */
  markWaiting(
    token: string,
    account: { readonly authUserId: string; readonly email: string },
    nowMs: number,
  ): Promise<boolean>;
  /** Passo 2, codigo errado: soma tentativas. Devolve o total, ou nulo se o convite nao esta vivo. */
  recordCodeFailure(token: string, nowMs: number): Promise<number | null>;
  /** Passo 2, sucesso: ativa a conta com os papeis do convite e marca o convite como usado. */
  activateInvite(token: string, nowMs: number): Promise<boolean>;
  /** Conta admin ativa com papel, a partir do usuario do provedor de autenticacao. */
  findActiveStaff(authUserId: string): Promise<{ readonly userId: string; readonly roles: readonly string[] } | null>;
  /** Abre a sessao de 8 h. O segredo do cookie e gerado pelo adaptador e nunca fica no dominio. */
  openSession(userId: string, nowMs: number): Promise<{ readonly secret: string }>;
  /** Guarda de cada requisicao: uma consulta por requisicao (54 §3). */
  guard(secret: string, nowMs: number): Promise<AdminGuardRecord | null>;
  /** Conta da sessao valida (mesmas regras da guarda), para a confirmacao de TOTP. Nulo = sem sessao. */
  sessionSubject(secret: string, nowMs: number): Promise<AdminSessionSubject | null>;
  /** Avanca totp_at da sessao valida ate nowMs (nunca recua) e audita. False = sessao invalida. */
  stepUp(secret: string, nowMs: number): Promise<boolean>;
}

export interface AdminAuthAccount {
  readonly authUserId: string;
  /** Segredo TOTP e URI, exibidos uma vez na ativacao; o FastPro nao os guarda. */
  readonly secret: string;
  readonly otpauthUri: string;
}

/** Porta do provedor de autenticacao. Tokens do provedor nunca saem desta porta. */
export interface AdminAuthPort {
  enrollUser(email: string, password: string): Promise<AdminAuthAccount | null>;
  /** Entra com senha e valida o TOTP (passo 2 da ativacao). Descarta os tokens. */
  confirmEnrollment(email: string, password: string, code: string): Promise<boolean>;
  /** Login: senha + TOTP com aal2. Descarta os tokens. Nulo se qualquer etapa falhar. */
  signInWithPasswordAndTotp(email: string, password: string, code: string): Promise<{ readonly authUserId: string } | null>;
}

export interface AdminLoginCounts {
  readonly email: number;
  readonly ip: number;
}

/** Limites de login (H-015): 5 falhas por 15 min por e-mail e 20 por IP. */
export interface AdminLoginLimits {
  counts(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<AdminLoginCounts>;
  recordFailure(input: { readonly email: string; readonly ip: string }, nowMs: number): Promise<void>;
}

/**
 * Limite de consultas da auditoria (H-104, 63 R-2 e D-H104-9): 30 consultas em 5 min por admin.
 * Uma operacao so, atomica no banco: confere a janela e, se couber, consome a vaga. Devolve true (vaga
 * consumida) ou false (acima do limite; nada e lido nem gravado na trilha). Conferir e consumir em
 * chamadas separadas nao e atomico, por isso a porta e uma so. Adaptador: PgAuditQueryRateLimit.
 */
export interface AuditQueryRateLimit {
  take(adminUserId: string, nowMs: number): Promise<boolean>;
}

export interface AdminLogEntry {
  readonly evento: string;
  readonly resultado: string;
  readonly motivo?: string;
}

export type AdminLogger = (entry: AdminLogEntry) => void;

