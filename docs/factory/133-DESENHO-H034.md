# Desenho técnico H-034 — Painel do cliente na sessão do dono (Issue #47)

- **Issue:** #47 `[E3] Painel do cliente na sessão do dono` · **História:** H-034 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `130-REFINO-H034.md` (CA-01 a CA-16, RN-H034-01 a 08), `11-DECISOES.md` Rodada 98 (456, 457, 458, 459, 460, 461, 464 e as demais adotadas como recomendadas), `127-DESENHO-H032.md` (padrão da #45), `129-DESENHO-H033.md` (padrão de migração, RLS e grants; prefixo `20261113250000` reservado à #46). Leitura de código: `supabase/migrations/20261113010000_requests_create_service_request.sql` (enum de estado, índices), `apps/api/src/requests/detail-route.ts`, `publish-route.ts`, `apps/api/src/drafts/draft-service.ts` (cookie de limpeza), `packages/db/src/request-visibility.ts`, `packages/domain/src/request/visibility.ts`.
- **Etiquetas:** `[DECIDIDO n]` · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§13).

## 0. Achados da leitura que mudam o refino

1. `[VERIFICADO]` **O estado do pedido é fechado em quatro valores:** `service_request.status in ('publicado','selecionado','concluido','cancelado')`. Não existe `expirado` (decisão 456 confirmada). O prazo é imutável: `acceptance_deadline_at = published_at + interval '168 hours'` (CHECK da #44).
2. `[VERIFICADO]` **Já existe índice do painel**, mas ele não serve à ordem pedida: `service_request_cliente_status_idx (customer_user_id, status)` (o comentário da migração da #44 o atribui à #47). A ordenação `published_at DESC, id DESC` com cursor pede um índice novo `(customer_user_id, published_at desc, id desc)`. O de `09` (`customer_user_id, status, published_at DESC`) só ajudaria com filtro de estado; a decisão 462 recomenda lista sem filtro. `[PERGUNTA 521]`.
3. `[VERIFICADO]` **`acceptancesCount` existe no código da #45** (decisão 457 manda tirá-lo da resposta do dono): `packages/domain/src/request/visibility.ts` (lista `owner`, linha 22), `packages/db/src/request-visibility.ts` (tipo e mapeamento `out_acceptances_count`), `packages/domain/tests/request-visibility.test.ts`, `apps/api/tests/request-detail-route.test.ts`, `request-detail-service.test.ts`, `packages/db/tests/request-visibility-adapter.test.ts` e a função SQL `private.request_owner_get` (migração `20261113230000`). A #47 **não edita** esses arquivos; a remoção é correção da #45 (§9, `[PERGUNTA 516]`). A coluna `service_request.acceptances_count` continua existindo (é do domínio de aceite) e o painel nunca a lê.
4. `[VERIFICADO]` **A rota do dono da #45 já existe:** `GET /v1/requests/:id` (`REQUEST_OWNER_PATH_PREFIX = '/v1/requests/'`) em `detail-route.ts`; a do profissional é `GET /v1/professional/requests/:id`. A lista `GET /v1/requests` (sem barra final e sem id) não colide com o prefixo `/v1/requests/`. `[NÃO VERIFICADO]` se o `POST` de publicação usa o mesmo caminho `/v1/requests`; como o método difere, o despacho em `app.ts` precisa olhar o método (DEV confere).
5. `[VERIFICADO]` **O cookie de limpeza do rascunho já existe:** `draft-service.ts` (linha 211) devolve `'Set-Cookie': DRAFT_CLEAR_COOKIE_HEADER` ao apagar o rascunho. O DEV acha a definição com `grep -rn DRAFT_CLEAR_COOKIE_HEADER apps/api/src`. A decisão 460 se resolve **reutilizando** esse valor, sem cookie novo.
6. `[VERIFICADO]` **`apps/web/src` só tem `index.ts` e `media/`.** Não há tela de produto. `[NÃO VERIFICADO]` qual é a casca de páginas (framework). `[PERGUNTA 518]`.
7. `[VERIFICADO]` Migrações: última existente `20261113250000_contact_create_phone_consent.sql` (#46); `20261113240000` está livre, mas reservado à M2 da #45 (Rodada 94). A #47 usa **`20261113260000`** (maior que todas).

## 1. Decisões de arquitetura

| # | Decisão | Alternativa recusada | Motivo |
|---|---|---|---|
| D-01 | **Uma migração expansiva** (`requests_expand_customer_panel`): um índice e uma função `private`. Sem coluna, sem tabela, sem contração. | Estender `request_owner_get` com lista | Função de lista própria evita editar a da #45 (em Code Review) e permite catálogo de colunas de saída (CA-16) `[DECIDIDO 464]` |
| D-02 | **Função de lista separada da de detalhe:** `private.request_list_owner`. O detalhe é **o da #45, sem cópia**. | Lista que já traz descrição e endereço | O painel não decifra nada; a lista funciona mesmo sem `ADDRESS_ENC_KEY` |
| D-03 | **Estado do prazo calculado no banco com o relógio injetado** (`p_now`, vindo do relógio da API), não gravado. `aberto` se `p_now < acceptance_deadline_at`, `encerrado` se `p_now >= acceptance_deadline_at`. Nulo quando o estado do pedido não é `publicado`. | Job que grava; `now()` do banco | P4 (sem job) e teste de fronteira com relógio fixo (CA-05); `now()` impediria o teste `[PERGUNTA 517]` |
| D-04 | **Paginação por cursor com chave `(published_at, id)`**, página de 20, busca de 21 para saber se há próxima. **O cursor trafega como texto com microssegundos** (`out_cursor_ts text`), nunca como `Date` de JS. | Offset; cursor com `Date` | Offset repete ou perde linhas quando entra pedido novo; `Date` perde microssegundos e quebraria o empate |
| D-05 | **O painel não grava nada e não audita** (RN-H034-06), igual à #45. | Evento "painel aberto" | Sem valor e sem PII a proteger |
| D-06 | **Rotas separadas:** nova `GET /v1/requests` em `list-route.ts`; `detail-route.ts` **não é editada**. | Estender o arquivo da #45 | Zero conflito de arquivo com a #45 em Code Review |
| D-07 | **Composição própria da lista** (`list-composicao.ts`), que exige só `DATABASE_URL_APP_SYSTEM` e as sessões, **sem `ADDRESS_ENC_KEY`**. | Montar junto de `detail-composicao.ts` | Sem a chave, o detalhe fecha (404/503 seguro), mas a lista continua útil |
| D-08 | **Cookie do rascunho expirado na resposta de sucesso da publicação**, reutilizando `DRAFT_CLEAR_COOKIE_HEADER`. Mudança **só aditiva** (um cabeçalho). `[DECIDIDO 460]` | Rota de limpeza; manter | Decisão 460; reduz a exposição da dívida 407 |
| D-09 | **Textos e rótulos em módulo de domínio puro** (sem rede, sem DOM), fonte única para tela e testes. | Texto solto na tela | CA-06 e CA-09 varrem o texto uma vez só |

## 2. Visão geral do fluxo

```
Lista:     GET /v1/requests[?cursor=...]
             -> cookie de sessão -> authenticate -> request_list_owner(user, agora, cursor, 21)
             -> corta em 20, monta nextCursor -> { items, nextCursor }   (no-store)
Detalhe:   GET /v1/requests/:id   (#45, sem mudança)   <- a tela do painel só navega para ele
Publicar:  POST (#44/#45) -> 201 (corpo igual) + Set-Cookie: rascunho expirado
             -> tela pós-publicação (texto fixo, link "Meus pedidos")
```

A lista **não decifra, não chama geocodificador e não lê `exact_point`**. O endereço só aparece no detalhe da #45.

## 3. Dados: migração e reversão

### 3.1 Arquivos `[PROPOSTA]`
- **Migração:** `supabase/migrations/20261113260000_requests_expand_customer_panel.sql`.
- **Reversão:** `supabase/rollbacks/20261113260000_requests_expand_customer_panel.down.sql`.
- **Prefixo:** maior que `20261113250000` (reservado à #46). O DEV reconfere com `ls supabase/migrations | tail -3` ao criar e renomeia os dois arquivos juntos se outra Issue ocupar o prefixo.
- **Aplicação:** `npx supabase`, nunca pelo MCP. Idempotente (`if not exists`, `create or replace`, `drop ... if exists`).

### 3.2 Conteúdo, na ordem
1. **Guarda de pré-requisito** no molde da #45/#46: existem `app.service_request` (colunas `id, customer_user_id, service_id, status, published_at, acceptance_deadline_at`) e `app.service` (a coluna de nome que `request_owner_get` já usa; o DEV copia a junção de `20261113230000`); senão `raise exception 'painel_pre_requisito_ausente'`.
2. **Índice:** `create index if not exists service_request_cliente_recente_idx on app.service_request (customer_user_id, published_at desc, id desc)`. O índice antigo `(customer_user_id, status)` permanece.
3. **Função** `private.request_list_owner(p_user uuid, p_now timestamptz, p_after_published_at timestamptz, p_after_id uuid, p_limit integer)` retorna `table (out_id uuid, out_service_name text, out_status text, out_deadline_state text, out_published_at timestamptz, out_deadline_at timestamptz, out_cursor_ts text)`.
   - `security definer`, `set search_path = ''`, `set lock_timeout = '5s'`, `stable`, erro fixo.
   - Validações: `p_user` e `p_now` não nulos; `p_limit` entre 1 e 21 (senão `22023 limite_invalido`); `p_after_published_at` e `p_after_id` ambos nulos ou ambos preenchidos (senão `22023 cursor_invalido`).
   - Corpo: `from app.service_request r join app.service s on s.id = r.service_id where r.customer_user_id = p_user and (p_after_published_at is null or (r.published_at, r.id) < (p_after_published_at, p_after_id)) order by r.published_at desc, r.id desc limit p_limit`.
   - `out_deadline_state = case when r.status <> 'publicado' then null when p_now < r.acceptance_deadline_at then 'aberto' else 'encerrado' end`.
   - `out_cursor_ts = to_char(r.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` (microssegundos preservados).
   - **Colunas de saída, lista fechada (CA-16):** nenhuma `address*`, `public_label`, `exact_point`, `geocode_point_id`, `email*`, `phone*`, `customer_user_id`, `acceptances_count`, `match_*`, `description`, `urgency`, `first_name`. `[DECIDIDO 464]`.
4. **Privilégios:** `revoke all on function ... from public, anon, authenticated, service_role, app_api, app_backup_reader` e `grant execute ... to app_system` **somente**. Nenhum grant em tabela (RLS forçada e sem política, como na #44).
5. **Sem dado, sem agendamento, sem `cron`.** Nenhuma coluna muda.

### 3.3 Reversão
Remove a função e o índice (`drop ... if exists`). **Sem recusa por dados:** a migração não cria nem altera dado; a reversão não perde nada. Teste: aplicar, reverter e reaplicar.

## 4. Domínio (nomes de arquivo; barris só listados)

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Domínio | `packages/domain/src/request/customer-panel.ts` (**novo**) | `REQUEST_LIST_PAGE_SIZE = 20`; tipos `RequestStatus`, `DeadlineState`; `REQUEST_STATUS_LABEL` (§5); `deadlineState(nowMs, deadlineMs)`; `PANEL_ITEM_KEYS` (lista fechada, `as const`); `parseListCursor(raw)` (regex estrita, 3 a 120 caracteres, devolve `{publishedAt, id}` ou `null`); `PANEL_TEXT` (vazio, erro, pós-publicação, §6) |
| Barris (só listar) | `packages/domain/src/request/index.ts`, `packages/domain/src/index.ts` | reexportar o novo arquivo |

Rótulos (fonte única, nenhuma palavra "vaga", "onda" nem número de limite):

| Estado gravado | Rótulo | Prazo (só com `publicado`) |
|---|---|---|
| `publicado` | "Publicado" | "Aceites abertos" ou "Prazo de aceites encerrado" |
| `selecionado` | "Profissional selecionado" | (nenhum) |
| `concluido` | "Concluído" | (nenhum) |
| `cancelado` | "Cancelado" | (nenhum) |

## 5. Adaptador Pg

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Adaptador | `packages/db/src/request-list.ts` (**novo**) | `PgRequestListStore.listOwner(userId, nowMs, cursor \| null, limit)`; SQL em constante com `$n::tipo`; o cursor é passado como texto e convertido no SQL (`$3::timestamptz`), preservando microssegundos; mapeia só as chaves da lista fechada; erro fixo `lista_banco_falhou` (sem texto do driver) |
| Barril (só listar) | `packages/db/src/index.ts` | reexportar `request-list` |

## 6. API (nível de contrato)

### 6.1 `GET /v1/requests` (lista do dono)
- **Arquivos novos:** `apps/api/src/requests/list-service.ts` (sem HTTP: `listRequestsAsOwner`), `list-route.ts`, `list-composicao.ts`. **Montagem (só listar):** `apps/api/src/app.ts`, `apps/api/src/index.ts` (despacho por método, ver §0.4).
- **Cabeçalhos:** `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json`. Sem CORS (sem `Access-Control-*`).
- **Ordem de verificação:** método e caminho exatos → parâmetros (só `cursor` é aceito; qualquer outro = 400 `parametro_invalido`; `cursor` malformado = 400 `cursor_invalido`) → cookie de sessão (ausente, malformado = 401 `sessao_necessaria`) → `authenticate` com o relógio da API (nulo = 401 `sessao_necessaria`) → `request_list_owner` → corpo.
- **Corpo 200:**
  `{ "items": [ { "id", "serviceName", "status", "prazo", "publishedAt", "acceptanceDeadlineAt" } ], "nextCursor": string | null }`.
  `status` ∈ quatro códigos; `prazo` ∈ `"aberto" | "encerrado" | null`; rótulos de texto saem do domínio (§4), não da API. Lista vazia = `{"items":[],"nextCursor":null}` (não é erro). `nextCursor` só existe se vieram 21 linhas; é o `out_cursor_ts` e o `id` da 20ª linha, em base64url opaco.
- **Erros:** 401 `sessao_necessaria` (sem `Set-Cookie`, sem dado), 400 (acima), 405 para método diferente de `GET`, 503 `indisponivel` com `Retry-After: 10` (padrão da #44) em falha de banco. Mensagens fixas; nenhum log carrega corpo, cookie, `serviceName`, `id` de pedido junto de `id` de usuário nem o texto da exceção do driver.
- **Sem rate limit novo** (sessão obrigatória, página fixa de 20, só leitura). Registrado como risco R-05.

### 6.2 Detalhe do pedido (reaproveitado da #45, sem mudança de contrato)
`GET /v1/requests/:id` da #45 continua sendo o único detalhe do dono. A #47 **não cria rota de detalhe nem função de detalhe**. Pedido de terceiro, inexistente ou id mal formado devolve o 404 uniforme da #45; a #47 apenas **prova** isso em teste de contrato (T-03). A correção do `acceptancesCount` (§0.3) altera o corpo do detalhe de 12 para 11 chaves, **na #45**.

### 6.3 Cookie do rascunho na publicação (impacto na #44/#45, só aditivo)
- **Alteração:** no ponto em que a resposta de sucesso da publicação é montada (`apps/api/src/requests/publish-service.ts` ou `publish-route.ts`; o DEV localiza por `grep -n "201" apps/api/src/requests/publish-*.ts`), acrescentar o cabeçalho `Set-Cookie: <DRAFT_CLEAR_COOKIE_HEADER>` (mesmos atributos `__Host-` do cookie original: `Max-Age=0`, `Path=/`, `Secure`, `HttpOnly`, `SameSite`). `[PERGUNTA 519]` define se vale também para a repetição idempotente.
- **O que não muda:** corpo 201 de 4 chaves, todos os códigos de erro da #44, `request_publish_begin/commit_enc/abort`, o hash do corpo e a ordem das verificações. Respostas de erro **não** limpam o cookie (o cliente ainda pode corrigir e tentar de novo).
- **Efeito colateral aceito:** depois do 201 recebido, o navegador não envia mais o cookie do rascunho. Uma nova tentativa com a mesma `Idempotency-Key` sem o cookie cai na regra existente de cookie ausente da #44, sem repetir a resposta (`[PERGUNTA 520]`). A tela desabilita o botão de publicar depois do 201.
- **Se a resposta 201 for perdida na rede,** o navegador não aplicou o `Set-Cookie`, o cookie permanece e a retentativa idempotente funciona como hoje (CA-10).
- **Arquivos tocados:** só o de montagem da resposta e seu teste. O adaptador `packages/db/src/request-publish.ts` **não é tocado**.

## 7. Tela (nível de contrato) `[PERGUNTA 518]`

Não há casca de páginas em `apps/web/src` (§0.6). O contrato abaixo vale para qualquer renderização; a entrega mínima desta Issue é o módulo de apresentação do domínio (§4) mais os componentes onde houver casca.

**Painel "Meus pedidos"** (rota de tela `[NÃO VERIFICADO]`, a casca define):
- Carrega a lista ao abrir e ao voltar à aba (R4 do refino). Sem tempo real.
- **Item:** nome do serviço, rótulo do estado, rótulo do prazo (só para `publicado`), data de publicação (data e hora no fuso do navegador). Cada item é um link para o detalhe do pedido (#45). Sem endereço, sem descrição, sem contador.
- **Estados da tela:** carregando (indicador com texto acessível), vazio (texto e ação "Novo pedido"), erro (mensagem fixa e botão "Tentar de novo", sem detalhe técnico), 401 (pede novo link de acesso; **nunca** exibe "sem pedidos", R6), e "Carregar mais" quando `nextCursor` existe.
- Foco e rótulos conforme o design system do FastPro e a auditoria WCAG 2.2 AA da #127 (E15).

**Tela pós-publicação** (aberta após o 201):
- Texto fixo `PANEL_TEXT.posPublicacao`: "Seu pedido foi publicado. Ele fica aberto para aceites por 7 dias. Para acompanhar, volte ao FastPro e abra Meus pedidos." (decisão 465, recomendada). Sem termo técnico, sem número de pedido bruto.
- Ação principal: "Ver meus pedidos" (vai ao painel). O botão de publicar fica desabilitado.
- Não chama a lista antes de o usuário navegar; **não** chama nenhum provedor de mapas (CA-14).

## 8. Plano de testes (locais, sintéticos, marcador `H034`)

Padrão: `*.test.ts` (unidade e rota), `*.dbtest.mjs` (Postgres real). Evidência: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test`, registrados na Issue. Sem serviço externo, sem e-mail.

Arquivos: `packages/domain/tests/request-customer-panel.test.ts`, `packages/db/tests/request-list-adapter.test.ts`, `packages/db/tests/request-list-h034.dbtest.mjs`, `packages/db/tests/request-list-migration.test.mjs` (estático: nome, prefixo, `revoke/grant`, ausência de `exact_point` e de colunas proibidas no `prosrc`), `apps/api/tests/request-list-service.test.ts`, `apps/api/tests/request-list-route.test.ts`, `apps/api/tests/request-publish-cookie.test.ts`, e, se houver casca web, o teste de tela vizinho aos existentes `[NÃO VERIFICADO]`.

| # | Teste | CA |
|---|---|---|
| T-01 | Banco real: cliente A com 3 pedidos, B com 2; `request_list_owner(A)` devolve exatamente os 3 de A; `request_list_owner(B)` os 2 de B; usuário sem pedido devolve 0 linhas | CA-01 |
| T-02 | Rota: sem cookie, cookie malformado, sessão revogada e sessão vencida: 401 `sessao_necessaria`, corpo idêntico entre os quatro, sem `Set-Cookie`, sem dado, banco **não** chamado (contador do fake = 0) | CA-02 |
| T-03 | Rota de detalhe da #45 (sem alterá-la): pedido de B pedido por A, id inexistente e id mal formado devolvem status, cabeçalhos e corpo **idênticos byte a byte**. Banco real: `request_owner_get(A, pedidoDeB)` devolve 0 linhas. Marcado `PENDENTE` com registro na Issue se a #45 ainda não tiver saído de Code Review | CA-03 |
| T-04 | Cinco fixtures (publicado com prazo aberto, publicado com prazo encerrado, selecionado, concluído, cancelado): `out_status` e `out_deadline_state` esperados no banco; no domínio, o rótulo esperado de cada um; `out_deadline_state` é nulo para os três não publicados | CA-04 |
| T-05 | Fronteira com `p_now` fixo: em `deadline − 1 µs` = `aberto`; em `deadline` = `encerrado`; em `deadline + 1 µs` = `encerrado`; o pedido continua `publicado` e continua na lista. Função pura `deadlineState` com as mesmas três entradas | CA-05 |
| T-06 | Varredura das chaves da resposta (`items[*]` exatamente `PANEL_ITEM_KEYS`, na ordem) e dos textos de `PANEL_TEXT` e `REQUEST_STATUS_LABEL`: sem `acceptancesCount`, `acceptances_count`, "vaga", "onda", nem os números 4 e 8 em rótulo. Se a decisão 457 estiver aplicada na #45, a mesma varredura roda no corpo do detalhe do dono | CA-06 |
| T-07 | Banco real: 25 pedidos, incluindo 3 com o mesmo `published_at` e 2 com diferença de 1 µs: página 1 = 20 itens, página 2 (com o cursor) = 5, sem repetição nem falta; ordem `published_at desc, id desc`; pedido novo publicado entre as duas chamadas aparece no topo de uma nova leitura e **não** duplica item na página 2. Rota: `nextCursor` nulo na última página; cursor malformado, de 121 caracteres, com uuid inválido ou só metade (data sem id) = 400 `cursor_invalido`; parâmetro extra (`limit=1000`) = 400 `parametro_invalido` | CA-07 |
| T-08 | Lista vazia: rota devolve 200 `{"items":[],"nextCursor":null}`; tela mostra `PANEL_TEXT.vazio` e a ação "Novo pedido"; 401 não mostra "sem pedidos" | CA-08 |
| T-09 | `PANEL_TEXT.posPublicacao` igual ao texto aprovado (decisão 465), contém "7 dias" e "Meus pedidos", sem número de pedido, sem termo técnico (lista de proibidos: `uuid`, `id`, `api`, `erro`, `status`, `service_request`); teste de tela se houver casca | CA-09 |
| T-10 | Publicação com banco simulado: 201 traz **exatamente um** `Set-Cookie` de limpeza (`__Host-fp_draft`, `Max-Age=0`, mesmos atributos do cookie de criação); o corpo 201 continua de 4 chaves e igual ao de antes (teste da #44 inalterado); respostas 400, 401, 409, 422 e 503 **não** trazem `Set-Cookie` de limpeza; repetição idempotente (cookie ainda presente) devolve a mesma resposta | CA-10 |
| T-11 | Cabeçalhos da lista e dos erros 400, 401, 405 e 503: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json`; nenhum `Access-Control-*` | CA-11 |
| T-12 | Sentinelas (descrição, e-mail do cliente e nome de serviço sintético) varridos em saída de log capturada, corpos de erro (400 a 503) e mensagem de exceção do banco: zero ocorrências em log e erro (o nome do serviço só aparece no corpo 200) | CA-12 |
| T-13 | Leitura sem escrita: antes e depois da lista, contagem e soma de conferência (`count(*)`, `sum(version)`, `sum(acceptances_count)`) de `service_request` e contagem de `audit.audit_event` iguais; `xmin` das linhas inalterado | CA-13 |
| T-14 | Provedor de geocodificação e de mapas ausente ou que lança erro: lista, detalhe e tela pós-publicação funcionam; contador do fake = 0 | CA-14 |
| T-15 | Catálogo (`pg_proc`, `pg_get_function_result`, `prosrc`): `request_list_owner` não tem coluna de saída `address*`, `public_label`, `exact_point`, `geocode_point_id`, `email*`, `phone*`, `customer_user_id`, `acceptances_count`, `match_*`, `description`, `urgency`, `first_name`; o `prosrc` não menciona `exact_point`, `address_text`, `email`, `phone`; só `app_system` tem `execute`; `app_api`, `anon`, `authenticated`, `service_role` não; `select` direto em `service_request` por `app_api` e `anon` falha | CA-16 |
| T-16 | Migração: aplicar duas vezes (idempotência); aplicar, reverter e reaplicar; prefixo maior que `20261113250000`; plano de execução (`explain`) da consulta com 1000 pedidos de um dono usa o índice novo, sem `Sort` | CA-15 |
| T-17 | Falha de banco: `request_list_owner` lançando erro = 503 `indisponivel` com `Retry-After`, corpo fixo, sem texto do driver | CA-02, CA-12 |
| T-18 | Fechamento: `corepack pnpm check:all` e `db:test` locais, contagem e código de saída na Issue; sem declarar CI | CA-15 |

## 9. Segurança e privacidade

1. **IDOR:** `customer_user_id = p_user` dentro da função, `p_user` vem **só** do `authenticate`; nenhum parâmetro de requisição escolhe o usuário. Detalhe de terceiro = 404 uniforme da #45.
2. **Cursor:** só aceita regex estrita; vira parâmetro tipado (`timestamptz`, `uuid`), nunca texto concatenado no SQL; não carrega usuário (o filtro por dono vale em toda página, então um cursor copiado de outro dono não vaza nada).
3. **Sem dado sensível na lista:** lista fechada de colunas no banco, no adaptador e no domínio (três travas, T-06 e T-15). O nome do serviço é dado de catálogo.
4. **Banco:** RLS forçada e sem política mantidas; `definer`, `search_path = ''`, execução só `app_system`; PostGIS e `exact_point` não são tocados.
5. **Cookie do rascunho (A12/407):** o texto em claro do rascunho deixa de ser alcançável pelo cookie depois da publicação bem-sucedida. A dívida de expurgo do rascunho (30 dias, `[DECIDIDO 407]`) continua registrada; esta Issue só reduz a janela de exposição.
6. **Cache e referência:** `no-store`, `no-referrer`, sem CORS; sem log de corpo, URL com cursor, cookie ou `id` junto de usuário.
7. **Auditoria:** leitura não gera evento (decisão 469).
8. **Sessão vencida:** 401 explícito, não lista vazia (R6).

## 10. Impacto em outras histórias e ordem de execução

**Impacto**
- **#45 (H-032, Code Review):** nenhuma edição pela #47 em `detail-route.ts`, `detail-service.ts`, `request-visibility.ts` (db e domínio) nem em `request_owner_get`. Dependência de **prova** (T-03) e de **correção** (`acceptancesCount`, §0.3 e `[PERGUNTA 516]`). A M2 da #45 (`20261113240000`) recria `request_owner_get`; é o ponto natural para remover `out_acceptances_count`, porque mudar as colunas de saída de uma função exige `drop` e `create`.
- **#44 (H-031, concluída):** só o cabeçalho aditivo do §6.3 e seu teste. Corpo, códigos, funções e adaptador intactos.
- **#46 (H-033, Desenvolvimento):** mesma tabela, sem colunas em comum com a lista (`phone_enc` não é lido). Arquivos em comum: apenas os barris e `app.ts`/`index.ts` de montagem (um registro a mais cada). Prefixo da #46 `20261113250000` < `20261113260000` da #47; a M2 da #45 `20261113240000` fica fora de ordem se aplicada depois, risco já registrado nas Rodadas 94 e 95 e **não agravado** pela #47.
- **#43 (H-030, rascunho):** `draft-service.ts` **não é editado**; só se reutiliza a constante de limpeza.
- **E8, E9, E7:** estados e ações (selecionar, concluir, cancelar, republicar) e tempo real ficam fora; a lista já exibe os quatro estados do enum.
- **#127 (WCAG):** a tela entra na auditoria.

**Ordem de execução** `[DECIDIDO 459]`
1. **Arquitetura (este documento).** O líder responde 516 a 523 e registra em `11-DECISOES.md`.
2. **Desenvolvimento só depois que a #45 sair de Code Review (Aguardando aprovação ou concluída) e a #46 sair de Desenvolvimento**, confirmado no quadro local. Antes de codar, o DEV roda `git status`, `ls supabase/migrations | tail -3`, `grep -rn acceptancesCount apps packages --include=*.ts` e `grep -rn DRAFT_CLEAR_COOKIE_HEADER apps/api/src`.
3. **Sequência do DEV:** (a) domínio `customer-panel.ts` + T-04 (parte pura), T-05 (parte pura), T-06, T-09; (b) migração e reversão + `request-list-migration.test.mjs` + T-15, T-16, aplicar no DEV com `npx supabase`; (c) adaptador `request-list.ts` + `request-list-adapter.test.ts` + `request-list-h034.dbtest.mjs` (T-01, T-04, T-05, T-07, T-13); (d) serviço, rota e composição + T-02, T-08, T-11, T-12, T-14, T-17; (e) cookie na publicação + T-10; (f) T-03 (detalhe da #45) e, se a casca existir, tela e T-08/T-09 de tela; (g) `check:all` e `db:test` (T-18).
4. **Code Review e QA** repetem T-03, T-07, T-10 e T-13.

## 11. Riscos

- **R-01 Conflito com a #45:** a remoção de `acceptancesCount` e a prova do 404 dependem dela (§10). Mitigação: perguntas 516 e a ordem do item 2.
- **R-02 Painel sem casca web:** sem `apps/web` com páginas, a tela fica só como contrato e módulo de apresentação. Mitigação: `[PERGUNTA 518]`.
- **R-03 Retentativa sem cookie depois do 201** (§6.3). Mitigação: `[PERGUNTA 520]` e botão desabilitado.
- **R-04 Painel desatualizado** (sem tempo real): recarrega ao abrir e ao voltar à aba; tempo real é de E7.
- **R-05 Sem limite de taxa na lista:** exige sessão, página fixa, só leitura; reavaliar em H-055.
- **R-06 Prazo calculado na leitura:** diferença de relógio entre API e banco não afeta (usa o relógio da API para o teste e para a resposta); o `acceptance_deadline_at` é imutável.
- **R-07 Prefixo de migração:** outras Issues podem ocupar `20261113260000`; o DEV reconfere ao criar.
- **R-08 Divergência de rótulos entre API e tela:** a API envia códigos, os rótulos vêm do domínio; T-06 varre os textos.

## 12. Ciência sem decisão

- A API envia **códigos** de estado e prazo; a tela traduz com o domínio. O refino falava em "rótulo derivado"; o rótulo é derivado no domínio, não na API.
- O índice novo `(customer_user_id, published_at desc, id desc)` é mantido junto do antigo `(customer_user_id, status)`; nenhum é removido.
- `p_now` vem do relógio da API (padrão da #45), o que difere de "relógio do banco" da §5.3 do refino; o efeito para o usuário é o mesmo e o teste de fronteira ganha controle do tempo.

## 13. Perguntas ao líder (numeração contínua a partir de 516)

**516. Quem remove `acceptancesCount` da resposta do dono (decisão 457) e quando.** Existe no domínio, no adaptador, na função SQL e em cinco testes da #45 (§0.3).
- (a) Correção da #45, dentro do seu ciclo de correção ou na M2 já reservada (`20261113240000`), que recria `request_owner_get` de qualquer forma; a #47 só varre e prova (recomendado).
- (b) A #47 faz a remoção no Desenvolvimento, em migração própria que recria `request_owner_get` (conflita com a M2 da #45).
- **Recomendação:** (a). Destrava T-06 e evita duas migrações recriando a mesma função.

**517. Relógio do estado do prazo.** O refino diz "relógio do banco"; o desenho usa o relógio da API passado em `p_now`.
- (a) `p_now` injetado, igual à #45 (recomendado).
- (b) `now()` do banco.
- **Recomendação:** (a). Permite o teste de fronteira de CA-05 com relógio fixo. Destrava T-05.

**518. Tela sem casca web.** `apps/web/src` só tem `index.ts` e `media/`; não há páginas.
- (a) Entregar o módulo de apresentação no domínio (rótulos, textos, estados, regras) e os componentes só onde houver casca; a tela completa fica para a história que criar a casca do cliente (recomendado).
- (b) Criar uma casca mínima de páginas dentro da #47 (amplia a Issue e escolhe tecnologia).
- **Recomendação:** (a), consistente com a decisão 425 da #45. CA-08 e CA-09 ficam provados no nível de módulo, com a pendência da tela declarada na Issue. Destrava o tamanho da Issue.

**519. Cookie do rascunho na repetição idempotente.** A decisão 460 fala da resposta 201.
- (a) Expirar o cookie em **toda** resposta de sucesso da publicação, nova ou repetida (recomendado; repetir só ocorre depois de publicado).
- (b) Só na primeira criação.
- **Recomendação:** (a). Destrava T-10.

**520. Nova tentativa com a mesma `Idempotency-Key` depois de o 201 ser recebido (cookie já expirado).**
- (a) Mantém o comportamento atual de cookie ausente da #44; a tela desabilita o botão após o 201; sem mudança no contrato de idempotência (recomendado).
- (b) Aceitar a repetição só com a sessão e a `Idempotency-Key` (muda a #44 além do aditivo).
- **Recomendação:** (a). A retentativa legítima (resposta perdida) continua funcionando porque o cookie só some quando o navegador recebeu o 201. Destrava T-10.

**521. Índice e filtro por estado.** O `09` prevê `(customer_user_id, status, published_at DESC)`; a decisão 462 manda lista sem filtro.
- (a) Índice `(customer_user_id, published_at desc, id desc)` agora; um índice por estado só quando houver filtro (recomendado).
- (b) Seguir o índice do `09`.
- **Recomendação:** (a). Destrava T-16 (plano sem `Sort`).

**522. Prazo para pedidos que não estão `publicado`.** O refino mostra o prazo junto de "Publicado".
- (a) `prazo` nulo para `selecionado`, `concluido` e `cancelado`; só `publicado` mostra "aberto" ou "encerrado" (recomendado; evita "cancelado, aceites abertos").
- (b) Mostrar o prazo em todos os estados.
- **Recomendação:** (a). Destrava T-04.

**523. Parâmetros e erros da lista.** Cursor opaco em base64url, `cursor` aceito só em `GET /v1/requests`, parâmetro extra = 400 `parametro_invalido`, cursor inválido = 400 `cursor_invalido`, método diferente = 405.
- (a) Adotar (recomendado). (b) Ignorar parâmetro desconhecido.
- **Recomendação:** (a). Contrato apertado, sem superfície escondida. Destrava T-07.
