// H-037 (Issue #50) | ESPELHO de packages/domain/src/identity-docs/tipo.ts (fase 1). O barril do dominio ainda nao exporta identity-docs;
// na fase 2 (depois da Issue 141) troque por import de @fastpro/domain e apague esta pasta. Paridade provada em tests/identity-docs-espelho.test.ts.
// H-037 (Issue #50) | Tipo do documento pelo conteudo (107-DESENHO-H037.md, §3 e §6.1 passo 4; B1). O tipo declarado so
// decide o limite de emissao; a decisao final e pela assinatura dos bytes. Reaproveita o detector de imagem
// de foto sem alterar esse modulo (decisao de R6: o detector de foto nao muda).
import { detectarTipoImagem } from '@fastpro/domain';

export type IdentityDocDetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** Devolve o tipo pela assinatura, ou null (GIF, HEIC, texto, executavel, PDF sem cabecalho). */
export function detectarTipoDocumento(bytes: Uint8Array): IdentityDocDetectedType | null {
  const imagem = detectarTipoImagem(bytes);
  if (imagem === 'jpeg') return 'image/jpeg';
  if (imagem === 'png') return 'image/png';
  if (imagem === 'webp') return 'image/webp';
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'application/pdf';
  }
  return null;
}

/** Limite do tipo detectado (B1): PDF real acima de 2 MiB e recusado mesmo que tenha sido declarado como imagem. */
export function limiteDetectadoBytes(tipo: IdentityDocDetectedType): number {
  return tipo === 'application/pdf' ? 2_097_152 : 5_242_880;
}
