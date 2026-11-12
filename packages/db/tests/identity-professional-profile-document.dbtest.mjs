// H-035 | Cenarios de banco da protecao do documento (decisao 54; desenho 75 §2, §5; CA-05, CA-06, CA-11).
// DESCRITOS, NAO EXECUTADOS: a migracao 20261111420000 ainda nao foi aplicada e o banco de desenvolvimento
// nao e usado nesta etapa. Todos os testes estao com skip; ao rodar db:test com o banco pronto, trocar o skip
// pela execucao (papel app_system, perfis sinteticos, sem numero real de documento).
import { describe, test } from 'node:test';

const MOTIVO = 'migracao 20261111420000 nao aplicada (decisao 54); rodar so com banco de desenvolvimento';

describe('H-035 banco: app_system nao promove status (decisao 54, item 2)', () => {
  test('update de verification_status para aprovada e recusado com 42501 (professional_status_protegido)', { skip: MOTIVO }, () => {});
  test('update de verification_status para em_revisao e suspensa com 42501', { skip: MOTIVO }, () => {});
  test('primeiro cadastro: pendente -> retida_duplicidade so com document_hmac na mesma atualizacao', { skip: MOTIVO }, () => {});
  test('retida_duplicidade -> pendente ou aprovada e recusado com 42501', { skip: MOTIVO }, () => {});
});

describe('H-035 banco: documento gravado e write-once (decisao 54, item 2)', () => {
  test('update de document_hmac, document_enc, document_type, public_name ou slug apos gravado: 42501 (professional_documento_imutavel)', { skip: MOTIVO }, () => {});
  test('update de updated_at e permitido sem mudar o documento', { skip: MOTIVO }, () => {});
  test('update de user_id e created_at e negado ao papel app_system (grant por coluna)', { skip: MOTIVO }, () => {});
});

describe('H-035 banco: funcao de gravacao (desenho §2 item 4; CA-05, CA-11)', () => {
  test('primeiro envio grava pendente e devolve pendente', { skip: MOTIVO }, () => {});
  test('outro perfil nao recusado com o mesmo HMAC: devolve retida_duplicidade', { skip: MOTIVO }, () => {});
  test('perfil recusado com o mesmo HMAC nao conta: devolve pendente (CA-06)', { skip: MOTIVO }, () => {});
  test('segundo envio do mesmo perfil devolve ja_cadastrado e nao reescreve o documento (CA-11)', { skip: MOTIVO }, () => {});
  test('corrida de dois envios com o mesmo HMAC: 23505 do indice de HMAC vira retida_duplicidade', { skip: MOTIVO }, () => {});
  test('colisao de slug re-lanca o erro (quem chama acrescenta sufixo)', { skip: MOTIVO }, () => {});
  test('sem linha de perfil devolve sem_perfil', { skip: MOTIVO }, () => {});
  test('a funcao nao e security definer (pg_proc.prosecdef = false) e so app_system executa', { skip: MOTIVO }, () => {});
});
