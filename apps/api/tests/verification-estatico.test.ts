// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §6, T-16) | Teste estatico do isolamento do leitor do documento.
// Nao executa rede nem banco: le os arquivos-fonte e confere os imports. O leitor da Verificacao e arquivo novo;
// nenhum arquivo de identity-docs pode importa-lo, e o unico ponto de contato com identity-docs e a porta
// IdentityDocReaderPort (packages/domain/src/identity-docs/ports.ts), cujo conteudo fica fixado por hash.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const IDENTITY_DOCS_API = join(RAIZ, 'apps', 'api', 'src', 'identity-docs');
const LEITOR = join(RAIZ, 'apps', 'api', 'src', 'verification', 'pg-identity-doc-review-reader.ts');
const PORTA_IDENTITY_DOCS = join(RAIZ, 'packages', 'domain', 'src', 'identity-docs', 'ports.ts');
// SHA-256 de ports.ts no fechamento de #50 (igual ao de antes de H-039; conferido com git diff).
const HASH_PORTA_IDENTITY_DOCS = '480567d7a4df3119a82067816bec211088228420e3a63db2c0877e755c0ed612';

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return nome.endsWith('.ts') ? [caminho] : [];
  });
}

/** Especificadores de import/export-from de um arquivo TS (estatico, sem executar). */
function importsDe(arquivo: string): string[] {
  const texto = readFileSync(arquivo, 'utf8');
  return [...texto.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

describe('T-16 | isolamento do leitor do documento (CA-H039-12)', () => {
  it('nenhum arquivo de apps/api/src/identity-docs importa a fila de verificacao', () => {
    const arquivos = arquivosTs(IDENTITY_DOCS_API);
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arquivo of arquivos) {
      const suspeitos = importsDe(arquivo).filter((s) => /verification/i.test(s));
      expect(suspeitos, arquivo).toEqual([]);
    }
  });

  it('o leitor e arquivo novo e nao importa internos de identity-docs; so a porta e usada', () => {
    const imports = importsDe(LEITOR);
    expect(imports.some((s) => /identity-docs/i.test(s))).toBe(false);
    const texto = readFileSync(LEITOR, 'utf8');
    expect(texto).toMatch(/import type \{ IdentityDocReaderPort \} from '@fastpro\/domain';/);
  });

  it('a porta de identity-docs (#50) segue inalterada', () => {
    const hash = createHash('sha256').update(readFileSync(PORTA_IDENTITY_DOCS)).digest('hex');
    expect(hash).toBe(HASH_PORTA_IDENTITY_DOCS);
  });
});
