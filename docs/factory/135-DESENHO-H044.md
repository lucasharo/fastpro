# Desenho técnico H-044 — Trial de 14 dias (Issue #57)

- **Issue:** #57 `[E5] Trial de 14 dias` · **História:** H-044 · **Épico:** E5 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, serviço externo (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `132-REFINO-H044.md` (CA-H044-01 a 18, RN-H044-01 a 10), Rodada 100 (decisões 496, 498, 499, 509; demais conforme o refino) e Rodada 102 (#52 concluída), `114-DESENHO-H045.md` e a migração `20261113170000_billing_create_access_grant.sql` (livro, `commercial_access`, `access_grant_revoke`), `124-DESENHO-H039.md` (única escritora de `verification_status = 'aprovada'`).
- **Etiquetas:** `[DECIDIDO n]` · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§10).
- **Limites da leitura:** não li o texto da Issue no GitHub nem consultei banco. Li apenas os arquivos listados acima, mais a listagem das pastas `apps/api/src`, `packages/domain/src/billing` e das últimas migrações.

## 1. Decisões e fatos que moldam o desenho

| Dec. | Efeito |
|---|---|
| 289 e 496 | `identity_id` é derivado de forma determinística do `document_hmac`, por migração nova nesta Issue; sem coluna nova em `professional_profile`. |
| 497 | A identidade é o documento, independente do perfil (perfil recusado ou retido que se cadastra de novo com o mesmo documento tem o mesmo `identity_id`). |
| 498 | Desenvolvimento só depois de #52 concluída. **Cumprida** (Rodada 102: #52 Concluída). |
| 499 | Negar o trial a quem já tem acesso pago **vigente**. |
| 509 | AMB-09 = A: um trial por identidade, nunca reativa. |
| 268, 273, 275 | Trial de 14 dias corridos; unicidade por `identity_id` no livro; livro imutável, sem DELETE. |
| 269, 274 | Pago prevalece sobre trial; `commercial_access` não verifica aprovação (a guarda é desta história, só para ativar). |
| 284 | A criação de concessão é auditada pelo escritor: H-044 audita a ativação. |

Fatos `[VERIFICADO]`:
- Últimas migrações: `20261113250000_contact_create_phone_consent.sql` e `20261113250100_contact_fix_available_volatile.sql`. Reservados por outras Issues: `20261113240000`, `20261113250000`, `20261113260000`. **Prefixo desta história: `20261113270000`** (o DEV reconfere se está livre na hora de criar; se não estiver, usa o próximo maior).
- `billing.access_grant` existe com `identity_id uuid not null` sem FK, `access_grant_trial_unico` (`unique (identity_id) where type = 'trial'`, inclui revogadas), `access_grant_trial_14d` (336 h), `access_grant_trial_sem_pagamento`, gatilho de imutabilidade (UPDATE restrito, DELETE e TRUNCATE recusados), RLS forçada sem política, **nenhum grant de escrita a nenhum papel** (só `select` a `app_system`).
- `private.commercial_access(uuid, timestamptz)` devolve `(estado, access_until)`, com execução a `app_api` e `app_system`. `private.access_grant_revoke` é `security definer` e escreve na tabela sem grant de escrita: o mecanismo (dono da função, RLS forçada, sem política) já está provado na #58, e esta história o reaproveita.
- `app.professional_profile.document_hmac text` com regex de 64 hexadecimais e índice único parcial que exclui `recusada` e `retida_duplicidade`. `verification_status` só é escrito pela função de decisão de H-039.
- `private.audit_append(p_actor_ref, p_actor_role, p_action, p_object_type, p_object_id, p_before_state, p_after_state, p_reason_code, p_correlation_id)`; ação nova exige linha em `audit.action_catalog (action, object_type, reason_required, state_keys, description)`; datas no estado em UTC com `Z` (padrão da revogação).
- Estrutura da API: arquivos planos `apps/api/src/professional-*-route.ts` com `professional-*-composicao.ts`; `apps/api/src/billing/` tem só `mercado-pago.ts` e `webhook-signature.ts`. Domínio de billing: `packages/domain/src/billing/{commercial-access,index,money,plans,types}.ts`; `types.ts` já tem `TRIAL_DIAS = 14` e `CARENCIA_HORAS = 72`.

## 2. Visão geral

```
Profissional aprovado aciona "Ativar teste grátis" (corpo vazio)
   -> POST /v1/billing/trial/activate  (sessão do profissional; id vem da sessão)
   -> serviço de domínio ativarTrial(porta, relógio, professionalId)
   -> adaptador chama private.trial_activate(prof, actor_ref, p_now, correlação)   [app_system]
        1. trava o perfil (for share): aprovada e com document_hmac?     não -> not_verified
        2. identity_id = private.identity_id_from_document_hmac(document_hmac)
        3. já existe trial da identidade (qualquer status)?              sim -> trial_used (+ auditoria)
        4. commercial_access(prof, p_now) pago vigente?                  sim -> paid_access_active
        5. insert trial [p_now, p_now + 336 h) on conflict do nothing    0 linhas -> trial_used (+ auditoria)
        6. audit_append 'billing.trial.activated' (mesma transação)      falha desfaz a linha
   -> 201 { starts_at, ends_at } | 403 | 409
Depois: commercial_access devolve trial_ativo; no fim, trial_expirado (derivado, sem job).
```

Princípios: (1) negação de negócio **não levanta exceção**: a função devolve código, para que a auditoria de `trial_used` (dec. 501) seja gravada e não desfeita; (2) falha técnica (auditoria, banco) levanta exceção e desfaz tudo; (3) a unicidade é do índice do livro, não de checagem prévia (a pré-checagem do passo 3 serve só para o código e para a auditoria, e a corrida é fechada no passo 5); (4) relógio injetado (`p_now` vem do relógio do servidor da API, nunca do cliente); (5) nenhum job, e-mail ou chamada ao gateway.

## 3. Derivação de `identity_id` (dec. 496 e 289)

**Migração:** `supabase/migrations/20261113270000_billing_create_trial_activation.sql`. **Rollback:** `supabase/rollbacks/20261113270000_billing_create_trial_activation.down.sql` (remove as duas funções e as duas linhas de catálogo; não toca em dados de livro; nenhuma linha de `access_grant` é apagada, pois o livro proíbe DELETE; se houver trial gravado, o rollback só remove funções e o cabeçalho avisa). Expansão pura e idempotente (`create or replace`, `on conflict do nothing`). Nenhuma tabela existente é alterada, nenhum `cron`, `ops.job` ou gatilho de tempo (CA-H044-16).

```sql
create or replace function private.identity_id_from_document_hmac(p_hmac text)
returns uuid language plpgsql immutable strict parallel safe security invoker set search_path = ''
as $$
begin
  if p_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'identidade_invalida' using errcode = '22023';
  end if;
  return encode(substring(sha256(convert_to('fastpro:identity:v1:' || p_hmac, 'UTF8')) from 1 for 16), 'hex')::uuid;
end
$$;
```

- **Determinística:** mesma entrada, mesmo uuid, em qualquer perfil e em qualquer época. É função pura (`immutable`), sem relógio e sem aleatoriedade.
- **Separação de domínio e versão:** o prefixo `fastpro:identity:v1:` impede que o `identity_id` seja um pedaço do `document_hmac` (o livro não guarda o HMAC nem prefixo dele) e permite uma `v2` no futuro sem ambiguidade. Usa só `sha256` nativo (sem `uuid-ossp`, sem `pgcrypto`). Trunca para 128 bits; risco de colisão desprezível para o volume do MVP (aniversário em 2^64). Não ajusta bits de versão do uuid (qualquer 128 bits é um `uuid` válido; documentado no comentário da função) `[PROPOSTA]`, `[PERGUNTA 530]`.
- **Privilégios:** `revoke all ... from public, anon, authenticated, service_role, app_api, app_system`; só o dono (e a função `trial_activate`, que é do mesmo dono) a executa. H-049 e as demais escritoras de `access_grant` **reaproveitam a mesma função** (registrar na Issue #62): `identity_id` é `not null` também em concessões pagas.
- **Alternativas rejeitadas:** (b) coluna `identity_id` em `professional_profile` (altera história concluída H-035/#48, exige preenchimento e índice, e coluna gerada `stored` reescreveria a tabela); (c) trocar o tipo no livro (altera a #58 concluída). A derivação por função torna a regra única e testável.
- **Sem FK** em `access_grant.identity_id` (como na #58); o documento `09-MODELO-DADOS.md` §3.1 e §3.10 passa a registrar "identidade derivada do `document_hmac` por função, sem coluna".
- **Cuidados:** o `identity_id` nunca sai da camada de banco: não vai em resposta, log nem auditoria (CA-H044-13). Se a chave do HMAC rotacionar no futuro, a identidade muda e a unicidade se perde: risco registrado em R2 e `[PERGUNTA 531]`.

## 4. Função `private.trial_activate` (CA-H044-01 a 16)

Assinatura: `private.trial_activate(p_professional_id uuid, p_actor_ref text, p_now timestamptz, p_correlation_id uuid default null) returns table (out_code text, out_grant_id uuid, out_starts_at timestamptz, out_ends_at timestamptz)`. Propriedades: `language plpgsql`, `volatile`, `security definer`, `set search_path = ''`, tudo qualificado. Sem `default` em `p_now` e sem `now()`/`clock_timestamp()` no corpo (relógio injetado, como em H-045).

Códigos de saída (`out_code`): `ok`, `not_verified`, `trial_used`, `paid_access_active`. Parâmetro nulo: exceção `22023 entrada_invalida` (falha técnica, nunca por regra de negócio).

Corpo de referência (o DEV pode refatorar mantendo a semântica):

```sql
declare
  v_status text; v_hmac text; v_identity uuid; v_estado text; v_id uuid;
  v_fim timestamptz := p_now + interval '336 hours';
begin
  -- validar parâmetros não nulos (22023)
  select verification_status, document_hmac into v_status, v_hmac
    from app.professional_profile where user_id = p_professional_id for share;
  if not found or v_status <> 'aprovada' or v_hmac is null then
    return query select 'not_verified', null::uuid, null::timestamptz, null::timestamptz; return;
  end if;
  v_identity := private.identity_id_from_document_hmac(v_hmac);

  if exists (select 1 from billing.access_grant where identity_id = v_identity and type = 'trial') then
    perform private.audit_append(p_actor_ref, 'profissional', 'billing.trial.denied', 'professional_profile',
                                 p_professional_id, '{}'::jsonb, '{}'::jsonb, 'trial_used', p_correlation_id);
    return query select 'trial_used', null::uuid, null::timestamptz, null::timestamptz; return;
  end if;

  select ca.estado into v_estado from private.commercial_access(p_professional_id, p_now) ca;
  if v_estado in ('ativa', 'cancelada_com_acesso_ate_fim_do_periodo', 'em_carencia') then
    return query select 'paid_access_active', null::uuid, null::timestamptz, null::timestamptz; return;
  end if;

  insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
  values (p_professional_id, v_identity, 'trial', p_now, v_fim, 'ativa')
  on conflict (identity_id) where type = 'trial' do nothing
  returning id into v_id;
  if v_id is null then   -- perdeu a corrida: outra transação gravou o trial da identidade
    perform private.audit_append(... 'billing.trial.denied' ... 'trial_used' ...);
    return query select 'trial_used', ...; return;
  end if;

  perform private.audit_append(p_actor_ref, 'profissional', 'billing.trial.activated', 'access_grant', v_id,
    '{}'::jsonb,
    jsonb_build_object('type', 'trial', 'status', 'ativa',
      'starts_at', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'ends_at',   to_char(v_fim at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    null, p_correlation_id);
  return query select 'ok', v_id, p_now, v_fim;
end
```

Decisões do desenho:
- **Aprovação (CA-01, dec. 504a):** `for share` no perfil impede que a decisão de H-039 (UPDATE de `verification_status`) mude o estado entre a checagem e a gravação do trial; a regra de aprovação é lida do perfil, não copiada. A "função única de elegibilidade" da dec. 504 é a leitura `verification_status = 'aprovada'` encapsulada aqui; a guarda de H-042 (#55) a consome por uma função de leitura própria quando for desenhada (não há lógica duplicada além de uma comparação de texto). Perfil inexistente, não aprovado ou sem `document_hmac`: mesmo código `not_verified` (resposta uniforme, sem revelar motivo; fail closed) `[PERGUNTA 532]`.
- **Acesso pago (CA-12, dec. 499):** "vigente" = `commercial_access` em `ativa`, `cancelada_com_acesso_ate_fim_do_periodo` ou `em_carencia` no instante `p_now` (a carência conta, pela dec. 269). Ex-pagante com acesso já `expirada` pode ativar o trial `[PERGUNTA 533]`. Corrida entre um pagamento sendo gravado (H-049) e a ativação no mesmo instante é risco aceito e baixo (§8, R4): o pago prevalece na leitura (dec. 269), então o efeito é só 14 dias extras no pior caso.
- **Ordem dos códigos:** `not_verified`, depois `trial_used`, depois `paid_access_active` `[PERGUNTA 534]`.
- **Corrida (CA-07):** o `insert ... on conflict (identity_id) where type = 'trial' do nothing` usa o índice parcial da #58; a segunda transação espera a primeira confirmar (ou desfazer) e então devolve `trial_used`, nunca erro 500. Se a primeira desfizer, a segunda grava (não há trial fantasma).
- **Duração (CA-02, CA-11):** `p_now + interval '336 hours'` (exato, sem aritmética de dia dependente de fuso), compatível com `access_grant_trial_14d`. `starts_at = p_now`: o instante do servidor na chamada (dec. 507, RN-H044-09). O adaptador obtém `p_now` do `Clock` do servidor; a rota não aceita instante algum do cliente. Não há guarda contra relógio fora de faixa dentro da função (os testes precisam de instantes explícitos; a função só é executável pelo papel de servidor) `[PERGUNTA 540]`.
- **Sem pagamento (CA-04):** `source_payment_id` fica nulo (o CHECK `access_grant_trial_sem_pagamento` o exige); nenhuma chamada ao gateway existe no caminho.
- **Auditoria (CA-14, dec. 501):** sucesso grava `billing.trial.activated` (objeto `access_grant`, estado com `type`, `status`, `starts_at`, `ends_at`; sem `identity_id`, sem HMAC, sem dado pessoal); `trial_used` grava `billing.trial.denied` com motivo `trial_used` e estado vazio; `not_verified` e `paid_access_active` não geram evento (ruído). Falha de `audit_append` no sucesso levanta e **desfaz o trial** (#19). `actor_ref` é montado pela API a partir da sessão (`professional:<uuid>` `[PROPOSTA]`; o DEV lê a regra de `actor_ref`/`actor_role` e de chaves proibidas de estado, `[NÃO VERIFICADO]`; `actor_role = 'profissional'` precisa casar com o padrão `^[a-z][a-z0-9_]{0,31}$`).
- **Catálogo de auditoria (mesma migração):**
  ```sql
  insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
   ('billing.trial.activated','access_grant',false,array['type','status','starts_at','ends_at'],'Trial de 14 dias ativado pelo profissional (H-044, Issue 57)'),
   ('billing.trial.denied','professional_profile',true,array[]::text[],'Ativação de trial negada por trial já usado (H-044, Issue 57)')
  on conflict (action, object_type) do nothing;
  ```
- **Privilégios (dec. 277 e 282):** `revoke all on function ... from public, anon, authenticated, service_role, app_api;` `grant execute ... to app_system;`. **Nenhum INSERT de tabela é concedido**: a função, `security definer`, escreve pelo dono, como `access_grant_revoke` (a nota da #58 de que INSERT "chega com os escritores" é atendida por função, que é mais restrita) `[PERGUNTA 537]`. `app_api` não executa: ativação é escrita e passa pela camada de servidor. O papel `app_system` é o que a API já usa nas funções `private` de H-039.
- **Sem job (CA-16):** nada de agendamento; o vencimento é leitura de `commercial_access` (P4).

## 5. Rota, composição, domínio e adaptador

### 5.1 Contrato da rota (`[DECIDIDO]` refino §3; códigos `[PROPOSTA]` do refino, perguntas 500, 502, 514)

`POST /v1/billing/trial/activate`

| Item | Contrato |
|---|---|
| Autenticação | Sessão do profissional (mesmo mecanismo das rotas `professional-*-route.ts`). Sem sessão: `401`, nada criado. O `professional_id` vem **da sessão**; o corpo nunca o traz (CA-15). |
| Corpo | Vazio ou `{}`. Qualquer chave (inclusive `professional_id`, campos de cartão ou Pix) devolve `400 invalid_body` e nada é criado `[PERGUNTA 538]`. |
| Outros métodos | `405`, com `Allow: POST`. |
| Sucesso | `201 { "starts_at": "<ISO UTC>", "ends_at": "<ISO UTC>" }`. Sem `identity_id`, `document_hmac`, nome, e-mail, documento ou valor. |
| `not_verified` | `403 { "error": "not_verified" }`, mensagem neutra, sem motivo interno nem detalhe de duplicidade. |
| `trial_used` | `409 { "error": "trial_used" }` (mesma resposta para o mesmo perfil ou para outro perfil do mesmo documento). |
| `paid_access_active` | `409 { "error": "paid_access_active" }` `[PERGUNTA 539]`. |
| Falha técnica | `500`/`503` genérico, sem mensagem de banco; nunca em negação de negócio. |
| Limite | Limite geral da API (#82), dec. 514a. |
| Cabeçalhos | `Cache-Control: no-store`. |
| Idempotência | Sem `Idempotency-Key`: repetir após sucesso devolve `409 trial_used`; a tela relê o estado ao receber o 409 `[PERGUNTA 536]`. |

### 5.2 Domínio (`packages/domain/src/billing/`, lógica pura)

- `trial.ts`: tipos `TrialActivationOutcome` (união de `ok` com `{ startsAt: Date; endsAt: Date }`, `not_verified`, `trial_used`, `paid_access_active`), porta `TrialActivationPort { activate(professionalId: string, at: Date): Promise<TrialActivationOutcome> }`, classe `TrialActivationError` (código fixo `trial_indisponivel`), função `ativarTrial(port, clock, professionalId)` (usa o `Clock` já existente em `commercial-access.ts`, sem relógio próprio), e a constante de texto de tela `TEXTO_ATIVACAO_TRIAL` (CA-H044-18; texto final aprovado pelo líder). Reusa `TRIAL_DIAS` de `types.ts`.
- `trial.test.ts`: ver §6.
- `index.ts` (barril): acrescentar `export * from './trial.js'` (apenas listado; o DEV edita) e o barril de topo `packages/domain/src/index.ts` já exporta `billing` (o DEV confere).

### 5.3 Adaptador de banco (`packages/db/src/`)

- `trial-activation.ts`: `createPgTrialActivation(client: SqlClient): TrialActivationPort`. Executa `select out_code, out_grant_id, out_starts_at, out_ends_at from private.trial_activate($1::uuid, $2::text, $3::timestamptz, $4::uuid)` com parâmetros posicionais. Valida que `out_code` pertence aos quatro valores (senão `trial_indisponivel`). Falha de banco vira `TrialActivationError('trial_indisponivel')` sem expor mensagem. Nunca devolve `out_grant_id` ao domínio (o id do livro não é dado de resposta).
- `trial-activation.test.ts`.
- Barril: acrescentar `export * from './trial-activation.js'` em `packages/db/src/index.ts` (apenas listado).

### 5.4 API (`apps/api/src/`, nomes planos como os demais)

- `professional-trial-route.ts`: manipulador do contrato do §5.1 (valida método, corpo vazio, sessão; chama o serviço; mapeia código para HTTP).
- `professional-trial-composicao.ts`: injeta o adaptador de banco com o papel `app_system`, o `Clock` do servidor e o gerador de `p_correlation_id` (o padrão da rota de perfil; o DEV alinha com `professional-profile-composicao.ts`, `[NÃO VERIFICADO]`).
- `professional-trial-route.test.ts`.
- Registro da rota no roteador existente (arquivo de composição principal, `composicao.ts`, apenas listado).

### 5.5 Interface (dec. 503a, `[PERGUNTA 541]`)

Botão mínimo "Ativar teste grátis de 14 dias" na tela de estado de H-041 (#54), com o texto de confirmação do §5.2. Seguindo o precedente da Rodada 101 (dec. 518), a entrega é um **módulo de apresentação** (estado da tela e texto) acoplado por contrato à rota; a tela completa fica para a história que criar a casca web do profissional. `[NÃO VERIFICADO]` se #54 já tem tela; se tiver, o DEV acrescenta o botão nela; se não, declara a pendência na Issue.

## 6. Plano de testes (T-xx por CA)

Dados sintéticos com marcador (`@example.test`, `randomUUID()`), instantes explícitos, transação desfeita (exceto T-08). Arquivos: `packages/db/tests/trial-activation.dbtest.mjs` (banco), `packages/db/tests/trial-activation-concorrencia.dbtest.mjs`, `packages/db/tests/trial-activation-migration.test.mjs` (estático, sem banco), `packages/db/src/trial-activation.test.ts`, `packages/domain/src/billing/trial.test.ts`, `apps/api/src/professional-trial-route.test.ts`. Fixtures de aprovação usam `verification_status = 'aprovada'` e `document_hmac` sintético (64 hex); a prova ponta a ponta pela decisão de H-039 entra como T-16.

| T | Prova | CA |
|---|---|---|
| T-01 | Para cada estado `pendente`, `em_revisao`, `retida_duplicidade`, `recusada`, `suspensa`: `trial_activate` devolve `not_verified`; `count(*)` de `access_grant` inalterado; perfil inexistente e perfil `aprovada` sem `document_hmac` idem; rota devolve `403 not_verified` com corpo idêntico nos casos | CA-01 |
| T-02 | Perfil `aprovada`: `ok`; exatamente 1 linha com `type='trial'`, `status='ativa'`, `starts_at = p_now`, `ends_at - starts_at = interval '14 days'` (e 336 h), `source_payment_id` nulo; rota devolve `201` com só `starts_at` e `ends_at` | CA-02 |
| T-03 | Aprovação simulada e leitura de `commercial_access`: nenhuma linha `trial` (nada é criado por aprovação, cadastro ou leitura); análise estática: nenhum gatilho em `professional_profile` ou `identity_document` insere em `access_grant` | CA-03 |
| T-04 | Rota com corpo vazio e `{}` funciona; corpo com `card_number`, `pix`, `professional_id` ou qualquer chave: `400 invalid_body`, nada gravado; contador do gateway falso permanece 0; estático: nenhum import de `mercado-pago` nos arquivos novos | CA-04 |
| T-05 | Segunda ativação da mesma identidade: `trial_used`, 1 linha; rota `409 trial_used` | CA-05 |
| T-06 | Três casos: trial `revogada` (via `access_grant_revoke`), trial vencido (`p_now` após `ends_at`) e **segundo perfil com o mesmo `document_hmac`** (primeiro `recusada`, segundo `aprovada`, mesmo `identity_id`): todos `trial_used`, sem linha nova | CA-06 |
| T-07 | Teste da derivação: mesma entrada gera o mesmo uuid; entradas diferentes geram uuid diferentes; entrada fora de `^[0-9a-f]{64}$` levanta `22023`; `provolatile = 'i'`, `proisstrict`; o valor não contém prefixo do HMAC; sem grant a `anon`, `authenticated`, `service_role`, `app_api`, `app_system` | CA-05, 06 (R1) |
| T-08 | Duas conexões, mesma identidade: A chama a função sem confirmar, B chama e fica esperando (verificado por `pg_stat_activity`); A confirma; B devolve `trial_used`. Resultado: 1 linha, 1 `ok`, 1 `trial_used`, nenhum erro. Variante: A desfaz, B grava (`ok`). Roda na janela exclusiva do DEV (R8); resíduo sintético marcado (ver §8 e `[PERGUNTA 542]`) | CA-07 |
| T-09 | Com relógio em `ends_at + 1 h` e `ends_at + 72 h`: `commercial_access` devolve `trial_expirado`; contagens de `type='paid'`, de `billing.subscription` e de chamadas ao gateway iguais a zero antes e depois | CA-08 |
| T-10 | Os mesmos dois instantes nunca devolvem `em_carencia` (linha criada pela função, não por fixture) | CA-09 |
| T-11 | Logo após `ok`: `commercial_access(prof, p_now + 1 s)` = `trial_ativo` e `access_until = ends_at` | CA-10 |
| T-12 | `ends_at - 1 s` = `trial_ativo`; `ends_at` = `trial_expirado` | CA-11 |
| T-13 | Fixtures com `ativa` (pago vigente), `cancelada_com_acesso_ate_fim_do_periodo` e `em_carencia`: `paid_access_active`, 0 linhas; fixture `expirada`: `ok` (se a pergunta 533 for aceita); trial vigente + pago vigente: `paid_access_active`/`trial_used` conforme a ordem da §4 | CA-12 |
| T-14 | Resposta HTTP e `after_state` do evento `billing.trial.activated`: chaves em lista branca; nenhum texto contém nome, e-mail, CPF/CNPJ, `document_hmac`, `identity_id` ou valor; varredura de strings em ambos | CA-13 |
| T-15 | Contagem de `audit.audit_event`: +1 `billing.trial.activated` por sucesso (ator, data, id do profissional); +1 `billing.trial.denied` com motivo `trial_used` por recusa dessa causa; 0 em `not_verified` e `paid_access_active`; falha injetada de `audit_append` (função de teste que levanta, em transação desfeita) desfaz o trial (0 linhas) | CA-14 |
| T-16 | Prova de ponta a ponta com a função real de decisão de H-039 (#52 concluída): perfil `em_revisao`, decisão `aprovada` por analista da Verificação e então `trial_activate` devolve `ok`; antes da decisão devolve `not_verified` | CA-01, 02 |
| T-17 | Rota: sem sessão `401`; sessão do profissional B não ativa o trial de A (o id vem da sessão; corpo com `professional_id` é `400`); outro método `405`; corpo com chave extra `400`; erros técnicos não vazam mensagem de banco | CA-15 |
| T-18 | Estático da migração: sem `cron`, `ops.job`, `pg_cron`, gatilho de tempo ou `now()` no corpo; consulta a `cron.job` (se existir) e `ops` sem linha nova; RLS e grants de `access_grant` inalterados; `trial_activate` `security definer`, `search_path = ''`, `execute` só a `app_system`; nenhum `insert`/`update` direto concedido | CA-16 |
| T-19 | Evidência local: `corepack pnpm check:all` e `corepack pnpm db:test` com comando, contagem e código de saída na Issue; nenhuma rede externa, chave ou conta; sem alegar CI | CA-17 |
| T-20 | `TEXTO_ATIVACAO_TRIAL` contém "sem cartão" e "14 dias", diz que não vira assinatura sozinho, e **não** contém termos de cobrança futura nem de pedidos (lista fixa); revisão do texto pelo líder registrada na Issue | CA-18 |
| T-21 | Domínio: `ativarTrial` usa o `Clock` injetado (instante repassado ao porto); mapeia os quatro códigos; erro técnico vira `trial_indisponivel`. Adaptador: parâmetros posicionais, rejeita `out_code` fora dos quatro valores, converte datas, não devolve `out_grant_id` | CA-02, 15 |
| T-22 | Regressão: `commercial-access*.dbtest.mjs` e `audit*.dbtest.mjs` verdes após a migração; teste de reversão (aplicar, `down`, reaplicar) em transação desfeita ou banco descartável do DEV | CA-17 |

Casos B-07 (trial expirado) e I-14 (trial único; fim sem cobrança) ficam cobertos por T-05, T-06, T-09, T-10 e T-18.

## 7. Segurança e impacto

- **Mínimo privilégio:** a escrita do livro continua sem grant de tabela; só a função `security definer`, executável por `app_system`, grava. `app_api`, `anon`, `authenticated` e `service_role` não executam. A função de derivação não é executável por ninguém além do dono.
- **Sem dado pessoal na saída:** nem resposta, nem log, nem auditoria têm `identity_id`, `document_hmac`, nome, e-mail ou valor. Mensagens de erro de banco não chegam ao cliente.
- **IDOR:** o id do profissional vem da sessão; corpo com `professional_id` é recusado.
- **Enumeração:** `not_verified` é uniforme para os cinco estados, perfil inexistente e perfil sem documento. `trial_used` pode revelar a um profissional **aprovado** que o documento já teve trial (inclusive de outro perfil); risco aceito, pois o chamador só vê o próprio caso e a mensagem é neutra.
- **Abuso:** `trial_used` gera evento de auditoria (dec. 501); a inundação é contida pelo limite geral da API (#82). O livro continua imutável.
- **Corrida:** índice único parcial do livro mais `for share` no perfil; a decisão de H-039 que muda `verification_status` espera a ativação confirmar (ou o contrário). Sem advisory lock.
- **Fail closed:** auditoria falhando desfaz o trial; `document_hmac` ausente nega; verificação perdida **depois** do trial não revoga o trial (dec. 505a), e a guarda de descoberta e aceite (H-042/#55) cuida dos pedidos.
- **Relógio:** `p_now` do `Clock` do servidor (não do cliente), 14 dias exatos em 336 h, sem aritmética de mês nem de fuso.
- **Impacto em outras histórias:** H-045 (#58) não muda (migração só adiciona funções e linhas de catálogo); H-049 (#62) e demais escritoras **devem usar `private.identity_id_from_document_hmac`** (registrar na Issue #62); H-042 (#55) consome `commercial_access` e a aprovação; H-041 (#54) recebe o botão; H-099 (#109) consome o fim do trial; E13 (#118, #119) trata a retenção da linha após expurgo (dec. 512a); H-039 (#52) não muda.
- **Documentação a atualizar no Desenvolvimento:** `09-MODELO-DADOS.md` §3.1 e §3.10 (origem de `identity_id`), `08-ARQUITETURA.md` (rota `POST /v1/billing/trial/activate` com códigos), `11-DECISOES.md` (decisões desta Rodada), Issue #62 (reuso da função de derivação).

## 8. Riscos e pendências

- **R1 (alto, mitigado):** identidade sem chave estável. Mitigação: derivação determinística (T-07) e teste de dois perfis com o mesmo documento (T-06).
- **R2 (médio):** rotação futura da chave do HMAC muda o `identity_id` e perde a unicidade de trials antigos. Mitigação: prefixo versionado `v1`; registrar como requisito de qualquer rotação (`[PERGUNTA 531]`).
- **R3:** perfil aprovado sem `document_hmac` (se H-035/H-040 permitirem). Nega por padrão (`not_verified`); o DEV confirma no teste de H-039 se a aprovação exige documento (`[NÃO VERIFICADO]`).
- **R4 (baixo):** pagamento e ativação do trial no mesmo instante: o pago prevalece na leitura; o pior efeito é 14 dias extras. Sem lock entre H-044 e H-049.
- **R5:** teste de concorrência com confirmação grava de verdade. O livro proíbe DELETE e a limpeza exigiria desligar o gatilho do livro ou `session_replication_role`, o que **não** é feito; o resíduo (perfil e trial sintéticos com marcador) fica para a triagem de #140, na janela exclusiva do banco (R8 do refino). A variante com desfazer não deixa resíduo.
- **R6:** `[NÃO VERIFICADO]` regras de `actor_ref`/`actor_role` e de chaves de estado de `audit_append`, existência de `app_system` com acesso ao esquema `billing` na função (a #58 já exerceu isso na revogação), layout final do roteador em `composicao.ts`, existência da tela de #54.
- **R7:** repetição após rede instável devolve `409 trial_used`; a tela relê o estado (pergunta 536).
- Nada aqui toca produção, Mercado Pago, e-mail ou GitHub.

## 9. Ordem de execução (Desenvolvimento, depois desta etapa)

1. Confirmar prefixo livre e os `[NÃO VERIFICADO]` do R6; criar migração e rollback; T-07, T-18 (estático) e T-01 a T-06, T-09 a T-15 (banco).
2. Concorrência (T-08) na janela exclusiva do banco de desenvolvimento.
3. Domínio (`trial.ts`) e adaptador (`trial-activation.ts`); T-20 e T-21.
4. Rota, composição e registro; T-04, T-14 (resposta) e T-17.
5. Prova ponta a ponta com a função real de H-039 (T-16) e botão/módulo de apresentação (§5.5).
6. Regressão e evidência local (T-19, T-22) e atualização dos documentos do §7; resumo em linguagem simples na Issue.

## 10. Perguntas ao líder (lista única, a partir de 530)

**530. Fórmula do `identity_id`.** Derivar por `sha256('fastpro:identity:v1:' || document_hmac)`, truncado a 128 bits, sem ajustar bits de versão do uuid, em `private.identity_id_from_document_hmac`.
- **Recomendação:** sim (prefixo versionado, separação de domínio e sem `pgcrypto`/`uuid-ossp`). Destrava a migração e T-07.

**531. Rotação da chave do HMAC.** A unicidade do trial depende de `document_hmac` estável.
- (a) Registrar como requisito de qualquer rotação futura (remapear ou manter `v1`); (b) gravar agora o `identity_id` em coluna de `professional_profile`.
- **Recomendação:** (a). Destrava R2 sem alterar história concluída.

**532. Perfil aprovado sem `document_hmac`.** (a) `not_verified` (fail closed); (b) permitir.
- **Recomendação:** (a). Destrava T-01 e R3.

**533. Ex-pagante com acesso `expirada`.** A dec. 499 nega só o acesso pago **vigente** (`ativa`, `cancelada_com_acesso_ate_fim_do_periodo`, `em_carencia`). (a) quem já pagou e perdeu o acesso pode ativar o trial; (b) quem já teve concessão paga em qualquer época é negado.
- **Recomendação:** (a), literal da dec. 499 (o refino dizia "concessão paga ou assinatura"; (b) exige ler o livro inteiro e só vale se o dono quiser trial só para quem nunca pagou). Destrava CA-12 e T-13.

**534. Ordem dos códigos de negação.** `not_verified`, depois `trial_used`, depois `paid_access_active`.
- **Recomendação:** sim. Destrava T-13.

**535. Auditoria de `paid_access_active` e `not_verified`.** (a) sem evento (só `trial_used` e sucesso, dec. 501); (b) auditar também.
- **Recomendação:** (a). Destrava CA-14.

**536. Repetição depois de sucesso.** (a) `409 trial_used` (CA-H044-05) e a tela relê o estado; (b) `200` idempotente com as mesmas datas para o mesmo perfil.
- **Recomendação:** (a), pelo texto do critério. Destrava T-05 e T-17.

**537. Privilégio de escrita.** O INSERT só por função `security definer` executável por `app_system`, sem conceder INSERT de tabela (mais restrito que o previsto na dec. 282).
- **Recomendação:** sim. Destrava T-18.

**538. Corpo da rota.** (a) qualquer chave no corpo devolve `400 invalid_body`; (b) ignorar chaves desconhecidas.
- **Recomendação:** (a), consistente com o contrato apertado da dec. 523 e com CA-04 e CA-15. Destrava T-04 e T-17.

**539. Código de negação por acesso pago.** `409 paid_access_active`.
- **Recomendação:** sim. Destrava CA-12 e a rota.

**540. Relógio injetado sem guarda de faixa.** A função confia em `p_now` do servidor da API; só `app_system` a executa; não compara com o relógio do banco.
- **Recomendação:** sim (mantém a regra de relógio injetado de H-045 e os testes com instantes explícitos). Destrava T-02 e T-11.

**541. Botão e tela.** (a) módulo de apresentação com texto e estado, acoplado à rota, e a tela na casca web quando existir (como dec. 518); (b) esperar uma tela de #54 pronta.
- **Recomendação:** (a); o DEV confere se #54 já tem tela. Destrava o escopo de interface (dec. 503).

**542. Resíduo do teste de concorrência (T-08).** O livro não permite DELETE; o teste com confirmação deixa um perfil e um trial sintéticos marcados no banco de desenvolvimento.
- **Recomendação:** aceitar o resíduo marcado, para a triagem de #140, com a variante de desfazer como prova sem resíduo. Destrava CA-H044-07.

## 11. Próximos passos

1. Líder responde 530 a 542 (lista única) e registra em `11-DECISOES.md` com os mesmos números.
2. Mover #57 para Desenvolvimento somente depois de conferir a coluna no quadro (não alterado aqui).
3. DEV resolve os `[NÃO VERIFICADO]` do R6 antes de escrever a migração e registra o prefixo usado.
4. Code Review confere o corpo da função contra o §4 (ordem, `for share`, `on conflict`, ausência de relógio e de job), os privilégios (T-18) e a ausência de dado pessoal (T-14).
