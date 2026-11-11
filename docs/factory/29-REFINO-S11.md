# Refino S-11 — Resend: envio de teste sem domínio, bounce e cota (Issue #10, spike, WF-03, Product Owner)

- **Data:** 2026-11-10 · **Branch:** `feature/init` · **Rastro:** Issue #10 (21-ISSUES-CRIADAS, linha S-11); 19 §3.2 e §4 (S-11); 13 (Resend, acesso 2026-11-09); 10-ADRS ADR-022, ADR-011, ADR-020 §20.1, SD-03; 11-DECISOES nº 15, T6, T7, T8; 14-BACKLOG H-011, H-016, H-093, H-094; BK-10.
- **Natureza:** SOMENTE documento. Nenhuma conta, chave, domínio, projeto ou envio foi criado. Nenhuma consulta externa nesta rodada: os valores vêm de 13 e precisam ser reconfirmados pelo spike. O `.env.local` não foi lido e nenhuma chave foi impressa.
- **Etiquetas:** `[APROVADO]` decisão do usuário ou regra vigente · `[DELEGADO]` escolha técnica ao DEV dentro do critério · `[PROPOSTA]` sugestão deste refino (pendente do Orquestrador).

---

## 0. Premissa (decisão do usuário)

**[APROVADO]** Não há domínio. O envio de teste pelo Resend vai **somente** ao e-mail da conta Resend cadastrada pelo titular (endereço não reproduzido neste documento). O spike confirma se o Resend aceita esse envio sem domínio verificado.

Hoje isso **não está confirmado**: 13 marca "envio a e-mail real sem domínio" como NÃO VERIFICADO, e a premissa T8 (11-DECISOES) tem a nota de 2026-11-09 pedindo confirmação. A decisão 15 continua valendo: nenhum envio real a terceiros antes de domínio verificado.

---

## 1. Critérios de aceite (Given/When/Then)

**CA-S11-00 Segredo e pré-condição [APROVADO; AGENTS item 9; 19 §7].** Dado que a conta e a chave restrita a envio só existem após autorização de execução do spike (BK-6 b, SD-14), quando o script de spike roda, então lê a chave **apenas** de `.env.local` (nome da variável `RESEND_API_KEY`, sem valor) e nunca a imprime, grava em log, resultado, documento ou commit. Se a variável faltar, o spike para e registra "sem segredo". `.env.local` nunca entra no commit.

**CA-S11-01 Envio de teste à conta, sem domínio [APROVADO premissa; resultado a medir].** Dado uma conta Resend com zero domínios verificados e a chave restrita, quando o spike envia **um** e-mail de teste ao endereço da conta do titular, usando o remetente de teste que a documentação oficial indicar (valor literal registrado, não assumido aqui), então há exatamente um de dois resultados registrados:
- (a) **ACEITO:** resposta de sucesso com status e identificador do envio; o e-mail chega à caixa do titular; o painel de logs mostra o envio como entregue.
- (b) **RECUSADO:** status HTTP e o **código de erro literal** devolvido pelo Resend (sem corpo com dados sensíveis); se a resposta citar domínio, registrar o texto. Não inferir código nem mensagem.

Em ambos os casos: data (AAAA-MM-DD), método usado (SDK ou HTTP direto), URL oficial consultada e data de acesso.

**CA-S11-02 Recusa é resultado válido [APROVADO; decisão 15].** Dado o resultado (b), quando o spike termina, então o registro vale como resposta do provedor, não como falha do spike. O desenho segue com `EMAIL_PROVIDER=mailpit` e o adapter Resend recusando envio sem domínio (N-10). Não são tentados contornos (outro remetente, outro endereço, outra conta) sem nova decisão.

**CA-S11-03 Bounce com endereço de teste [APROVADO endereço (13); PROPOSTA método].** Dado a chave restrita, quando o spike envia um e-mail ao endereço de teste `bounced@resend.dev` (VERIFICADO herdado de 13; reconfirmar), então o status do envio aparece como bounce no painel/logs do Resend e isso é registrado como evidência. Se houver URL pública de webhook (depende de S-09 ou de túnel, NÃO VERIFICADO), o evento assinado chega e é validado com `RESEND_WEBHOOK_SECRET` (valor não impresso). Sem URL pública, o webhook fica NÃO VERIFICADO com motivo "sem URL pública" e a prova é só pelos logs. Nenhum bounce com endereço real de terceiro.

**CA-S11-04 Cota diária e mensal como requisito [APROVADO requisito; números VERIFICADOS herdados de 13].** Dado o plano gratuito (100 e-mails por dia, em dia UTC; 3.000 por mês; cada destinatário conta; e-mails de teste `resend.dev` também contam; 10 req/s, acima disso 429), quando o spike registra seus envios reais, então:
- o contador `external_quota(email)` (N-08) registra 1 unidade por destinatário, por dia UTC e por mês;
- o total do dia e do mês lido no painel do Resend bate com o contador;
- o spike não excede a cota de propósito (19 §4).

Os limiares de alerta (70/85/95%; aviso em ≥ 90/dia e ≥ 2.700/mês; reserva de 10/dia e 300/mês para `auth`) são **[PROPOSTA]** de ADR-022 e não são confirmados por este spike. Formato real da resposta de cota excedida: **NÃO VERIFICADO**; é testado só com dublê local (N-08/N-09).

**CA-S11-05 Limite de envios reais do spike [PROPOSTA].** Dado a cota diária de 100, quando o spike executa, então faz no máximo **5 envios reais** no total (aceite, bounce e eventuais repetições). Isso preserva a cota do dia para o próprio titular. O número é proposta e precisa de confirmação (dúvida D-S11-3).

**CA-S11-06 Fonte por número [APROVADO; regra CA-S08-00a].** Dado qualquer limite, preço ou prazo registrado, então a linha traz valor literal, unidade, período, URL completa, data de acesso e status (`VERIFICADO` ou `NÃO VERIFICADO` com motivo). A divergência de plano Pro (duas linhas em 13: US$ 20 com 50.000 e US$ 35 com 100.000) segue NÃO VERIFICADO e não é decidida aqui.

**CA-S11-07 Dublê e local, sem conta [APROVADO; 19 §4 passos 1 e 2].** Dado que não há domínio, quando o spike roda a parte local, então testa: (i) adapter Mailpit (SMTP) como único destino em dev e CI; (ii) dublê HTTP do Resend devolvendo cota excedida e 429; (iii) N-08, N-09 e N-10 sobre `external_quota(email)`. Esses testes não dependem de domínio. A parte local de Supabase Auth com Mailpit depende de Docker e Supabase CLI, ausentes nesta máquina (19 §2.4), e fica pendente do Gate 3.

---

## 2. O que o resultado libera

| Item | Se (a) ACEITO no teste à conta | Se (b) RECUSADO | Continua bloqueado |
|---|---|---|---|
| **H-093** `EmailProviderPort` com Mailpit e Resend | Adapter Resend pode ser testado de ponta a ponta com envio à conta, em modo de teste ainda a definir (dúvida D-S11-1). Produção segue recusando sem domínio (N-10) | Adapter Resend recusa todo envio sem domínio; dev e CI usam Mailpit | Envio real a terceiros (domínio, BK-10) |
| **H-016** cadastro e login do profissional | Fluxo de verificação de e-mail pode ser desenvolvido com Mailpit | Igual | SMTP do Supabase Auth com Resend (domínio é pré-requisito oficial, 13) |
| **H-011** desafio do cliente | Caminho de envio pelo `EmailProviderPort` fica destravado no código (depende de H-093) | Igual, com Mailpit | Prova real de envio ao cliente (domínio) e S-01 (prova pendente) |
| **H-094** cota do Resend | Contador e alertas são validados contra números confirmados (CA-S11-04) | Idem, sem o número real do envio | Limiares, que continuam PROPOSTA |

Nada disso libera envio a terceiros nem produção. Domínio verificado continua obrigatório para envio real (decisão 15, ADR-022 R-33, BK-10, H-121).

---

## 3. Fora do escopo

- Compra, registro e configuração de domínio, DNS (SPF, DKIM, DMARC) e verificação no Resend: decisão do usuário (BK-10).
- Envio a qualquer endereço que não seja o da conta do titular (clientes, profissionais, administradores, terceiros). Só os endereços de teste `resend.dev` são permitidos.
- Exceder a cota real de propósito.
- SMTP do Supabase Auth com Resend (exige domínio verificado).
- Webhook em URL pública (depende de S-09 ou de decisão de túnel).
- Criar conta ou chave sem autorização de execução (BLQ-EXEC, SD-14).
- Plano Pro e preços (S-08); termos e textos jurídicos (L2, L3, L7).
- Notificação de reclamação (`complained@resend.dev`) e supressão: não entram nesta rodada.
- Código de produto e branch `spike/S-11`: são do DEV, na etapa de desenvolvimento. Este refino não escreve código.

---

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-S11-n`; o Orquestrador encaixa na lista contínua da sessão.

1. **[BLOQUEANTE para o teste à conta]** Conflito de desenho: ADR-022, H-093 e N-10 dizem que o adapter Resend recusa envio sem domínio verificado; a premissa do usuário pede envio de teste à conta. Opções: (a) teste somente por script do spike, fora do produto, e o adapter continua recusando (**recomendado agora**); (b) "modo de teste" no adapter que redireciona só ao e-mail da conta (exige decisão do Architect; altera H-093 e N-10). Recomendação: (a) agora; (b) só depois do resultado de (a).
2. **[BLOQUEANTE para executar]** Autorização de execução (BK-6 b, SD-14) para criar conta e chave restrita a envio, somente para o S-11. **Recomendação:** autorizar só isso, sem domínio e sem outro serviço.
3. **[NÃO BLOQUEANTE]** Confirmar o limite de 5 envios reais no spike (CA-S11-05). Recomendação: sim.
4. **[NÃO BLOQUEANTE]** Aceitar que o bounce seja provado só pelos logs enquanto não houver URL pública (S-09). Recomendação: sim.
5. **[NÃO BLOQUEANTE]** Registrar a decisão do usuário em `11-DECISOES.md` com o número sequencial e atualizar T8 e `12-TODO.md` #2 (domínio). Quem registra: Orquestrador.
6. **[NÃO BLOQUEANTE]** `14-BACKLOG` e `19 §3.2` tratam H-093 como bloqueado por conta e domínio (BLQ-EXEC). Com (a) da dúvida 1, H-093 pode avançar em dev sem domínio. Atualização do backlog: Orquestrador ou Architect.
7. **[TÉCNICO, BLOQUEANTE para commit e push]** Nesta sessão não há ferramenta de shell nem ferramenta GitHub. Não foi possível rodar `git add`, `git commit` nem `git push`; também não foi possível confirmar a presença do `.git` no repositório (a busca por `.git` em `D:\projetos\fastpro` não retornou nada, coerente com 19 §2.4). O arquivo foi criado e **não** foi commitado nem enviado. Pedido: commit com `Refs: #10` e os trailers indicados, feito por sessão com shell, após conferir este arquivo. Nada foi simulado.

---

## Resumo em linguagem simples

O teste de envio de e-mail do serviço vai ser feito só para o e-mail da própria conta, e o spike vai descobrir se o serviço aceita isso sem domínio próprio. Se aceitar, libera o desenvolvimento do envio de e-mails com teste controlado; se recusar, seguimos só com o e-mail de teste local, e nada vai para terceiros.
