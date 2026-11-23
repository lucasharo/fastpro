// Pacote B (H-086, H-088, H-089) | Exibicao de avaliacoes: estrelas (so leitura) e cartao com a resposta do profissional.
import { Icone } from './Icone';
import { iniciais } from './Conversa';
import { AUTOR_AVALIACAO, type AvaliacaoPublicada } from '@/lib/avaliacoes';
import { formatarDataHora } from '@/lib/formatos';

/** Estrelas de leitura: a nota cheia fica preenchida. Quem le ve o numero por texto (aria-label). */
export function EstrelasNota({ nota, tamanho = 18 }: { readonly nota: number; readonly tamanho?: number }) {
  const cheias = Math.max(0, Math.min(5, Math.round(nota)));
  return (
    <span className="estrelas" role="img" aria-label={`${cheias} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icone key={n} nome="estrela" tamanho={tamanho} preenchido={n <= cheias} aria-hidden="true" />
      ))}
    </span>
  );
}

export function CartaoAvaliacao({ item }: { readonly item: AvaliacaoPublicada }) {
  const autor = item.author ?? AUTOR_AVALIACAO;
  return (
    <article className="depoimento">
      <EstrelasNota nota={item.rating} />
      {item.comment ? <p className="depoimento-texto">{item.comment}</p> : <p className="depoimento-texto texto-suave">Sem comentário.</p>}
      {item.replyText ? (
        <div className="pilha" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
          <span className="sobretitulo">Resposta do profissional</span>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{item.replyText}</p>
        </div>
      ) : null}
      <div className="autor">
        <span className="avatar-letra" aria-hidden="true">
          {iniciais(autor)}
        </span>
        <div>
          <div className="autor-nome">{autor}</div>
          {item.publishedAt ? <div className="autor-local">{formatarDataHora(item.publishedAt)}</div> : null}
        </div>
      </div>
    </article>
  );
}
