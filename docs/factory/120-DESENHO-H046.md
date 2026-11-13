# Desenho técnico H-046 — Planos e preços em centavos (Issue #59)

- **Issue:** #59 `[E5] Planos e preços em centavos` · **História:** H-046 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco ou quadro foi alterado nesta etapa.
- **Entradas lidas:** `115-REFINO-H046.md` (CA-H046-01 a 14, RN-H046-01 a 08, perguntas 290 a 299), `11-DECISOES.md` Rodada 64 (decisões 290 a 299 adotadas como recomendadas; 298 aberta), Rodadas 65 a 68 (lições de teste), `114-DESENHO-H045.md` (padrão de cobrança), listagem de `supabase/migrations` e de `packages/db/src`.
- **Etiquetas:** `[DECIDIDO n]` · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere · `[AMBIGUIDADE]` lacuna.
- **Limites:** não li o texto da Issue no GitHub, não li o papel `roles/factory-software-architect.md` (orçamento de turnos), não li o SQL da migração de H-045 (usei o `114`), não rodei banco.

## 1. Decisões fixadas e fatos verificados

| Dec. | Efeito neste desenho |
|---|---|
| 290 | Desenvolvimento pode começar: a #58 está concluída (informado pelo líder). Sem tocar em `access_grant`/`subscription`. |
| 291 | H-046 cria `plan` e `plan_price`. `subscription.plan_id` entra em H-047. |
| 292 | Nenhum campo, tabela ou função de promoção. Troca de preço = nova linha de vigência. |
| 293 | Preço gravado no pagamento (H-047); período já pago não muda. Prazo de aviso ao cliente é decisão do dono (fora do banco). |
| 294 | Um preço vigente por plano: restrição de exclusão `btree_gist`. |
| 295 | Carga por migração de dados de referência, idempotente. |
| 296 | Sem tabela ou coluna de benefício. |
| 297 | A tela é de H-047. H-046 entrega a leitura e a função pura de formatação (CA-13 entra). |
| 298 | Aberta para o dono. Não bloqueia: o runner do repositório (`db:migrate`) segue em uso. O DEV confere o projeto vinculado antes de aplicar. |
| 299 | H-046 não espera S-03. |

Fatos `[VERIFICADO]`:
- A última migração é `20261113180000_ops_remove_media_access_history.sql` (da #150). H-045 usou `20261113170000_billing_create_access_grant.sql`. O prefixo de H-046 deve ser maior que `20261113180000`.
- `packages/domain/src/billing/` e `packages/db/src/commercial-access.ts` já existem (H-045). `btree_gist` está no baseline (visto no `114`).
- Nenhuma migração contém o texto "promo" nem cria tabela `plan`. O risco R6 do refino (estrutura herdada da #116) fica resolvido: a #116 é catálogo de serviços, sem promoção de preço. O DEV repete a busca antes de gravar.
- Rodada 65: a lista fechada de funções executáveis por `app_api` no teste `audit` (D-02b) quebrou quando a #58 acrescentou `commercial_access`. Lição incorporada na §8 (T-13).

## 2. Modelo de dados

### 2.1 Migração e rollback (nomes)

- **Migração:** `supabase/migrations/20261113190000_billing_create_plan_pricing.sql` (prefixo maior que `20261113180000`; o DEV confere com `ls supabase/migrations` e usa o próximo livre se outra Issue gravar antes). Idempotente (`if not exists`, `create or replace`, carga com `on conflict`/`not exists`). Expansão pura: só tabelas, gatilhos e funções novas. Nenhuma alteração em tabela existente. Nenhum `cron`, job, relógio do banco ou evento.
- **Rollback:** `supabase/rollbacks/20261113190000_billing_create_plan_pricing.down.sql`: `drop function` (a função de leitura e as 2 de gatilho), `drop table billing.plan_price`, `drop table billing.plan`. Sem `cascade`: se H-047 já tiver FK para `plan_price`, o rollback falha de propósito. Cabeçalho avisa: os dados de referência voltam com a migração, mas qualquer linha de preço criada depois (troca de preço) se perde; exportar antes.
- Aplicação: executor conforme a decisão 298 (hoje `db:migrate`, ou `npx supabase` quando a 157 for resolvida). O DEV confere o projeto vinculado antes de aplicar `[NÃO VERIFICADO]`.

### 2.2 `billing.plan`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` pk `default gen_random_uuid()` | |
| `code` | `text not null unique` | |
| `months` | `integer not null unique` | |
| `created_at` | `timestamptz not null default clock_timestamp()` | |

CHECK `plan_code_months`: `(code, months) in (('mensal',1),('trimestral',3),('semestral',6),('anual',12))` (CA-01; amarra código e duração). **Sem coluna `active`** `[PROPOSTA]`: o catálogo do MVP tem quatro planos fixos; aposentar um plano é trocar a vigência do preço (sem preço vigente, a função não devolve o plano). Pergunta 343. Sem coluna de benefício, limite, desconto ou promoção (CA-04, CA-05).

### 2.3 `billing.plan_price`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` pk `default gen_random_uuid()` | identificador gravado no pagamento por H-047 |
| `plan_id` | `uuid not null` | FK `billing.plan (id)` `on delete restrict` |
| `amount_cents` | `integer not null` | `check (amount_cents > 0)` |
| `currency` | `text not null default 'BRL'` | `check (currency = 'BRL')` |
| `valid_from` | `timestamptz not null` | |
| `valid_to` | `timestamptz` | nulo = vigente; `check (valid_to is null or valid_to > valid_from)` |
| `created_at` | `timestamptz not null default clock_timestamp()` | |

Restrição de vigência (CA-07, dec. 294), intervalo semiaberto, igual ao padrão de H-045:

```sql
alter table billing.plan_price
  add constraint plan_price_sem_sobreposicao
  exclude using gist (plan_id with =, tstzrange(valid_from, valid_to, '[)') with &&);
```

`valid_to` nulo vira limite superior aberto no `tstzrange`. Intervalos encostados (`valid_to` de um = `valid_from` do seguinte) não colidem. Plano B igual ao `114` §3.4 (gatilho com `pg_advisory_xact_lock`) se a criação falhar no DEV; o DEV registra a variante no cabeçalho `[NÃO VERIFICADO]`. Índice de consulta: `plan_price_vigencia_idx (plan_id, valid_from desc) include (valid_to, amount_cents)`.

**Tipo inteiro e fracionário (atenção ao DEV).** Em PostgreSQL, `insert ... values (29.90)` num `integer` não falha: o literal `numeric` é arredondado por conversão de atribuição (vira 30). Por isso a recusa de fracionário se prova por **parâmetro de texto** (`'29.90'` → erro `22P02`), que é o caminho real do adaptador, e no domínio (`Number.isSafeInteger`). Não trocar por `numeric` para "recusar" literal. Pergunta 344.

### 2.4 Imutabilidade (CA-08)

- `private.billing_plan_guard()` (`security invoker`, `search_path = ''`): `BEFORE UPDATE`, `BEFORE DELETE` e `BEFORE TRUNCATE` em `billing.plan` recusam sempre (`plan_imutavel`). Sem `active`, `plan` é imutável por inteiro.
- `private.billing_plan_price_guard()`: `BEFORE UPDATE` aceita só a transição `valid_to` de nulo para um instante `> valid_from` (fechar a vigência, uma vez); qualquer mudança em outra coluna, ou em `valid_to` já preenchido, é recusada (`plan_price_imutavel`, `plan_price_fechamento_invalido`). `BEFORE DELETE` e `TRUNCATE` recusam (`plan_price_sem_delete`). `valid_to` futuro é aceito (troca agendada): fecha-se a linha e insere-se a nova com `valid_from` igual.
- Troca de preço (fora de H-046, documentada): `UPDATE valid_to = T` na linha vigente e `INSERT` com `valid_from = T`, na mesma transação.

### 2.5 RLS e privilégios (CA-11)

- `enable` e `force row level security` nas duas tabelas, **sem política** (negação por padrão, como em H-045).
- `revoke all on billing.plan, billing.plan_price from public, anon, authenticated, service_role, app_api;`
- `grant select on billing.plan, billing.plan_price to app_system;` e **nenhuma escrita** para papel de aplicação (a carga roda como dono da migração; escritor administrativo virá com RF-153).
- Função: `revoke all ... from public, anon, authenticated, service_role; grant execute on function private.plan_price_at(timestamptz, text) to app_api, app_system;` (mesmo critério da decisão 279: a API lê em nome do principal sem passar por `app_system`). Pergunta 345.
- Funções de gatilho: sem `execute` para ninguém além do dono. `[NÃO VERIFICADO]` O DEV confere se `app_system` já tem `usage` no esquema `billing` (vindo de H-045); senão a migração concede.

### 2.6 Carga de referência idempotente (CA-03, CA-10, dec. 295)

No fim da mesma migração, como dados de referência (não é carga de demonstração, vale em qualquer ambiente):

```sql
insert into billing.plan (code, months) values
  ('mensal',1),('trimestral',3),('semestral',6),('anual',12)
on conflict (code) do nothing;

insert into billing.plan_price (plan_id, amount_cents, currency, valid_from)
select p.id, v.cents, 'BRL', timestamptz '2026-01-01 00:00:00+00'
  from billing.plan p
  join (values ('mensal',2990),('trimestral',8070),('semestral',14940),('anual',23880)) as v(code, cents)
    on v.code = p.code
 where not exists (select 1 from billing.plan_price x where x.plan_id = p.id);
```

O `not exists` usa "o plano não tem nenhum preço" (não "não tem este preço"): depois de uma troca de preço, reaplicar a migração não recria o valor antigo. `valid_from` é constante (não `now()`), logo determinístico e idêntico em todo ambiente. Pergunta 346.

## 3. Função de leitura (CA-03, 06, 09, 12)

```sql
create or replace function private.plan_price_at(p_at timestamptz, p_plan_code text default null)
returns table (plan_code text, months integer, plan_price_id uuid, amount_cents integer, currency text)
language sql stable security definer set search_path = ''
as $$
  select p.code, p.months, pp.id, pp.amount_cents, pp.currency
    from billing.plan p
    join billing.plan_price pp on pp.plan_id = p.id
   where pp.valid_from <= p_at
     and (pp.valid_to is null or p_at < pp.valid_to)
     and (p_plan_code is null or p.code = p_plan_code)
   order by p.months;
$$;
```

- `p_at` sem `default` e corpo sem `now()`, `clock_timestamp()` ou `current_timestamp` (relógio injetado). `p_plan_code` nulo devolve os quatro planos (a tela de H-047 usa uma chamada); código informado devolve um (o checkout). Pergunta 348.
- `STABLE`, sem efeito colateral. Fronteira `[valid_from, valid_to)`: em `T` exato vale o preço novo; em `T − 1 s`, o antigo (CA-06).
- Instante sem preço vigente (antes da carga, ou após fechar sem substituto) devolve zero linhas; o adaptador converte em erro `preco_indisponivel`, nunca em valor padrão. `p_at` nulo devolve zero linhas.
- Devolve `plan_price_id` e `amount_cents` juntos: H-047 grava os dois no pagamento (RN-H046-06). A igualdade "exibido = cobrado" é provada em H-047 (CA-12 parcial).
- `commercial_access` (H-045) não lê estas tabelas (RN-H046-07).

## 4. Domínio e adaptador (nomes de arquivo)

**`packages/domain/src/billing/`** (puro, sem I/O):
- `plans.ts`: `PLAN_CODES` (`as const`: mensal, trimestral, semestral, anual), tipo `PlanCode`, `PlanPrice = { planCode; months; planPriceId; amountCents; currency: 'BRL' }`, porta `PlanPricingPort { listAt(at: Date): Promise<PlanPrice[]>; getAt(code: PlanCode, at: Date): Promise<PlanPrice> }`, classe `PlanPricingError` (códigos fixos `preco_indisponivel`, `preco_invalido`, `precos_indisponivel`), e as funções `listarPrecosVigentes(port, clock)` e `lerPrecoVigente(port, clock, code)` que injetam `clock.now()` (reaproveita a porta `Clock` já criada em `commercial-access.ts`; não duplicar).
- `money.ts`: `formatarCentavosBRL(cents: number): string`. Implementação manual (sem `Intl`, para não depender de ICU nem do espaço não separável): valida `Number.isSafeInteger` e `>= 0` (senão `PlanPricingError('preco_invalido')`); parte inteira com separador de milhar `.`, vírgula decimal, espaço comum: 2990 → `R$ 29,90`; 8070 → `R$ 80,70`; 14940 → `R$ 149,40`; 23880 → `R$ 238,80`; 123456 → `R$ 1.234,56`; 5 → `R$ 0,05`.
- `index.ts` (existente): barril, acrescentar `export * from './plans.js'; export * from './money.js'` (apenas listado; o DEV edita). O barril de topo `packages/domain/src/index.ts` já exporta `billing`.

**`packages/db/src/`**:
- `plan-pricing.ts`: `createPgPlanPricing(client: SqlClient): PlanPricingPort`. Usa `select plan_code, months, plan_price_id, amount_cents, currency from private.plan_price_at($1::timestamptz, $2::text)` com parâmetros posicionais. Valida `Date` válida, `plan_code` dentre os quatro, `amount_cents` inteiro seguro positivo e `currency = 'BRL'` (senão `preco_invalido`). Falha do banco vira `PlanPricingError('precos_indisponivel')` sem expor a mensagem. `getAt` sem linha: `preco_indisponivel`.
- Barril `packages/db/src/index.ts`: acrescentar `export * from './plan-pricing.js'` (apenas listado).
- Documentação a atualizar pelo DEV: `09-MODELO-DADOS.md` §3.10 (`plan`: sem `active`, `created_at`; `plan_price`: `created_at`, intervalo `[valid_from, valid_to)`, restrição de exclusão), `14-BACKLOG.md` (estado de H-046).

## 5. Segurança e impacto

- **Mínimo privilégio:** tabelas fechadas por RLS forçada sem política; só `app_system` lê; a API lê pela função `security definer` com `search_path = ''`; nenhuma escrita por papel de aplicação, `anon` ou `authenticated`. Preço não é dado pessoal nem segredo, mas a leitura direta segue negada por consistência com H-045.
- **Integridade financeira:** valor imutável, histórico preservado, sem `DELETE`, um preço por instante. Alterar preço exige ação do dono do banco (migração revisada). Pergunta 346.
- **Sem float:** coluna inteira, domínio com `Number.isSafeInteger`, nenhum cálculo de taxa ou desconto.
- **Sem rede, segredo ou e-mail:** nada de Mercado Pago. Testes de escrita em transação desfeita.
- **Impacto em outras histórias:** H-047 (#60) consome `plan_price_at`, acrescenta `subscription.plan_id` e grava `plan_price_id` + `amount_cents` no pagamento; H-049 (#62) usa `months`; nenhuma alteração em H-045.
- **Impacto em testes existentes:** acrescentar `private.plan_price_at` à lista fechada de funções executáveis por `app_api` no teste `audit` (D-02b) e conferir se existe teste que enumere tabelas/funções de `billing` (lição da Rodada 65).
- **Concorrência no DEV:** os testes de H-046 usam transação com `rollback`; a carga de referência persiste (dado legítimo, 4 + 4 linhas). Rodar `db:test` na janela exclusiva (Rodada 63).

## 6. Plano de testes

Arquivos: `packages/db/tests/plan-pricing.dbtest.mjs` (banco), `packages/db/tests/plan-pricing-migration.test.mjs` (verificação estática do SQL, sem banco), `packages/db/src/plan-pricing.test.ts` (adaptador com cliente falso), `packages/domain/src/billing/plans.test.ts` e `packages/domain/src/billing/money.test.ts`. Execução local: `corepack pnpm db:test` e `corepack pnpm test`. Instantes explícitos; fixtures de troca de preço sobre os planos reais dentro de transação desfeita (não é possível criar plano extra por causa do CHECK de código).

| ID | Cobre | O que verifica |
|---|---|---|
| T-01 | CA-H046-01 | `plan` tem 4 linhas; pares (`mensal`,1), (`trimestral`,3), (`semestral`,6), (`anual`,12); inserir `code` fora da lista ou par trocado é recusado |
| T-02 | CA-H046-02 | por parâmetro de texto: `'0'`, `'-1'`, `null`, `'29.90'` recusados (23514, 23502, 22P02); `'2990'` aceito (em fixture com plano sem sobreposição); `currency <> 'BRL'` recusada. Anotar no teste por que o literal numérico não serve |
| T-03 | CA-H046-03 | `plan_price_at('2026-11-13T12:00:00Z')` devolve 2990, 8070, 14940 e 23880 para mensal, trimestral, semestral e anual, nessa correspondência, `currency = 'BRL'` |
| T-04 | CA-H046-04 | catálogo de colunas de `plan` e `plan_price` sem nome de benefício, limite, recurso (`benefit`, `limit`, `feature`, `quota` e equivalentes pt) |
| T-05 | CA-H046-05 | catálogo de tabelas, colunas e funções criadas por H-046 sem `promo`, `discount`, `desconto`, `coupon`, `cupom`, `launch`, `lancamento` |
| T-06 | CA-H046-06 | trocar mensal em `T`: leitura em `T−1 s` = 2990, em `T` = novo, em `T+1 s` = novo (3 por fronteira); antes de `valid_from` inicial devolve zero linhas |
| T-07 | CA-H046-07 | sobreposição parcial e total recusadas (23P01); intervalo encostado aceito; segundo preço aberto para o mesmo plano recusado |
| T-08 | CA-H046-08 | `UPDATE amount_cents` recusado; `UPDATE valid_to` nulo→valor aceito; segundo `UPDATE valid_to` recusado; `DELETE` e `TRUNCATE` recusados; `UPDATE` em `plan` recusado |
| T-09 | CA-H046-09 | `provolatile = 's'`; contagem e soma de conferência de `plan`/`plan_price` iguais antes e depois de várias leituras; corpo sem `now()`/`clock_timestamp()`/`current_timestamp` e `p_at` sem default; `pg_get_function_result` com as 5 colunas; filtro por código devolve 1 linha, nulo devolve 4 |
| T-10 | CA-H046-10 | executar duas vezes o bloco de carga (extraído do arquivo da migração) deixa 4 planos e 4 preços; após uma troca de preço em transação, reexecutar não recria o valor antigo nem duplica |
| T-11 | CA-H046-11 | `has_table_privilege`/`has_function_privilege` negam `anon`, `authenticated`, `service_role` e `app_api` (tabelas); `app_system` só `SELECT` (sem INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER); `EXECUTE` da função para `app_api` e `app_system` e negado aos demais; `relrowsecurity` e `relforcerowsecurity` verdadeiros; zero políticas |
| T-12 | CA-H046-12 | a função devolve `plan_price_id` e `amount_cents`; o id devolvido existe em `plan_price` com o mesmo valor; adaptador repassa os dois campos (a igualdade com o pagamento é de H-047) |
| T-13 | CA-H046-11/regressão | `audit` D-02b atualizado com a nova função; `db:test` completo sem nova falha atribuível a H-046 |
| T-14 | CA-H046-13 | unitário de `formatarCentavosBRL`: os 4 valores aprovados, 123456, 5, 0; recusa `-1`, `29.9`, `NaN`, `Infinity`, `2^53` |
| T-15 | porta/adaptador | parâmetros posicionais, `Date` inválida rejeitada, `plan_code` ou `currency` fora do esperado → `preco_invalido`, erro do banco → código fixo sem mensagem, zero linhas → `preco_indisponivel`; `listarPrecosVigentes`/`lerPrecoVigente` usam o relógio injetado |
| T-16 | CA-H046-14 | execução local sem rede e sem chave; a Issue recebe comando, contagem e código de saída; verificação estática: migração sem `http`, `pg_net`, `cron`, `now()` |

Cobertura: CA-01 a 14 mapeados (CA-12 parcial por definição do refino). Os testes que escrevem (T-02, T-06, T-07, T-08) ficam em transação com `rollback`.

## 7. Riscos e pendências

- **R-A1 (exclusão `btree_gist`):** compilar `uuid WITH =` e `tstzrange WITH &&` no DEV `[NÃO VERIFICADO]`; plano B na §2.3.
- **R-A2 (arredondamento silencioso de literal numérico):** ver §2.3; teste com parâmetro de texto evita falso verde.
- **R-A3 (troca agendada só uma vez):** `valid_to` só fecha uma vez; reprogramar uma troca exige nova linha após o fechamento. Aceito no MVP.
- **R-A4 (alterar preço sem tela):** só por migração revisada até RF-153. Aceito (pergunta 346).
- **R-A5 (tarifas e aviso ao cliente):** fora do banco; S-03 e prazo de aviso são do dono (dec. 293, 299).
- **R-A6 (executor de migrações):** decisão 298/157 aberta; conferir projeto vinculado antes de aplicar.
- **R-A7 (testes de inventário):** ver §5, D-02b.
- **Ordem de entrega:** migração, depois domínio e adaptador; H-047 só consome depois de H-046 pronta.
- Nada aqui toca produção, Mercado Pago, e-mail ou GitHub.

## 8. Perguntas ao líder (a partir de 343; lista única)

Conferir no `11-DECISOES.md` que 343 ainda é o próximo número livre antes de registrar (a #128 usou 333 a 342).

**343. Omitir a coluna `active` em `plan`?** (a) omitir; plano sai de oferta ao fechar o preço sem substituto; (b) manter `active`.
- **Recomendação:** (a). Quatro planos fixos no MVP; `plan` fica imutável por inteiro e mais simples de provar. Destrava o desenho de `plan` e CA-01.

**344. Aceitar a prova de "recusa fracionário" por parâmetro de texto e domínio, em vez de literal numérico?** O PostgreSQL arredonda `29.90` literal para 30 numa coluna inteira, então o CA-H046-02 literal não pode passar.
- **Recomendação:** sim. Ajustar a redação do CA-02 no refino: "recusa `0`, `-1`, `NULL` e `'29.90'` enviado como texto". Destrava T-02.

**345. EXECUTE de `plan_price_at` para `app_api` e `app_system`, e leitura direta das tabelas só para `app_system`?** (a) sim, mesmo critério da decisão 279; (b) só `app_system`.
- **Recomendação:** (a). A API lista planos em nome do principal; a tabela continua fechada. Interpreta "papel da aplicação com leitura" do CA-11 como `app_system` nas tabelas e função para os dois. Destrava T-11.

**346. Data de início da vigência da carga e forma de mudar o preço antes da tela administrativa.** (a) `valid_from` constante `2026-01-01T00:00:00Z` na carga e troca de preço somente por nova migração revisada (fecha a linha, abre outra); (b) usar a data de lançamento (a definir pelo dono).
- **Recomendação:** (a). Não há pagamento antes do lançamento, então uma data passada não prejudica ninguém e mantém a carga determinística. Destrava T-03 e T-10.

**347. Confirmar que H-046 não acrescenta `subscription.plan_id` nem FK de pagamento, e que o rollback sem `cascade` é o comportamento desejado.**
- **Recomendação:** sim (decisão 291). H-047 acrescenta a coluna e a FK. Destrava a ordem das migrações.

**348. Assinatura única da função (`p_plan_code` opcional) ou duas funções (lista e um plano)?** (a) uma função com filtro opcional; (b) duas funções.
- **Recomendação:** (a). Menos superfície de privilégio e de teste; a porta de domínio já separa `listAt` e `getAt`. Destrava a migração e T-09.

## 9. Próximos passos

1. Líder responde 343 a 348 e registra em `11-DECISOES.md` (se não houver veto, valem as recomendações).
2. Confirmar #59 na coluna Arquitetura no quadro e mover para Desenvolvimento só por decisão do líder (a #58 já concluída libera o início, dec. 290).
3. DEV confere os pontos `[NÃO VERIFICADO]` (§2.3 `btree_gist`, §2.5 `usage` no esquema `billing`, busca por "promo", executor/projeto vinculado) antes de gravar a migração e registra a variante usada.
4. Code Review verifica a migração contra este desenho (privilégios T-11, imutabilidade T-08, ausência de relógio T-09) e a lista D-02b (T-13).
