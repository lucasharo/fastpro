# FastPro — Backlog (épicos, histórias, ondas e marcos)

- **Etapa:** planning · **Data:** 2026-11-10 · **Papel:** Backlog Architect · **Status:** rascunho para validação do Orquestrador (líder)
- **Natureza:** SOMENTE documento. Nenhuma Issue, Project, repositório, branch ou código foi criado ou alterado. Nenhum teste foi executado. Os IDs `H-xxx` e `S-xx` são internos a este documento; não são IDs de Issue. Não há número de Issue do GitHub até o Gate 2.
- **Fontes (versões mais recentes):** `01`, `02`, `03`, `04` (Rev. 6), `05` (Rev. 6), `06`, `07` (Rev. 6), `08` (Rev. 6), `09` (Rev. 6), `10` (Rev. 6), `11-ARQ` (Rev. 6), `11-DECISOES` (decisões 1–34), `12-TODO`, `13-VERIFICACAO-SERVICOS`, `10-RELATORIO-INGESTAO`.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` estimativa, sequência ou texto deste documento · `[PENDENTE JURÍDICO]` · `[NÃO VERIFICADO]`.
- **Bloqueios:** `BLQ-JUR` (pendência jurídica L1–L7) · `BLQ-EXEC` (criar conta, projeto ou chave: exige autorização de execução, SD-14/Gate 2) · `BLQ-DEC` (depende de decisão do usuário ou do líder) · `BLQ-SPK` (depende de spike).
- **Nomes:** nos documentos, `H1`…`H5` são IDs de decisão do usuário (ex.: H4 = fim da oferta). As histórias deste backlog usam `H-001`…`H-124`. Não confundir.
- **Tamanho [PROPOSTA]:** complexidade relativa, não prazo. `P` = pequena e isolada · `M` = média, com regra de negócio ou integração · `G` = alta: concorrência, segurança, integração externa ou spike pendente.
- **Escopo:** web primeiro; mobile na Onda 6; todo o desenvolvimento e o início no plano gratuito. Serviços pagos aparecem só como gatilho de upgrade ou como item bloqueado por decisão (ver Bloqueios).

---

## 1. Resumo

| Item | Quantidade |
|---|---|
| Épicos | 16 (E0–E15) |
| Histórias | 124 (H-001 a H-124) |
| Tamanho [PROPOSTA] | P: 23 · M: 79 · G: 22 |
| Spikes | 11 (S-01 a S-11) |
| Histórias com bloqueio jurídico | 12 (ver §6) |
| Histórias com bloqueio de execução | 3 (H-021, H-047, H-093) + spikes que exigem conta |

Cobertura de FA e RF: ver `15-RASTREABILIDADE.md`. Manifesto proposto de Issues (não criadas): ver `16-MANIFESTO-ISSUES.md`.

---

## 2. Ordem de entrega em ondas

| Onda | Conteúdo | Entrada / bloqueio | Saída |
|---|---|---|---|
| **0 — Spikes e fundação** | Spikes S-02, S-01, S-03, S-04, S-09, S-10, S-11, S-06, S-05; H-001 a H-010 | BLQ-EXEC (SD-14) para os spikes que exigem conta; nenhuma conta de produção | Decisões fechadas: geo (PostGIS ou fallback), sessão, tick, Mercado Pago, Mapbox, Resend, Vercel |
| **1 — Identidade e base** | H-011 a H-017; H-018, H-019; H-092, H-093 (Mailpit); H-102 (RBAC) | Onda 0 (S-01, S-11) | Login do cliente e do profissional em dev |
| **2 — Geo, pedido e verificação** | H-020 a H-024; H-025 a H-034; H-035 a H-043 | S-02, S-04, S-06; Onda 1 | Pedido publicável com fotos; verificação de profissional |
| **3 — Aceite e chat (M1)** | H-044, H-045; H-055 a H-073 (inclui aceite, vagas, chat somente texto, mensagem automática); H-095, H-101 | Onda 2 concluída | **Núcleo web: pedido → aceite → chat** |
| **4 — Ciclo de vida e assinatura (M2)** | H-046 a H-053 (Mercado Pago em sandbox); H-074 a H-085; H-094, H-096 a H-099 | S-03; cota de e-mail (H-094) | Seleção, conclusão, cancelamento, republicação; assinatura em sandbox |
| **5 — Avaliação, admin, LGPD e hardening (M3)** | H-086 a H-091; H-103 a H-108; H-109, H-110, H-112, H-114; H-115 a H-121 | L1 só para ativar prazos de retenção | **MVP web em ensaio fechado** (sem cobrança real, sem e-mail real) |
| **Gate M4 — Lançamento restrito** | H-054, H-106, H-111, H-113 e domínio de e-mail | Domínio verificado no Resend; L1–L4 e L7; Vercel Pro antes de cobrar; backup; tarifas MP | Decisão humana CONCLUIR ou BLOQUEAR |
| **6 — Mobile (M5)** | H-122 a H-124 | MVP web estável; SD-13; S-07 | Mobile (fora do MVP web) |

Caminho crítico [PROPOSTA]: S-02 e S-01 → H-003 → H-011/H-012 → H-025 a H-031 → H-058 → H-065 a H-068 (M1).

---

## 3. Marcos

| Marco | Critério de conclusão [PROPOSTA] |
|---|---|
| **M0 — Spikes e fundação** | S-01 a S-04, S-09 a S-11 com saída registrada; S-02 e S-10 decididos (geo e tick); H-001 a H-010 concluídos |
| **M1 — Núcleo web** | Cliente publica pedido com fotos; profissional elegível aceita; chat somente texto com mensagem automática do aceite; testes C-01 a C-03, C-16, M-01, M-02 verdes |
| **M2 — Ciclo completo** | Seleção, troca, conclusão, correção, cancelamento, desistência e republicação; assinatura em sandbox com carência 72 h (B-01 a B-10) |
| **M3 — MVP web (ensaio fechado)** | Avaliações, notificações, admin com MFA, mecanismo de retenção, suíte de concorrência e autorização verdes; sem cobrança real; e-mail só no Mailpit |
| **M4 — Lançamento restrito (bloqueado)** | Todos os itens do Gate M4 atendidos e decisão humana registrada. Não é alcançado por inferência |
| **M5 — Mobile** | Pós-MVP web, após SD-13 e S-07 |

---

## 4. Spikes (Onda 0 e posteriores)

Os spikes são leituras, provas de conceito locais ou testes em conta de teste. Os que exigem conta ou chave dependem de autorização de execução (BLQ-EXEC). Nenhum spike cria recurso de produção.

| ID | Pergunta | Saída esperada | Bloqueia | Onda | Estado da documentação |
|---|---|---|---|---|---|
| S-02 | PostGIS, pg_cron, pg_net e pooler em transação no Supabase Free e no local | Decisão geo (PostGIS ou fallback por célula/earthdistance) e tick (A, B ou C) | H-022, H-008 | 0 | PostGIS, pg_cron e pg_net **não encontrados** no Free (13). Teste no projeto (BLQ-EXEC) |
| S-01 | Sessão Supabase para usuário verificado pelo desafio próprio (magic link e sessão) | Confirmação do ADR-005 ou fallback B | H-011 a H-014, H-016 | 0 | Não verificado |
| S-03 | Mercado Pago: tarifas, recorrência por ciclo, Pix manual, assinatura de webhook, sandbox | Matriz de capacidades e tarifas | H-047 a H-053 | 0 | Tarifas **não obtidas** (403). Pix Automático não encontrado |
| S-04 | Mapbox: termos de produto (PDF) e significado de "armazenar" | Parecer e ajuste do ADR-008 | H-020, H-021 | 0 | Limites verificados; termos não lidos |
| S-09 | NestJS como função única na Vercel: cold start, pooler, biblioteca nativa de imagem | Parecer e contingência (ADR-018 B/C/D) | H-009, H-027, H-056 | 0 | Suporte confirmado; medição pendente |
| S-10 | Tick de jobs: escolha A, B ou C e atraso real | Escolha do mecanismo de tick | H-008, H-099 | 0 | Cron do Hobby 1×/dia verificado |
| S-11 | Resend: domínio, webhook de bounce, resposta ao exceder cota (429), SMTP do Supabase Auth | Parecer de execução | H-016, H-093, H-094 | 0 | Limites verificados; domínio **inexistente** (H2) |
| S-06 | Memória e tempo do reencode (JPG/PNG/WebP/HEIC de 10 MB) e da marca d'água | Limite de concorrência e de tamanho | H-027, H-037, H-056 | 0 | Pendente |
| S-05 | Realtime: canais privados com autorização e limites gratuitos | Viabilidade ou uso de polling | H-070 | 1 | 200 conexões e 2 mi mensagens verificados; canal privado não verificado |
| S-08 | Verificação oficial dos limites de todos os serviços (ADR-020) | Tabela verificada para planejamento de custo | H-121 e gatilhos | contínuo | Parcial (13) |
| S-07 | Regras das lojas: login social, IAP e exclusão de conta | Parecer para ADR-006 e ADR-019 | E14 | 6 | Não verificado |

---

## 5. Épicos e histórias

Colunas: **Rastro** = RF, FA, ADR, invariante (I-xx) ou decisão · **Dep.** = histórias ou spikes antes · **Riscos** = IDs de `11-ARQ` (R-xx) ou texto curto · **Testes** = IDs de `11-ARQ` (T, C, F, I, B, N, G, P, M, Q, D) ou FA.

### E0 — Fundação (Onda 0)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-001 | Monorepo pnpm + Turborepo: apps web, admin, api e mobile (vazio); packages contracts, tokens, ui, db, access-matrix, testkit | ADR-001, ADR-017; 08 §1.4 | Build, lint e testes de pacote vazio passam; cache do Turborepo ativo | — | P | Acoplamento inicial entre módulos | Regra de dependência entre módulos no CI |
| H-002 | Tokens EDS em `packages/tokens` como único lugar de cor; Roboto 400/500/700; claro e escuro | RF-160; FA-033; EDS (síntese 04) | Zero hex em componentes; troca de tema sem componente ilegível. **Critério de revisão do Reviewer** | H-001 | M | EDS mestre não recebido (usa síntese 04); BLQ-DEC para validar | Varredura de hex no CI; contraste; FA-033 |
| H-003 | Ambiente local (Supabase CLI + Docker), migrações SQL versionadas expand/contract, Postgres efêmero para teste | ADR-017; 08 §17; I-03 | Migração sobe do zero; teste de catálogo: toda tabela de domínio com RLS habilitada e forçada | H-001; S-02 | M | Diferença entre local e Free (PostGIS, pg_cron) | pgTAP (T-05) |
| H-004 | CI gratuito: lint, tipos, unitários, pgTAP, varredura de segredos e de dependências | T-13, T-14; R-01 | PR só mescla com pipeline verde; falha se houver segredo ou `service_role` no código | H-001, H-003 | M | Minutos de CI limitados [NÃO VERIFICADO] | T-13, T-14 |
| H-005 | Esqueleto transversal: `outbox_event`, `job` com lease (SKIP LOCKED), `idempotency_key`, `app_config`, `rate_counter` | P6, P7; 08 §7.5–7.6; I-21; ADR-014 | Mesma chave com corpo diferente → 422; em andamento → 409; evento só após COMMIT | H-003 | M | Pooler em modo transação (uso de `set_config` local) | C-14, F-03, I-21 |
| H-006 | Auditoria append-only com encadeamento por hash, gravada na mesma transação da ação | I-15; RF-154; ADR-012 | UPDATE e DELETE negados; falha após a ação faz rollback do registro de auditoria | H-003 | M | Crescimento na base de 500 MB (R-22) | I-15; T-08 |
| H-007 | Logs estruturados por allowlist; redação de e-mail, telefone, CPF, token e cabeçalhos; varredura automática de logs de teste | P8; ADR-013; RF-163 | Padrão de PII em log de teste reprova o build | H-001 | M | Ferramenta gratuita com retenção curta (SD-06) | T-11 |
| H-008 | Tick de jobs: `POST /internal/jobs/tick` com segredo de máquina; mecanismo A (pg_cron + pg_net), B (chamada externa gratuita) ou C (oportunista), conforme S-10 | ADR-018 item 3; Q-14; R-30, R-38 | Lembretes e digest rodam dentro do atraso medido; login, aceite e webhook não dependem do tick; jobs idempotentes sob lease | H-005; S-02, S-10 | M | pg_cron/pg_net não encontrados no Free (R-38); cron do Hobby 1×/dia | Q-14, F-08, C-13 |
| H-009 | Hospedagem: web (Next.js) em projeto Vercel; API NestJS como função única com rewrite `/api/*` (mesma origem); admin em projeto separado; Hobby só em dev | ADR-001, ADR-018; SD-01; decisão 28; 08 §16 | Healthcheck responde; web chama a API na mesma origem; admin com origem e cookies próprios | H-001; S-09 | M | Hobby proíbe uso comercial (R-28): nada cobrável nesta fase; cold start (R-10). BLQ-EXEC para criar projetos | Healthcheck; cookies entre origens; Q-05, Q-08 |
| H-010 | Keep-alive diário e backup manual (dump criptografado) com procedimento escrito | ADR-020; H3; R-08, R-32; `12-TODO` #1 | Procedimento documentado; export executado com dados sintéticos; periodicidade definida pelo usuário | H-003 | P | Pausa após 1 semana; sem backup no Free; periodicidade **pendente** (BK-7) | D-01 (ver H-119) |

### E1 — Identidade e sessão (Onda 1)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-011 | Desafio de acesso do cliente: `POST /auth/challenges` com resposta uniforme (202), token de 256 bits, código HMAC, 15 min, uso único | RF-035, RF-036, RF-039; FA-003; D8; ADR-005 §2 | Link expirado, usado ou adulterado é negado; resposta e tempo iguais para e-mail existente ou não | H-005; S-01; H-093 | G | Enumeração e força bruta (R-13) | T-01; FA-003 |
| H-012 | Consumo por POST: o GET da página não tem efeito colateral; token no fragmento; `no-store` e `Referrer-Policy` | RF-037; D8; ADR-005 §3; R-15 | Scanner que faz GET não consome; POST consome uma vez | H-011 | M | Pré-visualizadores de e-mail | T-01; FA-003 (D8) |
| H-013 | Código de 6 dígitos (até 5 tentativas) e nonce de navegador que anexa o rascunho só se o e-mail confere | RF-037; §5.1 itens 4–5; R-15 | Código errado 5× invalida o desafio; consumo em outro navegador não anexa rascunho de outro e-mail | H-011; H-025 | M | Confusão de sessão entre dispositivos | T-01 |
| H-014 | Sessão de 7 dias absolutos, revogável ("sair" e "sair de todos"); step-up de 30 min para ações críticas | RF-038; AMB-13 A+C; 08 §5.4; R-14 | Sessão expira em 7 dias; ação crítica sem `recent_auth_at` → 401 `step_up_required` | H-011; S-01 | M | Dispositivo compartilhado | T-01; T-02 |
| H-015 | Anti-enumeração e limites: reenvio com intervalo mínimo e teto por e-mail e IP; respostas idênticas | RF-039, RF-040; 08 §5.3; R-13 | Excesso → 429 com `Retry-After`; nenhuma mensagem revela existência de e-mail | H-005, H-011 | P | Falso positivo em IP compartilhado (NAT) | T-12; T-01 |
| H-016 | Cadastro e login do profissional: Supabase Auth com e-mail e senha; verificação obrigatória de e-mail; bloqueio progressivo | RF-045; 08 §5.2; ADR-006 (A, sem login social na web); AMB-05 | Sem e-mail verificado nada é publicado nem aceito; tentativas excessivas bloqueiam progressivamente | H-003; S-11 | M | D9 pendente; regras de loja (S-07) | T-04 |
| H-017 | Exclusividade de papéis: `app_user` único; profissional não participa do próprio pedido; admin sem perfil de cliente ou profissional | I-19; 09 §3.1; 08 §5.2 | Constraint ou trigger impede profissional aceitar no próprio pedido e admin com perfil de cliente | H-016, H-011 | P | Mesma pessoa com dois e-mails (limitação aceita) | I-19; T-04 |

### E2 — Catálogo e geo (Onda 2)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-018 | Catálogo com seed de 25 grupos e cerca de 550 serviços e sinônimos [PROPOSTA]; flags ON/PR/HI, REG e SENS | RF-001, RF-003; 06 | Seed carrega; visitante navega categorias sem login; flags persistidas | H-003 | M | Os 10 grupos originais não foram recebidos (D2): remapear se chegarem. REG depende de L4 | FA-001 (navegação) |
| H-019 | Autocomplete de serviço e sinônimos, sem acento e sem diferença de caixa | RF-002, RF-010; FA-001 | Parte do termo lista serviço ou sinônimo; acento e caixa ignorados | H-018 | M | Latência de consulta | FA-001; T-12 |
| H-020 | Autocomplete de endereço (Mapbox) temporário: mínimo 3 caracteres, debounce, token público restrito por origem; nada persistido | G-01; ADR-008; decisão 29; RF-010 | Escolha da sugestão grava só o texto; nenhuma coordenada em rascunho, log ou cache | H-009; S-04 | M | Termos de cache (PDF não lido); cota temporária de 100.000/mês | G-01; F-05 |
| H-021 | Coordenada permanente: uma chamada `permanent=true` na revisão do rascunho; teto de 3 por rascunho; breaker de gasto; CHECK `geocode_mode` | I-28; G-02 a G-06; decisão 29; R-36 | Exatamente uma chamada por revisão; 4ª edição recusada sem custo; breaker deixa o rascunho "aguardando geocodificação" | H-020, H-005; S-04; **BLQ-EXEC** (cartão e limite de gasto na conta Mapbox); **BLQ-DEC** (BK-2) | M | Custo desde o 1º pedido (≈ US$ 0,005 por chamada, [PROPOSTA]) | G-02 a G-06 |
| H-022 | Célula generalizada (≈ 500 m) e `match_point`; PostGIS ou fallback, conforme S-02 | RF-013; ADR-008; 09 §9.1–9.2 | Ponto exato não sai em consulta de profissional; casamento determinístico | H-021; S-02 | M | PostGIS não encontrado no Free (R-38) | T-03; G-02 |
| H-023 | Descoberta por raio de 5 a 100 km (base do profissional) e serviços online com alcance nacional | RF-004, RF-051, RF-065; AMB-18 A; 08 §9.3 | Pedido fora do raio não aparece; online aparece em qualquer UF; raio fora de 5–100 km recusado | H-022, H-036 | M | Índice GiST; exceção regulamentada depende de L4 | FA-010; CHECK de raio |
| H-024 | Cobertura booleana sem contagem, com cache de 5 min e rate limit | RF-020; AMB-03 A+B; 08 §9.4; ADR-014 | Resposta só "com" ou "sem"; sondagem limitada | H-023 | P | Texto ao cliente sem cobertura pendente (BK-5) | T-12; FA-001 |

### E3 — Pedido, fotos e cliente (Onda 2)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-025 | Rascunho de pedido sem conta: serviço, local (texto), urgência (4 valores exatos), descrição, TTL e nonce | RF-010, RF-011, RF-012, RF-019; 08 §3.4 | Preenche sem senha; urgência = Imediato, Nas próximas semanas, Próximo mês, Ainda não defini | H-018, H-019, H-020 | M | Rascunhos abandonados e spam (RF-021) | FA-001 |
| H-026 | Upload de fotos para quarentena com URL assinada de uso único; finalize idempotente; até 5 fotos; a 6ª é recusada. RF-025a: sem canal de foto extra na plataforma | RF-025, RF-025a, RF-028; I-29; decisão 30 | 6ª foto → 422 `photo_limit`; reenvio não duplica | H-025, H-005 | M | Upload interrompido (F-09) | P-01, P-02, F-09; FA-001 |
| H-027 | Redução no envio (navegador) e reencode no servidor: ≈ 0,5 MB e ≤ 1.280 px; só a versão reduzida é persistida | RF-025; decisões 30, 31; I-29; ADR-009 | Foto armazenada ≤ 1.280 px e ≈ 0,5 MB; nenhum original ou master no Storage; se não couber, recusa com mensagem | H-026; S-06 | G | Memória e tempo na função (R-11, R-31); bibliotecas HEIC (R-25) | P-03, P-04, P-06, F-11, Q-08, Q-12 |
| H-028 | Remoção de EXIF e metadados (rotação aplicada antes); detecção do tipo pelo conteúdo (JPG/PNG/WebP; HEIC só por conversão suportada) | RF-027; FA-007; T-07 | Arquivo renomeado ou falso é recusado; nenhum dado de GPS no objeto final | H-027 | M | Superfície de ataque do HEIC | T-07; P-03 |
| H-029 | Pré-visualização, exclusão e reordenação das fotos antes de publicar; estados de carregamento e erro | RF-026; RF-162 | Ações funcionam por teclado; erro com mensagem acionável | H-026 | P | — | FA-034; T-15 |
| H-030 | Revisão e confirmação expressa do pedido; aviso de possível duplicidade (mesmo serviço, até 100 m, ativo ou nas últimas 24 h), que nunca bloqueia | RF-014, RF-092 (princípio); AMB-01 A; ADR-015 | Nenhuma publicação automática; duplicidade só avisa e exige confirmação | H-025, H-021, H-024 | M | Valores de duplicidade são [PROPOSTA] | FA-002; FA-022 |
| H-031 | Publicação idempotente: novo ID; admissão aberta; `acceptance_deadline_at` = `published_at` + 7 dias corridos (imutável); exige e-mail verificado; rate limit de publicação | RF-012, RF-015, RF-021; FA-002; I-05, I-07; FA-035 | E-mail não verificado → recusado; retry não cria segundo pedido; prazo não muda com aceites | H-030, H-012, H-015 | M | — | FA-002; I-07; C-14 |
| H-032 | Visibilidade de localização: profissional vê rótulo e ponto generalizado; endereço exato e telefone privados; views sem colunas sensíveis | RF-013, RF-136, RF-137; I-16; 08 §4.3 | Resposta de API a profissional sem endereço exato, e-mail ou telefone | H-022, H-031 | M | View mal feita (R-01) | T-02, T-03, I-16; FA-007; FA-030 |
| H-033 | Opt-in de telefone e WhatsApp no pedido: checkbox desmarcado por padrão; escopo do pedido; revogação para o futuro | RF-016, RF-017, RF-138; AMB-17 C; 09 §3.8 | Sem marcar, telefone nunca aparece; republicação não herda; cópia já salva é informada como irrevogável | H-025 | M | Desvio para WhatsApp (R-2 de 01) | FA-030; FA-021 |
| H-034 | Painel do cliente na sessão do dono: pedidos e estados (publicado, selecionado, concluído, cancelado, expirado) sem contadores; tela pós-publicação orienta a voltar ao FastPro | RF-018, RF-038, RF-115 (decisão 10); FA-010 | Estados corretos; pedido de terceiro retorna 404 | H-031, H-014 | M | — | FA-001; FA-010; T-02 |

### E4 — Verificação e perfil profissional (Onda 2)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-035 | Cadastro profissional: CPF/CNPJ criptografado (Enc) e HMAC único; perfil público base | RF-046; 09 §3.3, §7 | CPF nunca em log; mesmo documento em dois perfis cai em retenção (H-040) | H-016, H-003 | M | Chave de criptografia (SD-11) | T-11, T-13 |
| H-036 | Perfil profissional: serviços (presencial ou online), base com coordenada permanente e raio de 5 a 100 km; mudança vale só para pedidos novos | RF-051; AMB-15 A; G-07; 09 §3.3 | Raio fora de 5–100 km recusado; mudança não altera pedido publicado | H-035, H-021, H-018 | M | Limite de taxa de alteração | G-07; FA-010 |
| H-037 | Documentos de identidade: imagem (JPG/PNG/WebP) e PDF; até 5 arquivos de 5 MB cada (**provisório**, decisão 34); validação por conteúdo; acesso só da Verificação | RF-046, RF-052, RF-148; decisão 34; AMB-33 B | Tipo ou tamanho fora do limite → recusado; leitura por não Verificação → negada | H-026, H-016; S-06 | M | Limite pode estourar o orçamento de Storage (Achado A-2; BK-1) | T-07; FA-031 |
| H-038 | Certificações para atividades regulamentadas (flag do catálogo): anexo obrigatório; verificação do conteúdo | RF-047; FA-004 (último item) | Atividade REG sem certificação → aprovação não concluída | H-018, H-037 | M | **BLQ-JUR L4** (verificação do conteúdo) | FA-004 |
| H-039 | Fila de verificação: aprovar, recusar, reter, explicar e registrar recurso; meta de 2 dias úteis (não promessa); auditoria | RF-047 a RF-049, RF-147; 09 §3.3 `verification_case` | Cada decisão gera evento de auditoria com ator e data | H-037, H-006, H-102 | G | Gargalo operacional (R-07 de 01) | FA-004; T-08 |
| H-040 | Retenção por duplicidade (mesmo CPF/CNPJ ou identidade), com explicação e recurso; sem bloqueio definitivo automático | RF-049; 08 §15; I-02 | Duplicidade vai para `retida_duplicidade`; nada é bloqueado sem decisão humana | H-035, H-039 | M | Falso positivo | FA-004 |
| H-041 | Estado e motivo da verificação visíveis ao profissional, com canal de recurso | RF-053 | Estados pendente, em revisão, retida, recusada e aprovada exibidos corretamente | H-039 | P | — | FA-004 |
| H-042 | Guarda: profissional não aprovado, suspenso ou revogado não aceita nem descobre pedidos, inclusive por API direta | RF-050; FA-004; T-04 | Chamada direta negada; nada criado | H-039, H-045 | M | Divergência entre API e RLS (R-01) | T-04, T-06 |
| H-043 | Perfil público do profissional: nome, serviços, selo "verificado" (somente identidade), média com 1 casa ou "Ainda sem avaliações", avaliações recentes | RF-001, RF-005, RF-006, RF-130 | Selo nunca descrito como garantia ou certificação de qualidade | H-036, H-039 | P | **BLQ-JUR L7** (texto final do selo) | FA-019; T-03 |

### E5 — Assinaturas e trial (Ondas 3 e 4)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-044 | Trial de 14 dias ativado pelo próprio profissional após aprovação; sem meio de pagamento; não converte; um por identidade (HMAC) | RF-057; FA-005; AMB-09 A [DELEGADO]; I-14 | Não aprovado → negado; sem assinatura nem cobrança ao vencer | H-039, H-045 | M | Reativação de trial (AMB-09) | FA-005; B-07; I-14 |
| H-045 | Acesso comercial derivado: livro `access_grant` e função `commercial_access(prof, at)` com estados da 08 §6 | P4; I-20, I-25; 09 §3.10; RF-062 | Estados corretos com relógio controlado; nenhum job é necessário para expirar | H-005, H-017 | G | Regras de tempo mal implementadas | B-01 a B-08; I-20; FA-025 |
| H-046 | Planos e preços em centavos: 2990, 8070, 14940 e 23880; benefícios idênticos; vigência em `plan_price`; sem promoção no MVP | RF-055, RF-056; FA-006 (preços); D5 | Preço exibido = preço gravado no pagamento; benefícios iguais nos 4 planos | H-045 | P | — | FA-006 |
| H-047 | Checkout Mercado Pago: Pix e cartão; boleto recusado (422 `method_not_supported`); dados de cartão nunca passam pelo NestJS; em dev só sandbox | RF-058; FA-006; B-09; ADR-007 | Boleto inexistente em API, tela e e-mail; cartão pelo checkout hospedado | H-046, H-005; S-03; **BLQ-EXEC** (conta e sandbox MP); **BLQ-DEC** (BK-3) | G | Tarifas não obtidas (403); escopo PCI [NÃO VERIFICADO] | B-09; FA-006 |
| H-048 | Webhook MP idempotente: grava em `provider_event`, responde 200, processa por consulta ao recurso (não ao corpo) e nunca regride | RF-060; I-20; 08 §8.7; 11 §4.1 | Duplicado ou fora de ordem → uma concessão; assinatura inválida → 401 | H-047; S-03 | G | Formato de `x-signature` [NÃO VERIFICADO]; reenvio a cada 15 min (resumo) | C-11, B-05, T-09 |
| H-049 | Concessão paga e início de período: `period_start` = fim do anterior se dentro de 72 h; idempotente por `provider_payment_id` | RF-059 (início); SD-16 (decisão 17); I-14 | Pix dentro da carência volta a ativa sem lacuna; após 72 h o novo período começa no pagamento | H-048, H-045 | M | Regra de tempo (08 §8.4) | B-03, B-04, B-10 |
| H-050 | Carência de 72 h para cartão e Pix (derivada: `period_end` + 72 h); trial sem carência; Pix pendente não estende acesso | RF-059; H5; FA-006; I-25 | Em carência → acesso mantido; após 72 h → expirada | H-049 | M | Interpretação da carência | B-01, B-02, B-06, B-07 |
| H-051 | Adesão expressa à renovação no cartão (texto e versão registrados); Pix exige pagamento manual a cada ciclo | RF-058; FA-006; 08 §8.3 | Sem adesão → sem cobrança automática; Pix não renova sozinho | H-047 | M | — | FA-006 |
| H-052 | Cancelamento de assinatura paga: `cancel_at_period_end`; acesso até o fim do período; sem carência | RF-061; B-08 | Cancelado → acesso até `period_end`; sem nova cobrança | H-049, H-050 | P | — | B-08 |
| H-053 | Reconciliação diária MP × livro: relatório ao Financeiro; nunca corrige acesso sozinha | 08 §8.8 | Divergência gera registro e alerta; nenhuma alteração automática | H-048, H-005, H-008 | M | Depende do tick (H-008) | T-09 |
| H-054 | **Gate de cobrança real (bloqueada):** Vercel Pro antes de cobrar; L1–L4 e L7; backup e tarifas MP confirmados; cartão e limite no Mapbox | Decisões 28, 29; ADR-018, ADR-020; `12-TODO` #9, #12 | Cobrança real não é ativada sem todas as condições | H-009, H-010, H-047, H-048 | P | Risco legal e de termos (R-28) | Checklist de H-121 |

### E6 — Distribuição e aceites (Onda 3)

Nota: o épico E6 do relatório de ingestão se chamava "Distribuição e ofertas". Pela H4, não há oferta; o épico passa a ser "Distribuição e aceites".

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-055 | Descoberta de pedidos elegíveis: aprovado, com acesso vigente, serviço compatível e dentro do raio (ou online); sem nome, e-mail, telefone ou endereço exato | RF-065, RF-137; FA-007; FA-010; FA-025 | Expirado ou não aprovado não aparece; resposta sem dado pessoal | H-023, H-042, H-045 | M | Desempenho do GiST | FA-007; FA-025; T-03; T-04 |
| H-056 | Fotos a elegíveis antes de aceitar: URL assinada de ≈ 60 s, marca d'água com o identificador do profissional sobre a versão reduzida, sem download do original | RF-029, RF-030; D10; 08 §10.3; P-05 | Derivada com marca; URL expira; `no-store`; nenhum cache persistente | H-027, H-055; S-06 | G | Egress de 5 GB/mês (R-37); renderização na função (S-06) | P-05; FA-007; FA-008; Q-13 |
| H-057 | Limite de visualizações por profissional, log de acesso e sinal de raspagem; suspensão cautelar só do acesso a fotos; pedido expirado retira o acesso de quem não aceitou | RF-030, RF-031; 08 §10.3 | Excesso → 429 e registro; participante mantém; não participante após expiração → negado | H-056, H-005 | M | Falso positivo | FA-008; T-12; Q-13 |
| H-058 | Aceitar trabalho: `POST /requests/{id}/acceptances` com corpo vazio; idempotente; sob lock do pedido; 1 por profissional e por CPF/CNPJ; conversa e mensagem de sistema no mesmo COMMIT; libera primeiro nome | RF-069, RF-070, RF-075, RF-110; FA-009, FA-011; I-02, I-03; ADR-021 | Clique duplo ou retry → 1 aceite; falha no meio → nada persiste; sem edição | H-055, H-064, H-005, H-017, H-044 | G | Aceite abusivo para ver dados (R-26); cliente confunde aceite com contrato (AMB-28) | C-03, C-16, F-01, F-10; FA-011; T-16 |
| H-059 | Vagas 4+4: teto de 8; `slot_no` de 1 a 8; slots acima de 4 bloqueados até a onda 2; resposta sem contadores | RF-066, RF-071, RF-074; I-01; AMB-04 A; FA-010 | 9º aceite negado; slots 1–4 sem lacunas; nenhum caminho paralelo | H-058 | M | Texto neutro ainda não definido (BK-5) | C-01, C-02, I-01; FA-010 |
| H-060 | Botão "Chamar mais profissionais": uma vez; com 4 aceites (vagas consumidas, inclusive retiradas); sem números; não após 7 dias, seleção ou cancelamento | RF-067, RF-068, RF-076; D3 (reinterpretada pela H4); decisões 7 e 20; I-06 | Clique duplo ou duas abas → uma abertura; com 3 aceites o botão não aparece | H-059 | M | Rótulo já aprovado (decisão 7) | C-04, C-04b; FA-010 |
| H-061 | Retirada do aceite antes da seleção: vaga permanece consumida; conversa somente leitura; aviso no chat; sem novo aceite do mesmo profissional | RF-077; AMB-23 B; decisões 3 e 19; I-22; SD-18 | Retirada não muda contadores; reaceite negado (UI e API) | H-058, H-065 | M | Aceite-fantasma (R-26) | C-17, C-18; FA-011 |
| H-062 | Encerramento de aceites: 7 dias corridos, seleção ou cancelamento fecham a entrada, inclusive com requisições concorrentes; conversas e histórico permanecem | RF-072, RF-073; FA-012, FA-014; I-05, I-17 | Aceite após prazo ou seleção → negado; expiração não cancela nem conclui | H-031, H-058 | M | Concorrência no limite do prazo | C-06; FA-012; I-05; I-17 |
| H-063 | Aviso "FastPro apenas conecta; não é contrato" somente nos termos de uso; não aparece no botão nem em diálogo | RF-078; decisão 22; AMB-28 | Botão sem aviso; termos contêm o aviso | H-058, H-113 | P | **BLQ-JUR L2 e L7** (redação) | FA-011 |
| H-064 | Corpo do aceite com campos extras (texto, valor ou prazo) → 422; nada é persistido como oferta | RF-070; I-26 | Nenhuma coluna de preço ou prazo em pedido, aceite ou mensagem | H-058 | P | — | T-16, T-17; FA-011 |

### E7 — Chat, somente texto (Ondas 3 e 4)

Nota: o épico E7 do relatório se chamava "Chat e anexos". Pelas decisões 32 e 33, o chat não tem anexos.

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-065 | Conversa criada no aceite: um chat por par (pedido, profissional); estados ativa e somente leitura; recálculo por função | RF-100, RF-106, RF-109; 08 §6.1; I-12, I-03 | Quem não é membro não envia nem lê; conversa de concorrente nunca aparece | H-058 | M | — | FA-009; I-12; T-02 |
| H-066 | Mensagens de texto idempotentes por `client_message_id`; sem editar nem excluir; estados enviando, enviada, falha e restrita | RF-101 (texto), RF-103, RF-105, RF-107; I-13; FA-026, FA-028 | Reenvio 5× → 1 mensagem; UPDATE e DELETE negados; envio em conversa somente leitura → negado | H-065 | M | — | C-12, C-18, I-13; FA-026; FA-028 |
| H-067 | Bloqueio total de anexos no chat: API recusa qualquer arquivo (422 `attachments_not_allowed`); UI sem botão, seletor, arrastar, colar, preview ou download; sem bucket nem tabela de anexo | RF-101, RF-102, RF-025a; decisão 33; I-30; FA-027 | M-01 e M-02 passam; não existe caminho de upload | H-066 | P | Regressão futura | M-01, M-02; FA-027 |
| H-068 | Mensagem automática do aceite: texto fixo "Estou disponível para trabalhar", como aviso do sistema (remetente nulo); uma por aceite; não aciona e-mail de não lida | RF-075, RF-115; decisões 14 e 26; AMB-30 A; I-03 | Uma mensagem por aceite; não editável; sem e-mail ou telefone do profissional | H-058, H-065 | M | Layout da atribuição visual a confirmar | C-16; FA-011; N-03 |
| H-069 | Arquivar e desarquivar como preferência individual; nova mensagem devolve a conversa à caixa de quem arquivou | RF-104; FA-026 | Arquivar não afeta o outro participante | H-065 | P | — | FA-026 |
| H-070 | Realtime como sinal: publica em canal privado `conv:{id}` apenas IDs; cliente busca o conteúdo pela API; polling como contingência | ADR-010; 08 §11; S-05; F-06 | Realtime indisponível → chat por polling sem perda | H-066; S-05 | M | Cota de conexões e autorização do canal [NÃO VERIFICADO] | F-06; T-02 |
| H-071 | Denúncia e bloqueio de usuário; filtro automático do texto; denúncia sem "anexo" | RF-107, RF-102 (filtro de texto); 09 §3.7 `chat_report` | Denúncia abre caso; bloqueio impede novas mensagens | H-066, H-102; decisão de moderação em H-090 | M | Falso positivo do filtro | T-10; FA-028 |
| H-072 | Restrição de segurança da conversa (`restrita_por_seguranca` prevalece) e rate limit anti-abuso sem limite comercial | RF-031, RF-108; 08 §6.1; FA-027 | Conversa restrita nega envio com aviso; ritmo humano não é limitado | H-065, H-005 | P | — | FA-027; FA-028 |
| H-073 | Acesso excepcional a conversa: caso com justificativa, autorizado por outra pessoa, validade curta e log por leitura | RF-148; FA-031; 08 §13 `access_case` | Admin sem caso é negado; caso libera só a conversa indicada; leitura registrada | H-102, H-006 | M | Pressão para acesso livre | FA-031; T-08 |

### E8 — Seleção, conclusão e cancelamento (Onda 4)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-074 | Selecionar participante com aceite ativo e elegível; uma seleção ativa por pedido; permitido após a expiração, sem reabrir aceites | RF-080, RF-082; FA-013; I-04 | Quem não aceitou é negado; seleção dupla é impossível | H-058, H-062, H-014 | M | Step-up na seleção [PROPOSTA] | FA-013; C-05; I-04 |
| H-075 | Ao selecionar: encerra novos aceites e mantém as conversas ativas; notificação aos não selecionados sem identidade | RF-081; FA-014 | Aceite após seleção → negado; demais conversas ativas | H-074 | P | — | FA-014 |
| H-076 | Trocar o selecionado somente entre participantes prévios; histórico não é transferido; auditoria | RF-083; FA-015; H-006 | Troca para quem nunca aceitou → negada; auditoria gerada | H-074, H-006 | M | — | FA-015 |
| H-077 | Cancelar com confirmação expressa: sem selecionado, todas as conversas somente leitura; com selecionado, só a dele fica ativa | RF-086; FA-016; 08 §6.1 | Clique sem confirmação não muda nada | H-074, H-065 | M | — | FA-016 |
| H-078 | Concluir: só o cliente, com confirmação explícita; uma conclusão válida; sem conclusão automática | RF-084; FA-017; I-08 | Dupla conclusão → uma só; profissional ou expiração tentando concluir → negado | H-074 | M | — | C-07; FA-017 |
| H-079 | Correção direta em até 24 h (instante absoluto, limite inclusivo, sem avaliação publicada) e revisão administrativa com auditoria; não reabre aceites | RF-085, RF-150; AMB-11 A; FA-018 | Limite exato aceito; 24 h + 1 ms recusado com oferta de revisão | H-078, H-006 | M | Relógio do banco | C-07; FA-018 |
| H-080 | Desistência do selecionado: registra e notifica; sem troca automática; sem substituto, duas confirmações (cancelar; republicar) | RF-087; FA-024 | Não troca sozinho; prazo original não reabre | H-074, H-077 | M | — | FA-024 |
| H-081 | Confirmações do cliente com `expected_version` (409 se o estado mudou); ordem de lock; `lock_timeout` de 3 s; `Retry-After` | RF-088; 08 §7.1; FA-035 | Estado visto diferente do atual → 409; sem deadlock sob carga | H-005, H-074 | M | Contenção em pedido quente (R-02) | C-15; F-02; FA-035 |

### E9 — Republicação (Onda 4)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-082 | Republicar cria pedido novo (ID e 7 dias próprios) na mesma cadeia; revisão e confirmação; aceites, chats e consentimentos não são transferidos | RF-090, RF-017; FA-021 | Original inalterado; telefone desmarcado na republicação | H-031, H-077 | M | Origens permitidas: SD-09 aberta (BK-4) | FA-021 |
| H-083 | Uma republicação ativa por cadeia (índice parcial); tentativa simultânea → 409 com referência à existente | RF-091; FA-022; I-10 | Duas tentativas simultâneas → uma criada | H-082 | M | — | C-09; FA-022 |
| H-084 | Selecionar no original com republicação ativa: confirmação com impacto; cancela a nova e seleciona no original em operação única, tudo ou nada | RF-093; FA-023; I-11 | Falha no meio → sem estado parcial; repetição idempotente | H-083, H-074, H-081 | G | Ordem de lock (cadeia → pedidos) | C-10; F-02; FA-023 |
| H-085 | Casos extremos da cadeia (suspensão, contestação, correção retroativa): AMB-02 A com exceção de cancelar e republicar; republicação com selecionado conta como ativa | RF-094, RF-092; AMB-02 [DELEGADO]; FA-022 | Cenário condicionado; regra aplicada conforme AMB-02 | H-083, H-079 | M | D7 delegado; validar com o usuário | FA-022 |

### E10 — Avaliações (Onda 5)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-086 | Avaliação do selecionado após conclusão válida: nota de 1 a 5, comentário opcional, uma por pedido | RF-125; FA-019; I-09 | Não concluído → negado; outro profissional → negado; segunda avaliação → negada | H-078 | M | — | C-08; I-09; FA-019 |
| H-087 | Antifraude e filtro automático com publicação automática; AMB-12: conteúdo ofensivo é rejeitado com correção; suspeita de fraude vai para revisão | RF-126; D4; AMB-12 | Ofensivo não publica e permite correção; nenhuma moderação humana prévia | H-086 | G | Exceção à D4 (AMB-12 delegado) | FA-019; T-10 |
| H-088 | Edição em até 7 dias da publicação; autor fixo "Cliente do FastPro"; média aritmética com 1 casa; "Ainda sem avaliações" | RF-128 a RF-130; FA-019 | Autor nunca mostra e-mail ou nome; média correta com zero e com N notas | H-086, H-087 | M | — | FA-019 |
| H-089 | Resposta pública única e contestação fundamentada do profissional; nota não é alterada | RF-131; FA-019 | Segunda resposta negada; nota intocada | H-088 | P | — | FA-019 |
| H-090 | Denúncia ou contestação com moderação humana por Moderador: decisão fundamentada, log e recurso; sem remoção automática | RF-132, RF-149; D4; FA-031 | Decisão sem fundamento recusada; recurso registrado | H-102, H-006, H-088 | M | — | FA-031; FA-019 |
| H-091 | Avaliação sem prazo comercial enquanto houver dados; revisão de validade quando a conclusão é corrigida (`em_revisao_validade`) | RF-127, RF-133; FA-020; FA-018 | Dados eliminados por retenção → negado com mensagem | H-086, H-079 | M | **BLQ-JUR L1** (prazo de retenção); FA-020 condicionado | FA-020; C-08 |

### E11 — Notificações (Ondas 3 a 5)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-092 | Pipeline: evento do outbox → `notification_item` → cooldown de 15 min por (destinatário, categoria, escopo) → `email_outbox` com `dedupe_key`; janelas independentes por categoria | RF-115 a RF-117; ADR-011; 08 §12.3 | Mensagem lida antes do resumo → resumo omitido; resumo obsoleto não sai | H-005, H-008 | G | Flush executado em duplicidade (C-13) | N-02, N-03, C-13 |
| H-093 | `EmailProviderPort` com adapter Mailpit (dev e CI) e adapter Resend; Resend recusa envio sem domínio verificado ou sem segredo; `EMAIL_PROVIDER` por ambiente | I-27; N-09, N-10; decisões 15 e T7 | Dev e CI sem chamada externa; produção sem domínio → nada sai e o item fica pendente | H-003, H-092; S-11; **BLQ-EXEC** (conta e domínio) | M | Domínio inexistente (R-33); T8 não confirmado (13) | N-09, N-10 |
| H-094 | Cota do Resend: contador por destinatário (dia UTC e mês); alertas em 70, 85 e 95%; aviso em ≥ 90/dia e ≥ 2.700/mês; reserva de 10/dia e 300/mês para `auth`; degradação; ≤ 5 envios/s | RNF-EMAIL (PRD §6.1); I-24; ADR-022; R-34 | Login passa; demais são adiados e reavaliados; chat e site intactos | H-092, H-093 | G | 100/dia é limite forte (R-34) | Q-01, Q-10, Q-11; N-08 |
| H-095 | E-mail de aviso de aceite: imediato no 1º aceite; agrupado (15 min) nos demais; sem dados privados; sem reenvio de aceites antigos | RF-115, RF-120, RF-122; FA-029; I-23 | Aceite gera e-mail; aceites anteriores à habilitação não geram | H-092, H-068 | M | — | N-01, N-02; FA-029 |
| H-096 | E-mail de mensagem não lida: imediato na primeira e agrupado nas seguintes; a mensagem automática do aceite não aciona | RF-116; FA-029 | Mensagem humana não lida → e-mail; automática → nenhum | H-092, H-066 | M | — | N-03 |
| H-097 | E-mail de link, código e login: enviado na requisição, prioridade máxima, fora do tick; resposta uniforme 202 | RF-041; FA-003; F-12 | Falha do provedor → fila com recuo, sem duplicação | H-011, H-093, H-094 | M | Cota (R-09) | N-05; F-12; FA-029 |
| H-098 | E-mails de seleção, cancelamento, desistência e decisão de verificação; conteúdo sem dados sensíveis; checagem de estado antes do envio | RF-118, RF-120, RF-122; FA-016 | Cada tipo enfileira e envia (Mailpit); pedido selecionado ou cancelado não envia aviso obsoleto | H-092, H-093, H-077 | M | — | N-04, N-06; FA-016 |
| H-099 | Lembretes de prazo (T-24h e vencimento) e de fim de trial ou ciclo; recheque de estado; AMB-06 A | RF-064, RF-073, RF-119; FA-005, FA-012 | Lembrete não sai se selecionado ou cancelado; trial não induz cobrança | H-092, H-008, H-044 | M | **BLQ-JUR L2 e L3** para texto de lembrete de cobrança | N-04; FA-005; FA-012 |
| H-100 | **CANCELADA (2026-11-11, decisão do usuário):** não haverá interruptor de e-mail; a verificação automática foi removida. Regra vigente: sem interruptor, sem reenvio de aceites antigos (decisão 27). | RF-122, RF-154; decisão 27; I-23 | — | H-092 | P | — | — |
| H-101 | Canal "no site": indicador de não lida e mensagem imediata, independentes de e-mail | RF-115; R-27; FA-029 | Com e-mail degradado, chat e site seguem funcionando | H-068, H-094 | P | — | Q-01; FA-029 |

### E12 — Admin, RBAC, auditoria e financeiro (Ondas 1 a 5)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-102 | RBAC por permissão e MFA (`aal2`) em `/admin/*`; convite; sem cadastro público; papéis conforme AMB-08 A | RF-145; ADR-012; FA-031 | Sem MFA → negado; papel inadequado na API → 403 | H-003, H-009 | G | Perda do dispositivo MFA (R-21); MFA gratuito [NÃO VERIFICADO] | T-08; FA-031 |
| H-103 | Console admin mínimo: telas por papel (Verificação, Moderador, Financeiro, Suporte, Auditor, Superadmin) | RF-146 (ausente; base AMB-08 A) | Cada papel vê só suas telas; decisão de RF-146 registrada | H-102 | G | Matriz de telas ausente (D1); BK-13 | FA-031; T-08 |
| H-104 | Consulta à auditoria pelo Auditor, somente leitura | RF-154; FA-031 | Auditor lê, não altera | H-006, H-102 | P | — | T-08 |
| H-105 | Dupla aprovação para estorno acima de R$ 200,00 (20000 centavos) e suspensão permanente; aprovador diferente do solicitante; R$ 200,00 exatos = uma aprovação | RF-151, RF-152; FA-032; I-18 | Autoaprovação negada; mesmo aprovador duas vezes negado | H-102 | M | Política de reembolso (L3) | FA-032; I-18; T-08 |
| H-106 | **Bloqueada:** estorno e chargeback manual; execução no MP pelo Financeiro; sem retenção automática de 50% | RF-063; FA-032 (último item); 08 §8.9 | Só habilitar após L3 | H-105, H-047 | M | **BLQ-JUR L3** | FA-032 |
| H-107 | Gestão de catálogo, sinônimos e promoções futuras no admin | RF-003, RF-153 | Alteração gera auditoria; promoção não se aplica sozinha | H-018, H-102 | M | Promoções fora do MVP | FA-001 |
| H-108 | Painel operacional mínimo (`ops_metric` agregado): fila de e-mail, cotas em %, webhooks, fotos, erros de RLS | ADR-013, ADR-020 | Alertas em 70, 85 e 95% visíveis; sem PII | H-092, H-094, H-007 | M | — | Q-02, Q-03, Q-04 |

### E13 — LGPD, retenção e observabilidade (Onda 5)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-109 | **Mecanismo de retenção (parcialmente bloqueada):** `retention_policy` (período nulo = desligado), `legal_hold`, expurgo idempotente e auditado | ADR-016; 09 §8; RC-01 a RC-11 | Mecanismo pronto; nenhum prazo ativo sem L1 | H-006, H-005; **BLQ-JUR L1** | G | Prazos não definidos (AMB-14) | Job desligado enquanto o período é nulo |
| H-110 | Expurgos operacionais: quarentena e rascunhos por TTL, desafios, sessões, inbox de webhook, outbox entregue, idempotência e rollup de `media_access_log` | 09 §10; RC-08, RC-09 | Expurgos rodam sem apagar dado com `legal_hold` | H-005, H-008, H-109 | M | TTL técnico [PROPOSTA], não é prazo legal | Q-04 |
| H-111 | **Bloqueada:** direitos do titular (`dsr_case`): acesso, correção e eliminação; base legal e prazos | RF-140; 09 §3.8 | Fluxo desenhado; ativação após L1 e L2 | H-109; **BLQ-JUR L1, L2** | G | Exclusão × auditoria e financeiro | — |
| H-112 | Consentimentos e trilha de revelação: `contact_consent` com escopos, `contact_reveal_log`; compartilhamento de endereço exato com participante | RF-016, RF-138, RF-139; FA-030 | Cada revelação de telefone ou endereço fica registrada; revogação vale para o futuro | H-033, H-058 | M | — | T-03; FA-030; I-16 |
| H-113 | **Bloqueada:** termos de uso, política de privacidade, textos de consentimento, suboperadores e encarregado (DPO) | RF-078, RF-140, RF-141; SD-11 | Textos validados antes do lançamento | **BLQ-JUR L2, L7** | G | Responsabilidade por "verificado" e conteúdo (L7) | Revisão jurídica |
| H-114 | Runbook: incidente de dados, reconciliação pós-restauração (MP e e-mail), periodicidade do backup | D-03 a D-09; `12-TODO` #1 | Runbook revisado e exercitado com dados sintéticos | H-010, H-053, H-119 | M | Notificação de incidente [PENDENTE JURÍDICO] | D-03, D-04 |

### E15 — Hardening e release (Ondas 3 a 5)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-115 | Testes de autorização por recurso e paridade entre API e banco, a partir da `access-matrix` | T-02, T-05, T-06; ADR-002; R-01 | Nenhuma divergência em caminho exposto; RLS default-deny | H-003, H-042, H-055 | G | Complexidade de RLS (R-05) | T-02, T-05, T-06 |
| H-116 | Testes de injeção, XSS, CSRF, SSRF, upload malicioso e redirecionamento | T-10 | Nenhum achado crítico antes do release | H-004 | M | — | T-10 |
| H-117 | Suíte de concorrência e falha: C-01 a C-18 e F-01 a F-12 em Postgres efêmero, com N ≥ 100 iterações e monitores de invariante | 11 §7 e §8; I-01 a I-22 | Todos os invariantes sem violação em cada cenário | H-058, H-059, H-062, H-081, H-084, H-048, H-005 | G | Tempo de CI (R-02) | C-01 a C-18; F-01 a F-12; I-01 a I-22 |
| H-118 | Acessibilidade WCAG 2.2 AA com evidência (teclado, leitor de tela, contraste); estados vazio, erro e carregando; responsivo | RF-161, RF-162, RF-164; FA-033, FA-034 | Conformidade só declarada com evidência registrada | H-002, H-029, H-066 | G | Sem evidência ainda (L5; R-24) | FA-034; T-15 |
| H-119 | Restauração de backup: restaurar dump em ambiente limpo, aplicar migrações, rodar monitores I-xx e reconciliar Storage | 08 §17; 11 §9 (D-01, D-02) | RTO ≤ 8 h [PROPOSTA]; invariantes sem violação | H-010, H-003, H-117 | M | Backup manual sem automação | D-01, D-02 |
| H-120 | Dados sintéticos de demonstração e seeds (usuários, pedidos, fotos e aceites fictícios) | RF-163 | Seed sem dado real; varredura de PII passa | H-018, H-007 | P | — | T-11 |
| H-121 | Gate de release do MVP web: checklist (testes críticos verdes, backup, domínio, Vercel Pro antes de cobrar, L1–L4 e L7, tarifas MP) | 11 §11; ADR-020; decisões 15, 28, 29 | Checklist aprovado pelo usuário; nada publicado sem CONCLUIR | H-117, H-119, H-093, H-054 | P | Decisão CONCLUIR ou BLOQUEAR é só humana | Checklist |

### E14 — Mobile (Onda 6, fase posterior; não planejado para execução)

| ID | História (objetivo) | Rastro | Critérios de aceite (resumo) | Dep. | Tam. | Riscos | Testes |
|---|---|---|---|---|---|---|---|
| H-122 | **Bloqueada:** app Expo base (`apps/mobile`) consumindo os contratos da API | RF-164; T5; SD-13 | Não inicia antes de web estável e de SD-13 | H-121; S-07; **BLQ-DEC** (SD-13) | G | Contas de loja pagas (L6) | — |
| H-123 | Reuso de contratos e tokens no mobile; nenhuma regra de elegibilidade no cliente | ADR-019; 08 §1.4 | Mesmos contratos; decisão de elegibilidade só no servidor | H-122 | M | — | Testes de contrato |
| H-124 | **Bloqueada:** assinatura e login no mobile: IAP, login social e exclusão de conta conforme regras de loja | ADR-006, ADR-019; S-07 | Parecer das regras antes de planejar | S-07; SD-13; **BLQ-JUR L6** | G | Regras das lojas [NÃO VERIFICADO] | — |

---

## 6. Bloqueios externos ao backlog

| Tipo | Item | Histórias afetadas | Quem destrava |
|---|---|---|---|
| BLQ-JUR L1 (retenção e base legal) | Prazos por classe de dado; base legal | H-091, H-109, H-111 | Jurídico (assessoria a ser indicada) |
| BLQ-JUR L2 (termos, privacidade, DPO) | Textos e suboperadores | H-063, H-099 (parcial), H-111, H-113 | Jurídico |
| BLQ-JUR L3 (reembolso) | Política de estorno e retenção de 50% (proposta, não automatizar) | H-099 (parcial), H-105, H-106 | Jurídico |
| BLQ-JUR L4 (certificações) | Lista REG e forma de verificação | H-038 | Jurídico |
| BLQ-JUR L5 (evidências) | WCAG, testes, backup e observabilidade como evidência | H-118, H-121 | Execução (evidência) |
| BLQ-JUR L6 (lojas) | Contas de desenvolvedor e revisão | H-122, H-124 | Usuário (SD-13) |
| BLQ-JUR L7 (responsabilidade) | Texto do selo "verificado" e conteúdo trocado | H-043, H-063, H-113 | Jurídico |
| BLQ-EXEC (SD-14 / Gate 2) | Criar contas e chaves: Supabase, Vercel, Mercado Pago (sandbox), Mapbox (cartão), Resend e domínio | H-009, H-010, H-021, H-047, H-093; spikes S-01 a S-04, S-09, S-11 | Usuário (autorização de execução) |
| BLQ-DEC | Confirmar que Mapbox permanente pago é aceito (BK-2); limites de documentos (BK-1); texto de sem vaga (BK-5); SD-09 (BK-4); SD-13 | H-021, H-037, H-059, H-024, H-082, H-122 | Usuário ou líder |
| BLQ-SPK | Resultado de spike antes de implementar | H-008, H-022, H-020, H-021, H-027, H-047 a H-051, H-070, H-093, H-009 | Spikes da Onda 0 |

---

## 7. Achados de consistência entre documentos

Estes achados não alteram os documentos-fonte. Ficam aqui para o líder decidir.

| # | Achado | Efeito | Recomendação |
|---|---|---|---|
| A-1 | `07-AMBIGUIDADES` (Rev. 6) ainda mostra AMB-33 como **ABERTA**; a decisão 34 (`11-DECISOES`) aprovou a opção B | Histórias H-037 e FA-004 tratam o assunto como aberto | Marcar AMB-33 como respondida pela decisão 34, com limites provisórios |
| A-2 | Limites da decisão 34 (até 5 arquivos de 5 MB cada, sem redução) × orçamento de Storage (`09` §9: ≈ 300 MB para documentos) | Por profissional, o máximo é 25 MB; com 300 MB, cabem poucos profissionais no pior caso. A estimativa de 1–3 MB por profissional não é compatível com o limite | Reduzir imagens de documento no envio (como as fotos) e limitar PDFs; ver BK-1 |
| A-3 | Decisão 29 (Mapbox permanente pago, com cartão) foi registrada como "[APROVADO, interpretado]" pelo líder, e a restrição de orçamento diz que nada pago é premissa sem decisão do usuário | Risco de execução de H-021 sem confirmação explícita | Confirmar com o usuário antes de H-021 (BK-2) |
| A-4 | Notação: `H1`…`H5` são decisões do usuário; este backlog usa `H-xxx` para histórias | Confusão de leitura | Manter a notação e o aviso no cabeçalho |
| A-5 | `07-AMBIGUIDADES` mostra AMB-30 como **ABERTA** na tabela, mas o cabeçalho diz que foi respondida pela decisão 26 | Inconsistência interna | Marcar como respondida (decisão 26) |
| A-6 | Relatório de ingestão (`10`) fala em "E6 Distribuição e ofertas" e "E7 Chat e anexos" | Obsoleto após H4 e decisões 32–33 | Renomeados: E6 "Distribuição e aceites"; E7 "Chat, somente texto" |
| A-7 | RF-088 cita "pagar" entre as operações compostas | Não há pagamento do serviço (apenas assinatura do profissional) | Ler "pagar" como pagamento de assinatura (webhook); PO ajusta o texto |
| A-8 | Catálogo: 25 grupos [PROPOSTA] × 10 grupos originais (não recebidos) | Seed de H-018 pode mudar | Usar o seed apenas em dev até os grupos originais chegarem |
| A-9 | `11-DECISOES` diz "lista de perguntas fechada em 2026-11-10", mas este backlog levanta dúvidas novas | Novas perguntas precisam de numeração própria | O líder consolida (ver §8) |
| A-10 | Mensagens de sem vaga (AMB-04) e sem cobertura (AMB-03) estão delegadas, mas o texto não foi definido | Histórias H-059 e H-024 sem texto final | BK-5 |

---

## 8. Dúvidas para o líder

Numeração interna `BK-n`. Ao consolidar, o líder deve renumerar de forma contínua, sem reutilizar números já usados na sessão.

| BK | Dúvida | Alternativas | Recomendação [PROPOSTA] | Destrava |
|---|---|---|---|---|
| BK-1 | Limites dos documentos de identidade (decisão 34) cabem no orçamento de Storage? (A-2) | (a) manter 5 × 5 MB sem redução; (b) reduzir imagens no envio e limitar PDF a 2 MB; (c) reduzir para 3 arquivos | (b), registrado como provisório até o Architect confirmar | H-037 |
| BK-2 | Confirma o uso de geocodificação permanente paga (cartão e limite de gasto) para guardar coordenadas, dado que o orçamento é zero? (A-3) | (a) permanente na revisão (até 3 chamadas por rascunho); (b) permanente só na publicação (ADR-008, alternativa); (c) não persistir coordenada (inviável para o raio) | (b) com confirmação explícita do usuário | H-021 |
| BK-3 | Pode haver checkout Mercado Pago em sandbox na conta Hobby, sem cobrança real? | (a) sandbox e dados sintéticos no Hobby, cobrança real só no Pro; (b) migrar para o Pro antes de qualquer integração de pagamento | (a), confirmando que sandbox não conta como uso comercial | H-047 |
| BK-4 | Quais estados de origem permitem republicar? (SD-09) | (a) expirado ou cancelado; (b) mais concluído; (c) mais selecionado que desistiu | (a) + (c), como no `10-ADRS` | H-082 |
| BK-5 | Textos para "sem profissional elegível" (AMB-03) e "sem vaga" (AMB-04) | Texto neutro proposto pelo PO, sem números, por exemplo "Este pedido não está recebendo novos profissionais no momento." | Aprovar o texto proposto e definir o de cobertura | H-024, H-059 |
| BK-6 | Autorização de execução (SD-14) para os spikes com conta: Supabase Free, Vercel Hobby, Mercado Pago sandbox, Mapbox e Resend | (a) autorizar tudo de uma vez; (b) autorizar por spike, na ordem S-02, S-01, S-03, S-04, S-09, S-10, S-11 | (b), sem criar nada além do que o spike exigir | Onda 0 |
| BK-7 | Periodicidade do backup manual (`12-TODO` #1) | (a) semanal; (b) semanal e antes de migração destrutiva; (c) diária com automação (exige decisão) | (b) | H-010, H-119 |
| BK-8 | Confirma o recorte de fatias: M1 (pedido → aceite → chat) é a primeira entrega web, e cobrança real só no Gate M4 (AMB-20 B)? | (a) sim; (b) incluir cobrança real no M1 | (a) | Ordem de ondas |
| BK-9 | Seed de catálogo com 25 grupos [PROPOSTA] pode ser usado em dev até os 10 grupos originais chegarem? | (a) sim; (b) esperar os originais | (a) | H-018 |
| BK-10 | Domínio de e-mail (H2): haverá domínio antes do Gate M4? Sem domínio nenhum e-mail real sai (R-33) | (a) comprar domínio antes do M4; (b) lançar sem envio real (inviável para login); (c) adiar o lançamento | (a), decisão do usuário sobre custo | H-093, H-121 |
| BK-11 | Matriz mínima de telas admin (RF-146 ausente) | (a) aceitar AMB-08 A como base; (b) aguardar a matriz original | (a), revogável | H-103 |

---

## 9. Itens fora do backlog

- **RF-121** (push, SMS, WhatsApp como canal de notificação): não aprovado. Fora do backlog.
- **Mobile funcional**: E14 contém só placeholders bloqueados. Nenhum planejamento de execução antes de SD-13 e S-07.
- **Pagamento e escrow do serviço, comissão, cobrança por lead, moedas, boleto, teste A/B de preço**: fora de escopo (01, 02).
- **RN-001 a RN-408 e RN-641 a RN-675**: sem texto individual. Este backlog não as mapeia. Ver lacunas em `15-RASTREABILIDADE.md`.
