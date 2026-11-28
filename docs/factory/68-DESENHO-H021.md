# Desenho H-021 — Coordenada permanente, uma chamada na publicação (Issue #34, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 9 dúvidas não bloqueantes para o desenvolvimento de H-021 (§10). A dúvida 1 afeta o desenho de H-030/H-024 e deve ser decidida antes dessas Issues.
- **Rastro:** 66-REFINO-H021 (CA-1..CA-6); decisão 46 (BK-2 opção b) e decisão 29 (`11-DECISOES.md`); 08 §9.4–§9.5; 09 §3.4; 10 ADR-008, ADR-013, ADR-014; 11-ARQ I-28, R-04, R-36, G-02..G-07; 14-BACKLOG H-021, H-022, H-024, H-025, H-030, H-031, H-036, H-108; 56-DESENHO-H020; S-04-RESULTADO (§2.7, §4); código lido (somente leitura): `apps/api/src/geo/*`, migrações `20261110120000`, `20261110130000`, `20261111120000`, `20261111170000`, `20261111260000`, `packages/observability/src/allowlist.json`, `.env.example`.
- **Natureza:** documento. Nenhum código, migração, conta, chave ou chamada externa foi criado ou feito.
- **Etiquetas:** `[DECIDIDO]` decisão do usuário ou do Orquestrador · `[VERIFICADO]` lido nos documentos ou no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de conta, chave ou prova em desenvolvimento.

## 0. Princípio e achados

**Princípio.** A coordenada exata é guardada **uma vez**, no momento de publicar, a partir de **uma** resposta do Geocoding v6 com `permanent=true`. Nada anterior à publicação (rascunho, revisão, edição, autocomplete) chama o modo pago. Nada temporário vira coordenada. O navegador nunca fala com o Mapbox e **nunca recebe latitude ou longitude** (S-04 §4 item 1).

**Achados que moldam o desenho**
1. `[VERIFICADO]` As tabelas `request_draft`, `service_request` e `professional_area` **ainda não existem** (nenhuma migração as cria; só `ops.*`, `private.*` e a base). H-021 depende apenas de H-020 e H-005; H-025 (rascunho), H-030 (revisão) e H-031 (publicação) vêm depois e usam H-021. Portanto H-021 não pode "alterar a coluna de uma tabela futura": entrega um bloco autônomo e testável (§2, §3) que as Issues seguintes chamam.
2. `[VERIFICADO]` 09 §3.4 prevê `exact_point`, `geocoded_at` e `geocode_calls` em `request_draft` (modelo da decisão 29, "na revisão"). Com a opção (b) o rascunho **não guarda coordenada**; isso muda 09, 08 §9.5 item 3, 11 (I-28, G-02..G-04) e 14 (H-021, H-024, H-030). Lista de ajustes em §9.
3. `[VERIFICADO]` Reaproveitáveis: `ops.external_quota` (PK `service, period, period_start`; `used <= hard_limit`; `alert_level` 0..3; `breaker_state`), padrão da função `private.mapbox_temp_quota_take`, `private.rl_check/rl_hit`, `ops.idempotency_key` (H-005), `.env.example` já com `MAPBOX_ACCESS_TOKEN_SERVER`, `MAPBOX_PERMANENT_SOFT_LIMIT`, `MAPBOX_PERMANENT_HARD_LIMIT`, schemas `app`, `ops`, `private`, papéis `app_system` (BYPASSRLS) e `app_api`, PostGIS no schema `extensions` (baseline).
4. `[VERIFICADO]` Allowlist de log já tem `event`, `error_code`, `count`, `resource_id`, `status`, `duration_ms`: nenhum campo novo é necessário.
5. `[DECIDIDO]` Plano B do ADR-008 (leitura **temporária em memória** para duplicidade/cobertura) **não** é usado aqui: a decisão 46 diz só "chamada paga somente na publicação". Ver dúvida 1.

## 1. Escopo de H-021 e fronteira com as Issues vizinhas

| Entrega de H-021 `[PROPOSTA]` | Fica com outra Issue (critério herdado, registrar nelas) |
|---|---|
| Serviço de servidor `ensurePermanentPoint` (§3), adaptador Mapbox permanente (§4), portas, domínio puro | H-031: chama o serviço dentro de "publicar"; H-036: idem ao salvar a base do profissional |
| Tabela `app.geocode_point` com CHECKs, teto por assunto e única função de gravação (§2) | H-025: o rascunho **não** cria `exact_point`, `geocoded_at`, `geocode_calls`; guarda só o texto |
| Cota/breaker `mapbox_permanent` e função de leitura para o painel (§5) | H-108: tela do painel; H-092: e-mail de alerta |
| Contrato "retorna referência, nunca coordenada" (§3.3) | H-022: `match_point` e célula; H-030: aviso de duplicidade usando o ponto (§3.5) |

Sem rota pública `geocode`. Motivo: uma rota de geocodificação alcançável pelo navegador seria um geocodificador aberto (S-04 §2.7.1) e levaria coordenada ao cliente (§2.7.3 iv). `[DECIDIDO por S-04, item 1]`.

## 2. Dados: como o CHECK e a função única garantem I-28

### 2.1 Tabela `app.geocode_point` `[PROPOSTA]`
Única tabela do sistema que contém coordenada exata de pedido ou de base. Sem catálogo de endereços: uma linha por (assunto, texto de endereço) (S-04 §4 item 4).

| Coluna | Regra |
|---|---|
| `id uuid` PK | `gen_random_uuid()` |
| `subject_kind text` | CHECK `in ('request','professional_base')` |
| `subject_id uuid` | pedido: identificador lógico da cadeia de republicação (dúvida 3); base: o profissional |
| `address_hash text` | HMAC-SHA256 hex (64) do endereço normalizado (NFC, aparado, espaços colapsados, minúsculas), com a família `PEPPER_*` já existente; o texto em claro **não** vai para esta tabela |
| `state text` | CHECK `in ('aguardando','reservado','ok','sem_resultado')` |
| `exact_point extensions.geography(Point,4326)` | nulo exceto em `ok` |
| `geocode_mode text` | nulo ou `'permanent'` |
| `precision text` | tipo devolvido (endereço, rua, bairro, localidade); nulo exceto em `ok` |
| `geocoded_at`, `reserved_at`, `created_at` | `timestamptz` |
| UNIQUE `(subject_kind, subject_id, address_hash)` | idempotência do pagamento (§3.2) |

**CHECKs que garantem I-28 mesmo contra SQL direto (G-05)**
- `exact_point is null or geocode_mode = 'permanent'`: coordenada sem o selo permanente é rejeitada.
- `geocode_mode is null or geocode_mode = 'permanent'`: nenhum outro valor existe (não há 'temporary' no domínio).
- `(state = 'ok') = (exact_point is not null)`: ponto e estado andam juntos.
- Limites do ponto dentro do Brasil: `ST_X` entre -74,0 e -34,0 e `ST_Y` entre -34,0 e 6,0 (caixa aproximada, conhecimento geral, `[PROPOSTA]`; barra lixo e inversão de eixos).

### 2.2 Teto por assunto na própria tabela `[PROPOSTA]`
`app.geocode_budget(subject_kind, subject_id, calls smallint)`, PK `(subject_kind, subject_id)`, CHECK `calls >= 0` e `subject_kind <> 'request' or calls <= 3`. O teto de 3 (decisão 29) é imposto pelo banco, não só pelo código (G-04 por SQL). Para `professional_base` o teto não é fixado aqui (G-07 fala em limite de taxa; decisão de H-036).

### 2.3 Única função de gravação `[PROPOSTA]`
- Nenhum papel recebe `insert/update/delete` em `app.geocode_point` e `app.geocode_budget` (nem `app_system`, nem `app_api`; RLS habilitada e forçada, sem políticas, padrão do repositório). Leitura direta também revogada: só funções.
- Funções `security definer`, `search_path = ''`, `execute` somente para `app_system`, no schema `private`:
  - `geo_reserve(kind, subject, hash, now, lease_s, soft, hard)` ⇒ `{acao, ref}` com `acao ∈ reutilizar | chamar | em_andamento | teto | breaker | sem_resultado` (§3.2, §5).
  - `geo_store_permanent(ref, mode, lon, lat, precision, now)`: **único** ponto que escreve `exact_point`. Exige a linha em `reservado`, `mode = 'permanent'` (senão `raise`), coordenada finita e dentro da caixa; grava `geocode_mode = 'permanent'` por literal.
  - `geo_mark_no_result(ref, now)` (resposta sem endereço) e `geo_release(ref)` (falha do provedor; §3.4).
  - `geo_panel(now)` (§5.3) e `geo_purge_subject(kind, subject)` (§9, retenção).
- **Limite honesto `[VERIFICADO]`:** o banco não consegue saber se os números vieram de resposta permanente ou temporária; o CHECK prova que o selo existe e a função só aceita o selo. A procedência é garantida pela **composição**: o único módulo que produz o tipo `PermanentGeocode` é o adaptador permanente (§4), que sempre envia `permanent=true`; o adaptador temporário de H-020 não exporta coordenadas (já devolve só rótulos) e não pode importar o tipo (teste estático em `check:boundaries`, §7 item 11). Isto é a defesa em profundidade de I-28: CHECK + função única + tipos + teste estático + teste de proveniência (§7).

### 2.4 Leitura do ponto
Somente dentro do banco, por funções internas das Issues seguintes (ex.: H-022 calcula `match_point`; H-030/H-031 comparam a ≤ 100 m com `ST_DWithin`). Nenhuma função devolve `lon/lat` ao NestJS para resposta; o tipo de retorno do serviço não tem coordenada (§3.3).

## 3. Fluxo da publicação

### 3.1 Passos (H-031 chama; H-021 define o contrato do passo de geocodificação)
0. `Idempotency-Key` (H-005): mesma chave e mesmo corpo repete a resposta guardada; em andamento ⇒ 409; mesma chave com corpo diferente ⇒ 422. É a idempotência da **publicação**. A idempotência do **pagamento** é outra, na tabela (§3.2).
1. **Verificações sem custo, antes de qualquer chamada paga:** rascunho do dono (nonce e sessão), estado aberto, campos completos, e-mail verificado (I-05), limite de taxa de publicação (H-031), texto do endereço válido (tamanho e caracteres, mesma normalização de H-020).
2. Normaliza o endereço e calcula `address_hash`.
3. `ensurePermanentPoint(kind='request', subject, addressText)` ⇒ um destes desfechos:
   - `ok` ⇒ segue (já existia ou acabou de ser obtido);
   - `em_andamento` ⇒ 409 com `Retry-After: 2` (outra publicação do mesmo endereço em curso);
   - `teto` ⇒ 422 `geocode_limit`, **sem custo** (3 endereços diferentes já usados neste pedido);
   - `endereco_nao_encontrado` ⇒ 422, texto preservado, o cliente corrige; **sem nova chamada** para o mesmo texto (§3.2);
   - `aguardando_geocodificacao` ⇒ 202, ver §5;
   - `indisponivel` ⇒ 503 com `Retry-After`, rascunho intacto (§3.4).
4. Com `ok`: verificação de duplicidade usando o ponto (H-030/H-031, §3.5); depois cria o pedido e o evento (outbox) numa transação, referenciando o `geocode_point.id`.

**Transação separada, de propósito.** A linha da geocodificação é confirmada (commit) **antes** e **fora** da transação de publicar. Uma chamada paga não pode ser desfeita por rollback; se a criação do pedido falhar, a repetição encontra a linha `ok` e **não paga de novo** (CA-2).

### 3.2 Idempotência e concorrência do pagamento (CA-1, CA-2)
`geo_reserve`, numa única transação do Postgres (sem leitura-depois-escrita):
1. Linha `(kind, subject, hash)` em `ok` ⇒ `reutilizar` (sem chamada, mesmo ponto).
2. Em `sem_resultado` ⇒ devolve `sem_resultado` (o mesmo texto nunca é cobrado duas vezes; o cliente precisa mudar o texto).
3. Em `reservado` com `reserved_at` dentro do prazo de concessão `lease_s` (`[PROPOSTA]` 60 s, configurável) ⇒ `em_andamento`. Vencido ⇒ trata como livre (função serverless pode morrer entre reservar e gravar; conservador: nova reserva também consome teto e cota).
4. Livre ou `aguardando` ⇒ confere o teto (`geo_budget.calls < 3`); se estourou ⇒ `teto`. Em seguida pega uma unidade da cota mensal (§5.1); se recusada ⇒ `breaker` (nada foi consumido do teto: a ordem é teto, cota, incremento). Só então incrementa `calls`, marca `reservado` e devolve `chamar`.
5. N publicações simultâneas do mesmo endereço: exatamente uma recebe `chamar`; as outras recebem `em_andamento` ou, se a primeira já terminou, `reutilizar`.

Chave de idempotência do pagamento = `(assunto, HMAC do texto)`. Repetir a publicação, repetir com outra `Idempotency-Key`, duplo clique ou retry de rede: **uma** chamada.

### 3.3 Contrato do serviço (impede vazamento de coordenada por construção) `[PROPOSTA]`
`ensurePermanentPoint(...)` devolve `{ status: 'ok', pointId }` ou um código de §3.1. O tipo **não tem** latitude, longitude, `mapbox_id`, rótulo nem resposta bruta. Quem publica passa `pointId` ao banco. Teste de contrato: nenhuma resposta de API do pedido ou da base contém par de números com cara de coordenada (S-04 §5).

### 3.4 Falha do provedor
Tempo esgotado, 5xx, 401/403, 429, JSON malformado, caixa do Brasil violada ou tipo grosseiro demais (dúvida 8): `geo_release(ref)` apaga a reserva e devolve a unidade de **teto** (não houve resultado; `[NÃO VERIFICADO]` se o Mapbox cobra falhas, por isso a unidade da **cota mensal e do gasto estimado fica consumida**, conservador). Resposta 503 `indisponivel`, rascunho aberto, **sem nova tentativa automática**. O freio contra tentativas repetidas é o limite de taxa de publicação (H-031) mais o breaker de gasto (§5); sem número novo aqui. Alternativa mais estrita (falha conta no teto): dúvida 4.

### 3.5 O que H-030 e H-031 precisam saber (consequência da opção b)
Sem coordenada na revisão, o aviso de duplicidade e a cobertura da revisão (AMB-03 B) não têm ponto para consultar. Recomendação (dúvida 1): duplicidade é avaliada **dentro** da operação de publicar, depois do passo 3; havendo possível duplicata e sem `duplicate_ack`, responde 409 `duplicate_warning` (sem criar o pedido; o ponto já está gravado), o cliente confirma e a nova tentativa reaproveita o ponto sem nova chamada; cobertura passa a ser mostrada no estado do pedido já publicado (AMB-03 A).

### 3.6 Cenário de custo (só valores dos documentos: lista de US$ 0,005 por chamada permanente, 08 §9.5, S-04 §3)
| Cenário | Chamadas permanentes | Custo |
|---|---|---|
| Rascunho abandonado ou editado, nunca publicado | 0 | US$ 0 |
| Publicação sem repetir endereço | 1 | ≈ US$ 0,005 |
| Publicação com repetição, retry ou duplo clique | 1 | ≈ US$ 0,005 |
| Pior caso do teto (3 endereços diferentes) | 3 | ≈ US$ 0,015 |
| Aviso de duplicidade abandonado após o ponto gravado | 1 | ≈ US$ 0,005 (sem pedido) |
A hipótese "1,3 chamadas por pedido" de 08 §9.5 era para a revisão e **não foi reestimada** sob (b) `[NÃO VERIFICADO]`.

## 4. Proxy no servidor (o navegador nunca chama o Mapbox)

- **Onde:** `apps/api/src/geo/` (NestJS/serverless, mesma árvore de H-020). Sem rota nova. Quem chama é código de servidor de H-031/H-036 após autenticar e validar. O token vive só em `MAPBOX_ACCESS_TOKEN_SERVER`.
- **Adaptador `mapbox-permanent-adapter` `[PROPOSTA]`:** `GET /search/geocode/v6/forward` com `q`, `permanent=true`, `autocomplete=false`, `limit=1`, `country=br`, `language=pt`, `types` de endereço/rua/bairro/localidade, `access_token`. `fetch` injetado; `cache: 'no-store'`, `credentials: 'omit'`, `redirect: 'error'`, sem cookies, sem IP nem cabeçalhos do cliente; tempo máximo `[PROPOSTA]` 4 s (a chamada paga roda numa ação do cliente já esperando, não por tecla); **nenhuma retentativa**. Exceção ou status ruim vira código fixo (`provider_timeout|5xx|auth|429|shape`); mensagem, `cause` e URL (que contém texto e token) nunca vão ao logger (mesmo invólucro de H-020, §5 do 56).
- **Mapeamento mínimo:** extrai somente `lon`, `lat` (números finitos, dentro da caixa) e o tipo (`precision`). Descarta rótulo, `mapbox_id` e o restante (S-04 §4 item 5). Forma exata da resposta v6 (`geometry.coordinates`, `properties.feature_type`) `[NÃO VERIFICADO]`; leitura defensiva; fixtures sintéticas marcadas como tais.
- **Porta:** `GeocodingPermanentPort.geocode(text)` (distinta de `GeocodingTempPort`). Nenhum caminho de código passa resultado temporário a `geo_store_permanent`.
- **Credencial:** token dedicado de servidor, escopo mínimo, nunca em bundle do cliente nem em log (reaproveita testes estáticos de H-020). Mesmo token do temporário é aceitável em desenvolvimento; separá-los em produção é recomendável (dúvida 7).

## 5. Breaker de gasto (CA-5)

### 5.1 Cota `[PROPOSTA]`
`ops.external_quota(service='mapbox_permanent', period='mes', period_start = 1º dia do mês UTC)`; função `private.mapbox_permanent_quota_take(now, soft, hard)` no mesmo molde da de H-020 (`UPDATE ... SET used = used + 1 WHERE used < hard`, atômico; cruzar `soft` uma vez ⇒ `alert_level=1`; recusa ⇒ `breaker_state='aberto'`, `alert_level=2`). Chamada **dentro** de `geo_reserve` (ordem de §3.2). Unidade: **chamadas**; gasto estimado = `used × US$ 0,005` (preço de lista, indicado como estimativa; a fatura da Mapbox é a verdade).
- Tetos `MAPBOX_PERMANENT_SOFT_LIMIT` e `MAPBOX_PERMANENT_HARD_LIMIT` vêm do ambiente; **sem valor no código**; **ausentes ou inválidos ⇒ fechado** (toda tentativa cai em `breaker`, nenhuma chamada paga). O limite em dólar da conta Mapbox (feito pelo usuário) é a rede de segurança externa; o contador do proxy deve ficar **abaixo** dele: `hard × 0,005` menor que o limite da conta (conferência manual no runbook; o sistema não lê a conta). Valores: o usuário define (dúvida 7; D-2 do PO).
- Aumentar o teto (variável de ambiente) reabre o breaker na chamada seguinte (`used < hard` ⇒ `breaker_state='fechado'`); novo mês cria linha nova.

### 5.2 Comportamento com o breaker aberto
1. Nenhuma chamada ao Mapbox (zero), nenhuma resposta temporária usada no lugar (CA-5, CA-6).
2. `geo_reserve` devolve `breaker` e grava (ou mantém) linha `(assunto, hash)` em `state='aguardando'`, **sem** consumir teto nem cota. A linha guarda só o HMAC: o texto do endereço permanece **no rascunho do cliente**, intocado ("texto preservado").
3. Resposta ao cliente: **202** `{ code: 'aguardando_geocodificacao' }`, mensagem neutra: "Não conseguimos confirmar o endereço agora. Seu pedido está salvo e você pode tentar publicar de novo mais tarde." Sem mencionar custo ou limite. O pedido **não** é publicado. A resposta de aguardo **não** é guardada como concluída em `ops.idempotency_key` (liberar a chave), para o novo clique valer `[PROPOSTA]`.
4. H-031/H-034 mostram o estado "aguardando geocodificação" no painel do cliente e oferecem "tentar publicar de novo" (rascunho segue editável). **Não há publicação automática** na reabertura (dúvida 5): publicar fixa o prazo de aceite de 7 dias a partir de `published_at`; publicar sem o cliente presente, dias depois, contraria "nenhuma publicação automática" (H-030).
5. Reabertura: próximo clique, com teto novo ou mês novo, segue o fluxo normal e paga uma chamada.

### 5.3 Contador no painel e alertas `[PROPOSTA]`
- `private.geo_panel(now)` devolve `{used, soft, hard, pct, breaker_state, alert_level, gasto_estimado_usd_lista, aguardando}` (`aguardando` = linhas `state='aguardando'`). H-021 prova a função em teste de banco; a **tela** é de H-108 (critério herdado; dúvida 6).
- Alerta: `novo_alerta` ⇒ evento de log `mapbox_permanent_quota_alert` com `count` e e-mail à operação pela fila de H-092 (em desenvolvimento só Mailpit, sem envio real; regra do projeto). Um alerta por nível por mês.

## 6. Segurança, privacidade e logs
- Log do fluxo: `event`, `route`, `status`, `duration_ms`, `error_code`, `count`, `resource_id` (HMAC/pseudônimo); nunca texto do endereço, coordenada ou token. Códigos: `geocode_ok`, `geocode_reuse`, `geocode_cap`, `geocode_breaker`, `geocode_no_result`, `provider_*`.
- Coordenada é C3 (09): sem RLS permissiva, sem view para profissional; `exact_point` nunca em consulta de profissional (H-022/H-032).
- Uma requisição permanente por conta que depende do geocódigo (S-04 §4 item 3): o assunto do pedido é o cliente do pedido; **não reutilizar** o ponto de um usuário para outro (a duplicidade compara internamente e só devolve "possível duplicata" ao dono, sem dados de terceiros).
- Retenção: `geo_purge_subject` existe como mecanismo; prazos e base legal seguem `[PENDENTE JURÍDICO]` L1/L2 (ADR-016). Linhas `aguardando` e `reservado` vencidas são expurgadas junto com o rascunho (TTL de H-025).

## 7. Testes (sem rede real; G-02 a G-06 ajustados à opção b)

**Portas injetadas:** `GeocodingPermanentPort` simulada (cenários: ok, sem resultado, tempo esgotado, 500, 401/403, 429, JSON malformado, fora do Brasil, tipo grosseiro, e resposta "temporária" com coordenada-canário), `GeocodingTempPort` espiã, relógio falso, banco real do `db:test`. *Guard* global: `fetch`/`http.request` fora da porta falham o teste. Nenhum teste chama o Mapbox real.

| # | Teste | Critério |
|---|---|---|
| G-02' | Publicar com endereço completo: provedor chamado **1 vez** com `permanent=true` na URL; `geocode_point` em `ok`, `exact_point` presente, `geocode_mode='permanent'`, `precision` preenchido; `pointId` devolvido; nenhuma coordenada em resposta ou log | CA-1 |
| G-03' | Repetir a publicação (mesma chave; outra chave; 5 publicações paralelas; falha forçada da criação do pedido e nova tentativa): total de chamadas = 1, mesmo ponto, perdedoras em `em_andamento` ou `reutilizar`; sem custo extra | CA-2 |
| G-04a | Editar o endereço do rascunho 10 vezes (e revisar): **0** chamadas; o módulo de rascunho não consegue importar a porta permanente (teste estático) | CA-3 |
| G-04b | Publicar com 3 endereços diferentes: 3 chamadas, 4º ⇒ 422 `geocode_limit`, **0** chamadas, cota mensal inalterada; mesmo texto repetido não consome; `UPDATE geo_budget SET calls = 4` direto ⇒ CHECK; republicação da mesma cadeia herda o contador | CA-3, I-28 |
| G-05 | SQL direto como dono: `INSERT` de `exact_point` sem modo ⇒ CHECK; modo `'temporary'` ⇒ CHECK; ponto fora do Brasil ⇒ CHECK; como `app_system`/`app_api`: `permission denied`; `geo_store_permanent(..., 'temporary', ...)` ⇒ exceção; sem reserva prévia ⇒ exceção | CA-4 |
| G-06 | `used = hard`: **0** chamadas ao provedor e ao temporário; desfecho 202 `aguardando_geocodificacao`; linha `aguardando` sem ponto; texto do rascunho idêntico ao enviado; `geo_panel` mostra `used`, `hard`, `breaker_state='aberto'`, `aguardando=1`; `alert_level=2` uma vez; aumentar `hard` reabre; mês novo reabre; teto ausente ⇒ fechado; N chamadas paralelas ⇒ `used <= hard`; alerta em `soft` emitido uma vez | CA-5 |
| G-06b | Resposta de aguardo não vira idempotente concluída: nova chave/clique posterior funciona | CA-5 |
| G-I28a | Proveniência: resultado do fluxo temporário (H-020), mesmo escolhido pelo cliente, jamais chega a `geo_store_permanent`; varredura de `app.*`, `ops.*`, cache e logs pelas coordenadas-canário temporárias não acha nada | CA-6 |
| G-I28b | Estático (`check:boundaries`): só `permanent-geocode-service` importa o adaptador permanente e `geo_store_permanent`; o adaptador temporário não importa o tipo `PermanentGeocode`; nenhuma coluna `lat/lon/point/geom/mapbox_id` fora de `app.geocode_point` | CA-6 |
| G-F | Cada falha do provedor: 1 chamada, sem retentativa; reserva liberada; teto devolvido; cota mensal consumida; 503; token/URL/texto ausentes de logs e erros (teste "canário", T-11) | §3.4 |
| G-C | Contrato: respostas de publicação, painel do cliente e base do profissional sem par `lat/lon` nem `mapbox_id` | S-04 §5 |
| G-L | Reserva vencida (`lease`) é retomada; reserva viva devolve `em_andamento` | §3.2 |
| G-R | Rollback: `.down.sql` testado; rerrodar migração idempotente | padrão do repo |

`check:all` (`check:logs`, `check:secrets`, `check:boundaries`) continua verde; `.env.example` mantém os nomes existentes, sem valores. O *smoke* real com o Mapbox é manual, autorizado e pontual (fora do CI), e só depois de H-021 em Aguardando aprovação e do cartão e limite de gasto na conta (BLQ-EXEC).

## 8. Entrega ao DEV `[PROPOSTA]`
`packages/domain/src/geo/permanent-geocode.ts` (normalização, tipos `PermanentGeocode`, mapeamento, caixa do Brasil, códigos) · `apps/api/src/geo/{permanent-geocode-service,mapbox-permanent-adapter,ports}.ts` · migração `geo_create_geocode_point` (tabelas, CHECKs, funções, grants, cota `mapbox_permanent`) com `.down.sql` em `supabase/rollbacks/` · testes acima · documentação do runbook (teto e conferência com o limite da conta). Ordem: domínio puro → migração e testes de banco (G-05, G-06) → serviço com provedor simulado (G-02' a G-04, G-F) → testes estáticos.

## 9. Ajustes de documentos a cargo do Orquestrador
- **08 §9.5 item 3 e custo:** passar a "uma chamada na publicação"; remover a re-chamada por revisão; tabela de custo conforme §3.6.
- **09 §3.4:** `request_draft` sem `exact_point`, `geocoded_at`, `geocode_calls`; `service_request.exact_point/geocode_mode` e `professional_area.base_point` passam a referenciar `app.geocode_point` (dúvida 2).
- **11-ARQ:** I-28 (teto "por pedido", não "por rascunho"), G-02..G-04 reescritos (§7), R-04/R-36 (alternativa "permanente na publicação" agora adotada), G-06 com painel herdado por H-108.
- **14-BACKLOG:** H-021 (título e aceite), H-024 e H-030 (dúvida 1), H-025 (não grava coordenada), H-031 (chama o serviço, 409/202/422), H-036 (mesmo serviço), H-108 (tela do contador).
- **10 ADR-008:** alternativa (e) sai do plano B para "adotada em parte" (permanente só na publicação; **sem** leitura temporária em memória). S-04 §4 ("manter permanente na revisão") fica superado nesse ponto; a confirmação escrita do R1 à Mapbox continua pendente antes de produção.

## 10. Riscos e dúvidas

**Riscos**
1. **Cobertura e duplicidade na revisão perdem o ponto** (dúvida 1): efeito de produto, não técnico.
2. **Custo desde o primeiro pedido publicado e cartão obrigatório** (R-36): mitigado por breaker, teto de 3 e limite da conta; agora cai só em pedidos efetivamente publicados.
3. **Contador diverge da fatura** (falhas, retentativas da plataforma, contas compartilhadas): margem entre o teto do proxy e o limite da conta.
4. **Forma da resposta v6 e política de cobrança de falhas** `[NÃO VERIFICADO]`: adaptador defensivo; uma falha custa unidade de cota (conservador).
5. **Zona cinzenta contratual (S-04 R1)** do uso de coordenadas no casamento: segue pendente de confirmação escrita; não é bloqueio para desenvolver.
6. **Reserva órfã** por função serverless que cai: lease curta, retomada conservadora (pode pagar duas vezes numa falha rara).
7. **Tentativas repetidas com falha** não consomem o teto: limitadas por taxa de publicação e pelo breaker.
8. **Linha única de cota** sob pico: atualização atômica; contenção só em pico alto (mesmo risco aceito em H-020).

**Dúvidas ao Orquestrador (não bloqueiam H-021; o líder consolida e numera)**
1. **Duplicidade e cobertura na revisão sob a opção (b).** Sem ponto na revisão, H-030 (aviso de duplicidade) e H-024 (cobertura AMB-03 B) precisam mudar. Alternativas: (i) duplicidade dentro de "publicar" (409 `duplicate_warning`) e cobertura só depois de publicar; (ii) usar coordenada temporária em memória (plano B do ADR-008; leitura de termos mais frágil); (iii) ponto permanente também na revisão (volta à opção a). **Recomendação: (i).** Decidir antes de H-030/H-024.
2. **Tabela única `app.geocode_point`** em vez de colunas em `service_request`, `request_draft`, `professional_area` (divergência de 09 §3.4). Vantagem: um só caminho de escrita, um só CHECK, ponto fora de qualquer view de profissional. **Recomendação: adotar**; as tabelas futuras guardam `geocode_point_id`.
3. **O que é "um pedido" para o teto de 3:** o identificador lógico da cadeia de republicação (o rascunho de uma republicação herda o `subject_id`). **Recomendação: adotar**; H-031 registra o critério.
4. **Falhas do provedor devolvem a unidade do teto** (a cota mensal fica consumida). Alternativa mais estrita: toda tentativa conta no teto. **Recomendação: devolver**, para uma instabilidade do provedor não travar o cliente.
5. **Estado "aguardando": sem publicação automática e sem e-mail na reabertura** (o cliente volta e clica). **Recomendação: assim no MVP**; e-mail de reabertura pode virar melhoria.
6. **CA-5 "contador no painel":** H-021 entrega a função e o teste; a tela é de H-108, com critério herdado (mesmo precedente do `DraftGate` de H-020). **Recomendação: aceitar.**
7. **Valores de `SOFT/HARD` do proxy e token:** o usuário define o limite em dólar na conta Mapbox e o líder converte em chamadas (`hard × 0,005` abaixo do limite); ausente ⇒ fechado. Token de servidor dedicado ao permanente em produção. (D-2 do PO.) **Recomendação: assim.**
8. **Precisão mínima aceita e rótulo de bairro/cidade/UF:** aceitar `endereço`, `rua`, `bairro` e `localidade`; recusar mais grosseiro; guardar o rótulo de bairro/cidade/UF da **mesma** resposta (permitido guardar resultado permanente) para H-022/H-032, evitando uma segunda chamada paga. Forma `[NÃO VERIFICADO]`. **Recomendação: adotar**, confirmando com H-022.
9. **Teto de 3 por pedido (D-1 do PO) e termos da Mapbox:** manter o teto; manter a confirmação escrita do R1 como condição para produção, não para desenvolvimento.

## 11. Evidências e estado
Fonte: leitura dos documentos e arquivos citados. Nenhum teste, build, consulta ao Project ou ao GitHub (documento). Árvore de trabalho não alterada além deste arquivo. Chamadas externas: nenhuma.
