// H-100 | Regras do verificador de ausencia de interruptor de e-mail (Issue #110).
// Funcao pura, sem I/O e sem dependencia: scan(arquivos) -> violacoes. O CLI
// (scripts/check-no-email-switch.mjs) le os arquivos e chama scan().
// Desenho: docs/factory/49-DESENHO-H100.md, §1 (regras), §1.3 (falha fechada).
// Listas de permissao e de excecao sao mantidas pelo Reviewer (49 §5, D-2).

const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'sql', 'json', 'toml', 'yml', 'yaml', 'sh'];
const EXCLUIDOS = ['docs/', 'scripts/', '.github/'];
const NAO_CODIGO = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'pdf',
];
const VERIFICADOR = ['scripts/check-no-email-switch.mjs', 'scripts/lib/email-switch-rules.mjs'];

// N1: grupo E (quem envia) e grupo S (quem liga/desliga). Identificador com os dois = violacao.
const E_PADROES = [
  'mail',
  'email',
  'notif*',
  'aviso*',
  'send*',
  'envio',
  'enviar',
  'enviad*',
  'enviando',
  'outbox',
  'dispatch*',
  'despach*',
  'provider',
  'resend',
  'smtp',
  'deliver*',
  'entrega',
  'mailer',
];
const S_PADROES = [
  'enable*',
  'disable*',
  'switch',
  'toggle*',
  'flag',
  'flags',
  'kill',
  'pause*',
  'liga',
  'desliga*',
  'habilit*',
  'desabilit*',
  'ativ*',
  'active',
  'mute*',
  'silenc*',
  'dry',
  'noop',
  'off',
  'stop',
  'halt',
  'suspend*',
  'bypass',
  'skip*',
];
// N2: estruturas de flag e bibliotecas de feature flag.
const FLAG_PADROES = ['flag', 'flags', 'switch', 'toggle*'];
const PACOTES_FLAG =
  /['"`](@vercel\/flags|flags\/next|@vercel\/edge-config|launchdarkly|unleash|growthbook|posthog)[^'"`]*['"`]/;

// C1 / J1: tipos de job fechados (C2) e sufixos de chave permitidos (janela e cota).
const JOBS_FECHADOS = ['outbox.dispatch', 'notification.flush', 'email.send'];
const PREFIXOS_E = /^(notification|email|mail|aviso)\./;
const SUFIXO_CHAVE_OK = /(\.window_seconds|\.limit|_limit)$/;
const CHAVE_RE = /(['"`])((?:notification|email|mail|aviso)\.[A-Za-z0-9_.-]+)\1/g;
const JOB_RE =
  /(?:registerJobHandler\(\s*[^,()]+,\s*|registry\.register\(\s*|job_enqueue\(\s*|\bkind:\s*)(['"`])([^'"`]*)\1/g;
const VEDADO_JOB = /(backfill|retro|reenvi|redispatch)/i;

// R1: rotas e caminhos.
const ROTA_PERMITIDA = new Set(['/v1/webhooks/resend']);
const ROTA_VEDADA = [
  'backfill',
  'retro*',
  'reenvi*',
  'redispatch',
  'unsubscribe',
  'opt-out',
  'descadastr*',
];
const ROTA_CONFIG = ['config', 'settings', 'preferenc*', 'ajustes'];
const ROTA_RE = /(['"`])(\/[^'"`\s]*)\1/g;

// V1: variavel do provedor (D-2: so resend; nunca significa "nao enviar").
const EMAIL_PROVIDERS_RE = /\bEMAIL_PROVIDERS\s*=\s*\[([^\]]*)\]/g;
const EMAIL_PROVIDER_RE = /\bEMAIL_PROVIDER\b/i;
const VALOR_PROIBIDO_RE = /(?<![\w-])(off|none|disabled|noop|false|0|skip|dry-run)(?![\w-])/i;

// V2: adaptadores mudos (nao podem existir fora de teste).
const ADAPTADOR_RE =
  /\b(FakeEmailProvider|NoopEmailProvider|NullEmailProvider|ConsoleEmailProvider|LogEmailProvider)\b/;

// W1: escrita nas tabelas de envio so em funcoes permitidas (ou em arquivos de teste).
const DML_RE =
  /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|copy)\s+(?:ops\.)?(email_outbox|notification_item|notification_cooldown)\b/gi;
const FUNCOES_W1 = ['private.notification_', 'private.email_outbox_', 'private.email_quota_'];

// M1: marco de vigencia imutavel (literal).
const MARCO_LITERAL =
  /^(Date\.UTC\(\s*2026\s*,\s*10\s*,\s*11\s*\)|'2026-11-11T00:00:00\.000Z'|"2026-11-11T00:00:00\.000Z")(\s+as\s+const)?$/;
const MARCO_DECL =
  /\b(?:const|let|var)\s+(NOTIFICATION_EFFECTIVE_FROM\w*)\s*(?::[^=]*)?=\s*(.*?)\s*;?\s*$/;

// FC: canarios de cobertura (falha fechada se o verificador ficar cego).
const CANARIOS = [
  { arquivo: 'packages/email/src/select.ts', marcadores: ['EMAIL_PROVIDER'] },
  {
    arquivo: 'supabase/migrations/20261111120000_notifications_create_pipeline.sql',
    marcadores: ['create table if not exists ops.email_outbox'],
  },
  {
    arquivo: 'packages/db/src/notifications.ts',
    marcadores: ["'outbox.dispatch'", "'notification.flush'", "'email.send'"],
  },
];

const SEPARADOR = /[._-]+|(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const TOKEN_RE = /[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu;

export function extOf(caminho) {
  const m = /\.([^./]+)$/.exec(caminho.split('/').pop());
  return m ? m[1].toLowerCase() : '';
}

export function palavras(token) {
  return token
    .split(SEPARADOR)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

const casa = (w, padroes) =>
  padroes.some((p) => (p.endsWith('*') ? w.startsWith(p.slice(0, -1)) : w === p));

export function ehTeste(caminho) {
  return /\.(test|dbtest)\.[cm]?[jt]sx?$/.test(caminho) || /(^|\/)tests?\//.test(caminho);
}

/** Escopo das regras gerais: apps, packages, supabase e configuracao da raiz. */
export function escopoGeral(caminho) {
  if (caminho.split('/').some((s) => s === 'node_modules' || s === 'dist')) return false;
  if (EXCLUIDOS.some((e) => caminho.startsWith(e))) return false;
  if (caminho === 'pnpm-lock.yaml') return false;
  const base = caminho.split('/').pop();
  if (base === '.env.example') return true;
  if (base.startsWith('.env')) return false; // .env.local nunca entra
  if (!EXTS.includes(extOf(caminho))) return false;
  if (!caminho.includes('/')) return true;
  return ['apps/', 'packages/', 'supabase/'].some((r) => caminho.startsWith(r));
}

/** Escopo de W1 (escrita em tabelas de envio): o escopo geral mais scripts/ (exceto o proprio verificador). */
export function escopoW1(caminho) {
  if (escopoGeral(caminho)) return true;
  return (
    caminho.startsWith('scripts/') &&
    !caminho.startsWith('scripts/__tests__/') &&
    !VERIFICADOR.includes(caminho) &&
    EXTS.includes(extOf(caminho))
  );
}

function langOf(caminho) {
  if (caminho.split('/').pop() === '.env.example') return 'hash';
  const ext = extOf(caminho);
  if (['yml', 'yaml', 'toml', 'sh'].includes(ext)) return 'hash';
  if (ext === 'sql') return 'sql';
  return 'js';
}

/** Remove comentarios preservando quebras de linha. Strings sao mantidas (rotas e chaves ficam visiveis). */
export function stripComments(texto, lang) {
  if (lang === 'hash') {
    return texto
      .split('\n')
      .map((linha) => {
        const m = /(^|\s)#/.exec(linha);
        return m ? linha.slice(0, m.index) : linha;
      })
      .join('\n');
  }
  const sql = lang === 'sql';
  const n = texto.length;
  let out = '';
  let i = 0;
  let aspas = null;
  while (i < n) {
    const c = texto[i];
    if (aspas) {
      if (c === '\n' && aspas !== '`' && !sql)
        aspas = null; // aspas JS nao atravessam linhas
      else if (!sql && c === '\\' && i + 1 < n) {
        out += c + texto[i + 1];
        i += 2;
        continue;
      } else if (c === aspas) aspas = null;
      out += c;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      aspas = c;
      out += c;
      i++;
      continue;
    }
    const comentarioLinha = sql
      ? c === '-' && texto[i + 1] === '-'
      : c === '/' && texto[i + 1] === '/';
    if (comentarioLinha) {
      while (i < n && texto[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      const parada = fim < 0 ? n : fim + 2;
      for (; i < parada; i++) out += texto[i] === '\n' ? '\n' : ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (texto, idx) => texto.slice(0, idx).split('\n').length;

// Excecao fixa (49 §4 FP-1, lista do Reviewer): o proprio verificador referenciado em package.json.
// Os nomes sao o script `check:email-switch` e o arquivo `check-no-email-switch.mjs`.
const EXCECOES_NOME = { 'package.json': ['check:email-switch', 'check-no-email-switch.mjs'] };
function semExcecao(caminho, linha) {
  let saida = linha;
  for (const nome of EXCECOES_NOME[caminho] ?? []) saida = saida.replaceAll(nome, '');
  return saida;
}

function nomeProibido(token) {
  const ws = palavras(token);
  return ws.some((w) => casa(w, E_PADROES)) && ws.some((w) => casa(w, S_PADROES));
}

function caminhoProibido(caminho) {
  const semExt = caminho.replace(/\.[^./]+$/, '');
  const segs = semExt.split('/');
  const ws = segs.flatMap((s) => palavras(s));
  const temE = ws.some((w) => casa(w, E_PADROES));
  const temS = ws.some((w) => casa(w, S_PADROES));
  if (temE && temS) return 'nome de interruptor no caminho';
  if (temE && ws.some((w) => casa(w, ROTA_CONFIG))) return 'configuracao de e-mail no caminho';
  return null;
}

/** Rota ou caminho com segmento vedado (backfill, reenvio, descadastro) ou replay junto de grupo E. */
function rotaProibida(rota) {
  const segs = rota.split(/[/?#]/).filter(Boolean);
  const ws = segs.flatMap((s) => palavras(s));
  const vedado =
    segs.some((s) => casa(s.toLowerCase(), ROTA_VEDADA)) || ws.some((w) => casa(w, ROTA_VEDADA));
  if (vedado) return 'segmento vedado (reenvio, backfill ou descadastro)';
  if (ws.includes('replay') && ws.some((w) => casa(w, E_PADROES))) return 'replay de envio';
  return caminhoProibido(rota);
}

function jobProibido(kind) {
  if (JOBS_FECHADOS.includes(kind)) return null;
  if (VEDADO_JOB.test(kind)) return 'tipo de job de reenvio ou backfill';
  if (PREFIXOS_E.test(kind)) return 'tipo de job fora do conjunto fechado';
  return null;
}

function chaveProibida(chave) {
  if (JOBS_FECHADOS.includes(chave) || SUFIXO_CHAVE_OK.test(chave)) return null;
  return 'chave de configuracao fora de janela ou cota';
}

/** W1 em SQL: DML so dentro de corpo $$ de funcao permitida. Fora de funcao = backfill de envio. */
function checaW1Sql(caminho, limpo, out) {
  const delim = [...limpo.matchAll(/\$\$/g)].map((m) => m.index);
  if (delim.length % 2 === 1) {
    out.push(`${caminho}:${lineOf(limpo, delim.at(-1))} W1: delimitador $$ desbalanceado`);
  }
  const corpos = [];
  let fimAnterior = 0;
  for (let k = 0; k + 1 < delim.length; k += 2) {
    const abre = delim[k];
    const fecha = delim[k + 1];
    const seg = limpo.slice(fimAnterior, abre);
    const ultimo = [...seg.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)/gi)].at(-1);
    const nome = ultimo && !seg.slice(ultimo.index).includes(';') ? ultimo[1].toLowerCase() : null;
    corpos.push({ inicio: abre + 2, fim: fecha, nome });
    fimAnterior = fecha + 2;
  }
  for (const m of limpo.matchAll(DML_RE)) {
    const corpo = corpos.find((c) => m.index >= c.inicio && m.index < c.fim);
    const permitido = Boolean(corpo?.nome && FUNCOES_W1.some((p) => corpo.nome.startsWith(p)));
    if (!permitido) {
      out.push(
        `${caminho}:${lineOf(limpo, m.index)} W1: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`,
      );
    }
  }
}

/** W1 por linguagem: em SQL, DML so dentro de funcao permitida; em TS/JS, DML so em arquivo de teste. */
function checaW1(caminho, limpo, lang, out) {
  if (lang === 'sql') {
    checaW1Sql(caminho, limpo, out);
    return;
  }
  if (ehTeste(caminho)) return;
  for (const m of limpo.matchAll(DML_RE)) {
    out.push(`${caminho}:${lineOf(limpo, m.index)} W1: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
  }
}

function checaArquivo(caminho, texto, out) {
  const v = (n, regra, trecho) =>
    out.push(`${caminho}:${n} ${regra}: ${String(trecho).replace(/\s+/g, ' ').slice(0, 80)}`);
  const lang = langOf(caminho);
  const limpo = stripComments(texto, lang);
  const ehExemplo = caminho.split('/').pop() === '.env.example';

  if (!escopoGeral(caminho)) {
    checaW1(caminho, limpo, lang, out);
    return;
  }

  // W1 (DML em tabelas de envio).
  checaW1(caminho, limpo, lang, out);

  // N2: estruturas de flag e bibliotecas de feature flag (SQL e TS).
  for (const m of limpo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
    if (palavras(m[1]).some((w) => casa(w, FLAG_PADROES))) v(lineOf(limpo, m.index), 'N2', m[1]);
  }

  // V1 (a): lista de provedores e so 'resend'.
  for (const m of limpo.matchAll(EMAIL_PROVIDERS_RE)) {
    const valores = [...m[1].matchAll(/['"`]([^'"`]*)['"`]/g)].map((x) => x[1]);
    if (valores.length !== 1 || valores[0] !== 'resend') {
      v(lineOf(limpo, m.index), 'V1', 'EMAIL_PROVIDERS com valor diferente de resend');
    }
  }

  // R1: rotas literais em apps/** e caminhos de arquivo em apps/*/src.
  if (caminho.startsWith('apps/')) {
    if (/^apps\/[^/]+\/src\//.test(caminho)) {
      const motivo = caminhoProibido(caminho);
      if (motivo) v(1, 'R1', `${motivo}: ${caminho}`);
    }
    for (const m of limpo.matchAll(ROTA_RE)) {
      const rota = m[2].split('${')[0].split(/[?#]/)[0];
      if (ROTA_PERMITIDA.has(rota) || rota === '/') continue;
      const motivo = rotaProibida(rota);
      if (motivo) v(lineOf(limpo, m.index), 'R1', `${motivo}: ${rota}`);
    }
  }

  const linhas = limpo.split('\n');
  linhas.forEach((linha0, i) => {
    const n = i + 1;
    const linha = semExcecao(caminho, linha0);

    // N1: identificadores (e literais) com grupo E e grupo S.
    for (const tok of linha.matchAll(TOKEN_RE)) {
      const t = tok[0].replace(/[.-]+$/, '');
      if (nomeProibido(t)) v(n, 'N1', t);
      const ws = palavras(t);
      if (ws.includes('feature') && (ws.includes('flag') || ws.includes('flags'))) v(n, 'N2', t);
    }
    if (PACOTES_FLAG.test(linha)) v(n, 'N2', 'biblioteca de feature flag');

    // C1: chaves de config de e-mail/notificacao (so janela e cota).
    for (const m of linha.matchAll(CHAVE_RE)) {
      const motivo = chaveProibida(m[2]);
      if (motivo) v(n, 'C1', m[2]);
    }

    // J1: tipos de job.
    for (const m of linha.matchAll(JOB_RE)) {
      const motivo = jobProibido(m[2]);
      if (motivo) v(n, 'J1', m[2]);
    }

    // V1 (b) e (d): EMAIL_PROVIDER so em packages/email ou teste; nenhum valor que desligue.
    if (EMAIL_PROVIDER_RE.test(linha)) {
      if (!ehExemplo && !caminho.startsWith('packages/email/') && !ehTeste(caminho)) {
        v(n, 'V1', 'EMAIL_PROVIDER lido fora de packages/email');
      }
      const proibido = VALOR_PROIBIDO_RE.exec(linha);
      if (proibido) v(n, 'V1', `EMAIL_PROVIDER com valor que desliga (${proibido[1]})`);
    }

    // V2: adaptadores mudos fora de teste e de testkit.
    if (!ehTeste(caminho) && !caminho.startsWith('packages/testkit/')) {
      const m = ADAPTADOR_RE.exec(linha);
      if (m) v(n, 'V2', m[1]);
    }

    // M1: marco de vigencia literal.
    const decl = MARCO_DECL.exec(linha);
    if (decl && !MARCO_LITERAL.test(decl[2])) v(n, 'M1', `${decl[1]} nao e literal`);
  });

  // V1 (c): .env.example aceita vazio ou resend.
  if (ehExemplo) {
    linhas.forEach((linha, i) => {
      const m = /^EMAIL_PROVIDER=(.*)$/.exec(linha.trim());
      if (m && !['', 'resend'].includes(m[1].trim())) {
        v(i + 1, 'V1', 'EMAIL_PROVIDER no exemplo com valor diferente de resend');
      }
    });
  }
}

/** Canarios: os arquivos que o verificador precisa enxergar. Usado pelo autoteste e pelos testes. */
export function canarios() {
  return {
    'packages/email/src/select.ts': 'export const provider = env.EMAIL_PROVIDER;\n',
    'supabase/migrations/20261111120000_notifications_create_pipeline.sql':
      'create table if not exists ops.email_outbox (id uuid primary key);\n',
    'packages/db/src/notifications.ts':
      "registerJobHandler(registry, 'outbox.dispatch', a);\n" +
      "registerJobHandler(registry, 'notification.flush', b);\n" +
      "registerJobHandler(registry, 'email.send', c);\n",
  };
}

/** Arquivos versionados de extensao nao varrida dentro de apps/packages/supabase (aviso, nao falha). */
export function arquivosNaoVarridos(caminhos) {
  return caminhos.filter(
    (p) =>
      ['apps/', 'packages/', 'supabase/'].some((r) => p.startsWith(r)) &&
      !EXTS.includes(extOf(p)) &&
      p.split('/').pop() !== '.env.example' &&
      !NAO_CODIGO.includes(extOf(p)),
  );
}

/**
 * Varre um mapa caminho -> texto e devolve as violacoes (`caminho:linha REGRA: trecho`).
 * Falha fechada: 0 arquivos ou canario ausente tambem reprova.
 */
export function scan(arquivos) {
  const mapa = arquivos instanceof Map ? arquivos : new Map(Object.entries(arquivos));
  const out = [];
  const caminhos = [...mapa.keys()].filter((p) => escopoW1(p));
  if (caminhos.length === 0) out.push('(varredura):0 FC: nenhum arquivo varrido');
  for (const c of CANARIOS) {
    const texto = mapa.get(c.arquivo);
    if (typeof texto !== 'string') {
      out.push(`${c.arquivo}:0 FC: canario ausente`);
      continue;
    }
    const limpo = stripComments(texto, langOf(c.arquivo));
    for (const marcador of c.marcadores) {
      if (!limpo.includes(marcador)) out.push(`${c.arquivo}:0 FC: canario sem ${marcador}`);
    }
  }
  for (const caminho of caminhos) {
    const texto = mapa.get(caminho);
    if (typeof texto !== 'string') continue; // binario
    checaArquivo(caminho, texto, out);
  }
  return out;
}
