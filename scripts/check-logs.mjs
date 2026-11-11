// Varredura estatica de logs (H-007; ADR-013; 17 §7.4; B-41; T-11). Em codigo de producao
// (apps/*/src, apps/*/api e packages/*/src; .ts .tsx .js .jsx .mjs .cjs .mts .cts; sem testes), reprova:
//  1. qualquer uso de console (console.log, console['log'], alias, desestruturacao, globalThis.console);
//  2. process.stdout/stderr.write fora de packages/observability (use o logger);
//  3. chamadas de logger (receptores log/logger/*Logger/*Log, aliases de child()/createLogger(),
//     prefixos como this./req./app., acesso por "?." e ['metodo']) com:
//     - metodo inexistente (.log, .trace, .verbose, .fatal...; so debug/info/warn/error/child);
//     - campos fora da allowlist (packages/observability/src/allowlist.json);
//     - campos que nao sao objeto literal, spread (...x), chave computada ou valor objeto/array;
//     - JSON.stringify nos argumentos;
//     - interpolacao/concatenacao/valor com expressao sensivel (email, telefone, cpf, token,
//       senha, endereco, nome, body, headers, cookie, req, message...).
// Heuristica estatica (sem AST). Excecao pontual: "check-logs:ignore <motivo>" na linha da
// ocorrencia ou na anterior; sem motivo a propria marca e violacao. Limite: receptores com outros
// nomes (ex.: const x = obterLogger()) nao sao vistos; a regra ESLint no-console reforca o item 1.
import { readFileSync } from 'node:fs';
import { listFiles, readText, hasExt, report } from './lib/files.mjs';

const allowlist = JSON.parse(
  readFileSync(new URL('../packages/observability/src/allowlist.json', import.meta.url), 'utf8'),
);
const ALLOWED = new Set(allowlist.fields);

// Palavras sensiveis, testadas apos separar camelCase e snake_case (customerPhone -> customer Phone).
const SENSITIVE_WORDS =
  /\b(?:e-?mail|phone|telefone|celular|cpf|cnpj|token|secret|password|passwd|senha|address|endereco|authorization|cookie|cookies|payload|content|message|msgbody|texto|name|nome|username|cep|jwt|otp|pepper|apikey)\b/i;
// Acesso a partes de requisicao e uso de req/request fora de req.id/method/url/path/route.
const SENSITIVE_ACCESS =
  /\.(?:body|headers|query|params)\b|\b(?:req|request)\b(?!\.(?:id|method|url|path|route)\b)/i;
function isSensitive(expr) {
  const words = expr.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return SENSITIVE_WORDS.test(words) || SENSITIVE_ACCESS.test(expr);
}
// Qualquer uso do identificador console (chamada, ["log"], ?., alias, desestruturacao) e global.console.
const CONSOLE =
  /(?<![\w$.'"`])console\b|\b(?:globalThis|window|global|self)\s*(?:\??\.|\[)\s*['"`]?console\b/;
// Escrita direta em stdout/stderr (so o sink padrao de @fastpro/observability pode).
const STDIO = /\bprocess\s*(?:\??\s*\.\s*|\[\s*['"`])std(?:out|err)\b/;
// A API do logger so tem estes metodos; log/trace/verbose/fatal... nao existem.
const LOGGER_METHODS = new Set(['debug', 'info', 'warn', 'error', 'child']);
// "check-logs:ignore" exige um motivo depois (>= 3 caracteres).
const IGNORE_MARK = 'check-logs:ignore';
const IGNORE_REASON = /check-logs:ignore\s*(?:[-:—]\s*)?\S.{2,}/;

/**
 * Regex das chamadas de logger: receptores log/logger/*Logger/*Log e aliases criados por
 * child()/createLogger() no arquivo; aceita prefixo (this., req., app.), "?." e ['metodo'].
 */
function loggerCallRegex(text) {
  const names = new Set(['log', 'logger']);
  const alias =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:[\w$.?]*\.)?(?:child|createLogger)\s*\(/g;
  for (const m of text.matchAll(alias)) names.add(m[1]);
  const recv = `(?:${[...names].join('|')}|[A-Za-z_$][\\w$]*(?:Logger|Log))`;
  const id = '[A-Za-z_$][\\w$]*';
  return new RegExp(
    `(?<![\\w$.])(?:${id}\\s*\\??\\.\\s*)*${recv}\\s*` +
      `(?:\\??\\.\\s*(${id})|\\??\\.?\\s*\\[\\s*['"\`](${id})['"\`]\\s*\\])\\s*\\??\\.?\\s*\\(`,
    'g',
  );
}

/** Texto do argumento sem literais de string; templates mantem apenas as expressoes ${...}. */
function expressionsOf(arg) {
  let out = '';
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < arg.length && arg[i] !== c) i += arg[i] === '\\' ? 2 : 1;
      out += ' ';
    } else if (c === '`') {
      i++;
      while (i < arg.length && arg[i] !== '`') {
        if (arg[i] === '\\') i += 2;
        else if (arg[i] === '$' && arg[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < arg.length && depth > 0) {
            if (arg[i] === '{') depth++;
            else if (arg[i] === '}') depth--;
            i++;
          }
          out += ` ${arg.slice(start, i - 1)} `;
        } else i++;
      }
      out += ' ';
    } else out += c;
  }
  return out;
}

/** Divide `text` em partes de nivel 0 separadas por virgula (respeita (), [], {}, strings). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1;
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((p) => p.trim());
}

/** Conteudo entre o parentese de abertura (em `open`, exclusivo) e o fechamento correspondente. */
function balancedArgs(text, open) {
  let depth = 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text.slice(open, i);
  }
  return null;
}

function checkFields(objText, where, violations) {
  const inner = objText.slice(1, objText.lastIndexOf('}'));
  for (const entry of splitTopLevel(inner)) {
    if (entry.startsWith('...')) {
      violations.push(`${where} spread de objeto nos campos do log (${entry.slice(0, 30)})`);
      continue;
    }
    const m = /^(?:\[[^\]]*\]|['"]?([A-Za-z_$][\w$-]*)['"]?)\s*(?::([\s\S]*))?$/.exec(entry);
    if (!m || m[1] === undefined) {
      violations.push(`${where} chave computada ou invalida nos campos do log`);
      continue;
    }
    const key = m[1];
    const value = (m[2] ?? key).trim();
    if (!ALLOWED.has(key)) violations.push(`${where} campo fora da allowlist: "${key}"`);
    if (/^[{[]/.test(value)) violations.push(`${where} valor objeto/array no campo "${key}"`);
    else if (isSensitive(expressionsOf(value))) {
      violations.push(`${where} expressao sensivel no campo "${key}": ${value.slice(0, 40)}`);
    }
  }
}

const root = process.cwd();
const violations = [];
let scanned = 0;
let calls = 0;

const SCOPE = /^(?:apps\/[^/]+\/(?:src|api)\/|packages\/[^/]+\/src\/)/;
const EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];

for (const file of listFiles(root)) {
  if (!SCOPE.test(file) || !hasExt(file, EXTS) || /\.(?:test|spec)\.|__tests__/.test(file)) {
    continue;
  }
  const text = readText(root, file);
  if (text === null) continue;
  scanned++;
  const lines = text.split('\n');
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const ignored = (ln) =>
    [lines[ln - 1], lines[ln - 2]].some((l) => l !== undefined && IGNORE_REASON.test(l));
  const isObservability = file.startsWith('packages/observability/');

  lines.forEach((line, i) => {
    if (line.includes(IGNORE_MARK) && !IGNORE_REASON.test(line)) {
      violations.push(`${file}:${i + 1} ${IGNORE_MARK} sem motivo (escreva o motivo depois)`);
    }
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    if (CONSOLE.test(line) && !ignored(i + 1)) {
      violations.push(`${file}:${i + 1} uso de console em codigo de producao (use o logger)`);
    }
    if (!isObservability && STDIO.test(line) && !ignored(i + 1)) {
      violations.push(`${file}:${i + 1} escrita direta em stdout/stderr (use o logger)`);
    }
  });

  for (const m of text.matchAll(loggerCallRegex(text))) {
    const ln = lineOf(m.index);
    if (ignored(ln)) continue;
    const method = m[1] ?? m[2];
    const inside = balancedArgs(text, m.index + m[0].length);
    if (inside === null) continue;
    calls++;
    const where = `${file}:${ln}`;
    if (!LOGGER_METHODS.has(method)) {
      violations.push(
        `${where} metodo ".${method}" nao existe no logger (use debug/info/warn/error)`,
      );
      continue;
    }
    const args = splitTopLevel(inside);
    if (/JSON\.stringify\s*\(/.test(inside)) {
      violations.push(`${where} JSON.stringify em chamada de log`);
    }
    const isChild = method === 'child';
    const msg = isChild ? undefined : args[0];
    const fields = isChild ? args[0] : args[1];
    if (msg !== undefined && isSensitive(expressionsOf(msg))) {
      violations.push(`${where} interpolacao sensivel na mensagem: ${msg.slice(0, 50)}`);
    }
    if (fields !== undefined) {
      if (!fields.startsWith('{')) {
        violations.push(
          `${where} campos do log devem ser um objeto literal (recebeu: ${fields.slice(0, 30)})`,
        );
      } else checkFields(fields, where, violations);
    }
  }
}
report('check-logs', violations, `${scanned} arquivos, ${calls} chamadas de logger`);
