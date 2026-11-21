// Issue 120 (H-111) | Ligacao do envio do codigo do step-up do titular ao pipeline de ops.email_outbox (P-C; 147 §4.1).
// Depois que app.dsr_step_up_issue cria a linha de saida (classe auth, tipo dsr_stepup), o envio e agendado pela
// primitiva pos-resposta (waitUntil) e roda processOutbox: mesma revalidacao, mesma cota e mesmo espacamento do
// pipeline existente. Sem waitUntil nada e agendado e a linha fica pendente: este modulo NAO cria tick nem contingencia.
// O decorador DsrStepUpEmailProvider troca a referencia pelo codigo so em memoria, no instante do envio. Nada e logado.
import { NotificationRuleRegistry, type ClockPort, type EmailProviderPort } from '@fastpro/domain';
import {
  DsrStepUpEmailProvider,
  PgDsrTitularDirectory,
  processOutbox,
  SendPacer,
  type NotificationDeps,
  type ServicoDsrStepUp,
  type SqlClient,
} from '@fastpro/db';
import { criarDespachoPosResposta, type WaitUntil } from '../challenge-dispatch.js';

/** Minutos de validade do codigo no e-mail (privacy.dsr_step_up_code_minutes, padrao da migracao 20261120600000). */
export const MINUTOS_CODIGO_STEPUP = 10;

export interface EnvioStepUpOpcoes {
  /** Cliente do papel app_system (o mesmo do servico de step-up). */
  readonly client: SqlClient;
  /** Provedor de e-mail real (renderizador que conhece o modelo dsr_stepup). */
  readonly email: EmailProviderPort;
  readonly relogio: ClockPort;
  /** Primitiva pos-resposta da plataforma. Ausente: a linha fica pendente (nao ha tick neste fluxo). */
  readonly waitUntil?: WaitUntil;
  /** Metrica de codigo fixo, sem dado pessoal. */
  readonly metrica?: (nome: string, rotulos: Readonly<Record<string, string>>) => void;
}

/**
 * Devolve o par emitir/confirmar do step-up com o envio agendado depois da emissao. A confirmacao segue igual.
 * Emissao recusada (limite, bloqueio, negado) nao agenda nada e devolve o mesmo resultado do servico.
 */
export function comEnvioStepUp(
  servico: ServicoDsrStepUp,
  opcoes: EnvioStepUpOpcoes,
): Pick<ServicoDsrStepUp, 'emitir' | 'confirmar'> {
  const notificacao: NotificationDeps = {
    client: opcoes.client,
    registry: new NotificationRuleRegistry(),
    provider: new DsrStepUpEmailProvider(opcoes.email, servico, MINUTOS_CODIGO_STEPUP),
    directory: new PgDsrTitularDirectory(opcoes.client),
    clock: opcoes.relogio,
    useDbClock: true,
  };
  const despacho = criarDespachoPosResposta({
    enviar: (outboxId) => processOutbox(notificacao, outboxId, new SendPacer(opcoes.relogio)),
    ...(opcoes.waitUntil !== undefined ? { waitUntil: opcoes.waitUntil } : {}),
    onFalha: (codigo) => opcoes.metrica?.('envio_stepup_falhou', { codigo }),
  });
  return {
    emitir: async (usuario) => {
      const resultado = await servico.emitir(usuario);
      if (resultado.resultado === 'criado') despacho.schedule(resultado.outboxId);
      return resultado;
    },
    confirmar: (usuario, codigo) => servico.confirmar(usuario, codigo),
  };
}
