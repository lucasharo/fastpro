# S-08 — Resultado: verificação oficial dos limites gratuitos (Issue #13)

- **Data de acesso de todas as leituras:** 2026-11-10 (leitura 2; a leitura 1 é a de 13-VERIFICACAO-SERVICOS, 2026-11-09, preservada).
- **Método:** `curl -L` (GET, sem login, sem conta, sem cartão) nas páginas oficiais; o HTML foi convertido em texto e lido. Não foi resumo automático. Nada foi criado, assinado ou pago. Nenhum ADR foi alterado (D-S08-6).
- **Critérios:** CA-S08-00 a 06 de 26-REFINO-S08. Status: `VERIFICADO` (valor lido na página, com URL e data) ou `NÃO VERIFICADO` (com motivo). Coluna "Mudou vs 13": sim / não / novo (item que 13 não trazia) / n.r. (não reconfirmado).
- **Limite deste spike:** a leitura é de páginas públicas; limites que só aparecem no painel ficam `NÃO VERIFICADO` ("exige conta, BLQ-EXEC").

## 1. Vercel

| Item | Valor (literal/unidade) | URL oficial | Data | Status | Mudou vs 13 |
|---|---|---|---|---|---|
| Hobby: uso comercial | "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan." Exemplo: "Any method of requesting or processing payment from visitors of the site". "Asking for Donations does not fall under commercial usage." | https://vercel.com/docs/limits/fair-use-guidelines | 2026-11-10 | VERIFICADO | não |
| Hobby: restrição na página do plano | "the Hobby plan restricts users to non-commercial, personal use only" | https://vercel.com/docs/plans/hobby | 2026-11-10 | VERIFICADO | não |
| Pro: preço da plataforma | "$20 /mo." e "$20 of included usage credit" | https://vercel.com/pricing | 2026-11-10 | VERIFICADO | não |
| Pro: assento de desenvolvedor | "Developer seat ... $20 / month"; "Viewer seat ... Unlimited" (grátis). A página não diz se o primeiro assento já está nos US$ 20 da plataforma | https://vercel.com/pricing e https://vercel.com/docs/plans/hobby ("Developer seats cost $20 per user / month, while Viewer seats are free") | 2026-11-10 | VERIFICADO (valor); regra do 1o assento NÃO VERIFICADO (a página não explica) | não |
| Hobby: funções | Duração "300s (5 minutes) default and max"; "2 GB / 1 vCPU default and max" | https://vercel.com/docs/limits | 2026-11-10 | VERIFICADO | não |
| Hobby: invocações | "Function Invocations: First 1,000,000" (por mês no plano) | https://vercel.com/docs/plans/hobby | 2026-11-10 | VERIFICADO | não |
| Hobby: transferência | "Fast Data Transfer: First 100 GB"; "Fast Origin Transfer: First 10 GB" | https://vercel.com/docs/plans/hobby | 2026-11-10 | VERIFICADO | não (Origin Transfer é novo) |
| Hobby: deploys | "You are able to deploy 100 times every 86400 seconds (1 day)" | https://vercel.com/docs/limits | 2026-11-10 | VERIFICADO | não |
| Hobby: logs de runtime | "Runtime logs are stored for 1 hour on Hobby, 1 day on Pro, and for 3 days on Enterprise" | https://vercel.com/docs/limits | 2026-11-10 | VERIFICADO | não |
| Hobby: projetos por conta | Projects: 200 (Hobby), ilimitado (Pro) | https://vercel.com/docs/limits | 2026-11-10 | VERIFICADO | novo |
| Corpo de requisição/resposta da função | "The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB. The response body limit doesn't apply to streamed responses." Erro 413 FUNCTION_PAYLOAD_TOO_LARGE | https://vercel.com/docs/functions/limitations | 2026-11-10 | VERIFICADO | novo |
| Foto servida pela API conta nos 100 GB? | A página de preços diz só que "Requests to static assets incur the same Fast Data Transfer usage". Não diz expressamente que a resposta de uma função conta | https://vercel.com/pricing | 2026-11-10 | NÃO VERIFICADO (não listado na página; medir no S-09) | n.r. |
| Cron no Hobby | "Hobby accounts are limited to cron jobs that run once per day"; precisão: "0 1 * * * ... will trigger anywhere between 1:00 am and 1:59 am". Pro: "Once per minute" | https://vercel.com/docs/cron-jobs/usage-and-pricing | 2026-11-10 | VERIFICADO (o cron não substitui o tick: decisão do ADR-018) | não |
| NestJS | "your NestJS application becomes a single Vercel Function and uses Fluid compute by default"; "standard bundle size limit of 250MB for Node.js applications" | https://vercel.com/docs/frameworks/backend/nestjs | 2026-11-10 | VERIFICADO | não |
| Fair use: valor numérico | Sem número de uso; só a regra de uso comercial acima e a remissão para /docs/limits | https://vercel.com/docs/limits/fair-use-guidelines | 2026-11-10 | VERIFICADO ("sem número") | não |

## 2. Supabase (plano Free)

| Item | Valor (literal/unidade) | URL oficial | Data | Status | Mudou vs 13 |
|---|---|---|---|---|---|
| Pausa e projetos ativos | "Free projects are paused after 1 week of inactivity. Limit of 2 active projects." | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| Projetos pausados não contam | "Paused projects do not count towards your free project limit." | https://supabase.com/docs/guides/platform/billing-on-supabase | 2026-11-10 | VERIFICADO | novo |
| Banco | "500 MB database size"; "Shared CPU • 500 MB RAM" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| Storage e upload | "1 GB file storage"; "Max file upload size: 50 MB"; Free "can't exceed 50 MB" | https://supabase.com/pricing e https://supabase.com/docs/guides/storage/uploads/file-limits | 2026-11-10 | VERIFICADO | não |
| Egress | "5 GB egress" e "5 GB cached egress" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| MAU (Auth) | "50,000 monthly active users" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| Realtime | Conexões simultâneas 200; mensagens "2 Million included" por mês; mensagem máx. 256 KB; 100 mensagens/s no Free | https://supabase.com/pricing e https://supabase.com/docs/guides/realtime/limits | 2026-11-10 | VERIFICADO | não (100 msg/s é novo) |
| Edge Functions | "Invocations: 500,000 included" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| Logs | "Log retention (API & Database): 1 day"; "Auth Audit Logs: 1 hour" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | Auth Audit Logs é novo |
| Conexões | Instância "Nano (free)": Database Max Connections 60; Connection Pooler Max Clients 200; Default Pool Size 15 | https://supabase.com/docs/guides/platform/compute-and-disk | 2026-11-10 | VERIFICADO | não (pool size 15 é novo) |
| Backup | Pricing, coluna Free: "Automatic backups: Not included in free". Docs: "We automatically back up all Pro, Team, and Enterprise Plan projects on a daily basis"; "We recommend that free tier plan projects regularly export their data using the Supabase CLI db dump command" | https://supabase.com/pricing e https://supabase.com/docs/guides/platform/backups | 2026-11-10 | VERIFICADO | não |
| SMTP customizado | "Custom SMTP server: Included in free" | https://supabase.com/pricing (URL da frase) e https://supabase.com/docs/guides/auth/auth-smtp | 2026-11-10 | VERIFICADO | URL nova (13 não tinha) |
| Pro | "$ 25 /month" | https://supabase.com/pricing | 2026-11-10 | VERIFICADO | não |
| Limite de e-mails do Auth | Provedor nativo: "2 messages per hour"; só entrega a membros da equipe ("Email address not authorized" para os demais). Com SMTP próprio: "a low rate-limit of 30 messages per hour is imposed", configurável em Rate Limits | https://supabase.com/docs/guides/auth/auth-smtp e https://supabase.com/docs/guides/auth/rate-limits | 2026-11-10 | VERIFICADO | sim (13 dizia "não encontrei") |
| MFA TOTP no Free | "TOTP MFA API is free to use and is enabled on all Supabase projects by default." Pricing: "Basic Multi-Factor Auth: Included in free" | https://supabase.com/docs/guides/auth/auth-mfa/totp e https://supabase.com/pricing | 2026-11-10 | VERIFICADO | sim (era pendência) |
| Auth Hook no Free | Pricing, coluna Free, lista "Auth Hooks: Custom Access Token (JWT), Send custom email/SMS" sem "Not included". Atenção: a documentação do hook chama o claim de `session_id` ("Required Claims: iss, aud, exp, iat, sub, role, aal, session_id, ..."), e não `sid` | https://supabase.com/pricing e https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook | 2026-11-10 | VERIFICADO (disponibilidade); o nome `sid` do ADR-005 NÃO VERIFICADO (a doc diz `session_id`) | sim (era pendência) |
| PostGIS, pg_cron, pg_net no Free | As páginas de extensões explicam como habilitar no painel, mas não dizem a que plano se aplicam; a página de preços não as lista | https://supabase.com/docs/guides/database/extensions/postgis ; .../pg_cron ; .../pg_net ; https://supabase.com/pricing | 2026-11-10 | NÃO VERIFICADO (plano não declarado nas páginas lidas; confirmação é do S-02R no painel, BLQ-EXEC) | n.r. |

## 3. Resend

| Item | Valor (literal/unidade) | URL oficial | Data | Status | Mudou vs 13 |
|---|---|---|---|---|---|
| Cota diária e mensal | "daily email quota of 100 emails/day and 3,000 emails/month. This quota includes both sent and received emails." Dia = "UTC calendar day (00:00–24:00 UTC)... It is not a rolling 24-hour window" | https://resend.com/docs/knowledge-base/resend-sending-limits | 2026-11-10 | VERIFICADO | não |
| Contagem | "Multiple To, CC, or BCC recipients in sent emails count as separate emails towards this quota" | https://resend.com/docs/knowledge-base/resend-sending-limits | 2026-11-10 | VERIFICADO | não |
| Plano Free (preços) | "$0 / mo 3,000 emails / mo; 100 emails a day; 3 domains; 30-day data retention" | https://resend.com/pricing | 2026-11-10 | VERIFICADO | não |
| E-mails de teste consomem cota | Endereços `delivered@resend.dev` etc. documentados na página de testes; a frase de consumo de cota não foi relocalizada nesta leitura | https://resend.com/docs/dashboard/emails/send-test-emails | 2026-11-10 | endereços VERIFICADO; "consomem cota" NÃO VERIFICADO (frase não relida; vale o valor herdado de 13 como "herdado") | n.r. |
| Domínio verificado para enviar | "Resend sends emails using a domain you own (i.e., not a shared or public domain). You must add and verify at least one domain to send emails with Resend." | https://resend.com/docs/dashboard/domains/introduction | 2026-11-10 | VERIFICADO | não |
| Envio sem domínio verificado (premissa T8) | Nenhuma página lida confirma | URLs acima | 2026-11-10 | NÃO VERIFICADO (não listado nas páginas lidas); desenho usa Mailpit | não |
| Rate limit | "All accounts start with a rate limit of 10 requests per second"; 11a requisição na janela de 1 s recebe "429". Igual em todos os planos | https://resend.com/docs/knowledge-base/resend-sending-limits e https://resend.com/pricing (FAQ) | 2026-11-10 | VERIFICADO (formato do corpo de erro: NÃO VERIFICADO, é do S-11) | não |
| SMTP | Host `smtp.resend.com` | https://resend.com/docs/send-with-smtp | 2026-11-10 | VERIFICADO (host); portas/usuário n.r. | n.r. |
| Supabase Auth com SMTP do Resend | Página de integração existe | https://resend.com/docs/send-with-supabase-smtp | 2026-11-10 | VERIFICADO (existência); passo a passo n.r. | n.r. |
| Plano Pro | "$20 / mo 50,000 emails / mo; Extra emails: $0.90 / 1,000; 10 domains; No daily email limit" | https://resend.com/pricing | 2026-11-10 | VERIFICADO | sim: a linha "Pro US$ 35 / 100.000" de 13 não aparece mais |
| Plano Scale | "$90 / mo 100,000 emails / mo; 1,000 domains" | https://resend.com/pricing | 2026-11-10 | VERIFICADO | sim (provável origem da dupla leitura de 13) |

## 4. Mapbox

| Item | Valor (literal/unidade) | URL oficial | Data | Status | Mudou vs 13 |
|---|---|---|---|---|---|
| Geocodificação temporária | "Up to 100,000" requisições/mês = "Free"; 100.001 a 500.000 = US$ 0,75 por 1.000 | https://www.mapbox.com/pricing | 2026-11-10 | VERIFICADO | não |
| Autocomplete | "each user keystroke counts as one request to the Geocoding API" | https://docs.mapbox.com/api/search/geocoding/ | 2026-11-10 | VERIFICADO | não |
| Cache/armazenamento | "Temporary results are not allowed to be cached, while Permanent results are allowed to be cached and stored indefinitely." | https://docs.mapbox.com/api/search/geocoding/ | 2026-11-10 | VERIFICADO (o que é "armazenar": S-04) | não |
| Geocodificação permanente: cartão | "Using Permanent storage with the Geocoding API requires that you have a valid credit card on file or an active enterprise contract." | https://docs.mapbox.com/api/search/geocoding/ | 2026-11-10 | VERIFICADO | não |
| Geocodificação permanente: preço | Faixas "1 - 500,000" a US$ 5,00 por 1.000 e "500,001+" a US$ 4,00 por 1.000; a tabela começa em 1, sem faixa "Free" | https://www.mapbox.com/pricing | 2026-11-10 | VERIFICADO | não |
| Mapas (GL JS) | A página tem a seção "Mapbox GL JS (Map Loads)"; o valor da faixa gratuita não foi lido com certeza nesta rodada | https://www.mapbox.com/pricing | 2026-11-10 | NÃO VERIFICADO (faixa "50.000" herdada de 13; gratuidade não confirmada no texto lido) | n.r. |
| Address Autofill | Faixa "Up to 1,000" sessões/mês aparece; custo da faixa não confirmado no texto lido | https://www.mapbox.com/pricing | 2026-11-10 | NÃO VERIFICADO (gratuidade da faixa não confirmada) | n.r. |
| Termos de produto (PDF externo) | Não lidos | n/a | 2026-11-10 | NÃO VERIFICADO (PDF externo; é do S-04) | n.r. |
| Alertas e limite de gasto | Só dentro da conta | n/a | 2026-11-10 | NÃO VERIFICADO (exige conta, BLQ-EXEC) | n.r. |

## 5. Mercado Pago

| Item | Valor (literal/unidade) | URL oficial | Data | Status | Mudou vs 13 |
|---|---|---|---|---|---|
| Tarifas Pix e cartão | GET em https://www.mercadopago.com.br/costs-section devolveu HTTP 200 com redirecionamento para a página de login (mercadopago.com.br/login/identification); nenhuma tarifa foi lida. Em 13 a mesma busca havia dado 403 | https://www.mercadopago.com.br/costs-section | 2026-11-10 | NÃO VERIFICADO (exige login; sem tarifa na página pública) | mudou o sintoma (login em vez de 403); resultado igual |
| Mensalidade da conta | Não encontrada nas páginas lidas | páginas abaixo | 2026-11-10 | NÃO VERIFICADO (não listado) | não |
| Assinatura recorrente: frequência | "Frequência de cobrança personalizável: semanal, mensal ou anual." | https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview | 2026-11-10 | VERIFICADO (URL completa agora registrada; ciclos 1/3/6/12 meses: S-03) | URL nova |
| Pix como meio | "Meios de pagamento online e offline, como Pix e boleto bancário." | https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview | 2026-11-10 | VERIFICADO | não |
| Pix Automático | Não encontrado nas páginas lidas | https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview | 2026-11-10 | NÃO VERIFICADO (não listado) | não |
| Período de testes | "Ofereça um período de testes para que seus clientes possam conhecer seu serviço." A API de plano associado mostra o objeto `free_trial`; duração e exigência de cartão não lidas | https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview e .../subscriptions/integration-configuration/subscription-associated-plan/overview | 2026-11-10 | existência VERIFICADO; duração e cartão NÃO VERIFICADO (não lidos) | não |
| Webhooks | Tópicos `subscription_preapproval` e `subscription_authorized_payment`; assinatura enviada no cabeçalho `x-signature`; confirmação de recepção em 22 segundos, com novas tentativas "a cada 15 minutos" | https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks | 2026-11-10 | VERIFICADO (lido na página, não por resumo); número total de tentativas n.r. | sim (agora lido direto; 22 s é novo) |
| Limites de taxa da API | Não consultados | n/a | 2026-11-10 | NÃO VERIFICADO (não lido) | n.r. |

## 6. O que continua pendente

1. **Mercado Pago, tarifas Pix e cartão e mensalidade:** sem fonte pública sem login. Gate H-054 segue fechado. Caminho: S-03, por via autorizada (BLQ-EXEC) ou valores copiados da conta pelo usuário (D-S08-3 do refino).
2. **Resend, envio sem domínio (T8):** continua sem fonte; nenhum documento deve tratar como fato. Domínio próprio é pré-requisito para qualquer envio real.
3. **Resend, consumo de cota por e-mail de teste:** frase não relida nesta rodada; manter como "herdado" até releitura na página de testes.
4. **Vercel:** a resposta de foto servida por função conta nos 100 GB? Não declarado; medir no S-09. Regra do primeiro assento do Pro: não explicada.
5. **Supabase:** PostGIS, pg_cron e pg_net no Free (S-02R, no painel). Nome do claim: a documentação diz `session_id`; o ADR-005 usa `sid`.
6. **Mapbox:** gratuidade de mapas (50.000) e de Address Autofill (1.000 sessões) não confirmada no texto lido; PDF de termos (S-04); alertas e teto de gasto (conta).
7. **Mercado Pago:** Pix Automático, duração do teste grátis e se exige cartão, limites de taxa da API, número total de tentativas do webhook.
8. **Hobby proíbe cobrança** (fair use confirmado): cobrança real só no Pro. Sandbox no Hobby (BK-3) segue como decisão humana.

## 7. Divergências para o Architect (CA-S08-06b; nada foi alterado)

1. ADR-020, linha Supabase Auth: "dezenas de milhares de MAU" contra **50.000 MAU** (confirmado). Cabeçalho "todos os valores vêm de memória" também deve ser corrigido.
2. ADR-020, linha Resend: a dupla leitura "Pro US$ 35 / 100.000" vem de 13; a página de hoje mostra Pro US$ 20 / 50.000 e Scale US$ 90 / 100.000.
3. ADR-020, linha Mapbox: omite mapas e Address Autofill (existem; gratuidade a confirmar).
4. ADR-005: nome do claim (`sid` contra `session_id` na documentação do Auth Hook).
5. ADR-010, ADR-012, ADR-013: itens marcados "NÃO VERIFICADO" já têm resposta (Realtime 200 conexões e 2 milhões de mensagens; 2 projetos ativos; logs Supabase 1 dia, Resend 30 dias, Vercel runtime 1 hora; MFA TOTP gratuito).
6. Supabase Auth: o e-mail nativo (2/hora, só membros da equipe) é inutilizável como login de clientes; com SMTP do Resend o teto padrão do Auth é 30/hora, configurável, e a cota do Resend (100/dia) é a restrição real.
7. Vercel: corpo/resposta de função limitado a 4,5 MB (exceto resposta em streaming); relevante para H-026/H-027/H-055.

## 8. Registro de repetição (CA-S08-06c)

| Leitura | Data | Fonte | Observação |
|---|---|---|---|
| 1 | 2026-11-09 | 13-VERIFICACAO-SERVICOS | Parte por resumo automático |
| 2 | 2026-11-10 | Este documento | Leitura direta de HTML oficial |

Repetir antes do Gate M4 (H-121) e da primeira cobrança real. Nova tabela se soma a esta; não a substitui.

## Resumo em linguagem simples

Li direto nas páginas oficiais os limites gratuitos de Vercel, Supabase, Resend, Mapbox e Mercado Pago; a maior parte foi confirmada (a Vercel gratuita não pode ser usada para cobrar clientes), e o que não deu para ler ficou marcado como não verificado.
As tarifas do Mercado Pago ainda não aparecem sem login e o envio de e-mail sem domínio próprio segue sem confirmação, então cobrança real e e-mails de verdade continuam travados.
