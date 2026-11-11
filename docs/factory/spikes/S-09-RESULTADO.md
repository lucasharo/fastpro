# S-09 — PARCIAL ENCERRADO: NestJS como função única na Vercel (Issue #8)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Workflow:** WF-03 (execução de spike, coluna Desenvolvimento)
- **Desenho seguido:** `docs/factory/40-SPIKE-S09-DESENHO.md` (passos 0 a 10), substituído na parte da Vercel pela decisão `docs/factory/41-DECISAO-S09-CAMINHO.md` (opção 1)
- **Código do spike e script reutilizável para a H-009:** `docs/factory/spikes/s09/`
- **Status:** PARCIAL ENCERRADO. Nenhuma ação na Vercel depois do bloqueio. Nenhum deployment de produção existe. Valores abaixo são **locais**, não da Vercel.

## 1. Passo 0 — Pré-checagem (feita antes do bloqueio)

| Item | Resultado |
|---|---|
| Autorização do titular (2026-11-11) | Recebida; usada para 1 projeto Hobby de preview, token da conta pessoal, remoção ao final |
| Conta do token | Plano Hobby; único membro é a própria conta. O CLI só opera pelo time Hobby de dono único; a conta pessoal não é aceita como escopo do CLI (decisão do titular) |
| Projetos remanescentes antes | 0 |
| Vínculo Git | Nenhum (`project inspect` sem repositório conectado) |
| Uso do painel antes | NAO VERIFICADO |

## 2. Passos 1 a 2 — App e variáveis (feitos antes do bloqueio)

- App NestJS (adapter Express) com as rotas do desenho. `tsc --noEmit`: exit 0.
- Projeto Vercel `fastpro-spike-s09` criado. Variáveis de preview `APP_ENV`, `LOG_LEVEL` e `JOBS_TICK_SECRET` cadastradas e depois **removidas**.
- `DATABASE_URL_APP_API` não cadastrada (pooler sem host confirmado; ver L1).
- Região no `vercel.json`: `gru1` (suposição; região do Supabase do spike NAO VERIFICADO).

## 3. Bloqueio de plataforma (passo 3)

- Tentativa: `vercel deploy --environment preview -y`. Resposta da Vercel: primeiro deployment de projeto novo é atribuído à **produção** ("first_deployment_production"). `--prod` não foi usado. Nenhum deployment foi criado (`vercel ls`: "No deployments found").
- Após a decisão 41, **nenhuma ação na Vercel** foi feita: nem deploy, nem `env`, nem `link`, nem chamada de escrita.
- Projeto `fastpro-spike-s09` continua na conta, sem deployments e sem variáveis. A remoção exige aprovação humana pela CLI; não foi feita (ver §7).

## 4. Medições locais (linha de base, máquina local, Node 22.14; **não são da Vercel**)

| Medida | Resultado |
|---|---|
| `GET /health` aquecido, 30 amostras (curl) | p50 1,24 ms; p95 5,38 ms; todas HTTP 200 |
| Primeira resposta após subir o servidor | 30 ms |
| `bootMs` (criação do app Nest) | 22 ms |
| RSS do processo | 77 a 86 MB durante os testes |
| Tick sem segredo / com segredo | 401 / 200 vazio, `Cache-Control: no-store` |
| Log do servidor com o segredo de teste | 0 ocorrências |
| `POST /v1/webhook-probe` | 200; registra só presença de `x-signature` e `x-request-id` |
| `POST /v1/image-probe` (sharp, PNG sintético 1,78 MB) | 200; saída 24.516 bytes; 93 ms; RSS 84 MB |
| `POST /v1/echo` com JSON de 1 MB | 200 |
| `GET /v1/ping-db` sem banco | 503 `db_not_configured` (esperado, sem conexão) |
| Pacote esbuild (sem sharp) | 2.873.418 bytes (~2,7 MB) |

## 5. L1 — Pooler a partir da máquina local (decisão 41, passo 2)

- **NAO VERIFICADO.** O host e a região do pooler precisam ser lidos pelo MCP do Supabase. As ferramentas desse MCP não estavam disponíveis nesta sessão, então o host não foi obtido. Não houve tentativa de conexão ao banco, nem sondagem de regiões.
- Script pronto: `docs/factory/spikes/s09/scripts/pooler-check.cjs`. Lê `POOLER_HOST` e a URL do papel keep-alive só do ambiente e não imprime nenhum deles. Faz 50 `SELECT 1` concorrentes, 200 transações com `set_config` local (contando vazamentos) e agregados de `pg_stat_activity`. Sem DDL. Recusa host direto. Teste da barreira: sem `POOLER_HOST`, sai com código 2 e mensagem clara.
- Para executar: ler o host pelo MCP do Supabase, exportar `POOLER_HOST` e rodar `node scripts/pooler-check.cjs` na pasta do spike.

## 6. L2 — `sharp` linux-x64 (decisão 41, passo 3)

- Pacote de produção para linux-x64 (`npm ci --omit=dev --os=linux --cpu=x64 --libc=glibc`): **51 MB** no total. Sharp com binários `@img`: ~34 MB. Meta ≤ 250 MB: atendida no empacotamento.
- Carga do binário em WSL: **NAO VERIFICADO.** Não há distribuição WSL instalada (`wsl.exe -l -v`). Não instalei nada, conforme a decisão.
- Carga do `sharp` na própria máquina Windows: feita (ver §4). Não substitui a carga em linux.

## 7. L3 — Limite de corpo de 4 MB no Nest (decisão 41, passo 4)

- Configuração: `express.json({ limit: '4mb' })` com middleware de erro próprio que devolve **413** em JSON (`{"error":"payload_too_large","limit":"4mb"}`), sem depender do limite da plataforma.
- Script: `docs/factory/spikes/s09/scripts/body-limit-check.cjs` (sobe o handler empacotado em porta efêmera e fecha o servidor ao final).
- Resultado (local): 1,0 MB → 200; 3,5 MB → 200; 4,0 MB exato → 200 (limite inclusivo); 4,0 MB + 1 byte → 413; 4,5 MB → 413; 5,0 MB → 413. **allOk: true.**
- Resta confirmar na plataforma o 413 de 4,5 MB da Vercel: NAO VERIFICADO.

## 8. Itens NAO VERIFICADO (lista completa)

- Cold start e aquecido **na Vercel** (passo 5).
- Teto de 300 s com `sleep` de 330 s (passo 7).
- 413 do limite **da plataforma** Vercel (passo 7).
- Memória **na plataforma** (passo 7).
- Função única no painel ou MCP (passo 4) e tamanho do pacote no build da Vercel.
- Proteção de deploy e bypass de automação (passo 3.4).
- Webhook a partir de fora e estabilidade da URL de pré-visualização (passo 8.2).
- `sharp` carregando em linux-x64 (L2 em WSL) e na função Vercel.
- Pooler: latência, 0 erro em 50 concorrentes e 0 vazamento em 200 (L1, depende do host do MCP).
- Uso de cota e do painel antes e depois (passo 0.4 e 10).
- Região do Supabase do spike; região `gru1` é suposição.
- Opção 3 (`vercel build` local e contagem de funções): não executada (depende de OK do Orquestrador).

## 9. Pendências e ações do titular ou Orquestrador

1. **Pré-visualização real** (gate da H-009, primeiro item): decidir o caminho do primeiro deploy (decisão 41, opção 2 ou outra), com autorização própria. Até lá, o ADR-018 A fica **provisório**.
2. **Host do pooler** pelo MCP do Supabase para executar L1.
3. **Projeto `fastpro-spike-s09`:** apagar pelo painel da Vercel pelo titular, ou aprovar a remoção (a CLI exige aprovação humana). Não foi removido por API.
4. **Servidor local da porta 3900** segue rodando (iniciado nesta execução). A pedido do coordenador, não foi encerrado. Deve ser encerrado manualmente.
5. Arquivos `.env.local` e `.vercel/` do spike foram removidos. Segredo de teste apagado da pasta de rascunho.

## 10. Resumo em linguagem simples

O teste na hospedagem parou antes do envio, porque a Vercel publica o primeiro envio de projeto novo como versão de produção, e isso não foi autorizado. No computador, o app respondeu rápido, recusou pedidos sem a senha certa e recusou arquivos maiores que 4 MB. O que depende da hospedagem real e da conexão com o banco ainda não foi medido.
