// Issue 52 (H-039) | Estado do detalhe, da decisao e da leitura do documento (124 §5.4; dec. 375). Valores sinteticos.
import { describe, expect, it } from 'vitest';
import {
  COMPLEMENTO_MAX,
  contadorComplemento,
  ehMotivoLeitura,
  estadoDaDecisao,
  estadoDoDetalhe,
  extensaoDoDocumento,
  motivoLeituraPadrao,
  rotuloMotivo,
  TEXTO_CONFLITO_DECISAO,
  TEXTO_ERRO_DECISAO,
  TEXTO_SEM_ACESSO_DECISAO,
} from '../src/verification-detail-state';

const CORPO = {
  id: 'caso-sintetico-1',
  short_id: 'ABC123',
  status: 'pendente',
  appeal_status: 'nenhum',
  sla_target_at: '2026-11-20T12:00:00.000Z',
  received_at: '2026-11-13T10:00:00.000Z',
  services: ['Servico sintetico'],
  overdue: false,
  assigned_to_me: false,
  version: 3,
  motivo: null,
  explicacao: null,
  decididoEm: null,
  documentoDisponivel: true,
  documentoRecebidoEm: '2026-11-13T10:00:00.000Z',
  documento: 'DOC-SINTETICO-NAO-EXPOR',
};

describe('estadoDoDetalhe', () => {
  it('404 vira sem_acesso (negacao uniforme, igual a caso inexistente)', () => {
    expect(estadoDoDetalhe(404, null)).toEqual({ tipo: 'sem_acesso' });
  });

  it('200 valido copia so os campos da tela e deixa o identificador do documento de fora', () => {
    const estado = estadoDoDetalhe(200, CORPO);
    expect(estado.tipo).toBe('ok');
    if (estado.tipo !== 'ok') return;
    expect(estado.caso).not.toHaveProperty('documento');
    expect(estado.caso.documentoDisponivel).toBe(true);
    expect(estado.caso.version).toBe(3);
    expect(JSON.stringify(estado)).not.toContain('DOC-SINTETICO');
  });

  it('500, 502 e 200 fora do formato viram erro generico', () => {
    expect(estadoDoDetalhe(500, CORPO)).toEqual({ tipo: 'erro' });
    expect(estadoDoDetalhe(502, CORPO)).toEqual({ tipo: 'erro' });
    expect(estadoDoDetalhe(200, 'texto')).toEqual({ tipo: 'erro' });
  });

  it('campo obrigatorio faltando vira erro', () => {
    const semVersao: Record<string, unknown> = { ...CORPO };
    delete semVersao.version;
    expect(estadoDoDetalhe(200, semVersao)).toEqual({ tipo: 'erro' });
  });
});

describe('contadorComplemento', () => {
  it('limite de 500 caracteres: 500 e aceito, 501 passa do limite', () => {
    expect(COMPLEMENTO_MAX).toBe(500);
    expect(contadorComplemento('a'.repeat(500)).excedeu).toBe(false);
    expect(contadorComplemento('a'.repeat(501)).excedeu).toBe(true);
  });

  it('mostra o rotulo de contagem', () => {
    expect(contadorComplemento('').rotulo).toBe('0 de 500 caracteres');
    expect(contadorComplemento('abc').rotulo).toBe('3 de 500 caracteres');
  });
});

describe('estadoDaDecisao', () => {
  it('mapeia 200, 409, 422, 404 e falha generica', () => {
    expect(estadoDaDecisao(200).situacao).toBe('salvo');
    expect(estadoDaDecisao(409)).toEqual({ situacao: 'conflito', mensagem: TEXTO_CONFLITO_DECISAO });
    expect(estadoDaDecisao(422).situacao).toBe('invalido');
    expect(estadoDaDecisao(404)).toEqual({ situacao: 'sem_acesso', mensagem: TEXTO_SEM_ACESSO_DECISAO });
    expect(estadoDaDecisao(500)).toEqual({ situacao: 'erro', mensagem: TEXTO_ERRO_DECISAO });
  });
});

describe('leitura do documento e rotulos', () => {
  it('so jpeg e pdf viram download; outros tipos nao', () => {
    expect(extensaoDoDocumento('image/jpeg')).toBe('jpg');
    expect(extensaoDoDocumento('application/pdf')).toBe('pdf');
    expect(extensaoDoDocumento('text/html')).toBeNull();
  });

  it('motivo de leitura tem lista fixa; o padrao depende do recurso', () => {
    expect(ehMotivoLeitura('analise_inicial')).toBe(true);
    expect(ehMotivoLeitura('qualquer_coisa')).toBe(false);
    expect(motivoLeituraPadrao('pendente')).toBe('reanalise_recurso');
    expect(motivoLeituraPadrao('nenhum')).toBe('analise_inicial');
  });

  it('rotulo do motivo da decisao', () => {
    expect(rotuloMotivo(null)).toBe('Ainda não decidido');
    expect(rotuloMotivo('documento_ilegivel')).toBe('Documento ilegível');
    expect(rotuloMotivo('invento')).toBe('Motivo não reconhecido');
  });
});
