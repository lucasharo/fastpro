'use client';
// Revisao do pedido: confere os dados, confirma (content_rev) e publica (POST /v1/requests, com Idempotency-Key).
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icone, type NomeIcone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo, Carregando, PaginaInterna, Vazio } from '@/components/ui';
import { chamarApi, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarDataHora, rotuloUrgencia } from '@/lib/formatos';
import { celularValido, mascaraCelular } from '@/lib/whatsapp';

interface Revisao {
  id: string;
  content_rev: number | string;
  confirmed_at?: string | null;
  service?: { name?: string };
  address_text?: string;
  urgency?: string;
  description?: string;
  first_name?: string;
  email?: string;
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'pronto'; view: Revisao }
  | { tipo: 'vazio' }
  | { tipo: 'aguardando' }
  | { tipo: 'campos'; faltam: string[] }
  | { tipo: 'erro'; texto: string };

const CHAVE_WHATSAPP = 'fastpro:pedido-whatsapp';

const TEXTOS_PUBLICACAO: Record<string, string> = {
  conteudo_alterado: 'Seu pedido mudou. Confira de novo antes de publicar.',
  email_divergente: 'Entre com o mesmo e-mail do pedido.',
  fotos_em_processamento: 'Suas fotos ainda estão sendo preparadas. Tente de novo em instantes.',
  telefone_invalido: 'Confira o número do WhatsApp, com DDD.',
  telefone_obrigatorio: 'Informe o número do WhatsApp.',
  endereco_nao_encontrado: 'Não encontramos esse endereço. Corrija e tente de novo.',
  geocode_limit: 'Este pedido já usou o número máximo de endereços. Mantenha o endereço atual.',
};

export default function RevisaoPedido() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [duplicidade, setDuplicidade] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<{ prazo?: string } | null>(null);
  const tentativa = useRef<{ chave: string; corpo: string } | null>(null);
  // O numero fica aqui (o resumo sai da tela ao recarregar) e na aba, para sobreviver a ida as fotos.
  const [whatsapp, setWhatsapp] = useState('');
  useEffect(() => {
    setWhatsapp(sessionStorage.getItem(CHAVE_WHATSAPP) ?? '');
  }, []);
  function guardarWhatsapp(numero: string) {
    setWhatsapp(numero);
    sessionStorage.setItem(CHAVE_WHATSAPP, numero);
  }

  const carregar = useCallback(async () => {
    setEstado({ tipo: 'carregando' });
    const r = await chamarApi<Revisao & { missing?: string[] }>('/v1/drafts/current/review');
    if (r.status === 200 && r.corpo) setEstado({ tipo: 'pronto', view: r.corpo });
    else if (r.status === 404) setEstado({ tipo: 'vazio' });
    else if (r.status === 409) setEstado({ tipo: 'aguardando' });
    else if (r.status === 422) setEstado({ tipo: 'campos', faltam: r.corpo?.missing ?? [] });
    else setEstado({ tipo: 'erro', texto: r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível abrir seu pedido agora.' });
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function confirmar(view: Revisao) {
    setOcupado(true);
    setErro('');
    const r = await chamarApi<{ status?: string; code?: string }>('/v1/drafts/current/confirm', { body: { content_rev: view.content_rev } });
    setOcupado(false);
    if (r.status === 200 && r.corpo?.status === 'confirmado') {
      await carregar();
      return;
    }
    if (r.status === 409 && r.corpo?.code === 'conteudo_alterado') {
      setErro(TEXTOS_PUBLICACAO.conteudo_alterado ?? '');
      await carregar();
      return;
    }
    if (r.status === 409) setEstado({ tipo: 'aguardando' });
    else setErro(r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível confirmar agora. Seus dados continuam salvos.');
  }

  async function publicar(view: Revisao, whatsapp: string) {
    const dados: Record<string, unknown> = { draft_id: view.id, content_rev: view.content_rev, phone: whatsapp, sharePhone: true };
    if (duplicidade) dados.duplicate_ack = duplicidade;
    const corpo = JSON.stringify(dados);
    if (tentativa.current === null || tentativa.current.corpo !== corpo) tentativa.current = { chave: crypto.randomUUID(), corpo };
    setOcupado(true);
    setErro('');
    const r = await chamarApi<{ status?: string; code?: string; ackToken?: string; acceptanceDeadlineAt?: string; missing?: string[] }>(
      '/v1/requests',
      { body: dados, headers: { 'Idempotency-Key': tentativa.current.chave } },
    );
    setOcupado(false);
    if (r.status === 0) {
      setErro('Não foi possível publicar agora. Seus dados continuam salvos. Tente de novo.');
      return;
    }
    tentativa.current = null;
    const codigo = r.corpo?.code ?? '';
    if ((r.status === 201 || r.status === 200) && r.corpo?.status === 'publicado') {
      sessionStorage.removeItem(CHAVE_WHATSAPP);
      setPublicado({ ...(r.corpo.acceptanceDeadlineAt ? { prazo: r.corpo.acceptanceDeadlineAt } : {}) });
      return;
    }
    if (r.status === 409 && codigo === 'duplicidade') {
      setDuplicidade(typeof r.corpo?.ackToken === 'string' ? r.corpo.ackToken : null);
      setErro('Você já publicou um pedido parecido há pouco. Se este é outro serviço, publique de novo para confirmar.');
      return;
    }
    setDuplicidade(null);
    if (r.status === 202 || codigo === 'em_andamento' || codigo === 'geocodificacao_em_andamento') {
      setErro('Ainda processando o endereço. Tente de novo em instantes.');
    } else if (r.status === 401) {
      setErro('Sua sessão terminou. Entre de novo para publicar. Seu pedido continua guardado.');
    } else if (r.status === 404) {
      setErro('Seu pedido expirou. Refaça o pedido.');
    } else if (r.status === 429) {
      setErro(MENSAGEM_LIMITE);
    } else if (r.status === 422 && codigo === 'campos_faltando') {
      setErro(`Falta preencher: ${(r.corpo?.missing ?? []).join(', ')}.`);
    } else {
      setErro(TEXTOS_PUBLICACAO[codigo] ?? 'Não foi possível publicar agora. Seus dados continuam salvos. Tente de novo.');
    }
    if (codigo === 'conteudo_alterado') await carregar();
  }

  if (publicado) {
    return (
      <PaginaInterna largura="media">
        <div className="glass-card painel-cartao" style={{ textAlign: 'center' }}>
          <div className="circulo-icone" style={{ margin: '0 auto 1rem', width: '4rem', height: '4rem' }}>
            <Icone nome="check" tamanho={32} />
          </div>
          <span className="sobretitulo">Tudo certo</span>
          <h1 style={{ fontSize: '2rem', margin: '0.5rem 0 1rem' }}>
            Pedido <span className="destaque">publicado!</span>
          </h1>
          <p className="texto-suave" style={{ maxWidth: '30rem', margin: '0 auto 2rem' }}>
            Os profissionais verificados da sua região já podem ver seu pedido.
            {publicado.prazo ? ` Eles podem aceitar até ${formatarDataHora(publicado.prazo)}.` : ''} Avisamos por e-mail quando alguém aceitar.
          </p>
          <div className="linha-botoes">
            <Link href="/painel" className="btn btn-primary">
              Acompanhar meus pedidos <Icone nome="seta" tamanho={18} />
            </Link>
            <Link href="/" className="btn btn-secondary">
              Voltar ao início
            </Link>
          </div>
        </div>
      </PaginaInterna>
    );
  }

  return (
    <PaginaInterna largura="media">
      <CabecaPagina sobretitulo="Último passo" titulo="Revise seu" destaque="pedido" voltar={{ href: '/pedido', rotulo: 'Editar pedido' }} />
      {estado.tipo === 'carregando' ? <Carregando texto="Carregando seu pedido…" /> : null}
      {estado.tipo === 'vazio' ? (
        <div className="glass-card">
          <Vazio
            titulo="Nenhum pedido em andamento"
            texto="Não encontramos um pedido em andamento. Comece um novo pedido."
            acao={
              <Link href="/pedido" className="btn btn-primary btn-sm">
                Começar um pedido
              </Link>
            }
          />
        </div>
      ) : null}
      {estado.tipo === 'aguardando' ? (
        <div className="glass-card painel-cartao form">
          <Aviso tipo="alerta">Falta confirmar seu e-mail. Digite o código que enviamos.</Aviso>
          <Link href="/pedido" className="btn btn-primary btn-bloco">
            Digitar o código
          </Link>
        </div>
      ) : null}
      {estado.tipo === 'campos' ? (
        <div className="glass-card painel-cartao form">
          <Aviso tipo="alerta">Falta preencher: {estado.faltam.join(', ')}.</Aviso>
          <Link href="/pedido" className="btn btn-primary btn-bloco">
            Completar o pedido
          </Link>
        </div>
      ) : null}
      {estado.tipo === 'erro' ? (
        <div className="glass-card painel-cartao form">
          <Aviso tipo="erro">{estado.texto}</Aviso>
          <button type="button" className="btn btn-secondary" onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      ) : null}
      {estado.tipo === 'pronto' ? (
        <Resumo
          view={estado.view}
          ocupado={ocupado}
          erro={erro}
          whatsapp={whatsapp}
          onWhatsapp={guardarWhatsapp}
          onConfirmar={confirmar}
          onPublicar={publicar}
        />
      ) : null}
    </PaginaInterna>
  );
}

function Linha({ icone, rotulo, valor }: { readonly icone: NomeIcone; readonly rotulo: string; readonly valor: string }) {
  return (
    <div className="linha" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <div className="circulo-icone" style={{ width: '2.5rem', height: '2.5rem' }}>
        <Icone nome={icone} tamanho={18} />
      </div>
      <div>
        <div className="campo-dica">{rotulo}</div>
        <div style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>{valor}</div>
      </div>
    </div>
  );
}

function Resumo({
  view,
  ocupado,
  erro,
  whatsapp,
  onWhatsapp,
  onConfirmar,
  onPublicar,
}: {
  readonly view: Revisao;
  readonly ocupado: boolean;
  readonly erro: string;
  readonly whatsapp: string;
  readonly onWhatsapp: (numero: string) => void;
  readonly onConfirmar: (v: Revisao) => void;
  readonly onPublicar: (v: Revisao, whatsapp: string) => void;
}) {
  const confirmado = Boolean(view.confirmed_at);
  const [erroWhatsapp, setErroWhatsapp] = useState('');

  function publicarComContato() {
    const numero = celularValido(whatsapp);
    if (numero === null) {
      setErroWhatsapp(whatsapp.trim() === '' ? 'Campo obrigatório.' : 'Informe um celular com DDD, por exemplo (11) 91234-5678.');
      return;
    }
    onPublicar(view, numero);
  }
  return (
    <div className="glass-card painel-cartao pilha">
      <Linha icone="ferramenta" rotulo="Serviço" valor={view.service?.name || 'Não informado'} />
      <Linha icone="local" rotulo="Local" valor={view.address_text || 'Não informado'} />
      <Linha icone="relogio" rotulo="Para quando" valor={rotuloUrgencia(view.urgency)} />
      <Linha icone="documento" rotulo="Descrição" valor={view.description || 'Não informado'} />
      <Linha icone="usuario" rotulo="Seus dados" valor={`${view.first_name ?? ''} · ${view.email ?? ''}`} />
      <hr className="divisor" style={{ margin: '0.5rem 0' }} />
      <Link href="/pedido/fotos" className="opcao">
        <Icone nome="camera" />
        <span style={{ flex: 1 }}>
          <strong style={{ display: 'block' }}>Adicionar fotos (opcional)</strong>
          <span className="campo-dica">Fotos ajudam o profissional a entender o serviço.</span>
        </span>
        <Icone nome="seta" tamanho={18} />
      </Link>
      <Campo
        id="whatsapp"
        rotulo="Seu WhatsApp"
        erro={erroWhatsapp || undefined}
        dica="Informe um WhatsApp onde os profissionais entrarão em contato."
      >
        <input
          id="whatsapp"
          className="entrada"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="(11) 91234-5678"
          value={whatsapp}
          aria-invalid={erroWhatsapp ? true : undefined}
          aria-describedby={erroWhatsapp ? 'whatsapp-erro' : undefined}
          onChange={(e) => {
            onWhatsapp(mascaraCelular(e.target.value));
            setErroWhatsapp('');
          }}
        />
      </Campo>
      {confirmado ? <Aviso tipo="sucesso">Pedido confirmado. Agora é só publicar.</Aviso> : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {confirmado ? (
        <button type="button" className="btn btn-primary btn-bloco" disabled={ocupado} onClick={publicarComContato}>
          {ocupado ? 'Publicando…' : 'Publicar pedido'} <Icone nome="enviar" tamanho={18} />
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-bloco" disabled={ocupado} onClick={() => onConfirmar(view)}>
          {ocupado ? 'Confirmando…' : 'Confirmar pedido'} <Icone nome="check" tamanho={18} />
        </button>
      )}
    </div>
  );
}
