// Spike S-11 (Issue #10). Script isolado: NAO faz parte de packages/ nem apps/.
// Le RESEND_API_KEY somente de .env.local; nunca imprime a chave nem enderecos reais.
// Uso: node docs/factory/spikes/s11/s11-send.mjs <e-mail-da-conta>
import { readFileSync } from 'node:fs';

const MAX_SENDS = 5;
let sends = 0;
const mask = (s) => String(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi, (m) =>
  /@resend\.dev$/i.test(m) ? m : '<e-mail-da-conta>');

function readKey() {
  const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('RESEND_API_KEY='));
  const v = line ? line.slice('RESEND_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
  if (!v) { console.log('RESEND_API_KEY: ausente (sem segredo)'); process.exit(2); }
  return v;
}
const key = readKey();
const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function send(label, from, to, subject) {
  if (sends >= MAX_SENDS) { console.log(label, 'ABORTADO: limite de envios'); return null; }
  sends++;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ from, to: [to], subject, text: 'Teste do spike S-11 (Issue #10). Sem dados reais.' }),
  });
  const raw = await res.text();
  let body; try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 200) }; }
  const hdr = {};
  for (const [k, v] of res.headers) if (/quota|ratelimit|retry-after|x-resend/i.test(k)) hdr[k] = v;
  console.log(JSON.stringify({ label, envio: sends, status: res.status, name: body.name, message: mask(body.message ?? ''), id: body.id, headers: hdr }));
  return { status: res.status, body, raw };
}

async function getStatus(label, id) {
  const res = await fetch(`https://api.resend.com/emails/${id}`, { headers: auth });
  const b = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ label, consulta_status_http: res.status, last_event: b.last_event, name: b.name, message: mask(b.message ?? '') }));
}

const account = process.argv[2];
if (!account) { console.log('uso: informe o e-mail da conta'); process.exit(2); }
const from = 'FastPro Spike <onboarding@resend.dev>';

let r = await send('aceite-conta', from, account, 'S-11 teste de aceite');
if (r && r.status >= 400) {
  // Se o Resend informar o unico endereco permitido, tenta uma vez com ele (conta do titular).
  const m = /\(([^)\s]+@[^)\s]+)\)/.exec(r.body.message ?? '');
  if (m && m[1].toLowerCase() !== account.toLowerCase()) {
    console.log('retentativa com o endereco informado pelo proprio Resend (nao impresso)');
    r = await send('aceite-conta-retentativa', from, m[1], 'S-11 teste de aceite');
  }
}
const b = await send('bounce', from, 'bounced@resend.dev', 'S-11 teste de bounce');
await new Promise((x) => setTimeout(x, 4000));
if (r?.body?.id) await getStatus('aceite-conta', r.body.id);
if (b?.body?.id) await getStatus('bounce', b.body.id);
console.log('envios_reais:', sends);
