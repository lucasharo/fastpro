# Entrega 179: navegação entre as telas (Issue #155)

- **Issue:** #155 `[E16] Navegação ligando as telas existentes num fluxo a partir da inicial` · **Workflow:** WF-03 · **Etapa:** Desenvolvimento (continuação 2) · **EXEC-ID:** EXEC-DEV2-155-20261121
- **Desenho de referência:** `178-DESENHO-WEB-NAVEGACAO.md`. **Este documento registra o estado real da rodada, não o desenho.**

## 1. Commits nesta rodada
- `9a7f0a3` fix(web): axe da inicial (combobox nos campos de busca e link Pular sem sobrepor o logo) (Issue 155).
- Commit seguinte: lint e check:hex das telas de navegação (Issue 155), com este documento.

## 2. Correções feitas
- **Axe da inicial (critical `aria-allowed-attr`):** `aria-expanded` estava em `<input type="search">` (papel searchbox). Adicionado `role="combobox"` aos campos `#servico` e `#endereco` (padrão combobox, já usado por `address-field.js`). `inicio.js` não mudou.
- **Axe da inicial (serious `target-size`):** o link "Pular para o conteúdo", ao receber foco, cobria o logo. Ele fica absoluto e o cabeçalho reserva uma faixa no topo (`padding-top` com o token de altura de botão). Uma primeira tentativa (o link entrar no fluxo com foco) causou deslocamento do cabeçalho no mousedown e quebrou o clique do mouse; foi descartada.
- **check:hex** (`apps/web/tests/e2e/entrada.spec.ts:33`): "#154" em texto virou "Issue 154". O `navegacao-vercel.test.ts:50` não era reprovado pelo script.
- **eslint** (`no-undef` nas telas novas): diretiva `/* global document, fetch, location */` em `guarda-sessao.js`, `painel.js`, `profissional-perfil-pagina.js` e `profissional-situacao-pagina.js`. Em `guarda-sessao.js`, `let status = null` virou `let status` (valor sempre sobrescrito).

## 3. Provas (resultados locais)
- `corepack pnpm exec playwright test tests/e2e/navegacao.spec.ts`: 3 passed (exit 0), depois das correções.
- `corepack pnpm exec playwright test tests/e2e/entrada.spec.ts tests/e2e/navegacao.spec.ts tests/e2e/pedido-h030.spec.ts`: 68 passed, 3 skipped (exit 0). Os 3 pulados são do pedido-h030 e não foram investigados nesta rodada.
- `corepack pnpm exec vitest run` (apps/web), antes e depois das correções de lint: 574 passed, 3 failed de 577 (exit 1). As 3 falhas são de `tests/profissional-documentos-estatico.test.ts` (preexistentes, não triviais nesta rodada, não corrigidas).
- Vitest dos testes da #153 (`inicio-continuar`, `inicio-estatico`, `inicio-logica`, `inicio-page`): 64 passed (exit 0).
- `corepack pnpm run typecheck`: exit 0.
- `node scripts/sincronizar-navegacao.mjs --check`: exit 0 ("navegação sincronizada em 17 páginas").
- `node scripts/check-hex.mjs`: exit 1, 1 violação fora do escopo desta Issue: `packages/access-matrix/src/matrix.ts:282`.
- eslint dos arquivos tocados: ver o resultado final no relatório da rodada (`ESLINT_EXIT` registrado no commit de lint).

## 4. Mapa das telas (conferido por leitura e pelo Playwright acima)
| Rota | Estado |
|---|---|
| `/` (inicial) | cabeçalho e rodapé comuns; axe sem violação |
| `/painel` | "Meus pedidos": sem sessão vai para `/entrar?voltar=%2Fpainel`; com sessão lista o pedido |
| `/profissional-documentos` | sem sessão vai para `/profissional/entrar?voltar=...`; aprovado mostra o link "Ver situação do cadastro" |
| `/profissional-situacao` | situação vinda do domínio (`data-estado`) |
| `/profissional-perfil` | leitura de nome, serviços e base; antes da aprovação volta para a situação |
| `/404` | página 404 com cabeçalho e rodapé |

Como abrir localmente (comando do lead, **não executado nesta rodada**): `DEV_PORT=3010 corepack pnpm dev`, depois `http://127.0.0.1:3010/`.

## 5. Desvios em relação ao desenho 178
- **Ver situação do cadastro** aparece sempre que a documentação está liberada (conferido só no caso aprovado do Playwright). Não verificado: estado "recurso desabilitado".
- **Painel sem detalhe**: a lista mostra só o que a API entrega (nome do serviço, estado, prazo e data). Não há tela de detalhe do pedido nesta entrega.

## 6. Pendências
1. **S4 (encadeamento do pedido) NÃO implementado.** `public/pedido.js` ainda envia ao término para `/pedido/revisao` (`CAMINHOS.paginaRevisao`, linha 265). Falta: pedido → `/fotos`; "Continuar" e "Voltar" em `/fotos` e `/pedido/revisao`; 401 na publicação para `/entrar?voltar=/pedido/revisao` com o rascunho preservado; ajuste dos testes `pedido-h030-estatico`, `pedido-logica`, `fotos-page` e `pedido-h030.spec`. A página `fotos.html` é quase vazia e a interface é montada por `fotos.js`.
2. **Testes DOM das telas novas (passo 3)** não escritos no padrão Vitest. As telas são cobertas só pelo Playwright de navegação.
3. **Passo 4 completo** (mapa final, desvios e pendências) está neste documento, mas o desvio "recurso desabilitado" não foi verificado.
4. Três falhas preexistentes em `profissional-documentos-estatico.test.ts`.
5. `check-hex` reprova `packages/access-matrix/src/matrix.ts:282`, fora do escopo desta Issue.
6. Prova com API real pendente da #156 (a API local ainda não está ligada); todos os testes usam API simulada por `route`.
