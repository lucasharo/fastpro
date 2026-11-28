# Refino H-122 — App Expo base (Issue #131)

- **Issue:** #131 `[E14] App Expo base` · **História:** H-122 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, comando de banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[PENDENTE JURIDICO]` matéria dependente de parecer jurídico / lojas (L6), com modelo proposto no DEV · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes consultadas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado no repositório em 2026-11-13/14).
- `docs/factory/21-ISSUES-CRIADAS.md` (mapeamento de H-122 para a Issue #131).
- `docs/factory/14-BACKLOG.md` (linhas H-122, E14, SD-13, S-07, H-121, H-123, H-124, Gate M4, BLQ-JUR L6, BLQ-DEC).
- `docs/factory/04-PRD.md` (RF-164, RF-160 a RF-162, M14, §4 Fora de escopo).
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-033, FA-034).
- `docs/factory/08-ARQUITETURA.md` (§0 Regras, §1.1 Princípios, §1.4 Monorepo `apps/mobile`, `packages/tokens`, `packages/contracts`, `packages/ui`, §4.2, §16).
- `docs/factory/10-ADRS.md` (ADR-001 Monólito Modular, ADR-006 Login Google/Apple, ADR-019 Mobile: riscos antecipados, SD-13 Fase mobile: contas de loja pagas).
- `docs/factory/11-DECISOES.md` (até a Rodada 127; decisões T5, Rodada 74 sobre proibição de Mapbox, Rodadas 103/107, Rodada 127 autorizando atuação contínua via agy para #131 em Product Owner).
- Monorepo local: `apps/mobile` (atualmente contendo apenas `.gitkeep`), `packages/tokens` (fonte única de cor e tokens do EDS), `packages/contracts` (contratos TypeScript de catálogo e API), `packages/ui` (componentes exclusivos da web; isolados do mobile), `pnpm-workspace.yaml`, `turbo.json`, scripts de verificação (`scripts/check-hex.mjs`, `scripts/check-typography.mjs`, `scripts/check-module-boundaries.mjs`, `scripts/check-env-example.mjs`, `scripts/check-secrets.mjs`, `scripts/check-logs.mjs`).
- Refinos de referência: `docs/factory/113-REFINO-H045.md`, `docs/factory/144-REFINO-H111.md`, e nota inicial em `docs/factory/87-REFINO-H122.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #131 no GitHub não foi consultado por rede externa (este agente não executa comandos de rede externos nem `gh`). Todo o escopo foi extraído das fontes canônicas do repositório.
- Nenhum comando de banco de desenvolvimento (`db:migrate`, `db:test`, consultas SQL) foi executado.
- Mapbox é terminantemente proibido no FastPro (Rodada 74). A casca móvel não faz nenhuma chamada ou importação ao Mapbox.

---

## 1. Verificação de fila e status

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue #131 (`[E14] App Expo base`) na coluna **Product Owner (5)**. A etapa de refino de PO é a etapa devida.
- `[VERIFICADO]` Histórico de Issues concluídas conferidas no quadro: **#43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151**.
- `[VERIFICADO]` Em Desenvolvimento e QA no quadro: #54, #55, #56, #47 (Desenvolvimento); #37 (QA).
- `[VERIFICADO]` Relação e estado das dependências canônicas de H-122:
  1. **H-121 (Issue #130 — Gate de release do MVP web):** Em `Backlog (62)`. O backlog canônico (`14-BACKLOG.md` §2 e §6) estabelece que a fase mobile é posterior ao MVP web estável.
  2. **S-07 (Spike #14 — Regras das lojas: login social, IAP e exclusão):** Em `Backlog (62)`. Parecer formal das diretrizes das lojas ainda não foi emitido.
  3. **SD-13 (Decisão do usuário sobre contas de desenvolvedor pagas):** Registrada em `10-ADRS.md` com recomendação `(a) adiar`. Não há autorização expressa para contratação de contas de desenvolvedor Apple ou Google.
  4. **T5 (`11-DECISOES.md`):** Premissa aprovada de que o mobile fica para depois da web (`RF-164`).
  5. **H-123 (Issue #132 — Reuso de contratos e tokens no mobile):** Em `Backlog (62)`. Depende de H-122 (não bloqueia H-122).
  6. **H-124 (Issue #133 — Assinatura e login no mobile):** Em `Backlog (62)`. Depende de S-07 e H-122.
- `[VERIFICADO]` Situação no backlog canônico: H-122 está classificada com o rótulo **Bloqueada** para execução em produção por depender de SD-13 e do web estável. No entanto, por determinação expressa do líder na **Rodada 127** ("Não parar nunca, mais agentes. Entram em Product Owner... #131"), o refino técnico de Product Owner é realizado nesta rodada para formalizar o escopo da casca, critérios de aceite e governança de custo zero, preparando a história para a esteira técnica sem liberar execução prematura de código.
- `[VERIFICADO]` Numeração de perguntas: conforme instrução de trabalho, as perguntas ao líder iniciam estritamente em **683** e encerram em **702** (20 perguntas numeradas).

---

## 2. Objetivo

Estabelecer a fundação arquitetural e a casca executável mínima do aplicativo móvel (`apps/mobile`) baseado em **React Native + Expo** dentro do monorepo FastPro (pnpm + Turborepo), garantindo integração estrita com a governança visual (`packages/tokens`) e com os contratos tipados da plataforma (`packages/contracts`).

A casca móvel de H-122 tem por finalidade:
1. **Configurar o ambiente de desenvolvimento mobile no monorepo:** Estruturar o workspace `apps/mobile` com Expo SDK suportado, integrando os scripts locais de checagem (`build`, `lint`, `typecheck`, `test`) ao pipeline do Turborepo.
2. **Assegurar a governança de tokens do Design System (EDS):** Consumir exclusivamente as definições semânticas de cor, tipografia e medidas de `@fastpro/tokens`, sem cores literais hardcoded (`pnpm check:hex`) e sem fontes fora do padrão Roboto (`pnpm check:typography`).
3. **Consumir contratos compartilhados da plataforma:** Vincular a casca diretamente a `@fastpro/contracts`, estabelecendo a camada de tipagem sem duplicação de modelos de dados.
4. **Respeitar o isolamento de fronteiras de módulo:** Garantir que `apps/mobile` não importe `@fastpro/ui` (pacote desenhado para a web) e cumpra as regras de `scripts/check-module-boundaries.mjs`.
5. **Entregar navegação e estados de interface canônicos (RF-162):** Implementar a tela inicial da casca suportando carregamento (Splash/Loading), estado vazio/informativo (Ready/Placeholder) e estado de erro de conectividade (Offline/Falha de rede amigável).
6. **Manter Custo Zero Absoluto:** Garantir que a entrega técnica seja 100% realizável sem novo backend, sem contas pagas de lojas de aplicativos (Apple/Google), sem serviços de nuvem pagos de build (EAS Build pago) e sem SDKs proprietários externos (Zero Mapbox).

Resultado de negócio: criação da base técnica móvel pronta e validada para receber as histórias funcionais futuras da plataforma, com separação clara de responsabilidades, zero impacto orçamentário e conformidade estrita com a governança do repositório.

---

## 3. Escopo (dentro de H-122)

1. **Estrutura do Workspace em `apps/mobile`:**
   - Criação do workspace Expo (`package.json`, `app.json`, `tsconfig.json`, `metro.config.js`, `babel.config.js`).
   - Integração das tarefas de `build`, `lint`, `typecheck` e `test` ao `turbo.json`.
   - Compatibilidade com o gerenciador de pacotes do monorepo (`pnpm@10.34.9`).
2. **Reuso de Tokens de Design (`@fastpro/tokens`):**
   - Importação e consumo direto de `@fastpro/tokens` para paleta semântica (`light` e `dark`), tipografia (Roboto pesos 400, 500, 700), espaçamentos e raios.
   - Conformidade estrita com os scripts `check:hex` (zero cores literais) e `check:typography`.
3. **Integração de Contratos (`@fastpro/contracts`):**
   - Dependência direta de `@fastpro/contracts` para tipagem de dados e validação de esquemas públicos.
4. **Fronteiras de Módulo e Dependências:**
   - Isolamento total de `@fastpro/ui` (não permitido no mobile).
   - Conformidade com `scripts/check-module-boundaries.mjs`.
5. **Casca Mínima e Estados Universais (RF-162):**
   - Configuração de tela de abertura (Splash Screen) nativa local via `expo-splash-screen`.
   - Tela inicial informativa ("FastPro Mobile — Casca Base"), exibindo marca, versão local e status do ambiente.
   - Tratamento de três estados canônicos de UI:
     - *Carregando:* indicador de carregamento durante a inicialização/checagem de rede.
     - *Vazio / Informativo:* tela base indicando que a casca está pronta e aguardando ativação de módulos funcionais.
     - *Erro / Offline:* feedback visual amigável quando o dispositivo estiver sem conexão à rede, com botão de retry ("Tentar novamente").
6. **Cliente de Rede Mínimo Desacoplado (Healthcheck):**
   - Configuração de cliente HTTP leve (usando `fetch` nativo) apontando para `EXPO_PUBLIC_API_URL`.
   - Consulta exclusiva ao endpoint público existente de healthcheck da API (`GET /health`), comprovando a capacidade de consumo de rede sem exigir autenticação, sessões ou dados de negócio.
7. **Suporte a Tema Claro e Escuro:**
   - Detecção do tema do sistema operacional (`useColorScheme`) e aplicação dinâmica dos tokens de `@fastpro/tokens`.
8. **Segurança e Variáveis de Ambiente:**
   - Criação de `apps/mobile/.env.example` contendo apenas nomes de variáveis (ex.: `EXPO_PUBLIC_API_URL`), sem valores sensíveis (`check:env` e `check:secrets`).
9. **Suíte de Testes Automatizados Locais:**
   - Testes unitários da casca (renderização, aplicação de tokens, estados de UI e cliente de healthcheck) executáveis em ambiente headless (Node/Vitest/Jest).

---

## 4. Fora de escopo

- **Alterações no backend existente:** Nenhuma migração SQL, tabela, coluna, função de banco, trigger ou rota nova na API NestJS. O backend permanece 100% inalterado.
- **Telas e fluxos de negócio de clientes e profissionais:**
  - Fluxo de publicação e rascunho de pedido de serviço (H-025 a H-031).
  - Fluxo de descoberta de pedidos e visualização por raio (H-055, H-056).
  - Fluxo de aceite de trabalho e gestão de vagas 4+4 (H-058, H-059).
  - Mensagens e chat em tempo real (H-065 a H-073).
  - Cadastro, envio de fotos de documentos e aprovação de profissional (H-037 a H-040).
  - Assinatura comercial, planos, Pix e pagamentos no mobile (H-046 a H-053).
- **Testes aprofundados de contrato e paridade de regras:** Escopo da Issue #132 (H-123 — Reuso de contratos e tokens no mobile; nenhuma regra de elegibilidade no cliente).
- **Autenticação no mobile, Login Social e In-App Purchases (IAP):** Escopo da Issue #133 (H-124), dependente do parecer de S-07 e decisão jurídica L6.
- **Contas de desenvolvedor pagas e publicação em lojas:** Sem contratação de Apple Developer Program (US$ 99/ano) nem Google Play Console (US$ 25 taxa única), e sem submissão de pacotes para homologação de lojas (ADR-006, ADR-019, SD-13).
- **Serviços de nuvem pagos de build (EAS Build pago):** Todos os builds e suítes de testes operam exclusivamente em ambiente local/CI gratuito.
- **Serviços externos de mapas (Mapbox):** Proibição total de Mapbox no FastPro (Rodada 74). Nenhum mapa ou geocodificação externa é importado.
- **Notificações push nativas:** Notificações push não foram aprovadas no produto (RF-121 fora do escopo).
- **Acessibilidade mobile completa:** A Issue #127 cobre WCAG 2.2 AA no ambiente web; diretrizes de acessibilidade mobile específicas (TalkBack/VoiceOver) ficam reservadas para fase posterior.

---

## 5. Fluxos e estados (Arquitetura e Ciclo de Vida da Casca Expo)

### 5.1 Ciclo de Vida da Inicialização (Bootstrap)

```
[Início do App]
       │
       ▼
[expo-splash-screen visível]
       │
       ├──► Carrega fontes locais (Roboto 400, 500, 700)
       ├──► Detecta tema do sistema operacional (light / dark)
       ├──► Resolve configurações públicas (EXPO_PUBLIC_API_URL)
       │
       ▼
[Splash Screen oculta de forma suave (hideAsync)]
       │
       ▼
[Renderização da Casca Base: Estado Inicial]
       │
       ├──► Dispara verificação leve de conectividade (GET /health)
       │
       ├───► Sucesso (200 OK)  ──► Exibe Estado Informativo (Online)
       └───► Falha / Timeout   ──► Exibe Estado Informativo (Offline com Retry)
```

### 5.2 Estados Canônicos de Apresentação (RF-162 / FA-034)

| Estado | Quando ocorre | Elementos visuais | Ações do usuário |
|---|---|---|---|
| **1. Carregando (Loading)** | Durante o bootstrap ou durante tentativa de reconexão ao healthcheck. | Splash nativa mantida ou `ActivityIndicator` centralizado na cor semântica `primary` de `@fastpro/tokens`. Fundo na cor `background`. | Nenhuma (bloqueio temporário até resposta). |
| **2. Vazio / Informativo (Ready)** | Bootstrap concluído e serviço acessível. | Logotipo institucional FastPro; Título "FastPro Mobile — Casca Base"; Indicador semântico de status: badge "API conectada" com cores `successBackground` e `successText`; Versão da casca. | Botão "Recarregar status". |
| **3. Erro / Sem Conexão (Offline)** | Falha ao consultar o healthcheck da API (rede indisponível, timeout ou erro 5xx). | Ícone neutro de conectividade; Mensagem amigável: "Não foi possível conectar ao servidor. Verifique sua conexão com a internet."; Cores semânticas de alerta (`warningBackground`/`warningText` ou `errorText`). | Botão interativo "Tentar novamente" (`buttonPrimaryBackground` / `buttonPrimaryText`) que redispara a checagem. |

### 5.3 Máquina de Estados da Conectividade da Casca

A casca implementa uma máquina de estados finita desacoplada para exibição de status:
- `IDLE`: estado inicial antes de qualquer disparo.
- `CHECKING`: requisição `GET /health` em andamento (timeout configurado em 5.000 ms).
- `ONLINE`: resposta 200 recebida com sucesso.
- `OFFLINE`: erro de rede, timeout ou resposta não-200. Transição para `CHECKING` permitida via clique em "Tentar novamente".

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-122 atende |
|---|---|---|---|
| **RN-H122-01** | Tokens de EDS são a fonte única de estilos visuais. | RF-160, FA-033, `packages/tokens/README.md` | Estilos consomem exclusivamente constantes de `@fastpro/tokens`. CA-H122-03. |
| **RN-H122-02** | Zero cor literal ou hexadecimal fora de `packages/tokens`. | Regra do monorepo, `check:hex.mjs` | Nenhum `#hex`, `rgb()`, `hsl()` ou nome de cor CSS no código do app móvel. CA-H122-03. |
| **RN-H122-03** | Tipografia restrita a Roboto nos pesos 400, 500 e 700. | `check:typography.mjs`, `packages/tokens` | Fontes carregadas e declaradas estritamente com os pesos permitidos. CA-H122-04. |
| **RN-H122-04** | Consumo obrigatório de contratos compartilhados da plataforma. | `08-ARQUITETURA` §1.4, ADR-019 | Tipos de API importados de `@fastpro/contracts`. Sem redefinição local. CA-H122-07. |
| **RN-H122-05** | Isolamento total de `@fastpro/ui`. | `08-ARQUITETURA` §1.4, `check-module-boundaries.mjs` | `apps/mobile` não declara nem importa `@fastpro/ui`. CA-H122-05. |
| **RN-H122-06** | Governança de custo zero e ausência de contas de loja pagas. | ADR-019, SD-13, `08` §0 | Sem taxas para Apple ou Google. Validação restrita a emuladores locais e Expo Go. CA-H122-13. |
| **RN-H122-07** | Proibição absoluta de Mapbox e SDKs proprietários pagos. | Decisão Rodada 74, `08` §0 | Nenhum SDK de mapa ou geocodificação externa embutido no mobile. CA-H122-13. |
| **RN-H122-08** | Inexistência de backend novo ou alterações de banco. | Diretriz PO / WF-03 | Zero migrações, zero tabelas, zero endpoints novos. Consumo de `/health` existente. CA-H122-12. |
| **RN-H122-09** | Segregação estrita de segredos e credenciais. | Regra do monorepo, `check:secrets.mjs` | `.env.example` versionado apenas com nomes de variáveis; segredos fora do Git. CA-H122-06. |
| **RN-H122-10** | Paridade e integridade: regras de negócio permanecem no servidor. | ADR-019, H-123 | A casca móvel não processa cálculos de elegibilidade ou regras de domínio. CA-H122-07. |
| **RN-H122-11** | Tratamento obrigatório de estados universais (Loading, Empty, Error). | RF-162, FA-034 | Casca implementa e testa visualmente os três estados canônicos. CA-H122-08 a 10. |
| **RN-H122-12** | Alternância dinâmica de tema claro e escuro. | RF-160, `@fastpro/tokens` | Tema responde à configuração do dispositivo aplicando o mapa `light` ou `dark`. CA-H122-11. |

Invariantes arquiteturais citadas:
- **P1 (Monorepo Governança):** Apps móveis são cidadãos de primeira classe no pnpm + Turborepo, sujeitos às mesmas varreduras de qualidade estática.
- **P2 (Design System Tokens):** A identidade visual é unificada em todo o produto através de tokens imutáveis.
- **P3 (Server-Authoritative):** O aplicativo móvel é um cliente fino; toda autorização e decisão comercial reside na API e no Postgres.
- **P4 (Custo Zero):** Nenhuma decisão técnica na fase móvel base pode gerar cobrança recorrente ou aquisição de planos comerciais.

---

## 7. Critérios de aceite (numerados e testáveis)

- **CA-H122-01 (Workspace no Monorepo).**
  - *Dado* o monorepo FastPro gerenciado por pnpm e Turborepo,
  - *Quando* o diretório `apps/mobile` é configurado com `package.json`, `app.json`, `tsconfig.json` e `metro.config.js`,
  - *Então* o Turborepo reconhece `@fastpro/mobile` como pipeline integrante e executa `turbo run build`, `turbo run lint`, `turbo run typecheck` e `turbo run test` sem erros de configuração.
  - *Prova:* Execução com código de saída 0 nos scripts de workspace.

- **CA-H122-02 (Scripts Locais de Verificação).**
  - *Dado* o código de `apps/mobile`,
  - *Quando* os comandos locais `pnpm --filter @fastpro/mobile lint`, `pnpm --filter @fastpro/mobile typecheck` e `pnpm --filter @fastpro/mobile test` são executados,
  - *Então* todas as checagens estáticas e testes unitários passam com 100% de sucesso.
  - *Prova:* Log de execução local com status verde e contagem de testes.

- **CA-H122-03 (Conformidade com `pnpm check:hex`).**
  - *Dado* o código-fonte de estilos e componentes de `apps/mobile`,
  - *Quando* o script `node scripts/check-hex.mjs` é executado na raiz do repositório,
  - *Então* zero violações de cores hexadecimais, rgb/hsl ou literais são encontradas no código de `apps/mobile`, comprovando o reuso exclusivo de `@fastpro/tokens`.
  - *Prova:* Saída do script `check:hex` aprovada com zero violações.

- **CA-H122-04 (Conformidade com `pnpm check:typography`).**
  - *Dado* o código-fonte de estilos e fontes de `apps/mobile`,
  - *Quando* o script `node scripts/check-typography.mjs` é executado na raiz do repositório,
  - *Então* zero violações de fontes ou pesos fora de Roboto (pesos 400, 500, 700) são encontradas.
  - *Prova:* Saída do script `check:typography` aprovada com zero violações.

- **CA-H122-05 (Conformidade com `pnpm check:boundaries`).**
  - *Dado* o arquivo `package.json` e as declarações de importação em `apps/mobile`,
  - *Quando* o script `node scripts/check-module-boundaries.mjs` é executado,
  - *Então* nenhuma importação a `@fastpro/ui` ou dependência circular é identificada.
  - *Prova:* Saída do script `check-module-boundaries` aprovada com zero violações.

- **CA-H122-06 (Conformidade com `pnpm check:secrets` e `check:env`).**
  - *Dado* a configuração do app móvel e o arquivo `apps/mobile/.env.example`,
  - *Quando* os scripts `check:env-example.mjs` e `check:secrets.mjs` são executados,
  - *Então* nenhuma chave privada, token ou valor de credencial é identificado em arquivos versionados.
  - *Prova:* Varreduras de segredos com saída 0.

- **CA-H122-07 (Consumo de Contratos Compartilhados).**
  - *Dado* o app móvel inicializado,
  - *Quando* inspecionadas as tipagens utilizadas para comunicação e dados,
  - *Então* elas provêm diretamente de `@fastpro/contracts`, sem redefinições locais ou tipos divergentes.
  - *Prova:* Teste de compilação TypeScript aprovado validando importações de contrato.

- **CA-H122-08 (Splash Screen e Inicialização Suave).**
  - *Dado* o aplicativo móvel em inicialização no ambiente local,
  - *Quando* o bootstrap carrega os recursos mínimos,
  - *Então* a splash screen nativa via `expo-splash-screen` permanece visível até a resolução completa dos assets, transicionando de forma suave para a tela inicial.
  - *Prova:* Teste unitário/renderização comprovando chamada assíncrona ao método de liberação da splash.

- **CA-H122-09 (Estado Informativo / Vazio da Casca).**
  - *Dado* o bootstrap concluído com sucesso e conectividade resolvida,
  - *Quando* a tela inicial é renderizada,
  - *Então* exibe a identidade FastPro, título da casca, versão do app e status amigável de conexão ativa.
  - *Prova:* Asserção de snapshot/componente em teste automatizado local.

- **CA-H122-10 (Tratamento de Estado Offline e Ação de Retry).**
  - *Dado* o aplicativo executando em ambiente simulado sem rede ou com endpoint inacessível,
  - *Quando* a verificação de saúde falha por timeout ou erro de rede,
  - *Então* a interface apresenta mensagem amigável sem travar o aplicativo e oferece o botão "Tentar novamente", que reexecuta a checagem com retorno ao estado ativo se o serviço responder.
  - *Prova:* Teste unitário simulando falha de rede e disparo do manipulador de retry.

- **CA-H122-11 (Suporte a Tema Claro e Escuro).**
  - *Dado* a alternância de tema no sistema operacional do dispositivo (`light` ou `dark`),
  - *Quando* a casca móvel é renderizada,
  - *Então* ela mapeia as propriedades visuais para os tokens semânticos correspondentes de `@fastpro/tokens` sem quebras de contraste ou distorções.
  - *Prova:* Teste de renderização sob tema `light` e tema `dark` validando aplicação dos valores de token.

- **CA-H122-12 (Ausência de Backend Novo).**
  - *Dado* o escopo entregue por H-122,
  - *Quando* o repositório é analisado pelo git diff,
  - *Então* zero novas migrações SQL foram criadas em `packages/db`, nenhuma tabela ou coluna foi alterada e nenhum endpoint novo foi adicionado a `apps/api`.
  - *Prova:* Diff do commit sem alterações nas pastas de banco e API.

- **CA-H122-13 (Ausência de Serviços Externos Pagos e Proibidos).**
  - *Dado* as dependências e o código do app móvel,
  - *Quando* inspecionado o manifesto `package.json` de `apps/mobile`,
  - *Então* inexiste qualquer menção ou dependência a Mapbox, Apple IAP SDK, Google Play Billing SDK ou serviços externos proprietários pagos.
  - *Prova:* Inspeção automatizada de dependências em `package.json`.

- **CA-H122-14 (Build e Execução Estritamente Locais).**
  - *Dado* a necessidade de geração de artefatos de desenvolvimento,
  - *Quando* o build é acionado,
  - *Então* ele é executado exclusivamente através do empacotador local (Metro/Expo local), sem acionamento ou dependência de créditos do EAS Build na nuvem.
  - *Prova:* Execução de build de exportação estático ou bundle local com saída 0.

---

## 8. Dependências reais (conferidas em `docs/factory/quadro-status.md`)

Tabela de dependências conferida diretamente no arquivo oficial do quadro:

| Dependência | Descrição | Estado no Quadro (`quadro-status.md`) | Impacto sobre a H-122 |
|---|---|---|---|
| **H-121 (#130)** | Gate de release do MVP web | `Backlog (62)` | **Impede início de Produção:** O backlog canônico prevê que o app mobile avança para homologação/lojas somente após o MVP web estabilizado. Não impede a estruturação da casca em PO. |
| **S-07 (#14)** | Spike: Regras das lojas (login social, IAP, exclusão) | `Backlog (62)` | **Impede telas funcionais:** Parecer sobre IAP e Apple Login ainda não emitido. Garante que H-122 limite-se estritamente à casca base neutra sem pagamentos ou auth. |
| **SD-13** | Decisão de contas de lojas pagas (Apple/Google) | Decisão aberta em `10-ADRS` (recomenda adiar) | **Impede publicação em lojas:** Mantém a H-122 estritamente orientada a ambiente local/emulador sem desembolso financeiro. |
| **T5** | Premissa aprovada: mobile depois da web | Aprovada (`11-DECISOES.md`) | Mantém o mobile em esteira controlada sem concorrer com a conclusão do web. |
| **H-123 (#132)** | Reuso de contratos e tokens no mobile | `Backlog (62)` | **Depende de H-122:** Não bloqueia H-122. Os testes de paridade e elegibilidade entram em H-123 após a casca base estar estabelecida. |
| **H-124 (#133)** | Assinatura e login no mobile | `Backlog (62)` | **Depende de H-122 e S-07:** Fica para momento posterior. |
| **Monorepo Base (#3)** | Estrutura pnpm e Turborepo | `Concluído` (70) | **Desbloqueado:** Permite a integração do workspace `apps/mobile`. |
| **Tokens EDS (#15)** | Tokens sem cor hardcoded | `Concluído` (70) | **Desbloqueado:** `@fastpro/tokens` pronto e estável para consumo. |
| **CI e Varreduras (#17)** | CI gratuito e checagens | `Concluído` (70) | **Desbloqueado:** Scripts de governança prontos para auditar `apps/mobile`. |

---

## 9. Riscos e impactos

1. **Risco de Tooling e Symlinks do pnpm no Metro Bundler (R-MOB-01):**
   - *Impacto:* O empacotador padrão do React Native (Metro) historicamente possui desafios com symlinks e a estrutura de pastas aninhada do `pnpm`.
   - *Mitigação:* Configuração adequada em `apps/mobile/metro.config.js` habilitando resolução de pacotes no monorepo (`watchFolders` apontando para a raiz e `nodeModulesPaths`), garantindo que `@fastpro/tokens` e `@fastpro/contracts` sejam resolvidos sem erros de bundler.
2. **Risco de Conflito com Regras de Lojas de Aplicativos (R-MOB-02):**
   - *Impacto:* Apple e Google possuem diretrizes severas quanto a compras dentro de aplicativos e métodos de autenticação externa (ADR-006, ADR-019).
   - *Mitigação:* H-122 expurga absolutamente qualquer menção a pagamentos, assinaturas ou telas de login social, mantendo a casca 100% neutra até o parecer de S-07 e decisão jurídica L6.
3. **Risco de Consumo de Créditos em Serviços de Nuvem (R-MOB-03):**
   - *Impacto:* Utilização acidental de serviços gerenciados como EAS Build com excedente tarifado.
   - *Mitigação:* Fixação nos scripts e na documentação de que todos os comandos operam em modo local, sem acionar `eas build` em nuvem.
4. **Risco de Vazamento de Cores Literais e Fontes Não Padronizadas (R-MOB-04):**
   - *Impacto:* Reprovação nos scripts canônicos de governança `pnpm check:hex` e `pnpm check:typography`.
   - *Mitigação:* Inclusão obrigatória de testes automatizados locais que validem os estilos antes de submissão a Code Review, consumindo exclusivamente constantes importadas de `@fastpro/tokens`.
5. **Risco de Violação de Fronteira com Pacote Web (R-MOB-05):**
   - *Impacto:* Importação indevida de componentes HTML/Tailwind de `@fastpro/ui` causando falha em runtime nativo.
   - *Mitigação:* Script `check-module-boundaries.mjs` monitora e bloqueia ativamente qualquer importação de `@fastpro/ui` dentro de `apps/mobile`.
6. **Risco de Descompasso de Versões do Expo SDK (R-MOB-06):**
   - *Impacto:* Instalação de versões experimentais ou incompatíveis com o Node.js v22 do repositório.
   - *Mitigação:* Arquitetura deve fixar versão LTS estável do Expo SDK compatível com Node 22 e React Native correspondente.

---

## 10. Diretriz de custo zero e serviços externos

### O que é entregável sem backend novo e sem serviços externos pagos:

1. **Entregabilidade Sem Backend Novo:**
   - H-122 **não exige nenhuma alteração no backend**. Não há criação de tabelas, migrações SQL, views, triggers, índices, DTOs de banco ou endpoints adicionais na API NestJS.
   - A casca mobile consome estritamente o endpoint público existente `GET /health` já disponível na API NestJS para comprovar conectividade de rede.
   - Todos os modelos de dados e contratos compartilhados provêm de `@fastpro/contracts`, já versionado no repositório.
2. **Entregabilidade com Custo Zero Absoluto (Zero Serviços Externos Pagos):**
   - **Zero Taxas de Lojas:** Nenhuma conta de desenvolvedor da Apple (US$ 99 anuais) ou da Google (US$ 25 taxa única) é adquirida ou necessária para a entrega de H-122. O desenvolvimento, execução e testes são realizados integralmente em ambiente local (Expo Go, simuladores iOS, emuladores Android ou renderizadores de teste em memória).
   - **Zero Serviços de Nuvem Pagos de Build:** A compilação e empacotamento ocorrem localmente no computador do desenvolvedor ou na esteira de CI gratuito, sem dependência do EAS Build pago.
   - **Zero Mapbox:** Em cumprimento à proibição categórica de Mapbox no FastPro (Rodada 74), nenhum SDK do Mapbox é importado e nenhuma chamada a mapas ou geocodificação externa é executada.
   - **Zero Provedores de Push ou Mensageria Pagos:** O canal de push notifications não foi aprovado (RF-121 fora do escopo); nenhuma biblioteca como OneSignal, Firebase Cloud Messaging pago ou Twilio é embutida.
   - **Zero SDKs de Pagamento In-App (IAP):** Nenhum SDK de cobrança de loja é adicionado na casca.

---

## 11. Ambiguidades e perguntas ao líder (Orquestrador)

Lista única de perguntas numeradas de **683 a 702** (20 itens). Conforme o papel de PO, cada pergunta traz as alternativas identificadas, a recomendação fundamentada e a decisão que destrava. As matérias que exigem alinhamento de política de loja ou custo estão marcadas como `[PROPOSTA]` para o ambiente de DESENVOLVIMENTO:

**683. [PROPOSTA] Estratégia de execução de H-122 perante os bloqueios canônicos de backlog (SD-13, S-07 e H-121).** No `14-BACKLOG.md`, H-122 está rotulada como "Bloqueada" por depender de SD-13 (contas de loja) e H-121 (MVP web estável). Na Rodada 127, o líder instruiu avanço em Product Owner para #131.
- (a) Entregar o refino e o desenho de arquitetura da casca base, mantendo o início de desenvolvimento em código condicionado à autorização formal de liberação de bloqueio pelo líder ou dono do produto.
- (b) Considerar que a casca base local não gera custos de loja nem interfere no web, liberando o desenvolvimento estritamente local assim que a arquitetura for concluída.
- **Recomendação:** (a). Preserva a governança canônica do backlog e assegura que nenhuma linha de código seja criada sem autorização explícita do líder, conforme `AGENTS.md`. Destrava a transição de workflow e CA-H122-01.

**684. Padrão de roteamento e navegação na casca Expo (`apps/mobile`).** O ecossistema Expo oferece o Expo Router (baseado em arquivos, similar ao Next.js) e o React Navigation tradicional (imperativo/declarativo via componentes de navegação).
- (a) Adotar o Expo Router nativo, alinhando a estrutura mental de rotas por arquivos com os apps web do monorepo (`apps/web` e `apps/admin`).
- (b) Adotar React Navigation tradicional com navegadores explícitos (Native Stack).
- **Recomendação:** (a) Expo Router. Facilita manutenibilidade, tipagem estática automática de rotas e padronização com a convenção do monorepo. Destrava a estrutura de arquivos em `apps/mobile/src/app` e CA-H122-01.

**685. [PROPOSTA] Consumo de tokens de design em componentes React Native.** `@fastpro/tokens` exporta objetos tipados em TypeScript (`light` e `dark`) e gera CSS variables (`tokens.css`) para a web. React Native não utiliza CSS variables diretamente.
- (a) Consumir diretamente os objetos TypeScript exportados por `@fastpro/tokens` (`light` e `dark`, espaçamentos, tipografia) mapeados em `StyleSheet.create` ou estilos tipados do React Native.
- (b) Introduzir uma biblioteca de terceiros como NativeWind para simular classes utilitárias da web.
- **Recomendação:** (a). Consumir diretamente os objetos de `@fastpro/tokens` via hook de tema `useTheme()`. Evita sobrecarga de dependências externas, garante tipagem forte e passa de forma limpa pelo `check:hex`. Destrava CA-H122-03 e RN-H122-01.

**686. Isolamento estrito de `@fastpro/ui` e prevenção de imports indevidos.** `packages/ui` foi construído com componentes web (DOM/HTML/Tailwind), incompatíveis com o runtime nativo do React Native.
- (a) Bloquear expressamente qualquer importação de `@fastpro/ui` em `apps/mobile` via regra no script `scripts/check-module-boundaries.mjs` e via configuração de TypeScript paths.
- (b) Tentar compartilhar componentes entre web e mobile dentro de `packages/ui`.
- **Recomendação:** (a). Proteger a estabilidade do mobile; `packages/ui` é exclusivo da web conforme `08-ARQUITETURA` §1.4. Destrava CA-H122-05 e RN-H122-05.

**687. Escopo da comunicação de rede na casca base (Healthcheck).** Qual chamada de rede a casca base deve executar para comprovar capacidade de integração em H-122?
- (a) Executar exclusivamente chamada `GET /health` (ou `GET /v1/health`) na rota pública existente da API, comprovando conectividade sem trafegar dados de negócio ou autenticação.
- (b) Implementar chamadas simuladas ou mockadas de catálogos e login.
- **Recomendação:** (a). Valida a comunicação real com o backend existente sem violar as fronteiras de negócio de histórias futuras. Destrava CA-H122-12 e o fluxo da seção 5.

**688. [PROPOSTA] Comportamento da casca em modo offline ou falha de rede.** Quando o dispositivo estiver desconectado da internet:
- (a) Exibir tela informativa com banner amigável de desconexão e botão "Tentar novamente", sem travar a interface do usuário nem emitir logs de erro ruidosos.
- (b) Bloquear totalmente a abertura do aplicativo com modal impeditivo.
- **Recomendação:** (a). Proporciona melhor experiência de usuário (UX) e cumpre os requisitos de estados universais (RF-162). Destrava CA-H122-10 e seção 5.2.

**689. Carregamento de fontes tipográficas (Roboto via `expo-font`).** O FastPro adota exclusivamente a fonte Roboto nos pesos 400, 500 e 700 (`check:typography`).
- (a) Embutir os arquivos de fontes TTF de Roboto como assets locais em `apps/mobile/assets/fonts/` e carregá-los no bootstrap via `useFonts` de `expo-font`.
- (b) Depender de download de fontes via Google Fonts em tempo de execução.
- **Recomendação:** (a). Fontes locais garantem carregamento offline, inicialização determinística e zero dependência externa em runtime. Destrava CA-H122-04 e CA-H122-08.

**690. Alternância e sincronização de tema claro/escuro.** Como a casca móvel deve responder às preferências visuais do usuário?
- (a) Seguir automaticamente o tema do sistema operacional do dispositivo via `useColorScheme()`, aplicando o conjunto `light` ou `dark` correspondente de `@fastpro/tokens`.
- (b) Forçar apenas tema claro no MVP inicial.
- **Recomendação:** (a). `@fastpro/tokens` já fornece os dois temas completos e testados com contraste WCAG 2.2; seguir o sistema é a convenção nativa recomendada. Destrava CA-H122-11.

**691. Padronização de variáveis de ambiente no Expo (`apps/mobile/.env.example`).** No Expo, variáveis públicas acessíveis no cliente utilizam o prefixo `EXPO_PUBLIC_`.
- (a) Padronizar `EXPO_PUBLIC_API_URL` como única variável pública na casca de H-122, mantendo `apps/mobile/.env.example` documentado e validado por `scripts/check-env-example.mjs`.
- (b) Embutir URLs diretamente em código estático.
- **Recomendação:** (a). Conformidade com a política de segurança do projeto (segredos e configurações fora de código versionado). Destrava CA-H122-06.

**692. Ferramental de testes unitários para a casca móvel.** Qual executor de testes deve ser utilizado para testes unitários em `apps/mobile`?
- (a) Utilizar Jest com `jest-expo` ou Vitest configurado para renderização de componentes com `@testing-library/react-native`.
- (b) Não criar testes unitários para o mobile na casca base.
- **Recomendação:** (a). Garantir que o comando `turbo run test` execute e valide a casca de forma automatizada no monorepo sem exigir simuladores físicos. Destrava CA-H122-02.

**693. Gestão da Splash Screen nativa (`expo-splash-screen`).**
- (a) Utilizar a biblioteca oficial `expo-splash-screen` com retenção explícita (`preventAutoHideAsync`) até o carregamento de fontes e liberação suave (`hideAsync`).
- (b) Utilizar uma tela de splash em React pura após a abertura nativa padrão.
- **Recomendação:** (a). Evita flashes visuais em branco (white flash) e garante transição profissional nativa. Destrava CA-H122-08.

**694. Segregação e reuso de contratos tipados em `@fastpro/contracts`.**
- (a) Consumir os tipos de DTOs já exportados em `@fastpro/contracts` (como contratos de catálogo e healthcheck), sem criar pastas locais de DTO duplicadas em `apps/mobile`.
- (b) Duplicar interfaces TypeScript dentro de `apps/mobile/src/types`.
- **Recomendação:** (a). Mantém o princípio de fonte única da verdade (Single Source of Truth) de contratos. Destrava CA-H122-07.

**695. [PROPOSTA] Prevenção ativa contra SDKs proibidos (Mapbox, push nativo, analytics pago).**
- (a) Incluir asserção estática no teste de dependências do app móvel para falhar caso dependências como `@react-native-mapbox-gl/maps`, `mapbox`, `onesignal` ou SDKs pagos sejam declaradas no `package.json`.
- (b) Confiar apenas em inspeção manual no Code Review.
- **Recomendação:** (a). Proteção automatizada contra regressões financeiras e violações de diretrizes do projeto. Destrava CA-H122-13.

**696. [PROPOSTA] Fundação para armazenamento local seguro futuro.** Na preparação para sessões futuras (H-124), qual solução de storage local deve ser considerada na fundação técnica?
- (a) Definir que futuras credenciais de sessão móvel utilizarão `expo-secure-store` (armazenamento criptografado nativo no Keychain/Keystore), sem implementar autenticação em H-122.
- (b) Deixar em aberto para decisão em H-124.
- **Recomendação:** (a). Fixa a diretriz arquitetural de segurança desde a base sem gerar código prematuro. Destrava o alinhamento com a arquitetura de segurança da plataforma.

**697. Estrutura interna de pastas do workspace `apps/mobile`.**
- (a) Estruturar como:
  ```
  apps/mobile/
  ├── assets/ (fonts, icons, splash)
  ├── src/
  │   ├── app/ (rotas do Expo Router)
  │   ├── components/ (componentes visuais da casca)
  │   ├── hooks/ (useTheme, useNetwork)
  │   └── services/ (api client de healthcheck)
  ├── app.json
  ├── metro.config.js
  ├── package.json
  └── tsconfig.json
  ```
- (b) Estrutura plana sem separação de componentes e serviços.
- **Recomendação:** (a). Organização modular clara que facilita a incorporação das histórias seguintes (H-123 e H-124). Destrava CA-H122-01 e CA-H122-02.

**698. Definição do Bundle Identifier (iOS) e Android Package Name sem publicação de loja.**
- (a) Adotar como convenção padrão `com.fastpro.app` no `app.json`, exclusivamente para identificação interna do bundle Expo no emulador local, sem vincular a nenhuma conta de desenvolvedor de loja.
- (b) Deixar sem identificador configurado.
- **Recomendação:** (a). Expo exige identificadores de bundle para builds locais consistentes e compilação em emulador. Destrava CA-H122-01.

**699. [PROPOSTA] Critério de evidência exigido para conclusão da casca base em H-122.**
- (a) Execução 100% local com evidência dos logs de: (1) `turbo run build --filter=@fastpro/mobile`, (2) `turbo run lint --filter=@fastpro/mobile`, (3) `turbo run typecheck --filter=@fastpro/mobile`, (4) `turbo run test --filter=@fastpro/mobile`, (5) `pnpm check:all` com saída 0.
- (b) Exigir gravação de vídeo ou capturas manuais em dispositivos físicos variados.
- **Recomendação:** (a). Evidência técnica verificável, automatizável e compatível com a política de evidências da fábrica, sem depender de hardware físico ou contas de lojas. Destrava CA-H122-02 e o processo de QA.

**700. Fronteira exata de responsabilidade entre H-122 (#131) e H-123 (#132).**
- (a) H-122 entrega a casca executável, workspace configurado, integração de tokens e verificação de saúde local. H-123 entrega os testes de contrato aprofundados com a API, validação formal de paridade e garantia de que nenhuma regra de elegibilidade seja processada no cliente.
- (b) Unificar os testes de contrato da H-123 dentro de H-122.
- **Recomendação:** (a). Preserva a granularidade planejada das histórias no backlog e permite que H-122 seja fechada com escopo estritamente focado na casca estrutural. Destrava o planejamento de H-123.

**701. [PROPOSTA] Mecanismo de logging e prevenção de vazamento de PII no cliente móvel.**
- (a) Utilizar logger encapsulado na casca que suprime logs informativos em builds de release e impede expressamente a impressão de tokens, e-mails ou dados pessoais no console nativo (`check:logs`).
- (b) Utilizar chamadas diretas a `console.log`.
- **Recomendação:** (a). Conformidade com a política de proteção de dados (LGPD) e alinhamento com o script de varredura `scripts/check-logs.mjs`. Destrava a conformidade com a esteira de CI.

**702. Condição para autorizar a transição da Issue #131 para a etapa de Arquitetura (WF-03).**
- (a) A emissão deste refino de PO conclui a primeira etapa de WF-03. A Issue #131 deve transitar para a coluna **Arquitetura** para elaboração do documento de desenho técnico (`146-DESENHO-H122.md`), mantendo a fase de Desenvolvimento bloqueada até a conclusão e aprovação da Arquitetura.
- (b) Manter a Issue estagnada em Product Owner até que o MVP web esteja em produção.
- **Recomendação:** (a). Permite que o desenho técnico da casca móvel seja elaborado com precisão pela Arquitetura, adiantando a engenharia de monorepo sem violar o bloqueio de desenvolvimento em código. Destrava a próxima etapa de WF-03.

---

## 12. Próximos passos e conclusão

1. **Arquivo escrito:** `docs/factory/145-REFINO-H122.md`.
2. **Dependências da Issue #131 (H-122):**
   - H-121 (Issue #130) e S-07 (Spike #14) permanecem em `Backlog` no quadro oficial.
   - SD-13 permanece em aberto em `10-ADRS.md` com recomendação registrada de adiar custos de contas de loja.
   - A casca base foi delimitada para operar com **Custo Zero Absoluto**, **sem backend novo** e **sem serviços externos pagos**.
3. **O Desenvolvimento pode começar?**
   - **NÃO. O Desenvolvimento NÃO pode começar agora.**
   - *Justificativa:*
     - Pelo workflow oficial da fábrica (WF-03), a conclusão da etapa de Product Owner requer que a história seja encaminhada para a etapa de **Arquitetura** para confecção do documento de desenho técnico detalhado (`146-DESENHO-H122.md`).
     - Além disso, no backlog canônico (`14-BACKLOG.md`), a história H-122 possui o rótulo **Bloqueada** vinculado a SD-13 e à maturidade do MVP web (H-121). O início efetivo da implementação de código no workspace `apps/mobile` depende da aprovação do desenho técnico pela Arquitetura e de decisão explícita do líder/dono do produto autorizando a abertura da frente de código local.
