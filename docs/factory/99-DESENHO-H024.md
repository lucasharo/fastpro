# Desenho H-024 — Cobertura booleana sem contagem (Issue #37, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA para o desenho. O **Desenvolvimento só começa** com a #36 (H-023) e a #49 (H-036) construídas (decisão 91) e, para fechar, com a guarda de elegibilidade (#55 e H-039). O desenho avança antes. Dúvidas não bloqueantes em §10.
- **Rastro:** 94-REFINO-H024 (CA-01..CA-12; D-H024-1..10); decisões 89, 90, 91, 104, 105, 106, 109 (`11-DECISOES.md`); 97-DESENHO-H023 (§2, §2.1, §3.2, §4.3, §8 L1); 88-DESENHO-H022 (§1, §2.3, §7); migração `20261112120500_geo_expand_match_point.sql` (`private.match_janela`, índice parcial de pedidos); contador `private.rl_check` e `private.rl_hit` (H-015) e o padrão de `20261111345000_audit_query_rate.sql`; 08 §9.4 e §15; ADR-014; 11-ARQ T-03, T-11, T-12.
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` decisão do dono do produto ou do líder · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[PREMISSA]` depende da #36, #49, #55 ou H-039, a confirmar no início do DEV · `[NÃO VERIFICADO]` depende de prova em desenvolvimento.

## 0. Situação encontrada
1. `[VERIFICADO]` Existem a grade, `app.geocode_point.match_*`, `private.match_janela(lon, lat, raio)` e o contador `private.rl_check/rl_hit` com o padrão de trava por chave (`audit_query_rate_take`). O índice parcial de #35 cobre **só** `subject_kind = 'request'`; não há índice para bases de profissional.
2. `[VERIFICADO]` Não existem no repositório `service_request`, `professional_service`, `professional_area`, a regra de descoberta (`discover_scan`, só desenho em 97) nem a guarda de elegibilidade. Os nomes abaixo vêm de 09 §3.3, §3.4 e de 97 §3.2; são `[PREMISSA]`.
3. `[VERIFICADO]` A descoberta da #36 responde "dado um profissional, quais pedidos?". A cobertura responde o **inverso**: "dado um pedido, existe algum profissional?". Cada profissional tem o **próprio** raio, então a janela de busca tem de ser a do raio máximo (100 km) e o filtro de distância é por linha. A primitiva `match_points_within` (pedidos a partir de uma base) e `discover_scan` não servem como estão; o que se reaproveita é a **regra**, não a consulta (§3).
4. `[VERIFICADO]` 11-ARQ §2.2 traz `GET /coverage` público; as decisões 56 e 90 o removem. Não há rota pública (§5).
5. `[VERIFICADO]` O último arquivo de migração é `20261112150000_draft_expand_review_confirmation.sql`; a #36 reservou `20261112170000` (provisório). Esta usa **`20261112180000`**, posterior à da #36.

## 1. Princípio e escopo `[DECIDIDO]` 89, 90
- Entrega: uma função no banco que diz se há profissional elegível para um pedido aberto, o cache de 5 minutos, o limite de consultas, o módulo de serviço em `apps/api` e **um campo `cobertura`** no estado do pedido do dono. Nada mais.
- O resultado público é **somente** `"com"` ou `"sem"`. Não há contagem, lista, identificador, distância, coordenada, célula ou nome de bairro em nenhuma saída (API, banco, log, erro).
- A cobertura só existe **depois de publicar** (pedido com coordenada permanente gravada). Antes disso não há função chamável nem rota (CA-09).
- A posição usada é o **centro da célula** do pedido e o centro da célula da base do profissional; nunca `exact_point` nem PostGIS no caminho de consulta (decisão 57; CA-05).

## 2. Contrato de cobertura `[PROPOSTA]`

### 2.1 Resposta da API
O campo é acrescentado ao estado do pedido **do dono**, só quando o pedido está aberto:

```
{ "cobertura": "com" }   ou   { "cobertura": "sem" }
```
- Pedido aberto = `status = 'publicado'` e `agora < acceptance_deadline_at` (a mesma definição de 97 §2). Em `selecionado`, `concluido`, `cancelado` ou prazo vencido, a chave **não existe** (CA-08).
- Limite excedido: HTTP 429, corpo fixo `{"erro":"muitas_consultas"}`, **sem** `Retry-After`, sem cabeçalho de cota e sem número (CA-07). Pedido alheio, inexistente ou não aberto na consulta de cobertura: a resposta do estado segue o 404 de H-026 (CA-08).
- Os textos de tela (BK-5) ficam no front por código (`com`/`sem`); a API não devolve texto livre. Textos aprovados: `[PENDENTE]` BK-5 (CA-11; D-H024-7 do refino).

### 2.2 Função de entrada (a única que um papel recebe)
```
private.coverage_for_request(
  p_request_id   uuid,
  p_customer_id  uuid,        -- dono vindo da sessão, nunca do corpo da requisição
  p_ip_key       text,        -- HMAC do IP (64 hex), calculado na API (ADR-014)
  p_now          timestamptz default now(),
  p_lim_ip       integer default 60,     -- por hora, por IP-HMAC (D-H024-9)
  p_lim_customer integer default 60,     -- por hora, por dono
  p_lim_request  integer default 20)     -- por hora, por pedido
returns table (out_result text)          -- 'com' | 'sem' | 'limite' | 'indisponivel'
language plpgsql security definer set search_path = '' set lock_timeout = '5s'
-- execute: somente app_system. revoke de PUBLIC, anon, authenticated, service_role, app_api, app_backup_reader.
```
Resultado de **uma coluna de texto**; a API traduz `limite` em 429 e `indisponivel` em 404 e nunca repassa o texto cru. Passos, nesta ordem:
1. Valida parâmetros (nulos, limites fora de 1..10000, `p_ip_key` fora de 64 hex): `raise exception 'coverage_parametro_invalido' using errcode = '22023'`, texto fixo.
2. **Limite de IP** (antes de qualquer leitura de pedido): conta a consulta; excedeu ⇒ `limite`.
3. **Pedido do dono e aberto:** `service_request r join geocode_point g on g.id = r.geocode_point_id where r.id = p_request_id and r.customer_user_id = p_customer_id and g.subject_kind = 'request' and g.state = 'ok' and g.match_cell is not null and private.discovery_open(r.status, r.acceptance_deadline_at, p_now)`. Sem linha ⇒ `indisponivel` (mesmo resultado para alheio, inexistente, encerrado ou sem célula).
4. **Limites do dono e do pedido** (chaves `sha256('coverage_customer|' || id)` e `sha256('coverage_request|' || id)`): excedeu ⇒ `limite`.
5. **Cache** (§4): se há linha válida para `(service_id, match_grid_version, match_cell)`, devolve o valor guardado.
6. Senão chama `private.coverage_exists(service_id, match_lon, match_lat, p_now)`, grava no cache e devolve.

Cada conferência/incremento usa `pg_advisory_xact_lock` por chave e `rl_check` + `rl_hit` com janela de 3.600 s e balde de 60 s, como em `audit_query_rate_take`. Os limites são constantes da API (config), validados na função; os valores são `[PROPOSTA]` (D-H024-9).

### 2.3 Função de existência
```
private.coverage_exists(p_service_id uuid, p_lon double precision, p_lat double precision,
                        p_now timestamptz default now()) returns boolean
language plpgsql stable security definer set search_path = ''
-- execute: NENHUM papel (só a entrada, que roda como o mesmo dono).
```
Valida `p_lon/p_lat` no Brasil (−75..−33 × −35..7) e não nulos (`coverage_parametro_invalido`). Devolve `true` se **qualquer** dos dois ramos achar uma linha; a instrução é **uma só**, entre `-- BEGIN-COVERAGE-SQL` e `-- END-COVERAGE-SQL` (para T-C12 extraí-la):

```
select exists (
  select 1 from (
    -- ramo online: sem geografia, sem base
    select ps.professional_id
      from app.professional_service ps join app.service s on s.id = ps.service_id
     where ps.service_id = p_service_id and private.discovery_mod_onl(ps.modality, s.regulated)
       and private.professional_eligible(ps.professional_id, p_now)
    union all
    -- ramo com raio: bases na janela do raio máximo, cada uma com o próprio radius_m
    select pa.professional_id
      from private.match_janela(p_lon, p_lat, 100000) w
      join app.geocode_point g on g.match_grid_version = 1
                              and g.match_cell between w.out_cell_lo and w.out_cell_hi
                              and g.subject_kind = 'professional_base' and g.state = 'ok'
      join app.professional_area pa on pa.geocode_point_id = g.id
      join app.professional_service ps on ps.professional_id = pa.professional_id and ps.service_id = p_service_id
      join app.service s on s.id = ps.service_id
     where private.discovery_serves(
             private.discovery_mod_pres(ps.modality), private.discovery_mod_onl(ps.modality, s.regulated), true,
             private.discovery_dist_m(g.match_lon, g.match_lat, p_lon, p_lat), pa.radius_m)
       and private.professional_eligible(pa.professional_id, p_now)
  ) c limit 1);
```
Observações:
- `exists` + `limit 1`: para no primeiro encontrado; **nunca conta** (CA-03). O ramo online usa só `discovery_mod_onl` (equivale a `discovery_serves` com `onl` verdadeiro, que dispensa distância e base).
- Os dois ramos usam a regra por **linha** (modalidade da linha), o que dá a mesma união que 97 §2 (duas modalidades valem o online, decisão 105; online regulamentado não ganha alcance nacional, decisão 106; presencial exige base e distância).
- Cada profissional aparece por uma ou duas linhas de `professional_service` (chave com modalidade, decisão 109); isso não altera o booleano.

## 3. Reuso da regra de descoberta, sem duplicar `[PROPOSTA]`
A regra mora em **cinco funções puras**, em SQL (`language sql immutable`, sem `security definer` e sem `set`, para o planejador poder inlinar), compartilhadas pela descoberta e pela cobertura:

| Função | Regra |
|---|---|
| `private.discovery_dist_m(lon1, lat1, lon2, lat2)` | haversine na esfera de 6.371.008,8 m (a de 88 §5 e de `match_points_within`) |
| `private.discovery_open(status, deadline, now)` | `status = 'publicado' and now < deadline` (limite aberto) |
| `private.discovery_mod_pres(modality)` | `modality = 'presencial'` |
| `private.discovery_mod_onl(modality, regulated)` | `modality = 'online' and not regulated` (decisões 105 e 106) |
| `private.discovery_serves(pres, onl, has_base, dist_m, radius_m)` | `onl or (pres and has_base and dist_m <= radius_m)` |

- **Caminho preferido `[PROPOSTA]`:** a #36 cria e usa essas funções na própria migração (acréscimo de uma linha ao DEV da #36: `g0` e `serv` de 97 §4.3 chamam as mesmas funções). A #37 apenas as consome e a guarda de pré-requisito (§6.1) confere que existem.
- **Caminho de reserva:** se a #36 já estiver construída com a regra inline, a migração da #37 cria as funções e reescreve `discover_scan` (`create or replace`) para chamá-las, **sem mudar o resultado**: a prova são todos os testes T-D01..T-D16 da #36 reexecutados e T-C02 (paridade). Essa mudança é uma expansão reversível (o `.down.sql` restaura o corpo anterior).
- **Elegibilidade** (aprovado e com acesso vigente) **não** faz parte da regra de descoberta da #36 (97 §8 L1: lá é a guarda da API). Na cobertura ela precisa estar **dentro** da consulta, porque não há chamada por profissional. O ponto único é `private.professional_eligible(professional_id uuid, now timestamptz) returns boolean` `[PREMISSA]` entregue por #55/H-039. Não se cria um substituto nesta Issue (nem em teste de produção); se a assinatura for outra, ajusta-se **só** as duas chamadas acima. Sem ela a Issue não conclui (D-H024-3 do refino).
- **Prova de que não há duas regras:** T-C02 compara, para um mesmo cenário aleatório, `coverage_exists(Q)` com "existe P tal que Q aparece em `discover_scan(P)`".

## 4. Dados e migração `[PROPOSTA]`

### 4.1 Cache de cinco minutos
```
ops.coverage_cache (
  service_id         uuid     not null,
  match_grid_version smallint not null,
  match_cell         integer  not null,
  covered            boolean  not null,
  computed_at        timestamptz not null,
  primary key (service_id, match_grid_version, match_cell))
```
- Guarda **só o booleano**, a chave `(serviço, versão da grade, célula)` e o instante. Sem `request_id`, sem profissional, sem cliente, sem coordenada, sem contagem (CA-06). RLS ligado, **nenhuma concessão** a papel algum; só as funções acima (`security definer`) leem e escrevem.
- Válido quando `computed_at <= p_now and p_now - computed_at < interval '5 minutes'`. No instante de 5 min exatos recalcula. `p_now` é parâmetro para o teste fixar o relógio (sem espera real).
- Gravação: `insert ... on conflict (...) do update set covered = excluded.covered, computed_at = excluded.computed_at`. Dois cálculos simultâneos da mesma chave produzem o mesmo valor; sem trava extra.
- Limpeza: a cada falha de cache, a função apaga no máximo 50 linhas com `computed_at < p_now - interval '1 hour'` (`for update skip locked`). Tabela limitada pela atividade; sem tarefa agendada nova.
- Atraso conhecido: aprovação, suspensão ou novo profissional levam até 5 min para aparecer (L3).

### 4.2 Índice
`geocode_point_match_cell_base_idx on app.geocode_point (match_grid_version, match_cell) include (id, match_lon, match_lat) where subject_kind = 'professional_base' and state = 'ok' and match_cell is not null`. O de #35 não cobre bases. É índice novo e parcial (decisão 57: sem GiST).

### 4.3 Arquivos
- Migração: `supabase/migrations/20261112180000_geo_expand_coverage.sql`. **Número provisório:** o DEV confirma que está livre e que é **posterior** às migrações da #36, #49, #55 e H-031 (esta consome as quatro); se não for, renomeia mantendo a ordem crescente.
- Rollback: `supabase/rollbacks/20261112180000_geo_expand_coverage.down.sql`: `drop function if exists` das funções `coverage_*` (assinaturas completas), `drop index if exists`, `drop table if exists ops.coverage_cache`, e `delete from ops.schema_migration where version = '20261112180000'`. No caminho de reserva do §3, também restaura o corpo de `discover_scan` e remove as cinco funções. Nenhum dado de origem é tocado. Idempotente.
- Nada de coluna nova em tabela existente, nada de `update` em lote.

## 5. Acesso e rotas `[DECIDIDO]` 90
- **Sem rota pública** e **sem rota própria de cobertura**. O dado sai como campo `cobertura` no estado do pedido do dono (§2.1).
- Se, no início do DEV, ainda não existir a leitura do estado do pedido do dono (a do painel #47 depende de H-031 e H-014), a #37 entrega a mínima, `GET /pedidos/:id/estado`, autenticada pela sessão do cliente, devolvendo `status` e, se aberto, `cobertura`; a #47 a estende depois. `[PROPOSTA]` (D-1).
- A API lê `p_customer_id` **da sessão**, nunca do corpo ou da query. Profissional (sessão de profissional), visitante e rascunho não chegam à função: recebem a mesma recusa de qualquer rota de cliente (CA-09, CA-10). Nenhuma resposta de rota de profissional (#36/#55) leva a chave `cobertura`.
- Módulo: `apps/api/src/coverage/coverage-service.ts` (chama `coverage_for_request` e traduz `out_result`), mais o acréscimo no estado do pedido. Porta de banco injetável, como nos módulos de rascunho.

## 6. Segurança, privacidade e observabilidade `[VERIFICADO]` 88 §7, T-03, T-11, T-12

### 6.1 Banco
1. **Guarda de pré-requisito** no início da migração (`do $$`): confere por catálogo as tabelas e colunas da §7.1, as cinco funções `discovery_*`, `professional_eligible`, `match_janela`, `rl_check` e `rl_hit`; faltando algo, `raise exception 'coverage_pre_requisito_ausente'` (texto fixo). Funções `plpgsql` não validam tabelas ao criar; sem a guarda o erro só apareceria na chamada.
2. `security definer`, `search_path = ''`, objetos qualificados. `coverage_exists` sem execute para ninguém; `coverage_for_request` só `app_system`; `app_api` ⇒ `permission denied`.
3. Nenhuma função referencia `exact_point` nem `geography` (varredura de `pg_proc`; CA-05). Leitura de `geocode_point` só por `id`, `match_*`, `subject_kind`, `state`, `match_grid_version`.
4. Erros de texto fixo: `coverage_parametro_invalido`, `coverage_pre_requisito_ausente`. Sem `format`, sem `%`, sem `raise notice/log/warning` (CA-12).
5. Resultado de `coverage_for_request`: uma coluna `out_result text`; `pg_get_function_result` é exatamente `TABLE(out_result text)` (CA-02).

### 6.2 API e log
- Log só com nome do evento e classe de status (200, 404, 429). **Nunca** id do pedido, célula, coordenada, `out_result`, contagem ou chave de limite. Métricas agregadas (consultas, 429, acertos de cache) sem rótulo de valor.
- 429 e 404 têm corpo fixo e igual para qualquer causa interna.
- Sondagem em volume (criar muitos pedidos em lugares diferentes para mapear onde há profissional) **não** é contida só por este limite; depende dos limites de publicação (H-031/H-015) e do limite por dono desta Issue (L2).

## 7. Testes (locais, Postgres real, sem rede, dados 100 % sintéticos)
Arquivos `[PROPOSTA]`: `packages/db/tests/geo-coverage.dbtest.mjs` (banco), `packages/db/tests/geo-coverage-migration.test.mjs` (estático) e `apps/api/tests/coverage-service.test.ts` (API, porta de banco simulada). Padrão de #35 e #36: transação aberta no `before`, migrações necessárias aplicadas, cada teste num savepoint desfeito, rollback no `after`, marcadores `h024-`, e conferência em **outra conexão** de contagem zero de linhas marcadas (`geocode_point`, `service_request`, `professional_*`, `ops.coverage_cache`, `ops.rate_counter`). Relógio fixo por `p_now`. Execução: `node --test --test-concurrency=1 <arquivo>`; evidência na Issue: comando, passou/falhou e código de saída (`corepack pnpm db:test`, `check:all`); sem declarar CI verde.

### 7.1 Contrato com as outras Issues `[PREMISSA]`
| Objeto | Colunas usadas | Origem |
|---|---|---|
| `app.service_request` | `id`, `service_id`, `status`, `acceptance_deadline_at`, `geocode_point_id`, `customer_user_id` | H-031 (09 §3.4) |
| `app.professional_service` | `professional_id`, `service_id`, `modality`; chave com `modality` | #49 (decisão 109) |
| `app.professional_area` | `professional_id`, `geocode_point_id`, `radius_m` (5.000 a 100.000) | #49 |
| `app.service` | `id`, `regulated` | catálogo |
| `private.professional_eligible(uuid, timestamptz)` | aprovado e acesso vigente | #55 / H-039 |
| `private.discovery_*` (cinco funções) | §3 | #36 |

### 7.2 Casos
| # | Teste | Critério |
|---|---|---|
| T-C01 | `pg_get_function_result` de `coverage_for_request` é `TABLE(out_result text)`; o conjunto de valores observado em todos os testes é `{com, sem, limite, indisponivel}`; resposta da API só tem a chave `cobertura` com `com`/`sem`. Mesmo pedido com 0, 1 e 5 profissionais elegíveis na célula: forma idêntica, muda só o valor. Canários (nome, e-mail, telefone, endereço, coordenadas, uuid do profissional) não aparecem no JSON | CA-01, CA-02 |
| T-C02 | **Paridade com a descoberta:** cenário sintético (200 pedidos, 60 profissionais, modalidades, raios de 5 a 100 km, regulamentado ou não); com todos elegíveis, `coverage_exists(Q)` é verdadeiro se, e só se, existe P com Q em `discover_scan(P)` (todas as páginas), fora da faixa de incerteza (§T-C04). Com um profissional tornado inelegível: a cobertura cai para falso, a descoberta não muda (L1 da #36). Varredura de `pg_proc.prosrc`: `coverage_*` não repete `6371008` nem `radians(`, só chama as `discovery_*` | CA-04, reuso |
| T-C03 | Existência: com 1 e com 500 elegíveis, `explain (analyze)` do ramo com raio mostra parada antecipada (linhas lidas no ramo muito menores que 500 no caso com 500); nenhum `count`, `array_agg` ou `string_agg` em `prosrc` | CA-03 |
| T-C04 | Um caso por requisito, cada um isolado: não aprovado; sem acesso vigente; serviço não declarado; fora do raio; base inexistente (só presencial ⇒ `sem`); presencial dentro do raio ⇒ `com`; online não regulamentado ⇒ `com` a 3.000 km; online regulamentado ⇒ `sem`; presencial e online ⇒ vale o online. Fronteira do raio para R = 5, 20, 50 e 100 km: obrigatório `com` com centros a menos que `R − faixa(R)`, obrigatório `sem` a mais que `R + faixa(R)`, com `faixa(R) = 710 m + 0,003 × R` (decisão 104); no meio nada é exigido e o teste conta e imprime. Cada profissional usa o **próprio** raio (um com 5 km a 20 km do pedido e outro com 50 km a 20 km: `com` só pelo segundo) | CA-04 |
| T-C05 | Dois pedidos com `exact_point` distintos na mesma célula ⇒ mesmo resultado; trocar o `exact_point` da base por outro da mesma célula não muda; varredura de `prosrc`: sem `exact_point`, `geography` nem `st_` nas funções `coverage_*` | CA-05 |
| T-C06 | Cache com relógio simulado: 1ª chamada calcula e grava; chamada a +4 min 59 s devolve o valor guardado mesmo após o profissional virar inelegível (prova de que não recalculou); a +5 min 00 s recalcula e regrava. Linha do cache contém só as colunas da §4.1; nenhuma coluna de pedido ou profissional (catálogo). Duas células vizinhas não compartilham valor. Limpeza apaga no máximo 50 linhas antigas por falha | CA-06 |
| T-C07 | Limites (T-12): 20 consultas por hora no mesmo pedido, a 21ª ⇒ `limite`; 60 por dono; 60 por IP-HMAC; a janela libera após 1 hora simulada. API: 429 com corpo `{"erro":"muitas_consultas"}` e **sem** `Retry-After`, sem cabeçalho de cota, sem número; mesma resposta para os três limites. Cache hit também conta. Duas chamadas concorrentes na última vaga: uma passa, a outra `limite` | CA-07 |
| T-C08 | Dono e estado: pedido de outro dono, inexistente, `selecionado`, `concluido`, `cancelado`, `publicado` com prazo igual a `p_now` e a `p_now − 1 s` ⇒ `indisponivel` (API: sem a chave `cobertura`; 404 em pedido alheio); `p_customer_id` vem da sessão (teste com corpo malicioso ignorado) | CA-08 |
| T-C09 | Varredura da tabela de rotas de `apps/api/src/app.ts`: nenhuma rota pública cujo caminho contenha `cobertura` ou `coverage`; a única rota que devolve o campo é a do estado do dono; chamada sem sessão, com sessão de profissional e com rascunho ⇒ recusa igual às demais rotas de cliente, sem a chave | CA-09 |
| T-C10 | Respostas de profissional: esquemas de resposta das rotas da #36/#55 e do perfil profissional não contêm a chave `cobertura` (varredura de esquema); pedido elegível para o profissional ⇒ sem o campo | CA-10 |
| T-C11 | Textos: o front exibe o texto por código `com`/`sem`, sem número e sem promessa de atendimento ou de e-mail; a Issue registra quem aprovou BK-5 e quando. Sem isso a Issue não fecha | CA-11 |
| T-C12 | Privacidade e log: ouvir `notice` (zero); forçar cada erro com canários (`-46.123457`, `12345`, uuid) e conferir que a mensagem é exatamente o texto fixo; varredura de `prosrc`: sem `raise notice/log/warning` e sem `format(`; teste de API captura todo log durante 429, 404 e 200 e não encontra id, célula, coordenada, `com`/`sem` nem chave de limite | CA-12 |
| T-C13 | Desempenho: 50.000 bases `ok` e 5.000 profissionais declarando o serviço, `analyze`; extrair a instrução entre os marcadores, `prepare` e `explain (analyze, buffers) execute` com `plan_cache_mode = force_custom_plan`, pedido em São Paulo e caso `sem` (pior caso): o plano contém `geocode_point_match_cell_base_idx` e **não** contém `Seq Scan on geocode_point`; imprime o tempo. A meta de 200 ms é **medida, não condição**; no Supabase Free, `[NÃO VERIFICADO]`. Sem `enable_seqscan = off` | CA-03 |
| T-C14 | Privilégios: `has_function_privilege` falso para `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_api`, `app_backup_reader` em `coverage_for_request`; `app_system` verdadeiro nela e **falso** em `coverage_exists`; `ops.coverage_cache` sem nenhuma concessão e com RLS ligado; `search_path=''` em ambas | padrão do repo |
| T-C15 | Migração: sem #36/#49/#55/H-031 ⇒ `coverage_pre_requisito_ausente`; com tudo ⇒ cria; aplica **duas vezes**; `.down.sql` ⇒ funções, índice e tabela somem, nada mais muda (contagem e esquema iguais, `discover_scan` com o corpo anterior se houve o caminho de reserva); reaplica ⇒ volta | reversibilidade |

Cobertura dos critérios do refino: CA-01 e CA-02 (T-C01), CA-03 (T-C03, T-C13), CA-04 (T-C02, T-C04), CA-05 (T-C05), CA-06 (T-C06), CA-07 (T-C07), CA-08 (T-C08), CA-09 (T-C09), CA-10 (T-C10), CA-11 (T-C11), CA-12 (T-C12). Segurança de papéis e reversibilidade em T-C14 e T-C15.

## 8. O que depende da #36 e da #49 (e de outras) para a construção
| Dependência | Para quê | Sem ela |
|---|---|---|
| **#36 (H-023)** | Regra de descoberta como cinco funções `discovery_*` (§3), `discover_scan` para o teste de paridade T-C02, `match_janela`, nomes de H-031/H-036 já conferidos | Não há regra única a reusar; o DEV não começa |
| **#49 (H-036)** | `professional_area` (base, `radius_m`), `professional_service` com modalidade na chave, base `professional_base` com `match_*` | Sem lado profissional; o DEV não começa |
| **H-031** (via #36) | `service_request`, prazo, dono, `geocode_point_id` | Idem |
| **#55 / H-039** | `private.professional_eligible` (aprovado e acesso vigente) | O desenvolvimento pode seguir com a assinatura combinada, mas a Issue **não conclui** |
| **H-015 (feito)** | `rl_check`/`rl_hit`, chaves HMAC de IP | Já existe |
| **BK-5** | Textos `com`/`sem` | A Issue não fecha (CA-11) |

Pode ser feito já, sem as dependências: este desenho, os arquivos de teste de esqueleto e a escolha dos limites. Não há stub de produção para o que falta.

## 9. Limitações registradas
- **L1. Existência, não elegibilidade plena.** O resultado vale pelo que `professional_eligible` considera elegível; suspensão ou bloqueio fora dessa função não são vistos.
- **L2. Sondagem por vários pedidos.** Quem publica muitos pedidos em lugares diferentes pode mapear a cobertura por célula, um booleano por vez. Os limites por dono e por IP e os limites de publicação a tornam lenta, não impossível. `[PROPOSTA]` aceitar; sinal de abuso fica para observabilidade agregada.
- **L3. Atraso de até 5 min** para refletir mudança de aprovação, acesso, base ou raio (cache).
- **L4. Centros de célula, não pontos.** Cada lado erra até 355 m; faixa de 710 m + 0,3 % do raio (decisão 104). Ao usuário só se promete "na sua região".
- **L5. Esfera, não elipsoide** (≤ 0,3 %), coberta pela faixa.
- **L6. Janela de 100 km por consulta.** O pior caso (`sem`) examina todas as bases da janela; limitado pelos candidatos e medido em T-C13. Alternativa se pesar: coluna `max_radius_bucket` em `professional_area`, mudança da #49.
- **L7. Uma só versão de grade** (`match_grid_version = 1`); versão nova exige revisar `match_janela`, o índice e a chave do cache.
- **L8. Tela atualizando em laço** estoura o limite de 20 por hora por pedido; a tela deve consultar uma vez por carregamento.

## 10. Riscos e dúvidas não bloqueantes
| # | Risco | Mitigação |
|---|---|---|
| R1 | Nome ou significado de coluna de #36/#49/#55 diverge (§7.1) | Guarda `coverage_pre_requisito_ausente`; verificação no início do DEV; T-C15 |
| R2 | Regra de descoberta mudar numa Issue futura e a cobertura divergir | Regra em funções únicas; T-C02 falha se divergir |
| R3 | `discovery_*` não inlinam e a consulta fica lenta | T-C13 mede; se preciso, expressão equivalente gerada a partir das mesmas funções com teste de igualdade; sem `enable_seqscan = off` |
| R4 | Vazamento por tempo de resposta (cache vs. cálculo) | Só revela um booleano que já é a resposta; aceito |
| R5 | `professional_eligible` mais cara que o previsto | Chamada só nas linhas já filtradas por serviço e distância (ordem de avaliação medida em T-C13); cache de 5 min |
| R6 | Falso positivo do limite por IP compartilhado | Limite por IP maior que o do pedido; resposta 429 genérica sem prazo é o preço; revisar após medir |

Dúvidas (recomendação do Architect; o líder consolida a numeração):
1. **D-1 (rota mínima do estado do dono).** Se a leitura do estado do dono ainda não existir, a #37 entrega `GET /pedidos/:id/estado` mínimo (§5). Alternativa: esperar a #47. Recomendação: entregar o mínimo, para a Issue ser verificável de ponta a ponta.
2. **D-2 (onde nasce a regra compartilhada).** Pedir à #36 que crie as cinco `discovery_*` (acréscimo ao DEV de 97 §4.3); reserva em §3. Recomendação: aceitar o caminho preferido.
3. **D-3 (limites).** 20 por hora por pedido, 60 por dono, 60 por IP-HMAC (D-H024-9 do refino acrescido do limite por dono). Recomendação: aceitar e medir.
4. **D-4 (tolerância).** Usar a faixa de 97 §2.1 (decisão 104), no lugar dos 710 m fixos propostos no refino. Recomendação: aceitar, por coerência com a #36.
5. **D-5 (BK-5).** Os textos continuam pendentes do líder ou do usuário; bloqueiam o fechamento, não o desenvolvimento.
6. **D-6 (ajustes de documentos, a cargo do Orquestrador):** 08 §9.4 (tirar a revisão e o "AMB-03 B"; decisão 56), 14-BACKLOG H-024 ("A+B" ⇒ A; acrescentar #49 em "Depende de"), 11-ARQ §2.2 (remover `GET /coverage`, decisão 90), 09 (acrescentar `ops.coverage_cache` e o índice de base), numeração duplicada da decisão 56 (D-H024-10).

## 11. Entrega ao DEV `[PROPOSTA]`
Pré-condição: #36 e #49 construídas (decisão 91); conferir a §7.1 e o número livre da migração. Ordem:
1. Guarda de pré-requisito, índice de bases, `coverage_exists` (com T-C02 a T-C05, T-C13) e, se for o caminho de reserva, a refatoração de `discover_scan` com os testes da #36 reexecutados.
2. Cache e limites: `ops.coverage_cache`, `coverage_for_request`, T-C06 a T-C08, T-C14.
3. API: módulo `coverage`, campo no estado do dono (ou a rota mínima de D-1), T-C09 a T-C12 e `coverage-service.test.ts`; texto no front só quando BK-5 estiver aprovado (T-C11).
4. `.down.sql` e T-C15.
Arquivos: a migração e o rollback acima, os três testes, `apps/api/src/coverage/`, o acréscimo ao estado do pedido do dono. **Nenhuma rota pública.**
