// H-120 (Issue 129) | Varredura T-11 (CA-01) sobre o conjunto de demonstracao gerado em memoria.
// Sem banco e sem rede. Regras (18-PLANO-QA T-11, 85-DESENHO-H120 §5):
//  - e-mail: so e aceito o dominio .test (dominio reservado, nunca entrega);
//  - CPF e CNPJ: so sao aceitos os CPFs EXATOS listados em excecoesCpfDemo() (84 §8 D4). O padrao
//    nao e liberado em geral: qualquer outro CPF/CNPJ de formato valido e achado;
//  - telefone: nenhuma excecao. A demo nao grava telefone (desvio em 85-DESENHO-H120 §7).
// Achados trazem so tipo e origem, nunca o valor encontrado (nao vaza dado para logs).
import { CLIENTES, COORDENADA, PROFISSIONAIS, demoCpfDigits } from './demo-ids.mjs';
import { FOTOS, MENSAGENS, TEXTOS_CAMADA2 } from './demo-layer2.mjs';

export const DOMINIO_TESTE = '.test';

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
// Telefone brasileiro: DDD (com ou sem parenteses), celular opcional com 9, +55 opcional.
const RE_TELEFONE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]?\d{4}\b/g;

const digitos = (s) => s.replace(/\D/g, '');

/**
 * Excecoes de CPF de demo (84 §8 D4): lista EXATA dos CPFs gerados pela carga (digitos).
 * Nao libera o formato de CPF em geral.
 */
export function excecoesCpfDemo() {
  return new Set(PROFISSIONAIS.map((p) => demoCpfDigits(p.n)));
}

/** Excecoes de telefone de demo: nenhuma (a demo nao grava telefone). */
export const EXCECOES_TELEFONE_DEMO = Object.freeze(new Set());

/**
 * Textos gerados pela carga, em memoria: e-mails, nomes, enderecos, mensagens, caminhos de foto e os
 * documentos de demo (em digitos e formatados). Nao inclui identificadores (uuid), que sao hexadecimais.
 */
export function conjuntoDemoEmMemoria() {
  const itens = [];
  const add = (origem, texto) => {
    if (texto !== undefined && texto !== null) itens.push({ origem, texto: String(texto) });
  };
  for (const c of CLIENTES) add(`cliente ${c.n}: e-mail`, c.email);
  for (const p of PROFISSIONAIS) {
    add(`profissional ${p.n}: e-mail`, p.email);
    add(`profissional ${p.n}: nome publico`, p.publicName);
    add(`profissional ${p.n}: slug`, p.slug);
    const doc = demoCpfDigits(p.n);
    add(`profissional ${p.n}: documento`, doc);
    add(`profissional ${p.n}: documento formatado`, `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`);
  }
  add('endereco de demo', COORDENADA.endereco);
  add('endereco normalizado', COORDENADA.enderecoNormalizado);
  for (const v of Object.values(TEXTOS_CAMADA2)) add('texto fixo da camada 2', v);
  for (const m of MENSAGENS) if (m.texto) add(`mensagem ${m.tipo}`, m.texto);
  for (const f of FOTOS) add(`foto ${f.n}: caminho`, f.objectKey);
  return itens;
}

/**
 * Varre os textos. Devolve a lista de achados { tipo, origem }. Lista vazia = conjunto limpo.
 * excecoesCpf: Set de CPFs (digitos) liberados; excecoesTelefone: Set de telefones (digitos) liberados.
 */
export function varrerTextos(
  itens,
  { excecoesCpf = excecoesCpfDemo(), excecoesTelefone = EXCECOES_TELEFONE_DEMO } = {},
) {
  const achados = [];
  for (const { origem, texto } of itens) {
    for (const m of texto.matchAll(RE_EMAIL)) {
      const dominio = m[0].split('@')[1].toLowerCase();
      if (!dominio.endsWith(DOMINIO_TESTE)) achados.push({ tipo: 'e-mail fora de .test', origem });
    }
    // CPF: excecoes saem do texto antes da varredura de telefone (um CPF de 11 digitos casa com o padrao de telefone).
    const semCpf = texto.replace(RE_CPF, (m) => {
      if (!excecoesCpf.has(digitos(m))) achados.push({ tipo: 'CPF fora da lista de demo', origem });
      return ' ';
    });
    const semCnpj = semCpf.replace(RE_CNPJ, () => {
      achados.push({ tipo: 'CNPJ', origem });
      return ' ';
    });
    for (const m of semCnpj.matchAll(RE_TELEFONE)) {
      if (!excecoesTelefone.has(digitos(m[0]))) achados.push({ tipo: 'telefone', origem });
    }
  }
  return achados;
}
