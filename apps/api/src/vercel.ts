// H-009 | Entrada da funcao na Vercel. Le o segredo do ambiente a cada chamada (nunca grava valor).
// H-019 | As integracoes sao montadas a cada chamada pelo ponto de montagem (composicao.ts), so com as
// variaveis completas. Sem fabrica de pool, a busca de servico continua 404.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { metric, waitUntil } from '@vercel/functions';
import { handleRequest, routePath } from './app.js';
import { montarExecutorJobs, montarTickOportunista } from './jobs/executor-composicao.js';
import { montarIntegracoes, montarRetencaoAdmin } from './composicao.js';
import { abrirClienteSql, abrirConexaoDedicadaSql } from './sql-pool.js';
import { criarFabricaCatalogo } from './catalog/fabrica-pg.js';
import { abrirPoolCatalogo } from './catalog/pool-pg.js';
import { criarFabricaRascunho } from './drafts/compose.js';
// Issue 156 (F5b) | Sessao da funcao (conversao e logout): so monta com DATABASE_URL_APP_SYSTEM e SITE_URL.
import { montarSessao } from './session-composicao.js';
// H-025 (D-11) | Sugestao de endereco ligada ao rascunho real; so monta com as variaveis completas (sem elas, 404).
import { memoizarCliente, montarSugestaoEndereco } from './geo/composicao-sugestao.js';
import { montarAprovacaoDupla, montarCatalogoAdmin } from './admin-composicao.js';
// H-097 (Issue 107) | Pedido de login por link ou codigo; so monta com as variaveis existentes (sem elas, 404).
import { montarPedidoLogin } from './challenge-request-composicao.js';
// H-097 (Issue 107) | Consumo do link e verificacao do codigo; so montam com as variaveis existentes (sem elas, 404).
import { montarConsumoEVerificacao } from './modules/identity/consumo-link-composicao.js';
// H-016 | Cadastro, login, conta, recuperacao e troca de senha do profissional (so monta com as variaveis).
import { montarProfissional } from './professional-composicao.js';
// E3 (#141) | Midia: limite de reducoes e contadores (singletons de modulo, decisao 197 e desenho §2.3).
import { ReduceCounters } from './media/media-reduce-service.js';
import { ReduceGate } from './media/reduce-gate.js';

/** H-019: fabrica da busca de servico sobre o pool real (um pool por URL, reaproveitado entre chamadas). */
const fabricaCatalogo = criarFabricaCatalogo(abrirPoolCatalogo);
/** E3 (#141): um cliente do papel app_api por URL, compartilhado pelo rascunho e pela midia (um pool so). */
const abrirClienteApi = memoizarCliente(abrirClienteSql);
/** H-025: fabrica do rascunho sem conta sobre o papel app_api (um cliente SQL por URL, reaproveitado). */
const fabricaRascunho = criarFabricaRascunho(abrirClienteApi);
/** E3 (#141): limite de reducoes simultaneas e contadores da instancia, criados uma vez por modulo. */
const reducaoMidia = { gate: new ReduceGate(), contadores: new ReduceCounters() };
/** H-025 (D-11): cliente do papel app_system para a cota da sugestao (um por URL, reaproveitado). */
const abrirClienteSistema = memoizarCliente(abrirClienteSql);
/** Executor dos avisos (uma instancia por modulo) e o tick oportunista que roda depois das respostas. */
const executorJobs = montarExecutorJobs(process.env, { abrirConexaoDedicada: abrirConexaoDedicadaSql });
const tickOportunista = montarTickOportunista(executorJobs);

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // H-073: o pool do papel app_system so e aberto quando DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL existem.
    const integracoes = montarIntegracoes(process.env, { abrirClienteSql, abrirClienteApi, fabricaCatalogo, fabricaRascunho, reducaoMidia, abrirClienteSistema, abrirConexaoDedicada: abrirConexaoDedicadaSql, waitUntil });
    // H-107: gestao do catalogo admin; so monta com DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL (sem eles, 404).
    const adminCatalog = montarCatalogoAdmin(process.env, { abrirCliente: abrirClienteSql });
    // H-105: dupla aprovacao de estorno e suspensao; so monta com DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL (sem eles, 404).
    const dualApproval = montarAprovacaoDupla(process.env, { abrirCliente: abrirClienteSql });
    // H-109: cadastro de retencao; so monta com DATABASE_URL_APP_SYSTEM e ADMIN_BASE_URL (sem eles, 404).
    const adminRetention = montarRetencaoAdmin(process.env, { abrirCliente: abrirClienteSql });
    // H-097: pedido de login. waitUntil (pacote da plataforma) agenda o envio depois da resposta; sem contexto
    // da plataforma ele nao agenda nada e o envio segue pela contingencia do tick. Metrica so com codigo fixo.
    const pedidoLogin = montarPedidoLogin(process.env, {
      abrirCliente: abrirClienteSql,
      waitUntil,
      metrica: (nome, rotulos) => metric(nome, 1, rotulos),
    });
    const consumoLink = montarConsumoEVerificacao(process.env, { abrirCliente: abrirClienteSql });
    // H-025 (D-11): a sugestao usa a porta real do rascunho (createDraftGate) e a cota do app_system.
    const sugestao = montarSugestaoEndereco(process.env, {
      abrirCliente: abrirClienteSistema,
      rascunho: integracoes.drafts,
    });
    // H-016: cadastro, login, conta, recuperacao e troca de senha do profissional; so monta com as variaveis
    // completas (sem elas, 404). Usa o mesmo provedor de e-mail do login (decisao 55).
    const profissional = montarProfissional(process.env, { abrirCliente: abrirClienteSistema });
    const sessao = montarSessao(process.env, { abrirCliente: abrirClienteSistema });
    await handleRequest(req, res, {
      tickSecret: process.env.JOBS_TICK_SECRET,
      ...(sessao !== undefined ? { session: sessao } : {}),
      catalog: integracoes.catalog,
      ...(profissional.professional !== undefined ? { professional: profissional.professional } : {}),
      ...(profissional.professionalAccount !== undefined ? { professionalAccount: profissional.professionalAccount } : {}),
      ...(profissional.professionalRecovery !== undefined ? { professionalRecovery: profissional.professionalRecovery } : {}),
      ...(profissional.professionalPassword !== undefined ? { professionalPassword: profissional.professionalPassword } : {}),
      ...(sugestao !== undefined ? { geo: sugestao } : {}),
      ...(pedidoLogin.options !== undefined ? { challengeRequest: pedidoLogin.options } : {}),
      ...(consumoLink.consume !== undefined ? { consume: consumoLink.consume } : {}),
      ...(consumoLink.verify !== undefined ? { challengeVerify: consumoLink.verify } : {}),
      ...(adminCatalog !== undefined ? { adminCatalog } : {}),
      ...(dualApproval !== undefined ? { dualApproval } : {}),
      ...(adminRetention !== undefined ? { adminRetention } : {}),
      ...(integracoes.drafts !== undefined ? { drafts: integracoes.drafts } : {}),
      ...(integracoes.accessCase !== undefined ? { accessCase: integracoes.accessCase } : {}),
      ...(integracoes.adminStepUp !== undefined ? { adminStepUp: integracoes.adminStepUp } : {}),
      ...(integracoes.adminOps !== undefined ? { adminOps: integracoes.adminOps } : {}),
      ...(integracoes.professionalProfile !== undefined ? { professionalProfile: integracoes.professionalProfile } : {}),
      ...(integracoes.professionalVerification !== undefined ? { professionalVerification: integracoes.professionalVerification } : {}),
      ...(integracoes.professionalTrial !== undefined ? { professionalTrial: integracoes.professionalTrial } : {}),
      ...(integracoes.billing !== undefined ? { billing: integracoes.billing } : {}),
      ...(integracoes.billingService !== undefined ? { billingReconcile: integracoes.billingService } : {}),
      ...(integracoes.professionalOffering !== undefined ? { professionalOffering: integracoes.professionalOffering } : {}),
      ...(integracoes.media !== undefined ? { media: integracoes.media } : {}),
      ...(integracoes.identityDocs !== undefined ? { identityDocs: integracoes.identityDocs } : {}),
      ...(integracoes.requestPublish !== undefined ? { requestPublish: integracoes.requestPublish } : {}),
      ...(integracoes.requestContact !== undefined ? { requestContact: integracoes.requestContact } : {}),
      ...(integracoes.requestDetail !== undefined ? { requestDetail: integracoes.requestDetail } : {}),
      ...(integracoes.conversations !== undefined ? { conversations: integracoes.conversations } : {}),
      ...(integracoes.me !== undefined ? { me: integracoes.me } : {}),
      ...(integracoes.draftSession !== undefined ? { draftSession: integracoes.draftSession } : {}),
      ...(integracoes.adminCode !== undefined ? { adminCode: integracoes.adminCode } : {}),
      ...(integracoes.adminModeration !== undefined ? { adminModeration: integracoes.adminModeration } : {}),
      ...(integracoes.lifecycle !== undefined ? { lifecycle: integracoes.lifecycle } : {}),
      ...(integracoes.waves !== undefined ? { waves: integracoes.waves } : {}),
      ...(integracoes.reviews !== undefined ? { reviews: integracoes.reviews } : {}),
      ...(integracoes.publicProfile !== undefined ? { publicProfile: integracoes.publicProfile } : {}),
      ...(integracoes.requestList !== undefined ? { requestList: integracoes.requestList } : {}),
      ...(integracoes.requestDiscovery !== undefined ? { requestDiscovery: integracoes.requestDiscovery } : {}),
      ...(integracoes.privacyTitular !== undefined ? { privacyTitular: integracoes.privacyTitular } : {}),
      ...(integracoes.privacyDpo !== undefined ? { privacyDpo: integracoes.privacyDpo } : {}),
      ...(integracoes.requestAcceptance !== undefined ? { requestAcceptance: integracoes.requestAcceptance } : {}),
      ...(integracoes.photoView !== undefined ? { photoView: integracoes.photoView } : {}),
      ...(integracoes.watermarkedPhoto !== undefined ? { watermarkedPhoto: integracoes.watermarkedPhoto } : {}),
      ...(executorJobs !== undefined ? { jobs: executorJobs } : {}),
    });
    // Depois da resposta: processa avisos pendentes (no maximo uma vez por minuto por instancia).
    if (tickOportunista !== undefined) waitUntil(tickOportunista(routePath(req.url)));
  } catch {
    // Sem detalhe de erro na resposta nem no log (ADR-013: sem dado sensivel).
    if (!res.headersSent) {
      res.writeHead(500, { 'Cache-Control': 'no-store' });
    }
    res.end();
  }
}
