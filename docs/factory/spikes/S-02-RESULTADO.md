# S-02 — Resultado: PostGIS, pg_cron e pg_net no Supabase Free

- **Issue:** #4 (spike S-02, parte remota somente leitura). **Data:** 2026-11-10. **Branch:** `feature/init`.
- **Escopo executado:** apenas consultas de leitura ao catálogo do projeto Supabase gratuito de desenvolvimento. Nenhuma extensão foi habilitada, nenhuma tabela ou dado foi criado.
- **Método:** cliente `pg` (Node) instalado fora do repositório; conexão com a variável `DATABASE_URL_MIGRATIONS` lida do `.env.local` por código. Nenhum valor de chave, senha, URL ou identificador do projeto aparece neste documento.
- **Não executado (fora desta etapa):** benchmark geo de 50.000 pedidos (passo L4 do plano, exige criar extensão e tabelas), teste de `set_config` via pooler em transação (passo S-02.5) e medição do pooler. Ficam para a H-003, S-09 e S-10.

## 1. Consultas e saída relevante

### Versão do Postgres

`select version()` retornou PostgreSQL 17.11 (aarch64-unknown-linux-gnu).

### Extensões disponíveis

`select name, default_version, installed_version from pg_available_extensions where name in (...)`

| Extensão | Versão disponível | Instalada hoje |
|---|---|---|
| postgis | 3.3.7 | não |
| pg_cron | 1.6.4 | não |
| pg_net | 0.20.4 | não |
| pgtap | 1.3.3 | não |
| pgcrypto | 1.3 | sim |
| pg_trgm | 1.6 | não |
| unaccent | 1.1 | não |
| btree_gist | 1.7 | não |
| citext | 1.6 | não |
| vector | 0.8.2 | não |
| earthdistance (fallback geo) | 1.2 | não |
| cube (dependência do earthdistance) | 1.5 | não |

Já instaladas (padrão da plataforma): `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`.

### Papel atual e permissão para criar extensões

Consulta: `select current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, has_database_privilege(current_user, current_database(), 'CREATE') ...`

- Usuário atual: `postgres`; `rolsuper = false`, `rolcreatedb = true`, `rolcreaterole = true`, `rolbypassrls = true`; privilégio `CREATE` no banco: sim.
- No Supabase, `postgres` não é superusuário, mas a plataforma permite `create extension` das extensões da lista aprovada. Como `CREATE` no banco é concedido e as extensões constam como disponíveis, a criação é esperada. A confirmação efetiva só ocorre ao executar `create extension` na H-003 `[NÃO VERIFICADO até a execução]`.
- Os papéis de aplicação previstos (`app_api`, `app_system`) ainda não existem. Papéis existentes: `anon`, `authenticated`, `authenticator`, `service_role`, `supabase_*`, `pgbouncer`, `dashboard_user`. O `postgres` pode criar papéis (`rolcreaterole`), então as migrações da H-003 conseguem criar `app_api` e `app_system`.

### Limites visíveis

| Parâmetro | Valor |
|---|---|
| max_connections | 60 |
| statement_timeout | 120000 ms (2 min) |
| idle_in_transaction_session_timeout | 0 (sem limite) |
| shared_buffers | 28672 x 8 kB (224 MB) |
| work_mem | 2184 kB |
| conexões abertas no momento da consulta | 15 (inclui serviços internos do Supabase) |

Com `max_connections = 60` e cerca de 15 já usadas pela plataforma, sobra pouco espaço para conexões diretas simultâneas: a API serverless deve usar pooler (limite de clientes do pooler `[NÃO VERIFICADO]`).

### Schemas existentes

`auth`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `public`, `realtime`, `storage`, `vault`. Nenhum schema do produto (`app`, `private` etc.) existe ainda; o banco está vazio de domínio.

### Conexão direta e pooler

- A conexão direta (porta 5432, host do banco) conectou desta máquina de desenvolvimento. O host direto do Supabase Free resolve somente IPv6; foi confirmado só que esta máquina alcança o banco, não de onde mais.
- **[NÃO VERIFICADO]** Vercel e GitHub Actions podem não alcançar IPv6. Até verificar, assumir que a API em runtime e o CI devem usar o pooler (modo transação para a API serverless; modo sessão para migrações vindas de ambientes sem IPv6). O endereço e a porta do pooler não foram consultados nesta etapa.
- As migrações (`DATABASE_URL_MIGRATIONS`) podem seguir pela conexão direta no computador do desenvolvedor; no CI, usar o pooler em modo sessão se o IPv6 não for alcançável `[NÃO VERIFICADO]`.

## 2. Comandos que a H-003 usaria (não executados)

```sql
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_net;                        -- schema extensions (padrão da plataforma)
create extension if not exists pg_cron;                       -- schema cron
create extension if not exists pgtap with schema extensions;  -- somente em banco de teste/dev
select postgis_full_version();
```

Observações para a H-003: criar `pgtap` apenas em ambiente de teste; `pg_cron` e `pg_net` exigem papéis com permissão no schema `cron` e em `net`; o schema `extensions` precisa estar no `search_path` das funções que usam tipos PostGIS (ou usar nomes qualificados, conforme a regra de segurança de funções).

## 3. Decisões

| Tema | Decisão | Condição |
|---|---|---|
| Geo | **PostGIS** (3.3.7) é o caminho principal; o plano B por célula (~500 m + `earthdistance`) fica só como contingência | Confirmar `create extension postgis` e o benchmark L4 na H-003/H-022. Se falhar, ativar o plano B |
| Tick de jobs | **pg_cron + pg_net** disponíveis; aceitos como candidato A do ADR-018 | A escolha final A/B/C depende do S-10 (chamar a API pública por `pg_net` exige URL pública do S-09). Manter o plano C (oportunista) sempre presente; B (agendador externo) como reserva |
| pgTAP | **Disponível** (1.3.3) | Usar em dev/teste; catálogo de RLS da H-003 viável |
| Extensões auxiliares | `pg_trgm`, `unaccent`, `btree_gist`, `citext`, `vector`, `earthdistance`, `cube` disponíveis | Habilitar apenas as que a história pedir |

## 4. Impacto

- **H-003:** pode prosseguir com PostGIS, `pg_trgm`, `unaccent` e pgTAP sem plano B. Incluir migração com os `create extension` acima, teste de catálogo "extensões esperadas presentes" e validar `create extension` no projeto remoto. A premissa de banco local (Docker/Supabase CLI) não vale mais: o desenvolvimento usa o projeto na nuvem, e o banco efêmero de testes precisa de outra estratégia (schema ou banco de teste no próprio projeto gratuito) `[a detalhar na H-003]`.
- **H-022:** pode usar `geography(Point,4326)` com GiST; o fallback por célula não é necessário agora.
- **H-008 / S-10:** `pg_cron` e `pg_net` existem, então o tick A é tecnicamente possível; faltam S-09 e S-10 para validar alcance da API pública e limites.
- **ADR-008 (geo):** manter PostGIS como decisão; atualizar o status para "disponível (3.3.7), criação a confirmar na H-003".
- **ADR-018 (hospedagem/execução):** registrar que o host direto do banco é somente IPv6 `[NÃO VERIFICADO para Vercel/Actions]`, que a API serverless usa o pooler e que `max_connections = 60` reforça `max: 1` por instância.
- **Risco V-1 (R-38):** reduzido; as três extensões foram encontradas no Free.
- **Risco V-3 (`set_config` via pooler):** continua aberto; exige teste na H-003/S-09.

## 5. Pendências

1. Executar `create extension` de fato (H-003) e o benchmark geo L4.
2. Obter endereço, porta e limites do pooler e testar `set_config` por transação (V-3).
3. Verificar IPv6 a partir da Vercel e do GitHub Actions.
4. Decidir o tick A/B/C no S-10.
5. Definir a estratégia de banco de teste efêmero sem Docker.

## Resumo em linguagem simples

Conferimos o banco gratuito que criamos para o FastPro e ele tem tudo o que precisávamos: o recurso de mapas e distâncias (para achar profissionais perto do cliente), o agendador que roda tarefas sozinho, o recurso para o banco avisar a internet e a ferramenta de testes do banco. Nada disso foi ligado ainda; só olhamos o que está disponível, e o usuário que temos tem a permissão necessária para ligar. A decisão é seguir com o plano principal (mapas e agendador dentro do próprio banco) e manter os planos reserva só por segurança. Há um ponto de atenção: o endereço direto do banco só funciona em redes mais modernas, e ainda não sabemos se os serviços de publicação e de testes automáticos conseguem usá-lo, então eles devem usar o endereço intermediário. O banco também aceita poucas conexões ao mesmo tempo, o que reforça esse cuidado.
