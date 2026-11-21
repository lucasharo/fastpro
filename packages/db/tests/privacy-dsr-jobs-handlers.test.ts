// Issue 120 (H-111) | Handlers dos jobs dos direitos do titular (147-DESENHO-H111 §4.4, §7; fatia 8).
// Portas falsas e fetch injetado: nenhuma conexao de rede e nenhum banco. Dados sinteticos (@example.test).
// Cobre: registro dos tres kinds, cada handler (caminhos felizes e falhas), idempotencia, ordem arquivo-antes-da-marca,
// adaptadores SQL (texto e parametros) e Storage (URL, cabecalhos e mensagens sem segredo nem caminho).
import { describe, it, expect } from 'vitest';
import { JobRegistry, errorCodeOf, type JobContext } from '../src/jobs-tick.js';
import {
  DSR_AUTH_CLEANUP_KIND,
  DSR_EXPORT_PURGE_KIND,
  DSR_PROCESS_AUTO_KIND,
  DsrExtratoAindaValido,
  DsrExtratoCaminhoInvalido,
  DsrExtratoStorageFalha,
  DsrExpurgoNaoMarcado,
  DsrPayloadInvalido,
  DsrRetornoDesconhecido,
  ExpurgoExtratoHandler,
  LimpezaAuthHandler,
  PgDsrJobsStore,
  ProcessoAutomaticoHandler,
  SupabaseStorageExtratos,
  registerDsrJobHandlers,
  type DsrAlvoExpurgo,
  type DsrAlvoLimpezaAuth,
  type DsrAuthUsuariosPort,
  type DsrExtratosArquivosPort,
  type DsrJobsStorePort,
} from '../src/privacy-dsr-jobs.js';

const CASO = '6f1f0c52-0d7a-4c8e-9a3b-2f4d5e6a7b8c';
const USUARIO = '0b9e8d7c-6a5b-4c3d-8e2f-1a0b9c8d7e6f';
const AUTH = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SEGREDO = 'dummy-secret-TESTE_NAO_REAL_123456';
const CAMINHO = '3f2e1d0c-9b8a-4786-8594-a3b2c1d0e9f8.json';

function job(kind: string, payload: string | null): JobContext {
  return { id: 'job-1', kind, payload_ref: payload, attempts: 1 };
}

/** Porta SQL falsa: cada metodo grava a chamada e devolve o valor preparado. */
function storeFalso(respostas: {
  processo?: string | Error;
  limpeza?: DsrAlvoLimpezaAuth;
  expurgo?: DsrAlvoExpurgo;
  marca?: string | Error;
}): DsrJobsStorePort & { chamadas: string[] } {
  const chamadas: string[] = [];
  const dar = <T>(v: T | Error | undefined, nome: string): T => {
    chamadas.push(nome);
    if (v instanceof Error) throw v;
    return v as T;
  };
  return {
    chamadas,
    async processoAuto() {
      return dar(respostas.processo ?? 'processado', 'processoAuto');
    },
    async alvoLimpezaAuth() {
      return dar(respostas.limpeza ?? { status: 'nao_encontrado', authUserId: null }, 'alvoLimpezaAuth');
    },
    async alvoExpurgo() {
      return dar(respostas.expurgo ?? { status: 'nao_encontrado', storagePath: null }, 'alvoExpurgo');
    },
    async marcarExpurgado() {
      return dar(respostas.marca ?? 'expurgado', 'marcarExpurgado');
    },
  };
}

function authFalso(falha?: Error): DsrAuthUsuariosPort & { removidos: string[] } {
  const removidos: string[] = [];
  return {
    removidos,
    async deleteUser(id: string) {
      if (falha) throw falha;
      removidos.push(id);
    },
  };
}

function arquivosFalsos(falha?: Error): DsrExtratosArquivosPort & { removidos: string[] } {
  const removidos: string[] = [];
  return {
    removidos,
    async remover(caminho: string) {
      if (falha) throw falha;
      removidos.push(caminho);
    },
  };
}

async function falhaDe(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (err) {
    return err;
  }
  throw new Error('esperava falha, mas o handler concluiu');
}

describe('registro dos handlers da fatia 8', () => {
  it('registra os tres kinds e recusa segundo handler para o mesmo kind', () => {
    const registro = new JobRegistry();
    registerDsrJobHandlers(registro, { store: storeFalso({}), auth: authFalso(), arquivos: arquivosFalsos() });
    expect(registro.get(DSR_PROCESS_AUTO_KIND)).toBeDefined();
    expect(registro.get(DSR_AUTH_CLEANUP_KIND)).toBeDefined();
    expect(registro.get(DSR_EXPORT_PURGE_KIND)).toBeDefined();
    expect(() =>
      registerDsrJobHandlers(registro, { store: storeFalso({}), auth: authFalso(), arquivos: arquivosFalsos() }),
    ).toThrow();
  });
});

describe('dsr.process_auto', () => {
  it('processado conclui sem erro e passa o id do caso ao banco', async () => {
    const store = storeFalso({ processo: 'processado' });
    await expect(new ProcessoAutomaticoHandler(store).run(job(DSR_PROCESS_AUTO_KIND, CASO))).resolves.toBeUndefined();
    expect(store.chamadas).toEqual(['processoAuto']);
  });

  it.each(['nao_elegivel', 'ja_encerrado', 'ja_anonimizado', 'nao_encontrado'])(
    '%s nao e erro: o job termina sem repetir',
    async (resultado) => {
      const store = storeFalso({ processo: resultado });
      await expect(new ProcessoAutomaticoHandler(store).run(job(DSR_PROCESS_AUTO_KIND, CASO))).resolves.toBeUndefined();
    },
  );

  it('resultado fora da lista vira falha de retorno desconhecido', async () => {
    const err = await falhaDe(new ProcessoAutomaticoHandler(storeFalso({ processo: 'algo_novo' })).run(job(DSR_PROCESS_AUTO_KIND, CASO)));
    expect(err).toBeInstanceOf(DsrRetornoDesconhecido);
    expect(errorCodeOf(err)).toBe('DsrRetornoDesconhecido');
  });

  it('payload ausente ou nao UUID falha sem chamar o banco', async () => {
    const store = storeFalso({});
    for (const payload of [null, '', 'nao-e-uuid', `${CASO}; drop table x`]) {
      const err = await falhaDe(new ProcessoAutomaticoHandler(store).run(job(DSR_PROCESS_AUTO_KIND, payload)));
      expect(err).toBeInstanceOf(DsrPayloadInvalido);
    }
    expect(store.chamadas).toEqual([]);
  });

  it('erro do banco (ex.: anonimizacao recusada) propaga para o tick repetir', async () => {
    const erro = new Error('retencao_legal_ativa');
    const store = storeFalso({ processo: erro });
    await expect(new ProcessoAutomaticoHandler(store).run(job(DSR_PROCESS_AUTO_KIND, CASO))).rejects.toBe(erro);
  });
});

describe('dsr.auth_cleanup', () => {
  it('conta anonimizada com identificador de Auth: remove o usuario do Auth', async () => {
    const auth = authFalso();
    const store = storeFalso({ limpeza: { status: 'pronto', authUserId: AUTH } });
    await new LimpezaAuthHandler(store, auth).run(job(DSR_AUTH_CLEANUP_KIND, USUARIO));
    expect(auth.removidos).toEqual([AUTH]);
  });

  it('conta sem identificador de Auth nao chama o Auth', async () => {
    const auth = authFalso();
    await new LimpezaAuthHandler(storeFalso({ limpeza: { status: 'pronto', authUserId: null } }), auth).run(
      job(DSR_AUTH_CLEANUP_KIND, USUARIO),
    );
    expect(auth.removidos).toEqual([]);
  });

  it('conta que nao esta anonimizada nunca e removida do Auth', async () => {
    const auth = authFalso();
    await new LimpezaAuthHandler(storeFalso({ limpeza: { status: 'nao_anonimizado', authUserId: AUTH } }), auth).run(
      job(DSR_AUTH_CLEANUP_KIND, USUARIO),
    );
    expect(auth.removidos).toEqual([]);
  });

  it('falha do Auth propaga (o tick repete; a anonimizacao ja esta gravada e o acesso ja esta barrado)', async () => {
    const erro = new Error('auth_deleteUser_503');
    const handler = new LimpezaAuthHandler(
      storeFalso({ limpeza: { status: 'pronto', authUserId: AUTH } }),
      authFalso(erro),
    );
    await expect(handler.run(job(DSR_AUTH_CLEANUP_KIND, USUARIO))).rejects.toBe(erro);
  });

  it('payload invalido falha sem consultar o banco', async () => {
    const store = storeFalso({});
    const err = await falhaDe(new LimpezaAuthHandler(store, authFalso()).run(job(DSR_AUTH_CLEANUP_KIND, 'x')));
    expect(err).toBeInstanceOf(DsrPayloadInvalido);
    expect(store.chamadas).toEqual([]);
  });
});

describe('dsr.export_purge', () => {
  it('vencido: apaga o arquivo e so depois marca o extrato no banco, nessa ordem', async () => {
    const ordem: string[] = [];
    const arquivos: DsrExtratosArquivosPort = {
      async remover(c) {
        ordem.push(`remover:${c}`);
      },
    };
    const store = storeFalso({ expurgo: { status: 'pronto_para_expurgo', storagePath: CAMINHO } });
    const marcar = store.marcarExpurgado.bind(store);
    store.marcarExpurgado = async (caso) => {
      ordem.push('marcar');
      return marcar(caso);
    };
    await new ExpurgoExtratoHandler(store, arquivos).run(job(DSR_EXPORT_PURGE_KIND, CASO));
    expect(ordem).toEqual([`remover:${CAMINHO}`, 'marcar']);
  });

  it('falha ao apagar o arquivo nao marca como expurgado (o job tenta de novo)', async () => {
    const erro = new DsrExtratoStorageFalha();
    const store = storeFalso({ expurgo: { status: 'pronto_para_expurgo', storagePath: CAMINHO } });
    await expect(new ExpurgoExtratoHandler(store, arquivosFalsos(erro)).run(job(DSR_EXPORT_PURGE_KIND, CASO))).rejects.toBe(
      erro,
    );
    expect(store.chamadas).toEqual(['alvoExpurgo']);
  });

  it('antes do vencimento falha recuperavel e nao apaga nada', async () => {
    const arquivos = arquivosFalsos();
    const err = await falhaDe(
      new ExpurgoExtratoHandler(storeFalso({ expurgo: { status: 'ainda_valido', storagePath: null } }), arquivos).run(
        job(DSR_EXPORT_PURGE_KIND, CASO),
      ),
    );
    expect(err).toBeInstanceOf(DsrExtratoAindaValido);
    expect(arquivos.removidos).toEqual([]);
  });

  it.each(['ja_expurgado', 'nao_encontrado'])('%s e no-op: nao apaga e nao marca', async (status) => {
    const arquivos = arquivosFalsos();
    const store = storeFalso({ expurgo: { status, storagePath: null } });
    await new ExpurgoExtratoHandler(store, arquivos).run(job(DSR_EXPORT_PURGE_KIND, CASO));
    expect(arquivos.removidos).toEqual([]);
    expect(store.chamadas).toEqual(['alvoExpurgo']);
  });

  it('marca que nao confirma o expurgo vira falha', async () => {
    const store = storeFalso({
      expurgo: { status: 'pronto_para_expurgo', storagePath: CAMINHO },
      marca: 'ainda_valido',
    });
    const err = await falhaDe(new ExpurgoExtratoHandler(store, arquivosFalsos()).run(job(DSR_EXPORT_PURGE_KIND, CASO)));
    expect(err).toBeInstanceOf(DsrExpurgoNaoMarcado);
  });

  it('marca repetida (ja_expurgado) aceita como sucesso', async () => {
    const store = storeFalso({
      expurgo: { status: 'pronto_para_expurgo', storagePath: CAMINHO },
      marca: 'ja_expurgado',
    });
    await expect(new ExpurgoExtratoHandler(store, arquivosFalsos()).run(job(DSR_EXPORT_PURGE_KIND, CASO))).resolves.toBeUndefined();
  });

  it('status desconhecido ou caminho ausente falha sem apagar', async () => {
    const arquivos = arquivosFalsos();
    const err = await falhaDe(
      new ExpurgoExtratoHandler(storeFalso({ expurgo: { status: 'pronto_para_expurgo', storagePath: null } }), arquivos).run(
        job(DSR_EXPORT_PURGE_KIND, CASO),
      ),
    );
    expect(err).toBeInstanceOf(DsrRetornoDesconhecido);
    expect(arquivos.removidos).toEqual([]);
  });
});

describe('PgDsrJobsStore (SQL das funcoes app.dsr_job_*)', () => {
  type Chamada = { texto: string; params: unknown[] | undefined };
  function clienteFalso(linhas: Record<string, unknown>[]): { client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }; chamadas: Chamada[] } {
    const chamadas: Chamada[] = [];
    return {
      chamadas,
      client: {
        async query(texto, params) {
          chamadas.push({ texto, params });
          return { rows: linhas };
        },
      },
    };
  }

  it('processoAuto chama app.dsr_job_process_auto com o id e le o resultado', async () => {
    const { client, chamadas } = clienteFalso([{ resultado: 'processado' }]);
    await expect(new PgDsrJobsStore(client).processoAuto(CASO)).resolves.toBe('processado');
    expect(chamadas[0]?.texto).toContain('app.dsr_job_process_auto($1::uuid)');
    expect(chamadas[0]?.params).toEqual([CASO]);
  });

  it('linha ausente vira valor seguro (nao_encontrado / desconhecido), nunca alvo pronto', async () => {
    const vazio = clienteFalso([]);
    await expect(new PgDsrJobsStore(vazio.client).alvoLimpezaAuth(USUARIO)).resolves.toEqual({
      status: 'nao_encontrado',
      authUserId: null,
    });
    await expect(new PgDsrJobsStore(vazio.client).alvoExpurgo(CASO)).resolves.toEqual({
      status: 'nao_encontrado',
      storagePath: null,
    });
    await expect(new PgDsrJobsStore(vazio.client).marcarExpurgado(CASO)).resolves.toBe('desconhecido');
  });

  it('alvos de limpeza e expurgo leem as colunas out_* das funcoes', async () => {
    const limpeza = clienteFalso([{ out_status: 'pronto', out_auth_user_id: AUTH }]);
    await expect(new PgDsrJobsStore(limpeza.client).alvoLimpezaAuth(USUARIO)).resolves.toEqual({
      status: 'pronto',
      authUserId: AUTH,
    });
    expect(limpeza.chamadas[0]?.texto).toContain('app.dsr_job_auth_cleanup_target($1::uuid)');
    const expurgo = clienteFalso([{ out_status: 'pronto_para_expurgo', out_storage_path: CAMINHO }]);
    await expect(new PgDsrJobsStore(expurgo.client).alvoExpurgo(CASO)).resolves.toEqual({
      status: 'pronto_para_expurgo',
      storagePath: CAMINHO,
    });
    expect(expurgo.chamadas[0]?.texto).toContain('app.dsr_job_export_target($1::uuid)');
  });
});

describe('SupabaseStorageExtratos (bucket privado dsr-exports)', () => {
  function httpFalso(status: number): { http: typeof fetch; chamadas: { url: string; init: RequestInit }[] } {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    return { http, chamadas };
  }

  it('apaga o objeto no bucket certo, com a chave de servico so nos cabecalhos', async () => {
    const { http, chamadas } = httpFalso(200);
    await new SupabaseStorageExtratos({ url: 'https://projeto.example.test/', secretKey: SEGREDO, fetch: http }).remover(CAMINHO);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe(`https://projeto.example.test/storage/v1/object/dsr-exports/${CAMINHO}`);
    expect(chamadas[0]?.init.method).toBe('DELETE');
    expect(chamadas[0]?.url).not.toContain(SEGREDO);
  });

  it('404 (objeto ja removido) e sucesso: a remocao e idempotente', async () => {
    const { http } = httpFalso(404);
    await expect(
      new SupabaseStorageExtratos({ url: 'https://projeto.example.test', secretKey: SEGREDO, fetch: http }).remover(CAMINHO),
    ).resolves.toBeUndefined();
  });

  it('erro do Storage vira falha com codigo fixo, sem chave nem caminho na mensagem', async () => {
    const { http } = httpFalso(500);
    const err = await falhaDe(
      new SupabaseStorageExtratos({ url: 'https://projeto.example.test', secretKey: SEGREDO, fetch: http }).remover(CAMINHO),
    );
    expect(err).toBeInstanceOf(DsrExtratoStorageFalha);
    expect(String((err as Error).message)).not.toContain(SEGREDO);
    expect(String((err as Error).message)).not.toContain(CAMINHO);
  });

  it.each(['../fora.json', '/raiz.json', 'pasta/../x.json', 'com espaco.json', ''])(
    'caminho recusado antes de qualquer chamada: %j',
    async (caminho) => {
      const { http, chamadas } = httpFalso(200);
      const err = await falhaDe(
        new SupabaseStorageExtratos({ url: 'https://projeto.example.test', secretKey: SEGREDO, fetch: http }).remover(caminho),
      );
      expect(err).toBeInstanceOf(DsrExtratoCaminhoInvalido);
      expect(chamadas).toEqual([]);
    },
  );
});
