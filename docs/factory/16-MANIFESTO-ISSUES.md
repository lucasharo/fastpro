# FastPro — Manifesto proposto de Issues (NÃO CRIADAS)

- **Etapa:** planning · **Data:** 2026-11-10 · **Papel:** Backlog Architect · **Status:** proposta para o Gate 2 (não executada)
- **Natureza:** este arquivo é apenas documento. **Nenhuma Issue, Project, label, milestone, repositório ou branch foi criado.** Nenhuma chamada ao GitHub foi feita. O número `#` da Issue só existirá após criação pelo Orquestrador, no Gate 2, com a URL conferida.
- **Fonte:** cada entrada corresponde a uma história de `14-BACKLOG.md` (H-xxx) ou a um spike (S-xx). O corpo é curto; o detalhe (critérios, riscos, testes) fica no backlog.
- **Quando criar:** somente no Gate 2, após autorização explícita (SD-14) e após o repositório estar definido (owner, nome e visibilidade, ainda não informados).

## Convenções proposta

**Título:** `[Épico] Verbo + objeto` (ex.: `[E6] Aceitar trabalho com idempotência`). Sem dado real, sem e-mail, sem CPF.

**Labels (a criar no Gate 2):**
- `epic:E0` … `epic:E15`
- `wave:0` … `wave:6`, e `wave:gate-M4` para o gate de lançamento
- `size:P`, `size:M`, `size:G` [PROPOSTA]
- `type:feature`, `type:spike`, `type:infra`, `type:gate`, `type:legal`
- `block:juridico-L1` … `block:juridico-L7`, `block:execucao` (SD-14), `block:decisao`, `block:spike`, quando aplicável

**Corpo (modelo):**
```
Objetivo: <1 frase>
Refs: <RF / FA / ADR / I-xx / decisão>
Dependências: <IDs>
Testes: <IDs de 11-ARQ ou FA>
Bloqueio: <se houver>
```

**Regras:** um item por história. Histórias bloqueadas entram com a label `block:*` e não entram em milestone de execução. Nenhuma Issue sem FA, RF ou decisão de origem.

---

## 1. Spikes (Onda 0 e seguintes)

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 1 | S-02 | [Spike] PostGIS, pg_cron e pg_net no Supabase Free | `type:spike`, `wave:0`, `block:execucao` | — | Objetivo: decidir geo e tick. Refs: ADR-008, ADR-018, R-38. Testes: resultado registrado |
| 2 | S-01 | [Spike] Sessão Supabase para usuário verificado pelo desafio | `type:spike`, `wave:0`, `block:execucao` | — | Objetivo: confirmar ADR-005. Refs: D8, RF-038. Testes: prova de sessão de 7 dias |
| 3 | S-03 | [Spike] Mercado Pago: tarifas, recorrência, Pix e webhook | `type:spike`, `wave:0`, `block:execucao` | — | Objetivo: matriz de capacidades. Refs: ADR-007, R-06. Testes: sandbox e x-signature |
| 4 | S-04 | [Spike] Mapbox: termos de produto e armazenamento | `type:spike`, `wave:0` | — | Objetivo: parecer sobre permanent=true. Refs: ADR-008, decisão 29. Testes: parecer registrado |
| 5 | S-09 | [Spike] NestJS como função única na Vercel | `type:spike`, `wave:0`, `block:execucao` | — | Objetivo: cold start e pool. Refs: ADR-018, R-29. Testes: Q-05, Q-08 |
| 6 | S-10 | [Spike] Tick de jobs: escolha A, B ou C | `type:spike`, `wave:0` | S-02 | Objetivo: escolher mecanismo de tick. Refs: R-30. Testes: Q-14 |
| 7 | S-11 | [Spike] Resend: domínio, bounce e cota | `type:spike`, `wave:0`, `block:execucao` | — | Objetivo: parecer de execução. Refs: decisão 15, R-33. Testes: N-09, N-10 |
| 8 | S-06 | [Spike] Memória e tempo do reencode de fotos | `type:spike`, `wave:0` | — | Objetivo: limites de função. Refs: R-11, R-31. Testes: P-03, F-11 |
| 9 | S-05 | [Spike] Realtime: canais privados e limites | `type:spike`, `wave:1` | — | Objetivo: viabilidade do sinal. Refs: ADR-010. Testes: F-06 |
| 10 | S-08 | [Spike] Verificação oficial dos limites gratuitos | `type:spike`, `wave:contínuo` | — | Objetivo: tabela verificada. Refs: ADR-020. Testes: —  |
| 11 | S-07 | [Spike] Regras das lojas (login social, IAP, exclusão) | `type:spike`, `wave:6`, `block:juridico-L6` | — | Objetivo: parecer para mobile. Refs: ADR-006, ADR-019 |

---

## 2. Épico E0 — Fundação

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 12 | H-001 | [E0] Monorepo pnpm e Turborepo | `epic:E0`, `wave:0`, `size:P`, `type:infra` | — | Objetivo: estrutura de apps e packages. Refs: ADR-001, ADR-017. Testes: build e lint |
| 13 | H-002 | [E0] Tokens EDS sem cor hardcoded | `epic:E0`, `wave:0`, `size:M`, `type:feature` | H-001 | Objetivo: tokens únicos. Refs: RF-160, FA-033. Testes: varredura de hex |
| 14 | H-003 | [E0] Ambiente local e migrações versionadas | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-001, S-02 | Objetivo: Supabase CLI e pgTAP. Refs: ADR-017. Testes: T-05 |
| 15 | H-004 | [E0] CI gratuito com varreduras | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-001, H-003 | Objetivo: lint, testes e segredos. Refs: T-13, T-14 |
| 16 | H-005 | [E0] Outbox, jobs, idempotência e config | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-003 | Objetivo: esqueleto transversal. Refs: P6, P7. Testes: C-14, F-03, I-21 |
| 17 | H-006 | [E0] Auditoria append-only | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-003 | Objetivo: trilha na mesma transação. Refs: I-15, RF-154. Testes: I-15 |
| 18 | H-007 | [E0] Logs sem PII e varredura | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-001 | Objetivo: allowlist de log. Refs: P8, ADR-013. Testes: T-11 |
| 19 | H-008 | [E0] Tick de jobs (A, B ou C) | `epic:E0`, `wave:0`, `size:M`, `type:infra` | H-005, S-02, S-10 | Objetivo: jobs sem cron pago. Refs: ADR-018, R-30. Testes: Q-14, F-08 |
| 20 | H-009 | [E0] Hospedagem Vercel (web, API e admin) | `epic:E0`, `wave:0`, `size:M`, `type:infra`, `block:execucao` | H-001, S-09 | Objetivo: função única e origem comum. Refs: ADR-018, decisão 28. Testes: healthcheck |
| 21 | H-010 | [E0] Keep-alive e backup manual | `epic:E0`, `wave:0`, `size:P`, `type:infra` | H-003 | Objetivo: procedimento de backup. Refs: ADR-020, R-08. Testes: D-01 (ver H-119). Decisão: periodicidade (BK-7) |

## 3. Épico E1 — Identidade e sessão

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 22 | H-011 | [E1] Desafio de acesso do cliente | `epic:E1`, `wave:1`, `size:G`, `type:feature` | H-005, S-01, H-093 | Objetivo: link e código com resposta uniforme. Refs: RF-035 a RF-039, D8. Testes: T-01 |
| 23 | H-012 | [E1] Consumo do link por POST | `epic:E1`, `wave:1`, `size:M`, `type:feature` | H-011 | Objetivo: GET sem efeito. Refs: D8, R-15. Testes: T-01 |
| 24 | H-013 | [E1] Código de 6 dígitos e nonce | `epic:E1`, `wave:1`, `size:M`, `type:feature` | H-011, H-025 | Objetivo: fallback e vínculo ao navegador. Refs: RF-037. Testes: T-01 |
| 25 | H-014 | [E1] Sessão de 7 dias e step-up | `epic:E1`, `wave:1`, `size:M`, `type:feature` | H-011, S-01 | Objetivo: sessão revogável. Refs: RF-038, AMB-13. Testes: T-01, T-02 |
| 26 | H-015 | [E1] Anti-enumeração e limites | `epic:E1`, `wave:1`, `size:P`, `type:feature` | H-005, H-011 | Objetivo: 429 e respostas iguais. Refs: RF-039, RF-040. Testes: T-12 |
| 27 | H-016 | [E1] Cadastro e login do profissional | `epic:E1`, `wave:1`, `size:M`, `type:feature` | H-003, S-11 | Objetivo: Supabase Auth com e-mail verificado. Refs: RF-045, ADR-006. Testes: T-04 |
| 28 | H-017 | [E1] Exclusividade de papéis | `epic:E1`, `wave:1`, `size:P`, `type:feature` | H-016, H-011 | Objetivo: um app_user, sem auto-aceite. Refs: I-19. Testes: I-19 |

## 4. Épico E2 — Catálogo e geo

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 29 | H-018 | [E2] Catálogo com seed de 25 grupos [PROPOSTA] | `epic:E2`, `wave:1`, `size:M`, `type:feature` | H-003 | Objetivo: catálogo navegável. Refs: RF-001, RF-003, 06. Testes: FA-001. Decisão: BK-9 |
| 30 | H-019 | [E2] Autocomplete de serviço e sinônimos | `epic:E2`, `wave:1`, `size:M`, `type:feature` | H-018 | Objetivo: busca sem acento. Refs: RF-002, FA-001. Testes: FA-001 |
| 31 | H-020 | [E2] Autocomplete de endereço Mapbox temporário | `epic:E2`, `wave:2`, `size:M`, `type:feature`, `block:execucao` | H-009, S-04 | Objetivo: sugestões sem persistir. Refs: decisão 29, G-01. Testes: G-01, F-05 |
| 32 | H-021 | [E2] Coordenada permanente (uma chamada) | `epic:E2`, `wave:2`, `size:M`, `type:feature`, `block:execucao`, `block:decisao` | H-020, H-005, S-04 | Objetivo: permanent=true só ao persistir. Refs: I-28, R-36. Testes: G-02 a G-06. Decisão: BK-2 |
| 33 | H-022 | [E2] Célula generalizada e match_point | `epic:E2`, `wave:2`, `size:M`, `type:feature`, `block:spike` | H-021, S-02 | Objetivo: ponto que não expõe endereço. Refs: RF-013, ADR-008. Testes: T-03, G-02 |
| 34 | H-023 | [E2] Descoberta por raio e online nacional | `epic:E2`, `wave:2`, `size:M`, `type:feature` | H-022, H-036 | Objetivo: 5 a 100 km; online sem raio. Refs: RF-004, RF-051, RF-065. Testes: FA-010 |
| 35 | H-024 | [E2] Cobertura booleana sem contagem | `epic:E2`, `wave:2`, `size:P`, `type:feature`, `block:decisao` | H-023 | Objetivo: com ou sem cobertura. Refs: RF-020, AMB-03. Testes: T-12. Decisão: BK-5 |

## 5. Épico E3 — Pedido, fotos e cliente

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 36 | H-025 | [E3] Rascunho de pedido sem conta | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-018, H-019, H-020 | Objetivo: pedido sem senha. Refs: RF-010 a RF-012, RF-019. Testes: FA-001 |
| 37 | H-026 | [E3] Upload de fotos em quarentena | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-025, H-005 | Objetivo: até 5 fotos, 6ª recusada. Refs: RF-025, RF-025a, I-29. Testes: P-01, P-02, F-09 |
| 38 | H-027 | [E3] Redução e reencode das fotos | `epic:E3`, `wave:2`, `size:G`, `type:feature`, `block:spike` | H-026, S-06 | Objetivo: ≈ 0,5 MB e ≤ 1.280 px. Refs: RF-025, decisões 30–31. Testes: P-03, P-04, P-06 |
| 39 | H-028 | [E3] Remoção de EXIF e tipo por conteúdo | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-027 | Objetivo: sem GPS, tipo verificado. Refs: RF-027. Testes: T-07 |
| 40 | H-029 | [E3] Pré-visualização e reordenação de fotos | `epic:E3`, `wave:2`, `size:P`, `type:feature` | H-026 | Objetivo: preview, excluir, reordenar. Refs: RF-026, RF-162. Testes: FA-034 |
| 41 | H-030 | [E3] Revisão e confirmação expressa | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-025, H-021, H-024 | Objetivo: sem publicação automática; aviso de duplicidade. Refs: RF-014, AMB-01. Testes: FA-002 |
| 42 | H-031 | [E3] Publicação idempotente com 7 dias | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-030, H-012, H-015 | Objetivo: novo ID, prazo imutável. Refs: RF-012, RF-015, RF-021, I-07. Testes: FA-002, I-07 |
| 43 | H-032 | [E3] Visibilidade de localização | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-022, H-031 | Objetivo: ponto generalizado; sem endereço exato. Refs: RF-013, RF-136, I-16. Testes: T-02, T-03 |
| 44 | H-033 | [E3] Opt-in de telefone no pedido | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-025 | Objetivo: checkbox desmarcado. Refs: RF-016, RF-017, AMB-17. Testes: FA-030 |
| 45 | H-034 | [E3] Painel do cliente na sessão do dono | `epic:E3`, `wave:2`, `size:M`, `type:feature` | H-031, H-014 | Objetivo: pedidos e estados sem contadores. Refs: RF-018, RF-038. Testes: FA-010, T-02 |

## 6. Épico E4 — Verificação e perfil profissional

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 46 | H-035 | [E4] Cadastro profissional com CPF/CNPJ cifrado | `epic:E4`, `wave:2`, `size:M`, `type:feature` | H-016, H-003 | Objetivo: documento cifrado e HMAC único. Refs: RF-046. Testes: T-11, T-13 |
| 47 | H-036 | [E4] Perfil: serviços, base e raio | `epic:E4`, `wave:2`, `size:M`, `type:feature`, `block:execucao` | H-035, H-021, H-018 | Objetivo: raio de 5 a 100 km. Refs: RF-051, AMB-15, G-07. Testes: G-07 |
| 48 | H-037 | [E4] Documentos de identidade | `epic:E4`, `wave:2`, `size:M`, `type:feature`, `block:decisao` | H-026, H-016, S-06 | Objetivo: imagem e PDF, provisório. Refs: RF-046, RF-052, decisão 34. Testes: T-07. Decisão: BK-1 |
| 49 | H-038 | [E4] Certificações para atividades regulamentadas | `epic:E4`, `wave:2`, `size:M`, `type:feature`, `block:juridico-L4` | H-018, H-037 | Objetivo: anexo obrigatório. Refs: RF-047. Testes: FA-004 |
| 50 | H-039 | [E4] Fila de verificação | `epic:E4`, `wave:2`, `size:G`, `type:feature` | H-037, H-006, H-102 | Objetivo: decidir, explicar, recurso. Refs: RF-047 a RF-049, RF-147. Testes: FA-004, T-08 |
| 51 | H-040 | [E4] Retenção por duplicidade | `epic:E4`, `wave:2`, `size:M`, `type:feature` | H-035, H-039 | Objetivo: sem bloqueio automático. Refs: RF-049, I-02. Testes: FA-004 |
| 52 | H-041 | [E4] Estado da verificação visível | `epic:E4`, `wave:2`, `size:P`, `type:feature` | H-039 | Objetivo: motivo e recurso. Refs: RF-053. Testes: FA-004 |
| 53 | H-042 | [E4] Guarda de elegibilidade na API e no banco | `epic:E4`, `wave:2`, `size:M`, `type:feature` | H-039, H-045 | Objetivo: não aprovado não aceita. Refs: RF-050. Testes: T-04, T-06 |
| 54 | H-043 | [E4] Perfil público e selo "verificado" | `epic:E4`, `wave:2`, `size:P`, `type:feature`, `block:juridico-L7` | H-036, H-039 | Objetivo: selo sem promessa de qualidade. Refs: RF-005, RF-006. Testes: FA-019 |

## 7. Épico E5 — Assinaturas e trial

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 55 | H-044 | [E5] Trial de 14 dias | `epic:E5`, `wave:3`, `size:M`, `type:feature` | H-039, H-045 | Objetivo: ativação pelo profissional, sem cobrança. Refs: RF-057, AMB-09. Testes: FA-005, B-07 |
| 56 | H-045 | [E5] Acesso comercial derivado | `epic:E5`, `wave:3`, `size:G`, `type:feature` | H-005, H-017 | Objetivo: função commercial_access. Refs: P4, I-20, I-25. Testes: B-01 a B-08 |
| 57 | H-046 | [E5] Planos e preços em centavos | `epic:E5`, `wave:4`, `size:P`, `type:feature` | H-045 | Objetivo: 2990, 8070, 14940, 23880. Refs: RF-055, RF-056. Testes: FA-006 |
| 58 | H-047 | [E5] Checkout Mercado Pago (Pix e cartão) | `epic:E5`, `wave:4`, `size:G`, `type:feature`, `block:execucao`, `block:decisao` | H-046, H-005, S-03 | Objetivo: sem boleto; sandbox em dev. Refs: RF-058, ADR-007. Testes: B-09. Decisão: BK-3 |
| 59 | H-048 | [E5] Webhook MP idempotente | `epic:E5`, `wave:4`, `size:G`, `type:feature`, `block:spike` | H-047, S-03 | Objetivo: consulta ao recurso, sem regressão. Refs: RF-060, I-20. Testes: C-11, B-05 |
| 60 | H-049 | [E5] Concessão paga e início de período | `epic:E5`, `wave:4`, `size:M`, `type:feature` | H-048, H-045 | Objetivo: sem lacuna dentro da carência. Refs: RF-059, SD-16. Testes: B-03, B-04, B-10 |
| 61 | H-050 | [E5] Carência de 72 h | `epic:E5`, `wave:4`, `size:M`, `type:feature` | H-049 | Objetivo: cartão e Pix; trial sem carência. Refs: RF-059, H5. Testes: B-01, B-02, B-06, B-07 |
| 62 | H-051 | [E5] Adesão ao cartão e Pix manual | `epic:E5`, `wave:4`, `size:M`, `type:feature` | H-047 | Objetivo: sem renovação sem adesão. Refs: RF-058. Testes: FA-006 |
| 63 | H-052 | [E5] Cancelamento com acesso até o fim | `epic:E5`, `wave:4`, `size:P`, `type:feature` | H-049, H-050 | Objetivo: cancel_at_period_end. Refs: RF-061. Testes: B-08 |
| 64 | H-053 | [E5] Reconciliação diária MP × livro | `epic:E5`, `wave:4`, `size:M`, `type:feature` | H-048, H-005, H-008 | Objetivo: relatório, sem correção automática. Refs: 08 §8.8. Testes: T-09 |
| 65 | H-054 | [E5] Gate de cobrança real | `epic:E5`, `wave:gate-M4`, `size:P`, `type:gate`, `block:decisao`, `block:juridico-L1`, `block:juridico-L4`, `block:juridico-L7` | H-009, H-010, H-047, H-048 | Objetivo: checklist de cobrança. Refs: decisões 28, 29; ADR-020. Testes: checklist |

## 8. Épico E6 — Distribuição e aceites

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 66 | H-055 | [E6] Descoberta de pedidos elegíveis | `epic:E6`, `wave:3`, `size:M`, `type:feature` | H-023, H-042, H-045 | Objetivo: lista sem dado pessoal. Refs: RF-065, RF-137, FA-025. Testes: FA-007, T-03 |
| 67 | H-056 | [E6] Fotos a elegíveis com marca d'água | `epic:E6`, `wave:3`, `size:G`, `type:feature`, `block:spike` | H-027, H-055, S-06 | Objetivo: URL de 60 s e marca do profissional. Refs: RF-029, RF-030, D10. Testes: P-05, Q-13 |
| 68 | H-057 | [E6] Limite de visualização e sinal de raspagem | `epic:E6`, `wave:3`, `size:M`, `type:feature` | H-056, H-005 | Objetivo: 429 e log por profissional. Refs: RF-030, RF-031. Testes: T-12 |
| 69 | H-058 | [E6] Aceitar trabalho idempotente | `epic:E6`, `wave:3`, `size:G`, `type:feature` | H-055, H-064, H-005, H-017, H-044 | Objetivo: aceite com conversa e mensagem no mesmo COMMIT. Refs: RF-069, RF-070, RF-075, I-02, I-03. Testes: C-03, C-16, F-01, F-10 |
| 70 | H-059 | [E6] Vagas 4+4 e teto de 8 | `epic:E6`, `wave:3`, `size:M`, `type:feature`, `block:decisao` | H-058 | Objetivo: slots 1 a 8, sem contadores. Refs: RF-066, RF-071, I-01. Testes: C-01, C-02. Decisão: BK-5 |
| 71 | H-060 | [E6] Botão "Chamar mais profissionais" | `epic:E6`, `wave:3`, `size:M`, `type:feature` | H-059 | Objetivo: segunda onda uma vez. Refs: RF-067, RF-068, RF-076, I-06. Testes: C-04, C-04b |
| 72 | H-061 | [E6] Retirada do aceite | `epic:E6`, `wave:3`, `size:M`, `type:feature` | H-058, H-065 | Objetivo: vaga consumida, sem reaceite. Refs: RF-077, I-22. Testes: C-17, C-18 |
| 73 | H-062 | [E6] Encerramento de aceites | `epic:E6`, `wave:3`, `size:M`, `type:feature` | H-031, H-058 | Objetivo: 7 dias, seleção ou cancelamento. Refs: RF-072, RF-073, I-05, I-17. Testes: C-06 |
| 74 | H-063 | [E6] Aviso "apenas conecta" nos termos | `epic:E6`, `wave:3`, `size:P`, `type:feature`, `block:juridico-L2`, `block:juridico-L7` | H-058, H-113 | Objetivo: aviso fora do botão. Refs: RF-078, decisão 22. Testes: FA-011 |
| 75 | H-064 | [E6] Aceite sem campos de conteúdo | `epic:E6`, `wave:3`, `size:P`, `type:feature` | H-058 | Objetivo: 422 para campos extras. Refs: RF-070, I-26. Testes: T-16, T-17 |

## 9. Épico E7 — Chat, somente texto

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 76 | H-065 | [E7] Conversa criada no aceite | `epic:E7`, `wave:3`, `size:M`, `type:feature` | H-058 | Objetivo: um chat por par. Refs: RF-100, RF-106, I-12. Testes: FA-009, T-02 |
| 77 | H-066 | [E7] Mensagens de texto idempotentes | `epic:E7`, `wave:3`, `size:M`, `type:feature` | H-065 | Objetivo: sem edição; reenvio sem duplicar. Refs: RF-101, RF-103, RF-105, I-13. Testes: C-12, C-18 |
| 78 | H-067 | [E7] Bloqueio de anexos no chat | `epic:E7`, `wave:3`, `size:P`, `type:feature` | H-066 | Objetivo: API e UI sem anexo. Refs: RF-101, RF-102, decisão 33, I-30. Testes: M-01, M-02 |
| 79 | H-068 | [E7] Mensagem automática do aceite | `epic:E7`, `wave:3`, `size:M`, `type:feature` | H-058, H-065 | Objetivo: "Estou disponível para trabalhar" como aviso do sistema. Refs: RF-075, decisões 14 e 26. Testes: C-16 |
| 80 | H-069 | [E7] Arquivar conversa | `epic:E7`, `wave:3`, `size:P`, `type:feature` | H-065 | Objetivo: preferência individual. Refs: RF-104. Testes: FA-026 |
| 81 | H-070 | [E7] Realtime como sinal com polling | `epic:E7`, `wave:3`, `size:M`, `type:feature`, `block:spike` | H-066, S-05 | Objetivo: IDs no canal; polling de contingência. Refs: ADR-010. Testes: F-06 |
| 82 | H-071 | [E7] Denúncia e bloqueio | `epic:E7`, `wave:3`, `size:M`, `type:feature` | H-066, H-102 | Objetivo: caso de moderação. Refs: RF-107, RF-102. Testes: T-10 |
| 83 | H-072 | [E7] Restrição de segurança e rate limit | `epic:E7`, `wave:3`, `size:P`, `type:feature` | H-065, H-005 | Objetivo: restrita nega envio. Refs: RF-031, RF-108. Testes: FA-027 |
| 84 | H-073 | [E7] Acesso excepcional a conversa | `epic:E7`, `wave:3`, `size:M`, `type:feature` | H-102, H-006 | Objetivo: caso autorizado e log. Refs: RF-148. Testes: FA-031, T-08 |

## 10. Épico E8 — Seleção, conclusão e cancelamento

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 85 | H-074 | [E8] Selecionar participante | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-058, H-062, H-014 | Objetivo: uma seleção ativa. Refs: RF-080, RF-082, I-04. Testes: C-05, FA-013 |
| 86 | H-075 | [E8] Encerrar aceites ao selecionar | `epic:E8`, `wave:4`, `size:P`, `type:feature` | H-074 | Objetivo: conversas seguem ativas. Refs: RF-081. Testes: FA-014 |
| 87 | H-076 | [E8] Trocar selecionado | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-074, H-006 | Objetivo: só entre participantes prévios. Refs: RF-083. Testes: FA-015 |
| 88 | H-077 | [E8] Cancelar com confirmação | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-074, H-065 | Objetivo: conversas somente leitura. Refs: RF-086. Testes: FA-016 |
| 89 | H-078 | [E8] Concluir pelo cliente | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-074 | Objetivo: conclusão única. Refs: RF-084, I-08. Testes: C-07 |
| 90 | H-079 | [E8] Correção em 24 h | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-078, H-006 | Objetivo: limite inclusivo. Refs: RF-085, RF-150, AMB-11. Testes: C-07, FA-018 |
| 91 | H-080 | [E8] Desistência do selecionado | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-074, H-077 | Objetivo: sem troca automática. Refs: RF-087. Testes: FA-024 |
| 92 | H-081 | [E8] Confirmações com versão e lock | `epic:E8`, `wave:4`, `size:M`, `type:feature` | H-005, H-074 | Objetivo: 409 em estado mudado. Refs: RF-088, §7.1. Testes: C-15, F-02 |

## 11. Épico E9 — Republicação

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 93 | H-082 | [E9] Republicar pedido | `epic:E9`, `wave:4`, `size:M`, `type:feature`, `block:decisao` | H-031, H-077 | Objetivo: pedido novo na cadeia. Refs: RF-090, RF-017. Testes: FA-021. Decisão: BK-4 |
| 94 | H-083 | [E9] Uma republicação ativa por cadeia | `epic:E9`, `wave:4`, `size:M`, `type:feature` | H-082 | Objetivo: índice parcial. Refs: RF-091, I-10. Testes: C-09 |
| 95 | H-084 | [E9] Selecionar no original com republicação | `epic:E9`, `wave:4`, `size:G`, `type:feature` | H-083, H-074, H-081 | Objetivo: operação atômica. Refs: RF-093, I-11. Testes: C-10, F-02 |
| 96 | H-085 | [E9] Casos extremos da cadeia | `epic:E9`, `wave:4`, `size:M`, `type:feature` | H-083, H-079 | Objetivo: regra AMB-02 A. Refs: RF-094, RF-092. Testes: FA-022 |

## 12. Épico E10 — Avaliações

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 97 | H-086 | [E10] Avaliação do selecionado | `epic:E10`, `wave:5`, `size:M`, `type:feature` | H-078 | Objetivo: nota 1 a 5, uma por pedido. Refs: RF-125, I-09. Testes: C-08 |
| 98 | H-087 | [E10] Antifraude e publicação automática | `epic:E10`, `wave:5`, `size:G`, `type:feature` | H-086 | Objetivo: AMB-12 B e A. Refs: RF-126, D4. Testes: FA-019, T-10 |
| 99 | H-088 | [E10] Edição, autor fixo e média | `epic:E10`, `wave:5`, `size:M`, `type:feature` | H-086, H-087 | Objetivo: 7 dias de edição; média com 1 casa. Refs: RF-128 a RF-130. Testes: FA-019 |
| 100 | H-089 | [E10] Resposta e contestação do profissional | `epic:E10`, `wave:5`, `size:P`, `type:feature` | H-088 | Objetivo: resposta única. Refs: RF-131. Testes: FA-019 |
| 101 | H-090 | [E10] Moderação humana por denúncia | `epic:E10`, `wave:5`, `size:M`, `type:feature` | H-102, H-006, H-088 | Objetivo: decisão fundamentada e recurso. Refs: RF-132, RF-149. Testes: FA-031 |
| 102 | H-091 | [E10] Avaliação sem prazo comercial | `epic:E10`, `wave:5`, `size:M`, `type:feature`, `block:juridico-L1` | H-086, H-079 | Objetivo: revisão de validade. Refs: RF-127, RF-133. Testes: FA-020 |

## 13. Épico E11 — Notificações

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 103 | H-092 | [E11] Pipeline de notificações e cooldown | `epic:E11`, `wave:1`, `size:G`, `type:feature` | H-005, H-008 | Objetivo: evento → item → outbox. Refs: RF-115 a RF-117, ADR-011. Testes: N-02, N-03, C-13 |
| 104 | H-093 | [E11] EmailProviderPort: Mailpit e Resend | `epic:E11`, `wave:1`, `size:M`, `type:feature`, `block:execucao` | H-003, H-092, S-11 | Objetivo: dev no Mailpit; Resend só com domínio. Refs: I-27, decisão 15. Testes: N-09, N-10 |
| 105 | H-094 | [E11] Cota do Resend | `epic:E11`, `wave:4`, `size:G`, `type:feature` | H-092, H-093 | Objetivo: contador, alertas e reserva para login. Refs: RNF-EMAIL, I-24, R-34. Testes: Q-01, Q-10, Q-11 |
| 106 | H-095 | [E11] E-mail de aviso de aceite | `epic:E11`, `wave:3`, `size:M`, `type:feature` | H-092, H-068 | Objetivo: imediato e agrupado; sem backfill. Refs: RF-115, RF-122, I-23. Testes: N-01, N-02 |
| 107 | H-096 | [E11] E-mail de mensagem não lida | `epic:E11`, `wave:4`, `size:M`, `type:feature` | H-092, H-066 | Objetivo: primeira imediata, demais agrupadas. Refs: RF-116. Testes: N-03 |
| 108 | H-097 | [E11] E-mail de login com prioridade | `epic:E11`, `wave:4`, `size:M`, `type:feature` | H-011, H-093, H-094 | Objetivo: síncrono, prioridade máxima. Refs: RF-041. Testes: N-05, F-12 |
| 109 | H-098 | [E11] E-mails de seleção, cancelamento e desistência | `epic:E11`, `wave:4`, `size:M`, `type:feature` | H-092, H-093, H-077 | Objetivo: sem dado sensível; recheque de estado. Refs: RF-118, RF-120. Testes: N-04, N-06 |
| 110 | H-099 | [E11] Lembretes de prazo, trial e ciclo | `epic:E11`, `wave:4`, `size:M`, `type:feature`, `block:juridico-L2`, `block:juridico-L3` | H-092, H-008, H-044 | Objetivo: T-24h e vencimento. Refs: RF-064, RF-119. Testes: N-04. Parte de cobrança depende de L2/L3 |
| 111 | H-100 | [E11] Teste de ausência de interruptor | `epic:E11`, `wave:3`, `size:P`, `type:infra` | H-092 | Objetivo: sem flag, rota ou backfill. Refs: RF-122, RF-154, decisão 27. Testes: N-07 |
| 112 | H-101 | [E11] Canal "no site" | `epic:E11`, `wave:3`, `size:P`, `type:feature` | H-068, H-094 | Objetivo: indicador de não lida independente de e-mail. Refs: RF-115, R-27. Testes: Q-01 |

## 14. Épico E12 — Admin, RBAC, auditoria e financeiro

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 113 | H-102 | [E12] RBAC e MFA no admin | `epic:E12`, `wave:1`, `size:G`, `type:feature` | H-003, H-009 | Objetivo: aal2 em todas as rotas admin. Refs: RF-145, ADR-012. Testes: T-08 |
| 114 | H-103 | [E12] Console admin por papel | `epic:E12`, `wave:5`, `size:G`, `type:feature`, `block:decisao` | H-102 | Objetivo: telas por papel. Refs: RF-146, AMB-08. Testes: FA-031. Decisão: BK-11 |
| 115 | H-104 | [E12] Consulta à auditoria pelo Auditor | `epic:E12`, `wave:5`, `size:P`, `type:feature` | H-006, H-102 | Objetivo: somente leitura. Refs: RF-154. Testes: T-08 |
| 116 | H-105 | [E12] Dupla aprovação para estorno e suspensão | `epic:E12`, `wave:5`, `size:M`, `type:feature` | H-102 | Objetivo: R$ 200,00 com uma aprovação. Refs: RF-151, RF-152, I-18. Testes: T-08 |
| 117 | H-106 | [E12] Estorno e chargeback manual | `epic:E12`, `wave:gate-M4`, `size:M`, `type:feature`, `block:juridico-L3` | H-105, H-047 | Objetivo: execução manual. Refs: RF-063. Testes: FA-032 |
| 118 | H-107 | [E12] Gestão de catálogo e promoções | `epic:E12`, `wave:5`, `size:M`, `type:feature` | H-018, H-102 | Objetivo: admin do catálogo. Refs: RF-003, RF-153. Testes: FA-001 |
| 119 | H-108 | [E12] Painel operacional mínimo | `epic:E12`, `wave:5`, `size:M`, `type:feature` | H-092, H-094, H-007 | Objetivo: cotas em %, sem PII. Refs: ADR-013, ADR-020. Testes: Q-02 a Q-04 |

## 15. Épico E13 — LGPD, retenção e observabilidade

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 120 | H-109 | [E13] Mecanismo de retenção sem prazos | `epic:E13`, `wave:5`, `size:G`, `type:feature`, `block:juridico-L1` | H-006, H-005 | Objetivo: política nula = desligada. Refs: ADR-016. Testes: teste de job desligado |
| 121 | H-110 | [E13] Expurgos operacionais | `epic:E13`, `wave:5`, `size:M`, `type:feature` | H-005, H-008, H-109 | Objetivo: TTL técnico. Refs: 09 §10. Testes: Q-04 |
| 122 | H-111 | [E13] Direitos do titular (dsr_case) | `epic:E13`, `wave:gate-M4`, `size:G`, `type:feature`, `block:juridico-L1`, `block:juridico-L2` | H-109 | Objetivo: acesso, correção e eliminação. Refs: RF-140 |
| 123 | H-112 | [E13] Consentimentos e trilha de revelação | `epic:E13`, `wave:5`, `size:M`, `type:feature` | H-033, H-058 | Objetivo: revelar telefone e endereço com registro. Refs: RF-016, RF-138, RF-139. Testes: T-03, FA-030 |
| 124 | H-113 | [E13] Termos, privacidade e DPO | `epic:E13`, `wave:gate-M4`, `size:G`, `type:legal`, `block:juridico-L2`, `block:juridico-L7` | — | Objetivo: textos validados. Refs: RF-078, RF-140, RF-141, SD-11 |
| 125 | H-114 | [E13] Runbook de incidente e reconciliação | `epic:E13`, `wave:5`, `size:M`, `type:infra` | H-010, H-053, H-119 | Objetivo: incidente e pós-restauração. Refs: D-03 a D-09. Testes: D-03, D-04 |

## 16. Épico E15 — Hardening e release

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 126 | H-115 | [E15] Autorização por recurso e paridade | `epic:E15`, `wave:5`, `size:G`, `type:infra` | H-003, H-042, H-055 | Objetivo: testes T-02, T-05, T-06. Refs: ADR-002. Testes: T-02, T-05, T-06 |
| 127 | H-116 | [E15] Testes de injeção e abuso | `epic:E15`, `wave:5`, `size:M`, `type:infra` | H-004 | Objetivo: XSS, CSRF, SSRF. Refs: T-10 |
| 128 | H-117 | [E15] Suíte de concorrência e falha | `epic:E15`, `wave:5`, `size:G`, `type:infra` | H-058, H-059, H-062, H-081, H-084, H-048, H-005 | Objetivo: C-01 a C-18, F-01 a F-12. Refs: 11 §7 e §8, I-01 a I-22 |
| 129 | H-118 | [E15] Acessibilidade WCAG 2.2 AA com evidência | `epic:E15`, `wave:5`, `size:G`, `type:feature`, `block:juridico-L5` | H-002, H-029, H-066 | Objetivo: teclado, leitor, contraste, responsivo. Refs: RF-161, RF-162, RF-164. Testes: FA-034, T-15 |
| 130 | H-119 | [E15] Teste de restauração de backup | `epic:E15`, `wave:5`, `size:M`, `type:infra` | H-010, H-003, H-117 | Objetivo: restauração em ambiente limpo. Refs: 11 §9. Testes: D-01, D-02 |
| 131 | H-120 | [E15] Dados sintéticos de demonstração | `epic:E15`, `wave:5`, `size:P`, `type:infra` | H-018, H-007 | Objetivo: seeds sem dado real. Refs: RF-163. Testes: T-11 |
| 132 | H-121 | [E15] Gate de release do MVP web | `epic:E15`, `wave:gate-M4`, `size:P`, `type:gate`, `block:decisao` | H-117, H-119, H-093, H-054 | Objetivo: checklist; decisão humana. Refs: 11 §11, ADR-020 |

## 17. Épico E14 — Mobile (fase posterior)

| # | ID | Título proposto | Labels | Depende de | Corpo curto |
|---|---|---|---|---|---|
| 133 | H-122 | [E14] App Expo base | `epic:E14`, `wave:6`, `size:G`, `type:feature`, `block:decisao` | H-121, S-07 | Objetivo: app consome contratos. Refs: RF-164, SD-13. Não iniciar antes de SD-13 |
| 134 | H-123 | [E14] Reuso de contratos e tokens no mobile | `epic:E14`, `wave:6`, `size:M`, `type:feature` | H-122 | Objetivo: sem regra de elegibilidade no cliente. Refs: ADR-019 |
| 135 | H-124 | [E14] Assinatura e login no mobile | `epic:E14`, `wave:6`, `size:G`, `type:feature`, `block:juridico-L6`, `block:decisao` | S-07, SD-13 | Objetivo: IAP, login social, exclusão de conta. Refs: ADR-006, ADR-019 |

---

## 18. Totais

| Tipo | Quantidade |
|---|---|
| Spikes (`type:spike`) | 11 |
| Histórias (épicos E0–E15) | 124 |
| Total de entradas | 135 |

Por tamanho [PROPOSTA]: P 23 · M 79 · G 22.

Itens com label `block:*`: contar pela coluna Labels. Não há Issue criada.

## 19. Próximo passo (Gate 2, somente com autorização)

1. Autorização explícita de execução (SD-14) e definição do repositório (owner, nome, visibilidade).
2. Criar labels e milestones conforme as convenções acima.
3. Criar as Issues **somente** das entradas não bloqueadas, na ordem das ondas 0 e 1.
4. Conferir URL e número de cada Issue criada e registrar no backlog. Não inventar número antes da criação.
5. Itens `block:*` ficam sem milestone de execução até a condição ser atendida.
