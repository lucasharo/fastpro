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

## Variaveis de ambiente

Copie `.env.example` para `.env.local` (ignorado pelo Git) e preencha localmente. O
`.env.example` contem somente nomes; nunca versione valores.

## Fluxo de branches

Ver `AGENTS.md`: trabalho em `feature/init`, depois `release/*` e `main` somente por Pull Request.
