# Desenho H-014 — Sessão de 7 dias e step-up (Issue #27, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 3 dúvidas não bloqueantes (§7).
- **Rastro:** 51-REFINO-H014 (CA-H014-01..17); decisões do Orquestrador D-H014-1..5; 46-DESENHO-H012 (§3, R-7); 33-DESENHO-H016 (DD-5, §6.2); 50-DESENHO-H015 (`auth_code_attempt`); S-01-RESULTADO (D2, D3, D6); 10 ADR-005; 08 §5.1 e §5.4. Lido (somente leitura): migrações `20261111140000`, `20261111150000`, `20261111170000`; `packages/domain/src/identity/*`; `packages/db/src/challenges.ts`, `challenge-consume.ts`; `notifications/policy.ts`.
- **Natureza:** documento, mais o ajuste de texto de 08 §5.1 item 6 (D-H014-2, já aplicado). Nenhum código, migração, teste, chave, conta ou e-mail foi criado.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` precisa de prova em desenvolvimento.

## 0. Fatos do repositório [VERIFICADO]

1. `app.app_session` já existe (H-012) com `stage`, `secret_hash`, `challenge_id` único, `expires_at`, `absolute_expires_at`, `revoked_at`, `purpose`, `draft_id`; CHECK `app_session_identificacao_15min`. **Não tem** `recent_auth_at`, método de prova nem índice único em `secret_hash`.
2. `auth_challenge` já tem 5 tentativas por desafio, HMAC do código com o id, `FOR UPDATE`, substituição do desafio vivo por (e-mail, intenção) e a porta H-015 `auth_code_attempt` (limite por IP, bloqueio progressivo por e-mail). `purpose` é restrito a `login|publish`.
3. A classe de e-mail `auth` já é a de maior prioridade (`CLASS_PRIORITY`: auth 0, lembrete 3) e tem a reserva de cota mais alta; basta o novo `email_type` pertencer a `auth` (D-H014-3).
4. `consume_link` e a etapa `identificacao` existem; **não** existe conversão, guarda de sessão, saída nem step-up. O cookie `__Host-fp_ident` é `SameSite=Strict`, 15 min.

## 1. Conversão da etapa em sessão de 7 dias

### 1.1 Rota e fluxo [PROPOSTA]

`POST /v1/auth/session` (corpo `{}`), cookie `__Host-fp_ident`. Mesmas verificações de cabeçalho de H-012 (`Origin` = `SITE_URL`, `Sec-Fetch-Site`, JSON), sem CORS. A página `/acesso`, ao receber o 200 do consumo, chama esta rota **sem novo clique**. Separar as duas rotas permite repetir a conversão (rede caiu) durante os 15 min da etapa, o que o consumo (uso único) não permite, e cria o ponto de encaixe da regra de nonce/rascunho de H-013 (porta `ConversionGatePort.decide(stage)`, padrão `permitir`; H-013 troca a implementação, H-014 não anexa rascunho).

Resposta única de falha (CA-H014-03/05/06): **401** `{"code":"acesso_expirado"}` (texto: "Peça um novo acesso."), cabeçalhos de H-012 §5, **sem `Set-Cookie`**, para: cookie ausente, hash desconhecido, etapa já convertida, vencida (15 min), revogada, usuário bloqueado. Sucesso: **200** `{"status":"autenticado"}` com dois `Set-Cookie`.

### 1.2 Atomicidade, idempotência e concorrência

Uma única instrução SQL em `private.app_session_convert(p_old_hash, p_new_hash, p_now)`:

```sql
update app.app_session s
   set stage = 'ativa', secret_hash = p_new_hash,
       expires_at = s.absolute_expires_at, recent_auth_at = p_now, auth_method = 'link'
 where s.secret_hash = p_old_hash and s.stage = 'identificacao'
   and s.revoked_at is null and s.expires_at > p_now
   and exists (select 1 from app.app_user u where u.id = s.user_id and u.status = 'ativo')
returning s.id, s.user_id, s.absolute_expires_at, s.purpose, s.draft_id;
```

- Duas conversões simultâneas: a segunda espera o bloqueio da linha, reavalia o `where` com o hash antigo já trocado e devolve zero linhas; exatamente uma sessão (CA-H014-05). Não há segunda linha: a etapa **vira** a sessão (mesmo `sid`).
- **Rotação do segredo e fim do segredo antigo** na mesma instrução (CA-H014-01). O segredo novo (256 bits, base64url) é gerado no servidor antes da chamada; só o hash vai ao banco.
- `recent_auth_at = p_now` (D-H014-1, CA-H014-02). `absolute_expires_at` **não muda**: são 7 dias contados do clique do consumo (CA-H014-01); `Max-Age` do cookie = `absolute_expires_at − agora` (no máximo 604 800).
- O tempo vem de `p_now` do relógio injetado, como nas funções de H-011/H-012. Limite: etapa válida se `agora < expires_at` (no instante exato, vencida).
- Cookies do 200: `__Host-fp_sess=<segredo>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<s>` e `__Host-fp_ident=; Max-Age=0; ...` (apaga a etapa). `Lax` (alinhado a 33 §5.1 e S-01 §8) porque o cliente chega por links de e-mail; a proteção contra POST de outro site fica em `Origin`/`Sec-Fetch-Site` em toda rota que muda estado, e o JSON-only.
- Perda da resposta depois do commit: o cliente fica sem cookie e a etapa já virou sessão; pede novo acesso (risco R-2).

### 1.3 Colunas e restrições novas (migração `20261111180000_identity_create_active_session.sql` + rollback, idempotente)

| Mudança | Regra |
|---|---|
| `recent_auth_at timestamptz` | nulo na etapa; obrigatório em `ativa` |
| `auth_method text` | `link` (padrão) \| `password` (H-016 grava `password`); define o método de prova do step-up (§4) |
| índice único `app_session_secret_hash_uidx` em `secret_hash` | a busca por requisição usa este índice |
| CHECK `app_session_ativa_consistente` | `stage <> 'ativa' or (recent_auth_at is not null and expires_at = absolute_expires_at)` |
| `auth_challenge`: CHECK de `purpose` aceita `step_up`; coluna `session_id uuid` | `purpose = 'step_up'` ⇔ `session_id` preenchido |

Funções `private.*` (`search_path=''`, `execute` só a `app_system`, mesma postura de H-012): `app_session_convert`, `app_session_get`, `app_session_revoke`, `app_session_revoke_all`, `app_session_mark_recent_auth`, `step_up_request`, `step_up_verify`. Nenhuma função devolve ou aceita segredo em claro, só hash.

### 1.4 Sem emissão de sessão do Supabase na conversão [PROPOSTA; ajusta 46 §3]

46 §3 previa `generateLink` + `verifyOtp` na conversão. **Fica fora**: uma chamada de rede ao Auth não cabe dentro da instrução atômica, e a prova S-01 (D1, passos 2 a 6) **ainda não foi executada**. Autoridade da API = cookie opaco + linha do banco (§2), que não depende do Supabase. O JWT do Supabase (Realtime/Storage privados) será emitido **sob demanda** por uma rota da história que primeiro precisar dele, com porta `SupabaseSessionPort.issue(sid)` que confere a sessão no banco antes de chamar `generateLink`/`verifyOtp`. Efeito: H-014 não bloqueia por S-01; `auth_session_id` e o gancho de `token_refresh` (S-01 §5) entram com essa história. Ver dúvida D-H014-6.

## 2. Regra de sessão (401 lida do banco)

`SessionGuard.authenticate(cookies, nowMs)` roda no início de **toda** rota de recurso:

1. Lê só `__Host-fp_sess` (o cookie `fp_ident` nunca é aceito: R-7 de 46, CA-H014-06).
2. `hash = SHA-256(segredo)`; **uma** chamada `private.app_session_get(hash, now)`:
   `where secret_hash = hash and stage = 'ativa' and revoked_at is null and expires_at > now and absolute_expires_at > now and exists (user ativo)`; devolve `sid, user_id, recent_auth_at, auth_method`.
3. Qualquer falha (sem cookie, segredo desconhecido, etapa, revogada, vencida, usuário bloqueado) → **401** `{"code":"nao_autenticado"}`, mesmos cabeçalhos, mesmo corpo byte a byte, e `Set-Cookie: __Host-fp_sess=; Max-Age=0` para limpar o navegador (CA-H014-07/08).

- **Estado do banco, nunca de token** (CA-H014-07). **Sem renovação deslizante**: nenhuma rota escreve `expires_at`; a única escrita de uso é `recent_auth_at` no step-up (CA-H014-04). No instante `expires_at` exato: 401.
- Uma consulta por índice único por requisição; nenhum cache de sessão no processo (cache reabriria a janela de revogação). Custo aceito no volume do MVP.
- Ordem de guardas em rota crítica: autenticação → step-up (§4) → posse/política do recurso (404 para outro principal). O step-up é independente do recurso, então não cria oráculo.

## 3. Sair e sair de todos

- `POST /v1/auth/logout` (204): lê o cookie; se a sessão for ativa, `app_session_revoke(sid, now)` (`revoked_at = coalesce(revoked_at, now)`); **sempre** 204 e cookie apagado, mesmo com cookie inválido (idempotente, sem oráculo). Outras sessões da pessoa não mudam (CA-H014-09).
- `POST /v1/auth/logout-all` (204): exige sessão válida (senão 401). `app_session_revoke_all(user_id, now)` revoga **todas** as linhas não revogadas do usuário (`ativa` e `identificacao`), inclusive a atual, e apaga o cookie (CA-H014-10). Corridas: conversão concorrente e `revoke_all` disputam a mesma linha; nas duas ordens o resultado é "revogada", nunca uma sessão viva depois do 204.
- Um novo acesso por link **não** revoga nada (D-H014-2, CA-H014-11); 08 §5.1 item 6 já foi ajustado.
- Ambas exigem `Origin` válido (mesmo conferidor de H-012). Quando houver `auth_session_id` (história futura), `signOut` do Supabase é feito depois, melhor esforço, fora da transação; a revogação no banco é o que vale.
- Dados de negócio não mudam com saída ou vencimento (S-01 D7); só `app_session`.

## 4. Step-up (janela de 30 min)

### 4.1 Guarda e lista de ações críticas

- Constante única `CRITICAL_ACTIONS` em `packages/domain/src/identity/step-up.ts`: `cancelar`, `concluir`, `corrigir_conclusao`, `compartilhar_contato`, `revogar_contato`, `selecionar`, `trocar_selecionado` (08 §5.4; D-H014-5). Sem exceção por tela.
- `requireRecentAuth(session, nowMs)` (função pura): válido se `recent_auth_at` existe e `agora − recent_auth_at ≤ 1800 s` (no limite exato, vale; 1 s depois, não). Senão **401** `{"code":"step_up_required","method":"code"|"password"}` (sempre 401, nunca 403/404: CA-H014-12/17), nada é alterado, sem `Set-Cookie`. `method` vem de `auth_method` (§4.2) para a interface saber qual prova pedir.
- A janela **não desliza**: só uma prova bem-sucedida escreve `recent_auth_at`; a atividade comum não (CA-H014-15). `recent_auth_at` só avança (`greatest`).
- Cada história dona (H-074, H-076, H-077, H-078, H-079, H-112) chama o guarda; a matriz de rotas (`packages/access-matrix`) marca a rota como crítica e um teste de matriz falha se uma rota crítica não usar o guarda.

### 4.2 Um contrato, dois métodos de prova (D-H014-5)

| Rota | Corpo | Sucesso | Falhas |
|---|---|---|---|
| `POST /v1/auth/step-up/challenge` (só método `code`) | `{}` | 202 `{"status":"enviado"}` | 401 (sessão), 422 `metodo_invalido` (sessão com `auth_method='password'`), 429 H-015 |
| `POST /v1/auth/step-up` | `{"method":"code","code":"123456"}` **ou** `{"method":"password","password":"…"}`; chaves exatas | 204; `recent_auth_at = agora`, mesmo `sid`, mesmo `expires_at` | 401 (sessão), 422 `metodo_invalido` (método diferente do da sessão) ou `codigo_invalido`, 401 `invalid_credentials` (senha, H-016), 429 |

- **Método = `app_session.auth_method`**: sessão aberta por link usa `code` (cliente); sessão aberta por senha (H-016 grava `password`) usa `password`. Quem tem as duas funções prova pelo método com que entrou. O método da requisição é conferido contra o da sessão; nunca é escolha do chamador.
- **Porta `StepUpProofPort`** com duas implementações: `CodeProof` (H-014, abaixo) e `PasswordProof` (H-016, mesmo caminho e **mesmo limite** do login, 33 §6.2). Ambas terminam em `private.app_session_mark_recent_auth(sid, now)` (`update ... where id = sid and stage = 'ativa' and revoked_at is null and expires_at > now`). H-014 entrega o contrato, a rota, o guarda e `CodeProof`; H-016 acrescenta `PasswordProof` sem rota nova (a rota `POST /v1/auth/step-up {password}` de 33 §6.2 passa a ser este contrato com `method:"password"`).

### 4.3 Código por e-mail (D-H014-3)

Reaproveita `auth_challenge` com `purpose='step_up'` ligado à sessão (`session_id`), para herdar 6 dígitos, 15 min, uso único, 5 tentativas, substituição do desafio vivo, limites H-011/H-015 e bloqueio progressivo por e-mail.

- **Pedido** (`private.step_up_request`, uma transação): confere sessão ativa e `auth_method='link'`; chama o mesmo caminho de H-015 (`auth_challenge_request`) com `purpose='step_up'`, `session_id` e **token aleatório descartado** (nunca enviado; ninguém o possui, então `consume_link` não consegue consumir esse desafio, e a função ganha guarda explícita `purpose <> 'step_up'`). `auth_challenge_create` passa a aceitar `step_up` e a gravar a saída de e-mail com `email_type='acesso_stepup'` (novo, categoria `acesso`, classe **`auth`**, param `challenge_ref`) no lugar de `acesso_login`. A prioridade acima de lembretes (D-H014-3) vem da classe `auth` já existente; não há regra nova de ordem.
- **E-mail:** `ChallengeEmailProvider` e o diretório de destinatário tratam `acesso_stepup` (só o código e os minutos, **sem link**). Em desenvolvimento o envio segue a regra do projeto (e-mail desligado/simulado; nenhum envio real em teste).
- **Verificação** (`private.step_up_verify`, uma transação): lê a sessão (`app_session_get`); localiza o desafio vivo `(email_hash, 'step_up')` e exige `c.session_id = sid` (senão trata como sem desafio, mesmo caminho e mesma contagem de erro); chama `auth_code_attempt` (H-015: bloqueio de e-mail, limite por IP, 5 erros invalidam); **se `ok`, na mesma transação** chama `app_session_mark_recent_auth`. Código certo nunca deixa o desafio gasto sem `recent_auth_at` (atomicidade). 5º erro: desafio invalidado, `recent_auth_at` intacto, ação continua negada (CA-H014-16). Respostas iguais às de H-013 (`codigo_invalido` 422 para errado e inválido; 429 `muitas_tentativas`).
- O e-mail do destinatário vem de `app_user.email` da sessão e é cifrado no desafio como em H-011; o código e o e-mail nunca aparecem em log.
- Um novo pedido substitui o código vivo do mesmo usuário (inclusive de outra sessão dele): aceito.

### 4.4 Tela do código (D-H014-4)

Entra com a primeira história que chama o guarda (H-074 ou H-077), seguindo o EDS. O contrato desta história (§4.2) é o que ela consome.

## 5. Testes para o DEV (sem rede, sem envio real)

Setup bloqueia `fetch` e sockets (como T-H012-30). Provedor de e-mail e `PasswordProof` simulados. `FakeClock`. E-mails `@example.test`. Sentinelas de e-mail, código, segredo de cookie e token procuradas em todo log, erro, corpo de resposta e linha capturados. Banco: **apenas o banco de desenvolvimento**, funções `private.*` via `app_system`, usuários sintéticos, dados removidos ao fim.

**Unidade / manipulador (Vitest, repositório em memória)**
- T-H014-01 conversão: etapa válida → `ativa`, `expires_at = absolute_expires_at`, `recent_auth_at = agora`, mesmo `sid`; cookie novo `Max-Age = absolute − agora`; `fp_ident` apagado; hash novo ≠ antigo; segredo antigo não vale mais (CA-01/02).
- T-H014-02 conversão negada, **mesma resposta byte a byte e sem `Set-Cookie`**: sem cookie, desconhecido, já convertida, vencida em `expires_at` exato e +1 s, revogada, usuário bloqueado; zero sessão criada (CA-03). Retentativa dentro de 15 min após falha de rede antes do commit funciona.
- T-H014-03 guarda: 401 uniforme para etapa `identificacao` (vencida ou não), revogada, `expires_at` exato (7 d) e 7 d + 1 s, `7 d − 1 s` serve; uso intenso nunca adia `expires_at` (CA-04/06/07/08); estado vem do repositório mesmo com token "válido" fabricado.
- T-H014-04 `requireRecentAuth`: 30 min exato passa; 30 min + 1 s → 401 `step_up_required` com `method`; nulo → 401; ação crítica negada não altera nada; atividade comum não renova; resposta é sempre 401, nunca 403/404 (CA-12/15/17); ordem autenticação → step-up → posse (outro principal sem step-up recebe 401, com step-up recebe 404).
- T-H014-05 `CRITICAL_ACTIONS` é a lista de 08 §5.4 com selecionar/trocar; teste de matriz: toda rota marcada crítica passa pelo guarda.
- T-H014-06 logout: revoga só a atual, 204 e cookie apagado; com cookie inválido também 204; a mesma credencial depois dá 401 (CA-09). Logout-all: 3 sessões → todas revogadas, inclusive a atual (CA-10).
- T-H014-07 novo acesso por link com sessão existente: a anterior continua válida (CA-11).
- T-H014-08 contrato do step-up: corpo com chaves exatas por método; método diferente do da sessão → 422; `PasswordProof` simulado grava `recent_auth_at` sem mudar `sid` nem `expires_at`.
- T-H014-09 `acesso_stepup`: classe `auth`, param `challenge_ref`, sem `email` no payload; com fila mista (lembrete mais antigo + step-up), o step-up é reivindicado primeiro.
- T-H014-10 logs/erros/corpos: nenhum segredo de cookie, hash, código, e-mail ou token.

**Banco de desenvolvimento (`*.dbtest.mjs`, várias conexões)**
- T-H014-20 20 conversões simultâneas da mesma etapa → exatamente 1 sucesso, 19 negadas, 1 linha (CA-05).
- T-H014-21 conversão × `logout-all` simultâneos, 50 rodadas: nunca fica sessão `ativa` não revogada após o logout; se a conversão ganhou, a sessão termina revogada.
- T-H014-22 restrições: `ativa` sem `recent_auth_at` falha; `expires_at <> absolute_expires_at` em `ativa` falha; `secret_hash` único; `auth_method` fora do conjunto falha; migração e rollback repetíveis; RLS forçada e nenhum acesso de `anon/authenticated/service_role/app_api`; `app_system` só por função.
- T-H014-23 `app_session_get`: relógio de 7 d − 1 s, = 7 d, + 1 s; revogada; usuário `bloqueado` (sai do guarda sem outra ação).
- T-H014-24 step-up por código: pedido cria 1 desafio `step_up` ligado ao `sid` e 1 saída `auth` sem endereço em claro; segundo pedido substitui o primeiro; código certo → `recent_auth_at = now` e desafio consumido **na mesma transação** (injetar falha no meio: nenhum dos dois efeitos fica); 5 erros → invalidado, `recent_auth_at` intacto; desafio de outra sessão do mesmo usuário → `codigo_invalido` e conta erro; 20 confirmações simultâneas do código certo → 1 sucesso; sessão revogada no meio → negado.
- T-H014-25 `consume_link` com `purpose='step_up'` → `invalido` sem consumir; limites H-015 (60 s, 5/h, bloqueio por e-mail) valem para `step_up`; varredura `to_jsonb(row)::text` não encontra e-mail em claro em `app_session`, `auth_challenge`, `outbox_event`, `job`.
- T-H014-26 matriz de papéis/privilégios por concessão (como T-H015) nas 7 funções novas.

Evidência: `corepack pnpm check:all` local; registrar comando, contagem e código de saída na Issue.

### 5.1 Arquivos esperados (para o DEV)

`packages/domain/src/identity/session.ts` (constantes `SESSION_COOKIE_NAME`, `STEP_UP_WINDOW_SECONDS=1800`, cookies, decisão pura de sessão, corpos 401, `ConversionGatePort`, `SessionRepository`); `step-up.ts` (`CRITICAL_ACTIONS`, `requireRecentAuth`, corpo do contrato, `StepUpProofPort`); `packages/db/src/session.ts` (repositório Pg, `convertStage`, `authenticate`, `logout`, `logoutAll`, `requestStepUp`, `confirmStepUp`); extensão de `challenges.ts` (`acesso_stepup` no provedor de e-mail); `notifications/policy.ts` (`acesso_stepup`); migração + rollback; rotas na API e atualização da página `/acesso` (chamar a conversão após o 200); conferir em `packages/observability/src/redact.ts` que `code`, `secret`/`segredo` e `sid` também são mascarados como chave (hoje `token`, `senha`, `password`, `segredo` constam; `code` só em formato `code=`). Ordem: domínio puro e T-01..05; migração e T-20..23; store e conversão; logout; step-up e T-24..26; página.

## 6. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Rota de recurso aceita por engano a etapa `identificacao` ou esquece o guarda. | Um só `SessionGuard` que só lê `fp_sess` e só `stage='ativa'`; teste de matriz de rotas; T-03. |
| R-2 | Resposta da conversão se perde depois do commit: cliente sem cookie e etapa já gasta. | Raro; pede novo acesso (limites H-011). Alternativa rejeitada: reemitir cookie por segundo clique (reabre uso do mesmo segredo). |
| R-3 | Janela de revogação: ação crítica checada no início da requisição. | Diferença de milissegundos; `recent_auth_at` só avança; aceito. Cache de sessão proibido. |
| R-4 | Step-up por código consome a cota de e-mail `auth` (teto global diário 80 de H-015, 100/dia do Resend). | Mesmos limites de H-015 e a janela de 30 min reduzem pedidos; métrica de uso; alerta de cota de H-092. |
| R-5 | Dois dispositivos do mesmo usuário pedem step-up e um substitui o código do outro. | Aceito, raro; a interface orienta "use o último e-mail". |
| R-6 | `SameSite=Lax` abre uma superfície que `Strict` fechava. | `Origin`/`Sec-Fetch-Site` e JSON-only em toda rota que muda estado; GET sem efeito; `__Host-`. |
| R-7 | Sessão do Supabase (Realtime) não prova S-01 e depende de `verifyOtp`. | Fora desta história (§1.4); porta definida; prova em usuário sintético na história que precisar. |
| R-8 | Usuário com as duas funções entra por link e quer ação de profissional que pede senha. | Método segue a sessão; para outro método, sair e entrar de novo. Revisar com H-016 se incomodar. |
| R-9 | Tabela `app_session` cresce com sessões vencidas e revogadas. | Expurgo é de H-110; índice em `expires_at` já existe. |

## 7. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-H014-6 Sem emissão da sessão do Supabase na conversão** (§1.4): autoridade da API é o cookie opaco; o JWT do Supabase nasce sob demanda na história que precisar de Realtime/Storage. *Recomendação: aceitar; ajustar 46 §3 e S-01 §8 (a H-014 não faz `generateLink`/`verifyOtp`).*
2. **D-H014-7 Cookie de sessão `SameSite=Lax`** (a etapa fica `Strict`), por links de e-mail e alinhamento a 33 §5.1. *Recomendação: aceitar.*
3. **D-H014-8 Duas rotas (`/v1/auth/session` para converter e `/v1/auth/step-up`) e H-016** troca o `POST /v1/auth/step-up {password}` por `{method:"password", password}`; H-016 grava `auth_method='password'`. *Recomendação: aceitar e registrar o critério em H-016 (DD-5).*

## Resumo em linguagem simples

Depois de confirmar o acesso, a pessoa ganha 7 dias de entrada que não se renovam sozinhos; ela pode sair deste aparelho ou de todos, e o sistema confere a cada pedido se a entrada ainda vale. Para ações importantes, se a última confirmação passou de 30 minutos, o sistema pede um código novo por e-mail (para o profissional, a senha).
Os testes usam serviços de mentira e o banco de desenvolvimento, sem enviar e-mail de verdade; faltam três aprovações pequenas.
