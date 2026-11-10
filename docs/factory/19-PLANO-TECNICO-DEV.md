# FastPro — Plano técnico de desenvolvimento (DEV)

- **Etapa:** planning · **Data:** 2026-11-10 · **Papel:** Developer (`roles/factory-dev.md`), modo planejamento · **Status:** rascunho para validação do Orquestrador (líder)
- **Natureza:** SOMENTE documento. Nenhum código, repositório, branch, conta, projeto, chave, instalação ou chamada externa foi criado/feito. Nenhum teste foi executado. Nada foi feito no GitHub. Os únicos comandos rodados foram consultas de leitura às versões de ferramentas instaladas (§2.4) e à listagem da pasta do produto.
- **Fontes (versões mais recentes):** `08`, `09`, `10-ADRS`, `11-ARQ-RISCOS-E-TESTES`, `14-BACKLOG`, `15-RASTREABILIDADE` (só índice), `17-CHECKLIST-REVISAO`, `18-PLANO-QA`, `11-DECISOES` (decisões 1–40), `12-TODO`, `AGENTS.md` do produto.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` · `[PROPOSTA]` sugestão deste documento (revogável) · `[NÃO VERIFICADO]` fato externo ou de ferramenta sem fonte consultada nesta sessão · `[PENDENTE JURÍDICO]` · `BLQ-EXEC` exige autorização de execução (SD-14/Gate 2) para criar conta, projeto ou chave.
- **IDs:** `H-xxx` (história do backlog `14`), `S-xx` (spike), `I-xx`, `C-/F-/T-/B-/N-/G-/P-/M-/Q-` (testes de `11-ARQ`/`18`). Não são números de Issue.

---

## 0. Resumo executivo

1. **Antes de qualquer código:** o diretório do produto (`D:\projetos\fastpro`) **não é um repositório Git** (sem `.git`), não tem `package.json` e tem só `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` e `docs/`. O primeiro ato do Gate 3 é o bootstrap seguro do repositório (§10.1).
2. **Estrutura:** monorepo pnpm + Turborepo com `apps/{web,admin,api,mobile}`, `packages/{contracts,tokens,ui,domain,db,access-matrix,testkit,config}` e `supabase/` na raiz (migrações, seed, testes pgTAP) (§1).
3. **Primeiras 5 histórias da Onda 0 sugeridas:** **H-001, H-003, H-004, H-007, H-005**, nessa ordem, com os spikes **locais** S-02 (parte local), S-01 (local) e S-05 (local) acompanhando H-003 (§10).
4. **Tudo que dá para provar sem conta** (S-01, S-02 local, S-05, S-06, leitura de S-03/S-04/S-07/S-08/S-11) vem primeiro. Spikes com conta ficam atrás de autorização por spike (BK-6, recomendação b) (§4).
5. **Esforço relativo [PROPOSTA]:** ≈ 436 pontos relativos no backlog, dos quais ≈ 417 sem mobile; **sem prazo prometido** (§8).
6. **Ferramentas desta máquina:** Node v22.14.0, Git 2.55, GitHub CLI 2.97 e Corepack presentes; **pnpm, Docker e Supabase CLI ausentes** (não instalei; instalar é ação do Gate 3, §10.1).

---

## 1. Estrutura proposta do monorepo [PROPOSTA]

Base: `08` §1.4 e ADR-017, com dois ajustes pequenos marcados com (*).

```
fastpro/                          raiz do repositório = D:\projetos\fastpro
├─ AGENTS.md CLAUDE.md GEMINI.md  (já existem; não duplicar política)
├─ README.md  .nvmrc  .gitattributes  .gitignore  .editorconfig
├─ package.json  pnpm-workspace.yaml  pnpm-lock.yaml  turbo.json
├─ .env.example                   (apenas NOMES; §7)       .env.local = ignorado
├─ .github/
│  ├─ workflows/ ci.yml  ci-db.yml  nightly-concurrency.yml
│  ├─ PULL_REQUEST_TEMPLATE.md  ISSUE_TEMPLATE/  dependabot.yml  CODEOWNERS
├─ apps/
│  ├─ web/        Next.js (cliente e profissional)        -> projeto Vercel 1
│  ├─ admin/      Next.js (origem e cookies próprios)     -> projeto Vercel 2
│  ├─ api/        NestJS monólito modular
│  │   ├─ src/main.ts               entrada local (porta de dev)
│  │   ├─ api/index.ts              entrada serverless (handler único)  (*forma final: S-09)
│  │   └─ src/modules/ identity catalog geo requests distribution selection chat media
│  │                   reviews verification billing notifications privacy admin abuse platform
│  │       cada módulo: domain/ application/ infra/ http/ index.ts (única porta pública)
│  └─ mobile/     vazio no MVP (.gitkeep) — Onda 6
├─ packages/
│  ├─ contracts/      esquemas (zod) -> OpenAPI + tipos; envelope de eventos; códigos de erro
│  ├─ tokens/         ÚNICO lugar de cor/tipografia (Roboto 400/500/700); temas claro/escuro
│  ├─ ui/             componentes web compartilhados (só consomem tokens)
│  ├─ domain/         regras PURAS e sem I/O: tempo (7 d, 24 h, 72 h, meses civis America/Sao_Paulo),
│  │                  capacidade 4+4, transições de estado, derivação de acesso comercial.
│  │                  Papel: modelo de referência/oráculo dos testes e dicas de UI. NÃO é segunda
│  │                  fonte de verdade: invariantes e autorização ficam no banco/NestJS (P1–P3).
│  ├─ db/             cliente SQL tipado (Kysely, ADR-017), `withPrincipal(tx)` (set_config local),
│  │                  tipos gerados do esquema, helpers de lock/idempotência
│  ├─ access-matrix/  matriz de acesso legível por máquina -> gera testes de API e pgTAP (08 §4.4)
│  ├─ testkit/        fixtures sintéticas (DS-01..12), relógio controlado, helpers de concorrência
│  └─ config/         tsconfig, eslint, vitest, validação de env (zod) compartilhados
├─ supabase/ (*)      config.toml  migrations/  seed.sql  tests/database/*.sql (pgTAP)
├─ scripts/           check-hex.sh  check-env-example.ts  check-module-boundaries  check-no-attachments
└─ docs/factory/      documentação da fábrica (já existe)
```

(*) **Ajuste 1 — `supabase/` na raiz em vez de `packages/db/` para migrações.** O Supabase CLI espera `supabase/config.toml`, `migrations/`, `seed.sql` e `tests/` nessa pasta `[NÃO VERIFICADO]` (existe a opção `--workdir`). `packages/db` fica com o código TypeScript. Se o Architect preferir manter as migrações em `packages/db`, usar `supabase --workdir packages/db`. Divergência aceitável pelo ADR-017 (a escolha de biblioteca interna pode ser revista pelo DEV); registrar no PR de H-001.
(*) **Ajuste 2 — `packages/domain` e `packages/config`** são adições à lista de `08` §1.4 (pedido de planejamento: pacote de domínio). Sem alterar a stack.

### 1.1 Regras de dependência (impostas no CI, H-001)
- `apps/*` -> `packages/*`; `packages/*` nunca importam de `apps/*`; `packages/domain` não importa nada de I/O; `packages/ui` -> `packages/tokens`.
- Em `apps/api`, módulo A só importa o `index.ts` de módulo B; `billing` nunca importa `requests`/`distribution`/`selection`/`chat` (08 §2). Ferramenta gratuita de verificação de fronteiras (ex.: eslint-plugin-boundaries ou dependency-cruiser) `[NÃO VERIFICADO: escolher no PR de H-001]`.
- `service_role` só em um módulo isolado de Storage/Auth admin dentro de `media`/`identity`; qualquer outro uso reprova o CI (T-13).
- Zero hex/`rgb()`/cor literal fora de `packages/tokens` (17 §7.1); só Roboto 400/500/700 (17 §7.2).

### 1.2 Turborepo (`turbo.json`) [PROPOSTA]
Tarefas: `lint`, `typecheck`, `test` (unitário), `test:db` (pgTAP; exige banco local), `test:contract`, `build`. Cache local e remoto desligado até haver decisão (remoto do Vercel pode ter custo/termos `[NÃO VERIFICADO]`); cache do CI pelo cache de dependências do pnpm + `.turbo`.

### 1.3 Escolhas de biblioteca (a fixar por versão exata no PR de H-001) [PROPOSTA]
Nenhuma versão foi verificada nesta sessão. Fixar **no lockfile** a versão estável vigente no dia do bootstrap e registrar no PR.
| Uso | Escolha sugerida | Observação |
|---|---|---|
| Runtime | Node LTS (atual na máquina: v22.14.0) | `.nvmrc` e `engines`; checar suporte do Next.js/Nest/Vercel `[NÃO VERIFICADO]` |
| Gerenciador | pnpm via Corepack | `corepack enable` + `packageManager` no `package.json` |
| Web/Admin | Next.js (App Router), React | Hobby/Pro da Vercel `[NÃO VERIFICADO]` |
| API | NestJS (Express adapter) | S-09 confirma o formato serverless |
| SQL | Kysely + driver `pg` | `FOR UPDATE`, PostGIS, funções (ADR-017) |
| Validação/contratos | zod + gerador de OpenAPI | `packages/contracts` |
| Testes | Vitest, fast-check, Playwright + axe, pgTAP, k6 (local), gitleaks, OSV-Scanner/`pnpm audit` | 18 §9; licenças `[NÃO VERIFICADO]` |
| Contrato de API | Schemathesis (OSS) | **exige Python no ambiente de teste**; avaliar o custo antes (alternativa: testes de contrato em Vitest a partir do OpenAPI) |
| Imagem | `sharp` (libvips) no servidor; redução no navegador por canvas | HEIC: ver S-06 (pode exigir decodificador em WASM) |
| E-mail | `EmailProviderPort` + adapters Mailpit (SMTP) e Resend (HTTP) | I-27 |
| Fuso/datas | `Temporal`/biblioteca de datas somente em `packages/domain`; banco usa `now()` | relógio do banco é a verdade (08 §7.1) |

---

## 2. Ambientes locais

### 2.1 Mapa (alinhado a `18` §3.1)
| Ambiente | Conteúdo | Conta/chave necessária | Estado |
|---|---|---|---|
| **A1 Dev local** | Supabase CLI + Docker (Postgres, Auth, Storage, Realtime locais), Mailpit, apps locais, simuladores | **Nenhuma** | Montável após instalar Docker e Supabase CLI |
| **A2 CI** | Mesmos componentes em containers, sem segredos reais | Repositório no GitHub (Actions) | Depende de H-004 e do Gate 2 |
| **A3 Preview Vercel (Hobby)** | Web e API em função única | Conta Vercel (BLQ-EXEC) | Só smoke; sem e-mail real; sem cobrança |
| **A4 Supabase Free remoto** | Projeto de spikes/homologação | Conta Supabase (BLQ-EXEC) | Máximo 2 projetos ativos: **1 para spikes/staging**, 1 reservado para produção |
| **A5 Sandbox Mercado Pago** | Checkout de teste | Conta MP + app + usuários de teste (BLQ-EXEC) | Permitido pela decisão 37 (dados sintéticos) |
| **A6 Mapbox real** | 1 chamada manual `permanent=true` | Conta + cartão + limite de gasto (BLQ-EXEC, decisão 36) | Nunca em CI |
| **A7 Resend real** | Nenhum teste | Domínio verificado (inexistente) | Fora até TL-1 |

### 2.2 Supabase local
- `supabase init` cria `supabase/config.toml`; `supabase start` sobe os containers; `supabase status` mostra URLs e **chaves locais de demonstração** (colocar só em `.env.local`).
- Ativar no `config.toml`: pooler em modo transação (porta padrão do pooler local `[NÃO VERIFICADO]`), extensões necessárias (`postgis`, `pg_trgm`, `unaccent`, `pgtap`, `pg_cron`, `pg_net` conforme S-02), e SMTP de Auth apontando ao Mailpit local.
- Banco local é descartável: `supabase db reset` reaplica migrações + `seed.sql` (sintético). Testes de banco rodam em banco efêmero (nunca mock, `11` §7).
- **Papéis de banco** `app_api` (sem BYPASSRLS) e `app_system` são criados em migração **sem senha**; a senha é definida fora da migração por script que lê variável de ambiente (nomes em §7), para não versionar segredo.
- **Relógio controlado** (N14 de `18`): mecanismo ainda indefinido; proposta: função `private.test_now()` só em schema de teste, usada por `commercial_access`/prazos via `app.clock()` que lê `app_config` apenas quando `CLOCK_OVERRIDE_ENABLED=true` e o schema de teste existe; proibido em produção por teste de catálogo. Decidir no PR de H-003/H-045.

### 2.3 Mailpit, Mercado Pago, Mapbox, Resend em desenvolvimento
- **Mailpit:** único destino de e-mail em dev/CI (I-27). Receptor SMTP local e interface web `[portas a confirmar na instalação]`. O Supabase local também captura e-mail de Auth num servidor equivalente `[NÃO VERIFICADO: nome e porta na versão do CLI]`; para unificar, apontar o SMTP de Auth ao Mailpit. Teste de CI procura a mensagem via API HTTP do Mailpit.
- **Mercado Pago:** adapter `PaymentGatewayPort` com **simulador local** (fixtures versionadas DS-12, assinatura HMAC de teste) para CI; sandbox real só em A5 com credenciais de teste. Boleto nunca existe (422 `method_not_supported`).
- **Mapbox:** `GeocoderPort` com adapter fake (determinístico) em dev/CI e adapter real; o autocomplete do navegador usa token público restrito por origem **apenas para sugestões**; nada do temporário é gravado (I-28). Em CI toda chamada a host externo falha o teste (B-49..B-51).
- **Resend:** nunca chamado em dev/CI. `EMAIL_PROVIDER=mailpit` por padrão; o adapter `resend` recusa enviar sem domínio verificado ou sem segredo (N-10).
- **Egress bloqueado na suíte:** helper no `testkit` que falha qualquer `fetch`/socket para host fora de `localhost`/Docker.

### 2.4 Ferramentas verificadas nesta máquina (somente leitura, 2026-11-10)
| Ferramenta | Resultado |
|---|---|
| Node | v22.14.0 presente |
| Git | 2.55.0.windows.3 presente |
| GitHub CLI | 2.97.0 presente (não usado) |
| Corepack | 0.31.0 presente |
| pnpm | **ausente** (ativar via Corepack no Gate 3) |
| Docker | **ausente** (Windows 11 Home: provável uso de Docker Desktop com WSL2 `[NÃO VERIFICADO]`; instalação requer privilégio e é ação do Gate 3; licença `[NÃO VERIFICADO]`, RT-13 de `18`) |
| Supabase CLI | **ausente** |
| Repositório Git do produto | **ausente** (`D:\projetos\fastpro` sem `.git`) |

### 2.5 Particularidades do Windows [PROPOSTA]
`.gitattributes` com `* text=auto eol=lf` (evita CRLF quebrando scripts SQL/shell no container); scripts de repositório em Node/TypeScript ou POSIX sh e executados via Git Bash; caminhos curtos (evitar estouro de 260 caracteres em `node_modules`); pnpm usa links físicos (manter repositório e cache no mesmo disco `D:`).

---

## 3. Ordem técnica de implementação por onda e história

Princípios: um especialista ativo por vez; **uma história = uma Issue = um PR**; invariantes de banco e testes de concorrência entram **junto com a funcionalidade**, não depois. Esforço entre colchetes: P/M/G do backlog. "->" significa "depende de". Dependências conforme `14`; ajustes de ordem na §3.7.

### 3.1 Onda 0 — Spikes e fundação (M0)
Sequência sugerida (o DEV executa nesta ordem; spikes com conta só após autorização):
| # | Item | Dep. | Observação técnica |
|---|---|---|---|
| 0.1 | Bootstrap do repositório (pré-história, §10.1) | Gate 2 | Sem Issue própria: parte de H-001 |
| 0.2 | **H-001** [P] monorepo | 0.1 | Também cria `.gitignore` (inclui `.env.local`), `.env.example`, scripts de verificação vazios |
| 0.3 | **H-003** [M] ambiente local + migrações + catálogo pgTAP | H-001 | Junto: **S-02 (local), S-01 (local), S-05 (local)** |
| 0.4 | **H-004** [M] CI gratuito | H-001, H-003; repositório remoto | gitleaks, `.gitignore`, varredura de hex, fronteiras de módulo, `.env.example` |
| 0.5 | **H-007** [M] logs por allowlist + varredura de PII | H-001 | Antes de qualquer código de servidor real |
| 0.6 | **H-005** [M] outbox, job com lease, idempotência, `app_config`, `rate_counter` | H-003 | Base de tudo; testes C-14, F-03, I-21 |
| 0.7 | **H-002** [M] tokens EDS | H-001 | **EDS mestre não recebido**: usa a síntese do `04`; revisor valida |
| 0.8 | **H-006** [M] auditoria append-only com hash | H-003 | I-15 |
| 0.9 | **S-06 (local)**, leituras S-03/S-04/S-11/S-08 | — | Sem conta |
| 0.10 | **H-008** [M] tick de jobs | H-005; S-02, S-10 | Implementa A, B ou C conforme S-10; **C (oportunista) sempre presente** |
| 0.11 | **H-009** [M] hospedagem (web, API função única, admin) | H-001; S-09; BLQ-EXEC | Hobby só em dev |
| 0.12 | **H-010** [P] keep-alive + backup manual | H-003 | Periodicidade pendente (BK-7; recomendação b) |
Saída M0: S-01..S-04, S-09..S-11 com resultado registrado; S-02 e S-10 decididos; H-001..H-010 concluídos.

### 3.2 Onda 1 — Identidade e base
Ordem [PROPOSTA]:
1. **H-092** [G] pipeline de notificação **mínimo** (evento -> `notification_item` -> `email_outbox`), sem cooldown/digest ainda (a parte de digest completa vem na Onda 3/4; ver §3.7).
2. **H-093** [M] `EmailProviderPort` + adapter Mailpit (e adapter Resend inerte).
3. **H-016** [M] cadastro/login do profissional (Supabase Auth, e-mail/senha) -> S-11 (SMTP local).
4. **H-011** [G] desafio do cliente -> H-005, S-01, H-093.
5. **H-012** [M] consumo por POST (GET sem efeito colateral; token no fragmento).
6. **H-015** [P] limites/anti-enumeração.
7. **H-014** [M] sessão de 7 dias, revogável, step-up.
8. **H-017** [P] exclusividade de papéis.
9. **H-013** [M] código de 6 dígitos + nonce de navegador (precisa de rascunho: finalizar após H-025 na Onda 2; implementar a parte do código agora).
10. **H-102** [G] RBAC + MFA do admin (esqueleto) — console de telas só na Onda 5.
11. **H-018** [M] catálogo (seed de 25 grupos/≈550 serviços só em dev; BK-9 recomendação a), **H-019** [M] autocomplete de serviço.
Saída: login do cliente e do profissional em dev (Mailpit); T-01, T-12, N-05, N-09, N-10 verdes.

### 3.3 Onda 2 — Geo, pedido e verificação
Ordem [PROPOSTA]:
1. **H-020** [M] autocomplete Mapbox temporário (adapter fake em CI).
2. **H-021** [M] coordenada permanente (decisões 29/36: já aprovada; **BLQ-EXEC** só para o smoke real A6).
3. **H-022** [M] célula generalizada e `match_point` (PostGIS ou fallback por S-02).
4. **H-035** [M], **H-036** [M] cadastro/perfil/base+raio do profissional.
5. **H-023** [M] descoberta por raio, **H-024** [P] cobertura booleana.
6. **H-025** [M] rascunho -> **H-026** [M] upload em quarentena -> **H-027** [G] redução/reencode (S-06) -> **H-028** [M] EXIF/tipo por conteúdo -> **H-029** [P].
7. **H-030** [M] revisão/duplicidade -> **H-031** [M] publicação idempotente -> **H-032** [M] visibilidade/views sem PII -> **H-033** [M] opt-in de telefone -> **H-034** [M] painel do cliente.
8. **H-037** [M] documentos de identidade (decisão 35: imagem reduzida no envio e PDF ≤ 2 MB) -> **H-038** [M] (BLQ-JUR L4 só no conteúdo) -> **H-039** [G] fila de verificação (precisa H-102 e H-006) -> **H-040** [M] -> **H-041** [P] -> **H-043** [P] (BLQ-JUR L7 no texto do selo).
9. **H-042** [M] guarda do profissional não aprovado: **antecipar H-045** (ver §3.7).
Saída: pedido publicável com fotos; profissional verificável; G-01..G-07, P-01..P-06, T-03, T-07 verdes.

### 3.4 Onda 3 — Aceite e chat (M1: núcleo web)
Ordem [PROPOSTA]:
1. **H-045** [G] acesso comercial derivado (`commercial_access`) e **H-044** [M] trial (FA-005).
2. **H-055** [M] descoberta de elegíveis -> **H-056** [G] fotos com marca d'água (S-06) -> **H-057** [M] limites/raspagem.
3. **H-065** [M] (somente esquema `conversation` + `recompute_conversations`, ver §3.7) e **H-064** [P] corpo vazio do aceite.
4. **H-058** [G] aceitar trabalho (lock do pedido, conversa e mensagem de sistema no mesmo COMMIT) -> **H-059** [M] vagas 4+4 -> **H-060** [M] "Chamar mais profissionais" -> **H-061** [M] retirada -> **H-062** [M] encerramento -> **H-063** [P].
5. **H-066** [M] mensagens de texto -> **H-067** [P] bloqueio total de anexos -> **H-068** [M] mensagem automática "Estou disponível para trabalhar" -> **H-069** [P] -> **H-072** [P] -> **H-070** [M] Realtime como sinal (S-05) -> **H-071** [M] denúncia/bloqueio -> **H-073** [M] acesso excepcional.
6. **H-095** [M] e-mail de aceite, **H-100** [P] teste de catálogo "sem interruptor", **H-101** [P] canal no site.
Saída M1: C-01..C-04b, C-16, M-01, M-02, T-16, T-17, EE-01..EE-03 verdes; N≥100 nas corridas.
**Esta é a primeira entrega web** (decisão 40): pedido -> aceite -> chat de texto; cobrança real só no M4.

### 3.5 Onda 4 — Ciclo de vida e assinatura (M2)
Duas trilhas, em sequência (um especialista por vez):
- **Ciclo:** H-074 -> H-075 -> H-076 -> H-077 -> H-078 -> H-079 -> H-080 -> **H-081** (versão otimista/lock_timeout) -> H-082 (republicar só pedido **expirado ou cancelado**, decisão 38) -> H-083 -> **H-084** [G] (selecionar no original, tudo ou nada) -> H-085.
- **Assinatura (S-03 antes):** H-046 -> H-047 [G] -> H-048 [G] -> H-049 -> H-050 -> H-051 -> H-052 -> H-053.
- **E-mails/cota:** H-094 [G] (cota Resend), H-096, H-097, H-098, H-099 (BLQ-JUR L2/L3 só no texto de lembrete de cobrança).
Saída M2: C-05..C-11, C-13, C-15, F-02..F-08, F-12, B-01..B-10 (relógio controlado), N-02/N-04/N-08, Q-01/Q-10/Q-11 verdes.

### 3.6 Onda 5 e portões posteriores
- **Onda 5 (M3, ensaio fechado, sem cobrança real e sem e-mail real):** avaliações (H-086..H-091), admin (H-103..H-105, H-107, H-108; H-106 é do Gate M4 apesar de `14` §2 listá-la na Onda 5), retenção/LGPD (H-109, H-110, H-112, H-114), hardening (H-115..H-121).
- **Gate M4 (bloqueado):** H-054, H-106, H-111, H-113 + domínio verificado no Resend, Vercel Pro, backup, tarifas MP, L1–L4 e L7; decisão humana CONCLUIR/BLOQUEAR.
- **Onda 6 (mobile):** H-122..H-124; não planejada para execução (SD-13, S-07).

### 3.7 Ajustes de ordem encontrados no backlog (recomendações ao Orquestrador)
Não alteram `14`; evitam travar a execução.
| # | Achado | Recomendação |
|---|---|---|
| O-1 | H-011 -> H-093 -> H-092 -> H-008 e H-092 é [G] com digest completo | Fatiar H-092: "mínimo" (Onda 1) e "cooldown/digest" (Onda 3). Manter o mesmo ID, dois PRs |
| O-2 | H-042 (Onda 2) depende de H-045 (Onda 3) | Mover H-045 para o fim da Onda 2 (ou estubar `commercial_access` em H-042) |
| O-3 | H-058 depende de H-065, mas H-065 depende de H-058 (a conversa nasce no aceite) | Implementar o **esquema** de `conversation`/`message` de sistema e `recompute_conversations` antes de H-058; o restante de H-065 (membros, restrições) fecha depois |
| O-4 | H-064 (422 em campos extras) é parte do contrato de H-058 | Mesmo PR de H-058 ou imediatamente antes |
| O-5 | H-013 (nonce que anexa rascunho) depende de H-025 (Onda 2) | Partir H-013 em código (Onda 1) e anexação de rascunho (Onda 2) |
| O-6 | H-030 depende de H-024 -> H-023 -> H-036 -> H-035 -> H-016 (cobertura precisa de profissional) | Em dev, usar `seed.sql` com profissionais sintéticos para destravar a revisão do pedido |
| O-7 | H-102 (Onda 1) depende de H-009 (projeto Vercel, BLQ-EXEC) | RBAC/MFA se desenvolvem localmente; H-009 só é necessária para o deploy |
| O-8 | Decisões 35–40 já resolvem BK-1, BK-2, BK-3, BK-4, BK-5, BK-8 | Atualizar `14` (H-037, H-021, H-047, H-082, H-059, H-024, §8) para remover BLQ-DEC e a menção "5 MB x 5" da decisão 34 |
| O-9 | Decisão 38 (republicar só expirado ou cancelado) retira a opção "selecionado que desistiu" (`10-ADRS` SD-09 propunha a+c) | H-080/H-082/H-085: desistência sem substituto exige **cancelar e depois republicar** (já descrito em H-080) |
| O-10 | `14` §2 lista H-106 na Onda 5 e também no Gate M4 | Tratar como Gate M4 (BLQ-JUR L3) |

### 3.8 Definição de pronto por história (resumo; detalhe em `17` §5)
Critérios de aceite do `14` atendidos; testes novos referenciam IDs existentes (`11-ARQ`); lint, tipos, unitários e, se tocar banco, pgTAP verdes; **comandos e saídas registrados no PR** (ou `NAO_EXECUTADO` com motivo); varredura de segredo e de hex limpa; sem PII em log; diff revisado; nenhum acesso externo em teste; PR não faz merge nem deploy.

---

## 4. Spikes S-01 a S-11: passos exatos e o que cada um exige

Regras para todos: resultado vai em `docs/factory/spikes/S-xx-RESULTADO.md` do repositório do produto (data, versões, comandos, saída relevante, decisão); código de spike em `spike/S-xx-<slug>` (branch descartável, **não** vira produto sem história); **nenhuma conta, projeto ou chave é criado sem autorização por spike (BK-6, recomendação b)**; nenhum valor de segredo em documento, log ou prompt (só nomes, §7); dados sintéticos apenas (DS-01..12). Ordem recomendada de execução: **S-02L, S-01L, S-05L, S-06L, leituras (S-03, S-04, S-11, S-08), depois os que exigem conta: S-02R, S-09, S-10, S-03R, S-04R, S-11R**; S-07 só na Onda 6.

### S-02 — PostGIS, pg_cron, pg_net e pooler em transação (Onda 0)
**Exige:** parte **L** (local): nada, só Docker + Supabase CLI. Parte **R** (remoto): conta Supabase + 1 projeto Free de spikes (BLQ-EXEC); variáveis `DATABASE_URL_APP_API` (pooler) e `DATABASE_URL_MIGRATIONS` (direta) de spike.
**Passos L:**
1. `supabase init` e `supabase start`; registrar versões das imagens.
2. No `psql` do banco local: `select name, default_version, installed_version from pg_available_extensions where name in ('postgis','pg_cron','pg_net','pg_trgm','unaccent','earthdistance','cube','pgtap','pgcrypto') order by 1;`
3. Migração de teste com `create extension` de cada uma; `select postgis_full_version();`.
4. Benchmark geo: 50.000 pedidos sintéticos (`geography(Point,4326)` + GiST) e 500 profissionais com raios de 5, 50 e 100 km; `explain (analyze, buffers)` da consulta de descoberta (08 §9.3); 100 repetições, anotar p50/p95. Repetir com o **fallback** (coluna de célula de ≈ 500 m + caixa delimitadora + distância por fórmula/`earthdistance`) sobre os mesmos dados e comparar o conjunto de resultados.
5. Pooler em modo transação (habilitar no `config.toml`): script que faz `begin; select set_config('app.principal_id','A',true); select current_setting('app.principal_id'); commit;` e, em transação seguinte na mesma conexão, `select current_setting('app.principal_id', true)` deve voltar vazio; rodar 20 clientes concorrentes × 200 iterações e provar **ausência de vazamento** de principal; testar `select ... for update`, `set local lock_timeout = '3s'` e o comportamento de *prepared statements* no driver.
6. `pg_cron` + `pg_net` local: agendar a cada minuto um `net.http_post` ao `POST /internal/jobs/tick` de um servidor local mínimo (do contêiner, o host é alcançado por `host.docker.internal` `[NÃO VERIFICADO]`); confirmar chegada com o segredo no cabeçalho.
**Passos R (após autorização):** criar projeto Free; no painel, verificar *Database > Extensions*; repetir os passos 2–3 e 5 no SQL Editor e pela string do pooler; tentar o passo 6 apontando a uma URL pública de teste (preview do S-09).
**Critério de decisão:** (a) geo: PostGIS disponível no Free e p95 ≤ meta `[PROPOSTA: 200 ms]` -> PostGIS; senão fallback por célula; (b) tick: `pg_cron`+`pg_net` disponíveis -> A; senão B/C (S-10). **Bloqueia:** H-022, H-008, H-003 (versão final do esquema). **Evidência:** saídas dos passos 2, 4, 5.

### S-01 — Sessão Supabase para usuário verificado pelo nosso desafio (Onda 0)
**Exige:** local: nada. Variáveis locais `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (chaves de demonstração do `supabase status`). Remoto opcional (mesmo projeto do S-02R) só para confirmar limites do Free.
**Passos:**
1. `supabase start`; script de spike em Node (fora do produto) com cliente de admin.
2. **Caminho 1 (preferido):** `auth.admin.createUser({ email:'cliente.a@sintetico.test', email_confirm:true })`; `auth.admin.generateLink({ type:'magiclink', email })` (não envia e-mail; devolve o `hashed_token`); na API do servidor, `auth.verifyOtp({ token_hash, type:'email' })` para obter `access_token` e `refresh_token`. Registrar claims, `exp` e se o `hashed_token` jamais precisa ir ao navegador.
3. Verificar: refresh funciona; `auth.admin.signOut(jwt, 'global')` revoga; reutilização do mesmo `token_hash` falha.
4. Carregar o `sid` de `app_session` no JWT (Auth Hook de *custom access token* local ou `app_metadata` via `updateUserById`); confirmar se o hook existe no plano Free `[NÃO VERIFICADO]`.
5. **Caminho 3 (fallback B):** JWT assinado pela API com o segredo/chave do projeto (`sub`, `role='authenticated'`, `sid`); confirmar que Storage local e Realtime local aceitam; medir o que se perde.
6. Expiração: configurar `jwt_expiry` curto `[PROPOSTA: 900 s]`; garantir os **7 dias absolutos** apenas por `app_session.expires_at` checado em cada requisição (não depender de recurso do plano `[NÃO VERIFICADO]`).
7. Confirmar custo de e-mail zero no passo 2 e que o desafio próprio (256 bits, 15 min, 5 tentativas) é validado **antes** de `generateLink`.
**Decisão:** Caminho 1 se a sessão for válida, revogável e carregar `sid`; senão Caminho 3 com Realtime por polling (ADR-005/010). **Bloqueia:** H-011..H-014, H-016. **Evidência:** claims decodificadas, tempos, resultado de revogação.

### S-05 — Realtime: canal privado com autorização (Onda 1; iniciar junto de S-01)
**Exige:** local: nada. Remoto: nada além do projeto do S-02R (para conferir limites).
**Passos:** (1) com dois usuários sintéticos do S-01, criar `conversation`/membros mínimos e política em `realtime.messages` por participação; (2) abrir canal `conv:{id}` com `private: true` em dois clientes; (3) publicar do servidor um *broadcast* `{conversation_id, message_id, type}`; (4) provar que o não membro **não recebe** nem consegue entrar; (5) derrubar o Realtime e provar o *polling* com `since_id`/ETag; (6) ler no site oficial os limites de conexões (200) e mensagens (2 mi/mês) já verificados e anotar a data. **Decisão:** canal privado viável ou polling como padrão (TL-8). **Bloqueia:** H-070.

### S-06 — Reencode e marca d'água (Onda 0; local)
**Exige:** nada externo (Docker para limitar memória).
**Passos:** (1) gerar com script imagens sintéticas de 10 MB (JPEG, PNG, WebP) e HEIC (DS-08), 4000×3000, com EXIF/GPS fictício injetado, um arquivo falso por extensão e uma imagem-bomba; (2) rotina de reencode com `sharp`: aplicar rotação do EXIF, remover metadados, redimensionar para ≤ 1.280 px e reduzir em passos até ≈ 0,5 MB (teto técnico 0,75 MB; se não couber, recusar); (3) confirmar com ExifTool que não resta GPS/metadado no objeto final; (4) medir pico de memória residente e tempo em contêiner com `--memory=1g` e `--memory=2g`, com concorrência 1, 2 e 4; (5) marca d'água em mosaico com identificador opaco sobre a versão reduzida: tempo por visualização; (6) **HEIC:** verificar se a build do `sharp` decodifica HEIC; se não, testar decodificador em WASM `[NÃO VERIFICADO]` e medir; testar também a redução **no navegador** (canvas/`createImageBitmap`) para JPEG/PNG/WebP e o comportamento de HEIC em Safari/Chrome `[NÃO VERIFICADO]`. **Decisão:** limite de concorrência e de tamanho de entrada; política para HEIC (suportar ou recusar com mensagem). **Bloqueia:** H-027, H-037, H-056. **Evidência:** tabela memória/tempo; bytes e dimensões finais; ExifTool sem GPS.

### S-03 — Mercado Pago: tarifas, recorrência, Pix, webhook, sandbox (Onda 0; Onda 4 antes de H-047)
**Exige:** parte **leitura**: nada. Parte **sandbox**: conta Mercado Pago do usuário, aplicação no painel de desenvolvedores e dois usuários de teste (vendedor e comprador) (BLQ-EXEC; decisão 37 autoriza o modo teste sem nova confirmação). Variáveis (só nomes): `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `MP_ENV=sandbox`. Para receber webhook real é preciso uma URL pública (preview do S-09 ou túnel temporário `[NÃO VERIFICADO]`).
**Passos:**
1. **Leitura (sem conta):** ler na documentação oficial: assinaturas (planos e assinaturas), pagamento com Pix, webhooks (tópicos e assinatura), usuários e cartões de teste; registrar URL e data. **Tarifas:** obter por outro caminho que o 403 (página no navegador do usuário, simulador no painel, atendimento) e registrar sem dados pessoais (12-TODO #12).
2. **Sandbox:** criar a aplicação de teste e os usuários de teste.
3. Criar planos com 1, 3, 6 e 12 meses e responder, para cada um, se a recorrência por ciclo é aceita; se não, registrar o fallback "pagamento avulso por ciclo" (ADR-007).
4. Assinatura de teste com cartão de teste: aprovada, recusada, pendente; registrar os eventos e o campo de data de aprovação usado em `period_start` (08 §8.4).
5. Pix: criar pagamento avulso, registrar QR, vencimento e se o sandbox simula a aprovação `[NÃO VERIFICADO]`.
6. Webhook: validar `x-signature`/`x-request-id` com o segredo de teste (formato do manifesto a confirmar `[NÃO VERIFICADO]`); provocar reenvio (≈ 15 min) , duplicado e fora de ordem; confirmar que a consulta ao recurso (e não o corpo) dá o estado.
7. Gerar fixtures versionadas (DS-12) **sem segredos**, para o simulador de CI.
**Decisão:** matriz de capacidades (recorrência por ciclo, Pix manual, carência) e tarifas efetivas. **Bloqueia:** H-047..H-053. **Evidência:** matriz, fixtures, capturas sem dados pessoais.

### S-04 — Mapbox: termos e significado de "armazenar" (Onda 0)
**Exige:** parte leitura: nada. Parte smoke: conta Mapbox, **cartão cadastrado e limite de gasto definido pelo usuário** (decisões 29/36; BLQ-EXEC). Variáveis (só nomes): `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN` (restrito por URL), `MAPBOX_ACCESS_TOKEN_SERVER`.
**Passos:** (1) ler os Termos de Produto (PDF) e os termos de geocodificação: o que é "temporário" vs "permanente", o que se pode guardar/cachear, uso comercial; escrever parecer de 1 página com cláusula, data e versão do PDF; (2) com conta: criar os dois tokens (público restrito por origem e sem escopos de escrita; servidor sem ir ao navegador); (3) **uma** chamada manual de geocodificação `permanent=true` com um endereço público conhecido (nunca dados de cliente), registrar campos retornados e conferir no painel que contou 1 requisição permanente (A6); (4) uma chamada temporária de sugestão e confirmar que não é gravável; (5) escrever o contrato de `GeocoderPort` e o adapter fake. **Decisão:** manter ADR-008 ou ajustar (alternativa "permanente na publicação"). **Bloqueia:** H-020, H-021. **Nunca em CI.**

### S-09 — NestJS como função única na Vercel (Onda 0)
**Exige:** parte local: nada. Parte remota: conta Vercel Hobby e um projeto de spike (BLQ-EXEC); `DATABASE_URL_APP_API` (pooler, projeto de spikes do S-02R). Só dados sintéticos (Hobby é não comercial).
**Passos:**
1. App Nest mínimo com `/health`, `/v1/ping-db` (consulta ao banco) e `POST /v1/echo`; entrada serverless (`api/index.ts`) exportando o handler do Express; empacotamento com bundler; registrar tamanho do pacote e número de dependências.
2. Local (proxy): tempo de inicialização até a primeira resposta e memória.
3. Deploy de *preview*: 10 amostras de **cold start** (primeira requisição após ≥ 20 min ocioso) e 30 aquecidas com `curl -w '%{time_total}'`; registrar p50/p95 e o cabeçalho de região/ID.
4. Conexão: cliente `pg` com `max: 1` no pooler em transação; 50 invocações concorrentes (k6/autocannon) e observar `pg_stat_activity` e erros de limite; mini-corrida de 50 `update ... for update` na mesma linha para validar o caminho do C-01.
5. **Topologia:** comparar (i) projeto Vercel separado para a API, com *rewrite* `/api/*` a partir do web; (ii) handler do Nest dentro do projeto web como rota catch-all. Medir cold start, saltos extras, cookies `SameSite=Lax` na mesma origem e tamanho.
6. Rota de teste com `sharp` redimensionando uma imagem sintética (liga a S-06): binário nativo roda no ambiente? tamanho do pacote? limite de corpo de requisição/resposta da função `[NÃO VERIFICADO]` (confirma upload direto ao Storage).
7. Healthcheck e endpoint de tick protegido por `JOBS_TICK_SECRET`.
**Decisão:** confirmar a função única (ADR-018 A) ou acionar contingência B/C/D (SD). **Bloqueia:** H-009, H-027, H-056.

### S-10 — Tick de jobs (Onda 0, depende do S-02R)
**Exige:** projeto Supabase de spikes (S-02R) e URL pública da API de spike (S-09); `JOBS_TICK_SECRET`. Para o plano B, um agendador externo gratuito (conta própria dele, BLQ-EXEC).
**Passos:** (1) **A:** `cron.schedule` + `net.http_post` apontando ao endpoint de spike com o segredo; medir por 48 h o intervalo real entre execuções e falhas; (2) **B:** escolher um agendador externo gratuito `[NÃO VERIFICADO: frequência mínima e termos]`; **atenção:** agendar a cada 5 min por GitHub Actions em repositório privado gasta ≈ 288 execuções/dia e pode estourar a cota gratuita de minutos `[NÃO VERIFICADO]`; medir atraso; (3) **C:** implementar o *tick oportunista* (no máximo 1×/min por instância, com *lease* `FOR UPDATE SKIP LOCKED`) e medir o atraso de lembretes sob tráfego baixo (simulado); (4) cron diário da Vercel (Hobby) só como *keep-alive*. **Decisão:** A, B ou C (com C sempre presente). **Evidência:** distribuição de atrasos. **Bloqueia:** H-008, H-099.

### S-11 — Resend: domínio, bounce, cota, SMTP do Supabase Auth (Onda 0)
**Exige:** leitura e parte **local**: nada. Parte real: conta Resend, domínio **inexistente hoje** (H2) -> **adiada até existir domínio verificado** (TL-1/BK-10). Variáveis (só nomes): `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`.
**Passos locais:** (1) apontar o SMTP de Auth do Supabase local ao Mailpit e provar o fluxo de verificação de e-mail do profissional (H-016); (2) contrato de `EmailProviderPort` com adapter Mailpit (SMTP) e um **dublê HTTP do Resend** que devolve a resposta de cota excedida e 429 (formato a confirmar na documentação `[NÃO VERIFICADO]`); (3) testes N-08/N-09/N-10 sobre o contador `external_quota(email)`.
**Passos reais (após domínio):** criar conta e chave restrita a envio; adicionar o domínio e os registros DNS (SPF, DKIM, DMARC) e verificar; enviar 1 e-mail ao endereço do usuário; conferir o contador da cota; cadastrar webhook de bounce/complaint e simular com os endereços de teste do provedor `[NÃO VERIFICADO]`; **não** exceder a cota de propósito (consome o limite real); medir o que a documentação diz da resposta ao exceder. **Decisão:** parecer de execução. **Bloqueia:** H-016, H-093, H-094.

### S-08 — Verificação oficial dos limites (contínuo)
**Exige:** nada (leitura). **Passos:** reabrir as páginas oficiais de Vercel, Supabase, Resend, Mapbox e Mercado Pago; atualizar a tabela de `10-ADRS` ADR-020 com data e fonte; destacar o que mudou desde `13-VERIFICACAO-SERVICOS.md`; registrar o que seguir 403/indisponível. Repetir **antes do Gate M4**.

### S-07 — Regras das lojas (Onda 6; adiado)
**Exige:** nada (leitura). **Passos:** ler as diretrizes oficiais de login social, compra dentro do app (IAP) para assinatura e exclusão de conta (Apple e Google); parecer para ADR-006/019 e SD-13. Sem decisão antes do web estável.

### 4.1 Resumo do que cada spike exige (nenhuma conta foi criada)
| Spike | Local (sem conta) | Exige conta/chave | Nomes de variável | Decisão que destrava |
|---|---|---|---|---|
| S-02 | sim (L) | Supabase Free (R) | `DATABASE_URL_APP_API`, `DATABASE_URL_MIGRATIONS` | geo e tick |
| S-01 | sim | opcional Supabase | `SUPABASE_*` locais | sessão (ADR-005) |
| S-05 | sim | opcional | idem | Realtime/polling |
| S-06 | sim | não | — | limites de imagem |
| S-03 | só leitura | MP sandbox | `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` | billing |
| S-04 | só leitura | Mapbox + cartão + limite | `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN`, `MAPBOX_ACCESS_TOKEN_SERVER` | geocodificação |
| S-09 | parcial | Vercel Hobby + Supabase | `DATABASE_URL_APP_API`, `JOBS_TICK_SECRET` | hospedagem |
| S-10 | parcial (C) | Supabase; opcional agendador externo | `JOBS_TICK_SECRET` | tick |
| S-11 | parcial (Mailpit) | Resend + **domínio** | `RESEND_*`, `EMAIL_*`, `SMTP_*` | e-mail |
| S-08 | leitura | não | — | custo |
| S-07 | leitura | não | — | mobile |

---

## 5. Convenções de branch, PR e commit [PROPOSTA]

### 5.1 Branches
- `main` protegida: sem push direto, sem force-push, PR obrigatório, checks obrigatórios, histórico linear (a proteção real é configurada no GitHub pelo Orquestrador/usuário no Gate 2; este texto não a impõe).
- Nomes (papel DEV: `feat/<issue>-…`, `fix/<issue>-…`): `feat/<n>-<slug>`, `fix/<n>-<slug>`, `chore/<n>-<slug>`, `test/<n>-<slug>`, `docs/<n>-<slug>`, `spike/S-xx-<slug>`. `<n>` = número da Issue do GitHub; **antes de existirem Issues** (até o Gate 2) usar o ID do backlog, p.ex. `feat/H-058-aceitar-trabalho`. Slug em minúsculas, sem acento, ≤ 40 caracteres.
- Sem branches de longa duração; rebase na `main` antes do PR; uma história por branch.

### 5.2 Commits (Conventional Commits em português) [PROPOSTA]
`tipo(escopo): resumo no imperativo [H-xxx]`
- Tipos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `spike`.
- Escopos: módulos de `08` §2 (`identity`, `catalog`, `geo`, `requests`, `distribution`, `selection`, `chat`, `media`, `reviews`, `verification`, `billing`, `notifications`, `privacy`, `admin`, `abuse`, `platform`) mais `web`, `admin-app`, `db`, `tokens`, `ci`, `repo`.
- Corpo: o quê e por quê; rodapé `Refs: #<issue>` e `Hist: H-xxx; RF/FA/I-xx`.
- Commits criados por agente Claude terminam com as linhas de atribuição indicadas pela sessão (Co-Authored-By e Claude-Session).
- **Nunca** commitar: `.env*` com valores, chaves, dumps com dado real, saída de log com PII. Revisar `git diff --staged` e rodar a varredura de segredos antes de cada commit/push.
- Migrações: um arquivo por mudança, nome `AAAAMMDDHHMMSS_<modulo>_<verbo>_<objeto>.sql` (gerado por `supabase migration new`); **nunca editar migração já mesclada**; *expand/contract* (contrair em PR posterior); toda migração que cria tabela de domínio habilita e **força RLS** na mesma migração (teste de catálogo).

### 5.3 Pull requests
- 1 PR = 1 Issue = 1 história; alvo ≈ ≤ 400 linhas de diff sem contar testes e migrações geradas `[PROPOSTA]`; PR maior é dividido ou justificado.
- Título `[H-xxx] <resumo>`. Corpo (template em `.github/PULL_REQUEST_TEMPLATE.md`): história e Issue; RF/FA/I-xx; critérios de aceite -> evidência; **comandos executados e resultados** (ou `NAO_EXECUTADO` com motivo); risco e plano de reversão; impacto em esquema/RLS; itens de `17` §3 marcados; EXEC-ID; HANDOFF.
- Checks obrigatórios: lint, typecheck, unitários, `test:db` (se tocou `supabase/` ou `apps/api`), gitleaks, hex/tipografia, fronteiras de módulo, `.env.example` consistente, `pnpm audit`/OSV.
- Fluxo: DEV abre -> Reviewer (`APROVADO_TECNICAMENTE`/`AJUSTES_NECESSARIOS`) -> QA -> **merge e CONCLUIR são humanos**. Máximo de **2 ciclos de correção** e 3 tentativas técnicas por etapa; ao atingir, parar e reportar.
- Merge sugerido: *squash* mantendo o título `[H-xxx]` (a decidir no Gate 2).
- O DEV **não** movimenta Project, não faz merge/deploy, não faz force-push.

---

## 6. CI gratuito [PROPOSTA; cotas de minutos `[NÃO VERIFICADO]`]

| Workflow | Quando | Conteúdo | Custo relativo |
|---|---|---|---|
| `ci.yml` | todo PR | Corepack/pnpm com cache, `turbo run lint typecheck test --filter=...[origin/main]`, gitleaks (binário, histórico do PR), hex/tipografia, fronteiras de módulo, `check-env-example`, `pnpm audit`/OSV, varredura de bundle por `service_role`/segredo | baixo |
| `ci-db.yml` | PR que toca `supabase/**`, `packages/db/**`, `apps/api/**` e merge na `main` | sobe apenas o banco necessário (`supabase start` com exclusão de serviços não usados `[NÃO VERIFICADO: flags]`), migrações do zero, pgTAP (catálogo, RLS, paridade pela `access-matrix`), testes de integração e subconjunto rápido de concorrência (N pequeno) | médio |
| `nightly-concurrency.yml` | agendado e sob demanda (marcos) | C-01..C-18 e F-01..F-12 com **N ≥ 100** e monitores I-01..I-30; carga leve LT-xx; ZAP baseline (somente local) | alto: ocorre só à noite e antes de M1/M2/M3 |
Notas: (a) em repositório privado a cota gratuita de minutos pode ser o gargalo (R de `ADR-020`): medir minutos por PR na Onda 0 e ajustar (`concurrency: cancel-in-progress`, cache, filtros por caminho); (b) sem segredos reais nos workflows: valores de teste ficam no próprio repositório como **fixtures sintéticas**; (c) nenhum job faz deploy; deploys de preview são da integração Git da Vercel (A3), sem variáveis de produção; (d) Dependabot (ou equivalente gratuito) para atualizações; (e) permissões mínimas do `GITHUB_TOKEN` (`contents: read`).

---

## 7. Variáveis de ambiente: `.env.local` e `.env.example` (apenas NOMES)

Regras: `.env.local` fora do Git (`.gitignore`); `.env.example` versionado, **sem valores** (comentário de uso, escopo e quem lê); validação em tempo de inicialização por schema (`packages/config`) que falha se faltar variável obrigatória; teste de CI garante que toda variável lida no código existe no `.env.example` e que nenhuma variável `NEXT_PUBLIC_*` contém segredo; chaves distintas por ambiente; revisar a guarda de chaves antes de produção/cobrança (12-TODO #6).

```
# --- Público (vai ao navegador; NEXT_PUBLIC_*) ---
NEXT_PUBLIC_APP_ENV                 # local | preview | staging | production
NEXT_PUBLIC_APP_BASE_URL
NEXT_PUBLIC_ADMIN_BASE_URL
NEXT_PUBLIC_API_BASE_URL            # /api (mesma origem)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY       # chave pública/anon do Supabase (nome pode mudar com a versão do painel)
NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN     # restrito por URL; só sugestões (temporário)

# --- Servidor (API e jobs) ---
APP_ENV
APP_BASE_URL
ADMIN_BASE_URL
LOG_LEVEL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY           # SÓ no módulo isolado de Storage/Auth admin
SUPABASE_JWT_SECRET                 # ou nome equivalente da chave de assinatura
DATABASE_URL_APP_API                # pooler (transação), papel app_api, sem BYPASSRLS
DATABASE_URL_APP_SYSTEM             # papel app_system, jobs/webhooks
DATABASE_URL_MIGRATIONS             # conexão direta, só CI/operador
DB_PASSWORD_APP_API                 # usadas só pelo script que define a senha dos papéis
DB_PASSWORD_APP_SYSTEM

# --- Segredos de domínio (HMAC/criptografia) ---
PEPPER_EMAIL_HMAC
PEPPER_CODE_HMAC
PEPPER_IP_HMAC
DOCUMENT_HMAC_KEY                   # unicidade de CPF/CNPJ (trial e vaga por identidade)
DATA_ENC_KEY_V1                     # criptografia de aplicação com chave versionada
DATA_ENC_KEY_ACTIVE_VERSION
SESSION_COOKIE_SECRET
JOBS_TICK_SECRET                    # segredo de máquina do POST /internal/jobs/tick
CRON_SECRET                         # se o cron da Vercel for usado (keep-alive)

# --- E-mail ---
EMAIL_PROVIDER                      # mailpit | resend
EMAIL_FROM
SMTP_HOST
SMTP_PORT
RESEND_API_KEY
RESEND_WEBHOOK_SECRET

# --- Mapbox (servidor) ---
MAPBOX_ACCESS_TOKEN_SERVER
MAPBOX_PERMANENT_SOFT_LIMIT         # parâmetros também em app_config
MAPBOX_PERMANENT_HARD_LIMIT

# --- Mercado Pago ---
MP_ENV                              # sandbox | production (production bloqueado até o Gate M4)
MP_ACCESS_TOKEN
MP_PUBLIC_KEY
MP_WEBHOOK_SECRET

# --- Teste/CI (nunca em produção) ---
CLOCK_OVERRIDE_ENABLED
ALLOW_EXTERNAL_EGRESS               # false por padrão na suíte
```
Vercel: as mesmas variáveis (exceto as de teste/CI e `DATABASE_URL_MIGRATIONS`) são cadastradas no painel do projeto por ambiente (Preview/Production) **pelo usuário, no Gate 2/3**; este plano não cria nenhuma.

---

## 8. Estimativa de esforço relativo [PROPOSTA] (sem prazo prometido)

Peso relativo por tamanho do backlog: **P = 1, M = 3, G = 8** `[PROPOSTA]` (escala de complexidade, não de tempo). Spikes: peso 2 para leitura/local, 5 para os que exigem conta e medição (S-02, S-03, S-09, S-10, S-11 = 5; S-01, S-04, S-05, S-06 = 3; S-07, S-08 = 2).
| Onda | Histórias | P | M | G | Pontos relativos | % do total sem mobile |
|---|---|---|---|---|---|---|
| 0 Fundação | 10 | 2 | 8 | 0 | 26 (+ spikes ≈ 38) | 6% |
| 1 Identidade e base | 12 | 2 | 7 | 3 | 47 | 11% |
| 2 Geo, pedido e verificação | 24 | 4 | 18 | 2 | 74 | 18% |
| 3 Aceite e chat (M1) | 24 | 7 | 14 | 3 | 73 | 18% |
| 4 Ciclo e assinatura (M2) | 25 | 3 | 18 | 4 | 89 | 21% |
| 5 Avaliação, admin, LGPD, hardening (M3) | 22 | 4 | 12 | 6 | 88 | 21% |
| Gate M4 | 4 | 1 | 1 | 2 | 20 | 5% |
| 6 Mobile | 3 | 0 | 1 | 2 | 19 | fora |
| **Total** | **124** | **23** | **79** | **22** | **436** (spikes à parte) | |
Leituras: (a) **M1 (Ondas 0–3) = ≈ 220 pontos, cerca de metade do trabalho sem mobile**: é a primeira entrega; (b) 22 histórias G concentram 176 dos 436 pontos (40%): é onde estão concorrência, segurança e integrações; (c) o que mais pode estourar a estimativa: S-02/S-10 (sem PostGIS/`pg_cron` no Free há retrabalho em H-022, H-008, H-023, H-055), S-03 (recorrência por ciclo), S-06 (HEIC) e H-117 (suíte de concorrência com N ≥ 100 no CI); (d) a regra de **um especialista por vez** e de 2 ciclos de correção por PR faz o tempo de calendário depender do número de ciclos Reviewer/QA, não só do código; (e) não há velocidade medida: recalibrar os pesos depois das 10 primeiras histórias da Onda 0.

---

## 9. Riscos de viabilidade técnica

| # | Risco | Efeito | Prob./Sev. | Mitigação / quando saber |
|---|---|---|---|---|
| V-1 | PostGIS, `pg_cron` e `pg_net` **não encontrados** no Free (R-38) | geo e tick mudam | M/M | S-02; fallback geo por célula; tick B/C; decidir antes de H-022/H-008 |
| V-2 | Sessão do Supabase para o cliente sem conta tradicional (ADR-005) | desenho de H-011..H-014 | M/A | S-01; fallback B com polling |
| V-3 | RLS + `set_config` por transação via pooler (vazamento de principal entre transações) | vazamento ou bloqueio indevido | A/B | teste do passo S-02.5; `withPrincipal` único; pgTAP e paridade T-05/T-06 |
| V-4 | NestJS na Vercel: cold start, tamanho, conexões, webhooks que respondem tarde | UX e MP reenviando | M/M | S-09; webhook só grava e responde; contingência ADR-018 |
| V-5 | Reencode/marca d'água na função: memória, HEIC, tempo | fotos lentas ou recusadas | M/M | S-06; um ativo por invocação; recusar HEIC se necessário |
| V-6 | Egress de 5 GB/mês e Storage de 1 GB | ≈ 100–200 pedidos/mês com foto | A/M | prévias de 320 px, medir Q-13, gatilhos 70/85% |
| V-7 | Cota do Resend (100/dia, 3.000/mês) e **domínio inexistente** | sem login real; avisos adiados | A/A | Mailpit em dev; domínio antes do M4 (BK-10); contador, reserva, degradação |
| V-8 | Mercado Pago: tarifas não obtidas; recorrência 3/6/12 meses incerta; sandbox/Pix e webhook a confirmar | billing pode virar avulso por ciclo | A/M | S-03; `PaymentGatewayPort`; livro `access_grant` independe do gateway |
| V-9 | Vercel Hobby é não comercial | cobrar exige Pro | A/A (verificado) | Hobby só em dev/sandbox; Pro antes da primeira cobrança (H-054) |
| V-10 | Supabase Free: pausa em 1 semana e **sem backup** | perda e indisponibilidade | A/A | keep-alive, backup manual (H-010), restauração testada (H-119); não usar dados reais antes |
| V-11 | Máximo de 2 projetos Supabase ativos | sem espaço para dev remoto | M/M | dev 100% local; 1 projeto spikes/staging, 1 produção; admin no mesmo projeto |
| V-12 | Ambiente Windows 11 Home: Docker Desktop/WSL2 ausentes, licença e desempenho | A1/A2 não montam | M/M | confirmar no Gate 3 antes de H-003; alternativa: runtime compatível com Docker `[NÃO VERIFICADO]`; CRLF tratado por `.gitattributes` |
| V-13 | Minutos de CI do plano gratuito | CI bloqueado | M/M | filtros, cache, concorrência N≥100 só à noite; medir na Onda 0 |
| V-14 | EDS mestre e RN originais **não recebidos** | tokens e regras podem mudar | M/M | H-002 segue a síntese do `04`; matriz de rastreio com lacunas (`15` §4) |
| V-15 | Complexidade do núcleo de concorrência (C-01..C-18, F-xx) e das views/RLS | esforço G concentrado em M1/M2 | A/M | testes de concorrência junto da história; barreiras determinísticas; fatiar PRs |
| V-16 | Mapbox permanente: custo desde o 1º pedido, cartão obrigatório, termos não lidos | custo e aderência | M/M | S-04; breaker de gasto; teto de 3 chamadas; limite de gasto na conta |
| V-17 | Documentos de identidade: limites (decisão 35) × 300 MB de Storage; sem antivírus | espaço e risco residual | M/B | redução no envio; PDF ≤ 2 MB; SD-12 (a); contagem por profissional |
| V-18 | Versões de Node/Next/Nest/Kysely/Supabase CLI não verificadas nesta sessão | incompatibilidades no bootstrap | M/B | fixar no lockfile e registrar; atualizar com Dependabot após estabilizar |
| V-19 | Dependência de um único mantenedor e de agentes em série | gargalo e viés | M/M | PRs pequenos, Reviewer/QA independentes, checklist `17` |

Nenhum risco acima justifica mudar a stack aprovada; V-1, V-2, V-4 e V-8 podem forçar SD (solicitação de decisão) se o spike falhar.

---

## 10. O que fazer primeiro no Gate 3

### 10.1 Pré-requisitos (não são histórias; o Orquestrador/usuário autoriza)
1. **Repositório:** `git init` em `D:\projetos\fastpro` (a pasta já tem `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` e `docs/`); criar o repositório remoto privado e a proteção da `main` (PR obrigatório, checks, sem force-push) — **SD-14/Gate 2**; primeiro commit apenas com documentação existente + `.gitignore`/`.gitattributes`.
2. **Ferramentas:** ativar pnpm via Corepack; instalar Docker (WSL2) e Supabase CLI; confirmar versões; registrar no PR de H-001. **Nada foi instalado por este plano.**
3. **Autorizações por spike (BK-6, recomendação b):** começar só pelo que não exige conta (S-02L, S-01, S-05, S-06 e leituras). Contas/projetos (Supabase Free, Vercel Hobby, Mercado Pago sandbox, Mapbox com cartão e limite, Resend + domínio) só quando o spike da vez exigir.
4. **Diretrizes de rotina já decididas e adotadas aqui:** BK-7 (b) backup semanal e antes de migração destrutiva; BK-9 (a) seed de 25 grupos só em dev; BK-11 (a) matriz de telas admin pela AMB-08 A. Os BK-1..5 e BK-8 já estão resolvidos pelas decisões 35–40.

### 10.2 As cinco primeiras histórias sugeridas (Onda 0)
| Ordem | História | Por que primeiro | Entrega verificável | Spikes que acompanham |
|---|---|---|---|---|
| 1 | **H-001** [P] Monorepo pnpm + Turborepo | tudo depende; cria `.gitignore`, `.env.example` e os scripts de verificação | `pnpm install`, `turbo run lint typecheck test build` verdes em pacotes vazios; regra de fronteira ativa | — |
| 2 | **H-003** [M] Ambiente local, migrações expand/contract, banco efêmero e catálogo pgTAP | caminho crítico (S-02 -> H-003 -> H-011); decide extensões e esquema inicial | `supabase db reset` do zero; teste: toda tabela de domínio com RLS habilitada e forçada | **S-02L, S-01 (local), S-05 (local)** |
| 3 | **H-004** [M] CI gratuito | impede segredos, cor literal e violação de fronteira desde o primeiro PR | PR só mescla com pipeline verde; gitleaks e `.env.example` consistentes | medir minutos de CI |
| 4 | **H-007** [M] Logs por allowlist e varredura de PII | todo código de servidor nasce sem PII (P8, T-11) | PII em log de teste reprova o build | — |
| 5 | **H-005** [M] Outbox, `job` com lease, `idempotency_key`, `app_config`, `rate_counter` | base de H-008, H-011, H-058 e de todas as operações idempotentes | mesma chave com corpo diferente -> 422; evento só após COMMIT; C-14, F-03, I-21 | S-06 (local) em paralelo de agenda, sem sobreposição de PR |
Em seguida (6–8): **H-002** (tokens, necessário antes de qualquer tela), **H-006** (auditoria), **S-10/H-008** e **S-09/H-009** (quando houver autorização de conta).

### 10.3 Dúvidas para o Orquestrador (somente bloqueantes)
Nenhuma impede **começar** pelas histórias acima. Pontos que precisam de resposta **antes** de itens específicos:
1. **Gate 2/SD-14 (bloqueia H-004 e todo PR):** autorizar a criação do repositório remoto e da proteção da `main`; recomendação: repositório **privado**, `main` protegida, merge somente humano.
2. **Local do Supabase CLI (informativo):** manter `supabase/` na raiz do repositório (recomendado) em vez de `packages/db/` (ajuste 1 da §1); o Architect confirma na revisão de H-001.
3. **Docker/WSL2 na máquina do usuário (bloqueia H-003):** confirmar que a instalação do Docker Desktop (ou runtime compatível) é aceitável nesta máquina Windows 11 Home; alternativa sem Docker não existe para o Supabase local `[NÃO VERIFICADO]`.
4. **Domínio de e-mail (BK-10, antes do M4):** decisão do usuário sobre adquirir domínio; sem ele o S-11 real e o login real ficam bloqueados.
