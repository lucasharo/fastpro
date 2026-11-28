# Semente do catalogo de servicos (H-018)

**PROVISORIA.** O arquivo `catalog.v1.json` (versao `v1-provisorio`) NAO tem aceite do conteudo: os 25
grupos e os servicos vieram de `docs/factory/06-CATALOGO-PROPOSTO.md`, que e uma proposta do PO. O
aceite fica com o titular. Se os 10 grupos originais chegarem, a semente sera reagrupada por nova versao
(nunca por reaplicar esta).

## Como e gerado

- `node packages/db/scripts/catalog-build-seed.mjs` gera o JSON a partir do `06`.
- `node packages/db/scripts/catalog-build-seed.mjs --check` confirma que o JSON corresponde a regeracao.
- Regras (conselho profissional = inativo; referencia cruzada descartada; nomes repetidos viram sinonimo)
  estao em `packages/db/scripts/lib/catalog-seed.mjs` e sao conferidas por `packages/db/tests/catalog-seed.test.mjs`.

## Como e aplicado

- Somente por comando explicito, depois da QA: `pnpm db:seed:catalog -- --dry-run` (valida e desfaz) e
  depois `pnpm db:seed:catalog` (aplica numa transacao). A reexecucao com o mesmo conteudo nao faz nada.
- A aplicacao insere e nunca atualiza: alteracoes do administrador (nome, ordem, ativo, servico movido)
  permanecem.

## Contagens medidas (06, sem estimativa)

- 580 linhas de servico; 1 linha de referencia cruzada descartada; 5 nomes repetidos viraram sinonimo.
- 575 servicos; 504 ativos; 71 inativos por conselho profissional; 26 sensiveis; 1253 sinonimos.
- Orgaos considerados conselho: os da lista do desenho 53 §4.1 mais CFP, CFTA e CORE.
  CVM, SUSEP e DRT (reguladores) ficam ativos.
