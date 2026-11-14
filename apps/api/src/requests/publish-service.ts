// H-031 (Issue #44) | Servico da publicacao idempotente do pedido (docs/factory/110-DESENHO-H031.md, §2, §3, §5, §6).
// Ordem: begin (banco, sem custo) -> geocodificacao fora de transacao (porta; so com provedor) -> commit (banco).
// Toda saida que nao cria nem repete o pedido chama abort (libera a chave que a propria API abriu).
// Nenhum erro interno sai daqui: falha vira codigo fixo. Nada de coordenada, endereco, e-mail ou nome na resposta.
// Issue 47 (H-034): o cookie do rascunho expira em toda resposta de sucesso da publicacao (decisao 519).
import { DRAFT_CLEAR_COOKIE_HEADER } from '@fastpro/domain';
import {
  DRAFT_HEADERS,
  DRAFT_NOT_FOUND_BODY,
  PUBLISH_ERROR_RESPONSES,
  issueDuplicateAck,
  derivePublicLabel,
  publishBodyHash,
  verifyDuplicateAck,
  normalizePhoneBr,
  CONTACT_CONSENT_VERSION,
  type PublishBody,
} from '@fastpro/domain';
import type {
  PublishAbortInput,
  PublishBeginInput,
  PublishBeginOutcome,
  PublishCommitInput,
  PublishCommitOutcome,
} from '@fastpro/db';
import type { DraftHasher } from '../drafts/draft-hash.js';
import type { AddressVault } from './address-crypto.js';
import type { PgContactStore } from '@fastpro/db';
import type { PhoneVault } from '../contact/phone-crypto.js';
import { ensurePermanentPoint, type EnsurePermanentDeps } from '../geo/permanent-geocode-service.js';
import { randomUUID } from 'node:crypto';

/** Porta do banco da publicacao (implementada por PgRequestPublishStore). */
export interface PublishStorePort {
  begin(input: PublishBeginInput): Promise<PublishBeginOutcome>;
  commit(input: PublishCommitInput): Promise<PublishCommitOutcome>;
  abort(input: PublishAbortInput): Promise<boolean>;
}

export interface PublishServiceDeps {
  readonly store: PublishStorePort;
  /** Geocodificacao permanente (mesmas portas da H-036; assunto = id do rascunho, decisao 239). */
  readonly geo: EnsurePermanentDeps;
  readonly hasher: DraftHasher;
  /** Chave HMAC dos baldes de taxa e do token de duplicidade (REQUEST_PUBLISH_HMAC_KEY, >= 32). */
  readonly chave: string;
  /** rateKey(finalidade, identificador): HMAC com separacao de dominio. Ex.: 'publish:user', userId. */
  readonly rateKey: (finalidade: string, identificador: string) => string;
  readonly clock: { nowMs(): number };
  /**
   * Cofre do endereco (Issue 45, §3). Sem ele o servico responde 503 publicacao_indisponivel antes de abrir o banco.
   * Opcional no tipo so para que os testes da Issue 44 montados sem cofre continuem compilando; a montagem real sempre passa.
   */
  readonly addressVault?: AddressVault;
  /** Gerador do id do pedido (padrao: uuid v4). Injetavel para teste. */
  readonly novoId?: () => string;
  /**
   * Telefone opcional (Issue 46, H-033): cofre e porta de anexo. Sem ele, publicacao com telefone responde 503 antes do banco;
   * publicacao sem telefone segue igual.
   */
  readonly telefone?: { readonly store: Pick<PgContactStore, 'attachPhone'>; readonly cofre: Pick<PhoneVault, 'seal'> };
}

export interface PublishRequestInput {
  readonly body: PublishBody;
  readonly idemKey: string;
  /** Segredo do cookie do rascunho (prova de posse, D-02). */
  readonly secret: string;
  readonly userId: string;
  /** IP normalizado (entra so como HMAC na taxa). */
  readonly ip: string;
}

export interface PublishOutcome {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const MAPA_GEO: Readonly<Record<string, string>> = {
  em_andamento: 'geocodificacao_em_andamento',
  teto: 'geocode_limit',
  endereco_nao_encontrado: 'endereco_nao_encontrado',
  entrada_invalida: 'endereco_invalido',
  aguardando_geocodificacao: 'aguardando_geocodificacao',
  indisponivel: 'indisponivel',
};

function resposta(status: number, corpo: unknown, extra: Record<string, string> = {}): PublishOutcome {
  return { status, headers: { ...DRAFT_HEADERS, ...extra }, body: JSON.stringify(corpo) };
}

/** Erro fechado a partir do mapa de §3.1 (codigo fixo, sem detalhe). */
function porCodigo(codigo: string, extra?: { readonly missing?: readonly string[] }): PublishOutcome {
  const r = PUBLISH_ERROR_RESPONSES[codigo];
  if (r === undefined) return resposta(503, { code: 'indisponivel' }, { 'Retry-After': '10' });
  const cabecalhos: Record<string, string> = r.retryAfter === undefined ? {} : { 'Retry-After': String(r.retryAfter) };
  const corpo = extra?.missing === undefined ? { code: r.code } : { code: r.code, missing: [...extra.missing] };
  return resposta(r.status, corpo, cabecalhos);
}

function corpoDoPedido(pedido: { id: string; publishedAt: string; acceptanceDeadlineAt: string }): Record<string, string> {
  return {
    id: pedido.id,
    status: 'publicado',
    publishedAt: pedido.publishedAt,
    acceptanceDeadlineAt: pedido.acceptanceDeadlineAt,
  };
}

/** Le o id do pedido semelhante do token (campo "s") sem verificar; a verificacao vem depois, com o mesmo campo. */
function similarDoToken(token: string): string | null {
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  try {
    const dados = JSON.parse(Buffer.from(partes[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    return typeof dados.s === 'string' ? dados.s : null;
  } catch {
    return null;
  }
}

export async function publishRequest(input: PublishRequestInput, deps: PublishServiceDeps): Promise<PublishOutcome> {
  const agora = deps.clock.nowMs();
  const addressVault = deps.addressVault;
  if (addressVault === undefined) return resposta(503, { code: 'publicacao_indisponivel' }, { 'Retry-After': '10' });
  const { body, userId } = input;
  // Issue 46 (H-033): telefone opcional, validado antes de qualquer escrita. Sem cifra configurada, 503 antes do banco.
  const telefoneE164 = body.phone === undefined ? undefined : normalizePhoneBr(body.phone);
  if (body.sharePhone === true && body.phone === undefined) return resposta(400, { code: 'telefone_necessario' });
  if (body.phone !== undefined && telefoneE164 === null) return resposta(422, { code: 'telefone_invalido' });
  if (body.phone !== undefined && deps.telefone === undefined) {
    return resposta(503, { code: 'publicacao_indisponivel' }, { 'Retry-After': '10' });
  }
  const bodyHash = publishBodyHash(body);
  const chaveBanco = { userId, idemKey: input.idemKey, bodyHash };
  // Melhor esforco: a resposta ao cliente nao depende do abort. Se ele falhar, a chave em andamento libera pelo prazo (lease).
  const abortar = async (): Promise<void> => {
    try {
      await deps.store.abort(chaveBanco);
    } catch {
      // Sem acao: ver comentario acima.
    }
  };
  const base = {
    userId,
    draftId: body.draftId,
    secretHash: deps.hasher.secretHash(input.secret),
    idemKey: input.idemKey,
    bodyHash,
    contentRev: body.contentRev,
  };

  let inicio: PublishBeginOutcome;
  try {
    inicio = await deps.store.begin({
      ...base,
      userRateKey: deps.rateKey('publish:user', userId),
      ipRateKey: deps.rateKey('publish:ip', input.ip),
      nowMs: agora,
    });
  } catch {
    return porCodigo('indisponivel');
  }

  if (inicio.status === 'repetida') return resposta(201, corpoDoPedido(inicio.pedido), { 'Set-Cookie': DRAFT_CLEAR_COOKIE_HEADER });
  if (inicio.status === 'ja_publicado') return resposta(200, corpoDoPedido(inicio.pedido), { 'Set-Cookie': DRAFT_CLEAR_COOKIE_HEADER });
  if (inicio.status === 'campos_faltando') return porCodigo('campos_faltando', { missing: inicio.missing });
  if (inicio.status === 'limite') return resposta(429, { code: 'limite' }, { 'Retry-After': String(inicio.retryAfter) });
  if (inicio.status !== 'ok') return porCodigo(inicio.status === 'conflito' ? 'conflito' : inicio.status);

  // Geocodificacao: fora de transacao, so depois das recusas baratas (110 §2, passo 3).
  let pontoId: string;
  try {
    const geo = await ensurePermanentPoint({ subject: body.draftId, addressText: inicio.addressText }, deps.geo);
    if (geo.status !== 'ok') {
      await abortar();
      const codigo = MAPA_GEO[geo.status] ?? 'indisponivel';
      return porCodigo(codigo);
    }
    pontoId = geo.pointId;
  } catch {
    await abortar();
    return porCodigo('indisponivel');
  }

  // Token de duplicidade: so vale para o mesmo usuario, rascunho, versao e pedido semelhante, e dentro de 300 s.
  const semelhante = body.duplicateAck === undefined ? null : similarDoToken(body.duplicateAck);
  const ack =
    semelhante !== null &&
    body.duplicateAck !== undefined &&
    verifyDuplicateAck(
      deps.chave,
      body.duplicateAck,
      { userId, draftId: body.draftId, contentRev: body.contentRev, similarRequestId: semelhante },
      agora,
    );

  // Issue 45: a API gera o id do pedido, cifra o endereco (AAD = id) e deriva o rotulo. Falha vira 503 fixo.
  const requestId = (deps.novoId ?? randomUUID)();
  let addressEnc: Buffer;
  let telefoneEnc: Buffer | undefined;
  let publicLabel: string | null;
  try {
    addressEnc = addressVault.seal(inicio.addressText, requestId);
    publicLabel = derivePublicLabel(inicio.addressText);
    if (telefoneE164 && deps.telefone !== undefined) telefoneEnc = deps.telefone.cofre.seal(telefoneE164, requestId);
  } catch {
    await abortar();
    return porCodigo('indisponivel');
  }

  let saida: PublishCommitOutcome;
  try {
    saida = await deps.store.commit({ ...base, pointId: pontoId, ack, nowMs: agora, requestId, addressEnc, publicLabel });
  } catch (erro) {
    await abortar();
    const perdida = erro instanceof Error && erro.message === 'publicacao_chave_perdida';
    return porCodigo(perdida ? 'publicacao_chave_perdida' : 'indisponivel');
  }

  if (saida.status === 'criado' || saida.status === 'ja_publicado') {
    // Issue 46: anexo do telefone depois do commit. Falha nao desfaz a publicacao: o dono repete pela rota de troca.
    if (saida.status === 'criado' && telefoneEnc !== undefined && deps.telefone !== undefined) {
      try {
        await deps.telefone.store.attachPhone(userId, requestId, telefoneEnc, body.sharePhone === true, CONTACT_CONSENT_VERSION, agora);
      } catch {
        // Sem acao: o registro nao carrega o numero nem o erro do driver.
      }
    }
    return resposta(saida.status === 'criado' ? 201 : 200, corpoDoPedido(saida.pedido), { 'Set-Cookie': DRAFT_CLEAR_COOKIE_HEADER });
  }
  await abortar();
  if (saida.status === 'duplicidade') {
    const aviso = issueDuplicateAck(
      deps.chave,
      { userId, draftId: body.draftId, contentRev: body.contentRev, similarRequestId: saida.similar.id },
      agora,
    );
    return resposta(409, {
      code: 'duplicidade',
      similar: {
        id: saida.similar.id,
        publishedAt: saida.similar.publishedAt,
        serviceName: saida.similar.serviceName,
      },
      ackToken: aviso.token,
      ackExpiresAt: new Date(aviso.expiresAtMs).toISOString(),
    });
  }
  if (saida.status === 'campos_faltando') return porCodigo('campos_faltando', { missing: saida.missing });
  if (saida.status === 'ponto_invalido') return porCodigo('indisponivel');
  return porCodigo(saida.status);
}

/** Resposta fixa de rascunho inexistente (byte a byte igual a draftNotFound da #43). */
export function publicacaoNaoEncontrada(): PublishOutcome {
  return resposta(404, DRAFT_NOT_FOUND_BODY);
}
