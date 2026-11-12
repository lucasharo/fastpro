# Desenho H-022 — Célula generalizada (≈ 500 m) e `match_point` (Issue #35, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante para o desenvolvimento. Dúvidas não bloqueantes em §9.
- **Rastro:** 87-REFINO-H022 (CA-01..CA-10; D-1..D-5 decididas pelo líder); decisão 46 (BK-2 opção b) e decisões 56 e 57 (`11-DECISOES.md`, registradas com este desenho); 68-DESENHO-H021 §2 e §3.5; 08-ARQUITETURA §9.1–§9.2 (modelo geo; o backlog citava 09 §9, corrigido); 09 §3.4; 11-ARQ I-28, R-05, R-38, T-03, G-02; S-02-RESULTADO; migrações `20261110120000` (baseline), `20261111370000` (tabelas), `20261111390000` (funções `geo_*`); testes `geo-geocode-point.dbtest.mjs`.
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` líder ou usuário · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento.

## 0. Situação encontrada
1. `[VERIFICADO]` #34 (H-021) está concluída: existem `app.geocode_point` (única tabela com `exact_point`, CHECK de selo `permanent`, caixa do Brasil, `state='ok'` ⇔ ponto presente), `app.geocode_budget` e as funções `private.geo_reserve`, `geo_store_permanent`, `geo_mark_no_result`, `geo_release`, `geo_panel` (execute só para `app_system`). Nenhum papel tem DML nem SELECT nas tabelas.
2. `[VERIFICADO]` **`service_request` e `request_draft` de pedido ainda não guardam ponto** e `service_request` não existe (H-031). Por decisão de 68 §0 item 2 e dúvida 2, o ponto exato vive só em `app.geocode_point`, e as tabelas futuras guardam `geocode_point_id`. Logo `match_point` **não** entra em `service_request` (como 09 §3.4 previa): entra em `app.geocode_point`, junto de `exact_point`. Isso cumpre CA-01 por construção e mantém um só lugar de escrita.
3. `[VERIFICADO]` PostGIS já é dependência da base: o baseline cria a extensão em `extensions` e `geocode_point.exact_point` é `geography`. S-02-RESULTADO mostra PostGIS 3.3.7 disponível. Mesmo assim `[DECIDIDO]` (D-2) o casamento usa o **fallback**: célula como chave inteira, índice B-tree e filtro de distância. PostGIS só serve (a) para ler x/y de `exact_point` dentro do gatilho e (b) como **oráculo de teste** do CA-07. O caminho de consulta não depende de PostGIS.
4. `[VERIFICADO]` O padrão de migração do repositório: arquivo `supabase/migrations/<timestamp>_<área>_<verbo>_<nome>.sql` idempotente, desfazer em `supabase/rollbacks/<mesmo nome>.down.sql`, funções `security definer` com `search_path = ''`, RLS forçada, `revoke` para todos os papéis e `grant execute` só a `app_system`. Último arquivo existente: `20261112110000`.

## 1. Princípio
O ponto exato é lido uma vez, **dentro do banco**, por um gatilho que calcula a célula e o centro da célula (`match_point`). Tudo que é voltado a profissional consulta **somente** o centro da célula. Nenhuma função, view ou resposta devolve `exact_point`. Duas coordenadas na mesma célula produzem o mesmo resultado (CA-06) porque a consulta nunca olha o ponto exato.

## 2. Grade (decisão D-4: 500 m, versão gravada) `[PROPOSTA]`

### 2.1 Escolha e justificativa
Grade **por linhas de latitude**: altura fixa e largura ajustada por linha, para a célula ser ≈ 500 m × 500 m em todo o Brasil (de −34° a +6° o cosseno varia de 0,83 a 1; uma grade fixa em graus daria células 17 % mais estreitas no Sul). Alternativas descartadas: (a) grade fixa em graus (largura varia 17 %; erro maior que o prometido no Sul); (b) projeção SIRGAS/Albers (exige PostGIS na consulta, contraria D-2); (c) geohash (células retangulares de proporção variável e fronteira dependente de caractere).

### 2.2 Constantes da versão 1 (todas inteiras, em micrograus)
Unidade `µ°` = 10⁻⁶ grau (≈ 0,111 m de latitude).
- Origem: `LAT0 = −35.000000°`, `LON0 = −75.000000°` (um grau de folga além da caixa −34..6 / −74..−34 de `geocode_point`, para o centro da célula nunca sair do domínio).
- Altura da linha: `DLAT = 4497 µ°` (500,04 m na esfera de raio 6 371 008,8 m, a mesma da consulta; a esfera fixa o metro do sistema).
- Linha: `row = floor((lat_µ − LAT0_µ) / DLAT)`, com `lat_µ = floor(lat × 10⁶)` calculado em `numeric` (exato, sem erro de binário).
- Largura da linha: `DLON(row) = round(DLAT / cos(radians(lat_centro_da_linha)))` (inteiro em µ°), com `lat_centro_da_linha = LAT0 + (row + 0,5) × DLAT`. O `round` para inteiro absorve diferença de 1 ulp da libm entre builds do Postgres; só um empate exato em .5 poderia divergir, e o teste de valores dourados (§8, T-DOUR) detecta isso.
- Coluna: `col = floor((lon_µ − LON0_µ) / DLON(row))`.
- Chave: `match_cell = row × 65536 + col` (inteiro de 32 bits). Limites: linhas ≤ 9 340 e colunas ≤ 9 340 (< 65 536 e < 2³¹ ÷ 65 536 = 32 768), com folga. Chave decodificável: `row = match_cell / 65536`, `col = match_cell % 65536`.
- Centro (`match_point`): `lat_c = LAT0 + row × DLAT + DLAT/2`, `lon_c = LON0 + col × DLON(row) + DLON(row)/2`, em `numeric`, convertidos para graus (`double precision`).
- Fronteira (CA-09): `floor` em ambos os eixos ⇒ uma coordenada exatamente sobre a borda pertence a **uma** célula (a de índice maior); a borda inferior-esquerda é fechada e a superior-direita é aberta. Sem empate possível.
- `match_grid_version = 1` (smallint). A função de grade é despachada pela versão: `private.match_grid(p_version, p_lon, p_lat)`; versão desconhecida ⇒ exceção. Mudar o lado da célula é uma **versão 2** nova (função nova, backfill novo, índice por versão), nunca uma edição da versão 1; assim pedidos antigos não mudam em silêncio.

### 2.3 Erro máximo (CA-03)
O ponto está a no máximo metade da diagonal do centro: `0,5 × √2 × 500,04 ≈ 353,6 m`. Acréscimos: arredondamento de `DLON` (≤ 0,06 m) e variação do cosseno dentro da linha (≤ 0,03 m). Teórico máximo ≈ 353,7 m. `[PROPOSTA]` Limite do teste: **355 m** (≈ 354 m do refino com 0,4 % de margem), medido com haversine na esfera de 6 371 008,8 m.

## 3. Dados: migração por expansão, reversível `[PROPOSTA]`

Arquivo: `supabase/migrations/20261112120000_geo_expand_match_point.sql` (o DEV confirma que o número ainda está livre antes de gravar e ajusta o prefixo, mantendo ordem crescente). Desfazer: `supabase/rollbacks/20261112120000_geo_expand_match_point.down.sql`.

### 3.1 Expansão (idempotente: `if not exists`, `create or replace`, `drop ... if exists`)
1. Colunas novas em `app.geocode_point`, todas **anuláveis**, sem valor padrão (nenhuma reescrita da tabela):
   - `match_cell integer`, `match_lon double precision`, `match_lat double precision` (o `match_point` lógico: centro da célula), `match_grid_version smallint`.
2. CHECKs (novas colunas são nulas nas linhas existentes, logo valem de imediato):
   - `geocode_point_match_tudo_ou_nada`: `num_nulls(match_cell, match_lon, match_lat, match_grid_version) in (0, 4)`.
   - `geocode_point_match_origem` (CA-04, mesmo padrão de G-05): `match_cell is null or (exact_point is not null and geocode_mode is not distinct from 'permanent')`. `is not distinct from` porque, com `geocode_mode` nulo, a comparação seria nula e o CHECK deixaria passar (lição do CHECK de selo já existente).
   - `geocode_point_match_dominio`: `match_cell is null or (match_lon between -75 and -33 and match_lat between -35 and 7 and match_grid_version = 1)`. Versão nova amplia este CHECK na migração dela.
3. Funções (todas `set search_path = ''`; só as de consulta têm `grant execute` a `app_system`):
   - `private.match_grid_dlon(p_row int) returns int` `immutable parallel safe`.
   - `private.match_grid(p_version smallint, p_lon double precision, p_lat double precision) returns table(cell int, c_lon double precision, c_lat double precision)` `immutable`. Rejeita não finito, fora do domínio e versão desconhecida.
   - `private.geocode_point_set_match() returns trigger` (sem `execute` para nenhum papel; só o gatilho a chama).
   - `private.match_points_within(p_lon, p_lat, p_radius_m, p_limit, p_version)`: ver §5.
4. **Gatilho** `geocode_point_match_biu` `before insert or update` em `app.geocode_point`, `for each row`:
   - `exact_point` nulo e qualquer `match_*` não nulo ⇒ `raise exception 'match_sem_exact_point'` com `errcode = '23514'` (CA-04 também por gatilho, dupla proteção com o CHECK).
   - `exact_point` nulo e todos `match_*` nulos ⇒ segue (estado `aguardando`, `reservado`, `sem_resultado`).
   - `exact_point` não nulo ⇒ calcula `private.match_grid(1, st_x, st_y)` a partir do próprio `exact_point` e **sobrescreve** os quatro campos, ignorando qualquer valor informado. Consequência: `match_point` é sempre função pura de `exact_point` (CA-02, CA-06), e nenhuma via, nem SQL direto do dono, grava um centro diferente do calculado.
   - A leitura de x/y usa `extensions.st_x/st_y(exact_point::extensions.geometry)`, como o CHECK da caixa. Única dependência de PostGIS no caminho de escrita.
5. **`geo_store_permanent` não muda.** O gatilho dispara no mesmo `UPDATE` que grava `exact_point`, na mesma instrução e transação (CA-01); se o cálculo falhar, a instrução inteira falha, o estado fica `reservado` e o chamador libera a reserva (`geo_release`). Não grava só um dos dois.
6. Índice (§6): `create index if not exists geocode_point_match_cell_idx`.

### 3.2 Preenchimento das linhas existentes (CA-10)
Dentro da mesma migração, depois do gatilho: `update app.geocode_point set exact_point = exact_point where exact_point is not null and match_cell is null`. A autoatribuição dispara o gatilho e calcula o centro; é uma operação **derivada e idempotente**, não altera nenhum dado de origem. Linhas sem `exact_point` (aguardando, reservado, sem resultado) ficam com `match_*` nulo. `[VERIFICADO]` Hoje só há linhas de teste (o Mapbox permanente nunca rodou em produção), então o volume é desprezível; o `update` em lote é suficiente.

### 3.3 Contração (mesma migração, depois do preenchimento)
`geocode_point_match_estado`: `state <> 'ok' or match_cell is not null`. Com o preenchimento acima, vale de imediato; se o DEV preferir etapas, cria `not valid` e valida na sequência. Esta é a única restrição "dura" que depende de preenchimento prévio.

### 3.4 Desfazer (`...down.sql`)
Na ordem: remover o CHECK `match_estado`; remover o gatilho e `geocode_point_set_match`; remover a função de consulta, `match_grid` e `match_grid_dlon`; remover o índice; remover os três CHECKs; remover as quatro colunas (dados derivados, recalculáveis a partir de `exact_point`; nenhum dado de origem é apagado). Idempotente (`if exists`). O desfazer **não** toca `exact_point`, `geo_*` nem o teto.

## 4. Fluxo de escrita (CA-01, CA-02, CA-04)
`geo_store_permanent` (H-021, inalterada) → `UPDATE ... exact_point = ... , geocode_mode='permanent'` → gatilho calcula e grava `match_*` na mesma linha e instrução. Repetir a publicação: `geo_reserve` devolve `reutilizar` e `geo_store_permanent` nem roda; se rodasse de novo sobre a mesma linha, o gatilho recalcularia o mesmo valor. A mesma coordenada em linhas diferentes dá a mesma célula (função pura).

## 5. Consulta por distância (primitiva para H-023) `[PROPOSTA]`
```
private.match_points_within(
  p_lon double precision, p_lat double precision,   -- centro da busca (base do profissional; H-036/H-023 decidem a origem)
  p_radius_m integer,                               -- 1 .. 100000 (H-023 restringe 5 .. 100 km)
  p_limit integer default 500,                      -- 1 .. 5000
  p_version smallint default 1)
returns table(subject_id uuid, match_lon double precision, match_lat double precision, distance_m integer)
language sql stable security definer set search_path = ''
-- execute: somente app_system; revoke de PUBLIC, anon, authenticated, service_role, app_api.
```
- **Filtro:** `subject_kind = 'request'`, `state = 'ok'`, `match_grid_version = p_version`. Filtros por serviço, status do pedido e online (H-023) entram juntando com `service_request` por `subject_id`; esta função só entrega o ponto generalizado. Nota para H-031: o vínculo pedido ↔ `subject_id` é o "identificador lógico da cadeia de republicação" (68, dúvida 3); H-031 deve registrá-lo.
- **Janela por faixas de chave (usa o B-tree):** com `dlat_m = R / 111 194,93`, calcula linhas `r_min..r_max` da faixa `[lat − dlat, lat + dlat]` (recortadas ao domínio). Para cada linha `r`, `Δlon_µ = R / (111 194,93 × cos(lat_máx_abs_da_faixa)) × 10⁶` e colunas `c_min..c_max = floor((lon_µ ∓ Δlon_µ − LON0_µ) / DLON(r))`, com 1 coluna de folga de cada lado. Cada linha vira **uma faixa contígua** `match_cell between r×65536 + c_min and r×65536 + c_max` (a chave por linha é contígua por construção). A união das faixas é feita com `generate_series(r_min, r_max)` e `cross join lateral`. Em 100 km são ≈ 400 faixas; em 5 km, ≈ 20.
- **Filtro exato:** depois da faixa, `haversine(match_lat, match_lon, p_lat, p_lon) <= p_radius_m` na esfera de 6 371 008,8 m, calculado em SQL puro (`asin/sin/cos`). A distância devolvida é `round(...)`, em metro inteiro. A consulta mede **ponto de busca → centro da célula** (nunca ao ponto exato).
- **Ordem:** `distance_m, subject_id` (determinística) e `limit p_limit`.
- **Tolerância de fronteira (CA-07):** faixa de **10 m** `[PROPOSTA]` em torno do raio; pedidos com `|distance_m − R| ≤ 10` são excluídos da comparação de paridade. Motivo: o oráculo PostGIS e o SQL puro usam a mesma esfera; a diferença esperada é de ordem de milímetro, e os 10 m cobrem arredondamento de `distance_m` e `float`.
- **Honestidade sobre o metro:** a distância esférica difere da geodésica no elipsoide em até ≈ 0,3 %, ou seja ≈ 300 m a 100 km. É aceitável para casamento; H-023 deve decidir se compensa no raio e não prometer metro exato ao usuário.

## 6. Índice e plano (CA-08, R-05)
`create index if not exists geocode_point_match_cell_idx on app.geocode_point (match_grid_version, match_cell) include (subject_id, match_lon, match_lat) where subject_kind = 'request' and state = 'ok' and match_cell is not null;`
- Parcial para ficar pequeno no plano gratuito; `include` permite *index-only scan* (sem ir à tabela, que nem tem permissão de leitura para quem consulta).
- Verificação no banco local: 50.000 pontos sintéticos (a mesma ordem do benchmark L4 de S-02), `analyze`, `explain` da função de janela. Esperado: `Index Only Scan` ou `Index Scan using geocode_point_match_cell_idx`; nenhum `Seq Scan` em `app.geocode_point`. `[PROPOSTA]` Meta de tempo: raio de 100 km em Brasília com 50.000 pontos < 200 ms (a meta de 19-PLANO-TECNICO-DEV); registrada como medida, não como falha, fora do banco local `[NÃO VERIFICADO]` no Free.
- O teste não usa `set enable_seqscan = off` para passar. Se o planejador escolher varredura com 50.000 linhas, a causa é estatística ou forma da consulta e é corrigida no desenho, não escondida.

## 7. Segurança e privacidade (CA-05, T-03, I-16, B-16)
1. **Nenhuma leitura direta:** `app.geocode_point` segue sem SELECT para `app_api`, `app_system`, `anon`, `authenticated`, `service_role` e `PUBLIC` (RLS forçada, sem políticas). Esta migração **não concede nada novo à tabela**.
2. **Única via de leitura do ponto generalizado:** `match_points_within`, `security definer`, execute só `app_system`. Seu tipo de retorno **não tem** coluna de ponto exato, endereço, `address_hash`, `precision` nem `geocoded_at`. O `subject_id` é o único identificador.
3. **O que o profissional ainda vê:** centro da célula e distância ao centro. Quem repete buscas com bases diferentes só descobre a célula (CA-06), a mesma limitação aceita em 08 §9.2. Rótulo de bairro/cidade/UF é de H-032.
4. **Nenhum log nem erro com coordenada:** as exceções novas (`match_sem_exact_point`, `match_grade_fora_do_dominio`, `match_versao_desconhecida`, `match_parametro_invalido`) trazem texto fixo, sem valor interpolado. O allowlist de logs (`packages/observability`) não muda.
5. **Gatilho e funções puras:** `match_grid` e `match_grid_dlon` só recebem número e devolvem número; podem ser `execute` somente para `app_system`.
6. **Fora desta Issue (herdado, deve virar critério):** H-032 (view de profissional) e H-023 (rota). Teste de contrato de resposta com papel de profissional cobre as rotas quando existirem; aqui o contrato é do banco.
7. **Duplicidade ≤ 100 m (H-030):** `match_point` é grosseiro demais (500 m) para decidir 100 m. Pela decisão 56, a duplicidade roda na publicação, dentro do banco, sobre `exact_point`, em função própria de H-030; nunca sobre `match_point`. Registrado como consequência.

## 8. Testes (todos locais, sem rede; dados 100 % sintéticos, RF-163)
Arquivos `[PROPOSTA]`: `packages/db/tests/geo-match-point.dbtest.mjs` (banco), `packages/db/tests/geo-match-point-migration.test.mjs` (estático, no padrão de `geo-geocode-point-migration.test.mjs`). Banco efêmero com PostGIS (já exigido pela baseline) para o oráculo.

| # | Teste | Critério |
|---|---|---|
| T-CA01 | Fluxo real: `geo_reserve` → `geo_store_permanent` grava `exact_point` e os 4 campos `match_*` na mesma linha; falha injetada no cálculo (ponto fora do domínio forçado por função de teste, ou versão inexistente) aborta a instrução: `state` continua `reservado`, `exact_point` e `match_*` nulos | CA-01, G-02 |
| T-CA02 | Mesma coordenada em 2 linhas e 2 execuções ⇒ mesmo `match_cell`, `match_lon`, `match_lat`; reaplicar `geo_store_permanent`/`reutilizar` não altera o valor | CA-02 |
| T-CA03 | 100.000 pontos sintéticos aleatórios com semente fixa no retângulo −74..−34 × −34..6, mais os extremos: máximo da distância haversine entre ponto e centro ≤ 355 m; imprime o máximo medido. Teste separado por faixa de latitude (Norte, Centro, Sul) | CA-03 |
| T-CA04 | Como dono: `INSERT/UPDATE` com `match_cell` e sem `exact_point` ⇒ erro 23514 (gatilho e CHECK); com `exact_point` e `geocode_mode` nulo ou não `permanent` ⇒ CHECK de selo já existente rejeita antes; `match_*` forjado com `exact_point` válido é sobrescrito pelo calculado; `num_nulls` entre 1 e 3 ⇒ CHECK | CA-04, G-05 |
| T-CA05a | Catálogo: para `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_api` e `app_system`, `has_table_privilege(..., 'select'/'insert'/'update'/'delete')` em `app.geocode_point` é falso; nenhuma view em qualquer schema referencia `exact_point` | CA-05, T-03 |
| T-CA05b | Catálogo de funções executáveis por `app_api`/`app_system`/`PUBLIC`: lista fechada (allowlist) das que referenciam `exact_point` no corpo; o tipo de retorno de `match_points_within` não tem `exact_point` nem `geography`; resultado de teste: coluna a coluna, nenhuma coordenada igual ao ponto exato semeado (semente com ponto longe do centro); `app_api` recebe `permission denied` na função | CA-05, I-16, B-16 |
| T-CA05c | Mensagens de erro e `raise` das funções novas, forçadas com canário numérico: o valor do canário não aparece no texto | CA-05 |
| T-CA06 | Dois pontos distintos na mesma célula: `match_points_within` com a mesma base devolve linhas idênticas (mesmos `match_lon/lat` e `distance_m`); 20 bases diferentes em torno e resposta nunca contém nada que distinga os dois pontos | CA-06 |
| T-CA07 | Oráculo: o mesmo conjunto sintético (20.000 pontos, raios 5, 20, 50 e 100 km, 10 bases) consultado por `match_points_within` e por `ST_DWithin(geography, geography, R, false)` com `use_spheroid=false` sobre `match_lon/match_lat`; o conjunto de `subject_id` é idêntico fora da faixa `|d − R| ≤ 10 m`, que o teste exclui e conta (relata quantos pontos excluídos). Usa a esfera, não o elipsoide | CA-07, S-02 |
| T-CA08 | 50.000 pontos, `analyze`, `explain` do SQL da função (janela): contém `geocode_point_match_cell_idx`; não contém `Seq Scan on geocode_point`; imprime o tempo medido | CA-08, R-05 |
| T-CA09 | Extremos: Oiapoque/Monte Caburaí (norte), Chuí (sul), Ponta do Seixas (leste), Serra do Divisor (oeste) e os quatro cantos da caixa; cada um recebe célula, centro dentro de −75..−33 × −35..7 e erro ≤ 355 m. Fronteira: ponto com `lat_µ = LAT0_µ + k × DLAT` e ponto 1 µ° abaixo ⇒ linhas `k` e `k−1`; idem para coluna em uma linha; "ida e volta": a célula do centro é a própria célula; contagem de células distintas que contêm o ponto = 1 | CA-09 |
| T-CA10 | Banco com linhas antigas: aplica as migrações anteriores, semeia linhas `ok` (com `exact_point`), `aguardando` e `sem_resultado` sem as colunas novas, aplica a nova migração: `ok` ganham `match_*`, as demais ficam nulas, contagem de linhas igual; aplica **duas vezes** (idempotência); aplica o `.down.sql`: colunas, gatilho, funções e índice somem, `exact_point` e `geo_*` intactos; reaplica a migração ⇒ volta | CA-10 |
| T-DOUR | Valores dourados: 30 coordenadas fixas (incluindo os extremos) com `match_cell` e centro esperados, gravados como fixture no repositório; detectam mudança de comportamento da libm ou edição da grade | CA-02, risco R3 |
| T-SEG | Estático: a migração nova cria funções com `search_path = ''`; só `app_system` tem execute; o `.down.sql` existe; não há coluna `lat/lon/point/geom` em outras tabelas fora da lista fechada | padrão do repo |

Evidência exigida na Issue: comando exato, contagem de passou e falhou e código de saída (`corepack pnpm check:all`, `db:test`), sem declarar CI verde (regra de builds locais).

## 9. Riscos e dúvidas

### Riscos
| # | Risco | Mitigação |
|---|---|---|
| R1 | **Dependência de PostGIS no gatilho** (st_x/st_y). Se um ambiente não tiver PostGIS, a escrita falha. | PostGIS já é exigido pela tabela (`geography`) e pelo baseline; a consulta não depende. Se S-02R mudar, trocar a leitura de x/y por colunas numéricas é mudança local de uma função |
| R2 | **Grade por linhas não é padrão:** manutenção e erro de implementação. | Constantes inteiras, função pura única, valores dourados (T-DOUR), teste de fronteira e de ida e volta |
| R3 | **libm de outro build do Postgres muda um empate de `round`:** célula divergente de uma versão do banco para outra. | Arredondamento a inteiro; fixture dourada; local, Supabase Free e CI usam o mesmo Postgres 15/17 do projeto `[NÃO VERIFICADO]` fora do banco local. Mudou ⇒ detectado no teste, não em produção |
| R4 | **Distância esférica ≠ geodésica (≤ 0,3 %).** Pedido a 100 km pode entrar ou sair por ≈ 300 m. | Aceitável para casamento; documentado; H-023 decide compensar. Não prometer metro exato ao usuário |
| R5 | **Consulta de 100 km tem ≈ 400 faixas.** Pode custar mais que um GiST em volume alto. | Índice parcial com `include`; meta medida em T-CA08; swap para GiST sobre `match_lon/lat` (PostGIS) é possível sem mudar colunas, se o benchmark em 50.000 não passar |
| R6 | **Mudança de versão da grade** deixa pedidos em versões diferentes. | Versão gravada por linha; consulta filtra por versão; versão nova exige backfill antes de virar padrão (§2.2) |
| R7 | **`match_point` não decide duplicidade** (500 m vs 100 m). | Decisão 56: duplicidade usa `exact_point` dentro do banco, na publicação (H-030) |
| R8 | **Linhas de teste/retenção:** `geo_purge_subject` apaga a linha inteira, junto de `match_*`. | Sem ação; confirmar no teste de retenção existente |
| R9 | **Vazamento por distância:** `distance_m` ao centro, repetido de muitos pontos, delimita a célula. | Aceito por construção (precisão = célula); limitar volume de consultas é de H-023/H-024 (rate limit) |

### Dúvidas não bloqueantes (para o líder consolidar; recomendação do Architect)
1. **Limite de erro do teste em 355 m e tolerância de 10 m** (CA-03, CA-07). Recomendação: aceitar.
2. **Gatilho que sobrescreve `match_*`** em vez de rejeitar valor divergente. Recomendação: aceitar (a função pura é a fonte da verdade; SQL direto não consegue criar inconsistência).
3. **`match_point` em `app.geocode_point`**, não em `service_request` (09 §3.4 a ajustar pelo líder, junto dos ajustes de 68 §9). Recomendação: aceitar.
4. **A consulta devolve `distance_m` ao centro da célula.** Alternativa: devolver só faixa (ex.: arredondar a 100 m). Recomendação: manter inteiro agora; H-023 pode arredondar sem mudar a migração.
5. **Sequência de H-023 e H-032:** H-023 consome `match_points_within`; H-032 define a view e o rótulo. Nenhum dos dois pode ler `app.geocode_point` por outro caminho. Recomendação: registrar o critério herdado nas duas Issues.

## 10. Entrega ao DEV `[PROPOSTA]`
Ordem: (1) função pura `match_grid`/`match_grid_dlon` e fixture dourada, com T-CA03, T-CA09, T-DOUR; (2) colunas, CHECKs, gatilho e preenchimento, com T-CA01, T-CA02, T-CA04, T-CA10; (3) função de consulta e índice, com T-CA05, T-CA06, T-CA07, T-CA08; (4) arquivo `.down.sql` e T-SEG. Arquivos: a migração e o rollback acima, os dois testes, e uma linha em 09 §3.4 ajustada pelo líder. Nenhum arquivo de `apps/api` muda nesta Issue (nenhuma rota nova).

## 11. Ajustes de documentos (a cargo do Orquestrador, exceto o que foi feito aqui)
- **Feito:** `11-DECISOES.md` linhas 56 e 57; `14-BACKLOG.md` H-022: rastro "09 §9.1–9.2" → "08 §9.1–9.2".
- **Pendente (decisão 56):** ajustar H-030, H-024 e FA-002 (duplicidade e cobertura na publicação, revisão mostra só o texto do endereço); 09 §3.4 (`match_*` em `geocode_point`).
