'use client';
// Equipe do console (permissao admin.role.manage), so leitura: membros, situacao e papeis ativos.
// Conceder ou revogar papel continua pelo fluxo de dupla aprovacao (fora desta tela).
import { useEffect, useState } from 'react';
import { apiAdmin, dataHora, TEXTO_FALHA, TEXTO_SEM_ACESSO } from '../../../api-admin';
import { AvisoErro } from '../../../components/AvisoErro';
import { CabecaPagina } from '../../../components/CabecaPagina';
import { EstadoVazio } from '../../../components/EstadoVazio';

interface Membro {
  userId: string;
  email: string;
  status: string;
  roles: string[];
  since: string | null;
}

const PAPEL: Record<string, string> = {
  superadmin: 'Superadmin',
  verificacao: 'Verificação',
  moderador: 'Moderador',
  financeiro: 'Financeiro',
  suporte: 'Suporte',
  auditor: 'Auditor',
  governanca_dados: 'Governança de dados',
  dpo: 'Encarregado (DPO)',
};

export default function Equipe() {
  const [itens, setItens] = useState<Membro[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    void (async () => {
      const r = await apiAdmin<{ items?: Membro[] }>('/v1/admin/staff');
      if (r.status === 200) setItens(r.corpo?.items ?? []);
      else {
        setItens([]);
        setErro(r.status === 404 ? TEXTO_SEM_ACESSO : TEXTO_FALHA);
      }
    })();
  }, []);

  return (
    <div className="pilha">
      <CabecaPagina sobretitulo="Administração" titulo="Equipe" descricao="Membros da equipe e papéis ativos. Somente leitura." />
      {erro ? <AvisoErro texto={erro} /> : null}
      {itens === null ? <p className="texto-suave">Carregando…</p> : null}
      {itens !== null && itens.length === 0 && !erro ? <EstadoVazio texto="Nenhum membro na equipe." icone="usuario" /> : null}
      {itens && itens.length > 0 ? (
        <div className="tabela-envoltorio glass-card">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">E-mail</th>
                <th scope="col">Situação</th>
                <th scope="col">Papéis</th>
                <th scope="col">Desde</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((m) => (
                <tr key={m.userId}>
                  <td>{m.email}</td>
                  <td>
                    <span className={`selo ${m.status === 'ativo' ? '' : 'selo-neutro'}`}>{m.status === 'ativo' ? 'Ativo' : m.status === 'pendente_mfa' ? 'Pendente' : 'Desativado'}</span>
                  </td>
                  <td>{m.roles.map((r) => PAPEL[r] ?? r).join(', ') || '-'}</td>
                  <td>{dataHora(m.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
