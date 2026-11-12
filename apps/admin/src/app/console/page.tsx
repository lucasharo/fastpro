// H-103 (Issue 112) | Console admin por papel: pagina do menu (docs/factory/70-DESENHO-H103.md §1 e §2).
// Renderizada no servidor a cada requisicao (sem cache). O navegador nao guarda papeis: o menu vem da API
// com o cookie da sessao admin, e a API decide o que aparece. Sem dado de tela nesta pagina.
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import {
  estadoDoMenu,
  TEXTO_ERRO,
  TEXTO_SEM_SESSAO,
  TEXTO_VAZIO,
  type ConsoleEstado,
} from '../../console-state';

export const dynamic = 'force-dynamic';

async function carregarMenu(): Promise<ConsoleEstado> {
  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (valor === undefined) return { tipo: 'sem_sessao' };
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { tipo: 'erro' };
  try {
    const resposta = await fetch(`${base}/v1/admin/console/menu`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${valor}` },
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
      {/* Itens do menu sem link: as paginas de destino (/console/<id>) ainda nao existem.
          Quando cada historia entregar a sua tela, este bloco vira navegacao. */}
      {estado.tipo === 'telas' ? (
        <ul className="console-telas">
          {estado.telas.map((tela) => (
            <li key={tela.id}>{tela.rotulo}</li>
          ))}
        </ul>
      ) : null}
      {estado.tipo === 'vazio' ? <p>{TEXTO_VAZIO}</p> : null}
      {estado.tipo === 'sem_sessao' ? <p>{TEXTO_SEM_SESSAO}</p> : null}
      {estado.tipo === 'erro' ? <p role="alert">{TEXTO_ERRO}</p> : null}
    </main>
  );
}
