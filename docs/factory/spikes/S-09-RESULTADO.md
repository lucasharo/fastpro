# S-09 — Resultado parcial: NestJS como função única na Vercel (Issue #8)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Workflow:** WF-03 (coluna Desenvolvimento, execução de spike)
- **Desenho seguido:** `docs/factory/40-SPIKE-S09-DESENHO.md` (passos 0 a 10)
- **Código do spike:** `docs/factory/spikes/s09/`
- **Status:** PARCIAL. O deploy de preview **não foi possível** (bloqueio de plataforma, seção 4). Medições de função na nuvem, banco e tempos de cold start ficaram **NAO VERIFICADO**.

## 1. Passo 0 — Pré-checagem

| Item | Resultado |
|---|---|
| Autorização do titular (2026-11-11) | Recebida; usada somente para: 1 projeto Hobby de preview, token da conta pessoal, papel keep-alive (não usado), remoção ao final |
| Conta do token | Plano Hobby; único membro com papel de dono é a própria conta. O CLI só aceita como escopo o time Hobby de dono único (criado diretamente no Hobby). A conta pessoal não é aceita como escopo pelo CLI (registrado para decisão do titular) |
| Projetos remanescentes antes | 0 (conferido por leitura na conta e no escopo do CLI) |
| Vínculo Git | Nenhum. `project inspect` não mostra repositório conectado; `vercel link` foi feito sem integração Git |
| Uso do painel antes | NAO VERIFICADO (não obtido pela CLI nem pelo MCP nesta execução) |

## 2. Passos 1 e 2 — App e variáveis

- App NestJS (adapter Express) com as rotas do desenho. Typecheck (`tsc --noEmit`): exit 0.
- Empacotamento esbuild local: bundle de **2.873.418 bytes** (~2,7 MB) sem o `sharp`; `sharp` com binários nativos (`@img`) soma ~21 MB; 7 dependências de produção diretas.
- Projeto Vercel `fastpro-spike-s09` criado (1 projeto). Variáveis de preview cadastradas por stdin: `APP_ENV`, `LOG_LEVEL`, `JOBS_TICK_SECRET` (sensível). Depois de bloqueio, as três foram **removidas** do projeto.
- `DATABASE_URL_APP_API` **não cadastrada**: o pooler do Supabase não está configurado (README do repositório) e o host da região não foi encontrado nos documentos nem no código. A URL do papel keep-alive aponta para o host direto (somente IPv6), que a função não alcança.
- Região do `vercel.json`: `gru1` (suposição; a região do Supabase do spike é NAO VERIFICADO).

## 3. Medições locais (linha de base, máquina local, Node 22.14, não é a Vercel)

| Medida | Resultado |
|---|---|
| `GET /health` aquecido, 30 amostras (curl) | p50 1,24 ms; p95 5,38 ms; todas HTTP 200 |
| Primeira resposta após subir o servidor | 30 ms (HTTP 200) |
| `bootMs` (criação do app Nest) | 22 ms |
| RSS do processo | 77 a 86 MB durante os testes |
| `POST /internal/jobs/tick` sem segredo | 401 |
| `POST /internal/jobs/tick` com segredo | 200, corpo vazio, `Cache-Control: no-store` |
| Log do servidor com o segredo de teste | 0 ocorrências do valor |
| `POST /v1/webhook-probe` | 200, registra só presença dos cabeçalhos `x-signature` e `x-request-id` |
| `POST /v1/image-probe` (PNG sintético de 1,78 MB, redimensionado) | 200; saída 24.516 bytes; 93 ms; RSS 84 MB; `sharp` carregou |
| `POST /v1/echo` com JSON de 1 MB | 200 |
| `GET /v1/ping-db` sem banco configurado | 503 `db_not_configured` (esperado localmente) |

## 4. O que impediu o deploy de preview (bloqueio de plataforma)

- Tentativa: `vercel deploy --environment preview -y` no projeto novo.
- Resposta da Vercel: primeiro deployment de projeto novo é atribuído à **produção**; a CLI sugeriu `--prod` e pediu decisão do titular. **Não usei `--prod`**, não usei promoção, alias, domínio nem outra via.
- Resultado: **nenhum deployment foi criado**. Conferido por leitura (`vercel ls`): "No deployments found".

## 5. Critérios do desenho (§3) — situação

| Critério | Situação |
|---|---|
| Só preview | Nenhum deployment existe; nenhuma produção; nenhum domínio. Deploy de preview não obtido (ver §4) |
| Função única | NAO VERIFICADO (exige deploy). Pacote local medido (§2) |
| Pooler (0 erro em 50 concorrentes; 0 vazamento em 200) | NAO VERIFICADO (sem host do pooler; nenhuma conexão ao banco foi feita) |
| Teto e memória (300 s; 413 acima de 4,5 MB) | NAO VERIFICADO (exige deploy). RSS local 77 a 86 MB |
| Segredo (zero valor em log; tick 401 sem segredo) | Verificado localmente: tick 401/200 e 0 ocorrências do segredo no log. Varredura de credenciais na pasta do spike: 0 ocorrências do token da Vercel e da URL do keep-alive. Varredura feita com `grep` (gitleaks não instalado) |
| Cota | NAO VERIFICADO (uso do painel não obtido). Nada foi cobrado: não há deployment nem função ativa |

## 6. Itens NAO VERIFICADO (lista completa)

- Cold start e aquecido na Vercel (passo 5): NAO VERIFICADO.
- Função única no painel/MCP (passo 4): NAO VERIFICADO.
- `sleep` de 330 s e 413 de 5 MB na plataforma (passo 7): NAO VERIFICADO.
- Conexão e pooler, `ping-db` e `ping-db-claims` (passo 6): NAO VERIFICADO (sem host do pooler; sem `DATABASE_URL_APP_API`).
- Proteção de deploy e bypass de automação (passo 3.4): NAO VERIFICADO.
- Webhook-probe a partir de fora e estabilidade de URL (passo 8.2): NAO VERIFICADO.
- `sharp` na função Vercel (passo 9): NAO VERIFICADO (carregou só localmente).
- Uso do painel antes e depois (passo 0.4 e passo 10): NAO VERIFICADO.
- Região do Supabase do spike e região `gru1`: NAO VERIFICADO.

## 7. Pendências e ações do titular

1. **Primeiro deployment de preview:** a Vercel só aceita o primeiro deployment de projeto novo em produção. Opções para decisão (não escolhidas por mim): (a) autorizar, por escrito, um único primeiro deployment de produção do app descartável do spike, sem domínio, removido depois. Isso contraria a regra "somente preview" e precisa de decisão explícita do titular; (b) o Architect avaliar outro caminho de teste (outra hospedagem de teste ou outro desenho). Recomendação do DEV: (b).
2. **Host do pooler do Supabase** (região) para o passo 6, pelo painel ou pelo MCP do Supabase (não carregado nesta execução).
3. **Exclusão do projeto `fastpro-spike-s09`:** a CLI exige aprovação humana e não foi aprovada por ela. O projeto continua na conta, sem deployments e sem variáveis. Ação: apagar pelo painel da Vercel ou aprovar a remoção. Não usei a API para contornar esse gate.
4. **Servidor local de teste** (porta 3900) continua rodando, iniciado por mim, para a linha de base. Deve ser encerrado manualmente. Uma tentativa de encerrar por nome de processo foi bloqueada pelo sistema de permissões e não foi repetida. O segredo de teste desse servidor já foi apagado da pasta de rascunho e não existe mais na Vercel.
5. Arquivo `.env.local` e pasta `.vercel/` gerados pelo CLI na pasta do spike foram **removidos** (continham identificadores e um token temporário).

## 8. Resumo em linguagem simples

O teste de hospedagem não foi concluído: a Vercel só aceita o primeiro publicado do projeto como versão de produção, e isso não foi autorizado. Medimos localmente que o app responde em milissegundos e que as regras de segredo funcionam; o que depende da hospedagem real e do banco ainda não foi medido.
