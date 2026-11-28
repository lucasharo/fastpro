// H-107 (Issue 116) | Estado da tela do catalogo a partir das respostas de /v1/admin/catalog (docs/factory/81-DESENHO-H107.md
// §4 e §5; 77-REFINO-H107.md CA-11). Funcoes puras, sem React e sem I/O. A tela so mostra o que a API devolveu;
// quem decide o acesso e o servidor (404 = sem acesso, igual ao console). Erro ao salvar mantem o texto digitado
// (a tela devolve os valores ao formulario) e nunca mostra detalhe de banco.

/** Modalidades aceitas pela API (catalog_patch_text + CHECK do modelo). */
export const MODALIDADES = [
  { valor: 'presencial', rotulo: 'Presencial' },
  { valor: 'online', rotulo: 'Online' },
  { valor: 'ambos', rotulo: 'Presencial e online' },
] as const;

export interface CatalogoGrupo {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly active: boolean;
  readonly version: number;
}
export interface CatalogoServico {
  readonly id: string;
  readonly group_id: string;
  readonly name: string;
  readonly modality: string;
  readonly regulated: boolean;
  readonly active: boolean;
  readonly version: number;
}
export interface CatalogoSinonimo {
  readonly id: string;
  readonly service_id: string;
  readonly term: string;
  readonly active: boolean;
  readonly version: number;
}

export type CatalogoEstado =
  | {
      readonly tipo: 'lista';
      readonly grupos: readonly CatalogoGrupo[];
      readonly servicos: readonly CatalogoServico[];
      readonly sinonimos: readonly CatalogoSinonimo[];
    }
  | { readonly tipo: 'sem_acesso' }
  | { readonly tipo: 'erro' };

/** Texto de lista sem resultado (CA-11). */
export const TEXTO_LISTA_VAZIA = 'Nenhum item encontrado.';
/** Erro ao carregar a tela. */
export const TEXTO_ERRO_CARREGAR = 'Não foi possível carregar o catálogo. Tente novamente.';
/** Erro ao salvar sem detalhe: nada foi gravado e o texto digitado permanece. */
export const TEXTO_ERRO_SALVAR = 'Não foi possível salvar. Nada foi alterado; o que você digitou foi mantido.';
export const TEXTO_SALVO = 'Alteração salva.';

/** Textos por motivo de campo (a API devolve so o codigo). */
const TEXTO_MOTIVO: Readonly<Record<string, string>> = {
  obrigatorio: 'Preencha este campo.',
  invalido: 'Valor inválido.',
  nao_permitido: 'Este campo não pode ser alterado aqui.',
  nao_alteravel: 'O serviço de um sinônimo não pode ser trocado; crie outro sinônimo.',
  nao_aplica: 'Este campo não se aplica à criação.',
  nao_encontrado: 'Não encontrado. Recarregue a lista.',
  ja_existe: 'Este termo já existe neste serviço.',
  objeto_obrigatorio: 'Os dados enviados estão incompletos.',
  vazio: 'Altere ao menos um campo.',
};

/** Rotulos dos campos do formulario, para o resumo de erros. */
export const ROTULO_CAMPO: Readonly<Record<string, string>> = {
  name: 'Nome',
  position: 'Posição',
  term: 'Termo',
  group_id: 'Grupo',
  service_id: 'Serviço',
  modality: 'Modalidade',
  regulated: 'Regulamentado',
  active: 'Ativo',
  expectedVersion: 'Versão',
  patch: 'Dados',
};

export function motivoDoCampo(motivo: string): string {
  return TEXTO_MOTIVO[motivo] ?? 'Valor inválido.';
}

/** Situacao do ultimo envio do formulario. `campos` liga cada erro ao nome do campo (aria-describedby). */
export interface EstadoSalvar {
  readonly situacao: 'inicial' | 'salvo' | 'erro' | 'conflito' | 'sem_acesso';
  readonly mensagem: string | null;
  readonly campos: Readonly<Record<string, string>>;
}

export const ESTADO_INICIAL: EstadoSalvar = { situacao: 'inicial', mensagem: null, campos: {} };

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function itemValido(item: unknown, chaves: readonly [string, string][]): boolean {
  const o = objeto(item);
  if (o === null) return false;
  return chaves.every(([nome, tipo]) => typeof o[nome] === tipo);
}

/** Mapeia a resposta de GET /v1/admin/catalog. 404 = sem acesso; forma fora do contrato = erro. */
export function estadoDoCatalogo(status: number, corpo: unknown): CatalogoEstado {
  if (status === 404) return { tipo: 'sem_acesso' };
  if (status !== 200) return { tipo: 'erro' };
  const o = objeto(corpo);
  const grupos = o?.grupos;
  const servicos = o?.servicos;
  const sinonimos = o?.sinonimos;
  if (!Array.isArray(grupos) || !Array.isArray(servicos) || !Array.isArray(sinonimos)) return { tipo: 'erro' };
  const okGrupos = grupos.every((g) =>
    itemValido(g, [['id', 'string'], ['name', 'string'], ['position', 'number'], ['active', 'boolean'], ['version', 'number']]),
  );
  const okServicos = servicos.every((s) =>
    itemValido(s, [['id', 'string'], ['group_id', 'string'], ['name', 'string'], ['modality', 'string'], ['regulated', 'boolean'], ['active', 'boolean'], ['version', 'number']]),
  );
  const okSinonimos = sinonimos.every((y) =>
    itemValido(y, [['id', 'string'], ['service_id', 'string'], ['term', 'string'], ['active', 'boolean'], ['version', 'number']]),
  );
  if (!okGrupos || !okServicos || !okSinonimos) return { tipo: 'erro' };
  return {
    tipo: 'lista',
    grupos: grupos as CatalogoGrupo[],
    servicos: servicos as CatalogoServico[],
    sinonimos: sinonimos as CatalogoSinonimo[],
  };
}

/** Mapeia a resposta de uma gravacao (criacao, alteracao ou desativacao) para o estado do formulario. */
export function estadoDaGravacao(status: number, corpo: unknown): EstadoSalvar {
  if (status === 200 || status === 201) return { situacao: 'salvo', mensagem: TEXTO_SALVO, campos: {} };
  if (status === 404) return { situacao: 'sem_acesso', mensagem: null, campos: {} };
  const o = objeto(corpo);
  const code = typeof o?.code === 'string' ? o.code : '';
  const campos = objeto(o?.campos) ?? {};
  const porCampo: Record<string, string> = {};
  for (const [nome, motivo] of Object.entries(campos)) {
    if (typeof motivo === 'string') porCampo[nome] = motivoDoCampo(motivo);
  }

  if (status === 409) {
    if (code === 'versao_em_conflito') {
      return { situacao: 'conflito', mensagem: 'Outra pessoa alterou este item. Recarregue a lista e tente de novo.', campos: {} };
    }
    if (code === 'sinonimo_duplicado') {
      return {
        situacao: 'erro',
        mensagem: 'Este termo já existe neste serviço. Se ele estiver inativo, reative-o na lista.',
        campos: { term: porCampo.term ?? motivoDoCampo('ja_existe') },
      };
    }
    if (code === 'grupo_sem_servico_ativo') {
      const sugestao = o?.sugestao;
      const texto =
        sugestao === 'ativar_servico_antes'
          ? 'Para ativar este grupo, ative antes ao menos um serviço dele.'
          : 'Para desativar o último serviço ativo, desative o grupo antes.';
      return { situacao: 'erro', mensagem: texto, campos: {} };
    }
    return { situacao: 'erro', mensagem: 'Já existe um item com estes dados.', campos: {} };
  }
  if (status === 422) {
    if (code === 'referencia_invalida') {
      return { situacao: 'erro', mensagem: 'O grupo ou serviço escolhido não existe mais. Recarregue a lista.', campos: porCampo };
    }
    if (Object.keys(porCampo).length > 0) return { situacao: 'erro', mensagem: 'Corrija os campos destacados.', campos: porCampo };
    return { situacao: 'erro', mensagem: TEXTO_ERRO_SALVAR, campos: {} };
  }
  if (status === 413) return { situacao: 'erro', mensagem: 'Os dados enviados são grandes demais.', campos: {} };
  return { situacao: 'erro', mensagem: TEXTO_ERRO_SALVAR, campos: {} };
}

/** Rotulo da modalidade para a lista (valor desconhecido aparece como esta, sem inventar traducao). */
export function rotuloModalidade(valor: string): string {
  return MODALIDADES.find((m) => m.valor === valor)?.rotulo ?? valor;
}

/** Rotulo de situacao do item (ativo ou inativo). */
export function rotuloSituacao(ativo: boolean): string {
  return ativo ? 'Ativo' : 'Inativo';
}
