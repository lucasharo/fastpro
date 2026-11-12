# Desenho H-108 — Painel operacional mínimo (Issue #117, WF-03, Arquitetura)

- **Issue:** #117 · **História:** H-108 · **Workflow:** WF-03 · **Data:** 2026-11-11 · **Papel:** Software Architect
- **Decisão:** `APROVADO_ARQUITETURA` com 1 correção de escopo (§1.3) e dúvidas não bloqueantes (§5).
- **Rastro:** 73-REFINO-H108 (CA-H108-01..16); 08 §14; 09 §3.11; 35 §9; 59 §2.4; 70-DESENHO-H103. Lido (somente leitura): `packages/domain/src/admin/{console,roles,routes,guard}.ts`, `apps/api/src/admin-console-route.ts`, migrações `20261111120000`, `20261111290000`.
- **Etiquetas:** `[DECIDIDO]` `[VERIFICADO]` (conferido no código/doc) `[PROPOSTA]` `[NÃO VERIFICADO]`.
- **Natureza:** somente documento. Nenhum código, migração ou rede nesta etapa.

## 0. Achados que mudam o plano

1. **`ops_metric` não existe.** `[VERIFICADO]` Só há uma linha em 09 §3.11 ("série agregada, sem PII") e em 08 §14; nenhuma migração a cria e nenhum código a escreve. Logo não há ainda emissor de métrica de webhook, foto ou RLS.
2. **Superadmin não tem permissão adequada.** `[VERIFICADO]` `ADMIN_ROLE_PERMISSIONS.superadmin` = `admin.role.manage`, `catalog.manage`, `case.authorize_sensitive`; não herda as demais. A tela precisa de permissão própria (padrão de `case.authorize_sensitive`, migração 290000).
3. **A cota de e-mail já tem o contrato de leitura.** `[VERIFICADO]` 59 §2.4: `ops.external_quota where service='email'` (`used`, `hard_limit`, `alert_level`, `alerted_at`); `alert_level` é 0, 1 (70%) ou 2 (85%); sem 95% para e-mail.

## 1. Métricas do painel e origem

### 1.1 Conjunto entregue nesta história (todas agregadas, nenhuma é dado pessoal)

| Bloco | Valores exibidos | Origem | Situação |
|---|---|---|---|
| Fila de e-mail | itens por `state` (pendente, enviando, enviado, falha, suprimido, adiado_cota, descartado); idade em segundos do pendente mais antigo; falhas por `reason_code` | `ops.email_outbox`: `count(*) group by state`, `min(created_at)` onde `state='pendente'`, `count(*) group by reason_code` onde `state='falha'` | `[PROPOSTA]` leitura direta; colunas `[VERIFICADO]` |
| Cota de e-mail | `used`, `hard_limit`, `%` (inteiro, `used*100/hard_limit`), `alert_level`, `alerted_at`, para `dia_utc` e `mes` do período corrente | `ops.external_quota` (`service='email'`, `period_start` = hoje UTC / 1º do mês UTC) | `[VERIFICADO]` |
| Cota Mapbox | mesmos campos para `mapbox_permanent` (mês) e `mapbox_geocoding_temp` | `ops.external_quota`, só se a linha existir | `[VERIFICADO]` que há escritores (migrações 260000, 390000); H-021 bloqueada, então "sem dados" é o estado normal |
| Storage e banco | `%` de uso | **sem escritor** em `external_quota` `[VERIFICADO: nenhuma migração cria linha de storage/db]` | `[PROPOSTA]` não entram nesta entrega (CA-H108-15) |
| Webhooks, fotos, erros RLS | contagens por hora e dimensão fechada; latência de webhook como `count`, `soma_ms`, `max_ms` | `ops_metric` (§1.2) | `[PROPOSTA]` a tela e a leitura entram; cada bloco só aparece quando a chave tiver ponto gravado |

`[DECIDIDO]` quem vê: Superadmin (recomendação do PO aceita pelo líder).

### 1.2 `ops_metric` (tabela já prevista em 09 §3.11, ainda não criada)

`[PROPOSTA]` Migração nova `ops.ops_metric`, com o mínimo para as três métricas sem emissor:
- `metric_key text` com `CHECK` numa lista fechada: `webhook_falha`, `webhook_latencia`, `webhook_pendente_idade`, `foto_upload_falha`, `foto_reencode_falha`, `rls_negacao`.
- `bucket_start timestamptz` (hora UTC truncada), `dimension text not null default ''` com `CHECK (dimension ~ '^[a-z][a-z0-9_]{0,39}$' or dimension = '')`, `value bigint check (>= 0)`, `sum_ms bigint null`, `max_ms bigint null`.
- Chave primária `(metric_key, bucket_start, dimension)`; escrita só por `private.ops_metric_incr(...)` (upsert com `+`), `search_path=''`, RLS forçada sem políticas, `grant` só a `app_system`, `revoke` de `public, anon, authenticated, service_role` (padrão H-092).
- Sem coluna de identificador, texto livre, `principal_id` ou `jsonb`: a ausência de PII é estrutural (lista fechada + regex), não convenção. O nome do arquivo ou do evento nunca entra na dimensão; só código (ex.: `heic_invalido`, `timeout`).
- Retenção: o painel lê as últimas 24 h; expurgo é de H-110 (fora de escopo).
- Os emissores (webhook, upload, RLS) são das histórias donas; H-108 não os escreve. `[VERIFICADO]` `sqlstate` e `count` já estão na allowlist de log (H-007), então o ponto de chamada pode usar os mesmos campos.

### 1.3 Correção de escopo
Os blocos de webhook, foto e RLS ficam "prontos para dado, sem dado" nesta história; o refino os listava como entregues. Aceitar isso mantém CA-H108-11..13 testáveis com dados semeados em teste e CA-H108-15 coerente. `[PROPOSTA]`

## 2. Rota, guarda e resposta

- **Rota:** `GET /v1/admin/ops/panel` `[PROPOSTA]`. Registrada em `ADMIN_ROUTES` (novo `ADMIN_ROUTES_H108`) com `permission: 'ops.panel.read'`.
- **Permissão nova** `ops.panel.read` `[PROPOSTA]`: acrescentar a `ADMIN_PERMISSIONS`; mapear **somente** a `superadmin` em `ADMIN_ROLE_PERMISSIONS`; migração de seed (`app.admin_permission` + `app.admin_role_permission`, `on conflict do nothing`, como em 290000). Nenhum outro papel (CA-H108-02).
- **Tela:** entrada `operacao` ("Painel operacional") em `ADMIN_CONSOLE_SCREENS`, `permissao: 'ops.panel.read'`, `rota: { GET, /v1/admin/ops/panel }`, `historiaDona: 'H-108'`. `consoleScreenVisible` já a esconde de quem não tem a permissão ou se a rota sair do registro (CA-H108-15 para a tela inteira). `[VERIFICADO]`
- **Guarda:** `decideAdminGuard(row, 'ops.panel.read', nowMs)` `[VERIFICADO]` exige sessão ativa, `aal2`, não expirada, papel presente; sem sessão/aal2/papel = 404 idêntico; com papel mas sem permissão = `ADMIN_PERMISSION_DENIED`. Sem cache: revogação vale na requisição seguinte. Handler novo `handleOpsPanel` em `packages/domain/src/admin/ops-panel.ts` (puro, recebe `row` e o agregado já lido) e rota `apps/api/src/admin-ops-route.ts` no molde de `admin-console-route.ts` (cookie → guarda → leitura → resposta; `Cache-Control: no-store`; falha de banco = 503 `{code:'ops_indisponivel'}` sem detalhe, mapeado na tela para o texto de CA-H108-16).
- **Somente leitura** (CA-H108-04): existe só `GET`; qualquer outro método nessa rota não está no registro = 404. A leitura usa uma função `private.ops_panel_read()` `security definer`, `stable`, `search_path=''`, só `select`, devolve `jsonb`; `grant execute` só a `app_system`.
- **Resposta 200** (`snake_case`, tipos fechados, nunca linha bruta):
  ```
  { gerado_em, fila_email: { por_estado: {pendente,...}, idade_pendente_s|null, falhas_por_codigo: {codigo: n} },
    cotas: [ { servico, periodo, usado, limite, percentual, alerta: 0|1|2, alertado_em|null } | { servico, sem_dados: true } ],
    webhooks: {falhas, latencia:{n,media_ms,max_ms}, idade_pendente_s|null} | null,
    fotos: {falhas_upload_por_tipo:{}, falhas_reencode_por_tipo:{}} | null, rls: {negacoes} | null }
  ```
  Bloco sem fonte = `null` (a tela omite; CA-H108-15). Serviço sem linha = `sem_dados:true`, nunca 0% (CA-H108-10). Alerta 95% nunca existe no e-mail (CA-H108-08); para Mapbox/Storage o `alerta` segue o `alert_level` gravado, e o nível 3 só aparece se Q-H108-2 for (b).
- **Janela:** fila e cota são o estado atual; `ops_metric` = últimas 24 h. `[PROPOSTA]`

## 3. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Agregado pequeno revela indivíduo (ex.: 1 negação RLS, 1 falha de foto, `rls_negacao=1` ligável a um usuário conhecido) | Sem dimensão por usuário, pedido ou arquivo; granularidade mínima de 1 h e dimensão só por código; não há filtro por `principal_id`. Aceito para contadores operacionais (leitor é o Superadmin, que já é pessoal da fábrica); **não** abrir o painel a outros papéis sem rever (Q-H108-1 b/c) |
| R-2 | Enumeração da rota/permissão | 404 idêntico sem sessão/aal2/papel; menu só esconde, a guarda decide; resposta única sem parâmetros (sem `id`, sem filtro) |
| R-3 | PII entra por `reason_code`, `dimension` ou `last_error` | `reason_code` e `dimension` já têm `CHECK` de regex; o painel **não** lê `last_error`, `template_params`, `dedupe_key`, `recipient_user_id` nem `provider_message_id`. Teste varre a resposta (§4) |
| R-4 | Leitura pesada da fila sob carga | Consultas usam `email_outbox_fila_idx` e agregam; 1 chamada por abertura da tela; sem polling `[PROPOSTA]` |
| R-5 | Hora do relógio/UTC trocando o "período corrente" | Período calculado no banco (`at time zone 'UTC'`), nunca no fuso do servidor (mesma regra de H-094) |
| R-6 | Permissão nova concedida por engano a outro papel | Teste de mapa (T-H108-03) trava o conjunto de papéis com `ops.panel.read` |
| R-7 | Painel parecer "verde" por falta de dado | `sem_dados` explícito; nunca 0 inventado |

## 4. Testes e critérios verificáveis (local; `corepack pnpm check:all`, `db:test`)

**Unidade (domínio, sem banco)**
- T-H108-01 `consoleMenuFor`: Superadmin vê `operacao`; os cinco outros papéis não; sem a rota no registro, nem o Superadmin vê (CA-01, 02, 15).
- T-H108-02 `handleOpsPanel`: sem linha, sem aal2, sessão vencida, sem papel = 404 idêntico; papel sem permissão = negação H-102; Superadmin = 200 (CA-02, 03).
- T-H108-03 mapa: o único papel com `ops.panel.read` é `superadmin`; `ADMIN_ROUTES` não tem método além de `GET` para o caminho (CA-04).
- T-H108-04 percentual: 70/100 → 70 e alerta 1; 85/100 → 85 e alerta 2; 2.100 e 2.550 de 3.000 idem; 86/100 sem alerta 3 no e-mail (CA-07, 08).

**Banco (`*.dbtest.mjs`, dados semeados em datas de 2099 / transação com rollback)**
- T-H108-10 fila: N itens em estados variados → contagem por estado igual ao `count` direto; idade do pendente mais antigo correta; fila vazia → zeros e `idade_pendente_s=null` (CA-05, 06).
- T-H108-11 cota: linha `email` dia/mês → valores e `alerted_at`; sem linha de serviço → `sem_dados` (CA-07, 10).
- T-H108-12 `ops_metric`: `metric_key` fora da lista e `dimension` com `@`, espaço ou maiúscula são recusadas; `ops_metric_incr` soma sem duplicar (CA-11..13).
- T-H108-13 privilégios: `authenticated`, `anon`, `service_role` não executam `ops_panel_read` nem leem `ops_metric`; `app_system` sim.
- T-H108-14 sem PII: com semente que inclui destinatário, `dedupe_key` e `last_error`, o JSON da resposta não contém nenhum desses valores nem padrão de e-mail/telefone/CPF (CA-14).

**API (Vitest, molde de `admin-console-route.test.ts`)**
- T-H108-20 cookie ausente → 404 sem tocar o banco; falha de banco → 503 sem detalhe; `POST/PUT/DELETE` no caminho → 404 (CA-04, 16).
- **Critério de aceite de Arquitetura:** os itens acima com contagem e código de saída registrados na Issue; nenhuma tela de outro papel alterada.

## 5. Dúvidas não bloqueantes (para o líder consolidar)

- **Q-D108-1 — criar `ops.ops_metric` agora.** Alternativas: (a) criar com a forma mínima de §1.2 e deixar os blocos de webhook/foto/RLS sem dado até os emissores; (b) adiar webhook/foto/RLS inteiros para as histórias donas. **Recomendação: (a)** (fecha o contrato e a segurança uma vez; custo pequeno).
- **Q-D108-2 — permissão nova `ops.panel.read`.** Alternativa: reutilizar `admin.role.manage` (menos código, mistura gestão de papéis com leitura operacional). **Recomendação: permissão nova**, para o conceito de menor privilégio.
- **Q-D108-3 — fila de e-mail por leitura direta de `ops.email_outbox`** em vez de gravar a série em `ops_metric`. Recomendação: leitura direta (sem emissor duplicado, valor exato); série só se for preciso histórico (fora de escopo).
- **Q-H108-2 (do refino, 95% em Storage/Mapbox)** e **Q-H108-3 (quais cotas)**: com este desenho, Storage e banco ficam sem dado até existir escritor; Mapbox aparece se houver linha. Mantém-se a recomendação do PO ((b) e (a)). Se for (b), o nível 3 exige a mesma mudança de `alertLevelFor` por serviço (hoje 0..2 no e-mail).
- **Q-H108-4:** registrar H-103 (#112) como dependência de H-108 no backlog; `[VERIFICADO]` a casca já existe no código.
- `[NÃO VERIFICADO]` status das dependências no quadro (não consultei o GitHub).
