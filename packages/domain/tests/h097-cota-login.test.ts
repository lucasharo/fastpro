// H-097 (Issue 107) | Preferencia de cota do login, coerencia de tetos e guarda sem interruptor de e-mail.
// Funcoes puras, sem banco e sem rede. Cobre T-H097-11 (decisao de cota), T-H097-12 (teto e alertas)
// e T-H097-10 (nenhuma chave de e-mail em configuracao). Desenho: docs/factory/86-DESENHO-H097.md §2, §5.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALERT_THRESHOLDS_PCT,
  PROVIDER_LIMITS,
  QUOTA_CUTS,
  alertLevelFor,
  decideQuota,
} from '../src/notifications/quota.js';
import { RATE_CONFIG_KEYS, RATE_LIMIT_DEFAULTS, RATE_LIMIT_RANGES } from '../src/identity/rate-limit.js';

describe('preferencia de cota do login (T-H097-11, D-H097-1 opcao a)', () => {
  it('login (auth) usa o teto diario inteiro de 100 e o mensal de 3.000 do provedor', () => {
    expect(QUOTA_CUTS.auth).toEqual({ dia: 100, mes: 3000 });
    expect(PROVIDER_LIMITS.dia).toBe(QUOTA_CUTS.auth.dia);
    expect(PROVIDER_LIMITS.mes).toBe(QUOTA_CUTS.auth.mes);
  });

  it('com 99 usados no dia o login sai; com 100 espera a virada (bloqueado por dia)', () => {
    expect(decideQuota('auth', 99, 0)).toEqual({ allow: true, blockedBy: null });
    expect(decideQuota('auth', 100, 0)).toEqual({ allow: false, blockedBy: 'dia' });
  });

  it('com 100 no dia, as outras classes ja estao paradas: sobra o espaco do login', () => {
    expect(decideQuota('critico', 90, 0).allow).toBe(false);
    expect(decideQuota('digest', 85, 0).allow).toBe(false);
    expect(decideQuota('lembrete', 70, 0).allow).toBe(false);
    expect(decideQuota('critico', 89, 0).allow).toBe(true);
    expect(decideQuota('digest', 84, 0).allow).toBe(true);
    expect(decideQuota('lembrete', 69, 0).allow).toBe(true);
  });

  it('teto mensal de 3.000 para o login bloqueia por mes, que tem prioridade na decisao', () => {
    expect(decideQuota('auth', 0, 3000)).toEqual({ allow: false, blockedBy: 'mes' });
    expect(decideQuota('auth', 100, 3000)).toEqual({ allow: false, blockedBy: 'mes' });
  });
});

describe('coerencia de tetos e alertas (T-H097-12, H-094)', () => {
  it('o limite global diario de pedidos (padrao 80, teto 90) fica abaixo do corte de login (100)', () => {
    expect(RATE_LIMIT_DEFAULTS.pedidoGlobalDia).toBeLessThanOrEqual(RATE_LIMIT_RANGES.pedidoGlobalDia.max);
    expect(RATE_LIMIT_RANGES.pedidoGlobalDia.max).toBeLessThan(QUOTA_CUTS.auth.dia);
  });

  it('alertas em 70% e 85% do limite do provedor, sem alterar os cortes', () => {
    expect(ALERT_THRESHOLDS_PCT).toEqual({ nivel1: 70, nivel2: 85 });
    expect(alertLevelFor(69, 100)).toBe(0);
    expect(alertLevelFor(70, 100)).toBe(1);
    expect(alertLevelFor(84, 100)).toBe(1);
    expect(alertLevelFor(85, 100)).toBe(2);
  });
});

describe('sem interruptor de e-mail de login (T-H097-10, RN-7, H-097)', () => {
  it('nenhuma chave de configuracao de limite menciona e-mail', () => {
    for (const chave of Object.values(RATE_CONFIG_KEYS)) {
      expect(chave).not.toMatch(/mail/i);
    }
  });

  it('o pedido de login e o envio nao leem ops.app_config', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const raizApi = join(aqui, '..', '..', '..', 'apps', 'api', 'src');
    const arquivos = readdirSync(raizApi).filter((f) => /^challenge-.*\.ts$/.test(f));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arquivo of arquivos) {
      const texto = readFileSync(join(raizApi, arquivo), 'utf8');
      expect(texto).not.toMatch(/app_config/);
    }
  });
});
