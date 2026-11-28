# Refino H-045 — Acesso comercial derivado (Issue #58)

- **Issue:** #58 `[E5] Acesso comercial derivado` · **História:** H-045 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `14-BACKLOG.md` (H-005, H-017, H-042, H-044, H-045, H-046, H-049, H-050, H-052, H-055 e §2 Ondas), `04-PRD.md` (RF-031, RF-055 a RF-062, RF-064, RF-109, RF-119), `05-CRITERIOS-ACEITE.md` (FA-005, FA-006, FA-025), `08-ARQUITETURA.md` (§1.1 P4, §4, §6, §6.1, §8.1 a §8.9), `09-MODELO-DADOS.md` (§3.10, §4), `11-ARQ-RISCOS-E-TESTES.md` (I-14, I-20, I-25, §9b B-01 a B-10), `11-DECISOES.md` (decisões 17 e 266), `15-RASTREABILIDADE.md`, `21-ISSUES-CRIADAS.md`, e os modelos `109-REFINO-H031.md` e `111-REFINO-TRIAGEM-DBTEST.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #58 no GitHub não foi lido. Este agente não tem shell e não executou `gh`. O objetivo foi reconstruído da linha H-045 do backlog e das fontes acima. O líder deve conferir o texto da Issue antes da Arquitetura.
- Nenhum teste, migração ou consulta ao banco de desenvolvimento foi executado. O estado real do banco não foi conferido.
- Os números de Issue das histórias vizinhas vêm do quadro e do `21-ISSUES-CRIADAS.md`. Os de H-046 (#59), H-049 (#62) e H-055 (#68) foram confirmados pelo título, não por tabela de mapeamento.

## 1. Verificação de fila

- `[VERIFICADO]` O quadro mostra #58 em "Product Owner (1)". É a única Issue nessa coluna, portanto a ordem de colunas está correta.
- `[VERIFICADO]` A última decisão registrada em `11-DECISOES.md` é a 266. As perguntas deste refino começam em 267.
- `[VERIFICADO]` Dependências declaradas de H-045: H-005 (#18) e H-017 (#30). Ambas estão em "Concluído" no quadro.
- `[VERIFICADO]` A linha de H-045 não tem bloqueio BLQ-EXEC, BLQ-SPK nem BLQ-DEC. A história não usa Mercado Pago, conta nem sandbox.

## 2. Objetivo

Criar o livro de concessões de acesso comercial (`access_grant`) e a função `commercial_access(prof, at)`, que informa, para um instante dado, em qual estado de acesso comercial o profissional está e até quando esse acesso vale.

O estado não é gravado. É calculado a partir do livro e da assinatura, no momento da leitura. Assim, expiração, trial e carência valem mesmo que nenhum job rode (P4, `08` §1.1).

Resultado de negócio: as histórias de descoberta (H-055), aceite (H-042) e seleção (H-074) conseguem perguntar "este profissional tem acesso agora?" sem depender de job, de chamada ao Mercado Pago ou do relógio da aplicação.

## 3. Escopo (dentro de H-045)

1. Tabela `access_grant` com as colunas de `09` §3.10, tipos, CHECKs e restrições de unicidade. O tratamento de `grace_until` depende da pergunta 271.
2. Função `commercial_access(professional_id, at)` que devolve o estado (um dos sete valores da `08` §6) e `access_until`.
3. Regra de carência de 72 h e regra de trial sem carência, na medida em que a função precisa delas (`08` §8.5, RF-059, FA-006).
4. Leitura do flag `cancel_at_period_end` para o estado `cancelada_com_acesso_ate_fim_do_periodo`. A forma da tabela depende da pergunta 270.
5. Permissões de execução e de leitura, conforme os papéis da `08` §4.2 `[PROPOSTA]`, depende da pergunta 277.
6. Testes de estados com relógio controlado, cobrindo B-01 a B-08 na parte que H-045 consegue provar sozinha (ver seção 8).

## 4. Fora de escopo

- Checkout, webhook e reconciliação do Mercado Pago (H-047, H-048, H-053).
- Ativação do trial, verificação de elegibilidade e regra de um trial por identidade na ativação (H-044).
- Criação de concessão paga e cálculo de `period_start` (H-049). H-045 não cria concessões em produção. Os testes usam fixtures inseridas diretamente, marcadas como sintéticas.
- Tabela `payment`, `method ∈ {cartao, pix}` e a recusa de boleto na API (H-047). A parte de I-25 sobre boleto não é provada nesta história.
- Pagamento Pix pendente como registro (H-047). H-045 só garante que a ausência de concessão não estende acesso.
- Planos e preços em centavos (H-046).
- Ação de cancelamento (H-052). H-045 apenas lê o flag.
- Ajuste administrativo (`access_adjustment`, `type='adjustment'`). O efeito sobre o acesso depende de decisão jurídica L3 (`08` §8.9).
- Consumidores do estado: descoberta (H-055), guarda de aceite (H-042), seleção (H-074). H-045 não nega, não seleciona e não oculta ninguém.
- Jobs, cron, tick (H-008) e notificações de expiração (H-099). H-045 não cria nenhum job.
- Qualquer chamada externa, e-mail ou envio real.

## 5. Fluxos e estados

### 5.1 Livro `access_grant`

Campos (`09` §3.10): `id`, `professional_id`, `identity_id` (para a unicidade de trial), `type` ∈ {`trial`, `paid`, `adjustment`}, `starts_at`, `ends_at`, `source_payment_id?`, `status` ∈ {`ativa`, `revogada`}. Campo `grace_until?` listado na `09`, mas a `08` §8.5 e a própria `09` dizem que a carência não é armazenada (pergunta 271).

Ciclo de vida de uma linha:

| Momento | Quem | Regra |
|---|---|---|
| Criação de trial | H-044 (não H-045) | `type='trial'`, `ends_at = starts_at + 14 dias` (`08` §8.2) |
| Criação de concessão paga | H-049 (não H-045) | `type='paid'`, `source_payment_id` único por provedor |
| `ativa` → `revogada` | sistema ou Financeiro | Só por decisão explícita; `08` §4 (`access_grant — — → ativa/revogada`) |
| `revogada` → `ativa` | ninguém | `[PROPOSTA]` proibido, como nos aceites (`08` §4) |
| Alteração de `starts_at` ou `ends_at` | ninguém | `[PROPOSTA]` proibido após a criação (I-20; pergunta 275) |

H-045 entrega o esquema e as restrições. As linhas em produção chegam pelas histórias acima.

### 5.2 Assinatura mínima `[AMBIGUIDADE]`

A função precisa de `subscription.cancel_at_period_end` e, opcionalmente, `canceled_at`. A tabela `subscription` (`09` §3.10) pertence, pela numeração do backlog, às histórias de checkout e webhook. Se ela não existir quando H-045 for construída, a função não consegue provar o estado `cancelada_com_acesso_ate_fim_do_periodo` (B-08). Ver pergunta 270.

### 5.3 Função `commercial_access(professional_id, at)`

Entrada: identificador do profissional e instante `at` (timestamp com fuso). `at` deve ser informado explicitamente pelos testes. Em produção, a aplicação passa `now()` do servidor `[PROPOSTA]`. Consulta a instantes passados é permitida `[PROPOSTA]`.

Saída: `estado` (um dos sete valores de `08` §6) e `access_until` (instante ou nulo).

Regras de derivação `[PROPOSTA]`, avaliadas nesta ordem. Só entram linhas com `status='ativa'`:

- **P1.** Concessão paga vigente (`starts_at ≤ at < ends_at`):
  - se a assinatura tem `cancel_at_period_end = true`, estado `cancelada_com_acesso_ate_fim_do_periodo`, `access_until = ends_at`;
  - caso contrário, estado `ativa`, `access_until = ends_at`.
- **P2.** Trial vigente (`starts_at ≤ at < ends_at`): estado `trial_ativo`, `access_until = ends_at`. A precedência entre P1, P2 e carência depende da pergunta 269.
- **P3.** Nenhuma vigente. Tomar a linha terminada mais recente (maior `ends_at ≤ at`):
  - se não existe, estado `sem_acesso`, `access_until` nulo;
  - se é trial, estado `trial_expirado`, sem carência;
  - se é paga e a assinatura tem `cancel_at_period_end = true`, estado `expirada`, sem carência;
  - se é paga e `at < ends_at + 72 h`, estado `em_carencia`, `access_until = ends_at + 72 h`;
  - caso contrário, estado `expirada`.
- **Pix pendente.** Não há linha para pagamento pendente. Logo, não estende acesso nem carência (B-06).

Propriedades `[PROPOSTA]`: função de leitura (`STABLE`), sem efeito colateral, sem leitura do relógio quando `at` é informado, com `search_path` fixo, e sem devolver dado pessoal, valor de pagamento ou identificador de provedor. A função não verifica aprovação do profissional (pergunta 274).

### 5.4 Relógio controlado e ausência de job

- O estado é resolvido na leitura, pela comparação de `at` com as datas do livro (P4). Nenhuma expiração é gravada.
- Não há cron, trigger de tempo, tick ou job associado a H-045. Um atraso de job não altera nenhum resultado.
- Testes usam instantes explícitos, por exemplo `ends_at − 1 s`, `ends_at`, `ends_at + 71 h 59 min 59 s` e `ends_at + 72 h`. Não dependem de espera real.

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-045 atende |
|---|---|---|---|
| RN-H045-01 | Estados de acesso são derivados. Nenhum campo guarda `ativa`, `expirada` etc. | `08` §6 ("armazenar separadamente; derivar") | Sem coluna de estado; CA-H045-16 |
| RN-H045-02 | Carência de 72 h a contar de `ends_at`, só para concessão paga sem cancelamento. Vale para cartão e Pix. | RF-059 `[APROVADO]` H5; `08` §8.5; I-25 | P3 |
| RN-H045-03 | Trial não tem carência. Trial terminado não gera cobrança nem assinatura. | RF-057, RF-059, FA-005, B-07 | P3 (trial) |
| RN-H045-04 | Cancelamento preserva acesso até `ends_at`, sem carência. | RF-061, B-08 | P1 e P3 |
| RN-H045-05 | Pix pendente não estende acesso nem carência. | `08` §8.5; B-06 | Sem linha, sem efeito |
| RN-H045-06 | Assinatura expirada não é apagada. H-045 só informa `expirada`. Quem decide descoberta e aceite são H-055 e H-042. Participação anterior é preservada. | RF-062, RF-109, FA-025 | Função sem efeito sobre seleção ou histórico |
| RN-H045-07 | Monotonia e idempotência: reprocessar ou reinserir não reduz acesso nem duplica período. | I-20 | Unicidade de `source_payment_id` (quando não nulo); sem alteração de período (CA-H045-08) |
| RN-H045-08 | Um trial por identidade. | `09` §3.10; AMB-09 A; I-14 | Índice único parcial (CA-H045-02); regra de HMAC pela pergunta 273 |
| RN-H045-09 | Concessões pagas do mesmo profissional não se sobrepõem `[PROPOSTA]`. | Consistência do estado | Restrição (CA-H045-09); pergunta 276 |
| RN-H045-10 | Datas em `timestamptz`. Mês civil e fuso América/Sao_Paulo ficam em H-049; H-045 compara instantes. | `08` §8.4 | Função não converte fuso |
| RN-H045-11 | A função não retorna dado pessoal, valor, identificador de provedor nem `payload`. | `08` §1.1; T-03, T-04 | CA-H045-15 |

Invariantes citadas:
- **I-20** (monotônica e idempotente): parte de H-045 é a unicidade e a imutabilidade do livro. A prova completa de B-05 e B-06 depende de H-047 e H-048.
- **I-25** (método, carência, trial): parte de H-045 é a carência de `period_end + 72 h` para pago sem cancelamento e a ausência de carência para trial. Os CHECKs de `payment.method` são de H-047.
- **P4** (tempo verificado no uso, não por job): base de toda a derivação.
- **RF-062** (assinatura expirada): H-045 fornece o estado `expirada`. O efeito sobre descoberta e aceite é de consumidores.
- **I-14** (parcial): trial único e fim de trial sem cobrança são cobertos aqui na parte de dados e leitura. O restante é de H-044 e H-049.

## 7. Critérios de aceite (testáveis)

Todos os testes são de banco, com relógio controlado (`at` explícito). Dados sintéticos devem ter marcador de teste (ver seção 10, R6).

- **CA-H045-01 (esquema).** A tabela `access_grant` existe com as colunas de `09` §3.10, exceto o que a pergunta 271 decidir. Inserir `type` fora de {`trial`, `paid`, `adjustment`}, `status` fora de {`ativa`, `revogada`}, ou `ends_at ≤ starts_at` é recusado. Prova: três inserções inválidas recusadas e uma válida aceita.
- **CA-H045-02 (um trial por identidade).** Uma segunda linha `type='trial'` para a mesma `identity_id` é recusada. Linhas `paid` ou `adjustment` da mesma identidade não são afetadas. Prova: teste de unicidade parcial.
- **CA-H045-03 (sete estados).** Para cada um dos sete estados da `08` §6, existe fixture com `at` explícito que devolve exatamente aquele estado e o `access_until` esperado (ou nulo). Prova: tabela de testes com sete linhas.
- **CA-H045-04 (fronteiras).** Nas fronteiras de trial (`starts_at`, `ends_at`), de período pago (`starts_at`, `ends_at`) e de carência (`ends_at + 72 h`), a função devolve o estado da regra escolhida na pergunta 267 e na 268, nos instantes −1 s, exato e +1 s. Prova: nove verificações.
- **CA-H045-05 (relógio controlado).** Duas chamadas com o mesmo `at`, feitas em instantes reais diferentes (com intervalo de pelo menos 2 s), devolvem o mesmo resultado. Prova: teste com espera.
- **CA-H045-06 (sem job).** A migração não cria cron, job, tick, trigger de tempo ou agendamento. Uma fixture com `ends_at` no passado, sem nenhum tick, já devolve `expirada` ou `em_carencia` corretos. Prova: consulta ao catálogo de jobs sem novas linhas e teste da fixture.
- **CA-H045-07 (somente leitura).** Chamar `commercial_access` não altera nenhuma linha das tabelas envolvidas (contagem e soma de conferência iguais antes e depois). A função é declarada `STABLE`. Prova: consulta à volatilidade da função e comparação antes e depois.
- **CA-H045-08 (monotonia e imutabilidade, I-20).** Inserir de novo a concessão com o mesmo `source_payment_id` é recusado, sem alterar o estado. Um `UPDATE` de `starts_at` ou `ends_at` de uma linha existente é recusado. Prova: duas tentativas recusadas e estado igual ao anterior.
- **CA-H045-09 (sem sobreposição de pagos).** Uma concessão paga que se sobrepõe a outra paga ativa do mesmo profissional é recusada. Prova: teste com sobreposição parcial e total. Depende da pergunta 276.
- **CA-H045-10 (carência e trial).** Paga com `ends_at = T`: em `T + 71 h 59 min 59 s` o estado é `em_carencia`; no limite de 72 h, o estado segue a pergunta 267. Trial terminado em `T` devolve `trial_expirado` em `T + 1 h` e em `T + 72 h`, nunca `em_carencia`. Prova: quatro verificações.
- **CA-H045-11 (cartão e Pix iguais).** Com a mesma fixture de período pago, o resultado é idêntico para assinatura com modo `cartao_recorrente` e para modo `manual`. Prova: duas execuções com a mesma saída. Requer a tabela `subscription` mínima (pergunta 270).
- **CA-H045-12 (cancelamento).** Assinatura com `cancel_at_period_end = true` e período pago vigente: em `at < ends_at` o estado é `cancelada_com_acesso_ate_fim_do_periodo` com `access_until = ends_at`; em `at = ends_at` e em `ends_at + 1 h` o estado é `expirada`, sem `em_carencia`. Prova: três verificações.
- **CA-H045-13 (retorno dentro e fora da carência).** Período pago `[T0, T1)` e novo pago `[T1, T2)` inserido com `starts_at = T1` (como H-049 faria): em `T1 + 60 h` o estado é `ativa` com `access_until = T2`, sem lacuna. Com período pago `[T0, T1)` e novo pago `[T1 + 73 h, T2)`: em `T1 + 72 h` o estado é `expirada`, e em `T1 + 73 h` o estado é `ativa`. Prova: quatro verificações.
- **CA-H045-14 (permissões) `[PROPOSTA]`.** Os papéis `anon` e `authenticated` não têm `SELECT` nem `INSERT`/`UPDATE`/`DELETE` em `access_grant`, e não têm `EXECUTE` em `commercial_access`. Prova: consulta de privilégios por papel. Depende da pergunta 277.
- **CA-H045-15 (saída mínima).** A função devolve somente duas colunas, `estado` e `access_until`. Nenhuma coluna de identidade, pagamento, valor ou provedor aparece. Prova: consulta às colunas de retorno.
- **CA-H045-16 (sem estado persistido).** Nenhuma tabela do domínio de billing ou de `professional` tem coluna cujo conteúdo seja um dos sete estados. Prova: consulta de nomes e valores de colunas `text` com CHECK de estado.
- **CA-H045-17 (execução local).** Os testes de H-045 rodam localmente, sem conta externa, sem chave e sem rede externa. A evidência é o resultado local registrado na Issue (comando, contagem e código de saída). Prova: linha de execução na Issue.

## 8. Casos B-01 a B-08

Base: `11-ARQ-RISCOS-E-TESTES.md` §9b. A última coluna diz o que H-045 prova sozinha.

| Caso | Cenário (§9b) | Fixture em H-045 | Resultado esperado | Cobertura em H-045 |
|---|---|---|---|---|
| B-01 | Pix pago; período termina sem novo pagamento | Paga `[T0, T1)`, sem nova linha | `ativa` em `T1 − 1 s`; `em_carencia` em `T1`; `em_carencia` em `T1 + 71 h 59 min 59 s`; `expirada` a partir de `T1 + 72 h` (pergunta 267) | Total |
| B-02 | Cartão: renovação automática falha | Igual a B-01, com modo `cartao_recorrente` | Igual a B-01 | Total. A falha em si é evento de H-048; H-045 vê só a ausência de linha |
| B-03 | Pix pago dentro da carência (+60 h) | Paga `[T0, T1)` e paga `[T1, T2)` | `ativa` em `T1 + 60 h`, `access_until = T2`, sem lacuna | Total na leitura. O cálculo de `starts_at = T1` é de H-049 |
| B-04 | Pix pago após 72 h | Paga `[T0, T1)` e paga `[T1 + 73 h, T2)` | `expirada` em `T1 + 72 h`; `ativa` em `T1 + 73 h` | Total na leitura. O cálculo de `starts_at` é de H-049 |
| B-05 | Webhook duplicado, concorrente e fora de ordem | Tentativa de segunda linha com mesmo `source_payment_id` | Recusada; `period_end` inalterado | Parcial (unicidade). Completo em H-048 |
| B-06 | Pix pendente no vencimento | Sem linha de concessão para o pagamento | Não estende acesso nem carência | Parcial (ausência de linha). Registro pendente é de H-047 |
| B-07 | Trial expirado | Trial `[T0, T0 + 14 dias)` | `trial_expirado` em `T0 + 14 dias + 1 h` e em `+72 h`; nunca `em_carencia`; sem cobrança | Total na função. Ausência de assinatura criada depende de H-044 |
| B-08 | Assinatura com `cancel_at_period_end` | Paga `[T0, T1)` e assinatura com flag | `cancelada_com_acesso_ate_fim_do_periodo` em `T1 − 1 s`; `expirada` em `T1` e depois; sem carência | Total na função, se a pergunta 270 for atendida. A ação de cancelar é de H-052 |

## 9. Dependências

- **H-005 (#18)** — `Concluído` no quadro. Esqueleto transversal. H-045 usa apenas a base de banco e não produz evento de outbox (não listado no backlog; ver R8).
- **H-017 (#30)** — `Concluído` no quadro. Exclusividade de papéis. Dá a base de `identity_id` e de `app_user` único.
- **Não depende** de H-039 (#52) nem de H-042 (#55), ambas em Backlog. Pelas linhas do backlog, H-045 não consome verificação.
- **Consumidores que aguardam H-045:** H-042 (#55), H-044 (#57), H-046 (#59), H-049 (#62), H-055 (#68), H-074. Nenhum deles deve começar antes de H-045 estar pronta.
- **Ordem de ondas** `[AMBIGUIDADE]`: `14-BACKLOG` §2 coloca H-045 na Onda 3, cuja entrada é "Onda 2 concluída". No quadro, itens da Onda 2 ainda estão em Backlog. Ver pergunta 278.

## 10. Riscos

- **R1. Fronteira inconsistente.** O caso B-01 diz "inclusive" em `+72 h`. A `08` §8.4 diz "acesso mantido por 72 h", e a `08` §6 usa `now() ≥ prazo` para "expirado". Mitigação: pergunta 267 antes de escrever o teste.
- **R2. Relógio do banco × relógio da aplicação.** `now()` depende de quando a transação começa. Mitigação: `at` explícito em todos os testes e em todas as chamadas da aplicação que precisem de consistência entre leituras (CA-H045-05).
- **R3. Sobreposição de concessões.** Dois períodos pagos sobrepostos tornam o estado ambíguo. Mitigação: CA-H045-09 e pergunta 276.
- **R4. Uso indevido de `expirada` para negar seleção.** FA-025 e RF-062 dizem que um participante com acesso expirado pode ser selecionado. Mitigação: H-045 não nega nada; a regra de seleção deve ser testada em H-074. Registrar essa fronteira na Issue de H-074.
- **R5. Desempenho.** A função é chamada uma vez por linha em listas (H-055, FA-007). Mitigação `[PROPOSTA]`: índice em (`professional_id`, `starts_at`) e função `STABLE`. Medir na Arquitetura.
- **R6. Dados de teste no banco de desenvolvimento.** Fixtures escritas no banco de desenvolvimento precisam de marcador de teste, para que a triagem da #140 possa separar o resíduo (`111` §6). Os testes que escrevem no banco não podem rodar ao mesmo tempo que outro agente usa esse banco (`111` R-DEV-1).
- **R7. Papéis e permissões sem decisão.** `08` §4.2 é `[PROPOSTA]`. Sem pergunta 277 respondida, CA-H045-14 não tem alvo. Mitigação: pergunta 277.
- **R8. Eventos e auditoria.** `08` §7.6 trata de outbox, mas não diz se mudança de acesso deve gerar evento ou entrada de auditoria. `[AMBIGUIDADE]`. H-045 não cria evento; se a Arquitetura exigir, o caso entra em H-045 ou em história própria. Registrar na Arquitetura.
- **R9. Expiração sem job.** Lembretes de fim de trial e de ciclo (H-099, AMB-06) precisarão de tick próprio. H-045 não resolve esse aviso.
- **R10. Capacidade do Postgres do Supabase.** `btree_gist` (para a restrição de sobreposição, CA-H045-09) e funções `STABLE` com `search_path` fixo `[NÃO VERIFICADO]` no ambiente de desenvolvimento. Confirmar na Arquitetura.

## 11. Perguntas ao líder

Lista única, numerada a partir de 267, sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava.

**267. Fronteira da carência (B-01 e `08` §8.4 × `08` §6).** Em `T1 + 72 h` exatos, o estado é `em_carencia` ou `expirada`?
- (a) Intervalo aberto à direita: `em_carencia` para `T1 ≤ at < T1 + 72 h`; `expirada` a partir de `T1 + 72 h`.
- (b) Inclusivo: `em_carencia` até `T1 + 72 h` inclusive.
- **Recomendação:** (a), que segue a convenção de "prazo expirado" da `08` §6. Ajustar B-01 para retirar "inclusive". Destrava CA-H045-04, CA-H045-10 e B-01.

**268. Duração do trial e unidade do período.** O trial termina em `starts_at + 14 dias` corridos (`timestamptz` com intervalo de dias) ou em 336 horas exatas?
- **Recomendação:** 14 dias corridos, pelo mesmo critério de "dias corridos" dos 7 dias de validade do pedido (FA-002) e pela `08` §8.2 (`ends_at = starts_at + 14 dias`). Destrava CA-H045-03 e B-07.

**269. Precedência entre trial vigente e concessão paga, incluindo carência.** Quando há trial vigente e pago vigente ou em carência ao mesmo tempo, qual estado vale?
- (a) Concessão paga (incluindo carência) tem precedência sobre trial; `trial_ativo` só aparece quando nenhuma paga cobre o instante.
- (b) Trial tem precedência.
- **Recomendação:** (a), porque o acesso pago é o que de fato sustenta o profissional. Destrava a ordem de P1 a P3 e CA-H045-03.

**270. Tabela `subscription` mínima em H-045?** A função precisa de `cancel_at_period_end` (e `canceled_at`), que a `09` §3.10 coloca em `subscription`, cuja criação o backlog associa a checkout e webhook.
- (a) Criar em H-045 uma `subscription` mínima: `professional_id`, `cancel_at_period_end`, `canceled_at`, sem campos do Mercado Pago. As outras histórias acrescentam colunas.
- (b) Não criar; o estado `cancelada_com_acesso_ate_fim_do_periodo` fica para H-052, e B-08 não é provado em H-045.
- **Recomendação:** (a). Sem ela, o backlog de H-045 (oito estados) não é cumprido. Destrava CA-H045-11, CA-H045-12 e B-08.

**271. Coluna `grace_until` em `access_grant`.** A `09` §3.10 lista `grace_until?`, mas a própria `09` e a `08` §8.5 dizem que a carência é derivada e não armazenada. Criar a coluna?
- (a) Não criar; a carência é calculada.
- (b) Criar nula e sem uso.
- **Recomendação:** (a), para não haver duas fontes de verdade. Destrava CA-H045-01.

**272. Efeito de `type='adjustment'` e de `status='revogada'` na função.** A `08` §8.9 deixa o efeito de ajuste em aberto (L3).
- **Recomendação:** o CHECK aceita `adjustment`, mas a função ignora `adjustment` e `revogada` até a decisão L3. Registrar como `[PROPOSTA]`. Destrava P1 a P3 para esses valores.

**273. Identidade do trial: `identity_id` ou HMAC?** A `08` §8.2 fala em unicidade por HMAC de CPF/CNPJ (AMB-09 A). A `09` §3.10 fala em `identity_id` redundante. O backlog de H-044 diz "um por identidade (HMAC)".
- (a) Índice único em `identity_id` no livro (H-045); a regra de HMAC fica em H-044 e na verificação.
- (b) Índice único em um hash de documento dentro do livro.
- **Recomendação:** (a), que é o que a `09` define para o livro. Confirmar com o dono da regra de identidade (H-040). Destrava CA-H045-02.

**274. A função verifica aprovação do profissional?** RF-057 exige aprovação para o trial, e FA-004 exige para aceitar. A função deve negar o estado quando o profissional não está aprovado?
- **Recomendação:** não. `commercial_access` trata só do acesso comercial. A aprovação é guarda de H-042 e de H-044. Evita duplicar regra de verificação. Destrava P1 a P3 e R4.

**275. Imutabilidade do livro e quem muda o status.** Confirmar: `starts_at` e `ends_at` não mudam após a criação; `status` só vai de `ativa` para `revogada`, por sistema ou Financeiro, com registro de auditoria (#19); a aplicação não tem `DELETE` em `access_grant`.
- **Recomendação:** sim para as três. Destrava CA-H045-08 e o desenho de permissões (277).

**276. Não sobreposição de concessões pagas.** Restrição de exclusão com `btree_gist`, ou trigger?
- **Recomendação:** restrição de exclusão, se `btree_gist` estiver disponível no banco de desenvolvimento (`[NÃO VERIFICADO]`); senão, trigger. Destrava CA-H045-09.

**277. Papéis que executam a função e leem o livro (`08` §4.2 é `[PROPOSTA]`).**
- **Recomendação:** `commercial_access` executável só pelo papel de aplicação do servidor; leitura direta de `access_grant` negada a `anon` e `authenticated`. Destrava CA-H045-14.

**278. Entrada da Onda 3 (`14-BACKLOG` §2).** H-045 está na Onda 3, cuja entrada é "Onda 2 concluída". O quadro mostra itens da Onda 2 em Backlog, como #52 (H-039) e #55 (H-042). H-045 não consome verificação, mas a regra da onda diz outra coisa.
- (a) Aguardar a Onda 2.
- (b) Seguir a dependência declarada (H-005 e H-017, ambas concluídas) e ajustar a linha da Onda 3 no `14-BACKLOG` para explicitar a exceção.
- **Recomendação:** (b), registrando a exceção no backlog. Destrava o início da Arquitetura.

## 12. Próximos passos

1. Líder confirma o texto da Issue #58 no GitHub e responde as perguntas 267 a 278 (lista única).
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas, se houver mudança de regra.
4. Mover #58 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura desenha a tabela, a função, os índices e as permissões. Desenvolvimento só começa depois.
