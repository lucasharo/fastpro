'use client';
// Conversas do profissional (DEMONSTRACAO): o chat ainda nao existe na API (backlog E7).
import Image from 'next/image';
import { useState } from 'react';
import { Conversa } from '@/components/Conversa';
import { CabecaPagina, SeloMock } from '@/components/ui';
import { DEPOIMENTOS } from '@/lib/mock';

const CONTATOS = DEPOIMENTOS.map((d, i) => ({
  id: String(i),
  nome: d.nome.split(' ')[0] ?? d.nome,
  foto: d.foto,
  servico: d.servico,
  ultima: ['Perfeito, até amanhã!', 'Pode me mandar mais fotos?', 'Qual o valor com material?'][i] ?? '',
  local: d.cidade,
}));

export default function Conversas() {
  const [ativo, setAtivo] = useState(CONTATOS[0]?.id ?? '');
  const c = CONTATOS.find((x) => x.id === ativo) ?? CONTATOS[0];
  return (
    <>
      <CabecaPagina sobretitulo="Mensagens" titulo="Suas" destaque="conversas" acoes={<SeloMock />} />
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))', alignItems: 'start' }}>
        <div className="pilha" style={{ gap: '0.75rem' }}>
          {CONTATOS.map((x) => (
            <button
              key={x.id}
              type="button"
              className="item-lista"
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: x.id === ativo ? 'var(--color-primary)' : undefined }}
              onClick={() => setAtivo(x.id)}
            >
              <Image src={x.foto} alt="" width={44} height={44} className="avatar" />
              <span className="item-corpo">
                <span className="item-titulo" style={{ display: 'block' }}>
                  {x.nome} · {x.servico}
                </span>
                <span className="campo-dica">{x.ultima}</span>
              </span>
            </button>
          ))}
        </div>
        {c ? <Conversa nome={c.nome} foto={c.foto} subtitulo={`${c.servico} · ${c.local}`} /> : null}
      </div>
    </>
  );
}
