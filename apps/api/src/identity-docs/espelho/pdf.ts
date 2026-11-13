// H-037 (Issue #50) | ESPELHO de packages/domain/src/identity-docs/pdf.ts (fase 1). O barril do dominio ainda nao exporta identity-docs;
// na fase 2 (depois da #141) troque por import de @fastpro/domain e apague esta pasta. Paridade provada em tests/identity-docs-espelho.test.ts.
// H-037 (Issue #50) | Validador de PDF (107-DESENHO-H037.md, §6.2; decisoes 177, 178, 224). Puro, sem I/O, sem lancar
// excecao, tempo linear nos bytes. Heuristica: nao renderiza nem converte o arquivo (risco residual R-2 aceito).

export type PdfRejectCode = 'pdf_invalido' | 'pdf_protegido' | 'pdf_ativo';
export type PdfResult = { readonly ok: true } | { readonly ok: false; readonly code: PdfRejectCode };

const VERSOES_ACEITAS: ReadonlySet<string> = new Set(['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']);
/** Nomes de acao embutida (decisao 177). /OpenAction e /AA ficam de fora (decisao 224). */
const NOMES_ATIVOS: ReadonlySet<string> = new Set([
  'JavaScript',
  'JS',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'SubmitForm',
  'ImportData',
  'GoToE',
  'GoToR',
]);
const NOME_PROTEGIDO: ReadonlySet<string> = new Set(['Encrypt']);
const JANELA_EOF = 1024;

const PERCENT = 0x25;
const BARRA = 0x2f;
const HASH = 0x23;

function ehEspacoPdf(b: number): boolean {
  return b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
}

function ehDelimitadorPdf(b: number): boolean {
  return (
    b === 0x28 || // (
    b === 0x29 || // )
    b === 0x3c || // <
    b === 0x3e || // >
    b === 0x5b || // [
    b === 0x5d || // ]
    b === 0x7b || // {
    b === 0x7d || // }
    b === BARRA ||
    b === PERCENT
  );
}

function valorHex(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  if (b >= 0x61 && b <= 0x66) return b - 0x57;
  return -1;
}

/** Procura a sequencia de bytes `seq` a partir de `inicio`. */
function contemEm(bytes: Uint8Array, inicio: number, seq: string): boolean {
  const n = seq.length;
  for (let i = inicio; i + n <= bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== seq.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Procura, em uma unica passada, algum nome de PDF (token iniciado por barra) cujo texto, depois de decodificar
 * escapes #xx, esteja no conjunto. Como o nome termina no primeiro delimitador, /JS nao casa com /JSON.
 */
function temNomeEm(bytes: Uint8Array, alvos: ReadonlySet<string>): boolean {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    if (bytes[i] !== BARRA) {
      i++;
      continue;
    }
    i++;
    let nome = '';
    while (i < n && !ehEspacoPdf(bytes[i] ?? 0) && !ehDelimitadorPdf(bytes[i] ?? 0)) {
      const b = bytes[i] ?? 0;
      const h1 = i + 2 < n ? valorHex(bytes[i + 1] ?? 0) : -1;
      const h2 = i + 2 < n ? valorHex(bytes[i + 2] ?? 0) : -1;
      if (b === HASH && h1 >= 0 && h2 >= 0) {
        nome += String.fromCharCode(h1 * 16 + h2);
        i += 3;
      } else {
        nome += String.fromCharCode(b);
        i++;
      }
    }
    if (alvos.has(nome)) return true;
  }
  return false;
}

/**
 * Valida a estrutura minima de um PDF e recusa senha e acao embutida. Ordem: cabecalho e versao, fim do arquivo,
 * senha (/Encrypt), acao embutida. Entrada vazia ou curta devolve pdf_invalido.
 */
export function validarPdf(bytes: Uint8Array): PdfResult {
  if (bytes.length < 8) return { ok: false, code: 'pdf_invalido' };
  // Cabecalho no deslocamento 0, sem tolerancia de lixo antes (contra poliglota, R-3).
  if (!contemEm(bytes.subarray(0, 5), 0, '%PDF-')) return { ok: false, code: 'pdf_invalido' };
  const versao = String.fromCharCode(bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  if (!VERSOES_ACEITAS.has(versao)) return { ok: false, code: 'pdf_invalido' };
  const cauda = bytes.subarray(Math.max(0, bytes.length - JANELA_EOF));
  if (!contemEm(cauda, 0, '%%EOF')) return { ok: false, code: 'pdf_invalido' };
  if (temNomeEm(bytes, NOME_PROTEGIDO)) return { ok: false, code: 'pdf_protegido' };
  if (temNomeEm(bytes, NOMES_ATIVOS)) return { ok: false, code: 'pdf_ativo' };
  return { ok: true };
}
