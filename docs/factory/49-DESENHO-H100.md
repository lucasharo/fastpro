# Desenho H-100 — Teste de ausência de interruptor de e-mail (Issue #110, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA. Sem dúvida bloqueante.
- **Rastro:** 48-REFINO-H100 (CA-H100-01..10, D-H100-1..6); 35-DESENHO-H092 (DD-7, CA-12, §5.1); 11-DECISOES (27, 15); `supabase/migrations/20261111120000_*`, `packages/db/src/notifications.ts`, `packages/email/src/{env,select}.ts`, `scripts/check-*.mjs`, `scripts/lib/files.mjs`.
- **Natureza:** SOMENTE documento. Nenhum código, migração ou teste foi criado.
- **Decisões do Orquestrador adotadas:** D-1 marco de vigência = 2026-11-11 (UTC); D-2 `EMAIL_PROVIDER` só aceita `resend`, nunca significa "não enviar"; D-3 "somente para a conta cadastrada" não vira flag, segue como trava de destinatário; D-4 documentos que citam o Mailpit são da #103 e não são alterados aqui.
- **Etiquetas:** `[VERIFICADO]` lido ou medido no repositório · `[PROPOSTA]` deste desenho.

## 0. Fatos [VERIFICADO]

1. O padrão de verificação do repositório é um script Node sem dependência (`scripts/check-*.mjs`) que usa `scripts/lib/files.mjs` (`git ls-files -co --exclude-standard`, logo nunca lê `.env.local`) e entra em `check:all`. Os testes dos scripts ficam em `scripts/__tests__/checks.test.mjs`, com repositório git temporário.
2. `check:all` hoje não roda `test:scripts`, `test` nem `db:test`.
3. Escritas em `ops.email_outbox`, `ops.notification_item` e `ops.notification_cooldown` existem só dentro de funções `private.notification_*`, `private.email_outbox_*` e `private.email_quota_*` das migrações `20261111120000` e `20261111130000`, e em testes `packages/db/tests/notifications*.dbtest.mjs`. O TypeScript de `src` não faz DML nelas.
4. `EMAIL_PROVIDERS = ['resend']` e `createEmailProvider` recusa qualquer outro valor (`email_provider_invalido`). Os tipos de job existentes são `outbox.dispatch`, `notification.flush`, `email.send`.
5. `dispatchOutbox` hoje NÃO tem o marco de vigência (CA-12 do H-092 ficou sem marco). Os testes do motor usam `occurred_at` de 2099, então o marco não os quebra.
6. Protótipo medido: a regra de nomes (§1.1), com as listas amplas abaixo, sobre os 179 arquivos de código, SQL e configuração fora de `docs/` e `scripts/`, deu **0 ocorrências**; e acusou `EMAIL_KILL_SWITCH`, `sendEnabled` e `emailEnabled` numa fixture. Sem falso positivo no código atual e sem lista de exceção.

## 1. O verificador [PROPOSTA]

**Arquivos:** `scripts/check-no-email-switch.mjs` (CLI), `scripts/lib/email-switch-rules.mjs` (função pura `scan(arquivos) → violações`, onde `arquivos` é um mapa caminho→texto). Node stdlib, sem dependência nova (D-H100-6).

**Escopo de varredura:** `apps/**`, `packages/**`, `supabase/**`, arquivos de configuração versionados na raiz e `.env.example`; extensões `ts tsx js jsx mjs cjs sql json toml yml yaml sh`. Fora: `docs/`, `scripts/`, `node_modules`, `dist`, `pnpm-lock.yaml`, `.github/`. `.env.local` nunca entra. Comentários (`//`, `/* */`, `--`) são removidos antes da busca; strings são mantidas.

**Saída:** cada violação sai como `caminho:linha regra: trecho (até 80 caracteres)`. O trecho é um identificador ou caminho, nunca valor de variável. Código de saída 1 se houver violação.

### 1.1 Regras

| Regra | CA | Onde procura | O que reprova |
|---|---|---|---|
| **N1 Nomes** | 01, 02, 03 | Todo identificador e todo literal-identificador (nomes de tabela, coluna, chave, constante, parâmetro, variável de ambiente, chave de config) | Identificador (palavras separadas por `_`, `-` ou camelCase) que junta uma palavra do **grupo E** e uma do **grupo S** na mesma palavra composta. **E:** `mail`, `email`, `notif*`, `notificacao`, `aviso`, `send*`, `envio`, `enviar`, `outbox`, `dispatch*`, `despach*`, `provider`, `resend`, `smtp`, `deliver*`, `entrega`, `mailer`. **S:** `enable*`, `disable*`, `switch`, `toggle*`, `flag(s)`, `kill`, `pause*`, `liga`, `desliga*`, `habilit*`, `desabilit*`, `ativ*`, `active`, `mute*`, `silenc*`, `dry`, `noop`, `off`, `stop`, `halt`, `suspend*`, `bypass`, `skip*`. Como a junção exige o mesmo identificador, `enable row level security`, `for update skip locked` e `outbox.dispatch` não disparam: **as exceções de RLS e janelas não precisam de lista**. |
| **N2 Flags genéricas** | 01 | Todo o escopo | `feature_flag(s)`, `featureFlag`; `create table` cujo nome contenha `flag`, `switch`, `toggle`; importação de `@vercel/flags`, `flags/next`, `@vercel/edge-config`, `launchdarkly`, `unleash`, `growthbook`, `posthog` (feature flags). |
| **C1 Chaves de config** | 02 | Literais `notification.*`, `email.*`, `mail.*`, `aviso.*` em TS e SQL (inclui semeadura de `ops.app_config`) | Aceitos só: os 3 tipos de job (C2) e chaves terminadas em `.window_seconds` ou `.limit`/`_limit` de cota. Qualquer outra chave com esses prefixos reprova. |
| **V1 Variável do provedor** | 03 | `packages/email/src/env.ts`, `.env.example`, todo uso de `EMAIL_PROVIDER` | (a) o array `EMAIL_PROVIDERS` deve conter só `resend`; (b) `EMAIL_PROVIDER` só pode ser lido em `packages/email/src/` (fora disso reprova); (c) `.env.example` aceita `EMAIL_PROVIDER=` vazio ou `resend`; (d) literal `off`, `none`, `disabled`, `noop`, `false`, `0`, `skip`, `dry-run` na mesma linha de `EMAIL_PROVIDER` reprova. Cobre D-2. |
| **V2 Adaptador mudo** | 03, 05 | Arquivos que não são teste (`*.test.*`, `*.dbtest.*`, `tests/`, `packages/testkit/`) | Uso dos identificadores `FakeEmailProvider`, `NoopEmailProvider`, `NullEmailProvider`, `ConsoleEmailProvider`, `LogEmailProvider`. Impede "desligar" trocando o adaptador por um que não envia. |
| **R1 Rotas e telas** | 04 | Caminhos de arquivo em `apps/*/src` (pastas e nomes de rota) e literais que começam com `/` em `apps/**` | Segmento que cumpre N1; segmento `backfill`, `retro*`, `reenvi*`, `replay`, `redispatch`, `unsubscribe`, `opt-out`, `descadastr*`; segmento de e-mail/notificação (`email`, `mail`, `notificacoes`, `avisos`) junto de `config`, `settings`, `preferenc*`, `ajustes`. Lista fixa de permitidos por caminho exato: `/v1/webhooks/resend` (H-093); painel somente leitura de cota (H-094/H-108) em caminho que não cumpra as regras acima. |
| **J1 Tipos de job** | 05 | Argumentos de `registry.register(`, `registerJobHandler(`, `job_enqueue(` e `kind:` | Tipo com prefixo `outbox.`, `notification.`, `email.`, `mail.`, `aviso.` fora do conjunto fechado {`outbox.dispatch`, `notification.flush`, `email.send`}; qualquer tipo com `backfill`, `retro`, `reenvi`, `replay`, `redispatch`. Os 3 tipos permitidos devem aparecer registrados (canário, §1.3). |
| **W1 Escrita em tabelas de envio** | 06 | SQL e TS | `insert into`, `update`, `delete from`, `merge into`, `truncate`, `copy` sobre `email_outbox`, `notification_item`, `notification_cooldown` (com ou sem `ops.`). Permitido só dentro de corpo `$$…$$` de função cujo nome comece por `private.notification_`, `private.email_outbox_` ou `private.email_quota_`, e em arquivos de teste (`packages/db/tests/`). DML fora de função em migração (nível raiz do script) reprova sempre: é backfill de envio. Em `rollbacks/` vale a mesma regra. A lista de permissões fica em constante no arquivo de regras e só o Reviewer a altera. |
| **M1 Marco imutável** | 07 | Constante `NOTIFICATION_EFFECTIVE_FROM` | Deve ser literal (`Date.UTC(2026, 10, 11)` ou `'2026-11-11T00:00:00.000Z'`); reprova se vier de `process.env`, `app_config` ou parâmetro. Marco não é flag. |

A regra de nomes N1 também cobre "tela de configuração" quando o nome do componente ou da pasta junta E e S. A restrição "somente para a conta cadastrada" (D-3) usa `RESEND_ACCOUNT_RECIPIENT`, que não cumpre N1 (não há palavra S) e permanece como trava de destino.

### 1.2 Mudança de código exigida por D-1 (para o DEV)

- `packages/domain/src/notifications/policy.ts`: `export const NOTIFICATION_EFFECTIVE_FROM_MS = Date.UTC(2026, 10, 11)` e o nome textual `NOTIFICATION_EFFECTIVE_FROM` para a regra M1.
- `dispatchOutbox` (`packages/db/src/notifications.ts`): antes de procurar regra, se `Date.parse(ev.occurredAt) < NOTIFICATION_EFFECTIVE_FROM_MS`, só `markDispatched(ev.id)` (sem `resolve`, sem item, sem linha, sem chamada). Nenhuma migração, nenhuma tabela, nenhum job novo.
- É a única alteração de comportamento de produção da H-100. O resto é verificação.

### 1.3 Falha fechada

O verificador também reprova quando: (a) varreu 0 arquivos; (b) um **canário de cobertura** não existe ou não contém o esperado: `packages/email/src/select.ts` (lê `EMAIL_PROVIDER`), a migração `20261111120000_notifications_create_pipeline.sql` (contém as tabelas de envio), `packages/db/src/notifications.ts` (registra os 3 tipos de job). Se alguém mover esses arquivos, o verificador acusa que ficou cego em vez de passar.

## 2. Autoteste com fixtures que devem falhar [PROPOSTA]

`node scripts/check-no-email-switch.mjs --selftest` monta fixtures em memória e chama `scan()`; sai com 1 se alguma fixture "ruim" não for acusada ou se a "limpa" for acusada. Roda **antes** da varredura real (se o autoteste falha, a varredura real nem conta como prova).

| Fixture | Conteúdo | Regra esperada |
|---|---|---|
| F-01 | migração `create table ops.email_flag (...)` | N1, N2 |
| F-02 | migração com coluna `email_enabled boolean` | N1 |
| F-03 | `insert into ops.app_config (key, value) values ('notification.email.enabled','false')` | C1, N1 |
| F-04 | `process.env.EMAIL_KILL_SWITCH` | N1 |
| F-05 | `const EMAIL_PROVIDERS = ['resend','off']` | V1 |
| F-06 | `const p = env.EMAIL_PROVIDER` em `apps/api/src/x.ts` | V1(b) |
| F-07 | `.env.example` com `EMAIL_PROVIDER=none` | V1(c) |
| F-08 | `new NoopEmailProvider()` em `apps/api/src/x.ts` | V2 |
| F-09 | arquivo `apps/web/src/app/admin/email/desligar/page.tsx` | R1, N1 |
| F-10 | rota `'/v1/admin/notificacoes/preferencias'` | R1 |
| F-11 | `registerJobHandler(registry, 'email.backfill', h)` | J1 |
| F-12 | `registerJobHandler(registry, 'notification.pause', h)` | J1, N1 |
| F-13 | migração com `insert into ops.email_outbox ... select ... from ops.outbox_event;` no nível raiz | W1 |
| F-14 | função `private.relatorio_x()` com `update ops.notification_item set ...` | W1 |
| F-15 | `export const NOTIFICATION_EFFECTIVE_FROM = Number(process.env.X)` | M1 |
| F-16 | conjunto vazio de arquivos e conjunto sem canários | falha fechada |
| F-L (limpa) | `alter table ops.email_outbox enable row level security;`, `registerJobHandler(registry,'email.send',h)`, chave `notification.accept.window_seconds`, `/v1/webhooks/resend`, função `private.notification_ingest` com `insert into ops.notification_item`, comentário `-- email_enabled` | **nenhuma** violação |

Complemento ponta a ponta: casos em `scripts/__tests__/checks.test.mjs` (repositório git temporário, mesmo padrão dos outros `check-*`) rodam o CLI real contra F-01, F-09, F-13 e F-L e conferem o código de saída.

**Contraprova de comportamento (CA-H100-07 e 08), fora do verificador estático:**

- T-H100-07 (`packages/db/tests/notifications-vigencia.dbtest.mjs`, `db:test`): evento `occurred_at = 2026-11-10T23:59:59Z` com regra registrada ⇒ `dispatched_at` preenchido, 0 `notification_item`, 0 `email_outbox`, 0 chamada ao `FakeEmailProvider`. Evento em `2026-11-11T00:00:00Z` ⇒ 1 item e 1 linha (limite exato).
- T-H100-08 (`db:test`): item válido, só credenciais e domínio de teste ⇒ `FakeEmailProvider` com exatamente 1 chamada.
- T-H100-08b (`packages/email/tests`, Vitest): `createEmailProvider` com `EMAIL_PROVIDER=resend` e transporte HTTP falso ⇒ exatamente 1 requisição; e, para `''`, `off`, `none`, `disabled`, `noop`, `false`, `0`, `mailpit`, lança `email_provider_invalido`. Prova que nenhum valor desliga o envio (D-2) e que o seletor não tem caminho mudo.

## 3. Execução local [PROPOSTA]

- `package.json`: `"check:email-switch": "node scripts/check-no-email-switch.mjs --selftest && node scripts/check-no-email-switch.mjs"` e inclusão de `pnpm check:email-switch` ao final de `check:all` (CA-H100-10).
- Evidência na Issue #110: comandos `corepack pnpm check:email-switch`, `corepack pnpm check:all`, `corepack pnpm test:scripts`, `corepack pnpm test`, `corepack pnpm db:test`, cada um com contagem e código de saída; mais a saída do `--selftest` (quantidade de fixtures acusadas). **GitHub Actions não é evidência** e não é alterado.
- Custo: leitura de ~180 arquivos, abaixo de 1 s, igual aos demais `check-*`.
- ESLint de scripts (`lint:scripts`) deve passar nos dois arquivos novos.

## 4. Riscos de falso positivo e de falso negativo

**Falso positivo (reprova sem ser interruptor)**

| # | Risco | Mitigação |
|---|---|---|
| FP-1 | História futura legítima usa `email_suppression.active`, `send_window` ou `notification_active` | Mede-se 0 hoje. Exceção só por nome exato em lista fixa no arquivo de regras, com justificativa; só o Reviewer altera. |
| FP-2 | Rota admin de leitura (painel de cota, fila) cai em R1 por conter `email` | R1 só reprova `email` junto de `config/settings/preferenc*/ajustes` ou de verbo S; painel somente leitura passa. Caminhos extras entram na lista de permitidos pelo Reviewer. |
| FP-3 | `replay` de idempotência (resposta repetida) | `replay` só é vedado em tipo de job, rota e identificador que cumpra grupo E. |
| FP-4 | Remoção de comentários errada (`//` dentro de URL ou `--` dentro de string) esconde ou inventa ocorrência | Remoção ciente de aspas simples e duplas e de blocos `$$`; fixture com URL `https://…` e string com `--` no autoteste. |
| FP-5 | `unsubscribe`/`opt-out` bloqueados atrapalham obrigação legal futura de descadastro | É escolha de produto: com envio sempre ligado (decisão 27) não há descadastro; se a lei exigir, exige nova decisão humana e mudança consciente na lista. |

**Falso negativo (passa sendo interruptor)**

| # | Risco | Mitigação |
|---|---|---|
| FN-1 | Interruptor com nome sem palavra E nem S (`MODE=quiet`, `X=1`) | Limite assumido da análise por nome. Defesas em camadas: V1/V2 (provedor), J1 (conjunto fechado de tipos), W1 (escrita só em funções permitidas), T-H100-08/08b (comportamento). |
| FN-2 | Nome montado em tempo de execução (`'EMAIL_' + 'KILL'`, `process.env[nome]`) | Não detectável estaticamente. O teste de comportamento 08/08b e a revisão de código cobrem; Reviewer confere acesso dinâmico a `process.env`. |
| FN-3 | Interruptor em dado, não em código (linha em tabela existente, `app_config` inserido manualmente) | C1 exige chaves de config fechadas no código e W1 proíbe DML de envio; inserção manual fora do repositório é operação humana, fora do alcance do verificador. |
| FN-4 | Interruptor fora do escopo (`docs/`, `.github/`, painel do Vercel/Supabase/Resend, variável só no ambiente de produção) | Documentos não são código (decisão do refino). Configuração externa fica sob BLQ-EXEC e revisão manual; declarado como limite. |
| FN-5 | Backfill feito por script avulso fora de `supabase/`, `apps/`, `packages/` | `scripts/` é excluído para não acusar o próprio verificador. Mitigação: W1 também varre `scripts/` exceto `scripts/check-no-email-switch.mjs`, `scripts/lib/email-switch-rules.mjs` e `scripts/__tests__/`. |
| FN-6 | Extensão não varrida (`.py`, `.cjs` incluído; `.txt`) | Lista de extensões revisada; arquivo versionado de extensão desconhecida dentro de `apps/`, `packages/`, `supabase/` gera aviso (não falha) com a contagem. |
| FN-7 | Marco (D-1) adulterado para a data futura ou passada | M1 exige literal; T-H100-07 testa o limite exato 2026-11-11T00:00:00Z. |
| FN-8 | Verificador desligado de `check:all` | Teste de `scripts/__tests__` confere que `package.json` contém `check:email-switch` dentro de `check:all`. |

## 5. Dúvidas ao Orquestrador (não bloqueantes)

1. **D-1 Marco como hora UTC 00:00 do dia 2026-11-11.** Se a intenção era a hora exata da decisão, avisar; o limite é uma constante. *Recomendação:* manter 00:00 UTC.
2. **D-2 Revisor da lista de permissões.** Permissões de escrita (W1) e exceções de nomes (N1) são do Reviewer. *Recomendação:* aceitar.
3. **D-3 `unsubscribe/opt-out` vedados** (FP-5). *Recomendação:* aceitar enquanto vigorar a decisão 27.

## Plano para o DEV

1. Constante e corte de vigência (§1.2) com T-H100-07.
2. `scripts/lib/email-switch-rules.mjs`, CLI, `--selftest` com F-01..F-L.
3. Casos em `scripts/__tests__/checks.test.mjs` e T-H100-08/08b.
4. `package.json` (`check:email-switch`, `check:all`); rodar §3 e registrar na Issue #110.

## Resumo em linguagem simples

Vamos criar uma conferência automática que falha se alguém colocar no sistema qualquer botão, chave ou atalho para desligar os e-mails ou reenviar avisos antigos, e que prova que ela mesma sabe falhar. Também fica combinado que avisos de antes de 11/11/2026 nunca são enviados e que o envio continua ligado; tudo roda aqui no computador, sem o GitHub Actions.
