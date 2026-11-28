// H-025 | Porta DraftGate real (docs/factory/74-DESENHO-H025.md, §1 "Porta DraftGate real", §3 R5;
// docs/factory/56-DESENHO-H020.md, §2.3). Substitui unwiredDraftGate: so aceita rascunho vivo.
// Consulta o rascunho pelo cookie (so o SHA-256 do segredo vai ao banco). Nenhum provedor e acionado
// aqui: esta porta nao gera custo. Sem log do cookie, do hash ou do rascunho.
import { DRAFT_LIVE_STATUSES, draftSecretFromCookie, type DraftStorePort } from '@fastpro/domain';
import type { ClockPort, DraftGatePort, DraftGateResult } from '../geo/ports.js';
import type { DraftHasher } from './draft-hash.js';

export interface DraftGateDeps {
  /** Mesmo adaptador das rotas do rascunho (find = private.draft_get, so rascunho vivo). */
  readonly store: DraftStorePort;
  readonly hasher: DraftHasher;
  readonly clock: ClockPort;
}

/**
 * ok com principal = id do rascunho quando o cookie aponta para rascunho vivo (aberto ou
 * aguardando_email). Sem cookie valido: no_principal (sem banco). Qualquer outro caso: not_draft.
 * Falha do banco: indisponivel (a rota de geocodificacao responde 503 sem consultar o provedor).
 */
export function createDraftGate(deps: DraftGateDeps): DraftGatePort {
  return {
    async check(_contexto, cookie): Promise<DraftGateResult> {
      const segredo = draftSecretFromCookie(cookie);
      if (segredo === null) return { status: 'no_principal' };
      try {
        const rascunho = await deps.store.find(deps.hasher.secretHash(segredo), deps.clock.nowMs());
        if (rascunho === null) return { status: 'not_draft' };
        if (!(DRAFT_LIVE_STATUSES as readonly string[]).includes(rascunho.status)) return { status: 'not_draft' };
        return { status: 'ok', principal: rascunho.id };
      } catch {
        return { status: 'indisponivel' };
      }
    },
  };
}
