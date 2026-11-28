// Issue 120 (H-111) | Fluxo ponta a ponta no banco de DEV (147-DESENHO-H111 §3.2, §4.3, §5, D-A3, D-A6).
// Uma transacao so, desfeita no fim (rollback). Dados sinteticos (@example.test). Fakes apenas para Storage
// (memoria) e e-mail (o codigo e lido pelo mesmo caminho do envio, codigoParaEnvio; nada sai da transacao).
// Sem rede e sem e-mail real. Pula quando DATABASE_URL_MIGRATIONS nao existe (ambiente sem banco de DEV).
//
// Papeis: as funcoes da API sao executaveis so por app_system (login fastpro_dev_system). Esta suite confere isso
// pelo catalogo (has_function_privilege). As chamadas da sequencia rodam pelo executor do repo (dono da conexao),
// porque o dono nao pode assumir o papel de login (SET ROLE recusado no DEV); o EXECUTE do papel e a prova de API.
import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { connect, loadEnvValue } from '../scripts/lib/env.mjs';
import { ServicoDsrStepUp, PgDsrStepUpSql } from '../src/privacy-dsr-step-up';
import { GeradorExtratoDsr, PgDsrExtratoSql } from '../src/privacy-dsr-extrato';
import { ServicoDownloadExtrato, PgDsrDownloadSql, DsrDownloadRecusado } from '../src/privacy-dsr-download';

const HAS_DB = (() => {
  try {
    return Boolean(loadEnvValue('DATABASE_URL_MIGRATIONS'));
  } catch {
    return false;
  }
})();

const FUNCOES_API = [
  'dsr_step_up_issue',
  'dsr_step_up_confirm',
  'dsr_step_up_code_sealed',
  'dsr_open',
  'dsr_list_own',
  'dsr_get_own',
  'dsr_cancel',
  'dsr_assign',
  'dsr_process',
  'dsr_reject',
  'dsr_defer',
  'dsr_open_assisted',
  'dsr_admin_list',
  'dsr_admin_get',
  'dsr_admin_generate_extract',
  'dsr_register_extract',
  'dsr_issue_extract_token',
  'dsr_consume_extract_token',
];

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

// Storage em memoria (fake). Nome aleatorio e sem sobrescrita, como o bucket real.
class ArquivosEmMemoria {
  readonly mapa = new Map<string, Uint8Array>();
  async gravar(caminho: string, conteudo: Uint8Array): Promise<void> {
    if (this.mapa.has(caminho)) throw new Error('sobrescrita recusada');
    this.mapa.set(caminho, conteudo);
  }
  async ler(caminho: string): Promise<Uint8Array> {
    const v = this.mapa.get(caminho);
    if (!v) throw new Error('arquivo inexistente');
    return v;
  }
  async remover(caminho: string): Promise<void> {
    this.mapa.delete(caminho);
  }
}

describe.runIf(HAS_DB)('H-111 fluxo ponta a ponta no banco de DEV (transacao desfeita)', () => {
  it('papeis: funcoes da API executaveis so por app_system, nunca por API, anon, authenticated ou public', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query(
        `select p.proname,
                has_function_privilege('fastpro_dev_system', p.oid, 'EXECUTE') as sistema,
                has_function_privilege('fastpro_dev_api', p.oid, 'EXECUTE') as api,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado,
                has_function_privilege('public', p.oid, 'EXECUTE') as publico
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = any($1::text[])`,
        [FUNCOES_API],
      );
      const achadas = new Set(rows.map((r) => r.proname));
      for (const f of FUNCOES_API) expect(achadas.has(f), `funcao ausente: ${f}`).toBe(true);
      for (const r of rows) {
        expect(r.sistema, `${r.proname}: fastpro_dev_system`).toBe(true);
        expect(r.api, `${r.proname}: fastpro_dev_api`).toBe(false);
        expect(r.anon, `${r.proname}: anon`).toBe(false);
        expect(r.autenticado, `${r.proname}: authenticated`).toBe(false);
        expect(r.publico, `${r.proname}: public`).toBe(false);
      }
    } finally {
      await client.end();
    }
  });

  it('step-up -> pedido de acesso -> DPO processa e gera extrato -> titular baixa uma vez e a segunda recusa', async () => {
    const client = await connect();
    let sujeito = '';
    try {
      await client.query('begin');

      // Dados sinteticos: titular e DPO (papel dpo, cadastro ativo com MFA), como o teste de processo faz.
      sujeito = randomUUID();
      const dpo = randomUUID();
      for (const id of [sujeito, dpo]) {
        await client.query(
          `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
           values ($1, $2, $3, 'ativo', now(), now())`,
          [id, `${randomUUID()}@example.test`, randomUUID()],
        );
      }
      await client.query(
        `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
         values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
        [dpo],
      );
      await client.query(
        `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
         values (gen_random_uuid(), $1, 'dpo', null, 'bootstrap', now())`,
        [dpo],
      );

      // 1. Step-up: emite o codigo, o "e-mail" le o codigo pelo caminho do envio e o titular confirma.
      const stepUp = new ServicoDsrStepUp({
        sql: new PgDsrStepUpSql(client),
        chave: randomBytes(32),
        pepperCodigo: randomBytes(24).toString('hex'),
      });
      const emissao = await stepUp.emitir(sujeito);
      expect(emissao.resultado).toBe('criado');
      const { rows: codigos } = await client.query('select id from app.dsr_step_up_code where user_id = $1', [sujeito]);
      expect(codigos.length).toBe(1);
      const codigo = await stepUp.codigoParaEnvio(codigos[0].id);
      expect(codigo).toMatch(/^\d{6}$/);
      const confirmacao = await stepUp.confirmar(sujeito, codigo as string);
      expect(confirmacao.resultado).toBe('ok');
      const tokenStepUp = (confirmacao as { token: string }).token;

      // 2. Pedido de acesso aberto pela API (app.dsr_open), com o hash do token de step-up.
      const { rows: abertos } = await client.query('select * from app.dsr_open($1, $2, $3::jsonb, $4, $5)', [
        sujeito,
        'acesso',
        JSON.stringify({}),
        sha256(tokenStepUp),
        randomUUID(),
      ]);
      const caso: string = abertos[0].out_case_id;
      expect(caso).toMatch(/^[0-9a-f-]{36}$/);

      // 3. DPO assume o caso e defere (status deferido). O processamento comum recusa caso de acesso antes de
      // qualquer efeito (147 §4.3): o extrato, e nao o app.dsr_process, encerra esse caso.
      await client.query('select * from app.dsr_assign($1::uuid, $2::uuid, $3::uuid)', [dpo, caso, dpo]);
      await client.query('select * from app.dsr_defer($1::uuid, $2::uuid)', [dpo, caso]);
      const recusaProcesso = await recusado(client, () =>
        client.query('select * from app.dsr_process($1::uuid, $2::uuid)', [dpo, caso]),
      );
      expect(String((recusaProcesso as Error).message)).toMatch(/dsr_acesso_usa_extrato/);

      // 4. Extrato: gera, grava no Storage (fake) e registra com hash e assinatura.
      const arquivos = new ArquivosEmMemoria();
      const chaveExtrato = randomBytes(32).toString('hex');
      const gerador = new GeradorExtratoDsr({ sql: new PgDsrExtratoSql(client), arquivos, chaveAssinatura: chaveExtrato });
      const extrato = await gerador.gerar(dpo, caso);
      expect(extrato.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(arquivos.mapa.size).toBe(1);
      const { rows: estado } = await client.query('select status from app.dsr_case where id = $1', [caso]);
      expect(estado[0].status).toBe('concluido');

      // 5. Titular baixa uma vez (token de uso unico, sha256 e assinatura conferidos); a segunda e recusada.
      const download = new ServicoDownloadExtrato({
        sql: new PgDsrDownloadSql(client),
        arquivos,
        chaveAssinatura: chaveExtrato,
      });
      const emitido = await download.emitir(sujeito, caso);
      expect(emitido.token.length).toBeGreaterThan(20);
      const primeiro = await download.baixar(emitido.token);
      expect(primeiro.sha256).toBe(extrato.sha256);
      expect(primeiro.caseId).toBe(caso);
      const segundo = await recusado(client, () => download.baixar(emitido.token));
      expect(segundo).toBeInstanceOf(DsrDownloadRecusado);
    } finally {
      await client.query('rollback').catch(() => undefined);
      // Prova de que nada ficou gravado: o titular sintetico nao existe depois do rollback.
      if (sujeito) {
        const { rows } = await client.query('select count(*)::int as n from app.app_user where id = $1', [sujeito]);
        expect(rows[0].n).toBe(0);
      }
      await client.end();
    }
  });
});

// Executa uma acao que deve falhar, isolando o erro com savepoint (a transacao segue valida).
async function recusado(client: { query: (t: string, p?: unknown[]) => Promise<unknown> }, fn: () => Promise<unknown>) {
  await client.query('savepoint recusa');
  try {
    await fn();
  } catch (err) {
    await client.query('rollback to savepoint recusa');
    return err;
  }
  await client.query('release savepoint recusa');
  throw new Error('deveria ter sido recusado');
}
