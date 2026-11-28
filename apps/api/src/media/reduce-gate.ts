// H-027 (Issue #40) | Limite de reducoes por instancia (docs/factory/93-DESENHO-H027.md, §4.3; CA-07).
// Quatro reducoes simultaneas e um orcamento de 128 MP de area em voo. A vaga e tomada ANTES de ler o original
// e de gravar a lease no banco. Sem vaga em 2 s: a chamada recebe 503 sem tocar o banco. Memoria em processo:
// cada instancia tem o seu limite (a Vercel pode ter varias instancias; o limite e por instancia).
import { MEDIA_REDUCE_MAX_CONCURRENT, MEDIA_REDUCE_PIXEL_BUDGET, MEDIA_REDUCE_WAIT_MS, type ReduceBudgetPort } from '@fastpro/domain';

export interface ReduceGateOpcoes {
  readonly maxConcurrent?: number;
  readonly budgetPx?: number;
  readonly waitMs?: number;
  /** Relogio e espera injetaveis (testes com tempo controlado). */
  readonly agora?: () => number;
  readonly dormir?: (ms: number) => Promise<void>;
}

export interface VagaReducao {
  sair(): void;
}

export class ReduceGate implements ReduceBudgetPort {
  private emUso = 0;
  private areaEmUso = 0;
  private readonly maximo: number;
  private readonly orcamento: number;
  private readonly espera: number;
  private readonly agora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;

  constructor(opts: ReduceGateOpcoes = {}) {
    this.maximo = opts.maxConcurrent ?? MEDIA_REDUCE_MAX_CONCURRENT;
    this.orcamento = opts.budgetPx ?? MEDIA_REDUCE_PIXEL_BUDGET;
    this.espera = opts.waitMs ?? MEDIA_REDUCE_WAIT_MS;
    this.agora = opts.agora ?? (() => Date.now());
    this.dormir = opts.dormir ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  /** Quantas reducoes estao em curso agora (medicao de R-07). */
  emAndamento(): number {
    return this.emUso;
  }

  /** Vaga de reducao, ou null quando nao liberou em ate waitMs. */
  async entrar(): Promise<VagaReducao | null> {
    // Checagem e incremento no mesmo passo sincrono: nao ha janela entre ver a vaga livre e toma-la.
    const tomou = await this.tentar(() => {
      if (this.emUso >= this.maximo) return false;
      this.emUso++;
      return true;
    });
    if (!tomou) return null;
    let saiu = false;
    return {
      sair: (): void => {
        if (saiu) return;
        saiu = true;
        this.emUso--;
      },
    };
  }

  /** Reserva a area lida em metadata() no orcamento de pixels em voo; null quando nao cabe no prazo. */
  async reservar(areaPx: number): Promise<{ liberar(): void } | null> {
    if (areaPx > this.orcamento) return null;
    const tomou = await this.tentar(() => {
      if (this.areaEmUso + areaPx > this.orcamento) return false;
      this.areaEmUso += areaPx;
      return true;
    });
    if (!tomou) return null;
    let liberou = false;
    return {
      liberar: (): void => {
        if (liberou) return;
        liberou = true;
        this.areaEmUso -= areaPx;
      },
    };
  }

  /** Tenta tomar a vaga ate waitMs; tomar() faz a checagem e a reserva de uma vez, sem await no meio. */
  private async tentar(tomar: () => boolean): Promise<boolean> {
    const fim = this.agora() + this.espera;
    for (;;) {
      if (tomar()) return true;
      if (this.agora() >= fim) return false;
      await this.dormir(10);
    }
  }
}
