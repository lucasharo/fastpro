// Issue 120 (H-111) | Servico do DPO sobre os direitos do titular (147-DESENHO-H111 §4.2, §5.2).
// Chama somente as funcoes app.dsr_* com o ator ja autenticado pela guarda do painel (papel app_system).
// A permissao da rota e checada antes; a funcao SQL revalida o papel e recusa o operador que e o proprio titular.
// Erros do banco viram DsrDpoErro com codigo fixo. Nenhuma nota interna nem conteudo de extrato sai daqui.
import type { SqlClient } from '@fastpro/db';

export const DSR_KINDS_DPO = ['acesso', 'correcao', 'eliminacao'] as const;
/** Unico canal aceito na abertura assistida (147 §4.2, coluna channel). */
export const DSR_CANAL_ASSISTIDO = 'dpo_externo' as const;

export interface FiltrosDpo {
  readonly status: string | null;
  readonly kind: string | null;
  readonly prazo: string | null;
  readonly assignedTo: string | null;
}

export interface EntradaAberturaDpo {
  readonly subject: string;
  readonly kind: string;
  readonly details: Record<string, unknown>;
  readonly channel: string;
}

export interface DsrDpoSql {
  listar(
    actor: string,
    filtros: FiltrosDpo,
    limite: number,
    cursor: { readonly abertura: string; readonly id: string } | null,
  ): Promise<Record<string, unknown>[]>;
  obter(actor: string, caso: string): Promise<unknown>;
  abrir(actor: string, entrada: EntradaAberturaDpo): Promise<Record<string, unknown>>;
  atribuir(actor: string, caso: string, responsavel: string): Promise<Record<string, unknown>>;
  processar(actor: string, caso: string): Promise<Record<string, unknown>>;
  recusar(
    actor: string,
    caso: string,
    decisao: { readonly note: string; readonly partial: boolean; readonly outcome: string },
  ): Promise<Record<string, unknown>>;
}

/** Porta de banco sobre o papel app_system. Uma funcao SQL por chamada; nenhuma consulta direta a tabela. */
export class PgDsrDpoSql implements DsrDpoSql {
  constructor(private readonly cliente: SqlClient) {}

  async listar(
    actor: string,
    filtros: FiltrosDpo,
    limite: number,
    cursor: { readonly abertura: string; readonly id: string } | null,
  ): Promise<Record<string, unknown>[]> {
    const r = await this.cliente.query(
      'select * from app.dsr_admin_list($1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::integer, $7::timestamptz, $8::uuid)',
      [actor, filtros.status, filtros.kind, filtros.prazo, filtros.assignedTo, limite, cursor?.abertura ?? null, cursor?.id ?? null],
    );
    return r.rows;
  }

  async obter(actor: string, caso: string): Promise<unknown> {
    const r = await this.cliente.query('select app.dsr_admin_get($1::uuid, $2::uuid) as caso', [actor, caso]);
    return (r.rows[0] as { caso?: unknown } | undefined)?.caso ?? null;
  }

  async abrir(actor: string, e: EntradaAberturaDpo): Promise<Record<string, unknown>> {
    const r = await this.cliente.query(
      'select * from app.dsr_open_assisted($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::text)',
      [actor, e.subject, e.kind, JSON.stringify(e.details), e.channel],
    );
    return r.rows[0] ?? {};
  }

  async atribuir(actor: string, caso: string, responsavel: string): Promise<Record<string, unknown>> {
    const r = await this.cliente.query('select * from app.dsr_assign($1::uuid, $2::uuid, $3::uuid)', [actor, caso, responsavel]);
    return r.rows[0] ?? {};
  }

  async processar(actor: string, caso: string): Promise<Record<string, unknown>> {
    const r = await this.cliente.query('select * from app.dsr_process($1::uuid, $2::uuid)', [actor, caso]);
    return r.rows[0] ?? {};
  }

  async recusar(
    actor: string,
    caso: string,
    d: { readonly note: string; readonly partial: boolean; readonly outcome: string },
  ): Promise<Record<string, unknown>> {
    const r = await this.cliente.query('select * from app.dsr_reject($1::uuid, $2::uuid, $3::text, $4::boolean, $5::text)', [
      actor,
      caso,
      d.note,
      d.partial,
      d.outcome,
    ]);
    return r.rows[0] ?? {};
  }
}

/** Erro de contrato da API: status HTTP e corpo fixo (codigo, sem detalhe interno). */
export class DsrDpoErro extends Error {
  constructor(
    readonly status: number,
    readonly corpo: Readonly<Record<string, unknown>>,
  ) {
    super(String(corpo.code));
  }
}

/** Status por mensagem de excecao das funcoes app.dsr_* do DPO. Mensagem fora da lista vira 503 na rota. */
const STATUS_POR_ERRO: Readonly<Record<string, number>> = {
  permissao_negada: 403,
  conta_nao_ativa: 403,
  conta_nao_encontrada: 403,
  dsr_operador_e_titular: 403,
  dsr_nao_encontrado: 404,
  dsr_em_andamento: 409,
  pedido_em_andamento: 409,
  dsr_nao_atribuivel: 409,
  dsr_nao_deferido: 409,
  dsr_nao_deferivel: 409,
  dsr_nao_indeferivel: 409,
  dsr_acesso_usa_extrato: 409,
  dsr_pre_requisito_ausente: 409,
  correcao_pendente_de_implementacao: 409,
  correcao_aplicacao_pendente: 409,
  correcao_sem_alteracao: 409,
  campo_nao_corrigivel: 422,
  canal_invalido: 422,
  desfecho_invalido: 422,
  detalhes_invalidos: 422,
  dsr_entrada_invalida: 422,
  dsr_tipo_invalido: 422,
  dsr_responsavel_invalido: 422,
  kind_nao_suportado: 422,
  filtro_invalido: 422,
  filtro_nao_permitido: 422,
  cursor_invalido: 422,
  janela_invalida: 422,
  identity_check_obrigatorio: 422,
  operador_obrigatorio: 422,
  titular_obrigatorio: 422,
  nota_base_legal_obrigatoria: 422,
};

/** Traduz a mensagem da funcao SQL. Mensagem desconhecida devolve undefined (a rota responde 503 fixo). */
export function traduzirErroDpo(erro: unknown): DsrDpoErro | undefined {
  const e = erro as { message?: unknown; detail?: unknown } | null;
  const mensagem = typeof e?.message === 'string' ? e.message : '';
  const status = STATUS_POR_ERRO[mensagem];
  if (status === undefined) return undefined;
  if (mensagem === 'dsr_em_andamento') {
    const protocolo = typeof e?.detail === 'string' ? e.detail : null;
    return new DsrDpoErro(status, { code: mensagem, protocol: protocolo });
  }
  if (mensagem === 'dsr_nao_encontrado') return new DsrDpoErro(status, { code: 'not_found' });
  if (mensagem === 'permissao_negada') return new DsrDpoErro(status, { code: 'permission_denied' });
  return new DsrDpoErro(status, { code: mensagem });
}

/** Renomeia colunas out_* das funcoes para o nome publico (sem o prefixo do retorno SQL). */
function semPrefixo(linha: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(linha)) {
    saida[chave.startsWith('out_') ? chave.slice(4) : chave] = valor;
  }
  return saida;
}

export interface RespostaDpo {
  readonly status: number;
  readonly corpo: unknown;
}

/** Porta do extrato de acesso (GeradorExtratoDsr.gerar). Opcional: sem ela, o caso de acesso segue recusado (409). */
export interface GeradorExtratoPort {
  gerar(ator: string, caso: string): Promise<{ readonly expiresAt: string }>;
}

/** Erro do banco que indica caso de acesso: o extrato (e nao o app.dsr_process) encerra esse caso (147 §4.3). */
const ERRO_ACESSO_USA_EXTRATO = 'dsr_acesso_usa_extrato';

export class ServicoDsrDpo {
  constructor(
    private readonly sql: DsrDpoSql,
    private readonly extrato?: GeradorExtratoPort,
  ) {}

  async listar(
    actor: string,
    filtros: FiltrosDpo,
    limite: number,
    cursor: { readonly abertura: string; readonly id: string } | null,
  ): Promise<RespostaDpo> {
    try {
      const linhas = await this.sql.listar(actor, filtros, limite, cursor);
      const itens = linhas.map(semPrefixo);
      const ultima = itens.at(-1);
      return {
        status: 200,
        corpo: {
          itens,
          proximo_cursor:
            itens.length === limite && ultima !== undefined
              ? { abertura: ultima.opened_at, id: ultima.case_id }
              : null,
        },
      };
    } catch (erro) {
      throw traduzirErroDpo(erro) ?? erro;
    }
  }

  async obter(actor: string, caso: string): Promise<RespostaDpo> {
    try {
      const detalhe = await this.sql.obter(actor, caso);
      if (detalhe === null || detalhe === undefined) throw new DsrDpoErro(404, { code: 'not_found' });
      return { status: 200, corpo: detalhe };
    } catch (erro) {
      throw traduzirErroDpo(erro) ?? erro;
    }
  }

  async abrir(actor: string, entrada: EntradaAberturaDpo): Promise<RespostaDpo> {
    try {
      const linha = semPrefixo(await this.sql.abrir(actor, entrada));
      return {
        status: 201,
        corpo: { id: linha.case_id, protocol: linha.protocol, status: linha.status, deadline_at: linha.deadline_at },
      };
    } catch (erro) {
      throw traduzirErroDpo(erro) ?? erro;
    }
  }

  async atribuir(actor: string, caso: string, responsavel: string): Promise<RespostaDpo> {
    try {
      const linha = semPrefixo(await this.sql.atribuir(actor, caso, responsavel));
      return { status: 200, corpo: { id: linha.case_id, status: linha.status, assigned_to: linha.assigned_to } };
    } catch (erro) {
      throw traduzirErroDpo(erro) ?? erro;
    }
  }

  async processar(actor: string, caso: string): Promise<RespostaDpo> {
    try {
      const linha = semPrefixo(await this.sql.processar(actor, caso));
      return { status: 200, corpo: { id: linha.case_id, status: linha.status, outcome: linha.outcome } };
    } catch (erro) {
      // Caso de acesso: app.dsr_process recusa antes de qualquer efeito; o extrato gerado pela API encerra o caso.
      const extrato = this.extrato;
      if (extrato !== undefined && mensagemDe(erro) === ERRO_ACESSO_USA_EXTRATO) {
        return processarAcesso(extrato, actor, caso);
      }
      throw traduzirErroDpo(erro) ?? erro;
    }
  }

  async recusar(
    actor: string,
    caso: string,
    decisao: { readonly note: string; readonly partial: boolean; readonly outcome: string },
  ): Promise<RespostaDpo> {
    try {
      const linha = semPrefixo(await this.sql.recusar(actor, caso, decisao));
      return { status: 200, corpo: { id: linha.case_id, status: linha.status, closed_at: linha.closed_at } };
    } catch (erro) {
      throw traduzirErroDpo(erro) ?? erro;
    }
  }
}

function mensagemDe(erro: unknown): string {
  const e = erro as { message?: unknown } | null;
  return typeof e?.message === 'string' ? e.message : '';
}

/** Gera, grava e registra o extrato (app.dsr_admin_generate_extract + Storage + app.dsr_register_extract). */
async function processarAcesso(extrato: GeradorExtratoPort, actor: string, caso: string): Promise<RespostaDpo> {
  try {
    const gerado = await extrato.gerar(actor, caso);
    return {
      status: 200,
      corpo: { id: caso, status: 'concluido', outcome: 'extrato_disponibilizado', expires_at: gerado.expiresAt },
    };
  } catch (erro) {
    throw traduzirErroDpo(erro) ?? erro;
  }
}
