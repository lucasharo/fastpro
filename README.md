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

## Backup e manutenção

Esta seção cobre o banco de desenvolvimento (projeto gratuito do Supabase). Ele pausa sozinho depois
de uma semana sem uso, por isso precisa de uma consulta de leitura de tempos em tempos, e precisa de
cópias de segurança feitas à mão.

**O que o backup faz:** copia os dados das tabelas do produto, cifra o arquivo com senha (AES256) e
confere a cópia antes de dar como pronta. Só leitura: usa o perfil `app_backup_reader`, que não
escreve nada no banco. A estrutura do banco não entra na cópia: ela está nos arquivos de migração.

**Antes de usar:** o dono do banco precisa definir a senha dos perfis `app_backup_reader` e
`app_keepalive` no painel do Supabase, fora do código. Depois, no seu `.env.local` (nunca no Git),
preencha as variáveis, que estão no `.env.example` só com os nomes:

- `DATABASE_URL_BACKUP_READ` e `DATABASE_URL_KEEPALIVE`: endereços de conexão de cada perfil.
- `BACKUP_EXPECTED_DB_REF`: o identificador do projeto de desenvolvimento. O backup só roda nele.
- `BACKUP_DIR`: pasta das cópias. Tem de ficar **fora** do projeto e de qualquer pasta com Git.
- `KEEPALIVE_LOG`: arquivo do registro do keep-alive, também fora do projeto.
- `BACKUP_PASSPHRASE_FILE` (opcional): arquivo com a senha da cópia, fora do projeto. Se não for
  informado, o sistema pede a senha no terminal, sem mostrar o que você digita.

**Como usar:**

```bash
corepack pnpm db:backup -- export                              # cópia semanal
corepack pnpm db:backup -- export --motivo pre-migracao-destrutiva   # antes de mexer em tabela
corepack pnpm db:backup -- verify <caminho-do-manifesto>       # confere uma cópia já feita
corepack pnpm db:backup -- status                              # mostra a última cópia boa
corepack pnpm db:backup -- status --para-migracao              # diz se pode aplicar a migração
corepack pnpm db:keepalive                                     # rotina que mantém o banco ativo
```

**Regras:**

- Faça uma cópia **pelo menos a cada 7 dias** e **antes de qualquer migração que apague dado**. O
  `status` avisa quando passou desse prazo.
- Se uma cópia falhar, nada é trocado: a cópia boa anterior continua valendo, e a falha fica anotada
  no registro da pasta de cópias.
- O sistema **nunca apaga** cópia. Ele só lista as que passam de quatro semanais; quem apaga é você.
- A senha da cópia não fica guardada em lugar nenhum. Se você perdê-la, a cópia não serve. Guarde-a
  num gerenciador de senhas.
- O keep-alive roda no máximo a cada 5 dias, na mão, até o projeto ter agendamento próprio. Ele
  faz uma leitura só e não cria nada no banco.
