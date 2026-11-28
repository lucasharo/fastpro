// Issue 55 (H-042) | Auxiliar unico de fixture: concessao de acesso vigente para profissional aprovado (docs/factory/142-DESENHO-H042.md, §9).
// Usado pelos testes da #45, da #46, da #36 e da guarda. So dados sinteticos; o chamador escolhe o instante (p_now).
import { randomUUID } from 'node:crypto';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Trial de 14 dias vigente no instante agora (comeca um dia antes). Identidade propria: trial e unico por identidade. */
export async function concederAcessoVigente(client, professionalId, agora) {
  const t = new Date(agora).getTime();
  await client.query(
    `insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
     values ($1, $2, 'trial', $3, $4, 'ativa')`,
    [professionalId, randomUUID(), new Date(t - DIA_MS).toISOString(), new Date(t + 13 * DIA_MS).toISOString()],
  );
}
