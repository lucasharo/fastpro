# Refino H-038 — Certificações para atividades regulamentadas (Issue #51)

- **Issue:** #51 `[E4] Certificações para atividades regulamentadas` · **História:** H-038 · **Épico:** E4 (Onda 2) · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste ou alteração no quadro. O cartão permanece em Product Owner (coluna onde está hoje, conferido em `quadro-status.md`) até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.
- **Numeração de perguntas:** 300 a 319, conforme instrução do líder (o PO de #59 usa 290 em diante).

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (mapeamento H-038 = #51), `14-BACKLOG.md` (§5 E4, linha H-038; §6 BLQ-JUR L4; §2 Ondas), `04-PRD.md` (RF-003, RF-005, RF-006, RF-046 a RF-053, RF-147), `05-CRITERIOS-ACEITE.md` (FA-004, itens condicionados), `09-MODELO-DADOS.md` (§3.2 catálogo, §3.3 `identity_document`, §3.7 `media_asset`, §3.12 e §8), `107-DESENHO-H037.md` (desenho da #50, de onde a #51 herda a tabela e o pipeline), e o modelo `113-REFINO-H045.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #51 no GitHub não foi lido. Este agente não tem shell confiável para `gh` e a busca de texto por `Grep` falhou nesta sessão (erro de execução). O objetivo foi reconstruído da linha H-038 do backlog e das fontes acima. O líder deve conferir o texto da Issue antes da Arquitetura.
- O uso do catálogo (quais serviços têm a flag `regulated`) não foi verificado no banco nem no seed. Nenhuma lista de atividades REG existe nas fontes lidas.
- Nenhum teste, migração ou consulta ao banco de desenvolvimento foi executado.

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` O quadro mostra #51 em "Product Owner (2)", junto com #59. A ordem de colunas está correta para esta etapa.
- `[VERIFICADO]` #50 (H-037, documentos de identidade) está em **"Aguardando aprovação"**, não em Concluído. A decisão de Concluir é humana e ainda não foi tomada.
- `[VERIFICADO]` #52 (H-039, fila de verificação), #53 (H-040), #54 (H-041) e #55 (H-042) estão em **Backlog**.
- `[VERIFICADO]` #48 (H-035, cadastro com CPF/CNPJ), #49 (H-036, perfil com serviços e raio) e #31 (H-018, catálogo com flags REG) estão em **Concluído**. #111 (H-102, RBAC e MFA no admin) também está Concluído.
- `[VERIFICADO]` A linha H-038 do backlog declara como dependências **H-018 e H-037**. Não declara H-039 (#52).
- `[VERIFICADO]` `107-DESENHO-H037.md` §4.1 já prevê que a tabela `app.identity_document` tenha `kind` com um único valor (`identidade`) e que "a #51 amplia o check para `certificacao` e acrescenta `service_id` por expansão". `09` §3.3 também prevê `service_id?` para certificação.

**Conclusão de dependência (resposta à pergunta do líder):**
- **Desenvolvimento da #51 NÃO pode começar sozinho.** Ela estende a tabela, as rotas, os buckets e o pipeline de validação que a #50 cria. Esses objetos ainda não foram aceitos. Começar antes seria iniciar uma parte que depende de história não concluída, como o próprio princípio do líder proíbe.
- **Arquitetura** (desenho em documento) pode avançar, porque não grava código e não depende de migração aplicada. Fica a pergunta 315 para o líder confirmar.
- **O critério "atividade REG sem certificação → aprovação não concluída" depende de #52** (fila de verificação, H-039), que ainda está em Backlog. A #51 pode provar a regra como função de elegibilidade, mas a transição real para "aprovada" é de #52. Isso não está declarado no backlog. Pergunta 319.
- **#55 (H-042, guarda de aprovação)** também consumirá o resultado; não bloqueia a #51, mas precisa saber da regra.

## 2. Objetivo

Permitir que o profissional anexe a certificação exigida por um serviço marcado como regulamentado (REG) no catálogo, e que a Verificação só possa concluir a aprovação de um profissional que tenha certificação recebida para cada serviço REG que ele atende.

Resultado de negócio: o FastPro não aprova, sem comprovante, profissional de atividade que exige habilitação. A plataforma continua apenas conectando as partes (RF-078); o selo "verificado" continua sendo só de identidade (RF-005, RF-006).

## 3. Escopo (dentro de H-038)

1. Extensão de `identity_document` para `kind = 'certificacao'`, com `service_id` obrigatório nesse caso, por expansão e reversível (sem alterar a tabela já criada pela #50 além do necessário).
2. Regra de catálogo: só serviço com flag `regulated = true` aceita certificação. Serviço sem flag não recebe certificação.
3. Envio, finalização, exclusão e lista de certificações pelo dono, reaproveitando o pipeline de validação e reencode de #50 (imagem ou PDF, mesmo limite técnico, mesma recusa por conteúdo).
4. Função de elegibilidade `private.certificacoes_completas(profissional)` que informa se todo serviço REG ativo do profissional tem certificação recebida e viva. Consumida pela aprovação (#52) e pela guarda de aceite (#55).
5. Leitura restrita: a certificação só pode ser lida pela Verificação, pela mesma porta de leitura de #50 (interface, sem implementação nesta história; a leitura positiva é de #52).
6. Testes de banco, de domínio e de rota, com dados sintéticos marcados.

## 4. Fora de escopo

- Verificação do conteúdo da certificação (número de registro em conselho, validade, autenticidade). Depende de L4 (BLQ-JUR). Ver pergunta 300.
- Lista definitiva de atividades REG. Depende de L4. Ver pergunta 301.
- Tela de aprovação, fila, decisão, recurso e motivo da recusa: H-039 (#52) e H-041 (#54).
- Guarda de aceite e descoberta por aprovação: H-042 (#55) e H-055.
- Edição da flag REG no catálogo pelo admin: H-107 (Backlog). Esta história só lê a flag.
- Exibição de certificação no perfil público (H-043). Ver pergunta 312.
- Retenção e expurgo de documentos: L1 (BLQ-JUR), igual à #50.
- Qualquer chamada externa (conselho, validação de registro, OCR).

## 5. Fluxos e estados

### 5.1 Ciclo de uma certificação

| Estado (`identity_document.status`) | Quem move | Regra |
|---|---|---|
| `pendente_envio` | dono, ao emitir envio | vaga reservada; some se não finalizar (TTL de #50) |
| `recebido` | sistema, na finalização | arquivo validado e gravado no bucket final |
| `substituido` | sistema | certificação nova para o mesmo (profissional, serviço) substitui a anterior já analisada |
| (removida) | dono, enquanto não analisada | exclusão só se `analyzed_at` for nulo |

`[PROPOSTA]` O estado de análise (aceita, recusada) **não** fica nessa tabela. Ele fica em `verification_case` / decisão da Verificação (#52). Isso mantém a regra de #50 (CA-09: receber documento não muda `verification_status`).

### 5.2 Fluxo do profissional

1. Profissional com serviço REG no perfil vê, na tela de documentos, a lista "Certificação exigida: <nome do serviço>".
2. Envia o arquivo (imagem ou PDF). Mesma sequência de emissão e finalização de #50.
3. Recebe confirmação "recebido". Nenhum nome de arquivo, caminho ou tamanho exato aparece.
4. Se a Verificação ainda não analisou, pode excluir e reenviar.

### 5.3 Fluxo da elegibilidade (consumido por #52 e #55)

- Entrada: profissional.
- Saída: `completas` ou `faltantes` (lista de nomes de serviço, sem IDs nem arquivos).
- `faltantes` não vazio ⇒ a aprovação não pode ser concluída (FA-004, último item).

### 5.4 Regra de mudança de serviço (`[PROPOSTA]`, pergunta 305)

Adicionar serviço REG depois da aprovação: o profissional continua aprovado para os demais serviços, mas **não aceita nem descobre pedidos desse serviço** até a certificação estar recebida e aprovada pela Verificação.

## 6. Regras de negócio

| Ref. | Regra | Fonte | Como H-038 atende |
|---|---|---|---|
| RN-H038-01 | Atividade REG sem certificação recebida não conclui a aprovação. | RF-047; FA-004 (último item) | Função `certificacoes_completas` (CA-03) |
| RN-H038-02 | Certificação só se aplica a serviço com flag REG. | RF-003 (flag do catálogo); 09 §3.2 `regulated` | Check de serviço (CA-02) |
| RN-H038-03 | Uma certificação viva por (profissional, serviço). Substituição marca a anterior como `substituido`. | `[PROPOSTA]`, espelha D-5 de #50 | Índice único parcial (CA-05) |
| RN-H038-04 | Certificação não é foto, não passa por `media_asset` nem por `quarantine`. | 107 §1 princípio 1; 09 §3.7 ([AMBIGUIDADE], pergunta 310) | Mesmo pipeline de #50 |
| RN-H038-05 | Só a Verificação lê a certificação. O dono não lê depois de enviar. | RF-052; 09 §6 e §7; decisão 170a (via 107) | Sem rota de leitura (CA-08) |
| RN-H038-06 | Certificação não é garantia de qualidade nem aparece como selo. | RF-006; RF-005 | Sem campo público (CA-09) |
| RN-H038-07 | Conteúdo da certificação não é validado automaticamente nesta história. | BLQ-JUR L4 | Revisão humana em #52 (pergunta 300) |
| RN-H038-08 | Sem PII em log, auditoria, resposta ou nome de objeto. | 09 §7; 107 §1 princípio 6 | Mesmo padrão de #50 (CA-10) |
| RN-H038-09 | Produção fechada pela mesma trava de #50 até a L1. | 107 §9 | Mesma trava (CA-14) |

## 7. Critérios de aceite (numerados e testáveis)

Todos os testes de banco são locais, com dados sintéticos e marcador de teste. Evidência: comando, contagem e código de saída na Issue (`corepack pnpm check:all` e `db:test`).

- **CA-H038-01 (esquema).** `identity_document` aceita `kind = 'certificacao'` somente com `service_id` não nulo; aceita `kind = 'identidade'` somente com `service_id` nulo. Prova: três inserções (certificação sem serviço, identidade com serviço, certificação com serviço válido); as duas primeiras são recusadas, a terceira aceita.
- **CA-H038-02 (só serviço REG).** Enviar certificação para serviço sem flag REG é recusado com código fixo (422, sem nome do serviço no corpo). Prova: serviço REG aceita; serviço não REG recusa; flag alterada depois do envio não apaga a certificação já recebida.
- **CA-H038-03 (elegibilidade).** `certificacoes_completas` retorna `faltantes` quando há serviço REG ativo sem certificação `recebido`; retorna `completas` quando todos têm. Prova: quatro cenários: sem serviço REG (completas); um REG sem cert (faltantes com o nome); dois REG com um cert (faltantes com o outro); dois REG com certs (completas).
- **CA-H038-04 (aprovação bloqueada).** A transição para `aprovada` é recusada quando o resultado da função é `faltantes`. Prova: teste de integração com a fila de #52 (não executável nesta história sem #52; ver §1). Nesta história, a prova é a função, e a transição fica como CA de #52.
- **CA-H038-05 (uma viva por serviço).** Segunda certificação `recebido` para o mesmo (profissional, serviço) é recusada; certificação substituída fica `substituido` e não conta. Prova: duas tentativas simultâneas ⇒ uma aceita; teste de substituição após análise.
- **CA-H038-06 (limite).** Certificações não contam no limite de 5 documentos de identidade, exceto pela regra escolhida na pergunta 307. Prova: conforme a decisão; teste de borda com 5 identidades e 1 certificação.
- **CA-H038-07 (mesmo pipeline).** Imagem JPG de 4 MiB vira JPEG ≤ 1.280 px e ≤ 750 KB; PDF de 2 MiB válido é gravado com mesmo tamanho e mesmo SHA-256; PDF de 2 MiB + 1 byte ⇒ 413; GIF ⇒ 415. Prova: os mesmos testes de T-01 a T-04 de #50, aplicados a `kind = 'certificacao'`.
- **CA-H038-08 (leitura restrita).** Nenhuma rota `GET` de certificação; nenhum método de leitura no adaptador do bucket final; o profissional não lê o arquivo depois do envio. Prova: varredura de rotas e teste estático, como T-06 e T-17 de #50.
- **CA-H038-09 (fora do público).** Perfil público, descoberta e respostas de API de cliente não contêm certificação, nome de arquivo, status de análise nem a palavra "certificado" como selo. Prova: consulta de contrato da resposta; varredura de texto do perfil.
- **CA-H038-10 (sem PII).** Recebimento, recusa e exclusão de certificação gravam evento de auditoria com ação, objeto e código fixo, sem nome de arquivo, sem conteúdo e sem nome do serviço em texto livre. Prova: captura de logs e de auditoria, como T-10 e T-14 de #50.
- **CA-H038-11 (exclusão).** Exclusão pelo dono só é aceita enquanto `analyzed_at` for nulo; depois, 409. Prova: teste com `analyzed_at` simulado, como T-24 de #50.
- **CA-H038-12 (estado do perfil).** Envio de certificação não altera `verification_status`. Prova: teste com perfil em `pendente`, `em_revisao` e `retida_duplicidade`, com `verification_status` igual antes e depois.
- **CA-H038-13 (dono).** Certificação de outro profissional, id inexistente ou id não UUID devolvem 404 uniforme, com corpo e cabeçalhos idênticos. Prova: como T-12 de #50.
- **CA-H038-14 (produção fechada).** Sem `IDENTITY_DOCS_ENABLED=1`, ou em produção sem `IDENTITY_DOCS_L1_PARECER=1`, as rotas de certificação respondem 404 uniforme e não tocam banco nem Storage. Prova: como T-23 de #50.
- **CA-H038-15 (ausência de garantia).** Textos de tela e de resposta da certificação não usam "garante", "certificado de qualidade", "seguro" nem "verificado" no sentido de qualidade. Prova: varredura de texto aprovado.
- **CA-H038-16 (execução local).** `corepack pnpm check:all` e `db:test` rodam localmente, com contagem e código de saída registrados na Issue. Nenhuma alegação de CI verde.

## 8. Dependências

| Item | Estado no quadro | Tipo | Efeito sobre #51 |
|---|---|---|---|
| H-037 / #50 (documentos de identidade) | Aguardando aprovação | Declarada no backlog | **Bloqueia o Desenvolvimento.** Tabela, rotas, buckets e pipeline vêm de #50. Só começa com #50 Concluído (decisão humana). |
| H-018 / #31 (catálogo, flag REG) | Concluído | Declarada | Flag `regulated` existe no modelo; lista de serviços REG depende de L4. |
| H-035 / #48 (cadastro, CPF/CNPJ e e-mail verificado) | Concluído | Herdada por #50 | Mesma regra de dono e de e-mail verificado. |
| H-036 / #49 (perfil, serviços) | Concluído | Implícita | Serviços ativos do profissional, base da função de elegibilidade. |
| H-039 / #52 (fila de verificação) | Backlog | **Não declarada no backlog; real** | A transição "aprovada" que consome `faltantes` é de #52. Sem #52, CA-H038-04 não se prova. Pergunta 319. |
| H-042 / #55 (guarda de aprovação) | Backlog | Consumidora | Usa a mesma função. Não bloqueia #51. |
| BLQ-JUR L4 | Pendência jurídica | Declarada | Bloqueia a verificação do conteúdo e a lista REG. Não bloqueia o envio presencial. |

Nenhum item acima está Concluído além de #48, #49, #31 e #111. A dependência de #50 é a que impede o Desenvolvimento de começar sozinho.

## 9. Riscos

- **R1. Dependência cruzada com #52.** A regra só vale se #52 consumir a função. Mitigação: pergunta 319 (declarar a dependência ou mover o CA para #52).
- **R2. Lista REG indefinida.** Sem lista, o serviço pode ser marcado errado e o profissional fica bloqueado ou liberado sem razão. Mitigação: pergunta 301; seed sem REG marcado até L4.
- **R3. Conteúdo não verificado.** A certificação recebida prova só que há arquivo. Risco legal e de expectativa do cliente. Mitigação: RN-H038-07; texto neutro (CA-H038-15); L4.
- **R4. Documento de certificação tratado como foto.** Se entrar em `media_asset` ou em `quarantine`, a varredura de fotos apaga o arquivo (armadilha já registrada em 107 §0.3). Mitigação: RN-H038-04; mesmo teste de isolamento de #50 (T-19).
- **R5. Ordem de execução.** Se #51 começar antes de #50 ser aceita, o código fica sobre um esquema que pode mudar. Mitigação: pergunta 315.
- **R6. Limite de bytes.** Mais um tipo de documento aumenta o uso do teto global de 250 MB de #50. Mitigação: a certificação entra na soma do mesmo teto (pergunta 307).
- **R7. Substituição sem prazo.** Certificações `substituido` ficam no Storage sem prazo até a L1. Mitigação: mesmo tratamento de #50 (R-8 de 107).

## 10. Ambiguidades e perguntas ao líder

Lista única, numerada de 300 a 319 (faixa reservada a esta Issue). Cada item traz a recomendação do PO e a decisão que destrava.

**300. Escopo da verificação do conteúdo (L4).** A certificação é só comprovante anexado, revisado por pessoa na Verificação, ou haverá checagem automática (número de registro, validade)?
- (a) Só presença e revisão humana da Verificação.
- (b) Checagem automática em base externa de conselho.
- **Recomendação:** (a), sem integração externa e sem custo (regra de conta gratuita). Destrava CA-H038-15 e RN-H038-07.

**301. Lista de atividades REG.** Quem define quais serviços são REG, e com que lista inicial?
- (a) Admin marca a flag no catálogo (RF-003), seed inicial sem nenhum REG até L4.
- (b) Seed com lista proposta agora.
- **Recomendação:** (a). Não inventar a lista (L4 ainda aberta). Destrava CA-H038-02 e os testes com dados reais.

**302. Granularidade da certificação.** Uma certificação por (profissional, serviço REG), ou uma por profissional que valha para vários serviços?
- (a) Por serviço, como `09` §3.3 (`service_id`).
- (b) Por profissional, com lista de serviços.
- **Recomendação:** (a). Destrava CA-H038-01 e CA-H038-05.

**303. Validade da certificação.** A certificação tem data de validade que a plataforma deva checar?
- (a) Não nesta história; a Verificação decide ao analisar.
- (b) Campo `valid_until` obrigatório e checagem automática.
- **Recomendação:** (a), registrado como [AMBIGUIDADE] até L4. Destrava a estrutura da tabela.

**304. Momento da exigência.** Quando a certificação é exigida?
- (a) Para concluir a aprovação (FA-004, último item).
- (b) Para o serviço aparecer no perfil.
- (c) Para aceitar pedido desse serviço.
- **Recomendação:** (a), que é o que FA-004 diz. Destrava CA-H038-03 e CA-H038-04.

**305. Serviço REG adicionado após a aprovação.** O que acontece com o profissional já aprovado?
- (a) Aprovação mantida; esse serviço fica bloqueado para aceite e descoberta até certificação aprovada.
- (b) Aprovação suspensa até nova análise.
- **Recomendação:** (a), menos destrutivo e consistente com RF-050 (só o serviço afetado). `[PROPOSTA]`. Destrava §5.4 e a guarda de #55.

**306. Certificação recusada pela Verificação.** Qual estado aparece ao profissional?
- (a) Aprovação em `em_revisao` com motivo e recurso (RF-053); o profissional pode reenviar.
- (b) Recusa geral do profissional (`recusada`).
- **Recomendação:** (a). A recusa geral fica só para decisão sobre a pessoa, não sobre um documento. Destrava H-039 (#52) e a mensagem de H-041.

**307. Limite de documentos vivos.** Certificações contam no limite de 5 documentos de identidade (decisão 175 de #50), ou têm limite próprio?
- (a) Limite próprio: até 5 de identidade e até 1 por serviço REG.
- (b) Somam no mesmo limite de 5.
- **Recomendação:** (a), e a soma continua no teto global de bytes de #50. Destrava CA-H038-06.

**308. Formato e tamanho da certificação.** Vale a mesma regra de documento de identidade de #50 (imagem até 5 MiB, PDF até 2 MiB)?
- (a) Sim, até AMB-33 ser respondida.
- (b) Limites próprios.
- **Recomendação:** (a). Destrava CA-H038-07. Lembrar que AMB-33 ainda está aberta em `05` e `07`.

**309. Ordem entre #51 e #52.** A #51 deve ser entregue antes da #52?
- (a) Sim: a função de elegibilidade fica pronta antes da fila de aprovação.
- (b) Não: #52 entrega primeiro e depois recebe a regra.
- **Recomendação:** (a), porque a regra é condição de aprovação e #52 já vai precisar dela. Ambas dependem de #50 Concluído. Destrava o planejamento da onda E4.

**310. Certificação e `media_asset`.** `09` §3.7 lista `certification` como `owner_kind` de `media_asset`, mas `107` (decisões 172 e 213) diz que documento não usa `media_asset`.
- (a) Certificação segue `identity_document`, sem `media_asset`; corrigir `09` §3.7.
- (b) Certificação entra em `media_asset`.
- **Recomendação:** (a), pelo risco R4. Destrava o esquema e o isolamento de T-19.

**311. Visibilidade ao profissional.** O profissional vê o arquivo depois de enviar? Vê o status?
- (a) Vê só "recebido" e a análise (sem arquivo); arquivo somente para a Verificação.
- (b) Vê o próprio arquivo.
- **Recomendação:** (a), igual ao documento de identidade (decisão 170a via `107`). Destrava CA-H038-08.

**312. Certificação no perfil público.** Aparece no perfil público, por exemplo como "atividade com certificação"?
- (a) Não nesta história; o selo continua só de identidade (RF-005).
- (b) Sim, como indicador próprio.
- **Recomendação:** (a). Qualquer indicador público de certificação aumenta o risco de L7 (texto de selo). Destrava CA-H038-09.

**313. Texto da tela para serviço REG sem certificação.** Aprovar o texto proposto?
- Proposta: "Esta atividade exige certificação. Envie o documento para continuar."
- **Recomendação:** aprovar. Destrava a tela de documentos e o teste de texto.

**314. Trava de produção.** A certificação segue a mesma trava de #50 (`IDENTITY_DOCS_ENABLED` e `IDENTITY_DOCS_L1_PARECER`)?
- **Recomendação:** sim. Destrava CA-H038-14.

**315. Início do trabalho.** Arquitetura pode seguir agora, enquanto #50 aguarda aprovação? Desenvolvimento só começa com #50 Concluído?
- **Recomendação:** sim para Arquitetura (documento); não para Desenvolvimento. Destrava a movimentação de #51 para Arquitetura.

**316. Auditoria de recusa na emissão.** Recusas por tipo ou por serviço não REG entram na auditoria encadeada?
- (a) Não, só contador; auditar recusas por conteúdo, limite e estado (mesma regra de D-H037-6).
- (b) Auditar tudo.
- **Recomendação:** (a). Destrava CA-H038-10.

**317. Retenção e expurgo.** A certificação segue a mesma pendência de L1 de #50?
- **Recomendação:** sim. Nenhum prazo novo. Destrava RN e R7.

**318. Responsável pela flag REG.** A edição da flag REG e sua auditoria ficam em H-107 (Backlog)?
- **Recomendação:** sim. Esta história só lê a flag. Se a flag precisar ser editada antes de H-107, o líder decide quem altera o dado de teste. Destrava a massa de teste.

**319. Dependência declarada do gate de aprovação.** O critério de aprovação bloqueada (CA-H038-04) fica em #51 ou passa a ser critério de #52, com H-039 declarada como dependência de H-038?
- (a) Manter a função em #51 e o critério de transição em #52, com dependência declarada no backlog.
- (b) Mover todo o critério para #52.
- **Recomendação:** (a), com a dependência de #52 anotada no backlog (ver §8). Destrava a conferência de CA-H038-04.

## 11. Próximos passos

1. Líder confirma o texto da Issue #51 no GitHub e responde as perguntas 300 a 319 em lista única.
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números.
3. Atualizar este refino com as respostas.
4. Mover #51 para Arquitetura apenas depois de confirmar a coluna no quadro (pergunta 315). Não mover por inferência.
5. Não iniciar Desenvolvimento antes de #50 estar Concluído (decisão humana).
6. Corrigir `09` §3.3 e §3.7 conforme as perguntas 302 e 310, junto da entrega de #50, se o líder autorizar.

## 12. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\116-REFINO-H038.md`
- **Nenhum código, migração, teste ou alteração de quadro foi feito.** A Issue #51 permanece em Product Owner.
