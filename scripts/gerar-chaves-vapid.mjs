// Gera o par VAPID do Web Push e grava no .env.local so o que faltar. Nao imprime valores.
// Uso (na raiz): node scripts/gerar-chaves-vapid.mjs mailto:contato@exemplo.com
import { createECDH } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const arquivo = '.env.local';
const atual = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
const tem = (nome) => new RegExp(`^${nome}=.+$`, 'm').test(atual);
const novas = [];

if (!tem('VAPID_PUBLIC_KEY') && !tem('VAPID_PRIVATE_KEY')) {
  const par = createECDH('prime256v1');
  par.generateKeys();
  novas.push(`VAPID_PUBLIC_KEY=${par.getPublicKey().toString('base64url')}`);
  const privada = Buffer.alloc(32);
  const crua = par.getPrivateKey();
  crua.copy(privada, 32 - crua.length);
  novas.push(`VAPID_PRIVATE_KEY=${privada.toString('base64url')}`);
}
const assunto = process.argv[2] ?? '';
if (!tem('VAPID_SUBJECT') && /^(mailto:|https:\/\/)/.test(assunto)) novas.push(`VAPID_SUBJECT=${assunto}`);

if (novas.length > 0) appendFileSync(arquivo, `${atual === '' || atual.endsWith('\n') ? '' : '\n'}${novas.join('\n')}\n`);
process.stdout.write(`Gravadas no ${arquivo}: ${novas.map((l) => l.split('=')[0]).join(', ') || 'nenhuma'}\n`);
