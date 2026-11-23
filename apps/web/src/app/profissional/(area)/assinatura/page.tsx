'use client';
// Assinatura (Mercado Pago): situacao, planos, checkout, teste gratis, cancelamento e confirmacao na volta.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Carregando, type TipoAviso } from '@/components/ui';
import { chamarApi } from '@/lib/api';
import { formatarData, formatarReais } from '@/lib/formatos';

const ROTULOS_PLANO: Record<string, string> = { mensal: 'Mensal', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };
const ESTADOS: Record<string, string> = {
  ativa: 'Assinatura ativa',
  cancelada_com_acesso_ate_fim_do_periodo: 'Renovação cancelada. O acesso continua até o fim do período pago',
  em_carencia: 'Período vencido. Você está na carência de 72 horas para pagar sem perder o acesso',
  expirada: 'Assinatura vencida. Escolha um plano para voltar a receber pedidos',
  trial_ativo: 'Teste grátis ativo',
  trial_expirado: 'Teste grátis encerrado. Escolha um plano para continuar',
  sem_acesso: 'Você ainda não tem assinatura',
};
const STATUS_PAG: Record<string, string> = { aprovado: 'Aprovado', pendente: 'Aguardando pagamento', recusado: 'Recusado', estornado: 'Estornado', chargeback: 'Contestado' };
const ERROS: Record<string, string> = {
  not_verified: 'Seu documento ainda não foi aprovado. A assinatura fica liberada depois da aprovação.',
  adesao_obrigatoria: 'Para renovar automaticamente no cartão, marque a autorização.',
  plano_invalido: 'Escolha um plano.',
  method_not_supported: 'Escolha Pix ou cartão.',
  cobranca_bloqueada: 'A cobrança está desligada neste ambiente.',
  trial_used: 'O teste grátis já foi usado para este documento.',
  paid_access_active: 'Você já tem uma assinatura ativa.',
};
const PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';

interface Plano {
  code: string;
  amount_cents: number;
  months: number;
}
interface Pagamento {
  method?: string;
  amount_cents: number;
  status?: string;
  period_start?: string;
  period_end?: string;
}
interface Situacao {
  estado: string;
  access_until?: string | null;
  plan?: string | null;
  auto_renew?: boolean;
  cancel_at_period_end?: boolean;
  auto_renew_text?: string;
  auto_renew_text_version?: string | null;
  payments?: Pagamento[];
}

export default function Assinatura() {
  const router = useRouter();
  const [s, setS] = useState<Situacao | null>(null);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [plano, setPlano] = useState('anual');
  const [metodo, setMetodo] = useState<'pix' | 'cartao'>('pix');
  const [renovar, setRenovar] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: TipoAviso; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const entrar = useCallback(() => router.replace('/profissional/entrar'), [router]);

  const carregar = useCallback(async () => {
    const [st, pl] = await Promise.all([chamarApi<Situacao>('/v1/billing/status'), chamarApi<{ plans?: Plano[] }>('/v1/billing/plans')]);
    if (st.status === 401 || st.status === 403) return entrar();
    if (st.status !== 200 || pl.status !== 200 || !st.corpo) {
      setAviso({ tipo: 'erro', texto: 'Não foi possível carregar sua assinatura agora.' });
      return;
    }
    setS(st.corpo);
    const lista = Array.isArray(pl.corpo?.plans) ? pl.corpo.plans : [];
    setPlanos(lista);
    if (!lista.some((p) => p.code === 'anual') && lista[0]) setPlano(lista[0].code);
  }, [entrar]);

  useEffect(() => {
    (async () => {
      const p = new URLSearchParams(window.location.search);
      const valido = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) && v !== 'null' ? v : null);
      const pagamento = valido(p.get('payment_id') ?? p.get('collection_id'));
      const preapproval = valido(p.get('preapproval_id'));
      if (pagamento || preapproval) {
        setAviso({ tipo: 'info', texto: 'Confirmando o pagamento no Mercado Pago…' });
        const c = await chamarApi<{ resultado?: string }>('/v1/billing/confirm', {
          body: { ...(pagamento ? { payment_id: pagamento } : {}), ...(preapproval ? { preapproval_id: preapproval } : {}) },
        });
        if (c.status === 401) return entrar();
        history.replaceState(null, '', '/profissional/assinatura');
        const r = c.corpo?.resultado;
        setAviso(
          c.status === 200
            ? r === 'concedido' || r === 'sem_mudanca' || r === 'assinatura_ligada'
              ? { tipo: 'sucesso', texto: 'Pagamento confirmado. Obrigado!' }
              : { tipo: 'info', texto: 'Pagamento recebido pelo Mercado Pago. Assim que for aprovado, o acesso é liberado.' }
            : { tipo: 'alerta', texto: 'Não foi possível confirmar agora. Se você pagou, o acesso é liberado assim que o Mercado Pago avisar.' },
        );
      }
      await carregar();
    })();
  }, [carregar, entrar]);

  async function pagar() {
    setOcupado(true);
    setAviso(null);
    const r = await chamarApi<{ redirect_url?: string; error?: string }>('/v1/billing/checkout', {
      body: { plan: plano, method: metodo, auto_renew: metodo === 'cartao' && renovar, accept_text_version: s?.auto_renew_text_version ?? null },
    });
    if (r.status === 401) return entrar();
    if (r.status === 200 && typeof r.corpo?.redirect_url === 'string') {
      window.location.assign(r.corpo.redirect_url);
      return;
    }
    setOcupado(false);
    setAviso({ tipo: 'erro', texto: ERROS[r.corpo?.error ?? ''] ?? PADRAO });
  }

  async function teste() {
    setOcupado(true);
    const r = await chamarApi<{ ends_at?: string; error?: string }>('/v1/billing/trial/activate', { body: {} });
    setOcupado(false);
    if (r.status === 401) return entrar();
    if (r.status === 201) {
      setAviso({ tipo: 'sucesso', texto: `Teste grátis ativo até ${formatarData(r.corpo?.ends_at)}.` });
      await carregar();
    } else setAviso({ tipo: 'erro', texto: ERROS[r.corpo?.error ?? ''] ?? PADRAO });
  }

  async function cancelar() {
    const r = await chamarApi('/v1/billing/cancel', { body: {} });
    if (r.status === 401) return entrar();
    setAviso(r.status === 200 ? { tipo: 'sucesso', texto: 'Renovação cancelada.' } : { tipo: 'erro', texto: PADRAO });
    if (r.status === 200) await carregar();
  }

  if (!s) return aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : <Carregando texto="Carregando sua assinatura…" />;

  const podeCancelar = (s.estado === 'ativa' || s.estado === 'em_carencia') && !s.cancel_at_period_end;

  return (
    <>
      <CabecaPagina sobretitulo="Assinatura" titulo="Seu" destaque="plano" texto="Sem cobrança por contato. Pague por Pix ou cartão." />
      {aviso ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      ) : null}
      <div className="glass-card painel-cartao linha-entre" style={{ marginBottom: '1.5rem' }}>
        <div>
          <div className="campo-dica">Situação</div>
          <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>
            {ESTADOS[s.estado] ?? ESTADOS.sem_acesso}
            {s.access_until ? ` (até ${formatarData(s.access_until)})` : ''}
          </div>
          {s.plan ? <div className="texto-suave">Plano {ROTULOS_PLANO[s.plan] ?? s.plan}{s.auto_renew ? ' · renovação automática ligada' : ''}</div> : null}
        </div>
        <div className="linha">
          {s.estado === 'sem_acesso' ? (
            <button type="button" className="btn btn-escuro btn-sm" disabled={ocupado} onClick={() => void teste()}>
              Ativar 14 dias grátis
            </button>
          ) : null}
          {podeCancelar ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelar()}>
              Cancelar renovação
            </button>
          ) : null}
        </div>
      </div>

      <div className="grade grade-4" style={{ marginBottom: '1.5rem' }}>
        {planos.map((p) => (
          <button
            key={p.code}
            type="button"
            className={`cartao plano ${plano === p.code ? 'plano-destaque' : ''}`}
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
            aria-pressed={plano === p.code}
            onClick={() => setPlano(p.code)}
          >
            <div className="linha-entre">
              <h3 style={{ fontSize: '1.125rem' }}>{ROTULOS_PLANO[p.code] ?? p.code}</h3>
              {p.code === 'anual' ? <span className="selo selo-sm">Mais escolhido</span> : null}
            </div>
            <div className="plano-preco">{formatarReais(p.amount_cents)}</div>
            <div className="texto-suave" style={{ fontSize: '0.875rem' }}>
              equivale a {formatarReais(Math.round(p.amount_cents / p.months))}/mês
            </div>
          </button>
        ))}
      </div>

      <div className="glass-card painel-cartao form">
        <span className="campo-rotulo">Forma de pagamento</span>
        <div className="opcoes opcoes-2">
          <button type="button" className="opcao" aria-pressed={metodo === 'pix'} onClick={() => setMetodo('pix')}>
            <Icone nome="raio" /> <strong>Pix</strong>
          </button>
          <button type="button" className="opcao" aria-pressed={metodo === 'cartao'} onClick={() => setMetodo('cartao')}>
            <Icone nome="carteira" /> <strong>Cartão de crédito</strong>
          </button>
        </div>
        {metodo === 'cartao' ? (
          <label className="opcao" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={renovar} onChange={(e) => setRenovar(e.target.checked)} />
            <span className="campo-dica">{s.auto_renew_text ?? 'Autorizo a renovação automática no cartão ao fim de cada período.'}</span>
          </label>
        ) : null}
        <button type="button" className="btn btn-primary btn-bloco" disabled={ocupado} onClick={() => void pagar()}>
          {ocupado ? 'Abrindo o pagamento…' : 'Pagar com Mercado Pago'} <Icone nome="seta" tamanho={18} />
        </button>
      </div>

      {(s.payments ?? []).length > 0 ? (
        <div className="glass-card painel-cartao" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>Pagamentos</h2>
          <div className="pilha" style={{ gap: '0.5rem' }}>
            {(s.payments ?? []).map((p, i) => (
              <div key={i} className="linha-entre" style={{ fontSize: '0.875rem' }}>
                <span>
                  {p.method === 'pix' ? 'Pix' : 'Cartão'} · {formatarReais(p.amount_cents)}
                  {p.period_start ? ` · ${formatarData(p.period_start)} a ${formatarData(p.period_end)}` : ''}
                </span>
                <span className="selo selo-sm selo-neutro">{STATUS_PAG[p.status ?? ''] ?? p.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
