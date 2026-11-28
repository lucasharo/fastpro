// Regras de tela da Gestao profissional (passos): a partir do que a API devolveu, diz a situacao de cada passo. Funcao pura.
// A API e o banco continuam decidindo o acesso; aqui so se explica o que falta.

export type SituacaoPasso = 'feito' | 'agora' | 'aguardando' | 'atencao' | 'bloqueado';

export interface ServicoDoProfissional {
  readonly serviceId: string;
  readonly name: string;
  readonly regulated?: boolean;
}

export interface ArquivoRecebido {
  readonly id: string;
  readonly receivedAt: string | null;
  readonly deletable: boolean;
  readonly pdf?: boolean;
}

export interface DadosPassos {
  readonly areaDefinida: boolean;
  readonly totalServicos: number;
  readonly regulamentados: readonly ServicoDoProfissional[];
  /** Documento de identidade recebido. */
  readonly temIdentidade: boolean;
  /** Ids dos servicos com certificacao recebida. */
  readonly certificados: readonly string[];
  /** Arquivos de certificacao recebidos, por id do servico. */
  readonly arquivos?: Readonly<Record<string, readonly ArquivoRecebido[]>>;
  readonly verificacao: { readonly estado: string; readonly motivo?: string | null };
  readonly assinatura: string;
}

export interface Passo {
  readonly id: 'area' | 'servicos' | 'documento' | 'certificacoes' | 'analise' | 'assinatura';
  readonly titulo: string;
  readonly texto: string;
  readonly situacao: SituacaoPasso;
  readonly acao?: { readonly href: string; readonly rotulo: string };
}

const COM_ACESSO = ['trial_ativo', 'ativa', 'cancelada_com_acesso_ate_fim_do_periodo', 'em_carencia'];

const MOTIVOS: Record<string, string> = {
  documento_ilegivel: 'o documento está ilegível',
  documento_divergente: 'o documento não confere com os dados informados',
  tipo_nao_aceito: 'o tipo de documento não é aceito',
  certificacao_insuficiente: 'a certificação enviada não é suficiente',
};

export function montarPassos(d: DadosPassos): readonly Passo[] {
  const estado = d.verificacao.estado;
  const recusada = estado === 'recusada';
  const faltaCertificacao = recusada && d.verificacao.motivo === 'certificacao_insuficiente';
  const certificacoesOk = d.regulamentados.every((s) => d.certificados.includes(s.serviceId));
  const documentoOk = d.temIdentidade && (!recusada || faltaCertificacao);
  const enviosOk = d.areaDefinida && d.totalServicos > 0 && documentoOk && certificacoesOk;
  const aprovada = estado === 'aprovada';
  // Tudo enviado e ainda sem decisao: os envios aparecem como "em analise", nao como concluidos.
  const analisando = estado === 'em_analise';
  const comAcesso = COM_ACESSO.includes(d.assinatura);
  const passos: Passo[] = [
    {
      id: 'area',
      titulo: 'Defina sua área de atendimento',
      texto: 'Informe seu endereço base e até que distância você atende.',
      situacao: d.areaDefinida ? 'feito' : 'agora',
      acao: { href: '/profissional/perfil', rotulo: d.areaDefinida ? 'Revisar área' : 'Definir área' },
    },
    {
      id: 'servicos',
      titulo: 'Escolha seus serviços',
      texto: d.totalServicos > 0 ? `${d.totalServicos} ${d.totalServicos === 1 ? 'serviço escolhido' : 'serviços escolhidos'}.` : 'Marque os serviços que você presta.',
      situacao: d.totalServicos > 0 ? 'feito' : d.areaDefinida ? 'agora' : 'bloqueado',
      ...(d.areaDefinida || d.totalServicos > 0
        ? { acao: { href: '/profissional/perfil', rotulo: d.totalServicos > 0 ? 'Revisar serviços' : 'Escolher serviços' } }
        : {}),
    },
    {
      id: 'documento',
      titulo: 'Envie seu documento',
      texto: documentoOk ? (analisando ? 'Documento recebido. A equipe está analisando.' : 'Documento recebido.') : recusada ? 'Envie um novo documento para a equipe analisar de novo.' : 'Preencha seus dados e envie a foto do documento (CPF ou CNPJ).',
      situacao: documentoOk ? (analisando ? 'aguardando' : 'feito') : recusada ? 'atencao' : 'agora',
    },
  ];
  if (d.regulamentados.length > 0) {
    passos.push({
      id: 'certificacoes',
      titulo: 'Envie as certificações',
      texto: d.temIdentidade
        ? 'Serviços regulamentados pedem certificação (até 5 arquivos por serviço). Um arquivo novo volta o cadastro para análise.'
        : 'Serviços regulamentados pedem uma certificação cada. Envie primeiro o seu documento.',
      situacao: !d.temIdentidade ? 'bloqueado' : faltaCertificacao ? 'atencao' : certificacoesOk ? (analisando ? 'aguardando' : 'feito') : 'agora',
    });
  }
  const motivo = MOTIVOS[d.verificacao.motivo ?? ''];
  passos.push(
    {
      id: 'analise',
      titulo: 'Aprovação da equipe',
      texto: aprovada
        ? 'Seu cadastro foi aprovado.'
        : estado === 'suspensa'
          ? 'Sua conta está suspensa. Fale com o suporte.'
          : recusada
            ? `Cadastro recusado${motivo ? `: ${motivo}` : ''}. Corrija e envie de novo.`
            : enviosOk
              ? 'Estamos analisando. Avisamos por e-mail quando terminar.'
              : 'A análise é concluída depois que você enviar tudo.',
      situacao: aprovada ? 'feito' : recusada || estado === 'suspensa' ? 'atencao' : enviosOk ? 'aguardando' : 'bloqueado',
    },
    {
      id: 'assinatura',
      titulo: 'Ative o teste grátis ou assine',
      texto: comAcesso ? 'Seu acesso está ativo.' : aprovada ? 'Ative o teste grátis para começar a receber pedidos.' : 'Liberado depois da aprovação.',
      situacao: comAcesso ? 'feito' : aprovada ? 'agora' : 'bloqueado',
      ...(comAcesso || aprovada ? { acao: { href: '/profissional/assinatura', rotulo: comAcesso ? 'Ver assinatura' : 'Ativar agora' } } : {}),
    },
  );
  return passos;
}
