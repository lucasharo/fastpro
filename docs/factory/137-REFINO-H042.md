# Refino H-042 — Guarda de elegibilidade na API e no banco (Issue #55)

- **Issue:** #55 `[E4] Guarda de elegibilidade na API e no banco` · **História:** H-042 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, consulta ao banco ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório, no quadro ou em documento · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (mapeamento H-042 = #55, H-058 = #71, H-055 = #68, H-074 = #84), `14-BACKLOG.md` (linha de H-042, H-055, H-044, H-045, H-074 e §2 Ondas), `04-PRD.md` (RF-029, RF-031, RF-050, RF-051, RF-057, RF-062, RF-065, RF-080, RF-082, RF-109), `05-CRITERIOS-ACEITE.md` (FA-004, FA-005, FA-025), `123-REFINO-H039.md`, `124-DESENHO-H039.md`, `113-REFINO-H045.md`, `114-DESENHO-H045.md`, `132-REFINO-H044.md` (R2 e perguntas 504 a 511), `96-REFINO-H023.md` (lido; decisão 101 e D-H023-1), `97-DESENHO-H023.md` (não lido nesta rodada), `127-DESENHO-H032.md` (D-09, §3, pergunta 421), `11-DECISOES.md` (Rodadas 61, 62, 76, 80, 92, 117 e 118 lidas; demais por busca; decisões 101, 274, 277 a 279), e as migrações do repositório: `20261111400000_identity_create_professional_account.sql`, `20261111150000_identity_create_session_stage.sql`, `20261112100500_identity_expand_professional_recovery.sql` (função `professional_eligible`), `20261113170000_billing_create_access_grant.sql` (função `commercial_access`), `20261113210000_geo_expand_discovery_requests.sql` (`discover_scan`, `discover_requests`), `20261113220000_geo_expand_coverage.sql` (uso de `professional_eligible` pela #37) e `20261113230000_requests_expand_location_visibility.sql` (`request_visibility_guard`, `request_detail_professional`).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #55 no GitHub não foi lido. O objetivo vem da linha de H-042 no backlog. O líder deve conferir o texto antes da Arquitetura.
- Nenhum banco foi consultado. O estado real das funções foi lido nas migrações, não no banco de desenvolvimento.
- A linha de H-058 (aceite) não apareceu na busca desta rodada no `14-BACKLOG.md`. O número #71 vem de `21-ISSUES-CRIADAS.md`.
- O quadro lido é de 2026-11-13 12:30 UTC. A Rodada 118 (14/11) confirma #57 concluída, #46 indo para QA e #53 em QA; nada indica mudança nas Issues desta história.

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` O quadro mostra #55 em "Product Owner (3)", junto de #54 e #51. A ordem de colunas está correta.
- `[VERIFICADO]` Dependências declaradas de H-042 no `14-BACKLOG`: **H-039 (#52) e H-045 (#58)**. Ambas estão em "Concluído" no quadro. A história não está bloqueada por outra história não concluída **para a parte de guarda**.
- `[VERIFICADO]` A parte de **aceite** (H-058, #71) e a parte de **fotos** (H-056, #69) ainda estão em Backlog. Por isso o critério "nada criado no aceite" não pode ser provado por H-042 sozinha. Ver §9 e a pergunta 579.

| Issue | História | Estado no quadro | Relação com #55 | Situação verificada |
|---|---|---|---|---|
| #52 | H-039 Fila de verificação | Concluído | Dependência declarada. Produz `verification_status` (`aprovada`, `em_revisao`, `recusada`, `retida_duplicidade`, `suspensa`). | `[VERIFICADO]` migração `20261113200000` e quadro. Cumprida. |
| #58 | H-045 Acesso comercial derivado | Concluído | Dependência declarada. Função `private.commercial_access(p_professional_id, p_at)`, executável por `app_api` e `app_system` (decisão 279). | `[VERIFICADO]` migração `20261113170000`. Cumprida. |
| #36 | H-023 Descoberta por raio | Concluído | Fornece `discover_scan` e `discover_requests`, **sem guarda** de aprovação nem de acesso (decisão 101; cabeçalho de `20261113210000`). H-055 depende de H-023 e H-042. | `[VERIFICADO]`. Não é dependência declarada de H-042, mas a guarda é aplicada sobre ela. |
| #45 | H-032 Visibilidade de localização | QA | Já tem `private.request_visibility_guard(uuid, timestamptz)` (migração `20261113230000`) que checa `aprovada` e `ativo`, **sem e-mail verificado** e **sem acesso comercial**. O desenho 127 (D-09) manda uma guarda única. | `[VERIFICADO]` migração e desenho. Conflito de duplicidade (ver §5.5 e pergunta 568). |
| #53 | H-040 Retenção por duplicidade | QA | `retida_duplicidade` é um dos estados negados. | `[VERIFICADO]` quadro e migração. |
| #37 | H-024 Cobertura | Desenvolvimento | Usa `private.professional_eligible(uuid)` (migração `20261113220000`). **Não pode mudar de comportamento** por causa de H-042. | `[VERIFICADO]`. Ver pergunta 576. |
| #68 | H-055 Descoberta | Backlog | Consumidora. Depende de H-023, H-042 e H-045. | `[VERIFICADO]` 14-BACKLOG e 21-ISSUES. |
| #69 | H-056 Fotos antes do aceite | Backlog | Consumidora (RF-029 exige acesso comercial vigente e aprovação). | `[VERIFICADO]` 14-BACKLOG. |
| #71 | H-058 Aceitar trabalho (E6) | Backlog | Consumidora da parte de aceite. | `[VERIFICADO]` 21-ISSUES. Dependência de H-058 sobre H-042 `[NÃO VERIFICADO]` (pergunta 580). |
| #84 | H-074 Selecionar participante | Backlog | Consumidora no modo participação (ver §5.2). | `[VERIFICADO]` 14-BACKLOG. |

- `[VERIFICADO]` Existe `private.professional_eligible(p_user_id uuid)` (migração `20261112100500`, H-016 expandida). Ela exige conta `ativo`, e-mail verificado (`email_verified_at` não nulo) e `verification_status = 'aprovada'`. O comentário diz: "Pode publicar e aceitar" (decisão 33 §8). É a base natural da guarda única.
- `[VERIFICADO]` A pergunta 421 (`127-DESENHO-H032.md`) não tem resposta registrada em `11-DECISOES.md`. A opção (a), recomendada, foi aplicada na migração `20261113230000` sem a condição de e-mail verificado. A decisão 274 está registrada (`commercial_access` não verifica aprovação; a guarda é de H-042 e H-044).

## 2. Objetivo

Criar **uma única guarda** do banco que responde se um profissional pode **descobrir**, **ver a foto**, **ver o detalhe** e **aceitar** um pedido, e garantir que a API e o banco usem essa mesma resposta. Uma chamada direta à API ou ao banco, sem passar pela interface, não pode contornar a regra (RF-050, "inclusive por chamada direta de API").

Resultado de negócio: um profissional que não está aprovado, está com a conta bloqueada, não confirmou o e-mail ou está sem acesso comercial vigente não vê pedido novo, não recebe fotos e não cria aceite. O profissional que já aceitou continua com a conversa e o histórico (RF-062, RF-109, FA-025).

## 3. Escopo (dentro de H-042)

**Parte A, executável antes do aceite (E6):**

1. Função única de guarda no banco, com dois modos (ver §5.2): `descoberta_aceite` e `participacao`. Nome sugerido `[PROPOSTA]`: `private.professional_engagement_guard(p_user_id uuid, p_at timestamptz, p_modo text)`.
2. A guarda apoia-se em `private.professional_eligible` (não a altera) e em `private.commercial_access` (não a altera).
3. Substituição do corpo de `private.request_visibility_guard` (usado pela #45) para delegar à guarda única, mantendo a assinatura. Esta é uma **nova migração**, nunca edição de migração já aplicada. Ver pergunta 568.
4. Aplicação da guarda dentro de `private.discover_requests` (entrada da descoberta que a rota de H-055 vai chamar), sem mudar `discover_scan`, que continua sendo a primitiva pura de paridade. Ver pergunta 567.
5. Aplicação da guarda em `private.request_detail_professional` (detalhe), mesmo caminho da #45.
6. Testes de banco da guarda, dos estados e da paridade entre a guarda antiga e a nova (T-20).

**Parte B, depende de issues ainda não construídas (ver pergunta 579):**

7. Guarda na rota de aceite, dentro da transação do pedido e com trava, com checagem de novo no momento do aceite (`CA-H042-13`).
8. Guarda na URL de foto de H-056 (#69).
9. Testes de API (chamada direta negada) quando as rotas existirem.

## 4. Fora de escopo

- Rota `GET /discovery/requests`, resposta final ao profissional e paginação: H-055 (#68).
- Fotos, URL assinada, marca d'água e limite de visualização: H-056 (#69) e #70 (limite de visualização e sinal de raspagem).
- Criação do aceite, vagas 4+4 e idempotência: H-058 a H-062 (#71 a #74).
- Seleção do participante e regra de expiração de aceites: H-074 (#84) e H-062 (#74). H-042 só fornece o modo `participacao`.
- Trial, ativação e um trial por identidade: H-044 (#57, já concluída).
- Verificação de documentos, duplicidade e fila: H-037 a H-041 (já tratadas).
- Estado e motivo da verificação visíveis ao profissional: H-041 (#54).
- Cálculo de acesso comercial: H-045 (concluída). H-042 só consome o resultado.
- Restrição territorial de serviço regulamentado (L4): fora.

## 5. Guarda única compartilhada

### 5.1 Entradas e saída `[PROPOSTA]`

- Entradas: identificador do usuário profissional, instante `p_at` informado pelo servidor e modo (`descoberta_aceite` ou `participacao`).
- Saída: booleano (`permitido`). Sem motivo, sem estado, sem data (ver pergunta 569 e RN-H042-05).
- Uma única instância de `p_at` por requisição, passada para a guarda e para `commercial_access` (RN-H042-07).

### 5.2 Regra de elegibilidade por modo

Condições comuns aos dois modos (`[DECIDIDO]` RF-050, FA-004; e-mail `[PROPOSTA]` pela pergunta 564):
- `verification_status = 'aprovada'`;
- conta `app_user.status = 'ativo'`;
- e-mail verificado (`email_verified_at` não nulo).

Modo **descoberta_aceite** (descoberta, detalhe, foto e aceite de novo trabalho): as condições comuns **e** acesso comercial vigente. "Vigente" são os estados de `commercial_access` que têm acesso no instante `p_at`: `trial_ativo`, `ativa`, `cancelada_com_acesso_ate_fim_do_periodo` e `em_carencia` (ver pergunta 577).

Modo **participacao** (seleção do cliente, H-074): as condições comuns **e nenhuma exigência de acesso comercial**. `[DECIDIDO]` RF-062 e FA-025: quem tem acesso expirado pode ser selecionado onde já aceitou, desde que a identidade esteja aprovada e sem restrição de segurança.

Matriz de resultado para um profissional aprovado, com conta ativa e e-mail verificado:

| Estado de acesso comercial (`08` §6) | descoberta_aceite | participacao |
|---|---|---|
| `trial_ativo` | permitido | permitido |
| `ativa` | permitido | permitido |
| `cancelada_com_acesso_ate_fim_do_periodo` | permitido | permitido |
| `em_carencia` | permitido (pergunta 577) | permitido |
| `sem_acesso` | negado | permitido |
| `trial_expirado` | negado | permitido |
| `expirada` | negado | permitido |

Para qualquer `verification_status` diferente de `aprovada` (`pendente`, `em_revisao`, `retida_duplicidade`, `recusada`, `suspensa`), ou conta `bloqueado`, ou e-mail não verificado: **negado nos dois modos**.

### 5.3 Fail closed

`[PROPOSTA]` Qualquer erro, tempo esgotado, função ausente ou resultado inesperado da guarda vira **negado**, com código fixo. Nunca há fallback que permita. Quem chama não recebe texto de erro do banco (ver pergunta 578 e CA-H042-10).

### 5.4 Consumidores

| Consumidor | Modo | Onde a guarda roda | Parte |
|---|---|---|---|
| Lista de descoberta (#68) | descoberta_aceite | dentro de `discover_requests`, uma vez por requisição | A (banco), B (rota) |
| Detalhe do pedido (#45 e #68) | descoberta_aceite | dentro de `request_detail_professional` | A |
| URL de foto (#69) | descoberta_aceite | antes de gerar URL assinada | B |
| Aceite (#71) | descoberta_aceite | dentro da transação do aceite, com trava do pedido | B |
| Seleção pelo cliente (#84) | participacao | antes de efetivar a seleção | fora de H-042; H-074 usa o modo |

### 5.5 Relação com o que já existe

- `private.professional_eligible(uuid)` (H-016): **não muda**. A guarda nova chama essa função para as condições comuns, somando o acesso comercial. Isso protege #37 e a publicação (pergunta 576).
- `private.request_visibility_guard(uuid, timestamptz)` (#45, em QA): hoje checa `aprovada` e `ativo`, sem e-mail e sem acesso. Desenho 127 D-09 diz que deve haver **uma** função, e o T-20 trava divergência. Deve passar a delegar para a guarda única, com a mesma assinatura (pergunta 568).
- `private.discover_scan`: **não muda**. É a primitiva de paridade da #36 e não deve ganhar regra de negócio (pergunta 567).
- `private.commercial_access(uuid, timestamptz)` (H-045): **não muda**. Não verifica aprovação (decisão 274).

## 6. Regras de negócio

| Ref. | Regra | Fonte | Situação |
|---|---|---|---|
| RN-H042-01 | Uma única função do banco responde a elegibilidade. API, lista, detalhe, foto e aceite consomem essa função; nenhum consumidor reimplementa a regra. | RF-050; 127 D-09; T-20 | `[PROPOSTA]` |
| RN-H042-02 | Para descoberta e aceite: aprovação, conta ativa, e-mail verificado e acesso comercial vigente. | RF-050, RF-062, RF-065; FA-004, FA-025 | `[DECIDIDO]` exceto e-mail (564) e carência (577) |
| RN-H042-03 | A aprovação é verificada pela guarda de H-042. `commercial_access` não verifica aprovação. | Decisão 274 | `[DECIDIDO]` |
| RN-H042-04 | "Revogado" (RF-050, 14-BACKLOG H-042) não é um estado do modelo. Mapeia para `suspensa`. | `[AMBIGUIDADE]` | `[PROPOSTA]` (565) |
| RN-H042-05 | Negação uniforme. Pedido inexistente, pedido fora do raio, pedido de outro serviço e profissional negado geram a **mesma** resposta vazia ou o mesmo código. | Anti-enumeração; 88 §7 | `[PROPOSTA]` (569) |
| RN-H042-06 | Fail closed (ver §5.3). | 11-ARQ T-11 | `[PROPOSTA]` |
| RN-H042-07 | Um instante do servidor por requisição, usado pela guarda e por `commercial_access`. | 114 §1; pergunta 517 de 133-DESENHO-H034 (relógio via `p_now`) | `[PROPOSTA]` (571) |
| RN-H042-08 | Reavaliação no aceite, dentro da transação, com trava do pedido. Elegibilidade vista na descoberta não basta. | RF-080; FA-035 | `[PROPOSTA]` (572) |
| RN-H042-09 | Modo `participacao` não exige acesso vigente; sempre exige aprovação e conta ativa. | RF-062; FA-025; RF-080 | `[DECIDIDO]` no princípio, `[PROPOSTA]` no modo |
| RN-H042-10 | Negar não apaga nem altera histórico, conversa ou participação anterior. | RF-109; FA-025 | `[DECIDIDO]` |
| RN-H042-11 | A guarda é só leitura, sem efeito colateral. A auditoria de negação de aceite, se houver, é outra escrita (570). | 114 §4 (STABLE) | `[PROPOSTA]` |
| RN-H042-12 | Sem cache de elegibilidade entre requisições. Checagem a cada chamada. | RF-050 (mudança de estado tem efeito imediato) | `[PROPOSTA]` |

## 7. Critérios de aceite

Todos testáveis, com evidência local (comando, contagem e código de saída). Parte A ou B indicada entre colchetes.

- **CA-H042-01 (função única) [A].** Dado qualquer consumidor da descoberta, do detalhe e da foto, quando a elegibilidade é perguntada, então a resposta vem de uma única função. Prova: varredura de chamadas no repositório e no banco (catálogo de funções que contêm a regra); nenhuma cópia da condição de `verification_status` fora da guarda, salvo `professional_eligible` e a guarda de H-016.
- **CA-H042-02 (verificação) [A].** Dado conta ativa, e-mail verificado e acesso comercial vigente, quando o estado de verificação é `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` ou `suspensa`, então `descoberta_aceite` e `participacao` são negados; quando é `aprovada`, são permitidos. Prova: teste de banco com seis linhas.
- **CA-H042-03 (conta) [A].** Dado profissional aprovado com `app_user.status = 'bloqueado'`, quando a guarda é chamada nos dois modos, então é negado. Prova: teste de banco.
- **CA-H042-04 (e-mail) [A].** Dado profissional aprovado, conta ativa e e-mail não verificado, quando a guarda é chamada no modo `descoberta_aceite`, então é negado. Prova: teste de banco. Depende da pergunta 564.
- **CA-H042-05 (acesso comercial) [A].** Dado profissional aprovado, conta ativa e e-mail verificado, quando o acesso comercial está em cada um dos sete estados de `08` §6 no instante `p_at`, então `descoberta_aceite` segue a matriz de §5.2. Prova: sete fixtures com `p_at` explícito. Depende da pergunta 577 para `em_carencia`.
- **CA-H042-06 (chamada direta) [B].** Dado profissional negado, quando chama diretamente a rota de aceite ou a de descoberta sem passar pela interface, então recebe a negação, nenhuma linha de aceite, conversa ou mensagem automática é criada, e nenhum pedido aparece. Prova: teste de API (T-04) com contagem de linhas antes e depois. Depende de #68 e #71.
- **CA-H042-07 (descoberta sem vazamento) [A].** Dado profissional negado e existência de pedidos que casariam com ele, quando chama `discover_requests`, então a resposta é vazia e idêntica à de um profissional sem pedido. Prova: teste de banco comparando as duas respostas.
- **CA-H042-08 (detalhe uniforme) [A].** Dado profissional negado, quando pede o detalhe de um pedido que existe e casaria, então a resposta é igual à de pedido inexistente (zero linhas). Prova: teste de banco comparando as duas respostas.
- **CA-H042-09 (foto) [B].** Dado profissional negado, quando pede uma URL de foto de pedido, então não recebe URL, e a resposta é igual à de foto inexistente. Prova: teste de API com H-056. Depende de #69.
- **CA-H042-10 (fail closed) [A].** Dado que a guarda falha (erro forçado no teste, função ausente ou resultado fora do booleano), quando a descoberta ou o detalhe é chamado, então a resposta é negação com código fixo, sem texto do banco e sem permitir. Prova: teste com falha forçada.
- **CA-H042-11 (instante único) [A].** Dado um instante `p_at` fixo, quando a guarda e `commercial_access` são avaliados na mesma requisição, então usam o mesmo instante, e duas chamadas com o mesmo `p_at` devolvem o mesmo resultado. Prova: teste com relógio controlado.
- **CA-H042-12 (participação) [A].** Dado profissional aprovado, conta ativa e e-mail verificado com acesso `expirada`, quando a guarda é chamada no modo `participacao`, então é permitido; com `pendente`, é negado. Prova: teste de banco. A seleção em si é H-074.
- **CA-H042-13 (reavaliação no aceite) [B].** Dado profissional elegível na descoberta, quando a verificação passa a `suspensa` ou o acesso expira antes do aceite, então o aceite é negado (checagem dentro da transação com trava). Prova: teste de banco sequencial e, se possível, dois clientes concorrentes. Depende de #71.
- **CA-H042-14 (sem regressão) [A].** Dado que `professional_eligible`, `discover_scan` e `commercial_access` não foram alterados, quando os testes de H-016, #36 e H-045 são rodados, então continuam verdes, sem mudança de contagem. Prova: `corepack pnpm db:test` com contagem antes e depois.
- **CA-H042-15 (sem dado de estado na negação) [A].** Dado qualquer resposta de negação, então ela não contém estado de verificação, estado de acesso, data de acesso, valor ou identificador de pagamento. Prova: varredura da resposta. Depende da pergunta 569.
- **CA-H042-16 (auditoria de negação de aceite) [B].** Dado aceite negado pela guarda, então há evento de auditoria com ator, data e código, sem identificador de pedido em texto livre. Prova: consulta à auditoria. Depende da pergunta 570.
- **CA-H042-17 (execução local) [A].** Os testes rodam localmente, sem conta externa, sem chave e sem rede externa. A evidência é `corepack pnpm db:test` e `corepack pnpm check:all` registrados na Issue, com comando, contagem e código de saída. Não declarar CI verde.

Resumo: parte A = CA-01, 02, 03, 04, 05, 07, 08, 10, 11, 12, 14, 15, 17. Parte B = CA-06, 09, 13, 16.

## 8. Testes de referência

- `T-04` (14-BACKLOG, H-042): chamada direta negada; nada criado. Parte B para a parte de API.
- `T-06` (14-BACKLOG, H-042): teste de autorização por recurso. Entra com H-115 (#124 do quadro, E15).
- `T-20` (127-DESENHO-H032): trava a divergência entre a guarda de descoberta/detalhe e a de #45. Ponto central da parte A.
- `T-03` e `T-04` (14-BACKLOG, H-055): respostas sem dado pessoal e sem visibilidade de expirado; ficam em #68.
- Pergunta 581 pede confirmação do conjunto.

## 9. Dependências (resumo de decisão)

- **Parte A: pode começar quando o líder mover o cartão.** Dependências declaradas (H-039 e H-045) estão concluídas. Depende apenas de a #45 (QA) não ter o corpo de `request_visibility_guard` alterado em paralelo (pergunta 568).
- **Parte B: não pode ser provada sozinha.** Precisa de #68 (rota de descoberta), #69 (fotos) e #71 (aceite). Sem elas, CA-06, CA-09, CA-13 e CA-16 não têm alvo. Sem decisão do líder, H-042 não deve ser dada como concluída só com a parte A (pergunta 579).
- **Ordem:** H-042 antes de H-055 (14-BACKLOG). H-042 não depende de H-055.
- **Consumidor de H-044:** H-044 (#57, concluída) foi entregue sem a guarda de H-042. A decisão 274 e o R2 de `132-REFINO-H044.md` dizem que a checagem compartilhada vem de H-042 (pergunta 504 da H-044). Verificar se H-044 usa `professional_eligible` na ativação. `[NÃO VERIFICADO]` nesta rodada.

## 10. Riscos

- **R1. Duas guardas com regras diferentes.** A #45 (em QA) tem uma regra sem e-mail verificado; `professional_eligible` tem a regra com e-mail. Mitigação: RN-H042-01, T-20 e pergunta 568.
- **R2. Mudança em função usada por outras histórias.** Alterar `professional_eligible` quebra #37, H-016 e publicação. Mitigação: não alterar (CA-H042-14, pergunta 576).
- **R3. Estado "revogado" sem correspondência.** Mitigação: mapeamento para `suspensa` (565).
- **R4. Aceite durante o trial que vence.** Ver §11 e pergunta 574.
- **R5. Corrida entre descoberta e aceite.** Mitigação: CA-H042-13 e RN-H042-08. Teste concorrente em #71.
- **R6. Vazamento por resposta diferenciada.** Pedido existente versus inexistente, ou profissional negado versus sem pedido, pode revelar a existência do pedido. Mitigação: CA-07, CA-08, CA-15 e pergunta 569.
- **R7. Duas issues editando a descoberta.** H-042 entrega a guarda; H-055 entrega a rota. Mitigação: H-042 altera o banco por nova migração; H-055 só chama a função.
- **R8. Migrações em paralelo.** A #45 e a #37 podem ocupar o prefixo da próxima migração. Mitigação: o DEV confere o prefixo com `ls supabase/migrations | tail -3` ao criar, como já está na #45.
- **R9. Custo por linha em listas.** A guarda é chamada uma vez por requisição, não por linha (RN-H042-12 e pergunta 571). Medir com `explain` na Arquitetura.

## 11. Ambiguidades

- **A1. Aceite vigente quando o trial vence (H-074).** Um aceite feito durante o trial, com o pedido ainda aberto depois do fim do trial, continua? `[AMBIGUIDADE]`. Recomendação do PO: sim, até o fim do pedido, como na pergunta 508 da H-044. A decisão é de H-042 e H-074. Pergunta 574.
- **A2. "Revogado" (RF-050).** Não existe estado `revogado` em `professional_profile`. Pergunta 565.
- **A3. E-mail verificado.** `professional_eligible` exige; `request_visibility_guard` não exige. Pergunta 564.
- **A4. Carência conta como acesso vigente?** `08` §8.4 diz "acesso mantido por 72 h". Pergunta 577.
- **A5. Pergunta 421 não respondida.** Decisão 274 está registrada. A 421 (guarda na #45) não está em `11-DECISOES.md`, mas a migração já aplicou a opção (a). Pergunta 566.
- **A6. Dependência de H-058 sobre H-042.** Não localizada no backlog nesta rodada. Pergunta 580.
- **A7. Parte A e parte B.** A Issue é uma só. Pergunta 579.

## 12. Perguntas ao líder

Lista única, numerada de 563 a 582. Sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava.

**563. Base da guarda única.** Criar função nova que chama `professional_eligible` e `commercial_access` (recomendado), ou estender `professional_eligible` com o acesso comercial?
- (a) Função nova que chama a existente. Não muda H-016, #37 nem a publicação.
- (b) Estender `professional_eligible`. Muda comportamento de três histórias.
- **Recomendação:** (a). Destrava §5.1 e CA-01, CA-14.

**564. E-mail verificado na guarda de descoberta e aceite.**
- (a) Sim, como `professional_eligible` e decisão 33 §8.
- (b) Não, como `request_visibility_guard` da #45.
- **Recomendação:** (a). Destrava CA-04 e a correção da #45.

**565. Estado "revogado" (RF-050).**
- (a) Mapear para `suspensa`. Sem novo estado.
- (b) Criar estado `revogada` na verificação. Exige decisão de H-039.
- **Recomendação:** (a). Destrava RN-H042-04 e CA-02.

**566. Pergunta 421 (guarda na #45).** Incluir o acesso comercial já agora, porque H-045 está concluída, em vez de esperar H-055?
- **Recomendação:** sim. A opção (a) da 421 previa adiar até H-055, mas a dependência já existe. Destrava §5.2 e CA-05.

**567. Onde a guarda roda na descoberta.**
- (a) Dentro de `discover_requests` (usado pela rota de H-055). `discover_scan` continua pura.
- (b) Dentro de `discover_scan`. Quebra a paridade da #36.
- **Recomendação:** (a). Destrava CA-07 e R7.

**568. A #45 (em QA) e a guarda duplicada.** Como alinhar `request_visibility_guard` à guarda única?
- (a) H-042 cria nova migração que troca o corpo, mantendo a assinatura. A #45 segue em QA e T-20 roda contra as duas.
- (b) Reabrir a #45 para desenvolvimento antes de H-042.
- **Recomendação:** (a). A assinatura não muda, então a #45 não precisa voltar. Destrava CA-01 e T-20.

**569. O que o profissional vê quando é negado.**
- (a) Resposta genérica, sem motivo, para descoberta, detalhe, foto e aceite (recomendado). O motivo de verificação continua visível pela H-041.
- (b) Motivo distinto ("não aprovado" e "acesso vencido").
- **Recomendação:** (a). O estado de acesso revela a situação financeira (114 §privacidade). Destrava CA-07, CA-08, CA-15.

**570. Auditoria de negação.** Registrar as negações?
- (a) Não auditar negação de descoberta (volume alto). Auditar só negação de aceite, com ator, data e código, sem identificador de pedido em texto livre.
- (b) Não auditar nenhuma negação.
- **Recomendação:** (a). Destrava CA-16.

**571. Instante da requisição.** Um `p_at` do servidor por requisição, para a guarda e para `commercial_access`?
- **Recomendação:** sim, seguindo a decisão 517 (relógio da API passado em `p_now`). Destrava CA-11 e RN-H042-07.

**572. Reavaliação no aceite.** O aceite refaz a guarda dentro da transação, com trava do pedido?
- **Recomendação:** sim. Descoberta anterior não basta. Destrava CA-13 e RN-H042-08.

**573. Modo participação para H-074.** Criar um segundo modo sem exigir acesso vigente?
- (a) Sim. Aprovação e conta ativa são exigidas; acesso vigente não (RF-062, FA-025).
- (b) Não. H-074 faria a própria checagem.
- **Recomendação:** (a). Evita duas regras para o mesmo princípio. Destrava CA-12 e a seleção de #84.

**574. Aceite vigente quando o trial vence (H-074).** Um aceite feito durante o trial continua depois do fim do trial, enquanto o pedido estiver aberto?
- (a) Sim, até o fim do pedido. Não cancela trabalho combinado.
- (b) Não, o aceite é encerrado no vencimento do trial.
- **Recomendação:** (a), como a pergunta 508 da H-044. A decisão cabe a H-042 e H-074; H-042 aplica o modo `participacao` ao aceite já feito. Destrava A1.

**575. Suspensão e restrição de segurança.** Qualquer `suspensa` nega os dois modos, inclusive a participação?
- **Recomendação:** sim, para toda `suspensa`. FA-025 diz que o suspenso por segurança é negado na seleção. Não existe flag separado de restrição de segurança no modelo. Destrava CA-02 e CA-12.

**576. Proteger `professional_eligible`.** Manter sem alteração (protege #37, H-016 e publicação)?
- **Recomendação:** sim, como em 563. Destrava CA-14.

**577. Carência conta como acesso vigente para descoberta e aceite?**
- (a) Sim, `em_carencia` permite, como o acesso mantido por 72 h de `08` §8.4.
- (b) Não, só `trial_ativo`, `ativa` e `cancelada_com_acesso_ate_fim_do_periodo` permitem.
- **Recomendação:** (a), por coerência com a própria regra de carência. Destrava CA-05 e a matriz de §5.2.

**578. Fail closed.** Erro da guarda vira negação com código fixo, sem fallback?
- **Recomendação:** sim. Destrava CA-10.

**579. Partir a Issue #55.** Parte A (guarda, descoberta, detalhe, regressão) entra agora; parte B (aceite, foto, API direta) fica condicionada a #68, #69 e #71?
- (a) Uma Issue só, com CA-06, CA-09, CA-13 e CA-16 marcados como pendentes de #71 e #69. Não concluir antes deles.
- (b) Duas Issues: #55 (parte A) e uma nova para a parte B.
- **Recomendação:** (a). Sem criar cartão novo, mantém a rastreabilidade da 14-BACKLOG. Destrava a ordem de entrega e a regra de aceite de E6.

**580. Dependência de H-058 sobre H-042.** Confirmar que o aceite (#71) depende de H-042 e registrar isso no `14-BACKLOG.md`?
- **Recomendação:** sim. A linha de H-058 não foi localizada nesta rodada. O líder confere antes de mover #71. Destrava A6.

**581. Conjunto de testes de referência.** Confirmar T-04, T-06 (do 14-BACKLOG), T-20 (da 127) e T-03 e T-04 da H-055 como referência, com T-06 entregue via H-115 (#124)?
- **Recomendação:** sim. Destrava §8.

**582. Posição do cartão e ordem.** Mover #55 para Arquitetura depois de a revisão deste refino ser aceita, antes de #68 e #71?
- **Recomendação:** sim, depois da aprovação do líder e da conferência da coluna no quadro. #68 e #71 não começam antes de #55 (parte A) estar concluída, por causa da dependência de H-055 sobre H-042. Destrava a movimentação. Não mover por inferência.

## 13. Próximos passos

1. Líder confere o texto da Issue #55 no GitHub e responde 563 a 582 (lista única).
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas.
4. Mover #55 para Arquitetura só depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura desenha a função única, a migração nova que troca `request_visibility_guard` e a relação com `discover_requests`. Desenvolvimento só começa depois.
