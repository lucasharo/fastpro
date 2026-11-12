# H-025 — Desenho: rascunho de pedido sem conta

- **Issue:** #38 · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-11 · **Papel:** Architect
- **Etiquetas:** `[DECIDIDO]` aprovado em documento · `[VERIFICADO]` conferido no código ou documento · `[PROPOSTA]` sugestão do Architect · `[NÃO VERIFICADO]` sem fonte
- **Base:** 71-REFINO-H025 (prazo de 7 dias aceito), 08 §5.1, 09 (`request_draft`), 11-ARQ §2.2, 56-DESENHO-H020 §2.3 (porta `DraftGate`), código de `apps/api/src` e `packages/domain/src`.

## 0. Situação encontrada
- `[VERIFICADO]` Não existe migração nem código de `request_draft` (busca em `supabase/`, `packages/`, `apps/`). A tabela é **migração nova**.
- `[VERIFICADO]` Existem e serão reaproveitados: `app.service` (H-018), `private.rl_check/rl_hit` e `ops.app_config` (H-005/H-015), `checkConsumeHeaders` e o padrão de cookie `__Host-` com segredo de 256 bits e SHA-256 (`consume.ts`), `ADDRESS_LABEL_MAX = 200`, a porta `DraftGatePort` (hoje `unwiredDraftGate`, responde 503) e o padrão de rota com portas injetadas (`geo/address-suggest-route.ts`, ligada em `app.ts` por opção).
- `[VERIFICADO]` 56 §2.3 deixa a **ligação real da `DraftGate` como critério de aceite de H-025**.

## 1. Rotas (todas sob `/v1`, sem CORS, `Cache-Control: no-store`)
`[PROPOSTA]` Sem id na URL: o rascunho é sempre "o do navegador" (`current`), identificado só pelo cookie. Isso elimina enumeração por id. O `id` (uuid v4) é devolvido ao cliente só para uso posterior (H-013/H-030). A rota de revisão `/drafts/{id}/review` (11-ARQ) é de H-030 e não entra aqui.

**Cookie** `[PROPOSTA]`: `__Host-fp_draft` = segredo aleatório de 256 bits (base64url, 43 caracteres) **gerado só pelo servidor**; `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` (7 dias, reemitido a cada salvamento). O banco guarda só o SHA-256. É distinto de `__Host-fp_ident` (etapa de identificação).

| Rota | Efeito | Sucesso | Erros |
|---|---|---|---|
| `POST /v1/drafts` | Cria o rascunho; se o cookie já aponta para um rascunho vivo, devolve o mesmo (idempotente) | 201 (novo, com `Set-Cookie`) ou 200 (existente) | 415, 403, 413, 422, 429, 503 |
| `PATCH /v1/drafts/current` | Salva campos parciais (debounce do cliente) | 200 com o rascunho | 404, 415, 403, 413, 422, 429, 503 |
| `GET /v1/drafts/current` | Lê o rascunho | 200 | 404, 403, 429, 503 |
| `DELETE /v1/drafts/current` | Descarta (estado `descartado`) e limpa o cookie | 204 | 404 (mesmo corpo de "não existe"), 403, 503 |

**Corpo (POST e PATCH)** `[PROPOSTA]`, JSON, limite **8 KB**, só estas chaves (qualquer outra, inclusive `email`, `first_name`, `phone`, `status`, `id`, `expires_at`, `lat`/`lon`, ⇒ 422 `campo_desconhecido`; evita atribuição em massa e dado pessoal):
- `service_id` uuid de `app.service` **ativo** (senão 422 `servico_invalido`); `null` limpa.
- `address_text` texto, 3 a 200 caracteres após aparar (reaproveita `ADDRESS_QUERY_MIN` e `ADDRESS_LABEL_MAX`); `null` limpa. Nunca coordenada.
- `urgency` `imediato | proximas_semanas | proximo_mes | nao_definido` `[VERIFICADO]` 09; qualquer outro ⇒ 422 `urgencia_invalida` e nada é gravado (CA-02).
- `description` texto até **2000** caracteres `[PROPOSTA]`, sem caracteres de controle (exceto quebra de linha); `null` limpa.
- POST/PATCH com corpo sem nenhuma chave ⇒ 422 `vazio` (impede rascunho vazio).

**Resposta (200/201)**: `{ id, status, service_id, address_text, urgency, description, expires_at, updated_at }`. Nunca devolve `browser_nonce_hash`, `ip_hmac`, `email`. Erros: `{ code }` fixo, sem eco da entrada.

**Ordem fixa** (como H-020): Origin/Sec-Fetch-Site (+ Content-Type JSON em POST/PATCH; GET/DELETE só Origin, `[NÃO VERIFICADO]` se `checkConsumeHeaders` aceita sem Content-Type, o DEV ajusta) → formato do cookie (43 caracteres; malformado ⇒ 404 sem ir ao banco) → corpo → limite de taxa → função no banco. Erro interno ⇒ 503 fixo.

**Semântica**
- Salvar é por campo parcial e idempotente (mesmo corpo, mesmo resultado, sem duplicar). Cliente envia uma requisição por vez e, ao receber 429, espera `Retry-After`. `[PROPOSTA]` Debounce de 800 ms após a última digitação, salvamento imediato ao sair do campo; o rascunho só é criado na **primeira ação com conteúdo**, não ao abrir a tela.
- A transição para `aguardando_email` é de H-013. `[PROPOSTA]` O PATCH aceita `aberto` e `aguardando_email` (o cliente pode corrigir antes de confirmar o link); `descartado` e `publicado` respondem 404.
- Expiração preguiçosa: leitura com `expires_at <= agora` ⇒ 404 (mesmo de inexistente). `POST` com cookie de rascunho vencido marca o antigo `descartado` e cria outro com **novo** segredo.
- Prazo `[DECIDIDO]` 7 dias (71, D-H025-1), valor em `ops.app_config` chave `request_draft.ttl_days` `[PROPOSTA]`, padrão 7, limites 1 a 30. Renovado a cada salvamento (janela deslizante), com teto absoluto de 30 dias desde a criação `[PROPOSTA]`.
- Porta `DraftGate` real `[PROPOSTA]`: `check('request_draft', cookie)` ⇒ `ok` com `principal = id do rascunho` se vivo e em `aberto|aguardando_email`; `not_draft` caso contrário; `no_principal` sem cookie; `indisponivel` em falha. `professional_base` continua sem ligação (H-036).

## 2. Dados
- `[VERIFICADO]` Modelo 09: `request_draft` com `id`, `browser_nonce_hash`, `service_id?`, `address_text?`, `urgency?`, `description?`, `status` {`aberto|aguardando_email|descartado|publicado`}, `expires_at`, `ip_hmac`.
- **Migração nova (única)** `[PROPOSTA]`: `app.request_draft` com **só** as colunas acima mais `created_at`, `updated_at`. Fora desta migração (cada história adiciona o seu): `email`, `first_name` (H-011/H-013), `exact_point`, `geocoded_at`, `geocode_calls`, `geocode_mode` (H-021), `phone_enc`, `phone_share_opt_in` (H-033), `media_asset(draft_id)` (H-026). Nenhuma coluna de latitude, longitude ou ponto (I-28, G-01).
- Restrições `[PROPOSTA]`: `check` de `status`, de `urgency` e de tamanhos; `service_id` com FK para `app.service`; índice único **parcial** em `browser_nonce_hash` onde `status in ('aberto','aguardando_email')`; índice em `expires_at` (para o expurgo de H-110) e em `(ip_hmac, created_at)`.
- Postura igual às migrações anteriores `[VERIFICADO]`: RLS habilitada e forçada, sem políticas, nenhum privilégio para `PUBLIC/anon/authenticated/service_role`; acesso só por funções `security definer` em `private` com `set search_path = ''`, tempo `p_now` informado pelo chamador: `draft_create`, `draft_get`, `draft_patch`, `draft_discard`, `draft_gate`. O papel que as executa segue o de H-019 (`app_api`) `[NÃO VERIFICADO]`, o DEV confirma. Arquivo de desfazer em `supabase/rollbacks/` (padrão existente).
- Estados usados em H-025: `(criação) → aberto`, `aberto|aguardando_email → descartado` (DELETE, expiração). `aguardando_email` e `publicado` são **gravados por outras histórias** (H-013, H-031); a coluna aceita os quatro valores já agora.
- Vínculo com H-013 `[PROPOSTA]`: o segredo do cookie do rascunho é o "nonce de navegador"; `auth_challenge.browser_nonce_hash` receberá o mesmo SHA-256, e H-013 compara com `request_draft.browser_nonce_hash`. H-025 não altera `auth_challenge`.
- Expurgo físico por TTL é de **H-110**; até lá os vencidos só ficam invisíveis (expiração preguiçosa). Lacuna aceita, registrada em §5.

## 3. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| R1 Abuso de criação (spam, enchimento do banco gratuito) | Criação limitada por IP-HMAC com `rl_check/rl_hit`: **10 por hora e 50 por dia** `[PROPOSTA]` (configuráveis em `app_config`; NAT/CGNAT exige folga); salvamento: 60 por 60 s por rascunho e 120 por 60 s por IP-HMAC (mesmo formato de `SUGGEST_RATE_*`). Teto global de rascunhos vivos (padrão 5.000, `app_config`) ⇒ 429 neutro. Rascunho vazio recusado; corpo de 8 KB. 429 só com `Retry-After`, sem expor o limite |
| R2 Dado pessoal antes da identificação | Sem colunas de e-mail, nome ou telefone; chaves extras ⇒ 422. Descrição livre pode conter telefone ou e-mail digitado: não é logada (allowlist de log `[VERIFICADO]` 56 §75: sem corpo nem texto), `no-store`, não é exposta a profissionais antes da publicação, expurgada por TTL; aviso na tela "não escreva telefone ou e-mail aqui" `[PROPOSTA]`. IP só como HMAC (pepper fora do banco) |
| R3 Enumeração e IDOR | Sem id na URL; acesso só pelo cookie de 256 bits; 404 idêntico (corpo e cabeçalhos) para sem cookie, cookie malformado, de outro navegador, vencido, descartado ou publicado; busca por hash, não por id; formato inválido nem toca o banco |
| R4 CSRF e fixação | `SameSite=Strict` + Origin + `application/json`; segredo gerado só no servidor (cliente nunca propõe nonce) |
| R5 Geocodificador aberto via rascunho | `DraftGate` real só aceita rascunho vivo (56 §113); endereço guardado só como texto |
| R6 Salvamentos fora de ordem (debounce) | Uma requisição em voo por vez no cliente; campos parciais independentes; último a chegar vence |
| R7 Acúmulo sem expurgo até H-110 | Índice de `expires_at` pronto; registrar dependência. Se H-110 atrasar, rodar expurgo manual `[PROPOSTA]` |

## 4. Testes e critérios verificáveis
Padrão do repositório `[VERIFICADO]`: testes de unidade/rota (`*.test.ts`) e de banco (`*.dbtest.mjs`) em `packages/db/tests` e `apps/api/tests`; execução local com `corepack pnpm check:all` e `db:test`.
- **D-01 (CA-01/03)** POST com serviço, local, urgência e descrição ⇒ 201, `Set-Cookie` com `HttpOnly; Secure; SameSite=Strict; __Host-`, nenhuma exigência de senha, e-mail ou nome; coluna de e-mail ausente do esquema.
- **D-02 (CA-02)** urgência fora das 4 chaves ⇒ 422 e zero linhas alteradas; as 4 chaves passam.
- **D-03 (CA-05, T-02)** PATCH/GET/DELETE com cookie A, sem cookie, com cookie B, malformado, vencido e descartado: só A funciona; os demais ⇒ 404 com corpo e cabeçalhos byte a byte iguais; cookie malformado ⇒ zero chamadas ao banco.
- **D-04 (CA-06)** mesmo PATCH duas vezes ⇒ mesmo resultado; POST repetido com cookie vivo ⇒ 200 e a contagem de linhas não muda.
- **D-05 (CA-07, G-01)** teste estático: a migração não tem coluna `lat|lon|latitude|longitude|point|geom`; salvar endereço grava só `address_text`; corpo com `lat`/`lon` ⇒ 422.
- **D-06 (CA-08)** nenhuma rota desta história cria `service_request` nem altera `status` para `publicado`.
- **D-07 (CA-09)** com relógio injetado: vivo em 7 d − 1 s, 404 em 7 d; salvamento renova; teto de 30 d respeitado; POST com cookie vencido cria novo com segredo diferente e marca o antigo `descartado`.
- **D-08 (CA-10)** 11ª criação na hora, mesmo IP ⇒ 429 com `Retry-After`, sem campo que revele o limite; `rl_hit` só após aceite.
- **D-09 (validação)** `service_id` inexistente ou inativo ⇒ 422; descrição de 2001 caracteres ⇒ 422; corpo de 8 KB + 1 ⇒ 413; controle/`\0` ⇒ 422; chaves extras ⇒ 422; vazio ⇒ 422.
- **D-10 (segurança de banco)** RLS habilitada e forçada; `anon/authenticated/service_role/PUBLIC` sem privilégio na tabela e nas funções; `search_path` vazio; migração idempotente (aplicar duas vezes) e desfazer funciona.
- **D-11 (H-020)** a porta real: `ok` só com rascunho vivo; sem cookie ⇒ `no_principal`; fora de `aberto|aguardando_email` ⇒ `not_draft`; e o teste de ponta a ponta de CA-01/CA-02 de H-020 (56 §118) passa com ela.
- **D-12 (privacidade em log)** teste com sentinela: texto de endereço e descrição não aparecem em nenhuma linha de log nem em corpo de erro.
- **CA-04 do refino** `[PROPOSTA]`: o bloqueio de "enviar para revisão" sem nome e e-mail é de H-030/H-013 (a revisão não existe aqui). H-025 entrega só a função pura de domínio `draftMissingForReview(draft)` (lista os campos faltantes) com teste unitário, para ser usada por H-030.
- **Fora do escopo de teste:** envio de e-mail, fotos, geocodificação permanente, telefone.

## 5. Dúvidas não bloqueantes (recomendação do Architect)
1. **Rascunho renova a cada salvamento ou vence 7 dias fixos após a criação?** Recomendação: renovar, com teto de 30 dias (quem edita no sexto dia não perde o trabalho; o teto limita o acúmulo).
2. **Limites de criação (10/h, 50/dia por IP, teto global 5.000) e descrição de 2000 caracteres.** Recomendação: aceitar como padrão configurável em `app_config`; ajustar após ensaio fechado.
3. **Expurgo físico só em H-110.** Recomendação: aceitar a lacuna na fase de ensaio (sem usuário real) e manter H-110 antes de abrir ao público.
4. **Cookie do rascunho como nonce de H-013** (§2). Recomendação: aceitar; reduz um segundo cookie e dá a regra "mesmo navegador" por igualdade de hash.
5. **CA-04 do refino fica para H-030/H-013** com a função pura de H-025. Recomendação: aceitar; ajustar o critério na Issue #38 para não prometer a tela de revisão.
6. **Rotas com `current` em vez de `{id}`** (diverge do texto de 11-ARQ §2.2, que não fixa o caminho). Recomendação: aceitar; `/drafts/{id}/review` de H-030 passa a aceitar `current` ou o id só se o cookie conferir.
7. **PATCH em `aguardando_email`** permitido. Recomendação: aceitar (corrigir antes de confirmar o link).
