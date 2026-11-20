// H-099 (Issue 109) | Fixtures sinteticas dos lembretes de prazo e trial (docs/factory/163-DESENHO-H099.md §9).
// So dados sinteticos com o prefixo h099-. Os instantes sao sempre informados pelo chamador (relogio injetado);
// nenhuma funcao usa o relogio do sistema. Nenhum e-mail real: as fixtures so criam linhas no banco.
import { createHash, randomUUID } from 'node:crypto';

export const HORA_MS = 60 * 60 * 1000;
export const DIA_MS = 24 * HORA_MS;
export const MARCA = `h099-${randomUUID().slice(0, 8)}`;

const sha = (s) => createHash('sha256').update(s).digest('hex');
export const iso = (ms) => new Date(ms).toISOString();

/** Usuario sintetico. base = instante de criacao (relogio injetado). */
export async function usuario(c, base, status = 'ativo') {
  const id = randomUUID();
  await c.query(
    `insert into app.app_user (id, email, auth_user_id, status, email_verified_at, created_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [id, `${MARCA}-${id.slice(0, 8)}@example.test`, randomUUID(), status, iso(base)],
  );
  return id;
}

/** Profissional sintetico com perfil aprovado (base = instante de criacao). */
export async function profissional(c, base, status = 'ativo') {
  const id = await usuario(c, base, status);
  await c.query(
    `insert into app.professional_profile (user_id, verification_status, verified_at, created_at, updated_at)
     values ($1, 'aprovada', $2, $2, $2)`,
    [id, iso(base)],
  );
  return id;
}

/** Ponto de geocodificacao sintetico (exigido pelo gatilho de insercao do pedido). */
export async function ponto(c, base, sujeito) {
  const r = await c.query(
    `insert into app.geocode_point (subject_kind, subject_id, address_hash, state, exact_point, geocode_mode, precision, geocoded_at)
     values ('request', $1, $2, 'ok',
             extensions.st_setsrid(extensions.st_makepoint(-46.6333, -23.5505), 4326)::extensions.geography,
             'permanent', 'endereco', $3)
     returning id`,
    [sujeito, sha(`end-${randomUUID()}`), iso(base)],
  );
  return r.rows[0].id;
}

/** Servico ativo sintetico (grupo e servico proprios). */
export async function servico(c) {
  const grupo = randomUUID();
  const id = randomUUID();
  await c.query('insert into app.service_group (id, name, position, active) values ($1, $2, 1, true)', [
    grupo,
    `Grupo ${MARCA} ${grupo.slice(0, 6)}`,
  ]);
  await c.query(
    `insert into app.service (id, group_id, name, modality, regulated, active)
     values ($1, $2, $3, 'presencial', false, true)`,
    [id, grupo, `Servico ${MARCA} ${id.slice(0, 6)}`],
  );
  return id;
}

/** Rascunho de origem (exigido pelo pedido). Expira 7 dias depois de base. */
async function rascunho(c, svc, base) {
  const id = randomUUID();
  const email = `${MARCA}-rascunho-${id.slice(0, 8)}@example.test`;
  await c.query(
    `insert into app.request_draft (id, browser_nonce_hash, service_id, address_text, urgency, description, status,
                                    expires_at, ip_hmac, created_at, updated_at, first_name, email, email_hmac,
                                    email_verified_at, confirmed_at)
     values ($1, $2, $3, 'Rua sintetica 1', 'imediato', 'Descricao sintetica', 'aberto',
             $4, $5, $6, $6, 'Ana', $7, $8, $6, $6)`,
    [
      id,
      sha(`cookie-${id}`),
      svc,
      iso(base + 7 * DIA_MS),
      sha('ip-sintetico'),
      iso(base),
      email,
      sha(email),
    ],
  );
  return id;
}

/**
 * Pedido sintetico. O prazo e publicadoEm + 168 h (constraint service_request_prazo_168h).
 * status: 'publicado' por padrao; os outros estados sao gravados diretamente para testar a varredura.
 */
export async function pedido(c, { svc, base, publicadoEm, status = 'publicado', clienteStatus = 'ativo' }) {
  const cliente = await usuario(c, base, clienteStatus);
  const rasc = await rascunho(c, svc, base);
  const geo = await ponto(c, base, rasc);
  // O gatilho de insercao so aceita 'publicado' (requests_create_service_request §4a); outros estados entram por update.
  const r = await c.query(
    `insert into app.service_request (customer_user_id, service_id, status, urgency, description, address_text, first_name,
                                      geocode_point_id, origin_draft_id, published_at, acceptance_deadline_at)
     values ($1, $2, 'publicado', 'imediato', 'Descricao sintetica', 'Rua sintetica 1', 'Ana', $3, $4, $5::timestamptz,
             $5::timestamptz + interval '168 hours')
     returning id, acceptance_deadline_at`,
    [cliente, svc, geo, rasc, iso(publicadoEm)],
  );
  const id = r.rows[0].id;
  if (status !== 'publicado') {
    await c.query('update app.service_request set status = $2 where id = $1', [id, status]);
  }
  return { id, cliente, prazo: Date.parse(r.rows[0].acceptance_deadline_at) };
}

/**
 * Concessao de trial sintetica de 14 dias que termina em fimMs. status 'revogada' grava revoked_at.
 * Devolve o id da concessao e o id do profissional.
 */
export async function trial(c, { base, fimMs, status = 'ativa', profissionalId = null }) {
  const prof = profissionalId ?? (await profissional(c, base));
  const r = await c.query(
    `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status, revoked_at)
     values ($1, $2, 'trial', $3, $4, $5, $6)
     returning id`,
    [
      prof,
      randomUUID(),
      iso(fimMs - 14 * DIA_MS),
      iso(fimMs),
      status,
      status === 'revogada' ? iso(base) : null,
    ],
  );
  return { grantId: r.rows[0].id, professionalId: prof };
}
