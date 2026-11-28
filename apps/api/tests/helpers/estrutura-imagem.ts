// H-028 (Issue #41) | Leitor estrutural de prova, SO para testes (docs/factory/96-DESENHO-H028.md, §2.4, §4 e §8).
// Le JPEG, PNG e WebP byte a byte, sem sharp e sem libvips, para conferir o que o pipeline deixou ou tirou.
// Falha fechada: marcador desconhecido, comprimento que passa do fim, falta de SOI ou EOI e bytes depois do EOI
// contam como violacao. Lista permitida (nao proibida) para a saida JPEG. Nao entra no codigo de producao.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;

export interface SegmentoJpeg {
  readonly marcador: number;
  readonly posicao: number;
  readonly dados: Buffer;
}

export interface EstruturaJpeg {
  readonly segmentos: readonly SegmentoJpeg[];
  readonly erros: readonly string[];
  /** Posicao logo depois do EOI final, ou -1 se o EOI nao existe. */
  readonly fimEoi: number;
}

function ehStandalone(m: number): boolean {
  return m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === SOI || m === EOI;
}

/** Marcadores SOF (quadro de imagem): C0 a CF, exceto C4 (DHT), C8 (JPG) e CC (DAC). */
export function ehSof(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

/** Nome curto do marcador, para o relatorio (APP1, COM, FF02...). */
export function nomeMarcador(m: number): string {
  if (m >= 0xe0 && m <= 0xef) return `APP${m - 0xe0}`;
  if (m === 0xfe) return 'COM';
  if (m === SOI) return 'SOI';
  if (m === EOI) return 'EOI';
  if (m === SOS) return 'SOS';
  if (m === 0xdb) return 'DQT';
  if (m === 0xc4) return 'DHT';
  if (m === 0xdd) return 'DRI';
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  if (ehSof(m)) return `SOF${m - 0xc0}`;
  return `FF${m.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Percorre a estrutura de um JPEG. Nunca lanca excecao: erro de leitura vira item de `erros`. */
export function lerJpeg(b: Buffer): EstruturaJpeg {
  const segmentos: SegmentoJpeg[] = [];
  const erros: string[] = [];
  const vazio = Buffer.alloc(0);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) {
    return { segmentos, erros: ['sem_soi_inicial'], fimEoi: -1 };
  }
  segmentos.push({ marcador: SOI, posicao: 0, dados: vazio });
  let pos = 2;
  let fimEoi = -1;
  while (pos < b.length) {
    if (b[pos] !== 0xff) {
      erros.push('marcador_esperado');
      break;
    }
    const inicio = pos;
    pos++;
    while (pos < b.length && b[pos] === 0xff) pos++; // bytes de preenchimento
    if (pos >= b.length) {
      erros.push('truncado');
      break;
    }
    const m = b[pos] ?? 0;
    pos++;
    if (m === 0x00) {
      erros.push('ff00_fora_de_entropia');
      break;
    }
    if (m === EOI) {
      segmentos.push({ marcador: m, posicao: inicio, dados: vazio });
      fimEoi = pos;
      break;
    }
    if (m === SOI) {
      segmentos.push({ marcador: m, posicao: inicio, dados: vazio });
      erros.push('soi_duplicado');
      continue;
    }
    if (ehStandalone(m)) {
      segmentos.push({ marcador: m, posicao: inicio, dados: vazio });
      continue;
    }
    if (pos + 2 > b.length) {
      erros.push('truncado');
      break;
    }
    const comprimento = b.readUInt16BE(pos);
    if (comprimento < 2 || pos + comprimento > b.length) {
      erros.push('comprimento_passa_do_fim');
      break;
    }
    segmentos.push({ marcador: m, posicao: inicio, dados: b.subarray(pos + 2, pos + comprimento) });
    pos += comprimento;
    if (m === SOS) {
      // Dados entrelacados: FF 00 e FF D0..D7 sao bytes literais; qualquer outro FF xx e marcador.
      let achou = false;
      while (pos < b.length) {
        if (b[pos] !== 0xff) {
          pos++;
          continue;
        }
        const prox = b[pos + 1];
        if (prox === undefined) break;
        if (prox === 0x00 || (prox >= 0xd0 && prox <= 0xd7)) {
          pos += 2;
          continue;
        }
        if (prox === 0xff) {
          pos++;
          continue;
        }
        achou = true;
        break;
      }
      if (!achou) {
        erros.push('truncado_na_varredura');
        break;
      }
    }
  }
  if (fimEoi < 0 && !erros.includes('truncado') && !erros.includes('truncado_na_varredura'))
    erros.push('sem_eoi');
  if (fimEoi >= 0 && fimEoi < b.length) erros.push('bytes_depois_do_eoi');
  return { segmentos, erros, fimEoi };
}

/** Lista os marcadores de um JPEG, em ordem, para o registro da Issue (ex.: SOI, APP0, DQT, SOF0, SOS, EOI). */
export function marcadoresJpeg(b: Buffer): string[] {
  return lerJpeg(b).segmentos.map((s) => nomeMarcador(s.marcador));
}

/**
 * Verificacao da saida JPEG (CA-01, CA-02): lista de violacoes; vazia = limpa. Regras: exatamente 1 SOI, 1 SOF e
 * 1 EOI; nenhum erro de leitura; nada depois do EOI; e so marcadores da lista permitida. APP0 e permitido apenas
 * como JFIF simples de 16 bytes com miniatura 0x0. Todo APP1 a APP15, COM, JPGn, DNL e TEM e violacao.
 */
export function verificarSaidaJpegLimpa(b: Buffer): string[] {
  const e = lerJpeg(b);
  const violacoes: string[] = [...e.erros];
  const contar = (f: (m: number) => boolean): number =>
    e.segmentos.filter((s) => f(s.marcador)).length;
  const sois = contar((m) => m === SOI);
  const sofs = contar(ehSof);
  const eois = contar((m) => m === EOI);
  if (sois !== 1) violacoes.push(`soi_${sois}`);
  if (sofs !== 1) violacoes.push(`sof_${sofs}`);
  if (eois !== 1) violacoes.push(`eoi_${eois}`);
  for (const s of e.segmentos) {
    const m = s.marcador;
    if (m === SOI || m === EOI) continue;
    if (m === 0xdb || m === 0xc4 || m === 0xdd || m === SOS || (m >= 0xd0 && m <= 0xd7) || ehSof(m))
      continue;
    if (m === APP0 && ehJfifSimples(s.dados)) continue;
    violacoes.push(nomeMarcador(m));
  }
  return violacoes;
}

/** JFIF de 14 bytes de dados (16 com o comprimento), sem miniatura: largura e altura da miniatura iguais a zero. */
function ehJfifSimples(dados: Buffer): boolean {
  return (
    dados.length === 14 &&
    dados.subarray(0, 5).equals(Buffer.from('JFIF\0', 'ascii')) &&
    dados[12] === 0 &&
    dados[13] === 0
  );
}

// ---------- TIFF (EXIF) ----------

interface InfoTiff {
  readonly gps: boolean;
  /** Miniatura apontada por IFD1 (tags 0x0201 e 0x0202), com a verificacao de FF D8 ... FF D9. */
  readonly miniatura: boolean;
}

function lerTiff(t: Buffer): InfoTiff {
  const le = t.subarray(0, 2).toString('ascii') === 'II';
  if (!le && t.subarray(0, 2).toString('ascii') !== 'MM') throw new Error('tiff_ordem_invalida');
  const u16 = (o: number): number => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number): number => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  // presentes: todas as tags do IFD (qualquer contagem); valores: so LONG/SHORT de contagem 1.
  const ifd = (
    inicio: number,
  ): { presentes: Set<number>; valores: Map<number, number>; proximo: number } => {
    const n = u16(inicio);
    const presentes = new Set<number>();
    const valores = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const e = inicio + 2 + 12 * i;
      const tag = u16(e);
      const tipo = u16(e + 2);
      const count = u32(e + 4);
      presentes.add(tag);
      if (count !== 1) continue;
      if (tipo === 3) valores.set(tag, u16(e + 8));
      else if (tipo === 4) valores.set(tag, u32(e + 8));
    }
    return { presentes, valores, proximo: u32(inicio + 2 + 12 * n) };
  };
  const ifd0 = ifd(u32(4));
  const gpsPonteiro = ifd0.valores.get(0x8825);
  let gps = false;
  if (gpsPonteiro !== undefined) gps = ifd(gpsPonteiro).presentes.has(0x0002);
  let miniatura = false;
  if (ifd0.proximo !== 0) {
    const ifd1 = ifd(ifd0.proximo).valores;
    const off = ifd1.get(0x0201);
    const len = ifd1.get(0x0202);
    if (off !== undefined && len !== undefined && off + len <= t.length && len >= 4) {
      const bloco = t.subarray(off, off + len);
      miniatura =
        bloco[0] === 0xff && bloco[1] === SOI && bloco[len - 2] === 0xff && bloco[len - 1] === EOI;
    }
  }
  return { gps, miniatura };
}

// ---------- Listagem de portadores (controle positivo na entrada e registro) ----------

const PREF_EXIF = 'Exif\0\0';
const PREF_XMP = 'http://ns.adobe.com/xap/1.0/\0';
const PREF_ICC = 'ICC_PROFILE\0';
const PREF_IPTC = 'Photoshop 3.0\0';
const PREF_MPF = 'MPF\0';

function tiffPortadores(t: Buffer): string[] {
  try {
    const info = lerTiff(t);
    const r = ['exif'];
    if (info.gps) r.push('gps');
    if (info.miniatura) r.push('miniatura');
    return r;
  } catch {
    return ['exif_ilegivel'];
  }
}

function portadoresJpeg(b: Buffer): string[] {
  const e = lerJpeg(b);
  const achados: string[] = [];
  let sois = 0;
  for (const s of e.segmentos) {
    const m = s.marcador;
    const d = s.dados;
    if (m === SOI) sois++;
    else if (m === 0xe1 && d.subarray(0, PREF_EXIF.length).toString('latin1') === PREF_EXIF)
      achados.push(...tiffPortadores(d.subarray(6)));
    else if (m === 0xe1 && d.subarray(0, PREF_XMP.length).toString('latin1') === PREF_XMP)
      achados.push('xmp');
    else if (m === 0xe2 && d.subarray(0, PREF_ICC.length).toString('latin1') === PREF_ICC)
      achados.push('icc');
    else if (m === 0xe2 && d.subarray(0, PREF_MPF.length).toString('latin1') === PREF_MPF)
      achados.push('mpf');
    else if (m === 0xed && d.subarray(0, PREF_IPTC.length).toString('latin1') === PREF_IPTC)
      achados.push('iptc');
    else if (m === APP0 && d.subarray(0, 5).toString('latin1') === 'JFXX\0')
      achados.push('miniatura_jfxx');
    else if (
      m === APP0 &&
      d.subarray(0, 5).toString('latin1') === 'JFIF\0' &&
      (d[12] ?? 0) + (d[13] ?? 0) > 0
    )
      achados.push('miniatura_jfif');
    else if (m === 0xfe) achados.push('com');
  }
  if (sois > 1) achados.push('soi_duplicado');
  if (e.fimEoi >= 0 && e.fimEoi < b.length) achados.push('anexo');
  return achados;
}

function portadoresPng(b: Buffer): string[] {
  const achados: string[] = [];
  let pos = 8;
  while (pos + 12 <= b.length) {
    const tam = b.readUInt32BE(pos);
    const tipo = b.subarray(pos + 4, pos + 8).toString('latin1');
    const dados = b.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'eXIf') achados.push(...tiffPortadores(dados));
    else if (tipo === 'iCCP') achados.push('icc');
    else if (tipo === 'tIME') achados.push('data');
    else if (tipo === 'tEXt' || tipo === 'zTXt' || tipo === 'iTXt') {
      const chave = dados.subarray(0, dados.indexOf(0)).toString('latin1');
      if (chave.startsWith('Raw profile type exif')) achados.push('exif');
      else if (chave.startsWith('Raw profile type iptc')) achados.push('iptc');
      else if (chave === 'XML:com.adobe.xmp') achados.push('xmp');
      else achados.push('texto');
    }
    pos += 12 + tam;
    if (tipo === 'IEND') break;
  }
  return achados;
}

function portadoresWebp(b: Buffer): string[] {
  const achados: string[] = [];
  let pos = 12;
  while (pos + 8 <= b.length) {
    const tipo = b.subarray(pos, pos + 4).toString('latin1');
    const tam = b.readUInt32LE(pos + 4);
    const dados = b.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'EXIF') {
      const t = dados.subarray(0, 6).toString('latin1') === PREF_EXIF ? dados.subarray(6) : dados;
      achados.push(...tiffPortadores(t));
    } else if (tipo === 'XMP ') achados.push('xmp');
    else if (tipo === 'ICCP') achados.push('icc');
    else if (tipo === 'ANIM') achados.push('animado');
    else if (tipo === 'ANMF') achados.push('quadro');
    pos += 8 + tam + (tam % 2);
  }
  return achados;
}

/** Portadores de metadado encontrados em uma entrada JPEG, PNG ou WebP (controle positivo e registro). */
export function listarPortadores(b: Buffer): string[] {
  if (b.length >= 3 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff) return portadoresJpeg(b);
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return portadoresPng(b);
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return portadoresWebp(b);
  return ['formato_desconhecido'];
}
