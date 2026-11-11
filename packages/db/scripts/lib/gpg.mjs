// Cifragem simetrica com gpg (AES256; BK-04). A frase-senha entra como PRIMEIRA linha da entrada padrao
// (--passphrase-fd 0), seguida do conteudo. Nao vai pela linha de comando, nao vai a arquivo e nao e
// gravada. O descritor 3 nao serve no Windows (o gpg do Git nao herda esse descritor), por isso este modo.
import { spawn } from 'node:child_process';

const COMMON = [
  '--batch',
  '--quiet',
  '--no-tty',
  '--yes',
  '--no-symkey-cache',
  '--pinentry-mode',
  'loopback',
  '--passphrase-fd',
  '0',
];

/**
 * Inicia gpg em modo 'encrypt' (texto claro -> cifrado) ou 'decrypt'. O chamador escreve o conteudo em
 * `stdin` (a frase-senha ja foi enviada como primeira linha) e le o resultado em `stdout`.
 * `exit` resolve com o codigo de saida. A saida de erro do gpg e descartada de proposito (pode conter
 * caminhos e identificadores).
 */
export function startGpg(mode, passphrase, bin = 'gpg') {
  const args =
    mode === 'encrypt'
      ? [...COMMON, '--symmetric', '--cipher-algo', 'AES256']
      : [...COMMON, '--decrypt'];
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  // Erro de escrita (ex.: gpg fechou a entrada cedo por frase-senha errada) nao pode derrubar o processo.
  child.stdin.on('error', () => {});
  child.stdin.write(`${passphrase}\n`);
  const exit = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  return { stdin: child.stdin, stdout: child.stdout, exit, kill: () => child.kill() };
}
