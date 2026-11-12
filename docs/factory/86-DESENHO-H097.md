# Desenho H-097: e-mail de login com prioridade (Issue #107, WF-03, Arquitetura)

- Produto: FastPro, branch `feature/init` · Data: 2026-11-12 · Papel: Software Architect
- Decisão: `APROVADO_ARQUITETURA`, com dúvidas não bloqueantes (§6). Somente documento: nenhum código, migração, envio ou rede.
- Rastro: 83-REFINO-H097 (RN-1..8, CA-01..10); 39-DESENHO-H011 e 59-DESENHO-H094; 08 §12.6; código lido: `packages/db/src/notifications.ts`, `packages/db/src/challenges.ts`, `packages/domain/src/notifications/quota.ts`, `packages/domain/src/identity/rate-limit.ts`, `apps/api/src/session-route.ts`.
- Etiquetas: [DECIDIDO] aprovado antes · [VERIFICADO] lido no repositório nesta data · [PROPOSTA] deste desenho · [NÃO VERIFICADO] sem fonte.

## 0. Achado principal: o caminho e a cota já existem; H-097 fecha lacunas e prova

- [VERIFICADO] `requestChallenge` (`challenges.ts`) grava o desafio e a saída `auth` (`dedupe_key='ac:<id>'`, job `email.send` de contingência) numa transação e, com resultado `criado`, chama `deps.dispatch.schedule(outboxId)` antes de responder 202. `dispatchChallengeOutbox` chama `processOutbox` direto, com `SendPacer` próprio. O mesmo vale para o step-up (`session-route.ts`).
- [VERIFICADO] `processOutbox` reivindica a linha pelo id (não varre a fila), pula a revalidação da classe `auth`, resolve o destinatário (`ChallengeRecipientDirectory`: desafio inativo vira `inexistente`, ANTES de reservar cota), reserva com `QUOTA_CUTS.auth` (100/dia, 3.000/mês) e trata os cinco resultados do provedor, com recuo e sem duplicata.
- [VERIFICADO] Alertas 70% e 85% já estão em `alertLevelFor` e `registrarAlertasDeCota` (H-094). O conflito do refino §7 (90/2.700 como alerta) está resolvido: 90/2.700 é só o corte da classe `critico`. H-097 não muda alertas; repete a regressão.
- [VERIFICADO] Limites de pedido já existem (H-015): por e-mail 60 s e 5 por hora, por IP 20 por hora, global 30 por hora e 80 por dia (teto rígido 90).
- [NÃO VERIFICADO] Ligação de produção do `dispatch` (porta `OutboxDispatchPort`) e rota pública do pedido de login: não encontrei `dispatchChallengeOutbox` nem `requestChallenge` em `apps/api/src/composicao.ts`, `app.ts` ou `vercel.ts`. O DEV confirma; se faltar, a ligação entra em H-097 (§1).
- Lacunas reais de H-097: (a) ligação de produção do envio pós-resposta, se faltar; (b) regra de conta não cadastrada (§3); (c) comportamento medido sob cota esgotada (§2); (d) testes CA-01..10 (§5).

## 1. Como o código sai na requisição

[DECIDIDO] RN-1, RN-5, RN-7. Fluxo, sem componente novo de fila:

```
POST pedido -> validação -> requestChallenge (1 transação: desafio + saída auth + job de contingência)
   -> resposta 202 uniforme -> [pós-resposta] dispatchChallengeOutbox -> processOutbox(claim pelo id)
      -> diretório -> reserva de cota (auth: 100/3.000) -> provedor (ChallengeEmailProvider -> Resend)
```

- [VERIFICADO] Prioridade sobre a fila vem da estrutura: o envio de login reivindica a própria linha pelo id e nunca disputa posição com itens de aceite, digest ou lembrete. O tick só cobre a contingência.
- [PROPOSTA] Adaptador de produção de `OutboxDispatchPort`: `schedule(id)` registra `dispatchChallengeOutbox(deps, id)` na primitiva de execução pós-resposta da plataforma (na Vercel, `waitUntil`), com `catch` que registra apenas um código fixo. Falha ou ausência da primitiva mantém a contingência do tick, sem mudar o 202. `deps` de envio (provedor, diretório de desafio, relógio) montados na composição, sem segredo em log.
- [PROPOSTA] Pacer: manter um `SendPacer` por chamada (já é assim). O teto de 5/s é por instância; o login é limitado a no máximo 80 pedidos por dia, então não disputa o teto. Se o provedor devolver `limite_taxa`, o recuo existente cobre.
- [PROPOSTA] Meta de tempo (D-H097-4): a resposta 202 não inclui o provedor; do pedido até o aceite do provedor, alvo p95 de 10 s. Só medível com domínio verificado (S-11, BLQ-EXEC); até lá a prova é de ordem e ausência de espera, não de milissegundos.
- Sem interruptor: nenhum caminho lê `ops.app_config` para ligar ou desligar o login por e-mail [DECIDIDO, decisão 27].

## 2. Preferência de cota

[DECIDIDO] D-H097-1 opção (a): login tem preferência até 100 por dia; acima disso espera a virada UTC.

| Classe | Dia | Mês | Papel |
|---|---|---|---|
| `auth` | 100 | 3.000 | usa a reserva (10/dia e 300/mês) e o teto inteiro |
| `critico` | 90 | 2.700 | adiado (`adiado_cota`) ao chegar no corte |
| `digest` | 85 | 2.550 | idem |
| `lembrete` | 70 | 2.100 | idem |

- [VERIFICADO] É `QUOTA_CUTS` e `decideQuota` (H-092), sem código novo. "Preferência" = as outras classes param antes do teto, então sempre sobra espaço para o login até 100. "Esperar a virada" = `adiado_cota` com `next_attempt_at` em 00:00 UTC do dia (ou mês) seguinte, sem gastar tentativa; o job de reagendamento acorda a linha.
- [PROPOSTA, comportamento a documentar e testar] Com dia em 100, o login adiado pela cota só chega se a virada ocorrer enquanto o desafio vale (15 min). Depois disso, `ChallengeRecipientDirectory` devolve `inexistente` e a saída vira `descartado` sem reservar cota nem chamar o provedor. O cliente precisa pedir novo código após a virada. Não prolongar a validade do desafio (decisão fixa de 15 min).
- [PROPOSTA] Teto de gasto: o limite global de 80 pedidos por dia (H-015) mantém o login abaixo de 100. Um teste trava que `pedidoGlobalDia` (máx. 90) ≤ reserva efetiva de `auth` no dia.
- Alertas 70% e 85%: só informam (`onQuotaAlert`); nenhum caminho de envio os lê.

## 3. Resposta uniforme e conta não cadastrada

- [DECIDIDO] RN-5/RF-039: 202 com mesmo status, corpo (`{"status":"recebido"}`) e cabeçalhos, exista conta ou não, e mesmo se o envio falhar.
- [DECIDIDO] D-H097-3: conta não cadastrada não recebe e-mail. Atenção ao conflito com H-011 DD-1 ("o pedido nunca consulta conta; a conta nasce no consumo"): o desenho concilia assim.
  - [PROPOSTA] Só para `purpose='login'`: a consulta de conta é feita DENTRO da função SQL de criação do desafio (mesma transação), nunca por porta de usuário no manipulador TypeScript. Sem conta: o desafio e a saída são gravados igualmente, mas a saída nasce `descartado` com motivo fixo `conta_inexistente`, sem job de envio e sem cota. Com conta: fluxo normal. `purpose='publish'` sempre envia (a conta nasce no consumo; S-01 Q2).
  - Mesmo trabalho nos dois casos: mesmas cifras e hashes, mesmo número de gravações, `schedule` chamado igualmente (para `descartado`, o `claim` não encontra a linha e não faz nada), mesma resposta e mesmo limite 429 (a contagem não olha conta).
  - [NÃO VERIFICADO] Tabela e coluna da conta de cliente e como buscar por e-mail sem guardá-lo em claro (hash HMAC de e-mail igual ao do desafio?). O DEV confirma no modelo de H-012/H-014; sem forma segura de busca, devolve ao Arquiteto (dúvida 2).
- Diferença residual aceita: uma gravação de job a menos no caso sem conta. Medida em teste (§5, T-H097-07).

## 4. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Abuso: pedidos de login gastam a cota diária e travam aceite e lembretes | Limites H-015 (e-mail 5/h, IP 20/h, global 30/h e 80/dia); sem e-mail para conta inexistente; 429 não gasta cota; alerta a 70% e 85% |
| R-2 | Vazamento por tempo ou resposta (enumeração) | Consulta de conta só no banco, mesma sequência de gravações; 202 e 429 sem relação com a conta; teste determinístico por contagem de chamadas e medição de apoio (§5) |
| R-3 | Envio pós-resposta interrompido ou fila parada | Job `email.send` de contingência criado na mesma transação; `claim` com lease evita envio duplo; cada saída tem `dedupe_key`; alerta operacional de linha `auth` pendente há mais de 5 min [PROPOSTA, métrica sem dado pessoal] |
| R-4 | Cota esgotada: login pedido às 10:00 só chega na virada, e o desafio vale 15 min | Documentar no texto da tela (resposta uniforme, "se não chegar, tente depois") sem revelar estado da cota; reserva e alertas reduzem a chance |
| R-5 | E-mail do profissional (Supabase Auth, SMTP) gasta a MESMA cota do provedor sem passar pelo contador local | Fora de escopo (D-H097-2); item separado decide contagem ou reconciliação. Até lá o contador pode subestimar [NÃO VERIFICADO: S-11] |
| R-6 | 100/dia e 3.000/mês do provedor não confirmados com envio real (S-11) | Constantes em um só lugar (`PROVIDER_LIMITS`); conferir no primeiro envio real, após domínio |
| R-7 | Dois processos enviam ao mesmo tempo (pós-resposta e tick) | `claim` atômico; `ChallengeEmailProvider` devolve `ja_entregue` se já entregue |
| R-8 | Dev ou teste enviam ao público | `ResendProvider` em modo de teste só envia à conta cadastrada; testes usam dublê (CA-08) |

## 5. Testes e critérios verificáveis

Local, sem rede nem envio real: `corepack pnpm check:all` e `db:test`; guarda de rede ativa; provedor `FakeEmailProvider`; relógio fixo; e-mails `@example.test`; linhas de 2099 no banco. Registrar comando, contagem e código de saída na Issue.

| ID | Prova | CA |
|---|---|---|
| T-H097-01 | Integração (repositório Pg, sem `TickService`): 200 saídas de aceite/digest pendentes; o pedido de login leva o provedor a receber o login ANTES de qualquer outra; resposta 202 | CA-01, CA-02 |
| T-H097-02 | Uso do dia 50: login sai e `used` vira 51 | CA-03 |
| T-H097-03 | Uso do dia 90: novo aceite fica `adiado_cota` e não sai; login sai (`used` 91); 100: login `adiado_cota` com `next_attempt_at` = 00:00 UTC seguinte, 202 mantido | CA-04, CA-05 |
| T-H097-04 | Virada com relógio fixo: desafio ainda ativo envia uma vez e conta no novo dia; desafio vencido vira `descartado`, provedor não chamado, cota intacta | CA-05, R-4 |
| T-H097-05 | Provedor `indisponivel` ou `nao_configurado`: 202, saída `pendente` com recuo; ao voltar, sai UMA vez (mesmo link e código; `ja_entregue` em reentrega) | CA-06, RN-4 |
| T-H097-06 | Conteúdo: o e-mail tem só link, código e prazo; varredura de tabelas e logs sem endereço, token ou código | RN-6 |
| T-H097-07 | Uniformidade: e-mail com e sem conta (`login`): status, corpo e cabeçalhos iguais byte a byte; mesma sequência de chamadas ao repositório e às portas; sem conta nada chega ao provedor e a cota não muda. Apoio: 40 pedidos por caso, alternados, banco de desenvolvimento; diferença de medianas ≤ 30 ms e de p95 ≤ 120 ms (herdado de H-011; vale a prova determinística se houver ruído) | CA-07, RN-5 |
| T-H097-08 | `purpose='publish'` com e-mail novo envia | D-H097-3 |
| T-H097-09 | Ambiente dev/teste: destinatário fora da conta cadastrada não gera chamada à API (dublê de `fetch` não chamado) | CA-08 |
| T-H097-10 | Guarda: nenhuma chave de e-mail em `ops.app_config` e nenhuma rota de admin altera ou desliga o login por e-mail | CA-09 |
| T-H097-11 | Cota em 100: mensagem de chat e aceite funcionam, sem e-mail | CA-10 |
| T-H097-12 | Coerência de teto: `pedidoGlobalDia` (padrão 80, teto 90) menor que o corte diário de `auth` (100); regressão dos alertas 70 e 85 (TD-04/05 de H-094) | R-1 |
| T-H097-13 | Adaptador de produção: `schedule` chama `dispatchChallengeOutbox` uma vez; erro no envio não altera o 202; sem a primitiva pós-resposta, o job de contingência continua válido | RN-1 |

Critérios de saída: 100% dos T-H097 verdes; suíte de H-011, H-092, H-094 e H-015 sem regressão; nenhuma tabela nova; migração (se houver) só altera a função de criação do desafio, com `down` e privilégios restritos a `app_system`.

## 6. Dúvidas ao Orquestrador (não bloqueantes, com recomendação)

1. Esperar a virada UTC só entrega o login se o desafio ainda valer (15 min). Recomendação: manter assim (sem aumentar a validade) e orientar o cliente, na tela, a pedir de novo mais tarde.
2. Regra de conta não cadastrada vale só para `purpose='login'`; `publish` sempre envia. Isso exige achar a fonte da conta de cliente (e como buscar por e-mail com segurança). Recomendação: confirmar o escopo acima e deixar o DEV validar a fonte; se a busca segura não existir, voltar ao Arquiteto.
3. Alerta operacional para saída `auth` pendente há mais de 5 minutos (R-3): recomendação de incluir como métrica sem dado pessoal e sem tela nova (painel H-108 lê depois).
4. E-mail do profissional via Supabase Auth (R-5) segue em item separado; recomendação de abrir após S-11 e já registrar que ele gasta a mesma cota.

## Resumo em linguagem simples

O envio do código de login já sai direto no pedido do cliente, sem esperar a fila dos outros e-mails, e o limite grátis já reserva espaço para ele. Esta etapa só liga o envio em produção (se faltar), define que quem não tem conta não recebe e-mail (com a mesma resposta na tela) e prova tudo com testes de mentira. Se o limite diário acabar, o código espera a virada do dia, mas ele só vale 15 minutos; nesse caso o cliente precisa pedir outro depois.
