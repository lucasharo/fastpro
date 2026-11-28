// H-107 (Issue 116) | Gravacao do catalogo pela tela (docs/factory/81-DESENHO-H107.md §4). Server Action: le o cookie
// da sessao no servidor, chama POST /v1/admin/catalog/... com a mesma Origin do console e devolve o estado do
// formulario. Nunca grava nada no cliente; a permissao e o banco decidem. Erro de rede vira mensagem generica.
'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE } from '@fastpro/domain';
import { estadoDaGravacao, TEXTO_ERRO_SALVAR, type EstadoSalvar } from '../../../catalog-state';

const CAMINHO_ENTIDADE: Readonly<Record<string, string>> = {
  group: 'groups',
  service: 'services',
  synonym: 'synonyms',
};

const SEM_ACESSO: EstadoSalvar = { situacao: 'sem_acesso', mensagem: null, campos: {} };

/** Texto do campo; a conversao numerica fica para a API (texto nao numerico vira 422 por campo). */
function texto(form: FormData, nome: string): string {
  return String(form.get(nome) ?? '');
}

function posicao(form: FormData): unknown {
  const bruto = texto(form, 'position');
  return bruto.trim() === '' ? bruto : Number(bruto);
}

/**
 * Campos do formulario por entidade. Desativar e reativar usam o mesmo formulario, com active false ou true
 * no lugar da caixa de marcar; a acao vem do botao (name "acao").
 */
function patchDoFormulario(
  entidade: string,
  form: FormData,
  acao: string,
  criando: boolean,
): Record<string, unknown> | null {
  const ativo = acao === 'desativar' ? false : acao === 'reativar' ? true : form.get('active') === 'on';
  if (entidade === 'group') {
    return { name: texto(form, 'name'), position: posicao(form), active: ativo };
  }
  if (entidade === 'service') {
    return {
      name: texto(form, 'name'),
      group_id: texto(form, 'group_id'),
      modality: texto(form, 'modality'),
      regulated: form.get('regulated') === 'on',
      active: ativo,
    };
  }
  if (entidade === 'synonym') {
    const patch: Record<string, unknown> = { term: texto(form, 'term') };
    // Na criacao de sinonimo nao ha caixa "Ativo": omitir deixa o padrao do banco (ativo).
    if (!criando || acao !== 'salvar') patch.active = ativo;
    const servico = texto(form, 'service_id');
    if (criando && servico !== '') patch.service_id = servico;
    return patch;
  }
  return null;
}

/** Ponto de entrada do formulario. `_anterior` nao e usado: cada envio e independente. */
export async function salvarCatalogo(_anterior: EstadoSalvar, form: FormData): Promise<EstadoSalvar> {
  const entidade = texto(form, 'entidade');
  const caminho = CAMINHO_ENTIDADE[entidade];
  const id = texto(form, 'id');
  const patch = patchDoFormulario(entidade, form, texto(form, 'acao'), id === '');
  if (caminho === undefined || patch === null) return { situacao: 'erro', mensagem: TEXTO_ERRO_SALVAR, campos: {} };

  const valor = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  const origem = process.env.ADMIN_BASE_URL;
  if (valor === undefined) return SEM_ACESSO;
  if (!base || !origem) return { situacao: 'erro', mensagem: TEXTO_ERRO_SALVAR, campos: {} };

  const corpo = id === '' ? { patch } : { expectedVersion: Number(texto(form, 'expectedVersion')), patch };
  const url = `${base}/v1/admin/catalog/${caminho}${id === '' ? '' : `/${id}`}`;
  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: origem,
        'sec-fetch-site': 'same-origin',
        cookie: `${ADMIN_SESSION_COOKIE}=${valor}`,
      },
      body: JSON.stringify(corpo),
      cache: 'no-store',
    });
    const dados: unknown = await resposta.json().catch(() => null);
    const estado = estadoDaGravacao(resposta.status, dados);
    if (estado.situacao === 'salvo') revalidatePath('/console/catalogo');
    return estado;
  } catch {
    return { situacao: 'erro', mensagem: TEXTO_ERRO_SALVAR, campos: {} };
  }
}
