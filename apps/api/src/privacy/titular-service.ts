// Issue 120 (H-111) | Servico do titular: abertura, listagem, leitura e cancelamento do direito (147-DESENHO-H111 §4.1, §5.1).
// Chama somente as funcoes SQL app.dsr_open, app.dsr_list_own, app.dsr_get_own e app.dsr_cancel (papel app_system).
// O titular e sempre o da sessao; o corpo nunca informa o sujeito. Erros do banco viram DsrTitularErro com o codigo
// do desenho §5.1. Nada de corpo, token ou nota interna em log. Token de step-up so entra aqui como hash SHA-256.
import { createHash } from 'node:crypto';
import type { SqlClient } from '@fastpro/db';

export const DSR_KINDS_TITULAR = ['acesso', 'correcao', 'eliminacao'] as const;

export interface DsrTitularSql {
  abrir(entrada: {
    readonly sujeito: string;
    readonly kind: string;
    readonly detalhes: Record<string, unknown>;
    readonly stepUpHash: string | null;
    readonly chave: string;
  }): Promise<Record<string, unknown>>;
  listar(entrada: {
    readonly sujeito: string;
    readonly limite: number;
    readonly cursorAbertura: string | null;
    readonly cursorId: string | null;
  }): Promise<Record<string, unknown>[]>;
  obter(sujeito: string, caso: string): Promise<Record<string, unknown> | undefined>;
  cancelar(sujeito: string, caso: string): Promise<Record<string, unknown>>;
}

/** Porta de banco sobre o papel app_system. Cada chamada e uma funcao SQL; nenhuma consulta direta a tabela. */
export class PgDsrTitularSql implements DsrTitularSql {
  constructor(private readonly cliente: SqlClient) {}

  async abrir(e: {
    readonly sujeito: string;
    readonly kind: string;
    readonly detalhes: Record<string, unknown>;
    readonly stepUpHash: string | null;
    readonly chave: string;
  }): Promise<Record<string, unknown>> {
    const r = await this.cliente.query('select * from app.dsr_open($1, $2, $3::jsonb, $4, $5)', [
      e.sujeito,
      e.kind,
      JSON.stringify(e.detalhes),
      e.stepUpHash,
      e.chave,
    ]);
    return r.rows[0] ?? {};
  }

  async listar(e: {
    readonly sujeito: string;
    readonly limite: number;
    readonly cursorAbertura: string | null;
    readonly cursorId: string | null;
  }): Promise<Record<string, unknown>[]> {
    const r = await this.cliente.query('select * from app.dsr_list_own($1, $2, $3::timestamptz, $4::uuid)', [
      e.sujeito,
      e.limite,
      e.cursorAbertura,
      e.cursorId,
    ]);
    return r.rows;
  }

  async obter(sujeito: string, caso: string): Promise<Record<string, unknown> | undefined> {
    const r = await this.cliente.query('select * from app.dsr_get_own($1, $2)', [sujeito, caso]);
    return r.rows[0];
  }

  async cancelar(sujeito: string, caso: string): Promise<Record<string, unknown>> {
    const r = await this.cliente.query('select * from app.dsr_cancel($1, $2)', [caso, sujeito]);
    return r.rows[0] ?? {};
  }
}

/** Erro de contrato da API: status HTTP e corpo fixo (codigo, sem detalhe interno). */
export class DsrTitularErro extends Error {
  constructor(
    readonly status: number,
    readonly corpo: Readonly<Record<string, unknown>>,
  ) {
    super(String(corpo.code));
  }
}

/** Traduz a mensagem da funcao SQL para o contrato §5.1. Mensagem desconhecida devolve undefined (vira 503). */
export function traduzirErroBanco(erro: unknown): DsrTitularErro | undefined {
  const e = erro as { message?: unknown; detail?: unknown; code?: unknown } | null;
  const mensagem = typeof e?.message === 'string' ? e.message : '';
  const detalhe = typeof e?.detail === 'string' ? e.detail : undefined;
  switch (mensagem) {
    case 'step_up_obrigatorio':
      return new DsrTitularErro(403, { code: 'step_up_obrigatorio' });
    case 'dsr_em_andamento':
      return new DsrTitularErro(409, { code: 'dsr_em_andamento', protocol: detalhe ?? null });
    case 'pedido_em_andamento':
      return new DsrTitularErro(409, { code: 'pedido_em_andamento' });
    case 'dsr_carencia':
      return new DsrTitularErro(429, { code: 'dsr_carencia', carencia_ate: detalhe ?? null });
    case 'dsr_limite_diario':
      return new DsrTitularErro(429, { code: 'dsr_limite_diario' });
    case 'kind_nao_suportado':
    case 'cursor_invalido':
      return new DsrTitularErro(422, { code: mensagem });
    case 'idempotencia_invalida':
    case 'detalhes_invalidos':
      return new DsrTitularErro(422, { code: mensagem });
    case 'idempotencia_conflito':
    case 'idempotencia_em_andamento':
      return new DsrTitularErro(409, { code: mensagem });
    case 'conta_nao_ativa':
    case 'conta_nao_encontrada':
      return new DsrTitularErro(403, { code: mensagem });
    case 'dsr_nao_encontrado':
      return new DsrTitularErro(404, { code: 'nao_encontrado' });
    case 'dsr_nao_cancelavel':
      return new DsrTitularErro(409, { code: 'dsr_nao_cancelavel' });
    default:
      break;
  }
  // Violacao de CHECK (ex.: tamanho de detalhes): entrada invalida, sem detalhe do banco.
  if (e?.code === '23514') return new DsrTitularErro(422, { code: 'dados_invalidos' });
  return undefined;
}

export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function dtoResumo(linha: Record<string, unknown>): Record<string, unknown> {
  return {
    id: linha.out_case_id,
    protocol: linha.out_protocol,
    kind: linha.out_kind,
    status: linha.out_status,
    opened_at: linha.out_opened_at,
    deadline_at: linha.out_deadline_at,
    closed_at: linha.out_closed_at,
    outcome: linha.out_outcome ?? null,
  };
}

function dtoDetalhe(linha: Record<string, unknown>): Record<string, unknown> {
  const status = String(linha.out_status);
  return {
    ...dtoResumo(linha),
    // Fundamentacao visivel ao titular apenas em indeferimento (desenho §4.1). Notas internas nunca saem daqui.
    fundamentacao: status.startsWith('indeferido') ? (linha.out_legal_basis_note ?? null) : null,
    linha_do_tempo: linha.out_timeline ?? [],
    // Download do extrato: a URL assinada e a rota de consumo ficam fora desta entrega (ver pendencias).
    extrato: linha.out_extract_expires_at ? { expires_at: linha.out_extract_expires_at } : null,
  };
}

export interface EntradaAbertura {
  readonly kind: string;
  readonly detalhes: Record<string, unknown>;
  readonly stepUpToken: string | null;
}

export interface RespostaServico {
  readonly status: number;
  readonly corpo: Record<string, unknown>;
}

export class ServicoDsrTitular {
  constructor(private readonly sql: DsrTitularSql) {}

  async abrir(sujeito: string, entrada: EntradaAbertura, chave: string): Promise<RespostaServico> {
    try {
      const linha = await this.sql.abrir({
        sujeito,
        kind: entrada.kind,
        detalhes: entrada.detalhes,
        stepUpHash: entrada.stepUpToken === null ? null : sha256Hex(entrada.stepUpToken),
        chave,
      });
      const deduplicated = linha.out_deduplicated === true;
      return {
        status: deduplicated ? 200 : 201,
        corpo: {
          id: linha.out_case_id,
          protocol: linha.out_protocol,
          kind: entrada.kind,
          status: linha.out_status,
          deadline_at: linha.out_deadline_at,
          deduplicated,
        },
      };
    } catch (erro) {
      throw traduzirErroBanco(erro) ?? erro;
    }
  }

  async listar(
    sujeito: string,
    limite: number,
    cursor: { readonly abertura: string; readonly id: string } | null,
  ): Promise<RespostaServico> {
    try {
      const linhas = await this.sql.listar({
        sujeito,
        limite,
        cursorAbertura: cursor?.abertura ?? null,
        cursorId: cursor?.id ?? null,
      });
      const ultima = linhas.at(-1);
      return {
        status: 200,
        corpo: {
          itens: linhas.map(dtoResumo),
          proximo_cursor:
            linhas.length === limite && ultima !== undefined
              ? { abertura: ultima.out_opened_at, id: ultima.out_case_id }
              : null,
        },
      };
    } catch (erro) {
      throw traduzirErroBanco(erro) ?? erro;
    }
  }

  async obter(sujeito: string, caso: string): Promise<RespostaServico> {
    try {
      const linha = await this.sql.obter(sujeito, caso);
      if (linha === undefined) throw new DsrTitularErro(404, { code: 'nao_encontrado' });
      return { status: 200, corpo: dtoDetalhe(linha) };
    } catch (erro) {
      throw traduzirErroBanco(erro) ?? erro;
    }
  }

  async cancelar(sujeito: string, caso: string): Promise<RespostaServico> {
    try {
      const linha = await this.sql.cancelar(sujeito, caso);
      return {
        status: 200,
        corpo: {
          id: linha.out_case_id,
          protocol: linha.out_protocol,
          status: linha.out_status,
          closed_at: linha.out_closed_at,
        },
      };
    } catch (erro) {
      throw traduzirErroBanco(erro) ?? erro;
    }
  }
}
