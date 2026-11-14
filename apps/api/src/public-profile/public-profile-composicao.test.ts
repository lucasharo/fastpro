// Issue 56 (H-043) | Testes da montagem da rota publica e do adaptador Pg (docs/factory/143-DESENHO-H043.md, §7 e §8).
import { describe, expect, it } from 'vitest';
import { montarPerfilPublicoRota } from './public-profile-composicao.js';
import { PgPublicProfileStore, SQL_LER_PERFIL_PUBLICO } from './pg-public-profile-store.js';

const URL_FICTICIA = 'postgres://usuario-ficticio@servidor-ficticio/banco';
const fabrica = () => ({ query: async () => ({ rows: [] }) });

describe('montagem da rota publica do perfil', () => {
  it('sem a variavel de conexao do papel app_system a rota nao liga', () => {
    expect(montarPerfilPublicoRota({}, { abrirCliente: fabrica })).toBeUndefined();
    expect(montarPerfilPublicoRota({ DATABASE_URL_APP_SYSTEM: '   ' }, { abrirCliente: fabrica })).toBeUndefined();
  });

  it('sem a fabrica do cliente SQL a rota nao liga', () => {
    expect(montarPerfilPublicoRota({ DATABASE_URL_APP_SYSTEM: URL_FICTICIA })).toBeUndefined();
  });

  it('com conexao e fabrica devolve porta e limite, e o limite e o mesmo entre montagens', () => {
    const env = { DATABASE_URL_APP_SYSTEM: URL_FICTICIA };
    const primeira = montarPerfilPublicoRota(env, { abrirCliente: fabrica });
    const segunda = montarPerfilPublicoRota(env, { abrirCliente: fabrica });
    expect(primeira?.port).toBeInstanceOf(PgPublicProfileStore);
    expect(primeira?.limite).toBeDefined();
    expect(primeira?.limite).toBe(segunda?.limite);
  });
});

describe('adaptador Pg da leitura publica', () => {
  it('chama a funcao de leitura com o slug como unico parametro', async () => {
    const chamadas: Array<{ text: string; params: readonly unknown[] }> = [];
    const store = new PgPublicProfileStore({
      async query(text, params) {
        chamadas.push({ text, params });
        return { rows: [{ perfil: null }] };
      },
    });
    expect(await store.lerPorSlug('ana-teste')).toBeNull();
    expect(chamadas).toEqual([{ text: SQL_LER_PERFIL_PUBLICO, params: ['ana-teste'] }]);
  });

  it('devolve o objeto que a funcao entregou, sem reescrever', async () => {
    const perfil = { publicName: 'Ana Teste', slug: 'ana-teste' };
    const store = new PgPublicProfileStore({
      async query() {
        return { rows: [{ perfil }] };
      },
    });
    expect(await store.lerPorSlug('ana-teste')).toEqual(perfil);
  });

  it('forma inesperada vira erro generico, sem o conteudo devolvido', async () => {
    const store = new PgPublicProfileStore({
      async query() {
        return { rows: [{ perfil: 'conteudo-inesperado' }] };
      },
    });
    await expect(store.lerPorSlug('ana-teste')).rejects.toThrow('public_profile_forma_inesperada');
  });

  it('a consulta nao toca tabela privada nem coluna de contato ou documento', () => {
    expect(SQL_LER_PERFIL_PUBLICO).not.toMatch(/app\.|document_|professional_area|phone|email|commercial_access/);
  });
});
