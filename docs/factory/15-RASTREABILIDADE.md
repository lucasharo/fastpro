# FastPro — Rastreabilidade (FA → RF → história → teste)

- **Etapa:** planning · **Data:** 2026-11-10 · **Papel:** Backlog Architect · **Status:** rascunho para validação do Orquestrador
- **Fontes:** `05-CRITERIOS-ACEITE` (Rev. 6), `04-PRD` (Rev. 6), `14-BACKLOG` (H-001 a H-124), `11-ARQ-RISCOS-E-TESTES` (Rev. 6), `07-AMBIGUIDADES`, `11-DECISOES`.
- **Natureza:** matriz de planejamento. Nenhum teste foi executado. "Cobertura" indica se a história e o teste existem no plano; não indica execução.
- **Legenda de cobertura:** **OK** = história e teste definidos · **PARCIAL** = cobertura planejada, mas depende de texto, decisão ou spike · **BLOQ** = depende de pendência jurídica ou de execução.

---

## 1. Matriz FA → RF → história → teste

Resultado: **35 FA cobertos; nenhum FA sem história.** Contagem: OK 22 · PARCIAL 11 · BLOQ 2 (ver lista abaixo da tabela).

| FA | Tema | RF principais | Histórias | Testes | Cobertura | Observação |
|---|---|---|---|---|---|---|
| FA-001 | Visitante navega e inicia pedido sem senha | RF-001, 002, 010, 011, 012 | H-018, H-019, H-020, H-025, H-026, H-027 | P-01, P-03, G-01 | OK | Autocomplete temporário (H-020) |
| FA-002 | Publicação após identificação, revisão e confirmação | RF-012, 014, 015, 035 | H-011, H-012, H-030, H-031 | I-05, I-07, T-01 | OK | — |
| FA-003 | Link ou código inválido não dá acesso | RF-036 a RF-041 | H-011, H-012, H-013, H-014, H-015, H-097 | T-01, T-12, N-05, F-12 | OK | D8 em H-012 |
| FA-004 | Profissional não aprovado não aceita | RF-046 a RF-050, RF-147 | H-016, H-035, H-037, H-038, H-039, H-040, H-042 | T-04, T-08 | PARCIAL | L4 (verificação de certificação) BLQ-JUR; limites de documento (BK-1) |
| FA-005 | Trial de 14 dias | RF-057, RF-064 | H-044, H-099 | B-07, N-04 | OK | Lembrete de trial sem cobrança (AMB-06, L2/L3) |
| FA-006 | Mercado Pago (Pix e cartão), carência de 72 h, idempotência | RF-055 a RF-061 | H-046 a H-053 | B-01 a B-10, C-11, I-14, I-20, I-25 | PARCIAL | Tarifas MP não obtidas (S-03); sandbox BLQ-EXEC |
| FA-007 | Elegível vê fotos antes de aceitar, sem dados pessoais | RF-013, RF-027, RF-029, RF-030, RF-136 | H-028, H-032, H-055, H-056, H-057 | P-05, T-03, T-07, Q-13 | OK | D10 |
| FA-008 | Sem acesso, sem imagem | RF-028, RF-030, RF-031 | H-026, H-056, H-057 | T-02, T-07 | OK | — |
| FA-009 | Só o participante vê nome e a própria conversa | RF-100, RF-110, RF-136 | H-058, H-065 | T-02, I-12 | OK | — |
| FA-010 | Teto de 8, 4+4, botão da segunda onda | RF-065 a RF-068, RF-071, RF-074, RF-076 | H-023, H-055, H-059, H-060 | C-01, C-02, C-04, C-04b, I-01, I-06 | PARCIAL | Texto "sem vaga" (AMB-04, BK-5) |
| FA-011 | Aceite único, idempotente, sem conteúdo | RF-069, RF-070, RF-075, RF-077, RF-078 | H-058, H-061, H-063, H-064, H-068 | C-03, C-16, C-17, C-18, F-01, F-10, T-16, T-17 | PARCIAL | Redação do aviso (L2, L7) em H-063 |
| FA-012 | Expiração aos 7 dias | RF-072, RF-073, RF-109, RF-119 | H-062, H-099 | C-06, I-05, I-17, N-04 | OK | — |
| FA-013 | Seleção após expiração | RF-080, RF-082 | H-074 | C-05, I-04 | OK | — |
| FA-014 | Seleção encerra aceites e mantém conversas | RF-081 | H-062, H-074, H-075 | C-05 | OK | — |
| FA-015 | Troca de selecionado | RF-083 | H-076 | I-04, T-08 | OK | — |
| FA-016 | Cancelamento | RF-086, RF-118 | H-077, H-098 | C-07, FA-016 | OK | — |
| FA-017 | Conclusão | RF-084 | H-078 | C-07, I-08 | OK | — |
| FA-018 | Correção de conclusão | RF-085, RF-133, RF-150 | H-079, H-091 | C-07 (limite de 24 h) | PARCIAL | AMB-11 A adotado; FA-018 depende de H-091 (L1) para revisão de validade |
| FA-019 | Avaliação | RF-125, RF-126, RF-128 a RF-131 | H-043, H-086 a H-089 | C-08, I-09, T-10 | PARCIAL | D4 e AMB-12 delegados (H-087) |
| FA-020 | Primeira avaliação sem prazo comercial | RF-127 | H-091 | C-08 | BLOQ | **BLQ-JUR L1** (retenção) |
| FA-021 | Republicação | RF-017, RF-090 | H-033, H-082 | FA-021 | OK | — |
| FA-022 | Uma republicação ativa por cadeia | RF-091, RF-092, RF-094 | H-030, H-083, H-085 | C-09 | PARCIAL | SD-09 (BK-4); D6 e D7 delegados |
| FA-023 | Seleção no original com republicação ativa | RF-093 | H-084 | C-10, F-02 | OK | — |
| FA-024 | Desistência sem substituto | RF-087 | H-080 | FA-024 | OK | — |
| FA-025 | Assinatura expirada preserva participação | RF-031, RF-062, RF-109 | H-045, H-055, H-065, H-074 | T-04 | OK | — |
| FA-026 | Mensagens sem edição; arquivar | RF-103, RF-104 | H-066, H-069 | FA-026 | OK | — |
| FA-027 | Chat somente texto, sem anexos | RF-025a, RF-101, RF-102, RF-108 | H-067, H-072 | M-01, M-02 | OK | Decisão 33 |
| FA-028 | Reenvio sem duplicar; conversa somente leitura | RF-105 a RF-107 | H-065, H-066, H-071, H-072 | C-12, C-18 | OK | — |
| FA-029 | Notificações: chat imediato e e-mails habilitados | RF-075, RF-115 a RF-117, RF-120, RF-122 | H-068, H-092 a H-101 | N-01 a N-10, Q-01, Q-10, Q-11 | PARCIAL | Resend exige domínio (BLQ-EXEC, H-093) |
| FA-030 | E-mail nunca; telefone só com consentimento | RF-016, RF-137 a RF-139 | H-032, H-033, H-112 | T-03, I-16 | OK | — |
| FA-031 | Admin sem navegação livre | RF-145 a RF-154 | H-073, H-090, H-102 a H-105 | T-08, I-15 | PARCIAL | Matriz de telas (RF-146, BK-11) |
| FA-032 | Estornos | RF-151, RF-063 | H-105, H-106 | I-18, T-08 | BLOQ | **BLQ-JUR L3** (política) |
| FA-033 | Temas e EDS | RF-160 | H-002, H-118 | Varredura de hex; contraste | PARCIAL | EDS mestre não recebido; tokens pela síntese 04 |
| FA-034 | Acessibilidade | RF-161, RF-162 | H-029, H-118 | T-15 | PARCIAL | Evidência WCAG (L5) |
| FA-035 | Idempotência e falha parcial | RF-060, RF-068, RF-072, RF-088 | H-005, H-048, H-058, H-059, H-081, H-084, H-117 | C-01 a C-18; F-01 a F-12 | OK | — |

**Lista por cobertura:**

- **OK (sem ressalva):** FA-001, FA-002, FA-003, FA-005, FA-007, FA-008, FA-009, FA-012, FA-013, FA-014, FA-015, FA-016, FA-017, FA-021, FA-023, FA-024, FA-025, FA-026, FA-027, FA-028, FA-030, FA-035 (22).
- **PARCIAL:** FA-004, FA-006, FA-010, FA-011, FA-018, FA-019, FA-022, FA-029, FA-031, FA-033, FA-034 (11).
- **BLOQ:** FA-020, FA-032 (2).

Total: 22 + 11 + 2 = **35**. A lista acima prevalece sobre a contagem informal.

---

## 2. Cobertura de RF → histórias

Todos os RF aprovados ou delegados têm história, exceto RF-121 (fora de escopo). IDs ausentes na numeração do PRD (por exemplo RF-022 a RF-024, RF-042 a RF-044, RF-089) não são requisitos; não geram lacuna de cobertura.

| Faixa | RF | Histórias |
|---|---|---|
| M1 Navegação | RF-001 | H-018, H-019, H-043 |
| | RF-002 | H-019 |
| | RF-003 | H-018, H-107 |
| | RF-004 | H-023 |
| | RF-005, RF-006 | H-043 (selo: L7 em H-113) |
| M2 Pedido | RF-010 | H-019, H-020, H-025 |
| | RF-011 | H-025 |
| | RF-012 | H-025, H-031 |
| | RF-013 | H-022, H-032 |
| | RF-014 | H-030 |
| | RF-015 | H-031 |
| | RF-016 | H-033, H-112 |
| | RF-017 | H-033, H-082 |
| | RF-018 | H-034 |
| | RF-019 | H-025 |
| | RF-020 | H-024 |
| | RF-021 | H-015, H-031 |
| M3 Fotos | RF-025 | H-026, H-027 |
| | RF-025a | H-026, H-067 |
| | RF-026 | H-029 |
| | RF-027 | H-028 |
| | RF-028 | H-026, H-056 |
| | RF-029 | H-056 |
| | RF-030 | H-056, H-057 |
| | RF-031 | H-057, H-072 |
| M4 Identidade | RF-035, RF-036 | H-011 |
| | RF-037 | H-012, H-013 |
| | RF-038 | H-014, H-034 |
| | RF-039, RF-040 | H-015 |
| | RF-041 | H-094, H-097 |
| M5 Profissional | RF-045 | H-016 |
| | RF-046 | H-035, H-037 |
| | RF-047 | H-038, H-039 |
| | RF-048 | H-039 |
| | RF-049 | H-040 |
| | RF-050 | H-042 |
| | RF-051 | H-023, H-036 |
| | RF-052 | H-037, H-039 |
| | RF-053 | H-041 |
| M6 Assinatura | RF-055, RF-056 | H-046 |
| | RF-057 | H-044 |
| | RF-058 | H-047, H-051 |
| | RF-059 | H-049, H-050 |
| | RF-060 | H-048 |
| | RF-061 | H-052 |
| | RF-062 | H-045, H-055, H-074 |
| | RF-063 | H-106 (BLQ-JUR L3) |
| | RF-064 | H-099 |
| M7 Aceite | RF-065 | H-023, H-055 |
| | RF-066 | H-059 |
| | RF-067 | H-060 |
| | RF-068 | H-060, H-081 |
| | RF-069 | H-058 |
| | RF-070 | H-058, H-064 |
| | RF-071 | H-059 |
| | RF-072 | H-062 |
| | RF-073 | H-062, H-099 |
| | RF-074 | H-059 |
| | RF-075 | H-058, H-068 |
| | RF-076 | H-060 |
| | RF-077 | H-061 |
| | RF-078 | H-063, H-113 |
| M8 Seleção | RF-080, RF-082 | H-074 |
| | RF-081 | H-075 |
| | RF-083 | H-076 |
| | RF-084 | H-078 |
| | RF-085 | H-079 |
| | RF-086 | H-077 |
| | RF-087 | H-080 |
| | RF-088 | H-081, H-117 |
| M9 Republicação | RF-090 | H-082 |
| | RF-091 | H-083 |
| | RF-092 | H-030, H-085 |
| | RF-093 | H-084 |
| | RF-094 | H-085 |
| M10 Chat | RF-100 | H-065 |
| | RF-101 | H-066, H-067 |
| | RF-102 | H-067 |
| | RF-103 | H-066 |
| | RF-104 | H-069 |
| | RF-105 | H-066 |
| | RF-106 | H-065, H-066 |
| | RF-107 | H-066, H-071 |
| | RF-108 | H-072 |
| | RF-109 | H-065 |
| | RF-110 | H-058, H-065 |
| M11 Notificações | RF-115 | H-068, H-095, H-101 |
| | RF-116 | H-096 |
| | RF-117 | H-092 |
| | RF-118 | H-077, H-098 |
| | RF-119 | H-062, H-099 |
| | RF-120 | H-095, H-098 |
| | RF-121 | **Fora de escopo (sem história, intencional)** |
| | RF-122 | H-094, H-095, H-100 |
| M12 Avaliações | RF-125 | H-086 |
| | RF-126 | H-087 |
| | RF-127 | H-091 |
| | RF-128 a RF-130 | H-088 (RF-130 também H-043) |
| | RF-131 | H-089 |
| | RF-132 | H-090 |
| | RF-133 | H-079, H-091 |
| M13 Privacidade | RF-136 | H-032, H-065 |
| | RF-137 | H-032, H-055 |
| | RF-138 | H-033, H-112 |
| | RF-139 | H-112 |
| | RF-140 | H-111, H-113 |
| | RF-141 | H-113 |
| M14 Admin | RF-145 | H-102 |
| | RF-146 | H-103 (BK-11) |
| | RF-147 | H-039 |
| | RF-148 | H-073 |
| | RF-149 | H-090 |
| | RF-150 | H-079 |
| | RF-151, RF-152 | H-105 |
| | RF-153 | H-107 |
| | RF-154 | H-006, H-104 |
| M15 Transversais | RF-160 | H-002 |
| | RF-161, RF-162 | H-118 |
| | RF-163 | H-120 |
| | RF-164 | H-118, H-122 |

Observação: RF-122 aparece em H-094 (cota), H-095 (aceite) e H-100 (teste de catálogo). RF-041 usa o e-mail de login com prioridade (H-097).

---

## 3. Invariantes (I-xx) → histórias e testes

| I | Invariante (resumo) | Histórias | Testes |
|---|---|---|---|
| I-01 | Aceites ≤ 4 sem onda 2; ≤ 8 sempre; nunca 9 | H-059 | C-01, C-02 |
| I-02 | Um profissional ou CPF/CNPJ por pedido | H-058, H-040 | C-03 |
| I-03 | Um aceite → uma conversa → uma mensagem de sistema | H-058, H-065, H-068 | C-16, F-10 |
| I-04 | No máximo uma seleção ativa por pedido | H-074 | C-05, C-17 |
| I-05 | Aceite só com admissão aberta | H-031, H-062 | C-06 |
| I-06 | `wave2_opened_at` uma vez, com 4 aceites | H-060 | C-04, C-04b |
| I-07 | `acceptance_deadline_at` imutável | H-031 | Monitor |
| I-08 | Uma conclusão válida, com seleção ativa | H-078 | C-07 |
| I-09 | Uma avaliação por pedido, do selecionado | H-086 | C-08 |
| I-10 | Uma republicação ativa por cadeia | H-083 | C-09 |
| I-11 | Cancelar republicação e selecionar no original: tudo ou nada | H-084 | C-10, F-02 |
| I-12 | Um chat por (pedido, profissional); mensagem só em chat ativo e por membro | H-065, H-066 | Teste de API e banco |
| I-13 | Mensagem idempotente; sem UPDATE ou DELETE | H-066 | Teste de retry |
| I-14 | Pagamento idempotente; trial único por identidade; fim de trial sem cobrança | H-044, H-049 | C-11, B-01 a B-06 |
| I-15 | Auditoria na mesma transação, append-only | H-006, H-104 | Falha após ação |
| I-16 | Nenhuma consulta a profissional traz e-mail; telefone só com consentimento | H-032, H-055, H-112 | T-02, T-03, T-05, T-06 |
| I-17 | Admissão nunca volta a aberto | H-062, H-079 | C-07 |
| I-18 | Estorno > R$ 200 com dois aprovadores distintos | H-105 | Teste dedicado |
| I-19 | Profissional não participa do próprio pedido | H-017 | Teste |
| I-20 | Concessão monotônica e idempotente | H-045, H-048, H-049 | B-05, B-06 |
| I-21 | Contadores derivados = recontagem | H-005 | Monitor diário |
| I-22 | Retirar aceite não libera vaga; sem DELETE | H-061 | C-17 |
| I-23 | Todo e-mail previsto gera linha no outbox; sem interruptor nem reenvio | H-095, H-100 | N-01 a N-05, N-07 |
| I-24 | Cota por destinatário; `auth` nunca descartado | H-094 | N-08, Q-01, Q-11 |
| I-25 | Pix e cartão; sem boleto; carência 72 h | H-047, H-050 | B-01 a B-10 |
| I-26 | Nenhum preço, prazo ou valor em pedido, aceite ou mensagem | H-064 | T-17 |
| I-27 | Dev e CI sempre no Mailpit; envio real só com domínio verificado | H-093 | N-09, N-10 |
| I-28 | Coordenada só de geocodificação permanente; teto de 3 | H-021, H-022 | G-01 a G-06 |
| I-29 | No máximo 5 fotos; só versão reduzida; 6ª recusada | H-026, H-027 | P-01 a P-06 |
| I-30 | Chat sem anexos | H-067 | M-01, M-02 |

---

## 4. Lacunas e pendências que afetam a rastreabilidade

| # | Lacuna | FA ou RF afetados | Tratamento no plano |
|---|---|---|---|
| L-1 | RN-001 a RN-408 e RN-641 a RN-675 sem texto individual | Todos | Rastreio feito por RF e FA. Não há mapa RN → RF. Quando as RN chegarem, mapear |
| L-2 | Matriz de telas e permissões do admin (RF-146) | FA-031 | AMB-08 A como base (BK-11) |
| L-3 | Textos de "sem vaga" e "sem cobertura" | FA-010, RF-020, RF-071 | BK-5 |
| L-4 | Textos de e-mail e mensagens ao cliente e ao profissional (além da mensagem fixa) | FA-029 | Escrever com o PO em H-092 a H-099 (sem dado sensível) |
| L-5 | EDS mestre não recebido; tokens só pela síntese 04 | FA-033 | H-002 com critério do Reviewer |
| L-6 | 10 grupos de categorias originais | FA-001, RF-003 | Seed PROPOSTA (H-018, BK-9) |
| L-7 | Redação jurídica: termos, aviso "apenas conecta", lembrete de cobrança | FA-011, FA-029 | H-063, H-099, H-113 (BLQ-JUR L2, L7) |
| L-8 | Retenção e base legal | FA-020, FA-004 (documentos) | H-091, H-109, H-111 (BLQ-JUR L1) |
| L-9 | Reembolso e política de estorno | FA-032 | H-106 (BLQ-JUR L3) |
| L-10 | Certificações de atividades regulamentadas | FA-004 | H-038 (BLQ-JUR L4) |
| L-11 | Tarifas do Mercado Pago não obtidas; Pix Automático não encontrado | FA-006 | S-03 |
| L-12 | PostGIS, pg_cron e pg_net não encontrados no Supabase Free | FA-007 (geo), FA-029 (tick) | S-02; H-022, H-008 |
| L-13 | Termos de produto do Mapbox (PDF) não lidos | FA-001 (autocomplete e coordenada) | S-04 |
| L-14 | Limites de documentos (AMB-33 / decisão 34) × orçamento de Storage | FA-004 | BK-1 (A-2 em `14-BACKLOG` §7) |
| L-15 | Domínio de e-mail inexistente (H2) | FA-029, FA-003 (envio real) | H-093, BK-10 |
| L-16 | SD-09 (origens permitidas para republicar) | FA-022 | BK-4 |
| L-17 | RF-121 (canais além de e-mail): fora de escopo | — | Intencional |
| L-18 | Evidência de WCAG 2.2 AA e de testes de concorrência e segurança (L5) | FA-034 | H-118, H-121 |
| L-19 | Repositório GitHub (owner, nome, visibilidade) | Gate 2 | Não planejado aqui |

---

## 5. Cobertura de famílias de teste

| Família | Escopo | Histórias que exercitam |
|---|---|---|
| T-01 a T-04 | Identidade, IDOR, visibilidade, estados | H-011 a H-017, H-055, H-042 |
| T-05, T-06 | RLS e paridade de políticas | H-003, H-115 |
| T-07 | Mídia (EXIF, tipo, bomba, marca d'água) | H-027, H-028, H-037, H-056 |
| T-08 | Admin (MFA, papéis, dupla aprovação, auditoria) | H-039, H-073, H-102 a H-105 |
| T-09 | Billing (webhook, cartão, Pix) | H-048, H-053 |
| T-10 | Injeções e abuso | H-071, H-087, H-116 |
| T-11 | Logs e PII | H-007, H-035, H-120 |
| T-12 | Abuso e enumeração | H-015, H-019, H-024, H-057 |
| T-13, T-14 | Segredos e dependências | H-004, H-035 |
| T-15 | Acessibilidade e EDS | H-029, H-118 |
| T-16, T-17 | Aceite, chat e ausência de preço | H-058, H-064 |
| C-01 a C-18 | Concorrência | H-117 (e histórias de origem) |
| F-01 a F-12 | Falhas | H-117 (e histórias de origem) |
| I-01 a I-30 | Invariantes | §3 |
| B-01 a B-10 | Billing e carência 72 h | H-045 a H-052 |
| N-01 a N-10 | E-mails | H-092 a H-100, H-093 |
| G-01 a G-07 | Geocodificação | H-020 a H-022, H-036 |
| P-01 a P-06 | Fotos | H-026, H-027, H-056 |
| M-01, M-02 | Chat sem anexos | H-067 |
| Q-01 a Q-14 | Cotas, plano gratuito e tick | H-008, H-094, H-108, H-027, H-057 |
| D-01 a D-09 | Recuperação | H-114, H-119 |

Todas as famílias têm pelo menos uma história responsável no plano.

---

## 6. Como usar esta matriz

- Cada FA deve ter pelo menos um teste no plano antes de qualquer desenvolvimento. Hoje todos têm.
- Quando uma pendência for resolvida, mudar a coluna Cobertura de BLOQ ou PARCIAL para OK. Não alterar por inferência.
- Qualquer teste novo deve referenciar FA, RF ou I-xx existente. Não criar requisito novo sem decisão.
