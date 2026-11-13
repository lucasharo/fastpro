// H-036 | Servicos, base e raio do perfil profissional (docs/factory/99-DESENHO-H036.md, §2, §4, §5; CA-01..CA-13).
//   GET /v1/professional/profile/services  200 {services:[{serviceId,name,regulated,active,modalities}]}
//   PUT /v1/professional/profile/services  200 {status:"saved"|"unchanged", services}; 422 validation; 403; 429
//   GET /v1/professional/profile/area      200 {configured:false} | {configured:true, addressLabel, radiusKm, since,
//                                          changesRemaining, nextChangeAt}
//   PUT /v1/professional/profile/area      200 {status:"definida"|"alterada"|"unchanged", area}; 422; 403; 409; 429; 503
// O perfil e sempre o da sessao: nenhuma rota recebe identificador de profissional (CA-11 por construcao).
// Ordem de PUT: Origin/Sec-Fetch-Site, corpo (teto de 8 KB), sessao, perfil (sem perfil e suspenso), formato,
// regra do banco. Erros tem so error, code, field e retryAfterS; nenhum eco do corpo, do endereco ou do raio.
// Nenhum log do corpo. Coordenada nunca sai: o ponto fica no banco e a resposta so traz rotulo, raio e datas.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  groupServiceRows,
  checkProfessionalAreaInput,
  checkProfessionalServicesInput,
  permanentAddressKey,
  servicesFieldFor,
  SESSION_COOKIE_NAME,
  cookieValue,
  siteOriginOf,
  type ServiceRow,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import { hashSessionSecret, type ProfessionalAreaView } from '@fastpro/db';
import type { EnsurePermanentOutcome } from './geo/permanent-geocode-service.js';

export const PROFESSIONAL_SERVICES_PATH = '/v1/professional/profile/services';
export const PROFESSIONAL_AREA_PATH = '/v1/professional/profile/area';

/** Teto de corpo desta familia de rotas (desenho §2). */
const CORPO_LIMITE = 8192;
/** Teto de seguranca no pre-filtro; o limite de servicos e o do banco (profile.offering_limits.services_max). */
const SERVICOS_PRE_FILTRO = 200;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export type ProfessionalOfferingStatus =
  | 'pendente'
  | 'em_revisao'
  | 'aprovada'
  | 'retida_duplicidade'
  | 'recusada'
  | 'suspensa';

/** Porta da oferta: a implementacao Pg (PgProfessionalOffering) cumpre este formato. */
export interface ProfessionalOfferingPort {
  profileStatus(userId: string): Promise<ProfessionalOfferingStatus | null>;
  areaGet(userId: string, nowMs: number): Promise<ProfessionalAreaView | null>;
  precheck(input: {
    readonly userId: string;
    readonly writeKey: string;
    readonly geocodeKey: string;
    readonly willGeocode: boolean;
    readonly nowMs: number;
  }): Promise<{
    readonly status: 'ok' | 'sem_perfil' | 'suspenso' | 'limite_escrita' | 'limite_mudanca' | 'limite_tentativas';
    readonly retryAfterS: number | null;
    readonly callsCap: number | null;
  }>;
  areaSave(input: {
    readonly userId: string;
    readonly pointId: string | null;
    readonly label: string | null;
    readonly radiusKm: number | null;
    readonly nowMs: number;
  }): Promise<{
    readonly status:
      | 'definida'
      | 'alterada'
      | 'unchanged'
      | 'sem_perfil'
      | 'suspenso'
      | 'limite_mudanca'
      | 'dados_incompletos'
      | 'ponto_invalido'
      | 'raio_invalido';
    readonly retryAfterS: number | null;
  }>;
  servicesSave(input: {
    readonly userId: string;
    readonly items: readonly { readonly serviceId: string; readonly modality: 'presencial' | 'online' }[];
    readonly writeKey: string;
    readonly nowMs: number;
  }): Promise<{
    readonly status:
      | 'saved'
      | 'unchanged'
      | 'sem_perfil'
      | 'suspenso'
      | 'formato'
      | 'servico_indisponivel'
      | 'modalidade_incompativel'
      | 'base_obrigatoria'
      | 'limite_servicos'
      | 'limite_escrita';
    readonly index: number | null;
    readonly retryAfterS: number | null;
  }>;
  servicesList(userId: string): Promise<ServiceRow[]>;
}

export interface ProfessionalOfferingRouteOptions {
  readonly sessions: SessionRepositoryPort;
  readonly offering: ProfessionalOfferingPort;
  /**
   * Coordenada permanente da base (ensurePermanentPoint ligado pela composicao). Recebe o teto de chamadas
   * do profissional (calls_cap). Nunca devolve coordenada para a rota: so o desfecho.
   */
  readonly locate: (input: {
    readonly userId: string;
    readonly addressText: string;
    readonly callsCap: number;
  }) => Promise<EnsurePermanentOutcome>;
  /** Chave HMAC (64 hex) dos baldes de limite de taxa; a composicao gera a partir de segredo do servidor. */
  readonly rateKey: (purpose: 'profile-write' | 'profile-geocode', userId: string) => string;
  /** SITE_URL: a origem dela e a unica aceita em Origin nas escritas. */
  readonly siteUrl: string;
  readonly clock: { nowMs(): number };
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function origemValida(req: IncomingMessage, siteOrigin: string): boolean {
  const origin = cabecalho(req.headers.origin);
  const fetchSite = cabecalho(req.headers['sec-fetch-site']);
  if (origin !== siteOrigin) return false;
  return fetchSite === undefined || fetchSite === 'same-origin';
}

type Corpo =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 | 415 };

function lerJson(req: IncomingMessage): Promise<Corpo> {
  return new Promise((resolve, reject) => {
    const tipo = req.headers['content-type'] ?? '';
    if (!/^application\/json\b/i.test(tipo)) {
      req.resume();
      resolve({ ok: false, status: 415 });
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= CORPO_LIMITE) partes.push(chunk);
    });
    req.on('end', () => {
      if (total > CORPO_LIMITE) return resolve({ ok: false, status: 413 });
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(partes).toString('utf8')) as unknown });
      } catch {
        resolve({ ok: false, status: 400 });
      }
    });
    req.on('error', reject);
  });
}

async function sessaoDoPedido(
  req: IncomingMessage,
  opts: ProfessionalOfferingRouteOptions,
): Promise<SessionRecord | null> {
  const segredo = cookieValue(cabecalho(req.headers.cookie), SESSION_COOKIE_NAME);
  if (segredo === undefined) return null;
  return opts.sessions.authenticate(hashSessionSecret(segredo), opts.clock.nowMs());
}

function enviar(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    ...NO_STORE,
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

/** Erro de regra com codigo fixo (sem detalhe tecnico). */
function erroRegra(res: ServerResponse, status: number, error: string, retryAfterS?: number | null): void {
  const body: Record<string, unknown> = { error };
  if (retryAfterS !== undefined && retryAfterS !== null) body.retryAfterS = retryAfterS;
  const extra: Record<string, string> =
    retryAfterS !== undefined && retryAfterS !== null ? { 'Retry-After': String(retryAfterS) } : {};
  enviar(res, status, body, extra);
}

/** 422 de validacao: `code` fixo e `field` com o nome do campo ou `services[i]`, nunca o valor. */
function erroValidacao(res: ServerResponse, code: string, field: string | null): void {
  enviar(res, 422, { error: 'validation', code, field });
}

function erroFormatoCorpo(res: ServerResponse, status: 400 | 413 | 415): void {
  const error = status === 415 ? 'tipo_invalido' : status === 413 ? 'corpo_grande' : 'json_invalido';
  enviar(res, status, { error });
}

/** Area como o dono ve (GET e retorno do PUT). Sem ponto, celula ou identificador. */
function visaoArea(area: ProfessionalAreaView | null): Record<string, unknown> {
  if (area === null) return { configured: false };
  return {
    configured: true,
    addressLabel: area.addressLabel,
    radiusKm: area.radiusKm,
    since: area.since,
    changesRemaining: area.changesRemaining,
    nextChangeAt: area.nextChangeAt,
  };
}

function falhaServico(res: ServerResponse): void {
  erroRegra(res, 503, 'servico_indisponivel');
}

async function perfilDoPedido(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProfessionalOfferingRouteOptions,
  { exigirAtivo }: { readonly exigirAtivo: boolean },
): Promise<{ readonly userId: string; readonly status: ProfessionalOfferingStatus } | null> {
  let sessao: SessionRecord | null;
  try {
    sessao = await sessaoDoPedido(req, opts);
  } catch {
    falhaServico(res);
    return null;
  }
  if (sessao === null) {
    erroRegra(res, 401, 'nao_autenticado');
    return null;
  }
  let status: ProfessionalOfferingStatus | null;
  try {
    status = await opts.offering.profileStatus(sessao.userId);
  } catch {
    falhaServico(res);
    return null;
  }
  if (status === null) {
    erroRegra(res, 403, 'sem_perfil');
    return null;
  }
  if (exigirAtivo && status === 'suspensa') {
    erroRegra(res, 403, 'perfil_suspenso');
    return null;
  }
  return { userId: sessao.userId, status };
}

// ---------------------------------------------------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------------------------------------------------

async function getServicos(req: IncomingMessage, res: ServerResponse, opts: ProfessionalOfferingRouteOptions) {
  const perfil = await perfilDoPedido(req, res, opts, { exigirAtivo: false });
  if (perfil === null) return;
  try {
    const linhas = await opts.offering.servicesList(perfil.userId);
    enviar(res, 200, { services: groupServiceRows(linhas) });
  } catch {
    falhaServico(res);
  }
}

async function putServicos(req: IncomingMessage, res: ServerResponse, opts: ProfessionalOfferingRouteOptions) {
  if (!origemValida(req, siteOriginOf(opts.siteUrl))) {
    enviar(res, 403, { error: 'origem_invalida' });
    return;
  }
  const corpo = await lerJson(req);
  if (!corpo.ok) return erroFormatoCorpo(res, corpo.status);

  const perfil = await perfilDoPedido(req, res, opts, { exigirAtivo: true });
  if (perfil === null) return;

  const entrada = checkProfessionalServicesInput(corpo.value, SERVICOS_PRE_FILTRO);
  if (!entrada.ok) {
    return erroValidacao(res, entrada.code, entrada.code === 'formato' ? servicesFieldFor(entrada.index) : null);
  }

  let out: Awaited<ReturnType<ProfessionalOfferingPort['servicesSave']>>;
  try {
    out = await opts.offering.servicesSave({
      userId: perfil.userId,
      items: entrada.items.map((i) => ({ serviceId: i.serviceId, modality: i.modality })),
      writeKey: opts.rateKey('profile-write', perfil.userId),
      nowMs: opts.clock.nowMs(),
    });
  } catch {
    return falhaServico(res);
  }

  switch (out.status) {
    case 'saved':
    case 'unchanged': {
      try {
        const linhas = await opts.offering.servicesList(perfil.userId);
        return enviar(res, 200, { status: out.status, services: groupServiceRows(linhas) });
      } catch {
        return falhaServico(res);
      }
    }
    case 'sem_perfil':
      return erroRegra(res, 403, 'sem_perfil');
    case 'suspenso':
      return erroRegra(res, 403, 'perfil_suspenso');
    case 'limite_escrita':
      return erroRegra(res, 429, 'limite_escrita', out.retryAfterS ?? 60);
    case 'limite_servicos':
      return erroValidacao(res, 'limite_servicos', null);
    case 'formato':
    case 'servico_indisponivel':
    case 'modalidade_incompativel':
    case 'base_obrigatoria': {
      // O banco devolve a posicao na lista expandida; o campo de erro usa o indice do servico no pedido.
      const item = out.index === null ? undefined : entrada.items[out.index];
      return erroValidacao(res, out.status, servicesFieldFor(item?.index));
    }
    default:
      return falhaServico(res);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Base e raio
// ---------------------------------------------------------------------------------------------------------------

async function getArea(req: IncomingMessage, res: ServerResponse, opts: ProfessionalOfferingRouteOptions) {
  const perfil = await perfilDoPedido(req, res, opts, { exigirAtivo: false });
  if (perfil === null) return;
  try {
    const area = await opts.offering.areaGet(perfil.userId, opts.clock.nowMs());
    enviar(res, 200, visaoArea(area));
  } catch {
    falhaServico(res);
  }
}

function chaveDoEndereco(texto: string): string | null {
  const k = permanentAddressKey(texto);
  return k.ok ? k.key : null;
}

async function putArea(req: IncomingMessage, res: ServerResponse, opts: ProfessionalOfferingRouteOptions) {
  if (!origemValida(req, siteOriginOf(opts.siteUrl))) {
    enviar(res, 403, { error: 'origem_invalida' });
    return;
  }
  const corpo = await lerJson(req);
  if (!corpo.ok) return erroFormatoCorpo(res, corpo.status);

  const perfil = await perfilDoPedido(req, res, opts, { exigirAtivo: true });
  if (perfil === null) return;

  const entrada = checkProfessionalAreaInput(corpo.value);
  if (!entrada.ok) {
    const campo = entrada.code === 'raio_invalido' ? 'radiusKm' : entrada.code === 'endereco_invalido' ? 'addressText' : null;
    return erroValidacao(res, entrada.code, campo);
  }

  const agora = opts.clock.nowMs();
  let atual: ProfessionalAreaView | null;
  try {
    atual = await opts.offering.areaGet(perfil.userId, agora);
  } catch {
    return falhaServico(res);
  }

  if (atual === null && (entrada.value.addressText === undefined || entrada.value.radiusKm === undefined)) {
    return erroValidacao(res, 'dados_incompletos', null);
  }

  // Igual ao atual (mesmo endereco pela chave e mesmo raio): sem geocodificar, sem contar limite, sem auditar.
  const chaveAtual = atual === null ? null : chaveDoEndereco(atual.addressLabel);
  const raioAtual = atual === null ? null : Math.round(atual.radiusKm);
  const enderecoMudou = entrada.value.addressKey !== undefined && entrada.value.addressKey !== chaveAtual;
  const raioMudou = entrada.value.radiusKm !== undefined && entrada.value.radiusKm !== raioAtual;
  if (atual !== null && !enderecoMudou && !raioMudou) {
    return enviar(res, 200, { status: 'unchanged', area: visaoArea(atual) });
  }

  let pre: Awaited<ReturnType<ProfessionalOfferingPort['precheck']>>;
  try {
    pre = await opts.offering.precheck({
      userId: perfil.userId,
      writeKey: opts.rateKey('profile-write', perfil.userId),
      geocodeKey: opts.rateKey('profile-geocode', perfil.userId),
      willGeocode: enderecoMudou,
      nowMs: agora,
    });
  } catch {
    return falhaServico(res);
  }
  switch (pre.status) {
    case 'ok':
      break;
    case 'sem_perfil':
      return erroRegra(res, 403, 'sem_perfil');
    case 'suspenso':
      return erroRegra(res, 403, 'perfil_suspenso');
    case 'limite_escrita':
      return erroRegra(res, 429, 'limite_escrita', pre.retryAfterS ?? 60);
    case 'limite_mudanca':
      return erroRegra(res, 429, 'limite_mudanca', pre.retryAfterS ?? 60);
    case 'limite_tentativas':
      return erroRegra(res, 429, 'limite_tentativas', pre.retryAfterS ?? 60);
    default:
      return falhaServico(res);
  }

  // Uma unica chamada permanente por base nova (CA-05). Sem retentativa. Desfechos viram codigos fixos.
  let pontoId: string | null = null;
  if (enderecoMudou) {
    const texto = entrada.value.addressText ?? '';
    let loc: EnsurePermanentOutcome;
    try {
      loc = await opts.locate({ userId: perfil.userId, addressText: texto, callsCap: pre.callsCap ?? 40 });
    } catch {
      return erroRegra(res, 503, 'geocodificacao_indisponivel');
    }
    switch (loc.status) {
      case 'ok':
        pontoId = loc.pointId;
        break;
      case 'endereco_nao_encontrado':
        return erroValidacao(res, 'endereco_nao_encontrado', 'addressText');
      case 'entrada_invalida':
        return erroValidacao(res, 'endereco_invalido', 'addressText');
      case 'em_andamento':
        return erroRegra(res, 409, 'em_andamento');
      case 'teto':
        return erroRegra(res, 429, 'limite_tentativas');
      default:
        return erroRegra(res, 503, 'geocodificacao_indisponivel');
    }
  }

  let salvo: Awaited<ReturnType<ProfessionalOfferingPort['areaSave']>>;
  try {
    salvo = await opts.offering.areaSave({
      userId: perfil.userId,
      pointId: pontoId,
      label: enderecoMudou ? (entrada.value.addressText ?? null) : null,
      radiusKm: entrada.value.radiusKm ?? null,
      nowMs: agora,
    });
  } catch {
    return falhaServico(res);
  }

  switch (salvo.status) {
    case 'definida':
    case 'alterada':
    case 'unchanged': {
      try {
        const area = await opts.offering.areaGet(perfil.userId, opts.clock.nowMs());
        return enviar(res, 200, { status: salvo.status, area: visaoArea(area) });
      } catch {
        return falhaServico(res);
      }
    }
    case 'sem_perfil':
      return erroRegra(res, 403, 'sem_perfil');
    case 'suspenso':
      return erroRegra(res, 403, 'perfil_suspenso');
    case 'limite_mudanca':
      return erroRegra(res, 429, 'limite_mudanca', salvo.retryAfterS ?? 60);
    case 'dados_incompletos':
      return erroValidacao(res, 'dados_incompletos', null);
    case 'raio_invalido':
      return erroValidacao(res, 'raio_invalido', 'radiusKm');
    case 'ponto_invalido':
      // Ponto de base recusado pelo banco (corrida ou dado inconsistente): texto unico, sem detalhe.
      return erroRegra(res, 503, 'geocodificacao_indisponivel');
    default:
      return falhaServico(res);
  }
}

/** Despacho das quatro rotas. Metodo fora de GET/PUT responde 405. */
export async function handleProfessionalOfferingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: ProfessionalOfferingRouteOptions,
): Promise<void> {
  const servicos = path === PROFESSIONAL_SERVICES_PATH;
  try {
    if (req.method === 'GET') {
      return servicos ? getServicos(req, res, opts) : getArea(req, res, opts);
    }
    if (req.method === 'PUT') {
      return servicos ? putServicos(req, res, opts) : putArea(req, res, opts);
    }
    enviar(res, 405, { error: 'metodo_nao_permitido' }, { Allow: 'GET, PUT' });
  } catch {
    // Erro inesperado: texto unico, sem detalhe. Nada do corpo ou do banco vai para a resposta nem para o registro de eventos.
    if (!res.headersSent) falhaServico(res);
  }
}
