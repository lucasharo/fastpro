# FastPro — Refino H-122 (Issue #131): app Expo base

- **Issue:** #131 (H-122, "[E14] App Expo base") · **Workflow:** WF-03 (refinamento) · **Coluna:** Product Owner · **Data:** 2026-11-12 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, build, commit, push ou alteração no GitHub. Nenhum Project, Issue ou branch foi movido. Nenhum arquivo de outra Issue foi alterado.
- **Situação:** a história está classificada como **Bloqueada** em `14-BACKLOG` (E14). Este refino fixa os critérios para quando a execução for autorizada. Não autoriza início de execução.
- **Fontes:** `14-BACKLOG` (H-122, H-123, H-124, E14, §2, §6), `04-PRD` (RF-164), `11-DECISOES` (T5), `10-ADRS` (ADR-006, ADR-019, SD-13), `08-ARQUITETURA` (§1.4, apps/mobile, packages/ui), `19-PLANO-TECNICO-DEV` (Onda 6, S-07), `16-MANIFESTO-ISSUES` (§17), `21-ISSUES-CRIADAS` (#130, #131, #132, #14), `12-TODO` (#8), `packages/tokens/README.md` (fonte única de cor e medidas; EDS mestre não recebido), `52-REFINO-H018` (modelo de formato).
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` premissa ou texto deste refinamento · `[NÃO VERIFICADO]` sem fonte oficial conferida.

## 1. Dependências (verificadas nos registros)

| Item | Relação com #131 | Estado nos registros | Efeito |
|---|---|---|---|
| **SD-13** (decisão do usuário: contas de loja pagas) | #131 depende. Recomendação registrada: (a) adiar | Decisão aberta (`10-ADRS`, tabela de decisões) | **Bloqueia a execução** |
| **S-07** (#14): regras das lojas (login social, IAP, exclusão de conta) | #131 depende (`14-BACKLOG` §4 e E14) | Não verificado; criado em Backlog (`21-ISSUES-CRIADAS`) | **Bloqueia a execução** (o backlog exige parecer antes de planejar mobile) |
| **H-121** (#130): gate de release do MVP web | #131 depende (coluna "Dep." de H-122) | Criado em Backlog; depende de toda a Onda 0 a 5 | **Bloqueia a execução** (web estável) |
| **T5** (`11-DECISOES`): mobile fica para depois da web | Premissa | Aprovada | Sem decisão de antecipar |
| **#132** (H-123): reuso de contratos e tokens no mobile | **#132 depende de #131**, não o contrário | Criado em Backlog | Não bloqueia #131. #132 só começa após #131 |

**Resposta à verificação pedida:** sim, #131 depende de outras Issues ainda não concluídas (#130, #14) e de uma decisão do usuário (SD-13). Não depende de #132. O reuso de contratos e tokens que #132 cobre só existe depois de #131, por isso a fronteira entre as duas Issues é tratada na dúvida 3.

**Estado no Project:** não consultado. Nesta sessão não há ferramenta de GitHub, e a restrição de não alterar o GitHub vale também para leitura de status. As informações acima vêm dos registros do repositório (`21-ISSUES-CRIADAS` registra criação em Backlog, sem implementação iniciada).

**Sobre o rótulo "Bloqueada":** é a classificação do backlog. Não é um status do GitHub a ser aplicado. Conforme a regra de limite de Issues ativas, a #131 permanece na coluna atual, sem marcação de bloqueio, até que as condições acima sejam atendidas.

## 2. Contexto

H-122 cria o app base em `apps/mobile` (Expo), que consome os contratos da API. O backlog não detalha telas. `RF-164` [APROVADO] define web primeiro e mobile depois. `T5` [APROVADO] adia o mobile. O app base não é um produto de negócio: é a casca que permite as histórias de mobile seguintes.

Premissas de tokens: o app usa as mesmas cores e medidas de `packages/tokens`, a fonte única do repositório. Essa fonte usa a síntese do EDS, porque o EDS mestre não foi recebido (V-14). Divergências são reportadas ao usuário, não corrigidas em código.

## 3. Critérios de aceite (Given/When/Then)

**Condição de entrada**
- **CA-01 [PROPOSTA]** Dado que a #131 vai iniciar execução, quando o líder verifica as condições, então existem registros de: (a) SD-13 decidida pelo usuário; (b) S-07 com parecer registrado; (c) H-121 concluída. Sem as três, a Issue não sai da coluna de Product Owner.

**Casca do app**
- **CA-02 [PROPOSTA]** Dado o repositório após a execução, quando o app base é iniciado em modo de desenvolvimento local, então abre uma tela inicial sem erro, sem build de loja e sem serviço de nuvem para build.
- **CA-03 [PROPOSTA]** Dado o pacote `apps/mobile`, quando as verificações locais do monorepo rodam, então lint, verificação de tipos, testes e build do app passam, e o app é incluído no pipeline de Turborepo do repositório, como os demais apps.

**Reuso de contratos e tokens**
- **CA-04 [PROPOSTA]** Dado o código do app base, quando inspecionado, então tipos e esquemas de API vêm somente de `packages/contracts`. Não há cópia local de contrato. Nenhuma chamada de rede de negócio é feita nesta Issue (ver dúvida 2).
- **CA-05 [PROPOSTA]** Dado o código do app base, quando a varredura de cor literal do repositório (`check:hex`) roda, então não há cor literal fora de `packages/tokens`, e as cores e medidas do app vêm de `@fastpro/tokens`.

**Segurança e credenciais**
- **CA-06 [PROPOSTA]** Dado o código e a configuração do app base, quando verificados, então não há token, chave ou valor de variável de ambiente no código ou em arquivo versionado. Só nomes de variáveis são permitidos, em arquivo de exemplo. Valores ficam em arquivo local ignorado pelo git (política do projeto).

**Escopo de loja e publicação**
- **CA-07 [PROPOSTA]** Dado a execução desta Issue, quando verificada, então nenhuma conta de desenvolvedor de loja é criada, nenhum build de nuvem é executado, nada é publicado e nenhuma compra ou login social é implementado (SD-13, S-07, H-124).

**Evidência**
- **CA-08 [PROPOSTA]** Dado a conclusão da execução, quando registrada na Issue, então a evidência é o resultado local de cada verificação (comando, contagem de testes e código de saída), sem declarar verde de pipeline que não rodou.

## 4. Fora de escopo

- **Telas de negócio** para cliente ou profissional (pedido, aceite, chat, verificação, assinatura): não estão no H-122. Entram em histórias próprias de mobile.
- **Regras de elegibilidade** e **testes de contrato** entre app e API: H-123 (#132).
- **Login, login social e exclusão de conta** no mobile: H-124 (`BLQ-JUR L6`), depois de S-07.
- **Assinatura e compra dentro do app (IAP)**: H-124 e ADR-019.
- **Publicação em lojas, contas de desenvolvedor e build de nuvem**: `BLQ-JUR L6`, SD-13.
- **Notificações push**: RF-121 não aprovado.
- **Acessibilidade do app mobile**: H-118 cobre somente o web. Não há história de acessibilidade mobile no backlog (dúvida 6).

## 5. Evidência exigida (local)

Executada no computador de desenvolvimento, sem GitHub Actions como gate (regra vigente):
- `corepack pnpm check:all` (ou, se a Issue usar as partes separadas, `lint`, `typecheck`, `test` e `build` do app), com código de saída e contagem.
- Varredura de cor literal (`check:hex`) com código de saída.
- Verificação de segredos no diff da Issue, com código de saída.
- Registro na Issue: quais comandos rodaram, contagem e código de saída. Sem captura de simulador (dúvida 5).

## 6. Dúvidas para o líder (com recomendação)

Numeração de sessão a cargo do líder. Cada item indica a decisão que destrava.

1. **SD-13 (decisão do usuário).** Opções: (a) adiar o mobile; (b) mobile só para cliente; (c) decidir após verificar as regras das lojas (S-07). **Recomendação: (a)**, como consta em `10-ADRS`. Destrava qualquer execução da #131. O líder deve levar ao usuário, já que é decisão de custo com contas pagas.
2. **Escopo da casca.** Opções: (a) app vazio, com tela inicial e navegação mínima, sem chamada de rede; (b) app que também chama o healthcheck da API. **Recomendação: (a)**, para não criar dependência de API antes do web estável. Destrava CA-02 e CA-04.
3. **Fronteira #131 × #132.** Opções: (a) #131 só liga o app aos pacotes `contracts` e `tokens` (importação mínima), e #132 cria os testes de contrato e de paridade; (b) #131 faz tudo. **Recomendação: (a)**, pois #132 depende de #131. Destrava o corte entre as duas Issues.
4. **Gate H-121.** Opções: (a) exigir H-121 concluída, como o backlog registra; (b) aceitar só "web estável" como critério, sem H-121. **Recomendação: (a)**. Destrava CA-01.
5. **Evidência visual.** Opções: (a) só comandos locais (CA-08); (b) também captura de tela em simulador. **Recomendação: (a)**, pois simulador e contas de desenvolvedor geram custo ou exigem configuração não verificada. Destrava a forma da evidência.
6. **Acessibilidade mobile.** O backlog não tem história de acessibilidade mobile (H-118 é web). **Recomendação:** registrar como dívida fora de #131, sem criar história agora. O líder decide se cria uma história nova. Não bloqueia a #131.
7. **Ferramenta de build do app** (versão do Expo e de ferramentas de build). Não verificado (ADR-019 item 4). **Recomendação:** o Architect escolhe a versão e garante que o build roda só localmente, sem serviço de nuvem, até S-07 e SD-13 serem decididos. Não é pergunta ao usuário. Destrava o desenho técnico.

## 7. Estado da entrega

- Verificação feita: dependências de `14-BACKLOG` (H-121, S-07, SD-13, H-123) e `21-ISSUES-CRIADAS` (#130, #14, #132); fonte de tokens em `packages/tokens/README.md`; branch local `feature/init` (`.git/HEAD`); número livre 87 em `docs/factory/`.
- Nenhum teste ou build foi executado (documento).
- Coluna do GitHub Project: não consultada (sem ferramenta de GitHub nesta sessão). Coluna Product Owner informada pelo líder.
- Commit: não executado. Esta sessão não tem ferramenta de shell. Arquivo a versionar: `D:/projetos/fastpro/docs/factory/87-REFINO-H122.md`. Mensagem proposta: `docs(H-122): refino do app Expo base` com corpo `Refs: #131`, mais os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVPL2o53TuuaUzciSZp`.
