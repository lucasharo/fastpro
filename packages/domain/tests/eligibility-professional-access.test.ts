// Issue 55 (H-042), parte A | Testes unitarios da guarda de elegibilidade no dominio (docs/factory/142-DESENHO-H042.md, T-20).
// Sem rede, sem banco. Porta e relogio falsos. Valores sinteticos.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  MODOS_GUARDA,
  modoGuardaValido,
  profissionalPermitido,
  type ModoGuarda,
  type ProfessionalAccessPort,
  type RelogioGuarda,
} from '../src/eligibility/professional-access.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const AGORA = new Date('2099-08-15T12:00:00.000Z');

function relogioFalso(valor: Date = AGORA) {
  let chamadas = 0;
  const relogio: RelogioGuarda = {
    now: () => {
      chamadas += 1;
      return valor;
    },
  };
  return { relogio, contagem: () => chamadas };
}

function portaFalsa(resposta: () => Promise<unknown>) {
  const chamadas: Array<{ id: string; modo: ModoGuarda; at: Date }> = [];
  const porta: ProfessionalAccessPort = {
    allowed: (id, modo, at) => {
      chamadas.push({ id, modo, at });
      return resposta() as Promise<boolean>;
    },
  };
  return { porta, chamadas };
}

describe('MODOS_GUARDA', () => {
  it('lista exatamente os dois modos fixos do desenho', () => {
    expect([...MODOS_GUARDA]).toEqual(['descoberta_aceite', 'participacao']);
  });

  it('aceita so os dois modos conhecidos', () => {
    expect(modoGuardaValido('descoberta_aceite')).toBe(true);
    expect(modoGuardaValido('participacao')).toBe(true);
    for (const invalido of ['DESCOBERTA_ACEITE', '', 'x', null, undefined, 1]) {
      expect(modoGuardaValido(invalido)).toBe(false);
    }
  });
});

describe('profissionalPermitido', () => {
  it('consulta a porta uma vez, com o instante do relogio e o modo informado', async () => {
    const { relogio, contagem } = relogioFalso();
    const { porta, chamadas } = portaFalsa(async () => true);
    const ok = await profissionalPermitido(porta, relogio, PROFISSIONAL, 'descoberta_aceite');
    expect(ok).toBe(true);
    expect(contagem()).toBe(1);
    expect(chamadas).toEqual([{ id: PROFISSIONAL, modo: 'descoberta_aceite', at: AGORA }]);
  });

  it('devolve false quando a porta responde false, qualquer que seja o modo', async () => {
    for (const modo of MODOS_GUARDA) {
      const { relogio } = relogioFalso();
      const { porta } = portaFalsa(async () => false);
      expect(await profissionalPermitido(porta, relogio, PROFISSIONAL, modo)).toBe(false);
    }
  });

  it('fail closed: rejeicao da porta vira false, sem repassar a mensagem', async () => {
    const { relogio } = relogioFalso();
    const { porta } = portaFalsa(async () => {
      throw new Error('detalhe interno do banco');
    });
    const ok = await profissionalPermitido(porta, relogio, PROFISSIONAL, 'participacao');
    expect(ok).toBe(false);
  });

  it('fail closed: resposta que nao e exatamente true vira false', async () => {
    for (const resposta of ['true', 1, {}, null, undefined]) {
      const { relogio } = relogioFalso();
      const { porta } = portaFalsa(async () => resposta);
      expect(await profissionalPermitido(porta, relogio, PROFISSIONAL, 'descoberta_aceite')).toBe(false);
    }
  });

  it('modo fora da lista nao chega a consultar a porta', async () => {
    const { relogio, contagem } = relogioFalso();
    const { porta, chamadas } = portaFalsa(async () => true);
    const ok = await profissionalPermitido(porta, relogio, PROFISSIONAL, 'x' as ModoGuarda);
    expect(ok).toBe(false);
    expect(chamadas).toHaveLength(0);
    expect(contagem()).toBe(0);
  });

  it('relogio que falha vira false, sem consultar a porta', async () => {
    const relogio: RelogioGuarda = {
      now: () => {
        throw new Error('relogio indisponivel');
      },
    };
    const { porta, chamadas } = portaFalsa(async () => true);
    expect(await profissionalPermitido(porta, relogio, PROFISSIONAL, 'descoberta_aceite')).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});

describe('camada de dominio sem regra duplicada (CA-H042-01, D-09)', () => {
  it('o arquivo do dominio nao contem estado de acesso, nem condicao de verificacao', () => {
    const texto = readFileSync(new URL('../src/eligibility/professional-access.ts', import.meta.url), 'utf8');
    for (const proibido of [
      'aprovada',
      'verification_status',
      'trial_ativo',
      'em_carencia',
      'cancelada_com_acesso_ate_fim_do_periodo',
      'expirada',
      'sem_acesso',
    ]) {
      expect(texto.includes(proibido), `texto proibido no dominio: ${proibido}`).toBe(false);
    }
  });
});
