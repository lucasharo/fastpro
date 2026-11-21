// H-056 (Issue 69) | Entrega da foto com marca d'agua (docs/factory/167-DESENHO-H056.md, §4.3, §6, A-3, A-7, A-10).
// Ordem: token (HMAC e validade, sem banco) -> limite photo_deliver por usuario do token -> reconferencia do acesso
// no banco (A-3) -> leitura do bucket reduzido -> fotoReduzidaValida -> vaga do gate -> render com teto de 5 s.
// Nada e gravado: o JPEG derivado existe so em memoria. Recusa vira 404 uniforme; falha nossa vira 503 fixo.
// Contadores operacionais de nome fixo (sem identificador, token ou pedido).
import {
  fotoReduzidaValida,
  watermarkIdOf,
  type PhotoTarget,
  type PhotoTokenCodec,
  type PhotoVariant,
  type PhotoViewStorePort,
  type RateWindowDecision,
  type ReducedPhotoReaderPort,
  type WatermarkComposerPort,
} from '@fastpro/domain';

/** Teto da renderizacao (decisao 844, A-7): ao estourar, 503 renderizacao_indisponivel. */
export const RENDER_TIMEOUT_MS = 5000 as const;

export type ContadorEntrega =
  | 'foto_ok'
  | 'foto_404'
  | 'foto_429'
  | 'foto_503_gate'
  | 'foto_503_timeout'
  | 'foto_503_render'
  | 'foto_503_indisponivel'
  | 'leitura_divergente'
  | 'token_invalido';

/** Vaga do gate de renderizacao (ReduceGate.entrar devolve uma vaga com sair()). */
export interface VagaRender {
  sair(): void;
}

export interface WatermarkDeliveryDeps {
  readonly store: PhotoViewStorePort;
  readonly reader: ReducedPhotoReaderPort;
  readonly composer: WatermarkComposerPort;
  readonly gate: { entrar(): Promise<VagaRender | null> };
  readonly codec: PhotoTokenCodec;
  readonly limite: {
    check(usuarioId: string, nowMs: number): Promise<RateWindowDecision>;
    record(usuarioId: string, nowMs: number): Promise<void>;
  };
  /** Segredo do identificador impresso (WATERMARK_ID_SALT). Nunca registrado. */
  readonly idSalt: string;
  readonly clock: { nowMs(): number };
  /** Teto da renderizacao; padrao RENDER_TIMEOUT_MS. Parametro so para teste. */
  readonly tempoLimiteMs?: number;
  readonly contador?: (nome: ContadorEntrega) => void;
}

export type EntregaFoto =
  | { readonly status: 200; readonly jpeg: Uint8Array }
  | { readonly status: 404 }
  | { readonly status: 429; readonly retryAfterS: number }
  | { readonly status: 503; readonly code: 'indisponivel' | 'renderizacao_indisponivel' };

const NEGADO: EntregaFoto = { status: 404 };
const INDISPONIVEL: EntregaFoto = { status: 503, code: 'indisponivel' };
const RENDER_INDISPONIVEL: EntregaFoto = { status: 503, code: 'renderizacao_indisponivel' };

/** Entrega a foto marcada (profissional) ou sem marca (dono) para o token recebido. */
export async function entregarFoto(token: string, deps: WatermarkDeliveryDeps): Promise<EntregaFoto> {
  const conta = (nome: ContadorEntrega): void => deps.contador?.(nome);
  const agora = deps.clock.nowMs();
  const claims = deps.codec.verify(token, agora);
  if (claims === null) {
    conta('token_invalido');
    return NEGADO;
  }
  try {
    const cota = await deps.limite.check(claims.userId, agora);
    if (cota.decision === 'barrado') {
      conta('foto_429');
      return { status: 429, retryAfterS: cota.retryAfterSeconds };
    }
    await deps.limite.record(claims.userId, agora);

    // Reconferencia (A-3): acesso e foto sao lidos no banco a cada entrega, nao so no momento do link.
    const alvo: PhotoTarget | null =
      claims.mode === 'professional'
        ? await deps.store.target(claims.userId, claims.requestId, claims.photoId, agora)
        : await deps.store.ownerTarget(claims.userId, claims.requestId, claims.photoId);
    if (alvo === null) {
      conta('foto_404');
      return NEGADO;
    }

    const bytes = await deps.reader.readReduced(claims.photoId);
    if (bytes === null || !fotoReduzidaValida(bytes, alvo.bytes)) {
      conta('leitura_divergente');
      return INDISPONIVEL;
    }

    // Rotulo calculado antes de tomar a vaga: falha aqui nao pode deixar a vaga presa.
    const rotulo = claims.mode === 'professional' ? watermarkIdOf(claims.userId, deps.idSalt) : null;
    const vaga = await deps.gate.entrar();
    if (vaga === null) {
      conta('foto_503_gate');
      return RENDER_INDISPONIVEL;
    }
    return await renderizar(bytes, claims.variant, rotulo, vaga, deps, conta);
  } catch {
    conta('foto_503_indisponivel');
    return INDISPONIVEL;
  }
}

async function renderizar(
  bytes: Uint8Array,
  variant: PhotoVariant,
  rotulo: string | null,
  vaga: VagaRender,
  deps: WatermarkDeliveryDeps,
  conta: (nome: ContadorEntrega) => void,
): Promise<EntregaFoto> {
  const controle = new AbortController();
  // A conversao nunca rejeita: qualquer falha do compositor vira 'unavailable'.
  const tarefa = Promise.resolve()
    .then(() => deps.composer.compose(bytes, { variant, label: rotulo, signal: controle.signal }))
    .catch(() => ({ ok: false as const, kind: 'unavailable' as const }));
  // A vaga volta quando a renderizacao realmente termina, inclusive depois do teto: o sharp nao interrompe a
  // conta no meio, e liberar antes permitiria mais de duas renderizacoes em paralelo por instancia.
  void tarefa.then(() => vaga.sair());

  let relogio: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<'timeout'>((resolve) => {
    relogio = setTimeout(() => {
      controle.abort();
      resolve('timeout');
    }, deps.tempoLimiteMs ?? RENDER_TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([tarefa, teto]);
    if (r === 'timeout') {
      conta('foto_503_timeout');
      return RENDER_INDISPONIVEL;
    }
    if (!r.ok) {
      if (r.kind === 'invalid') {
        conta('leitura_divergente');
        return INDISPONIVEL;
      }
      conta('foto_503_render');
      return RENDER_INDISPONIVEL;
    }
    conta('foto_ok');
    return { status: 200, jpeg: r.jpeg };
  } finally {
    clearTimeout(relogio);
  }
}
