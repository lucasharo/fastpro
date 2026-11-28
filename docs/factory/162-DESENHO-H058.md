# Desenho H-058 — Aceitar trabalho idempotente (Issue #71)

EXEC-ID: EXEC-ARQ2-71-20261120 | Workflow: WF-03 | Etapa: Arquitetura | Branch: feature/init
Fontes: `158-REFINO-H058.md` (perguntas 850 a 869), `153-DESENHO-H055.md` (estrutura e padrões da #68), `08-ARQUITETURA.md` §7.2/§7.5/§7.6,
`09-MODELO-DADOS.md` §3.5/§3.7, `14-BACKLOG.md` (H-058, H-064, H-065), migrações lidas: `20261110130000_platform_create_outbox_jobs_idempotency.sql`,
`20261113010000_requests_create_service_request.sql`, `20261113250000_contact_create_phone_consent.sql`,
`20261113420000_eligibility_expand_professional_access_guard.sql`, `20261119100000_requests_expand_discovery_photo_flags.sql`.
Este documento é só desenho: nenhum código, migração, banco, quadro ou `11-DECISOES.md` foi alterado.

---

## 0. Fatos verificados no repositório (por Grep/Read, não por suposição)

| Item | Resultado |
|---|---|
| `private.request_acceptance_active(uuid, uuid)` | Existe como stub `select false` (`20261113250000`, linha 191), `stable security definer`, `search_path=''`, só `app_system` executa (linhas 554 e 565). Consumida 3 vezes nas funções de telefone (linhas 335, 442, 499). Será trocada por `create or replace`, mesma assinatura. |
| `private.professional_access_guard(uuid, text, timestamptz)` | Existe (`20261113420000`), modos `descoberta_aceite` e `participacao`, fail closed, nunca levanta exceção, só `app_system`. Basta chamá-la. |
| `private.discover_requests` (#68) | Existe (6 parâmetros, com `p_now`, guarda dentro). API da #68 já está em `apps/api/src/requests/discovery-*.ts` (rota, serviço, composição) e a migração `20261119100000` (fotos) existe. A #68 está em Code Review/QA. |
| `private.request_detail_professional` | Referenciada no desenho da #68 (A-1) como a função que aplica `status='publicado'`, prazo e a mesma regra de casamento serviço/raio sem expor coordenada. Reuso previsto aqui (§4.4). Assinatura exata: passo 0 da fatia 3. |
| `ops.idempotency_key` + `private.idempotency_begin/complete` | Existem (`20261110130000`). PK `(principal_id, operation, key)`, `key` de 8 a 128 caracteres, `response_body_ref text`. Resultados `nova`, `repetida`, `em_andamento`, `conflito`. Só `app_system`. |
| `ops.outbox_event` | Existe. **Constraint: `type ~ '^[a-z][a-z0-9_.]{0,99}$'` (minúsculas).** Logo `WorkAccepted` literal é inválido; ver decisão 867 abaixo. `aggregate_seq` único por agregado. |
| `private.identity_id_from_document_hmac(text)` | Existe (`20261113270000`), pura, derivação sha256 128 bits. |
| `private.rl_check` / `private.rl_hit` | Existem (`20261111170000`), usados pela #68 para rate limit. |
| `app.service_request` | Tem `customer_user_id`, `status` (`publicado/selecionado/concluido/cancelado`), `first_name`, `acceptance_deadline_at`, `acceptances_count`, `wave2_opened_at`, `version`. Trigger de imutabilidade deixa livres `status`, `version`, `acceptances_count`, `wave2_opened_at`. |
| **`app.acceptance`, `app.conversation`, `app.message`** | **NÃO EXISTEM em nenhuma migração** (Grep de `create table` nos três nomes: zero resultados). Nenhuma migração posta em `20261120*`. |
| Estrutura de rollback | Cada migração tem `supabase/rollbacks/<nome>.down.sql`. Manter o padrão. |

Consequência central: o aceite exige criar conversa e mensagem de sistema no **mesmo COMMIT** (I-03, F-01), mas as tabelas de chat não existem. O backlog diz que H-065 (#76) **depende de** H-058 (`H-065 | ... | H-058`) e H-066 (#77) depende de H-065. Portanto a H-058 é a dona do nascimento mínimo dessas tabelas (decisão A-1).

---

## 1. Resumo da arquitetura

Uma única rota `POST /v1/requests/:id/acceptances` na API, atrás da sessão do profissional. Toda a regra de negócio roda **dentro do banco**, em uma função `private.acceptance_create` (security definer, só `app_system`), sob `FOR UPDATE` do pedido. A API só: valida forma (sessão, perfil, chave, corpo vazio), aplica rate limit, abre **uma transação** que faz `idempotency_begin` → `acceptance_create` → `idempotency_complete` → `COMMIT`, e traduz o resultado em HTTP.

```
POST /v1/requests/:id/acceptances   (Idempotency-Key; corpo vazio)
 -> método/caminho -> Origin e Content-Type (padrão da publicação #44)
 -> sessão (401 sessao_necessaria) -> perfil profissional (403 perfil_profissional_obrigatorio)
 -> rate limit 20/min por profissional (429 muitas_requisicoes, Retry-After)
 -> Idempotency-Key UUID (400 chave_idempotencia_obrigatoria | chave_idempotencia_invalida)
 -> corpo: vazio ou {} (422 campos_extras_recusados; JSON inválido ou > 1 KiB: 400 corpo_invalido)
 -> t = relógio da API (UM instante, p_now)
 -> BEGIN; set local lock_timeout='3s'
      private.idempotency_begin('<userId>', 'request_acceptance', key, hash)
        repetida     -> ROLLBACK; reconstrói resposta por private.acceptance_read; 200
        em_andamento -> ROLLBACK; 409 operacao_em_andamento + Retry-After: 1
        conflito     -> ROLLBACK; 422 chave_reutilizada_com_corpo_diferente
        nova         -> private.acceptance_create(requestId, professionalId, t)
                          rejeição de negócio (sem escrita) -> ROLLBACK; 403/409 conforme §3.3
                          criado    -> idempotency_complete(201, 'acceptance:<id>'); COMMIT; 201
                          existente -> idempotency_complete(200, ...);               COMMIT; 200
      erro 55P03 (lock_timeout) -> ROLLBACK; 409 contencao_temporaria + Retry-After: 1
 -> toda resposta com Cache-Control: no-store, Referrer-Policy: no-referrer
```

Por que idempotência e criação na MESMA transação: se `idempotency_begin` e `complete` fossem transações separadas, uma queda entre o COMMIT do aceite e o `complete` deixaria a chave presa em `em_andamento` até o TTL (retries com a mesma chave receberiam 409 por até 24 h). Na mesma transação, ou tudo persiste (aceite + chave concluída) ou nada. A segunda barreira (unique de domínio e `existente`) cobre retry com chave nova.

---

## 2. Decisões (todas "adotada pelo líder", seguindo a recomendação do PO)

| Nº | Decisão | Status |
|---|---|---|
| 850 | Rota `POST /v1/requests/:id/acceptances` (opção a). | adotada pelo líder |
| 851 | `Idempotency-Key` obrigatória, UUID; ausente 400 `chave_idempotencia_obrigatoria`, inválida 400 `chave_idempotencia_invalida` (opção a). UUID de qualquer versão canônica é aceito pelo formato; o refino diz "v4": validar o formato 8-4-4-4-12 hexadecimal e versão 4 (variante RFC), como `isPublishIdempotencyKey` da #44, se for esse o padrão (passo 0 da fatia 1). | adotada pelo líder |
| 852 | Corpo estritamente vazio; qualquer propriedade: 422 `campos_extras_recusados`; nada é gravado (opção a). Absorve H-064 (#75). | adotada pelo líder |
| 853 | 201 com `{ acceptance: { id, requestId, slotNo, wave, status, acceptedAt }, conversation: { id, state }, customer: { firstName } }` (opção a). Ver ressalva de silêncio de vaga em §3.4. | adotada pelo líder |
| 854 | Replay da mesma chave: 200 com a mesma resposta (opção a). | adotada pelo líder |
| 855 | Chave nova com aceite `ativo` do mesmo profissional: 200 com o aceite existente, sem efeito novo (opção a). | adotada pelo líder |
| 856 | Aceite `retirado`/`removido_por_seguranca` do mesmo profissional: 409 `reaceite_proibido` (opção a). | adotada pelo líder |
| 857 | Mesma identidade (CPF/CNPJ) já com aceite no pedido: 409 `aceite_duplicado_identidade` (opção a). | adotada pelo líder |
| 858 | Dono do pedido: 403 `autoaceite_proibido` (opção a). | adotada pelo líder |
| 859 | Sem vaga: 409 `sem_vagas`, mensagem neutra, sem contadores (opção a). | adotada pelo líder |
| 860 | Pedido não `publicado` ou `p_now >= acceptance_deadline_at`: 409 `admissao_encerrada` (opção a). | adotada pelo líder |
| 861 | Revalidar serviço e raio no banco, sob a transação (opção a). Reuso da regra da #68 (A-4). | adotada pelo líder |
| 862 | Guarda negada: 403 `profissional_inelegivel` uniforme (opção a). | adotada pelo líder |
| 863 | Tabela `app.acceptance` (opção a). Conversa e mensagem também em `app` (A-1). | adotada pelo líder |
| 864 | Mensagem de sistema: `kind='sistema'`, `sender_user_id` nulo, `system_event='aceite'`, `params` só ids, `body_text` nulo; texto fixo "Estou disponível para trabalhar" resolvido na leitura pelo modelo versionado `template_version=1` (opção a). | adotada pelo líder |
| 865 | `private.request_acceptance_active` por `create or replace`: `exists(aceite com status='ativo')` (opção a). | adotada pelo líder |
| 866 | Resposta do aceite não traz telefone; revelação pela rota existente da #46, auditada em `app.contact_reveal_log` (opção a). Caminho exato da rota de telefone: passo 0 da fatia 6 (pasta `apps/api/src/contact`). | adotada pelo líder |
| 867 | Evento no outbox com payload `{ requestId, acceptanceId, professionalId, customerUserId, slotNo, acceptedAt }`, sem PII (opção a). **Ajuste técnico:** o `type` físico é `work_accepted` (minúsculas), porque a constraint de `ops.outbox_event.type` recusa maiúsculas; `WorkAccepted` permanece como nome lógico nos documentos. `aggregate_type='service_request'`, `aggregate_id=requestId`, `version=1`. | adotada pelo líder (com ajuste técnico A-6) |
| 868 | `lock_timeout='3s'`; 55P03 vira 409 `contencao_temporaria` com `Retry-After: 1` (opção a). | adotada pelo líder |
| 869 | 20 requisições por minuto por profissional; 429 `muitas_requisicoes` com `Retry-After` (opção a). | adotada pelo líder |

Decisões técnicas do Arquiteto (vetáveis pelo líder):
- **A-1 H-058 cria o nascimento mínimo das tabelas de chat.** `app.acceptance`, `app.conversation`, `app.message` (colunas e CHECKs de `09-MODELO-DADOS.md` §3.5 e §3.7; `conversation_member_state`, `chat_report`, `user_block` ficam para H-065/H-066/H-067). Motivo: I-03 e F-01 exigem COMMIT único e o backlog põe H-065 depois de H-058. Alternativa descartada: stub que devolve conversa nula (viola I-03 e deixaria a história sem prova de atomicidade). **Condição para a #76/#77 não duplicarem:** antes da fatia 2 o DEV refaz o Grep; se alguma migração `20261120*` ou posterior já criou essas tabelas, adaptar (usar `create table if not exists`/`alter`) e registrar na Issue.
- **A-2 Regras de negócio inteiras na função de banco.** A API não decide vaga, prazo, elegibilidade nem casamento; só traduz códigos. Evita corrida entre leitura e escrita e mantém uma fonte de verdade.
- **A-3 Rejeição de negócio devolve código sem escrever (não levanta exceção).** `acceptance_create` devolve `out_outcome`; só `criado`/`existente` escrevem. O adaptador faz ROLLBACK nas rejeições (a chave de idempotência não fica gravada em erro 4xx: reenviar reavalia o estado, comportamento aceito e documentado).
- **A-4 Casamento serviço/raio por reuso, sem nova regra.** Depois de `status` e prazo, a função chama `private.request_detail_professional(professional, request, p_now)`; zero linhas = `servico_ou_raio_incompativel`. Nenhuma fórmula de distância nova. Se o passo 0 mostrar que ela embute filtros que mudam o motivo, extrair o predicado em `private.request_matches_professional` por migração aditiva (reserva `20261120120000`).
- **A-5 Ordem de checagens do banco** (difere do fluxo do refino em um ponto): guarda de elegibilidade **antes** de travar o pedido, para o inelegível nunca aprender nada sobre o pedido nem ocupar o lock. Ordem final: (1) guarda `descoberta_aceite` → 403 `profissional_inelegivel`; (2) `FOR UPDATE` do pedido → 404 `pedido_nao_encontrado`; (3) status/prazo → 409 `admissao_encerrada`; (4) dono → 403 `autoaceite_proibido`; (5) casamento → 403 `servico_ou_raio_incompativel`; (6) aceite existente do mesmo profissional: `ativo` → `existente`, outro status → 409 `reaceite_proibido`; (7) mesma identidade → 409 `aceite_duplicado_identidade`; (8) capacidade → 409 `sem_vagas`; (9) escritas.
- **A-6 `type` do outbox em minúsculas** (`work_accepted`), ver decisão 867.
- **A-7 Hash de requisição inclui o pedido.** `request_hash = sha256('request_acceptance:v1:' || requestId || ':{}')`. Assim a mesma chave reutilizada para outro pedido é `conflito` (422), e como o corpo é sempre vazio não há outro modo de "corpo diferente".
- **A-8 Replay reconstrói a resposta do domínio**, não de corpo guardado: `response_body_ref = 'acceptance:<uuid>'` (nenhum primeiro nome ou PII na tabela de idempotência). `private.acceptance_read(acceptance_id, professional_id)` remonta o envelope. Campos fixos (`id`, `requestId`, `slotNo`, `wave`, `acceptedAt`, `conversation.id`) são idênticos; `status`/`conversation.state` refletem o estado atual (diferença só aparece após retirada, H-061) e `customer.firstName` só vem se o aceite continuar `ativo`, senão `null`. Registrar no contrato. Conferir o padrão equivalente em `publish-service.ts` (passo 0 da fatia 4).
- **A-9 Pedido inexistente, UUID malformado no caminho:** 404 `pedido_nao_encontrado` sem consultar o banco quando o id não é UUID.
- **A-10 Sem cabeçalho `Content-Type` com corpo vazio é aceito**; com corpo não vazio exige `application/json`.

---

## 3. Contrato da API

### 3.1 Requisição

`POST /v1/requests/:id/acceptances`
- Cookie `fastpro_session` (sessão do profissional). Origin validado como nas rotas mutáveis existentes.
- `Idempotency-Key: <uuid>` obrigatório.
- Corpo: ausente, vazio ou `{}`. Qualquer outra chave ou valor não objeto: 422 `campos_extras_recusados` (inclusive `{"price":1}`, `[]`, `null` com conteúdo; o validador é por lista vazia de chaves, nunca por lista de proibidas). Corpo maior que 1 KiB ou JSON malformado: 400 `corpo_invalido` (usar `corpo-limitado.ts`).
- Nenhuma query string aceita (qualquer parâmetro: 400 `parametro_invalido`, padrão da #68).

### 3.2 Resposta de sucesso

201 na primeira criação; 200 em replay e em aceite já existente.
```json
{
  "acceptance": { "id": "uuid", "requestId": "uuid", "slotNo": 3, "wave": 1, "status": "ativo", "acceptedAt": "2026-11-20T12:00:00.000Z" },
  "conversation": { "id": "uuid", "state": "ativa" },
  "customer": { "firstName": "Carlos" }
}
```
Cabeçalhos em **toda** resposta (também 4xx/5xx): `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json; charset=utf-8`.

Silêncio de vaga (RF-066, RF-071, AMB-04 A): o refino lista `slotNo` e `wave` no 201 para o próprio aceite (CA-H058-05). Isso é o dado do **próprio** aceite do chamador e não revela contadores de terceiros nem vagas restantes; mantido. A resposta **nunca** traz `acceptances_count`, vagas restantes ou `wave2_opened_at`. **Divergência a registrar:** CA-H058-05 diz "acceptances_count atualizado para 3" na resposta; este desenho **não** devolve contador (contradiz o silêncio de RN-H058-05); o teste verifica o contador por consulta ao banco, não pela resposta.

### 3.3 Erros (código HTTP, `code`, quando)

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `chave_idempotencia_obrigatoria` / `chave_idempotencia_invalida` | cabeçalho ausente ou fora do formato UUID |
| 400 | `corpo_invalido` / `parametro_invalido` | JSON malformado, grande demais; query presente |
| 401 | `sessao_necessaria` | sem sessão válida |
| 403 | `perfil_profissional_obrigatorio` | usuário sem perfil profissional |
| 403 | `profissional_inelegivel` | guarda `descoberta_aceite` falsa (verificação, e-mail, conta, acesso comercial), sem motivo |
| 403 | `autoaceite_proibido` | dono do pedido |
| 403 | `servico_ou_raio_incompativel` | serviço não atendido, fora do raio, sem base para presencial |
| 404 | `pedido_nao_encontrado` | id inexistente ou malformado |
| 409 | `admissao_encerrada` | status diferente de `publicado` ou `p_now >= acceptance_deadline_at` |
| 409 | `sem_vagas` | capacidade 4 (sem 2ª onda) ou 8 atingida; mensagem neutra "O pedido não está mais disponível para novos atendimentos" |
| 409 | `reaceite_proibido` | aceite anterior `retirado` ou `removido_por_seguranca` |
| 409 | `aceite_duplicado_identidade` | outro perfil do mesmo CPF/CNPJ já tem aceite no pedido |
| 409 | `operacao_em_andamento` (+ `Retry-After: 1`) | mesma chave ainda em execução |
| 409 | `contencao_temporaria` (+ `Retry-After: 1`) | 55P03 no lock |
| 422 | `campos_extras_recusados` | corpo não vazio |
| 422 | `chave_reutilizada_com_corpo_diferente` | mesma chave com outro pedido (A-7) |
| 429 | `muitas_requisicoes` (+ `Retry-After`) | 20/min por profissional |
| 503 | `servico_indisponivel` | provedor/banco indisponível; antes de qualquer escrita |

Corpo de erro: `{ "code": "<codigo>" }` apenas (mais `message` neutra apenas para `sem_vagas` e `admissao_encerrada`); nunca vaza contadores, onda, motivo financeiro ou documental.

### 3.4 Ordem das checagens na API

método/caminho → Origin/Content-Type → sessão (401) → perfil (403) → rate limit (429) → chave (400) → corpo (422/400) → transação do §1. O rate limit vem antes da chave e do corpo para que enxurrada de requisições malformadas também seja limitada (mesmo critério de A-3 da #68). A chave de rate limit é o HMAC do id do profissional, prefixo `accept:`, via `private.rl_check`/`rl_hit` (sem migração).

---

## 4. Banco de dados

Migrações reservadas (faixa 20261120100000 a 20261120199999), cada uma com `.down.sql` em `supabase/rollbacks/`, aplicadas com `npx supabase` (nunca MCP, sem Docker):

| Arquivo | Conteúdo |
|---|---|
| `20261120100000_distribution_create_acceptance_and_chat_base.sql` | tabelas `app.acceptance`, `app.conversation`, `app.message`, constraints, índices, triggers, RLS forçada, privilégios (§4.1 a §4.3) |
| `20261120110000_distribution_create_acceptance_functions.sql` | `private.acceptance_create`, `private.acceptance_read`, `create or replace private.request_acceptance_active` (§4.4 a §4.6) |
| `20261120120000_...` (condicional) | `private.request_matches_professional` só se A-4 exigir; senão não existe |

Padrão de cada migração: bloco de pré-requisitos com `to_regprocedure`/`to_regclass` levantando exceção se faltar `private.professional_access_guard`, `private.identity_id_from_document_hmac`, `ops.outbox_event`, `app.service_request`; idempotente (`if not exists`/`create or replace`); `revoke all ... from public, anon, authenticated, service_role, app_api, app_backup_reader` e `grant ... to app_system` (mesmo padrão das funções da #46/#55); tabelas com `enable` + `force row level security`.

### 4.1 `app.acceptance`
Colunas: `id uuid pk default gen_random_uuid()`, `request_id uuid not null references app.service_request(id) on delete restrict`, `professional_id uuid not null references <perfil profissional> (id) on delete restrict` (chave exata: passo 0 da fatia 2, conferir se `professional_id` é o id do perfil ou do usuário e manter o mesmo que a #68/#55 usam), `identity_id uuid not null`, `slot_no smallint not null check (slot_no between 1 and 8)`, `wave smallint generated always as (((slot_no - 1) / 4) + 1) stored`, `status text not null default 'ativo' check (status in ('ativo','retirado','removido_por_seguranca'))`, `accepted_at timestamptz not null`, `withdrawn_at timestamptz`, `removed_reason text`, `created_at timestamptz not null default now()`.
Checks: `(status = 'retirado') = (withdrawn_at is not null)`.
Únicos: `(request_id, professional_id)` (vale após retirada, SD-18), `(request_id, identity_id)`, `(request_id, slot_no)`. Índice `(professional_id, status)` para consultas futuras.
Sem coluna de texto, valor, prazo ou anexo (I-26; teste T-H058-24 compara a lista de colunas).
Triggers (defesa em profundidade; a função já valida):
- `BEFORE INSERT`: `slot_no = acceptances_count + 1` do pedido; `slot_no > 4` exige `wave2_opened_at is not null`; pedido `publicado` e `now() < acceptance_deadline_at` (usa o `accepted_at` recebido, não `now()`, para respeitar P4 e o relógio injetado: comparar com `new.accepted_at`); profissional diferente do dono.
- `BEFORE UPDATE`: `request_id`, `professional_id`, `identity_id`, `slot_no`, `accepted_at` imutáveis; `status` só `ativo → retirado|removido_por_seguranca` (a retirada em si é H-061).
- `BEFORE DELETE`: sempre nega (a vaga nunca é liberada).

### 4.2 `app.conversation`
`id`, `request_id` fk, `customer_user_id` fk (copiado do pedido; imutável), `professional_id`, `acceptance_id uuid not null unique references app.acceptance(id)`, `state text not null default 'ativa' check (state in ('ativa','somente_leitura'))`, `security_restricted_at`, `restricted_reason`, `created_at`. Único `(request_id, professional_id)`. Trigger de imutabilidade de `request_id`, `customer_user_id`, `professional_id`, `acceptance_id`; `DELETE` negado. A transição de estado (recálculo) é H-065/H-061; aqui só nasce `ativa`.

### 4.3 `app.message`
Colunas conforme §3.7: `id`, `conversation_id` fk, `kind` (`humana|sistema`), `sender_user_id`, `client_message_id`, `system_event` (`aceite|aceite_retirado`), `params jsonb not null default '{}'`, `template_version smallint`, `dedupe_key text`, `body_text`, `created_at`, `state` (`enviada|restrita`).
CHECKs: `kind='sistema' ⇒ sender_user_id is null and system_event is not null and body_text is null`; `kind='humana' ⇒ sender_user_id is not null`. `params` com `jsonb_typeof = 'object'` e tamanho limitado.
Únicos: `(conversation_id, dedupe_key) where kind='sistema'`; `(conversation_id, sender_user_id, client_message_id) where kind='humana'` (já nascem; o envio humano é #77).
Triggers: `UPDATE` e `DELETE` negados para todos os papéis, inclusive sistema (RF-103); `INSERT kind='humana'` negado nesta história (só a #77 abrirá); `INSERT kind='sistema'` só com conversa existente. Sem privilégio direto de tabela para `app_api` (escrita só pela função interna).
O texto "Estou disponível para trabalhar" **não** é gravado (`body_text` nulo); fica como constante de modelo versionado (`template_version=1`) na camada de leitura (domínio TypeScript, `packages/domain`), com teste de snapshot do texto.

### 4.4 `private.acceptance_create(p_request_id uuid, p_professional_id uuid, p_now timestamptz)`
`security definer`, `set search_path = ''`, `set lock_timeout = '3s'`, `language plpgsql`, só `app_system`.
Retorno: `table (out_outcome text, out_acceptance_id uuid, out_request_id uuid, out_slot_no smallint, out_wave smallint, out_status text, out_accepted_at timestamptz, out_conversation_id uuid, out_conversation_state text, out_first_name text)`.
`out_outcome ∈ criado | existente | profissional_inelegivel | pedido_nao_encontrado | admissao_encerrada | autoaceite_proibido | servico_ou_raio_incompativel | reaceite_proibido | aceite_duplicado_identidade | sem_vagas`.
Argumentos nulos: `raise exception ... using errcode='22023'` (decisão 643 da #55; é bug de chamador, não rejeição de negócio).
Passos, na ordem de A-5:
1. `private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now)` falso → `profissional_inelegivel`.
2. `select ... from app.service_request where id = p_request_id for update` (lock por agregado, ADR-003). Nenhuma linha → `pedido_nao_encontrado`.
3. `status <> 'publicado' or p_now >= acceptance_deadline_at` → `admissao_encerrada`.
4. Dono: usuário do profissional = `customer_user_id` → `autoaceite_proibido`.
5. Casamento (A-4). Zero linhas → `servico_ou_raio_incompativel`.
6. Aceite do par: `ativo` → devolve `existente` (monta saída com conversa e `first_name`; sem escrita); `retirado`/`removido_por_seguranca` → `reaceite_proibido`.
7. `identity_id := private.identity_id_from_document_hmac(document_hmac do perfil, lido com for share)`; já existe `(request_id, identity_id)` de outro profissional → `aceite_duplicado_identidade`.
8. `v_cap := case when wave2_opened_at is null then 4 else 8 end`; `acceptances_count >= v_cap` → `sem_vagas`.
9. Escritas na mesma transação: `insert app.acceptance` (`slot_no = acceptances_count + 1`, `accepted_at = p_now`); `update app.service_request set acceptances_count = acceptances_count + 1, version = version + 1`; `insert app.conversation (state 'ativa')`; `insert app.message` (sistema, `system_event 'aceite'`, `params {acceptance_id, slot_no}`, `template_version 1`, `dedupe_key 'acceptance:<id>:accepted'`); `insert ops.outbox_event` (`type 'work_accepted'`, `aggregate_seq = coalesce(max,0)+1` para `(service_request, request_id)`, calculado sob o lock do pedido, mesmo mecanismo/helper que os outros emissores usarem; passo 0 da fatia 3: Grep de `aggregate_seq` para reaproveitar o helper existente em vez de reescrever). Devolve `criado`.
Exceção de unique/check em qualquer escrita aborta tudo (ROLLBACK da transação chamadora). `unique_violation` residual de `(request_id, identity_id)` ou `(request_id, slot_no)` (impossível sob o lock, mas possível se alguém escrever fora da função) vira erro 500 genérico `erro_interno`, nunca 9º aceite.

### 4.5 `private.acceptance_read(p_acceptance_id uuid, p_professional_id uuid)`
Mesma forma de retorno de sucesso; devolve zero linhas se o aceite não pertence ao profissional (anti-enumeração: o replay nunca devolve aceite de outro). `first_name` só se `status='ativo'`.

### 4.6 `private.request_acceptance_active` (decisão 865)
```
create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.acceptance a
                  where a.request_id = p_request_id and a.professional_id = p_professional_id and a.status = 'ativo')
$$;
```
Mesma assinatura e privilégios (`revoke all` e `grant ... to app_system` repetidos). Entrada nula devolve `false` (`exists` sobre comparação com nulo é falso). Isto torna funcionais as funções de telefone da #46: ver risco R-09.

---

## 5. Concorrência e idempotência

Três camadas (RN-H058-02):
1. **Borda:** `ops.idempotency_key` `(principal_id=<userId>, 'request_acceptance', key)`, na mesma transação do aceite. Dupla requisição simultânea com a mesma chave: o segundo `insert ... on conflict` espera o primeiro terminar (índice único); após o COMMIT vê `concluida` (`repetida`, 200); se estourar 3 s, `contencao_temporaria`.
2. **Domínio:** unique `(request_id, professional_id)`; chave nova do mesmo profissional ativo devolve `existente` (200).
3. **Mensagem:** `dedupe_key` única por conversa.

Serialização: `FOR UPDATE` no pedido (um lock por pedido, não global). Ordem de lock fixa: chave de idempotência → pedido → (perfil `for share` só leitura). Uma transação só tem uma chave de idempotência, logo não há ciclo. Contagem de vagas, `slot_no` e escritas ocorrem sob o lock; nunca 9 aceites mesmo com N concorrentes (unique `(request_id, slot_no)` e `check 1..8` são a barreira física). Ordem de chegada = ordem de aquisição do lock (AMB-19 A). Pedidos distintos não se bloqueiam.

Retry de rede após COMMIT com a mesma chave: 200 pela chave; com chave nova: 200 pelo domínio. Queda antes do COMMIT: nada persiste (inclusive a chave), o retry cria.

Atomicidade (F-01, F-10): tudo na função + `idempotency_complete` na mesma transação; qualquer erro (inclusive injetado no `insert app.message` ou no `insert ops.outbox_event`) ⇒ ROLLBACK total.

---

## 6. Segurança e privacidade

- Só `app_system` executa as funções; `anon`, `authenticated`, `service_role`, `app_api`, `app_backup_reader` não executam nem tocam as tabelas (teste de privilégios, padrão T-H055-34).
- Silêncio e uniformidade: `profissional_inelegivel` único (sem motivo financeiro/documental); `sem_vagas` e `admissao_encerrada` sem contadores; erro 404 para id inexistente ou malformado.
- Primeiro nome só após aceite `ativo` (na resposta e em `acceptance_read`); sobrenome, e-mail, telefone, endereço e coordenada nunca saem. Telefone só pela rota auditada da #46 (`contact_reveal_log`).
- Outbox sem PII (ids e instantes; sem nome, e-mail, telefone). Logs sem corpo, sem cookie, sem chave de idempotência completa (observabilidade existente, #20).
- CSRF/Origin como nas rotas mutáveis existentes; cookie de sessão; `Cache-Control: no-store`.
- Abuso (R-26): rate limit 20/min; unique por identidade; sem reaceite; a vaga permanece consumida após retirada (regra da H-061); telefone depende de opt-in.
- Mensagens de sistema só pela função interna; trigger recusa insert humano nesta história; `UPDATE/DELETE` negados.
- Sem aviso "não é contrato" no contrato da API nem no botão (decisão 22); teste procura essa expressão nos textos de resposta e no template (T-H058-33).
- Sem Docker, sem Mapbox, sem e-mail real (o evento só entra no outbox; envio é #105), sem backup.

---

## 7. Matriz de testes (T-H058-*)

Local: `corepack pnpm check:all`, `db:test`. Dados sintéticos com prefixo `h058-` no DEV, limpeza ao fim (autorização permanente do dono para dados sintéticos no DEV).

| Id | Nível | Cenário | Esperado | CA / CT |
|---|---|---|---|---|
| T-H058-01 | rota | sem cookie / cookie expirado | 401 `sessao_necessaria`, nenhuma escrita | CA-01 / CT-01 |
| T-H058-02 | rota | usuário sem perfil profissional | 403 `perfil_profissional_obrigatorio` | CA-02 / CT-02 |
| T-H058-03 | rota | corpos `{price}`, `{deadline_days}`, `{message}`, `{attachment}`, `[]` | 422 `campos_extras_recusados`; contagem de `app.acceptance` inalterada | CA-03 / CT-03 |
| T-H058-04 | rota | sem chave; chave `chave-invalida-123` | 400 obrigatoria / 400 invalida | CA-04 / CT-04, CT-05 |
| T-H058-05 | rota | JSON malformado; corpo > 1 KiB; query presente | 400 `corpo_invalido` / `parametro_invalido` | A-9 |
| T-H058-06 | rota | id do pedido malformado | 404 `pedido_nao_encontrado` sem tocar o banco | A-9 |
| T-H058-07 | rota+db | 1º aceite | 201, `slotNo 1`, `wave 1`, `status ativo`, conversa `ativa`, `firstName`; banco: contador 1, versão +1 | CA-05 / CT-06 |
| T-H058-08 | rota+db | replay 5x mesma chave | 5 respostas 200 com campos fixos idênticos; 1 aceite, 1 conversa, 1 mensagem, 1 evento | CA-06 / CT-07 |
| T-H058-09 | db | chave nova, aceite já ativo | `existente` (200), sem linhas novas | CT-08 / 855 |
| T-H058-10 | rota | mesma chave para outro pedido | 422 `chave_reutilizada_com_corpo_diferente` | CT-09 |
| T-H058-11 | rota | mesma chave simultânea (2 conexões) | uma cria, a outra 200 repetida ou 409 `operacao_em_andamento`; sempre 1 aceite | A-7 |
| T-H058-12 | db | 4 aceites sem 2ª onda, 5º elegível | 409 `sem_vagas`, sem número no corpo | CA-07 / CT-10 |
| T-H058-13 | db | 4 aceites com `wave2_opened_at`; 5º | criado, `slotNo 5`, `wave 2` | CT-11 |
| T-H058-14 | db | 8 aceites; 9º | 409 `sem_vagas` | CA-08 / CT-12 |
| T-H058-15 | db | `p_now = deadline` e `deadline - 1 s` | 409 `admissao_encerrada` / criado (aberto à direita) | CA-09 / CT-13 |
| T-H058-16 | db | status `selecionado`, `cancelado`, `concluido` | 409 `admissao_encerrada` | CA-10 / CT-14, CT-15 |
| T-H058-17 | db | verificação pendente, recusada, em revisão, retida, suspensa | 403 `profissional_inelegivel` (corpo idêntico entre os casos) | CA-11 / CT-16, CT-17 |
| T-H058-18 | db | e-mail não verificado; conta não ativa | 403 `profissional_inelegivel` | CT-18 |
| T-H058-19 | db | trial expirado; assinatura vencida além de 72 h; dentro da carência | 403 / 403 / criado | CA-12 / CT-19 |
| T-H058-20 | db | auto-aceite (dono do pedido; fixture direta, ver R-10) | 403 `autoaceite_proibido` | CA-13 / CT-20 |
| T-H058-21 | db | presencial a 40 km com raio 15 km; serviço não atendido; sem base | 403 `servico_ou_raio_incompativel` | CA-14 / CT-21, CT-22 |
| T-H058-22 | db | dois perfis com mesmo `document_hmac`; segundo tenta | 409 `aceite_duplicado_identidade`; 1 vaga consumida | CA-15 / CT-23 |
| T-H058-23 | db | aceite `retirado` (fixture); mesmo profissional tenta | 409 `reaceite_proibido`; contador inalterado | CA-16 / CT-24 |
| T-H058-24 | db | colunas de `app.acceptance`/`app.message`/`app.conversation` | nenhuma coluna de preço, prazo, texto livre ou anexo no aceite (I-26, T-16, T-17) | RN-01 |
| T-H058-25 | db | falha injetada no `insert app.message` (trigger de teste que levanta) | rollback total: sem aceite, conversa, evento, chave; contador igual (F-01) | CA-17 / CT-25 |
| T-H058-26 | db | falha injetada no outbox | idem (F-10) | CA-17 |
| T-H058-27 | db | mensagem criada | `kind sistema`, remetente nulo, `system_event aceite`, `body_text` nulo, `dedupe_key` exata; `UPDATE` e `DELETE` negados; texto renderizado = "Estou disponível para trabalhar" | CA-18 / CT-26 |
| T-H058-28 | rota | 201 | `customer.firstName` presente; sem e-mail, telefone, sobrenome, endereço, contador, onda do pedido | CA-19 / CT-27 |
| T-H058-29 | db | `request_acceptance_active` antes/depois; outro profissional; entrada nula | `false` / `true` / `false` / `false`; telefone com opt-in liberado e auditado pela rota da #46 | CA-20 / CT-28 |
| T-H058-30 | db | 10 conexões disputam a última vaga (7 de 8 na 2ª onda), 10 elegíveis distintos | exatamente 1 criado, 9 `sem_vagas`, contador 8 (C-01, C-02, FA-035) | CA-21 / CT-29 |
| T-H058-31 | db | 10 conexões, vaga livre para todos até o teto de 4 sem 2ª onda (4 vagas livres, 10 disputantes) | exatamente 4, nunca mais; `slot_no` 1..4 sem lacuna (C-03, C-16) | RN-04 |
| T-H058-32 | db | evento no outbox | `type work_accepted`, `aggregate_id=request_id`, payload sem PII, seq correto; `acceptance_create` 2x concorrente não duplica seq | CA-22 / CT-30 |
| T-H058-33 | rota/domínio | varredura de textos de resposta e template | sem "não é contrato"/"apenas conecta" | CT-31 / RN-17 |
| T-H058-34 | rota | 21ª requisição em 1 min | 429 `muitas_requisicoes` com `Retry-After`; inelegível e elegível respondem corpos iguais | 869 |
| T-H058-35 | db | 55P03 (lock mantido por outra sessão por mais de 3 s) | 409 `contencao_temporaria` + `Retry-After: 1`; nada gravado | 868 / R2 |
| T-H058-36 | db | privilégios | `anon`, `authenticated`, `service_role`, `app_api` não executam as funções nem leem as tabelas | segurança |
| T-H058-37 | db | trigger de `app.acceptance`: insert direto fora da função com `slot_no` errado, 9º, sem 2ª onda, dono, pedido fechado | recusado pelo banco | defesa em profundidade |
| T-H058-38 | db | regressão #46: testes existentes que assumiam `request_acceptance_active = false` | atualizados para o novo contrato; telefone ainda recusado sem aceite e sem opt-in | R-09 |
| T-H058-39 | db | replay após retirada (fixture): mesma chave | 200; `status retirado`; `firstName` nulo | A-8 |

---

## 8. Plano de implementação em fatias

Cada fatia termina com testes locais verdes e commit em `feature/init`; sem Docker, sem Mapbox, sem e-mail real, sem backup. Migrações aplicadas com `npx supabase` no DEV (autorizado), com `.down.sql`.

| Fatia | Conteúdo | Arquivos | Migração | Testes |
|---|---|---|---|---|
| 1. Domínio | tipos do envelope, códigos de erro e mapa outcome→HTTP, validação pura do corpo vazio, formato da chave, constante `ACCEPTANCE_SYSTEM_MESSAGE_V1` e capacidades (4/8), `request_hash` | `packages/domain/src/acceptance/*` (+ testes) | não | T-H058-03, 04, 05, 06 (parte pura), 33 |
| 2. Tabelas | `app.acceptance`, `app.conversation`, `app.message`, constraints, triggers, RLS, privilégios, rollback. Passo 0: Grep confirmando que nenhuma tabela de chat existe nem foi criada pela #76/#77; confirmar a chave de `professional_id` | `supabase/migrations/20261120100000_*.sql`, `supabase/rollbacks/*.down.sql`, testes `db:test` | sim (100000) | T-H058-24, 36, 37, parte de 27 |
| 3. Funções de banco | `acceptance_create`, `acceptance_read`, `request_acceptance_active` real; helper do outbox reaproveitado; passo 0: assinatura de `request_detail_professional` e decisão sobre `request_matches_professional` (A-4) | `supabase/migrations/20261120110000_*.sql` (+ `.down.sql`; o down restaura o stub `select false`) | sim (110000; 120000 condicional) | T-H058-07 a 09, 12 a 23, 25 a 27, 29, 30 a 32, 35, 38, 39 |
| 4. Adaptador db | `packages/db/src/acceptance.ts`: transação única (`set local lock_timeout`, `idempotency_begin`, `acceptance_create`, `idempotency_complete`, ROLLBACK nas rejeições, mapa de erros, 55P03); rate limit `accept:` via `rl_check/rl_hit`. Passo 0: conferir em `publish-service.ts` o padrão de replay (A-8) | `packages/db/src/acceptance.ts`, `acceptance-rate-limit.ts` (+ testes) | não | T-H058-08, 10, 11, 34, 35 |
| 5. Serviço e rota | `acceptance-service.ts` (um `at`, ordem do §3.4), `acceptance-route.ts`, `acceptance-composicao.ts`, registro em `app.ts` (opção `requestAcceptance`) e `index.ts`; cabeçalhos em todas as respostas | `apps/api/src/requests/acceptance-*.ts`, `app.ts`, `index.ts` (+ testes) | não | T-H058-01 a 11, 28, 34 |
| 6. Integração, privacidade e fecho | integração no DEV com dados sintéticos `h058-`, concorrência real (conexões paralelas), conferência da rota de telefone da #46 (passo 0: caminho exato), documentação do contrato no refino, `check:all` completo, snapshot das chaves do envelope, limpeza | testes `apps/api` e `packages/db` | não | T-H058-28 a 33, 38, suíte completa |

Ordem: 1 → 2 → 3 → 4 → 5 → 6 (2 e 1 independentes; 3 depende de 2; 4 de 3; 5 de 1 e 4). Definição de pronto: `corepack pnpm check:all` com código de saída 0, contagem de testes registrada na Issue, evidência da corrida (T-H058-30/31), sem credencial em log, resumo em linguagem simples na Issue.

---

## 9. Dependências e condições para o Desenvolvimento fechar

| Dependência | Estado | Papel nesta história | Condição |
|---|---|---|---|
| #55 (H-042) guarda | Concluída, aplicada no DEV | `professional_access_guard` | cumprida |
| #44, #45, #46, #48, #49, #57, #58, #5/#17/#18 (outbox/idempotência) | Concluídas | tabelas e funções reaproveitadas | cumprida |
| **#68 (H-055) descoberta** | Em Code Review/QA | a rota de aceite sucede a descoberta; compartilha `apps/api/src/app.ts`, `index.ts` e `request_detail_professional`/`discover_requests` | **Condição para o Dev fechar (Aguardando aprovação): #68 aprovada em Code Review e QA e integrada em `feature/init`.** As fatias 1 a 4 não tocam arquivos da #68 e podem começar antes; a fatia 5 (edita `app.ts`/`index.ts`) e a 6 só depois, para evitar conflito. Conforme refino §9. |
| **#76 (H-065) conversa e #77 (H-066) mensagens** | Backlog | donos da evolução do chat (estado `somente_leitura`, membros, envio humano, leitura) | **Nenhuma é pré-requisito para a H-058 fechar**, pois A-1 faz a H-058 criar o mínimo. **Condição:** na fatia 2, Grep prova que #76/#77 não criaram as tabelas; se criaram, a H-058 adota as definições existentes. Quando a #76/#77 começar, **estende** (`alter`/`create table if not exists`), nunca recria. Registrar isso na Issue #76. |
| #75 (H-064) corpo sem campos | Backlog | regra absorvida aqui (422) | a #75 vira verificação de regressão; o líder move/encerra no quadro (fora deste desenho) |
| #136 (H-068) texto da mensagem automática; #105 (H-095) e-mail; #72 (H-059), #73 (H-061), #74 (H-062), #84 (H-074) | Backlog | consumidores | nada a fazer aqui; usam `acceptance`, `conversation`, evento `work_accepted` |

---

## 10. Riscos

| Id | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Contenção em pedido muito disputado | filas de conexão | lock por pedido, `lock_timeout 3s`, 409 `contencao_temporaria` com `Retry-After`; transação curta (sem chamada externa dentro) |
| R-02 | Corrida pelo 9º aceite | quebra I-01 | lock + `slot_no = count+1` + unique `(request_id, slot_no)` + `check 1..8` + trigger; T-H058-30/31/37 |
| R-03 | Falha parcial deixa aceite sem conversa/mensagem | I-03 | tudo em uma transação; testes F-01/F-10 com falha injetada |
| R-04 | Chave de idempotência presa em `em_andamento` | retries 409 por até 24 h | begin e complete na mesma transação (§1); sem estado intermediário gravado |
| R-05 | `type` do outbox em maiúsculas viola constraint | falha em runtime | `work_accepted` (A-6, decisão 867 ajustada); teste T-H058-32 |
| R-06 | Duplicar regra de casamento (divergir da descoberta) | aceita fora do raio ou recusa quem viu o pedido | reuso de `request_detail_professional` (A-4); teste de paridade: todo item que a descoberta lista é aceitável e vice-versa (parte de T-H058-21) |
| R-07 | Enumeração de pedidos por UUID (404 vs 403 `servico_ou_raio_incompativel`) | confirma existência de um id para profissional elegível | UUID v4 não adivinhável; guarda antes do lock (inelegível não aprende nada); rate limit 20/min; risco residual baixo e aceito; sem pergunta ao dono |
| R-08 | Canal de tempo: inelegível responde mais rápido | enumeração de estado | corpos e cabeçalhos idênticos; risco residual baixo, aceito (igual à #68) |
| R-09 | Trocar o stub de `request_acceptance_active` altera o comportamento da #46 (telefone passa a ser liberável) | testes da #46 que esperavam `false` quebram; regressão de privacidade se o opt-in não for respeitado | T-H058-29 e 38; a função de telefone mantém as demais condições (opt-in, pedido aberto para contato, auditoria); rodar a suíte inteira da #46 na fatia 3 |
| R-10 | Exclusividade de papéis (`20261112200000_identity_create_role_exclusivity`) pode impedir fixture de dono que também é profissional | CT-20 inviável por fluxo normal | testar `autoaceite_proibido` por fixture direta no banco; manter a checagem como defesa em profundidade |
| R-11 | Conflito de arquivos com a #68 (`app.ts`, `index.ts`) | merge difícil | condição do §9 (fatias 5 e 6 só depois da #68 integrada) |
| R-12 | Divergência de contrato: CA-H058-05 pede contador na resposta | viola silêncio de vagas | decisão: não devolver contador (§3.2); líder confirma ao registrar |
| R-13 | Tabelas de chat nascem mínimas e a #76/#77 divergem | retrabalho | A-1 + Grep antes da fatia 2; extensão aditiva |
| R-14 | Teste de concorrência real no DEV compartilhado deixa resíduo | poluição do banco | prefixo `h058-`, limpeza comprovada ao final; sem tocar dados reais |
| R-15 | Aceite predatório para colher primeiro nome (R-26) | privacidade do cliente | teto de vagas, unique por identidade e profissional, sem reaceite, rate limit; telefone só com opt-in e auditoria |
| R-16 | `idempotency_begin` não é `security definer` e só `app_system` executa | falha de permissão | o adaptador roda com a conexão do papel de sistema, igual à publicação #44; confirmar no passo 0 da fatia 4 |

---

## 11. Dúvidas que exigem o dono

Nenhuma. Todas as perguntas 850 a 869 foram adotadas pelo líder com a recomendação do PO. Nada envolve dinheiro, jurídico (o aviso "não é contrato" fica nos Termos, fora desta história), perda irreversível de dados ou conta do dono.

Pontos para o líder confirmar ao registrar (vetáveis, não bloqueiam): A-1 (H-058 cria o mínimo das tabelas de chat), A-5 (guarda antes do lock), A-6 (tipo do evento em minúsculas), R-12 (sem contador na resposta).

---

## 12. Entrega ao Orquestrador (HANDOFF)

- Próxima etapa: Desenvolvimento (WF-03), fatias 1 a 4 liberadas; fatias 5 e 6 após a #68 integrada (condição do §9). Branch `feature/init`.
- Migrações reservadas: `20261120100000`, `20261120110000`, e condicional `20261120120000`.
- Registro em `11-DECISOES.md` pelo líder: 850 a 869 como "adotada pelo líder" (867 com o ajuste técnico A-6); A-1 a A-10 como decisões técnicas do Arquiteto.
- Nenhuma alteração de quadro, `11-DECISOES.md`, banco, migração ou código nesta etapa.
