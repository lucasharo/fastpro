// Frase-senha da execucao (BK-04; desenho §1.6). Ordem: arquivo apontado por BACKUP_PASSPHRASE_FILE
// (fora do repositorio) ou digitacao oculta no terminal. Nunca e gravada, impressa ou vai a manifesto.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { assertOutsideRepo } from './safe-paths.mjs';
import { MIN_PASSPHRASE_LENGTH } from './backup.mjs';

/** Digitacao sem eco (modo raw). Cancelar com Ctrl+C recusa a execucao. */
export function readHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buffer = '';
    const finish = (err) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err);
      else resolve(buffer);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new Error('digitacao cancelada'));
        if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
      return undefined;
    };
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

/**
 * Obtem a frase-senha da execucao. `confirm` pede a digitacao duas vezes (exportacao).
 * Erros nao citam caminho nem conteudo.
 */
export async function getPassphrase({ env, repoRoot, confirm }) {
  const file = env.BACKUP_PASSPHRASE_FILE;
  if (file) {
    if (!existsSync(file)) throw new Error('arquivo de frase-senha nao encontrado');
    assertOutsideRepo(file, repoRoot, 'BACKUP_PASSPHRASE_FILE');
    if (!statSync(file).isFile()) throw new Error('BACKUP_PASSPHRASE_FILE nao e um arquivo');
    const text = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    if (text.length < MIN_PASSPHRASE_LENGTH) throw new Error('frase-senha curta demais (recusado)');
    return text;
  }
  if (!process.stdin.isTTY) {
    throw new Error('sem terminal interativo e sem BACKUP_PASSPHRASE_FILE (recusado)');
  }
  const first = await readHidden('Frase-senha do backup (nao aparece na tela): ');
  if (first.length < MIN_PASSPHRASE_LENGTH) throw new Error('frase-senha curta demais (recusado)');
  if (confirm) {
    const second = await readHidden('Repita a frase-senha: ');
    if (second !== first) throw new Error('as frases-senha nao conferem (recusado)');
  }
  return first;
}
