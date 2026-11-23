'use client';
// Conversa de texto real (GET /v1/conversations/:id e POST .../messages). Atualiza a cada 5 s enquanto a aba esta
// visivel. Envio idempotente por client_message_id; so texto, sem anexos. Cabecalho: arquivar (H-069), denunciar
// (H-071, dialogo com motivo fechado) e bloquear (H-071, com confirmacao). Abrir a conversa marca como lida (H-101).
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { chamarApi, codigoDe, MENSAGEM_INDISPONIVEL, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarDataHora } from '@/lib/formatos';
import { Icone } from './Icone';
import { Aviso } from './ui';

interface Mensagem {
  id: string;
  kind: 'humana' | 'sistema';
  mine: boolean;
  body: string | null;
  event: string | null;
  createdAt: string | null;
}

interface Dados {
  serviceName: string;
  otherName: string;
  papel: 'cliente' | 'profissional';
  state: string;
  archived: boolean;
  blocked: boolean;
  messages: Mensagem[];
}

const MOTIVOS = [
  { codigo: 'assedio', rotulo: 'Assédio' },
  { codigo: 'golpe', rotulo: 'Golpe' },
  { codigo: 'ofensa', rotulo: 'Ofensa' },
  { codigo: 'spam', rotulo: 'Spam' },
  { codigo: 'outro', rotulo: 'Outro' },
] as const;

const TEXTO_DENUNCIA_MAX = 500;

/** Texto fixo das mensagens de sistema (o banco guarda so o evento). */
function textoSistema(evento: string | null): string {
  if (evento === 'aceite') return 'Estou disponível para trabalhar.';
  if (evento === 'aceite_retirado') return 'O profissional retirou o aceite.';
  return 'Aviso do sistema.';
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function DialogoDenuncia({
  aberto,
  enviando,
  erro,
  onFechar,
  onEnviar,
}: {
  readonly aberto: boolean;
  readonly enviando: boolean;
  readonly erro: string;
  readonly onFechar: () => void;
  readonly onEnviar: (motivo: string, texto: string) => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [erroMotivo, setErroMotivo] = useState('');

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (aberto && !el.open) el.showModal();
    if (!aberto && el.open) el.close();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) {
      setMotivo('');
      setTexto('');
      setErroMotivo('');
    }
  }, [aberto]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo === '') {
      setErroMotivo('Campo obrigatório.');
      return;
    }
    setErroMotivo('');
    onEnviar(motivo, texto.trim());
  }

  return (
    <dialog ref={dialogo} className="dialogo-denuncia" aria-labelledby="denuncia-titulo" onClose={onFechar}>
      <form onSubmit={enviar} noValidate className="pilha" style={{ gap: '1rem' }}>
        <h2 id="denuncia-titulo" style={{ fontSize: '1.125rem' }}>
          Denunciar conversa
        </h2>
        <fieldset className="pilha" style={{ gap: '0.5rem', border: 'none', padding: 0, margin: 0 }}>
          <legend className="campo-rotulo" style={{ marginBottom: '0.5rem' }}>
            Motivo da denúncia
          </legend>
          {MOTIVOS.map((m) => (
            <label key={m.codigo} className="linha" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="motivo-denuncia"
                value={m.codigo}
                checked={motivo === m.codigo}
                aria-invalid={erroMotivo !== '' ? true : undefined}
                aria-describedby={erroMotivo !== '' ? 'denuncia-motivo-erro' : undefined}
                onChange={() => setMotivo(m.codigo)}
              />
              {m.rotulo}
            </label>
          ))}
          {erroMotivo ? (
            <span id="denuncia-motivo-erro" className="campo-erro" role="alert">
              {erroMotivo}
            </span>
          ) : null}
        </fieldset>
        <div className="pilha" style={{ gap: '0.25rem' }}>
          <label htmlFor="denuncia-texto" className="campo-rotulo">
            Detalhes (opcional)
          </label>
          <textarea
            id="denuncia-texto"
            className="entrada"
            rows={4}
            maxLength={TEXTO_DENUNCIA_MAX}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-describedby="denuncia-texto-dica"
          />
          <span id="denuncia-texto-dica" className="campo-dica">
            {texto.length} de {TEXTO_DENUNCIA_MAX} caracteres
          </span>
        </div>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        <div className="linha-acoes-dialogo">
          <button type="submit" className="btn btn-primary btn-sm" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar denúncia'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => dialogo.current?.close()}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function Conversa({
  conversationId,
  subtitulo,
  aoMudar,
}: {
  readonly conversationId: string;
  readonly subtitulo?: string;
  /** Chamado depois de arquivar, denunciar ou bloquear, para a tela de origem atualizar as listas. */
  readonly aoMudar?: () => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [confirmandoBloqueio, setConfirmandoBloqueio] = useState(false);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(false);
  const [denunciaAberta, setDenunciaAberta] = useState(false);
  const [denunciando, setDenunciando] = useState(false);
  const [erroDenuncia, setErroDenuncia] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const pendente = useRef<{ chave: string; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<Dados>(`/v1/conversations/${conversationId}`);
    if (r.status === 200 && r.corpo) {
      setDados(r.corpo);
      setErro('');
    } else if (r.status === 404) setErro('Conversa não encontrada.');
    else if (r.status === 401) setErro('Sua sessão terminou. Entre de novo.');
  }, [conversationId]);

  useEffect(() => {
    setDados(null);
    setConfirmandoBloqueio(false);
    setAviso(null);
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar();
    }, 5000);
    return () => clearInterval(t);
  }, [carregar]);

  const total = dados?.messages.length ?? 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [total]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    if (pendente.current === null || pendente.current.texto !== t) pendente.current = { chave: crypto.randomUUID(), texto: t };
    setEnviando(true);
    setErro('');
    const r = await chamarApi(`/v1/conversations/${conversationId}/messages`, {
      body: { client_message_id: pendente.current.chave, body: t },
    });
    setEnviando(false);
    if (r.status === 201 || r.status === 200) {
      pendente.current = null;
      setTexto('');
      await carregar();
      return;
    }
    const codigo = codigoDe(r.corpo);
    if (r.status === 0) setErro('Sem conexão. Sua mensagem não foi enviada; tente de novo.');
    else if (r.status === 409 && codigo === 'conversa_bloqueada') {
      setErro('Esta conversa está bloqueada. Não é possível enviar novas mensagens.');
      await carregar();
    } else if (r.status === 409) setErro('Esta conversa está encerrada e só pode ser lida.');
    else if (r.status === 422 && codigo === 'conteudo_nao_permitido') {
      setErro('Não é permitido enviar e-mail ou telefone pelo chat. Remova e tente de novo.');
    } else if (r.status === 429) setErro(MENSAGEM_LIMITE);
    else setErro('Não foi possível enviar agora. Tente de novo.');
  }

  async function alternarArquivo() {
    if (!dados || acaoEmAndamento) return;
    setAcaoEmAndamento(true);
    setAviso(null);
    const r = await chamarApi(`/v1/conversations/${conversationId}/archive`, { body: { archived: !dados.archived } });
    setAcaoEmAndamento(false);
    if (r.status !== 200) {
      setAviso({ tipo: 'erro', texto: MENSAGEM_INDISPONIVEL });
      return;
    }
    await carregar();
    aoMudar?.();
  }

  async function bloquear() {
    if (acaoEmAndamento) return;
    setAcaoEmAndamento(true);
    setAviso(null);
    const r = await chamarApi(`/v1/conversations/${conversationId}/block`, { body: {} });
    setAcaoEmAndamento(false);
    setConfirmandoBloqueio(false);
    if (r.status !== 200) {
      setAviso({ tipo: 'erro', texto: MENSAGEM_INDISPONIVEL });
      return;
    }
    setAviso({ tipo: 'sucesso', texto: 'Conversa bloqueada. Ninguém pode enviar novas mensagens por aqui.' });
    await carregar();
    aoMudar?.();
  }

  async function denunciar(motivo: string, textoLivre: string) {
    setDenunciando(true);
    setErroDenuncia('');
    const corpo = textoLivre === '' ? { reason: motivo } : { reason: motivo, text: textoLivre };
    const r = await chamarApi(`/v1/conversations/${conversationId}/report`, { body: corpo });
    setDenunciando(false);
    if (r.status === 201) {
      setDenunciaAberta(false);
      setAviso({ tipo: 'sucesso', texto: 'Denúncia enviada. Nossa equipe vai analisar o caso.' });
      return;
    }
    if (r.status === 422) setErroDenuncia('O texto da denúncia passou do limite de 500 caracteres.');
    else if (r.status === 429) setErroDenuncia(MENSAGEM_LIMITE);
    else if (r.status === 0) setErroDenuncia('Sem conexão. Sua denúncia não foi enviada; tente de novo.');
    else setErroDenuncia(MENSAGEM_INDISPONIVEL);
  }

  const somenteLeitura = dados !== null && dados.state !== 'ativa';
  const bloqueada = dados?.blocked === true;
  const composerDesligado = somenteLeitura || bloqueada;

  return (
    <div className="cartao conversa">
      <div className="linha-entre" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
        <div className="linha">
          <span className="avatar-letra" aria-hidden="true">
            {iniciais(dados?.otherName ?? '')}
          </span>
          <div>
            <div className="autor-nome">{dados?.otherName ?? 'Carregando…'}</div>
            <div className="autor-local">{subtitulo ?? dados?.serviceName ?? ''}</div>
          </div>
        </div>
        <div className="linha conversa-acoes">
          {somenteLeitura ? <span className="selo selo-sm selo-neutro">Somente leitura</span> : null}
          {bloqueada ? <span className="selo selo-sm selo-erro">Bloqueada</span> : null}
          {dados ? (
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={dados.archived} disabled={acaoEmAndamento} onClick={() => void alternarArquivo()}>
              {dados.archived ? 'Desarquivar' : 'Arquivar'}
            </button>
          ) : null}
          {dados ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDenunciaAberta(true)}>
              <Icone nome="alerta" tamanho={16} /> Denunciar
            </button>
          ) : null}
          {dados && !bloqueada ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={acaoEmAndamento} onClick={() => setConfirmandoBloqueio(true)}>
              Bloquear
            </button>
          ) : null}
        </div>
      </div>
      {confirmandoBloqueio ? (
        <div className="conversa-confirmacao" role="group" aria-label="Confirmar bloqueio">
          <p className="campo-dica" style={{ color: 'var(--color-text-primary)' }}>
            Bloquear esta conversa? Nenhum dos dois poderá enviar novas mensagens. Você ainda poderá ler o que já foi escrito.
          </p>
          <div className="linha">
            <button type="button" className="btn btn-primary btn-sm" disabled={acaoEmAndamento} onClick={() => void bloquear()}>
              Confirmar bloqueio
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmandoBloqueio(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      {aviso ? (
        <div style={{ padding: '0 1rem' }}>
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      ) : null}
      <div className="mensagens" aria-live="polite">
        {(dados?.messages ?? []).map((m) =>
          m.kind === 'sistema' ? (
            <div key={m.id} className="balao balao-deles" style={{ alignSelf: 'center', textAlign: 'center' }}>
              <Icone nome="check" tamanho={14} /> {textoSistema(m.event)}
              <span className="balao-hora">{formatarDataHora(m.createdAt)}</span>
            </div>
          ) : (
            <div key={m.id} className={`balao ${m.mine ? 'balao-meu' : 'balao-deles'}`} style={{ whiteSpace: 'pre-wrap' }}>
              {m.body}
              <span className="balao-hora">{formatarDataHora(m.createdAt)}</span>
            </div>
          ),
        )}
        <div ref={fim} />
      </div>
      {erro ? (
        <div style={{ padding: '0 1rem' }}>
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      ) : null}
      <form className="compositor" onSubmit={enviar}>
        <label htmlFor={`mensagem-${conversationId}`} className="sr-only">
          Mensagem
        </label>
        <input
          id={`mensagem-${conversationId}`}
          className="entrada"
          placeholder={bloqueada ? 'Conversa bloqueada' : somenteLeitura ? 'Conversa encerrada' : 'Escreva uma mensagem…'}
          value={texto}
          maxLength={4000}
          disabled={composerDesligado}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" aria-label="Enviar mensagem" style={{ padding: '0 1.25rem' }} disabled={enviando || composerDesligado}>
          <Icone nome="enviar" tamanho={18} />
        </button>
      </form>
      <DialogoDenuncia
        aberto={denunciaAberta}
        enviando={denunciando}
        erro={erroDenuncia}
        onFechar={() => setDenunciaAberta(false)}
        onEnviar={(motivo, textoLivre) => void denunciar(motivo, textoLivre)}
      />
    </div>
  );
}
