# Desenho de arquitetura H-038 — Certificações para atividades regulamentadas (Issue #51)

EXEC-ID: EXEC-ARQ2-51-20261119 | Workflow: WF-03 | Etapa: Arquitetura (tentativa 2) | Branch: feature/init
Entrada: `140-REFINO-H038-REEXAME.md` (PO). Saída: este desenho. Sem código, sem migração, sem banco.
Fontes lidas nesta tentativa: 140 (§1.2, 3, 5.4, 6, 7, 8, 10, 11), `20261112220000_identity_create_documents.sql`, `20261112235000_identity_fix_documents_audit_object.sql`, `20261113200000_verification_create_case_queue.sql` (linhas 283-306).

## 1. Decisões (D-H038-xx)

Todas as recomendações do PO às perguntas 300 a 319 foram **adotadas pelo líder** (nenhuma enviada ao usuário). O registro em `11-DECISOES.md` é feito pelo Orquestrador (este desenho não o altera).

| Pergunta | Decisão adotada | Status |
|---|---|---|
| 300 | Análise estritamente documental e humana na esteira da #52; sem checagem externa nem OCR. | adotada pelo líder |
| 301 | Catálogo é a fonte da verdade (`app.service.regulated`); sem lista REG inventada no seed; testes usam fixtures sintéticas. | adotada pelo líder |
| 302 | Uma certificação por par `(professional_id, service_id)`; `service_id` obrigatório para `kind='certificacao'`. | adotada pelo líder |
| 303 | Sem `valid_until` nem expiração automática; vigência é julgamento humano da Verificação. | adotada pelo líder |
| 304 | Exigida como condição para concluir a aprovação (gate VRF05 da #52). | adotada pelo líder |
| 305 | Serviço REG adicionado após aprovação: aprovação geral mantida; o serviço novo fica bloqueado para pedidos/aceites até a certificação ser recebida e analisada (guarda implementada em H-055 / #68; aqui só se expõe a função de consulta, ver §3.3). | adotada pelo líder |
| 306 | Recusa (`certificacao_insuficiente`) não exclui conta; profissional reenvia pelo canal regular. | adotada pelo líder |
| 307 | Cota própria: 1 certificação viva por serviço REG; não consome a cota de 5 documentos de identidade; teto global de bytes compartilhado. | adotada pelo líder |
| 308 | Reúso do pipeline #50: imagem até 5 MiB (saída JPEG ≤1280 px e ≤750 KB), PDF até 2 MiB (mesmo SHA-256). | adotada pelo líder |
| 309 | Fato consumado: #52 concluída antes; #51 entrega `private.certificacoes_completas(uuid)`. | adotada pelo líder |
| 310 | 100% em `app.identity_document` e buckets `identity-incoming`/`identity-docs`; **sem `media_asset`**. | adotada pelo líder |
| 311 | Profissional vê só metadados/status; nunca baixa o binário. Só a Verificação lê (auditado em `sensitive_access_log`, #52). | adotada pelo líder |
| 312 | Nenhuma menção a certificação em perfil público ou busca (decisões 592/658 da #56). | adotada pelo líder |
| 313 | Texto neutro aprovado para DEV: "Esta atividade exige certificação. Envie o documento para continuar." | adotada pelo líder |
| 314 | Mesmas travas de #50: `IDENTITY_DOCS_ENABLED=1` e parecer L1 (só relevante em produção, fora do escopo atual). | adotada pelo líder |
| 315 | Segue para Desenvolvimento após esta Arquitetura (#50 e #52 concluídas). | adotada pelo líder |
| 316 | Auditar só transições (`received`, `replaced`, `deleted`); recusas sintáticas (400/413/415/422) respondem HTTP sem auditoria. | adotada pelo líder |
| 317 | Mesma mecânica de retenção/expurgo (`purge_requested_at`, `idoc_sweep`, `idoc_purge_done`) de #50. | adotada pelo líder |
| 318 | Edição da flag REG é de H-107; #51 só lê `s.regulated`. | adotada pelo líder |
| 319 | #51 fornece `private.certificacoes_completas(uuid) returns boolean`; o gate já existe na #52. | adotada pelo líder |

Decisões de arquitetura adicionais (propostas por este desenho, adotadas pelo líder por não envolverem dinheiro, jurídico ou credencial):

- **D-H038-A1 — Evolução aditiva, funções novas ao lado das de #50.** Não alterar a assinatura de `private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint)` (já em produção em DEV e coberta por testes). Criar `private.idoc_issue_cert(...)` com `p_service_id` e reaproveitar o restante do pipeline. As funções de #50 que precisam entender `kind` (`idoc_limite`, `idoc_list`, `idoc_confirm_done`, `idoc_delete`) são ajustadas por `create or replace` mantendo assinatura.
- **D-H038-A2 — Substituição ocorre na finalização.** `idoc_confirm_done` para `kind='certificacao'`, antes de marcar o novo como `recebido`, marca o `recebido` anterior do mesmo `(professional_id, service_id)` como `substituido` na mesma transação (evita violar o índice único parcial).
- **D-H038-A3 — Função do gate não depende da aprovação global.** `certificacoes_completas` olha só serviços REG vinculados em `app.professional_service` e certificações `recebido`; nada de efeito colateral (stable, só leitura).
- **D-H038-A4 — Consulta por serviço para H-055.** Além da função exigida pela #52, criar `private.certificacao_servico_ok(p_professional uuid, p_service uuid) returns boolean` (mesma regra, um serviço) para a guarda de #68 consumir sem reimplementar. Não é exigida por nenhum CA de #51; é uma função auxiliar mínima (se o líder preferir, fica para #68).

## 2. Modelo de dados (reuso de `app.identity_document`, sem `media_asset`)

Mudanças **aditivas** na tabela existente (colunas atuais: `id, professional_id, client_upload_id, kind, declared_type, declared_bytes, status, stored_type, stored_bytes, content_sha256, pending_expires_at, lease_until, attempts, received_at, analyzed_at, purge_requested_at, created_at`):

1. `kind`: o CHECK atual é inline (`check (kind in ('identidade'))`, nome gerado `identity_document_kind_check`). Remover essa constraint e recriar como `identity_document_kind_ck check (kind in ('identidade','certificacao'))`. O DEV confirma o nome real da constraint em `pg_constraint` antes do `drop` (usar `drop constraint if exists` com o nome verificado).
2. Nova coluna `service_id uuid references app.service (id) on delete restrict` (nula para identidade).
3. `identity_document_service_kind_ck`: `(kind='identidade' and service_id is null) or (kind='certificacao' and service_id is not null)`. Criar com `not valid` seguido de `validate constraint` (linhas existentes são todas `identidade`, então valida).
4. Índice único parcial `identity_document_cert_viva_key` em `(professional_id, service_id) where kind='certificacao' and status='recebido' and purge_requested_at is null`. (O PO propôs sem `purge_requested_at`; incluí-lo mantém coerência com os demais índices "vivos" da #50 e não bloqueia reenvio após marcação para expurgo. O gate, por outro lado, ignora linhas com `purge_requested_at` preenchido, ver §3.1.)
5. Índice de apoio `identity_document_cert_servico_idx` em `(professional_id, service_id) where kind='certificacao' and purge_requested_at is null`.
6. Sem novos buckets, sem nova tabela, sem coluna de validade, sem `media_asset_id`. RLS/FORCE RLS e `revoke all` já valem (escrita só via função).
7. Gatilho `identity_document_limite` / `private.idoc_limite()`: passar a contar **apenas `kind='identidade'`** no limite de 5 (CA-H038-06) e aplicar o teto global de bytes somando os dois tipos (se o teto global hoje for contado nessa função; o DEV confirma lendo `idoc_limite`, linhas 77-98 da migração 20261112220000).
8. Catálogo de eventos de auditoria: adicionar `identity.cert.received`, `identity.cert.replaced`, `identity.cert.deleted` na mesma tabela/registro onde estão `identity.doc.received/refused/deleted` (migração 20261112220000, linhas ~565-569), com a mesma lista de campos permitidos (`file_kind`, `size_bytes`, `reason_code`) e **sem** nome de arquivo, caminho ou IP. Identificador do serviço vai em `object_id`/metadado permitido já existente se houver; se o catálogo exigir campo novo, acrescentar `service_id` (UUID, não é PII) à lista permitida.

Ciclo de vida do estado (reaproveita `status in ('pendente_envio','recebido','substituido')`): `pendente_envio -> recebido -> substituido`. Exclusão pelo profissional só com `analyzed_at is null`; após análise, 409.

## 3. Funções SQL (todas `security definer`, `set search_path = ''`, `grant execute` só a `app_system`; `revoke` de `public`, `anon`, `authenticated`)

### 3.1 `private.certificacoes_completas(p_professional uuid) returns boolean` (contrato da #52, §11.2 do 140)
- `language sql stable security definer set search_path = ''`.
- Corpo lógico: `not exists (select 1 from app.professional_service ps join app.service s on s.id = ps.service_id where ps.professional_id = p_professional and s.regulated and not exists (select 1 from app.identity_document d where d.professional_id = p_professional and d.service_id = s.id and d.kind = 'certificacao' and d.status = 'recebido' and d.purge_requested_at is null))`.
- Retorna `true` sem serviços REG; `false` se algum serviço REG vinculado não tiver certificação `recebido`. A função **nunca retorna null** (a #52 trata null como `false` via `coalesce`, mas o contrato exige boolean).
- Observação sobre ativo: `app.professional_service` hoje não tem coluna de "ativo" no gate da #52 (`verification_reg_gate` usa só o vínculo); manter a mesma definição de vínculo para consistência.

### 3.2 `private.idoc_issue_cert(p_user uuid, p_client_upload_id uuid, p_service_id uuid, p_declared_type text, p_declared_bytes integer, p_now timestamptz, p_total_cap bigint) returns <mesmo tipo de retorno de idoc_issue>`
- Valida: serviço existe, `regulated = true`, vinculado ao profissional (`app.professional_service`). Qualquer falha devolve a mesma resposta uniforme (rota responde 422), sem distinguir "não existe" de "não regulamentado" de "não vinculado" (evita enumeração de catálogo).
- Idempotência por `(professional_id, client_upload_id)` igual à #50 (índice `identity_document_cliente_vivo_key`).
- Cota: não aplica o limite de 5 de identidade; aplica limite de 1 `pendente_envio` vivo por `(professional_id, service_id)` (evita enxurrada de reservas) e o teto global de bytes.
- Insere com `kind='certificacao'`, `service_id` preenchido, mesmas validações de `declared_type`/`declared_bytes` da #50. Auditoria apenas em transições de estado (D 316).

### 3.3 `private.certificacao_servico_ok(p_professional uuid, p_service uuid) returns boolean` (ver D-H038-A4)
Mesma regra de 3.1 para um serviço; `true` se o serviço não for REG ou se houver certificação `recebido`.

### 3.4 Ajustes por `create or replace` (assinatura inalterada)
- `private.idoc_list(uuid, timestamptz)`: passa a devolver também `kind` e `service_id`; ordenação estável; nunca devolve `stored_*`, `content_sha256`, caminhos.
- `private.idoc_confirm_done(...)`: se `kind='certificacao'`, marca anterior `recebido` do mesmo serviço como `substituido` (D-H038-A2) e grava evento `identity.cert.replaced` quando houver substituição, `identity.cert.received` sempre.
- `private.idoc_confirm_refuse(...)`/`idoc_confirm_release(...)`: sem mudança de lógica; os eventos de recusa de certificação (conteúdo inválido) usam `identity.doc.refused` já existente (reason_code distingue), ou o equivalente `cert` se o catálogo do item 8 de §2 for criado.
- `private.idoc_delete(...)`: para certificação, mesma regra (`analyzed_at is null` -> exclui; senão 409 uniforme); evento `identity.cert.deleted`.
- `private.idoc_limite()` (trigger): conta só `kind='identidade'` para o limite de 5.
- `idoc_sweep`/`idoc_purge_done`/`idoc_known_pending`: sem alteração (já operam por `id`/`purge_requested_at`, independentes de `kind`). O teste T-13 comprova.

## 4. Contratos de API (módulo `apps/api/src/identity-docs/`, reutilizado)

Todas sob `IDENTITY_DOCS_ENABLED=1`; sem a flag, 404 uniforme sem tocar banco ou Storage. Autenticação do profissional como na #50. Corpo de erro uniforme (sem detalhe do motivo interno).

| Rota | Mudança | Respostas |
|---|---|---|
| `POST /v1/professional/documents/uploads` | Corpo ganha `kind` (`'identidade'` padrão, `'certificacao'`) e `service_id` (uuid, obrigatório e somente quando `kind='certificacao'`). Resposta de sucesso igual à da #50 (id, URL assinada de envio de curta duração para `identity-incoming`, expiração). | 201 ok; 400 corpo inválido; 401/403 sem sessão profissional; 404 flag desligada; 422 serviço inexistente/não REG/não vinculado ou combinação `kind`/`service_id` incoerente; 429 limite; 413/415 por tamanho/tipo declarado |
| `POST /v1/professional/documents/{id}/confirm` | Sem mudança de contrato; finalização aplica o mesmo pipeline (magic bytes, reencode JPEG ≤1280 px/≤750 KB, PDF ≤2 MiB com mesmo SHA-256) e a regra de substituição. | 200 recebido; 404 id alheio/inexistente/malformado (uniforme); 413/415/422 pipeline |
| `GET /v1/professional/documents` | Itens ganham `kind`, `service_id`, `status`, `received_at`, `analyzed` (booleano derivado). Nunca `stored_*`, hash, caminho, URL. | 200 |
| `DELETE /v1/professional/documents/{id}` | Sem mudança de contrato; vale para certificação. | 204; 409 se analisado; 404 uniforme |

Não existe nem será criada rota de download ao profissional (CA-H038-08). A leitura pela Verificação continua exclusivamente nas rotas admin da #52, com `sensitive_access_log`. Nenhuma alteração em rotas de perfil público/busca (CA-H038-09). Os schemas de validação ficam em `packages/domain/src/identity-docs/` (esquema Zod/equivalente já usado pela #50: `kind` enum e refinamento `kind=certificacao => service_id`). Constante de texto neutro (pergunta 313) em arquivo de mensagens do domínio; varredura de vocábulos proibidos ("garante", "certificado de qualidade", "seguro", "aprovado pelo conselho").

## 5. Segurança

1. **Autorização por dono:** todas as funções recebem `p_user` da sessão validada pela API; busca por `professional_id = p_user`; id de outro profissional equivale a inexistente (404 uniforme). Sem IDOR.
2. **Privilégios:** funções novas e alteradas só `grant execute ... to app_system`; `revoke` explícito de `public`, `anon`, `authenticated`, `service_role`. Tabela segue com `force row level security` e `revoke all`.
3. **`search_path` vazio** e nomes totalmente qualificados em todas as funções; sem SQL dinâmico novo (o `execute` do gate da #52 já usa `to_regprocedure`).
4. **Sem enumeração:** 422 único para serviço inexistente/não REG/não vinculado; 404 único para id alheio.
5. **Conteúdo do arquivo:** mesmo pipeline da #50 (magic bytes, reencode, rejeição de GIF/SVG/executável, PDF com verificação de integridade); nome do objeto no Storage é UUID v4; buckets privados.
6. **PII/LGPD:** nenhum nome original, EXIF, IP em claro ou caminho em logs/auditoria; certificação é dado pessoal sensível de trabalho: retenção/expurgo igual ao de #50 (`purge_requested_at`). Titular (LGPD) mantém os fluxos já existentes.
7. **Neutralidade:** o upload não altera `verification_status` nem o caso da fila (CA-H038-12); a decisão humana segue sendo da Verificação (RN-H038-07; RF-078: a plataforma só conecta partes).
8. **Concorrência:** índice único parcial barra duas certificações vivas simultâneas; `idoc_confirm_done` faz o `update ... substituido` e a transição para `recebido` na mesma transação com `for update` na linha do serviço do profissional (ou advisory lock por `(professional_id, service_id)`) para evitar corrida entre duas finalizações do mesmo serviço.
9. **Produção fechada** pelas travas existentes (D 314); nada de produção é feito (escopo só DEV).

## 6. Matriz de testes (T-*)

Dados sintéticos marcados; execução local; evidência = comando, contagem e código de saída.

| ID | Camada | Cenário | CA |
|---|---|---|---|
| T-01 | db:test | `kind='identidade'` com `service_id` falha CHECK; `certificacao` sem `service_id` falha CHECK; `certificacao` com `service_id` válido passa; FK rejeita serviço inexistente | CA-01 |
| T-02 | db:test | `idoc_issue_cert` recusa serviço não REG, não vinculado, inexistente (mesma resposta uniforme) e aceita REG vinculado | CA-02 |
| T-03 | db:test | `certificacoes_completas`: sem REG = true; 1 REG sem cert = false; 2 REG com 1 cert = false; 2 REG com 2 certs = true; cert `pendente_envio`/`substituido` não conta; cert com `purge_requested_at` não conta; nunca retorna null | CA-03 |
| T-04 | db:test (integração) | `private.verification_case_decide(..., 'aprovada')` com certificações incompletas levanta `certificacao_pendente` (VRF05); completas aprova e move caso e perfil | CA-04 |
| T-05 | db:test | Segundo `recebido` para o mesmo serviço viola o índice único; finalização sequencial deixa 1 `substituido` + 1 `recebido`; duas finalizações concorrentes deixam exatamente 1 `recebido` | CA-05 |
| T-06 | db:test | Profissional com 5 identidades vivas consegue reservar e finalizar certificação; limite de identidade não conta certificação; teto global de bytes continua valendo | CA-06 |
| T-07 | rota HTTP + domínio | Fixtures sintéticas de #50 aplicadas a `kind=certificacao`: JPEG/PNG/WebP reencodados (≤1280 px, ≤750 KB), PDF íntegro com mesmo SHA-256 e ≤2 MiB; GIF/SVG/exe = 415; acima do limite = 413 | CA-07 |
| T-08 | rota HTTP/estático | Varredura de rotas: nenhuma entrega binário/URL ao profissional; `GET /documents` não traz campos internos | CA-08 |
| T-09 | contrato HTTP | `GET /v1/public/professionals/:slug` e listagem de busca sem campos/menção de certificação | CA-09 |
| T-10 | db:test | Eventos `identity.cert.*` sem nome de arquivo, IP ou caminho; recusas sintáticas não geram evento | CA-10 |
| T-11 | rota HTTP | DELETE não analisado = 204; analisado = 409; id alheio/malformado = 404 | CA-11, CA-13 |
| T-12 | db:test | Upload/finalização/exclusão de certificação não altera `verification_status` nem o caso da fila | CA-12 |
| T-13 | db:test | `idoc_sweep`/`idoc_purge_done`/`idoc_known_pending` tratam certificação igual à identidade | D 317 |
| T-14 | rota HTTP | Flag desligada = 404 uniforme sem consultar banco/Storage (espionar cliente) | CA-14 |
| T-15 | domínio | Varredura textual das constantes de mensagem: texto neutro presente, vocábulos proibidos ausentes | CA-15 |
| T-16 | db:test | Privilégios: `anon`/`authenticated` sem execute em todas as funções novas; `search_path` vazio em `prosecdef` | segurança |
| T-17 | db:test | Regressão de #50: todas as suítes de identidade e de #52 continuam verdes após o `create or replace` | regressão |
| T-18 | check:all | `corepack pnpm check:all` e `db:test` com saída 0, sem serviço externo (sem e-mail real, Mapbox, Docker) | CA-16 |

## 7. Plano de migração

- **Prefixo alocado:** `20261113440000` (livre; último existente é `20261113430000_requests_expand_customer_panel.sql`). Nome: `20261113440000_identity_expand_certifications.sql` com seu `.down.sql` (convenção do repositório; o DEV confere o padrão de nome dos `.down.sql` vizinhos). Se o DEV precisar separar funções do gate dos ajustes de tabela, usar `20261113441000_...` na sequência; checar `ls` antes de criar, pois outras issues paralelas podem reservar prefixos.
- **Ordem na migração (idempotente, transação única):** (1) drop/recriação da constraint de `kind`; (2) `add column if not exists service_id`; (3) constraint de coerência (`not valid` + `validate`); (4) índices; (5) `create or replace` de `idoc_limite`, `idoc_list`, `idoc_confirm_done`, `idoc_delete`; (6) `create function` de `idoc_issue_cert`, `certificacoes_completas`, `certificacao_servico_ok`; (7) `grant/revoke`; (8) eventos de auditoria; (9) `comment on` das funções.
- **Down:** remove as 3 funções novas, restaura as versões anteriores de `idoc_limite/idoc_list/idoc_confirm_done/idoc_delete` (copiar corpos da migração 20261112220000/20261112235000), remove índices e constraint de coerência, apaga linhas `kind='certificacao'` (somente DEV, dados sintéticos), remove `service_id` e restaura `check (kind in ('identidade'))`. Remover `certificacoes_completas` devolve a #52 ao comportamento fail-closed (`incompletas`), o que é seguro.
- **Aplicação:** `npx supabase` no banco de desenvolvimento (regra do projeto; nunca pelo MCP), seguida de `db:test` local. Sem Docker.
- **Compatibilidade:** mudança aditiva; linhas existentes (`identidade`) ficam válidas; sem janela de indisponibilidade.
- **Código:** `packages/domain/src/identity-docs/` (schemas e mensagens), `apps/api/src/identity-docs/` (rotas e adaptadores RPC), eventual tela do profissional segue o Design System do FastPro (texto neutro 313). Escopo de tela do profissional: lista de serviços REG vinculados com estado "falta enviar / recebido / em análise"; o DEV define o componente a partir do refino 140 §5.2 sem alterar o desenho de dados.

## 8. Riscos e dúvidas

| ID | Risco / dúvida | Mitigação / encaminhamento |
|---|---|---|
| R-01 | **Certificação recusada pela Verificação continua `recebido`.** Pelo contrato do gate (§11.2 do 140), `recebido` basta para `true`; se a análise recusa o documento (`certificacao_insuficiente`) mas o registro continua `recebido` com `analyzed_at` preenchido, o gate poderia liberar aprovação indevidamente numa segunda decisão. | O DEV deve ler `private.verification_case_decide` e o tratamento de `certificacao_insuficiente` em `20261113200000`/`20261113310000` antes de codar e confirmar como a recusa é registrada. Recomendação: se a recusa não altera `identity_document`, adicionar na função de recusa da #52 a marcação do documento (ex.: `purge_requested_at` ou novo estado) em migração própria; senão manter o contrato atual. Se exigir mudar semântica da #52, **devolver ao líder** (não decidir sozinho). |
| R-02 | Definição de "serviço ativo": `verification_reg_gate` usa só o vínculo em `app.professional_service` (sem coluna de ativo); o refino fala em "ativo". | Manter a mesma definição do gate (vínculo). Se existir coluna de ativo/soft delete em `professional_service`, o DEV aplica o mesmo filtro em gate e função, com teste T-03. |
| R-03 | Nome real do CHECK inline de `kind` e conteúdo exato de `idoc_limite`/`idoc_confirm_done` não foram relidos integralmente nesta tentativa (limite de turnos). | DEV confirma via `pg_constraint` e leitura das linhas 77-98, 315-372 antes de alterar; o `.down.sql` deve reproduzir os corpos atuais. |
| R-04 | Corrida entre finalizações concorrentes do mesmo serviço. | Lock por `(professional_id, service_id)` + índice único + teste T-05. |
| R-05 | Serviço REG adicionado após aprovação (D 305) depende da guarda de H-055 (#68), ainda não existente. | #51 só expõe `certificacao_servico_ok`; a guarda fica em #68. Não bloqueia #51. |
| R-06 | Lista oficial de atividades REG e conselhos depende de parecer jurídico (BLQ-JUR L4). | Fora do escopo DEV; testes com fixtures sintéticas. |
| R-07 | Teto global de 250 MB: confirmar se é aplicado por função ou por política do bucket. | DEV verifica e aplica soma identidade+certificação. |

**Dúvidas que exigem o dono (usuário): nenhuma.** Não há dinheiro, jurídico novo (o L4 já está registrado como pendência), perda irreversível de dados fora do escopo, nem credencial envolvidos. R-01 é a única dúvida possivelmente transversal e deve ser tratada pelo líder/Dev conforme descrito, sem pergunta ao usuário a menos que a #52 precise mudar de forma visível ao produto.

## 9. Próximo passo
Mover #51 de Arquitetura para Desenvolvimento (Orquestrador, no quadro local), com este documento e o refino 140 como entradas. Sem Docker, sem e-mail real, sem Mapbox, sem backup de dados.
