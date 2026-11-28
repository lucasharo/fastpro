// Web Push sem dependencia externa: cifra do corpo (RFC 8291, aes128gcm da RFC 8188) e identificacao do servidor
// por VAPID (RFC 8292). O servidor so fala com os servicos de push dos navegadores conhecidos (lista fechada), para
// o endereco enviado pelo cliente nunca virar chamada a um destino qualquer.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

const HOSTS_PUSH = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

/** Endereco de inscricao aceito: https, porta padrao, sem credencial e de um servico de push conhecido. */
export function endpointAceito(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  return HOSTS_PUSH.some((h) => h.test(url.hostname));
}

export interface Inscricao {
  readonly endpoint: string;
  /** Chave publica do navegador (ponto P-256 de 65 bytes, base64url). */
  readonly p256dh: string;
  /** Segredo de autenticacao do navegador (16 bytes, base64url). */
  readonly auth: string;
}

export interface ChavesVapid {
  readonly publica: string;
  readonly privada: string;
  /** mailto: ou https:, exigido pelos servicos de push. */
  readonly assunto: string;
}

const b64 = (v: string): Buffer => Buffer.from(v, 'base64url');
const derivar = (ikm: Uint8Array, sal: Uint8Array, info: Uint8Array, n: number): Buffer =>
  Buffer.from(hkdfSync('sha256', ikm, sal, info, n));

export function chavesDaInscricaoValidas(p256dh: string, auth: string): boolean {
  const ponto = b64(p256dh);
  return ponto.length === 65 && ponto[0] === 4 && b64(auth).length === 16;
}

/** Corpo cifrado aes128gcm. `efemera` e `sal` so sao informados nos testes (vetor da RFC). */
export function cifrar(
  mensagem: Uint8Array,
  inscricao: Pick<Inscricao, 'p256dh' | 'auth'>,
  fixos: { readonly efemera?: string; readonly sal?: string } = {},
): Buffer {
  const navegador = b64(inscricao.p256dh);
  const ecdh = createECDH('prime256v1');
  if (fixos.efemera === undefined) ecdh.generateKeys();
  else ecdh.setPrivateKey(b64(fixos.efemera));
  const servidor = ecdh.getPublicKey();
  const sal = fixos.sal === undefined ? randomBytes(16) : b64(fixos.sal);

  const ikm = derivar(
    ecdh.computeSecret(navegador),
    b64(inscricao.auth),
    Buffer.concat([Buffer.from('WebPush: info\0'), navegador, servidor]),
    32,
  );
  const chave = derivar(ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = derivar(ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cifra = createCipheriv('aes-128-gcm', chave, nonce);
  // 0x02 marca o ultimo (e unico) registro.
  const corpo = Buffer.concat([cifra.update(Buffer.concat([mensagem, Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);

  const tamanhoRegistro = Buffer.alloc(4);
  tamanhoRegistro.writeUInt32BE(4096);
  return Buffer.concat([sal, tamanhoRegistro, Buffer.from([servidor.length]), servidor, corpo]);
}

/** Cabecalho Authorization do VAPID para o servico de push do endereco (validade de 12 h). */
export function autorizacaoVapid(endpoint: string, chaves: ChavesVapid, agoraMs: number): string {
  const publica = b64(chaves.publica);
  const chave = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: publica.subarray(1, 33).toString('base64url'),
      y: publica.subarray(33, 65).toString('base64url'),
      d: chaves.privada,
    },
  });
  const parte = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const dados = `${parte({ typ: 'JWT', alg: 'ES256' })}.${parte({
    aud: new URL(endpoint).origin,
    exp: Math.floor(agoraMs / 1000) + 12 * 3600,
    sub: chaves.assunto,
  })}`;
  const assinatura = sign('sha256', Buffer.from(dados), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${dados}.${assinatura.toString('base64url')}, k=${chaves.publica}`;
}
