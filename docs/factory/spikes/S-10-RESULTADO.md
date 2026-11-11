# S-10 — Resultado: mecanismo de tick de jobs (A, B ou C)

- **Issue:** #9 (spike S-10, "Tick de jobs: escolha A, B ou C"). **Data:** 2026-11-10. **Branch:** `feature/init`. **Workflow:** WF-03 adaptado a spike, coluna Arquitetura.
- **Escopo executado:** leituras de catálogo e um teste de criação de extensão dentro de transação com `rollback` no banco Supabase gratuito de desenvolvimento. Nada foi agendado, nenhuma chamada HTTP foi feita, nenhuma extensão ficou instalada.
- **Método:** script Node temporário (fora do repositório) que reutiliza `packages/db/scripts/lib/env.mjs` (lê `DATABASE_URL_MIGRATIONS` do `.env.local` por código). Nenhum segredo, URL, host ou identificador do projeto aparece neste documento.
- **Não executado (depende de S-09 / BLQ-EXEC):** medição de 48 h de `cron.schedule` + `net.http_post` contra uma URL pública, plano B com agendador externo, distribuição real de atrasos do plano C sob tráfego. Ver §4.

## 1. Pré-condições lidas no repositório

- Migração `20261110130000_platform_create_outbox_jobs_idempotency.sql`: `ops.job` (estados `pendente`, `em_execucao`, `concluido`, `falha`; `dedupe_key` único; lease com `lease_owner` e `lease_until`) e `private.job_enqueue/job_claim/job_complete/job_fail`. `job_claim` usa `FOR UPDATE SKIP LOCKED`, devolve jobs vencidos e retoma lease expirado. Concede execução só ao papel interno `app_system`. A migração declara que **não** habilita `pg_cron`/`pg_net` (fica para H-008/S-10).
- Isso satisfaz o requisito do plano 19 §4 (jobs idempotentes sob lease): qualquer dos três mecanismos pode disparar o mesmo `POST /internal/jobs/tick` sem risco de execução dupla.
- ADR-018, `08-ARQUITETURA.md` §16.2 e R-30: o cron da Vercel Hobby roda no máximo 1x/dia (±59 min), logo não serve de tick; login, mensagem automática do aceite e webhook não dependem do tick.

## 2. Comandos e saída relevante (sem segredos)

Estado antes (somente leitura):

| Consulta | Resultado |
|---|---|
| `pg_extension` para `pg_cron`, `pg_net` | nenhuma instalada |
| `ops.job` e `private.job_claim/job_complete/job_fail` | **existem** (migração H-005 aplicada no desenvolvimento) |
| `shared_preload_libraries` | inclui `pg_cron` e `pg_net` (pré-carregadas pela plataforma) |
| `cron.database_name` | `postgres` |
| `cron.use_background_workers` | `off` |
| `cron.max_running_jobs` | 32 |
| `max_worker_processes` / `max_connections` | 6 / 60 |
| papel atual | `postgres`, `rolsuper = false` |

Teste reversível (`begin; ... rollback;`, cada `create extension` num savepoint):

```
create extension pg_cron;   -> OK  (versão 1.6.4, schema pg_catalog)
create extension pg_net;    -> OK  (versão 0.20.4, schema public, por ter sido criada sem "with schema")
```

Dentro da transação, após criar:

| Verificação | Resultado |
|---|---|
| `cron.schedule(job_name text, schedule text, command text)` e `cron.schedule(schedule, command)` | existem |
| `cron.unschedule(job_id)` / `cron.unschedule(job_name)` e `cron.alter_job(...)` | existem |
| `net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)` | existe |
| `net.http_get(url, params, headers, timeout_milliseconds)` | existe |
| `USAGE` nos schemas `cron` e `net` para `postgres` | sim |
| `select count(*) from cron.job` | 0 (nada agendado) |

Estado depois do `rollback`: `pg_extension` sem `pg_cron`/`pg_net`; schemas `cron` e `net` inexistentes. **Nenhum resíduo.**

Observação para H-008: a H-003/S-02 previa `pg_net` no schema `extensions`; sem `with schema extensions` ele foi para `public`. Na migração real, usar `create extension if not exists pg_net with schema extensions;` e revisar a exposição de `net.*` a `anon`/`authenticated` (`revoke`), pois `net.http_post` permite ao banco chamar a internet.

## 3. Limites do plano gratuito

Fonte primária: `docs/factory/13-VERIFICACAO-SERVICOS.md` (acesso 2026-11-09), seção "Supabase (plano Free)" e "Vercel". Itens marcados "doc 13" estão verificados lá; os demais são `[NÃO VERIFICADO]`.

| Tema | Fato | Fonte / status |
|---|---|---|
| Pausa por inatividade | Projeto Free pausa após 1 semana sem atividade; com ele pausado, nenhum `pg_cron` roda e o tick A para | doc 13 (Supabase). Se o próprio `pg_cron` contaria como atividade: `[NÃO VERIFICADO]`; manter keep-alive independente (H-010) |
| Limite de conexões | 60 diretas, 200 no pooler; `max_connections = 60` medido aqui; jobs do `pg_cron` ocupam conexão enquanto rodam | doc 13 + medição aqui; S-02 |
| Frequência mínima do `pg_cron` | `cron.schedule` aceita agenda de 1 minuto; a extensão instalada é 1.6.4. Sintaxe de segundos e limites de concorrência da plataforma Free | `pg_cron` 1.6.4 medido; limite do Free para pg_cron/pg_net **não consta no doc 13**: `[NÃO VERIFICADO]` |
| Disponibilidade das extensões no Free | `pg_cron` 1.6.4 e `pg_net` 0.20.4 disponíveis e criáveis; o doc 13 dizia "não encontrei", agora **VERIFICADO por execução** | este spike + S-02 |
| Cron da Vercel Hobby | no máximo 1x por dia (±59 min) | doc 13 (Vercel); R-30 |
| Funções Vercel Hobby | 300 s, 1.000.000 invocações/mês: 1 tick/min = 43.200/mês (4,3 % da cota), mais tráfego | doc 13 + conta |
| Hobby e uso comercial | proíbe cobrar; migrar para Pro antes da primeira cobrança real (ADR-018, H-054) | doc 13 |
| Frequência/termos de agendador externo (B) | não consultados | `[NÃO VERIFICADO]` (BLQ-EXEC) |
| GitHub Actions agendado como B | cron mínimo de 5 min e risco de estourar minutos gratuitos em repositório privado | plano 19 §4 S-10; `[NÃO VERIFICADO]` |
| Entrega do `pg_net` | requisição é assíncrona (resposta só em tabela `net._http_response`, retenção limitada); não garante entrega, o que o lease e o `run_at` do job compensam | conhecimento prévio, `[NÃO VERIFICADO]` no Free |

## 4. Avaliação das opções

| Opção | Prós | Contras / riscos | Estado da evidência |
|---|---|---|---|
| **A** `pg_cron` + `pg_net` | Sem conta nem serviço extra; precisão de 1 min; agenda versionada em migração; permite também tarefas só em SQL (expurgo de `idempotency_key` e `rate_counter`) sem passar pela API | Depende de URL pública da API (S-09) e de segredo guardado no banco (usar `supabase_vault`, nunca no texto do comando em `cron.job`); para se o projeto pausar; `pg_net` não confirma entrega; Hobby não pode ser usado comercialmente | Extensões criáveis e funções presentes: **verificado**. Ponta a ponta HTTP: **NÃO VERIFICADO** (sem URL do S-09) |
| **B** chamada HTTP externa gratuita | Independe do Supabase e continua se `pg_net` falhar | Exige conta e termos de terceiro (BLQ-EXEC), frequência mínima desconhecida, mais um segredo exposto fora do banco | NÃO VERIFICADO |
| **C** tick oportunista | Sempre disponível, zero conta, zero configuração; já alinhado ao lease do banco | Sem tráfego não há tick: lembretes T-24h e digest podem atrasar horas; cada instância serverless só pode tentar 1x/min e sem estado compartilhado | Mecanismo do lease **verificado** (migração H-005); atraso real sob tráfego baixo **NÃO MEDIDO** |

## 5. Decisão

**A + C, com B apenas como contingência documentada (não implementar agora).**

1. **A é o mecanismo principal** do tick: `pg_cron` agenda a cada minuto um `net.http_post` ao `POST /internal/jobs/tick` com segredo de máquina lido do `supabase_vault`.
2. **C permanece sempre presente** (regra do plano 19 §3.1 item 0.10): cada requisição à API tenta reivindicar jobs vencidos, no máximo 1x/min por instância, usando `private.job_claim` com lease. Ele cobre falha do `pg_net`, pausa ou deploy sem agendador, e dá o caminho de teste local.
3. **B fica em reserva.** Acionar somente se a medição do S-09/H-008 mostrar que `net.http_post` não alcança a API (por exemplo, proteção de deploy da Vercel ou falhas recorrentes) ou se o Free restringir o `pg_cron`. Gatilho objetivo: mais de 5 % de ticks A sem chegada em 48 h, ou atraso p95 maior que 5 min.
4. **D** (cron diário da Vercel) permanece só como keep-alive/expurgo (H-010), sem ser tick.

Esta decisão é **técnica e condicional**: A está provado até o nível do banco; a validação ponta a ponta e as 48 h de medição pertencem à H-008 quando houver URL pública (S-09).

## 6. Impacto em H-008 (#21)

- Escopo da H-008: `POST /internal/jobs/tick` com segredo de máquina; migração que cria `pg_cron` e `pg_net` (`with schema extensions` para `pg_net`), agenda de 1 minuto e `revoke` de `net.*` e `cron.*` para `anon`, `authenticated` e `service_role`; segredo no Vault, nunca versionado nem em `cron.job.command` em texto claro.
- Implementar C no próprio módulo de jobs (chamada de `job_claim` em requisição, com limite 1x/min por instância e `try/catch` que nunca derruba a requisição de origem).
- Testes: pgTAP de catálogo "extensões esperadas presentes"; teste de concorrência duas chamadas de tick simultâneas sem job duplicado (Q-14, F-08); teste de que sem `pg_cron` o tick C ainda processa; medição de atraso (Q-09).
- Bloqueios herdados: URL pública (S-09/H-009, BLQ-EXEC) para o teste ponta a ponta; H-099 recebe a medição de atraso.
- Migrações: a criação das extensões é DDL com efeito fora do esquema do produto; seguir a política de migrações e o rollback `down` (que deve fazer `cron.unschedule` e `drop extension`).

## 7. Riscos

| Id | Risco | Mitigação |
|---|---|---|
| R-30 | Cron da Vercel Hobby insuficiente | Resolvido pela decisão A + C |
| R-38 | Extensões ausentes no Free | Reduzido a **baixo**: criáveis e funções verificadas por execução |
| S10-1 | `pg_net` não confirma entrega ou não alcança a API (proteção de deploy, redirecionamento, timeout) | Tick C + lease; gatilho do B; medir na H-008 |
| S10-2 | Projeto pausa por inatividade e o tick para | Keep-alive H-010; C não resolve pausa; reavaliar Pro antes de dados reais |
| S10-3 | Segredo do tick vazar via `cron.job.command` ou logs de `net._http_response` | Vault; segredo só em cabeçalho; revoke de `cron.*`/`net.*`; sem corpo sensível |
| S10-4 | `net.http_post` exposto a papéis de API vira vetor de SSRF | `revoke` explícito; teste pgTAP de privilégios |
| S10-5 | Pico de conexões (`max_connections = 60`) se o tick rodar lotes longos | Lotes curtos, `lock_timeout`, 1 job por lote no início |
| S10-6 | Uso do Hobby na produção cobrando clientes | Gatilho H-054 (migrar para Pro) |
| S10-7 | Limites do Free para `pg_cron`/`pg_net` não documentados no doc 13 | Registrado como `[NÃO VERIFICADO]`; medir na H-008 |

## 8. Dúvidas ao Orquestrador

1. Autorizar, quando S-09/H-009 houver URL pública, a medição de 48 h do tick A (BLQ-EXEC). Recomendação: sim, dentro da H-008. Alternativa: aceitar a decisão sem medição e validar apenas por teste de integração local (menos evidência).
2. Reservar o plano B sem conta externa agora. Recomendação: não criar conta; só registrar o gatilho. Alternativa: criar conta de agendador gratuito já (adianta, mas amplia superfície de segredos).

## Resumo em linguagem simples

Testamos no banco gratuito e ele consegue ligar o agendador interno e o recurso que avisa a internet (desfizemos tudo no fim, nada ficou ligado). Vamos usar esse agendador a cada minuto como principal e manter também um "empurrão" a cada visita ao sistema como reserva; um serviço externo só entra se o principal falhar na medição, que ainda depende de o site estar publicado.
