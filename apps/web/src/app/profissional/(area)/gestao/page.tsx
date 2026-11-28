'use client';
// Gestao profissional (pedido do dono, 2026-11-27): o que falta para o profissional ficar valido e receber pedidos,
// com os arquivos junto de cada item. Cada passo le o estado real da API: area, servicos, documento, certificacoes
// (servicos regulamentados), analise da equipe e assinatura.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Aviso, CabecaPagina, Carregando } from '@/components/ui';
import { CertificacaoServico } from '@/components/CertificacaoServico';
import { DocumentoIdentidade } from '@/components/DocumentoIdentidade';
import { Icone } from '@/components/Icone';
import { chamarApi, MENSAGEM_INDISPONIVEL } from '@/lib/api';
import { montarPassos, type DadosPassos, type SituacaoPasso } from '@/lib/primeiros-passos';
import { lerDadosPassos } from '@/lib/primeiros-passos-leitura';

const SELO: Record<SituacaoPasso, { rotulo: string; classe: string }> = {
  feito: { rotulo: 'Concluído', classe: 'selo-sucesso' },
  agora: { rotulo: 'Falta fazer', classe: 'selo-alerta' },
  aguardando: { rotulo: 'Em análise', classe: 'selo-info' },
  atencao: { rotulo: 'Precisa corrigir', classe: 'selo-erro' },
  bloqueado: { rotulo: 'Depois', classe: 'selo-neutro' },
};

export default function GestaoProfissional() {
  const router = useRouter();
  const [dados, setDados] = useState<DadosPassos | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const r = await lerDadosPassos(chamarApi);
    if (r.tipo === 'sessao') {
      router.replace('/profissional/entrar');
      return;
    }
    if (r.tipo === 'erro') {
      setErro(true);
      return;
    }
    setErro(false);
    setDados(r.dados);
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Aviso tipo="erro">{MENSAGEM_INDISPONIVEL}</Aviso>;
  if (dados === null) return <Carregando texto="Conferindo seu cadastro…" />;

  const passos = montarPassos(dados);
  const feitos = passos.filter((p) => p.situacao === 'feito').length;

  return (
    <>
      <CabecaPagina
        sobretitulo="Seu cadastro"
        titulo="Gestão"
        destaque="profissional"
        texto="Conclua os passos abaixo para receber pedidos da sua região."
      />
      <p className="campo-dica" role="status" style={{ marginBottom: '0.5rem' }}>
        {feitos} de {passos.length} passos concluídos
      </p>
      <div className="passos" aria-hidden="true">
        {passos.map((p, i) => (
          <div key={p.id} className={`passo${i < feitos ? ' passo-feito' : ''}`} />
        ))}
      </div>
      {feitos === passos.length ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <Aviso tipo="sucesso">Tudo pronto. Você já pode receber pedidos.</Aviso>
        </div>
      ) : null}

      <ol className="onboard-lista">
        {passos.map((p, i) => (
          <li key={p.id} className="glass-card painel-cartao pilha" aria-current={p.situacao === 'agora' || p.situacao === 'atencao' ? 'step' : undefined}>
            <div className="linha-entre">
              <h2 className="onboard-titulo">
                {p.situacao === 'feito' ? <Icone nome="check" tamanho={18} /> : <span>{i + 1}.</span>}
                {p.titulo}
              </h2>
              <span className={`selo selo-sm ${SELO[p.situacao].classe}`}>{SELO[p.situacao].rotulo}</span>
            </div>
            <p className="texto-suave">{p.texto}</p>
            {p.id === 'documento' ? (
              <DocumentoIdentidade
                aberto={p.situacao === 'agora' || p.situacao === 'atencao'}
                travado={dados.verificacao.estado === 'aprovada' || dados.verificacao.estado === 'suspensa'}
                aoMudar={carregar}
              />
            ) : null}
            {p.id === 'certificacoes' && p.situacao !== 'bloqueado'
              ? dados.regulamentados.map((s) => (
                  <CertificacaoServico
                    key={s.serviceId}
                    servicoId={s.serviceId}
                    nome={s.name}
                    arquivos={dados.arquivos?.[s.serviceId] ?? []}
                    aoEnviar={carregar}
                  />
                ))
              : null}
            {p.acao ? (
              <Link href={p.acao.href} className={`btn btn-sm ${p.situacao === 'feito' ? 'btn-secondary' : 'btn-primary'}`} style={{ alignSelf: 'flex-start' }}>
                {p.acao.rotulo}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}
