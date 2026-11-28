# Refino de Product Owner — Issue #149: check:all vermelho no repositório (E15)

- **Issue:** #149 `[E15] check:all vermelho no repositório (hex, secrets, logs, boundaries, typography)`
- **Épico:** `[E15] Qualidade, Tooling, Linha de Base e Integridade do Monorepo`
- **Workflow:** WF-03 (Feature / Engenharia / Qualidade)
- **Etapa:** Product Owner (primeira coluna do quadro)
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`
- **Data:** 2026-11-19
- **EXEC-ID:** não atribuído (execução direta de refino)
- **Natureza:** SOMENTE DOCUMENTO. Nenhum código, migração, script, comando DDL/DML contra banco de dados ou alteração no quadro foi realizado nesta etapa.
- **Etiquetas de rastreabilidade:**
  - `[DECIDIDO]` decisão aprovada pelo usuário ou líder, com número ou rodada em `11-DECISOES.md`
  - `[VERIFICADO]` inspecionado diretamente no repositório, nos scripts ou no quadro
  - `[PROPOSTA]` recomendação deste refino para o Arquiteto e Desenvolvedor
  - `[NÃO VERIFICADO]` item não inspecionado nesta rodada

---

## 0. Fontes e limitações

### Fontes consultadas no repositório
1. `docs/factory/11-DECISOES.md`:
   - Decisões estruturais do usuário: 44 e 45 (fluxo de branches em `feature/init`, sem Docker, banco na nuvem), 148 (autorização de triagem de engenharia), 150 (rotação de senhas DEV), 158 (remoção do histórico de fotos), 239 e Rodada 74 (Mapbox real proibido; provedores simulados apenas), 349 a 358 (backup de dados totalmente fora do escopo do produto; Issue #151 concluída).
   - Decisões do líder sobre `check:all`, linha de base e triagem:
     - Rodada 59 (linha 602): registro do fato novo de `check:all` vermelho (hex 33, secrets 89, logs 10, boundaries 2, typography 2).
     - Rodada 60 (linhas 610, 614, 615): criação formal da Issue #149 para isolar a linha de base vermelha das histórias funcionais (#141, #119); registro de falsos positivos de `service_role` em testes H-110 e decisão sobre localização de leitura de Storage.
     - Rodadas 65, 71, 72: acompanhamento da triagem #140 no banco DEV.
     - Rodada 80/81 (linhas 805, 839): decisão de que o falso positivo de `check:logs` (caminhos com `/console/`) é escopo da Issue #149.
     - Rodada 107/118 (linhas 880, 925): avanço de histórias (#46, #53) com `check:all` vermelho registrado sob cobertura da Issue #149.
     - Rodada 126 (linha 918): registro de que o `eslint.config.mjs` ignora indevidamente `**/coverage/**` no domínio, devendo a restrição à raiz ser tratada na Issue #149.
2. `docs/factory/111-REFINO-TRIAGEM-DBTEST.md` e `docs/factory/112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`:
   - Princípios de triagem: segregação entre falhas de código de produção, resíduos do DEV, testes desatualizados, fixtures dependentes do estado e falsos positivos de verificadores estáticos.
   - Resolução das Issues correlatas #140, #145, #146, #147 e #148.
3. `package.json` raiz e scripts de verificação:
   - `scripts/check-hex.mjs`
   - `scripts/check-typography.mjs`
   - `scripts/check-module-boundaries.mjs`
   - `scripts/check-logs.mjs`
   - `scripts/check-secrets.mjs`
   - `scripts/check-workspace-deps.mjs`
   - `scripts/check-env-example.mjs`
   - `scripts/check-no-attachments.mjs`
   - `eslint.config.mjs`
4. Tokens e estilos:
   - `apps/web/public/tokens.css`
   - `apps/web/public/codigo.css`
5. `docs/factory/quadro-status.md` e `docs/factory/quadro-execucao.json`.

### Limitações declaradas `[NÃO VERIFICADO]`
- Nenhum acesso a redes externas ou comando `gh` foi executado. O texto da Issue #149 no GitHub não foi lido por comando de rede; todo o contexto foi reconstruído a partir do histórico registrado em `11-DECISOES.md` e dos scripts versionados.
- Nenhum comando de banco de dados (DDL/DML, migração ou consulta) foi executado contra o banco DEV.
- Nenhum arquivo de código de produção, teste, script ou configuração foi alterado nesta etapa de refino de PO.
- Não há utilização de Docker, Mapbox real, envio de e-mail real nem qualquer mecanismo de backup de dados.

---

## 1. Verificação de fila e dependências reais no quadro

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue **#149** (`[E15] check:all vermelho no repositório (hex, secrets, logs, boundaries, typography)`) na coluna **Product Owner (5)**. A etapa de refino de PO é a etapa correta e devida.
- `[VERIFICADO]` **Dependências reais conferidas no quadro:**
  - A Issue #149 é uma história técnica autônoma de integridade do monorepo e infraestrutura de testes/qualidade (Épico E15).
  - Ela **não depende** de novas migrações de banco nem de histórias funcionais pendentes para ser refinada e executada.
  - As histórias que originaram as violações da linha de base já concluíram suas fases principais de desenvolvimento e QA (#141, #119, #50, #52, #44, #45, #46, #58, #59, #150, #151).
  - O saneamento da Issue #149 é **dependência habilitadora crítica** para:
    1. O encerramento limpo dos gates de QA de histórias futuras (evitando aprovações com ressalvas constantes de `check:all vermelho`).
    2. A execução rigorosa do **Gate M4** e da Issue **#130** (`Gate de release do MVP web`), que exigem pipeline de verificação estática verde sem exceções.

---

## 2. Objetivo

Eliminar todas as falhas e inconsistências do comando unificado `pnpm check:all` na branch `feature/init`, alcançando **código de saída 0 (100% verde)** de forma determinística, estável e reproduzível localmente.

Para isso, o objetivo desdobra-se em três frentes:
1. **Sanear os falsos positivos estruturais dos scripts de verificação estática** (`check-hex.mjs`, `check-logs.mjs`, `check-secrets.mjs`, `check-module-boundaries.mjs`), refinando suas heurísticas para que não classifiquem erradamente comentários textuais com números de Issues, rotas web `/console`, constantes com nomes de rotas ou testes de privilégios de banco.
2. **Corrigir violações reais de código e estilos**, em especial a aderência estrita aos tokens de tipografia do EDS (Design System) em `apps/web/public/codigo.css` (substituindo `system-ui` e peso `600` pelos tokens oficiais).
3. **Corrigir a configuração do ESLint** (`eslint.config.mjs`) para restringir a exclusão de `coverage` à raiz (`coverage/**`), garantindo que o módulo de domínio `packages/domain/src/coverage/` (regras de cobertura de serviços, H-024) e seus testes sejam inspecionados pelo linter.

---

## 3. Escopo e Fora de Escopo

### Dentro do escopo
1. **Auditoria e correção das 5 frentes com falha em `pnpm check:all`:**
   - **`check:hex` (20 violações):** sanear os falsos positivos causados por menções a Issues em comentários (ex.: `#105`, `#108`, `#109`, `#114`, `#118`, `#140`, `#141`) e referências semelhantes, mantendo a proibição estrita de valores hexadecimais de cor (#rgb, #rrggbb, etc.) fora de `packages/tokens`.
   - **`check:typography` (2 violações):** corrigir `apps/web/public/codigo.css` para utilizar a família tipográfica oficial Roboto (`var(--font-family)`) e pesos permitidos 400, 500 ou 700 (`var(--font-weight-medium)` / `var(--font-weight-bold)`), eliminando `system-ui` e peso `600`.
   - **`check:boundaries` (3 violações):** sanear a importação de `node:fs` em 3 arquivos de teste de `packages/domain/tests/` (`eligibility-professional-access.test.ts`, `h097-cota-login.test.ts`, `role-exclusivity.test.ts`), garantindo que a regra de que o domínio não faz I/O incida estritamente sobre o código de produção (`packages/domain/src/`) ou adequando os testes de conformidade estática.
   - **`check:logs` (15 violações):** sanear os falsos positivos onde o termo `console` ocorre como parte de caminho de URL (`/console`, `/console/operacao`, `/console/verificacao`), nome de arquivo (`console.ts`, `console-state.ts`) ou rota administrativa (`admin-console-route.js`), mantendo a detecção rigorosa de chamadas ao objeto global `console` (como `console.log`, `console.error`) e garantindo o uso exclusivo do logger em produção.
   - **`check:secrets` (70 violações):** sanear as violações categorizadas:
     - Permitir a citação ao nome do papel de banco `service_role` nos testes de integração e migração de banco (`packages/db/tests/`) e arquivos de montagem autorizados, onde o teste apenas verifica privilégios ou revogações de banco.
     - Isolar nomes de variáveis que contêm palavras reservadas mas representam rotas ou regexes (ex.: `PROFESSIONAL_PASSWORD_CHANGE_PATH`, `PASSWORD_RECOVERY_PATH`, `TOKEN_RE`).
     - Adequar sentinelas de teste em testes de API e banco para utilizarem o padrão oficial de placeholder (`<placeholder>`, `<senha>`, `dummy-...`) reconhecido pelo verificador.
     - Ajustar menções documentais a URLs de banco fictícias em relatórios de triagem (`112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`).
2. **Correção da exclusão no ESLint (`eslint.config.mjs`):**
   - Substituir `'**/coverage/**'` por `'coverage/**'` na lista de `ignores` do ESLint raiz, assegurando que o código de domínio de cobertura (`packages/domain/src/coverage/`) seja devidamente analisado pelo linter.
3. **Validação estática e de testes:**
   - Garantir que todos os 8 verificadores individuais (`check:deps`, `check:hex`, `check:typography`, `check:env`, `check:boundaries`, `check:attachments`, `check:logs`, `check:secrets`) e o agregador `pnpm check:all` retornem código de saída 0.
   - Garantir que a suíte de testes unitários dos scripts (`pnpm test:scripts`) permaneça verde.
   - Garantir que `pnpm lint` e `pnpm typecheck` permaneçam verdes.

### Fora do escopo
1. **Sem alteração de banco:** nenhuma criação, alteração ou exclusão de tabela, coluna, gatilho, índice, função ou migração SQL no banco DEV.
2. **Sem Docker:** não utilizar nem configurar containers Docker em nenhuma hipótese `[DECIDIDO: Rodada 17]`.
3. **Sem Mapbox real:** nenhum consumo de API externa da Mapbox, nenhum token real em arquivos versionados ou variáveis locais `[DECIDIDO: Rodada 74]`.
4. **Sem envio real de e-mail:** nenhum e-mail é disparado para provedores externos; o Resend opera apenas em mock nos testes `[DECIDIDO: Rodada 7]`.
5. **Sem backup de dados:** nenhuma inclusão, teste ou implementação de rotinas de cópia/backup de dados, que foram definitivamente extirpadas do escopo `[DECIDIDO: Rodadas 73 e 75, Issue #151]`.
6. **Sem afrouxamento da segurança real:** não desativar regras de detecção de segredos reais, nem permitir chaves RSA/EC, JWTs reais, chaves de API reais do Mercado Pago/Resend/Supabase ou credenciais reais versionadas.
7. **Sem alteração em regras de negócio funcionais:** o escopo é estritamente de integridade de código, conformidade estática, tipografia e linters.

---

## 4. Regras Mandatórias de Execução

- **R-01 (Sem Docker):** O desenvolvimento e os testes rodam diretamente no ambiente Windows local, com runtime Node.js nativo (v22+) e gerenciador pnpm via corepack.
- **R-02 (Sem Mapbox real):** Todas as validações utilizam exclusivamente mocks e portas simuladas (`MAPBOX_ACCESS_TOKEN` e `MAPBOX_PUBLIC_TOKEN` permanecem ausentes ou simulados; código 503 uniforme quando sem provedor).
- **R-03 (Sem e-mail real):** Nenhum envio real via SMTP ou HTTP para o Resend; suítes executam apenas com adaptadores em memória ou mock.
- **R-04 (Sem backup de dados):** O projeto não contém rotinas de backup ou restauração de cópias de dados (Issue #151 concluída).
- **R-05 (Isolamento de segredos):** Segredos reais e URLs do banco DEV residem exclusivamente em `.env.local` (ignorado pelo git). Nenhum valor confidencial é gravado em arquivos versionados, logs, commits ou saídas de terminal.
- **R-06 (Branch única de trabalho):** Todo o trabalho é realizado diretamente na branch `feature/init` `[DECIDIDO: Rodada 17]`.
- **R-07 (Commits atômicos e cirúrgicos):** Cada commit afeta estritamente os arquivos da Issue, precedido por `git diff --cached --stat` e nomeado no padrão semântico do projeto (`fix(E15): ... (#149)`).

---

## 5. Diagnóstico Detalhado das Frentes de Falha

| Frente | Comando | Falhas Atuais | Natureza Principal | Causa Raiz Verificada | Ação Recomendada |
|---|---|---|---|---|---|
| **1. Hex** | `pnpm check:hex` | 20 violações | Falso positivo | A regex `/#(?:[0-9a-fA-F]{3,8})/` casa comentários com números de Issues como `#105`, `#108`, `#109`, `#114`, `#118`, `#140`, `#141` porque dígitos 0-9 são dígitos hexadecimais válidos. | Refinar a regex do verificador para desconsiderar comentários que contenham números de Issues (ex.: `Issue #\d+`, `(#\d+)`, `H-\d+`), ou desconsiderar ocorrências em comentários de linha/bloco que não definam atributos de estilo CSS, preservando a detecção em literais de estilo. |
| **2. Tipografia** | `pnpm check:typography` | 2 violações | Violação real | O arquivo `apps/web/public/codigo.css` usa `font-family: system-ui, sans-serif;` (linha 7) e `font-weight: 600;` (linha 30), violando as diretrizes do EDS. | Substituir em `codigo.css` por `font-family: var(--font-family);` (ou `Roboto, sans-serif`) e `font-weight: var(--font-weight-medium);` / `var(--font-weight-bold);` (pesos 500 ou 700). |
| **3. Fronteiras** | `pnpm check:boundaries` | 3 violações | Heurística excessivamente ampla | `check-module-boundaries.mjs` proíbe I/O (`node:fs`) em qualquer arquivo de `packages/domain/`, atingindo arquivos em `packages/domain/tests/` que usam `readFileSync` apenas para validar conformidade de arquivos estáticos. | Restringir a proibição de módulos de I/O (`IO_MODULES`) para o código de produção (`packages/domain/src/`), permitindo que a suíte de testes de domínio valide artefatos estáticos quando necessário, OU reescrever esses 3 testes para não necessitarem de leitura via `fs`. |
| **4. Logs** | `pnpm check:logs` | 15 violações | Falso positivo | A regex `CONSOLE = /(?<![\w$.'"`])console\b/` casa qualquer ocorrência da palavra `console` antecedida por `/` (como `/console/catalogo`, `/console/operacao`, `redirect('/console')`) ou hífen (`admin-console-route`), mesmo sendo strings de rotas ou caminhos de arquivo. | Refinar a regex para assegurar que `console` não seja casado quando estiver dentro de literais de string representando URLs/caminhos de arquivo (`'/console...'`, `"/console..."`, `` `/console...` ``), em declarações de import de módulos locais, ou como parte de identificadores com hífen. |
| **5. Segredos** | `pnpm check:secrets` | 70 violações | Misto (falso positivo e mocks em testes) | 1. Testes de banco em `packages/db/tests/` que testam privilégios do papel `service_role` disparam 'referência a service_role fora de módulo permitido'.<br>2. Variáveis de rota `*_PATH` contendo a palavra `PASSWORD` disparam 'valor atribuído a PASSWORD...'.<br>3. Mocks e sentinelas de teste sem o prefixo oficial `<placeholder>`.<br>4. Regex de tokens `TOKEN_RE` casada como atribuição sensível. | 1. Incluir `packages/db/tests/` e caminhos de montagem autorizados em `SERVICE_ROLE_ALLOWED`.<br>2. Ajustar `check-secrets.mjs` para ignorar variáveis terminadas em `_PATH`, `_URL`, `_ROUTE`, `_RE`, `_REGEX`.<br>3. Padronizar valores sentinela de testes com o prefixo `<...>` (como `<placeholder-secret>`).<br>4. Ajustar URL fictícia em documento de triagem. |
| **6. ESLint** | `pnpm lint` | 0 erros atuais, mas omissão de auditoria | Defeito de configuração | `eslint.config.mjs` possui `ignores: [..., '**/coverage/**']`, ignorando indevidamente a pasta de domínio `packages/domain/src/coverage/` (regras de cobertura de profissionais, Issue #37/H-024). | Restringir a regra de ignore no `eslint.config.mjs` para `'coverage/**'` (raiz do repositório), fazendo com que `packages/domain/src/coverage/` seja inspecionado pelo linter normalmente. |

---

## 6. Critérios de Aceite Numerados e Testáveis (Given / When / Then)

### CA-149-01: Verificação de tipografia conforme Design System (EDS)
- **Given** o arquivo de folha de estilo `apps/web/public/codigo.css` da tela do código de 6 dígitos;
- **When** o verificador de tipografia for executado;
- **Then** nenhuma declaração de `font-family` deve estar fora de Roboto / `var(--font-family)`, e nenhum `font-weight` deve estar fora de 400, 500, 700 ou tokens correspondentes do EDS;
- **Prova:** Execução de `pnpm check:typography` no terminal PowerShell retornando código de saída `0` e mensagem `check-typography ok`.

---

### CA-149-02: Eliminação de falsos positivos de cor hexadecimal (`check:hex`)
- **Given** a árvore de arquivos versionados contendo comentários com referências a Issues (como `#105`, `#114`, `#118`, `#140`, `#141`) e descrições textuais;
- **When** o comando `pnpm check:hex` for executado na raiz do monorepo;
- **Then** nenhuma violação espúria deve ser apontada para referências a números de Issues ou commits em comentários de código ou testes, mantendo-se a reprovação de qualquer código de cor hexadecimal (#rgb, #rrggbb) fora de `packages/tokens`;
- **Prova:** Execução de `pnpm check:hex` no terminal PowerShell retornando código de saída `0` e mensagem `check-hex ok`.

---

### CA-149-03: Respeito às fronteiras de módulo e isolamento de I/O (`check:boundaries`)
- **Given** o pacote `packages/domain` contendo a lógica pura de negócio em `packages/domain/src/` e suas suítes de teste em `packages/domain/tests/`;
- **When** o verificador de fronteiras de módulo for executado;
- **Then** nenhum arquivo em `packages/domain/src/` deve importar módulos de I/O (`fs`, `net`, `pg`, `http`, etc.), e a suíte de testes de conformidade não deve disparar falsos positivos de fronteira;
- **Prova:** Execução de `pnpm check:boundaries` no terminal PowerShell retornando código de saída `0` e mensagem `check-module-boundaries ok`.

---

### CA-149-04: Eliminação de falsos positivos de rotas e caminhos no verificador de logs (`check:logs`)
- **Given** os arquivos de código de produção em `apps/admin/src/`, `apps/api/src/` e `packages/domain/src/` contendo caminhos de rotas e imports com `/console`;
- **When** o comando `pnpm check:logs` for executado na raiz do monorepo;
- **Then** nenhuma violação deve ser apontada para o uso da palavra `console` como parte de URLs web, rotas do servidor Next.js ou nomes de arquivos locais, enquanto qualquer chamada real a métodos do objeto JavaScript global `console` (como `console.log`, `console.error`, `console.warn`) fora dos sinks autorizados continua sendo estritamente reprovada;
- **Prova:** Execução de `pnpm check:logs` no terminal PowerShell retornando código de saída `0` e mensagem `check-logs ok`.

---

### CA-149-05: Saneamento do Secret Scanning e permissão de testes de banco (`check:secrets`)
- **Given** o verificador próprio de segredos em `scripts/check-secrets.mjs`;
- **When** o comando `pnpm check:secrets` for executado em todos os arquivos versionados;
- **Then** o verificador não deve apontar violações para:
  1. O nome do papel PostgreSQL `'service_role'` quando referenciado dentro de arquivos de teste de privilégios em `packages/db/tests/` e locais de montagem permitidos;
  2. Nomes de constantes que definem caminhos de rotas (como `PROFESSIONAL_PASSWORD_CHANGE_PATH`, `PASSWORD_RECOVERY_PATH`);
  3. Constantes de expressões regulares (como `TOKEN_RE`);
  4. Sentinelas de teste que adotam placeholders padronizados (`<placeholder>`, `<senha>`, etc.);
  5. URLs de exemplo sem credenciais reais em documentações aprovadas;
- **E** deve manter 100% da eficácia na detecção de chaves privadas reais, tokens do GitHub, JWTs, chaves de API reais e URLs reais de banco com senha;
- **Prova:** Execução de `pnpm check:secrets` no terminal PowerShell retornando código de saída `0` e mensagem `check-secrets ok`.

---

### CA-149-06: Verificação agregada de qualidade unificada (`check:all`)
- **Given** todos os 8 verificadores estáticos do monorepo (`check:deps`, `check:hex`, `check:typography`, `check:env`, `check:boundaries`, `check:attachments`, `check:logs`, `check:secrets`);
- **When** o comando agregador `pnpm check:all` for executado na raiz do monorepo;
- **Then** todos os verificadores devem rodar sequencialmente, todos devem reportar sucesso (`ok`), e o comando unificado deve encerrar com código de saída `0`;
- **Prova:** Execução de `pnpm check:all` no PowerShell retornando código `0` sem qualquer mensagem de erro.

---

### CA-149-07: Inclusão de `packages/domain/src/coverage/` na inspeção do ESLint
- **Given** o arquivo de configuração raiz `eslint.config.mjs` e os arquivos de regras de cobertura de profissionais em `packages/domain/src/coverage/`;
- **When** o comando `pnpm lint` for executado;
- **Then** a pasta de cobertura de domínio `packages/domain/src/coverage/` e seus testes `packages/domain/tests/coverage-*.test.ts` devem ser ativamente inspecionados pelo ESLint (não ignorados), e devem passar com zero erros e zero avisos de lint;
- **Prova:** Execução de `pnpm eslint packages/domain/src/coverage` e `pnpm lint` retornando código de saída `0`.

---

### CA-149-08: Não regressão das suítes de testes dos scripts e testes unitários
- **Given** as correções aplicadas aos scripts de verificação em `scripts/`;
- **When** a suíte de testes dos scripts for executada;
- **Then** todos os testes automatizados de `scripts/__tests__/*.test.mjs` devem passar com sucesso;
- **Prova:** Execução de `pnpm test:scripts` no PowerShell retornando código de saída `0`.

---

### CA-149-09: Isolamento de segredos reais e ausência de dados em arquivos versionados
- **Given** qualquer arquivo alterado ou adicionado no escopo da Issue #149;
- **When** inspecionado o `git diff` antes do commit;
- **Then** nenhum segredo real, chave de API, senha de banco de dados ou dado de produção deve estar presente, e nenhuma linha em `.env.local` deve ter sido versionada;
- **Prova:** `git status -s` confirmando que `.env.local` permanece desconsiderado e `git diff --cached` sem valores sensíveis.

---

### CA-149-10: Ausência de impacto em banco de dados e inexistência de Docker
- **Given** a execução completa da Issue #149;
- **When** verificado o estado das migrações e do repositório;
- **Then** nenhuma migração SQL deve ter sido criada ou alterada, nenhuma tabela/coluna/função de banco foi modificada, e nenhum container ou configuração Docker foi introduzido;
- **Prova:** `git status` demonstrando que `supabase/migrations/` permanece inalterado, e ausência de qualquer arquivo `Dockerfile` ou `docker-compose.yml`.

---

## 7. Riscos e Mitigações

| ID | Risco | Severidade | Probabilidade | Mitigação Obrigatória |
|---|---|---|---|---|
| **R-149-1** | Afrouxamento indevido no `check:secrets`, permitindo que credenciais reais passem despercebidas. | Alta | Baixa | Apenas permitir referências textuais conhecidas e controladas (como a string literal `'service_role'` em `packages/db/tests/` e variáveis com sufixo `_PATH`/`_RE`), sem alterar a regex de detecção de segredos reais (chaves privadas, JWTs, chaves Supabase `sb_secret_`, etc.). Validar com a suíte `pnpm test:scripts`. |
| **R-149-2** | Enfraquecimento no `check:logs`, permitindo que chamadas `console.log()` passem em código de produção. | Média | Baixa | A exceção deve ser restrita a literais de string (URLs/caminhos iniciando com `/console`) e imports locais; qualquer identificador `console` chamado como função ou objeto (`console.log`, `console.error`) continua sendo rejeitado taxativamente. |
| **R-149-3** | Quebra de testes de domínio ao remover ou alterar `readFileSync` em `packages/domain/tests/`. | Baixa | Média | Se os testes continuarem usando `readFileSync` para validar conformidade estática, a regra do verificador `check-module-boundaries.mjs` deve ser delimitada a `packages/domain/src/` (código de produção puro), onde o I/O é terminantemente proibido. |
| **R-149-4** | Regressão visual na tela de código de 6 dígitos ao alterar tipografia em `codigo.css`. | Baixa | Baixa | Utilizar exatamente os tokens CSS já existentes em `apps/web/public/tokens.css` (`--font-family: 'Roboto', sans-serif;` e `--font-weight-medium: 500;`), garantindo fidelidade estrita ao Design System (EDS) sem desalinhamentos. |
| **R-149-5** | Aparecimento de novos erros de lint ao desmascarar `packages/domain/src/coverage/` no ESLint. | Média | Baixa | Rodar `eslint packages/domain/src/coverage/` imediatamente após o ajuste e resolver eventuais pendências de estilo/formatação antes do commit da Issue. |

---

## 8. Perguntas ao Líder com Recomendação

> As perguntas abaixo seguem a numeração contínua solicitada (a partir de 800). O canal único de comunicação é o relatório ao Orquestrador/líder, que adota as recomendações propostas.

### Pergunta 800: Ajuste da Heurística de `check:hex` para Números de Issues em Comentários
- **Contexto:** A regex atual de `scripts/check-hex.mjs` considera `#` seguido de 3, 4, 6 ou 8 dígitos hexadecimais como cor. Como números 0-9 são válidos em hexadecimal, qualquer menção a Issues como `#105`, `#108`, `#109`, `#114`, `#118`, `#140`, `#141` em comentários gera falso positivo.
- **Alternativa A (Recomendada):** Ajustar `scripts/check-hex.mjs` para ignorar padrões de numeração de Issues (ex.: `Issue #\d+`, `(#\d+)`, `#\d+\b` precedido ou seguido de contexto textual ou em comentários de linha `//`), mantendo a rejeição para propriedades de cor CSS e atributos de estilo.
- **Alternativa B:** Trocar manualmente todas as ocorrências de `#<numero>` em comentários de código e testes para a palavra `Issue <numero>`.
- **Recomendação:** **Alternativa A.** Resolver na ferramenta de verificação evita que futuros desenvolvedores ou agentes sejam continuamente bloqueados por simplesmente citarem o número de uma Issue ou história em seus comentários.

---

### Pergunta 801: Delimitação de Escopo de I/O em `check:module-boundaries` para `packages/domain`
- **Contexto:** A regra arquitetural define que o domínio não faz I/O. O script `scripts/check-module-boundaries.mjs` atualmente bloqueia `node:fs` em qualquer arquivo sob `packages/domain/`, impedindo que 3 arquivos em `packages/domain/tests/` leiam arquivos para testes de conformidade estática.
- **Alternativa A (Recomendada):** Restringir a verificação de `IO_MODULES` em `packages/domain/` para incidir exclusivamente sobre `packages/domain/src/` (código de produção), mantendo `packages/domain/tests/` livre para asserções de metadados, desde que não importem apps.
- **Alternativa B:** Reescrever os 3 testes em `packages/domain/tests/` para eliminar a leitura de arquivos via `node:fs` (ou migrá-los para `scripts/__tests__/`).
- **Recomendação:** **Alternativa A.** O princípio de "domínio sem I/O" é uma restrição de arquitetura de software para o runtime da aplicação (`src/`), não uma proibição para asserções estruturais em suítes de teste de unidade.

---

### Pergunta 802: Refinamento de `check:logs` para Rotas e Identificadores contendo `/console`
- **Contexto:** O script `scripts/check-logs.mjs` acusa violação na presença do termo `console` mesmo quando ele faz parte de strings de rotas (`/console`, `/v1/admin/console/menu`), imports de componentes Next.js ou arquivos como `admin-console-route.js`.
- **Alternativa A (Recomendada):** Refinar a regex `CONSOLE` em `scripts/check-logs.mjs` para assegurar que apenas referências ao identificador JavaScript `console` (como invocação de método `console.<metodo>` ou acesso indexado `console[...]`) sejam reprovadas, ignorando a ocorrência da palavra dentro de strings literais de rotas (iniciadas por `/`) ou nomes de módulos/arquivos locais.
- **Alternativa B:** Inserir comentários `// check-logs:ignore rota-console` em cada uma das 15 linhas afetadas.
- **Recomendação:** **Alternativa A.** Conforme já antecipado e decidido pelo líder em `11-DECISOES.md` (Rodada 80/81, linhas 805 e 839: "ajustar a regra sem enfraquecê-la"), o ajuste direto na heurística do script resolve a causa raiz e previne novos falsos positivos na expansão do console administrativo.

---

### Pergunta 803: Inclusão de `packages/db/tests/` em `SERVICE_ROLE_ALLOWED` em `check:secrets`
- **Contexto:** O papel PostgreSQL `service_role` é inspecionado e testado em diversos arquivos de `packages/db/tests/` para verificar revogações de privilégios e tabelas protegidas. O script `check-secrets.mjs` atualmente dispara "referência a service_role fora de módulo permitido" nesses testes.
- **Alternativa A (Recomendada):** Adicionar `'packages/db/tests/'` e o diretório de identidade `'apps/api/src/identity-docs/'` (ou caminho correspondente) à lista `SERVICE_ROLE_ALLOWED` em `scripts/check-secrets.mjs`.
- **Alternativa B:** Ofuscar a palavra `service_role` nos testes de banco (ex.: concatenar `'service_' + 'role'`).
- **Recomendação:** **Alternativa A.** Testes de permissões e segurança de banco precisam explicitamente testar o papel `service_role`. Permitir a pasta de testes de banco é seguro e transparente.

---

### Pergunta 804: Exceção para Nomes de Constantes de Rotas e Regexes em `check:secrets`
- **Contexto:** Constantes como `PROFESSIONAL_PASSWORD_CHANGE_PATH`, `PASSWORD_RECOVERY_PATH` e `TOKEN_RE` disparam falso positivo de secret scanning porque seus nomes contêm `PASSWORD` ou `TOKEN`, embora seus valores sejam caminhos de URL ou expressões regulares.
- **Alternativa A (Recomendada):** No verificador de atribuições de `scripts/check-secrets.mjs`, ignorar identificadores que terminam com sufixos conhecidos de rotas ou expressões (`_PATH`, `_URL`, `_ROUTE`, `_RE`, `_REGEX`).
- **Alternativa B:** Renomear as variáveis de rotas para nomes que não contenham as palavras `PASSWORD` ou `TOKEN`.
- **Recomendação:** **Alternativa A.** Garante legibilidade do código de rotas e elimina o falso positivo de maneira robusta.

---

### Pergunta 805: Padronização de Sentinelas de Mocks em Testes de API e Banco
- **Contexto:** Alguns testes unitários em `apps/api/tests/` e `packages/db/tests/` usam sentinelas de teste (como `PEPPER_EMAIL`, `key_hmac`, etc.) que não usam o formato de placeholder reconhecido pelo `check-secrets.mjs` (`<...>` ou `dummy-...`).
- **Alternativa A (Recomendada):** Adequar as sentinelas e mocks dos arquivos de teste afetados para o padrão de placeholder aceito pelo verificador (ex.: `'<pepper-email-test>'`, `'<dummy-api-key>'`).
- **Alternativa B:** Desativar a checagem de atribuições nos arquivos de teste.
- **Recomendação:** **Alternativa A.** Mantém o rigor do scanner de segredos sobre arquivos de teste, ensinando o padrão correto de mocks sem desabilitar a proteção.

---

### Pergunta 806: Correção de Tipografia em `apps/web/public/codigo.css`
- **Contexto:** `apps/web/public/codigo.css` viola o Design System ao declarar `font-family: system-ui, sans-serif;` e `font-weight: 600;`.
- **Alternativa A (Recomendada):** Atualizar `apps/web/public/codigo.css` para utilizar os tokens já definidos em `tokens.css`: `font-family: var(--font-family);` e `font-weight: var(--font-weight-medium);` (500) ou `var(--font-weight-bold);` (700) no label.
- **Alternativa B:** Adicionar exceção para `codigo.css` no script `check-typography.mjs`.
- **Recomendação:** **Alternativa A.** O produto deve seguir rigorosamente o Design System aprovado (Roboto e pesos 400/500/700).

---

### Pergunta 807: Restrição de Ignore de `coverage` no `eslint.config.mjs`
- **Contexto:** Conforme registrado na Rodada 126 de `11-DECISOES.md` (linha 918), a raiz do ESLint ignora `'**/coverage/**'`, omitindo a análise das regras de cobertura de serviços do domínio em `packages/domain/src/coverage/`.
- **Alternativa A (Recomendada):** Substituir `'**/coverage/**'` por `'coverage/**'` no array `ignores` de `eslint.config.mjs`, garantindo que apenas a pasta de cobertura da raiz seja ignorada, enquanto `packages/domain/src/coverage/` e seus testes passam a ser auditados normalmente.
- **Alternativa B:** Manter como está e criar uma configuração de ESLint separada para `packages/domain`.
- **Recomendação:** **Alternativa A.** É a decisão já delineada pelo líder na Rodada 126, simples e limpa.

---

### Pergunta 808: URL de Banco Fictícia em `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`
- **Contexto:** O documento `docs/factory/112-TRIAGEM-DBTEST-LINHA-DE-BASE.md` na linha 207 contém o texto explicativo `postgres://usuario:senha@host/db`. O `check-secrets.mjs` reporta isso como violação porque a palavra `senha` tem 5 letras e não casa a lista de placeholders esperada (`password|xxx|changeme|*+`).
- **Alternativa A (Recomendada):** Substituir o exemplo em `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md:207` por `postgres://usuario:<senha>@host/db` ou adicionar a palavra `senha` à lista de exclusão de senhas de placeholder em `check-secrets.mjs` (`password|senha|xxx|changeme|\*+`).
- **Alternativa B:** Ignorar a pasta `docs/` no `check-secrets.mjs`.
- **Recomendação:** **Alternativa A (adicionar `senha` como placeholder aceito em URLs de exemplo do verificador).** No contexto brasileiro do projeto, `senha` é a palavra padrão para placeholders em exemplos.

---

## 9. Próximos Passos Sugeridos

1. O líder/Orquestrador adota as recomendações das perguntas 800 a 808.
2. A Issue avança para a etapa de **Arquitetura (WF-03)** para elaboração do desenho técnico (`151-DESENHO-CHECKALL.md`), detalhando as alterações exatas nos scripts de verificação, em `codigo.css` e no `eslint.config.mjs`.
3. Na fase de Desenvolvimento, o especialista aplica as correções em commits pequenos e atômicos, validando localmente:
   - `pnpm test:scripts`
   - `pnpm check:all`
   - `pnpm lint`
   - `pnpm typecheck`
