# Desenho H-015 — Anti-enumeração e limites (Issue #28, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante (§8 traz 2 confirmações).
- **Rastro:** 47-REFINO-H015 (CA-H015-01..15); decisões do Orquestrador D-H015-1..5; 39-DESENHO-H011 (§2, §2.1, §4, §7 R-1/R-2, §8 D-H011-11); 10 ADR-014; 35-DESENHO-H092 (cota 100/dia, reserva `auth` 10); migrações `20261110130000` (`ops.rate_counter`, `ops.app_config`) e `20261111140000` (`auth_challenge`, `private.auth_challenge_*`); `packages/db/src/challenges.ts` (somente leitura).
- **Natureza:** SOMENTE documento. Nenhum código, migração ou teste foi criado.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[DESVIO]` ajuste a documento existente.

## 0. Fatos do repositório [VERIFICADO]

1. `ops.rate_counter(key_hmac text 64 hex, window_start, count)` já existe, PK `(key_hmac, window_start)`, RLS forçada, sem lógica. `ops.app_config` existe, sem valores semeados.
2. `private.auth_challenge_create` já limita por e-mail (60 s, 5/h) com `pg_advisory_xact_lock` por `email_hash`, e recebe `p_ip_hmac` (hoje o store passa `null`). `private.auth_challenge_verify_code(p_challenge_id, p_email_hash, p_purpose, p_code_hmac, p_max_attempts, p_now)` conta 5 erros por desafio e **não conta** quando não há desafio ativo.
3. `ops.login_throttle` (33-H016) **não** existe nas migrações; não há tabela de bloqueio de código.
4. Esta história **não altera** `create` nem `verify_code`: cria funções envoltórias novas (§1.3) e a migração nova só adiciona objetos.

## 1. Modelo de contadores em Postgres (CA-H015-04)

### 1.1 Chave (HMAC, nunca valor em claro)

`key_hmac = HMAC-SHA256(pepper, "rl1|" + ação + "|" + escopo + "|" + valor)` em hex, calculado em TypeScript (o pepper não vai ao banco). Prefixo `rl1` e campos fixos dão separação de domínio: nenhuma chave de contador colide com `ip_hmac`, `email_hash` ou chaves de outras histórias (H-008 usa a mesma tabela).

| Ação | Escopo | Valor | Pepper | Janela (tamanho do balde / alcance) | Limite padrão |
|---|---|---|---|---|---|
| `pedido` | `ip` | IP normalizado | `PEPPER_IP_HMAC` | 10 min / 1 h | **20** |
| `pedido` | `global_h` | `*` | `PEPPER_IP_HMAC` | 10 min / 1 h | **30** |
| `pedido` | `global_d` | `*` | `PEPPER_IP_HMAC` | 1 dia UTC / 1 dia UTC | **80** |
| `codigo` | `ip` | IP normalizado | `PEPPER_IP_HMAC` | 10 min / 1 h | **50** |
| `erro_codigo` | `email` | e-mail normalizado (mesma função do H-011) | `PEPPER_EMAIL_HMAC` | 1 h / 24 h | **15** |

- **IP normalizado** (`ClientIpPort`): IPv4 como está; IPv6 reduzido ao prefixo `/64` (senão um cliente tem 2^64 endereços); IPv4 mapeado em IPv6 vira IPv4. IP ilegível ou ausente usa o valor fixo `desconhecido` (balde compartilhado, falha fechada) e gera métrica `ip_ausente`. Ver R-4.
- **Balde deslizante grosseiro** (ADR-014, "janelas grosseiras"): `window_start = floor(epoch/B)*B`. A soma cobre o balde atual e os `S/B − 1` anteriores. Para 10 min/1 h a janela efetiva é de 50 a 60 min (erra para o lado de permitir, até 10 min). Para o teto diário, balde único alinhado à meia-noite UTC (mesmo dia da cota de e-mail, 35).
- **Um só tipo de linha:** nenhum contador em memória (CA-H015-04). Incremento por `insert … on conflict (key_hmac, window_start) do update set count = count + 1`.
- **Pedido barrado não conta** (igual a H-011): decidir antes, incrementar só depois do sucesso. Assim um IP barrado não prolonga o próprio bloqueio e o `Retry-After` permanece correto.

### 1.2 Tabela nova `ops.code_lock` `[PROPOSTA]`

`key_hmac text PK (64 hex, e-mail)`, `strikes smallint not null default 0 check (strikes >= 0)`, `locked_until timestamptz null`, `last_error_at timestamptz not null`, `updated_at`. RLS habilitada e forçada, sem políticas, `revoke all` de `public/anon/authenticated/service_role`, privilégio só a `app_system` (mesma postura de H-005/H-011). Guarda só HMAC e contagens.

### 1.3 Funções `private.*` (`search_path=''`, `execute` só a `app_system`) `[PROPOSTA]`

Migração `supabase/migrations/20261111160000_identity_create_rate_limits.sql` + `supabase/rollbacks/…down.sql`, idempotente.

1. `rl_check(p_key, p_span_s, p_bucket_s, p_limit, p_now)` → `(ok boolean, retry_after int)`: soma dos baldes; `ok = soma < p_limit`. Se barrado, `retry_after = ceil(início do balde mais antigo com contagem + S − now)`, mínimo 1; no diário, até 00:00 UTC. Somente leitura.
2. `rl_hit(p_key, p_bucket_s, p_now)` → incrementa o balde atual.
3. **`auth_challenge_request(...)`** (porta de entrada do pedido): recebe os mesmos parâmetros de `auth_challenge_create` mais as quatro chaves de contador (`ip`, `global_h`, `global_d`) e os limites. Numa transação: trava `pg_advisory_xact_lock` nesta ordem fixa **global → IP → e-mail** (o e-mail é travado dentro de `create`); `rl_check` de IP, global/h e global/d; se algum barrar, devolve `('limite', max(retry_after), motivo)` **sem criar nada**; senão chama `auth_challenge_create`; só se `criado` aplica `rl_hit` nos três contadores. Devolve `('criado'|'espera'|'teto'|'limite', challenge_id, outbox_id, retry_after, motivo)`. `motivo` (`ip|global_h|global_d|email`) vai **só** a métrica, nunca ao cliente.
4. **`auth_code_attempt(...)`** (porta de entrada da verificação do código): recebe os parâmetros de `verify_code` mais `p_ip_key`, `p_email_key`, limites. Numa transação: trava IP → e-mail; (a) se `code_lock.locked_until > now` devolve `bloqueado_codigo` com a espera, **sem comparar** e sem tocar no IP; (b) `rl_check` do IP de código, barrado devolve `bloqueado_ip`; (c) `rl_hit` do IP (toda tentativa chega aqui e conta, certa ou errada); (d) chama `auth_challenge_verify_code`; (e) resultado `ok` devolve; qualquer outro (`errado` **ou** `invalido`, inclusive sem desafio ativo) chama o registro de erro (§3).
5. `rate_purge(p_now)`: apaga `rate_counter` com `window_start < now − 3 dias` e `code_lock` com `last_error_at < now − 8 dias` e `locked_until` vencido. Chamada pelo job diário já existente `auth.challenge.purge` (mesma `dedupe_key` diária). O corte de 3 dias preserva as medições do H-008 (48 h).

Os valores vêm de `ops.app_config`, são lidos e validados em TypeScript (padrão se ausente ou fora da faixa, como `windowSecondsFrom`) e **revalidados** na função SQL com `greatest/least`. Chaves: `auth.rate.pedido_ip_hora` (faixa 5–100), `auth.rate.pedido_global_hora` (5–200), `auth.rate.pedido_global_dia` (10–**90**, teto rígido), `auth.rate.codigo_ip_hora` (10–500), `auth.rate.erro_codigo_dia` (5–50). Durações do bloqueio e 7 dias são constantes.

## 2. Regras de 429 e igualdade entre e-mail existente ou não (RF-039)

1. **Nada na decisão olha conta.** As entradas de qualquer limite são IP, e-mail normalizado (só como HMAC), relógio e contadores. Não existe porta de usuário no pedido nem na verificação (continuidade de DD-1 de 39).
2. **Resposta única por tipo**, fabricada por uma função pura `rateLimited(kind, retrySeconds)` em `packages/domain`:
   - Pedido (IP, global, intervalo ou teto de e-mail): `429`, corpo `{"code":"muitos_pedidos","retry_after_seconds":N}`.
   - Código (IP ou bloqueio do e-mail): `429`, corpo `{"code":"muitas_tentativas","retry_after_seconds":N}`.
   - Cabeçalhos fixos: `Retry-After: N` (inteiro, 1 ≤ N ≤ 86400), `Cache-Control: no-store`, `Content-Type: application/json`. Nada mais (sem `Set-Cookie`, sem cabeçalho de motivo, sem `X-RateLimit-*`).
3. **Quando mais de um limite barra**, vale o **maior** `retry_after` (determinístico, nunca depende de conta). O corpo não diz qual limite agiu.
4. **Ordem de avaliação do pedido:** formato (422, sem tocar o banco) → global/IP → e-mail (dentro de `create`). **Do código:** bloqueio do e-mail → IP → comparação. Esta ordem só usa dados independentes de conta.
5. **Código errado:** `errado` e `invalido` produzem o mesmo corpo e status ao cliente (`{"code":"codigo_invalido"}`); `attempts_restantes` fica só interno. Isso é contrato para H-013 (CA-H015-07/08). O corpo de código sempre exige o e-mail (o contador é por e-mail), mesmo quando o desafio é identificado por outro campo.
6. **Tempo:** o caminho de trabalho é o mesmo (mesmas leituras e escritas) para qualquer e-mail; sem *sleep* artificial (igual a 39 §3).
7. **Logs/métricas (CA-H015-15):** só `rate.blocked{kind=ip|global_h|global_d|email|codigo_ip|codigo_lock}`, `rate.lock.created{strike}`, `rate.ip_ausente`. Nunca e-mail, IP, HMAC, código ou token.

## 3. Bloqueio progressivo do código, sem afetar o link (D-H015-3, D-H015-5)

**Registro de erro** (dentro de `auth_code_attempt`, mesma transação, serializado pelo lock do e-mail, então 20 tentativas simultâneas não perdem contagem):
1. `rl_hit(erro_codigo|email)` e `upsert code_lock.last_error_at = now`.
2. Se `now − last_error_at anterior > 7 dias`, `strikes := 0` antes do passo 3 (zera após 7 dias sem erro).
3. Se a soma de erros (balde 1 h, alcance 24 h) chegou a **15**: `strikes += 1`; `locked_until = now + (1º: 900 s | 2º: 3600 s | 3º em diante: 86400 s)`; **apaga os baldes `erro_codigo` desse e-mail** (o novo ciclo recomeça do zero ao fim do bloqueio).

**Semântica:**
- O 15º erro devolve a resposta normal de código inválido; a tentativa **seguinte** recebe 429 (`muitas_tentativas`, `Retry-After = locked_until − now`) e **o código não é comparado**, nem se estiver certo (CA-H015-09).
- Conta para qualquer e-mail, com ou sem cadastro, com ou sem desafio ativo; `verify_code` é chamada mesmo sem desafio ativo e devolve `invalido`, que conta.
- **O link não passa por este portão:** `auth_challenge_consume_link` e o pedido de novo link ignoram `code_lock` (CA-H015-11). Um novo pedido continua sujeito só a H-011, IP e global. Um desafio novo não zera o bloqueio, porque a chave é o e-mail.
- Sucesso do código **não zera** o contador de 24 h nem os `strikes` (evita servir de reinício; custo ao usuário legítimo é desprezível).
- Outro e-mail não é afetado (chave por HMAC do e-mail, CA-H015-12).

**Efeito sobre R-2 de 39:** por dia há no máximo 15 palpites (primeiro ciclo: 15 + 15 + 15 em ~1,5 h, depois 15 por dia) contra um código novo de 1 em 1.000.000: ≈ 0,0015 %/dia e ≈ 0,05 % em 30 dias de ataque contínuo, contra ≈ 1,8 % sem o bloqueio.

## 4. Números finais e justificativa (D-H015-2, D-H015-4)

| Limite | Valor | Justificativa |
|---|---|---|
| Pedido por IP | **20/h** | Valor do refino; cobre 10 clientes atrás do mesmo IP com 2 pedidos cada (CA-H015-02). Um IP sozinho já gasta 2/3 do teto global por hora, e isso é intencional: alguém que usa um IP só não leva o teto sozinho. |
| Teto global/h | **30 pedidos** | Folga de 50 % sobre o limite de IP; permite NAT em pico e ainda protege a cota se vários IPs atacarem. |
| Teto global/dia | **80 pedidos** (máx. configurável **90**) | Medido em **pedidos aceitos (202)**, que geram no máximo um e-mail cada. A cota de e-mail é 100/dia com **linha de reserva `auth` a partir de 90** (35). Com 80 (e teto rígido 90), pedidos de login sozinhos **não passam da linha em que a reserva começa**; os 10 de reserva ficam intactos e sobram 10 para outras classes. Mensal: 80 × 31 = 2.480 < 2.700 (linha de reserva mensal). Condição: as outras classes usam ≲ 10/dia no MVP (poucos usuários); H-097 descarta as outras classes primeiro quando `used ≥ 90`. |
| Tentativas de código por IP | **50/h** | D-H015-4. Cabem 5 tentativas × 10 clientes atrás do mesmo IP; um IP sozinho só consegue ~3 bloqueios de e-mail (15 erros cada, 45 tentativas) por hora antes de ser barrado. |
| Erros de código por e-mail | **15 em 24 h**; bloqueio 15 min, 1 h, 24 h | D-H015-3; zera após 7 dias sem erro. |
| Limites por e-mail do pedido (H-011) | 60 s e 5/h | Inalterados. |

Os valores ficam em `app_config` (§1.3); o **teto rígido de 90/dia** e as durações do bloqueio ficam no código/SQL, para uma configuração errada não consumir a reserva.

## 5. O que muda em 39 `[DESVIO]` (texto a registrar; edição fica para o Orquestrador/DEV)

O refino 47 chama a regra de "39 §2.3": no arquivo 39 ela está em **§2.1, item 3** (`auth_challenge_verify_code`). Registrar:

- **39 §2.1 item 3, substituir "Pega o desafio ativo do par; sem ativo = `invalido` (sem contar)" por:** "A chamada pública passa pelo portão `private.auth_code_attempt` (H-015, doc 50 §1.3 e §3). Todo resultado diferente de `ok` (`errado` ou `invalido`, **inclusive sem desafio ativo**) conta 1 erro no e-mail (HMAC); 15 erros em 24 h bloqueiam o caminho do código por 15 min, 1 h e 24 h (progressivo, zera após 7 dias sem erro). Com bloqueio ativo o código não é comparado. O link não é afetado. A função `verify_code` em si permanece inalterada: sem desafio ativo continua devolvendo `invalido`, mas agora esse resultado **conta** no portão."
- **39 §4, linha "Por IP e global":** trocar "**não** em H-011" por "limites em H-015: ver doc 50 §1 e §4; a chamada do pedido passa a ser `private.auth_challenge_request` e o store passa `ip_hmac` real".
- **39 §7 R-2 e §8 D-H011-11:** marcar como atendidos por H-015 (doc 50 §3).
- **Registrar também (D-H015-1), em tarefa de documentação separada, fora desta Issue:** em `09-MODELO-DADOS.md` (linha de `rate_counter`), trocar "Alta frequência fica em memória por instância (ADR-014)" por "todos os limites ficam em Postgres (ADR-014 revisto por H1)" e acrescentar `ops.code_lock`.
- **47 CA-H015-03:** "teto global da janela" passa a valer para **duas** janelas (hora e dia UTC); ajuste de redação, sem mudança de comportamento exigido.

## 6. Testes para o DEV (nenhum com rede real)

Setup comum bloqueia `fetch` e sockets; e-mails sintéticos `@example.test`; relógio simulado; valores sentinela (e-mail, IP, código) são procurados em tudo que o teste puder inspecionar.

**Unidade (Vitest, sem banco)**
- T-H015-01 chaves: 64 hex; domínios distintos (`pedido|ip` ≠ `codigo|ip` ≠ `pedido|global_h` para o mesmo valor); estáveis; peppers diferentes dão chaves diferentes; chave ausente = erro de configuração sem valor na mensagem.
- T-H015-02 IP: IPv6 do mesmo `/64` → mesma chave; IPv4 mapeado = IPv4; ilegível/ausente → `desconhecido` e métrica.
- T-H015-03 `decideRateLimit` e cálculo de `retry_after`: 19/20/21 pedidos; borda do balde de 10 min; maior valor quando mais de um barra; mínimo 1 e máximo 86400; diário até 00:00 UTC.
- T-H015-04 progressão: 1º, 2º e 3º bloqueio = 900/3600/86400 s; 4º também 86400; zera após 7 dias (6 d 23 h não zera).
- T-H015-05 configuração: fora da faixa cai no padrão; `pedido_global_dia` nunca passa de 90.
- T-H015-06 `rateLimited`: respostas byte a byte iguais para o mesmo (tipo, N); sem `Set-Cookie`, sem `X-RateLimit-*`; `muitos_pedidos` × `muitas_tentativas` conforme o tipo.

**Manipuladores (Vitest, repositório em memória, `FakeClock`)**
- T-H015-10 **matriz cadastrado × não cadastrado** para 202, 429 por IP, 429 global, 429 de intervalo/teto de e-mail, 429 de bloqueio de código e código errado: status, corpo, cabeçalhos e `Retry-After` iguais; sequência de chamadas ao repositório igual; nenhuma porta de usuário (CA-H015-05..08).
- T-H015-11 429 não cria desafio nem saída de e-mail (CA-H015-01/03).
- T-H015-12 nenhuma mensagem contém "não encontrado", "não cadastrado", "já existe" (CA-H015-08).
- T-H015-13 formato inválido → 422 sem tocar contadores.
- T-H015-14 logs/métricas capturados: sem e-mail, IP, HMAC, código ou token (CA-H015-15).

**Banco de desenvolvimento (`*.dbtest.mjs`, transação com rollback quando possível; concorrência com várias conexões; `p_now` explícito)**
- T-H015-20 permissões: `anon/authenticated/service_role` sem acesso a `code_lock` e às funções novas; `app_system` com o mínimo; RLS forçada.
- T-H015-21 IP: 20 pedidos passam, o 21º dá `limite` com `retry_after` correto; **30 pedidos simultâneos do mesmo IP → exatamente 20 criados**; pedido barrado não incrementa (o `retry_after` não cresce); virada de balde com `p_now` (CA-H015-01/02).
- T-H015-22 NAT: 10 e-mails distintos × 2 pedidos no mesmo IP → nenhum barrado.
- T-H015-23 global/h: 30 aceitos de IPs e e-mails distintos, o 31º barrado mesmo de IP novo; global/dia: 80 aceitos, o 81º barrado; zera à meia-noite UTC; `max(retry_after)` quando dois barram (CA-H015-03).
- T-H015-24 pedido barrado pelo e-mail (`espera`/`teto`) **não** incrementa IP nem global; barrado por IP/global **não** cria linha em `auth_challenge`.
- T-H015-25 `rate_counter` e `code_lock` varridos (`to_jsonb(row)::text`): nenhum e-mail ou IP em claro; chaves só 64 hex (CA-H015-04).
- T-H015-26 código: 14 erros não bloqueiam; o 15º devolve a resposta normal e a tentativa 16 dá `bloqueado_codigo`; com código **certo** na 16ª, o desafio continua **não consumido** (CA-H015-09).
- T-H015-27 **uniformidade (D-H015-3):** e-mail com desafio ativo e e-mail sem nenhum desafio chegam ao bloqueio exatamente na mesma tentativa, com o mesmo `Retry-After`.
- T-H015-28 progressão com `p_now`: 15 min, depois 1 h, depois 24 h; ao fim do bloqueio recomeçam 15 erros; zera após 7 dias sem erro.
- T-H015-29 **o link segue valendo:** com o e-mail bloqueado, `consume_link` de um desafio válido devolve `ok`; novo pedido de link é aceito dentro dos limites de H-011/IP/global (CA-H015-11).
- T-H015-30 isolamento: bloqueio de um e-mail não afeta outro (pedido e código).
- T-H015-31 IP de código: 50 tentativas passam, a 51ª dá `bloqueado_ip` mesmo para e-mails diferentes; tentativa barrada por bloqueio de e-mail não gasta IP (CA-H015-13).
- T-H015-32 concorrência: 40 tentativas erradas simultâneas do mesmo e-mail registram exatamente 15 erros até o bloqueio, sem perda de incremento e sem deadlock (ordem global → IP → e-mail).
- T-H015-33 expurgo: `rate_counter` > 3 dias e `code_lock` vencido e velho removidos; linhas recentes e baldes de outras chaves preservados.
- T-H015-34 regressão: toda a suíte de `challenges*.dbtest.mjs`, `auth-challenge.dbtest.mjs` e `challenge-consume*` continua passando (`create` e `verify_code` não foram alterados).

**Integração:** o store passa `ip_hmac` real em `auth_challenge`; um teste lê a coluna e confirma que é HMAC (64 hex) e não o IP.

Evidência: `corepack pnpm check:all` local, mais `db:test` no banco de desenvolvimento; registrar comando, contagem e código de saída na Issue. Nenhum teste faz chamada de rede nem usa chave real de e-mail.

## 7. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | **Negação de acesso pelo teto global:** quem encher 30/h ou 80/dia barra todos os clientes (cota gratuita de 100 e-mails/dia é o limite real). | Inerente à cota gratuita. Teto diário 80 protege a reserva; `Retry-After` honesto; métrica `rate.blocked{global_*}` para alerta. Solução estrutural fora do MVP: domínio verificado/plano pago (gatilho de ADR-020) e desafio anti-bot (SD-05, ainda sem decisão). |
| R-2 | **Bloqueio dirigido do código de um e-mail alheio** (15 erros): a vítima perde o código por até 24 h. | Aceito (D-H015-3): o link continua válido e ela pode pedir outro. Custo ao atacante: 50 tentativas/h por IP. |
| R-3 | **IP compartilhado** (NAT, rede móvel/CGNAT) barra clientes legítimos. | 20/h e 50/h calibrados para NAT de ~10 clientes; valores em `app_config`; sinal em métrica para recalibrar. |
| R-4 | **Fonte do IP:** na Vercel o IP do cliente vem de cabeçalho; ler o valor errado (cabeçalho forjável) anula o limite. `[NÃO VERIFICADO nesta sessão]` qual cabeçalho a plataforma sobrescreve. | O DEV valida em preview qual cabeçalho a plataforma reescreve e usa só esse; sem IP, balde `desconhecido` (falha fechada) com métrica. Teste manual registrado na Issue. |
| R-5 | **Contenção:** o lock global serializa os pedidos (transação curta). | Escala do MVP é pequena; lock só dura a transação; se aparecer espera, trocar por contador fragmentado. |
| R-6 | **Janela grosseira** (50–60 min) deixa passar até 10 min a mais de rajada. | Aceito por ADR-014; o teto diário usa balde exato. |
| R-7 | **Crescimento de linhas** por IPs/e-mails aleatórios. | Limite de 20/h e 50/h por IP; expurgo diário (3 dias / 8 dias). |
| R-8 | **Falso erro:** o cliente legítimo que reenvia o mesmo código certo duas vezes recebe `invalido` na segunda e isso conta. | Contador é de 24 h com 15; desprezível; H-013 pode evitar duplo envio no cliente. |
| R-9 | **Ataque distribuído** (muitos IPs) esgota os tetos mesmo sem chegar ao e-mail. | Mesma resposta de R-1; os limites reduzem custo, não eliminam o ataque. |
| R-10 | **Custo de E/S** no banco gratuito (3 leituras e até 3 escritas por pedido). | Poucos baldes por chave (≤ 6 por consulta; 1 no diário); sem varreduras. |

## 8. Confirmações ao Orquestrador (não bloqueantes)

1. **Redação do CA-H015-03:** o teto global passa a ter **duas** janelas (30/h e 80/dia). *Recomendação: aceitar; é mudança de texto.*
2. **Alcance do portão do código:** o corpo da verificação de código deve sempre trazer o e-mail (H-013), pois o contador é por e-mail. *Recomendação: registrar como requisito de H-013.*

## 9. Plano para o DEV (ordem sugerida)

1. Domínio puro (`rate-limit`: chaves, IP, decisões, progressão, `rateLimited`, configuração) e T-H015-01..06.
2. Migração + rollback + `code_lock` + funções SQL e T-H015-20..34.
3. Store Pg e manipuladores (pedido passa a chamar `auth_challenge_request` e `ip_hmac` real; verificação de código chama `auth_code_attempt`); T-H015-10..14.
4. `corepack pnpm check:all` e `db:test` locais; evidências na Issue. Fora do escopo: HTTP e tela do código (H-013), sessão (H-014), textos e cota de e-mail (H-094/H-097), anti-bot (SD-05).

## Resumo em linguagem simples

O sistema passa a limitar quantos pedidos de acesso cada rede pode fazer por hora e quantos o produto inteiro aceita por hora e por dia, de modo que um ataque não esgote os e-mails gratuitos que sobram para clientes de verdade. As respostas de recusa são sempre idênticas, exista ou não cadastro para o e-mail.
Quem errar o código 15 vezes em um dia fica sem poder digitar código por 15 minutos, depois 1 hora, depois 24 horas, mas o link do e-mail continua funcionando.
