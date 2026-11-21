# Refino do defeito: campo de endereço falha na primeira visita (Issue #159)

- **Issue:** #159 `[E16] Defeito: campo de endereço da inicial falha na primeira visita` (e, pelo achado do dono, o serviço vazio em `/pedido`) · **Prioridade:** máxima (dono)
- **Workflow:** WF-04 (Bugfix) · **Etapa:** Product Owner · **EXEC-ID:** EXEC-PO-159-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Natureza:** somente documento. Nenhum código, teste, banco, quadro ou `11-DECISOES.md` foi alterado. Perguntas vão ao líder (Orquestrador), numeradas de 996 a 999.
- **Etiquetas:** `[V]` verificado por leitura nesta rodada · `[NV]` não verificado (vira verificação do Dev) · `[PROPOSTA]` deste refino, a validar.

---

## 0. Fontes lidas

- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/175-DESENHO-WEB-INICIAL.md` (§3.2, §3.3, §5.3; decisões 940 a 947) e `171-REFINO-WEB-INICIAL.md` (§5.4, §11).
- `docs/factory/11-DECISOES.md`, rodada 155 (linhas 1101 a 1104): registro do defeito e do segundo defeito.
- `apps/web/public/address-field.js` (controlador e cliente de rede), `inicio.js`, `pedido.js` (montagem, salvamento e preenchimento).
- `apps/api/src/geo/address-suggest-service.ts`, `apps/api/src/drafts/draft-gate.ts`, `apps/api/src/drafts/draft-service.ts`, `apps/api/src/drafts/draft-route.ts`.
- `packages/domain/src/draft/request-draft.ts` (corpo do rascunho, cookie, status vivos) e `packages/domain/src/geo/address-suggest.ts` (`ADDRESS_CONTEXTS`).
- `docs/factory/quadro-status.md` (linha 70: #159 consta no quadro).
- `docs/factory/103-REFINO-H110.md` (TTL de rascunhos ainda pendente) e `126-REFINO-H032.md` (endereço do rascunho em claro, decisão 407).

---

## 1. Sintoma

1. **Inicial (`/`), primeira visita:** o visitante escolhe o serviço (ou só digita o endereço), digita pelo menos 3 caracteres e não aparece nenhuma sugestão de endereço. Aparece a mensagem neutra "Não foi possível sugerir endereços agora. Digite o endereço normalmente." `[V]` (texto `ADDRESS_NEUTRAL_MESSAGE` em `address-field.js`, linhas 11 a 13).
2. **Continuar** continua funcionando e o texto digitado é mantido. O defeito é só nas sugestões e na mensagem falsa de falha. `[V]` (`inicio.js` cria o rascunho em `continuar()`).
3. **Depois do primeiro "Continuar"** (com cookie de rascunho), as sugestões passam a funcionar. Por isso o dono vê o defeito "na primeira visita". `[V]` pelo curl registrado no quadro (rodada 153/156: sugestão 200 com cookie; 403 sem cookie).
4. **Possível em `/pedido`:** aberta sem cookie (acesso direto ou depois de rascunho expirado), a mesma falha ocorre quando o endereço é digitado antes do primeiro salvamento. `[PROPOSTA]`, mecanismo confirmado em §2.4.
5. **Segundo defeito (incluído na #159 pelo líder, rodada 155):** em `/pedido`, com serviço já escolhido na inicial, o campo de serviço aparece **vazio** com o aviso "Serviço já escolhido. Para trocar, pesquise outro." `[V]` (`pedido.js`, `preencher()`, linhas 201 a 209, só grava `servicoId` e o aviso; não grava o nome em `#servico`). A API devolve só `service_id` no rascunho `[V]` pelo registro da rodada 155.

---

## 2. Causa raiz

### 2.1 Cadeia verificada

1. **Navegador (`address-field.js`):** o controlador envia `POST /api/v1/geo/address-suggest` com `{ q, context: 'request_draft' }`. A função `tratarResposta` só trata `mode: 'ok'` e `mode: 'texto_livre'`. Qualquer outra resposta cai em `status: 'falha'` com a mensagem neutra (linhas 81 a 108). Um 403 com corpo `{ code: 'not_draft' }` não tem `mode`, então vira falha. `[V]`
2. **API, porta de rascunho (`draft-gate.ts`, linhas 23 a 30):** sem cookie válido, `draftSecretFromCookie` devolve `null` e o gate responde `no_principal`. Cookie de rascunho inexistente, vencido ou descartado responde `not_draft`. Só `ok` segue. `[V]`
3. **API, serviço de sugestão (`address-suggest-service.ts`, linhas 53 a 58):** qualquer status diferente de `ok` vira **403 `not_draft`**, sem consultar o banco e sem chamar o Mapbox. `[V]`
4. **Inicial (`inicio.js`, linhas 186 a 194):** o campo de endereço é montado na carga da página, com `context: 'request_draft'`. O rascunho só existe depois de **Continuar** (`POST /api/v1/drafts` em `gravar()`, linha 238). Logo, toda consulta feita antes do primeiro Continuar chega sem cookie e recebe 403. `[V]`
5. **Rascunho expirado ou descartado:** o cookie continua no navegador, mas o banco não devolve rascunho vivo. O gate responde `not_draft` e a consulta também recebe 403. Ou seja, o defeito volta depois do prazo, não só na primeira visita. `[V]` (gate e `DRAFT_LIVE_STATUSES` em `request-draft.ts`, linha 41).
6. **Por que a API está certa e o desenho ficou incompleto:** a regra "a consulta só acontece no estado rascunho" é intencional (H-020, CA-01 e CA-02; comentário do serviço, linha 52). Ela impede custo de Mapbox e abuso por visitante sem rascunho. O desenho 175 decidiu que o rascunho só nasce no Continuar (decisão 940) e que o contexto é `request_draft` (decisão 946), mas **não tratou a dependência** entre o campo de endereço e o cookie: o §3.2 não menciona o 403 `not_draft`. `[V]` (grep em 175 sem a ocorrência).

### 2.2 Por que a mensagem parece "falha"

O 403 chega como resposta JSON válida, então o controlador não cai no `catch`. Ele entra no caminho de "formato inesperado" e mostra a mensagem de falha de rede. Por isso a tela diz que a sugestão "não foi possível" quando o problema é ausência de rascunho. `[V]`

### 2.3 Viabilidade já verificada na API (base para as alternativas)

- `POST /api/v1/drafts` aceita **qualquer subconjunto** das chaves `service_id`, `address_text`, `urgency`, `description`. Um corpo só com `address_text` ou só com `service_id` é válido. Só o corpo sem chave (`{}`) responde 422 `vazio`. `[V]` (`parseDraftBody`, `request-draft.ts`, linhas 113 a 151).
- Sem cookie, o POST cria (201) e entrega `Set-Cookie`. Com cookie vivo, o mesmo POST aplica um PATCH e responde 200. Com cookie vencido, cria novo e marca o antigo como descartado. `[V]` (`postDraft`, `draft-service.ts`, linhas 139 a 170).
- Limites de criação: 10 por hora e 50 por dia por IP (HMAC). Teto global de rascunhos vivos: 5.000 (`DRAFT_LIVE_CAP_DEFAULT`). Ao atingir o teto: 429 neutro. `[V]` (comentários e `paresCriacao`, `draft-service.ts`, linhas 78 a 79 e 110 a 111).
- O cookie é `__Host-fp_draft`, HttpOnly, Secure, SameSite=Strict, Path=/, com `Max-Age`. O navegador o envia sozinho. `[V]` (`draftCookieHeader`, linhas 214 a 216). Prazo: `DRAFT_TTL_DAYS = 7` e `DRAFT_MAX_AGE_SECONDS` = 7 dias `[V]` (`request-draft.ts`, linhas 12 e 13). Mínimo de caracteres do endereço no rascunho: `DRAFT_ADDRESS_MIN = ADDRESS_QUERY_MIN` `[V]` (linha 19); o valor numérico de `ADDRESS_QUERY_MIN` é `[NV]`, o Dev fixa em teste.

### 2.4 Variante em `/pedido`

- `pedido.js` monta o campo de endereço na carga (linhas 384 a 392) e cria o rascunho no primeiro salvamento (`salvador`, linhas 128 a 142, `POST` quando `criado` é falso). O salvamento de endereço dispara em `input`, `change` e `blur` (linhas 393 a 396). `[V]`
- A sugestão dispara 300 ms depois da digitação (`ADDRESS_DEBOUNCE_MS`). O salvamento dispara 800 ms depois da última alteração (`PEDIDO_SALVAR_ATRASO_MS = 800`, `pedido-logica.js`, linha 9) `[V]`. Ou seja, a consulta de endereço sai cerca de 500 ms **antes** do POST que cria o rascunho. Se o visitante começa pelo endereço, o 403 `not_draft` é o caminho provável, não raro. Mesmo mecanismo, por **corrida** de tempo. `[PROPOSTA]` o Dev confirma o efeito em teste com o relógio falso.

---

## 3. Escopo

**Dentro desta Issue**
1. Sugestões de endereço na inicial sem 403 visível na primeira visita e depois de rascunho expirado.
2. A mesma regra em `/pedido` (primeira visita sem cookie e corrida entre sugestão e salvamento).
3. Mensagens dos estados de endereço quando não há rascunho vivo (ver §4 e pergunta 998).
4. **Segundo defeito:** nome do serviço visível em `/pedido` quando o rascunho já tem serviço (ver pergunta 997).
5. Testes de regressão que reproduzem o defeito antes da correção (WF-04).

**Fora de escopo**
- Alterar a porta de rascunho (`draft-gate.ts`) ou permitir sugestão sem rascunho (alternativa c). Só é avaliada aqui; exige decisão própria da Arquitetura e do dono (custo, abuso e privacidade).
- Chaves, limites e cota do Mapbox. Nenhuma nova chamada ao provedor.
- Gravar qualquer coisa no navegador (`localStorage`, `sessionStorage`) ou ler/escrever cookie no JavaScript. O cookie continua sendo do servidor.
- Telas de entrada (#154), navegação (#155), preview (#152, #158), job de expiração de rascunhos (pendência da H-110, E2).
- Backup, produção e deploy. Fora do escopo do desenvolvimento.

---

## 4. Comportamento esperado

Os resultados abaixo valem para qualquer técnica escolhida (pergunta 996). A regra é de resultado, não de implementação.

| Estado | Cookie | Rascunho vivo | O que o visitante vê | Continuar |
|---|---|---|---|---|
| **E1 primeira visita** | não | não | Sem mensagem de erro. Ou sugestões aparecem, ou o campo é texto livre sem aviso (E-E5). **Nenhuma** resposta `not_draft` aparece na tela. | Valida e cria o rascunho. |
| **E2 rascunho criado** | sim | sim | Sugestões normais (200). Regressão de E-E2 e E-E3. | Atualiza (PATCH) e segue para `/pedido`. |
| **E3 rascunho expirado ou descartado** | sim (vencido) | não | Sem mensagem de erro; campo vira texto livre (E-E5), salvo decisão diferente da pergunta 998. Sem repetir a consulta em laço. | Cria novo rascunho (POST, que marca o antigo como descartado). |
| **E4 API indisponível** (503 do gate, falha de rede, `indisponivel` do provedor) | qualquer | qualquer | Mensagem neutra E-E4, uma vez. Não bloqueia Continuar. Sem retentativa automática. | Funciona com o texto digitado. |
| **E5 limite 429** (taxa de sugestão) | sim | sim | Texto livre sem mensagem (E-E5), com espera do `retry_after_s`. | Funciona. |
| **E6 cota ou sugestão desligada** | sim | sim | Texto livre sem erro (já existe). | Funciona. |
| **E7 criação de rascunho falha** (503, 429 de criação ou teto global, 422) | qualquer | não | Mensagem E-07 e campos mantidos. Não navega. | Erro E-07. |
| **E8 `/pedido` sem cookie** | não | não | Mesmo que E1. A sugestão não é consultada antes do salvamento que cria o rascunho. | Não se aplica. |
| **E9 `/pedido` com serviço** | sim | sim, com `service_id` | Nome do serviço no campo de serviço, com aviso "Serviço já escolhido...". Campo editável. | Não se aplica. |

Pontos que valem em todos os estados:
- Digitar não gera requisição `not_draft`. Nenhuma sugestão é disparada para visitante sem rascunho vivo (é o que o gate protege).
- Os dados digitados nunca são apagados por erro de sugestão ou de criação.
- Sem texto de erro técnico, sem código, sem o texto digitado em mensagem.

---

## 5. Critérios de aceite (Given / When / Then)

**CA-159-00 Reprodução (antes da correção).**
- **Dado** um teste com fetch simulado que reproduz a porta de rascunho (403 `not_draft` sem cookie, 200 com cookie criado por `POST /api/v1/drafts`),
- **Quando** a inicial é carregada sem cookie e o endereço recebe 3 caracteres,
- **Então** o teste **falha** no código atual, mostrando a mensagem neutra. A falha fica registrada na Issue como prova do defeito.
- **Prova:** vitest (`inicio-page`), saída e código de saída antes da correção.

**CA-159-01 Primeira visita na inicial.**
- **Dado** um visitante sem cookie de rascunho em `/`,
- **Quando** escolhe o serviço e digita um endereço de 3 a 120 caracteres,
- **Então** não aparece a mensagem E-E4 e nenhuma consulta de sugestão responde 403 `not_draft`. As sugestões aparecem (200) depois que existe rascunho vivo, ou o campo é texto livre sem aviso, conforme a técnica escolhida.
- **Prova:** vitest com fetch com estado que aplica a regra do gate (contagem de 403 = 0 no fluxo feliz).

**CA-159-02 Primeira visita em `/pedido`.**
- **Dado** um visitante sem cookie que abre `/pedido` direto,
- **Quando** digita o endereço antes de qualquer salvamento,
- **Então** nenhuma consulta de sugestão responde 403 `not_draft`; a consulta só ocorre depois que o salvamento criou o rascunho.
- **Prova:** vitest em `pedido` com fetch com estado e atraso controlado (corrida simulada: sugestão antes e depois do POST).

**CA-159-03 Continuar sem rascunho.**
- **Dado** a inicial sem cookie e serviço e endereço válidos,
- **Quando** o visitante clica em Continuar,
- **Então** o rascunho é criado uma única vez (contagem de POST = 1 e clique duplo não cria dois), e a página vai para `/pedido` literal.
- **Prova:** vitest (`inicio-continuar`), já existente, com o caso sem cookie.

**CA-159-04 Rascunho expirado.**
- **Dado** um cookie de rascunho vencido ou descartado,
- **Quando** o visitante digita o endereço,
- **Então** não aparece erro técnico (E-E4), a consulta não entra em laço, e Continuar cria rascunho novo.
- **Prova:** vitest com fetch que responde 403 `not_draft` com cookie presente e `GET /drafts/current` 404.

**CA-159-05 API indisponível.**
- **Dado** que a consulta de sugestão falha (503 ou rede),
- **Quando** o visitante digita,
- **Então** aparece E-E4 uma vez, sem retentativa automática (contagem de chamadas = 1 por digitação) e Continuar funciona.
- **Prova:** vitest (rejeição e 503 simulados).

**CA-159-06 Limite de taxa.**
- **Dado** resposta 429 de sugestão,
- **Quando** o visitante digita,
- **Então** o campo vira texto livre sem mensagem (E-E5) e não consulta de novo antes do `retry_after_s`.
- **Prova:** vitest (fake de relógio).

**CA-159-07 Falha ao criar o rascunho.**
- **Dado** serviço e endereço preenchidos,
- **Quando** a criação responde 503, 429 ou falha de rede,
- **Então** aparece E-07, a página não navega e os dois campos mantêm o que foi digitado.
- **Prova:** vitest (já coberto em CA-W08 da #153; repetir com o caso sem cookie).

**CA-159-08 Serviço visível em `/pedido` (segundo defeito).**
- **Dado** um rascunho com serviço escolhido na inicial,
- **Quando** `/pedido` é carregada,
- **Então** o campo de serviço mostra o **nome** do serviço e o aviso "Serviço já escolhido...", sem campo vazio.
- **Prova:** vitest em `pedido` com resposta de `GET /drafts/current` contendo o nome (técnica conforme pergunta 997), e teste de contrato na API se o nome entrar no corpo do rascunho.

**CA-159-09 Sem armazenamento e sem dado na URL.**
- **Dado** o fluxo completo da inicial até `/pedido`,
- **Quando** é percorrido,
- **Então** nada é escrito em `localStorage`, `sessionStorage` ou `document.cookie`, e a URL de `/pedido` não tem serviço nem endereço.
- **Prova:** vitest com espiões (já existe em `inicio-page`; estender para o caso sem cookie).

**Prova de ponta a ponta (somente feliz, por API).** Depois da correção, o Dev registra por chamadas de API no servidor local (`DEV_PORT=3010 corepack pnpm dev`): (1) sugestão sem cookie: 403 `not_draft` (esperado, e a tela não o mostra); (2) criação do rascunho: 201 com cookie; (3) sugestão com cookie: 200 com sugestões. Isso é o caminho feliz de QA e não exige tela.

**Playwright (opcional, fora do QA final).** Um teste de primeira visita com rede simulada, se o Dev julgar necessário. Não entra como QA de tela, conforme a regra do dono.

---

## 6. Riscos

| Nº | Risco | Mitigação |
|---|---|---|
| R-1 | **Custo do Mapbox.** A correção não pode aumentar as chamadas ao provedor. Hoje o 403 não custa nada. Repetição em laço ou consulta antecipada multiplica chamadas. Limites de DEV: 90.000 e 99.000 (registrados na rodada 153). | Sem retentativa automática; consulta só com cookie vivo; CA-159-05 e CA-159-06 como trava. |
| R-2 | **Abuso e limite por IP.** Criar rascunho mais cedo (alternativas a e b) aumenta criações. O limite de 10 por hora por IP pode barrar visitantes que compartilham IP (rede de operadora ou escritório). O teto global de 5.000 vivos vira 429 para todos. | Criar só quando o visitante já escolheu serviço (alternativa b) reduz o volume. Medir criações por visitante no teste. |
| R-3 | **Rascunhos órfãos.** Quem digita endereço e sai cria rascunho sem pedido. A expiração por prazo ainda não tem job (pendência da H-110, E2). | Pergunta 999 (prazo e limite para rascunho sem serviço). Alternativa b reduz o volume. |
| R-4 | **Endereço em claro.** O endereço do rascunho fica em claro até expirar (decisão 407, dívida registrada). Rascunhos órfãos ampliam a exposição. | Não piorar o cenário; registrar em `11-DECISOES` pelo líder se a pergunta 999 for adotada. |
| R-5 | **Corrida em `/pedido`.** A sugestão pode sair antes do POST do salvamento. | CA-159-02 com atraso controlado; a Arquitetura escolhe entre aguardar o salvamento ou não consultar antes do rascunho. |
| R-6 | **Enfraquecer a porta de privacidade.** A alternativa (c) remove a exigência de rascunho das sugestões, o que contraria o desenho H-020 e abre consulta anônima ao provedor. | Não recomendada sem decisão do dono e da Arquitetura. Nada deste refino a adota. |
| R-7 | **Contrato de `GET /drafts/current`.** Incluir `service_name` altera o corpo da resposta. | Mudança aditiva (campo novo) é compatível com a tela atual `[PROPOSTA]`; Arquitetura confirma e testa a paridade no domínio. |
| R-8 | **Conflito com #153, #154 e #155 (já entregues).** Editam a inicial e o cabeçalho. | Dev mexe só nos arquivos listados; QA da #155 não roda em paralelo a esta correção (regra aprendida na rodada 154). |

---

## 7. Alternativas para a Arquitetura (não decididas aqui)

Os critérios das seções 4 e 5 valem para todas. Esta etapa não escolhe a técnica.

**(a) Criar rascunho mínimo no primeiro foco ou digitação do endereço.**
- Viável pela API: corpo só com `address_text` é aceito (§2.3). Falta confirmar o mínimo de caracteres (`DRAFT_ADDRESS_MIN`, `[NV]`).
- Prós: resolve a inicial e `/pedido` pelo mesmo caminho; já é o que `/pedido` faz no primeiro salvamento.
- Contras: cria rascunho para quem não escolheu serviço (R-2, R-3, R-4); corrida no primeiro caractere (R-5).

**(b) Criar rascunho ao escolher o serviço; liberar o campo de endereço depois.**
- Viável pela API: corpo só com `service_id` é aceito, com serviço validado (`servico_invalido` 422 se inativo). `[V]`
- Prós: menos rascunhos órfãos (R-3); respeita a ordem da tela (serviço primeiro, decisões 940 e 942).
- Contras: o campo de endereço fica bloqueado antes do serviço, o que muda a interação. Em `/pedido` o campo de endereço está sempre ativo; esta opção **não resolve sozinha** `/pedido` e exige regra própria ali (CA-159-02).
- Variante para avaliar: campo de endereço como texto livre sem sugestão até existir rascunho (sem bloquear a digitação).

**(c) Contexto de sugestão sem rascunho.**
- Exige mudança na API: novo valor em `ADDRESS_CONTEXTS` (`packages/domain/src/geo/address-suggest.ts`, linha 14), gate próprio, limite por IP sem cookie e revisão de privacidade.
- Contraria o desenho H-020 (consulta só com rascunho). Risco de custo e abuso (R-1, R-6).
- **Não recomendada** sem decisão do dono e da Arquitetura.

**Critério do PO para a escolha:** atender CA-159-01 a CA-159-07 com o menor número de rascunhos criados para visitantes que não escolheram serviço. Pela análise de riscos, a alternativa (b) tem o melhor balanço, mas precisa da regra própria de `/pedido`. A escolha técnica é da Arquitetura.

---

## 8. Dependências

| Ref. | Item | Estado | Como foi confirmado |
|---|---|---|---|
| D-01 | #153 inicial | Entregue, em Aguardando aprovação (decisão humana pendente) | `11-DECISOES` rodada 153 (linha 1078) `[V]` |
| D-02 | #154 e #155 telas e navegação | Entregues; #155 mexeu nas páginas comuns (cabeçalho, rodapé, fluxo do pedido inicial) | `11-DECISOES` rodadas 154 e 155 `[V]` |
| D-03 | #156 API local com rascunho e endereço | Entregue (curl registrado) | `11-DECISOES` rodadas 153 e 156 `[V]` |
| D-04 | Job de expiração de rascunhos (H-110, E2) | Pendente, fora desta Issue | `103-REFINO-H110.md` `[V]` |
| D-05 | Valor numérico de `ADDRESS_QUERY_MIN` (mínimo de caracteres do endereço no rascunho) | Não lido nesta rodada | `[NV]`, Dev fixa em teste |
| D-06 | Coluna do cartão #159 | Product Owner, linha 70 do quadro local | `quadro-status.md` `[V]` |

Nenhuma dependência bloqueia o início da Arquitetura.

---

## 9. Perguntas ao líder (numeradas a partir de 996)

Perguntas do Product Owner ao líder, sem envio ao usuário. Cada uma traz a recomendação; se o líder não tiver resposta, adota a recomendação e registra em `11-DECISOES.md` como "adotada pelo líder", para o dono vetar depois.

**996. Como o rascunho chega antes da sugestão de endereço?**
- **O que é:** a sugestão de endereço só funciona depois que existe um "pedido em rascunho" guardado no servidor. Hoje ele só é criado ao clicar em Continuar. Esta pergunta decide **quando** ele passa a existir.
- **Por que importa:** sem decisão, o defeito continua na primeira visita. Escolher mal pode criar muitos rascunhos de quem só digitou endereço.
- **Opções:**
  - (a) criar rascunho mínimo quando o visitante começa a digitar o endereço;
  - (b) **[recomendada para avaliação]** criar rascunho ao escolher o serviço e liberar o campo de endereço depois (com regra própria em `/pedido`);
  - (c) sugestão de endereço sem rascunho, o que exige mudança na API e revisão de privacidade. Não recomendada.
- **Destrava:** escolha técnica e desenho da Arquitetura (CA-159-01, CA-159-02).

**997. Como mostrar o nome do serviço em `/pedido`?**
- **O que é:** quando o visitante já escolheu o serviço na inicial, `/pedido` precisa mostrar o nome dele. Hoje a API devolve só o código do serviço, e o campo aparece vazio.
- **Por que importa:** o visitante acha que perdeu a escolha e pode escolher de novo ou desistir.
- **Opções:**
  - (A) **[recomendada]** a API passa a devolver o nome do serviço junto com o rascunho (mudança aditiva; o nome é do catálogo público, sem dado pessoal);
  - (B) a tela procura o nome no catálogo pelo código (hoje não há consulta por código; exige rota nova);
  - (C) pedir ao visitante que escolha o serviço de novo (pior experiência).
- **Destrava:** CA-159-08 e o desenho do contrato de `GET /api/v1/drafts/current`.

**998. O que o visitante vê quando não há rascunho vivo (cookie vencido, sessão nova ou rascunho descartado)?**
- **O que é:** a sugestão de endereço não pode ser dada porque não há pedido em rascunho. Esta pergunta decide a mensagem.
- **Por que importa:** a mensagem atual de falha ("Não foi possível sugerir endereços agora") faz parecer um problema técnico quando é só uma situação normal.
- **Opções:**
  - (A) **[recomendada]** o campo vira texto livre, sem mensagem de erro (estado E-E5 que já existe);
  - (B) manter a mensagem neutra de falha, como hoje;
  - (C) mostrar aviso próprio ("Seu pedido expirou. Comece de novo."), o que acrescenta atrito.
- **Destrava:** E3 da tabela da seção 4 e CA-159-04.

**999. Prazo e limite para rascunhos criados sem serviço?**
- **O que é:** um rascunho que só tem endereço (sem serviço) fica guardado no servidor, com o endereço em texto legível, até expirar. Esta pergunta decide se esse caso tem regra própria.
- **Por que importa:** o endereço é dado pessoal. Rascunhos abandonados ampliam a exposição. O job de expiração ainda não existe (pendência da H-110). Relaciona-se com a dívida 407.
- **Opções:**
  - (A) **[recomendada]** manter o prazo de 7 dias para todos, sem regra nova, e registrar o risco como dívida;
  - (B) prazo menor para rascunho sem serviço (exige o job de expiração, que ainda não existe);
  - (C) limite de criação mais baixo para rascunho sem serviço (exige nova política de taxa).
- **Destrava:** escolha entre (a) e (b) da pergunta 996, e a revisão de privacidade da Arquitetura.

---

## 10. Lista de veto (adotadas pelo PO, sem resposta necessária)

- Nenhuma mudança na porta de rascunho (`draft-gate.ts`) nem na regra "sugestão só com rascunho vivo" (H-020).
- Nenhuma sugestão de endereço consultada sem cookie (zero 403 visível no fluxo feliz).
- Nenhum armazenamento no navegador e nenhuma leitura ou escrita de cookie em JavaScript.
- Nenhuma nova chamada ao Mapbox e nenhuma retentativa automática.
- Nenhuma mudança em `#153`, `#154` e `#155` além do necessário para o defeito.
- Texto de erro nunca inclui o endereço digitado nem dado técnico.

---

## 11. Próximo passo

- Passar este refino à **Arquitetura** com as perguntas 996 a 999 (líder adota ou responde).
- Ordem do quadro para #159: Product Owner, depois Arquitetura, Desenvolvimento, Code Review, QA e Aguardando aprovação. Nenhum cartão foi movido nesta etapa.
- Verificações que o Dev registra na Issue: teste de reprodução (CA-159-00) em vermelho antes da correção; depois `corepack pnpm --filter @fastpro/web test` e `... typecheck` com contagem e código de saída; `check:hex`, `check:typography`, `check:logs` nos arquivos alterados. Sem simulação de resultado.
