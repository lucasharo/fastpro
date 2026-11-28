// H-016 | Elegibilidade do profissional e corpo de GET /v1/professional/me (logica pura, sem I/O).
// docs/factory/33-DESENHO-H016.md §5.2 e §8; 67-DESENHO-H016.md §8; CA-H016-05, CA-H016-10, CA-H016-21, CA-H016-22.
// A guarda vale antes de qualquer servico. O banco repete a mesma regra em private.professional_eligible.

export const PROFESSIONAL_VERIFICATION_STATUSES = [
  'pendente',
  'em_revisao',
  'aprovada',
  'retida_duplicidade',
  'recusada',
  'suspensa',
] as const;
export type ProfessionalVerificationStatus = (typeof PROFESSIONAL_VERIFICATION_STATUSES)[number];

export type EligibilityDenial = 'conta_indisponivel' | 'email_nao_verificado' | 'verificacao_nao_aprovada';

export type ProfessionalEligibility =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EligibilityDenial };

export interface ProfessionalEligibilityInput {
  /** Conta do usuario ativa (app_user.status = 'ativo'). */
  readonly active: boolean;
  /** E-mail verificado (app_user.email_verified_at nao nulo). */
  readonly emailVerified: boolean;
  /** Estado da verificacao; nulo quando nao ha perfil profissional. */
  readonly status: ProfessionalVerificationStatus | null;
}

/** Publicar e aceitar so com conta ativa, e-mail verificado e verificacao 'aprovada' (33 §8). */
export function professionalEligibility(input: ProfessionalEligibilityInput): ProfessionalEligibility {
  if (!input.active) return { allowed: false, reason: 'conta_indisponivel' };
  if (!input.emailVerified) return { allowed: false, reason: 'email_nao_verificado' };
  if (input.status !== 'aprovada') return { allowed: false, reason: 'verificacao_nao_aprovada' };
  return { allowed: true };
}

/** Codigos de explicacao (nunca texto). [PROPOSTA] exceto 'human_review_no_deadline', fixado no desenho §8. */
export const PROFESSIONAL_EXPLANATION_CODES: Readonly<Record<ProfessionalVerificationStatus, string>> = {
  pendente: 'human_review_no_deadline',
  em_revisao: 'human_review_no_deadline',
  aprovada: 'approved',
  retida_duplicidade: 'duplicate_review',
  recusada: 'refused',
  suspensa: 'suspended',
};

export interface ProfessionalMeBody {
  readonly access_level: 'full' | 'verification_only';
  readonly email_verified: boolean;
  readonly verification: { readonly status: ProfessionalVerificationStatus; readonly explanation_code: string };
}

/** Corpo de GET /v1/professional/me (CA-H016-10, CA-H016-21). Sem e-mail, senha ou token. */
export function professionalMeBody(input: {
  readonly emailVerified: boolean;
  readonly status: ProfessionalVerificationStatus;
}): ProfessionalMeBody {
  return {
    access_level: input.emailVerified ? 'full' : 'verification_only',
    email_verified: input.emailVerified,
    verification: {
      status: input.status,
      explanation_code: PROFESSIONAL_EXPLANATION_CODES[input.status],
    },
  };
}
