# 189 — Desenho do defeito #161: cliente novo (sem conta) não recebe o código do primeiro pedido

Issue: #161 · Workflow: WF-04 · Etapa: Arquitetura · EXEC-ID: EXEC-ARQ-161-20261121
Entrada: `187-REFINO-CODIGO-CLIENTE-NOVO.md` (PO). Decisões do líder adotadas: 1005 (a) propósito `publish`; 1006 (a) reaproveitar o modelo `acesso_login`; 1007 (a) a #161 não espera a #160.
Status: desenho. Não altera código, quadro nem 11-DECISOES. Sem migração (ver D-3).

## 1. Fatos confirmados no código (Grep/Read)

F-1. `apps/web/public/pedido.js:293-297` (`enviarDesafio`) envia `POST /api/v1/auth/challenges` com `{ email, purpose: 'login' }`. `pedido.js:313-315` (`validarCodigo`) envia `POST /api/v1/auth/challenges/verify` com `{ email, code, purpose: 'login' }`. Nenhum dos dois leva `draft_id`.
F-2. A rota pública aceita `login` e `publish` (`packages/domain/src/identity/challenge.ts:17`, `CHALLENGE_PURPOSES = ['login','publish']`; `assertChallengePurpose`, usado em `challenges.ts:415` e na rota de verificação `challenge-verify-route.ts:63`). A porta `private.auth_challenge_request` (migração 20261111170000, linha 129) e `private.auth_challenge_create` (20261112100000, linhas 59-60) aceitam `login`, `publish` e `step_up`.
F-3. A única regra de conta está em `auth_challenge_create`, linha 109: `v_conta_ok := p_purpose <> 'login' or exists(app_user com email_hmac = email_hash)`. Para `publish` ela é sempre verdadeira, então a saída de e-mail nasce pelo caminho normal (`private.email_outbox_inserir`, template `acesso_login`, classe `auth`). O ramo `conta_inexistente` (linhas 123-129) só ocorre para `login`. Confirmada a causa do PO.
F-4. O destinatário não depende de conta: a saída guarda `recipient_user_id = id do desafio` e `template_params.challenge_ref`; o `ChallengeEmailProvider.send` (`challenges.ts:628-650`) resolve token e código pelo desafio (`findRow(id)`), e o endereço vem do `email_enc` do desafio. O envio não exige `purpose = login` nem conta.
F-5. Vínculo com o rascunho: `requestChallenge` (`challenges.ts:466-477`) chama `store.bindNonce` quando há o cookie `__Host-fp_draft` (hash do cookie vem de `draftNonceHashFromRequest(req)` na rota; "nunca do corpo", `challenge-request-route.ts:33`). `private.draft_bind_challenge` (migração 20261112130000) grava o nonce no desafio vivo e põe o rascunho do mesmo navegador e do mesmo `email_hmac` em `aguardando_email`. O `draft_id` do corpo é opcional e não é prova de posse (`91-DESENHO-H013` §1.1).
F-6. Consumo do código: `verifyChallengeCode` (`challenges.ts:517-591`) busca o desafio ativo por `(email_hash, purpose)` (`activeId`), consome por `private.auth_code_attempt_attach` (consome e, no mesmo passo, chama `draft_attach_challenge`: marca `email_verified_at` e volta o rascunho a `aberto`, se o cookie e o `email_hmac` conferirem) e conclui com `concluirAcesso` (`challenge-consume.ts:163-`): decifra o e-mail, `garantirConta` → `ensureCustomer` (cria a conta no Auth e `app.app_user`, `customer_profile_ensure`, grava `email_hmac`), abre a etapa de identificação e devolve o cookie. Retorno 200 `{status:'codigo_ok'}` com `Set-Cookie`. Como `verify` com `purpose: 'login'` busca desafio `login` (que não existe, pois o do pedido foi `descartado` ou nunca criado), hoje o cliente novo nunca consome nada.
F-7. Exclusividade de papéis (#30): `private.customer_profile_ensure` (migração 20261112200000, linhas 168-194) devolve `reservado` se o usuário é administrador ou se o gatilho `role_excl_guard_customer` recusa (SQLSTATE 23514, caso de profissional). `ensureCustomer` converte em `{status:'bloqueado'}`; `concluirAcesso` devolve `conta_bloqueada`; a rota responde `422 {code:'codigo_invalido'}` (`challenges.ts:571-575`), sem sessão e sem detalhe.
F-8. Limites do pedido: por e-mail, 1 pedido a cada `auth.challenge.min_interval_seconds` (padrão 60 s, faixa 10-600) e no máximo `auth.challenge.max_per_hour` por hora (padrão 5, faixa 1-20), contados em `app.auth_challenge` por `email_hash`, com 429 vindo de `rateLimited('pedido', ...)`. Por IP e global (hora e dia): `ops.rate_counter`, chaves `HMAC(PEPPER_IP_HMAC, rateKeyMessage('pedido','ip'|'global_h'|'global_d', valor))`. Verificação: IP em `ops.rate_counter` (`'codigo','ip'`), erros do e-mail em `ops.rate_counter` (`'erro_codigo','email'`, HMAC com `PEPPER_EMAIL_HMAC`) e bloqueio progressivo em `ops.code_lock` (15 min, 1 h, 24 h). É isso que "trava" o dono em DEV.
F-9. Textos: `pedido.js:253` `Enviamos o link para ${email}.`; `pedido-logica.js:60` `confiraEmailTexto: 'Enviamos um link para o seu e-mail. Abra o link e volte a esta página.'`; `pedido-logica.js:53` `muitasTentativas`; `pedido.js:41` `codigoErro: 'Código inválido ou vencido. Confira e tente de novo.'`. O pedido responde sempre 202 `{status:'recebido'}`, com ou sem envio real, então o texto "Enviamos" hoje afirma um fato que a tela não pode saber.
F-10. Já existe uso de `publish` na tela de código: `apps/web/tests/codigo-page.test.ts:123,166` (`purpose: 'publish'`, corpo `{email, code, purpose:'publish'}`). O padrão de verificação com `publish` está, portanto, estabelecido; só `pedido.js` ficou em `login`.
F-11. Linha de teste `acesso_stepup`: o teste `identity-step-up-code.dbtest.mjs:154` verifica `email_type = 'acesso_stepup'`; as datas de 2099 vêm de relógios fixos dos dbtests. Não há `created_at` de 2099 em dado real: o padrão da coluna é `clock_timestamp()` (`20261111120000_notifications_create_pipeline.sql:38`), então "criada no futuro distante" identifica resto de teste sem tocar dado real.

## 2. Decisões

D-1. `pedido.js` passa `purpose: 'publish'` nas duas chamadas: pedido (`enviarDesafio`) e verificação (`validarCodigo`). As duas mudam juntas (R-1 do refino). O mesmo caminho vale para e-mail novo e e-mail já cadastrado.
D-2. Não enviar `draft_id` no corpo. O vínculo ao rascunho é feito pelo cookie `__Host-fp_draft` já enviado pelo navegador (F-5); mandar `draft_id` não acrescenta posse, e a anexação exige o cookie de qualquer forma. (Isto especifica o "com o rascunho" do PO como "no contexto do rascunho do navegador".) Se a Fatia 2 mostrar que `openStage` com `publish` e `draft_id` nulo falha, a correção é enviar `draft_id` lido do rascunho, sem migração.
D-3. Sem migração. `auth_challenge_create` já trata `publish` como o desenho H-097 diz (`86-DESENHO-H097.md:53`, "publish sempre envia"). Sem objeto novo, sem função nova: nenhum `revoke` novo é necessário e o catálogo de autorização não muda (nenhuma rota nova; a lista de rotas e privilégios fica igual). Gatilho para reabrir: só se o teste da Fatia 2 provar que o consumo `publish` falha por regra de banco; então a migração é aditiva, com `revoke ... from public, anon, authenticated, service_role` e `grant` a `app_system`, e rollback em `supabase/rollbacks`.
D-4. Regra `conta_inexistente` de `login` não muda (D-H097-3 mantido). `/entrar` segue com `login`.
D-5. Modelo do e-mail: `acesso_login` (1006 a). Sem novo template.
D-6. Textos neutros, que não prometem envio (a resposta é uniforme e a tela não sabe se saiu e-mail; anti-enumeração):
- `pedido.js:253` (`email-texto`): `Se ${email} estiver correto, o código de 6 dígitos chega em alguns minutos. Confira também a caixa de spam.`
- `pedido-logica.js:60` (`confiraEmailTexto`, texto padrão da seção): `Pedimos o envio do código para o seu e-mail. Digite o código de 6 dígitos abaixo ou abra o link do e-mail e volte a esta página.`
- Sem mudança: `muitasTentativas`, `enviarLinkFalhou` (erro de rede/5xx, não de envio), `codigoErro` ("Código inválido ou vencido...", também usado no profissional/administrador, ver D-8).
D-7. Anti-enumeração: com `publish`, e-mail novo e e-mail existente seguem o mesmo ramo do banco (ambos criam saída `acesso_login` e despacham após a resposta, `challenge-request-composicao.ts:134-138`), mesma resposta 202 `{status:'recebido'}`, mesmos cabeçalhos e mesma regra de 429. Melhora em relação ao `login`: deixa de existir o ramo descartado, que era a única diferença interna entre os dois casos. O custo aceito (S-01 Q2) é que e-mail desconhecido passa a consumir cota de envio; os tetos existentes (por e-mail 60 s e 5/h, por IP, global hora e dia) são o freio. Sem chave liga/desliga (regra do dono).
D-8. Profissional que digita o mesmo e-mail: o pedido envia o código ao e-mail (como qualquer e-mail), o código é consumido, mas `customer_profile_ensure` recusa (F-7) e a resposta é `422 codigo_invalido`, sem sessão e sem criar conta de cliente. A tela mostra "Código inválido ou vencido". O texto não revela o papel (anti-enumeração e regra #30). Risco de confusão de UX registrado em R-3; não propor texto específico sem decisão do dono.
D-9. Limpeza de DEV por um script único e reexecutável: `packages/db/scripts/dev-limpar-limite-acesso.mjs` (D-script no §5), que solta o limite do e-mail/IP do dono e remove a linha de teste de 2099. Não mexe em conta, rascunho, pedido nem em outbox real.
D-10. Ordem com a #160: independente. A #161 corrige o defeito e prova pela API com o destino que o DEV já entrega (conta de teste do Resend, `fastpro2027@gmail.com`; ver §6). A prova ponta a ponta com redirecionamento (#157) espera a #160. Nenhum arquivo em comum esperado (#160 mexe no envio/redirecionamento; #161 em `apps/web/public/pedido*.js` e em scripts), mas o Dev deve rodar `git status` antes de começar.

## 3. Mudança mínima (arquivos)

1. `apps/web/public/pedido.js`: linha 296 `purpose: 'publish'`; linha 315 `purpose: 'publish'`; linha 253 novo texto (D-6).
2. `apps/web/public/pedido-logica.js`: linha 60, novo `confiraEmailTexto` (D-6).
3. Testes de `apps/web/tests` que fixam `purpose: 'login'` ou o texto antigo de `pedido` (localizar por Grep `purpose.*login` e `Enviamos` em `apps/web/tests/pedido*`; os de `entrar-page.test.ts` ficam como estão).
4. Novo dbtest `packages/db/tests/h161-publish-cliente-novo.dbtest.mjs` (Fatia 2).
5. Novo script `packages/db/scripts/dev-limpar-limite-acesso.mjs` e script de pacote `db:dev:limpar-limite` em `package.json` (Fatia 3).
Nada em `apps/api`, `packages/db/src`, `supabase/migrations` ou no catálogo de autorização.

## 4. Fatias de Dev (curtas, com prova)

Fatia 1 — Front (pedido.js e pedido-logica.js).
- Faz: D-1 e D-6 e ajusta os testes do front.
- Prova: `corepack pnpm --filter @fastpro/web test` (ou o filtro do pacote web usado no repo) verde, com um caso que lê o corpo das duas chamadas `fetch` e exige `purpose: 'publish'`, e um caso que exige que o texto da espera não contenha "Enviamos". Registrar comando, contagem e código de saída.

Fatia 2 — Prova de banco e consumo (sem migração).
- Faz: dbtest que (a) chama `private.auth_challenge_request`/`create` com `purpose='publish'` e e-mail sem `app_user`: resultado `criado`, linha em `ops.email_outbox` com `template='acesso_login'` e `state <> 'descartado'`, `reason_code is null`; (b) com e-mail que tem conta: mesma forma de resultado; (c) consome por `private.auth_code_attempt_attach` com cookie e rascunho com `email_hmac` igual: `out_attached = true` e `request_draft.email_verified_at` preenchido; (d) o `ensureCustomer`/`customer_profile_ensure` cria uma só conta e recusa administrador e profissional (`reservado`, nenhuma linha em `customer_profile`). Reaproveitar fixtures de `draft-identity-h013.dbtest.mjs` e `h097-login-prioridade.dbtest.mjs`; antes de escrever, conferir se algum já cobre `publish` + e-mail sem conta e só completar o que faltar.
- Prova: `node --test packages/db/tests/h161-publish-cliente-novo.dbtest.mjs` (apenas este arquivo; a suíte inteira só no fim) com contagem e código de saída 0. Se (c) ou a abertura de etapa falhar para `publish`, parar e devolver ao Arquiteto com a mensagem (gatilho do D-3).

Fatia 3 — Script de limpeza (§5) com testes.
- Faz: o script e um teste de unidade que (i) prova que ele recusa quando `demoGuardRefusal` recusa (host não-DEV, `APP_ENV` diferente), (ii) prova a paridade das chaves (HMAC de `rateKeyMessage` do domínio igual ao calculado no script) e (iii) prova que o filtro da linha de 2099 não casa com linha de `created_at` atual.
- Prova: teste do script verde e execução `--dry-run` em DEV exibindo contagens, código de saída 0.

Fatia 4 — Executar a limpeza no DEV (autorização permanente do dono) e registrar na Issue.
- Passos: `--dry-run` (contagens antes e "depois" simuladas), depois a execução real, depois consulta de conferência. Registrar na Issue: contagem antes/depois de cada tabela, sem e-mail, IP, hash ou código.

Fatia 5 — Prova de caminho feliz pela API (ordem: depois das Fatias 1 a 4 e do restart da API local se necessário).
1. Obter o cookie de rascunho criando o rascunho pela rota que `pedido.js` usa (`CAMINHOS` no topo de `pedido.js`), com `curl -c jar`; gravar nome e e-mail pelo `PUT` de identidade com `-b jar`.
2. `POST /api/v1/auth/challenges` com `{email, purpose:'publish'}` e `-b jar`, e-mail sem conta em `app.app_user`: esperar 202 `{"status":"recebido"}`.
3. Consultar `ops.email_outbox` pela linha mais recente de `template='acesso_login'` do desafio: esperar `state='enviado'`, `provider='resend'`, `reason_code is null`. O código de 6 dígitos vem do e-mail recebido na conta de teste (nunca registrar o valor).
4. `POST /api/v1/auth/challenges/verify` com `{email, code, purpose:'publish'}` e `-b jar`: esperar 200 `{"status":"codigo_ok"}` com `Set-Cookie` de sessão; conferir `count(*)=1` de `app.app_user` para o `email_hmac` e `request_draft.email_verified_at` não nulo.
5. Repetir os passos 2 a 4 com e-mail já cadastrado de cliente: mesmo status, corpo e cabeçalhos do passo 2 (comparar sem o valor do e-mail). Para o tempo, três medições de cada caso, diferença esperada dentro do ruído (o envio é pós-resposta).
6. Repetir o passo 2 em seguida para o mesmo e-mail dentro de 60 s: 429 com o corpo padrão do limite, sem nova linha de saída.
7. Conferir que log e linhas de auditoria do caminho não têm e-mail, código ou IP em claro (consulta ao `audit` e à saída do servidor, só contagem de ocorrências de padrão de e-mail).

## 5. Script de limpeza `packages/db/scripts/dev-limpar-limite-acesso.mjs`

Princípios: só DEV; reexecutável; não imprime e-mail, IP, hash ou código; sem `--force`; transação única; `--dry-run` desfaz.

Entradas (nada vem da linha de comando, para não ir ao histórico):
- E-mail do dono: variável de ambiente `FASTPRO_LIMPAR_EMAIL` (ou `.env.local`).
- IP do dono, opcional: `FASTPRO_LIMPAR_IP` (IPv4, ou IPv6 que será reduzido a /64 pela mesma regra de `normalizeClientIp`). Se ausente, o script limpa só as chaves do e-mail e imprime que o IP não foi limpo.
- `--incluir-global`: também zera os contadores globais do pedido (hora e dia), que são de todos e não de uma pessoa; só desfaz contagem, nunca dado.
- `--dry-run`.

Guarda: reusar `demoGuardRefusal` de `./lib/demo-guard.mjs` (mesma regra de demo-load: DEV do projeto com `APP_ENV=development` e ref igual; recusa qualquer outro) e repeti-la antes da primeira escrita, como faz `demo-load.mjs` (linhas 463-492). Conexão por `connect()` de `./lib/env.mjs`. Códigos de saída: 0 ok; 2 recusado; 1 falha (transação desfeita).

Chaves (as mesmas do código de produção; pepper lido por `loadEnvValue`, nunca impresso):
- `emailHash = HMAC-SHA256(PEPPER_EMAIL_HMAC, email normalizado)` (`challengeHmacHex`, e-mail em minúsculas e sem espaços).
- `emailKeyErro = HMAC-SHA256(PEPPER_EMAIL_HMAC, rateKeyMessage('erro_codigo','email', email))`.
- `ipKeyPedido`, `ipKeyCodigo = HMAC-SHA256(PEPPER_IP_HMAC, rateKeyMessage('pedido'|'codigo','ip', ipNormalizado))`.
- globais: `rateKeyMessage('pedido','global_h'|'global_d','*')`.
Importar `rateKeyMessage` e `normalizeClientIp` do pacote de domínio compilado, se os scripts já importam de lá; senão duplicar e provar a paridade no teste da Fatia 3 (item ii).

Ações, nesta ordem, na mesma transação:
1. Contagens "antes" (somente números): `app.auth_challenge` do `emailHash` criados na última hora (total e não consumidos); `ops.rate_counter` por chave (e-mail, IP pedido, IP código, e globais se pedido); `ops.code_lock` do `emailKeyErro` (linha e `locked_until` futuro sim/não); linhas de 2099 (item 5).
2. `delete from ops.code_lock where key_hmac = $emailKeyErro`.
3. `delete from ops.rate_counter where key_hmac = any($chaves)`.
4. Cooldown e teto do pedido: `delete from app.auth_challenge where email_hash = $emailHash and consumed_at is null and created_at > now() - interval '1 hour'`. Só desafios não consumidos, sem sessão (desafios consumidos sustentam sessões e ficam). O contador de pedido por e-mail lê `app.auth_challenge` (F-8), por isso é aqui que se solta o 60 s e o 5/h. Desafios consumidos na última hora continuam contando; o script informa quantos (efeito só se foram 5 na mesma hora). As saídas `ops.email_outbox` ligadas aos desafios apagados ficam (linhas sem endereço; viram "desafio_inativo" se alguém tentar enviar).
5. Linha de teste de 2099: alvo = `ops.email_outbox where template = 'acesso_stepup' and created_at >= timestamptz '2099-06-01 00:00:00+00' and created_at < timestamptz '2099-06-02 00:00:00+00' and created_at > now() + interval '10 years'`. A última condição é a trava de segurança: linha real nunca nasce no futuro (padrão `clock_timestamp()`), então nenhum dado real é tocado. Contar antes; se o alvo tiver mais de 20 linhas, abortar com código 1 e a mensagem "alvo inesperado". Antes de apagar, listar só ids (UUID, sem PII) e conferir `ops.job` ligado a esses ids (consultar as colunas reais de `ops.job` no momento; apagar o job apenas se apontar por id para a linha apagada). Depois do `delete`, contar de novo: esperado 0.
6. Contagens "depois" e relatório: `limite liberado: sim/não` por tabela, `linhas 2099: antes N, depois 0`.
7. `commit`, ou `rollback` em `--dry-run`.

Causa-raiz da linha de 2099: o dbtest de step-up deixa a linha. Recomendação (opcional, mesma Fatia 3, sem bloquear): fazer o `after` de `identity-step-up-code.dbtest.mjs` apagar as saídas que ele criou, por id.

## 6. Provas e destino em DEV (ordem com a #160)

- Sem a #160, o Resend em DEV só entrega ao e-mail da conta cadastrada (`fastpro2027@gmail.com`). Para a Fatia 5, usar um e-mail "novo" que o Resend consiga entregar: primeiro `fastpro2027@gmail.com` se ele não tem `app_user` (conferir com consulta de existência pelo `email_hmac`, só contagem); se já tem, um alias da mesma caixa (`fastpro2027+cliente161@gmail.com`) se o Resend aceitar; se nenhum dos dois for aceito, a prova de "enviado" para e-mail novo fica para a #160, e a #161 entrega as Fatias 1 a 4 e a prova de banco (Fatia 2), registrando o limite honestamente na Issue. Não usar conta de produção nem credencial de outro ambiente.
- A #160 não é pré-requisito do código da #161; quando a #160 entregar, repetir só os passos 2 a 4 da Fatia 5 para fechar a #157.

## 7. Riscos

R-1. Trocar só um dos dois propósitos prende o código (verificação procura `login`). Mitigação: Fatia 1 testa as duas chamadas no mesmo teste.
R-2. Diferença de tempo entre e-mail novo e existente. Mitigação: envio pós-resposta, mesma rota de banco com `publish`; medição na Fatia 5.
R-3. UX do profissional/administrador que digita o próprio e-mail: recebe um código, digita e vê "Código inválido ou vencido", sem explicação (por regra #30 e anti-enumeração). Aceito; sugerir ao PO/dono uma frase genérica futura ("use outro e-mail para pedir um serviço") só se desejarem, o que revelaria o papel e exige decisão.
R-4. Mais e-mails gastos por e-mail desconhecido: coberto pelos tetos existentes e pelo limite de cota de e-mail; sem chave liga/desliga (decisão do dono).
R-5. O cookie de rascunho ausente (cookie bloqueado, navegador diferente) faz o pedido seguir sem vínculo (`nonce_vinculo_falha`, resposta ainda 202) e o consumo não anexa o rascunho; o cliente confirma e volta ao pedido pelo link. Comportamento já previsto em H-013 (§1.1); não muda com a #161.
R-6. Limpeza de limite apagar desafio útil: restrita a não consumidos do e-mail do dono na última hora; `--dry-run` obrigatório antes da execução real nesta Issue.
R-7. Script de limpeza rodar em outro banco: bloqueado pela guarda do `demo-guard`, repetida antes de escrever; teste recusa host e `APP_ENV` errados.
R-8. A suposição "verify com publish e `draft_id` nulo abre a etapa" ainda não foi provada por execução (só lida no código); a Fatia 2 existe para provar e define o gatilho de D-2/D-3.

## 8. Critérios de verificação para o Code Review e o QA

- Diff limitado a `apps/web/public/pedido.js`, `pedido-logica.js`, seus testes, o dbtest novo, o script de limpeza, `package.json` (script `db:dev:limpar-limite`) e este desenho. Nenhuma migração, nenhuma mudança em `apps/api`.
- `pedido.js` não contém `purpose: 'login'` e não contém "Enviamos".
- O script não imprime e-mail, IP, hash, pepper ou código; recusa fora do DEV; tem `--dry-run`; reexecutar não falha.
- QA (caminho feliz via API, no fim): Fatia 5 passos 1 a 4 e 6, e o passo 5 para a forma da resposta.
- Local: `corepack pnpm lint`, `typecheck`, `test` do web e `db:test` no fim, com comando, contagem e código de saída na Issue.

## 9. Dúvidas ao líder

Nenhuma bloqueante. Adotadas como recomendação (para veto no registro do líder, sem exigir resposta): D-2 (sem `draft_id` no corpo, vínculo pelo cookie), D-6 (textos neutros acima), D-8 (mesmo "Código inválido ou vencido" para profissional/administrador).

## 10. Limites desta rodada

Não houve alteração de código, quadro, 11-DECISOES nem commit. Não foi executado nenhum teste nem consulta ao banco de DEV nesta rodada; o estado atual do limite do dono e a contagem real da linha de 2099 serão medidos no `--dry-run` da Fatia 4. Pontos a confirmar pelo Dev na leitura: nomes exatos dos caminhos em `CAMINHOS` de `pedido.js` (rascunho, identidade), colunas de `ops.job` para o item 5 do script e a forma de importar `rateKeyMessage` em scripts `.mjs`.
