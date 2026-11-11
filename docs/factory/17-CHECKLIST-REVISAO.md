# FastPro — Checklist e política de revisão de PR (Reviewer)

- **Etapa:** planning · **Data:** 2026-11-10 · **Papel:** Reviewer · **Status:** rascunho para validação do Orquestrador (líder)
- **Natureza:** SOMENTE documento local. Nenhum PR, Issue, código, pipeline ou teste foi criado ou executado. As verificações da §7 são **sugestões** a implementar na H-004 e correlatas; nenhuma foi rodada.
- **Fontes (versões mais recentes):** `01` a `16`, `11-DECISOES` (decisões 1 a 40), `12-TODO`, `13-VERIFICACAO-SERVICOS`. Trechos superados foram ignorados (oferta extinta pela H4; chat com PDF superado pela decisão 33; interruptor de e-mail superado pelas decisões 23 e 27; fotos de 10 MB pela decisão 31).
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` · `[PROPOSTA]` sugestão deste documento (revogável) · `[PENDENTE JURÍDICO]` · `[NÃO VERIFICADO]`.
- **Papel canônico:** `roles/factory-reviewer.md`. O Reviewer compara diff e código com Issue, RN/RF/FA, decisões de arquitetura e Design System; classifica achados; emite `APROVADO_TECNICAMENTE` ou `AJUSTES_NECESSARIOS`. Não implementa correção, não movimenta Project, não faz merge nem deploy. **`APROVADO_TECNICAMENTE` não é a decisão humana CONCLUIR.**

---

## 1. Política geral

### 1.1 Severidades

| Severidade | Significado | Efeito |
|---|---|---|
| **BLOQUEADOR** | Viola critério da §2, invariante I-xx, decisão `[APROVADO]` ou regra de segurança | `AJUSTES_NECESSARIOS`, sem exceção. Não pode ser rebaixado pelo Reviewer |
| **IMPORTANTE** | Risco real, mas contornável; falta de teste planejado; desvio de padrão | `AJUSTES_NECESSARIOS`, salvo aceite registrado pelo Orquestrador com prazo para corrigir |
| **SUGESTAO** | Melhoria sem risco | Não bloqueia |

Cada achado traz: severidade, localização (arquivo:linha ou rota), regra violada (§2 ou I-xx/RF/FA), reprodução ou evidência, e encaminhamento (devolver ao DEV).

### 1.2 Decisão

- `APROVADO_TECNICAMENTE` somente se: zero BLOQUEADOR, zero IMPORTANTE sem aceite registrado, **todas** as evidências da §5 presentes para o tipo de história, e CI verde no SHA revisado.
- Caso contrário, `AJUSTES_NECESSARIOS`, com lista numerada de achados.
- Sem evidência, não há aprovação. Texto de PR ou afirmação do autor não substituem saída de teste, log de CI ou captura.
- Limites (AGENTS.md): máximo de **2 ciclos de correção** de código e 3 tentativas técnicas por etapa. Ao atingir o limite, o Reviewer para e relata ao Orquestrador.

### 1.3 Escopo da revisão

Revisar o **diff do PR** contra a Issue/história (`14-BACKLOG`), seus RF/FA/I-xx (`15-RASTREABILIDADE`) e as decisões vigentes. Código fora do diff só entra se o diff o tornar inseguro (ex.: nova rota que reutiliza uma view insegura).

### 1.4 Relatório (modelo mínimo)

- EXEC-ID, link do PR e SHA revisado.
- História (H-xxx) e RF/FA/I-xx cobertos.
- Decisão: APROVADO_TECNICAMENTE ou AJUSTES_NECESSARIOS.
- Achados: número, severidade, localização, regra, reprodução, encaminhamento.
- Cobertura de requisitos: critério de aceite -> evidência (arquivo de teste, job de CI, captura).
- Evidências ausentes.
- Dúvidas ao Orquestrador (canal único): alternativas e recomendação.

---

## 2. Critérios de bloqueio técnico (qualquer um = BLOQUEADOR)

A coluna **Origem** liga cada critério à regra de projeto. Os critérios operacionalizam decisões existentes; não criam requisito novo.

### 2.1 Segurança, autorização e RLS

| # | Critério | Origem |
|---|---|---|
| B-01 | Autorização feita **somente no cliente** (UI esconde, API não nega). Elegibilidade, papel, propriedade e estado são decididos no servidor e/ou no banco | ADR-002; ADR-019; H-123; R-01 |
| B-02 | Tabela de domínio nova sem RLS **habilitada e forçada**, ou com política permissiva por padrão. RLS é default-deny; o teste de catálogo deve reprovar tabela sem RLS | H-003; T-05 |
| B-03 | Função `SECURITY DEFINER` sem `search_path` fixo; função/view que contorna RLS sem justificativa e teste | T-05 |
| B-04 | Divergência entre API e banco (paridade `access-matrix`): caminho exposto que um nega e o outro permite | T-06; H-115 |
| B-05 | IDOR: recurso de outro usuário retorna resposta distinguível; o esperado é **404 indistinguível**. ID previsível ou sequencial | T-02 |
| B-06 | `service_role` ou papel privilegiado em caminho de requisição de usuário, no bundle web/admin/mobile ou em log | T-13; H-004 |
| B-07 | Ação de admin sem MFA (`aal2`), sem checagem de permissão na API, ou leitura de conversa/documento sem `access_case` (justificativa, validade curta, log por leitura) | T-08; H-102; H-073; RF-148 |
| B-08 | Ação crítica sem auditoria **na mesma transação**; `audit_event` com UPDATE/DELETE permitido | I-15; H-006 |
| B-09 | Estorno > R$ 200,00 (20000 centavos) ou suspensão permanente sem dois aprovadores distintos; autoaprovação | I-18; H-105 |
| B-10 | Login do cliente: GET do link consome o token (deve exigir POST, decisão D8); resposta ou tempo que revela se o e-mail existe; token/código que não expira (15 min), é reutilizável ou aceita mais de 5 tentativas de código | T-01; RF-037; D8 |
| B-11 | Sessão com prazo diferente de 7 dias absolutos, sem revogação, ou ação crítica sem `step_up` de 30 min | RF-038; H-014 |
| B-12 | Injeção (SQL concatenado), XSS armazenado (mensagem, descrição, comentário sem escape), CSRF em rota mutável, SSRF em URL fornecida, upload com nome malicioso | T-10 |
| B-13 | Profissional não aprovado, suspenso, revogado ou sem acesso vigente que aceita/descobre pedidos por API direta | T-04; FA-004; RF-050 |

### 2.2 Vazamento de dados (foto, endereço, chat, e-mail, telefone)

| # | Critério | Origem |
|---|---|---|
| B-14 | **E-mail do cliente** em qualquer resposta, view, evento, log ou mensagem voltada a profissional ou terceiros | I-16; FA-030 |
| B-15 | **Telefone/WhatsApp** exposto sem opt-in expresso no pedido (checkbox desmarcado por padrão), sem participação, ou herdado em republicação; revelação sem registro em `contact_reveal_log` | RF-016, RF-017, RF-138; AMB-17 |
| B-16 | **Endereço exato** ou coordenada exata (`exact_point`) retornado a profissional sem compartilhamento explícito; só rótulo e ponto generalizado (célula ≈ 500 m) | RF-013; I-16; H-032 |
| B-17 | **Primeiro nome do cliente** visível a quem não tem aceite `ativo` no pedido | RF-110; T-03; T-16 |
| B-18 | **Foto** servida sem URL assinada curta (≈ 60 s), sem marca d'água com identificador do profissional, sem `no-store`, com download do original, com EXIF/GPS, ou acessível a quem não é elegível nem participante (inclusive não participante após expiração) | D10; RF-029 a RF-031; T-07; P-05 |
| B-19 | **Chat**: leitura/envio por quem não é membro; conversa de concorrente visível; mensagem editável ou excluível; mensagem de sistema com e-mail, telefone ou endereço | I-12, I-13; T-02; T-16 |
| B-20 | Dado pessoal junto das fotos (nome, endereço, telefone em legenda, nome de arquivo ou metadado) | D10 |
| B-21 | Contadores, números de vagas, de aceites ou de concorrentes expostos a cliente ou profissional (cobertura devolve só "com/sem") | RF-020, RF-074; AMB-03/04; H-024 |

### 2.3 Bypass das 8 vagas, concorrência e idempotência

| # | Critério | Origem |
|---|---|---|
| B-22 | Qualquer caminho que permita **9 aceites** (sem lock do pedido, `slot_no` fora de 1..8, trigger ausente, caminho paralelo ao endpoint de aceite). Slots 5 a 8 sem `wave2_opened_at`; `wave2_opened_at` definido mais de uma vez ou com menos de 4 aceites | I-01, I-06; C-01, C-02, C-04 |
| B-23 | Retirada de aceite que libera a vaga ou apaga linha de `acceptance`; reaceite do mesmo profissional ou do mesmo CPF/CNPJ; mesmo CPF/CNPJ em duas vagas | I-02, I-22; decisões 19, 20 |
| B-24 | Aceite fora de `status='publicado'` ou depois de `acceptance_deadline_at`; prazo estendido/alterado por qualquer evento | I-05, I-07 |
| B-25 | Aceite com corpo livre (texto, valor, prazo) aceito em vez de 422; coluna de preço/valor/prazo em pedido, aceite ou mensagem; "oferta" reintroduzida | I-26; H4; T-17 |
| B-26 | Operação composta (aceite+conversa+mensagem de sistema; cancelar republicação+selecionar; publicar; webhook e concessão) sem transação única **tudo ou nada** | I-03, I-11; F-01, F-02, F-10 |
| B-27 | Mutação sem idempotência onde o contrato exige (`Idempotency-Key`, `client_message_id`, `provider_payment_id`): retry cria duplicata; mesma chave com corpo diferente não retorna 422 | I-13, I-14; C-12, C-14 |
| B-28 | Confirmação do cliente sem `expected_version` (409 se o estado mudou); ordem de lock inconsistente (deadlock); sem `lock_timeout` | RF-088; H-081 |
| B-29 | Admissão que "reabre" (`encerrado` volta a `aberto`) após correção, desistência ou troca | I-17 |
| B-30 | Instante calculado no servidor de aplicação ou no cliente onde a regra depende do relógio (7 dias, 24 h de correção, carência de 72 h). Usar o relógio do banco | R-23 |
| B-31 | Efeito colateral (e-mail, evento) disparado **antes do COMMIT**, ou evento fora do outbox | P6; H-005 |

### 2.4 Design System (EDS), tipografia e acessibilidade

| # | Critério | Origem |
|---|---|---|
| B-32 | **Cor hardcoded** em componente (hex `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`hsl()` literais, nomes de cor CSS) fora de `packages/tokens`. Toda cor vem de token do EDS | RF-160; H-002; FA-033 |
| B-33 | Tema claro ou escuro quebrado: componente ilegível ou token sem equivalente nos dois temas | RF-160; FA-033 |
| B-34 | Fonte diferente de **Roboto**, ou pesos fora de **400/500/700** | RF-160; EDS |
| B-35 | Regressão de **WCAG 2.2 AA** no fluxo tocado: sem operação por teclado, foco invisível ou preso, sem nome acessível, contraste efetivo dos tokens abaixo do mínimo, erro só por cor, sem estado de erro acionável | RF-161, RF-162; FA-034; T-15 |
| B-36 | Declarar "conforme WCAG 2.2 AA" (em PR, doc ou UI) **sem evidência** (teclado, leitor de tela, contraste). O objetivo é AA; conformidade só com evidência | RF-161; R-24; H-118 |
| B-37 | Tela nova sem estado vazio, carregando ou erro; quebra de breakpoint; modal onde o EDS exige bottom sheet (e vice-versa) `[NÃO VERIFICADO: EDS mestre não recebido; vale a síntese do 04]` | RF-162, RF-164 |
| B-38 | Texto de interface em desacordo com os textos aprovados: rótulo "Chamar mais profissionais"; mensagem do aceite "Estou disponível para trabalhar"; textos de "sem vaga" e "sem cobertura" da decisão 39; selo "verificado" descrito como garantia | decisões 7, 14, 39; RF-005 |

### 2.5 Segredos, PII em logs e dados

| # | Critério | Origem |
|---|---|---|
| B-39 | **Segredo no repositório** (chave de API, `service_role`, segredo de webhook, pepper, chave de criptografia, senha) em código, teste, fixture, doc, histórico do PR ou saída de CI. Docs citam só **nomes** de variáveis | Decisão 13; T-13 |
| B-40 | `.env.local` (ou qualquer `.env*` com valores) **não ignorado** pelo `.gitignore`, ou versionado. Só `.env.example` sem valores pode existir | Decisão 13 |
| B-41 | **PII em log, evento, erro, métrica ou traço**: e-mail, telefone, CPF/CNPJ, token, cabeçalhos `Authorization`/`Cookie`, endereço, corpo de mensagem. Logs usam allowlist de campos e redação | P8; ADR-013; RF-163; T-11 |
| B-42 | CPF/CNPJ gravado em claro (deve ser criptografado + HMAC único); chave sem versionamento (rotação D-06) | 09 §7; H-035 |
| B-43 | Dado real em seed, teste, fixture ou demo. Somente dados sintéticos | RF-163; H-120 |
| B-44 | Migração destrutiva (DROP/TRUNCATE/ALTER com perda de dado) fora do padrão expand/contract, sem plano de rollback por compensação | ADR-017; D-05 |

### 2.6 Serviços externos e limites do plano gratuito

| # | Critério | Origem |
|---|---|---|
| B-45 | **Webhook do Mercado Pago**: assinatura (`x-signature`) não verificada; processamento pelo corpo recebido em vez de consulta ao recurso no provedor; não grava antes em `provider_event`; não responde 200 rápido; permite regressão de estado ou concessão duplicada; reprocesso em outra ordem altera `period_end` `[formato de x-signature NÃO VERIFICADO: conferir no S-03]` | RF-060; I-14, I-20; C-11, B-05, T-09 |
| B-46 | Boleto em qualquer lugar (API, tela, e-mail, tabela). Método de pagamento limitado a `cartao` e `pix`; boleto retorna 422 `method_not_supported`. Dado de cartão passando pelo NestJS (cartão só por checkout hospedado) | H5; I-25; B-09 |
| B-47 | Carência de 72 h aplicada ao trial, ou não aplicada ao Pix; Pix `pendente` que estende acesso; trial que cria assinatura ou cobrança; segundo trial para a mesma identidade | I-14, I-25; B-01 a B-08 |
| B-48 | Chamada ao Mercado Pago de produção ou cobrança real antes do marco M4 e do gate H-054. Em desenvolvimento, **somente sandbox com dados sintéticos** | Decisões 37, 40; H-054 |
| B-49 | **Cota Resend**: envio sem contador por destinatário (`external_quota`); sem reserva para `auth` (10/dia e 300/mês); `auth` (link/código de login) descartável; mais de 5 envios/s; descarte por cota sem estado `adiado_cota`/reavaliação; limites diferentes de 100/dia UTC e 3.000/mês `[VERIFICADOS no 13]` | I-24; ADR-022; Q-01, Q-10, Q-11, N-08 |
| B-50 | E-mail para destino que não é a conta cadastrada, em dev ou teste (deve ser recusado antes da API; o envio em dev e teste é pelo Resend, somente para a conta cadastrada); adapter Resend enviando sem domínio verificado ou sem segredo (deve recusar e manter `pendente`); interruptor, tabela de flags, rota ou rotina de reenvio/backfill de e-mails (proibidos: e-mails nascem ativos e não retroativos) | I-23, I-27; decisões 23, 27; N-07, N-09, N-10 |
| B-51 | **Mapbox permanente fora do ponto permitido**: `permanent=true` em autocomplete/digitação; mais de uma chamada por revisão; 4ª chamada por rascunho (teto 3); coordenada gravada sem `geocode_mode` igual a `permanent`; resultado temporário em cache, rascunho ou log; sem breaker de gasto; chamada permanente para visitante anônimo ou antes de e-mail verificado | I-28; decisões 29, 36; G-01 a G-07; R-36 |
| B-52 | **Limites do plano gratuito** ignorados em solução nova: dependência de PostGIS/pg_cron/pg_net sem fallback `[NÃO VERIFICADO no Free; S-02]`; cron da Vercel Hobby (1x/dia) usado para algo mais frequente; tarefa acima de 300 s ou da memória do plano; consumo de egress/Storage/banco sem métrica e alerta; serviço ou conta paga introduzidos sem decisão do usuário | Restrição de orçamento; ADR-020; R-28, R-30, R-37, R-38 |
| B-53 | Cobrança real ou página de pagamento em produção servida no Vercel Hobby (uso comercial proibido); gate de lançamento ignorado (domínio no Resend, Vercel Pro, backup, tarifas MP, L1 a L4 e L7) | R-28; H-054; H-121 |

### 2.7 Fotos, Storage e chat sem anexos

| # | Critério | Origem |
|---|---|---|
| B-54 | **Foto do pedido** persistida acima de 1.280 px de lado ou muito acima de ≈ 0,5 MB (teto técnico configurado ≈ 0,75 MB); original ou *master* no Storage (inclusive em quarentena após o prazo); `media_asset` com coluna de original | Decisões 30, 31; I-29; P-03, P-04 |
| B-55 | Mais de **5 fotos** por pedido/rascunho (a 6ª deve ser recusada com 422 `photo_limit`, na API **e** no banco); qualquer canal de foto extra na plataforma (fotos extras só por WhatsApp, com opt-in) | RF-025, RF-025a; I-29; P-01, P-02 |
| B-56 | EXIF/metadados mantidos no objeto final; tipo aceito pela extensão em vez do conteúdo | RF-027; T-07 |
| B-57 | **Chat com anexo de qualquer tipo** (imagem, PDF, arquivo, multipart, campo `attachments`, URL de upload, colar/arrastar, botão ou seletor na UI, preview, miniatura, download); bucket `chat-attachments`, tabela `message_attachment` ou `media_asset` com `owner_kind` igual a `message` | Decisões 32, 33; I-30; RF-101, RF-102; M-01, M-02 |
| B-58 | Documentos de verificação fora dos limites aprovados (imagem + PDF; imagens reduzidas; PDF ≤ 2 MB; até 5 arquivos, provisório), com acesso por quem não é da Verificação, ou validação só por extensão | Decisões 34, 35; H-037 |

---

## 3. Checklist base (todo PR)

Marcar cada item no relatório. Falha em item da §2 = BLOQUEADOR.

- [ ] PR liga a uma história `H-xxx` (ou spike `S-xx`) e a RF/FA/I-xx/decisão de origem. Sem origem, devolver (regra do `16`).
- [ ] Escopo do diff = escopo da história. Sem funcionalidade extra nem requisito novo sem decisão.
- [ ] Critérios de aceite da história mapeados a testes do plano (IDs do `11-ARQ`), presentes e verdes no CI do SHA revisado.
- [ ] CI verde: lint, tipos, unitários, pgTAP (quando banco), varredura de segredos, auditoria de dependências, varredura de hex (quando UI), varredura de PII em logs de teste.
- [ ] Nenhum segredo, `.env*` com valor, `service_role` ou dado real no diff (B-39, B-40, B-43).
- [ ] Autorização no servidor/banco para todo recurso novo; teste negativo por **chamada direta** de API e acesso direto ao banco com papéis, não só pela UI (B-01 a B-05).
- [ ] Erros tratados com resposta padronizada, sem vazar detalhe interno; mensagens acionáveis ao usuário.
- [ ] Logs novos só com campos da allowlist (B-41).
- [ ] Dependência nova: justificada, gratuita, licença compatível; auditoria sem achado alto/crítico.
- [ ] Documentação do produto atualizada se contrato, esquema ou regra mudou (`docs/factory/`); nenhuma instrução de outro produto copiada.
- [ ] Textos novos de interface aprovados ou marcados como proposta; texto jurídico **não inventado** (§6).
- [ ] Reprodutibilidade: migração e seed rodam do zero no ambiente local (Supabase CLI + Docker), sem passo manual não documentado.

---

## 4. Checklists por tipo de história

### 4.1 API (NestJS, contratos, regras de negócio)

- [ ] Contrato em `packages/contracts`; validação de entrada estrita (campos extras rejeitados onde o contrato diz, ex.: aceite com corpo vazio, 422).
- [ ] Autorização por recurso (propriedade, papel, estado) **no servidor**; 404 indistinguível para recurso alheio (B-05).
- [ ] Resposta voltada a profissional passa por view/DTO que **não contém** e-mail, telefone, endereço exato, primeiro nome (sem aceite), contadores (B-14 a B-17, B-21).
- [ ] Idempotência: mutações críticas aceitam `Idempotency-Key`/`client_message_id`; mesma chave com corpo diferente = 422; em andamento = 409 (B-27).
- [ ] Transação única para operações compostas; evento só no outbox após COMMIT (B-26, B-31).
- [ ] Concorrência: lock na ordem definida (cadeia, depois pedido), `lock_timeout` de 3 s, `expected_version` nas confirmações do cliente, `Retry-After` em 409/429 (B-28).
- [ ] Rate limit e anti-enumeração em rotas sensíveis (login, cobertura, publicação, fotos, aceite); respostas e tempos uniformes onde o contrato exige (B-10).
- [ ] Tempo vem do relógio do banco (B-30).
- [ ] Sem PII em log; sem corpo bruto de requisição logado (B-41).
- [ ] Rotas de máquina (tick de jobs, webhooks) exigem segredo/assinatura e não são expostas ao navegador.
- [ ] Rota nova refletida na `access-matrix` e nos testes de paridade (B-04).
- [ ] Compatível com função única serverless: sem estado em memória entre requisições; cold start considerado (webhook só grava e responde).

### 4.2 Banco e migração (Postgres/Supabase)

- [ ] Migração SQL versionada, padrão **expand/contract**; sobe do zero e a partir do estado anterior; rollback por compensação (B-44).
- [ ] Toda tabela de domínio nova: RLS habilitada **e forçada**, default-deny, teste de catálogo (B-02).
- [ ] Views para profissional sem colunas sensíveis; `SECURITY DEFINER` com `search_path` fixo (B-03).
- [ ] Invariantes impostos no banco (únicos, parciais, CHECK, trigger) e não só na aplicação: I-01, I-02, I-04 a I-07, I-10, I-12, I-13, I-22, I-28, I-29 conforme o caso.
- [ ] `DELETE`/`UPDATE` negados onde exigido (auditoria, mensagem, aceite) por privilégio e trigger.
- [ ] Sem coluna de preço/valor/prazo em pedido, aceite ou mensagem (B-25); sem original de foto (B-54); sem tabela de anexo de chat (B-57).
- [ ] CPF/CNPJ criptografado + HMAC; chave versionada (B-42).
- [ ] Índices para consultas quentes (GiST de geo, filtros por status); `EXPLAIN` com dados sintéticos quando a consulta é nova.
- [ ] Monitores de invariante (consulta que retorna zero linhas) adicionados ou atualizados.
- [ ] Extensão (PostGIS, pg_cron, pg_net): fallback documentado, pois no Free **não foram encontradas** `[NÃO VERIFICADO; S-02]` (B-52).
- [ ] Impacto no limite de banco de 500 MB estimado (auditoria, outbox, logs de acesso, rate counters), com política de expurgo.
- [ ] Retenção: nenhum prazo legal inventado; mecanismo desligado enquanto o período for nulo `[PENDENTE JURÍDICO L1]`.
- [ ] pgTAP cobrindo RLS, invariantes e privilégios.

### 4.3 UI (web e admin; mobile só na Onda 6)

- [ ] Zero cor literal; só tokens de `packages/tokens` (B-32); claro e escuro verificados (B-33).
- [ ] Roboto 400/500/700 apenas (B-34).
- [ ] Teclado completo, foco visível e lógico, nomes acessíveis, contraste efetivo, erro além da cor, estados vazio/carregando/erro, responsivo (B-35, B-37).
- [ ] Nenhuma lógica de elegibilidade, vaga ou permissão decidida no cliente (B-01); UI não exibe números de vagas/aceites (B-21).
- [ ] Chat: sem botão, seletor, arrastar, colar, preview ou download de arquivo (B-57).
- [ ] Textos aprovados usados literalmente (B-38); aviso "FastPro apenas conecta" **só nos termos de uso**, nunca no botão nem em diálogo (decisão 22).
- [ ] Pedido: telefone/WhatsApp com checkbox **desmarcado por padrão**; urgência com os 4 valores exatos (Imediato, Nas próximas semanas, Próximo mês, Ainda não defini).
- [ ] Token público do Mapbox restrito por origem; autocomplete sem `permanent` (B-51).
- [ ] Página de consumo do link de login: GET sem efeito colateral, token no fragmento, `no-store`, `Referrer-Policy` (B-10).
- [ ] Nenhum dado pessoal em URL, `localStorage` ou console.
- [ ] Selo "verificado" descrito somente como verificação de identidade `[texto final PENDENTE JURÍDICO L7]`.
- [ ] Evidência de acessibilidade registrada (§5); sem afirmar conformidade sem ela (B-36).

### 4.4 Billing (Mercado Pago, assinaturas, acesso comercial)

- [ ] Só Pix e cartão; boleto inexistente e 422 `method_not_supported` (B-46).
- [ ] Cartão pelo checkout hospedado; nenhum dado de cartão no NestJS, banco ou log.
- [ ] Preços em centavos com vigência em `plan_price`: 2990, 8070, 14940 e 23880; benefícios idênticos nos 4 planos.
- [ ] Webhook: assinatura verificada; grava em `provider_event`; responde 200; processa consultando o recurso; duplicado/concorrente/fora de ordem = uma concessão; nunca regride (B-45).
- [ ] Concessão idempotente por `provider_payment_id`; acesso **derivado** do livro `access_grant` (`commercial_access(prof, at)`), sem job para expirar.
- [ ] Início do período: fim do período anterior se pago dentro de 72 h; senão, instante do pagamento (decisão 17).
- [ ] Carência de 72 h: cartão e Pix sim; trial não; Pix pendente não estende; cancelamento ao fim do período sem carência (B-47).
- [ ] Trial de 14 dias iniciado pelo profissional aprovado, sem meio de pagamento, sem conversão automática, um por identidade (HMAC).
- [ ] Cartão: adesão expressa à renovação (texto e versão registrados); Pix exige pagamento manual a cada ciclo.
- [ ] Reconciliação diária só **relata**; nunca corrige acesso sozinha.
- [ ] Ambiente: somente sandbox com dados sintéticos; nenhuma chamada de produção nem cobrança real antes do M4 (B-48, B-53).
- [ ] Estorno/chargeback: bloqueado até L3 `[PENDENTE JURÍDICO]`; dupla aprovação acima de R$ 200,00 (B-09).
- [ ] Tarifas do Mercado Pago não obtidas `[NÃO VERIFICADO]`: nenhum valor de taxa codificado ou exibido como fato.

### 4.5 Notificações (e-mail e site)

- [ ] Todo evento com e-mail previsto gera linha em `email_outbox` com `dedupe_key`; envio via `EmailProviderPort` (I-23).
- [ ] Sem interruptor, tabela de flags, rota ou ponto de ativação; sem reenvio ou backfill de aceites/mensagens antigas (B-50).
- [ ] Dev/teste: envio pelo Resend somente para a conta cadastrada (destino fora dela recusado antes da API); Resend recusa sem domínio verificado/segredo e mantém o item pendente (B-50).
- [ ] Cota por destinatário (dia UTC e mês); alertas em 70, 85 e 95%; aviso a partir de 90/dia e 2.700/mês; reserva `auth` de 10/dia e 300/mês; itens `adiado_cota` reavaliados; limite de 5 envios/s com recuo em 429 (B-49).
- [ ] Link/código de login: enviado na requisição, prioridade máxima, fora do tick, resposta uniforme 202; falha do provedor = fila com recuo, sem duplicação.
- [ ] Agrupamento: cooldown de 15 min por (destinatário, categoria, escopo); primeiro aviso imediato, seguintes em resumo; resumo omitido se já visto; estado rechecado antes de enviar lembrete (selecionado/cancelado não envia).
- [ ] Mensagem automática do aceite **não** aciona e-mail de mensagem não lida.
- [ ] Conteúdo sem dado sensível: sem endereço, telefone, e-mail de terceiros nem conteúdo da conversa (proposta: texto genérico com link ao site).
- [ ] Chat e site funcionam com e-mail degradado (indicador de não lida no site).
- [ ] Textos de lembrete de cobrança ou de fim de trial: sem texto jurídico inventado `[PENDENTE JURÍDICO L2/L3]`.
- [ ] Jobs idempotentes sob lease (SKIP LOCKED); login, aceite e webhook não dependem do tick.

### 4.6 Storage (fotos, documentos de identidade, mídia)

- [ ] Upload em quarentena com URL assinada de uso único; finalize idempotente; reenvio não duplica (F-09).
- [ ] Redução no envio e reencode no servidor: lado ≤ 1.280 px, ≈ 0,5 MB, só a versão reduzida persistida; EXIF removido após aplicar a rotação; tipo pelo conteúdo (B-54, B-56).
- [ ] Máximo de 5 fotos, 6ª recusada na API e no banco (B-55); sem canal de foto extra; sem anexo no chat (B-57).
- [ ] Foto a elegível: URL assinada ≈ 60 s, marca d’água com identificador do profissional, `no-store`, prévia ≈ 320 px na listagem (B-18).
- [ ] Rate limit de visualização por profissional, log de acesso e sinal de raspagem; suspensão cautelar só do acesso a fotos.
- [ ] Documentos de identidade: imagem (reduzida no envio) ou PDF de até 2 MB, até 5 arquivos (provisório); bucket privado; validação por conteúdo; leitura só pela Verificação (B-58). Retenção `[PENDENTE JURÍDICO L1]`.
- [ ] Consumo registrado em `external_quota(storage)`; alertas em 70/85/95% do 1 GB; egress estimado contra 5 GB.
- [ ] Teste de memória e tempo do reencode de 10 MB de entrada (S-06, Q-08); imagem-bomba e arquivo falso recusados.
- [ ] Expurgo de quarentena por TTL técnico (não é prazo legal); `legal_hold` respeitado.

### 4.7 Admin (RBAC, MFA, auditoria, financeiro, moderação)

- [ ] Área admin exige MFA (`aal2`) e permissão por papel na API (403); sem cadastro público de admin; convite.
- [ ] Origem e cookies do admin separados da web.
- [ ] Papéis (Verificação, Moderador, Financeiro, Suporte, Auditor, Superadmin) veem só suas telas `[matriz de telas RF-146 ausente; AMB-08 A como base]`.
- [ ] Acesso a conversa/documento somente via `access_case`: justificativa, aprovação por outra pessoa, validade curta, log por leitura (B-07).
- [ ] Toda ação crítica audita na mesma transação; Auditor somente leitura (B-08).
- [ ] Dupla aprovação: estorno acima de R$ 200,00 (20000 centavos) e suspensão permanente; aprovador diferente do solicitante; R$ 200,00 exatos = uma aprovação (B-09).
- [ ] Moderação de avaliação: só por denúncia/contestação (e suspeita de fraude); decisão fundamentada, log e recurso; sem remoção automática (D4; AMB-12).
- [ ] Verificação de profissional: decisões com ator e data; duplicidade de CPF/CNPJ vai para retenção com explicação e recurso, nunca bloqueio definitivo automático.
- [ ] Painel operacional sem PII (somente agregados).
- [ ] Admin sem perfil de cliente ou profissional (I-19).

### 4.8 Outros tipos recorrentes

- **Geo/Mapbox:** B-51; célula ≈ 500 m; raio de 5 a 100 km, fora da faixa recusado; online com alcance nacional; cobertura booleana com cache e rate limit.
- **Chat:** texto idempotente, sem editar/excluir; conversa somente leitura nega envio; restrição de segurança prevalece; Realtime só publica IDs e há contingência por polling.
- **Ciclo de vida do pedido:** seleção só de participante com aceite ativo; uma seleção ativa; conclusão só pelo cliente com confirmação; correção em até 24 h (limite inclusivo, relógio do banco); uma republicação ativa por cadeia; só republica pedido **expirado ou cancelado** (decisão 38).
- **Avaliação:** só do selecionado após conclusão válida; uma por pedido; autor exibido como "Cliente do FastPro"; média com 1 casa ou "Ainda sem avaliações".
- **Infra/CI/Hosting:** Hobby apenas em dev; nada cobrável no Hobby; healthcheck; nenhum segredo em variável pública do cliente (prefixo público só para valores públicos por natureza).

---

## 5. Critérios de aprovação e evidência exigida

`APROVADO_TECNICAMENTE` exige a evidência da linha correspondente. Evidência = artefato verificável no SHA revisado (log de CI, relatório de teste, arquivo de teste, captura, consulta SQL). **Nada é dado como executado sem registro.**

| Tipo | Evidência mínima exigida |
|---|---|
| Todo PR | SHA revisado; CI verde (links de job); lista critério de aceite e teste correspondente; saída da varredura de segredos |
| API | Testes de chamada direta: sucesso, 401/403/404 (IDOR), 422 de corpo inválido, idempotência (retry), concorrência quando aplicável; prova de que a resposta não contém campos sensíveis |
| Banco/migração | Log da migração do zero e incremental; pgTAP verde; teste de catálogo de RLS; monitores de invariante retornando zero; plano de rollback |
| UI | Saída da varredura de hex (zero ocorrências); capturas claro/escuro; roteiro de teclado e foco; verificação de contraste dos tokens; leitor de tela nos fluxos tocados; estados vazio/erro/carregando |
| Billing | Testes B-01 a B-10 relevantes (relógio controlado); webhook duplicado/fora de ordem/assinatura inválida; evidência de sandbox, sem chamada de produção |
| Notificações | N-01 a N-10 relevantes (Resend, somente para a conta cadastrada); simulação de cota (Q-10/Q-11); ausência de interruptor/backfill verificada na revisão (N-07 sem teste automático) |
| Storage | P-01 a P-06 relevantes: 6ª foto recusada; Storage sem original; EXIF ausente; dimensões e bytes dentro do teto; URL expira |
| Admin | T-08: sem MFA nega, papel inadequado nega, autoaprovação nega, leitura sem `access_case` nega, log gerado |
| Concorrência (aceite, seleção, republicação, webhook) | Execução com N de pelo menos 100 iterações e monitores de invariante sem violação (C-xx e F-xx citados) |
| Serviço externo novo | Limite do plano gratuito citado (fonte do `13` ou marcado como não verificado), métrica e alerta de cota, plano de degradação |
| Spike | Saída registrada (resposta à pergunta do spike), sem criar recurso de produção |

**Itens não verificados:** se a aprovação depende de limite ou comportamento ainda não verificado (PostGIS no Free, formato de `x-signature`), o Reviewer só aprova se o PR trata o ponto com fallback testado ou se o Orquestrador registrar o risco aceito. Não aprova por suposição.

---

## 6. O que o Reviewer NÃO pode decidir

O Reviewer registra a dúvida no relatório ao Orquestrador (alternativas + recomendação). Não bloqueia por preferência pessoal nem aprova por conta própria nestes pontos.

1. **Escopo de produto:** adicionar, remover ou reinterpretar funcionalidade, regra de negócio, preços, número de vagas (4+4), prazos (7 dias, 14 dias de trial, 24 h, 72 h), planos, textos de produto ou fluxos. As decisões 1 a 40 e o PRD vigente são a referência; divergência é achado, mas mudar a regra é do usuário/PO.
2. **Reabrir decisões do usuário** (oferta extinta, boleto, anexos no chat, Mapbox permanente, Vercel Pro ao cobrar). O Reviewer só verifica a conformidade.
3. **Texto jurídico** e pendências L1 a L7: termos de uso, aviso "FastPro apenas conecta", privacidade, retenção, reembolso, selo "verificado", lembrete de cobrança. Não aprova nem redige; marca `[PENDENTE JURÍDICO]`.
4. **Contratar ou pagar serviço**, criar conta/chave, trocar a stack ou o provedor (BLQ-EXEC/BLQ-DEC).
5. **Aceite humano:** CONCLUIR, BLOQUEAR, merge, deploy produtivo, mover o Project. Só o usuário (AGENTS.md, itens 4 e 5).
6. **Valores propostos** (limites de duplicidade, tamanhos provisórios de documento, SLAs): pode apontar inconsistência, não fixar o valor.
7. **Textos de interface sem aprovação** (e-mails e demais mensagens): sinalizar, não fixar.
8. **Abrir exceção a critério da §2**, rebaixar BLOQUEADOR ou aceitar risco residual: só o Orquestrador, com registro.
9. **Corrigir o código:** o Reviewer descreve o achado; o DEV corrige.
10. **Afirmar como fato limites de serviço não verificados:** pedir a verificação (S-08).

---

## 7. Verificações automatizáveis sugeridas `[PROPOSTA]`

Nenhuma foi implementada ou executada. Planejar em H-004 (CI), H-002 (tokens), H-003/H-115 (banco e autorização), H-117 (concorrência), H-007/H-120 (PII). Padrões são pontos de partida; ajustar à stack real e medir falsos positivos.

### 7.1 Varredura de hex e cores literais (B-32, B-33)
- Falhar o build se houver, fora de `packages/tokens` e dos testes de contraste, hex de 3 a 8 dígitos precedido de cerquébec, funções `rgb`, `rgba`, `hsl`, `hsla` e `oklch`, nomes de cor CSS em propriedades de cor e classes utilitárias com valor arbitrário de cor.
- Critério: a busca (ripgrep) sobre arquivos ts, tsx, css, scss, js, jsx e svg, excluindo `packages/tokens`, retorna saída vazia.
- Lint (ESLint/Stylelint) com regra proibindo cor literal, inclusive em objetos de estilo; SVG com `fill`/`stroke` literal deve usar `currentColor` ou token.
- Teste de tema: renderizar nos temas claro e escuro e calcular o contraste dos pares texto/fundo a partir dos tokens.

### 7.2 Tipografia (B-34)
- Varredura de `font-family` diferente de Roboto e de `font-weight` fora de 400, 500 e 700 (lint de CSS ou regex PCRE).
- Teste que lista os arquivos de fonte carregados e falha se aparecer outra família ou peso.

### 7.3 Segredos e `.gitignore` (B-39, B-40)
- Secret scanning no CI e em pré-commit (ferramenta gratuita, ex.: gitleaks ou equivalente), com regras para chaves de Supabase, Mercado Pago, Resend, Mapbox, `service_role`, e execução também sobre o histórico do PR.
- Teste que garante `.env.local` (e arquivos `.env` com sufixo local) no `.gitignore` e falha se algum `.env*` com valores estiver versionado (única exceção: `.env.example` sem valores).
- Varredura dos bundles de web, admin e mobile por padrões de segredo e por `service_role`; lista permitida para variáveis com prefixo público.

### 7.4 PII em logs (B-41)
- Executar os fluxos de teste e varrer toda a saída de log por padrões de e-mail, telefone BR, CPF/CNPJ, JWT/token e cabeçalhos sensíveis; qualquer ocorrência reprova (T-11).
- Lint que proíbe `console.log` em código de servidor e obriga o logger estruturado com allowlist.

### 7.5 Banco e RLS (B-02 a B-04, B-22, B-54, B-57)
- pgTAP: toda tabela de domínio com RLS habilitada e forçada; nenhuma tabela legível por `anon`/`authenticated` sem política; funções `SECURITY DEFINER` com `search_path` fixo.
- Teste de catálogo de ausência: colunas de preço/valor/prazo em pedido, aceite e mensagem (T-17); bucket `chat-attachments`, tabela `message_attachment` e `media_asset` de mensagem (M-02); coluna de original em `media_asset` (P-04); boleto em enum ou tabela; interruptor ou flag de e-mail (N-07, verificado na revisão).
- Monitores de invariante I-01 a I-30 (consultas que retornam zero linhas) ao fim da suíte e diariamente.
- Teste de paridade API e banco gerado a partir da `access-matrix` (T-06).
- CI falha se a migração não subir do zero em Postgres efêmero.

### 7.6 Concorrência e idempotência (B-22 a B-28)
- Suíte C-01 a C-18 e F-01 a F-12 com pelo menos 100 iterações e requisições realmente simultâneas: 9º aceite com muitos profissionais ao mesmo tempo, clique duplo em "Chamar mais profissionais", seleção dupla, republicação dupla, retry de mensagem 5 vezes, webhook duplicado e fora de ordem, aceite no limite exato do prazo.
- Relógio do banco controlado para prazos (7 dias, 24 h, 72 h) e limites inclusivos.
- Injeção de falha no meio das operações compostas (F-01, F-02, F-10) comprovando rollback total.

### 7.7 Serviços externos e limites (B-45 a B-53)
- Provedores simulados (Mapbox, Mercado Pago, Resend) em teste; falha se houver chamada de rede externa em dev/CI (bloqueio de egress na suíte).
- Testes de cota de e-mail (Q-10, Q-11, N-08) e de Mapbox permanente (G-01 a G-06) com contadores.
- Teste que garante o provedor de e-mail local em dev/CI e a recusa do adapter Resend sem domínio/segredo (N-09, N-10).
- Assinatura de webhook com casos inválidos, repetidos e adulterados (T-09).
- Lint de dependências: proibir SDK de serviço pago não aprovado.

### 7.8 Mídia (B-54 a B-58)
- Upload de arquivo de 10 MB, falso por extensão, imagem-bomba, HEIC e a 6ª foto; conferir dimensões, bytes e EXIF do objeto final e inspecionar o Storage de teste (P-01 a P-06).
- Teste de rotas e buckets do chat (M-01, M-02).

### 7.9 Acessibilidade (B-35, B-36)
- Verificação automatizada de a11y (ferramenta gratuita, ex.: axe) nas telas tocadas, **como triagem**: não substitui roteiro manual de teclado e leitor de tela, e não autoriza declarar conformidade.
- Busca por WCAG nos docs e na UI sem evidência anexa.

### 7.10 Higiene geral
- Template de PR exigindo história e RF/FA/I-xx.
- Checagem de que testes novos referenciam IDs existentes do `11-ARQ`.
- Auditoria de dependências (T-14) e atualização de bibliotecas de imagem (R-25).

---

## 8. Foco da revisão por onda

| Onda | Foco |
|---|---|
| 0 | Segredos e `.gitignore`; CI; tokens (H-002); RLS desde a primeira tabela; spikes sem criar recurso de produção |
| 1 | Login: B-10, B-11; anti-enumeração; sessão |
| 2 | Geo/Mapbox (B-51); fotos (B-54 a B-56); localização (B-16); opt-in de telefone (B-15); verificação (B-13, B-58) |
| 3 (M1) | **Núcleo:** vagas (B-22 a B-25), chat (B-19, B-57), mensagem de sistema, fotos a elegíveis (B-18) |
| 4 (M2) | Billing (B-45 a B-48), seleção/cancelamento/republicação (B-26, B-28, B-29), cotas de e-mail (B-49, B-50) |
| 5 (M3) | Admin (B-07 a B-09), avaliação, retenção, a11y com evidência (B-36), suíte completa de concorrência |
| Gate M4 | Itens de H-054 e H-121: domínio no Resend, Vercel Pro, backup, tarifas MP, L1 a L4 e L7. **Aprovação técnica não substitui o CONCLUIR humano** |

---

## 9. Premissas e dúvidas ao Orquestrador

Sem perguntas bloqueantes. Premissas `[PROPOSTA]` adotadas, revogáveis:

1. **Teto de foto:** tratado como ≈ 0,5 MB e ≤ 1.280 px, com teto técnico configurado ≈ 0,75 MB (do `11-ARQ`, P-03 e Q-12). Se o Architect fixar outro teto, ajustar B-54.
2. **EDS mestre não recebido:** B-37 e a verificação de tokens valem pela síntese do `04`. Quando o EDS chegar, revisar B-32 a B-37.
3. **Inconsistências documentais a corrigir pelo líder (achados A-1 e A-5 do `14`):** AMB-33 e AMB-30 ainda constam como abertas no `07`, embora respondidas pelas decisões 34 e 26. Mapbox permanente tratado como aprovado (decisão 36).
4. **Status de decisão:** usa-se APROVADO_TECNICAMENTE e AJUSTES_NECESSARIOS do papel canônico.
5. **Itens não verificados** (PostGIS/pg_cron/pg_net no Free, `x-signature` do Mercado Pago, tarifas MP, canal privado do Realtime, termos de produto do Mapbox, MFA gratuito) devem ser fechados nos spikes S-01 a S-11 antes de a revisão tratá-los como fato.
