// Issue 52 (H-039) | Decisao do caso pela tela (124 §5.3). Server Action: le a sessao no servidor e chama
// POST /v1/admin/verificacao/casos/:id/decisao. Nenhum identificador de documento volta ao navegador.
'use server';

import { revalidatePath } from 'next/cache';
import { chamarVerificacao } from '../verification-api';
import {
  estadoDaDecisao,
  TEXTO_ERRO_DECISAO,
  TEXTO_INVALIDO_DECISAO,
  TEXTO_CASO_ASSUMIDO,
  TEXTO_ERRO_ASSUMIR,
  TEXTO_SEM_ACESSO_DECISAO,
  type EstadoDecisao,
} from '../../../../verification-detail-state';

export async function decidirCaso(_anterior: EstadoDecisao, form: FormData): Promise<EstadoDecisao> {
  const caso = String(form.get('caso') ?? '');
  const versao = Number(form.get('versao'));
  const complemento = String(form.get('complemento') ?? '');
  if (caso === '' || !Number.isInteger(versao)) return { situacao: 'invalido', mensagem: TEXTO_INVALIDO_DECISAO };

  const corpo = {
    decisao: String(form.get('decisao') ?? ''),
    motivo: String(form.get('motivo') ?? ''),
    versao,
    ...(complemento.trim() === '' ? {} : { complemento }),
  };
  const resposta = await chamarVerificacao(`/casos/${encodeURIComponent(caso)}/decisao`, 'POST', corpo);
  if (resposta === 'sem_acesso') return { situacao: 'sem_acesso', mensagem: TEXTO_SEM_ACESSO_DECISAO };
  if (resposta === 'indisponivel') return { situacao: 'erro', mensagem: TEXTO_ERRO_DECISAO };

  const estado = estadoDaDecisao(resposta.status);
  if (estado.situacao === 'salvo') revalidatePath(`/console/verificacao/${caso}`);
  return estado;
}

/** Assume o caso (POST .../atribuir com a versao vista): o caso passa para "em revisao" com voce como responsavel. */
export async function assumirCaso(_anterior: EstadoDecisao, form: FormData): Promise<EstadoDecisao> {
  const caso = String(form.get('caso') ?? '');
  const versao = Number(form.get('versao'));
  if (caso === '' || !Number.isInteger(versao)) return { situacao: 'erro', mensagem: TEXTO_ERRO_ASSUMIR };
  const resposta = await chamarVerificacao(`/casos/${encodeURIComponent(caso)}/atribuir`, 'POST', { versao });
  if (resposta === 'sem_acesso') return { situacao: 'sem_acesso', mensagem: TEXTO_SEM_ACESSO_DECISAO };
  if (resposta === 'indisponivel' || resposta.status !== 200) {
    return { situacao: resposta !== 'indisponivel' && resposta.status === 409 ? 'conflito' : 'erro', mensagem: TEXTO_ERRO_ASSUMIR };
  }
  revalidatePath(`/console/verificacao/${caso}`);
  return { situacao: 'salvo', mensagem: TEXTO_CASO_ASSUMIDO };
}
