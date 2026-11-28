// Envio de um arquivo de verificacao (identidade ou certificacao): reserva a vaga, grava no Storage e finaliza.
// Usado pela tela Documentos e pela tela Primeiros passos.
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from './api';

export const TIPOS_DOCUMENTO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const LIMITE_IMAGEM = 5_242_880;
const LIMITE_PDF = 2_097_152;

export function tamanhoLegivel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Erro do arquivo escolhido (tipo e tamanho), ou null se estiver dentro das regras. */
export function erroDoArquivo(arquivo: File): string | null {
  if (!TIPOS_DOCUMENTO.includes(arquivo.type)) return 'Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF.';
  const pdf = arquivo.type === 'application/pdf';
  if (arquivo.size > (pdf ? LIMITE_PDF : LIMITE_IMAGEM)) return pdf ? 'O PDF pode ter até 2 MB.' : 'A foto pode ter até 5 MB.';
  return null;
}

export type ResultadoEnvio =
  | { readonly ok: true }
  /** `trocarArquivo`: o arquivo foi recusado na conferencia e precisa ser outro. */
  | { readonly ok: false; readonly texto: string; readonly trocarArquivo: boolean };

const TEXTOS_EMISSAO: Record<string, string> = {
  email_nao_verificado: 'Confirme seu e-mail antes de enviar documentos.',
  estado_perfil: 'Seu cadastro não aceita mais a troca deste arquivo.',
  limite_documentos: 'Você já enviou o número máximo de arquivos.',
  limite_certificacao: 'Você já enviou o número máximo de certificações.',
  servico_invalido: 'Este serviço não pede certificação. Atualize a página.',
};

/** Sem `servicoId` o arquivo e o documento de identidade; com ele, a certificacao daquele servico. */
export async function enviarDocumento(arquivo: File, servicoId?: string): Promise<ResultadoEnvio> {
  const falha = (texto: string, trocarArquivo = false): ResultadoEnvio => ({ ok: false, texto, trocarArquivo });
  const emissao = await chamarApi<{ id?: string; upload_url?: string }>('/v1/professional/documents/uploads', {
    body: {
      client_upload_id: crypto.randomUUID(),
      content_type: arquivo.type,
      size_bytes: arquivo.size,
      ...(servicoId ? { kind: 'certificacao', service_id: servicoId } : {}),
    },
  });
  if (emissao.status !== 200 && emissao.status !== 201) {
    if (emissao.status === 429) return falha(MENSAGEM_LIMITE);
    return falha(TEXTOS_EMISSAO[codigoDe(emissao.corpo)] ?? 'Não foi possível enviar o arquivo agora.');
  }
  const { upload_url: url, id } = emissao.corpo ?? {};
  if (typeof url !== 'string' || typeof id !== 'string') return { ok: true };
  const put = await fetch(url, {
    method: 'PUT',
    body: arquivo,
    headers: { 'Content-Type': arquivo.type },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  }).catch(() => null);
  if (!put?.ok) return falha('Não foi possível enviar o arquivo.');
  const fim = await chamarApi(`/v1/professional/documents/${encodeURIComponent(id)}/finalize`, { method: 'POST' });
  if (fim.status !== 200) return falha('O arquivo não pôde ser conferido. Escolha outro arquivo e envie de novo.', true);
  return { ok: true };
}
