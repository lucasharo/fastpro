# H-013 — Refino: código de 6 dígitos, nonce de navegador e anexação do rascunho

- **Issue:** #26 "[E1] Código de 6 dígitos e nonce" · **Backlog:** H-013 · **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder (sem movimentar o cartão)
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido no código ou em documento · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de decisão em aberto
- **Fontes lidas:** 14-BACKLOG (H-013, H-011, H-012, H-016, H-025, H-030); 21-ISSUES-CRIADAS (H-013 = #26, H-016 = #29, H-097 = #107); 16-MANIFESTO-ISSUES (item 24); 19-PLANO-TECNICO-DEV (passo 9 e O-5); 02, 03, 04 (RF-037), 05 (FA-003, D8); 08 §5.1 itens 1 a 6; 09 (`auth_challenge`, `request_draft`); 11-ARQ §R-15; 11-DECISOES (D8; rodadas 19 e 21, decisões 59 a 64); 25-REFINO-S01 §2.3 e §3; 38-REFINO-H011 e 39-DESENHO-H011 (§2, §3, §5, §8); 46-DESENHO-H012 (§1, linha 54 sobre `draft_id`); 74-DESENHO-H025 (cookie `__Host-fp_draft` como nonce); 86-DESENHO-H097 (§7, caminho `/verify`); 89-REFINO-H030 (D-H030-1, passos 5 e 6). Código lido: `apps/api/src/challenge-verify-route.ts`, `packages/db/src/challenges.ts` (`verifyChallengeCode`), `apps/api/src/consume-route.ts`, `supabase/migrations/20261111140000_identity_create_auth_challenge.sql`, `supabase/migrations/20261111440000_draft_create_request_draft.sql`.
- **Já feito, a reaproveitar (não refazer):** #24 (H-011) tabela `auth_challenge`, pedido, cifra, limites e função de verificação do código no banco; #25 (H-012) consumo do link por POST em `/v1/auth/challenges/consume`; #107 (H-097) rota `POST /v1/auth/challenges/verify`, com o corpo limitado, a verificação e o limite de 429; #38 (H-025) rascunho com cookie `__Host-fp_draft` e tabela `request_draft`. Não há relação de reuso com #29 (H-016, login do profissional por Supabase Auth): ela não toca o desafio do cliente.

## 1. Objetivo

Dar ao cliente a alternativa ao link: digitar o código de 6 dígitos na mesma aba em que pediu o acesso. Ao confirmar o código ou o link, o rascunho do navegador de origem é anexado à conta somente se o e-mail confere. Isso fecha a confirmação de e-mail que a revisão do pedido exige (`[DECIDIDO]` FA-002; 11-ARQ §2.2 "revisar: e-mail verificado"; D-H030-1 decidido na rodada 21 como dependência de #43).

Sem esta história, a tela de pedido (#43) não pode abrir a revisão. `[VERIFICADO]` 11-DECISOES rodada 21, decisão 59.

## 2. Escopo

- Caminho do código: `POST /v1/auth/challenges/verify`. `[DECIDIDO]` por 86-DESENHO-H097 §7 (revisão da #107). A rota já existe; esta história a completa com o passo seguinte.
- Nonce de navegador: vínculo entre o desafio e o cookie do rascunho do navegador que pediu o acesso. `[DECIDIDO]` por 74-DESENHO-H025 e pela decisão de H-026 (11-DECISOES, rodada 19, decisão 56 de H-026): o nonce é o cookie `__Host-fp_draft`, sem segundo cookie.
- Anexação do rascunho com regra de e-mail conferido. `[DECIDIDO]` 08 §5.1 item 5 e 46-DESENHO-H012 linha 54 (anexação é de H-013).
- Campos do rascunho que H-013 precisa e ainda não existem: `email` e `first_name`. `[VERIFICADO]` ausentes em `request_draft` (migração `20261111440000`); `[DECIDIDO]` 74-DESENHO-H025 linha 44 atribui as colunas a H-011/H-013.

## 3. Critérios de aceite

- **CA-01 Código certo confirma o desafio.** Dado um desafio ativo de login, quando o código correto de 6 dígitos é enviado a `POST /v1/auth/challenges/verify`, então a resposta é 200 `codigo_ok` e o desafio é consumido (uso único). `[VERIFICADO]` `verifyChallengeCode` e `private.auth_challenge_verify_code` (ramo `ok`); `[DECIDIDO]` FA-003.
- **CA-02 Código errado não revela nada.** Dado código errado, ou desafio inexistente, expirado, usado ou substituído, quando o código é enviado, então a resposta é 422 `codigo_invalido` com o mesmo corpo e cabeçalhos nos quatro casos. `[VERIFICADO]` `verifyChallengeCode` devolve o mesmo 422 para `errado` e `invalido`.
- **CA-03 Cinco erros invalidam.** Dado um desafio com cinco códigos errados, quando o quinto erro ocorre, então o desafio é invalidado (`invalid_reason = 'tentativas'`), e o código correto enviado depois disso é recusado. `[DECIDIDO]` D8, 05 linha 91, 39 §2.1; `[VERIFICADO]` ramo `v_tentativas >= p_max_attempts` na migração `20261111140000`. A história prova o caminho HTTP completo, não só a função SQL.
- **CA-04 Limites do código.** Dado excesso de erros por e-mail ou por IP, quando o código é enviado de novo, então a resposta é 429 com `Retry-After` e o mesmo corpo para e-mail cadastrado ou não. `[VERIFICADO]` `verifyChallengeCode` (bloqueio por e-mail e IP) e H-015 (#28, concluída). Reaproveitar; nada novo.
- **CA-05 Link e código são a mesma linha.** Dado um desafio, quando o link é consumido, então o código passa a valer `invalido`; e o inverso. `[DECIDIDO]` 39 §2.1 (CA-H011-11); `[VERIFICADO]` `consumed_at` e `secrets_enc` zerados no ramo `ok` de ambas as funções.
- **CA-06 Nonce gravado no pedido.** Dado um pedido de acesso feito por um navegador que já tem o cookie `__Host-fp_draft`, quando o desafio é criado, então `auth_challenge.browser_nonce_hash` recebe o SHA-256 do segredo do cookie (64 hex); sem cookie, fica nulo. O segredo em claro nunca vai ao banco nem a log. `[VERIFICADO]` a coluna existe (nula, validada como 64 hex) na migração `20261111140000`; `[PROPOSTA]` a gravação exige que `POST /v1/auth/challenges` leia o cookie (hoje não lê), o que altera a rota da #107. Ver D-H013-3.
- **CA-07 Anexação só no mesmo navegador e com e-mail conferindo.** Dado um consumo válido (código em `/verify` ou link em `/consume`), quando o navegador que consome tem o cookie cujo SHA-256 é igual a `browser_nonce_hash` e o e-mail do rascunho é igual ao e-mail do desafio, então o rascunho vivo desse navegador é anexado e recebe a marca de e-mail confirmado (CA-09). `[DECIDIDO]` 08 §5.1 item 5.
- **CA-08 Outro navegador não anexa.** Dado um consumo válido em navegador diferente do que pediu, ou um rascunho com e-mail diferente do desafio, quando o consumo ocorre, então nenhum rascunho é anexado nem alterado, e a resposta de sucesso é a mesma do CA-07 (não informa se houve anexação). `[DECIDIDO]` 08 §5.1 item 5 e R-15 de 11-ARQ; `[PROPOSTA]` resposta igual (ver D-H013-7).
- **CA-09 E-mail confirmado fica marcado no rascunho.** Dado um rascunho anexado pelo CA-07, quando a revisão é consultada, então o rascunho expõe uma marca de "e-mail confirmado" (representação a definir, D-H013-5) que #43 usa no CA-04. Antes da confirmação, o estado é `aguardando_email`. `[VERIFICADO]` `aguardando_email` existe no `check` de status; a transição é de H-013 `[VERIFICADO]` 74-DESENHO-H025 linha 47.
- **CA-10 Colunas do rascunho.** Dado o banco com a migração desta história, quando lido, então `request_draft` tem `email` (normalizado, mesma função de H-011/H-016) e `first_name`, sem coordenada, e a restrição de tamanho do nome. `[PROPOSTA]` (quem grava os campos, D-H013-4).
- **CA-11 Mesmo passo depois do código e do link.** Dado o código correto, quando confirmado, então o cliente segue para o mesmo passo posterior do link (etapa de identificação de H-012, convertida em sessão por H-014). Não há caminho próprio de sessão para o código. `[VERIFICADO]` 46-DESENHO-H012 §1; `[PROPOSTA]` ligação no `/verify` (D-H013-9).
- **CA-12 Tela do código.** Dado o passo "confira seu e-mail", quando o cliente digita os 6 dígitos, então vê campo numérico, mensagem de erro por tentativa com o texto da seção 5, e a contagem de tentativas restantes não é mostrada (não revela o limite além do 422). Acessível: erro anunciado a leitor de tela, teclado completo, zoom de 200%. Cores por token EDS. `[PROPOSTA]`; dono da tela, D-H013-6.
- **CA-13 Nada sensível vaza.** Dado qualquer resposta, log ou registro desta história, quando inspecionado, então não há e-mail, código, token, nonce em claro, nem IP. Cabeçalho `Cache-Control: no-store` em todas as respostas. `[VERIFICADO]` `verifyChallengeCode` e rota #107 usam `no-store` e não registram valores; `[DECIDIDO]` 39 CA-H011-13/15.
- **CA-14 Concorrência.** Dado vinte códigos errados simultâneos e vinte consumos simultâneos do mesmo desafio, quando processados em Postgres real, então o contador não perde incremento e há um só `ok`. `[DECIDIDO]` 39 T-H011-23 e T-H011-24; `[VERIFICADO]` `FOR UPDATE` na função.

## 4. Fora de escopo

- Página do link, GET sem efeito e consumo por POST: #25 (H-012), concluída. Esta história só acrescenta anexação ao consumo existente (D-H013-2).
- Sessão de 7 dias, "sair", "sair de todos", step-up: #27 (H-014), concluída.
- Limites por IP e global, bloqueio cumulativo do código (R-2 de 39): #28 (H-015), concluída. O bloqueio cumulativo de 15 erros em 24 h fica pendente em H-015 (D-H011-11).
- Cadastro e login do profissional: #29 (H-016).
- Tela de pedido, revisão e confirmação expressa: #43 (H-030), que depende desta história.
- Envio real de e-mail e cota: H-093, H-094, H-097; sem envio real nos testes desta história.

## 5. Evidência exigida

Registrada na Issue #26, com comando, contagem de testes e código de saída de cada execução local (sem CI verde declarado).

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem.
- Banco real (Postgres) para CA-01 a CA-03, CA-05, CA-07 a CA-09 e CA-14, com várias conexões em CA-14.
- Teste HTTP ponta a ponta do código (CA-01 a CA-04) com provedor simulado; nenhum envio real.
- Varredura de tabelas e logs sem sentinela de e-mail, código ou nonce (CA-13).
- Verificação no navegador (Playwright) da tela de código em 320 px e zoom de 200%, e triagem axe, ao criar a tela (CA-12). Leitor de tela: pendente de testador humano, sem declarar conformidade.

## 6. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida traz recomendação e o que destrava. Numeração provisória `D-H013-n`; o líder encaixa na lista contínua da sessão.

- **D-H013-1 (resolvida pela #107; registrar).** 08 §5.1 itens 3 e 4 dizem que o código vai em `POST …/consume`. A revisão da #107 fixou `POST /v1/auth/challenges/verify`, e `/consume` é o link (#25). **Recomendação:** manter `/verify` para o código e atualizar 08 §5.1. Não bloqueia.
- **D-H013-2 (bloqueia o CA-07 no consumo do link).** A anexação do rascunho também vale para o link (`/consume`, já concluído em #25), ou só para o código? **Alternativas:** (a) as duas vias, com a mesma função compartilhada; (b) só o código, e o link segue sem anexar. **Recomendação:** (a). 08 §5.1 item 5 fala do consumo sem distinguir; 46 diz que a anexação é de H-013. Destrava a alteração de `/consume`.
- **D-H013-3 (bloqueia CA-06).** Onde o nonce é gravado? **Alternativas:** (a) cookie `__Host-fp_draft` (SHA-256 em `browser_nonce_hash`), gravado no pedido; (b) segundo cookie HttpOnly, como em 08 §5.1 item 5. **Recomendação:** (a), que segue 74 e a decisão 56 de H-026 e não cria cookie novo. Exige que `POST /v1/auth/challenges` leia o cookie (alteração pequena da rota da #107).
- **D-H013-4 (bloqueia CA-10).** Quem grava `email` e `first_name` no rascunho e cria as colunas? 74 atribui as colunas a H-011/H-013, mas H-025 não as criou e não aceita esses campos no PATCH. **Alternativas:** (a) #26 cria as colunas e aceita a gravação do e-mail e do nome no rascunho; (b) #43 faz a gravação e #26 só cria as colunas. **Recomendação:** (a), porque o teste de e-mail conferido depende desses campos e #43 só lê o estado.
- **D-H013-5 (bloqueia CA-09 e o CA-04 de #43).** Como representar "e-mail confirmado"? **Alternativas:** (a) campo de data `email_confirmado_em` no rascunho, com status `aguardando_email` até a confirmação; (b) novo valor de status (muda o `check` e a máquina de estados de H-025). **Recomendação:** (a), a mesma abordagem aceita na decisão 60 para a confirmação do pedido (sem status novo). Destrava #43.
- **D-H013-6 (não bloqueia; dono da tela).** A tela de digitação do código é de #26 ou de #43? 39 §8 diz que a tela do código é H-013; 89 (passo 6) põe a tela "confira seu e-mail" em H-030. **Recomendação:** #26 entrega a tela do código (campo e erros); #43 entrega só o passo e o estado de revisão. Confirmar com o Architect.
- **D-H013-7 (não bloqueia).** Resposta de sucesso quando o rascunho não é anexado (CA-08). **Recomendação:** resposta igual à de anexado, para não revelar se o rascunho existia. A tela pode ter um texto neutro para os dois casos.
- **D-H013-8 (não bloqueia; registro).** Em 11-DECISOES a decisão 56 aparece duas vezes (rodada 19 e refino de H-026). A próxima decisão livre é 65. **Recomendação:** o líder corrige a numeração ao registrar as decisões desta rodada.
- **D-H013-9 (não bloqueia).** O `/verify` não cria sessão nem chama o passo de identificação (CA-11). **Recomendação:** o `/verify` chama o mesmo passo posterior do `/consume` (função compartilhada). Confirmar com o Architect.
- **D-H013-10 (não bloqueia; decisão já registrada).** Plano de execução: 19 (O-5) manda partir H-013 em código (Onda 1) e anexação (Onda 2). H-025 já está concluída, então a anexação entra junto com o código nesta história. **Recomendação:** uma entrega só, com os critérios acima.

## 7. Próximo passo

Este refino fica em Product Owner até o líder validar D-H013-2 a D-H013-5 (bloqueiam o escopo). Só então a Issue #26 vai para Arquitetura, e a Issue #43 continua esperando #26 (D-H030-1). A movimentação do cartão é do Orquestrador, não deste refino.

## 8. Comando de commit

Não executado: esta sessão não tem ferramenta de shell (só leitura, busca e escrita de arquivo), então não há `git`. Mensagem sugerida quando houver shell: `docs(H-013): refino do código de 6 dígitos, nonce e anexação do rascunho`, com corpo `Refs: #26`, e os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVPL2o53TuuaUzciSZp`.
