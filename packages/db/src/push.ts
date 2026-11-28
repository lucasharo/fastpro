// Notificacoes push (2026-11-27): funcoes private.push_* (papel app_system). Erros nao carregam texto do driver.
import type { SqlClient } from './jobs-tick.js';

export type PlataformaPush = 'web' | 'android' | 'ios';

export interface AparelhoPush {
  readonly platform: PlataformaPush;
  /** web: endpoint da inscricao; android e ios: token do Expo. */
  readonly token: string;
  readonly p256dh: string | null;
  readonly auth: string | null;
}

export interface AlvoPush extends AparelhoPush {
  readonly emailType: string;
  readonly scopeKey: string;
}

export class PgPushStore {
  constructor(private readonly client: SqlClient) {}

  /** false quando a conta nao esta ativa. */
  async registrar(userId: string, a: AparelhoPush, agora: Date): Promise<boolean> {
    const r = await this.client.query('select private.push_device_register($1, $2, $3, $4, $5, $6) as ok', [
      userId,
      a.platform,
      a.token,
      a.p256dh,
      a.auth,
      agora,
    ]);
    return r.rows[0]?.ok === true;
  }

  async remover(userId: string, token: string): Promise<boolean> {
    const r = await this.client.query('select private.push_device_remove($1, $2) as ok', [userId, token]);
    return r.rows[0]?.ok === true;
  }

  async descartar(token: string): Promise<void> {
    await this.client.query('select private.push_device_discard($1)', [token]);
  }

  /** Profissionais que podem aceitar o pedido agora (mesma regra da descoberta), um alvo por aparelho. */
  async alvosDoPedidoNovo(requestId: string, agora: Date): Promise<(AparelhoPush & { readonly servico: string })[]> {
    const r = await this.client.query('select * from private.push_request_targets($1::uuid, $2)', [requestId, agora]);
    return r.rows.map((l) => ({
      servico: String(l.out_service_name),
      platform: String(l.out_platform) as PlataformaPush,
      token: String(l.out_token),
      p256dh: typeof l.out_p256dh === 'string' ? l.out_p256dh : null,
      auth: typeof l.out_auth === 'string' ? l.out_auth : null,
    }));
  }

  async alvosDoItem(itemId: string): Promise<AlvoPush[]> {
    const r = await this.client.query('select * from private.push_item_targets($1::uuid)', [itemId]);
    return r.rows.map((l) => ({
      emailType: String(l.out_email_type),
      scopeKey: String(l.out_scope_key),
      platform: String(l.out_platform) as PlataformaPush,
      token: String(l.out_token),
      p256dh: typeof l.out_p256dh === 'string' ? l.out_p256dh : null,
      auth: typeof l.out_auth === 'string' ? l.out_auth : null,
    }));
  }
}
