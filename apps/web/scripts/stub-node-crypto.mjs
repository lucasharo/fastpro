// H-031 (Issue 152) | Stub de node:crypto para o bundle do navegador (usado por build-fotos-envio.mjs).
// O dominio (packages/domain/dist) importa estaticamente estes nomes de node:crypto. O esbuild valida os nomes
// importados antes do tree-shaking, entao o stub precisa exportar TODOS eles, mesmo os que o navegador nunca chama.
// Regra de manutencao: novo nome importado de node:crypto em packages/domain/dist exige acrescentar o nome aqui
// (tests/fotos-envio-stub-crypto.test.ts falha listando o nome faltante).
export const NOMES_STUB_NODE_CRYPTO = Object.freeze([
  'createCipheriv',
  'createDecipheriv',
  'createHash',
  'createHmac',
  'hkdfSync',
  'randomBytes',
  'timingSafeEqual',
]);

// Texto ESM do stub: cada nome vira uma funcao que falha de forma explicita. O navegador nao tem criptografia de servidor.
export function conteudoStubNodeCrypto() {
  const linhas = ['const falha = () => { throw new Error("node:crypto indisponivel no navegador"); };'];
  for (const nome of NOMES_STUB_NODE_CRYPTO) {
    linhas.push(`export const ${nome} = falha;`);
  }
  return `${linhas.join('\n')}\n`;
}
