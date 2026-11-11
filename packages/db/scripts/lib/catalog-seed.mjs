// Logica pura (sem banco e sem rede) da semente do catalogo (H-018, 53-DESENHO-H018 §4.1).
// Converte docs/factory/06-CATALOGO-PROPOSTO.md no JSON versionado e valida o resultado.
// Regras determinicas, conferidas pelos testes T-H018-01..09 (tests/catalog-seed.test.mjs).
// Nada aqui imprime segredo ou depende de ambiente. O conteudo e PROVISORIO (sufixo -provisorio).

export const SEED_VERSION = 'v1-provisorio';
export const MODALITY_MAP = Object.freeze({ PR: 'presencial', ON: 'online', HI: 'ambos' });
export const MODALITIES = Object.freeze(['presencial', 'online', 'ambos']);
// Somente conselhos profissionais: a lista do desenho 53 §4.1(1), mais CFP, CFTA e CORE (decisao do
// Orquestrador no #31). Servico ligado a um desses orgaos entra inativo ([DECIDIDO]). Reguladores
// (CVM, SUSEP, DRT e similares) ficam fora desta lista e entram ativos.
export const COUNCILS = Object.freeze([
  'OAB', 'CRC', 'CRM', 'CRO', 'CRP', 'CREFITO', 'COREN', 'CRN', 'CREF', 'CRMV', 'CAU', 'CREA',
  'CFT', 'CRECI', 'CRFa', 'CRF', 'CRQ', 'CFM', 'CFP', 'CFTA', 'CORE',
]);
const COUNCIL_SET = new Set(COUNCILS);

/** Normalizacao espelho de private.catalog_norm (SQL): minusculas, sem acento, espacos colapsados. */
export function catalogNorm(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave ASCII estavel a partir do nome (ex.: "Pedreiro" -> "pedreiro"). */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Interpreta a coluna REG da tabela de servicos.
 * Marcas: "—" (nao regulamentado), "REG" e "REG?" (regulamentado). "SENS" entre parenteses marca
 * sensibilidade. Demais itens do parenteses, se contiverem um orgao da lista, viram council_body.
 */
export function parseReg(raw) {
  const text = String(raw ?? '').trim();
  const m = /^(—|REG\?|REG)\s*(?:\((.*)\))?$/u.exec(text);
  if (!m) throw new Error(`coluna REG nao reconhecida: "${text}"`);
  const marker = m[1];
  const parts = (m[2] ?? '')
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const sensitive = parts.includes('SENS');
  const rest = parts.filter((p) => p !== 'SENS').join('; ');
  const tokens = rest.split(/[\s/,;()]+/).filter((t) => t.length > 0);
  const hasCouncil = tokens.some((t) => COUNCIL_SET.has(t));
  return {
    regulated: marker !== '—',
    sensitive,
    council_body: hasCouncil ? rest : null,
  };
}

/**
 * Le as tabelas de servico do 06. Retorna grupos (na ordem) e as linhas brutas de servico.
 * Linhas "ver Gxx" na coluna de modalidade sao referencias cruzadas (descartadas). Na coluna de
 * sinonimos, "ver Gxx" nao e sinonimo (ignorado).
 */
export function parseCatalogMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const groups = [];
  const rows = [];
  const crossRefs = [];
  let current = null;
  for (const line of lines) {
    const header = /^## G(\d{2})\. (.+)$/.exec(line);
    if (header) {
      current = { key: `g${header[1]}`, position: Number(header[1]), name: header[2].trim() };
      groups.push(current);
      continue;
    }
    if (line.startsWith('## ')) {
      current = null;
      continue;
    }
    if (!current || !line.startsWith('| ') || line.startsWith('|---')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4 || cells[0] === 'Serviço') continue;
    const [name, mod, reg, syn] = cells;
    if (/^ver G\d{2}$/.test(mod)) {
      crossRefs.push({ group_key: current.key, name, mod, reg, syn });
      continue;
    }
    if (!(mod in MODALITY_MAP)) throw new Error(`modalidade invalida em ${current.key}: "${name}" (${mod})`);
    const synonyms = /^ver G\d{2}$/.test(syn)
      ? []
      : syn.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    rows.push({ group_key: current.key, name, modality: MODALITY_MAP[mod], reg, synonyms, note_ref: /^ver G\d{2}$/.test(syn) ? syn : null });
  }
  return { groups, rows, crossRefs };
}

/**
 * Monta a semente: um grupo por servico. Nome repetido em outro grupo: fica no PRIMEIRO grupo; a
 * ocorrencia descartada contribui com o nome e os sinonimos como sinonimos do item mantido.
 * Devolve a semente e a estatistica medida (contagens reais).
 */
export function buildSeed(markdown, version = SEED_VERSION) {
  const { groups, rows, crossRefs } = parseCatalogMarkdown(markdown);
  const stats = {
    rows_read: rows.length,
    cross_refs_discarded: crossRefs.length,
    repeated_names: [],
    rows_with_ver_note: rows.filter((r) => r.note_ref).length,
    sensitive: 0,
    council_inactive: 0,
    regulated: 0,
  };
  const kept = new Map(); // name_norm -> service (primeiro grupo)
  const services = [];
  const keysInGroup = new Map();
  for (const row of rows) {
    const norm = catalogNorm(row.name);
    const reg = parseReg(row.reg);
    const synonymsOfRow = row.synonyms.filter((s) => catalogNorm(s) !== '');
    const prior = kept.get(norm);
    if (prior) {
      // Mesmo nome em outro grupo: vira sinonimo do item mantido (primeiro grupo).
      stats.repeated_names.push({ name: row.name, kept_group: prior.group_key, dropped_group: row.group_key });
      const extra = [row.name, ...synonymsOfRow];
      for (const term of extra) {
        if (catalogNorm(term) === prior.name_norm) continue;
        if (!prior.synonyms.some((s) => catalogNorm(s) === catalogNorm(term))) prior.synonyms.push(term);
      }
      continue;
    }
    const slug = slugify(row.name);
    const groupKeys = keysInGroup.get(row.group_key) ?? new Set();
    const key = `${row.group_key}-${slug}`;
    if (groupKeys.has(key)) throw new Error(`chave de servico duplicada: ${key}`);
    groupKeys.add(key);
    keysInGroup.set(row.group_key, groupKeys);
    const synonyms = [];
    for (const term of synonymsOfRow) {
      if (catalogNorm(term) === norm) continue;
      if (!synonyms.some((s) => catalogNorm(s) === catalogNorm(term))) synonyms.push(term);
    }
    const service = {
      key,
      group_key: row.group_key,
      name: row.name,
      name_norm: norm,
      modality: row.modality,
      regulated: reg.regulated,
      council_body: reg.council_body,
      sensitive: reg.sensitive,
      active: reg.council_body === null,
      synonyms,
    };
    kept.set(norm, service);
    services.push(service);
  }
  for (const s of services) {
    if (s.sensitive) stats.sensitive += 1;
    if (s.regulated) stats.regulated += 1;
    if (s.council_body !== null) stats.council_inactive += 1;
  }
  stats.services_total = services.length;
  stats.services_active = services.filter((s) => s.active).length;
  stats.synonyms_total = services.reduce((n, s) => n + s.synonyms.length, 0);
  const seed = {
    version,
    groups: groups.map((g) => ({ key: g.key, position: g.position, name: g.name })),
    services: services.map((s) => {
      const out = { ...s };
      delete out.name_norm;
      return out;
    }),
  };
  return { seed, stats };
}

/** Serializacao canonica: JSON com 2 espacos e fim de linha LF. Mesma entrada = mesmo texto. */
export function serializeSeed(seed) {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

/** Validador (§4.1 e T-H018-03/09). Devolve a lista de erros; vazia = valida. */
export function validateSeed(seed) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (typeof seed?.version !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,39}$/.test(seed.version)) {
    err('version invalida');
  }
  const groups = Array.isArray(seed?.groups) ? seed.groups : [];
  const services = Array.isArray(seed?.services) ? seed.services : [];
  const groupKeys = new Set();
  const groupNames = new Set();
  const positions = new Set();
  for (const g of groups) {
    if (!/^g\d{2}$/.test(g?.key ?? '')) err(`chave de grupo invalida: ${g?.key}`);
    if (groupKeys.has(g?.key)) err(`chave de grupo duplicada: ${g?.key}`);
    groupKeys.add(g?.key);
    const name = typeof g?.name === 'string' ? g.name.trim() : '';
    if (name.length < 1 || name.length > 80) err(`nome de grupo vazio ou longo: ${g?.key}`);
    if (groupNames.has(catalogNorm(name))) err(`nome de grupo repetido: ${g?.key}`);
    groupNames.add(catalogNorm(name));
    if (!Number.isInteger(g?.position) || g.position < 1) err(`posicao invalida: ${g?.key}`);
    if (positions.has(g?.position)) err(`posicao repetida: ${g?.key}`);
    positions.add(g?.position);
  }
  const serviceKeys = new Set();
  const namesByGroup = new Map();
  const activeByGroup = new Map();
  for (const s of services) {
    if (typeof s?.key !== 'string' || !/^g\d{2}-[a-z0-9-]+$/.test(s.key)) err(`chave de servico invalida: ${s?.key}`);
    if (serviceKeys.has(s?.key)) err(`chave de servico duplicada: ${s?.key}`);
    serviceKeys.add(s?.key);
    if (!groupKeys.has(s?.group_key)) err(`group_key inexistente em ${s?.key}: ${s?.group_key}`);
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (name.length < 1 || name.length > 120) err(`nome de servico vazio ou longo: ${s?.key}`);
    const names = namesByGroup.get(s?.group_key) ?? new Set();
    if (names.has(catalogNorm(name))) err(`nome repetido no grupo: ${s?.key}`);
    names.add(catalogNorm(name));
    namesByGroup.set(s?.group_key, names);
    if (!MODALITIES.includes(s?.modality)) err(`modalidade invalida em ${s?.key}: ${s?.modality}`);
    for (const flag of ['regulated', 'sensitive', 'active']) {
      if (typeof s?.[flag] !== 'boolean') err(`${flag} nao booleano em ${s?.key}`);
    }
    if (s?.council_body !== null) {
      if (typeof s?.council_body !== 'string' || s.council_body.length < 1 || s.council_body.length > 40) {
        err(`council_body invalido em ${s?.key}`);
      } else if (s.regulated !== true) {
        err(`council_body sem regulated em ${s?.key}`);
      }
      if (s.active !== false) err(`conselho profissional deve estar inativo: ${s?.key}`);
    } else if (s?.active !== true) {
      err(`servico sem conselho deve estar ativo: ${s?.key}`);
    }
    const terms = new Set([catalogNorm(name)]);
    for (const term of Array.isArray(s?.synonyms) ? s.synonyms : []) {
      if (typeof term !== 'string' || term.trim().length < 1 || term.trim().length > 80) {
        err(`sinonimo vazio ou longo em ${s?.key}`);
        continue;
      }
      if (terms.has(catalogNorm(term))) err(`sinonimo repetido em ${s?.key}: ${term}`);
      terms.add(catalogNorm(term));
    }
    if (s?.active === true) activeByGroup.set(s.group_key, (activeByGroup.get(s.group_key) ?? 0) + 1);
  }
  for (const g of groups) {
    if (!activeByGroup.get(g.key)) err(`grupo sem servico ativo (nao pode ser ativo): ${g.key}`);
  }
  return errors;
}
