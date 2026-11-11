# Refino S-08 — Verificação oficial dos limites gratuitos (Issue #13, spike, WF-03, Product Owner)

- **Rastro:** Issue #13 `[Spike] Verificação oficial dos limites gratuitos` (21-ISSUES-CRIADAS; 16-MANIFESTO item 10; 14-BACKLOG, linha S-08); 19-PLANO-TECNICO-DEV §4 (S-08) e §4.1; 11-ARQ-RISCOS-E-TESTES §6 (S-08) e §10 (testes Q-xx); ADR-020 (10-ADRS, §20.1 e §20.3); ADR-018, ADR-022, ADR-007, ADR-008; 13-VERIFICACAO-SERVICOS (dados de partida, acesso 2026-11-09); decisões 28 e 29 (11-DECISOES); BK-1, BK-2, BK-3, BK-6 (14-BACKLOG §Bloqueios).
- **Natureza:** SOMENTE documento. Spike de **leitura**. Não cria conta, chave, projeto, cartão ou sandbox; não faz chamada paga; não altera código, ADR, Project ou Issue.
- **Fonte desta rodada:** nenhuma consulta externa foi feita neste refinamento. Todo valor citado abaixo é **herdado** de 13-VERIFICACAO-SERVICOS e precisa ser reconfirmado pelo spike S-08 na página oficial, com data própria de acesso.
- **Etiquetas:** `[APROVADO]` regra ou decisão já aprovada, ou regra da fábrica; `[DELEGADO]` decisão delegada já registrada; `[PROPOSTA]` proposta deste refino (pendente de confirmação do Orquestrador). Status de cada número: `VERIFICADO` (lido na página oficial, com URL e data) ou `NÃO VERIFICADO` (com motivo).

---

## 1. Critérios de aceite (Given/When/Then)

### 1.0 Regras de registro (valem para os cinco serviços)

- **CA-S08-00a Fonte por número [APROVADO; AGENTS.md item 8; ADR-020 "devem ser verificados na página oficial"].** Dado um limite, preço, cota ou prazo, quando o spike grava o valor, então a linha traz: valor literal da página, unidade e período, URL oficial **completa** (sem reticências), data de acesso (AAAA-MM-DD) e status. Sem esses campos, o número não entra na tabela.
- **CA-S08-00b Status [APROVADO].** Dado um item lido diretamente na página oficial, quando a página confirma o valor, então o status é `VERIFICADO`. Dado um item sem valor na página, ou página com 403/indisponível, ou conteúdo que veio só de resumo automático, então o status é `NÃO VERIFICADO` com motivo literal (ex.: "403 em AAAA-MM-DD na URL X"; "não listado na página Y"; "resumo automático, não lido na íntegra"; "PDF externo não lido").
- **CA-S08-00c Sem preenchimento por memória [APROVADO].** Dado um valor que existe só em ADR-020, em 13 sem URL completa ou na memória do agente, quando não aparece em fonte oficial lida nesta sessão, então não é copiado como `VERIFICADO`. Permanece `NÃO VERIFICADO` e a divergência entra na lista da seção 4.
- **CA-S08-00d Reconfirmação dos valores herdados [PROPOSTA].** Dado um item herdado do doc 13 (acesso 2026-11-09), quando o spike reabre a página, então registra "reconfirmado em AAAA-MM-DD" ou "divergente: valor novo X (fonte Y)". Sem reabertura, o item não passa de "herdado".
- **CA-S08-00e Sem conta para ler [APROVADO; BLQ-EXEC / SD-14 / BK-6].** Dado um limite que só aparece dentro do painel (conta, cartão, projeto), quando o spike não tem autorização de execução, então o item fica `NÃO VERIFICADO` com motivo "exige conta (BLQ-EXEC)". Nada é criado para ler.
- **CA-S08-00f Resumo não é fonte [APROVADO].** Dado um conteúdo obtido por resumo ou leitor automático, quando usado, então é marcado "a reconfirmar" e não conta como `VERIFICADO`.

### 1.1 Vercel (hospedagem de web, admin e API)

Itens mínimos. Valores herdados do doc 13 (página de origem: vercel.com/pricing, /docs/plans/hobby, /docs/limits, /docs/cron-jobs/usage-and-pricing, /docs/frameworks/backend/nestjs).

| Item | Valor herdado | Status de partida |
|---|---|---|
| Hobby: uso comercial | Só uso pessoal não comercial; "processar pagamento de visitantes" conta como comercial | VERIFICADO (herdado) |
| Pro | US$ 20/mês + US$ 20 por seat de desenvolvedor; crédito de uso de US$ 20 | VERIFICADO (herdado) |
| Hobby: limites | Funções até 300 s; 2 GB / 1 vCPU; 1.000.000 invocações/mês; 100 GB de banda; 100 deploys/dia; logs de runtime 1 h | VERIFICADO (herdado) |
| Cron | Hobby: no máximo 1 execução/dia (precisão ±59 min); Pro: 1/minuto | VERIFICADO (herdado) |
| NestJS | Suportado como uma função única (Fluid compute); bundle até 250 MB | VERIFICADO (herdado) |
| Corpo de requisição/resposta da função | Não consta em 13 | NÃO VERIFICADO |
| Limite de projetos por conta | Não consta em 13 | NÃO VERIFICADO |
| Banda: a resposta de foto servida pela API conta nos 100 GB? | Não consta em 13 (pergunta aberta) | NÃO VERIFICADO |
| Fair use (/docs/limits/fair-use-guidelines) | Lido em 13 sem valor numérico | Registrar o trecho relevante ou "sem número" |

- **CA-S08-01a Uso comercial [APROVADO; ADR-018 R-28; decisão 28].** Dado a página de plano Hobby, quando o spike lê a cláusula de uso comercial, então registra o trecho literal, a URL e a data; status `VERIFICADO`. Se a cláusula mudou, registra "divergente" e para na seção 4.
- **CA-S08-01b Preço do Pro [APROVADO; decisão 28].** Dado a página de preços, quando o spike lê o Pro, então registra US$ 20/mês, US$ 20 por seat e crédito de US$ 20 com data. Se a página mostrar outro valor, registra o novo como `VERIFICADO` e marca "divergente".
- **CA-S08-01c Limites do Hobby [PROPOSTA].** Dado a página de limites, quando lida, então cada item da tabela vai como `VERIFICADO` com valor literal. Corpo, limite de projetos e banda da resposta de foto ficam `NÃO VERIFICADO` com motivo "não consta na página X".
- **CA-S08-01d Cron [PROPOSTA; ADR-018 item 3].** Dado a página de cron, quando lida, então registra "1 por dia no Hobby, ±59 min" e a nota de que o cron não substitui o tick de jobs (decisão já tomada em ADR-018; o S-08 só registra o número).
- **CA-S08-01e NestJS [PROPOSTA].** Dado a página do framework, quando lida, então registra o suporte como função única e o limite de 250 MB.

### 1.2 Supabase (plano Free)

| Item | Valor herdado | Status de partida |
|---|---|---|
| Pausa por inatividade | Após 1 semana sem atividade | VERIFICADO (herdado; ler a frase literal) |
| Projetos ativos | 2 | VERIFICADO (herdado) |
| Banco | 500 MB | VERIFICADO (herdado) |
| Storage | 1 GB; upload máximo 50 MB | VERIFICADO (herdado) |
| Egress | 5 GB | VERIFICADO (herdado) |
| Usuários ativos mensais (MAU, Auth) | 50.000 | VERIFICADO (herdado) |
| Realtime | 200 conexões simultâneas; 2 milhões de mensagens/mês | VERIFICADO (herdado) |
| Edge Functions | 500.000/mês (sem uso previsto no desenho; registrar) | VERIFICADO (herdado) |
| Logs | 1 dia | VERIFICADO (herdado) |
| Conexões de banco | 60 diretas; 200 pelo pooler | VERIFICADO (herdado) |
| Backup | Nenhum no Free; backup diário só no Pro | VERIFICADO (herdado) |
| SMTP customizado | Incluído no Free | VERIFICADO (herdado), mas a URL exata não está no doc 13: registrar |
| Pro | A partir de US$ 25/mês | VERIFICADO (herdado) |
| Limite de e-mails do Auth (nativo e com SMTP próprio) | Não encontrado | NÃO VERIFICADO |
| PostGIS, pg_cron e pg_net no Free | Não encontrados na documentação lida | NÃO VERIFICADO |
| MFA TOTP no Free (ADR-012) | Não consta | NÃO VERIFICADO |
| Auth Hook de token com claim `sid` (ADR-005; S-01 passo 4) | Não consta | NÃO VERIFICADO |

- **CA-S08-02a Limites do Free [PROPOSTA].** Dado a página de preços e as páginas de cobrança e de tamanho, quando lidas, então cada item acima vai como `VERIFICADO` com URL completa e data, ou `NÃO VERIFICADO` com motivo.
- **CA-S08-02b Pausa e backup [APROVADO; ADR-020 §20.3; H-010].** Dado a página de pausa, quando lida, então registra a frase literal sobre a inatividade. Dado a página de backups, quando lida, então registra "sem backup no Free" e "diário só no Pro". O S-08 não decide o keep-alive (isso é do S-10/H-010).
- **CA-S08-02c Extensões [PROPOSTA; S-02].** Dado a busca por PostGIS, pg_cron e pg_net, quando não aparecem na documentação de planos, então ficam `NÃO VERIFICADO` com motivo "não listado em [URLs lidas]". O S-08 não afirma disponível nem indisponível. A confirmação é do S-02R, no painel do projeto (BLQ-EXEC).
- **CA-S08-02d Auth [PROPOSTA; ADR-020 linha Supabase Auth].** Dado o MAU de 50.000 verificado, quando o spike conclui, então a linha "dezenas de milhares de MAU" de ADR-020 é marcada como a corrigir (seção 4). Dado o limite de e-mail do Auth não encontrado, então a linha fica `NÃO VERIFICADO`.
- **CA-S08-02e Itens de desenho [PROPOSTA].** MFA TOTP e Auth Hook (`sid`) são lidos como pendências de leitura, sem conta. Se não aparecerem na documentação, ficam `NÃO VERIFICADO`, e o caminho alternativo fica registrado (ADR-012; S-01 Caminho 3).

### 1.3 Resend (e-mail transacional)

| Item | Valor herdado | Status de partida |
|---|---|---|
| E-mails por dia | 100, dia UTC (não janela móvel de 24 h) | VERIFICADO (herdado) |
| E-mails por mês | 3.000 | VERIFICADO (herdado) |
| Contagem | Cada destinatário (To/CC/BCC) conta separado; envio e recebimento contam; e-mails de teste (`resend.dev`) também consomem cota | VERIFICADO (herdado) |
| Domínios verificados (grátis) | 3 | VERIFICADO (herdado) |
| Retenção de logs | 30 dias | VERIFICADO (herdado) |
| Rate limit | 10 req/s por time; acima, 429 | VERIFICADO (herdado); formato exato do erro de cota/429: NÃO VERIFICADO (é do S-11) |
| SMTP | `smtp.resend.com`; portas 25/465/587/2465/2587; usuário `resend` | VERIFICADO (herdado) |
| Supabase Auth com SMTP do Resend | Passo a passo oficial; domínio verificado é pré-requisito | VERIFICADO (herdado) |
| Domínio verificado para enviar | Texto da página: "You must add and verify at least one domain to send emails with Resend" | VERIFICADO (citar o texto literal) |
| Envio a e-mail real sem domínio verificado (premissa T8) | Não confirmado na fonte | NÃO VERIFICADO |
| Plano Pro, linha 1 | US$ 20/mês, 50.000 e-mails/mês, sem limite diário, 10 domínios | NÃO VERIFICADO (divergência, ver linha 2) |
| Plano Pro, linha 2 | US$ 35/mês, 100.000 e-mails, sem explicação da diferença, na mesma página | NÃO VERIFICADO (divergência) |
| Endereços de teste | `delivered@`, `bounced@`, `complained@`, `suppressed@resend.dev` | VERIFICADO (herdado) |

- **CA-S08-03a Cota diária e mensal [PROPOSTA; ADR-022; I-24; N-08].** Dado a página de limites de envio, quando lida, então registra 100/dia em UTC, 3.000/mês, a regra de contagem por destinatário e a regra de teste. Os limiares de alerta (70/85/95%, ≥ 90/dia, ≥ 2.700/mês) continuam `[PROPOSTA]`; o S-08 não os aprova.
- **CA-S08-03b Domínio [APROVADO; ADR-022; decisão 15; R-33].** Dado a página de domínios, quando lida, então registra o texto literal "domínio verificado para enviar" e o número de domínios grátis.
- **CA-S08-03c Premissa de teste sem domínio [APROVADO como restrição; S-11].** Dado que nenhuma página lida confirma o envio sem domínio, quando o spike termina, então a linha fica `NÃO VERIFICADO`. O desenho usa Mailpit em dev e CI (I-27), e nenhum documento trata T8 como fato.
- **CA-S08-03d Plano pago com divergência [PROPOSTA].** Dado a página de preços com duas linhas Pro diferentes, quando o spike lê, então registra as duas literalmente, marca `NÃO VERIFICADO` e não escolhe uma. Se a página trouxer a explicação, registra a explicação com URL.
- **CA-S08-03e Rate limit [PROPOSTA; H-094].** Dado a página de limites, quando lida, então registra 10 req/s e o código 429. O formato do corpo de erro fica para o S-11, e o S-08 marca essa parte `NÃO VERIFICADO`.

### 1.4 Mapbox (busca de endereço, coordenadas e mapas)

| Item | Valor herdado | Status de partida |
|---|---|---|
| Geocodificação temporária | 100.000 requisições/mês grátis | VERIFICADO (herdado; docs.mapbox.com/api/search/geocoding) |
| Autocomplete | Cada tecla digitada conta como requisição | VERIFICADO (herdado) |
| Armazenamento | "Resultados temporários não podem ser armazenados em cache; resultados permanentes podem ser armazenados indefinidamente" | VERIFICADO (herdado; citar literal) |
| Geocodificação permanente (`permanent=true`) | US$ 5 por 1.000 (US$ 4 acima de 500 mil); sem faixa gratuita; cartão cadastrado | VERIFICADO (herdado; reconfirmar a exigência de cartão na página de preços) |
| Mapas (GL JS) | 50.000 loads/mês grátis | VERIFICADO (herdado) |
| Address Autofill | 1.000 sessões/mês grátis (alternativa não adotada em ADR-008) | VERIFICADO (herdado) |
| Termos de produto (PDF externo) | Não lidos | NÃO VERIFICADO (é do S-04) |
| Alertas e limite de gasto na conta | Não consta | NÃO VERIFICADO (exige conta; BLQ-EXEC) |

- **CA-S08-04a Temporário [APROVADO; ADR-008; I-28].** Dado a página de geocodificação, quando lida, então registra a cota temporária, a regra de contagem por tecla e a frase sobre cache. O S-08 não decide o que "armazenar" significa (isso é do S-04).
- **CA-S08-04b Permanente [APROVADO como restrição; decisão 29; BLQ-DEC BK-2; A-3].** Dado a página de preços, quando lida, então registra US$ 5/1.000, a faixa de US$ 4, a ausência de faixa gratuita e a exigência de cartão. Se o cartão não aparecer, fica `NÃO VERIFICADO`. O S-08 não aprova o uso pago; a decisão 29 precisa de confirmação do usuário antes de H-021.
- **CA-S08-04c Mapas e autofill [PROPOSTA].** Dado a página de preços de mapas e de autofill, quando lida, então registra 50.000 loads e 1.000 sessões, com a nota de que o autofill não é a escolha atual.
- **CA-S08-04d Termos e alertas [PROPOSTA].** Dado o PDF de termos e a configuração de alertas, quando não lidos, então ficam `NÃO VERIFICADO` com motivo, sem interpretação.

### 1.5 Mercado Pago (cobrança de assinatura e Pix)

| Item | Valor herdado | Status de partida |
|---|---|---|
| Tarifas Pix e cartão | Não obtidas: página de custos retornou 403 em 2026-11-09 (URL não registrada em 13) | NÃO VERIFICADO (403) |
| Mensalidade da conta | Não encontrada | NÃO VERIFICADO |
| Assinatura recorrente por API | Semanal, mensal e anual; URL registrada em 13 está truncada ("…/subscriptions/...") | VERIFICADO (herdado) só após registrar a URL completa |
| Pix como meio de assinatura | Citado como meio | VERIFICADO (herdado) |
| Pix Automático | Não encontrado | NÃO VERIFICADO |
| Período de testes | Citado sem duração nem exigência de cartão | NÃO VERIFICADO |
| Webhooks | Tópicos `subscription_preapproval` e `subscription_authorized_payment`; cabeçalho `x-signature`; reenvio a cada 15 min | NÃO VERIFICADO (resumo automático, a reconfirmar) |
| Limites de taxa da API | Não consultados | NÃO VERIFICADO |

- **CA-S08-05a Tarifas [APROVADO; ADR-007; decisão de gate H-054].** Dado a página de custos devolvendo 403, quando o spike tenta, então registra o 403 com URL, data e tentativa; não substitui por valor de memória nem por simulador. O S-08 não obtém tarifas por caminho alternativo: isso é do S-03, com autorização.
- **CA-S08-05b Recorrência [PROPOSTA; S-03].** Dado a página de assinaturas, quando lida, então registra os tipos (semanal, mensal, anual) com URL completa. A recorrência por ciclo de 1, 3, 6 e 12 meses é decisão do S-03, não do S-08.
- **CA-S08-05c Webhook [PROPOSTA; ADR-007 risco 2].** Dado a página de webhooks, quando lida, então registra tópicos, cabeçalho e reenvio com a frase literal. Sem leitura direta, o item segue `NÃO VERIFICADO`.
- **CA-S08-05d Pix Automático e teste [PROPOSTA].** Dado a busca por Pix Automático e a página de período de testes, quando não há detalhes, então ficam `NÃO VERIFICADO` com motivo.

### 1.6 Entrega do spike e atualização do registro

- **CA-S08-06a Tabela única [APROVADO; 19 §4 S-08].** Dado a conclusão do spike, quando a tabela é escrita, então cada linha tem: serviço, item, valor, unidade, URL completa, data de acesso, status e coluna "mudou desde 13" (sim, não ou não reconfirmado).
- **CA-S08-06b Divergências [PROPOSTA].** Dado uma divergência entre fonte oficial e ADR-020 ou outro documento interno, quando encontrada, então entra na lista da seção 4 para o Architect. O spike não reescreve ADR sem autorização (D-S08-6).
- **CA-S08-06c Repetição [APROVADO; 19 §4 S-08; H-121].** Dado o Gate M4 ou a primeira cobrança real se aproximando, quando o spike é repetido, então a data e o resultado da nova leitura são registrados. Uma tabela com mais de uma data não substitui a anterior: ambas ficam.
- **CA-S08-06d Pronto [PROPOSTA].** O spike está pronto quando: (a) os cinco serviços têm todas as linhas da seção 1 `VERIFICADO` ou `NÃO VERIFICADO` com motivo; (b) nenhum número sem URL completa e data; (c) divergências da seção 4 têm resposta do Architect ou ficam como pendência; (d) nada foi criado nem cobrado.

---

## 2. O que o resultado precisa liberar

Regra de leitura: "Se VERIFICADO" = a linha vira base de decisão. "Se NÃO VERIFICADO" = o item bloqueia a decisão listada e não pode ser assumido.

| # | Serviço e item | Histórias que dependem | Se VERIFICADO | Se NÃO VERIFICADO |
|---|---|---|---|---|
| 1 | Vercel: uso comercial do Hobby; preço do Pro | H-054 (gate de cobrança), H-009 (Hobby só em dev), H-121 (checklist), R-28 | Cobrança só no Pro, antes da primeira cobrança | Cobrança real segue bloqueada (já é a regra); dev não muda |
| 2 | Vercel: duração, memória e bundle da função; cold start (S-09) | H-009, H-027 (reencode ≈ 0,5 MB), H-056 (marca d'água), S-09 | Reencode e marca d'água cabem na função | S-09 pode forçar ADR-018 B, C ou D (SD) |
| 3 | Vercel: cron de 1 por dia | H-008 (tick), H-099 (lembretes), S-10 | Confirma que o cron Vercel não é tick; escolha A/B/C por S-10 | S-10 decide sem o número |
| 4 | Vercel: corpo/resposta da função; banda de 100 GB; limite de projetos | H-026, H-055, H-056 (fotos pela API), H-009 (web, admin e API) | Dimensiona a entrega de fotos pela API | Não assumir; medir no S-09 |
| 5 | Vercel: logs de runtime de 1 h | H-007, H-108 (painel), ADR-013 | Exige registro próprio de eventos em vez do log da plataforma | Idem |
| 6 | Supabase: pausa de 1 semana; sem backup no Free | H-010 (keep-alive e backup), H-119 (restauração), H-054, R-08 | Backup manual e keep-alive obrigatórios antes de dados reais | Bloqueia dados reais e cobrança |
| 7 | Supabase: banco 500 MB; Storage 1 GB; upload 50 MB | H-003, H-005 (esquema), H-026/H-027 (fotos), H-037 (documentos, BK-1), H-108 (alertas 70/85/95%), Q-12, R-35 | Base dos gatilhos de Storage e banco | Gatilhos não calibrados |
| 8 | Supabase: egress 5 GB; Realtime 200 conexões e 2 mi mensagens | H-055, H-056, H-057 (fotos), R-37, Q-13; H-070 (Realtime, S-05), F-06 | Dimensiona a entrega de fotos; Realtime como sinal | Polling como padrão até medir |
| 9 | Supabase: MAU 50.000; limite de e-mail do Auth | H-011, H-016 (cadastro e login), H-097 (login por e-mail, S-11) | MAU confirma a base de clientes | Limite do Auth não serve de premissa: o login usa o SMTP do Resend |
| 10 | Supabase: PostGIS, pg_cron, pg_net no Free | H-022 (geo), H-008 (tick), H-003 (esquema final), S-02 | S-02R confirma no painel | Geo sem PostGIS (fallback por célula) e tick por B ou C |
| 11 | Supabase: MFA TOTP no Free | H-102, H-103 a H-108 (admin) | Admin com MFA como previsto | Revisar ADR-012 |
| 12 | Supabase: claim `sid` por Auth Hook no Free | S-01, H-014 (sessão e revogação), H-012 | Caminho 1 do ADR-005 | Caminho 3 (JWT pela API) |
| 13 | Supabase: logs de 1 dia; conexões 60 diretas e 200 pooler | H-007, H-108; H-005, H-009, S-09 (uma conexão por invocação) | Confirma a necessidade de pooler em modo transação | Idem |
| 14 | Resend: 100/dia (UTC), 3.000/mês, contagem por destinatário, teste conta | H-094 (contador e alertas), H-097, H-011, H-096, N-08 | Limiares de alerta e reserva são calibrados contra número verificado | Limiares continuam PROPOSTA |
| 15 | Resend: domínio verificado para enviar; 3 domínios grátis | H-093 (adapter recusa envio), H-121, BK-10 (domínio antes do M4) | Confirma o bloqueio de envio real até o domínio | Idem: nenhum envio real |
| 16 | Resend: envio sem domínio (T8) | H-093, N-10, S-11 | Premissa de teste real pode ser usada | Não usar; testes via Mailpit (já é o desenho) |
| 17 | Resend: plano Pro (duas linhas divergentes); 429 | Gatilho de upgrade (ADR-022, ≥ 70% da cota), H-054 (custo), H-094 (≤ 5 envios/s), S-11 | Decisão de upgrade com número | Upgrade não pode ser decidido por número |
| 18 | Mapbox: temporário 100.000/mês; cada tecla conta; não cachear | H-020 (autocomplete; mínimo de 3 caracteres e debounce), F-05, G-01, I-28 | Limite de digitação e debounce calibrados | Revisar H-020 |
| 19 | Mapbox: permanente US$ 5/1.000; sem faixa; cartão | H-021 (BLQ-EXEC cartão; BLQ-DEC BK-2; A-3), H-054, R-36, V-16 | Custo por pedido e teto de chamadas verificados | H-021 não inicia; a decisão 29 continua sem número |
| 20 | Mapbox: mapas 50.000; autofill 1.000 | H-036 (base e raio, se usar mapa interativo; não identificado no 14), ADR-008 (alternativa) | Confirma que o mapa cabe no gratuito | Verificar antes de usar mapa interativo |
| 21 | Mercado Pago: tarifas Pix e cartão; mensalidade | H-054 (gate, "tarifas MP confirmadas"), H-047, H-048, H-121, V-8, ADR-007 | Margem calculável | H-054 fica fechado; sem decisão de margem |
| 22 | Mercado Pago: assinatura por API (semanal, mensal, anual); Pix Automático | H-047 a H-052 (S-03 cruza com recorrência por ciclo); ADR-007 (fallback avulso) | Modelo com assinatura confirmado | Fallback avulso por ciclo |
| 23 | Mercado Pago: webhooks (tópicos, `x-signature`, reenvio 15 min) | H-048, H-050, H-053 (reconciliação), T-09 | Desenho do webhook pode ser fechado | S-03 precisa ler a página |

Nota: itens 3, 6, 7, 8 e 21 são os que mais podem mudar o cronograma. Itens 1 e 15 são os únicos que bloqueiam o gate de release (H-121) sem decisão humana.

---

## 3. Fora do escopo

- Leitura dos termos de produto do Mapbox e interpretação de "armazenar": **S-04**.
- Recorrência por ciclo (1, 3, 6, 12 meses), sandbox, cartões de teste, Pix avulso e webhooks reais: **S-03**.
- Criar conta, projeto, chave, cartão, limite de gasto ou sandbox: **BLQ-EXEC** (SD-14 / BK-6).
- Testar cota real de Resend ou Mapbox (não exceder cota de propósito): **S-11** e **S-04**.
- Cold start, bundle, memória e pooler em produção: **S-09**.
- Decidir upgrade, Pro, troca de provedor ou cobrança: decisão humana no Gate M4 (H-054, H-121). O S-08 registra só o número.
- Alterar ADR-007, ADR-008, ADR-018, ADR-020 ou ADR-022: **Architect** (D-S08-6).
- Termos jurídicos (L1 a L7) e textos de aviso: **jurídico**.
- Mobile (lojas, IAP, exclusão de conta): **S-07**.
- Mover card no Project, abrir ou fechar Issue, ou criar branch/PR: **Orquestrador**.
- Escrever código, testes ou migrações: nenhum.

---

## 4. Divergências encontradas nas fontes internas (para o Architect e o Orquestrador)

1. **ADR-020, cabeçalho:** diz que "todos os valores vêm de memória", mas as linhas de Vercel, Supabase, Mapbox e Resend já estão marcadas como VERIFICADO (doc 13). Ajustar o cabeçalho ao final do S-08.
2. **ADR-020, linha Supabase Auth:** "ordem de dezenas de milhares de MAU" (memória) contra 50.000 MAU (doc 13).
3. **ADR-020, linha Mapbox:** omite mapas (50.000 loads) e Address Autofill (1.000 sessões). Não são usados hoje, mas existem.
4. **ADR-010 (Realtime) e ADR-012 (dois projetos Supabase):** ainda marcados "NÃO VERIFICADO"; o doc 13 já responde para Realtime (200 conexões e 2 mi mensagens) e para dois projetos ativos.
5. **ADR-013:** cita retenção curta "NÃO VERIFICADO" nos provedores gratuitos. O doc 13 dá: Supabase logs de 1 dia, Resend 30 dias, Vercel logs de runtime de 1 h. A de 1 h da Vercel é material para H-007 e H-108.
6. **Storage "300 MB para documentos"** (19 V-17; 14 A-2 e BK-1; 09 §9): é alocação interna derivada do limite de 1 GB, não limite de serviço. O Architect confirma a alocação.
7. **Resend, plano Pro:** duas linhas de preço e cota na mesma página (US$ 20/50.000 e US$ 35/100.000). Permanece NÃO VERIFICADO.
8. **Supabase, SMTP customizado no Free:** o doc 13 cita a lista de URLs da plataforma, sem a URL exata da frase. O S-08 registra a URL.
9. **Mercado Pago:** a URL de assinaturas está truncada no doc 13, e a URL da página de custos (403) não foi registrada.
10. **14-BACKLOG, linha S-08:** diz "Parcial (13)". Com este refino, a parte de leitura de Vercel, Supabase, Resend e Mapbox já está em fonte; Mercado Pago segue parcial.

---

## 5. Dúvidas ao Orquestrador

Numeração provisória `D-S08-n`; o Orquestrador encaixa na lista contínua da sessão.

1. **[NÃO BLOQUEANTE]** Confirmar que o S-08 pode usar apenas leitura de páginas públicas, sem login, sem conta e sem cartão. **Recomendação: sim.** Alternativa (não recomendada): só ler dentro de conta autorizada, o que exige BLQ-EXEC.
2. **[NÃO BLOQUEANTE]** Resend, plano Pro com duas linhas: aceitar `NÃO VERIFICADO` até a página resolver a divergência? **Recomendação: sim**, registrar as duas linhas literais. Alternativa: pedir ao usuário que consulte a conta ou o atendimento (depende de ação humana e não é leitura).
3. **[BLOQUEANTE para a linha de tarifas MP]** As tarifas Pix e cartão retornam 403. Alternativas: (a) tentar por caminho autorizado no S-03 (painel ou simulador, com conta sandbox, BLQ-EXEC); (b) o usuário fornece valores copiados da própria conta, sem dados pessoais; (c) manter `NÃO VERIFICADO` e o gate H-054 fechado. **Recomendação: (c) agora, (a) no S-03.**
4. **[NÃO BLOQUEANTE]** Incluir como pendências de leitura, sem conta: MFA TOTP do Free (ADR-012), claim `sid` por Auth Hook (S-01) e limite de e-mail do Auth. **Recomendação: sim**; se não aparecerem na documentação, ficam `NÃO VERIFICADO`.
5. **[BLOQUEANTE para usar sandbox MP no Hobby]** O Hobby proíbe uso comercial e o BK-3 pergunta se sandbox conta como uso comercial. O S-08 registra a cláusula, mas não decide. **Recomendação: decisão do usuário ou do líder antes de H-047** (BK-3, alternativa a).
6. **[NÃO BLOQUEANTE]** Quem atualiza ADR-020: o spike entrega a tabela, e o Architect incorpora em ADR-020 como nova revisão? Ou o próprio spike altera 10-ADRS, como diz o texto de 19 §4? **Recomendação:** tabela no arquivo de resultado do spike (`docs/factory/spikes/S-08-RESULTADO.md`, conforme 19 §4) e atualização do ADR pelo Architect.
7. **[TÉCNICO, BLOQUEANTE para commit e push]** Esta sessão não tem ferramenta de shell. Não consegui rodar `git`, `py -3`, `execctl.py`, nem commit/push; não há EXEC-ID. O arquivo foi criado, mas **não foi commitado nem enviado**. Pedido: o Orquestrador (ou sessão com shell) faz o commit com `Refs: #13` e os trailers após conferir o arquivo. Não simulei.
8. **[NÃO BLOQUEANTE]** Issue #13 e o Project 4 não foram conferidos no GitHub nesta sessão (sem ferramenta GitHub). O título vem de 21-ISSUES-CRIADAS.

---

## 6. Observações de execução

- Commit e push **não foram feitos** (ver D-S08-7). Nada foi simulado.
- Nenhuma fonte externa consultada; nenhuma conta, chave, cartão ou projeto; nenhum código alterado.
- `projects/fastpro/state.json` confere com `local_path` = `D:\projetos\fastpro` (lido antes de agir).
- Trailers previstos no commit: `Refs: #13`; `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`; `Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux`.

## Resumo em linguagem simples

O spike vai confirmar, direto nas páginas oficiais, quanto cada serviço gratuito permite (Vercel, Supabase, Resend, Mapbox e Mercado Pago), e marcar como "não confirmado" tudo o que não conseguir ler.
Enquanto faltarem as tarifas do Mercado Pago e a regra de envio de e-mail com endereço próprio, a cobrança real e os e-mails de verdade continuam travados; nada disso é liberado por este documento.
