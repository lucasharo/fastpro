# @fastpro/tokens

Fonte unica de cor, tipografia e medidas do EDS (RF-160; FA-033; H-002). Valores da sintese do
EDS (`04_DESIGN_SYSTEM_EDS.md`); o EDS mestre ainda nao foi recebido. Cores aprovadas nao sao
alteradas por codigo ou testes: divergencias sao reportadas ao usuario.

- `src/tokens.ts`: tokens semanticos (claro e escuro), Roboto 400/500/700, espacamento de 4px,
  raios 16/12, botoes 40/48/56, input 52, breakpoints 768/1200.
- `src/contrast.ts`: contraste WCAG 2.2 e pares declarados.
- `src/css.ts` + `scripts/build-css.mjs`: gera `dist/tokens.css` (CSS variables). Tema inicial
  pela preferencia do dispositivo; `data-theme="light|dark"` na raiz sobrepoe.
- Unico lugar com cor literal; `pnpm check:hex` reprova hex, `rgb()/hsl()`, nomes de cor CSS
  (`red`, `white`...) e utilitarios com cor em todo o resto do repositorio.
- `pnpm --filter @fastpro/tokens report:contrast` imprime a tabela de contraste (apos o build).
