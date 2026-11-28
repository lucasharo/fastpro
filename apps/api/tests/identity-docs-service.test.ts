// H-037 (Issue #50) | Servico dos documentos de identidade com fakes (107 §6; CA-01..CA-14, CA-17, CA-18 da logica).
// As provas de banco e de Storage real estao em identity-docs-fluxo.test.ts (adaptadores) e no dbtest.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  IDOC_CAP_RETRY_S,
  IDOC_NAO_ENCONTRADO,
  emitirDocumento,
  excluirDocumento,
  finalizarDocumento,
  listarDocumentos,
  type IdentityDocServiceDeps,
} from '../src/identity-docs/identity-doc-service.js';
import { sweepIdentityDocs } from '../src/identity-docs/identity-doc-sweep.js';
import { identityDocFinalKey, identityDocIncomingKey, IDOC_IMAGE_MAX_BYTES, IDOC_PDF_MAX_BYTES, IDOC_RATE_EMISSAO_IP_HORA, IDOC_RATE_EMISSAO_PROFISSIONAL_HORA } from '@fastpro/domain';
import {
  FakeReducer,
  JPEG_FAKE,
  MIN,
  MemFinal,
  MemGate,
  MemRate,
  MemStaging,
  MemStore,
  PDF_VALIDO,
  Relogio,
  T0,
  UUID_A,
  UUID_B,
} from './identity-docs-fakes.js';

const USUARIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const OUTRO = 'bbbbbbbb-0000-4000-8000-000000000002';
const IP = '203.0.113.9';
const CUID = '11111111-1111-4111-8111-111111111111';

function arranjo(): {
  deps: IdentityDocServiceDeps;
  relogio: Relogio;
  store: MemStore;
  staging: MemStaging;
  final: MemFinal;
  reducer: FakeReducer;
  gate: MemGate;
  rate: MemRate;
} {
  const relogio = new Relogio(T0);
  const store = new MemStore();
  store.emailVerificado.add(USUARIO);
  store.emailVerificado.add(OUTRO);
  const staging = new MemStaging(relogio);
  const final = new MemFinal();
  const reducer = new FakeReducer();
  const gate = new MemGate();
  const rate = new MemRate();
  const deps: IdentityDocServiceDeps = {
    store,
    staging,
    final,
    reducer,
    gate,
    rate,
    ipHmac: (ip) => `hmac:${ip}`,
    clock: relogio,
  };
  return { deps, relogio, store, staging, final, reducer, gate, rate };
}

async function emitir(deps: IdentityDocServiceDeps, userId: string, tipo: 'image/jpeg' | 'application/pdf', bytes: number, cuid = CUID) {
  return emitirDocumento(
    { userId, ip: IP, corpo: { clientUploadId: cuid, contentType: tipo, sizeBytes: bytes } },
    deps,
  );
}

/** Emite e simula o PUT do navegador com os bytes; devolve o id. */
async function enviarArquivo(a: ReturnType<typeof arranjo>, bytes: Uint8Array, tipo: 'image/jpeg' | 'application/pdf', cuid = CUID): Promise<string> {
  // A emissao declara no maximo o limite do tipo: o excedente real so aparece na finalizacao (B1, CA-03).
  const declarado = Math.min(bytes.length, tipo === 'application/pdf' ? IDOC_PDF_MAX_BYTES : IDOC_IMAGE_MAX_BYTES);
  const r = await emitir(a.deps, USUARIO, tipo, declarado, cuid);
  const id = (r.corpo as { id: string }).id;
  a.staging.enviarEntrada(identityDocIncomingKey(id), bytes);
  return id;
}

describe('H-037 | emissao (CA-05, CA-09, CA-13, RN-13, RN-15)', () => {
  it('reserva a vaga e devolve URL de envio de uso unico (201), sem alterar o perfil', async () => {
    const a = arranjo();
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 4 * 1024 * 1024);
    expect(r.status).toBe(201);
    const corpo = r.corpo as { id: string; status: string; upload_url: string; upload_expires_at: string };
    expect(corpo.status).toBe('em_envio');
    expect(corpo.upload_url).toContain(identityDocIncomingKey(corpo.id));
    expect(Date.parse(corpo.upload_expires_at)).toBe(T0 + 900_000);
    expect(a.store.linhas.size).toBe(1);
  });

  it('repetir o mesmo client_upload_id devolve a mesma vaga (200), sem contar cota de novo', async () => {
    const a = arranjo();
    const primeiro = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    const repeticao = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    expect(repeticao.status).toBe(200);
    expect((repeticao.corpo as { id: string }).id).toBe((primeiro.corpo as { id: string }).id);
    expect(a.store.linhas.size).toBe(1);
  });

  it('e-mail nao verificado: 403 sem gravar nada (CA-12 da regra de e-mail, decisao 215)', async () => {
    const a = arranjo();
    a.store.emailVerificado.delete(USUARIO);
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    expect(r).toEqual({ status: 403, corpo: { code: 'email_nao_verificado' } });
    expect(a.store.linhas.size).toBe(0);
  });

  it('estado do perfil que nao aceita envio: 403 estado_perfil, sem alterar nada (CA-13)', async () => {
    const a = arranjo();
    a.store.estadoProibido.add(USUARIO);
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    expect(r).toEqual({ status: 403, corpo: { code: 'estado_perfil' } });
    expect(a.store.linhas.size).toBe(0);
  });

  it('sexto documento vivo: 422 limite_documentos e os cinco anteriores intactos (CA-05)', async () => {
    const a = arranjo();
    for (let i = 1; i <= 5; i++) {
      const cuid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuid);
      expect(r.status).toBe(201);
    }
    const sexto = await emitir(a.deps, USUARIO, 'image/jpeg', 100, '22222222-2222-4222-8222-222222222222');
    expect(sexto).toEqual({ status: 422, corpo: { code: 'limite_documentos' } });
    expect(a.store.linhas.size).toBe(5);
  });

  it('teto global atingido: 429 com Retry-After fixo e sem revelar o teto (RN-15, decisao 220)', async () => {
    const a = arranjo();
    a.deps.globalBytesCap = 1;
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    expect(r.status).toBe(429);
    expect(r.retryAfterS).toBe(IDOC_CAP_RETRY_S);
    expect(JSON.stringify(r.corpo)).not.toMatch(/250|cap|teto/i);
  });

  it('cota por profissional barra antes do banco e nao conta quando recusa (RN-13)', async () => {
    const a = arranjo();
    a.rate.limites.set(IDOC_RATE_EMISSAO_PROFISSIONAL_HORA.id, 0);
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    expect(r).toEqual({ status: 429, corpo: { code: 'muitas_tentativas' }, retryAfterS: 300 });
    expect(a.store.chamadas).not.toContain('issue');
  });
});

describe('H-037 | finalizacao: imagem (CA-01, CA-06 da entrega) e PDF (CA-02, CA-17)', () => {
  it('imagem: o redutor recebe os bytes, o final guarda so a versao reduzida e a entrada sai (CA-01)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(4 * 1024 * 1024), 'image/jpeg');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 200, corpo: { id, status: 'recebido', kind: 'imagem' } });
    expect(a.reducer.recebidos).toHaveLength(1);
    expect(a.final.arquivos.get(id)).toEqual(a.reducer.saidaPadrao);
    expect(a.staging.entrada.has(identityDocIncomingKey(id))).toBe(false);
    const linha = a.store.linhas.get(id);
    expect(linha?.status).toBe('recebido');
    expect(linha?.storedType).toBe('image/jpeg');
  });

  it('PDF de exatamente 2 MiB: gravado byte a byte, mesmo tamanho e mesmo SHA-256 (CA-02, CA-17)', async () => {
    const a = arranjo();
    const pdf = PDF_VALIDO(IDOC_PDF_MAX_BYTES);
    const id = await enviarArquivo(a, pdf, 'application/pdf');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r.status).toBe(200);
    expect(a.reducer.recebidos).toHaveLength(0);
    const gravado = a.final.arquivos.get(id);
    expect(gravado).toBeDefined();
    expect(Buffer.from(gravado ?? []).equals(Buffer.from(pdf))).toBe(true);
    const sha = createHash('sha256').update(pdf).digest('hex');
    expect(createHash('sha256').update(gravado ?? []).digest('hex')).toBe(sha);
    expect(Buffer.from(a.store.shas.get(id) ?? []).toString('hex')).toBe(sha);
    expect((r.corpo as { kind: string }).kind).toBe('pdf');
  });

  it('PDF de 2 MiB + 1 byte enviado como PDF: 413 na finalizacao, nada no final, linha fora dos vivos (CA-03)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, PDF_VALIDO(IDOC_PDF_MAX_BYTES + 1), 'application/pdf');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 413, corpo: { code: 'arquivo_grande' } });
    expect(a.final.arquivos.size).toBe(0);
    expect(a.store.linhas.get(id)?.purge).toBe(true);
  });

  it('imagem declarada, mas com PDF real de 3 MiB dentro do limite de imagem: 413 pelo limite do tipo detectado (B1)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, PDF_VALIDO(3 * 1024 * 1024), 'image/jpeg');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 413, corpo: { code: 'arquivo_grande' } });
    expect(a.final.arquivos.size).toBe(0);
  });

  it('tipos recusados por conteudo (GIF, texto, PDF sem estrutura): 415 e 422, sem objeto final (CA-04)', async () => {
    const gif = new TextEncoder().encode('GIF89a' + 'x'.repeat(40));
    const texto = new TextEncoder().encode('isto e so texto, nao imagem');
    const pdfFalso = new TextEncoder().encode('%PDF-1.7 sem fim de arquivo');
    const casos: [Uint8Array, number, string][] = [
      [gif, 415, 'tipo_nao_aceito'],
      [texto, 415, 'tipo_nao_aceito'],
      [pdfFalso, 422, 'pdf_invalido'],
    ];
    for (const [bytes, status, code] of casos) {
      const a = arranjo();
      const id = await enviarArquivo(a, bytes, 'image/jpeg');
      const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
      expect(r).toEqual({ status, corpo: { code } });
      expect(a.final.arquivos.size).toBe(0);
      expect(a.staging.entrada.has(identityDocIncomingKey(id))).toBe(false);
    }
  });

  it('PDF com senha ou acao embutida: 422 com o codigo fixo, nada gravado (Q-H037-7 e Q-H037-8)', async () => {
    const a = arranjo();
    const comSenha = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF\n');
    const id = await enviarArquivo(a, comSenha, 'application/pdf');
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 422, corpo: { code: 'pdf_protegido' } });
    expect(a.final.arquivos.size).toBe(0);
  });

  it('imagem acima de 5 MiB na entrada: 413 antes de ler, sem objeto final (B5)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(IDOC_IMAGE_MAX_BYTES + 1), 'image/jpeg');
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 413, corpo: { code: 'arquivo_grande' } });
    expect(a.reducer.recebidos).toHaveLength(0);
  });

  it('objeto ausente na entrada: 409 upload_nao_encontrado e a tentativa conta', async () => {
    const a = arranjo();
    const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100);
    const id = (r.corpo as { id: string }).id;
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 409, corpo: { code: 'upload_nao_encontrado' } });
    expect(a.store.linhas.get(id)?.attempts).toBe(1);
  });

  it('sem vaga de reducao: 503, a tentativa nao conta e o documento segue pendente', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.gate.livre = false;
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 503, corpo: { code: 'servico_indisponivel' } });
    expect(a.store.linhas.get(id)?.attempts).toBe(0);
    expect(a.store.linhas.get(id)?.status).toBe('pendente_envio');
  });

  it('falha transitoria do redutor: 503 e a tentativa conta (decisoes 84 a 86)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.reducer.resultado = { ok: false, kind: 'transient', cause: 'timeout' };
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 503, corpo: { code: 'servico_indisponivel' } });
    expect(a.store.linhas.get(id)?.attempts).toBe(1);
    expect(a.final.arquivos.size).toBe(0);
  });

  it('corrida com a exclusao (linha some antes de confirmar): remove o final gravado e responde 404 uniforme', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.store.confirmDone = async () => {
      a.store.linhas.delete(id);
      return 'gone';
    };
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual(IDOC_NAO_ENCONTRADO);
    expect(a.final.arquivos.has(id)).toBe(false);
  });

  it('corrida com a exclusao e falha ao remover o final: ainda 404 uniforme, sem lancar nem vazar o erro', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.final.falhas.add('removeFinal');
    a.store.confirmDone = async () => {
      a.store.linhas.delete(id);
      return 'gone';
    };
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual(IDOC_NAO_ENCONTRADO);
  });

  it('imagem que nao cabe no limite: 422 nao_cabe_no_limite, sem objeto final', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.reducer.resultado = { ok: false, kind: 'definitive', code: 'nao_cabe_no_limite' };
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 422, corpo: { code: 'nao_cabe_no_limite' } });
    expect(a.final.arquivos.size).toBe(0);
  });

  it('repetir depois de recebido: 200 idempotente, sem reler o Storage (6.1, passo 9)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    const reler = a.reducer.recebidos.length;
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 200, corpo: { id, status: 'recebido', kind: 'imagem' } });
    expect(a.reducer.recebidos.length).toBe(reler);
  });

  it('id de outro profissional: 404 com o mesmo corpo do id inexistente (CA-12)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    const alheio = await finalizarDocumento({ userId: OUTRO, id }, a.deps);
    const inexistente = await finalizarDocumento({ userId: OUTRO, id: UUID_B }, a.deps);
    expect(alheio).toEqual(IDOC_NAO_ENCONTRADO);
    expect(inexistente).toEqual(IDOC_NAO_ENCONTRADO);
    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
  });

  it('tentativa com lease viva: 409 em_processamento; vencida: 409 upload_expirado (CA-11)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    const linha = a.store.linhas.get(id);
    if (linha !== undefined) linha.leaseUntil = T0 + 30_000;
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 409, corpo: { code: 'em_processamento' } });
    a.relogio.t = T0 + 31 * MIN;
    expect(await finalizarDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 409, corpo: { code: 'upload_expirado' } });
  });

  it('falha de gravacao no final: 503 fixo, sem eco da mensagem e sem recebido (CA-10)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.final.falhas.add('put');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 503, corpo: { code: 'servico_indisponivel' } });
    expect(JSON.stringify(r)).not.toMatch(/quebrou|SENTINELA/);
    expect(a.store.linhas.get(id)?.status).toBe('pendente_envio');
  });
});

describe('H-037 | listagem, exclusao e varredura (CA-06, CA-10, CA-11, T-24)', () => {
  it('lista do dono traz so id, tipo, estado, data e se pode excluir; nunca caminho, tamanho ou nome', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    const r = await listarDocumentos({ userId: USUARIO, ip: IP }, a.deps);
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.corpo);
    expect(texto).toContain(id);
    expect(texto).not.toMatch(/storage|bucket|identity-docs|i\/|s\/|bytes|size|mime|content-type/i);
    expect((r.corpo as { slotsRemaining: number }).slotsRemaining).toBe(4);
  });

  it('excluir enquanto nao analisado: 204, remove entrada e final e sai do banco (decisao 180)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    const r = await excluirDocumento({ userId: USUARIO, id }, a.deps);
    expect(r).toEqual({ status: 204 });
    expect(a.final.arquivos.has(id)).toBe(false);
    expect(a.store.linhas.has(id)).toBe(false);
  });

  it('documento ja analisado: 409 ja_analisado e o arquivo fica (retencao e L1)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    const linha = a.store.linhas.get(id);
    if (linha !== undefined) linha.analyzedAt = T0;
    expect(await excluirDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 409, corpo: { code: 'ja_analisado' } });
    expect(a.final.arquivos.has(id)).toBe(true);
  });

  it('falha de Storage na exclusao: 503 e a linha continua marcada para a proxima varredura', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    a.final.falhas.add('removeFinal');
    expect(await excluirDocumento({ userId: USUARIO, id }, a.deps)).toEqual({ status: 503, corpo: { code: 'servico_indisponivel' } });
    expect(a.store.linhas.get(id)?.purge).toBe(true);
  });

  it('varredura: marca pendente vencido, remove o objeto de entrada e purga a linha (CA-11)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.relogio.t = T0 + 31 * MIN;
    const r = await sweepIdentityDocs({ store: a.store, staging: a.staging, final: a.final, clock: a.relogio });
    expect(r.marcados).toBe(1);
    expect(r.purgados).toBe(1);
    expect(a.store.linhas.has(id)).toBe(false);
    expect(a.staging.entrada.has(identityDocIncomingKey(id))).toBe(false);
  });

  it('varredura de orfaos: objeto de entrada com mais de 3 h e sem linha conhecida sai; com linha viva, fica (CA-11)', async () => {
    const a = arranjo();
    const orfao = '99999999-9999-4999-8999-999999999999';
    a.staging.enviarEntrada(identityDocIncomingKey(orfao), JPEG_FAKE(10));
    // Vivo recente: emitido em T0+225 min, so expira depois de T0+240 min; o orfao tem 240 min de idade.
    a.relogio.t = T0 + 225 * MIN;
    const viva = await enviarArquivo(a, JPEG_FAKE(10), 'image/jpeg', '33333333-3333-4333-8333-333333333333');
    a.relogio.t = T0 + 240 * MIN;
    const r = await sweepIdentityDocs({ store: a.store, staging: a.staging, final: a.final, clock: a.relogio });
    expect(r.orfaos).toBe(1);
    expect(a.staging.entrada.has(identityDocIncomingKey(orfao))).toBe(false);
    expect(a.staging.entrada.has(identityDocIncomingKey(viva))).toBe(true);
  });

  it('falha de Storage na varredura: conta a falha e deixa a linha para repetir (CA-11)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(10), 'image/jpeg');
    a.relogio.t = T0 + 31 * MIN;
    a.staging.falhas.add('remove');
    const r = await sweepIdentityDocs({ store: a.store, staging: a.staging, final: a.final, clock: a.relogio });
    expect(r.falhas).toBeGreaterThan(0);
    expect(a.store.linhas.get(id)?.purge).toBe(true);
    expect(r.purgados).toBe(0);
  });

  it('sentinelas (nome, GPS e IP) nunca saem na resposta quando o Storage falha (CA-10)', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    a.staging.falhas.add('read');
    const r = await finalizarDocumento({ userId: USUARIO, id }, a.deps);
    expect(JSON.stringify(r)).not.toMatch(/rg-frente|GPS|203\.0\.113|SENTINELA/);
  });

  it('id de entrada fora do formato uuid nao chega a gerar chave (guard de dominio)', () => {
    expect(() => identityDocIncomingKey('../../etc')).toThrow();
    expect(identityDocFinalKey(UUID_A)).toBe(`i/${UUID_A}`);
  });
});

// T-05, T-20 e T-24 com fakes (sem banco). A contagem e a reserva seguem o MemStore (espelho de private.idoc_*).
// A "concorrencia" aqui e a intercalacao do Promise.all; a atomicidade real (linha, gatilho, lock) fica no dbtest.
function cuidDe(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function descartar(a: ReturnType<typeof arranjo>, id: string): void {
  const linha = a.store.linhas.get(id);
  if (linha !== undefined) linha.purge = true;
}

describe('H-037 | T-05: limite de cinco vivos (fakes)', () => {
  it('substituido e marcado para expurgo nao contam: a quinta vida passa e a sexta barra (CA-05)', async () => {
    const a = arranjo();
    for (let n = 1; n <= 4; n++) expect((await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(n))).status).toBe(201);
    const expurgo = (await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(5))).corpo as { id: string };
    descartar(a, expurgo.id);
    const substituido = (await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(6))).corpo as { id: string };
    const linhaSubstituida = a.store.linhas.get(substituido.id);
    if (linhaSubstituida !== undefined) linhaSubstituida.status = 'substituido';
    expect((await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(7))).status).toBe(201);
    expect(await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(8))).toEqual({ status: 422, corpo: { code: 'limite_documentos' } });
    expect(a.store.linhas.size).toBe(7);
  });

  it('duas emissoes concorrentes com quatro vivos: exatamente uma passa e ficam cinco', async () => {
    const a = arranjo();
    for (let n = 1; n <= 4; n++) await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(n));
    const [r1, r2] = await Promise.all([
      emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(10)),
      emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(11)),
    ]);
    expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([201, 422]);
    expect(a.store.linhas.size).toBe(5);
  });
});

describe('H-037 | T-20: cotas de emissao (fakes)', () => {
  it('13a emissao na hora por profissional: 429 com Retry-After; as consultas nao contam (RN-13)', async () => {
    const a = arranjo();
    a.rate.limites.set(IDOC_RATE_EMISSAO_PROFISSIONAL_HORA.id, IDOC_RATE_EMISSAO_PROFISSIONAL_HORA.limit);
    for (let n = 1; n <= 20; n++) await listarDocumentos({ userId: USUARIO, ip: IP }, a.deps);
    for (let n = 1; n <= 12; n++) {
      const r = await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(n));
      expect(r.status).toBe(201);
      descartar(a, (r.corpo as { id: string }).id);
    }
    const treze = await emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(13));
    expect(treze.status).toBe(429);
    expect(treze.retryAfterS).toBeGreaterThan(0);
    expect(treze.corpo).toEqual({ code: 'muitas_tentativas' });
  });

  it('41a emissao por IP-HMAC na hora: 429 com Retry-After e corpo sem o numero do limite (RN-13)', async () => {
    const a = arranjo();
    a.rate.limites.set(IDOC_RATE_EMISSAO_IP_HORA.id, IDOC_RATE_EMISSAO_IP_HORA.limit);
    const dono = (n: number): string => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let n = 1; n <= 41; n++) a.store.emailVerificado.add(dono(n));
    for (let n = 1; n <= 40; n++) expect((await emitir(a.deps, dono(n), 'image/jpeg', 100, cuidDe(n))).status).toBe(201);
    const quarentaEUm = await emitir(a.deps, dono(41), 'image/jpeg', 100, cuidDe(41));
    expect(quarentaEUm.status).toBe(429);
    expect(quarentaEUm.retryAfterS).toBeGreaterThan(0);
    expect(JSON.stringify(quarentaEUm.corpo)).not.toMatch(/40|limite/i);
  });

  it('corrida de duas emissoes no limite do teto global: no maximo uma passa (RN-15)', async () => {
    const a = arranjo();
    a.deps.globalBytesCap = 2_097_152;
    const [r1, r2] = await Promise.all([
      emitir(a.deps, USUARIO, 'image/jpeg', 100, cuidDe(1)),
      emitir(a.deps, OUTRO, 'image/jpeg', 100, cuidDe(2)),
    ]);
    expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([201, 429]);
    const barrada = r1.status === 429 ? r1 : r2;
    expect(barrada.retryAfterS).toBe(IDOC_CAP_RETRY_S);
  });
});

describe('H-037 | T-24: finalizacao concorrente (fakes)', () => {
  it('duas finalizacoes simultaneas: uma processa e a outra 409 em_processamento; o redutor roda uma vez', async () => {
    const a = arranjo();
    const id = await enviarArquivo(a, JPEG_FAKE(1000), 'image/jpeg');
    const [r1, r2] = await Promise.all([
      finalizarDocumento({ userId: USUARIO, id }, a.deps),
      finalizarDocumento({ userId: USUARIO, id }, a.deps),
    ]);
    expect([r1, r2]).toContainEqual({ status: 200, corpo: { id, status: 'recebido', kind: 'imagem' } });
    expect([r1, r2]).toContainEqual({ status: 409, corpo: { code: 'em_processamento' } });
    expect(a.reducer.recebidos).toHaveLength(1);
  });
});
