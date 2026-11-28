// H-027 (Issue #40) | Servico da reducao (docs/factory/93-DESENHO-H027.md, §2.2 a §2.4, §4 e §5.2; CA-02 a CA-07,
// CA-10, CA-11, CA-13; decisoes 81, 82, 84, 86). Ordem fixa: vaga na instancia -> reduce_begin (lease) -> le o
// original -> reduz -> grava a reduzida -> reduce_done (ready) -> remove o original. Nunca ha 'ready' sem objeto.
// Erros de biblioteca viram codigo na porta; nenhuma mensagem, caminho, tamanho ou dimensao sai daqui.
import {
  DRAFT_HEADERS,
  MEDIA_REDUCE_CEILING_BYTES,
  detectarTipoImagem,
  MEDIA_REDUCE_DEADLINE_MS,
  MEDIA_REDUCE_LEASE_S,
  type ImageReducerPort,
  type MediaRejectCode,
  type MediaReduceStoragePort,
  type MediaStorePort,
  type ReduceOutcome,
  type ReduceTransientCause,
} from '@fastpro/domain';
import { draftNotFound, type DraftOutcome } from '../drafts/draft-service.js';
import type { ReduceGate } from './reduce-gate.js';

/**
 * Contadores por codigo, sem identificador (93 §6). Nao registra nada que identifique a foto ou o rascunho.
 * Nao ha log de linha: o servico so incrementa; quem expoe e a composicao.
 */
export class ReduceCounters {
  private readonly valores = new Map<string, number>();

  incrementar(evento: string): void {
    this.valores.set(evento, (this.valores.get(evento) ?? 0) + 1);
  }

  instantanea(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.valores);
  }
}

export interface ReduceDeps {
  readonly store: MediaStorePort;
  readonly storage: MediaReduceStoragePort;
  readonly reducer: ImageReducerPort;
  readonly gate: ReduceGate;
  readonly contadores: ReduceCounters;
}

export interface ReduzirEntrada {
  /** Id da foto (uuid ja validado pela rota). */
  readonly id: string;
  /** SHA-256 do segredo do cookie: a posse e sempre pelo rascunho (como media_get). */
  readonly hash: string;
}

function resposta(status: number, corpo: unknown, extra: Readonly<Record<string, string>> = {}): DraftOutcome {
  return { status, headers: { ...DRAFT_HEADERS, ...extra }, body: JSON.stringify(corpo) };
}

function erro(status: number, code: string, extra: Readonly<Record<string, string>> = {}): DraftOutcome {
  return resposta(status, { code }, extra);
}

/** 503 com corpo fixo da #39 e Retry-After (5 s para falhas, 2 s para instancia cheia). */
export function indisponivel(retryAfterS: 2 | 5): DraftOutcome {
  return erro(503, 'indisponivel', { 'retry-after': String(retryAfterS) });
}

function processando(): DraftOutcome {
  return erro(409, 'processando', { 'retry-after': '3' });
}

function visaoPronta(id: string): DraftOutcome {
  return resposta(200, { id, status: 'ready', confirmed: true });
}

async function ignorar(acao: () => Promise<void>): Promise<void> {
  try {
    await acao();
  } catch {
    // Sobra de Storage: o expurgo do rascunho (93 §5.3) recolhe.
  }
}

/** Remove o original quando ainda esta pendente. Falha so deixa a sobra para a limpeza (decisao 82). */
async function tirarOriginal(id: string, pendente: boolean, deps: ReduceDeps, nowMs: number): Promise<void> {
  if (!pendente) return;
  try {
    await deps.storage.removeOriginal(id);
    await deps.store.originalRemoved(id, nowMs);
  } catch {
    deps.contadores.incrementar('limpeza_original_pendente');
  }
}

/** Libera a lease da tentativa dona. count false devolve a tentativa (decisao 86). */
async function soltar(id: string, tentativa: number, conta: boolean, deps: ReduceDeps): Promise<void> {
  try {
    await deps.store.reduceRelease(id, tentativa, conta);
  } catch {
    // A lease vence sozinha em 30 s.
  }
}

async function recusar(
  id: string,
  tentativa: number,
  code: MediaRejectCode,
  deps: ReduceDeps,
  nowMs: number,
): Promise<DraftOutcome> {
  const r = await deps.store.reduceReject(id, tentativa, code, nowMs);
  if (r === 'gone') return draftNotFound();
  if (r === 'lost') {
    deps.contadores.incrementar('perdida');
    return processando();
  }
  deps.contadores.incrementar(`recusa_${code}`);
  await tirarOriginal(id, true, deps, nowMs);
  return erro(422, code);
}

async function falhaStorage(id: string, tentativa: number, deps: ReduceDeps): Promise<DraftOutcome> {
  deps.contadores.incrementar('transitoria_storage');
  await soltar(id, tentativa, false, deps);
  return indisponivel(5);
}

async function falhaTransitoria(
  id: string,
  tentativa: number,
  causa: ReduceTransientCause,
  deps: ReduceDeps,
): Promise<DraftOutcome> {
  // Tempo e memoria contam tentativa (3 seguidas viram nao_processavel); biblioteca ausente e instancia cheia nao.
  const conta = causa === 'timeout' || causa === 'memory';
  const evento =
    causa === 'timeout' ? 'transitoria_timeout' : causa === 'memory' ? 'transitoria_memoria' : causa === 'ocupado' ? 'ocupado' : 'transitoria_sharp';
  deps.contadores.incrementar(evento);
  await soltar(id, tentativa, conta, deps);
  return causa === 'ocupado' ? indisponivel(2) : indisponivel(5);
}

/** Uma tentativa tomada: le, reduz, grava a reduzida, registra ready e so depois remove o original. */
async function reduzirTentativa(id: string, tentativa: number, deps: ReduceDeps, nowMs: number): Promise<DraftOutcome> {
  let original: Uint8Array | null;
  try {
    original = await deps.storage.readOriginal(id);
  } catch {
    return falhaStorage(id, tentativa, deps);
  }
  // Original ausente na quarentena: nao ha o que reduzir; a foto e recusada (decisao 84, falha que nao se resolve).
  if (original === null) return recusar(id, tentativa, 'imagem_invalida', deps, nowMs);
  // H-028 (#41, decisoes 93 e 96; 96-DESENHO §2.3): o conteudo decide o tipo. Sem assinatura de JPEG, PNG ou WebP,
  // a foto e recusada antes de o decodificador ser chamado. Nome e tipo declarado nao entram aqui.
  if (detectarTipoImagem(original) === null) {
    deps.contadores.incrementar('recusa_assinatura');
    return recusar(id, tentativa, 'imagem_invalida', deps, nowMs);
  }

  let r: ReduceOutcome;
  try {
    r = await deps.reducer.reduce(original, { deadlineMs: MEDIA_REDUCE_DEADLINE_MS, orcamento: deps.gate });
  } catch {
    r = { ok: false, kind: 'transient', cause: 'unavailable' };
  }

  if (r.ok) {
    if (r.bytes.byteLength < 1 || r.bytes.byteLength > MEDIA_REDUCE_CEILING_BYTES) {
      return recusar(id, tentativa, 'nao_cabe_no_limite', deps, nowMs);
    }
    try {
      await deps.storage.putReduced(id, r.bytes);
    } catch {
      return falhaStorage(id, tentativa, deps);
    }
    const d = await deps.store.reduceDone(id, tentativa, r.bytes.byteLength, r.width, r.height, nowMs);
    if (d === 'gone') {
      // Linha marcada ou apagada durante a reducao: o objeto recem-gravado sai (93 §3, R-03).
      await ignorar(() => deps.storage.removeReduced(id));
      return draftNotFound();
    }
    if (d === 'lost') {
      // Outra tentativa assumiu a lease: a chave e a mesma e o conteudo e igual; nao se remove nada aqui.
      deps.contadores.incrementar('perdida');
      return processando();
    }
    deps.contadores.incrementar('reduzida');
    await tirarOriginal(id, true, deps, nowMs);
    return visaoPronta(id);
  }

  if (r.kind === 'definitive') return recusar(id, tentativa, r.code, deps, nowMs);
  return falhaTransitoria(id, tentativa, r.cause, deps);
}

/**
 * Reducao de uma foto ja confirmada (POST /v1/media/{id}/finalize, depois da confirmacao). Idempotente: ready
 * e rejected devolvem o estado sem reencode; so a sobra do original e tentada de novo (CA-06, decisao 82).
 */
export async function reduzirFoto(entrada: ReduzirEntrada, deps: ReduceDeps, nowMs: number): Promise<DraftOutcome> {
  const vaga = await deps.gate.entrar();
  if (vaga === null) {
    deps.contadores.incrementar('ocupado');
    return indisponivel(2);
  }
  try {
    const b = await deps.store.reduceBegin(entrada.hash, entrada.id, nowMs, MEDIA_REDUCE_LEASE_S);
    switch (b.code) {
      case 'not_found':
        return draftNotFound();
      case 'not_confirmed':
        return erro(409, 'upload_nao_encontrado');
      case 'busy':
        deps.contadores.incrementar('processando');
        return processando();
      case 'ready':
        await tirarOriginal(entrada.id, b.originalPending, deps, nowMs);
        return visaoPronta(entrada.id);
      case 'rejected':
        await tirarOriginal(entrada.id, b.originalPending, deps, nowMs);
        return erro(422, b.rejectCode ?? 'nao_processavel');
      case 'begin':
        // await dentro do try: a vaga so e devolvida depois que a reducao termina.
        return await reduzirTentativa(entrada.id, b.attempt ?? 0, deps, nowMs);
    }
    throw new Error('midia_resposta_invalida');
  } finally {
    vaga.sair();
  }
}
