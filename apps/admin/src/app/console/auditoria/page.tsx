'use client';
// Auditoria recente (permissao audit.read), so leitura: os 100 eventos mais novos da cadeia de auditoria.
import { useEffect, useState } from 'react';
import { apiAdmin, dataHora, TEXTO_FALHA, TEXTO_SEM_ACESSO } from '../../../api-admin';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';

interface Evento {
  seq: number;
  at: string | null;
  actor: string;
  role: string;
  action: string;
  objectType: string;
}

export default function Auditoria() {
  const [itens, setItens] = useState<Evento[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    void (async () => {
      const r = await apiAdmin<{ items?: Evento[] }>('/v1/admin/audit/recent');
      if (r.status === 200) setItens(r.corpo?.items ?? []);
      else {
        setItens([]);
        setErro(r.status === 404 ? TEXTO_SEM_ACESSO : TEXTO_FALHA);
      }
    })();
  }, []);

  return (
    <div className="pilha">
      <CabecaPagina sobretitulo="Auditoria" titulo="Eventos recentes" descricao="Os 100 registros mais novos. Somente leitura." />
      {erro ? <AvisoErro texto={erro} /> : null}
      {itens === null ? <p className="texto-suave">Carregando…</p> : null}
      {itens !== null && itens.length === 0 && !erro ? <EstadoVazio texto="Nenhum evento registrado." icone="documento" /> : null}
      {itens && itens.length > 0 ? (
        <div className="tabela-envoltorio glass-card">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Quando</th>
                <th scope="col">Quem</th>
                <th scope="col">Papel</th>
                <th scope="col">Ação</th>
                <th scope="col">Objeto</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((e) => (
                <tr key={e.seq}>
                  <td>{e.seq}</td>
                  <td>{dataHora(e.at)}</td>
                  <td>{e.actor.split(':')[0]}</td>
                  <td>{e.role}</td>
                  <td>{e.action}</td>
                  <td>{e.objectType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
