# Desenho H-023 — Descoberta por raio e online nacional (Issue #36, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA para o desenho. O **Desenvolvimento só começa** com H-036 (#49) e H-031 (#44) construídas (decisão 102); o desenho avança antes. Dúvidas não bloqueantes em §10.
- **Rastro:** 96-REFINO-H023 (CA-01..CA-13; D-H023-1..8); decisões 101 a 108 (`11-DECISOES.md`, rodada 31, não reabertas); 88-DESENHO-H022 (§1, §2.3, §5, §6, §7); migração `20261112120500_geo_expand_match_point.sql` (funções `private.match_grid`, `private.match_janela`, `private.match_points_within`, índice `geocode_point_match_cell_idx`); decisão 57 (índice parcial, sem GiST); 08-ARQUITETURA §7.2 e §9.3; 09-MODELO-DADOS §3.2, §3.3 e §3.4; testes existentes `geo-match-point.dbtest.mjs`.
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` decisão do dono do produto ou do líder · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[PREMISSA]` depende de H-031 ou H-036, a confirmar no início do DEV · `[NÃO VERIFICADO]` depende de prova em desenvolvimento.

## 0. Situação encontrada
1. `[VERIFICADO]` Existem `app.geocode_point` com `match_cell`, `match_lon`, `match_lat`, `match_grid_version`, o índice parcial `geocode_point_match_cell_idx (match_grid_version, match_cell) include (subject_id, match_lon, match_lat) where subject_kind='request' and state='ok' and match_cell is not null`, e as funções `private.match_janela(lon, lat, raio)` (faixas contíguas de chave) e `private.match_points_within(lon, lat, raio, limite, versão)`. Esta aceita raio de 1 a 100.000 m, limite 1 a 5.000, não tem filtro de serviço, de modalidade nem de status e não tem cursor. Papéis: execute só `app_system`.
2. `[VERIFICADO]` Não existem no repositório `service_request`, `professional_service` nem `professional_area` (nenhuma migração). Vêm de H-031 e H-036. Os nomes abaixo vêm de 09 §3.2, §3.3, §3.4 e de 88 §0 item 2; são `[PREMISSA]` até essas Issues entregarem (§3.2).
3. `[VERIFICADO]` `geocode_point` tem `unique (subject_kind, subject_id, address_hash)`: **o mesmo `subject_id` pode ter mais de uma linha** (republicação com outro endereço). Por isso a junção do pedido com o ponto é por `geocode_point.id` (88 §0 item 2: as tabelas futuras guardam `geocode_point_id`), e não por `subject_id`. A primitiva devolve `subject_id`; ela **não serve** para esta consulta (§4.3).
4. `[VERIFICADO]` O último arquivo de migração é `20261112150000_draft_expand_review_confirmation.sql`; o rollback segue o padrão `supabase/rollbacks/<nome>.down.sql`, com `delete from ops.schema_migration where version = ...` no fim.
5. `[VERIFICADO]` O padrão de teste de banco de #35 abre uma transação no banco de desenvolvimento, aplica as migrações necessárias, roda cada teste num savepoint e faz rollback; sem rede, dados sintéticos.

## 1. Princípio e escopo `[DECIDIDO]` 101, 103
- A #36 entrega **a regra e a consulta no banco**. Não há rota, não há guarda de aprovação nem de acesso vigente, não há resposta ao profissional: isso é H-055 (#68). A função **não é fronteira de segurança de elegibilidade** (§8, L1).
- A origem da busca é o **centro da célula da base** do profissional (`match_lon/match_lat` da linha de base), nunca `exact_point` (decisão 103; CA-09).
- Nada novo é gravado em tabela de dados: a migração só cria duas funções e a guarda de pré-requisito. Sem coluna nova, sem índice novo, sem `update` em lote.

## 2. Regra de descoberta `[DECIDIDO]` 104, 105, 106
Para o profissional `P` e o pedido `Q`, em `p_now` (padrão `now()`):

| Condição | Regra |
|---|---|
| Admissão aberta | `Q.status = 'publicado'` **e** `p_now < Q.acceptance_deadline_at` (limite aberto: no instante do prazo, já expirou) |
| Serviço | `P` declarou `Q.service_id` em alguma modalidade, e a modalidade declarada vale (abaixo) |
| Presencial | `P` declarou o serviço como `presencial`; o centro da célula de `Q` está a `dist <= raio` do centro da célula da base de `P`; `dist` é a distância na esfera de 6.371.008,8 m, a mesma de 88 §5 |
| Online | `P` declarou o serviço como `online` e o serviço **não** é regulamentado (`service.regulated = false`): vale em qualquer UF, sem distância e sem exigir base |
| Online regulamentado | declarado online com `service.regulated = true`: **não** ganha alcance nacional (decisão 106, até L4). Se o mesmo serviço também foi declarado presencial, vale só o presencial |
| Duas modalidades | serviço declarado presencial e online: **vale o online** (decisão 105), isto é, vale a união; se o pedido está dentro do raio ele aparece uma vez só |

### 2.1 Faixa de incerteza `[DECIDIDO]` 104
A regra de produto é exata **sobre os centros de célula**: `dist(centro_base, centro_pedido) <= raio`. A "faixa de incerteza" **não alarga nem encurta o raio**; ela é a margem em que o resultado **pode divergir da distância real entre o ponto exato da base e o ponto exato do pedido**, e é o que o teste e a documentação ao usuário assumem:

`faixa(R) = 710 m + 0,003 × R` (duas metades de diagonal de célula, 2 × 355 m, 88 §2.3; mais a diferença esfera/elipsoide, 88 R4).

| Raio R | Faixa | Certeza de aparecer (centros a menos de) | Certeza de não aparecer (centros a mais de) |
|---|---|---|---|
| 5.000 m | 725 m | 4.275 m | 5.725 m |
| 20.000 m | 770 m | 19.230 m | 20.770 m |
| 50.000 m | 860 m | 49.140 m | 50.860 m |
| 100.000 m | 1.010 m | 98.990 m | 101.010 m |

Dentro da faixa o resultado pode ser qualquer um e **nenhum teste exige um dos dois** (CA-03). Fora dela é obrigatório. A tolerância de 10 m de 88 §5 vale só para a paridade da fórmula SQL com o oráculo de esfera (T-D12), não para a regra de produto.

## 3. Dados

### 3.1 Migração por expansão, reversível `[PROPOSTA]`
- Arquivo: `supabase/migrations/20261112170000_geo_expand_discovery_requests.sql`. **Número provisório:** o último existente é `20261112150000`; o DEV confirma em `supabase/migrations` que `20261112170000` está livre **e é posterior às migrações de H-031 e H-036** (a nossa as consome); se não for, renomeia o prefixo mantendo a ordem crescente e ajusta os testes.
- Rollback: `supabase/rollbacks/20261112170000_geo_expand_discovery_requests.down.sql`: `drop function if exists` das duas funções (assinaturas completas) e `delete from ops.schema_migration where version = '20261112170000'`. Nenhum dado é tocado; reversível a 100 %. Idempotente (`create or replace`, `if exists`).
- **Guarda de pré-requisito** (primeiro bloco `do $$`): verifica por catálogo que existem as colunas da §3.2 e, se faltar alguma, `raise exception 'discover_pre_requisito_ausente'` (texto fixo). Motivo: funções `plpgsql` não validam tabelas na criação; sem a guarda, o erro apareceria só na chamada.
- Não cria índice. O plano é medido em T-D13; se falhar, a correção é desenhada (R3), nunca escondida.

### 3.2 Contrato com H-031 e H-036 `[PREMISSA]`
O DEV confirma cada linha antes de escrever o SQL; divergência de nome é ajuste local, divergência de significado volta ao Architect.

| Objeto | Colunas usadas | Origem | Requisito |
|---|---|---|---|
| `app.service_request` | `id`, `service_id`, `status` (`publicado\|selecionado\|concluido\|cancelado`), `acceptance_deadline_at`, `geocode_point_id` | H-031 (09 §3.4, 88 §0.2) | `geocode_point_id` referencia `app.geocode_point(id)`, **único** (um pedido, um ponto); índice `(service_id, status, acceptance_deadline_at)` (09 §6) |
| `app.professional_service` | `professional_id`, `service_id`, `modality` (`presencial\|online`) | H-036 (09 §3.3) | A chave primária **deve ser `(professional_id, service_id, modality)`** para permitir as duas linhas da decisão 105. 09 §3.3 diz só "PK composta": H-036 confirma |
| `app.service` | `id`, `regulated` | catálogo (09 §3.2) | já planejado (RF-003) |
| `app.professional_area` | `professional_id` (único), `geocode_point_id`, `radius_m` | H-036 (09 §3.3 usa `base_point`; 88 §0.2 manda guardar `geocode_point_id`) | `radius_m` com CHECK 5.000 a 100.000. A linha apontada tem `subject_kind='professional_base'`, `state='ok'` e `match_*` preenchidos (gatilho de #35) |

## 4. Contratos da consulta `[PROPOSTA]`

### 4.1 Função de entrada (a única que um papel recebe)
```
private.discover_requests(
  p_professional_id uuid,
  p_limit           integer  default 50,    -- 1 .. 200
  p_after_group     smallint default null,  -- cursor
  p_after_key       integer  default null,  -- cursor
  p_after_id        uuid     default null)  -- cursor
returns table (out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)
language plpgsql stable security definer set search_path = ''
-- execute: somente app_system. revoke de PUBLIC, anon, authenticated, service_role, app_api, app_backup_reader.
```
Passos:
1. Valida `p_professional_id` não nulo, `p_limit` de 1 a 200 e o cursor "tudo ou nada" (os três nulos, ou os três preenchidos, `group in (0,1)`, `key >= 0`). Falha: `raise exception 'discover_parametro_invalido' using errcode = '22023'`.
2. Lê a base **somente** em `match_lon`, `match_lat` e `radius_m`: `professional_area pa join geocode_point g on g.id = pa.geocode_point_id where pa.professional_id = p_professional_id and g.subject_kind = 'professional_base' and g.state = 'ok' and g.match_grid_version = 1`. Sem base (ou sem `match_*`): origem nula, e o ramo presencial fica vazio (§2: online não exige base). Profissional inexistente: resultado vazio, sem erro (a guarda de H-055 decide sobre inexistência).
3. Chama `private.discover_scan(...)`.

### 4.2 Função interna
```
private.discover_scan(
  p_professional_id uuid, p_base_lon double precision, p_base_lat double precision, p_radius_m integer,
  p_limit integer, p_after_group smallint, p_after_key integer, p_after_id uuid,
  p_now timestamptz default now())
returns table (out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)
language plpgsql stable security definer set search_path = ''
-- execute: NENHUM papel (só a entrada, que roda como o mesmo dono).
```
- Validação (texto fixo, `22023`): origem com só uma das coordenadas nula, fora do Brasil (−75..−33 × −35..7) ou não finita ⇒ `discover_parametro_invalido`; **com origem presente**, `p_radius_m` nulo, `< 5000` ou `> 100000` ⇒ `discover_raio_invalido`, sem executar a busca (CA-04). Origem nula ignora o raio.
- O piso de 5.000 m vive aqui, **não** em `match_points_within` (esta fica como está: expansão, sem alterar função entregue na #35; seus testes usam raios menores que 5 km `[NÃO VERIFICADO]`, o DEV confere).
- `p_now` existe só para os testes fixarem o relógio (padrão `AGORA` de #35); a entrada `discover_requests` não o expõe e usa `now()`.

### 4.3 Consulta (uma instrução, entre os marcadores `-- BEGIN-DISCOVER-SQL` e `-- END-DISCOVER-SQL`, para T-D13 extraí-la)
Reaproveita, **sem reescrever**, `private.match_janela` e a fórmula haversine (copiada literalmente de `match_points_within`, e provada igual por T-D12).
```
with serv as (                                   -- serviços que valem para P
  select ps.service_id,
         bool_or(ps.modality = 'presencial')                        as pres,
         bool_or(ps.modality = 'online' and not s.regulated)        as onl
    from app.professional_service ps join app.service s on s.id = ps.service_id
   where ps.professional_id = p_professional_id
   group by ps.service_id),
g0 as (                                          -- ramo com raio (só se há origem)
  select r.id as rid, round(dist)::integer as k
    from private.match_janela(p_base_lon, p_base_lat, p_radius_m) w
    join app.geocode_point g on g.match_grid_version = 1 and g.match_cell between w.out_cell_lo and w.out_cell_hi
                            and g.subject_kind = 'request' and g.state = 'ok'
    join app.service_request r on r.geocode_point_id = g.id
    join serv on serv.service_id = r.service_id and (serv.pres or serv.onl)
   cross join lateral (select 2*6371008.8*asin(least(1::float8, sqrt(
          power(sin(radians(g.match_lat - p_base_lat)/2),2)
        + cos(radians(p_base_lat))*cos(radians(g.match_lat))*power(sin(radians(g.match_lon - p_base_lon)/2),2)))) as dist) d
   where p_base_lon is not null and d.dist <= p_radius_m
     and r.status = 'publicado' and p_now < r.acceptance_deadline_at),
g1 as (                                          -- ramo online: sem geografia, só o que g0 ainda não trouxe
  select r.id as rid, 0 as k
    from serv join app.service_request r on r.service_id = serv.service_id
   where serv.onl and r.status = 'publicado' and p_now < r.acceptance_deadline_at
     and r.id not in (select rid from g0))
select rid, grp, k from (select rid, 0::smallint grp, k from g0 union all select rid, 1::smallint, k from g1) u
 where p_after_group is null or (grp, k, rid) > (p_after_group, p_after_key, p_after_id)
 order by grp, k, rid
 limit p_limit;
```
Observações do contrato:
- **Por que `g0` aceita serviço só online dentro do raio:** é só para a ordem (perto primeiro); ele aparece uma vez, no `g0`, e `g1` o exclui. O conjunto final é exatamente a união da §2.
- **Ordem:** grupo 0 (com raio) por `(distância arredondada em metro, id)`; grupo 1 (online) por `id`. Cursor keyset `(grupo, chave, id)`; sem `offset`. CA-12 e decisão 108.
- **Estabilidade:** pedido novo que entre antes do cursor não reaparece nem desloca os já vistos (keyset); pedido que expire ou mude de status entre páginas some das seguintes. É o comportamento esperado de cursor, registrado em L4.
- **Filtros de pedido primeiro:** o `g0` usa o índice parcial de #35; o `g1` usa o índice `(service_id, status, acceptance_deadline_at)` de H-031.
- `service.active` **não** filtra (pedido já publicado de um serviço desativado continua descobrível) `[PROPOSTA]`, dúvida D-6.

### 4.4 Cursor e distância `[DECIDIDO]` 107, 108
`out_cursor_key` é a distância arredondada em metro e **é só material de cursor**. A função é interna (`app_system`); ela **nunca** pode ir à resposta HTTP, ao log nem ao front. H-055 deve transformar `(group, key, id)` em **token opaco assinado e cifrado (AEAD)**, de modo que um profissional não decodifique a distância do último item. Cursor adulterado só muda a posição da página, não concede acesso (não carrega autorização). Critério herdado por H-055: T-H055-cursor (§7).

## 5. Regra de raio, de limites e de alcance: resumo verificável
- Raio vem de `professional_area.radius_m`; `discover_scan` recusa fora de 5.000 a 100.000 m (CA-04), mesmo que o CHECK de H-036 falhe (defesa em dupla).
- Presencial: `dist(centro_base, centro_pedido) <= R`. Online não regulamentado: sem `dist`, sem UF. Ausência de base: só online.
- Raio exato do limite: `dist <= R` (inclusivo) sobre `dist` real em ponto flutuante; a chave de ordem usa `round(dist)`. Pedidos com `|dist − R| <= 10 m` ficam fora da paridade com o oráculo (como em 88 §5).

## 6. Privacidade e segurança `[VERIFICADO]` 88 §7, I-16, T-03, T-11
1. Resultado: **só** `out_request_id`, `out_cursor_group`, `out_cursor_key`. Sem `match_lon/lat`, `exact_point`, endereço, nome, e-mail, telefone, rótulo ou distância fora do material de cursor (CA-10).
2. Nenhuma das duas funções referencia `exact_point` (nem `geography`) no corpo: busca por varredura de `pg_proc` (CA-09). Elas leem `geocode_point` apenas por `id`, `match_*`, `subject_kind`, `state`, `match_grid_version`.
3. `security definer`, `search_path = ''`, objetos qualificados. `discover_scan` sem execute para ninguém; `discover_requests` só `app_system`; `app_api` recebe `permission denied`.
4. Erros com texto fixo: `discover_parametro_invalido`, `discover_raio_invalido`, `discover_pre_requisito_ausente`. Sem `format`, `%` nem valor interpolado; sem `raise notice/log` (CA-11). Nada de `identificador de profissional` em mensagem.
5. Profissional que repete consultas muda só o conjunto de pedidos que vê; a distância não sai do banco (decisão 107). Rate limit de consulta: H-055 (R5 de 88).

## 7. Testes (locais, Postgres real, sem rede, dados 100 % sintéticos)
Arquivos `[PROPOSTA]`: `packages/db/tests/geo-discovery-requests.dbtest.mjs` (banco) e `packages/db/tests/geo-discovery-requests-migration.test.mjs` (estático). O padrão é o de #35.
**Limpeza:** uma transação aberta no `before`, que aplica as migrações necessárias (as de H-021, H-022, H-036, H-031 e esta); cada teste num savepoint desfeito; rollback no `after`; todos os dados com `uuid` aleatório e marcadores `h023-`. O `after` abre **outra conexão** e confere contagem zero das linhas marcadas em `geocode_point`, `service_request`, `professional_service` e `professional_area`. Relógio fixo por `p_now`. Execução: `node --test --test-concurrency=1 packages/db/tests/geo-discovery-requests.dbtest.mjs`; evidência na Issue: comando, passou/falhou, código de saída (`corepack pnpm db:test`, `check:all`), sem declarar CI verde.

| # | Teste | Critério |
|---|---|---|
| T-D01 | Base em SP, raio 20 km, serviço presencial; pedidos do serviço com centros a 1 km, 10 km, 18 km: aparecem. Conferido contra distância haversine calculada no teste sobre os centros devolvidos por `match_grid`. Repete para 5 km e 100 km | CA-01 |
| T-D02 | Fronteira com a tabela da §2.1: para R = 5, 20, 50 e 100 km, semear pedidos em passos de 50 m ao longo de um rumo, a partir de `R − faixa − 300` até `R + faixa + 300`; **obrigatório** aparecer se centros a menos que `R − faixa`; **obrigatório** não aparecer se a mais que `R + faixa`; no meio, nada exigido e o teste **conta e imprime** os pedidos na faixa. Verifica também que cada decisão é exatamente `dist <= R` (paridade interna) | CA-02, CA-03 |
| T-D03 | `discover_scan` com origem e raio 4.999, 5.000, 100.000, 100.001, 0, −1 e nulo: 4.999, 100.001, 0, −1, nulo ⇒ `discover_raio_invalido` (código `22023`, texto fixo, **nenhuma consulta executada**: verificado por contador `pg_stat_user_tables` de `service_request` não aumentar, ou por pedido-sentinela que não aparece); 5.000 e 100.000 ⇒ aceitos. Origem com uma só coordenada, não finita ou fora do Brasil ⇒ `discover_parametro_invalido`. Origem nula com raio nulo ⇒ aceito (só online) | CA-04 |
| T-D04 | Profissional com serviço online (não regulamentado), sem base; pedidos do serviço em SP, Manaus e Porto Alegre (a 700 a 3.000 km): todos aparecem. Com base em SP também aparecem | CA-05 |
| T-D05 | Profissional com serviço **só presencial**, pedido do serviço a 3.000 km e outro a 150 km do raio: não aparecem; um dentro do raio aparece | CA-06 |
| T-D06 | Pedido de serviço não declarado, dentro do raio: não aparece. Declarado em outro profissional: não vaza | CA-07 |
| T-D07 | Estados `publicado`, `selecionado`, `concluido`, `cancelado` e `publicado` com `acceptance_deadline_at` igual a `p_now` e a `p_now − 1 s`: só o publicado com prazo futuro aparece (prazo = `p_now` já expirou). Vale para ramo com raio e ramo online | CA-08 |
| T-D08 | Dois pedidos com `exact_point` distintos na mesma célula: a resposta é idêntica (mesmo conjunto, mesma ordem, mesmas chaves); 20 bases em torno; trocar `exact_point` da **base** por outro ponto da mesma célula não muda nada. Varredura: nenhuma função `discover_*` tem `exact_point` ou `geography` no corpo (`pg_proc.prosrc`) | CA-09 |
| T-D09 | Resultado: `pg_get_function_result` das duas funções é exatamente `(out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)`; pedido semeado com canários (nome, e-mail, telefone, endereço, descrição, coordenadas) e base com canário: a serialização JSON do resultado não contém nenhum canário nem `match_lon/lat` de pedido ou base | CA-10 |
| T-D10 | Mensagens: ouvir `notice` do cliente durante todas as chamadas (zero ocorrências); forçar cada erro com canário numérico (`-46.123457`, `12345`, uuid do profissional) e verificar que a mensagem é exatamente o texto fixo e não contém o canário; varredura de `prosrc`: sem `raise notice/log/warning`, sem `format(` | CA-11 |
| T-D11 | Paginação: 40 pedidos com ao menos 12 empatados na mesma célula (mesma `chave`) e 9 online fora do raio; páginas de 1, 7 e 200: a concatenação das páginas é igual, em ordem e conteúdo, à lista inteira; sem repetição, sem salto; atravessa a fronteira grupo 0 → grupo 1; cursor inconsistente (parcial, grupo 2, chave negativa) ⇒ `discover_parametro_invalido`. Inserir pedido mais perto **entre** páginas: nada visto se repete e nada dos não vistos se perde | CA-12 |
| T-D12 | Paridade: sobre 3.000 pedidos sintéticos (menos que o limite 5.000 da primitiva) e 10 bases, o conjunto do ramo com raio (todos os serviços declarados presenciais) é idêntico ao de `private.match_points_within` sob o mesmo raio, fora da faixa de 10 m, relatando quantos foram excluídos | CA-01, reuso |
| T-D13 | 50.000 pontos `ok` com pedidos publicados do serviço declarado, `analyze`; extrair a instrução entre os marcadores, `prepare` e `explain (analyze, buffers) execute` com `plan_cache_mode = force_custom_plan`, raio de 100 km em Brasília: o plano contém `geocode_point_match_cell_idx` e **não** contém `Seq Scan on geocode_point`; imprime o tempo. A meta de 200 ms é **medida, não condição** (88 §6); no Supabase Free, `[NÃO VERIFICADO]`. Sem `enable_seqscan = off` | CA-13 |
| T-D14 | Sem base: serviço presencial ⇒ vazio; serviço online ⇒ aparece; serviço regulamentado declarado só online (alcance nacional negado, decisão 106) ⇒ vazio, mesmo com pedido a 1 km; serviço regulamentado declarado presencial e online ⇒ só o que está dentro do raio. Serviço declarado nas duas modalidades (não regulamentado) com pedido dentro do raio e outro a 2.000 km ⇒ dois pedidos, cada um uma vez | decisões 105, 106 |
| T-D15 | Privilégios: `has_function_privilege` falso para `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_api`, `app_backup_reader` em `discover_requests`; `app_system` verdadeiro nela e **falso** em `discover_scan`; `app_api` ⇒ `permission denied`; nenhuma concessão nova em tabela; ambas com `search_path=''` | padrão do repo |
| T-D16 | Migração: aplica sem H-031/H-036 ⇒ `discover_pre_requisito_ausente`; com tudo ⇒ cria; aplica **duas vezes** (idempotência); aplica o `.down.sql` ⇒ as funções somem e nenhuma tabela mudou (contagem e esquema iguais); reaplica ⇒ volta | reversibilidade |
| T-H055-cursor | **Herdado por H-055 (#68), não desta Issue:** o token de cursor é opaco, assinado e cifrado; decodificado por quem o recebe não mostra distância; adulterado ⇒ recusa; a resposta HTTP não contém `out_cursor_key` | decisões 107, 108 |

Cobertura dos critérios: CA-01 (T-D01, T-D12), CA-02/03 (T-D02), CA-04 (T-D03), CA-05 (T-D04), CA-06 (T-D05), CA-07 (T-D06), CA-08 (T-D07), CA-09 (T-D08), CA-10 (T-D09), CA-11 (T-D10), CA-12 (T-D11), CA-13 (T-D13). Decisões 105 e 106 em T-D14.

## 8. Limitações registradas
- **L1. A função não verifica elegibilidade.** Aprovação, acesso vigente, suspensão e bloqueio são da guarda de H-055; chamar `discover_requests` sem ela vaza a lista. Por isso só `app_system` a executa e não há rota nesta Issue.
- **L2. Esfera, não elipsoide** (≤ 0,3 % ≈ 300 m a 100 km). Coberto pela faixa; ao usuário só se promete "em torno de", nunca metro exato.
- **L3. Centros de célula, não pontos.** Cada lado erra até 355 m. Coberto pela faixa de 710 m.
- **L4. Cursor keyset:** pedido que muda de status, expira ou entra entre páginas aparece ou some conforme o estado no momento de cada página. Não há "instantâneo".
- **L5. Custo por página:** o ramo com raio recalcula todos os candidatos do raio a cada página (a ordem é por distância calculada, sem índice). Limitado pelos candidatos em 100 km; medido em T-D13. O ramo online ordena por `id` todos os pedidos publicados dos serviços online do profissional por página; aceitável no volume inicial `[NÃO VERIFICADO]`. Alternativa se pesar: coluna `published_at` e cursor `(published_at, id)` no ramo online (mudança de H-031/H-055, sem alterar esta migração).
- **L6. Serviço regulamentado online** sem alcance nacional até L4 (decisão 106). Quando L4 decidir, muda só a condição `not s.regulated`, em nova migração.
- **L7. Uma só versão de grade** (`match_grid_version = 1`), como em #35. Versão nova exige revisar `match_janela` e o ramo de leitura da base.
- **L8. Distância e ordem:** o profissional não vê distância (decisão 107); a ordem "mais perto primeiro" só aparece pela sequência. Ordem fina dentro de empates é por `id` (aleatório).

## 9. Riscos
| # | Risco | Mitigação |
|---|---|---|
| R1 | Nome ou significado de coluna de H-031/H-036 diverge (§3.2) | Guarda `discover_pre_requisito_ausente`; verificação no início do DEV; T-D16 |
| R2 | PK de `professional_service` não permite as duas modalidades (decisão 105) | Requisito explícito em §3.2; T-D14 falha cedo; H-036 corrige |
| R3 | O plano com junção a `service_request` por `geocode_point.id` não usa só o índice de #35 (o `include` traz `subject_id`, não `id`) e cai em varredura ou em leitura de heap pesada | T-D13 mede. Correção, se preciso: troca do índice parcial por outro com `id` no `include`, dentro da mesma migração (drop + create; o `.down.sql` recria o anterior). Não se usa `enable_seqscan = off` |
| R4 | Vazamento de distância pelo cursor | Cursor AEAD em H-055 (T-H055-cursor); a função é interna; chave em metro inteiro |
| R5 | Chamada sem guarda de elegibilidade | L1; só `app_system`; revisão de H-055 verifica a guarda antes da chamada |
| R6 | Mudança de relógio (`now()` na transação) afeta fronteira de prazo | `p_now` explícito nos testes; no uso real `now()` da transação |
| R7 | Pedido sem linha em `geocode_point` (se H-031 permitir online sem endereço) | O ramo online não exige ponto (`g1` não faz junção com `geocode_point`); o ramo com raio exige, e pedido sem ponto não aparece por raio (correto) |
| R8 | Uma base com `state` diferente de `ok` ou sem `match_*` esconde pedidos presenciais em silêncio | H-036 garante base `ok`; T-D14 cobre "sem base"; observabilidade de contagem por categoria (sem localização) é de H-055 |

## 10. Dúvidas não bloqueantes (para o líder consolidar; recomendação do Architect)
1. **D-1 (nomes de H-031/H-036).** Os nomes da §3.2 são premissa. Recomendação: o DEV confirma no início e a guarda de pré-requisito protege.
2. **D-2 (piso de 5 km).** Impor em `discover_scan` e não alterar `match_points_within`. Recomendação: aceitar.
3. **D-3 (cursor).** `(grupo, distância, id)` com token AEAD em H-055. Alternativa: arredondar a chave a 100 m (menos vazamento; mais empates). Recomendação: manter o metro, pois o token já protege.
4. **D-4 (ordem do ramo online).** Por `id`. Alternativa: por `published_at` (exige coluna e cursor diferente). Recomendação: manter e decidir em H-055 se o volume exigir.
5. **D-5 (PK de `professional_service`).** Incluir `modality` na chave. Recomendação: registrar como critério de H-036.
6. **D-6 (serviço desativado no catálogo).** Pedido já publicado de serviço desativado continua descobrível. Recomendação: aceitar; desativação não esconde pedido existente.
7. **D-7 (ajustes de documentos, a cargo do Orquestrador):** 14-BACKLOG H-023: retirar "Índice GiST" e acrescentar H-031 em "Depende de"; 09 §6 e 08 §9.3: trocar GiST pelo índice parcial (decisão 57); 88 §3: o nome da migração é `20261112120500`; 09 §3.3: `professional_service` com `modality` na chave; 16-MANIFESTO: dependência H-031.

## 11. Entrega ao DEV `[PROPOSTA]`
Pré-condição: H-036 e H-031 construídas (decisão 102); conferir a §3.2 e o número livre da migração. Ordem:
1. Guarda de pré-requisito, `discover_scan` (validação, ramos `g0` e `g1`, cursor) e `discover_requests`, com T-D01 a T-D08, T-D11, T-D12, T-D14.
2. Privacidade e log: T-D09, T-D10, T-D15 e o teste estático.
3. Desempenho: T-D13 com a instrução entre marcadores; ajuste do índice só se R3 acontecer.
4. `.down.sql` e T-D16.
Arquivos: a migração e o rollback acima, os dois testes, nada em `apps/api` (sem rota). A rota, a guarda e o token de cursor são H-055.
