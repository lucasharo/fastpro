'use client';
// Pedido do cliente em etapas (rascunho real na API): servico e local, detalhes, identificacao e codigo do e-mail.
// Ao fim, a revisao (/pedido/revisao) confirma e publica.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CampoEndereco, ENDERECO_MIN } from '@/components/CampoEndereco';
import { CampoServico } from '@/components/CampoServico';
import { CodigoEmail, pedirCodigo } from '@/components/CodigoEmail';
import { useSessao } from '@/components/Sessao';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo, Carregando, PaginaInterna } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE, ok, type ServicoCatalogo } from '@/lib/api';
import { URGENCIAS, urgenciaDoQuando } from '@/lib/formatos';

const DESCRICAO_MAX = 2000;
const ETAPAS = ['Serviço e local', 'Detalhes', 'Seus dados', 'Confirmação'] as const;
/** Cliente logado: sem e-mail e sem codigo (a sessao ja confirma quem ele e). */
const ETAPAS_LOGADO = ['Serviço e local', 'Detalhes', 'Seu nome'] as const;

interface Rascunho {
  service_id?: string | null;
  service_name?: string | null;
  address_text?: string | null;
  urgency?: string | null;
  description?: string | null;
}

const ROTULOS_FALTA: Record<string, string> = {
  service_id: 'serviço',
  address_text: 'local',
  urgency: 'urgência',
  description: 'descrição',
  first_name: 'primeiro nome',
  email: 'e-mail',
};

function PedidoConteudo() {
  const router = useRouter();
  const { papel } = useSessao();
  const logado = papel === 'cliente';
  const etapas: readonly string[] = logado ? ETAPAS_LOGADO : ETAPAS;
  const params = useSearchParams() ?? new URLSearchParams();
  const [carregando, setCarregando] = useState(true);
  const [criado, setCriado] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [servico, setServico] = useState<ServicoCatalogo | null>(null);
  const [textoServico, setTextoServico] = useState('');
  const [endereco, setEndereco] = useState('');
  const [urgencia, setUrgencia] = useState<string | null>(null);
  const [descricao, setDescricao] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const atual = await chamarApi<Rascunho>('/v1/drafts/current');
      if (!vivo) return;
      const v = atual.status === 200 ? atual.corpo : null;
      if (v) {
        setCriado(true);
        if (v.service_id) {
          setServico({ service_id: v.service_id, service_name: v.service_name ?? 'Serviço' });
          setTextoServico(v.service_name ?? '');
        }
        setEndereco(v.address_text ?? '');
        setUrgencia(v.urgency ?? null);
        setDescricao(v.description ?? '');
        const ident = await chamarApi<{ first_name?: string; email?: string }>('/v1/drafts/current/identity');
        if (ident.status === 200 && ident.corpo) {
          setNome(ident.corpo.first_name ?? '');
          setEmail(ident.corpo.email ?? '');
        }
      }
      // Dados vindos da busca da inicial completam o que o rascunho ainda nao tem.
      const sid = params.get('servico_id');
      const snome = params.get('servico');
      if (sid && snome && !v?.service_id) {
        setServico({ service_id: sid, service_name: snome });
        setTextoServico(snome);
      } else if (!v?.service_id && params.get('q')) {
        setTextoServico(params.get('q') ?? '');
      }
      if (!v?.address_text && params.get('endereco')) setEndereco(params.get('endereco') ?? '');
      if (!v?.urgency) setUrgencia(urgenciaDoQuando(params.get('quando')));
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [params]);

  const preparando = useRef<Promise<boolean> | null>(null);

  /** A API so sugere endereco para quem ja tem rascunho: cria um na primeira vez que a pessoa mexe no campo. */
  function preparar(texto: string) {
    if (criado || preparando.current) return;
    // Usa o texto que acabou de entrar no campo: colar o endereco de uma vez tambem cria o rascunho.
    const corpo = servico ? { service_id: servico.service_id } : texto.trim().length >= ENDERECO_MIN ? { address_text: texto.trim() } : null;
    if (corpo === null) return;
    preparando.current = (async () => {
      const r = await chamarApi('/v1/drafts', { method: 'POST', body: corpo });
      preparando.current = null;
      if (ok(r.status)) setCriado(true);
      else if (r.status === 429) setAviso(MENSAGEM_LIMITE);
      return ok(r.status);
    })();
  }

  async function salvar(parcial: Record<string, unknown>): Promise<boolean> {
    // Rascunho ainda sendo criado pelo campo de endereco: espera, para nao criar outro.
    const emCriacao = await preparando.current;
    const r = criado || emCriacao
      ? await chamarApi('/v1/drafts/current', { method: 'PATCH', body: parcial })
      : await chamarApi('/v1/drafts', { method: 'POST', body: parcial });
    if (ok(r.status)) {
      setCriado(true);
      return true;
    }
    if (r.status === 404 && criado) {
      setCriado(false);
      setAviso('Seu pedido anterior expirou. Vamos começar um novo com o que você já preencheu.');
      const novo = await chamarApi('/v1/drafts', { method: 'POST', body: parcial });
      if (ok(novo.status)) {
        setCriado(true);
        return true;
      }
    }
    setAviso(r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível salvar agora. Seus dados continuam aqui; tente de novo.');
    return false;
  }

  async function avancarServico() {
    const e: Record<string, string> = {};
    if (!servico) e.servico = 'Escolha um serviço da lista.';
    const n = [...endereco.trim()].length;
    if (n < ENDERECO_MIN) e.endereco = `Informe o endereço com pelo menos ${ENDERECO_MIN} caracteres.`;
    setErros(e);
    if (Object.keys(e).length > 0 || !servico) return;
    setSalvando(true);
    setAviso('');
    const salvou = await salvar({ service_id: servico.service_id, address_text: endereco.trim() });
    setSalvando(false);
    if (salvou) setEtapa(1);
  }

  async function avancarDetalhes() {
    const e: Record<string, string> = {};
    if (!urgencia) e.urgencia = 'Escolha quando você precisa.';
    if (!descricao.trim()) e.descricao = 'Descreva o serviço.';
    else if (descricao.length > DESCRICAO_MAX) e.descricao = `A descrição tem no máximo ${DESCRICAO_MAX} caracteres.`;
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    setAviso('');
    const salvou = await salvar({ urgency: urgencia, description: descricao.trim() });
    if (!salvou) {
      setSalvando(false);
      return;
    }
    if (logado) {
      // Logado: nome e e-mail vem da conta; so pergunta o nome se ele nunca fez pedido.
      const pronto = await identidadeDaSessao();
      setSalvando(false);
      if (!pronto) setEtapa(2);
      return;
    }
    setSalvando(false);
    setEtapa(2);
  }

  /** Grava nome e e-mail da conta no rascunho (sem codigo) e abre a revisao. Falso quando falta o nome. */
  async function identidadeDaSessao(nomeDigitado?: string): Promise<boolean> {
    const r = await chamarApi<{ code?: string }>('/v1/auth/me/draft-identity', {
      body: nomeDigitado ? { first_name: nomeDigitado } : {},
    });
    if (r.status === 200) {
      router.push('/pedido/revisao');
      return true;
    }
    if (r.status === 422 && r.corpo?.code === 'nome_necessario') return false;
    if (r.status === 401) setAviso('Sua sessão terminou. Entre de novo para continuar.');
    else if (r.status === 404) setAviso('Seu pedido expirou. Confira os dados e continue.');
    else setAviso('Não foi possível continuar agora. Tente de novo.');
    return false;
  }

  async function avancarNome() {
    if (nome.trim().length < 2) {
      setErros({ nome: 'Informe seu primeiro nome.' });
      return;
    }
    setErros({});
    setSalvando(true);
    setAviso('');
    await identidadeDaSessao(nome.trim());
    setSalvando(false);
  }

  async function avancarDados() {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = 'Informe seu primeiro nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Digite um e-mail válido.';
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    setAviso('');
    const ident = await chamarApi('/v1/drafts/current/identity', {
      method: 'PUT',
      body: { first_name: nome.trim(), email: email.trim() },
    });
    if (ident.status !== 200) {
      setSalvando(false);
      if (ident.status === 404) {
        setCriado(false);
        setEtapa(0);
        setAviso('Seu pedido expirou. Confira os dados e continue.');
      } else if (ident.status === 429) setAviso(MENSAGEM_LIMITE);
      else if (ident.status === 422 || ident.status === 400) setAviso('Confira o nome e o e-mail e tente de novo.');
      else setAviso('Não foi possível salvar agora. Tente de novo.');
      return;
    }
    const falha = await pedirCodigo(email.trim(), 'publish');
    setSalvando(false);
    if (falha) setAviso(falha);
    else setEtapa(3);
  }

  async function aposCodigo() {
    const r = await chamarApi<{ missing?: string[] }>('/v1/drafts/current/review');
    if (r.status === 200) {
      router.push('/pedido/revisao');
      return;
    }
    if (r.status === 422) {
      const faltam = (r.corpo?.missing ?? []).map((c) => ROTULOS_FALTA[c] ?? c);
      setAviso(`Falta preencher: ${faltam.join(', ')}.`);
      setEtapa(0);
      return;
    }
    if (r.status === 409) {
      setAviso('Ainda não recebemos a confirmação do e-mail. Digite o código que enviamos.');
      return;
    }
    setAviso('Não foi possível abrir a revisão agora. Tente de novo.');
  }

  if (carregando) return <Carregando texto="Carregando seu pedido…" />;

  return (
    <div>
      <div className="glass-card painel-cartao">
        <div className="passos" aria-label={`Etapa ${etapa + 1} de ${etapas.length}: ${etapas[etapa]}`}>
          {etapas.map((n, i) => (
            <div key={n} className={`passo ${i <= etapa ? 'passo-feito' : ''}`} />
          ))}
        </div>
        <span className="sobretitulo">
          Etapa {etapa + 1} de {etapas.length}
        </span>
        <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 1.5rem' }}>{etapas[etapa]}</h2>
        {aviso ? (
          <div style={{ marginBottom: '1.25rem' }}>
            <Aviso tipo="alerta">{aviso}</Aviso>
          </div>
        ) : null}

        {etapa === 0 ? (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void avancarServico();
            }}
          >
            <Campo id="servico" rotulo="Qual serviço você precisa?" erro={erros.servico}>
              <CampoServico
                id="servico"
                className="entrada"
                valor={textoServico}
                invalido={Boolean(erros.servico)}
                onTexto={(t) => {
                  setTextoServico(t);
                  if (servico && t !== servico.service_name) setServico(null);
                }}
                onEscolher={setServico}
              />
            </Campo>
            <Campo id="endereco" rotulo="Onde o serviço será feito?" erro={erros.endereco} dica="O endereço completo só aparece para o profissional que você escolher.">
              <CampoEndereco id="endereco" contexto="request_draft" valor={endereco} onMudar={setEndereco} podeConsultar={criado} onPreparar={preparar} invalido={Boolean(erros.endereco)} />
            </Campo>
            <button type="submit" className="btn btn-primary btn-bloco" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Continuar'} <Icone nome="seta" tamanho={18} />
            </button>
          </form>
        ) : null}

        {etapa === 1 ? (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void avancarDetalhes();
            }}
          >
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="campo-rotulo" style={{ marginBottom: '0.5rem' }}>
                Para quando?
              </legend>
              <div className="opcoes opcoes-2">
                {URGENCIAS.map((u) => (
                  <button key={u.valor} type="button" className="opcao" aria-pressed={urgencia === u.valor} onClick={() => setUrgencia(u.valor)}>
                    <Icone nome={u.valor === 'imediato' ? 'relogio' : 'calendario'} />
                    <span>
                      <strong style={{ display: 'block' }}>{u.rotulo}</strong>
                      <span className="campo-dica">{u.dica}</span>
                    </span>
                  </button>
                ))}
              </div>
              {erros.urgencia ? <span className="campo-erro">{erros.urgencia}</span> : null}
            </fieldset>
            <Campo id="descricao" rotulo="Descreva o serviço" erro={erros.descricao} dica={`${descricao.length}/${DESCRICAO_MAX} caracteres`}>
              <textarea
                id="descricao"
                className="entrada"
                placeholder="Ex.: Trocar 3 tomadas na cozinha e instalar um chuveiro novo. O disjuntor desarma quando ligo o forno."
                value={descricao}
                maxLength={DESCRICAO_MAX}
                onChange={(e) => setDescricao(e.target.value)}
                aria-invalid={erros.descricao ? 'true' : undefined}
              />
            </Campo>
            <div className="linha">
              <button type="button" className="btn-link" onClick={() => setEtapa(0)}>
                Voltar
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Continuar'} <Icone nome="seta" tamanho={18} />
              </button>
            </div>
          </form>
        ) : null}

        {etapa === 2 && logado ? (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void avancarNome();
            }}
          >
            <p className="texto-suave">Você já está logado. Só falta o primeiro nome que o profissional vai ver.</p>
            <Campo id="nome" rotulo="Primeiro nome" erro={erros.nome}>
              <input id="nome" className="entrada" autoComplete="given-name" value={nome} onChange={(e) => setNome(e.target.value)} aria-invalid={erros.nome ? 'true' : undefined} />
            </Campo>
            <div className="linha">
              <button type="button" className="btn-link" onClick={() => setEtapa(1)}>
                Voltar
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Revisar pedido'} <Icone nome="seta" tamanho={18} />
              </button>
            </div>
          </form>
        ) : null}

        {etapa === 2 && !logado ? (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void avancarDados();
            }}
          >
            <p className="texto-suave">Sem senha e sem cadastro: confirmamos seu e-mail com um código.</p>
            <Campo id="nome" rotulo="Primeiro nome" erro={erros.nome}>
              <input id="nome" className="entrada" autoComplete="given-name" value={nome} onChange={(e) => setNome(e.target.value)} aria-invalid={erros.nome ? 'true' : undefined} />
            </Campo>
            <Campo id="email" rotulo="E-mail" erro={erros.email}>
              <input id="email" className="entrada" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={erros.email ? 'true' : undefined} />
            </Campo>
            <div className="linha">
              <button type="button" className="btn-link" onClick={() => setEtapa(1)}>
                Voltar
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>
                {salvando ? 'Enviando…' : 'Receber código'} <Icone nome="seta" tamanho={18} />
              </button>
            </div>
          </form>
        ) : null}

        {etapa === 3 ? (
          <CodigoEmail email={email.trim()} finalidade="publish" criarSessao={false} aoConfirmar={aposCodigo} aoTrocarEmail={() => setEtapa(2)} />
        ) : null}
      </div>
    </div>
  );
}

export default function Pedido() {
  const { papel } = useSessao();
  return (
    <PaginaInterna largura="media">
      <CabecaPagina
        sobretitulo="Pedido grátis"
        titulo="Peça um"
        destaque="orçamento"
        voltar={{ href: '/', rotulo: 'Início' }}
        texto={
          <>
            Leva menos de 2 minutos. Profissionais verificados da sua região recebem o pedido assim que ele é publicado.
            {papel === 'anonimo' ? (
              <>
                {' '}
                <Link href="/entrar" style={{ textDecoration: 'underline' }}>
                  Já tem pedidos? Entre.
                </Link>
              </>
            ) : null}
          </>
        }
      />
      <Suspense fallback={<Carregando />}>
        <PedidoConteudo />
      </Suspense>
    </PaginaInterna>
  );
}
