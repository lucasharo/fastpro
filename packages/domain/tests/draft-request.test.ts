// H-025 | Regras do rascunho sem conta (docs/factory/74-DESENHO-H025.md §1, §2, §4; D-01, D-02, D-03,
// D-05, D-09; CA-01, CA-02, CA-03, CA-04 da H-030 fora daqui; so o calculo de campos faltantes).
import { describe, expect, it } from 'vitest';
import {
  DRAFT_ADDRESS_MAX,
  DRAFT_BODY_LIMIT_BYTES,
  DRAFT_CLEAR_COOKIE_HEADER,
  DRAFT_COOKIE_NAME,
  DRAFT_DESCRIPTION_MAX,
  DRAFT_CAP_RETRY_S,
  DRAFT_LIVE_CAP_DEFAULT,
  DRAFT_LIVE_STATUSES,
  DRAFT_RATE_LEITURA_IP,
  DRAFT_NOT_FOUND_BODY,
  DRAFT_RATE_CRIACAO_DIA,
  DRAFT_RATE_CRIACAO_HORA,
  DRAFT_RATE_SALVAR_IP,
  DRAFT_RATE_SALVAR_RASCUNHO,
  DRAFT_STATUSES_WRITTEN_BY_H025,
  checkDraftJson,
  checkDraftOrigin,
  draftCookieHeader,
  draftMissingForReview,
  draftSecretFromCookie,
  parseDraftBody,
  toDraftView,
  type DraftRecord,
} from '../src/draft/index.js';

const UUID = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';
const SEGREDO = 'A'.repeat(43);

function corpo(obj: unknown): { text: string; bytes: number } {
  const text = JSON.stringify(obj);
  return { text, bytes: Buffer.byteLength(text, 'utf8') };
}

function parse(obj: unknown) {
  const c = corpo(obj);
  return parseDraftBody(c.text, c.bytes);
}

describe('D-09 corpo do rascunho: chaves permitidas e vazio', () => {
  it('aceita os quatro campos (CA-01, CA-03): serviço, local, urgência e descrição', () => {
    const r = parse({
      service_id: UUID,
      address_text: 'Rua Alfa, 10',
      urgency: 'imediato',
      description: 'Vazamento na pia',
    });
    expect(r).toEqual({
      ok: true,
      fields: {
        service_id: UUID,
        address_text: 'Rua Alfa, 10',
        urgency: 'imediato',
        description: 'Vazamento na pia',
      },
    });
  });

  it('chave extra e 422 campo_desconhecido, inclusive email, nome, status, id, lat e lon (D-05)', () => {
    for (const extra of ['email', 'first_name', 'phone', 'status', 'id', 'expires_at', 'lat', 'lon']) {
      const r = parse({ urgency: 'imediato', [extra]: 'x' });
      expect(r, extra).toEqual({ ok: false, status: 422, code: 'campo_desconhecido' });
    }
  });

  it('chave __proto__ e recusada como campo desconhecido', () => {
    const r = parseDraftBody('{"__proto__":{"x":1},"urgency":"imediato"}', 40);
    expect(r).toEqual({ ok: false, status: 422, code: 'campo_desconhecido' });
  });

  it('corpo sem nenhuma chave e 422 vazio (nao cria rascunho vazio)', () => {
    expect(parse({})).toEqual({ ok: false, status: 422, code: 'vazio' });
  });

  it('JSON invalido, lista ou texto nao-objeto: 422 corpo_invalido', () => {
    expect(parseDraftBody('{nao json', 9)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    expect(parseDraftBody('[1]', 3)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    expect(parseDraftBody('"x"', 3)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
    expect(parseDraftBody('null', 4)).toEqual({ ok: false, status: 422, code: 'corpo_invalido' });
  });

  it('null limpa service_id, address_text e description', () => {
    expect(parse({ service_id: null, address_text: null, description: null })).toEqual({
      ok: true,
      fields: { service_id: null, address_text: null, description: null },
    });
  });

  it('chave ausente nao aparece no resultado (salvamento parcial nao apaga o resto)', () => {
    const r = parse({ urgency: 'proximo_mes' });
    expect(r).toEqual({ ok: true, fields: { urgency: 'proximo_mes' } });
  });
});

describe('CA-02 urgencia exata', () => {
  it('aceita somente as quatro chaves', () => {
    for (const u of ['imediato', 'proximas_semanas', 'proximo_mes', 'nao_definido']) {
      expect(parse({ urgency: u })).toEqual({ ok: true, fields: { urgency: u } });
    }
  });

  it('qualquer outro valor (inclusive variantes e null) e 422 urgencia_invalida', () => {
    for (const u of ['Imediato', 'imediato ', 'agora', '', null, 1, ['imediato']]) {
      expect(parse({ urgency: u }), JSON.stringify(u)).toEqual({
        ok: false,
        status: 422,
        code: 'urgencia_invalida',
      });
    }
  });
});

describe('servico_invalido e formato do service_id', () => {
  it('uuid valido passa; texto qualquer e 422 servico_invalido', () => {
    expect(parse({ service_id: UUID })).toEqual({ ok: true, fields: { service_id: UUID } });
    for (const s of ['abc', 123, '', UUID.slice(0, 35)]) {
      expect(parse({ service_id: s }), String(s)).toEqual({
        ok: false,
        status: 422,
        code: 'servico_invalido',
      });
    }
  });
});

describe('endereco: 3 a 200 caracteres apos aparar, sem controle', () => {
  it('limites exatos', () => {
    expect(parse({ address_text: 'abc' })).toEqual({ ok: true, fields: { address_text: 'abc' } });
    expect(parse({ address_text: 'a'.repeat(DRAFT_ADDRESS_MAX) })).toMatchObject({ ok: true });
    expect(parse({ address_text: 'ab' })).toEqual({ ok: false, status: 422, code: 'endereco_invalido' });
    expect(parse({ address_text: 'a'.repeat(DRAFT_ADDRESS_MAX + 1) })).toEqual({
      ok: false,
      status: 422,
      code: 'endereco_invalido',
    });
  });

  it('apara espacos antes de contar', () => {
    expect(parse({ address_text: '   ab   ' })).toEqual({ ok: false, status: 422, code: 'endereco_invalido' });
    expect(parse({ address_text: '  abc  ' })).toEqual({ ok: true, fields: { address_text: 'abc' } });
  });

  it('caractere de controle no endereco e recusado', () => {
    expect(parse({ address_text: 'Rua\u0000Alfa' })).toEqual({
      ok: false,
      status: 422,
      code: 'endereco_invalido',
    });
  });
});

describe('descricao: ate 2000 caracteres, so quebra de linha como controle', () => {
  it('2000 aceita e 2001 e recusada (D-09)', () => {
    expect(parse({ description: 'x'.repeat(DRAFT_DESCRIPTION_MAX) })).toMatchObject({ ok: true });
    expect(parse({ description: 'x'.repeat(DRAFT_DESCRIPTION_MAX + 1) })).toEqual({
      ok: false,
      status: 422,
      code: 'descricao_invalida',
    });
  });

  it('conta caracteres, nao bytes (acentos e emoji)', () => {
    expect(parse({ description: 'é'.repeat(DRAFT_DESCRIPTION_MAX) })).toMatchObject({ ok: true });
    expect(parse({ description: '😀'.repeat(DRAFT_DESCRIPTION_MAX + 1) })).toMatchObject({
      ok: false,
      code: 'descricao_invalida',
    });
  });

  it('quebra de linha passa; \\0 e outro controle sao 422', () => {
    expect(parse({ description: 'linha 1\nlinha 2\r\nlinha 3' })).toMatchObject({ ok: true });
    expect(parse({ description: 'ruim\u0000' })).toEqual({ ok: false, status: 422, code: 'descricao_invalida' });
    expect(parse({ description: 'tab\taqui' })).toEqual({ ok: false, status: 422, code: 'descricao_invalida' });
  });

  it('descricao so com espacos vira null (limpa)', () => {
    expect(parse({ description: '   ' })).toEqual({ ok: true, fields: { description: null } });
  });
});

describe('limite do corpo: 8 KB (413)', () => {
  it('8192 bytes passa, 8193 e 413', () => {
    // Espacos entre as chaves completam o corpo ate o limite exato (JSON valido, campo dentro do teto).
    const base = '{"urgency":"imediato"';
    const ok = `${base}${' '.repeat(DRAFT_BODY_LIMIT_BYTES - base.length - 1)}}`;
    expect(Buffer.byteLength(ok)).toBe(DRAFT_BODY_LIMIT_BYTES);
    expect(parseDraftBody(ok, DRAFT_BODY_LIMIT_BYTES)).toMatchObject({ ok: true });
    expect(parseDraftBody(ok, DRAFT_BODY_LIMIT_BYTES + 1)).toEqual({
      ok: false,
      status: 413,
      code: 'corpo_grande',
    });
  });
});

describe('cookie do rascunho (R3, R4)', () => {
  it('le o segredo de 43 caracteres base64url e ignora outros cookies', () => {
    expect(draftSecretFromCookie(`outro=1; ${DRAFT_COOKIE_NAME}=${SEGREDO}; x=2`)).toBe(SEGREDO);
  });

  it('ausente, malformado (42 ou 44 caracteres, caractere invalido) ou repetido: null', () => {
    expect(draftSecretFromCookie(undefined)).toBeNull();
    expect(draftSecretFromCookie('outro=1')).toBeNull();
    expect(draftSecretFromCookie(`${DRAFT_COOKIE_NAME}=${'A'.repeat(42)}`)).toBeNull();
    expect(draftSecretFromCookie(`${DRAFT_COOKIE_NAME}=${'A'.repeat(44)}`)).toBeNull();
    expect(draftSecretFromCookie(`${DRAFT_COOKIE_NAME}=${'A'.repeat(42)}+`)).toBeNull();
    expect(draftSecretFromCookie(`${DRAFT_COOKIE_NAME}=${SEGREDO}; ${DRAFT_COOKIE_NAME}=${SEGREDO}`)).toBeNull();
  });

  it('Set-Cookie: __Host-, HttpOnly, Secure, SameSite=Strict, Path=/, sem Domain, 7 dias', () => {
    expect(draftCookieHeader(SEGREDO)).toBe(
      `__Host-fp_draft=${SEGREDO}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
    );
    expect(draftCookieHeader(SEGREDO)).not.toMatch(/Domain/);
  });

  it('segredo com formato errado nao gera Set-Cookie', () => {
    expect(() => draftCookieHeader('curto')).toThrow(RangeError);
  });

  it('limpeza do cookie tem Max-Age=0 e o mesmo nome', () => {
    expect(DRAFT_CLEAR_COOKIE_HEADER).toBe(
      '__Host-fp_draft=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    );
  });
});

describe('origem e tipo (R4)', () => {
  const SITE = 'https://fastpro.example.test';

  it('GET sem Origin passa; Origin do site passa', () => {
    expect(checkDraftOrigin({ origin: undefined, secFetchSite: undefined }, SITE, false)).toEqual({ ok: true });
    expect(checkDraftOrigin({ origin: SITE, secFetchSite: 'same-origin' }, SITE, false)).toEqual({ ok: true });
  });

  it('POST, PATCH e DELETE sem Origin: 403', () => {
    expect(checkDraftOrigin({ origin: undefined, secFetchSite: undefined }, SITE, true)).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('Origin de outro site ou Sec-Fetch-Site cross-site: 403', () => {
    expect(checkDraftOrigin({ origin: 'https://mau.example.test', secFetchSite: undefined }, SITE, false)).toEqual({
      ok: false,
      status: 403,
    });
    expect(checkDraftOrigin({ origin: SITE, secFetchSite: 'cross-site' }, SITE, true)).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('Content-Type precisa ser application/json (charset aceito); outro tipo: 415', () => {
    expect(checkDraftJson('application/json; charset=utf-8')).toEqual({ ok: true });
    expect(checkDraftJson('text/plain')).toEqual({ ok: false, status: 415 });
    expect(checkDraftJson(undefined)).toEqual({ ok: false, status: 415 });
  });
});

describe('A1 e A3: teto global e limite de leitura', () => {
  it('teto global padrao 5.000 com Retry-After neutro de 1 h; leitura por IP: 120 por 60 s', () => {
    expect(DRAFT_LIVE_CAP_DEFAULT).toBe(5000);
    expect(DRAFT_CAP_RETRY_S).toBe(3600);
    expect([DRAFT_RATE_LEITURA_IP.spanS, DRAFT_RATE_LEITURA_IP.limit]).toEqual([60, 120]);
  });
});

describe('estados (H-025 grava so aberto e descartado)', () => {
  it('esta historia grava so aberto e descartado; aguardando_email e publicado sao de outras historias', () => {
    expect([...DRAFT_STATUSES_WRITTEN_BY_H025]).toEqual(['aberto', 'descartado']);
    expect([...DRAFT_LIVE_STATUSES]).toEqual(['aberto', 'aguardando_email']);
  });
});

describe('limites de taxa (R1, D-08)', () => {
  it('criacao: 10 por hora e 50 por dia; salvamento: 120 por IP e 60 por rascunho, ambos em 60 s', () => {
    expect([DRAFT_RATE_CRIACAO_HORA.spanS, DRAFT_RATE_CRIACAO_HORA.limit]).toEqual([3600, 10]);
    expect([DRAFT_RATE_CRIACAO_DIA.spanS, DRAFT_RATE_CRIACAO_DIA.limit]).toEqual([86400, 50]);
    expect([DRAFT_RATE_SALVAR_IP.spanS, DRAFT_RATE_SALVAR_IP.limit]).toEqual([60, 120]);
    expect([DRAFT_RATE_SALVAR_RASCUNHO.spanS, DRAFT_RATE_SALVAR_RASCUNHO.limit]).toEqual([60, 60]);
  });
});

describe('forma da resposta e 404 uniforme (R2, R3, D-03)', () => {
  it('toDraftView so copia os campos publicos, sem hash, IP, e-mail ou nome', () => {
    const reg: DraftRecord = {
      id: UUID,
      status: 'aberto',
      serviceId: UUID,
      addressText: 'Rua Alfa, 10',
      urgency: 'imediato',
      description: 'Teste',
      expiresAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:00.000Z',
    };
    const v = toDraftView(reg) as unknown as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(
      ['address_text', 'description', 'expires_at', 'id', 'service_id', 'status', 'updated_at', 'urgency'].sort(),
    );
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(['browser_nonce_hash', 'ip_hmac', 'email', 'first_name']));
  });

  it('corpo do 404 e fixo', () => {
    expect(DRAFT_NOT_FOUND_BODY).toEqual({ code: 'nao_encontrado' });
  });
});

describe('draftMissingForReview (H-025 entrega o calculo; a revisao e de H-030)', () => {
  const pronto = {
    serviceId: UUID,
    addressText: 'Rua Alfa, 10',
    urgency: 'imediato' as const,
    description: 'Teste',
    firstName: 'Ana',
    email: 'ana@example.test',
  };

  it('lista vazia quando todos os campos estao preenchidos', () => {
    expect(draftMissingForReview(pronto)).toEqual([]);
  });

  it('sem nome e e-mail (campos de identificacao), so eles aparecem', () => {
    expect(draftMissingForReview({ ...pronto, firstName: undefined, email: undefined })).toEqual([
      'first_name',
      'email',
    ]);
    expect(draftMissingForReview({ ...pronto, firstName: '   ', email: null })).toEqual(['first_name', 'email']);
  });

  it('rascunho vazio lista tudo, na ordem fixa', () => {
    expect(
      draftMissingForReview({
        serviceId: null,
        addressText: null,
        urgency: null,
        description: null,
      }),
    ).toEqual(['service_id', 'address_text', 'urgency', 'description', 'first_name', 'email']);
  });

  it('"nao_definido" conta como preenchido (e uma escolha)', () => {
    expect(draftMissingForReview({ ...pronto, urgency: 'nao_definido' })).toEqual([]);
  });
});
