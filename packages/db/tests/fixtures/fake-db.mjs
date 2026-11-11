// Banco falso para os testes offline do backup e do keep-alive (dados sinteticos; nenhuma conexao real).
// Atende as consultas por marcador (/*fp:...*/) e registra cada instrucao recebida, para provar que o
// keep-alive nao escreve. Opcoes: falhas de conexao, interrupcao em uma tabela e divergencia de contagem.
export const SYNTHETIC_TABLES = {
  'app.pedido': [
    { id: 1, nome: 'sintetico um' },
    { id: 2, nome: 'sintetico dois' },
  ],
  'ops.schema_migration': [{ version: '20261110180000', name: 'sintetica', checksum: 'x' }],
};

export function makeFakeDb(opts = {}) {
  const state = {
    tables: opts.tables ?? JSON.parse(JSON.stringify(SYNTHETIC_TABLES)),
    role: opts.role ?? 'app_backup_reader',
    bypassrls: opts.bypassrls ?? true,
    privileges: opts.privileges ?? {},
    connectError: opts.connectError ?? null,
    failOnDataOf: opts.failOnDataOf ?? null,
    countDelta: opts.countDelta ?? {},
    queryError: opts.queryError ?? null,
    connects: 0,
    ended: 0,
    statements: [],
  };

  const tableOf = (sql) => {
    const m = /"([^"]+)"\."([^"]+)"/.exec(sql);
    return m ? `${m[1]}.${m[2]}` : null;
  };

  const client = {
    async query(sql) {
      state.statements.push(sql);
      if (/^\s*(begin|commit|rollback)\b/i.test(sql)) return { rows: [] };
      if (sql.includes('/*fp:keepalive*/')) {
        if (state.queryError) throw state.queryError;
        return { rows: [{ ok: 1, esquemas: 5 }] };
      }
      if (sql.includes('/*fp:papel*/')) {
        return { rows: [{ role: state.role, bypassrls: state.bypassrls }] };
      }
      if (sql.includes('/*fp:tabelas*/')) {
        return {
          rows: Object.keys(state.tables).map((full) => {
            const [schema, name] = full.split('.');
            const p = state.privileges[full] ?? {};
            return { schema, name, sel: p.select ?? true, wr: p.write ?? false };
          }),
        };
      }
      if (sql.includes('/*fp:migracao*/')) return { rows: [{ v: '20261110180000' }] };
      if (sql.includes('/*fp:versao*/')) return { rows: [{ v: '17.11' }] };
      if (sql.includes('/*fp:contagem*/')) {
        const t = tableOf(sql);
        return { rows: [{ n: state.tables[t].length + (state.countDelta[t] ?? 0) }] };
      }
      if (sql.includes('/*fp:dados*/')) {
        const t = tableOf(sql);
        if (state.failOnDataOf === t) {
          throw Object.assign(new Error('interrompido (simulado)'), { code: '57P01' });
        }
        return { rows: state.tables[t].map((r) => ({ j: JSON.stringify(r) })) };
      }
      throw new Error('consulta nao suportada pelo banco falso');
    },
    async end() {
      state.ended += 1;
    },
  };

  return {
    state,
    client,
    async connect() {
      state.connects += 1;
      if (state.connectError) throw state.connectError;
      return client;
    },
  };
}
