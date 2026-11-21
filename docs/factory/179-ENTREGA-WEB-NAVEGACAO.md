# Entrega 179: navegação entre as telas (Issue #155)

- **Issue:** #155 `[E16] Navegação ligando as telas existentes num fluxo a partir da inicial` · **Workflow:** WF-03 · **Etapa:** Desenvolvimento (continuação 3) · **EXEC-ID:** EXEC-DEV3-155-20261121
- **Desenho de referência:** `178-DESENHO-WEB-NAVEGACAO.md`. **Este documento registra o estado real da rodada, não o desenho.**
- **Modelo do agente:** Claude Haiku 5.5 (`claude-haiku-5-5`).

## 1. Commits
- `fb640aa` navegação, cabeçalho e rodapé comuns, painel, situação, perfil, 404.
- `9a7f0a3` axe da inicial (combobox nos campos de busca e link "Pular" sem sobrepor o logo).
- `697bca1` lint e check:hex das telas de navegação.
- **Esta rodada (S4, encadeamento do pedido):** commit `feat(web): ... (Issue 155)` com as alterações listadas na seção 2 (o SHA exato está no histórico do `feature/init`).

## 2. S4 (encadeamento do cliente) — o que foi feito
Fluxo final do cliente (decisão 960 B): `/` → `/pedido` → `/fotos` → `/pedido/revisao` → (publicar sem sessão) `/entrar?voltar=%2Fpedido%2Frevisao` → volta à revisão → confirmação → `/painel`.

- `public/pedido.js`: ao término da espera do e-mail, o destino passa de `/pedido/revisao` para `/fotos` (`CAMINHOS.paginaFotos`). O cabeçalho do arquivo foi atualizado.
- `public/fotos.html`: acrescentado o bloco `<nav class="fp-sub" aria-label="Passos do pedido">` com "Voltar ao pedido" (`/pedido`) e "Continuar para revisão" (`/pedido/revisao`), antes da área que `fotos.js` monta. **`fotos.js` não foi alterado** (a lógica de envio, ordem e exclusão segue intacta).
- `public/pedido/revisao.html`:
  - "Voltar às fotos" (`/fotos`) no topo da revisão.
  - O link "Entrar de novo" do erro de sessão aponta para `/entrar?voltar=%2Fpedido%2Frevisao` (antes: `/acesso`).
  - Bloco "Próximo passo" (oculto até publicar) com o aviso "Volte ao FastPro para ver as respostas dos profissionais." e o link "Ver meus pedidos" (`/painel`).
- `public/pedido-revisao.js`: ao publicar com sucesso, mostra o bloco "Próximo passo" (uma linha).
- `public/pedido-logica.js`: texto do erro de sessão na publicação passa a ser "Sua sessão terminou. Entre de novo para publicar. Seu pedido continua guardado." (mesmo texto do desenho 7.6).
- **Nenhuma troca de estilo nova:** o bloco usa a classe `fp-sub` já existente em `navegacao.css`.

### Testes que fixavam o destino antigo (asserções pontuais alteradas)
- `tests/e2e/pedido-h030.spec.ts`, teste T-E04: a aba agora termina em `/fotos` (era `/pedido/revisao`), com a checagem de foco no título trocada pela presença do link "Continuar para revisão". O título do teste foi atualizado.
- `tests/pedido-h030-estatico.test.ts`, `tests/pedido-logica.test.ts`, `tests/fotos-page.test.ts`: passaram sem alteração (não fixavam o destino antigo nem o texto de sessão).
- `tests/profissional-documentos-estatico.test.ts` (fora do S4, correção trivial): a asserção "o único script" ficou desatualizada porque a tela agora carrega `guarda-sessao.js` antes de `profissional-documentos.js`. Passou a esperar os dois módulos externos da mesma origem.

### Teste novo
- `tests/e2e/fluxo-pedido.spec.ts` (Playwright, API simulada por `route`, sem rede real):
  1. Fluxo feliz: inicial (busca "Eletri", escolhe "Eletricista", endereço, Continuar) → `/pedido` (dados do rascunho, "Revisar pedido") → `/fotos` (links Voltar e Continuar visíveis, axe, Tab até "Pular para o conteúdo") → "Continuar para revisão" pelo teclado (foco + Enter) → `/pedido/revisao` (dados do pedido, axe) → "Voltar às fotos" pelo teclado → "Continuar para revisão" de novo, com o pedido preservado. Nenhuma origem externa acessada; nenhuma publicação feita.
  2. Revisão sem sessão: confirmar, publicar (API responde 401) → aviso de sessão com "Seu pedido continua guardado", link "Entrar de novo" com `href="/entrar?voltar=%2Fpedido%2Frevisao"`, uma única chamada de publicação, axe.
- **Origem do teste:** `http://localhost` (não `fastpro.test`). Motivo: `crypto.randomUUID` (chave de idempotência da publicação, `pedido-revisao.js`) só existe em contexto seguro. Em `http://fastpro.test` a publicação falha em silêncio (texto de erro vazio). Ver pendência P-3.

## 3. Provas (resultados locais, esta rodada)
| Verificação | Comando | Resultado |
|---|---|---|
| eslint dos arquivos tocados | `corepack pnpm exec eslint <6 arquivos: pedido.js, pedido-logica.js, pedido-revisao.js, fluxo-pedido.spec.ts, pedido-h030.spec.ts, profissional-documentos-estatico.test.ts>` (raiz) | exit 0 |
| typecheck | `corepack pnpm run typecheck` | exit 0 |
| sincronização de navegação | `node apps/web/scripts/sincronizar-navegacao.mjs --check` | exit 0, "navegação sincronizada em 17 páginas" |
| Vitest do web (completo) | `corepack pnpm exec vitest run` em `apps/web` | exit 1: **575 passed, 2 failed de 577** (31 de 32 arquivos passam) |
| Playwright (4 suítes) | `corepack pnpm exec playwright test tests/e2e/fluxo-pedido.spec.ts tests/e2e/navegacao.spec.ts tests/e2e/entrada.spec.ts tests/e2e/pedido-h030.spec.ts` | exit 0: **70 passed, 3 skipped** (os 3 pulados são do pedido-h030, já existentes) |

Antes desta rodada, o Vitest tinha 3 falhas. Uma foi corrigida (expectativa de scripts, seção 2). As 2 restantes são de `tests/profissional-documentos-estatico.test.ts` e não são triviais (ver P-1).

Não executado nesta rodada: `check:hex`, `check:typography`, `check:all` (fora do escopo pedido). O `check:hex` já reprovava `packages/access-matrix/src/matrix.ts:282`, fora desta Issue (P-4).

## 4. Mapa final das telas do cliente
| Rota | Estado |
|---|---|
| `/` (inicial) | cabeçalho e rodapé comuns; busca e Continuar levam a `/pedido` |
| `/pedido` | "Revisar pedido" leva a `/fotos` (depois da espera do e-mail) |
| `/fotos` | Voltar ao pedido; Continuar para revisão; envio de fotos inalterado |
| `/pedido/revisao` | Voltar às fotos; confirmação expressa; sessão expirada na publicação leva à entrada com retorno; "Ver meus pedidos" depois de publicar |
| `/painel` | "Meus pedidos" (sem sessão, vai para `/entrar?voltar=%2Fpainel`) |

## 5. Desvios em relação ao desenho 178
- Em `/fotos` e `/pedido/revisao` os links de passo estão no topo da página (não no rodapé da lista de fotos), porque a lista é montada pelo script e a regra era não mexer nele.
- Na sessão expirada, o desenho 7.6 fala em "link"; foi mantido o link ("Entrar de novo"), sem redirecionamento automático, para a pessoa ler o aviso de que o pedido continua guardado.
- O bloco "Ver situação do cadastro" e o "recurso desabilitado" continuam sem verificação (pendência de rodadas anteriores).

## 6. Pendências e pontos para o líder
- **P-1 (decisão de produto, dois testes de `profissional-documentos-estatico`):** `packages/domain/src/identity-docs/textos.ts` tem agora 30 textos aprovados (o teste fixa 26), e 4 deles (ex.: "Esta atividade exige certificação. Envie o documento para continuar.", "Não é possível enviar documento para este serviço…", "Já há um envio em andamento…") não aparecem na tela. Veio da decisão 260 do H-037 (#50). Corrigir exige decidir onde esses estados aparecem na tela. Não corrigido aqui.
- **P-2 (CA-NAV-06, "nova confirmação expressa" ao voltar do login):** o `confirmed_at` fica guardado no servidor, então ao voltar da entrada a revisão mostra o pedido já confirmado e o botão "Publicar". A publicação continua exigindo clique, mas não há confirmação nova. Forçar a confirmação exige um marcador (URL, armazenamento do navegador, ou regra no servidor), e a regra de H-030 proíbe armazenamento do navegador. Decisão do líder: aceitar esta lacuna nesta Issue ou abrir regra no servidor (ex.: invalidar a confirmação ao encerrar a sessão).
- **P-3 (robustez de contexto não seguro):** `pedido-revisao.js` usa `crypto.randomUUID` sem alternativa. Em `http` fora de `localhost` (ex.: teste em IP da rede local), a publicação falha sem mensagem. Não afeta produção (https) nem `localhost`. Sugestão: outra Issue de #44/H-031 com fallback.
- **P-4:** `check-hex` reprova `packages/access-matrix/src/matrix.ts:282`, fora desta Issue.
- **P-5 (desenho 178, D-1 a D-6):** D-1 (perfil só leitura; edição é outra Issue), D-2 (botão "Sair" fora do escopo), D-4 (textos provisórios do painel e da situação sem documento, em `NAV_TEXTOS`), D-5 (cabeçalho comum resolve o "Entrar" na inicial, adotado), D-6 (prova real depende da #156).
- **P-6 (#156, API local):** toda a prova desta rodada usa API simulada por `route`. A prova com API real continua pendente da #156 e dos serviços de desenvolvimento. Não está feita.
- Prazo do rascunho conferido: `DRAFT_TTL_DAYS = 7` em `packages/domain/src/draft/request-draft.ts` (decisão 966 confirmada).
- Esta rodada não tocou em `11-DECISOES.md`, no quadro nem em `quadro-*`. Esses arquivos aparecem alterados no `git status` por outros processos e não foram incluídos no commit.

## 7. Como abrir localmente
`DEV_PORT=3010 corepack pnpm dev`, depois `http://127.0.0.1:3010/` (comando do líder; não executado nesta rodada).
