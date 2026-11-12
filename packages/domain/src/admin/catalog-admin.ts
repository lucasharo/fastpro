// H-107 (Issue 116) | Gestao do catalogo pela tela admin (docs/factory/81-DESENHO-H107.md §1 a §5; 77-REFINO-H107.md).
// Logica pura: valida a alteracao ANTES do banco (422 com um motivo por campo), chama uma porta de banco
// (CatalogAdminPort) e mapeia os erros do banco (42501, CT002, CT003, CT004, CT005, 23505, 23503) para
// estado HTTP e campo. Nunca devolve coluna interna (semente, conselho, fonte, sensivel, identificador de ator).
// A autoridade continua no banco (catalog_assert_admin) e na guarda; aqui so se decide a forma da resposta.

import { ADMIN_PERMISSION_DENIED, adminReply, type AdminResponse } from './responses.js';

/** Entidades como o banco as nomeia (catalog_revision.entity). */
export const CATALOG_ENTIDADES = ['group', 'service', 'synonym'] as const;
export type CatalogEntity = (typeof CATALOG_ENTIDADES)[number];

/** Segmento da URL (plural) para a entidade do banco. Qualquer outro segmento nao existe. */
const ENTIDADE_DA_ROTA: Readonly<Record<string, CatalogEntity>> = {
  groups: 'group',
  services: 'service',
  synonyms: 'synonym',
};

export const CATALOG_MODALIDADES = ['presencial', 'online', 'ambos'] as const;

/** Campos aceitos na criacao e na alteracao (espelham as funcoes catalog_*_save, migracao 20261111200000). */
const CAMPOS_CRIACAO: Readonly<Record<CatalogEntity, readonly string[]>> = {
  group: ['name', 'position', 'active'],
  service: ['name', 'group_id', 'modality', 'regulated', 'active'],
  synonym: ['service_id', 'term', 'active'],
};
const CAMPOS_ALTERACAO: Readonly<Record<CatalogEntity, readonly string[]>> = {
  group: ['name', 'position', 'active'],
  service: ['name', 'group_id', 'modality', 'regulated', 'active'],
  synonym: ['term', 'active'],
};
/** Campos que a criacao exige (o banco recusa a ausencia com CT004). */
const CAMPOS_OBRIGATORIOS: Readonly<Record<CatalogEntity, readonly string[]>> = {
  group: ['name', 'position'],
  service: ['name', 'group_id', 'modality', 'regulated'],
  synonym: ['service_id', 'term'],
};
/** Tamanho maximo do texto por campo (mesmos limites de catalog_patch_text). */
const TAMANHO_NOME: Readonly<Record<CatalogEntity, number>> = { group: 80, service: 120, synonym: 80 };
const TAMANHO_TERMO = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSICAO_MAXIMA = 1000000;
const ERRO_LEITURA = 'catalogo_leitura_invalida';

/** Conta da guarda (so o servidor preenche; nunca vem do corpo ou de cabecalho). */
export interface CatalogPrincipal {
  readonly userId: string;
  readonly permissions: readonly string[];
  /** Verdadeiro quando a sessao tem o segundo fator (aal2). A API so chama o manipulador com ele verdadeiro. */
  readonly aal2: boolean;
}

/** Porta do banco (adaptador PgCatalogAdminPort). Erros do banco sobem com o campo `code` (SQLSTATE). */
export interface CatalogAdminPort {
  listar(principal: CatalogPrincipal): Promise<unknown>;
  salvar(
    principal: CatalogPrincipal,
    entidade: CatalogEntity,
    id: string | null,
    expectedVersion: number | null,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<string>;
  revisoes(principal: CatalogPrincipal, entidade: CatalogEntity, id: string): Promise<unknown>;
}

/** Operacao ja casada com a rota pela API (metodo e padrao fixados em ADMIN_ROUTES_H107). */
export type CatalogOperation =
  | { readonly kind: 'listar' }
  | { readonly kind: 'salvar'; readonly entidade: CatalogEntity; readonly id: string | null; readonly corpo: unknown }
  | { readonly kind: 'revisoes'; readonly entidadeRota: string; readonly id: string };

const NAO_ENCONTRADO = adminReply(404, { code: 'not_found' });

type Motivos = Record<string, string>;
type Validacao =
  | { readonly ok: true; readonly expectedVersion: number | null; readonly patch: Record<string, unknown> }
  | { readonly ok: false; readonly resposta: AdminResponse };

function falha(campos: Motivos): Validacao {
  return { ok: false, resposta: adminReply(422, { code: 'dados_invalidos', campos }) };
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Texto aparado com 1..max caracteres; qualquer outro valor e recusado. */
function textoAparado(valor: unknown, max: number): string | null {
  if (typeof valor !== 'string') return null;
  const aparado = valor.trim();
  return aparado.length >= 1 && aparado.length <= max ? aparado : null;
}

/** Valida um campo. Devolve o valor ja normalizado ou o motivo (texto curto, sem valor). */
function validarCampo(entidade: CatalogEntity, campo: string, valor: unknown): { ok: true; valor: unknown } | { ok: false; motivo: string } {
  switch (campo) {
    case 'name': {
      const t = textoAparado(valor, TAMANHO_NOME[entidade]);
      return t === null ? { ok: false, motivo: 'invalido' } : { ok: true, valor: t };
    }
    case 'term': {
      const t = textoAparado(valor, TAMANHO_TERMO);
      return t === null ? { ok: false, motivo: 'invalido' } : { ok: true, valor: t };
    }
    case 'position':
      return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 1 && valor <= POSICAO_MAXIMA
        ? { ok: true, valor }
        : { ok: false, motivo: 'invalido' };
    case 'group_id':
    case 'service_id':
      return typeof valor === 'string' && UUID.test(valor) ? { ok: true, valor } : { ok: false, motivo: 'invalido' };
    case 'modality':
      return (CATALOG_MODALIDADES as readonly unknown[]).includes(valor)
        ? { ok: true, valor }
        : { ok: false, motivo: 'invalido' };
    case 'regulated':
    case 'active':
      return typeof valor === 'boolean' ? { ok: true, valor } : { ok: false, motivo: 'invalido' };
    default:
      return { ok: false, motivo: 'nao_permitido' };
  }
}

/**
 * Valida o corpo de criacao ({patch}) ou de alteracao ({expectedVersion, patch}). Reune todos os motivos
 * de uma vez (um por campo). Criacao sem expectedVersion; alteracao exige expectedVersion inteiro >= 1.
 */
export function validarAlteracaoCatalogo(entidade: CatalogEntity, criacao: boolean, corpo: unknown): Validacao {
  if (!objeto(corpo)) return falha({ corpo: 'objeto_obrigatorio' });
  const patch = corpo.patch;
  if (!objeto(patch)) return falha({ patch: 'objeto_obrigatorio' });

  const motivos: Motivos = {};
  const versao = corpo.expectedVersion;
  let expectedVersion: number | null = null;
  if (criacao) {
    if (versao !== undefined && versao !== null) motivos.expectedVersion = 'nao_aplica';
  } else if (typeof versao === 'number' && Number.isSafeInteger(versao) && versao >= 1) {
    expectedVersion = versao;
  } else {
    motivos.expectedVersion = 'obrigatorio';
  }

  const permitidos = criacao ? CAMPOS_CRIACAO[entidade] : CAMPOS_ALTERACAO[entidade];
  const chaves = Object.keys(patch);
  if (!criacao && chaves.length === 0) motivos.patch = 'vazio';
  for (const chave of chaves) {
    if (permitidos.includes(chave)) continue;
    motivos[chave] = chave === 'service_id' ? 'nao_alteravel' : 'nao_permitido';
  }
  if (criacao) {
    for (const obrigatorio of CAMPOS_OBRIGATORIOS[entidade]) {
      if (!(obrigatorio in patch)) motivos[obrigatorio] = 'obrigatorio';
    }
  }

  const saida: Record<string, unknown> = {};
  for (const chave of chaves) {
    if (motivos[chave] !== undefined) continue;
    const r = validarCampo(entidade, chave, patch[chave]);
    if (r.ok) saida[chave] = r.valor;
    else motivos[chave] = r.motivo;
  }

  if (Object.keys(motivos).length > 0) return falha(motivos);
  return { ok: true, expectedVersion, patch: saida };
}

/**
 * Erro do banco para resposta HTTP (81 §5, 77 CA-03..CA-07). Nulo = erro que nao e do catalogo: sobe e a
 * API responde 503 sem detalhe. A sugestao e um codigo que a tela traduz (sem texto livre do banco).
 */
export function respostaDoErroCatalogo(erro: unknown, entidade: CatalogEntity): AdminResponse | null {
  const codigo = objeto(erro) ? erro.code : undefined;
  switch (codigo) {
    case '42501':
      return ADMIN_PERMISSION_DENIED;
    case 'CT002':
      // Grupo ativo exige servico ativo (verificado no COMMIT). Orienta a ordem de desativar/reativar.
      return adminReply(409, {
        code: 'grupo_sem_servico_ativo',
        campos: { active: 'sem_servico_ativo' },
        sugestao: entidade === 'group' ? 'ativar_servico_antes' : 'desativar_grupo_antes',
      });
    case 'CT003':
      return adminReply(409, { code: 'versao_em_conflito' });
    case 'CT004':
      return adminReply(422, { code: 'dados_invalidos', campos: {} });
    case 'CT005':
      return NAO_ENCONTRADO;
    case '23505':
      // Sinonimo inativo tambem ocupa o termo (unique service_id + term_norm): a sugestao e reativar.
      return entidade === 'synonym'
        ? adminReply(409, { code: 'sinonimo_duplicado', campos: { term: 'ja_existe' }, sugestao: 'reativar' })
        : adminReply(409, { code: 'duplicado' });
    case '23503':
      return adminReply(422, {
        code: 'referencia_invalida',
        campos: entidade === 'service' ? { group_id: 'nao_encontrado' } : entidade === 'synonym' ? { service_id: 'nao_encontrado' } : {},
      });
    default:
      return null;
  }
}

function texto(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error(ERRO_LEITURA);
  return valor;
}
function inteiro(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) throw new Error(ERRO_LEITURA);
  return valor;
}
function booleano(valor: unknown): boolean {
  if (typeof valor !== 'boolean') throw new Error(ERRO_LEITURA);
  return valor;
}
function registro(valor: unknown): Record<string, unknown> {
  if (!objeto(valor)) throw new Error(ERRO_LEITURA);
  return valor;
}

/** Campos visiveis na tela. Colunas internas nao entram (seed_key, council_body, regulation_source, sensivel). */
function projetar(entidade: CatalogEntity, valor: unknown): Record<string, unknown> {
  const o = registro(valor);
  if (entidade === 'group') {
    return { id: texto(o.id), name: texto(o.name), position: inteiro(o.position), active: booleano(o.active), version: inteiro(o.version) };
  }
  if (entidade === 'service') {
    return {
      id: texto(o.id),
      group_id: texto(o.group_id),
      name: texto(o.name),
      modality: texto(o.modality),
      regulated: booleano(o.regulated),
      active: booleano(o.active),
      version: inteiro(o.version),
    };
  }
  return {
    id: texto(o.id),
    service_id: texto(o.service_id),
    term: texto(o.term),
    active: booleano(o.active),
    version: inteiro(o.version),
  };
}

/** Leitura completa da tela (catalog_admin_list). Forma malformada lanca erro (a API responde 503). */
export function projetarLeituraCatalogo(leitura: unknown): {
  grupos: unknown[];
  servicos: unknown[];
  sinonimos: unknown[];
} {
  const o = registro(leitura);
  const lista = (v: unknown, e: CatalogEntity): unknown[] => {
    if (!Array.isArray(v)) throw new Error(ERRO_LEITURA);
    return v.map((item) => projetar(e, item));
  };
  return {
    grupos: lista(o.groups, 'group'),
    servicos: lista(o.services, 'service'),
    sinonimos: lista(o.synonyms, 'synonym'),
  };
}

/** Historico de um item: versao, antes, depois, instante e ator (updated_by_ref dentro da revisao). */
function projetarRevisoes(entidade: CatalogEntity, leitura: unknown): unknown[] {
  if (!Array.isArray(leitura)) throw new Error(ERRO_LEITURA);
  return leitura.map((item) => {
    const o = registro(item);
    return {
      versao: inteiro(o.version),
      antes: o.before === null || o.before === undefined ? null : projetar(entidade, o.before),
      depois: projetar(entidade, o.after),
      em: texto(o.at),
      ator: typeof o.actor === 'string' ? o.actor : null,
    };
  });
}

/**
 * Manipulador das rotas /v1/admin/catalog (depois da guarda e da permissao, feitas pela API).
 * Criacao = 201 {id}; alteracao = 200 {id}; leitura = 200; revisoes = 200.
 */
export async function handleCatalogAdmin(
  op: CatalogOperation,
  principal: CatalogPrincipal,
  port: CatalogAdminPort,
): Promise<AdminResponse> {
  if (op.kind === 'listar') {
    return adminReply(200, projetarLeituraCatalogo(await port.listar(principal)));
  }
  if (op.kind === 'revisoes') {
    const entidade = entidadeDaRotaCatalogo(op.entidadeRota);
    if (entidade === null || !UUID.test(op.id)) return NAO_ENCONTRADO;
    const leitura = await port.revisoes(principal, entidade, op.id);
    return adminReply(200, { revisoes: projetarRevisoes(entidade, leitura) });
  }
  if (op.id !== null && !UUID.test(op.id)) return NAO_ENCONTRADO;
  const validacao = validarAlteracaoCatalogo(op.entidade, op.id === null, op.corpo);
  if (!validacao.ok) return validacao.resposta;
  try {
    const id = await port.salvar(principal, op.entidade, op.id, validacao.expectedVersion, validacao.patch);
    return adminReply(op.id === null ? 201 : 200, { id });
  } catch (erro) {
    const resposta = respostaDoErroCatalogo(erro, op.entidade);
    if (resposta !== null) return resposta;
    throw erro;
  }
}

/** Segmento da URL (groups, services, synonyms) para a entidade do banco; qualquer outro vira nulo. */
export function entidadeDaRotaCatalogo(segmento: string): CatalogEntity | null {
  return Object.hasOwn(ENTIDADE_DA_ROTA, segmento) ? (ENTIDADE_DA_ROTA[segmento] ?? null) : null;
}
