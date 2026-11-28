// Leitura segura e gravacao do .env.local (Issue #156, desenho 177 §4).
// Nunca imprime valores: lerEstado devolve so presenca, tamanho e hash SHA-256 de cada valor preenchido.
// aplicarPreenchimentos troca apenas linhas vazias ou acrescenta nomes ausentes; valor preenchido nunca muda.
// A gravacao usa arquivo temporario no mesmo diretorio e rename (nunca fica arquivo pela metade).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const LINHA = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Valor de uma linha NOME=valor, sem aspas externas. */
export function valorDaLinha(bruto) {
  let valor = bruto.trim();
  if (valor.length >= 2 && /^(['"]).*\1$/.test(valor)) valor = valor.slice(1, -1);
  return valor;
}

/** Hash SHA-256 (hex) de um valor; usado para provar que um valor preexistente nao mudou. */
export function hashDoValor(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/**
 * Mapa NOME -> { preenchida, tamanho, hash }. Sem valor em claro. A ultima ocorrencia vence (como o carregador).
 */
export function lerEstado(texto) {
  const estado = new Map();
  for (const raw of texto.split(/\r?\n/)) {
    const m = LINHA.exec(raw.trim());
    if (m === null) continue;
    const valor = valorDaLinha(m[2]);
    estado.set(m[1], {
      preenchida: valor !== '',
      tamanho: valor.length,
      hash: valor === '' ? null : hashDoValor(valor),
    });
  }
  return estado;
}

/**
 * Preenche somente nomes ausentes ou com valor vazio. Nunca troca valor preenchido.
 * entradas: [[nome, valor], ...]. Devolve o texto novo e as listas de nomes (nunca de valores).
 * Preserva comentarios, linhas existentes e o fim de linha (CRLF ou LF) do arquivo.
 */
export function aplicarPreenchimentos(texto, entradas, cabecalho = '') {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const linhas = texto.split(/\r?\n/);
  const estado = lerEstado(texto);
  const geradas = [];
  const mantidas = [];
  const acrescentar = [];
  for (const [nome, valor] of entradas) {
    const atual = estado.get(nome);
    if (atual !== undefined && atual.preenchida) {
      mantidas.push(nome);
      continue;
    }
    if (atual !== undefined) {
      let idx = -1;
      linhas.forEach((linha, i) => {
        const m = LINHA.exec(linha.trim());
        if (m !== null && m[1] === nome) idx = i;
      });
      linhas[idx] = `${nome}=${valor}`;
    } else {
      acrescentar.push(`${nome}=${valor}`);
    }
    geradas.push(nome);
  }
  let saida = linhas.join(eol);
  if (acrescentar.length > 0) {
    if (saida !== '' && !saida.endsWith(eol)) saida += eol;
    if (cabecalho !== '') saida += `# ${cabecalho}${eol}`;
    saida += acrescentar.join(eol) + eol;
  }
  return { texto: saida, geradas, mantidas };
}

/** Grava por arquivo temporario no mesmo diretorio e troca por rename. */
export function gravarAtomico(caminho, texto) {
  const tmp = join(dirname(caminho), `.${basename(caminho)}.${process.pid}.tmp`);
  writeFileSync(tmp, texto, { encoding: 'utf8', mode: 0o600 });
  try {
    renameSync(tmp, caminho);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw err;
  }
}

/** Le o arquivo como texto; ausente = null. Nunca imprime o conteudo. */
export function lerArquivo(caminho) {
  return existsSync(caminho) ? readFileSync(caminho, 'utf8') : null;
}
