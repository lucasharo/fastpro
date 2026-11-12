// H-103 (Issue 112) | Console admin por papel: pagina do menu (docs/factory/70-DESENHO-H103.md §1 e §2).
// Renderizada no servidor a cada requisicao (sem cache). O navegador nao guarda papeis: o menu vem da API
// com o cookie da sessao admin, e a API decide o que aparece. Sem dado de tela nesta pagina.
import { cookies } from 'next/headers';
import {
  estadoDoMenu,
  TEXTO_ERRO,
  TEXTO_SEM_SESSAO,
  TEXTO_VAZIO,
  type ConsoleEstado,
} from '../../console-state';

export const dynamic = 'force-dynamic';

const COOKIE_SESSAO = '__Host-fp_admin';

async function carregarMenu(): Promise<ConsoleEstado> {
  const valor = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (valor === undefined) return { tipo: 'sem_sessao' };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { tipo: 'erro' };
  try {
    const resposta = await fetch(`${base}/v1/admin/console/menu`, {
      headers: { cookie: `${COOKIE_SESSAO}=${valor}` },
      cache: 'no-store',
    });
    const corpo: unknown = resposta.status === 200 ? await resposta.json() : null;
    return estadoDoMenu(resposta.status, corpo);
  } catch {
    return { tipo: 'erro' };
  }
}

export default async function PaginaConsole() {
  const estado = await carregarMenu();
  return (
    <main className="console">
      <h1>Console administrativo</h1>
      {estado.tipo === 'telas' ? (
        <ul className="console-telas">
          {estado.telas.map((tela) => (
            <li key={tela.id}>
              <a href={tela.caminho}>{tela.rotulo}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {estado.tipo === 'vazio' ? <p>{TEXTO_VAZIO}</p> : null}
      {estado.tipo === 'sem_sessao' ? <p>{TEXTO_SEM_SESSAO}</p> : null}
      {estado.tipo === 'erro' ? <p role="alert">{TEXTO_ERRO}</p> : null}
    </main>
  );
}
