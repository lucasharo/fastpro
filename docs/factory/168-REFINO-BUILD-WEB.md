# 168 - Refino: build do web quebra por stub de node:crypto incompleto (Issue #152)

- Issue: #152 (`[E15] build do web quebra: stub de node:crypto sem createCipheriv, createDecipheriv, hkdfSync e randomBytes`)
- Workflow: WF-04 (Correção de bug). Etapa: Product Owner. EXEC-ID: EXEC-PO-152-20261120.
- Repo: D:/projetos/fastpro, branch feature/init.
- Rodada: subagente Claude (agy ocupado), registrado.

## 1. Objetivo

O build do web para na geração do bundle do envio de foto. O script `apps/web/scripts/build-fotos-envio.mjs` (linhas 21 a 32) usa um stub de `node:crypto` que exporta só `createHash`, `createHmac` e `timingSafeEqual`. Porém `packages/domain/dist/discovery/discovery-cursor.js` (linha 8) importa também `createCipheriv`, `createDecipheriv`, `hkdfSync` e `randomBytes`, desde a #68.

- Observado (reproduzido pelo líder): `node apps/web/scripts/build-fotos-envio.mjs` falha com `No matching export in "stub-node-crypto:node:crypto" for import "randomBytes"`. Como consequência, `pnpm build` do web quebra.
- Esperado: o script termina com código 0 e gera `apps/web/public/fotos-envio.js`. O navegador continua sem capacidade real de criptografia de servidor: se alguém chamar essas funções no navegador, elas falham de forma explícita.

## 2. Escopo

- Acrescentar ao stub as quatro funções faltantes, todas lançando o erro `node:crypto indisponivel no navegador` quando chamadas.
- Criar um teste automatizado de regressão que compara os imports de `node:crypto` feitos pelos arquivos de `packages/domain/dist` com os exports do stub, e falha listando os nomes faltantes.
- Registrar evidência local (comando, contagem e código de saída). O GitHub Actions não é gate.

## 3. Fora de escopo

- Alterar a lógica do cursor (#68), a cifra ou o desenho em `docs/factory/153-DESENHO-H055.md`.
- Alterar `apps/api` (que usa `node:crypto` no servidor e não entra no bundle do navegador).
- Reestruturar a entrada do bundle para tirar o cursor do grafo (alternativa C da pergunta 930, não adotada por padrão).
- Mexer no quadro, nas Issues, em `11-DECISOES` ou em commits de outros itens.
- Produção, deploy, backup e exportação de dados.

## 4. Critérios de aceite (Given/When/Then)

**CA-01. O bundle é gerado.**
Dado o domínio compilado em `packages/domain/dist` e as dependências instaladas,
Quando rodar `node apps/web/scripts/build-fotos-envio.mjs`,
Então o código de saída é 0, a mensagem de sucesso é impressa e `apps/web/public/fotos-envio.js` existe com tamanho maior que zero.
*Prova:* saída do comando e código de saída, registrados na Issue.

**CA-02. O build do web passa.**
Dado o CA-01 atendido,
Quando rodar `corepack pnpm --filter @fastpro/web build`,
Então o código de saída é 0 (inclui cópia de tokens, bundle e `tsc`).
*Prova:* comando e código de saída.

**CA-03. As funções do stub falham no navegador.**
Dado o stub gerado para o bundle,
Quando qualquer uma das funções `createCipheriv`, `createDecipheriv`, `hkdfSync`, `randomBytes`, `createHash`, `createHmac` ou `timingSafeEqual` for chamada,
Então ela lança `Error` com a mensagem `node:crypto indisponivel no navegador` e não retorna valor.
*Prova:* teste automatizado que chama cada função exportada pelo stub e confirma a exceção.

**CA-04. O bundle do navegador não contém o código do cursor.**
Dado o arquivo `apps/web/public/fotos-envio.js` gerado,
Quando procurar os literais `cur1|`, `fastpro-discovery-cursor-v1`, `cursor-aead` e `aes-256-gcm`,
Então nenhum deles aparece.
*Prova:* busca no arquivo gerado com 0 ocorrências, registrada na Issue.
*Hipótese H1 (não verificada):* a entrada do bundle não chama o cursor, mas o esbuild pode manter o módulo. Se o critério falhar, o arquiteto escolhe a alternativa C da pergunta 930.

**CA-05. Regressão impedida por teste automatizado.**
Dado um arquivo em `packages/domain/dist` que importe de `node:crypto` um nome que o stub não exporta,
Quando rodar o teste automatizado,
Então o teste falha e cita o nome faltante; com o stub completo, o teste passa.
*Prova:* teste verde com o stub completo, e um ensaio local (remover um nome do stub, ver o teste falhar, restaurar) registrado na Issue.

**CA-06. Suítes existentes do envio de foto continuam verdes.**
Dado o CA-02 atendido,
Quando rodar a suíte completa do web no fim do trabalho (não em cada etapa),
Então `fotos-envio-estatico.test.ts` e `fotos-envio-paridade.test.ts` passam.
*Prova:* contagem e código de saída da suíte, na etapa de QA final.

## 5. Dependências

- #68 (Concluído): origem do import (segundo o líder, commit 7576f6d; não verifiquei o commit, pois não tenho acesso ao git nesta sessão).
- #141 e #44 (Concluídos): bundle do envio de foto e publicação idempotente.
- Decisão 194 (esbuild como dependência de desenvolvimento gratuita) e `docs/factory/153-DESENHO-H055.md`.
- Build de `@fastpro/domain` antes do bundle (`corepack pnpm --filter @fastpro/domain build`; `turbo` com `dependsOn ^build`).
- Quadro: a Issue #152 está em **Backlog** em `docs/factory/quadro-status.md` (verificado), e não em Product Owner. O líder precisa movê-la para Product Owner antes do início formal da etapa. Não alterei o quadro.

## 6. Riscos

- **R1.** O stub voltar a ficar atrás do `dist` a cada nova importação de `node:crypto`. Mitigação: CA-05.
- **R2.** O código do cursor entrar no bundle do navegador (H1). Mitigação: CA-04 detecta e a decisão 930 resolve.
- **R3.** O teste de regressão depender de `dist` já construído. Se o `dist` faltar, o teste deve falhar, e não passar em silêncio.
- **R4.** Haver outras importações faltantes no `dist`. Mitigação: CA-05 lista todos os nomes faltantes de uma vez, e não só o primeiro.

## 7. Perguntas ao líder (numeradas a partir de 930)

**930. Forma da correção do dublê de `node:crypto`.**
- O que é: o "dublê" é o substituto do módulo `node:crypto` que o bundle do navegador usa no lugar do módulo real.
- Por que importa: se o dublê continuar incompleto, o build quebra de novo a cada nova importação.
- Opções: (a) acrescentar as quatro funções que lançam erro; (b) gerar o dublê automaticamente a partir dos imports reais do `dist`; (c) tirar o cursor do grafo do bundle.
- **Recomendação: (a) agora, com o teste do CA-05; (b) fica como evolução futura.**
- Destrava: DEV.

**931. Onde fica o teste de regressão do CA-05.**
- O que é: o teste que compara os imports do `dist` com os exports do dublê.
- Por que importa: se ele ficar no lugar errado, pode não rodar no `test` do web.
- Opções: (a) em `apps/web/tests`, lendo o `dist` do domínio; (b) em `packages/domain`, lendo o fonte.
- **Recomendação: (a), porque é o artefato que quebrou; e falhar (não pular) quando o `dist` faltar.**
- Destrava: DEV e QA.

**932. Critério CA-04 (cursor fora do bundle).**
- O que é: a regra de que o código de cifra do cursor não pode aparecer no arquivo que vai para o navegador.
- Por que importa: esse código não deve ir para o navegador, mesmo que não seja chamado.
- Opções: (a) manter como critério obrigatório; (b) aceitar o código no bundle, desde que não seja chamado; (c) tirar o cursor do grafo (ver 930, opção c).
- **Recomendação: (a). Se H1 se confirmar, o arquiteto escolhe (c).**
- Destrava: Arquitetura.

## 8. Adotado pelo líder (veto possível, sem resposta exigida)

- Branch: `feature/init`, sem branch separada de bugfix (regra do produto; o WF-04 prevê branch de bugfix, mas a regra do usuário prevalece).
- O teste de regressão e o bundle rodam pelo `test` do web, que já encadeia o bundle.
- A suíte completa roda só no fim (CA-06), conforme a regra de QA.

## 9. Pronto para Arquitetura

Sim, após a Issue #152 estar em Product Owner no quadro e o líder confirmar as decisões 930 a 932. Nenhum código foi alterado nesta etapa.
