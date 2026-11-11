# Refino S-09 — NestJS como função única na Vercel (Issue #8, spike, WF-03, Product Owner)

- **Data:** 2026-11-10 · **Branch:** `feature/init` (confirmada em `.git/HEAD`) · **Rastro:** Issue #8 (21-ISSUES-CRIADAS, linha S-09); 19 §4 (S-09), §7; 08 §16; 10-ADRS ADR-001, ADR-018, ADR-020 e SD-15; 13 (Vercel); 14 (S-09, H-008, H-009, H-022, H-027, H-046, H-048, H-056); 11-DECISOES nº 28; S-02-RESULTADO; 24 (tick); 30 (refino S-03); `workflows/WF-03-FEATURE.md`.
- **Natureza:** SOMENTE documento. Nenhuma função, projeto Vercel, variável, deploy, branch de código, conta ou chamada externa foi criada ou feita. `.env.local` não foi lido; aparecem aqui apenas nomes de variáveis.
- **EXEC-ID:** não gerado (sem ferramenta de shell nesta sessão; `execctl.py` não foi acionado).
- **Etiquetas:** `[APROVADO]` decisão do usuário ou regra vigente · `[DELEGADO]` escolha técnica ao DEV · `[PROPOSTA]` sugestão deste refino, pendente do Orquestrador · `NÃO VERIFICADO` fato externo sem fonte consultada nesta sessão.

---

## 0. Premissas e fatos

- **[APROVADO]** Vercel: o plano Hobby serve só a desenvolvimento e testes; ao começar a cobrar, migrar para o Pro (decisão 28; SD-15 respondida).
- **[APROVADO]** NestJS roda como **uma única função** de API (H1; ADR-001; ADR-018 A), sem processo residente.
- **[APROVADO, reconfirmar na execução via S-08]** Hobby (13; 08 §16.1): função até 300 s; 2 GB de memória e 1 vCPU; 1.000.000 invocações/mês; 100 GB de banda; logs de runtime por 1 h; bundle até 250 MB.
- **[APROVADO]** Variáveis só por **nome** (19 §7). Valores ficam no painel do projeto de spike, cadastrados pelo titular, e nunca em documento, log ou resposta.
- **Fato (S-02-RESULTADO):** o host direto do Postgres do Supabase Free resolve só IPv6. A função usa o **pooler em modo transação** (ADR-018 item 5). O endereço do pooler ainda não foi obtido (S-02, pendência 2).
- **Fato (13):** o log de runtime da Vercel dura 1 h. A medição fica registrada pelo cliente de teste no momento, não depende do painel.

---

## 1. Critérios Given/When/Then

**CA-S09-00 Escopo e autorização [APROVADO BK-6 (b), SD-14].** Dado que criar projeto e cadastrar variáveis exige autorização por spike, quando o DEV executa, então cria somente: 1 projeto Vercel Hobby de spike, com deploy de preview a partir de branch de spike (`spike/S-09-<slug>`, descartável, 19 §4). Não cria projeto de produção, domínio próprio, plano Pro, rota de cobrança nem chave além das listadas em CA-S09-05.

**CA-S09-01 Implantação em função única [APROVADO H1/ADR-001; DELEGADO método].** Dado um app NestJS mínimo com `GET /health`, `GET /v1/ping-db`, `POST /v1/echo` e entrada serverless (handler Express exportado), quando o preview é implantado, então: (a) `/health` responde 200 com JSON sem valor de ambiente; (b) o painel de funções mostra **uma** função para a API, não uma por rota; (c) são registrados tamanho do pacote e número de dependências de produção (teto de 250 MB, NÃO VERIFICADO na execução).

**CA-S09-02 Cold start e tempo de resposta [DELEGADO método; PROPOSTA limiares].** Dado o preview ocioso por ≥ 20 min, quando o cliente de teste (`curl -w`, no ambiente do DEV) faz a primeira chamada a `/health` e mede separadamente, depois 10 amostras de cold start e 30 aquecidas, então registra p50 e p95 de cada grupo, o código HTTP e o cabeçalho de identificação de execução da plataforma (nome a confirmar, NÃO VERIFICADO). Limiares **propostos, não aprovados** (D-S09-4): cold start p95 ≤ 3 s; aquecido p95 ≤ 500 ms. Estourar não reprova sozinho: registra e o Architect escolhe entre ADR-018 A, B, C ou D.

**CA-S09-03 Teto de duração e memória [APROVADO valores do plano, reconfirmar; PROPOSTA teste].** Dado a função de spike com duração configurada no teto do plano, quando uma rota de teste (`GET /v1/sleep?s=…`) é chamada uma única vez com espera acima do teto, então a plataforma encerra a invocação no teto e o cliente registra tempo e código de erro. Se o teto observado diferir do documentado, vale o observado, que vai para S-08 e ADR-020. Memória: o DEV registra a memória residente (`process.memoryUsage().rss`) em `/health` e após 100 chamadas a `/v1/echo`, comparada ao limite documentado de 2 GB.

**CA-S09-04 Banco pelo pooler [APROVADO ADR-018 item 5; DELEGADO método].** Dado `DATABASE_URL_APP_API` com o endereço do pooler em modo transação (projeto Supabase de spike), e cliente `pg` com `max: 1` por instância, quando `GET /v1/ping-db` é chamado, então responde `SELECT 1` e devolve a conexão ao pool. Quando 50 chamadas concorrentes (autocannon ou k6, local) batem em `/v1/ping-db`, então nenhuma falha por limite de conexão ocorre, e a contagem de conexões no banco (`pg_stat_activity`, sem dado pessoal) é registrada. A função **não** usa o host direto. **Bloqueado** até o endereço do pooler ser obtido (D-S09-2). Fora deste critério: a mini-corrida de `update … for update` (19 §S-09 passo 4) fica para H-011 **[PROPOSTA]**; `set_config` por transação via pooler (risco V-3) segue aberto e é do S-02, passo 5.

**CA-S09-05 Variáveis por nome e tick protegido [APROVADO 19 §7; PROPOSTA mínimo].** Dado o projeto de spike, quando as variáveis são cadastradas no preview, então existem somente: `APP_ENV` (valor de spike), `APP_BASE_URL`, `LOG_LEVEL`, `DATABASE_URL_APP_API`, `JOBS_TICK_SECRET`. **Não** existem neste projeto (menor privilégio **[PROPOSTA]**): `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (ficam para S-03), `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL_MIGRATIONS`, `DATABASE_URL_APP_SYSTEM` e chaves de e-mail. `POST /internal/jobs/tick` responde 401 sem o segredo e 200 vazio com ele, sem efeito, sem CORS e com `Cache-Control: no-store` (doc 24, desenho do tick). Nenhum valor aparece em log, em `/health` ou em documento.

**CA-S09-06 Endereço público para o webhook do Mercado Pago [APROVADO como dependência de S-03; proteção e estabilidade NÃO VERIFICADO].** Dado o preview de spike, quando um `POST` sem autenticação chega a `POST /v1/webhook-probe` (sem banco, sem efeito, registra só os nomes de `x-signature` e `x-request-id`, o tamanho do corpo e o horário), então responde 200 em até 5 s **[PROPOSTA]**. Além disso: (a) o caminho não exige login da plataforma (proteção de deploy não bloqueia, NÃO VERIFICADO no Hobby); (b) a URL usada por S-03 é **estável** durante o spike (alias de branch, se existir no Hobby, NÃO VERIFICADO). Se a URL mudar a cada deploy, o registro diz isso e S-03 não é configurado com ela. A validação de assinatura **não** é deste critério: é CA-S03-06 (doc 30).

**CA-S09-07 Plano gratuito serve para desenvolvimento [APROVADO decisão 28; critério PROPOSTA].** Dado o resultado de CA-S09-01 a 06, quando o Orquestrador consolida, então o resultado é "serve para desenvolvimento e spike" somente se: (a) o preview roda dentro do teto, da memória e das cotas documentadas, com painel de uso conferido antes e depois do teste; (b) todas as chamadas são sintéticas, sem visitante real, sem dado pessoal e sem cartão real; (c) nada é cobrado e nada processa pagamento de visitante (a decisão 28 veda isso no Hobby); (d) nenhuma rota de cobrança entra no projeto de spike. Registro: "serve para dev: sim/não, com motivo". **Em nenhum caso serve para cobrança real** (Pro antes da primeira cobrança). O que o Hobby faz ao exceder cota é NÃO VERIFICADO; por isso o painel de uso é conferido antes e depois.

**CA-S09-08 Sem segredo e sem produção [APROVADO, AGENTS item 9; decisão 13].** Dado o resultado do spike, quando é registrado, então contém somente nomes de variáveis, URLs de teste sem segredo, tempos, códigos e contagens. Não contém valor de token, chave, senha nem identificador de projeto (mesma regra do S-02). Nenhum deploy de produção, nenhum domínio e nenhuma promoção são feitos.

**CA-S09-09 Binário nativo de imagem (opcional neste spike) [PROPOSTA; libera H-027 e H-056 se aprovado].** Dado `POST /v1/image-probe` que redimensiona com `sharp` uma imagem sintética de 2 MB, quando chamado, então registra se o binário nativo carrega na função, o tamanho do pacote com `sharp`, tempo e RSS. Sem limiar de aprovação; o limite de foto segue em S-06 (local). Ver D-S09-6.

---

## 2. O que o resultado libera (conforme backlog)

| Item | Se CA-S09-00 a 07 forem aprovados | Se reprovarem ou ficarem pendentes | Continua bloqueado por |
|---|---|---|---|
| **H-009** hospedagem (web, API, admin) | Libera a parte **API** como função única. Web com `/api/*` na mesma origem e admin em projeto separado são testados em H-009 (CA próprios) | Plano B/C/D de ADR-018 | BLQ-EXEC para criar projetos reais; H-001 |
| **H-008** tick de jobs | Libera a **URL pública e o endpoint protegido** (CA-S09-05) usados pelo tick A. **Não** decide A, B ou C | Tick B ou C | S-02 (pg_cron/pg_net), S-10 (decisão A/B/C), H-005 |
| **H-048** webhook idempotente | Libera a **URL pública** (CA-S09-06) para S-03 | Sem URL estável, S-03 CA-06 a 08 ficam NÃO VERIFICADO | D-S09-3; S-03 (doc 30); H-005 |
| **H-027** e **H-056** (fotos) | Libera **só** se CA-S09-09 for aprovado (14 lista S-09 como bloqueante) | Seguem bloqueados; S-06 (local) continua | CA-S09-09 ou decisão D-S09-6; H-026 |
| **H-022** geo | **Não libera.** Depende de S-02 e H-021 (14), não de S-09 | — | S-02 (criação das extensões na H-003); H-021 |
| **H-046** planos e preços | **Não libera.** Depende de H-045 (14) | — | H-045 |
| **H-054** gate de cobrança | **Não libera.** Exige Pro, tarifas verificadas, L1 a L4 e L7, backup | — | Pro (decisão 28); tarifas MP (12-TODO #12); backup |

Se CA-S09-04 (pooler) ficar pendente, o que libera H-008 e H-009 vale só para o endpoint e a URL, não para o banco.

---

## 3. Fora do escopo

- Cobrança real, cartão real, Pix pago, `MP_ENV=production` (Gate M4).
- Upgrade para Pro, cron da Vercel (não usado pelo desenho), domínio próprio (H2: subdomínio da plataforma).
- Produção, promoção de deploy, merge, rollback.
- Topologia (projeto web separado com rewrite x catch-all no web) e cookies `SameSite=Lax` na mesma origem: pertencem a H-009, com a aplicação web real **[PROPOSTA]** (D-S09-7).
- Validação de assinatura do Mercado Pago: S-03 (doc 30).
- Tick A/B/C e atraso real: S-10. Keep-alive e backup: H-010.
- Mapbox, Resend, Supabase Auth: S-04, S-11, S-01.
- Código: a função de spike é escrita pelo DEV em `spike/S-09-<slug>`, descartável. Este refino não escreve código. Nenhuma credencial da Vercel é lida ou registrada aqui.

---

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-S09-n`; o Orquestrador encaixa na lista contínua da sessão.

1. **[BLOQUEANTE para executar CA-S09-00 a 07]** Autorização BLQ-EXEC (SD-14; BK-6 b) para criar **um** projeto Vercel Hobby de spike com preview. Quem cadastra os valores das variáveis: o titular no painel, conforme 19 §7 (recomendado), sem o agente ler nem colar valor. **Recomendação:** autorizar só isso.
2. **[BLOQUEANTE para CA-S09-04]** Endereço do pooler em modo transação do projeto Supabase de spike e seus limites (S-02, pendência 2). **Recomendação:** o titular cadastra a string direto no painel do projeto de spike; o agente não lê `.env.local`.
3. **[BLOQUEANTE para CA-S09-06 e para S-03 CA-06 a 08]** A URL do webhook é estável e sem proteção de deploy no Hobby? **NÃO VERIFICADO.** **Recomendação:** o DEV verifica na documentação oficial na execução (S-08). Se não der, S-03 fica NÃO VERIFICADO com motivo "sem URL estável".
4. **[NÃO BLOQUEANTE]** Aprovar como referência os limiares propostos: cold start p95 ≤ 3 s, aquecido p95 ≤ 500 ms, webhook-probe ≤ 5 s. **Recomendação:** aprovar como referência, sem reprovação automática (o Architect decide).
5. **[NÃO BLOQUEANTE]** Teste do teto de 300 s (uma invocação de cerca de 5 min). **Recomendação:** fazer uma vez; se o plano mudar, o valor observado prevalece.
6. **[BLOQUEANTE para liberar H-027 e H-056]** Incluir CA-S09-09 (`sharp`) neste spike ou deixá-lo para S-06 local. **Recomendação:** incluir, como rota mínima. Sem isso, o backlog (14) mantém H-027 e H-056 bloqueados.
7. **[NÃO BLOQUEANTE]** Topologia e cookies: adiar para H-009 (**recomendado**) ou medir agora com dois projetos de spike (mais tempo e mais projetos Vercel).
8. **[NÃO BLOQUEANTE, registro]** Conflito de fatos: 13 e ADR-020 dizem que PostGIS, `pg_cron` e `pg_net` não foram encontrados no plano Free, mas S-02-RESULTADO (2026-11-10) registra as três disponíveis no catálogo do projeto. **Recomendação:** o Architect atualiza ADR-020 e V-1 antes de H-022 e H-008. Não altera os critérios deste refino.
9. **[NÃO BLOQUEANTE]** Uso do Hobby com sandbox do Mercado Pago e usuários de teste, sem visitante e sem pagamento real (decisão 28; BK-3 (a), citado no doc 30 como D-S03-1). **Recomendação:** o Orquestrador pergunta ao usuário uma vez e registra em 11-DECISOES. A decisão 28 veda processar pagamento de visitante, não sandbox de teste.
10. **[TÉCNICO, BLOQUEANTE para commit e push]** O pedido diz "não commite, não faça push" e, na entrega, "commit com `Refs: #8` … push". Esta sessão não tem ferramenta de shell: não rodei `git add`, `git commit` nem `git push`. O arquivo foi criado e **não** foi commitado nem enviado. **Pedido:** commit com `Refs: #8` e os trailers indicados, feito em sessão com shell, depois de conferir este arquivo. Nada foi simulado.
11. **[NÃO BLOQUEANTE, conferência]** Não consultei o GitHub nesta sessão (sem `gh` e sem shell). 21-ISSUES-CRIADAS mapeia S-09 para #8. **Pedido:** confirmar que #8 está na coluna Product Owner e na fila de aprovação antes de movimentar o cartão.

---

## Resumo em linguagem simples

Vamos testar se a parte do sistema que responde aos pedidos roda na hospedagem gratuita, quanto tempo leva para "acordar", quantos recursos usa e se o aviso de pagamento consegue chegar até ela. Nada é cobrado nem publicado; a hospedagem gratuita serve para testes, e a versão paga só entra antes da primeira cobrança real.
