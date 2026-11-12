// H-035 | Adaptador Pg do cadastro do documento do perfil profissional (docs/factory/75-DESENHO-H035.md §2, §3;
// decisao 54). So chama private.professional_profile_set_document e le o perfil com o papel app_system
// (migracao 20261111420000). O numero nunca chega aqui: a API manda o blob cifrado e o HMAC.
// Nenhum valor de documento, blob ou erro com dados vai para resposta ou log.
import { randomBytes } from 'node:crypto';
import type { ProfessionalDocumentType } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/** Nome do indice de slug unico (migracao 20261111420000). Colisao: quem chama acrescenta sufixo. */
export const PROFESSIONAL_SLUG_CONSTRAINT = 'professional_profile_slug_key';
/** Nome do indice de HMAC entre perfis vivos. Colisao: a funcao grava como retida na repeticao. */
export const PROFESSIONAL_DOCUMENTO_VIVO_CONSTRAINT = 'professional_profile_document_hmac_vivo_key';

const SQL_FIND = `select (u.email_verified_at is not null) as email_verified, p.public_name, p.slug,
  p.document_type, p.verification_status
  from app.professional_profile p join app.app_user u on u.id = p.user_id
  where p.user_id = $1::uuid`;

const SQL_SET =
  'select out_resultado from private.professional_profile_set_document($1::uuid, $2::text, $3::text, $4::text, $5::bytea, $6::text, $7::timestamptz)';

/** Tentativas com sufixo novo do slug (colisao rara: nome igual em cadastros simultaneos). */
const MAX_TENTATIVAS_SLUG = 5;
/** Repeticao unica quando o indice de HMAC escapa (a funcao reconsulta e grava como retida). */
const MAX_TENTATIVAS_HMAC = 2;
/** Parte do slug que sobra para o sufixo: 100 caracteres no total (CHECK de formato). */
const SLUG_BASE_MAX = 93;

export type ProfessionalPgVerificationStatus =
  | 'pendente'
  | 'em_revisao'
  | 'aprovada'
  | 'retida_duplicidade'
  | 'recusada'
  | 'suspensa';

/** Leitura do perfil da conta (formato da porta ProfessionalProfilePort da API). */
export interface ProfessionalProfileDbRecord {
  readonly emailVerified: boolean;
  readonly publicName: string | null;
  readonly slug: string | null;
  readonly documentType: ProfessionalDocumentType | null;
  readonly verificationStatus: ProfessionalPgVerificationStatus;
}

/** Documento ja cifrado e com HMAC (a API calcula; o banco so guarda). */
export interface ProfessionalDocumentDbInput {
  readonly userId: string;
  readonly publicName: string;
  readonly slug: string;
  readonly documentType: ProfessionalDocumentType;
  readonly documentEnc: Buffer;
  readonly documentHmac: string;
  readonly nowMs: number;
}

/** pendente | retida_duplicidade | ja_cadastrado (sem_perfil vira erro: a rota ja confere o perfil antes). */
export type ProfessionalDocumentDbOutcome = 'pendente' | 'retida_duplicidade' | 'ja_cadastrado';

const STATUS_VALIDOS: readonly string[] = [
  'pendente',
  'em_revisao',
  'aprovada',
  'retida_duplicidade',
  'recusada',
  'suspensa',
];

/** Sufixo curto aleatorio (6 caracteres hexadecimais) para o slug em colisao. */
function sufixoAleatorio(): string {
  return randomBytes(3).toString('hex');
}

/** Slug com sufixo: a base e cortada para caber no limite e o resultado continua no formato do CHECK. */
export function slugComSufixo(base: string, sufixo: string): string {
  const raiz = base.replace(/^-+/, '').slice(0, SLUG_BASE_MAX).replace(/-+$/, '') || 'perfil';
  return `${raiz}-${sufixo}`;
}

function violacao(erro: unknown, constraint: string): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const e = erro as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && e.constraint === constraint;
}

function linhaUnica(rows: unknown[]): Record<string, unknown> | undefined {
  return rows[0] as Record<string, unknown> | undefined;
}

export interface PgProfessionalProfileDeps {
  readonly client: SqlClient;
  /** Sufixo do slug em colisao (padrao: 6 hexadecimais aleatorios). Injetado nos testes. */
  readonly sufixo?: () => string;
}

export class PgProfessionalProfile {
  private readonly sufixo: () => string;

  constructor(private readonly deps: PgProfessionalProfileDeps) {
    this.sufixo = deps.sufixo ?? sufixoAleatorio;
  }

  /** Perfil da conta da sessao; nulo quando a conta nao tem perfil profissional. */
  async find(userId: string): Promise<ProfessionalProfileDbRecord | null> {
    const res = await this.deps.client.query(SQL_FIND, [userId]);
    const linha = linhaUnica(res.rows);
    if (linha === undefined) return null;
    const status = String(linha.verification_status ?? '');
    if (!STATUS_VALIDOS.includes(status)) throw new Error('status_profissional_invalido');
    const tipo = linha.document_type;
    return {
      emailVerified: linha.email_verified === true,
      publicName: typeof linha.public_name === 'string' ? linha.public_name : null,
      slug: typeof linha.slug === 'string' ? linha.slug : null,
      documentType: tipo === 'CPF' || tipo === 'CNPJ' ? tipo : null,
      verificationStatus: status as ProfessionalPgVerificationStatus,
    };
  }

  /**
   * Grava o documento uma vez. Colisao de slug: tenta de novo com sufixo. Repeticao do indice de HMAC:
   * tenta de novo; a funcao reconsulta a duplicidade e grava como retida_duplicidade. Qualquer outro erro sobe.
   */
  async setDocument(novo: ProfessionalDocumentDbInput): Promise<ProfessionalDocumentDbOutcome> {
    let tentativasSlug = 0;
    let tentativasHmac = 0;
    let slug = novo.slug;
    for (;;) {
      try {
        const res = await this.deps.client.query(SQL_SET, [
          novo.userId,
          novo.publicName,
          slug,
          novo.documentType,
          novo.documentEnc,
          novo.documentHmac,
          new Date(novo.nowMs).toISOString(),
        ]);
        return traduzirResultado(linhaUnica(res.rows)?.out_resultado);
      } catch (erro) {
        if (violacao(erro, PROFESSIONAL_SLUG_CONSTRAINT) && tentativasSlug < MAX_TENTATIVAS_SLUG - 1) {
          tentativasSlug += 1;
          slug = slugComSufixo(novo.slug, this.sufixo());
          continue;
        }
        if (violacao(erro, PROFESSIONAL_DOCUMENTO_VIVO_CONSTRAINT) && tentativasHmac < MAX_TENTATIVAS_HMAC - 1) {
          tentativasHmac += 1;
          continue;
        }
        throw erro;
      }
    }
  }
}

function traduzirResultado(valor: unknown): ProfessionalDocumentDbOutcome {
  if (valor === 'pendente') return 'pendente';
  if (valor === 'retida_duplicidade') return 'retida_duplicidade';
  if (valor === 'ja_cadastrado') return 'ja_cadastrado';
  // sem_perfil e resultado invalido: a rota trata como falha de servico (503), sem detalhe.
  throw new Error('documento_resultado_invalido');
}
