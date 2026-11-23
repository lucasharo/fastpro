'use client';
// Pacote B (H-086) | Bloco "Avalie o serviço" do cliente, no detalhe de um pedido concluido.
// GET /v1/requests/:id/review mostra a avaliacao; POST cria; PATCH edita ate 7 dias depois da publicacao.
// As estrelas sao radios nativos (teclado com setas) dentro de um fieldset. Campos invalidos mantem a borda vermelha.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Aviso, Campo, type TipoAviso } from './ui';
import { Icone } from './Icone';
import { EstrelasNota } from './Avaliacao';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { AUTOR_AVALIACAO, COMENTARIO_MAX, mensagemAvaliacao, prazoEdicaoAte, type AvaliacaoDoPedido } from '@/lib/avaliacoes';
import { formatarDataHora } from '@/lib/formatos';

interface RespostaAvaliacao {
  readonly selected: boolean;
  readonly review: AvaliacaoDoPedido | null;
}

export function AvaliacaoPedido({ pedidoId }: { readonly pedidoId: string }) {
  const [dados, setDados] = useState<RespostaAvaliacao | null>(null);
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [erroNota, setErroNota] = useState('');
  const [erroComentario, setErroComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: TipoAviso; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<RespostaAvaliacao>(`/v1/requests/${pedidoId}/review`);
    setDados(r.status === 200 && r.corpo ? r.corpo : { selected: false, review: null });
  }, [pedidoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirEdicao(atual: AvaliacaoDoPedido) {
    setNota(atual.rating);
    setComentario(atual.comment ?? '');
    setErroNota('');
    setErroComentario('');
    setAviso(null);
    setEditando(true);
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const atual = dados?.review ?? null;
    setErroNota('');
    setErroComentario('');
    setAviso(null);
    if (nota === null) {
      setErroNota('Campo obrigatório.');
      return;
    }
    const texto = comentario.trim();
    if (texto.length > COMENTARIO_MAX) {
      setErroComentario(mensagemAvaliacao('comentario_invalido'));
      return;
    }
    const corpo = { rating: nota, ...(texto === '' ? {} : { comment: texto }) };
    setEnviando(true);
    const r =
      atual === null
        ? await chamarApi(`/v1/requests/${pedidoId}/review`, { body: corpo })
        : await chamarApi(`/v1/requests/${pedidoId}/review`, { method: 'PATCH', body: corpo });
    setEnviando(false);
    if (r.status === 201 || r.status === 200) {
      setEditando(false);
      setAviso({ tipo: 'sucesso', texto: atual === null ? 'Obrigado! Sua avaliação foi publicada.' : 'Avaliação atualizada.' });
      await carregar();
      return;
    }
    if (r.status === 429) {
      setAviso({ tipo: 'erro', texto: MENSAGEM_LIMITE });
      return;
    }
    const codigo = codigoDe(r.corpo);
    if (codigo === 'nota_invalida') setErroNota(mensagemAvaliacao(codigo));
    else if (codigo === 'comentario_invalido' || codigo === 'conteudo_nao_permitido') setErroComentario(mensagemAvaliacao(codigo));
    else setAviso({ tipo: 'erro', texto: mensagemAvaliacao(codigo) });
    if (codigo === 'prazo_encerrado' || codigo === 'ja_existe') {
      setEditando(false);
      await carregar();
    }
  }

  if (dados === null || !dados.selected) return null;

  const avaliacao = dados.review;
  const mostrarFormulario = avaliacao === null || editando;
  const prazo = avaliacao && !avaliacao.prazoEncerrado ? prazoEdicaoAte(avaliacao.publishedAt) : null;

  return (
    <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="titulo-avaliacao">
      <h2 id="titulo-avaliacao" style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
        {avaliacao === null ? (
          <>
            Avalie o <span className="destaque">serviço</span>
          </>
        ) : (
          <>
            Sua <span className="destaque">avaliação</span>
          </>
        )}
      </h2>

      {aviso ? (
        <div style={{ marginBottom: '1rem' }}>
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      ) : null}

      {avaliacao && !editando ? (
        <div className="pilha" style={{ gap: '0.75rem' }}>
          <EstrelasNota nota={avaliacao.rating} tamanho={22} />
          {avaliacao.comment ? <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{avaliacao.comment}</p> : <p className="texto-suave" style={{ marginBottom: 0 }}>Sem comentário.</p>}
          <div className="item-meta">
            <span>
              <Icone nome="relogio" tamanho={14} /> Publicada em {formatarDataHora(avaliacao.publishedAt)}
              {avaliacao.editedAt ? ` · editada em ${formatarDataHora(avaliacao.editedAt)}` : ''}
            </span>
          </div>
          {avaliacao.replyText ? (
            <p className="texto-suave" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>Resposta do profissional:</strong> {avaliacao.replyText}
            </p>
          ) : (
            <p className="texto-suave" style={{ marginBottom: 0 }}>
              Aguardando a resposta do profissional.
            </p>
          )}
          {prazo ? <p className="texto-suave" style={{ marginBottom: 0 }}>Você pode editar esta avaliação até {prazo}.</p> : null}
          {prazo ? (
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => abrirEdicao(avaliacao)}>
                Editar avaliação
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {mostrarFormulario ? (
        <form className="pilha" style={{ gap: '1rem' }} onSubmit={(e) => void enviar(e)} noValidate>
          <fieldset
            className="avaliacao-estrelas"
            aria-invalid={erroNota ? 'true' : undefined}
            aria-describedby={erroNota ? 'nota-avaliacao-erro' : undefined}
          >
            <legend className="campo-rotulo">Sua nota</legend>
            <div className="avaliacao-estrelas-linha">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="avaliacao-estrela">
                  <input
                    type="radio"
                    name="nota-avaliacao"
                    value={n}
                    checked={nota === n}
                    onChange={() => {
                      setNota(n);
                      setErroNota('');
                    }}
                    className="sr-only"
                  />
                  <Icone nome="estrela" tamanho={32} preenchido={n <= (nota ?? 0)} aria-hidden="true" />
                  <span className="sr-only">{n === 1 ? '1 estrela' : `${n} estrelas`}</span>
                </label>
              ))}
            </div>
            {erroNota ? (
              <span id="nota-avaliacao-erro" className="campo-erro">
                {erroNota}
              </span>
            ) : null}
          </fieldset>

          <Campo
            id="comentario-avaliacao"
            rotulo="Comentário (opcional)"
            erro={erroComentario || undefined}
            dica={`Até ${COMENTARIO_MAX} caracteres. Não inclua e-mail, telefone ou link.`}
          >
            <textarea
              id="comentario-avaliacao"
              className="entrada"
              rows={4}
              maxLength={COMENTARIO_MAX}
              value={comentario}
              onChange={(e) => {
                setComentario(e.target.value);
                setErroComentario('');
              }}
              aria-invalid={erroComentario ? 'true' : undefined}
              aria-describedby={erroComentario ? 'comentario-avaliacao-erro' : undefined}
            />
          </Campo>

          <div className="linha">
            <button type="submit" className="btn btn-primary btn-sm" disabled={enviando}>
              {enviando ? 'Enviando…' : avaliacao === null ? 'Enviar avaliação' : 'Salvar alterações'}
            </button>
            {editando ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(false)} disabled={enviando}>
                Cancelar
              </button>
            ) : null}
          </div>
          <span className="campo-dica">Avaliação publicada como {AUTOR_AVALIACAO}.</span>
        </form>
      ) : null}
    </section>
  );
}
