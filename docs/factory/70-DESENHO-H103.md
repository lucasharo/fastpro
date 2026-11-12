# Desenho H-103 — Console admin por papel (Issue #112, WF-03, Arquitetura)

- **Decisão:** APROVADO_ARQUITETURA, com 5 dúvidas não bloqueantes (§5). Nenhum código, migração ou tabela foi criado.
- **Rastro:** 69-REFINO-H103 (CA-H103-01..13; D-H103-1..4); 54-DESENHO-H102 (§3 guarda, §4 404/403); 60-DESENHO-H073 (padrão de desenho, §5.1 manda as telas de caso para H-103); 63-DESENHO-H104 (§D5 tela é H-103). Código lido: `packages/domain/src/admin/{routes,guard,roles,login,ports}.ts`, `apps/admin`, `apps/web`.
- **Etiquetas:** `[DECIDIDO]` decisão já tomada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` fora do alcance.

## 0. Fatos de partida

1. `[VERIFICADO]` `apps/admin` e `apps/web` são **placeholders** (só `index.ts`, sem Next.js nem componentes). O console é a primeira tela real do admin. A escolha do framework da UI não está registrada: dúvida D-H103-5.
2. `[VERIFICADO]` `ADMIN_ROUTES` (routes.ts) tem 16 rotas, cada uma com **uma permissão**. A guarda (guard.ts) é a autoridade: rota fora do registro, sem sessão, sem `aal2`, conta inativa ou sem papel = 404 idêntico; papel sem a permissão = 403 `permission_denied`.
3. `[VERIFICADO]` O mapa papel × permissão está em roles.ts (e semeado no banco). Superadmin tem só `admin.role.manage`, `catalog.manage`, `case.authorize_sensitive`; **não herda** as demais.
4. `[VERIFICADO]` `GET /v1/admin/auth/session` está no registro como `publica`, mas **não há manipulador** (login.ts só devolve `{autenticado, papeis, expira_em}` no login). Nenhum `GET` de lista de equipe, fila ou catálogo existe.
5. `[PROPOSTA]` Princípio: **o menu é derivado no servidor**, a partir das permissões que o banco devolveu na guarda. A UI nunca decide permissão; esconder tela é só conforto. "Entregue" (CA-H103-11) é um **fato do registro**: a tela só entra no menu se a rota que a alimenta está em `ADMIN_ROUTES`. Não há interruptor manual.

## 1. Telas por papel e rota que cada uma usa

Nova rota `[PROPOSTA]`: `GET /v1/admin/console/menu`, permissão `'sessao'` (a guarda já dá 404 sem MFA/papel, CA-H103-12). Resposta: `{ telas: [{ id, rotulo, caminho }] }`, nunca dados das telas. Catálogo puro em `packages/domain/src/admin/console.ts`: `ADMIN_CONSOLE_SCREENS` (id, rótulo, permissão exigida, rota de leitura que a alimenta, história dona) e `consoleMenuFor(permissoes, registro)` = telas cuja permissão está nas permissões da conta **e** cuja rota de leitura está no registro.

| Tela (id) | Permissão que mostra | Rota de leitura/ação (do registro) | Hoje no registro? | Dona |
|---|---|---|---|---|
| `verificacao` Fila de verificação | `verification.review` | a criar | Não | H-039 |
| `moderacao` Denúncias e contestações | `moderation.decide` | a criar | Não | H-090 |
| `financeiro` Cobranças e estornos | `finance.refund.request` | a criar (relatório de reconciliação) | Não | H-053, H-105 |
| `suporte` Casos e correção de conclusão | `support.completion.correct` | a criar | Não | H-079 |
| `acesso_excepcional` Pedido de acesso | `case.open_sensitive` | `GET/POST /v1/admin/access-cases`, `.../close` | **Sim** | H-073 (UI aqui) |
| `acesso_aprovacao` Aprovações pendentes | `case.authorize_sensitive` | `GET /v1/admin/access-cases`, `POST .../:id/approve` | **Sim** | H-073 (UI aqui) |
| `auditoria` Trilha de auditoria | `audit.read` | `POST /v1/admin/audit/queries` | **Sim** | H-104 (UI aqui) |
| `equipe` Papéis e convites | `admin.role.manage` | `POST /v1/admin/invites`, `POST/DELETE .../staff/:userId/roles` | **Parcial** (só ações; falta listagem) | H-102 |
| `catalogo` Catálogo | `catalog.manage` | a criar | Não | H-107 |
| `suspensao` Suspensão permanente | permissão de H-105 | a criar | Não | H-105 |

Consequências `[PROPOSTA]`:
- Na primeira entrega só aparecem `acesso_excepcional`, `acesso_aprovacao`, `auditoria` e `equipe`. As demais surgem quando a história dona registrar a rota e a linha em `ADMIN_CONSOLE_SCREENS` (D-H103-3 do PO, alternativa a). A linha pode ser registrada antes da rota: ela só não aparece.
- `equipe` precisa de `GET /v1/admin/staff` (lista de contas, papéis e estado, sem e-mail em claro além do necessário). **Faltante**, criado em H-103 por ser só leitura da tabela de H-102 (D-H103-1).
- Não há entrada de chat, documento de identidade, e-mail ou promoções (CA-H103-10). A leitura de conversa (`.../conversation/read`) não é registrada até H-065/H-066 (60 §3) e **não tem tela** aqui; quando existir, só abre de dentro de um caso ativo.
- Auditor: a tela usa só a consulta (`POST` por trazer efeito de registro, 63). Nenhuma outra rota do registro exige `audit.read`; logo não há botão de alteração possível (CA-H103-05).
- Superadmin vê `equipe`, `acesso_aprovacao`, `catalogo`, `suspensao`; **não** vê verificação, moderação, financeiro, suporte, auditoria (CA-H103-06; menor privilégio).
- União de papéis: `consoleMenuFor` recebe a **união** de permissões (`adminPermissionsOf`), então dois papéis dão a união das telas (CA-H103-07).

## 2. Contratos de dados lidos pelas telas

| Contrato | Origem | Situação |
|---|---|---|
| Permissões e papéis da sessão | `AdminGuardRecord` (`roles`, `permissions`, `aal2`, `totpAtMs`) via `private.admin_guard` | `[VERIFICADO]` existe |
| Estado da sessão para a UI | `GET /v1/admin/auth/session` | Faltante (sem manipulador). `[PROPOSTA]` implementar devolvendo `{autenticado, papeis, expira_em}` lendo a guarda; sem sessão = `{autenticado:false}` com 200 |
| Menu | `GET /v1/admin/console/menu` | Faltante, nova (§1) |
| Casos de acesso | `GET /v1/admin/access-cases` | `[VERIFICADO]` rota registrada (H-073) |
| Consulta de auditoria | `POST /v1/admin/audit/queries` | `[VERIFICADO]` rota registrada (H-104) |
| Lista de equipe | `GET /v1/admin/staff` sobre `admin_staff` e papéis (09, H-102) | Faltante; **sem tabela nova**; função `private.admin_staff_list` `security definer` revalidando `admin.role.manage` como as irmãs |
| Fila de verificação, denúncias, financeiro, suporte, catálogo, suspensão | histórias donas | Faltante; **fora desta história** |
| Passo de confirmação de TOTP | `POST /v1/admin/session/step-up` | `[VERIFICADO]` existe; a UI redireciona para ele ao receber 403 `step_up_required` |

`[PROPOSTA]` Todas as respostas admin já levam `no-store` (responses.ts); o menu também. A UI não guarda papéis em armazenamento do navegador.

## 3. Riscos de autorização e o que o banco já garante

| # | Risco | O que já garante / mitigação |
|---|---|---|
| R-1 | Confiar no menu da UI como controle. | `[VERIFICADO]` cada rota tem permissão na guarda; o banco revalida permissão, sessão e papel a cada requisição (CA-H103-08, 09). Teste de chamada direta por papel. |
| R-2 | Menu divergir da permissão real (tela aparece e a rota nega). | `[PROPOSTA]` `ADMIN_CONSOLE_SCREENS` referencia a permissão **da própria rota**: teste cruza cada tela com `ADMIN_ROUTES` e falha se a permissão da tela diferir da da rota. |
| R-3 | Revogação de papel não refletir no menu. | `[VERIFICADO]` a guarda lê o banco por requisição (efeito imediato, CA-H102-08); o menu é montado por requisição, sem cache. |
| R-4 | Papel desconhecido ou sessão sem MFA ver o console. | `[VERIFICADO]` `decideAdminGuard`: sem `aal2`/papel = 404; papel fora de `ADMIN_ROLES` não concede nada. |
| R-5 | Vazar existência de telas a quem não tem papel. | 404 idêntico; o menu só devolve rótulos das telas do próprio usuário. |
| R-6 | Superadmin acumular poder por tela. | `[VERIFICADO]` não herda permissões; "aprovar" não permite "abrir/ler" (60 §2). |
| R-7 | `GET /auth/session` público virar canal de enumeração. | Sem sessão devolve só `{autenticado:false}`; sem timing por causa, sem e-mail. |
| R-8 | CSRF nas ações da UI. | `[VERIFICADO]` `checkAdminMutation` (Origin, JSON, `Sec-Fetch-Site`) vale para todas as mutações. |
| R-9 | UI sem stack definida atrasa a história. | Dúvida D-H103-5; a lógica (menu e testes) vale sem UI. |

## 4. Testes T-H103 e critérios verificáveis (offline; domínio em Vitest, banco em `*.dbtest.mjs`; `corepack pnpm check:all` local)

- **T-H103-01 menu por papel (domínio):** para cada papel de `ADMIN_ROLES` sozinho, `consoleMenuFor` devolve exatamente o conjunto esperado pela tabela do §1 (CA-H103-01..06); verificar que Verificação não contém `auditoria`/`equipe`, e Superadmin não contém verificação, moderação, financeiro, suporte ou auditoria.
- **T-H103-02 união:** dois papéis (ex.: suporte + auditor) = união exata (CA-H103-07); papel desconhecido = menu vazio.
- **T-H103-03 tela sem rota registrada:** com registro sem a rota de uma tela, ela some para todos; ao registrar, aparece (CA-H103-11, D-H103-3). Teste fixa que hoje só 4 telas aparecem.
- **T-H103-04 coerência com a guarda:** cada tela tem rota existente no registro **ou** está marcada como "a criar"; a permissão da tela é igual à da rota (R-2). Nenhuma tela com id/rótulo de chat, documento, e-mail ou promoção (CA-H103-10).
- **T-H103-05 matriz de chamada direta (access-matrix):** para cada papel × rota de `ADMIN_ROUTES` e do menu: permitida só se o papel tem a permissão; negada = 403 sem dado; sem papel/MFA = 404 idêntico (CA-H103-08, 12). Auditor: única rota permitida de leitura é `POST /v1/admin/audit/queries`; PUT/PATCH/DELETE na trilha = 404 (CA-H103-05).
- **T-H103-06 revogação:** papel revogado entre duas requisições: menu e rota refletem na seguinte (CA-H103-09).
- **T-H103-07 resposta do menu:** só `id/rotulo/caminho`, `no-store`; sem permissões brutas, sem dado de tela, sem e-mail; 404 idêntico sem sessão/aal2.
- **T-H103-08 `GET /auth/session`:** com sessão devolve `papeis` e `expira_em`; sem sessão `{autenticado:false}`; resposta idêntica para cookie inválido, vencido ou revogado.
- **T-H103-09 lista de equipe (banco):** exige `admin.role.manage`; `app_api` sem acesso; não devolve segredo, hash, e-mail cifrado; concorrência sem efeito.
- **T-H103-10 documentação (CA-H103-13):** `11-DECISOES` registra AMB-08 A para RF-146 com referência a 69/70.
- **Evidência:** comando, contagem e código de saída no comentário da Issue. Sentinelas de e-mail e cookie varridas nos logs e respostas, como T-H102.

Arquivos esperados `[PROPOSTA]`: `packages/domain/src/admin/console.ts` (+ export em `index.ts`), `routes.ts` (rotas `console/menu` e `staff`), `packages/access-matrix/src/` (matriz por papel), `apps/api/src/admin-console-route.ts`, migração `…_admin_create_staff_list.sql` com rollback em `supabase/rollbacks/`, testes em `packages/domain/tests/admin-console.test.ts` e `packages/db/tests/admin-staff-list.dbtest.mjs`, UI mínima em `apps/admin` (D-H103-5).

## 5. Dúvidas não bloqueantes (com recomendação)

1. **D-H103-1 Listagem de equipe em H-103 ou em H-102.** (a) H-103 cria `GET /v1/admin/staff` (só leitura); (b) reabrir H-102. *Recomendação: (a); evita reabrir história concluída e não muda o banco além de uma função de leitura.*
2. **D-H103-2 Telas de acesso excepcional.** O refino (§2) atribui a H-073; o desenho 60 §5.1 manda as telas (abertura, aprovação) para H-103. *Recomendação: H-103 entrega as telas, H-073 entregou as rotas; corrigir o refino 69.*
3. **D-H103-3 Permissão da tela Financeiro.** `finance.refund.request` ou permissão própria de leitura da reconciliação (H-053). *Recomendação: permissão própria criada por H-053; até lá a tela não aparece.*
4. **D-H103-4 Divisão da história (porte G).** (a) uma entrega única com 4 telas e menu; (b) separar menu/lista de equipe da UI. *Recomendação: (b) em duas PRs na mesma Issue, lógica e testes primeiro.*
5. **D-H103-5 Stack da UI de `apps/admin`.** Nenhum framework está registrado; o placeholder fala em Next.js com origem própria. *Recomendação: Next.js (App Router) no gratuito da Vercel, conforme o placeholder, com tokens de `packages/tokens`/`packages/ui` (FA-033); decisão fica com o DEV se não houver ADR contrário.*

## Resumo em linguagem simples

O painel de administração passa a mostrar a cada pessoa só as telas do seu papel, montadas pelo servidor a partir do que o banco confirma na hora. Tela de uma tarefa ainda não entregue não aparece. Quem tenta abrir uma tela direto pelo endereço sem permissão não vê nada. Na primeira entrega aparecem pedido e aprovação de acesso excepcional, trilha de auditoria e gestão de equipe; as demais surgem conforme as outras tarefas ficarem prontas.
