# Runbook de TTL dos expurgos operacionais (H-110, Issue #119)

- **Escopo:** valores de janela (TTL) do job `ops.purge`, chaves de `ops.app_config`, ordem de operação e pendências.
- **Entrada:** `105-DESENHO-H110.md` (§2, §3, §7), `103-REFINO-H110.md`, decisões 158 a 168 e 198 a 210 de `11-DECISOES.md`, `09-MODELO-DADOS.md` §10.
- **Estado:** migração `20261112230000_ops_create_operational_purge` com rollback. A migração **não semeia nenhum valor**. Sem chave, o bloco fica desligado (RN-H110-03).
- **Natureza dos valores:** todo valor abaixo é `[PROPOSTA]` do desenho. Só vira valor de produção depois de aprovação do dono do produto (e, onde indicado, de jurídico). Nenhum valor aqui é decisão aprovada.

## 1. Regras de leitura (como o banco interpreta cada chave)

1. A chave é lida de `ops.app_config` pela função `private.ops_purge_cfg(chave)`.
2. Ausente, não numérica (`jsonb` diferente de número) ou menor ou igual a zero = **bloco desligado**. O bloco devolve `desligado` e não remove nada.
3. Valor é em **segundos** (janelas de tempo) ou em **contagem** (limites), conforme a chave.
4. O TTL nunca expõe dado vivo: cada critério também exige o fim natural de vida (vencido, revogado, despachado, concluído, consumido). Um TTL errado só altera a espera depois desse fim.
5. Alterar uma chave muda o comportamento na execução seguinte, sem recriar função (CA-H110-13).

## 2. Chaves e valores propostos

| Bloco | Chave em `ops.app_config` | Valor proposto (segundos) | Origem |
|---|---|---|---|
| E1 quarentena de upload sem conclusão | `purge.quarantine_pending_seconds` | `86400` (24 h) | decisão 160 (Q3); também usada pelo E9 |
| E2 rascunho inativo | `purge.draft_inactive_seconds` | `2592000` (30 dias) | decisão 159 (Q2); foto de rascunho expirado sai junto (decisão 161, 200) |
| E3 desafio de autenticação | `purge.auth_challenge_seconds` | `86400` (24 h) | mantém o comportamento de H-011 |
| E4 sessão vencida | `purge.session_expired_seconds` | `604800` (7 dias) | decisão 202 (Q-A110-5) `[PROPOSTA]` |
| E4 sessão revogada | `purge.session_revoked_seconds` | `2592000` (30 dias) | decisão 168 (Q11) |
| E5 inbox de evento de provedor | `purge.provider_event_seconds` | `604800` (7 dias) | decisão 202 `[PROPOSTA]`; tabela ainda inexistente (bloco pulado) |
| E6a outbox de evento despachado | `purge.outbox_dispatched_seconds` | `604800` (7 dias) | decisão 202 `[PROPOSTA]` |
| E6b saída de e-mail | `purge.email_outbox_seconds` | `2592000` (30 dias) | decisão 202 `[PROPOSTA]`; decisão 166 inclui a tabela |
| E7 chave de idempotência | `purge.idempotency_seconds` | `172800` (48 h) | decisão 167 (Q10) e decisão 209 (Q-A110-12): **a confirmar com os prazos de reentrega dos provedores** |
| E8 registro de acesso a fotos (rollup) | `purge.media_access_rollup_after_seconds` | `86400` (rollup ligado) | decisão 158 (a) `[PROPOSTA]` |
| E8 registro de acesso a fotos (detalhe) | `purge.media_access_detail_seconds` | **não definir** (nulo) | decisão 158 (a): o detalhe só sai quando L1 (jurídico) definir o prazo |
| Limite por lote | `purge.batch_limit` | `500` (contagem) | `[PROPOSTA]`, não é prazo |
| Orçamento de tempo por execução | `purge.time_budget_ms` | `15000` (milissegundos) | `[PROPOSTA]`, sempre menor que o tempo máximo do tick |
| Teto de execuções por dia | `purge.max_runs_per_day` | `1` (contagem) | `[PROPOSTA]` |

Itens sem valor de TTL (não se define chave):
- **Desafio pendente vivo e terminal recente:** nunca saem (CA-H110-02).
- **Hold jurídico (`legal_hold`):** suspende o expurgo do dado com vínculo de sujeito (sessão, e-mail, evento de outbox). Rascunho, desafio, mídia e idempotência não têm vínculo de sujeito (decisão 199, Q-A110-2).
- **Rascunho com status `publicado`:** fica fora do expurgo até existir `service_request` (decisão 210, Q-A110-13).

## 3. Decisões que destravam valores ou comportamento

| Decisão | Assunto | Situação para o runbook |
|---|---|---|
| 158 (Q-H110-1) | Detalhe do registro de acesso a fotos | Só rollup agora. Detalhe fica nulo até L1 definir prazo. Alternativas registradas: remover em 90 dias, ou tirar do escopo. |
| 159 a 161 | Rascunho 30 dias; upload 24 h; foto de rascunho expirado junto | Valores acima. |
| 162 | RC-08 (logs do provedor) | Só documentado como configuração do provedor, sem código. |
| 163 | Hold suspende TTL técnico de todo dado do sujeito | Coberto pelo princípio do hold (ver seção 2). |
| 164 | Auditoria: um evento por execução | Implementado como contagem por execução, sem dado de sujeito. |
| 165 | Entrega parcial sem E1 até a #141 | E1 e E9 ficam atrás de portas, provados só com Storage fake até a #141 (decisão 208). |
| 166 | `email_outbox` entra no expurgo | Ver `purge.email_outbox_seconds`. |
| 167 / 209 | Idempotência 48 h | `[PROPOSTA]` a confirmar com provedores. |
| 168 | Sessão revogada 30 dias | Ver `purge.session_revoked_seconds`. |
| 198 | Valores ficam no runbook, não na migração | Migração sem semente de valor (conferido no SQL). |
| 199 | Hold só alcança dado com vínculo de sujeito | Previsto no desenho (CA-H110-10). |
| 200 | Foto de rascunho não publicado sai junto | Previsto no desenho (complementa 161). |
| 201 | Mídia pendente expirada é apagada | Previsto no desenho (como H-026). |
| 202 | TTL sem decisão anterior | Valores `[PROPOSTA]` da seção 2. |
| 203 | Um evento de auditoria por execução | Previsto no desenho (seção 6). |
| 204 | `pg_cron` em produção; disparo manual em desenvolvimento | Ver seção 4. |
| 205 | Sem métrica em `ops.ops_metric` | Só auditoria, previsto no desenho. |
| 206 | Acúmulos fora de escopo viram cartão E10 no Backlog | Cartão a criar no fechamento da #119. |
| 207 | `auth_challenge_purge` de H-011 continua em paralelo | Mantido. |
| 208 | Entrega parcial de E1 e E9 | Cartão de continuação a criar no fechamento. |
| 210 | Rascunho `publicado` fora do expurgo | Até existir `service_request`. |

## 4. Agendamento e disparo

1. **Produção:** a migração agenda `ops-purge-daily` (`23 3 * * *`, UTC) com `cron.schedule` **somente se** a extensão `pg_cron` estiver instalada. Confirmar a agenda antes de ligar qualquer valor de TTL em produção.
2. **Sem `pg_cron`** (ex.: banco local): o disparo é manual, chamando `private.ops_purge_enqueue(now())` pelo papel de execução, e a execução fica no tick da API (decisão 204).
3. **Condição de liberação de mídia:** a decisão 151 mantém a mídia fechada em produção até o expurgo agendado existir. Esse passo só fecha depois de agenda confirmada e de valores aprovados.

## 5. Como aplicar um valor (modelo; não executar em produção sem decisão)

Exemplo para um único valor. Substituir a chave e o número conforme a seção 2, já aprovados:

```sql
insert into ops.app_config (key, value, updated_by)
values ('purge.session_expired_seconds', '604800', 'runbook-108')
on conflict (key) do update
  set value = excluded.value,
      version = ops.app_config.version + 1,
      updated_by = excluded.updated_by,
      updated_at = now();
```

Para desligar um bloco, gravar valor `0` (menor ou igual a zero = desligado) ou remover a linha da chave. Não usar `null` para desligar: `null` não é número e também desliga, mas deixa o registro ambíguo.

A aplicação deve ser feita com a ferramenta de migração e de dados do projeto (`npx supabase`), nunca pelo MCP do Supabase. Desenvolvimento e produção seguem a mesma regra.

## 6. Verificação antes de ligar em produção

1. Conferir que cada chave aprovada aparece em `ops.app_config` com valor numérico positivo.
2. Conferir que `purge.media_access_detail_seconds` continua sem linha enquanto L1 não definir o prazo.
3. Conferir a agenda `ops-purge-daily` (`pg_cron` presente) ou o disparo manual documentado.
4. Rodar uma execução manual em ambiente de desenvolvimento e conferir o evento de auditoria (contagens, sem dado de sujeito).
5. Registrar valor, data e autor de cada alteração em `docs/factory/` do produto.

## 7. Pendências em aberto

- Confirmar 48 h da idempotência com os provedores (decisão 209).
- Definir prazo do detalhe de acesso a fotos (decisão 158, L1).
- Confirmar que a #141 entregue prova real de Storage para E1 e E9 (decisão 208). Até lá, a prova é só com Storage fake.
- Criar cartões de continuação e de acúmulos no fechamento da #119 (decisões 206 e 208).
