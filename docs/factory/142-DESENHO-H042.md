# Desenho técnico H-042 — Guarda de elegibilidade na API e no banco, PARTE A (Issue #55)

- **Issue:** #55 `[E4] Guarda de elegibilidade na API e no banco` · **História:** H-042 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura · **Escopo deste documento:** parte A (guarda única, descoberta, detalhe, regressão). A parte B (aceite #71, fotos #69, rota de descoberta #68) só ganha o contrato de uso (§7).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, serviço externo (Mapbox proibido) ou quadro foi alterado.
- **Entradas lidas:** `137-REFINO-H042.md` (CA-H042-01 a 17, RN-H042-01 a 12, perguntas 563 a 582), Rodada 121 de `11-DECISOES.md` (decisões 563 a 582 adotadas), `127-DESENHO-H032.md` (D-09, T-20), `114-DESENHO-H045.md` (`commercial_access`), e leitura de código: `20261113230000_requests_expand_location_visibility.sql` (`request_visibility_guard`, `request_detail_professional`), `20261113210000_geo_expand_discovery_requests.sql` (`discover_scan`, `discover_requests`), `20261113170000_billing_create_access_grant.sql` (`commercial_access`), `20261112100500_identity_expand_professional_recovery.sql` (`professional_eligible`), `20261113250000_contact_create_phone_consent.sql` (consumidor da guarda da #45).
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§13).

## 0. Achados da leitura que mudam ou refinam o refino

1. `[VERIFICADO]` **A guarda da #45 já tem dois consumidores, não um.** Além de `request_detail_professional` (#45), as duas funções da #46 (`contact_create_phone_consent`, linhas 432 e 490) chamam `private.request_visibility_guard(uuid, timestamptz)`. Trocar o corpo (decisões 563, 566, 568) deixa a #46 mais estrita (e-mail verificado e acesso comercial). Os testes da #45 e da #46 que criam profissional "aprovado" sem e-mail verificado ou sem concessão de acesso vão falhar até o fixture ser ajustado (§9, risco R-01, `[PERGUNTA 642]`).
2. `[VERIFICADO]` **`private.discover_requests` não recebe `p_now`.** A entrada atual (5 argumentos) chama `discover_scan` com o `p_now` padrão `now()`. Para cumprir RN-H042-07 (um instante por requisição para a guarda e para `commercial_access`), a função precisa de um sexto parâmetro `p_now`. Isso muda a assinatura: a nova migração cria a de 6 argumentos (com `default now()`) e **remove a de 5 na mesma migração**, para não haver sobrecarga ambígua (`[PERGUNTA 641]`). Chamadas antigas com 5 argumentos continuam resolvendo para a nova, graças ao default.
3. `[VERIFICADO]` **`request_detail_professional` não precisa ser reescrita.** Ela já chama `request_visibility_guard` (linha 369 da migração `20261113230000`). Ao trocar o corpo da guarda, o detalhe passa a usar a regra nova sem tocar a função (escopo item 5 do refino fica satisfeito de forma transitiva; a prova é teste).
4. `[VERIFICADO]` `professional_eligible(uuid)` é `sql stable` **sem** `security definer`; `commercial_access(uuid, timestamptz)` é `security definer`, devolve `(estado, access_until)` e tem execução para `app_api` e `app_system`. A guarda nova será `security definer` e só `app_system` executa, então não depende dos grants das duas.
5. `[VERIFICADO]` Última migração do repositório: `20261113310000_verification_fix_duplicate_original_rule.sql`. O prefixo desta história é `20261113400000` (maior que qualquer existente; reservados da #47 e de outras ficam abaixo ou iguais ao declarado pelo líder). O DEV reconfere com `ls supabase/migrations | tail -3` e renomeia migração e reversão juntas, se necessário.
6. `[VERIFICADO]` O CHECK de `verification_status` tem os valores `aprovada`, `em_revisao`, `recusada`, `retida_duplicidade`, `suspensa` e `pendente` (refino §5.2). Não há estado "revogado": mapeia para `suspensa` `[DECIDIDO 565]`. A guarda **permite só `aprovada`** (lista de permissão); qualquer valor futuro cai em negado por padrão.

## 1. Decisões de arquitetura

| # | Decisão | Alternativa recusada | Motivo |
|---|---|---|---|
| D-01 | **Uma função nova** `private.professional_access_guard(p_professional_id uuid, p_mode text, p_now timestamptz) returns boolean`, que chama `professional_eligible` e `commercial_access`. `[DECIDIDO 563]` | Estender `professional_eligible` | Protege #37, H-016 e a publicação (CA-H042-14) |
| D-02 | **Dois modos**, texto fixo: `descoberta_aceite` e `participacao`. Modo desconhecido ou nulo = `false`. `[DECIDIDO 573]` | Parâmetro booleano | Nome legível, extensível, sem ambiguidade de sinal |
| D-03 | **Fail closed dentro do banco:** a função nunca levanta exceção para o chamador. Parâmetro nulo, modo inválido, erro interno, `commercial_access` sem linha ou estado fora da lista = `false`. Bloco `exception when others then return false`. `[DECIDIDO 578]` | Deixar a exceção subir | O chamador (rota) trataria erro como 500/503 e alguns chamadores novos poderiam "ignorar e seguir". Retornar `false` é a única saída que nega por padrão |
| D-04 | **Lista de permissão de estados de acesso**, só dentro da guarda: `trial_ativo`, `ativa`, `cancelada_com_acesso_ate_fim_do_periodo`, `em_carencia` `[DECIDIDO 577]`. Estado novo no futuro = negado até alguém atualizar a guarda. | Lista de negação (`sem_acesso`, `trial_expirado`, `expirada`) | Novo estado não pode abrir acesso por omissão |
| D-05 | **`p_now` obrigatório, sem default**, na guarda nova. O mesmo `p_now` vai para `commercial_access`. `[DECIDIDO 571]` `[PERGUNTA 640]` | Default `now()` | `now()` em transação longa ou duas leituras na mesma requisição divergem; o relógio é do servidor da API |
| D-06 | **`request_visibility_guard(uuid, timestamptz)` fica como fachada**: mesma assinatura, mesmo `stable security definer`, corpo = `return private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)`. Nova migração com `create or replace`; migração `20261113230000` **não é editada**. `[DECIDIDO 568]` | Reabrir a #45; apagar a fachada | A assinatura é usada por #45 e #46; trocar o corpo evita tocar essas migrações |
| D-07 | **Fachada preserva o `raise 22023` de parâmetro nulo** da versão antiga (`visibilidade_parametro_invalido`) para não quebrar testes da #45 e #46; a guarda nova, não. `[PERGUNTA 643]` | Fachada também devolver `false` | Mudaria teste existente sem ganho; a rota nunca passa nulo |
| D-08 | **`discover_requests` ganha `p_now` e a guarda** no início: guarda `false` = retorno vazio, antes de ler a base do profissional. `discover_scan` **não muda** (primitiva de paridade da #36). `[DECIDIDO 567]` | Guarda dentro de `discover_scan` | Quebra a paridade da #36 |
| D-09 | **A regra mora só no banco.** O domínio e a API guardam apenas os nomes dos modos e uma porta; **não repetem** a lista de estados nem a condição de verificação (CA-H042-01). A matriz de §5 existe só como oráculo dentro dos testes. | Espelhar a regra em TypeScript | Duas cópias derivam; foi o problema da #45 |
| D-10 | **Resposta uniforme:** a guarda devolve só `boolean`. Os consumidores transformam `false` em "zero linhas" (detalhe, descoberta) ou no mesmo corpo de "indisponível" (rotas). Nenhuma função devolve motivo, estado de verificação, estado de acesso ou data de acesso. `[DECIDIDO 569]` | Código de motivo | Estado de acesso revela situação financeira |
| D-11 | **Guarda é só leitura**, `stable`, sem escrita, sem log, sem auditoria. Sem cache entre requisições. `[DECIDIDO RN-H042-11, RN-H042-12]` | Cache por sessão | Mudança de estado precisa valer na próxima chamada (RF-050) |
| D-12 | **"Revogado" = `suspensa`.** Sem novo estado. A guarda só aceita `aprovada`. `[DECIDIDO 565]` | Estado `revogada` | Exigiria alterar H-039 |
| D-13 | **Estados de verificação negados nos dois modos**, inclusive `participacao`. Conta `bloqueado` e e-mail não verificado também. `[DECIDIDO 575]` | Participação só nega `suspensa` por segurança | Não há flag separado de restrição de segurança |

## 2. Visão geral

```
                          +--------------------------------------+
   rota / adaptador  ---> | private.professional_access_guard    | (único lugar com a regra)
   (modo, p_now)          |   1. professional_eligible(prof)     |  aprovada + ativo + e-mail verificado
                          |   2. modo participacao -> true       |
                          |   3. modo descoberta_aceite ->       |
                          |      commercial_access(prof, p_now)  |  estado em lista de permissão
                          +--------------------------------------+
                                  ^                 ^
   request_visibility_guard (fachada, #45/#46)      |
   request_detail_professional (#45) ---------------+
   discover_requests (#36, ganha p_now e a guarda) --+--> discover_scan (inalterada)
```

## 3. Função única `private.professional_access_guard`

```
private.professional_access_guard(p_professional_id uuid, p_mode text, p_now timestamptz) returns boolean
  language plpgsql  stable  security definer  set search_path = ''
```

Corpo (pseudocódigo normativo; o DEV escreve o SQL):

1. Se `p_professional_id`, `p_mode` ou `p_now` for nulo, ou `p_mode` não for um dos dois modos: `return false`.
2. Se `not private.professional_eligible(p_professional_id)`: `return false` (cobre `aprovada`, `app_user.status = 'ativo'`, `email_verified_at` não nulo).
3. Se `p_mode = 'participacao'`: `return true`.
4. Modo `descoberta_aceite`: `select estado into v_estado from private.commercial_access(p_professional_id, p_now)`; `return coalesce(v_estado in ('trial_ativo','ativa','cancelada_com_acesso_ate_fim_do_periodo','em_carencia'), false)`.
5. Todo o corpo dentro de um bloco `begin ... exception when others then return false; end`. Sem `raise` em nenhum caminho.

Matriz esperada (oráculo dos testes), para profissional `aprovada`, conta `ativo`, e-mail verificado:

| Estado de acesso | `descoberta_aceite` | `participacao` |
|---|---|---|
| `trial_ativo`, `ativa`, `cancelada_com_acesso_ate_fim_do_periodo`, `em_carencia` | permitido | permitido |
| `sem_acesso`, `trial_expirado`, `expirada` | negado | permitido |

Qualquer outra combinação (verificação diferente de `aprovada`, conta `bloqueado`, e-mail não verificado, profissional inexistente) = negado nos dois modos.

**Privilégios:** `revoke all ... from public, anon, authenticated, service_role, app_api, app_backup_reader; grant execute ... to app_system;` (padrão das funções de verificação). Nenhum grant em tabela.

**Custo:** uma chamada por requisição em `discover_requests` e `request_detail_professional` (não por linha). `[NÃO VERIFICADO]` O DEV mede com `explain analyze` uma chamada da guarda com 1.000 pedidos de fixture na descoberta e registra o tempo na Issue (risco R9 do refino).

## 4. Migração, reversão e aplicação

- **Migração:** `supabase/migrations/20261113400000_eligibility_expand_professional_access_guard.sql`
- **Reversão:** `supabase/rollbacks/20261113400000_eligibility_expand_professional_access_guard.down.sql`
- **Aplicação:** `npx supabase` no banco de desenvolvimento, nunca pelo MCP. Idempotente (`create or replace`, `drop function if exists`, `revoke/grant` repetíveis).

Conteúdo da migração, na ordem:

1. **Guarda de pré-requisito** (padrão da #36): `to_regprocedure` das quatro funções `private.professional_eligible(uuid)`, `private.commercial_access(uuid, timestamptz)`, `private.request_visibility_guard(uuid, timestamptz)`, `private.discover_scan(...)` (9 argumentos) e `private.discover_requests(uuid, integer, smallint, integer, uuid)`; falta qualquer uma = `raise exception 'guarda_pre_requisito_ausente'`.
2. **Criar** `private.professional_access_guard` (§3) e seus privilégios.
3. **Trocar o corpo** de `private.request_visibility_guard` por `create or replace` mantendo assinatura, atributos e retorno. Mantém o `raise 22023 visibilidade_parametro_invalido` para nulo (D-07) e delega. Reemite `revoke/grant` (só `app_system`).
4. **`private.discover_requests`:** `drop function if exists private.discover_requests(uuid, integer, smallint, integer, uuid)` e `create function private.discover_requests(p_professional_id uuid, p_limit integer default 50, p_after_group smallint default null, p_after_key integer default null, p_after_id uuid default null, p_now timestamptz default now())`, mesma tabela de retorno `(out_request_id, out_cursor_group, out_cursor_key)`, `stable security definer set search_path = ''`. Corpo: se `not private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)` então `return;` (vazio); senão o corpo atual, passando `p_now` como último argumento de `discover_scan`. Privilégios: só `app_system`.
5. **Não tocar:** `discover_scan`, `professional_eligible`, `commercial_access`, `request_detail_professional`, tabelas, dados, `cron`.
6. Comentário de cabeçalho citando decisões 563, 565 a 568, 571, 575, 577, 578 e esta Issue.

**Reversão (`.down.sql`):** (a) recria `request_visibility_guard` com o corpo exato de `20261113230000` (aprovada e conta ativa, sem e-mail e sem acesso); (b) remove `discover_requests` de 6 argumentos e recria a de 5 com o corpo de `20261113210000`, com grants só para `app_system`; (c) remove `professional_access_guard`. Não há dado a preservar, então a reversão não recusa. Idempotente.

## 5. Mapeamento de "revogado" e de estados de verificação

| Termo do requisito | Valor no modelo | Guarda |
|---|---|---|
| "aprovado" | `verification_status = 'aprovada'` | permitido (se o resto passar) |
| "revogado" (RF-050) | `suspensa` `[DECIDIDO 565]` | negado nos dois modos |
| "em análise", "pendente", "retido", "recusado" | `em_revisao`, `pendente`, `retida_duplicidade`, `recusada` | negado nos dois modos |
| valor futuro de `verification_status` | qualquer | negado por padrão (lista de permissão) |

Teste de catálogo: a lista de valores do CHECK de `verification_status` é lida de `pg_constraint` e cada valor diferente de `aprovada` deve ser negado (assim um valor novo exige decisão explícita).

## 6. Efeito sobre a #45, #46, #36 e #37

- **#45 (QA):** assinatura preservada; `request_detail_professional` passa a exigir e-mail verificado e acesso vigente. Testes da #45 que montam profissional elegível precisam de e-mail verificado e concessão de acesso (§9, T-15). Nenhuma migração da #45 é editada.
- **#46 (QA/entrega):** `contact_create_phone_consent` passa a usar a regra nova pela fachada, sem edição da migração `20261113250000`. Mesmo ajuste de fixture. `[PERGUNTA 642]`.
- **#36 (concluída):** `discover_scan` intacta. `discover_requests` muda de assinatura (6º parâmetro com default) e ganha a guarda; os testes de #36 que chamam a entrada com 5 argumentos precisam de profissional elegível ou de chamada direta a `discover_scan`.
- **#37 (H-024):** usa `professional_eligible`, que não muda (CA-H042-14).
- **H-044 (#57):** `[NÃO VERIFICADO]` se a ativação do trial usa `professional_eligible`; esta história não altera ativação.

## 7. Pontos de uso na API (contrato; sem implementar rotas da parte B)

A guarda é **chamada sempre no banco**, dentro da função de leitura ou da transação; a API nunca decide a regra. A API passa o instante do servidor (`p_now`, uma vez por requisição) e o modo.

| Ponto | Modo | Onde roda | Resposta quando `false` | Parte |
|---|---|---|---|---|
| `GET /v1/pro/requests/:id` (#45, já existe) | `descoberta_aceite` | dentro de `request_detail_professional` (via fachada) | zero linhas, 404 uniforme `pedido_nao_encontrado` (igual a pedido inexistente, byte a byte) | A (só teste) |
| `discover_requests` (entrada de H-055) | `descoberta_aceite` | início da função (D-08) | zero linhas, igual a profissional sem pedido no raio | A |
| Rota de descoberta `GET /v1/pro/discovery/requests` (#68) | `descoberta_aceite` | chama `discover_requests(..., p_now)` | lista vazia, mesmo corpo de "sem pedidos" | B |
| URL de foto (#69) | `descoberta_aceite` | `select private.professional_access_guard($1,'descoberta_aceite',$2)` antes de gerar a URL | mesma resposta de foto inexistente | B |
| Aceite (#71) | `descoberta_aceite` | na transação do aceite, **depois** de travar a linha do pedido (`for update`) e da trava do perfil, em instrução nova (a guarda `stable` enxerga o estado já confirmado de outras transações); `false` = `rollback` e resposta uniforme | corpo único `indisponivel` (código HTTP a definir em #71, `[PERGUNTA 645]`); nenhuma linha criada | B |
| Seleção pelo cliente (#84) | `participacao` | antes de efetivar | recusa uniforme | fora de H-042 (só o modo existe) |

Distinção que a rota deve respeitar (CA-H042-10): **guarda `false` ou erro interno da guarda = negação uniforme** (404 ou lista vazia); **falha de conexão ou do pool = 503 fixo `indisponivel`** como já faz a #45. Nenhuma das duas devolve texto do banco, estado ou data. Os logs não registram `id` de profissional junto de `id` de pedido nem o estado de acesso.

## 8. Domínio e adaptador (nomes de arquivo; barris só listados)

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Domínio (**novo**) | `packages/domain/src/eligibility/professional-access.ts` | `MODOS_GUARDA = ['descoberta_aceite','participacao'] as const`, tipo `ModoGuarda`, porta `ProfessionalAccessPort { allowed(professionalId: string, mode: ModoGuarda, at: Date): Promise<boolean> }`, função `profissionalPermitido(port, clock, professionalId, mode): Promise<boolean>` que usa `clock.now()` uma vez e **converte qualquer rejeição da porta em `false`** (fail closed). **Sem** lista de estados e **sem** condição de verificação (D-09) |
| Domínio (barril, só listar) | `packages/domain/src/eligibility/index.ts`, `packages/domain/src/index.ts` | reexportar |
| Adaptador Pg (**novo**) | `packages/db/src/professional-access.ts` | `createPgProfessionalAccess(client: SqlClient): ProfessionalAccessPort`; SQL em constante, parâmetros posicionais: `select private.professional_access_guard($1::uuid, $2::text, $3::timestamptz) as ok`; só `ok === true` vira `true`; qualquer outra coisa ou exceção vira `false`; sem repassar mensagem do banco |
| Barril db (só listar) | `packages/db/src/index.ts` | reexportar `professional-access` |
| Adaptadores existentes (alterados) | `packages/db/src/discovery-requests.ts` | passa `p_now` (um instante por requisição) para `discover_requests`; chamada com 6 argumentos |
| Adaptadores existentes (sem alteração) | `packages/db/src/request-visibility.ts`, `commercial-access.ts` | nada muda; o detalhe já passa `nowMs` |
| API | nenhum arquivo novo nesta parte | as rotas de #68, #69 e #71 usam a porta (§7). Se #45 precisar de ajuste de composição por causa de `p_now`, fica dentro de `apps/api/src/requests/detail-service.ts` (já existente, `[NÃO VERIFICADO]`) |

## 9. Plano de testes (locais, sintéticos, marcador `H042`)

Evidência: comando, contagem e código de saída de `corepack pnpm db:test` e `corepack pnpm check:all`, registrados na Issue. Sem CI, sem rede externa.

**Arquivos novos:**
- `packages/db/tests/professional-access-guard.dbtest.mjs` (Postgres real; T-01 a T-12, T-14, T-16, T-17)
- `packages/db/tests/professional-access-guard-paridade.dbtest.mjs` (paridade; T-13, T-15)
- `packages/db/tests/professional-access-guard-migration.test.mjs` (estático; T-18, T-19)
- `packages/domain/tests/eligibility-professional-access.test.ts` (T-20)
- `packages/db/tests/professional-access-adapter.test.mjs` (adaptador com cliente falso; T-20)

Fixtures: um auxiliar único cria profissional com `verification_status`, `app_user.status`, `email_verified_at` e concessão (`billing.access_grant`) por parâmetro; `p_now` é sempre explícito.

| # | Teste | CA |
|---|---|---|
| T-01 | Catálogo: existe **uma** `professional_access_guard(uuid,text,timestamptz)`; `stable`, `security definer`, `search_path=''`; saída `boolean`; execução só `app_system`; nenhuma outra função em `pg_proc` de `private` contém `verification_status ... 'aprovada'` além de `professional_eligible` e das funções de H-039/H-016 já existentes (lista-base capturada pelo DEV antes de migrar); `request_visibility_guard`, `discover_requests` e `request_detail_professional` **não** contêm a condição | CA-01 |
| T-02 | Corpo da fachada: `prosrc` de `request_visibility_guard` contém `professional_access_guard` e `'descoberta_aceite'` e não contém `verification_status`; `discover_requests` e `request_detail_professional` não repetem a condição | CA-01 |
| T-03 | Verificação: 6 linhas (`pendente`, `em_revisao`, `retida_duplicidade`, `recusada`, `suspensa`, `aprovada`) com acesso `ativa`, conta ativa, e-mail verificado: só `aprovada` permitida, nos dois modos. Valores lidos de `pg_constraint` (valor novo falha o teste por exigir decisão) | CA-02 |
| T-04 | Conta `bloqueado` com os demais requisitos: negado nos dois modos | CA-03 |
| T-05 | E-mail não verificado com os demais requisitos: negado nos dois modos | CA-04 |
| T-06 | Sete fixtures de acesso, `p_now` explícito, modo `descoberta_aceite`: matriz de §3 (4 permitidos, 3 negados). Inclui fronteiras: `ends_at - 1 µs` permitido; `ends_at` negado (trial e pago); carência em `ends_at + 72 h - 1 µs` permitido e em `+ 72 h` negado | CA-05 |
| T-07 | Descoberta sem vazamento: profissional negado (suspenso, sem acesso, sem e-mail) com pedidos que casariam: `discover_requests` devolve zero linhas, **idêntico** (estrutura e contagem) a profissional elegível sem pedido no raio | CA-07 |
| T-08 | Detalhe uniforme: para profissional negado e pedido existente que casaria, `request_detail_professional` devolve zero linhas, igual ao resultado para uuid inexistente | CA-08 |
| T-09 | Fail closed: (a) `p_mode` nulo, `''`, `'DESCOBERTA_ACEITE'` e `'x'`; `p_professional_id` e `p_now` nulos: `false`, sem exceção; (b) dentro de transação com `rollback`: `alter function private.commercial_access ... rename` e chamar a guarda em `descoberta_aceite` = `false` (função ausente), e em `participacao` = `true` (não usa acesso); (c) idem renomeando `professional_eligible`: `false` nos dois; (d) profissional inexistente: `false`. Nenhuma mensagem do banco chega ao chamador | CA-10 |
| T-10 | Instante único: duas chamadas com o mesmo `p_now` dão o mesmo resultado; com `p_now` antes e depois de `ends_at` do trial o resultado muda; a guarda não chama `now()` (`prosrc` sem `now()`/`clock_timestamp()`); `discover_requests` com `p_now` fixo reproduz o resultado em chamadas repetidas | CA-11 |
| T-11 | Participação: aprovado, ativo, e-mail verificado e acesso `expirada` (e `sem_acesso`, `trial_expirado`): `participacao` permitido e `descoberta_aceite` negado; com `pendente` e com `suspensa`: `participacao` negado | CA-12 |
| T-12 | Resposta mínima: `pg_get_function_result` da guarda é `boolean`; varredura de qualquer saída de negação: sem estado, data, valor, identificador de pagamento | CA-15 |
| T-13 | **Paridade com a #45 (T-20 de 127):** matriz completa (6 verificações × conta × e-mail × 7 acessos): `request_visibility_guard(p, now)` = `professional_access_guard(p,'descoberta_aceite',now)` em todas as linhas; para 30 pedidos de fixture (dentro/fora do raio, online, regulamentado, fechado, `selecionado`) o conjunto de `request_detail_professional` com linha é igual ao de `discover_requests`, para profissional elegível; para profissional negado ambos vazios | CA-01, CA-07, CA-08 |
| T-14 | **Paridade com a #36:** para profissional elegível, a lista de `discover_requests(prof, limit, cursores, p_now)` é **idêntica** (mesmos ids, mesma ordem, mesmos cursores, nas páginas 1 a N) à de `discover_scan(prof, lon, lat, raio, limit, cursores, p_now)` com o mesmo `p_now`; para profissional negado, `discover_scan` continua devolvendo as linhas (prova que a guarda é a única diferença e que `discover_scan` não mudou); `md5(prosrc)` de `discover_scan` igual ao valor registrado antes da migração | CA-14 |
| T-15 | Regressão dos consumidores: testes de banco de #45, #46, #36, #37, H-016 e H-045 rodam; `db:test` antes e depois com contagem registrada; os ajustes de fixture de #45 e #46 (e-mail verificado, concessão de acesso) são **somente nos arquivos de teste**, via auxiliar único; nenhuma migração antiga editada (`git diff --stat supabase/migrations` só acrescenta arquivos) | CA-14 |
| T-16 | `professional_eligible`, `commercial_access` e `discover_scan`: `md5(prosrc)` e assinatura iguais às registradas antes da migração | CA-14 |
| T-17 | Chamada com papel errado: `app_api`, `anon`, `authenticated` e `service_role` não executam a guarda nem `discover_requests`; `app_system` executa | CA-01 |
| T-18 | Migração: aplicar duas vezes (idempotência); prefixo `20261113400000` maior que o último existente; reversão aplicada restaura a fachada antiga (aprovada e ativo, sem e-mail) e a `discover_requests` de 5 argumentos, e reaplicar a migração volta ao estado novo; reversão idempotente | CA-17 |
| T-19 | Estático: nomes dos arquivos, `revoke/grant` só para `app_system`, ausência de `now()` na guarda, ausência de `raise exception` na guarda, a migração não altera tabelas nem dados | CA-17 |
| T-20 | Domínio e adaptador: `profissionalPermitido` chama `clock.now()` uma vez; porta que rejeita = `false`; modo fora da lista não chega a consultar (tipo restrito + guarda em runtime = `false`); adaptador usa parâmetros posicionais, só `ok === true` vira `true`, erro vira `false`, mensagem do banco não aparece; o domínio **não contém** a string de nenhum estado de acesso nem `aprovada` | CA-01, CA-10 |

**Testes da parte B (pendentes, não simulados):** CA-06 (chamada direta, T-04 do backlog), CA-09 (foto), CA-13 (reavaliação com trava e dois clientes), CA-16 (auditoria de negação de aceite). Ficam registrados na Issue como pendentes de #68, #69 e #71. O desenho do ponto de uso do aceite (§7) é o contrato que esses testes vão exercitar.

## 10. Segurança e privacidade

1. **Anti-enumeração:** negado e inexistente produzem a mesma resposta (D-10, T-07, T-08). A guarda não distingue "não aprovado" de "sem acesso".
2. **Fail closed:** não há caminho em que erro vire permissão (D-03, T-09). Lista de permissão de estados (D-04).
3. **Sem privilégio novo para a API:** só `app_system` executa a guarda e a descoberta; `app_api` não ganha execução (T-17). Funções `security definer` com `search_path = ''` e nomes totalmente qualificados.
4. **Privacidade financeira:** a guarda nunca devolve o estado de acesso (R6 do refino, decisão 569).
5. **Sem cache** e sem estado (D-11). Efeito imediato de suspensão e de expiração na chamada seguinte.
6. **Corrida (parte B):** a guarda é lida depois de travar o pedido, em instrução nova, no aceite. Descoberta anterior não vale como prova de elegibilidade (RN-H042-08).
7. **Dívida:** auditoria da negação de aceite (decisão 570) é da parte B. A parte A não escreve em auditoria.
8. **Sem serviço externo:** nada chama Mapbox, e-mail ou pagamento.

## 11. Ordem de execução

1. **Arquitetura (este documento).** O líder responde 640 a 645 e registra em `11-DECISOES.md`.
2. **Desenvolvimento (parte A), uma Issue só, em sequência:**
   a. `ls supabase/migrations | tail -3`; capturar a base de testes (`db:test` com contagem) e os `md5(prosrc)` de `discover_scan`, `professional_eligible` e `commercial_access`, e a lista-base de funções com `verification_status` (T-01).
   b. Domínio e porta (`eligibility/professional-access.ts` e T-20).
   c. Migração e reversão (§4), aplicar com `npx supabase` no banco de desenvolvimento.
   d. Adaptador `professional-access.ts` e ajuste de `discovery-requests.ts`.
   e. Auxiliar único de fixture e ajuste dos testes de #45 e #46 (só arquivos de teste, T-15).
   f. Testes de banco T-01 a T-19; medir custo (§3).
   g. `corepack pnpm check:all` e `db:test`; contagem e código de saída na Issue.
3. **Code Review e QA** reexecutam T-13, T-14, T-15 e T-16.
4. **Parte B** fica pendente de #68, #69 e #71; nenhuma delas começa antes de a parte A estar entregue.

## 12. Riscos

- **R-01 Quebra de fixtures da #45 e #46** por regra mais estrita (§0.1). Mitigação: auxiliar único e ajuste só em testes; T-15.
- **R-02 Mudança de assinatura de `discover_requests`.** Mitigação: default em `p_now`, `drop` da antiga na mesma migração, T-14 e T-18.
- **R-03 `when others` esconde defeito real.** Mitigação: T-09 prova os casos esperados; o DEV não registra o erro (nada de log com dado) mas os testes de contagem pegam regressão que vire `false` em massa (T-03, T-06 e T-11 com permitidos).
- **R-04 Divergência futura entre guarda e consumidores.** Mitigação: T-01, T-02 e T-13 (paridade).
- **R-05 Custo por chamada.** Uma chamada por requisição; medir (§3).
- **R-06 Conflito de prefixo de migração** com #47 e outras. DEV reconfere; renomeia migração e reversão juntas.
- **R-07 Parte B sem alvo de prova.** CA-06, 09, 13, 16 pendentes e declarados (decisão 579).

## 13. Perguntas ao líder (numeração contínua a partir de 640)

**640. Parâmetro `p_now` da guarda.**
- (a) Obrigatório, sem default (recomendado).
- (b) `default now()`.
- **Recomendação:** (a). Evita instante diferente do usado em `commercial_access`. Destrava D-05 e T-10.

**641. Forma da mudança em `discover_requests`.**
- (a) Mesmo nome, 6º parâmetro `p_now` com default, remoção da versão de 5 argumentos na mesma migração (recomendado).
- (b) Manter a de 5 argumentos e criar nome novo `discover_requests_guarded`.
- **Recomendação:** (a). Segue a decisão 567 (guarda dentro de `discover_requests`) sem deixar uma entrada sem guarda. Destrava §4 passo 4 e T-14.

**642. Fixtures de #45 e #46 mais estritos.** A nova regra exige e-mail verificado e acesso vigente; os testes das duas Issues em QA/entrega precisam desses dados.
- (a) Ajustar só os arquivos de teste, por um auxiliar único, sem editar migrações nem devolver cartões de coluna (recomendado).
- (b) Devolver #45 e #46 a Desenvolvimento.
- **Recomendação:** (a). Nenhum comportamento delas muda além da regra decidida em 566. Destrava T-15 e a ordem de entrega.

**643. Parâmetro nulo na fachada `request_visibility_guard`.**
- (a) Manter o `raise 22023` atual na fachada; a guarda nova devolve `false` (recomendado).
- (b) Fachada também devolve `false`.
- **Recomendação:** (a). Não altera testes existentes. Destrava D-07.

**644. Futuro da fachada.**
- (a) Manter `request_visibility_guard` como fachada até H-055 e decidir a remoção depois; consumidores novos chamam `professional_access_guard` direto (recomendado).
- (b) Planejar a remoção ainda nesta história.
- **Recomendação:** (a). Remover agora quebraria a #46. Destrava §6.

**645. Resposta uniforme de negação de aceite (contrato para #71).**
- (a) Mesmo corpo `{ "code": "indisponivel" }` para negado, pedido fechado e pedido inexistente, com o status HTTP definido pela #71 (recomendado).
- (b) Código próprio de "acesso vencido".
- **Recomendação:** (a). Decisão 569; o estado de acesso é financeiro. Destrava o contrato de §7 e CA-H042-06.

**Ciência sem decisão:** (i) a guarda não verifica a existência do pedido; só o profissional; (ii) a lista de estados permitidos fica só no banco e nos testes (D-09); (iii) a parte A não escreve auditoria.
