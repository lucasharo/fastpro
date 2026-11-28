// Envio do push de um item do pipeline de avisos (job 'push.send'; o payload e so o id do item).
// Texto fixo por tipo de aviso: nenhum nome, telefone, endereco ou texto de pedido sai no push.
// Web vai pelo Web Push (VAPID); Android e iOS vao pelo servico de push do Expo, que entrega por FCM e APNs.
// Aparelho recusado em definitivo e descartado. So falha (com nova tentativa) quando nada foi entregue.
import type { AparelhoPush, JobContext, JobHandler, PgPushStore } from '@fastpro/db';
import { autorizacaoVapid, cifrar, endpointAceito, type ChavesVapid } from './web-push.js';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PRAZO_MS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Aviso {
  readonly titulo: string;
  readonly texto: string;
  /** Caminho relativo da web aberto no toque. */
  readonly caminho: string;
}

export function avisoDoItem(tipo: string, escopo: string): Aviso | null {
  const pedido = UUID_RE.test(escopo) ? `/painel/pedido/${escopo}` : '/painel';
  if (tipo === 'aceite_aviso' || tipo === 'aceite_resumo') {
    return { titulo: 'Pedido aceito', texto: 'Um profissional aceitou o seu pedido. Veja quem foi.', caminho: pedido };
  }
  if (tipo === 'selecao') {
    return { titulo: 'Você foi escolhido', texto: 'O cliente escolheu você para um pedido.', caminho: '/profissional/aceitos' };
  }
  if (tipo === 'selecao_outro') {
    return { titulo: 'Pedido definido', texto: 'O cliente escolheu outro profissional.', caminho: '/profissional/aceitos' };
  }
  if (tipo === 'cancelamento') {
    return { titulo: 'Pedido cancelado', texto: 'Um pedido que você aceitou foi cancelado.', caminho: '/profissional/aceitos' };
  }
  return null;
}

export function avisoDePedidoNovo(pedido: string, servico: string): Aviso {
  return {
    titulo: 'Novo pedido na sua região',
    texto: `Há um pedido de ${servico}. Veja e aceite.`,
    caminho: `/profissional/pedidos/${pedido}`,
  };
}

export interface PushEnvioDeps {
  readonly store: Pick<PgPushStore, 'alvosDoItem' | 'alvosDoPedidoNovo' | 'descartar'>;
  /** Ausente: aparelhos web sao ignorados (sem chaves VAPID configuradas). */
  readonly vapid?: ChavesVapid | undefined;
  /** Opcional: exigido pelo Expo so quando a seguranca reforcada esta ligada na conta. */
  readonly expoToken?: string | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly agoraMs?: () => number;
}

type Resultado = 'entregue' | 'descartado' | 'ignorado' | 'falha';

export class PushEnvioError extends Error {
  constructor() {
    super('push nao entregue');
    this.name = 'PushEnvioError';
  }
}

export class PushSendHandler implements JobHandler {
  constructor(private readonly deps: PushEnvioDeps) {}

  async run(job: JobContext): Promise<void> {
    const item = job.payload_ref ?? '';
    if (!UUID_RE.test(item)) return;
    const alvos = await this.deps.store.alvosDoItem(item);
    await this.entregar(
      alvos.map((a) => [a, avisoDoItem(a.emailType, a.scopeKey)] as const),
      item,
    );
  }

  /** Falha (para tentar de novo) so quando houve erro e nada foi entregue. */
  protected async entregar(alvos: readonly (readonly [AparelhoPush, Aviso | null])[], tag: string): Promise<void> {
    const resultados = await Promise.all(
      alvos.map(async ([alvo, aviso]): Promise<Resultado> => {
        if (aviso === null) return 'ignorado';
        try {
          return alvo.platform === 'web' ? await this.web(alvo, aviso, tag) : await this.expo(alvo, aviso);
        } catch {
          return 'falha';
        }
      }),
    );
    if (resultados.includes('falha') && !resultados.includes('entregue')) throw new PushEnvioError();
  }

  private async web(alvo: AparelhoPush, aviso: Aviso, item: string): Promise<Resultado> {
    const { vapid } = this.deps;
    if (vapid === undefined || alvo.p256dh === null || alvo.auth === null) return 'ignorado';
    if (!endpointAceito(alvo.token)) return this.descartar(alvo);
    const corpo = cifrar(Buffer.from(JSON.stringify({ ...aviso, tag: item })), { p256dh: alvo.p256dh, auth: alvo.auth });
    const r = await (this.deps.fetchImpl ?? fetch)(alvo.token, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: autorizacaoVapid(alvo.token, vapid, (this.deps.agoraMs ?? Date.now)()),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: new Uint8Array(corpo),
      signal: AbortSignal.timeout(PRAZO_MS),
    });
    if (r.status === 404 || r.status === 410) return this.descartar(alvo);
    return r.ok ? 'entregue' : 'falha';
  }

  private async expo(alvo: AparelhoPush, aviso: Aviso): Promise<Resultado> {
    const r = await (this.deps.fetchImpl ?? fetch)(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.deps.expoToken ? { Authorization: `Bearer ${this.deps.expoToken}` } : {}),
      },
      body: JSON.stringify({
        to: alvo.token,
        title: aviso.titulo,
        body: aviso.texto,
        sound: 'default',
        channelId: 'default',
        data: { caminho: aviso.caminho },
      }),
      signal: AbortSignal.timeout(PRAZO_MS),
    });
    if (!r.ok) return 'falha';
    const corpo = (await r.json()) as { data?: { status?: string; details?: { error?: string } } };
    if (corpo.data?.status === 'ok') return 'entregue';
    return corpo.data?.details?.error === 'DeviceNotRegistered' ? this.descartar(alvo) : 'falha';
  }

  private async descartar(alvo: AparelhoPush): Promise<Resultado> {
    await this.deps.store.descartar(alvo.token);
    return 'descartado';
  }
}

/** Job 'push.request': pedido publicado (ou segunda onda); o payload e so o id do pedido. */
export class PushPedidoNovoHandler extends PushSendHandler {
  constructor(private readonly dados: PushEnvioDeps) {
    super(dados);
  }

  override async run(job: JobContext): Promise<void> {
    const pedido = job.payload_ref ?? '';
    if (!UUID_RE.test(pedido)) return;
    const alvos = await this.dados.store.alvosDoPedidoNovo(pedido, new Date((this.dados.agoraMs ?? Date.now)()));
    await this.entregar(
      alvos.map((a) => [a, avisoDePedidoNovo(pedido, a.servico)] as const),
      pedido,
    );
  }
}
