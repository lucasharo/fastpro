// H-035 | Adaptador Pg do documento do perfil profissional com cliente falso (sem banco, sem rede).
// Conferem-se os parametros enviados, o mapeamento dos resultados da funcao e o tratamento de 23505
// (slug com sufixo; HMAC com repeticao). A prova no Postgres real fica para o dbtest da migracao.
import { describe, it, expect } from 'vitest';
import {
  PgProfessionalProfile,
  PROFESSIONAL_HMAC_CONSTRAINT,
  PROFESSIONAL_SLUG_CONSTRAINT,
  slugComSufixo,
  type ProfessionalDocumentDbInput,
} from '../src/professional-profile.js';
import type { SqlClient } from '../src/jobs-tick.js';

const USUARIO = '11111111-1111-4111-8111-111111111111';
const AGORA = Date.UTC(2099, 0, 1, 12);
const AGORA_ISO = '2099-01-01T12:00:00.000Z';
const BLOB = Buffer.from([1, 2, 3, 4, 5]);
const HMAC = 'a'.repeat(64);

const novo = (extra: Partial<ProfessionalDocumentDbInput> = {}): ProfessionalDocumentDbInput => ({
  userId: USUARIO,
  publicName: 'Nome Sintetico',
  slug: 'nome-sintetico',
  documentType: 'CPF',
  documentEnc: BLOB,
  documentHmac: HMAC,
  nowMs: AGORA,
  ...extra,
});

type Passo = { rows: Record<string, unknown>[] } | { erro: Record<string, unknown> };

/** Cliente falso: devolve os passos em ordem e grava cada chamada. */
class ClienteFalso implements SqlClient {
  readonly chamadas: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly passos: Passo[]) {}
  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.chamadas.push({ sql: text, params });
    const passo = this.passos.shift();
    if (passo === undefined) throw new Error('sem passo no cliente falso');
    if ('erro' in passo) throw Object.assign(new Error('falha de banco simulada'), passo.erro);
    return { rows: passo.rows };
  }
}

const resultado = (valor: string): Passo => ({ rows: [{ out_resultado: valor }] });
const erroUnico = (constraint: string): Passo => ({ erro: { code: '23505', constraint } });

describe('PgProfessionalProfile.find (H-035)', () => {
  it('devolve nulo quando a conta nao tem perfil profissional', async () => {
    const cliente = new ClienteFalso([{ rows: [] }]);
    const adaptador = new PgProfessionalProfile({ client: cliente });
    expect(await adaptador.find(USUARIO)).toBeNull();
    expect(cliente.chamadas[0]!.params).toEqual([USUARIO]);
  });

  it('mapeia o perfil sem campo sensivel (sem document_enc nem document_hmac)', async () => {
    const cliente = new ClienteFalso([
      {
        rows: [
          {
            email_verified: true,
            public_name: 'Nome Sintetico',
            slug: 'nome-sintetico',
            document_type: 'CNPJ',
            verification_status: 'pendente',
          },
        ],
      },
    ]);
    const perfil = await new PgProfessionalProfile({ client: cliente }).find(USUARIO);
    expect(perfil).toEqual({
      emailVerified: true,
      publicName: 'Nome Sintetico',
      slug: 'nome-sintetico',
      documentType: 'CNPJ',
      verificationStatus: 'pendente',
    });
    expect(JSON.stringify(perfil)).not.toMatch(/document_(enc|hmac)|documentEnc|documentHmac/);
  });

  it('recusa status desconhecido sem devolver o valor', async () => {
    const cliente = new ClienteFalso([
      { rows: [{ email_verified: false, public_name: null, slug: null, document_type: null, verification_status: 'xpto' }] },
    ]);
    await expect(new PgProfessionalProfile({ client: cliente }).find(USUARIO)).rejects.toThrow('status_profissional_invalido');
  });

  it('consulta com o usuario da sessao e o vinculo ao cadastro do e-mail', async () => {
    const cliente = new ClienteFalso([{ rows: [] }]);
    await new PgProfessionalProfile({ client: cliente }).find(USUARIO);
    expect(cliente.chamadas[0]!.sql).toContain('app.professional_profile');
    expect(cliente.chamadas[0]!.sql).toContain('email_verified_at');
  });
});

describe('PgProfessionalProfile.setDocument (H-035)', () => {
  it('chama a funcao com os parametros certos e devolve pendente', async () => {
    const cliente = new ClienteFalso([resultado('pendente')]);
    const out = await new PgProfessionalProfile({ client: cliente }).setDocument(novo());
    expect(out).toBe('pendente');
    const chamada = cliente.chamadas[0]!;
    expect(chamada.sql).toContain('private.professional_profile_set_document(');
    expect(chamada.params).toEqual([USUARIO, 'Nome Sintetico', 'nome-sintetico', 'CPF', BLOB, HMAC, AGORA_ISO]);
  });

  it('devolve retida_duplicidade e ja_cadastrado conforme a funcao', async () => {
    const retida = new ClienteFalso([resultado('retida_duplicidade')]);
    expect(await new PgProfessionalProfile({ client: retida }).setDocument(novo())).toBe('retida_duplicidade');
    const ja = new ClienteFalso([resultado('ja_cadastrado')]);
    expect(await new PgProfessionalProfile({ client: ja }).setDocument(novo())).toBe('ja_cadastrado');
  });

  it('trata sem_perfil e resultado vazio como erro, sem detalhe', async () => {
    const semPerfil = new ClienteFalso([resultado('sem_perfil')]);
    await expect(new PgProfessionalProfile({ client: semPerfil }).setDocument(novo())).rejects.toThrow(
      'documento_resultado_invalido',
    );
    const vazio = new ClienteFalso([{ rows: [] }]);
    await expect(new PgProfessionalProfile({ client: vazio }).setDocument(novo())).rejects.toThrow(
      'documento_resultado_invalido',
    );
  });

  it('colisao de slug: tenta de novo com sufixo e devolve o resultado da segunda tentativa', async () => {
    const cliente = new ClienteFalso([erroUnico(PROFESSIONAL_SLUG_CONSTRAINT), resultado('pendente')]);
    const adaptador = new PgProfessionalProfile({ client: cliente, sufixo: () => 'abc123' });
    expect(await adaptador.setDocument(novo())).toBe('pendente');
    expect(cliente.chamadas[0]!.params[2]).toBe('nome-sintetico');
    expect(cliente.chamadas[1]!.params[2]).toBe('nome-sintetico-abc123');
  });

  it('colisao de slug persistente: para depois de 5 tentativas e re-lanca', async () => {
    const passos: Passo[] = Array.from({ length: 5 }, () => erroUnico(PROFESSIONAL_SLUG_CONSTRAINT));
    const cliente = new ClienteFalso(passos);
    const adaptador = new PgProfessionalProfile({ client: cliente, sufixo: () => 'ffffff' });
    await expect(adaptador.setDocument(novo())).rejects.toMatchObject({ code: '23505' });
    expect(cliente.chamadas).toHaveLength(5);
  });

  it('23505 do indice de HMAC: repete uma vez e devolve o que a funcao decide', async () => {
    const cliente = new ClienteFalso([erroUnico(PROFESSIONAL_HMAC_CONSTRAINT), resultado('retida_duplicidade')]);
    expect(await new PgProfessionalProfile({ client: cliente }).setDocument(novo())).toBe('retida_duplicidade');
    expect(cliente.chamadas).toHaveLength(2);
  });

  it('23505 do HMAC repetido: para depois da segunda tentativa', async () => {
    const cliente = new ClienteFalso([erroUnico(PROFESSIONAL_HMAC_CONSTRAINT), erroUnico(PROFESSIONAL_HMAC_CONSTRAINT)]);
    await expect(new PgProfessionalProfile({ client: cliente }).setDocument(novo())).rejects.toMatchObject({
      constraint: PROFESSIONAL_HMAC_CONSTRAINT,
    });
    expect(cliente.chamadas).toHaveLength(2);
  });

  it('outro erro do banco sobe sem repetir', async () => {
    const cliente = new ClienteFalso([{ erro: { code: '42501' } }]);
    await expect(new PgProfessionalProfile({ client: cliente }).setDocument(novo())).rejects.toMatchObject({
      code: '42501',
    });
    expect(cliente.chamadas).toHaveLength(1);
  });
});

describe('slugComSufixo (H-035)', () => {
  it('acrescenta o sufixo com hifen', () => {
    expect(slugComSufixo('joao-silva', 'a1b2c3')).toBe('joao-silva-a1b2c3');
  });

  it('corta a base para o total de 100 caracteres do CHECK de formato', () => {
    const base = 'a'.repeat(60) + '-' + 'b'.repeat(60);
    const slug = slugComSufixo(base, 'a1b2c3');
    expect(slug.length).toBeLessThanOrEqual(100);
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{0,99}$/);
    expect(slug.endsWith('-a1b2c3')).toBe(true);
  });

  it('nunca comeca com hifen nem fica vazio', () => {
    expect(slugComSufixo('-', 'a1b2c3')).toBe('perfil-a1b2c3');
  });
});
