// Issue 52 (H-039) | Validacao de decisao, motivo e complemento (124 §4.3 passos 2 e 3; dec. 375 a 377).
// O texto-modelo por motivo (dec. 376) depende de aprovacao de texto e nao entra aqui.
import { COMPLEMENTO_MAX, MOTIVOS_DECISAO, type Decisao, type MotivoDecisao } from './types.js';

export type ResultadoDecisao =
  | { readonly ok: true; readonly complemento: string | null }
  | { readonly ok: false; readonly codigo: 'motivo_invalido' | 'explicacao_invalida' };

// Mesmos padroes de private.verification_text_has_pii (CPF, CNPJ, e-mail, 10 ou mais digitos).
const PADROES_DADO_PESSOAL: readonly RegExp[] = [
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
  /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /(\d[\s.()/-]*){10,}/,
];

export function textoTemDadoPessoal(texto: string): boolean {
  return PADROES_DADO_PESSOAL.some((re) => re.test(texto));
}

/** Combinacao decisao x motivo (dec. 375, 378): aprovada so com aprovado; retida so com duplicidade. */
export function motivoCombina(decisao: Decisao, motivo: MotivoDecisao): boolean {
  if (decisao === 'aprovada') return motivo === 'aprovado';
  if (decisao === 'retida_duplicidade') return motivo === 'duplicidade_suspeita';
  return motivo !== 'aprovado' && motivo !== 'duplicidade_suspeita';
}

export function validarDecisao(entrada: {
  readonly decisao: string;
  readonly motivo: string;
  readonly complemento?: string | null;
}): ResultadoDecisao {
  const decisoesValidas = ['aprovada', 'recusada', 'retida_duplicidade'];
  if (!decisoesValidas.includes(entrada.decisao)) return { ok: false, codigo: 'motivo_invalido' };
  if (!(MOTIVOS_DECISAO as readonly string[]).includes(entrada.motivo)) {
    return { ok: false, codigo: 'motivo_invalido' };
  }
  if (!motivoCombina(entrada.decisao as Decisao, entrada.motivo as MotivoDecisao)) {
    return { ok: false, codigo: 'motivo_invalido' };
  }
  const bruto = entrada.complemento ?? null;
  if (bruto !== null && bruto.length > COMPLEMENTO_MAX) return { ok: false, codigo: 'explicacao_invalida' };
  const complemento = bruto === null || bruto.trim() === '' ? null : bruto.trim();
  if (entrada.motivo === 'outro' && complemento === null) return { ok: false, codigo: 'explicacao_invalida' };
  if (complemento !== null && textoTemDadoPessoal(complemento)) return { ok: false, codigo: 'explicacao_invalida' };
  return { ok: true, complemento };
}
