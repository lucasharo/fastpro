// Issue 120 (H-111) | Fluxo ponta a ponta de API com banco de DEV (147-DESENHO-H111 §4, §5, §6; pendencia H-111 "P-H").
// Sequencia: step-up (emite, le o codigo pelo caminho do envio, confirma) -> abre pedido de acesso pela API do titular
// -> DPO atribui e processa pela API (gera o extrato) -> titular le o caso e baixa uma vez; a segunda baixa e recusada.
// Handlers reais das rotas do titular e do DPO, servidor HTTP local efemero e banco real. Fakes APENAS para Storage
// (memoria) e e-mail (o codigo e lido pelo mesmo caminho do envio, codigoParaEnvio; nada sai do processo).
// Transacao unica desfeita no fim (rollback): nada fica gravado no DEV. Pula sem DATABASE_URL_MIGRATIONS.
// Papel: o executor do repo (dono da conexao) porque SET ROLE e recusado no DEV; o EXECUTE do papel app_system
// e provado em packages/db/tests/privacy-dsr-fluxo-banco.test.ts (catalogo) e em authorization-catalog.dbtest.mjs.
import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  GeradorExtratoDsr,
  PgAdminSessionRepository,
  PgDsrDownloadSql,
  PgDsrExtratoSql,
  PgDsrStepUpSql,
  PgSessionRepository,
  ServicoDownloadExtrato,
  ServicoDsrStepUp,
} from '@fastpro/db';
import { handlePrivacyTitularRoute } from './titular-route.js';
import { handlePrivacyDpoRoute } from './dpo-route.js';
import { PgDsrTitularSql, ServicoDsrTitular } from './titular-service.js';
import { PgDsrDpoSql, ServicoDsrDpo } from './dpo-service.js';

const ADMIN_BASE_URL = 'https://admin.example.test';

/** Valor de uma variavel: ambiente ou .env.local da raiz. Nunca imprime. */
function valorDeEnv(nome: string): string | undefined {
  if (process.env[nome]) return process.env[nome];
  const arquivo = fileURLToPath(new URL('../../../../.env.local', import.meta.url));
  if (!existsSync(arquivo)) return undefined;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i > 0 && linha.slice(0, i).trim() === nome)
      return linha
        .slice(i + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

const URL_BANCO = valorDeEnv('DATABASE_URL_MIGRATIONS');
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

async function lerResposta(
  res: Response,
): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  const texto = await res.text();
  try {
    return { status: res.status, corpo: JSON.parse(texto) as Record<string, unknown> };
  } catch {
    return { status: res.status, corpo: null };
  }
}

describe.runIf(URL_BANCO !== undefined)(
  'H-111 fluxo de API ponta a ponta no banco de DEV (transacao desfeita)',
  () => {
    it('step-up -> pedido de acesso pela API -> DPO processa e gera o extrato -> titular baixa uma vez e a segunda e recusada', async () => {
      const c = new pg.Client({
        connectionString: URL_BANCO,
        connectionTimeoutMillis: 15000,
        application_name: 'fastpro-api-e2e',
      });
      await c.connect();
      let servidor: Server | undefined;
      let sujeito = '';
      try {
        await c.query('begin');

        // Dados sinteticos (@example.test): titular com sessao ativa; DPO com cadastro, papel dpo e sessao admin (aal2).
        sujeito = randomUUID();
        const dpo = randomUUID();
        const segredoTitular = randomBytes(32).toString('base64url');
        const segredoDpo = randomBytes(32).toString('base64url');
        for (const id of [sujeito, dpo]) {
          await c.query(
            `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
           values ($1, $2, $3, 'ativo', now(), now())`,
            [id, `${randomUUID()}@example.test`, randomUUID()],
          );
        }
        await c.query(
          `insert into app.app_session (id, user_id, stage, secret_hash, challenge_id, purpose, created_at, expires_at, absolute_expires_at, recent_auth_at)
         values ($1, $2, 'ativa', $3, $4, 'login', now(), now() + interval '1 hour', now() + interval '1 hour', now())`,
          [randomUUID(), sujeito, sha256(segredoTitular), randomUUID()],
        );
        await c.query(
          `insert into app.admin_staff (user_id, status, origin, invited_by, mfa_enrolled_at, created_at, status_changed_at)
         values ($1, 'ativo', 'bootstrap', null, now(), now(), now())`,
          [dpo],
        );
        await c.query(
          `insert into app.admin_user_role (id, user_id, role_code, granted_by, grant_origin, granted_at)
         values (gen_random_uuid(), $1, 'dpo', null, 'bootstrap', now())`,
          [dpo],
        );
        await c.query(
          `insert into app.admin_session (id, user_id, secret_hash, aal2_at, totp_at, created_at, expires_at)
         values ($1, $2, $3, now(), now(), now(), now() + interval '8 hours')`,
          [randomUUID(), dpo, sha256(segredoDpo)],
        );

        // Fakes: Storage em memoria e e-mail (captura do codigo pelo caminho do envio). Chaves sinteticas em memoria.
        const arquivos = new ArquivosEmMemoria();
        const chaveStepUp = randomBytes(32);
        const pepperCodigo = randomBytes(24).toString('hex');
        const chaveExtrato = randomBytes(32).toString('hex');
        const relogio = { nowMs: () => Date.now() };
        const stepUp = new ServicoDsrStepUp({
          sql: new PgDsrStepUpSql(c),
          chave: chaveStepUp,
          pepperCodigo,
        });
        const download = new ServicoDownloadExtrato({
          sql: new PgDsrDownloadSql(c),
          arquivos,
          chaveAssinatura: chaveExtrato,
        });
        const gerador = new GeradorExtratoDsr({
          sql: new PgDsrExtratoSql(c),
          arquivos,
          chaveAssinatura: chaveExtrato,
        });

        const opcoesTitular = {
          sessions: new PgSessionRepository(c),
          service: new ServicoDsrTitular(new PgDsrTitularSql(c), download),
          relogio,
          stepUp,
          download,
        };
        const opcoesDpo = {
          guard: (segredo: string, nowMs: number) =>
            new PgAdminSessionRepository(c).guard(segredo, nowMs),
          service: new ServicoDsrDpo(new PgDsrDpoSql(c), gerador),
          baseUrl: ADMIN_BASE_URL,
          clock: relogio,
        };

        servidor = createServer((req, res) => {
          const caminho = (req.url ?? '/').split('?')[0] ?? '/';
          if (caminho.startsWith('/v1/admin/privacy/')) {
            void handlePrivacyDpoRoute(req, res, caminho, opcoesDpo as never);
          } else {
            void handlePrivacyTitularRoute(req, res, caminho, opcoesTitular as never);
          }
        });
        await new Promise<void>((ok) => servidor!.listen(0, '127.0.0.1', ok));
        const porta = (servidor.address() as { port: number }).port;
        const base = `http://127.0.0.1:${porta}`;

        const titular = (
          metodo: string,
          caminho: string,
          corpo?: unknown,
          extra: Record<string, string> = {},
        ) =>
          fetch(`${base}${caminho}`, {
            method: metodo,
            headers: {
              cookie: `__Host-fp_sess=${segredoTitular}`,
              ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
              ...extra,
            },
            ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
            redirect: 'manual',
          }).then(lerResposta);

        const dpoReq = (metodo: string, caminho: string, corpo?: unknown) =>
          fetch(`${base}${caminho}`, {
            method: metodo,
            headers: {
              cookie: `__Host-fp_admin=${segredoDpo}`,
              origin: ADMIN_BASE_URL,
              'sec-fetch-site': 'same-origin',
              // Mutacoes do painel exigem JSON mesmo sem corpo (checkAdminMutation); GET nao.
              ...(metodo !== 'GET' ? { 'content-type': 'application/json' } : {}),
            },
            ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
            redirect: 'manual',
          }).then(lerResposta);

        // 0. Sem step-up, o pedido de acesso e recusado antes de qualquer efeito.
        const semStepUp = await titular(
          'POST',
          '/v1/privacy/dsr-requests',
          { kind: 'acesso', details: {} },
          {
            'idempotency-key': randomUUID(),
          },
        );
        expect(semStepUp.status).toBe(403);
        expect(semStepUp.corpo).toMatchObject({ code: 'step_up_obrigatorio' });

        // 1. Step-up: emite o codigo (202); o "e-mail" le o codigo pelo caminho do envio.
        const emitido = await titular(
          'POST',
          '/v1/privacy/step-up',
          {},
          { 'idempotency-key': randomUUID() },
        );
        expect(emitido.status).toBe(202);
        const { rows: codigos } = await c.query(
          'select id from app.dsr_step_up_code where user_id = $1 order by created_at desc limit 1',
          [sujeito],
        );
        expect(codigos.length).toBe(1);
        const codigo = await stepUp.codigoParaEnvio(codigos[0]?.id as string);
        expect(codigo).toMatch(/^\d{6}$/);

        // 2. Confirmacao do codigo: devolve o token de uso unico do step-up.
        const confirmado = await titular(
          'POST',
          '/v1/privacy/step-up/confirm',
          { code: codigo },
          {
            'idempotency-key': randomUUID(),
          },
        );
        expect(confirmado.status).toBe(200);
        const tokenStepUp = confirmado.corpo?.step_up_token;
        expect(typeof tokenStepUp).toBe('string');

        // 3. Pedido de acesso pela API do titular, com o token de step-up.
        const aberto = await titular(
          'POST',
          '/v1/privacy/dsr-requests',
          { kind: 'acesso', details: {}, step_up_token: tokenStepUp },
          { 'idempotency-key': randomUUID() },
        );
        expect(aberto.status).toBe(201);
        const caso = aberto.corpo?.id as string;
        expect(caso).toMatch(/^[0-9a-f-]{36}$/);

        // 4. DPO atribui o caso a si e processa pela API: o processamento de acesso gera o extrato.
        const atribuido = await dpoReq('POST', `/v1/admin/privacy/dsr-cases/${caso}/assign`, {
          assignee: dpo,
        });
        expect(atribuido.status, JSON.stringify(atribuido.corpo)).toBe(200);
        const processado = await dpoReq('POST', `/v1/admin/privacy/dsr-cases/${caso}/process`);
        expect(processado.status, JSON.stringify(processado.corpo)).toBe(200);
        expect(processado.corpo).toMatchObject({
          id: caso,
          status: 'concluido',
          outcome: 'extrato_disponibilizado',
        });
        expect(arquivos.mapa.size).toBe(1);

        // 5. Titular le o caso: o extrato traz um link de uso unico (download_url).
        const lido = await titular('GET', `/v1/privacy/dsr-requests/${caso}`);
        expect(lido.status).toBe(200);
        const extrato = lido.corpo?.extrato as { download_url?: string | null } | null | undefined;
        expect(typeof extrato?.download_url).toBe('string');
        const linkDownload = new URL(extrato!.download_url as string, base);
        const caminhoDownload = `${linkDownload.pathname}${linkDownload.search}`;

        // 6. Primeira baixa: entrega o extrato (200, JSON, anexo).
        const primeira = await fetch(`${base}${caminhoDownload}`, {
          headers: { cookie: `__Host-fp_sess=${segredoTitular}` },
        });
        expect(primeira.status).toBe(200);
        expect(primeira.headers.get('content-disposition')).toContain('attachment');
        const conteudo = JSON.parse(await primeira.text()) as Record<string, unknown>;
        expect(conteudo).toBeTypeOf('object');

        // 7. Segunda baixa do mesmo link: recusada (token de uso unico consumido).
        const segunda = await fetch(`${base}${caminhoDownload}`, {
          headers: { cookie: `__Host-fp_sess=${segredoTitular}` },
        });
        expect(segunda.status).toBe(404);
        expect(await segunda.json()).toMatchObject({ code: 'nao_encontrado' });
      } finally {
        if (servidor !== undefined) await new Promise<void>((ok) => servidor!.close(() => ok()));
        await c.query('rollback').catch(() => undefined);
        if (sujeito) {
          const { rows } = await c.query(
            'select count(*)::int as n from app.app_user where id = $1',
            [sujeito],
          );
          expect(rows[0]?.n).toBe(0);
        }
        await c.end();
      }
    }, 120_000);
  },
);
