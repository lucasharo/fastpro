// Issue 120 (H-111) | Handlers dos jobs dos direitos do titular (docs/factory/147-DESENHO-H111.md §4.4; fatia 8).
// Tres kinds no JobRegistry: dsr.process_auto (eliminacao automatica), dsr.auth_cleanup (remocao do usuario no
// Supabase Auth depois da anonimizacao) e dsr.export_purge (expurgo do extrato no vencimento). Cada handler e
// idempotente e so chama funcoes app.dsr_job_* (SECURITY DEFINER, so app_system). Storage e Auth entram por porta;
// o SQL vem de SqlClient. Nenhum dado pessoal, caminho ou chave entra em mensagem de erro ou log: a falha usa so
// o nome da classe de erro (errorCodeOf), que vira o codigo registrado na fila.
// Nenhum e-mail e enviado aqui: o aviso de indeferimento ja e uma linha de ops.email_outbox (fatia 8, P5).
import { registerJobHandler, type JobContext, type JobHandler, type JobRegistry, type SqlClient } from './jobs-tick.js';

export const DSR_PROCESS_AUTO_KIND = 'dsr.process_auto';
export const DSR_AUTH_CLEANUP_KIND = 'dsr.auth_cleanup';
export const DSR_EXPORT_PURGE_KIND = 'dsr.export_purge';
/** Bucket privado dos extratos (criado na fatia 2). Nunca publico. */
export const DSR_EXTRATOS_BUCKET = 'dsr-exports';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caminho do extrato: segmentos simples, sem barra inicial e sem "..". Violacao vira falha sem mostrar o caminho. */
const CAMINHO_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** Resultados de app.dsr_job_process_auto que ja encerram o job (nada a repetir). */
const RESULTADOS_PROCESSO_AUTO: ReadonlySet<string> = new Set([
  'processado',
  'ja_anonimizado',
  'ja_encerrado',
  'nao_elegivel',
  'nao_encontrado',
]);

/** Falhas com classe propria: o nome da classe vira o codigo do job (errorCodeOf). Sem dado pessoal na mensagem. */
export class DsrPayloadInvalido extends Error {}
export class DsrRetornoDesconhecido extends Error {}
export class DsrExtratoAindaValido extends Error {}
export class DsrExtratoCaminhoInvalido extends Error {}
export class DsrExtratoStorageFalha extends Error {}
export class DsrExpurgoNaoMarcado extends Error {}

export interface DsrAlvoLimpezaAuth {
  readonly status: string;
  readonly authUserId: string | null;
}

export interface DsrAlvoExpurgo {
  readonly status: string;
  readonly storagePath: string | null;
}

/** Porta SQL dos jobs (implementada por PgDsrJobsStore; em testes, por um fake). */
export interface DsrJobsStorePort {
  processoAuto(caso: string): Promise<string>;
  alvoLimpezaAuth(usuario: string): Promise<DsrAlvoLimpezaAuth>;
  alvoExpurgo(caso: string): Promise<DsrAlvoExpurgo>;
  marcarExpurgado(caso: string): Promise<string>;
}

/** Porta de Auth: o SupabaseAuthGateway (deleteUser trata 404 como ja removido) satisfaz esta forma. */
export interface DsrAuthUsuariosPort {
  deleteUser(authUserId: string): Promise<void>;
}

/** Porta de Storage dos extratos. remover deve ser idempotente (objeto ausente = sucesso). */
export interface DsrExtratosArquivosPort {
  remover(caminho: string): Promise<void>;
}

/** Acesso SQL dos jobs. Todas as chamadas usam funcoes app.dsr_job_* (nunca SELECT direto em tabela do titular). */
export class PgDsrJobsStore implements DsrJobsStorePort {
  constructor(private readonly client: SqlClient) {}

  async processoAuto(caso: string): Promise<string> {
    const res = await this.client.query('select app.dsr_job_process_auto($1::uuid) as resultado', [caso]);
    const linha = res.rows[0] as { resultado?: unknown } | undefined;
    return typeof linha?.resultado === 'string' ? linha.resultado : 'desconhecido';
  }

  async alvoLimpezaAuth(usuario: string): Promise<DsrAlvoLimpezaAuth> {
    const res = await this.client.query(
      'select out_status, out_auth_user_id from app.dsr_job_auth_cleanup_target($1::uuid)',
      [usuario],
    );
    const linha = res.rows[0] as { out_status?: string; out_auth_user_id?: string | null } | undefined;
    return {
      status: linha?.out_status ?? 'nao_encontrado',
      authUserId: linha?.out_auth_user_id ?? null,
    };
  }

  async alvoExpurgo(caso: string): Promise<DsrAlvoExpurgo> {
    const res = await this.client.query(
      'select out_status, out_storage_path from app.dsr_job_export_target($1::uuid)',
      [caso],
    );
    const linha = res.rows[0] as { out_status?: string; out_storage_path?: string | null } | undefined;
    return {
      status: linha?.out_status ?? 'nao_encontrado',
      storagePath: linha?.out_storage_path ?? null,
    };
  }

  async marcarExpurgado(caso: string): Promise<string> {
    const res = await this.client.query('select app.dsr_job_export_mark_purged($1::uuid) as resultado', [caso]);
    const linha = res.rows[0] as { resultado?: unknown } | undefined;
    return typeof linha?.resultado === 'string' ? linha.resultado : 'desconhecido';
  }
}

/** Storage do bucket privado de extratos, por HTTP com chave de servico (so no servidor). */
export interface SupabaseStorageExtratosOpcoes {
  /** SUPABASE_URL sem barra final. */
  readonly url: string;
  /** Chave secreta do Supabase (SUPABASE_SECRET_KEY). Nunca registrada. */
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
}

export class SupabaseStorageExtratos implements DsrExtratosArquivosPort {
  constructor(private readonly opcoes: SupabaseStorageExtratosOpcoes) {}

  async remover(caminho: string): Promise<void> {
    if (!CAMINHO_RE.test(caminho) || caminho.includes('..')) throw new DsrExtratoCaminhoInvalido();
    const base = this.opcoes.url.replace(/\/+$/, '');
    const http = this.opcoes.fetch ?? fetch;
    const alvo = caminho.split('/').map(encodeURIComponent).join('/');
    const res = await http(`${base}/storage/v1/object/${DSR_EXTRATOS_BUCKET}/${alvo}`, {
      method: 'DELETE',
      headers: {
        apikey: this.opcoes.secretKey,
        Authorization: `Bearer ${this.opcoes.secretKey}`,
      },
    });
    // 404 significa que o objeto ja nao existe: a remocao e idempotente.
    if (!res.ok && res.status !== 404) throw new DsrExtratoStorageFalha();
  }
}

/** Handler dsr.process_auto: payload_ref = id do caso. Nao elegivel ou ja encerrado nao e erro (nada muda). */
export class ProcessoAutomaticoHandler implements JobHandler {
  constructor(private readonly store: DsrJobsStorePort) {}

  async run(job: JobContext): Promise<void> {
    const caso = exigeUuid(job.payload_ref);
    const resultado = await this.store.processoAuto(caso);
    if (!RESULTADOS_PROCESSO_AUTO.has(resultado)) throw new DsrRetornoDesconhecido();
  }
}

/**
 * Handler dsr.auth_cleanup: payload_ref = id do usuario anonimizado. So remove o usuario do Auth quando o banco
 * confirma a anonimizacao. Sem identificador de Auth (conta sem login) ou fora de anonimizado: nada a fazer.
 */
export class LimpezaAuthHandler implements JobHandler {
  constructor(
    private readonly store: DsrJobsStorePort,
    private readonly auth: DsrAuthUsuariosPort,
  ) {}

  async run(job: JobContext): Promise<void> {
    const usuario = exigeUuid(job.payload_ref);
    const alvo = await this.store.alvoLimpezaAuth(usuario);
    if (alvo.status !== 'pronto' || alvo.authUserId === null) return;
    await this.auth.deleteUser(alvo.authUserId);
  }
}

/**
 * Handler dsr.export_purge: payload_ref = id do caso. Ordem obrigatoria: apaga o arquivo e so depois marca o
 * extrato como expurgado no banco (se o arquivo falhar, a marca nao acontece e o job tenta de novo).
 * Antes do vencimento a falha e recuperavel (retry com backoff), porque o job roda em expires_at.
 */
export class ExpurgoExtratoHandler implements JobHandler {
  constructor(
    private readonly store: DsrJobsStorePort,
    private readonly arquivos: DsrExtratosArquivosPort,
  ) {}

  async run(job: JobContext): Promise<void> {
    const caso = exigeUuid(job.payload_ref);
    const alvo = await this.store.alvoExpurgo(caso);
    if (alvo.status === 'nao_encontrado' || alvo.status === 'ja_expurgado') return;
    if (alvo.status === 'ainda_valido') throw new DsrExtratoAindaValido();
    if (alvo.status !== 'pronto_para_expurgo' || alvo.storagePath === null) throw new DsrRetornoDesconhecido();
    await this.arquivos.remover(alvo.storagePath);
    const marcado = await this.store.marcarExpurgado(caso);
    if (marcado !== 'expurgado' && marcado !== 'ja_expurgado') throw new DsrExpurgoNaoMarcado();
  }
}

/** Registra os tres handlers da fatia 8 no registro de jobs (chamado pela composicao do app). */
export function registerDsrJobHandlers(
  registry: JobRegistry,
  deps: { readonly store: DsrJobsStorePort; readonly auth: DsrAuthUsuariosPort; readonly arquivos: DsrExtratosArquivosPort },
): void {
  registerJobHandler(registry, DSR_PROCESS_AUTO_KIND, new ProcessoAutomaticoHandler(deps.store));
  registerJobHandler(registry, DSR_AUTH_CLEANUP_KIND, new LimpezaAuthHandler(deps.store, deps.auth));
  registerJobHandler(registry, DSR_EXPORT_PURGE_KIND, new ExpurgoExtratoHandler(deps.store, deps.arquivos));
}

function exigeUuid(valor: string | null): string {
  if (valor === null || !UUID_RE.test(valor)) throw new DsrPayloadInvalido();
  return valor;
}
