// Issue 52 (H-039, docs/factory/124-DESENHO-H039.md §4.5 e §5.2) | Leitor do documento para a Verificacao.
// Implementa IdentityDocReaderPort (packages/domain/src/identity-docs/ports.ts, sem alteracao). Construido por
// requisicao com o ator, o hash da sessao, o caso e o motivo fixo. Nenhum arquivo de identity-docs o importa.
// Ordem: a funcao do banco autoriza, trava e registra a leitura; o storage entrega os bytes; so entao o commit.
import type { IdentityDocReaderPort } from '@fastpro/domain';
import { VerificacaoErro, type ContextoAtor } from '@fastpro/domain';
import type { SqlClient } from '@fastpro/db';
import { traduzirErroVerificacao } from './pg-verification-case-store.js';
import type { TransacaoSql } from './pg-transacao.js';

/** Leitura do objeto final por chave (i/<id>). Devolve null se ausente; lanca em falha. */
export interface LeituraFinalStorage {
  lerBytes(chave: string, timeoutMs: number): Promise<Uint8Array | null>;
}

export const TEMPO_LIMITE_LEITURA_MS = 8000;

export interface LeitorRevisaoOpcoes {
  readonly transacao: TransacaoSql;
  readonly storage: LeituraFinalStorage;
  readonly ctx: ContextoAtor;
  readonly caseId: string;
  readonly motivo: string;
  readonly now: Date;
}

const SQL_ALVO =
  'select * from private.idoc_review_target($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::timestamptz)';

export class PgIdentityDocReviewReader implements IdentityDocReaderPort {
  constructor(private readonly opcoes: LeitorRevisaoOpcoes) {}

  async readForReview(id: string): Promise<{ readonly bytes: Uint8Array; readonly type: 'image/jpeg' | 'application/pdf' } | null> {
    const { transacao, storage, ctx, caseId, motivo, now } = this.opcoes;
    try {
      return await transacao.executar(async (cliente: SqlClient) => {
        const res = await cliente.query(SQL_ALVO, [
          ctx.actorId,
          ctx.sessionHash,
          caseId,
          id,
          motivo,
          now.toISOString(),
        ]);
        const alvo = res.rows[0];
        if (!alvo) return null;
        const bytes = await storage.lerBytes(`i/${String(alvo.out_id)}`, TEMPO_LIMITE_LEITURA_MS);
        if (bytes === null) throw new VerificacaoErro('documento_indisponivel');
        return { bytes, type: alvo.out_stored_type as 'image/jpeg' | 'application/pdf' };
      });
    } catch (err) {
      throw traduzirErroVerificacao(err);
    }
  }
}
