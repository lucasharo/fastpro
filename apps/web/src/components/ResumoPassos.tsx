'use client';
// Chamada no painel enquanto o profissional ainda nao concluiu a Gestao profissional.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { chamarApi } from '@/lib/api';
import { montarPassos, type Passo } from '@/lib/primeiros-passos';
import { lerDadosPassos } from '@/lib/primeiros-passos-leitura';

export function ResumoPassos() {
  const [passos, setPassos] = useState<readonly Passo[] | null>(null);

  useEffect(() => {
    void lerDadosPassos(chamarApi).then((r) => {
      if (r.tipo === 'ok') setPassos(montarPassos(r.dados));
    });
  }, []);

  if (!passos) return null;
  const faltam = passos.filter((p) => p.situacao !== 'feito');
  const proximo = faltam.find((p) => p.situacao === 'agora' || p.situacao === 'atencao') ?? faltam[0];
  if (!proximo) return null;

  return (
    <div className="glass-card painel-cartao pilha" style={{ marginBottom: '1.5rem' }}>
      <div className="linha-entre">
        <h2 className="onboard-titulo">Falta pouco para você ficar válido</h2>
        <span className="selo selo-sm selo-alerta">
          {passos.length - faltam.length} de {passos.length}
        </span>
      </div>
      <p className="texto-suave">
        Próximo passo: {proximo.titulo}.
      </p>
      <Link href="/profissional/gestao" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
        Ver o que falta
      </Link>
    </div>
  );
}
