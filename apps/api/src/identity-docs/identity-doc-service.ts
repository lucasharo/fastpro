// H-037 (Issue #50) | Servico dos documentos de identidade (docs/factory/107-DESENHO-H037.md, §3, §4 e §6; CA-01..CA-14,
// CA-18). Ordem fixa: cota (checagem sem contar) -> banco (posse, limite, repeticao) -> Storage -> cota contada so
// depois de aceite. A finalizacao le o original uma vez no servidor, valida pela assinatura, reencoda a imagem e
// grava so a versao final em identity-docs. Recusado nunca chega ao bucket final. Erro interno vira 503 fixo.
// Nenhum nome de arquivo, caminho, EXIF ou mensagem de biblioteca sai daqui (CA-10).
import { createHash } from 'node:crypto';
import { MEDIA_REDUCE_DEADLINE_MS, type ImageReducerPort, type ReduceBudgetPort } from '@fastpro/domain';
import {
  IDOC_GLOBAL_BYTES_CAP,
  IDOC_IMAGE_MAX_BYTES,
  IDOC_LEASE_S,
  IDOC_PDF_MAX_BYTES,
  IDOC_RATE_EMISSAO_IP_DIA,
  IDOC_RATE_EMISSAO_IP_HORA,
  IDOC_RATE_EMISSAO_PROFISSIONAL_DIA,
  IDOC_RATE_EMISSAO_PROFISSIONAL_HORA,
  IDOC_RATE_FINALIZA_PROFISSIONAL,
  IDOC_RATE_LEITURA_IP,
  IDOC_UPLOAD_URL_TTL_S,
  type IdentityDocRatePolicy,
} from './espelho/constants.js';
import type { IdentityDocEmissaoCorpo } from './espelho/body.js';
import { identityDocIncomingKey } from './espelho/keys.js';
import { validarPdf } from './espelho/pdf.js';
import { detectarTipoDocumento } from './espelho/tipo.js';
import type {
  IdentityDocFinalPort,
  IdentityDocRateLimiterPort,
  IdentityDocStagingPort,
  IdentityDocStorePort,
} from './espelho/ports.js';

/** Reserva de reducao da instancia (ReduceGate da #40): entrar() da null quando nao ha vaga em 2 s. */
export interface IdentityDocReduceGate extends ReduceBudgetPort {
  entrar(): Promise<{ sair(): void } | null>;
}

export interface IdentityDocServiceDeps {
  readonly store: IdentityDocStorePort;
  readonly staging: IdentityDocStagingPort;
  readonly final: IdentityDocFinalPort;
  readonly reducer: ImageReducerPort;
  readonly gate: IdentityDocReduceGate;
  readonly rate: IdentityDocRateLimiterPort;
  /** HMAC do IP (chave do servidor). A chave nunca sai do processo. */
  readonly ipHmac: (ip: string) => string;
  readonly clock: { nowMs(): number };
  /** Teto global em bytes (padrao IDOC_GLOBAL_BYTES_CAP, decisao 220). */
  readonly globalBytesCap?: number;
}

/** Resultado neutro de servico: a rota converte em HTTP. `corpo` ausente = sem corpo. */
export interface IdentityDocOutcome {
  readonly status: number;
  readonly corpo?: unknown;
  readonly retryAfterS?: number;
}

/** Codigo fixo de 404: o mesmo para id inexistente, de outro profissional, conta sem perfil e id nao uuid. */
export const IDOC_NAO_ENCONTRADO: IdentityDocOutcome = { status: 404, corpo: { code: 'nao_encontrado' } };

/** Retry-After fixo do teto global (neutro: nao revela o valor do teto). */
export const IDOC_CAP_RETRY_S = 3600;

const RECUSA_STATUS: Readonly<Record<string, number>> = {
  arquivo_grande: 413,
  tipo_nao_aceito: 415,
  pdf_invalido: 422,
  pdf_protegido: 422,
  pdf_ativo: 422,
  imagem_invalida: 422,
  imagem_grande_demais: 422,
  nao_cabe_no_limite: 422,
  nao_processavel: 422,
};

function erro(status: number, code: string): IdentityDocOutcome {
  return { status, corpo: { code } };
}

function resposta429(retryAfterS: number): IdentityDocOutcome {
  return { status: 429, corpo: { code: 'muitas_tentativas' }, retryAfterS };
}

async function barradoPor(
  rate: IdentityDocRateLimiterPort,
  pares: readonly (readonly [IdentityDocRatePolicy, string])[],
): Promise<number | null> {
  let pior: number | null = null;
  for (const [policy, valor] of pares) {
    const r = await rate.check(policy, valor);
    if (!r.ok && (pior === null || r.retryAfterS > pior)) pior = r.retryAfterS;
  }
  return pior;
}

async function contar(
  rate: IdentityDocRateLimiterPort,
  pares: readonly (readonly [IdentityDocRatePolicy, string])[],
): Promise<void> {
  for (const [policy, valor] of pares) await rate.hit(policy, valor);
}

/** Qualquer falha de banco ou Storage vira 503 fixo, sem eco do erro (CA-10). */
async function protegido(fn: () => Promise<IdentityDocOutcome>): Promise<IdentityDocOutcome> {
  try {
    return await fn();
  } catch {
    return erro(503, 'servico_indisponivel');
  }
}

export interface EmitirEntrada {
  readonly userId: string;
  readonly ip: string;
  readonly corpo: IdentityDocEmissaoCorpo;
}

/** POST /v1/professional/documents/uploads: reserva a vaga e devolve a URL de envio de uso unico. */
export function emitirDocumento(entrada: EmitirEntrada, deps: IdentityDocServiceDeps): Promise<IdentityDocOutcome> {
  return protegido(async () => {
    const agora = deps.clock.nowMs();
    const ipHmac = deps.ipHmac(entrada.ip);
    const pares: readonly (readonly [IdentityDocRatePolicy, string])[] = [
      [IDOC_RATE_EMISSAO_PROFISSIONAL_HORA, entrada.userId],
      [IDOC_RATE_EMISSAO_PROFISSIONAL_DIA, entrada.userId],
      [IDOC_RATE_EMISSAO_IP_HORA, ipHmac],
      [IDOC_RATE_EMISSAO_IP_DIA, ipHmac],
    ];
    const espera = await barradoPor(deps.rate, pares);
    if (espera !== null) return resposta429(espera);

    const r = await deps.store.issue({
      userId: entrada.userId,
      clientUploadId: entrada.corpo.clientUploadId,
      declaredType: entrada.corpo.contentType,
      declaredBytes: entrada.corpo.sizeBytes,
      nowMs: agora,
      globalBytesCap: deps.globalBytesCap ?? IDOC_GLOBAL_BYTES_CAP,
    });
    switch (r.code) {
      case 'new':
      case 'replay': {
        if (r.id === null) return erro(503, 'servico_indisponivel');
        const url = await deps.staging.createUploadUrl(identityDocIncomingKey(r.id), IDOC_UPLOAD_URL_TTL_S);
        await contar(deps.rate, pares);
        return {
          status: r.code === 'new' ? 201 : 200,
          corpo: {
            id: r.id,
            status: 'em_envio',
            upload_url: url,
            upload_expires_at: new Date(agora + IDOC_UPLOAD_URL_TTL_S * 1000).toISOString(),
          },
        };
      }
      case 'replay_received':
        await contar(deps.rate, pares);
        return { status: 200, corpo: { id: r.id, status: 'recebido' } };
      case 'no_profile':
        return IDOC_NAO_ENCONTRADO;
      case 'email_unverified':
        return erro(403, 'email_nao_verificado');
      case 'state_denied':
        return erro(403, 'estado_perfil');
      case 'doc_limit':
        return erro(422, 'limite_documentos');
      case 'cap':
        return resposta429(IDOC_CAP_RETRY_S);
    }
  });
}

/** GET /v1/professional/documents: lista do dono, sem caminho, tamanho exato, tipo MIME ou nome. */
export function listarDocumentos(
  entrada: { readonly userId: string; readonly ip: string },
  deps: IdentityDocServiceDeps,
): Promise<IdentityDocOutcome> {
  return protegido(async () => {
    const ipHmac = deps.ipHmac(entrada.ip);
    const pares: readonly (readonly [IdentityDocRatePolicy, string])[] = [[IDOC_RATE_LEITURA_IP, ipHmac]];
    const espera = await barradoPor(deps.rate, pares);
    if (espera !== null) return resposta429(espera);
    const lista = await deps.store.list(entrada.userId);
    await contar(deps.rate, pares);
    return {
      status: 200,
      corpo: {
        documents: lista.documents.map((d) => ({
          id: d.id,
          kind: d.kind,
          status: d.status,
          receivedAt: d.receivedAt,
          deletable: d.deletable,
        })),
        slotsRemaining: lista.slotsRemaining,
      },
    };
  });
}

export interface FinalizarEntrada {
  readonly userId: string;
  readonly id: string;
}

/**
 * POST /v1/professional/documents/{id}/finalize. Idempotente: repetir depois de recebido responde 200 sem reler o
 * Storage. A ordem dos passos segue 107 §6.1; cada recusa definitiva grava o motivo fixo e apaga a entrada.
 */
export function finalizarDocumento(entrada: FinalizarEntrada, deps: IdentityDocServiceDeps): Promise<IdentityDocOutcome> {
  return protegido(async () => {
    const agora = deps.clock.nowMs();
    const pares: readonly (readonly [IdentityDocRatePolicy, string])[] = [[IDOC_RATE_FINALIZA_PROFISSIONAL, entrada.userId]];
    const espera = await barradoPor(deps.rate, pares);
    if (espera !== null) return resposta429(espera);

    const inicio = await deps.store.confirmBegin(entrada.userId, entrada.id, agora, IDOC_LEASE_S);
    switch (inicio.code) {
      case 'not_found':
        return IDOC_NAO_ENCONTRADO;
      case 'expired':
        return erro(409, 'upload_expirado');
      case 'busy':
        return erro(409, 'em_processamento');
      case 'too_many':
        return erro(409, 'tentativas_esgotadas');
      case 'replay': {
        const lista = await deps.store.list(entrada.userId);
        const doc = lista.documents.find((d) => d.id === entrada.id && d.status === 'recebido');
        if (doc === undefined) return IDOC_NAO_ENCONTRADO;
        return { status: 200, corpo: { id: doc.id, status: 'recebido', kind: doc.kind } };
      }
      case 'begin':
        break;
    }
    if (inicio.attempt === null) return erro(503, 'servico_indisponivel');
    await contar(deps.rate, pares);
    return processarEntrada(entrada, inicio.attempt, deps);
  });
}

async function processarEntrada(
  entrada: FinalizarEntrada,
  tentativa: number,
  deps: IdentityDocServiceDeps,
): Promise<IdentityDocOutcome> {
  const { userId, id } = entrada;
  const chave = identityDocIncomingKey(id);

  /** Recusa definitiva: grava o motivo, apaga a entrada (a varredura cobre o que sobrar). */
  const recusar = async (code: string): Promise<IdentityDocOutcome> => {
    await deps.store.confirmRefuse(userId, id, tentativa, code, deps.clock.nowMs());
    await deps.staging.remove(chave).catch(() => undefined);
    return erro(RECUSA_STATUS[code] ?? 422, code);
  };
  /** Falha transitoria: a tentativa conta (decisoes 84 a 86), e o cliente pode repetir. */
  const transitorio = async (): Promise<IdentityDocOutcome> => {
    await deps.store.confirmRelease(id, tentativa, true);
    return erro(503, 'servico_indisponivel');
  };

  const stat = await deps.staging.stat(chave);
  if (stat === null) {
    await deps.store.confirmRelease(id, tentativa, true);
    return erro(409, 'upload_nao_encontrado');
  }
  if (stat.bytes > IDOC_IMAGE_MAX_BYTES) return recusar('arquivo_grande');

  const vaga = await deps.gate.entrar();
  if (vaga === null) {
    await deps.store.confirmRelease(id, tentativa, false);
    return erro(503, 'servico_indisponivel');
  }
  let saida: { readonly bytes: Uint8Array; readonly tipo: 'image/jpeg' | 'application/pdf' };
  try {
    const original = await deps.staging.read(chave);
    if (original === null) {
      await deps.store.confirmRelease(id, tentativa, true);
      return erro(409, 'upload_nao_encontrado');
    }
    if (original.length > IDOC_IMAGE_MAX_BYTES) return recusar('arquivo_grande');
    const tipo = detectarTipoDocumento(original);
    if (tipo === null) return recusar('tipo_nao_aceito');

    if (tipo === 'application/pdf') {
      if (original.length > IDOC_PDF_MAX_BYTES) return recusar('arquivo_grande');
      const valido = validarPdf(original);
      if (!valido.ok) return recusar(valido.code);
      saida = { bytes: original, tipo: 'application/pdf' };
    } else {
      const r = await deps.reducer.reduce(original, { deadlineMs: MEDIA_REDUCE_DEADLINE_MS, orcamento: deps.gate });
      if (!r.ok && r.kind === 'transient') return transitorio();
      if (!r.ok) return recusar(r.code);
      saida = { bytes: r.bytes, tipo: 'image/jpeg' };
    }
  } finally {
    vaga.sair();
  }

  const sha256 = createHash('sha256').update(saida.bytes).digest();
  try {
    await deps.final.put(id, saida.bytes, saida.tipo);
    const conferido = await deps.final.stat(id);
    if (conferido === null || conferido.bytes !== saida.bytes.length) return transitorio();
  } catch {
    return transitorio();
  }

  const resultado = await deps.store.confirmDone(
    userId,
    id,
    tentativa,
    saida.tipo,
    saida.bytes.length,
    sha256,
    deps.clock.nowMs(),
  );
  if (resultado === 'lost') return erro(409, 'em_processamento');
  if (resultado === 'gone') {
    // Corrida com a exclusao: o final gravado acima ficou sem dono. Remove sem lancar; a resposta segue 404 uniforme.
    // Nao se remove no ramo 'lost': a tentativa vencedora pode ter gravado o final valido nessa mesma chave.
    await deps.final.remove(id).catch(() => undefined);
    return IDOC_NAO_ENCONTRADO;
  }
  await deps.staging.remove(chave).catch(() => undefined);
  return {
    status: 200,
    corpo: { id, status: 'recebido', kind: saida.tipo === 'application/pdf' ? 'pdf' : 'imagem' },
  };
}

/**
 * DELETE /v1/professional/documents/{id}: exclui enquanto nao analisado (decisao 180). Marca no banco antes; se o
 * Storage falhar, a linha continua marcada e a varredura repete (107 §6.4). Ja analisado: 409, o arquivo fica.
 */
export function excluirDocumento(entrada: FinalizarEntrada, deps: IdentityDocServiceDeps): Promise<IdentityDocOutcome> {
  return protegido(async () => {
    const codigo = await deps.store.remove(entrada.userId, entrada.id, deps.clock.nowMs());
    if (codigo === 'not_found') return IDOC_NAO_ENCONTRADO;
    if (codigo === 'already_analyzed') return erro(409, 'ja_analisado');
    try {
      await deps.staging.remove(identityDocIncomingKey(entrada.id));
      await deps.final.remove(entrada.id);
      await deps.store.purgeDone([entrada.id]);
    } catch {
      return erro(503, 'servico_indisponivel');
    }
    return { status: 204 };
  });
}
