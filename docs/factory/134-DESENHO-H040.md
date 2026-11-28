# Desenho técnico H-040 — Retenção por duplicidade (Issue #53)

- **Issue:** #53 `[E4] Retenção por duplicidade` · **História:** H-040 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `131-REFINO-H040.md` (CA-H040-01 a 18, RN-H040-01 a 11), Rodada 99 (decisões 476 a 495, adotadas como recomendadas), `124-DESENHO-H039.md`, migração `20261111420000_identity_professional_profile_document.sql` (H-035) e, por leitura de conferência, `20261113200000_verification_create_case_queue.sql` (código real entregue por #52, CONCLUÍDA).
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§10).
- **Limites da leitura:** não li o texto da Issue no GitHub, não consultei banco e não li os testes inteiros de #52 (só os títulos que citam retenção). Não li `apps/web` nem a rota de aceite de pedido (ver T40-08).

## 1. O que realmente falta (conferido no código)

### 1.1 O que já existe e NÃO se refaz

- `[VERIFICADO]` H-035: índice único parcial `professional_profile_document_hmac_vivo_key` (documento único entre perfis com status fora de `recusada` e `retida_duplicidade`), função `private.professional_profile_set_document` que grava `retida_duplicidade` (checagem prévia mais captura de `unique_violation` na corrida), evento de auditoria `professional.document_duplicate`. A rota `professional-profile-route.ts` já devolve o mesmo corpo para pendente e retido (cabeçalho do arquivo). `[DECIDIDO 476]`: H-040 não recria o índice.
- `[VERIFICADO]` #52: caso `app.verification_case`, estados, `verification_case_assign`, `verification_case_decide`, `verification_case_appeal`, `idoc_review_target`, `verification_queue_list` (escopo `retidas`), `verification_case_detail`, espelho do caso no perfil (`private.verification_case_mirrors`) e o gatilho de proteção do perfil.

### 1.2 Lacunas reais (defeitos que a H-040 corrige)

Todas decorrem de um fato: um perfil com status `em_revisao` ou `aprovada` **entra no escopo do índice único**. Se outro perfil vivo tem o mesmo `document_hmac`, a atualização estoura `unique_violation` (23505), erro de servidor.

| ID | Lacuna | Onde (migração `20261113200000`) | Efeito hoje |
|---|---|---|---|
| L1 | Aprovar retido com original vivo | `verification_case_decide`, passo `aprovada` | 23505 no `update` do perfil; erro de servidor, sem mensagem de domínio (CA-H040-05) |
| L2 | Atribuir caso de perfil já retido pelo cadastro | `verification_case_assign` espelha `em_revisao` no perfil | 23505 se o original está vivo; se não está, o perfil sai de `retida_duplicidade` sem decisão (fere RN-H040-06) |
| L3 | Recurso de `retida_duplicidade` ou de `recusada` com original vivo | `verification_case_appeal` espelha `em_revisao` no perfil | 23505; recurso do profissional dá erro de servidor (CA-H040-11) |
| L4 | O caso de perfil retido pelo cadastro nasce `pendente` e fica na aba "Pendentes", não em "Retidas" | `verification_case_create` e filtro de `verification_queue_list` | Verificação não distingue retido de comum (CA-H040-16) |
| L5 | Visão da Verificação sobre o original (identificador curto e status) não existe | `verification_case_detail` não tem o campo e não pode mudar de assinatura | CA-H040-16 sem entrega |
| L6 | Recusar duplicado com o motivo natural `duplicidade_suspeita` é proibido | regra `recusada` não admite `duplicidade_suspeita` (passo 2 de `decide`) | Verificação só consegue recusar duplicado com `outro` e texto livre |
| L7 | Aprovação de retido: nenhum texto neutro e nenhum limite ao que a API do profissional revela | não existe função de domínio de mensagem | Risco de vazar `retida_duplicidade` na leitura de estado (H-041) (CA-H040-10) |
| L8 | Sem teste que prove retenção em quatro tipos de original, corrida e regressão | `verification-case*.dbtest.mjs` só cobrem a retenção manual (T-17, T-18) | CA-H040-01 a 04, 07, 08, 12 a 15 sem prova |
| L9 | Evento de auditoria do cadastro retido grava `user_id_existente` | `professional.document_duplicate` (H-035) | Conflita com RN-H040-10 (ver pergunta 528) |

Conclusão: a H-040 é **uma migração aditiva pequena** (uma função de checagem, uma visão, quatro ajustes de comportamento nas funções de #52 e um gatilho de auditoria) mais domínio, adaptador e testes.

### 1.3 Princípio de projeto (`[PROPOSTA]`, pergunta 524)

**O perfil retido não é espelhado em `em_revisao` e nenhuma aprovação passa por cima de original vivo.** O perfil `retida_duplicidade` só muda por decisão da Verificação (`aprovada`, só sem original vivo, ou `recusada`). O caso continua a máquina de estados de #52 (`pendente` -> `em_revisao` -> decisão), sem novo estado e sem relaxar nenhuma constraint. Consequência assumida: enquanto o perfil está retido, o espelho do caso no perfil fica adiado (o caso é a fonte, dec. 371; o perfil continua `retida_duplicidade`). Alternativa B (descartada na recomendação): caso retido nasce/migra para o estado `retida_duplicidade` por gatilho; exige relaxar `vc_decisao_completa`, ampliar a tabela de transições e o conjunto de ações de evento, e repete a lacuna no recurso.

## 2. Migração e rollback

- **Migração:** `supabase/migrations/20261113270000_verification_expand_duplicate_retention.sql`.
  - Prefixo `[VERIFICADO]`: o maior existente é `20261113250100` (#46). Estão reservados `20261113240000` (#45), `20261113250000` (já existe, #46) e `20261113260000` (#47). `20261113270000` é maior que todos. O DEV reconfere o prefixo livre na hora de criar.
  - Aplicar com `npx supabase` no banco de desenvolvimento. Idempotente (`create or replace`, `drop trigger if exists`, `on conflict do nothing`). Sem `cron`, `ops.job` nem gatilho de tempo (CA-H040-14). Sem chamada externa.
- **Rollback:** `supabase/rollbacks/20261113270000_verification_expand_duplicate_retention.down.sql`: remove os gatilhos e funções novas, apaga a ação nova do catálogo de auditoria que a migração inseriu e **restaura os corpos de `assign`, `decide`, `appeal`, `idoc_review_target` e `verification_queue_list`** copiando os de `20261113200000` (assinaturas idênticas). Não desfaz eventos de auditoria (append-only) nem estado de perfis/casos. Seguro enquanto não houver decisão que dependa do comportamento novo; registrar no cabeçalho.
- **Compatibilidade:** nenhuma assinatura pública de #52 muda. Nenhuma coluna ou constraint muda. Perfis e casos existentes continuam válidos. Sem backfill (ver pergunta 531 sobre uma única conversão idempotente opcional).

## 3. Funções `private` e mudanças nas da #52

Padrão de #52 mantido: `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role, app_api`, `grant execute ... to app_system` (assinaturas completas); funções de gatilho sem `execute` para ninguém. Autorização dentro da função; erro uniforme `42501 permissao_negada` para negação de existência, de atribuição e de permissão.

### 3.1 Funções novas

1. `private.verification_duplicate_original_alive(p_professional uuid) returns boolean` (`stable`, `security definer`). Verdadeiro se existe **outro** perfil (`user_id <> p_professional`) com o mesmo `document_hmac` do perfil informado e `verification_status not in ('recusada','retida_duplicidade')` (mesma condição do índice; "vivo" = pendente, em_revisao, aprovada ou suspensa, conforme `[DECIDIDO 482]`). Perfil sem `document_hmac`: falso. Nome em português do banco: `original_vivo`.
2. `private.verification_profile_mirror_blocked(p_professional uuid) returns boolean` (`stable`). Verdadeiro se o perfil está `retida_duplicidade` **ou** se espelhar `em_revisao` colidiria com original vivo (perfil `recusada` com original vivo). Usada por `assign` e `appeal` para pular o `update` do perfil.
3. `private.verification_duplicate_view(p_actor uuid, p_session_hash text, p_case uuid, p_now timestamptz) returns table (out_is_duplicate boolean, out_original_short_id text, out_original_status text, out_original_alive boolean, out_can_approve boolean, out_document_hmac_present boolean)`.
   - Autoriza como `verification_case_detail`: `verification.review` e sessão válida (`private.verification_session_ok`); caso inexistente, de outro analista ou negado: `permissao_negada` (mesma regra de visibilidade do detalhe: sem dono ou do próprio ator).
   - `out_is_duplicate`: perfil do caso está `retida_duplicidade` ou existe outro perfil com o mesmo HMAC (qualquer status).
   - `out_original_short_id`: `left(user_id::text, 8)` do outro perfil, escolhido por prioridade: vivo; senão o mais recente recusado; senão nulo `[PERGUNTA 529]`.
   - `out_original_status`: **só vocabulário fixo** `vivo`, `recusado` ou `nenhum`. Nunca o status interno, nunca nome, e-mail, documento, HMAC, `document_type` nem datas do outro perfil.
   - `out_can_approve`: `not original vivo` (a tela desabilita "Aprovar"; a função de decisão continua sendo a barreira).
   - `out_document_hmac_present`: apenas booleano de apoio a teste; o HMAC nunca sai da função.
4. `private.professional_profile_retained_audit()` (gatilho `AFTER UPDATE OF verification_status ON app.professional_profile`, `WHEN (old.document_hmac is null and new.verification_status = 'retida_duplicidade' and old.verification_status is distinct from 'retida_duplicidade')`). Chama `private.audit_append('system:verification','system','verification.profile.retained','professional_profile', new.user_id, '{}'::jsonb, '{"verification_status":"retida_duplicidade"}'::jsonb, 'duplicidade_suspeita', null)`. Estado sem CPF/CNPJ, HMAC nem identificador do original (CA-H040-12). Cobre só o cadastro (a retenção manual já gera `verification.case.decided`). Registro novo em `audit.action_catalog`: `verification.profile.retained`, `object_type='professional_profile'`, `reason_required=true`, `state_keys=array['verification_status']`. `[NÃO VERIFICADO]` o nome da coluna `reason_required` e a validação `audit_state_is_valid`; o DEV lê a regra antes. Gatilho nomeado `professional_profile_retained_audit` e habilitado normalmente (não toca `professional_profile_guard_update`).

### 3.2 Mudanças aditivas em funções de #52 (assinatura inalterada, comportamento anterior preservado)

| Função | Mudança | Preserva |
|---|---|---|
| `private.verification_case_decide` | (a) Depois dos passos da aprovação (documento analisado, perfil não suspenso, gate REG), acrescenta: `if p_decision = 'aprovada' and private.verification_duplicate_original_alive(v_case.professional_id) then raise exception 'original_vivo' using errcode = 'VRF08'; end if;` (b) Na validação de motivo, passa a aceitar `recusada` + `duplicidade_suspeita` **somente** quando `v_case.status = 'retida_duplicidade'` ou o perfil está `retida_duplicidade` `[PERGUNTA 526]`. Nenhuma outra combinação muda. | Ordem dos passos e códigos VRF01 a VRF07 |
| `private.verification_case_assign` | No `update` do perfil que espelha `em_revisao`: executar só se `not private.verification_profile_mirror_blocked(v_case.professional_id)`. O `update` do caso, o evento e a auditoria continuam. | `pendente -> em_revisao`, recurso sem dono, `42501`/`VRF01` |
| `private.verification_case_appeal` | Mesmo condicional no `update` do perfil. O caso vai a `em_revisao` sem dono e `appeal_status='pendente'` como hoje; perfil retido (ou recusado com original vivo) permanece no status atual. Evento e auditoria idênticos (nenhuma indicação de colisão na resposta ao profissional: `out_code` continua `ok`). | Códigos `ok`, `sem_caso`, `nao_elegivel`, `recurso_ja_usado` |
| `private.idoc_review_target` | Nenhuma mudança necessária no estado: com o princípio 1.3 o caso retido é lido em `em_revisao`. | Contrato `(id, stored_type)` |
| `private.verification_queue_list` | `retidas` passa a incluir também casos cujo perfil está `retida_duplicidade` e ainda sem decisão final (`c.status in ('pendente','em_revisao') and p.verification_status = 'retida_duplicidade'`); `pendentes` exclui esses. Colunas de saída e ordenação inalteradas (mesmo `returns table`). `minhas` e `recursos` inalterados. | Paginação, limite, campos permitidos |

`[NÃO VERIFICADO]` O DEV confirma que o `join` com `app.professional_profile` na fila não expõe coluna alguma (só filtra). Se `create or replace` recusar mudança de corpo por dependência, o rollback e a migração usam `drop function` + `create function` com os mesmos `grant`s.

### 3.3 Corrida e erro de servidor

- A checagem de `decide` é a barreira de negócio (erro `VRF08`). O índice continua sendo a barreira de integridade: duas aprovações simultâneas de irmãos retidos serializam pelo índice; a segunda recebe 23505. O adaptador mapeia 23505 da restrição `professional_profile_document_hmac_vivo_key` para o mesmo erro de domínio `original_vivo`. Nenhum advisory lock novo `[PERGUNTA 532]`. A transação inteira desfaz (caso, perfil, evento, auditoria).
- O cadastro concorrente (H-035) não muda.

## 4. Domínio e adaptador

### 4.1 Domínio (`packages/domain/src/verification/`; só lógica pura)

- Novo `duplicate-retention.ts`: `ORIGINAL_STATUS = ['vivo','recusado','nenhum']`, tipo `DuplicateView`, `podeAprovarRetido(view)`, `ehCasoRetido(...)`.
- Novo `professional-status-message.ts`: `mensagemAoProfissional(estadoInterno)` e `estadoPublicoDoProfissional(estadoInterno)`. Regra: `pendente`, `em_revisao` e `retida_duplicidade` viram o mesmo estado público `em_analise` e o mesmo texto: "Não foi possível concluir seu cadastro agora. Vamos revisar seu caso." (`[DECIDIDO 483]`); nunca "duplicado", "já existe" ou identificador. `recusada` e `aprovada` têm textos próprios fora de H-040 (só se H-039/H-041 já definem). `[PERGUNTA 530]`.
- Editar `types.ts`: erro de domínio `original_vivo`; tipo `DuplicateView`. Editar `reasons.ts`: `validarDecisaoMotivo` aceita `recusada` + `duplicidade_suspeita` quando o contexto informa caso retido. Editar `ports.ts`: `VerificationCasePort.duplicateView(ator, caso)`. Editar `service.ts`: mapeia `VRF08` e 23505 para `original_vivo`; expõe `duplicateView`. `transitions.ts` e `sla.ts`: sem mudança.
- Testes: `packages/domain/src/verification/duplicate-retention.test.ts` e `professional-status-message.test.ts`; ajuste em `verification.test.ts` (motivo contextual).
- Barris só listados (sem lógica): `packages/domain/src/verification/index.ts` (exporta os dois módulos novos).

### 4.2 Adaptador (`apps/api/src/`)

- `verification/pg-verification-case-store.ts`: método `duplicateView` chamando `private.verification_duplicate_view`; mapeamento de `VRF08` e de 23505 (restrição do índice) para `original_vivo`; nenhum log do corpo nem do HMAC.
- `admin-verification-route.ts`: rota nova `GET /admin/verificacao/casos/:id/duplicidade` (permissão `verification.review`; `Cache-Control: no-store`; negação de caso: `404 nao_encontrado` de corpo idêntico; resposta só com `{ duplicada, originalId, originalStatus, podeAprovar }`). `POST .../decisao` passa a devolver `422 original_vivo` com mensagem fixa "Este cadastro não pode ser aprovado enquanto o documento estiver em uso por outro perfil ativo. Recuse ou aguarde." (texto final a aprovar). Nenhuma outra rota nova. Nenhuma rota de recurso (`[DECIDIDO 489]`; é de H-041).
- Profissional: **nenhuma rota nova**. `professional-profile-route.ts` já devolve corpo igual; H-040 só consome `estadoPublicoDoProfissional` quando H-041 criar a leitura de estado (contrato registrado aqui, sem alterar a rota agora). Barris só listados: `apps/api/src/verification/index.ts`, `apps/api/src/verification/verification-composicao.ts` (injeção do novo método; sem lógica).
- Tela do console: fora do escopo de H-040 (mantém decisão sobre #112). O estado `podeAprovar` e `originalStatus` ficam prontos para a tela de #52/H-041. `[PERGUNTA 533]` sobre exibir na tela existente.

## 5. Plano de testes (T40-xx por CA)

Arquivos novos: `packages/db/tests/verification-duplicidade.dbtest.mjs`, `packages/db/tests/verification-duplicidade-concorrencia.dbtest.mjs`, `packages/db/tests/verification-duplicidade-migration.test.mjs` (estático), `apps/api/src/verification/duplicate.test.ts`, mais os testes de domínio do §4.1. Dados sintéticos com marcador único e transação desfeita (`rollback`), salvo concorrência (Rodada 65). Reuso dos auxiliares de `verification-case-regras.dbtest.mjs`.

| T | Prova | CA |
|---|---|---|
| T40-01 | Cadastro com HMAC de original em `pendente`, `em_revisao`, `aprovada` e `suspensa`: segundo fica `retida_duplicidade` (quatro originais) | CA-H040-01 |
| T40-02 | Original `recusada` libera: segundo cadastro com o mesmo HMAC fica `pendente` | CA-H040-02 |
| T40-03 | Estado, `suspended_at`, `verified_at` e HMAC do original idênticos antes e depois da retenção | CA-H040-03 |
| T40-04 | Duas conexões, mesmo HMAC, cadastros simultâneos (concorrência): um fica `pendente`, o outro `retida_duplicidade`, nenhum 23505 escapa | CA-H040-04 |
| T40-05 | `decide aprovada` de retido com original vivo: `VRF08`, caso, perfil, eventos e auditoria intactos; com original recusado: aprova; com dois irmãos retidos e original recusado: o primeiro aprova, o segundo recebe `VRF08` | CA-H040-05 |
| T40-06 | Liberação motivada: retido -> `aprovada` (sem original vivo) e `recusada` com motivo passam; sem motivo ou motivo inválido: `VRF02`; `recusada` + `duplicidade_suspeita` aceita só com perfil retido, recusada nas demais; regressão do T-07 de #52 | CA-H040-06 |
| T40-07 | Retenção não suspende, não bloqueia login e não altera pedidos existentes do profissional (contagem e status de `app.request` antes e depois) | CA-H040-07 |
| T40-08 | Perfil retido não consegue aceite, conversa nem mensagem. `[NÃO VERIFICADO]` o DEV localiza a função de aceite em `app`/`private`; se o aceite ainda não exigir `aprovada`, o teste vira estático e a pendência é declarada (pergunta 535) | CA-H040-08 |
| T40-09 | Retido não ativa trial: teste fica pendente até H-044; hoje, teste estático de que nenhuma função existente dá trial a status diferente de `aprovada` | CA-H040-09 |
| T40-10 | Cadastro pendente e retido serializam o mesmo corpo e status HTTP (teste de rota com as duas respostas); varredura do texto de `mensagemAoProfissional`: sem dígitos de documento, sem "duplic", sem "já existe", sem UUID; `estadoPublicoDoProfissional` mapeia os três estados internos para `em_analise`. Tempo não é medido (mesmo caminho de código; ver §6) | CA-H040-10 |
| T40-11 | Recurso de retido e de recusado com original vivo: `out_code='ok'`, caso `em_revisao` sem dono, `appeal_pendente`, perfil mantém o status, nenhum 23505; sem original vivo: perfil espelha `em_revisao`; varredura de rotas: nenhuma rota nova de recurso | CA-H040-11 |
| T40-12 | Evento `verification.profile.retained` grava `reason_code='duplicidade_suspeita'`; estado e correlação sem CPF/CNPJ, HMAC, `user_id` do original; varredura do texto dos logs do teste. Cadeia de hash válida | CA-H040-12 |
| T40-13 | Troca de documento em retido: o gatilho de imutabilidade de H-035 recusa (`professional_documento_imutavel`); nenhum caso novo; status intacto | CA-H040-13 |
| T40-14 | Estático: nenhum `cron`, `ops.job`, gatilho de tempo ou função agendada nova; consulta a `cron.job` sem entradas novas; nenhuma função muda perfil retido sem ator | CA-H040-14 |
| T40-15 | `sla_target_at` do caso de perfil retido segue `verification_sla_target`; fronteiras (sexta, sábado, quinta); sem alerta | CA-H040-15 |
| T40-16 | Fila: caso de perfil retido aparece em `retidas`, não em `pendentes`; `duplicate_view` devolve só os campos permitidos e vocabulário fixo; resposta HTTP com lista branca; perfil sem duplicidade devolve `out_is_duplicate=false` | CA-H040-16 |
| T40-17 | Regressão: `identity-professional-profile-document*.test|dbtest`, `verification-case*.dbtest.mjs`, `verification-sla-paridade`, `verification-rollback`, `admin-access-case*`, `admin-rbac`; `corepack pnpm check:all` e `db:test` com comando, contagem e código de saída na Issue | CA-H040-17 |
| T40-18 | Estático: nenhuma chamada externa, nenhum Mapbox; migração: RLS e grants (`execute` só a `app_system`; `search_path=''`; sem grant a `anon`, `authenticated`, `service_role`, `app_api`); aplicar, rollback e reaplicar em banco descartável de dev; nenhuma alegação de CI | CA-H040-18 |

Ajuste necessário nos testes existentes de #52: `verification-case-migration.test.mjs` (lista de funções com `execute` e nomes), o teste de regra de motivo que proíbe `recusada` + `duplicidade_suspeita` (só em contexto não retido) e qualquer teste que presuma `pendentes` inclui perfil retido. O DEV lista e ajusta com a nota na Issue.

## 6. Segurança e impacto

- **Privilégio mínimo:** nenhuma tabela ganha grant; só funções com `execute` a `app_system`; a visão da duplicidade exige `verification.review` e a regra de visibilidade do detalhe; Superadmin continua sem ler nem decidir (dec. 383).
- **Anti-enumeração:** o profissional nunca recebe `retida_duplicidade` nem distingue cadastros duplicados: mesmo corpo e status no cadastro (já existente), mesmo estado público `em_analise`, mesmo texto. O recurso devolve `ok` mesmo com colisão. Limite de tentativas: reutiliza o existente (`[DECIDIDO 495]`). Tempo de resposta idêntico não é medido por teste (a diferença é uma consulta já executada em H-035); risco residual baixo, registrado.
- **Dado mínimo:** a visão da Verificação mostra 8 caracteres do `user_id` do original e `vivo`/`recusado`/`nenhum`. Sem nome, e-mail, CPF/CNPJ, HMAC, data ou tipo do documento do outro perfil.
- **Auditoria:** evento novo sem dado pessoal; o evento antigo de H-035 `professional.document_duplicate` guarda `user_id_existente` (L9, pergunta 528). A cadeia é append-only e interna; não se altera.
- **Fail closed:** erro de auditoria desfaz a operação; `VRF08` impede aprovar sobre original vivo; 23505 do índice vira erro de domínio, nunca 500 isolado.
- **Concorrência:** `for update` do caso e do perfil já existem em #52; o índice serializa irmãos; sem lock novo.
- **Impacto em outras histórias:** #52 (quatro funções e a fila mudam sem mudar assinatura; regressão obrigatória), #48/H-035 (sem mudança; só teste), #54/H-041 (consome `estadoPublicoDoProfissional` e a função de recurso; a tela é dela), #51/H-038 (aprovação de retido com REG continua fail closed, `[DECIDIDO 492]`), #57/H-044 (trial só de `aprovada`; teste fica pendente), E11 (sem e-mail), H-006 (catálogo de auditoria: uma ação nova).
- **Documentação a atualizar no Desenvolvimento:** `09` §3.3 (regra "espelho adiado para perfil retido" e `VRF08`), `08` (transições e fila `retidas`), `11-DECISOES.md` (rodada de desenho).
- **Fora de escopo mantido:** índice (já existe), tela do profissional, rota de recurso, job de liberação, backfill, suspensão, e-mail, Mapbox, dado de teste fora do DEV.

## 7. Ordem de execução

1. Leitura de conferência dos `[NÃO VERIFICADO]`: nomes das constraints não mudam (nada a mudar), assinatura da função de aceite (T40-08), coluna `reason_required` do catálogo de auditoria, `verification_session_ok`.
2. Migração, rollback e testes estáticos/dbtests: T40-01 a T40-07, T40-11 a T40-16, T40-18 (aplicar com `npx supabase` no banco de dev).
3. Domínio e testes: T40-10 (mensagem), regra de motivo contextual.
4. Adaptador e rota de leitura da duplicidade; `422 original_vivo`; teste de rota.
5. Ajustar os testes de #52 listados e rodar a regressão completa (T40-17); registrar comando, contagem e código de saída na Issue.
6. Atualizar documentação (§6), mover a Issue só pelo líder.

Dependências: #52 CONCLUÍDA `[VERIFICADO]` (Rodada 102), #48 concluída. H-041 (#54) e H-044 (#57) não bloqueiam o backend.

## 8. Riscos

- **R1.** Pular o espelho do perfil cria divergência caso x perfil enquanto o perfil é retido ou recusado com original vivo. Mitigação: regra única em uma função (`mirror_blocked`), teste de cada ramo e documentação em `09`.
- **R2.** Alterar o corpo de quatro funções de #52 pode quebrar seus testes. Mitigação: só ramos novos, assinaturas intactas, regressão completa, rollback com os corpos originais.
- **R3.** Cadastro retido com original que depois some (recusado) fica retido até decisão (sem liberação automática, `[DECIDIDO 479]`). Aceito; meta de dois dias úteis.
- **R4.** Aprovar o segundo irmão retido quando o original é recusado e o primeiro irmão já foi aprovado: `VRF08` (correto). A Verificação precisa recusar.
- **R5.** Texto de erro `original_vivo` na tela da Verificação revela existência de outro perfil à própria Verificação. Aceito (papel autorizado, dec. 484).

## 9. Ambiguidades e achados novos

- Refino §1.1 já superou a premissa da dec. 374 (índice em H-040). Este desenho a confirma.
- O refino diz que o recurso leva o caso a `em_revisao` (CA-H040-11). Mantido, e acrescenta que o perfil retido não é espelhado.
- O refino §6.2 permite `retida_duplicidade -> aprovada` só sem original vivo; o caso, no entanto, já é `em_revisao` quando a Verificação decide (o gatilho de #52 permite `em_revisao -> aprovada`/`recusada`). Nenhuma mudança no gatilho do caso.

## 10. Perguntas ao líder (lista única, a partir de 524)

**524. Como o caso de perfil retido pelo cadastro é tratado.**
- (a) O caso segue a máquina de #52 (`pendente -> em_revisao -> decisão`) e o espelho no perfil é adiado enquanto o perfil está retido (ou recusado com original vivo).
- (b) O caso migra para `retida_duplicidade` por gatilho; exige relaxar `vc_decisao_completa`, ampliar transições e ações de evento.
- **Recomendação:** (a): menor mudança e sem relaxar constraints. Destrava o §3 inteiro.

**525. Perfil retido nunca é espelhado em `em_revisao`.** Vale também quando o original já foi recusado (sem colisão): só decisão da Verificação libera.
- **Recomendação:** sim, por RN-H040-06 e dec. 379. Destrava T40-11 e `mirror_blocked`.

**526. Recusar retido com o motivo `duplicidade_suspeita`.** Hoje a regra de #52 proíbe `recusada` + `duplicidade_suspeita`.
- **Recomendação:** permitir só quando o perfil está retido; demais casos mantêm a regra. Destrava L6 e T40-06.

**527. Recurso de retido (ou recusado) com original vivo.** O caso vai a `em_revisao` sem dono, mas o perfil não muda de status e o profissional recebe `ok`.
- **Recomendação:** sim, para não vazar a duplicidade e não gerar erro de servidor. Destrava L3 e CA-H040-11.

**528. Evento antigo `professional.document_duplicate` (H-035) grava `user_id_existente`.** Conflita com RN-H040-10 e CA-H040-12.
- (a) Manter como está (append-only, interno, anterior à H-040) e restringir CA-H040-12 ao evento novo `verification.profile.retained`.
- (b) Parar de gravar `user_id_existente` daqui para frente, trocando o estado dessa ação (mudança em H-035).
- **Recomendação:** (a), com o risco registrado. Destrava T40-12.

**529. Identificador curto do original.** Primeiros 8 caracteres do `user_id` do perfil original (e não do caso do original).
- **Recomendação:** sim; só vivo ou mais recente recusado. Destrava `duplicate_view` e CA-H040-16.

**530. Estado público do profissional.** A API do profissional nunca devolve `retida_duplicidade`: devolve `em_analise` para `pendente`, `em_revisao` e `retida_duplicidade`, com o texto neutro da dec. 483.
- **Recomendação:** sim; H-041 consome a função de domínio. Destrava CA-H040-10 e H-041.

**531. Conversão única de casos existentes.** No banco de desenvolvimento pode haver caso `pendente` de perfil já retido (sem divergência de dados, só na fila `retidas`). O filtro novo da fila já resolve; não é preciso converter linhas.
- **Recomendação:** sem backfill (`[DECIDIDO 494]`); o filtro cobre. Destrava §2.

**532. Concorrência de aprovação de irmãos retidos.** Usar só a checagem prévia mais o índice (23505 mapeado para `original_vivo`), sem advisory lock.
- **Recomendação:** sim. Destrava T40-05 e §3.3.

**533. Exibição na tela do console.** A tela de #52 já saiu como módulo de apresentação; H-040 entrega rota e contrato (`podeAprovar`, `originalStatus`) e não mexe na tela.
- **Recomendação:** sim; ajuste visual entra com H-041 ou uma tarefa de acompanhamento. Destrava o escopo de #53.

**534. Texto do erro `original_vivo` na rota da Verificação.** Proposta: "Este cadastro não pode ser aprovado enquanto o documento estiver em uso por outro perfil ativo. Recuse ou aguarde."
- **Recomendação:** aprovar o texto (linguagem simples, sem identificador). Destrava o teste da rota.

**535. Teste de "retido não aceita trabalho" (CA-H040-08).** Se a função de aceite ainda não bloqueia perfil que não esteja `aprovada`, entregar só o teste estático e abrir pendência para o dono da função de aceite, em vez de alterá-la dentro de H-040.
- **Recomendação:** sim, para respeitar o escopo; o DEV confirma antes. Destrava T40-08.

## 11. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\134-DESENHO-H040.md`.
- Nenhum código, migração, teste, chamada externa ou quadro foi alterado. A Issue #53 permanece na coluna em que o líder a deixou.
