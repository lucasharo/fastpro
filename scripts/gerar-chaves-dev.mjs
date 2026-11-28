// Gerador de chaves DEV (Issue #156, desenho 177 §4 e §5). Preenche somente nomes ausentes ou vazios do grupo
// pedido, no .env.local. Nunca sobrescreve valor preenchido, nunca imprime valor, tamanho ou prefixo.
// Uso: corepack pnpm dev:chaves [--grupo rotas-minimas]
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aplicarPreenchimentos, gravarAtomico, lerArquivo, lerEstado, valorDaLinha } from './lib/env-local.mjs';

export const BYTES_CHAVE = 32;

/**
 * Grupos de geracao. "rotas-minimas" cobre o ambiente DEV local (#156): login, rascunho sem conta, endereco,
 * pedido, perfil e documentos. Chaves hex (>= 32 caracteres) em "aleatorias"; chaves de cifra de 32 bytes em
 * base64 em "base64"; "copias" reaproveita um valor ja existente no proprio .env.local sob o nome que o codigo le.
 */
export const GRUPOS = {
  'rotas-minimas': {
    aleatorias: [
      'PEPPER_EMAIL_HMAC',
      'PEPPER_CODE_HMAC',
      'PEPPER_IP_HMAC',
      'SESSION_COOKIE_SECRET',
      'JOBS_TICK_SECRET',
      'DRAFT_IP_HMAC_KEY',
      'ADDRESS_HASH_KEY',
      'ADDRESS_ENC_KEY',
      'PHONE_ENC_KEY',
      'REQUEST_PUBLISH_HMAC_KEY',
      'DISCOVERY_CURSOR_KEY',
      'PROFILE_RATE_HMAC_KEY',
    ],
    base64: ['DATA_ENC_KEY_V1', 'DOCUMENT_HMAC_KEY'],
    literais: [
      ['APP_ENV', 'local'],
      ['APP_BASE_URL', 'http://127.0.0.1:3000'],
      ['DATA_ENC_KEY_ACTIVE_VERSION', '1'],
      ['MAPBOX_TEMP_SOFT_LIMIT', '90000'],
      ['MAPBOX_TEMP_HARD_LIMIT', '99000'],
    ],
    copias: [['MAPBOX_ACCESS_TOKEN', 'MAPBOX_ACCESS_TOKEN_SERVER']],
    minimos: { CATALOG_RATE_HMAC_KEY: 32 },
  },
};

const gerarHex = () => randomBytes(BYTES_CHAVE).toString('hex');
const gerarBase64 = () => randomBytes(BYTES_CHAVE).toString('base64');

/** Valor (sem aspas) da ultima linha NOME=valor de origem, ou null quando vazia/ausente. Nunca registrado. */
function valorDeOrigem(texto, nomeOrigem) {
  let valor = null;
  for (const raw of texto.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw.trim());
    if (m !== null && m[1] === nomeOrigem) valor = valorDaLinha(m[2]);
  }
  return valor === null || valor === '' ? null : valor;
}

/** Calcula o novo texto sem gravar. gerar e gerarB64 sao injetaveis para teste. */
export function planejar(texto, grupo, gerar = gerarHex, gerarB64 = gerarBase64) {
  const def = GRUPOS[grupo];
  if (def === undefined) throw new Error(`grupo desconhecido: ${grupo}`);
  const copias = (def.copias ?? [])
    .map(([destino, origem]) => [destino, valorDeOrigem(texto, origem)])
    .filter(([, valor]) => valor !== null);
  const entradas = [
    ...def.aleatorias.map((nome) => [nome, gerar()]),
    ...(def.base64 ?? []).map((nome) => [nome, gerarB64()]),
    ...def.literais,
    ...copias,
  ];
  const resultado = aplicarPreenchimentos(
    texto,
    entradas,
    'Gerado para o ambiente DEV local (desenho 177); sem valores no repositorio.',
  );
  const estadoNovo = lerEstado(resultado.texto);
  const curtas = Object.entries(def.minimos)
    .filter(([nome, minimo]) => {
      const e = estadoNovo.get(nome);
      return e !== undefined && e.preenchida && e.tamanho < minimo;
    })
    .map(([nome]) => nome);
  return { texto: resultado.texto, geradas: resultado.geradas, mantidas: resultado.mantidas, curtas };
}

/**
 * Executa a geracao em um arquivo. Prova de nao regeneracao: o hash de cada valor preexistente
 * precisa ser igual antes e depois; se mudar, nada e gravado.
 */
export function executar({ caminho, grupo = 'rotas-minimas', gerar, gerarB64 } = {}) {
  const texto = lerArquivo(caminho);
  if (texto === null) {
    return {
      codigo: 2,
      linhas: ['arquivo .env.local nao existe: crie a partir de .env.example (somente nomes) e rode de novo.'],
    };
  }
  if (GRUPOS[grupo] === undefined) {
    return { codigo: 2, linhas: [`grupo desconhecido: ${grupo}`] };
  }
  const antes = lerEstado(texto);
  const plano = planejar(texto, grupo, gerar, gerarB64);
  const depois = lerEstado(plano.texto);
  const alterados = [...antes]
    .filter(([nome, e]) => e.preenchida && depois.get(nome)?.hash !== e.hash)
    .map(([nome]) => nome);
  if (alterados.length > 0) {
    return { codigo: 1, linhas: [`ERRO: valor preexistente alterado (${alterados.join(', ')}); nada foi gravado.`] };
  }
  if (plano.geradas.length > 0) gravarAtomico(caminho, plano.texto);
  const preexistentes = [...antes.values()].filter((e) => e.preenchida).length;
  const linhas = [
    `geradas: ${plano.geradas.length}${plano.geradas.length > 0 ? ` (${plano.geradas.join(', ')})` : ''}`,
    `mantidas: ${plano.mantidas.length}`,
    `preexistentes sem alteracao (hash conferido): ${preexistentes}`,
    `curtas: ${plano.curtas.length > 0 ? `[${plano.curtas.join(', ')}]` : 'nenhuma'}`,
  ];
  return { codigo: 0, linhas, geradas: plano.geradas, curtas: plano.curtas };
}

function main() {
  const idx = process.argv.indexOf('--grupo');
  const grupo = idx >= 0 ? (process.argv[idx + 1] ?? '') : 'rotas-minimas';
  const caminho = fileURLToPath(new URL('../.env.local', import.meta.url));
  const r = executar({ caminho, grupo });
  for (const linha of r.linhas) console.log(linha);
  process.exitCode = r.codigo;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
