# Desenho dos defeitos das telas (Issue #159): endereco da inicial e servico vazio em /pedido

- **Issue:** #159 `[E16] Defeitos das telas` · **Prioridade:** maxima (dono) · **Workflow:** WF-04 (Bugfix) · **Etapa:** Arquitetura
- **EXEC-ID:** EXEC-ARQ-159-20261121 · **Repo:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Entrada:** `184-REFINO-DEFEITO-ENDERECO.md` (PO). Perguntas 996 a 999 ADOTADAS pelo lider (ver §2).
- **Natureza:** somente documento. Nenhum codigo, quadro, `11-DECISOES.md` ou commit foi alterado.
- **Etiquetas:** `[V]` verificado por leitura nesta rodada · `[NV]` nao verificado (vira verificacao do Dev).

---

## 1. Causa raiz

### Defeito 1: sugestao de endereco falha na primeira visita (inicial) e na corrida em /pedido
Cadeia ja verificada pelo PO (§2 do 184) e reconferida: `[V]`
1. `inicio.js` monta `mountAddressField({context:'request_draft'})` na carga da pagina; o rascunho so nasce em "Continuar" (`gravar('POST')`).
2. A consulta sem cookie chega em `POST /api/v1/geo/address-suggest`; a porta `draft-gate.ts` devolve `no_principal`/`not_draft` e `address-suggest-service.ts` responde **403 `not_draft`** sem chamar o Mapbox (regra H-020, intencional).
3. `address-field.js` `tratarResposta` so entende `mode: 'ok'` e `mode: 'texto_livre'`; o 403 tem corpo `{code:'not_draft'}` sem `mode`, cai em "formato inesperado" e mostra `ADDRESS_NEUTRAL_MESSAGE` ("Nao foi possivel sugerir enderecos agora"). Ou seja: uma situacao normal (ainda nao ha rascunho) e apresentada como falha.
4. O mesmo ocorre com cookie vencido/descartado (gate devolve `not_draft`).
5. Em `/pedido`: a sugestao sai 300 ms apos digitar (`ADDRESS_DEBOUNCE_MS`), o POST que cria o rascunho sai 800 ms apos a ultima alteracao (`PEDIDO_SALVAR_ATRASO_MS`); sem cookie a sugestao perde a corrida. `[V]`

**Causa de projeto:** o desenho 175 (decisoes 940 e 946) ligou o campo de endereco a um contexto que exige rascunho, mas nao garantiu que o rascunho existisse antes do primeiro caractere, nem tratou o `not_draft` como estado esperado.

### Defeito 2: campo de servico vazio em /pedido
- `GET /api/v1/drafts/current` devolve `DraftView` com 8 chaves fechadas: `id, status, service_id, address_text, urgency, description, expires_at, updated_at` (`packages/domain/src/draft/request-draft.ts` linhas 227-236; `toDraftView` em `ports.ts` linha 76; testes de chaves fechadas em `apps/api/tests/draft-route.test.ts:276` e `packages/domain/tests/draft-request.test.ts:302`). **Nao ha nome do servico.** `[V]`
- `pedido.js` `preencher(view)` grava `servicoId = view.service_id` e o aviso "Servico ja escolhido...", mas nunca preenche `#servico`. O campo fica vazio. `[V]`
- `private.draft_get/draft_create/draft_patch` devolvem so `out_service_id` (migracao `20261111440000`); o join com `app.service` so existe em `private.draft_review_get` (migracao `20261112150000`, `out_service_name`). `[V]`

### Revisao e painel: ja mostram o nome (nao sao defeito)
- Revisao: `pedido-revisao.js` linha 66 usa `view.service?.name`, alimentado por `draft_review_get` (join com `app.service`). `[V]`
- Painel: `painel.js` linha 46 usa `item.serviceName` (fallback "Servico"); a lista fechada `PANEL_ITEM_KEYS` esta em `packages/domain/src/request/customer-panel.ts` (usada por `apps/api/src/requests/list-service.ts`). `[V]` o uso na tela; `[NV]` se `serviceName` esta na lista fechada e vem preenchido no `GET /v1/requests` (o Dev confirma por grep e curl na fatia F5; se faltar, vira correcao pequena da fatia, nao novo contrato).
- Nota: `visibility.ts` nao contem `PANEL_ITEM_KEYS` (o PO citou esse arquivo; o simbolo esta em `customer-panel.ts`). `[V]`

---

## 2. Decisoes

| Ref | Decisao | Origem |
|---|---|---|
| 996 (b) | **Adotada pelo lider.** Criar o rascunho ao escolher o servico; so entao liberar a sugestao de endereco. Em `/pedido`, regra propria: sem rascunho vivo, endereco e texto livre sem sugestao ate o primeiro salvamento criar o rascunho. | PO/lider |
| 997 (A) | **Adotada pelo lider.** A API devolve `service_name` junto com o rascunho (aditivo; nome do catalogo, sem dado pessoal). | PO/lider |
| 998 (A) | **Adotada pelo lider.** Sem rascunho vivo o endereco vira texto livre, sem mensagem de erro (estado E-E5). | PO/lider |
| 999 (A) | **Adotada pelo lider.** Prazo de 7 dias para todos os rascunhos, sem regra nova; risco de rascunho orfao com endereco em claro segue como divida (decisao 407, job H-110 E2). | PO/lider |
| D-ARQ-159-1 | **Adotada pela Arquitetura** (o lider numera em `11-DECISOES`). O campo de endereco **nao e bloqueado**: continua digitavel. "Liberar" significa so permitir a consulta de sugestao. Evita mudar a interacao e o Continuar. | Arq. |
| D-ARQ-159-2 | **Adotada.** O componente `address-field.js` ganha um **portao opcional** (`podeConsultar()`, padrao `true`, compativel com quem nao usa) e o metodo `liberar()` que reavalia o texto atual. Com portao fechado: sem timer, sem requisicao, estado `texto_livre` sem mensagem. | Arq. |
| D-ARQ-159-3 | **Adotada.** Rede de seguranca: resposta 403 com `code:'not_draft'` (ou `no_principal`) vira `texto_livre` sem mensagem, fecha o portao daquela pagina e **nao reconsulta** (sem laco). 503, falha de rede e `indisponivel` continuam com a mensagem E-E4, uma vez. | Arq. |
| D-ARQ-159-4 | **Adotada.** Na inicial, **nao ha GET na carga**. O rascunho e verificado/criado na escolha do servico: `GET /drafts/current`; se 404 `nao_encontrado` -> `POST /drafts {service_id}`; se ja existe rascunho vivo -> nada e gravado (a troca de servico continua so em "Continuar", preservando a decisao 941 e a confirmacao de substituicao). Falha nessa etapa e silenciosa: o campo segue texto livre e "Continuar" repete a regra normal (cria ou mostra E-07). Uma unica tentativa em voo por vez. | Arq. |
| D-ARQ-159-5 | **Adotada.** Contrato: `service_name` aditivo em `DraftView`, **fonte unica por funcao nova** `private.service_public_name(uuid)` (migracao aditiva, sem alterar `draft_get/create/patch`). O adaptador `PgDraftStore` enriquece o registro em `find`, `create` e `patch` (um select extra so quando `service_id` nao e nulo). Falha da consulta de nome degrada para `null` (nome e cosmetico; nao derruba GET /current). | Arq. |
| D-ARQ-159-6 | **Adotada.** `/pedido` com `service_id` e `service_name = null` mostra texto de apoio fixo ("Servico escolhido. Para trocar, pesquise outro.") e **nao** deixa o campo parecer perdido; o `service_id` e preservado no salvamento. | Arq. |
| D-ARQ-159-7 | **Adotada.** Sem mudanca em `draft-gate.ts`, na regra H-020, nas rotas, nos limites de taxa, no Mapbox. Menos chamadas ao provedor que hoje (zero 403 visivel e nenhuma retentativa). | Arq. |

Alternativa descartada para D-ARQ-159-5: `drop function` + recriar `draft_get/create/patch` com `out_service_name`. Mudar o tipo de retorno exige drop (nao aditivo), toca tres funcoes grandes e a paridade de autorizacao (`authorization-parity.dbtest.mjs:27` faz `select * from private.draft_get`). A funcao auxiliar custa uma consulta a mais, so quando ha servico.

---

## 3. Contrato novo: `service_name` no rascunho

### 3.1 Banco (migracao aditiva)
Arquivo: `supabase/migrations/20261121120000_draft_add_service_public_name.sql` (timestamp maior que a ultima, `20261121110000`) `[V]` lista de migracoes.
```sql
create or replace function private.service_public_name(p_service_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$ select s.name from app.service s where s.id = p_service_id $$;
revoke all on function private.service_public_name(uuid) from public, anon, authenticated, service_role;
grant execute on function private.service_public_name(uuid) to app_api;
```
- Idempotente (`create or replace`); sem tabela nova, sem coluna, sem dado pessoal (nome do catalogo).
- Rollback: `supabase/rollbacks/20261121120000_draft_add_service_public_name.down.sql` com `drop function if exists private.service_public_name(uuid);`.
- Aplicar na DEV por `npx supabase db push` (nunca MCP). Catalogo de autorizacao: o Dev confere `packages/db/tests/authorization-catalog.dbtest.mjs` e `packages/access-matrix/src/matrix.ts` (ha entradas `private.draft_get`); se o catalogo lista funcoes do esquema `private` com concessao, acrescentar a nova (so `app_api`) e manter o teste verde. `[NV]` formato exato da lista; Dev confirma. Teste estatico novo no padrao de `draft-migration.test.mjs` (revoke de public/anon/authenticated/service_role, grant so a `app_api`, `security definer`, `search_path` vazio).

### 3.2 Adaptador (`packages/db/src/request-draft.ts`)
- `export const SQL_SERVICE_PUBLIC_NAME = 'select private.service_public_name($1::uuid) as name';`
- `paraRegistro` continua sincrono e passa a devolver `serviceName: null`; novo metodo privado `comNome(registro)` consulta o nome quando `registro.serviceId !== null` (em `try/catch` -> `null`) e devolve `{...registro, serviceName}`. Chamado em `find` e no ramo `ok` de `escrever` (create e patch).

### 3.3 Dominio (`packages/domain`)
- `ports.ts`: `DraftRecord` ganha `readonly serviceName: string | null`; `toDraftView` acrescenta `service_name: record.serviceName`.
- `request-draft.ts`: `DraftView` ganha `readonly service_name: string | null` (logo apos `service_id`). `DRAFT_FIELDS` (chaves aceitas no corpo) **nao muda**: `service_name` e so saida; enviar `service_name` no POST/PATCH continua 422 `campo_desconhecido`.
- Lista fechada a atualizar (testes): `apps/api/tests/draft-route.test.ts:276` e `packages/domain/tests/draft-request.test.ts:302` passam a esperar `service_name` (9 chaves). Fakes de `DraftRecord` em testes (api, db, domain) recebem `serviceName` (o `typecheck` aponta todos). `[V]` os dois pontos de chaves fechadas; `[NV]` demais fakes.

### 3.4 Rota (`apps/api/src/drafts`)
- Nenhuma mudanca de codigo: `draft-service.ts` ja devolve `toDraftView(...)` em GET, POST e PATCH. `service_name` passa a sair nos tres. Teste de rota: corpo com servico -> `service_name` string; sem servico -> `null`.
- Exemplo de resposta nova: `{"id":"...","status":"aberto","service_id":"<uuid>","service_name":"Eletricista","address_text":null,"urgency":null,"description":null,"expires_at":"...","updated_at":"..."}`.
- Compatibilidade: campo novo e aditivo; `inicio-logica.js` (`interpretarRascunhoAtual`, `decidirCriacao`) e `pedido.js` ignoram chaves desconhecidas. `[V]`

---

## 4. Mudancas nas telas

### 4.1 `address-field.js` (componente compartilhado)
- `createSuggestController({... podeConsultar })` e `mountAddressField({... podeConsultar })`: `podeConsultar` opcional, padrao `() => true`.
- `input(texto)`: se `podeConsultar()` for falso (e o texto tem 3 a 120 caracteres) -> `emitir({status:'texto_livre', mensagem:''})` e retorna sem timer (mesmo ponto de `desligadoNestaPagina`).
- `consultar`/`tratarResposta`: tratar `corpo.code === 'not_draft' || 'no_principal'` como `texto_livre` sem mensagem e marcar `semRascunho = true` (portao interno fechado, sem reconsulta ate `liberar()`).
- Novo `liberar()` no objeto devolvido pelo controlador e por `mountAddressField`: zera `semRascunho` e, se o campo tem texto valido, chama `input(valor)` (uma consulta, com debounce normal).
- Preservar: `texto_livre` por `limite`/`cota`/`desligado`, E-E4 em falha/503/rede, uma consulta por digitacao, sem armazenamento.

### 4.2 Inicial (`inicio.js`)
- Estado `rascunhoVivo` (boolean) e `criandoRascunho` (trava de uma tentativa).
- `mountAddressField` recebe `podeConsultar: () => rascunhoVivo` e guarda o retorno (`campoEndereco`).
- `escolherServico(indice)`: apos o codigo atual, chama `garantirRascunho()`:
  1. se `rascunhoVivo` ou `criandoRascunho` -> sai;
  2. `chamar(CAMINHOS.atual)`; `interpretarRascunhoAtual`: `rascunho` -> `rascunhoVivo = true`; `sem_rascunho` -> `gravar('POST', {service_id})` (usa `montarCorpo` parcial so com o servico); 201 -> `rascunhoVivo = true`; qualquer outro resultado -> silencio;
  3. ao ficar `rascunhoVivo`, chama `campoEndereco.liberar()`.
- `continuar()` **nao muda** (continua GET -> `decidirCriacao` -> POST/PATCH/confirmar). Com o rascunho ja criado, o ramo vira `atualizar` (PATCH, 200) e a pagina navega para `/pedido`; o rascunho nasce uma unica vez (CA-159-03: o POST unico agora ocorre na escolha do servico; clique duplo em Continuar nao cria segundo).
- Se o rascunho vivo expirar durante a sessao: a sugestao devolve 403 -> D-ARQ-159-3 (texto livre sem mensagem, sem laco); "Continuar" cria um novo (GET 404 -> POST).
- Sem `localStorage`, `sessionStorage` ou `document.cookie`; sem dado na URL.

### 4.3 Pedido (`pedido.js`)
- `mountAddressField` recebe `podeConsultar: () => criado` (`criado` ja existe: vira `true` com GET /current 200 em `carregar()` ou com POST/PATCH 2xx do salvador). Guardar o retorno (`campoEndereco`).
- Apos `criado` passar a `true` (resposta 2xx no `enviar` do salvador e no `carregar()` com rascunho), chamar `campoEndereco.liberar()`.
- `preencher(view)`: apos `servicoId = view.service_id ?? null`, se `servicoId`: `el('servico').value = view.service_name ?? ''`; aviso `TEXTO.escolhido` (D-ARQ-159-6: se `service_name` for `null`, aviso "Servico escolhido. Para trocar, pesquise outro." e campo com texto `PEDIDO_TEXTOS` de apoio). Se o visitante digitar no campo, `servicoId = null` (comportamento atual, `input`) e o `PATCH {service_id:null}` segue valendo.
- Entrada sem rascunho (GET 404): formulario vazio; endereco e texto livre sem mensagem; o primeiro salvamento (800 ms) cria o rascunho e libera a sugestao. Isso elimina a corrida (R-5): a sugestao nunca sai antes do POST.
- Revisao (`pedido-revisao.js`) e painel (`painel.js`): **sem mudanca de codigo** (ja usam o nome). Apenas asserts de regressao na F5.

---

## 5. Fatias do Dev (curtas, nesta ordem, cada uma com teste proprio)

| Fatia | Conteudo | Provas (local, com contagem e codigo de saida na Issue) |
|---|---|---|
| **F0 reproducao** | Teste que falha no codigo atual: `inicio-page` com `fetch` com estado que imita a porta (403 `not_draft` sem cookie; `POST /drafts` cria cookie; 200 com cookie). Fluxo: escolher servico, digitar 3 caracteres. | vitest: **vermelho antes** (mensagem E-E4 aparece, contagem de 403 > 0). Anexar saida na Issue. Equivalente em `/pedido`: endereco digitado antes do POST (corrida, relogio falso). |
| **F1 contrato** | Migracao `20261121120000` + rollback; `SQL_SERVICE_PUBLIC_NAME`; `DraftRecord.serviceName`; `DraftView.service_name`; `toDraftView`; ajuste das listas fechadas e dos fakes. | `pnpm --filter @fastpro/domain test`, `@fastpro/db test` (adaptador com cliente falso: com servico devolve nome; sem servico `null`; falha do select -> `null`), teste estatico da migracao, `@fastpro/api test` (rota: chaves fechadas = 9; GET/POST/PATCH trazem `service_name`; corpo com `service_name` -> 422). `npx supabase db push` na DEV; `db:test` com catalogo verde (`authorization-catalog`, `authorization-parity`). |
| **F2 componente** | `address-field.js`: `podeConsultar`, `liberar()`, tratamento de `not_draft`. | `address-field.test.ts`: portao fechado -> 0 requisicoes e estado `texto_livre` sem mensagem; `liberar()` dispara 1 consulta; 403 `not_draft` -> sem mensagem, sem laco (1 chamada); 503/rede -> E-E4 uma vez; 429 e `cota` inalterados; padrao `podeConsultar` ausente = comportamento atual. |
| **F3 inicial** | `inicio.js`: `garantirRascunho`, `rascunhoVivo`, ligacao do portao. Ajustar `inicio-continuar.test.ts` e `inicio-page.test.ts` (contagem de POST agora ocorre na escolha do servico). | CA-159-00 vira verde; CA-159-01 (zero 403 no fluxo feliz, sugestoes depois do rascunho); CA-159-03 (POST = 1, clique duplo em Continuar nao cria outro); CA-159-04 (cookie vencido: 403 -> sem mensagem, Continuar cria novo); CA-159-05 e 06; CA-159-07 (criacao 503/429 em Continuar mantem E-07 e campos); CA-159-09 (espioes de `localStorage`, `sessionStorage`, `document.cookie` = 0; URL sem dado). Caso: rascunho vivo com descricao e servico diferente -> continua pedindo confirmacao (decisao 941 intacta). |
| **F4 pedido** | `pedido.js`: portao por `criado`, `liberar()`, `preencher` com `service_name`, fallback. | `pedido-logica`/pagina: CA-159-02 (sem cookie: sugestao so apos o POST; corrida com relogio falso); CA-159-08 (`service_name` no campo e aviso; `null` -> aviso de apoio); fluxo inicial -> `/pedido` com servico preenchido (resposta de `GET /drafts/current` com `service_name`); digitar no servico limpa `service_id`. |
| **F5 ponta a ponta e fechamento** | Servidor local `DEV_PORT=3010 corepack pnpm dev`; conferir revisao e painel. | Curl real (feliz): (1) `POST /api/v1/geo/address-suggest` sem cookie -> 403 `not_draft` (esperado, tela nao mostra); (2) `POST /api/v1/drafts {"service_id":"<id do catalogo>"}` -> 201 + `Set-Cookie`, corpo com `service_name`; (3) `GET /api/v1/drafts/current` com o cookie -> 200 com `service_name`; (4) sugestao com cookie -> 200 `mode:'ok'`. Confirmar `GET /api/v1/drafts/current/review` (`service.name`) e `GET /v1/requests` (`serviceName`, `[NV]`). `corepack pnpm check:all`, `check:hex`, `check:typography`, `check:logs` nos arquivos alterados; typecheck e lint. Sem simular resultado. |

Regras para o Dev: tocar so os arquivos listados (`address-field.js`, `inicio.js`, `pedido.js`, `request-draft.ts` no db, `ports.ts` e `request-draft.ts` no domain, migracao e rollback, testes). Nao editar `draft-gate.ts`, `address-suggest-service.ts`, rotas, limites. QA da #155 nao roda em paralelo (regra da rodada 154). Cada fatia e um commit proprio na `feature/init` (commit so no Dev, nao nesta etapa).

---

## 6. Riscos

| Nº | Risco | Mitigacao |
|---|---|---|
| R-A1 | Criar rascunho ao escolher servico antecipa a criacao (mais POST). Limite 10/h e 50/dia por IP; teto global 5.000. | Uma tentativa por pagina (`criandoRascunho`/`rascunhoVivo`); 429/503 silenciosos e "Continuar" trata E-07; so cria quando ja ha servico escolhido (menos orfaos que a alternativa a). |
| R-A2 | Rascunho orfao com endereco em claro (so servico escolhido, sem endereco, na inicial: baixo dado pessoal). Em `/pedido` ja existe o mesmo comportamento hoje. | Decisao 999(A): 7 dias e divida registrada (407, job H-110 E2). |
| R-A3 | Visitante com rascunho vivo e sem escolher servico: nao ha GET na carga, entao nao ha sugestao ate escolher servico. | Aceito: servico vem primeiro (decisao 940/942) e o campo segue digitavel; sem custo extra de leitura. |
| R-A4 | `service_name` de servico inativo ou removido: nome continua vindo de `app.service` (sem filtro de ativo) ou `null`. | Revisao ja sinaliza servico inativo (`service_active`); /pedido usa o texto de apoio quando `null`. |
| R-A5 | Selecao extra no banco em cada GET/POST/PATCH com servico. | Uma consulta por chave primaria; nao ha N+1; falha degrada para `null`. |
| R-A6 | Testes existentes dependem do POST so em "Continuar" (`inicio-continuar`, `inicio-page`, e2e `fluxo-pedido.spec.ts`). | Ajuste explicito na F3; o e2e Playwright e opcional e fora do QA final. |
| R-A7 | `authorization-catalog`/`matrix.ts` podem exigir registro da funcao nova. | F1 ja inclui conferencia e inclusao se necessario; catalogo verde e criterio de saida da fatia. |
| R-A8 | Conflito com #153/#154/#155 (ja entregues). | Escopo de arquivos fechado (§5). |

---

## 7. Criterios de saida da Arquitetura e proximo passo
- Contrato, migracao e fatias definidos; nenhuma pergunta nova ao dono. Todas as decisoes necessarias ja foram adotadas (996 a 999) ou sao tecnicas (D-ARQ-159-1 a 7), a registrar pelo lider em `11-DECISOES.md` como "adotada".
- Proximo: Desenvolvimento (F0 vermelho primeiro). Nenhum cartao movido por esta etapa.
- Itens `[NV]` entregues ao Dev: formato do catalogo/`matrix.ts`; `serviceName` em `PANEL_ITEM_KEYS`; fakes de `DraftRecord`; comportamento exato de `carregar()` em `/pedido` para GET 404 (confirmar que mantem `criado = false`).
