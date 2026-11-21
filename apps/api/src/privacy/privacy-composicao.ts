// Issue 120 (H-111) | Montagem das rotas do titular a partir do ambiente (147-DESENHO-H111 §3, §5.1).
// Liga so com DATABASE_URL_APP_SYSTEM (papel app_system) e a fabrica do cliente SQL. Sem eles, a rota nao e montada
// (404 uniforme). Nunca le, grava nem registra o valor da URL: a pendencia leva so o nome.
import type { ClockPort, EmailProviderPort } from '@fastpro/domain';
import {
  loadChallengeKey,
  PgDsrDownloadSql,
  PgDsrStepUpSql,
  PgSessionRepository,
  ServicoDownloadExtrato,
  ServicoDsrStepUp,
  SupabaseStorageExtratos,
  type SqlClient,
} from '@fastpro/db';
import type { WaitUntil } from '../challenge-dispatch.js';
import { comEnvioStepUp, type EnvioStepUpOpcoes } from './dsr-stepup-envio.js';
import type { PrivacyTitularRouteOptions } from './titular-route.js';
import { PgDsrTitularSql, ServicoDsrTitular } from './titular-service.js';

const DATABASE_URL_NOME = 'DATABASE_URL_APP_SYSTEM';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface PrivacidadeTitularOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
  /** Provedor de e-mail real do codigo do step-up (P-C). Sem ele, a linha de saida fica pendente. */
  readonly email?: EmailProviderPort;
  /** Primitiva pos-resposta da plataforma para o envio do codigo (sem ela, nada e agendado). */
  readonly waitUntil?: WaitUntil;
}

export interface PrivacidadeTitularMontagem {
  readonly options: PrivacyTitularRouteOptions | undefined;
  /** Nomes (nunca valores) que impedem as rotas de ligar. */
  readonly pendencias: readonly string[];
}

const clientes = new Map<string, SqlClient>();

/** Um cliente por URL do papel app_system, compartilhado pelas rotas do titular e do DPO. */
export function clienteDe(url: string, abrirCliente: (connectionString: string) => SqlClient): SqlClient {
  let cliente = clientes.get(url);
  if (cliente === undefined) {
    cliente = abrirCliente(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

export function montarPrivacidadeTitular(
  env: Ambiente,
  opcoes: PrivacidadeTitularOpcoes = {},
): PrivacidadeTitularMontagem {
  const pendencias: string[] = [];
  const url = (env[DATABASE_URL_NOME] ?? '').trim();
  if (url === '') pendencias.push(DATABASE_URL_NOME);
  if (opcoes.abrirCliente === undefined) {
    pendencias.push('fabrica do cliente SQL das rotas do titular (ainda nao montada na funcao)');
  }
  if (pendencias.length > 0 || opcoes.abrirCliente === undefined) return { options: undefined, pendencias };
  const relogio = opcoes.relogio ?? { nowMs: () => Date.now() };
  const cliente = clienteDe(url, opcoes.abrirCliente);
  // P-A: step-up e download sao opcionais. Sem as variaveis, as rotas novas respondem 404 e as demais seguem.
  const envioCodigo =
    opcoes.email === undefined
      ? undefined
      : {
          email: opcoes.email,
          relogio: { nowMs: () => relogio.nowMs(), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } satisfies ClockPort,
          ...(opcoes.waitUntil !== undefined ? { waitUntil: opcoes.waitUntil } : {}),
        };
  const stepUp = montarStepUp(env, cliente, envioCodigo);
  const download = montarDownload(env, cliente);
  return {
    options: {
      sessions: new PgSessionRepository(cliente),
      service: new ServicoDsrTitular(new PgDsrTitularSql(cliente), download),
      relogio,
      ...(stepUp !== undefined ? { stepUp } : {}),
      ...(download !== undefined ? { download } : {}),
    },
    pendencias,
  };
}

/** Step-up do titular: exige AUTH_CHALLENGE_KEY (32 bytes) e PEPPER_CODE_HMAC. Sem eles, nao e montado. */
export function montarStepUp(
  env: Ambiente,
  cliente: SqlClient,
  envio?: Omit<EnvioStepUpOpcoes, 'client' | 'metrica'>,
): Pick<ServicoDsrStepUp, 'emitir' | 'confirmar'> | undefined {
  let chave: Buffer;
  try {
    chave = loadChallengeKey(env);
  } catch {
    return undefined;
  }
  let servico: ServicoDsrStepUp;
  try {
    servico = new ServicoDsrStepUp({ sql: new PgDsrStepUpSql(cliente), chave, pepperCodigo: env.PEPPER_CODE_HMAC ?? '' });
  } catch {
    return undefined;
  }
  // P-C: com provedor de e-mail, a emissao agenda o envio do codigo pelo pipeline; sem ele, a linha fica pendente.
  return envio === undefined ? servico : comEnvioStepUp(servico, { client: cliente, ...envio });
}

/** Download do extrato: exige SUPABASE_URL, SUPABASE_SECRET_KEY e DSR_EXTRATO_CHAVE_ASSINATURA (mesma do gerador). */
export function montarDownload(env: Ambiente, cliente: SqlClient): ServicoDownloadExtrato | undefined {
  const url = (env.SUPABASE_URL ?? '').trim();
  const secretKey = env.SUPABASE_SECRET_KEY ?? '';
  if (url === '' || secretKey === '') return undefined;
  try {
    return new ServicoDownloadExtrato({
      sql: new PgDsrDownloadSql(cliente),
      arquivos: new SupabaseStorageExtratos({ url, secretKey }),
      chaveAssinatura: env.DSR_EXTRATO_CHAVE_ASSINATURA ?? '',
    });
  } catch {
    return undefined;
  }
}

