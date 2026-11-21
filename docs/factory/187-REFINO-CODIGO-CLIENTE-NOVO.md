# 187 — Refino do defeito #161: cliente novo (sem conta) não recebe o código do primeiro pedido

Issue: #161 ([E1] Defeito: cliente novo (sem conta) criando o primeiro pedido nunca recebe o código de confirmação)
Workflow: WF-04 · Etapa: Product Owner · EXEC-ID: EXEC-PO-161-20261121
Repositório: `D:\projetos\fastpro`, branch `feature/init` · Data: 2026-11-21 · Prioridade: máxima (dono)
Natureza: somente documento. Nenhum código, teste, banco, quadro ou `11-DECISOES.md` foi alterado.
Perguntas vão ao líder (Orquestrador), numeradas de 1005 a 1008.
Etiquetas: `[V]` verificado por leitura nesta rodada · `[NV]` não verificado (vira verificação do Dev ou da Arquitetura) · `[PROPOSTA]` deste refino, a validar.

## 0. Fontes lidas

- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `apps/web/public/pedido.js` (linhas 293-304, 313-315, 348-353), `pedido-logica.js` e `pedido-revisao.js` (busca por propósito e caminhos; sem envio de código próprio).
- `apps/api/src/challenge-request-route.ts`, `challenge-request-composicao.ts`, `challenge-verify-route.ts` (linhas 61-63).
- `packages/db/src/challenges.ts` (linhas 395-445), `packages/db/src/challenge-consume.ts` (linhas 128-165, 316, 346-370).
- `packages/domain/src/identity/challenge.ts` (linhas 14-56), `packages/domain/src/notifications/policy.ts` (linhas 55-77).
- `supabase/migrations/20261112100000_identity_login_account_rule.sql` (linhas 1-134).
- `docs/factory/08-ARQUITETURA.md` §5.1 e §5.3; `04-PRD.md` RF-039; `46-DESENHO-H012.md:67`; `86-DESENHO-H097.md:53`; `91-DESENHO-H013.md`; `101-DESENHO-H017.md`; `54-DESENHO-H102.md`; `11-DECISOES.md` linhas 1106-1107 (decisão 1000 e registro do terceiro defeito); `quadro-status.md` (#161 em Product Owner); modelo `184-REFINO-DEFEITO-ENDERECO.md`.
- `packages/db/scripts/demo-load.mjs` (cabeçalho e `removerDemo`).
- Não lidos nesta rodada: `03-JORNADAS.md` J1 e `05-CRITERIOS-ACEITE.md` (FA de acesso do cliente), `09-MODELO-DADOS.md` (tabela `ops.email_outbox`), `codigo.js` e `entrar.js` (propósito usado). Ficam para a Arquitetura.

---

## 1. Sintoma

1. Em `/pedido`, o cliente novo preenche o pedido, informa nome e e-mail e pede o código. `[V]` (fluxo em `pedido.js:348-356`).
2. A tela avança para "Confira seu e-mail", mas o e-mail com o código nunca chega. `[V]` (com 2xx, `enviarDesafio` mostra a espera em `pedido.js:298-299`).
3. Em `ops.email_outbox`, as tentativas ficam com `template = acesso_login`, `state = descartado` e `reason_code = conta_inexistente`. `[relato do dono e do líder]` Não consultado no banco nesta rodada: este agente não tem shell nem acesso ao DEV. A causa abaixo explica exatamente esse resultado.

## 2. Causa raiz (verificada no código)

A cadeia é circular: o envio exige conta, e a conta só nasce depois de um consumo, que só é possível com o código enviado.

1. `[V]` `apps/web/public/pedido.js:348-353`: "Revisar pedido" faz `PUT` de identidade (`first_name`, `email`). Com 200, chama `enviarDesafio(campos.email)`.
2. `[V]` `apps/web/public/pedido.js:293-297`: `enviarDesafio` faz `POST /api/v1/auth/challenges` com corpo `{ email, purpose: 'login' }`. O primeiro pedido do cliente novo usa **`purpose: 'login'`**, o mesmo propósito do acesso de quem já tem conta.
3. `[V]` `supabase/migrations/20261112100000_identity_login_account_rule.sql:108-130` (função `private.auth_challenge_create`): para `purpose = 'login'`, a saída só vai para envio se existir `app.app_user` com `email_hmac` igual ao `email_hash` do pedido (linha 109). Sem conta, a linha nasce `descartado` com `reason_code = conta_inexistente`, sem job de envio e sem cota (linhas 124-129). A resposta HTTP continua `criado` (202 uniforme, linha 132), por isso o cliente não vê erro.
4. `[V]` A conta só ganha `email_hmac` no **consumo** (`ensureCustomer` chama `private.app_user_set_email_hmac`; comentário em `packages/db/src/challenge-consume.ts:316` e cabeçalho da migração, linhas 4-6). `docs/factory/46-DESENHO-H012.md:67` diz que a conta do cliente "nasce no POST, depois do consumo".

Resultado: a conta só existe após um consumo bem-sucedido; o consumo só é possível com um código que não é enviado para quem não tem conta. Quem já tem conta funciona; o cliente novo nunca chega ao primeiro código.

A regra da migração (decisão do líder, "opção b", D-H097-3) foi escrita para impedir que um login de e-mail desconhecido gaste cota ou envie e-mail (anti-enumeração). Ela não previa que o primeiro pedido do cliente novo também fosse `login`.

### 2.1 O que o desenho e o código já permitem para o primeiro pedido

- `[V]` `docs/factory/86-DESENHO-H097.md:53` [PROPOSTA do desenho H-097]: "`purpose='publish'` sempre envia (a conta nasce no consumo; S-01 Q2)". A regra SQL acima confirma: `v_conta_ok := p_purpose <> 'login' or exists (...)` (migração, linha 109), ou seja, `publish` envia sem conta.
- `[V]` Propósito `publish` existe na regra de domínio: `CHALLENGE_PURPOSES = ['login', 'publish']` (`packages/domain/src/identity/challenge.ts:17`), e a rota pública aceita qualquer propósito dessa lista (`packages/db/src/challenges.ts:415`).
- `[V]` O consumo não filtra por propósito: `concluirAcesso` (`packages/db/src/challenge-consume.ts:163`) passa o propósito adiante sem restrição e chama `garantirConta` / `ensureCustomer` (linhas 141-156 e 346-370), que cria a conta com o e-mail decifrado.
- `[V]` A verificação lê o propósito do corpo com padrão `login` (`apps/api/src/challenge-verify-route.ts:61-63`). Por isso `pedido.js:315` (`purpose: 'login'`) precisa mudar junto com o envio.
- `[V]` O vínculo ao rascunho não depende de `draft_id` no corpo: o nonce vem do cookie (`apps/api/src/challenge-request-route.ts:33-36`, `draft_bind_challenge`). `[V]` `docs/factory/91-DESENHO-H013.md:27, 53, 77-87` e a condição de anexação `rascunho.email_hmac = desafio.email_hash` (linha 82).
- `[V]` Pelo mapeamento SQL, `publish` usa o mesmo modelo `acesso_login` (migração, linha 118: só `step_up` muda de modelo). Não é preciso template novo para a alternativa A.
- `[NV]` Nenhum cliente do web envia hoje `purpose: 'publish'`: a busca em `apps/web/public` só mostrou `login` em `pedido.js:296` e `:315`. `codigo.js` e `entrar.js` não foram lidos para o propósito.

## 3. O que o desenho manda para o cliente novo (resumo)

- O primeiro pedido de código do cliente novo é pedido de **confirmação do e-mail do rascunho**, não de login.
- Esse pedido envia o código para o e-mail informado, sem exigir conta prévia (o desenho já prevê isso para `publish`, `86-DESENHO-H097.md:53`).
- A conta do cliente nasce no consumo, com o e-mail confirmado. A resposta e o tempo são iguais para e-mail novo e para e-mail já cadastrado: `08-ARQUITETURA.md` §5.1 item 1 ("Resposta sempre idêntica (HTTP 202, mesmo corpo e tempo aproximado)") e §5.3 ("sem mensagens 'e-mail não encontrado'"), e RF-039 em `04-PRD.md:163`.
- O rascunho passa a `aguardando_email` e depois a confirmado (H-030/H-013), com nome e e-mail gravados (`91-DESENHO-H013.md:61-62`).
- Os papéis continuam exclusivos (#30): e-mail de administrador ou de profissional não pode virar conta de cliente (`08-ARQUITETURA.md` §5.2: admin não pode ter perfil de cliente).

## 4. Alternativas

**Alternativa A (recomendada):** usar o propósito `publish` no primeiro pedido e na verificação do cliente novo.
- Sem migração: a regra SQL já envia para `publish`; o template é o mesmo `acesso_login`.
- Muda `apps/web/public/pedido.js` (`:296` e `:315`), e exige teste do par pedido + verificação com `publish`, incluindo a criação da conta no consumo e a anexação do rascunho.
- Riscos: (i) o consumo `publish` precisa ser provado por teste, pois hoje não há consumidor no front; (ii) a exclusividade de papéis (ver §8, R-3).

**Alternativa B:** novo propósito `confirma_rascunho` com template próprio `acesso_confirmacao`.
- Texto de e-mail mais claro ("confirme seu e-mail para publicar o pedido").
- Exige nova migração (regra SQL, `private.auth_challenge_create`), nova entrada em `packages/domain/src/notifications/policy.ts` (tipo não listado é recusado; hoje a lista tem `acesso_login` em `:66` e `acesso_stepup` em `:68`), novo renderizador em `packages/email/src/auth-renderer.ts`, e novos testes. Mais trabalho, mesma regra de anti-enumeração.

**Alternativa C (não recomendada):** criar a conta do cliente já no `PUT` de identidade, antes de provar o e-mail.
- Cria conta sem posse do e-mail, e o `PUT` passa a revelar se o e-mail já existe (abre enumeração). Contradiz o desenho do consumo (`46-DESENHO-H012.md:67`). Só seria aceitável com decisão jurídica/LGPD explícita.

**Não recomendada também:** afrouxar a regra de `conta_inexistente` para `login`. Reabre envio para e-mail desconhecido (cota e enumeração).

## 5. Escopo

Dentro do escopo (desenvolvimento, ambiente DEV):
- Escolher e documentar o propósito do primeiro pedido do cliente novo (a Arquitetura decide o caminho, pergunta 1005).
- Ajustar o envio e a verificação do primeiro pedido em `apps/web/public/pedido.js` (e `pedido-logica.js` / `pedido-revisao.js` se a etapa de revisão também pedir código).
- Garantir que o consumo cria ou vincula a conta do cliente e anexa o rascunho, sem duplicar conta.
- Teste de caminho feliz via API (§7).
- Limpeza da linha de teste `acesso_stepup` com `created_at = 2099-06-01` em `ops.email_outbox` (resto de dbtest). Ver §9, pergunta 1008: o fluxo de demo existente não cobre essa tabela.

Fora do escopo:
- Redirecionamento de e-mail em DEV/teste para a conta de teste: é a Issue #160 (decisão 1000 do dono, `11-DECISOES.md:1106`). A #161 não depende dela para a correção; só a prova ponta a ponta (#157) depende.
- Produção, domínio do Resend, ativação de envio real além do que já existe em DEV.
- Backup, restauração ou exportação de dados (fora do projeto).
- Mudança na regra de `conta_inexistente` para `login`.
- Telas de sucesso além do texto "Confira seu e-mail" já existente.

## 6. Critérios de aceite (Given/When/Then, caminho feliz via API)

CA-161-01 (e-mail novo recebe código)
- Dado um rascunho vivo com nome e e-mail novos (sem conta em `app.app_user`),
- Quando a API recebe `POST /api/v1/auth/challenges` com o propósito definido para o primeiro pedido,
- Então responde 2xx com corpo uniforme, e cria uma linha em `ops.email_outbox` com `state = enviado` e provedor `resend` (ou o provedor de DEV configurado), sem `reason_code = conta_inexistente`.

CA-161-02 (verificação cria a sessão)
- Dado o código de 6 dígitos enviado no CA-161-01,
- Quando a API recebe `POST /api/v1/auth/challenges/verify` com esse código e o mesmo propósito,
- Então responde 2xx, a conta do cliente existe com o e-mail (uma só conta para o e-mail), e a resposta traz a sessão.

CA-161-03 (e-mail existente: mesma resposta)
- Dado um e-mail já cadastrado,
- Quando a API recebe o mesmo pedido,
- Então a resposta HTTP, o corpo e a forma são idênticos aos do CA-161-01, e o envio segue o fluxo normal (anti-enumeração).

CA-161-04 (limite de pedidos)
- Dado que o mesmo e-mail pediu código dentro do intervalo mínimo,
- Quando pede de novo,
- Então a API responde 429 com o mesmo corpo do limite já existente, e não cria linha de envio extra.

CA-161-05 (sem dado pessoal em registro)
- Dado qualquer pedido dos CA-161-01 a 04,
- Então nenhum log, linha de auditoria ou resposta contém o e-mail em claro, o código ou o IP em claro (regra de logs sem PII, #20).

CA-161-06 (papéis exclusivos)
- Dado um e-mail de administrador (ou de profissional) já cadastrado,
- Quando o cliente tenta o primeiro pedido,
- Então o consumo não cria conta de cliente para esse e-mail, e a resposta segue a já prevista para papéis reservados (#30).

## 7. Plano de prova (somente caminho feliz, via API; sem tela)

Prova por chamadas de API contra o ambiente DEV, sem navegador:
1. `POST /api/v1/auth/challenges` com e-mail novo: conferir 2xx e linha em `ops.email_outbox` com `state = enviado` e `provider = resend`.
2. `POST /api/v1/auth/challenges/verify` com o código recebido: conferir 2xx e sessão.
3. Repetir com e-mail já cadastrado: conferir a mesma forma de resposta.

Os testes de banco (`db:test`), de unidade e de build rodam localmente no fim do trabalho, conforme a regra de builds locais. Não rodar a suíte completa em cada etapa.

## 8. Riscos

- R-1: mudar o propósito no front sem mudar a verificação deixa o código preso (a verificação recusa ou usa `login`). Mitigação: mudar as duas chamadas juntas e testar o par.
- R-2: o envio para e-mail novo pode mudar o tempo de resposta e revelar a existência do e-mail. Mitigação: o envio já é pós-resposta (`waitUntil`, `challenge-request-composicao.ts:134-138`); medir a diferença nos dois casos.
- R-3: exclusividade de papéis. `[V]` No código lido, `ensureCustomer` (`challenge-consume.ts:346-370`) não consulta papel de administrador. `[V]` O desenho prevê a checagem (`101-DESENHO-H017.md:116`; `54-DESENHO-H102.md:26`, `private.admin_email_is_reserved`). Antes de liberar a criação de conta pelo primeiro pedido, a Arquitetura precisa confirmar se essa checagem já está implementada. Se não estiver, a criação de conta pelo cliente novo amplia o risco.
- R-4: depender de #160 (redirecionamento de DEV) para o e-mail chegar a um endereço real. Mitigação: a correção não depende de #160; só a prova ponta a ponta (#157) depende.
- R-5: limpeza da linha `acesso_stepup` de 2099 tocar dados reais. Mitigação: filtrar por `created_at = 2099-06-01`, template `acesso_stepup` e ambiente DEV, com contagem antes e depois.

## 9. Perguntas para o líder (numeração contínua a partir de 1005; máximo quatro)

Todas são decisões do líder; nenhuma é dinheiro, jurídico ou LGPD, e nenhuma é enviada ao usuário.

1005. Propósito do primeiro pedido do cliente novo: (a) usar `publish` com o rascunho (**recomendado**: o desenho já prevê, não exige migração nem template novo); (b) novo propósito `confirma_rascunho` com template `acesso_confirmacao` (texto próprio, mais trabalho); (c) criar a conta no `PUT` de identidade (não recomendado: abre enumeração). Destrava a Arquitetura.
1006. Template do e-mail do primeiro pedido: (a) reaproveitar `acesso_login` (**recomendado**: já existe e é o que a regra SQL usa para `publish`); (b) criar `acesso_confirmacao` (só se a opção 1005-b for escolhida). Destrava o texto do e-mail.
1007. Ordem com a #160: (a) a correção da #161 segue sem esperar a #160, e só a prova ponta a ponta (#157) espera (**recomendado**); (b) esperar a #160 para tudo. Destrava a #161 em paralelo.
1008. Limpeza da linha de teste `acesso_stepup` (2099-06-01) em `ops.email_outbox`: o `packages/db/scripts/demo-load.mjs` não referencia `ops.email_outbox` (busca sem resultado), então o comando de demo não remove essa linha. (a) remover só essa linha de teste por SQL no DEV, via `npx supabase`, com contagem antes e depois (**recomendado**: é dado de teste no banco de desenvolvimento, dentro da autorização permanente do DEV); (b) estender o script de demo para `ops.email_outbox` (mudança de código, fora desta Issue); (c) deixar como está.

Recomendações acima são adotadas pelo líder se não houver veto. Itens adotados ficam em `11-DECISOES.md` como "adotada pelo líder" só depois da decisão do líder, que não foi feita nesta rodada.

## 10. Limites desta rodada

- Não houve alteração de código, quadro nem `11-DECISOES.md`.
- A linha de teste `acesso_stepup` não foi consultada nem removida: este agente não tem shell para `npx supabase` e não usa o MCP do Supabase. Fica como critério (§5, R-5) e pergunta 1008.
- A linha `ops.email_outbox` do relato do dono não foi consultada no banco; a causa da §2 é verificada pelo código, não pelo banco.
- A etapa de Product Owner deveria rodar pelo Antigravity (`agy`, conforme `AGENTS.md`). Por pedido explícito do dono, foi executada pelo subagente Claude; o `agy` não foi acionado. Registrar isso no quadro.
- Antes da Arquitetura: confirmar a checagem de papéis reservados no consumo (R-3), e ler `03-JORNADAS.md` J1, `05-CRITERIOS-ACEITE.md` (FA de acesso do cliente) e `09-MODELO-DADOS.md` (`ops.email_outbox`), que não foram lidos nesta rodada.
