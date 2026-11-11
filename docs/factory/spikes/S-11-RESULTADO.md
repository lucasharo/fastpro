# S-11 — Resultado: Resend sem domínio, bounce e cota (Issue #10, WF-03, Arquitetura)

- **Data da execução:** 2026-11-10 · **Branch:** `feature/init` · **Critérios:** `29-REFINO-S11.md`
- **Método:** HTTP direto (`POST https://api.resend.com/emails`, `GET https://api.resend.com/emails/{id}`), por script de spike isolado: `docs/factory/spikes/s11/s11-send.mjs` (fora de `packages/` e `apps/`; nenhum código de produto alterado).
- **Segredo:** `RESEND_API_KEY` lida só de `.env.local` por código; valor nunca impresso nem gravado. Endereço da conta não reproduzido (citado como "e-mail da conta").
- **URL oficial consultada:** nenhuma página consultada nesta rodada; os resultados abaixo são respostas diretas da API em 2026-11-10.

## 1. Envios realizados (3 de no máximo 5)

Remetente usado: `onboarding@resend.dev` (aceito pela conta; sem domínio verificado).

| # | Destino | HTTP | Resultado literal | Status final (GET) |
|---|---|---|---|---|
| 1 | tentativa com um endereço presumido da conta | 403 | `validation_error`: "You can only send testing emails to your own email address (<e-mail da conta>). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain." | sem id |
| 2 | e-mail da conta (endereço informado pelo próprio Resend na recusa 1) | 200 | aceito, com identificador do envio | `delivered` |
| 3 | `bounced@resend.dev` | 200 | aceito, com identificador do envio | `bounced` |

Observações: o envio 1 usou um endereço presumido por não haver o e-mail da conta no repositório; o Resend recusou e indicou o endereço permitido, usado no envio 2 (única retentativa, sem trocar remetente, conta ou domínio). Chegada na caixa de entrada do titular: **NÃO VERIFICADO** (não há acesso à caixa; vale o status `delivered` do Resend).

## 2. Cota lida na conta

Cabeçalhos devolvidos pelo Resend em todas as respostas: `ratelimit-limit: 10`, `ratelimit-policy: 10;w=1` (10 requisições por segundo), `x-resend-daily-quota: 0`, `x-resend-monthly-quota: 0`.
- Limite de 10 req/s: confirmado pelo cabeçalho (VERIFICADO em 2026-11-10).
- Os cabeçalhos `x-resend-daily-quota` e `x-resend-monthly-quota` vieram `0` mesmo após envios; significado (usado, restante ou não aplicável) **NÃO VERIFICADO**.
- 100/dia e 3.000/mês: continuam herdados de `13` (não reconfirmados aqui, **NÃO VERIFICADO** nesta rodada). Contagem do painel versus contador N-08: **NÃO VERIFICADO** (painel não consultado). Cota não foi excedida.

## 3. Decisão sobre envio sem domínio

- O Resend **aceita** envio de teste sem domínio, **somente** ao e-mail da própria conta e com remetente `onboarding@resend.dev`. Qualquer outro destinatário real é recusado (`validation_error`, HTTP 403) e a mensagem exige domínio verificado.
- Decisão do desenho (D-S11-1, opção a): o teste vale só como script de spike. O adapter Resend de produção continua recusando envio sem domínio verificado (ADR-022, N-10). Dev e CI usam Mailpit. Nenhum "modo de teste" no adapter foi criado.

## 4. O que libera em dev

- **H-093**: adapter Resend pode ser exercitado contra a API real apenas com destino à conta do titular e remetente `onboarding@resend.dev`; o formato de recusa 403 `validation_error` serve de contrato para o dublê.
- **H-016, H-011**: desenvolvimento com Mailpit, sem depender de domínio.
- **H-094**: o contador pode usar o limite de 10 req/s confirmado; limiares de alerta seguem PROPOSTA.
- Bounce: `bounced@resend.dev` gera status `bounced` (confirmado por GET).

## 5. Continua bloqueado para produção

- Envio a clientes, profissionais ou qualquer terceiro: exige domínio verificado (decisão 15, BK-10).
- SMTP do Supabase Auth com Resend: exige domínio.
- Webhook de bounce/entrega assinado com `RESEND_WEBHOOK_SECRET`: **NÃO VERIFICADO** (sem URL pública).
- Formato da resposta de cota excedida (429/limite diário): **NÃO VERIFICADO**; só dublê local.
- Divergência de plano Pro (13): **NÃO VERIFICADA**.

## 6. NÃO VERIFICADO (resumo)

Chegada na caixa do titular; significado dos cabeçalhos `x-resend-*-quota`; 100/dia e 3.000/mês nesta conta; painel de logs; webhook; resposta de cota excedida; preços/plano Pro.

## Resumo em linguagem simples

O Resend aceita enviar e-mail de teste sem domínio, mas só para o e-mail da própria conta; para qualquer outra pessoa ele recusa e pede um domínio verificado. O teste de bounce funcionou, e o envio real a clientes continua bloqueado até existir domínio.
