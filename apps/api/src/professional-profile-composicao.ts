// H-035 | Montagem das rotas do documento do perfil profissional (PUT/GET /v1/professional/profile) a partir do
// ambiente. So liga com os NOMES presentes, a fabrica de cliente SQL da borda (papel app_system) e a cifra
// carregada (DOCUMENT_HMAC_KEY e DATA_ENC_KEY_*). Sem qualquer um deles, devolve undefined e a rota segue
// inexistente (404). Nunca le, grava nem registra o valor das variaveis: falha de cifra vira so o nome.
import { PgProfessionalProfile, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { loadProfessionalDocumentVault } from './professional-document-crypto.js';
import type { ProfessionalProfileRouteOptions } from './professional-profile-route.js';

/** Variaveis fixas exigidas (nomes). A cifra tem nomes proprios, listados em PERFIL_PROFISSIONAL_CIFRA_NOME. */
export const PERFIL_PROFISSIONAL_ENV_OBRIGATORIAS = ['DATABASE_URL_APP_SYSTEM', 'SITE_URL'] as const;
/** Nome (so o nome) das chaves de cifra e do HMAC, para a lista de pendencias. */
export const PERFIL_PROFISSIONAL_CIFRA_NOME =
  'DOCUMENT_HMAC_KEY, DATA_ENC_KEY_ACTIVE_VERSION e DATA_ENC_KEY_V<n> (ausente ou invalida)';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PerfilProfissionalOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export interface PerfilProfissionalMontagem {
  /** Opcoes das rotas (H-035), ou undefined quando faltar qualquer item. */
  readonly options: ProfessionalProfileRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de ligar. */
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

/** Um cliente por string de conexao (a fabrica da borda abre o pool uma vez por URL). */
function clienteDe(url: string, abrirCliente: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrirCliente(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

function preenchida(env: Ambiente, nome: string): boolean {
  return (env[nome] ?? '').trim() !== '';
}

/** Monta as opcoes de /v1/professional/profile. A cifra e lida uma vez por chamada; erro vira so o nome. */
export function montarPerfilProfissional(
  env: Ambiente,
  opcoes: PerfilProfissionalOpcoes = {},
): PerfilProfissionalMontagem {
  const pendencias: string[] = PERFIL_PROFISSIONAL_ENV_OBRIGATORIAS.filter((nome) => !preenchida(env, nome));
  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL do perfil (ainda nao montada na funcao)');

  let cifra: ReturnType<typeof loadProfessionalDocumentVault> | undefined;
  try {
    cifra = loadProfessionalDocumentVault(env as NodeJS.ProcessEnv);
  } catch {
    pendencias.push(PERFIL_PROFISSIONAL_CIFRA_NOME);
  }

  const url = env.DATABASE_URL_APP_SYSTEM;
  const siteUrl = env.SITE_URL;
  if (pendencias.length > 0 || cifra === undefined || !url || !siteUrl || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }

  const cliente = clienteDe(url, opcoes.abrirCliente);
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      profiles: new PgProfessionalProfile({ client: cliente }),
      secrets: cifra,
      siteUrl,
      clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    },
    pendencias: [],
  };
}
