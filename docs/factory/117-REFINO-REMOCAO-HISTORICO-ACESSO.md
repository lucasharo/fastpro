# 117 — Refino de Product Owner: remoção do histórico de acesso às fotos (Issue #150)

- **Issue:** #150 `[E6] Remover o histórico de acesso às fotos (media_access_log e resumo diário)`
- **Workflow:** WF-03, etapa Product Owner (refino). Não movimenta o quadro e não escreve código.
- **Data:** 2026-11-13
- **Entrada:** Rodada 67 de `11-DECISOES.md` (decisão do usuário, opção A, pergunta 158). A opção A substitui RF-030 e o critério do D10 no que exigem log de acesso por profissional.
- **EXEC-ID:** a registrar pelo Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão registrada · `[VERIFICADO]` lido em arquivo ou migração nesta leitura · `[PROPOSTA]` deste refino · `[NÃO VERIFICADO]` fora do alcance desta leitura.

---

## 1. Objetivo

Tirar do produto o registro de cada acesso a foto (`media_access_log`) e o resumo diário dele (`ops.media_access_daily`), porque o usuário não pediu esse histórico e ele consome banco. Manter a proteção contra raspagem por um caminho que não grave histórico de acesso.

## 2. Escopo

1. Remover, no código e nos testes ativos, toda a parte do expurgo que trata do acesso a fotos (bloco E8).
2. Criar uma migração nova (sem editar as antigas) que remove a função `ops_purge_media_access` e a tabela `ops.media_access_daily`, se existirem no DEV, e as duas chaves `purge.media_access_*` de configuração, se existirem.
3. Atualizar documentos ativos (PRD, critérios, arquitetura, modelo de dados, backlog, runbook, riscos, checklist) para descrever limite por contador e sinal de raspagem, sem log por acesso.
4. Definir a proteção contra raspagem sem histórico (seção 6), com critérios testáveis (seção 7).
5. Ajustar a lista de exceções do teste de backup (T-BK-09) para não citar mais `ops.media_access_daily`.

## 3. Fora de escopo

- **Não editar migrações antigas** (`20261112230000_ops_create_operational_purge.sql`, `20261113130000_ops_fix_purge_media_orfaos.sql`) nem seus rollbacks. A remoção entra só em migração nova.
- **Nenhuma outra tabela ou dado apagado.** Em especial: `audit_event`, `contact_reveal_log` (trilha de revelação de telefone e endereço, Issue #121), `app.media_asset`, fotos e documentos de verificação, sessões, rascunhos e demais dados de expurgo continuam como estão. A remoção toca só o que é do acesso a fotos.
- **Nenhuma rotação de senha.** A pergunta 150 segue pendente e não é tratada aqui.
- Nenhuma alteração no quadro (`quadro-status.md`), no GitHub, nem em código ou documento existente neste refino. Isso fica para as próximas etapas.
- Não há envio de e-mail. Não há Docker. A migração é aplicada com `npx supabase`, no banco de desenvolvimento.

---

## 4. Estado verificado antes da mudança

- `[VERIFICADO]` `ops.media_access_log` **nunca foi criada** em nenhuma migração. A busca textual confirma isso (`105-DESENHO-H110.md` §1 item 9 e `103-REFINO-H110.md` linha 38). O mesmo vale para `app.media_access_log`, que aparece só como ramo de contingência dentro da função.
- `[VERIFICADO]` `ops.media_access_daily` foi criada pela migração `20261112230000`, que já foi aplicada no DEV (cabeçalho de `20261113130000_ops_fix_purge_media_orfaos.sql`: "ja aplicada no DEV").
- `[VERIFICADO]` Como a origem nunca existiu, o bloco E8 sempre devolveu `pulado_ausente` (teste CA-H110-16). Por isso a tabela de resumo deve estar **vazia**. `[NÃO VERIFICADO]` no DEV: a contagem real precisa ser feita antes da migração (critério CA-H150-04).
- `[VERIFICADO]` O expurgo E8 não tem dado de produção. A remoção não apaga dado de uso real, apenas estrutura e código que nunca rodou de verdade.
- `[VERIFICADO]` `apps/` não tem nenhuma ocorrência de `media_access`, `ops_purge_media_access` nem de `log de acesso` a fotos.

---

## 5. Inventário por arquivo e ação proposta

Legenda das ações: **Remover** (apagar a parte), **Substituir** (trocar o texto por contador e sinal), **Nota** (manter o texto histórico e acrescentar nota de substituição), **Manter** (sem ação), **Criar** (arquivo novo), **Não editar** (migração ou rollback antigo).

### 5.1 Banco (migrações e rollbacks)

| Arquivo | Ocorrência | Ação |
|---|---|---|
| `supabase/migrations/20261112230000_ops_create_operational_purge.sql` | Cria `ops.media_access_daily` (linhas 8 a 22), revogações (19 a 20), função `ops_purge_media_access` (536 a 608) e concessão (683, 702) | **Não editar** |
| `supabase/migrations/20261113130000_ops_fix_purge_media_orfaos.sql` | Correção do E9, sem ocorrência de acesso | **Não editar** (sem ação) |
| `supabase/rollbacks/20261112230000_ops_create_operational_purge.down.sql` | Remove a função (linha 21) e a tabela só se vazia (54 a 57) | **Não editar** |
| `supabase/migrations/<novo prefixo>_ops_remove_media_access_history.sql` | Não existe | **Criar** (ver seção 5.4) |
| `supabase/rollbacks/<novo prefixo>_ops_remove_media_access_history.down.sql` | Não existe | **Criar** (ver seção 5.4) |

Prefixo: o último arquivo conhecido é `20261113130000`. O próximo livre deve ser conferido na listagem da pasta na etapa de Arquitetura `[NÃO VERIFICADO]` (exemplo: `20261113140000`).

### 5.2 Código e testes

| Arquivo | Ocorrência | Ação |
|---|---|---|
| `packages/db/src/ops-purge-jobs.ts` | Linha 3 (comentário "E2 a E8 são só SQL"); linha 136 (`blocoSql('e8', ..., 'ops_purge_media_access')`) | **Remover** o bloco E8; atualizar o comentário |
| `packages/db/src/ops-purge-store.ts` | Linha 39 (`'ops_purge_media_access'` no tipo de função) | **Remover** a entrada do tipo |
| `packages/domain/src/ops-purge/types.ts` | Linhas 4 e 5 (lista `BLOCOS_OPS_PURGE` com `'e8'`) | **Remover** `'e8'` da lista (ver pergunta 324 sobre renumeração) |
| `packages/domain/src/ops-purge/orquestra.ts` | Linha 2 (comentário "E1 a E9") | **Substituir** o comentário |
| `packages/domain/tests/ops-purge.test.ts` | Linha 39 (ordem "E1 a E9"); linhas 46 a 71 (usa `'e8'` como bloco de teste) | **Substituir** por ordem sem E8 e por outro bloco de teste |
| `packages/db/tests/ops-purge-migration.test.mjs` | Linha 37 (lista de funções com `ops_purge_media_access`); linhas 92 a 95 (RLS e revogação de `ops.media_access_daily`); linha 124 (criação idempotente da tabela); linhas 132 a 133 (rollback) | Testes estáticos da migração antiga **continuam válidos** (o arquivo não muda). **Substituir** a lista de funções ativas e **acrescentar** testes da migração nova |
| `packages/db/tests/ops-purge-h110.dbtest.mjs` | Linhas 160 a 161 (lista de funções); linhas 307 a 336 (CA-H110-09, rollup e detalhe); linhas 340 a 343 (parte E8 de CA-H110-16); linhas 347 a 352 (CA-H110-16b, contrato do E8); linha 441 (`has_table_privilege` em `ops.media_access_daily`) | **Remover** os testes de E8; **substituir** por teste de ausência (`to_regclass` nulo) e manter a parte de `provider_event` de CA-H110-16 |
| `packages/db/tests/backup-roles.dbtest.mjs` | Linhas 112 (comentário) e 124 (`'ops.media_access_daily'` na lista de exceções) | **Remover** a exceção. Coordenar com #145 (mesma lista) |
| `packages/db/tests/ops-purge-sem-prazo-fontes.test.mjs` | Lê a migração antiga e o rollback antigo | **Manter** (verificar que segue verde) |
| `packages/db/tests/ops-purge-adapters.test.ts` | Sem ocorrência de E8 | **Manter** |
| `apps/**` | Sem ocorrência | **Manter** |

### 5.3 Documentos ativos (texto de especificação)

| Arquivo | Linha(s) | Ocorrência | Ação |
|---|---|---|---|
| `docs/factory/04-PRD.md` | 153 | RF-030: "log de acesso por profissional" | **Substituir** por limite por contador e sinal de raspagem, sem log. Registrar supersessão pela Rodada 67 |
| `docs/factory/05-CRITERIOS-ACEITE.md` | 127 (FA-007, D10) | "o acesso é registrado em log por profissional" | **Substituir** por "é limitado (429) e o excesso gera sinal de raspagem, sem registro de cada acesso" |
| `docs/factory/08-ARQUITETURA.md` | 127 | Tabela de módulos: `media_asset, media_access_log` | **Remover** `media_access_log` |
| `docs/factory/08-ARQUITETURA.md` | 380 (§10.3) | "registro em `media_access_log` (profissional, foto, pedido, instante, resultado)" | **Substituir** por contador em `rate_counter` e sinal em `abuse_signal` (seção 6) |
| `docs/factory/09-MODELO-DADOS.md` | 109 (§3) | Definição da entidade `media_access_log` | **Remover** a definição |
| `docs/factory/09-MODELO-DADOS.md` | 211 e 218 (§7) | Coluna "Log de acesso": `media_access_log` na linha de fotos | **Substituir** por "—" na linha de fotos |
| `docs/factory/09-MODELO-DADOS.md` | 265 (§9) | Linha de capacidade de `media_access_log` | **Remover** a linha |
| `docs/factory/09-MODELO-DADOS.md` | 271 e 273 (§10) | Rollup e remoção de detalhe de `media_access_log` | **Remover** o trecho |
| `docs/factory/10-ADRS.md` | 113 (ADR-009, decisão) | "rate limit, log compacto e sinal de raspagem" | **Substituir** "log compacto" por "contador de limite" |
| `docs/factory/10-ADRS.md` | 196 | "rate limit por profissional" | **Manter** |
| `docs/factory/11-ARQ-RISCOS-E-TESTES.md` | 118 (matriz de endpoints) | "log de acesso; URL curta" | **Substituir** por "contador de limite; URL curta" |
| `docs/factory/11-ARQ-RISCOS-E-TESTES.md` | 193 (R-03) | Rate limit e sinal | **Manter** (já está correto) |
| `docs/factory/11-ARQ-RISCOS-E-TESTES.md` | 303 (T-07) | "rate limit/raspagem gera 429, log e sinal" | **Substituir** "log" por "contador" |
| `docs/factory/14-BACKLOG.md` | 175 (H-057) | "Limite de visualizações por profissional, log de acesso e sinal de raspagem"; "Excesso → 429 e registro" | **Substituir** (ver seção 5.5 sobre #70) |
| `docs/factory/14-BACKLOG.md` | 265 (H-110) | "rollup de `media_access_log`" | **Remover** o trecho |
| `docs/factory/14-BACKLOG.md` | 174 (H-056) | Sem log | **Manter** |
| `docs/factory/16-MANIFESTO-ISSUES.md` | 139 e 140 | Issues 67 e 68 com "429 e log por profissional" | **Substituir** o texto. Registrar divergência de numeração (ver seção 8, R-7) |
| `docs/factory/17-CHECKLIST-REVISAO.md` | 248 | "Rate limit de visualização por profissional, log de acesso e sinal de raspagem" | **Substituir** "log de acesso" por "contador de limite" |
| `docs/factory/103-REFINO-H110.md` | 12, 33, 69, 95 a 97, 113, 120, 126, 151, 153 a 154, 162 a 165 | Lista de dados técnicos, E8, RN-H110-09, F4, CA-H110-09, CA-H110-16, caso de borda 1, linha L1, sequência sugerida, pergunta Q-H110-1 | **Nota** de supersessão no topo. Não reescrever o histórico. Marcar Q-H110-1 como obsoleta |
| `docs/factory/105-DESENHO-H110.md` | 19, 55, 70, 77, 82, 116, 123 | Verificação de ausência, linha E8 da tabela, conteúdo da migração, rollback, CA-H110-09 e CA-H110-16 | **Nota** de supersessão no topo |
| `docs/factory/108-RUNBOOK-TTL-EXPURGOS.md` | 29, 30, 44, 94, 102 | Chaves `purge.media_access_*`, decisão 158 na tabela, conferência e pendência do prazo | **Remover** as linhas de chave e a pendência; **Nota** na decisão 158 |
| `docs/factory/11-DECISOES.md` | 11 (D10); 421 (pergunta 158); 682 (Rodada 67) | D10 cita "log de acesso por profissional"; 158 e Rodada 67 são o registro da decisão | **Nota** no D10 de que a Rodada 67 substitui o trecho de log. Não apagar histórico. Acrescentar as decisões adotadas da #150 ao final |

### 5.4 Documentos históricos (não reescrever; só nota, se necessário)

| Arquivo | Linha | Ação |
|---|---|---|
| `docs/factory/79-REFINO-H109.md` | 39, 43 | Refino de Issue concluída (#118). **Manter**; a remoção do log não altera o refino de H-109 |
| `docs/factory/22-REFINO-H006.md` | 43 | Histórico de H-006. **Manter** |
| `docs/factory/87-REFINO-H026.md` | 75 | Histórico de H-026. **Manter** (aponta para H-056 e H-057) |
| `docs/factory/112-TRIAGEM-DBTEST-LINHA-DE-BASE.md` | 249 | Registro do commit 37a666b. **Manter**; nota opcional de que a exceção foi removida |
| `docs/factory/102-REFINO-MIDIA-COMPOSICAO.md` | 87 | "visualização por profissional" continua válido com contador. **Manter** |
| `docs/factory/quadro-status.md` e `quadro-dados.js` | títulos de #69, #70, #150, #119 | **Manter** nesta etapa. O quadro é atualizado nas próximas etapas, e `quadro-dados.js` deve ser regenerado, não editado à mão |

### 5.5 Migração nova (conteúdo proposto, sem escrever o arquivo agora)

1. `drop function if exists private.ops_purge_media_access(timestamptz, integer);`
2. Contagem de `ops.media_access_daily` com `raise notice` (só o número, sem identificador de sujeito), para a evidência da execução.
3. `drop table if exists ops.media_access_daily;`
4. `delete from ops.app_config where key in ('purge.media_access_rollup_after_seconds', 'purge.media_access_detail_seconds');` (pergunta 325)
5. Nenhum `create`, nenhum `grant`, nenhum `insert`. Nenhuma tabela de domínio é tocada.
6. Sem `if exists` nas origens que nunca existiram: a migração não depende delas.

Rollback proposto (`*.down.sql`): recria a tabela `ops.media_access_daily` vazia com as mesmas colunas e restrições, e informa que a função antiga não é restaurada por este arquivo (ela está na migração `20261112230000`, que continua no histórico). Dados removidos não voltam.

---

## 6. Proteção contra raspagem sem histórico de acesso

O D10 pede limite de uso e sinal de raspagem. Sem o histórico, a proteção passa a usar contadores agregados e não registros por acesso.

### 6.1 Proposta recomendada: opção A

| Mecanismo | Como funciona | Dado gravado | Estado |
|---|---|---|---|
| URL assinada de curta duração | Entrega de foto por URL de cerca de 60 s, de uso único, vinculada a profissional, foto e sessão (08 §10.3) | Nenhum (assinatura calculada na hora) | `[PROPOSTA]` herdada de H-056 (#69) |
| Marca d'água opaca | Identificador curto do profissional sobre a versão reduzida; permite atribuir um vazamento depois | Nenhum | `[DECIDIDO]` D10 |
| Limite de taxa por profissional | Contador por minuto e por dia de visualizações, em `rate_counter` (ADR-014, só Postgres) | Contador agregado, sem linha por acesso | `[PROPOSTA]` valores iniciais a calibrar; `rate_counter` `[NÃO VERIFICADO]` no schema atual |
| Excesso | Resposta 429 e uma linha em `abuse_signal` **somente quando o limite estoura** (não em cada acesso) | Um sinal por janela estourada | `[PROPOSTA]` |
| Sinal persistente | Vários sinais em janela curta ⇒ suspensão cautelar **só do acesso a fotos** e fila humana; sem banimento automático | Flag de suspensão e fila de revisão | `[DECIDIDO]` D10 (suspensão cautelar) e `[PROPOSTA]` números |
| Cabeçalhos | `Cache-Control: private, no-store` na entrega | Nenhum | `[DECIDIDO]` 08 §10.3 |

### 6.2 Alternativas

- **B (não recomendada sem nova decisão):** opção A mais um resumo diário por profissional. Volta a ser histórico, conflita com a opção A da pergunta 158 e com a remoção do resumo.
- **C (mínima):** só URL curta e marca d'água, sem contador. Mais simples, mas não atende RF-030 em "detecção de raspagem" e deixa o volume sem limite.

### 6.3 O que se perde com a opção A

1. Consultar **quem viu qual foto e quando** (por foto, por dia, por hora).
2. Prova por registro para o cliente ou para o Suporte sobre um acesso específico.
3. Detectar padrão de raspagem **além da janela** do contador (por exemplo, um profissional que raspa uma vez por semana).
4. Reconstruir um incidente de vazamento pelo histórico de acessos. Fica só a marca d'água.

Mitigação: a marca d'água permite atribuir o vazamento de uma imagem ao profissional; o limite de taxa e o sinal cobrem o volume anômalo. A trilha de revelação de telefone e endereço (`contact_reveal_log`, #121) é outro registro e continua existindo.

---

## 7. Critérios de aceite (testáveis)

Todos são `[PROPOSTA]`, salvo nota. Valores numéricos de limite são `[PROPOSTA]` a calibrar.

- **CA-H150-01** Dado o repositório após a entrega, quando se busca `media_access_log`, `media_access_daily`, `ops_purge_media_access` e "log de acesso" a fotos em código, testes, migrações novas e documentos ativos, então as únicas ocorrências são as da lista de exceções (migrações e rollbacks antigos, documentos históricos da seção 5.4). *Teste: busca textual, como CA-H109-11.*
- **CA-H150-02** Dado o banco de desenvolvimento após `npx supabase` aplicar a migração nova, quando se consulta `to_regclass('ops.media_access_daily')` e `pg_proc` por `ops_purge_media_access`, então ambos são nulos ou vazios. *Teste: db-test.*
- **CA-H150-03** Dado a migração nova aplicada duas vezes, quando roda a segunda vez, então não há erro e o estado final é o mesmo. *Teste: db-test.*
- **CA-H150-04** Dado o banco de desenvolvimento antes da migração, quando se conta `ops.media_access_daily`, então o número é registrado na Issue (esperado zero). Antes e depois da migração, a contagem de linhas de todas as **outras** tabelas do esquema `ops`, `app` e `audit` é igual. *Teste: consulta registrada antes e depois.*
- **CA-H150-05** Dado que `ops.media_access_log` e `app.media_access_log` não existem, quando a migração roda, então não há erro (não há `drop` nessas origens). *Teste: db-test.*
- **CA-H150-06** Dado a migração aplicada, quando se consulta `ops.app_config`, então não há chave `purge.media_access_*` (se a pergunta 325 for adotada). *Teste: db-test.*
- **CA-H150-07** Dado o job de expurgo, quando roda, então executa os blocos E1 a E7 e E9 na ordem certa, sem bloco de acesso, e a auditoria `ops.purge.executed` não traz contagem de acesso. *Teste: domínio e db.*
- **CA-H150-08** Dado os testes de expurgo, quando rodam, então CA-H110-09 e a parte E8 de CA-H110-16 foram substituídas por teste de ausência, e a parte de `provider_event` de CA-H110-16 continua verde. *Teste: db:test local.*
- **CA-H150-09** Dado um profissional que passa do limite de visualizações na janela, quando pede mais fotos, então recebe 429, nenhuma linha por acesso é gravada (verificado por contagem de tabelas) e é gravado um sinal de raspagem uma única vez por janela estourada. *Teste: API e db.*
- **CA-H150-10** Dado um profissional abaixo do limite, quando pede fotos, então recebe a foto normalmente e nenhum sinal é gravado. *Teste: API.*
- **CA-H150-11** Dado sinal persistente (valor de janela `[PROPOSTA]`), quando é atingido, então só o acesso a fotos fica suspenso, a conta continua ativa, e a volta exige revisão humana; não há banimento automático. *Teste: db e API.*
- **CA-H150-12** Dado a entrega de foto, quando a URL é usada uma vez e depois de 60 s, então a segunda tentativa é negada. *Herdado de #69 (H-056). Teste de API.*
- **CA-H150-13** Dado o teste de backup, quando roda, então `ops.media_access_daily` não está mais na lista de exceções, e as demais exceções não mudam. *Teste: db:test (T-BK-09).*
- **CA-H150-14** Dado os documentos ativos (04, 05, 08, 09, 10, 11, 14, 16, 17, 103, 105, 108), quando revisados, então RF-030, o critério de FA-007 sobre raspagem, H-057 e §10.3 descrevem contador e sinal, sem log por acesso. *Teste: revisão documental.*
- **CA-H150-15** Dado o registro de decisões, quando lido, então há entrada da #150 com a proteção adotada e o número da pergunta, e o D10 tem nota de substituição. *Teste: revisão documental.*
- **CA-H150-16** Dado o arquivo de desfazer, quando lido, então ele recria só a estrutura vazia e não promete restaurar dados. *Teste estático, como CA-H110 de rollback.*
- **CA-H150-17** Dado a entrega, quando comparada com a referência, então as migrações `20261112230000` e `20261113130000` e seus rollbacks estão byte a byte iguais. *Teste: comparação de hash com o commit de referência.*
- **CA-H150-18** Dado a entrega, quando rodada localmente, então `corepack pnpm check:all`, `db:test`, `lint`, `typecheck` e `test` terminam com código 0, e o resultado (comando, contagem, código de saída) é registrado na Issue. Nenhum CI verde é declarado sem a execução local.

---

## 8. Riscos

1. **Dados no DEV (baixo):** a tabela de resumo deve estar vazia, porque a origem nunca existiu. Confirmar por contagem (CA-H150-04) antes de aplicar. A remoção é autorizada pela Rodada 67, mesmo se houver linhas.
2. **Ordem de migrações (baixo):** a migração nova só pode ser aplicada depois de `20261112230000`, que já está no DEV. A ordem vem do prefixo de data.
3. **Rollback não restaura dados (informativo):** aceito. O arquivo de desfazer recria só a estrutura.
4. **Lista de exceções do backup (médio):** `ops.media_access_daily` aparece em `backup-roles.dbtest.mjs` (linha 124) e em `112-TRIAGEM` (linha 249). Uma lista velha esconde decisões futuras. Remover a entrada e coordenar com #145, que mexe na mesma lista e no mesmo teste.
5. **Proteção mais fraca (médio, aceito):** sem histórico, não há prova por foto e por dia. A detecção depende do contador. Registrar no RF-030 e no R-03.
6. **Pedido de auditoria de acesso (médio, jurídico):** RC-07 (logs de acesso a dados sensíveis) está `[PENDENTE JURÍDICO]` com L1. A decisão 158 já é do usuário, mas o registro jurídico deve citar a remoção do log de fotos (pergunta 328).
7. **Divergência de numeração (baixo):** `16-MANIFESTO-ISSUES.md` usa 67 e 68 para H-056 e H-057. O quadro usa #69 e #70. Este refino usa o quadro. Corrigir no manifesto em etapa própria.
8. **Concorrência de arquivos (médio):** #140 (triagem do db:test, em Desenvolvimento) e #145 (exceções do backup, em Backlog) mexem em arquivos de teste que #150 também altera. Não rodar #150 em paralelo sobre esses arquivos. Isso não bloqueia nenhuma Issue em andamento; só define a ordem.
9. **Valores de limite (médio):** os números do contador são `[PROPOSTA]` e não foram calibrados. `rate_counter` `[NÃO VERIFICADO]` no schema atual.
10. **Concluído da #119 (informativo):** a #119 está em Concluído. A remoção do bloco E8 muda o escopo dela. Concluído é decisão humana (pergunta 323).

---

## 9. Dependências e impacto nas Issues

| Issue | Estado no quadro | Impacto | Ação |
|---|---|---|---|
| **#69** (H-056, fotos a elegíveis com marca d'água) | Backlog | Os critérios de URL de 60 s, marca d'água e não download **não usam** log (`14-BACKLOG` linha 174, `05` linha 126). | **Não depende da #150.** Pode seguir na ordem do quadro. Só retirar qualquer menção a registro, se houver |
| **#70** (H-057, limite de visualização e sinal de raspagem) | Backlog | Título e critérios usam "log de acesso" e "Excesso → 429 e registro" (`14-BACKLOG` linha 175). Depende da proteção definida aqui. | **Depende da #150.** O refino da #70 só começa depois que a proteção desta #150 for adotada |
| **#119** (H-110, expurgos) | Concluído | Bloco E8, RN-H110-09, CA-H110-09 e a parte E8 do CA-H110-16 ficam sem objeto. O CA-H110-16 continua valendo para `provider_event` | Manter Concluído com nota de substituição (pergunta 323). A #150 entrega a remoção |
| **#115** (E12, estorno e chargeback) | Backlog | Sem ocorrência (busca) | Sem impacto |
| **#121** (H-112, trilha de revelação) | Backlog | Usa `contact_reveal_log` (outro registro, RF-016/138/139). Não é o log de fotos | Sem impacto. Não generalizar a remoção a esse registro |
| **#140** (triagem do db:test) | Desenvolvimento | Mexe em testes de expurgo e backup; arquivos em comum | Não bloqueia. Ordenar: não rodar #150 em paralelo sobre os mesmos arquivos |
| **#145** (exceções do backup, T-BK-09) | Backlog | Mesma lista de exceções | Coordenar a remoção de `ops.media_access_daily` com #145. Não bloqueia |
| **#44** (publicação) | Desenvolvimento | Sem ocorrência | Sem impacto |

Não há Issue em andamento que esta mudança bloqueie. Nenhuma Issue é marcada como bloqueada por esta etapa.

---

## 10. Perguntas ao líder (numeração a partir de 320)

Estas dúvidas são do refino. O líder consolida na lista única da sessão. Cada item traz a recomendação e o que destrava. Itens com recomendação clara entram como "adotada pelo líder" e vão para a lista de veto, sem exigir resposta.

**320 — Contador de visualização por profissional.** É o limite de quantas fotos um profissional pode ver por minuto e por dia, guardado só como número, sem uma linha por acesso.
- Opções: (a) contador em `rate_counter` por minuto e por dia; (b) contador mais resumo diário por profissional; (c) sem contador.
- **Recomendação: (a).** Mantém a detecção sem histórico. (b) volta ao que a pergunta 158 removeu. (c) não cobre volume.
- Destrava: critérios CA-H150-09 e CA-H150-10 e o texto de RF-030.

**321 — Sinal de raspagem.** É o registro gravado quando o limite estoura.
- Opções: (a) um sinal por janela estourada, em `abuse_signal`; (b) um sinal a cada acesso negado; (c) nenhum sinal, só 429.
- **Recomendação: (a).** Dá sinal sem gravar cada acesso. (b) recria o histórico. (c) não permite revisão humana.
- Destrava: CA-H150-09 e a fila de revisão.

**322 — Suspensão cautelar do acesso a fotos.** É a medida tomada quando o sinal se repete.
- Opções: (a) automática, por flag, com revisão humana para voltar; (b) só manual pelo Suporte; (c) automática e permanente.
- **Recomendação: (a).** Protege sem banir a conta. (b) demora. (c) é mais dura que a decisão D10, que fala em "cautelar".
- Destrava: CA-H150-11 e o texto de H-057.

**323 — Destino da #119 (Concluído).** A #119 tem um bloco que esta #150 remove.
- Opções: (a) manter Concluído com nota de substituição; (b) reabrir a #119 para a remoção; (c) criar só a #150.
- **Recomendação: (a).** A #150 faz a remoção. Reabrir só por decisão humana, porque Concluído é decisão do usuário.
- Destrava: seção 9 e a nota da #119. **Observação:** se o usuário quiser reabrir, é decisão dele, não do líder.

**324 — Nome dos blocos no código.** Depois de tirar E8, o bloco E9 mantém letra ou vira E8?
- Opções: (a) manter E9 e deixar E8 como removido; (b) renumerar para E8; (c) renumerar tudo.
- **Recomendação: (a).** Evita mudança em auditoria e em documentos que citam E9.
- Destrava: `types.ts`, `orquestra.ts` e os testes de domínio.

**325 — Chaves de configuração do acesso a fotos no banco de desenvolvimento.** As chaves `purge.media_access_*` podem existir em `ops.app_config`.
- Opções: (a) apagar as duas chaves na migração nova; (b) deixar as chaves sem uso; (c) apagar pelo runbook, fora da migração.
- **Recomendação: (a).** São configuração de um recurso removido, não dado de usuário. Fica no mesmo arquivo e é desfeito pelo rollback.
- Destrava: CA-H150-06 e a seção 5.5, item 4.

**326 — Arquivo de desfazer da remoção.** O rollback pode recriar a estrutura vazia.
- Opções: (a) recriar só a estrutura vazia; (b) sem rollback, com nota; (c) recriar também a função antiga.
- **Recomendação: (a).** Segue a convenção de rollbacks do projeto sem copiar código antigo. (c) duplica código que a remoção quer tirar.
- Destrava: CA-H150-16.

**327 — Lista de exceções do backup (T-BK-09).** A remoção de `ops.media_access_daily` pode ser feita nesta #150 ou na #145.
- Opções: (a) nesta #150; (b) na #145; (c) nas duas, com a mesma mudança.
- **Recomendação: (a).** Remove a entrada junto com a tabela. A #145 continua tratando de `app.media_asset`.
- Destrava: CA-H150-13 e a ordem com #145.

**328 — Jurídico (RC-07, pendente com L1).** A remoção do log de acesso a fotos pode conflitar com obrigação de guardar logs de acesso a dados sensíveis.
- Opções: (a) seguir a decisão 158 (opção A) e registrar a remoção no pedido jurídico; (b) esperar o L1; (c) manter um log mínimo.
- **Recomendação: (a).** O usuário já decidiu a remoção. Registrar no pedido de L1 para ele confirmar. (b) trava a #150 sem necessidade. (c) volta ao histórico.
- Destrava: a conferência de RC-07 e a revisão jurídica. **Atenção:** é item de jurídico, por isso vai ao usuário junto com a lista de decisões.

### Lista de veto (adotadas pelo líder, sem resposta necessária)

- Contagem de `ops.media_access_daily` no DEV antes da migração, registrada na Issue (CA-H150-04).
- Migração nova em `supabase/migrations`, sem editar migrações antigas nem rollbacks antigos.
- Aplicação com `npx supabase` no DEV, sem Docker e sem MCP do Supabase.
- Nenhuma outra tabela, dado ou senha afetados.
- Proteção por URL de 60 s, marca d'água e contador, como seção 6.1.
- Atualização de RF-030 e do critério de FA-007 com contador e sinal.
- Nota de supersessão na Rodada 67 e no D10, sem apagar histórico.
- Documentos históricos (79, 22, 87, 112, 102) sem reescrever.
- `quadro-dados.js` regenerado, não editado à mão.

---

## 11. Próximas etapas (fora deste refino)

1. Product Owner: a #150 fica em "Product Owner" até o líder registrar as decisões 320 a 328 em `11-DECISOES.md` e a Issue ser refinada no quadro.
2. Arquitetura: confirmar o prefixo livre da migração, a forma do contador em `rate_counter` e o `abuse_signal`, e o desenho do rollback.
3. Desenvolvimento: remover o bloco, criar a migração e o rollback, substituir os testes, rodar local (`corepack pnpm check:all`, `db:test`, `lint`, `typecheck`, `test`) e registrar a evidência na Issue.
4. Code Review, QA e Aguardando aprovação, nesta ordem, com um especialista por vez na Issue.
