# FastPro — Verificação de serviços na documentação oficial (somente leitura)

Acesso em 2026-11-09. Nada foi criado, assinado ou pago. Itens sem fonte permanecem [NÃO VERIFICADO].

## Resend (verificado)
Fontes: https://resend.com/pricing · https://resend.com/docs/knowledge-base/resend-sending-limits · https://resend.com/docs/dashboard/domains/introduction · https://resend.com/docs/dashboard/emails/send-test-emails · https://resend.com/docs/send-with-smtp · https://resend.com/docs/send-with-supabase-smtp

| Item | Plano gratuito |
|---|---|
| E-mails por dia | **100** (dia UTC, não janela móvel de 24 h) |
| E-mails por mês | **3.000** |
| Contagem | Cada destinatário (To/CC/BCC) conta separado; envio e recebimento contam; e-mails de teste (`resend.dev`) também consomem cota |
| Domínios verificados | 3 |
| Retenção de logs | 30 dias |
| Rate limit | 10 requisições/s por time (429 acima) |
| SMTP | Sim (`smtp.resend.com`; portas 25/465/587/2465/2587; usuário `resend`; senha = chave de API) |
| Supabase Auth | Há passo a passo oficial (SMTP `smtp.resend.com:465`, usuário `resend`); lista "domínio verificado" como pré-requisito |
| Primeiro plano pago | Pro US$ 20/mês, 50.000 e-mails/mês, sem limite diário, 10 domínios (a página também lista uma linha Pro US$ 35/mês, 100.000 e-mails, sem explicar a diferença) |

Endereços de teste: `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, `suppressed@resend.dev` (aceitam `+rótulo`, exceto `suppressed`).

**Não confirmado em fonte:** enviar a um e-mail real (ex.: o do titular da conta) **sem domínio verificado**. As páginas dizem "You must add and verify at least one domain to send emails with Resend". A premissa anterior de que o modo de teste (T8) enviaria ao e-mail do titular sem domínio **não está confirmada**; tratar como [NÃO VERIFICADO] até testar na conta ou ler a documentação de remetente.

## Pendentes de leitura (decisão 25)
Vercel (uso comercial do plano gratuito; NestJS), Supabase (pausa por inatividade, backup, limites, SMTP/Auth), Mapbox (licença de geocodificação/armazenamento, limites), Mercado Pago (assinatura recorrente, teste grátis sem cartão, Pix, taxas).

---
# Rodada de leitura 2 — Vercel, Supabase, Mapbox, Mercado Pago (acesso 2026-11-09)
Itens "(resumo)" vieram de resumo automático do leitor e devem ser reconfirmados antes de decidir. "Não encontrei" = a página lida não traz o dado.

## Vercel
Fontes: vercel.com/pricing · /docs/plans/hobby · /docs/limits · /docs/limits/fair-use-guidelines · /docs/cron-jobs/usage-and-pricing · /docs/frameworks/backend/nestjs
- **Hobby é só uso pessoal não comercial.** Uso comercial inclui "qualquer método de solicitar ou processar pagamento de visitantes do site". Uso comercial exige Pro ou Enterprise. **Conflita com cobrar assinatura.**
- Pro: US$ 20/mês (+ US$ 20 por seat de desenvolvedor), com crédito de uso de US$ 20.
- Hobby: funções até 300 s; 2 GB / 1 vCPU; 1.000.000 invocações/mês; 100 GB banda; 100 deploys/dia; logs de runtime 1 h.
- **Cron no Hobby: no máximo 1 vez por dia** (precisão ±59 min). Pro: 1 vez por minuto.
- NestJS suportado como uma única Vercel Function (Fluid compute), bundle até 250 MB.

## Supabase (plano Free)
Fontes: supabase.com/pricing · /docs/guides/platform/billing-on-supabase · /backups · /compute-and-disk
- **Pausa após 1 semana de inatividade.** 2 projetos ativos.
- Banco 500 MB · **Storage 1 GB** (upload máx. 50 MB) · egress 5 GB · 50.000 MAU · Realtime 200 conexões e 2 mi mensagens/mês · Edge Functions 500.000/mês · logs 1 dia · 60 conexões diretas (200 no pooler).
- **Sem backup no Free**; recomendado `supabase db dump`. Backup diário só no Pro.
- SMTP customizado: incluído no Free. Limite de e-mails do Auth: não encontrei. PostGIS/pg_cron/pg_net no Free: **não encontrei** (verificar antes de depender do tick no Supabase).
- Pro: a partir de US$ 25/mês.

## Mapbox
Fontes: mapbox.com/pricing · docs.mapbox.com/api/search/geocoding/
- Geocoding temporário: 100.000 req/mês grátis; autocomplete conta cada tecla como requisição.
- **"Resultados temporários não podem ser armazenados em cache; resultados permanentes podem ser armazenados indefinidamente."** Guardar coordenadas no banco exige `permanent=true`: **sem faixa gratuita, US$ 5 por 1.000 (US$ 4 acima de 500 mil), exige cartão cadastrado.** (Que "banco de dados" conta como armazenar é interpretação do texto.)
- Mapas (GL JS): 50.000 loads/mês grátis. Address Autofill: 1.000 sessões/mês grátis. Os termos de produto estão em PDF externo, não lido.

## Mercado Pago
Fontes: mercadopago.com.br/developers/pt/docs/subscriptions/...
- **Tarifas Pix/cartão: não obtidas** (página de custos retornou 403). Mensalidade: não encontrei.
- Assinatura recorrente por API (semanal, mensal, anual); Pix aparece como meio, "Pix Automático" não encontrado. A página cita "período de testes", sem detalhes (duração, se exige cartão).
- Webhooks: tópicos `subscription_preapproval`, `subscription_authorized_payment`; cabeçalho `x-signature`; reenvio a cada 15 min (resumo).
