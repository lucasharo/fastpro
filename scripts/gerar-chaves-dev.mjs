// Gerador de chaves DEV (Issue #156, desenho 177 §4 e §5). Preenche somente nomes ausentes ou vazios do grupo
// pedido, no .env.local. Nunca sobrescreve valor preenchido, nunca imprime valor, tamanho ou prefixo.
// Uso: corepack pnpm dev:chaves [--grupo rotas-minimas]
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aplicarPreenchimentos, gravarAtomico, lerArquivo, lerEstado } from './lib/env-local.mjs';

export const BYTES_CHAVE = 32;

/** Grupos de geracao. So "rotas-minimas" existe nesta fatia (pedido 972a); os outros nascem com a Issue que os usar. */
export const GRUPOS = {
  'rotas-minimas': {
    aleatorias: [
      'PEPPER_EMAIL_HMAC',
      'PEPPER_CODE_HMAC',
      'PEPPER_IP_HMAC',
      'SESSION_COOKIE_SECRET',
      'JOBS_TICK_SECRET',
    ],
    literais: [
      ['APP_ENV', 'local'],
      ['APP_BASE_URL', 'http://127.0.0.1:3000'],
    ],
    minimos: { CATALOG_RATE_HMAC_KEY: 32 },
  },
};

const gerarHex = () => randomBytes(BYTES_CHAVE).toString('hex');

/** Calcula o novo texto sem gravar. gerar e injetavel para teste. */
export function planejar(texto, grupo, gerar = gerarHex) {
  const def = GRUPOS[grupo];
  if (def === undefined) throw new Error(`grupo desconhecido: ${grupo}`);
  const entradas = [...def.aleatorias.map((nome) => [nome, gerar()]), ...def.literais];
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
export function executar({ caminho, grupo = 'rotas-minimas', gerar } = {}) {
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
  const plano = planejar(texto, grupo, gerar);
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
