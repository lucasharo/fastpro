# Desenho do spike S-09 — NestJS como função única na Vercel (Issue #8, WF-03, Arquitetura)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Rastro:** 31-REFINO-S09 (CA-S09-00 a 09); 19 §4 (S-09); 10-ADRS ADR-018 e ADR-020; 11 R-10, R-29, R-31; 14 (S-09, H-008, H-009, H-022); 08 §16; S-02-RESULTADO; S-08-RESULTADO (§1 Vercel).
- **Natureza:** SOMENTE documento. Nenhum projeto, deploy, variável ou chamada externa foi feita nesta etapa. Valores de `.env.local` não foram lidos nem impressos (só os nomes das variáveis foram listados).
- **Correção de rota:** a tentativa anterior publicou um projeto de teste como produção sem autorização; o projeto foi apagado. Este desenho vale **somente para ambiente de visualização (preview)**. Não haverá deploy de produção, promoção, domínio nem projeto de produção.
- **Decisão do Architect:** `APROVADO_ARQUITETURA` (o desenho é suficiente para o DEV executar). A **execução fica bloqueada** até a autorização explícita da dúvida 1 (§4).
- **Fatos já verificados (S-08, 2026-11-10):** Hobby = função até 300 s, 2 GB e 1 vCPU; 1.000.000 invocações/mês; deploys 100/dia; logs de runtime 1 h; corpo de requisição/resposta da função 4,5 MB (413 acima disso); NestJS vira **uma** função com Fluid compute, bundle ≤ 250 MB. Supabase Free: 60 conexões diretas, 200 clientes no pooler, pool padrão 15; host direto só IPv6.

---

## 1. Plano de teste do DEV (passos exatos)

Código descartável em `docs/factory/spikes/s09/` na branch `feature/init` (mesmo padrão de `spikes/s03` e `spikes/s11`; pasta com `package.json` próprio, fora do workspace pnpm; `node_modules/` e `.vercel/` já estão no `.gitignore`). Só dados sintéticos.

**Passo 0 — Pré-checagem (obrigatória, registrar saída).**
1. Confirmar a autorização da dúvida 1 na Issue #8. Sem ela, parar.
2. Confirmar que não há projeto Vercel remanescente: listar projetos pelo MCP da Vercel (somente leitura) ou `vercel project ls`. Esperado: nenhum projeto de spike. Registrar só a contagem.
3. Confirmar que `git remote -v` do repositório não será ligado ao projeto Vercel (sem integração Git, para nenhum push gerar deploy de produção automático).
4. Anotar uso do painel (invocações, banda) **antes**. Se o MCP não expuser, o titular informa os números.

**Passo 1 — App mínimo (local).** NestJS (adapter Express) com: `GET /health` (JSON: `instanceId` gerado no carregamento do módulo, `bootMs` do bootstrap, `uptimeS`, `rssMb`; nenhum valor de ambiente), `GET /v1/ping-db`, `GET /v1/ping-db-claims`, `POST /v1/echo`, `GET /v1/sleep?s=`, `POST /internal/jobs/tick` (401 sem segredo; 200 vazio com `x-jobs-secret`; `Cache-Control: no-store`; sem CORS), `POST /v1/webhook-probe` (sem banco; registra só nomes de `x-signature` e `x-request-id`, tamanho do corpo e horário), `POST /v1/image-probe` (CA-S09-09). Entrada `api/index.ts` exporta o handler do Express (app criado uma vez por instância, em cache de módulo). `vercel.json`: rewrite `/(.*)` para `/api`, `functions.api/index.ts.maxDuration: 300`, `regions` com **uma** região (a mais próxima do Supabase de spike, a confirmar; Hobby aceita uma). Empacotar com esbuild; registrar tamanho do pacote (MB) e número de dependências de produção.
- Cliente `pg`: `max: 1`, `ssl` ligado, **somente consultas simples** (sem prepared statements, pois o pooler em modo transação não os suporta), `idleTimeoutMillis` curto. Sem ORM.
- Local: subir o handler e medir tempo até a primeira resposta e RSS (linha de base).

**Passo 2 — Projeto de spike e variáveis (somente com autorização).**
1. Autenticar com `VERCEL_TOKEN` **pela variável de ambiente do processo** (nunca `--token` na linha de comando, nunca em arquivo versionado, nunca impresso).
2. `vercel link` na pasta do spike, criando **um** projeto Hobby `fastpro-spike-s09` (nome sem dado do produto).
3. Cadastrar **apenas** `APP_ENV=spike`, `LOG_LEVEL`, `DATABASE_URL_APP_API` (pooler, modo transação), `JOBS_TICK_SECRET` (aleatório novo, só para o spike). Escopo **preview**. Comando `vercel env add <NOME> preview --sensitive` com o valor lido de variável de shell e enviado por stdin, sem eco (conferir `vercel env add --help` da versão instalada; se não funcionar, o titular cadastra no painel). Proibido cadastrar: `MP_*`, `SUPABASE_SECRET_KEY`/service role, `DATABASE_URL_MIGRATIONS`, chaves de e-mail e Mapbox.
4. Banco: usar o pooler (usuário no formato `usuario.<ref do projeto>`, porta do modo transação). O host e a região do pooler vêm do painel ou do MCP do Supabase (sem imprimir senha). Usar o papel de menor privilégio já existente (dúvida 3). **Sem migração e sem DDL** (não colide com a #24).

**Passo 3 — Deploy de preview (única forma permitida).**
1. `vercel deploy` **sem** `--prod` (conferir em `vercel deploy --help` se `--target=preview` existe e usá-lo explicitamente).
2. Conferir na saída e pelo MCP (`list_deployments`/`get_deployment`) que `target` não é `production` e que a URL é de preview. Registrar só a forma da URL, sem ID.
3. Se `target=production` aparecer em qualquer momento: **parar**, não promover nem apagar sozinho, registrar na Issue e avisar o Orquestrador.
4. Verificar a proteção de deploy do projeto (padrão do Hobby tende a proteger previews, NÃO VERIFICADO). Manter a proteção ligada. Para testar, usar o *Protection Bypass for Automation* (segredo gerado pela Vercel, guardado em variável local, nunca impresso). Se não existir no Hobby, o titular fornece link compartilhável. Registrar o que foi possível.

**Passo 4 — Função única (CA-S09-01).** `GET /health` retorna 200; o painel/MCP mostra **uma** função para a API; registrar tamanho do pacote e dependências.

**Passo 5 — Cold start e tempo (CA-S09-02).** Script local (`curl -w '%{time_total} %{http_code}'`, um arquivo CSV fora do repositório) com 10 amostras de cold start e 30 aquecidas em `/health`, e 30 aquecidas em `/v1/ping-db`. Classificar cada amostra como fria quando o `instanceId` for novo (evidência do servidor), não pelo tempo de espera. Meios de obter instância fria: ocioso ≥ 20 min entre amostras (≈ 3,5 h, em segundo plano) **ou** redeploy do mesmo código (cada deploy é uma instância nova; limite 100 deploys/dia). Registrar p50/p95, `bootMs`, código HTTP e o cabeçalho de região/identificação (nome a confirmar). Informar se a medição foi com o bypass de proteção (adiciona salto).

**Passo 6 — Banco pelo pooler (CA-S09-04).**
1. `GET /v1/ping-db` devolve `SELECT 1` e libera a conexão.
2. 50 chamadas concorrentes (`npx autocannon -c 50 -a 500`, executado da máquina local) em `/v1/ping-db`. Registrar erros (esperado 0), p95 e códigos.
3. Durante o teste, uma consulta **somente leitura** à `pg_stat_activity` (agregada por `usename` e `state`, sem texto de consulta nem IP) pelo MCP do Supabase ou `psql`, para registrar o número de conexões do pooler ao banco.
4. `GET /v1/ping-db-claims`: em transação, `set_config('app.s09', <valor único da requisição>, true)`, `SELECT current_setting('app.s09')`, `COMMIT`. Rodar 200 requisições concorrentes e confirmar **0 vazamento** (cada resposta devolve o próprio valor). Fecha o risco V-3 do S-02.
5. Variante opcional: repetir o passo 2 com `max: 5` e comparar p95 (Fluid compute atende várias requisições por instância; `max: 1` as serializa).

**Passo 7 — Teto de duração, memória e corpo (CA-S09-03).**
1. `GET /v1/sleep?s=330` **uma vez**: esperado encerramento em ≈ 300 s com erro de plataforma. Registrar tempo e código; vale o observado.
2. `rssMb` em `/health` antes e após 100 chamadas a `/v1/echo`.
3. `POST /v1/echo` com corpo sintético de 5 MB: esperado 413 (confirma upload direto ao Storage, R-31).

**Passo 8 — Tick e webhook (CA-S09-05 e 06).**
1. Tick: sem segredo = 401; com segredo = 200 vazio; cabeçalho `no-store`; nenhum valor em log.
2. Webhook-probe: `POST` sem autenticação, resposta 200 em até 5 s. Registrar se a proteção de deploy bloqueia chamadas externas sem bypass e se a URL de preview é estável entre deploys. O Mercado Pago não envia cabeçalho personalizado, portanto, se só funcionar com bypass, registrar "URL de preview inadequada para S-03" (resultado válido, não reprova o spike).

**Passo 9 — Binário nativo (CA-S09-09).** `POST /v1/image-probe`: `sharp` gera e redimensiona uma imagem sintética de 2 MB; registrar se o binário carrega, tamanho do pacote com `sharp`, tempo e RSS. Se falhar, registrar o erro exato e as alternativas (biblioteca em WebAssembly); não reprova o spike.

**Passo 10 — Encerramento.** Anotar uso do painel **depois** (invocações e banda) e comparar com o antes. Escrever `docs/factory/spikes/S-09-RESULTADO.md` (tempos, códigos, contagens, tamanhos; sem valor de segredo, ID de projeto/deployment ou URL com token). Remover o segredo de bypass e o `JOBS_TICK_SECRET` do ambiente local. Apagar o projeto e os deploys **somente com autorização da dúvida 4**. Commit na `feature/init` com `Refs: #8`.

---

## 2. Regras de segurança

1. **Somente preview.** Proibidos: `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel rollback`, `vercel alias`, `vercel domains`, `vercel git connect`, qualquer ferramenta do MCP da Vercel que implante (por exemplo, a de deploy automático), ou que mude o ambiente de produção, domínio ou plano. Cada comando de deploy é conferido contra esta lista antes de rodar.
2. **Um projeto, um spike.** Exatamente um projeto Hobby de spike; nenhum projeto de produção, nenhum domínio próprio, nenhum plano Pro, nenhuma rota de cobrança.
3. **Sem integração Git** no projeto de spike. O deploy sai da pasta local pela CLI.
4. **Sem segredo em código, documento, log, histórico de shell ou commit.** Segredos só em variável de ambiente do processo e no cofre de variáveis da Vercel (tipo sensível). Valores nunca são impressos; relatórios citam apenas nomes. Antes do commit, varredura com gitleaks (ou a verificação do repositório) na pasta do spike. `.vercel/` fica fora do Git.
5. **Menor privilégio nas variáveis:** só as quatro do §1 passo 2.3, no escopo preview. Banco pelo pooler com papel sem permissão de escrita no esquema da aplicação.
6. **Proteção de deploy ligada.** Não desligar para facilitar teste. Segredo de bypass tratado como credencial.
7. **Sem DDL, sem migração, sem escrita de dados no Supabase.** O spike só faz `SELECT`. Não toca nas migrações nem no e-mail da #24.
8. **Dados sintéticos; nenhum visitante real; nenhum pagamento** (decisão 28: Hobby não processa pagamento de visitante). Sem Mercado Pago, Resend ou Mapbox neste projeto.
9. **Credencial por conta própria do titular:** `VERCEL_TOKEN` só por variável de ambiente; nunca `--token` na linha de comando; nunca classificar credencial pelo prefixo.
10. **Parada obrigatória** se aparecer qualquer deploy com `target=production`, projeto não esperado ou erro de escopo. Registrar na Issue e avisar o Orquestrador; não improvisar correção destrutiva.
11. **Limite técnico:** 3 tentativas por etapa; ao esgotar, parar e relatar.

---

## 3. Critério de decisão do spike

**Obrigatórios (qualquer falha = AJUSTES_NECESSARIOS ou contingência):**

| Critério | Aprovado quando | Origem |
|---|---|---|
| Só preview | 100% dos deploys com `target` diferente de produção; nenhum domínio e nenhum projeto de produção | CA-S09-00/08 |
| Função única | painel/MCP mostra uma função para a API; pacote ≤ 250 MB (alerta acima de 100 MB) | CA-S09-01 |
| Pooler | 0 erro de conexão em 50 concorrentes; 0 vazamento de `set_config` em 200 requisições; host direto não usado | CA-S09-04 |
| Teto e memória | encerramento observado ≈ 300 s (±5 s); RSS pós 100 chamadas < 1 GB (50% do limite); 413 acima de 4,5 MB | CA-S09-03 |
| Segredo | zero valor em log, `/health`, documento ou commit; tick 401 sem segredo | CA-S09-05/08 |
| Cota | uso do painel depois dentro do Hobby; nada cobrado | CA-S09-07 |

**Referência (propostas, não reprovam sozinhas; o Architect decide):**
- Cold start p95 ≤ 3 s e aquecido p95 ≤ 500 ms (`/health`); `ping-db` aquecido p95 ≤ 500 ms. Cold start entre 3 s e 6 s: **aprovar com mitigações** (bundle esbuild enxuto, módulos carregados sob demanda, Vercel Cron diário como keep-alive; webhook só grava e responde, R-10). Acima de 6 s ou erro recorrente de inicialização: acionar contingência B/C/D do ADR-018.
- Webhook-probe 200 em até 5 s; URL estável e acessível sem bypass. Se não, S-03 usa outra via (túnel temporário local) e H-048 registra o motivo.
- `sharp` carrega: libera H-027 e H-056. Se não, ficam bloqueadas até S-06 ou alternativa em WebAssembly.

**Resultado possível:**
- **APROVADO** (ADR-018 A confirmada): libera H-009 (API como função única), o endpoint protegido do tick (H-008, sem decidir A/B/C) e, se `sharp` carregar, H-027/H-056.
- **APROVADO COM RESSALVAS:** cold start ou webhook fora da referência, com mitigação registrada no ADR-018/R-10.
- **REPROVADO:** obrigatório falhou; Architect propõe B, C ou D ao Orquestrador. H-022 (geo) e H-046 não dependem do S-09.

---

## 4. Dúvidas ao Orquestrador (numeração provisória `D-S09-n`)

1. **[BLOQUEANTE]** Autorização explícita e escrita, pelo usuário, para criar **um** projeto Vercel Hobby de spike com **somente** deploys de preview, listando os comandos permitidos do §2. Dado o incidente anterior, não presumir autorização por inferência. **Recomendação:** pedir a autorização com esta lista e registrar em `11-DECISOES.md`.
2. **[BLOQUEANTE]** Uso do `VERCEL_TOKEN` já presente no `.env.local` (o DEV usará via variável de ambiente, sem imprimir), conferindo antes que o token pertence à conta pessoal Hobby. **Recomendação:** autorizar o uso; se o token tiver escopo de equipe paga, usar outro.
3. **[BLOQUEANTE para o passo 6]** Credencial do banco: `DATABASE_URL_APP_API` não existe no `.env.local`. Alternativas: (a) reaproveitar o papel de menor privilégio do keep-alive (H-010) apontando para o pooler, sem DDL; (b) criar um papel novo `spike_s09` sem permissão e apagá-lo no fim (é DDL no projeto Supabase, ainda que sem migração). **Recomendação:** (a); se o papel não conectar no pooler, (b) com autorização.
4. **[BLOQUEANTE para o passo 10]** Autorização para apagar o projeto de spike e seus deploys ao final (operação destrutiva, regra 5). **Recomendação:** autorizar a remoção só do projeto criado por este spike, após o resultado registrado.
5. **[NÃO BLOQUEANTE]** Incluir `ping-db-claims` (V-3) e `image-probe` (CA-S09-09), que o refino deixou em aberto. **Recomendação:** incluir ambos (custo baixo; liberam H-003/H-027/H-056).
6. **[NÃO BLOQUEANTE]** Aprovar os limiares de referência do §3 (já proposto em D-S09-4). **Recomendação:** aprovar como referência.
7. **[NÃO BLOQUEANTE]** Local do código: pasta `docs/factory/spikes/s09/` na `feature/init` (**recomendado**, cumpre a regra de trabalhar sempre na `feature/init`) em vez de branch `spike/S-09-*`.
8. **[NÃO BLOQUEANTE]** Webhook do Mercado Pago em preview protegido: provável incompatibilidade (sem como enviar o cabeçalho de bypass). **Recomendação:** registrar o fato e não desligar a proteção; S-03 decide a via.
9. **[REGISTRO]** Concorrência com a #24: o S-09 só lê o banco e não altera `.env.example` nem migrações; commits devem incluir somente os arquivos do spike (`git add` por caminho), pois há alterações pendentes da #24 na árvore.
10. **[REGISTRO]** Conflito já anotado no refino (item 8): S-02-RESULTADO lista PostGIS, `pg_cron` e `pg_net` como disponíveis, contra 13/ADR-020. Atualizar ADR-020 antes de H-022/H-008; não afeta este spike.

---

## Resumo em linguagem simples

Vamos testar, só em ambiente de teste e nunca no site de verdade, se a parte do sistema que responde aos pedidos funciona na hospedagem gratuita: quanto tempo leva para acordar, se aguenta muitos acessos ao banco e quanto tempo a hospedagem deixa uma tarefa rodar.
Nada é publicado de verdade nem cobrado, nenhuma senha aparece em arquivo, e o teste só começa depois que você autorizar de forma clara o projeto de teste e, no fim, a remoção dele.
