// H-092 | Dublês offline do pipeline de notificacoes (desenho 35 §4.3). Nenhum faz rede nem envia e-mail.
// O provedor simulado registra as chamadas e devolve respostas roteirizadas (padrao: aceito).
import type {
  ClockPort,
  EmailMessage,
  EmailProviderPort,
  EventView,
  ItemView,
  NotificationRule,
  RecipientDirectoryPort,
  RecipientResolution,
  RuleTarget,
  SendResult,
  Verdict,
} from '@fastpro/domain';

export const PACKAGE_NAME = '@fastpro/testkit' as const;

/** Provedor simulado: nunca abre conexao. Respostas na ordem do roteiro; sem roteiro = aceito. */
export class FakeEmailProvider implements EmailProviderPort {
  readonly name = 'simulado';
  /** Todas as chamadas recebidas, na ordem (inclui as recusadas). */
  readonly calls: EmailMessage[] = [];
  private readonly script: SendResult[] = [];
  private accepts = 0;

  queue(...results: SendResult[]): this {
    this.script.push(...results);
    return this;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    this.calls.push(message);
    const next = this.script.shift();
    if (next) return next;
    this.accepts += 1;
    return { kind: 'aceito', providerMessageId: `sim-${this.accepts}` };
  }

  /** Quantas respostas "aceito" o simulado devolveu (e-mails que sairiam). */
  get accepted(): number {
    return this.accepts;
  }
}

/** Diretorio em memoria. Usuario nao cadastrado = inexistente. */
export class FakeRecipientDirectory implements RecipientDirectoryPort {
  private readonly entries = new Map<string, RecipientResolution>();
  readonly lookups: string[] = [];

  set(userId: string, resolution: RecipientResolution): this {
    this.entries.set(userId, resolution);
    return this;
  }

  async resolve(userId: string): Promise<RecipientResolution> {
    this.lookups.push(userId);
    return this.entries.get(userId) ?? { status: 'inexistente' };
  }
}

/** Relogio controlado: sleep avanca o tempo simulado e registra a pausa. */
export class FakeClock implements ClockPort {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(startIso = '2026-11-11T12:00:00.000Z') {
    this.current = Date.parse(startIso);
  }

  nowMs(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
  }
}

/** Regra de teste: resolve e validade vem de funcoes ou de um mapa item -> veredito. */
export class StubRule implements NotificationRule {
  readonly eventType: string;
  readonly emailTypes: readonly string[];
  private readonly resolver: (event: EventView) => readonly RuleTarget[];
  private readonly verdicts = new Map<string, Verdict>();
  private defaultVerdict: Verdict = 'valido';

  constructor(opts: {
    eventType: string;
    emailTypes: readonly string[];
    resolve?: (event: EventView) => readonly RuleTarget[];
  }) {
    this.eventType = opts.eventType;
    this.emailTypes = opts.emailTypes;
    this.resolver = opts.resolve ?? (() => []);
  }

  /** Define o veredito de um item (por id). Sem definicao, vale o padrao. */
  setVerdict(itemId: string, verdict: Verdict): this {
    this.verdicts.set(itemId, verdict);
    return this;
  }

  setDefaultVerdict(verdict: Verdict): this {
    this.defaultVerdict = verdict;
    return this;
  }

  async resolve(event: EventView): Promise<readonly RuleTarget[]> {
    return this.resolver(event);
  }

  async isStillRelevant(item: ItemView): Promise<Verdict> {
    return this.verdicts.get(item.id) ?? this.defaultVerdict;
  }
}
