// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §5.2) | Composicao da fila de verificacao. So monta com os
// NOMES presentes: DATABASE_URL_APP_SYSTEM (papel app_system), ADMIN_BASE_URL, SUPABASE_URL e a credencial
// somente de leitura do bucket de documentos finais (IDENTITY_DOCS_READER_KEY, pergunta 402). Sem qualquer um
// deles, ou sem a fabrica da borda, devolve undefined e as rotas seguem inexistentes (404 uniforme).
import { PgAdminSessionRepository, type SqlClient } from '@fastpro/db';
import type { AdminVerificationRouteOptions } from '../admin-verification-route.js';
import { PgIdentityDocReviewReader, type LeituraFinalStorage } from './pg-identity-doc-review-reader.js';
import { PgVerificationCasePort } from './pg-verification-case-store.js';
import type { TransacaoSql } from './pg-transacao.js';

/** Nomes de ambiente exigidos pela rota. Os valores nunca sao registrados. */
export const VERIFICACAO_ENV_OBRIGATORIAS = [
  'DATABASE_URL_APP_SYSTEM',
  'ADMIN_BASE_URL',
  'SUPABASE_URL',
  'IDENTITY_DOCS_READER_KEY',
] as const;

export interface VerificacaoEnv {
  readonly DATABASE_URL_APP_SYSTEM?: string;
  readonly ADMIN_BASE_URL?: string;
  readonly SUPABASE_URL?: string;
  readonly IDENTITY_DOCS_READER_KEY?: string;
}

export interface VerificacaoOpcoes {
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  readonly abrirTransacao?: (connectionString: string) => TransacaoSql;
  readonly relogio?: { nowMs(): number };
  readonly fetchImpl?: typeof fetch;
}

/** Leitura do objeto final (bucket identity-docs) com a credencial do leitor. Sem URL publica devolvida. */
export function storageLeituraFinal(baseUrl: string, chaveLeitor: string, fetchImpl: typeof fetch = fetch): LeituraFinalStorage {
  return {
    async lerBytes(objeto: string, timeoutMs: number): Promise<Uint8Array | null> {
      const res = await fetchImpl(`${baseUrl}/storage/v1/object/identity-docs/${objeto}`, {
        headers: { Authorization: `Bearer ${chaveLeitor}`, apikey: chaveLeitor },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('storage_leitura_falhou');
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Opcoes da rota de verificacao, ou undefined quando faltar qualquer nome ou fabrica. */
export function montarVerificacao(
  env: VerificacaoEnv,
  opcoes: VerificacaoOpcoes = {},
): AdminVerificationRouteOptions | undefined {
  const url = env.DATABASE_URL_APP_SYSTEM;
  const baseUrl = env.ADMIN_BASE_URL;
  const supabase = env.SUPABASE_URL;
  const chaveLeitor = env.IDENTITY_DOCS_READER_KEY;
  if (!url || !baseUrl || !supabase || !chaveLeitor) return undefined;
  if (opcoes.abrirCliente === undefined || opcoes.abrirTransacao === undefined) return undefined;

  const cliente = opcoes.abrirCliente(url);
  const sessao = new PgAdminSessionRepository(cliente);
  const transacao = opcoes.abrirTransacao(url);
  const storage = storageLeituraFinal(supabase, chaveLeitor, opcoes.fetchImpl);
  return {
    guard: (secret, nowMs) => sessao.guard(secret, nowMs),
    baseUrl,
    clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    casos: new PgVerificationCasePort(cliente),
    leitor: (ctx, caseId, motivo, now) =>
      new PgIdentityDocReviewReader({ transacao, storage, ctx, caseId, motivo, now }),
  };
}
