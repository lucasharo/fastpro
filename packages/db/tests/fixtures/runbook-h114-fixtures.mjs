// Fixtures sinteticas do runbook de incidente (H-114, Issue #123; desenho 165 §5).
// Todos os valores sao falsos: dominio .invalid (reservado), documentos e telefones inventados.
// Cada dado leva o marcador [TESTE-H114]. Nenhum dado real.
import { MARCADOR_TESTE } from '../../scripts/lib/runbook-h114.mjs';

/** Dados pessoais falsos que nunca podem sair em claro em nenhuma saida do runbook. */
export const PII_SINTETICA = Object.freeze({
  email: 'teste.h114@exemplo.invalid',
  telefone: '+55 (11) 91234-5678',
  cpf: '123.456.789-09',
  cnpj: '12.345.678/0001-95',
});

/** Relatorio de incidente sintetico (D-09) com PII em campos de valor e em texto livre. */
export const RELATORIO_INCIDENTE_SINTETICO = Object.freeze({
  titulo: `${MARCADOR_TESTE} exposicao simulada de telefone`,
  instanteUtc: '2026-11-20T12:00:00.000Z',
  rotaOuVetor: '/rota-de-teste/h114',
  contagemTitulares: 2,
  classesDeDado: ['telefone', 'e-mail'],
  medidas: ['chave de degradacao gravada'],
  statusContencao: 'contido',
  contato: PII_SINTETICA.email,
  descricao: `Cliente ${PII_SINTETICA.email} informou ${PII_SINTETICA.telefone} em texto livre.`,
  responsavel: { nome: `${MARCADOR_TESTE} operador`, cpf: PII_SINTETICA.cpf },
});

/** Achados de R-MP sinteticos (desenho §4.6): identificadores externos e valores com PII. */
export const ACHADOS_RMP_SINTETICOS = Object.freeze([
  {
    type: 'T1_faltando_local',
    externalIdMasked: '***0001',
    expected: 1000,
    found: null,
    severity: 'alta',
    observacao: `pagador ${PII_SINTETICA.email}`,
  },
  {
    type: 'T3_valor_divergente',
    externalIdMasked: '***0002',
    expected: 2000,
    found: 1900,
    severity: 'media',
    contato: PII_SINTETICA.telefone,
  },
]);
