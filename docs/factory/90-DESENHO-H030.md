# Desenho H-030 — Tela de pedido, revisão e confirmação expressa (Issue #43, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com uma **condição de início**: a construção espera a #26 (decisão 59). Dúvidas não bloqueantes em §10.
- **Rastro:** 89-REFINO-H030 (CA-01 a CA-14); decisões 59 a 64 (`11-DECISOES.md`, rodada 21; não reabertas); 74-DESENHO-H025 (rascunho, cookie, 404 uniforme); 88-DESENHO-H022 e 68-DESENHO-H021 §3.5 (sem coordenada na revisão); 46-DESENHO-H012 (link por POST, etapa de identificação); 08 §5.1; 11-ARQ §2.2, I-28, T-02; 18-PLANO-QA AX-01 a AX-05, EE-01. Código lido: `apps/api/src/drafts/*`, `packages/domain/src/draft/request-draft.ts` (`draftMissingForReview`), `packages/db/src/request-draft.ts`, migração `20261111440000_draft_create_request_draft.sql`, `apps/web/public/*`, `apps/web/vercel.json`.
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` líder ou dono do produto · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova ou da #26.

## 0. Situação encontrada
1. `[VERIFICADO]` Existem e são reaproveitados: `app.request_draft` (sem `email`, `first_name` nem confirmação), funções `private.draft_get/create/patch/discard` (execute só `app_api`), rotas `POST /v1/drafts` e `GET|PATCH|DELETE /v1/drafts/current` com cookie `__Host-fp_draft`, 404 uniforme (`draftNotFound`), limite de taxa por `rl_check/rl_hit`, `draftMissingForReview` (já lista `first_name` e `email`), componente de busca (`packages/ui/src/service-search`), campo de endereço (`apps/web/public/address-field.js`), CSP reservada para `/pedido` e `/pedido/(.*)` (`script-src 'self'; style-src 'self'`, **sem estilo nem script em linha**).
2. `[VERIFICADO]` `apps/web` é estático (HTML + módulos ES em `public/`, sem framework; `acesso.html` e `acesso.js` são o padrão). `/pedido` ainda não tem página. Não há Playwright no repositório (`[VERIFICADO]` busca em `package.json`).
3. `[VERIFICADO]` Última migração: `20261112120500_geo_expand_match_point.sql`. Os números `20261112120000` e `20261112120500` estão ocupados (a primeira por `media_create_asset_quarantine`).
4. `[NÃO VERIFICADO]` O desenho da #26 (H-013: código de 6 dígitos e nonce, anexação do rascunho) **não existe**. Esta história depende de três coisas dela (§1.1). Por isso a condição de início.

## 1. Princípios
- A confirmação é **um fato do rascunho** (`confirmed_at`), gravado só por um clique explícito, e **vale só para o conteúdo visto** (`content_rev`). Qualquer mudança de conteúdo a desfaz, venha de onde vier (gatilho no banco, não regra de cada rota).
- Posse é só pelo cookie do rascunho. Nenhuma rota nova leva id na URL (`current`).
- Nada publica (CA-07): nenhuma função daqui cria `service_request`, gera ID de pedido, define prazo de aceites ou muda `status`. `status` segue `aberto`.
- Sem coordenada em nenhuma resposta, tela ou log (CA-11): a revisão mostra o texto do endereço.

### 1.1 Contrato exigido da #26 (portão de início) `[NÃO VERIFICADO]`
O DEV só começa depois que a #26 estiver em Aguardando aprovação e confere, por teste de pré-condição (T-PRE), que:
1. `app.request_draft` tem `first_name text`, `email` (normalizado) e `email_verified_at timestamptz`. Nomes de 09; se a #26 usar outros (ex.: `email_enc`), ajustam-se **apenas** `draft_review_get`, `draft_confirm` e o gatilho (§3), e a API decifra como em `consume`.
2. `email_verified_at` só é preenchido quando o consumo do link ocorre com a mesma regra de 08 §5.1 item 5 (mesmo navegador pelo nonce, ou `draft.email == e-mail verificado`). Trocar `email` limpa `email_verified_at` (a #26 deve garantir; o gatilho de §3 desfaz a confirmação de qualquer forma).
3. A requisição de identificação (primeiro nome + e-mail) grava `first_name` e `email` no rascunho do cookie. Se a #26 só tratar o e-mail, o primeiro nome entra na mesma rota dela por esta história (dúvida 1, §10).
4. Depois do consumo do link, a página `/acesso` leva o cliente a `/pedido/revisao` (quando o desafio tem rascunho). Em outro navegador/dispositivo isso não acontece; o navegador de origem descobre por consulta (§5.3).

## 2. API (todas sob `/v1`, sem CORS, `Cache-Control: no-store`, corpo de erro `{ code }` fixo, sem eco da entrada)
Ordem fixa idêntica à de `handleDraftRoute`: Origin e Sec-Fetch-Site → Content-Type JSON (só POST) → formato do cookie (ausente ou malformado ⇒ 404 imediato, **sem ir ao banco**) → corpo → limite de taxa → função no banco. Falha interna ⇒ 503 `indisponivel` fixo. `isDraftRoute` passa a reconhecer os dois caminhos novos; qualquer outro método neles cai no mesmo 404.

### 2.1 `GET /v1/drafts/current/review` (leitura da revisão)
Não altera nada (CA-05). Resposta calculada na API sobre `private.draft_review_get`:

| Situação (nesta ordem) | Status | Corpo |
|---|---|---|
| Sem cookie, malformado, de outro navegador, vencido, descartado ou publicado | 404 | **byte a byte igual** ao 404 de `GET /drafts/current` (corpo e cabeçalhos) |
| Falta serviço (ou serviço inativo), local, urgência, descrição, nome ou e-mail | 422 | `{ code:"campos_faltando", missing:[...] }`, chaves na ordem de `DRAFT_REVIEW_FIELDS` |
| Tudo preenchido, e-mail não confirmado (`email_verified_at` nulo ou `status='aguardando_email'`) | 409 | `{ code:"email_nao_confirmado" }` (CA-04: nenhum dado do pedido volta) |
| Pronto | 200 | `{ id, content_rev, confirmed_at, service:{id,name}, address_text, urgency, description, first_name, email, expires_at }` |

- `confirmed_at` é `null` (não confirmado) ou o instante ISO. Sem `lat`, `lon`, ponto, `address_hash`, `ip_hmac`, `browser_nonce_hash`, `phone`. Sem campo de fotos nesta história (CA-10); quando #39 e #42 entrarem, a resposta ganha `photos:[]` e o bloco só aparece com 1 ou mais.
- O e-mail só volta para o dono (cookie). Nunca em log (§7).
- Limite: 120 por 60 s por IP-HMAC (mesma política de leitura). Conta como uso toda resposta que não seja 404 (200, 409, 422), porque a tela consulta esta rota durante a espera do e-mail (§5.3); o 404 só é checado.

### 2.2 `POST /v1/drafts/current/confirm` (confirmação expressa)
Corpo JSON até 1 KB, **uma única chave**: `{ "content_rev": <inteiro ≥ 0> }` (a versão que o cliente está vendo). Outra chave ou tipo ⇒ 422 `corpo_invalido`; nunca aceita `status`, `confirmed_at`, `email` etc.

| Situação (ordem da função `draft_confirm`) | Status | Corpo |
|---|---|---|
| Não existe para este cookie (mesmos casos do 404 uniforme) | 404 | idêntico ao uniforme |
| Campo obrigatório faltando ou serviço inativo | 422 | `{ code:"campos_faltando", missing:[...] }` |
| E-mail não confirmado ou `status <> 'aberto'` | 409 | `{ code:"email_nao_confirmado" }` |
| `content_rev` diferente do atual | 409 | `{ code:"conteudo_alterado" }` (cliente recarrega a revisão) |
| Já confirmada na mesma versão | 200 | o mesmo corpo da primeira vez (**mesmo `confirmed_at`**, sem nova gravação) |
| Confirmada agora | 200 | `{ status:"confirmado", confirmed_at, content_rev }` |

- **Idempotência (CA-08):** a função trava a linha (`for update`); duas confirmações simultâneas serializam e a segunda devolve o `confirmed_at` da primeira. Não é preciso cabeçalho `Idempotency-Key`: o recurso é naturalmente idempotente. Sempre 200 (não 201), para o reenvio não parecer erro.
- **Só o clique confirma (CA-06):** nenhum GET, PATCH, DELETE ou outra rota grava `confirmed_at`. Só `draft_confirm`, chamada só por esta rota.
- A resposta **não contém** a palavra "publicado" nem `service_request_id`, `published_at`, prazo ou `status` diferente de `confirmado` (que é rótulo da resposta, não valor de coluna; a coluna `status` segue `aberto`, decisão 60).
- A confirmação renova `expires_at` com a mesma expressão de `draft_patch` (prazo deslizante, teto de 30 dias desde a criação), para o cliente não perder o pedido entre #43 e #44.
- Limites: 10 por 60 s por rascunho e 30 por 60 s por IP-HMAC; excesso ⇒ 429 `Retry-After` sem expor o limite; `rl_hit` só depois de aceita (padrão H-025).

### 2.3 O que não muda (compatibilidade)
`POST/GET/PATCH/DELETE` de H-025 mantêm corpo, resposta e códigos. `PATCH` em rascunho confirmado continua aceito e **desfaz a confirmação** pelo gatilho (CA-09); a resposta do PATCH não ganha campo novo, e a tela trata PATCH bem-sucedido como "não confirmado" e reconsulta a revisão. `DELETE` de rascunho confirmado é permitido.

## 3. Dados: migração por expansão, reversível `[PROPOSTA]`
Arquivo: `supabase/migrations/20261112130000_draft_expand_review_confirmation.sql`; desfazer: `supabase/rollbacks/20261112130000_draft_expand_review_confirmation.down.sql`.
**Número:** livre agora (conferido contra `ls supabase/migrations`: último `20261112120500`). Como a #26 é anterior em dependência, o DEV **reconfere ao começar e renomeia** o prefixo para um valor maior que a última migração existente, inclusive a da #26, mantendo o par migração/rollback com o mesmo nome. A migração referencia colunas da #26 e por isso só pode ser aplicada depois dela.

### 3.1 Expansão (idempotente: `if not exists`, `create or replace`, `drop ... if exists`)
1. Colunas em `app.request_draft`: `confirmed_at timestamptz` (nula, sem padrão) e `content_rev integer not null default 0` (constante: sem reescrita da tabela). Nenhum dado existente muda; o código atual não lê as colunas novas.
2. CHECK `request_draft_confirmed_status_check`: `confirmed_at is null or status in ('aberto','publicado')`. Linhas existentes têm `confirmed_at` nulo, logo vale na hora. Criado só se ainda não existir (consulta a `pg_constraint`).
3. **Gatilho** `private.draft_confirmation_guard()` (`security definer`, `set search_path = ''`, sem execute para nenhum papel) em `before update` de `app.request_draft`, por linha:
   - `conteudo_mudou` = qualquer diferença (`is distinct from`) entre `old` e `new` em `service_id, address_text, urgency, description, first_name, email, email_verified_at`.
   - Se `conteudo_mudou`: `new.content_rev := old.content_rev + 1`.
   - Se `confirmed_at` **não** está sendo alterado pela instrução e (`conteudo_mudou` ou `new.status not in ('aberto','publicado')`): `new.confirmed_at := null` (CA-09).
   - Se `confirmed_at` passa de nulo para valor **e** `conteudo_mudou` na mesma instrução: `raise exception 'confirmacao_com_conteudo_alterado'` (`errcode 23514`, texto fixo). Dupla proteção: só `draft_confirm` mexe em `confirmed_at`, e ela não mexe em conteúdo.
   - Salvar o mesmo valor (PATCH idempotente) não conta como mudança: a confirmação sobrevive; `updated_at` e `expires_at` mudam sem efeito.
4. Funções (`security definer`, `set search_path = ''`, `p_now` informado pelo chamador, `revoke all` de `public, anon, authenticated, service_role, app_system`, `grant execute` só a `app_api`):
   - `private.draft_review_get(p_hash text, p_now timestamptz)`: devolve, para rascunho vivo (`aberto` ou `aguardando_email`, `expires_at > p_now`) do hash, `out_id, out_status, out_service_id, out_service_name, out_service_active, out_address_text, out_urgency, out_description, out_first_name, out_email, out_email_verified boolean, out_confirmed_at, out_content_rev, out_expires_at`. `stable`. Junta `app.service` por `service_id`. Zero linhas = não existe.
   - `private.draft_confirm(p_hash text, p_now timestamptz, p_content_rev integer, p_ttl_days integer) returns table(out_result text, out_confirmed_at timestamptz, out_content_rev integer, out_missing text[])`. Passos: valida entradas (`22023`, texto fixo); `select ... for update` da linha viva; sem linha ⇒ `nao_encontrado`; campos faltando (nulo ou só espaços; serviço inexistente ou `active=false` conta como `service_id`; urgência fora das 4 chaves não ocorre por CHECK) ⇒ `campos_faltando` com a lista na ordem de `DRAFT_REVIEW_FIELDS`; `status <> 'aberto'` ou `email_verified_at is null` ⇒ `email_nao_confirmado`; `p_content_rev <> content_rev` ⇒ `conteudo_alterado`; `confirmed_at` não nulo ⇒ `ok` com o valor existente, **sem `update`**; senão `update set confirmed_at = p_now, expires_at = least(p_now + make_interval(days => p_ttl_days), created_at + interval '30 days'), updated_at = p_now` ⇒ `ok`.
5. **Nada em `request_draft` guarda coordenada, ponto ou geocodificação** (I-28, G-01 permanecem). Nenhuma tabela nova. `service_request` não é tocada (H-031).
6. Sem índice novo: todas as leituras são pelo índice único parcial de `browser_nonce_hash` já existente.

### 3.2 Desfazer (`...down.sql`, execução manual e consciente, como o de H-025)
Na ordem: remover o gatilho e `draft_confirmation_guard`; remover `draft_confirm` e `draft_review_get`; remover o CHECK; remover as colunas `confirmed_at` e `content_rev`; `delete from ops.schema_migration where version = ...`. **Efeito:** perde-se só a marca de confirmação e o contador (o cliente reconfirma; o status `aberto` e o conteúdo ficam intactos). Idempotente (`if exists`). Não toca `first_name`, `email`, `email_verified_at` (são da #26) nem nenhuma função de H-025.

### 3.3 Contrato para as histórias seguintes
- **#44 (H-031):** publica somente rascunho com `confirmed_at is not null` e `status='aberto'` e `email_verified_at` preenchido; reconfere `content_rev` na própria transação; o aviso de duplicidade (409 `duplicate_warning`) é dela (decisão 62). Ao publicar, grava `status='publicado'`; o CHECK acima já aceita.
- **#39 e #42 (fotos):** incluir, excluir ou reordenar foto do rascunho precisa incrementar `content_rev` (o gatilho só enxerga colunas de `request_draft`). Registrar como critério nessas Issues, com uma função `private.draft_content_touch(uuid)` criada por quem precisar primeiro.
- **#26 e #27 (sessão):** a publicação continuará exigindo a sessão de H-014 (08 §5.1); #43 usa só posse do rascunho + e-mail confirmado no rascunho (decisão 59).

## 4. Domínio e API: onde cada coisa fica `[PROPOSTA]`
- `packages/domain/src/draft/review.ts` (novo): constantes `DRAFT_REVIEW_PATH`, `DRAFT_CONFIRM_PATH`, `DRAFT_CONFIRM_BODY_LIMIT_BYTES = 1024`, `parseConfirmBody(text, bytes)`, tipos de resposta, textos fixos de erro. Reusa `draftMissingForReview`, `DRAFT_REVIEW_FIELDS`, `DRAFT_HEADERS`, `draftNotFound`.
- `packages/db/src/request-draft.ts`: dois métodos novos no adaptador Pg (`reviewGet`, `confirm`), um para cada função.
- `apps/api/src/drafts/draft-review-service.ts` e `draft-review-route.ts` (novos) no padrão de `draft-service.ts`/`draft-route.ts`; ligação em `compose.ts` e `app.ts` com as mesmas portas injetadas (limite de taxa, relógio, banco).
- Política de taxa nova (constantes `DRAFT_RATE_CONFIRMAR_RASCUNHO`, `..._IP`), mesmo formato e chave SHA-256 de `draft:<política>:<valor>`.
- Regra do 404 uniforme: **um único** `draftNotFound()` reutilizado; teste compara bytes.

## 5. Tela (web estático, sem framework) `[PROPOSTA]`
Arquivos em `apps/web/public/`: `pedido.html`, `pedido.js`, `pedido/revisao.html`, `pedido-revisao.js`, `pedido.css` (tokens do EDS via `tokens.css`, **sem hex nos componentes** e sem `style` em linha, por causa da CSP). `cleanUrls` já serve `/pedido` e `/pedido/revisao`. Cabeçalhos e CSP de `/pedido` e `/pedido/(.*)` já estão reservados em `vercel.json` (o teste `address-pedido-csp.test.ts` continua valendo e ganha as duas páginas). `connect-src 'self'`: a tela só fala com `/api/v1/...`.
O controle de cada passo é um módulo puro (relógio, temporizador e rede injetados), como `createSuggestController`, para testar sem navegador; a visão só desenha estado.

### 5.1 Página `/pedido` (passos 1 a 5 e espera do e-mail)
Um formulário só, em ordem de leitura: serviço (busca H-019) → local (AddressField H-020, só texto) → urgência (`<select>` ou rádios com os 4 rótulos exatos) → descrição → primeiro nome → e-mail → botão "Revisar pedido". Texto de apoio: "Não escreva telefone nem e-mail na descrição" (R2 de H-025).
- **Salvamento:** o rascunho é criado na primeira ação com conteúdo (`POST /v1/drafts`); depois `PATCH /v1/drafts/current` com debounce de 800 ms e ao sair do campo, uma requisição em voo por vez (R6 de H-025). Nome e e-mail **não** vão por este PATCH (422 `campo_desconhecido`): vão pela rota de identificação da #26, só no clique de "Revisar pedido".
- **"Revisar pedido":** valida no cliente com a mesma lista de `draftMissingForReview`; faltando ⇒ erro por campo e resumo (CA-03), **sem chamar** a rota de e-mail. Completo ⇒ salva pendências, chama a identificação da #26 e entra em "Confira seu e-mail".
- **"Confira seu e-mail":** mostra o e-mail digitado (com "Corrigir e-mail", que volta ao campo), campo do código de 6 dígitos (contingência da #26) e "Reenviar" (limites da #26). Consulta `GET /v1/drafts/current/review` a cada 5 s enquanto a aba está visível, por no máximo 15 min (validade do link), mais o botão "Já confirmei meu e-mail". Resposta 200 ⇒ navega para `/pedido/revisao`. 409 ⇒ continua esperando. 422 ⇒ volta ao formulário com o erro por campo. 404 ⇒ estado Vazio.
- Ao reabrir `/pedido` com rascunho existente, preenche os campos com `GET /v1/drafts/current` e a identificação do que a #26 expuser; sem rascunho (404) mostra o formulário em branco.

### 5.2 Página `/pedido/revisao` (passos 7 e 8)
Ao abrir chama só `GET /v1/drafts/current/review` (CA-04/05). Em leitura, nesta ordem: Serviço (nome), Local (texto), Urgência (rótulo exato), Descrição, Nome e e-mail. Cada bloco tem o botão "Editar [bloco]" que é **link** para `/pedido#campo` (volta ao passo, CA-05); o bloco de identificação leva ao passo de e-mail. Sem seção de fotos quando não há fotos (CA-10). Sem coordenada, mapa ou ponto (CA-11). Sem o texto "apenas conecta" (RF-078, decisão 22).
Botão principal "Confirmar pedido": `POST /v1/drafts/current/confirm` com o `content_rev` da leitura. Voltar, rolar, fechar a aba, ou reabrir a página **não** confirmam (CA-06). Ao reabrir um pedido já confirmado, a tela mostra direto o estado Confirmado (vem de `confirmed_at`), sem novo POST.

### 5.3 Estados (CA-13); todos com texto, nunca área vazia
| Estado | Gatilho | Tela | Foco / anúncio |
|---|---|---|---|
| Carregando | abrir /pedido ou /pedido/revisao | "Carregando seu pedido…"; campos e botões desabilitados; **sem dado antigo** | `aria-busy="true"` na região; texto em `role="status"` |
| Vazio | 404 em qualquer leitura | Formulário em branco; na revisão: "Não encontramos um pedido em andamento. Comece um novo pedido." + link para `/pedido` | foco no título |
| Campo faltando | 422 `campos_faltando` ou validação do cliente | Erro por campo (`aria-invalid`, `aria-describedby`) e resumo "Falta preencher: …" no topo, com links para os campos | foco no resumo; resumo em `role="alert"` |
| E-mail não confirmado | 409 `email_nao_confirmado` | Tela "Confira seu e-mail" (§5.1), sem dado do pedido | `role="status"` |
| Erro ao carregar | rede ou 5xx na leitura | "Não foi possível abrir seu pedido agora. Tente de novo." + "Tentar de novo"; nada é apagado | foco no botão |
| Erro ao salvar campo | PATCH falha | "Não foi possível salvar essa alteração. Tente de novo." junto ao campo; valor mantido | `role="status"` |
| Sem resultado na busca | termo sem serviço | texto da busca de H-019 ("Não encontramos esse serviço. Tente outra palavra.") | já existente |
| Muitas tentativas | 429 | "Muitas tentativas. Aguarde um instante e tente de novo." respeitando `Retry-After` | `role="status"` |
| Confirmando | clique em "Confirmar pedido" | Botão `disabled` e "Confirmando…"; um clique só (CA-08) | `aria-busy` |
| Conteúdo alterado | 409 `conteudo_alterado` | recarrega a revisão e mostra "Seu pedido mudou. Confira de novo antes de confirmar." | foco no título |
| Falha ao confirmar | rede ou 5xx | "Não foi possível confirmar agora. Seus dados continuam salvos. Tente de novo." Nunca usa "publicado" | foco no botão |
| Confirmado | 200 do confirm, ou `confirmed_at` ≠ nulo na leitura | **"Pedido confirmado. Ainda não foi publicado."** (decisão 61), sem botão de publicar e sem prazo; link "Editar pedido" (que, ao salvar, desfaz a confirmação) | foco no título; `role="status"` |

Textos: os de 89 §3 e decisão 61, `[PROPOSTA]` revisáveis (D-H030-11).

### 5.4 Acessibilidade e responsividade (CA-14)
- HTML semântico: um `h1` por página, `main`, `form`, `label` visível por campo, `fieldset/legend` para urgência se for rádio; botões reais; links reais para "Editar".
- Teclado: ordem do DOM = ordem visual; nenhum `tabindex` positivo; foco visível por token (contorno ≥ 2 px, contraste ≥ 3:1); nenhum elemento clicável que não seja `a`/`button`; Enter no campo da busca não envia o formulário; lista de sugestões segue o padrão já aprovado em #32/#33.
- Leitor de tela: erros ligados ao campo por `aria-describedby`, resumo com `role="alert"`, mudanças de estado em região `role="status"`/`aria-live="polite"`; idioma `pt-BR`; título da aba muda por tela.
- 320 CSS px e zoom 200%: layout em coluna única, `max-width` em unidades relativas, sem rolagem horizontal, botões ≥ 44 px de alvo, texto reflui; nenhuma largura fixa em pixel nos contêineres.
- Cores e espaçamentos só por tokens EDS (`tokens.css`); contraste de texto ≥ 4,5:1; estado não depende só de cor.
- `prefers-reduced-motion`: sem animação essencial.

## 6. Segurança e privacidade
1. **Posse (CA-12, T-02):** só o cookie `__Host-fp_draft` (256 bits, `HttpOnly; Secure; SameSite=Strict`) abre a revisão e a confirmação; busca por hash, nunca por id; cookie malformado nem toca o banco; 404 uniforme para todos os casos de "não é seu ou não existe".
2. **CSRF/fixação:** Origin + Sec-Fetch-Site + `application/json` no POST; `SameSite=Strict`. A rota de revisão é GET sem efeito colateral.
3. **Atribuição em massa:** o corpo de confirmação só aceita `content_rev`. Nenhum cliente grava `confirmed_at`.
4. **Dado pessoal:** o e-mail e o nome só voltam ao dono. **Nenhuma** rota nova pode logar corpo, e-mail, nome, descrição ou endereço (lista de permissão de log; teste com sentinela, D-12 de H-025 estendido). O e-mail não vai em URL, cabeçalho, fragmento nem armazenamento do navegador. `Referrer-Policy: no-referrer` já está na CSP da página.
5. **Sem coordenada:** a resposta de revisão e a de confirmação não têm campo de ponto (teste de contrato com lista fechada de chaves).
6. **Banco:** funções com `search_path` vazio, execute só `app_api`, RLS da tabela intacta, gatilho sem execute.
7. **Aceita e registrada:** a revisão usa "e-mail confirmado no rascunho" e não a sessão de 7 dias. Quem tiver o cookie do rascunho mas não o e-mail consegue ver o pedido de quem foi anexado (já é o dono do navegador). A sessão autenticada continua exigida na publicação (#44).

## 7. Testes que provam cada critério
Padrão do repositório: `*.test.ts` (unidade/rota), `*.dbtest.mjs` (Postgres real efêmero, nunca mock), e agora navegador real. Todos locais, sem rede, dados sintéticos; provedores externos e e-mail simulados (nenhum e-mail real). Evidência na Issue: comando, contagem de passou/falhou e código de saída de `corepack pnpm check:all`, `db:test` e do comando do navegador. Não declarar CI verde.

### 7.1 Banco (Postgres real) `packages/db/tests/draft-review-h030.dbtest.mjs` e `draft-review-migration.test.mjs`
| # | Teste | Critério |
|---|---|---|
| T-PRE | Pré-condição da #26: colunas `first_name`, `email`, `email_verified_at` existem; falha com mensagem clara se não | §1.1 |
| T-DB01 | `draft_confirm` em rascunho completo, confirmado: `confirmed_at` gravado, `status` continua `aberto`, `content_rev` igual; `count(*)` em `app.service_request` (se existir) e tabelas de pedido inalteradas; nenhuma coluna `published_*` | CA-06, CA-07 |
| T-DB02 | **Idempotência:** 2 chamadas em série e **20 chamadas concorrentes** (conexões distintas) ⇒ um só `confirmed_at` (o da primeira) em todas as respostas; a linha tem uma única marca; segunda chamada não faz `update` (conferido por `xmin` inalterado) | CA-08 |
| T-DB03 | Gatilho: alterar cada um de `service_id, address_text, urgency, description, first_name, email, email_verified_at` (um teste por coluna) ⇒ `confirmed_at` nulo e `content_rev` +1; PATCH com valores idênticos ⇒ confirmação intacta e `content_rev` igual; `update` direto como dono ⇒ mesmo efeito | CA-09 |
| T-DB04 | `status` para `aguardando_email` ou `descartado` zera `confirmed_at`; CHECK rejeita `confirmed_at` com `status` `aguardando_email`; `update` que define `confirmed_at` junto de mudança de conteúdo ⇒ erro 23514 | CA-09, CA-06 |
| T-DB05 | `draft_confirm` com `p_content_rev` velho ⇒ `conteudo_alterado` e nada gravado; com rascunho confirmado e versão atual ⇒ `ok` igual; com versão velha após edição ⇒ `conteudo_alterado` | CA-06, CA-09 |
| T-DB06 | Ordem das recusas: faltando campo ⇒ `campos_faltando` com a lista na ordem fixa; completo sem `email_verified_at` ⇒ `email_nao_confirmado`; serviço desativado ⇒ `campos_faltando` com `service_id`; nada é gravado em nenhum caso | CA-03, CA-04 |
| T-DB07 | **Posse:** dois rascunhos (cookie A e B). `draft_review_get`/`draft_confirm` com o hash de B nunca devolvem nem alteram o de A. Hash inexistente, vencido, descartado e publicado ⇒ **zero linhas / `nao_encontrado`**, indistinguíveis entre si (comparação do conjunto de colunas) | CA-12 |
| T-DB08 | **Sem fotos:** pedido sem nenhuma linha em mídia confirma normalmente; a função não referencia mídia | CA-10 |
| T-DB09 | Paridade: tabela de 20 casos (cada campo ausente, em branco, urgência `nao_definido`) ⇒ `draftMissingForReview` (domínio) e `missing` do SQL coincidem | CA-02, CA-03 |
| T-DB10 | Expiração: `p_now` em `expires_at` ou depois ⇒ `nao_encontrado`; confirmação renova `expires_at` com teto de 30 dias | CA-12 |
| T-DB11 | Migração: aplicada sobre banco com linhas antigas (sem colunas novas) ⇒ linhas intactas, `content_rev=0`, `confirmed_at` nulo; aplicada **duas vezes** sem erro; `.down.sql` remove colunas, gatilho, funções e CHECK, deixa `draft_*` de H-025 funcionando; reaplicar ⇒ volta | expansão e reversibilidade |
| T-DB12 | Segurança: `search_path=''`; só `app_api` com execute; `public/anon/authenticated/service_role/app_system` sem; gatilho sem execute; nenhuma coluna `lat/lon/point/geom` na tabela; RLS forçada | CA-11 |

### 7.2 API (rota, banco real ou porta fake) `apps/api/tests/draft-review-route.test.ts`
| # | Teste | Critério |
|---|---|---|
| T-API01 | `GET /review`: cookie A ⇒ 200 com a lista **fechada** de chaves (sem `lat`, `lon`, ponto, `ip_hmac`, `browser_nonce_hash`, `phone`, `photos`); 422 com `missing` na ordem; 409 `email_nao_confirmado` sem dado do pedido | CA-04, CA-05, CA-10, CA-11 |
| T-API02 | Sem cookie, malformado, cookie de B, vencido, descartado, publicado em GET review **e** POST confirm ⇒ 404 com corpo e cabeçalhos **byte a byte iguais** ao `GET /drafts/current`; cookie malformado ⇒ zero chamadas ao banco | CA-12 |
| T-API03 | `GET /review` não altera nada (snapshot do banco antes e depois). PATCH, GET current, DELETE e `GET /review` nunca gravam `confirmed_at`; só `POST /confirm` | CA-05, CA-06 |
| T-API04 | `POST /confirm`: corpo com chave extra, vazio, `content_rev` não inteiro, 1 KB + 1 ⇒ 422/413 sem tocar o banco; Origin inválido ⇒ 403; sem JSON ⇒ 415; resposta contém `confirmado` e **não** contém `publicado`, `service_request`, prazo | CA-06, CA-07 |
| T-API05 | Clique duplo e 10 POST concorrentes ⇒ todos 200 com o mesmo corpo | CA-08 |
| T-API06 | PATCH em rascunho confirmado ⇒ nova leitura da revisão mostra `confirmed_at` nulo e `content_rev` maior; novo `POST /confirm` com a versão nova ⇒ 200 | CA-09 |
| T-API07 | Limite: 11ª confirmação em 60 s por rascunho ⇒ 429 com `Retry-After` e sem campo que revele o limite; `rl_hit` só após aceite; 404 não consome cota | segurança |
| T-API08 | Sentinela: e-mail, nome, endereço e descrição sintéticos não aparecem em nenhuma linha de log nem em corpo de erro | CA-11, privacidade |
| T-API09 | Nenhuma rota nova cria `service_request` nem muda `status` (inspeção do banco real) | CA-07 |

### 7.3 Unidade (domínio e controladores) `packages/domain` e `apps/web/tests`
- `draftMissingForReview` (já testada em H-025) com os 4 rótulos exatos de urgência (CA-02, CA-03).
- `parseConfirmBody`: só `content_rev`; tipos; limite.
- Controlador de `/pedido` e de `/pedido/revisao` com relógio e rede falsos: debounce de 800 ms, uma requisição em voo, espera de 5 s limitada a 15 min, parada com aba oculta, `Retry-After` respeitado, **nenhuma chamada de confirmação sem clique**, botão desabilitado durante o envio (CA-06, CA-08, CA-13).
- Estático: HTML sem `style=`, sem `script` em linha, sem hex fora de `tokens.css`, sem `href`/`fetch` para outro host, sem `lat|lon|latitude|longitude|map` (CA-11, CA-14); `vercel.json` cobre `/pedido/revisao` (estende `address-pedido-csp.test.ts`).
- Textos: os de §5.3 estão em constantes e nenhum contém "publicado" fora de "Ainda não foi publicado." (CA-13).

### 7.4 Navegador real (Playwright; Chromium) `apps/web/tests/e2e/pedido-h030.spec.ts`
**Ferramenta:** Playwright e `@axe-core/playwright` como `devDependencies` de `apps/web` (gratuitos, execução local; 18-PLANO-QA já os prevê). O comando entra em `package.json` (`test:e2e`) e roda em `check:all` só se o navegador estiver instalado; senão a Issue registra a execução manual com saída. API e banco locais efêmeros; e-mail simulado; sessão/link pelo caminho sintético de geração de link, **sem envio** (19-PLANO-TECNICO-DEV, caminho 1). Capturas de tela e relatório JSON anexados na Issue.
| # | Roteiro | Critério |
|---|---|---|
| T-E01 | Jornada sem fotos: busca "eletricista", endereço digitado, urgência, descrição, nome, e-mail, "Revisar pedido", link sintético, revisão, "Confirmar pedido", texto exato "Pedido confirmado. Ainda não foi publicado."; nenhum campo de senha em tela alguma; rede capturada: nenhuma requisição a outro host, nenhuma resposta com coordenada | CA-01, CA-06, CA-07, CA-10, CA-11 |
| T-E02 | Abrir a lista de urgência: exatamente os 4 rótulos | CA-02 |
| T-E03 | Revisar com nome e e-mail vazios: erro por campo, resumo no topo, nenhum pedido de e-mail na rede | CA-03 |
| T-E04 | Abrir `/pedido/revisao` com e-mail não confirmado: cai em "Confira seu e-mail", sem dado do pedido; confirmar o link em **outra aba** com o mesmo navegador libera por consulta | CA-04 |
| T-E05 | Revisão mostra os 6 itens corretos; "Editar" de cada bloco volta ao campo; abrir, voltar, recarregar e fechar a aba não confirmam (banco: `confirmed_at` nulo) | CA-05, CA-06 |
| T-E06 | Clique duplo no botão e três cliques seguidos: uma só requisição de confirmação aceita visível, botão desabilitado; recarregar mostra "Confirmado" sem novo POST | CA-08 |
| T-E07 | Depois de confirmar, "Editar pedido", mudar a descrição, voltar à revisão: aparece não confirmado e exige novo clique | CA-09 |
| T-E08 | Rascunho de outro navegador (contexto sem o cookie) abrindo `/pedido/revisao`: tela de Vazio, idêntica à de "não existe" | CA-12 |
| T-E09 | Capturas de **todos** os estados de §5.3: Carregando (rede atrasada), Vazio, Campo faltando, E-mail não confirmado, Erro ao carregar (rede cortada), Erro ao salvar, Muitas tentativas (429), Confirmando, Conteúdo alterado, Falha ao confirmar, Confirmado; cada um com texto visível e sem "publicado" indevido | CA-13 |
| T-E10 | Teclado: percorrer as duas páginas só com Tab, Shift+Tab, Enter e Espaço (roteiro AX-01), registrar ordem e foco visível por tela; resumo de erros recebe foco | CA-14, AX-01 |
| T-E11 | Viewport 320 px e zoom 200% (emulado por `deviceScaleFactor`/CSS zoom): sem rolagem horizontal, nenhum conteúdo cortado, botões ≥ 44 px | CA-14, AX-05 |
| T-E12 | axe em cada tela tocada (AX-04): zero violações sérias ou críticas; relatório JSON salvo | CA-14, AX-04 |
| T-E13 | Leitor de tela (AX-02, NVDA): **manual, testador humano**. Fica **pendente** até registrar nota; a fábrica não declara conformidade sem ela | CA-14 |

### 7.5 Cobertura dos critérios
| CA | Provas |
|---|---|
| CA-01 | T-E01, T-API01 (D-01 de H-025 já cobre a base) |
| CA-02 | T-E02, T-DB09, unidade de `draftMissingForReview` |
| CA-03 | T-E03, T-DB06, T-DB09 |
| CA-04 | T-API01, T-DB06, T-E04 |
| CA-05 | T-API01, T-API03, T-E05 |
| CA-06 | T-DB01, T-DB04, T-DB05, T-API03, T-API04, T-E01, T-E05, controlador |
| CA-07 | T-DB01, T-API04, T-API09, T-E01 |
| CA-08 | T-DB02, T-API05, T-E06 |
| CA-09 | T-DB03, T-DB04, T-DB05, T-API06, T-E07 |
| CA-10 | T-DB08, T-API01, T-E01 |
| CA-11 | T-DB12, T-API01, T-API08, estático, T-E01 |
| CA-12 | T-DB07, T-DB10, T-API02, T-E08 |
| CA-13 | T-E09, unidade de textos e controlador |
| CA-14 | T-E10 a T-E13, estático (tokens, sem hex) |

## 8. Observabilidade
Sem PII. Métricas por código fixo: `draft_review_ok`, `draft_review_422`, `draft_review_409`, `draft_confirm_ok`, `draft_confirm_repetida`, `draft_confirm_conteudo_alterado`, `draft_confirm_429`, `draft_review_404`. Taxa de `conteudo_alterado` alta indica edição em outra aba; 404 em alta pode indicar sondagem. Nenhum log leva corpo, cookie, e-mail, nome, descrição ou endereço.

## 9. Riscos
| # | Risco | Mitigação |
|---|---|---|
| R1 | **A #26 ainda não foi desenhada**: nomes de coluna, onde o nome é gravado e o destino pós-link podem diferir. | Portão de início e T-PRE (§1.1); ajuste local em três funções; dúvida 1 |
| R2 | **Confirmar algo diferente do que foi visto** (edição em outra aba, #26 ou fotos). | `content_rev` no corpo; gatilho zera a confirmação; 409 `conteudo_alterado` |
| R3 | **Gatilho depende das colunas da #26** e quebra se elas mudarem de nome. | Migração depois da #26; T-PRE; teste de gatilho por coluna (T-DB03) |
| R4 | **Fotos futuras (#39, #42) não passam por colunas de `request_draft`**, então o gatilho não as enxerga. | Critério herdado em §3.3; ao entrar, cada mudança de foto incrementa `content_rev` |
| R5 | **Espera pelo link gera consultas repetidas.** | 5 s, só com aba visível, no máximo 15 min, limite de 120/60 s por IP; custo de uma leitura indexada |
| R6 | **E-mail dentro do rascunho de outra pessoa** (alguém digita o e-mail alheio). | `email_verified_at` só pela regra de 08 §5.1 item 5; a revisão não abre sem ele |
| R7 | **Cliente acha que o pedido está no ar** depois de confirmar. | Texto fixo da decisão 61, sem botão de publicar; teste de que "publicado" só aparece em "Ainda não foi publicado." |
| R8 | **Dois lugares calculam "campos faltando"** (domínio e SQL) e podem divergir. | Teste de paridade T-DB09; o SQL é a autoridade, o domínio só desenha erro |
| R9 | **Sem Playwright no repositório**: custo de instalar e rodar. | Pacotes gratuitos; execução local; se não houver navegador, a Issue registra a execução manual com saída; leitor de tela segue pendente do testador humano (N7) |
| R10 | **Rascunho confirmado vence antes da #44.** | A confirmação renova o prazo (teto 30 dias); #44 deve ser entregue em seguida |
| R11 | **Usuário em dois dispositivos**: link aberto no celular, rascunho no computador. | Regra de e-mail igual da #26; o computador descobre por consulta; sem confirmação cruzada |
| R12 | **Migração fora de ordem** se outra Issue pegar o mesmo prefixo. | DEV reconfere ao começar e renomeia migração e rollback juntos |

## 10. Dúvidas não bloqueantes (para o Orquestrador consolidar; recomendação do Architect)
1. **Quem grava o primeiro nome e o e-mail no rascunho?** Alternativas: (a) a rota de identificação da #26 recebe nome e e-mail (recomendado: ela já anexa o rascunho); (b) #43 cria `PUT /v1/drafts/current/identity` e a #26 a chama. Recomendação: (a), a confirmar no desenho da #26; se for (b), vira trabalho desta Issue e entra em §2.
2. **Revisão por "e-mail confirmado no rascunho" em vez de sessão ativa.** Recomendação: aceitar; a sessão de H-014 é exigida na publicação (#44).
3. **`content_rev` no corpo da confirmação.** Recomendação: aceitar (evita confirmar o que não foi visto; custo de um inteiro).
4. **Limite da descrição:** manter **2000 caracteres** (já em H-025; fecha D-H030-8). Contador visível na tela.
5. **Playwright e axe como devDependencies (gratuitos).** Recomendação: aceitar.
6. **Página única `/pedido` + `/pedido/revisao`** (duas páginas estáticas, sem framework). Recomendação: aceitar; usa o padrão e a CSP já existentes.

## 11. Entrega ao DEV `[PROPOSTA]`
Ordem, depois do portão de início (§1.1): (1) migração, rollback e T-DB01 a T-DB12; (2) domínio `review.ts`, adaptador e serviço/rota da API com T-API01 a T-API09; (3) controladores puros e páginas estáticas com os testes de unidade e estáticos; (4) Playwright T-E01 a T-E12, capturas e relatório axe; (5) evidência na Issue (comando, contagens, código de saída) e nota de T-E13 como pendente do testador. Arquivos: os de §3, §4 e §5, mais `vercel.json` (teste de CSP estendido) e as linhas de rastreio em 14-BACKLOG (H-030 passa a depender de H-013; H-024 sai, decisão 63). Nenhum arquivo de `service_request`, fotos ou duplicidade muda nesta Issue.
