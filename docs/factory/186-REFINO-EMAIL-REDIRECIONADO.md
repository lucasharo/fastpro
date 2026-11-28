# Refino: e-mail em DEV/teste redirecionado para a conta de teste (Issue #160)

- **Issue:** #160 `[E11] E-mail em DEV/teste: cadastro com qualquer e-mail e envio redirecionado para a conta de teste` · **Prioridade:** alta (decisão do dono, 1000)
- **Workflow:** WF-03 · **Etapa:** Product Owner · **EXEC-ID:** EXEC-PO-160-20261121
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init` · **Data:** 2026-11-21
- **Natureza:** somente documento. Nenhum código, teste, banco, quadro ou `11-DECISOES.md` foi alterado. Perguntas vão ao líder (Orquestrador), numeradas de 1001 a 1003.
- **Etiquetas:** `[V]` verificado por leitura nesta rodada · `[NV]` não verificado (vira verificação do Dev) · `[PROPOSTA]` deste refino, a validar.

---

## 0. Fontes lidas

- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md`: #160 consta na coluna Product Owner (linha 70) `[V]`. Não está em Aguardando aprovação.
- `docs/factory/11-DECISOES.md`: decisão 1000, linha 1106 (texto do dono, 2026-11-21) `[V]`; decisões 980 a 985 da #157, linha 1099 `[V]`.
- `packages/email/src/resend.ts` (cabeçalho, linhas 1 a 4; `send`, linhas 110 a 117; `attempt`, linhas 124 a 163; trava do remetente de teste, linhas 128 a 132) `[V]`.
- `packages/email/src/address.ts` (`RESEND_TEST_SENDER`, linha 5; `sameAddress`, linhas 30 a 33) `[V]`.
- `packages/email/src/env.ts` (`APP_ENVS`, linha 5: local, test, preview, staging, production; comentário de `RESEND_ACCOUNT_RECIPIENT`, linha 15) `[V]`.
- `packages/email/src/select.ts` (`createEmailProvider`, linhas 19 a 26) `[V]`.
- `packages/email/src/renderer.ts` (renderizador mínimo: ignora `templateKey` e `params`) `[V]`.
- `packages/email/src/auth-renderer.ts` (acesso_login, acesso_stepup, dsr_stepup: link e código) `[V]`; `reminder-renderer.ts` (prazo_t24, prazo_t0, acesso_trial_t3d, acesso_trial_t0) `[V]`.
- `packages/email/src/professional-mail.ts` (`providerSink`, linhas 47 a 68: chama `provider.send` com `templateKey` e `params`; falha vira evento sem destinatário) `[V]`.
- `packages/domain/src/notifications/policy.ts` (`EMAIL_TYPE_POLICY`, linhas 46 a 77) `[V]`; `quota.ts` (`PROVIDER_LIMITS`, linha 8; `QUOTA_CUTS`, linhas 20 a 25) `[V]`; `ports.ts` (`SendResult`, `EmailMessage`) `[V]`.
- `packages/db/src/challenges.ts` (envio de link e código, linhas 653 a 662 e 686 a 691; `markDelivered` só com `aceito`) `[V]`.
- `docs/factory/37-DESENHO-H093.md` (§2.4 dados sensíveis; §3 ordem de verificação) `[V]`; `59-DESENHO-H094.md` (contador por linha de envio) `[V]`.
- `docs/factory/180-REFINO-PROVA-PONTA-A-PONTA.md` (§5.4 cota e destinatário, linhas 262 a 268; R-157-02, linha 291) `[V]`.
- Testes existentes: `packages/email/tests/resend.test.ts` (remetente de teste com `APP_ENV: 'production'`, linhas 33 a 39; recusas, linhas 121 a 160) `[V]`; `packages/email/tests/security.test.ts` (`DEV_RESEND_ENV` com `APP_ENV: 'local'`, linhas 31 a 37; recusa em local, linhas 113 a 125) `[V]`; `apps/api/tests/h097-ca08-ponta-a-ponta.test.ts` (linhas 144 e 169 esperam `destinatario_nao_permitido`; `APP_ENV` usado não lido) `[NV]`; `packages/db/tests/notifications-email.dbtest.mjs` (T-H93-04, com provedor falso) `[V]`.
- `.env.example`, linhas 62 a 71: lista de `APP_ENV` e comentário que cita "development, dev ou test" como valores de desenvolvimento `[V]`. Esse comentário não bate com `env.ts` (ver risco R-160-09).
- Modelo de estrutura: `docs/factory/184-REFINO-DEFEITO-ENDERECO.md` (somente o sumário).

---

## 1. Objetivo

Em ambiente de desenvolvimento e teste, qualquer pessoa pode se cadastrar com qualquer e-mail, e o sistema entrega a mensagem na conta de teste do dono (`RESEND_ACCOUNT_RECIPIENT`), em vez de recusar o envio. Assim o fluxo de cadastro, login, verificação, lembretes e direitos do titular pode ser provado de ponta a ponta sem depender de um domínio verificado.

Em produção nada muda: a trava de domínio continua valendo e não há redirecionamento.

**Situação atual `[V]`:** com o remetente de teste `onboarding@resend.dev`, qualquer destino diferente da conta é recusado antes da chamada HTTP com o código `destinatario_nao_permitido` (`resend.ts`, linhas 128 a 132). Por isso, em DEV, um cadastro com e-mail que não seja o da conta nunca recebe código.

---

## 2. Escopo

**Dentro desta Issue**
1. Em `ResendProvider.attempt`, quando o envio é em modo de teste (ver regra R1), trocar a recusa por redirecionamento: o destinatário da chamada HTTP passa a ser `RESEND_ACCOUNT_RECIPIENT`.
2. Incluir o destinatário original no corpo da mensagem entregue (e um marcador no assunto, sem o endereço, conforme pergunta 1002).
3. Manter o `EmailMessage` recebido pelo provedor com o destinatário original. Só a chamada HTTP muda.
4. Testes vitest que provam os critérios da seção 7, e atualização explícita dos testes que hoje esperam a recusa em DEV (seção 8, R-160-07).
5. Atualizar os comentários de cabeçalho em `resend.ts`, `address.ts`, `env.ts` e `.env.example` que descrevem a regra antiga (sem mudar valores).

**Fora de escopo**
- Produção, domínio, remetente real, chaves de produção, deploy e Vercel.
- Qualquer interruptor, flag ou tela para ligar ou desligar o envio. A condição é de configuração de ambiente, sem interruptor (regra do projeto).
- Mudança na cota, nos cortes por classe (`QUOTA_CUTS`), no cooldown ou no pipeline de notificações.
- Mudança no cadastro ou no login (o que é digitado continua sendo a identidade).
- Alteração do fluxo de desafio (`challenges.ts`) além do necessário. Não é esperado mudar.
- Backup, restauração ou exportação de dados (fora do projeto).
- Refino da #157 em si (a regra da prova está na pergunta 1003, para a Arquitetura da #157).

---

## 3. Regras de negócio

- **R1. Condição de redirecionamento (fail-closed).** O redirecionamento só acontece quando **todas** as condições abaixo são verdadeiras, na ordem:
  1. `APP_ENV` está no conjunto de ambientes de desenvolvimento e teste (conjunto a decidir na pergunta 1001; recomendação: `local` e `test`);
  2. `EMAIL_FROM` é exatamente o remetente de teste `onboarding@resend.dev` (igualdade após `trim`, como hoje);
  3. `RESEND_ACCOUNT_RECIPIENT` está preenchido e é um endereço seguro (`isSafeAddress`);
  4. o destinatário original é diferente da conta (se for igual, o envio é normal, sem marcador).
  Se qualquer condição falhar, vale a regra atual: recusa `destinatario_nao_permitido` antes da API, sem chamada HTTP.
- **R2. Produção nunca redireciona.** Com `APP_ENV=production` (e, se a pergunta 1001 for adotada como recomendada, com qualquer valor fora do conjunto), a recusa é mantida. Nenhum caminho de código pode redirecionar sem passar por R1.
- **R3. Domínio verificado não redireciona.** Quando `EMAIL_FROM` usa o domínio verificado, a regra antiga vale: o destinatário não é restrito (trava só no remetente) e não há redirecionamento. `[V]` (`resend.ts`, linha 137 e teste de `resend.test.ts`, linha 106).
- **R4. Conteúdo entregue.** A mensagem entregue traz o destinatário original (ver pergunta 1002). Só o corpo recebe o endereço, por padrão.
- **R5. Identidade preservada.** O cadastro, o login, o HMAC do e-mail e a anti-enumeração usam o e-mail digitado. Nada disso muda `[V]` (o `to` do `EmailMessage` vem da camada de domínio e não é alterado).
- **R6. Idempotência.** A chave de idempotência enviada ao provedor continua derivada da chave original da mensagem (`idempotencyToken(message.idempotencyKey)`). Reenvio com a mesma chave não gera segundo e-mail `[V]`.
- **R7. Cota.** Cada chamada HTTP ao provedor conta como um envio, inclusive a redirecionada. A cota não é contada a menos. Nenhum corte muda `[V]`.
- **R8. Sem dado pessoal fora do corpo.** O endereço original não aparece em log, em código de erro, em resultado de `SendResult`, em `email_outbox`, em `notification_item` nem em auditoria. A tabela de envio guarda referência, não texto `[V]` (`09-MODELO-DADOS.md`, `recipient_email_ref`).

---

## 4. Estados e erros

| Estado | Condição | Resultado para a camada de domínio | Chamada HTTP |
|---|---|---|---|
| **E1 Redirecionado** | R1 verdadeira, destino diferente da conta | `aceito` (id do provedor) quando a API aceita | 1, com `to` = conta e corpo com o original |
| **E2 Destino é a conta** | R1 até o item 3, destino igual à conta | `aceito`, envio normal, sem marcador | 1, `to` = conta |
| **E3 Produção ou ambiente fora da lista** | `APP_ENV` fora do conjunto da R1 | `recusa_permanente` `destinatario_nao_permitido` (regra atual) | 0 |
| **E4 Conta não configurada ou inválida** | item 3 da R1 falha | `recusa_permanente` `destinatario_nao_permitido` | 0 |
| **E5 Chave ausente** | sem `RESEND_API_KEY` (após a trava do remetente) | `nao_configurado` `segredo_ausente` | 0 |
| **E6 Domínio verificado** | R3 | envio normal, sem redirecionamento | 1 |
| **E7 Cota atingida** | corte da classe atingido, no pipeline | adiado (`adiado_cota`), sem chamada | 0 |
| **E8 Erros da API** | 403, 429, 5xx, tempo esgotado, rede | mesmo mapeamento da tabela 4.1 de `37-DESENHO-H093.md`, sem mudança | 1 (com retentativa do pipeline) |

Códigos de erro continuam fixos (`CODE_PATTERN`). Nenhum código novo carrega endereço.

---

## 5. Efeito por tipo de e-mail

Todos os envios passam por `EmailProviderPort.send`, e a regra fica no provedor. Assim o redirecionamento vale para todos os tipos ao mesmo tempo.

| Tipo (`EMAIL_TYPE_POLICY`) | Classe | Categoria | Efeito em DEV com redirecionamento | Observação |
|---|---|---|---|---|
| `acesso_login` | auth | acesso | Link de uso único e código chegam à conta | Dado sensível no corpo (R-160-03) |
| `acesso_stepup` | auth | acesso | Código chega à conta | Mesmo risco |
| `dsr_stepup` | auth | acesso | Código de direitos do titular chega à conta | Mesmo risco; DEV só |
| `acesso_conta` | auth | acesso | Vai para a conta, sem parâmetros | Renderizador base `[NV]` |
| `verificacao` | critico | verificacao | Vai para a conta | Cota da classe crítica (corte 90 por dia) |
| `selecao`, `cancelamento`, `desistencia` | critico | seleção, cancelamento, desistência | Vai para a conta | Sem referência ao profissional (regra da política) |
| `aceite_aviso`, `aceite_resumo`, `mensagem_aviso`, `mensagem_resumo` | digest | aceite, mensagem | Vai para a conta, agrupado | Corte digest 85 por dia |
| `prazo_t24`, `prazo_t0` | lembrete | prazo | Vai para a conta | Corte lembrete 70 por dia |
| `acesso_trial`, `acesso_ciclo`, `acesso_trial_t3d`, `acesso_trial_t0` | lembrete | acesso | Vai para a conta | Corte lembrete 70 por dia |
| Verificação, recuperação, ativação e aviso de senha alterada do profissional | fora da tabela de política `[NV]` | cadastro do profissional | Vai para a conta, pelo caminho `providerSink` | Ver R-160-08 (cota) |

Para todos os tipos vale: o marcador do destinatário original aparece no corpo (R4), e o texto final é o do renderizador do provedor. `providerSink` passa só `templateKey` e `params`; o assunto e o texto calculados pelo adaptador profissional não são usados `[V]`. Isso é um ponto a confirmar (R-160-10).

---

## 6. Regras de texto da mensagem redirecionada `[PROPOSTA]`

- **Corpo, primeira linha:** aviso de teste com o endereço original. Exemplo de forma (texto final a fixar no Dev): "[Teste] Este e-mail era destinado a: <endereço original>. Foi redirecionado para a conta de teste."
- **Assunto:** o assunto do modelo com prefixo `[Teste] ` e sem o endereço (pergunta 1002, opção recomendada).
- O marcador é aplicado no `ResendProvider` depois da renderização e antes da chamada HTTP. Assim cobre todos os modelos, inclusive os que o renderizador base devolve.
- O marcador não altera `templateVersion` nem os parâmetros validados pelos renderizadores.

---

## 7. Critérios de aceite (Given / When / Then)

**CA-160-01 Destino qualquer é entregue na conta (DEV).**
- **Dado** `APP_ENV=local` (ou `test`, conforme pergunta 1001), `EMAIL_FROM=onboarding@resend.dev`, `RESEND_ACCOUNT_RECIPIENT` configurado, `RESEND_API_KEY` presente e transporte falso que responde 200 com id,
- **Quando** o provedor envia para `qualquer.pessoa@exemplo.test`,
- **Então** o resultado é `aceito`, há exatamente uma chamada HTTP, o campo `to` do corpo é a conta, e a chave de idempotência enviada é a mesma em reenvio.
- **Prova:** vitest em `packages/email/tests` (arquivo novo ou `resend.test.ts`), com `FakeHttp`.

**CA-160-02 Produção não redireciona.**
- **Dado** `APP_ENV=production`, o mesmo remetente de teste e a conta configurada,
- **Quando** o envio é para um destino diferente da conta,
- **Então** o resultado é `recusa_permanente` com `destinatario_nao_permitido` e zero chamadas HTTP.
- **Prova:** vitest, o mesmo caso repetido para cada valor de `APP_ENVS` fora do conjunto da pergunta 1001 (inclui `production`). Os testes atuais em `resend.test.ts` (linhas 121 a 160, `APP_ENV: 'production'`) continuam válidos e servem de regressão.

**CA-160-03 Falha fechada na configuração.**
- **Dado** remetente de teste e uma destas condições: conta ausente; conta inválida; `APP_ENV` vazio ou desconhecido; `APP_ENV` fora do conjunto,
- **Quando** o envio é para outro destino,
- **Então** recusa `destinatario_nao_permitido`, zero chamadas HTTP.
- **Prova:** vitest com tabela de casos.

**CA-160-04 Destinatário original fora de log e erro.**
- **Dado** o redirecionamento ativo e respostas 403, 429, 500, tempo esgotado e exceção de transporte,
- **Quando** o provedor envia para um endereço de teste (ex.: `alvo.original@exemplo.test`),
- **Então** a serialização de todos os resultados, os códigos de erro e qualquer saída de console ou logger capturada não contêm o endereço original; todos os códigos batem com `CODE_PATTERN`; a serialização do provedor mostra só o nome.
- **Prova:** vitest com espião de `console` e de saída, no padrão de `security.test.ts`; `corepack pnpm check:logs` com código de saída 0, registrado com contagem.

**CA-160-05 Corpo e assunto indicam o destinatário original.**
- **Dado** o redirecionamento ativo,
- **Quando** a mensagem é enviada ao transporte falso,
- **Então** o corpo começa com a linha de teste que contém o endereço original; o assunto começa com `[Teste] ` e não contém o endereço (opção da pergunta 1002); o campo `to` é a conta.
- **Prova:** vitest que lê o corpo capturado pelo `FakeHttp`.

**CA-160-06 Cota respeitada.**
- **Dado** um corte de cota atingido para a classe (`decideQuota` com uso igual ou acima do corte),
- **Quando** o pipeline tenta enviar,
- **Então** nenhuma chamada HTTP é feita e o item fica adiado por cota (como hoje).
- **Dado** cota disponível,
- **Quando** o envio redirecionado ocorre,
- **Então** exatamente uma chamada HTTP por envio, e a reserva é consumida uma vez (mesma chave, retentativa não consome de novo).
- **Prova:** vitest sobre `decideQuota` e o provedor com `FakeHttp`; teste de banco já existente `notifications-cota-h094` e `notifications-motor` sem alteração de valor. Teste de banco novo só se o Dev confirmar que a reserva é feita em outro ponto `[NV]`.

**CA-160-07 Todos os tipos de e-mail são cobertos.**
- **Dado** cada chave de `EMAIL_TYPE_POLICY` com parâmetros válidos do próprio modelo,
- **Quando** o provedor envia para um destino fora da conta, em DEV,
- **Então** todas as chaves resultam em `aceito`, com uma chamada, `to` = conta e marcador no corpo.
- **Prova:** vitest parametrizado com a lista da política (o teste falha se um tipo novo não tiver parâmetros de teste).

**CA-160-08 Identidade e anti-enumeração preservadas.**
- **Dado** cadastro ou login com um e-mail digitado que não é o da conta, em DEV,
- **Quando** a resposta da API é comparada com a de um e-mail cadastrado,
- **Então** a resposta é igual nos dois casos (mesma forma e mesmo código), e o e-mail gravado para a identidade é o digitado.
- **Prova:** teste de API com provedor falso, sem rede. Só caminho feliz (regra de QA).

**CA-160-09 O provedor recebe o destinatário original.**
- **Dado** o redirecionamento ativo,
- **Quando** a camada de domínio chama `send` com `to` = endereço original,
- **Então** o `EmailMessage` recebido mantém `to` = original, e só a chamada HTTP leva a conta. Isso garante que o restante do sistema não muda de comportamento.
- **Prova:** vitest com provedor espião sobre a porta.

**CA-160-10 Domínio verificado sem redirecionamento.**
- **Dado** `EMAIL_FROM` no domínio verificado,
- **Quando** o envio é para qualquer destino,
- **Então** a chamada usa o destino original, sem marcador, e não há redirecionamento.
- **Prova:** vitest (já existente em `resend.test.ts`, linha 106, com ajuste de marcador).

**CA-160-11 Efeito na #157 (depende da pergunta 1003).**
- **Dado** um cadastro em DEV com e-mail qualquer,
- **Quando** a prova lê a mensagem pelo identificador do provedor,
- **Então** o destinatário efetivo é a conta, o endereço original está no corpo, e a execução respeita o teto de 4 e-mails.
- **Prova:** registrada na Issue #157 pela Arquitetura. Nesta Issue, só o vitest de CA-160-01 e CA-160-05.

---

## 8. Riscos

| Nº | Risco | Mitigação |
|---|---|---|
| R-160-01 | **Vazamento do e-mail do titular para a conta de teste.** O endereço original vai no corpo, para a caixa do dono e para o provedor. | Aceitável só em DEV, pela decisão 1000. Redirecionamento fora de DEV é impossível (R1, R2). Uso de DEV com dados de teste; dado real de terceiro não deve entrar em DEV. |
| R-160-02 | **O redirecionamento ligar em produção.** | Fail-closed: conjunto explícito de `APP_ENV` (pergunta 1001), igualdade exata do remetente, conta válida, prova CA-160-02. Proposta para a Arquitetura `[PROPOSTA]`: falha de partida (`EmailConfigError`) se `APP_ENV=production` estiver com o remetente de teste. Em produção, o remetente real é o do domínio verificado (decisão de desenho 37). |
| R-160-03 | **Códigos e links de acesso, de step-up e de direitos do titular vão para a conta de teste, para qualquer e-mail digitado.** Quem controla a conta lê os códigos de qualquer cadastro de DEV. | Aceito pela decisão 1000 para DEV. Validade de 15 minutos e uso único (já existentes). Sem uso fora de DEV. |
| R-160-04 | **A cota diária do provedor (100 por dia UTC) vira a barreira única de DEV**, porque todos os testes caem na mesma conta. Pode bloquear testes no fim do dia. | Cortes existentes (70, 85 e 90 por classe), alerta de 70% e 85% (H-094), teto de 4 e-mails por execução na #157. Nenhuma mudança nos cortes. |
| R-160-05 | **Marcador de teste altera o texto** sem mudar a versão do modelo. | Marcador aplicado só no provedor, em DEV. Não muda parâmetros nem versões (seção 6). |
| R-160-06 | **Dois cadastros diferentes com a mesma chave de idempotência** chegariam à mesma conta e um seria tomado como duplicado. | A chave é derivada da mensagem original (identificador de evento ou desafio), o que tende a evitar colisão `[NV]`. Dev confirma com teste de chaves distintas para destinatários distintos. |
| R-160-07 | **Testes existentes esperam a recusa em DEV.** `security.test.ts`, linhas 113 a 125, usa `APP_ENV: 'local'` e espera `destinatario_nao_permitido`. Esse teste fica em conflito com a decisão 1000. | Atualizar explicitamente o caso, registrando na Issue a mudança de comportamento. Não apagar sem registro. Os casos com `APP_ENV: 'production'` continuam válidos. `h097-ca08-ponta-a-ponta.test.ts` (linhas 144 e 169): Dev confirma o ambiente usado `[NV]`. |
| R-160-08 | **Cota dos caminhos diretos.** O envio do profissional (`providerSink`) e o desafio (`challenges.ts`) chamam `provider.send` diretamente. Não foi confirmado se passam pela reserva de cota do pipeline. | `[NV]`. Dev e Arquitetura confirmam se todo caminho reserva cota. O redirecionamento não altera a contagem; o problema, se existir, é anterior à mudança. |
| R-160-09 | **Conflito de nomes de ambiente.** `.env.example` (linha 71) cita "development, dev ou test" como valores de desenvolvimento; `env.ts` (linha 5) aceita `local, test, preview, staging, production`. | Pergunta 1001 fixa o conjunto. Dev alinha o comentário do `.env.example` sem alterar valores. |
| R-160-10 | **Texto do profissional.** `providerSink` não usa o assunto e o texto calculados pelo adaptador profissional; o texto final vem do renderizador do provedor. | `[NV]`. Dev confirma qual renderizador a composição usa para os modelos profissionais. Fora desta Issue, mas o marcador depende dele. |
| R-160-11 | **Decisão 980 da #157.** A guarda do script (só a conta) contradiz a decisão 1000 em DEV. | Pergunta 1003. A Arquitetura da #157 decide. |

---

## 9. Dependências

| Ref. | Item | Estado | Como foi confirmado |
|---|---|---|---|
| D-01 | Decisão 1000 (dono) | Registrada | `11-DECISOES.md`, linha 1106 `[V]` |
| D-02 | Decisões 980 a 985 da #157 | Registradas; a 1000 substitui a regra de destino único só em DEV | `11-DECISOES.md`, linha 1099 `[V]` |
| D-03 | #157 (prova ponta a ponta) | Em Arquitetura, no quadro | `quadro-status.md`, linha 79 `[V]` |
| D-04 | #159 (defeito do endereço) | Em Arquitetura, no quadro; não bloqueia esta Issue | `quadro-status.md`, linha 78 `[V]` |
| D-05 | Cota do Resend (#104, H-094) e pipeline de notificações (#102) | Entregues | `quadro-status.md`, coluna Concluído `[V]` |

Nenhuma dependência bloqueia o início da Arquitetura.

---

## 10. Perguntas ao líder (numeradas a partir de 1001)

Perguntas do Product Owner ao líder, sem envio ao usuário. Cada uma traz a recomendação; se o líder não tiver resposta, adota a recomendação e registra em `11-DECISOES.md` como "adotada pelo líder", para o dono vetar depois.

**1001. Quais valores de ambiente liberam o redirecionamento?**
- **O que é:** o sistema tem um rótulo que diz em que lugar ele está rodando (local, teste, pré-visualização, staging, produção). Esta pergunta decide quais rótulos liberam o redirecionamento.
- **Por que importa:** se um rótulo de publicação pública for liberado por engano, e-mails de terceiros vão para a conta do dono. Se for restrito demais, o teste não funciona em todos os ambientes de DEV.
- **Opções:**
  - (a) **[recomendada]** somente `local` e `test`; preview, staging e produção recusam, como hoje;
  - (b) tudo que não for produção (leitura literal da decisão 1000), incluindo preview e staging;
  - (c) somente `local` e `test`, e exigir também que a variável de publicação da hospedagem esteja vazia ou seja de desenvolvimento.
- **Destrava:** CA-160-01 a CA-160-03 e a configuração do conjunto em `env.ts`.

**1002. Onde aparece o endereço original na mensagem redirecionada?**
- **O que é:** quando o e-mail chega à conta do dono no lugar de quem se cadastrou, precisa ficar claro para quem está testando para quem ele era. Esta pergunta decide onde essa informação aparece.
- **Por que importa:** o assunto aparece em listas e notificações do celular, então é o lugar mais exposto. O corpo é mais discreto.
- **Opções:**
  - (a) **[recomendada]** primeira linha do corpo com o endereço original, e assunto com prefixo `[Teste]` sem o endereço;
  - (b) endereço original no assunto e sem linha no corpo;
  - (c) endereço original no assunto e no corpo.
- **Destrava:** CA-160-05 e o texto final do marcador (seção 6).

**1003. Como fica a prova ponta a ponta da #157 (decisão 980, guarda do script)?**
- **O que é:** a prova da #157 cria cadastros e lê o código que chegou por e-mail. Hoje o script só aceita a conta do dono como destino. A decisão 1000 permite cadastro com qualquer e-mail em DEV. Esta pergunta decide se o script passa a aceitar qualquer e-mail.
- **Por que importa:** sem decisão, a prova ou fica limitada ao caminho de erro, ou começa com regra contraditória.
- **Opções:**
  - (a) **[recomendada]** o script aceita qualquer e-mail em DEV, confirma pelo provedor que a mensagem foi para a conta e que o original está no corpo; teto de 4 e-mails por execução e uma execução por dia mantidos;
  - (b) manter a guarda (somente a conta) e não cadastrar com e-mail novo na prova;
  - (c) pausar a #157 até a decisão do dono.
- **Destrava:** o refino da #157 (Arquitetura) e CA-160-11.

---

## 11. Lista de veto (adotadas pelo PO, sem resposta necessária)

- O redirecionamento fica só no provedor (`ResendProvider`). Nenhum manipulador de evento redireciona por conta própria.
- Destino igual à conta: envio normal, sem marcador.
- Nenhum interruptor, flag ou tela. A condição é a configuração de ambiente da R1.
- A chave de idempotência continua derivada da chave original.
- Cortes de cota, cooldown e pipeline não mudam.
- O endereço original nunca vai para log, código de erro, resultado, `email_outbox` ou auditoria. Só o corpo da mensagem de DEV.
- Produção: sem redirecionamento, sem domínio novo, sem configuração de produção.
- Nenhum texto de erro com o endereço digitado.

---

## 12. Próximo passo

- Passar este refino à **Arquitetura** com as perguntas 1001 a 1003 (o líder adota a recomendação ou responde).
- Pontos para a Arquitetura decidir: local exato da condição (`resend.ts`, `env.ts`), se o marcador entra no provedor ou num passo próprio, e a verificação de cota dos caminhos diretos (R-160-08).
- Ordem do quadro para #160: Product Owner, depois Arquitetura, Desenvolvimento, Code Review, QA e Aguardando aprovação. Nenhum cartão foi movido nesta etapa.
- Verificações que o Dev registra na Issue: testes novos de CA-160-01 a 10 com contagem e código de saída de `corepack pnpm --filter @fastpro/email test` (ou o filtro equivalente), `corepack pnpm check:logs` e `corepack pnpm check:secrets`. Sem simulação de resultado.
