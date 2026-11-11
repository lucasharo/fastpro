// Garantias de localizacao (H-010, BK-05): backup e registros ficam FORA do repositorio e de qualquer
// repositorio Git. Segue links simbolicos (inclusive pendentes) antes de comparar, para que um link
// para dentro do repositorio seja recusado. Nada aqui grava arquivo.
import { lstatSync, realpathSync, readlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_LINKS = 32;

/** Caminho absoluto real (links resolvidos), mesmo que o ultimo trecho ainda nao exista. */
export function resolveReal(p, depth = 0) {
  if (depth > MAX_LINKS) throw new Error('caminho com links simbolicos demais');
  const abs = resolve(p);
  let st = null;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (st?.isSymbolicLink()) {
    return resolveReal(resolve(dirname(abs), readlinkSync(abs)), depth + 1);
  }
  if (st) return realpathSync(abs);
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(resolveReal(parent, depth + 1), basename(abs));
}

const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

export function isInside(child, parent) {
  const rel = relative(fold(parent), fold(child));
  if (rel === '') return true;
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Primeiro ancestral (ou o proprio caminho) que existe, ja resolvido. */
function existingAncestor(real) {
  let current = real;
  for (;;) {
    try {
      lstatSync(current);
      return current;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * Verdadeiro se o caminho esta dentro de um repositorio Git. Sem Git instalado a verificacao nao
 * pode ser feita, e o caso e tratado como repositorio (recusa), nunca como permissao.
 */
export function insideGitWorktree(real) {
  const probe = spawnSync(
    'git',
    ['-C', existingAncestor(real), 'rev-parse', '--is-inside-work-tree'],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (probe.error) return true;
  return probe.status === 0 && probe.stdout.trim() === 'true';
}

/**
 * Lanca erro se o caminho estiver dentro do repositorio ou de um repositorio Git. Mensagem curta,
 * sem o caminho (evita vazar a estrutura local em logs).
 */
export function assertOutsideRepo(path, repoRoot, label) {
  const real = resolveReal(path);
  const repoReal = resolveReal(repoRoot);
  if (isInside(real, repoReal)) {
    throw new Error(`${label} aponta para dentro do repositorio (recusado)`);
  }
  if (insideGitWorktree(real)) {
    throw new Error(`${label} fica dentro de um repositorio Git (recusado)`);
  }
  return real;
}
