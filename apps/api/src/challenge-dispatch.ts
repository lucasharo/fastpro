// H-097 (Issue 107) | Adaptador de producao de OutboxDispatchPort (RN-1; 86 §1). schedule(id) agenda o envio
// do login depois da resposta pela primitiva da plataforma (waitUntil). Sem primitiva, nada e agendado:
// o job email.send de contingencia, criado na mesma transacao do desafio, entrega no proximo tick.
// Falha do envio nao muda a resposta 202 e nao registra detalhe (so o fato, sem dado pessoal).
import type { OutboxDispatchPort } from '@fastpro/db';

/** Primitiva de execucao pos-resposta da plataforma (na Vercel, waitUntil). */
export type WaitUntil = (promessa: Promise<unknown>) => void;

export interface DespachoPosRespostaOpcoes {
  /** Envio de uma saida ja criada (dispatchChallengeOutbox com as dependencias de envio). */
  readonly enviar: (outboxId: string) => Promise<void>;
  /** Primitiva pos-resposta. Ausente: schedule nao faz nada e a contingencia do tick cobre o envio. */
  readonly waitUntil?: WaitUntil;
  /** Chamado so quando o envio falha. Recebe apenas um codigo fixo. */
  readonly onFalha?: (codigo: 'envio_pos_resposta') => void;
}

export function criarDespachoPosResposta(opcoes: DespachoPosRespostaOpcoes): OutboxDispatchPort {
  return {
    schedule(outboxId: string): void {
      const { waitUntil } = opcoes;
      if (waitUntil === undefined) return;
      const envio = Promise.resolve()
        .then(() => opcoes.enviar(outboxId))
        .catch(() => {
          opcoes.onFalha?.('envio_pos_resposta');
        });
      waitUntil(envio);
    },
  };
}
