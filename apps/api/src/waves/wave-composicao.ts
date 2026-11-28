// Pacote C (H-060, H-082, H-083) | Montagem das rotas de segunda onda e republicacao a partir do ambiente.
// Liga com: DATABASE_URL_APP_SYSTEM (papel app_system), SITE_URL, ADDRESS_ENC_KEY (cofre do endereco do pedido de
// origem) e DRAFT_IP_HMAC_KEY (>= 32 caracteres, hasher do rascunho). Faltando algo, as rotas nao ligam (404 uniforme).
// Nunca le, grava nem registra o valor das variaveis: a pendencia leva so o nome.
import { PgRequestVisibilityStore, PgRequestWaveStore, PgSessionRepository, type SqlClient } from '@fastpro/db';
import { createAddressVault, type AddressVault } from '../requests/address-crypto.js';
import { createDraftHasher, newDraftSecret, type DraftHasher } from '../drafts/draft-hash.js';
import { DRAFT_IP_KEY_ENV } from '../drafts/compose.js';
import type { WaveRouteOptions } from './wave-route.js';

const ADDRESS_ENC_KEY_NOME = 'ADDRESS_ENC_KEY';

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface OndasOpcoes {
  /** Fabrica de cliente SQL do papel app_system (decidida na borda). Sem ela, nada e montado. */
  readonly abrirCliente?: (connectionString: string) => SqlClient;
  /** Relogio das rotas. Padrao: relogio do sistema. */
  readonly relogio?: { nowMs(): number };
}

export function montarOndas(
  env: Ambiente,
  opcoes: OndasOpcoes = {},
): { readonly options: WaveRouteOptions | undefined; readonly pendencias: readonly string[] } {
  const pendencias: string[] = [];
  const url = (env.DATABASE_URL_APP_SYSTEM ?? '').trim();
  const site = (env.SITE_URL ?? '').trim();
  if (url === '') pendencias.push('DATABASE_URL_APP_SYSTEM');
  if (site === '') pendencias.push('SITE_URL');

  let cofre: AddressVault | undefined;
  if ((env[ADDRESS_ENC_KEY_NOME] ?? '').trim() === '') {
    pendencias.push(ADDRESS_ENC_KEY_NOME);
  } else {
    try {
      cofre = createAddressVault(env[ADDRESS_ENC_KEY_NOME] ?? '');
    } catch {
      pendencias.push(`${ADDRESS_ENC_KEY_NOME} (tamanho minimo)`);
    }
  }

  let hasher: DraftHasher | undefined;
  const chaveIp = env[DRAFT_IP_KEY_ENV] ?? '';
  if (chaveIp.trim() === '') {
    pendencias.push(DRAFT_IP_KEY_ENV);
  } else {
    try {
      hasher = createDraftHasher(chaveIp);
    } catch {
      pendencias.push(`${DRAFT_IP_KEY_ENV} (curta)`);
    }
  }

  if (opcoes.abrirCliente === undefined) pendencias.push('fabrica do cliente SQL das ondas (ainda nao montada na funcao)');
  if (pendencias.length > 0 || cofre === undefined || hasher === undefined || opcoes.abrirCliente === undefined) {
    return { options: undefined, pendencias };
  }

  const cofreEndereco: AddressVault = cofre;
  const cliente = opcoes.abrirCliente(url);
  const visao = new PgRequestVisibilityStore(cliente);
  return {
    options: {
      siteUrl: site,
      sessions: new PgSessionRepository(cliente),
      store: new PgRequestWaveStore(cliente),
      origem: {
        // Mesma leitura do dono (readOwner) e o mesmo cofre do detalhe: o id do pedido e o dado associado.
        enderecoDoDono: async (userId, requestId) => {
          const linha = await visao.readOwner(userId, requestId);
          if (linha === null) return null;
          return linha.addressEnc !== null ? cofreEndereco.open(linha.addressEnc, linha.id) : linha.addressTextLegado;
        },
      },
      rascunho: { hasher, novoSegredo: newDraftSecret },
      clock: opcoes.relogio ?? { nowMs: () => Date.now() },
    },
    pendencias: [],
  };
}
