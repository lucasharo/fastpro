# FastPro

Monorepo **pnpm + Turborepo** (historia H-001). Ainda contem apenas a estrutura e placeholders
compilaveis; nao ha logica de produto. Documentacao em `docs/factory/` e regras de agentes em
`AGENTS.md`.

## Estrutura

- `apps/web`, `apps/admin`, `apps/api`: placeholders (Next.js, Next.js, NestJS em historias futuras).
- `apps/mobile`: vazio (Onda 6).
- `packages/`: `contracts`, `tokens`, `ui`, `domain`, `db`, `access-matrix`, `testkit`, `config`.
- `supabase/`: migracoes, seed e testes de banco (na raiz, conforme plano tecnico §1, ajuste 1).

## Como rodar no Windows (Git Bash ou PowerShell)

Requisito: Node 22.14 (`.nvmrc`). O pnpm vem do Corepack, na versao fixada em `packageManager`
(nada e instalado globalmente). O Turborepo chama o binario `pnpm`, entao ele precisa estar no
PATH. Crie os atalhos do Corepack numa pasta sua e a inclua no PATH da sessao:

```bash
# Git Bash
mkdir -p ~/corepack-bin && corepack enable --install-directory ~/corepack-bin
export PATH="$HOME/corepack-bin:$PATH"
```

```powershell
# PowerShell
New-Item -ItemType Directory -Force $HOME\corepack-bin | Out-Null
corepack enable --install-directory $HOME\corepack-bin
$env:Path = "$HOME\corepack-bin;$env:Path"
```

(Se `corepack enable` sem argumentos funcionar no seu terminal, ele tambem serve.)

Depois:

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm check:deps      # regra de dependencia entre workspaces (placeholder)
pnpm format:check
```

### Verificacoes automaticas (H-004)

```bash
pnpm check:all               # deps, hex, tipografia, .env.example, fronteiras, anexos, logs, segredos
pnpm check:logs              # logs sem PII: so @fastpro/observability, campos da allowlist
pnpm check:secrets:history   # segredos tambem no historico git
pnpm test:scripts            # testes dos proprios scripts de verificacao
pnpm lint:scripts
pnpm audit:deps              # pnpm audit --audit-level=high
```

O CI (`.github/workflows/ci.yml`) roda tudo isso em push para `feature/init` e em PR para
`release/**` e `main`, sem segredos e sem Docker. `ci-db.yml` e `nightly-concurrency.yml` sao
esqueletos desativados.

## Banco de dados: como aplicar e conferir

O banco de desenvolvimento e o projeto Supabase gratuito na nuvem (sem Docker). A conexao fica
em `.env.local` (variavel `DATABASE_URL_MIGRATIONS`, nunca versionada). As mudancas no banco sao
arquivos SQL em `supabase/migrations/`, aplicados em ordem e registrados em `ops.schema_migration`.

```bash
pnpm db:migrate -- --dry-run   # ensaio: roda as pendentes e DESFAZ tudo (nada fica gravado)
pnpm db:migrate                # aplica as pendentes, uma transacao por migracao
pnpm db:status                 # lista aplicadas e pendentes (somente leitura)
pnpm db:test                   # testes de catalogo (extensoes, esquemas, RLS, papeis)
```

Regras: nunca edite uma migracao ja aplicada (o executor acusa); toda tabela nova nos esquemas
`app`, `billing`, `audit`, `ops` e `private` deve habilitar e forcar RLS na mesma migracao (o
`db:test` reprova se faltar). Os testes de banco rodam so localmente por enquanto: o host direto
do Supabase e somente IPv6 e o pooler ainda nao foi configurado, entao o `ci-db.yml` segue
desativado e nenhum segredo vai para o GitHub. Detalhes em `supabase/README.md`.

## Variaveis de ambiente

Copie `.env.example` para `.env.local` (ignorado pelo Git) e preencha localmente. O
`.env.example` contem somente nomes; nunca versione valores.

## Fluxo de branches

Ver `AGENTS.md`: trabalho em `feature/init`, depois `release/*` e `main` somente por Pull Request.
