'use client';
// Avaliacoes recebidas pelo profissional (GET /v1/professional/reviews). Cada avaliacao aceita uma unica resposta
// publica (POST /v1/reviews/:id/reply). A nota nao muda. O autor e sempre "Cliente do FastPro".
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { rotuloReputacao } from '@fastpro/domain';
import { CartaoAvaliacao } from '@/components/Avaliacao';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo, Carregando, Vazio } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { AUTOR_AVALIACAO, COMENTARIO_MAX, mensagemAvaliacao, type AvaliacaoPublicada } from '@/lib/avaliacoes';

interface AvaliacaoRecebida {
  readonly reviewId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly publishedAt: string | null;
  readonly replyText: string | null;
  readonly repliedAt: string | null;
}

interface RespostaRecebidas {
  readonly items: readonly AvaliacaoRecebida[];
  readonly summary: { readonly average: number | null; readonly count: number };
}

function ResponderAvaliacao({ reviewId, onRespondida }: { readonly reviewId: string; readonly onRespondida: (texto: string) => void }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAviso('');
    const limpo = texto.trim();
    if (limpo === '') {
      setErro('Campo obrigatório.');
      return;
    }
    if (limpo.length > COMENTARIO_MAX) {
      setErro(mensagemAvaliacao('texto_invalido'));
      return;
    }
    setErro('');
    setEnviando(true);
    const r = await chamarApi(`/v1/reviews/${reviewId}/reply`, { body: { body: limpo } });
    setEnviando(false);
    if (r.status === 201 || r.status === 200) {
      onRespondida(limpo);
      return;
    }
    if (r.status === 429) return setAviso(MENSAGEM_LIMITE);
    const codigo = codigoDe(r.corpo);
    if (codigo === 'texto_invalido' || codigo === 'conteudo_nao_permitido') setErro(mensagemAvaliacao(codigo));
    else setAviso(mensagemAvaliacao(codigo));
  }

  return (
    <form className="pilha" style={{ gap: '0.75rem' }} onSubmit={(e) => void enviar(e)} noValidate>
      <Campo
        id={`resposta-${reviewId}`}
        rotulo="Sua resposta"
        erro={erro || undefined}
        dica={`Uma única resposta, pública, de até ${COMENTARIO_MAX} caracteres. Não inclua e-mail, telefone ou link.`}
      >
        <textarea
          id={`resposta-${reviewId}`}
          className="entrada"
          rows={3}
          maxLength={COMENTARIO_MAX}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro('');
          }}
          aria-invalid={erro ? 'true' : undefined}
          aria-describedby={erro ? `resposta-${reviewId}-erro` : undefined}
        />
      </Campo>
      {aviso ? <Aviso tipo="erro">{aviso}</Aviso> : null}
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={enviando}>
          <Icone nome="conversa" tamanho={16} /> {enviando ? 'Enviando…' : 'Responder'}
        </button>
      </div>
    </form>
  );
}

export default function Avaliacoes() {
  const router = useRouter();
  const [dados, setDados] = useState<RespostaRecebidas | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      const r = await chamarApi<RespostaRecebidas>('/v1/professional/reviews');
      if (r.status === 401) {
        router.replace('/profissional/entrar');
        return;
      }
      if (r.status !== 200 || !r.corpo) {
        setErro('Não foi possível carregar as avaliações agora.');
        setDados({ items: [], summary: { average: null, count: 0 } });
        return;
      }
      setDados(r.corpo);
    })();
  }, [router]);

  function marcarRespondida(reviewId: string, texto: string) {
    setDados((atual) =>
      atual
        ? {
            ...atual,
            items: atual.items.map((i) =>
              i.reviewId === reviewId ? { ...i, replyText: texto, repliedAt: new Date().toISOString() } : i,
            ),
          }
        : atual,
    );
  }

  if (dados === null) return <Carregando texto="Carregando avaliações…" />;

  return (
    <>
      <CabecaPagina
        sobretitulo="Reputação"
        titulo="Suas"
        destaque="avaliações"
        texto={rotuloReputacao({ average: dados.summary.average, count: dados.summary.count })}
      />
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {dados.items.length === 0 && !erro ? (
        <div className="glass-card">
          <Vazio
            icone="estrela"
            titulo="Nenhuma avaliação ainda"
            texto="Quando um cliente avaliar um serviço seu, a avaliação aparece aqui, com a opção de responder."
          />
        </div>
      ) : null}
      <div className="pilha" style={{ gap: '1.25rem' }}>
        {dados.items.map((item) => {
          const publicada: AvaliacaoPublicada = {
            rating: item.rating,
            comment: item.comment,
            publishedAt: item.publishedAt,
            replyText: item.replyText,
            repliedAt: item.repliedAt,
            author: AUTOR_AVALIACAO,
          };
          return (
            <div key={item.reviewId} className="pilha" style={{ gap: '0.75rem' }}>
              <CartaoAvaliacao item={publicada} />
              {item.replyText === null ? (
                <div className="glass-card" style={{ padding: '1.25rem' }}>
                  <ResponderAvaliacao reviewId={item.reviewId} onRespondida={(texto) => marcarRespondida(item.reviewId, texto)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
