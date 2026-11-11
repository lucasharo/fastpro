# Desenho H-020 — Autocomplete de endereço Mapbox temporário (Issue #33, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§8).
- **Rastro:** 55-REFINO-H020 (CA-01..14); decisões do Orquestrador (proxy no servidor; componente único para pedido e perfil, H-036; números do PO como proposta); 08 §9.5, §14, §15; 10 ADR-008, ADR-013, ADR-014; spikes/S-04-RESULTADO (§2.7.2, §4); código lido (somente leitura): `ops.external_quota` e `private.rl_check/rl_hit` (migrações 120000 e 170000), `apps/api/src/app.ts`, `packages/observability/allowlist.json`, `.env.example`.
- **Natureza:** documento. Nenhum código, migração, token, conta ou chamada externa foi criado ou feito.
- **Etiquetas:** `[DECIDIDO]` Orquestrador · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de conta/token e prova em desenvolvimento.

## 0. Princípio

O navegador **nunca** fala com o Mapbox. Ele envia o texto digitado à API do FastPro, que valida, limita, conta a cota, consulta o Mapbox (modo temporário, sem `permanent`), **descarta tudo menos o rótulo textual** e devolve até 5 rótulos. Nada da resposta é guardado (nem cache, nem banco, nem log). Quem escolhe uma sugestão só copia o rótulo para o campo; o rascunho grava esse texto como qualquer texto digitado (CA-03, CA-06). Coordenada é H-021.

## 1. Fluxo de sugestão (só em rascunho, com debounce e limite)

**Componente único** `AddressField` (UI compartilhada: pedido e base do profissional em H-036). Propriedade `context`: `request_draft` | `professional_base`. Padrão combobox acessível (role `combobox`, lista, `aria-activedescendant`, região viva para o aviso). `[PROPOSTA]` Lógica pura (`createSuggestController`) separada da visão, para testar com relógio falso.

Regras do cliente (CA-05, CA-07, CA-11):
1. Consulta só com `trim()` de **≥ 3 caracteres** (≤ 120), após **300 ms** sem tecla. Cada tecla cancela o timer e aborta (`AbortController`) a consulta em voo; resposta atrasada (número de sequência antigo) é ignorada.
2. Escolher uma opção, Esc, perda de foco ou campo limpo **descartam a lista**; escolher não gera nova consulta. A lista vive só em memória do componente: **sem** `localStorage`, `sessionStorage`, IndexedDB, Cache API, nem URL.
3. Falha ou degradação: **sem nova tentativa automática**; a próxima consulta depende de nova digitação (CA-11). Modo `texto_livre` por limite: sem consulta pelo prazo de `retry_after_s` (padrão 60 s); por cota desligada: sem consulta até recarregar a página.
4. O campo é sempre um texto editável; o envio do pedido nunca depende de sugestão (CA-06, CA-10).

**Só em rascunho (CA-01, CA-02).** Dupla barreira: (a) a tela do pedido monta o componente apenas no estado rascunho (inclui revisão antes da publicação e antes da identificação por link); (b) o **servidor confere o estado a cada consulta** pela porta `DraftGate` (§2.3): fora de rascunho a resposta é `403 not_draft` e **nenhuma chamada ao Mapbox** é feita. Pedido publicado/selecionado/cancelado/concluído/expirado não renderiza o campo.

## 2. Proxy no servidor

### 2.1 Rota `[PROPOSTA]`
`POST /v1/geo/address-suggest`, corpo JSON `{ "q": string, "context": "request_draft"|"professional_base" }`, limite de corpo 1 KB. **POST e não GET** para o texto não ir à URL (logs de plataforma, histórico, `Referer`). `Origin` conferida (mesmo padrão de 46 §1), `Content-Type: application/json`, resposta com `Cache-Control: no-store`. Registrada só se a opção `geo` for injetada em `AppOptions` (como `consume`/`session`); sem ela, 404.

### 2.2 Ordem no servidor (qualquer falha encerra sem custo adicional)
1. Interruptor `ADDRESS_SUGGEST_ENABLED` (padrão ligado; `false` ⇒ `texto_livre/desligado`, sem Mapbox). `[PROPOSTA]` desligamento manual de emergência.
2. Valida corpo: `q` normalizado (NFC, sem caracteres de controle, espaços colapsados), 3..120 caracteres; senão `400 entrada_invalida` (não conta cota nem limite).
3. `DraftGate.check(context, requestCtx)` ⇒ `ok | not_draft | no_principal` (§2.3).
4. Limite de taxa (§4.1). 5. Reserva de cota (§4.2). 6. Chamada ao Mapbox. 7. Mapeamento mínimo e resposta.

### 2.3 Porta `DraftGate` (inversão de dependência) `[PROPOSTA]`
No backlog H-025 (rascunho) **depende** de H-020; a tabela de rascunho ainda não existe. Portanto H-020 define a **porta** e entrega uma implementação em memória para teste; a ligação real é critério de aceite de **H-025** (`request_draft`: nonce do navegador + rascunho existente, estado `rascunho`, não expirado) e de **H-036** (`professional_base`: sessão de profissional autenticada, conforme H-016). Enquanto a porta real não estiver ligada, a rota responde `503 indisponivel` e a interface cai em texto livre com a mensagem neutra: seguro por padrão. CA-01/CA-02 ficam **provados na API em H-020** (com a porta simulada) e **provados ponta a ponta em H-025** (registrar como critério herdado; ver dúvida 1).

### 2.4 O que o Mapbox recebe e o que o navegador recebe
- **Mapbox:** Geocoding v6 `forward` com `autocomplete=true`, `country=br`, `language=pt`, `limit=5`, `types` de endereço/rua/bairro/localidade `[PROPOSTA]`, **sem `permanent`** (temporário) e sem proximidade do usuário (não enviamos IP nem localização). Token em `MAPBOX_ACCESS_TOKEN_SERVER`, **só em variável de ambiente do servidor**. Tempo máximo 2,5 s (`AbortSignal.timeout`), `cache: 'no-store'`, **sem retentativa**, sem repasse de cookies, IP ou cabeçalhos do cliente. `[NÃO VERIFICADO]` forma exata da resposta e dos parâmetros (S-04 §8): o adaptador isola isso.
- **Navegador:** exatamente
  `{ "mode": "ok", "items": [ { "label": "..." } ] }` ou `{ "mode": "texto_livre", "reason": "limite|cota|desligado|indisponivel", "retry_after_s"?: n }`.
  Cada `label` é texto ≤ 200 caracteres (`full_address`, senão `name` + `place_formatted`). **Não saem** latitude, longitude, `mapbox_id`, tipos, relevância, nem qualquer outro campo (CA-03, CA-04, S-04 §4 itens 1 e 5; Feature ID não é gravado nem devolvido, dúvida 6 do PO resolvida como "não").
- **Token e CA-14 (reinterpretado `[PROPOSTA]`):** como não há chamada do navegador, não há token público no navegador e **a restrição por origem deixa de ser o controle**. O controle passa a ser: (a) token **dedicado** a esta função, com escopos mínimos; (b) CSP `connect-src 'self'` nas páginas de H-020 (nenhum domínio Mapbox liberado ao navegador; verificável por teste); (c) cota e limites do servidor (§4). `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN` **não é usado** por H-020 (reservado a mapas futuros; manter vazio). Restrição por URL não se aplica a chamada de servidor `[NÃO VERIFICADO]`: por isso o contador é o freio real (risco 1).

## 3. Gravação apenas do texto escolhido (CA-03, CA-06)

H-020 **não cria tabela nem coluna**; o componente apenas entrega uma `string` ao formulário. A gravação do rascunho é de H-025 (`request_draft.address_text`) e de H-036/H-021. Regras para estas histórias, verificadas por teste estático: nenhuma coluna `lat/lon/latitude/longitude/point/geom/mapbox_id/feature_id` é criada por H-020 e nenhum campo do contrato `address-suggest` vai à persistência. O servidor não distingue "escolhido" de "digitado": ambos são texto do usuário.

## 4. Limites, contador de cota e desligamento

### 4.1 Limite de taxa (CA-09) `[PROPOSTA]`
Reutiliza `private.rl_check/rl_hit` (`[VERIFICADO]`; ADR-014, tudo em Postgres, chaves como HMAC): **30 consultas por 60 s** por principal (rascunho/nonce ou usuário; balde de 10 s, janela grosseira) e **60 por 60 s por IP-HMAC** (NAT). `rl_check` antes, `rl_hit` só depois de aceita. Excedente: `429` com `Retry-After`, corpo `texto_livre/limite`, **sem** chamar o Mapbox e sem consumir cota; o campo fica em texto livre por 60 s, **sem mensagem**. Chaves usam `PEPPER_EMAIL_HMAC`-família já existente (nunca IP ou nonce em claro).

### 4.2 Contador mensal e desligamento (CA-08)
Reutiliza `ops.external_quota` (`service='mapbox_geocoding_temp'`, `period='mes'`, `period_start` = 1º dia do mês UTC; já tem `used`, `soft_limit`, `hard_limit`, `breaker_state`, `alert_level`, `alerted_at` e `CHECK used <= hard_limit`).
- Função `private.mapbox_temp_quota_take(p_now)` (security definer, `search_path=''`, execute só `app_system`): cria a linha do mês se faltar; `UPDATE ... SET used = used + 1 WHERE used < hard_limit RETURNING`; atômico, sem leitura-depois-escrita. Sem linha atualizada ⇒ `breaker_state='aberto'`, `alert_level=2`, retorna `ok=false`. Ao cruzar `soft_limit` pela primeira vez: `alert_level=1`, `alerted_at=now`, retorna `novo_alerta=true`.
- **Reserva antes da chamada, contando também as que falham** (conservador: a Mapbox pode cobrar tentativas). Limitações: o contador conta **requisições do FastPro**; o que a Mapbox contabiliza pode diferir `[NÃO VERIFICADO]`, daí a margem.
- **Valores `[PROPOSTA]`, ajustados em relação ao PO:** produção **alerta 70.000, desliga 93.000**; desenvolvimento **alerta 1.500, desliga 2.000**. Motivo: desenvolvimento e produção **dividem a mesma conta Mapbox** (100.000 gratuitas por conta) e cada ambiente só vê o seu contador; a soma dos tetos (93.000 + 2.000 = 95.000) preserva a margem de 5.000 abaixo de 100.000. Valores por `app_config`/linha semeada; ajustáveis sem deploy.
- **Alerta:** `novo_alerta` ⇒ evento de log `mapbox_quota_alert` (`count`, nível) e e-mail à operação pela fila de H-092 (em desenvolvimento só Mailpit; **sem envio real**, regra do projeto). Sem duplicar: um alerta por `alert_level` por mês.
- **Desligado:** resposta `texto_livre/cota` (200, **sem mensagem de erro**, CA-08); o campo aceita só texto; volta sozinho no 1º dia do mês seguinte (nova linha, `breaker_state='fechado'`). Reabrir antes disso: `UPDATE` manual da linha (procedimento no runbook, não é rota).
- Custo no banco: uma escrita por consulta; aceitável no volume de MVP (≈ 3 a 6 consultas por endereço digitado). Se o plano gratuito do banco apertar, a mitigação é reservar em lotes (ex.: 20) por chamada de função, ao custo de precisão `[PROPOSTA]`, não adotada agora.

## 5. Erros e tratamento sem vazar endereço (CA-10..13)

| Situação | Resposta ao navegador | Código de log (`error_code`) |
|---|---|---|
| Entrada inválida (curta, longa, formato) | 400 `entrada_invalida` | `invalid_input` |
| Fora de rascunho / sem principal | 403 `not_draft` | `not_draft` |
| Limite de taxa | 429 `texto_livre/limite` (silencioso) | `rate_limited` |
| Cota no teto | 200 `texto_livre/cota` (silencioso) | `quota_off` |
| Interruptor desligado / porta não ligada | 200 `texto_livre/desligado` ou 503 | `disabled` |
| Mapbox: tempo esgotado, 5xx, 401/403 (token), 429, JSON inesperado | 200 `texto_livre/indisponivel`; **UI mostra a mensagem neutra** "Não foi possível sugerir endereços agora. Digite o endereço normalmente." | `provider_timeout`, `provider_5xx`, `provider_auth`, `provider_429`, `provider_shape` |

Regras de vazamento (CA-12, CA-13; ADR-013 `[VERIFICADO]` allowlist):
- Log do fluxo usa **só** campos já permitidos: `request_id`, `route`, `method`, `status`, `duration_ms`, `error_code`, `count` (nº de itens), `resource_id` (pseudônimo do rascunho). Nenhum campo novo na allowlist.
- **A URL do Mapbox contém o texto e o token**: o cliente HTTP é envolvido de modo que **nenhuma mensagem, `cause`, URL ou corpo de erro** da biblioteca seja repassado ao logger; o adaptador converte qualquer exceção em um `error_code` fixo e descarta o resto.
- O erro 4xx/5xx do Mapbox não é refletido ao navegador (nem corpo nem código). Logs da plataforma não veem o texto porque a rota é POST sem texto em URL.
- Sem tratamento de erro "tentar de novo": nenhum laço, nenhuma fila.
- Texto digitado ao Mapbox é dado pessoal enviado a terceiro: ver risco 4.

## 6. Testes para o DEV (sem rede real)

**Portas injetadas:** `GeocodingTempPort`, `DraftGatePort`, `RateLimitPort`, `QuotaPort`, `Clock`. Provedor simulado com cenários: ok (5 itens, **com** coordenadas e `mapbox_id` na resposta bruta para provar a remoção), vazio, tempo esgotado, 500, 401/403, 429, JSON malformado, item sem rótulo. Um *guard* global faz `fetch`/`http.request` **falharem** o teste se algo sair para fora; o adaptador real é testado com `fetch` injetado e fixtures sintéticas feitas à mão (marcadas assim; forma real `[NÃO VERIFICADO]`).

| # | Teste | CA |
|---|---|---|
| 1 | Rascunho recebe itens; qualquer outro estado ⇒ 403 e **zero** chamadas ao provedor | 01, 02 |
| 2 | Resposta tem só `mode/items[].label`; nenhuma chave nem número com cara de coordenada; sem `mapbox_id` | 03, 04 |
| 3 | Adaptador nunca envia `permanent`; usa `no-store`; não repassa cookie/IP | 03, 05 |
| 4 | UI com relógio falso: `<3` sem consulta; rajada ⇒ 1 consulta após 300 ms; aborta a anterior; ignora resposta velha | 07 |
| 5 | UI: escolher/Esc/blur/limpar descarta lista; espiões provam **nenhuma** escrita em storage/IndexedDB/Cache | 05 |
| 6 | Texto digitado sem escolha segue no formulário e o envio não é bloqueado | 06, 10 |
| 7 | Taxa: 31ª em 60 s ⇒ 429, provedor não chamado, cota não consumida; UI silenciosa por `retry_after_s` | 09 |
| 8 | Banco (`db:test`): `mapbox_temp_quota_take` atômica sob concorrência (N paralelas ⇒ `used` ≤ `hard_limit`); alerta emitido **uma vez** em 70.000; trava em 93.000; novo mês reabre; RLS/grants | 08 |
| 9 | Cada falha do provedor ⇒ `texto_livre/indisponivel`, UI mostra a mensagem neutra, **sem retentativa** (1 chamada) | 10, 11 |
| 10 | Teste de log (T-11): endereço sintético "canário" em fluxo de erro e de sucesso; reprova se aparecer em **qualquer** log, mensagem de erro ou resposta | 12, 13 |
| 11 | Estático: nenhuma coluna de coordenada/`mapbox_id` em migrações de H-020; CSP das páginas só `connect-src 'self'`; `MAPBOX_ACCESS_TOKEN_SERVER` e valor do token ausentes de bundles do cliente e de logs | 03, 14 |
| 12 | Porta real não ligada ⇒ 503 e UI em texto livre | 01 |

`check:all` (`check:logs`, `check:secrets`, `check:boundaries`) deve continuar verde; as chaves novas de ambiente vão ao `.env.example` com valor vazio. **Smoke real** com token (uma consulta manual, sem automação, sem registrar a resposta) fica como etapa de execução de dev e não entra no CI.

## 7. Entrega proposta ao DEV

`packages/contracts/src/address-suggest.ts` (tipos de pedido/resposta e códigos) · `apps/api/src/geo/` (rota, serviço, adaptador Mapbox, portas) · migração `ops_mapbox_temp_quota` com `.down.sql` em `supabase/rollbacks/` · `packages/ui` (`AddressField` e controlador) · testes acima · `.env.example` (`ADDRESS_SUGGEST_ENABLED`, tetos). Padrões de rota, cabeçalhos e `AppOptions` como em `apps/api/src/app.ts`. Ordem: contrato → migração/função de cota e teste → serviço com provedor simulado → rota → componente.

## 8. Riscos e dúvidas

**Riscos**
1. **Token de servidor não restringível por origem** `[NÃO VERIFICADO]`: se vazar, o consumo corre fora do contador. Mitigação: token dedicado de escopo mínimo, só em variável de ambiente, rotação, teto abaixo de 100.000 e acompanhamento manual da conta (S-04 R3). Sem cartão na conta, a cobrança de excedente não ocorre, mas o comportamento acima de 100.000 não foi observado.
2. **Contador diverge da Mapbox** (contas compartilhadas, chamadas fora do app, retentativas internas): margem de 5.000 e tetos por ambiente.
3. **Mais carga no servidor** (cada tecla passa pela função serverless; limites da Vercel Hobby `[NÃO VERIFICADO]`): debounce, 3 caracteres, limite por principal e IP, interruptor de emergência.
4. **LGPD:** o texto digitado vai à Mapbox. `[PENDENTE JURÍDICO]` mencionar no aviso de privacidade; sem IP, sem identificador do usuário enviados.
5. **Proxy como geocodificador aberto** (S-04 §2.7.1: não revender/ressindicar): mitigado por porta de rascunho/sessão, limites, resposta só com rótulos e sem coordenada.
6. **Forma real da resposta v6** `[NÃO VERIFICADO]`: adaptador defensivo (item sem rótulo é descartado; formato fora do esperado ⇒ `provider_shape`).
7. **Condição de corrida na linha única do contador**: atômico por `UPDATE ... WHERE used < hard_limit`; contenção só em pico alto (ver §4.2).

**Dúvidas ao Orquestrador (não bloqueantes; o líder consolida e numera)**
1. **Ordem H-020/H-025:** a porta `DraftGate` adia a prova ponta a ponta de CA-01/CA-02 para H-025 (e H-036). Alternativa: criar antes uma ligação mínima. Recomendação: porta, com os critérios herdados registrados em H-025 e H-036.
2. **Tetos por ambiente** (produção 93.000, desenvolvimento 2.000, por conta compartilhada). Recomendação: adotar.
3. **Alerta por e-mail à operação** (via H-092, em dev só Mailpit): confirmar destinatário no lançamento; hoje só log e Mailpit.
4. **Aviso de privacidade** sobre envio do texto à Mapbox: confirmar redação no jurídico antes do lançamento.
5. **Token de servidor dedicado e conta Mapbox** (dúvida 1 do PO): execução, não desenho; temporário não exige cartão (S-04 §3). Sem isso o smoke real não roda, mas o desenvolvimento e os testes seguem com provedor simulado. A dúvida 7 do PO (confirmação sobre casamento por raio) segue para antes de H-021.

## 9. Evidências e estado

Fonte: leitura dos documentos e do repositório citados. Nenhum teste ou build (documento). Coluna do Project não consultada (sem `gh`, por instrução); coluna Arquitetura informada pelo Orquestrador. Árvore de trabalho tinha 2 arquivos não rastreados de outra Issue (`catalog_drop_audit_fk`), **não incluídos** neste commit.
