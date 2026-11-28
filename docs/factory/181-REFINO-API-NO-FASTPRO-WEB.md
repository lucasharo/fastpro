# Refino 181 — API publicada dentro do projeto fastpro-web (Issue #158)

- **Issue:** #158 `[E0] Publicar a API dentro do projeto fastpro-web na Vercel (somente preview)` · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **EXEC-ID:** EXEC-PO-158-20261121 (subagente Claude, em paralelo, acionado pelo líder).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-21.
- **Natureza:** somente documento. Nenhum código, quadro (`quadro-status.md`), `11-DECISOES.md`, `.env.local`, configuração da Vercel ou GitHub foi alterado. Nenhum valor de credencial foi lido ou impresso.
- **Etiquetas:** `[DECIDIDO]` decisão registrada · `[VERIFICADO]` lido no repositório nesta rodada · `[PROPOSTA]` recomendação deste refino · `[AMBIGUIDADE]` fontes conflitantes ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `D:\Fabrica\roles\factory-product-owner.md`, `D:\Fabrica\workflows\WF-03-FEATURE.md` (localizado; leitura integral não feita nesta rodada).
- `docs/factory/177-DESENHO-AMBIENTE-DEV.md` (seções 1, 2, 6 e 7 integrais; cabeçalho e seção 8 por Grep).
- `docs/factory/174-REFINO-AMBIENTE-DEV.md` (modelo de formato, integral).
- `docs/factory/44-ROTEIRO-H009.md` (§2 a §5) e `docs/factory/43-DECISAO-H009-CAMINHO.md` (§0 a §3).
- `docs/factory/10-ADRS.md` (ADR-018, linhas 158-163).
- `apps/web/vercel.json` e `apps/api/vercel.json` (integrais); `apps/api/package.json` e `apps/web/package.json` (integrais); existência de `apps/api/src/vercel.ts` (Glob).
- Grep de `__Host-` em `apps/api/src` e de "H009", "pré-visualização" e "preview" em `11-DECISOES.md`.
- `docs/factory/quadro-status.md`: #158 consta na coluna **Product Owner** (linha 71); #156 consta em **Aguardando aprovação** (linha 192).

Não lido ou não verificado nesta rodada `[NÃO VERIFICADO]`:
- Painel e API da Vercel (projeto `fastpro-web`, branch de produção, deployments existentes, variáveis, proteção de preview, uso do plano). Não foram consultados por MCP nem CLI. Ver pré-condição P3.
- Limites do plano gratuito (duração, tamanho do pacote, invocações, saída de dados). ADR-018 marca "termos e limites NÃO VERIFICADO".
- `apps/api/src/vercel.ts` integral; `package.json` da raiz (comando de build).
- Issue #158 e #156 no GitHub (leitura de rede não feita; o escopo vem do pedido do líder e dos documentos).

---

## 1. Problema verificado

- **P-1** `[VERIFICADO]` `apps/web/vercel.json` tem `cleanUrls`, `headers` e `redirects`. Não tem `rewrites`, `regions` nem `functions`. Hoje nenhuma função da web atende `/api/*`.
- **P-2** `[VERIFICADO]` `apps/api/vercel.json` tem `regions: ["gru1"]` e `functions."api/index.ts".maxDuration: 300`. Esses valores precisam ser levados para a web, com a chave do caminho novo.
- **P-3** `[VERIFICADO]` `apps/api/package.json` exporta **somente** `"."` (linhas 9-14). Não há entrada pública para `src/vercel.ts`. Por isso a importação `../../api/src/vercel.js` citada no desenho 177 (§7.1) aponta para um arquivo-fonte `.ts` de outro pacote, não para um caminho público. `[AMBIGUIDADE A-158-1]` a Arquitetura escolhe entre uma entrada nova em `exports` do pacote `@fastpro/api` (ex.: `./vercel`) ou outra forma de importação. Este refino não decide o caminho técnico.
- **P-4** `[VERIFICADO]` `apps/web/package.json` não depende de `@fastpro/api`. O desenho 177 (§7.3) pede essa dependência para o `turbo` ordenar o build e para a Vercel rastrear os módulos nativos.
- **P-5** `[VERIFICADO]` Cookies `__Host-` em uso na API: `__Host-fp_ident` (`apps/api/src/challenge-verify-route.ts:4`), `__Host-fp_draft` (`drafts/draft-nonce.ts:2`), `__Host-fp_sess` (`professional-account-route.ts:2`). Um cookie com prefixo `__Host-` exige `Secure`, `Path=/` e ausência de `Domain`. Consequência: no preview o cookie só funciona por HTTPS; no ambiente local depende do comportamento do navegador com `127.0.0.1` `[NÃO VERIFICADO]`.
- **P-6** `[VERIFICADO no desenho 177, F-10]` A rota exige `Origin` igual à origem de `SITE_URL`. O preview precisa de um `SITE_URL` que corresponda à URL pela qual a web é acessada. Como cada deployment tem endereço próprio, a escolha da URL é decisão (pergunta 992).
- **P-7** `[VERIFICADO]` `apps/api/src/session-route.ts` não está montada na função hoje (177, F-9). A rota de sessão só responde depois da fatia F5b de #156. Logo, a prova de sessão no preview depende de #156.

---

## 2. Objetivo

A API passa a responder no mesmo endereço da web, em `/api/...`, por uma função do projeto `fastpro-web` implantada somente como **preview** da branch `feature/init`. Assim a web e a API ficam na mesma origem (ADR-018), sem CORS.

Resultado esperado: a web (já publicada no preview) consegue chamar a API pelo caminho relativo `/api/...`.

Ambiente: **somente desenvolvimento**. Nenhuma produção, nenhum domínio, nenhum plano pago.

---

## 3. Escopo

- **E1. Função catch-all na web.** `apps/web/api/[...caminho].ts` reexporta o handler da API (desenho 177 §7.1). Se o roteamento do catch-all não funcionar no projeto sem framework, o plano B do desenho (`apps/web/api/index.ts` com `rewrites`) é usado dentro do limite de tentativas. Forma de importação: ver A-158-1.
- **E2. Configuração da web.** `apps/web/vercel.json` ganha `regions: ["gru1"]` e `functions` com `maxDuration: 300` para `api/**/*.ts`. Os `headers` e `redirects` atuais são mantidos sem alteração de conteúdo.
- **E3. Dependência.** `apps/web/package.json` ganha `@fastpro/api` como `workspace:*`, para o build ordenar a compilação e para a Vercel rastrear as dependências da função.
- **E4. Variáveis no escopo Preview.** Só os nomes exigidos pelo desenho 177 §5. Valores entram só pelo dono ou pela CLI/MCP da Vercel, nunca em documento, commit ou log. Condicionado à pergunta 991.
- **E5. Verificação local antes do envio.** Build do monorepo e testes do que mudou, com código de saída registrado na Issue.
- **E6. Envio de preview da branch `feature/init`.** Feito conforme as pré-condições P1 a P5 (seção 4). A verificação do preview é feita pelo agente factory-release, que não envia produção.

## 4. Fora de escopo e pré-condições

Fora de escopo (não fazer nesta Issue):
- Produção: `vercel --prod`, promoção de deployment, alias de produção, configuração de domínio, plano pago, cobrança real.
- Projeto `fastpro-api`: não alterar `apps/api/vercel.json` nem `apps/api/api/index.ts`, e não enviar deployment a ele. Remover o projeto é decisão futura.
- Projeto `fastpro-spike-s09` (remoção é decisão do titular, roteiro 44 §5).
- Envio de e-mail, Mapbox, Mercado Pago, backup ou exportação de dados.
- Alteração de rotas, regras de negócio ou de banco.

Pré-condições (todas antes de qualquer envio; a falha de uma delas interrompe a etapa de envio):
- **P1** `[DECIDIDO]` A Issue #156 entrega as fatias F0 a F6 verdes localmente (F5b para a sessão) antes do envio. `[AMBIGUIDADE]` #156 está em **Aguardando aprovação** no quadro, com "preview Vercel pendente" listado no próprio cartão. Esta Issue **depende** de #156 e não termina sozinha. Ver R-158-08.
- **P2** Autorização para o envio de preview registrada (pergunta 990). `[AMBIGUIDADE]` o roteiro 44 §2.1 exige "autorização escrita específica do titular" para o caminho escolhido. A decisão 43 está em `BLOQUEADO_AUTORIZACAO`, e a busca em `11-DECISOES.md` não encontrou resposta para P-H009-1 nem D-H009-1.
- **P3** `[NÃO VERIFICADO]` Leitura (sem escrita) do painel ou da CLI da Vercel, antes do envio, confirmando: (a) a branch de produção do projeto `fastpro-web` não é `feature/init`; (b) se o projeto ainda não tem nenhum deployment, a regra do primeiro envio (`first_deployment_production`) se aplica e o envio **para** (roteiro 44 §4); (c) nenhum projeto da conta está ligado ao repositório por Git com produção automática; (d) `fastpro-api` não recebe deployment.
- **P4** Regra de parada do roteiro 44 §4 aplicada a cada resposta da Vercel (envio, listagem, painel ou log). Se o destino for "production", parar, não promover e registrar a resposta literal, sem valores.
- **P5** Nenhuma variável com escopo **Production** ou **Development**. Só escopo **Preview**.

---

## 5. Critérios de aceite (Given / When / Then)

Os comandos rodam em `D:\projetos\fastpro`, com Node 22 e pnpm via corepack. Códigos de saída e contagens vão para a Issue (comando, contagem e código de saída). Nenhum valor de credencial aparece em evidência.

**CA-158-01 — Função catch-all existe e compila.**
- **Dado** o arquivo `apps/web/api/[...caminho].ts` com o reexport do handler,
- **Quando** o build local do monorepo roda,
- **Então** sai com código `0`, sem erro de tipo, e o pacote da função inclui o handler.
- **Prova:** código de saída do build e saída de `vercel build` local (opcional, sem envio) com a lista de funções geradas.

**CA-158-02 — Configuração da web.**
- **Dado** `apps/web/vercel.json` alterado,
- **Quando** o diff é lido,
- **Então** contém `regions: ["gru1"]` e `functions` com `maxDuration: 300` para `api/**/*.ts`; os `headers` e `redirects` anteriores permanecem idênticos.
- **Prova:** `git diff` do arquivo, sem linha removida de `headers` ou `redirects`.

**CA-158-03 — Projeto da API vazio intacto.**
- **Dado** que `apps/api/vercel.json` e `apps/api/api/index.ts` não fazem parte do escopo,
- **Quando** o `git diff` é conferido,
- **Então** esses dois arquivos não aparecem alterados.
- **Prova:** `git diff --stat` sem essas linhas.

**CA-158-04 — Busca de catálogo responde no preview (happy path).**
- **Dado** o preview da branch `feature/init` publicado e acessível por HTTPS,
- **Quando** `POST /api/v1/catalog/service-search` é enviado com `Origin` igual à origem do preview (`SITE_URL`) e corpo válido,
- **Então** a resposta tem código HTTP `200`, corpo JSON com a lista de serviços e nenhuma coluna interna (`seed_key`, `council_body`, `regulation_source`, `moderation_sensitive`, `version`, `updated_by_ref`).
- **Prova:** `curl` com `--form-string` e saída em arquivo fora do repositório, código HTTP impresso. Mesma forma da saída local de #156 (CA-156-07).

**CA-158-05 — Sessão responde no preview (depende de #156 F5b).**
- **Dado** o preview publicado,
- **Quando** `POST /api/v1/auth/session` é enviado sem cookie,
- **Então** a resposta não é `404` e não tem cabeçalho `Set-Cookie`.
- **Prova:** código HTTP e cabeçalhos capturados por `curl`.

**CA-158-06 — Cookies seguros quando houver cookie (condicional).**
- **Dado** uma resposta do preview que contenha `Set-Cookie`,
- **Quando** os atributos são lidos,
- **Então** o nome tem prefixo `__Host-`, com `Secure`, `Path=/` e sem `Domain`.
- **Nota:** o happy path desta Issue (CA-158-04 e CA-158-05) não cria cookie. Este critério só é exercido se a resposta trouxer cookie; caso contrário, registrar "não exercido".

**CA-158-07 — Origem igual aceita no preview.**
- **Dado** o preview e o `SITE_URL` configurado para ele,
- **Quando** a requisição da prova usa `Origin` igual a esse `SITE_URL`,
- **Então** a resposta não é `403` com motivo de origem inválida.
- **Prova:** código HTTP do mesmo `curl` de CA-158-04.

**CA-158-08 — O envio é preview, não produção.**
- **Dado** o deployment criado,
- **Quando** consultado por leitura (painel ou CLI),
- **Então** o destino é `preview`; não há alias de produção, não há domínio adicionado e não aparece `first_deployment_production`.
- **Se** qualquer resposta indicar `production`: parar, aplicar o roteiro 44 §4 e avisar o líder.
- **Prova:** destino e lista de aliases (sem valores).

**CA-158-09 — Variáveis só no escopo Preview.**
- **Dado** a lista de variáveis do projeto `fastpro-web`,
- **Quando** lida por leitura,
- **Então** todos os nomes têm escopo `Preview` apenas; nenhum valor aparece em documento, log ou evidência.
- **Prova:** lista de nomes e escopos (sem valores).

**CA-158-10 — Sem credencial em arquivo versionado.**
- **Dado** o repositório com as alterações,
- **Quando** a varredura roda,
- **Então** `git grep -nE "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@" -- . ":!.env.local"` sai com código `1`, e `corepack pnpm check:secrets` sai com código `0`.

**CA-158-11 — Uso do plano gratuito registrado.**
- **Dado** o uso do projeto na Vercel medido antes e depois do envio e da prova,
- **Quando** comparado,
- **Então** a variação corresponde às poucas chamadas da prova, sem aviso de limite no painel.
- **Prova:** valores de uso lidos por leitura. `[NÃO VERIFICADO]` quais relatórios estão disponíveis no plano gratuito.

**CA-158-12 — Suíte local verde ao fim do trabalho.**
- **Dado** o trabalho concluído,
- **Quando** `corepack pnpm check:all` roda localmente,
- **Então** sai com código `0`. (Rodada final de QA, não por tarefa.)

---

## 6. Dependências

- **#156** (`[E0] Ambiente DEV executável`, em Aguardando aprovação): fornece F0 a F6 e F5b (sessão). Sem #156, CA-158-04 e CA-158-05 não têm o que provar.
- **#22** (`[E0] Hospedagem Vercel`, Concluído) e roteiro 44 / decisão 43: definem as pré-condições de envio e a regra de parada. O gate de envio segue sujeito a P2.
- **ADR-018**: hospedagem na Vercel (APROVADO, H1). Limites e termos `[NÃO VERIFICADO]`.
- **Desenho 177, seções 1, 5 e 7**: fonte técnica de E1 a E4. Não repetido aqui.

Esta Issue **não** tem bloqueio externo além de #156 e da autorização P2. Dependência de fila: não iniciar Desenvolvimento antes de #156 ter as fatias locais verdes.

---

## 7. Riscos

| Ref. | Risco | Mitigação |
|---|---|---|
| R-158-01 | Vercel classifica o envio como produção (projeto sem deployment anterior, branch de produção indevida ou Git ligado com produção automática). | P3 (leitura antes do envio); P4 e roteiro 44 §4 (parada imediata). |
| R-158-02 | Cookie `__Host-` só funciona com `Secure` e HTTPS. Local usa `127.0.0.1` `[NÃO VERIFICADO]` no navegador. | Preview é HTTPS por padrão; CA-158-06 é condicional e registrado no preview. |
| R-158-03 | `Origin` não bate com `SITE_URL`: cada deployment tem URL própria, e a URL muda a cada envio. | Pergunta 992 (URL estável da branch). `SITE_URL` só no escopo Preview (P5). |
| R-158-04 | Limites do plano gratuito (duração da função, tamanho do pacote com `sharp`, invocações, saída de dados) `[NÃO VERIFICADO]`. | CA-158-11; pergunta 994; `maxDuration` de 300 s pode ser recusado e o desenho prevê ajuste. |
| R-158-05 | Preview aberto na internet com o banco DEV acessível pela função. | Pergunta 993 (proteção do preview). Dados do DEV são sintéticos (#129), mas a exposição deve ser decidida. |
| R-158-06 | Catch-all não resolvido em projeto sem framework, resultando em 404 em `/api/...`. | Plano B do desenho 177 §7.1 (`api/index.ts` + `rewrites`); CA-158-04 prova a rota. |
| R-158-07 | Importação de `@fastpro/api` sem entrada pública em `exports` (P-3). Pacote da função grande (`sharp`, binário Linux). | A-158-1 para a Arquitetura; CA-158-01 e tamanho do pacote na prova. |
| R-158-08 | Dependência de #156: sem as fatias locais, a prova não existe. | Esta Issue fica na fila de Desenvolvimento até #156 ter as fatias; não é marcada como bloqueada. |
| R-158-09 | Envio automático por Git a cada push em `feature/init` gasta a cota de build `[NÃO VERIFICADO]`. | Envio controlado pelo DEV e registro do uso (CA-158-11). |
| R-158-10 | Autorização do envio (roteiro 44 §2.1) não registrada em `11-DECISOES.md`. | Pergunta 990. |

---

## 8. Perguntas ao líder (numeração a partir de 990; máximo 5)

Enviadas ao líder, não ao usuário. Cada item traz a recomendação do PO e o que destrava.

**990. Autorização escrita do envio de pré-visualização.** O que é: a permissão formal, registrada no documento, para enviar a versão de teste (preview) da API à Vercel. Por que importa: o roteiro 44 exige essa autorização antes de qualquer envio, e a decisão 43 ainda está bloqueada à espera dela. Sem registro, o envio não pode ser feito. Risco: envio sem autorização ou atraso.
- (a) Registrar em `11-DECISOES.md` a decisão do líder de autorizar o envio de **preview** da branch `feature/init` para `fastpro-web`, sob a regra de parada do roteiro 44 §4. **Recomendado**: a decisão deste pedido já expressa o caminho, e a regra de parada cobre o risco de produção.
- (b) Aguardar resposta escrita do dono antes do envio (Issue fica na fila, sem bloqueio).
- (c) Fazer só a parte local (build e inspeção sem envio) e adiar o envio.
- Destrava: E6, CA-158-04 a CA-158-09.

**991. Variáveis do preview e acesso ao banco DEV.** O que é: as chaves e endereços que a função usa para falar com o banco de desenvolvimento, guardadas só no preview. Por que importa: sem elas a busca e a sessão não respondem de verdade; com elas o preview acessa o banco DEV. Risco: credencial fora do lugar certo.
- (a) Ligar o escopo Preview ao banco DEV, com valores só pela CLI ou MCP da Vercel, e provar busca e sessão. **Recomendado**: é o caminho que prova o happy path pedido, e o banco é de desenvolvimento autorizado.
- (b) Preview sem banco: prova só de que a função sobe e responde com código controlado (não prova o caminho feliz).
- (c) Adiar a prova do preview para depois de #156 estar aprovada.
- Destrava: E4, CA-158-04 e CA-158-05.

**992. Endereço usado como origem do preview (`SITE_URL`).** O que é: o endereço da web que a API aceita como origem válida. Por que importa: cada envio de preview tem um endereço próprio; se o endereço mudar, a prova falha. Risco: falso 403 em todas as rotas.
- (a) Endereço estável da branch `feature/init` (formato de endereço de branch da Vercel) `[NÃO VERIFICADO]` que a Vercel gera. **Recomendado**: não muda a cada envio.
- (b) Endereço de cada deployment, atualizado a cada envio.
- (c) Domínio próprio: fora de escopo (proibido nesta Issue).
- Destrava: CA-158-04 e CA-158-07.

**993. Proteção de acesso ao preview.** O que é: se o endereço de teste fica aberto na internet ou exige login da Vercel. Por que importa: o preview fala com o banco DEV; aberto, qualquer pessoa com o endereço pode consultar a API. Risco: exposição de dados de desenvolvimento e consumo de cota por terceiros.
- (a) Exigir login da Vercel ou contorno por segredo guardado fora dos documentos. **Recomendado**: reduz a exposição. `[NÃO VERIFICADO]` se o plano gratuito oferece essa proteção; se não oferecer, a alternativa (b) passa a valer e o registro vai para a Arquitetura.
- (b) Aberto, com indexação bloqueada (cabeçalho `noindex` já existe na web).
- (c) Nenhum preview até o banco DEV ser desligado do preview (adia a prova).
- Destrava: CA-158-04 (acesso à prova) e a decisão de segurança do envio.

**994. Limite do plano gratuito.** O que é: o teto de uso (tempo de execução, chamadas, transferência de dados) que a Vercel permite sem cobrança. Por que importa: passar do teto pode pausar o preview ou gerar cobrança se o plano mudar. Risco: interrupção ou cobrança inesperada. Os números não foram verificados nesta rodada.
- (a) Medir o uso antes e depois (CA-158-11); se o uso passar de 80% do teto mostrado no painel, parar e avisar o líder. **Recomendado**: sem gasto automático.
- (b) Seguir sem medir e corrigir só se houver aviso.
- (c) Reduzir a duração máxima já para 60 s, para ficar abaixo de qualquer limite do plano gratuito.
- Destrava: E2 (duração) e a prova de uso.

---

## 9. Recomendações técnicas para a Arquitetura (não são perguntas)

1. Confirmar o roteamento do catch-all em projeto sem framework; se falhar, usar o plano B do desenho 177 §7.1 dentro do limite de tentativas.
2. Resolver a importação do handler (A-158-1, P-3): entrada nova em `exports` de `@fastpro/api` ou outra forma. Não importar arquivo-fonte `.ts` por caminho relativo.
3. Confirmar o comando de build da raiz que o CA-158-01 usa (`package.json` da raiz não lido nesta rodada).
4. Decidir se `apps/api/package.json` (descrição e `exports`) muda; o desenho 177 não prevê alteração nele, mas a importação de E1 pode exigir.
5. Antes do envio, executar P3 por leitura da Vercel (MCP ou CLI), sem escrita.

## 10. Veto e adoção

Nenhuma decisão foi adotada por este refino. As recomendações acima entram como "adotadas pelo líder" somente se o líder confirmar em `11-DECISOES.md`, com numeração 990 a 994.
