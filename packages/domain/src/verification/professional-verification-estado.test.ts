// Issue 54 (H-041) | Testes de dominio do estado visivel (T41-02, T41-03, T41-04, T41-05, T41-11 a T41-14).
// Sem banco e sem rede. Frases e campos sensiveis sao varridos por expressao regular.
import { describe, expect, it } from 'vitest';
import { TEXTO_EM_ANALISE } from './professional-status-message.js';
import {
  EXPLICACAO_MAX_CARACTERES,
  montarEstadoVisivel,
  type LinhaEstadoVerificacao,
} from './professional-verification-state.js';
import { TEXTOS_ESTADO, TODAS_AS_FRASES } from './professional-verification-texts.js';
import { TIPOS_TELA, construirTela, formatarDataIso, type EntradaTela } from './professional-verification-screen.js';

const PROIBIDAS = /duplic|já existe|outro cadastro|[0-9a-f]{8}-[0-9a-f]{4}-|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/i;
const PRAZO = /dois dias|dias úteis|prazo|previs|selo|garantia|verificado/i;
const DATA_APROVACAO = '2026-11-10T12:00:00.000Z';

function linha(parcial: Partial<LinhaEstadoVerificacao> & { out_state: string }): LinhaEstadoVerificacao {
  return {
    out_reason_code: null,
    out_explanation: null,
    out_decided_at: null,
    out_appeal: 'indisponivel',
    ...parcial,
  };
}

function telaDe(parcial: Partial<LinhaEstadoVerificacao> & { out_state: string }) {
  const estado = montarEstadoVisivel(linha(parcial));
  if (estado === null) throw new Error('estado nulo no teste');
  return construirTela({ tipo: 'estado', estado } as EntradaTela);
}

describe('estado visivel: dominio (Issue 54, H-041)', () => {
  it('T41-02 | pendente, em_revisao e retido chegam como em_analise, sem motivo nem explicacao', () => {
    const comMotivo = linha({
      out_state: 'em_analise',
      out_reason_code: 'duplicidade_suspeita',
      out_explanation: 'texto que nao deve sair',
      out_appeal: 'recebido',
    });
    expect(montarEstadoVisivel(comMotivo)).toEqual({ estado: 'em_analise', recurso: { situacao: 'recebido' } });
    expect(montarEstadoVisivel(linha({ out_state: 'em_analise' }))).toEqual({
      estado: 'em_analise',
      recurso: { situacao: 'indisponivel' },
    });
  });

  it('T41-03 | nenhuma frase de tela contem termos de duplicidade, identificador ou CPF/CNPJ', () => {
    for (const frase of TODAS_AS_FRASES) expect(frase, frase).not.toMatch(PROIBIDAS);
    for (const texto of Object.values(TEXTOS_ESTADO)) expect(texto).not.toMatch(PROIBIDAS);
  });

  it('T41-03 | recusa por duplicidade nao expoe o codigo nem a palavra em nenhuma tela', () => {
    const tela = telaDe({ out_state: 'recusada', out_reason_code: 'duplicidade_suspeita',
      out_explanation: 'Ha outro cadastro com este documento.', out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' });
    expect(JSON.stringify(tela)).not.toMatch(/duplic|outro cadastro|duplicidade_suspeita/i);
  });

  it('T41-04 | recusa por duplicidade: sem motivo, sem explicacao e com texto neutro; comum difere so nesses campos', () => {
    const dup = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'duplicidade_suspeita',
      out_explanation: 'x', out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    const comum = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'documento_ilegivel',
      out_explanation: 'Foto cortada.', out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    expect(dup).toEqual({ estado: 'recusada', recurso: { situacao: 'disponivel' }, decididoEm: DATA_APROVACAO });
    expect(comum).toEqual({ estado: 'recusada', motivo: 'documento_ilegivel', explicacao: 'Foto cortada.',
      recurso: { situacao: 'disponivel' }, decididoEm: DATA_APROVACAO });
    const telaDup = construirTela({ tipo: 'estado', estado: dup! });
    expect(telaDup.titulo).toBe(TEXTOS_ESTADO.recusada);
    expect(telaDup.motivoTexto).toBeUndefined();
    expect(telaDup.explicacao).toBeUndefined();
  });

  it('T41-05 | aprovada: texto, data da decisao e nenhum selo, garantia ou prazo', () => {
    const tela = telaDe({ out_state: 'aprovada', out_decided_at: DATA_APROVACAO });
    expect(tela.tipo).toBe('aprovada');
    expect(tela.titulo).toBe('Seu cadastro foi aprovado.');
    expect(tela.dataValor).toBe('10/11/2026');
    expect(JSON.stringify(tela)).not.toMatch(PRAZO);
  });

  it('T41-11 | a resposta tem so os campos da lista branca', () => {
    const estado = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: 'Motivo claro.',
      out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    expect(Object.keys(estado!).sort()).toEqual(['decididoEm', 'estado', 'explicacao', 'motivo', 'recurso']);
    expect(Object.keys(estado!.recurso)).toEqual(['situacao']);
    expect(Object.keys(montarEstadoVisivel(linha({ out_state: 'sem_envio' }))!).sort()).toEqual(['estado', 'recurso']);
  });

  it('T41-11 | vocabulario desconhecido e falha fechada (nulo)', () => {
    expect(montarEstadoVisivel(linha({ out_state: 'xyz' }))).toBeNull();
    expect(montarEstadoVisivel(linha({ out_state: 'sem_envio', out_appeal: 'qualquer' }))).toBeNull();
  });

  it('T41-12 | explicacao acima de 500 caracteres e descartada; ate 500 passa como texto puro', () => {
    const limite = 'a'.repeat(EXPLICACAO_MAX_CARACTERES);
    const aceita = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: limite,
      out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    expect(aceita?.explicacao).toBe(limite);
    const recusada = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: `${limite}b`,
      out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    expect(recusada?.explicacao).toBeUndefined();
    const script = montarEstadoVisivel(linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: '<script>x</script>',
      out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }));
    expect(script?.explicacao).toBe('<script>x</script>');
  });

  it('T41-13 | nenhuma tela mostra prazo-meta, dois dias uteis ou data prevista', () => {
    const telas = [
      construirTela({ tipo: 'carregando' }),
      construirTela({ tipo: 'erro' }),
      construirTela({ tipo: 'recurso_indisponivel' }),
      construirTela({ tipo: 'recurso_recebido' }),
      telaDe({ out_state: 'sem_envio' }),
      telaDe({ out_state: 'em_analise', out_appeal: 'recebido' }),
      telaDe({ out_state: 'suspensa' }),
      telaDe({ out_state: 'aprovada', out_decided_at: DATA_APROVACAO }),
      telaDe({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: 'x', out_decided_at: DATA_APROVACAO, out_appeal: 'disponivel' }),
    ];
    for (const tela of telas) expect(JSON.stringify(tela)).not.toMatch(PRAZO);
  });

  it('T41-14 | nove estados de tela; cada frase vem da tabela de textos (fora dela so explicacao e data)', () => {
    expect(TIPOS_TELA).toHaveLength(9);
    const entradas: EntradaTela[] = [
      { tipo: 'carregando' }, { tipo: 'erro' }, { tipo: 'recurso_indisponivel' }, { tipo: 'recurso_recebido' },
      { tipo: 'estado', estado: { estado: 'sem_envio', recurso: { situacao: 'indisponivel' } } },
      { tipo: 'estado', estado: { estado: 'em_analise', recurso: { situacao: 'recebido' } } },
      { tipo: 'estado', estado: { estado: 'aprovada', decididoEm: DATA_APROVACAO, recurso: { situacao: 'indisponivel' } } },
      { tipo: 'estado', estado: { estado: 'recusada', motivo: 'outro', explicacao: 'x', recurso: { situacao: 'disponivel' } } },
      { tipo: 'estado', estado: { estado: 'suspensa', recurso: { situacao: 'indisponivel' } } },
    ];
    const tipos = entradas.map((e) => construirTela(e).tipo);
    expect([...new Set(tipos)].sort()).toEqual([...TIPOS_TELA].sort());
    for (const entrada of entradas) {
      const tela = construirTela(entrada);
      const textos = [tela.titulo, tela.motivoRotulo, tela.motivoTexto, tela.explicacaoRotulo, tela.dataRotulo, tela.aviso, tela.acao?.rotulo];
      for (const t of textos) if (t !== undefined) expect(TODAS_AS_FRASES, t).toContain(t);
    }
  });

  it('T41-14 | em analise usa o texto neutro da Issue 53 e data em dd/mm/aaaa', () => {
    expect(construirTela({ tipo: 'estado', estado: { estado: 'em_analise', recurso: { situacao: 'indisponivel' } } }).titulo)
      .toBe(TEXTO_EM_ANALISE);
    expect(formatarDataIso(DATA_APROVACAO)).toBe('10/11/2026');
    expect(formatarDataIso('invalida')).toBe('');
  });
});
