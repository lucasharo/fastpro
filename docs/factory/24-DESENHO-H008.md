# Desenho técnico H-008 — Tick de jobs (Issue #21, WF-03, Arquitetura)

Decisão: **APROVADO_ARQUITETURA** (com 3 dúvidas não bloqueantes na §9).
Rastro: `spikes/S-10-RESULTADO.md` (decisão A + C, B em reserva, D só keep-alive); 19 §3.1 item 0.10 e S-10; 08 §16.2 e ADR-018; 14 H-008 (Q-14, F-08, C-13, R-30, R-38); 17 §2.1 (B-03, B-06, B-12), §4.2 (extensão com fallback documentado, B-52) e §4.8 (Infra); 11 (C-13, F-08, Q-09, Q-14). Padrões reaproveitados: migrações `20261110120000` (papéis, esquemas, revoke), `20261110130000` (`ops.job`, `private.job_claim/job_complete/job_fail`, só `app_system` executa) e `20261110140000` (SECURITY DEFINER com `search_path` vazio).

Tags: **[VERIFICADO]** lido no repositório ou medido no S-10; **[PROPOSTA]** valor inicial a medir; **[NÃO VERIFICADO]** depende de autorização ou de execução ainda não feita (§8).

## 0. Resumo do desenho

- Um único ponto de entrada de execução: `TickService.run(origem)`, usado por três chamadores: **A** (pg_cron + pg_net, via `POST /internal/jobs/tick`), **C** (oportunista, dentro da API, sem rede) e **D** (cron diário da Vercel, só como passagem extra no keep-alive de H-010). B (agendador externo) não é implementado; como o endpoint é o mesmo, B seria só configuração.
- Exclusão mútua não depende de quem chamou: é do banco (`job_claim`, `FOR UPDATE SKIP LOCKED` + lease). Nenhum chamador "sabe" se os outros existem.
- O banco só **dispara** (cron + `net.http_post`); quem **executa** é a API. A agenda e o segredo ficam no banco (migração + Vault); o comando agendado é uma chamada fixa a uma função e não contém segredo.
- Fora do escopo da H-008: handlers de negócio (lembrete, digest, flush de e-mail, reconciliação). Cada história de consumo (H-092, H-053 etc.) registra seu handler por `kind`. A H-008 entrega o mecanismo, um handler `tick.probe` (medição) e os testes.

## 1. Fluxos

### 1.1 Tick A (principal)

```
pg_cron (a cada minuto, :00)
  └─ select private.jobs_tick_dispatch()          -- dono postgres, SECURITY DEFINER
       ├─ lê no Vault: jobs_tick_url, jobs_tick_secret
       │    └─ se faltar um dos dois: retorna sem chamar nada (no-op, sem erro)
       └─ net.http_post(url, '{}', '{}', {Authorization: Bearer <segredo>}, timeout 30000)
            (assíncrono: pg_net envia depois do COMMIT)
                │
                ▼
POST /internal/jobs/tick  (Vercel, função única)
  └─ autentica (§4) → TickService.run('a')
```

### 1.2 Tick C (oportunista)

```
qualquer requisição à API (exceto /health, /internal/*)
  └─ resposta é enviada primeiro
  └─ depois (waitUntil) → OpportunisticTick.maybeRun()
       ├─ se agora − ultimaTentativa < 60 s nesta instância: sai (memória, só para não repetir)
       ├─ se já há tick rodando nesta instância: sai
       ├─ ultimaTentativa = agora
       └─ TickService.run('c')         -- try/catch total: nunca afeta a requisição de origem
```

### 1.3 `TickService.run(origem)` (igual para A, C e D)

1. `owner = "tick-<origem>:<id da instância>"` (`id` = UUID aleatório gerado no start do processo; ≤ 100 caracteres; sem PII).
2. Laço enquanto houver orçamento: `private.job_claim(owner, null, 60, 5)` numa transação curta (`lock_timeout 3 s`, `statement_timeout 10 s`), que **confirma** o lease e libera a conexão. Para o laço quando a reivindicação volta vazia ou o orçamento de início de novos jobs (20 s [PROPOSTA]) acaba.
3. Para cada job devolvido: procura o handler registrado para `job.kind`; executa fora de transação de claim, com timeout de 30 s (menor que o lease de 60 s).
4. Sucesso: `job_complete(id, owner)`. Falha ou exceção: `job_fail(id, owner, <código curto>, retry)` com `retry = min(60·2^(attempts−1), 3600)` s (o `attempts` vem na própria linha reivindicada). `kind` sem handler: `job_fail` com código `kind_desconhecido`. O código é uma enumeração fixa (nome da classe do erro ou rótulo), **nunca** `error.message` (evita PII; `last_error` ≤ 100 caracteres, já limitado pela tabela).
5. Se `job_complete`/`job_fail` devolver `false` (lease perdido): contar `lease_perdido` e seguir; o efeito do handler já aconteceu, por isso handlers são idempotentes (§1.5).
6. Retorna apenas contadores: `{reivindicados, concluidos, falhos, lease_perdido, ms}`.

### 1.4 Por que A e C juntos não duplicam execução [VERIFICADO na migração H-005]

- `job_claim` seleciona candidatos com `FOR UPDATE SKIP LOCKED` e, na mesma instrução, muda para `em_execucao` com `lease_owner/lease_until` e `attempts+1`. Dois ticks simultâneos (A e C, ou dois C em instâncias diferentes) recebem **conjuntos disjuntos**; o perdedor da corrida recebe vazio ou outros jobs.
- Job em execução com lease válido não é candidato. Só volta a ser candidato quando `lease_until < clock_timestamp()` (instância dormiu, caiu ou excedeu o tempo, F-08). O dono antigo, ao tentar `job_complete`, recebe `false`.
- Garantia honesta: **exclusão por lease, não exatamente-uma-vez**. Após lease vencido o mesmo job pode rodar de novo (até `max_attempts`, depois vira `falha`). Por isso o handler tem de ser idempotente por `dedupe_key` do efeito (ex.: `email_outbox.dedupe_key`, C-13) e revalidar o estado antes de agir ("resumo obsoleto não sai"). Isto é requisito de revisão de cada handler.
- Defesa em profundidade na instância: um único tick por vez por processo (trava em memória) para não consumir duas conexões do pooler. É otimização; a correção vem do banco.
- Regras de tempo coerentes: handler 30 s < lease 60 s < intervalo do cron 60 s. Handler que precisar de mais tempo deve ser quebrado em jobs menores (não há renovação de lease na H-005; não criar agora).

### 1.5 Contrato de handler (interface da H-008 para as outras histórias)

`registerJobHandler(kind, { run(job): Promise<void> })` no módulo `jobs`. `job` expõe `id`, `kind`, `payload_ref`, `attempts`. O handler recebe referência, nunca PII. Registrar dois handlers para o mesmo `kind` falha no boot. Efeitos de domínio e auditoria seguem as regras de cada história (mesma transação, I-15).

## 2. Instalação de `pg_cron` e `pg_net`

Arquivo novo: `supabase/migrations/20261110160000_platform_enable_job_tick.sql` (idempotente; rollback manual em `supabase/rollbacks/20261110160000_platform_enable_job_tick.down.sql`).

Ordem dentro da migração:

1. `create extension if not exists pg_net with schema extensions;` [S-10 mostrou que sem `with schema` ele cai em `public`]. `create extension if not exists pg_cron with schema extensions;`: tentar; se o PostgreSQL recusar por a extensão não ser relocável, usar o padrão (S-10 mediu `pg_catalog`) e registrar o resultado no PR. O que importa é que os objetos vivem nos esquemas `cron` e `net` (criados pelas extensões), e esses é que são protegidos.
2. **Revoke depois do create**, na mesma migração (a plataforma e a extensão concedem acesso ao criar; revogar antes não vale):
   - `revoke all on schema cron, net from public, anon, authenticated, service_role, app_api, app_system;`
   - `revoke all on all tables, all sequences, all functions in schema cron, net from` os mesmos papéis. O `cron.job` e o `cron.job_run_details` costumam ter `SELECT` para PUBLIC e o `net.*` costuma ter `USAGE/EXECUTE` para `anon/authenticated/service_role` [NÃO VERIFICADO o conjunto exato; o teste da §7 é o que prova].
   - Sem `alter default privileges` nesses esquemas (são de posse da extensão/plataforma); o teste de catálogo detecta regrant em atualização futura.
3. Função `private.jobs_tick_dispatch()` (§3), `revoke all ... from public, anon, authenticated, service_role, app_api, app_system` (o cron roda como dono, `postgres`, e não precisa de grant).
4. Função `private.jobs_tick_status()` (somente leitura, SECURITY DEFINER, `search_path` vazio, só `app_system`): devolve `{cron_instalado, job_ativo, ultima_execucao, ultimo_status}` lendo `cron.job` e `cron.job_run_details`, sem comando nem segredo. Serve ao teste, ao monitor e à medição.
5. Agenda (idempotente, `cron.schedule` por nome faz upsert):
   - `cron.schedule('jobs-tick', '* * * * *', 'select private.jobs_tick_dispatch()')`
   - `cron.schedule('cron-purge', '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$)`. Motivo: 1.440 linhas/dia em `job_run_details` contam nos 500 MB (Q-04); `net._http_response` já tem retenção curta própria [NÃO VERIFICADO o TTL no Free].
6. Registro em `ops.schema_migration` é feito pelo executor, não pela migração.

Decisões e alternativas:

- **Migração estrita** (falha se a extensão não puder ser criada) em vez de tolerante (pular silenciosamente). Motivo: pular em silêncio deixaria o ambiente sem tick A sem que ninguém saiba. O tick C mantém o sistema andando mesmo assim, e o teste `jobs_tick_status` cobre o monitoramento. R-38 está reduzido a baixo pela execução do S-10.
- Rollback `down` (manual, só em dev, sem `CASCADE`): `cron.unschedule('jobs-tick')` e `('cron-purge')` protegidos por `if exists`, `drop function` das duas funções, `drop extension pg_net`, `drop extension pg_cron`, `delete from ops.schema_migration`.
- Proibido: nada de `cron.schedule` com comando contendo URL ou segredo, nem agenda criada por código de aplicação (o app não tem privilégio em `cron.*`).

## 3. Segredo do tick no Vault

- Dois segredos no Vault (`supabase_vault`, schema `vault`): `jobs_tick_secret` (valor aleatório de ≥ 256 bits) e `jobs_tick_url` (URL completa do endpoint daquele ambiente). A URL vai ao Vault porque varia por ambiente e só será conhecida com o S-09; a migração fica igual em todos.
- **Criação é passo manual do operador**, fora do Git e fora de chat/log: `select vault.create_secret(<valor>, 'jobs_tick_secret', ...)` no editor SQL do Supabase; o mesmo valor entra como `JOBS_TICK_SECRET` (variável de servidor, marcada sensível) no projeto Vercel da API. Rotação: gerar novo valor, atualizar Vercel e redeploy, depois `vault.update_secret`. Na janela entre os dois passos o tick A responde 401 e o tick C cobre.
- `private.jobs_tick_dispatch()` (sem argumentos, SECURITY DEFINER, `search_path = ''`, dono `postgres`):
  - lê `vault.decrypted_secrets` por nome; se faltar qualquer um, `return null` (no-op);
  - valida que a URL casa `^https://[^[:space:]]+/internal/jobs/tick$` (o caminho fixo impede que a função sirva de SSRF genérico mesmo se o Vault for alterado);
  - chama `net.http_post(url := ..., body := '{}'::jsonb, headers := jsonb_build_object('Authorization', 'Bearer ' || segredo, 'Content-Type', 'application/json'), timeout_milliseconds := 30000)`;
  - nunca usa `raise` com valores, nunca grava o segredo em tabela; devolve só o id do pedido.
- Onde o segredo **não** pode aparecer: `cron.job.command` (é só `select private.jobs_tick_dispatch()`), migrações, `.env.example` (só o nome já existe), logs, corpo da requisição, `net._http_response`. Observação: o cabeçalho fica transitoriamente em `net.http_request_queue` até o envio; por isso o `revoke` de `net.*` é obrigatório (S10-3, S10-4).
- `vault.secrets`/`vault.decrypted_secrets` não podem ser lidos por `anon`, `authenticated`, `service_role`, `app_api`, `app_system`. Se a plataforma conceder e o papel de migração não puder revogar (objetos de posse de outro papel), é achado a escalar ao Orquestrador [NÃO VERIFICADO].
- Segurança por camada: a função só consegue chamar o endpoint fixo; o endpoint exige o segredo; o segredo só existe no Vault e no ambiente da Vercel.

## 4. Endpoint `POST /internal/jobs/tick`

**Autenticação**
- Único método aceito: `POST`. Qualquer outro método ou caminho vizinho: 404 sem corpo útil.
- Cabeçalho `Authorization: Bearer <segredo>`. Nunca por query string nem cookie.
- Comparação em tempo constante: SHA-256 dos dois lados e `crypto.timingSafeEqual`. Segredo ausente no ambiente, vazio ou com menos de 32 caracteres: o endpoint **nega tudo** (fecha por padrão) e registra o erro de configuração uma vez por processo.
- Resposta de negação sempre idêntica: 401, sem corpo útil, sem distinguir "faltou" de "errado" de "não configurado". Sem limite de taxa por IP (custaria banco; o segredo de 256 bits torna força bruta inviável); contador de log `tick_auth_falha` sem IP.
- Não aceita `CRON_SECRET`; este é só do keep-alive (H-010), rota separada.
- Fora do prefixo público `/v1`, fora do contrato OpenAPI e do pacote `contracts`, sem CORS, sem sessão, sem `withPrincipal`. `Cache-Control: no-store`. O reescrito `/api/*` do web (08 §16.10) **não** deve encaminhar `/internal/*`; o tick A chama o domínio da API diretamente [NÃO VERIFICADO a topologia, S-09].

**O que faz**
- Ignora o corpo (limite de 1 KB) e qualquer parâmetro. Executa `TickService.run('a')` e responde 200 `{ok:true, reivindicados, concluidos, falhos, lease_perdido, ms}`.
- Banco indisponível (inclui projeto pausado): responde 503 `{ok:false}`; o `pg_net` ignora e o minuto seguinte tenta de novo.
- Usa a conexão e o papel `app_system` do pool de sistema (o mesmo do tick C), em transação própria, separada de qualquer requisição de usuário.
- Registra por log permitido (allowlist de H-007): origem, contadores, duração. Sem `kind` com identificadores, sem `payload_ref`.

**O que nunca faz**
- Não deixa o chamador escolher job, `kind`, handler, SQL ou URL.
- Não cria, altera nem remove agenda de cron, extensão ou segredo.
- Não devolve nem registra PII, `payload_ref`, `last_error` detalhado nem lista de jobs.
- Não faz chamada de rede por conta própria (só handlers, via portas, e nunca em teste real).
- Não usa `service_role`, chave do Supabase nem papel de usuário; não toca login, aceite, mensagem automática ou webhook (esses não dependem do tick, 08 §16.2).
- Não executa lógica de negócio dentro do endpoint; só reivindica e despacha.
- Não retém trabalho além do orçamento; não aceita ser chamado por `GET` (efeito colateral em GET seria vetor de prefetch/CSRF).

## 5. Tick C sem `pg_cron`

- O código da API **não referencia** `cron.*`, `net.*` nem `vault.*`; usa apenas `ops.job` e as quatro funções `private.job_*` já existentes. Logo, ausência, remoção, pausa ou falha do `pg_cron`/`pg_net` não muda o caminho do C.
- Execução: somente com tráfego. Com a regra de 1 tentativa por minuto por instância, a latência dos jobs é "até o próximo request depois de `run_at`, mais até 1 min". Sem tráfego não há tick; o cron diário (D) dá uma passagem extra por dia (±59 min). Lembretes T-24h e digest podem atrasar horas nesse cenário (aceito no início, medido em Q-09/Q-14).
- Implementação do gatilho C (módulo `jobs`, camada neutra de framework): função `afterResponse(req)` que o adaptador HTTP (Nest) chama depois de responder. Rodar depois da resposta com `waitUntil` do ambiente Vercel quando disponível; sem ele (local), `setImmediate`. Nunca `await` dentro do caminho da requisição. [NÃO VERIFICADO: `waitUntil` na topologia final, S-09.]
- Regras do C: sai se a requisição for `/health` ou `/internal/*`; throttle de 60 s por instância em memória (contador de 1/min); falha de banco ou de handler é engolida e registrada; após falhas seguidas faz recuo (60 s, 120 s, ... até 15 min) por instância para não martelar o banco pausado; nunca propaga exceção.
- Custo quando o A está saudável: no máximo uma reivindicação vazia por minuto por instância ativa (consulta pelo índice `job_state_run_at_idx`). Sem dependência de A para funcionar; A e C não precisam saber um do outro.
- Teste local sem Docker: como o banco de desenvolvimento é o Supabase em nuvem, C é exercitado com `ops.job` real dentro de transação com rollback, e a ausência do cron é simulada (§7, T-H8-07).

## 6. Limites do plano gratuito e comportamento com o projeto pausado

| Tema | Fato / decisão | Status |
|---|---|---|
| Pausa por inatividade | Free pausa após 1 semana sem atividade; pausado, o `pg_cron` não roda e a API não alcança o banco | doc 13 [VERIFICADO] |
| O `pg_cron` conta como atividade? | Presumir que **não**. Keep-alive externo ao banco (H-010, cron diário da Vercel executando uma consulta) continua obrigatório | [NÃO VERIFICADO] |
| Tick com projeto pausado | A: nenhum disparo (cron parado). C: requisição à API falha no banco; C engole o erro, recuo exponencial por instância, nenhuma exceção ao usuário. Endpoint chamado: 503 `{ok:false}` | desenho |
| Retomada | Restauração do projeto é manual no painel; o `pg_cron` volta sozinho no minuto seguinte (agenda persiste no banco). Jobs vencidos saem por `run_at, id`; o laço do tick drena no orçamento de 20 s por tick | desenho |
| Backlog depois da pausa | Cada handler revalida antes de agir (lembrete cujo horário passou, resumo obsoleto, cobrança já regularizada); o dado vencido não gera efeito. Requisito de revisão por handler | desenho |
| Conexões | 60 diretas / 200 no pooler [VERIFICADO]. `cron.use_background_workers = off`: cada execução do cron ocupa 1 conexão curta (≈ 1 por minuto); `pg_net` usa processo em segundo plano, não conexão de cliente. API: pooler em modo transação, 1 conexão por invocação, claim em transação curta com `lock_timeout 3 s`. `max_worker_processes = 6` é folga pequena para launcher do cron + worker do `pg_net` [medido no S-10] | parcialmente medido |
| Limites do Free para `pg_cron`/`pg_net` (jobs simultâneos, tamanho de fila, TTL de `_http_response`) | Não constam no doc 13 | [NÃO VERIFICADO] |
| Funções Vercel Hobby | 1 tick/min = 43.200 invocações/mês (4,3 % de 1.000.000); o C roda dentro de invocações já existentes | S-10 [VERIFICADO] |
| Hobby é não comercial | Migrar para Pro antes da primeira cobrança real (H-054) | doc 13 [VERIFICADO] |
| Proteção de deploy da Vercel | Pode devolver 401/redirect ao `pg_net` em previews. Usar o domínio de produção/dev sem proteção, ou um segundo segredo de bypass no Vault. Não decidir aqui | [NÃO VERIFICADO] (S-09) |

## 7. Testes para o DEV

Padrões do repositório: testes de banco `*.dbtest.mjs` rodam contra o banco de desenvolvimento em nuvem (sem Docker) e **só gravam dentro de transação com rollback**, exceto os de concorrência que usam `kind` com prefixo exclusivo `test.h008.*`, `dedupe_key` única e limpeza no `finally`. Testes unitários da API em vitest com dublês. **Nenhum teste faz chamada externa real:** nunca há commit com `net.http_post` pendente (o `pg_net` só envia após commit), a URL de teste é `https://tick.invalid/internal/jobs/tick`, e HTTP do endpoint é testado com o handler invocado em memória ou em servidor local.

**Banco: catálogo e privilégios** (`jobs-tick.dbtest.mjs`; atualizar `catalog.dbtest.mjs`)
- T-H8-01 `pg_cron` e `pg_net` instalados; esquemas `cron` e `net` existem; `pg_net` em `extensions` (e `pg_cron` onde a plataforma permitiu, registrado). Substitui o teste atual "pg_cron e pg_net seguem desabilitados" (`catalog.dbtest.mjs`, linha ≈ 187) e amplia `EXPECTED_EXTENSIONS`.
- T-H8-02 Nenhum de `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_api`, `app_system` tem `USAGE` em `cron`/`net`, `EXECUTE` em qualquer função desses esquemas, nem privilégio em suas tabelas (`has_*_privilege` sobre `pg_proc`/`pg_class` dos dois esquemas, via `aclexplode` para PUBLIC). Qualquer outro titular fora de uma lista fechada de papéis da plataforma falha (lista fixada na primeira execução e registrada no PR).
- T-H8-03 `private.jobs_tick_dispatch` e `private.jobs_tick_status`: SECURITY DEFINER, `proconfig` com `search_path=""`, sem EXECUTE para os papéis acima (`jobs_tick_status` só `app_system`). Cobre B-03.
- T-H8-04 Agenda: existe `jobs-tick` com `* * * * *`, `active`, `command` **exatamente** igual a `select private.jobs_tick_dispatch()`; o comando não contém `http`, `Bearer`, `secret`, `net.`. Existe `cron-purge`. Nenhum outro job em `cron.job`.
- T-H8-05 Sem segredo no repositório: `check:secrets` verde; `.env.example` só com o nome `JOBS_TICK_SECRET`; busca estática garante que `apps/api` não referencia `cron.`, `net.` nem `vault.`.
- T-H8-06 `vault.secrets` e `vault.decrypted_secrets` sem privilégio para os papéis acima.
- T-H8-07 Dispatcher, em transação com rollback: (a) sem segredos no Vault: retorna `null` e `net.http_request_queue` não ganha linha; (b) com `vault.create_secret` temporário e URL `https://tick.invalid/internal/jobs/tick`: ganha exatamente 1 linha de fila com o cabeçalho de autorização; rollback desfaz tudo e nada é enviado; (c) URL fora do padrão (outro caminho ou `http://`): não enfileira.

**Concorrência e lease** (Q-14, F-08, C-13; duas conexões reais, como `platform.dbtest.mjs` já faz para `job_claim`)
- T-H8-08 Dois `TickService` simultâneos (A e C) sobre 20 jobs `test.h008.*`: cada job tem handler executado **exatamente uma vez** (contador por `job.id`), todos terminam `concluido`, conjuntos reivindicados disjuntos, soma = 20. Repetir 10 rodadas.
- T-H8-09 F-08: um tick reivindica e "morre" (não conclui); lease vencido por `update` do `lease_until`; segundo tick reprocessa uma vez (`attempts` = 2); o `job_complete` tardio do primeiro devolve `false` e conta `lease_perdido`; nenhum terceiro processamento.
- T-H8-10 Esgotar `max_attempts` por expiração: job vira `falha` (`lease_expirado`) e nunca mais é reivindicado.
- T-H8-11 Handler que lança exceção: `job_fail` com código sem a mensagem da exceção (injetar mensagem com e-mail sintético e provar que `last_error` não o contém); retry com recuo.
- T-H8-12 `kind` sem handler: `job_fail('kind_desconhecido')`, sem derrubar o laço.
- T-H8-13 Handler mais lento que o timeout (30 s simulado com relógio falso): contado como falha, lease respeitado.
- T-H8-14 Tick não reivindica jobs de teste de outros `kind` quando configurado com filtro de teste (o filtro existe só no construtor, não no HTTP).

**Tick C sem `pg_cron`**
- T-H8-15 Unitário com dublê de `JobStore` e relógio falso: 1ª requisição dispara; 2ª e 3ª dentro de 60 s não; após 60 s dispara de novo; `/health` e `/internal/*` não disparam; tick em andamento bloqueia outro na mesma instância; exceção do store não vaza e aciona recuo; requisição de origem responde no mesmo tempo com C quebrado.
- T-H8-16 Banco real, em transação com rollback: `cron.unschedule('jobs-tick')` (cron "ausente") e depois `TickService.run('c')` processa um job vencido normalmente. Prova que o C não depende do cron.
- T-H8-17 Sem tráfego não há tick C (teste de contrato documentado): job com `run_at` vencido permanece `pendente` até haver chamada.

**Endpoint**
- T-H8-18 Autenticação: sem cabeçalho, com segredo errado, com segredo certo de comprimento diferente, com segredo no query string, segredo do ambiente ausente/vazio/curto (< 32): sempre 401 idêntico; correto: 200. `GET`/`PUT`: 404. Corpo e query ignorados. Comparação usa `timingSafeEqual` (teste de revisão estática).
- T-H8-19 Resposta e log não contêm PII, `payload_ref`, `last_error` nem lista de jobs; log só com campos da allowlist.
- T-H8-20 Banco indisponível: 503 `{ok:false}`, sem exceção não tratada.
- T-H8-21 Q-14 (c): chamada externa simulada (cliente HTTP local com segredo) produz o mesmo efeito que A, provando que B seria só configuração.

**Medição de atraso** (Q-09) — sem chamadas reais
- T-H8-22 Atraso do C com relógio falso e tráfego sintético esparso (intervalos de 30 s, 2 min, 10 min): atraso = `claim − run_at` ≤ intervalo da requisição + 60 s; nada perdido; login/aceite/mensagem de sistema não passam pelo tick.
- T-H8-23 `tick.probe`: handler sem efeito; um job `tick.probe` por minuto (`dedupe_key` pela minuto), habilitado por `app_config` `jobs.tick.probe_enabled` (desligado por padrão). Consulta de atraso (`percentile_cont` sobre `updated_at − run_at` dos concluídos) fica pronta e testada com dados sintéticos. A coleta real de 48 h é a §8.

## 8. NÃO VERIFICADO (depende de autorização, S-09/BLQ-EXEC)

1. **URL pública da API (S-09/H-009).** Sem ela não há teste ponta a ponta do A. Fica verificado só até o banco: extensão, catálogo, comando, fila do `pg_net` dentro de rollback. Dependem também de conta/projeto Vercel e de o papel `app_system` ter login e senha via pooler (pendência 1 do README de `supabase/`).
2. **Medição de 48 h do A** (`cron.schedule` + `net.http_post` contra URL pública): taxa de chegada, atraso p50/p95, proteção de deploy da Vercel, redirecionamento, timeouts. Gatilho do B herdado do S-10: mais de 5 % de ticks A sem chegada em 48 h ou atraso p95 > 5 min. Chegada medida por contador por hora no servidor (reutilizar `ops.rate_counter` com chave HMAC-fixa por origem, ≈ 48 linhas) contra `cron.job_run_details` (retenção 3 dias); atraso por `tick.probe`.
3. Existência/permissões do `supabase_vault` no projeto e se o papel de migração consegue revogar acesso nele e nos esquemas `cron`/`net` (a lista exata de titulares só aparece na primeira execução).
4. `with schema extensions` para `pg_cron` (pode ser não relocável).
5. Limites do Free para `pg_cron`/`pg_net` (jobs simultâneos, TTL de `net._http_response`), se o `pg_cron` conta como atividade contra a pausa, janela de restauração do projeto pausado.
6. `waitUntil` e ciclo de vida da função na topologia escolhida (S-09); distribuição real de atraso do C sob tráfego (H-099).
7. Plano B (agendador externo): nada consultado nem criado.

## 9. Dúvidas ao Orquestrador (não bloqueantes)

1. **O app NestJS ainda é placeholder** (`apps/api/src/index.ts`). Recomendação: o DEV entrega na H-008 (a) a migração e os testes de banco, (b) o núcleo `modules/jobs` (`TickService`, registro de handlers, `OpportunisticTick`, autenticação) em TypeScript sem dependência de Nest, com teste unitário, e (c) o adaptador HTTP fino quando existir o esqueleto da API (H-009/S-09). Alternativa: bloquear a H-008 inteira até existir o esqueleto (atrasa o banco e o C sem necessidade).
2. **Autorização da medição de 48 h** (já levantada no S-10). Recomendação: tratar como parte da H-008 apenas depois da URL pública do S-09; até lá a H-008 pode ser mergeada com A "provado até o banco" e a medição registrada como pendência para H-099. Alternativa: aceitar sem medição (menos evidência).
3. **Vault: passo manual do operador** para `jobs_tick_secret` e `jobs_tick_url` por ambiente (valor nunca passa por agente, chat, log ou commit). Recomendação: aceitar, com o runbook acima. Alternativa: segredo em variável do banco via `alter database ... set`, que é pior (aparece em catálogo).

## 10. Riscos novos ou reavaliados

| Id | Risco | Mitigação |
|---|---|---|
| H8-1 | Regrant de `net.*`/`cron.*` pela plataforma em atualização de extensão | T-H8-02 roda sempre; falha quebra o PR seguinte |
| H8-2 | Handler não idempotente duplica efeito após lease vencido | Requisito de revisão por handler; T-H8-09; `dedupe_key` do efeito |
| H8-3 | Lote lento passa do lease e outro tick assume | Handler 30 s < lease 60 s; jobs pequenos; sem renovação por ora |
| H8-4 | Tick C em muitas instâncias sobrecarrega o pooler | 1/min/instância, claim curto, recuo em erro, laço em um tick por processo |
| H8-5 | `job_run_details` enche o banco | `cron-purge` diário (3 dias) |
| H8-6 | Operador esquece os segredos do Vault em um ambiente | Dispatcher vira no-op seguro; `jobs_tick_status` e o monitor mostram ausência de execução; C cobre |

## Resumo em linguagem simples

O sistema vai acordar a si mesmo a cada minuto por um relógio do banco, que chama uma porta interna protegida por uma senha guardada em cofre; se o relógio falhar, cada visita ao site também dá o empurrão, e o banco impede que dois empurrões façam o mesmo trabalho duas vezes. Falta só testar com o site publicado e medir por 48 horas, que dependem de autorização.
