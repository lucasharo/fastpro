# Desenho H-012 — Consumo do link por POST (Issue #25, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§8).
- **Rastro:** 45-REFINO-H012 (CA-H012-01..11); decisões D-H012-1 e D-H012-2 do Orquestrador; 39-DESENHO-H011 (DD-6, DD-7, §2.1, R-8, R-9); 08 §5.1; 10 ADR-005; 33-DESENHO-H016 (DD-2, §app_user); S-01-RESULTADO (§5, §7); código lido (somente leitura): `packages/db/src/challenges.ts`, `packages/domain/src/identity/challenge.ts`, migração `20261111140000_identity_create_auth_challenge.sql`.
- **Natureza:** documento, mais o ajuste de texto do ADR-005 (§9). Nenhum código, migração, teste, chave, conta ou e-mail foi criado.
- **Etiquetas:** `[DECIDIDO]` decisão do Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento.

## 0. Fatos do repositório [VERIFICADO]

1. `private.auth_challenge_consume_link(p_token_hash, p_now)` já existe: trava a linha (`FOR UPDATE`), consome uma só vez, **apaga `email_enc` na mesma instrução** e devolve `(resultado, challenge_id, purpose, email_enc, draft_id)`. Não encontrado, usado, invalidado e expirado devolvem o mesmo `invalido`.
2. Faltam: `app.app_user`, `app.app_session`, porta de usuário do Auth, rota HTTP e página. O link do e-mail é `${SITE_URL}/acesso#t=<token>` (token = 32 bytes em base64url, 43 caracteres).
3. `apps/api` (`app.ts`, `vercel.ts`) e `apps/web` (`src/index.ts`) são esqueletos; não há convenção de rota ainda além do desenho 08.

## 1. Fluxo: GET sem efeito, POST com consumo único

```
E-mail ──> GET /acesso#t=TOKEN   (o servidor vê só "/acesso"; o fragmento não sai do navegador)
             página estática igual para qualquer token; JS lê o fragmento, troca a URL
             por "/acesso" (history.replaceState), guarda o token só na memória do script
             botão "Confirmar acesso"  ──clique──>  POST /v1/auth/challenges/consume
                                                    {"token":"<43 chars>"}
```

- **GET (CA-H012-01..03).** A página é estática e **idêntica para qualquer token**: não consulta a API, não carrega script de terceiros (script de terceiros leria o fragmento), não mostra estado do link. O script **nunca** chama a API ao carregar; o único gatilho é o clique (CA-H012-02). Token ausente no fragmento (recarregou a página depois de limpar a URL) mostra o texto de CA-H012-07, sem chamada. O token não vai para `localStorage`, `sessionStorage` nem cookie.
- **Leitor que executa script (dúvida 3 do PO).** Sem clique não há POST. Risco residual: leitor que clica sozinho no botão (QA cobre com teste de leitura sem clique). Mitigação extra [PROPOSTA]: o botão só habilita depois de 1 s com a página visível (barato, reduz clique automático; não é controle de segurança).
- **POST** `/v1/auth/challenges/consume`, corpo JSON `{"token": string}` **e nada mais**.
  1. Cabeçalhos antes de ler o corpo: `Content-Type: application/json` (senão 415) e `Origin` igual à origem de `SITE_URL` (senão 403 `origem_invalida`, **sem consumir**); `Sec-Fetch-Site`, quando presente, deve ser `same-origin`. Sem CORS (nenhum `Access-Control-Allow-*`).
  2. Corpo ≤ 1 KiB e chaves exatamente `{token}`. Qualquer outra chave (inclusive `code`, `email`) ou `token` que não seja texto de até 512 caracteres → **422** `{"code":"pedido_invalido"}`, sem consumir e sem sessão (CA-H012-09).
  3. `token_hash = SHA-256(token)` calculado **para qualquer texto** (formato errado não desvia o caminho) e **uma** chamada a `auth_challenge_consume_link` (CA-H012-06/08). A exclusividade vem do `FOR UPDATE` já testado em T-H011-23: 20 POSTs simultâneos → 1 `ok`.
  4. `invalido` → resposta uniforme (§2). `ok` → decifrar `email_enc` (AAD `email_enc`) → criar/vincular a conta (§4) → abrir a etapa de identificação (§3) → **200** `{"status":"identificado"}` com `Set-Cookie` da etapa.
- **Ordem fixa e consumo primeiro.** O consumo precede a criação da conta, não o contrário: só assim o uso único é garantido pelo banco. O custo é a falha do §4.

## 2. Resposta uniforme para link inválido

- Único resultado para inexistente, adulterado, malformado, usado, expirado, substituído ou invalidado: **400** `{"code":"link_invalido"}` com os mesmos cabeçalhos (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`), **sem `Set-Cookie`**, sem `Retry-After`. Texto da página [PROPOSTA]: "Este link não pode mais ser usado. Peça um novo acesso." (não diz se foi usado, expirado ou inexistente, nem se o e-mail existe).
- Os motivos reais (`usado`, `expirado`, ...) **não** são distinguíveis pelo manipulador: a função só devolve `invalido`; métrica de motivo, se desejada, nasce no banco sem PII (como em 39 DD-7).
- **Uniformidade medida entre os casos inválidos**, não entre inválido e válido. Quem tem um token válido (256 bits) já controla o e-mail; diferença de tempo entre válido e inválido não é oráculo útil. Nota: o ramo `expirado` do SQL faz um `UPDATE` a mais; é interno ao banco, indistinguível pelo cliente; o teste de aceite é "uma chamada ao repositório, mesma resposta byte a byte".
- Casos que **não** são `link_invalido`: 403/415/422 (forma do pedido, antes de qualquer consumo; não dependem do estado do link) e 503 (§4).
- Conta bloqueada ou administrativa (§4) também devolve `link_invalido`, sem sessão.

## 3. A etapa de identificação e o que a H-014 converte [DECIDIDO D-H012-1]

O POST **não** cria a sessão de 7 dias. Abre uma **etapa de identificação** de curta duração: prova que o navegador que clicou controla o e-mail, mas não autoriza nada.

**Tabela `app.app_session`** (criada aqui com o mínimo, `create table if not exists`, como a H-016 prevê; H-014 a estende). RLS habilitada e forçada, sem políticas, `revoke all` de `public/anon/authenticated/service_role`, acesso só por funções `private.*` a `app_system`.

| Coluna | Regra |
|---|---|
| `id` (sid) | uuid pk |
| `user_id` | uuid, `app_user.id` |
| `stage` | `identificacao` \| `ativa`; H-012 só grava `identificacao` |
| `secret_hash` | text 64 hex; SHA-256 do segredo do cookie (256 bits aleatórios); o valor nunca fica no banco |
| `challenge_id` | uuid **único** (uma etapa por desafio consumido); vem de `consume_link` |
| `purpose`, `draft_id` | copiados do desafio; `draft_id` só guardado, sem decidir anexação (H-013) |
| `created_at` | tempo do banco |
| `expires_at` | `created_at + 15 min` na etapa (`CHALLENGE_TTL_SECONDS`) `[PROPOSTA]` |
| `absolute_expires_at` | `created_at + 7 dias` (teto absoluto, 08 §5.1 item 6) |
| `revoked_at` | null |

- **Cookie:** `__Host-fp_ident=<segredo>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`. Sem `Domain`. O segredo é independente do token do e-mail (o token já foi gasto). Em desenvolvimento por http, `localhost` aceita `Secure`.
- **O que a etapa permite:** somente as rotas de H-013 (código/nonce/anexar rascunho) e H-014 (converter). **Nenhuma** rota de recurso aceita `stage != 'ativa'`; o guarda da API trata a etapa como não autenticada.
- **O que a H-014 converte** [PROPOSTA, H-014 pode ajustar]: em uma transação, `stage='ativa'`, `expires_at = absolute_expires_at` (7 dias contados do clique), troca do segredo do cookie (rotação), preenchimento de `auth_session_id` e emissão da sessão Supabase (`generateLink` + `verifyOtp`, S-01 §5), aplicando as regras de nonce/rascunho da H-013. **Consequência para o S-01:** o item "H-012 obtém a sessão via `verifyOtp`" passa à H-014; a H-012 não chama `generateLink` nem `verifyOtp` (teste T-H012-33). Etapa vencida (15 min) ou revogada não converte: o cliente pede novo acesso.
- Limpeza: linhas `identificacao` vencidas somem no expurgo diário já existente (acrescentar à função `auth_challenge_purge` ou job irmão).

## 4. Criação da conta e falha de criação [DECIDIDO D-H012-2]

A conta do cliente nasce no POST, **depois** do consumo, com o e-mail decifrado (nunca registrado). Porta `CustomerAccountPort.ensureCustomer(email): {userId} | {erro}` (implementação real chama o Auth admin; teste usa provedor simulado):

1. Procurar `app_user` pelo e-mail normalizado. Existe e `status='ativo'` e sem `admin_staff` → devolve o `id` (cliente, profissional ou ambos, 08 §5.2). Bloqueado ou administrativo → `link_invalido` (§2), sem sessão.
2. Não existe: `admin.createUser({email, email_confirm:true})` e `private.app_user_ensure(email, auth_user_id, now)` com `insert ... on conflict (email) do nothing` + releitura, idempotente. Se o Auth responder "e-mail já existe" (corrida entre os dois desafios `login` e `publish`, ou usuário órfão), localizar o usuário do Auth pelo e-mail e vincular `[NÃO VERIFICADO: forma de busca por e-mail na API admin; provar em desenvolvimento com usuário sintético, S-01 §7]`.
3. **Não tocar em `email_verified_at` de usuário existente.** Em usuário novo grava `email_verified_at = now` (não há senha, o link prova o e-mail). Motivo (R-3): quem pré-cadastra um profissional com o e-mail da vítima não ganha "e-mail verificado" só porque a vítima usou um link de cliente.
4. A criação tem orçamento de 8 s e até **2 tentativas** na requisição (só erro de rede/5xx/429; a operação é idempotente). Esgotado: **503** `{"code":"acesso_indisponivel"}` com o mesmo texto de orientação ("peça um novo acesso"), cabeçalhos §5, sem cookie.

**Falha de criação.** O link já consumido **não é restaurado** (aceito). Efeito: o cliente vê 503, pede novo acesso e passa pelos limites de H-011 (60 s, 5/h; o pedido anterior já saiu da contagem de intervalo, mas ainda conta na hora). Erros (decifra, conta, etapa) viram códigos fixos `consumo_falha_decifra | consumo_falha_conta | consumo_falha_etapa` em métrica sem PII; nenhum log com e-mail, token ou segredo. Usuário criado no Auth e sem `app_user` (órfão) é reaproveitado pelo passo 2 na próxima vez; a conciliação periódica de órfãos fica com H-016 (R-6).

## 5. Cabeçalhos e proteção do token

| Onde | Cabeçalhos |
|---|---|
| GET `/acesso` (página) | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY` (impede clique induzido por moldura sobre o botão) |
| POST (todas as respostas) | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; `Set-Cookie` só no 200 |

- **Token:** viaja só no corpo do POST (nunca em URL, query ou cabeçalho). O servidor da página só vê `/acesso`. Corpo da requisição **não é registrado**; a lista de campos proibidos em log (`@fastpro/observability`) ganha `token`. O objeto de erro e a exceção nunca carregam o token (códigos fixos). Hash SHA-256 é calculado e o texto original descartado.
- **Login induzido (CSRF) e moldura:** `Origin`/`Sec-Fetch-Site` e JSON-only impedem POST de outro site; `frame-ancestors 'none'` impede a moldura. Fica o caso inerente de magic link (atacante entrega **o próprio** link à vítima): tratado por nonce/anexação em H-013 e é limitação aceita em 08 §5.1 item 5.
- **Topologia (R-5):** o cookie é do host que serve o site. API e web devem responder na **mesma origem** (reescrita `/v1/*` do site para a API) para que o `__Host-` funcione `[NÃO VERIFICADO: implantação Vercel de web e API são projetos separados]`.
- **Limites por IP/global:** H-015. Aqui o token de 256 bits torna adivinhação inviável; o risco restante é custo (banco/Auth) por POSTs inválidos, e o caminho inválido faz só 1 consulta de índice.

## 6. Testes para o DEV (provedor simulado, sem rede)

Setup bloqueia `fetch`/sockets (como T-H92-39). `CustomerAccountPort` simulado (nunca o Auth real); sem envio de e-mail. Sentinelas de e-mail e token procurados em todo log/erro/linha capturados. E-mails `@example.test`.

**Unidade / manipulador (Vitest, repositório e porta em memória, `FakeClock`)**
- T-H012-01 forma do pedido: chaves extras (`code`, `email`), sem `token`, `token` não-texto, corpo > 1 KiB → 422; consumo **não** chamado; zero sessão (CA-H012-09). `{token:"123456"}` → `link_invalido` (token malformado).
- T-H012-02 `Origin` de outro site, `Origin` ausente com `Sec-Fetch-Site: cross-site`, `Content-Type` diferente → 403/415 sem consumir.
- T-H012-03 inexistente, adulterado, malformado, usado, expirado (15 min + 1 s) e substituído: **mesmo** status, corpo e cabeçalhos byte a byte, sem `Set-Cookie`, **uma** chamada ao repositório, zero chamadas à porta de conta (CA-H012-05..07).
- T-H012-04 válido: 200 `{"status":"identificado"}`, `Set-Cookie` com `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900` e sem `Domain`; o valor do cookie **não** é derivado do token; banco guarda só `secret_hash`.
- T-H012-05 conta: e-mail novo → `createUser` uma vez, `app_user` criado, `email_verified_at` preenchido; e-mail existente → nenhum `createUser`, `email_verified_at` **inalterado** (R-3); `bloqueado`/administrativo → `link_invalido`, sem etapa.
- T-H012-06 falha da conta (erro, tempo esgotado, 429 simulados): até 2 tentativas, depois 503 `acesso_indisponivel`; o desafio **permanece consumido**; sem cookie; nenhuma exceção com e-mail/token (CA-H012-11; D-H012-2).
- T-H012-07 falha na abertura da etapa (conta ok): 503, link não restaurado, conta reaproveitada na reemissão (idempotência).
- T-H012-08 concorrência no manipulador (20 POSTs do mesmo token, repositório com trava): 1 resposta 200, 19 iguais ao inválido; 1 etapa; 1 `createUser` (CA-H012-08).
- T-H012-09 cabeçalhos §5 presentes em 200, 400, 403, 415, 422 e 503 (CA-H012-10).
- T-H012-10 logs/erros capturados: sem token, e-mail ou segredo do cookie em nenhum nível (CA-H012-11).

**Banco (`*.dbtest.mjs`, banco de desenvolvimento, várias conexões)**
- T-H012-20 `app_session`: RLS forçada, sem acesso de `anon/authenticated/service_role/app_api`; `app_system` só por função; `challenge_id` único impede segunda etapa do mesmo desafio.
- T-H012-21 `app_user_ensure` idempotente: 20 chamadas concorrentes com o mesmo e-mail → 1 linha; `auth_user_id` único; não altera `email_verified_at` existente.
- T-H012-22 varredura de todas as colunas e linhas (`to_jsonb(row)::text`) após um consumo completo: nenhum sentinela de e-mail em claro em `app_session`, `auth_challenge`, `job`, `outbox_event` (apenas `app_user.email`, que é o dado canônico, 09 §3.1).
- T-H012-23 20 consumos simultâneos do mesmo token pelo repositório Pg real → exatamente 1 `ok` (reforço de T-H011-23 na camada nova).

**Página (Vitest com DOM simulado ou teste de componente, sem rede)**
- T-H012-30 abrir a página (com e sem fragmento) **não** chama `fetch`; o fragmento sai da URL (`replaceState`); nenhum `localStorage`/`sessionStorage`/`document.cookie` é escrito (CA-H012-02/03).
- T-H012-31 clique chama `fetch` uma vez com `{token}` e mais nada; duplo clique não envia duas vezes; o texto exibido para 400 e 503 é o previsto.
- T-H012-32 o GET da rota devolve o mesmo corpo e cabeçalhos §5 para qualquer entrada (inclusive com `?t=` no caminho) e não consulta API (CA-H012-01).
- T-H012-33 contador: o consumo **não** chama `generateLink`/`verifyOtp` (só H-014).
- T-H012-34 Nenhum teste faz chamada de rede e nenhum usa chave real. Leitura sem clique (QA): carregar a página com script ativo não gera POST.

Evidência: `corepack pnpm check:all` local; registrar comando, contagem e código de saída na Issue.

### 6.1 Arquivos esperados (para o DEV)

`packages/domain/src/identity/` (`consume.ts`: validação do corpo, constantes de cabeçalho/cookie, portas `CustomerAccountPort`, `SessionStageStore`); `packages/db/src/challenge-consume.ts` (store Pg de `consume_link`, etapa e `app_user_ensure`; manipulador `consumeChallenge`); migração `AAAAMMDDHHMMSS_identity_create_session_stage.sql` + rollback (`app_user` e `app_session` com `create table if not exists`, funções `private.app_user_ensure`, `private.app_session_open_stage`, expurgo); rota na API e página `/acesso` no web; `token` na lista de campos proibidos de log; `.env.example` já tem `SITE_URL`.

## 7. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Consumo e falha de criação deixam o cliente sem acesso e com link gasto (D-H012-2). | Aceito; retentativa idempotente (2×), 503 claro, reemissão normal; métrica de falha pós-consumo. |
| R-2 | Leitor de e-mail que roda script e clica sozinho consome o link do cliente. | Sem POST sem clique; botão habilitado após 1 s; QA testa. Residual aceito (08 §5.1 item 3). |
| R-3 | **Pré-sequestro de conta:** atacante cadastra profissional com o e-mail da vítima (não verificado) e depois a vítima usa o link de cliente. | H-012 não altera `email_verified_at` de usuário existente; H-016 deve exigir verificação antes de a senha valer e, na criação de profissional sobre `app_user` já existente, não herdar verificação. Critério a acrescentar a H-016 (dúvida 4). |
| R-4 | Login induzido: atacante entrega o próprio link à vítima. | Inerente a magic link; nonce/anexação em H-013; teto de dano = sessão do atacante na conta do atacante (08 §5.1 item 5). |
| R-5 | Cookie `__Host-` e origem: API e web em origens diferentes quebram o cookie. | Mesma origem por reescrita; prova na implantação de desenvolvimento; senão cookie na origem da API e página chamando por reescrita. |
| R-6 | Usuário órfão no Auth (criado e `app_user` não gravado) ou busca por e-mail no Auth indisponível. | `app_user_ensure` idempotente; prova da busca com usuário sintético (S-01 §7); conciliação em H-016. |
| R-7 | Etapa de identificação mal tratada como sessão por rota futura. | `stage != 'ativa'` = não autenticado por regra do guarda; teste de guarda em H-014; nenhuma rota de recurso aceita o cookie `fp_ident`. |
| R-8 | Corrida entre consumo e invalidação/expiração. | Mesma linha, `FOR UPDATE` (T-H011-23); T-H012-08/23. |
| R-9 | Custo de POSTs inválidos em massa (banco/Auth). | 1 consulta de índice no caminho inválido; limites por IP/global em H-015. |

## 8. Dúvidas ao Orquestrador (não bloqueantes; recomendação em itálico)

1. **D-H012-3 Validade da etapa de identificação:** 15 min fixos contados do clique (PO falou "até o fim da validade do desafio", que já foi gasta em parte). *Recomendação: 15 min fixos.*
2. **D-H012-4 Falha pós-consumo devolve 503 distinto** (e não o `link_invalido`), porque o dono do token merece saber que é falha nossa. *Recomendação: aceitar.*
3. **D-H012-5 Verificação de origem (`Origin`/`Sec-Fetch-Site`) e `frame-ancestors 'none'`** na página e no POST. *Recomendação: aceitar.*
4. **D-H012-6 H-016 ganha critério:** nunca herdar `email_verified_at` de `app_user` criado por link de cliente sem verificar de novo; e o contrário (R-3). *Recomendação: aceitar e acrescentar à descrição de H-016.*
5. **D-H012-7 Documentação:** 09 (`app_session`: `stage`, `challenge_id`, `secret_hash`, `absolute_expires_at`); S-01 §5 (H-012 não faz `verifyOtp`; passa à H-014); 14 (H-014 depende de H-012). *Recomendação: aceitar.*

## 9. Ajuste do ADR-005 (aplicado em `10-ADRS.md`)

Onde dizia que "o consumo é POST; a API cria a sessão (`app_session`, 7 dias absolutos, revogável) e obtém/cria o usuário no Supabase Auth", passa a dizer que o consumo é POST e abre uma **etapa de identificação de curta duração** (cria/vincula o usuário); a **sessão de 7 dias absolutos** é emitida pela conversão da etapa (H-014), depois das regras de H-013.

## 10. Plano de execução para o DEV (ordem sugerida)

1. Domínio puro (validação do corpo, constantes, portas) e T-H012-01..03, 09.
2. Migração + rollback + funções e T-H012-20..23.
3. Store Pg, manipulador e porta de conta; T-H012-04..08, 10.
4. Página `/acesso` e rota; T-H012-30..34.
5. `corepack pnpm check:all` local; evidências na Issue. Fora do escopo: código de 6 dígitos e nonce (H-013), sessão de 7 dias, "sair", step-up (H-014), limites por IP/global (H-015), cadastro profissional (H-016), textos finais (H-094).

## Resumo em linguagem simples

Abrir o link do e-mail não faz nada; só o clique no botão usa o link, uma única vez. Link usado, vencido ou inventado recebe sempre a mesma resposta, e ao confirmar o cliente passa por uma etapa curta de identificação antes de receber o acesso de 7 dias.
A conta nasce nesse clique; se a criação falhar, o link não volta e o cliente pede outro. Os testes usam serviços de mentira, sem rede; faltam só cinco aprovações pequenas.
