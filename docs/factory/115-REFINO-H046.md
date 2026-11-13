# Refino H-046 — Planos e preços em centavos (Issue #59)

- **Issue:** #59 `[E5] Planos e preços em centavos` · **História:** H-046 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do cartão).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[APROVADO]` requisito aprovado no PRD · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `14-BACKLOG.md` (linhas H-045, H-046, H-047, H-049, H-052 e §2 Ondas), `04-PRD.md` (RF-055 a RF-062, RF-153), `05-CRITERIOS-ACEITE.md` (FA-006, FA-010, D5 na cobertura das decisões), `09-MODELO-DADOS.md` (§1 convenções, §3.10 `plan`, `plan_price`, `access_grant`, `subscription`, `payment`; §6 RLS), `11-DECISOES.md` (rodadas 61 a 63, decisões 267 a 289, e itens 157, 150 pendentes), `113-REFINO-H045.md` (formato).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #59 no GitHub não foi lido. Este agente não executou `gh`. O objetivo foi reconstruído da linha H-046 do backlog e das fontes acima. O líder deve conferir o texto da Issue antes da Arquitetura.
- A busca por texto (`rg`) não funcionou neste ambiente; as leituras foram feitas por arquivo inteiro.
- O código da #116 (`[E12] Gestão de catálogo e promoções`, concluída) não foi lido. Pode já existir estrutura de promoção ou de catálogo que a Arquitetura deve conferir (risco R6).
- Nenhuma consulta ao banco de desenvolvimento foi feita. O estado real de `plan` e `plan_price` não foi conferido.
- Tarifas do Mercado Pago não obtidas (S-03, erro 403). Não afetam os valores dos planos, que são preços do produto (ver pergunta 299).

## 1. Verificação de fila

- `[VERIFICADO]` O quadro mostra #59 em "Product Owner (2)", junto de #51. A coluna de origem está correta e nenhuma outra Issue de E5 está antes dela na ordem de colunas.
- `[VERIFICADO]` A última decisão registrada em `11-DECISOES.md` é a 289 (Rodada 62). As perguntas deste refino começam em 290.
- `[VERIFICADO]` Dependência declarada de H-046: **H-045 (#58)**. No quadro, #58 está em "Code Review (1)", não em "Concluído". A dependência **não** está satisfeita. Observação: a decisão 289 registra #58 "avança de Arquitetura para Desenvolvimento", mas o quadro atual a mostra em Code Review. O quadro prevalece.
- `[VERIFICADO]` H-047 (#60), H-049 (#62) e H-052 (#65) estão em Backlog. Não há Issue de H-046 em Desenvolvimento.

## 2. Objetivo

Definir, no banco, os quatro planos de assinatura (mensal, trimestral, semestral e anual) com a duração em meses, o preço em centavos inteiros e a vigência de cada preço, sem promoção no MVP. Entregar uma leitura única do preço vigente em um instante dado.

Resultado de negócio: a tela de assinatura e o checkout (H-047) leem o mesmo preço, e o valor cobrado é o valor que foi mostrado ao profissional (FA-006, RF-055).

Valores aprovados `[APROVADO]` (RF-055):

| Plano | Meses | Centavos | Exibição |
|---|---|---|---|
| Mensal | 1 | 2990 | R$ 29,90 |
| Trimestral | 3 | 8070 | R$ 80,70 |
| Semestral | 6 | 14940 | R$ 149,40 |
| Anual | 12 | 23880 | R$ 238,80 |

Preço único nacional. Sem desconto de lançamento. Os quatro planos têm benefícios idênticos (D5 `[DELEGADO]`, RF-056).

## 3. Escopo (dentro de H-046)

1. Tabela `plan`: `code` ∈ {`mensal`, `trimestral`, `semestral`, `anual`}, `months` ∈ {1, 3, 6, 12}, `active`. Quatro linhas. `[APROVADO]` pela 09 §3.10, com a unicidade de `code`. `[PROPOSTA]` o campo `active` entra só se a Arquitetura confirmar que é necessário.
2. Tabela `plan_price`: `plan_id`, `amount_cents` (inteiro), `currency` fixa em `BRL` (convenção da 09 §1), `valid_from`, `valid_to` (nulo = vigente). Quatro linhas de vigência inicial.
3. Restrições `[PROPOSTA]`: `amount_cents` inteiro e maior que zero; `valid_to > valid_from` quando não nulo; no máximo um preço vigente por plano em cada instante (ver pergunta 294).
4. Função de leitura do preço vigente em um instante `at` `[PROPOSTA]` (nome a definir pela Arquitetura). Devolve o código do plano, os meses, o identificador da linha de preço usada e o valor em centavos. É a única fonte que H-047 deve consultar.
5. Carga inicial dos quatro planos e preços por migração de dados de referência, idempotente (pergunta 295). Não é carga de demonstração.
6. Permissões: papel da aplicação com leitura; `anon` e `authenticated` sem nenhum privilégio nessas tabelas (09 §6: "sem grant nas tabelas") `[PROPOSTA]`.
7. Testes locais, com datas explícitas e fixtures de vigência executadas dentro de transação com desfazer (sem resíduo no banco de desenvolvimento).

## 4. Fora de escopo

- Checkout Mercado Pago, Pix e cartão (H-047). Criação de `payment` e gravação de `amount_cents` e `plan_price_id` no pagamento (H-047).
- Webhook (H-048), concessão paga e início de período (H-049), carência (H-050), adesão (H-051), cancelamento (H-052), reconciliação (H-053).
- Promoção, cupom, desconto, preço promocional ou preço de lançamento (MVP sem promoção; pergunta 292).
- Tela de planos e formatação visual em "R$" (pergunta 297).
- Tela administrativa para editar preço ou catálogo (RF-153). H-046 não cria tela.
- Lista de benefícios em texto (pergunta 296).
- Tarifas e taxas do Mercado Pago (S-03).
- Trial (H-044) e acesso comercial (H-045, em Code Review).
- Regra de ajuste de preço para assinaturas já existentes (pergunta 293).
- Chamadas externas, e-mail e envio real.

## 5. Fluxos e estados

### 5.1 Planos (`plan`)

| `code` | `months` |
|---|---|
| mensal | 1 |
| trimestral | 3 |
| semestral | 6 |
| anual | 12 |

Os meses definem a duração do período (uso de H-049). O preço não define duração.

### 5.2 Vigência de preço (`plan_price`)

- Cada plano tem uma linha vigente (`valid_to` nulo) `[PROPOSTA]`.
- Troca de preço: fecha-se a linha vigente (preenche-se `valid_to`) e insere-se nova linha com `valid_from` igual a esse instante. A linha antiga não muda o valor.
- Valor de `amount_cents` é imutável depois de gravado `[PROPOSTA]`. Não há `UPDATE` de valor.
- Consulta em `at`: a linha com `valid_from <= at` e (`valid_to` nulo ou `at < valid_to`).
- Quem paga grava a linha usada (H-047). Sem isso, a regra "preço exibido = preço gravado" não se prova.

### 5.3 Leitura (função em `at`)

Entrada: código do plano (ou lista dos quatro) e instante `at`. Saída: código, meses, identificador da linha de preço e valor em centavos. Função `STABLE`, sem efeito colateral, com `search_path` fixo `[PROPOSTA]`.

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-046 atende |
|---|---|---|---|
| RN-H046-01 | Preços em centavos inteiros: 2990, 8070, 14940 e 23880 | RF-055 `[APROVADO]`; 09 §1; FA-006 | Tipo inteiro, CHECK > 0, quatro valores de carga |
| RN-H046-02 | Moeda fixa BRL | 09 §1 | Coluna `currency` com valor fixo |
| RN-H046-03 | Benefícios idênticos nos quatro planos; diferem só ciclo e preço | D5 `[DELEGADO]`; RF-056 | Sem coluna de benefício por plano (pergunta 296) |
| RN-H046-04 | Sem promoção no MVP: sem desconto, cupom ou preço promocional | RF-055 ("sem desconto de lançamento"); backlog H-046 | Sem campo de promoção (pergunta 292) |
| RN-H046-05 | No máximo um preço vigente por plano em cada instante; histórico preservado | `[PROPOSTA]`; consistência de estado | Restrição de vigência (pergunta 294) |
| RN-H046-06 | Preço exibido = preço gravado no pagamento | Backlog H-046; FA-006 | H-046 entrega id e valor vigentes; a gravação é de H-047 (CA-12 parcial) |
| RN-H046-07 | Plano e preço não criam nem alteram acesso comercial | 08 e H-045 (`commercial_access` lê só o livro e a assinatura) | `plan` e `plan_price` não são lidos por `commercial_access` `[PROPOSTA]` |
| RN-H046-08 | Nenhum valor monetário em ponto flutuante | 09 §1 | Tipo inteiro em centavos |

## 7. Critérios de aceite (testáveis)

Todos os testes são de banco, com datas explícitas. Os de restrição rodam em transação com desfazer (sem resíduo no banco de desenvolvimento).

- **CA-H046-01 (quatro planos e meses).** A tabela `plan` tem exatamente quatro linhas com `code` ∈ {mensal, trimestral, semestral, anual} e `months` 1, 3, 6 e 12. Prova: consulta de contagem e de valores.
- **CA-H046-02 (centavos inteiros).** A tabela `plan_price` aceita `amount_cents` inteiro maior que zero. Recusa `0`, `-1`, `NULL` e valor fracionário (ex.: `29.90`). Prova: quatro inserções inválidas recusadas e uma válida aceita.
- **CA-H046-03 (valores aprovados).** Após a carga, o preço vigente de cada plano em uma data de referência é exatamente 2990, 8070, 14940 e 23880, nessa correspondência. Prova: consulta com a função de leitura (quatro verificações).
- **CA-H046-04 (benefícios idênticos).** Não existe coluna, tabela de benefício ou limite diferenciado por plano em `plan` ou `plan_price`. Prova: consulta ao catálogo de colunas das duas tabelas, sem nomes de benefício ou limite.
- **CA-H046-05 (sem promoção).** Não existe coluna, tabela ou função de desconto, cupom, promoção ou preço promocional no esquema de cobrança criado por H-046. Prova: consulta ao catálogo. Depende da resposta à pergunta 292.
- **CA-H046-06 (fronteiras de vigência).** Com troca de preço em `T`, em `T − 1 s` a leitura devolve o valor antigo; em `T` e em `T + 1 s` devolve o novo. Prova: três verificações por fronteira, com instantes explícitos.
- **CA-H046-07 (um preço vigente por plano).** Uma linha de preço que se sobrepõe a outra do mesmo plano é recusada (sobreposição parcial e total). Intervalos encostados (`valid_to` de um igual a `valid_from` do seguinte) são aceitos. Prova: três inserções testadas. Depende da pergunta 294.
- **CA-H046-08 (valor imutável).** `UPDATE` de `amount_cents` em linha existente é recusado. `UPDATE` de `valid_to` só é aceito uma vez, para fechar a vigência. Prova: duas tentativas com resultado esperado.
- **CA-H046-09 (leitura por instante).** A função devolve código, meses, identificador da linha e valor para o `at` informado, e não altera nenhuma linha. Função declarada `STABLE`. Prova: consulta à volatilidade e comparação de contagem antes e depois.
- **CA-H046-10 (carga idempotente).** Rodar a carga inicial duas vezes deixa exatamente quatro planos e quatro preços vigentes, sem duplicar nem alterar valores. Prova: duas execuções e contagem. Depende da pergunta 295.
- **CA-H046-11 (permissões).** `anon` e `authenticated` não têm `SELECT`, `INSERT`, `UPDATE` nem `DELETE` em `plan` e `plan_price`, nem `EXECUTE` na função. O papel da aplicação tem somente leitura nas duas tabelas. Prova: consulta de privilégios por papel. Depende da pergunta 291 (quem escreve) e da 277 (padrão já usado em H-045).
- **CA-H046-12 (preço gravado, parcial).** H-046 prova que a leitura devolve o identificador da linha e o valor vigentes no instante. A igualdade "preço exibido = preço gravado no pagamento" **não** é provada aqui; fica para o critério de checkout de H-047. Prova nesta história: a função devolve os dois campos (ver CA-09).
- **CA-H046-13 (formatação em reais) `[PROPOSTA]`.** Uma função pura converte centavos em texto: 2990 → "R$ 29,90"; 8070 → "R$ 80,70"; 14940 → "R$ 149,40"; 23880 → "R$ 238,80". Só entra se a pergunta 297 for respondida com (a). Prova: quatro verificações unitárias.
- **CA-H046-14 (execução local).** Os testes de H-046 rodam localmente, sem conta externa, sem chave e sem rede externa. A evidência é o resultado local registrado na Issue (comando, contagem e código de saída). Prova: linha de execução na Issue.

## 8. Cobertura de FA-006 e D5

| Item | Onde é coberto |
|---|---|
| FA-006: "vê Mensal R$ 29,90, Trimestral R$ 80,70, Semestral R$ 149,40, Anual R$ 238,80" | Dados: CA-01, CA-03. Tela: H-047 (pergunta 297) |
| FA-006 (D5): benefícios idênticos | CA-04 |
| FA-006: "Pix e cartão apenas" | Fora de H-046 (H-047) |
| FA-010 e D5: plano mensal ou anual dá acesso equivalente | Fora de H-046; a igualdade vem de RN-H046-07 e é provada em H-045/H-047 |
| RF-055: "sem desconto de lançamento" | CA-05 |

## 9. Dependências

- **H-045 (#58)** — `[VERIFICADO]` em Code Review no quadro, não concluída. Declarada como dependência de H-046 no backlog. Motivo declarado: a mesma área de cobrança (esquema `billing`) e a sequência de migrações.
- **Migração:** a de H-045 é `20261113170000_billing_create_access_grant.sql` (decisão 289). A de H-046 deve ter prefixo posterior e ser conferida antes de gravar (`ls supabase/migrations`).
- **H-005 (#18) e H-017 (#30)** — concluídas (dependências de H-045, não de H-046 diretamente).
- **H-047 (#60)** — consome a função de leitura e grava o snapshot no pagamento. Depende de H-046.
- **H-049 (#62)** — consome `months` para calcular o período. Depende de H-046 (ver também H-045 e H-049 para a fronteira).
- **S-03 (Mercado Pago)** — na Onda 4 `[VERIFICADO]` aparece como entrada do bloco, mas não é dependência declarada de H-046. Ver pergunta 299.
- **Quadro e concorrência:** testes que escrevem no banco de desenvolvimento seguem a janela exclusiva definida na Rodada 63. Ver risco R4.

## 10. Riscos

- **R1. Promoção futura × MVP.** RF-055 fala em "promoções futuras administráveis"; o backlog diz "sem promoção no MVP". Mitigação: sem campo de promoção agora; troca futura de preço por nova linha de vigência (pergunta 292).
- **R2. Mudança de preço com assinatura existente.** Não há regra aprovada. Afeta cobrança de cliente. Mitigação: não inventar regra; o líder decide com o dono (pergunta 293). Pode exigir parecer jurídico (L-itens do 12-TODO) `[NÃO VERIFICADO]`.
- **R3. Executor de migrações.** A regra do dono é aplicar migrações com `npx supabase`. A decisão 157 está pendente e registra que `npx supabase db push` deu 403 e que os agentes usam `corepack pnpm db:migrate`. A Rodada 60 registra que a CLI rotulou o projeto vinculado (fastpro-dev) como "production". Mitigação: resolver a 157 e conferir o projeto vinculado antes de cada aplicação (pergunta 298).
- **R4. Banco de desenvolvimento compartilhado.** Testes de restrição escrevem no banco compartilhado. Mitigação: transação com desfazer e execução na janela exclusiva da Rodada 63.
- **R5. Valor exibido × valor cobrado.** Se o Mercado Pago cobrar valor diferente (arredondamento ou taxa), o valor mostrado não bate. Mitigação: H-047 grava o valor enviado ao provedor; H-046 não calcula taxa. Tarifas não obtidas (403).
- **R6. Estrutura já existente da #116.** A #116 (catálogo e promoções) está concluída e pode ter criado estrutura de promoção ou de preço. `[NÃO VERIFICADO]`. Mitigação: a Arquitetura confere antes de criar tabelas (RN-H046-04 depende disso).
- **R7. Ordem da carga.** Se a carga inicial depender de outra migração não aplicada, a carga falha no DEV. Mitigação: CA-10 e prefixo posterior à migração de H-045.

## 11. Perguntas ao líder

Lista única, numerada a partir de 290. Cada item traz a recomendação do PO e a decisão que destrava.

**290. Quando o Desenvolvimento de #59 pode começar, com #58 ainda em Code Review?**
- (a) Só quando #58 estiver em Aguardando aprovação ou concluída. Precedentes: decisões 102, 183 e 197 (a dependência entra em Desenvolvimento depois que a predecessora sai da etapa de construção).
- (b) Já, com migração de prefixo posterior e sem tocar em `access_grant` nem em `subscription`.
- **Recomendação:** (a). Arquitetura e PO podem avançar agora. Destrava o início do Desenvolvimento.

**291. Quem cria `plan` e `plan_price`, e onde entra a coluna `subscription.plan_id`?**
- **Recomendação:** H-046 cria `plan` e `plan_price`. A coluna `subscription.plan_id` (chave estrangeira) entra em H-047, que é o primeiro escritor de assinatura. `[PROPOSTA]`. Destrava a ordem das migrações.

**292. Promoções: "sem promoção no MVP" (backlog) × "promoções futuras administráveis" (RF-055) e RF-153.**
- (a) Sem nenhum campo de promoção no MVP; mudança de preço por nova linha de vigência.
- (b) Já prever tabela de promoção vazia.
- **Recomendação:** (a). Destrava RN-H046-04 e CA-05.

**293. Mudança de preço com assinatura existente: quem paga qual preço?**
- (a) `[PROPOSTA]` O preço vale no momento de criação de cada pagamento e fica gravado nele; período já pago não muda; a renovação segue o preço vigente no ciclo.
- (b) Preço congelado por assinatura até o cancelamento.
- **Recomendação:** (a) como regra técnica. O prazo de aviso ao cliente antes de uma alta de preço não está definido em nenhuma fonte; o dono define e pode exigir parecer jurídico. Destrava o snapshot de H-047 e a fronteira com H-049.

**294. Pode haver mais de um preço vigente para o mesmo plano no mesmo instante?**
- **Recomendação:** não. Restrição de exclusão de intervalos, como em H-045 (pergunta 276): se `btree_gist` estiver disponível no banco de desenvolvimento, senão trigger (a Arquitetura confirma). Destrava CA-07.

**295. Como carregar os quatro planos e preços?**
- (a) Migração de dados de referência, idempotente (recomendado): o preço existe em qualquer ambiente, inclusive na produção futura.
- (b) Script de carga só para desenvolvimento.
- **Recomendação:** (a). Destrava CA-10.

**296. Benefícios: existe lista de benefícios a exibir, ou a igualdade é só por construção?**
- Fontes: 04-PRD e 09 não listam benefícios. D5 diz "idênticos".
- (a) Sem tabela nem coluna de benefício no MVP; igualdade por construção (recomendado).
- (b) O dono informa a lista de benefícios para a tela, em H-047.
- **Recomendação:** (a). Destrava CA-04.

**297. Quem entrega a tela de planos e a formatação em reais ("R$ 29,90")?**
- (a) H-046 entrega só a leitura e a função pura de formatação (CA-13). A tela é de H-047 (recomendado).
- (b) H-046 entrega também a tela.
- **Recomendação:** (a). Destrava CA-13 e o escopo web.

**298. Qual executor de migrações usar nesta história, dado o conflito com a decisão 157?**
- Contexto: regra do dono (`npx supabase`); decisão 157 pendente (`db push` deu 403; agentes usam `db:migrate`); alerta da Rodada 60 sobre o rótulo "production" da CLI.
- **Recomendação:** responder a 157 antes de aplicar qualquer migração de H-046 no banco de desenvolvimento. Conferir o projeto vinculado antes de aplicar. Destrava a aplicação no DEV.

**299. S-03 (tarifas do Mercado Pago) é entrada de H-046?**
- Os valores dos planos são preços do produto. As tarifas do provedor não mudam o valor exibido, a não ser que o dono decida repassá-las (decisão de negócio não registrada).
- **Recomendação:** H-046 não espera S-03. S-03 continua bloqueando H-047 (tarifas e recorrência). Destrava o início da Arquitetura.

## 12. Próximos passos

1. Líder confirma o texto da Issue #59 no GitHub (não lido nesta rodada) e responde as perguntas 290 a 299 (lista única).
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas.
4. Mover #59 para Arquitetura somente depois de confirmar a coluna no quadro e a decisão do líder. Não mover por inferência.
5. Arquitetura desenha as tabelas, a restrição de vigência, a função de leitura, as permissões e a ordem de migrações.
6. Desenvolvimento só começa conforme a resposta à pergunta 290.
