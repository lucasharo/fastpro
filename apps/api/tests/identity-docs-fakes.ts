// H-037 (Issue #50) | Fakes dos documentos de identidade (sem banco e sem rede). A semantica segue 107 §4.2 e §6;
// a prova do banco real e do dbtest (packages/db/tests/identity-docs-h037.dbtest.mjs). Nenhum fake faz I/O.
import { randomUUID } from 'node:crypto';
import { type IdentityDocConfirmBeginResult, type IdentityDocFinalPort, type IdentityDocIssueCertInput, type IdentityDocIssueInput, type IdentityDocIssueResult, type IdentityDocListItem, type IdentityDocRateLimiterPort, type IdentityDocRatePolicy, type IdentityDocStagingPort, type IdentityDocStorePort, type IdentityDocSweepItem, type ReduceOutcome } from '@fastpro/domain';
import type { IdentityDocReduceGate } from '../src/identity-docs/identity-doc-service.js';

export const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);
export const MIN = 60_000;

export class Relogio {
  constructor(public t = T0) {}
  nowMs(): number {
    return this.t;
  }
}

interface LinhaDoc {
  readonly id: string;
  readonly userId: string;
  readonly clientUploadId: string;
  readonly declaredType: string;
  readonly declaredBytes: number;
  /** H-038: identidade (sem servico) ou certificacao (com servico). */
  readonly documentKind: 'identidade' | 'certificacao';
  readonly serviceId: string | null;
  status: 'pendente_envio' | 'recebido' | 'substituido';
  storedType: 'image/jpeg' | 'application/pdf' | null;
  storedBytes: number | null;
  pendingExpiresAt: number;
  leaseUntil: number;
  attempts: number;
  receivedAt: number | null;
  analyzedAt: number | null;
  purge: boolean;
}

/** Banco em memoria com a semantica de private.idoc_* (cotas e limite de 5 vivos inclusos). */
export class MemStore implements IdentityDocStorePort {
  readonly linhas = new Map<string, LinhaDoc>();
  readonly chamadas: string[] = [];
  /** SHA-256 gravado por confirmDone, por id: a prova de integridade confere com o objeto final. */
  readonly shas = new Map<string, Uint8Array>();
  /** Perfis com e-mail verificado; ausentes sao recusados em issue (email_unverified). */
  readonly emailVerificado = new Set<string>();
  readonly estadoProibido = new Set<string>();
  /** H-038: vinculos `userId|serviceId` a servicos regulamentados (fixture de app.professional_service). */
  readonly vinculosRegulados = new Set<string>();

  private vivos(userId: string): LinhaDoc[] {
    return [...this.linhas.values()].filter(
      (l) => l.userId === userId && !l.purge && (l.status === 'recebido' || l.status === 'pendente_envio'),
    );
  }

  async issue(input: IdentityDocIssueInput): Promise<IdentityDocIssueResult> {
    this.chamadas.push('issue');
    if (!this.emailVerificado.has(input.userId)) return { code: 'email_unverified', id: null, status: null };
    if (this.estadoProibido.has(input.userId)) return { code: 'state_denied', id: null, status: null };
    const igual = [...this.linhas.values()].find(
      (l) => l.userId === input.userId && l.clientUploadId === input.clientUploadId,
    );
    if (igual !== undefined) {
      return igual.status === 'recebido'
        ? { code: 'replay_received', id: igual.id, status: 'recebido' }
        : { code: 'replay', id: igual.id, status: 'em_envio' };
    }
    for (const l of this.vivos(input.userId)) {
      if (l.status === 'pendente_envio' && l.pendingExpiresAt <= input.nowMs) l.purge = true;
    }
    // H-038 (CA-H038-06): o limite de 5 conta so identidade.
    if (this.vivos(input.userId).filter((l) => l.documentKind === 'identidade').length >= 5) {
      return { code: 'doc_limit', id: null, status: null };
    }
    const reserva = [...this.linhas.values()].filter((l) => l.status === 'pendente_envio' && !l.purge).length * 2_097_152;
    const usado = [...this.linhas.values()].reduce((s, l) => s + (l.storedBytes ?? 0), 0) + reserva;
    if (usado + 2_097_152 > input.globalBytesCap) return { code: 'cap', id: null, status: null };
    const id = randomUUID();
    this.linhas.set(id, this.nova(id, input.userId, input.clientUploadId, input.declaredType, input.declaredBytes, 'identidade', null, input.nowMs));
    return { code: 'new', id, status: 'em_envio' };
  }

  /** H-038: reserva de certificacao (private.idoc_issue_cert): servico vinculado, 1 pendente por servico, teto global. */
  async issueCert(input: IdentityDocIssueCertInput): Promise<IdentityDocIssueResult> {
    this.chamadas.push('issueCert');
    if (!this.emailVerificado.has(input.userId)) return { code: 'email_unverified', id: null, status: null };
    if (this.estadoProibido.has(input.userId)) return { code: 'state_denied', id: null, status: null };
    if (!this.vinculosRegulados.has(`${input.userId}|${input.serviceId}`)) {
      return { code: 'service_denied', id: null, status: null };
    }
    const igual = [...this.linhas.values()].find(
      (l) => l.userId === input.userId && l.clientUploadId === input.clientUploadId,
    );
    if (igual !== undefined) {
      if (igual.documentKind !== 'certificacao' || igual.serviceId !== input.serviceId) {
        return { code: 'client_upload_em_uso', id: null, status: null };
      }
      return igual.status === 'recebido'
        ? { code: 'replay_received', id: igual.id, status: 'recebido' }
        : { code: 'replay', id: igual.id, status: 'em_envio' };
    }
    for (const l of this.vivos(input.userId)) {
      if (l.status === 'pendente_envio' && l.pendingExpiresAt <= input.nowMs) l.purge = true;
    }
    const pendente = this.vivos(input.userId).some(
      (l) => l.serviceId === input.serviceId && l.documentKind === 'certificacao' && l.status === 'pendente_envio',
    );
    if (pendente) return { code: 'limite_certificacao', id: null, status: null };
    const reserva = [...this.linhas.values()].filter((l) => l.status === 'pendente_envio' && !l.purge).length * 2_097_152;
    const usado = [...this.linhas.values()].reduce((s, l) => s + (l.storedBytes ?? 0), 0) + reserva;
    if (usado + 2_097_152 > input.globalBytesCap) return { code: 'cap', id: null, status: null };
    const id = randomUUID();
    this.linhas.set(id, this.nova(id, input.userId, input.clientUploadId, input.declaredType, input.declaredBytes, 'certificacao', input.serviceId, input.nowMs));
    return { code: 'new', id, status: 'em_envio' };
  }

  private nova(
    id: string,
    userId: string,
    clientUploadId: string,
    declaredType: string,
    declaredBytes: number,
    documentKind: 'identidade' | 'certificacao',
    serviceId: string | null,
    nowMs: number,
  ): LinhaDoc {
    return {
      id,
      userId,
      clientUploadId,
      declaredType,
      declaredBytes,
      documentKind,
      serviceId,
      status: 'pendente_envio',
      storedType: null,
      storedBytes: null,
      pendingExpiresAt: nowMs + 30 * MIN,
      leaseUntil: 0,
      attempts: 0,
      receivedAt: null,
      analyzedAt: null,
      purge: false,
    };
  }

  /** Substituicao da certificacao (desenho 148 D-H038-A2): a anterior viva do mesmo servico vira substituido. */
  private descartaAnterior(l: LinhaDoc): void {
    if (l.documentKind !== 'certificacao') return;
    for (const outra of this.linhas.values()) {
      if (outra.id !== l.id && outra.userId === l.userId && outra.serviceId === l.serviceId && outra.status === 'recebido') {
        outra.status = 'substituido';
      }
    }
  }

  async list(userId: string): Promise<{ readonly documents: readonly IdentityDocListItem[]; readonly slotsRemaining: number }> {
    this.chamadas.push('list');
    const docs = this.vivos(userId).map((l) => ({
      id: l.id,
      kind: (l.storedType ?? l.declaredType) === 'application/pdf' ? ('pdf' as const) : ('imagem' as const),
      documentKind: l.documentKind,
      serviceId: l.serviceId,
      status: l.status === 'recebido' ? ('recebido' as const) : ('em_envio' as const),
      receivedAt: l.receivedAt === null ? null : new Date(l.receivedAt).toISOString(),
      deletable: l.analyzedAt === null,
      analyzed: l.analyzedAt !== null,
    }));
    const identidade = docs.filter((d) => d.documentKind === 'identidade').length;
    return { documents: docs, slotsRemaining: Math.max(0, 5 - identidade) };
  }

  private dono(userId: string, id: string): LinhaDoc | undefined {
    const l = this.linhas.get(id);
    return l !== undefined && l.userId === userId ? l : undefined;
  }

  async confirmBegin(userId: string, id: string, nowMs: number, leaseS: number): Promise<IdentityDocConfirmBeginResult> {
    this.chamadas.push('confirmBegin');
    const l = this.dono(userId, id);
    if (l === undefined || l.purge) return { code: 'not_found', attempt: null, declaredType: null };
    if (l.status === 'recebido') return { code: 'replay', attempt: null, declaredType: null };
    if (l.pendingExpiresAt <= nowMs) return { code: 'expired', attempt: null, declaredType: null };
    if (l.leaseUntil > nowMs) return { code: 'busy', attempt: null, declaredType: null };
    if (l.attempts >= 3) return { code: 'too_many', attempt: null, declaredType: null };
    l.attempts++;
    l.leaseUntil = nowMs + leaseS * 1000;
    return { code: 'begin', attempt: l.attempts, declaredType: l.declaredType as 'image/jpeg' };
  }

  async confirmDone(
    userId: string,
    id: string,
    attempt: number,
    storedType: 'image/jpeg' | 'application/pdf',
    storedBytes: number,
    sha256: Uint8Array,
    nowMs: number,
  ): Promise<'received' | 'lost' | 'gone'> {
    this.chamadas.push('confirmDone');
    const l = this.dono(userId, id);
    if (l === undefined) return 'gone';
    if (l.attempts !== attempt || l.status !== 'pendente_envio') return 'lost';
    this.shas.set(id, sha256);
    this.descartaAnterior(l);
    l.status = 'recebido';
    l.storedType = storedType;
    l.storedBytes = storedBytes;
    l.receivedAt = nowMs;
    l.leaseUntil = 0;
    return 'received';
  }

  async confirmRefuse(userId: string, id: string): Promise<'refused' | 'lost' | 'gone'> {
    this.chamadas.push('confirmRefuse');
    const l = this.dono(userId, id);
    if (l === undefined) return 'gone';
    l.purge = true;
    return 'refused';
  }

  async confirmRelease(id: string, _attempt: number, count: boolean): Promise<void> {
    this.chamadas.push(count ? 'release:count' : 'release:uncount');
    const l = this.linhas.get(id);
    if (l === undefined) return;
    l.leaseUntil = 0;
    if (!count) l.attempts = Math.max(0, l.attempts - 1);
  }

  async remove(userId: string, id: string): Promise<'deleted' | 'not_found' | 'already_analyzed'> {
    this.chamadas.push('remove');
    const l = this.dono(userId, id);
    if (l === undefined || l.purge) return 'not_found';
    if (l.analyzedAt !== null) return 'already_analyzed';
    l.purge = true;
    return 'deleted';
  }

  async sweep(nowMs: number, limit: number): Promise<readonly IdentityDocSweepItem[]> {
    this.chamadas.push('sweep');
    for (const l of this.linhas.values()) {
      if (l.status === 'pendente_envio' && !l.purge && l.pendingExpiresAt <= nowMs) l.purge = true;
    }
    return [...this.linhas.values()]
      .filter((l) => l.purge)
      .slice(0, limit)
      .map((l) => ({ id: l.id, stagingKey: l.status === 'pendente_envio', finalKey: l.storedBytes !== null }));
  }

  async purgeDone(ids: readonly string[]): Promise<number> {
    this.chamadas.push('purgeDone');
    let n = 0;
    for (const id of ids) if (this.linhas.delete(id)) n++;
    return n;
  }

  async knownPending(ids: readonly string[]): Promise<readonly string[]> {
    return ids.filter((id) => this.linhas.has(id));
  }
}

/** Storage de entrada (`s/<uuid>`) em memoria. `falhas` faz a operacao lancar com mensagem sensivel de proposito. */
export class MemStaging implements IdentityDocStagingPort {
  readonly entrada = new Map<string, { bytes: Uint8Array; criadoEm: number }>();
  readonly falhas = new Set<string>();

  constructor(private readonly relogio: Relogio) {}

  /** Simula o PUT do navegador na URL de uso unico. */
  enviarEntrada(chave: string, bytes: Uint8Array): void {
    this.entrada.set(chave, { bytes, criadoEm: this.relogio.nowMs() });
  }

  async createUploadUrl(chave: string): Promise<string> {
    if (this.falhas.has('createUploadUrl')) throw new Error('falha de rede com /tmp/SENTINELA-caminho');
    return `https://storage.test/upload/${chave}?token=t`;
  }

  async stat(chave: string): Promise<{ readonly bytes: number } | null> {
    if (this.falhas.has('stat')) throw new Error('stat quebrou');
    const o = this.entrada.get(chave);
    return o === undefined ? null : { bytes: o.bytes.length };
  }

  async read(chave: string): Promise<Uint8Array | null> {
    if (this.falhas.has('read')) throw new Error('read quebrou');
    return this.entrada.get(chave)?.bytes ?? null;
  }

  async remove(chave: string): Promise<void> {
    if (this.falhas.has('remove')) throw new Error('remove quebrou');
    this.entrada.delete(chave);
  }

  async listOlderThan(olderThanMs: number, limit: number): Promise<readonly string[]> {
    const corte = this.relogio.nowMs() - olderThanMs;
    return [...this.entrada.entries()]
      .filter(([, o]) => o.criadoEm <= corte)
      .slice(0, limit)
      .map(([k]) => k);
  }
}

/** Storage final (`i/<uuid>`) em memoria: sem leitura, como a porta real. */
export class MemFinal implements IdentityDocFinalPort {
  readonly arquivos = new Map<string, Uint8Array>();
  readonly falhas = new Set<string>();

  async put(id: string, bytes: Uint8Array): Promise<void> {
    if (this.falhas.has('put')) throw new Error('put quebrou');
    this.arquivos.set(id, bytes);
  }

  async stat(id: string): Promise<{ readonly bytes: number } | null> {
    const b = this.arquivos.get(id);
    return b === undefined ? null : { bytes: b.length };
  }

  async remove(id: string): Promise<void> {
    if (this.falhas.has('removeFinal')) throw new Error('remove final quebrou');
    this.arquivos.delete(id);
  }
}

/** Cota em memoria: limite por politica; passou do limite, devolve Retry-After de 300 s. */
export class MemRate implements IdentityDocRateLimiterPort {
  readonly contagem = new Map<string, number>();
  readonly limites = new Map<string, number>();

  async check(policy: IdentityDocRatePolicy, valor: string): Promise<{ readonly ok: boolean; readonly retryAfterS: number }> {
    const chave = `${policy.id}:${valor}`;
    const limite = this.limites.get(policy.id) ?? Number.POSITIVE_INFINITY;
    return (this.contagem.get(chave) ?? 0) >= limite ? { ok: false, retryAfterS: 300 } : { ok: true, retryAfterS: 0 };
  }

  async hit(policy: IdentityDocRatePolicy, valor: string): Promise<void> {
    const chave = `${policy.id}:${valor}`;
    this.contagem.set(chave, (this.contagem.get(chave) ?? 0) + 1);
  }
}

export class MemGate implements IdentityDocReduceGate {
  livre = true;
  async entrar(): Promise<{ sair(): void } | null> {
    return this.livre ? { sair: () => undefined } : null;
  }
  async reservar(): Promise<{ liberar(): void } | null> {
    return { liberar: () => undefined };
  }
}

/** Redutor falso: devolve a saida configurada (ou um JPEG fixo) e registra os bytes recebidos. */
export class FakeReducer {
  resultado: ReduceOutcome | null = null;
  recebidos: Uint8Array[] = [];
  readonly saidaPadrao = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

  async reduce(bytes: Uint8Array): Promise<ReduceOutcome> {
    this.recebidos.push(bytes);
    if (this.resultado !== null) return this.resultado;
    return { ok: true, bytes: this.saidaPadrao, width: 10, height: 10 };
  }
}

/** Bytes minimos que o dominio reconhece como JPEG (assinatura FF D8 FF). */
export const JPEG_FAKE = (tamanho: number): Uint8Array => {
  const b = new Uint8Array(tamanho);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

/** PDF com cabecalho, versao e %%EOF no fim (passa em validarPdf). */
export const PDF_VALIDO = (tamanho: number): Uint8Array => {
  const cab = new TextEncoder().encode('%PDF-1.7\n');
  const fim = new TextEncoder().encode('\n%%EOF\n');
  const b = new Uint8Array(tamanho);
  b.set(cab, 0);
  b.set(fim, tamanho - fim.length);
  return b;
};

export const UUID_A = '00000000-0000-4000-8000-00000000000a';
export const UUID_B = '00000000-0000-4000-8000-00000000000b';
