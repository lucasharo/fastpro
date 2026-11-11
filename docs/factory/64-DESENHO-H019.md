# Desenho H-019 — Busca de serviço com sinônimos (Issue #32, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA. Sem dúvida bloqueante para o DEV. Itens de texto e de latência dependem de aceite/medição (§6).
- **Rastro:** 61-REFINO-H019 (CA-01..07, dúvidas a..i); decisões do Orquestrador (mín. 2 caracteres, máx. 10 sugestões, meio da palavra com prioridade ao início, sinônimo que casou não aparece, campo reutilizável em H-019 e uso em H-025, termo fora de log com identificador, leitura própria por função `security definer` em `app_api` sem sinônimos inativos); 53-DESENHO-H018 (§1 normalização, §2 leitura pública, R-9); 56-DESENHO-H020 (padrão de rota, portas e limites); 08 §4.1 (módulo `catalog`).
- **Natureza:** somente documento. Nada de código, migração ou teste foi criado.
- **Etiquetas:** `[VERIFICADO]` lido no repositório · `[DECIDIDO]` Orquestrador · `[PROPOSTA]` deste desenho.

## 0. Fatos verificados

1. `private.catalog_norm(text)` existe (IMMUTABLE, `unaccent` com dicionário, minúsculas, espaços colapsados); `name_norm` e `term_norm` são colunas **geradas e armazenadas** em `service`, `service_group` e `service_synonym`. `[VERIFICADO]` migração `20261111200000`.
2. A leitura pública atual é `private.catalog_public_list()` (`security definer`, `search_path=''`, `execute` só `app_api`), sem sinônimos; `app_api` não tem grant de coluna nas tabelas do catálogo; não há política de RLS nelas. `[VERIFICADO]` migração `20261111250000`. A busca segue o mesmo padrão e **não altera** essa função (T-H018-06 intacto).
3. `pg_trgm` e `unaccent` estão instalados no esquema `extensions`. `[VERIFICADO]` Nenhum índice de busca existe; não é necessário no volume de MVP (§1.3).
4. Contrato público de campos em `packages/contracts/src/catalog.ts` (`CATALOG_PUBLIC_FIELDS`, `CATALOG_FORBIDDEN_PUBLIC_FIELDS`). A API em `apps/api/src/app.ts` registra rotas por opção injetada (`consume`, `session`, `geo`), com `routePath`, limite de corpo, `Origin` conferida e `Cache-Control: no-store`. `packages/ui` e `apps/web` ainda são esqueleto (sem componente).
5. Limite de taxa pronto em `private.rl_check/rl_hit` (chaves como HMAC; padrão de H-020 §4.1).

## 1. Função de busca em banco (CA-01, CA-03, CA-04, CA-05)

### 1.1 Assinatura e segurança
`private.catalog_search(p_term text)` retorna a tabela `(group_id, group_name, group_position, service_id, service_name, modality, regulated)` — **os mesmos 7 campos de `CATALOG_PUBLIC_FIELDS`**, nada mais. `language sql stable security definer set search_path = ''`; todos os objetos qualificados (`app.`, `private.`); `revoke all … from public, anon, authenticated`; `grant execute … to app_api`. Nova migração `supabase/migrations/<próximo timestamp livre>_catalog_search_function.sql` (idempotente, `create or replace`) e `supabase/rollbacks/<mesmo timestamp>_catalog_search_function.down.sql` (`drop function`). Sem tabela nova e sem coluna nova.

### 1.2 Regra (esboço normativo para o DEV)
```sql
with q as (select private.catalog_norm(p_term) as t),
cand as (
  select g.id gid, g.name gname, g.position gpos, s.id sid, s.name sname, s.name_norm sn,
         s.modality, s.regulated,
         least(
           case when strpos(s.name_norm, q.t) = 1           then 1
                when strpos(s.name_norm, ' ' || q.t) > 0    then 2
                when strpos(s.name_norm, q.t) > 0           then 3 end,
           (select min(case when strpos(y.term_norm, q.t) = 1        then 4
                            when strpos(y.term_norm, ' ' || q.t) > 0 then 5
                            when strpos(y.term_norm, q.t) > 0        then 6 end)
              from app.service_synonym y
             where y.service_id = s.id and y.active)) as rnk
    from q, app.service s join app.service_group g on g.id = s.group_id
   where g.active and s.active
     and char_length(q.t) >= 2 and q.t ~ '[[:alnum:]]')
select gid, gname, gpos, sid, sname, modality, regulated
  from cand where rnk is not null
 order by rnk, gpos, gid, sn, sid
 limit 10;
```
- **Normalização `[DECIDIDO]`:** o termo passa por `catalog_norm` (a mesma função de H-018; paridade com `catalogNorm` em TS, R-9). Sem acento e sem caixa (CA-01).
- **`strpos` em vez de `LIKE`:** o termo nunca é interpretado como padrão; `%`, `_` e `\` do visitante são texto comum, sem escape e sem injeção de padrão. Parâmetro sempre ligado por `$1`, nunca concatenado em SQL.
- **Relevância (CA-03, refinada `[PROPOSTA]`):** 1 nome começa · 2 nome tem palavra que começa (`pedr` acha "Servente de pedreiro" antes de um meio de palavra) · 3 nome contém · 4/5/6 o mesmo para sinônimo. `least` ignora nulos; o serviço fica com o **melhor** ranking entre nome e sinônimos ativos. Empate: posição do grupo, grupo, nome normalizado, id (ordem total e estável).
- **Uma linha por serviço:** vários sinônimos casando não duplicam o serviço. O sinônimo que casou **não sai** da função (CA-04). Se o titular pedir para mostrá-lo, é ajuste futuro com campo novo no contrato.
- **Termo curto ou sem letra/dígito** (menos de 2 caracteres após normalizar, ou só pontuação): conjunto vazio, sem erro. A API também recusa antes (§3).
- **Limite 10 `[DECIDIDO]`:** constante na função; a API não aceita outro valor.
- **Fora (CA-05):** serviço inativo, grupo inativo (e seus serviços), sinônimo inativo (só casa por ele se estiver ativo) e conselho profissional inativo (já `active=false` na semente) não aparecem. Grupo desativado esconde seus serviços sem mexer no `active` deles (53 §1).
- **Não casa:** nome do grupo e palavras fora de ordem (ex.: "pedreiro servente"); ordem de palavras e erro de digitação ficam fora (61 §3).

### 1.3 Índice
Nenhum agora `[PROPOSTA]`: o catálogo tem ordem de 500 serviços e poucos milhares de sinônimos; uma varredura com `strpos` em colunas já normalizadas é barata e mantém o desenho simples. **Gatilho para revisar:** se a medição local (§6, R-1) passar da meta, adicionar índice `gin (name_norm gin_trgm_ops)` e `(term_norm gin_trgm_ops)` (`pg_trgm` já instalado) e trocar `strpos` por `like '%'||q||'%'` com escape — decisão a registrar em nova migração, sem mudar o contrato.

## 2. Leitura própria da busca (CA-02, CA-05, privacidade)

- Só a função acima lê sinônimos para o público; `catalog_public_list` e a lista de campos permanecem como estão.
- **Campos que saem:** apenas os 7 de `CATALOG_PUBLIC_FIELDS`. **Nunca saem:** `term`, `term_norm`, `seed_key`, `council_body`, `moderation_sensitive`, `regulation_source`, `version`, `updated_by_ref`, carimbos, sinônimos (nenhum, nem ativos), `rnk`. O `rnk` é interno e fica de fora do `select` final.
- Quem chama: a API como `app_api` com `app.principal_type = 'anonymous'` (sem checagem de sessão); `anon`/`authenticated`/`PUBLIC` sem execução; esquema `app` e `private` não expostos ao navegador.
- A função **não grava nada** e não registra o termo (sem tabela de busca, sem `raise notice`, sem comentário que ecoe o parâmetro). Termo digitado não vai a log nem a auditoria (§3.4).

## 3. Campo reutilizável e rota (CA-02, CA-06, CA-07)

### 3.1 Rota `[PROPOSTA]`
`POST /v1/catalog/service-search`, corpo JSON `{ "q": string }`, limite de corpo 1 KB, `Content-Type: application/json`, `Origin` conferida como em H-012/H-020, resposta `Cache-Control: no-store`. **POST e não GET** para o texto não ir à URL (logs da plataforma, histórico, `Referer`) — mesmo motivo de H-020 §2.1. Registrada só se a opção `catalog` for injetada em `AppOptions`; sem ela, 404. Visitante sem conta pode usar (RF-002, FA-001): nenhuma sessão exigida. Sem CORS.

Ordem no servidor (qualquer falha encerra): (1) `Origin` e `Content-Type`; (2) corpo só com `q`, 1 KB; (3) normalização do texto de entrada (NFC, sem caracteres de controle, espaços colapsados) e validação 2..80 caracteres com ao menos uma letra/dígito, senão `400 entrada_invalida` (não conta limite e não vai ao banco); (4) limite de taxa; (5) porta de busca; (6) resposta.

Limite de taxa `[PROPOSTA]`: reutiliza `rl_check/rl_hit`, **90 por 60 s por IP-HMAC** (chave própria desta rota, separada da de H-020; digitação com atraso de 250 ms gera algumas chamadas por palavra). `rl_check` antes, `rl_hit` só depois de aceita. Excedente: `429`, código `limite`, sem ir à busca. Valores ajustáveis; a calibração vem da medição.

### 3.2 Contrato (em `packages/contracts/src/catalog-search.ts`, códigos fixos)
- `200 { "status": "ok", "items": [ { group_id, group_name, group_position, service_id, service_name, modality, regulated } ] }` — 1 a 10 itens, ordem já aplicada.
- `200 { "status": "vazio", "code": "sem_resultado", "items": [] }` — nenhum correspondente. Resposta separada do erro (CA-07 exige distinguir).
- `400 { "status": "erro", "code": "entrada_invalida" }` — termo curto, longo, sem letra/dígito, ou corpo fora do formato.
- `429 { "status": "erro", "code": "limite" }` com `Retry-After`.
- `503 { "status": "erro", "code": "falha" }` — banco ou porta indisponível, tempo esgotado. Sem corpo de erro do banco, sem mensagem de exceção, sem tentativa automática.
- O servidor **não envia texto de mensagem**: só o código. O texto fica no cliente (§4). A resposta de sucesso é projetada pela lista `CATALOG_PUBLIC_FIELDS` (nunca `select *` nem repasse da linha do banco).

### 3.3 Porta e adaptador
`CatalogSearchPort.search(q): Promise<readonly CatalogSearchItem[]>` em `apps/api/src/catalog/ports.ts` (a rota só conhece a porta; padrão de H-020). Adaptador real: abre transação curta, `set_config('app.principal_type','anonymous', true)`, chama `select * from private.catalog_search($1)` como `app_api` e converte qualquer exceção em um `error_code` fixo (`db_error`, `db_timeout`) descartando a mensagem. Tempo máximo da chamada ao banco `[PROPOSTA]` 2 s. Porta real não ligada: a rota responde `503 falha` (seguro por padrão, como em H-020).

### 3.4 Privacidade e log `[DECIDIDO]`
Log do fluxo usa **só** campos já na allowlist: `request_id`, `route`, `method`, `status`, `duration_ms`, `error_code`, `count` (nº de itens). Nenhum campo novo; o termo **nunca** entra em log, mensagem de erro, métrica ou auditoria, nem com `resource_id`. Contagem agregada de buscas (se houver) não leva texto. Sem tabela de termos buscados (61 §3).

### 3.5 Campo reutilizável (entregue em H-019; H-025 só o usa) `[DECIDIDO]`
Em `packages/ui`: `ServiceSearchField` (componente) sobre um **controlador sem dependência de tela**, `createServiceSearchController({ fetchSearch, debounceMs = 250, minChars = 2, clock })`, para testar sem navegador. Comportamento:
1. Menos de 2 caracteres (após trim): nenhuma consulta e nenhuma mensagem; lista fechada.
2. Debounce de 250 ms; nova digitação **aborta** a consulta anterior (`AbortController`) e **ignora resposta velha** (número de sequência). O campo nunca trava; a lista mostra "Buscando…" (CA-07).
3. Estados: `ocioso | carregando | resultados | vazio | falha | limite`. Mensagens por código (§4), nunca texto vindo do servidor.
4. Cada item mostra o nome do serviço e o nome do grupo (RF-003); não mostra sinônimo.
5. Escolher um item emite `onSelect({ service_id, service_name, group_id, group_name })`; digitar de novo depois de escolher **limpa** a escolha (`service_id` volta a nulo). O campo **só entrega um serviço quando houve escolha**; texto digitado sem escolha não é um serviço. Validar "serviço obrigatório" e gravar no pedido é de H-025.
6. Teclado e leitor de tela (FA-034, RF-161/162): padrão combobox/listbox — `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; setas movem, Enter escolhe, Esc fecha e devolve o foco ao campo; região `aria-live="polite"` anuncia "N sugestões" (número, singular/plural) e as mensagens de vazio e falha. Cores/foco conforme Design System do FastPro (tokens de `packages/tokens`).
7. Nenhuma escrita em storage/IndexedDB/Cache; o termo não vai à URL nem a analytics.

## 4. Mensagens como códigos fixos (CA-06, CA-07) `[PROPOSTA]`

Constantes únicas em `packages/contracts/src/catalog-search.ts`: `SERVICE_SEARCH_MESSAGES` indexada pelo código; a UI usa essa tabela, e o texto nunca é montado a partir do termo ou da resposta.

| Código | Quando | Texto (a validar, dúvida g) |
|---|---|---|
| `sem_resultado` | `200 vazio` | "Não encontramos esse serviço. Tente outra palavra." |
| `falha` | `503`, rede, tempo esgotado, JSON inesperado | "Não foi possível buscar agora. Tente de novo." |
| `limite` | `429` | "Muitas buscas seguidas. Aguarde alguns segundos." |
| `entrada_invalida` | `400` | sem texto ao visitante (o cliente já impede termo curto; se ocorrer, volta a `ocioso`) |
| (termo com menos de 2 caracteres) | decidido no cliente | nenhum texto, nenhuma sugestão, nenhum erro |

Regras: lista vazia nunca aparece sem texto (CA-06); falha nunca é mostrada como "nenhum resultado" (CA-07). Os textos são [PROPOSTA] de 61 §2; ligam-se a BK-5 (texto neutro). Troca de texto é uma edição da tabela, sem mudar o contrato.

## 5. Testes para o DEV (sem rede real)

### 5.1 Unidade (`node:test`/vitest, sem rede e sem banco)
- **T-H019-01** Paridade: `catalogNorm` (TS) igual a `catalog_norm` nos pares fixos de H-018 T-H018-05 e nos casos de busca ("PROJETO ARQUITETONICO", "ampliacao", "Ampliação / puxadinho").
- **T-H019-02** Contrato: resposta `ok` tem exatamente `CATALOG_PUBLIC_FIELDS` por item; falha se aparecer qualquer chave de `CATALOG_FORBIDDEN_PUBLIC_FIELDS`, `term`, `term_norm`, `synonym` ou `rnk`; `items.length <= 10`.
- **T-H019-03** Rota com porta simulada: 200 `ok`; 200 `vazio/sem_resultado`; 400 `entrada_invalida` para vazio, 1 caractere, só espaços, só pontuação, 81 caracteres, corpo com chave extra, corpo >1 KB; `Origin` ou `Content-Type` errados; 429 `limite` (91ª em 60 s) com a porta de busca **não chamada**; 503 `falha` quando a porta lança erro; `Cache-Control: no-store` em todas; opção `catalog` ausente ⇒ 404; porta real não ligada ⇒ 503.
- **T-H019-04** Log com termo "canário" sintético: fluxos de sucesso, vazio, erro e limite; reprova se o termo (ou sua forma normalizada) aparecer em qualquer log, mensagem de exceção ou resposta de erro; só campos da allowlist.
- **T-H019-05** Adaptador de banco com cliente simulado: converte exceção em `error_code` fixo e descarta a mensagem; usa parâmetro ligado (`$1`), nunca concatenação (teste estático da consulta).
- **T-H019-06** Controlador com relógio falso: 0–1 caractere ⇒ nenhuma consulta e nenhuma mensagem; rajada ⇒ 1 consulta após 250 ms; nova digitação aborta a anterior; resposta velha é ignorada; estados `carregando → resultados|vazio|falha|limite`; a mensagem vem da tabela de códigos; escolha emite `onSelect` e digitar depois limpa `service_id`; espiões provam nenhuma escrita em storage/IndexedDB/Cache e termo fora da URL.
- **T-H019-07** Acessibilidade do componente: setas, Enter, Esc; atributos ARIA (`combobox`, `aria-activedescendant`); anúncio "N sugestões" na região viva (1 ⇒ singular); mensagem de vazio e de falha na região viva.
- **T-H019-08** Estático da migração: `security definer`, `set search_path = ''`, `stable`, `revoke … from public, anon, authenticated`, `grant execute … to app_api` apenas; sem `like`/`ilike` com concatenação do parâmetro; sem `raise notice`/`raise log` que cite o parâmetro; nenhum `insert/update/delete`; a função `catalog_public_list` não foi alterada.

### 5.2 Banco de desenvolvimento (`pnpm db:test`, `*.dbtest.mjs`; cada caso em transação com `rollback`; a semente é aplicada **dentro** da transação, nunca por `db:seed:catalog`)
- **T-H019-09** (CA-01) Sem acento e sem caixa: "PROJETO ARQUITETONICO" acha "Projeto arquitetônico"; "ampliacao" acha "Ampliação / puxadinho"; "AMPLIAÇÃO" idem.
- **T-H019-10** (CA-03) Ordem: "pedr" lista "Pedreiro" antes de "Servente de pedreiro" (e antes de um serviço só com "pedr" no meio); nome antes de sinônimo; início antes de meio de palavra; empate por posição do grupo e nome; **no máximo 10** resultados com termo amplo (ex.: "a" não, "ao"/"ar" sim); sem repetir serviço quando nome e sinônimos casam.
- **T-H019-11** (CA-04) Sinônimo: "empreiteiro" e "empreit" acham "Construção de casa" com seu grupo; a linha traz só os 7 campos (sem o termo).
- **T-H019-12** (CA-05) Inativos: serviço inativo (por nome e por sinônimo), sinônimo inativo (só ele digitado ⇒ sem o serviço; nome ou outro sinônimo ativo ⇒ aparece), grupo inativo (todos os serviços somem), item de conselho inativo da semente: nenhum aparece.
- **T-H019-13** Entradas: `null`, `''`, 1 caractere, só espaço, só `%`/`_`/`\`/`--`/aspas ⇒ conjunto vazio sem erro e sem tratar como padrão (`%%` não devolve o catálogo todo); termo com 200 caracteres ⇒ vazio sem erro.
- **T-H019-14** Privilégio: como `app_api` com principal `anonymous` a função executa; `anon`/`authenticated`/`PUBLIC` ⇒ 42501; `select` direto em `service_synonym` por `app_api` continua 42501; a função não altera nenhuma tabela (contagens antes/depois iguais).
- **T-H019-15** Normalização no banco: o resultado da busca com termo em caixa/acento diferentes é idêntico ao do termo normalizado.
- **T-H019-16** Medição (relatório, não aprovação): com a semente completa aplicada na transação, 200 buscas (termos de 2, 3 e 5+ letras, com e sem resultado) via `app_api`; registrar p50, p95 e máximo no relato da Issue (comando, contagem, código de saída). Sem valor inventado: o número do relato é o que vale.

## 6. Riscos e mitigação

| # | Risco | Mitigação |
|---|---|---|
| R-1 | **Latência** (risco de 14-BACKLOG, sem número): varredura sem índice, ida e volta API-banco e partida a frio | Medir **localmente** (T-H019-16) a função e a rota; **meta de partida `[PROPOSTA]` para calibrar com o QA e o titular, não valor aprovado**: p95 da função abaixo de 50 ms e resposta da rota abaixo de 300 ms com banco quente. Debounce 250 ms e aborto da consulta anterior protegem a interface. Se passar da meta: índice trigram (§1.3), depois cache em memória por termo normalizado (resultado idêntico para todos). Rede e cold start da hospedagem real só aparecem com medição no ambiente de homologação; registrar como limite conhecido |
| R-2 | Abuso e custo: rota pública sem login pode ser raspada para enumerar o catálogo ou pesar no plano gratuito | Limite 90/60 s por IP-HMAC; limite de 10 itens; catálogo já é público por H-018; sem consulta abaixo de 2 caracteres; o banco só lê (sem escrita por busca, exceto o contador de taxa) |
| R-3 | Vazamento do termo digitado (texto livre de visitante) em log ou na URL | POST sem texto em URL; allowlist de log; adaptador que descarta mensagem de exceção; T-H019-04 com canário |
| R-4 | Divergência TS/SQL na normalização ou "ç", "ñ" e símbolos | Função única `catalog_norm` no banco; TS só espelha em teste e cliente; T-H019-01/15 |
| R-5 | Sinônimo exposto por acidente ou campo interno no retorno | Função com retorno fixo de 7 campos; projeção por lista de permissão; T-H019-02/08/11 |
| R-6 | Catálogo provisório (semente sem aceite, itens de conselho inativos) deixa a busca pobre para saúde/jurídico | Intencional (53 R-3); a busca reflete o estado do catálogo; ativação é alteração de administrador |
| R-7 | Termo amplo ("ar") devolve 10 resultados pouco úteis | Ordem por relevância e mínimo de 2 caracteres; o visitante refina; sem busca por palavras fora de ordem (fora do escopo) |
| R-8 | Mensagens e limites são [PROPOSTA] | Tabela de códigos e constantes únicas; troca sem mudar contrato |
| R-9 | `rl_hit` escreve no banco a cada busca aceita (custo no plano gratuito) | Volume baixo no MVP; contagem só do que passou a validação; se apertar, contar em lotes ou subir o balde (H-020 §4.2 já registra a mitigação) |

## 7. Entrega proposta ao DEV

`supabase/migrations/<ts>_catalog_search_function.sql` e rollback · `packages/contracts/src/catalog-search.ts` (tipos, códigos, mensagens, limites 2/80/10/1 KB) · `apps/api/src/catalog/{ports,service-search-route,db-adapter}.ts` e opção `catalog` em `AppOptions` · `packages/ui` (`ServiceSearchField` e controlador) · testes §5 · `supabase/README.md` seção "Estado (H-019)". Ordem: contrato → migração e teste de banco → serviço e rota com porta simulada → adaptador → controlador → componente → medição de latência. Rodar `corepack pnpm check:all` e `db:test` localmente e registrar comando, contagem e código de saída.

## 8. Dúvidas para o líder (não bloqueiam o DEV)

1. **Número da Issue:** `21-ISSUES-CRIADAS.md` e o pedido divergem sobre #32 (dúvida a de 61). Este desenho e o commit usam #32 por instrução do Orquestrador; conferir no quadro.
2. **Meta de latência (dúvida h):** os números do R-1 são ponto de partida do arquiteto; a meta final deve sair da medição local (T-H019-16) com o QA. Recomendação: aprovar a meta só depois da medição.
3. **Texto de `limite`:** não existia em 61 (acrescentado como `[PROPOSTA]`). Recomendação: aprovar junto com os de CA-06/CA-07 (dúvida g).
4. **Ranking com "palavra que começa" (posição 2 e 5):** refinamento do arquiteto sobre CA-03; custa uma comparação e melhora "pedr" em "Servente de pedreiro". Recomendação: manter.
