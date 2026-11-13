// H-027 (Issue #40) | Reducao no navegador antes da emissao (docs/factory/93-DESENHO-H027.md, §4.4; CA-12).
// Portas injetadas (decodificar e codificar), para testar sem navegador. O plano de dimensoes e a escada de
// qualidade vem do dominio (a mesma regra do servidor). O servidor reencoda sempre: isto so reduz o envio.
// Ordem obrigatoria: reduz -> emite (content_type e size_bytes do blob reduzido) -> envia o blob.
import { MEDIA_MAX_BYTES, escolherSaidaJpeg, planoDimensoes, type EscolhaSaida } from '@fastpro/domain';

/** Imagem decodificada pelo navegador (ex.: ImageBitmap com a orientacao aplicada). */
export interface ImagemDecodificada {
  readonly width: number;
  readonly height: number;
  readonly recurso: unknown;
}

export interface PortasNavegador {
  /** createImageBitmap com imageOrientation 'from-image'. Null quando o navegador nao aceita a opcao ou nao decodifica. */
  decodificar(arquivo: Blob): Promise<ImagemDecodificada | null>;
  /** Desenha na escala pedida e codifica JPEG com qualidade 0-1 (canvas.toBlob). Null quando falha. */
  codificar(imagem: ImagemDecodificada, largura: number, altura: number, qualidade: number): Promise<Blob | null>;
  /** Libera a imagem decodificada (ImageBitmap.close) ao fim da reducao. Opcional: sem ela, nada e feito. */
  liberar?(imagem: ImagemDecodificada): void;
}

export type EnvioPreparado =
  | { readonly reduzida: true; readonly contentType: 'image/jpeg'; readonly blob: Blob }
  | { readonly reduzida: false; readonly contentType: string; readonly blob: Blob };

export interface ErroPreparo {
  readonly code: 'arquivo_grande';
}

/** Escala de qualidade do dominio (80..32) convertida para a faixa do canvas (0-1). */
const paraCanvas = (qualidade: number): number => qualidade / 100;

/** Envio do original com o tipo declarado, quando a reducao nao e possivel. O servidor reduz (ou recusa). */
function original(arquivo: Blob, tipo: string): EnvioPreparado | ErroPreparo {
  if (arquivo.size > MEDIA_MAX_BYTES) return { code: 'arquivo_grande' };
  return { reduzida: false, contentType: tipo, blob: arquivo };
}

export async function prepararEnvio(
  arquivo: Blob,
  tipoDeclarado: string,
  portas: PortasNavegador,
): Promise<EnvioPreparado | ErroPreparo> {
  let imagem: ImagemDecodificada | null;
  try {
    imagem = await portas.decodificar(arquivo);
  } catch {
    imagem = null;
  }
  if (imagem === null) return original(arquivo, tipoDeclarado);

  const plano = planoDimensoes(imagem.width, imagem.height);
  let escolha: EscolhaSaida<{ bytes: number; blob: Blob | null }>;
  try {
    escolha = await escolherSaidaJpeg(async (qualidade) => {
      const blob = await portas.codificar(imagem as ImagemDecodificada, plano.width, plano.height, paraCanvas(qualidade));
      return { bytes: blob === null ? Number.MAX_SAFE_INTEGER : blob.size, blob };
    });
  } finally {
    if (portas.liberar) portas.liberar(imagem);
  }
  if (!escolha.ok || escolha.saida.blob === null) return original(arquivo, tipoDeclarado);
  return { reduzida: true, contentType: 'image/jpeg', blob: escolha.saida.blob };
}

export interface EnvioFoto {
  readonly arquivo: Blob;
  readonly tipoDeclarado: string;
  readonly portas: PortasNavegador;
  /** POST /v1/media/uploads com o tamanho e o tipo do blob que vai ser enviado. */
  emitir(corpo: { readonly content_type: string; readonly size_bytes: number }): Promise<void>;
  /** PUT no upload_url com o blob. */
  enviar(blob: Blob): Promise<void>;
}

/** Fluxo completo: reduz, emite primeiro com o tamanho reduzido, depois envia. */
export async function enviarFoto(e: EnvioFoto): Promise<{ readonly ok: true; readonly reduzida: boolean } | ErroPreparo> {
  const r = await prepararEnvio(e.arquivo, e.tipoDeclarado, e.portas);
  if ('code' in r) return r;
  await e.emitir({ content_type: r.contentType, size_bytes: r.blob.size });
  await e.enviar(r.blob);
  return { ok: true, reduzida: r.reduzida };
}
