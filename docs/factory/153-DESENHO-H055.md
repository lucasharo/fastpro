# Desenho H-055 — Descoberta de pedidos elegíveis (Issue #68)

EXEC-ID: EXEC-ARQ-68-20261119 | Workflow: WF-03 | Etapa: Arquitetura | Branch: feature/init
Fontes: `139-REFINO-H055.md` (§3, §5, §6, §7, perguntas 603 a 622), `97-DESENHO-H023.md` (§4.4, decisões 107/108),
`127-DESENHO-H032.md` (padrão de rota e visibilidade), migração `20261113420000_eligibility_expand_professional_access_guard.sql`
(Issue #55, aplicada no DEV), código lido: `packages/db/src/discovery-requests.ts`, `packages/db/src/request-visibility.ts`,
`packages/domain/src/discovery/discovery-rules.ts`, `apps/api/src/requests/detail-route.ts`, `packages/db/src/catalog-search.ts`.
Este documento é só desenho: nenhum código, migração, banco ou quadro foi alterado.

---

## 1. Resumo da arquitetura

A rota `GET /v1/professional/discovery/requests` fica na API, atrás da sessão do profissional. Ela chama o banco uma vez
para descobrir os ids (função existente `private.discover_requests`, com a guarda da #55 dentro dela), projeta cada id com a
função existente de detalhe do profissional (`private.request_detail_professional`, mesma regra de casamento, sem coordenada)
e devolve a página com um cursor opaco cifrado (AES-256-GCM) feito na API. A distância métrica interna nunca sai do servidor.

Fato verificado no código: `discover_requests` devolve só `(out_request_id, out_cursor_group, out_cursor_key)`. Os campos
públicos (serviço, urgência, descrição, rótulo, distância em km, modalidade, datas) não vêm dela. Por isso a projeção é um
segundo passo, no mesmo instante `p_now`.

```
GET /v1/professional/discovery/requests?limit&cursor
  -> método/caminho -> sessão (401) -> perfil profissional (403) -> query estrita (400)
  -> rate limit 60/min (429) -> decifra cursor (400 cursor_invalido)
  -> t = relógio da API (UM instante)
  -> PgDiscoveryStore.discover({professionalId, at: t, limit+1, after})   [guarda #55 dentro; vazio se inelegível]
  -> para cada id: request_detail_professional(professionalId, id, t)      [0 linhas = descarta o item]
  -> monta itens (lista fechada) + has_more + next_cursor cifrado
  -> 200 (sempre com Cache-Control: no-store, Referrer-Policy: no-referrer)
```

## 2. Decisões (todas "adotada pelo líder", seguindo a recomendação do PO)

| Nº | Decisão | Status |
|---|---|---|
| 603 | Rota `GET /v1/professional/discovery/requests` (opção a). | adotada pelo líder |
| 604 | Cursor com AES-256-GCM, chave por HKDF-SHA-256, nonce aleatório de 12 bytes, AAD com versão e id do profissional (opção a). | adotada pelo líder |
| 605 | Variável `DISCOVERY_CURSOR_KEY`, mínimo 32 caracteres, em `.env.example` e `check:env`, padrão de `ADDRESS_ENC_KEY`/`PHONE_ENC_KEY` (opção a). | adotada pelo líder |
| 606 | Cursor expira em 24 h (`iat` dentro do payload cifrado; relógio injetado) (opção a). | adotada pelo líder |
| 607 | Usuário autenticado sem perfil profissional: 403 `perfil_profissional_obrigatorio` (opção a). | adotada pelo líder |
| 608 | Envelope `{ items, next_cursor, has_more }` (opção a). | adotada pelo líder |
| 609 | Só `has_photos: boolean`, sem URL, id ou contagem (opção a). Ver §5.3 e risco R-04. | adotada pelo líder |
| 610 | 60 requisições por minuto por profissional; 429 `muitas_requisicoes` com `Retry-After` (opção a). | adotada pelo líder |
| 611 | Inelegível: 200 com `{items: [], next_cursor: null, has_more: false}` (opção a). | adotada pelo líder |
| 612 | Ordem: grupo 0 presencial (distância, id), depois grupo 1 online (id) (opção a). | adotada pelo líder |
| 613 | Sem base presencial: devolve só online, sem erro (opção a). | adotada pelo líder |
| 614 | `description` íntegra, sem truncar (opção a). | adotada pelo líder |
| 615 | Piso de 0,5 km para a mesma célula (opção a). | adotada pelo líder |
| 616 | Prazo aberto à direita: `p_now < acceptance_deadline_at` (opção a). | adotada pelo líder |
| 617 | `urgency` com o valor literal do enum (opção a). | adotada pelo líder |
| 618 | Query desconhecida ou repetida: 400 `parametro_invalido` (opção a). | adotada pelo líder |
| 619 | `no-store` e `no-referrer` em toda resposta, inclusive 400/401/403/429/503 (opção a). | adotada pelo líder |
| 620 | Arquivos em `apps/api/src/requests/` (opção a). | adotada pelo líder |
| 621 | Guarda dentro de `private.discover_requests` (opção a); a API não repete a checagem. | adotada pelo líder |
| 622 | Desenvolvimento só depois da #55 concluída (opção a). A #55 está concluída e aplicada no DEV: condição cumprida. | adotada pelo líder |

Decisões técnicas do Arquiteto (a confirmar apenas se o líder quiser vetar):
- **A-1 Projeção sem migração nova.** Reutiliza `private.request_detail_professional` (migração `20261113230000`), que já aplica
  `status='publicado'`, `p_now < prazo`, mesma regra de casamento da descoberta, distância em passos de 0,5 km com piso 0,5, e
  não lê `exact_point`. Alternativa descartada: nova função em lote (melhor desempenho, mas exige migração e duplica regra de casamento).
- **A-2 Um único instante.** A API lê o relógio uma vez e passa o mesmo `at` à descoberta, à projeção e ao `iat`/validação do cursor (RN-H055-12).
- **A-3 Rate limit antes de decifrar o cursor.** Diverge da ordem do desenho de fluxo do refino (§5.1 decifrava antes) para que
  enxurrada de cursores forjados também seja limitada. O limite conta por profissional (HMAC do id), via `private.rl_check`/`rl_hit` (sem migração).
- **A-4 Falha de projeção parcial.** Se `request_detail_professional` devolver 0 linhas para um id (pedido encerrou entre as duas chamadas),
  o item é descartado em silêncio; o cursor continua calculado sobre o último id **devolvido pela descoberta** (não sobre o último item projetado),
  para não reler nem pular itens.

## 3. Rota e contrato de API

### 3.1 Requisição
`GET /v1/professional/discovery/requests` com o cookie `fastpro_session` (`SESSION_COOKIE_NAME`; autenticação por `hashSessionSecret`, como em `detail-route.ts`).
Parâmetros aceitos: `limit` (inteiro decimal puro `^[0-9]{1,3}$`, 1 a 200, padrão 50, `DISCOVERY_PAGE_DEFAULT`/`DISCOVERY_PAGE_MAX`) e `cursor` (string base64url, até 512 caracteres).
Qualquer outro parâmetro, parâmetro repetido, `limit=0`, `limit=abc`, `limit=1.5`, `limit=` vazio: 400 `parametro_invalido`.
Outro método (POST, HEAD, etc.): 404 uniforme (padrão da #45). Sem CORS. Sem corpo lido.

### 3.2 Ordem das checagens e respostas

| Ordem | Condição | Resposta |
|---|---|---|
| 1 | Caminho ou método não casa | 404 uniforme |
| 2 | Sem cookie ou sessão nula | 401 `{code:"sessao_necessaria"}` |
| 3 | Usuário sem perfil profissional | 403 `{code:"perfil_profissional_obrigatorio"}` |
| 4 | Query inválida | 400 `{code:"parametro_invalido"}` |
| 5 | Excedeu 60/min | 429 `{code:"muitas_requisicoes"}` + `Retry-After` (inteiro, segundos) |
| 6 | Cursor malformado, adulterado, de outro profissional, versão desconhecida ou vencido | 400 `{code:"cursor_invalido"}` (um único código para todos os motivos; sem consultar o banco) |
| 7 | Banco ou projeção falhou | 503 `{code:"descoberta_indisponivel"}` corpo constante, sem texto de driver |
| 8 | Inelegível pela guarda, sem pedidos ou página vazia | 200 `{items:[],next_cursor:null,has_more:false}` |
| 9 | Sucesso | 200 `{items:[...],next_cursor:string|null,has_more:boolean}` |

Cabeçalhos em todas as respostas: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json; charset=utf-8`.
O corpo 200 de inelegível é byte a byte igual ao de elegível sem pedidos (teste de igualdade exata de corpo e cabeçalhos).
Sobre o tempo de resposta: o inelegível volta mais rápido (a guarda retorna antes do casamento). Mitigação aceita: o rate limit e o fato de a resposta ser idêntica; não se adiciona atraso artificial (ver risco R-03).

### 3.3 Item da lista (lista fechada de 11 chaves, nesta ordem)
```
{ id, service_id, service_name, urgency, description, public_label, distance_km, modality, published_at, acceptance_deadline_at, has_photos }
```
- `urgency`: `imediato | proximas_semanas | proximo_mes | nao_definido` (literal do enum).
- `distance_km`: número com 1 casa (0,5; 1,0; 1,5 ...) para `presencial`; `null` para `online`.
- `modality`: `presencial | online`.
- `public_label`: "Cidade - UF" ou `null`.
- `published_at` e `acceptance_deadline_at`: ISO-8601 UTC.
- `has_photos`: booleano (ver §5.3).

Proibido no corpo: nome do cliente, e-mail, telefone, endereço (texto ou cifrado), ponto exato, `match_lon`/`match_lat`/`match_cell`,
distância em metros, chave interna do cursor, contagem de aceites, vagas, ondas, status do pedido, `user_id` do cliente, `geocode_point_id`.

### 3.4 Tipos (domínio)
`RequestDiscoveryItem` (11 chaves acima) e `RequestDiscoveryPage` em `packages/domain` (arquivo novo `discovery/discovery-page.ts`), exportados pelo índice do domínio.
A lista fechada de chaves vira constante `DISCOVERY_ITEM_KEYS`, usada pelo serializador e pelos testes (mesmo padrão de `ELIGIBLE_PROFESSIONAL_KEYS` em `visibility.ts`).
O serializador copia **chave por chave** da linha do banco para o item; nunca faz spread da linha.

## 4. Cursor opaco assinado e cifrado

Módulo: `apps/api/src/requests/discovery-cursor-crypto.ts` (só `node:crypto`; sem dependência nova).

- **Payload** (JSON compacto): `{ g: 0|1, k: inteiro >= 0, id: uuid, iat: ms epoch }`. `k` é a distância interna em metros (grupo 0) ou 0 (grupo 1).
- **Chave:** `HKDF-SHA-256(ikm = DISCOVERY_CURSOR_KEY, salt = "fastpro-discovery-cursor-v1", info = "cursor-aead")`, 32 bytes, derivada uma vez na composição.
- **Cifra:** AES-256-GCM, nonce aleatório de 12 bytes (`randomBytes`) por emissão, tag de 16 bytes, `AAD = "cur1|" + professionalId`.
- **Formato:** `base64url( 0x01 | nonce(12) | tag(16) | cifrado )`. Tamanho típico menor que 120 caracteres; teto de entrada 512.
- **Validação na leitura:** tamanho mínimo, versão `0x01`, tag GCM, JSON com tipos exatos (`g` em {0,1}, `k` inteiro seguro >= 0, `id` UUID, `iat` inteiro), `iat <= agora + 60 s` e `agora - iat <= 24 h`. Qualquer falha lança o mesmo erro fixo `cursor_invalido`, sem diferenciar a causa, sem registrar o token.
- **Reuso entre profissionais:** falha de AAD, mesmo código `cursor_invalido`.
- **Chave ausente ou curta (menos de 32 caracteres):** a composição da API falha ao subir (padrão `chave_taxa_busca_invalida`), nunca em tempo de requisição. Em teste, a chave vem injetada.
- **Rotação:** versão no primeiro byte permite introduzir `0x02` com nova chave; fora de escopo agora. Trocar a chave só invalida cursores em voo (efeito: 400 e o cliente reinicia a lista).
- **Emissão:** `next_cursor` é gerado a partir do **último id devolvido pela descoberta** quando `has_more` é verdadeiro; senão `null`.

## 5. Dados e banco

### 5.1 Sem migração nova no caminho principal
Usa `private.discover_requests` (6 argumentos, `p_now`, guarda `descoberta_aceite` da #55 dentro) por `PgDiscoveryStore.discover({professionalId, at, limit, after})`, e
`private.request_detail_professional(professional_id, request_id, now)`. Ambas só executáveis por `app_system`; a API usa o papel e a conexão já existentes (`sql-pool.ts`).

### 5.2 Novo adaptador de projeção (pacote db)
Arquivo novo `packages/db/src/discovery-projection.ts` com `PgDiscoveryProjectionStore.project(professionalId, ids, at)`.
Executa `request_detail_professional` por id, com no máximo 8 em paralelo (lotes), mantendo a ordem da descoberta. Reaproveita o mapeamento seguro de `request-visibility.ts` (mesmas 10 chaves) e não reexporta nada fora da lista.
Erro do banco vira código fixo (`discovery_projecao_falhou`); nenhum texto de driver sai.
Alternativa registrada: se o desempenho de 200 itens for ruim (200 chamadas), a evolução é uma função em lote por migração aditiva, em fatia própria, sem mudar o contrato HTTP.

### 5.3 `has_photos`
`app.media_asset` liga a foto ao **rascunho** (`draft_id`), com `status in ('pending','ready','rejected')`; a ligação rascunho para pedido publicado não foi verificada neste desenho.
Regra: `has_photos = true` somente quando existir ao menos uma mídia `ready` do rascunho de origem do pedido e sem expurgo pedido (`purge_requested_at is null`).
Passo 0 da fatia 3: o DEV confirma como o pedido publicado referencia o rascunho/mídias. Caso exista vínculo seguro, `has_photos` sai de uma consulta somente leitura. Se a leitura exigir função nova, ela entra como **migração aditiva mínima** (função `private.request_discovery_photo_flags(uuid[])`, `app_system` apenas, sem retornar chave de arquivo), com rollback em `supabase/rollbacks/`, aplicada com `npx supabase`. Se não houver vínculo no modelo atual, o campo sai `false` constante e fica registrado como pendência da H-056, nunca inventado.
A migração, se necessária, é a única exceção ao "sem migração nova".

### 5.4 Paginação (lookahead)
Para `has_more` exato, a API pede `limit + 1` e descarta o excedente. O domínio hoje limita a página a 200 (`isValidDiscoveryLimit`), então 201 seria recusado.
Passo 0 da fatia 2: o DEV lê `private.discover_scan` e `isValidDiscoveryLimit`. Se o banco aceita 201, o adaptador ganha limite interno `DISCOVERY_FETCH_MAX = 201` sem mudar o teto público de 200. Se o banco recusa, usa-se o fallback `has_more = (linhas == limit)`, documentado, aceitando uma página final vazia ocasional. Nenhum dos dois altera o contrato HTTP.

## 6. Segurança, anti-enumeração e privacidade do cliente

- **Silêncio financeiro (decisão 569):** a API não conhece o motivo da inelegibilidade: a guarda do banco devolve conjunto vazio. A rota nunca chama a guarda separadamente nem diferencia a resposta. Sem log do motivo.
- **Sem perfil profissional (607):** 403 é por papel, não por situação financeira; não revela verificação, plano ou pagamento.
- **Privacidade do cliente:** (a) a lista de chaves é fechada e testada por snapshot de chaves; (b) a projeção usa `request_detail_professional`, que não lê `exact_point` nem endereço; (c) `public_label` já é gerado na publicação (#45); (d) distância só em km arredondados de 0,5 km, impedindo triangulação por pedidos repetidos; (e) `first_name` fica fora (só após aceite, H-058).
- **Cursor:** opaco e preso ao profissional (AAD). Sem `k` visível, sem forjar páginas.
- **Anti-raspagem:** 60/min por profissional (HMAC da chave, sem expor id), `limit` máximo 200, cursor vence em 24 h, resposta `no-store`.
- **Erros:** corpos constantes, sem eco de entrada, sem texto de driver, sem stack. Nenhum log de cursor, id de pedido, descrição ou cookie.
- **Segredos:** `DISCOVERY_CURSOR_KEY` só em `.env.local`/ambiente; `.env.example` com campo vazio; `check:env` exige o tamanho mínimo. O valor nunca é registrado.
- **Rate limit sem custo para inelegível:** o limite é por sessão, igual para elegível e inelegível, para não revelar estado pela taxa.
- **Fora do desenho por política:** Mapbox (nenhuma chamada), e-mail real, Docker, backup.

## 7. Matriz de testes (T-*)

Todos locais (`corepack pnpm check:all`, `db:test`, `lint`, `typecheck`, `test`). Banco: dados sintéticos com marcador de teste no DEV, relógio injetado, limpeza ao fim.

| Id | Camada | Cenário | Esperado |
|---|---|---|---|
| T-H055-01 | rota | Sem cookie / sessão nula | 401 `sessao_necessaria`, cabeçalhos de segurança |
| T-H055-02 | rota | Usuário sem perfil profissional | 403 `perfil_profissional_obrigatorio` |
| T-H055-03 | rota | Método POST/HEAD, caminho com sufixo | 404 uniforme |
| T-H055-04 | rota | `limit` 0, 201, `abc`, `1.5`, vazio, repetido | 400 `parametro_invalido` |
| T-H055-05 | rota | Parâmetro desconhecido (`sort`, `filter`) | 400 `parametro_invalido` |
| T-H055-06 | rota | `limit` 1, 50 (padrão), 200 | 200; tamanho da página respeita o limite |
| T-H055-07 | rota | Cursor truncado, bit trocado, lixo, versão 2, vazio, mais de 512 caracteres | 400 `cursor_invalido`; banco não é chamado |
| T-H055-08 | rota | Cursor emitido ao profissional A usado pelo B | 400 `cursor_invalido` |
| T-H055-09 | rota | Cursor com 24 h + 1 s; com 24 h exatas; `iat` no futuro além de 60 s | recusa; aceita; recusa |
| T-H055-10 | rota | Rate limit: 60 ok, 61ª | 429 `muitas_requisicoes` + `Retry-After`; janela seguinte volta a 200 |
| T-H055-11 | rota | Inelegível (cada motivo: não aprovado, conta bloqueada, e-mail não verificado, trial expirado, expirada, sem acesso) | 200 com corpo idêntico, byte a byte, ao de elegível sem pedidos |
| T-H055-12 | rota | Elegível em `trial_ativo`, `ativa`, `em_carencia` (até 72 h), `cancelada_com_acesso_ate_fim_do_periodo` | 200 com itens; um segundo após o fim: lista vazia |
| T-H055-13 | rota+db | Mesmo `at` na guarda, no casamento e na projeção (relógio falso) | um único instante, sem divergência na fronteira |
| T-H055-14 | rota+db | Fronteira `p_now == acceptance_deadline_at` | pedido ausente; um segundo antes, presente |
| T-H055-15 | rota+db | Pedido de status diferente de `publicado`, cancelado, vencido | ausente |
| T-H055-16 | rota+db | Item sem projeção (encerrou entre as chamadas) | descartado em silêncio; sem erro; cursor segue o último id da descoberta |
| T-H055-17 | rota | Ordenação: grupo 0 por distância depois id; grupo 1 por id; transição na página | sem duplicata, sem salto |
| T-H055-18 | rota+db | Percorrer 3 páginas inserindo pedido novo no meio; remover um | sem repetição, sem OFFSET; pedido novo anterior ao cursor não aparece |
| T-H055-19 | rota+db | Profissional só com serviço online e sem base | só itens `online`, `distance_km` nulo, sem erro |
| T-H055-20 | rota+db | Mesma célula da base | `distance_km = 0.5` |
| T-H055-21 | rota+db | Serviço regulado declarado online | não aparece como online |
| T-H055-22 | privacidade | Chaves de cada item iguais exatamente a `DISCOVERY_ITEM_KEYS` | 11 chaves, nenhuma extra |
| T-H055-23 | privacidade | Varredura do JSON de resposta e do corpo de erro por: e-mail, telefone, endereço semente, `first_name`, `exact_point`, `match_`, `lon`, `lat`, `cell`, `cursor_key`, vagas, ondas | nenhuma ocorrência |
| T-H055-24 | privacidade | Distância sempre múltipla de 0,5 e maior ou igual a 0,5; nunca metros | ok |
| T-H055-25 | cursor | Ida e volta (cifrar/decifrar), nonce diferente a cada emissão, token sem `k` legível (busca da distância em claro e em base64) | ok |
| T-H055-26 | cursor | Chave ausente ou menor que 32 caracteres | composição falha ao subir |
| T-H055-27 | rota | `description` íntegra (2.000 caracteres) | sem truncamento |
| T-H055-28 | rota | Falha do banco (descoberta ou projeção) | 503 `descoberta_indisponivel`, corpo constante, sem texto de driver |
| T-H055-29 | rota | Cabeçalhos em 200, 400, 401, 403, 429, 503 | `no-store`, `no-referrer`, JSON UTF-8 |
| T-H055-30 | rota | Logs capturados durante testes | sem cursor, cookie, id de pedido, descrição |
| T-H055-31 | adaptador | `PgDiscoveryProjectionStore`: ordem preservada, no máximo 8 em paralelo, erro vira código fixo | ok |
| T-H055-32 | adaptador | Lookahead `limit+1` e `has_more` (ou fallback documentado) | exato conforme §5.4 |
| T-H055-33 | has_photos | Pedido com mídia `ready`, só `pending`/`rejected`, expurgada, sem mídia | `true`, `false`, `false`, `false` (ou constante `false` com pendência registrada, §5.3) |
| T-H055-34 | segurança | Privilégio: `anon`, `authenticated`, `service_role`, `app_api` não executam as funções usadas | recusado (teste existente de privilégios continua verde) |

## 8. Plano de implementação em fatias

Cada fatia termina com testes locais verdes e commit em `feature/init`. Sem Docker, sem Mapbox, sem e-mail real, sem backup.

| Fatia | Conteúdo | Arquivos | Migração |
|---|---|---|---|
| 1. Domínio e cursor | Tipos `RequestDiscoveryItem`/`Page`, `DISCOVERY_ITEM_KEYS`, validação de query pura (`limit`, chaves permitidas); `discovery-cursor-crypto.ts` com testes T-25/T-26/T-07/T-08/T-09 | `packages/domain/src/discovery/discovery-page.ts`, `apps/api/src/requests/discovery-cursor-crypto.ts` e testes; `.env.example`, `check:env` | não |
| 2. Adaptadores db | `PgDiscoveryProjectionStore`; lookahead no `PgDiscoveryStore` (passo 0 de §5.4); rate limit de descoberta (`rl_check`/`rl_hit`, chave `discovery:`+HMAC do profissional) | `packages/db/src/discovery-projection.ts`, `discovery-requests.ts`, `discovery-rate-limit.ts` e testes (T-31, T-32, T-10 base) | não |
| 3. Serviço e `has_photos` | `discovery-service.ts`: um `at`, descoberta, projeção, descarte, `has_more`, `next_cursor`; passo 0 de §5.3; T-12 a T-21, T-27, T-33 | `apps/api/src/requests/discovery-service.ts` e testes; migração aditiva só se o passo 0 exigir | condicional (mínima) |
| 4. Rota e composição | `discovery-route.ts`, `discovery-composicao.ts`, registro em `app.ts` (opção `requestDiscovery`), cabeçalhos, ordem de checagens; T-01 a T-11, T-28 a T-30 | `apps/api/src/requests/discovery-route.ts`, `discovery-composicao.ts`, `app.ts`, `index.ts` | não |
| 5. Privacidade e integração no DEV | T-22 a T-24, T-34; teste de integração com dados sintéticos no DEV (`db:test`), limpeza ao fim; `check:all` completo | testes `apps/api` e `packages/db` | não |

Dependências de ordem: 1 antes de 3 e 4; 2 antes de 3; 3 antes de 4. Nada depende de outra história em aberto (H-056 a H-060 ficam de fora).
Definição de pronto: `corepack pnpm check:all` com código de saída 0, contagem registrada na Issue, snapshot de chaves do item, documentação da rota no refino, sem credencial em log.

## 9. Riscos

| Id | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | N chamadas de `request_detail_professional` por página (até 200) | latência | paralelismo máximo 8; página padrão 50; evolução para função em lote por migração aditiva, sem mudar a API |
| R-02 | Duas leituras (descoberta e projeção) em instantes diferentes | itens somem ou aparecem na fronteira | mesmo `at` nas duas; item sem projeção é descartado (A-4) |
| R-03 | Inelegível responde mais rápido que elegível (canal de tempo) | enumeração de estado por medição | corpo e cabeçalhos idênticos; rate limit igual; risco residual baixo e aceito, sem atraso artificial |
| R-04 | Ligação pedido para mídia não confirmada para `has_photos` | campo errado ou migração inesperada | passo 0 da fatia 3; fallback `false` com pendência na H-056; nunca inventar |
| R-05 | Teto de `limit+1` rejeitado pelo banco ou pelo domínio | `has_more` impreciso | passo 0 da fatia 2; fallback documentado, sem mudar contrato |
| R-06 | Troca ou perda de `DISCOVERY_CURSOR_KEY` | cursores em voo falham (400) | efeito aceitável; cliente reinicia a lista; versão do formato prevê rotação |
| R-07 | Rate limit por profissional compartilha balde entre abas | 429 em uso legítimo intenso | 60/min cobre paginação humana; ajustável por constante |
| R-08 | `description` íntegra pode conter dado pessoal digitado pelo cliente | vazamento de PII em texto livre | fora do alcance técnico desta história; já coberto por orientação e moderação do rascunho (H-031); registrado como risco conhecido, sem pergunta ao dono |

## 10. Dúvidas que exigem o dono

Nenhuma. Todas as perguntas 603 a 622 foram adotadas pelo líder com a recomendação do PO. Os pontos de §5.3 e §5.4 (`has_photos` e `limit+1`) são verificações técnicas do DEV no passo 0 de cada fatia e não dependem de decisão do dono.

## 11. Entrega ao Orquestrador (HANDOFF)

- Próxima etapa: Desenvolvimento (WF-03), a partir da fatia 1, na branch `feature/init`.
- Nenhuma alteração de quadro, `11-DECISOES.md`, banco, migração ou código nesta etapa.
- Para registro em `11-DECISOES.md` pelo líder: 603 a 622 como "adotada pelo líder"; A-1 a A-4 como decisões técnicas do Arquiteto.
