// Senha da conta admin (decisao do dono, 2026-11-27): hash scrypt do proprio Node, sem dependencia nova.
// Parametros N=2^15, r=8, p=3 (equivalente recomendado pela OWASP), sal de 16 bytes, chave de 32 bytes.
// Formato gravado: scrypt$N$r$p$sal$chave (base64url). A senha nunca e registrada nem enviada ao banco.
// Este modulo so usa node:crypto: o script local de cadastro importa o arquivo compilado direto.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 3;
const CHAVE_BYTES = 32;
const MEMORIA_MAX = 96 * 1024 * 1024;
const FORMATO = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{22,})\$([A-Za-z0-9_-]{43,})$/;

function derivar(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha.normalize('NFC'), sal, CHAVE_BYTES, { N: n, r, p, maxmem: MEMORIA_MAX }, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    );
  });
}

export async function hashAdminPassword(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${chave.toString('base64url')}`;
}

/** Hash de mentira para conta inexistente: a recusa custa o mesmo tempo da senha errada. */
const SEM_CONTA = `scrypt$${N}$${R}$${P}$${'A'.repeat(22)}$${'A'.repeat(43)}`;

/** Confere a senha. Sem hash (conta inexistente) ou hash ilegivel: faz o mesmo trabalho e devolve false. */
export async function verifyAdminPassword(senha: string, gravado: string | null): Promise<boolean> {
  const lido = gravado === null ? null : FORMATO.exec(gravado);
  const partes = lido ?? FORMATO.exec(SEM_CONTA)!;
  const esperada = Buffer.from(partes[5]!, 'base64url');
  const chave = await derivar(senha, Buffer.from(partes[4]!, 'base64url'), Number(partes[1]), Number(partes[2]), Number(partes[3]));
  const igual = chave.length === esperada.length && timingSafeEqual(chave, esperada);
  return lido !== null && igual;
}
