'use client';
// Painel do profissional: situacao da verificacao e da assinatura (reais), metricas (DEMONSTRACAO) e os
// pedidos mais recentes da regiao (reais).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CartaoPedidoRegiao } from '@/components/CartaoPedidoRegiao';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, SeloMock, Vazio } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { formatarData } from '@/lib/formatos';
import { METRICAS_PROFISSIONAL } from '@/lib/mock';
import { lerDescoberta, type ItemDescoberta } from '@/lib/profissional';

interface Verificacao {
  estado?: string;
  explicacao?: string;
  decididoEm?: string;
}

interface Assinatura {
  estado?: string;
  access_until?: string | null;
}

const VERIFICACAO: Record<string, { titulo: string; texto: string; classe: string; acao?: { href: string; rotulo: string } }> = {
  sem_envio: {
    titulo: 'Envie seu documento',
    texto: 'Para receber pedidos, preencha o cadastro e envie a foto do documento.',
    classe: 'selo-alerta',
    acao: { href: '/profissional/documentos', rotulo: 'Enviar documento' },
  },
  em_analise: { titulo: 'Documento em análise', texto: 'Avisamos por e-mail assim que a análise terminar.', classe: 'selo-info' },
  aprovada: { titulo: 'Verificado', texto: 'Seu documento foi aprovado.', classe: 'selo-sucesso' },
  recusada: {
    titulo: 'Documento recusado',
    texto: 'Confira o motivo e envie de novo.',
    classe: 'selo-erro',
    acao: { href: '/profissional/documentos', rotulo: 'Enviar de novo' },
  },
  suspensa: { titulo: 'Conta suspensa', texto: 'Fale com o suporte para entender o motivo.', classe: 'selo-erro' },
};

const ASSINATURA: Record<string, string> = {
  ativa: 'Assinatura ativa',
  cancelada_com_acesso_ate_fim_do_periodo: 'Renovação cancelada',
  em_carencia: 'Em carência de 72 horas',
  expirada: 'Assinatura vencida',
  trial_ativo: 'Teste grátis ativo',
  trial_expirado: 'Teste grátis encerrado',
  sem_acesso: 'Sem assinatura',
};

export default function PainelProfissional() {
  const router = useRouter();
  const [verif, setVerif] = useState<Verificacao | null>(null);
  const [assin, setAssin] = useState<Assinatura | null>(null);
  const [pedidos, setPedidos] = useState<ItemDescoberta[] | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    (async () => {
      const [v, a, d] = await Promise.all([
        chamarApi<Verificacao>('/v1/professional/verificacao'),
        chamarApi<Assinatura>('/v1/billing/status'),
        lerDescoberta(),
      ]);
      if (v.status === 401 || d.tipo === 'sessao') {
        router.replace('/profissional/entrar');
        return;
      }
      setVerif(v.status === 200 && v.corpo ? v.corpo : { estado: 'sem_envio' });
      if (a.status === 200 && a.corpo) setAssin(a.corpo);
      if (d.tipo === 'ok') setPedidos(d.itens.slice(0, 3));
      else {
        setPedidos([]);
        if (d.tipo === 'erro') setAviso(d.texto);
      }
    })();
  }, [router]);

  if (verif === null) return <Carregando texto="Carregando seu painel…" />;
  const v = VERIFICACAO[verif.estado ?? ''] ?? VERIFICACAO.sem_envio!;

  return (
    <>
      <CabecaPagina sobretitulo="Painel" titulo="Olá," destaque="bom trabalho hoje" texto="Veja os pedidos novos da sua região e acompanhe sua conta." />
      <div className="grade grade-2" style={{ marginBottom: '1.5rem' }}>
        <div className="glass-card painel-cartao pilha">
          <div className="linha-entre">
            <span className="campo-dica">Verificação</span>
            <span className={`selo selo-sm ${v.classe}`}>{v.titulo}</span>
          </div>
          <p className="texto-suave">
            {v.texto}
            {verif.decididoEm ? ` Decidido em ${formatarData(verif.decididoEm)}.` : ''}
          </p>
          {verif.explicacao ? <Aviso tipo="info">{verif.explicacao}</Aviso> : null}
          {v.acao ? (
            <Link href={v.acao.href} className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
              {v.acao.rotulo}
            </Link>
          ) : null}
        </div>
        <div className="glass-card painel-cartao pilha">
          <div className="linha-entre">
            <span className="campo-dica">Assinatura</span>
            <span className={`selo selo-sm ${assin?.estado === 'ativa' || assin?.estado === 'trial_ativo' ? 'selo-sucesso' : 'selo-alerta'}`}>
              {ASSINATURA[assin?.estado ?? 'sem_acesso'] ?? 'Sem assinatura'}
            </span>
          </div>
          <p className="texto-suave">
            {assin?.access_until ? `Acesso até ${formatarData(assin.access_until)}.` : 'Escolha um plano para receber pedidos sem pagar por contato.'}
          </p>
          <Link href="/profissional/assinatura" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
            Ver planos
          </Link>
        </div>
      </div>

      <div className="linha-entre" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>Seus números</h2>
        <SeloMock />
      </div>
      <div className="metricas" style={{ marginBottom: '2rem' }}>
        {METRICAS_PROFISSIONAL.map((m) => (
          <div key={m.rotulo} className="cartao metrica">
            <div className="metrica-valor">{m.valor}</div>
            <div className="metrica-rotulo">{m.rotulo}</div>
          </div>
        ))}
      </div>

      <div className="linha-entre" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>
          Pedidos <span className="destaque">da sua região</span>
        </h2>
        <Link href="/profissional/pedidos" className="btn btn-secondary btn-sm">
          Ver todos <Icone nome="seta" tamanho={16} />
        </Link>
      </div>
      {aviso ? <Aviso tipo="erro">{aviso}</Aviso> : null}
      {pedidos === null ? <Carregando /> : null}
      {pedidos && pedidos.length === 0 && !aviso ? (
        <div className="glass-card">
          <Vazio
            icone="local"
            titulo="Nenhum pedido disponível agora"
            texto="Os pedidos aparecem aqui quando você está verificado, com assinatura ativa e área de atendimento definida."
            acao={
              <Link href="/profissional/perfil" className="btn btn-primary btn-sm">
                Definir minha área
              </Link>
            }
          />
        </div>
      ) : null}
      {pedidos && pedidos.length > 0 ? (
        <div className="grade grade-3">
          {pedidos.map((p) => (
            <CartaoPedidoRegiao key={p.id} p={p} />
          ))}
        </div>
      ) : null}
    </>
  );
}
