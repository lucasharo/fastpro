# Desenho: e-mail em DEV/teste redirecionado para a conta de teste (Issue #160)

- **Issue:** #160 · **Workflow:** WF-03 · **Etapa:** Arquitetura · **EXEC-ID:** EXEC-ARQ-160-20261121
- **Repositorio:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Entrada:** `186-REFINO-EMAIL-REDIRECIONADO.md` (PO). Perguntas 1001, 1002 e 1003 adotadas na opcao (a). Decisao 1000 do dono.
- **Natureza:** somente documento. Nenhum codigo, quadro ou `11-DECISOES.md` foi alterado. Nenhuma pergunta ao usuario.
- **Etiquetas:** `[V]` verificado por leitura de codigo nesta rodada · `[NV]` nao verificado (vira verificacao do Dev).

---

## 1. Fatos confirmados no codigo

| Ref. | Fato | Onde `[V]` |
|---|---|---|
| F-1 | O unico ponto que fala com a API do Resend e `ResendProvider.attempt`. A recusa `destinatario_nao_permitido` esta nele (remetente de teste e destino diferente da conta). | `packages/email/src/resend.ts` linhas 124 a 132 |
| F-2 | O destinatario original chega ao provedor em `message.to`, resolvido no momento do envio. Pipeline: `d.directory.resolve(row.recipientUserId)` e depois `d.provider.send({ to: dir.email, ..., idempotencyKey: row.dedupeKey })`. Nada de endereco e gravado na fila (so referencia). | `packages/db/src/notifications.ts` linhas 540 e 575 a 580 |
| F-3 | O desafio de login e de step-up passa por `ChallengeEmailProvider`, que repassa `...message` (portanto o mesmo `to` e a mesma `idempotencyKey`) ao provedor interno e so grava `markDelivered` com `aceito`. O endereco cifrado do desafio e resolvido por `ChallengeRecipientDirectory`. Nao precisa mudar. | `packages/db/src/challenges.ts` linhas 628 a 692 e 696 |
| F-4 | A reserva de cota ocorre no pipeline, antes de `provider.send`, e so se `!row.quotaReserved`. O provedor nao toca a cota. Redirecionar nao muda a contagem: continua uma chamada HTTP por envio. | `notifications.ts` linhas 556 a 580 |
| F-5 | `providerSink` (profissional) chama `provider.send` direto, com `templateKey` e `params`. Nenhuma reserva de cota foi vista nesse caminho. Isso e anterior a #160 e nao muda com ela. | `packages/email/src/professional-mail.ts` linhas 47 a 68 `[V]`; reserva nesse caminho `[NV]` |
| F-6 | Chave de idempotencia enviada ao Resend: `idempotencyToken(message.idempotencyKey)` (sha256 da chave original). Independe do destino. | `idempotency.ts`, `resend.ts` linha 152 |
| F-7 | Os renderizadores (`createAuthAwareRenderer`, profissional, lembretes) sao encadeados por `render(templateKey, params)` e devolvem `{ subject, text }`. Nenhum recebe o destinatario. O renderizador base ignora `params`. | `auth-renderer.ts` linhas 99 a 109; `renderer.ts`; `resend.ts` linha 146 |
| F-8 | Resultados de erro (`SendResult`) trazem so codigos fixos. `HttpTransportError` traz so um `kind`. O corpo da resposta do Resend nao e repassado. Nenhum logger e chamado no pacote de e-mail. | `resend.ts` linhas 65 a 117 |
| F-9 | `isSafeAddress` rejeita espaco, `@` duplo, `<>`, `,` e `;` (e portanto quebra de linha). Roda sobre `message.to` antes da renderizacao. Isso protege a linha que sera inserida no corpo. | `address.ts` linhas 2 e 17; `resend.ts` linha 144 |
| F-10 | Conjuntos de `APP_ENV`: `local, test, preview, staging, production`; `createEmailProvider` exige valor exato (so `trim`). | `env.ts` linha 5; `select.ts` linhas 20 e 21 |
| F-11 | Testes que hoje esperam recusa em DEV com remetente de teste e destino fora da conta: `security.test.ts` linhas 113 a 125 (`APP_ENV: 'local'`) e `apps/api/tests/h097-ca08-ponta-a-ponta.test.ts` linhas 136 a 147 (`APP_ENV: 'local'`, linha 83). Os de `resend.test.ts` (linhas 33 a 39) e `security.test.ts` linhas 96 a 110 usam `APP_ENV: 'production'` e continuam validos. | leitura direta |
| F-12 | `check:logs` e uma varredura estatica de codigo de producao (sem testes): reprova `console`, chamadas de logger com campos sensiveis e interpolacao sensivel. O desenho nao adiciona chamada de logger. | `scripts/check-logs.mjs` |

---

## 2. Decisoes

| Nº | Decisao | Alternativa descartada |
|---|---|---|
| D-188-01 | **Ponto unico de mudanca:** uma funcao pura `decidirDestino` em arquivo novo `packages/email/src/destination.ts`, chamada somente por `ResendProvider.attempt`. Nenhum outro modulo (pipeline, desafio, sink, renderizador) conhece o redirecionamento. | Redirecionar no pipeline ou no renderizador: espalha a regra e arrisca esquecer um caminho (profissional, step-up). |
| D-188-02 | **Conjunto de ambientes (1001a):** constante `REDIRECT_APP_ENVS = ['local', 'test'] as const` em `env.ts`. Comparacao exata apos `trim`, sem `toLowerCase` (igual a `createEmailProvider`). `APP_ENV` ausente, vazio, desconhecido, `preview`, `staging` ou `production` nunca redirecionam (fail-closed). Esta lista **nao** reaproveita a de `publish-composicao.ts` (decisao 239 do Mapbox): sao regras independentes. | Reutilizar a lista do Mapbox: acopla duas regras sem relacao. |
| D-188-03 | **Ordem de decisao** (primeira condicao que bate vence): (1) remetente diferente do remetente de teste: `direto` (as travas de dominio continuam em `attempt`); (2) conta ausente ou insegura (`isSafeAddress` sobre o valor com `trim`): `recusado`; (3) destino igual a conta (`sameAddress`): `direto`, sem marcador, em **qualquer** `APP_ENV` (comportamento de hoje, nao vaza nada); (4) `APP_ENV` fora de `REDIRECT_APP_ENVS`: `recusado`; (5) senao: `redirecionado` com `to` = conta (`trim`). | Checar o ambiente antes do destino igual a conta: mudaria o comportamento atual de `production` com destino igual a conta, que os testes de `resend.test.ts` usam. |
| D-188-04 | **Contrato de saida:** `{ kind: 'direto' } | { kind: 'redirecionado'; to: string } | { kind: 'recusado'; code: 'destinatario_nao_permitido' }`. O codigo e o mesmo de hoje e nunca carrega endereco. | Novo codigo de recusa (`ambiente_nao_permitido`): quebraria `T-H93-04` e o mapeamento da fila sem ganho. |
| D-188-05 | **O `EmailMessage` nao muda.** `message.to` continua o original em todas as camadas (CA-160-09). Somente o campo `to` do corpo JSON da chamada HTTP recebe a conta. | Reescrever `message.to` antes do provedor: o desafio, o HMAC e a anti-enumeracao veriam outro destinatario. |
| D-188-06 | **Marcador (1002a):** funcao pura `marcarRedirecionado(rendered, originalTo)` no mesmo arquivo. Assunto: `"[Teste] " + subject` (sem endereco). Corpo: primeira linha `"[Teste] Este e-mail era destinado a: <original>. Foi redirecionado para a conta de teste."`, uma linha em branco, depois o texto do modelo intacto. Aplicado em `attempt` **depois** de `renderer.render` e **antes** de `JSON.stringify`, somente quando o resultado e `redirecionado`. Cobre todos os modelos e os renderizadores nao mudam (nem `templateVersion`). | Marcador nos renderizadores: 3 arquivos e risco de esquecer o base. |
| D-188-07 | **Idempotencia:** `Idempotency-Key` e `dedupe_key` nao mudam (F-6). O reenvio redirecionado com a mesma chave gera o mesmo token e o Resend nao duplica. A chave nasce por evento/desafio e por destinatario (`nc:evento:usuario:...`, `ac:<id do desafio>`), entao dois cadastros distintos nao colidem na conta compartilhada `[V]` para `ac:` e `[NV]` para o resto (testar no Dev, R-188-05). | Incluir o destino na chave: quebraria a deduplicacao do pipeline. |
| D-188-08 | **Sem log e sem erro com o original (R8):** o endereco original so entra na string do corpo JSON enviada ao transporte. Nenhum `SendResult`, codigo, `reason_code`, evento de `providerSink`, auditoria ou chamada de logger o recebe. Nenhuma chamada nova de logger. `isSafeAddress(message.to)` continua rodando antes da renderizacao (F-9), entao o original nao pode injetar linha no corpo. | Mascarar o endereco no corpo: o objetivo da 1002a e justamente mostrar o original ao dono. |
| D-188-09 | **Sem interruptor.** A condicao e so configuracao (`APP_ENV`, `EMAIL_FROM`, `RESEND_ACCOUNT_RECIPIENT`). Sem flag, tela ou variavel nova. | Variavel `EMAIL_REDIRECT=on`: proibida pela regra do projeto. |
| D-188-10 | **Falha de partida em producao com remetente de teste: nao entra.** A proposta do PO (R-160-02) quebraria `resend.test.ts` e `security.test.ts`, que usam `production` com o remetente de teste, e e assunto de producao (fora do escopo). Em runtime, `production` ja recusa qualquer destino diferente da conta (D-188-03, passo 4). Fica como pendencia de producao registrada, nao como tarefa. | Lancar `EmailConfigError` em `createEmailProvider`: fora do escopo e com custo de reescrever testes. |
| D-188-11 | **Cota (CA-160-06):** nenhuma mudanca. A reserva continua no pipeline (F-4); o redirecionamento so troca o campo `to` e adiciona o marcador, e faz uma chamada HTTP por envio. A cobertura de cota e feita por teste de contagem de chamadas e pelos testes de banco existentes sem alteracao. | Contar o redirecionamento em separado: inventa um contador que nao existe. |
| D-188-12 | **Prova da #157 (1003a):** a guarda do script da #157 (decisao 980) passa a aceitar qualquer e-mail em DEV; a prova confirma pelo identificador do provedor que a mensagem foi para a conta e que o original esta no corpo; teto de 4 e-mails e uma execucao por dia mantidos. Isto e ajuste do desenho da #157, nao de codigo da #160. | Manter a guarda: contradiz a decisao 1000. |

---

## 3. Contrato

### 3.1 `packages/email/src/destination.ts` (novo)

```ts
export type DestinoDecisao =
  | { readonly kind: 'direto' }
  | { readonly kind: 'redirecionado'; readonly to: string }
  | { readonly kind: 'recusado'; readonly code: 'destinatario_nao_permitido' };

export function decidirDestino(input: {
  readonly appEnv: string | undefined;          // env.APP_ENV
  readonly from: string | null;                 // extractAddress(EMAIL_FROM)
  readonly recipient: string;                   // message.to (original)
  readonly accountRecipient: string | undefined; // env.RESEND_ACCOUNT_RECIPIENT
}): DestinoDecisao;

export function marcarRedirecionado(
  rendered: RenderedEmail,
  originalTo: string,
): RenderedEmail;
```

Tabela de verdade (de `decidirDestino`):

| `from` | conta | destino | `appEnv` | resultado |
|---|---|---|---|---|
| diferente do remetente de teste | qualquer | qualquer | qualquer | `direto` |
| remetente de teste | ausente ou insegura | qualquer | qualquer | `recusado` |
| remetente de teste | valida | igual a conta | qualquer (inclui `production`) | `direto` |
| remetente de teste | valida | diferente | `local` ou `test` | `redirecionado` (to = conta) |
| remetente de teste | valida | diferente | `preview`, `staging`, `production`, vazio, ausente, desconhecido | `recusado` |

Funcao pura: sem leitura de `process.env`, sem relogio, sem I/O, sem log.

### 3.2 Alteracao em `ResendProvider.attempt` (unico ponto)

Antes (linhas 128 a 140): `if (from === RESEND_TEST_SENDER) { if (!sameAddress(...)) return recusa(...) } else { checagens de dominio }`.

Depois:

1. `const destino = decidirDestino({ appEnv: this.env.APP_ENV, from, recipient: message.to, accountRecipient: this.env.RESEND_ACCOUNT_RECIPIENT })`.
2. Se `from === RESEND_TEST_SENDER` e `destino.kind === 'recusado'`: `return recusa(destino.code)`.
3. Se `from !== RESEND_TEST_SENDER`: as checagens de dominio verificado ficam como estao (mesma ordem do desenho 37 §3).
4. Chave ausente (`segredo_ausente`) e `isSafeAddress(message.to)` (`destinatario_invalido`) permanecem na mesma ordem, **antes** de qualquer renderizacao.
5. `let rendered = renderer.render(...)`; se `destino.kind === 'redirecionado'`: `rendered = marcarRedirecionado(rendered, message.to)`.
6. Corpo JSON: `to: destino.kind === 'redirecionado' ? destino.to : message.to`. Cabecalhos, `Idempotency-Key`, `from`, timeout e `classifyResendResponse` sem mudanca.

### 3.3 Outros arquivos

- `env.ts`: constante `REDIRECT_APP_ENVS` e comentario de `RESEND_ACCOUNT_RECIPIENT` ("destino de entrega do remetente de teste; em local e test recebe tambem os e-mails redirecionados").
- `index.ts`: exportar `decidirDestino`, `marcarRedirecionado`, `DestinoDecisao`.
- Comentarios de cabecalho de `resend.ts`, `select.ts`, `address.ts` e `.env.example` (linhas 62 a 71, que citam "development, dev ou test" e nao batem com `env.ts`): so texto, sem mudar valores. (R-160-09)

Nao mudam: `challenges.ts`, `privacy-dsr-step-up.ts`, `notifications.ts`, `professional-mail.ts`, renderizadores, politica, cota, banco, migracoes, rotas.

---

## 4. Estados (confirmacao do refino)

| Estado | Condicao | `SendResult` | Chamadas HTTP |
|---|---|---|---|
| E1 redirecionado | passo 5 da D-188-03 | `aceito` (id do provedor) | 1, `to` = conta, marcador no assunto e no corpo |
| E2 destino e a conta | passo 3 | `aceito`, sem marcador | 1 |
| E3 ambiente fora de `local`/`test` | passo 4 | `recusa_permanente` `destinatario_nao_permitido` | 0 |
| E4 conta ausente ou insegura | passo 2 | `recusa_permanente` `destinatario_nao_permitido` | 0 |
| E5 sem chave | `segredo_ausente` | `nao_configurado` | 0 |
| E6 dominio verificado | `from` no dominio | envio direto, sem marcador | 1 |
| E7 cota atingida | pipeline | `adiado_cota`, antes do provedor | 0 |
| E8 erros da API | 403, 429, 5xx, tempo, rede | mapeamento atual (sem mudanca) | 1 |

---

## 5. Testes (todos offline, com `FakeHttp`; so caminho feliz no nivel de API)

Casos novos em `packages/email/tests/destination.test.ts` (funcao pura) e `packages/email/tests/redirect.test.ts` (provedor):

| Nº | Caso | Verifica |
|---|---|---|
| T-188-01 | `decidirDestino`, tabela da secao 3.1, todas as linhas e todos os `APP_ENVS` mais vazio, ausente, `LOCAL` (maiusculas) e `dev` | resultado conforme a tabela; maiusculas e `dev` recusam (fail-closed) |
| T-188-02 | CA-160-01: `local` e `test`, remetente de teste, destino qualquer, 200 com id | `aceito`; 1 chamada; `JSON.parse(body).to` = conta; `Idempotency-Key` igual em dois envios com a mesma chave |
| T-188-03 | CA-160-02: `production`, `preview`, `staging` com destino fora da conta | `recusa_permanente` `destinatario_nao_permitido`; 0 chamadas; resultado sem o endereco |
| T-188-04 | CA-160-03: conta ausente; conta vazia; conta insegura (`a b@x`); `APP_ENV` vazio, ausente, `dev`, `LOCAL` | recusa e 0 chamadas |
| T-188-05 | CA-160-10: remetente de dominio verificado, `local` e `production` | `to` original; sem marcador no assunto nem no corpo; sem redirecionamento |
| T-188-06 | CA-160-04: destino `alvo.original@exemplo.test` com respostas 403 (corpo que repete o endereco), 429, 400, 500, tempo esgotado e excecao de transporte, espiao em `console` e na saida | serializacao dos resultados, codigos (`CODE_PATTERN`) e saidas capturadas nao contem o original; o provedor serializado e `{"name":"resend"}`. O original so existe no corpo capturado pelo `FakeHttp` |
| T-188-07 | CA-160-05: corpo capturado | primeira linha `[Teste] Este e-mail era destinado a: <original>...`; assunto comeca com `[Teste] ` e nao contem o original; texto do modelo preservado apos a linha em branco |
| T-188-08 | CA-160-09: provedor espiao na porta | o `EmailMessage` entregue ao provedor mantem `to` original; so o corpo HTTP leva a conta |
| T-188-09 | CA-160-07: uma chave de `EMAIL_TYPE_POLICY` por vez, com parametros validos de cada modelo, renderizador composto real (auth + profissional + lembretes) | todas `aceito`, 1 chamada cada, `to` = conta, marcador presente; falha se um tipo novo nao tiver parametros de teste |
| T-188-10 | CA-160-06: dois envios com a mesma chave e uma resposta de erro seguida de nova tentativa | 1 chamada por tentativa, mesmo token; e unitario `decideQuota` existente continua passando sem alteracao |
| T-188-11 | destino com quebra de linha ou espaco em `local` | `destinatario_invalido`, 0 chamadas (o marcador nunca recebe endereco inseguro) |
| T-188-12 | chaves distintas para destinatarios distintos na conta compartilhada | tokens de idempotencia distintos (R-188-05) |

**Testes existentes a atualizar de forma explicita (registrar na Issue como mudanca de comportamento pela decisao 1000):**

1. `packages/email/tests/security.test.ts` linhas 113 a 125 (`destino fora da conta e recusado antes da API, em local`): vira "destino fora da conta e redirecionado para a conta, em local": `aceito`, 1 chamada, `to` = conta, `JSON.stringify(res)` sem `outra.pessoa`. Os casos com `APP_ENV: 'production'` (linhas 96 a 110) ficam como estao. O caso de linhas 127 em diante (sem chave) fica como esta.
2. `apps/api/tests/h097-ca08-ponta-a-ponta.test.ts` linhas 136 a 147: com `APP_ENV: 'local'`, o destino `CLIENTE` passa a resultar em `aceito`, 1 chamada, `to` = `CONTA`, corpo com o original; resposta sem o endereco. O terceiro caso (sem conta, linhas 162 a 171) fica como esta e prova a falha fechada.
3. `[NV]` confirmar por execucao e ajustar so se falharem: `packages/email/tests/professional-mail.test.ts` (linha 178, `destinatario_nao_permitido`; ambiente na linha 128), `packages/email/tests/transport.test.ts` (linhas 56 e 82), `apps/api/tests/composicao-integracoes.test.ts` e `professional-composicao.test.ts`. O Dev roda as suites completas de `packages/email` e `apps/api` e so edita o que falhar, anotando cada edicao.
4. `packages/db/tests/notifications-email.dbtest.mjs` (T-H93-04) usa provedor falso e nao muda.

---

## 6. Fatias de Dev (curtas, uma por vez, cada uma com prova)

| Fatia | Conteudo | Prova |
|---|---|---|
| S1 | `REDIRECT_APP_ENVS` em `env.ts`; `destination.ts` com `decidirDestino` e `marcarRedirecionado`; export em `index.ts`; `destination.test.ts` (T-188-01, T-188-11 na parte pura) | `corepack pnpm --filter @fastpro/email test` verde, com contagem e codigo de saida; `typecheck` do pacote |
| S2 | Ligar em `resend.ts` (secao 3.2); `redirect.test.ts` T-188-02 a T-188-08, T-188-10 a T-188-12; atualizar `security.test.ts` (item 1) | suite do pacote de e-mail verde; `corepack pnpm check:logs` e `check:secrets` com codigo 0 |
| S3 | Atualizar `h097-ca08-ponta-a-ponta.test.ts` (item 2); T-188-09 (todos os tipos); verificar os `[NV]` do item 3; teste de resposta igual (CA-160-08) com `pedirLogin` para destino fora da conta e para a conta | `corepack pnpm --filter @fastpro/api test` verde; contagem registrada |
| S4 | Comentarios de cabecalho (`resend.ts`, `select.ts`, `address.ts`, `env.ts`) e `.env.example` (so texto); nota curta no refino da #157 para a 1003a | `corepack pnpm lint`, `typecheck` e `check:all` com codigo 0; `git diff` so de comentario nos arquivos de S4 |

Evidencia na Issue: comando, contagem e codigo de saida de cada fatia, sem simular resultado. QA no fim: so caminho feliz por chamada de servico, sem tela (regra do projeto).

---

## 7. Riscos

| Nº | Risco | Tratamento |
|---|---|---|
| R-188-01 | **Redirecionamento ligado fora de DEV.** | D-188-02 e D-188-03: conjunto fechado de dois valores, comparacao exata, remetente exato, conta valida, ordem fail-closed; T-188-01, T-188-03 e T-188-04 provam. |
| R-188-02 | **Vazamento do original em log, erro, auditoria ou fila.** | D-188-08: so o corpo HTTP o recebe; T-188-06; `check:logs` sem chamada de logger nova (F-12). |
| R-188-03 | **Codigo de acesso de qualquer cadastro de DEV chega a conta do dono.** Aceito pela decisao 1000 so em DEV; validade de 15 minutos e uso unico seguem. | Nao usar dado real de terceiro em DEV. |
| R-188-04 | **Cota do Resend (100 por dia) vira a barreira unica de DEV**, pois tudo cai na mesma conta. | Cortes por classe e alertas atuais (F-4); teto de 4 e-mails por execucao da #157. Sem mudanca. |
| R-188-05 | **Colisao de idempotencia na conta compartilhada** para chaves nao derivadas de evento ou desafio. | `ac:` e por desafio `[V]`; T-188-12 prova distincao; chaves de `nc:` `[NV]`, Dev confere nos construtores do pipeline. |
| R-188-06 | **Testes antigos quebrarem** por esperar a recusa em DEV. | Secao 5 (itens 1 a 3): atualizacao explicita e registrada. |
| R-188-07 | **Texto do marcador alterando snapshots de e-mail** de outros testes. | Marcador so em `redirecionado`; os testes de renderizador nao passam pelo provedor e nao mudam. |
| R-188-08 | **Cota nos caminhos diretos** (`providerSink`, F-5). | Anterior a #160; fora desta Issue; registrar `[NV]` para a Arquitetura da #157 se a prova usar o caminho do profissional. |
| R-188-09 | **Falha de partida em producao nao implementada** (D-188-10). | Em runtime ja recusa; pendencia de producao registrada para quando a producao for pedida. |
| R-188-10 | **Texto do profissional**: `providerSink` ignora assunto e texto do adaptador e usa o renderizador do provedor. | O marcador e aplicado depois da renderizacao e vale igual; Dev confirma o renderizador composto em T-188-09. |

---

## 8. Fora de escopo (confirmado)

Producao, dominio, deploy, interruptor, cota, cooldown, pipeline, banco, migracoes, rotas, backup. Nenhuma pergunta ao usuario e necessaria: 1001 a 1003 ja estao adotadas na opcao (a).

## 9. Proximo passo

Desenvolvimento, na ordem S1 a S4, uma fatia por vez. Ordem do quadro: Product Owner (concluido), Arquitetura (este documento), Desenvolvimento, Code Review, QA, Aguardando aprovacao. Nenhum cartao foi movido nesta etapa.
