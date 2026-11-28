// Leituras que alimentam os Primeiros passos (tela propria e resumo do painel).
import type { RespostaApi } from './api';
import type { ArquivoRecebido, DadosPassos, ServicoDoProfissional } from './primeiros-passos';

export type Leitor = <T>(caminho: string) => Promise<RespostaApi<T>>;

export type LeituraPassos = { readonly tipo: 'ok'; readonly dados: DadosPassos } | { readonly tipo: 'sessao' } | { readonly tipo: 'erro' };

interface Documento {
  kind?: string;
  id?: string;
  receivedAt?: string | null;
  deletable?: boolean;
  documentKind?: string;
  serviceId?: string | null;
  status?: string;
}

function arquivosPorServico(recebidos: readonly Documento[]): Record<string, ArquivoRecebido[]> {
  const porServico: Record<string, ArquivoRecebido[]> = {};
  for (const d of recebidos) {
    if (d.documentKind !== 'certificacao' || !d.serviceId || !d.id) continue;
    (porServico[d.serviceId] ??= []).push({
      id: d.id,
      receivedAt: d.receivedAt ?? null,
      deletable: d.deletable === true,
      pdf: d.kind === 'pdf',
    });
  }
  return porServico;
}

export async function lerDadosPassos(ler: Leitor): Promise<LeituraPassos> {
  const [area, servicos, documentos, verificacao, assinatura] = await Promise.all([
    ler<{ configured?: boolean }>('/v1/professional/profile/area'),
    ler<{ services?: ServicoDoProfissional[] }>('/v1/professional/profile/services'),
    ler<{ documents?: Documento[] }>('/v1/professional/documents'),
    ler<{ estado?: string; motivo?: string | null }>('/v1/professional/verificacao'),
    ler<{ estado?: string }>('/v1/billing/status'),
  ]);
  const respostas = [area, servicos, documentos, verificacao, assinatura];
  if (respostas.some((r) => r.status === 401)) return { tipo: 'sessao' };
  // Quem ainda nao tem perfil recebe 403 ou 404 em algumas leituras: vale como "nada feito". O resto e falha.
  if (respostas.some((r) => r.status !== 200 && r.status !== 403 && r.status !== 404)) return { tipo: 'erro' };
  const lista = servicos.corpo?.services ?? [];
  const recebidos = (documentos.corpo?.documents ?? []).filter((d) => d.status === 'recebido');
  return {
    tipo: 'ok',
    dados: {
      areaDefinida: area.corpo?.configured === true,
      totalServicos: lista.length,
      regulamentados: lista.filter((s) => s.regulated === true),
      temIdentidade: recebidos.some((d) => d.documentKind !== 'certificacao'),
      certificados: recebidos.flatMap((d) => (d.documentKind === 'certificacao' && d.serviceId ? [d.serviceId] : [])),
      arquivos: arquivosPorServico(recebidos),
      verificacao: { estado: verificacao.corpo?.estado ?? 'sem_envio', motivo: verificacao.corpo?.motivo ?? null },
      assinatura: assinatura.corpo?.estado ?? 'sem_acesso',
    },
  };
}
