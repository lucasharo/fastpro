# Refino H-038 — Certificações para atividades regulamentadas (Issue #51) — Reexame

- **Issue:** #51 `[E4] Certificações para atividades regulamentadas` · **História:** H-038 · **Épico:** E4 (Onda 2) · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (Reexame de refino).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (aguardando confirmação do líder).
- **Natureza:** somente documento. Nenhum código, migração, teste ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação para Arquitetura.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.
- **Numeração de perguntas:** 300 a 319 (perguntas originais de H-038 reexaminadas exaustivamente, com situação atual e recomendação do PO). Nenhuma pergunta nova criada fora do escopo reservado.

---

## 0. Fontes e limitações

Fontes lidas e analisadas:
- `D:\Fabrica\AGENTS.md` e `roles/factory-product-owner.md`;
- `docs/factory/quadro-status.md` (conferido em 2026-11-14);
- `docs/factory/11-DECISOES.md` (Rodadas 45, 49, 53, 76, 80, 82, 93, 102, 104, 118, 119 a 126; decisões 170a, 172, 173, 175, 213, 260, 370 a 389, 403, 563 a 582, 592, 658);
- `docs/factory/116-REFINO-H038.md` (refino anterior de H-038);
- `docs/factory/113-REFINO-H045.md` (modelo de rigor e estrutura);
- `docs/factory/04-PRD.md` (RF-003, RF-005, RF-006, RF-046 a RF-053, RF-078, RF-147);
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-004 e itens condicionados);
- `docs/factory/08-ARQUITETURA.md` e `docs/factory/09-MODELO-DADOS.md` (§3.2 catálogo, §3.3 `identity_document` e `verification_case`, §3.7 `media_asset`, §6 e §7);
- `docs/factory/14-BACKLOG.md` (§5 E4, linha H-038; §6 BLQ-JUR L4; §2 Ondas);
- `supabase/migrations/20261112220000_identity_create_documents.sql` (esquema oficial de `app.identity_document` entregue pela #50);
- `supabase/migrations/20261113200000_verification_create_case_queue.sql` (esquema oficial de `app.verification_case` e `private.verification_reg_gate` entregues pela #52);
- `supabase/migrations/20261112120000_media_create_asset_quarantine.sql` (esquema oficial de `app.media_asset`);
- Módulos de aplicação em `apps/api/src/identity-docs/` e `packages/domain/src/identity-docs/`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #51 no GitHub não foi consultado via CLI `gh` (restrição de ferramenta e regras de execução sem rede externa). O objetivo foi conferido a partir do Backlog, PRD, critérios de aceite e refino 116.
- Nenhum comando contra o banco de desenvolvimento foi executado (ambiente preservado; somente inspeção estática de arquivos de migração e código).

---

## 1. Verificação de fila e o que mudou nas dependências reais

### 1.1 Estado atual das Issues no quadro (`docs/factory/quadro-status.md`)
- `[VERIFICADO]` **Concluídas até agora:** #43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151 (além das anteriores de infraestrutura e cadastro: #3, #15 a #35, #38 a #42, #48, #49, #111 a #114, #116 a #118, #125, #129).
- `[VERIFICADO]` **Em QA:** #45 (visibilidade de localização, H-032), #46 (opt-in de telefone, H-033), #53 (retenção por duplicidade, H-040).
- `[VERIFICADO]` **Em Product Owner:** #51 (esta Issue, certificações) e #68 (descoberta de pedidos elegíveis, H-055).
- `[VERIFICADO]` **Em Arquitetura:** #56 (perfil público e selo verificado, H-043 — Arquitetura concluída/pronta, decisão 661), #55 (guarda de elegibilidade, H-042 — Arquitetura concluída/pronta, Rodada 123), #54 (estado da verificação visível, H-041 — Arquitetura concluída/pronta, decisão 632), #47 (painel do cliente, H-034 — Arquitetura concluída/pronta, decisão 523).

### 1.2 O que mudou nas dependências desde o refino 116 (`116-REFINO-H038.md`)
No refino anterior (2026-11-13), o trabalho de desenvolvimento de #51 estava travado por condições que agora se transformaram por completo:

1. **#50 (H-037, Documentos de identidade) está CONCLUÍDA:**
   - *No refino 116:* Estava em "Aguardando aprovação", pendente de decisão humana, bloqueando qualquer extensão de esquema ou reutilização de rotas.
   - *Hoje:* Concluída pelo usuário (Rodada 80 e consolidação posterior). A tabela `app.identity_document` existe e está ativa (`20261112220000_identity_create_documents.sql`), os buckets `identity-incoming` e `identity-docs` estão configurados, o pipeline de reencode e os adaptadores de domínio em `apps/api/src/identity-docs/` e `packages/domain/src/identity-docs/` estão validados e testados.
2. **#52 (H-039, Fila de verificação) está CONCLUÍDA:**
   - *No refino 116:* Estava em "Backlog". Havia indefinição sobre quem entregaria o gate de aprovação e como seria a integração.
   - *Hoje:* Concluída na Rodada 102. A migração `20261113200000_verification_create_case_queue.sql` já implementou formalmente a tabela `app.verification_case`, a esteira da Verificação e o gate fail-closed em `private.verification_reg_gate(p_professional uuid)` (decisões 373 e 403), chamando por reflexão/indireção `private.certificacoes_completas(uuid)`.
3. **#53 (H-040, Retenção por duplicidade) está em QA:**
   - Entregou migrações `20261113280000` e `20261113310000`. Trata duplicidade de cadastro sem interferir no esquema de certificações de #51.
4. **O conflito de `media_asset` (pergunta 310) está DEFINITIVAMENTE PACIFICADO:**
   - *No refino 116:* Apontava ambiguidade entre `09` §3.7 (que listava `certification` em `owner_kind`) e `107-DESENHO-H037` (decisões 172 e 213, proibindo `media_asset` para documentos).
   - *Hoje:* O código real de migração (`20261112120000_media_create_asset_quarantine.sql`) comprovou que `media_asset` não possui coluna `owner_kind` e vincula-se exclusivamente a `draft_id`. E `09-MODELO-DADOS.md` §3.3 consolidou: *"Sem `media_asset_id`: não é foto e não usa `media_asset` (decisão 213)"*. A certificação é armazenada exclusivamente em `app.identity_document` e nos buckets `identity-incoming` e `identity-docs`.

---

## 2. Objetivo

Permitir que o profissional anexe a certificação técnica/profissional exigida para serviços marcados como regulamentados (`regulated = true`) no catálogo (`app.service`) que ele atende em seu perfil (`app.professional_service`), reaproveitando integralmente a infraestrutura de armazenamento, reencode seguro e limites de `identity_document` estabelecidos por #50.

Prover a função canônica de elegibilidade de certificações `private.certificacoes_completas(p_professional uuid) returns boolean` exigida pelo gate `private.verification_reg_gate` de #52, permitindo que a Verificação aprove com segurança profissionais habilitados e retenha/impeça a aprovação daqueles com certificações faltantes.

Resultado de negócio: o FastPro cumpre o requisito de não aprovar profissionais sem comprovação para atividades regulamentadas (RF-047; FA-004), preservando estritamente a posição jurídica da plataforma de apenas conectar partes (RF-078), sem emitir selos públicos de qualidade técnica ou atestados de garantia (RF-005, RF-006; decisões 592 e 658 da #56).

---

## 3. Escopo (dentro de H-038)

1. **Extensão de esquema de `app.identity_document`:**
   - Ampliação da restrição CHECK de `kind`: `kind in ('identidade', 'certificacao')`.
   - Adição da coluna referencial aditiva: `service_id uuid references app.service (id) on delete restrict`.
   - Restrição CHECK de coerência de tipo:
     `((kind = 'identidade' and service_id is null) or (kind = 'certificacao' and service_id is not null))`.
   - Índice único parcial para garantir uma única certificação ativa/recebida por serviço do profissional:
     `unique (professional_id, service_id) where (kind = 'certificacao' and status = 'recebido')`.
2. **Validação negocial de serviço regulamentado:**
   - Emissão de upload para certificação (`kind = 'certificacao'`) só é aceita se:
     a) `service_id` for válido e existir em `app.service`;
     b) `service.regulated` for verdadeiro (`true`);
     c) o profissional possuir esse serviço ativo em seu perfil (`app.professional_service`).
   - Tentativa de envio para serviço não regulamentado ou não vinculado ao profissional é recusada com código 422 uniforme.
3. **Reaproveitamento do pipeline de validação e ingestão segura (#50):**
   - Reserva de envio (`POST /v1/professional/documents/uploads` com `kind = 'certificacao'` e `service_id`), validação de tipos declarados (JPEG, PNG, WebP e PDF), limite de entrada até 5 MiB para imagem e 2 MiB para PDF.
   - Gravação temporária no bucket `identity-incoming`, finalização com inspeção de cabeçalho binário (magic bytes), reencode de imagem para JPEG (≤ 1280 px, ≤ 750 KB) ou integridade de PDF (≤ 2 MiB, mesmo SHA-256), e persistência no bucket final `identity-docs`.
   - Exclusão permitida pelo profissional via `DELETE /v1/professional/documents/{id}` estritamente enquanto `analyzed_at is null`; após analisado, exclusão é bloqueada com código 409 uniforme.
4. **Função canônica de verificação de certificações (contrato com #52):**
   - Criação da função `private.certificacoes_completas(p_professional uuid) returns boolean` no schema `private`, com `security definer` e `set search_path = ''`.
   - Lógica: para cada serviço regulamentado ativo do profissional (`app.professional_service ps join app.service s on s.id = ps.service_id where ps.professional_id = p_professional and s.regulated = true`), deve existir ao menos uma linha em `app.identity_document` com `professional_id = p_professional`, `service_id = s.id`, `kind = 'certificacao'` e `status = 'recebido'`. Retorna `true` se todos tiverem certificação recebida (ou se não houver serviços REG); retorna `false` caso falte certificação para qualquer serviço REG ativo.
5. **Integração com a rota de listagem de documentos do profissional:**
   - A listagem `GET /v1/professional/documents` passa a incluir metadados de certificações (`kind`, `service_id`, `status`, data), sem retornar binário, caminhos internos nem PII.
6. **Leitura restrita e auditoria:**
   - Profissional nunca baixa ou lê o binário do arquivo após o envio (decisão 170a).
   - Somente a equipe de Verificação pode ler o arquivo via download autenticado e auditado no console administrativo (#52, gravando em `sensitive_access_log`).
   - Operações de finalização, substituição e exclusão gravam eventos append-only em `audit.audit_event` sem nome de arquivo nem dados sensíveis.
7. **Testes automatizados completos:**
   - Testes de banco (`db:test`), testes de domínio (`packages/domain`) e testes de rota HTTP com dados sintéticos marcados.

---

## 4. Fora de escopo

- Validação automática do teor da certificação, autenticidade, consulta a conselhos de classe (CRM, CREA, OAB, etc.) ou OCR: expressamente fora de escopo (bloqueio BLQ-JUR L4; plataforma sem chamadas externas / sem custos de terceiros). A análise é exclusivamente documental e humana pela Verificação (#52).
- Gestão do catálogo e edição manual da flag `regulated` em tela de administração: H-107. #51 somente lê a flag existente em `app.service`.
- Fila de verificação, atribuição de analista, parecer e registro de decisão do caso: entregues por #52 (H-039).
- Tela de consulta da situação do cadastro pelo profissional e formulário de recurso: H-041 (#54).
- Guarda global de elegibilidade na busca/aceite de pedidos: H-042 (#55).
- Exibição de certificação ou selo de habilitado no perfil público: vedado por RF-005, RF-006, RF-078 e decisões 592 e 658 da #56 (o selo público é estritamente de identidade).
- Qualquer serviço externo de mapas ou geocodificação (Mapbox terminantemente proibido).

---

## 5. Fluxos e estados

### 5.1 Ciclo de vida da certificação (`app.identity_document`)

| Estado (`status`) | Quem transiciona | Regra e comportamento |
|---|---|---|
| `pendente_envio` | Profissional (via emissão) | Vaga reservada no bucket de entrada; TTL de 30 minutos. Se não finalizado, é expurgado por limpeza operacional. |
| `recebido` | Sistema (na finalização) | Arquivo validado por tipo real (magic bytes), reencodado (se imagem) ou validado (se PDF), persistido em `identity-docs`. |
| `substituido` | Sistema (na finalização de novo envio) | Quando uma nova certificação é finalizada com sucesso para o mesmo `(professional_id, service_id)`, o documento anterior já analisado passa para `substituido`. |
| (excluído) | Profissional | Permitido estritamente enquanto `analyzed_at is null`. Remove o registro e agenda purga do binário. Se `analyzed_at` não for nulo, responde 409. |

### 5.2 Fluxo do profissional

```
[Profissional com serviço REG no perfil]
                 │
                 ▼
  Vê pendência em Seus Documentos
  ("Esta atividade exige certificação. Envie o documento para continuar.")
                 │
                 ▼
  Emite reserva de upload:
  POST /v1/professional/documents/uploads
  Payload: { client_upload_id, content_type, size_bytes, kind: "certificacao", service_id }
                 │
                 ├─► [Validação: service_id é REG e pertence ao perfil?]
                 │         ├─► Não: 422 uniforme
                 │         └─► Sim: 201 com upload_url temporária (identity-incoming)
                 ▼
  Upload do binário diretamente no bucket de entrada
                 │
                 ▼
  Finalização:
  POST /v1/professional/documents/:id/finalize
                 │
                 ├─► Validação magic bytes, reencode JPEG ≤1280px ou integridade PDF ≤2MB
                 │         ├─► Falha/Corrupção: 415/422 (rejeitado)
                 │         └─► Sucesso: gravado em identity-docs; status = 'recebido'
                 ▼
  Lista atualizada com status "recebido" (sem URL de download)
```

### 5.3 Fluxo do Gate da Verificação (#52 e #51)

```
[Analista da Verificação decide aprovar caso: POST .../decide com 'aprovada']
                                 │
                                 ▼
              private.verification_case_decide(...)
                                 │
                                 ▼
              private.verification_reg_gate(professional_id)
                                 │
      ┌──────────────────────────┴──────────────────────────┐
      ▼                                                     ▼
[Profissional NÃO tem serviços REG]              [Profissional TEM serviços REG]
      │                                                     │
      ▼                                                     ▼
Retorna 'sem_reg'                        Chama private.certificacoes_completas(uuid)
      │                                                     │
      │                                    ┌────────────────┴────────────────┐
      │                                    ▼                                 ▼
      │                             Retorna TRUE                      Retorna FALSE
      │                                    │                                 │
      │                                    ▼                                 ▼
      │                            Retorna 'completas'              Retorna 'incompletas'
      │                                    │                                 │
      └─────────────────┬──────────────────┘                                 │
                        ▼                                                    ▼
             Aprovação autorizada                               Exceção VRF05: 'certificacao_pendente'
    (Status do caso e do perfil -> 'aprovada')                      (Transição RECUSADA)
```

### 5.4 Adição de serviço REG após aprovação do profissional (`[PROPOSTA]`)
Se um profissional já com perfil aprovado adicionar posteriormente um serviço com flag `regulated = true`:
- A aprovação global do profissional para os serviços anteriores é mantida (não regride para `pendente`).
- O novo serviço regulamentado permanece bloqueado para recebimento de pedidos e aceite até que a certificação correspondente seja enviada e o status da verificação desse serviço seja regularizado (compatível com RF-050 e regras de guarda de #55/#68).

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-038 atende |
|---|---|---|---|
| **RN-H038-01** | Atividade regulamentada sem certificação recebida não conclui a aprovação. | RF-047; FA-004; #52 decisão 403 | Fornece `private.certificacoes_completas(uuid)` que retorna `false` caso haja serviço REG sem certificação recebida, ativando a exceção `VRF05` no gate da #52. |
| **RN-H038-02** | Certificação só se aplica a serviço com flag `regulated = true` associado ao perfil. | RF-003; 09 §3.2 | Verificação no endpoint de emissão (`POST /uploads`) e restrição de integridade no banco. |
| **RN-H038-03** | Uma certificação viva por par `(professional_id, service_id)`. | `[PROPOSTA]`, espelha #50 | Índice único parcial `(professional_id, service_id) WHERE kind = 'certificacao' AND status = 'recebido'`. Nova finalização marca a anterior como `substituido`. |
| **RN-H038-04** | Certificação não é foto; não usa `media_asset` nem passa por quarentena de pedidos. | Decisões 172 e 213; 09 §3.3; migração `20261112220000` | Opera exclusivamente em `app.identity_document` e nos buckets `identity-incoming` e `identity-docs`. |
| **RN-H038-05** | Profissional não tem acesso ao binário após o envio; leitura restrita à Verificação. | RF-052; decisão 170a; #52 | Nenhuma rota devolve URL pública ou binário ao profissional. Verificação acessa via download do console admin (#52, auditado em `sensitive_access_log`). |
| **RN-H038-06** | Ausência de garantia pública e vedação de selo público de certificação. | RF-005, RF-006, RF-078; decisões 592 e 658 da #56 | Perfil público e busca não expõem certificações nem atestam capacitação profissional técnica. |
| **RN-H038-07** | Ausência de checagem automática externa em conselhos ou bases governamentais. | RF-047; BLQ-JUR L4 | Validação exclusivamente documental; conferência humana realizada no console de verificação (#52). |
| **RN-H038-08** | Sem PII em logs, eventos de auditoria ou nomes de objetos no Storage. | 09 §7; decisões de #50 | Auditoria grava UUIDs fixos e ações; Storage usa nomes aleatórios (`UUID v4`). |
| **RN-H038-09** | Produção fechada por feature flag (`IDENTITY_DOCS_ENABLED`) e parecer L1. | 107-DESENHO-H037 §9 | Reutilização das mesmas travas de ambiente de #50 para as rotas e componentes estendidos. |

---

## 7. Critérios de aceite (numerados e testáveis)

Todos os testes de banco são locais, com dados sintéticos marcados. Evidências demonstradas por comandos `corepack pnpm check:all` e `db:test` com contagens e saída zero.

- **CA-H038-01 (Esquema aditivo de `identity_document`):** A tabela aceita `kind = 'certificacao'` exclusivamente com `service_id` NOT NULL; aceita `kind = 'identidade'` exclusivamente com `service_id` NULL. A coluna `service_id` possui FK para `app.service(id)`. Prova: inserção de identidade com `service_id` falha com violação de CHECK; certificação sem `service_id` falha com violação de CHECK; certificação com `service_id` válido é aceita.
- **CA-H038-02 (Validação de serviço regulamentado no envio):** Requisição de upload (`POST /v1/professional/documents/uploads`) com `kind = 'certificacao'` para serviço com `regulated = false` ou para serviço não associado ao perfil do profissional é rejeitada com código HTTP 422 uniforme. Prova: teste HTTP com serviço comum (rejeitado 422) e com serviço regulamentado vinculado (aceito 201).
- **CA-H038-03 (Contrato exato da função `private.certificacoes_completas`):** A função `private.certificacoes_completas(p_professional uuid) returns boolean` implementa:
  - Retorna `true` se o profissional não tiver serviços regulamentados ativos;
  - Retorna `false` se o profissional possuir 1 serviço REG ativo e 0 certificações recebidas;
  - Retorna `false` se o profissional possuir 2 serviços REG ativos e apenas 1 com certificação recebida;
  - Retorna `true` se o profissional possuir 2 serviços REG ativos e ambos com certificação recebida.
  Prova: fixture de teste de banco cobrindo os quatro cenários exatos.
- **CA-H038-04 (Integração real com o gate da #52):** Com a função `private.certificacoes_completas(uuid)` instalada:
  - Tentativa de aprovação (`private.verification_case_decide(..., 'aprovada')`) de profissional com certificações incompletas é abortada com exceção `certificacao_pendente` (SQLSTATE `VRF05`);
  - Tentativa de aprovação de profissional com certificações completas é executada com sucesso, movendo o caso e o perfil para `aprovada`.
  Prova: teste de integração de banco executando `private.verification_case_decide` chamando o gate real de #52.
- **CA-H038-05 (Unicidade de certificação viva por serviço):** Inserção de uma segunda certificação em status `recebido` para o mesmo `(professional_id, service_id)` é impedida pelo índice único parcial. Nova finalização de documento para o mesmo serviço transiciona o documento anterior analisado para `substituido`. Prova: tentativa simultânea resulta em erro de unicidade; fluxo sequencial resulta em uma linha `substituido` e uma `recebido`.
- **CA-H038-06 (Limites e cotas independentes):** Certificações não contam para o limite de 5 documentos de identidade (decisão 175 de #50). A soma respeita o teto global de bytes da infraestrutura (250 MB). Prova: profissional com 5 documentos de identidade ativos consegue enviar com sucesso sua certificação de serviço REG.
- **CA-H038-07 (Reaproveitamento do pipeline seguro de imagem e PDF):** O envio de certificação processa imagens (JPEG, PNG, WebP) convertendo-as para JPEG ≤ 1280 px e ≤ 750 KB; PDFs válidos até 2 MiB são gravados com mesmo SHA-256 e tamanho; formatos proíbidos (GIF, SVG, executáveis) resultam em 415; arquivos acima dos limites resultam em 413. Prova: suíte de testes de finalização com fixtures sintéticas idêntica à de #50 aplicada a `kind = 'certificacao'`.
- **CA-H038-08 (Ausência de rota de download ao profissional):** Nenhuma rota expõe o arquivo binário da certificação ao profissional após o envio; nenhum link público de Storage é retornado. Prova: varredura estática de rotas e teste de contrato de resposta de `GET /v1/professional/documents`.
- **CA-H038-09 (Isolamento de perfil público e busca):** A resposta do perfil público (`GET /v1/public/professionals/:slug`) e a listagem de profissionais não exibem campos de certificação, status de análise ou menção de garantia técnica (alinhado às decisões 592 e 658 da #56). Prova: teste de contrato da rota de perfil público.
- **CA-H038-10 (Auditoria e ausência de PII):** Finalização, substituição e exclusão de certificações gravam eventos em `audit.audit_event` sem nome de arquivo original, sem IP em claro e sem caminhos de Storage. Prova: asserção nos eventos gravados na auditoria durante o ciclo de vida.
- **CA-H038-11 (Regra de exclusão pelo profissional):** O profissional pode excluir sua certificação enviada via `DELETE /v1/professional/documents/{id}` enquanto `analyzed_at` for nulo. Após `analyzed_at` preenchido pela Verificação, a exclusão é recusada com código 409 uniforme. Prova: teste com documento não analisado (excluído com 204) e com documento analisado (rejeitado com 409).
- **CA-H038-12 (Neutralidade sobre `verification_status`):** O envio, finalização ou exclusão de certificação não altera o campo `verification_status` do perfil nem altera o status do caso na fila da Verificação. Prova: teste de mutação garantindo que o status do perfil permanece idêntico antes e depois do upload.
- **CA-H038-13 (Isolamento de autorização e segurança de acesso):** Tentativa de emissão, finalização ou exclusão de certificação informando identificador de outro profissional, ID inexistente ou ID malformado responde com código 404 uniforme. Prova: testes de autorização por perfil.
- **CA-H038-14 (Guarda de feature flag):** Sem a flag `IDENTITY_DOCS_ENABLED=1` ativa no ambiente, todas as rotas estendidas respondem 404 uniforme sem acessar banco nem Storage. Prova: teste de rota com variável de ambiente desligada.
- **CA-H038-15 (Linguagem neutra e ausência de promessa de garantia):** Telas e mensagens utilizam exclusivamente linguagem neutra aprovada ("Esta atividade exige certificação. Envie o documento para continuar."), sem utilizar vocábulos como "garante", "certificado de qualidade", "seguro" ou "aprovado pelo conselho". Prova: varredura textual nos arquivos de constantes e mensagens do domínio.
- **CA-H038-16 (Verificação local e saída limpa):** Todas as suítes de testes (`corepack pnpm check:all` e `db:test`) são executadas em ambiente local com dados sintéticos marcados, apresentando saída 0 e sem dependência de serviços externos.

---

## 8. Dependências reais conferidas em `docs/factory/quadro-status.md`

| Item | Estado no quadro | Tipo | Efeito sobre H-038 (#51) |
|---|---|---|---|
| **H-037 / #50** (documentos de identidade) | **Concluído** | Declarada no backlog | **Liberado.** Tabela `app.identity_document`, rotas, buckets e pipeline de reencode estão aprovados e disponíveis para expansão aditiva. |
| **H-039 / #52** (fila de verificação) | **Concluído** | Real (consumidora) | **Liberado.** `app.verification_case` e o gate fail-closed `private.verification_reg_gate` já existem no banco. A #51 fornece a função `private.certificacoes_completas(uuid)` esperada pelo gate. |
| **H-040 / #53** (retenção por duplicidade) | **QA** | Irmã de épico | Não bloqueia #51. Trata retenção e duplicidade em `verification_case`. |
| **H-018 / #31** (catálogo, flag REG) | **Concluído** | Declarada | Flag `s.regulated` existe e está populada em `app.service`. |
| **H-035 / #48** (cadastro com CPF/CNPJ) | **Concluído** | Herdada | Perfil profissional e identificação segura disponíveis. |
| **H-036 / #49** (perfil, serviços e raio) | **Concluído** | Implícita | Tabela `app.professional_service` disponível para cruzamento de serviços ativos. |
| **H-044 / #57** (trial de 14 dias) | **Concluído** | Irmã de fluxo | Concluída. Não bloqueia #51. |
| **H-045 / #58** (acesso comercial derivado) | **Concluído** | Irmã de fluxo | Concluída. Não bloqueia #51. |
| **H-046 / #59** (planos e preços) | **Concluído** | Irmã de fluxo | Concluída. Não bloqueia #51. |
| **H-043 / #56** (perfil público e selo) | **Arquitetura** | Consumidora | Decisões 592 e 658 da #56 já estabeleceram que serviço REG sem certificação não é verificado e que certificação não é exibida publicamente. Não bloqueia #51. |
| **H-042 / #55** (guarda de elegibilidade) | **Arquitetura** | Consumidora | Desenho aprovado na Rodada 123 (decisões 640 a 645). Consome aprovação geral do profissional. Não bloqueia #51. |
| **BLQ-JUR L4** (pendência jurídica) | Pendência jurídica | Declarada | Bloqueia checagem automática externa e lista definitiva de conselhos. Não bloqueia a anexação documental nem a análise humana presencial. |

**Conclusão de Dependências:** Todas as dependências técnicas impeditivas que existiam no momento do refino 116 foram superadas com a conclusão formal de #50 e de #52.

---

## 9. Riscos e mitigações

- **R1. Contrato da função com o gate da #52:** Risco de discrepância entre a assinatura esperada pelo gate e a implementação da #51.
  *Mitigação:* O contrato foi verificado diretamente no SQL de #52 (`20261113200000_verification_create_case_queue.sql:300-305`): a função deve ser estritamente `private.certificacoes_completas(p_professional uuid) returns boolean`. A conformidade é total.
- **R2. Conflito documental de `media_asset`:** Risco de regressão se algum desenvolvedor tentar usar a infraestrutura de fotos de pedidos para certificações.
  *Mitigação:* RN-H038-04 e decisões 172 e 213 pacificaram que documentos nunca tocam `media_asset` nem passam por quarentena de fotos.
- **R3. Adição de serviço regulamentado após a aprovação:** Risco de profissional aprovado passar a atender atividade regulamentada sem anexar certificação.
  *Mitigação:* Regra §5.4: a adição de novo serviço regulamentado mantém a aprovação do profissional para os serviços preexistentes, mas o serviço novo permanece bloqueado para pedidos e aceites até que o comprovante seja anexado e validado.
- **R4. Expectativa de validação técnica do conteúdo de certificados:** Risco legal de usuário presumir que a plataforma autenticou o diploma ou conselho de classe.
  *Mitigação:* RN-H038-06 e CA-H038-15: linguagem estritamente neutra nos termos e interfaces ("Esta atividade exige certificação. Envie o documento para continuar."), ausência de selos públicos de capacitação e termo explícito de conexão de partes (RF-078).

---

## 10. Reexame completo das perguntas 300 a 319 ao líder

Todas as 20 perguntas formuladas originalmente em `116-REFINO-H038.md` foram reexaminadas considerando as entregas das Rodadas 45 a 126 de `11-DECISOES.md` e o código aplicado no repositório. Nenhuma numeração nova foi inventada.

```
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| Número | Tema da Pergunta                   | Situação Atual pós-Rodadas / Código Existente                 | Ainda Vale?     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 300    | Escopo da verificação de conteúdo  | Decidido em #52 e PRD (RF-047, L4): revisão estritamente      | Pacificada      |
|        |                                    | documental e humana no console admin; sem checagem externa.   | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 301    | Lista de atividades REG            | A flag s.regulated existe em app.service (H-018). Em DEV      | Pacificada      |
|        |                                    | usam-se fixtures sintéticas; sem lista arbitrária no seed.    | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 302    | Granularidade da certificação      | Confirmado em 09 §3.3 e na migração de #52: 1 certificação    | Pacificada      |
|        |                                    | por par (profissional, serviço REG), service_id obrigatório.  | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 303    | Validade temporal de certificação  | Sem checagem automática nem campo valid_until no banco.       | Pacificada      |
|        |                                    | Critério avaliado humanamente pela Verificação quando couber. | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 304    | Momento da exigência               | Implementado em #52: condição prévia obrigatória para         | Pacificada      |
|        |                                    | conclusão da transição para 'aprovada' (FA-004, dec. 403).   | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 305    | Serviço REG adicionado pós-aprovação| Proposta mantida: aprovação geral mantida; serviço novo      | Vale como       |
|        |                                    | bloqueado para aceite até envio e análise da certificação.    | Proposta (a)    |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 306    | Recusa de certificação na esteira  | #52 implementou motivo 'certificacao_insuficiente'.           | Pacificada      |
|        |                                    | Profissional reenvia documento sem exclusão sumária de conta. | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 307    | Limite de documentos vivos         | Cota própria: 1 certificação viva por serviço REG, sem        | Pacificada      |
|        |                                    | interferir na cota de 5 documentos de identidade da #50.     | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 308    | Formato e tamanho da certificação  | Reúso do pipeline de #50: imagem até 5 MiB (JPEG/PNG/WebP),   | Pacificada      |
|        |                                    | PDF até 2 MiB; saída JPEG ≤750 KB ou PDF ≤2 MiB.              | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 309    | Ordem de entrega entre #51 e #52   | Resolvida pelos fatos: #52 foi entregue e concluída antes     | Pacificada      |
|        |                                    | com gate fail-closed; #51 agora entrega a função esperada.    | pelos fatos     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 310    | Certificação e media_asset         | Resolvida: 09 §3.3 e migração 20261112220000 estabelecem      | Pacificada      |
|        |                                    | uso exclusivo de identity_document e buckets de identidade.   | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 311    | Visibilidade ao profissional       | Profissional vê status 'recebido'/'substituido'; binário não  | Pacificada      |
|        |                                    | pode ser baixado pelo profissional após envio (decisão 170a). | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 312    | Certificação no perfil público     | Decisões 592 e 658 da #56: nenhuma menção a certificações no  | Pacificada      |
|        |                                    | perfil público; selo é exclusivo de identidade da plataforma. | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 313    | Texto da tela para serviço REG     | Aprovado como modelo [PROPOSTA] para uso em DEV: "Esta        | Vale para       |
|        | sem certificação                   | atividade exige certificação. Envie o documento p/ continuar."| homologação     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 314    | Trava de ambiente de produção      | Reutiliza as mesmas variáveis de #50:                         | Pacificada      |
|        |                                    | IDENTITY_DOCS_ENABLED=1 e parecer L1.                         | (Solução Sim)   |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 315    | Início do trabalho de #51          | Refino reexaminado e concluído. Com #50 e #52 concluídas,     | Pacificada      |
|        |                                    | #51 avança para Arquitetura e depois para Desenvolvimento.    | pelos fatos     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 316    | Auditoria de recusas sintáticas    | Audita-se transições de estado (recebimento, substituição,    | Pacificada      |
|        |                                    | exclusão); recusas sintáticas respondem HTTP sem auditoria.   | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 317    | Retenção e expurgo operacional     | Certificação segue a mesma infraestrutura de expurgo e        | Pacificada      |
|        |                                    | purge_requested_at de identity_document (#118/#119).          | (Solução Sim)   |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 318    | Responsabilidade da flag REG       | Edição da flag REG no catálogo pertence a H-107.              | Pacificada      |
|        |                                    | #51 apenas lê o valor existente em s.regulated.               | (Solução Sim)   |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
| 319    | Localização do critério de bloqueio| #52 implementou o gate de bloqueio (VRF05). #51 fornece       | Pacificada      |
|        |                                    | private.certificacoes_completas(uuid) para alimentar o gate.  | (Solução a)     |
+--------+------------------------------------+---------------------------------------------------------------+-----------------+
```

### Detalhamento e recomendação formal do PO para cada item:

**300. Escopo da verificação do conteúdo (L4).**
- *Situação atual:* Pacificada. O PRD (RF-047, RF-078) e a implementação de #52 (Rodada 76, decisões 375, 381, 382; tela de análise do admin) confirmaram que o FastPro não faz integração com conselhos externos nem OCR. A verificação é estritamente documental e humana por analista com papel `verificacao`.
- *Recomendação do PO:* Opção (a) — Análise documental humana na esteira da #52, sem validação automatizada externa. Destrava RN-H038-07 e CA-H038-08.

**301. Lista de atividades REG.**
- *Situação atual:* Pacificada. A coluna `s.regulated` existe em `app.service` desde a H-018 (#31). Para validação em desenvolvimento e testes automatizados, fixtures sintéticas de serviços com `regulated = true` suprem os testes.
- *Recomendação do PO:* Opção (a) — Catálogo como fonte da verdade via flag `regulated`; não inventar lista arbitrária no seed oficial até parecer jurídico L4. Destrava CA-H038-02.

**302. Granularidade da certificação.**
- *Situação atual:* Pacificada. `09-MODELO-DADOS.md` §3.3 e a função de gate em `20261113200000_verification_create_case_queue.sql` iteram sobre serviços atribuídos ao profissional (`app.professional_service`).
- *Recomendação do PO:* Opção (a) — Uma certificação por par `(professional_id, service_id)`, com coluna `service_id` obrigatória quando `kind = 'certificacao'`. Destrava CA-H038-01 e CA-H038-05.

**303. Validade temporal da certificação.**
- *Situação atual:* Pacificada. A tabela `app.identity_document` não possui campo `valid_until` e a esteira de #52 não possui cron de expiração de documentos.
- *Recomendação do PO:* Opção (a) — Sem campo de data de validade nem expiração automatizada em #51. Análise de vigência fica a critério humano da Verificação quando aplicável. Destrava a modelagem do banco.

**304. Momento da exigência.**
- *Situação atual:* Pacificada. Já implementado na migração `20261113200000_verification_create_case_queue.sql` (linhas 566-568): a aprovação do profissional só é concluída se o gate de certificações for atendido.
- *Recomendação do PO:* Opção (a) — Exigida como condição mandatória para conclusão da aprovação do perfil profissional (FA-004). Destrava CA-H038-03 e CA-H038-04.

**305. Serviço REG adicionado após a aprovação.**
- *Situação atual:* Válida como diretriz de produto (`[PROPOSTA]`).
- *Recomendação do PO:* Opção (a) — O profissional não perde a aprovação global dos serviços já consolidados; o serviço regulamentado novo permanece bloqueado para pedidos e aceites até que o respectivo documento seja anexado e validado. Destrava §5.4 e integração com H-055 (#68).

**306. Certificação recusada pela Verificação.**
- *Situação atual:* Pacificada. #52 implementou o motivo `certificacao_insuficiente` em `verification_case`. A recusa do documento não acarreta exclusão sumária nem encerra a conta; o profissional pode enviar nova certificação para substituir a insuficiente.
- *Recomendação do PO:* Opção (a) — Reenvio pelo profissional via canal regular de documentos. Destrava fluxo de retificação.

**307. Limite de documentos vivos.**
- *Situação atual:* Pacificada. O limite de 5 documentos de identidade vigora para `kind = 'identidade'`.
- *Recomendação do PO:* Opção (a) — Limite próprio: até 1 certificação viva (`status = 'recebido'`) por serviço regulamentado associado ao profissional, sem consumir a cota de 5 documentos de identidade. A soma de armazenamento compartilha o teto global de bytes. Destrava CA-H038-06.

**308. Formato e tamanho da certificação.**
- *Situação atual:* Pacificada. Reuso direto das constantes e funções de #50.
- *Recomendação do PO:* Opção (a) — Imagem até 5 MiB (reduzida para JPEG ≤1280px e ≤750 KB); PDF até 2 MiB preservado integralmente. Destrava CA-H038-07.

**309. Ordem entre #51 e #52.**
- *Situação atual:* Pacificada pelos fatos da fábrica. #52 foi entregue e concluída antes (Rodada 102), utilizando técnica de desacoplamento seguro (gate fail-closed com `to_regprocedure`). #51 agora entrega a ponta complementar.
- *Recomendação do PO:* Registrar fato consumado: #52 concluída primeiro; #51 entrega a função esperada pelo gate.

**310. Certificação e `media_asset`.**
- *Situação atual:* Pacificada. `media_asset` é restrito a fotos de pedidos (`draft_id`). Decisões 172 e 213 e `09` §3.3 consagraram que documentos de identidade e certificações pertencem a `identity_document` nos buckets `identity-incoming` e `identity-docs`.
- *Recomendação do PO:* Opção (a) — Certificação opera 100% sob `app.identity_document`, sem qualquer vínculo com `media_asset`. Destrava RN-H038-04.

**311. Visibilidade do arquivo ao profissional.**
- *Situação atual:* Pacificada. Decisão 170a via #50: o profissional recebe confirmação "recebido" e status de análise, mas nunca obtém URL pública de download após o envio.
- *Recomendação do PO:* Opção (a) — Somente a Verificação lê o arquivo binário. O profissional acessa apenas metadados de status. Destrava CA-H038-08.

**312. Certificação no perfil público.**
- *Situação atual:* Pacificada. Decisões 592 e 658 da #56 (perfil público) aprovaram que serviços regulamentados são exibidos sem menção a certificados e que o perfil não emite atestado de habilitação técnica.
- *Recomendação do PO:* Opção (a) — Nenhuma menção pública a certificações no perfil público ou em buscas. Destrava CA-H038-09.

**313. Texto da tela para serviço REG sem certificação.**
- *Situação atual:* Válida como modelo `[PROPOSTA]`.
- *Recomendação do PO:* Aprovar para uso em DEV: *"Esta atividade exige certificação. Envie o documento para continuar."* Destrava CA-H038-15.

**314. Trava de produção.**
- *Situação atual:* Pacificada. As rotas estendidas compartilham o mesmo módulo `identity-docs`.
- *Recomendação do PO:* Sim, manter as mesmas travas de feature flag (`IDENTITY_DOCS_ENABLED=1`) e parecer jurídico L1. Destrava CA-H038-14.

**315. Início do trabalho de Desenvolvimento.**
- *Situação atual:* Pacificada pelas dependências concluídas.
- *Recomendação do PO:* A etapa de Product Owner se encerra neste reexame. #51 avança para Arquitetura para emitir o `DESENHO-H038.md` e alocar o prefixo de migração. O Desenvolvimento de código e migração poderá iniciar logo após a Arquitetura, pois #50 e #52 já estão CONCLUÍDAS. Destrava a esteira do WF-03.

**316. Auditoria de recusa na emissão.**
- *Situação atual:* Pacificada. Alinhada ao padrão D-H037-6 de #50.
- *Recomendação do PO:* Opção (a) — Auditoria append-only registra operações com efeito de estado (`received`, `replaced`, `deleted`); erros sintáticos de payload (400, 415, 422) respondem código HTTP sem poluir a tabela de auditoria. Destrava CA-H038-10.

**317. Retenção e expurgo.**
- *Situação atual:* Pacificada. A tabela `app.identity_document` já possui a coluna `purge_requested_at`.
- *Recomendação do PO:* Seguir a mesma mecânica operacional de retenção e expurgo de #50 e #118/#119. Destrava RN-H038-08.

**318. Responsável pela flag REG.**
- *Situação atual:* Pacificada. Gestão do catálogo e tela admin pertencem a H-107 (Backlog).
- *Recomendação do PO:* Sim. #51 apenas lê `s.regulated`. Testes locais utilizam fixtures sintéticas com flag verdadeira. Destrava CA-H038-02.

**319. Dependência declarada do gate de aprovação.**
- *Situação atual:* Pacificada pela entrega de #52.
- *Recomendação do PO:* Opção (a) — #52 já contém o gate de bloqueio em `private.verification_reg_gate`. A responsabilidade de #51 é fornecer `private.certificacoes_completas(uuid) returns boolean` atendendo à assinatura e semântica consumidas por #52. Destrava CA-H038-04.

---

## 11. Definição exata do contrato que a #52 espera (`verification_reg_gate`)

A Issue #52 (concluída na Rodada 102) implementou no arquivo de migração `supabase/migrations/20261113200000_verification_create_case_queue.sql` o mecanismo de controle de aprovação com fail-closed para atividades regulamentadas (decisões 373 e 403).

### 11.1 Código real existente em produção/DEV (`20261113200000_verification_create_case_queue.sql:283-306`)

```sql
-- REG (dec. 373, 403): servico regulamentado vinculado ao profissional. Sem a funcao de #51, fail closed.
create or replace function private.verification_reg_gate(p_professional uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if not exists (
       select 1 from app.professional_service ps
         join app.service s on s.id = ps.service_id
        where ps.professional_id = p_professional and s.regulated) then
    return 'sem_reg';
  end if;
  if to_regprocedure('private.certificacoes_completas(uuid)') is null then
    return 'incompletas';
  end if;
  execute 'select private.certificacoes_completas($1)' into v_ok using p_professional;
  return case when coalesce(v_ok, false) then 'completas' else 'incompletas' end;
end
$$;
```

E no momento da decisão da Verificação (`20261113200000_verification_create_case_queue.sql:566-568`):

```sql
  if p_decision = 'aprovada' then
    ...
    if private.verification_reg_gate(v_case.professional_id) = 'incompletas' then
      raise exception 'certificacao_pendente' using errcode = 'VRF05';
    end if;
  end if;
```

### 11.2 Especificação formal do contrato a ser entregue por #51

Para que o gate funcione de forma aberta quando as certificações estiverem em conformidade, a #51 deve entregar exatamente a seguinte função no banco de dados:

- **Nome e esquema:** `private.certificacoes_completas`
- **Assinatura:** `(p_professional uuid)`
- **Tipo de retorno:** `boolean`
- **Propriedades da função:**
  - `language plpgsql` (ou `language sql`);
  - `stable`;
  - `security definer`;
  - `set search_path = ''`;
  - Privilégios: executável por `app_system` (e sem concessão a `anon` ou `authenticated`).
- **Semântica exata de retorno:**
  - **`true`:** Se para TODOS os serviços vinculados ao profissional (`app.professional_service ps join app.service s on s.id = ps.service_id where ps.professional_id = p_professional and s.regulated = true`), existir pelo menos uma linha correspondente em `app.identity_document` com:
    - `professional_id = p_professional`
    - `service_id = s.id`
    - `kind = 'certificacao'`
    - `status = 'recebido'`
    *(Se o profissional não tiver nenhum serviço regulamentado ativo, a função também deve retornar `true`).*
  - **`false`:** Se existir qualquer serviço regulamentado ativo vinculado ao profissional que NÃO possua documento em `app.identity_document` com `kind = 'certificacao'`, `service_id = s.id` e `status = 'recebido'`.

Quando a função retornar `true`, `verification_reg_gate` retorna `'completas'` e a aprovação é concluída com sucesso. Quando retornar `false`, `verification_reg_gate` retorna `'incompletas'` e a aprovação é recusada com a exceção `certificacao_pendente` (`VRF05`).

---

## 12. Próximos passos e conclusão sobre início do Desenvolvimento

1. **Aprovação do Reexame:** O líder avalia este documento de reexame (`140-REFINO-H038-REEXAME.md`) e consolida a conclusão da etapa de Product Owner no WF-03.
2. **Movimentação para Arquitetura:** O cartão da Issue #51 avança para a coluna **Arquitetura**.
3. **Elaboração do Desenho Técnico:** A Arquitetura produzirá `docs/factory/144-DESENHO-H038.md` (ou próximo número sequencial vago), detalhando:
   - A migração SQL aditiva sobre `app.identity_document` e a criação de `private.certificacoes_completas(uuid)`;
   - A reserva do prefixo de migração sequencial (maior que os já alocados, e.g. superior a `20261113410000`);
   - Os contratos de rota e extensões em `apps/api/src/identity-docs/` e `packages/domain/src/identity-docs/`.
4. **Início do Desenvolvimento:**
   - **O Desenvolvimento PODE começar agora?**
   - **Sim, sob a ótica de dependências técnicas e de banco:** Não há nenhum impedimento externo. As histórias bloqueantes (#50 e #52) estão concluídas, a tabela e os buckets existem no ambiente de desenvolvimento, e o gate de integração da #52 está pronto aguardando a função.
   - **Sob a governança do workflow (WF-03):** O Desenvolvimento de código e migração se iniciará imediatamente após a conclusão da etapa de Arquitetura, respeitando o fluxo padrão da fábrica.

---

## 13. Registro

- **Arquivo produzido:** `docs/factory/140-REFINO-H038-REEXAME.md`
- **Operação estrita:** Nenhum código, migração, teste ou linha de quadro foi alterada. O status no quadro permanece sob gestão exclusiva do líder/Orquestrador.
