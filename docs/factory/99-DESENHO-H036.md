# Desenho H-036 — Perfil profissional: serviços, base e raio (Issue #49, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, sem dúvida bloqueante para o desenvolvimento. Dúvidas não bloqueantes em §9.
- **Rastro:** 98-REFINO-H036 (CA-01..CA-13); decisões 109 a 116 (`11-DECISOES.md`, rodada 32, não reabertas); 88-DESENHO-H022 (§1, §2.2, §5: `match_*` e gatilho de #35); 68-DESENHO-H021 (§2, §3, §5; porta permanente e `app.geocode_point`); 97-DESENHO-H023 (§2.2: contrato que #36 espera de `professional_service` e `professional_area`); 75-DESENHO-H035 (rota e adaptador do perfil); 09-MODELO-DADOS §3.3; 08-ARQUITETURA §4.3, §9.1; 11-ARQ I-16, I-28, T-03, T-11, G-07; migrações `20261111400000` (perfil), `20261111200000` (catálogo), `20261111370000` e `20261111390000` (geo), `20261112120500` (`match_*`), `20261110140000` (auditoria), `20261111170000` (`rl_check`/`rl_hit`), `20261110130000` (`ops.app_config`).
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado.
- **Etiquetas:** `[DECIDIDO]` dono do produto ou líder · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` depende de prova em desenvolvimento ou de outra Issue.

## 0. Situação encontrada
1. `[VERIFICADO]` Existem `app.professional_profile` (PK `user_id`, `verification_status` com `suspensa`), `app.service` (coluna `modality` em `presencial|online|ambos`, `regulated`, `active`), `app.geocode_point` com `subject_kind='professional_base'` já aceito, `app.geocode_budget` (sem teto fixo para `professional_base`, 68 §2.1: "decisão de H-036"), `private.geo_reserve/geo_store_permanent/geo_mark_no_result/geo_release`, o gatilho de `match_*` (#35), `private.audit_append`, `private.rl_check/rl_hit`, `ops.app_config` e o serviço `ensurePermanentPoint` (apps/api/src/geo). Última migração existente: `20261112150000`.
2. `[VERIFICADO]` **Não existem** `app.professional_service`, `app.professional_area`, histórico de base, rota de serviços/área nem **adaptador Postgres da porta `GeoPointStorePort`** (só o simulado em `apps/api/tests/geo-permanent-store-fake.ts`). O DEV desta Issue escreve o adaptador Pg (H-031 o reutilizará).
3. `[VERIFICADO]` O texto do endereço **não** é guardado em `geocode_point` (só `address_hash` HMAC). O texto completo (decisão 113) fica em `professional_area.base_label`, privado.
4. `[VERIFICADO]` `private.audit_key_is_forbidden` barra chaves com `endereco`, `lat`, `latitude`, `longitude`, `nome`, `email` etc. As chaves de auditoria desta Issue (§6) foram escolhidas fora dessa lista e o teste as passa por `private.audit_keys_are_clean`.
5. `[VERIFICADO]` `service_request` e participação em pedido ainda não existem (H-031/#44 e posteriores). CA-09 e CA-13 têm uma parte provável agora e uma parte `[NÃO VERIFICADO]` até lá (§7).

## 1. Princípios
1. **O banco decide, a API traduz.** Toda regra (modalidade, base obrigatória, faixa do raio, limite de mudança, status) vive em funções `security definer` e CHECKs/gatilhos; a rota só valida o formato e mapeia o resultado para texto fixo.
2. **Nenhuma coordenada sai do banco.** As funções de leitura devolvem rótulo, raio em km e datas; nunca ponto, `match_*` ou `geocode_point_id` (o id é interno). A única coordenada que existe é a de `geocode_point` (#34) e ela continua sem SELECT para nenhum papel.
3. **Reuso.** Uma chamada permanente por base nova via `ensurePermanentPoint` (#34); `match_*` vêm do gatilho de #35; limite de taxa por `rl_check/rl_hit`; auditoria por `audit_append`; parâmetros em `ops.app_config`.
4. **Editar não é elegibilidade.** As funções gravam só nas tabelas novas e na auditoria. Não escrevem em `professional_profile` (apenas o travam com `for update`).

## 2. Contratos da API (`/v1/professional/profile/...`)
Segue o molde de `professional-profile-route.ts` (H-035): `Origin` igual a `SITE_URL` e `Sec-Fetch-Site` em escrita; `Content-Type: application/json`; sessão do profissional; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; teto de corpo de 8 KB; sem log do corpo. O perfil é **sempre** o da sessão: nenhuma rota recebe identificador de profissional (CA-11 por construção). Arquivo `[PROPOSTA]`: `apps/api/src/professional-offering-route.ts`, opção `professionalOffering` em `createApp`; validação pura em `packages/domain/src/professional/offering.ts`.

### 2.1 Serviços
- `GET /v1/professional/profile/services` → `200 { services: [{ serviceId, name, regulated, active, modalities: ["presencial"|"online", ...] }] }`. "Ambos" aparece como `modalities: ["presencial","online"]` (duas linhas no banco, uma entrada na API). Ordem por nome. Não traz grupo interno, `council_body`, nem dado de outro profissional.
- `PUT /v1/professional/profile/services` — **substitui o conjunto inteiro** (idempotente; cobre incluir, remover e trocar modalidade, CA-03). Corpo: `{ services: [{ serviceId: uuid, modalities: ["presencial"] | ["online"] | ["presencial","online"] }] }`; até `services_max` itens (padrão 30), sem `serviceId` repetido, `modalities` com 1 a 2 valores distintos; qualquer campo extra ⇒ `422 formato`. Lista vazia é válida (remove tudo).
  - `200 { status: "saved" | "unchanged", services: [...] }` (mesmo formato do GET). Conjunto igual ao atual ⇒ `unchanged`, sem auditoria.
  - `401` sem sessão; `403 { error: "sem_perfil" }` (conta não profissional); `403 { error: "perfil_suspenso" }` (CA-13, D-114); `413`, `415`, `400` como H-035.
  - `422 { error: "validation", code, field }` com `code` fixo e `field` = `services[i]` (índice do item, nunca valor): `formato`, `servico_indisponivel` (inexistente ou inativo ao incluir), `modalidade_incompativel` (PR→online, ON→presencial), `base_obrigatoria` (há presencial e não há base+raio, CA-04), `limite_servicos`.
  - `429 { error: "limite_escrita", retryAfterS }` com cabeçalho `Retry-After` (limite geral de escrita, §4.5).
  - Serviço regulamentado é aceito (D-115). Serviço já declarado que depois foi desativado no catálogo **continua aceito** se reenviado igual; só **inclusão nova** exige `active`.

### 2.2 Base e raio
- `GET /v1/professional/profile/area` → `200 { configured: false }` ou `200 { configured: true, addressLabel, radiusKm, since, changesRemaining, nextChangeAt | null }`. `addressLabel` é o texto completo digitado (D-113), entregue **só ao dono**. Sem coordenada, sem `geocode_point_id`, sem célula.
- `PUT /v1/professional/profile/area` — corpo `{ addressText?: string, radiusKm?: number }`, ao menos um campo. `addressText`: texto escolhido na sugestão (#33/H-020), 3 a 120 caracteres após `normalizeAddressQuery`. `radiusKm`: **inteiro JSON** de 5 a 100 (`"5"`, `5.5`, `4`, `101`, `0`, negativo ⇒ `422 raio_invalido`). Primeira definição exige os dois (`422 dados_incompletos`).
  - `200 { status: "definida" | "alterada" | "unchanged", area: {…igual ao GET…} }`. Mesmo endereço (comparação por `permanentAddressKey`) e mesmo raio ⇒ `unchanged`: **não geocodifica, não conta no limite, não audita**.
  - `403 perfil_suspenso`, `403 sem_perfil`; `401`; `413/415/400`.
  - `422`: `raio_invalido`, `endereco_invalido` (fora de 3..120 ou só controles), `endereco_nao_encontrado` (sem resultado, resultado fora do Brasil ou tipo grosseiro), `dados_incompletos`.
  - `429 limite_mudanca` com `retryAfterS` e `Retry-After` (CA-08, 3 por 24 h por padrão); `429 limite_tentativas` (tentativas de geocodificação ou teto de chamadas atingido).
  - `409 em_andamento` (reserva viva do mesmo endereço, 60 s).
  - `503 geocodificacao_indisponivel` (tempo esgotado, erro do serviço, limite do provedor, breaker fechado/`aguardando`, falha ao gravar o ponto). Texto único, sem detalhe técnico (CA-06, CA-12).
- Respostas de erro têm **somente** `error`, `code`, `field`, `retryAfterS`. Nunca eco do corpo, do texto, do raio nem de identificador.
- **Ordem de uso na tela** (UX, não regra do servidor): base e raio primeiro, serviços depois; `PUT services` com presencial recusa quando não há base (CA-04). Não há `DELETE` de base nesta Issue (L-3).

## 3. Dados: migração por expansão, reversível `[PROPOSTA]`
Arquivo: `supabase/migrations/20261112160000_profile_expand_services_area.sql` (número **livre** em 2026-11-12: o maior existente é `20261112150000`; o DEV reconfere antes de gravar e ajusta o prefixo mantendo ordem crescente). Desfazer: `supabase/rollbacks/20261112160000_profile_expand_services_area.down.sql`. Natureza: **só tabelas e funções novas**; nenhuma coluna existente é alterada, nenhum dado é preenchido (sem retroalimentação), nenhum código atual quebra. Idempotente (`if not exists`, `create or replace`, `drop ... if exists`). Mesma postura de RLS dos arquivos de identidade: RLS habilitada e forçada, sem políticas, `revoke all` de `public, anon, authenticated, service_role, app_api, app_system, app_backup_reader`; **nenhum DML e nenhum SELECT direto**; `grant execute` das funções só a `app_system`.

### 3.1 Tabelas
1. `app.professional_service` (decisão 109)
   - `professional_id uuid not null references app.professional_profile(user_id) on delete restrict`, `service_id uuid not null references app.service(id) on delete restrict`, `modality text not null check (modality in ('presencial','online'))`, `declared_at timestamptz not null`.
   - **PK `(professional_id, service_id, modality)`** (cumpre a condição de 97 §3.2 / T-D14). Índice `(service_id, modality)` (09 §6, consulta de #36/#37).
   - Gatilho `professional_service_regras_biu` (before insert, `security definer`, `search_path=''`): (a) o serviço existe e, **na inclusão**, está `active`; (b) compatibilidade: `service.modality='presencial'` só aceita `presencial`; `'online'` só `online`; `'ambos'` aceita os dois (CA-02) ⇒ `errcode 23514`, mensagem fixa `servico_modalidade_incompativel`/`servico_indisponivel`; (c) `modality='presencial'` exige linha em `professional_area` do mesmo profissional ⇒ `servico_presencial_sem_base` (dupla proteção de CA-04, vale para SQL direto do dono). Update de chave é proibido (gatilho `before update` recusa: troca de modalidade é delete + insert).
2. `app.professional_area` (vigente; contrato de 97 §3.2)
   - `professional_id uuid primary key references app.professional_profile(user_id) on delete restrict`
   - `geocode_point_id uuid not null references app.geocode_point(id) on delete restrict`
   - `base_label text not null check (char_length(base_label) between 3 and 120 and base_label !~ '[[:cntrl:]]')` (privado, D-113)
   - `radius_m integer not null check (radius_m between 5000 and 100000)` (CA-07 no banco; o inteiro-em-km é imposto pela função porque ela só recebe km, §4.2)
   - `valid_since timestamptz not null`, `updated_at timestamptz not null`.
   - Gatilho `professional_area_ponto_biu`: o ponto referenciado tem `subject_kind='professional_base'`, `subject_id = professional_id`, `state='ok'`, `geocode_mode='permanent'` e `match_cell is not null` (coordenada permanente e célula de #35) ⇒ senão `23514 area_ponto_invalido` (CA-05/CA-06: base sem ponto permanente não existe, nem por SQL direto). Gatilho `before delete`: recusa enquanto houver `professional_service` presencial do mesmo profissional (`area_em_uso`).
3. `app.professional_area_history` (decisão 110, "vigente desde")
   - `id uuid pk default gen_random_uuid()`, `professional_id uuid not null references app.professional_profile(user_id) on delete restrict`, `geocode_point_id uuid not null references app.geocode_point(id) on delete restrict`, `radius_m integer not null check (radius_m between 5000 and 100000)`, `valid_from timestamptz not null`, `valid_to timestamptz`, `change_kind text not null check (change_kind in ('definida','alterada'))`, `check (valid_to is null or valid_to > valid_from)`, `unique (professional_id, valid_from)`.
   - **Índice único parcial** `(professional_id) where valid_to is null`: no máximo uma linha aberta. Índice `(professional_id, valid_from desc)`.
   - Imutável: gatilho `before update or delete` só permite `valid_to` passar de nulo a valor (único campo mutável); qualquer outro update e todo delete ⇒ `23514 historico_imutavel`, exceto sob `set_config('app.offering_purge','1', true)` aberto só por `private.professional_offering_purge` (§3.3, retenção).
   - Invariante: a linha aberta é sempre igual à linha de `professional_area` (ponto, raio, `valid_from = valid_since`); só `private.professional_area_save` escreve as duas, na mesma transação.

### 3.2 Funções (todas `security definer`, `set search_path = ''`, texto de erro fixo, sem valor interpolado)
- `private.professional_offering_limits() returns jsonb` (interna): lê `ops.app_config` chave `profile.offering_limits` e **cada campo é revalidado** (inteiro dentro de faixa segura; ausente ou inválido ⇒ padrão), no molde de `auth_challenge_config`. Padrões `[PROPOSTA]`: `change_max=3`, `change_window_s=86400` (decisão 111), `geocode_max=10`, `geocode_window_s=86400`, `calls_cap=40`, `services_max=30`, `write_max=30`, `write_window_s=3600`. A migração semeia a chave com `on conflict do nothing` (visível e administrável; `version=1`).
- `private.professional_area_precheck(p_user uuid, p_rate_key text, p_will_geocode boolean, p_now timestamptz) returns table(out_status text, out_retry_after integer, out_calls_cap integer)`. Trava o perfil (`for update`), confere existência e status; `suspensa` ⇒ `suspenso`. Confere `write_max` e o limite de mudança (§4.3) **antes** de qualquer chamada paga ⇒ `limite_escrita`/`limite_mudanca`. Se `p_will_geocode`, aplica `rl_check`+`rl_hit` da chave HMAC `p_rate_key` com `geocode_max` ⇒ `limite_tentativas`; devolve `calls_cap`. Status: `ok|sem_perfil|suspenso|limite_escrita|limite_mudanca|limite_tentativas`.
- `private.professional_area_save(p_user uuid, p_point_id uuid, p_label text, p_radius_km integer, p_now timestamptz) returns table(out_status text, out_retry_after integer)`: seção crítica única (§4.2). Status: `definida|alterada|unchanged|sem_perfil|suspenso|limite_mudanca|dados_incompletos|ponto_invalido|raio_invalido`.
- `private.professional_services_save(p_user uuid, p_items jsonb, p_now timestamptz, p_rate_key text) returns table(out_status text, out_index integer, out_retry_after integer)`: status `saved|unchanged|sem_perfil|suspenso|formato|servico_indisponivel|modalidade_incompativel|base_obrigatoria|limite_servicos|limite_escrita`. `p_items` é `[{service_id, modality}]` já expandido pela API (um item por modalidade).
- Leitura do dono: `private.professional_services_list(p_user uuid)` (serviço, nome, `regulated`, `active`, modalidade) e `private.professional_area_get(p_user uuid, p_now timestamptz)` (rótulo, `radius_m/1000`, `valid_since`, `changes_remaining`, `next_change_at`). Nenhuma devolve ponto, `match_*`, `geocode_point_id` ou hash.
- `private.professional_area_at(p_professional_id uuid, p_at timestamptz) returns table(geocode_point_id uuid, radius_m integer)` — **contrato para #36/H-031** (decisão 110): `valid_from <= p_at and (valid_to is null or p_at < valid_to)`; vazio quando não havia base naquele instante. Só ids internos, usados por junção dentro do banco.
- `private.professional_offering_purge(p_user uuid)`: apaga serviços, histórico, área e as linhas `professional_base` de `geocode_point`/`geocode_budget` do profissional (ordem exigida pelos FKs `restrict`); só para o job de retenção/exclusão de conta e para a limpeza dos testes. Prazos de retenção: `[PENDENTE JURÍDICO]` (L-5).
- Todas com `grant execute` só a `app_system`; `revoke` explícito de `public, anon, authenticated, service_role, app_api`.

### 3.3 Desfazer (`...down.sql`)
Ordem: remover funções; remover gatilhos; remover `professional_area_history`, `professional_area`, `professional_service`; apagar a chave `profile.offering_limits` se `version=1`. **Guarda:** se alguma das três tabelas tiver linha, aborta com `rollback_recusado_com_dados` a menos que `set app.rollback_force = '1'` (perda de dado do usuário só de propósito, só em dev). Idempotente. Não toca `geocode_point`, `geo_*`, `professional_profile`, catálogo, auditoria nem `ops.*` (exceto a chave semeada).

## 4. Regras

### 4.1 Modalidade (CA-01..03, decisão 109)
Uma linha por (serviço, modalidade); "ambos" = duas linhas. Compatibilidade pela flag do catálogo: PR→só `presencial`, ON→só `online`, HI→qualquer. Troca de modalidade = remover a antiga + incluir a nova na mesma transação (o PUT substitui o conjunto). A função calcula a diferença (existentes × pedidos): linhas iguais não são tocadas (`declared_at` preservado); só as **novas** passam pelo teste de `active`. Regra de 105 (online vale sobre presencial) é de #36, não daqui: aqui as duas linhas coexistem.

### 4.2 Base e raio com histórico (CA-04..07, decisões 110, 112, 113)
`professional_area_save`, numa transação, com `for update` no perfil (serializa duas gravações do mesmo profissional):
1. Status `suspensa` ⇒ `suspenso`. Qualquer outro status segue (D-114). Não escreve em `professional_profile`.
2. `p_radius_km` nulo mantém o raio atual; não nulo precisa estar em 5..100 (`raio_invalido`); grava `radius_km*1000` (metros inteiros, decisão 112). `p_point_id`/`p_label` nulos mantêm o atual. Sem área atual, os três são obrigatórios (`dados_incompletos`).
3. Sem mudança efetiva (mesmo ponto e mesmo raio) ⇒ `unchanged`, nada gravado.
4. Se houver área atual, aplica o limite (§4.3); recusa com `limite_mudanca` e `out_retry_after`.
5. Fecha a linha aberta do histórico (`valid_to = p_now`), abre a nova (`valid_from = greatest(p_now, anterior.valid_from + 1 µs)`, `change_kind` = `definida` na primeira, `alterada` depois), faz upsert em `professional_area` (`valid_since = valid_from`, `updated_at`), chama `audit_append`. Tudo ou nada; qualquer erro desfaz.
6. `p_point_id` precisa pertencer ao profissional, ser permanente e ter `match_*` (gatilho da área; a função devolve `ponto_invalido` antes).
Mudar só o rótulo (mesmo ponto, texto diferente) não existe: o endereço vem sempre da sugestão e um texto diferente é um `address_hash` diferente ⇒ ponto novo (pode ser `reutilizar` sem custo).

### 4.3 Limite de mudança (CA-08, decisão 111)
Conta no **histórico**, sem tabela extra: linhas com `change_kind='alterada'` e `valid_from > p_now - change_window_s`. Se `contagem >= change_max` ⇒ recusa; `retry_after = (menor valid_from dentro da janela) + janela - p_now`, limitado a 1..86400. A **primeira definição não conta** (e não é limitada: o profissional precisa conseguir cadastrar). Alterar base e raio no mesmo pedido é **uma** mudança. Serviços ficam fora desse limite (só o limite geral, §4.5). Valores lidos de `profile.offering_limits` a cada chamada (CA-08: "valor vem de parâmetro"); `changes_remaining = max(0, change_max - contagem)`.

### 4.4 Status (CA-13, decisão 114)
`suspensa` recusa serviços e área (`perfil_suspenso`). `pendente`, `em_revisao`, `aprovada`, `retida_duplicidade`, `recusada` permitem edição, que **não altera** `verification_status`, `verified_at` nem nenhuma coluna do perfil e não cria objeto de elegibilidade. A guarda de quem vê pedidos é H-042/H-055. `[VERIFICADO]` nenhuma função de descoberta de #36 é chamada por este código.

### 4.5 Limite geral de escrita
Escrita de serviços e de área passa por `rl_check/rl_hit` com chave HMAC (`profile-write:`+userId, segredo do servidor), `write_max` (30) por `write_window_s` (1 h) `[PROPOSTA]`, só contado quando a operação é aceita para processamento (molde de H-015). Tentativas de geocodificação têm balde próprio (`geocode_max`, 10 por 24 h): cada base **nova** que chega a `geo_reserve` custa uma tentativa, mesmo se falhar; reaproveitar endereço já geocodificado ou `unchanged` não gasta chamada paga. O teto vitalício de chamadas por profissional (`calls_cap`, 40) é passado a `ensurePermanentPoint` como `callsCap` e fecha a lacuna deixada em 68 §2.1 (G-07).

### 4.6 Efeito sobre pedidos e participação (CA-09, decisão 110)
`professional_area_at(p, t)` devolve a base e o raio vigentes em `t`. Regra para #36 e H-031: o pedido é avaliado com `professional_area_at(profissional, publicado_em)`. Consequências: mudar base ou raio **não** muda a visibilidade de pedido já publicado para esse profissional; profissional que passou a ter base depois da publicação não vê aquele pedido (vale só para pedidos novos). Participação já existente não é tocada: estas funções não escrevem em nenhuma tabela de pedido ou participação (provado por teste estático, §7). **Serviços não têm histórico** (D-109/110 só falam de base e raio): ver L-2.

## 5. Fluxo de gravação da base (uma chamada permanente)
1. API: sessão, `Origin`, formato (`checkProfessionalAreaInput`: raio inteiro 5..100; texto por `permanentAddressKey`), perfil.
2. `GET` do estado atual (`professional_area_get`); se o endereço normalizado e o raio são iguais ao atual ⇒ `200 unchanged` (sem passos 3..5).
3. **`professional_area_precheck`** (suspenso, limite de escrita, limite de mudança, tentativas) — recusa **antes** de qualquer chamada paga.
4. Se o endereço mudou: `ensurePermanentPoint({ subject: userId, addressText })` com `callsCap=calls_cap`. Desfechos mapeados (§2.2): `ok`→passo 5; `endereco_nao_encontrado`→422; `indisponivel`, `aguardando_geocodificacao`→503; `em_andamento`→409; `teto`→429 `limite_tentativas`; `entrada_invalida`→422 `endereco_invalido`. Uma chamada por gravação nova (CA-05); nenhuma retentativa.
5. **`professional_area_save`** (revalida status e limite sob trava; é a fonte da verdade). Se recusar aqui (corrida), a chamada já paga fica registrada em `geocode_point` e será `reutilizar` na próxima tentativa, sem novo custo.
6. **Adaptador Pg de `GeoPointStorePort`** (novo, em `packages/db`, estruturalmente igual à porta): `storePermanent` que lançar (por exemplo `geo_ponto_fora_do_brasil`, `geo_precisao_invalida`) chama `geo_release(ref)` e relança um erro fixo `geo_store_falhou`; a rota o traduz em `503 geocodificacao_indisponivel`. Assim a reserva não fica presa por 60 s e nenhuma coordenada parcial é gravada (CA-06). `ensurePermanentPoint` já libera a reserva nos desfechos de falha do provedor.
7. Falha em qualquer passo antes do 5 deixa `professional_area` e o histórico intactos: a base anterior (ou a ausência de base) permanece.

## 6. Privacidade e auditoria (CA-10..12)
1. **Campos privados:** `base_label`, `geocode_point_id`, `radius_m`, histórico. Sem SELECT para nenhum papel; leitura só pelas funções de dono (`app_system`), chamadas com o `user_id` **da sessão**. O perfil público (H-043) e as respostas de outros papéis não consultam estas tabelas; o contrato é testado (§7). O rótulo generalizado (bairro/cidade/UF) é de H-032.
2. **Auditoria sem localização** (`audit_append`, `actor_ref='professional:<uuid>'`, `actor_role='professional'`, `object_type='professional_area'|'professional_services'`, `object_id=<user_id>`):
   - Área: `action='profile.area.changed'`; `before_state`/`after_state` com **só** `radius_m` (inteiro), `change_kind` (`definida|alterada`) e `base_changed` (boolean); sem rótulo, sem ponto, sem hash, sem célula.
   - Serviços: `action='profile.services.changed'`; estados com `total`, `presencial` e `online` (contagens). Sem `service_id`, sem nome.
   - Todas as chaves passam por `private.audit_keys_are_clean`; o teste varre as linhas gravadas contra o ponto e o texto semeados.
3. **Logs e erros:** os `raise exception` têm texto fixo (`area_ponto_invalido`, `historico_imutavel`, `servico_modalidade_incompativel`, `servico_indisponivel`, `servico_presencial_sem_base`, `area_em_uso`, `rollback_recusado_com_dados`); a API devolve só `error/code/field/retryAfterS`; nenhum log contém corpo, texto do endereço, raio junto de identificador, coordenada ou documento (allowlist de `packages/observability` inalterada). O adaptador Pg não imprime `error.message` do banco.
4. **Ordem de revelação:** nada de localização é calculado a partir de `exact_point` aqui; `match_*` só é consumido por #36/#37.

## 7. Testes que provam cada critério
Todos locais, sem rede, dados sintéticos (RF-163). Chamada ao Mapbox real: nenhuma (decisão 116); a porta é simulada com contador. Arquivos `[PROPOSTA]`:
- `packages/db/tests/profile-offering-migration.test.mjs` (estático, molde de `geo-geocode-point-migration.test.mjs`);
- `packages/db/tests/profile-offering.dbtest.mjs` (**Postgres real**, molde de `identity-professional-profile-document.dbtest.mjs`: cada teste em transação desfeita; o `after` abre **outra conexão** e confere contagem zero das linhas marcadas `h036-` em `professional_service`, `professional_area`, `professional_area_history`, `geocode_point`, `geocode_budget`, `app_user`, `professional_profile`; auditoria só em transação desfeita);
- `packages/domain/tests/professional-offering.test.ts` (validação pura);
- `apps/api/tests/professional-offering-route.test.ts` (rota com porta simulada, `geo-permanent-store-fake.ts` e provedor com contador de chamadas; sem rede);
- `packages/db/tests/professional-offering-pg.dbtest.mjs` (adaptador Pg de `GeoPointStorePort` + `ensurePermanentPoint` com **provedor simulado** contra Postgres real).

| # | Teste | Critério |
|---|---|---|
| T-P01 | Serviço ativo declarado como presencial, online e ambos: 1, 1 e 2 linhas; `professional_services_list` devolve só do dono (outro profissional não vê) | CA-01 |
| T-P02 | Compatibilidade: PR→online, ON→presencial, serviço inativo, inexistente ⇒ recusa com `code` fixo e **nada gravado** (contagem antes/depois); HI aceita as três formas; também recusado por INSERT direto (gatilho `23514`) | CA-02 |
| T-P03 | Remover serviço; trocar presencial→online; trocar para ambos acrescenta a outra linha; reenvio idêntico ⇒ `unchanged`, `declared_at` preservado, sem auditoria; serviço desativado reenviado igual continua aceito, inclusão nova não | CA-03 |
| T-P04 | Presencial sem área ⇒ `base_obrigatoria` (função) e `servico_presencial_sem_base` (INSERT direto); só online sem base aceito; remover área com presencial ⇒ `area_em_uso`; com base+raio aceito | CA-04 |
| T-P05 | Raio: 4999 m, 100001 m, 0, negativo, nulo em PUT inicial ⇒ recusa; **INSERT direto** de 4999 e 100001 em `professional_area` e `professional_area_history` ⇒ CHECK; 5000 e 100000 aceitos; API: `"5"`, `5.5`, `4`, `101` ⇒ `raio_invalido`; 5 e 100 aceitos; gravado em metros (`radius_m = km*1000`) | CA-07, D-112 |
| T-P06 | Porta simulada com contador: base nova ⇒ **1** chamada; `geocode_budget.calls=1` e `ops.external_quota` +1 no banco real; coordenada só em `geocode_point.exact_point` (não existe coluna de coordenada em `professional_area`/histórico: consulta ao catálogo); rótulo em `base_label`; nenhuma linha com `geocode_mode` temporário; mesmo endereço de novo ⇒ 0 chamadas (`reutilizar`) e `unchanged` | CA-05 |
| T-P07 | Falhas do provedor simulado: sem resultado, tempo esgotado, erro 5xx, 429, `provider_shape`, ponto fora do Brasil forçado no armazenamento, tipo grosseiro (mapeado como sem resultado), teto ⇒ área e histórico idênticos ao antes (inclusive "sem base"), nenhuma `exact_point` nova, reserva liberada (linha `reservado` ausente), mensagem fixa sem detalhe | CA-06 |
| T-P08 | `professional_area` apontando para ponto de outro profissional, `aguardando`, `sem_resultado` ou sem `match_cell` ⇒ `23514 area_ponto_invalido` (SQL direto) e `ponto_invalido` (função) | CA-05/06 |
| T-P09 | Limite: com padrão 3/24 h, três `alterada` ok e a 4ª ⇒ `limite_mudanca` com `retry_after` correto e **nada muda**; após 24 h (relógio por `p_now`) volta a aceitar; primeira definição não conta; base+raio no mesmo pedido = 1; `unchanged` não conta | CA-08 |
| T-P10 | Parâmetro: `profile.offering_limits.change_max=1` ⇒ a 2ª mudança recusa; chave ausente ⇒ padrão 3; valor inválido (string, 0, negativo, enorme) ⇒ padrão do campo; mudar o valor muda o comportamento sem deploy; o precheck recusa **antes** da chamada ao provedor (contador do provedor = 0) | CA-08, D-111 |
| T-P11 | Histórico: primeira ⇒ `definida` aberta; mudança fecha a anterior (`valid_to`) e abre nova; no máximo 1 aberta (índice parcial); sem sobreposição nem lacuna; linha aberta = `professional_area`; UPDATE/DELETE direto no histórico ⇒ `historico_imutavel`; `professional_area_at` devolve a base antiga em `t` anterior à mudança, a nova depois e vazio antes da primeira | CA-09, D-110 |
| T-P12 | **Estático (CA-09):** o corpo de cada função de escrita só referencia `professional_service`, `professional_area`, `professional_area_history`, `professional_profile` (apenas `for update`), catálogo (leitura), `geocode_point` (leitura), `ops.app_config/rate_counter` e `audit_append`: nenhuma tabela de pedido ou participação. Parte "pedido publicado e participação" com `service_request` ⇒ `[NÃO VERIFICADO]` até H-031 (#44); o teste vira caso real lá | CA-09 |
| T-P13 | Auditoria: uma linha por mudança efetiva (área e serviços), com ator, data, `action`, estados só com as chaves de §6; `audit_keys_are_clean`; varredura do JSON contra lat/lon semeados, texto do endereço, rótulo, hash e `service_id`: nenhum aparece; `unchanged` e recusas não auditam | CA-10 |
| T-P14 | Catálogo de privilégios: para `public`, `anon`, `authenticated`, `service_role`, `app_api`, `app_system` e `app_backup_reader`, `has_table_privilege(select/insert/update/delete)` falso nas três tabelas; `execute` só de `app_system`; RLS forçada; nenhuma view referencia as tabelas; nenhuma coluna `lat/lon/point/geom` fora de `geocode_point` | CA-11, T-03 |
| T-P15 | Contrato de rota: outro profissional, cliente, visitante (401) e conta sem perfil (403) nunca recebem área/raio/rótulo de terceiros (a rota não aceita id); varredura recursiva das respostas de GET/PUT (200 e erros) e do `GET /v1/professional/profile` (H-035, chaves inalteradas): nenhuma chave `lat/lon/coordinates/point/geom/cell/match/radius` fora do `GET area` do dono, e nenhum número igual às coordenadas semeadas | CA-11 |
| T-P16 | Log e erro: sink de log capturado durante todos os casos de rota e erros de banco forçados com texto-canário (endereço, raio, coordenada, documento): nenhum aparece em log nem em resposta; cada `raise` tem texto fixo (canário não aparece) | CA-12 |
| T-P17 | Status: `pendente`, `em_revisao`, `aprovada`, `retida_duplicidade`, `recusada` salvam serviços e área; `suspensa` ⇒ `perfil_suspenso` e nada grava; em todos, a linha de `professional_profile` fica **bit a bit igual** (inclusive `updated_at`) e `verification_status` não muda; nenhuma tabela de elegibilidade existe/é tocada. Parte "nenhum pedido aparece" de ponta a ponta ⇒ `[NÃO VERIFICADO]` até H-042/H-055 | CA-13, D-114 |
| T-P18 | Escrita geral: 31ª escrita na hora ⇒ `429 limite_escrita`; tentativas de geocodificação acima de `geocode_max` ⇒ `limite_tentativas` sem chamada ao provedor | §4.5 |
| T-P19 | Serialização: conexão A abre transação e executa `professional_area_save` (trava o perfil); conexão B tenta o mesmo com `lock_timeout` curto ⇒ falha por trava, sem gravar; A desfaz. Fixture de perfil **commitada** e removida no `after` (apaga `professional_profile`/`app_user` pelo dono; contagem zero conferida em outra conexão); nenhuma auditoria é commitada | §4.2 |
| T-P20 | Migração: aplica sobre banco já migrado (idempotência: 2 vezes), aplica `.down.sql` (vazio: tabelas e funções somem; `geocode_point`, `geo_*`, perfil, catálogo e auditoria intactos), reaplica; `.down.sql` com dados ⇒ `rollback_recusado_com_dados`, e com `app.rollback_force='1'` remove | reversibilidade |
| T-P21 | Estático: `search_path=''` em todas as funções; `grant execute` só a `app_system`; `.down.sql` existe e é idempotente; sem DML para papéis; número da migração maior que o último existente e sem duplicata | padrão do repo |

Evidência na Issue #49: comando exato, contagem de passou e falhou e código de saída de `corepack pnpm check:all` e `corepack pnpm db:test`; nenhum teste chama Mapbox; sem declarar CI verde.

## 8. Limitações e riscos

### Limitações registradas
- **L-1 (cold start por decisão 110).** Quem passa a ter base depois da publicação não vê pedidos já publicados; profissional novo só enxerga pedidos publicados após seu cadastro (janela de 7 dias). Consequência direta do "vale só para pedidos novos"; #36 deve implementá-la com `professional_area_at`.
- **L-2 (serviços sem histórico).** As decisões 109 a 116 dão "vigente desde" só à base e ao raio. Mudar a lista de serviços vale **imediatamente** para a descoberta de pedidos já publicados (#36 consulta a lista atual). Participação existente não muda (CA-09). Se o dono do produto quiser a regra "só para pedidos novos" também para serviços, é uma coluna `valid_from`/histórico extra em outra Issue.
- **L-3 (sem remover base).** Não há `DELETE` de base: sair do presencial é remover os serviços presenciais, e a base permanece privada até a exclusão da conta/retenção. Recomendação: história própria depois (direito de apagar dado de localização).
- **L-4 (editor concorrente).** `PUT services` substitui o conjunto: duas abas editando ao mesmo tempo ⇒ vale a última (sem `If-Match`). Aceitável no cadastro; a base/raio é serializada por trava.
- **L-5 (retenção).** Prazo de guarda do histórico de base e do ponto de bases antigas segue `[PENDENTE JURÍDICO]` (ADR-016). Os FKs `restrict` obrigam o job de exclusão a usar `professional_offering_purge`. Não existe hoje `geo_purge_subject` (68 §5 só o cita como mecanismo): esta Issue entrega o expurgo do assunto `professional_base`.
- **L-6 (catálogo muda depois).** Se o administrador trocar a flag de um serviço (por exemplo de HI para PR), declarações antigas incompatíveis não são podadas. #36 confia na declaração; um job de saneamento fica fora desta Issue.
- **L-7 (distância esférica ≈ geodésica ± 0,3 %)** herdada de 88 §5; não é tratada aqui.
- **L-8 (chamada real).** Mapbox real só após BLQ-EXEC (decisão 116). Forma exata da resposta v6 permanece `[NÃO VERIFICADO]` (68 §4); testes usam `provider_shape` simulado.
- **L-9 (precisão `localidade`).** A base aceita as precisões de #34 (endereço, rua, bairro, localidade). Base geocodificada só por localidade desloca o centro até alguns km; com raio mínimo de 5 km isso pesa. Mantido por coerência com #34; ver dúvida 2.

### Riscos
| # | Risco | Mitigação |
|---|---|---|
| R1 | Corrida entre abas/pedidos do mesmo profissional ultrapassa o limite de mudança | `for update` no perfil e contagem sob trava; precheck é só atalho econômico (T-P19) |
| R2 | Chamada paga gasta e gravação recusada por corrida | Ponto fica em `geocode_point` e vira `reutilizar`; tentativas e `calls_cap` limitam o gasto (T-P18) |
| R3 | `storePermanent` lança e prende a reserva por 60 s | Adaptador Pg libera a reserva no erro e relança erro fixo (T-P07) |
| R4 | Crescimento de `geocode_point` por muitos endereços diferentes | `geocode_max` 10/24 h e `calls_cap` 40 por profissional; expurgo no `purge` |
| R5 | #36 (já desenhada) compara com a base **atual** e não a vigente na publicação | Contrato `professional_area_at` e ajuste de 97 listados em §10; teste de #36 deve cobrir |
| R6 | Chave de auditoria proibida por regex (ex.: `nome`, `endereco`) | Chaves fixas de §6 e `audit_keys_are_clean` no teste (T-P13) |
| R7 | `app_config` sem a chave em ambiente novo | Semeada na migração; ausente/inválido ⇒ padrão por campo (T-P10) |
| R8 | Rollback apaga dado do usuário | Guarda `rollback_recusado_com_dados` (T-P20) |
| R9 | Adaptador Pg de `GeoPointStorePort` duplicado quando H-031 chegar | Ficar em `packages/db` com nome neutro (`geo-point-store.ts`); H-031 reutiliza |

## 9. Dúvidas não bloqueantes (para o líder consolidar; recomendação do Architect)
1. **Valores `[PROPOSTA]` de parâmetro** além da decisão 111: `geocode_max=10`/24 h, `calls_cap=40`, `services_max=30`, escrita geral 30/h. Recomendação: aceitar; ficam em `profile.offering_limits`, ajustáveis sem deploy.
2. **Bases só por localidade (L-9).** Recomendação: aceitar a precisão de #34 agora; se o dono quiser exigir `bairro` ou melhor para presencial, é um parâmetro no `professional_area_save` (precisão do ponto) e um teste, sem nova migração de dados.
3. **Primeira definição fora do limite de mudança** (recomendado) e a mudança de base+raio como uma só. Alternativa: contar tudo. Recomendação: manter.
4. **Histórico de serviços (L-2).** Recomendação: não incluir agora (decisões 109 a 116 não pedem); registrar como possível Issue futura.
5. **Ajuste de documentos (a cargo do Orquestrador):** 09 §3.3 (`professional_service` com PK `(professional_id, service_id, modality)`; `professional_area` com `geocode_point_id`, `base_label`, `valid_since`; nova `professional_area_history`); 97-DESENHO-H023 §3.2 (origem pela `professional_area_at(p, publicado_em)`); 14-BACKLOG H-036 (rastro do desenho).

## 10. Entrega ao DEV `[PROPOSTA]`
Ordem: (1) domínio `offering.ts` + testes puros (raio inteiro 5..100, `permanentAddressKey`, expansão de "ambos"); (2) migração + `.down.sql` + T-P01..T-P05, T-P08, T-P11, T-P13, T-P14, T-P20, T-P21; (3) limites e precheck (T-P09, T-P10, T-P17, T-P18, T-P19); (4) adaptador Pg da `GeoPointStorePort` + adaptador do perfil/serviços em `packages/db` + T-P06, T-P07; (5) rota, composição em `createApp` (opção `professionalOffering`, ausente ⇒ 404) + T-P15, T-P16. Arquivos esperados: a migração e o rollback acima, `packages/domain/src/professional/offering.ts`, `packages/db/src/geo-point-store.ts`, `packages/db/src/professional-offering.ts`, `apps/api/src/professional-offering-route.ts`, `apps/api/src/professional-offering-composicao.ts` e os cinco arquivos de teste. Não alterar `app.geocode_point`, as funções `geo_*` nem a rota do documento (H-035).

**Impacto em outras Issues:** #36 (H-023) passa a usar `professional_area_at` (R5) e já encontra `professional_service` com PK com `modality` e `professional_area(professional_id, geocode_point_id, radius_m)` como esperado em 97 §3.2; #37 (H-024) lê as bases e raios pelo mesmo contrato; H-031 (#44) registra `published_at` do pedido para a regra de §4.6 e reaproveita o adaptador Pg; H-042/H-055 continuam donos da elegibilidade.
