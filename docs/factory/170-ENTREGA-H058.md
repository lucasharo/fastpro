# Entrega H-058 — Aceitar trabalho idempotente (Issue #71)

EXEC-ID: EXEC-DEV4-71-20261120 | Workflow: WF-03 | Etapa: Desenvolvimento (continuação 4) | Branch: feature/init
Desenho: `162-DESENHO-H058.md` (§8, fatias 1 a 6). Testes de banco executados no banco de desenvolvimento (DEV).

## 1. Fatias e commits

| Fatia | Conteúdo | Commit(s) |
|---|---|---|
| 1. Domínio | corpo, chave, hash, mapa HTTP e envelope | a7b9174 |
| 2. Tabelas | `app.acceptance`, `app.conversation`, `app.message`, gatilhos, privilégios | ad6b60e |
| 3. Funções | `private.acceptance_create`, `acceptance_read`, guarda real do aceite ativo | b9ff30a |
| 4. Adaptador | transação única, idempotência, rate limit 20/min | ed8a672 |
| 5. Serviço e rota | serviço, rota, cabeçalhos; ligação no app | 0237619, 75f80a1 |
| 6. Concorrência e fechamento | teste de concorrência real no DEV; chave do rate limit sem prefixo; revisão | a74da8b |

Migrações: `20261120100000` e `20261120310000` (aplicadas no DEV, `corepack pnpm db:status`: 106 aplicadas, 0 pendentes). Nenhuma migração nova nesta continuação. A condicional `20261120120000` não foi criada (ver pendência P5).

## 2. Testes executados nesta continuação

| Comando | Resultado |
|---|---|
| `corepack pnpm --filter @fastpro/domain build` e `--filter @fastpro/db build` | saída 0 |
| `corepack pnpm --filter @fastpro/db typecheck` | saída 0 |
| `corepack pnpm --filter @fastpro/db exec eslint` nos arquivos `acceptance*` (src e tests) | saída 0 |
| `corepack pnpm --filter @fastpro/db exec vitest run tests/acceptance-adapter.test.ts` | 12 de 12 |
| `node --test --test-concurrency=1 packages/db/tests/acceptance-concorrencia.dbtest.mjs` | tests 6, pass 6, fail 0 (T-H058-30, 31, 11, 08, 35, 34-banco) |
| `node --test --test-concurrency=1 packages/db/tests/acceptance-funcoes.dbtest.mjs packages/db/tests/acceptance-tabelas.dbtest.mjs` | tests 27, pass 27, fail 0 |
| `node --test --test-concurrency=1 packages/db/tests/contact-h033.dbtest.mjs` (suíte da #46, R-09) | tests 16, pass 16, fail 0 |
| `node --test --test-concurrency=1 packages/db/tests/contact-h033-concorrencia.dbtest.mjs` (#46) | tests 3, pass 3, fail 0 |
| `node --test --test-concurrency=1 packages/db/tests/discovery-h055-integracao.dbtest.mjs packages/db/tests/geo-discovery-requests.dbtest.mjs` (vizinhos #68) | tests 15, pass 15, fail 0 |
| `corepack pnpm --filter @fastpro/db exec vitest run discovery acceptance` | 6 arquivos, 41 testes, todos passam |
| `corepack pnpm --filter ./apps/api exec vitest run acceptance discovery` | 4 arquivos, 69 testes, todos passam |

Verificação do R-09: a função viva `private.request_acceptance_active(uuid,uuid)` é a real (`exists (... status = 'ativo')`, `security definer`). A suíte da #46 redefine a função só dentro de savepoint e desfaz no `rollback` final, então o DEV não ficou com o stub.

Não executados (fora de escopo desta continuação): `check:all` e `db:test` completo.

## 3. Pendências

**P1. Ligação da rota ainda incompleta (bloqueia uso real).** `apps/api/src/app.ts` já despacha `requestAcceptance`. Mas a montagem não a fornece: `apps/api/src/composicao.ts` (que monta `integracoes`, hoje só com `requestDiscovery`) e `apps/api/src/vercel.ts` (que repassa `integracoes.*`) não incluem `requestAcceptance`. Sem isso, `POST /v1/requests/:id/acceptances` responde 404 uniforme. `vercel.ts` não foi tocado (proibido para esta execução). `composicao.ts` também não foi alterado, por ser compartilhado com a #68; depende de decisão do líder (ver pergunta 2).

**P2. Dados sintéticos `h058-` comitados no DEV, sem limpeza.** O teste de concorrência real exige `COMMIT` em cada conexão, então não roda dentro de transação. A limpeza não é possível pelo caminho normal: `app.acceptance`, `app.conversation` e `app.message` negam `DELETE` por gatilho (`acceptance_nega_delete`, `conversation_nega_delete`, `message_imutavel_delete`) e os FKs são `on delete restrict`. Contagem atual de linhas com marca `h058-` no DEV (inclui execuções anteriores desta história): 115 usuários, 15 pedidos, 43 aceites, 43 conversas, 43 mensagens. Não houve contorno do gatilho. Ver pergunta 1.

**P3. Divergência do desenho no rate limit.** `162-DESENHO-H058.md` (§3.4 e §8, fatia 4) prevê a chave `accept:` como prefixo. Foi trocada por HMAC puro de 64 hex, com rótulo HKDF próprio na composição (`RATE_INFO`), porque `ops.rate_counter.key_hmac` exige 64 hex. Domínio separado da descoberta, sem prefixo. O desenho ainda cita o prefixo; registrar a correção no desenho na próxima revisão.

**P4. Lint do pacote `@fastpro/db` falha por arquivos alheios.** `eslint .` retorna 27 erros `no-undef` (ex.: `Buffer`, `setTimeout`) em `retention-h109.dbtest.mjs`, `trial-activation-concorrencia.dbtest.mjs`, `verification-case.dbtest.mjs` e outros. Nenhum arquivo do H-058 aparece nessa lista. Não corrigido aqui (fora do escopo desta história).

**P5. Migração condicional não criada.** O passo 0 da fatia 3 confirmou que `private.request_detail_professional(uuid,uuid,timestamptz)` já aplica a guarda `descoberta_aceite` e o casamento serviço/raio. Por isso `private.request_matches_professional` (`20261120120000`) não foi necessária (A-4 resolvido).

**P6. Contador na resposta (já registrado como R-12).** CA-H058-05 pede `acceptances_count` na resposta; o desenho decidiu não devolver, por silêncio de vagas. Vetável pelo líder.

**P7. Arquivos de desenho sem commit.** `162-DESENHO-H058.md` e `158-REFINO-H058.md` continuam não versionados (`??`). Não foram incluídos no commit desta etapa.

## 4. Pode ir a Code Review?

Sim, para o código das fatias 1 a 6 e para o adaptador, serviço e rota: testes locais verdes nos níveis listados acima. A história só entrega valor após a P1 (ligação em `composicao.ts` e `vercel.ts`). Recomendação: o líder decide se a ligação entra nesta Issue antes do Code Review.

## 5. Perguntas (para o líder e o dono)

1. **Dados de teste no banco de desenvolvimento (P2).** O que é: os registros de exemplo (com a marca `h058-`) que o teste de concorrência gravou de verdade no banco de desenvolvimento, porque o teste precisa de gravações reais em paralelo. Por que importa: não é possível apagá-los sem desligar as proteções de exclusão do banco, o que é uma operação destrutiva. Opções: (a) manter como dados sintéticos de DEV, identificados pela marca, e registrar (**recomendado**); (b) apagar com desativação temporária das proteções, com autorização explícita; (c) deixar de rodar o teste de concorrência real. Destrava: a Issue #71 pode ir a Code Review sem essa decisão, mas o registro fica como pendência.
2. **Ligação da rota (P1).** O que é: a peça de montagem que entrega a rota de aceite ao servidor. Por que importa: sem ela, o endpoint de aceite responde 404 para o usuário. Opções: (a) ligar em `composicao.ts` e pedir a `vercel.ts` (**recomendado**, antes do Code Review); (b) deixar para outra Issue de integração; (c) ligar somente em `composicao.ts` e tratar `vercel.ts` depois. Destrava: a história passa a funcionar de ponta a ponta.
