// Primeiros passos do profissional: situacao de cada passo a partir do que a API devolve.
import { describe, expect, it } from 'vitest';
import { montarPassos, type DadosPassos } from '../src/lib/primeiros-passos';
import { lerDadosPassos, type Leitor } from '../src/lib/primeiros-passos-leitura';

const NOVO: DadosPassos = {
  areaDefinida: false,
  totalServicos: 0,
  regulamentados: [],
  temIdentidade: false,
  certificados: [],
  verificacao: { estado: 'sem_envio' },
  assinatura: 'sem_acesso',
};
const ELETRICISTA = { serviceId: 's1', name: 'Eletricista', regulated: true };
const situacoes = (d: DadosPassos) => Object.fromEntries(montarPassos(d).map((p) => [p.id, p.situacao]));

describe('primeiros passos', () => {
  it('conta nova: area e documento liberados, o resto depois; sem certificacao para quem nao precisa', () => {
    expect(situacoes(NOVO)).toEqual({ area: 'agora', servicos: 'bloqueado', documento: 'agora', analise: 'bloqueado', assinatura: 'bloqueado' });
  });

  it('servico regulamentado pede certificacao depois do documento e segura a analise', () => {
    const base = { ...NOVO, areaDefinida: true, totalServicos: 1, regulamentados: [ELETRICISTA] };
    expect(situacoes(base).certificacoes).toBe('bloqueado');
    const comDocumento = { ...base, temIdentidade: true, verificacao: { estado: 'em_analise' } };
    expect(situacoes(comDocumento)).toMatchObject({ certificacoes: 'agora', analise: 'bloqueado' });
    expect(situacoes({ ...comDocumento, certificados: ['s1'] })).toMatchObject({ documento: 'aguardando', certificacoes: 'aguardando', analise: 'aguardando' });
  });

  it('recusa aponta o que corrigir', () => {
    const base = { ...NOVO, areaDefinida: true, totalServicos: 1, regulamentados: [ELETRICISTA], temIdentidade: true, certificados: ['s1'] };
    expect(situacoes({ ...base, verificacao: { estado: 'recusada', motivo: 'documento_ilegivel' } })).toMatchObject({ documento: 'atencao', analise: 'atencao' });
    expect(situacoes({ ...base, verificacao: { estado: 'recusada', motivo: 'certificacao_insuficiente' } })).toMatchObject({ documento: 'feito', certificacoes: 'atencao' });
  });

  it('aprovado libera a assinatura; com teste ativo tudo fica concluido', () => {
    const aprovado = { ...NOVO, areaDefinida: true, totalServicos: 2, temIdentidade: true, verificacao: { estado: 'aprovada' } };
    expect(situacoes(aprovado).assinatura).toBe('agora');
    expect(montarPassos({ ...aprovado, assinatura: 'trial_ativo' }).every((p) => p.situacao === 'feito')).toBe(true);
  });

  it('leitura: sem sessao, falha e documentos separados por tipo', async () => {
    const corpos: Record<string, unknown> = {
      '/v1/professional/profile/area': { configured: true },
      '/v1/professional/profile/services': { services: [ELETRICISTA] },
      '/v1/professional/documents': { documents: [{ documentKind: 'certificacao', serviceId: 's1', status: 'recebido' }] },
      '/v1/professional/verificacao': { estado: 'em_analise' },
      '/v1/billing/status': { estado: 'sem_acesso' },
    };
    const com = (status: number): Leitor => async <T,>(caminho: string) => ({ status, corpo: corpos[caminho] as T });
    expect((await lerDadosPassos(com(401))).tipo).toBe('sessao');
    expect((await lerDadosPassos(com(503))).tipo).toBe('erro');
    const r = await lerDadosPassos(com(200));
    expect(r.tipo === 'ok' && r.dados).toMatchObject({ temIdentidade: false, certificados: ['s1'], areaDefinida: true });
  });
});
